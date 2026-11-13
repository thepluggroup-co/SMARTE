import type { FastifyInstance } from "fastify";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";

const uuid = { type: "string", format: "uuid" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const corpsImage = { type: "object", required: ["image"], properties: { image: { type: "string", minLength: 8, maxLength: 1_500_000 } } } as const;

/**
 * Lit une image envoyée en base64 et en reconnaît le type par son contenu, jamais par ce qu'en dit le navigateur.
 * PNG, JPEG et WebP seulement : un SVG pourrait contenir du code.
 */
export function lireImage(base64: string, max: number): { type: string; octets: Buffer } {
  const brut = base64.replace(/^data:[^,]*,/, "");
  if (!/^[A-Za-z0-9+/=\s]+$/.test(brut)) throw new ErreurApi(415, "format_image");
  const octets = Buffer.from(brut, "base64");
  if (octets.length > max) throw new ErreurApi(413, "image_trop_lourde", { max });
  const debut = octets.subarray(0, 12);
  const type = debut.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "image/png"
    : debut[0] === 0xff && debut[1] === 0xd8 && debut[2] === 0xff ? "image/jpeg"
    : debut.subarray(0, 4).toString("latin1") === "RIFF" && debut.subarray(8, 12).toString("latin1") === "WEBP" ? "image/webp"
    : null;
  if (!type) throw new ErreurApi(415, "format_image");
  return { type, octets };
}
const enDataUrl = (type: string, octets: Buffer) => `data:${type};base64,${octets.toString("base64")}`;

export function enregistrerImages(app: FastifyInstance, outils: Outils): void {
  const { protege, exigerSurEntite } = outils;
  const noter = (ctx: Contexte, action: string, details: object) =>
    ctx.client.query("select journal_evenement($1, $2)", [action, JSON.stringify(details)]);

  /** Logos de l'organisation : qui en a un, sans l'image. Ils figurent sur les documents, tout compte connecté peut les voir. */
  app.get("/logos", async (req) =>
    protege(req, async (ctx) => (await ctx.client.query(
      `select l.entite_id, e.code, e.type, e.nom, l.maj_le from logos_entites l join entites e on e.id = l.entite_id order by e.nom`,
    )).rows),
  );

  app.get<{ Params: { id: string } }>("/logos/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [l] } = await ctx.client.query("select type_mime, donnees from logos_entites where entite_id = $1", [req.params.id]);
      if (!l) throw new ErreurApi(404, "introuvable");
      return { image: enDataUrl(l.type_mime, l.donnees) };
    }),
  );

  app.put<{ Params: { id: string }; Body: { image: string } }>("/entites/:id/logo", {
    bodyLimit: 2 * 1024 ** 2, schema: { params: paramId, body: corpsImage },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "entites.gerer", req.params.id);
      const { type, octets } = lireImage(req.body.image, 1024 ** 2);
      await ctx.client.query(
        `insert into logos_entites (organisation_id, entite_id, type_mime, donnees, auteur_id) values ($1, $2, $3, $4, $5)
         on conflict (organisation_id, entite_id) do update set type_mime = excluded.type_mime, donnees = excluded.donnees,
           auteur_id = excluded.auteur_id, maj_le = now()`,
        [ctx.organisationId, req.params.id, type, octets, ctx.utilisateurId],
      );
      await noter(ctx, "logo.change", { entite_id: req.params.id, type, octets: octets.length });
      return { enregistre: true };
    }),
  );

  app.delete<{ Params: { id: string } }>("/entites/:id/logo", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "entites.gerer", req.params.id);
      const { rowCount } = await ctx.client.query("delete from logos_entites where entite_id = $1", [req.params.id]);
      if (!rowCount) throw new ErreurApi(404, "introuvable");
      await noter(ctx, "logo.retire", { entite_id: req.params.id });
      return { retire: true };
    }),
  );

  // Photo de profil : chacun ne gère que la sienne.
  app.get("/moi/photo", async (req) =>
    protege(req, async (ctx) => {
      const { rows: [p] } = await ctx.client.query("select type_mime, donnees from photos_utilisateurs where utilisateur_id = $1", [ctx.utilisateurId]);
      return { image: p ? enDataUrl(p.type_mime, p.donnees) : null };
    }),
  );

  app.put<{ Body: { image: string } }>("/moi/photo", { bodyLimit: 1024 ** 2, schema: { body: corpsImage } }, async (req) =>
    protege(req, async (ctx) => {
      const { type, octets } = lireImage(req.body.image, 512 * 1024);
      await ctx.client.query(
        `insert into photos_utilisateurs (organisation_id, utilisateur_id, type_mime, donnees) values ($1, $2, $3, $4)
         on conflict (organisation_id, utilisateur_id) do update set type_mime = excluded.type_mime, donnees = excluded.donnees, maj_le = now()`,
        [ctx.organisationId, ctx.utilisateurId, type, octets],
      );
      return { enregistre: true };
    }),
  );

  app.delete("/moi/photo", async (req) =>
    protege(req, async (ctx) => {
      await ctx.client.query("delete from photos_utilisateurs where utilisateur_id = $1", [ctx.utilisateurId]);
      return { retire: true };
    }),
  );
}
