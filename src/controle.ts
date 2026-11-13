import { createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { dansOrganisation, type Client } from "./base.js";
import { ROLE_SUPER } from "./catalogue.js";
import { bilan, compteDeResultat, type LigneBalance } from "./etats.js";
import { aPermissionSurEntite, entitesAccessibles } from "./permissions.js";
import { chiffrer, creerJeton, dechiffrer } from "./securite.js";
import { ErreurApi, type Contexte, type Outils, type TachePlanifiee } from "./serveur.js";

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max = 300) => ({ type: "string", minLength: 1, maxLength: max }) as const;
const mois = { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" } as const;
const JOUR = "(now() at time zone 'Africa/Douala')::date";

interface Source { libelle: string; sens: 1 | -1; flux: boolean; requete: string; conseil: string }
/** $1 : entités, $2 : premier jour du mois, $3 : dernier jour du mois. Une seule définition par indicateur. */
export const SOURCES: Record<string, Source> = {
  ca_facture: { libelle: "Chiffre d'affaires facturé (FCFA)", sens: 1, flux: true, requete: "select coalesce(sum(case when type = 'avoir' then -total_ht else total_ht end), 0)::float as v from documents_vente where entite_id = any($1::uuid[]) and type in ('facture', 'avoir') and statut = 'emis' and date_document between $2 and $3", conseil: "Relancez les devis en attente et les clients inactifs." },
  ventes_caisse: { libelle: "Ventes en caisse (FCFA)", sens: 1, flux: true, requete: "select coalesce(sum(total_ttc), 0)::float as v from ventes_comptoir where entite_id = any($1::uuid[]) and annulee_le is null and cree_le::date between $2 and $3", conseil: "Comparez les points de vente et vérifiez les ruptures." },
  encaissements: { libelle: "Encaissements (FCFA)", sens: 1, flux: true, requete: "select (select coalesce(sum(r.montant), 0) from reglements r join documents_vente d on d.id = r.facture_id where d.entite_id = any($1::uuid[]) and r.annule_le is null and r.encaisse_le::date between $2 and $3)::float + (select coalesce(sum(p.montant), 0) from paiements p join inscriptions i on i.id = p.inscription_id join sessions_formation s on s.id = i.session_id where s.entite_id = any($1::uuid[]) and p.annule_le is null and p.encaisse_le::date between $2 and $3)::float as v", conseil: "Relancez les échéances passées." },
  creances_echues: { libelle: "Créances échues (FCFA)", sens: -1, flux: false, requete: `select coalesce(sum(f.total_ttc - (select coalesce(sum(r.montant), 0) from reglements r where r.facture_id = f.id and r.annule_le is null) - (select coalesce(sum(a.total_ttc), 0) from documents_vente a where a.origine_id = f.id and a.type = 'avoir' and a.statut = 'emis')), 0)::float as v from documents_vente f where f.entite_id = any($1::uuid[]) and f.type = 'facture' and f.statut = 'emis' and f.date_echeance < ${JOUR} and $2::date <= $3::date and not exists (select 1 from creances_douteuses x where x.facture_id = f.id and x.statut = 'perte')`, conseil: "Appelez les clients en retard, en commençant par les plus gros montants." },
  tresorerie: { libelle: "Trésorerie des portefeuilles (FCFA)", sens: 1, flux: false, requete: "select coalesce(sum(m.montant), 0)::float as v from mouvements_portefeuille m join portefeuilles w on w.id = m.portefeuille_id where w.entite_id = any($1::uuid[]) and $2::date <= $3::date", conseil: "Consultez la prévision de trésorerie et reportez les dépenses non urgentes." },
  tickets_retard: { libelle: "Tickets en retard", sens: -1, flux: false, requete: "select count(*)::float as v from tickets where entite_id = any($1::uuid[]) and statut in ('ouvert', 'en_cours') and echeance < now() and $2::date <= $3::date", conseil: "Réaffectez les tickets les plus anciens." },
  taches_retard: { libelle: "Tâches en retard", sens: -1, flux: false, requete: `select count(*)::float as v from taches where entite_id = any($1::uuid[]) and statut in ('a_faire', 'en_cours') and echeance < ${JOUR} and $2::date <= $3::date`, conseil: "Faites le point avec les responsables." },
  colis_echec: { libelle: "Livraisons manquées", sens: -1, flux: false, requete: "select count(*)::float as v from colis where entite_id = any($1::uuid[]) and statut = 'echec' and $2::date <= $3::date", conseil: "Replanifiez ces colis et contactez les destinataires." },
};
/** Selon le sens, un indicateur alerte quand il passe sous le seuil, ou au-dessus. */
export function niveauKpi(sens: 1 | -1, valeur: number, alerte: number, critique: number): "ok" | "alerte" | "critique" {
  if (sens === 1) return valeur <= critique ? "critique" : valeur <= alerte ? "alerte" : "ok";
  return valeur >= critique ? "critique" : valeur >= alerte ? "alerte" : "ok";
}
export function projectionMois(valeur: number, jour: number, joursDuMois: number): number {
  return jour ? Math.round((valeur * joursDuMois) / jour) : valeur;
}
const bornesMois = (m: string) => {
  const [a, n] = m.split("-").map(Number) as [number, number];
  return { debut: `${m}-01`, fin: new Date(Date.UTC(a, n, 0)).toISOString().slice(0, 10), jours: new Date(Date.UTC(a, n, 0)).getUTCDate() };
};
const moisPrecedent = (m: string) => {
  const [a, n] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(a, n - 2, 1)).toISOString().slice(0, 7);
};

