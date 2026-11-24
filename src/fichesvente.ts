import type { FastifyInstance } from "fastify";
import type { Client } from "./base.js";
import type { Permission } from "./catalogue.js";
import { prixEnLigne, type ArticlePrix } from "./canalenligne.js";
import { brancheCommerce } from "./messages.js";
import { aPermissionSurEntite } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";
import type { GenerateurIa } from "./studio.js";

/**
 * Studio des fiches produits (lot 4, partie C) : l'IA propose un titre, une description et des points clés, le marketing corrige
 * et publie. Chaque version est gardée ; le nom de l'article dans l'ERP (caisse, factures, stock) ne change jamais.
 */

export const TITRE_MAX = 80;
export const DESCRIPTION_MAX = 1500;
export const POINT_MAX = 120;
export const POINTS_MIN = 3;
export const POINTS_MAX = 6;
export const NOTES_MAX = 1000;
const DELAI_IA_FICHE_MS = 60_000;
const MAX_JETONS_FICHE = 2000;

const uuid = { type: "string", format: "uuid" } as const;
const paramProduit = { type: "object", required: ["produitId"], properties: { produitId: uuid } } as const;
const ETATS = ["publie", "brouillon", "publie_et_brouillon", "aucun"];

interface Texte { titre: string; description: string; points_cles: string[] }

/** Même contrôle pour le texte écrit à la main et pour celui de l'IA ; seule l'erreur change. */
function validerTexte(brut: unknown, erreur: () => ErreurApi): Texte {
  const t = brut as Record<string, unknown> | null;
  if (!t || typeof t !== "object" || !Array.isArray(t.points_cles)) throw erreur();
  const texte = (v: unknown, max: number) => {
    if (typeof v !== "string" || !v.trim() || v.trim().length > max) throw erreur();
    return v.trim();
  };
  if (t.points_cles.length < POINTS_MIN || t.points_cles.length > POINTS_MAX) throw erreur();
  return { titre: texte(t.titre, TITRE_MAX), description: texte(t.description, DESCRIPTION_MAX), points_cles: t.points_cles.map((p) => texte(p, POINT_MAX)) };
}

const SCHEMA_FICHE = {
  type: "object", additionalProperties: false, required: ["titre", "description", "points_cles"],
  properties: { titre: { type: "string" }, description: { type: "string" }, points_cles: { type: "array", items: { type: "string" } } },
} as const;

const consigneRole = (marque: string) =>
  `Tu rédiges en français la fiche de vente d'un article pour la boutique en ligne ${marque}. N'invente aucune caractéristique, aucun chiffre, `
  + "aucune garantie ni aucun usage : utilise seulement les informations et les notes données ; si elles sont maigres, reste court. "
  + `Titre de ${TITRE_MAX} caractères au plus, description de ${DESCRIPTION_MAX} caractères au plus, de ${POINTS_MIN} à ${POINTS_MAX} points clés `
  + `de ${POINT_MAX} caractères au plus chacun. Le marketing relit tout avant publication.`;

/** L'article, si la personne a le droit sur sa branche, et s'il est suivi en stock dans une branche qui gère du stock (jamais GTA). */
async function articleAutorise(ctx: Contexte, produitId: string, permission: Permission) {
  const { rows: [a] } = await ctx.client.query(
    `select p.id, p.code, p.nom, p.unite, p.type, p.suivi_stock, p.actif as en_ligne, p.prix_vente, p.taux_taxe::float as taux_taxe,
       p.paliers_actif and p.mode_palier = 'tranches' as tranches, entite_branche(p.entite_id) as branche, e.nom as marque_boutique,
       g.nom as categorie, m.nom as marque,
       (select json_build_object('type', o.type, 'valeur', o.valeur, 'fin', o.fin) from promotions o
         where o.produit_id = p.id and o.actif and (now() at time zone 'Africa/Douala')::date between o.debut and o.fin
         order by o.cree_le desc limit 1) as promotion
     from produits p join entites e on e.id = entite_branche(p.entite_id)
     left join categories_articles g on g.id = p.categorie_id and g.actif
     left join marques m on m.id = p.marque_id and m.actif
     where p.id = $1`,
    [produitId],
  );
  if (!a) throw new ErreurApi(404, "introuvable");
  if (!(await aPermissionSurEntite(ctx.client, ctx.utilisateurId, permission, a.branche))) throw new ErreurApi(403, "permission_refusee");
  if (a.type !== "produit" || !a.suivi_stock || (await brancheCommerce(ctx.client, a.branche)) !== a.branche) throw new ErreurApi(409, "module_inactif");
  return a as Record<string, any>;
}

