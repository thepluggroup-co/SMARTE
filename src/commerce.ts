import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { dansOrganisation, type Client } from "./base.js";
import { totalParTranches } from "./finitions.js";
import { prochainNumero } from "./formations.js";
import { entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";
import { entrerEnStock } from "./stocks.js";
import { branchesVisibles, lierTiers } from "./tiers.js";

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max = 300) => ({ type: "string", minLength: 1, maxLength: max }) as const;
const entier = { type: "integer", minimum: 0, maximum: 1_000_000_000_000 } as const;
const periode = { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" } as const;
const CODE = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{22}$/;

/** Le palier atteint s'applique à toute la ligne. Sans activation, seul le prix de base compte. */
export function prixPourQuantite(base: number, actif: boolean, paliers: { quantite_min: number; prix: number }[], q: number): number {
  if (!actif) return base;
  return [...paliers].sort((a, b) => b.quantite_min - a.quantite_min).find((p) => q >= p.quantite_min)?.prix ?? base;
}
async function prixSpecial(c: Client, produitId: string, tiersId: string): Promise<number | null> {
  const { rows: [n] } = await c.query("select prix from prix_clients where tiers_id = $1 and produit_id = $2", [tiersId, produitId]);
  if (n) return Number(n.prix);
  // Une grille datée pour la catégorie du client vient ensuite ; la plus précise et la plus récente l'emporte.
  const { rows: [g] } = await c.query(
    `select g.prix from prix_grilles g left join comptes_pro k on k.tiers_id = $2
     where g.produit_id = $1 and (g.categorie is null or g.categorie = k.categorie) and (g.debut is null or g.debut <= (now() at time zone 'Africa/Douala')::date) and (g.fin is null or g.fin >= (now() at time zone 'Africa/Douala')::date)
     order by g.categorie is null, g.cree_le desc limit 1`, [produitId, tiersId],
  );
  return g ? Number(g.prix) : null;
}
const PROMO = `select type, valeur from promotions where produit_id = $1 and actif and (now() at time zone 'Africa/Douala')::date between debut and fin order by cree_le desc limit 1`;
export async function prixProduit(c: Client, produitId: string, base: number, q: number, tiersId?: string | null): Promise<number> {
  // Un prix négocié avec ce client prime sur les paliers et les promotions.
  if (tiersId) {
    const special = await prixSpecial(c, produitId, tiersId);
    if (special !== null) return special;
  }
  const { rows: [p] } = await c.query("select paliers_actif, mode_palier from produits where id = $1", [produitId]);
  const { rows } = p?.paliers_actif ? await c.query("select quantite_min::float, prix from paliers_prix where produit_id = $1", [produitId]) : { rows: [] };
  const prix = p?.paliers_actif && p.mode_palier === "tranches" ? Math.round(totalParTranches(base, rows, q) / q) : prixPourQuantite(base, !!p?.paliers_actif, rows, q);
  const { rows: [promo] } = await c.query(PROMO, [produitId]);
  return promo ? prixPromo(prix, promo.type, Number(promo.valeur)) : prix;
}
/** Le montant exact d'une ligne vendue par tranches : un prix unitaire arrondi le fausserait. Null si le prix unitaire suffit. */
export async function brutTranches(c: Client, produitId: string, base: number, q: number, tiersId?: string | null): Promise<number | undefined> {
  if (tiersId && (await prixSpecial(c, produitId, tiersId)) !== null) return undefined;
  const { rows: [p] } = await c.query("select paliers_actif, mode_palier from produits where id = $1", [produitId]);
  if (!p?.paliers_actif || p.mode_palier !== "tranches") return undefined;
  if ((await c.query(PROMO, [produitId])).rows[0]) return undefined;
  const { rows } = await c.query("select quantite_min::float, prix from paliers_prix where produit_id = $1", [produitId]);
  return totalParTranches(base, rows, q);
}
/** La promotion s'applique après le palier. La plus récente l'emporte, sans cumul. */
export function prixPromo(prix: number, type: string, valeur: number): number {
  return type === "pourcentage" ? Math.round((prix * (100 - valeur)) / 100) : Math.max(prix - valeur, 0);
}
export function enregistrerPromotions(app: FastifyInstance, outils: Outils): void {
  const { protege, exigerSurEntite } = outils;
  const uuid = { type: "string", format: "uuid" } as const;
  const date = { type: "string", format: "date" } as const;
  app.post<{ Body: { produitId: string; nom: string; type: string; valeur: number; debut: string; fin: string } }>("/promotions", {
    schema: { body: { type: "object", required: ["produitId", "nom", "type", "valeur", "debut", "fin"], properties: { produitId: uuid, nom: { type: "string", minLength: 1, maxLength: 200 }, type: { type: "string", enum: ["pourcentage", "montant"] }, valeur: { type: "integer", minimum: 1, maximum: 1_000_000_000 }, debut: date, fin: date } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      const { rows: [p] } = await ctx.client.query("select entite_id from produits where id = $1", [b.produitId]);
      if (!p) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "catalogue.gerer", p.entite_id);
      if (b.fin < b.debut) throw new ErreurApi(400, "dates_invalides");
      if (b.type === "pourcentage" && b.valeur > 100) throw new ErreurApi(400, "pourcentage_invalide");
      return (await ctx.client.query("insert into promotions (organisation_id, produit_id, nom, type, valeur, debut, fin, auteur_id) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id", [ctx.organisationId, b.produitId, b.nom, b.type, b.valeur, b.debut, b.fin, ctx.utilisateurId])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/promotions", async (req) =>
    protege(req, async (ctx) => {
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "catalogue.gerer")).map((e) => e.id);
      return (await ctx.client.query("select x.id, x.nom, x.type, x.valeur, x.debut::text, x.fin::text, x.actif, p.nom as produit, p.prix_vente from promotions x join produits p on p.id = x.produit_id where p.entite_id = any($1::uuid[]) order by x.fin desc limit 300", [ids])).rows;
    }),
  );
  app.post<{ Params: { id: string } }>("/promotions/:id/arret", { schema: { params: { type: "object", required: ["id"], properties: { id: uuid } } } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [x] } = await ctx.client.query("select p.entite_id from promotions x join produits p on p.id = x.produit_id where x.id = $1", [req.params.id]);
      if (!x) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "catalogue.gerer", x.entite_id);
      await ctx.client.query("update promotions set actif = false where id = $1", [req.params.id]);
      return { actif: false };
    }),
  );
}
/** Encours d'un client après règlements et avoirs, pour contrôler son plafond. */
export async function controleCredit(c: Client, tiersId: string, montant: number) {
  const { rows: [p] } = await c.query("select plafond_credit from comptes_pro where tiers_id = $1", [tiersId]);
  if (!p || p.plafond_credit === 0) return null;
  const { rows: [e] } = await c.query(
    `select coalesce(sum(f.total_ttc - (select coalesce(sum(r.montant), 0) from reglements r where r.facture_id = f.id and r.annule_le is null)
       - (select coalesce(sum(a.total_ttc), 0) from documents_vente a where a.origine_id = f.id and a.type = 'avoir' and a.statut = 'emis')), 0)::int8 as encours
     from documents_vente f where f.tiers_id = $1 and f.type = 'facture' and f.statut = 'emis'`, [tiersId],
  );
  // Les restes dus des ventes à crédit de la caisse comptent dans le même encours.
  const { rows: [k] } = await c.query(
    `select coalesce(sum(reste_credit_comptoir(v.id)), 0)::int8 as encours
     from ventes_comptoir v where v.tiers_id = $1 and v.annulee_le is null and v.reste_du > 0`, [tiersId],
  );
  const encours = Number(e.encours) + Number(k.encours);
  return { plafond: p.plafond_credit as number, encours, depasse: encours + montant > p.plafond_credit };
}
/** Coordonnées ou propos injurieux : le texte attend un modérateur. Une note basse n'est jamais retenue pour cela. */
export function aModerer(t: string | undefined): boolean {
  if (!t) return false;
  return /(\+?\d[\s.-]?){8,}|[\w.+-]+@[\w-]+\.\w+|https?:\/\/|\b(connard|salaud|salope|voleur|arnaqueur|escroc|imb[ée]cile)s?\b/i.test(t);
}
/** Le même indicateur se calcule sur un jour (AAAA-MM-JJ) ou sur un mois (AAAA-MM), à l'heure de Douala. */
const SUR = (col: string) => `to_char(${col} at time zone 'Africa/Douala', case when length($2) = 10 then 'YYYY-MM-DD' else 'YYYY-MM' end) = $2`;
/**
 * Un indicateur se mesure pour une personne (requete ou calcul : $1 utilisateur, $2 jour ou mois),
 * pour une entité (entite : $1 entités, $2 premier jour, $3 dernier jour, inclus), ou les deux.
 * « domaine » réserve la mesure d'entité à GLOMARI (commerce) ou à GTA (formation).
 */
