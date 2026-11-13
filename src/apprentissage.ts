import { exigerNonBloque } from "./tiers.js";
import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import QRCode from "qrcode";
import { dansOrganisation, publierEvenement, type Client } from "./base.js";
import { prochainNumero } from "./formations.js";
import { aPermission, entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";
import { lierTiers } from "./tiers.js";

const uuid = { type: "string", format: "uuid" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const CODE = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{22}$/;

interface Question { enonce: string; choix: string[]; bonne: number }

const schemaQuestions = {
  type: "array", maxItems: 100,
  items: {
    type: "object", required: ["enonce", "choix", "bonne"],
    properties: {
      enonce: { type: "string", minLength: 1, maxLength: 1000 },
      choix: { type: "array", minItems: 2, maxItems: 8, items: { type: "string", minLength: 1, maxLength: 500 } },
      bonne: { type: "integer", minimum: 0, maximum: 7 },
    },
  },
} as const;
const schemaLecon = {
  type: "object", required: ["titre"],
  properties: {
    titre: { type: "string", minLength: 1, maxLength: 200 },
    contenu: { type: "string", maxLength: 100000 },
    url: { type: "string", pattern: "^https://", maxLength: 1000 },
    directLe: { type: "string", format: "date-time" },
    directLien: { type: "string", pattern: "^https://", maxLength: 1000 },
    questions: schemaQuestions,
  },
} as const;

/** Un score ne se calcule que sur le serveur : l'apprenant ne reçoit jamais les bonnes réponses. */
export function corriger(questions: Question[], reponses: number[]): number {
  if (!questions.length) return 100;
  const justes = questions.filter((q, i) => reponses[i] === q.bonne).length;
  return Math.round((justes * 100) / questions.length);
}

/** Accepte seulement des vidéos reconnues à leurs premiers octets, quel que soit le nom annoncé. */
export function formatVideo(entete: Buffer): "video/mp4" | "video/webm" | null {
  if (entete.length >= 8 && entete.toString("latin1", 4, 8) === "ftyp") return "video/mp4";
  if (entete.length >= 4 && entete.readUInt32BE(0) === 0x1a45dfa3) return "video/webm";
  return null;
}

export interface OptionsMedias { dossier?: string; maxOctets?: number }

export function enregistrerApprentissage(app: FastifyInstance, pool: pg.Pool, outils: Outils, urlPublique: string, medias: OptionsMedias = {}): void {
  const { protege, exiger, exigerSurEntite } = outils;

  const coursAutorise = async (ctx: Contexte, id: string, p: "apprentissage.voir" | "apprentissage.gerer") => {
    const { rows } = await ctx.client.query("select * from cours where id = $1", [id]);
    if (!rows[0]) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, p, rows[0].entite_id);
    return rows[0];
  };
  const valider = (questions: Question[] = []) => {
    if (questions.some((q) => q.bonne >= q.choix.length)) throw new ErreurApi(400, "donnees_invalides");
  };

  app.post<{ Body: { entiteId: string; titre: string; description?: string; seuilReussite?: number } }>("/cours", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "titre"],
        properties: {
          entiteId: uuid, titre: { type: "string", minLength: 1, maxLength: 200 },
          description: { type: "string", maxLength: 5000 }, seuilReussite: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
    },
  }, async (req, reponse) => {
    const c = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "apprentissage.gerer", b.entiteId);
      const { rows } = await ctx.client.query(
        "insert into cours (organisation_id, entite_id, titre, description, seuil_reussite) values ($1, $2, $3, $4, coalesce($5, 70)) returning *",
        [ctx.organisationId, b.entiteId, b.titre, b.description ?? null, b.seuilReussite ?? null],
      );
      return rows[0];
    });
    return reponse.status(201).send(c);
  });

  app.get("/cours", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "apprentissage.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "apprentissage.voir")).map((e) => e.id);
      const { rows } = await ctx.client.query(
        `select c.*, (select count(*) from lecons l where l.cours_id = c.id)::int as lecons,
           (select count(*) from acces_cours a where a.cours_id = c.id and a.actif)::int as apprenants
         from cours c where c.entite_id = any($1::uuid[]) order by c.cree_le desc limit 300`,
        [ids],
      );
      return rows;
    }),
  );

  /** La liste complète, bonnes réponses comprises, reste réservée à ceux qui gèrent le cours. */
  app.get<{ Params: { id: string } }>("/cours/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const c = await coursAutorise(ctx, req.params.id, "apprentissage.gerer");
      const { rows } = await ctx.client.query("select * from lecons where cours_id = $1 order by ordre", [req.params.id]);
      return { ...c, lecons: rows };
    }),
  );

  app.patch<{ Params: { id: string }; Body: { titre?: string; description?: string; seuilReussite?: number; publie?: boolean } }>("/cours/:id", {
    schema: {
      params: paramId,
      body: {
        type: "object", minProperties: 1,
        properties: {
          titre: { type: "string", minLength: 1, maxLength: 200 }, description: { type: "string", maxLength: 5000 },
          seuilReussite: { type: "integer", minimum: 0, maximum: 100 }, publie: { type: "boolean" },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      await coursAutorise(ctx, req.params.id, "apprentissage.gerer");
      const b = req.body;
      if (b.publie) {
        const n = await ctx.client.query("select count(*)::int as n from lecons where cours_id = $1", [req.params.id]);
        if (n.rows[0].n === 0) throw new ErreurApi(409, "cours_vide");
      }
      const { rows } = await ctx.client.query(
        `update cours set titre = coalesce($2, titre), description = coalesce($3, description),
           seuil_reussite = coalesce($4, seuil_reussite), publie = coalesce($5, publie) where id = $1 returning *`,
        [req.params.id, b.titre ?? null, b.description ?? null, b.seuilReussite ?? null, b.publie ?? null],
      );
      return rows[0];
    }),
  );

  type CorpsLecon = { titre: string; contenu?: string; url?: string; directLe?: string; directLien?: string; questions?: Question[] };
  app.post<{ Params: { id: string }; Body: CorpsLecon }>("/cours/:id/lecons", {
    schema: { params: paramId, body: schemaLecon },
  }, async (req, reponse) => {
    const l = await protege(req, async (ctx) => {
      await coursAutorise(ctx, req.params.id, "apprentissage.gerer");
      const b = req.body;
      valider(b.questions);
      const { rows } = await ctx.client.query(
        `insert into lecons (organisation_id, cours_id, ordre, titre, contenu, url, questions, direct_le, direct_lien)
         values ($1, $2, (select coalesce(max(ordre), 0) + 1 from lecons where cours_id = $2), $3, $4, $5, $6, $7, $8) returning *`,
        [ctx.organisationId, req.params.id, b.titre, b.contenu ?? null, b.url ?? null, JSON.stringify(b.questions ?? []), b.directLe ?? null, b.directLien ?? null],
      );
      return rows[0];
    });
    return reponse.status(201).send(l);
  });

  app.put<{ Params: { id: string }; Body: CorpsLecon }>("/lecons/:id", {
    schema: { params: paramId, body: schemaLecon },
  }, async (req) =>
    protege(req, async (ctx) => {
      const l = await ctx.client.query("select cours_id from lecons where id = $1", [req.params.id]);
      if (!l.rows[0]) throw new ErreurApi(404, "introuvable");
      await coursAutorise(ctx, l.rows[0].cours_id, "apprentissage.gerer");
      const b = req.body;
      valider(b.questions);
      const { rows } = await ctx.client.query(
        "update lecons set titre = $2, contenu = $3, url = $4, questions = $5, direct_le = $6, direct_lien = $7 where id = $1 returning *",
        [req.params.id, b.titre, b.contenu ?? null, b.url ?? null, JSON.stringify(b.questions ?? []), b.directLe ?? null, b.directLien ?? null],
      );
      return rows[0];
    }),
  );

  // Le corps de la requête arrive tel quel : une vidéo n'est jamais gardée en mémoire.
  for (const type of ["video/mp4", "video/webm", "video/quicktime"]) {
    app.addContentTypeParser(type, (_req, corps, fini) => fini(null, corps));
  }
  const maxVideo = medias.maxOctets ?? 2 * 1024 ** 3;

  const leconGeree = async (ctx: Contexte, id: string) => {
    const { rows } = await ctx.client.query("select id, cours_id, video_fichier from lecons where id = $1", [id]);
    if (!rows[0]) throw new ErreurApi(404, "introuvable");
    await coursAutorise(ctx, rows[0].cours_id, "apprentissage.gerer");
    return rows[0];
  };

  /** La transaction n'est ouverte qu'avant et après l'envoi, jamais pendant. */
  app.put<{ Params: { id: string } }>("/lecons/:id/video", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: { params: paramId },
  }, async (req) => {
    await protege(req, (ctx) => leconGeree(ctx, req.params.id));
    if (!medias.dossier) throw new ErreurApi(503, "medias_non_configures");
    if (Number(req.headers["content-length"] ?? 0) > maxVideo) throw new ErreurApi(413, "video_trop_lourde");
    const corps = req.body as NodeJS.ReadableStream | undefined;
    if (!corps || typeof corps.pipe !== "function") throw new ErreurApi(415, "format_video");

    const nom = randomUUID();
    const provisoire = join(medias.dossier, `${nom}.envoi`);
    await mkdir(medias.dossier, { recursive: true });
    let entete = Buffer.alloc(0);
    let taille = 0;
    let trop = false;
    const compteur = new Transform({
      transform(morceau: Buffer, _e, suite) {
        taille += morceau.length;
        if (entete.length < 12) entete = Buffer.concat([entete, morceau]).subarray(0, 12);
        if (taille > maxVideo) { trop = true; suite(new Error("trop lourd")); } else suite(null, morceau);
      },
    });
    try {
      await pipeline(corps, compteur, createWriteStream(provisoire, { flags: "wx" }));
    } catch (e) {
      await rm(provisoire, { force: true });
      if (trop) throw new ErreurApi(413, "video_trop_lourde");
      throw e;
    }
    const type = formatVideo(entete);
    if (!type) {
      await rm(provisoire, { force: true });
      throw new ErreurApi(415, "format_video");
    }
    const fichier = `${nom}.${type === "video/mp4" ? "mp4" : "webm"}`;
    await rename(provisoire, join(medias.dossier, fichier));
    let ancien: string | null = null;
    try {
      await protege(req, async (ctx) => {
        ancien = (await leconGeree(ctx, req.params.id)).video_fichier;
        await ctx.client.query(
          "update lecons set video_fichier = $2, video_type = $3, video_taille = $4 where id = $1",
          [req.params.id, fichier, type, taille],
        );
      });
    } catch (e) {
      await rm(join(medias.dossier, fichier), { force: true });
      throw e;
    }
    if (ancien) await rm(join(medias.dossier, ancien), { force: true });
    return { taille, type };
  });

  app.delete<{ Params: { id: string } }>("/lecons/:id/video", { schema: { params: paramId } }, async (req) => {
    const ancien = await protege(req, async (ctx) => {
      const l = await leconGeree(ctx, req.params.id);
      await ctx.client.query("update lecons set video_fichier = null, video_type = null, video_taille = null where id = $1", [req.params.id]);
      return l.video_fichier as string | null;
    });
    if (ancien && medias.dossier) await rm(join(medias.dossier, ancien), { force: true });
    return { supprime: true };
  });

  const vueCertificat = async (c: Record<string, any>, organisationId: string) => {
    const url = `${urlPublique}/verifier.html?c=${organisationId}.${c.code_verification}`;
    return {
      numero: c.numero, titulaire: c.titulaire, cours: c.cours, delivre_le: c.delivre_le, revoque: !!c.revoque_le,
      url_verification: url, qr_svg: await QRCode.toString(url, { type: "svg", margin: 1 }),
    };
  };

  app.post<{ Params: { id: string }; Body: { motif: string } }>("/acces-cours/:id/certificat/revocation", {
    schema: {
      params: paramId,
      body: { type: "object", required: ["motif"], properties: { motif: { type: "string", minLength: 5, maxLength: 500 } } },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const a = await ctx.client.query("select cours_id from acces_cours where id = $1", [req.params.id]);
      if (!a.rows[0]) throw new ErreurApi(404, "introuvable");
      await coursAutorise(ctx, a.rows[0].cours_id, "apprentissage.gerer");
      await ctx.client.query(
        "update certificats_cours set revoque_le = now(), motif_revocation = $2 where acces_id = $1 and revoque_le is null",
        [req.params.id, req.body.motif],
      );
      return { revoque: true };
    }),
  );

  const lien = (ctx: Contexte, code: string) => `${urlPublique}/cours.html?c=${ctx.organisationId}.${code}`;

  /** Donne un accès personnel par lien, sans compte à créer pour l'apprenant. */
  app.post<{ Params: { id: string }; Body: { tiersId: string } }>("/cours/:id/acces", {
    schema: { params: paramId, body: { type: "object", required: ["tiersId"], properties: { tiersId: uuid } } },
  }, async (req, reponse) => {
    const a = await protege(req, async (ctx) => {
      const c = await coursAutorise(ctx, req.params.id, "apprentissage.gerer");
      await lierTiers(ctx, req.body.tiersId, c.entite_id);
      const { rows } = await ctx.client.query(
        `insert into acces_cours (organisation_id, cours_id, tiers_id, code) values ($1, $2, $3, $4)
         on conflict (organisation_id, cours_id, tiers_id) do update set actif = true returning id, code`,
        [ctx.organisationId, req.params.id, req.body.tiersId, randomBytes(16).toString("base64url")],
      );
      await ctx.client.query(
        "update tiers set roles = array_append(roles, 'apprenant') where id = $1 and not ('apprenant' = any(roles))", [req.body.tiersId],
      );
      return { id: rows[0].id, lien: lien(ctx, rows[0].code) };
    });
    return reponse.status(201).send(a);
  });

  app.post<{ Params: { id: string } }>("/acces-cours/:id/retrait", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const a = await ctx.client.query("select cours_id from acces_cours where id = $1", [req.params.id]);
      if (!a.rows[0]) throw new ErreurApi(404, "introuvable");
      await coursAutorise(ctx, a.rows[0].cours_id, "apprentissage.gerer");
      await ctx.client.query("update acces_cours set actif = false where id = $1", [req.params.id]);
      return { actif: false };
    }),
  );

  app.get<{ Params: { id: string } }>("/cours/:id/suivi", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await coursAutorise(ctx, req.params.id, "apprentissage.voir");
      const peutLier = await aPermission(ctx.client, ctx.utilisateurId, "apprentissage.gerer");
      const { rows } = await ctx.client.query(
        `select a.id, a.code, a.actif, a.derniere_activite, a.termine_le, t.nom, t.telephone,
           (select numero from certificats_cours cc where cc.acces_id = a.id and cc.revoque_le is null) as certificat,
           (select count(*) from lecons l where l.cours_id = a.cours_id)::int as total,
           (select count(*) from progressions p where p.acces_id = a.id and p.terminee_le is not null)::int as terminees,
           (select round(avg(p.score))::int from progressions p join lecons l on l.id = p.lecon_id
             where p.acces_id = a.id and p.score is not null and jsonb_array_length(l.questions) > 0) as score_moyen
         from acces_cours a join tiers t on t.id = a.tiers_id where a.cours_id = $1 order by t.nom`,
        [req.params.id],
      );
      return rows.map(({ code, ...a }) => ({
        ...a, progression: a.total ? Math.round((a.terminees * 100) / a.total) : 0,
        ...(peutLier ? { lien: lien(ctx, code) } : {}),
      }));
    }),
  );

  const decoder = (code: string) => {
    if (!CODE.test(code)) return null;
    const [organisationId, secret] = code.split(".") as [string, string];
    return { organisationId, secret };
  };

  const accesPublic = async (c: Client, secret: string, verrou = false) => {
    const { rows } = await c.query(
      `select a.id, a.cours_id, a.tiers_id, a.termine_le, cr.titre, cr.description, cr.seuil_reussite, cr.certificat_auto
       from acces_cours a join cours cr on cr.id = a.cours_id
       where a.code = $1 and a.actif and cr.publie ${verrou ? "for update of a" : ""}`,
      [secret],
    );
    return rows[0];
  };

  const dansAcces = async <T>(code: string, fn: (c: Client, a: Record<string, any>, organisationId: string) => Promise<T>): Promise<T> => {
    const d = decoder(code);
    if (!d) throw new ErreurApi(404, "introuvable");
    return dansOrganisation(pool, d.organisationId, async (c) => {
      const a = await accesPublic(c, d.secret, true);
      if (!a) throw new ErreurApi(404, "introuvable");
      await exigerNonBloque(c, a.tiers_id, "cours");
      return fn(c, a, d.organisationId);
    }).catch((e) => {
      if (e.code === "22P02") throw new ErreurApi(404, "introuvable");
      throw e;
    });
  };

  /** Une leçon s'ouvre quand la précédente est terminée. Le contenu des suivantes n'est pas envoyé. */
  app.get<{ Params: { code: string } }>("/apprendre/:code", {
    config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
  }, async (req) =>
    dansAcces(req.params.code, async (c, a, organisationId) => {
      const { rows: [cert] } = await c.query("select * from certificats_cours where acces_id = $1 and revoque_le is null", [a.id]);
      await c.query("update acces_cours set derniere_activite = now() where id = $1", [a.id]);
      const { rows } = await c.query(
        `select l.id, l.ordre, l.titre, l.contenu, l.url, l.questions, l.video_fichier, l.direct_le, l.direct_lien,
           p.terminee_le, p.score, coalesce(p.tentatives, 0) as tentatives
         from lecons l left join progressions p on p.lecon_id = l.id and p.acces_id = $2
         where l.cours_id = $1 order by l.ordre`,
        [a.cours_id, a.id],
      );
      let ouverte = true;
      const lecons = rows.map((l) => {
        const v = {
          id: l.id, titre: l.titre, terminee: !!l.terminee_le, score: l.score, tentatives: l.tentatives, ouverte,
          ...(ouverte ? {
            contenu: l.contenu, url: l.url, video: !!l.video_fichier, direct_le: l.direct_le, direct_lien: l.direct_lien,
            questions: (l.questions as Question[]).map((q) => ({ enonce: q.enonce, choix: q.choix })),
          } : {}),
        };
        ouverte = ouverte && !!l.terminee_le;
        return v;
      });
      return {
        titre: a.titre, description: a.description, seuil: a.seuil_reussite, termine: !!a.termine_le,
        certificat: cert ? await vueCertificat(cert, organisationId) : null,
        progression: lecons.length ? Math.round((lecons.filter((l) => l.terminee).length * 100) / lecons.length) : 0, lecons,
      };
    }),
  );

  app.post<{ Params: { code: string; leconId: string }; Body: { reponses?: number[] } }>("/apprendre/:code/lecons/:leconId", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    schema: {
      params: { type: "object", required: ["code", "leconId"], properties: { code: { type: "string", maxLength: 100 }, leconId: uuid } },
      body: { type: "object", properties: { reponses: { type: "array", maxItems: 100, items: { type: "integer", minimum: 0, maximum: 7 } } } },
    },
  }, async (req) =>
    dansAcces(req.params.code, async (c, a, organisationId) => {
      const { rows: lecons } = await c.query(
        `select l.id, l.questions, p.terminee_le from lecons l left join progressions p on p.lecon_id = l.id and p.acces_id = $2
         where l.cours_id = $1 order by l.ordre`,
        [a.cours_id, a.id],
      );
      const rang = lecons.findIndex((l) => l.id === req.params.leconId);
      if (rang < 0) throw new ErreurApi(404, "introuvable");
      if (lecons.slice(0, rang).some((l) => !l.terminee_le)) throw new ErreurApi(409, "lecon_verrouillee");
      const questions = lecons[rang].questions as Question[];
      const score = corriger(questions, req.body.reponses ?? []);
      const reussi = !questions.length || score >= a.seuil_reussite;
      await c.query(
        `insert into progressions (organisation_id, acces_id, lecon_id, score, tentatives, terminee_le)
         values ($1, $2, $3, $4, 1, case when $5 then now() end)
         on conflict (organisation_id, acces_id, lecon_id) do update set
           score = greatest(progressions.score, excluded.score), tentatives = progressions.tentatives + 1,
           terminee_le = coalesce(progressions.terminee_le, excluded.terminee_le)`,
        [organisationId, a.id, req.params.leconId, questions.length ? score : null, reussi],
      );
      const { rows: [n] } = await c.query(
        `select count(*) filter (where p.terminee_le is null)::int as restantes
         from lecons l left join progressions p on p.lecon_id = l.id and p.acces_id = $2 where l.cours_id = $1`,
        [a.cours_id, a.id],
      );
      if (n.restantes === 0 && !a.termine_le) {
        await c.query("update acces_cours set termine_le = now() where id = $1", [a.id]);
        await publierEvenement(c, "cours.termine", { accesId: a.id, coursId: a.cours_id });
        if (a.certificat_auto) {
          const numero = await prochainNumero(c, `CERTC-${new Date().getFullYear()}`);
          await c.query(
            `insert into certificats_cours (organisation_id, acces_id, numero, code_verification, titulaire, cours)
             select $1, $2, $3, $4, t.nom, $5 from tiers t where t.id = $6 on conflict (organisation_id, acces_id) do nothing`,
            [organisationId, a.id, numero, randomBytes(16).toString("base64url"), a.titre, a.tiers_id],
          );
          await publierEvenement(c, "certificat_cours.delivre", { accesId: a.id });
        }
      }
      return { score: questions.length ? score : null, reussi, seuil: a.seuil_reussite, cours_termine: n.restantes === 0 };
    }),
  );

  /** La vidéo suit les mêmes règles que le contenu : accès actif, cours publié et leçon ouverte. */
  app.get<{ Params: { code: string; leconId: string } }>("/apprendre/:code/lecons/:leconId/video", {
    config: { rateLimit: { max: 600, timeWindow: "1 minute" } },
    schema: { params: { type: "object", required: ["code", "leconId"], properties: { code: { type: "string", maxLength: 100 }, leconId: uuid } } },
  }, async (req, reponse) => {
    if (!medias.dossier) throw new ErreurApi(404, "introuvable");
    const v = await dansAcces(req.params.code, async (c, a) => {
      const { rows } = await c.query(
        `select l.id, l.video_fichier, l.video_type, p.terminee_le from lecons l
         left join progressions p on p.lecon_id = l.id and p.acces_id = $2 where l.cours_id = $1 order by l.ordre`,
        [a.cours_id, a.id],
      );
      const rang = rows.findIndex((l) => l.id === req.params.leconId);
      if (rang < 0 || !rows[rang].video_fichier || rows.slice(0, rang).some((l) => !l.terminee_le)) throw new ErreurApi(404, "introuvable");
      return rows[rang];
    });
    const chemin = join(medias.dossier, v.video_fichier);
    const { size } = await stat(chemin).catch(() => { throw new ErreurApi(404, "introuvable"); });
    reponse.header("accept-ranges", "bytes").header("content-type", v.video_type).header("cache-control", "private, no-store");
    const plage = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (plage && (plage[1] || plage[2])) {
      const debut = plage[1] ? Number(plage[1]) : Math.max(size - Number(plage[2]), 0);
      const fin = plage[1] && plage[2] ? Math.min(Number(plage[2]), size - 1) : size - 1;
      if (debut >= size || fin < debut) return reponse.status(416).header("content-range", `bytes */${size}`).send();
      return reponse.status(206).header("content-range", `bytes ${debut}-${fin}/${size}`).header("content-length", fin - debut + 1)
        .send(createReadStream(chemin, { start: debut, end: fin }));
    }
    return reponse.header("content-length", size).send(createReadStream(chemin));
  });
}
