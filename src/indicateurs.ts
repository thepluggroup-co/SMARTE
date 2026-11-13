import type { FastifyInstance } from "fastify";
import type { Client } from "./base.js";
import { KPI } from "./commerce.js";
import type { Permission } from "./catalogue.js";
import { aPermission, entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";

export interface Kpi {
  code: string;
  libelle: string;
  valeur: number | null;
  unite: "nombre" | "fcfa" | "pourcent" | "note" | "heures";
  definition: string;
}

const pourcent = (a: number, b: number) => (b ? Math.round((a * 100) / b) : null);
const FUSEAU = "Africa/Douala";

async function formation(c: Client, ids: unknown[], debut: string, fin: string): Promise<Kpi[]> {
  const { rows } = await c.query(
    `with s as (select * from sessions_formation where entite_id = any($1::uuid[])),
     i as (select inscriptions.* from inscriptions join s on s.id = inscriptions.session_id where inscriptions.statut = 'active'),
     par_inscrit as (
       select i.id,
         (select coalesce(sum(montant), 0) from echeances e where e.inscription_id = i.id) as du,
         (select coalesce(sum(montant), 0) from echeances e where e.inscription_id = i.id
           and e.date_echeance <= (now() at time zone '${FUSEAU}')::date) as echu,
         (select coalesce(sum(montant), 0) from paiements p where p.inscription_id = i.id and p.annule_le is null) as paye
       from i
     ),
     actives as (select * from s where statut in ('ouverte', 'en_cours'))
     select
       (select count(*) from actives)::int as sessions_actives,
       (select count(*) from i where cree_le >= ($2::date)::timestamp at time zone '${FUSEAU}'
          and cree_le < ($3::date + 1)::timestamp at time zone '${FUSEAU}')::int as nouveaux_inscrits,
       (select count(*) from i join actives a on a.id = i.session_id where a.capacite is not null)::int as inscrits_capacite,
       (select coalesce(sum(capacite), 0) from actives)::int as capacite,
       (select coalesce(sum(p.montant), 0) from paiements p join inscriptions x on x.id = p.inscription_id join s on s.id = x.session_id
          where p.annule_le is null and p.encaisse_le >= ($2::date)::timestamp at time zone '${FUSEAU}'
          and p.encaisse_le < ($3::date + 1)::timestamp at time zone '${FUSEAU}')::int8 as encaisse,
       (select coalesce(sum(du), 0) from par_inscrit)::int8 as du,
       (select coalesce(sum(paye), 0) from par_inscrit)::int8 as paye,
       (select coalesce(sum(greatest(echu - paye, 0)), 0) from par_inscrit)::int8 as retard,
       (select count(*) from presences p join i on i.id = p.inscription_id)::int as appels,
       (select count(*) from presences p join i on i.id = p.inscription_id where p.present)::int as presents,
       (select round(avg(a.note_globale), 1)::float from avis_formation a join s on s.id = a.session_id
          where a.cree_le >= ($2::date)::timestamp at time zone '${FUSEAU}'
          and a.cree_le < ($3::date + 1)::timestamp at time zone '${FUSEAU}') as satisfaction`,
    [ids, debut, fin],
  );
  const r = rows[0];
  return [
    { code: "sessions_actives", libelle: "Sessions ouvertes ou en cours", valeur: r.sessions_actives, unite: "nombre", definition: "Nombre de sessions au statut ouverte ou en cours, à ce jour." },
    { code: "nouveaux_inscrits", libelle: "Nouveaux inscrits", valeur: r.nouveaux_inscrits, unite: "nombre", definition: "Inscriptions actives créées pendant la période." },
    { code: "remplissage", libelle: "Taux de remplissage", valeur: pourcent(r.inscrits_capacite, r.capacite), unite: "pourcent", definition: "Inscrits actifs divisés par les places, pour les sessions actives dont la capacité est renseignée." },
    { code: "encaisse", libelle: "Encaissé", valeur: r.encaisse, unite: "fcfa", definition: "Paiements non annulés enregistrés pendant la période." },
    { code: "reste", libelle: "Reste à encaisser", valeur: r.du - r.paye, unite: "fcfa", definition: "Total dû moins total payé des inscrits actifs, à ce jour." },
    { code: "retard", libelle: "Échéances en retard", valeur: r.retard, unite: "fcfa", definition: "Montants arrivés à échéance et non couverts par les paiements, à ce jour." },
    { code: "recouvrement", libelle: "Taux de recouvrement", valeur: pourcent(r.paye, r.du), unite: "pourcent", definition: "Total payé divisé par le total dû des inscrits actifs." },
    { code: "presence", libelle: "Taux de présence", valeur: pourcent(r.presents, r.appels), unite: "pourcent", definition: "Présences divisées par les appels saisis pour les inscrits actifs." },
    { code: "satisfaction", libelle: "Satisfaction moyenne", valeur: r.satisfaction, unite: "note", definition: "Moyenne sur 5 des notes globales reçues pendant la période." },
  ];
}

async function commercial(c: Client, ids: unknown[], debut: string, fin: string): Promise<Kpi[]> {
  const { rows } = await c.query(
    `with o as (select * from opportunites where entite_id = any($1::uuid[])),
     closes as (select * from o where clos_le >= ($2::date)::timestamp at time zone '${FUSEAU}'
       and clos_le < ($3::date + 1)::timestamp at time zone '${FUSEAU}')
     select
       (select count(distinct tiers_id) from o where cree_le >= ($2::date)::timestamp at time zone '${FUSEAU}'
          and cree_le < ($3::date + 1)::timestamp at time zone '${FUSEAU}')::int as nouveaux,
       (select coalesce(sum(montant_estime), 0) from o where etape not in ('gagne', 'perdu'))::int8 as portefeuille,
       (select count(*) from closes where etape = 'gagne')::int as gagnees,
       (select count(*) from closes)::int as closes,
       (select coalesce(sum(montant_estime), 0) from closes where etape = 'gagne')::int8 as montant_gagne`,
    [ids, debut, fin],
  );
  const r = rows[0];
  return [
    { code: "nouveaux_prospects", libelle: "Nouveaux prospects", valeur: r.nouveaux, unite: "nombre", definition: "Personnes ou entreprises pour qui une opportunité a été ouverte pendant la période, chacune comptée une fois." },
    { code: "portefeuille", libelle: "Montant en négociation", valeur: r.portefeuille, unite: "fcfa", definition: "Somme des montants estimés des opportunités ni gagnées ni perdues, à ce jour." },
    { code: "opportunites_gagnees", libelle: "Opportunités gagnées", valeur: r.gagnees, unite: "nombre", definition: "Opportunités passées à gagné pendant la période." },
    { code: "montant_gagne", libelle: "Montant gagné", valeur: r.montant_gagne, unite: "fcfa", definition: "Montants estimés des opportunités gagnées pendant la période." },
    { code: "conversion", libelle: "Taux de conversion", valeur: pourcent(r.gagnees, r.closes), unite: "pourcent", definition: "Opportunités gagnées divisées par les opportunités closes pendant la période." },
  ];
}

async function support(c: Client, ids: unknown[], debut: string, fin: string): Promise<Kpi[]> {
  const { rows } = await c.query(
    `with k as (select * from tickets where entite_id = any($1::uuid[])),
     resolus as (select * from k where resolu_le >= ($2::date)::timestamp at time zone '${FUSEAU}'
       and resolu_le < ($3::date + 1)::timestamp at time zone '${FUSEAU}')
     select
       (select count(*) from k where statut in ('ouvert', 'en_cours'))::int as ouverts,
       (select count(*) from k where statut in ('ouvert', 'en_cours') and echeance < now())::int as en_retard,
       (select count(*) from resolus)::int as resolus,
       (select count(*) from resolus where resolu_le <= echeance)::int as dans_les_delais,
       (select round((avg(extract(epoch from resolu_le - cree_le)) / 3600)::numeric, 1)::float from resolus) as delai`,
    [ids, debut, fin],
  );
  const r = rows[0];
  return [
    { code: "tickets_ouverts", libelle: "Tickets ouverts", valeur: r.ouverts, unite: "nombre", definition: "Tickets ouverts ou en cours, à ce jour." },
    { code: "tickets_retard", libelle: "Tickets en retard", valeur: r.en_retard, unite: "nombre", definition: "Tickets ouverts dont le délai cible est dépassé." },
    { code: "tickets_resolus", libelle: "Tickets résolus", valeur: r.resolus, unite: "nombre", definition: "Tickets résolus pendant la période." },
    { code: "delai_resolution", libelle: "Délai moyen de résolution", valeur: r.delai, unite: "heures", definition: "Temps moyen entre la création et la résolution, pour les tickets résolus pendant la période." },
    { code: "respect_delais", libelle: "Résolus dans les délais", valeur: pourcent(r.dans_les_delais, r.resolus), unite: "pourcent", definition: "Part des tickets résolus avant leur délai cible pendant la période." },
  ];
}

async function taches(c: Client, ids: unknown[]): Promise<Kpi[]> {
  const { rows } = await c.query(
    `select count(*) filter (where statut in ('a_faire', 'en_cours'))::int as ouvertes,
       count(*) filter (where statut in ('a_faire', 'en_cours') and echeance < (now() at time zone '${FUSEAU}')::date)::int as en_retard
     from taches where entite_id = any($1::uuid[])`,
    [ids],
  );
  return [
    { code: "taches_ouvertes", libelle: "Tâches ouvertes", valeur: rows[0].ouvertes, unite: "nombre", definition: "Tâches à faire ou en cours, à ce jour." },
    { code: "taches_retard", libelle: "Tâches en retard", valeur: rows[0].en_retard, unite: "nombre", definition: "Tâches ouvertes dont l'échéance est dépassée." },
  ];
}

/** GLOMARI vend des produits physiques : ventes, panier, ruptures et livraisons, sur les seules entités de stock. */
async function ventes(c: Client, ids: unknown[], debut: string, fin: string): Promise<Kpi[]> {
  const mesure = async (code: string) => (await c.query(KPI[code]!.entite!, [ids, debut, fin])).rows[0].v as number | null;
  const { rows: [n] } = await c.query(
    `select (select count(*) from documents_vente where type = 'facture' and statut = 'emis' and entite_id = any($1::uuid[]) and date_document between $2 and $3)::int
          + (select count(*) from ventes_comptoir where annulee_le is null and entite_id = any($1::uuid[]) and (cree_le at time zone '${FUSEAU}')::date between $2 and $3)::int as n`,
    [ids, debut, fin],
  );
  const total = Number(await mesure("ventes_glomari") ?? 0);
  const ruptures = await mesure("ruptures_stock");
  return [
    { code: "ventes", libelle: "Ventes", valeur: total, unite: "fcfa", definition: "Factures émises pendant la période, avoirs déduits, plus les ventes en caisse non annulées." },
    { code: "nombre_ventes", libelle: "Nombre de ventes", valeur: n.n, unite: "nombre", definition: "Factures émises et tickets de caisse non annulés pendant la période." },
    { code: "panier_moyen", libelle: "Panier moyen", valeur: n.n ? Math.round(total / n.n) : null, unite: "fcfa", definition: "Ventes divisées par le nombre de ventes." },
    { code: "ruptures", libelle: "Articles en rupture", valeur: ruptures === null ? null : Number(ruptures), unite: "nombre", definition: "Articles suivis en stock dont la quantité est nulle ou négative au dernier jour de la période, par dépôt ou magasin." },
    { code: "delai_livraison", libelle: "Délai moyen de livraison (jours)", valeur: await mesure("delai_livraison"), unite: "nombre", definition: "Temps moyen entre la création et la livraison des colis livrés pendant la période." },
  ];
}

export function enregistrerIndicateurs(app: FastifyInstance, outils: Outils): void {
  /** Chaque section n'apparaît que pour qui a le droit de la voir, et sur ses seules entités. */
  app.get<{ Querystring: { debut?: string; fin?: string; entiteId?: string } }>("/tableau-de-bord", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          debut: { type: "string", format: "date" },
          fin: { type: "string", format: "date" },
          entiteId: { type: "string", format: "uuid" },
        },
      },
    },
  }, async (req) =>
    outils.protege(req, async (ctx: Contexte) => {
      const aujourdhui = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
      const debut = req.query.debut ?? `${aujourdhui.slice(0, 7)}-01`;
      const fin = req.query.fin ?? aujourdhui;
      if (fin < debut) throw new ErreurApi(400, "dates_invalides");

      const portee = async (p: Permission) => {
        if (!(await aPermission(ctx.client, ctx.utilisateurId, p))) return null;
        const entites = await entitesAccessibles(ctx.client, ctx.utilisateurId, p);
        const filtre = req.query.entiteId;
        if (!filtre) return entites.map((e) => e.id);
        const retenues = new Set<unknown>();
        const ajouter = (id: unknown) => {
          retenues.add(id);
          for (const e of entites) if (e.parent_id === id && !retenues.has(e.id)) ajouter(e.id);
        };
        if (entites.some((e) => e.id === filtre)) ajouter(filtre);
        // Rien de cette activité dans l'entité choisie : la section n'apparaît pas (pas de formation pour GLOMARI).
        return retenues.size ? [...retenues] : null;
      };

      const sections: { code: string; libelle: string; indicateurs: Kpi[] }[] = [];
      const f = await portee("formations.voir");
      if (f) sections.push({ code: "formation", libelle: "Formation", indicateurs: await formation(ctx.client, f, debut, fin) });
      const g = await portee("stocks.voir");
      if (g) sections.push({ code: "ventes", libelle: "Ventes et stocks", indicateurs: await ventes(ctx.client, g, debut, fin) });
      const v = await portee("crm.voir");
      if (v) sections.push({ code: "commercial", libelle: "Commercial", indicateurs: await commercial(ctx.client, v, debut, fin) });
      const s = await portee("support.voir");
      if (s) sections.push({ code: "support", libelle: "Service client", indicateurs: await support(ctx.client, s, debut, fin) });
      const t = await portee("taches.gerer");
      if (t) sections.push({ code: "taches", libelle: "Tâches", indicateurs: await taches(ctx.client, t) });
      return { debut, fin, sections };
    }),
  );
}
