import type { FastifyInstance } from "fastify";
import { entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Outils } from "./serveur.js";

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max = 300) => ({ type: "string", minLength: 1, maxLength: max }) as const;
const qB = { querystring: { type: "object", required: ["brancheId"], properties: { brancheId: uuid } } } as const;

/** Échéances proposées pour une année, à confirmer par l'expert-comptable selon le centre des impôts. */
export function calendrierPropose(annee: number): { libelle: string; jour: string }[] {
  const r: { libelle: string; jour: string }[] = [];
  for (let m = 1; m <= 12; m++) r.push({ libelle: `Déclaration mensuelle des impôts et taxes ${String(m).padStart(2, "0")}/${annee}`, jour: new Date(Date.UTC(m === 12 ? annee + 1 : annee, m === 12 ? 0 : m, 15)).toISOString().slice(0, 10) });
  r.push({ libelle: `DSF ${annee}, centre DGE`, jour: `${annee + 1}-03-15` }, { libelle: `DSF ${annee}, centre CIME`, jour: `${annee + 1}-04-15` }, { libelle: `DSF ${annee}, centre CDI`, jour: `${annee + 1}-05-15` });
  return r;
}

export function enregistrerFiscalite(app: FastifyInstance, outils: Outils): void {
  const { protege, exigerSurEntite, exiger } = outils;

  // Modèles d'écritures
  app.get<{ Querystring: { brancheId: string } }>("/compta/modeles", { schema: qB }, async (req) =>
    protege(req, async (ctx) => { await exigerSurEntite(ctx, "compta.voir", req.query.brancheId); return (await ctx.client.query("select * from modeles_ecriture where branche_id = $1 order by nom", [req.query.brancheId])).rows; }),
  );
  app.post<{ Body: { brancheId: string; nom: string; journal: string; lignes: { numero: string; debit?: number; credit?: number }[] } }>("/compta/modeles", {
    schema: { body: { type: "object", required: ["brancheId", "nom", "journal", "lignes"], properties: { brancheId: uuid, nom: texte(100), journal: texte(6), lignes: { type: "array", minItems: 2, maxItems: 50, items: { type: "object", required: ["numero"], additionalProperties: false, properties: { numero: { type: "string", pattern: "^[1-9][0-9]{1,11}$" }, debit: { type: "integer", minimum: 0 }, credit: { type: "integer", minimum: 0 } } } } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "compta.saisir", b.brancheId);
      const d = b.lignes.reduce((s, l) => s + (l.debit ?? 0), 0), c = b.lignes.reduce((s, l) => s + (l.credit ?? 0), 0);
      if (d !== c) throw new ErreurApi(409, "ecriture_desequilibree", { debit: d, credit: c });
      return (await ctx.client.query("insert into modeles_ecriture (organisation_id, branche_id, nom, journal, lignes) values ($1, $2, $3, $4, $5) returning id", [ctx.organisationId, b.brancheId, b.nom, b.journal, JSON.stringify(b.lignes)])).rows[0];
    });
    return reponse.status(201).send(r);
  });

  // Calendrier fiscal
  app.get<{ Querystring: { brancheId: string } }>("/compta/calendrier-fiscal", { schema: qB }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "compta.voir", req.query.brancheId);
      return (await ctx.client.query("select id, libelle, jour::text, faite_le, jour < (now() at time zone 'Africa/Douala')::date and faite_le is null as en_retard from echeances_fiscales where branche_id = $1 order by faite_le is not null, jour limit 200", [req.query.brancheId])).rows;
    }),
  );
  app.post<{ Body: { brancheId: string; annee: number } }>("/compta/calendrier-fiscal/proposition", {
    schema: { body: { type: "object", required: ["brancheId", "annee"], properties: { brancheId: uuid, annee: { type: "integer", minimum: 2000, maximum: 2100 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "compta.cloturer", req.body.brancheId);
      let crees = 0;
      for (const e of calendrierPropose(req.body.annee)) {
        const { rowCount } = await ctx.client.query("insert into echeances_fiscales (organisation_id, branche_id, libelle, jour) values ($1, $2, $3, $4) on conflict do nothing", [ctx.organisationId, req.body.brancheId, e.libelle, e.jour]);
        crees += rowCount ?? 0;
      }
      return { crees };
    }),
  );
  app.post<{ Body: { brancheId: string; libelle: string; jour: string } }>("/compta/calendrier-fiscal", {
    schema: { body: { type: "object", required: ["brancheId", "libelle", "jour"], properties: { brancheId: uuid, libelle: texte(), jour: date } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "compta.cloturer", req.body.brancheId);
      return (await ctx.client.query("insert into echeances_fiscales (organisation_id, branche_id, libelle, jour) values ($1, $2, $3, $4) returning id", [ctx.organisationId, req.body.brancheId, req.body.libelle, req.body.jour])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.post<{ Params: { id: string } }>("/compta/calendrier-fiscal/:id/faite", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [e] } = await ctx.client.query("select branche_id from echeances_fiscales where id = $1", [req.params.id]);
      if (!e) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "compta.cloturer", e.branche_id);
      await ctx.client.query("update echeances_fiscales set faite_le = now(), faite_par = $2 where id = $1", [req.params.id, ctx.utilisateurId]);
      return { faite: true };
    }),
  );

  // Balance âgée des fournisseurs
  app.get<{ Querystring: { brancheId: string } }>("/fournisseurs/balance-agee", { schema: qB }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "compta.voir", req.query.brancheId);
      const { rows } = await ctx.client.query(
        `with f as (select x.fournisseur_id, (now() at time zone 'Africa/Douala')::date - coalesce(x.date_echeance, x.date_facture) as retard, x.total_ttc - (select coalesce(sum(p.montant), 0) from paiements_fournisseur p where p.facture_id = x.id and p.annule_le is null) as reste
           from factures_fournisseur x where x.statut = 'validee' and entite_branche(x.entite_id) = $1)
         select t.nom, sum(f.reste)::int8 as total, coalesce(sum(f.reste) filter (where f.retard <= 0), 0)::int8 as non_echu, coalesce(sum(f.reste) filter (where f.retard between 1 and 30), 0)::int8 as j30, coalesce(sum(f.reste) filter (where f.retard between 31 and 60), 0)::int8 as j60, coalesce(sum(f.reste) filter (where f.retard > 60), 0)::int8 as plus
         from f join tiers t on t.id = f.fournisseur_id where f.reste > 0 group by t.id, t.nom order by total desc limit 500`, [req.query.brancheId],
      );
      return rows;
    }),
  );

  // Inventaire physique des immobilisations
  app.post<{ Params: { id: string }; Body: { jour: string; present: boolean; note?: string } }>("/immobilisations/:id/inventaire", {
    schema: { params: paramId, body: { type: "object", required: ["jour", "present"], properties: { jour: date, present: { type: "boolean" }, note: texte(500) } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const { rows: [i] } = await ctx.client.query("select entite_id from immobilisations where id = $1", [req.params.id]);
      if (!i) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "compta.saisir", i.entite_id);
      return (await ctx.client.query("insert into inventaires_immo (organisation_id, immobilisation_id, jour, present, note, auteur_id) values ($1, $2, $3, $4, $5, $6) returning id", [ctx.organisationId, req.params.id, req.body.jour, req.body.present, req.body.note ?? null, ctx.utilisateurId])).rows[0];
    });
    return reponse.status(201).send(r);
  });

  // Refacturation entre branches : brouillons des deux côtés, éliminée du cumul.
  app.post<{ Body: { deBranche: string; versBranche: string; jour: string; libelle: string; montant: number } }>("/compta/refacturations", {
    schema: { body: { type: "object", required: ["deBranche", "versBranche", "jour", "libelle", "montant"], properties: { deBranche: uuid, versBranche: uuid, jour: date, libelle: texte(), montant: { type: "integer", minimum: 1, maximum: 1_000_000_000_000 } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      await exiger(ctx, "utilisateurs.gerer");
      const b = req.body;
      if (b.deBranche === b.versBranche) throw new ErreurApi(400, "branches_identiques");
      return (await ctx.client.query("insert into refacturations_internes (organisation_id, de_branche, vers_branche, jour, libelle, montant, auteur_id) values ($1, $2, $3, $4, $5, $6, $7) returning id", [ctx.organisationId, b.deBranche, b.versBranche, b.jour, b.libelle, b.montant, ctx.utilisateurId])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/compta/refacturations", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "compta.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "compta.voir")).map((e) => e.id);
      return (await ctx.client.query("select r.id, r.jour::text, r.libelle, r.montant, a.nom as de, b.nom as vers from refacturations_internes r join entites a on a.id = r.de_branche join entites b on b.id = r.vers_branche where r.de_branche = any($1::uuid[]) or r.vers_branche = any($1::uuid[]) order by r.jour desc limit 200", [ids])).rows;
    }),
  );
}
