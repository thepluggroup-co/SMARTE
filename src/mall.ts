import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import pg from "pg";
import { dansOrganisation, type Client } from "./base.js";
import { controleCredit, prixPourQuantite, prixProduit, prixPromo } from "./commerce.js";
import { entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";
import { entrerEnStock, sortirDuStock } from "./stocks.js";
import { lierTiers } from "./tiers.js";

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max = 300) => ({ type: "string", minLength: 1, maxLength: max }) as const;
const entier = { type: "integer", minimum: 0, maximum: 1_000_000_000_000 } as const;
const periode = { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" } as const;
const CODE = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{22}$/;
const JOUR = "(now() at time zone 'Africa/Douala')::date";

/** Le mois facturé doit tomber dans la durée du bail. */
export function moisDansBail(p: string, debut: string, fin: string): boolean {
  return p >= debut.slice(0, 7) && p <= fin.slice(0, 7);
}

export function enregistrerMall(app: FastifyInstance, pool: pg.Pool, outils: Outils, urlPublique: string): void {
  const { protege, exiger, exigerSurEntite } = outils;
  const ids = async (ctx: Contexte, p: "mall.voir" | "transport.voir" | "stocks.voir") => (await entitesAccessibles(ctx.client, ctx.utilisateurId, p)).map((e) => e.id);
  /** Réutilise la facturation : même numérotation, mêmes contrôles, mêmes écritures. Et mêmes droits que l'appelant. */
  const appel = async (req: FastifyRequest, methode: "POST", url: string, corps: object) => {
    const r = await app.inject({ method: methode, url, headers: { authorization: String(req.headers.authorization) }, payload: corps as Record<string, unknown> });
    const d = r.json();
    if (r.statusCode >= 300) throw new ErreurApi(r.statusCode, d.erreur ?? "operation_impossible", d.details);
    return d;
  };

  // Mall
  app.post<{ Body: { entiteId: string; code: string; nom: string; type: string; surface?: number } }>("/locaux", {
    schema: { body: { type: "object", required: ["entiteId", "code", "nom", "type"], properties: { entiteId: uuid, code: texte(30), nom: texte(200), type: { type: "string", enum: ["boutique", "espace", "bureau", "parking", "autre"] }, surface: { type: "number", minimum: 0 } } } },
  }, async (req, reponse) => {
    const l = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "mall.gerer", b.entiteId);
      return (await ctx.client.query("insert into locaux (organisation_id, entite_id, code, nom, type, surface) values ($1, $2, $3, $4, $5, $6) returning *", [ctx.organisationId, b.entiteId, b.code, b.nom, b.type, b.surface ?? null])).rows[0];
    });
    return reponse.status(201).send(l);
  });
  app.get("/locaux", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "mall.voir");
      const { rows } = await ctx.client.query(
        `select l.*, x.bail_id, x.locataire, x.fin, x.loyer, x.charges, x.impayes from locaux l left join lateral (
           select b.id as bail_id, t.nom as locataire, b.fin, b.loyer, b.charges,
             (select coalesce(sum(d.total_ttc - (select coalesce(sum(r.montant), 0) from reglements r where r.facture_id = d.id and r.annule_le is null)
               - (select coalesce(sum(a.total_ttc), 0) from documents_vente a where a.origine_id = d.id and a.type = 'avoir' and a.statut = 'emis')), 0)
              from appels_loyer ap join documents_vente d on d.id = ap.document_id where ap.bail_id = b.id)::int8 as impayes
           from baux b join tiers t on t.id = b.tiers_id where b.local_id = l.id and b.resilie_le is null and ${JOUR} between b.debut and b.fin limit 1) x on true
         where l.entite_id = any($1::uuid[]) order by l.code limit 2000`,
        [await ids(ctx, "mall.voir")],
      );
      const actifs = rows.filter((l) => l.actif);
      return { locaux: rows, occupation: actifs.length ? Math.round((actifs.filter((l) => l.bail_id).length * 100) / actifs.length) : null };
    }),
  );
  /** Un local n'a jamais deux baux sur la même période. */
  app.post<{ Body: { localId: string; tiersId: string; debut: string; fin: string; loyer: number; charges?: number; tauxTaxe?: number; depot?: number } }>("/baux", {
    schema: { body: { type: "object", required: ["localId", "tiersId", "debut", "fin", "loyer"], properties: { localId: uuid, tiersId: uuid, debut: date, fin: date, loyer: { ...entier, minimum: 1 }, charges: entier, tauxTaxe: { type: "number", minimum: 0, maximum: 100 }, depot: entier } } },
  }, async (req, reponse) => {
    const x = await protege(req, async (ctx) => {
      const b = req.body;
      const { rows: [l] } = await ctx.client.query("select entite_id from locaux where id = $1 for update", [b.localId]);
      if (!l) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "mall.gerer", l.entite_id);
      await lierTiers(ctx, b.tiersId, l.entite_id);
      if (b.fin <= b.debut) throw new ErreurApi(400, "dates_invalides");
      const { rows: [c] } = await ctx.client.query("select 1 as x from baux where local_id = $1 and debut <= $3 and (case when resilie_le is null then fin >= $2 else resilie_le::date > $2 end) limit 1", [b.localId, b.debut, b.fin]);
      if (c) throw new ErreurApi(409, "local_deja_loue");
      return (await ctx.client.query(
        "insert into baux (organisation_id, local_id, tiers_id, debut, fin, loyer, charges, taux_taxe, depot, cree_par) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *",
        [ctx.organisationId, b.localId, b.tiersId, b.debut, b.fin, b.loyer, b.charges ?? 0, b.tauxTaxe ?? 0, b.depot ?? 0, ctx.utilisateurId],
      )).rows[0];
    });
    return reponse.status(201).send(x);
  });
  const lireBail = async (ctx: Contexte, id: string) => {
    const { rows: [b] } = await ctx.client.query("select b.*, l.entite_id, l.nom as local from baux b join locaux l on l.id = b.local_id where b.id = $1", [id]);
    if (!b) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, "mall.gerer", b.entite_id);
    return b;
  };
  app.post<{ Params: { id: string }; Body: { date: string } }>("/baux/:id/resiliation", {
    schema: { params: paramId, body: { type: "object", required: ["date"], properties: { date } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const b = await lireBail(ctx, req.params.id);
      if (b.resilie_le) throw new ErreurApi(409, "deja_annule");
      await ctx.client.query("update baux set resilie_le = $2, fin = least(fin, $2) where id = $1", [b.id, req.body.date]);
      return { resilie: true };
    }),
  );
  /** Le loyer devient une vraie facture : encaissement, trésorerie et comptabilité suivent comme pour toute vente. */
  app.post<{ Params: { id: string }; Body: { periode: string } }>("/baux/:id/facturation", {
    schema: { params: paramId, body: { type: "object", required: ["periode"], properties: { periode } } },
  }, async (req, reponse) => {
    const { periode: p } = req.body;
    const b = await protege(req, async (ctx) => {
      const x = await lireBail(ctx, req.params.id);
      if (!moisDansBail(p, x.debut, x.resilie_le ?? x.fin)) throw new ErreurApi(409, "hors_bail");
      await ctx.client.query("insert into appels_loyer (organisation_id, bail_id, periode) values ($1, $2, $3)", [ctx.organisationId, x.id, p]);
      return x;
    });
    try {
      const taux = Number(b.taux_taxe);
      const d = await appel(req, "POST", "/documents-vente", {
        type: "facture", entiteId: b.entite_id, tiersId: b.tiers_id, date: `${p}-01`,
        lignes: [{ designation: `Loyer ${b.local} ${p}`, quantite: 1, prixUnitaire: b.loyer, tauxTaxe: taux }, ...(b.charges ? [{ designation: `Charges ${b.local} ${p}`, quantite: 1, prixUnitaire: b.charges, tauxTaxe: taux }] : [])],
      });
      const e = await appel(req, "POST", `/documents-vente/${d.id}/emission`, {});
      await protege(req, (ctx) => ctx.client.query("update appels_loyer set document_id = $3 where bail_id = $1 and periode = $2", [b.id, p, d.id]));
      return reponse.status(201).send({ numero: e.numero, total: d.total_ttc });
    } catch (x) {
      await protege(req, (ctx) => ctx.client.query("delete from appels_loyer where bail_id = $1 and periode = $2 and document_id is null", [b.id, p]));
      throw x;
    }
  });

  // Supermarché
  app.patch<{ Params: { id: string }; Body: { rayon: string | null } }>("/produits/:id/rayon", {
    schema: { params: paramId, body: { type: "object", required: ["rayon"], properties: { rayon: { type: ["string", "null"], maxLength: 100 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [p] } = await ctx.client.query("select entite_id from produits where id = $1", [req.params.id]);
      if (!p) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "catalogue.gerer", p.entite_id);
      await ctx.client.query("update produits set rayon = $2 where id = $1", [req.params.id, req.body.rayon]);
      return { rayon: req.body.rayon };
    }),
  );
  /** L'entrée du lot alimente aussi le stock, au coût moyen pondéré habituel. */
  app.post<{ Body: { entiteId: string; produitId: string; numero: string; peremption: string; quantite: number; coutUnitaire: number } }>("/lots", {
    schema: { body: { type: "object", required: ["entiteId", "produitId", "numero", "peremption", "quantite", "coutUnitaire"], properties: { entiteId: uuid, produitId: uuid, numero: texte(60), peremption: date, quantite: { type: "number", exclusiveMinimum: 0, maximum: 1000000000 }, coutUnitaire: entier } } },
  }, async (req, reponse) => {
    const l = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "stocks.gerer", b.entiteId);
      const { rows: [p] } = await ctx.client.query("select suivi_stock, entite_branche(entite_id) as b, entite_branche($2) as e from produits where id = $1 for update", [b.produitId, b.entiteId]);
      if (!p || p.b !== p.e) throw new ErreurApi(404, "introuvable");
      if (!p.suivi_stock) throw new ErreurApi(409, "produit_sans_stock");
      const { rows: [x] } = await ctx.client.query(
        "insert into lots_produit (organisation_id, entite_id, produit_id, numero, peremption, quantite_initiale, quantite) values ($1, $2, $3, $4, $5, $6, $6) returning *",
        [ctx.organisationId, b.entiteId, b.produitId, b.numero, b.peremption, b.quantite],
      );
      await entrerEnStock(ctx, b.entiteId, b.produitId, b.quantite, b.coutUnitaire, "entree", `Lot ${b.numero}`, b.numero);
      return x;
    });
    return reponse.status(201).send(l);
  });
  app.get<{ Querystring: { jours?: number } }>("/lots", {
    schema: { querystring: { type: "object", properties: { jours: { type: "integer", minimum: 0, maximum: 3650 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "stocks.voir");
      return (await ctx.client.query(
        `select l.*, l.quantite::float, l.quantite_initiale::float, p.nom as produit, p.rayon, p.cout_moyen, e.nom as entite, l.peremption < ${JOUR} as perime, (l.peremption - ${JOUR})::int as jours_restants
         from lots_produit l join produits p on p.id = l.produit_id join entites e on e.id = l.entite_id
         where l.entite_id = any($1::uuid[]) and l.quantite > 0 and l.peremption <= ${JOUR} + $2::int order by l.peremption limit 1000`,
        [await ids(ctx, "stocks.voir"), req.query.jours ?? 30],
      )).rows;
    }),
  );
  /** Démarque : un produit perdu sort du stock avec son motif, et la perte se voit en valeur. */
  app.post<{ Body: { entiteId: string; produitId: string; quantite: number; motif: string } }>("/demarques", {
    schema: { body: { type: "object", required: ["entiteId", "produitId", "quantite", "motif"], properties: { entiteId: uuid, produitId: uuid, quantite: { type: "number", exclusiveMinimum: 0, maximum: 1000000000 }, motif: { type: "string", minLength: 3, maxLength: 300 } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "stocks.gerer", b.entiteId);
      const { rows: [p] } = await ctx.client.query("select cout_moyen, suivi_stock from produits where id = $1 for update", [b.produitId]);
      if (!p?.suivi_stock) throw new ErreurApi(404, "introuvable");
      await sortirDuStock(ctx, b.entiteId, b.produitId, b.quantite, "sortie", `Perte : ${b.motif}`, null);
      return { valeur: Math.round(b.quantite * p.cout_moyen) };
    });
    return reponse.status(201).send(r);
  });

  // Points relais
  app.post<{ Body: { entiteId: string; nom: string; adresse?: string; telephone?: string; commission: number } }>("/points-relais", {
    schema: { body: { type: "object", required: ["entiteId", "nom", "commission"], properties: { entiteId: uuid, nom: texte(200), adresse: texte(500), telephone: texte(30), commission: entier } } },
  }, async (req, reponse) => {
    const p = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "transport.gerer", b.entiteId);
      return (await ctx.client.query("insert into points_relais (organisation_id, entite_id, nom, adresse, telephone, commission) values ($1, $2, $3, $4, $5, $6) returning *", [ctx.organisationId, b.entiteId, b.nom, b.adresse ?? null, b.telephone ?? null, b.commission])).rows[0];
    });
    return reponse.status(201).send(p);
  });
  app.get("/points-relais", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "transport.voir");
      return (await ctx.client.query(
        `select p.*, coalesce((select sum(c.montant) from commissions_relais c where c.point_relais_id = p.id and c.payee_le is null), 0)::int8 as a_payer,
           (select json_agg(json_build_object('id', x.id, 'numero', x.numero, 'destinataire', x.destinataire, 'a_encaisser', x.a_encaisser) order by x.cree_le) from colis x where x.point_relais_id = p.id and x.statut = 'arrive') as colis
         from points_relais p where p.entite_id = any($1::uuid[]) order by p.nom`,
        [await ids(ctx, "transport.voir")],
      )).rows;
    }),
  );
  const colisVerrou = async (ctx: Contexte, id: string) => {
    const { rows: [c] } = await ctx.client.query("select * from colis where id = $1 for update", [id]);
    if (!c) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, "transport.livrer", c.entite_id);
    return c;
  };
  const etape = (ctx: Contexte, id: string, statut: string, note: string) =>
    ctx.client.query("insert into etapes_colis (organisation_id, colis_id, statut, note, auteur_id) values ($1, $2, $3, $4, $5)", [ctx.organisationId, id, statut, note, ctx.utilisateurId]);
  app.post<{ Params: { id: string }; Body: { pointRelaisId: string } }>("/colis/:id/depot-relais", {
    schema: { params: paramId, body: { type: "object", required: ["pointRelaisId"], properties: { pointRelaisId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const c = await colisVerrou(ctx, req.params.id);
      if (!["prepare", "expedie", "en_transit", "echec"].includes(c.statut)) throw new ErreurApi(409, "etape_impossible");
      const { rows: [p] } = await ctx.client.query("select nom, actif from points_relais where id = $1 and entite_branche(entite_id) = entite_branche($2)", [req.body.pointRelaisId, c.entite_id]);
      if (!p?.actif) throw new ErreurApi(404, "introuvable");
      await ctx.client.query("update colis set statut = 'arrive', point_relais_id = $2 where id = $1", [c.id, req.body.pointRelaisId]);
      await etape(ctx, c.id, "arrive", `Point relais ${p.nom}`);
      return { statut: "arrive" };
    }),
  );
  /** Le retrait exige le code du client, comme une livraison, et fait naître la commission du relais. */
  app.post<{ Params: { id: string }; Body: { code: string; recuPar: string; encaisse?: number } }>("/colis/:id/retrait", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: { params: paramId, body: { type: "object", required: ["code", "recuPar"], properties: { code: { type: "string", pattern: "^[0-9]{6}$" }, recuPar: texte(200), encaisse: entier } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const c = await colisVerrou(ctx, req.params.id);
      if (c.statut !== "arrive" || !c.point_relais_id) throw new ErreurApi(409, "etape_impossible");
      const b = req.body;
      if (b.code !== c.code_confirmation) throw new ErreurApi(409, "code_incorrect");
      if ((b.encaisse ?? 0) !== c.a_encaisser) throw new ErreurApi(409, "encaissement_incomplet", { attendu: c.a_encaisser });
      await ctx.client.query("update colis set statut = 'livre', livre_a = $2, livre_le = now(), encaisse = $3 where id = $1", [c.id, b.recuPar, b.encaisse ?? 0]);
      await etape(ctx, c.id, "livre", `Retiré au point relais par ${b.recuPar}`);
      await ctx.client.query(
        "insert into commissions_relais (organisation_id, colis_id, point_relais_id, montant) select $1, $2, id, commission from points_relais where id = $3",
        [ctx.organisationId, c.id, c.point_relais_id],
      );
      return { statut: "livre" };
    }),
  );
  app.post<{ Params: { id: string }; Body: { portefeuilleId: string } }>("/points-relais/:id/paiement", {
    schema: { params: paramId, body: { type: "object", required: ["portefeuilleId"], properties: { portefeuilleId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [p] } = await ctx.client.query("select * from points_relais where id = $1 for update", [req.params.id]);
      if (!p) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "transport.gerer", p.entite_id);
      await exigerSurEntite(ctx, "tresorerie.gerer", p.entite_id);
      const { rows: [w] } = await ctx.client.query("select id, actif, entite_branche(entite_id) as b, entite_branche($2) as e from portefeuilles where id = $1 for update", [req.body.portefeuilleId, p.entite_id]);
      if (!w) throw new ErreurApi(404, "introuvable");
      if (w.b !== w.e) throw new ErreurApi(409, "transfert_autre_branche");
      if (!w.actif) throw new ErreurApi(409, "portefeuille_inactif");
      const { rows: [{ t }] } = await ctx.client.query("select coalesce(sum(montant), 0)::int8 as t from commissions_relais where point_relais_id = $1 and payee_le is null", [p.id]);
      if (!t) throw new ErreurApi(409, "rien_a_payer");
      const { rows: [{ s }] } = await ctx.client.query("select coalesce(sum(montant), 0)::int8 as s from mouvements_portefeuille where portefeuille_id = $1", [w.id]);
      if (t > s) throw new ErreurApi(409, "solde_portefeuille_insuffisant");
      await ctx.client.query("update commissions_relais set payee_le = now() where point_relais_id = $1 and payee_le is null", [p.id]);
      await ctx.client.query("insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, auteur_id, source_type) values ($1, $2, 'sortie', $3, $4, $5, 'commission')", [ctx.organisationId, w.id, -t, `Commissions du relais ${p.nom}`, ctx.utilisateurId]);
      return { paye: t };
    }),
  );

  // Portail grossiste
  const LIEN = (org: string, code: string) => `${urlPublique}/portail.html?c=${org}.${code}`;
  /** Un nouveau lien invalide l'ancien. Le lien donne accès au relevé du client : il se transmet à lui seul. */
  app.post<{ Params: { id: string }; Body: { entiteId: string; actif: boolean } }>("/tiers/:id/portail", {
    schema: { params: paramId, body: { type: "object", required: ["entiteId", "actif"], properties: { entiteId: uuid, actif: { type: "boolean" } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "facturation.administrer", req.body.entiteId);
      await lierTiers(ctx, req.params.id, req.body.entiteId);
      const code = req.body.actif ? randomBytes(16).toString("base64url") : null;
      const { rowCount } = await ctx.client.query("update comptes_pro set code_portail = $2 where tiers_id = $1", [req.params.id, code]);
      if (!rowCount) throw new ErreurApi(409, "compte_pro_manquant");
      await ctx.client.query("select journal_evenement('portail.acces', $1)", [JSON.stringify({ tiers: req.params.id, actif: req.body.actif })]);
      return code ? { lien: LIEN(ctx.organisationId, code) } : { lien: null };
    }),
  );
  const parCode = <T>(code: string, fn: (c: Client, t: Record<string, any>, org: string) => Promise<T>) => {
    if (!CODE.test(code)) throw new ErreurApi(404, "introuvable");
    const [org, secret] = code.split(".") as [string, string];
    return dansOrganisation(pool, org, async (c) => {
      const { rows: [t] } = await c.query("select p.tiers_id, p.categorie, p.delai_jours, x.nom, x.branche_id from comptes_pro p join tiers x on x.id = p.tiers_id where p.code_portail = $1", [secret]);
      if (!t || !t.branche_id) throw new ErreurApi(404, "introuvable");
      return fn(c, t, org);
    }).catch((e) => { if (e.code === "22P02") throw new ErreurApi(404, "introuvable"); throw e; });
  };
  const catalogue = async (c: Client, branche: string) => (await c.query(
    `select p.id, p.code, p.nom, p.unite, p.prix_vente, p.paliers_actif, p.quantite_min::float, p.multiple::float, p.conditionnements,
       (select json_build_object('type', o.type, 'valeur', o.valeur) from promotions o where o.produit_id = p.id and o.actif and (now() at time zone 'Africa/Douala')::date between o.debut and o.fin order by o.cree_le desc limit 1) as promo,
       (select json_agg(json_build_object('quantite_min', x.quantite_min::float, 'prix', x.prix) order by x.quantite_min) from paliers_prix x where x.produit_id = p.id) as paliers
     from produits p where p.actif and p.type = 'produit' and entite_branche(p.entite_id) = $1 order by p.nom limit 2000`, [branche],
  )).rows;
  /** Jamais le coût ni la marge. Les paliers ne s'affichent que s'ils sont actifs. */
  app.get<{ Params: { code: string } }>("/portail/:code", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) =>
    parCode(req.params.code, async (c, t) => {
      const credit = await controleCredit(c, t.tiers_id, 0);
      const { rows: factures } = await c.query(
        `select f.numero, f.date_document, f.date_echeance, f.total_ttc,
           f.total_ttc - (select coalesce(sum(r.montant), 0) from reglements r where r.facture_id = f.id and r.annule_le is null) - (select coalesce(sum(a.total_ttc), 0) from documents_vente a where a.origine_id = f.id and a.type = 'avoir' and a.statut = 'emis') as reste
         from documents_vente f where f.tiers_id = $1 and f.type = 'facture' and f.statut = 'emis' order by f.date_document desc limit 200`, [t.tiers_id],
      );
      const { rows: commandes } = await c.query("select id, total_ht, statut, motif, cree_le from commandes_portail where tiers_id = $1 order by cree_le desc limit 50", [t.tiers_id]);
      const cat = await catalogue(c, t.branche_id);
      return {
        nom: t.nom, categorie: t.categorie, delai_jours: t.delai_jours, credit: credit ? { plafond: credit.plafond, encours: credit.encours } : null, factures: factures.map((f) => ({ ...f, reste: Number(f.reste) })), commandes,
        catalogue: cat.map(({ paliers, paliers_actif, ...p }) => ({ ...p, paliers: paliers_actif ? paliers ?? [] : [] })),
      };
    }),
  );
  /** Une commande du portail est une demande : un commercial la valide. Le prix vient toujours du serveur. */
  app.post<{ Params: { code: string }; Body: { lignes: { produitId: string; quantite: number }[]; note?: string } }>("/portail/:code/commandes", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: { body: { type: "object", required: ["lignes"], properties: { lignes: { type: "array", minItems: 1, maxItems: 200, items: { type: "object", required: ["produitId", "quantite"], properties: { produitId: uuid, quantite: { type: "number", exclusiveMinimum: 0, maximum: 100000000 } } } }, note: { type: "string", maxLength: 1000 } } } },
  }, async (req, reponse) => {
    const r = await parCode(req.params.code, async (c, t, org) => {
      const cat = new Map((await catalogue(c, t.branche_id)).map((p) => [p.id, p]));
      let total = 0;
      // Prix négocié, grille de catégorie ou tranches : calculés sur le serveur pour ce client.
      const speciaux = new Map<string, number>();
      for (const l of req.body.lignes) {
        const p = cat.get(l.produitId);
        if (!p) continue;
        const { rows: [sp] } = await c.query("select (exists (select 1 from prix_clients x where x.tiers_id = $1 and x.produit_id = $2) or exists (select 1 from prix_grilles g where g.produit_id = $2) or (select mode_palier = 'tranches' and paliers_actif from produits where id = $2)) as oui", [t.tiers_id, l.produitId]);
        if (sp.oui) speciaux.set(l.produitId, await prixProduit(c, l.produitId, p.prix_vente, l.quantite, t.tiers_id));
      }
      const lignes = req.body.lignes.map((l) => {
        const p = cat.get(l.produitId);
        if (!p) throw new ErreurApi(404, "introuvable");
        if (Number(p.quantite_min) > 0 && l.quantite < Number(p.quantite_min)) throw new ErreurApi(409, "quantite_minimale", { produit: p.nom, minimum: Number(p.quantite_min) });
        if (Number(p.multiple) > 0 && Math.abs(l.quantite / Number(p.multiple) - Math.round(l.quantite / Number(p.multiple))) > 1e-6) throw new ErreurApi(409, "multiple_obligatoire", { produit: p.nom, multiple: Number(p.multiple) });
        const brut = prixPourQuantite(p.prix_vente, p.paliers_actif, p.paliers ?? [], l.quantite);
        const special = speciaux.get(l.produitId);
        const prix = special !== undefined ? special : p.promo ? prixPromo(brut, p.promo.type, Number(p.promo.valeur)) : brut;
        total += Math.round(l.quantite * prix);
        return { produitId: l.produitId, nom: p.nom, quantite: l.quantite, prix };
      });
      const { rows: [x] } = await c.query(
        "insert into commandes_portail (organisation_id, tiers_id, entite_id, lignes, total_ht, note) values ($1, $2, $3, $4, $5, $6) returning id, total_ht, statut",
        [org, t.tiers_id, t.branche_id, JSON.stringify(lignes), total, req.body.note?.trim() || null],
      );
      return x;
    });
    return reponse.status(201).send(r);
  });
  app.get("/commandes-portail", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "facturation.voir");
      return (await ctx.client.query(
        "select c.*, t.nom from commandes_portail c join tiers t on t.id = c.tiers_id where c.entite_id = any($1::uuid[]) order by c.statut = 'soumise' desc, c.cree_le desc limit 300",
        [(await entitesAccessibles(ctx.client, ctx.utilisateurId, "facturation.voir")).map((e) => e.id)],
      )).rows;
    }),
  );
  /** Accepter crée un devis, au prix calculé lors de la commande. Le plafond se contrôlera à l'émission de la facture. */
  app.post<{ Params: { id: string }; Body: { decision: string; motif?: string } }>("/commandes-portail/:id/decision", {
    schema: { params: paramId, body: { type: "object", required: ["decision"], properties: { decision: { type: "string", enum: ["acceptee", "refusee"] }, motif: { type: "string", minLength: 3, maxLength: 500 } } } },
  }, async (req) => {
    const { decision, motif } = req.body;
    const c = await protege(req, async (ctx) => {
      const { rows: [x] } = await ctx.client.query("select * from commandes_portail where id = $1 for update", [req.params.id]);
      if (!x) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "facturation.gerer", x.entite_id);
      if (x.statut !== "soumise") throw new ErreurApi(409, "deja_decide");
      if (decision === "refusee" && !motif) throw new ErreurApi(400, "motif_obligatoire");
      await ctx.client.query("update commandes_portail set statut = $2, motif = $3 where id = $1", [x.id, decision, motif ?? null]);
      return x;
    });
    if (decision === "refusee") return { statut: "refusee" };
    // Si le devis échoue, par exemple sur un produit retiré, la commande redevient à traiter.
    const d = await appel(req, "POST", "/documents-vente", {
      type: "devis", entiteId: c.entite_id, tiersId: c.tiers_id, date: new Date().toISOString().slice(0, 10),
      lignes: (c.lignes as { produitId: string; quantite: number; prix: number }[]).map((l) => ({ produitId: l.produitId, quantite: l.quantite, prixUnitaire: l.prix })),
    }).catch(async (e) => {
      await protege(req, (ctx) => ctx.client.query("update commandes_portail set statut = 'soumise' where id = $1", [c.id]));
      throw e;
    });
    await protege(req, (ctx) => ctx.client.query("update commandes_portail set document_id = $2 where id = $1", [c.id, d.id]));
    return { statut: "acceptee", documentId: d.id };
  });
}
