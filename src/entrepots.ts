import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { dansOrganisation, type Client } from "./base.js";
import { aPermissionSurEntite, entitesAccessibles } from "./permissions.js";
import { heureDouala, notifier, titulaires } from "./performance.js";
import { ErreurApi, type Contexte, type Outils, type TachePlanifiee } from "./serveur.js";
import { niveau, produitSuivi, sortirDuStock } from "./stocks.js";

/*
 * Entrepôts et magasins de GLOMARI : état du stock par lieu (quantité, pièces, valeur), catégories et
 * sous-catégories d'articles, unités et types de colis, articles avariés, dates d'expiration.
 * GTA n'a pas de stock : tout se vérifie sur des entités où le module de stock est actif.
 */

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max: number, min = 1) => ({ type: "string", minLength: min, maxLength: max }) as const;
const JOUR = "(now() at time zone 'Africa/Douala')::date";

/** Listes proposées à la saisie. Une autre valeur reste permise : la liste aide, elle ne bloque pas. */
export const UNITES_MESURE = ["pièce", "kilogramme", "gramme", "litre", "mètre", "colis", "carton", "ballot", "sac", "paquet", "boîte", "bouteille", "bidon", "palette", "douzaine"];
export const TYPES_COLIS = ["carton", "ballot", "sac", "caisse", "palette", "fût", "bidon", "paquet", "vrac"];
/** Un lot est signalé 30 jours avant sa date d'expiration, puis en rouge une fois la date passée. */
export const JOURS_ALERTE_EXPIRATION = 30;

const brancheDe = async (c: Client, entiteId: string): Promise<string> => (await c.query("select coalesce(entite_branche($1), $1) as b", [entiteId])).rows[0].b;

/** Chaque matin : les lots périmés ou bientôt périmés sont signalés une fois à ceux qui gèrent le stock du lieu. */
export async function signalerExpirations(c: Client): Promise<number> {
  const { rows } = await c.query(
    `select l.id, l.entite_id, l.numero, l.peremption::text, l.quantite::float, p.nom as produit, e.nom as entite, l.peremption < ${JOUR} as perime
     from lots_produit l join produits p on p.id = l.produit_id join entites e on e.id = l.entite_id
     where l.quantite > 0 and l.peremption <= ${JOUR} + ${JOURS_ALERTE_EXPIRATION} order by l.peremption limit 2000`,
  );
  for (const l of rows) {
    const qui = await titulaires(c, ["stocks.gerer"], l.entite_id);
    const quand = l.peremption.split("-").reverse().join("/");
    if (l.perime) await notifier(c, qui, `lot-perime-${l.id}`, `Article expiré : ${l.produit}, lot ${l.numero}, ${l.quantite} restant(s) à ${l.entite} (date dépassée : ${quand}).`, "urgent");
    else await notifier(c, qui, `lot-bientot-${l.id}`, `Expiration proche : ${l.produit}, lot ${l.numero}, ${l.quantite} restant(s) à ${l.entite}, le ${quand}.`, "important");
  }
  return rows.length;
}

