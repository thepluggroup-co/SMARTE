import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { dansOrganisation, publierEvenement } from "./base.js";
import { normaliserTelephone } from "./securite.js";
import { ErreurApi, type Outils } from "./serveur.js";
import { entitesAccessibles } from "./permissions.js";

const uuid = { type: "string", format: "uuid" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max = 200) => ({ type: "string", minLength: 1, maxLength: max }) as const;
const CODE = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{20,}$/;

/** Des règles fixes et lisibles : chaque point est expliqué, sans intelligence artificielle. */
export function scoreProspect(p: { telephone?: string | null; email?: string | null; montant: number; etape: string; activites30: number; joursSansContact: number | null }) {
  const raisons: { texte: string; points: number }[] = [];
  const point = (t: string, n: number) => { if (n) raisons.push({ texte: t, points: n }); };
  point("Téléphone connu", p.telephone ? 10 : 0);
  point("Email connu", p.email ? 5 : 0);
  point("Montant estimé", p.montant >= 500_000 ? 20 : p.montant > 0 ? 10 : 0);
  point("Avancement", ({ contacte: 10, qualifie: 20, proposition: 30 } as Record<string, number>)[p.etape] ?? 0);
  point("Échanges récents", Math.min(p.activites30 * 5, 15));
  point("Dernier contact", p.joursSansContact === null ? 0 : p.joursSansContact <= 7 ? 20 : p.joursSansContact <= 30 ? 10 : 0);
  return { score: raisons.reduce((s, r) => s + r.points, 0), raisons };
}