/** Refuse les adresses internes : un webhook ne doit jamais atteindre le serveur ou son réseau. */
export function adressePrivee(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0);
  }
  if (isIP(ip) !== 6) return true;
  const mots = motsIpv6(ip);
  if (!mots) return true;
  const v4 = `${mots[6]! >> 8}.${mots[6]! & 255}.${mots[7]! >> 8}.${mots[7]! & 255}`;
  const zero = (n: number) => mots.slice(0, n).every((m) => m === 0);
  if (zero(5) && mots[5] === 0xffff) return adressePrivee(v4);
  if (zero(6)) return true;
  if (mots[0] === 0x64 && mots[1] === 0xff9b) return adressePrivee(v4);
  if (mots[0] === 0x2002) return true;
  const p = mots[0]!;
  return (p & 0xfe00) === 0xfc00 || (p & 0xffc0) === 0xfe80 || (p & 0xffc0) === 0xfec0 || (p & 0xff00) === 0xff00 || p === 0x2001 && mots[1] === 0;
}
function motsIpv6(ip: string): number[] | null {
  let x = ip.toLowerCase().split("%")[0]!;
  const m = x.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) { const o = m[2]!.split(".").map(Number) as [number, number, number, number]; x = `${m[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`; }
  const [g, d] = x.split("::");
  const gauche = g ? g.split(":") : [];
  const droite = d ? d.split(":") : [];
  const manque = 8 - gauche.length - droite.length;
  if (x.includes("::") ? manque < 0 : manque !== 0) return null;
  return [...gauche, ...Array(Math.max(manque, 0)).fill("0"), ...droite].map((h) => parseInt(h, 16));
}
export async function urlAutorisee(url: string, resoudre: (h: string) => Promise<{ address: string }[]> = (h) => lookup(h, { all: true })): Promise<boolean> {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const hote = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hote)) return !adressePrivee(hote);
  try {
    const a = await resoudre(hote);
    return a.length > 0 && a.every((x) => !adressePrivee(x.address));
  } catch { return false; }
}
/** L'adresse est contrôlée au moment même de la connexion : un nom qui change d'adresse entre-temps ne passe pas. */
function envoiProtege(url: string, init: { headers: Record<string, string>; body: string; signal: AbortSignal }): Promise<{ status: number }> {
  return new Promise((resolu, rejete) => {
    const r = httpsRequest(url, {
      method: "POST", headers: init.headers, signal: init.signal,
      lookup: ((hote: string, _o: unknown, suite: (e: Error | null, a?: string | { address: string; family: number }[], f?: number) => void) => {
        lookup(hote, { all: true }).then((a) => {
          if (!a.length || a.some((x) => adressePrivee(x.address))) return suite(new Error("adresse refusée"));
          suite(null, a.map((x) => ({ address: x.address, family: x.family })));
        }, (e) => suite(e));
      }) as never,
    }, (rep) => { rep.resume(); resolu({ status: rep.statusCode ?? 0 }); });
    r.on("error", rejete);
    r.end(init.body);
  });
}
export const signature = (secret: string, corps: string) => createHmac("sha256", secret).update(corps).digest("hex");
const DELAIS = [1, 5, 30, 120, 720];

export interface OptionsEnvoi { envoyer?: typeof fetch; resoudre?: (h: string) => Promise<{ address: string }[]> }