export function enregistrerEntrepots(app: FastifyInstance, pool: pg.Pool, outils: Outils, taches: TachePlanifiee[]): void {
  const { protege, exiger, exigerSurEntite } = outils;

  const exigerStock = async (ctx: Contexte, entiteId: string) => {
    const { rows } = await ctx.client.query("select actif from modules_entite where entite_id = $1 and module = 'achats_stocks'", [entiteId]);
    if (!rows[0]?.actif) throw new ErreurApi(409, "module_inactif");
  };
  /** Les branches où la personne voit le stock ou gère le catalogue. */
  const branchesVisibles = async (ctx: Contexte): Promise<string[]> => {
    const ids = [...await entitesAccessibles(ctx.client, ctx.utilisateurId, "stocks.voir"), ...await entitesAccessibles(ctx.client, ctx.utilisateurId, "catalogue.gerer")].map((e) => e.id);
    if (!ids.length) throw new ErreurApi(403, "permission_refusee");
    return (await ctx.client.query("select distinct coalesce(entite_branche(id), id) as b from entites where id = any($1::uuid[])", [ids])).rows.map((r) => String(r.b));
  };

  app.get("/entrepots/references", async (req) => protege(req, async (ctx) => { await branchesVisibles(ctx); return { unites: UNITES_MESURE, typesColis: TYPES_COLIS, joursAlerte: JOURS_ALERTE_EXPIRATION }; }));

  // ---------- Catégories et sous-catégories ----------
  app.get("/categories-articles", async (req) =>
    protege(req, async (ctx) => (await ctx.client.query(
      `select c.id, c.branche_id, b.nom as branche, c.parent_id, c.nom, c.actif,
         (select count(*) from produits p where p.categorie_id = c.id or p.categorie_id in (select s.id from categories_articles s where s.parent_id = c.id))::int as articles
       from categories_articles c join entites b on b.id = c.branche_id where c.branche_id = any($1::uuid[]) order by b.nom, c.parent_id is not null, lower(c.nom) limit 2000`,
      [await branchesVisibles(ctx)],
    )).rows),
  );
  app.post<{ Body: { entiteId: string; nom: string; parentId?: string } }>("/categories-articles", {
    schema: { body: { type: "object", required: ["entiteId", "nom"], properties: { entiteId: uuid, nom: texte(100), parentId: uuid } } },
  }, async (req, reponse) => {
    const c = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "catalogue.gerer", b.entiteId);
      const branche = await brancheDe(ctx.client, b.entiteId);
      await exigerStock(ctx, branche);
      if (b.parentId) {
        const { rows: [p] } = await ctx.client.query("select branche_id, parent_id from categories_articles where id = $1", [b.parentId]);
        if (!p || p.branche_id !== branche) throw new ErreurApi(404, "introuvable");
        if (p.parent_id) throw new ErreurApi(409, "categorie_trop_profonde");
      }
      const { rows: [deja] } = await ctx.client.query(
        "select 1 from categories_articles where branche_id = $1 and parent_id is not distinct from $2 and lower(nom) = lower($3)", [branche, b.parentId ?? null, b.nom.trim()],
      );
      if (deja) throw new ErreurApi(409, "categorie_existante");
      return (await ctx.client.query(
        "insert into categories_articles (organisation_id, branche_id, parent_id, nom) values ($1, $2, $3, $4) returning id, branche_id, parent_id, nom, actif",
        [ctx.organisationId, branche, b.parentId ?? null, b.nom.trim()],
      )).rows[0];
    });
    return reponse.status(201).send(c);
  });
  app.patch<{ Params: { id: string }; Body: { nom?: string; actif?: boolean } }>("/categories-articles/:id", {
    schema: { params: paramId, body: { type: "object", minProperties: 1, properties: { nom: texte(100), actif: { type: "boolean" } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [c] } = await ctx.client.query("select branche_id, parent_id from categories_articles where id = $1", [req.params.id]);
      if (!c) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "catalogue.gerer", c.branche_id);
      if (req.body.nom) {
        const { rows: [deja] } = await ctx.client.query(
          "select 1 from categories_articles where branche_id = $1 and parent_id is not distinct from $2 and lower(nom) = lower($3) and id <> $4", [c.branche_id, c.parent_id, req.body.nom.trim(), req.params.id],
        );
        if (deja) throw new ErreurApi(409, "categorie_existante");
      }
      return (await ctx.client.query("update categories_articles set nom = coalesce($2, nom), actif = coalesce($3, actif) where id = $1 returning id, nom, actif", [req.params.id, req.body.nom?.trim() ?? null, req.body.actif ?? null])).rows[0];
    }),
  );

  /** Classement d'un article : catégorie, unité de mesure, type de colis, pièces par unité. */
  app.put<{ Params: { id: string }; Body: { categorieId?: string | null; marqueId?: string | null; unite?: string; typeColis?: string | null; piecesParUnite?: number } }>("/produits/:id/classement", {
    schema: {
      params: paramId,
      body: {
        type: "object", minProperties: 1,
        properties: { categorieId: { type: ["string", "null"], format: "uuid" }, marqueId: { type: ["string", "null"], format: "uuid" }, unite: texte(30), typeColis: { type: ["string", "null"], maxLength: 40 }, piecesParUnite: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000 } },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [p] } = await ctx.client.query("select entite_id from produits where id = $1", [req.params.id]);
      if (!p) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "catalogue.gerer", p.entite_id);
      const b = req.body;
      if (b.categorieId) {
        const { rows: [c] } = await ctx.client.query("select branche_id from categories_articles where id = $1 and actif", [b.categorieId]);
        if (!c || c.branche_id !== await brancheDe(ctx.client, p.entite_id)) throw new ErreurApi(409, "categorie_autre_branche");
      }
      if (b.marqueId) {
        const { rows: [m] } = await ctx.client.query("select branche_id from marques where id = $1 and actif", [b.marqueId]);
        if (!m || m.branche_id !== await brancheDe(ctx.client, p.entite_id)) throw new ErreurApi(409, "marque_autre_branche");
      }
      return (await ctx.client.query(
        `update produits set categorie_id = case when $2::boolean then $3::uuid else categorie_id end, unite = coalesce($4, unite),
           type_colis = case when $5::boolean then nullif($6, '') else type_colis end, pieces_par_unite = coalesce($7, pieces_par_unite),
           marque_id = case when $8::boolean then $9::uuid else marque_id end
         where id = $1 returning id, categorie_id, marque_id, unite, type_colis, pieces_par_unite::float`,
        [req.params.id, b.categorieId !== undefined, b.categorieId ?? null, b.unite?.trim() ?? null, b.typeColis !== undefined, b.typeColis?.trim() ?? null, b.piecesParUnite ?? null, b.marqueId !== undefined, b.marqueId ?? null],
      )).rows[0];
    }),
  );

  // ---------- État du stock par entrepôt ----------
  app.get<{ Querystring: { entiteId?: string; categorieId?: string; marqueId?: string; q?: string; du?: string; au?: string; etat?: string } }>("/entrepots/etat", {
    schema: {
      querystring: {
        type: "object",
        properties: { entiteId: uuid, categorieId: uuid, marqueId: uuid, q: { type: "string", maxLength: 100 }, du: date, au: date, etat: { type: "string", enum: ["alerte", "avarie", "perime", "expire"] } },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "stocks.voir");
      const q = req.query;
      const aujourdhui = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
      const au = q.au ?? aujourdhui;
      const du = q.du ?? `${au.slice(0, 7)}-01`;
      if (au < du) throw new ErreurApi(400, "dates_invalides");
      const acces = await entitesAccessibles(ctx.client, ctx.utilisateurId, "stocks.voir");
      let lieux = acces.map((e) => String(e.id));
      if (q.entiteId) {
        // Le lieu choisi et ce qu'il contient, dans la limite de ce que la personne voit.
        const garde = new Set<string>();
        const ajouter = (id: string) => { if (!lieux.includes(id) || garde.has(id)) return; garde.add(id); for (const e of acces) if (e.parent_id === id) ajouter(String(e.id)); };
        ajouter(q.entiteId);
        lieux = [...garde];
      }
      // La valeur se calcule au coût de revient : réservée à qui valide le stock ou administre la facturation.
      const voitValeur = new Set([...await entitesAccessibles(ctx.client, ctx.utilisateurId, "stocks.valider"), ...await entitesAccessibles(ctx.client, ctx.utilisateurId, "facturation.administrer")].map((e) => String(e.id)));
      const motif = `%${(q.q ?? "").replace(/[\\%_]/g, "\\$&")}%`;
      const { rows } = await ctx.client.query(
        `with m as (
           select entite_id, produit_id,
             coalesce(sum(quantite) filter (where (cree_le at time zone 'Africa/Douala')::date <= $3), 0)::float as quantite,
             coalesce(sum(quantite) filter (where quantite > 0 and (cree_le at time zone 'Africa/Douala')::date between $2 and $3), 0)::float as entrees,
             coalesce(sum(-quantite) filter (where quantite < 0 and (cree_le at time zone 'Africa/Douala')::date between $2 and $3), 0)::float as sorties
           from mouvements_stock where entite_id = any($1::uuid[]) group by entite_id, produit_id)
         select m.entite_id, e.nom as entite, e.type as type_lieu, p.id as produit_id, p.code, p.nom, p.unite, p.type_colis, p.pieces_par_unite::float, p.seuil_alerte::float, p.cout_moyen,
           m.quantite, m.entrees, m.sorties, p.marque_id, (select x.nom from marques x where x.id = p.marque_id) as marque,
           c.id as categorie_id, coalesce(cp.nom, c.nom) as categorie, case when cp.id is null then null else c.nom end as sous_categorie, coalesce(cp.id, c.id) as categorie_racine,
           coalesce((select sum(a.quantite) from avaries a where a.entite_id = m.entite_id and a.produit_id = p.id and a.statut = 'constatee'), 0)::float as avarie,
           coalesce((select sum(l.quantite) from lots_produit l where l.entite_id = m.entite_id and l.produit_id = p.id and l.quantite > 0 and l.peremption < ${JOUR}), 0)::float as perime,
           (select min(l.peremption)::text from lots_produit l where l.entite_id = m.entite_id and l.produit_id = p.id and l.quantite > 0) as expiration,
           (select (min(l.peremption) - ${JOUR})::int from lots_produit l where l.entite_id = m.entite_id and l.produit_id = p.id and l.quantite > 0) as jours_restants
         from m join produits p on p.id = m.produit_id join entites e on e.id = m.entite_id
         left join categories_articles c on c.id = p.categorie_id left join categories_articles cp on cp.id = c.parent_id
         where (p.nom ilike $4 or p.code ilike $4) and ($5::uuid is null or c.id = $5 or cp.id = $5) and ($6::uuid is null or p.marque_id = $6)
         order by e.nom, coalesce(cp.nom, c.nom) nulls last, p.nom limit 5000`,
        [lieux, du, au, motif, q.categorieId ?? null, q.marqueId ?? null],
      );
      const lignes = rows.map((r) => {
        const etat = r.perime > 0 ? "perime" : r.jours_restants !== null && r.jours_restants <= JOURS_ALERTE_EXPIRATION ? "expire" : null;
        const { cout_moyen, ...reste } = r;
        return {
          ...reste, pieces: Math.round(r.quantite * r.pieces_par_unite * 1000) / 1000, en_alerte: r.quantite <= r.seuil_alerte, expiration_etat: etat,
          valeur: voitValeur.has(r.entite_id) ? Math.round(r.quantite * Number(cout_moyen)) : null,
        };
      }).filter((r) => !q.etat || (q.etat === "alerte" ? r.en_alerte : q.etat === "avarie" ? r.avarie > 0 : q.etat === "perime" ? r.perime > 0 : r.expiration_etat !== null));

      type Total = { articles: number; quantite: number; pieces: number; valeur: number | null; avarie: number; perime: number };
      const cumuler = <K extends string>(cle: (r: (typeof lignes)[number]) => K | null, libelle: (r: (typeof lignes)[number]) => Record<string, unknown>) => {
        const m = new Map<string, Total & Record<string, unknown>>();
        for (const r of lignes) {
          const k = cle(r);
          if (k === null) continue;
          const t = m.get(k) ?? { ...libelle(r), articles: 0, quantite: 0, pieces: 0, valeur: r.valeur === null ? null : 0, avarie: 0, perime: 0 };
          if (r.quantite !== 0) t.articles += 1;
          t.quantite += r.quantite; t.pieces += r.pieces; t.avarie += r.avarie; t.perime += r.perime;
          t.valeur = t.valeur === null || r.valeur === null ? null : t.valeur + r.valeur;
          m.set(k, t);
        }
        return [...m.values()].map((t) => ({ ...t, quantite: Math.round(t.quantite * 1000) / 1000, pieces: Math.round(t.pieces * 1000) / 1000 }));
      };
      return {
        du, au, lignes,
        entrepots: cumuler((r) => r.entite_id, (r) => ({ entite_id: r.entite_id, entite: r.entite, type_lieu: r.type_lieu })),
        // Par catégorie : chaque article compte une fois par lieu où il se trouve.
        categories: cumuler((r) => `${r.categorie_racine ?? ""}|${r.sous_categorie ?? ""}`, (r) => ({ categorie: r.categorie ?? "Sans catégorie", sous_categorie: r.sous_categorie })),
        colis: cumuler((r) => `${r.entite_id}|${r.type_colis ?? ""}`, (r) => ({ entite: r.entite, type_colis: r.type_colis ?? "Non précisé" })),
      };
    }),
  );

  // ---------- Articles avariés ----------
  app.post<{ Body: { entiteId: string; produitId: string; quantite: number; motif: string } }>("/avaries", {
    schema: { body: { type: "object", required: ["entiteId", "produitId", "quantite", "motif"], properties: { entiteId: uuid, produitId: uuid, quantite: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000_000, multipleOf: 0.001 }, motif: texte(500, 3) } } },
  }, async (req, reponse) => {
    const a = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "stocks.gerer", b.entiteId);
      await exigerStock(ctx, b.entiteId);
      await produitSuivi(ctx.client, b.produitId);
      const { rows: [deja] } = await ctx.client.query("select coalesce(sum(quantite), 0)::float as q from avaries where entite_id = $1 and produit_id = $2 and statut = 'constatee'", [b.entiteId, b.produitId]);
      const sain = (await niveau(ctx.client, b.entiteId, b.produitId)) - deja.q;
      if (b.quantite > sain) throw new ErreurApi(409, "stock_insuffisant", { produitId: b.produitId, disponible: sain });
      return (await ctx.client.query(
        "insert into avaries (organisation_id, entite_id, produit_id, quantite, motif, auteur_id) values ($1, $2, $3, $4, $5, $6) returning id, quantite::float, statut",
        [ctx.organisationId, b.entiteId, b.produitId, b.quantite, b.motif.trim(), ctx.utilisateurId],
      )).rows[0];
    });
    return reponse.status(201).send(a);
  });
  app.get<{ Querystring: { statut?: string } }>("/avaries", {
    schema: { querystring: { type: "object", properties: { statut: { type: "string", enum: ["constatee", "sortie", "remise"] } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "stocks.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "stocks.voir")).map((e) => e.id);
      return (await ctx.client.query(
        `select a.id, a.entite_id, e.nom as entite, a.produit_id, p.nom as produit, p.unite, a.quantite::float, a.motif, a.statut, a.note, a.cree_le, a.decide_le, u.nom as auteur, d.nom as decide_par
         from avaries a join entites e on e.id = a.entite_id join produits p on p.id = a.produit_id join utilisateurs u on u.id = a.auteur_id left join utilisateurs d on d.id = a.decide_par
         where a.entite_id = any($1::uuid[]) and ($2::text is null or a.statut = $2) order by a.statut <> 'constatee', a.cree_le desc limit 500`,
        [ids, req.query.statut ?? null],
      )).rows;
    }),
  );
  /** Sortie : l'article quitte le stock en perte. Remise : il redevient vendable. */
  app.post<{ Params: { id: string }; Body: { decision: "sortie" | "remise"; note?: string } }>("/avaries/:id/decision", {
    schema: { params: paramId, body: { type: "object", required: ["decision"], properties: { decision: { type: "string", enum: ["sortie", "remise"] }, note: texte(500, 0) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [a] } = await ctx.client.query("select id, entite_id, produit_id, quantite::float, motif, statut from avaries where id = $1 for update", [req.params.id]);
      if (!a) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "stocks.gerer", a.entite_id);
      if (a.statut !== "constatee") throw new ErreurApi(409, "deja_decide");
      await ctx.client.query("update avaries set statut = $2, decide_par = $3, decide_le = now(), note = $4 where id = $1", [a.id, req.body.decision, ctx.utilisateurId, req.body.note?.trim() || null]);
      let valeur = 0;
      if (req.body.decision === "sortie") {
        const p = await produitSuivi(ctx.client, a.produit_id);
        await sortirDuStock(ctx, a.entite_id, a.produit_id, a.quantite, "sortie", `Avarie : ${a.motif}`, null);
        valeur = Math.round(a.quantite * Number(p.cout_moyen));
      }
      return { statut: req.body.decision, valeur };
    }),
  );

  taches.push((org) => dansOrganisation(pool, org, async (c) => { if (heureDouala() >= 7) await signalerExpirations(c); }));
}

/** Vrai si la personne peut constater ou valider le stock de ce lieu : sert à l'import des quantités. */
export const peutValiderStock = (c: Client, utilisateurId: string, entiteId: string) => aPermissionSurEntite(c, utilisateurId, "stocks.valider", entiteId);
