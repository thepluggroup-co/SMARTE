import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Client } from "./base.js";
import { KPI, kpiPersonnel, kpiPersonnels } from "./commerce.js";
import { aPermissionSurEntite, entitesAccessibles } from "./permissions.js";
import { notifier } from "./performance.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";

/*
 * Fiches de poste du module Performance. Chaque modification publie une nouvelle version ;
 * les anciennes restent consultables, et le collaborateur confirme avoir lu la version en vigueur.
 */

const uuid = { type: "string", format: "uuid" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const ligne = { type: "string", minLength: 1, maxLength: 500 } as const;
const liste = { type: "array", maxItems: 30, items: ligne } as const;

type Indicateur = { kpi: string; cible: number; poids: number };
type ObjectifType = { libelle: string; type: "mesure_systeme" | "chiffre_declare" | "tache"; kpi?: string; cible: number; poids: number };
type Saisie = {
  rattacheA?: string | null; rattachement?: string; missions: string[]; responsabilites: string[]; competences: string[];
  indicateurs: Indicateur[]; objectifsTypes: ObjectifType[]; motif?: string;
};
const schemaContenu = {
  rattacheA: { type: ["string", "null"], format: "uuid" }, rattachement: { type: "string", maxLength: 300 },
  missions: liste, responsabilites: liste, competences: liste,
  indicateurs: {
    type: "array", maxItems: 15,
    items: { type: "object", required: ["kpi", "cible", "poids"], additionalProperties: false, properties: { kpi: { type: "string", maxLength: 60 }, cible: { type: "number", minimum: 0, maximum: 1e12 }, poids: { type: "integer", minimum: 1, maximum: 100 } } },
  },
  objectifsTypes: {
    type: "array", maxItems: 15,
    items: {
      type: "object", required: ["libelle", "type", "cible", "poids"], additionalProperties: false,
      properties: {
        libelle: { type: "string", minLength: 1, maxLength: 200 }, type: { type: "string", enum: ["mesure_systeme", "chiffre_declare", "tache"] },
        kpi: { type: "string", maxLength: 60 }, cible: { type: "number", minimum: 0, maximum: 1e12 }, poids: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
  motif: { type: "string", minLength: 3, maxLength: 1000 },
} as const;

/** Indicateurs du catalogue, et pour les objectifs journaliers seulement des mesures qui se calculent sur un jour. */
export function controlerFiche(s: Pick<Saisie, "indicateurs" | "objectifsTypes">): void {
  for (const i of s.indicateurs) if (!kpiPersonnel(KPI[i.kpi])) throw new ErreurApi(400, "fiche_invalide", { indicateur: i.kpi });
  for (const o of s.objectifsTypes) {
    const ok = o.type === "mesure_systeme" ? !!o.kpi && kpiPersonnel(KPI[o.kpi]) && !KPI[o.kpi]!.mensuel : !o.kpi;
    if (!ok) throw new ErreurApi(400, "fiche_invalide", { objectif: o.libelle });
  }
}
const nettoyer = (l: string[]) => l.map((x) => x.trim()).filter(Boolean);

export function enregistrerFiches(app: FastifyInstance, outils: Outils): void {
  const { protege } = outils;

  /** Les RH ou le responsable des évaluations de l'entité rédigent la fiche. */
  const peutRediger = async (ctx: Contexte, entiteId: string) => {
    const branche = (await ctx.client.query("select coalesce(entite_branche($1), $1) as b", [entiteId])).rows[0].b;
    for (const p of ["rh.gerer", "rh.evaluer"] as const) {
      if (await aPermissionSurEntite(ctx.client, ctx.utilisateurId, p, entiteId) || await aPermissionSurEntite(ctx.client, ctx.utilisateurId, p, branche)) return true;
    }
    return false;
  };
  const exigerRedaction = async (ctx: Contexte, entiteId: string) => { if (!await peutRediger(ctx, entiteId)) throw new ErreurApi(403, "permission_refusee"); };
  const entitesRedigees = async (ctx: Contexte): Promise<string[]> => {
    const acces = [...(await entitesAccessibles(ctx.client, ctx.utilisateurId, "rh.gerer")), ...(await entitesAccessibles(ctx.client, ctx.utilisateurId, "rh.evaluer"))].map((e) => String(e.id));
    if (!acces.length) return [];
    const { rows } = await ctx.client.query("with recursive d as (select id from entites where id = any($1::uuid[]) union select e.id from entites e join d on e.parent_id = d.id) select id from d", [acces]);
    return rows.map((r) => String(r.id));
  };
  const derniere = async (c: Client, groupeId: string) => {
    const { rows: [f] } = await c.query("select * from fiches_poste where groupe_id = $1 order by version desc limit 1", [groupeId]);
    if (!f) throw new ErreurApi(404, "introuvable");
    return f;
  };
  /** Le poste supérieur doit être une fiche de la même branche, et jamais la fiche elle-même. */
  const controlerRattachement = async (c: Client, rattacheA: string | null | undefined, entiteId: string, groupeId?: string) => {
    if (!rattacheA) return;
    const { rows: [r] } = await c.query(
      "select 1 from fiches_poste where groupe_id = $1 and coalesce(entite_branche(entite_id), entite_id) = coalesce(entite_branche($2), $2) limit 1", [rattacheA, entiteId],
    );
    if (!r || rattacheA === groupeId) throw new ErreurApi(400, "rattachement_invalide");
  };
  /** Les employés dont le poste porte cet intitulé, dans l'entité de la fiche ou en dessous. */
  const concernes = async (c: Client, f: Record<string, any>) => (await c.query(
    `with recursive d as (select id from entites where id = $1 union select e.id from entites e join d on e.parent_id = d.id)
     select e.id, e.nom, e.utilisateur_id,
       exists (select 1 from lectures_fiche l where l.fiche_id = $3 and l.employe_id = e.id) as lu,
       (select l.lu_le from lectures_fiche l where l.fiche_id = $3 and l.employe_id = e.id) as lu_le
     from employes e where e.entite_id in (select id from d) and e.poste = $2 and (e.date_sortie is null or e.date_sortie >= current_date) order by e.nom`,
    [f.entite_id, f.intitule, f.id],
  )).rows;
  const publier = async (ctx: Contexte, groupeId: string, version: number, entiteId: string, intitule: string, s: Saisie) => {
    const { rows: [f] } = await ctx.client.query(
      `insert into fiches_poste (organisation_id, groupe_id, version, entite_id, intitule, rattache_a, rattachement, missions, responsabilites, competences, indicateurs, objectifs_types, motif_version, auteur_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning *`,
      [ctx.organisationId, groupeId, version, entiteId, intitule, s.rattacheA ?? null, s.rattachement?.trim() || null, nettoyer(s.missions), nettoyer(s.responsabilites), nettoyer(s.competences),
        JSON.stringify(s.indicateurs), JSON.stringify(s.objectifsTypes.map((o) => ({ ...o, libelle: o.libelle.trim(), cible: o.type === "tache" ? 1 : o.cible }))), version > 1 ? s.motif!.trim() : null, ctx.utilisateurId],
    );
    const personnes = (await concernes(ctx.client, f)).map((e) => e.utilisateur_id).filter(Boolean);
    await notifier(ctx.client, personnes, `fiche-${f.id}`, version === 1 ? `Votre fiche de poste « ${intitule} » est disponible : lisez-la et confirmez.` : `Votre fiche de poste « ${intitule} » a changé (version ${version}) : lisez-la et confirmez.`, "info");
    return f;
  };

  app.get("/fiches-poste/indicateurs", async (req) =>
    protege(req, async (ctx) => {
      if (!(await entitesRedigees(ctx)).length) throw new ErreurApi(403, "permission_refusee");
      return kpiPersonnels().map(([code, k]) => ({ code, libelle: k.libelle, mensuel: !!k.mensuel }));
    }),
  );
  app.get("/fiches-poste", async (req) =>
    protege(req, async (ctx) => {
      const ids = await entitesRedigees(ctx);
      if (!ids.length) throw new ErreurApi(403, "permission_refusee");
      return (await ctx.client.query(
        `select distinct on (f.groupe_id) f.groupe_id, f.id, f.version, f.intitule, f.entite_id, x.nom as entite, f.cree_le,
           (select count(*) from modeles_objectifs m where m.fiche_id = f.id and m.actif)::int as modeles_actifs
         from fiches_poste f join entites x on x.id = f.entite_id where f.entite_id = any($1::uuid[]) order by f.groupe_id, f.version desc`, [ids],
      )).rows.sort((a, b) => a.entite.localeCompare(b.entite) || a.intitule.localeCompare(b.intitule));
    }),
  );
  app.post<{ Body: Saisie & { entiteId: string; intitule: string } }>("/fiches-poste", {
    schema: { body: { type: "object", required: ["entiteId", "intitule", "missions", "responsabilites", "competences", "indicateurs", "objectifsTypes"], properties: { entiteId: uuid, intitule: { type: "string", minLength: 1, maxLength: 200 }, ...schemaContenu } } },
  }, async (req, reponse) => {
    const f = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerRedaction(ctx, b.entiteId);
      controlerFiche(b);
      const intitule = b.intitule.trim();
      const { rows: [deja] } = await ctx.client.query("select 1 from fiches_poste where entite_id = $1 and intitule = $2 limit 1", [b.entiteId, intitule]);
      if (deja) throw new ErreurApi(409, "fiche_existante");
      const groupe = randomUUID();
      await controlerRattachement(ctx.client, b.rattacheA, b.entiteId, groupe);
      return publier(ctx, groupe, 1, b.entiteId, intitule, b);
    });
    return reponse.status(201).send(f);
  });
  /** Modifier, c'est publier une nouvelle version avec un motif ; l'intitulé et l'entité ne changent pas. */
  app.put<{ Params: { id: string }; Body: Saisie }>("/fiches-poste/:id", {
    schema: { params: paramId, body: { type: "object", required: ["missions", "responsabilites", "competences", "indicateurs", "objectifsTypes"], properties: schemaContenu } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const actuelle = await derniere(ctx.client, req.params.id);
      await exigerRedaction(ctx, actuelle.entite_id);
      if (!req.body.motif?.trim()) throw new ErreurApi(400, "motif_requis");
      controlerFiche(req.body);
      await controlerRattachement(ctx.client, req.body.rattacheA, actuelle.entite_id, actuelle.groupe_id);
      return publier(ctx, actuelle.groupe_id, actuelle.version + 1, actuelle.entite_id, actuelle.intitule, req.body);
    }),
  );
  app.get<{ Params: { id: string } }>("/fiches-poste/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const f = await derniere(ctx.client, req.params.id);
      await exigerRedaction(ctx, f.entite_id);
      const versions = (await ctx.client.query(
        "select f.id, f.version, f.motif_version, f.cree_le, u.nom as auteur from fiches_poste f join utilisateurs u on u.id = f.auteur_id where f.groupe_id = $1 order by f.version desc", [f.groupe_id],
      )).rows;
      const rattache = f.rattache_a ? (await ctx.client.query("select intitule from fiches_poste where groupe_id = $1 order by version desc limit 1", [f.rattache_a])).rows[0]?.intitule : null;
      return { ...f, rattache_intitule: rattache, versions, lectures: await concernes(ctx.client, f) };
    }),
  );
  app.get<{ Params: { id: string } }>("/fiches-poste/versions/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [f] } = await ctx.client.query("select * from fiches_poste where id = $1", [req.params.id]);
      if (!f) throw new ErreurApi(404, "introuvable");
      await exigerRedaction(ctx, f.entite_id);
      return f;
    }),
  );
  /**
   * Les objectifs types de la version en vigueur deviennent les modèles d'objectifs journaliers du poste.
   * Les modèles tirés d'une version précédente s'arrêtent ; ceux saisis à la main restent.
   */
  app.post<{ Params: { id: string } }>("/fiches-poste/:id/modeles", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const f = await derniere(ctx.client, req.params.id);
      await exigerRedaction(ctx, f.entite_id);
      if (!f.objectifs_types.length) throw new ErreurApi(409, "fiche_sans_objectifs");
      const { rows: [deja] } = await ctx.client.query("select 1 from modeles_objectifs where fiche_id = $1 and actif limit 1", [f.id]);
      if (deja) throw new ErreurApi(409, "modeles_deja_generes");
      const { rowCount: arretes } = await ctx.client.query(
        "update modeles_objectifs set actif = false where entite_id = $1 and poste = $2 and actif and fiche_id in (select id from fiches_poste where groupe_id = $3)",
        [f.entite_id, f.intitule, f.groupe_id],
      );
      for (const o of f.objectifs_types as ObjectifType[]) {
        await ctx.client.query(
          "insert into modeles_objectifs (organisation_id, entite_id, poste, libelle, type, kpi, cible, poids, auteur_id, fiche_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
          [ctx.organisationId, f.entite_id, f.intitule, o.libelle, o.type, o.type === "mesure_systeme" ? o.kpi : null, o.cible, o.poids, ctx.utilisateurId, f.id],
        );
      }
      return { crees: f.objectifs_types.length, arretes: arretes ?? 0, version: f.version };
    }),
  );

  // Le collaborateur : la fiche de son poste, la plus proche de son entité.
  const maFiche = async (ctx: Contexte) => {
    const { rows: [e] } = await ctx.client.query("select id, entite_id, poste from employes where utilisateur_id = $1 and (date_sortie is null or date_sortie >= current_date)", [ctx.utilisateurId]);
    if (!e) throw new ErreurApi(409, "dossier_employe_absent");
    const { rows: [f] } = await ctx.client.query(
      `with recursive anc as (select id, parent_id, 0 as n from entites where id = $1 union all select x.id, x.parent_id, anc.n + 1 from entites x join anc on x.id = anc.parent_id),
         groupe as (select f.groupe_id from fiches_poste f join anc on anc.id = f.entite_id where f.intitule = $2 order by anc.n limit 1)
       select f.* from fiches_poste f where f.groupe_id = (select groupe_id from groupe) order by f.version desc limit 1`,
      [e.entite_id, e.poste],
    );
    return { e, f };
  };
  app.get("/moi/fiche-poste", async (req) =>
    protege(req, async (ctx) => {
      const { e, f } = await maFiche(ctx);
      if (!f) return { poste: e.poste, fiche: null };
      const { rows: [l] } = await ctx.client.query("select lu_le from lectures_fiche where fiche_id = $1 and employe_id = $2", [f.id, e.id]);
      const rattache = f.rattache_a ? (await ctx.client.query("select intitule from fiches_poste where groupe_id = $1 order by version desc limit 1", [f.rattache_a])).rows[0]?.intitule : null;
      const indicateurs = (f.indicateurs as Indicateur[]).map((i) => ({ ...i, libelle: KPI[i.kpi]?.libelle ?? i.kpi }));
      const objectifs = (f.objectifs_types as ObjectifType[]).map((o) => ({ ...o, kpi_libelle: o.kpi ? KPI[o.kpi]?.libelle ?? o.kpi : null }));
      const entite = (await ctx.client.query("select nom from entites where id = $1", [f.entite_id])).rows[0]?.nom;
      return { poste: e.poste, fiche: { ...f, entite, indicateurs, objectifs_types: objectifs, rattache_intitule: rattache }, lu_le: l?.lu_le ?? null };
    }),
  );
  /** La confirmation vaut pour une version précise : une nouvelle version demande une nouvelle lecture. */
  app.post<{ Body: { ficheId: string } }>("/moi/fiche-poste/lecture", {
    schema: { body: { type: "object", required: ["ficheId"], properties: { ficheId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { e, f } = await maFiche(ctx);
      if (!f) throw new ErreurApi(404, "introuvable");
      if (f.id !== req.body.ficheId) throw new ErreurApi(409, "fiche_obsolete");
      await ctx.client.query("insert into lectures_fiche (organisation_id, fiche_id, employe_id) values ($1, $2, $3) on conflict do nothing", [ctx.organisationId, f.id, e.id]);
      return { lu: true, version: f.version };
    }),
  );
}
