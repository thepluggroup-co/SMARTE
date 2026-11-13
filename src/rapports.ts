import type { FastifyInstance } from "fastify";
import type { Client } from "./base.js";
import type { Permission } from "./catalogue.js";
import { entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";

/*
 * Rapports stock et ventes, et commission des vendeurs.
 * Les valeurs de stock et les marges ne se montrent qu'avec stocks.valider ou facturation.administrer.
 * La commission est une proposition faite à la paie : elle n'entre jamais seule dans un bulletin,
 * et la paie ne remplace pas l'avis d'un expert agréé.
 */

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const MOIS = { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" } as const;
const JOUR = (col: string) => `(${col} at time zone 'Africa/Douala')::date`;

/** Commission d'un mois : le pourcentage s'applique seulement à ce qui dépasse l'objectif. */
export function commission(ventes: number, objectif: number, taux: number): number {
  return Math.round((Math.max(ventes - objectif, 0) * Math.round(taux * 100)) / 10_000);
}
/** Ventes TTC de caisse d'un vendeur sur une période, retours déduits à leur date. */
const VENTES_VENDEURS = `
  select x.vendeur_id, sum(x.montant)::int8 as ventes, sum(x.nombre)::int as nombre from (
    select coalesce(v.vendeur_id, v.caissier_id) as vendeur_id, v.total_ttc as montant, 1 as nombre
    from ventes_comptoir v where v.annulee_le is null and v.entite_id = any($1::uuid[]) and ${JOUR("coalesce(v.vendue_le, v.cree_le)")} between $2 and $3
    union all
    select coalesce(v.vendeur_id, v.caissier_id), -t.total_ttc, 0
    from retours_comptoir t join ventes_comptoir v on v.id = t.vente_id where t.entite_id = any($1::uuid[]) and ${JOUR("t.cree_le")} between $2 and $3
  ) x group by x.vendeur_id`;

export function enregistrerRapports(app: FastifyInstance, outils: Outils): void {
  const { protege, exigerSurEntite } = outils;

  const acces = async (ctx: Contexte, ...permissions: Permission[]) => {
    const vus = new Map<string, Record<string, unknown>>();
    for (const p of permissions) for (const e of await entitesAccessibles(ctx.client, ctx.utilisateurId, p)) vus.set(String(e.id), e);
    return [...vus.values()];
  };
  /** Restreint une liste d'entités au lieu choisi (avec ce qu'il contient) et à la branche choisie. */
  const filtrer = async (c: Client, ids: string[], entiteId?: string, brancheId?: string): Promise<string[]> => {
    if (!ids.length) return [];
    const { rows } = await c.query(
      `with recursive d as (select id from entites where id = $2 union select e.id from entites e join d on e.parent_id = d.id)
       select e.id from entites e where e.id = any($1::uuid[]) and ($2::uuid is null or e.id in (select id from d)) and ($3::uuid is null or coalesce(entite_branche(e.id), e.id) = $3)`,
      [ids, entiteId ?? null, brancheId ?? null],
    );
    return rows.map((r) => String(r.id));
  };
  const periode = (du?: string, au?: string) => {
    const aujourdhui = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
    const fin = au ?? aujourdhui, debut = du ?? `${fin.slice(0, 7)}-01`;
    if (fin < debut) throw new ErreurApi(400, "dates_invalides");
    return { du: debut, au: fin };
  };

  app.get<{ Querystring: { du?: string; au?: string; entiteId?: string; brancheId?: string } }>("/rapports/ventes-stock", {
    schema: { querystring: { type: "object", properties: { du: date, au: date, entiteId: uuid, brancheId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const q = req.query;
      const { du, au } = periode(q.du, q.au);
      const ids = (l: Record<string, unknown>[]) => l.map((e) => String(e.id));
      const [eVentes, eStock, eValeur, eClients, eFournisseurs] = [
        await acces(ctx, "caisse.superviser", "facturation.voir"), await acces(ctx, "stocks.voir"), await acces(ctx, "stocks.valider", "facturation.administrer"),
        await acces(ctx, "facturation.voir"), await acces(ctx, "achats.voir"),
      ];
      if (!eVentes.length && !eStock.length) throw new ErreurApi(403, "permission_refusee");
      const [ventes, stock, clients, fournisseurs] = [
        await filtrer(ctx.client, ids(eVentes), q.entiteId, q.brancheId), await filtrer(ctx.client, ids(eStock), q.entiteId, q.brancheId),
        await filtrer(ctx.client, ids(eClients), q.entiteId, q.brancheId), await filtrer(ctx.client, ids(eFournisseurs), q.entiteId, q.brancheId),
      ];
      const valeur = new Set(ids(eValeur));
      const c = ctx.client;
      const lieux = (await c.query(
        "select e.id, e.nom, coalesce(entite_branche(e.id), e.id) as branche_id from entites e where e.id = any($1::uuid[]) order by e.nom", [[...new Set([...ids(eVentes), ...ids(eStock)])]],
      )).rows;
      const branches = (await c.query("select id, nom from entites where id = any($1::uuid[]) order by nom", [[...new Set(lieux.map((l) => l.branche_id))]])).rows;

      // Lignes vendues en caisse sur la période, par lieu et par article, retours de la période déduits.
      const { rows: lignes } = await c.query(
        `select x.entite_id, x.produit_id, p.code, p.nom, p.unite, p.cout_moyen, sum(x.quantite)::float as quantite, sum(x.ht)::int8 as ht, sum(x.ttc)::int8 as ttc from (
           select v.entite_id, l.produit_id, l.quantite, l.montant_ht as ht, l.montant_ht + l.montant_taxes as ttc
           from lignes_comptoir l join ventes_comptoir v on v.id = l.vente_id
           where v.annulee_le is null and v.entite_id = any($1::uuid[]) and ${JOUR("coalesce(v.vendue_le, v.cree_le)")} between $2 and $3
           union all
           select t.entite_id, r.produit_id, -r.quantite, -r.montant_ht, -(r.montant_ht + r.montant_taxes)
           from lignes_retour_comptoir r join retours_comptoir t on t.id = r.retour_id where t.entite_id = any($1::uuid[]) and ${JOUR("t.cree_le")} between $2 and $3
         ) x join produits p on p.id = x.produit_id group by x.entite_id, x.produit_id, p.code, p.nom, p.unite, p.cout_moyen`, [ventes, du, au],
      );
      const parArticle = new Map<string, { code: string; nom: string; unite: string; quantite: number; montant: number; ht: number; cout: number | null }>();
      for (const l of lignes) {
        const a = parArticle.get(l.produit_id) ?? { code: l.code, nom: l.nom, unite: l.unite, quantite: 0, montant: 0, ht: 0, cout: 0 };
        a.quantite += l.quantite; a.montant += Number(l.ttc); a.ht += Number(l.ht);
        // Le coût n'entre dans le calcul que là où la personne a le droit de le voir ; sinon la marge reste masquée.
        a.cout = a.cout === null || !valeur.has(String(l.entite_id)) ? null : a.cout + Math.round(l.quantite * Number(l.cout_moyen));
        parArticle.set(l.produit_id, a);
      }
      const articles = [...parArticle.values()].map((a) => ({ ...a, quantite: Math.round(a.quantite * 1000) / 1000 }));
      const meilleures = [...articles].sort((a, b) => b.montant - a.montant).slice(0, 20).map(({ ht, cout, ...a }) => a);
      const marges = articles.filter((a) => a.cout !== null).map((a) => ({ code: a.code, nom: a.nom, quantite: a.quantite, ventes_ht: a.ht, cout: a.cout!, marge: a.ht - a.cout!, taux: a.ht ? Math.round(((a.ht - a.cout!) * 1000) / a.ht) / 10 : null }))
        .sort((a, b) => b.marge - a.marge).slice(0, 200);

      const ventesPar = async (colonne: string, jointure: string, nom: string) => (await c.query(
        `select ${nom} as nom, sum(x.montant)::int8 as ventes, sum(x.nombre)::int as nombre from (
           select v.id, v.entite_id, v.caissier_id, coalesce(v.vendeur_id, v.caissier_id) as vendeur_id, v.total_ttc as montant, 1 as nombre
           from ventes_comptoir v where v.annulee_le is null and v.entite_id = any($1::uuid[]) and ${JOUR("coalesce(v.vendue_le, v.cree_le)")} between $2 and $3
           union all
           select v.id, v.entite_id, v.caissier_id, coalesce(v.vendeur_id, v.caissier_id), -t.total_ttc, 0
           from retours_comptoir t join ventes_comptoir v on v.id = t.vente_id where t.entite_id = any($1::uuid[]) and ${JOUR("t.cree_le")} between $2 and $3
         ) x ${jointure} group by ${colonne}, ${nom} order by ventes desc limit 200`, [ventes, du, au],
      )).rows;

      const { rows: paiements } = await c.query(
        `select x.moyen, sum(x.montant)::int8 as montant from (
           select p.moyen, p.montant from paiements_comptoir p join ventes_comptoir v on v.id = p.vente_id
           where v.annulee_le is null and v.entite_id = any($1::uuid[]) and ${JOUR("coalesce(v.vendue_le, v.cree_le)")} between $2 and $3
           union all
           -- La monnaie rendue sort des espèces reçues.
           select 'especes', -v.rendu from ventes_comptoir v where v.annulee_le is null and v.rendu > 0 and v.entite_id = any($1::uuid[]) and ${JOUR("coalesce(v.vendue_le, v.cree_le)")} between $2 and $3
           union all
           select r.moyen, r.montant from reglements_comptoir r join ventes_comptoir v on v.id = r.vente_id where v.entite_id = any($1::uuid[]) and ${JOUR("r.encaisse_le")} between $2 and $3
           union all
           select x.moyen, -x.montant from remboursements_comptoir x join retours_comptoir t on t.id = x.retour_id where x.moyen <> 'credit' and t.entite_id = any($1::uuid[]) and ${JOUR("t.cree_le")} between $2 and $3
           union all
           select r.moyen, r.montant from reglements r join documents_vente d on d.id = r.facture_id where r.annule_le is null and d.entite_id = any($4::uuid[]) and ${JOUR("r.encaisse_le")} between $2 and $3
         ) x group by x.moyen order by montant desc`, [ventes, du, au, clients],
      );

      // Stock par lieu, à ce jour, et articles sous leur seuil d'alerte.
      const { rows: niveaux } = await c.query(
        `select m.entite_id, e.nom as entite, p.id as produit_id, p.code, p.nom, p.unite, p.seuil_alerte::float, p.cout_moyen, sum(m.quantite)::float as quantite
         from mouvements_stock m join produits p on p.id = m.produit_id join entites e on e.id = m.entite_id
         where m.entite_id = any($1::uuid[]) and p.suivi_stock group by m.entite_id, e.nom, p.id order by e.nom, p.nom limit 20000`, [stock],
      );
      const parLieu = new Map<string, { entite: string; articles: number; quantite: number; valeur: number | null }>();
      for (const n of niveaux) {
        const l = parLieu.get(n.entite_id) ?? { entite: n.entite, articles: 0, quantite: 0, valeur: valeur.has(String(n.entite_id)) ? 0 : null };
        if (n.quantite !== 0) l.articles += 1;
        l.quantite += n.quantite;
        if (l.valeur !== null) l.valeur += Math.round(n.quantite * Number(n.cout_moyen));
        parLieu.set(n.entite_id, l);
      }
      const alertes = niveaux.filter((n) => n.quantite <= n.seuil_alerte).map((n) => ({ entite: n.entite, code: n.code, nom: n.nom, unite: n.unite, quantite: n.quantite, seuil: n.seuil_alerte })).slice(0, 500);

      const { rows: restesClients } = await c.query(
        `select t.nom, t.telephone, sum(x.reste)::int8 as reste from (
           select d.tiers_id, d.total_ttc - (select coalesce(sum(r.montant), 0) from reglements r where r.facture_id = d.id and r.annule_le is null)
             - (select coalesce(sum(a.total_ttc), 0) from documents_vente a where a.origine_id = d.id and a.type = 'avoir' and a.statut = 'emis') as reste
           from documents_vente d where d.type = 'facture' and d.statut = 'emis' and d.entite_id = any($1::uuid[])
           union all
           select v.tiers_id, reste_credit_comptoir(v.id) from ventes_comptoir v where v.annulee_le is null and v.reste_du > 0 and v.entite_id = any($2::uuid[])
         ) x join tiers t on t.id = x.tiers_id where x.reste > 0 group by t.id, t.nom, t.telephone order by reste desc limit 200`, [clients, ventes],
      );
      const { rows: restesFournisseurs } = await c.query(
        `select t.nom, t.telephone, sum(x.reste)::int8 as reste from (
           select f.fournisseur_id, f.total_ttc - (select coalesce(sum(p.montant), 0) from paiements_fournisseur p where p.facture_id = f.id and p.annule_le is null) as reste
           from factures_fournisseur f where f.statut = 'validee' and f.entite_id = any($1::uuid[])
         ) x join tiers t on t.id = x.fournisseur_id where x.reste > 0 group by t.id, t.nom, t.telephone order by reste desc limit 200`, [fournisseurs],
      );
      return {
        du, au, lieux: lieux.map((l) => ({ id: l.id, nom: l.nom })), branches,
        voit_valeurs: [...parLieu.values()].some((l) => l.valeur !== null) || marges.length > 0,
        meilleures_ventes: meilleures,
        ventes_par_vendeur: await ventesPar("x.vendeur_id", "join utilisateurs u on u.id = x.vendeur_id", "u.nom"),
        ventes_par_caissier: await ventesPar("x.caissier_id", "join utilisateurs u on u.id = x.caissier_id", "u.nom"),
        ventes_par_lieu: await ventesPar("x.entite_id", "join entites u on u.id = x.entite_id", "u.nom"),
        paiements_par_moyen: paiements, stock_par_lieu: [...parLieu.values()].map((l) => ({ ...l, quantite: Math.round(l.quantite * 1000) / 1000 })), alertes, marges,
        restes_clients: restesClients, restes_fournisseurs: restesFournisseurs,
      };
    }),
  );

  // ---------- Commission des vendeurs ----------
  /** Objectif mensuel de ventes et pourcentage au delà : réglés sur la fiche employé par les ressources humaines. */
  app.put<{ Params: { id: string }; Body: { objectifVentes: number | null; tauxCommission: number | null } }>("/employes/:id/commission", {
    schema: {
      params: paramId,
      body: { type: "object", required: ["objectifVentes", "tauxCommission"], properties: { objectifVentes: { type: ["integer", "null"], minimum: 0, maximum: 1_000_000_000_000 }, tauxCommission: { type: ["number", "null"], minimum: 0, maximum: 100, multipleOf: 0.01 } } },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [e] } = await ctx.client.query("select entite_id from employes where id = $1", [req.params.id]);
      if (!e) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "rh.gerer", e.entite_id);
      return (await ctx.client.query("update employes set objectif_ventes = $2, taux_commission = $3 where id = $1 returning id, objectif_ventes, taux_commission::float",
        [req.params.id, req.body.objectifVentes, req.body.tauxCommission])).rows[0];
    }),
  );

  /** Les vendeurs d'un mois : ventes, objectif, commission calculée, et ce qui a déjà été proposé à la paie. */
  const commissionsDuMois = async (ctx: Contexte, mois: string, entiteId?: string) => {
    const visibles = await filtrer(ctx.client, (await acces(ctx, "caisse.superviser")).map((e) => String(e.id)), entiteId);
    if (!visibles.length) throw new ErreurApi(403, "permission_refusee");
    const du = `${mois}-01`;
    const { rows: [{ au }] } = await ctx.client.query("select (($1::date + interval '1 month') - interval '1 day')::date::text as au", [du]);
    const { rows } = await ctx.client.query(
      `with v as (${VENTES_VENDEURS})
       select e.id as employe_id, e.nom, e.poste, x.nom as entite, e.objectif_ventes, e.taux_commission::float, coalesce(v.ventes, 0)::int8 as ventes, coalesce(v.nombre, 0)::int as nombre,
         k.montant as propose, k.propose_le
       from employes e join entites x on x.id = e.entite_id left join v on v.vendeur_id = e.utilisateur_id
       left join commissions_proposees k on k.employe_id = e.id and k.periode = $4
       where e.entite_id = any($1::uuid[]) and (e.date_sortie is null or e.date_sortie >= $2) and (v.vendeur_id is not null or e.taux_commission is not null)
       order by ventes desc, e.nom limit 500`, [visibles, du, au, mois],
    );
    return rows.map((r) => {
      const regle = r.taux_commission !== null && r.objectif_ventes !== null;
      const montant = regle ? commission(Number(r.ventes), Number(r.objectif_ventes), r.taux_commission) : null;
      return { ...r, ventes: Number(r.ventes), objectif_ventes: r.objectif_ventes === null ? null : Number(r.objectif_ventes), commission: montant, propose: r.propose === null ? null : Number(r.propose) };
    });
  };
  app.get<{ Querystring: { mois: string; entiteId?: string } }>("/rapports/commissions", {
    schema: { querystring: { type: "object", required: ["mois"], properties: { mois: MOIS, entiteId: uuid } } },
  }, async (req) => protege(req, async (ctx) => ({ mois: req.query.mois, vendeurs: await commissionsDuMois(ctx, req.query.mois, req.query.entiteId) })));

  /** Propose à la paie la commission calculée. La paie reste libre de la reprendre, de la changer ou de l'écarter. */
  app.post<{ Body: { employeId: string; mois: string } }>("/rapports/commissions/propositions", {
    schema: { body: { type: "object", required: ["employeId", "mois"], properties: { employeId: uuid, mois: MOIS } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const { rows: [e] } = await ctx.client.query("select entite_id from employes where id = $1", [req.body.employeId]);
      if (!e) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "caisse.superviser", e.entite_id);
      const ligne = (await commissionsDuMois(ctx, req.body.mois, e.entite_id)).find((x) => x.employe_id === req.body.employeId);
      if (!ligne || ligne.commission === null) throw new ErreurApi(409, "commission_non_reglee");
      return (await ctx.client.query(
        `insert into commissions_proposees (organisation_id, employe_id, periode, ventes, objectif, taux, montant, propose_par) values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (organisation_id, employe_id, periode) do update set ventes = excluded.ventes, objectif = excluded.objectif, taux = excluded.taux, montant = excluded.montant, propose_par = excluded.propose_par, propose_le = now()
         returning employe_id, periode, ventes, objectif, taux::float, montant`,
        [ctx.organisationId, req.body.employeId, req.body.mois, ligne.ventes, ligne.objectif_ventes, ligne.taux_commission, ligne.commission, ctx.utilisateurId],
      )).rows[0];
    });
    return reponse.status(201).send(r);
  });
  /** Ce que la paie peut reprendre, si elle le décide, comme élément variable d'un bulletin. */
  app.get<{ Querystring: { mois: string } }>("/paie/commissions-proposees", { schema: { querystring: { type: "object", required: ["mois"], properties: { mois: MOIS } } } }, async (req) =>
    protege(req, async (ctx) => {
      const ids = (await acces(ctx, "rh.paie")).map((e) => String(e.id));
      if (!ids.length) throw new ErreurApi(403, "permission_refusee");
      return (await ctx.client.query(
        `select k.employe_id, e.nom, e.poste, x.nom as entite, k.periode, k.ventes, k.objectif, k.taux::float, k.montant, k.propose_le, u.nom as propose_par
         from commissions_proposees k join employes e on e.id = k.employe_id join entites x on x.id = e.entite_id join utilisateurs u on u.id = k.propose_par
         where k.periode = $1 and e.entite_id = any($2::uuid[]) order by e.nom`, [req.query.mois, ids],
      )).rows;
    }),
  );
}
