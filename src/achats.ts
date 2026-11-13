import { exigerSeparation } from "./permissions.js";
import type { FastifyInstance } from "fastify";
import { publierEvenement } from "./base.js";
import { prochainNumero } from "./formations.js";
import { aPermissionSurEntite, entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";
import { entrerEnStock, niveau, produitSuivi, sortirDuStock } from "./stocks.js";
import { lierTiers } from "./tiers.js";
import { coutRevient } from "./logistique.js";
import { choisirUnite, enUniteDeBase } from "./articles.js";

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const quantite = { type: "number", exclusiveMinimum: 0, maximum: 1_000_000_000, multipleOf: 0.001 } as const;
const volume = { type: "number", minimum: 0, maximum: 1_000_000, multipleOf: 0.001 } as const;
const motifBody = { type: "object", required: ["motif"], properties: { motif: { type: "string", minLength: 3, maxLength: 500 } } } as const;
const annee = () => new Date().getFullYear();
/** Comparaison au millième près, l'unité stockée. */
const egal = (a: number, b: number) => Math.round(a * 1000) === Math.round(b * 1000);

interface LigneCommande { produitId: string; quantite: number; prixUnitaire: number; unite?: string; poidsKg?: number; prixVente?: number }

/** Étapes de suivi selon l'origine. La dernière, « en_stock », n'est posée que par la réception. */
export const ETAPES_ACHAT = {
  local: ["commandee", "achetee", "en_transport", "livree"],
  import: ["commandee", "en_production", "expediee", "arrivee_port", "dedouanee", "enlevee", "livree"],
} as const;
/** Au-delà de cet écart avec le prix habituel, la ligne est signalée comme peut-être surfacturée. */
export const SEUIL_ALERTE_PRIX = 10;
/** En dessous de ce taux de marge sur le prix de vente, la marge est jugée faible. */
export const SEUIL_MARGE_FAIBLE = 20;

/**
 * Rentabilité prévue d'une commande. Le coût de chaque ligne inclut sa part des frais, répartis selon la valeur.
 * Le taux de marge est calculé sur le prix de vente.
 */
export function rentabilite(lignes: { quantite: number; prix_unitaire: number; prix_vente_prevu: number | null }[], total: number, frais: number) {
  const detail = lignes.map((l) => {
    const valeur = Math.round(l.quantite * l.prix_unitaire);
    const cout = total > 0 ? Math.round(valeur * (total + frais) / total) : valeur;
    const unitaire = coutRevient(total, frais, l.prix_unitaire);
    if (l.prix_vente_prevu === null) return { cout_revient: unitaire, cout_ligne: cout, marge_unitaire: null, taux_marge: null, chiffre_affaires: null, marge_totale: null, avis: "a_renseigner" as const };
    const ca = Math.round(l.quantite * l.prix_vente_prevu);
    const marge = ca - cout;
    const taux = ca > 0 ? Math.round(marge * 1000 / ca) / 10 : null;
    const avis = marge < 0 ? "a_perte" as const : taux === null || taux < SEUIL_MARGE_FAIBLE ? "faible" as const : "rentable" as const;
    return { cout_revient: unitaire, cout_ligne: cout, marge_unitaire: l.prix_vente_prevu - unitaire, taux_marge: taux, chiffre_affaires: ca, marge_totale: marge, avis };
  });
  const avecPrix = detail.filter((d) => d.chiffre_affaires !== null);
  const ca = avecPrix.reduce((s, d) => s + d.chiffre_affaires!, 0);
  const cout = avecPrix.reduce((s, d) => s + d.cout_ligne, 0);
  return {
    detail,
    total: {
      complet: avecPrix.length === detail.length, lignes_sans_prix: detail.length - avecPrix.length,
      chiffre_affaires: ca, cout: cout, marge: ca - cout, taux_marge: ca > 0 ? Math.round((ca - cout) * 1000 / ca) / 10 : null,
    },
  };
}
/** Dans l'ordre de la chaîne : avant le départ, transport principal, à l'arrivée, puis jusqu'à l'entrepôt. */
const NATURES_FRAIS = ["pre_acheminement", "fret", "enlevement", "post_acheminement", "transport_local", "manutention", "autre"];
const OUVERTS = "('brouillon', 'approuvee', 'recue_partiellement')";

interface Filtres { du?: string; au?: string; q?: string; statut?: string; origine?: string; acheteurId?: string; fournisseurId?: string; transitaireId?: string }
const schemaFiltres = {
  type: "object",
  properties: {
    du: date, au: date, q: { type: "string", maxLength: 100 },
    statut: { type: "string", enum: ["en_cours", "brouillon", "approuvee", "recue_partiellement", "recue", "annulee"] },
    origine: { type: "string", enum: ["local", "import"] }, acheteurId: uuid, fournisseurId: uuid, transitaireId: uuid,
  },
} as const;

/** Conditions communes à la liste et aux totaux. $1 est la liste des entités visibles. */
function filtrer(ids: string[], f: Filtres): { where: string; params: unknown[] } {
  const params: unknown[] = [ids];
  const conditions = ["c.entite_id = any($1::uuid[])"];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (f.du) conditions.push(`c.date_commande >= ${p(f.du)}`);
  if (f.au) conditions.push(`c.date_commande <= ${p(f.au)}`);
  if (f.statut === "en_cours") conditions.push(`c.statut in ${OUVERTS}`);
  else if (f.statut) conditions.push(`c.statut = ${p(f.statut)}`);
  if (f.origine) conditions.push(`c.origine = ${p(f.origine)}`);
  if (f.acheteurId) conditions.push(`coalesce(c.acheteur_id, c.cree_par) = ${p(f.acheteurId)}`);
  if (f.fournisseurId) conditions.push(`c.fournisseur_id = ${p(f.fournisseurId)}`);
  if (f.transitaireId) conditions.push(`c.transitaire_id = ${p(f.transitaireId)}`);
  const q = f.q?.trim();
  if (q) {
    const m = p(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(`(c.numero ilike ${m} or c.reference_fournisseur ilike ${m} or t.nom ilike ${m}
      or exists (select 1 from tiers x where x.id = c.transitaire_id and x.nom ilike ${m})
      or exists (select 1 from lignes_achat l join produits p on p.id = l.produit_id where l.commande_id = c.id and (p.nom ilike ${m} or p.code ilike ${m})))`);
  }
  return { where: conditions.join(" and "), params };
}

/** Prix moyen payé pour le même article lors des trois commandes précédentes, dans les lieux visibles. */
const PRIX_HABITUEL = `(select round(avg(x.prix_unitaire))::int8 from (
    select l2.prix_unitaire from lignes_achat l2 join commandes_achat c2 on c2.id = l2.commande_id
    where l2.produit_id = l.produit_id and c2.id <> c.id and c2.statut <> 'annulee' and c2.entite_id = any($2::uuid[])
      and (c2.date_commande, c2.cree_le) < (c.date_commande, c.cree_le)
    order by c2.date_commande desc, c2.cree_le desc limit 3) x)`;

export function enregistrerAchats(app: FastifyInstance, outils: Outils): void {
  const { protege, exiger, exigerSurEntite } = outils;

  const exigerModule = async (ctx: Contexte, entiteId: string) => {
    const { rows } = await ctx.client.query(
      "select actif from modules_entite where entite_id = $1 and module = 'achats_stocks'", [entiteId],
    );
    if (!rows[0]?.actif) throw new ErreurApi(409, "module_inactif");
  };

  const ecrireLignes = async (ctx: Contexte, commandeId: string, lignes: LigneCommande[]) => {
    await ctx.client.query("delete from lignes_achat where commande_id = $1", [commandeId]);
    let total = 0;
    for (const l of lignes) {
      await produitSuivi(ctx.client, l.produitId);
      // Achat dans une autre unité (carton, palette…) : le stock et le coût se rangent dans l'unité de base.
      // Le coût de base est arrondi au franc ; le total de la commande, lui, reste celui de l'unité achetée.
      const { rows: [p] } = await ctx.client.query("select unite, pieces_par_unite::float, conditionnements, prix_piece from produits where id = $1", [l.produitId]);
      const u = choisirUnite(p, l.unite);
      const base = u.base ? l.quantite : enUniteDeBase(l.quantite, u);
      if (!(base > 0)) throw new ErreurApi(400, "donnees_invalides");
      const prixBase = u.base ? l.prixUnitaire : Math.round(l.prixUnitaire / u.facteur);
      await ctx.client.query(
        `insert into lignes_achat (organisation_id, commande_id, produit_id, quantite, prix_unitaire, poids_kg, prix_vente_prevu, unite, quantite_unite, prix_unite)
         values ($1, $2, $3, $4, $5, $6, coalesce($7::int8, (select nullif(prix_vente, 0) from produits where id = $3)), $8, $9, $10)`,
        [ctx.organisationId, commandeId, l.produitId, base, prixBase, l.poidsKg ?? null, l.prixVente ?? null, u.base ? null : u.nom, u.base ? null : l.quantite, u.base ? null : l.prixUnitaire],
      );
      total += Math.round(Math.round(l.quantite * 1000) * l.prixUnitaire / 1000);
    }
    await ctx.client.query("update commandes_achat set total = $2 where id = $1", [commandeId, total]);
  };

  const schemaLignes = {
    type: "array", minItems: 1, maxItems: 500,
    items: {
      type: "object", required: ["produitId", "quantite", "prixUnitaire"],
      properties: {
        produitId: uuid, quantite, prixUnitaire: { type: "integer", minimum: 0, maximum: 10_000_000_000 },
        unite: { type: "string", minLength: 1, maxLength: 50 },
        poidsKg: { type: "number", minimum: 0, maximum: 1_000_000_000, multipleOf: 0.001 },
        prixVente: { type: "integer", minimum: 0, maximum: 10_000_000_000 },
      },
    },
  } as const;

  /** L'acheteur désigné doit être un compte actif qui a le droit de passer des commandes sur ce lieu. */
  const verifierAcheteur = async (ctx: Contexte, acheteurId: string, entiteId: string) => {
    const { rows: [u] } = await ctx.client.query("select actif from utilisateurs where id = $1", [acheteurId]);
    if (!u?.actif || !await aPermissionSurEntite(ctx.client, acheteurId, "achats.gerer", entiteId)) throw new ErreurApi(400, "acheteur_invalide");
  };

  /** Le transitaire est un partenaire de la même branche ; il reçoit le rôle « transitaire ». */
  const lierTransitaire = async (ctx: Contexte, tiersId: string, entiteId: string) => {
    await lierTiers(ctx, tiersId, entiteId);
    await ctx.client.query(
      "update tiers set roles = array_append(roles, 'transitaire') where id = $1 and not ('transitaire' = any(roles))", [tiersId],
    );
  };

  const noterEtape = (ctx: Contexte, commandeId: string, etape: string, le: string | null, note: string | null) =>
    ctx.client.query(
      `insert into etapes_achat (organisation_id, commande_id, etape, date_etape, note, auteur_id)
       values ($1, $2, $3, coalesce($4::date, current_date), $5, $6)`,
      [ctx.organisationId, commandeId, etape, le, note, ctx.utilisateurId],
    );

  const fraisActifs = async (ctx: Contexte, commandeId: string): Promise<number> => Number((await ctx.client.query(
    "select coalesce(sum(montant), 0)::int8 as f from frais_achat where commande_id = $1 and retire_le is null", [commandeId],
  )).rows[0].f);

  app.post<{
    Body: {
      entiteId: string; fournisseurId: string; date: string; datePrevue?: string; notes?: string; lignes: LigneCommande[];
      origine?: "local" | "import"; acheteurId?: string; referenceFournisseur?: string; paysOrigine?: string;
      transitaireId?: string; modeTransport?: "maritime" | "aerien"; volumeM3?: number;
    };
  }>("/achats/commandes", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "fournisseurId", "date", "lignes"],
        properties: {
          entiteId: uuid, fournisseurId: uuid, date, datePrevue: date,
          notes: { type: "string", maxLength: 2000 }, lignes: schemaLignes,
          origine: { type: "string", enum: ["local", "import"] }, acheteurId: uuid,
          referenceFournisseur: { type: "string", maxLength: 100 }, paysOrigine: { type: "string", maxLength: 100 },
          transitaireId: uuid, modeTransport: { type: "string", enum: ["maritime", "aerien"] }, volumeM3: volume,
        },
      },
    },
  }, async (req, reponse) => {
    const c = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "achats.gerer", b.entiteId);
      await exigerModule(ctx, b.entiteId);
      await lierTiers(ctx, b.fournisseurId, b.entiteId);
      if (new Set(b.lignes.map((l) => l.produitId)).size !== b.lignes.length) throw new ErreurApi(400, "produit_en_double");
      if (b.datePrevue && b.datePrevue < b.date) throw new ErreurApi(400, "date_avant_commande");
      const acheteurId = b.acheteurId ?? ctx.utilisateurId;
      await verifierAcheteur(ctx, acheteurId, b.entiteId);
      if (b.transitaireId) await lierTransitaire(ctx, b.transitaireId, b.entiteId);
      await ctx.client.query(
        "update tiers set roles = array_append(roles, 'fournisseur') where id = $1 and not ('fournisseur' = any(roles))",
        [b.fournisseurId],
      );
      const numero = await prochainNumero(ctx.client, `BC-${annee()}`);
      const { rows } = await ctx.client.query(
        `insert into commandes_achat (organisation_id, entite_id, numero, fournisseur_id, date_commande, date_prevue, notes, cree_par,
           origine, acheteur_id, reference_fournisseur, pays_origine, etape_le, transitaire_id, mode_transport, volume_m3)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $5, $13, $14, $15) returning id`,
        [ctx.organisationId, b.entiteId, numero, b.fournisseurId, b.date, b.datePrevue ?? null, b.notes ?? null, ctx.utilisateurId,
          b.origine ?? "local", acheteurId, b.referenceFournisseur?.trim() || null, b.paysOrigine?.trim() || null,
          b.transitaireId ?? null, b.modeTransport ?? null, b.volumeM3 ?? null],
      );
      await noterEtape(ctx, rows[0].id, "commandee", b.date, null);
      await ecrireLignes(ctx, rows[0].id, b.lignes);
      return (await ctx.client.query("select * from commandes_achat where id = $1", [rows[0].id])).rows[0];
    });
    return reponse.status(201).send(c);
  });

  const commande = async (ctx: Contexte, id: string, permission: "achats.voir" | "achats.gerer" | "achats.approuver" | "stocks.gerer") => {
    const { rows } = await ctx.client.query("select *, date_commande::text as date_commande_texte from commandes_achat where id = $1 for update", [id]);
    if (!rows[0]) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, permission, rows[0].entite_id);
    return rows[0];
  };

  const visibles = async (ctx: Contexte): Promise<string[]> => {
    await exiger(ctx, "achats.voir");
    return (await entitesAccessibles(ctx.client, ctx.utilisateurId, "achats.voir")).map((e) => String(e.id));
  };

  /** Liste filtrée : période, statut, origine, acheteur, fournisseur, et recherche par code, article ou fournisseur. */
  app.get<{ Querystring: Filtres }>("/achats/commandes", { schema: { querystring: schemaFiltres } }, async (req) =>
    protege(req, async (ctx) => {
      const { where, params } = filtrer(await visibles(ctx), req.query);
      const { rows } = await ctx.client.query(
        `select c.id, c.numero, c.statut, c.origine, c.etape, c.etape_le, c.date_commande, c.date_prevue, c.total, c.reference_fournisseur,
           t.nom as fournisseur, e.nom as entite, a.nom as acheteur, c.mode_transport,
           (select x.nom from tiers x where x.id = c.transitaire_id) as transitaire,
           coalesce((select sum(f.montant) from frais_achat f where f.commande_id = c.id and f.retire_le is null), 0)::int8 as frais,
           (select coalesce(sum(l.quantite), 0) from lignes_achat l where l.commande_id = c.id)::float as quantite,
           (select string_agg(p.nom, ', ' order by p.nom) from lignes_achat l join produits p on p.id = l.produit_id where l.commande_id = c.id) as articles,
           (c.date_prevue < current_date and c.statut in ('approuvee', 'recue_partiellement')) as en_retard,
           (select case when bool_and(l.prix_vente_prevu is not null) then sum(round(l.prix_vente_prevu * l.quantite)) end
              from lignes_achat l where l.commande_id = c.id)::int8 as chiffre_affaires_prevu,
           exists (select 1 from lignes_achat l where l.commande_id = c.id
             and l.prix_unitaire * 100 > ${PRIX_HABITUEL.replaceAll("$2", "$1")} * (100 + ${SEUIL_ALERTE_PRIX})) as alerte_prix
         from commandes_achat c join tiers t on t.id = c.fournisseur_id join entites e on e.id = c.entite_id
         join utilisateurs a on a.id = coalesce(c.acheteur_id, c.cree_par)
         where ${where} order by c.date_commande desc, c.cree_le desc limit 500`,
        params,
      );
      return rows;
    }),
  );

  /** Totaux de la sélection. Les commandes annulées sont comptées à part et n'entrent pas dans les montants. */
  app.get<{ Querystring: Filtres }>("/achats/synthese", { schema: { querystring: schemaFiltres } }, async (req) =>
    protege(req, async (ctx) => {
      const { where, params } = filtrer(await visibles(ctx), req.query);
      const sel = `select c.id, c.total, c.statut, c.date_prevue, t.nom as fournisseur, coalesce(c.acheteur_id, c.cree_par) as acheteur_id, c.transitaire_id, c.volume_m3
        from commandes_achat c join tiers t on t.id = c.fournisseur_id where ${where}`;
      const { rows: [s] } = await ctx.client.query(
        `with sel as (${sel}), actives as (select * from sel where statut <> 'annulee'),
           l as (select l.* from lignes_achat l where l.commande_id in (select id from actives))
         select (select count(*) from sel)::int as commandes,
           (select count(*) from sel where statut in ${OUVERTS})::int as en_cours,
           (select count(*) from sel where statut = 'recue')::int as recues,
           (select count(*) from sel where statut = 'annulee')::int as annulees,
           (select count(*) from sel where date_prevue < current_date and statut in ('approuvee', 'recue_partiellement'))::int as en_retard,
           (select coalesce(sum(total), 0) from actives)::int8 as montant,
           (select coalesce(sum(f.montant), 0) from frais_achat f where f.commande_id in (select id from actives) and f.retire_le is null)::int8 as frais,
           (select coalesce(sum(quantite), 0) from l)::float as quantite,
           (select coalesce(sum(quantite_recue), 0) from l)::float as quantite_recue,
           (select coalesce(round(sum(quantite_recue * prix_unitaire)), 0) from l)::int8 as montant_recu,
           (select coalesce(sum(poids_kg), 0) from l)::float as poids_kg,
           (select coalesce(sum(volume_m3), 0) from actives)::float as volume_m3`,
        params,
      );
      const parFournisseur = await ctx.client.query(
        `with sel as (${sel}) select fournisseur as nom, count(*)::int as commandes, sum(total)::int8 as montant
         from sel where statut <> 'annulee' group by fournisseur order by sum(total) desc limit 10`, params,
      );
      const parAcheteur = await ctx.client.query(
        `with sel as (${sel}) select u.nom, count(*)::int as commandes, sum(sel.total)::int8 as montant
         from sel join utilisateurs u on u.id = sel.acheteur_id where statut <> 'annulee' group by u.nom order by sum(sel.total) desc limit 10`, params,
      );
      const parNature = await ctx.client.query(
        `with sel as (${sel}) select f.nature, count(*)::int as nombre, sum(f.montant)::int8 as montant
         from frais_achat f join sel on sel.id = f.commande_id where sel.statut <> 'annulee' and f.retire_le is null
         group by f.nature order by array_position($${params.length + 1}::text[], f.nature)`, [...params, NATURES_FRAIS],
      );
      const { rows: [r] } = await ctx.client.query(
        `with sel as (${sel}), etude as (
           select a.total,
             (select sum(round(l.prix_vente_prevu * l.quantite)) from lignes_achat l where l.commande_id = a.id) as ca,
             (select bool_and(l.prix_vente_prevu is not null) from lignes_achat l where l.commande_id = a.id) as complet,
             (select coalesce(sum(f.montant), 0) from frais_achat f where f.commande_id = a.id and f.retire_le is null) as frais
           from sel a where a.statut <> 'annulee')
         select coalesce(sum(ca) filter (where complet), 0)::int8 as chiffre_affaires_prevu,
           coalesce(sum(ca - total - frais) filter (where complet), 0)::int8 as marge_prevue,
           count(*) filter (where not complet)::int as sans_prix_vente
         from etude`, params,
      );
      const parTransitaire = await ctx.client.query(
        `with sel as (${sel}), actives as (select * from sel where statut <> 'annulee')
         select x.nom, count(*)::int as commandes,
           coalesce(sum((select sum(f.montant) from frais_achat f where f.commande_id = a.id and f.retire_le is null)), 0)::int8 as frais,
           coalesce(sum((select sum(l.poids_kg) from lignes_achat l where l.commande_id = a.id)), 0)::float as poids_kg,
           coalesce(sum(a.volume_m3), 0)::float as volume_m3
         from actives a join tiers x on x.id = a.transitaire_id group by x.nom order by 3 desc limit 10`, params,
      );
      return {
        ...r, taux_marge_prevu: r.chiffre_affaires_prevu > 0 ? Math.round(r.marge_prevue * 1000 / r.chiffre_affaires_prevu) / 10 : null,
        par_transitaire: parTransitaire.rows.map((r) => ({ ...r, frais_par_kg: r.poids_kg > 0 ? Math.round(Number(r.frais) / r.poids_kg) : null })),
        ...s, cout_total: Number(s.montant) + Number(s.frais), frais_par_kg: s.poids_kg > 0 ? Math.round(Number(s.frais) / s.poids_kg) : null,
        par_fournisseur: parFournisseur.rows, par_acheteur: parAcheteur.rows, frais_par_nature: parNature.rows,
      };
    }),
  );

  /** Comptes qui peuvent être désignés comme acheteur. */
  app.get("/achats/acheteurs", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "achats.voir");
      const { rows } = await ctx.client.query(
        `select distinct u.id, u.nom from utilisateurs u join attributions a on a.utilisateur_id = u.id
         join role_permissions rp on rp.role_id = a.role_id
         where rp.permission = 'achats.gerer' and u.actif and (a.expire_le is null or a.expire_le > now()) order by u.nom`,
      );
      return rows;
    }),
  );

  app.get<{ Params: { id: string } }>("/achats/commandes/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const c = await commande(ctx, req.params.id, "achats.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "achats.voir")).map((e) => e.id);
      const lignes = await ctx.client.query(
        `select l.id, l.produit_id, p.nom, p.code, p.unite, l.quantite::float, l.prix_unitaire, l.quantite_recue::float, l.poids_kg::float, l.unite as unite_achat, l.quantite_unite::float, l.prix_unite,
           l.prix_vente_prevu, nullif(p.prix_vente, 0) as prix_catalogue,
           ${PRIX_HABITUEL} as prix_habituel,
           (select json_build_object('prix', l3.prix_unitaire, 'fournisseur', t3.nom, 'date', c3.date_commande)
              from lignes_achat l3 join commandes_achat c3 on c3.id = l3.commande_id join tiers t3 on t3.id = c3.fournisseur_id
              where l3.produit_id = l.produit_id and c3.id <> c.id and c3.statut <> 'annulee' and c3.entite_id = any($2::uuid[])
                and c3.date_commande between c.date_commande - 365 and c.date_commande
              order by l3.prix_unitaire, c3.date_commande desc limit 1) as meilleur_prix
         from lignes_achat l join produits p on p.id = l.produit_id join commandes_achat c on c.id = l.commande_id
         where l.commande_id = $1 order by p.nom`,
        [req.params.id, ids],
      );
      const frais = await ctx.client.query(
        `select f.id, f.nature, f.libelle, f.prestataire, f.montant, f.base_calcul, f.quantite_base::float, f.tarif,
           f.cree_le, f.retire_le, f.motif_retrait, u.nom as auteur
         from frais_achat f join utilisateurs u on u.id = f.auteur_id where f.commande_id = $1 order by f.cree_le`,
        [req.params.id],
      );
      const totalFrais = frais.rows.filter((f) => !f.retire_le).reduce((s, f) => s + Number(f.montant), 0);
      const etapes = await ctx.client.query(
        `select e.etape, e.date_etape, e.note, e.cree_le, u.nom as auteur from etapes_achat e
         join utilisateurs u on u.id = e.auteur_id where e.commande_id = $1 order by e.cree_le`,
        [req.params.id],
      );
      const fournisseur = await ctx.client.query("select nom, telephone from tiers where id = $1", [c.fournisseur_id]);
      const entite = await ctx.client.query("select nom from entites where id = $1", [c.entite_id]);
      const acheteur = await ctx.client.query("select id, nom from utilisateurs where id = $1", [c.acheteur_id ?? c.cree_par]);
      const transitaire = c.transitaire_id
        ? (await ctx.client.query("select id, nom, telephone from tiers where id = $1", [c.transitaire_id])).rows[0] : null;
      const receptions = await ctx.client.query(
        `select r.id, r.numero, r.note, r.cree_le, u.nom as auteur from receptions_achat r
         join utilisateurs u on u.id = r.auteur_id where r.commande_id = $1 order by r.cree_le desc`,
        [req.params.id],
      );
      const total = Number(c.total);
      const etude = rentabilite(lignes.rows, total, totalFrais);
      const poids = lignes.rows.reduce((s, l) => s + (l.poids_kg ?? 0), 0);
      const parNature = new Map<string, number>();
      for (const f of frais.rows) if (!f.retire_le) parNature.set(f.nature, (parNature.get(f.nature) ?? 0) + Number(f.montant));
      return {
        poids_kg: poids, frais_par_kg: poids > 0 ? Math.round(totalFrais / poids) : null,
        frais_par_nature: NATURES_FRAIS.filter((n) => parNature.has(n)).map((n) => ({ nature: n, montant: parNature.get(n) })),
        ...c, volume_m3: c.volume_m3 === null ? null : Number(c.volume_m3), transitaire,
        frais_par_m3: c.volume_m3 > 0 ? Math.round(totalFrais / Number(c.volume_m3)) : null,
        fournisseur: fournisseur.rows[0], entite: entite.rows[0].nom, acheteur: acheteur.rows[0], receptions: receptions.rows,
        etapes: etapes.rows, etapes_possibles: ETAPES_ACHAT[c.origine as "local" | "import"], frais: frais.rows,
        total_frais: totalFrais, cout_total: total + totalFrais, seuil_alerte_prix: SEUIL_ALERTE_PRIX,
        rentabilite: etude.total, seuil_marge_faible: SEUIL_MARGE_FAIBLE,
        lignes: lignes.rows.map((l, i) => {
          const habituel = l.prix_habituel === null ? null : Number(l.prix_habituel);
          const ecart = habituel ? Math.round((l.prix_unitaire - habituel) * 100 / habituel) : null;
          return {
            ...l, prix_habituel: habituel, ecart_prix: ecart, alerte_prix: ecart !== null && ecart > SEUIL_ALERTE_PRIX,
            ...etude.detail[i],
          };
        }),
        paiement: await paiement(ctx, c),
      };
    }),
  );

  app.put<{ Params: { id: string }; Body: { lignes: LigneCommande[] } }>("/achats/commandes/:id/lignes", {
    schema: { params: paramId, body: { type: "object", required: ["lignes"], properties: { lignes: schemaLignes } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const c = await commande(ctx, req.params.id, "achats.gerer");
      if (c.statut !== "brouillon") throw new ErreurApi(409, "commande_figee");
      if (new Set(req.body.lignes.map((l) => l.produitId)).size !== req.body.lignes.length) throw new ErreurApi(400, "produit_en_double");
      await ecrireLignes(ctx, req.params.id, req.body.lignes);
      return (await ctx.client.query("select total from commandes_achat where id = $1", [req.params.id])).rows[0];
    }),
  );

  /** Factures et paiements liés à la commande, visibles seulement avec l'accès à la comptabilité de la branche. */
  const paiement = async (ctx: Contexte, c: { id: string; entite_id: string }) => {
    const { rows: [b] } = await ctx.client.query("select entite_branche($1) as id", [c.entite_id]);
    if (!b?.id || !await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "compta.voir", b.id)) return null;
    const factures = (await ctx.client.query(
      `select f.id, f.numero, f.numero_fournisseur, f.statut, f.date_facture, f.date_echeance, f.total_ttc,
         coalesce((select sum(p.montant) from paiements_fournisseur p where p.facture_id = f.id and p.annule_le is null), 0)::int8 as paye
       from factures_fournisseur f where f.commande_id = $1 and f.statut <> 'annulee' order by f.date_facture`, [c.id],
    )).rows;
    const paiements = (await ctx.client.query(
      `select p.montant, p.date_paiement, p.reference, x.nom as moyen, f.numero_fournisseur as facture
       from paiements_fournisseur p join factures_fournisseur f on f.id = p.facture_id join portefeuilles x on x.id = p.portefeuille_id
       where f.commande_id = $1 and p.annule_le is null order by p.date_paiement`, [c.id],
    )).rows;
    const facture = factures.filter((f) => f.statut === "validee").reduce((s, f) => s + Number(f.total_ttc), 0);
    const paye = paiements.reduce((s, p) => s + Number(p.montant), 0);
    const statut = !facture ? "non_facture" : paye === 0 ? "non_paye" : paye < facture ? "partiel" : "paye";
    return { statut, facture, paye, reste: Math.max(facture - paye, 0), factures, paiements };
  };

  /** Mise à jour de l'en-tête. L'origine et l'acheteur ne changent plus une fois la commande approuvée. */
  app.patch<{
    Params: { id: string };
    Body: {
      origine?: "local" | "import"; acheteurId?: string; referenceFournisseur?: string | null; paysOrigine?: string | null; datePrevue?: string | null; notes?: string | null;
      transitaireId?: string | null; modeTransport?: "maritime" | "aerien" | null; volumeM3?: number | null;
    };
  }>("/achats/commandes/:id", {
    schema: {
      params: paramId,
      body: {
        type: "object", additionalProperties: false, minProperties: 1,
        properties: {
          origine: { type: "string", enum: ["local", "import"] }, acheteurId: uuid,
          referenceFournisseur: { type: ["string", "null"], maxLength: 100 }, paysOrigine: { type: ["string", "null"], maxLength: 100 },
          datePrevue: { type: ["string", "null"], format: "date" }, notes: { type: ["string", "null"], maxLength: 2000 },
          transitaireId: { type: ["string", "null"], format: "uuid" }, modeTransport: { type: ["string", "null"], enum: ["maritime", "aerien", null] },
          volumeM3: { ...volume, type: ["number", "null"] },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const c = await commande(ctx, req.params.id, "achats.gerer");
      const b = req.body;
      if (["recue", "annulee"].includes(c.statut)) throw new ErreurApi(409, "commande_cloturee");
      if ((b.origine !== undefined || b.acheteurId !== undefined) && c.statut !== "brouillon") throw new ErreurApi(409, "commande_figee");
      if (b.acheteurId) await verifierAcheteur(ctx, b.acheteurId, c.entite_id);
      if (b.transitaireId) await lierTransitaire(ctx, b.transitaireId, c.entite_id);
      if (b.datePrevue && b.datePrevue < String(c.date_commande_texte)) throw new ErreurApi(400, "date_avant_commande");
      const champs: [string, unknown][] = [];
      if (b.origine !== undefined) champs.push(["origine", b.origine]);
      if (b.acheteurId !== undefined) champs.push(["acheteur_id", b.acheteurId]);
      if (b.referenceFournisseur !== undefined) champs.push(["reference_fournisseur", b.referenceFournisseur?.trim() || null]);
      if (b.paysOrigine !== undefined) champs.push(["pays_origine", b.paysOrigine?.trim() || null]);
      if (b.datePrevue !== undefined) champs.push(["date_prevue", b.datePrevue]);
      if (b.notes !== undefined) champs.push(["notes", b.notes?.trim() || null]);
      if (b.transitaireId !== undefined) champs.push(["transitaire_id", b.transitaireId]);
      if (b.modeTransport !== undefined) champs.push(["mode_transport", b.modeTransport]);
      if (b.volumeM3 !== undefined) champs.push(["volume_m3", b.volumeM3]);
      await ctx.client.query(
        `update commandes_achat set ${champs.map(([k], i) => `${k} = $${i + 2}`).join(", ")} where id = $1`,
        [req.params.id, ...champs.map(([, v]) => v)],
      );
      return { enregistre: true };
    }),
  );

  /** Passage à une étape de suivi : départ, arrivée au port, dédouanement, livraison à l'entrepôt… */
  app.post<{ Params: { id: string }; Body: { etape: string; date: string; note?: string } }>("/achats/commandes/:id/etapes", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["etape", "date"],
        properties: { etape: { type: "string", maxLength: 40 }, date, note: { type: "string", maxLength: 500 } },
      },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const c = await commande(ctx, req.params.id, "achats.gerer");
      if (!["approuvee", "recue_partiellement"].includes(c.statut)) throw new ErreurApi(409, "commande_non_approuvee");
      const possibles: readonly string[] = ETAPES_ACHAT[c.origine as "local" | "import"];
      if (req.body.etape === "commandee" || !possibles.includes(req.body.etape)) throw new ErreurApi(400, "etape_invalide");
      if (req.body.date < String(c.date_commande_texte)) throw new ErreurApi(400, "date_avant_commande");
      await ctx.client.query("update commandes_achat set etape = $2, etape_le = $3 where id = $1", [req.params.id, req.body.etape, req.body.date]);
      await noterEtape(ctx, req.params.id, req.body.etape, req.body.date, req.body.note?.trim() || null);
      await publierEvenement(ctx.client, "achat.etape", { id: req.params.id, numero: c.numero, etape: req.body.etape });
      return { etape: req.body.etape };
    });
    return reponse.status(201).send(r);
  });

  /** Frais d'acheminement. Ceux saisis avant la réception entrent dans le coût de revient du stock. */
  /** Montant global, ou forfait au kilo ou au mètre cube : le montant est alors calculé ici, quantité × tarif. */
  app.post<{
    Params: { id: string };
    Body: { nature: string; montant?: number; base?: "poids" | "volume"; quantiteBase?: number; tarif?: number; libelle?: string; prestataire?: string };
  }>("/achats/commandes/:id/frais", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["nature"],
        properties: {
          nature: { type: "string", enum: NATURES_FRAIS }, montant: { type: "integer", minimum: 1, maximum: 1_000_000_000_000 },
          base: { type: "string", enum: ["poids", "volume"] }, quantiteBase: { ...volume, exclusiveMinimum: 0 },
          tarif: { type: "integer", minimum: 1, maximum: 1_000_000_000 },
          libelle: { type: "string", maxLength: 200 }, prestataire: { type: "string", maxLength: 200 },
        },
      },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const c = await commande(ctx, req.params.id, "achats.gerer");
      if (c.statut === "annulee") throw new ErreurApi(409, "commande_cloturee");
      const b = req.body;
      const forfait = b.base !== undefined || b.quantiteBase !== undefined || b.tarif !== undefined;
      if (forfait && (!b.base || !b.quantiteBase || !b.tarif)) throw new ErreurApi(400, "forfait_incomplet");
      const montant = forfait ? Math.round(Math.round(b.quantiteBase! * 1000) * b.tarif! / 1000) : b.montant;
      if (!montant || montant < 1) throw new ErreurApi(400, "montant_obligatoire");
      return (await ctx.client.query(
        `insert into frais_achat (organisation_id, commande_id, nature, libelle, prestataire, montant, base_calcul, quantite_base, tarif, auteur_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id, nature, montant`,
        [ctx.organisationId, req.params.id, b.nature, b.libelle?.trim() || null, b.prestataire?.trim() || null, montant,
          forfait ? b.base : null, forfait ? b.quantiteBase : null, forfait ? b.tarif : null, ctx.utilisateurId],
      )).rows[0];
    });
    return reponse.status(201).send(r);
  });

  /** Un frais saisi par erreur est retiré, jamais effacé : il reste visible avec son motif. */
  app.post<{ Params: { id: string }; Body: { motif: string } }>("/achats/frais/:id/retrait", {
    schema: { params: paramId, body: motifBody },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [f] } = await ctx.client.query("select commande_id, retire_le from frais_achat where id = $1 for update", [req.params.id]);
      if (!f) throw new ErreurApi(404, "introuvable");
      await commande(ctx, f.commande_id, "achats.gerer");
      if (f.retire_le) throw new ErreurApi(409, "frais_deja_retire");
      await ctx.client.query(
        "update frais_achat set retire_le = now(), retire_par = $2, motif_retrait = $3 where id = $1",
        [req.params.id, ctx.utilisateurId, req.body.motif],
      );
      return { retire: true };
    }),
  );

  /** Prix de vente prévus : modifiables à tout moment, ils ne changent ni la commande ni le stock. */
  app.put<{ Params: { id: string }; Body: { prix: { ligneId: string; prixVente: number | null }[] } }>("/achats/commandes/:id/prix-vente", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["prix"],
        properties: {
          prix: {
            type: "array", minItems: 1, maxItems: 500,
            items: { type: "object", required: ["ligneId", "prixVente"], properties: { ligneId: uuid, prixVente: { type: ["integer", "null"], minimum: 0, maximum: 10_000_000_000 } } },
          },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const c = await commande(ctx, req.params.id, "achats.gerer");
      if (c.statut === "annulee") throw new ErreurApi(409, "commande_cloturee");
      for (const p of req.body.prix) {
        const { rowCount } = await ctx.client.query(
          "update lignes_achat set prix_vente_prevu = $3 where id = $1 and commande_id = $2", [p.ligneId, req.params.id, p.prixVente],
        );
        if (!rowCount) throw new ErreurApi(404, "introuvable");
      }
      return { enregistre: true };
    }),
  );

  app.post<{ Params: { id: string } }>("/achats/commandes/:id/approbation", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const c = await commande(ctx, req.params.id, "achats.approuver");
      if (c.statut !== "brouillon") throw new ErreurApi(409, "commande_figee");
      await exigerSeparation(ctx, "commandes", c.cree_par);
      await ctx.client.query(
        "update commandes_achat set statut = 'approuvee', approuve_par = $2, approuve_le = now() where id = $1",
        [req.params.id, ctx.utilisateurId],
      );
      await publierEvenement(ctx.client, "achat.approuve", { id: req.params.id, numero: c.numero });
      return { statut: "approuvee" };
    }),
  );

  app.post<{ Params: { id: string }; Body: { motif: string } }>("/achats/commandes/:id/annulation", {
    schema: { params: paramId, body: motifBody },
  }, async (req) =>
    protege(req, async (ctx) => {
      const c = await commande(ctx, req.params.id, "achats.gerer");
      if (!["brouillon", "approuvee"].includes(c.statut)) throw new ErreurApi(409, "commande_deja_recue");
      await ctx.client.query("update commandes_achat set statut = 'annulee', motif_annulation = $2 where id = $1", [req.params.id, req.body.motif]);
      return { statut: "annulee" };
    }),
  );

  /** Confirme ce qui est réellement arrivé. Une réception partielle laisse la commande ouverte. */
  app.post<{
    Params: { id: string };
    Body: { lignes: { ligneId: string; quantite: number }[]; note?: string; cloturer?: boolean };
  }>("/achats/commandes/:id/receptions", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["lignes"],
        properties: {
          note: { type: "string", maxLength: 1000 }, cloturer: { type: "boolean" },
          lignes: {
            type: "array", minItems: 1, maxItems: 500,
            items: { type: "object", required: ["ligneId", "quantite"], properties: { ligneId: uuid, quantite } },
          },
        },
      },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const c = await commande(ctx, req.params.id, "stocks.gerer");
      if (!["approuvee", "recue_partiellement"].includes(c.statut)) throw new ErreurApi(409, "commande_non_approuvee");
      const numero = await prochainNumero(ctx.client, `REC-ACH-${annee()}`);
      const frais = await fraisActifs(ctx, req.params.id);
      const { rows: [rec] } = await ctx.client.query(
        `insert into receptions_achat (organisation_id, commande_id, numero, note, auteur_id) values ($1, $2, $3, $4, $5) returning id`,
        [ctx.organisationId, req.params.id, numero, req.body.note ?? null, ctx.utilisateurId],
      );
      for (const s of req.body.lignes) {
        const { rows: [l] } = await ctx.client.query(
          "select id, produit_id, quantite::float, prix_unitaire, quantite_recue::float from lignes_achat where id = $1 and commande_id = $2",
          [s.ligneId, req.params.id],
        );
        if (!l) throw new ErreurApi(404, "introuvable");
        const reste = l.quantite - l.quantite_recue;
        if (s.quantite > reste + 0.0005) throw new ErreurApi(409, "quantite_superieure_a_la_commande", { reste });
        await produitSuivi(ctx.client, l.produit_id);
        await entrerEnStock(ctx, c.entite_id, l.produit_id, s.quantite, coutRevient(Number(c.total), frais, Number(l.prix_unitaire)), "achat", null, c.numero);
        await ctx.client.query("update lignes_achat set quantite_recue = quantite_recue + $2 where id = $1", [l.id, s.quantite]);
        await ctx.client.query(
          "insert into lignes_reception (organisation_id, reception_id, ligne_id, quantite) values ($1, $2, $3, $4)",
          [ctx.organisationId, rec.id, l.id, s.quantite],
        );
      }
      const { rows: [o] } = await ctx.client.query(
        "select count(*) filter (where quantite_recue < quantite)::int as ouvertes from lignes_achat where commande_id = $1", [req.params.id],
      );
      const statut = o.ouvertes === 0 || req.body.cloturer ? "recue" : "recue_partiellement";
      await ctx.client.query("update commandes_achat set statut = $2 where id = $1", [req.params.id, statut]);
      if (statut === "recue") {
        await ctx.client.query("update commandes_achat set etape = 'en_stock', etape_le = current_date where id = $1", [req.params.id]);
        await noterEtape(ctx, req.params.id, "en_stock", null, `Réception ${numero}`);
      }
      await publierEvenement(ctx.client, "achat.recu", { id: req.params.id, reception: numero });
      return { numero, statut };
    });
    return reponse.status(201).send(r);
  });

  /** Articles sous leur seuil, moins ce qui est déjà commandé et attendu, jusqu'au stock cible. */
  app.get("/achats/reapprovisionnement", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "achats.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "achats.voir")).map((e) => e.id);
      const { rows } = await ctx.client.query(
        `with lieux as (select entite_id from modules_entite where module = 'achats_stocks' and actif and entite_id = any($1::uuid[])),
         base as (
           select e.id as entite_id, e.nom as entite, p.id as produit_id, p.code, p.nom, p.unite, p.cout_moyen,
             p.seuil_alerte::float as seuil, p.stock_cible::float as cible,
             coalesce((select sum(m.quantite) from mouvements_stock m where m.produit_id = p.id and m.entite_id = e.id), 0)::float as stock,
             coalesce((select sum(l.quantite - l.quantite_recue) from lignes_achat l join commandes_achat c on c.id = l.commande_id
               where l.produit_id = p.id and c.entite_id = e.id and c.statut in ('brouillon', 'approuvee', 'recue_partiellement')), 0)::float as attendu
           from lieux join entites e on e.id = lieux.entite_id
           cross join produits p
           where p.suivi_stock and p.actif and p.seuil_alerte > 0
             and exists (select 1 from mouvements_stock m where m.produit_id = p.id and m.entite_id = e.id)
         )
         select *, greatest(greatest(cible, seuil) - stock - attendu, 0) as a_commander
         from base where stock <= seuil order by entite, nom limit 1000`,
        [ids],
      );
      return rows;
    }),
  );

  const stockLignes = async (ctx: Contexte, lignes: { produitId: string; quantite: number }[]) => {
    if (new Set(lignes.map((l) => l.produitId)).size !== lignes.length) throw new ErreurApi(400, "produit_en_double");
    for (const l of [...lignes].sort((a, b) => a.produitId.localeCompare(b.produitId))) await produitSuivi(ctx.client, l.produitId);
  };

  const transfert = async (ctx: Contexte, id: string) => {
    const { rows } = await ctx.client.query("select * from transferts_stock where id = $1 for update", [id]);
    if (!rows[0]) throw new ErreurApi(404, "introuvable");
    return rows[0];
  };

  /** 1. Demande : ne touche pas au stock. Il suffit d'avoir la main sur l'une des deux entités. */
  app.post<{
    Body: { depuisId: string; versId: string; note?: string; lignes: { produitId: string; quantite: number }[] };
  }>("/transferts", {
    schema: {
      body: {
        type: "object", required: ["depuisId", "versId", "lignes"],
        properties: {
          depuisId: uuid, versId: uuid, note: { type: "string", maxLength: 1000 },
          lignes: {
            type: "array", minItems: 1, maxItems: 500,
            items: { type: "object", required: ["produitId", "quantite"], properties: { produitId: uuid, quantite } },
          },
        },
      },
    },
  }, async (req, reponse) => {
    const t = await protege(req, async (ctx) => {
      const b = req.body;
      if (b.depuisId === b.versId) throw new ErreurApi(400, "transfert_identique");
      const autorise = await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "stocks.gerer", b.depuisId)
        || await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "stocks.gerer", b.versId);
      if (!autorise) throw new ErreurApi(403, "permission_refusee");
      await exigerModule(ctx, b.depuisId);
      await exigerModule(ctx, b.versId);
      await stockLignes(ctx, b.lignes);
      const numero = await prochainNumero(ctx.client, `TR-${annee()}`);
      const { rows } = await ctx.client.query(
        `insert into transferts_stock (organisation_id, numero, depuis_id, vers_id, note, cree_par)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [ctx.organisationId, numero, b.depuisId, b.versId, b.note ?? null, ctx.utilisateurId],
      );
      for (const l of b.lignes) {
        await ctx.client.query(
          "insert into lignes_transfert (organisation_id, transfert_id, produit_id, quantite) values ($1, $2, $3, $4)",
          [ctx.organisationId, rows[0].id, l.produitId, l.quantite],
        );
      }
      return rows[0];
    });
    return reponse.status(201).send(t);
  });

  const lignesTransfert = async (ctx: Contexte, id: string) => (await ctx.client.query(
    `select l.id, l.produit_id, p.nom, p.unite, l.quantite::float, l.quantite_recue::float
     from lignes_transfert l join produits p on p.id = l.produit_id where l.transfert_id = $1 order by l.produit_id`,
    [id],
  )).rows;

  /** 2. Confirmation de sortie par l'entrepôt d'origine : la marchandise quitte son stock. */
  app.post<{ Params: { id: string } }>("/transferts/:id/expedition", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const t = await transfert(ctx, req.params.id);
      await exigerSurEntite(ctx, "stocks.gerer", t.depuis_id);
      if (t.statut !== "demande") throw new ErreurApi(409, "transfert_deja_traite");
      for (const l of await lignesTransfert(ctx, req.params.id)) {
        await produitSuivi(ctx.client, l.produit_id);
        await sortirDuStock(ctx, t.depuis_id, l.produit_id, l.quantite, "transfert_sortie", null, null, t.numero);
      }
      await ctx.client.query(
        "update transferts_stock set statut = 'expedie', expedie_par = $2, expedie_le = now() where id = $1",
        [req.params.id, ctx.utilisateurId],
      );
      return { statut: "expedie" };
    }),
  );

  /** 3. Confirmation d'arrivée par la destination : seul ce qui est compté entre en stock. */
  app.post<{
    Params: { id: string };
    Body: { lignes: { produitId: string; quantiteRecue: number }[]; motifEcart?: string };
  }>("/transferts/:id/reception", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["lignes"],
        properties: {
          motifEcart: { type: "string", minLength: 3, maxLength: 500 },
          lignes: {
            type: "array", minItems: 1, maxItems: 500,
            items: {
              type: "object", required: ["produitId", "quantiteRecue"],
              properties: { produitId: uuid, quantiteRecue: { type: "number", minimum: 0, maximum: 1_000_000_000, multipleOf: 0.001 } },
            },
          },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const t = await transfert(ctx, req.params.id);
      await exigerSurEntite(ctx, "stocks.gerer", t.vers_id);
      if (t.statut !== "expedie") throw new ErreurApi(409, "transfert_non_expedie");
      const saisies = new Map(req.body.lignes.map((l) => [l.produitId, l.quantiteRecue]));
      const lignes = await lignesTransfert(ctx, req.params.id);
      if (saisies.size !== lignes.length || lignes.some((l) => !saisies.has(l.produit_id))) throw new ErreurApi(400, "lignes_incompletes");
      let ecart = false;
      for (const l of lignes) {
        const recue = saisies.get(l.produit_id)!;
        if (recue > l.quantite + 0.0005) throw new ErreurApi(409, "quantite_superieure_a_lexpedie", { produitId: l.produit_id });
        if (!egal(recue, l.quantite)) ecart = true;
      }
      if (ecart && !req.body.motifEcart) throw new ErreurApi(400, "motif_ecart_obligatoire");
      for (const l of lignes) {
        const recue = saisies.get(l.produit_id)!;
        const p = await produitSuivi(ctx.client, l.produit_id);
        if (recue > 0) {
          await ctx.client.query(
            `insert into mouvements_stock (organisation_id, entite_id, produit_id, type, quantite, cout_unitaire, reference, auteur_id)
             values ($1, $2, $3, 'transfert_entree', $4, $5, $6, $7)`,
            [ctx.organisationId, t.vers_id, l.produit_id, recue, p.cout_moyen, t.numero, ctx.utilisateurId],
          );
        }
        await ctx.client.query("update lignes_transfert set quantite_recue = $2 where id = $1", [l.id, recue]);
      }
      await ctx.client.query(
        "update transferts_stock set statut = 'recu', recu_par = $2, recu_le = now(), motif_ecart = $3 where id = $1",
        [req.params.id, ctx.utilisateurId, ecart ? req.body.motifEcart : null],
      );
      await publierEvenement(ctx.client, "transfert.recu", { id: req.params.id, ecart });
      return { statut: "recu", ecart };
    }),
  );

  /** Annulation avant l'arrivée : ce qui avait quitté l'origine y revient. */
  app.post<{ Params: { id: string }; Body: { motif: string } }>("/transferts/:id/annulation", {
    schema: { params: paramId, body: motifBody },
  }, async (req) =>
    protege(req, async (ctx) => {
      const t = await transfert(ctx, req.params.id);
      await exigerSurEntite(ctx, "stocks.gerer", t.depuis_id);
      if (!["demande", "expedie"].includes(t.statut)) throw new ErreurApi(409, "transfert_deja_traite");
      if (t.statut === "expedie") {
        for (const l of await lignesTransfert(ctx, req.params.id)) {
          const p = await produitSuivi(ctx.client, l.produit_id);
          await ctx.client.query(
            `insert into mouvements_stock (organisation_id, entite_id, produit_id, type, quantite, cout_unitaire, motif, reference, auteur_id)
             values ($1, $2, $3, 'transfert_entree', $4, $5, $6, $7, $8)`,
            [ctx.organisationId, t.depuis_id, l.produit_id, l.quantite, p.cout_moyen, `Annulation : ${req.body.motif}`, t.numero, ctx.utilisateurId],
          );
        }
      }
      await ctx.client.query("update transferts_stock set statut = 'annule', motif_annulation = $2 where id = $1", [req.params.id, req.body.motif]);
      return { statut: "annule" };
    }),
  );

  app.get("/transferts", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "stocks.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "stocks.voir")).map((e) => e.id);
      const { rows } = await ctx.client.query(
        `select t.id, t.numero, t.statut, t.depuis_id, t.vers_id, t.note, t.motif_ecart, t.motif_annulation, t.cree_le,
           a.nom as depuis, b.nom as vers,
           coalesce((select json_agg(json_build_object('produit_id', l.produit_id, 'nom', p.nom, 'quantite', l.quantite::float, 'quantite_recue', l.quantite_recue::float) order by p.nom)
             from lignes_transfert l join produits p on p.id = l.produit_id where l.transfert_id = t.id), '[]') as lignes
         from transferts_stock t join entites a on a.id = t.depuis_id join entites b on b.id = t.vers_id
         where t.depuis_id = any($1::uuid[]) or t.vers_id = any($1::uuid[])
         order by t.statut in ('recu', 'annule'), t.cree_le desc limit 500`,
        [ids],
      );
      return rows;
    }),
  );

  /** Réajustement proposé : le stock ne change qu'après confirmation d'un responsable. */
  app.post<{ Body: { entiteId: string; produitId: string; compte: number; motif: string } }>("/stocks/reajustements", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "produitId", "compte", "motif"],
        properties: {
          entiteId: uuid, produitId: uuid,
          compte: { type: "number", minimum: 0, maximum: 1_000_000_000, multipleOf: 0.001 },
          motif: { type: "string", minLength: 3, maxLength: 500 },
        },
      },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "stocks.gerer", b.entiteId);
      await exigerModule(ctx, b.entiteId);
      await produitSuivi(ctx.client, b.produitId);
      const { rows: enCours } = await ctx.client.query("select 1 from reajustements_stock where entite_id = $1 and produit_id = $2 and statut = 'en_attente'", [b.entiteId, b.produitId]);
      if (enCours[0]) throw new ErreurApi(409, "reajustement_en_attente");
      const constate = await niveau(ctx.client, b.entiteId, b.produitId);
      const { rows } = await ctx.client.query(
        `insert into reajustements_stock (organisation_id, entite_id, produit_id, stock_constate, quantite_comptee, motif, propose_par)
         values ($1, $2, $3, $4, $5, $6, $7) returning id, statut, stock_constate::float, quantite_comptee::float`,
        [ctx.organisationId, b.entiteId, b.produitId, constate, b.compte, b.motif, ctx.utilisateurId],
      );
      return { ...rows[0], ecart: Math.round((b.compte - constate) * 1000) / 1000 };
    });
    return reponse.status(201).send(r);
  });

  app.get("/stocks/reajustements", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "stocks.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "stocks.voir")).map((e) => e.id);
      const { rows } = await ctx.client.query(
        `select r.id, r.statut, r.stock_constate::float, r.quantite_comptee::float, (r.quantite_comptee - r.stock_constate)::float as ecart,
           r.motif, r.motif_rejet, r.cree_le, r.entite_id, e.nom as entite, p.nom as produit, u.nom as propose_par, d.nom as decide_par
         from reajustements_stock r join entites e on e.id = r.entite_id join produits p on p.id = r.produit_id
         join utilisateurs u on u.id = r.propose_par left join utilisateurs d on d.id = r.decide_par
         where r.entite_id = any($1::uuid[]) order by r.statut <> 'en_attente', r.cree_le desc limit 500`,
        [ids],
      );
      return rows;
    }),
  );

  /** L'écart compté s'applique au stock d'aujourd'hui : les ventes faites entre-temps restent comptées. */
  app.post<{ Params: { id: string }; Body: { decision: string; motif?: string } }>("/stocks/reajustements/:id/decision", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["decision"],
        properties: { decision: { type: "string", enum: ["confirme", "rejete"] }, motif: { type: "string", minLength: 3, maxLength: 500 } },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [r] } = await ctx.client.query(
        "select *, stock_constate::float as constate, quantite_comptee::float as compte from reajustements_stock where id = $1 for update",
        [req.params.id],
      );
      if (!r) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "stocks.valider", r.entite_id);
      if (r.statut !== "en_attente") throw new ErreurApi(409, "deja_decide");
      if (req.body.decision === "rejete" && !req.body.motif) throw new ErreurApi(400, "motif_obligatoire");
      let ecart = 0;
      if (req.body.decision === "confirme") {
        const p = await produitSuivi(ctx.client, r.produit_id);
        ecart = Math.round((r.compte - r.constate) * 1000) / 1000;
        if (ecart !== 0) {
          const actuel = await niveau(ctx.client, r.entite_id, r.produit_id);
          if (actuel + ecart < -0.0005) throw new ErreurApi(409, "stock_insuffisant", { disponible: actuel });
          await ctx.client.query(
            `insert into mouvements_stock (organisation_id, entite_id, produit_id, type, quantite, cout_unitaire, motif, auteur_id)
             values ($1, $2, $3, 'ajustement', $4, $5, $6, $7)`,
            [ctx.organisationId, r.entite_id, r.produit_id, ecart, p.cout_moyen, r.motif, ctx.utilisateurId],
          );
        }
      }
      await ctx.client.query(
        "update reajustements_stock set statut = $2, decide_par = $3, decide_le = now(), motif_rejet = $4 where id = $1",
        [req.params.id, req.body.decision, ctx.utilisateurId, req.body.motif ?? null],
      );
      return { statut: req.body.decision, ecart };
    }),
  );
}
