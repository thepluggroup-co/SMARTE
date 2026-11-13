import type { FastifyInstance } from "fastify";
import { decomposerTtc } from "./caisse.js";
import { prochainNumero } from "./formations.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";
import { produitSuivi } from "./stocks.js";

/*
 * Retour partiel d'une vente de caisse. Le ticket d'origine reste figé : le retour a son propre numéro.
 * Le responsable de caisse (caisse.superviser) rend l'argent seul : décision d'Achille du 11 novembre 2026,
 * exception à la règle « une sortie d'argent exige tresorerie.gerer ». Chaque retour reste au journal.
 * L'écriture comptable d'un retour (avoir) doit être validée par l'expert-comptable.
 */

const uuid = { type: "string", format: "uuid" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const MOYENS_REMBOURSEMENT = ["especes", "mtn_momo", "orange_money", "carte", "virement", "cheque", "credit"];

export function enregistrerRetours(app: FastifyInstance, outils: Outils): void {
  const { protege, exigerSurEntite } = outils;

  /** Le ticket complet : lignes avec ce qui a déjà été retourné, paiements, retours. Pour le caissier du lieu. */
  const ticket = async (ctx: Contexte, id: string) => {
    const { rows: [v] } = await ctx.client.query(
      `select v.id, v.numero, v.entite_id, e.nom as entite, v.total_ht, v.total_taxes, v.total_ttc, v.rendu, v.reste_du, reste_credit_comptoir(v.id)::int8 as reste_restant, v.echeance::text,
         v.remise_globale, v.annulee_le, v.motif_annulation, v.hors_ligne, coalesce(v.vendue_le, v.cree_le) as cree_le, v.tiers_id, t.nom as client, u.nom as vendeur, k.nom as caissier
       from ventes_comptoir v join entites e on e.id = v.entite_id left join tiers t on t.id = v.tiers_id left join utilisateurs u on u.id = v.vendeur_id join utilisateurs k on k.id = v.caissier_id
       where v.id = $1`, [id],
    );
    if (!v) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, "caisse.vendre", v.entite_id);
    const { rows: lignes } = await ctx.client.query(
      `select l.id, l.produit_id, l.designation, l.quantite::float, p.unite as unite_base, l.unite, l.quantite_unite::float, l.prix_unitaire, l.prix_unite, l.taux::float, l.montant_ht, l.montant_taxes,
         l.remise_montant, l.numeros_serie, (l.montant_ht + l.montant_taxes)::int8 as montant_ttc,
         coalesce((select sum(r.quantite) from lignes_retour_comptoir r where r.ligne_id = l.id), 0)::float as retourne,
         coalesce((select sum(r.montant_ht + r.montant_taxes) from lignes_retour_comptoir r where r.ligne_id = l.id), 0)::int8 as rembourse
       from lignes_comptoir l join produits p on p.id = l.produit_id where l.vente_id = $1 order by l.designation, l.id`, [id],
    );
    const { rows: paiements } = await ctx.client.query("select moyen, montant, reference from paiements_comptoir where vente_id = $1 order by moyen", [id]);
    const { rows: retours } = await ctx.client.query(
      `select t.id, t.numero, t.motif, t.total_ttc, t.points_repris, t.cree_le, u.nom as auteur,
         (select json_agg(json_build_object('moyen', x.moyen, 'montant', x.montant)) from remboursements_comptoir x where x.retour_id = t.id) as remboursements,
         (select json_agg(json_build_object('designation', l.designation, 'quantite', r.quantite::float, 'destination', r.destination, 'montant_ttc', r.montant_ht + r.montant_taxes))
            from lignes_retour_comptoir r join lignes_comptoir l on l.id = r.ligne_id where r.retour_id = t.id) as lignes
       from retours_comptoir t join utilisateurs u on u.id = t.auteur_id where t.vente_id = $1 order by t.cree_le`, [id],
    );
    return { ...v, lignes, paiements, retours, remise_totale: lignes.reduce((s, l) => s + Number(l.remise_montant), 0) };
  };
  app.get<{ Params: { id: string } }>("/caisse/ventes/:id", { schema: { params: paramId } }, async (req) => protege(req, (ctx) => ticket(ctx, req.params.id)));
  /** Retrouver un ticket du lieu par son numéro, même d'une caisse déjà clôturée : un retour arrive souvent plusieurs jours après. */
  app.get<{ Querystring: { entiteId: string; numero: string } }>("/caisse/tickets", {
    schema: { querystring: { type: "object", required: ["entiteId", "numero"], properties: { entiteId: uuid, numero: { type: "string", minLength: 3, maxLength: 40 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "caisse.vendre", req.query.entiteId);
      const motif = `%${req.query.numero.trim().replace(/[\\%_]/g, "\\$&")}`;
      return (await ctx.client.query(
        `select v.id, v.numero, v.total_ttc, coalesce(v.vendue_le, v.cree_le) as cree_le, v.annulee_le, t.nom as client
         from ventes_comptoir v left join tiers t on t.id = v.tiers_id where v.entite_id = $1 and v.numero ilike $2 order by v.cree_le desc limit 10`, [req.query.entiteId, motif],
      )).rows;
    }),
  );

  app.post<{
    Params: { id: string };
    Body: { motif: string; lignes: { ligneId: string; quantite: number; destination: "vente" | "avarie" }[]; remboursements: { moyen: string; montant: number; reference?: string }[] };
  }>("/caisse/ventes/:id/retours", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["motif", "lignes", "remboursements"],
        properties: {
          motif: { type: "string", minLength: 5, maxLength: 500 },
          lignes: {
            type: "array", minItems: 1, maxItems: 300,
            items: { type: "object", required: ["ligneId", "quantite", "destination"], properties: { ligneId: uuid, quantite: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000, multipleOf: 0.001 }, destination: { type: "string", enum: ["vente", "avarie"] } } },
          },
          remboursements: {
            type: "array", minItems: 1, maxItems: 10,
            items: { type: "object", required: ["moyen", "montant"], properties: { moyen: { type: "string", enum: MOYENS_REMBOURSEMENT }, montant: { type: "integer", minimum: 1, maximum: 10_000_000_000 }, reference: { type: "string", maxLength: 100 } } },
          },
        },
      },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      const { rows: [v] } = await ctx.client.query("select id, entite_id, numero, tiers_id, annulee_le from ventes_comptoir where id = $1 for update", [req.params.id]);
      if (!v) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "caisse.superviser", v.entite_id);
      if (v.annulee_le) throw new ErreurApi(409, "deja_annule");
      const argent = b.remboursements.filter((x) => x.moyen !== "credit");
      for (const x of argent) if (x.moyen !== "especes" && !x.reference?.trim()) throw new ErreurApi(400, "reference_obligatoire");
      // Le remboursement sort de la caisse ouverte de la personne qui fait le retour.
      const { rows: [session] } = await ctx.client.query("select id from sessions_caisse where entite_id = $1 and caissier_id = $2 and fermee_le is null for share", [v.entite_id, ctx.utilisateurId]);
      if (!session) throw new ErreurApi(409, "caisse_fermee");
      if (new Set(b.lignes.map((l) => l.ligneId)).size !== b.lignes.length) throw new ErreurApi(400, "donnees_invalides");

      const calcul = [];
      for (const l of [...b.lignes].sort((x, y) => x.ligneId.localeCompare(y.ligneId))) {
        const { rows: [x] } = await ctx.client.query(
          `select l.id, l.produit_id, l.quantite::float, l.taux::float, (l.montant_ht + l.montant_taxes)::int8 as ttc, p.suivi_stock, p.cout_moyen, p.nom,
             coalesce((select sum(r.quantite) from lignes_retour_comptoir r where r.ligne_id = l.id), 0)::float as retourne,
             coalesce((select sum(r.montant_ht + r.montant_taxes) from lignes_retour_comptoir r where r.ligne_id = l.id), 0)::int8 as rembourse
           from lignes_comptoir l join produits p on p.id = l.produit_id where l.id = $1 and l.vente_id = $2`, [l.ligneId, v.id],
        );
        if (!x) throw new ErreurApi(404, "introuvable");
        const restant = Math.round((x.quantite - x.retourne) * 1000) / 1000;
        if (l.quantite > restant) throw new ErreurApi(409, "retour_trop_grand", { article: x.nom, restant });
        // Montant au prorata de ce qui a été payé pour la ligne, remises comprises ; le dernier retour prend le reste exact.
        const ttc = l.quantite === restant ? Number(x.ttc) - Number(x.rembourse) : Math.round((Number(x.ttc) * Math.round(l.quantite * 1000)) / Math.round(x.quantite * 1000));
        calcul.push({ l, x, ttc, m: decomposerTtc(ttc, x.taux) });
      }
      const total = calcul.reduce((s, c) => s + c.ttc, 0);
      if (total <= 0) throw new ErreurApi(409, "retour_sans_montant");
      if (b.remboursements.reduce((s, x) => s + x.montant, 0) !== total) throw new ErreurApi(409, "remboursement_inexact", { total });
      const surCredit = b.remboursements.filter((x) => x.moyen === "credit").reduce((s, x) => s + x.montant, 0);
      if (surCredit) {
        const { rows: [k] } = await ctx.client.query("select reste_credit_comptoir($1)::int8 as r", [v.id]);
        if (surCredit > Number(k.r)) throw new ErreurApi(409, "reglement_trop_eleve", { reste: Number(k.r) });
      }

      // Points de fidélité : on reprend ceux gagnés sur l'argent rendu, sans jamais passer le solde sous zéro.
      let repris = 0;
      if (v.tiers_id) {
        await ctx.client.query("select 1 from tiers where id = $1 for update", [v.tiers_id]);
        const { rows: [regle] } = await ctx.client.query("select actif, fcfa_par_point from regles_fidelite where branche_id = entite_branche($1)", [v.entite_id]);
        const { rows: [pts] } = await ctx.client.query(
          "select coalesce((select sum(points) from points_fidelite where vente_id = $1 and motif not like 'Paiement %'), 0)::int8 as gagnes, coalesce((select sum(points) from points_fidelite where tiers_id = $2), 0)::int8 as solde", [v.id, v.tiers_id],
        );
        if (regle?.fcfa_par_point) repris = Math.max(Math.min(Math.floor((total - surCredit) / Number(regle.fcfa_par_point)), Number(pts.gagnes), Number(pts.solde)), 0);
      }
      const numero = await prochainNumero(ctx.client, `RET-${new Date().getFullYear()}`);
      const { rows: [retour] } = await ctx.client.query(
        `insert into retours_comptoir (organisation_id, vente_id, entite_id, session_id, numero, motif, total_ht, total_taxes, total_ttc, points_repris, auteur_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id, numero, total_ttc, cree_le`,
        [ctx.organisationId, v.id, v.entite_id, session.id, numero, b.motif.trim(), calcul.reduce((s, c) => s + c.m.ht, 0), calcul.reduce((s, c) => s + c.m.taxes, 0), total, repris, ctx.utilisateurId],
      );
      for (const { l, x, m } of calcul) {
        await ctx.client.query(
          "insert into lignes_retour_comptoir (organisation_id, retour_id, ligne_id, produit_id, quantite, destination, montant_ht, montant_taxes) values ($1, $2, $3, $4, $5, $6, $7, $8)",
          [ctx.organisationId, retour.id, x.id, x.produit_id, l.quantite, l.destination, m.ht, m.taxes],
        );
        if (x.suivi_stock) {
          // L'article revient dans le stock du lieu ; avarié, il est aussitôt mis de côté (plus vendable).
          await produitSuivi(ctx.client, x.produit_id);
          await ctx.client.query(
            `insert into mouvements_stock (organisation_id, entite_id, produit_id, type, quantite, cout_unitaire, motif, reference, auteur_id) values ($1, $2, $3, 'retour', $4, $5, $6, $7, $8)`,
            [ctx.organisationId, v.entite_id, x.produit_id, l.quantite, x.cout_moyen, b.motif.trim(), numero, ctx.utilisateurId],
          );
          if (l.destination === "avarie") {
            await ctx.client.query("insert into avaries (organisation_id, entite_id, produit_id, quantite, motif, auteur_id) values ($1, $2, $3, $4, $5, $6)",
              [ctx.organisationId, v.entite_id, x.produit_id, l.quantite, `Retour ${numero} : ${b.motif.trim()}`.slice(0, 500), ctx.utilisateurId]);
          }
        }
      }
      for (const x of b.remboursements) {
        await ctx.client.query("insert into remboursements_comptoir (organisation_id, retour_id, vente_id, moyen, montant, reference) values ($1, $2, $3, $4, $5, $6)",
          [ctx.organisationId, retour.id, v.id, x.moyen, x.montant, x.reference?.trim() || null]);
      }
      if (repris > 0) {
        await ctx.client.query("insert into points_fidelite (organisation_id, tiers_id, points, motif, vente_id, auteur_id) values ($1, $2, $3, $4, $5, $6)",
          [ctx.organisationId, v.tiers_id, -repris, `Retour ${numero}`, v.id, ctx.utilisateurId]);
      }
      await ctx.client.query("select journal_evenement('caisse.retour', $1)", [JSON.stringify({ retour: numero, vente: v.numero, total })]);
      return { ...retour, vente: v.numero, points_repris: repris, remboursements: b.remboursements.map((x) => ({ moyen: x.moyen, montant: x.montant })) };
    });
    return reponse.status(201).send(r);
  });
}