export function enregistrerControle(app: FastifyInstance, pool: pg.Pool, outils: Outils, cle: Buffer, envoi: OptionsEnvoi = {}, taches: TachePlanifiee[] = []): void {
  const { protege, exiger, exigerSurEntite } = outils;
  const envoyer = (envoi.envoyer ?? envoiProtege) as (u: string, i: { method?: string; redirect?: string; signal: AbortSignal; headers: Record<string, string>; body: string }) => Promise<{ status: number }>;
  const sousEntites = async (c: Client, id: string) => (await c.query(
    "with recursive a as (select id from entites where id = $1 union all select e.id from entites e join a on e.parent_id = a.id) select id from a", [id],
  )).rows.map((r) => r.id as string);
  const valeurKpi = async (c: Client, entiteId: string, source: string, m: string) => {
    const b = bornesMois(m);
    const { rows: [r] } = await c.query(SOURCES[source]!.requete, [await sousEntites(c, entiteId), b.debut, b.fin]);
    return r.v as number;
  };

  /** Pour le mois donné : calcule la valeur et enregistre l'alerte une seule fois par niveau. */
  const evaluerKpi = async (c: Client, org: string, k: Record<string, any>, m: string, jour: string) => {
    const s = SOURCES[k.source]!;
    const valeur = await valeurKpi(c, k.entite_id, k.source, m);
    const encours = m === jour.slice(0, 7);
    const estimee = s.flux && encours ? projectionMois(valeur, Number(jour.slice(8, 10)), bornesMois(m).jours) : valeur;
    const niveau = niveauKpi(s.sens, estimee, Number(k.seuil_alerte), Number(k.seuil_critique));
    if (niveau !== "ok") {
      await c.query("insert into alertes_kpi (organisation_id, kpi_id, periode, niveau, valeur, recommandation) values ($1, $2, $3, $4, $5, $6) on conflict do nothing", [org, k.id, m, niveau, estimee, s.conseil]);
    }
    return { valeur, estimee, niveau, encours };
  };
  taches.push((org) => dansOrganisation(pool, org, async (c) => {
    const { rows: [{ jour }] } = await c.query(`select ${JOUR}::text as jour`);
    const { rows } = await c.query("select * from kpi_suivis where actif");
    for (const k of rows) await evaluerKpi(c, org, k, jour.slice(0, 7), jour);
  }));

  // Indicateurs suivis
  app.get("/kpi/sources", async (req) => protege(req, async (ctx) => { await exiger(ctx, "pilotage.voir"); return Object.entries(SOURCES).map(([code, s]) => ({ code, libelle: s.libelle, sens: s.sens })); }));
  app.post<{ Body: { entiteId: string; source: string; cible: number; seuilAlerte: number; seuilCritique: number; responsableId?: string } }>("/kpi", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "source", "cible", "seuilAlerte", "seuilCritique"],
        properties: { entiteId: uuid, source: { type: "string", enum: Object.keys(SOURCES) }, cible: { type: "number" }, seuilAlerte: { type: "number" }, seuilCritique: { type: "number" }, responsableId: uuid },
      },
    },
  }, async (req, reponse) => {
    const k = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "pilotage.gerer", b.entiteId);
      const s = SOURCES[b.source]!;
      const coherent = s.sens === 1 ? b.seuilCritique <= b.seuilAlerte && b.seuilAlerte <= b.cible : b.seuilCritique >= b.seuilAlerte && b.seuilAlerte >= b.cible;
      if (!coherent) throw new ErreurApi(400, "seuils_incoherents");
      return (await ctx.client.query(
        `insert into kpi_suivis (organisation_id, entite_id, source, libelle, cible, seuil_alerte, seuil_critique, responsable_id) values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (organisation_id, entite_id, source) do update set cible = excluded.cible, seuil_alerte = excluded.seuil_alerte, seuil_critique = excluded.seuil_critique, responsable_id = excluded.responsable_id, actif = true returning *`,
        [ctx.organisationId, b.entiteId, b.source, s.libelle, b.cible, b.seuilAlerte, b.seuilCritique, b.responsableId ?? null],
      )).rows[0];
    });
    return reponse.status(201).send(k);
  });

  /** Calcule le mois, compare au mois précédent, et enregistre une alerte une seule fois par niveau. */
  app.get<{ Querystring: { mois?: string } }>("/kpi/tableau", { schema: { querystring: { type: "object", properties: { mois } } } }, async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "pilotage.voir");
      const liste = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "pilotage.voir")).map((e) => e.id);
      const { rows: [{ jour }] } = await ctx.client.query(`select ${JOUR}::text as jour`);
      const m = req.query.mois ?? jour.slice(0, 7);
      const { rows } = await ctx.client.query("select k.*, e.nom as entite from kpi_suivis k join entites e on e.id = k.entite_id where k.actif and k.entite_id = any($1::uuid[]) order by e.nom, k.libelle", [liste]);
      const lignes = [];
      for (const k of rows) {
        const s = SOURCES[k.source]!;
        const { valeur, estimee, niveau, encours } = await evaluerKpi(ctx.client, ctx.organisationId, k, m, jour);
        lignes.push({
          id: k.id, entite: k.entite, entite_id: k.entite_id, source: k.source, libelle: k.libelle, sens: s.sens, cible: Number(k.cible), seuil_alerte: Number(k.seuil_alerte), seuil_critique: Number(k.seuil_critique),
          valeur, estimee, flux: s.flux && encours, niveau, precedent: s.flux ? await valeurKpi(ctx.client, k.entite_id, k.source, moisPrecedent(m)) : null,
        });
      }
      const { rows: alertes } = await ctx.client.query(
        `select a.id, a.periode, a.niveau, a.valeur::float, a.recommandation, a.statut, a.motif, k.libelle, k.entite_id, e.nom as entite from alertes_kpi a join kpi_suivis k on k.id = a.kpi_id join entites e on e.id = k.entite_id
         where k.entite_id = any($1::uuid[]) order by a.statut = 'nouvelle' desc, a.cree_le desc limit 100`, [liste],
      );
      return { mois: m, lignes, alertes };
    }),
  );
  /** Chaque décision est mémorisée. Accepter crée une tâche pour le responsable : le système ne fait rien d'autre seul. */
  app.post<{ Params: { id: string }; Body: { decision: string; motif?: string } }>("/alertes-kpi/:id/decision", {
    schema: { params: paramId, body: { type: "object", required: ["decision"], properties: { decision: { type: "string", enum: ["acceptee", "reportee", "refusee"] }, motif: texte(500) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [a] } = await ctx.client.query("select a.*, k.entite_id, k.libelle, k.responsable_id from alertes_kpi a join kpi_suivis k on k.id = a.kpi_id where a.id = $1 for update of a", [req.params.id]);
      if (!a) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "pilotage.gerer", a.entite_id);
      if (a.statut !== "nouvelle" && a.statut !== "reportee") throw new ErreurApi(409, "deja_decide");
      await ctx.client.query("update alertes_kpi set statut = $2, motif = $3, decide_par = $4, decide_le = now() where id = $1", [a.id, req.body.decision, req.body.motif ?? null, ctx.utilisateurId]);
      if (req.body.decision !== "acceptee") return { statut: req.body.decision };
      await ctx.client.query(
        `insert into taches (organisation_id, entite_id, titre, description, assigne_a, cree_par, echeance) values ($1, $2, $3, $4, $5, $5, ${JOUR} + 7)`,
        [ctx.organisationId, a.entite_id, `${a.libelle} : ${a.niveau}`.slice(0, 200), a.recommandation, a.responsable_id ?? ctx.utilisateurId],
      );
      return { statut: "acceptee", tache: true };
    }),
  );

  // Clés d'API
  const exigerAdmin = (ctx: Contexte) => exiger(ctx, "utilisateurs.gerer");
  app.post<{ Body: { nom: string; utilisateurId: string; expireLe?: string } }>("/cles-api", {
    schema: { body: { type: "object", required: ["nom", "utilisateurId"], properties: { nom: texte(100), utilisateurId: uuid, expireLe: date } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      await exigerAdmin(ctx);
      const b = req.body;
      const { rows: [u] } = await ctx.client.query(
        "select u.id, exists (select 1 from attributions a join roles r on r.id = a.role_id where a.utilisateur_id = u.id and r.code = $2) as super from utilisateurs u where u.id = $1 and u.actif", [b.utilisateurId, ROLE_SUPER],
      );
      if (!u) throw new ErreurApi(404, "introuvable");
      if (u.super) throw new ErreurApi(409, "cle_super_interdite");
      const { jeton, hash } = creerJeton(ctx.organisationId);
      const { rows: [x] } = await ctx.client.query(
        "insert into cles_api (organisation_id, nom, cle_hash, utilisateur_id, cree_par, expire_le) values ($1, $2, $3, $4, $5, $6) returning id, nom, expire_le",
        [ctx.organisationId, b.nom, hash, b.utilisateurId, ctx.utilisateurId, b.expireLe ?? null],
      );
      await ctx.client.query("select journal_evenement('api.cle_creee', $1)", [JSON.stringify({ cle: x.id, nom: b.nom, compte: b.utilisateurId })]);
      return { ...x, cle: jeton };
    });
    return reponse.status(201).send(r);
  });
  app.get("/cles-api", async (req) =>
    protege(req, async (ctx) => {
      await exigerAdmin(ctx);
      return (await ctx.client.query("select c.id, c.nom, c.expire_le, c.revoquee_le, c.utilisee_le, c.cree_le, u.nom as compte from cles_api c join utilisateurs u on u.id = c.utilisateur_id order by c.cree_le desc limit 200")).rows;
    }),
  );
  app.post<{ Params: { id: string } }>("/cles-api/:id/revocation", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await exigerAdmin(ctx);
      const { rowCount } = await ctx.client.query("update cles_api set revoquee_le = now() where id = $1 and revoquee_le is null", [req.params.id]);
      if (!rowCount) throw new ErreurApi(404, "introuvable");
      await ctx.client.query("select journal_evenement('api.cle_revoquee', $1)", [JSON.stringify({ cle: req.params.id })]);
      return { revoquee: true };
    }),
  );

  // Webhooks
  app.post<{ Body: { nom: string; url: string; evenements: string[] } }>("/webhooks", {
    schema: { body: { type: "object", required: ["nom", "url", "evenements"], properties: { nom: texte(100), url: { type: "string", pattern: "^https://", maxLength: 1000 }, evenements: { type: "array", minItems: 1, maxItems: 50, items: texte(100) } } } },
  }, async (req, reponse) => {
    const b = req.body;
    if (!(await urlAutorisee(b.url, envoi.resoudre))) throw new ErreurApi(400, "url_webhook_refusee");
    const r = await protege(req, async (ctx) => {
      await exigerAdmin(ctx);
      const secret = randomBytes(32).toString("base64url");
      const { rows: [x] } = await ctx.client.query(
        "insert into webhooks (organisation_id, nom, url, evenements, secret_chiffre) values ($1, $2, $3, $4, $5) returning id, nom, url, evenements",
        [ctx.organisationId, b.nom, b.url, b.evenements, chiffrer(secret, cle)],
      );
      await ctx.client.query("select journal_evenement('api.webhook_cree', $1)", [JSON.stringify({ webhook: x.id, url: b.url })]);
      return { ...x, secret };
    });
    return reponse.status(201).send(r);
  });
  app.get("/webhooks", async (req) =>
    protege(req, async (ctx) => {
      await exigerAdmin(ctx);
      return (await ctx.client.query(
        `select w.id, w.nom, w.url, w.evenements, w.actif, count(l.id) filter (where l.statut = 'envoye')::int as envoyes, count(l.id) filter (where l.statut = 'a_envoyer')::int as en_attente, count(l.id) filter (where l.statut = 'abandonne')::int as abandonnes
         from webhooks w left join livraisons_webhook l on l.webhook_id = w.id group by w.id order by w.cree_le desc`,
      )).rows;
    }),
  );
  app.post<{ Params: { id: string } }>("/webhooks/:id/arret", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await exigerAdmin(ctx);
      await ctx.client.query("update webhooks set actif = false where id = $1", [req.params.id]);
      return { actif: false };
    }),
  );
  /** Aucune connexion à la base n'est retenue pendant l'envoi. Les échecs reviennent avec un délai croissant, puis s'arrêtent. */
  const pousser = async (organisationId: string): Promise<number> => {
    const lot = await dansOrganisation(pool, organisationId, async (c) => {
      await c.query(
        `insert into livraisons_webhook (organisation_id, webhook_id, evenement_id)
         select w.organisation_id, w.id, e.id from webhooks w join evenements e on e.type = any(w.evenements) and e.cree_le >= w.cree_le where w.actif on conflict do nothing`,
      );
      return (await c.query(
        `select l.id, l.essais, w.url, w.secret_chiffre, e.id as evenement, e.type, e.charge, e.cree_le from livraisons_webhook l join webhooks w on w.id = l.webhook_id join evenements e on e.id = l.evenement_id
         where l.statut = 'a_envoyer' and l.prochain_essai <= now() and w.actif order by l.cree_le limit 50`,
      )).rows;
    });
    let reussis = 0;
    for (const l of lot) {
      const corps = JSON.stringify({ id: l.evenement, type: l.type, cree_le: l.cree_le, donnees: l.charge });
      let code = 0;
      try {
        // La vérification se refait à chaque envoi : l'adresse a pu changer depuis la création.
        if (await urlAutorisee(l.url, envoi.resoudre)) {
          const r = await envoyer(l.url, {
            method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
            headers: { "content-type": "application/json", "x-smarte-evenement": l.type, "x-smarte-signature": `sha256=${signature(dechiffrer(l.secret_chiffre, cle), corps)}` }, body: corps,
          });
          code = r.status;
        }
      } catch { code = 0; }
      const ok = code >= 200 && code < 300;
      if (ok) reussis += 1;
      const essais = l.essais + 1;
      await dansOrganisation(pool, organisationId, (c) => c.query(
        "update livraisons_webhook set statut = $2, essais = $3, dernier_code = $4, prochain_essai = now() + make_interval(mins => $5) where id = $1",
        [l.id, ok ? "envoye" : essais >= DELAIS.length ? "abandonne" : "a_envoyer", essais, code || null, DELAIS[Math.min(essais - 1, DELAIS.length - 1)]],
      ));
    }
    return reussis;
  };
  app.post("/webhooks/envoi", async (req) => {
    const org = await protege(req, async (ctx) => { await exigerAdmin(ctx); return ctx.organisationId; });
    return { envoyes: await pousser(org) };
  });
  app.decorate("pousserWebhooks", async () => {
    const { rows } = await pool.query("select id from registre_organisations");
    for (const r of rows) await pousser(r.id).catch((e) => app.log.error(e, "envoi des webhooks"));
  });

  // Budgets
  const brancheVoir = (ctx: Contexte, id: string) => exigerSurEntite(ctx, "compta.voir", id);
  app.put<{ Body: { brancheId: string; annee: number; comptePrefixe: string; libelle: string; montant: number } }>("/budgets", {
    schema: {
      body: {
        type: "object", required: ["brancheId", "annee", "comptePrefixe", "libelle", "montant"],
        properties: { brancheId: uuid, annee: { type: "integer", minimum: 2000, maximum: 2100 }, comptePrefixe: { type: "string", pattern: "^[67][0-9]{0,11}$" }, libelle: texte(200), montant: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 } },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "compta.cloturer", b.brancheId);
      await ctx.client.query(
        `insert into budgets (organisation_id, branche_id, annee, compte_prefixe, libelle, montant) values ($1, $2, $3, $4, $5, $6)
         on conflict (organisation_id, branche_id, annee, compte_prefixe) do update set libelle = excluded.libelle, montant = excluded.montant`,
        [ctx.organisationId, b.brancheId, b.annee, b.comptePrefixe, b.libelle, b.montant],
      );
      return { enregistre: true };
    }),
  );
  /** Réalisé à partir des seules écritures validées. Un dépassement de charges, ou un produit en retard, se voit. */
  app.get<{ Querystring: { brancheId: string; annee: number } }>("/budgets", {
    schema: { querystring: { type: "object", required: ["brancheId", "annee"], properties: { brancheId: uuid, annee: { type: "integer", minimum: 2000, maximum: 2100 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const q = req.query;
      await brancheVoir(ctx, q.brancheId);
      const { rows } = await ctx.client.query(
        `select b.compte_prefixe, b.libelle, b.montant,
           coalesce((select sum(case when b.compte_prefixe like '7%' then l.credit - l.debit else l.debit - l.credit end) from lignes_ecriture l join ecritures e on e.id = l.ecriture_id join comptes c on c.id = l.compte_id
             where e.branche_id = b.branche_id and e.statut = 'validee' and extract(year from e.date_ecriture)::int = b.annee and c.numero like b.compte_prefixe || '%'), 0)::int8 as realise
         from budgets b where b.branche_id = $1 and b.annee = $2 order by b.compte_prefixe`, [q.brancheId, q.annee],
      );
      return rows.map((b) => ({ ...b, ecart: b.realise - b.montant, consomme: b.montant ? Math.round((b.realise * 100) / b.montant) : null, nature: b.compte_prefixe[0] === "6" ? "charge" : "produit" }));
    }),
  );

  /** Cumul des branches accessibles. Ce n'est pas une consolidation : rien n'élimine les opérations entre elles. */
  app.get<{ Querystring: { annee: number } }>("/compta/cumul-groupe", {
    schema: { querystring: { type: "object", required: ["annee"], properties: { annee: { type: "integer", minimum: 2000, maximum: 2100 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "compta.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "compta.voir")).map((e) => e.id);
      const { rows: branches } = await ctx.client.query("select id, nom from entites where id = any($1::uuid[]) and entite_branche(id) = id order by nom", [ids]);
      const par = [];
      const tout = new Map<string, LigneBalance>();
      for (const b of branches) {
        const { rows } = await ctx.client.query(
          `select c.numero, sum(l.debit)::int8 as debit, sum(l.credit)::int8 as credit from lignes_ecriture l join ecritures e on e.id = l.ecriture_id join comptes c on c.id = l.compte_id
           where e.branche_id = $1 and e.statut = 'validee' and extract(year from e.date_ecriture)::int = $2 group by c.numero`, [b.id, req.query.annee],
        );
        for (const l of rows as LigneBalance[]) {
          const x = tout.get(l.numero) ?? { numero: l.numero, debit: 0, credit: 0 };
          x.debit += l.debit; x.credit += l.credit;
          tout.set(l.numero, x);
        }
        const cr = compteDeResultat(rows).lignes;
        const bi = bilan(rows);
        par.push({ id: b.id, nom: b.nom, chiffre: cr.XB ?? 0, resultat: cr.XI ?? 0, actif: bi.totalActif, tresorerie: bi.tresorerie });
      }
      const liste = [...tout.values()];
      const cr = compteDeResultat(liste).lignes;
      const bi = bilan(liste);
      const { rows: eliminations } = await ctx.client.query("select id, libelle, chiffre::int8, resultat::int8 from eliminations_groupe where annee = $1 order by cree_le", [req.query.annee]);
      // Une refacturation entre branches sort du chiffre d'affaires et ne change pas le résultat du groupe.
      const { rows: [{ interne }] } = await ctx.client.query("select coalesce(sum(montant), 0)::int8 as interne from refacturations_internes where extract(year from jour)::int = $1", [req.query.annee]);
      const moins = (k: "chiffre" | "resultat") => eliminations.reduce((s, e) => s + Number(e[k]), 0) + (k === "chiffre" ? Number(interne) : 0);
      return { annee: req.query.annee, branches: par, eliminations, refacturations: Number(interne), groupe: { chiffre: cr.XB ?? 0, resultat: cr.XI ?? 0, actif: bi.totalActif, tresorerie: bi.tresorerie, equilibre: bi.equilibre }, apres_eliminations: { chiffre: (cr.XB ?? 0) - moins("chiffre"), resultat: (cr.XI ?? 0) - moins("resultat") } };
    }),
  );

  /** Saisies par le comptable : le logiciel ne repère pas seul les opérations entre branches. Réservées à qui voit tout le groupe. */
  app.post<{ Body: { annee: number; libelle: string; chiffre: number; resultat: number } }>("/compta/eliminations", {
    schema: { body: { type: "object", required: ["annee", "libelle", "chiffre", "resultat"], properties: { annee: { type: "integer", minimum: 2000, maximum: 2100 }, libelle: texte(300), chiffre: { type: "integer" }, resultat: { type: "integer" } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      await exiger(ctx, "utilisateurs.gerer");
      const b = req.body;
      return (await ctx.client.query("insert into eliminations_groupe (organisation_id, annee, libelle, chiffre, resultat, auteur_id) values ($1, $2, $3, $4, $5, $6) returning id", [ctx.organisationId, b.annee, b.libelle, b.chiffre, b.resultat, ctx.utilisateurId])).rows[0];
    });
    return reponse.status(201).send(r);
  });

  // Rapprochement et prévision
  /** Propose les correspondances : même montant, à trois jours près. Le comptable reste juge de l'écart. */
  app.post<{ Params: { id: string }; Body: { jour: string; soldeReleve: number; lignes?: { jour: string; montant: number; reference?: string }[]; note?: string } }>("/portefeuilles/:id/rapprochement", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["jour", "soldeReleve"],
        properties: { jour: date, soldeReleve: { type: "integer" }, note: texte(500), lignes: { type: "array", maxItems: 2000, items: { type: "object", required: ["jour", "montant"], properties: { jour: date, montant: { type: "integer" }, reference: texte(200) } } } },
      },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const { rows: [w] } = await ctx.client.query("select * from portefeuilles where id = $1", [req.params.id]);
      if (!w) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "tresorerie.gerer", w.entite_id);
      const b = req.body;
      const { rows: [{ s }] } = await ctx.client.query("select coalesce(sum(montant), 0)::int8 as s from mouvements_portefeuille where portefeuille_id = $1 and (cree_le at time zone 'Africa/Douala')::date <= $2", [w.id, b.jour]);
      await ctx.client.query("insert into rapprochements (organisation_id, portefeuille_id, jour, solde_releve, solde_systeme, note, auteur_id) values ($1, $2, $3, $4, $5, $6, $7)", [ctx.organisationId, w.id, b.jour, b.soldeReleve, s, b.note ?? null, ctx.utilisateurId]);
      const { rows: mv } = await ctx.client.query(
        "select id, montant, libelle, (cree_le at time zone 'Africa/Douala')::date::text as jour from mouvements_portefeuille where portefeuille_id = $1 and (cree_le at time zone 'Africa/Douala')::date <= $2 and (cree_le at time zone 'Africa/Douala')::date >= $2::date - 62 order by cree_le", [w.id, b.jour],
      );
      const libres = [...mv];
      const correspondances = [];
      const absents = [];
      for (const l of b.lignes ?? []) {
        const i = libres.findIndex((m) => m.montant === l.montant && Math.abs(Date.parse(m.jour) - Date.parse(l.jour)) <= 3 * 86400000);
        if (i >= 0) correspondances.push({ releve: l, mouvement: libres.splice(i, 1)[0] });
        else absents.push(l);
      }
      return { solde_systeme: s, solde_releve: b.soldeReleve, ecart: b.soldeReleve - s, correspondances: correspondances.length, absents_du_systeme: absents, absents_du_releve: b.lignes ? libres : [] };
    });
    return reponse.status(201).send(r);
  });
  /** Prévision à 30, 60 et 90 jours : ce qui est dû par les clients et aux fournisseurs. Le reste n'est pas deviné. */
  app.get<{ Querystring: { brancheId: string } }>("/tresorerie/prevision", {
    schema: { querystring: { type: "object", required: ["brancheId"], properties: { brancheId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const id = req.query.brancheId;
      if (!(await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "tresorerie.voir", id))) throw new ErreurApi(403, "permission_refusee");
      const { rows: [{ dispo }] } = await ctx.client.query("select coalesce(sum(m.montant), 0)::int8 as dispo from mouvements_portefeuille m join portefeuilles w on w.id = m.portefeuille_id where entite_branche(w.entite_id) = $1", [id]);
      const { rows: entrees } = await ctx.client.query(
        `select coalesce(f.date_echeance, f.date_document) as d, f.total_ttc - (select coalesce(sum(r.montant), 0) from reglements r where r.facture_id = f.id and r.annule_le is null) - (select coalesce(sum(a.total_ttc), 0) from documents_vente a where a.origine_id = f.id and a.type = 'avoir' and a.statut = 'emis') as reste
         from documents_vente f where entite_branche(f.entite_id) = $1 and f.type = 'facture' and f.statut = 'emis' and not exists (select 1 from creances_douteuses x where x.facture_id = f.id and x.statut = 'perte')`, [id]);
      const { rows: sorties } = await ctx.client.query(
        `select coalesce(f.date_echeance, f.date_facture) as d, f.total_ttc - (select coalesce(sum(p.montant), 0) from paiements_fournisseur p where p.facture_id = f.id and p.annule_le is null) as reste
         from factures_fournisseur f where entite_branche(f.entite_id) = $1 and f.statut = 'validee'`, [id]);
      const { rows: [{ jour }] } = await ctx.client.query(`select ${JOUR}::text as jour`);
      const horizon = (n: number) => new Date(Date.parse(jour) + n * 86400000).toISOString().slice(0, 10);
      const somme = (l: { d: string; reste: string | number }[], fin: string) => l.filter((x) => x.d <= fin).reduce((s, x) => s + Number(x.reste), 0);
      // Estimation : le dernier mois de paie validé, salaires et cotisations, se répète à chaque fin de mois.
      const { rows: [paie] } = await ctx.client.query(
        `select coalesce(sum(b.brut + b.charges), 0)::int8 as cout from bulletins_paie b join employes e on e.id = b.employe_id where entite_branche(e.entite_id) = $1 and b.statut = 'valide'
           and b.periode = (select max(x.periode) from bulletins_paie x join employes y on y.id = x.employe_id where entite_branche(y.entite_id) = $1 and x.statut = 'valide')`, [id],
      );
      const coutPaie = Number(paie.cout);
      const finsDeMois = (fin: string) => {
        let n = 0;
        for (let d = new Date(Date.UTC(Number(jour.slice(0, 4)), Number(jour.slice(5, 7)), 0)); d.toISOString().slice(0, 10) <= fin; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0))) n += 1;
        return n;
      };
      return { disponible: dispo, paie_mensuelle: coutPaie, horizons: [30, 60, 90].map((n) => { const e = somme(entrees, horizon(n)); const o = somme(sorties, horizon(n)); const p = finsDeMois(horizon(n)) * coutPaie; return { jours: n, encaissements: e, decaissements: o, paie: p, solde: dispo + e - o - p }; }) };
    }),
  );
}
