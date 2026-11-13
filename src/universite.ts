import { resteScolarite } from "./scolarite.js";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import QRCode from "qrcode";
import { prochainNumero } from "./formations.js";
import { entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";
import { lierTiers } from "./tiers.js";

const uuid = { type: "string", format: "uuid" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max: number) => ({ type: "string", minLength: 1, maxLength: max }) as const;
const annee = { type: "string", pattern: "^[0-9]{4}-[0-9]{4}$" } as const;

export interface LigneNote { ue: string; credits: number; normale: number | null; rattrapage: number | null }

/**
 * La meilleure note de l'UE compte. La moyenne est pondérée par les crédits des UE notées,
 * et une UE n'apporte ses crédits que si elle atteint la note de validation de la filière.
 */
export function calculerResultat(lignes: LigneNote[], noteValidation: number) {
  let points = 0;
  let creditsNotes = 0;
  let creditsAcquis = 0;
  for (const l of lignes) {
    const notes = [l.normale, l.rattrapage].filter((n): n is number => n !== null);
    if (!notes.length) continue;
    const meilleure = Math.max(...notes);
    points += meilleure * l.credits;
    creditsNotes += l.credits;
    if (meilleure >= noteValidation) creditsAcquis += l.credits;
  }
  return { moyenne: creditsNotes ? Math.round((points / creditsNotes) * 100) / 100 : null, creditsAcquis };
}

export function enregistrerUniversite(app: FastifyInstance, outils: Outils, urlPublique: string): void {
  const { protege, exiger, exigerSurEntite } = outils;

  const filiere = async (ctx: Contexte, id: string, p: "universite.voir" | "universite.gerer" | "universite.notes") => {
    const { rows } = await ctx.client.query("select * from filieres where id = $1", [id]);
    if (!rows[0]) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, p, rows[0].entite_id);
    return rows[0];
  };

  app.post<{ Body: { entiteId: string; code: string; nom: string; diplome: string; creditsRequis: number; noteValidation: number } }>("/filieres", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "code", "nom", "diplome", "creditsRequis", "noteValidation"],
        properties: {
          entiteId: uuid, code: texte(30), nom: texte(200), diplome: texte(200),
          creditsRequis: { type: "integer", minimum: 1, maximum: 1000 }, noteValidation: { type: "number", minimum: 0, maximum: 20 },
        },
      },
    },
  }, async (req, reponse) => {
    const f = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "universite.gerer", b.entiteId);
      const { rows } = await ctx.client.query(
        "insert into filieres (organisation_id, entite_id, code, nom, diplome, credits_requis, note_validation) values ($1, $2, $3, $4, $5, $6, $7) returning *",
        [ctx.organisationId, b.entiteId, b.code, b.nom, b.diplome, b.creditsRequis, b.noteValidation],
      );
      return rows[0];
    });
    return reponse.status(201).send(f);
  });

  app.get("/filieres", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "universite.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "universite.voir")).map((e) => e.id);
      return (await ctx.client.query(
        `select f.*, (select count(*) from unites_enseignement u where u.filiere_id = f.id)::int as ues,
           (select count(*) from inscriptions_univ i where i.filiere_id = f.id)::int as inscrits,
           (select count(*) from candidatures_univ c where c.filiere_id = f.id and c.statut = 'soumise')::int as candidatures
         from filieres f where f.entite_id = any($1::uuid[]) order by f.nom`,
        [ids],
      )).rows;
    }),
  );

  app.post<{ Params: { id: string }; Body: { code: string; nom: string; credits: number; semestre: number } }>("/filieres/:id/ues", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["code", "nom", "credits", "semestre"],
        properties: { code: texte(30), nom: texte(200), credits: { type: "integer", minimum: 1, maximum: 100 }, semestre: { type: "integer", minimum: 1, maximum: 20 } },
      },
    },
  }, async (req, reponse) => {
    const u = await protege(req, async (ctx) => {
      const f = await filiere(ctx, req.params.id, "universite.gerer");
      const b = req.body;
      const { rows } = await ctx.client.query(
        "insert into unites_enseignement (organisation_id, filiere_id, code, nom, credits, semestre) values ($1, $2, $3, $4, $5, $6) returning *",
        [ctx.organisationId, f.id, b.code, b.nom, b.credits, b.semestre],
      );
      return rows[0];
    });
    return reponse.status(201).send(u);
  });

  app.get<{ Params: { id: string } }>("/filieres/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const f = await filiere(ctx, req.params.id, "universite.voir");
      const [ues, candidatures, inscrits, delibs] = await Promise.all([
        ctx.client.query("select * from unites_enseignement where filiere_id = $1 order by semestre, code", [f.id]),
        ctx.client.query("select c.*, t.nom from candidatures_univ c join tiers t on t.id = c.tiers_id where c.filiere_id = $1 order by c.cree_le desc", [f.id]),
        ctx.client.query(
          `select i.*, t.nom, exists (select 1 from diplomes d where d.filiere_id = i.filiere_id and d.tiers_id = i.tiers_id) as diplome
           from inscriptions_univ i join tiers t on t.id = i.tiers_id where i.filiere_id = $1 order by i.annee desc, t.nom`,
          [f.id],
        ),
        ctx.client.query("select id, annee, session, president, deliberee_le, resultats from deliberations where filiere_id = $1 order by deliberee_le desc", [f.id]),
      ]);
      return { ...f, ues: ues.rows, candidatures: candidatures.rows, inscrits: inscrits.rows, deliberations: delibs.rows };
    }),
  );

  app.post<{ Params: { id: string }; Body: { tiersId: string; annee: string } }>("/filieres/:id/candidatures", {
    schema: { params: paramId, body: { type: "object", required: ["tiersId", "annee"], properties: { tiersId: uuid, annee } } },
  }, async (req, reponse) => {
    const c = await protege(req, async (ctx) => {
      const f = await filiere(ctx, req.params.id, "universite.gerer");
      await lierTiers(ctx, req.body.tiersId, f.entite_id);
      const { rows } = await ctx.client.query(
        "insert into candidatures_univ (organisation_id, filiere_id, tiers_id, annee) values ($1, $2, $3, $4) returning *",
        [ctx.organisationId, f.id, req.body.tiersId, req.body.annee],
      );
      return rows[0];
    });
    return reponse.status(201).send(c);
  });

  /** Admettre inscrit l'étudiant et lui donne son matricule, une seule fois. */
  app.post<{ Params: { id: string }; Body: { decision: string; motif?: string } }>("/candidatures-univ/:id/decision", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["decision"],
        properties: { decision: { type: "string", enum: ["admise", "refusee"] }, motif: { type: "string", minLength: 3, maxLength: 500 } },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [c] } = await ctx.client.query("select * from candidatures_univ where id = $1 for update", [req.params.id]);
      if (!c) throw new ErreurApi(404, "introuvable");
      await filiere(ctx, c.filiere_id, "universite.gerer");
      if (c.statut !== "soumise") throw new ErreurApi(409, "deja_decide");
      if (req.body.decision === "refusee" && !req.body.motif) throw new ErreurApi(400, "motif_obligatoire");
      await ctx.client.query(
        "update candidatures_univ set statut = $2, motif = $3, decide_par = $4, decide_le = now() where id = $1",
        [c.id, req.body.decision, req.body.motif ?? null, ctx.utilisateurId],
      );
      if (req.body.decision !== "admise") return { statut: "refusee" };
      const matricule = await prochainNumero(ctx.client, `ETU-${c.annee.slice(0, 4)}`);
      const { rows } = await ctx.client.query(
        "insert into inscriptions_univ (organisation_id, filiere_id, tiers_id, annee, matricule) values ($1, $2, $3, $4, $5) returning *",
        [ctx.organisationId, c.filiere_id, c.tiers_id, c.annee, matricule],
      );
      return { statut: "admise", inscription: rows[0] };
    }),
  );

  /** Réinscription d'un étudiant déjà admis, pour une nouvelle année. Le matricule le suit. */
  app.post<{ Params: { id: string }; Body: { annee: string } }>("/inscriptions-univ/:id/reinscription", {
    schema: { params: paramId, body: { type: "object", required: ["annee"], properties: { annee } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const { rows: [i] } = await ctx.client.query("select * from inscriptions_univ where id = $1", [req.params.id]);
      if (!i) throw new ErreurApi(404, "introuvable");
      await filiere(ctx, i.filiere_id, "universite.gerer");
      const matricule = await prochainNumero(ctx.client, `ETU-${req.body.annee.slice(0, 4)}`);
      const { rows } = await ctx.client.query(
        "insert into inscriptions_univ (organisation_id, filiere_id, tiers_id, annee, matricule) values ($1, $2, $3, $4, $5) returning *",
        [ctx.organisationId, i.filiere_id, i.tiers_id, req.body.annee, matricule],
      );
      return rows[0];
    });
    return reponse.status(201).send(r);
  });

  app.put<{ Body: { inscriptionId: string; ueId: string; session: string; note: number } }>("/notes-univ", {
    schema: {
      body: {
        type: "object", required: ["inscriptionId", "ueId", "session", "note"],
        properties: { inscriptionId: uuid, ueId: uuid, session: { type: "string", enum: ["normale", "rattrapage"] }, note: { type: "number", minimum: 0, maximum: 20 } },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const b = req.body;
      const { rows: [i] } = await ctx.client.query(
        `select i.filiere_id, i.annee from inscriptions_univ i join unites_enseignement u on u.filiere_id = i.filiere_id
         where i.id = $1 and u.id = $2`,
        [b.inscriptionId, b.ueId],
      );
      if (!i) throw new ErreurApi(404, "introuvable");
      await filiere(ctx, i.filiere_id, "universite.notes");
      await verrouDeliberation(ctx, i.filiere_id, i.annee);
      const { rows: [d] } = await ctx.client.query(
        "select 1 from deliberations where filiere_id = $1 and annee = $2 and session = $3", [i.filiere_id, i.annee, b.session],
      );
      if (d) throw new ErreurApi(409, "deliberation_figee");
      await ctx.client.query(
        `insert into notes_univ (organisation_id, inscription_id, ue_id, session, note, saisi_par) values ($1, $2, $3, $4, $5, $6)
         on conflict (organisation_id, inscription_id, ue_id, session) do update set note = excluded.note, saisi_par = excluded.saisi_par`,
        [ctx.organisationId, b.inscriptionId, b.ueId, b.session, b.note, ctx.utilisateurId],
      );
      return { note: b.note };
    }),
  );

  /** Saisie et délibération passent par le même verrou : aucune note n'échappe au procès-verbal. */
  const verrouDeliberation = (ctx: Contexte, filiereId: string, a: string) =>
    ctx.client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`delib:${filiereId}:${a}`]);

  /** Tous les relevés d'un étudiant dans la filière : les années précédentes comptent pour le diplôme. */
  const releve = async (ctx: Contexte, filiereId: string, tiersId: string, noteValidation: number, delibereesSeules = false) => {
    const { rows } = await ctx.client.query(
      `select u.id as ue_id, u.code, u.nom, u.credits, u.semestre,
         max(n.note) filter (where n.session = 'normale')::float as normale,
         max(n.note) filter (where n.session = 'rattrapage')::float as rattrapage
       from unites_enseignement u
       left join notes_univ n on n.ue_id = u.id and n.inscription_id in (select id from inscriptions_univ where filiere_id = $1 and tiers_id = $2)
         and (not $3 or exists (select 1 from inscriptions_univ i join deliberations d on d.filiere_id = i.filiere_id and d.annee = i.annee and d.session = n.session where i.id = n.inscription_id))
       where u.filiere_id = $1 group by u.id order by u.semestre, u.code`,
      [filiereId, tiersId, delibereesSeules],
    );
    return { lignes: rows, ...calculerResultat(rows.map((r) => ({ ue: r.code, credits: r.credits, normale: r.normale, rattrapage: r.rattrapage })), noteValidation) };
  };

  app.get<{ Params: { id: string } }>("/inscriptions-univ/:id/releve", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [i] } = await ctx.client.query(
        "select i.*, t.nom from inscriptions_univ i join tiers t on t.id = i.tiers_id where i.id = $1", [req.params.id],
      );
      if (!i) throw new ErreurApi(404, "introuvable");
      const f = await filiere(ctx, i.filiere_id, "universite.voir");
      return { etudiant: i.nom, matricule: i.matricule, annee: i.annee, filiere: f.nom, credits_requis: f.credits_requis, note_validation: Number(f.note_validation), ...(await releve(ctx, f.id, i.tiers_id, Number(f.note_validation))) };
    }),
  );

  /** Fige les notes de la session et conserve le procès-verbal tel qu'il a été arrêté. */
  app.post<{ Params: { id: string }; Body: { annee: string; session: string; president: string } }>("/filieres/:id/deliberations", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["annee", "session", "president"],
        properties: { annee, session: { type: "string", enum: ["normale", "rattrapage"] }, president: { type: "string", minLength: 3, maxLength: 200 } },
      },
    },
  }, async (req, reponse) => {
    const d = await protege(req, async (ctx) => {
      const f = await filiere(ctx, req.params.id, "universite.gerer");
      const b = req.body;
      await verrouDeliberation(ctx, f.id, b.annee);
      const { rows: inscrits } = await ctx.client.query(
        "select i.id, i.matricule, i.tiers_id, t.nom from inscriptions_univ i join tiers t on t.id = i.tiers_id where i.filiere_id = $1 and i.annee = $2 order by t.nom",
        [f.id, b.annee],
      );
      if (!inscrits.length) throw new ErreurApi(409, "aucun_inscrit");
      const resultats = [];
      for (const i of inscrits) {
        const r = await releve(ctx, f.id, i.tiers_id, Number(f.note_validation));
        resultats.push({ inscription_id: i.id, matricule: i.matricule, nom: i.nom, moyenne: r.moyenne, credits_acquis: r.creditsAcquis, lignes: r.lignes });
      }
      const { rows } = await ctx.client.query(
        `insert into deliberations (organisation_id, filiere_id, annee, session, resultats, president, deliberee_par)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [ctx.organisationId, f.id, b.annee, b.session, JSON.stringify(resultats), b.president, ctx.utilisateurId],
      );
      return rows[0];
    });
    return reponse.status(201).send(d);
  });

  /** Un diplôme exige une délibération et le total des crédits, calculé à partir des notes figées. */
  app.post<{ Params: { id: string } }>("/inscriptions-univ/:id/diplome", { schema: { params: paramId } }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const { rows: [i] } = await ctx.client.query(
        "select i.*, t.nom from inscriptions_univ i join tiers t on t.id = i.tiers_id where i.id = $1", [req.params.id],
      );
      if (!i) throw new ErreurApi(404, "introuvable");
      const f = await filiere(ctx, i.filiere_id, "universite.gerer");
      const { rows: [d] } = await ctx.client.query(
        "select 1 from deliberations where filiere_id = $1 and annee = $2 limit 1", [f.id, i.annee],
      );
      if (!d) throw new ErreurApi(409, "deliberation_manquante");
      // Seules comptent les notes passées en délibération.
      const { creditsAcquis } = await releve(ctx, f.id, i.tiers_id, Number(f.note_validation), true);
      const { rows: [{ jour }] } = await ctx.client.query("select (now() at time zone 'Africa/Douala')::date::text as jour");
      const scolarite = await resteScolarite(ctx.client, i.id, jour);
      if (scolarite.reste > 0) throw new ErreurApi(409, "scolarite_impayee", { reste: scolarite.reste });
      if (creditsAcquis < f.credits_requis) throw new ErreurApi(409, "credits_insuffisants", { acquis: creditsAcquis, requis: f.credits_requis });
      const numero = await prochainNumero(ctx.client, `DIP-${new Date().getFullYear()}`);
      const { rows } = await ctx.client.query(
        `insert into diplomes (organisation_id, filiere_id, tiers_id, numero, code_verification, titulaire, programme)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [ctx.organisationId, f.id, i.tiers_id, numero, randomBytes(16).toString("base64url"), i.nom, `${f.diplome} : ${f.nom}`],
      );
      const url = `${urlPublique}/verifier.html?c=${ctx.organisationId}.${rows[0].code_verification}`;
      return { ...rows[0], url_verification: url, qr_svg: await QRCode.toString(url, { type: "svg", margin: 1 }) };
    });
    return reponse.status(201).send(r);
  });
}
