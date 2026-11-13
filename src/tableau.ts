import type { FastifyInstance } from "fastify";
import { enchainer } from "./base.js";
import { entitesAccessibles } from "./permissions.js";
import type { Permission } from "./catalogue.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";

const date = { type: "string", format: "date" } as const;
const JOUR_LOCAL = (col: string) => `(${col} at time zone 'Africa/Douala')::date`;

/** Décale une date AAAA-MM-JJ d'un nombre de jours. */
export function decaler(jour: string, jours: number): string {
  const d = new Date(`${jour}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}
const ecart = (du: string, au: string) => Math.round((Date.parse(`${au}T00:00:00Z`) - Date.parse(`${du}T00:00:00Z`)) / 86400000);

/**
 * Période choisie, période précédente de même durée, et fenêtre du graphique :
 * au moins 30 jours pour qu'une courbe ait un sens, par mois au-delà de trois mois.
 */
export function periodes(du: string, au: string) {
  const jours = ecart(du, au) + 1;
  const graphiqueDu = jours < 14 ? decaler(au, -29) : du;
  return {
    du, au, jours,
    precedent: { du: decaler(du, -jours), au: decaler(du, -1) },
    graphique: { du: graphiqueDu, au, granularite: ecart(graphiqueDu, au) > 92 ? "mois" as const : "jour" as const },
  };
}

/** Les ventes, d'où qu'elles viennent : factures moins avoirs, caisse, encaissements de formation. */
const VENTES = (fact: string, form: string, du: string, au: string) => `
  select d.entite_id, d.date_document as jour, case when d.type = 'avoir' then -d.total_ttc else d.total_ttc end as montant,
    d.tiers_id, d.cree_par as employe_id, case when d.type = 'avoir' then 'avoir' else 'facture' end as source, d.numero as ref, coalesce(d.emis_le, d.cree_le) as quand
  from documents_vente d where d.type in ('facture', 'avoir') and d.statut = 'emis' and d.entite_id = any(${fact}::uuid[]) and d.date_document between ${du} and ${au}
  union all
  select v.entite_id, ${JOUR_LOCAL("v.cree_le")}, v.total_ttc, v.tiers_id, v.caissier_id, 'caisse', v.numero, v.cree_le
  from ventes_comptoir v where v.annulee_le is null and v.entite_id = any(${fact}::uuid[]) and ${JOUR_LOCAL("v.cree_le")} between ${du} and ${au}
  union all
  -- Un retour de caisse diminue les ventes, à sa date.
  select t.entite_id, ${JOUR_LOCAL("t.cree_le")}, -t.total_ttc, v.tiers_id, v.caissier_id, 'retour', t.numero, t.cree_le
  from retours_comptoir t join ventes_comptoir v on v.id = t.vente_id where t.entite_id = any(${fact}::uuid[]) and ${JOUR_LOCAL("t.cree_le")} between ${du} and ${au}
  union all
  select s.entite_id, ${JOUR_LOCAL("p.encaisse_le")}, p.montant, i.tiers_id, p.encaisse_par, 'formation', p.numero_recu, p.encaisse_le
  from paiements p join inscriptions i on i.id = p.inscription_id join sessions_formation s on s.id = i.session_id
  where p.annule_le is null and s.entite_id = any(${form}::uuid[]) and ${JOUR_LOCAL("p.encaisse_le")} between ${du} and ${au}`;

/** Mouvements de trésorerie classés : une annulation garde le sens du mouvement qu'elle annule ; transferts et soldes d'ouverture exclus. */
const MOUVEMENTS = (ids: string) => `
  select ${JOUR_LOCAL("m.cree_le")} as jour, m.montant, m.libelle, m.cree_le, p.type as moyen, p.nom as portefeuille,
    m.annule_mouvement_id is not null as annulation,
    case when coalesce(o.type, m.type) in ('entree', 'encaissement') then 'entree'
         when coalesce(o.type, m.type) in ('sortie', 'frais') then 'sortie' end as sens
  from mouvements_portefeuille m join portefeuilles p on p.id = m.portefeuille_id
  left join mouvements_portefeuille o on o.id = m.annule_mouvement_id
  where p.entite_id = any(${ids}::uuid[])`;

const serieDates = (gran: "jour" | "mois", du: string, au: string) => gran === "jour"
  ? `select g::date as date from generate_series(${du}::date, ${au}::date, interval '1 day') g`
  : `select g::date as date from generate_series(date_trunc('month', ${du}::date), ${au}::date, interval '1 month') g`;
const cle = (gran: "jour" | "mois", col: string) => (gran === "jour" ? col : `date_trunc('month', ${col})::date`);

export function enregistrerTableau(app: FastifyInstance, outils: Outils): void {
  const { protege } = outils;

  /** Entités de l'espace (GLOMARI ou GTA) où le droit s'applique, avec leurs magasins, dépôts et établissements. */
  const perimetre = async (ctx: Contexte, permission: Permission, espace: string): Promise<string[]> => {
    const acces = (await entitesAccessibles(ctx.client, ctx.utilisateurId, permission)).map((e) => String(e.id));
    if (!acces.length) return [];
    const { rows } = await ctx.client.query(
      `with recursive d as (select id from entites where id = any($1::uuid[]) union select e.id from entites e join d on e.parent_id = d.id)
       select d.id from d join entites b on b.id = entite_branche(d.id) where b.domaine = $2`,
      [acces, espace],
    );
    return rows.map((r) => String(r.id));
  };

  app.get<{ Querystring: { espace: "commerce" | "formation"; du: string; au: string } }>("/tableau-de-bord/branche", {
    schema: {
      querystring: {
        type: "object", required: ["espace", "du", "au"],
        properties: { espace: { type: "string", enum: ["commerce", "formation"] }, du: date, au: date },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { espace, du, au } = req.query;
      if (au < du || ecart(du, au) > 731) throw new ErreurApi(400, "periode_invalide");
      const p = periodes(du, au);
      const g = p.graphique;
      const c = ctx.client;
      const [treso, fact, form, stock] = await enchainer([
        () => perimetre(ctx, "tresorerie.voir", espace), () => perimetre(ctx, "facturation.voir", espace),
        () => perimetre(ctx, "formations.voir", espace), () => perimetre(ctx, "stocks.voir", espace)]);

      // Entrées, sorties et bénéfice brut : l'argent réellement entré et sorti des portefeuilles.
      let finances = null;
      if (treso.length) {
        const m = MOUVEMENTS("$1");
        const { rows: [t] } = await c.query(
          `with m as (${m}) select
             coalesce(sum(montant) filter (where sens = 'entree' and jour between $2 and $3), 0)::int8 as entrees,
             coalesce(-sum(montant) filter (where sens = 'sortie' and jour between $2 and $3), 0)::int8 as sorties,
             coalesce(sum(montant) filter (where sens = 'entree' and jour between $4 and $5), 0)::int8 as entrees_prec,
             coalesce(-sum(montant) filter (where sens = 'sortie' and jour between $4 and $5), 0)::int8 as sorties_prec,
             coalesce(sum(montant), 0)::int8 as tresorerie
           from m`, [treso, du, au, p.precedent.du, p.precedent.au],
        );
        const serie = await c.query(
          `with m as (${m}), s as (${serieDates(g.granularite, "$2", "$3")})
           select s.date::text as date,
             coalesce(sum(m.montant) filter (where m.sens = 'entree'), 0)::int8 as entrees,
             coalesce(-sum(m.montant) filter (where m.sens = 'sortie'), 0)::int8 as sorties
           from s left join m on ${cle(g.granularite, "m.jour")} = s.date and m.jour between $2 and $3
           group by s.date order by s.date`, [treso, g.du, g.au],
        );
        const parMoyen = await c.query(
          `with m as (${m}) select moyen, sum(montant)::int8 as montant from m where sens = 'entree' and jour between $2 and $3
           group by moyen having sum(montant) > 0 order by 2 desc`, [treso, du, au],
        );
        const operations = await c.query(
          `with m as (${m}) select sens, annulation, montant::int8 as montant, libelle, portefeuille, cree_le from m
           where sens is not null and jour between $2 and $3 order by cree_le desc limit 8`, [treso, du, au],
        );
        finances = {
          entrees: t.entrees, sorties: t.sorties, benefice: t.entrees - t.sorties, tresorerie: t.tresorerie,
          precedent: { entrees: t.entrees_prec, sorties: t.sorties_prec, benefice: t.entrees_prec - t.sorties_prec },
          serie: serie.rows, par_moyen: parMoyen.rows, operations: operations.rows,
        };
      }

      // Ventes : chiffre d'affaires, meilleurs clients et employés, dernières ventes.
      let ventes = null;
      if (fact.length || form.length) {
        const v = VENTES("$1", "$2", "$3", "$4");
        const a = [fact, form, du, au];
        const { rows: [t] } = await c.query(
          `with v as (${v}) select coalesce(sum(montant), 0)::int8 as total, count(*) filter (where montant > 0)::int as nombre from v`, a,
        );
        const { rows: [prec] } = await c.query(
          `with v as (${v}) select coalesce(sum(montant), 0)::int8 as total, count(*) filter (where montant > 0)::int as nombre from v`,
          [fact, form, p.precedent.du, p.precedent.au],
        );
        const serie = await c.query(
          `with v as (${v}), s as (${serieDates(g.granularite, "$3", "$4")})
           select s.date::text as date, coalesce(sum(v.montant), 0)::int8 as montant
           from s left join v on ${cle(g.granularite, "v.jour")} = s.date group by s.date order by s.date`,
          [fact, form, g.du, g.au],
        );
        const clients = await c.query(
          `with v as (${v}) select t.nom, count(*) filter (where v.montant > 0)::int as achats, sum(v.montant)::int8 as montant
           from v join tiers t on t.id = v.tiers_id group by t.id, t.nom having sum(v.montant) > 0 order by 3 desc limit 5`, a,
        );
        const employes = await c.query(
          `with v as (${v}) select u.nom, count(*) filter (where v.montant > 0)::int as ventes, sum(v.montant)::int8 as montant
           from v join utilisateurs u on u.id = v.employe_id group by u.id, u.nom having sum(v.montant) > 0 order by 3 desc limit 5`, a,
        );
        const dernieres = await c.query(
          `with v as (${v}) select v.source, v.ref, v.montant::int8 as montant, v.quand, t.nom as client, u.nom as employe
           from v left join tiers t on t.id = v.tiers_id left join utilisateurs u on u.id = v.employe_id order by v.quand desc limit 8`, a,
        );
        ventes = {
          total: t.total, nombre: t.nombre, panier: t.nombre ? Math.round(t.total / t.nombre) : 0,
          precedent: { total: prec.total, nombre: prec.nombre },
          serie: serie.rows, meilleurs_clients: clients.rows, meilleurs_employes: employes.rows, dernieres: dernieres.rows,
        };
      }

      // Articles les plus vendus (GLOMARI), quantités nettes des avoirs.
      let articles = null;
      if (fact.length && espace === "commerce") {
        articles = (await c.query(
          `select p.nom, p.code, sum(x.q)::float as quantite, sum(x.m)::int8 as montant from (
             select l.produit_id, case when d.type = 'avoir' then -l.quantite else l.quantite end as q,
               case when d.type = 'avoir' then -(l.montant_ht + l.montant_taxes) else l.montant_ht + l.montant_taxes end as m
             from lignes_vente l join documents_vente d on d.id = l.document_id
             where d.type in ('facture', 'avoir') and d.statut = 'emis' and l.produit_id is not null and d.entite_id = any($1::uuid[]) and d.date_document between $2 and $3
             union all
             select l.produit_id, l.quantite, l.montant_ht + l.montant_taxes from lignes_comptoir l join ventes_comptoir v on v.id = l.vente_id
             where v.annulee_le is null and v.entite_id = any($1::uuid[]) and ${JOUR_LOCAL("v.cree_le")} between $2 and $3
           ) x join produits p on p.id = x.produit_id group by p.id, p.nom, p.code having sum(x.q) > 0 order by 4 desc limit 5`,
          [fact, du, au],
        )).rows;
      }

      // Formations (GTA) : inscriptions, sessions, programmes et formateurs.
      let formation = null;
      if (form.length) {
        const { rows: [f] } = await c.query(
          `select
             (select count(*) from inscriptions i join sessions_formation s on s.id = i.session_id
               where s.entite_id = any($1::uuid[]) and i.statut <> 'annulee' and ${JOUR_LOCAL("i.cree_le")} between $2 and $3)::int as inscriptions,
             (select count(*) from inscriptions i join sessions_formation s on s.id = i.session_id
               where s.entite_id = any($1::uuid[]) and i.statut <> 'annulee' and ${JOUR_LOCAL("i.cree_le")} between $4 and $5)::int as inscriptions_prec,
             (select count(*) from sessions_formation s where s.entite_id = any($1::uuid[]) and s.statut <> 'annulee'
               and ${JOUR_LOCAL("now()")} between s.debut and s.fin)::int as sessions_en_cours,
             (select round(100.0 * sum((select count(*) from inscriptions i where i.session_id = s.id and i.statut = 'active')) / nullif(sum(s.capacite), 0))
               from sessions_formation s where s.entite_id = any($1::uuid[]) and s.statut <> 'annulee' and s.capacite is not null
               and s.debut <= $3 and s.fin >= $2)::int as remplissage`,
          [form, du, au, p.precedent.du, p.precedent.au],
        );
        const programmes = await c.query(
          `select pr.nom,
             count(distinct i.id) filter (where i.statut <> 'annulee' and ${JOUR_LOCAL("i.cree_le")} between $2 and $3)::int as inscriptions,
             coalesce(sum(pa.montant) filter (where pa.annule_le is null and ${JOUR_LOCAL("pa.encaisse_le")} between $2 and $3), 0)::int8 as encaisse
           from programmes pr join sessions_formation s on s.programme_id = pr.id join inscriptions i on i.session_id = s.id
           left join paiements pa on pa.inscription_id = i.id
           where s.entite_id = any($1::uuid[]) group by pr.id, pr.nom
           having count(distinct i.id) filter (where i.statut <> 'annulee' and ${JOUR_LOCAL("i.cree_le")} between $2 and $3) > 0
             or coalesce(sum(pa.montant) filter (where pa.annule_le is null and ${JOUR_LOCAL("pa.encaisse_le")} between $2 and $3), 0) > 0
           order by 3 desc, 2 desc limit 5`, [form, du, au],
        );
        const formateurs = await c.query(
          `with s as (select id, formateur_id from sessions_formation where entite_id = any($1::uuid[]) and formateur_id is not null
             and statut <> 'annulee' and debut <= $3 and fin >= $2)
           select u.nom, count(*)::int as sessions,
             (select count(*) from inscriptions i where i.statut = 'active' and i.session_id in (select id from s x where x.formateur_id = u.id))::int as apprenants,
             (select round(avg(a.note_formateur), 1) from avis_formation a where a.session_id in (select id from s x where x.formateur_id = u.id))::float as note,
             (select count(*) from avis_formation a where a.session_id in (select id from s x where x.formateur_id = u.id))::int as avis
           from s join utilisateurs u on u.id = s.formateur_id group by u.id, u.nom order by 4 desc nulls last, 3 desc limit 5`,
          [form, du, au],
        );
        formation = { ...f, programmes: programmes.rows, formateurs: formateurs.rows };
      }

      // Stock (GLOMARI) : valeur au coût moyen et articles sous leur seuil.
      let stocks = null;
      const lieux = espace === "commerce" ? stock : [];
      if (lieux.length) {
        stocks = (await c.query(
          `select coalesce(sum(greatest(s.q, 0) * p.cout_moyen), 0)::int8 as valeur,
             count(*) filter (where p.seuil_alerte > 0 and s.q <= p.seuil_alerte)::int as alertes
           from (select entite_id, produit_id, sum(quantite) as q from mouvements_stock where entite_id = any($1::uuid[]) group by 1, 2) s
           join produits p on p.id = s.produit_id`, [lieux],
        )).rows[0];
      }

      // Créances : ce que les clients doivent encore sur les factures émises.
      let creances = null;
      if (fact.length) {
        creances = (await c.query(
          `select coalesce(sum(reste), 0)::int8 as montant, count(*)::int as factures from (
             select d.total_ttc - (select coalesce(sum(r.montant), 0) from reglements r where r.facture_id = d.id and r.annule_le is null)
               - (select coalesce(sum(a.total_ttc), 0) from documents_vente a where a.origine_id = d.id and a.type = 'avoir' and a.statut = 'emis') as reste
             from documents_vente d where d.type = 'facture' and d.statut = 'emis' and d.entite_id = any($1::uuid[])) f where reste > 0`, [fact],
        )).rows[0];
      }

      // GLOMARI : achats de marchandises (bons de commande approuvés, à leur date) et dépenses.
      // Les dépenses sont les sorties d'argent des portefeuilles, sans les paiements des achats déjà comptés dans « achats »,
      // ni les remboursements de retours de caisse, déjà déduits des ventes.
      let achats = null, depenses = null;
      if (espace === "commerce") {
        const lieuxAchats = await perimetre(ctx, "achats.voir", espace);
        if (lieuxAchats.length) {
          const total = async (debut: string, fin: string) => (await c.query(
            `select coalesce(sum(total), 0)::int8 as total, count(*)::int as nombre from commandes_achat
             where statut in ('approuvee', 'recue_partiellement', 'recue') and entite_id = any($1::uuid[]) and date_commande between $2 and $3`, [lieuxAchats, debut, fin],
          )).rows[0];
          const [a, avant] = [await total(du, au), await total(p.precedent.du, p.precedent.au)];
          achats = { total: Number(a.total), nombre: a.nombre, precedent: { total: Number(avant.total) } };
        }
        if (treso.length) {
          const { rows: [d] } = await c.query(
            `with m as (${MOUVEMENTS("$1")} and coalesce(o.source_type, m.source_type) is distinct from 'retour' and not exists (
               select 1 from paiements_fournisseur pf join factures_fournisseur ff on ff.id = pf.facture_id
               where pf.id = coalesce(o.source_id, m.source_id) and coalesce(o.source_type, m.source_type) = 'paiement_fournisseur' and ff.commande_id is not null))
             select coalesce(-sum(montant) filter (where sens = 'sortie' and jour between $2 and $3), 0)::int8 as total,
                    coalesce(-sum(montant) filter (where sens = 'sortie' and jour between $4 and $5), 0)::int8 as avant from m`,
            [treso, du, au, p.precedent.du, p.precedent.au],
          );
          depenses = { total: Number(d.total), precedent: { total: Number(d.avant) } };
        }
      }
      // Bénéfice de la période = ventes moins achats moins dépenses. Vue de gestion : ce n'est pas le résultat comptable.
      const resume = espace === "commerce" && ventes && achats && depenses ? {
        benefice: Number(ventes.total) - achats.total - depenses.total,
        precedent: { benefice: Number(ventes.precedent.total) - achats.precedent.total - depenses.precedent.total },
      } : null;

      return { periode: { du, au, jours: p.jours, precedent: p.precedent }, graphique: g, finances, ventes, articles, formation, stocks, creances, achats, depenses, resume };
    }),
  );
}
