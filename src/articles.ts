import type { FastifyInstance } from "fastify";
import type { Client } from "./base.js";
import type { Permission } from "./catalogue.js";
import { prochainNumero } from "./formations.js";
import { lireImage } from "./images.js";
import { entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";

/*
 * Catalogue complet des articles : marques, photos, unités de vente et codes-barres.
 * Tout vit sur la fiche commune de l'article (table produits) : la caisse, les achats, la facturation
 * et le module Stocks lisent la même information.
 */

const uuid = { type: "string", format: "uuid" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max: number, min = 1) => ({ type: "string", minLength: min, maxLength: max }) as const;
export const PHOTOS_MAX = 4;
export const PHOTO_OCTETS_MAX = 512 * 1024;
/** Préfixe GS1 réservé à l'usage interne d'un magasin (200 à 299) : ces codes ne valent pas hors de l'entreprise. */
export const PREFIXE_EAN_INTERNE = "200";

// ---------- Codes-barres ----------
/** Clé de contrôle d'un EAN13, à partir de ses 12 premiers chiffres. */
export function cleEan13(douze: string): number {
  const somme = [...douze].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0);
  return (10 - (somme % 10)) % 10;
}
export const ean13Valide = (code: string) => /^\d{13}$/.test(code) && cleEan13(code.slice(0, 12)) === Number(code[12]);
/** Nouveau code EAN13 interne, unique dans l'organisation. */
export async function genererEan13(c: Client): Promise<string> {
  for (let essai = 0; essai < 50; essai += 1) {
    const n = Number((await prochainNumero(c, "EAN")).split("-")[1]);
    const douze = `${PREFIXE_EAN_INTERNE}${String(n).padStart(9, "0")}`;
    const code = `${douze}${cleEan13(douze)}`;
    if (!(await c.query("select 1 from produits where code_barres = $1", [code])).rows[0]) return code;
  }
  throw new ErreurApi(409, "code_barres_indisponible");
}

// ---------- Unités de vente ----------
export interface UniteVente { nom: string; facteur: number; prix: number | null; base: boolean }
type ArticleUnites = { unite: string; pieces_par_unite: number | string; conditionnements: { nom: string; facteur: number; prix?: number | null }[] | null; prix_piece: number | string | null };
const memeNom = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/**
 * Les unités dans lesquelles un article se vend ou s'achète. Le stock bouge toujours dans l'unité de base :
 * le facteur dit combien d'unités de base vaut une unité choisie (carton de 12 : 12 ; pièce d'un carton de 24 : 1/24).
 * Sans prix propre, le prix d'une unité se calcule depuis le prix de base.
 */
export function unitesArticle(p: ArticleUnites): UniteVente[] {
  const unites: UniteVente[] = [{ nom: p.unite, facteur: 1, prix: null, base: true }];
  for (const c of p.conditionnements ?? []) {
    if (!(Number(c.facteur) > 0) || unites.some((u) => memeNom(u.nom, c.nom))) continue;
    unites.push({ nom: c.nom, facteur: Number(c.facteur), prix: c.prix ?? null, base: false });
  }
  const pieces = Number(p.pieces_par_unite);
  if (pieces > 1 && !unites.some((u) => memeNom(u.nom, "pièce"))) unites.push({ nom: "pièce", facteur: 1 / pieces, prix: p.prix_piece === null ? null : Number(p.prix_piece), base: false });
  return unites;
}
/** L'unité demandée pour cet article ; sans demande, l'unité de base. */
export function choisirUnite(p: ArticleUnites, nom: string | undefined): UniteVente {
  const unites = unitesArticle(p);
  if (!nom) return unites[0]!;
  const u = unites.find((x) => memeNom(x.nom, nom));
  if (!u) throw new ErreurApi(400, "unite_inconnue", { unites: unites.map((x) => x.nom) });
  return u;
}
/** Quantité dans l'unité de base, au millième. */
export const enUniteDeBase = (quantite: number, u: UniteVente) => Math.round(quantite * u.facteur * 1000) / 1000;

