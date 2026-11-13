import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { dansOrganisation, enchainer, type Client } from "./base.js";
import { ROLE_SUPER, type Permission } from "./catalogue.js";
import { KPI, kpiPersonnel, kpiPersonnels, scoreGlobal, scoreKpi, valeurKpi } from "./commerce.js";
import { stockerFichier } from "./documents.js";
import { aPermissionSurEntite, entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils, type TachePlanifiee } from "./serveur.js";

/*
 * Performance au quotidien : objectifs du jour, rapport, score, problèmes rencontrés et solutions proposées.
 * Les scores aident à décider : aucune sanction n'est automatique, rien ne surveille l'écran ni la localisation.
 */

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max: number, min = 1) => ({ type: "string", minLength: min, maxLength: max }) as const;
const motif = texte(1000, 3);

export const PONCTUALITE_POIDS = 10;
export const MAX_OBJECTIFS_PERSONNELS = 3;
export const MINIMUM_FORCE = 3;
export const CATEGORIES_SENSIBLES = ["securite", "harcelement", "conflit_responsable"];
export const COULEURS_PRIORITE = { urgent: "rouge", important: "orange", normal: "gris" } as const;
const ORDRE_PRIORITE = "case p.priorite when 'urgent' then 0 when 'important' then 1 else 2 end";
const DELAIS_DEFAUT = { normal_h: 48, important_h: 24, urgent_h: 2 };
export const POIDS_FORCE_DEFAUT = { reflexe: 20, qualite: 30, acceptation: 20, efficacite: 20, contribution: 10 };
const SERVICES: Record<string, Permission[]> = {
  rh: ["rh.gerer"], finance: ["tresorerie.gerer"], logistique: ["transport.gerer", "stocks.valider"], informatique: ["entites.gerer"],
};

