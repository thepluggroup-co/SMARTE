import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import QRCode from "qrcode";
import { dansOrganisation, publierEvenement, type Client } from "./base.js";
import { prochainNumero } from "./formations.js";
import { entitesAccessibles } from "./permissions.js";
import { normaliserTelephone } from "./securite.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";

const uuid = { type: "string", format: "uuid" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max = 200) => ({ type: "string", minLength: 1, maxLength: max }) as const;
const CODE = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{20,}$/;

export function enregistrerManifestations(app: FastifyInstance, pool: pg.Pool, outils: Outils): void {
  const { protege, exiger, exigerSurEntite } = outils;

  app.post<{ Body: { entiteId: string; titre: string; description?: string; lieu?: string; debut: string; fin: string; capacite: number; prix?: number; intervenants?: string } }>("/manifestations", {
    schema: { body: { type: "object", required: ["entiteId", "titre", "debut", "fin", "capacite"], properties: { entiteId: uuid, titre: texte(), description: texte(3000), lieu: texte(), debut: { type: "string", format: "date-time" }, fin: { type: "string", format: "date-time" }, capacite: { type: "integer", minimum: 1, maximum: 100000 }, prix: { type: "integer", minimum: 0, maximum: 100_000_000 }, intervenants: texte(1000) } } },
  }, async (req, reponse) => {
    const m = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "marketing.gerer", b.entiteId);
      if (Date.parse(b.fin) <= Date.parse(b.debut)) throw new ErreurApi(400, "dates_invalides");
      return (await ctx.client.query(
        "insert into manifestations (organisation_id, entite_id, titre, description, lieu, debut, fin, capacite, prix, intervenants, code) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *",
        [ctx.organisationId, b.entiteId, b.titre, b.description ?? null, b.lieu ?? null, b.debut, b.fin, b.capacite, b.prix ?? 0, b.intervenants ?? null, randomBytes(24).toString("base64url")],
      )).rows[0];
    });
    return reponse.status(201).send({ ...m, lien: `/evenement.html?c=${m.organisation_id}.${m.code}` });
  });
  app.get("/manifestations", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "marketing.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "marketing.voir")).map((e) => e.id);
      const { rows } = await ctx.client.query(
        `select m.id, m.titre, m.lieu, m.debut, m.fin, m.capacite, m.prix, m.ouverte, m.organisation_id, m.code, m.entite_id, e.nom as entite,
           count(b.id) filter (where b.statut <> 'annule')::int as inscrits, count(b.id) filter (where b.present_le is not null)::int as presents, coalesce(sum(b.montant_paye) filter (where b.statut = 'paye'), 0)::int8 as recette
         from manifestations m join entites e on e.id = m.entite_id left join billets b on b.manifestation_id = m.id where m.entite_id = any($1::uuid[]) group by m.id, e.nom order by m.debut desc limit 200`, [ids],
      );
      return rows.map(({ organisation_id, code, ...m }) => ({ ...m, lien: `/evenement.html?c=${organisation_id}.${code}` }));
    }),
  );
  const manifestation = async (ctx: Contexte, id: string, p: "marketing.voir" | "marketing.gerer") => {
    const { rows: [m] } = await ctx.client.query("select * from manifestations where id = $1", [id]);
    if (!m) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, p, m.entite_id);
    return m;
  };
  app.post<{ Params: { id: string } }>("/manifestations/:id/cloture", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => { await manifestation(ctx, req.params.id, "marketing.gerer"); await ctx.client.query("update manifestations set ouverte = false where id = $1", [req.params.id]); return { ouverte: false }; }),
  );
  app.get<{ Params: { id: string } }>("/manifestations/:id/billets", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await manifestation(ctx, req.params.id, "marketing.voir");
      return (await ctx.client.query("select id, nom, telephone, email, code, statut, montant_paye, numero, present_le from billets where manifestation_id = $1 order by nom limit 5000", [req.params.id])).rows;
    }),
  );
  const billet = async (ctx: Contexte, id: string) => {
    const { rows: [b] } = await ctx.client.query("select b.*, m.prix, m.entite_id, m.titre from billets b join manifestations m on m.id = b.manifestation_id where b.id = $1 for update of b", [id]);
    if (!b) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, "marketing.gerer", b.entite_id);
    return b;
  };
  app.post<{ Params: { id: string }; Body: { portefeuilleId: string; reference?: string } }>("/billets/:id/paiement", {
    schema: { params: paramId, body: { type: "object", required: ["portefeuilleId"], properties: { portefeuilleId: uuid, reference: texte(100) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const b = await billet(ctx, req.params.id);
      await exigerSurEntite(ctx, "tresorerie.gerer", b.entite_id);
      if (b.statut !== "reserve") throw new ErreurApi(409, "billet_deja_traite");
      if (Number(b.prix) === 0) throw new ErreurApi(409, "evenement_gratuit");
      const { rows: [w] } = await ctx.client.query("select id, actif, entite_branche(entite_id) as branche, entite_branche($2) as attendue from portefeuilles where id = $1", [req.body.portefeuilleId, b.entite_id]);
      if (!w) throw new ErreurApi(404, "introuvable");
      if (w.branche !== w.attendue) throw new ErreurApi(409, "transfert_autre_branche");
      if (!w.actif) throw new ErreurApi(409, "portefeuille_inactif");
      const { rows: [{ an }] } = await ctx.client.query("select extract(year from now() at time zone 'Africa/Douala')::int as an");
      const numero = await prochainNumero(ctx.client, `BIL-${an}`);
      await ctx.client.query("update billets set statut = 'paye', montant_paye = $2, portefeuille_id = $3, numero = $4, encaisse_par = $5 where id = $1", [b.id, b.prix, w.id, numero, ctx.utilisateurId]);
      await ctx.client.query("insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, reference, auteur_id, source_type) values ($1, $2, 'entree', $3, $4, $5, $6, 'billet')", [ctx.organisationId, w.id, b.prix, `Billet ${b.titre} : ${b.nom}`.slice(0, 300), numero, ctx.utilisateurId]);
      return { statut: "paye", numero };
    }),
  );
  /** Rembourse un billet payé par un mouvement inverse, tant que la personne n'est pas entrée. */
  app.post<{ Params: { id: string }; Body: { motif: string } }>("/billets/:id/remboursement", {
    schema: { params: paramId, body: { type: "object", required: ["motif"], properties: { motif: { type: "string", minLength: 5, maxLength: 300 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const b = await billet(ctx, req.params.id);
      await exigerSurEntite(ctx, "tresorerie.gerer", b.entite_id);
      if (b.statut !== "paye") throw new ErreurApi(409, "billet_non_paye");
      if (b.present_le) throw new ErreurApi(409, "billet_deja_utilise", { nom: b.nom });
      const { rows: [s] } = await ctx.client.query("select coalesce(sum(montant), 0)::int8 as s from mouvements_portefeuille where portefeuille_id = $1", [b.portefeuille_id]);
      if (Number(b.montant_paye) > Number(s.s)) throw new ErreurApi(409, "solde_portefeuille_insuffisant");
      const { rows: [m] } = await ctx.client.query("select id from mouvements_portefeuille where source_type = 'billet' and reference = $1 and portefeuille_id = $2 and montant > 0", [b.numero, b.portefeuille_id]);
      await ctx.client.query("insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, reference, auteur_id, source_type, annule_mouvement_id) values ($1, $2, 'annulation', $3, $4, $5, $6, 'billet', $7)", [ctx.organisationId, b.portefeuille_id, -Number(b.montant_paye), `Remboursement billet : ${req.body.motif}`.slice(0, 300), b.numero, ctx.utilisateurId, m?.id ?? null]);
      await ctx.client.query("update billets set statut = 'annule' where id = $1", [b.id]);
      return { statut: "annule" };
    }),
  );
  app.post<{ Params: { id: string } }>("/billets/:id/annulation", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const b = await billet(ctx, req.params.id);
      if (b.statut === "paye") throw new ErreurApi(409, "billet_paye");
      await ctx.client.query("update billets set statut = 'annule' where id = $1", [b.id]);
      return { statut: "annule" };
    }),
  );
  /** Contrôle à l'entrée : un billet n'entre qu'une fois, et un événement payant demande le paiement. */
  app.post<{ Params: { id: string }; Body: { code: string } }>("/manifestations/:id/entree", {
    schema: { params: paramId, body: { type: "object", required: ["code"], properties: { code: texte(100) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const m = await manifestation(ctx, req.params.id, "marketing.gerer");
      const { rows: [b] } = await ctx.client.query("select id, nom, statut, present_le from billets where manifestation_id = $1 and code = $2 for update", [m.id, req.body.code.trim()]);
      if (!b || b.statut === "annule") throw new ErreurApi(404, "billet_invalide");
      if (b.present_le) throw new ErreurApi(409, "billet_deja_utilise", { nom: b.nom });
      if (Number(m.prix) > 0 && b.statut !== "paye") throw new ErreurApi(409, "billet_non_paye", { nom: b.nom });
      await ctx.client.query("update billets set present_le = now() where id = $1", [b.id]);
      return { entree: true, nom: b.nom };
    }),
  );

  const dansPublic = <T>(code: string, fn: (c: Client, m: Record<string, any>) => Promise<T>) => {
    if (!CODE.test(code)) throw new ErreurApi(404, "introuvable");
    const [org, secret] = code.split(".") as [string, string];
    return dansOrganisation(pool, org, async (c) => {
      const { rows: [m] } = await c.query("select * from manifestations where code = $1 and ouverte and fin > now() for update", [secret]);
      if (!m) throw new ErreurApi(404, "introuvable");
      return fn(c, m);
    }).catch((e) => { if (e.code === "22P02") throw new ErreurApi(404, "introuvable"); throw e; });
  };
  const inscrits = async (c: Client, id: string) => (await c.query("select count(*)::int as n from billets where manifestation_id = $1 and statut <> 'annule'", [id])).rows[0].n as number;
  app.get<{ Params: { code: string } }>("/evenement-public/:code", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) =>
    dansPublic(req.params.code, async (c, m) => ({ titre: m.titre, description: m.description, lieu: m.lieu, debut: m.debut, fin: m.fin, prix: Number(m.prix), intervenants: m.intervenants, places: Math.max(m.capacite - await inscrits(c, m.id), 0) })),
  );
  /** Le verrou sur l'événement empêche de dépasser la capacité. Le billet ne montre que ce que la personne a saisi. */
  app.post<{ Params: { code: string }; Body: { nom: string; telephone?: string; email?: string; consentement: boolean; site?: string } }>("/evenement-public/:code", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: { body: { type: "object", required: ["nom", "consentement"], properties: { nom: texte(), telephone: { type: "string", maxLength: 30 }, email: { type: "string", format: "email", maxLength: 320 }, consentement: { type: "boolean" }, site: { type: "string", maxLength: 200 } } } },
  }, async (req, reponse) => {
    const b = req.body;
    if (b.site) return reponse.status(201).send({ recu: true });
    if (b.consentement !== true) throw new ErreurApi(400, "consentement_obligatoire");
    const tel = b.telephone?.trim() ? normaliserTelephone(b.telephone) : null;
    const email = b.email?.trim().toLowerCase() || null;
    if (!tel && !email) throw new ErreurApi(400, "contact_obligatoire");
    const r = await dansPublic(req.params.code, async (c, m) => {
      if ((await inscrits(c, m.id)) >= m.capacite) throw new ErreurApi(409, "evenement_complet");
      const code = randomBytes(9).toString("base64url");
      const { rows: [d] } = await c.query("select code from billets where manifestation_id = $1 and statut <> 'annule' and ((telephone is not null and telephone = $2) or (email is not null and email = $3)) limit 1", [m.id, tel, email]);
      // La même personne retrouve son billet ; un autre visiteur qui saisit ce contact n'obtient pas le code.
      if (d) return { recu: true };
      await c.query("insert into billets (organisation_id, manifestation_id, nom, telephone, email, code) values ($1, $2, $3, $4, $5, $6)", [m.organisation_id, m.id, b.nom.trim(), tel, email, code]);
      await publierEvenement(c, "billet.reserve", { manifestation: m.id });
      return { recu: true, code, qr_svg: await QRCode.toString(code, { type: "svg", margin: 1 }), prix: Number(m.prix) };
    });
    return reponse.status(201).send(r);
  });

  // Bibliothèque SMARTE : ressources réservées selon le niveau.
  app.post<{ Body: { entiteId: string; titre: string; categorie: string; url: string; niveauMin?: number } }>("/ressources-coaching", {
    schema: { body: { type: "object", required: ["entiteId", "titre", "categorie", "url"], properties: { entiteId: uuid, titre: texte(), categorie: { type: "string", enum: ["ressource", "exercice", "test", "modele"] }, url: { type: "string", pattern: "^https://", maxLength: 1000 }, niveauMin: { type: "integer", minimum: 0, maximum: 20 } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "coaching.gerer", b.entiteId);
      return (await ctx.client.query("insert into ressources_coaching (organisation_id, entite_id, titre, categorie, url, niveau_min) values ($1, $2, $3, $4, $5, $6) returning id", [ctx.organisationId, b.entiteId, b.titre, b.categorie, b.url, b.niveauMin ?? 0])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/ressources-coaching", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "coaching.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "coaching.voir")).map((e) => e.id);
      return (await ctx.client.query("select * from ressources_coaching where entite_id = any($1::uuid[]) and actif order by niveau_min, titre", [ids])).rows;
    }),
  );
  app.post<{ Params: { id: string } }>("/ressources-coaching/:id/retrait", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [r] } = await ctx.client.query("select entite_id from ressources_coaching where id = $1", [req.params.id]);
      if (!r) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "coaching.gerer", r.entite_id);
      await ctx.client.query("update ressources_coaching set actif = false where id = $1", [req.params.id]);
      return { actif: false };
    }),
  );

  // Variantes : chaque variante est un produit à part, avec son prix, son code-barres et son stock.
  app.post<{ Params: { id: string }; Body: { code: string; attributs: Record<string, string>; prixVente?: number; codeBarres?: string } }>("/produits/:id/variantes", {
    schema: { params: paramId, body: { type: "object", required: ["code", "attributs"], properties: { code: texte(60), attributs: { type: "object", minProperties: 1, maxProperties: 5, additionalProperties: texte(60) }, prixVente: { type: "integer", minimum: 0, maximum: 10_000_000_000 }, codeBarres: texte(60) } } },
  }, async (req, reponse) => {
    const v = await protege(req, async (ctx) => {
      const { rows: [p] } = await ctx.client.query("select * from produits where id = $1", [req.params.id]);
      if (!p) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "catalogue.gerer", p.entite_id);
      if (p.parent_id) throw new ErreurApi(409, "variante_de_variante");
      const b = req.body;
      const nom = `${p.nom} ${Object.values(b.attributs).join(" ")}`.slice(0, 200);
      const { rows } = await ctx.client.query(
        `insert into produits (organisation_id, code, nom, type, unite, prix_vente, taux_taxe, suivi_stock, seuil_alerte, stock_cible, entite_id, code_barres, garantie_mois, parent_id, attributs)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id, code, nom, prix_vente, attributs`,
        [ctx.organisationId, b.code, nom, p.type, p.unite, b.prixVente ?? p.prix_vente, p.taux_taxe, p.suivi_stock, p.seuil_alerte, p.stock_cible, p.entite_id, b.codeBarres ?? null, p.garantie_mois, p.id, JSON.stringify(b.attributs)],
      );
      return rows[0];
    });
    return reponse.status(201).send(v);
  });

  // Statistiques de l'université
  app.get<{ Querystring: { annee: string } }>("/universite/statistiques", {
    schema: { querystring: { type: "object", required: ["annee"], properties: { annee: { type: "string", pattern: "^[0-9]{4}-[0-9]{4}$" } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "universite.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "universite.voir")).map((e) => e.id);
      const { rows } = await ctx.client.query(
        `select f.id, f.code, f.nom,
           (select count(*)::int from candidatures_univ c where c.filiere_id = f.id and c.annee = $2) as candidatures,
           (select count(*)::int from inscriptions_univ i where i.filiere_id = f.id and i.annee = $2) as inscrits,
           (select count(*)::int from diplomes d where d.filiere_id = f.id) as diplomes,
           (select coalesce(sum(n.m), 0)::int from (select x.inscription_id, ue_id, max(x.note) as note, 1 as m from notes_univ x join inscriptions_univ i on i.id = x.inscription_id where i.filiere_id = f.id and i.annee = $2 group by x.inscription_id, ue_id having max(x.note) >= f.note_validation) n) as ue_validees,
           (select count(*)::int from (select x.inscription_id, ue_id from notes_univ x join inscriptions_univ i on i.id = x.inscription_id where i.filiere_id = f.id and i.annee = $2 group by x.inscription_id, ue_id) n) as ue_notees,
           (select coalesce(sum(p.montant), 0)::int8 from paiements_univ p join inscriptions_univ i on i.id = p.inscription_id where i.filiere_id = f.id and i.annee = $2 and p.annule_le is null) as recettes
         from filieres f where f.entite_id = any($1::uuid[]) order by f.code`, [ids, req.query.annee],
      );
      const { rows: diplomes } = await ctx.client.query("select d.id, t.nom, t.telephone, t.email, f.nom as filiere from diplomes d join tiers t on t.id = d.tiers_id join filieres f on f.id = d.filiere_id where f.entite_id = any($1::uuid[]) order by t.nom limit 2000", [ids]);
      return { filieres: rows.map((f) => ({ ...f, reussite: f.ue_notees ? Math.round((f.ue_validees * 100) / f.ue_notees) : null })), diplomes };
    }),
  );
}