export function enregistrerProspection(app: FastifyInstance, pool: pg.Pool, outils: Outils): void {
  const { protege, exiger, exigerSurEntite } = outils;

  app.post<{ Body: { entiteId: string; titre: string; introduction?: string; source: string } }>("/formulaires-capture", {
    schema: { body: { type: "object", required: ["entiteId", "titre", "source"], properties: { entiteId: uuid, titre: texte(), introduction: texte(1000), source: texte(100) } } },
  }, async (req, reponse) => {
    const f = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "crm.gerer", b.entiteId);
      const { rows } = await ctx.client.query(
        "insert into formulaires_capture (organisation_id, entite_id, titre, introduction, source, code, responsable_id) values ($1, $2, $3, $4, $5, $6, $7) returning *",
        [ctx.organisationId, b.entiteId, b.titre, b.introduction ?? null, b.source, randomBytes(24).toString("base64url"), ctx.utilisateurId],
      );
      return rows[0];
    });
    return reponse.status(201).send({ ...f, lien: `/capture.html?c=${f.organisation_id}.${f.code}` });
  });
  app.get("/formulaires-capture", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "crm.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "crm.voir")).map((e) => e.id);
      const { rows } = await ctx.client.query(
        "select f.id, f.titre, f.source, f.actif, f.organisation_id, f.code, e.nom as entite, (select count(*)::int from captures c where c.formulaire_id = f.id) as reponses from formulaires_capture f join entites e on e.id = f.entite_id where f.entite_id = any($1::uuid[]) order by f.cree_le desc", [ids],
      );
      return rows.map(({ organisation_id, code, ...f }) => ({ ...f, lien: `/capture.html?c=${organisation_id}.${code}` }));
    }),
  );
  app.post<{ Params: { id: string } }>("/formulaires-capture/:id/arret", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [f] } = await ctx.client.query("select entite_id from formulaires_capture where id = $1", [req.params.id]);
      if (!f) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "crm.gerer", f.entite_id);
      await ctx.client.query("update formulaires_capture set actif = false where id = $1", [req.params.id]);
      return { actif: false };
    }),
  );

  const dansCode = <T>(code: string, fn: (c: pg.PoolClient, f: Record<string, any>) => Promise<T>) => {
    if (!CODE.test(code)) throw new ErreurApi(404, "introuvable");
    const [org, secret] = code.split(".") as [string, string];
    return dansOrganisation(pool, org, async (c) => {
      const { rows: [f] } = await c.query("select f.*, entite_branche(f.entite_id) as branche_id from formulaires_capture f where f.code = $1 and f.actif", [secret]);
      if (!f) throw new ErreurApi(404, "introuvable");
      return fn(c as pg.PoolClient, f);
    }).catch((e) => { if (e.code === "22P02") throw new ErreurApi(404, "introuvable"); throw e; });
  };
  app.get<{ Params: { code: string } }>("/capture/:code", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) =>
    dansCode(req.params.code, async (_c, f) => ({ titre: f.titre, introduction: f.introduction })),
  );
  /** Le visiteur reçoit la même réponse que sa fiche existe ou non : rien ne révèle qui est déjà client. */
  app.post<{ Params: { code: string }; Body: { nom: string; telephone?: string; email?: string; message?: string; consentement: boolean; site?: string } }>("/capture/:code", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: { body: { type: "object", required: ["nom", "consentement"], properties: { nom: texte(), telephone: { type: "string", maxLength: 30 }, email: { type: "string", format: "email", maxLength: 320 }, message: { type: "string", maxLength: 2000 }, consentement: { type: "boolean" }, site: { type: "string", maxLength: 200 } } } },
  }, async (req, reponse) => {
    const b = req.body;
    if (b.site) return reponse.status(201).send({ recu: true });
    if (b.consentement !== true) throw new ErreurApi(400, "consentement_obligatoire");
    const tel = b.telephone?.trim() ? normaliserTelephone(b.telephone) : null;
    const email = b.email?.trim().toLowerCase() || null;
    if (!tel && !email) throw new ErreurApi(400, "contact_obligatoire");
    if (tel && !/^[0-9]{8,15}$/.test(tel)) throw new ErreurApi(400, "telephone_invalide");
    await dansCode(req.params.code, async (c, f) => {
      const org = f.organisation_id as string;
      const { rows: [existe] } = await c.query(
        "select id from tiers where branche_id = $1 and not archive and ((telephone is not null and telephone = $2) or (email is not null and email = $3)) order by cree_le limit 1", [f.branche_id, tel, email],
      );
      const tiers = existe?.id ?? (await c.query(
        "insert into tiers (organisation_id, type, nom, email, telephone, roles, entite_origine_id, branche_id) values ($1, 'personne', $2, $3, $4, '{prospect}', $5, $6) returning id",
        [org, b.nom.trim(), email, tel, f.entite_id, f.branche_id],
      )).rows[0].id;
      await c.query("insert into captures (organisation_id, formulaire_id, tiers_id) values ($1, $2, $3)", [org, f.id, tiers]);
      const { rows: [o] } = await c.query(
        "insert into opportunites (organisation_id, entite_id, tiers_id, titre, source, responsable_id) values ($1, $2, $3, $4, $5, $6) returning id",
        [org, f.entite_id, tiers, `${f.titre} : ${b.nom.trim()}`.slice(0, 200), f.source, f.responsable_id],
      );
      if (b.message?.trim()) {
        await c.query("insert into activites (organisation_id, entite_id, tiers_id, opportunite_id, type, contenu, auteur_id) values ($1, $2, $3, $4, 'note', $5, $6)", [org, f.entite_id, tiers, o.id, b.message.trim(), f.responsable_id]);
      }
      await publierEvenement(c, "prospect.capte", { opportunite: o.id, source: f.source, tiers });
    });
    return reponse.status(201).send({ recu: true });
  });

  app.get("/prospects/classement", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "crm.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "crm.voir")).map((e) => e.id);
      const { rows } = await ctx.client.query(
        `select o.id, o.titre, o.etape, o.montant_estime::int8 as montant, o.source, t.nom, t.telephone, t.email, e.nom as entite,
           (select count(*)::int from activites a where a.opportunite_id = o.id and a.cree_le > now() - interval '30 days') as activites30,
           (select extract(day from now() - max(a.cree_le))::int from activites a where a.opportunite_id = o.id) as jours
         from opportunites o join tiers t on t.id = o.tiers_id join entites e on e.id = o.entite_id
         where o.etape not in ('gagne', 'perdu') and o.entite_id = any($1::uuid[]) limit 500`, [ids],
      );
      return rows.map((o) => ({ ...o, ...scoreProspect({ telephone: o.telephone, email: o.email, montant: Number(o.montant), etape: o.etape, activites30: o.activites30, joursSansContact: o.jours }) })).sort((a, b) => b.score - a.score);
    }),
  );

  // Segments : recalculés à chaque ouverture.
  const criteres = { type: "object", additionalProperties: false, properties: { role: { type: "string", enum: ["prospect", "client", "apprenant", "etudiant", "enseignant", "fournisseur", "affilie", "franchise", "partenaire", "employe", "transitaire"] }, langue: { type: "string", enum: ["fr", "en"] }, inactifJours: { type: "integer", minimum: 1, maximum: 3650 }, achatMin: { type: "integer", minimum: 1 } } } as const;
  app.post<{ Body: { brancheId: string; nom: string; criteres: Record<string, unknown> } }>("/segments", {
    schema: { body: { type: "object", required: ["brancheId", "nom", "criteres"], properties: { brancheId: uuid, nom: texte(100), criteres } } },
  }, async (req, reponse) => {
    const s = await protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "crm.gerer", req.body.brancheId);
      return (await ctx.client.query("insert into segments (organisation_id, branche_id, nom, criteres) values ($1, $2, $3, $4) returning *", [ctx.organisationId, req.body.brancheId, req.body.nom, JSON.stringify(req.body.criteres)])).rows[0];
    });
    return reponse.status(201).send(s);
  });
  app.get("/segments", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "crm.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "crm.voir")).map((e) => e.id);
      return (await ctx.client.query("select s.*, e.nom as branche from segments s join entites e on e.id = s.branche_id where s.branche_id = any($1::uuid[]) order by s.nom", [ids])).rows;
    }),
  );
  app.get<{ Params: { id: string } }>("/segments/:id/membres", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [s] } = await ctx.client.query("select * from segments where id = $1", [req.params.id]);
      if (!s) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "crm.voir", s.branche_id);
      const c = s.criteres as { role?: string; langue?: string; inactifJours?: number; achatMin?: number };
      const { rows } = await ctx.client.query(
        `with m as (
           select t.id, t.nom, t.telephone, t.email, t.langue, t.roles,
             (select coalesce(sum(d.total_ttc), 0) from documents_vente d where d.tiers_id = t.id and d.type = 'facture' and d.statut = 'emis')::int8
               + (select coalesce(sum(v.total_ttc), 0) from ventes_comptoir v where v.tiers_id = t.id and v.annulee_le is null)::int8 as achats,
             greatest((select max(d.cree_le) from documents_vente d where d.tiers_id = t.id and d.statut = 'emis'), (select max(v.cree_le) from ventes_comptoir v where v.tiers_id = t.id and v.annulee_le is null), (select max(a.cree_le) from activites a where a.tiers_id = t.id)) as dernier
           from tiers t where t.branche_id = $1 and not t.archive
         )
         select * from m where ($2::text is null or $2 = any(roles)) and ($3::text is null or langue = $3)
           and ($4::int is null or dernier is null or dernier < now() - make_interval(days => $4)) and ($5::bigint is null or achats >= $5) order by achats desc, nom limit 1000`,
        [s.branche_id, c.role ?? null, c.langue ?? null, c.inactifJours ?? null, c.achatMin ?? null],
      );
      return { segment: s.nom, membres: rows };
    }),
  );
  app.delete<{ Params: { id: string } }>("/segments/:id", { schema: { params: paramId } }, async (req, reponse) => {
    await protege(req, async (ctx) => {
      const { rows: [s] } = await ctx.client.query("select branche_id from segments where id = $1", [req.params.id]);
      if (!s) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "crm.gerer", s.branche_id);
      await ctx.client.query("delete from segments where id = $1", [req.params.id]);
    });
    return reponse.status(204).send();
  });
}
