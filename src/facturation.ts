import { exigerNonBloque } from "./tiers.js";
import type { FastifyInstance } from "fastify";
import { genererEan13 } from "./articles.js";
import { brutTranches, controleCredit, prixProduit } from "./commerce.js";
import { dansOrganisation, definirActeur, publierEvenement, type Client } from "./base.js";
import type { Permission } from "./catalogue.js";
import { prochainNumero } from "./formations.js";
import { aPermissionSurEntite, aPermission, entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils, type TachePlanifiee } from "./serveur.js";
import pg from "pg";
import { produitSuivi, sortirDuStock } from "./stocks.js";
import { lierTiers } from "./tiers.js";

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max: number) => ({ type: "string", minLength: 1, maxLength: max }) as const;
const motifBody = { type: "object", required: ["motif"], properties: { motif: { type: "string", minLength: 5, maxLength: 500 } } } as const;
const SERIES: Record<string, string> = { devis: "DEV", facture: "FAC", avoir: "AV" };
const JOURS = "(now() at time zone 'Africa/Douala')::date";

export interface LigneSaisie {
  produitId?: string;
  designation?: string;
  quantite: number;
  prixUnitaire?: number;
  remisePct?: number;
  tauxTaxe?: number;
}

/** Calcul en entiers pour éviter les erreurs d'arrondi : milliers d'unités, centièmes de pour cent, FCFA entiers. */
export function calculerLigne(quantite: number, prix: number, remisePct: number, taux: number, brutExact?: number) {
  const brut = brutExact !== undefined ? brutExact * 1000 : Math.round(quantite * 1000) * prix;
  const ht = Math.round((brut * (10000 - Math.round(remisePct * 100))) / 10_000_000);
  const taxes = Math.round((ht * Math.round(taux * 1000)) / 100_000);
  return { ht, taxes };
}

const tauxLibre = { type: "number", minimum: 0, maximum: 100, multipleOf: 0.001 } as const;

const schemaLignes = {
  type: "array", minItems: 1, maxItems: 500,
  items: {
    type: "object", required: ["quantite"],
    properties: {
      produitId: uuid, designation: texte(300),
      quantite: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000_000 },
      prixUnitaire: { type: "integer", minimum: 0, maximum: 10_000_000_000 },
      remisePct: { type: "number", minimum: 0, maximum: 100 },
      tauxTaxe: tauxLibre,
    },
  },
} as const;

