import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { dansOrganisation, publierEvenement, type Client } from "./base.js";
import { brutTranches, prixProduit, prixPromo } from "./commerce.js";
import { calculerLigne } from "./facturation.js";
import { prochainNumero } from "./formations.js";
import { entitesAccessibles } from "./permissions.js";
import { creerColis } from "./pilotage.js";
import { hacherJeton, normaliserTelephone } from "./securite.js";
import { ErreurApi, type Contexte, type Outils, type TachePlanifiee } from "./serveur.js";
import { produitSuivi, quantiteDisponible } from "./stocks.js";

/**
 * Canal en ligne de GLOMARI : routes publiques appelées par la Marketplace (/marketplace/:org/...),
 * traitement des commandes par le personnel, expiration des réservations.
 * Un seul prix (celui de la caisse) et un seul stock (celui du lieu qui sert la commande).
 */

export const DUREE_RESERVATION_MINUTES = 30;
export const DUREE_RESERVATION_LIVRAISON_MINUTES = 1440;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE = /^WEB-[0-9]{4}-[0-9]{6}$/;
const JETON = /^[A-Za-z0-9_-]{43}$/;
const MODES = ["domicile", "agence_voyage", "point_relais", "retrait_magasin"];
const AVEC_ZONE = ["domicile", "agence_voyage"];
const MOYENS = ["orange_money", "mtn_momo", "a_la_livraison"];
const STATUTS = ["reservee", "payee", "facturee", "expediee", "livree", "annulee", "expiree"];
const COLIS_ANNULABLE = ["prepare", "echec", "retour"];
export const ARTICLE_EN_LIGNE = "p.actif and p.type = 'produit' and p.suivi_stock";
const uuid = { type: "string", format: "uuid" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const parMinute = (max: number) => ({ rateLimit: { max, timeWindow: "1 minute" } });

export async function leverReservations(c: Client, commandeId: string): Promise<void> {
  await c.query("update reservations_stock set levee_le = now() where commande_web_id = $1 and levee_le is null", [commandeId]);
}

/** Relançable sans effet de bord : une commande déjà verrouillée par un autre passage lui est laissée. */
export async function expirerCommandesWeb(c: Client): Promise<number> {
  const { rows } = await c.query(
    "select id, reference from commandes_web where statut = 'reservee' and colis_id is null and expire_le < now() order by expire_le limit 500 for update skip locked",
  );
  for (const x of rows) {
    await leverReservations(c, x.id);
    await c.query("update commandes_web set statut = 'expiree', traite_le = now() where id = $1", [x.id]);
    await publierEvenement(c, "commande_web.expiree", { id: x.id, reference: x.reference });
  }
  return rows.length;
}

const AVIS_PAR_PAGE = 20;
/** « Awa Ngono » devient « Awa N. » : un avis public ne montre jamais le nom complet. */
export function auteurPublic(nom: string | null): string {
  const mots = (nom ?? "").trim().split(/\s+/).filter(Boolean);
  if (!mots.length) return "Client";
  return mots.length === 1 ? mots[0]! : `${mots[0]} ${mots.at(-1)![0]!.toUpperCase()}.`;
}

export interface Boutique { org: string; configId: string; branche: string; nom: string }
export interface ChoixLivraison { modeLivraison: string; zoneId?: string; pointRelaisId?: string; adresse?: string }
interface CorpsCommande extends ChoixLivraison {
  lieuId: string; lignes: { produitId: string; quantite: number }[]; nomClient: string; telephone: string; moyenPaiement: string; note?: string;
}

/** Tout échec renvoie « introuvable », sans dire si l'organisation existe ou si sa boutique est fermée. */
export function parBoutique<T>(pool: pg.Pool, org: string, fn: (c: Client, b: Boutique) => Promise<T>): Promise<T> {
  if (!UUID.test(org)) throw new ErreurApi(404, "introuvable");
  return dansOrganisation(pool, org, async (c) => {
    const { rows: [k] } = await c.query("select k.id, k.entite_id, e.nom from config_canal k join entites e on e.id = k.entite_id where k.actif");
    if (!k) throw new ErreurApi(404, "introuvable");
    return fn(c, { org, configId: k.id, branche: k.entite_id, nom: k.nom });
  });
}

/**
 * La fiche d'un numéro dans la branche : toujours la même (la plus ancienne non archivée), pour la commande en ligne,
 * la précommande et le compte client.
 */
export async function trouverFicheClient(c: Client, branche: string, telephone: string): Promise<string | null> {
  const { rows: [t] } = await c.query(
    "select id from tiers where telephone = $1 and not archive and branche_id = $2 order by cree_le, id limit 1", [telephone, branche],
  );
  return t?.id ?? null;
}

/** Même règle que le client rapide de la caisse : un numéro déjà connu dans la branche rend sa fiche. */
export async function ficheClient(c: Client, b: Boutique, lieuId: string, nom: string, telephone: string): Promise<string> {
  // Deux commandes simultanées d'un nouveau client ne créent qu'une fiche.
  await c.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`tiers:${b.branche}:${telephone}`]);
  const existante = await trouverFicheClient(c, b.branche, telephone);
  if (existante) return existante;
  const { rows: [n] } = await c.query(
    "insert into tiers (organisation_id, type, nom, telephone, roles, entite_origine_id, branche_id) values ($1, 'personne', $2, $3, '{client}', $4, $5) returning id",
    [b.org, nom, telephone, lieuId, b.branche],
  );
  await publierEvenement(c, "tiers.cree", { id: n.id });
  return n.id;
}