const versions = async (c: Client, produitId: string) => (await c.query(
  `select v.id, v.version, v.titre, v.description, v.points_cles, v.source, v.notes, v.statut, a.nom as auteur, pb.nom as publie_par, v.publie_le, v.cree_le
   from textes_vente v join utilisateurs a on a.id = v.auteur_id left join utilisateurs pb on pb.id = v.publie_par
   where v.produit_id = $1 order by v.version desc`,
  [produitId],
)).rows;

/** Deux écritures simultanées sur le même article s'attendent : un seul brouillon, un seul texte publié. */
const verrouArticle = (c: Client, produitId: string) => c.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`texte_vente:${produitId}`]);

/** Le brouillon en cours est remplacé ; sans brouillon, la version suivante est créée. Une version publiée ne change jamais. */
async function ecrireBrouillon(ctx: Contexte, produitId: string, t: Texte, source: "ia" | "manuel", notes: string | null) {
  await verrouArticle(ctx.client, produitId);
  const { rows: [b] } = await ctx.client.query(
    `update textes_vente set titre = $2, description = $3, points_cles = $4, source = $5, notes = coalesce($6, notes), auteur_id = $7
     where produit_id = $1 and statut = 'brouillon' returning id`,
    [produitId, t.titre, t.description, t.points_cles, source, notes, ctx.utilisateurId],
  );
  if (b) return b.id as string;
  const { rows: [n] } = await ctx.client.query(
    `insert into textes_vente (organisation_id, produit_id, version, titre, description, points_cles, source, notes, auteur_id)
     values ($1, $2, (select coalesce(max(version), 0) + 1 from textes_vente where produit_id = $2), $3, $4, $5, $6, $7, $8) returning id`,
    [ctx.organisationId, produitId, t.titre, t.description, t.points_cles, source, notes, ctx.utilisateurId],
  );
  return n.id as string;
}

const versionDe = async (c: Client, produitId: string, id: string) => (await versions(c, produitId)).find((v) => v.id === id);