/** Réécrit les lignes d'un brouillon et ses totaux. Aucune taxe n'est ajoutée sans pourcentage saisi. */
async function ecrireLignes(ctx: Contexte, documentId: string, lignes: LigneSaisie[]) {
  await ctx.client.query("delete from lignes_vente where document_id = $1", [documentId]);
  let ordre = 1, ht = 0, taxes = 0;
  for (const l of lignes) {
    const p = l.produitId
      ? (await ctx.client.query(`with recursive lignee as (
             select e.id, e.parent_id from entites e join documents_vente d on d.entite_id = e.id where d.id = $2
             union all select e.id, e.parent_id from entites e join lignee l on e.id = l.parent_id
           )
           select nom, prix_vente, taux_taxe::float, actif from produits
           where id = $1 and entite_id in (select id from lignee)`, [l.produitId, documentId])).rows[0]
      : null;
    // Un produit d'une autre branche n'existe pas pour ce document.
    if (l.produitId && (!p || !p.actif)) throw new ErreurApi(404, "introuvable");
    const designation = l.designation?.trim() || p?.nom;
    const clientDoc = l.produitId && l.prixUnitaire === undefined ? (await ctx.client.query("select tiers_id from documents_vente where id = $1", [documentId])).rows[0]?.tiers_id : null;
    const prix = l.prixUnitaire ?? (l.produitId ? await prixProduit(ctx.client, l.produitId, p.prix_vente, l.quantite, clientDoc) : undefined);
    const tranches = l.produitId && l.prixUnitaire === undefined ? await brutTranches(ctx.client, l.produitId, p.prix_vente, l.quantite, clientDoc) : undefined;
    if (!designation || prix === undefined) throw new ErreurApi(400, "ligne_incomplete");
    const taux = l.tauxTaxe ?? p?.taux_taxe ?? 0;
    const remise = l.remisePct ?? 0;
    const m = calculerLigne(l.quantite, prix, remise, taux, tranches);
    await ctx.client.query(
      `insert into lignes_vente (organisation_id, document_id, ordre, produit_id, designation, quantite, prix_unitaire,
         remise_pct, taux, montant_ht, montant_taxes)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [ctx.organisationId, documentId, ordre++, l.produitId ?? null, designation, l.quantite, prix, remise, taux, m.ht, m.taxes],
    );
    ht += m.ht;
    taxes += m.taxes;
  }
  const { rows: [d] } = await ctx.client.query(
    "select frais_livraison, taux_frais::float from documents_vente where id = $1", [documentId],
  );
  const frais = calculerLigne(1, d.frais_livraison, 0, d.taux_frais);
  ht += frais.ht;
  taxes += frais.taxes;
  await ctx.client.query(
    "update documents_vente set total_ht = $2, total_taxes = $3, total_ttc = $4 where id = $1",
    [documentId, ht, taxes, ht + taxes],
  );
  return ht + taxes;
}

/** Ce qui reste dû sur une facture, après règlements valides et avoirs émis. */
async function soldes(c: Client, factureId: string) {
  const { rows } = await c.query(
    `select f.total_ttc::int8 as ttc,
       (select coalesce(sum(r.montant), 0) from reglements r where r.facture_id = f.id and r.annule_le is null)::int8 as regle,
       (select coalesce(sum(a.total_ttc), 0) from documents_vente a where a.origine_id = f.id and a.type = 'avoir' and a.statut = 'emis')::int8 as avoirs
     from documents_vente f where f.id = $1`,
    [factureId],
  );
  const { ttc, regle, avoirs } = rows[0];
  return { ttc, regle, avoirs, reste: ttc - regle - avoirs };
}

export function enregistrerFacturation(app: FastifyInstance, outils: Outils, pool: pg.Pool, taches: TachePlanifiee[] = []): void {
  const { protege, exiger, exigerSurEntite } = outils;

  const exigerModule = async (ctx: Contexte, entiteId: string) => {
    const { rows } = await ctx.client.query(
      "select actif from modules_entite where entite_id = $1 and module = 'facturation'", [entiteId],
    );
    if (!rows[0]?.actif) throw new ErreurApi(409, "module_inactif");
  };

  const documentAutorise = async (ctx: Contexte, id: string, p: Permission, verrou = false) => {
    const { rows } = await ctx.client.query(`select * from documents_vente where id = $1 ${verrou ? "for update" : ""}`, [id]);
    if (!rows[0]) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, p, rows[0].entite_id);
    return rows[0];
  };

  /** Entités dont l'utilisateur voit le catalogue : les siennes et leurs ancêtres, jamais une branche voisine. */
  const entitesDuCatalogue = async (ctx: Contexte) => {
    const directes = new Set<unknown>();
    for (const p of ["facturation.voir", "stocks.voir", "catalogue.gerer"] as Permission[]) {
      for (const e of await entitesAccessibles(ctx.client, ctx.utilisateurId, p)) directes.add(e.id);
    }
    if (!directes.size) throw new ErreurApi(403, "permission_refusee");
    const { rows: toutes } = await ctx.client.query("select id, parent_id from entites");
    const parents = new Map(toutes.map((e) => [e.id, e.parent_id]));
    const visibles = new Set<unknown>();
    for (let id of directes) {
      while (id && !visibles.has(id)) {
        visibles.add(id);
        id = parents.get(id);
      }
    }
    return [...visibles];
  };

  app.patch<{ Params: { id: string }; Body: { raisonSociale?: string; niu?: string; rccm?: string; adresse?: string } }>(
    "/entites/:id/identite", {
      schema: {
        params: paramId,
        body: {
          type: "object", minProperties: 1,
          properties: { raisonSociale: texte(200), niu: texte(40), rccm: texte(60), adresse: texte(300) },
        },
      },
    }, async (req) =>
      protege(req, async (ctx) => {
        await exigerSurEntite(ctx, "facturation.administrer", req.params.id);
        const b = req.body;
        const { rows } = await ctx.client.query(
          `update entites set raison_sociale = coalesce($2, raison_sociale), niu = coalesce($3, niu),
             rccm = coalesce($4, rccm), adresse = coalesce($5, adresse) where id = $1
           returning id, raison_sociale, niu, rccm, adresse`,
          [req.params.id, b.raisonSociale ?? null, b.niu ?? null, b.rccm ?? null, b.adresse ?? null],
        );
        return rows[0];
      }),
  );

  app.post<{
    Body: {
      entiteId: string; code: string; nom: string; type?: string; unite?: string; prixVente?: number;
      suiviStock?: boolean; seuilAlerte?: number; stockCible?: number; tauxTaxe?: number; codeBarres?: string;
      categorieId?: string; typeColis?: string; piecesParUnite?: number; marqueId?: string; codeBarresAuto?: boolean;
    };
  }>("/produits", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "code", "nom"],
        properties: {
          entiteId: uuid, code: texte(60), nom: texte(200),
          type: { type: "string", enum: ["produit", "service", "formation", "abonnement"] },
          unite: texte(30), prixVente: { type: "integer", minimum: 0, maximum: 10_000_000_000 },
          tauxTaxe: tauxLibre, suiviStock: { type: "boolean" }, codeBarres: texte(64),
          seuilAlerte: { type: "number", minimum: 0, maximum: 1_000_000_000 },
          stockCible: { type: "number", minimum: 0, maximum: 1_000_000_000 },
          categorieId: uuid, typeColis: texte(40), piecesParUnite: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000 },
          marqueId: uuid, codeBarresAuto: { type: "boolean" },
        },
      },
    },
  }, async (req, reponse) => {
    const p = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "catalogue.gerer", b.entiteId);
      if (b.categorieId) {
        // La catégorie vient du module Stocks : même branche que l'article.
        const { rows: [c] } = await ctx.client.query("select 1 from categories_articles where id = $1 and actif and branche_id = coalesce(entite_branche($2), $2)", [b.categorieId, b.entiteId]);
        if (!c) throw new ErreurApi(409, "categorie_autre_branche");
      }
      if (b.marqueId) {
        const { rows: [m] } = await ctx.client.query("select 1 from marques where id = $1 and actif and branche_id = coalesce(entite_branche($2), $2)", [b.marqueId, b.entiteId]);
        if (!m) throw new ErreurApi(409, "marque_autre_branche");
      }
      // Sans code-barres saisi, un EAN13 interne peut être attribué tout de suite.
      const codeBarres = b.codeBarres ?? (b.codeBarresAuto && (b.type ?? "produit") === "produit" ? await genererEan13(ctx.client) : null);
      if (b.suiviStock && (b.type ?? "produit") !== "produit") throw new ErreurApi(400, "donnees_invalides");
      if (b.suiviStock) {
        const m = await ctx.client.query(
          "select actif from modules_entite where entite_id = $1 and module = 'achats_stocks'", [b.entiteId],
        );
        if (!m.rows[0]?.actif) throw new ErreurApi(409, "module_inactif");
      }
      const { rows } = await ctx.client.query(
        `insert into produits (organisation_id, code, nom, type, unite, prix_vente, taux_taxe, suivi_stock, seuil_alerte, stock_cible, entite_id, code_barres, categorie_id, type_colis, pieces_par_unite, marque_id)
         values ($1, $2, $3, coalesce($4, 'produit'), coalesce($5, 'pièce'), $6, $7, $8, $9, $10, $11, $12, $13, $14, coalesce($15, 1), $16) returning *`,
        [ctx.organisationId, b.code, b.nom, b.type ?? null, b.unite ?? null, b.prixVente ?? 0, b.tauxTaxe ?? 0, b.suiviStock ?? false, b.seuilAlerte ?? 0, b.stockCible ?? 0, b.entiteId, codeBarres,
          b.categorieId ?? null, b.typeColis?.trim() || null, b.piecesParUnite ?? null, b.marqueId ?? null],
      );
      return rows[0];
    });
    return reponse.status(201).send(p);
  });

  app.patch<{
    Params: { id: string };
    Body: { nom?: string; prixVente?: number; tauxTaxe?: number; seuilAlerte?: number; stockCible?: number; actif?: boolean; codeBarres?: string };
  }>("/produits/:id", {
    schema: {
      params: paramId,
      body: {
        type: "object", minProperties: 1,
        properties: {
          nom: texte(200), prixVente: { type: "integer", minimum: 0, maximum: 10_000_000_000 }, tauxTaxe: tauxLibre,
          seuilAlerte: { type: "number", minimum: 0, maximum: 1_000_000_000 },
          stockCible: { type: "number", minimum: 0, maximum: 1_000_000_000 }, actif: { type: "boolean" }, codeBarres: texte(64),
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const p = await ctx.client.query("select entite_id from produits where id = $1", [req.params.id]);
      if (!p.rows[0]) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "catalogue.gerer", p.rows[0].entite_id);
      const b = req.body;
      const { rows } = await ctx.client.query(
        `update produits set nom = coalesce($2, nom), prix_vente = coalesce($3, prix_vente), taux_taxe = coalesce($4, taux_taxe),
           seuil_alerte = coalesce($5, seuil_alerte), actif = coalesce($6, actif), stock_cible = coalesce($7, stock_cible), code_barres = coalesce($8, code_barres) where id = $1 returning *`,
        [req.params.id, b.nom ?? null, b.prixVente ?? null, b.tauxTaxe ?? null, b.seuilAlerte ?? null, b.actif ?? null, b.stockCible ?? null, b.codeBarres ?? null],
      );
      return rows[0];
    }),
  );

  app.get<{ Querystring: { q?: string } }>("/produits", {
    schema: { querystring: { type: "object", properties: { q: { type: "string", maxLength: 100 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const visibles = await entitesDuCatalogue(ctx);
      const voitCout = new Set((await entitesAccessibles(ctx.client, ctx.utilisateurId, "facturation.administrer")).map((e) => e.id));
      const motif = `%${(req.query.q ?? "").replace(/[\\%_]/g, "\\$&")}%`;
      const { rows } = await ctx.client.query(
        `select id, code, nom, type, unite, parent_id, attributs, prix_vente, taux_taxe::float, suivi_stock, seuil_alerte::float, stock_cible::float, cout_moyen, actif, entite_id, code_barres, garantie_mois, paliers_actif, rayon, categorie_id, type_colis, pieces_par_unite::float, marque_id, prix_piece, conditionnements,
           (select m.nom from marques m where m.id = produits.marque_id) as marque,
           coalesce((select json_agg(json_build_object('position', f.position, 'version', (extract(epoch from f.maj_le) * 1000)::bigint) order by f.position) from photos_produits f where f.produit_id = produits.id), '[]') as photos,
           (select case when cp.id is null then c.nom else cp.nom || ' › ' || c.nom end from categories_articles c left join categories_articles cp on cp.id = c.parent_id where c.id = produits.categorie_id) as categorie,
           (select json_build_object('type', o.type, 'valeur', o.valeur) from promotions o where o.produit_id = produits.id and o.actif and (now() at time zone 'Africa/Douala')::date between o.debut and o.fin order by o.cree_le desc limit 1) as promo,
           (select json_agg(json_build_object('quantite_min', x.quantite_min::float, 'prix', x.prix)) from paliers_prix x where x.produit_id = produits.id) as paliers
         from produits where (nom ilike $1 or code ilike $1 or code_barres = $3) and entite_id = any($2::uuid[])
         order by actif desc, nom limit 500`,
        [motif, visibles, req.query.q ?? ""],
      );
      // Le coût de revient et donc la marge restent réservés.
      return rows.map(({ cout_moyen, ...r }) => (voitCout.has(r.entite_id) ? { ...r, cout_moyen } : r));
    }),
  );

  const creerBrouillon = async (
    ctx: Contexte, type: string, b: {
      entiteId: string; tiersId: string; date: string; echeance?: string; notes?: string; clientNiu?: string;
      modeRemise?: string; adresseLivraison?: string; transporteur?: string; fraisLivraison?: number; tauxFrais?: number;
    },
    lignes: LigneSaisie[], origineId: string | null = null, motif: string | null = null,
  ) => {
    await lierTiers(ctx, b.tiersId, b.entiteId);
    const { rows } = await ctx.client.query(
      `insert into documents_vente (organisation_id, entite_id, type, tiers_id, date_document, date_echeance, notes, client_niu, cree_par, origine_id, motif,
         mode_remise, adresse_livraison, transporteur, frais_livraison, taux_frais)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, coalesce($12, 'aucun'), $13, $14, $15, $16) returning id`,
      [ctx.organisationId, b.entiteId, type, b.tiersId, b.date, b.echeance ?? null, b.notes ?? null, b.clientNiu ?? null, ctx.utilisateurId, origineId, motif,
        b.modeRemise ?? null, b.adresseLivraison ?? null, b.transporteur ?? null, b.fraisLivraison ?? 0, b.tauxFrais ?? 0],
    );
    await ecrireLignes(ctx, rows[0].id, lignes);
    return rows[0].id as string;
  };

  const emettre = async (ctx: Contexte, id: string, entrepotId?: string) => {
    const { rows: [d] } = await ctx.client.query(
      `select d.*, e.code as entite_code, e.nom as entite_nom, e.raison_sociale, e.niu, e.rccm, e.adresse, t.nom as tiers_nom
       from documents_vente d join entites e on e.id = d.entite_id join tiers t on t.id = d.tiers_id where d.id = $1`,
      [id],
    );
    if (d.type !== "devis" && !d.niu) throw new ErreurApi(409, "identite_vendeur_incomplete");
    if (d.type !== "devis" && !d.raison_sociale) throw new ErreurApi(409, "identite_vendeur_incomplete");
    if (d.type === "facture") {
      // Verrou par client : deux factures simultanées ne franchissent pas le plafond ensemble.
      await ctx.client.query("select 1 from tiers where id = $1 for update", [d.tiers_id]);
      const credit = await controleCredit(ctx.client, d.tiers_id, d.total_ttc);
      if (credit?.depasse && !(await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "facturation.administrer", d.entite_id))) {
        throw new ErreurApi(409, "plafond_credit_depasse", credit);
      }
    }

    if (d.type === "facture") {
      const { rows: suivis } = await ctx.client.query(
        `select l.produit_id, sum(l.quantite)::float as quantite from lignes_vente l join produits p on p.id = l.produit_id
         where l.document_id = $1 and p.suivi_stock group by l.produit_id order by l.produit_id`,
        [id],
      );
      if (suivis.length) {
        // Par défaut, la vente confirmée sort automatiquement du stock du magasin qui facture.
        const stockLocal = await ctx.client.query(
          "select 1 from modules_entite where entite_id = $1 and module = 'achats_stocks' and actif", [d.entite_id],
        );
        const lieu = entrepotId ?? (stockLocal.rows[0] ? d.entite_id : null);
        if (!lieu) throw new ErreurApi(400, "entrepot_obligatoire");
        // Vendre donne le droit de sortir la marchandise vendue, sans donner la gestion du stock.
        await exigerSurEntite(ctx, "facturation.gerer", lieu);
        for (const s of suivis) {
          await produitSuivi(ctx.client, s.produit_id);
          await sortirDuStock(ctx, lieu, s.produit_id, s.quantite, "vente", null, id);
        }
      }
    }

    const numero = await prochainNumero(ctx.client, `${SERIES[d.type]}-${d.entite_code}-${d.date_document.slice(0, 4)}`);
    const { rows } = await ctx.client.query(
      `update documents_vente set statut = 'emis', numero = $2, emis_le = now(), client_nom = $3,
         vendeur_nom = $4, vendeur_niu = $5, vendeur_rccm = $6, vendeur_adresse = $7
       where id = $1 returning *`,
      [id, numero, d.tiers_nom, d.raison_sociale ?? d.entite_nom, d.niu, d.rccm, d.adresse],
    );
    await publierEvenement(ctx.client, `${d.type}.emis`, { id, numero, ttc: d.total_ttc });
    return rows[0];
  };

  app.post<{
    Body: {
      type: string; entiteId: string; tiersId: string; date: string; echeance?: string; notes?: string;
      clientNiu?: string; lignes: LigneSaisie[]; modeRemise?: string; adresseLivraison?: string;
      transporteur?: string; fraisLivraison?: number; tauxFrais?: number;
    };
  }>("/documents-vente", {
    schema: {
      body: {
        type: "object", required: ["type", "entiteId", "tiersId", "date", "lignes"],
        properties: {
          type: { type: "string", enum: ["devis", "facture"] }, entiteId: uuid, tiersId: uuid, date, echeance: date,
          notes: { type: "string", maxLength: 2000 }, clientNiu: { type: "string", maxLength: 40 }, lignes: schemaLignes,
          modeRemise: { type: "string", enum: ["aucun", "retrait", "livraison", "expedition"] },
          adresseLivraison: { type: "string", maxLength: 500 }, transporteur: { type: "string", maxLength: 200 },
          fraisLivraison: { type: "integer", minimum: 0, maximum: 1_000_000_000 }, tauxFrais: tauxLibre,
        },
      },
    },
  }, async (req, reponse) => {
    const d = await protege(req, async (ctx) => {
      const b = req.body;
      if (b.echeance && b.echeance < b.date) throw new ErreurApi(400, "dates_invalides");
      await exigerSurEntite(ctx, "facturation.gerer", b.entiteId);
      await exigerModule(ctx, b.entiteId);
      const id = await creerBrouillon(ctx, b.type, b, b.lignes);
      return (await ctx.client.query("select * from documents_vente where id = $1", [id])).rows[0];
    });
    return reponse.status(201).send(d);
  });

  app.put<{ Params: { id: string }; Body: { lignes: LigneSaisie[] } }>("/documents-vente/:id/lignes", {
    schema: { params: paramId, body: { type: "object", required: ["lignes"], properties: { lignes: schemaLignes } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const d = await documentAutorise(ctx, req.params.id, "facturation.gerer", true);
      if (d.statut !== "brouillon") throw new ErreurApi(409, "document_emis");
      return { total_ttc: await ecrireLignes(ctx, req.params.id, req.body.lignes) };
    }),
  );

  app.post<{ Params: { id: string }; Body?: { entrepotId?: string } | null }>("/documents-vente/:id/emission", {
    schema: { params: paramId, body: { type: ["object", "null"], properties: { entrepotId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const d = await documentAutorise(ctx, req.params.id, "facturation.gerer", true);
      if (d.statut !== "brouillon") throw new ErreurApi(409, "document_emis");
      return emettre(ctx, req.params.id, req.body?.entrepotId);
    }),
  );

  /** Seul un brouillon s'abandonne. Une facture émise se corrige par un avoir. */
  app.post<{ Params: { id: string } }>("/documents-vente/:id/abandon", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const d = await documentAutorise(ctx, req.params.id, "facturation.gerer", true);
      if (d.statut !== "brouillon") throw new ErreurApi(409, "document_emis");
      await ctx.client.query("update documents_vente set statut = 'annule' where id = $1", [req.params.id]);
      return { statut: "annule" };
    }),
  );

  app.post<{ Params: { id: string }; Body: { decision: string } }>("/devis/:id/decision", {
    schema: {
      params: paramId,
      body: { type: "object", required: ["decision"], properties: { decision: { type: "string", enum: ["accepte", "refuse", "emis"] } } },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const d = await documentAutorise(ctx, req.params.id, "facturation.gerer", true);
      if (d.type !== "devis" || d.statut === "brouillon" || d.statut === "annule") throw new ErreurApi(409, "operation_impossible");
      await ctx.client.query("update documents_vente set statut = $2 where id = $1", [req.params.id, req.body.decision]);
      return { statut: req.body.decision };
    }),
  );

  const lignesDe = async (c: Client, id: string): Promise<LigneSaisie[]> =>
    (await c.query(
      "select produit_id, designation, quantite::float, prix_unitaire, remise_pct::float, taux::float from lignes_vente where document_id = $1 order by ordre",
      [id],
    )).rows.map((l) => ({
      produitId: l.produit_id ?? undefined, designation: l.designation, quantite: l.quantite,
      prixUnitaire: l.prix_unitaire, remisePct: l.remise_pct, tauxTaxe: l.taux,
    }));

  /** Reprend les lignes du devis dans une facture brouillon, au prix accepté. */
  app.post<{ Params: { id: string }; Body: { date: string; echeance?: string } }>("/devis/:id/facture", {
    schema: { params: paramId, body: { type: "object", required: ["date"], properties: { date, echeance: date } } },
  }, async (req, reponse) => {
    const f = await protege(req, async (ctx) => {
      const d = await documentAutorise(ctx, req.params.id, "facturation.gerer", true);
      if (d.type !== "devis" || d.statut !== "accepte") throw new ErreurApi(409, "devis_non_accepte");
      const deja = await ctx.client.query(
        "select id from documents_vente where origine_id = $1 and type = 'facture' and statut <> 'annule'", [req.params.id],
      );
      if (deja.rows[0]) throw new ErreurApi(409, "deja_facture");
      const id = await creerBrouillon(ctx, "facture", {
        entiteId: d.entite_id, tiersId: d.tiers_id, date: req.body.date, echeance: req.body.echeance,
        notes: d.notes, clientNiu: d.client_niu, modeRemise: d.mode_remise, adresseLivraison: d.adresse_livraison,
        transporteur: d.transporteur, fraisLivraison: d.frais_livraison, tauxFrais: Number(d.taux_frais),
      }, await lignesDe(ctx.client, req.params.id), req.params.id);
      return (await ctx.client.query("select * from documents_vente where id = $1", [id])).rows[0];
    });
    return reponse.status(201).send(f);
  });

  /** L'avoir partiel ou total reste plafonné à ce qui n'a été ni réglé ni déjà annulé par un avoir. */
  app.post<{ Params: { id: string }; Body: { date: string; motif: string; lignes?: LigneSaisie[]; retourStock?: boolean } }>("/factures/:id/avoir", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["date", "motif"],
        properties: { date, motif: { type: "string", minLength: 5, maxLength: 500 }, lignes: schemaLignes, retourStock: { type: "boolean" } },
      },
    },
  }, async (req, reponse) => {
    const a = await protege(req, async (ctx) => {
      const f = await documentAutorise(ctx, req.params.id, "facturation.gerer", true);
      if (f.type !== "facture" || f.statut !== "emis") throw new ErreurApi(409, "facture_non_emise");
      const { rows: perdue } = await ctx.client.query("select 1 from creances_douteuses where facture_id = $1 and statut = 'perte'", [f.id]);
      if (perdue[0]) throw new ErreurApi(409, "facture_passee_en_perte");
      const s = await soldes(ctx.client, req.params.id);
      // Un avoir total reprend aussi les frais de livraison de la facture.
      const lignes: LigneSaisie[] = req.body.lignes ?? [
        ...await lignesDe(ctx.client, req.params.id),
        ...(f.frais_livraison > 0 ? [{ designation: "Frais de livraison", quantite: 1, prixUnitaire: f.frais_livraison, tauxTaxe: Number(f.taux_frais) }] : []),
      ];
      const id = await creerBrouillon(ctx, "avoir", {
        entiteId: f.entite_id, tiersId: f.tiers_id, date: req.body.date, clientNiu: f.client_niu,
      }, lignes, req.params.id, req.body.motif);
      const { rows: [b] } = await ctx.client.query("select total_ttc from documents_vente where id = $1", [id]);
      if (b.total_ttc > s.reste) throw new ErreurApi(409, "avoir_superieur_au_reste", { reste: s.reste });
      const avoir = await emettre(ctx, id);
      if (req.body.retourStock) {
        // La marchandise revient là d'où elle est partie, jamais plus que ce qui a été vendu sur cette facture.
        for (const l of lignes.filter((x) => x.produitId)) {
          const { rows: [v] } = await ctx.client.query(
            `select entite_id, -sum(quantite) filter (where type = 'vente') as vendu,
               coalesce(sum(quantite) filter (where type = 'retour'), 0) as retourne, max(cout_unitaire) as cout
             from mouvements_stock where document_id = $1 and produit_id = $2 group by entite_id`,
            [req.params.id, l.produitId],
          );
          if (!v) continue;
          await produitSuivi(ctx.client, l.produitId!);
          if (l.quantite > Number(v.vendu) - Number(v.retourne) + 0.0005) throw new ErreurApi(409, "retour_superieur_a_la_vente");
          await ctx.client.query(
            `insert into mouvements_stock (organisation_id, entite_id, produit_id, type, quantite, cout_unitaire, motif, document_id, auteur_id)
             values ($1, $2, $3, 'retour', $4, $5, $6, $7, $8)`,
            [ctx.organisationId, v.entite_id, l.produitId, l.quantite, v.cout, req.body.motif, req.params.id, ctx.utilisateurId],
          );
        }
      }
      return avoir;
    });
    return reponse.status(201).send(a);
  });

  app.post<{ Params: { id: string }; Body: { montant: number; moyen: string; reference?: string } }>("/factures/:id/reglements", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["montant", "moyen"],
        properties: {
          montant: { type: "integer", minimum: 1, maximum: 10_000_000_000 },
          moyen: { type: "string", enum: ["especes", "mtn_momo", "orange_money", "virement", "cheque", "carte"] },
          reference: { type: "string", maxLength: 100 },
        },
      },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const f = await documentAutorise(ctx, req.params.id, "facturation.encaisser", true);
      if (f.type !== "facture" || f.statut !== "emis") throw new ErreurApi(409, "facture_non_emise");
      const { rows: perdue } = await ctx.client.query("select 1 from creances_douteuses where facture_id = $1 and statut = 'perte'", [f.id]);
      if (perdue[0]) throw new ErreurApi(409, "facture_passee_en_perte");
      const b = req.body;
      const reference = b.reference?.trim() || null;
      if (b.moyen !== "especes" && !reference) throw new ErreurApi(400, "reference_obligatoire");
      const { reste } = await soldes(ctx.client, req.params.id);
      if (b.montant > reste) throw new ErreurApi(409, "montant_superieur_au_reste", { reste });
      if (reference) {
        const d = await ctx.client.query(
          "select numero_recu from reglements where moyen = $1 and reference = $2 and annule_le is null", [b.moyen, reference],
        );
        if (d.rows[0]) throw new ErreurApi(409, "reference_deja_utilisee", { recu: d.rows[0].numero_recu });
      }
      const numero = await prochainNumero(ctx.client, `REG-${new Date(Date.now() + 3600000).getUTCFullYear()}`);
      const { rows } = await ctx.client.query(
        `insert into reglements (organisation_id, facture_id, numero_recu, montant, moyen, reference, encaisse_par)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [ctx.organisationId, req.params.id, numero, b.montant, b.moyen, reference, ctx.utilisateurId],
      );
      await publierEvenement(ctx.client, "facture.reglement", { id: rows[0].id, factureId: req.params.id, montant: b.montant });
      return { ...rows[0], reste_apres: reste - b.montant, facture: f.numero, client: f.client_nom };
    });
    return reponse.status(201).send(r);
  });

  app.post<{ Params: { id: string }; Body: { motif: string } }>("/reglements/:id/annulation", {
    schema: { params: paramId, body: motifBody },
  }, async (req) =>
    protege(req, async (ctx) => {
      const r = await ctx.client.query("select facture_id, annule_le from reglements where id = $1", [req.params.id]);
      if (!r.rows[0]) throw new ErreurApi(404, "introuvable");
      await documentAutorise(ctx, r.rows[0].facture_id, "facturation.administrer", true);
      if (r.rows[0].annule_le) throw new ErreurApi(409, "deja_annule");
      await ctx.client.query("update reglements set annule_le = now(), motif_annulation = $2 where id = $1", [req.params.id, req.body.motif]);
      return { annule: true };
    }),
  );

  /** Suivi après l'émission : la facture reste figée, seul le suivi avance. */
  app.post<{ Params: { id: string }; Body: { mode: string; transporteur?: string; numeroSuivi?: string; adresse?: string } }>("/factures/:id/expedition", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["mode"],
        properties: {
          mode: { type: "string", enum: ["retrait", "livraison", "expedition"] },
          transporteur: { type: "string", maxLength: 200 }, numeroSuivi: { type: "string", maxLength: 100 },
          adresse: { type: "string", maxLength: 500 },
        },
      },
    },
  }, async (req, reponse) => {
    const e = await protege(req, async (ctx) => {
      const f = await documentAutorise(ctx, req.params.id, "facturation.gerer", true);
      if (f.type !== "facture" || f.statut !== "emis") throw new ErreurApi(409, "facture_non_emise");
      await exigerNonBloque(ctx.client, f.tiers_id, "livraison");
      const b = req.body;
      const { rows } = await ctx.client.query(
        `insert into expeditions (organisation_id, facture_id, mode, transporteur, numero_suivi, adresse)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [ctx.organisationId, req.params.id, b.mode, b.transporteur ?? f.transporteur, b.numeroSuivi ?? null, b.adresse ?? f.adresse_livraison],
      );
      await publierEvenement(ctx.client, "expedition.creee", { id: rows[0].id, factureId: req.params.id });
      return rows[0];
    });
    return reponse.status(201).send(e);
  });

  app.patch<{ Params: { id: string }; Body: { statut?: string; numeroSuivi?: string; transporteur?: string; preuve?: string } }>("/expeditions/:id", {
    schema: {
      params: paramId,
      body: {
        type: "object", minProperties: 1,
        properties: {
          statut: { type: "string", enum: ["preparation", "expediee", "en_transit", "livree", "retournee"] },
          numeroSuivi: { type: "string", maxLength: 100 }, transporteur: { type: "string", maxLength: 200 },
          preuve: { type: "string", maxLength: 500 },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const e = await ctx.client.query("select facture_id from expeditions where id = $1", [req.params.id]);
      if (!e.rows[0]) throw new ErreurApi(404, "introuvable");
      await documentAutorise(ctx, e.rows[0].facture_id, "facturation.gerer");
      const b = req.body;
      const { rows } = await ctx.client.query(
        `update expeditions set statut = coalesce($2, statut), numero_suivi = coalesce($3, numero_suivi),
           transporteur = coalesce($4, transporteur), preuve = coalesce($5, preuve),
           expediee_le = case when $2 in ('expediee', 'en_transit') then coalesce(expediee_le, now()) else expediee_le end,
           livree_le = case when $2 = 'livree' then coalesce(livree_le, now()) when $2 is not null then null else livree_le end
         where id = $1 returning *`,
        [req.params.id, b.statut ?? null, b.numeroSuivi ?? null, b.transporteur ?? null, b.preuve ?? null],
      );
      await publierEvenement(ctx.client, "expedition.modifiee", { id: req.params.id, statut: rows[0].statut });
      return rows[0];
    }),
  );

  const idsVisibles = async (ctx: Contexte) => {
    await exiger(ctx, "facturation.voir");
    return (await entitesAccessibles(ctx.client, ctx.utilisateurId, "facturation.voir")).map((e) => e.id);
  };

  app.get<{ Querystring: { type?: string; brancheId?: string } }>("/documents-vente", {
    schema: { querystring: { type: "object", properties: { type: { type: "string", enum: ["devis", "facture", "avoir"] }, brancheId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows } = await ctx.client.query(
        `select d.id, d.type, d.numero, d.statut, d.date_document, d.date_echeance, d.total_ttc, d.origine_id, t.nom as client,
           case when d.type = 'facture' and d.statut = 'emis' then d.total_ttc
             - (select coalesce(sum(r.montant), 0) from reglements r where r.facture_id = d.id and r.annule_le is null)
             - (select coalesce(sum(a.total_ttc), 0) from documents_vente a where a.origine_id = d.id and a.type = 'avoir' and a.statut = 'emis')
           end::int8 as reste
         from documents_vente d join tiers t on t.id = d.tiers_id
         where d.entite_id = any($1::uuid[]) and ($2::text is null or d.type = $2) and d.statut <> 'annule' and ($3::uuid is null or entite_branche(d.entite_id) = $3)
         order by d.cree_le desc limit 500`,
        [await idsVisibles(ctx), req.query.type ?? null, req.query.brancheId ?? null],
      );
      return rows;
    }),
  );

  app.get<{ Params: { id: string } }>("/documents-vente/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const d = await documentAutorise(ctx, req.params.id, "facturation.voir");
      const lignes = await ctx.client.query(
        `select ordre, produit_id, designation, quantite::float, prix_unitaire, remise_pct::float, taux::float, montant_ht, montant_taxes
         from lignes_vente where document_id = $1 order by ordre`,
        [req.params.id],
      );
      const reglements = await ctx.client.query(
        `select r.id, r.numero_recu, r.montant, r.moyen, r.reference, r.encaisse_le, r.annule_le, r.motif_annulation, u.nom as encaisse_par_nom
         from reglements r join utilisateurs u on u.id = r.encaisse_par where r.facture_id = $1 order by r.encaisse_le desc`,
        [req.params.id],
      );
      const lies = await ctx.client.query(
        "select id, type, numero, statut, total_ttc from documents_vente where origine_id = $1 and statut <> 'annule' order by cree_le",
        [req.params.id],
      );
      const client = await ctx.client.query("select nom, telephone, email from tiers where id = $1", [d.tiers_id]);
      const expedition = await ctx.client.query("select * from expeditions where facture_id = $1", [req.params.id]);
      return {
        ...d, client: client.rows[0], lignes: lignes.rows, reglements: reglements.rows, lies: lies.rows,
        expedition: expedition.rows[0] ?? null,
        soldes: d.type === "facture" && d.statut === "emis" ? await soldes(ctx.client, req.params.id) : null,
      };
    }),
  );

  /** Balance âgée : ce que chaque client doit, selon le retard par rapport à l'échéance. */
  // Factures récurrentes : un brouillon par mois, à contrôler et à émettre.
  app.post<{ Body: { entiteId: string; tiersId: string; libelle: string; jour: number; debut: string; fin?: string; delaiJours?: number; lignes: LigneSaisie[] } }>("/factures-recurrentes", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "tiersId", "libelle", "jour", "debut", "lignes"],
        properties: { entiteId: uuid, tiersId: uuid, libelle: texte(200), jour: { type: "integer", minimum: 1, maximum: 28 }, debut: date, fin: date, delaiJours: { type: "integer", minimum: 0, maximum: 365 }, lignes: schemaLignes },
      },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "facturation.gerer", b.entiteId);
      await exigerModule(ctx, b.entiteId);
      await lierTiers(ctx, b.tiersId, b.entiteId);
      if (b.fin && b.fin < b.debut) throw new ErreurApi(400, "dates_invalides");
      const debut = new Date(`${b.debut}T00:00:00Z`);
      const depasse = debut.getUTCDate() > b.jour;
      debut.setUTCDate(1);
      if (depasse) debut.setUTCMonth(debut.getUTCMonth() + 1);
      debut.setUTCDate(b.jour);
      const { rows } = await ctx.client.query(
        "insert into factures_recurrentes (organisation_id, entite_id, tiers_id, libelle, lignes, jour, prochaine, fin, delai_jours, auteur_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *",
        [ctx.organisationId, b.entiteId, b.tiersId, b.libelle, JSON.stringify(b.lignes), b.jour, debut.toISOString().slice(0, 10), b.fin ?? null, b.delaiJours ?? 0, ctx.utilisateurId],
      );
      return rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/factures-recurrentes", async (req) =>
    protege(req, async (ctx) => (await ctx.client.query(
      "select r.id, r.libelle, r.jour, r.prochaine::text, r.fin::text, r.actif, r.entite_id, t.nom as client from factures_recurrentes r join tiers t on t.id = r.tiers_id where r.entite_id = any($1::uuid[]) order by r.actif desc, r.prochaine limit 500", [await idsVisibles(ctx)],
    )).rows),
  );
  app.post<{ Params: { id: string } }>("/factures-recurrentes/:id/arret", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [r] } = await ctx.client.query("select entite_id from factures_recurrentes where id = $1", [req.params.id]);
      if (!r) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "facturation.gerer", r.entite_id);
      await ctx.client.query("update factures_recurrentes set actif = false where id = $1", [req.params.id]);
      return { actif: false };
    }),
  );
  /** Rattrape au plus douze mois par modèle. La date avance dans la même transaction : relancer ne crée aucun doublon. */
  app.post("/factures-recurrentes/generation", async (req) =>
    protege(req, async (ctx) => {
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "facturation.gerer")).map((e) => e.id);
      const { rows: [{ jour }] } = await ctx.client.query("select (now() at time zone 'Africa/Douala')::date::text as jour");
      const { rows } = await ctx.client.query(
        "select *, prochaine::text as p, fin::text as f from factures_recurrentes where actif and prochaine <= $1 and entite_id = any($2::uuid[]) for update", [jour, ids],
      );
      let crees = 0;
      for (const r of rows) crees += await genererRecurrente(ctx, r, jour);
      return { crees };
    }),
  );
  const genererRecurrente = async (ctx: Contexte, r: Record<string, any>, jour: string) => {
    let p: string = r.p;
    let crees = 0;
    for (let i = 0; i < 12 && p <= jour && (!r.f || p <= r.f); i++) {
      const ech = new Date(`${p}T00:00:00Z`);
      ech.setUTCDate(ech.getUTCDate() + r.delai_jours);
      await creerBrouillon(ctx, "facture", { entiteId: r.entite_id, tiersId: r.tiers_id, date: p, echeance: ech.toISOString().slice(0, 10), notes: r.libelle }, r.lignes);
      crees += 1;
      const n = new Date(`${p}T00:00:00Z`);
      n.setUTCMonth(n.getUTCMonth() + 1);
      p = n.toISOString().slice(0, 10);
    }
    await ctx.client.query("update factures_recurrentes set prochaine = $2, actif = $3 where id = $1", [r.id, p, !r.f || p <= r.f]);
    return crees;
  };
  // Chaque modèle a sa transaction et agit au nom de son auteur : un échec ne bloque pas les autres.
  taches.push(async (org) => {
    const ids = await dansOrganisation(pool, org, async (c) => (await c.query("select id from factures_recurrentes where actif and prochaine <= (now() at time zone 'Africa/Douala')::date")).rows.map((x) => x.id as string));
    for (const id of ids) {
      await dansOrganisation(pool, org, async (c) => {
        const { rows: [r] } = await c.query("select *, prochaine::text as p, fin::text as f, (now() at time zone 'Africa/Douala')::date::text as jour from factures_recurrentes where id = $1 for update", [id]);
        await definirActeur(c, r.auteur_id);
        await genererRecurrente({ client: c, utilisateurId: r.auteur_id, organisationId: org }, r, r.jour);
      }).catch((e) => app.log.error(e, "facture récurrente"));
    }
  });

  app.get<{ Querystring: { brancheId?: string } }>("/creances", { schema: { querystring: { type: "object", properties: { brancheId: uuid } } } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows } = await ctx.client.query(
        `with f as (
           select d.id, d.tiers_id, ${JOURS} - coalesce(d.date_echeance, d.date_document) as retard,
             d.total_ttc
             - (select coalesce(sum(r.montant), 0) from reglements r where r.facture_id = d.id and r.annule_le is null)
             - (select coalesce(sum(a.total_ttc), 0) from documents_vente a where a.origine_id = d.id and a.type = 'avoir' and a.statut = 'emis')
             as reste
           from documents_vente d
           where d.type = 'facture' and d.statut = 'emis' and d.entite_id = any($1::uuid[])
             and not exists (select 1 from creances_douteuses x where x.facture_id = d.id and x.statut = 'perte')
             and ($2::uuid is null or entite_branche(d.entite_id) = $2)
           -- Ventes à crédit de la caisse : même classement par ancienneté que les factures.
           union all
           select v.id, v.tiers_id, ${JOURS} - coalesce(v.echeance, (v.cree_le at time zone 'Africa/Douala')::date),
             reste_credit_comptoir(v.id)
           from ventes_comptoir v
           where v.annulee_le is null and v.reste_du > 0 and v.entite_id = any($1::uuid[])
             and ($2::uuid is null or entite_branche(v.entite_id) = $2)
         )
         select t.id as tiers_id, t.nom as client, t.telephone,
           sum(f.reste)::int8 as total,
           coalesce(sum(f.reste) filter (where f.retard <= 0), 0)::int8 as non_echu,
           coalesce(sum(f.reste) filter (where f.retard between 1 and 30), 0)::int8 as de_1_a_30,
           coalesce(sum(f.reste) filter (where f.retard between 31 and 60), 0)::int8 as de_31_a_60,
           coalesce(sum(f.reste) filter (where f.retard > 60), 0)::int8 as plus_de_60
         from f join tiers t on t.id = f.tiers_id where f.reste > 0
         group by t.id, t.nom, t.telephone order by total desc limit 500`,
        [await idsVisibles(ctx), req.query.brancheId ?? null],
      );
      return rows;
    }),
  );
}
