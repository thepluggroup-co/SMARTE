import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { dansOrganisation, type Client } from "./base.js";
import { KPI } from "./commerce.js";
import { DROIT_VOIR } from "./documents.js";
import { aPermissionGlobale, aPermissionSurEntite, entitesAccessibles } from "./permissions.js";
import { CATEGORIES_PROBLEME, crochetsPerformance, DESTINATAIRES_PROBLEME, decalerJour, heureDouala, jourDouala, notifier, responsablesDe, titulaires } from "./performance.js";
import { avancement } from "./pilotage.js";
import { ErreurApi, type Contexte, type Outils, type TachePlanifiee } from "./serveur.js";

/*
 * OKR : objectifs et résultats clés par trimestre, de la branche à l'équipe et à la personne,
 * reliés aux objectifs du jour. GTA et GLOMARI ne se mélangent jamais : un objectif s'aligne
 * seulement sur un parent de sa branche, et chaque droit se vérifie sur l'entité de l'objectif.
 */

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max: number, min = 1) => ({ type: "string", minLength: min, maxLength: max }) as const;
const PERIODE = { type: "string", pattern: "^[0-9]{4}-T[1-4]$" } as const;
export const MAX_PAR_NIVEAU = 5;
/** Un OKR ambitieux noté 0,6 ou plus est réussi ; un OKR engagé doit être tenu entièrement. */
export const SEUIL_AMBITIEUX = 0.6;

// ---------- Calendrier des trimestres ----------
export const periodeDe = (jour: string) => `${jour.slice(0, 4)}-T${Math.ceil(Number(jour.slice(5, 7)) / 3)}`;
export function bornes(periode: string): { debut: string; fin: string } {
  const [a, t] = periode.split("-T").map(Number) as [number, number];
  const m = (t - 1) * 3;
  return { debut: new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10), fin: new Date(Date.UTC(a, m + 3, 0)).toISOString().slice(0, 10) };
}
export const periodeSuivante = (p: string) => { const [a, t] = p.split("-T").map(Number) as [number, number]; return t === 4 ? `${a + 1}-T1` : `${a}-T${t + 1}`; };
export const periodePrecedente = (p: string) => { const [a, t] = p.split("-T").map(Number) as [number, number]; return t === 1 ? `${a - 1}-T4` : `${a}-T${t - 1}`; };
const jours = (du: string, au: string) => Math.round((Date.parse(au) - Date.parse(du)) / 86_400_000);
/** Part du trimestre écoulée à ce jour, entre 0 et 1. */
export function ecoule(periode: string, jour: string): number {
  const { debut, fin } = bornes(periode);
  return Math.min(Math.max((jours(debut, jour) + 1) / (jours(debut, fin) + 1), 0), 1);
}
export const lundi = (jour: string) => decalerJour(jour, -((new Date(`${jour}T00:00:00Z`).getUTCDay() + 6) % 7));

// ---------- Règles ----------
/**
 * Feu de couleur : l'avancement comparé au temps écoulé du trimestre. Un OKR ambitieux vise 70 %,
 * on l'attend donc à 70 % du rythme. Vert : 10 points de retard au plus ; orange : 25 ; rouge au-delà.
 */
export function feu(avance: number, part: number, type: string): "vert" | "orange" | "rouge" {
  const attendu = part * 100 * (type === "ambitieux" ? 0.7 : 1);
  const retard = attendu - avance;
  return retard <= 10 ? "vert" : retard <= 25 ? "orange" : "rouge";
}
export const reussi = (type: string, note: number | null) => note === null ? null : type === "ambitieux" ? note >= SEUIL_AMBITIEUX : note >= 1;
/** Confiance en baisse deux semaines de suite : les trois derniers points descendent. */
export function confianceEnBaisse(points: { semaine: string; confiance: number }[]): boolean {
  const d = [...points].sort((a, b) => a.semaine.localeCompare(b.semaine)).slice(-3);
  return d.length === 3 && d[1]!.confiance < d[0]!.confiance && d[2]!.confiance < d[1]!.confiance;
}

type Objectif = Record<string, any> & { id: string; entite_id: string; branche_id: string; niveau: string; type: string; statut: string; periode: string; proprietaire_id: string | null };

const brancheDe = async (c: Client, entiteId: string): Promise<string> => (await c.query("select coalesce(entite_branche($1), $1) as b", [entiteId])).rows[0].b;
const domaineDe = async (c: Client, entiteId: string): Promise<string> =>
  (await c.query("select domaine from entites where id = coalesce(entite_branche($1), $1)", [entiteId])).rows[0]?.domaine ?? "general";
/** L'entité et tout ce qu'elle contient : magasins, dépôts, centres. */
const sousEntites = async (c: Client, entiteId: string): Promise<string[]> =>
  (await c.query("with recursive d as (select id from entites where id = $1 union select e.id from entites e join d on e.parent_id = d.id) select id from d", [entiteId])).rows.map((r) => String(r.id));

/** Valeur d'une mesure d'entité sur une période (dates incluses). Null : rien à mesurer. */
export async function mesureEntite(c: Client, code: string, entiteId: string, debut: string, fin: string): Promise<number | null> {
  const k = KPI[code];
  if (!k?.entite) return null;
  const { rows: [r] } = await c.query(k.entite, [await sousEntites(c, entiteId), debut, fin]);
  return r.v === null ? null : Number(r.v);
}

/** Mesures d'entité utilisables par un résultat clé de cette branche : GTA ne voit pas les ventes, GLOMARI pas les inscriptions. */
export const mesuresPour = (domaine: string) =>
  Object.entries(KPI).filter(([, k]) => k.entite && (!k.domaine || k.domaine === domaine))
    .map(([code, k]) => ({ code, libelle: k.libelle, sens: k.sens }));

/** Valeur d'un résultat clé automatique, sur son entité, du début du trimestre à aujourd'hui (ou à la fin du trimestre). */
async function mesurer(c: Client, r: { kpi: string; entite_id: string; periode: string }, jour: string) {
  const { debut, fin } = bornes(r.periode);
  if (jour < debut) return null;
  return mesureEntite(c, r.kpi, r.entite_id, debut, jour < fin ? jour : fin);
}

/** Chaque nuit : les résultats clés automatiques prennent la valeur mesurée. Une fois par jour, historique à chaque changement. */
export async function mettreAJourMesures(c: Client, jour: string): Promise<number> {
  const { rows } = await c.query(
    `select r.id, r.kpi, r.actuel::float, o.entite_id, o.periode from resultats_cles r join objectifs o on o.id = r.objectif_id
     where r.mode = 'auto' and o.statut = 'actif' and (r.mesure_le is null or r.mesure_le < $1)`, [jour],
  );
  let n = 0;
  for (const r of rows) {
    // Une mesure en erreur n'empêche pas les autres : elle sera retentée l'heure suivante.
    await c.query("savepoint mesure_okr");
    try {
      const v = await mesurer(c, r, jour);
      if (v !== null && v !== r.actuel) {
        await c.query("update resultats_cles set actuel = $2, maj_le = now() where id = $1", [r.id, v]);
        await c.query("insert into valeurs_resultat (organisation_id, resultat_id, valeur, source) values (org_courante(), $1, $2, 'auto')", [r.id, v]);
        n++;
      }
      await c.query("update resultats_cles set mesure_le = $2 where id = $1", [r.id, jour]);
      await c.query("release savepoint mesure_okr");
    } catch {
      await c.query("rollback to savepoint mesure_okr");
    }
  }
  return n;
}

