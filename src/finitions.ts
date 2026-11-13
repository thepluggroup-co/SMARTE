import { timingSafeEqual, createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import pg from "pg";
import { dansOrganisation } from "./base.js";
import { entitesAccessibles } from "./permissions.js";
import { provisionnerOrganisation } from "./provisionnement.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max = 300) => ({ type: "string", minLength: 1, maxLength: max }) as const;

/** Chaque unité paie le prix de sa tranche. Retourne le total de la ligne. */
export function totalParTranches(base: number, paliers: { quantite_min: number; prix: number }[], q: number): number {
  const p = [...paliers].sort((a, b) => a.quantite_min - b.quantite_min);
  let total = 0, deja = 0, prix = base;
  for (const x of p) {
    const n = Math.max(Math.min(q, x.quantite_min - 1) - deja, 0);
    total += n * prix; deja += n; prix = x.prix;
  }
  return Math.round(total + Math.max(q - deja, 0) * prix);
}
/** Moyenne des trois derniers mois, corrigée de la pente sur six mois. Une estimation, pas un engagement. */
export function prevoirMois(historique: number[]): number {
  if (!historique.length) return 0;
  const recent = historique.slice(-3);
  const moy = recent.reduce((s, x) => s + x, 0) / recent.length;
  const n = historique.length;
  const pente = n >= 2 ? (historique[n - 1]! - historique[0]!) / (n - 1) : 0;
  return Math.max(Math.round(moy + pente), 0);
}
const SOURCES_RAPPORT: Record<string, { base: string; mesure: string; date: string; entite: string; dims: Record<string, string> }> = {
  ventes: { base: "documents_vente d join tiers t on t.id = d.tiers_id", mesure: "case when d.type = 'avoir' then -d.total_ht else d.total_ht end", date: "d.date_document", entite: "d.entite_id", dims: { mois: "to_char(d.date_document, 'YYYY-MM')", client: "t.nom", entite: "(select nom from entites e where e.id = d.entite_id)" } },
  caisse: { base: "ventes_comptoir d", mesure: "d.total_ht", date: "(d.cree_le at time zone 'Africa/Douala')::date", entite: "d.entite_id", dims: { mois: "to_char(d.cree_le at time zone 'Africa/Douala', 'YYYY-MM')", entite: "(select nom from entites e where e.id = d.entite_id)", jour: "(d.cree_le at time zone 'Africa/Douala')::date::text" } },
  encaissements: { base: "reglements r join documents_vente d on d.id = r.facture_id join tiers t on t.id = d.tiers_id", mesure: "r.montant", date: "(r.encaisse_le at time zone 'Africa/Douala')::date", entite: "d.entite_id", dims: { mois: "to_char(r.encaisse_le at time zone 'Africa/Douala', 'YYYY-MM')", client: "t.nom", moyen: "r.moyen" } },
};
const FILTRES: Record<string, string> = { ventes: "d.type in ('facture', 'avoir') and d.statut = 'emis'", caisse: "d.annulee_le is null", encaissements: "r.annule_le is null" };

export interface OptionsConsole { cle?: string; poolAdmin?: pg.Pool }

export function enregistrerFinitions(app: FastifyInstance, pool: pg.Pool, outils: Outils, cons: OptionsConsole): void {
  const { protege, exiger, exigerSurEntite } = outils;
  const ids = async (ctx: Contexte, p: Parameters<typeof entitesAccessibles>[2]) => (await entitesAccessibles(ctx.client, ctx.utilisateurId, p)).map((e) => e.id);

  // Grilles de prix par catégorie de client et par période
  app.post<{ Params: { id: string }; Body: { categorie?: string; debut?: string; fin?: string; prix: number } }>("/produits/:id/grilles", {
    schema: { params: paramId, body: { type: "object", required: ["prix"], properties: { categorie: texte(50), debut: date, fin: date, prix: { type: "integer", minimum: 0 } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const { rows: [p] } = await ctx.client.query("select entite_id, cout_moyen from produits where id = $1", [req.params.id]);
      if (!p) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "catalogue.gerer", p.entite_id);
      const b = req.body;
      if (b.prix < p.cout_moyen) throw new ErreurApi(409, "palier_sous_le_cout", { cout: p.cout_moyen, prix: b.prix });
      return (await ctx.client.query("insert into prix_grilles (organisation_id, produit_id, categorie, debut, fin, prix, auteur_id) values ($1, $2, $3, $4, $5, $6, $7) returning id", [ctx.organisationId, req.params.id, b.categorie ?? null, b.debut ?? null, b.fin ?? null, b.prix, ctx.utilisateurId])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.put<{ Params: { id: string }; Body: { mode: string } }>("/produits/:id/mode-palier", {
    schema: { params: paramId, body: { type: "object", required: ["mode"], properties: { mode: { type: "string", enum: ["ligne", "tranches"] } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [p] } = await ctx.client.query("select entite_id from produits where id = $1", [req.params.id]);
      if (!p) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "catalogue.gerer", p.entite_id);
      await ctx.client.query("update produits set mode_palier = $2 where id = $1", [req.params.id, req.body.mode]);
      return { enregistre: true };
    }),
  );

  // Devises : taux tenus pour information, la comptabilité reste en FCFA.
  app.put<{ Body: { devise: string; jour: string; taux: number } }>("/devises/taux", {
    schema: { body: { type: "object", required: ["devise", "jour", "taux"], properties: { devise: { type: "string", pattern: "^[A-Z]{3}$" }, jour: date, taux: { type: "number", exclusiveMinimum: 0 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "compta.saisir");
      const b = req.body;
      await ctx.client.query("insert into taux_change (organisation_id, devise, jour, taux, auteur_id) values ($1, $2, $3, $4, $5) on conflict (organisation_id, devise, jour) do update set taux = excluded.taux, auteur_id = excluded.auteur_id", [ctx.organisationId, b.devise, b.jour, b.taux, ctx.utilisateurId]);
      return { enregistre: true };
    }),
  );
  app.get<{ Querystring: { devise?: string; montant?: number } }>("/devises/taux", {
    schema: { querystring: { type: "object", properties: { devise: { type: "string", pattern: "^[A-Z]{3}$" }, montant: { type: "number" } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "compta.voir");
      const { rows } = await ctx.client.query("select distinct on (devise) devise, jour::text, taux::float from taux_change order by devise, jour desc");
      const x = rows.find((r) => r.devise === req.query.devise);
      return { taux: rows, conversion: x && req.query.montant !== undefined ? Math.round(req.query.montant * x.taux) : null };
    }),
  );

  // Préparation de commande : l'ordre suit les emplacements, le scan contrôle chaque article.
  app.put<{ Params: { id: string }; Body: { emplacement: string | null } }>("/produits/:id/emplacement", {
    schema: { params: paramId, body: { type: "object", required: ["emplacement"], properties: { emplacement: { type: ["string", "null"], maxLength: 50 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [p] } = await ctx.client.query("select entite_id from produits where id = $1", [req.params.id]);
      if (!p) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "stocks.gerer", p.entite_id);
      await ctx.client.query("update produits set emplacement = $2 where id = $1", [req.params.id, req.body.emplacement]);
      return { enregistre: true };
    }),
  );
  app.post<{ Params: { id: string } }>("/documents-vente/:id/preparation", { schema: { params: paramId } }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const { rows: [d] } = await ctx.client.query("select id, entite_id, statut, type from documents_vente where id = $1", [req.params.id]);
      if (!d) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "stocks.gerer", d.entite_id);
      if (d.type !== "facture" || d.statut !== "emis") throw new ErreurApi(409, "facture_non_emise");
      const { rows } = await ctx.client.query("select p.id as produit_id, p.nom, p.code, p.code_barres, p.emplacement, sum(l.quantite)::float as quantite from lignes_vente l join produits p on p.id = l.produit_id where l.document_id = $1 and p.suivi_stock group by p.id order by p.emplacement nulls last, p.nom", [d.id]);
      if (!rows.length) throw new ErreurApi(409, "rien_a_preparer");
      const { rows: [x] } = await ctx.client.query("insert into preparations (organisation_id, document_id, lignes, auteur_id) values ($1, $2, $3, $4) on conflict (organisation_id, document_id) do nothing returning id, lignes, statut", [ctx.organisationId, d.id, JSON.stringify(rows.map((l) => ({ ...l, pris: 0 }))), ctx.utilisateurId]);
      return x ?? (await ctx.client.query("select id, lignes, statut from preparations where document_id = $1", [d.id])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.post<{ Params: { id: string }; Body: { code: string } }>("/preparations/:id/scan", {
    schema: { params: paramId, body: { type: "object", required: ["code"], properties: { code: texte(100) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [p] } = await ctx.client.query("select x.*, d.entite_id from preparations x join documents_vente d on d.id = x.document_id where x.id = $1 for update of x", [req.params.id]);
      if (!p) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "stocks.gerer", p.entite_id);
      if (p.statut !== "en_cours") throw new ErreurApi(409, "preparation_terminee");
      const lignes = p.lignes as { code: string; code_barres: string | null; nom: string; quantite: number; pris: number }[];
      const c = req.body.code.trim();
      const l = lignes.find((x) => x.code === c || x.code_barres === c);
      if (!l) throw new ErreurApi(409, "article_hors_commande");
      if (l.pris >= l.quantite) throw new ErreurApi(409, "article_deja_complet", { nom: l.nom });
      l.pris += 1;
      const fini = lignes.every((x) => x.pris >= x.quantite);
      await ctx.client.query("update preparations set lignes = $2, statut = $3 where id = $1", [p.id, JSON.stringify(lignes), fini ? "terminee" : "en_cours"]);
      return { lignes, statut: fini ? "terminee" : "en_cours" };
    }),
  );

  // Rapports : sources et regroupements choisis dans une liste fermée, jamais de requête libre.
  const rapport = async (ctx: Contexte, source: string, dimension: string, debut: string, fin: string) => {
    const s = SOURCES_RAPPORT[source];
    const dim = s?.dims[dimension];
    if (!s || !dim) throw new ErreurApi(400, "rapport_invalide");
    const v = await ids(ctx, "facturation.voir");
    const { rows } = await ctx.client.query(`select ${dim} as cle, sum(${s.mesure})::int8 as total, count(*)::int as nombre from ${s.base} where ${FILTRES[source]} and ${s.entite} = any($1::uuid[]) and ${s.date} between $2 and $3 group by 1 order by total desc limit 1000`, [v, debut, fin]);
    return rows.map((r) => ({ cle: r.cle, total: Number(r.total), nombre: r.nombre }));
  };
  const corpsRapport = { type: "object", required: ["source", "dimension", "debut", "fin"], properties: { source: { type: "string", enum: Object.keys(SOURCES_RAPPORT) }, dimension: texte(20), debut: date, fin: date, comparer: { type: "boolean" } } } as const;
  app.post<{ Body: { source: string; dimension: string; debut: string; fin: string; comparer?: boolean } }>("/rapports/execution", { schema: { body: corpsRapport } }, async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "facturation.voir");
      const b = req.body;
      const lignes = await rapport(ctx, b.source, b.dimension, b.debut, b.fin);
      if (!b.comparer) return { lignes, dimensions: Object.keys(SOURCES_RAPPORT[b.source]!.dims) };
      const duree = Date.parse(b.fin) - Date.parse(b.debut) + 86400000;
      const f = (t: number) => new Date(t).toISOString().slice(0, 10);
      const avant = await rapport(ctx, b.source, b.dimension, f(Date.parse(b.debut) - duree), f(Date.parse(b.fin) - duree));
      return { lignes: lignes.map((l) => ({ ...l, precedent: avant.find((a) => a.cle === l.cle)?.total ?? 0 })), dimensions: Object.keys(SOURCES_RAPPORT[b.source]!.dims) };
    }),
  );
  app.post<{ Body: { nom: string; definition: object } }>("/rapports/sauves", {
    schema: { body: { type: "object", required: ["nom", "definition"], properties: { nom: texte(100), definition: { type: "object", required: ["source", "dimension"], additionalProperties: false, properties: { source: texte(20), dimension: texte(20) } } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => (await ctx.client.query("insert into rapports_sauves (organisation_id, utilisateur_id, nom, definition) values ($1, $2, $3, $4) returning id", [ctx.organisationId, ctx.utilisateurId, req.body.nom, JSON.stringify(req.body.definition)])).rows[0]);
    return reponse.status(201).send(r);
  });
  app.get("/rapports/sauves", async (req) => protege(req, async (ctx) => (await ctx.client.query("select id, nom, definition from rapports_sauves where utilisateur_id = $1 order by nom", [ctx.utilisateurId])).rows));

  // Prévision simple des ventes par produit, avec la couverture du stock.
  app.get("/previsions/ventes", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "facturation.voir");
      const v = await ids(ctx, "facturation.voir");
      const { rows } = await ctx.client.query(
        `with m as (select l.produit_id, to_char(d.date_document, 'YYYY-MM') as mois, sum(l.quantite)::float as q from lignes_vente l join documents_vente d on d.id = l.document_id where d.type = 'facture' and d.statut = 'emis' and d.entite_id = any($1::uuid[]) and l.produit_id is not null and d.date_document >= date_trunc('month', now()) - interval '6 months' and d.date_document < date_trunc('month', now()) group by 1, 2
           union all select l.produit_id, to_char(v.cree_le at time zone 'Africa/Douala', 'YYYY-MM'), sum(l.quantite)::float from lignes_comptoir l join ventes_comptoir v on v.id = l.vente_id where v.annulee_le is null and v.entite_id = any($1::uuid[]) and l.produit_id is not null and v.cree_le >= date_trunc('month', now()) - interval '6 months' and v.cree_le < date_trunc('month', now()) group by 1, 2)
         select p.id, p.nom, (select coalesce(sum(s.quantite), 0)::float from mouvements_stock s where s.produit_id = p.id) as stock, array_agg(m.q order by m.mois) as historique from m join produits p on p.id = m.produit_id group by p.id limit 500`, [v],
      );
      return rows.map((r) => { const prevu = prevoirMois(r.historique); return { id: r.id, nom: r.nom, stock: r.stock, prevu, mois_couverts: prevu ? Math.round((r.stock / prevu) * 10) / 10 : null, mois_connus: r.historique.length }; }).sort((a, b) => (a.mois_couverts ?? 999) - (b.mois_couverts ?? 999));
    }),
  );

  // Identité visuelle par entité
  app.patch<{ Params: { id: string }; Body: { couleur?: string | null; logoUrl?: string | null } }>("/entites/:id/charte", {
    schema: { params: paramId, body: { type: "object", minProperties: 1, properties: { couleur: { type: ["string", "null"], pattern: "^#[0-9a-fA-F]{6}$" }, logoUrl: { type: ["string", "null"], pattern: "^https://", maxLength: 1000 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "entites.gerer", req.params.id);
      await ctx.client.query("update entites set couleur = $2, logo_url = $3 where id = $1", [req.params.id, req.body.couleur ?? null, req.body.logoUrl ?? null]);
      return { enregistre: true };
    }),
  );
  app.get("/entites-chartes", async (req) => protege(req, async (ctx) => (await ctx.client.query("select id, code, couleur, logo_url from entites order by nom")).rows));

  // Abonnement vu par l'organisation
  app.get("/abonnement", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "utilisateurs.gerer");
      const { rows: [a] } = await ctx.client.query("select a.plan, a.essai_fin::text, a.prochaine_echeance::text, p.nom, p.max_utilisateurs, (select count(*)::int from utilisateurs u where u.actif) as utilisateurs from abonnements a join plans_saas p on p.code = a.plan");
      return a ?? null;
    }),
  );

  // Console de la plateforme : séparée des comptes clients, fermée sans clé ni accès administrateur.
  const exigerConsole = (req: FastifyRequest) => {
    if (!cons.cle || !cons.poolAdmin) throw new ErreurApi(404, "introuvable");
    const h = (s: string) => createHash("sha256").update(s).digest();
    if (!timingSafeEqual(h(String(req.headers["x-console-cle"] ?? "")), h(cons.cle))) throw new ErreurApi(401, "non_authentifie");
    return cons.poolAdmin;
  };
  const limiteConsole = { rateLimit: { max: 30, timeWindow: "1 minute" } };
  app.get("/console/organisations", { config: limiteConsole }, async (req) => {
    const adm = exigerConsole(req);
    const { rows } = await adm.query("select o.id, o.slug, o.nom, o.statut, o.cree_le, a.plan, a.essai_fin::text, a.prochaine_echeance::text from organisations o left join abonnements a on a.organisation_id = o.id order by o.cree_le");
    const res = [];
    for (const o of rows) {
      const u = await dansOrganisation(pool, o.id, async (c) => (await c.query("select count(*)::int as n from utilisateurs where actif")).rows[0].n as number);
      res.push({ ...o, utilisateurs: u });
    }
    return res;
  });
  app.get("/console/plans", { config: limiteConsole }, async (req) => (await exigerConsole(req).query("select * from plans_saas order by code")).rows);
  app.post<{ Body: { slug: string; nom: string; plan: string; essaiFin?: string; adminEmail: string; adminNom: string; adminMotDePasse: string } }>("/console/organisations", {
    config: limiteConsole,
    schema: { body: { type: "object", required: ["slug", "nom", "plan", "adminEmail", "adminNom", "adminMotDePasse"], properties: { slug: { type: "string", pattern: "^[a-z0-9-]{2,40}$" }, nom: texte(200), plan: texte(30), essaiFin: date, adminEmail: { type: "string", format: "email" }, adminNom: texte(200), adminMotDePasse: { type: "string", minLength: 8, maxLength: 200 } } } },
  }, async (req, reponse) => {
    const adm = exigerConsole(req);
    const b = req.body;
    const { rows: [pl] } = await adm.query("select code from plans_saas where code = $1", [b.plan]);
    if (!pl) throw new ErreurApi(404, "introuvable");
    const { rows: [ex] } = await adm.query("select 1 from organisations where slug = $1", [b.slug]);
    if (ex) throw new ErreurApi(409, "organisation_existante");
    const o = await provisionnerOrganisation(adm, { slug: b.slug, nom: b.nom, racine: { code: "SIEGE", nom: b.nom, type: "societe", modules: ["pilotage", "crm", "support", "facturation", "tresorerie", "comptabilite", "rh_paie"] }, admin: { email: b.adminEmail, nom: b.adminNom, motDePasse: b.adminMotDePasse } });
    await adm.query("insert into abonnements (organisation_id, plan, essai_fin) values ($1, $2, $3)", [o.organisationId, b.plan, b.essaiFin ?? null]);
    return reponse.status(201).send({ id: o.organisationId });
  });
  app.patch<{ Params: { id: string }; Body: { statut?: string; plan?: string; prochaineEcheance?: string } }>("/console/organisations/:id", {
    config: limiteConsole,
    schema: { params: paramId, body: { type: "object", minProperties: 1, properties: { statut: { type: "string", enum: ["active", "suspendue"] }, plan: texte(30), prochaineEcheance: date } } },
  }, async (req) => {
    const adm = exigerConsole(req);
    const b = req.body;
    if (b.statut) await adm.query("update organisations set statut = $2 where id = $1", [req.params.id, b.statut]);
    if (b.plan || b.prochaineEcheance) await adm.query("insert into abonnements (organisation_id, plan, prochaine_echeance) values ($1, coalesce($2, 'entreprise'), $3) on conflict (organisation_id) do update set plan = coalesce($2, abonnements.plan), prochaine_echeance = coalesce($3, abonnements.prochaine_echeance)", [req.params.id, b.plan ?? null, b.prochaineEcheance ?? null]);
    return { enregistre: true };
  });
}
