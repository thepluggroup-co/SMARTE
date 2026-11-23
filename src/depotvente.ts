import type { FastifyInstance } from "fastify";
import type { Client } from "./base.js";
import { prochainNumero } from "./formations.js";
import { aPermissionSurEntite } from "./permissions.js";
import { PARAMETRES_DE_DEPART } from "./plan_comptable.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";
import { entrerEnStock, produitSuivi, sortirDuStock } from "./stocks.js";
import { lierTiers } from "./tiers.js";

/**
 * Dépôt-vente : un fournisseur local confie des articles que GLOMARI vend sans les acheter, et lui reverse, pour chaque
 * pièce vendue, un prix fixe ou le prix encaissé moins une commission (rémunération datée, celle du jour de la vente).
 * Le stock confié entre au coût 0 : il n'a aucune valeur pour GLOMARI. Le relevé se calcule sur les ventes déjà
 * enregistrées (caisse, factures donc Marketplace, retours, avoirs) ; une ligne n'entre que dans un seul relevé.
 */

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const jourDouala = () => new Date(Date.now() + 3600000).toISOString().slice(0, 10);
const JOUR = (col: string) => `((${col}) at time zone 'Africa/Douala')::date`;
const schemaRemuneration = {
  mode: { type: "string", enum: ["prix_fixe", "commission"] },
  prixReversement: { type: "integer", minimum: 0, maximum: 10_000_000_000 },
  commissionPct: { type: "number", minimum: 0, maximum: 100 },
} as const;

/**
 * Lignes vendues, retournées ou facturées des articles d'un fournisseur, jusqu'à une date, pas encore relevées.
 * Ventes et factures en positif, retours et avoirs en négatif ; montant dû selon la rémunération du jour de la vente.
 */
const LIGNES = `
  with depot as (select produit_id from articles_depot where fournisseur_id = $1),
  sources as (
    select 'comptoir'::text as source_type, l.id as source_id, l.produit_id, l.quantite::numeric as quantite, l.montant_ht::bigint as montant_ht, coalesce(v.vendue_le, v.cree_le) as vendu_le
    from lignes_comptoir l join ventes_comptoir v on v.id = l.vente_id where v.annulee_le is null and l.produit_id in (select produit_id from depot)
    union all
    select 'retour', r.id, r.produit_id, -r.quantite, -r.montant_ht, t.cree_le
    from lignes_retour_comptoir r join retours_comptoir t on t.id = r.retour_id where r.produit_id in (select produit_id from depot)
    union all
    select 'facture', l.id, l.produit_id, l.quantite, l.montant_ht, d.emis_le
    from lignes_vente l join documents_vente d on d.id = l.document_id where d.type = 'facture' and d.statut = 'emis' and l.produit_id in (select produit_id from depot)
    union all
    select 'avoir', l.id, l.produit_id, -l.quantite, -l.montant_ht, d.emis_le
    from lignes_vente l join documents_vente d on d.id = l.document_id where d.type = 'avoir' and d.statut = 'emis' and l.produit_id in (select produit_id from depot)
  )
  select s.source_type, s.source_id, s.produit_id, p.nom, s.quantite::float as quantite, s.montant_ht, s.vendu_le, ${JOUR("s.vendu_le")}::text as jour,
    (sign(s.quantite) * remuneration_depot(s.produit_id, s.vendu_le, abs(s.quantite), abs(s.montant_ht)))::int8 as montant_du
  from sources s join produits p on p.id = s.produit_id
  where ${JOUR("s.vendu_le")} <= $2 and remuneration_depot(s.produit_id, s.vendu_le, abs(s.quantite), abs(s.montant_ht)) is not null
    and not exists (select 1 from lignes_releve_depot x where x.source_type = s.source_type and x.source_id = s.source_id)
  order by s.vendu_le`;

export async function lignesAReleve(c: Client, fournisseurId: string, au: string) {
  return (await c.query(LIGNES, [fournisseurId, au])).rows;
}

