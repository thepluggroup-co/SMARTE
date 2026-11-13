import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Permission } from "./catalogue.js";
import { aPermission, entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";
import { exigerTiersVisible } from "./tiers.js";

const uuid = { type: "string", format: "uuid" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max = 200) => ({ type: "string", minLength: 1, maxLength: max }) as const;
const MAX = 20 * 1024 ** 2;
const TYPES = ["application/pdf", "image/png", "image/jpeg", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
const EXT: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", [TYPES[3]!]: "docx", [TYPES[4]!]: "xlsx" };

/** Le type vient du contenu du fichier, jamais de ce que le navigateur annonce. */
export function typeFichier(entete: Buffer, annonce: string): string | null {
  if (entete.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (entete.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (entete[0] === 0xff && entete[1] === 0xd8 && entete[2] === 0xff) return "image/jpeg";
  if (entete.subarray(0, 4).toString("latin1") === "PK\u0003\u0004" && (annonce === TYPES[3] || annonce === TYPES[4])) return annonce;
  return null;
}
export function ajouterFormatsDocuments(app: FastifyInstance): void {
  for (const t of TYPES) app.addContentTypeParser(t, (_r, corps, fini) => fini(null, corps));
}
export interface Stocke { fichier: string; type_mime: string; taille: number; empreinte: string }
export async function stockerFichier(req: FastifyRequest, dossier: string | undefined, max = MAX): Promise<Stocke> {
  if (!dossier) throw new ErreurApi(503, "medias_non_configures");
  const corps = req.body as NodeJS.ReadableStream | undefined;
  if (!corps || typeof corps.pipe !== "function") throw new ErreurApi(415, "format_document");
  if (Number(req.headers["content-length"] ?? 0) > max) throw new ErreurApi(413, "document_trop_lourd");
  const base = join(dossier, "documents");
  await mkdir(base, { recursive: true });
  const nom = randomUUID();
  const provisoire = join(base, `${nom}.envoi`);
  const h = createHash("sha256");
  let entete = Buffer.alloc(0), taille = 0, trop = false;
  const suivi = new Transform({ transform(m: Buffer, _e, suite) {
    taille += m.length;
    if (entete.length < 8) entete = Buffer.concat([entete, m]).subarray(0, 8);
    h.update(m);
    if (taille > max) { trop = true; suite(new Error("trop lourd")); } else suite(null, m);
  } });
  try {
    await pipeline(corps, suivi, createWriteStream(provisoire, { flags: "wx" }));
  } catch (e) {
    await rm(provisoire, { force: true });
    if (trop) throw new ErreurApi(413, "document_trop_lourd");
    throw e;
  }
  const type = typeFichier(entete, String(req.headers["content-type"] ?? "").split(";")[0]!);
  if (!type) { await rm(provisoire, { force: true }); throw new ErreurApi(415, "format_document"); }
  const fichier = `documents/${nom}.${EXT[type]}`;
  await rename(provisoire, join(dossier, fichier));
  return { fichier, type_mime: type, taille, empreinte: h.digest("hex") };
}

export const DROIT_VOIR: Record<string, Permission> = { general: "documents.voir", contrat: "documents.voir", rh: "rh.voir", compta: "compta.voir" };
const DROIT_GERER: Record<string, Permission> = { general: "documents.gerer", contrat: "documents.gerer", rh: "rh.gerer", compta: "compta.saisir" };

export function enregistrerDocuments(app: FastifyInstance, outils: Outils, dossier?: string): void {
  const { protege, exiger, exigerSurEntite } = outils;
  ajouterFormatsDocuments(app);

  app.put<{ Querystring: { entiteId: string; titre: string; categorie: string; tiersId?: string; remplace?: string } }>("/documents", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    schema: { querystring: { type: "object", required: ["entiteId", "titre", "categorie"], properties: { entiteId: uuid, titre: texte(), categorie: { type: "string", enum: Object.keys(DROIT_VOIR) }, tiersId: uuid, remplace: uuid } } },
  }, async (req, reponse) => {
    const q = req.query;
    const preparer = async (ctx: Contexte) => {
      await exigerSurEntite(ctx, DROIT_GERER[q.categorie]!, q.entiteId);
      if (q.tiersId) await exigerTiersVisible(ctx, q.tiersId, DROIT_GERER[q.categorie]!);
      if (!q.remplace) return { groupe: randomUUID(), version: 1 };
      const { rows: [o] } = await ctx.client.query("select groupe_id, entite_id, categorie from documents_ged where id = $1", [q.remplace]);
      if (!o || o.entite_id !== q.entiteId || o.categorie !== q.categorie) throw new ErreurApi(404, "introuvable");
      return { groupe: o.groupe_id as string, version: 0 };
    };
    await protege(req, preparer);
    const s = await stockerFichier(req, dossier);
    try {
      const d = await protege(req, async (ctx) => {
        const p = await preparer(ctx);
        const { rows } = await ctx.client.query(
          `insert into documents_ged (organisation_id, entite_id, groupe_id, version, titre, categorie, tiers_id, fichier, type_mime, taille, empreinte, auteur_id)
           values ($1, $2, $3, (select coalesce(max(version), 0) + 1 from documents_ged where groupe_id = $3), $4, $5, $6, $7, $8, $9, $10, $11) returning id, groupe_id, version, titre, categorie, taille, empreinte`,
          [ctx.organisationId, q.entiteId, p.groupe, q.titre, q.categorie, q.tiersId ?? null, s.fichier, s.type_mime, s.taille, s.empreinte, ctx.utilisateurId],
        );
        return rows[0];
      });
      return reponse.status(201).send(d);
    } catch (e) {
      await rm(join(dossier!, s.fichier), { force: true });
      throw e;
    }
  });

  /** Dernière version de chaque document, dans les seules catégories et entités autorisées. */
  app.get<{ Querystring: { q?: string; archives?: boolean } }>("/documents", {
    schema: { querystring: { type: "object", properties: { q: { type: "string", maxLength: 100 }, archives: { type: "boolean" } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const acces: Record<string, string[]> = {};
      for (const [c, p] of Object.entries(DROIT_VOIR)) acces[c] = (await entitesAccessibles(ctx.client, ctx.utilisateurId, p)).map((e) => e.id as string);
      const motif = `%${(req.query.q ?? "").replace(/[\\%_]/g, "\\$&")}%`;
      const { rows } = await ctx.client.query(
        `select * from (select distinct on (d.groupe_id) d.id, d.groupe_id, d.version, d.titre, d.categorie, d.taille, d.type_mime, d.archive_le, d.cree_le, d.entite_id, e.nom as entite, t.nom as tiers, u.nom as auteur
           from documents_ged d join entites e on e.id = d.entite_id left join tiers t on t.id = d.tiers_id join utilisateurs u on u.id = d.auteur_id
           where d.titre ilike $1 and ((d.categorie in ('general', 'contrat') and d.entite_id = any($2::uuid[])) or (d.categorie = 'rh' and d.entite_id = any($3::uuid[])) or (d.categorie = 'compta' and d.entite_id = any($4::uuid[])))
           order by d.groupe_id, d.version desc) x where (x.archive_le is null) = $5 order by x.cree_le desc limit 300`,
        [motif, acces.general, acces.rh, acces.compta, !req.query.archives],
      );
      return rows;
    }),
  );
  const lire = async (ctx: Contexte, id: string) => {
    const { rows: [d] } = await ctx.client.query("select * from documents_ged where id = $1", [id]);
    if (!d) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, DROIT_VOIR[d.categorie]!, d.entite_id);
    return d;
  };
  app.get<{ Params: { id: string } }>("/documents/:id/versions", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const d = await lire(ctx, req.params.id);
      return (await ctx.client.query("select d.id, d.version, d.taille, d.empreinte, d.cree_le, u.nom as auteur from documents_ged d join utilisateurs u on u.id = d.auteur_id where d.groupe_id = $1 order by d.version desc", [d.groupe_id])).rows;
    }),
  );
  app.get<{ Params: { id: string } }>("/documents/:id/fichier", { schema: { params: paramId } }, async (req, reponse) => {
    const d = await protege(req, async (ctx) => {
      const x = await lire(ctx, req.params.id);
      if (x.categorie === "rh" || x.categorie === "compta") await ctx.client.query("select journal_evenement('document.telecharge', $1)", [JSON.stringify({ document: x.id })]);
      return x;
    });
    if (!dossier) throw new ErreurApi(503, "medias_non_configures");
    const nom = `${d.titre.replace(/[^\p{L}\p{N} ]/gu, " ").trim() || "Document"}.${EXT[d.type_mime]}`;
    return reponse.header("content-type", d.type_mime).header("content-length", d.taille).header("x-content-type-options", "nosniff")
      .header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(nom)}`).send(createReadStream(join(dossier, d.fichier)));
  });
  /** Rien ne s'efface : un document archivé reste consultable, pour la conservation légale. */
  app.post<{ Params: { id: string }; Body: { motif: string } }>("/documents/:id/archivage", {
    schema: { params: paramId, body: { type: "object", required: ["motif"], properties: { motif: { type: "string", minLength: 5, maxLength: 500 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const d = await lire(ctx, req.params.id);
      await exigerSurEntite(ctx, DROIT_GERER[d.categorie]!, d.entite_id);
      await ctx.client.query("update documents_ged set archive_le = now(), motif_archive = $2 where groupe_id = $1 and archive_le is null", [d.groupe_id, req.body.motif]);
      return { archive: true };
    }),
  );

  /** Trace interne : qui a approuvé quel contenu, et quand. Ce n'est pas une signature électronique qualifiée. */
  app.post<{ Params: { id: string }; Body: { mention: string } }>("/documents/:id/signature", {
    schema: { params: paramId, body: { type: "object", required: ["mention"], properties: { mention: texte(200) } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const d = await lire(ctx, req.params.id);
      const { rows: [s] } = await ctx.client.query(
        "insert into signatures_document (organisation_id, document_id, signataire_id, empreinte, mention) values ($1, $2, $3, $4, $5) on conflict do nothing returning id, signe_le, empreinte",
        [ctx.organisationId, d.id, ctx.utilisateurId, d.empreinte, req.body.mention],
      );
      if (!s) throw new ErreurApi(409, "deja_signe");
      return s;
    });
    return reponse.status(201).send(r);
  });
  app.get<{ Params: { id: string } }>("/documents/:id/signatures", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await lire(ctx, req.params.id);
      return (await ctx.client.query("select s.signe_le, s.mention, s.empreinte, u.nom from signatures_document s join utilisateurs u on u.id = s.signataire_id where s.document_id = $1 order by s.signe_le", [req.params.id])).rows;
    }),
  );

  // Agenda et ressources
  app.post<{ Body: { entiteId: string; nom: string; type: string; capacite?: number } }>("/ressources", {
    schema: { body: { type: "object", required: ["entiteId", "nom", "type"], properties: { entiteId: uuid, nom: texte(), type: { type: "string", enum: ["salle", "vehicule", "equipement", "formateur"] }, capacite: { type: "integer", minimum: 1, maximum: 100000 } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "agenda.gerer", b.entiteId);
      return (await ctx.client.query("insert into ressources (organisation_id, entite_id, nom, type, capacite) values ($1, $2, $3, $4, $5) returning *", [ctx.organisationId, b.entiteId, b.nom, b.type, b.capacite ?? null])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get<{ Querystring: { debut: string; fin: string } }>("/agenda", {
    schema: { querystring: { type: "object", required: ["debut", "fin"], properties: { debut: { type: "string", format: "date" }, fin: { type: "string", format: "date" } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "agenda.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "agenda.voir")).map((e) => e.id);
      const { debut, fin } = req.query;
      const { rows: ressources } = await ctx.client.query("select r.id, r.nom, r.type, r.capacite, r.entite_id, e.nom as entite from ressources r join entites e on e.id = r.entite_id where r.actif and r.entite_id = any($1::uuid[]) order by e.nom, r.nom", [ids]);
      const { rows: reservations } = await ctx.client.query(
        `select x.id, x.debut, x.fin, x.objet, x.auteur_id, r.nom as ressource, r.entite_id, u.nom as auteur from reservations x join ressources r on r.id = x.ressource_id join utilisateurs u on u.id = x.auteur_id
         where x.annule_le is null and r.entite_id = any($1::uuid[]) and x.debut < ($3::date + 1)::timestamp at time zone 'Africa/Douala' and x.fin >= $2::date::timestamp at time zone 'Africa/Douala' order by x.debut limit 500`, [ids, debut, fin],
      );
      let sessions: unknown[] = [];
      if (await aPermission(ctx.client, ctx.utilisateurId, "formations.voir")) {
        const f = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "formations.voir")).map((e) => e.id);
        sessions = (await ctx.client.query("select s.id, s.code, s.ville, s.debut::text, s.fin::text, p.nom as programme from sessions_formation s join programmes p on p.id = s.programme_id where s.entite_id = any($1::uuid[]) and s.debut <= $3 and s.fin >= $2 order by s.debut limit 100", [f, debut, fin])).rows;
      }
      return { ressources, reservations, sessions };
    }),
  );
  /** Le verrou sur la ressource empêche deux réservations simultanées de se chevaucher. */
  app.post<{ Body: { ressourceId: string; debut: string; fin: string; objet: string } }>("/reservations", {
    schema: { body: { type: "object", required: ["ressourceId", "debut", "fin", "objet"], properties: { ressourceId: uuid, debut: { type: "string", format: "date-time" }, fin: { type: "string", format: "date-time" }, objet: texte(300) } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      if (Date.parse(b.fin) <= Date.parse(b.debut)) throw new ErreurApi(400, "dates_invalides");
      const { rows: [x] } = await ctx.client.query("select * from ressources where id = $1 and actif for update", [b.ressourceId]);
      if (!x) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "agenda.gerer", x.entite_id);
      const { rows: [c] } = await ctx.client.query("select objet, debut, fin from reservations where ressource_id = $1 and annule_le is null and debut < $3 and fin > $2 limit 1", [b.ressourceId, b.debut, b.fin]);
      if (c) throw new ErreurApi(409, "ressource_occupee", { objet: c.objet, debut: c.debut, fin: c.fin });
      return (await ctx.client.query("insert into reservations (organisation_id, ressource_id, debut, fin, objet, auteur_id) values ($1, $2, $3, $4, $5, $6) returning id", [ctx.organisationId, b.ressourceId, b.debut, b.fin, b.objet, ctx.utilisateurId])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.post<{ Params: { id: string } }>("/reservations/:id/annulation", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [x] } = await ctx.client.query("select r.entite_id from reservations x join ressources r on r.id = x.ressource_id where x.id = $1 and x.annule_le is null", [req.params.id]);
      if (!x) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "agenda.gerer", x.entite_id);
      await ctx.client.query("update reservations set annule_le = now() where id = $1", [req.params.id]);
      return { annulee: true };
    }),
  );
}