export interface ArticlePrix { id: string; prix_vente: number; taux_taxe: number; tranches: boolean; promotion: { type: string; valeur: number | string } | null }

/** Prix TTC d'une unité tel que la Marketplace l'affiche : celui de la caisse, promotion comprise, sans prix négocié. */
export async function prixEnLigne(c: Client, a: ArticlePrix): Promise<number> {
  // Hors tranches, aucun palier ne joue pour une unité (quantite_min > 1, migration 0020) : seule la promotion compte.
  const prix = a.tranches ? await prixProduit(c, a.id, a.prix_vente, 1)
    : a.promotion ? prixPromo(a.prix_vente, a.promotion.type, Number(a.promotion.valeur)) : a.prix_vente;
  const m = calculerLigne(1, prix, 0, a.taux_taxe);
  return m.ht + m.taxes;
}

/** Une commande en ligne telle que son client la voit : jamais de coût, de jeton ni de donnée d'un autre client. */
export async function detailCommandeWeb(c: Client, b: Boutique, id: string, urlPublique: string) {
  const { rows: [w] } = await c.query(
    `select w.id, w.reference, w.statut, l.nom_public as lieu, w.mode_livraison, z.nom as zone, r.nom as point_relais, w.moyen_paiement,
       w.frais_livraison, w.total_ttc, w.acompte, w.expire_le, w.cree_le, k.statut as colis_statut, k.code_suivi
     from commandes_web w
     left join lieux_canal l on l.config_id = $2 and l.entite_id = w.lieu_id
     left join zones_livraison z on z.id = w.zone_id
     left join points_relais r on r.id = w.point_relais_id
     left join colis k on k.id = w.colis_id
     where w.id = $1 and w.entite_id = $3`,
    [id, b.configId, b.branche],
  );
  if (!w) return null;
  const { rows: lignes } = await c.query(
    "select p.nom, l.quantite, l.prix_unitaire_ttc, l.total_ttc from lignes_commande_web l join produits p on p.id = l.produit_id where l.commande_id = $1 order by p.nom",
    [w.id],
  );
  return {
    reference: w.reference, statut: w.statut, lieu: w.lieu, mode_livraison: w.mode_livraison, zone: w.zone, point_relais: w.point_relais,
    moyen_paiement: w.moyen_paiement, frais_livraison: w.frais_livraison, total_ttc: w.total_ttc,
    // Solde d'une précommande : l'acompte déjà versé est déduit du montant à payer.
    acompte: w.acompte, montant_a_payer: w.total_ttc - w.acompte, expire_le: w.expire_le, cree_le: w.cree_le,
    lignes, colis: w.colis_statut ? { statut: w.colis_statut, lien_suivi: `${urlPublique}/suivi.html?c=${b.org}.${w.code_suivi}` } : null,
  };
}

/** Règles du mode de remise, communes à la commande et au solde d'une précommande. Renvoie l'adresse retenue. */
export function verifierLivraison(b: ChoixLivraison): string | null {
  if (!MODES.includes(b.modeLivraison)) throw new ErreurApi(400, "mode_livraison_invalide");
  const avecZone = AVEC_ZONE.includes(b.modeLivraison);
  if (avecZone !== Boolean(b.zoneId)) throw new ErreurApi(400, "zone_invalide");
  if ((b.modeLivraison === "point_relais") !== Boolean(b.pointRelaisId)) throw new ErreurApi(400, "point_relais_invalide");
  const adresse = avecZone ? b.adresse?.trim() || null : null;
  if (avecZone && !adresse) throw new ErreurApi(400, "donnees_invalides");
  return adresse;
}

