import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";

const uuid = { type: "string", format: "uuid" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const montant = { type: "integer", minimum: 1, maximum: 1_000_000_000_000 } as const;
const libelle = { type: "string", minLength: 3, maxLength: 300 } as const;
const reference = { type: "string", maxLength: 200 } as const;
const MOYENS = ["especes", "mtn_momo", "orange_money", "virement", "cheque", "carte"];

export function enregistrerTresorerie(app: FastifyInstance, outils: Outils): void {
  const { protege, exiger, exigerSurEntite } = outils;

  /** Le verrou empêche deux sorties simultanées de dépenser le même argent. */
  const portefeuille = async (ctx: Contexte, id: string, p: "tresorerie.voir" | "tresorerie.gerer", verrou = false) => {
    const { rows } = await ctx.client.query(
      `select x.*, entite_branche(x.entite_id) as branche from portefeuilles x where x.id = $1 ${verrou ? "for update" : ""}`, [id],
    );
    if (!rows[0]) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, p, rows[0].entite_id);
    return rows[0];
  };
  const solde = async (ctx: Contexte, id: string): Promise<number> =>
    (await ctx.client.query("select coalesce(sum(montant), 0)::int8 as s from mouvements_portefeuille where portefeuille_id = $1", [id])).rows[0].s;
  const ecrire = (ctx: Contexte, m: { portefeuille: string; type: string; montant: number; libelle: string; reference?: string | null; transfert?: string; annule?: string }) =>
    ctx.client.query(
      `insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, reference, transfert_id, annule_mouvement_id, auteur_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [ctx.organisationId, m.portefeuille, m.type, m.montant, m.libelle, m.reference ?? null, m.transfert ?? null, m.annule ?? null, ctx.utilisateurId],
    );

  /** Autant de portefeuilles que nécessaire, avec leur solde de départ. */
  app.post<{ Body: { entiteId: string; nom: string; type: string; reference?: string; soldeInitial?: number } }>("/portefeuilles", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "nom", "type"],
        properties: {
          entiteId: uuid, nom: { type: "string", minLength: 1, maxLength: 100 }, reference,
          type: { type: "string", enum: ["especes", "orange_money", "mtn_momo", "banque", "autre"] },
          soldeInitial: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 },
        },
      },
    },
  }, async (req, reponse) => {
    const p = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "tresorerie.gerer", b.entiteId);
      const { rows: [x] } = await ctx.client.query(
        "insert into portefeuilles (organisation_id, entite_id, nom, type, reference) values ($1, $2, $3, $4, $5) returning *",
        [ctx.organisationId, b.entiteId, b.nom, b.type, b.reference?.trim() || null],
      );
      if (b.soldeInitial) await ecrire(ctx, { portefeuille: x.id, type: "ouverture", montant: b.soldeInitial, libelle: "Solde de départ" });
      return { ...x, solde: b.soldeInitial ?? 0 };
    });
    return reponse.status(201).send(p);
  });

  app.get("/portefeuilles", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "tresorerie.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "tresorerie.voir")).map((e) => e.id);
      const { rows } = await ctx.client.query(
        `select x.*, e.nom as entite, e.domaine, entite_branche(x.entite_id) as branche,
           coalesce((select sum(m.montant) from mouvements_portefeuille m where m.portefeuille_id = x.id), 0)::int8 as solde
         from portefeuilles x join entites e on e.id = x.entite_id
         where x.entite_id = any($1::uuid[]) order by not x.actif, e.nom, x.nom`,
        [ids],
      );
      return rows;
    }),
  );

  app.patch<{ Params: { id: string }; Body: { nom?: string; reference?: string; actif?: boolean } }>("/portefeuilles/:id", {
    schema: {
      params: paramId,
      body: { type: "object", minProperties: 1, properties: { nom: { type: "string", minLength: 1, maxLength: 100 }, reference, actif: { type: "boolean" } } },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      await portefeuille(ctx, req.params.id, "tresorerie.gerer", true);
      const b = req.body;
      if (b.actif === false) {
        if ((await solde(ctx, req.params.id)) !== 0) throw new ErreurApi(409, "portefeuille_non_vide");
        await ctx.client.query("delete from portefeuilles_defaut where portefeuille_id = $1", [req.params.id]);
      }
      const { rows } = await ctx.client.query(
        "update portefeuilles set nom = coalesce($2, nom), reference = coalesce($3, reference), actif = coalesce($4, actif) where id = $1 returning *",
        [req.params.id, b.nom ?? null, b.reference ?? null, b.actif ?? null],
      );
      return rows[0];
    }),
  );

  app.get<{ Params: { id: string } }>("/portefeuilles/:id/mouvements", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const p = await portefeuille(ctx, req.params.id, "tresorerie.voir");
      const { rows } = await ctx.client.query(
        `select m.*, u.nom as auteur, exists (select 1 from mouvements_portefeuille a where a.annule_mouvement_id = m.id) as annule
         from mouvements_portefeuille m left join utilisateurs u on u.id = m.auteur_id
         where m.portefeuille_id = $1 order by m.cree_le desc limit 500`,
        [req.params.id],
      );
      return { ...p, solde: await solde(ctx, req.params.id), mouvements: rows };
    }),
  );

  /** Entrée ou dépense saisie à la main. Le portefeuille ne descend jamais sous zéro de cette façon. */
  app.post<{ Params: { id: string }; Body: { sens: string; montant: number; libelle: string; reference?: string } }>("/portefeuilles/:id/mouvements", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["sens", "montant", "libelle"],
        properties: { sens: { type: "string", enum: ["entree", "sortie"] }, montant, libelle, reference },
      },
    },
  }, async (req, reponse) => {
    const m = await protege(req, async (ctx) => {
      const p = await portefeuille(ctx, req.params.id, "tresorerie.gerer", true);
      if (!p.actif) throw new ErreurApi(409, "portefeuille_inactif");
      const b = req.body;
      if (b.sens === "sortie" && b.montant > (await solde(ctx, p.id))) throw new ErreurApi(409, "solde_portefeuille_insuffisant");
      const { rows } = await ecrire(ctx, { portefeuille: p.id, type: b.sens, montant: b.sens === "sortie" ? -b.montant : b.montant, libelle: b.libelle, reference: b.reference?.trim() });
      return rows[0];
    });
    return reponse.status(201).send(m);
  });

  /** Les frais éventuels sortent du portefeuille de départ. GLOMARI et GTA ne se mélangent pas. */
  app.post<{ Body: { deId: string; versId: string; montant: number; frais?: number; libelle?: string; reference?: string } }>("/portefeuilles/transferts", {
    schema: {
      body: {
        type: "object", required: ["deId", "versId", "montant"],
        properties: { deId: uuid, versId: uuid, montant, frais: { type: "integer", minimum: 0, maximum: 1_000_000_000 }, libelle: { type: "string", maxLength: 300 }, reference },
      },
    },
  }, async (req, reponse) => {
    const t = await protege(req, async (ctx) => {
      const b = req.body;
      if (b.deId === b.versId) throw new ErreurApi(400, "transfert_identique");
      // Toujours le même ordre de verrouillage : deux transferts croisés ne se bloquent pas.
      const [a, c] = [b.deId, b.versId].sort() as [string, string];
      const premier = await portefeuille(ctx, a, "tresorerie.gerer", true);
      const second = await portefeuille(ctx, c, "tresorerie.gerer", true);
      const [de, vers] = a === b.deId ? [premier, second] : [second, premier];
      if (!de.actif || !vers.actif) throw new ErreurApi(409, "portefeuille_inactif");
      if (de.branche !== vers.branche) throw new ErreurApi(409, "transfert_autre_branche");
      const frais = b.frais ?? 0;
      if (b.montant + frais > (await solde(ctx, de.id))) throw new ErreurApi(409, "solde_portefeuille_insuffisant");
      const transfert = randomUUID();
      const texte = b.libelle?.trim() || `Transfert de ${de.nom} vers ${vers.nom}`;
      const reference = b.reference?.trim();
      await ecrire(ctx, { portefeuille: de.id, type: "transfert", montant: -b.montant, libelle: texte, reference, transfert });
      await ecrire(ctx, { portefeuille: vers.id, type: "transfert", montant: b.montant, libelle: texte, reference, transfert });
      if (frais) await ecrire(ctx, { portefeuille: de.id, type: "frais", montant: -frais, libelle: `Frais : ${texte}`, reference, transfert });
      return { transfertId: transfert, solde_de: await solde(ctx, de.id), solde_vers: await solde(ctx, vers.id) };
    });
    return reponse.status(201).send(t);
  });

  /** Corrige par une écriture inverse, sans rien effacer. Un encaissement s'annule depuis son reçu ou sa vente. */
  app.post<{ Params: { id: string }; Body: { motif: string } }>("/mouvements-portefeuille/:id/annulation", {
    schema: { params: paramId, body: { type: "object", required: ["motif"], properties: { motif: { type: "string", minLength: 5, maxLength: 300 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [m] } = await ctx.client.query("select * from mouvements_portefeuille where id = $1", [req.params.id]);
      if (!m) throw new ErreurApi(404, "introuvable");
      // Un salaire, une note de frais, un reçu ou un billet s'annule depuis son origine, pour rester cohérent.
      if (["encaissement", "annulation", "ouverture"].includes(m.type) || m.source_type) throw new ErreurApi(409, "mouvement_non_annulable");
      const { rows: lignes } = m.transfert_id
        ? await ctx.client.query("select * from mouvements_portefeuille where transfert_id = $1", [m.transfert_id])
        : { rows: [m] };
      const verrous = [...new Set(lignes.map((l) => l.portefeuille_id as string))].sort();
      for (const id of verrous) await portefeuille(ctx, id, "tresorerie.gerer", true);
      const { rows: deja } = await ctx.client.query("select 1 from mouvements_portefeuille where annule_mouvement_id = any($1::uuid[]) limit 1", [lignes.map((l) => l.id)]);
      if (deja[0]) throw new ErreurApi(409, "deja_annule");
      const effet = new Map<string, number>();
      for (const l of lignes) effet.set(l.portefeuille_id, (effet.get(l.portefeuille_id) ?? 0) - Number(l.montant));
      for (const [id, e] of effet) if ((await solde(ctx, id)) + e < 0) throw new ErreurApi(409, "solde_portefeuille_insuffisant");
      for (const l of lignes) {
        await ecrire(ctx, { portefeuille: l.portefeuille_id, type: "annulation", montant: -Number(l.montant), libelle: `Annulation : ${req.body.motif}`, annule: l.id });
      }
      return { annule: lignes.length };
    }),
  );

  /** Où arrive l'argent encaissé par reçu, facture ou caisse. Sans réglage, aucun portefeuille ne bouge. */
  app.get<{ Querystring: { entiteId: string } }>("/portefeuilles/defauts", {
    schema: { querystring: { type: "object", required: ["entiteId"], properties: { entiteId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [e] } = await ctx.client.query("select entite_branche($1) as branche", [req.query.entiteId]);
      await exigerSurEntite(ctx, "tresorerie.voir", e.branche ?? req.query.entiteId);
      return (await ctx.client.query("select moyen, portefeuille_id from portefeuilles_defaut where entite_id = $1", [req.query.entiteId])).rows;
    }),
  );

  app.put<{ Body: { entiteId: string; moyen: string; portefeuilleId: string | null } }>("/portefeuilles/defauts", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "moyen", "portefeuilleId"],
        properties: { entiteId: uuid, moyen: { type: "string", enum: MOYENS }, portefeuilleId: { type: ["string", "null"], format: "uuid" } },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const b = req.body;
      // Un magasin n'a pas de trésorerie propre : le droit se vérifie sur sa branche.
      const { rows: [branche] } = await ctx.client.query("select entite_branche($1) as branche", [b.entiteId]);
      await exigerSurEntite(ctx, "tresorerie.gerer", branche.branche ?? b.entiteId);
      await ctx.client.query("delete from portefeuilles_defaut where entite_id = $1 and moyen = $2", [b.entiteId, b.moyen]);
      if (b.portefeuilleId) {
        const p = await portefeuille(ctx, b.portefeuilleId, "tresorerie.gerer");
        const { rows: [e] } = await ctx.client.query("select entite_branche($1) as branche", [b.entiteId]);
        if (e.branche !== p.branche) throw new ErreurApi(409, "transfert_autre_branche");
        if (!p.actif) throw new ErreurApi(409, "portefeuille_inactif");
        await ctx.client.query(
          "insert into portefeuilles_defaut (organisation_id, entite_id, moyen, portefeuille_id) values ($1, $2, $3, $4)",
          [ctx.organisationId, b.entiteId, b.moyen, b.portefeuilleId],
        );
      }
      return { moyen: b.moyen, portefeuilleId: b.portefeuilleId };
    }),
  );

  /** Encaissements arrivés sans portefeuille par défaut : ils attendent qu'on dise où est l'argent. */
  app.get("/encaissements-en-attente", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "tresorerie.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "tresorerie.voir")).map((e) => e.id);
      const { rows } = await ctx.client.query(
        `select a.id, a.entite_id, e.nom as entite, e.domaine, entite_branche(a.entite_id) as branche,
           a.moyen, a.montant, a.libelle, a.reference, a.source_type, a.cree_le
         from encaissements_en_attente a join entites e on e.id = a.entite_id
         where a.affecte_le is null and a.annule_le is null and entite_branche(a.entite_id) = any($1::uuid[])
         order by a.cree_le`,
        [ids],
      );
      return rows;
    }),
  );

  /** L'argent entre dans le portefeuille choisi, de la même branche. « parDefaut » règle aussi les suivants. */
  app.post<{ Params: { id: string }; Body: { portefeuilleId: string; parDefaut?: boolean } }>("/encaissements-en-attente/:id/affectation", {
    schema: {
      params: paramId,
      body: { type: "object", required: ["portefeuilleId"], properties: { portefeuilleId: uuid, parDefaut: { type: "boolean" } } },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const { rows: [a] } = await ctx.client.query(
        "select x.*, entite_branche(x.entite_id) as branche from encaissements_en_attente x where x.id = $1 for update", [req.params.id],
      );
      if (!a) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "tresorerie.gerer", a.branche ?? a.entite_id);
      if (a.affecte_le || a.annule_le) throw new ErreurApi(409, "encaissement_deja_traite");
      const p = await portefeuille(ctx, req.body.portefeuilleId, "tresorerie.gerer", true);
      if (p.branche !== a.branche) throw new ErreurApi(409, "transfert_autre_branche");
      if (!p.actif) throw new ErreurApi(409, "portefeuille_inactif");
      // Même forme qu'un encaissement automatique : l'annulation du reçu ou de la vente le contre-passera.
      const { rows: [m] } = await ctx.client.query(
        `insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, reference, source_type, source_id, auteur_id)
         values ($1, $2, 'encaissement', $3, $4, $5, $6, $7, $8) returning *`,
        [ctx.organisationId, p.id, a.montant, a.libelle, a.reference, a.source_type, a.source_id, ctx.utilisateurId],
      );
      await ctx.client.query(
        "update encaissements_en_attente set affecte_le = now(), mouvement_id = $2, affecte_par = $3 where id = $1",
        [a.id, m.id, ctx.utilisateurId],
      );
      if (req.body.parDefaut && MOYENS.includes(a.moyen)) {
        await ctx.client.query("delete from portefeuilles_defaut where entite_id = $1 and moyen = $2", [a.entite_id, a.moyen]);
        await ctx.client.query(
          "insert into portefeuilles_defaut (organisation_id, entite_id, moyen, portefeuille_id) values ($1, $2, $3, $4)",
          [ctx.organisationId, a.entite_id, a.moyen, p.id],
        );
      }
      return { mouvementId: m.id, solde: await solde(ctx, p.id) };
    });
    return reponse.status(201).send(r);
  });
}