export function enregistrerDepotVente(app: FastifyInstance, outils: Outils): void {
  const { protege, exigerSurEntite } = outils;

  const exigerUn = async (ctx: Contexte, permissions: ("achats.voir" | "stocks.voir" | "compta.voir")[], entiteId: string) => {
    for (const p of permissions) if (await aPermissionSurEntite(ctx.client, ctx.utilisateurId, p, entiteId)) return;
    throw new ErreurApi(403, "permission_refusee");
  };
  /** L'article confié, verrouillé, avec la branche de l'article. */
  const articleDepot = async (ctx: Contexte, produitId: string) => {
    const { rows: [a] } = await ctx.client.query(
      `select a.*, entite_branche(p.entite_id) as branche, t.nom as fournisseur from articles_depot a join produits p on p.id = a.produit_id
       join tiers t on t.id = a.fournisseur_id where a.produit_id = $1 for update of a`,
      [produitId],
    );
    if (!a) throw new ErreurApi(404, "introuvable");
    return a;
  };
  const stockTotal = async (c: Client, produitId: string) =>
    Number((await c.query("select coalesce(sum(quantite), 0)::float as q from mouvements_stock where produit_id = $1", [produitId])).rows[0].q);
  const remunerer = async (ctx: Contexte, produitId: string, b: { mode: string; prixReversement?: number; commissionPct?: number }) => {
    if (b.mode === "prix_fixe" ? b.prixReversement === undefined : b.commissionPct === undefined) throw new ErreurApi(400, "donnees_invalides");
    await ctx.client.query(
      "insert into remunerations_depot (organisation_id, produit_id, mode, prix_reversement, commission_pct, auteur_id) values ($1, $2, $3, $4, $5, $6)",
      [ctx.organisationId, produitId, b.mode, b.mode === "prix_fixe" ? b.prixReversement : null, b.mode === "commission" ? b.commissionPct : null, ctx.utilisateurId],
    );
  };

  app.get<{ Querystring: { brancheId: string } }>("/depots-vente", {
    schema: { querystring: { type: "object", required: ["brancheId"], properties: { brancheId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerUn(ctx, ["achats.voir", "stocks.voir"], req.query.brancheId);
      const { rows } = await ctx.client.query(
        `select a.produit_id, p.code, p.nom, a.actif, a.fournisseur_id, t.nom as fournisseur,
           (select json_build_object('mode', r.mode, 'prix_reversement', r.prix_reversement, 'commission_pct', r.commission_pct::float, 'depuis_le', r.depuis_le)
              from remunerations_depot r where r.produit_id = a.produit_id order by r.depuis_le desc limit 1) as remuneration,
           coalesce((select json_agg(json_build_object('lieu_id', s.entite_id, 'lieu', e.nom, 'quantite', s.q) order by e.nom)
              from (select entite_id, sum(quantite)::float as q from mouvements_stock where produit_id = a.produit_id group by entite_id having sum(quantite) <> 0) s
              join entites e on e.id = s.entite_id), '[]'::json) as stock
         from articles_depot a join produits p on p.id = a.produit_id join tiers t on t.id = a.fournisseur_id
         where entite_branche(p.entite_id) = $1 order by p.nom`,
        [req.query.brancheId],
      );
      // Ce qui est dû et pas encore relevé, par article.
      const du = new Map<string, number>();
      for (const f of new Set(rows.map((r) => r.fournisseur_id as string))) {
        for (const l of await lignesAReleve(ctx.client, f, jourDouala())) du.set(l.produit_id, (du.get(l.produit_id) ?? 0) + Number(l.montant_du));
      }
      return rows.map((r) => ({ ...r, du_non_releve: du.get(r.produit_id) ?? 0 }));
    }),
  );

  app.post<{ Body: { produitId: string; fournisseurId: string; mode: string; prixReversement?: number; commissionPct?: number } }>("/depots-vente", {
    schema: {
      body: {
        type: "object", additionalProperties: false, required: ["produitId", "fournisseurId", "mode"],
        properties: { produitId: uuid, fournisseurId: uuid, ...schemaRemuneration },
      },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      const c = ctx.client;
      const { rows: [p] } = await c.query("select id, entite_branche(entite_id) as branche from produits where id = $1", [b.produitId]);
      if (!p) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "achats.gerer", p.branche);
      await produitSuivi(c, p.id);
      const { rows: [deja] } = await c.query("select actif from articles_depot where produit_id = $1 for update", [p.id]);
      if (deja?.actif) throw new ErreurApi(409, "existe_deja");
      // Un article acheté ne se mélange pas à du stock confié : coût moyen et valeur du stock resteraient faux.
      const { rows: [achat] } = await c.query(
        "select 1 from lignes_achat l join commandes_achat k on k.id = l.commande_id where l.produit_id = $1 and k.statut in ('brouillon', 'approuvee', 'recue_partiellement') limit 1",
        [p.id],
      );
      if (achat || (await stockTotal(c, p.id)) !== 0) throw new ErreurApi(409, "article_deja_achete");
      await lierTiers(ctx, b.fournisseurId, p.branche);
      await c.query("update tiers set roles = array_append(roles, 'fournisseur') where id = $1 and not ('fournisseur' = any(roles))", [b.fournisseurId]);
      if (deja) await c.query("update articles_depot set actif = true, fournisseur_id = $2 where produit_id = $1", [p.id, b.fournisseurId]);
      else {
        await c.query("insert into articles_depot (organisation_id, produit_id, fournisseur_id, cree_par) values ($1, $2, $3, $4)", [ctx.organisationId, p.id, b.fournisseurId, ctx.utilisateurId]);
      }
      await remunerer(ctx, p.id, b);
      await c.query("select journal_evenement('depot_vente.article', $1)", [JSON.stringify({ produit: p.id, fournisseur: b.fournisseurId, mode: b.mode })]);
      return { produit_id: p.id, actif: true };
    });
    return reponse.status(201).send(r);
  });

  /** La nouvelle rémunération vaut pour les ventes à partir de maintenant ; les ventes passées gardent la leur. */
  app.post<{ Params: { produitId: string }; Body: { mode: string; prixReversement?: number; commissionPct?: number } }>("/depots-vente/:produitId/remuneration", {
    schema: {
      params: { type: "object", required: ["produitId"], properties: { produitId: uuid } },
      body: { type: "object", additionalProperties: false, required: ["mode"], properties: schemaRemuneration },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const a = await articleDepot(ctx, req.params.produitId);
      await exigerSurEntite(ctx, "achats.gerer", a.branche);
      if (!a.actif) throw new ErreurApi(409, "depot_inactif");
      await remunerer(ctx, a.produit_id, req.body);
      return { enregistre: true };
    }),
  );

  app.post<{ Params: { produitId: string } }>("/depots-vente/:produitId/fin", {
    schema: { params: { type: "object", required: ["produitId"], properties: { produitId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const a = await articleDepot(ctx, req.params.produitId);
      await exigerSurEntite(ctx, "achats.gerer", a.branche);
      if ((await stockTotal(ctx.client, a.produit_id)) !== 0) throw new ErreurApi(409, "stock_restant");
      await ctx.client.query("update articles_depot set actif = false where produit_id = $1", [a.produit_id]);
      return { actif: false };
    }),
  );

  const mouvement = { type: "object", additionalProperties: false, required: ["lieuId", "quantite"], properties: {
    lieuId: uuid, quantite: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000_000, multipleOf: 0.001 }, reference: { type: "string", maxLength: 100 },
  } } as const;
  const lieuDuDepot = async (ctx: Contexte, a: Record<string, any>, lieuId: string) => {
    await exigerSurEntite(ctx, "stocks.gerer", lieuId);
    const { rows: [e] } = await ctx.client.query("select entite_branche($1) as b", [lieuId]);
    if (e.b !== a.branche) throw new ErreurApi(400, "lieu_invalide");
    await produitSuivi(ctx.client, a.produit_id);
  };

  /** Les pièces confiées entrent au coût 0 : elles sont vendables mais n'ont aucune valeur pour GLOMARI. */
  app.post<{ Params: { produitId: string }; Body: { lieuId: string; quantite: number; reference?: string } }>("/depots-vente/:produitId/entrees", {
    schema: { params: { type: "object", required: ["produitId"], properties: { produitId: uuid } }, body: mouvement },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const a = await articleDepot(ctx, req.params.produitId);
      if (!a.actif) throw new ErreurApi(409, "depot_inactif");
      await lieuDuDepot(ctx, a, req.body.lieuId);
      await entrerEnStock(ctx, req.body.lieuId, a.produit_id, req.body.quantite, 0, "entree", `Dépôt-vente : ${a.fournisseur}`.slice(0, 300), req.body.reference?.trim() || null);
      return { quantite: req.body.quantite };
    });
    return reponse.status(201).send(r);
  });

  /** Les invendus repartent chez le fournisseur, sans montant dû. */
  app.post<{ Params: { produitId: string }; Body: { lieuId: string; quantite: number; reference?: string } }>("/depots-vente/:produitId/retours", {
    schema: { params: { type: "object", required: ["produitId"], properties: { produitId: uuid } }, body: mouvement },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const a = await articleDepot(ctx, req.params.produitId);
      await lieuDuDepot(ctx, a, req.body.lieuId);
      await sortirDuStock(ctx, req.body.lieuId, a.produit_id, req.body.quantite, "sortie", "Retour au déposant", null, req.body.reference?.trim() || null);
      return { quantite: req.body.quantite };
    });
    return reponse.status(201).send(r);
  });

  /** La branche du fournisseur, et le droit de saisir en comptabilité pour y établir un relevé. */
  const brancheFournisseur = async (ctx: Contexte, fournisseurId: string, permission: "compta.saisir" | "compta.voir") => {
    const { rows: [t] } = await ctx.client.query("select branche_id from tiers where id = $1", [fournisseurId]);
    if (!t?.branche_id) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, permission, t.branche_id);
    return t.branche_id as string;
  };
  const periode = (du: string, au: string) => {
    if (au < du || au > jourDouala()) throw new ErreurApi(400, "periode_invalide");
  };

  app.get<{ Querystring: { fournisseurId: string; du: string; au: string } }>("/depots-vente/releves/apercu", {
    schema: { querystring: { type: "object", required: ["fournisseurId", "du", "au"], properties: { fournisseurId: uuid, du: date, au: date } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await brancheFournisseur(ctx, req.query.fournisseurId, "compta.saisir");
      periode(req.query.du, req.query.au);
      const lignes = await lignesAReleve(ctx.client, req.query.fournisseurId, req.query.au);
      return {
        lignes, total: lignes.reduce((s, l) => s + Number(l.montant_du), 0),
        // Des ventes plus anciennes jamais relevées entrent aussi : elles sont signalées pour que rien ne soit oublié.
        anterieures: lignes.filter((l) => l.jour < req.query.du).length,
      };
    }),
  );

  app.post<{ Body: { fournisseurId: string; du: string; au: string } }>("/depots-vente/releves", {
    schema: { body: { type: "object", additionalProperties: false, required: ["fournisseurId", "du", "au"], properties: { fournisseurId: uuid, du: date, au: date } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const c = ctx.client;
      const b = req.body;
      const branche = await brancheFournisseur(ctx, b.fournisseurId, "compta.saisir");
      periode(b.du, b.au);
      // Deux relevés simultanés du même fournisseur ne prennent pas les mêmes ventes.
      await c.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`releve_depot:${b.fournisseurId}`]);
      const lignes = await lignesAReleve(c, b.fournisseurId, b.au);
      const total = lignes.reduce((s, l) => s + Number(l.montant_du), 0);
      if (total <= 0) throw new ErreurApi(409, "releve_vide");
      const numero = await prochainNumero(c, `RDV-${b.au.slice(0, 4)}`);
      const { rows: [param] } = await c.query("select numero from parametres_comptables where branche_id = $1 and cle = 'achats_marchandises'", [branche]);
      const compte = param?.numero ?? PARAMETRES_DE_DEPART.achats_marchandises!;
      const { rows: [f] } = await c.query(
        `insert into factures_fournisseur (organisation_id, entite_id, fournisseur_id, numero_fournisseur, date_facture, total_ht, total_taxes, total_ttc, cree_par)
         values ($1, $2, $3, $4, $5, $6, 0, $6, $7) returning id, statut, total_ttc`,
        [ctx.organisationId, branche, b.fournisseurId, numero, jourDouala(), total, ctx.utilisateurId],
      );
      await c.query(
        "insert into lignes_facture_fournisseur (organisation_id, facture_id, ordre, designation, compte_numero, montant_ht, montant_taxes) values ($1, $2, 1, $3, $4, $5, 0)",
        [ctx.organisationId, f.id, `Dépôt-vente, relevé ${numero} jusqu'au ${b.au}`, compte, total],
      );
      const { rows: [releve] } = await c.query(
        `insert into releves_depot (organisation_id, branche_id, fournisseur_id, numero, du, au, total_du, facture_fournisseur_id, cree_par)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
        [ctx.organisationId, branche, b.fournisseurId, numero, b.du, b.au, total, f.id, ctx.utilisateurId],
      );
      for (const l of lignes) {
        await c.query(
          `insert into lignes_releve_depot (organisation_id, releve_id, source_type, source_id, produit_id, quantite, montant_ht, montant_du, vendu_le)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [ctx.organisationId, releve.id, l.source_type, l.source_id, l.produit_id, l.quantite, l.montant_ht, l.montant_du, l.vendu_le],
        );
      }
      await c.query("select journal_evenement('depot_vente.releve', $1)", [JSON.stringify({ releve: releve.id, fournisseur: b.fournisseurId, total, lignes: lignes.length })]);
      return { releve: { ...releve, lignes: lignes.length }, facture: f };
    });
    return reponse.status(201).send(r);
  });

  app.get<{ Querystring: { brancheId: string } }>("/depots-vente/releves", {
    schema: { querystring: { type: "object", required: ["brancheId"], properties: { brancheId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerUn(ctx, ["compta.voir", "achats.voir"], req.query.brancheId);
      return (await ctx.client.query(
        `select r.id, r.numero, r.du, r.au, r.total_du, r.cree_le, t.nom as fournisseur, f.statut as facture_statut, f.numero as facture_numero,
           coalesce((select sum(p.montant) from paiements_fournisseur p where p.facture_id = f.id and p.annule_le is null), 0)::int8 as paye
         from releves_depot r join tiers t on t.id = r.fournisseur_id join factures_fournisseur f on f.id = r.facture_fournisseur_id
         where r.branche_id = $1 order by r.cree_le desc limit 200`,
        [req.query.brancheId],
      )).rows;
    }),
  );
}