export function enregistrerFichesVente(app: FastifyInstance, outils: Outils, generateur?: GenerateurIa): void {
  const { protege } = outils;

  app.get<{ Querystring: { branche: string; etat?: string; recherche?: string } }>("/fiches-vente", {
    schema: {
      querystring: {
        type: "object", required: ["branche"],
        properties: { branche: uuid, etat: { type: "string", enum: ETATS }, recherche: { type: "string", maxLength: 100 } },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const q = req.query;
      const { rows: [e] } = await ctx.client.query("select 1 from entites where id = $1", [q.branche]);
      if (!e) throw new ErreurApi(404, "introuvable");
      if (!(await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "marketing.voir", q.branche))) throw new ErreurApi(403, "permission_refusee");
      if ((await brancheCommerce(ctx.client, q.branche)) !== q.branche) throw new ErreurApi(409, "module_inactif");
      const { rows } = await ctx.client.query(
        `with a as (
           select p.id, p.code, p.nom, p.actif as en_ligne,
             exists (select 1 from textes_vente v where v.produit_id = p.id and v.statut = 'publie') as publie,
             exists (select 1 from textes_vente v where v.produit_id = p.id and v.statut = 'brouillon') as brouillon
           from produits p
           where p.type = 'produit' and p.suivi_stock and entite_branche(p.entite_id) = $1
             and ($2::text is null or position(lower($2) in lower(p.nom || ' ' || p.code)) > 0))
         select id, code, nom, en_ligne,
           case when publie and brouillon then 'publie_et_brouillon' when publie then 'publie' when brouillon then 'brouillon' else 'aucun' end as etat
         from a where $3::text is null
           or $3 = case when publie and brouillon then 'publie_et_brouillon' when publie then 'publie' when brouillon then 'brouillon' else 'aucun' end
         order by nom limit 500`,
        [q.branche, q.recherche?.trim() || null, q.etat ?? null],
      );
      return rows;
    }),
  );

  app.get<{ Params: { produitId: string } }>("/fiches-vente/:produitId", { schema: { params: paramProduit } }, async (req) =>
    protege(req, async (ctx) => {
      const a = await articleAutorise(ctx, req.params.produitId, "marketing.voir");
      const historique = await versions(ctx.client, a.id);
      return {
        article: { id: a.id, code: a.code, nom: a.nom, categorie: a.categorie, marque: a.marque, unite: a.unite, en_ligne: a.en_ligne, prix_ttc: await prixEnLigne(ctx.client, a as ArticlePrix) },
        brouillon: historique.find((v) => v.statut === "brouillon") ?? null,
        publie: historique.find((v) => v.statut === "publie") ?? null,
        historique,
        ia_disponible: Boolean(generateur),
      };
    }),
  );

  app.put<{ Params: { produitId: string }; Body: Texte }>("/fiches-vente/:produitId/brouillon", {
    schema: {
      params: paramProduit,
      body: {
        type: "object", additionalProperties: false, required: ["titre", "description", "points_cles"],
        properties: {
          titre: { type: "string", minLength: 1, maxLength: TITRE_MAX }, description: { type: "string", minLength: 1, maxLength: DESCRIPTION_MAX },
          points_cles: { type: "array", minItems: POINTS_MIN, maxItems: POINTS_MAX, items: { type: "string", minLength: 1, maxLength: POINT_MAX } },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const a = await articleAutorise(ctx, req.params.produitId, "marketing.gerer");
      const t = validerTexte(req.body, () => new ErreurApi(400, "donnees_invalides"));
      return versionDe(ctx.client, a.id, await ecrireBrouillon(ctx, a.id, t, "manuel", null));
    }),
  );

  /** L'IA ne publie rien ; aucune connexion à la base n'est retenue pendant qu'elle répond. */
  app.post<{ Params: { produitId: string }; Body?: { notes?: string } | null }>("/fiches-vente/:produitId/brouillon-ia", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      params: paramProduit,
      body: { type: ["object", "null"], additionalProperties: false, properties: { notes: { type: "string", maxLength: NOTES_MAX } } },
    },
  }, async (req, reponse) => {
    const notes = req.body?.notes?.trim() || null;
    const a = await protege(req, async (ctx) => {
      const x = await articleAutorise(ctx, req.params.produitId, "marketing.gerer");
      x.prix_ttc = await prixEnLigne(ctx.client, x as ArticlePrix);
      return x;
    });
    if (!generateur) throw new ErreurApi(503, "ia_non_configuree");
    const consigne = [
      `Article : ${a.nom}`, `Code : ${a.code}`, a.categorie ? `Catégorie : ${a.categorie}` : "", a.marque ? `Marque : ${a.marque}` : "",
      `Unité de vente : ${a.unite}`, `Prix : ${a.prix_ttc} FCFA TTC`, `Notes du marketing : ${notes ?? "aucune"}`,
    ].filter(Boolean).join("\n");
    let brut: unknown;
    try {
      brut = await generateur(consigne, SCHEMA_FICHE, { systeme: consigneRole(a.marque_boutique), delaiMs: DELAI_IA_FICHE_MS, maxJetons: MAX_JETONS_FICHE });
    } catch (e) {
      throw e instanceof ErreurApi ? e : new ErreurApi(502, "ia_indisponible");
    }
    const t = validerTexte(brut, () => new ErreurApi(502, "ia_reponse_invalide"));
    const v = await protege(req, async (ctx) => {
      await articleAutorise(ctx, req.params.produitId, "marketing.gerer");
      return versionDe(ctx.client, a.id, await ecrireBrouillon(ctx, a.id, t, "ia", notes));
    });
    return reponse.status(201).send(v);
  });

  app.post<{ Params: { produitId: string } }>("/fiches-vente/:produitId/publication", { schema: { params: paramProduit } }, async (req) =>
    protege(req, async (ctx) => {
      const a = await articleAutorise(ctx, req.params.produitId, "marketing.gerer");
      await verrouArticle(ctx.client, a.id);
      const { rows: [b] } = await ctx.client.query("select id from textes_vente where produit_id = $1 and statut = 'brouillon'", [a.id]);
      if (!b) throw new ErreurApi(409, "brouillon_absent");
      // L'ancien texte publié reste dans l'historique ; un seul texte publié à la fois.
      await ctx.client.query("update textes_vente set statut = 'remplace' where produit_id = $1 and statut = 'publie'", [a.id]);
      await ctx.client.query("update textes_vente set statut = 'publie', publie_par = $2, publie_le = now() where id = $1", [b.id, ctx.utilisateurId]);
      await ctx.client.query("select journal_evenement('fiche_vente.publiee', $1)", [JSON.stringify({ produit: a.id, texte: b.id })]);
      return versionDe(ctx.client, a.id, b.id);
    }),
  );

  app.post<{ Params: { produitId: string } }>("/fiches-vente/:produitId/retrait", { schema: { params: paramProduit } }, async (req) =>
    protege(req, async (ctx) => {
      const a = await articleAutorise(ctx, req.params.produitId, "marketing.gerer");
      await verrouArticle(ctx.client, a.id);
      const { rows: [r] } = await ctx.client.query("update textes_vente set statut = 'retire' where produit_id = $1 and statut = 'publie' returning id", [a.id]);
      if (!r) throw new ErreurApi(409, "aucun_texte_publie");
      await ctx.client.query("select journal_evenement('fiche_vente.retiree', $1)", [JSON.stringify({ produit: a.id, texte: r.id })]);
      return { retire: true };
    }),
  );
}
