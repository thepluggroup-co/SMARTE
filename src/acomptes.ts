import type { FastifyInstance } from "fastify";
import type { Client } from "./base.js";
import { ErreurApi, type Outils } from "./serveur.js";

/**
 * Acomptes au fournisseur d'un bon de commande, avant sa facture (règle R5 : les fabricants sont payés d'avance).
 * Chaque acompte est une sortie d'argent avec le droit de trésorerie ; à la validation de la facture reliée, il s'impute
 * par un paiement relié, sans nouvelle sortie. Un déclencheur interdit de l'imputer au-delà de son montant.
 */

const uuid = { type: "string", format: "uuid" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;

/** Ce qui reste d'un acompte à imputer : son montant moins ses imputations actives ; rien s'il est annulé. */
const DISPONIBLE = `case when a.annule_le is null then a.montant - coalesce((select sum(p.montant) from paiements_fournisseur p
  where p.acompte_id = a.id and p.annule_le is null), 0) else 0 end`;

export async function acomptesDeCommande(c: Client, commandeId: string) {
  const { rows } = await c.query(
    `select a.id, a.montant, a.date_versement, a.reference, a.devise, a.montant_devise::float, a.taux::float, a.annule_le, a.motif_annulation,
       x.nom as portefeuille, (${DISPONIBLE})::int8 as disponible
     from acomptes_fournisseur a join portefeuilles x on x.id = a.portefeuille_id where a.commande_id = $1 order by a.date_versement, a.cree_le`,
    [commandeId],
  );
  const actifs = rows.filter((a) => !a.annule_le);
  const verse = actifs.reduce((s, a) => s + Number(a.montant), 0);
  const disponible = actifs.reduce((s, a) => s + Number(a.disponible), 0);
  return { verse, impute: verse - disponible, disponible, liste: rows };
}

/**
 * À la validation d'une facture reliée à un bon de commande : les acomptes disponibles s'imputent dans l'ordre de versement,
 * jusqu'au reste de la facture. L'argent est déjà sorti du portefeuille : aucun mouvement de trésorerie.
 */
export async function imputerAcomptes(c: Client, org: string, facture: { id: string; commande_id: string | null }, auteurId: string) {
  if (!facture.commande_id) return [];
  const { rows: acomptes } = await c.query(
    "select id, portefeuille_id, reference from acomptes_fournisseur where commande_id = $1 and annule_le is null order by date_versement, cree_le for update",
    [facture.commande_id],
  );
  const { rows: [f] } = await c.query(
    "select total_ttc - coalesce((select sum(montant) from paiements_fournisseur where facture_id = $1 and annule_le is null), 0) as reste from factures_fournisseur where id = $1",
    [facture.id],
  );
  let reste = Number(f.reste);
  const imputes: { acompte: string; montant: number }[] = [];
  for (const a of acomptes) {
    if (reste <= 0) break;
    const { rows: [d] } = await c.query(
      "select montant - coalesce((select sum(montant) from paiements_fournisseur where acompte_id = $1 and annule_le is null), 0) as disponible from acomptes_fournisseur where id = $1",
      [a.id],
    );
    const montant = Math.min(Number(d.disponible), reste);
    if (montant <= 0) continue;
    await c.query(
      `insert into paiements_fournisseur (organisation_id, facture_id, portefeuille_id, montant, date_paiement, reference, auteur_id, acompte_id)
       values ($1, $2, $3, $4, (now() at time zone 'Africa/Douala')::date, $5, $6, $7)`,
      [org, facture.id, a.portefeuille_id, montant, a.reference, auteurId, a.id],
    );
    reste -= montant;
    imputes.push({ acompte: a.id, montant });
  }
  return imputes;
}

/** L'annulation d'une facture rend ses imputations : les acomptes redeviennent disponibles. */
export async function annulerImputations(c: Client, factureId: string, motif: string): Promise<void> {
  await c.query(
    "update paiements_fournisseur set annule_le = now(), motif_annulation = $2 where facture_id = $1 and acompte_id is not null and annule_le is null",
    [factureId, motif],
  );
}

/** Un bon de commande ne s'annule pas tant qu'un de ses acomptes garde un disponible : l'argent est chez le fournisseur. */
export async function disponibleDeCommande(c: Client, commandeId: string): Promise<number> {
  const { rows: [r] } = await c.query(`select coalesce(sum(${DISPONIBLE}), 0)::int8 as d from acomptes_fournisseur a where a.commande_id = $1`, [commandeId]);
  return Number(r.d);
}

export function enregistrerAcomptes(app: FastifyInstance, outils: Outils): void {
  const { protege, exigerSurEntite } = outils;

  app.post<{
    Params: { id: string };
    Body: { portefeuilleId: string; montant: number; date: string; reference?: string; devise?: string; montantDevise?: number; taux?: number };
  }>("/achats/commandes/:id/acomptes", {
    schema: {
      params: paramId,
      body: {
        type: "object", additionalProperties: false, required: ["portefeuilleId", "montant", "date"],
        properties: {
          portefeuilleId: uuid, montant: { type: "integer", minimum: 1, maximum: 1_000_000_000_000 }, date: { type: "string", format: "date" },
          reference: { type: "string", maxLength: 200 }, devise: { type: "string", pattern: "^[A-Z]{3}$" },
          montantDevise: { type: "number", exclusiveMinimum: 0, maximum: 100_000_000_000 }, taux: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000_000 },
        },
      },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const c = ctx.client;
      const b = req.body;
      // Toujours la commande, puis le portefeuille : deux acomptes simultanés ne dépassent jamais la commande.
      const { rows: [k] } = await c.query(
        `select k.id, k.numero, k.statut, k.total, k.fournisseur_id, k.entite_id, entite_branche(k.entite_id) as branche, t.nom as fournisseur
         from commandes_achat k join tiers t on t.id = k.fournisseur_id where k.id = $1 for update of k`,
        [req.params.id],
      );
      if (!k) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "tresorerie.gerer", k.branche ?? k.entite_id);
      if (!["approuvee", "recue_partiellement"].includes(k.statut)) throw new ErreurApi(409, "commande_non_approuvee");
      if ((b.devise === undefined) !== (b.montantDevise === undefined) || (b.devise === undefined) !== (b.taux === undefined)) throw new ErreurApi(400, "donnees_invalides");
      const { rows: [w] } = await c.query("select *, entite_branche(entite_id) as branche from portefeuilles where id = $1 for update", [b.portefeuilleId]);
      if (!w) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "tresorerie.gerer", w.entite_id);
      if (w.branche !== k.branche) throw new ErreurApi(409, "transfert_autre_branche");
      if (!w.actif) throw new ErreurApi(409, "portefeuille_inactif");
      const { rows: [s] } = await c.query("select coalesce(sum(montant), 0)::int8 as s from mouvements_portefeuille where portefeuille_id = $1", [w.id]);
      if (b.montant > Number(s.s)) throw new ErreurApi(409, "solde_portefeuille_insuffisant");
      const { rows: [v] } = await c.query("select coalesce(sum(montant), 0)::int8 as v from acomptes_fournisseur where commande_id = $1 and annule_le is null", [k.id]);
      if (Number(v.v) + b.montant > Number(k.total)) throw new ErreurApi(409, "acompte_superieur_commande", { possible: Math.max(Number(k.total) - Number(v.v), 0) });
      const reference = b.reference?.trim() || null;
      const { rows: [a] } = await c.query(
        `insert into acomptes_fournisseur (organisation_id, commande_id, fournisseur_id, portefeuille_id, montant, date_versement, reference, devise, montant_devise, taux, auteur_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
        [ctx.organisationId, k.id, k.fournisseur_id, w.id, b.montant, b.date, reference, b.devise ?? null, b.montantDevise ?? null, b.taux ?? null, ctx.utilisateurId],
      );
      await c.query(
        `insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, reference, source_type, source_id, auteur_id)
         values ($1, $2, 'sortie', $3, $4, $5, 'acompte_fournisseur', $6, $7)`,
        [ctx.organisationId, w.id, -b.montant, `Acompte ${k.numero} à ${k.fournisseur}`.slice(0, 300), reference, a.id, ctx.utilisateurId],
      );
      await c.query("select journal_evenement('achat.acompte', $1)", [JSON.stringify({ commande: k.id, acompte: a.id, montant: b.montant })]);
      return { ...a, disponible: Number(a.montant) };
    });
    return reponse.status(201).send(r);
  });

  /** Le fournisseur a remboursé : l'argent revient dans le portefeuille. Un acompte imputé ne s'annule plus. */
  app.post<{ Params: { id: string }; Body: { motif: string } }>("/achats/acomptes/:id/annulation", {
    schema: { params: paramId, body: { type: "object", required: ["motif"], properties: { motif: { type: "string", minLength: 5, maxLength: 500 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const c = ctx.client;
      const { rows: [a] } = await c.query(
        `select a.*, k.entite_id, entite_branche(k.entite_id) as branche from acomptes_fournisseur a join commandes_achat k on k.id = a.commande_id
         where a.id = $1 for update of a`,
        [req.params.id],
      );
      if (!a) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "tresorerie.gerer", a.branche ?? a.entite_id);
      if (a.annule_le) throw new ErreurApi(409, "deja_annule");
      if (req.body.motif.trim().length < 5) throw new ErreurApi(400, "donnees_invalides");
      const { rows: [i] } = await c.query("select 1 from paiements_fournisseur where acompte_id = $1 and annule_le is null limit 1", [a.id]);
      if (i) throw new ErreurApi(409, "acompte_impute");
      await c.query("update acomptes_fournisseur set annule_le = now(), motif_annulation = $2, annule_par = $3 where id = $1", [a.id, req.body.motif.trim(), ctx.utilisateurId]);
      await c.query(
        `insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, source_type, source_id, annule_mouvement_id, auteur_id)
         select organisation_id, portefeuille_id, 'annulation', -montant, $2, source_type, source_id, id, $3
         from mouvements_portefeuille where source_id = $1 and type = 'sortie' and source_type = 'acompte_fournisseur'`,
        [a.id, `Annulation : ${req.body.motif.trim()}`.slice(0, 300), ctx.utilisateurId],
      );
      await c.query("select journal_evenement('achat.acompte_annule', $1)", [JSON.stringify({ acompte: a.id, montant: Number(a.montant) })]);
      return { annule: true };
    }),
  );
}