export interface IndicateurKpi {
  libelle: string; sens: 1 | -1; requete?: string; calcul?: (c: Client, utilisateurId: string, periode: string) => Promise<number | null>; mensuel?: boolean;
  entite?: string; domaine?: "commerce" | "formation";
}
/** Mesurable pour une personne : sert aux objectifs du jour, aux fiches de poste et aux évaluations. */
export const kpiPersonnel = (k: IndicateurKpi | undefined): boolean => !!k && !!(k.requete || k.calcul);
export const kpiPersonnels = () => Object.entries(KPI).filter(([, k]) => kpiPersonnel(k));
const JOUR_DOUALA = (col: string) => `(${col} at time zone 'Africa/Douala')::date`;
export const KPI: Record<string, IndicateurKpi> = {
  ventes_caisse: { libelle: "Ventes en caisse (FCFA)", sens: 1, requete: `select coalesce(sum(total_ttc), 0)::float as v from ventes_comptoir where caissier_id = $1 and annulee_le is null and ${SUR("cree_le")}` },
  ecarts_caisse: { libelle: "Écarts de caisse (FCFA)", sens: -1, requete: `select coalesce(sum(abs(ecart)), 0)::float as v from sessions_caisse where caissier_id = $1 and ${SUR("fermee_le")}` },
  encaissements: { libelle: "Encaissements saisis (FCFA)", sens: 1, requete: `select (select coalesce(sum(montant), 0) from paiements where encaisse_par = $1 and annule_le is null and ${SUR("encaisse_le")})::float + (select coalesce(sum(montant), 0) from reglements where encaisse_par = $1 and annule_le is null and ${SUR("encaisse_le")})::float as v` },
  tickets_resolus: { libelle: "Tickets résolus", sens: 1, requete: `select count(*)::float as v from tickets where assigne_a = $1 and ${SUR("resolu_le")}` },
  tickets_retard: { libelle: "Tickets résolus en retard", sens: -1, requete: `select count(*)::float as v from tickets where assigne_a = $1 and resolu_le > echeance and ${SUR("resolu_le")}` },
  ecritures_validees: { libelle: "Écritures validées", sens: 1, requete: `select count(*)::float as v from ecritures where valide_par = $1 and ${SUR("valide_le")}` },
  // Mesures journalières de la performance au quotidien
  taches_terminees: { libelle: "Tâches terminées", sens: 1, requete: `select count(*)::float as v from taches where assigne_a = $1 and statut = 'terminee' and ${SUR("termine_le")}` },
  inscriptions_encaissees: { libelle: "Inscriptions GTA encaissées", sens: 1, requete: `select count(distinct inscription_id)::float as v from paiements where encaisse_par = $1 and annule_le is null and ${SUR("encaisse_le")}` },
  opportunites_gagnees: { libelle: "Opportunités gagnées", sens: 1, requete: `select count(*)::float as v from opportunites where responsable_id = $1 and etape = 'gagne' and ${SUR("clos_le")}` },
  relances_faites: { libelle: "Relances faites", sens: 1, requete: `select count(*)::float as v from relances where auteur_id = $1 and ${SUR("cree_le")}` },
  contacts_clients: { libelle: "Contacts clients enregistrés", sens: 1, requete: `select count(*)::float as v from activites where auteur_id = $1 and type <> 'note' and ${SUR("cree_le")}` },
  // Mesures mensuelles tirées de la performance au quotidien (calculées dans performance.ts)
  moyenne_scores_jour: { libelle: "Moyenne des scores journaliers", sens: 1, mensuel: true, requete: `select avg(s.score)::float as v from scores_jour s join employes e on e.id = s.employe_id where e.utilisateur_id = $1 and to_char(s.jour, 'YYYY-MM') = $2` },
  regularite_rapports: { libelle: "Régularité des rapports (%)", sens: 1, mensuel: true, requete: `select case when count(distinct o.jour) = 0 then null else round(100.0 * count(distinct r.jour) / count(distinct o.jour)) end::float as v
    from employes e join objectifs_jour o on o.employe_id = e.id and to_char(o.jour, 'YYYY-MM') = $2
    left join rapports_jour r on r.employe_id = e.id and r.jour = o.jour and r.statut = 'remis' where e.utilisateur_id = $1` },
  // Mesures d'entité pour les résultats clés automatiques des OKR
  ventes_glomari: {
    libelle: "Ventes GLOMARI : factures, avoirs déduits, et caisse (FCFA)", sens: 1, domaine: "commerce",
    entite: `select (select coalesce(sum(case when type = 'avoir' then -total_ttc else total_ttc end), 0) from documents_vente where type in ('facture', 'avoir') and statut = 'emis' and entite_id = any($1::uuid[]) and date_document between $2 and $3)::float
      + (select coalesce(sum(total_ttc), 0) from ventes_comptoir where annulee_le is null and entite_id = any($1::uuid[]) and ${JOUR_DOUALA("cree_le")} between $2 and $3)::float as v`,
  },
  inscriptions_gta: {
    libelle: "Inscriptions GTA (hors annulées)", sens: 1, domaine: "formation",
    entite: `select count(*)::float as v from inscriptions i join sessions_formation s on s.id = i.session_id where s.entite_id = any($1::uuid[]) and i.statut <> 'annulee' and ${JOUR_DOUALA("i.cree_le")} between $2 and $3`,
  },
  taux_conversion: {
    libelle: "Taux de conversion des opportunités (%)", sens: 1,
    entite: `select case when count(*) = 0 then null else round(100.0 * count(*) filter (where etape = 'gagne') / count(*)) end::float as v
      from opportunites where entite_id = any($1::uuid[]) and etape in ('gagne', 'perdu') and ${JOUR_DOUALA("clos_le")} between $2 and $3`,
  },
  ruptures_stock: {
    libelle: "Articles en rupture de stock", sens: -1, domaine: "commerce",
    entite: `select count(*)::float as v from (select m.produit_id from mouvements_stock m join produits p on p.id = m.produit_id
      where p.suivi_stock and m.entite_id = any($1::uuid[]) and $2::date <= $3::date and ${JOUR_DOUALA("m.cree_le")} <= $3::date group by m.produit_id, m.entite_id having sum(m.quantite) <= 0) x`,
  },
  delai_livraison: {
    libelle: "Délai moyen de livraison (jours)", sens: -1, domaine: "commerce",
    entite: `select round(avg(extract(epoch from (livre_le - cree_le)) / 86400)::numeric, 1)::float as v from colis where statut = 'livre' and entite_id = any($1::uuid[]) and ${JOUR_DOUALA("livre_le")} between $2 and $3`,
  },
  // Mesures mensuelles des OKR pour l'évaluation. La note des OKR ambitieux n'y entre jamais : elle reste une information.
  regularite_points_okr: {
    libelle: "Régularité des points hebdomadaires OKR (%)", sens: 1, mensuel: true,
    requete: `with semaines as (
        select d::date as lundi from generate_series(date_trunc('week', to_date($2 || '-01', 'YYYY-MM-DD')), (to_date($2 || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day'), interval '1 week') d
        where d::date >= to_date($2 || '-01', 'YYYY-MM-DD') - 6 and d::date <= (now() at time zone 'Africa/Douala')::date),
      attendus as (
        select r.id, s.lundi from resultats_cles r join objectifs o on o.id = r.objectif_id join semaines s
          on s.lundi + 6 >= make_date(split_part(o.periode, '-T', 1)::int, split_part(o.periode, '-T', 2)::int * 3 - 2, 1)
         and s.lundi <= (make_date(split_part(o.periode, '-T', 1)::int, split_part(o.periode, '-T', 2)::int * 3 - 2, 1) + interval '3 months' - interval '1 day')
        where r.proprietaire_id = $1 and o.statut in ('actif', 'clos') and s.lundi >= date_trunc('week', r.cree_le at time zone 'Africa/Douala')::date)
      select case when count(*) = 0 then null else round(100.0 * count(p.id) / count(*)) end::float as v
      from attendus a left join points_okr p on p.resultat_id = a.id and p.semaine = a.lundi`,
  },
  atteinte_okr_engages: {
    libelle: "Atteinte des OKR engagés (%)", sens: 1, mensuel: true,
    requete: `select round(avg(coalesce(r.note * 100, least(greatest((r.actuel - r.depart) / nullif(r.cible - r.depart, 0), 0), 1) * 100)))::float as v
      from resultats_cles r join objectifs o on o.id = r.objectif_id
      where r.proprietaire_id = $1 and o.type = 'engage' and o.statut in ('actif', 'clos')
        and o.periode = split_part($2, '-', 1) || '-T' || ((split_part($2, '-', 2)::int + 2) / 3)::text`,
  },
};
/** Valeur d'un indicateur pour une personne sur un jour ou un mois. Null : rien à évaluer. */
export async function valeurKpi(c: Client, code: string, utilisateurId: string, periode: string): Promise<number | null> {
  const k = KPI[code];
  if (!k || !kpiPersonnel(k)) return null;
  if (k.calcul) return k.calcul(c, utilisateurId, periode);
  const { rows: [r] } = await c.query(k.requete!, [utilisateurId, periode]);
  return r.v === null ? null : Number(r.v);
}
/** Atteinte plafonnée à 100 : dépasser ne masque pas un autre indicateur faible. */
export function scoreKpi(sens: 1 | -1, cible: number, realise: number): number {
  if (sens === 1) return cible === 0 ? 100 : Math.min(Math.round((realise * 100) / cible), 100);
  if (realise <= cible) return 100;
  return realise === 0 ? 100 : Math.round((cible * 100) / realise);
}
export function scoreGlobal(lignes: { poids: number; score: number }[]): number {
  const p = lignes.reduce((s, l) => s + l.poids, 0);
  return p ? Math.round(lignes.reduce((s, l) => s + l.poids * l.score, 0) / p) : 0;
}

