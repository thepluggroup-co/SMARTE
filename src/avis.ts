import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { dansOrganisation, publierEvenement } from "./base.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";

const uuid = { type: "string", format: "uuid" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const note = { type: "integer", minimum: 1, maximum: 5 } as const;
const CODE = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{22}$/;

export function enregistrerAvis(app: FastifyInstance, pool: pg.Pool, outils: Outils, urlPublique: string): void {
  const { protege, exigerSurEntite } = outils;

  const session = async (ctx: Contexte, id: string, permission: "formations.voir" | "formations.gerer") => {
    const { rows } = await ctx.client.query("select id, entite_id from sessions_formation where id = $1", [id]);
    if (!rows[0]) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, permission, rows[0].entite_id);
    return rows[0];
  };

  const liens = async (ctx: Contexte, sessionId: string) => {
    const { rows } = await ctx.client.query(
      `select t.nom, t.telephone, d.code, d.repondu_le is not null as repondu
       from demandes_avis d join inscriptions i on i.id = d.inscription_id join tiers t on t.id = i.tiers_id
       where i.session_id = $1 order by t.nom`,
      [sessionId],
    );
    return rows.map(({ code, ...r }) => ({
      ...r, lien: `${urlPublique}/avis.html?c=${ctx.organisationId}.${code}`,
    }));
  };

  /** Crée les liens manquants, sans toucher à ceux déjà partagés. */
  app.post<{ Params: { id: string } }>("/sessions/:id/avis/demandes", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await session(ctx, req.params.id, "formations.gerer");
      const { rows } = await ctx.client.query(
        "select id from inscriptions where session_id = $1 and statut = 'active'", [req.params.id],
      );
      for (const i of rows) {
        await ctx.client.query(
          `insert into demandes_avis (organisation_id, inscription_id, code) values ($1, $2, $3)
           on conflict (organisation_id, inscription_id) do nothing`,
          [ctx.organisationId, i.id, randomBytes(16).toString("base64url")],
        );
      }
      return liens(ctx, req.params.id);
    }),
  );

  app.get<{ Params: { id: string } }>("/sessions/:id/avis/demandes", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await session(ctx, req.params.id, "formations.gerer");
      return liens(ctx, req.params.id);
    }),
  );

  /** Résultats sans aucun nom. Un commentaire masqué garde ses notes : un avis négatif ne disparaît pas des moyennes. */
  app.get<{ Params: { id: string } }>("/sessions/:id/avis", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await session(ctx, req.params.id, "formations.voir");
      const { rows } = await ctx.client.query(
        `select
           (select count(*) from demandes_avis d join inscriptions i on i.id = d.inscription_id where i.session_id = $1)::int as demandes,
           count(*)::int as reponses,
           round(avg(note_globale), 1)::float as globale, round(avg(note_contenu), 1)::float as contenu,
           round(avg(note_formateur), 1)::float as formateur, round(avg(note_organisation), 1)::float as organisation,
           round(100.0 * count(*) filter (where recommande) / nullif(count(*), 0))::int as recommande,
           count(*) filter (where note_globale <= 2)::int as notes_basses
         from avis_formation where session_id = $1`,
        [req.params.id],
      );
      const commentaires = await ctx.client.query(
        `select id, note_globale, commentaire, commentaire_masque, motif_masquage from avis_formation
         where session_id = $1 and commentaire is not null order by random() limit 200`,
        [req.params.id],
      );
      return {
        ...rows[0],
        taux_reponse: rows[0].demandes ? Math.round((rows[0].reponses * 100) / rows[0].demandes) : null,
        commentaires: commentaires.rows.map((c) =>
          c.commentaire_masque ? { ...c, commentaire: null } : c),
      };
    }),
  );

  app.post<{ Params: { id: string }; Body: { masquer: boolean; motif?: string } }>("/avis/:id/moderation", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["masquer"],
        properties: { masquer: { type: "boolean" }, motif: { type: "string", minLength: 5, maxLength: 500 } },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows } = await ctx.client.query(
        `select s.entite_id from avis_formation a join sessions_formation s on s.id = a.session_id where a.id = $1`,
        [req.params.id],
      );
      if (!rows[0]) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "avis.moderer", rows[0].entite_id);
      if (req.body.masquer && !req.body.motif) throw new ErreurApi(400, "motif_obligatoire");
      await ctx.client.query(
        "update avis_formation set commentaire_masque = $2, motif_masquage = $3 where id = $1",
        [req.params.id, req.body.masquer, req.body.masquer ? req.body.motif : null],
      );
      return { masque: req.body.masquer };
    }),
  );

  const lire = (code: string) => {
    if (!CODE.test(code)) return null;
    const [organisationId, secret] = code.split(".") as [string, string];
    return { organisationId, secret };
  };

  const demande = async (c: pg.PoolClient, secret: string, verrou = false) =>
    (await c.query(
      `select d.id, d.repondu_le, i.statut, i.session_id, s.formateur_id, s.ville, s.code as session_code, p.nom as programme
       from demandes_avis d join inscriptions i on i.id = d.inscription_id
       join sessions_formation s on s.id = i.session_id join programmes p on p.id = s.programme_id
       where d.code = $1 ${verrou ? "for update of d" : ""}`,
      [secret],
    )).rows[0];

  /** Public : ne montre que la formation, jamais le nom de l'apprenant. */
  app.get<{ Params: { code: string } }>("/avis-public/:code", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (req, reponse) => {
    const c = lire(req.params.code);
    if (!c) return reponse.status(404).send({ erreur: "introuvable" });
    const d = await dansOrganisation(pool, c.organisationId, (x) => demande(x, c.secret)).catch((e) => {
      if (e.code === "22P02") return undefined;
      throw e;
    });
    if (!d || d.statut !== "active") return reponse.status(404).send({ erreur: "introuvable" });
    return { programme: d.programme, ville: d.ville, repondu: d.repondu_le !== null };
  });

  app.post<{
    Params: { code: string };
    Body: {
      noteGlobale: number; noteContenu: number; noteFormateur: number; noteOrganisation: number;
      recommande: boolean; commentaire?: string;
    };
  }>("/avis-public/:code", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: {
      body: {
        type: "object", required: ["noteGlobale", "noteContenu", "noteFormateur", "noteOrganisation", "recommande"],
        properties: {
          noteGlobale: note, noteContenu: note, noteFormateur: note, noteOrganisation: note,
          recommande: { type: "boolean" }, commentaire: { type: "string", maxLength: 2000 },
        },
      },
    },
  }, async (req, reponse) => {
    const c = lire(req.params.code);
    if (!c) return reponse.status(404).send({ erreur: "introuvable" });
    const b = req.body;
    await dansOrganisation(pool, c.organisationId, async (x) => {
      const d = await demande(x, c.secret, true);
      if (!d || d.statut !== "active") throw new ErreurApi(404, "introuvable");
      if (d.repondu_le) throw new ErreurApi(409, "deja_repondu");
      await x.query(
        `insert into avis_formation (organisation_id, session_id, formateur_id, note_globale, note_contenu,
           note_formateur, note_organisation, recommande, commentaire)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [c.organisationId, d.session_id, d.formateur_id, b.noteGlobale, b.noteContenu, b.noteFormateur,
          b.noteOrganisation, b.recommande, b.commentaire?.trim() || null],
      );
      await x.query("update demandes_avis set repondu_le = date_trunc('day', now()) where id = $1", [d.id]);
      await publierEvenement(x, "avis.recu", { sessionId: d.session_id, note: b.noteGlobale });
    }).catch((e) => {
      if (e.code === "22P02") throw new ErreurApi(404, "introuvable");
      throw e;
    });
    return reponse.status(201).send({ enregistre: true });
  });
}
