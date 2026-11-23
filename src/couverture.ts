import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { dansOrganisation, type Client } from "./base.js";
import { heureDouala, jourDouala, notifier, titulaires } from "./performance.js";
import { aPermissionSurEntite } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils, type TachePlanifiee } from "./serveur.js";

/**
 * Couverture de stock par catégorie (règle R11 : stock plafonné à deux mois). Couverture = stock des lieux de la branche
 * divisé par les ventes moyennes par jour des 90 derniers jours. Les sorties « vente » comptent la caisse, les factures
 * et la Marketplace dans l'unité de base. Les articles en dépôt-vente ne sont pas à GLOMARI : ils n'y entrent pas.
 */

export const SEUIL_COUVERTURE_JOURS = 60;
export const PERIODE_VENTES_JOURS = 90;

export interface Couverture {
  categorie_id: string | null; categorie: string; stock: number; ventes_90: number; couverture_jours: number | null; au_dessus: boolean;
}

/** Jours couverts par un stock ; nul si infini (du stock sans aucune vente). */
const jours = (stock: number, ventes: number) => (ventes > 0 ? Math.round((stock * PERIODE_VENTES_JOURS * 10) / ventes) / 10 : null);
const depasse = (stock: number, couverture: number | null) => stock > 0 && (couverture === null || couverture > SEUIL_COUVERTURE_JOURS);

/** Par catégorie de l'article (sous-catégorie comprise, sans regroupement par catégorie mère). Sans stock, pas d'alerte. */
export async function couvertures(c: Client, brancheId: string, { avecVides = false } = {}): Promise<Couverture[]> {
  const { rows } = await c.query(
    `with art as (
       select p.id, p.categorie_id from produits p
       where p.suivi_stock and entite_branche(p.entite_id) = $1
         and not exists (select 1 from articles_depot d where d.produit_id = p.id and d.actif))
     select a.categorie_id, coalesce(g.nom, 'Sans catégorie') as categorie,
       coalesce(sum(m.quantite), 0)::float as stock,
       coalesce(-sum(m.quantite) filter (where m.type = 'vente' and m.cree_le >= now() - make_interval(days => $2)), 0)::float as ventes
     from art a join mouvements_stock m on m.produit_id = a.id and entite_branche(m.entite_id) = $1
     left join categories_articles g on g.id = a.categorie_id
     group by a.categorie_id, g.nom`,
    [brancheId, PERIODE_VENTES_JOURS],
  );
  return rows
    .filter((r) => avecVides || r.stock > 0)
    .map((r) => {
      const couverture = jours(r.stock, r.ventes);
      return { categorie_id: r.categorie_id, categorie: r.categorie, stock: r.stock, ventes_90: r.ventes, couverture_jours: couverture, au_dessus: depasse(r.stock, couverture) };
    })
    .sort((x, y) => Number(y.au_dessus) - Number(x.au_dessus) || (y.couverture_jours ?? 1e12) - (x.couverture_jours ?? 1e12));
}

/** Les catégories d'une commande qui dépasseraient le plafond une fois la marchandise reçue. Un avertissement, jamais un blocage. */
export async function couverturePrevue(c: Client, commandeId: string) {
  const { rows: lignes } = await c.query(
    `select p.categorie_id, sum(l.quantite - l.quantite_recue)::float as attendu, entite_branche(k.entite_id) as branche
     from lignes_achat l join produits p on p.id = l.produit_id join commandes_achat k on k.id = l.commande_id
     where l.commande_id = $1 group by p.categorie_id, k.entite_id`,
    [commandeId],
  );
  if (!lignes.length || !lignes[0]!.branche) return [];
  const actuelles = await couvertures(c, lignes[0]!.branche, { avecVides: true });
  const { rows: noms } = await c.query("select id, nom from categories_articles where id = any($1::uuid[])", [lignes.map((l) => l.categorie_id).filter(Boolean)]);
  const resultat = [];
  for (const l of lignes) {
    const a = actuelles.find((x) => x.categorie_id === l.categorie_id);
    const stock = (a?.stock ?? 0) + l.attendu;
    const prevue = jours(stock, a?.ventes_90 ?? 0);
    if (!depasse(stock, prevue)) continue;
    resultat.push({
      categorie: a?.categorie ?? noms.find((n) => n.id === l.categorie_id)?.nom ?? "Sans catégorie",
      couverture_actuelle: a ? a.couverture_jours : 0, couverture_prevue: prevue,
    });
  }
  return resultat;
}

