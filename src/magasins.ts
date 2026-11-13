import type { FastifyInstance } from "fastify";
import { publierEvenement } from "./base.js";
import { prochainNumero } from "./formations.js";
import { aPermissionSurEntite, entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Outils } from "./serveur.js";

const uuid = { type: "string", format: "uuid" } as const;
/** Un nouveau lieu peut immédiatement recevoir du stock et vendre. */
const MODULES_DU_MAGASIN = ["achats_stocks", "facturation", "commerce"];

export function enregistrerMagasins(app: FastifyInstance, outils: Outils): void {
  const { protege, exiger, exigerSurEntite } = outils;

  /** Le droit lui-même exige le module de stock sur le parent : aucun magasin ne peut naître sous GTA. */
  app.post<{ Body: { parentId: string; nom: string; type: string } }>("/magasins", {
    schema: {
      body: {
        type: "object", required: ["parentId", "nom", "type"],
        properties: {
          parentId: uuid,
          nom: { type: "string", minLength: 1, maxLength: 200 },
          type: { type: "string", enum: ["point_de_vente", "entrepot"] },
        },
      },
    },
  }, async (req, reponse) => {
    const m = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "magasins.gerer", b.parentId);
      const code = await prochainNumero(ctx.client, "MAG");
      const { rows } = await ctx.client.query(
        `insert into entites (organisation_id, parent_id, code, nom, type, domaine)
         values ($1, $2, $3, $4, $5, (select domaine from entites where id = $2)) returning id, parent_id, code, nom, type, actif`,
        [ctx.organisationId, b.parentId, code, b.nom, b.type],
      );
      for (const module of MODULES_DU_MAGASIN) {
        await ctx.client.query(
          "insert into modules_entite (organisation_id, entite_id, module, actif) values ($1, $2, $3, true)",
          [ctx.organisationId, rows[0].id, module],
        );
      }
      await publierEvenement(ctx.client, "magasin.cree", { id: rows[0].id });
      return rows[0];
    });
    return reponse.status(201).send(m);
  });

  app.get("/magasins", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "magasins.gerer");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "magasins.gerer")).map((e) => e.id);
      const { rows } = await ctx.client.query(
        `select e.id, e.code, e.nom, e.type, e.actif, e.parent_id,
           coalesce((select sum(m.quantite) from mouvements_stock m where m.entite_id = e.id), 0)::float as quantite
         from entites e
         where e.type in ('point_de_vente', 'entrepot') and (e.id = any($1::uuid[]) or e.parent_id = any($1::uuid[]))
         order by e.actif desc, e.nom limit 1000`,
        [ids],
      );
      return rows;
    }),
  );

  /** Désactiver garde l'historique. Un lieu qui contient encore du stock doit d'abord être vidé. */
  app.patch<{ Params: { id: string }; Body: { nom?: string; actif?: boolean } }>("/magasins/:id", {
    schema: {
      params: { type: "object", required: ["id"], properties: { id: uuid } },
      body: {
        type: "object", minProperties: 1,
        properties: { nom: { type: "string", minLength: 1, maxLength: 200 }, actif: { type: "boolean" } },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [e] } = await ctx.client.query(
        "select id, parent_id, type from entites where id = $1 for update", [req.params.id],
      );
      if (!e || !["point_de_vente", "entrepot"].includes(e.type)) throw new ErreurApi(404, "introuvable");
      // Le droit se vérifie sur le parent : un lieu désactivé n'a plus de module, mais il reste gérable.
      if (!(await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "magasins.gerer", e.parent_id))) {
        throw new ErreurApi(403, "permission_refusee");
      }
      if (req.body.actif === false) {
        const s = await ctx.client.query(
          `select 1 from mouvements_stock where entite_id = $1 group by produit_id having sum(quantite) <> 0 limit 1`, [e.id],
        );
        if (s.rows[0]) throw new ErreurApi(409, "magasin_non_vide");
      }
      const { rows } = await ctx.client.query(
        "update entites set nom = coalesce($2, nom), actif = coalesce($3, actif) where id = $1 returning id, code, nom, type, actif",
        [e.id, req.body.nom ?? null, req.body.actif ?? null],
      );
      if (req.body.actif !== undefined) {
        await ctx.client.query(
          "update modules_entite set actif = $2, modifie_le = now() where entite_id = $1 and module = any($3)",
          [e.id, req.body.actif, MODULES_DU_MAGASIN],
        );
      }
      return rows[0];
    }),
  );
}