export function enregistrerArticles(app: FastifyInstance, outils: Outils): void {
  const { protege, exigerSurEntite } = outils;

  const article = async (ctx: Contexte, id: string) => {
    const { rows: [p] } = await ctx.client.query("select id, entite_id, type, code_barres, unite, pieces_par_unite, conditionnements, prix_piece, prix_vente from produits where id = $1", [id]);
    if (!p) throw new ErreurApi(404, "introuvable");
    return p;
  };
  const brancheDe = async (c: Client, entiteId: string): Promise<string> => (await c.query("select coalesce(entite_branche($1), $1) as b", [entiteId])).rows[0].b;
  /** Les branches où la personne travaille avec les articles : catalogue, stock, facturation ou caisse. */
  const branchesArticles = async (ctx: Contexte): Promise<string[]> => {
    const ids: unknown[] = [];
    for (const p of ["catalogue.gerer", "stocks.voir", "facturation.voir", "caisse.vendre"] as Permission[]) ids.push(...(await entitesAccessibles(ctx.client, ctx.utilisateurId, p)).map((e) => e.id));
    if (!ids.length) throw new ErreurApi(403, "permission_refusee");
    return (await ctx.client.query("select distinct coalesce(entite_branche(id), id) as b from entites where id = any($1::uuid[])", [ids])).rows.map((r) => String(r.b));
  };
  const exigerStock = async (ctx: Contexte, entiteId: string) => {
    const { rows } = await ctx.client.query("select actif from modules_entite where entite_id = $1 and module = 'achats_stocks'", [entiteId]);
    if (!rows[0]?.actif) throw new ErreurApi(409, "module_inactif");
  };

  // ---------- Marques ----------
  app.get("/marques", async (req) =>
    protege(req, async (ctx) => (await ctx.client.query(
      `select m.id, m.branche_id, b.nom as branche, m.nom, m.actif, (select count(*) from produits p where p.marque_id = m.id)::int as articles
       from marques m join entites b on b.id = m.branche_id where m.branche_id = any($1::uuid[]) order by b.nom, lower(m.nom) limit 2000`,
      [await branchesArticles(ctx)],
    )).rows),
  );
  app.post<{ Body: { entiteId: string; nom: string } }>("/marques", {
    schema: { body: { type: "object", required: ["entiteId", "nom"], properties: { entiteId: uuid, nom: texte(100) } } },
  }, async (req, reponse) => {
    const m = await protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "catalogue.gerer", req.body.entiteId);
      const branche = await brancheDe(ctx.client, req.body.entiteId);
      // GTA ne gère pas de stock : pas de marques d'articles.
      await exigerStock(ctx, branche);
      if ((await ctx.client.query("select 1 from marques where branche_id = $1 and lower(nom) = lower($2)", [branche, req.body.nom.trim()])).rows[0]) throw new ErreurApi(409, "marque_existante");
      return (await ctx.client.query("insert into marques (organisation_id, branche_id, nom) values ($1, $2, $3) returning id, branche_id, nom, actif", [ctx.organisationId, branche, req.body.nom.trim()])).rows[0];
    });
    return reponse.status(201).send(m);
  });
  app.patch<{ Params: { id: string }; Body: { nom?: string; actif?: boolean } }>("/marques/:id", {
    schema: { params: paramId, body: { type: "object", minProperties: 1, properties: { nom: texte(100), actif: { type: "boolean" } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [m] } = await ctx.client.query("select branche_id from marques where id = $1", [req.params.id]);
      if (!m) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "catalogue.gerer", m.branche_id);
      if (req.body.nom && (await ctx.client.query("select 1 from marques where branche_id = $1 and lower(nom) = lower($2) and id <> $3", [m.branche_id, req.body.nom.trim(), req.params.id])).rows[0]) throw new ErreurApi(409, "marque_existante");
      return (await ctx.client.query("update marques set nom = coalesce($2, nom), actif = coalesce($3, actif) where id = $1 returning id, nom, actif", [req.params.id, req.body.nom?.trim() ?? null, req.body.actif ?? null])).rows[0];
    }),
  );

  // ---------- Unités de vente ----------
  /** Conditionnements (nom, nombre d'unités de base, prix facultatif) et prix de la pièce. Un prix vide se calcule. */
  app.put<{ Params: { id: string }; Body: { conditionnements: { nom: string; facteur: number; prix?: number | null }[]; prixPiece?: number | null } }>("/produits/:id/unites", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["conditionnements"],
        properties: {
          prixPiece: { type: ["integer", "null"], minimum: 0, maximum: 10_000_000_000 },
          conditionnements: {
            type: "array", maxItems: 10,
            items: { type: "object", required: ["nom", "facteur"], additionalProperties: false, properties: { nom: texte(50), facteur: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000 }, prix: { type: ["integer", "null"], minimum: 0, maximum: 10_000_000_000 } } },
          },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const p = await article(ctx, req.params.id);
      await exigerSurEntite(ctx, "catalogue.gerer", p.entite_id);
      const noms = req.body.conditionnements.map((c) => c.nom.trim().toLowerCase());
      if (new Set(noms).size !== noms.length || noms.includes(String(p.unite).trim().toLowerCase())) throw new ErreurApi(400, "unite_en_double");
      const cond = req.body.conditionnements.map((c) => ({ nom: c.nom.trim(), facteur: c.facteur, ...(c.prix !== undefined && c.prix !== null ? { prix: c.prix } : {}) }));
      const { rows: [r] } = await ctx.client.query(
        "update produits set conditionnements = $2, prix_piece = case when $3::boolean then $4::int8 else prix_piece end where id = $1 returning unite, pieces_par_unite, conditionnements, prix_piece, prix_vente",
        [p.id, JSON.stringify(cond), req.body.prixPiece !== undefined, req.body.prixPiece ?? null],
      );
      return { unites: unitesArticle(r).map((u) => ({ ...u, prix_calcule: u.prix ?? Math.round(Number(r.prix_vente) * u.facteur) })) };
    }),
  );

  // ---------- Codes-barres ----------
  /** Donne un EAN13 interne à l'article qui n'a pas de code-barres. */
  app.post<{ Params: { id: string } }>("/produits/:id/code-barres", { schema: { params: paramId } }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const p = await article(ctx, req.params.id);
      await exigerSurEntite(ctx, "catalogue.gerer", p.entite_id);
      if (p.code_barres) throw new ErreurApi(409, "code_barres_existant");
      const code = await genererEan13(ctx.client);
      await ctx.client.query("update produits set code_barres = $2 where id = $1", [p.id, code]);
      return { code_barres: code };
    });
    return reponse.status(201).send(r);
  });
  /** Donne un EAN13 interne à tous les produits actifs d'une entité qui n'en ont pas. */
  app.post<{ Body: { entiteId: string } }>("/produits/codes-barres", { schema: { body: { type: "object", required: ["entiteId"], properties: { entiteId: uuid } } } }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "catalogue.gerer", req.body.entiteId);
      const { rows } = await ctx.client.query("select id from produits where entite_id = $1 and type = 'produit' and actif and code_barres is null order by nom limit 5000 for update", [req.body.entiteId]);
      for (const p of rows) await ctx.client.query("update produits set code_barres = $2 where id = $1", [p.id, await genererEan13(ctx.client)]);
      return { generes: rows.length };
    });
    return reponse.status(201).send(r);
  });

  // ---------- Photos ----------
  const corpsImage = { type: "object", required: ["image"], properties: { image: { type: "string", minLength: 8, maxLength: 800_000 } } } as const;
  const paramPhoto = { type: "object", required: ["id", "position"], properties: { id: uuid, position: { type: "integer", minimum: 1, maximum: PHOTOS_MAX } } } as const;
  const noter = (ctx: Contexte, action: string, details: object) => ctx.client.query("select journal_evenement($1, $2)", [action, JSON.stringify(details)]);
  app.put<{ Params: { id: string; position: number }; Body: { image: string } }>("/produits/:id/photos/:position", { bodyLimit: 1024 ** 2, schema: { params: paramPhoto, body: corpsImage } }, async (req) =>
    protege(req, async (ctx) => {
      const p = await article(ctx, req.params.id);
      await exigerSurEntite(ctx, "catalogue.gerer", p.entite_id);
      const { type, octets } = lireImage(req.body.image, PHOTO_OCTETS_MAX);
      await ctx.client.query(
        `insert into photos_produits (organisation_id, produit_id, position, type_mime, donnees, auteur_id) values ($1, $2, $3, $4, $5, $6)
         on conflict (organisation_id, produit_id, position) do update set type_mime = excluded.type_mime, donnees = excluded.donnees, auteur_id = excluded.auteur_id, maj_le = now()`,
        [ctx.organisationId, p.id, req.params.position, type, octets, ctx.utilisateurId],
      );
      await noter(ctx, "article.photo", { produit_id: p.id, position: req.params.position, type, octets: octets.length });
      return { enregistre: true, position: req.params.position };
    }),
  );
  app.delete<{ Params: { id: string; position: number } }>("/produits/:id/photos/:position", { schema: { params: paramPhoto } }, async (req) =>
    protege(req, async (ctx) => {
      const p = await article(ctx, req.params.id);
      await exigerSurEntite(ctx, "catalogue.gerer", p.entite_id);
      const { rowCount } = await ctx.client.query("delete from photos_produits where produit_id = $1 and position = $2", [p.id, req.params.position]);
      if (rowCount) await noter(ctx, "article.photo_retiree", { produit_id: p.id, position: req.params.position });
      return { retire: !!rowCount };
    }),
  );
  /** L'image elle-même, gardée en cache par le navigateur. Visible de qui travaille avec les articles de la branche. */
  app.get<{ Params: { id: string; position: number } }>("/produits/:id/photos/:position", { schema: { params: paramPhoto } }, async (req, reponse) => {
    const photo = await protege(req, async (ctx) => {
      const branches = await branchesArticles(ctx);
      const { rows: [x] } = await ctx.client.query(
        "select f.type_mime, f.donnees, f.maj_le, coalesce(entite_branche(p.entite_id), p.entite_id) as b from photos_produits f join produits p on p.id = f.produit_id where f.produit_id = $1 and f.position = $2",
        [req.params.id, req.params.position],
      );
      if (!x || !branches.includes(String(x.b))) throw new ErreurApi(404, "introuvable");
      return x;
    });
    const etiquette = `"${new Date(photo.maj_le).getTime()}"`;
    reponse.header("cache-control", "private, max-age=86400").header("etag", etiquette).header("x-content-type-options", "nosniff");
    if (req.headers["if-none-match"] === etiquette) return reponse.status(304).send();
    return reponse.header("content-type", photo.type_mime).send(photo.donnees);
  });
}