/**
 * Calcul du jour : met à jour l'état de chaque catégorie et prévient une seule fois au franchissement du plafond.
 * La clé de notification porte le jour du franchissement : repasser dessous puis dessus prévient de nouveau.
 */
export async function calculerAlertesCouverture(c: Client, jour = jourDouala()): Promise<number> {
  const { rows: branches } = await c.query(
    "select e.id from entites e where entite_branche(e.id) = e.id and exists (select 1 from modules_entite m where m.entite_id = e.id and m.module = 'achats_stocks' and m.actif)",
  );
  let notifiees = 0;
  for (const b of branches) {
    const actuelles = await couvertures(c, b.id, { avecVides: true });
    const { rows: avant } = await c.query("select categorie_id, au_dessus, depasse_depuis::text as depasse_depuis from alertes_couverture where branche_id = $1", [b.id]);
    const cles = new Set([...actuelles.map((a) => a.categorie_id), ...avant.map((a) => a.categorie_id)]);
    let destinataires: string[] | null = null;
    for (const categorie of cles) {
      const a = actuelles.find((x) => x.categorie_id === categorie);
      const p = avant.find((x) => x.categorie_id === categorie);
      const auDessus = a?.au_dessus ?? false;
      const depuis = auDessus ? (p?.au_dessus ? p.depasse_depuis : jour) : null;
      await c.query(
        `insert into alertes_couverture (organisation_id, branche_id, categorie_id, stock, ventes_90, couverture_jours, au_dessus, depasse_depuis, calcule_le)
         values (org_courante(), $1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (organisation_id, branche_id, (coalesce(categorie_id, '00000000-0000-0000-0000-000000000000'::uuid))) do update set
           stock = excluded.stock, ventes_90 = excluded.ventes_90, couverture_jours = excluded.couverture_jours,
           au_dessus = excluded.au_dessus, depasse_depuis = excluded.depasse_depuis, calcule_le = excluded.calcule_le`,
        [b.id, categorie, a?.stock ?? 0, a?.ventes_90 ?? 0, a?.couverture_jours ?? null, auDessus, depuis, jour],
      );
      if (auDessus && !p?.au_dessus) {
        destinataires ??= await titulaires(c, ["achats.gerer", "stocks.valider"], b.id);
        const duree = a!.couverture_jours === null ? "du stock sans aucune vente depuis 90 jours" : `${a!.couverture_jours} jours de ventes`;
        await notifier(c, destinataires, `couverture:${b.id}:${categorie ?? "sans"}:${depuis}`,
          `La catégorie « ${a!.categorie} » a ${duree} : au-delà du plafond de deux mois de stock.`, "important");
        notifiees++;
      }
    }
  }
  return notifiees;
}

export function enregistrerCouverture(app: FastifyInstance, pool: pg.Pool, outils: Outils, taches: TachePlanifiee[]): void {
  const { protege } = outils;

  // Une fois par jour, après 2 h à Douala, comme les mesures des OKR.
  taches.push((organisationId) => dansOrganisation(pool, organisationId, async (c) => {
    if (heureDouala() < 2) return;
    const { rows: [fait] } = await c.query("select 1 from alertes_couverture where calcule_le = $1 limit 1", [jourDouala()]);
    if (!fait) await calculerAlertesCouverture(c);
  }));

  const exigerVoir = async (ctx: Contexte, brancheId: string) => {
    for (const p of ["achats.voir", "stocks.voir"] as const) if (await aPermissionSurEntite(ctx.client, ctx.utilisateurId, p, brancheId)) return;
    throw new ErreurApi(403, "permission_refusee");
  };

  app.get<{ Querystring: { brancheId: string } }>("/stocks/couverture", {
    schema: { querystring: { type: "object", required: ["brancheId"], properties: { brancheId: { type: "string", format: "uuid" } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerVoir(ctx, req.query.brancheId);
      const { rows: etats } = await ctx.client.query("select categorie_id, depasse_depuis::text as depasse_depuis from alertes_couverture where branche_id = $1", [req.query.brancheId]);
      return {
        seuil_jours: SEUIL_COUVERTURE_JOURS, periode_jours: PERIODE_VENTES_JOURS,
        categories: (await couvertures(ctx.client, req.query.brancheId)).map((x) => ({
          ...x, depasse_depuis: x.au_dessus ? etats.find((e) => e.categorie_id === x.categorie_id)?.depasse_depuis ?? null : null,
        })),
      };
    }),
  );
}