/** Douala vit en UTC+1 toute l'année. */
export const jourDouala = (d = new Date()) => new Date(d.getTime() + 3600_000).toISOString().slice(0, 10);
export const heureDouala = (d = new Date()) => new Date(d.getTime() + 3600_000).getUTCHours();
export const estOuvre = (jour: string) => { const j = new Date(`${jour}T00:00:00Z`).getUTCDay(); return j >= 1 && j <= 5; };
export const decalerJour = (jour: string, n: number) => { const d = new Date(`${jour}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** Les jours ouvrés qui précèdent, du plus récent au plus ancien. */
export function joursOuvresAvant(jour: string, n: number): string[] {
  const r: string[] = [];
  for (let d = decalerJour(jour, -1); r.length < n; d = decalerJour(d, -1)) if (estOuvre(d)) r.push(d);
  return r;
}
/** Remis le jour même avant 20 h : 100. Le lendemain avant 10 h : 50. Plus tard : 0. */
export function ponctualite(jour: string, remisLe: Date | null): number {
  if (!remisLe) return 0;
  const limite = Date.parse(`${jour}T20:00:00+01:00`);
  if (remisLe.getTime() <= limite) return 100;
  return remisLe.getTime() <= Date.parse(`${decalerJour(jour, 1)}T10:00:00+01:00`) ? 50 : 0;
}

/** Les personnes qui ont un droit sur une entité, par elle, un de ses ancêtres ou toute l'organisation. */
async function titulaires(c: Client, permissions: Permission[], entiteId: string): Promise<string[]> {
  const { rows } = await c.query(
    `with recursive anc as (select id, parent_id from entites where id = $1 union all select e.id, e.parent_id from entites e join anc on e.id = anc.parent_id)
     select distinct a.utilisateur_id as id from attributions a join role_permissions rp on rp.role_id = a.role_id join utilisateurs u on u.id = a.utilisateur_id
     where rp.permission = any($2::text[]) and u.actif and (a.expire_le is null or a.expire_le > now()) and (a.entite_id is null or a.entite_id in (select id from anc))`,
    [entiteId, permissions],
  );
  return rows.map((r) => String(r.id));
}
async function parRole(c: Client, codes: string[], entiteId: string | null): Promise<string[]> {
  const { rows } = await c.query(
    `with recursive anc as (select id, parent_id from entites where id = $1 union all select e.id, e.parent_id from entites e join anc on e.id = anc.parent_id)
     select distinct a.utilisateur_id as id from attributions a join roles r on r.id = a.role_id join utilisateurs u on u.id = a.utilisateur_id
     where r.code = any($2::text[]) and u.actif and (a.expire_le is null or a.expire_le > now())
       and ($1::uuid is null or a.entite_id is null or a.entite_id in (select id from anc))`,
    [entiteId, codes],
  );
  return rows.map((r) => String(r.id));
}
const superAdmins = (c: Client) => parRole(c, [ROLE_SUPER], null);
const directionDe = (c: Client, brancheId: string) => parRole(c, ["direction", "administrateur"], brancheId);
const brancheDe = async (c: Client, entiteId: string): Promise<string> => (await c.query("select coalesce(entite_branche($1), $1) as b", [entiteId])).rows[0].b;
const unique = (l: string[], sauf: (string | null | undefined)[] = []) => [...new Set(l)].filter((x) => !sauf.includes(x));

type Employe = { id: string; entite_id: string; poste: string; nom: string; utilisateur_id: string | null; responsable_id: string | null };

/** Responsable direct s'il est indiqué, sinon ceux qui évaluent l'entité. */
async function responsablesDe(c: Client, e: Employe): Promise<string[]> {
  if (e.responsable_id) {
    const { rows: [r] } = await c.query("select e.utilisateur_id from employes e join utilisateurs u on u.id = e.utilisateur_id where e.id = $1 and u.actif", [e.responsable_id]);
    if (r?.utilisateur_id) return [String(r.utilisateur_id)];
  }
  return unique(await titulaires(c, ["rh.evaluer"], e.entite_id), [e.utilisateur_id]);
}
/** Le niveau au-dessus : le responsable du responsable, sinon la direction de la branche. */
async function niveauSuperieur(c: Client, e: Employe): Promise<string[]> {
  if (e.responsable_id) {
    const { rows: [r] } = await c.query(
      "select n2.utilisateur_id from employes n1 join employes n2 on n2.id = n1.responsable_id join utilisateurs u on u.id = n2.utilisateur_id where n1.id = $1 and u.actif",
      [e.responsable_id],
    );
    if (r?.utilisateur_id) return [String(r.utilisateur_id)];
  }
  return directionDe(c, await brancheDe(c, e.entite_id));
}

/** Notification à une ou plusieurs personnes ; la clé évite d'envoyer deux fois la même. */
export async function notifier(c: Client, personnes: string[], cle: string, texteNotif: string, niveau: "info" | "important" | "urgent" = "info", objet?: { type: string; id: string }) {
  for (const p of unique(personnes)) {
    await c.query(
      `insert into notifications_personnes (organisation_id, utilisateur_id, cle, niveau, texte, objet_type, objet_id)
       values (org_courante(), $1, $2, $3, $4, $5, $6) on conflict do nothing`,
      [p, cle, niveau, texteNotif, objet?.type ?? null, objet?.id ?? null],
    );
  }
}

async function enConge(c: Client, employeId: string, jour: string): Promise<boolean> {
  const { rows } = await c.query("select 1 from conges where employe_id = $1 and statut = 'approuve' and $2::date between debut and fin", [employeId, jour]);
  return rows.length > 0;
}

/** Chaque matin : les objectifs du poste, pour qui travaille ce jour-là et n'est pas en congé. */
export async function preparerJournee(c: Client, jour: string): Promise<number> {
  if (!estOuvre(jour)) return 0;
  const { rowCount } = await c.query(
    `with recursive lignee(employe_id, entite_id) as (
       select id, entite_id from employes union all
       select l.employe_id, x.parent_id from lignee l join entites x on x.id = l.entite_id where x.parent_id is not null)
     insert into objectifs_jour (organisation_id, employe_id, jour, modele_id, origine, libelle, type, kpi, cible, cible_initiale, poids)
     select org_courante(), e.id, $1, m.id, 'modele', m.libelle, m.type, m.kpi, m.cible, m.cible, m.poids
     from employes e join lignee l on l.employe_id = e.id join modeles_objectifs m on m.entite_id = l.entite_id and m.poste = e.poste and m.actif
     where e.utilisateur_id is not null and e.date_embauche <= $1 and (e.date_sortie is null or e.date_sortie >= $1)
       and not exists (select 1 from conges g where g.employe_id = e.id and g.statut = 'approuve' and $1::date between g.debut and g.fin)
     on conflict (organisation_id, employe_id, jour, modele_id) where modele_id is not null do nothing`,
    [jour],
  );
  return rowCount ?? 0;
}

/** Ce que le système mesure pour pré-remplir le rapport. */
async function mesuresJour(c: Client, utilisateurId: string, jour: string) {
  const sur = (col: string) => `(${col} at time zone 'Africa/Douala')::date = $2`;
  const [terminees, retard, n] = await enchainer([
    () => c.query(`select id, titre from taches where assigne_a = $1 and statut = 'terminee' and ${sur("termine_le")} order by termine_le`, [utilisateurId, jour]),
    () => c.query("select id, titre, echeance::text from taches where assigne_a = $1 and statut in ('a_faire', 'en_cours') and echeance < $2 order by echeance limit 50", [utilisateurId, jour]),
    () => c.query(
      `select (select count(*) from activites where auteur_id = $1 and type <> 'note' and ${sur("cree_le")})::int as contacts,
         (select count(*) from opportunites where responsable_id = $1 and etape not in ('perdu') and ${sur("cree_le")})::int as interesses,
         ((select count(*) from opportunites where responsable_id = $1 and etape = 'gagne' and ${sur("clos_le")})
          + (select count(*) from documents_vente where cree_par = $1 and type = 'facture' and statut = 'emis' and ${sur("emis_le")})
          + (select count(*) from ventes_comptoir where caissier_id = $1 and annulee_le is null and ${sur("cree_le")})
          + (select count(distinct inscription_id) from paiements where encaisse_par = $1 and annule_le is null and ${sur("encaisse_le")}))::int as conclus,
         (select count(*) from relances where auteur_id = $1 and ${sur("cree_le")})::int as relances`,
      [utilisateurId, jour],
    )]);
  const m = n.rows[0];
  return {
    taches_terminees: terminees.rows, taches_en_retard: retard.rows,
    conversions: { contacts: m.contacts, interesses: m.interesses, conclus: m.conclus, taux: m.contacts ? Math.round((m.conclus * 100) / m.contacts) : null },
    relances: m.relances,
  };
}

/** Score du jour : objectifs plafonnés à 100, réalisés déclarés comptés seulement une fois validés, plus la ponctualité. */
export async function calculerScore(c: Client, e: Employe, jour: string) {
  if (!e.utilisateur_id || await enConge(c, e.id, jour)) return null;
  const { rows: objectifs } = await c.query("select * from objectifs_jour where employe_id = $1 and jour = $2 order by origine, cree_le", [e.id, jour]);
  const { rows: [r1] } = await c.query("select remis_le from rapports_jour where employe_id = $1 and jour = $2 and version = 1", [e.id, jour]);
  const lignes = [];
  for (const o of objectifs) {
    const cible = Number(o.cible);
    if (o.type === "mesure_systeme") {
      const v = (await valeurKpi(c, o.kpi, e.utilisateur_id, jour)) ?? 0;
      lignes.push({ objectif_id: o.id, libelle: o.libelle, poids: o.poids, cible, realise: v, source: "systeme", score: scoreKpi(KPI[o.kpi]?.sens ?? 1, cible, v) });
    } else {
      const v = o.valide ? Number(o.realise_declare ?? 0) : null;
      lignes.push({ objectif_id: o.id, libelle: o.libelle, poids: o.poids, cible, realise: v, declare: o.realise_declare === null ? null : Number(o.realise_declare), source: "declare", en_attente: !o.valide, score: v === null ? 0 : scoreKpi(1, cible, v) });
    }
  }
  lignes.push({ objectif_id: null, libelle: "Ponctualité du rapport", poids: PONCTUALITE_POIDS, cible: 100, realise: null, source: "rapport", score: ponctualite(jour, r1?.remis_le ?? null) });
  const score = scoreGlobal(lignes);
  const { rows: [s] } = await c.query(
    `insert into scores_jour (organisation_id, employe_id, jour, score_calcule, score, detail) values (org_courante(), $1, $2, $3, $3, $4)
     on conflict (organisation_id, employe_id, jour) do update set score_calcule = excluded.score_calcule, detail = excluded.detail, maj_le = now(),
       score = case when scores_jour.statut = 'corrige' then scores_jour.score else excluded.score end,
       statut = case when scores_jour.statut = 'corrige' then 'corrige' else 'calcule' end
     returning *`,
    [e.id, jour, score, JSON.stringify(lignes)],
  );
  return s;
}

/** Force de proposition du mois : cinq parts, cas sensibles exclus, « non évalué » sous 3 problèmes ou solutions. */
export async function forceProposition(c: Client, e: Employe, mois: string) {
  const mien = (col: string) => `to_char(${col} at time zone 'Africa/Douala', 'YYYY-MM') = $2`;
  const { rows: [p] } = await c.query(
    `select count(*)::int as signales,
       count(*) filter (where exists (select 1 from solutions s where s.probleme_id = p.id and s.auteur_id = $3))::int as avec_solution
     from problemes p where p.employe_id = $1 and not p.sensible and ${mien("p.cree_le")}`,
    [e.id, mois, e.utilisateur_id],
  );
  const { rows: sols } = await c.query(
    `select s.decision, s.note, p.employe_id = $1 as sur_mes_problemes, a.statut as action, a.efficace
     from solutions s join problemes p on p.id = s.probleme_id left join actions_solution a on a.solution_id = s.id
     where s.auteur_id = $3 and not p.sensible and ${mien("s.cree_le")}`,
    [e.id, mois, e.utilisateur_id],
  );
  const { rows: [pw] } = await c.query(
    `with recursive anc as (select id, parent_id, 0 as n from entites where id = $1 union all select x.id, x.parent_id, anc.n + 1 from entites x join anc on x.id = anc.parent_id)
     select f.* from poids_force_proposition f join anc on anc.id = f.entite_id where f.poste = $2 order by anc.n limit 1`,
    [e.entite_id, e.poste],
  );
  const poids = pw ? { reflexe: pw.reflexe, qualite: pw.qualite, acceptation: pw.acceptation, efficacite: pw.efficacite, contribution: pw.contribution } : POIDS_FORCE_DEFAUT;
  const ratio = (n: number, d: number) => (d ? Math.round((n * 100) / d) : null);
  const notes = sols.filter((s) => s.note !== null).map((s) => Number(s.note));
  const decidees = sols.filter((s) => ["acceptee", "acceptee_modifiee", "a_etudier"].includes(s.decision));
  const acceptees = decidees.filter((s) => s.decision !== "a_etudier");
  const evaluees = sols.filter((s) => s.action === "realisee" && s.efficace !== null);
  const collegues = sols.filter((s) => !s.sur_mes_problemes);
  const utiles = collegues.filter((s) => ["acceptee", "acceptee_modifiee"].includes(s.decision) || Number(s.note) >= 4);
  const parts = [
    { code: "reflexe", libelle: "Réflexe solution", poids: poids.reflexe, valeur: ratio(p.avec_solution, p.signales),
      detail: `${p.avec_solution} problème(s) signalé(s) sur ${p.signales} avec au moins une solution` },
    { code: "qualite", libelle: "Qualité des solutions", poids: poids.qualite, valeur: notes.length ? Math.round((notes.reduce((a, b) => a + b, 0) / notes.length) * 20) : null,
      detail: notes.length ? `Note moyenne ${(notes.reduce((a, b) => a + b, 0) / notes.length).toFixed(1).replace(".", ",")} sur 5, sur ${notes.length} solution(s) notée(s)` : "Aucune solution notée" },
    { code: "acceptation", libelle: "Acceptation", poids: poids.acceptation, valeur: ratio(acceptees.length, decidees.length),
      detail: `${acceptees.length} acceptée(s) sur ${decidees.length} décidée(s) ; une solution refusée ne compte que par sa note` },
    { code: "efficacite", libelle: "Efficacité", poids: poids.efficacite, valeur: ratio(evaluees.filter((s) => s.efficace).length, evaluees.length),
      detail: evaluees.length ? `${evaluees.filter((s) => s.efficace).length} problème(s) réglé(s) sur ${evaluees.length} solution(s) mise(s) en œuvre` : "Non comptée : aucune solution mise en œuvre et évaluée" },
    { code: "contribution", libelle: "Contribution aux collègues", poids: poids.contribution, valeur: collegues.length ? ratio(utiles.length, collegues.length) : 0,
      detail: `${utiles.length} solution(s) jugée(s) utile(s) sur ${collegues.length} apportée(s) aux problèmes des collègues` },
  ];
  const total = p.signales + sols.length;
  const comptees = parts.filter((x) => x.valeur !== null) as { poids: number; valeur: number }[];
  const evalue = total >= MINIMUM_FORCE && comptees.length > 0;
  return { mois, evalue, problemes: p.signales, solutions: sols.length, parts, score: evalue ? scoreGlobal(comptees.map((x) => ({ poids: x.poids, score: x.valeur }))) : null };
}

// L'évaluation mensuelle peut retenir la force de proposition comme indicateur (ajouté au démarrage du serveur).
const KPI_FORCE = {
  libelle: "Force de proposition", sens: 1, mensuel: true,
  calcul: async (c, utilisateurId, periode) => {
    const { rows: [e] } = await c.query("select id, entite_id, poste, nom, utilisateur_id, responsable_id from employes where utilisateur_id = $1", [utilisateurId]);
    return e ? (await forceProposition(c, e, periode.slice(0, 7))).score : null;
  },
} satisfies (typeof KPI)[string];

type Role = "auteur" | "gestion" | "collegue" | null;

/** Ce que d'autres modules empruntent à la performance au quotidien, une fois les routes enregistrées. */
export const crochetsPerformance: {
  signalerProbleme?: (ctx: Contexte, b: { categorie: string; description: string; destinataire: string; priorite: string; motifUrgence?: string }, resultatCleId?: string) => Promise<{ id: string; sensible: boolean }>;
} = {};
/** Les catégories, destinataires et priorités acceptés pour un problème. */
export const CATEGORIES_PROBLEME = ["client", "stock", "caisse", "materiel", "informatique", "logistique", "fournisseur", "securite", "harcelement", "equipe", "conflit_responsable", "autre"];
export const DESTINATAIRES_PROBLEME = ["responsable", "rh", "finance", "logistique", "informatique", "direction"];
export { responsablesDe, titulaires };

export function enregistrerPerformance(app: FastifyInstance, pool: pg.Pool, outils: Outils, taches: TachePlanifiee[], dossier?: string): void {
  const { protege, exiger, exigerSurEntite } = outils;
  KPI.force_proposition = KPI_FORCE;

  const monEmploye = async (ctx: Contexte): Promise<Employe> => {
    const { rows: [e] } = await ctx.client.query(
      "select id, entite_id, poste, nom, utilisateur_id, responsable_id from employes where utilisateur_id = $1 and (date_sortie is null or date_sortie >= current_date)",
      [ctx.utilisateurId],
    );
    if (!e) throw new ErreurApi(409, "dossier_employe_absent");
    return e;
  };
  const employe = async (ctx: Contexte, id: string): Promise<Employe> => {
    const { rows: [e] } = await ctx.client.query("select id, entite_id, poste, nom, utilisateur_id, responsable_id from employes where id = $1", [id]);
    if (!e) throw new ErreurApi(404, "introuvable");
    return e;
  };
  /** Le droit d'évaluer vaut sur l'entité de l'employé ou sur sa branche ; jamais sur soi-même. */
  const peutGerer = async (ctx: Contexte, entiteId: string) =>
    await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "rh.evaluer", entiteId)
    || await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "rh.evaluer", await brancheDe(ctx.client, entiteId));
  const gerer = async (ctx: Contexte, e: Employe) => {
    if (e.utilisateur_id === ctx.utilisateurId) throw new ErreurApi(403, "auto_validation_interdite");
    if (!await peutGerer(ctx, e.entite_id)) throw new ErreurApi(403, "permission_refusee");
  };
  /** Entités où la personne évalue, avec leurs magasins et dépôts. GTA et GLOMARI restent séparés par les droits. */
  const entitesGerees = async (ctx: Contexte): Promise<string[]> => {
    const acces = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "rh.evaluer")).map((x) => String(x.id));
    if (!acces.length) return [];
    const { rows } = await ctx.client.query("with recursive d as (select id from entites where id = any($1::uuid[]) union select e.id from entites e join d on e.parent_id = d.id) select id from d", [acces]);
    return rows.map((r) => String(r.id));
  };

  // ---------- Paramétrage ----------
  app.get("/performance/kpi", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "rh.evaluer");
      return kpiPersonnels().map(([code, k]) => ({ code, libelle: k.libelle, sens: k.sens, mensuel: !!k.mensuel }));
    }),
  );
  app.get<{ Querystring: { entiteId?: string } }>("/performance/modeles", { schema: { querystring: { type: "object", properties: { entiteId: uuid } } } }, async (req) =>
    protege(req, async (ctx) => {
      const ids = await entitesGerees(ctx);
      return (await ctx.client.query(
        `select m.*, e.nom as entite from modeles_objectifs m join entites e on e.id = m.entite_id
         where m.entite_id = any($1::uuid[]) and ($2::uuid is null or m.entite_id = $2) order by e.nom, m.poste, m.actif desc, m.libelle`,
        [ids, req.query.entiteId ?? null],
      )).rows;
    }),
  );
  app.post<{ Body: { entiteId: string; poste: string; libelle: string; type: string; kpi?: string; cible: number; poids: number } }>("/performance/modeles", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "poste", "libelle", "type", "cible", "poids"],
        properties: {
          entiteId: uuid, poste: texte(200), libelle: texte(200), type: { type: "string", enum: ["mesure_systeme", "chiffre_declare", "tache"] },
          kpi: { type: "string", maxLength: 60 }, cible: { type: "number", minimum: 0, maximum: 1e12 }, poids: { type: "integer", minimum: 1, maximum: 100 },
        },
      },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "rh.evaluer", b.entiteId);
      const kpiOk = b.kpi && kpiPersonnel(KPI[b.kpi]) && !KPI[b.kpi]!.mensuel;
      if ((b.type === "mesure_systeme") !== !!b.kpi || (b.type === "mesure_systeme" && !kpiOk)) throw new ErreurApi(400, "modele_invalide");
      const cible = b.type === "tache" ? 1 : b.cible;
      return (await ctx.client.query(
        `insert into modeles_objectifs (organisation_id, entite_id, poste, libelle, type, kpi, cible, poids, auteur_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
        [ctx.organisationId, b.entiteId, b.poste.trim(), b.libelle.trim(), b.type, b.type === "mesure_systeme" ? b.kpi : null, cible, b.poids, ctx.utilisateurId],
      )).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.patch<{ Params: { id: string }; Body: { actif: boolean } }>("/performance/modeles/:id", {
    schema: { params: paramId, body: { type: "object", required: ["actif"], properties: { actif: { type: "boolean" } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [m] } = await ctx.client.query("select entite_id from modeles_objectifs where id = $1", [req.params.id]);
      if (!m) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "rh.evaluer", m.entite_id);
      await ctx.client.query("update modeles_objectifs set actif = $2 where id = $1", [req.params.id, req.body.actif]);
      return { actif: req.body.actif };
    }),
  );
  /** Responsable direct : un employé de la même branche, sans boucle. */
  app.put<{ Params: { id: string }; Body: { responsableId: string | null } }>("/employes/:id/responsable", {
    schema: { params: paramId, body: { type: "object", required: ["responsableId"], properties: { responsableId: { type: ["string", "null"], format: "uuid" } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const e = await employe(ctx, req.params.id);
      if (!await peutGerer(ctx, e.entite_id)) throw new ErreurApi(403, "permission_refusee");
      const r = req.body.responsableId;
      if (r) {
        const resp = await employe(ctx, r);
        if (resp.id === e.id || await brancheDe(ctx.client, resp.entite_id) !== await brancheDe(ctx.client, e.entite_id)) throw new ErreurApi(400, "responsable_invalide");
        const { rows: [boucle] } = await ctx.client.query(
          "with recursive ch as (select id, responsable_id, 0 as n from employes where id = $1 union all select e.id, e.responsable_id, ch.n + 1 from employes e join ch on e.id = ch.responsable_id where ch.n < 50) select 1 from ch where id = $2",
          [r, e.id],
        );
        if (boucle) throw new ErreurApi(400, "responsable_invalide");
      }
      await ctx.client.query("update employes set responsable_id = $2 where id = $1", [e.id, r]);
      return { responsableId: r };
    }),
  );
  const delais = async (c: Client, brancheId: string) =>
    (await c.query("select normal_h, important_h, urgent_h from delais_problemes where branche_id = $1", [brancheId])).rows[0] ?? DELAIS_DEFAUT;
  app.get<{ Params: { id: string } }>("/performance/delais/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => { await exigerSurEntite(ctx, "rh.evaluer", req.params.id); return delais(ctx.client, req.params.id); }),
  );
  app.put<{ Params: { id: string }; Body: { normal_h: number; important_h: number; urgent_h: number } }>("/performance/delais/:id", {
    schema: {
      params: paramId,
      body: { type: "object", required: ["normal_h", "important_h", "urgent_h"], properties: { normal_h: { type: "integer", minimum: 1, maximum: 720 }, important_h: { type: "integer", minimum: 1, maximum: 720 }, urgent_h: { type: "integer", minimum: 1, maximum: 720 } } },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "rh.evaluer", req.params.id);
      if (await brancheDe(ctx.client, req.params.id) !== req.params.id) throw new ErreurApi(400, "branche_attendue");
      const b = req.body;
      await ctx.client.query(
        `insert into delais_problemes (organisation_id, branche_id, normal_h, important_h, urgent_h) values ($1, $2, $3, $4, $5)
         on conflict (organisation_id, branche_id) do update set normal_h = excluded.normal_h, important_h = excluded.important_h, urgent_h = excluded.urgent_h`,
        [ctx.organisationId, req.params.id, b.normal_h, b.important_h, b.urgent_h],
      );
      return b;
    }),
  );
  app.put<{ Body: { entiteId: string; poste: string; reflexe: number; qualite: number; acceptation: number; efficacite: number; contribution: number } }>("/performance/poids", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "poste", "reflexe", "qualite", "acceptation", "efficacite", "contribution"],
        properties: { entiteId: uuid, poste: texte(200), ...Object.fromEntries(["reflexe", "qualite", "acceptation", "efficacite", "contribution"].map((k) => [k, { type: "integer", minimum: 0, maximum: 100 }])) },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "rh.evaluer", b.entiteId);
      if (b.reflexe + b.qualite + b.acceptation + b.efficacite + b.contribution !== 100) throw new ErreurApi(400, "poids_total_100");
      await ctx.client.query(
        `insert into poids_force_proposition (organisation_id, entite_id, poste, reflexe, qualite, acceptation, efficacite, contribution) values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (organisation_id, entite_id, poste) do update set reflexe = excluded.reflexe, qualite = excluded.qualite, acceptation = excluded.acceptation, efficacite = excluded.efficacite, contribution = excluded.contribution`,
        [ctx.organisationId, b.entiteId, b.poste.trim(), b.reflexe, b.qualite, b.acceptation, b.efficacite, b.contribution],
      );
      return { enregistre: true };
    }),
  );

  // ---------- Ma journée ----------
  const dernierRapport = async (c: Client, employeId: string, jour: string) =>
    (await c.query("select * from rapports_jour where employe_id = $1 and jour = $2 order by version desc limit 1", [employeId, jour])).rows[0] ?? null;
  const objectifsAvecMesure = async (c: Client, e: Employe, jour: string) => {
    const { rows } = await c.query("select * from objectifs_jour where employe_id = $1 and jour = $2 order by origine, cree_le", [e.id, jour]);
    for (const o of rows) {
      o.cible = Number(o.cible); o.cible_initiale = Number(o.cible_initiale);
      o.realise_declare = o.realise_declare === null ? null : Number(o.realise_declare);
      o.mesure = o.type === "mesure_systeme" && e.utilisateur_id ? await valeurKpi(c, o.kpi, e.utilisateur_id, jour) : null;
    }
    return rows;
  };
  const journee = async (c: Client, e: Employe, jour: string, avecMesures: boolean) => {
    const conge = await enConge(c, e.id, jour);
    const [objectifs, rapport, score, problemes] = await enchainer([
      () => objectifsAvecMesure(c, e, jour), () => dernierRapport(c, e.id, jour),
      () => c.query("select * from scores_jour where employe_id = $1 and jour = $2", [e.id, jour]),
      () => c.query(`select p.id, p.categorie, p.priorite, p.statut, p.description, p.sensible from problemes p where p.employe_id = $1 and p.jour = $2 order by ${ORDRE_PRIORITE}, p.cree_le`, [e.id, jour])]);
    return {
      employe: { id: e.id, nom: e.nom, poste: e.poste }, jour, ouvre: estOuvre(jour), conge, objectifs, rapport,
      mesures: avecMesures && e.utilisateur_id ? await mesuresJour(c, e.utilisateur_id, jour) : null,
      score: conge ? null : score.rows[0] ?? null, problemes: problemes.rows,
      urgence: problemes.rows.some((p) => p.priorite === "urgent" && !["resolu", "clos"].includes(p.statut)),
    };
  };
  app.get<{ Querystring: { jour?: string } }>("/moi/journee", { schema: { querystring: { type: "object", properties: { jour: date } } } }, async (req) =>
    protege(req, async (ctx) => {
      const e = await monEmploye(ctx);
      const jour = req.query.jour ?? jourDouala();
      const base = await journee(ctx.client, e, jour, true);
      const semaine = (await ctx.client.query(
        "select jour::text, score, statut from scores_jour where employe_id = $1 and jour between $2::date - 6 and $2 order by jour", [e.id, jour],
      )).rows;
      const pieces = base.rapport ? (await ctx.client.query("select id, nom, taille from pieces_performance where objet_type = 'rapport' and objet_id = $1", [base.rapport.id])).rows : [];
      return { ...base, semaine, pieces, max_personnels: MAX_OBJECTIFS_PERSONNELS };
    }),
  );
  app.post<{ Body: { libelle: string; type: "chiffre_declare" | "tache"; cible?: number; poids?: number } }>("/moi/objectifs", {
    schema: { body: { type: "object", required: ["libelle", "type"], properties: { libelle: texte(200), type: { type: "string", enum: ["chiffre_declare", "tache"] }, cible: { type: "number", minimum: 0, maximum: 1e12 }, poids: { type: "integer", minimum: 1, maximum: 100 } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const e = await monEmploye(ctx);
      const jour = jourDouala();
      if (await enConge(ctx.client, e.id, jour)) throw new ErreurApi(409, "jour_de_conge");
      const rap = await dernierRapport(ctx.client, e.id, jour);
      if (rap?.statut === "remis") throw new ErreurApi(409, "rapport_fige");
      const { rows: [n] } = await ctx.client.query("select count(*)::int as n from objectifs_jour where employe_id = $1 and jour = $2 and origine = 'personnel'", [e.id, jour]);
      if (n.n >= MAX_OBJECTIFS_PERSONNELS) throw new ErreurApi(409, "trop_objectifs_personnels", { max: MAX_OBJECTIFS_PERSONNELS });
      const cible = req.body.type === "tache" ? 1 : req.body.cible ?? 1;
      return (await ctx.client.query(
        `insert into objectifs_jour (organisation_id, employe_id, jour, origine, libelle, type, cible, cible_initiale, poids) values ($1, $2, $3, 'personnel', $4, $5, $6, $6, $7) returning *`,
        [ctx.organisationId, e.id, jour, req.body.libelle.trim(), req.body.type, cible, req.body.poids ?? 10],
      )).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.delete<{ Params: { id: string } }>("/moi/objectifs/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const e = await monEmploye(ctx);
      const { rows: [o] } = await ctx.client.query("select jour::text from objectifs_jour where id = $1 and employe_id = $2 and origine = 'personnel'", [req.params.id, e.id]);
      if (!o) throw new ErreurApi(404, "introuvable");
      if ((await dernierRapport(ctx.client, e.id, o.jour))?.statut === "remis") throw new ErreurApi(409, "rapport_fige");
      await ctx.client.query("delete from objectifs_jour where id = $1", [req.params.id]);
      return { retire: true };
    }),
  );

  /** Le contenu saisi : réalisés déclarés, tâches, conversions et suivi. */
  type Saisie = {
    jour: string; realises?: { objectifId: string; valeur: number }[];
    taches?: { reportees?: string; commentaire?: string };
    conversions?: { contacts?: number; interesses?: number; conclus?: number };
    suivi?: { relances?: number; prochaines_actions?: string; plan_lendemain?: string };
    commentaire?: string; motif?: string;
  };
  const nombre = { type: "integer", minimum: 0, maximum: 100000 } as const;
  const schemaSaisie = {
    type: "object", required: ["jour"],
    properties: {
      jour: date, motif: texte(1000, 3), commentaire: texte(3000, 0),
      realises: { type: "array", maxItems: 30, items: { type: "object", required: ["objectifId", "valeur"], properties: { objectifId: uuid, valeur: { type: "number", minimum: 0, maximum: 1e12 } } } },
      taches: { type: "object", properties: { reportees: texte(2000, 0), commentaire: texte(2000, 0) } },
      conversions: { type: "object", properties: { contacts: nombre, interesses: nombre, conclus: nombre } },
      suivi: { type: "object", properties: { relances: nombre, prochaines_actions: texte(2000, 0), plan_lendemain: texte(2000, 0) } },
    },
  } as const;
  const enregistrerSaisie = async (ctx: Contexte, e: Employe, b: Saisie) => {
    for (const r of b.realises ?? []) {
      const { rowCount } = await ctx.client.query(
        `update objectifs_jour set realise_declare = case when type = 'tache' then least($3::numeric, 1) else $3::numeric end, declare_le = now(),
           valide = case when realise_declare is distinct from (case when type = 'tache' then least($3::numeric, 1) else $3::numeric end) then false else valide end
         where id = $1 and employe_id = $2 and jour = $4 and type <> 'mesure_systeme'`,
        [r.objectifId, e.id, r.valeur, b.jour],
      );
      if (!rowCount) throw new ErreurApi(404, "introuvable");
    }
    const conv = b.conversions ?? {};
    const taux = conv.contacts ? Math.round(((conv.conclus ?? 0) * 100) / conv.contacts) : null;
    return { taches: b.taches ?? {}, conversions: { ...conv, taux }, suivi: b.suivi ?? {}, commentaire: b.commentaire ?? "" };
  };
  /** Brouillon tant que le rapport n'est pas remis. */
  app.put<{ Body: Saisie }>("/moi/rapport", { schema: { body: schemaSaisie } }, async (req) =>
    protege(req, async (ctx) => {
      const e = await monEmploye(ctx);
      if (req.body.jour > jourDouala()) throw new ErreurApi(400, "jour_futur");
      if (await enConge(ctx.client, e.id, req.body.jour)) throw new ErreurApi(409, "jour_de_conge");
      const r = await dernierRapport(ctx.client, e.id, req.body.jour);
      if (r?.statut === "remis") throw new ErreurApi(409, "rapport_fige");
      const contenu = await enregistrerSaisie(ctx, e, req.body);
      if (r) await ctx.client.query("update rapports_jour set contenu = $2 where id = $1", [r.id, JSON.stringify(contenu)]);
      else await ctx.client.query("insert into rapports_jour (organisation_id, employe_id, jour, contenu, auteur_id) values ($1, $2, $3, $4, $5)", [ctx.organisationId, e.id, req.body.jour, JSON.stringify(contenu), ctx.utilisateurId]);
      return { statut: "brouillon" };
    }),
  );
  /** Remise : le rapport se fige, avec les mesures du système à ce moment-là, et le score se calcule. */
  app.post<{ Body: { jour: string } }>("/moi/rapport/remise", { schema: { body: { type: "object", required: ["jour"], properties: { jour: date } } } }, async (req) =>
    protege(req, async (ctx) => {
      const e = await monEmploye(ctx);
      const jour = req.body.jour;
      if (await enConge(ctx.client, e.id, jour)) throw new ErreurApi(409, "jour_de_conge");
      let r = await dernierRapport(ctx.client, e.id, jour);
      if (r?.statut === "remis") throw new ErreurApi(409, "rapport_deja_remis");
      if (!r) r = (await ctx.client.query("insert into rapports_jour (organisation_id, employe_id, jour, auteur_id) values ($1, $2, $3, $4) returning *", [ctx.organisationId, e.id, jour, ctx.utilisateurId])).rows[0];
      const mesures = await mesuresJour(ctx.client, ctx.utilisateurId, jour);
      const { rows: problemes } = await ctx.client.query("select id, categorie, priorite, statut from problemes where employe_id = $1 and jour = $2", [e.id, jour]);
      await ctx.client.query("update rapports_jour set statut = 'remis', remis_le = now(), contenu = contenu || $2 where id = $1", [r.id, JSON.stringify({ mesures, problemes })]);
      const s = await calculerScore(ctx.client, e, jour);
      return { statut: "remis", score: s?.score ?? null };
    }),
  );
  /** Correction d'un rapport remis : une nouvelle version, avec son motif. L'ancienne reste visible. */
  app.post<{ Body: Saisie & { motif: string } }>("/moi/rapport/version", {
    schema: { body: { ...schemaSaisie, required: ["jour", "motif"] } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const e = await monEmploye(ctx);
      const r = await dernierRapport(ctx.client, e.id, req.body.jour);
      if (r?.statut !== "remis") throw new ErreurApi(409, "rapport_non_remis");
      const contenu = await enregistrerSaisie(ctx, e, req.body);
      const mesures = await mesuresJour(ctx.client, ctx.utilisateurId, req.body.jour);
      await ctx.client.query(
        `insert into rapports_jour (organisation_id, employe_id, jour, version, statut, contenu, motif_version, remis_le, auteur_id)
         values ($1, $2, $3, $4, 'remis', $5, $6, now(), $7)`,
        [ctx.organisationId, e.id, req.body.jour, r.version + 1, JSON.stringify({ ...contenu, mesures, problemes: r.contenu.problemes ?? [] }), req.body.motif, ctx.utilisateurId],
      );
      await ctx.client.query("select journal_evenement('performance.rapport_version', $1)", [JSON.stringify({ employe: e.id, jour: req.body.jour, version: r.version + 1, motif: req.body.motif })]);
      await calculerScore(ctx.client, e, req.body.jour);
      return { version: r.version + 1 };
    }),
  );
  app.post<{ Params: { id: string }; Body: { commentaire: string } }>("/moi/scores-jour/:id/contestation", {
    schema: { params: paramId, body: { type: "object", required: ["commentaire"], properties: { commentaire: texte(3000, 5) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const e = await monEmploye(ctx);
      const { rowCount } = await ctx.client.query(
        "update scores_jour set statut = 'conteste', contestation = $3, conteste_le = now() where id = $1 and employe_id = $2", [req.params.id, e.id, req.body.commentaire],
      );
      if (!rowCount) throw new ErreurApi(404, "introuvable");
      await notifier(ctx.client, await responsablesDe(ctx.client, e), `contestation-score-${req.params.id}-${Date.now()}`, `${e.nom} conteste son score du jour.`, "important", { type: "score", id: req.params.id });
      return { statut: "conteste" };
    }),
  );
  app.get<{ Querystring: { mois: string } }>("/moi/force-proposition", { schema: { querystring: { type: "object", required: ["mois"], properties: { mois: { type: "string", pattern: "^\\d{4}-\\d{2}$" } } } } }, async (req) =>
    protege(req, async (ctx) => forceProposition(ctx.client, await monEmploye(ctx), req.query.mois)),
  );

  // ---------- Le responsable ----------
  app.patch<{ Params: { id: string }; Body: { cible: number; motif: string } }>("/objectifs-jour/:id", {
    schema: { params: paramId, body: { type: "object", required: ["cible", "motif"], properties: { cible: { type: "number", minimum: 0, maximum: 1e12 }, motif } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [o] } = await ctx.client.query("select employe_id, jour::text, type from objectifs_jour where id = $1", [req.params.id]);
      if (!o) throw new ErreurApi(404, "introuvable");
      await gerer(ctx, await employe(ctx, o.employe_id));
      if (o.jour !== jourDouala() || heureDouala() >= 12) throw new ErreurApi(409, "ajustement_trop_tard");
      await ctx.client.query(
        "update objectifs_jour set cible = $2, motif_ajustement = $3, ajuste_par = $4, ajuste_le = now() where id = $1",
        [req.params.id, o.type === "tache" ? 1 : req.body.cible, req.body.motif, ctx.utilisateurId],
      );
      return { cible: req.body.cible };
    }),
  );
  /** Un réalisé déclaré ne compte qu'une fois validé. Le responsable peut le corriger, avec un motif. */
  app.post<{ Params: { id: string }; Body: { valeur?: number; motif?: string } }>("/objectifs-jour/:id/validation", {
    schema: { params: paramId, body: { type: "object", properties: { valeur: { type: "number", minimum: 0, maximum: 1e12 }, motif } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [o] } = await ctx.client.query("select employe_id, jour::text, type, realise_declare from objectifs_jour where id = $1", [req.params.id]);
      if (!o || o.type === "mesure_systeme") throw new ErreurApi(404, "introuvable");
      const e = await employe(ctx, o.employe_id);
      await gerer(ctx, e);
      const corrige = req.body.valeur !== undefined && Number(req.body.valeur) !== Number(o.realise_declare);
      if (corrige && !req.body.motif) throw new ErreurApi(400, "motif_requis");
      if (o.realise_declare === null && req.body.valeur === undefined) throw new ErreurApi(409, "rien_a_valider");
      await ctx.client.query(
        "update objectifs_jour set valide = true, valide_par = $2, valide_le = now(), realise_declare = coalesce($3, realise_declare) where id = $1",
        [req.params.id, ctx.utilisateurId, req.body.valeur ?? null],
      );
      if (corrige) await ctx.client.query("select journal_evenement('performance.realise_corrige', $1)", [JSON.stringify({ objectif: req.params.id, avant: o.realise_declare, apres: req.body.valeur, motif: req.body.motif })]);
      const s = await calculerScore(ctx.client, e, o.jour);
      return { valide: true, score: s?.score ?? null };
    }),
  );
  app.post<{ Params: { id: string }; Body: { action: "valider" | "commenter" | "corriger"; score?: number; commentaire?: string; motif?: string } }>("/scores-jour/:id/decision", {
    schema: {
      params: paramId,
      body: { type: "object", required: ["action"], properties: { action: { type: "string", enum: ["valider", "commenter", "corriger"] }, score: { type: "integer", minimum: 0, maximum: 100 }, commentaire: texte(3000, 0), motif } },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [s] } = await ctx.client.query("select * from scores_jour where id = $1", [req.params.id]);
      if (!s) throw new ErreurApi(404, "introuvable");
      const e = await employe(ctx, s.employe_id);
      await gerer(ctx, e);
      const b = req.body;
      if (b.action === "corriger" && (b.score === undefined || !b.motif)) throw new ErreurApi(400, "motif_requis");
      const statut = b.action === "corriger" ? "corrige" : b.action === "valider" ? "valide" : s.statut;
      await ctx.client.query(
        `update scores_jour set statut = $2, score = coalesce($3, score), motif_correction = coalesce($4, motif_correction),
           commentaire_responsable = coalesce($5, commentaire_responsable), decide_par = $6, decide_le = now() where id = $1`,
        [s.id, statut, b.action === "corriger" ? b.score : null, b.action === "corriger" ? b.motif : null, b.commentaire?.trim() || null, ctx.utilisateurId],
      );
      if (b.action === "corriger") await ctx.client.query("select journal_evenement('performance.score_corrige', $1)", [JSON.stringify({ score: s.id, avant: s.score, apres: b.score, motif: b.motif })]);
      if (e.utilisateur_id) await notifier(ctx.client, [e.utilisateur_id], `score-${s.id}-${statut}-${Date.now()}`, `Votre score du ${s.jour.slice?.(0, 10) ?? s.jour} a été ${b.action === "corriger" ? "corrigé" : b.action === "valider" ? "validé" : "commenté"}.`, "info", { type: "score", id: s.id });
      return { statut };
    }),
  );
  /** Mon équipe : rapports rendus ou manquants, scores, validations à faire, urgences en premier. */
  app.get<{ Querystring: { jour?: string } }>("/equipe/journee", { schema: { querystring: { type: "object", properties: { jour: date } } } }, async (req) =>
    protege(req, async (ctx) => {
      const ids = await entitesGerees(ctx);
      if (!ids.length) throw new ErreurApi(403, "permission_refusee");
      const jour = req.query.jour ?? jourDouala();
      const { rows: membres } = await ctx.client.query(
        `select e.id, e.entite_id, e.poste, e.nom, e.utilisateur_id, e.responsable_id, x.nom as entite,
           (select statut from rapports_jour r where r.employe_id = e.id and r.jour = $2 order by version desc limit 1) as rapport,
           (select remis_le from rapports_jour r where r.employe_id = e.id and r.jour = $2 and version = 1) as remis_le,
           (select json_build_object('id', s.id, 'score', s.score, 'statut', s.statut, 'contestation', s.contestation) from scores_jour s where s.employe_id = e.id and s.jour = $2) as score,
           (select count(*) from objectifs_jour o where o.employe_id = e.id and o.jour = $2)::int as objectifs,
           (select coalesce(json_agg(json_build_object('id', o.id, 'libelle', o.libelle, 'cible', o.cible, 'declare', o.realise_declare, 'type', o.type)), '[]') from objectifs_jour o
              where o.employe_id = e.id and o.jour = $2 and o.type <> 'mesure_systeme' and o.realise_declare is not null and not o.valide) as a_valider,
           exists (select 1 from conges g where g.employe_id = e.id and g.statut = 'approuve' and $2::date between g.debut and g.fin) as conge,
           exists (select 1 from problemes p where p.employe_id = e.id and p.jour = $2 and p.priorite = 'urgent' and p.statut not in ('resolu', 'clos') and not p.sensible) as urgence
         from employes e join entites x on x.id = e.entite_id
         where e.entite_id = any($1::uuid[]) and e.utilisateur_id is not null and e.utilisateur_id <> $3 and (e.date_sortie is null or e.date_sortie >= $2)
         order by e.nom`,
        [ids, jour, ctx.utilisateurId],
      );
      const problemes = await problemesVisibles(ctx, "gestion");
      const ouverts = problemes.filter((p) => !["resolu", "clos"].includes(p.statut));
      const { rows: solutions } = await ctx.client.query(
        `select s.id, s.description, s.decision, s.date_reexamen::text, s.cout_estime, s.cree_le, p.id as probleme_id, p.categorie, u.nom as auteur
         from solutions s join problemes p on p.id = s.probleme_id join utilisateurs u on u.id = s.auteur_id
         where p.id = any($1::uuid[]) and s.decision in ('en_attente', 'a_etudier') order by s.decision, s.cree_le`,
        [problemes.map((p) => p.id)],
      );
      return {
        jour, membres, problemes: ouverts, solutions,
        urgences: ouverts.filter((p) => p.priorite === "urgent").length,
        rapports: { rendus: membres.filter((m) => m.rapport === "remis").length, attendus: membres.filter((m) => !m.conge && m.objectifs > 0).length },
      };
    }),
  );
  app.get<{ Params: { id: string }; Querystring: { jour: string } }>("/equipe/employes/:id/journee", {
    schema: { params: paramId, querystring: { type: "object", required: ["jour"], properties: { jour: date } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const e = await employe(ctx, req.params.id);
      await gerer(ctx, e);
      const j = await journee(ctx.client, e, req.query.jour, false);
      // Un cas sensible n'apparaît jamais au responsable : il ne voit que les autres problèmes.
      const visibles = [];
      for (const p of j.problemes) if (!p.sensible || await role(ctx, (await probleme(ctx, p.id)))) visibles.push(p);
      const versions = (await ctx.client.query("select version, statut, motif_version, remis_le, contenu from rapports_jour where employe_id = $1 and jour = $2 order by version", [e.id, req.query.jour])).rows;
      return { ...j, problemes: visibles, versions };
    }),
  );
  app.get<{ Params: { id: string }; Querystring: { mois: string } }>("/equipe/employes/:id/force-proposition", {
    schema: { params: paramId, querystring: { type: "object", required: ["mois"], properties: { mois: { type: "string", pattern: "^\\d{4}-\\d{2}$" } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const e = await employe(ctx, req.params.id);
      await gerer(ctx, e);
      return forceProposition(ctx.client, e, req.query.mois);
    }),
  );

  // ---------- Problèmes rencontrés ----------
  const probleme = async (ctx: Contexte, id: string) => {
    const { rows: [p] } = await ctx.client.query(
      `select p.*, e.nom as employe, e.responsable_id, e.poste, e.utilisateur_id as employe_utilisateur, coalesce(entite_branche(p.entite_id), p.entite_id) as branche_id,
         u.nom as pris_en_charge_nom
       from problemes p join employes e on e.id = p.employe_id left join utilisateurs u on u.id = p.pris_en_charge_par where p.id = $1`,
      [id],
    );
    if (!p) throw new ErreurApi(404, "introuvable");
    return p;
  };
  const employeDuProbleme = (p: Record<string, any>): Employe => ({ id: p.employe_id, entite_id: p.entite_id, poste: p.poste, nom: p.employe, utilisateur_id: p.employe_utilisateur, responsable_id: p.responsable_id });
  /** Qui peut gérer un cas sensible : les RH et la direction de la branche, ou un super administrateur, jamais le responsable concerné. */
  const gestionSensible = async (c: Client, p: Record<string, any>) =>
    unique([...await titulaires(c, ["rh.gerer"], p.branche_id), ...await directionDe(c, p.branche_id)], [p.responsable_concerne, p.auteur_id]);
  const gestionnaires = async (c: Client, p: Record<string, any>): Promise<string[]> => {
    if (p.sensible) {
      const g = await gestionSensible(c, p);
      return g.length ? g : unique(await superAdmins(c), [p.responsable_concerne, p.auteur_id]);
    }
    const service = SERVICES[p.destinataire] ? unique(await titulaires(c, SERVICES[p.destinataire]!, p.branche_id), [p.auteur_id]) : [];
    if (p.destinataire === "direction") return unique(await directionDe(c, p.branche_id), [p.auteur_id]);
    return service.length ? service : await responsablesDe(c, employeDuProbleme(p));
  };
  const role = async (ctx: Contexte, p: Record<string, any>): Promise<Role> => {
    const moi = ctx.utilisateurId;
    if (p.auteur_id === moi) return "auteur";
    if (p.sensible && p.responsable_concerne === moi) return null;
    if (p.pris_en_charge_par === moi) return "gestion";
    if ((await superAdmins(ctx.client)).includes(moi)) return "gestion";
    if (p.sensible) return (await gestionSensible(ctx.client, p)).includes(moi) ? "gestion" : null;
    if (await peutGerer(ctx, p.entite_id) || (await gestionnaires(ctx.client, p)).includes(moi) || (await directionDe(ctx.client, p.branche_id)).includes(moi)) return "gestion";
    if (p.niveau_escalade > 0 && (await niveauSuperieur(ctx.client, employeDuProbleme(p))).includes(moi)) return "gestion";
    // Un collègue de la même branche voit le problème et peut proposer une solution.
    const { rows: [col] } = await ctx.client.query(
      "select 1 from employes where utilisateur_id = $1 and coalesce(entite_branche(entite_id), entite_id) = $2 and (date_sortie is null or date_sortie >= current_date)", [moi, p.branche_id],
    );
    return col ? "collegue" : null;
  };
  const exigerRole = async (ctx: Contexte, p: Record<string, any>, attendus: Role[]) => {
    const r = await role(ctx, p);
    if (!r) throw new ErreurApi(404, "introuvable");
    if (!attendus.includes(r)) throw new ErreurApi(403, "permission_refusee");
    return r;
  };
  /** Problèmes que la personne voit avec ce rôle, urgents d'abord puis par échéance. */
  const problemesVisibles = async (ctx: Contexte, attendu: "gestion" | "collegue") => {
    const { rows } = await ctx.client.query(
      `select p.id from problemes p where p.auteur_id <> $1 and (p.statut not in ('clos') or p.cree_le > now() - interval '30 days')
       order by ${ORDRE_PRIORITE}, p.echeance limit 400`, [ctx.utilisateurId],
    );
    const res = [];
    for (const r of rows) {
      const p = await probleme(ctx, r.id);
      if (await role(ctx, p) === attendu) res.push(resume(p));
    }
    return res;
  };
  const resume = (p: Record<string, any>) => ({
    id: p.id, categorie: p.categorie, sensible: p.sensible, priorite: p.priorite, couleur: COULEURS_PRIORITE[p.priorite as keyof typeof COULEURS_PRIORITE],
    statut: p.statut, description: p.description, employe: p.employe, jour: p.jour, echeance: p.echeance, hors_delai: p.statut === "signale" && new Date(p.echeance) < new Date(),
    niveau_escalade: p.niveau_escalade, pris_en_charge_par: p.pris_en_charge_nom, cree_le: p.cree_le, destinataire: p.destinataire,
  });
  const historiser = (ctx: Contexte, problemeId: string, action: string, details: object = {}) =>
    ctx.client.query("insert into historique_probleme (organisation_id, probleme_id, action, details, auteur_id) values ($1, $2, $3, $4, $5)", [ctx.organisationId, problemeId, action, JSON.stringify(details), ctx.utilisateurId]);
  /** Notifie selon la priorité : urgent au responsable et à la direction de la branche, important au responsable. */
  const prevenir = async (c: Client, p: Record<string, any>, cle: string) => {
    const g = await gestionnaires(c, p);
    const libelle = `${p.priorite === "urgent" ? "URGENT : " : p.priorite === "important" ? "Important : " : ""}problème signalé par ${p.employe}`;
    if (p.priorite === "urgent") {
      const dir = await directionDe(c, p.branche_id);
      await notifier(c, unique([...g, ...dir], p.sensible ? [p.responsable_concerne, p.auteur_id] : [p.auteur_id]), cle, libelle, "urgent", { type: "probleme", id: p.id });
    } else await notifier(c, g, cle, libelle, p.priorite === "important" ? "important" : "info", { type: "probleme", id: p.id });
  };
  const echeancePour = async (c: Client, brancheId: string, priorite: string, depuis = new Date()) => {
    const d = await delais(c, brancheId);
    const h = priorite === "urgent" ? d.urgent_h : priorite === "important" ? d.important_h : d.normal_h;
    return new Date(depuis.getTime() + h * 3600_000);
  };
  const schemaSolution = {
    type: "object", required: ["description"],
    properties: { description: texte(5000, 3), moyens: texte(2000, 0), coutEstime: { type: "integer", minimum: 0, maximum: 1e12 }, delai: texte(200, 0), resultatAttendu: texte(2000, 0) },
  } as const;
  type SaisieSolution = { description: string; moyens?: string; coutEstime?: number; delai?: string; resultatAttendu?: string };
  const ajouterSolution = async (ctx: Contexte, problemeId: string, s: SaisieSolution) => {
    const { rows: [e] } = await ctx.client.query("select id from employes where utilisateur_id = $1", [ctx.utilisateurId]);
    return (await ctx.client.query(
      `insert into solutions (organisation_id, probleme_id, auteur_id, employe_id, description, moyens, cout_estime, delai, resultat_attendu)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [ctx.organisationId, problemeId, ctx.utilisateurId, e?.id ?? null, s.description.trim(), s.moyens?.trim() || null, s.coutEstime ?? null, s.delai?.trim() || null, s.resultatAttendu?.trim() || null],
    )).rows[0].id as string;
  };

  type SaisieProbleme = { categorie: string; description: string; impact?: string; aideAttendue?: string; destinataire: string; priorite: string; motifUrgence?: string; solutions?: SaisieSolution[] };
  app.post<{ Body: SaisieProbleme }>("/problemes", {
    schema: {
      body: {
        type: "object", required: ["categorie", "description", "destinataire", "priorite"],
        properties: {
          categorie: { type: "string", enum: ["client", "stock", "caisse", "materiel", "informatique", "logistique", "fournisseur", "securite", "harcelement", "equipe", "conflit_responsable", "autre"] },
          description: texte(5000, 3), impact: texte(2000, 0), aideAttendue: texte(2000, 0),
          destinataire: { type: "string", enum: ["responsable", "rh", "finance", "logistique", "informatique", "direction"] },
          priorite: { type: "string", enum: ["normal", "important", "urgent"] }, motifUrgence: texte(1000, 0),
          solutions: { type: "array", maxItems: 5, items: schemaSolution },
        },
      },
    },
  }, async (req, reponse) => {
    const r = await protege(req, (ctx) => signaler(ctx, req.body));
    return reponse.status(201).send(r);
  });
  /** Signaler un problème : depuis l'écran dédié ou depuis un blocage du point hebdomadaire OKR. */
  async function signaler(ctx: Contexte, b: SaisieProbleme, resultatCleId?: string): Promise<{ id: string; sensible: boolean }> {
    {
      const e = await monEmploye(ctx);
      if (b.priorite === "urgent" && !b.motifUrgence?.trim()) throw new ErreurApi(400, "motif_urgence_obligatoire");
      const branche = await brancheDe(ctx.client, e.entite_id);
      const { rows: [resp] } = e.responsable_id ? await ctx.client.query("select utilisateur_id from employes where id = $1", [e.responsable_id]) : { rows: [] };
      const sensible = CATEGORIES_SENSIBLES.includes(b.categorie);
      const { rows: [p] } = await ctx.client.query(
        `insert into problemes (organisation_id, entite_id, employe_id, auteur_id, jour, categorie, description, impact, aide_attendue, destinataire, priorite, motif_urgence, echeance, responsable_concerne, resultat_cle_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
        [ctx.organisationId, e.entite_id, e.id, ctx.utilisateurId, jourDouala(), b.categorie, b.description.trim(), b.impact?.trim() || null, b.aideAttendue?.trim() || null,
          // Un cas sensible ne passe jamais par le responsable : il va aux RH ou à la direction.
          sensible && b.destinataire === "responsable" ? "rh" : b.destinataire, b.priorite, b.motifUrgence?.trim() || null,
          await echeancePour(ctx.client, branche, b.priorite), resp?.utilisateur_id ?? null, resultatCleId ?? null],
      );
      for (const s of b.solutions ?? []) await ajouterSolution(ctx, p.id, s);
      await historiser(ctx, p.id, "signale", { priorite: b.priorite, ...(resultatCleId ? { resultat_cle: resultatCleId } : {}) });
      await prevenir(ctx.client, await probleme(ctx, p.id), `probleme-${p.id}`);
      return { id: p.id as string, sensible };
    }
  }
  crochetsPerformance.signalerProbleme = signaler;
  app.get("/moi/problemes", async (req) =>
    protege(req, async (ctx) => {
      const { rows } = await ctx.client.query(`select p.id from problemes p where p.auteur_id = $1 order by p.statut in ('resolu', 'clos'), ${ORDRE_PRIORITE}, p.cree_le desc limit 100`, [ctx.utilisateurId]);
      const mes = [];
      for (const r of rows) mes.push(resume(await probleme(ctx, r.id)));
      return { mes, collegues: await problemesVisibles(ctx, "collegue") };
    }),
  );
  app.get<{ Params: { id: string } }>("/problemes/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const p = await probleme(ctx, req.params.id);
      const r = await exigerRole(ctx, p, ["auteur", "gestion", "collegue"]);
      const [commentaires, historique, solutions, pieces] = await enchainer([
        () => ctx.client.query("select c.id, c.texte, c.cree_le, u.nom as auteur from commentaires_probleme c join utilisateurs u on u.id = c.auteur_id where c.probleme_id = $1 order by c.cree_le", [p.id]),
        () => r === "collegue" ? Promise.resolve({ rows: [] as Record<string, unknown>[] }) : ctx.client.query("select h.action, h.details, h.cree_le, u.nom as auteur from historique_probleme h left join utilisateurs u on u.id = h.auteur_id where h.probleme_id = $1 order by h.cree_le", [p.id]),
        () => ctx.client.query(
          `select s.*, u.nom as auteur, a.id as action_id, a.statut as action_statut, a.echeance::text as action_echeance, a.efficace, ra.nom as action_responsable
           from solutions s join utilisateurs u on u.id = s.auteur_id left join actions_solution a on a.solution_id = s.id left join utilisateurs ra on ra.id = a.responsable_id
           where s.probleme_id = $1 order by s.cree_le`, [p.id]),
        () => ctx.client.query("select id, objet_type, objet_id, nom, taille from pieces_performance where (objet_type = 'probleme' and objet_id = $1) or (objet_type = 'commentaire' and objet_id in (select id from commentaires_probleme where probleme_id = $1)) or (objet_type = 'solution' and objet_id in (select id from solutions where probleme_id = $1))", [p.id])]);
      return { ...resume(p), impact: p.impact, aide_attendue: p.aide_attendue, motif_urgence: p.motif_urgence, pris_en_charge_le: p.pris_en_charge_le, resolu_le: p.resolu_le, role: r,
        commentaires: commentaires.rows, historique: historique.rows, solutions: solutions.rows, pieces: pieces.rows };
    }),
  );
  app.post<{ Params: { id: string } }>("/problemes/:id/prise-en-charge", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const p = await probleme(ctx, req.params.id);
      await exigerRole(ctx, p, ["gestion"]);
      if (p.statut !== "signale") throw new ErreurApi(409, "deja_pris_en_charge");
      await ctx.client.query("update problemes set statut = 'pris_en_charge', pris_en_charge_par = $2, pris_en_charge_le = now() where id = $1", [p.id, ctx.utilisateurId]);
      await historiser(ctx, p.id, "pris_en_charge");
      await notifier(ctx.client, [p.auteur_id], `prise-${p.id}`, "Votre problème est pris en charge.", "info", { type: "probleme", id: p.id });
      return { statut: "pris_en_charge" };
    }),
  );
  app.post<{ Params: { id: string }; Body: { statut: "en_cours" | "resolu" } }>("/problemes/:id/statut", {
    schema: { params: paramId, body: { type: "object", required: ["statut"], properties: { statut: { type: "string", enum: ["en_cours", "resolu"] } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const p = await probleme(ctx, req.params.id);
      await exigerRole(ctx, p, ["gestion"]);
      if (p.statut === "clos") throw new ErreurApi(409, "probleme_clos");
      await ctx.client.query(
        "update problemes set statut = $2, resolu_le = case when $2 = 'resolu' then now() else resolu_le end, pris_en_charge_par = coalesce(pris_en_charge_par, $3), pris_en_charge_le = coalesce(pris_en_charge_le, now()) where id = $1",
        [p.id, req.body.statut, ctx.utilisateurId],
      );
      await historiser(ctx, p.id, req.body.statut);
      if (req.body.statut === "resolu") await notifier(ctx.client, [p.auteur_id], `resolu-${p.id}-${Date.now()}`, "Votre problème est marqué résolu : confirmez ou rouvrez-le.", "info", { type: "probleme", id: p.id });
      return { statut: req.body.statut };
    }),
  );
  /** Le collaborateur confirme que c'est réglé, ou rouvre le problème. */
  app.post<{ Params: { id: string }; Body: { resolu: boolean; commentaire?: string } }>("/problemes/:id/confirmation", {
    schema: { params: paramId, body: { type: "object", required: ["resolu"], properties: { resolu: { type: "boolean" }, commentaire: texte(3000, 0) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const p = await probleme(ctx, req.params.id);
      await exigerRole(ctx, p, ["auteur"]);
      if (p.statut !== "resolu") throw new ErreurApi(409, "probleme_non_resolu");
      if (req.body.resolu) await ctx.client.query("update problemes set statut = 'clos', clos_le = now() where id = $1", [p.id]);
      else await ctx.client.query("update problemes set statut = 'en_cours', resolu_le = null, reouvert = reouvert + 1 where id = $1", [p.id]);
      if (req.body.commentaire?.trim()) await ctx.client.query("insert into commentaires_probleme (organisation_id, probleme_id, auteur_id, texte) values ($1, $2, $3, $4)", [ctx.organisationId, p.id, ctx.utilisateurId, req.body.commentaire.trim()]);
      await historiser(ctx, p.id, req.body.resolu ? "clos" : "rouvert");
      if (!req.body.resolu && p.pris_en_charge_par) await notifier(ctx.client, [p.pris_en_charge_par], `rouvert-${p.id}-${Date.now()}`, `${p.employe} rouvre son problème.`, "important", { type: "probleme", id: p.id });
      return { statut: req.body.resolu ? "clos" : "en_cours" };
    }),
  );
  app.post<{ Params: { id: string }; Body: { priorite: string; motif: string } }>("/problemes/:id/priorite", {
    schema: { params: paramId, body: { type: "object", required: ["priorite", "motif"], properties: { priorite: { type: "string", enum: ["normal", "important", "urgent"] }, motif } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const p = await probleme(ctx, req.params.id);
      await exigerRole(ctx, p, ["gestion"]);
      if (["resolu", "clos"].includes(p.statut)) throw new ErreurApi(409, "probleme_clos");
      const echeance = await echeancePour(ctx.client, p.branche_id, req.body.priorite, new Date(p.cree_le));
      await ctx.client.query(
        "update problemes set priorite = $2, motif_urgence = case when $2 = 'urgent' then coalesce(motif_urgence, $3) else motif_urgence end, echeance = $4 where id = $1",
        [p.id, req.body.priorite, req.body.motif, echeance],
      );
      await historiser(ctx, p.id, "priorite", { avant: p.priorite, apres: req.body.priorite, motif: req.body.motif });
      await ctx.client.query("select journal_evenement('performance.priorite', $1)", [JSON.stringify({ probleme: p.id, avant: p.priorite, apres: req.body.priorite, motif: req.body.motif })]);
      if (req.body.priorite !== "normal" && req.body.priorite !== p.priorite) await prevenir(ctx.client, { ...p, priorite: req.body.priorite }, `priorite-${p.id}-${req.body.priorite}`);
      return { priorite: req.body.priorite };
    }),
  );
  app.post<{ Params: { id: string }; Body: { texte: string } }>("/problemes/:id/commentaires", {
    schema: { params: paramId, body: { type: "object", required: ["texte"], properties: { texte: texte(3000) } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const p = await probleme(ctx, req.params.id);
      await exigerRole(ctx, p, ["auteur", "gestion"]);
      const { rows: [c] } = await ctx.client.query("insert into commentaires_probleme (organisation_id, probleme_id, auteur_id, texte) values ($1, $2, $3, $4) returning id", [ctx.organisationId, p.id, ctx.utilisateurId, req.body.texte.trim()]);
      const autre = p.auteur_id === ctx.utilisateurId ? (p.pris_en_charge_par ? [p.pris_en_charge_par] : await gestionnaires(ctx.client, p)) : [p.auteur_id];
      await notifier(ctx.client, autre, `commentaire-${c.id}`, "Nouveau commentaire sur un problème.", "info", { type: "probleme", id: p.id });
      return c;
    });
    return reponse.status(201).send(r);
  });

  // ---------- Solutions ----------
  app.post<{ Params: { id: string }; Body: SaisieSolution }>("/problemes/:id/solutions", { schema: { params: paramId, body: schemaSolution } }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const p = await probleme(ctx, req.params.id);
      const ro = await exigerRole(ctx, p, ["auteur", "collegue", "gestion"]);
      if (p.sensible && ro !== "auteur") throw new ErreurApi(403, "cas_sensible");
      if (p.statut === "clos") throw new ErreurApi(409, "probleme_clos");
      const id = await ajouterSolution(ctx, p.id, req.body);
      await notifier(ctx.client, p.pris_en_charge_par ? [p.pris_en_charge_par] : await gestionnaires(ctx.client, p), `solution-${id}`, "Une solution a été proposée.", "info", { type: "probleme", id: p.id });
      return { id };
    });
    return reponse.status(201).send(r);
  });
  /** Décision sur une solution : note de qualité toujours, motif si refus, date si à étudier. Aucune dépense engagée. */
  app.post<{
    Params: { id: string };
    Body: { decision: string; note: number; motif?: string; modifications?: string; dateReexamen?: string; responsableId?: string; echeance?: string };
  }>("/solutions/:id/decision", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["decision", "note"],
        properties: {
          decision: { type: "string", enum: ["acceptee", "acceptee_modifiee", "a_etudier", "refusee"] }, note: { type: "integer", minimum: 1, maximum: 5 },
          motif: texte(1000, 0), modifications: texte(2000, 0), dateReexamen: date, responsableId: uuid, echeance: date,
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [s] } = await ctx.client.query("select * from solutions where id = $1", [req.params.id]);
      if (!s) throw new ErreurApi(404, "introuvable");
      const p = await probleme(ctx, s.probleme_id);
      await exigerRole(ctx, p, ["gestion"]);
      if (s.auteur_id === ctx.utilisateurId) throw new ErreurApi(403, "auto_validation_interdite");
      if (!["en_attente", "a_etudier"].includes(s.decision)) throw new ErreurApi(409, "solution_deja_decidee");
      const b = req.body;
      if (b.decision === "refusee" && !b.motif?.trim()) throw new ErreurApi(400, "motif_refus_obligatoire");
      if (b.decision === "a_etudier" && !b.dateReexamen) throw new ErreurApi(400, "date_reexamen_obligatoire");
      if (b.decision === "acceptee_modifiee" && !b.modifications?.trim()) throw new ErreurApi(400, "modifications_obligatoires");
      await ctx.client.query(
        "update solutions set decision = $2, note = $3, motif = $4, modifications = $5, date_reexamen = $6, decide_par = $7, decide_le = now() where id = $1",
        [s.id, b.decision, b.note, b.motif?.trim() || null, b.modifications?.trim() || null, b.decision === "a_etudier" ? b.dateReexamen : null, ctx.utilisateurId],
      );
      let action = null;
      if (b.decision === "acceptee" || b.decision === "acceptee_modifiee") {
        const responsable = b.responsableId ?? ctx.utilisateurId;
        const { rows: [u] } = await ctx.client.query("select actif from utilisateurs where id = $1", [responsable]);
        if (!u?.actif) throw new ErreurApi(400, "responsable_invalide");
        action = (await ctx.client.query(
          "insert into actions_solution (organisation_id, solution_id, responsable_id, echeance) values ($1, $2, $3, $4) returning id, statut, echeance::text",
          [ctx.organisationId, s.id, responsable, b.echeance ?? decalerJour(jourDouala(), 7)],
        )).rows[0];
        if (responsable !== ctx.utilisateurId) await notifier(ctx.client, [responsable], `action-${action.id}`, "Une action de mise en œuvre vous est confiée.", "info", { type: "probleme", id: p.id });
      }
      await historiser(ctx, p.id, "solution_decidee", { solution: s.id, decision: b.decision, note: b.note, motif: b.motif ?? null });
      await ctx.client.query("select journal_evenement('performance.solution', $1)", [JSON.stringify({ solution: s.id, decision: b.decision, note: b.note, motif: b.motif ?? null })]);
      const mots: Record<string, string> = { acceptee: "acceptée", acceptee_modifiee: "acceptée avec modifications", a_etudier: "mise à l'étude", refusee: "refusée" };
      await notifier(ctx.client, [s.auteur_id], `decision-${s.id}-${b.decision}`, `Votre solution est ${mots[b.decision]} (note ${b.note}/5).`, "info", { type: "probleme", id: p.id });
      // Une solution chiffrée n'engage aucune dépense : achats et trésorerie suivent leurs circuits habituels.
      return { decision: b.decision, action, depense_engagee: false };
    }),
  );
  app.patch<{ Params: { id: string }; Body: { statut?: string; efficace?: boolean } }>("/actions-solution/:id", {
    schema: { params: paramId, body: { type: "object", minProperties: 1, properties: { statut: { type: "string", enum: ["prevue", "en_cours", "realisee"] }, efficace: { type: "boolean" } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [a] } = await ctx.client.query("select a.*, s.probleme_id from actions_solution a join solutions s on s.id = a.solution_id where a.id = $1", [req.params.id]);
      if (!a) throw new ErreurApi(404, "introuvable");
      if (a.responsable_id !== ctx.utilisateurId) await exigerRole(ctx, await probleme(ctx, a.probleme_id), ["gestion"]);
      const statut = req.body.statut ?? a.statut;
      if (req.body.efficace !== undefined && statut !== "realisee") throw new ErreurApi(409, "action_non_realisee");
      await ctx.client.query("update actions_solution set statut = $2, efficace = coalesce($3, efficace), evalue_le = case when $3::boolean is null then evalue_le else now() end where id = $1", [a.id, statut, req.body.efficace ?? null]);
      return { statut, efficace: req.body.efficace ?? a.efficace };
    }),
  );

  // ---------- Pièces jointes ----------
  const objetAutorise = async (ctx: Contexte, type: string, id: string, ecriture: boolean) => {
    if (type === "rapport") {
      const { rows: [r] } = await ctx.client.query("select r.*, e.utilisateur_id, e.entite_id, e.id as emp from rapports_jour r join employes e on e.id = r.employe_id where r.id = $1", [id]);
      if (!r) throw new ErreurApi(404, "introuvable");
      if (r.utilisateur_id === ctx.utilisateurId) { if (ecriture && r.statut === "remis") throw new ErreurApi(409, "rapport_fige"); return; }
      if (ecriture || !await peutGerer(ctx, r.entite_id)) throw new ErreurApi(404, "introuvable");
      return;
    }
    const sql = type === "probleme" ? "select $1::uuid as pid, auteur_id from problemes where id = $1"
      : type === "commentaire" ? "select probleme_id as pid, auteur_id from commentaires_probleme where id = $1" : "select probleme_id as pid, auteur_id from solutions where id = $1";
    const { rows: [o] } = await ctx.client.query(sql, [id]);
    if (!o) throw new ErreurApi(404, "introuvable");
    const r = await role(ctx, await probleme(ctx, o.pid));
    if (!r || (ecriture && o.auteur_id !== ctx.utilisateurId)) throw new ErreurApi(404, "introuvable");
  };
  app.put<{ Querystring: { objet: string; id: string; nom: string } }>("/performance/pieces", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    schema: { querystring: { type: "object", required: ["objet", "id", "nom"], properties: { objet: { type: "string", enum: ["rapport", "probleme", "commentaire", "solution"] }, id: uuid, nom: texte(200) } } },
  }, async (req, reponse) => {
    await protege(req, (ctx) => objetAutorise(ctx, req.query.objet, req.query.id, true));
    const s = await stockerFichier(req, dossier, 10 * 1024 ** 2);
    try {
      const d = await protege(req, async (ctx) => {
        await objetAutorise(ctx, req.query.objet, req.query.id, true);
        return (await ctx.client.query(
          "insert into pieces_performance (organisation_id, objet_type, objet_id, nom, fichier, type_mime, taille, empreinte, auteur_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id, nom, taille",
          [ctx.organisationId, req.query.objet, req.query.id, req.query.nom.replace(/[-_]+/g, " ").trim(), s.fichier, s.type_mime, s.taille, s.empreinte, ctx.utilisateurId],
        )).rows[0];
      });
      return reponse.status(201).send(d);
    } catch (e) {
      await rm(join(dossier!, s.fichier), { force: true });
      throw e;
    }
  });
  app.get<{ Params: { id: string } }>("/performance/pieces/:id", { schema: { params: paramId } }, async (req, reponse) => {
    const d = await protege(req, async (ctx) => {
      const { rows: [x] } = await ctx.client.query("select * from pieces_performance where id = $1", [req.params.id]);
      if (!x) throw new ErreurApi(404, "introuvable");
      await objetAutorise(ctx, x.objet_type, x.objet_id, false);
      return x;
    });
    if (!dossier) throw new ErreurApi(503, "medias_non_configures");
    return reponse.header("content-type", d.type_mime).header("content-length", d.taille).header("x-content-type-options", "nosniff")
      .header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(d.nom)}`).send(createReadStream(join(dossier, d.fichier)));
  });

  // ---------- Messages personnels ----------
  app.get("/moi/messages", async (req) =>
    protege(req, async (ctx) => (await ctx.client.query(
      "select id, niveau, texte, objet_type, objet_id, lu_le, cree_le from notifications_personnes where utilisateur_id = $1 order by lu_le is not null, cree_le desc limit 100", [ctx.utilisateurId],
    )).rows),
  );
  app.post("/moi/messages/lus", async (req) =>
    protege(req, async (ctx) => {
      await ctx.client.query("update notifications_personnes set lu_le = now() where utilisateur_id = $1 and lu_le is null", [ctx.utilisateurId]);
      return { lus: true };
    }),
  );

  // ---------- Vue direction par branche ----------
  app.get<{ Params: { id: string }; Querystring: { du: string; au: string } }>("/performance/direction/:id", {
    schema: { params: paramId, querystring: { type: "object", required: ["du", "au"], properties: { du: date, au: date } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const b = req.params.id;
      if (await brancheDe(ctx.client, b) !== b) throw new ErreurApi(400, "branche_attendue");
      const autorise = (await directionDe(ctx.client, b)).includes(ctx.utilisateurId) || (await superAdmins(ctx.client)).includes(ctx.utilisateurId)
        || await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "rh.evaluer", b);
      if (!autorise) throw new ErreurApi(403, "permission_refusee");
      const { du, au } = req.query;
      const dans = "coalesce(entite_branche(p.entite_id), p.entite_id) = $1 and (p.cree_le at time zone 'Africa/Douala')::date between $2 and $3";
      const a = [b, du, au];
      const [scores, categories, delaisMoyens, sols] = await enchainer([
        () => ctx.client.query(
          `select e.nom, e.poste, round(avg(s.score))::int as score, count(*)::int as jours from scores_jour s join employes e on e.id = s.employe_id
           where coalesce(entite_branche(e.entite_id), e.entite_id) = $1 and s.jour between $2 and $3 group by e.id, e.nom, e.poste order by 3 desc nulls last`, a),
        () => // Les cas sensibles sont seulement comptés, () => jamais détaillés ici.
        ctx.client.query(`select case when p.sensible then 'sensible' else p.categorie end as categorie, count(*)::int as nombre from problemes p where ${dans} group by 1 order by 2 desc`, a),
        () => ctx.client.query(
          `select round(avg(extract(epoch from p.pris_en_charge_le - p.cree_le) / 3600)::numeric, 1)::float as prise_en_charge_h,
             round(avg(extract(epoch from p.resolu_le - p.cree_le) / 3600)::numeric, 1)::float as resolution_h,
             count(*) filter (where p.priorite = 'urgent' and (coalesce(p.pris_en_charge_le, now()) > p.echeance))::int as urgences_hors_delai,
             count(*) filter (where p.priorite = 'urgent' and p.statut not in ('resolu', 'clos'))::int as urgences_ouvertes
           from problemes p where ${dans}`, a),
        () => ctx.client.query(
          `select count(*)::int as proposees, count(*) filter (where s.decision in ('acceptee', 'acceptee_modifiee'))::int as acceptees,
             count(*) filter (where s.decision <> 'en_attente')::int as decidees,
             (select count(*) from actions_solution x join solutions y on y.id = x.solution_id join problemes p on p.id = y.probleme_id where ${dans} and x.statut = 'realisee')::int as actions_realisees
           from solutions s join problemes p on p.id = s.probleme_id where ${dans}`, a)]);
      const s = sols.rows[0];
      return { scores: scores.rows, categories: categories.rows, delais: delaisMoyens.rows[0], solutions: { ...s, taux_acceptation: s.decidees ? Math.round((s.acceptees * 100) / s.decidees) : null } };
    }),
  );

  // ---------- Tâches planifiées ----------
  taches.push((org) => dansOrganisation(pool, org, (c) => journeePerformance(c, new Date())));
}

/** Toutes les heures : objectifs du matin, rappels, relances, escalades, réexamens et résumé hebdomadaire. Chaque envoi n'a lieu qu'une fois. */
export async function journeePerformance(c: Client, maintenant: Date): Promise<void> {
  const jour = jourDouala(maintenant), h = heureDouala(maintenant);
  const ouvre = estOuvre(jour);
  if (ouvre && h >= 6) await preparerJournee(c, jour);
  const presents = async () => (await c.query(
    `select e.id, e.entite_id, e.poste, e.nom, e.utilisateur_id, e.responsable_id,
       exists (select 1 from rapports_jour r where r.employe_id = e.id and r.jour = $1 and r.statut = 'remis') as remis
     from employes e where e.utilisateur_id is not null and exists (select 1 from objectifs_jour o where o.employe_id = e.id and o.jour = $1)
       and not exists (select 1 from conges g where g.employe_id = e.id and g.statut = 'approuve' and $1::date between g.debut and g.fin)`, [jour],
  )).rows;
  if (ouvre && h >= 7) for (const e of await presents()) await notifier(c, [e.utilisateur_id], `objectifs-${jour}`, "Vos objectifs du jour sont prêts.", "info");
  if (ouvre && h >= 17) for (const e of (await presents()).filter((x) => !x.remis)) await notifier(c, [e.utilisateur_id], `rapport-${jour}`, "Pensez à remettre votre rapport du jour.", "info");
  if (ouvre && h >= 20) for (const e of (await presents()).filter((x) => !x.remis)) await notifier(c, [e.utilisateur_id], `relance-${jour}`, "Votre rapport du jour manque encore.", "important");
  // Deux jours ouvrés avec des objectifs et sans rapport : le responsable est prévenu.
  if (ouvre && h >= 8) {
    const [j1, j2] = joursOuvresAvant(jour, 2);
    const { rows } = await c.query(
      `select e.id, e.entite_id, e.poste, e.nom, e.utilisateur_id, e.responsable_id from employes e where e.utilisateur_id is not null
         and (select count(distinct o.jour) from objectifs_jour o where o.employe_id = e.id and o.jour in ($1, $2)) = 2
         and not exists (select 1 from rapports_jour r where r.employe_id = e.id and r.jour in ($1, $2) and r.statut = 'remis')
         and not exists (select 1 from conges g where g.employe_id = e.id and g.statut = 'approuve' and (g.debut, g.fin + 1) overlaps ($2::date, $1::date + 1))`, [j1, j2],
    );
    for (const e of rows) await notifier(c, await responsablesDe(c, e), `sans-rapport-${e.id}-${jour}`, `${e.nom} n'a pas remis de rapport depuis 2 jours ouvrés.`, "important");
  }
  await escalader(c, maintenant);
  const { rows: aEtudier } = await c.query("select id, decide_par, date_reexamen::text from solutions where decision = 'a_etudier' and date_reexamen <= $1", [jour]);
  for (const s of aEtudier) if (s.decide_par) await notifier(c, [s.decide_par], `reexamen-${s.id}-${s.date_reexamen}`, "Une solution « à étudier » attend votre réexamen.", "important", { type: "solution", id: s.id });
  // Le lundi : résumé de la semaine écoulée pour chaque responsable.
  if (new Date(`${jour}T00:00:00Z`).getUTCDay() === 1 && h >= 8) {
    const du = decalerJour(jour, -7), au = decalerJour(jour, -1);
    const { rows: employes } = await c.query(
      `select e.id, e.entite_id, e.poste, e.nom, e.utilisateur_id, e.responsable_id,
         (select count(*) from rapports_jour r where r.employe_id = e.id and r.version = 1 and r.statut = 'remis' and r.jour between $1 and $2)::int as rapports,
         (select count(distinct o.jour) from objectifs_jour o where o.employe_id = e.id and o.jour between $1 and $2)::int as attendus,
         (select round(avg(s.score)) from scores_jour s where s.employe_id = e.id and s.jour between $1 and $2)::int as score,
         (select count(*) from problemes p where p.employe_id = e.id and not p.sensible and p.statut not in ('resolu', 'clos'))::int as ouverts
       from employes e where e.utilisateur_id is not null and (e.date_sortie is null or e.date_sortie >= $2)`, [du, au],
    );
    const parResponsable = new Map<string, string[]>();
    for (const e of employes) {
      if (!e.attendus) continue;
      for (const r of await responsablesDe(c, e)) parResponsable.set(r, [...parResponsable.get(r) ?? [], `${e.nom} : ${e.rapports}/${e.attendus} rapports, score moyen ${e.score ?? "–"}, ${e.ouverts} problème(s) ouvert(s)`]);
    }
    for (const [r, lignes] of parResponsable) await notifier(c, [r], `hebdo-${jour}`, `Résumé de la semaine du ${du} au ${au}. ${lignes.join(" · ")}`, "info");
  }
}

/** Délai de prise en charge dépassé : on monte d'un niveau, puis jusqu'au super administrateur. */
export async function escalader(c: Client, maintenant: Date): Promise<number> {
  const { rows } = await c.query(
    `select p.*, e.nom as employe, e.responsable_id, e.poste, e.utilisateur_id as employe_utilisateur, coalesce(entite_branche(p.entite_id), p.entite_id) as branche_id
     from problemes p join employes e on e.id = p.employe_id where p.statut = 'signale' and p.echeance < $1 and p.niveau_escalade < 2`, [maintenant],
  );
  for (const p of rows) {
    const niveau = p.niveau_escalade + 1;
    const sauf = [p.auteur_id, ...(p.sensible ? [p.responsable_concerne] : [])];
    const e = { id: p.employe_id, entite_id: p.entite_id, poste: p.poste, nom: p.employe, utilisateur_id: p.employe_utilisateur, responsable_id: p.responsable_id };
    let cibles = niveau === 1 ? (p.sensible ? await directionDe(c, p.branche_id) : await niveauSuperieur(c, e)) : await superAdmins(c);
    cibles = unique(cibles, sauf);
    if (!cibles.length) cibles = unique(await superAdmins(c), sauf);
    const { rows: [d] } = await c.query("select normal_h, important_h, urgent_h from delais_problemes where branche_id = $1", [p.branche_id]);
    const h = (d ?? DELAIS_DEFAUT)[p.priorite === "urgent" ? "urgent_h" : p.priorite === "important" ? "important_h" : "normal_h"];
    await c.query("update problemes set niveau_escalade = $2, escalade_le = $3, echeance = $4 where id = $1", [p.id, niveau, maintenant, new Date(maintenant.getTime() + h * 3600_000)]);
    await c.query("insert into historique_probleme (organisation_id, probleme_id, action, details) values (org_courante(), $1, 'escalade', $2)", [p.id, JSON.stringify({ niveau, destinataires: cibles.length })]);
    await notifier(c, cibles, `escalade-${p.id}-${niveau}`, `Problème non pris en charge dans le délai (${p.priorite}) : ${p.employe}.`, p.priorite === "urgent" ? "urgent" : "important", { type: "probleme", id: p.id });
  }
  return rows.length;
}
