import type { FastifyInstance } from "fastify";
import { publierEvenement } from "./base.js";
import { prochainNumero } from "./formations.js";
import { entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";
import { lierTiers } from "./tiers.js";

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max: number) => ({ type: "string", minLength: 1, maxLength: max }) as const;
const motifBody = { type: "object", required: ["motif"], properties: { motif: { type: "string", minLength: 5, maxLength: 500 } } } as const;

export function enregistrerImpact(app: FastifyInstance, outils: Outils): void {
  const { protege, exiger, exigerSurEntite } = outils;

  const exigerModule = async (ctx: Contexte, entiteId: string, module: string) => {
    const { rows } = await ctx.client.query(
      "select actif from modules_entite where entite_id = $1 and module = $2", [entiteId, module],
    );
    if (!rows[0]?.actif) throw new ErreurApi(409, "module_inactif");
  };

  app.post<{
    Body: { entiteId: string; mentorId: string; mentoreId: string; objectif: string; debut: string; fin?: string };
  }>("/mentorats", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "mentorId", "mentoreId", "objectif", "debut"],
        properties: { entiteId: uuid, mentorId: uuid, mentoreId: uuid, objectif: texte(1000), debut: date, fin: date },
      },
    },
  }, async (req, reponse) => {
    const m = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "mentorat.gerer", b.entiteId);
      await exigerModule(ctx, b.entiteId, "mentorat");
      if (b.mentorId === b.mentoreId) throw new ErreurApi(400, "mentor_identique");
      if (b.fin && b.fin < b.debut) throw new ErreurApi(400, "dates_invalides");
      await lierTiers(ctx, b.mentorId, b.entiteId);
      await lierTiers(ctx, b.mentoreId, b.entiteId);
      const { rows } = await ctx.client.query(
        `insert into mentorats (organisation_id, entite_id, mentor_id, mentore_id, objectif, debut, fin)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [ctx.organisationId, b.entiteId, b.mentorId, b.mentoreId, b.objectif, b.debut, b.fin ?? null],
      );
      await publierEvenement(ctx.client, "mentorat.cree", { id: rows[0].id });
      return rows[0];
    });
    return reponse.status(201).send(m);
  });

  app.get("/mentorats", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "mentorat.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "mentorat.voir")).map((e) => e.id);
      const { rows } = await ctx.client.query(
        `select m.id, m.objectif, m.statut, m.debut, m.fin, m.entite_id, a.nom as mentor, b.nom as mentore,
           (select count(*) from seances_mentorat s where s.mentorat_id = m.id)::int as seances,
           (select max(s.date_seance) from seances_mentorat s where s.mentorat_id = m.id) as derniere_seance
         from mentorats m join tiers a on a.id = m.mentor_id join tiers b on b.id = m.mentore_id
         where m.entite_id = any($1::uuid[]) order by m.statut, m.debut desc limit 500`,
        [ids],
      );
      return rows;
    }),
  );

  const mentorat = async (ctx: Contexte, id: string, p: "mentorat.voir" | "mentorat.gerer") => {
    const { rows } = await ctx.client.query(
      `select m.*, a.nom as mentor, b.nom as mentore from mentorats m
       join tiers a on a.id = m.mentor_id join tiers b on b.id = m.mentore_id where m.id = $1`,
      [id],
    );
    if (!rows[0]) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, p, rows[0].entite_id);
    return rows[0];
  };

  /** Les comptes rendus sont confidentiels : seul un droit de gestion les ouvre. */
  app.get<{ Params: { id: string } }>("/mentorats/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const m = await mentorat(ctx, req.params.id, "mentorat.voir");
      let confidentiel = true;
      try {
        await exigerSurEntite(ctx, "mentorat.gerer", m.entite_id);
      } catch {
        confidentiel = false;
      }
      const { rows } = await ctx.client.query(
        `select s.id, s.date_seance, s.progres, s.prochaine_action, s.compte_rendu, u.nom as auteur
         from seances_mentorat s join utilisateurs u on u.id = s.auteur_id
         where s.mentorat_id = $1 order by s.date_seance desc`,
        [req.params.id],
      );
      return {
        ...m,
        seances: rows.map((s) => confidentiel ? s : { id: s.id, date_seance: s.date_seance, progres: s.progres }),
      };
    }),
  );

  app.patch<{ Params: { id: string }; Body: { statut?: string; objectif?: string; fin?: string | null } }>("/mentorats/:id", {
    schema: {
      params: paramId,
      body: {
        type: "object", minProperties: 1,
        properties: {
          statut: { type: "string", enum: ["actif", "suspendu", "termine"] },
          objectif: texte(1000), fin: { type: ["string", "null"], format: "date" },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const m = await mentorat(ctx, req.params.id, "mentorat.gerer");
      const b = req.body;
      const fin = b.fin === undefined ? m.fin : b.fin;
      if (fin && fin < m.debut) throw new ErreurApi(400, "dates_invalides");
      const { rows } = await ctx.client.query(
        "update mentorats set statut = coalesce($2, statut), objectif = coalesce($3, objectif), fin = $4 where id = $1 returning *",
        [req.params.id, b.statut ?? null, b.objectif ?? null, fin],
      );
      return rows[0];
    }),
  );

  app.post<{
    Params: { id: string };
    Body: { date: string; compteRendu: string; progres?: number; prochaineAction?: string };
  }>("/mentorats/:id/seances", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["date", "compteRendu"],
        properties: {
          date, compteRendu: texte(5000),
          progres: { type: "integer", minimum: 1, maximum: 5 },
          prochaineAction: { type: "string", maxLength: 500 },
        },
      },
    },
  }, async (req, reponse) => {
    const s = await protege(req, async (ctx) => {
      const m = await mentorat(ctx, req.params.id, "mentorat.gerer");
      if (m.statut !== "actif") throw new ErreurApi(409, "mentorat_inactif");
      const b = req.body;
      if (b.date < m.debut) throw new ErreurApi(400, "dates_invalides");
      const { rows } = await ctx.client.query(
        `insert into seances_mentorat (organisation_id, mentorat_id, date_seance, compte_rendu, progres, prochaine_action, auteur_id)
         values ($1, $2, $3, $4, $5, $6, $7) returning id, date_seance, progres`,
        [ctx.organisationId, req.params.id, b.date, b.compteRendu, b.progres ?? null, b.prochaineAction ?? null, ctx.utilisateurId],
      );
      return rows[0];
    });
    return reponse.status(201).send(s);
  });

  app.post<{ Body: { entiteId: string; nom: string; description?: string; objectifMontant?: number } }>("/projets-sociaux", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "nom"],
        properties: {
          entiteId: uuid, nom: texte(200), description: { type: "string", maxLength: 2000 },
          objectifMontant: { type: "integer", minimum: 1, maximum: 1_000_000_000_000 },
        },
      },
    },
  }, async (req, reponse) => {
    const p = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "foundation.gerer", b.entiteId);
      await exigerModule(ctx, b.entiteId, "foundation");
      const { rows } = await ctx.client.query(
        `insert into projets_sociaux (organisation_id, entite_id, nom, description, objectif_montant)
         values ($1, $2, $3, $4, $5) returning *`,
        [ctx.organisationId, b.entiteId, b.nom, b.description ?? null, b.objectifMontant ?? null],
      );
      return rows[0];
    });
    return reponse.status(201).send(p);
  });

  const COLLECTE = "(select coalesce(sum(d.montant), 0) from dons d where d.projet_id = p.id and d.annule_le is null)::int8";
  const DISTRIBUE = "(select coalesce(sum(a.montant), 0) from aides_beneficiaires a where a.projet_id = p.id and a.annule_le is null)::int8";
  const NB_BENEF = "(select count(distinct a.beneficiaire_id) from aides_beneficiaires a where a.projet_id = p.id and a.annule_le is null)::int";

  app.get("/projets-sociaux", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "foundation.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "foundation.voir")).map((e) => e.id);
      const { rows } = await ctx.client.query(
        `select p.*, ${COLLECTE} as collecte, ${DISTRIBUE} as distribue, ${NB_BENEF} as beneficiaires
         from projets_sociaux p where p.entite_id = any($1::uuid[]) order by p.statut, p.nom limit 200`,
        [ids],
      );
      return rows;
    }),
  );

  const projet = async (ctx: Contexte, id: string, p: "foundation.voir" | "foundation.gerer", verrou = false) => {
    // Verrouiller d'abord : les soldes lus ensuite tiennent compte des opérations simultanées.
    if (verrou) await ctx.client.query("select 1 from projets_sociaux where id = $1 for update", [id]);
    const { rows } = await ctx.client.query(
      `select p.*, ${COLLECTE} as collecte, ${DISTRIBUE} as distribue, ${NB_BENEF} as beneficiaires
       from projets_sociaux p where p.id = $1`,
      [id],
    );
    if (!rows[0]) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, p, rows[0].entite_id);
    return rows[0];
  };

  /**
   * Rapport à montrer à un donateur : des totaux uniquement, sans aucun nom.
   * Le détail nominatif exige le droit de gestion.
   */
  app.get<{ Params: { id: string } }>("/projets-sociaux/:id/rapport", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const p = await projet(ctx, req.params.id, "foundation.voir");
      return {
        entite_id: p.entite_id, nom: p.nom, description: p.description, statut: p.statut, objectif: p.objectif_montant,
        collecte: p.collecte, distribue: p.distribue, disponible: p.collecte - p.distribue, beneficiaires: p.beneficiaires,
        atteinte_objectif: p.objectif_montant ? Math.round((p.collecte * 100) / p.objectif_montant) : null,
      };
    }),
  );

  app.get<{ Params: { id: string } }>("/projets-sociaux/:id/detail", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await projet(ctx, req.params.id, "foundation.gerer");
      const dons = await ctx.client.query(
        `select d.id, d.numero_recu, d.montant, d.moyen, d.reference, d.encaisse_le, d.annule_le, d.motif_annulation,
           t.nom as donateur
         from dons d left join tiers t on t.id = d.donateur_id where d.projet_id = $1 order by d.encaisse_le desc`,
        [req.params.id],
      );
      const aides = await ctx.client.query(
        `select a.id, a.description, a.montant, a.date_aide, a.annule_le, a.motif_annulation, t.nom as beneficiaire
         from aides_beneficiaires a join tiers t on t.id = a.beneficiaire_id where a.projet_id = $1 order by a.date_aide desc`,
        [req.params.id],
      );
      return { dons: dons.rows, aides: aides.rows };
    }),
  );

  app.post<{
    Params: { id: string };
    Body: { montant: number; moyen: string; reference?: string; donateurId?: string };
  }>("/projets-sociaux/:id/dons", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["montant", "moyen"],
        properties: {
          montant: { type: "integer", minimum: 1, maximum: 1_000_000_000_000 },
          moyen: { type: "string", enum: ["especes", "mtn_momo", "orange_money", "virement", "cheque", "carte", "nature"] },
          reference: { type: "string", maxLength: 100 }, donateurId: uuid,
        },
      },
    },
  }, async (req, reponse) => {
    const d = await protege(req, async (ctx) => {
      const p = await projet(ctx, req.params.id, "foundation.gerer", true);
      if (p.statut !== "actif") throw new ErreurApi(409, "projet_clos");
      const b = req.body;
      if (["mtn_momo", "orange_money", "virement", "cheque", "carte"].includes(b.moyen) && !b.reference?.trim()) {
        throw new ErreurApi(400, "reference_obligatoire");
      }
      if (b.donateurId) await lierTiers(ctx, b.donateurId, p.entite_id);
      const numero = await prochainNumero(ctx.client, `DON-${new Date().getFullYear()}`);
      const { rows } = await ctx.client.query(
        `insert into dons (organisation_id, projet_id, numero_recu, donateur_id, montant, moyen, reference, encaisse_par)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
        [ctx.organisationId, req.params.id, numero, b.donateurId ?? null, b.montant, b.moyen, b.reference?.trim() || null, ctx.utilisateurId],
      );
      await publierEvenement(ctx.client, "don.recu", { id: rows[0].id, projetId: req.params.id });
      return rows[0];
    });
    return reponse.status(201).send(d);
  });

  app.post<{ Params: { id: string }; Body: { motif: string } }>("/dons/:id/annulation", {
    schema: { params: paramId, body: motifBody },
  }, async (req) =>
    protege(req, async (ctx) => {
      const d = await ctx.client.query("select projet_id, montant, annule_le from dons where id = $1", [req.params.id]);
      if (!d.rows[0]) throw new ErreurApi(404, "introuvable");
      const p = await projet(ctx, d.rows[0].projet_id, "foundation.gerer", true);
      if (d.rows[0].annule_le) throw new ErreurApi(409, "deja_annule");
      // L'argent déjà distribué doit rester couvert par les dons restants.
      if (p.collecte - d.rows[0].montant < p.distribue) throw new ErreurApi(409, "solde_insuffisant");
      await ctx.client.query("update dons set annule_le = now(), motif_annulation = $2 where id = $1", [req.params.id, req.body.motif]);
      return { annule: true };
    }),
  );

  app.post<{
    Params: { id: string };
    Body: { beneficiaireId: string; description: string; montant?: number; date: string };
  }>("/projets-sociaux/:id/aides", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["beneficiaireId", "description", "date"],
        properties: {
          beneficiaireId: uuid, description: texte(1000), date,
          montant: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 },
        },
      },
    },
  }, async (req, reponse) => {
    const a = await protege(req, async (ctx) => {
      const p = await projet(ctx, req.params.id, "foundation.gerer", true);
      if (p.statut !== "actif") throw new ErreurApi(409, "projet_clos");
      const b = req.body;
      await lierTiers(ctx, b.beneficiaireId, p.entite_id);
      const montant = b.montant ?? 0;
      const disponible = p.collecte - p.distribue;
      if (montant > disponible) throw new ErreurApi(409, "solde_insuffisant", { disponible });
      const { rows } = await ctx.client.query(
        `insert into aides_beneficiaires (organisation_id, projet_id, beneficiaire_id, description, montant, date_aide, saisi_par)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [ctx.organisationId, req.params.id, b.beneficiaireId, b.description, montant, b.date, ctx.utilisateurId],
      );
      return rows[0];
    });
    return reponse.status(201).send(a);
  });

  app.post<{ Params: { id: string }; Body: { motif: string } }>("/aides/:id/annulation", {
    schema: { params: paramId, body: motifBody },
  }, async (req) =>
    protege(req, async (ctx) => {
      const a = await ctx.client.query("select projet_id, annule_le from aides_beneficiaires where id = $1", [req.params.id]);
      if (!a.rows[0]) throw new ErreurApi(404, "introuvable");
      await projet(ctx, a.rows[0].projet_id, "foundation.gerer", true);
      if (a.rows[0].annule_le) throw new ErreurApi(409, "deja_annule");
      await ctx.client.query("update aides_beneficiaires set annule_le = now(), motif_annulation = $2 where id = $1", [req.params.id, req.body.motif]);
      return { annule: true };
    }),
  );
}
