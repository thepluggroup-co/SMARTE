import type { FastifyInstance } from "fastify";
import { publierEvenement } from "./base.js";
import { choisirUnite, enUniteDeBase, type UniteVente } from "./articles.js";
import { calculerLigne } from "./facturation.js";
import { prochainNumero } from "./formations.js";
import { aPermissionSurEntite, entitesAccessibles } from "./permissions.js";
import { brutTranches, controleCredit, prixProduit } from "./commerce.js";
import { titulaires } from "./performance.js";
import { normaliserTelephone } from "./securite.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";
import { produitSuivi, sortirDuStock } from "./stocks.js";
import { exigerNonBloque, lierTiers } from "./tiers.js";

const uuid = { type: "string", format: "uuid" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const MOYENS = ["especes", "mtn_momo", "orange_money", "carte", "virement", "cheque", "points"];
const date = { type: "string", format: "date" } as const;
const JOUR = "(now() at time zone 'Africa/Douala')::date";

/** Répartit une remise en FCFA sur des lignes, au prorata de leur montant, sans perdre un franc ni dépasser une ligne. */
export function repartirRemise(montants: number[], remise: number): number[] {
  const total = montants.reduce((s, m) => s + m, 0);
  if (!remise || !total) return montants.map(() => 0);
  const parts = montants.map((m) => Math.floor((remise * m) / total));
  let reste = remise - parts.reduce((s, x) => s + x, 0);
  // Le reste de l'arrondi va d'abord aux plus grosses lignes, un franc à la fois.
  const ordre = montants.map((_, i) => i).sort((a, b) => montants[b]! - montants[a]!);
  for (let tour = 0; reste > 0 && tour < 3; tour += 1) for (const i of ordre) if (reste > 0 && parts[i]! < montants[i]!) { parts[i]! += 1; reste -= 1; }
  return parts;
}
/** Hors taxes et taxes d'un montant TTC, au taux de la ligne. */
export function decomposerTtc(ttc: number, taux: number): { ht: number; taxes: number } {
  const ht = Math.round((ttc * 100_000) / (100_000 + Math.round(taux * 1000)));
  return { ht, taxes: ttc - ht };
}
/** Au delà, seul un superviseur accorde la remise. Valeur à confirmer et à rendre paramétrable. */
export const REMISE_MAX_CAISSIER = 10;

export function enregistrerCaisse(app: FastifyInstance, outils: Outils): void {
  const { protege, exiger, exigerSurEntite } = outils;

  const sessionOuverte = async (ctx: Contexte, entiteId: string) =>
    (await ctx.client.query(
      "select * from sessions_caisse where entite_id = $1 and caissier_id = $2 and fermee_le is null",
      [entiteId, ctx.utilisateurId],
    )).rows[0];

  const totaux = async (ctx: Contexte, sessionId: string) => {
    const { rows } = await ctx.client.query(
      `select p.moyen, sum(p.montant)::int8 as montant from paiements_comptoir p join ventes_comptoir v on v.id = p.vente_id
       where v.session_id = $1 and v.annulee_le is null group by p.moyen order by p.moyen`,
      [sessionId],
    );
    const r = await ctx.client.query(
      `select coalesce(sum(rendu), 0)::int8 as rendu, coalesce(sum(total_ttc), 0)::int8 as ventes, count(*)::int as nombre
       from ventes_comptoir where session_id = $1 and annulee_le is null`,
      [sessionId],
    );
    // Les restes dus réglés pendant cette session entrent dans sa caisse, même si la vente date d'un autre jour.
    const { rows: credits } = await ctx.client.query("select moyen, sum(montant)::int8 as montant from reglements_comptoir where session_id = $1 group by moyen order by moyen", [sessionId]);
    const especes = Number(rows.find((x) => x.moyen === "especes")?.montant ?? 0) + Number(credits.find((x) => x.moyen === "especes")?.montant ?? 0);
    const { rows: [du] } = await ctx.client.query("select coalesce(sum(reste_du), 0)::int8 as s from ventes_comptoir where session_id = $1 and annulee_le is null", [sessionId]);
    // Les retours remboursés pendant cette session sortent de sa caisse.
    const { rows: rembourses } = await ctx.client.query(
      "select x.moyen, sum(x.montant)::int8 as montant from remboursements_comptoir x join retours_comptoir t on t.id = x.retour_id where t.session_id = $1 and x.moyen <> 'credit' group by x.moyen order by x.moyen", [sessionId],
    );
    return {
      paiements: rows, reglements_credit: credits, remboursements: rembourses, credits_accordes: Number(du.s), ventes: r.rows[0].ventes, nombre: r.rows[0].nombre,
      especes_nettes: especes - r.rows[0].rendu - Number(rembourses.find((x) => x.moyen === "especes")?.montant ?? 0),
    };
  };

  /** Les personnes qui peuvent vendre dans ce lieu : c'est parmi elles qu'on choisit le vendeur d'une vente. */
  const vendeursDuLieu = async (ctx: Contexte, entiteId: string): Promise<{ id: string; nom: string }[]> => {
    const ids = await titulaires(ctx.client, ["caisse.vendre"], entiteId);
    return (await ctx.client.query("select id, nom from utilisateurs where id = any($1::uuid[]) and actif order by nom", [ids])).rows;
  };
  /** Ce qui reste à payer d'une vente à crédit. */
  const resteCredit = async (ctx: Contexte, venteId: string): Promise<number> =>
    Number((await ctx.client.query(
      "select reste_credit_comptoir($1) as r", [venteId],
    )).rows[0].r);

  const regleFidelite = async (ctx: Contexte, entiteId: string) =>
    (await ctx.client.query(
      "select actif, fcfa_par_point, valeur_point from regles_fidelite where branche_id = entite_branche($1)", [entiteId],
    )).rows[0] as { actif: boolean; fcfa_par_point: number; valeur_point: number } | undefined;

  const soldePoints = async (ctx: Contexte, tiersId: string): Promise<number> =>
    (await ctx.client.query("select coalesce(sum(points), 0)::int8 as s from points_fidelite where tiers_id = $1", [tiersId])).rows[0].s;

  const mouvementPoints = (ctx: Contexte, tiersId: string, points: number, motif: string, venteId: string) =>
    ctx.client.query(
      "insert into points_fidelite (organisation_id, tiers_id, points, motif, vente_id, auteur_id) values ($1, $2, $3, $4, $5, $6)",
      [ctx.organisationId, tiersId, points, motif, venteId, ctx.utilisateurId],
    );

  /** Les valeurs sont celles que choisit la branche : rien n'est actif par défaut. */
  app.put<{ Params: { id: string }; Body: { actif: boolean; fcfaParPoint: number; valeurPoint: number } }>("/entites/:id/fidelite", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["actif", "fcfaParPoint", "valeurPoint"],
        properties: {
          actif: { type: "boolean" }, fcfaParPoint: { type: "integer", minimum: 1, maximum: 100_000_000 },
          valeurPoint: { type: "integer", minimum: 0, maximum: 1_000_000 },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "caisse.superviser", req.params.id);
      const { rows: [e] } = await ctx.client.query("select entite_branche($1) as branche", [req.params.id]);
      if (!e.branche) throw new ErreurApi(400, "donnees_invalides");
      const b = req.body;
      await ctx.client.query(
        `insert into regles_fidelite (organisation_id, branche_id, actif, fcfa_par_point, valeur_point) values ($1, $2, $3, $4, $5)
         on conflict (organisation_id, branche_id) do update set actif = excluded.actif, fcfa_par_point = excluded.fcfa_par_point, valeur_point = excluded.valeur_point`,
        [ctx.organisationId, e.branche, b.actif, b.fcfaParPoint, b.valeurPoint],
      );
      await ctx.client.query("select journal_evenement('fidelite.reglee', $1)", [JSON.stringify({ branche: e.branche, ...b })]);
      return { ...b };
    }),
  );

  app.get<{ Querystring: { entiteId: string } }>("/fidelite", {
    schema: { querystring: { type: "object", required: ["entiteId"], properties: { entiteId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "caisse.vendre", req.query.entiteId);
      return (await regleFidelite(ctx, req.query.entiteId)) ?? { actif: false, fcfa_par_point: null, valeur_point: null };
    }),
  );

  /** Le caissier retrouve un client de sa branche par son téléphone. */
  app.get<{ Querystring: { telephone: string; entiteId: string } }>("/fidelite/client", {
    schema: {
      querystring: {
        type: "object", required: ["telephone", "entiteId"],
        properties: { telephone: { type: "string", minLength: 6, maxLength: 30 }, entiteId: uuid },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "caisse.vendre", req.query.entiteId);
      const { rows: [t] } = await ctx.client.query(
        `select id, nom from tiers where telephone = $1 and not archive and branche_id = entite_branche($2) limit 1`,
        [normaliserTelephone(req.query.telephone), req.query.entiteId],
      );
      if (!t) throw new ErreurApi(404, "introuvable");
      return { ...t, points: await soldePoints(ctx, t.id) };
    }),
  );

  app.post<{ Body: { entiteId: string; fondOuverture: number } }>("/caisse/ouverture", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "fondOuverture"],
        properties: { entiteId: uuid, fondOuverture: { type: "integer", minimum: 0, maximum: 1_000_000_000 } },
      },
    },
  }, async (req, reponse) => {
    const s = await protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "caisse.vendre", req.body.entiteId);
      if (await sessionOuverte(ctx, req.body.entiteId)) throw new ErreurApi(409, "caisse_deja_ouverte");
      const { rows } = await ctx.client.query(
        "insert into sessions_caisse (organisation_id, entite_id, caissier_id, fond_ouverture) values ($1, $2, $3, $4) returning *",
        [ctx.organisationId, req.body.entiteId, ctx.utilisateurId, req.body.fondOuverture],
      );
      return rows[0];
    });
    return reponse.status(201).send(s);
  });

  app.get("/caisse", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "caisse.vendre");
      const lieux = await entitesAccessibles(ctx.client, ctx.utilisateurId, "caisse.vendre");
      const { rows } = await ctx.client.query(
        `select s.*, e.nom as entite from sessions_caisse s join entites e on e.id = s.entite_id
         where s.caissier_id = $1 and s.fermee_le is null`,
        [ctx.utilisateurId],
      );
      const ouvertes = [];
      for (const s of rows) {
        const [identite, vendeurs, stocks, categories, series, marques] = [
          // Identité du vendeur pour le ticket : celle du lieu, sinon de l'entité la plus proche au-dessus.
          (await ctx.client.query(
            `with recursive l as (select id, parent_id, raison_sociale, niu, rccm, adresse, 0 as n from entites where id = $1
               union all select e.id, e.parent_id, e.raison_sociale, e.niu, e.rccm, e.adresse, l.n + 1 from entites e join l on e.id = l.parent_id)
             select raison_sociale, niu, rccm, adresse from l where raison_sociale is not null or niu is not null or rccm is not null order by n limit 1`, [s.entite_id])).rows[0] ?? null,
          await vendeursDuLieu(ctx, s.entite_id),
          (await ctx.client.query("select produit_id, sum(quantite)::float as q from mouvements_stock where entite_id = $1 group by produit_id", [s.entite_id])).rows,
          (await ctx.client.query("select id, parent_id, nom from categories_articles where actif and branche_id = coalesce(entite_branche($1), $1) order by parent_id is not null, lower(nom)", [s.entite_id])).rows,
          (await ctx.client.query("select produit_id, count(*)::int as n from numeros_serie where statut = 'en_stock' group by produit_id")).rows,
          (await ctx.client.query("select id, nom from marques where actif and branche_id = coalesce(entite_branche($1), $1) order by lower(nom)", [s.entite_id])).rows,
        ];
        ouvertes.push({
          ...s, ...(await totaux(ctx, s.id)), identite, vendeurs, categories, marques,
          stocks: Object.fromEntries(stocks.map((x) => [x.produit_id, x.q])), series: Object.fromEntries(series.map((x) => [x.produit_id, x.n])),
          superviseur: await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "caisse.superviser", s.entite_id),
          credit: await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "caisse.credit", s.entite_id), remise_max: REMISE_MAX_CAISSIER,
        });
      }
      return { lieux: lieux.map((e) => ({ id: e.id, nom: e.nom })), ouvertes };
    }),
  );

  /**
   * Tout ou rien : ticket, paiements et sortie de stock sont enregistrés ensemble.
   * Remises : en % ou en FCFA TTC sur une ligne, en % ou en FCFA TTC sur toute la vente. La remise globale est
   * répartie sur les lignes, pour que la taxe et la marge de chaque article restent justes.
   * Crédit : avec un client identifié de la branche et le droit caisse.credit, jamais hors connexion.
   * L'écriture comptable d'une vente à crédit (créance client) doit être validée par l'expert-comptable.
   */
  type LigneVente = { produitId: string; quantite: number; unite?: string; remisePct?: number; remiseMontant?: number; tauxTaxe?: number; numerosSerie?: string[] };
  app.post<{
    Body: {
      entiteId: string; tiersId?: string; vendeurId?: string;
      lignes: LigneVente[];
      remiseGlobalePct?: number; remiseGlobaleMontant?: number;
      paiements: { moyen: string; montant: number; reference?: string }[];
      credit?: boolean; echeance?: string;
      cleAppareil?: string; horsLigne?: boolean; vendueLe?: string;
    };
  }>("/caisse/ventes", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "lignes", "paiements"],
        properties: {
          entiteId: uuid, tiersId: uuid, vendeurId: uuid, cleAppareil: uuid, horsLigne: { type: "boolean" },
          vendueLe: { type: "string", format: "date-time" },
          remiseGlobalePct: { type: "number", minimum: 0, maximum: 100, multipleOf: 0.01 },
          remiseGlobaleMontant: { type: "integer", minimum: 0, maximum: 10_000_000_000 },
          credit: { type: "boolean" }, echeance: date,
          lignes: {
            type: "array", minItems: 1, maxItems: 300,
            items: {
              type: "object", required: ["produitId", "quantite"],
              properties: {
                produitId: uuid, unite: { type: "string", minLength: 1, maxLength: 50 },
                quantite: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000, multipleOf: 0.001 },
                remisePct: { type: "number", minimum: 0, maximum: 100, multipleOf: 0.01 },
                remiseMontant: { type: "integer", minimum: 0, maximum: 10_000_000_000 },
                tauxTaxe: { type: "number", minimum: 0, maximum: 100, multipleOf: 0.001 },
                numerosSerie: { type: "array", maxItems: 100, items: { type: "string", minLength: 1, maxLength: 100 } },
              },
            },
          },
          paiements: {
            type: "array", maxItems: 10,
            items: {
              type: "object", required: ["moyen", "montant"],
              properties: {
                moyen: { type: "string", enum: MOYENS },
                montant: { type: "integer", minimum: 1, maximum: 10_000_000_000 },
                reference: { type: "string", maxLength: 100 },
              },
            },
          },
        },
      },
    },
  }, async (req, reponse) => {
    const v = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "caisse.vendre", b.entiteId);
      if (b.cleAppareil) {
        // Une vente déjà reçue n'est pas enregistrée deux fois si l'appareil la renvoie.
        const deja = await ctx.client.query("select * from ventes_comptoir where cle_appareil = $1", [b.cleAppareil]);
        if (deja.rows[0]) return { ...deja.rows[0], lignes: [], deja_recue: true };
      }
      const session = await sessionOuverte(ctx, b.entiteId);
      if (!session) throw new ErreurApi(409, "caisse_fermee");
      // Verrou partagé : une clôture attend les ventes en cours, et une vente ne passe pas après une clôture.
      const { rows: [encore] } = await ctx.client.query("select fermee_le from sessions_caisse where id = $1 for share", [session.id]);
      if (encore.fermee_le) throw new ErreurApi(409, "caisse_fermee");
      // Une vente passée pendant une coupure a déjà eu lieu : le stock peut devenir négatif et doit alors être vérifié.
      const horsLigne = b.horsLigne === true;
      if (horsLigne && !b.vendueLe) throw new ErreurApi(400, "donnees_invalides");
      if (b.remiseGlobalePct !== undefined && b.remiseGlobaleMontant !== undefined) throw new ErreurApi(400, "donnees_invalides");
      if (b.tiersId) await lierTiers(ctx, b.tiersId, b.entiteId);
      const superviseur = await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "caisse.superviser", b.entiteId);
      const vendeurs = await vendeursDuLieu(ctx, b.entiteId);
      const vendeur = b.vendeurId ? vendeurs.find((x) => x.id === b.vendeurId) : { id: ctx.utilisateurId, nom: vendeurs.find((x) => x.id === ctx.utilisateurId)?.nom ?? "" };
      if (!vendeur) throw new ErreurApi(400, "vendeur_invalide");
      // Ordre fixe des verrous : deux caisses simultanées ne peuvent pas se bloquer mutuellement.
      const ordre = [...b.lignes].sort((x, y) => x.produitId.localeCompare(y.produitId));
      const calcul: { l: LigneVente; p: Record<string, any>; taux: number; m: { ht: number; taxes: number }; brut: number; ttc: number; u: UniteVente; base: number; prixUnite: number }[] = [];
      for (const l of ordre) {
        if (l.remisePct !== undefined && l.remiseMontant !== undefined) throw new ErreurApi(400, "donnees_invalides");
        if ((l.remisePct ?? 0) > REMISE_MAX_CAISSIER && !superviseur) throw new ErreurApi(403, "remise_non_autorisee");
        const { rows: [p] } = await ctx.client.query(
          `with recursive lignee as (
             select id, parent_id from entites where id = $2
             union all select e.id, e.parent_id from entites e join lignee a on e.id = a.parent_id
           )
           select id, nom, prix_vente, taux_taxe::float, suivi_stock, actif, unite, pieces_par_unite::float, conditionnements, prix_piece from produits
           where id = $1 and entite_id in (select id from lignee)`,
          [l.produitId, b.entiteId],
        );
        if (!p || !p.actif) throw new ErreurApi(404, "introuvable");
        // Unité de vente : pièce, carton… Le stock et les paliers de prix se comptent toujours dans l'unité de base.
        const u = choisirUnite(p, l.unite);
        const base = u.base ? l.quantite : enUniteDeBase(l.quantite, u);
        if (!(base > 0)) throw new ErreurApi(400, "donnees_invalides");
        // La taxe de la fiche produit s'applique : seul un superviseur peut la changer sur une vente.
        if (l.tauxTaxe !== undefined && Number(l.tauxTaxe) !== Number(p.taux_taxe) && !superviseur) throw new ErreurApi(403, "taxe_non_autorisee");
        const taux = l.tauxTaxe ?? p.taux_taxe;
        const tranches = u.base ? await brutTranches(ctx.client, p.id, p.prix_vente, l.quantite) : undefined;
        p.prix_vente = await prixProduit(ctx.client, p.id, p.prix_vente, base);
        // Prix de l'unité choisie : celui fixé sur la fiche, sinon calculé depuis le prix de base.
        const prixUnite = u.base ? p.prix_vente : u.prix ?? Math.round(p.prix_vente * u.facteur);
        const plein = calculerLigne(l.quantite, prixUnite, 0, taux, tranches);
        const brut = plein.ht + plein.taxes;
        let m = calculerLigne(l.quantite, prixUnite, l.remisePct ?? 0, taux, tranches);
        if (l.remiseMontant) {
          // Remise en FCFA TTC : convertie ici, jamais par l'écran.
          if (l.remiseMontant > brut) throw new ErreurApi(400, "remise_invalide");
          m = decomposerTtc(brut - l.remiseMontant, taux);
        }
        calcul.push({ l, p, taux, m, brut, ttc: m.ht + m.taxes, u, base, prixUnite });
      }
      // Remise sur toute la vente : répartie sur les lignes au prorata.
      const avantGlobale = calcul.reduce((s, c) => s + c.ttc, 0);
      const remiseGlobale = b.remiseGlobaleMontant ?? Math.round((avantGlobale * Math.round((b.remiseGlobalePct ?? 0) * 100)) / 10_000);
      if (remiseGlobale > avantGlobale) throw new ErreurApi(400, "remise_invalide");
      const parts = repartirRemise(calcul.map((c) => c.ttc), remiseGlobale);
      calcul.forEach((c, i) => {
        if (parts[i]) { c.ttc -= parts[i]!; c.m = decomposerTtc(c.ttc, c.taux); }
        // Même plafond pour toutes les formes de remise, cumulées sur la ligne.
        if ((c.l.remiseMontant || parts[i]) && c.brut - c.ttc > Math.ceil((c.brut * REMISE_MAX_CAISSIER) / 100) && !superviseur) throw new ErreurApi(403, "remise_non_autorisee");
      });
      const ht = calcul.reduce((s, c) => s + c.m.ht, 0), taxes = calcul.reduce((s, c) => s + c.m.taxes, 0);
      const ttc = ht + taxes;
      if (b.tiersId) {
        // Verrou par client : deux caisses ne dépensent pas les mêmes points et ne dépassent pas le plafond ensemble.
        await ctx.client.query("select 1 from tiers where id = $1 for update", [b.tiersId]);
      }
      for (const p of b.paiements) {
        if (!["especes", "points"].includes(p.moyen) && !p.reference?.trim()) throw new ErreurApi(400, "reference_obligatoire");
      }
      const recu = b.paiements.reduce((s, p) => s + p.montant, 0);
      const especes = b.paiements.filter((p) => p.moyen === "especes").reduce((s, p) => s + p.montant, 0);
      const regle = b.tiersId ? await regleFidelite(ctx, b.entiteId) : null;
      const pointsPayes = b.paiements.filter((p) => p.moyen === "points").reduce((s, p) => s + p.montant, 0);
      if (pointsPayes) {
        if (!b.tiersId || !regle?.actif || !regle.valeur_point) throw new ErreurApi(409, "fidelite_inactive");
        const besoin = Math.ceil(pointsPayes / regle.valeur_point);
        if (besoin > await soldePoints(ctx, b.tiersId)) throw new ErreurApi(409, "points_insuffisants");
      }
      let resteDu = 0;
      if (recu < ttc) {
        if (!b.credit) throw new ErreurApi(409, "paiement_insuffisant", { total: ttc });
        // Vente à crédit : client identifié de la branche, droit dédié, jamais hors connexion, plafond du client respecté.
        if (horsLigne) throw new ErreurApi(409, "credit_hors_connexion");
        if (!b.tiersId) throw new ErreurApi(400, "credit_sans_client");
        if (!(await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "caisse.credit", b.entiteId))) throw new ErreurApi(403, "credit_non_autorise");
        await exigerNonBloque(ctx.client, b.tiersId, "livraison");
        resteDu = ttc - recu;
        const plafond = await controleCredit(ctx.client, b.tiersId, resteDu);
        if (plafond?.depasse && !(await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "facturation.administrer", b.entiteId))) throw new ErreurApi(409, "plafond_credit_depasse", plafond);
      } else if (!b.paiements.length) throw new ErreurApi(409, "paiement_insuffisant", { total: ttc });
      const rendu = Math.max(recu - ttc, 0);
      // Seules les espèces se rendent.
      if (rendu > especes) throw new ErreurApi(409, "rendu_impossible");
      const numero = await prochainNumero(ctx.client, `TCK-${new Date().getFullYear()}`);
      const { rows: [vente] } = await ctx.client.query(
        `insert into ventes_comptoir (organisation_id, session_id, entite_id, numero, tiers_id, total_ht, total_taxes, total_ttc, rendu, caissier_id, cle_appareil, hors_ligne, vendue_le,
           vendeur_id, remise_globale, reste_du, echeance)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) returning *`,
        [ctx.organisationId, session.id, b.entiteId, numero, b.tiersId ?? null, ht, taxes, ttc, rendu, ctx.utilisateurId, b.cleAppareil ?? null, horsLigne, b.vendueLe ?? null,
          vendeur.id, remiseGlobale, resteDu, resteDu ? b.echeance ?? null : null],
      );
      for (const { l, p, taux, m, brut, ttc: ttcLigne, u, base, prixUnite } of calcul) {
        const series = [...new Set((l.numerosSerie ?? []).map((x) => x.trim()).filter(Boolean))];
        if (series.length) {
          // Chaque numéro de série vendu doit être en stock pour cet article ; il passe à « vendu ».
          if (horsLigne || series.length > Math.ceil(base)) throw new ErreurApi(400, "donnees_invalides");
          const { rowCount } = await ctx.client.query(
            "update numeros_serie set statut = 'vendu', tiers_id = $3 where produit_id = $1 and numero = any($2::text[]) and statut = 'en_stock'", [p.id, series, b.tiersId ?? null],
          );
          if (rowCount !== series.length) throw new ErreurApi(409, "serie_indisponible", { produit: p.nom });
        }
        const remise = brut - ttcLigne;
        await ctx.client.query(
          `insert into lignes_comptoir (organisation_id, vente_id, produit_id, designation, quantite, prix_unitaire, remise_pct, taux, montant_ht, montant_taxes, remise_montant, numeros_serie, unite, quantite_unite, prix_unite)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [ctx.organisationId, vente.id, p.id, p.nom, base, p.prix_vente, remise && brut ? Math.min(Math.round((remise * 10_000) / brut) / 100, 100) : l.remisePct ?? 0, taux, m.ht, m.taxes, remise, series,
            u.base ? null : u.nom, u.base ? null : l.quantite, u.base ? null : prixUnite],
        );
        if (p.suivi_stock) {
          await produitSuivi(ctx.client, p.id);
          await sortirDuStock(ctx, b.entiteId, p.id, base, "vente", horsLigne ? "Vente hors connexion" : null, null, numero, horsLigne);
          if (horsLigne) {
            // Une vente hors connexion passe même sans stock : tout dépassement reste au journal, au nom du caissier.
            const { rows: [n] } = await ctx.client.query("select coalesce(sum(quantite), 0)::float as q from mouvements_stock where entite_id = $1 and produit_id = $2", [b.entiteId, p.id]);
            if (n.q < 0) await ctx.client.query("select journal_evenement('caisse.stock_negatif', $1)", [JSON.stringify({ vente: numero, produit: p.id, stock: n.q })]);
          }
        }
      }
      for (const p of b.paiements) {
        await ctx.client.query(
          "insert into paiements_comptoir (organisation_id, vente_id, moyen, montant, reference) values ($1, $2, $3, $4, $5)",
          [ctx.organisationId, vente.id, p.moyen, p.montant, p.reference?.trim() || null],
        );
      }
      await publierEvenement(ctx.client, "vente.comptoir", { id: vente.id, numero, ttc });
      if (resteDu) await ctx.client.query("select journal_evenement('caisse.credit', $1)", [JSON.stringify({ vente: numero, client: b.tiersId, reste: resteDu })]);
      let gagnes = 0;
      if (b.tiersId && regle?.actif) {
        if (pointsPayes) {
          await mouvementPoints(ctx, b.tiersId, -Math.ceil(pointsPayes / regle.valeur_point), `Paiement ${numero}`, vente.id);
        }
        // Les points se gagnent sur ce qui a été réellement payé, autrement qu'avec des points : pas sur un crédit.
        gagnes = Math.floor(Math.max(ttc - pointsPayes - resteDu, 0) / regle.fcfa_par_point);
        if (gagnes > 0) await mouvementPoints(ctx, b.tiersId, gagnes, `Vente ${numero}`, vente.id);
      }
      return {
        ...vente, points_gagnes: gagnes, vendeur: vendeur.nom, remise_totale: calcul.reduce((s, c) => s + c.brut - c.ttc, 0),
        paiements: b.paiements.map((p) => ({ moyen: p.moyen, montant: p.montant })),
        lignes: calcul.map((c) => ({ designation: c.p.nom, quantite: c.l.quantite, unite: c.u.nom, quantite_base: c.base, prix_unitaire: c.prixUnite, montant_ht: c.m.ht, montant_ttc: c.ttc, remise_montant: c.brut - c.ttc, numeros_serie: c.l.numerosSerie ?? [] })),
      };
    });
    return reponse.status(201).send(v);
  });

  /** Création rapide d'un client à la caisse : nom et téléphone, dans la branche du lieu. Un numéro déjà connu rend la fiche existante. */
  app.post<{ Body: { entiteId: string; nom: string; telephone: string } }>("/caisse/clients", {
    schema: { body: { type: "object", required: ["entiteId", "nom", "telephone"], properties: { entiteId: uuid, nom: { type: "string", minLength: 2, maxLength: 200 }, telephone: { type: "string", minLength: 6, maxLength: 30 } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "caisse.vendre", b.entiteId);
      const telephone = normaliserTelephone(b.telephone);
      if (telephone.length < 8) throw new ErreurApi(400, "telephone_invalide");
      const { rows: [br] } = await ctx.client.query("select entite_branche($1) as b", [b.entiteId]);
      if (!br.b) throw new ErreurApi(409, "donnees_invalides");
      const { rows: [deja] } = await ctx.client.query("select id, nom, telephone from tiers where telephone = $1 and not archive and branche_id = $2 limit 1", [telephone, br.b]);
      if (deja) return { ...deja, deja_connu: true };
      const { rows: [t] } = await ctx.client.query(
        `insert into tiers (organisation_id, type, nom, telephone, roles, entite_origine_id, branche_id) values ($1, 'personne', $2, $3, '{client}', $4, $5) returning id, nom, telephone`,
        [ctx.organisationId, b.nom.trim(), telephone, b.entiteId, br.b],
      );
      await lierTiers(ctx, t.id, b.entiteId);
      await publierEvenement(ctx.client, "tiers.cree", { id: t.id });
      return { ...t, deja_connu: false };
    });
    return reponse.status(201).send(r);
  });
  /** Chercher un client de la branche du lieu, par nom ou téléphone. */
  app.get<{ Querystring: { entiteId: string; q: string } }>("/caisse/clients", {
    schema: { querystring: { type: "object", required: ["entiteId", "q"], properties: { entiteId: uuid, q: { type: "string", minLength: 2, maxLength: 100 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "caisse.vendre", req.query.entiteId);
      const motif = `%${req.query.q.replace(/[\\%_]/g, "\\$&")}%`;
      return (await ctx.client.query(
        `select t.id, t.nom, t.telephone,
           coalesce((select sum(reste_credit_comptoir(v.id)) from ventes_comptoir v where v.tiers_id = t.id and v.annulee_le is null and v.reste_du > 0), 0)::int8 as reste_du
         from tiers t where not t.archive and t.branche_id = entite_branche($1) and (t.nom ilike $2 or t.telephone ilike $2 or t.telephone = $3) order by t.nom limit 10`,
        [req.query.entiteId, motif, normaliserTelephone(req.query.q)],
      )).rows;
    }),
  );

  /** Ventes à crédit du lieu qui attendent encore un règlement. */
  app.get<{ Querystring: { entiteId: string } }>("/caisse/credits", { schema: { querystring: { type: "object", required: ["entiteId"], properties: { entiteId: uuid } } } }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "caisse.vendre", req.query.entiteId);
      return (await ctx.client.query(
        `select * from (select v.id, v.numero, v.total_ttc, v.reste_du as credit, v.echeance::text, coalesce(v.vendue_le, v.cree_le) as vendue_le, t.nom as client, t.telephone,
             reste_credit_comptoir(v.id)::int8 as reste,
             coalesce(v.echeance, (v.cree_le at time zone 'Africa/Douala')::date) < ${JOUR} as en_retard
           from ventes_comptoir v join tiers t on t.id = v.tiers_id where v.entite_id = $1 and v.annulee_le is null and v.reste_du > 0) x
         where x.reste > 0 order by x.vendue_le limit 300`,
        [req.query.entiteId],
      )).rows;
    }),
  );
  /** Le client vient régler tout ou partie de son reste dû : l'argent entre dans la caisse ouverte du caissier. */
  app.post<{ Params: { id: string }; Body: { paiements: { moyen: string; montant: number; reference?: string }[] } }>("/caisse/ventes/:id/reglements", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["paiements"],
        properties: {
          paiements: {
            type: "array", minItems: 1, maxItems: 10,
            items: { type: "object", required: ["moyen", "montant"], properties: { moyen: { type: "string", enum: MOYENS.filter((x) => x !== "points") }, montant: { type: "integer", minimum: 1, maximum: 10_000_000_000 }, reference: { type: "string", maxLength: 100 } } },
          },
        },
      },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const { rows: [v] } = await ctx.client.query("select id, entite_id, numero, annulee_le, reste_du from ventes_comptoir where id = $1 for update", [req.params.id]);
      if (!v) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "caisse.vendre", v.entite_id);
      if (v.annulee_le || !Number(v.reste_du)) throw new ErreurApi(409, "vente_sans_credit");
      const session = await sessionOuverte(ctx, v.entite_id);
      if (!session) throw new ErreurApi(409, "caisse_fermee");
      const { rows: [encore] } = await ctx.client.query("select fermee_le from sessions_caisse where id = $1 for share", [session.id]);
      if (encore.fermee_le) throw new ErreurApi(409, "caisse_fermee");
      const total = req.body.paiements.reduce((s, p) => s + p.montant, 0);
      const reste = await resteCredit(ctx, v.id);
      if (total > reste) throw new ErreurApi(409, "reglement_trop_eleve", { reste });
      for (const p of req.body.paiements) {
        if (p.moyen !== "especes" && !p.reference?.trim()) throw new ErreurApi(400, "reference_obligatoire");
        await ctx.client.query(
          "insert into reglements_comptoir (organisation_id, vente_id, session_id, moyen, montant, reference, encaisse_par) values ($1, $2, $3, $4, $5, $6, $7)",
          [ctx.organisationId, v.id, session.id, p.moyen, p.montant, p.reference?.trim() || null, ctx.utilisateurId],
        );
      }
      return { numero: v.numero, regle: total, reste: reste - total };
    });
    return reponse.status(201).send(r);
  });

  /** Une annulation remet les articles en stock et retire le paiement du total de la caisse. */
  app.post<{ Params: { id: string }; Body: { motif: string } }>("/caisse/ventes/:id/annulation", {
    schema: {
      params: paramId,
      body: { type: "object", required: ["motif"], properties: { motif: { type: "string", minLength: 5, maxLength: 500 } } },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [v] } = await ctx.client.query(
        `select v.*, s.fermee_le from ventes_comptoir v join sessions_caisse s on s.id = v.session_id where v.id = $1 for update of v, s`,
        [req.params.id],
      );
      if (!v) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "caisse.superviser", v.entite_id);
      if (v.annulee_le) throw new ErreurApi(409, "deja_annule");
      if (v.fermee_le) throw new ErreurApi(409, "caisse_deja_cloturee");
      // Une vente qui a déjà un retour ne s'annule plus : le retour a son propre numéro et son remboursement.
      if ((await ctx.client.query("select 1 from retours_comptoir where vente_id = $1 limit 1", [v.id])).rows[0]) throw new ErreurApi(409, "vente_avec_retour");
      // Un crédit déjà réglé en partie ne s'annule plus ici : l'argent reçu devrait être rendu.
      if ((await ctx.client.query("select 1 from reglements_comptoir where vente_id = $1 limit 1", [v.id])).rows[0]) throw new ErreurApi(409, "credit_deja_regle");
      await ctx.client.query(
        "update numeros_serie n set statut = 'en_stock', tiers_id = null from lignes_comptoir l where l.vente_id = $1 and n.produit_id = l.produit_id and n.numero = any(l.numeros_serie) and n.statut = 'vendu'", [v.id],
      );
      const { rows: lignes } = await ctx.client.query(
        `select l.produit_id, l.quantite::float, p.suivi_stock, p.cout_moyen from lignes_comptoir l join produits p on p.id = l.produit_id
         where l.vente_id = $1 order by l.produit_id`,
        [v.id],
      );
      for (const l of lignes.filter((x) => x.suivi_stock)) {
        await produitSuivi(ctx.client, l.produit_id);
        await ctx.client.query(
          `insert into mouvements_stock (organisation_id, entite_id, produit_id, type, quantite, cout_unitaire, motif, reference, auteur_id)
           values ($1, $2, $3, 'retour', $4, $5, $6, $7, $8)`,
          [ctx.organisationId, v.entite_id, l.produit_id, l.quantite, l.cout_moyen, req.body.motif, v.numero, ctx.utilisateurId],
        );
      }
      if (v.tiers_id) {
        const { rows: pts } = await ctx.client.query(
          "select coalesce(sum(points), 0)::int8 as total from points_fidelite where vente_id = $1", [v.id],
        );
        // Des points déjà dépensés ne peuvent plus être repris : le solde ne passe jamais sous zéro.
        const total = Number(pts[0].total);
        const repris = total > 0 ? Math.min(total, Math.max(await soldePoints(ctx, v.tiers_id), 0)) : total;
        if (repris !== 0) await mouvementPoints(ctx, v.tiers_id, -repris, `Annulation ${v.numero}`, v.id);
        if (repris !== total) await ctx.client.query("select journal_evenement('fidelite.reprise_partielle', $1)", [JSON.stringify({ vente: v.numero, attendu: total, repris })]);
      }
      await ctx.client.query(
        "update ventes_comptoir set annulee_le = now(), annulee_par = $2, motif_annulation = $3 where id = $1",
        [v.id, ctx.utilisateurId, req.body.motif],
      );
      return { annule: true };
    }),
  );

  app.post<{ Params: { id: string }; Body: { especesComptees: number; motifEcart?: string } }>("/caisse/sessions/:id/cloture", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["especesComptees"],
        properties: {
          especesComptees: { type: "integer", minimum: 0, maximum: 10_000_000_000 },
          motifEcart: { type: "string", minLength: 3, maxLength: 500 },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [s] } = await ctx.client.query("select * from sessions_caisse where id = $1 for update", [req.params.id]);
      if (!s) throw new ErreurApi(404, "introuvable");
      if (s.caissier_id !== ctx.utilisateurId) await exigerSurEntite(ctx, "caisse.superviser", s.entite_id);
      else await exigerSurEntite(ctx, "caisse.vendre", s.entite_id);
      if (s.fermee_le) throw new ErreurApi(409, "caisse_deja_cloturee");
      const t = await totaux(ctx, s.id);
      const attendues = s.fond_ouverture + t.especes_nettes;
      const ecart = req.body.especesComptees - attendues;
      if (ecart !== 0 && !req.body.motifEcart) throw new ErreurApi(400, "motif_ecart_obligatoire", { attendues, ecart });
      await ctx.client.query(
        `update sessions_caisse set fermee_le = now(), especes_attendues = $2, especes_comptees = $3, ecart = $4, motif_ecart = $5 where id = $1`,
        [s.id, attendues, req.body.especesComptees, ecart, req.body.motifEcart ?? null],
      );
      await publierEvenement(ctx.client, "caisse.cloturee", { id: s.id, ecart });
      return { ...t, attendues, comptees: req.body.especesComptees, ecart };
    }),
  );

  /** Suivi des responsables : chaque session de caisse et ses écarts. */
  app.get("/caisse/sessions", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "caisse.superviser");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "caisse.superviser")).map((e) => e.id);
      const { rows } = await ctx.client.query(
        `select s.id, s.ouverte_le, s.fermee_le, s.fond_ouverture, s.especes_attendues, s.especes_comptees, s.ecart, s.motif_ecart,
           e.nom as entite, u.nom as caissier,
           (select coalesce(sum(v.total_ttc), 0) from ventes_comptoir v where v.session_id = s.id and v.annulee_le is null)::int8 as ventes
         from sessions_caisse s join entites e on e.id = s.entite_id join utilisateurs u on u.id = s.caissier_id
         where s.entite_id = any($1::uuid[]) order by s.fermee_le is not null, s.ouverte_le desc limit 300`,
        [ids],
      );
      return rows;
    }),
  );

  app.get<{ Params: { id: string } }>("/caisse/sessions/:id/ventes", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [s] } = await ctx.client.query("select entite_id, caissier_id from sessions_caisse where id = $1", [req.params.id]);
      if (!s) throw new ErreurApi(404, "introuvable");
      if (s.caissier_id !== ctx.utilisateurId) await exigerSurEntite(ctx, "caisse.superviser", s.entite_id);
      const { rows } = await ctx.client.query(
        `select v.id, v.numero, v.total_ttc, v.rendu, v.cree_le, v.annulee_le, v.motif_annulation, v.hors_ligne, v.vendue_le, v.reste_du, u.nom as vendeur, t.nom as client
         from ventes_comptoir v left join utilisateurs u on u.id = v.vendeur_id left join tiers t on t.id = v.tiers_id where v.session_id = $1 order by v.cree_le desc limit 500`,
        [req.params.id],
      );
      return rows;
    }),
  );
}
