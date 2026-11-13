import type { FastifyInstance } from "fastify";
import { ErreurApi, type Outils } from "./serveur.js";

export interface Lecon { titre: string; contenu: string; questions: { enonce: string; choix: string[]; bonne: number }[] }
export interface Plan { description: string; lecons: Lecon[] }

/** Interchangeable : le reste du module ne dépend d'aucun fournisseur. */
export type GenerateurIa = (consigne: string, schema: object) => Promise<unknown>;

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["description", "lecons"],
  properties: {
    description: { type: "string" },
    lecons: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["titre", "contenu", "questions"],
        properties: {
          titre: { type: "string" }, contenu: { type: "string" },
          questions: {
            type: "array",
            items: {
              type: "object", additionalProperties: false, required: ["enonce", "choix", "bonne"],
              properties: { enonce: { type: "string" }, choix: { type: "array", items: { type: "string" } }, bonne: { type: "integer" } },
            },
          },
        },
      },
    },
  },
} as const;

/** Ce qui vient de l'IA est vérifié comme toute autre saisie, avant d'entrer dans la base. */
export function validerPlan(brut: unknown, maxLecons: number): Plan {
  const invalide = () => new ErreurApi(502, "ia_reponse_invalide");
  const texte = (v: unknown, max: number): string => {
    if (typeof v !== "string" || !v.trim() || v.length > max) throw invalide();
    return v.trim();
  };
  const p = brut as Plan | null;
  if (!p || typeof p !== "object" || !Array.isArray(p.lecons) || !p.lecons.length || p.lecons.length > maxLecons) throw invalide();
  return {
    description: texte(p.description, 5000),
    lecons: p.lecons.map((l) => {
      if (!Array.isArray(l?.questions) || l.questions.length > 20) throw invalide();
      return {
        titre: texte(l.titre, 200),
        contenu: texte(l.contenu, 100000),
        questions: l.questions.map((q) => {
          if (!Array.isArray(q?.choix) || q.choix.length < 2 || q.choix.length > 8) throw invalide();
          if (!Number.isInteger(q.bonne) || q.bonne < 0 || q.bonne >= q.choix.length) throw invalide();
          return { enonce: texte(q.enonce, 1000), choix: q.choix.map((c) => texte(c, 500)), bonne: q.bonne };
        }),
      };
    }),
  };
}

/** Appel de l'API Claude. La clé et le modèle viennent de la configuration du serveur. */
export function generateurClaude(cle: string, modele: string, envoyer: typeof fetch = fetch): GenerateurIa {
  return async (consigne, schema) => {
    let r: Response;
    try {
      r = await envoyer("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: AbortSignal.timeout(300_000),
        headers: { "content-type": "application/json", "x-api-key": cle, "anthropic-version": "2026-10-21" },
        body: JSON.stringify({
          model: modele,
          max_tokens: 16000,
          system: "Tu aides des formateurs à préparer un cours en français. Reste factuel et pratique, sans inventer de chiffres, de lois ni de sources. Le formateur relit tout avant publication.",
          messages: [{ role: "user", content: consigne }],
          output_config: { format: { type: "json_schema", schema } },
        }),
      });
    } catch {
      throw new ErreurApi(502, "ia_indisponible");
    }
    if (!r.ok) throw new ErreurApi(502, "ia_indisponible");
    const d = await r.json() as { stop_reason?: string; content?: { type: string; text?: string }[] };
    if (d.stop_reason !== "end_turn") throw new ErreurApi(502, "ia_reponse_invalide");
    const texte = d.content?.find((b) => b.type === "text")?.text;
    try {
      return JSON.parse(texte ?? "");
    } catch {
      throw new ErreurApi(502, "ia_reponse_invalide");
    }
  };
}

/** Le studio produit toujours un brouillon non publié : un formateur le relit et décide. */
export function enregistrerStudio(app: FastifyInstance, outils: Outils, generateur?: GenerateurIa): void {
  const { protege, exigerSurEntite } = outils;

  app.get("/studio/etat", async (req) =>
    protege(req, async (ctx) => {
      await outils.exiger(ctx, "apprentissage.gerer");
      return { disponible: !!generateur };
    }),
  );

  app.post<{ Body: { entiteId: string; sujet: string; public?: string; nombreLecons: number; consignes?: string } }>("/studio/brouillons", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      body: {
        type: "object", required: ["entiteId", "sujet", "nombreLecons"],
        properties: {
          entiteId: { type: "string", format: "uuid" }, sujet: { type: "string", minLength: 3, maxLength: 300 },
          public: { type: "string", maxLength: 300 }, nombreLecons: { type: "integer", minimum: 1, maximum: 15 },
          consignes: { type: "string", maxLength: 3000 },
        },
      },
    },
  }, async (req, reponse) => {
    const b = req.body;
    await protege(req, (ctx) => exigerSurEntite(ctx, "apprentissage.gerer", b.entiteId));
    if (!generateur) throw new ErreurApi(503, "ia_non_configuree");
    // Aucune connexion à la base n'est retenue pendant que l'IA répond.
    const plan = validerPlan(await generateur(
      [
        `Prépare le brouillon d'un cours sur : ${b.sujet}.`,
        b.public ? `Public visé : ${b.public}.` : "",
        `Écris exactement ${b.nombreLecons} leçons. Chaque leçon a un contenu complet et de deux à cinq questions à choix multiples.`,
        "Le champ bonne est l'indice, à partir de 0, de la bonne réponse dans choix.",
        b.consignes ? `Consignes du formateur : ${b.consignes}` : "",
      ].filter(Boolean).join("\n"),
      SCHEMA,
    ), b.nombreLecons);
    const cours = await protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "apprentissage.gerer", b.entiteId);
      const { rows: [c] } = await ctx.client.query(
        "insert into cours (organisation_id, entite_id, titre, description) values ($1, $2, $3, $4) returning *",
        [ctx.organisationId, b.entiteId, b.sujet.slice(0, 200), plan.description],
      );
      for (const [i, l] of plan.lecons.entries()) {
        await ctx.client.query(
          "insert into lecons (organisation_id, cours_id, ordre, titre, contenu, questions) values ($1, $2, $3, $4, $5, $6)",
          [ctx.organisationId, c.id, i + 1, l.titre, l.contenu, JSON.stringify(l.questions)],
        );
      }
      await ctx.client.query("select journal_evenement('studio.brouillon', $1)", [JSON.stringify({ cours: c.id })]);
      return c;
    });
    return reponse.status(201).send(cours);
  });
}
