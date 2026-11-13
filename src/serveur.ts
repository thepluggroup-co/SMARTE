import { join } from "node:path";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import QRCode from "qrcode";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import pg from "pg";
import { dansOrganisation, definirActeur, publierEvenement, type Client } from "./base.js";
import { MODULES, moduleCompatible, moduleRequis, ROLE_SUPER, type Permission } from "./catalogue.js";
import {
  aPermission, aPermissionGlobale, aPermissionSurEntite, entitesAccessibles,
} from "./permissions.js";
import { enregistrerFormations } from "./formations.js";
import { enregistrerAchats } from "./achats.js";
import { enregistrerTableau } from "./tableau.js";
import { enregistrerImages } from "./images.js";
import { enregistrerPerformance } from "./performance.js";
import { enregistrerFiches } from "./fiches.js";
import { enregistrerOkr } from "./okr.js";
import { enregistrerEntrepots } from "./entrepots.js";
import { enregistrerArticles } from "./articles.js";
import { enregistrerRetours } from "./retours.js";
import { enregistrerRapports } from "./rapports.js";
import { enregistrerAvis } from "./avis.js";
import { enregistrerIndicateurs } from "./indicateurs.js";
import { enregistrerImpact } from "./impact.js";
import { enregistrerFacturation } from "./facturation.js";
import { enregistrerApprentissage } from "./apprentissage.js";
import { enregistrerCaisse } from "./caisse.js";
import { enregistrerMagasins } from "./magasins.js";
import { enregistrerCoaching } from "./coaching.js";
import { enregistrerCommerce } from "./commerce.js";
import { enregistrerComptabilite } from "./comptabilite.js";
import { enregistrerControle, type OptionsEnvoi } from "./controle.js";
import { enregistrerAutomatisation } from "./automatisation.js";
import { enregistrerDocuments } from "./documents.js";
import { enregistrerFinitions } from "./finitions.js";
import { enregistrerLogistique } from "./logistique.js";
import { enregistrerPedagogie } from "./pedagogie.js";
import { enregistrerFiscalite } from "./fiscalite.js";
import { enregistrerManifestations } from "./manifestations.js";
import { enregistrerScolariteEtPaie } from "./scolarite.js";
import { enregistrerPromotions } from "./commerce.js";
import { enregistrerProspection } from "./prospection.js";
import { enregistrerRecouvrement } from "./recouvrement.js";
import { enregistrerSocle } from "./socle.js";
import { enregistrerFournisseurs } from "./fournisseurs.js";
import { enregistrerMall } from "./mall.js";
import { enregistrerPilotage } from "./pilotage.js";
import { enregistrerRh } from "./rh.js";
import { enregistrerTresorerie } from "./tresorerie.js";
import { enregistrerUniversite } from "./universite.js";
import { enregistrerStudio, type GenerateurIa } from "./studio.js";
import { enregistrerRelation } from "./relation.js";
import { branchesVisibles, exigerTiersVisible } from "./tiers.js";
import { enregistrerStocks } from "./stocks.js";
import {
  chiffrer, creerJeton, creerSecretTotp, dechiffrer, hacherJeton, hacherMotDePasse, hashFictif,
  normaliserTelephone, verifierMotDePasse, verifierTotp,
} from "./securite.js";

const DUREE_SESSION_HEURES = 12;
const ECHECS_MAX = 5;
const VERROU_MINUTES = 15;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ErreurApi extends Error {
  constructor(public statut: number, public code: string, public details?: unknown) {
    super(code);
  }
}

export type TachePlanifiee = (organisationId: string) => Promise<void>;
declare module "fastify" { interface FastifyInstance { executerTaches: (organisationId: string) => Promise<void>; pousserWebhooks?: () => Promise<void> } }
export interface Contexte {
  client: Client;
  utilisateurId: string;
  organisationId: string;
}

export interface OptionsServeur {
  /** Clé de 32 octets qui chiffre les secrets de double authentification. */
  cleSecrets: Buffer;
  /** Adresse publique, utilisée dans le QR code des certificats. */
  urlPublique: string;
  /** Tentatives de connexion par adresse IP et par minute. */
  connexionsParMinute?: number;
  /** Vrai seulement derrière un proxy de confiance. */
  derriereProxy?: boolean;
  /** Dossier des vidéos de cours. Sans lui, seuls les liens externes restent possibles. */
  dossierMedias?: string;
  videoMaxOctets?: number;
  /** Sans lui, le studio IA reste indisponible et le reste fonctionne normalement. */
  generateurIa?: GenerateurIa;
  quotaApiParMinute?: number;
  /** Console de la plateforme : fermée tant que ces deux réglages manquent. */
  cleConsole?: string;
  poolAdmin?: pg.Pool;
  /** Fonctions d'envoi remplaçables, pour les essais. */
  envoiWebhooks?: OptionsEnvoi;
  /** Vrai en production : les webhooks partent seuls. */
  webhooksAuto?: boolean;
}

export interface Outils {
  protege: <T>(req: FastifyRequest, fn: (ctx: Contexte) => Promise<T>) => Promise<T>;
  exigerSurEntite: (ctx: Contexte, permission: Permission, entiteId: string) => Promise<void>;
  exiger: (ctx: Contexte, permission: Permission) => Promise<void>;
}

const paramId = {
  type: "object", required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
} as const;