/** Responsable direct du propriétaire, sinon ceux qui pilotent l'entité de l'objectif. */
async function responsablesDuProprietaire(c: Client, utilisateurId: string, entiteId: string): Promise<string[]> {
  const { rows: [e] } = await c.query("select id, entite_id, poste, nom, utilisateur_id, responsable_id from employes where utilisateur_id = $1", [utilisateurId]);
  const r = e ? await responsablesDe(c, e) : await titulaires(c, ["pilotage.gerer"], entiteId);
  return r.filter((x) => x !== utilisateurId);
}

/** Toutes les heures : mesures de la nuit, rappel du lundi, alertes de retard et de confiance, rappel de notation. */
export async function journeeOkr(c: Client, maintenant: Date): Promise<void> {
  const jour = jourDouala(maintenant), h = heureDouala(maintenant);
  if (h >= 2) await mettreAJourMesures(c, jour);
  const periode = periodeDe(jour);
  if (new Date(`${jour}T00:00:00Z`).getUTCDay() === 1 && h >= 8) {
    const semaine = jour;
    const { rows } = await c.query(
      `select r.id, r.libelle, r.proprietaire_id, r.depart::float, r.cible::float, r.actuel::float, o.id as objectif_id, o.titre, o.type, o.entite_id, o.proprietaire_id as proprietaire_objectif,
         exists (select 1 from points_okr p where p.resultat_id = r.id and p.semaine = $2) as fait,
         coalesce((select json_agg(json_build_object('semaine', p.semaine::text, 'confiance', p.confiance)) from points_okr p where p.resultat_id = r.id), '[]') as points
       from resultats_cles r join objectifs o on o.id = r.objectif_id where o.statut = 'actif' and o.periode = $1`, [periode, semaine],
    );
    const aFaire = new Map<string, number>();
    for (const r of rows) if (r.proprietaire_id && !r.fait) aFaire.set(r.proprietaire_id, (aFaire.get(r.proprietaire_id) ?? 0) + 1);
    for (const [u, n] of aFaire) await notifier(c, [u], `okr-rappel-${semaine}`, `Point hebdomadaire OKR : ${n} résultat(s) clé(s) à faire le point cette semaine (valeur, confiance, blocages).`, "info");
    const part = ecoule(periode, jour);
    for (const r of rows) {
      const proprios = [r.proprietaire_id, r.proprietaire_objectif].filter(Boolean);
      if (feu(avancement(r.depart, r.cible, r.actuel), part, r.type) === "rouge") {
        await notifier(c, proprios, `okr-retard-${r.id}-${semaine}`, `Résultat clé en retard sur le trimestre (feu rouge) : ${r.libelle} (${r.titre}).`, "important", { type: "okr", id: r.objectif_id });
      }
      if (confianceEnBaisse(r.points)) {
        const resp = r.proprietaire_id ? await responsablesDuProprietaire(c, r.proprietaire_id, r.entite_id) : [];
        await notifier(c, [...proprios, ...resp], `okr-confiance-${r.id}-${semaine}`, `Confiance en baisse deux semaines de suite : ${r.libelle} (${r.titre}).`, "important", { type: "okr", id: r.objectif_id });
      }
    }
  }
  // Les quinze premiers jours d'un trimestre : les objectifs du trimestre passé attendent leur note et leur bilan.
  if (jours(bornes(periode).debut, jour) < 15) {
    const { rows } = await c.query("select id, titre, proprietaire_id from objectifs where statut = 'actif' and periode = $1 and proprietaire_id is not null", [periodePrecedente(periode)]);
    for (const o of rows) await notifier(c, [o.proprietaire_id], `okr-notation-${o.id}`, `Trimestre terminé : notez les résultats clés et faites le bilan de « ${o.titre} ».`, "important", { type: "okr", id: o.id });
  }
}

