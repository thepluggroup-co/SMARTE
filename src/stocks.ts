import type { FastifyInstance } from "fastify";
import { publierEvenement, type Client } from "./base.js";
import { aPermission, entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";

const uuid = { type: "string", format: "uuid" } as const;
const quantite = { type: "number", exclusiveMinimum: 0, maximum: 1_000_000_000, multipleOf: 0.001 } as const;

export async function niveau(c: Client, entiteId: string, produitId: string): Promise<number> {
  const { rows } = await c.query(
    "select coalesce(sum(quantite), 0)::float as q from mouvements_stock where entite_id = $1 and produit_id = $2",
    [entiteId, produitId],
  );
  return rows[0].q;
}

/** Le verrou sur le produit empêche deux sorties simultanées de vendre la même pièce. */
export async function produitSuivi(c: Client, produitId: string) {
  const { rows } = await c.query("select id, nom, suivi_stock, cout_moyen from produits where id = $1 for update", [produitId]);
  if (!rows[0]) throw new ErreurApi(404, "introuvable");
  if (!rows[0].suivi_stock) throw new ErreurApi(409, "produit_sans_stock");
  return rows[0];
}

export async function sortirDuStock(
  ctx: Contexte, entiteId: string, produitId: string, q: number, type: string, motif: string | null, documentId: string | null, reference: string | null = null, autoriserNegatif = false,
): Promise<void> {
  // Ce qui est réservé n'est plus à vendre ; un inventaire, lui, constate le stock réel.
  const { rows: [r] } = type === "ajustement" ? { rows: [{ q: 0 }] } : await ctx.client.query("select coalesce(sum(quantite), 0)::float as q from reservations_stock where entite_id = $1 and produit_id = $2 and levee_le is null and (expire_le is null or expire_le >= (now() at time zone 'Africa/Douala')::date)", [entiteId, produitId]);
  // Un article avarié est mis de côté : il ne se vend plus et ne se transfère plus, sauf sa propre sortie en perte.
  const { rows: [av] } = type === "ajustement" ? { rows: [{ q: 0 }] } : await ctx.client.query("select coalesce(sum(quantite), 0)::float as q from avaries where entite_id = $1 and produit_id = $2 and statut = 'constatee'", [entiteId, produitId]);
  const disponible = (await niveau(ctx.client, entiteId, produitId)) - r.q - av.q;
  if (q > disponible && !autoriserNegatif) throw new ErreurApi(409, "stock_insuffisant", { produitId, disponible });
  const { rows } = await ctx.client.query("select cout_moyen from produits where id = $1", [produitId]);
  await ctx.client.query(
    `insert into mouvements_stock (organisation_id, entite_id, produit_id, type, quantite, cout_unitaire, motif, document_id, reference, auteur_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [ctx.organisationId, entiteId, produitId, type, -q, rows[0].cout_moyen, motif, documentId, reference, ctx.utilisateurId],
  );
}

/** Fait entrer une quantité et recalcule le coût moyen pondéré sur tout le groupe. Le produit doit être verrouillé. */
export async function entrerEnStock(
  ctx: Contexte, entiteId: string, produitId: string, q: number, cout: number, type: string, motif: string | null, reference: string | null,
): Promise<void> {
  const { rows: [p] } = await ctx.client.query("select cout_moyen from produits where id = $1", [produitId]);
  const t = await ctx.client.query(
    "select coalesce(sum(quantite), 0)::float as q from mouvements_stock where produit_id = $1", [produitId],
  );
  const existant = Math.max(t.rows[0].q, 0);
  const moyen = Math.round((existant * p.cout_moyen + q * cout) / (existant + q));
  await ctx.client.query("update produits set cout_moyen = $2 where id = $1", [produitId, moyen]);
  await ctx.client.query(
    `insert into mouvements_stock (organisation_id, entite_id, produit_id, type, quantite, cout_unitaire, motif, reference, auteur_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [ctx.organisationId, entiteId, produitId, type, q, cout, motif, reference, ctx.utilisateurId],
  );
}

export function enregistrerStocks(app: FastifyInstance, outils: Outils): void {
  const { protege, exiger, exigerSurEntite } = outils;

  const exigerModule = async (ctx: Contexte, entiteId: string) => {
    const { rows } = await ctx.client.query(
      "select actif from modules_entite where entite_id = $1 and module = 'achats_stocks'", [entiteId],
    );
    if (!rows[0]?.actif) throw new ErreurApi(409, "module_inactif");
  };

  app.post<{
    Body: { entiteId: string; produitId: string; type: string; quantite: number; coutUnitaire?: number; motif?: string };
  }>("/stocks/mouvements", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "produitId", "type", "quantite"],
        properties: {
          entiteId: uuid, produitId: uuid,
          type: { type: "string", enum: ["entree", "sortie"] },
          quantite, coutUnitaire: { type: "integer", minimum: 0, maximum: 1_000_000_000 },
          motif: { type: "string", maxLength: 500 },
        },
      },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "stocks.gerer", b.entiteId);
      await exigerModule(ctx, b.entiteId);
      await produitSuivi(ctx.client, b.produitId);
      if (b.type === "sortie") {
        if (!b.motif?.trim()) throw new ErreurApi(400, "motif_obligatoire");
        await sortirDuStock(ctx, b.entiteId, b.produitId, b.quantite, "sortie", b.motif.trim(), null);
      } else {
        if (b.coutUnitaire === undefined) throw new ErreurApi(400, "cout_obligatoire");
        await entrerEnStock(ctx, b.entiteId, b.produitId, b.quantite, b.coutUnitaire, "entree", b.motif?.trim() || null, null);
      }
      return { niveau: await niveau(ctx.client, b.entiteId, b.produitId) };
    });
    return reponse.status(201).send(r);
  });

    app.get("/stocks", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "stocks.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "stocks.voir")).map((e) => e.id);
      const { rows } = await ctx.client.query(
        `select e.id as entite_id, e.nom as entite, p.id as produit_id, p.code, p.nom, p.unite, p.seuil_alerte::float,
           sum(m.quantite)::float as quantite,
           sum(m.quantite)::float <= p.seuil_alerte::float as en_alerte
         from mouvements_stock m join produits p on p.id = m.produit_id join entites e on e.id = m.entite_id
         where m.entite_id = any($1::uuid[])
         group by e.id, e.nom, p.id order by en_alerte desc, p.nom, e.nom limit 2000`,
        [ids],
      );
      return rows;
    }),
  );

  app.get<{ Querystring: { produitId: string; entiteId?: string } }>("/stocks/mouvements", {
    schema: { querystring: { type: "object", required: ["produitId"], properties: { produitId: uuid, entiteId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      if (!(await aPermission(ctx.client, ctx.utilisateurId, "stocks.voir"))) throw new ErreurApi(403, "permission_refusee");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "stocks.voir")).map((e) => e.id);
      const { rows } = await ctx.client.query(
        `select m.id, m.type, m.quantite::float, m.cout_unitaire, m.motif, m.cree_le, e.nom as entite, u.nom as auteur, coalesce(d.numero, m.reference) as document
         from mouvements_stock m join entites e on e.id = m.entite_id join utilisateurs u on u.id = m.auteur_id
         left join documents_vente d on d.id = m.document_id
         where m.produit_id = $1 and m.entite_id = any($2::uuid[]) and ($3::uuid is null or m.entite_id = $3)
         order by m.cree_le desc limit 500`,
        [req.query.produitId, ids, req.query.entiteId ?? null],
      );
      return rows;
    }),
  );
}