export function enregistrerCommerce(app: FastifyInstance, pool: pg.Pool, outils: Outils, urlPublique: string): void {
  const { protege, exiger, exigerSurEntite } = outils;
  const ids = async (ctx: Contexte, p: Parameters<typeof entitesAccessibles>[2]) => (await entitesAccessibles(ctx.client, ctx.utilisateurId, p)).map((e) => e.id);
  /** L'argent sort d'un portefeuille de la même branche, jamais à découvert. */
  const sortie = async (ctx: Contexte, portefeuilleId: string, entiteId: string, montant: number, libelle: string) => {
    await exigerSurEntite(ctx, "tresorerie.gerer", entiteId);
    const { rows: [w] } = await ctx.client.query("select id, actif, entite_branche(entite_id) as b, entite_branche($2) as e from portefeuilles where id = $1 for update", [portefeuilleId, entiteId]);
    if (!w) throw new ErreurApi(404, "introuvable");
    if (w.b !== w.e) throw new ErreurApi(409, "transfert_autre_branche");
    if (!w.actif) throw new ErreurApi(409, "portefeuille_inactif");
    const { rows: [{ s }] } = await ctx.client.query("select coalesce(sum(montant), 0)::int8 as s from mouvements_portefeuille where portefeuille_id = $1", [w.id]);
    if (montant > s) throw new ErreurApi(409, "solde_portefeuille_insuffisant");
    await ctx.client.query("insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, auteur_id, source_type) values ($1, $2, 'sortie', $3, $4, $5, 'commerce')", [ctx.organisationId, w.id, -montant, libelle, ctx.utilisateurId]);
  };

  // GLOMARI Care
  app.post<{ Body: { entiteId: string; tiersId: string; produitId?: string; numeroSerie?: string; referenceAchat?: string; dateAchat?: string; canal?: string; demande: string; motif: string; quantite?: number; delaiJours: number } }>("/sav", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "tiersId", "demande", "motif", "delaiJours"],
        properties: {
          entiteId: uuid, tiersId: uuid, produitId: uuid, numeroSerie: texte(100), referenceAchat: texte(100), dateAchat: date, canal: { type: "string", enum: ["telephone", "whatsapp", "email", "site", "application", "magasin"] },
          demande: { type: "string", enum: ["retour", "echange", "remboursement", "reparation"] }, motif: texte(1000), quantite: { type: "number", exclusiveMinimum: 0, maximum: 1000000 }, delaiJours: { type: "integer", minimum: 0, maximum: 365 },
        },
      },
    },
  }, async (req, reponse) => {
    const d = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "care.gerer", b.entiteId);
      await lierTiers(ctx, b.tiersId, b.entiteId);
      let garantie: boolean | null = null;
      if (b.produitId) {
        const { rows: [p] } = await ctx.client.query("select garantie_mois, entite_branche(entite_id) as b, entite_branche($2) as e from produits where id = $1", [b.produitId, b.entiteId]);
        if (!p || p.b !== p.e) throw new ErreurApi(404, "introuvable");
        if (p.garantie_mois !== null && b.dateAchat) {
          garantie = (await ctx.client.query("select ($1::date + make_interval(months => $2))::date >= (now() at time zone 'Africa/Douala')::date as ok", [b.dateAchat, p.garantie_mois])).rows[0].ok;
        }
      }
      const numero = await prochainNumero(ctx.client, `SAV-${new Date().getFullYear()}`);
      return (await ctx.client.query(
        `insert into dossiers_sav (organisation_id, entite_id, numero, tiers_id, produit_id, numero_serie, reference_achat, date_achat, canal, demande, motif, quantite, sous_garantie, echeance, cree_par)
         values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9, 'magasin'), $10, $11, $12, $13, (now() at time zone 'Africa/Douala')::date + $14::int, $15) returning *`,
        [ctx.organisationId, b.entiteId, numero, b.tiersId, b.produitId ?? null, b.numeroSerie ?? null, b.referenceAchat ?? null, b.dateAchat ?? null, b.canal ?? null, b.demande, b.motif, b.quantite ?? 1, garantie, b.delaiJours, ctx.utilisateurId],
      )).rows[0];
    });
    return reponse.status(201).send(d);
  });
  app.get("/sav", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "care.voir");
      const liste = await ids(ctx, "care.voir");
      const { rows } = await ctx.client.query(
        `select d.*, t.nom as client, p.nom as produit, f.nom as fournisseur, d.statut not in ('clos', 'refuse') and d.echeance < (now() at time zone 'Africa/Douala')::date as en_retard
         from dossiers_sav d join tiers t on t.id = d.tiers_id left join produits p on p.id = d.produit_id left join tiers f on f.id = d.fournisseur_id
         where d.entite_id = any($1::uuid[]) order by d.statut in ('clos', 'refuse'), d.echeance limit 1000`, [liste],
      );
      const { rows: motifs } = await ctx.client.query(
        `select coalesce(p.nom, 'Sans produit') as produit, count(*)::int as dossiers, coalesce(sum(d.a_refacturer), 0)::int8 as a_refacturer
         from dossiers_sav d left join produits p on p.id = d.produit_id where d.entite_id = any($1::uuid[]) group by 1 order by 2 desc limit 20`, [liste],
      );
      return { dossiers: rows, parProduit: motifs };
    }),
  );
  const dossier = async (ctx: Contexte, id: string) => {
    const { rows: [d] } = await ctx.client.query("select * from dossiers_sav where id = $1 for update", [id]);
    if (!d) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, "care.gerer", d.entite_id);
    return d;
  };
  const SUIVANT: Record<string, string[]> = { ouvert: ["autorise", "refuse"], autorise: ["recu"], decide: ["clos"] };
  app.post<{ Params: { id: string }; Body: { statut: string; note?: string } }>("/sav/:id/etape", {
    schema: { params: paramId, body: { type: "object", required: ["statut"], properties: { statut: { type: "string", enum: ["autorise", "recu", "clos", "refuse"] }, note: texte(1000) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const d = await dossier(ctx, req.params.id);
      if (!SUIVANT[d.statut]?.includes(req.body.statut)) throw new ErreurApi(409, "etape_impossible");
      if (req.body.statut === "refuse" && !req.body.note) throw new ErreurApi(400, "motif_obligatoire");
      await ctx.client.query("update dossiers_sav set statut = $2, note = coalesce($3, note), clos_le = case when $2 in ('clos', 'refuse') then now() end where id = $1", [d.id, req.body.statut, req.body.note ?? null]);
      return { statut: req.body.statut };
    }),
  );
  /** Après contrôle du produit reçu, la décision met à jour le stock et, s'il y a lieu, le portefeuille. */
  app.post<{ Params: { id: string }; Body: { decision: string; entrepotId?: string; montant?: number; portefeuilleId?: string; fournisseurId?: string; aRefacturer?: number; note?: string } }>("/sav/:id/decision", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["decision"],
        properties: { decision: { type: "string", enum: ["remise_stock", "rebut", "reparation", "remplacement", "avoir", "remboursement"] }, entrepotId: uuid, montant: entier, portefeuilleId: uuid, fournisseurId: uuid, aRefacturer: entier, note: texte(1000) },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const d = await dossier(ctx, req.params.id);
      if (d.statut !== "recu") throw new ErreurApi(409, "etape_impossible");
      const b = req.body;
      if (b.fournisseurId) await lierTiers(ctx, b.fournisseurId, d.entite_id);
      if (b.decision === "remise_stock") {
        if (!d.produit_id || !b.entrepotId) throw new ErreurApi(400, "entrepot_obligatoire");
        await exigerSurEntite(ctx, "stocks.gerer", b.entrepotId);
        const { rows: [p] } = await ctx.client.query("select cout_moyen, suivi_stock from produits where id = $1 for update", [d.produit_id]);
        if (!p.suivi_stock) throw new ErreurApi(409, "produit_sans_stock");
        await entrerEnStock(ctx, b.entrepotId, d.produit_id, Number(d.quantite), p.cout_moyen, "retour", `Retour SAV ${d.numero}`, d.numero);
      }
      if (b.decision === "remboursement") {
        if (!b.montant || !b.portefeuilleId) throw new ErreurApi(400, "donnees_invalides");
        await sortie(ctx, b.portefeuilleId, d.entite_id, b.montant, `Remboursement SAV ${d.numero}`);
      }
      await ctx.client.query(
        "update dossiers_sav set statut = 'decide', decision = $2, montant_rembourse = $3, portefeuille_id = $4, fournisseur_id = $5, a_refacturer = $6, note = coalesce($7, note) where id = $1",
        [d.id, b.decision, b.decision === "remboursement" ? b.montant : 0, b.decision === "remboursement" ? b.portefeuilleId : null, b.fournisseurId ?? null, b.aRefacturer ?? 0, b.note ?? null],
      );
      return { statut: "decide", decision: b.decision };
    }),
  );

  // Marketing
  app.post<{ Body: { entiteId: string; nom: string; canal: string; debut?: string; fin?: string; cout?: number; contacts?: number } }>("/campagnes", {
    schema: { body: { type: "object", required: ["entiteId", "nom", "canal"], properties: { entiteId: uuid, nom: texte(200), canal: texte(50), debut: date, fin: date, cout: entier, contacts: { type: "integer", minimum: 0, maximum: 100000000 } } } },
  }, async (req, reponse) => {
    const c = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "marketing.gerer", b.entiteId);
      return (await ctx.client.query("insert into campagnes (organisation_id, entite_id, nom, canal, debut, fin, cout, contacts) values ($1, $2, $3, $4, $5, $6, $7, $8) returning *", [ctx.organisationId, b.entiteId, b.nom, b.canal, b.debut ?? null, b.fin ?? null, b.cout ?? 0, b.contacts ?? 0])).rows[0];
    });
    return reponse.status(201).send(c);
  });
  /** Retour sur investissement à partir des factures rattachées, avoirs déduits. */
  app.get("/campagnes", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "marketing.voir");
      const { rows } = await ctx.client.query(
        `select c.*, e.nom as entite, count(v.document_id)::int as ventes, count(distinct d.tiers_id)::int as clients,
           coalesce(sum(d.total_ht - (select coalesce(sum(a.total_ht), 0) from documents_vente a where a.origine_id = d.id and a.type = 'avoir' and a.statut = 'emis')), 0)::int8 as chiffre
         from campagnes c join entites e on e.id = c.entite_id left join ventes_campagne v on v.campagne_id = c.id left join documents_vente d on d.id = v.document_id
         where c.entite_id = any($1::uuid[]) group by c.id, e.nom order by c.cree_le desc limit 300`,
        [await ids(ctx, "marketing.voir")],
      );
      return rows.map((c) => ({ ...c, roi: c.cout ? Math.round(((c.chiffre - c.cout) * 100) / c.cout) : null, cout_par_client: c.clients ? Math.round(c.cout / c.clients) : null }));
    }),
  );
  app.patch<{ Params: { id: string }; Body: { cout?: number; contacts?: number } }>("/campagnes/:id", {
    schema: { params: paramId, body: { type: "object", minProperties: 1, properties: { cout: entier, contacts: { type: "integer", minimum: 0, maximum: 100000000 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [c] } = await ctx.client.query("select entite_id from campagnes where id = $1", [req.params.id]);
      if (!c) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "marketing.gerer", c.entite_id);
      await ctx.client.query("update campagnes set cout = coalesce($2, cout), contacts = coalesce($3, contacts) where id = $1", [req.params.id, req.body.cout ?? null, req.body.contacts ?? null]);
      return { modifie: true };
    }),
  );
  app.post<{ Params: { id: string }; Body: { numeroFacture: string } }>("/campagnes/:id/ventes", {
    schema: { params: paramId, body: { type: "object", required: ["numeroFacture"], properties: { numeroFacture: texte(100) } } },
  }, async (req, reponse) => {
    await protege(req, async (ctx) => {
      const { rows: [c] } = await ctx.client.query("select entite_id, entite_branche(entite_id) as b from campagnes where id = $1", [req.params.id]);
      if (!c) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "marketing.gerer", c.entite_id);
      const { rows: [d] } = await ctx.client.query("select id, entite_branche(entite_id) as b from documents_vente where numero = $1 and type = 'facture' and statut <> 'brouillon'", [req.body.numeroFacture.trim()]);
      if (!d || d.b !== c.b) throw new ErreurApi(404, "introuvable");
      await ctx.client.query("insert into ventes_campagne (organisation_id, document_id, campagne_id) values ($1, $2, $3)", [ctx.organisationId, d.id, req.params.id]);
    });
    return reponse.status(201).send({ rattachee: true });
  });

  // Avis de tout le groupe : seul un vrai client reçoit un lien
  app.post<{ Body: { entiteId: string; cibleType: string; cible: string; sourceType: string; sourceId: string } }>("/retours/demandes", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "cibleType", "cible", "sourceType", "sourceId"],
        properties: { entiteId: uuid, cibleType: { type: "string", enum: ["produit", "vendeur", "livraison", "magasin", "sav", "autre"] }, cible: texte(200), sourceType: { type: "string", enum: ["facture", "colis", "sav"] }, sourceId: uuid },
      },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "retours.gerer", b.entiteId);
      const requetes: Record<string, string> = {
        facture: "select tiers_id, entite_id from documents_vente where id = $1 and type = 'facture' and statut <> 'brouillon'",
        colis: "select d.tiers_id, c.entite_id from colis c left join documents_vente d on d.id = c.document_id where c.id = $1 and c.statut = 'livre'",
        sav: "select tiers_id, entite_id from dossiers_sav where id = $1 and statut in ('decide', 'clos')",
      };
      const { rows: [s] } = await ctx.client.query(requetes[b.sourceType]!, [b.sourceId]);
      if (!s) throw new ErreurApi(409, "achat_non_verifie");
      const { rows: [m] } = await ctx.client.query("select entite_branche($1) = entite_branche($2) as ok", [s.entite_id, b.entiteId]);
      if (!m.ok) throw new ErreurApi(409, "achat_non_verifie");
      const code = randomBytes(16).toString("base64url");
      const { rows: [x] } = await ctx.client.query(
        `insert into demandes_retour (organisation_id, entite_id, code, cible_type, cible, source_type, source_id, tiers_id) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [ctx.organisationId, b.entiteId, code, b.cibleType, b.cible, b.sourceType, b.sourceId, s.tiers_id ?? null],
      );
      return { id: x.id, lien: `${urlPublique}/evaluer.html?c=${ctx.organisationId}.${code}` };
    });
    return reponse.status(201).send(r);
  });
  const parCode = <T>(code: string, fn: (c: Client, d: Record<string, any>, org: string) => Promise<T>) => {
    if (!CODE.test(code)) throw new ErreurApi(404, "introuvable");
    const [org, secret] = code.split(".") as [string, string];
    return dansOrganisation(pool, org, async (c) => {
      const { rows: [d] } = await c.query("select * from demandes_retour where code = $1 for update", [secret]);
      if (!d) throw new ErreurApi(404, "introuvable");
      return fn(c, d, org);
    }).catch((e) => { if (e.code === "22P02") throw new ErreurApi(404, "introuvable"); throw e; });
  };
  app.get<{ Params: { code: string } }>("/evaluer/:code", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) =>
    parCode(req.params.code, async (_c, d) => ({ cible: d.cible, repondu: !!d.repondu_le })),
  );
  /** Une note basse ouvre un ticket, sans jamais être masquée pour cette raison. */
  app.post<{ Params: { code: string }; Body: { note: number; commentaire?: string; temoignage?: boolean } }>("/evaluer/:code", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: { body: { type: "object", required: ["note"], properties: { note: { type: "integer", minimum: 1, maximum: 5 }, commentaire: { type: "string", maxLength: 2000 }, temoignage: { type: "boolean" } } } },
  }, async (req, reponse) => {
    await parCode(req.params.code, async (c, d, org) => {
      if (d.repondu_le) throw new ErreurApi(409, "deja_repondu");
      const b = req.body;
      await c.query(
        "insert into retours_clients (organisation_id, demande_id, note, commentaire, temoignage, statut) values ($1, $2, $3, $4, $5, $6)",
        [org, d.id, b.note, b.commentaire?.trim() || null, b.temoignage ?? false, aModerer(b.commentaire) ? "a_moderer" : "publie"],
      );
      await c.query("update demandes_retour set repondu_le = now() where id = $1", [d.id]);
      if (b.note <= 2 && d.tiers_id) {
        const numero = await prochainNumero(c, `TIC-${new Date().getFullYear()}`);
        await c.query(
          "insert into tickets (organisation_id, entite_id, numero, tiers_id, sujet, canal, priorite, echeance) values ($1, $2, $3, $4, $5, 'site', 'haute', now() + interval '48 hours')",
          [org, d.entite_id, numero, d.tiers_id, `Avis de ${b.note}/5 : ${d.cible}`.slice(0, 200)],
        );
      }
    });
    return reponse.status(201).send({ merci: true });
  });
  app.get("/retours", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "retours.voir");
      const liste = await ids(ctx, "retours.voir");
      const [avis, stats] = await Promise.all([
        ctx.client.query(
          `select r.id, r.note, r.commentaire, r.statut, r.reponse, r.temoignage, r.motif_moderation, r.cree_le, d.cible, d.cible_type, d.source_type from retours_clients r join demandes_retour d on d.id = r.demande_id
           where d.entite_id = any($1::uuid[]) order by r.statut = 'a_moderer' desc, r.cree_le desc limit 500`, [liste]),
        ctx.client.query(
          `select d.cible_type, d.cible, round(avg(r.note), 1)::float as moyenne, count(*)::int as avis from retours_clients r join demandes_retour d on d.id = r.demande_id
           where d.entite_id = any($1::uuid[]) and r.statut = 'publie' group by 1, 2 order by moyenne limit 100`, [liste]),
      ]);
      return { avis: avis.rows, moyennes: stats.rows };
    }),
  );
  app.post<{ Params: { id: string }; Body: { statut?: string; motif?: string; reponse?: string } }>("/retours/:id", {
    schema: { params: paramId, body: { type: "object", minProperties: 1, properties: { statut: { type: "string", enum: ["publie", "masque"] }, motif: { type: "string", minLength: 5, maxLength: 300 }, reponse: texte(2000) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [r] } = await ctx.client.query("select d.entite_id from retours_clients r join demandes_retour d on d.id = r.demande_id where r.id = $1", [req.params.id]);
      if (!r) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "retours.gerer", r.entite_id);
      const b = req.body;
      if (b.statut === "masque" && !b.motif) throw new ErreurApi(400, "motif_obligatoire");
      await ctx.client.query("update retours_clients set statut = coalesce($2, statut), motif_moderation = coalesce($3, motif_moderation), reponse = coalesce($4, reponse) where id = $1", [req.params.id, b.statut ?? null, b.motif ?? null, b.reponse ?? null]);
      return { modifie: true };
    }),
  );

  // Prix par palier et comptes professionnels
  app.put<{ Params: { id: string }; Body: { actif: boolean; paliers: { quantiteMin: number; prix: number }[] } }>("/produits/:id/paliers", {
    schema: {
      params: paramId,
      body: { type: "object", required: ["actif", "paliers"], properties: { actif: { type: "boolean" }, paliers: { type: "array", maxItems: 9, items: { type: "object", required: ["quantiteMin", "prix"], properties: { quantiteMin: { type: "number", exclusiveMinimum: 1, maximum: 100000000 }, prix: entier } } } } },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [p] } = await ctx.client.query("select * from produits where id = $1 for update", [req.params.id]);
      if (!p) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "catalogue.gerer", p.entite_id);
      const tries = [...req.body.paliers].sort((a, b) => a.quantiteMin - b.quantiteMin);
      let avant = p.prix_vente as number;
      for (const x of tries) {
        if (x.prix > avant) throw new ErreurApi(400, "paliers_non_degressifs");
        if (x.prix < p.cout_moyen) throw new ErreurApi(409, "palier_sous_le_cout", { cout: p.cout_moyen, prix: x.prix });
        avant = x.prix;
      }
      if (new Set(tries.map((x) => x.quantiteMin)).size !== tries.length) throw new ErreurApi(400, "donnees_invalides");
      await ctx.client.query("delete from paliers_prix where produit_id = $1", [p.id]);
      for (const x of tries) await ctx.client.query("insert into paliers_prix (organisation_id, produit_id, quantite_min, prix) values ($1, $2, $3, $4)", [ctx.organisationId, p.id, x.quantiteMin, x.prix]);
      await ctx.client.query("update produits set paliers_actif = $2 where id = $1", [p.id, req.body.actif]);
      await ctx.client.query("select journal_evenement('catalogue.paliers', $1)", [JSON.stringify({ produit: p.id, actif: req.body.actif, paliers: tries })]);
      return { actif: req.body.actif, paliers: tries };
    }),
  );
  app.get<{ Params: { id: string } }>("/produits/:id/paliers", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [p] } = await ctx.client.query("select entite_id from produits where id = $1", [req.params.id]);
      if (!p) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "catalogue.gerer", p.entite_id);
      return (await ctx.client.query("select quantite_min::float, prix from paliers_prix where produit_id = $1 order by quantite_min", [req.params.id])).rows;
    }),
  );
  app.put<{ Params: { id: string }; Body: { entiteId: string; categorie: string; plafondCredit: number; delaiJours: number; verifieLe?: string } }>("/tiers/:id/compte-pro", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["entiteId", "categorie", "plafondCredit", "delaiJours"],
        properties: { entiteId: uuid, categorie: { type: "string", enum: ["grossiste", "demi_grossiste", "detaillant", "revendeur", "entreprise", "institution"] }, plafondCredit: entier, delaiJours: { type: "integer", minimum: 0, maximum: 365 }, verifieLe: date },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "facturation.administrer", b.entiteId);
      await lierTiers(ctx, req.params.id, b.entiteId);
      await ctx.client.query(
        `insert into comptes_pro (organisation_id, tiers_id, categorie, plafond_credit, delai_jours, verifie_le) values ($1, $2, $3, $4, $5, $6)
         on conflict (organisation_id, tiers_id) do update set categorie = excluded.categorie, plafond_credit = excluded.plafond_credit, delai_jours = excluded.delai_jours, verifie_le = excluded.verifie_le`,
        [ctx.organisationId, req.params.id, b.categorie, b.plafondCredit, b.delaiJours, b.verifieLe ?? null],
      );
      await ctx.client.query("select journal_evenement('credit.plafond', $1)", [JSON.stringify({ tiers: req.params.id, plafond: b.plafondCredit })]);
      return controleCredit(ctx.client, req.params.id, 0);
    }),
  );
  app.get("/comptes-pro", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "facturation.voir");
      // Chacun ne voit que les clients de ses branches, et jamais le secret du lien.
      const v = await branchesVisibles(ctx.client, ctx.utilisateurId, "facturation.voir");
      const { rows } = await ctx.client.query(
        "select c.*, t.nom, t.branche_id from comptes_pro c join tiers t on t.id = c.tiers_id where $1 or t.branche_id = any($2::uuid[]) order by t.nom limit 1000", [v.tout, v.ids],
      );
      const out = [];
      for (const { code_portail, ...c } of rows) out.push({ ...c, portail: !!code_portail, encours: (await controleCredit(ctx.client, c.tiers_id, 0))?.encours ?? null });
      return out;
    }),
  );

  // Marketplace
  app.post<{ Body: { entiteId: string; tiersId: string; tauxCommission: number } }>("/vendeurs", {
    schema: { body: { type: "object", required: ["entiteId", "tiersId", "tauxCommission"], properties: { entiteId: uuid, tiersId: uuid, tauxCommission: { type: "number", minimum: 0, maximum: 100 } } } },
  }, async (req, reponse) => {
    const v = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "reseau.gerer", b.entiteId);
      await lierTiers(ctx, b.tiersId, b.entiteId);
      return (await ctx.client.query("insert into vendeurs (organisation_id, entite_id, tiers_id, taux_commission) values ($1, $2, $3, $4) returning *", [ctx.organisationId, b.entiteId, b.tiersId, b.tauxCommission])).rows[0];
    });
    return reponse.status(201).send(v);
  });
  app.get("/vendeurs", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "reseau.voir");
      return (await ctx.client.query(
        `select v.*, v.taux_commission::float as taux, t.nom,
           coalesce(sum(c.montant - c.commission - c.retenue) filter (where c.statut = 'livree'), 0)::int8 as a_reverser, coalesce(sum(c.commission) filter (where c.statut in ('livree', 'reversee')), 0)::int8 as commissions,
           count(c.id) filter (where c.statut = 'litige')::int as litiges,
           (select json_agg(json_build_object('id', x.id, 'reference', x.reference, 'montant', x.montant, 'commission', x.commission, 'statut', x.statut)) from commandes_vendeur x where x.vendeur_id = v.id and x.statut in ('recue', 'livree', 'litige')) as ouvertes
         from vendeurs v join tiers t on t.id = v.tiers_id left join commandes_vendeur c on c.vendeur_id = v.id where v.entite_id = any($1::uuid[]) group by v.id, t.nom order by t.nom limit 500`,
        [await ids(ctx, "reseau.voir")],
      )).rows;
    }),
  );
  const vendeur = async (ctx: Contexte, id: string) => {
    const { rows: [v] } = await ctx.client.query("select * from vendeurs where id = $1", [id]);
    if (!v) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, "reseau.gerer", v.entite_id);
    return v;
  };
  app.post<{ Params: { id: string }; Body: { statut: string } }>("/vendeurs/:id/statut", {
    schema: { params: paramId, body: { type: "object", required: ["statut"], properties: { statut: { type: "string", enum: ["verifie", "suspendu"] } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await vendeur(ctx, req.params.id);
      await ctx.client.query("update vendeurs set statut = $2, verifie_le = case when $2 = 'verifie' then current_date else verifie_le end where id = $1", [req.params.id, req.body.statut]);
      return { statut: req.body.statut };
    }),
  );
  app.post<{ Params: { id: string }; Body: { reference: string; montant: number } }>("/vendeurs/:id/commandes", {
    schema: { params: paramId, body: { type: "object", required: ["reference", "montant"], properties: { reference: texte(100), montant: { ...entier, minimum: 1 } } } },
  }, async (req, reponse) => {
    const c = await protege(req, async (ctx) => {
      const v = await vendeur(ctx, req.params.id);
      if (v.statut !== "verifie") throw new ErreurApi(409, "vendeur_non_verifie");
      const taux = Number(v.taux_commission);
      return (await ctx.client.query(
        "insert into commandes_vendeur (organisation_id, vendeur_id, reference, montant, taux, commission) values ($1, $2, $3, $4, $5, $6) returning *",
        [ctx.organisationId, v.id, req.body.reference, req.body.montant, taux, Math.round((req.body.montant * taux) / 100)],
      )).rows[0];
    });
    return reponse.status(201).send(c);
  });
  /** Le vendeur n'est reversé qu'après la livraison, et jamais pendant un litige. */
  app.post<{ Params: { id: string }; Body: { action: string; retenue?: number; motif?: string; portefeuilleId?: string } }>("/commandes-vendeur/:id", {
    schema: { params: paramId, body: { type: "object", required: ["action"], properties: { action: { type: "string", enum: ["livrer", "litige", "lever_litige", "annuler", "reverser"] }, retenue: entier, motif: texte(500), portefeuilleId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [c] } = await ctx.client.query("select c.*, v.entite_id from commandes_vendeur c join vendeurs v on v.id = c.vendeur_id where c.id = $1 for update of c", [req.params.id]);
      if (!c) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "reseau.gerer", c.entite_id);
      const b = req.body;
      const permis: Record<string, string[]> = { livrer: ["recue"], litige: ["recue", "livree"], lever_litige: ["litige"], annuler: ["recue", "litige"], reverser: ["livree"] };
      if (!permis[b.action]!.includes(c.statut)) throw new ErreurApi(409, "etape_impossible");
      if (["litige", "annuler"].includes(b.action) && !b.motif) throw new ErreurApi(400, "motif_obligatoire");
      let statut = { livrer: "livree", litige: "litige", lever_litige: "livree", annuler: "annulee", reverser: "reversee" }[b.action]!;
      const retenue = b.retenue ?? c.retenue;
      if (b.action === "reverser") {
        if (!b.portefeuilleId) throw new ErreurApi(400, "donnees_invalides");
        const net = c.montant - c.commission - retenue;
        if (net < 0) throw new ErreurApi(400, "donnees_invalides");
        if (net > 0) await sortie(ctx, b.portefeuilleId, c.entite_id, net, `Reversement vendeur ${c.reference}`);
      }
      await ctx.client.query("update commandes_vendeur set statut = $2, retenue = $3, motif = coalesce($4, motif), portefeuille_id = coalesce($5, portefeuille_id), reverse_le = case when $2 = 'reversee' then now() end where id = $1", [c.id, statut, retenue, b.motif ?? null, b.portefeuilleId ?? null]);
      statut = String(statut);
      return { statut };
    }),
  );

  // Franchises
  app.post<{ Body: { entiteId: string; tiersId: string; ville?: string; droitEntree?: number; tauxRedevance?: number } }>("/franchises", {
    schema: { body: { type: "object", required: ["entiteId", "tiersId"], properties: { entiteId: uuid, tiersId: uuid, ville: texte(100), droitEntree: entier, tauxRedevance: { type: "number", minimum: 0, maximum: 100 } } } },
  }, async (req, reponse) => {
    const f = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "reseau.gerer", b.entiteId);
      await lierTiers(ctx, b.tiersId, b.entiteId);
      return (await ctx.client.query("insert into franchises (organisation_id, entite_id, tiers_id, ville, droit_entree, taux_redevance) values ($1, $2, $3, $4, $5, $6) returning *", [ctx.organisationId, b.entiteId, b.tiersId, b.ville ?? null, b.droitEntree ?? 0, b.tauxRedevance ?? 0])).rows[0];
    });
    return reponse.status(201).send(f);
  });
  app.get("/franchises", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "reseau.voir");
      return (await ctx.client.query(
        `select f.*, f.taux_redevance::float as taux, t.nom, coalesce(sum(v.ventes), 0)::int8 as ventes, coalesce(sum(v.redevance) filter (where v.payee_le is null), 0)::int8 as redevance_due, round(avg(v.score_audit))::int as score
         from franchises f join tiers t on t.id = f.tiers_id left join ventes_franchise v on v.franchise_id = f.id where f.entite_id = any($1::uuid[]) group by f.id, t.nom order by ventes desc limit 500`,
        [await ids(ctx, "reseau.voir")],
      )).rows;
    }),
  );
  const franchise = async (ctx: Contexte, id: string) => {
    const { rows: [f] } = await ctx.client.query("select * from franchises where id = $1", [id]);
    if (!f) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, "reseau.gerer", f.entite_id);
    return f;
  };
  app.patch<{ Params: { id: string }; Body: { statut?: string; finContrat?: string; tauxRedevance?: number } }>("/franchises/:id", {
    schema: { params: paramId, body: { type: "object", minProperties: 1, properties: { statut: { type: "string", enum: ["candidature", "etude", "contrat", "actif", "resilie"] }, finContrat: date, tauxRedevance: { type: "number", minimum: 0, maximum: 100 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await franchise(ctx, req.params.id);
      const b = req.body;
      await ctx.client.query("update franchises set statut = coalesce($2, statut), fin_contrat = coalesce($3, fin_contrat), taux_redevance = coalesce($4, taux_redevance) where id = $1", [req.params.id, b.statut ?? null, b.finContrat ?? null, b.tauxRedevance ?? null]);
      return { modifie: true };
    }),
  );
  app.post<{ Params: { id: string }; Body: { periode: string; ventes: number; scoreAudit?: number } }>("/franchises/:id/ventes", {
    schema: { params: paramId, body: { type: "object", required: ["periode", "ventes"], properties: { periode, ventes: entier, scoreAudit: { type: "integer", minimum: 0, maximum: 100 } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const f = await franchise(ctx, req.params.id);
      if (f.statut !== "actif") throw new ErreurApi(409, "franchise_inactive");
      const taux = Number(f.taux_redevance);
      return (await ctx.client.query(
        "insert into ventes_franchise (organisation_id, franchise_id, periode, ventes, taux, redevance, score_audit) values ($1, $2, $3, $4, $5, $6, $7) returning *",
        [ctx.organisationId, f.id, req.body.periode, req.body.ventes, taux, Math.round((req.body.ventes * taux) / 100), req.body.scoreAudit ?? null],
      )).rows[0];
    });
    return reponse.status(201).send(r);
  });

  // Évaluation : le système calcule et recommande, une personne décide
  app.get("/evaluations/kpi", async (req) => protege(req, async (ctx) => { await exiger(ctx, "rh.evaluer"); return kpiPersonnels().map(([code, k]) => ({ code, libelle: k.libelle, sens: k.sens })); }));
  app.put<{ Body: { entiteId: string; poste: string; lignes: { kpi: string; poids: number; cible: number }[] } }>("/evaluations/regles", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "poste", "lignes"],
        properties: { entiteId: uuid, poste: texte(200), lignes: { type: "array", minItems: 1, maxItems: 15, items: { type: "object", required: ["kpi", "poids", "cible"], properties: { kpi: { type: "string", enum: kpiPersonnels().map(([code]) => code) }, poids: { type: "integer", minimum: 1, maximum: 100 }, cible: { type: "number", minimum: 0 } } } } },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "rh.evaluer", b.entiteId);
      await ctx.client.query("delete from regles_evaluation where entite_id = $1 and poste = $2", [b.entiteId, b.poste]);
      for (const l of b.lignes) await ctx.client.query("insert into regles_evaluation (organisation_id, entite_id, poste, kpi, poids, cible) values ($1, $2, $3, $4, $5, $6)", [ctx.organisationId, b.entiteId, b.poste, l.kpi, l.poids, l.cible]);
      return { regles: b.lignes.length };
    }),
  );
  app.patch<{ Params: { id: string }; Body: { utilisateurId: string | null } }>("/employes/:id/compte", {
    schema: { params: paramId, body: { type: "object", required: ["utilisateurId"], properties: { utilisateurId: { type: ["string", "null"], format: "uuid" } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [e] } = await ctx.client.query("select entite_id from employes where id = $1", [req.params.id]);
      if (!e) throw new ErreurApi(404, "introuvable");
      // Relier un compte ouvre les bulletins de la fiche : même exigence que pour lire un salaire.
      await exigerSurEntite(ctx, "rh.paie", e.entite_id);
      const { rows: [actuel] } = await ctx.client.query("select utilisateur_id from employes where id = $1 for update", [req.params.id]);
      if (req.body.utilisateurId) {
        const { rows: [deja] } = await ctx.client.query("select 1 from employes where utilisateur_id = $1 and id <> $2", [req.body.utilisateurId, req.params.id]);
        if (deja) throw new ErreurApi(409, "compte_deja_lie");
        if (actuel.utilisateur_id && actuel.utilisateur_id !== req.body.utilisateurId) throw new ErreurApi(409, "fiche_deja_reliee");
      }
      await ctx.client.query("update employes set utilisateur_id = $2 where id = $1", [req.params.id, req.body.utilisateurId]);
      await ctx.client.query("select journal_evenement('rh.compte_relie', $1)", [JSON.stringify({ employe: req.params.id, compte: req.body.utilisateurId, ancien: actuel.utilisateur_id })]);
      return { lie: !!req.body.utilisateurId };
    }),
  );
  const CALCUL = async (ctx: Contexte, e: Record<string, any>, p: string) => {
    if (!e.utilisateur_id) throw new ErreurApi(409, "employe_sans_compte");
    const { rows: regles } = await ctx.client.query("select kpi, poids, cible::float from regles_evaluation where entite_id = $1 and poste = $2", [e.entite_id, e.poste]);
    if (!regles.length) throw new ErreurApi(409, "poste_sans_regles");
    const lignes = [];
    for (const r of regles) {
      const k = KPI[r.kpi]!;
      const v = await valeurKpi(ctx.client, r.kpi, e.utilisateur_id, p);
      // « Non évalué » (par exemple moins de 3 propositions dans le mois) : la ligne est montrée mais ne pèse pas.
      lignes.push({ kpi: r.kpi, libelle: k.libelle, poids: r.poids, cible: r.cible, realise: v, score: v === null ? null : scoreKpi(k.sens, r.cible, v), non_evalue: v === null });
    }
    return { lignes, score: scoreGlobal(lignes.filter((l) => l.score !== null) as { poids: number; score: number }[]) };
  };
  app.post<{ Body: { employeId: string; periode: string } }>("/evaluations", {
    schema: { body: { type: "object", required: ["employeId", "periode"], properties: { employeId: uuid, periode } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const { rows: [e] } = await ctx.client.query("select * from employes where id = $1", [req.body.employeId]);
      if (!e) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "rh.evaluer", e.entite_id);
      const c = await CALCUL(ctx, e, req.body.periode);
      return (await ctx.client.query(
        "insert into evaluations (organisation_id, employe_id, periode, lignes, score, cree_par) values ($1, $2, $3, $4, $5, $6) returning *",
        [ctx.organisationId, e.id, req.body.periode, JSON.stringify(c.lignes), c.score, ctx.utilisateurId],
      )).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/evaluations", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "rh.evaluer");
      return (await ctx.client.query(
        "select v.*, e.nom, e.poste, e.entite_id from evaluations v join employes e on e.id = v.employe_id where e.entite_id = any($1::uuid[]) order by v.periode desc, e.nom limit 500",
        [await ids(ctx, "rh.evaluer")],
      )).rows;
    }),
  );
  /** Le responsable contextualise, par exemple une absence justifiée, puis partage avec le collaborateur. */
  app.post<{ Params: { id: string }; Body: { commentaire?: string; statut: string } }>("/evaluations/:id/suivi", {
    schema: { params: paramId, body: { type: "object", required: ["statut"], properties: { commentaire: texte(3000), statut: { type: "string", enum: ["partagee", "close"] } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [v] } = await ctx.client.query("select e.entite_id from evaluations v join employes e on e.id = v.employe_id where v.id = $1", [req.params.id]);
      if (!v) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "rh.evaluer", v.entite_id);
      await ctx.client.query("update evaluations set statut = $2, commentaire_responsable = coalesce($3, commentaire_responsable) where id = $1", [req.params.id, req.body.statut, req.body.commentaire ?? null]);
      return { statut: req.body.statut };
    }),
  );
  /** Chacun voit uniquement ses propres évaluations partagées, et peut les contester. */
  app.get("/moi/evaluations", async (req) =>
    protege(req, async (ctx) => (await ctx.client.query(
      "select v.id, v.periode, v.lignes, v.score, v.statut, v.commentaire_responsable, v.commentaire_employe from evaluations v join employes e on e.id = v.employe_id where e.utilisateur_id = $1 and v.statut <> 'brouillon' order by v.periode desc",
      [ctx.utilisateurId],
    )).rows),
  );
  app.post<{ Params: { id: string }; Body: { commentaire: string } }>("/moi/evaluations/:id/contestation", {
    schema: { params: paramId, body: { type: "object", required: ["commentaire"], properties: { commentaire: { type: "string", minLength: 5, maxLength: 3000 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rowCount } = await ctx.client.query(
        "update evaluations v set statut = 'contestee', commentaire_employe = $3 from employes e where v.id = $1 and e.id = v.employe_id and e.utilisateur_id = $2 and v.statut = 'partagee'",
        [req.params.id, ctx.utilisateurId, req.body.commentaire],
      );
      if (!rowCount) throw new ErreurApi(404, "introuvable");
      return { statut: "contestee" };
    }),
  );
}