export function enregistrerOkr(app: FastifyInstance, pool: pg.Pool, outils: Outils, taches: TachePlanifiee[]): void {
  const { protege, exigerSurEntite } = outils;

  const charger = async (c: Client, id: string): Promise<Objectif> => {
    const { rows: [o] } = await c.query("select o.*, coalesce(entite_branche(o.entite_id), o.entite_id) as branche_id from objectifs o where o.id = $1", [id]);
    if (!o) throw new ErreurApi(404, "introuvable");
    return o;
  };
  const chargerResultat = async (c: Client, id: string) => {
    const { rows: [r] } = await c.query("select r.*, r.depart::float, r.cible::float, r.actuel::float, r.note::float from resultats_cles r where r.id = $1", [id]);
    if (!r) throw new ErreurApi(404, "introuvable");
    return { r, o: await charger(c, r.objectif_id) };
  };
  /** Le responsable direct d'une personne (fiche employé). */
  const estResponsableDe = async (c: Client, moi: string, utilisateurId: string | null) => {
    if (!utilisateurId) return false;
    const { rows: [x] } = await c.query(
      "select 1 from employes e join employes r on r.id = e.responsable_id where e.utilisateur_id = $1 and r.utilisateur_id = $2", [utilisateurId, moi],
    );
    return !!x;
  };
  /** Piloter l'objectif : pilotage.gerer sur son entité ; pour un OKR individuel, aussi le responsable direct. */
  const peutGerer = async (ctx: Contexte, o: Objectif) =>
    await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "pilotage.gerer", o.entite_id)
    || (o.niveau === "individuel" && await estResponsableDe(ctx.client, ctx.utilisateurId, o.proprietaire_id));
  const gerer = async (ctx: Contexte, o: Objectif) => { if (!await peutGerer(ctx, o)) throw new ErreurApi(403, "permission_refusee"); };
  /** Voir l'objectif : pilotage.voir sur son entité, ou y être propriétaire d'un objectif, d'un résultat clé ou d'une initiative. */
  const peutVoir = async (ctx: Contexte, o: Objectif) => {
    if (o.proprietaire_id === ctx.utilisateurId || await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "pilotage.voir", o.entite_id) || await peutGerer(ctx, o)) return true;
    const { rows: [x] } = await ctx.client.query(
      `select 1 from resultats_cles r left join initiatives i on i.resultat_id = r.id where r.objectif_id = $1 and (r.proprietaire_id = $2 or i.proprietaire_id = $2) limit 1`, [o.id, ctx.utilisateurId],
    );
    return !!x;
  };
  const voir = async (ctx: Contexte, o: Objectif) => { if (!await peutVoir(ctx, o)) throw new ErreurApi(404, "introuvable"); };
  /** Le propriétaire travaille dans la branche : par sa fiche employé ou par un rôle qui couvre l'entité. */
  const exigerProprietaire = async (c: Client, utilisateurId: string | undefined | null, entiteId: string) => {
    if (!utilisateurId) return;
    const { rows: [u] } = await c.query(
      `with recursive anc as (select id, parent_id from entites where id = $2 union all select e.id, e.parent_id from entites e join anc on e.id = anc.parent_id)
       select 1 from utilisateurs u where u.id = $1 and u.actif and (
         exists (select 1 from employes e where e.utilisateur_id = u.id and coalesce(entite_branche(e.entite_id), e.entite_id) = coalesce(entite_branche($2), $2))
         or exists (select 1 from attributions a where a.utilisateur_id = u.id and (a.expire_le is null or a.expire_le > now()) and (a.entite_id is null or a.entite_id in (select id from anc)
              or coalesce(entite_branche(a.entite_id), a.entite_id) = coalesce(entite_branche($2), $2))))`,
      [utilisateurId, entiteId],
    );
    if (!u) throw new ErreurApi(400, "proprietaire_invalide");
  };
  type SaisieResultat = { libelle: string; unite?: string; depart?: number; cible: number; proprietaireId?: string; kpi?: string };
  const schemaResultat = {
    type: "object", required: ["libelle", "cible"],
    properties: { libelle: texte(300), unite: texte(30), depart: { type: "number" }, cible: { type: "number" }, proprietaireId: uuid, kpi: { type: "string", maxLength: 60 } },
  } as const;
  const controlerResultat = async (c: Client, r: SaisieResultat, entiteId: string) => {
    if (r.cible === (r.depart ?? 0)) throw new ErreurApi(400, "donnees_invalides");
    if (r.kpi && !mesuresPour(await domaineDe(c, entiteId)).some((m) => m.code === r.kpi)) throw new ErreurApi(400, "mesure_invalide");
    await exigerProprietaire(c, r.proprietaireId, entiteId);
  };
  const ajouterResultat = async (ctx: Contexte, objectifId: string, r: SaisieResultat, defautProprio: string | null) => {
    const { rows: [x] } = await ctx.client.query(
      `insert into resultats_cles (organisation_id, objectif_id, libelle, unite, depart, cible, actuel, proprietaire_id, mode, kpi, maj_le)
       values ($1, $2, $3, $4, $5, $6, $5, $7, $8, $9, now()) returning id`,
      [ctx.organisationId, objectifId, r.libelle.trim(), r.unite?.trim() || null, r.depart ?? 0, r.cible, r.proprietaireId ?? defautProprio, r.kpi ? "auto" : "manuel", r.kpi ?? null],
    );
    await ctx.client.query("insert into valeurs_resultat (organisation_id, resultat_id, valeur, source, auteur_id) values ($1, $2, $3, 'creation', $4)", [ctx.organisationId, x.id, r.depart ?? 0, ctx.utilisateurId]);
    return x.id as string;
  };
  /** Plus de 5 objectifs au même niveau, ou plus de 5 résultats clés : on prévient, sans bloquer. */
  const alertes = async (c: Client, o: Objectif) => {
    const { rows: [n] } = await c.query(
      `select (select count(*) from objectifs x where x.entite_id = $1 and x.periode = $2 and x.niveau = $3 and x.statut not in ('abandonne')
                and ($3 <> 'individuel' or x.proprietaire_id is not distinct from $4))::int as objectifs,
              (select count(*) from resultats_cles where objectif_id = $5)::int as resultats`,
      [o.entite_id, o.periode, o.niveau, o.proprietaire_id, o.id],
    );
    return [
      ...(n.objectifs > MAX_PAR_NIVEAU ? [{ code: "plus_de_5_objectifs", nombre: n.objectifs }] : []),
      ...(n.resultats > MAX_PAR_NIVEAU ? [{ code: "plus_de_5_resultats", nombre: n.resultats }] : []),
    ];
  };
  /**
   * Le parent est de la même branche, ou au niveau du groupe (au-dessus de GTA et de GLOMARI, sans les mélanger).
   * On s'aligne sur un objectif qu'on voit, ou sur un objectif d'une entité au-dessus de la sienne.
   */
  const controlerParent = async (ctx: Contexte, parentId: string | null | undefined, entiteId: string, periode: string, soi?: string) => {
    const c = ctx.client;
    if (!parentId) return;
    if (parentId === soi) throw new ErreurApi(400, "parent_invalide");
    const { rows: [p] } = await c.query(
      `with recursive anc as (select id, parent_id from entites where id = $2 union all select e.id, e.parent_id from entites e join anc on e.id = anc.parent_id)
       select o.periode, o.entite_id, coalesce(entite_branche(o.entite_id), o.entite_id) as b, x.parent_id is null as groupe, o.entite_id in (select id from anc) as au_dessus
       from objectifs o join entites x on x.id = o.entite_id where o.id = $1`, [parentId, entiteId],
    );
    if (!p || !(p.au_dessus || await aPermissionSurEntite(c, ctx.utilisateurId, "pilotage.voir", p.entite_id))) throw new ErreurApi(404, "introuvable");
    if (!p.groupe && p.b !== await brancheDe(c, entiteId)) throw new ErreurApi(409, "parent_autre_branche");
    if (p.periode !== periode) throw new ErreurApi(409, "parent_autre_periode");
    if (soi) {
      // Pas de boucle : le parent ne descend pas de cet objectif.
      const { rows: [boucle] } = await c.query("with recursive a as (select id, parent_id from objectifs where id = $1 union all select o.id, o.parent_id from objectifs o join a on o.id = a.parent_id) select 1 from a where id = $2", [parentId, soi]);
      if (boucle) throw new ErreurApi(409, "parent_invalide");
    }
  };

  /** Détail calculé d'un objectif et de ses résultats clés, au jour donné. */
  const enrichir = async (c: Client, objectifs: Record<string, any>[], jour: string): Promise<Record<string, any>[]> => {
    if (!objectifs.length) return [];
    const ids = objectifs.map((o) => o.id);
    const { rows: krs } = await c.query(
      `select r.id, r.objectif_id, r.libelle, r.unite, r.depart::float, r.cible::float, r.actuel::float, r.mode, r.kpi, r.confiance, r.note::float, r.commentaire_note, r.maj_le, r.proprietaire_id, u.nom as proprietaire,
         coalesce((select json_agg(json_build_object('semaine', p.semaine::text, 'confiance', p.confiance, 'blocages', p.blocages, 'prochaine_action', p.prochaine_action) order by p.semaine) from points_okr p where p.resultat_id = r.id), '[]') as points,
         (select count(*) from initiatives i where i.resultat_id = r.id and i.statut not in ('terminee', 'abandonnee'))::int as initiatives_ouvertes,
         (select count(*) from initiatives i where i.resultat_id = r.id and i.statut not in ('terminee', 'abandonnee') and i.echeance < $2)::int as initiatives_en_retard
       from resultats_cles r left join utilisateurs u on u.id = r.proprietaire_id where r.objectif_id = any($1::uuid[]) order by r.cree_le, r.id`, [ids, jour],
    );
    return objectifs.map((o) => {
      const part = ecoule(o.periode, jour);
      const resultats = krs.filter((r) => r.objectif_id === o.id).map((r) => {
        const av = avancement(r.depart, r.cible, r.actuel);
        const dernier = r.points.at(-1) ?? null;
        return {
          ...r, kpi_libelle: r.kpi ? KPI[r.kpi]?.libelle ?? r.kpi : null, avancement: av, feu: feu(av, part, o.type),
          point_semaine: dernier?.semaine === lundi(jour), dernier_point: dernier, confiance_en_baisse: confianceEnBaisse(r.points), points: r.points.slice(-6),
          reussi: reussi(o.type, r.note),
        };
      });
      const av = resultats.length ? Math.round(resultats.reduce((s, r) => s + r.avancement, 0) / resultats.length) : 0;
      const notes = resultats.filter((r) => r.note !== null);
      const note = notes.length === resultats.length && resultats.length ? Math.round((notes.reduce((s, r) => s + r.note, 0) / notes.length) * 100) / 100 : null;
      return {
        ...o, ancien_responsable: o.responsable ?? null, resultats, avancement: av, ecoule: Math.round(part * 100),
        feu: o.statut === "clos" && note !== null ? (reussi(o.type, note) ? "vert" : note >= 0.4 ? "orange" : "rouge") : feu(av, part, o.type),
        note, reussi: reussi(o.type, note),
      };
    });
  };
  const SELECT_OBJECTIF = `select o.id, o.entite_id, e.nom as entite, coalesce(entite_branche(o.entite_id), o.entite_id) as branche_id, o.parent_id, o.titre, o.description, o.periode, o.niveau, o.type, o.statut, o.motif_statut,
      o.responsable, o.proprietaire_id, u.nom as proprietaire, o.origine_id, o.cree_le, o.clos_le,
      (select x.id from objectifs x where x.origine_id = o.id) as reconduit_en
    from objectifs o join entites e on e.id = o.entite_id left join utilisateurs u on u.id = o.proprietaire_id`;

  // ---------- Vision ----------
  app.get("/okr/vision", async (req) =>
    protege(req, async (ctx) => (await ctx.client.query("select v.texte, v.cree_le, u.nom as auteur from visions v join utilisateurs u on u.id = v.auteur_id order by v.cree_le desc limit 1")).rows[0] ?? null),
  );
  app.post<{ Body: { texte: string } }>("/okr/vision", { schema: { body: { type: "object", required: ["texte"], properties: { texte: texte(3000, 3) } } } }, async (req, reponse) => {
    const v = await protege(req, async (ctx) => {
      // La vision du groupe appartient au super administrateur (pilotage accordé sur toute l'organisation).
      if (!await aPermissionGlobale(ctx.client, ctx.utilisateurId, "pilotage.gerer")) throw new ErreurApi(403, "permission_refusee");
      return (await ctx.client.query("insert into visions (organisation_id, texte, auteur_id) values ($1, $2, $3) returning texte, cree_le", [ctx.organisationId, req.body.texte.trim(), ctx.utilisateurId])).rows[0];
    });
    return reponse.status(201).send(v);
  });

  // ---------- Arbre des OKR ----------
  app.get<{ Querystring: { periode?: string; brancheId?: string } }>("/okr", {
    schema: { querystring: { type: "object", properties: { periode: PERIODE, brancheId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const jour = jourDouala();
      const periode = req.query.periode ?? periodeDe(jour);
      const acces = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "pilotage.voir")).map((e) => String(e.id));
      if (!acces.length) throw new ErreurApi(403, "permission_refusee");
      const { rows } = await ctx.client.query(
        `${SELECT_OBJECTIF} where o.entite_id = any($1::uuid[]) and o.periode = $2 and ($3::uuid is null or coalesce(entite_branche(o.entite_id), o.entite_id) = $3)
         order by case o.niveau when 'branche' then 0 when 'equipe' then 1 else 2 end, o.cree_le limit 500`,
        [acces, periode, req.query.brancheId ?? null],
      );
      const objectifs = await enrichir(ctx.client, rows, jour);
      const groupes = new Map<string, number>();
      for (const o of objectifs.filter((x) => x.statut !== "abandonne")) {
        const cle = `${o.entite_id}|${o.niveau}|${o.niveau === "individuel" ? o.proprietaire_id : ""}`;
        groupes.set(cle, (groupes.get(cle) ?? 0) + 1);
      }
      const alertesNiveaux = [...groupes].filter(([, n]) => n > MAX_PAR_NIVEAU).map(([cle, n]) => {
        const [entite, niveau] = cle.split("|");
        return { code: "plus_de_5_objectifs", entite: objectifs.find((o) => o.entite_id === entite)?.entite, niveau, nombre: n };
      });
      const branches = (await ctx.client.query(
        "select distinct b.id, b.nom from entites e join entites b on b.id = coalesce(entite_branche(e.id), e.id) where e.id = any($1::uuid[]) order by b.nom", [acces],
      )).rows;
      return { periode, ecoule: Math.round(ecoule(periode, jour) * 100), branches, objectifs, alertes: alertesNiveaux, gerer: await aPermissionGlobale(ctx.client, ctx.utilisateurId, "pilotage.gerer") };
    }),
  );

  // Mesures automatiques proposées pour une entité : celles de sa branche seulement.
  app.get<{ Querystring: { entiteId: string } }>("/okr/mesures", { schema: { querystring: { type: "object", required: ["entiteId"], properties: { entiteId: uuid } } } }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "pilotage.voir", req.query.entiteId);
      return mesuresPour(await domaineDe(ctx.client, req.query.entiteId));
    }),
  );
  /** Les personnes à qui confier un objectif ou un résultat clé dans cette branche. */
  app.get<{ Querystring: { entiteId: string } }>("/okr/personnes", { schema: { querystring: { type: "object", required: ["entiteId"], properties: { entiteId: uuid } } } }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "pilotage.voir", req.query.entiteId);
      return (await ctx.client.query(
        `with recursive anc as (select id, parent_id from entites where id = $1 union all select e.id, e.parent_id from entites e join anc on e.id = anc.parent_id)
         select u.id, u.nom from utilisateurs u where u.actif and (
           exists (select 1 from employes e where e.utilisateur_id = u.id and coalesce(entite_branche(e.entite_id), e.entite_id) = coalesce(entite_branche($1), $1))
           or exists (select 1 from attributions a where a.utilisateur_id = u.id and (a.expire_le is null or a.expire_le > now()) and (a.entite_id in (select id from anc)
                or coalesce(entite_branche(a.entite_id), a.entite_id) = coalesce(entite_branche($1), $1)))) order by u.nom limit 500`,
        [req.query.entiteId],
      )).rows;
    }),
  );

  // ---------- Création, modification, validation ----------
  type SaisieObjectif = { entiteId: string; niveau: string; type: string; titre: string; description?: string; periode: string; parentId?: string; proprietaireId?: string; resultats: SaisieResultat[] };
  app.post<{ Body: SaisieObjectif }>("/okr", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "niveau", "type", "titre", "periode", "resultats"],
        properties: {
          entiteId: uuid, niveau: { type: "string", enum: ["branche", "equipe", "individuel"] }, type: { type: "string", enum: ["engage", "ambitieux"] },
          titre: texte(300), description: texte(2000, 0), periode: PERIODE, parentId: uuid, proprietaireId: uuid,
          resultats: { type: "array", minItems: 1, maxItems: 10, items: schemaResultat },
        },
      },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      const pilote = await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "pilotage.gerer", b.entiteId);
      let statut = "actif", proprio = b.proprietaireId ?? ctx.utilisateurId;
      if (!pilote) {
        // Sans droit de pilotage : on propose seulement son propre OKR individuel, dans son entité ; le responsable le valide.
        const { rows: [e] } = await ctx.client.query("select entite_id from employes where utilisateur_id = $1 and (date_sortie is null or date_sortie >= current_date)", [ctx.utilisateurId]);
        if (b.niveau !== "individuel" || !e || e.entite_id !== b.entiteId || (b.proprietaireId && b.proprietaireId !== ctx.utilisateurId)) throw new ErreurApi(403, "permission_refusee");
        statut = "propose"; proprio = ctx.utilisateurId;
      }
      const { rows: [ent] } = await ctx.client.query("select 1 from entites where id = $1", [b.entiteId]);
      if (!ent) throw new ErreurApi(404, "introuvable");
      await exigerProprietaire(ctx.client, proprio, b.entiteId);
      await controlerParent(ctx, b.parentId, b.entiteId, b.periode);
      for (const x of b.resultats) await controlerResultat(ctx.client, x, b.entiteId);
      const { rows: [o] } = await ctx.client.query(
        `insert into objectifs (organisation_id, entite_id, parent_id, titre, description, periode, niveau, type, proprietaire_id, statut, auteur_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [ctx.organisationId, b.entiteId, b.parentId ?? null, b.titre.trim(), b.description?.trim() || null, b.periode, b.niveau, b.type, proprio, statut, ctx.utilisateurId],
      );
      for (const x of b.resultats) await ajouterResultat(ctx, o.id, x, proprio);
      const obj = await charger(ctx.client, o.id);
      if (statut === "propose") {
        const resp = await responsablesDuProprietaire(ctx.client, ctx.utilisateurId, b.entiteId);
        await notifier(ctx.client, resp, `okr-propose-${o.id}`, `Un OKR individuel attend votre validation : « ${b.titre.trim()} ».`, "info", { type: "okr", id: o.id });
      }
      return { id: o.id, statut, alertes: await alertes(ctx.client, obj) };
    });
    return reponse.status(201).send(r);
  });

  app.patch<{ Params: { id: string }; Body: { titre?: string; description?: string; type?: string; proprietaireId?: string; parentId?: string | null } }>("/okr/:id", {
    schema: {
      params: paramId,
      body: { type: "object", properties: { titre: texte(300), description: texte(2000, 0), type: { type: "string", enum: ["engage", "ambitieux"] }, proprietaireId: uuid, parentId: { type: ["string", "null"], format: "uuid" } } },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const o = await charger(ctx.client, req.params.id);
      await gerer(ctx, o);
      if (o.statut === "clos" || o.statut === "abandonne") throw new ErreurApi(409, "objectif_non_actif");
      const b = req.body;
      if (b.proprietaireId) await exigerProprietaire(ctx.client, b.proprietaireId, o.entite_id);
      if (b.parentId !== undefined) await controlerParent(ctx, b.parentId, o.entite_id, o.periode, o.id);
      await ctx.client.query(
        `update objectifs set titre = coalesce($2, titre), description = case when $3::boolean then $4 else description end, type = coalesce($5, type),
           proprietaire_id = coalesce($6, proprietaire_id), parent_id = case when $7::boolean then $8::uuid else parent_id end where id = $1`,
        [o.id, b.titre?.trim() ?? null, b.description !== undefined, b.description?.trim() || null, b.type ?? null, b.proprietaireId ?? null, b.parentId !== undefined, b.parentId ?? null],
      );
      return { id: o.id, alertes: await alertes(ctx.client, await charger(ctx.client, o.id)) };
    }),
  );

  app.post<{ Params: { id: string }; Body: { decision: "accepter" | "refuser"; motif?: string } }>("/okr/:id/validation", {
    schema: { params: paramId, body: { type: "object", required: ["decision"], properties: { decision: { type: "string", enum: ["accepter", "refuser"] }, motif: texte(1000, 0) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const o = await charger(ctx.client, req.params.id);
      if (o.proprietaire_id === ctx.utilisateurId) throw new ErreurApi(403, "auto_validation_interdite");
      await gerer(ctx, o);
      if (o.statut !== "propose") throw new ErreurApi(409, "deja_decide");
      if (req.body.decision === "refuser" && !req.body.motif?.trim()) throw new ErreurApi(400, "motif_requis");
      const statut = req.body.decision === "accepter" ? "actif" : "abandonne";
      await ctx.client.query("update objectifs set statut = $2, motif_statut = $3 where id = $1", [o.id, statut, req.body.motif?.trim() || null]);
      if (o.proprietaire_id) await notifier(ctx.client, [o.proprietaire_id], `okr-decision-${o.id}`, statut === "actif" ? `Votre OKR « ${o.titre} » est validé.` : `Votre OKR « ${o.titre} » n'est pas retenu : ${req.body.motif!.trim()}`, "info", { type: "okr", id: o.id });
      return { statut };
    }),
  );
  app.post<{ Params: { id: string }; Body: { motif: string } }>("/okr/:id/abandon", {
    schema: { params: paramId, body: { type: "object", required: ["motif"], properties: { motif: texte(1000, 3) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const o = await charger(ctx.client, req.params.id);
      await gerer(ctx, o);
      if (o.statut === "clos" || o.statut === "abandonne") throw new ErreurApi(409, "objectif_non_actif");
      await ctx.client.query("update objectifs set statut = 'abandonne', motif_statut = $2 where id = $1", [o.id, req.body.motif.trim()]);
      return { statut: "abandonne" };
    }),
  );

  app.post<{ Params: { id: string }; Body: SaisieResultat }>("/okr/:id/resultats", { schema: { params: paramId, body: schemaResultat } }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const o = await charger(ctx.client, req.params.id);
      await gerer(ctx, o);
      if (o.statut === "clos" || o.statut === "abandonne") throw new ErreurApi(409, "objectif_non_actif");
      const { rows: [n] } = await ctx.client.query("select count(*)::int as n from resultats_cles where objectif_id = $1", [o.id]);
      if (n.n >= 10) throw new ErreurApi(409, "trop_de_resultats");
      await controlerResultat(ctx.client, req.body, o.entite_id);
      const id = await ajouterResultat(ctx, o.id, req.body, o.proprietaire_id);
      return { id, alertes: await alertes(ctx.client, o) };
    });
    return reponse.status(201).send(r);
  });
  app.patch<{ Params: { id: string }; Body: { libelle?: string; unite?: string; cible?: number; proprietaireId?: string } }>("/okr/resultats/:id", {
    schema: { params: paramId, body: { type: "object", properties: { libelle: texte(300), unite: texte(30, 0), cible: { type: "number" }, proprietaireId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { r, o } = await chargerResultat(ctx.client, req.params.id);
      await gerer(ctx, o);
      if (o.statut === "clos" || o.statut === "abandonne") throw new ErreurApi(409, "objectif_non_actif");
      if (req.body.cible !== undefined && req.body.cible === r.depart) throw new ErreurApi(400, "donnees_invalides");
      if (req.body.proprietaireId) await exigerProprietaire(ctx.client, req.body.proprietaireId, o.entite_id);
      await ctx.client.query(
        "update resultats_cles set libelle = coalesce($2, libelle), unite = case when $3::boolean then nullif($4, '') else unite end, cible = coalesce($5, cible), proprietaire_id = coalesce($6, proprietaire_id) where id = $1",
        [r.id, req.body.libelle?.trim() ?? null, req.body.unite !== undefined, req.body.unite?.trim() ?? null, req.body.cible ?? null, req.body.proprietaireId ?? null],
      );
      return { id: r.id };
    }),
  );

  // ---------- Détail ----------
  app.get<{ Params: { id: string } }>("/okr/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const o0 = await charger(ctx.client, req.params.id);
      await voir(ctx, o0);
      const jour = jourDouala();
      const { rows } = await ctx.client.query(`${SELECT_OBJECTIF} where o.id = $1`, [o0.id]);
      const [o] = await enrichir(ctx.client, rows, jour);
      const ids = o!.resultats.map((r: { id: string }) => r.id);
      const { debut, fin } = bornes(o!.periode);
      const [historique, initiatives, contributions, points, bilan, parent, enfants] = [
        (await ctx.client.query("select v.resultat_id, v.valeur::float, v.source, v.cree_le, u.nom as auteur from valeurs_resultat v left join utilisateurs u on u.id = v.auteur_id where v.resultat_id = any($1::uuid[]) order by v.cree_le", [ids])).rows,
        (await ctx.client.query(
          `select i.id, i.resultat_id, i.titre, i.statut, i.echeance::text, i.proprietaire_id, u.nom as proprietaire, i.projet_id, p.nom as projet,
             (select count(*) from taches_projet t where t.projet_id = i.projet_id)::int as taches, (select count(*) from taches_projet t where t.projet_id = i.projet_id and t.statut = 'termine')::int as terminees,
             (i.echeance < $2 and i.statut not in ('terminee', 'abandonnee')) as en_retard
           from initiatives i left join utilisateurs u on u.id = i.proprietaire_id left join projets p on p.id = i.projet_id where i.resultat_id = any($1::uuid[]) order by i.cree_le`, [ids, jour])).rows,
        // Contribution : les objectifs du jour rattachés à chaque résultat clé pendant le trimestre, par personne.
        (await ctx.client.query(
          `select j.resultat_cle_id as resultat_id, e.nom, count(*)::int as objectifs,
             count(*) filter (where j.valide or (j.realise_declare is not null and j.realise_declare >= j.cible))::int as atteints
           from objectifs_jour j join employes e on e.id = j.employe_id where j.resultat_cle_id = any($1::uuid[]) and j.jour between $2 and $3
           group by j.resultat_cle_id, e.nom order by count(*) desc`, [ids, debut, fin])).rows,
        (await ctx.client.query(
          `select p.id, p.resultat_id, p.semaine::text, p.valeur::float, p.confiance, p.blocages, p.prochaine_action, p.probleme_id, p.document_id, d.titre as document, u.nom as auteur
           from points_okr p join utilisateurs u on u.id = p.auteur_id left join documents_ged d on d.id = p.document_id where p.resultat_id = any($1::uuid[]) order by p.semaine desc limit 200`, [ids])).rows,
        (await ctx.client.query("select b.appris, b.garder, b.abandonner, b.cree_le, u.nom as auteur from bilans_okr b join utilisateurs u on u.id = b.auteur_id where b.objectif_id = $1", [o0.id])).rows[0] ?? null,
        o0.parent_id ? (await ctx.client.query("select id, titre, niveau from objectifs where id = $1", [o0.parent_id])).rows[0] ?? null : null,
        (await ctx.client.query("select id, titre, niveau, statut from objectifs where parent_id = $1 order by cree_le", [o0.id])).rows,
      ];
      const gere = await peutGerer(ctx, o0);
      return {
        ...o, parent, enfants, bilan, peut_gerer: gere, peut_valider: gere && o0.proprietaire_id !== ctx.utilisateurId,
        notation_ouverte: jour >= decalerJour(fin, -14),
        resultats: o!.resultats.map((r: Record<string, any>) => ({
          ...r, historique: historique.filter((h) => h.resultat_id === r.id), initiatives: initiatives.filter((i) => i.resultat_id === r.id),
          contributions: contributions.filter((c) => c.resultat_id === r.id), points: points.filter((p) => p.resultat_id === r.id),
          peut_pointer: gere || r.proprietaire_id === ctx.utilisateurId || o0.proprietaire_id === ctx.utilisateurId,
        })),
      };
    }),
  );

  // ---------- Point hebdomadaire ----------
  /** Faire le point, gérer les initiatives : le propriétaire du résultat clé, celui de l'objectif, ou qui pilote l'objectif. */
  const peutPointer = async (ctx: Contexte, r: Record<string, any>, o: Objectif) => r.proprietaire_id === ctx.utilisateurId || o.proprietaire_id === ctx.utilisateurId || await peutGerer(ctx, o);
  app.post<{
    Params: { id: string };
    Body: { valeur?: number; confiance: number; blocages?: string; prochaineAction?: string; documentId?: string; probleme?: { categorie: string; destinataire: string; priorite: string; motifUrgence?: string } };
  }>("/okr/resultats/:id/points", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["confiance"],
        properties: {
          valeur: { type: "number" }, confiance: { type: "integer", minimum: 1, maximum: 10 }, blocages: texte(3000, 0), prochaineAction: texte(2000, 0), documentId: uuid,
          probleme: {
            type: "object", required: ["categorie", "destinataire", "priorite"],
            properties: { categorie: { type: "string", enum: CATEGORIES_PROBLEME }, destinataire: { type: "string", enum: DESTINATAIRES_PROBLEME }, priorite: { type: "string", enum: ["normal", "important", "urgent"] }, motifUrgence: texte(1000, 0) },
          },
        },
      },
    },
  }, async (req, reponse) => {
    const res = await protege(req, async (ctx) => {
      const { r, o } = await chargerResultat(ctx.client, req.params.id);
      if (!await peutVoir(ctx, o)) throw new ErreurApi(404, "introuvable");
      if (!await peutPointer(ctx, r, o)) throw new ErreurApi(403, "permission_refusee");
      if (o.statut !== "actif") throw new ErreurApi(409, "objectif_non_actif");
      const b = req.body;
      if (r.mode === "manuel" && b.valeur === undefined) throw new ErreurApi(400, "valeur_requise");
      if (b.documentId) {
        const { rows: [d] } = await ctx.client.query("select entite_id, categorie, coalesce(entite_branche(entite_id), entite_id) as b from documents_ged where id = $1", [b.documentId]);
        if (!d || d.b !== o.branche_id || !await aPermissionSurEntite(ctx.client, ctx.utilisateurId, DROIT_VOIR[d.categorie]!, d.entite_id)) throw new ErreurApi(400, "document_invalide");
      }
      const semaine = lundi(jourDouala());
      const { rows: [deja] } = await ctx.client.query("select id, probleme_id from points_okr where resultat_id = $1 and semaine = $2", [r.id, semaine]);
      let problemeId: string | null = deja?.probleme_id ?? null;
      if (b.probleme) {
        if (!b.blocages?.trim()) throw new ErreurApi(400, "blocage_requis");
        if (problemeId) throw new ErreurApi(409, "probleme_deja_signale");
        const p = await crochetsPerformance.signalerProbleme!(ctx, { ...b.probleme, description: `Blocage sur le résultat clé « ${r.libelle} » (${o.titre}) : ${b.blocages.trim()}` }, r.id);
        problemeId = p.id;
      }
      const valeur = r.mode === "manuel" ? b.valeur! : r.actuel;
      const { rows: [p] } = await ctx.client.query(
        `insert into points_okr (organisation_id, resultat_id, semaine, valeur, confiance, blocages, prochaine_action, document_id, probleme_id, auteur_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (organisation_id, resultat_id, semaine) do update set valeur = excluded.valeur, confiance = excluded.confiance, blocages = excluded.blocages,
           prochaine_action = excluded.prochaine_action, document_id = coalesce(excluded.document_id, points_okr.document_id), probleme_id = excluded.probleme_id, auteur_id = excluded.auteur_id, maj_le = now()
         returning id, semaine::text`,
        [ctx.organisationId, r.id, semaine, valeur, b.confiance, b.blocages?.trim() || null, b.prochaineAction?.trim() || null, b.documentId ?? null, problemeId, ctx.utilisateurId],
      );
      await ctx.client.query("update resultats_cles set actuel = $2, confiance = $3, maj_le = now() where id = $1", [r.id, valeur, b.confiance]);
      if (r.mode === "manuel" && valeur !== r.actuel) {
        await ctx.client.query("insert into valeurs_resultat (organisation_id, resultat_id, valeur, source, auteur_id) values ($1, $2, $3, 'point', $4)", [ctx.organisationId, r.id, valeur, ctx.utilisateurId]);
      }
      const { rows: hist } = await ctx.client.query("select semaine::text, confiance from points_okr where resultat_id = $1", [r.id]);
      const av = avancement(r.depart, r.cible, valeur);
      return { id: p.id, semaine: p.semaine, probleme_id: problemeId, avancement: av, feu: feu(av, ecoule(o.periode, jourDouala()), o.type), confiance_en_baisse: confianceEnBaisse(hist) };
    });
    return reponse.status(201).send(res);
  });

  // ---------- Initiatives ----------
  app.post<{ Params: { id: string }; Body: { titre: string; proprietaireId?: string; echeance?: string; projetId?: string } }>("/okr/resultats/:id/initiatives", {
    schema: { params: paramId, body: { type: "object", required: ["titre"], properties: { titre: texte(300), proprietaireId: uuid, echeance: date, projetId: uuid } } },
  }, async (req, reponse) => {
    const res = await protege(req, async (ctx) => {
      const { r, o } = await chargerResultat(ctx.client, req.params.id);
      if (!await peutVoir(ctx, o)) throw new ErreurApi(404, "introuvable");
      if (!await peutPointer(ctx, r, o)) throw new ErreurApi(403, "permission_refusee");
      if (o.statut !== "actif") throw new ErreurApi(409, "objectif_non_actif");
      const b = req.body;
      await exigerProprietaire(ctx.client, b.proprietaireId, o.entite_id);
      if (b.projetId) {
        const { rows: [p] } = await ctx.client.query("select coalesce(entite_branche(entite_id), entite_id) as b from projets where id = $1", [b.projetId]);
        if (!p) throw new ErreurApi(404, "introuvable");
        if (p.b !== o.branche_id) throw new ErreurApi(409, "projet_autre_branche");
      }
      return (await ctx.client.query(
        "insert into initiatives (organisation_id, resultat_id, titre, proprietaire_id, echeance, projet_id, auteur_id) values ($1, $2, $3, $4, $5, $6, $7) returning id",
        [ctx.organisationId, r.id, b.titre.trim(), b.proprietaireId ?? r.proprietaire_id ?? ctx.utilisateurId, b.echeance ?? null, b.projetId ?? null, ctx.utilisateurId],
      )).rows[0];
    });
    return reponse.status(201).send(res);
  });
  app.patch<{ Params: { id: string }; Body: { statut: string } }>("/okr/initiatives/:id", {
    schema: { params: paramId, body: { type: "object", required: ["statut"], properties: { statut: { type: "string", enum: ["a_faire", "en_cours", "terminee", "abandonnee"] } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [i] } = await ctx.client.query("select id, resultat_id, proprietaire_id from initiatives where id = $1", [req.params.id]);
      if (!i) throw new ErreurApi(404, "introuvable");
      const { r, o } = await chargerResultat(ctx.client, i.resultat_id);
      if (!await peutVoir(ctx, o)) throw new ErreurApi(404, "introuvable");
      if (i.proprietaire_id !== ctx.utilisateurId && !await peutPointer(ctx, r, o)) throw new ErreurApi(403, "permission_refusee");
      await ctx.client.query("update initiatives set statut = $2 where id = $1", [i.id, req.body.statut]);
      return { statut: req.body.statut };
    }),
  );

  // ---------- Fin de trimestre ----------
  app.post<{ Params: { id: string }; Body: { note: number; commentaire: string } }>("/okr/resultats/:id/note", {
    schema: { params: paramId, body: { type: "object", required: ["note", "commentaire"], properties: { note: { type: "number", minimum: 0, maximum: 1 }, commentaire: texte(2000, 3) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { r, o } = await chargerResultat(ctx.client, req.params.id);
      await gerer(ctx, o);
      if (o.statut !== "actif") throw new ErreurApi(409, "objectif_non_actif");
      // La note se pose dans les deux dernières semaines du trimestre ou après.
      if (jourDouala() < decalerJour(bornes(o.periode).fin, -14)) throw new ErreurApi(409, "trimestre_en_cours");
      const note = Math.round(req.body.note * 100) / 100;
      await ctx.client.query("update resultats_cles set note = $2, commentaire_note = $3, note_par = $4, note_le = now() where id = $1", [r.id, note, req.body.commentaire.trim(), ctx.utilisateurId]);
      return { note, reussi: reussi(o.type, note) };
    }),
  );
  app.post<{ Params: { id: string }; Body: { appris: string; garder?: string; abandonner?: string } }>("/okr/:id/cloture", {
    schema: { params: paramId, body: { type: "object", required: ["appris"], properties: { appris: texte(3000, 3), garder: texte(3000, 0), abandonner: texte(3000, 0) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const o = await charger(ctx.client, req.params.id);
      await gerer(ctx, o);
      if (o.statut !== "actif") throw new ErreurApi(409, "objectif_non_actif");
      const { rows: [n] } = await ctx.client.query("select count(*) filter (where note is null)::int as manque, avg(note)::float as note from resultats_cles where objectif_id = $1", [o.id]);
      if (n.manque > 0) throw new ErreurApi(409, "notation_incomplete", { manque: n.manque });
      await ctx.client.query("insert into bilans_okr (organisation_id, objectif_id, appris, garder, abandonner, auteur_id) values ($1, $2, $3, $4, $5, $6)",
        [ctx.organisationId, o.id, req.body.appris.trim(), req.body.garder?.trim() || null, req.body.abandonner?.trim() || null, ctx.utilisateurId]);
      await ctx.client.query("update objectifs set statut = 'clos', clos_le = now() where id = $1", [o.id]);
      const note = Math.round(n.note * 100) / 100;
      return { statut: "clos", note, reussi: reussi(o.type, note) };
    }),
  );
  /** Reconduire au trimestre suivant sans ressaisie : mêmes résultats clés, valeurs remises au départ. */
  app.post<{ Params: { id: string } }>("/okr/:id/reconduction", { schema: { params: paramId } }, async (req, reponse) => {
    const res = await protege(req, async (ctx) => {
      const o = await charger(ctx.client, req.params.id);
      await gerer(ctx, o);
      if (o.statut === "propose") throw new ErreurApi(409, "objectif_non_actif");
      const { rows: [deja] } = await ctx.client.query("select id from objectifs where origine_id = $1", [o.id]);
      if (deja) throw new ErreurApi(409, "deja_reconduit");
      const periode = periodeSuivante(o.periode);
      // Le parent suit s'il a lui-même été reconduit ; sinon l'objectif repart sans parent.
      const { rows: [parent] } = o.parent_id ? await ctx.client.query("select id from objectifs where origine_id = $1", [o.parent_id]) : { rows: [] };
      const { rows: [x] } = await ctx.client.query(
        `insert into objectifs (organisation_id, entite_id, parent_id, titre, description, periode, niveau, type, proprietaire_id, responsable, statut, origine_id, auteur_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'actif', $11, $12) returning id, periode`,
        [ctx.organisationId, o.entite_id, parent?.id ?? null, o.titre, o.description, periode, o.niveau, o.type, o.proprietaire_id, o.responsable, o.id, ctx.utilisateurId],
      );
      const { rows: krs } = await ctx.client.query("select libelle, unite, depart::float, cible::float, proprietaire_id, kpi from resultats_cles where objectif_id = $1 order by cree_le, id", [o.id]);
      for (const k of krs) await ajouterResultat(ctx, x.id, { libelle: k.libelle, unite: k.unite ?? undefined, depart: k.depart, cible: k.cible, proprietaireId: k.proprietaire_id ?? undefined, kpi: k.kpi ?? undefined }, null);
      return { id: x.id, periode: x.periode, resultats: krs.length };
    });
    return reponse.status(201).send(res);
  });

  // ---------- Vue équipe : pour le responsable ----------
  app.get<{ Querystring: { periode?: string } }>("/okr/equipe", { schema: { querystring: { type: "object", properties: { periode: PERIODE } } } }, async (req) =>
    protege(req, async (ctx) => {
      const jour = jourDouala();
      const periode = req.query.periode ?? periodeDe(jour);
      // Mon équipe : les personnes dont je suis le responsable direct, et les entités où je pilote.
      const pilotees = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "pilotage.gerer")).map((e) => String(e.id));
      const { rows: equipe } = await ctx.client.query(
        "select e.utilisateur_id from employes e join employes r on r.id = e.responsable_id where r.utilisateur_id = $1 and e.utilisateur_id is not null", [ctx.utilisateurId],
      );
      const membres = equipe.map((x) => String(x.utilisateur_id));
      if (!pilotees.length && !membres.length) throw new ErreurApi(403, "permission_refusee");
      const { rows } = await ctx.client.query(
        `${SELECT_OBJECTIF} where o.periode = $1 and o.statut in ('actif', 'propose') and (o.entite_id = any($2::uuid[]) or o.proprietaire_id = any($3::uuid[])
           or exists (select 1 from resultats_cles r where r.objectif_id = o.id and r.proprietaire_id = any($3::uuid[]))) order by o.cree_le limit 300`,
        [periode, pilotees, membres],
      );
      const objectifs = await enrichir(ctx.client, rows, jour);
      const resultats = objectifs.flatMap((o) => o.resultats.map((r: Record<string, any>) => ({ ...r, objectif: o.titre, objectif_id: o.id, type: o.type, niveau: o.niveau })));
      const { rows: enRetard } = await ctx.client.query(
        `select i.id, i.titre, i.echeance::text, u.nom as proprietaire, r.libelle as resultat, o.id as objectif_id from initiatives i join resultats_cles r on r.id = i.resultat_id join objectifs o on o.id = r.objectif_id
         left join utilisateurs u on u.id = i.proprietaire_id where o.id = any($1::uuid[]) and i.echeance < $2 and i.statut not in ('terminee', 'abandonnee') order by i.echeance`,
        [objectifs.map((o) => o.id), jour],
      );
      return {
        periode, ecoule: Math.round(ecoule(periode, jour) * 100),
        a_valider: objectifs.filter((o) => o.statut === "propose").map((o) => ({ id: o.id, titre: o.titre, proprietaire: o.proprietaire })),
        resultats: resultats.sort((a, b) => Number(b.confiance_en_baisse) - Number(a.confiance_en_baisse) || (a.dernier_point?.confiance ?? 11) - (b.dernier_point?.confiance ?? 11)),
        blocages: resultats.filter((r) => r.dernier_point?.blocages).map((r) => ({ resultat: r.libelle, objectif_id: r.objectif_id, proprietaire: r.proprietaire, semaine: r.dernier_point.semaine, blocages: r.dernier_point.blocages })),
        initiatives_en_retard: enRetard,
      };
    }),
  );

  // ---------- Mes OKR ----------
  app.get<{ Querystring: { periode?: string } }>("/moi/okr", { schema: { querystring: { type: "object", properties: { periode: PERIODE } } } }, async (req) =>
    protege(req, async (ctx) => {
      const jour = jourDouala();
      const periode = req.query.periode ?? periodeDe(jour);
      const { rows } = await ctx.client.query(
        `${SELECT_OBJECTIF} where o.periode = $1 and o.statut <> 'abandonne' and (o.proprietaire_id = $2
           or exists (select 1 from resultats_cles r left join initiatives i on i.resultat_id = r.id where r.objectif_id = o.id and (r.proprietaire_id = $2 or i.proprietaire_id = $2)))
         order by o.cree_le limit 100`, [periode, ctx.utilisateurId],
      );
      const objectifs = await enrichir(ctx.client, rows, jour);
      const parents = objectifs.map((o) => o.parent_id).filter(Boolean);
      const { rows: titres } = await ctx.client.query("select id, titre from objectifs where id = any($1::uuid[])", [parents]);
      const { rows: contrib } = await ctx.client.query(
        `select j.resultat_cle_id, count(*)::int as n from objectifs_jour j join employes e on e.id = j.employe_id where e.utilisateur_id = $1 and j.resultat_cle_id is not null and j.jour between $2 and $3 group by j.resultat_cle_id`,
        [ctx.utilisateurId, bornes(periode).debut, bornes(periode).fin],
      );
      const { rows: [e] } = await ctx.client.query("select e.entite_id, x.nom as entite from employes e join entites x on x.id = e.entite_id where e.utilisateur_id = $1", [ctx.utilisateurId]);
      return {
        periode, ecoule: Math.round(ecoule(periode, jour) * 100), semaine: lundi(jour), entite: e ?? null,
        objectifs: objectifs.map((o) => ({
          ...o, parent_titre: titres.find((t) => t.id === o.parent_id)?.titre ?? null,
          resultats: o.resultats.map((r: Record<string, any>) => ({ ...r, a_moi: r.proprietaire_id === ctx.utilisateurId, mes_objectifs_jour: contrib.find((c) => c.resultat_cle_id === r.id)?.n ?? 0 })),
        })),
      };
    }),
  );

  // ---------- Lien avec les objectifs du jour ----------
  /** Résultats clés actifs de ma branche auxquels je peux rattacher un objectif du jour : ceux de mon entité et au-dessus, et les miens. */
  const rattachables = async (c: Client, utilisateurId: string) => {
    const { rows: [e] } = await c.query("select id, entite_id from employes where utilisateur_id = $1 and (date_sortie is null or date_sortie >= current_date)", [utilisateurId]);
    if (!e) throw new ErreurApi(409, "dossier_employe_absent");
    const periode = periodeDe(jourDouala());
    const { rows } = await c.query(
      `with recursive anc as (select id, parent_id from entites where id = $1 union all select x.id, x.parent_id from entites x join anc on x.id = anc.parent_id)
       select r.id, r.libelle, o.id as objectif_id, o.titre as objectif, o.niveau from resultats_cles r join objectifs o on o.id = r.objectif_id
       where o.statut = 'actif' and o.periode = $2 and coalesce(entite_branche(o.entite_id), o.entite_id) = coalesce(entite_branche($1), $1)
         and (o.entite_id in (select id from anc) or o.proprietaire_id = $3 or r.proprietaire_id = $3)
       order by case o.niveau when 'individuel' then 0 when 'equipe' then 1 else 2 end, o.titre, r.libelle`,
      [e.entite_id, periode, utilisateurId],
    );
    return { employe: e, resultats: rows };
  };
  app.get("/moi/resultats-cles", async (req) => protege(req, async (ctx) => (await rattachables(ctx.client, ctx.utilisateurId)).resultats));
  app.put<{ Params: { id: string }; Body: { resultatCleId: string | null } }>("/moi/objectifs-jour/:id/resultat-cle", {
    schema: { params: paramId, body: { type: "object", required: ["resultatCleId"], properties: { resultatCleId: { type: ["string", "null"], format: "uuid" } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { employe, resultats } = await rattachables(ctx.client, ctx.utilisateurId);
      const { rows: [o] } = await ctx.client.query("select id, jour::text from objectifs_jour where id = $1 and employe_id = $2", [req.params.id, employe.id]);
      if (!o) throw new ErreurApi(404, "introuvable");
      const { rows: [rap] } = await ctx.client.query("select statut from rapports_jour where employe_id = $1 and jour = $2 order by version desc limit 1", [employe.id, o.jour]);
      if (rap?.statut === "remis") throw new ErreurApi(409, "rapport_fige");
      if (req.body.resultatCleId && !resultats.some((r) => r.id === req.body.resultatCleId)) throw new ErreurApi(409, "resultat_non_rattachable");
      await ctx.client.query("update objectifs_jour set resultat_cle_id = $2 where id = $1", [o.id, req.body.resultatCleId]);
      return { resultat_cle_id: req.body.resultatCleId };
    }),
  );

  taches.push((org) => dansOrganisation(pool, org, (c) => journeeOkr(c, new Date())));
}
