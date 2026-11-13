import type { FastifyInstance } from "fastify";
import { entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";
import { entrerEnStock, niveau, sortirDuStock } from "./stocks.js";
import { lierTiers } from "./tiers.js";

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max = 300) => ({ type: "string", minLength: 1, maxLength: max }) as const;
const qte = { type: "number", exclusiveMinimum: 0, maximum: 1_000_000_000 } as const;
const montant = { type: "integer", minimum: 0, maximum: 1_000_000_000_000 } as const;

/** Coût de revient : les frais se répartissent selon la valeur de la marchandise. */
export function coutRevient(valeur: number, frais: number, prixAchat: number): number {
  return valeur > 0 ? Math.round(prixAchat * (1 + frais / valeur)) : prixAchat;
}

export function enregistrerLogistique(app: FastifyInstance, outils: Outils): void {
  const { protege, exiger, exigerSurEntite } = outils;
  const visibles = async (ctx: Contexte, p: "stocks.voir" | "achats.voir") => {
    await exiger(ctx, p);
    return (await entitesAccessibles(ctx.client, ctx.utilisateurId, p)).map((e) => e.id);
  };
  const produit = async (ctx: Contexte, id: string, verrou = false) => {
    const { rows: [p] } = await ctx.client.query(`select * from produits where id = $1 ${verrou ? "for update" : ""}`, [id]);
    if (!p) throw new ErreurApi(404, "introuvable");
    return p;
  };

  /** Un produit suivi en stock et rattaché à ce lieu, à ses parents ou à sa branche. Celui d'une autre branche n'existe pas ici. */
  const produitDuLieu = async (ctx: Contexte, id: string, entiteId: string) => {
    const { rows: [p] } = await ctx.client.query(
      `with recursive lignee as (select id, parent_id from entites where id = $2 union all select e.id, e.parent_id from entites e join lignee l on e.id = l.parent_id)
       select suivi_stock from produits where id = $1 and (entite_id in (select id from lignee) or entite_branche(entite_id) = entite_branche($2))`, [id, entiteId],
    );
    if (!p) throw new ErreurApi(404, "introuvable");
    if (!p.suivi_stock) throw new ErreurApi(409, "produit_sans_stock");
  };

  // Prix négociés par client
  app.put<{ Params: { id: string }; Body: { produitId: string; prix: number | null } }>("/tiers/:id/prix", {
    schema: { params: paramId, body: { type: "object", required: ["produitId", "prix"], properties: { produitId: uuid, prix: { type: ["integer", "null"], minimum: 0 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const p = await produit(ctx, req.body.produitId);
      await exigerSurEntite(ctx, "catalogue.gerer", p.entite_id);
      await lierTiers(ctx, req.params.id, p.entite_id);
      if (req.body.prix === null) { await ctx.client.query("delete from prix_clients where tiers_id = $1 and produit_id = $2", [req.params.id, p.id]); return { retire: true }; }
      if (req.body.prix < p.cout_moyen) throw new ErreurApi(409, "palier_sous_le_cout", { cout: p.cout_moyen, prix: req.body.prix });
      await ctx.client.query("insert into prix_clients (organisation_id, tiers_id, produit_id, prix, auteur_id) values ($1, $2, $3, $4, $5) on conflict (organisation_id, tiers_id, produit_id) do update set prix = excluded.prix, auteur_id = excluded.auteur_id, cree_le = now()", [ctx.organisationId, req.params.id, p.id, req.body.prix, ctx.utilisateurId]);
      return { enregistre: true };
    }),
  );

  // Vente en gros : minimum, multiple, conditionnements
  app.put<{ Params: { id: string }; Body: { quantiteMin: number; multiple: number; conditionnements: { nom: string; facteur: number }[] } }>("/produits/:id/gros", {
    schema: { params: paramId, body: { type: "object", required: ["quantiteMin", "multiple", "conditionnements"], properties: { quantiteMin: { type: "number", minimum: 0 }, multiple: { type: "number", minimum: 0 }, conditionnements: { type: "array", maxItems: 10, items: { type: "object", required: ["nom", "facteur"], additionalProperties: false, properties: { nom: texte(50), facteur: qte } } } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const p = await produit(ctx, req.params.id);
      await exigerSurEntite(ctx, "catalogue.gerer", p.entite_id);
      // Le prix de vente d'un conditionnement (module Stocks) est conservé quand on ne change que le minimum ou le multiple.
      const { rows: [avant] } = await ctx.client.query("select conditionnements from produits where id = $1", [p.id]);
      const prix = new Map((avant.conditionnements as { nom: string; prix?: number }[] ?? []).map((c) => [c.nom.trim().toLowerCase(), c.prix]));
      const cond = req.body.conditionnements.map((c) => { const x = prix.get(c.nom.trim().toLowerCase()); return x === undefined ? c : { ...c, prix: x }; });
      await ctx.client.query("update produits set quantite_min = $2, multiple = $3, conditionnements = $4 where id = $1", [p.id, req.body.quantiteMin, req.body.multiple, JSON.stringify(cond)]);
      return { enregistre: true };
    }),
  );

  // Import du catalogue : tout ou rien, avec le détail des lignes refusées.
  // Avec un dépôt, la colonne « quantité » fixe le stock compté de ce lieu (comme un inventaire) : relancer le même fichier ne double rien.
  type LigneImport = { code: string; nom: string; prixVente: number; codeBarres?: string; unite?: string; categorie?: string; sousCategorie?: string; marque?: string; typeColis?: string; piecesParUnite?: number; quantite?: number; coutUnitaire?: number };
  app.post<{ Body: { entiteId: string; depotId?: string; lignes: LigneImport[] } }>("/produits/import", {
    bodyLimit: 10 * 1024 ** 2,
    schema: {
      body: {
        type: "object", required: ["entiteId", "lignes"],
        properties: {
          entiteId: uuid, depotId: uuid,
          lignes: {
            type: "array", minItems: 1, maxItems: 20000,
            items: {
              type: "object", required: ["code", "nom", "prixVente"],
              properties: {
                code: texte(60), nom: texte(200), prixVente: { type: "integer", minimum: 0 }, codeBarres: texte(60), unite: texte(30),
                categorie: texte(100), sousCategorie: texte(100), marque: texte(100), typeColis: texte(40), piecesParUnite: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000 },
                quantite: { type: "number", minimum: 0, maximum: 1_000_000_000 }, coutUnitaire: { type: "integer", minimum: 0, maximum: 1_000_000_000 },
              },
            },
          },
        },
      },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "catalogue.gerer", b.entiteId);
      const vus = new Set<string>();
      const erreurs: { ligne: number; code: string; motif: string }[] = [];
      b.lignes.forEach((l, i) => {
        if (vus.has(l.code)) erreurs.push({ ligne: i + 1, code: l.code, motif: "Code en double dans le fichier" });
        if (l.sousCategorie && !l.categorie) erreurs.push({ ligne: i + 1, code: l.code, motif: "Sous-catégorie sans catégorie" });
        if (l.quantite !== undefined && !b.depotId) erreurs.push({ ligne: i + 1, code: l.code, motif: "Quantité sans entrepôt choisi" });
        vus.add(l.code);
      });
      if (erreurs.length) throw new ErreurApi(400, "import_invalide", { erreurs: erreurs.slice(0, 100) });
      const { rows: [br] } = await ctx.client.query("select coalesce(entite_branche($1), $1) as b, coalesce(entite_branche($2), $2) as d", [b.entiteId, b.depotId ?? b.entiteId]);
      const avecStock = b.lignes.some((l) => l.quantite !== undefined);
      if (avecStock) {
        // Fixer un stock compté revient à valider un inventaire : même droit, même branche, module de stock actif.
        await exigerSurEntite(ctx, "stocks.valider", b.depotId!);
        if (br.b !== br.d) throw new ErreurApi(409, "transfert_autre_branche");
        const { rows: [m] } = await ctx.client.query("select actif from modules_entite where entite_id = $1 and module = 'achats_stocks'", [b.depotId]);
        if (!m?.actif) throw new ErreurApi(409, "module_inactif");
      }
      const categories = new Map<string, string>();
      const categorie = async (nom: string, parent: string | null) => {
        const cle = `${parent ?? ""}|${nom.toLowerCase()}`;
        if (categories.has(cle)) return categories.get(cle)!;
        const { rows: [x] } = await ctx.client.query("select id from categories_articles where branche_id = $1 and parent_id is not distinct from $2 and lower(nom) = lower($3)", [br.b, parent, nom]);
        const id = x?.id ?? (await ctx.client.query("insert into categories_articles (organisation_id, branche_id, parent_id, nom) values ($1, $2, $3, $4) returning id", [ctx.organisationId, br.b, parent, nom])).rows[0].id;
        categories.set(cle, id);
        return id as string;
      };
      let crees = 0, maj = 0, stocks = 0;
      for (const l of b.lignes) {
        const racine = l.categorie ? await categorie(l.categorie.trim(), null) : null;
        const cat = racine && l.sousCategorie ? await categorie(l.sousCategorie.trim(), racine) : racine;
        let marque: string | null = null;
        if (l.marque?.trim()) {
          const { rows: [m] } = await ctx.client.query("select id from marques where branche_id = $1 and lower(nom) = lower($2)", [br.b, l.marque.trim()]);
          marque = m?.id ?? (await ctx.client.query("insert into marques (organisation_id, branche_id, nom) values ($1, $2, $3) returning id", [ctx.organisationId, br.b, l.marque.trim()])).rows[0].id;
        }
        const { rows: [x] } = await ctx.client.query("select id from produits where code = $1 and entite_id = $2", [l.code, b.entiteId]);
        let id: string;
        if (x) {
          id = x.id;
          await ctx.client.query(
            `update produits set nom = $2, prix_vente = $3, code_barres = coalesce($4, code_barres), unite = coalesce($5, unite), categorie_id = coalesce($6, categorie_id),
               type_colis = coalesce($7, type_colis), pieces_par_unite = coalesce($8, pieces_par_unite), marque_id = coalesce($9, marque_id) where id = $1`,
            [id, l.nom, l.prixVente, l.codeBarres ?? null, l.unite ?? null, cat, l.typeColis ?? null, l.piecesParUnite ?? null, marque],
          );
          maj += 1;
        } else {
          id = (await ctx.client.query(
            `insert into produits (organisation_id, code, nom, prix_vente, entite_id, code_barres, unite, categorie_id, type_colis, pieces_par_unite, marque_id)
             values ($1, $2, $3, $4, $5, $6, coalesce($7, 'pièce'), $8, $9, coalesce($10, 1), $11) returning id`,
            [ctx.organisationId, l.code, l.nom, l.prixVente, b.entiteId, l.codeBarres ?? null, l.unite ?? null, cat, l.typeColis ?? null, l.piecesParUnite ?? null, marque],
          )).rows[0].id;
          crees += 1;
        }
        if (l.quantite !== undefined) {
          const { rows: [p] } = await ctx.client.query("update produits set suivi_stock = true where id = $1 and type = 'produit' returning cout_moyen", [id]);
          if (!p) throw new ErreurApi(400, "import_invalide", { erreurs: [{ ligne: b.lignes.indexOf(l) + 1, code: l.code, motif: "Seul un produit peut avoir un stock" }] });
          await ctx.client.query("select 1 from produits where id = $1 for update", [id]);
          const { rows: [n] } = await ctx.client.query("select coalesce(sum(quantite), 0)::float as q from mouvements_stock where entite_id = $1 and produit_id = $2", [b.depotId, id]);
          const ecart = Math.round((l.quantite - n.q) * 1000) / 1000;
          if (ecart > 0) await entrerEnStock(ctx, b.depotId!, id, ecart, l.coutUnitaire ?? Number(p.cout_moyen), "ajustement", "Import du stock compté", null);
          else if (ecart < 0) await sortirDuStock(ctx, b.depotId!, id, -ecart, "ajustement", "Import du stock compté", null);
          if (ecart !== 0) stocks += 1;
        }
      }
      return { crees, maj, stocks };
    });
    return reponse.status(201).send(r);
  });

  // Inventaires : le compte saisi, puis une validation qui crée les écarts.
  app.post<{ Body: { entiteId: string; libelle: string } }>("/inventaires", {
    schema: { body: { type: "object", required: ["entiteId", "libelle"], properties: { entiteId: uuid, libelle: texte() } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "stocks.gerer", req.body.entiteId);
      return (await ctx.client.query("insert into inventaires (organisation_id, entite_id, libelle, cree_par) values ($1, $2, $3, $4) returning id", [ctx.organisationId, req.body.entiteId, req.body.libelle, ctx.utilisateurId])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/inventaires", async (req) =>
    protege(req, async (ctx) => {
      const ids = await visibles(ctx, "stocks.voir");
      return (await ctx.client.query("select i.id, i.libelle, i.statut, i.cree_le, e.nom as entite, (select count(*)::int from lignes_inventaire l where l.inventaire_id = i.id) as lignes from inventaires i join entites e on e.id = i.entite_id where i.entite_id = any($1::uuid[]) order by i.cree_le desc limit 100", [ids])).rows;
    }),
  );
  const inventaire = async (ctx: Contexte, id: string, p: "stocks.voir" | "stocks.gerer" | "stocks.valider") => {
    const { rows: [i] } = await ctx.client.query("select * from inventaires where id = $1 for update", [id]);
    if (!i) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, p, i.entite_id);
    return i;
  };
  app.get<{ Params: { id: string } }>("/inventaires/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const i = await inventaire(ctx, req.params.id, "stocks.voir");
      const { rows } = await ctx.client.query("select l.produit_id, p.code, p.nom, l.compte::float, l.theorique::float, l.note from lignes_inventaire l join produits p on p.id = l.produit_id where l.inventaire_id = $1 order by p.nom", [i.id]);
      const lignes = [];
      for (const l of rows) { const t = l.theorique ?? await niveau(ctx.client, i.entite_id, l.produit_id); lignes.push({ ...l, theorique: t, ecart: l.compte - t }); }
      return { ...i, lignes };
    }),
  );
  app.put<{ Params: { id: string }; Body: { produitId: string; compte: number; note?: string } }>("/inventaires/:id/lignes", {
    schema: { params: paramId, body: { type: "object", required: ["produitId", "compte"], properties: { produitId: uuid, compte: { type: "number", minimum: 0 }, note: texte(300) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const i = await inventaire(ctx, req.params.id, "stocks.gerer");
      if (i.statut !== "ouvert") throw new ErreurApi(409, "inventaire_valide");
      await produitDuLieu(ctx, req.body.produitId, i.entite_id);
      await ctx.client.query("insert into lignes_inventaire (organisation_id, inventaire_id, produit_id, compte, note) values ($1, $2, $3, $4, $5) on conflict (organisation_id, inventaire_id, produit_id) do update set compte = excluded.compte, note = excluded.note", [ctx.organisationId, i.id, req.body.produitId, req.body.compte, req.body.note ?? null]);
      return { enregistre: true };
    }),
  );
  /** Un écart ne se valide que par une autre personne que celle qui a ouvert l'inventaire. */
  app.post<{ Params: { id: string } }>("/inventaires/:id/validation", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const i = await inventaire(ctx, req.params.id, "stocks.valider");
      if (i.statut !== "ouvert") throw new ErreurApi(409, "inventaire_valide");
      if (i.cree_par === ctx.utilisateurId) throw new ErreurApi(409, "separation_des_taches");
      const { rows } = await ctx.client.query("select produit_id, compte::float from lignes_inventaire where inventaire_id = $1", [i.id]);
      let ecarts = 0;
      for (const l of rows) {
        const p = await produit(ctx, l.produit_id, true);
        const t = await niveau(ctx.client, i.entite_id, l.produit_id);
        const e = Math.round((l.compte - t) * 1000) / 1000;
        await ctx.client.query("update lignes_inventaire set theorique = $3 where inventaire_id = $1 and produit_id = $2", [i.id, l.produit_id, t]);
        if (e > 0) await entrerEnStock(ctx, i.entite_id, l.produit_id, e, p.cout_moyen, "ajustement", `Inventaire : ${i.libelle}`, i.id);
        if (e < 0) await sortirDuStock(ctx, i.entite_id, l.produit_id, -e, "ajustement", `Inventaire : ${i.libelle}`, null, i.id);
        if (e) ecarts += 1;
      }
      await ctx.client.query("update inventaires set statut = 'valide', valide_par = $2, valide_le = now() where id = $1", [i.id, ctx.utilisateurId]);
      return { ecarts };
    }),
  );

  // Réservations de stock
  app.post<{ Body: { entiteId: string; produitId: string; quantite: number; tiersId?: string; motif?: string; expireLe?: string } }>("/reservations-stock", {
    schema: { body: { type: "object", required: ["entiteId", "produitId", "quantite"], properties: { entiteId: uuid, produitId: uuid, quantite: qte, tiersId: uuid, motif: texte(), expireLe: date } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "stocks.gerer", b.entiteId);
      await produitDuLieu(ctx, b.produitId, b.entiteId);
      if (b.tiersId) await lierTiers(ctx, b.tiersId, b.entiteId);
      await produit(ctx, b.produitId, true);
      const stock = await niveau(ctx.client, b.entiteId, b.produitId);
      const { rows: [{ q }] } = await ctx.client.query("select coalesce(sum(quantite), 0)::float as q from reservations_stock where entite_id = $1 and produit_id = $2 and levee_le is null and (expire_le is null or expire_le >= (now() at time zone 'Africa/Douala')::date)", [b.entiteId, b.produitId]);
      if (b.quantite > stock - q) throw new ErreurApi(409, "stock_insuffisant", { produitId: b.produitId, disponible: stock - q });
      return (await ctx.client.query("insert into reservations_stock (organisation_id, entite_id, produit_id, quantite, tiers_id, motif, expire_le, auteur_id) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id", [ctx.organisationId, b.entiteId, b.produitId, b.quantite, b.tiersId ?? null, b.motif ?? null, b.expireLe ?? null, ctx.utilisateurId])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/reservations-stock", async (req) =>
    protege(req, async (ctx) => {
      const ids = await visibles(ctx, "stocks.voir");
      return (await ctx.client.query("select r.id, r.quantite::float, r.motif, r.expire_le::text, p.nom as produit, e.nom as entite, t.nom as client from reservations_stock r join produits p on p.id = r.produit_id join entites e on e.id = r.entite_id left join tiers t on t.id = r.tiers_id where r.entite_id = any($1::uuid[]) and r.levee_le is null order by r.cree_le desc limit 300", [ids])).rows;
    }),
  );
  app.post<{ Params: { id: string } }>("/reservations-stock/:id/levee", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [r] } = await ctx.client.query("select entite_id from reservations_stock where id = $1", [req.params.id]);
      if (!r) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "stocks.gerer", r.entite_id);
      await ctx.client.query("update reservations_stock set levee_le = now() where id = $1", [req.params.id]);
      return { levee: true };
    }),
  );

  // Numéros de série : retrouver la vente et la garantie d'un appareil.
  app.post<{ Params: { id: string }; Body: { numeros: string[] } }>("/produits/:id/series", {
    schema: { params: paramId, body: { type: "object", required: ["numeros"], properties: { numeros: { type: "array", minItems: 1, maxItems: 5000, items: texte(100) } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const p = await produit(ctx, req.params.id);
      await exigerSurEntite(ctx, "stocks.gerer", p.entite_id);
      let crees = 0;
      for (const n of req.body.numeros) crees += (await ctx.client.query("insert into numeros_serie (organisation_id, produit_id, numero) values ($1, $2, $3) on conflict do nothing", [ctx.organisationId, p.id, n.trim()])).rowCount ?? 0;
      return { crees, doublons: req.body.numeros.length - crees };
    });
    return reponse.status(201).send(r);
  });
  app.get<{ Querystring: { numero: string } }>("/series", { schema: { querystring: { type: "object", required: ["numero"], properties: { numero: texte(100) } } } }, async (req) =>
    protege(req, async (ctx) => {
      const ids = await visibles(ctx, "stocks.voir");
      return (await ctx.client.query("select s.id, s.numero, s.statut, s.garantie_fin::text, p.nom as produit, t.nom as client from numeros_serie s join produits p on p.id = s.produit_id left join tiers t on t.id = s.tiers_id where s.numero = $1 and p.entite_id = any($2::uuid[]) limit 20", [req.query.numero.trim(), ids])).rows;
    }),
  );
  app.post<{ Params: { id: string }; Body: { tiersId: string } }>("/series/:id/vente", {
    schema: { params: paramId, body: { type: "object", required: ["tiersId"], properties: { tiersId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [s] } = await ctx.client.query("select s.*, p.entite_id, p.garantie_mois from numeros_serie s join produits p on p.id = s.produit_id where s.id = $1 for update of s", [req.params.id]);
      if (!s) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "stocks.gerer", s.entite_id);
      if (s.statut !== "en_stock") throw new ErreurApi(409, "serie_deja_vendue");
      await lierTiers(ctx, req.body.tiersId, s.entite_id);
      await ctx.client.query("update numeros_serie set statut = 'vendu', tiers_id = $2, garantie_fin = case when $3::int > 0 then ((now() at time zone 'Africa/Douala')::date + make_interval(months => $3::int))::date end where id = $1", [s.id, req.body.tiersId, s.garantie_mois ?? 0]);
      return { vendu: true };
    }),
  );

  // Demandes de prix et comparaison d'offres
  app.post<{ Body: { entiteId: string; objet: string } }>("/demandes-prix", {
    schema: { body: { type: "object", required: ["entiteId", "objet"], properties: { entiteId: uuid, objet: texte(1000) } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "achats.gerer", req.body.entiteId);
      return (await ctx.client.query("insert into demandes_prix (organisation_id, entite_id, objet, cree_par) values ($1, $2, $3, $4) returning id", [ctx.organisationId, req.body.entiteId, req.body.objet, ctx.utilisateurId])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/demandes-prix", async (req) =>
    protege(req, async (ctx) => {
      const ids = await visibles(ctx, "achats.voir");
      return (await ctx.client.query(
        `select d.id, d.objet, d.statut, d.offre_retenue, d.motif, d.entite_id, e.nom as entite, coalesce(json_agg(json_build_object('id', o.id, 'fournisseur', t.nom, 'montant', o.montant, 'delai', o.delai_jours, 'note', o.note) order by o.montant) filter (where o.id is not null), '[]') as offres
         from demandes_prix d join entites e on e.id = d.entite_id left join offres_fournisseur o on o.demande_id = d.id left join tiers t on t.id = o.fournisseur_id where d.entite_id = any($1::uuid[]) group by d.id, e.nom order by d.cree_le desc limit 100`, [ids],
      )).rows;
    }),
  );
  const demande = async (ctx: Contexte, id: string) => {
    const { rows: [d] } = await ctx.client.query("select * from demandes_prix where id = $1 for update", [id]);
    if (!d) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, "achats.gerer", d.entite_id);
    if (d.statut !== "ouverte") throw new ErreurApi(409, "demande_close");
    return d;
  };
  app.post<{ Params: { id: string }; Body: { fournisseurId: string; montant: number; delaiJours?: number; note?: string } }>("/demandes-prix/:id/offres", {
    schema: { params: paramId, body: { type: "object", required: ["fournisseurId", "montant"], properties: { fournisseurId: uuid, montant, delaiJours: { type: "integer", minimum: 0 }, note: texte(500) } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const d = await demande(ctx, req.params.id);
      await lierTiers(ctx, req.body.fournisseurId, d.entite_id);
      return (await ctx.client.query("insert into offres_fournisseur (organisation_id, demande_id, fournisseur_id, montant, delai_jours, note) values ($1, $2, $3, $4, $5, $6) on conflict (organisation_id, demande_id, fournisseur_id) do update set montant = excluded.montant, delai_jours = excluded.delai_jours, note = excluded.note returning id", [ctx.organisationId, d.id, req.body.fournisseurId, req.body.montant, req.body.delaiJours ?? null, req.body.note ?? null])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  /** Retenir une autre offre que la moins chère demande un motif. */
  app.post<{ Params: { id: string }; Body: { offreId: string; motif?: string } }>("/demandes-prix/:id/attribution", {
    schema: { params: paramId, body: { type: "object", required: ["offreId"], properties: { offreId: uuid, motif: { type: "string", minLength: 5, maxLength: 500 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const d = await demande(ctx, req.params.id);
      const { rows } = await ctx.client.query("select id, montant from offres_fournisseur where demande_id = $1 order by montant", [d.id]);
      const o = rows.find((x) => x.id === req.body.offreId);
      if (!o) throw new ErreurApi(404, "introuvable");
      if (Number(o.montant) > Number(rows[0].montant) && !req.body.motif) throw new ErreurApi(409, "motif_obligatoire");
      await ctx.client.query("update demandes_prix set statut = 'attribuee', offre_retenue = $2, motif = $3 where id = $1", [d.id, o.id, req.body.motif ?? null]);
      return { attribuee: true };
    }),
  );

  // Retours au fournisseur
  app.post<{ Body: { entiteId: string; fournisseurId: string; produitId: string; quantite: number; motif: string } }>("/retours-fournisseur", {
    schema: { body: { type: "object", required: ["entiteId", "fournisseurId", "produitId", "quantite", "motif"], properties: { entiteId: uuid, fournisseurId: uuid, produitId: uuid, quantite: qte, motif: { type: "string", minLength: 5, maxLength: 500 } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "stocks.gerer", b.entiteId);
      await lierTiers(ctx, b.fournisseurId, b.entiteId);
      await produit(ctx, b.produitId, true);
      const { rows: [x] } = await ctx.client.query("insert into retours_fournisseur (organisation_id, entite_id, fournisseur_id, produit_id, quantite, motif, auteur_id) values ($1, $2, $3, $4, $5, $6, $7) returning id", [ctx.organisationId, b.entiteId, b.fournisseurId, b.produitId, b.quantite, b.motif, ctx.utilisateurId]);
      await sortirDuStock(ctx, b.entiteId, b.produitId, b.quantite, "sortie", `Retour fournisseur : ${b.motif}`.slice(0, 300), null, x.id);
      return x;
    });
    return reponse.status(201).send(r);
  });

  // Dossiers d'importation
  app.post<{ Body: { entiteId: string; reference: string; conteneur?: string; valeurMarchandise: number; commandeId?: string } }>("/dossiers-import", {
    schema: { body: { type: "object", required: ["entiteId", "reference", "valeurMarchandise"], properties: { entiteId: uuid, reference: texte(100), conteneur: texte(50), valeurMarchandise: montant, commandeId: uuid } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "achats.gerer", b.entiteId);
      return (await ctx.client.query("insert into dossiers_import (organisation_id, entite_id, reference, conteneur, valeur_marchandise, commande_id) values ($1, $2, $3, $4, $5, $6) returning id", [ctx.organisationId, b.entiteId, b.reference, b.conteneur ?? null, b.valeurMarchandise, b.commandeId ?? null])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/dossiers-import", async (req) =>
    protege(req, async (ctx) => {
      const ids = await visibles(ctx, "achats.voir");
      const { rows } = await ctx.client.query(
        `select d.id, d.reference, d.conteneur, d.statut, d.valeur_marchandise::int8 as valeur, e.nom as entite, coalesce(sum(f.montant), 0)::int8 as frais, coalesce(json_agg(json_build_object('nature', f.nature, 'montant', f.montant)) filter (where f.id is not null), '[]') as detail
         from dossiers_import d join entites e on e.id = d.entite_id left join frais_import f on f.dossier_id = d.id where d.entite_id = any($1::uuid[]) group by d.id, e.nom order by d.cree_le desc limit 100`, [ids],
      );
      return rows.map((d) => ({ ...d, valeur: Number(d.valeur), frais: Number(d.frais), coefficient: Number(d.valeur) ? Math.round((1 + Number(d.frais) / Number(d.valeur)) * 1000) / 1000 : null }));
    }),
  );
  const dossier = async (ctx: Contexte, id: string) => {
    const { rows: [d] } = await ctx.client.query("select entite_id from dossiers_import where id = $1", [id]);
    if (!d) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, "achats.gerer", d.entite_id);
  };
  app.post<{ Params: { id: string }; Body: { nature: string; montant: number; libelle?: string } }>("/dossiers-import/:id/frais", {
    schema: { params: paramId, body: { type: "object", required: ["nature", "montant"], properties: { nature: { type: "string", enum: ["fret", "transit", "douane", "port", "assurance", "autre"] }, montant: { type: "integer", minimum: 1 }, libelle: texte() } } },
  }, async (req, reponse) => {
    await protege(req, async (ctx) => { await dossier(ctx, req.params.id); await ctx.client.query("insert into frais_import (organisation_id, dossier_id, nature, montant, libelle) values ($1, $2, $3, $4, $5)", [ctx.organisationId, req.params.id, req.body.nature, req.body.montant, req.body.libelle ?? null]); });
    return reponse.status(201).send({ enregistre: true });
  });
  app.patch<{ Params: { id: string }; Body: { statut: string } }>("/dossiers-import/:id", {
    schema: { params: paramId, body: { type: "object", required: ["statut"], properties: { statut: { type: "string", enum: ["commande", "en_mer", "au_port", "dedouane", "recu"] } } } },
  }, async (req) =>
    protege(req, async (ctx) => { await dossier(ctx, req.params.id); await ctx.client.query("update dossiers_import set statut = $2 where id = $1", [req.params.id, req.body.statut]); return { enregistre: true }; }),
  );
}