/** Frais de la zone choisie ; zone et point relais doivent être ceux de la branche. */
export async function fraisLivraison(c: Client, branche: string, b: ChoixLivraison): Promise<number> {
  let frais = 0;
  if (b.zoneId) {
    const { rows: [z] } = await c.query("select frais from zones_livraison where id = $1 and entite_id = $2", [b.zoneId, branche]);
    if (!z) throw new ErreurApi(400, "zone_invalide");
    frais = z.frais;
  }
  if (b.pointRelaisId) {
    const { rows: [p] } = await c.query("select 1 from points_relais where id = $1 and actif and entite_branche(entite_id) = $2", [b.pointRelaisId, branche]);
    if (!p) throw new ErreurApi(400, "point_relais_invalide");
  }
  return frais;
}

export function enregistrerCanalEnLigne(app: FastifyInstance, pool: pg.Pool, outils: Outils, taches: TachePlanifiee[], urlPublique: string, commandesParMinute = 20): void {
  const { protege, exiger, exigerSurEntite } = outils;
  taches.push((organisationId) => dansOrganisation(pool, organisationId, async (c) => { await expirerCommandesWeb(c); }));
  const lienColis = (org: string, code: string) => `${urlPublique}/suivi.html?c=${org}.${code}`;

  // ---------- Boutique et lieux ----------

  /** La boutique d'une branche qui gère du stock, créée fermée au premier réglage. */
  const boutiqueDe = async (ctx: Contexte, entiteId: string): Promise<string> => {
    await exigerSurEntite(ctx, "facturation.administrer", entiteId);
    const { rows: [e] } = await ctx.client.query(
      "select entite_branche($1) = $1 as branche, exists (select 1 from modules_entite where entite_id = $1 and module = 'achats_stocks' and actif) as stock",
      [entiteId],
    );
    if (!e?.branche) throw new ErreurApi(400, "donnees_invalides");
    if (!e.stock) throw new ErreurApi(409, "module_inactif");
    const { rows: [k] } = await ctx.client.query(
      "insert into config_canal (organisation_id, entite_id) values ($1, $2) on conflict (organisation_id, entite_id) do update set entite_id = excluded.entite_id returning id",
      [ctx.organisationId, entiteId],
    );
    return k.id;
  };

  app.get<{ Querystring: { entiteId: string } }>("/canal-config", {
    schema: { querystring: { type: "object", required: ["entiteId"], properties: { entiteId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "facturation.voir", req.query.entiteId);
      const { rows: [k] } = await ctx.client.query(
        "select k.id, k.actif, u.nom as responsable from config_canal k left join utilisateurs u on u.id = k.responsable_id where k.entite_id = $1", [req.query.entiteId],
      );
      if (!k) return { actif: false, lieux: [], responsable: null };
      const { rows: lieux } = await ctx.client.query("select entite_id, nom_public, actif from lieux_canal where config_id = $1 order by nom_public", [k.id]);
      return { actif: k.actif, lieux, responsable: k.responsable };
    }),
  );

  app.post<{ Body: { entiteId: string; actif: boolean } }>("/canal-config", {
    schema: { body: { type: "object", required: ["entiteId", "actif"], properties: { entiteId: uuid, actif: { type: "boolean" } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const id = await boutiqueDe(ctx, req.body.entiteId);
      try {
        // Celui qui ouvre la boutique devient le responsable au nom de qui les ventes payées en ligne sont créées.
        await ctx.client.query(
          "update config_canal set actif = $2, responsable_id = case when $2 then $3::uuid else responsable_id end where id = $1",
          [id, req.body.actif, ctx.utilisateurId],
        );
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new ErreurApi(409, "boutique_deja_active");
        throw e;
      }
      await ctx.client.query("select journal_evenement('canal.acces', $1)", [JSON.stringify({ entite: req.body.entiteId, actif: req.body.actif })]);
      return { actif: req.body.actif };
    }),
  );

  app.post<{ Body: { entiteId: string; lieuEntiteId: string; nomPublic: string; actif?: boolean } }>("/canal-config/lieux", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "lieuEntiteId", "nomPublic"],
        properties: { entiteId: uuid, lieuEntiteId: uuid, nomPublic: { type: "string", minLength: 1, maxLength: 100 }, actif: { type: "boolean" } },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const b = req.body;
      const configId = await boutiqueDe(ctx, b.entiteId);
      const nom = b.nomPublic.trim();
      if (!nom) throw new ErreurApi(400, "donnees_invalides");
      const { rows: [e] } = await ctx.client.query("select entite_branche($1) as b", [b.lieuEntiteId]);
      if (e?.b !== b.entiteId) throw new ErreurApi(400, "lieu_invalide");
      const { rows: [l] } = await ctx.client.query(
        `insert into lieux_canal (organisation_id, config_id, entite_id, nom_public, actif) values ($1, $2, $3, $4, $5)
         on conflict (organisation_id, config_id, entite_id) do update set nom_public = excluded.nom_public, actif = excluded.actif
         returning entite_id, nom_public, actif`,
        [ctx.organisationId, configId, b.lieuEntiteId, nom, b.actif ?? true],
      );
      return l;
    }),
  );

  // ---------- Routes publiques de la Marketplace ----------

  const lieuxDe = async (c: Client, configId: string) => (await c.query(
    "select l.entite_id as id, l.nom_public as nom from lieux_canal l join entites e on e.id = l.entite_id where l.config_id = $1 and l.actif and e.actif order by l.nom_public",
    [configId],
  )).rows;

  /** Jamais le coût, la marge ni le fournisseur : la liste des colonnes est fermée. Pas de quantité : la Marketplace garde ce catalogue en cache. */
  app.get<{ Params: { org: string } }>("/marketplace/:org/catalogue", { config: parMinute(60) }, async (req) =>
    parBoutique(pool, req.params.org, async (c, b) => {
      const { rows } = await c.query(
        `select p.id, p.code, p.nom, p.unite, p.prix_vente, p.taux_taxe::float as taux_taxe,
           p.paliers_actif and p.mode_palier = 'tranches' as tranches,
           case when g.id is null then null else json_build_object('id', g.id, 'nom', g.nom, 'parent', gp.nom) end as categorie,
           m.nom as marque,
           coalesce((select json_agg(f.position order by f.position) from photos_produits f where f.produit_id = p.id), '[]'::json) as photos,
           (select json_build_object('type', o.type, 'valeur', o.valeur, 'fin', o.fin) from promotions o
             where o.produit_id = p.id and o.actif and (now() at time zone 'Africa/Douala')::date between o.debut and o.fin
             order by o.cree_le desc limit 1) as promotion,
           (select json_build_object('moyenne', round(avg(r.note), 1)::float, 'nombre', count(*)::int)
              from retours_clients r where r.produit_id = p.id and r.statut = 'publie') as avis,
           -- Texte de vente publié par le marketing (lot 4C) ; le nom reste celui de l'ERP.
           (select json_build_object('titre', v.titre, 'description', v.description, 'points_cles', v.points_cles)
              from textes_vente v where v.produit_id = p.id and v.statut = 'publie') as vente
         from produits p
         left join categories_articles g on g.id = p.categorie_id and g.actif
         left join categories_articles gp on gp.id = g.parent_id
         left join marques m on m.id = p.marque_id and m.actif
         where ${ARTICLE_EN_LIGNE} and entite_branche(p.entite_id) = $1
         order by p.nom limit 2000`,
        [b.branche],
      );
      const catalogue = [];
      for (const { prix_vente, taux_taxe, tranches, ...p } of rows) {
        catalogue.push({ ...p, prix_ttc: await prixEnLigne(c, { id: p.id, prix_vente, taux_taxe, tranches, promotion: p.promotion }) });
      }
      return {
        branche: b.nom,
        durees_reservation: { mobile_money: DUREE_RESERVATION_MINUTES, a_la_livraison: DUREE_RESERVATION_LIVRAISON_MINUTES },
        catalogue,
      };
    }),
  );

  /** Avis vérifiés et publiés d'un article : jamais le nom complet, le téléphone ni la commande du client. */
  app.get<{ Params: { org: string; id: string }; Querystring: { page?: number } }>("/marketplace/:org/produits/:id/avis", {
    config: parMinute(60),
    schema: { querystring: { type: "object", properties: { page: { type: "integer", minimum: 1, maximum: 10000 } } } },
  }, async (req) => {
    if (!UUID.test(req.params.id)) throw new ErreurApi(404, "introuvable");
    return parBoutique(pool, req.params.org, async (c, b) => {
      const { rows: [p] } = await c.query(`select p.id from produits p where p.id = $1 and ${ARTICLE_EN_LIGNE} and entite_branche(p.entite_id) = $2`, [req.params.id, b.branche]);
      if (!p) throw new ErreurApi(404, "introuvable");
      const { rows: [s] } = await c.query("select round(avg(note), 1)::float as moyenne, count(*)::int as nombre from retours_clients where produit_id = $1 and statut = 'publie'", [p.id]);
      const page = req.query.page ?? 1;
      const { rows } = await c.query(
        `select r.note, r.commentaire, (r.cree_le at time zone 'Africa/Douala')::date::text as date, r.reponse, t.nom
         from retours_clients r join demandes_retour d on d.id = r.demande_id left join tiers t on t.id = d.tiers_id
         where r.produit_id = $1 and r.statut = 'publie' order by r.cree_le desc, r.id limit $2 offset $3`,
        [p.id, AVIS_PAR_PAGE, (page - 1) * AVIS_PAR_PAGE],
      );
      return {
        produit_id: p.id, moyenne: s.moyenne, nombre: s.nombre, page, pages: Math.max(1, Math.ceil(s.nombre / AVIS_PAR_PAGE)),
        avis: rows.map((r) => ({ note: r.note, commentaire: r.commentaire, date: r.date, auteur: auteurPublic(r.nom), achat_verifie: true, reponse: r.reponse })),
      };
    });
  });

  app.get<{ Params: { org: string; id: string; position: number } }>("/marketplace/:org/produits/:id/photos/:position", {
    config: parMinute(120),
    schema: { params: { type: "object", required: ["org", "id", "position"], properties: { org: { type: "string" }, id: { type: "string" }, position: { type: "integer", minimum: 1, maximum: 4 } } } },
  }, async (req, reponse) => {
    if (!UUID.test(req.params.id)) throw new ErreurApi(404, "introuvable");
    const photo = await parBoutique(pool, req.params.org, async (c, b) => {
      const { rows: [x] } = await c.query(
        `select f.type_mime, f.donnees, f.maj_le from photos_produits f join produits p on p.id = f.produit_id
         where f.produit_id = $1 and f.position = $2 and ${ARTICLE_EN_LIGNE} and entite_branche(p.entite_id) = $3`,
        [req.params.id, req.params.position, b.branche],
      );
      if (!x) throw new ErreurApi(404, "introuvable");
      return x;
    });
    const etiquette = `"${new Date(photo.maj_le).getTime()}"`;
    // L'image s'affiche sur le site de la Marketplace, une autre origine que l'ERP.
    reponse.header("cache-control", "public, max-age=86400").header("etag", etiquette).header("x-content-type-options", "nosniff")
      .header("cross-origin-resource-policy", "cross-origin");
    if (req.headers["if-none-match"] === etiquette) return reponse.status(304).send();
    return reponse.header("content-type", photo.type_mime).send(photo.donnees);
  });

  app.get<{ Params: { org: string }; Querystring: { produits?: string } }>("/marketplace/:org/disponibilite", {
    config: parMinute(60),
    schema: { querystring: { type: "object", properties: { produits: { type: "string", maxLength: 4000 } } } },
  }, async (req) => {
    const ids = [...new Set((req.query.produits ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))];
    if (!ids.length || ids.length > 100 || !ids.every((i) => UUID.test(i))) throw new ErreurApi(400, "donnees_invalides");
    return parBoutique(pool, req.params.org, async (c, b) => (await c.query(
      `select p.id as produit_id,
         coalesce(json_object_agg(l.entite_id, greatest(quantite_vendable(l.entite_id, p.id), 0)::float8) filter (where l.entite_id is not null), '{}'::json) as lieux
       from produits p
       left join (lieux_canal l join entites e on e.id = l.entite_id and e.actif) on l.config_id = $3 and l.actif
       where p.id = any($1::uuid[]) and ${ARTICLE_EN_LIGNE} and entite_branche(p.entite_id) = $2
       group by p.id order by p.id`,
      [ids, b.branche, b.configId],
    )).rows);
  });

  app.get<{ Params: { org: string } }>("/marketplace/:org/zones", { config: parMinute(60) }, async (req) =>
    parBoutique(pool, req.params.org, async (c, b) => ({
      lieux: await lieuxDe(c, b.configId),
      // Zones et colis sont au nom de la branche : un lieu n'a pas le module transport.
      zones: (await c.query("select id, nom, frais, delai_jours from zones_livraison where entite_id = $1 order by nom", [b.branche])).rows,
      points_relais: (await c.query("select id, nom, adresse from points_relais where actif and entite_branche(entite_id) = $1 order by nom", [b.branche])).rows,
      modes_livraison: MODES,
      moyens_paiement: MOYENS,
    })),
  );

  app.post<{ Params: { org: string }; Body: CorpsCommande }>("/marketplace/:org/commandes", {
    config: parMinute(commandesParMinute),
    schema: {
      body: {
        type: "object", required: ["lieuId", "lignes", "nomClient", "telephone", "modeLivraison", "moyenPaiement"],
        properties: {
          lieuId: uuid,
          lignes: {
            type: "array", minItems: 1, maxItems: 50,
            items: { type: "object", required: ["produitId", "quantite"], properties: { produitId: uuid, quantite: { type: "integer", minimum: 1, maximum: 10000 } } },
          },
          nomClient: { type: "string", minLength: 2, maxLength: 200 },
          telephone: { type: "string", minLength: 1, maxLength: 30 },
          modeLivraison: { type: "string", maxLength: 30 },
          zoneId: uuid,
          pointRelaisId: uuid,
          adresse: { type: "string", maxLength: 500 },
          moyenPaiement: { type: "string", enum: MOYENS },
          note: { type: "string", maxLength: 1000 },
        },
      },
    },
  }, async (req, reponse) => {
    const b = req.body;
    const adresse = verifierLivraison(b);
    const nom = b.nomClient.trim();
    if (nom.length < 2) throw new ErreurApi(400, "donnees_invalides");
    const telephone = normaliserTelephone(b.telephone);
    if (!/^[0-9]{8,15}$/.test(telephone)) throw new ErreurApi(400, "telephone_invalide");
    // Un ordre de verrouillage constant évite que deux commandes s'attendent l'une l'autre.
    const lignes = b.lignes.map((l) => ({ ...l, produitId: l.produitId.toLowerCase() })).sort((x, y) => x.produitId.localeCompare(y.produitId));
    if (new Set(lignes.map((l) => l.produitId)).size !== lignes.length) throw new ErreurApi(400, "donnees_invalides");
    const jeton = randomBytes(32).toString("base64url");

    const r = await parBoutique(pool, req.params.org, async (c, bq) => {
      await expirerCommandesWeb(c);
      const { rows: [lieu] } = await c.query(
        "select l.entite_id from lieux_canal l join entites e on e.id = l.entite_id where l.config_id = $1 and l.entite_id = $2 and l.actif and e.actif",
        [bq.configId, b.lieuId],
      );
      if (!lieu) throw new ErreurApi(400, "lieu_invalide");
      const frais = await fraisLivraison(c, bq.branche, b);
      const tiersId = await ficheClient(c, bq, lieu.entite_id, nom, telephone);

      const calcul: { produitId: string; nom: string; quantite: number; ht: number; ttcUnitaire: number; taux: number; totalHt: number; totalTtc: number }[] = [];
      for (const l of lignes) {
        const { rows: [p] } = await c.query(
          "select p.id, p.nom, p.prix_vente, p.taux_taxe::float as taux from produits p where p.id = $1 and p.actif and p.type = 'produit' and entite_branche(p.entite_id) = $2",
          [l.produitId, bq.branche],
        );
        if (!p) throw new ErreurApi(404, "introuvable");
        await produitSuivi(c, p.id);
        const disponible = await quantiteDisponible(c, lieu.entite_id, p.id);
        if (l.quantite > disponible) throw new ErreurApi(409, "stock_insuffisant", { produitId: p.id, disponible: Math.max(disponible, 0) });
        // Le prix de la caisse : paliers, tranches et promotion du jour, sans prix négocié.
        const tranches = await brutTranches(c, p.id, p.prix_vente, l.quantite);
        const ht = await prixProduit(c, p.id, p.prix_vente, l.quantite);
        const total = calculerLigne(l.quantite, ht, 0, p.taux, tranches);
        const unite = calculerLigne(1, ht, 0, p.taux);
        calcul.push({ produitId: p.id, nom: p.nom, quantite: l.quantite, ht, ttcUnitaire: unite.ht + unite.taxes, taux: p.taux, totalHt: total.ht, totalTtc: total.ht + total.taxes });
      }
      const totalHt = calcul.reduce((s, x) => s + x.totalHt, 0);
      const totalTtc = calcul.reduce((s, x) => s + x.totalTtc, 0) + frais;
      const reference = await prochainNumero(c, `WEB-${new Date(Date.now() + 3600000).getUTCFullYear()}`);
      const minutes = b.moyenPaiement === "a_la_livraison" ? DUREE_RESERVATION_LIVRAISON_MINUTES : DUREE_RESERVATION_MINUTES;
      const { rows: [w] } = await c.query(
        `insert into commandes_web (organisation_id, entite_id, lieu_id, tiers_id, reference, jeton_suivi_hache, nom_client, telephone, mode_livraison,
           zone_id, point_relais_id, adresse, note, moyen_paiement, frais_livraison, total_ht, total_ttc, expire_le)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now() + ($18::int * interval '1 minute'))
         returning id, statut, expire_le`,
        [bq.org, bq.branche, lieu.entite_id, tiersId, reference, hacherJeton(jeton), nom, telephone, b.modeLivraison,
          b.zoneId ?? null, b.pointRelaisId ?? null, adresse, b.note?.trim() || null, b.moyenPaiement, frais, totalHt, totalTtc, minutes],
      );
      for (const x of calcul) {
        await c.query(
          `insert into lignes_commande_web (organisation_id, commande_id, produit_id, quantite, prix_unitaire_ht, prix_unitaire_ttc, taux_taxe, total_ht, total_ttc)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [bq.org, w.id, x.produitId, x.quantite, x.ht, x.ttcUnitaire, x.taux, x.totalHt, x.totalTtc],
        );
        await c.query(
          "insert into reservations_stock (organisation_id, entite_id, produit_id, quantite, tiers_id, motif, commande_web_id) values ($1, $2, $3, $4, $5, 'commande_web', $6)",
          [bq.org, lieu.entite_id, x.produitId, x.quantite, tiersId, w.id],
        );
      }
      await publierEvenement(c, "commande_web.creee", { id: w.id, reference, total_ttc: totalTtc });
      return {
        reference, jeton, suivi: `/marketplace/${bq.org}/commandes/${reference}?jeton=${jeton}`,
        statut: w.statut, moyen_paiement: b.moyenPaiement, expire_le: w.expire_le, frais_livraison: frais, total_ttc: totalTtc,
        lignes: calcul.map((x) => ({ produit_id: x.produitId, nom: x.nom, quantite: x.quantite, prix_unitaire_ttc: x.ttcUnitaire, total_ttc: x.totalTtc })),
      };
    });
    return reponse.status(201).send(r);
  });

  /** Ni nom, ni téléphone, ni adresse, ni code de confirmation du colis : le lien de suivi peut circuler. */
  app.get<{ Params: { org: string; reference: string }; Querystring: { jeton?: string } }>("/marketplace/:org/commandes/:reference", {
    config: parMinute(60),
    schema: { querystring: { type: "object", properties: { jeton: { type: "string", maxLength: 100 } } } },
  }, async (req) => {
    const jeton = req.query.jeton ?? "";
    if (!REFERENCE.test(req.params.reference) || !JETON.test(jeton)) throw new ErreurApi(404, "introuvable");
    return parBoutique(pool, req.params.org, async (c, b) => {
      const { rows: [w] } = await c.query(
        "select id from commandes_web where reference = $1 and jeton_suivi_hache = $2 and entite_id = $3", [req.params.reference, hacherJeton(jeton), b.branche],
      );
      const detail = w ? await detailCommandeWeb(c, b, w.id, urlPublique) : null;
      if (!detail) throw new ErreurApi(404, "introuvable");
      return detail;
    });
  });

  // ---------- Traitement par le personnel ----------

  app.get("/commandes-web/lieux", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "facturation.voir");
      const branches = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "facturation.voir")).map((e) => e.id);
      return (await ctx.client.query(
        `select distinct w.lieu_id as id, coalesce(l.nom_public, e.nom) as nom
         from commandes_web w
         join entites e on e.id = w.lieu_id
         left join config_canal k on k.entite_id = w.entite_id
         left join lieux_canal l on l.config_id = k.id and l.entite_id = w.lieu_id
         where w.entite_id = any($1::uuid[])
         order by nom, id`,
        [branches],
      )).rows;
    }),
  );

  app.get<{ Querystring: { statut?: string; lieu?: string; aPreparer?: boolean } }>("/commandes-web", {
    schema: { querystring: { type: "object", properties: {
      statut: { type: "string", enum: STATUTS }, lieu: uuid, aPreparer: { type: "boolean" },
    } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "facturation.voir");
      await expirerCommandesWeb(ctx.client);
      const branches = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "facturation.voir")).map((e) => e.id);
      return (await ctx.client.query(
        `select w.id, w.reference, w.statut, coalesce(l.nom_public, e.nom) as lieu, w.nom_client, w.telephone, w.mode_livraison, w.moyen_paiement,
           w.total_ttc, w.expire_le, w.colis_id, w.cree_le
         from commandes_web w
         left join entites e on e.id = w.lieu_id
         left join config_canal k on k.entite_id = w.entite_id
         left join lieux_canal l on l.config_id = k.id and l.entite_id = w.lieu_id
         where w.entite_id = any($1::uuid[]) and ($2::text is null or w.statut = $2)
           and ($3::uuid is null or w.lieu_id = $3)
           and (not $4::boolean or (w.statut = 'reservee' and w.colis_id is null))
         order by (w.statut = 'reservee' and w.colis_id is null) desc, w.cree_le desc limit 300`,
        [branches, req.query.statut ?? null, req.query.lieu ?? null, req.query.aPreparer ?? false],
      )).rows;
    }),
  );

  app.get<{ Params: { id: string } }>("/commandes-web/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [w] } = await ctx.client.query(
        `select w.id, w.entite_id, w.reference, w.statut, w.lieu_id, coalesce(l.nom_public, e.nom) as lieu, w.tiers_id, t.nom as client, w.nom_client, w.telephone,
           w.mode_livraison, w.zone_id, z.nom as zone, w.point_relais_id, r.nom as point_relais, w.adresse, w.note, w.moyen_paiement, w.canal,
           w.frais_livraison, w.total_ht, w.total_ttc, w.expire_le, w.motif, w.traite_par, w.traite_le, w.cree_le,
           case when x.id is null then null else json_build_object('id', x.id, 'numero', x.numero, 'statut', x.statut, 'a_encaisser', x.a_encaisser) end as colis
         from commandes_web w
         join tiers t on t.id = w.tiers_id
         left join entites e on e.id = w.lieu_id
         left join config_canal k on k.entite_id = w.entite_id
         left join lieux_canal l on l.config_id = k.id and l.entite_id = w.lieu_id
         left join zones_livraison z on z.id = w.zone_id
         left join points_relais r on r.id = w.point_relais_id
         left join colis x on x.id = w.colis_id
         where w.id = $1`,
        [req.params.id],
      );
      if (!w) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "facturation.voir", w.entite_id);
      const { rows: lignes } = await ctx.client.query(
        `select l.id, l.produit_id, p.nom, l.quantite, l.prix_unitaire_ht, l.prix_unitaire_ttc, l.taux_taxe::float as taux_taxe, l.total_ht, l.total_ttc
         from lignes_commande_web l join produits p on p.id = l.produit_id where l.commande_id = $1 order by p.nom`,
        [w.id],
      );
      const { rows: paiements } = await ctx.client.query(
        "select reference_prestataire, moyen, montant, statut, motif, lance_le, traite_le from paiements_en_ligne where commande_id = $1 order by lance_le",
        [w.id],
      );
      const { rows: [plus] } = await ctx.client.query(
        `select f.numero as facture, u.nom as responsable from commandes_web w
         left join documents_vente f on f.id = w.facture_id
         left join config_canal k on k.entite_id = w.entite_id left join utilisateurs u on u.id = k.responsable_id
         where w.id = $1`,
        [w.id],
      );
      return { ...w, ...plus, lignes, paiements };
    }),
  );

  /** Paiement à la livraison : le commercial a joint le client, le colis « à encaisser » part de la branche. */
  app.post<{ Params: { id: string } }>("/commandes-web/:id/confirmer", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [w] } = await ctx.client.query("select *, expire_le > now() as en_cours from commandes_web where id = $1 for update", [req.params.id]);
      if (!w) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "facturation.gerer", w.entite_id);
      if (w.moyen_paiement !== "a_la_livraison") throw new ErreurApi(409, "confirmation_impossible");
      if (w.statut !== "reservee" || w.colis_id || !w.en_cours) throw new ErreurApi(409, "commande_non_modifiable");
      let adresse: string | undefined = w.adresse ?? undefined;
      if (w.point_relais_id) {
        const { rows: [p] } = await ctx.client.query("select nom, adresse from points_relais where id = $1", [w.point_relais_id]);
        adresse = [p.nom, p.adresse].filter(Boolean).join(", ");
      }
      const colis = await creerColis(ctx, {
        entiteId: w.entite_id, destinataire: w.nom_client, telephone: w.telephone, adresse, zoneId: w.zone_id ?? undefined, aEncaisser: w.total_ttc,
      });
      await ctx.client.query("update commandes_web set colis_id = $2, traite_par = $3, traite_le = now() where id = $1", [w.id, colis.id, ctx.utilisateurId]);
      await publierEvenement(ctx.client, "commande_web.confirmee", { id: w.id, reference: w.reference, colis_id: colis.id });
      return { statut: w.statut, colis: { id: colis.id, numero: colis.numero, lien_suivi: lienColis(ctx.organisationId, colis.code_suivi) } };
    }),
  );

  /** Le colis éventuel n'est pas touché : son retour suit le circuit des colis. */
  app.post<{ Params: { id: string }; Body: { motif: string } }>("/commandes-web/:id/annuler", {
    schema: { params: paramId, body: { type: "object", required: ["motif"], properties: { motif: { type: "string", minLength: 3, maxLength: 500 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const motif = req.body.motif.trim();
      if (motif.length < 3) throw new ErreurApi(400, "donnees_invalides");
      const { rows: [w] } = await ctx.client.query(
        "select w.id, w.entite_id, w.reference, w.statut, w.colis_id, k.statut as colis_statut from commandes_web w left join colis k on k.id = w.colis_id where w.id = $1 for update of w",
        [req.params.id],
      );
      if (!w) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "facturation.gerer", w.entite_id);
      if (w.statut !== "reservee" || (w.colis_id && !COLIS_ANNULABLE.includes(w.colis_statut))) throw new ErreurApi(409, "commande_non_modifiable");
      await leverReservations(ctx.client, w.id);
      await ctx.client.query("update commandes_web set statut = 'annulee', motif = $2, traite_par = $3, traite_le = now() where id = $1", [w.id, motif, ctx.utilisateurId]);
      await publierEvenement(ctx.client, "commande_web.annulee", { id: w.id, reference: w.reference, motif });
      return { statut: "annulee" };
    }),
  );
}