export async function creerServeur(pool: pg.Pool, options: OptionsServeur): Promise<FastifyInstance> {
  if (options.cleSecrets.length !== 32) throw new Error("La clé des secrets doit faire 32 octets");
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    trustProxy: options.derriereProxy ?? false,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: true,
      // La caméra sert seulement à lire les codes-barres, sur ce site.
      directives: { "media-src": ["'self'", "blob:"] },
    },
  });
  await app.register(rateLimit, { global: false });
  // La description de l'API se génère à partir des schémas des routes : elle suit le code.
  await app.register(swagger, { openapi: { info: { title: "Smarte Solutions", version: "1.0.0", description: "API de l'ERP. Authentification par jeton obtenu à la connexion." }, components: { securitySchemes: { jeton: { type: "http", scheme: "bearer" } } }, security: [{ jeton: [] }] } });
  app.get("/api/openapi.json", { schema: { hide: true } }, async () => app.swagger());
  await app.register(fastifyStatic, { root: join(import.meta.dirname, "..", "public") });

  app.setErrorHandler((erreur: any, req, reponse) => {
    if (erreur instanceof ErreurApi) {
      return reponse.status(erreur.statut).send({ erreur: erreur.code, details: erreur.details });
    }
    if (erreur.validation) return reponse.status(400).send({ erreur: "donnees_invalides" });
    if (erreur.statusCode === 429) return reponse.status(429).send({ erreur: "trop_de_tentatives" });
    if (erreur.statusCode >= 400 && erreur.statusCode < 500) {
      return reponse.status(erreur.statusCode).send({ erreur: "requete_invalide" });
    }
    if (erreur.code === "RP001") return reponse.status(409).send({ erreur: "reference_deja_utilisee" });
    if (erreur.code === "23505") return reponse.status(409).send({ erreur: "existe_deja" });
    if (erreur.code === "23503") return reponse.status(400).send({ erreur: "reference_invalide" });
    req.log.error(erreur);
    return reponse.status(500).send({ erreur: "erreur_interne" });
  });

  /** Authentifie la requête et l'exécute entièrement dans le cloisonnement de son organisation. */
  const echecsParAdresse = new Map<string, { n: number; jusqu: number }>();
  const quotasApi = new Map<string, { depuis: number; nombre: number }>();
  async function protege<T>(req: FastifyRequest, fn: (ctx: Contexte) => Promise<T>): Promise<T> {
    const entete = req.headers.authorization ?? "";
    const jeton = entete.startsWith("Bearer ") ? entete.slice(7) : "";
    const organisationId = jeton.split(".")[0] ?? "";
    if (!UUID.test(organisationId)) throw new ErreurApi(401, "non_authentifie");
    return dansOrganisation(pool, organisationId, async (client) => {
      const empreinte = hacherJeton(jeton);
      const { rows } = await client.query(
        `select s.utilisateur_id from sessions s
         join utilisateurs u on u.id = s.utilisateur_id
         join organisations o on o.id = s.organisation_id
         where s.jeton_hash = $1 and s.expire_le > now() and u.actif and o.statut = 'active'`,
        [empreinte],
      );
      let utilisateurId = rows[0]?.utilisateur_id as string | undefined;
      if (!utilisateurId) {
        // Une clé d'API agit avec les seuls droits de son compte, sous un quota.
        const { rows: cles } = await client.query(
          `select c.id, c.utilisateur_id from cles_api c join utilisateurs u on u.id = c.utilisateur_id join organisations o on o.id = c.organisation_id
           where c.cle_hash = $1 and c.revoquee_le is null and (c.expire_le is null or c.expire_le > now()) and u.actif and o.statut = 'active'`,
          [empreinte],
        );
        if (!cles[0]) throw new ErreurApi(401, "non_authentifie");
        const maintenant = Date.now();
        const q = quotasApi.get(cles[0].id);
        if (q && maintenant - q.depuis < 60000) {
          q.nombre += 1;
          if (q.nombre > (options.quotaApiParMinute ?? 300)) throw new ErreurApi(429, "quota_depasse");
        } else {
          quotasApi.set(cles[0].id, { depuis: maintenant, nombre: 1 });
        }
        await client.query("update cles_api set utilisee_le = now() where id = $1", [cles[0].id]);
        utilisateurId = cles[0].utilisateur_id as string;
      }
      await definirActeur(client, utilisateurId);
      return fn({ client, utilisateurId, organisationId });
    });
  }

  async function exiger(ctx: Contexte, permission: Permission): Promise<void> {
    if (!(await aPermission(ctx.client, ctx.utilisateurId, permission))) {
      throw new ErreurApi(403, "permission_refusee");
    }
  }

  async function exigerSurEntite(ctx: Contexte, permission: Permission, entiteId: string) {
    const existe = await ctx.client.query("select 1 from entites where id = $1", [entiteId]);
    if (!existe.rows[0]) throw new ErreurApi(404, "introuvable");
    if (!(await aPermissionSurEntite(ctx.client, ctx.utilisateurId, permission, entiteId))) {
      throw new ErreurApi(403, "permission_refusee");
    }
  }

  async function exigerGlobale(ctx: Contexte, permission: Permission): Promise<void> {
    if (!(await aPermissionGlobale(ctx.client, ctx.utilisateurId, permission))) {
      throw new ErreurApi(403, "permission_refusee");
    }
  }

  app.get("/sante", async () => ({ statut: "ok" }));
  // Une organisation suspendue ferme aussi ses pages publiques.
  app.addHook("onRequest", async (req) => {
    if (!/^\/(capture|offre-public|reservation-coaching|evenement-public|boutique|apprendre|portail|avis-public|evaluer)\//.test(req.url)) return;
    const m = decodeURIComponent(req.url).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    if (!m) return;
    const { rows } = await pool.query("select statut from registre_organisations where id = $1", [m[0]]);
    if (rows[0] && rows[0].statut !== "active") throw new ErreurApi(404, "introuvable");
  });

  app.post<{ Body: { organisation: string; email: string; motDePasse: string; code?: string } }>("/connexion", {
    config: {
      rateLimit: {
        max: options.connexionsParMinute ?? 20,
        timeWindow: "1 minute",
        errorResponseBuilder: () => ({ statusCode: 429, erreur: "trop_de_tentatives" }),
      },
    },
    schema: {
      body: {
        type: "object", required: ["organisation", "email", "motDePasse"],
        properties: {
          organisation: { type: "string", maxLength: 100 },
          email: { type: "string", maxLength: 320 },
          motDePasse: { type: "string", maxLength: 200 },
          code: { type: "string", maxLength: 10 },
        },
      },
    },
  }, async (req, reponse) => {
    const refus = () => reponse.status(401).send({ erreur: "identifiants_invalides" });
    const email = req.body.email.trim().toLowerCase();
    const org = await pool.query("select organisation_active_par_slug($1) as id", [req.body.organisation]);
    const organisationId: string | null = org.rows[0].id;
    if (!organisationId) {
      await verifierMotDePasse(req.body.motDePasse, await hashFictif);
      return refus();
    }

    const resultat = await dansOrganisation(pool, organisationId, async (c) => {
      const { rows } = await c.query(
        `select id, mot_de_passe_hash, actif, totp_actif, totp_secret_chiffre, totp_dernier_pas,
                coalesce(verrouille_jusqu > now(), false) as verrouille
         from utilisateurs where email = $1 for update`,
        [email],
      );
      const u = rows[0];
      const clePaire = `${u?.id ?? email}|${req.ip}`;
      const paire = echecsParAdresse.get(clePaire);
      const paireBloquee = !!paire && paire.jusqu > Date.now();
      const correct = await verifierMotDePasse(req.body.motDePasse, u?.mot_de_passe_hash ?? (await hashFictif));
      if (paireBloquee) { await c.query("select journal_evenement('connexion.echec', $1)", [JSON.stringify({ email, bloque: true })]); return null; }
      if (u?.actif && !u.verrouille && correct && u.totp_actif && !req.body.code) return "code_requis" as const;
      const pasTotp = u?.totp_actif && correct && req.body.code
        ? verifierTotp(dechiffrer(u.totp_secret_chiffre, options.cleSecrets), req.body.code, u.totp_dernier_pas)
        : null;
      if (!u || !u.actif || u.verrouille || !correct || (u.totp_actif && pasTotp === null)) {
        // Cinq échecs bloquent ce compte depuis cette adresse. Le verrou général, bien plus haut, ne peut pas servir à bloquer un collègue.
        const n = (paire && paire.jusqu <= Date.now() && paire.jusqu ? 0 : paire?.n ?? 0) + 1;
        if (echecsParAdresse.size > 50000) echecsParAdresse.clear();
        echecsParAdresse.set(clePaire, { n: n >= ECHECS_MAX ? 0 : n, jusqu: n >= ECHECS_MAX ? Date.now() + VERROU_MINUTES * 60000 : 0 });
        if (u && !u.verrouille) {
          await c.query(
            `update utilisateurs set
               echecs_connexion = case when echecs_connexion + 1 >= $2 then 0 else echecs_connexion + 1 end,
               verrouille_jusqu = case when echecs_connexion + 1 >= $2
                 then now() + make_interval(mins => $3) else verrouille_jusqu end
             where id = $1`,
            [u.id, ECHECS_MAX * 20, VERROU_MINUTES],
          );
        }
        await c.query("select journal_evenement('connexion.echec', $1)", [JSON.stringify({ email })]);
        return null;
      }
      echecsParAdresse.delete(clePaire);
      await definirActeur(c, u.id);
      await c.query(
        `update utilisateurs set echecs_connexion = 0, verrouille_jusqu = null, derniere_connexion = now(),
           totp_dernier_pas = coalesce($2, totp_dernier_pas) where id = $1`,
        [u.id, pasTotp],
      );
      const { jeton, hash } = creerJeton(organisationId);
      await c.query(
        `insert into sessions (organisation_id, utilisateur_id, jeton_hash, expire_le)
         values ($1, $2, $3, now() + make_interval(hours => $4))`,
        [organisationId, u.id, hash, DUREE_SESSION_HEURES],
      );
      await c.query("select journal_evenement('connexion.reussie', '{}'::jsonb)");
      return jeton;
    });
    if (resultat === "code_requis") return reponse.status(401).send({ erreur: "code_2fa_requis" });
    return resultat ? { jeton: resultat } : refus();
  });

  app.post("/2fa/activation", async (req) =>
    protege(req, async ({ client, utilisateurId }) => {
      const { rows } = await client.query("select email, totp_actif from utilisateurs where id = $1", [utilisateurId]);
      if (rows[0].totp_actif) throw new ErreurApi(409, "2fa_deja_active");
      const secret = creerSecretTotp();
      await client.query("update utilisateurs set totp_secret_chiffre = $2 where id = $1", [
        utilisateurId, chiffrer(secret, options.cleSecrets),
      ]);
      const compte = encodeURIComponent(`Smarte Solutions:${rows[0].email}`);
      const uri = `otpauth://totp/${compte}?secret=${secret}&issuer=Smarte%20Solutions&digits=6&period=30`;
      return { secret, uri, qr_svg: await QRCode.toString(uri, { type: "svg", margin: 1 }) };
    }),
  );

  app.post<{ Body: { code: string } }>("/2fa/confirmation", {
    schema: {
      body: { type: "object", required: ["code"], properties: { code: { type: "string", maxLength: 10 } } },
    },
  }, async (req) =>
    protege(req, async ({ client, utilisateurId }) => {
      const { rows } = await client.query(
        "select totp_secret_chiffre, totp_actif, totp_dernier_pas from utilisateurs where id = $1", [utilisateurId],
      );
      const u = rows[0];
      if (!u.totp_secret_chiffre || u.totp_actif) throw new ErreurApi(409, "activation_non_demandee");
      const pas = verifierTotp(dechiffrer(u.totp_secret_chiffre, options.cleSecrets), req.body.code, u.totp_dernier_pas);
      if (pas === null) throw new ErreurApi(400, "code_invalide");
      await client.query("update utilisateurs set totp_actif = true, totp_dernier_pas = $2 where id = $1", [utilisateurId, pas]);
      return { active: true };
    }),
  );

  // Pour un téléphone perdu : réservé à un administrateur de toute l'organisation.
  app.post<{ Params: { id: string } }>("/utilisateurs/:id/2fa/reinitialisation", { schema: { params: paramId } }, async (req, reponse) => {
    await protege(req, async (ctx) => {
      await exigerGlobale(ctx, "utilisateurs.gerer");
      const r = await ctx.client.query(
        "update utilisateurs set totp_actif = false, totp_secret_chiffre = null, totp_dernier_pas = null where id = $1 returning id",
        [req.params.id],
      );
      if (!r.rows[0]) throw new ErreurApi(404, "introuvable");
      await ctx.client.query("select journal_evenement('2fa.reinitialisee', $1)", [JSON.stringify({ utilisateur: req.params.id })]);
    });
    return reponse.status(204).send();
  });

  app.post("/deconnexion", async (req, reponse) => {
    await protege(req, ({ client }) =>
      client.query("delete from sessions where jeton_hash = $1", [
        hacherJeton((req.headers.authorization ?? "").slice(7)),
      ]),
    );
    return reponse.status(204).send();
  });

  /** Chacun change son propre mot de passe, en donnant l'actuel. Les autres sessions sont fermées. */
  app.post<{ Body: { actuel: string; nouveau: string } }>("/moi/mot-de-passe", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: { body: { type: "object", required: ["actuel", "nouveau"], properties: { actuel: { type: "string", maxLength: 200 }, nouveau: { type: "string", minLength: 8, maxLength: 200 } } } },
  }, async (req) => {
    const hash = await hacherMotDePasse(req.body.nouveau);
    return protege(req, async ({ client, utilisateurId }) => {
      const { rows: [u] } = await client.query("select mot_de_passe_hash from utilisateurs where id = $1", [utilisateurId]);
      if (!(await verifierMotDePasse(req.body.actuel, u.mot_de_passe_hash))) throw new ErreurApi(400, "mot_de_passe_incorrect");
      await client.query("update utilisateurs set mot_de_passe_hash = $2, mot_de_passe_provisoire = false where id = $1", [utilisateurId, hash]);
      await client.query("delete from sessions where utilisateur_id = $1 and jeton_hash <> $2", [utilisateurId, hacherJeton((req.headers.authorization ?? "").slice(7))]);
      await client.query("select journal_evenement('securite.mot_de_passe_change', '{}')");
      return { modifie: true };
    });
  });

  app.get("/moi", async (req) =>
    protege(req, async ({ client, utilisateurId }) => {
      const u = await client.query("select id, email, nom, totp_actif, mot_de_passe_provisoire from utilisateurs where id = $1", [utilisateurId]);
      const permissions = await client.query(
        `select distinct r.code as role, a.entite_id from attributions a join roles r on r.id = a.role_id
         where a.utilisateur_id = $1 and (a.expire_le is null or a.expire_le > now())`,
        [utilisateurId],
      );
      const droits = await client.query(
        `select distinct rp.permission from attributions a join role_permissions rp on rp.role_id = a.role_id
         where a.utilisateur_id = $1 and (a.expire_le is null or a.expire_le > now())`,
        [utilisateurId],
      );
      // Seuls les droits réellement utilisables : l'écran n'affiche rien que la personne ne peut pas ouvrir.
      const effectives: string[] = [];
      for (const { permission } of droits.rows) {
        if (await aPermission(client, utilisateurId, permission)) effectives.push(permission);
      }
      return { ...u.rows[0], attributions: permissions.rows, permissions: effectives };
    }),
  );

  app.get("/entites", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "entites.voir");
      return entitesAccessibles(ctx.client, ctx.utilisateurId, "entites.voir");
    }),
  );

  app.post<{ Body: { parentId: string; code: string; nom: string; type: string } }>("/entites", {
    schema: {
      body: {
        type: "object", required: ["parentId", "code", "nom", "type"],
        properties: {
          parentId: { type: "string", format: "uuid" },
          code: { type: "string", minLength: 1, maxLength: 40 },
          nom: { type: "string", minLength: 1, maxLength: 200 },
          type: { type: "string", maxLength: 40 },
        },
      },
    },
  }, async (req, reponse) => {
    const entite = await protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "entites.gerer", req.body.parentId);
      const { rows } = await ctx.client.query(
        `insert into entites (organisation_id, parent_id, code, nom, type, domaine)
         values ($1, $2, $3, $4, $5, (select domaine from entites where id = $2)) returning id, parent_id, code, nom, type, domaine, actif`,
        [ctx.organisationId, req.body.parentId, req.body.code, req.body.nom, req.body.type],
      );
      await publierEvenement(ctx.client, "entite.creee", { id: rows[0].id });
      return rows[0];
    });
    return reponse.status(201).send(entite);
  });

  app.get<{ Params: { id: string } }>("/entites/:id/modules", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "entites.voir", req.params.id);
      const { rows } = await ctx.client.query(
        "select module, actif from modules_entite where entite_id = $1", [req.params.id],
      );
      const actifs = new Map(rows.map((r) => [r.module, r.actif]));
      return MODULES.map((module) => ({ module, actif: actifs.get(module) ?? false }));
    }),
  );

  app.put<{ Params: { id: string; module: string }; Body: { actif: boolean } }>("/entites/:id/modules/:module", {
    schema: {
      params: {
        type: "object", required: ["id", "module"],
        properties: { id: { type: "string", format: "uuid" }, module: { type: "string", enum: [...MODULES] } },
      },
      body: { type: "object", required: ["actif"], properties: { actif: { type: "boolean" } } },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "modules.gerer", req.params.id);
      const { rows: [e] } = await ctx.client.query("select domaine from entites where id = $1", [req.params.id]);
      if (req.body.actif && !moduleCompatible(e.domaine, req.params.module)) throw new ErreurApi(409, "module_incompatible");
      await ctx.client.query(
        `insert into modules_entite (organisation_id, entite_id, module, actif) values ($1, $2, $3, $4)
         on conflict (organisation_id, entite_id, module)
         do update set actif = excluded.actif, modifie_le = now()`,
        [ctx.organisationId, req.params.id, req.params.module, req.body.actif],
      );
      await publierEvenement(ctx.client, "module.modifie", {
        entiteId: req.params.id, module: req.params.module, actif: req.body.actif,
      });
      return { module: req.params.module, actif: req.body.actif };
    }),
  );

  app.get("/roles", async (req) =>
    protege(req, async (ctx) => {
      await exigerGlobale(ctx, "utilisateurs.gerer");
      const { rows } = await ctx.client.query(
        `select r.id, r.code, r.nom, array_agg(p.permission order by p.permission) as permissions
         from roles r left join role_permissions p on p.role_id = r.id group by r.id order by r.nom`,
      );
      return rows;
    }),
  );

  /**
   * Seul celui qui gère les utilisateurs sur toute l'organisation donne des accès.
   * Le droit s'applique seulement là où le module est actif : un magasinier n'a pas sa place à GTA.
   */
  const verifierAttribution = async (ctx: Contexte, roleId: string, entiteId?: string) => {
    await exigerGlobale(ctx, "utilisateurs.gerer");
    const role = await ctx.client.query("select code from roles where id = $1", [roleId]);
    if (!role.rows[0]) throw new ErreurApi(404, "introuvable");
    if (role.rows[0].code === ROLE_SUPER && entiteId) throw new ErreurApi(400, "super_sur_toute_organisation");
    if (entiteId) {
      const existe = await ctx.client.query("select 1 from entites where id = $1", [entiteId]);
      if (!existe.rows[0]) throw new ErreurApi(404, "introuvable");
    }
    const droits = await ctx.client.query("select permission from role_permissions where role_id = $1", [roleId]);
    let utile = false;
    let specifique = false;
    for (const { permission } of droits.rows) {
      // Personne ne peut accorder un droit qu'il ne possède pas lui-même.
      if (!(await aPermissionGlobale(ctx.client, ctx.utilisateurId, permission))) throw new ErreurApi(403, "permission_refusee");
      if (moduleRequis(permission)) {
        specifique = true;
        if (!entiteId || await aPermissionSurEntite(ctx.client, ctx.utilisateurId, permission, entiteId)) utile = true;
      } else if (!["entites.voir", "tiers.voir", "tiers.creer", "tiers.modifier"].includes(permission)) {
        utile = true;
      }
    }
    if (specifique && !utile) throw new ErreurApi(409, "role_incompatible");
  };

  app.post<{
    Body: { email: string; nom: string; motDePasse: string; roleId: string; entiteId?: string };
  }>("/utilisateurs", {
    schema: {
      body: {
        type: "object", required: ["email", "nom", "motDePasse", "roleId"],
        properties: {
          email: { type: "string", format: "email", maxLength: 320 },
          nom: { type: "string", minLength: 1, maxLength: 200 },
          motDePasse: { type: "string", minLength: 8, maxLength: 200 },
          roleId: { type: "string", format: "uuid" },
          entiteId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req, reponse) => {
    const hash = await hacherMotDePasse(req.body.motDePasse);
    const utilisateur = await protege(req, async (ctx) => {
      const { entiteId, roleId } = req.body;
      await verifierAttribution(ctx, roleId, entiteId);
      const { rows: [limite] } = await ctx.client.query("select p.max_utilisateurs as m, (select count(*)::int from utilisateurs where actif) as n from abonnements a join plans_saas p on p.code = a.plan");
      if (limite?.m && limite.n >= limite.m) throw new ErreurApi(409, "limite_utilisateurs");
      const u = await ctx.client.query(
        `insert into utilisateurs (organisation_id, email, nom, mot_de_passe_hash, mot_de_passe_provisoire)
         values ($1, $2, $3, $4, true) returning id, email, nom`,
        [ctx.organisationId, req.body.email.toLowerCase(), req.body.nom, hash],
      );
      await ctx.client.query(
        "insert into attributions (organisation_id, utilisateur_id, role_id, entite_id) values ($1, $2, $3, $4)",
        [ctx.organisationId, u.rows[0].id, roleId, entiteId ?? null],
      );
      return u.rows[0];
    });
    return reponse.status(201).send(utilisateur);
  });

  app.get("/utilisateurs", async (req) =>
    protege(req, async (ctx) => {
      await exigerGlobale(ctx, "utilisateurs.gerer");
      const { rows } = await ctx.client.query(
        `select u.id, u.nom, u.email, u.actif, u.totp_actif, u.derniere_connexion,
           coalesce(json_agg(json_build_object('id', a.id, 'role', r.nom, 'role_code', r.code, 'entite', e.nom, 'expire_le', a.expire_le)
             order by r.nom) filter (where a.id is not null), '[]') as acces
         from utilisateurs u left join attributions a on a.utilisateur_id = u.id
         left join roles r on r.id = a.role_id left join entites e on e.id = a.entite_id
         group by u.id order by u.nom limit 1000`,
      );
      return rows;
    }),
  );

  app.post<{ Params: { id: string }; Body: { roleId: string; entiteId?: string; expireLe?: string } }>("/utilisateurs/:id/acces", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["roleId"],
        properties: { roleId: { type: "string", format: "uuid" }, entiteId: { type: "string", format: "uuid" }, expireLe: { type: "string", format: "date" } },
      },
    },
  }, async (req, reponse) => {
    const a = await protege(req, async (ctx) => {
      await verifierAttribution(ctx, req.body.roleId, req.body.entiteId);
      const u = await ctx.client.query("select 1 from utilisateurs where id = $1", [req.params.id]);
      if (!u.rows[0]) throw new ErreurApi(404, "introuvable");
      const { rows } = await ctx.client.query(
        // Une délégation prend fin à la fin du jour choisi, heure de Douala.
        `insert into attributions (organisation_id, utilisateur_id, role_id, entite_id, expire_le)
         values ($1, $2, $3, $4, ($5::date + 1)::timestamp at time zone 'Africa/Douala') returning id`,
        [ctx.organisationId, req.params.id, req.body.roleId, req.body.entiteId ?? null, req.body.expireLe ?? null],
      );
      return rows[0];
    });
    return reponse.status(201).send(a);
  });

  /** L'organisation garde toujours au moins un super administrateur actif. */
  const exigerAutreSuper = async (ctx: Contexte, utilisateurId: string) => {
    const { rows } = await ctx.client.query(
      `select count(distinct a.utilisateur_id)::int as n from attributions a join roles r on r.id = a.role_id
       join utilisateurs u on u.id = a.utilisateur_id
       where r.code = $1 and u.actif and a.utilisateur_id <> $2`,
      [ROLE_SUPER, utilisateurId],
    );
    if (rows[0].n === 0) throw new ErreurApi(409, "dernier_super_administrateur");
  };

  app.delete<{ Params: { id: string } }>("/acces/:id", { schema: { params: paramId } }, async (req, reponse) => {
    await protege(req, async (ctx) => {
      await exigerGlobale(ctx, "utilisateurs.gerer");
      const { rows } = await ctx.client.query(
        `select a.utilisateur_id, r.code from attributions a join roles r on r.id = a.role_id where a.id = $1 for update of a`,
        [req.params.id],
      );
      if (!rows[0]) throw new ErreurApi(404, "introuvable");
      if (rows[0].code === ROLE_SUPER) await exigerAutreSuper(ctx, rows[0].utilisateur_id);
      await ctx.client.query("delete from attributions where id = $1", [req.params.id]);
    });
    return reponse.status(204).send();
  });

  /** Désactiver coupe aussi les sessions en cours. */
  app.patch<{ Params: { id: string }; Body: { actif?: boolean; motDePasse?: string } }>("/utilisateurs/:id", {
    schema: {
      params: paramId,
      body: {
        type: "object", minProperties: 1,
        properties: { actif: { type: "boolean" }, motDePasse: { type: "string", minLength: 8, maxLength: 200 } },
      },
    },
  }, async (req) => {
    const hash = req.body.motDePasse ? await hacherMotDePasse(req.body.motDePasse) : null;
    return protege(req, async (ctx) => {
      await exigerGlobale(ctx, "utilisateurs.gerer");
      const u = await ctx.client.query("select id from utilisateurs where id = $1 for update", [req.params.id]);
      if (!u.rows[0]) throw new ErreurApi(404, "introuvable");
      if (req.body.actif === false) {
        const s = await ctx.client.query(
          "select 1 from attributions a join roles r on r.id = a.role_id where a.utilisateur_id = $1 and r.code = $2",
          [req.params.id, ROLE_SUPER],
        );
        if (s.rows[0]) await exigerAutreSuper(ctx, req.params.id);
      }
      await ctx.client.query(
        `update utilisateurs set actif = coalesce($2, actif), mot_de_passe_hash = coalesce($3, mot_de_passe_hash), mot_de_passe_provisoire = mot_de_passe_provisoire or $3::text is not null,
           echecs_connexion = case when $3::text is null then echecs_connexion else 0 end,
           verrouille_jusqu = case when $3::text is null then verrouille_jusqu else null end where id = $1`,
        [req.params.id, req.body.actif ?? null, hash],
      );
      if (req.body.actif === false || hash) {
        await ctx.client.query("delete from sessions where utilisateur_id = $1", [req.params.id]);
      }
      return { modifie: true };
    });
  });

  app.post<{
    Body: {
      type: string; nom: string; email?: string; telephone?: string; langue?: string;
      roles?: string[]; entiteOrigineId?: string; ignorerDoublons?: boolean; entiteId?: string;
    };
  }>("/tiers", {
    schema: {
      body: {
        type: "object", required: ["type", "nom"],
        properties: {
          type: { type: "string", enum: ["personne", "entreprise"] },
          nom: { type: "string", minLength: 1, maxLength: 200 },
          email: { type: "string", format: "email", maxLength: 320 },
          telephone: { type: "string", minLength: 6, maxLength: 30 },
          langue: { type: "string", enum: ["fr", "en"] },
          roles: { type: "array", items: { type: "string", maxLength: 30 }, maxItems: 10 },
          entiteOrigineId: { type: "string", format: "uuid" },
          entiteId: { type: "string", format: "uuid" },
          ignorerDoublons: { type: "boolean" },
        },
      },
    },
  }, async (req, reponse) => {
    const tiers = await protege(req, async (ctx) => {
      await exiger(ctx, "tiers.creer");
      const b = req.body;
      const email = b.email?.toLowerCase() ?? null;
      const telephone = b.telephone ? normaliserTelephone(b.telephone) : null;
      const vues = await branchesVisibles(ctx.client, ctx.utilisateurId, "tiers.voir");
      let branche: string | null = null;
      if (b.entiteId) {
        const e = await ctx.client.query("select entite_branche(id) as branche from entites where id = $1", [b.entiteId]);
        if (!e.rows[0]) throw new ErreurApi(404, "introuvable");
        branche = e.rows[0].branche;
        if (!vues.tout && !vues.ids.includes(branche as string)) throw new ErreurApi(403, "permission_refusee");
      } else if (!vues.tout) {
        if (vues.ids.length !== 1) throw new ErreurApi(400, "entite_obligatoire");
        branche = vues.ids[0]!;
      }
      if (!b.ignorerDoublons && (email || telephone)) {
        // La même personne peut avoir une fiche distincte dans chaque branche.
        const { rows } = await ctx.client.query(
          `select id, nom, email, telephone, roles from tiers
           where not archive and (email = $1 or telephone = $2)
             and ($3::uuid is null or branche_id = $3 or ($4 and branche_id is null)) limit 10`,
          [email, telephone, branche, vues.tout],
        );
        if (rows.length) throw new ErreurApi(409, "doublon_probable", rows);
      }
      const { rows } = await ctx.client.query(
        `insert into tiers (organisation_id, type, nom, email, telephone, langue, roles, entite_origine_id, branche_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning id, type, nom, email, telephone, langue, roles, entite_origine_id, branche_id`,
        [ctx.organisationId, b.type, b.nom, email, telephone, b.langue ?? "fr", b.roles ?? [], b.entiteOrigineId ?? null, branche],
      );
      await publierEvenement(ctx.client, "tiers.cree", { id: rows[0].id });
      return rows[0];
    }).catch((e) => {
      if (e.code === "23514") throw new ErreurApi(400, "donnees_invalides");
      throw e;
    });
    return reponse.status(201).send(tiers);
  });

  app.get<{ Querystring: { q?: string; entiteId?: string } }>("/tiers", {
    schema: {
      querystring: {
        type: "object",
        properties: { q: { type: "string", maxLength: 100 }, entiteId: { type: "string", format: "uuid" } },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "tiers.voir");
      const motif = `%${(req.query.q ?? "").replace(/[\\%_]/g, "\\$&")}%`;
      const vues = await branchesVisibles(ctx.client, ctx.utilisateurId, "tiers.voir");
      const { rows } = await ctx.client.query(
        `select t.id, t.type, t.nom, t.email, t.telephone, t.roles, t.branche_id, e.nom as branche
         from tiers t left join entites e on e.id = t.branche_id
         where not t.archive and (t.nom ilike $1 or t.email ilike $1 or t.telephone ilike $1)
           and ($2 or t.branche_id = any($3::uuid[]))
           and ($4::uuid is null or t.branche_id is null or t.branche_id = entite_branche($4))
         order by t.nom limit 50`,
        [motif, vues.tout, vues.ids, req.query.entiteId ?? null],
      );
      return rows;
    }),
  );

  app.get<{ Params: { id: string } }>("/tiers/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "tiers.voir");
      const t = await exigerTiersVisible(ctx, req.params.id, "tiers.voir");
      const { id, type, nom, email, telephone, langue, roles, entite_origine_id, archive, cree_le, branche_id } = t;
      return { id, type, nom, email, telephone, langue, roles, entite_origine_id, archive, cree_le, branche_id };
    }),
  );

  app.get<{ Querystring: { limite?: number } }>("/audit", {
    schema: {
      querystring: { type: "object", properties: { limite: { type: "integer", minimum: 1, maximum: 200 } } },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerGlobale(ctx, "audit.voir");
      const { rows } = await ctx.client.query(
        `select sequence, horodatage, acteur_id, action, objet, objet_id, avant, apres
         from journal_audit order by sequence desc limit $1`,
        [req.query.limite ?? 50],
      );
      return rows;
    }),
  );

  app.get("/audit/verification", async (req) =>
    protege(req, async (ctx) => {
      await exigerGlobale(ctx, "audit.voir");
      const { rows } = await ctx.client.query("select * from journal_verifier()");
      return { ...rows[0], total: Number(rows[0].total) };
    }),
  );

  enregistrerFormations(app, pool, { protege, exigerSurEntite, exiger }, options.urlPublique);
  enregistrerRelation(app, { protege, exigerSurEntite, exiger });
  enregistrerIndicateurs(app, { protege, exigerSurEntite, exiger });
  enregistrerImpact(app, { protege, exigerSurEntite, exiger });
  const taches: TachePlanifiee[] = [];
  enregistrerFacturation(app, { protege, exigerSurEntite, exiger }, pool, taches);
  enregistrerStocks(app, { protege, exigerSurEntite, exiger });
  enregistrerAchats(app, { protege, exigerSurEntite, exiger });
  enregistrerTableau(app, { protege, exigerSurEntite, exiger });
  enregistrerImages(app, { protege, exigerSurEntite, exiger });
  enregistrerMagasins(app, { protege, exigerSurEntite, exiger });
  enregistrerCaisse(app, { protege, exigerSurEntite, exiger });
  enregistrerApprentissage(app, pool, { protege, exigerSurEntite, exiger }, options.urlPublique, { dossier: options.dossierMedias, maxOctets: options.videoMaxOctets });
  enregistrerStudio(app, { protege, exigerSurEntite, exiger }, options.generateurIa);
  enregistrerRh(app, pool, { protege, exigerSurEntite, exiger }, options.cleSecrets, options.urlPublique, options.dossierMedias);
  enregistrerScolariteEtPaie(app, pool, { protege, exigerSurEntite, exiger }, options.cleSecrets);
  enregistrerManifestations(app, pool, { protege, exigerSurEntite, exiger });
  enregistrerFiscalite(app, { protege, exigerSurEntite, exiger });
  enregistrerPedagogie(app, pool, { protege, exigerSurEntite, exiger }, taches);
  enregistrerLogistique(app, { protege, exigerSurEntite, exiger });
  enregistrerAutomatisation(app, pool, { protege, exigerSurEntite, exiger }, taches);
  enregistrerFinitions(app, pool, { protege, exigerSurEntite, exiger }, { cle: options.cleConsole, poolAdmin: options.poolAdmin });
  enregistrerDocuments(app, { protege, exigerSurEntite, exiger }, options.dossierMedias);
  enregistrerPromotions(app, { protege, exigerSurEntite, exiger });
  enregistrerCoaching(app, { protege, exigerSurEntite, exiger }, options.cleSecrets, options.urlPublique);
  enregistrerComptabilite(app, { protege, exigerSurEntite, exiger });
  enregistrerFournisseurs(app, { protege, exigerSurEntite, exiger });
  enregistrerPilotage(app, pool, { protege, exigerSurEntite, exiger }, options.urlPublique);
  // La performance au quotidien ajoute ses indicateurs au catalogue avant que l'évaluation mensuelle ne le lise.
  enregistrerPerformance(app, pool, { protege, exigerSurEntite, exiger }, taches, options.dossierMedias);
  enregistrerFiches(app, { protege, exigerSurEntite, exiger });
  enregistrerOkr(app, pool, { protege, exigerSurEntite, exiger }, taches);
  enregistrerEntrepots(app, pool, { protege, exigerSurEntite, exiger }, taches);
  enregistrerArticles(app, { protege, exigerSurEntite, exiger });
  enregistrerRetours(app, { protege, exigerSurEntite, exiger });
  enregistrerRapports(app, { protege, exigerSurEntite, exiger });
  enregistrerCommerce(app, pool, { protege, exigerSurEntite, exiger }, options.urlPublique);
  enregistrerMall(app, pool, { protege, exigerSurEntite, exiger }, options.urlPublique);
  enregistrerRecouvrement(app, { protege, exigerSurEntite, exiger });
  enregistrerProspection(app, pool, { protege, exigerSurEntite, exiger });
  enregistrerSocle(app, { protege, exigerSurEntite, exiger });
  enregistrerControle(app, pool, { protege, exigerSurEntite, exiger }, options.cleSecrets, options.envoiWebhooks, taches);
  const executerTaches = async (organisationId: string) => { for (const t of taches) await t(organisationId).catch((e) => app.log.error(e, "tâche planifiée")); };
  app.decorate("executerTaches", executerTaches);
  if (options.webhooksAuto) {
    const tour = async () => {
      const { rows } = await pool.query("select id from registre_organisations");
      for (const r of rows) await executerTaches(r.id);
    };
    const minuterie = setInterval(() => { tour().catch((e) => app.log.error(e, "tâches planifiées")); }, 3600000);
    const envoi = setInterval(() => { app.pousserWebhooks?.().catch((e: unknown) => app.log.error(e, "webhooks")); }, 60000);
    minuterie.unref(); envoi.unref();
    app.addHook("onClose", async () => { clearInterval(minuterie); clearInterval(envoi); });
  }
  enregistrerTresorerie(app, { protege, exigerSurEntite, exiger });
  enregistrerUniversite(app, { protege, exigerSurEntite, exiger }, options.urlPublique);
  enregistrerAvis(app, pool, { protege, exigerSurEntite, exiger }, options.urlPublique);
  return app;
}
