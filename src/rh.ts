import type { FastifyInstance } from "fastify";
import { publierEvenement } from "./base.js";
import { enregistrerPaie } from "./paie.js";
import { enregistrerPortailRh } from "./portail_rh.js";
import pg from "pg";
import { entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const CONTRATS = ["cdi", "cdd", "stage", "prestataire", "autre"];

/** Mois entiers écoulés entre deux dates au format AAAA-MM-JJ. */
export function moisComplets(debut: string, fin: string): number {
  const [a1, m1, j1] = debut.split("-").map(Number) as [number, number, number];
  const [a2, m2, j2] = fin.split("-").map(Number) as [number, number, number];
  return Math.max((a2 - a1) * 12 + (m2 - m1) - (j2 < j1 ? 1 : 0), 0);
}

/** Dossier de base. Les salaires et les bulletins sont à part, dans paie.ts, avec leur propre droit. */
export function enregistrerRh(app: FastifyInstance, pool: pg.Pool, outils: Outils, cle: Buffer, urlPublique: string, dossier?: string): void {
  const { protege, exiger, exigerSurEntite } = outils;
  enregistrerPaie(app, outils);

  const employe = async (ctx: Contexte, id: string, p: "rh.voir" | "rh.gerer") => {
    const { rows } = await ctx.client.query("select * from employes where id = $1", [id]);
    if (!rows[0]) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, p, rows[0].entite_id);
    return rows[0];
  };

  const creerEmploye = async (ctx: Contexte, b: { entiteId: string; nom: string; poste: string; typeContrat: string; dateEmbauche: string; telephone?: string | null; email?: string | null }) => {
    const { rows: [c] } = await ctx.client.query(
      `insert into compteurs (organisation_id, serie, valeur) values (org_courante(), 'EMP', 1)
       on conflict (organisation_id, serie) do update set valeur = compteurs.valeur + 1 returning valeur`,
    );
    const { rows } = await ctx.client.query(
      `insert into employes (organisation_id, entite_id, matricule, nom, poste, type_contrat, date_embauche, telephone, email)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [ctx.organisationId, b.entiteId, `EMP-${String(c.valeur).padStart(5, "0")}`, b.nom, b.poste, b.typeContrat, b.dateEmbauche, b.telephone ?? null, b.email ?? null],
    );
    return rows[0];
  };

  app.post<{
    Body: { entiteId: string; nom: string; poste: string; typeContrat: string; dateEmbauche: string; telephone?: string; email?: string };
  }>("/employes", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "nom", "poste", "typeContrat", "dateEmbauche"],
        properties: {
          entiteId: uuid, nom: { type: "string", minLength: 1, maxLength: 200 }, poste: { type: "string", minLength: 1, maxLength: 200 },
          typeContrat: { type: "string", enum: CONTRATS }, dateEmbauche: date,
          telephone: { type: "string", maxLength: 30 }, email: { type: "string", format: "email", maxLength: 320 },
        },
      },
    },
  }, async (req, reponse) => {
    const e = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "rh.gerer", b.entiteId);
      return creerEmploye(ctx, b);
    });
    return reponse.status(201).send(e);
  });

  app.get("/employes", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "rh.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "rh.voir")).map((e) => e.id);
      const { rows } = await ctx.client.query(
        `select x.id, x.organisation_id, x.entite_id, x.matricule, x.nom, x.poste, x.type_contrat, x.date_embauche, x.date_sortie, x.telephone, x.email, x.cree_le, x.jours_par_mois, x.solde_initial, x.solde_au, x.utilisateur_id, x.mode_paiement, e.nom as entite,
           exists (select 1 from conges c where c.employe_id = x.id and c.statut = 'approuve'
             and (now() at time zone 'Africa/Douala')::date between c.debut and c.fin) as en_conge
         from employes x join entites e on e.id = x.entite_id
         where x.entite_id = any($1::uuid[]) order by x.date_sortie is not null, x.nom limit 2000`,
        [ids],
      );
      return rows;
    }),
  );

  app.patch<{
    Params: { id: string };
    Body: { nom?: string; poste?: string; typeContrat?: string; telephone?: string; email?: string; dateSortie?: string | null };
  }>("/employes/:id", {
    schema: {
      params: paramId,
      body: {
        type: "object", minProperties: 1,
        properties: {
          nom: { type: "string", minLength: 1, maxLength: 200 }, poste: { type: "string", minLength: 1, maxLength: 200 },
          typeContrat: { type: "string", enum: CONTRATS }, telephone: { type: "string", maxLength: 30 },
          email: { type: "string", format: "email", maxLength: 320 }, dateSortie: { type: ["string", "null"], format: "date" },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const e = await employe(ctx, req.params.id, "rh.gerer");
      const b = req.body;
      const sortie = b.dateSortie === undefined ? e.date_sortie : b.dateSortie;
      if (sortie && sortie < e.date_embauche) throw new ErreurApi(400, "dates_invalides");
      const { rows } = await ctx.client.query(
        `update employes set nom = coalesce($2, nom), poste = coalesce($3, poste), type_contrat = coalesce($4, type_contrat),
           telephone = coalesce($5, telephone), email = coalesce($6, email), date_sortie = $7 where id = $1 returning *`,
        [req.params.id, b.nom ?? null, b.poste ?? null, b.typeContrat ?? null, b.telephone ?? null, b.email ?? null, sortie],
      );
      return rows[0];
    }),
  );

  /** Sans réglage des RH, aucun solde n'est calculé et aucun congé n'est bloqué. */
  const soldeConges = async (ctx: Contexte, e: Record<string, any>) => {
    if (e.jours_par_mois === null || !e.solde_au) return { parametre: false as const };
    const { rows: [t] } = await ctx.client.query(
      `select (now() at time zone 'Africa/Douala')::date as jour,
         coalesce((select sum(fin - debut + 1) from conges where employe_id = $1 and type = 'annuel' and statut = 'approuve' and debut >= $2), 0)::int as pris`,
      [e.id, e.solde_au],
    );
    const fin = e.date_sortie && e.date_sortie < t.jour ? e.date_sortie : t.jour;
    const acquis = Number(e.solde_initial ?? 0) + moisComplets(e.solde_au, fin) * Number(e.jours_par_mois);
    return {
      parametre: true as const, jours_par_mois: Number(e.jours_par_mois), solde_initial: Number(e.solde_initial ?? 0), solde_au: e.solde_au,
      acquis, pris: t.pris as number, solde: Math.round((acquis - t.pris) * 100) / 100,
    };
  };

  enregistrerPortailRh(app, pool, outils, { soldeConges, creerEmploye }, cle, urlPublique, dossier);

  app.get<{ Params: { id: string } }>("/employes/:id/solde-conges", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => soldeConges(ctx, await employe(ctx, req.params.id, "rh.voir"))),
  );

  app.put<{ Params: { id: string }; Body: { joursParMois: number; soldeInitial: number; soldeAu: string } }>("/employes/:id/solde-conges", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["joursParMois", "soldeInitial", "soldeAu"],
        properties: { joursParMois: { type: "number", minimum: 0, maximum: 31 }, soldeInitial: { type: "number", minimum: -365, maximum: 3650 }, soldeAu: date },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      await employe(ctx, req.params.id, "rh.gerer");
      const b = req.body;
      const { rows } = await ctx.client.query(
        "update employes set jours_par_mois = $2, solde_initial = $3, solde_au = $4 where id = $1 returning *",
        [req.params.id, b.joursParMois, b.soldeInitial, b.soldeAu],
      );
      return soldeConges(ctx, rows[0]);
    }),
  );

  /** Saisi par les RH, un jour par employé. Une nouvelle saisie corrige la précédente et reste dans le journal. */
  app.put<{ Params: { id: string }; Body: { jour: string; arrivee: string; depart?: string; note?: string } }>("/employes/:id/pointages", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["jour", "arrivee"],
        properties: {
          jour: date, arrivee: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
          depart: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" }, note: { type: "string", maxLength: 300 },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      await employe(ctx, req.params.id, "rh.gerer");
      const b = req.body;
      if (b.depart && b.depart <= b.arrivee) throw new ErreurApi(400, "heures_invalides");
      const { rows } = await ctx.client.query(
        `insert into pointages (organisation_id, employe_id, jour, arrivee, depart, note, saisi_par) values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (organisation_id, employe_id, jour) do update set arrivee = excluded.arrivee, depart = excluded.depart, note = excluded.note, saisi_par = excluded.saisi_par
         returning *`,
        [ctx.organisationId, req.params.id, b.jour, b.arrivee, b.depart ?? null, b.note ?? null, ctx.utilisateurId],
      );
      return rows[0];
    }),
  );

  app.get<{ Params: { id: string }; Querystring: { mois: string } }>("/employes/:id/pointages", {
    schema: {
      params: paramId,
      querystring: { type: "object", required: ["mois"], properties: { mois: { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" } } },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      await employe(ctx, req.params.id, "rh.voir");
      const { rows } = await ctx.client.query(
        `select jour, to_char(arrivee, 'HH24:MI') as arrivee, to_char(depart, 'HH24:MI') as depart, note,
           (extract(epoch from depart - arrivee) / 60)::int as minutes
         from pointages where employe_id = $1 and to_char(jour, 'YYYY-MM') = $2 order by jour desc`,
        [req.params.id, req.query.mois],
      );
      return { lignes: rows, jours: rows.length, minutes: rows.reduce((s, l) => s + (l.minutes ?? 0), 0) };
    }),
  );

  app.post<{ Params: { id: string }; Body: { type: string; debut: string; fin: string; motif?: string } }>("/employes/:id/conges", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["type", "debut", "fin"],
        properties: {
          type: { type: "string", enum: ["annuel", "maladie", "maternite", "permission", "sans_solde", "autre"] },
          debut: date, fin: date, motif: { type: "string", maxLength: 500 },
        },
      },
    },
  }, async (req, reponse) => {
    const c = await protege(req, async (ctx) => {
      await ctx.client.query("select 1 from employes where id = $1 for update", [req.params.id]);
      await employe(ctx, req.params.id, "rh.gerer");
      const b = req.body;
      if (b.fin < b.debut) throw new ErreurApi(400, "dates_invalides");
      const chevauche = await ctx.client.query(
        `select 1 from conges where employe_id = $1 and statut in ('demande', 'approuve') and debut <= $3 and fin >= $2 limit 1`,
        [req.params.id, b.debut, b.fin],
      );
      if (chevauche.rows[0]) throw new ErreurApi(409, "conge_chevauche");
      const { rows } = await ctx.client.query(
        "insert into conges (organisation_id, employe_id, type, debut, fin, motif) values ($1, $2, $3, $4, $5, $6) returning *",
        [ctx.organisationId, req.params.id, b.type, b.debut, b.fin, b.motif ?? null],
      );
      return rows[0];
    });
    return reponse.status(201).send(c);
  });

  app.get<{ Params: { id: string } }>("/employes/:id/conges", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await employe(ctx, req.params.id, "rh.voir");
      return (await ctx.client.query(
        `select c.*, u.nom as decide_par_nom, (c.fin - c.debut + 1)::int as jours from conges c
         left join utilisateurs u on u.id = c.decide_par where c.employe_id = $1 order by c.debut desc`,
        [req.params.id],
      )).rows;
    }),
  );

  app.post<{ Params: { id: string }; Body: { decision: string; motif?: string; derogation?: string } }>("/conges/:id/decision", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["decision"],
        properties: { decision: { type: "string", enum: ["approuve", "refuse", "annule"] }, motif: { type: "string", minLength: 3, maxLength: 500 }, derogation: { type: "string", minLength: 5, maxLength: 500 } },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [c] } = await ctx.client.query("select * from conges where id = $1 for update", [req.params.id]);
      if (!c) throw new ErreurApi(404, "introuvable");
      await ctx.client.query("select 1 from employes where id = $1 for update", [c.employe_id]);
      const e = await employe(ctx, c.employe_id, "rh.gerer");
      const { decision, motif, derogation } = req.body;
      if (e.utilisateur_id === ctx.utilisateurId && decision === "approuve") throw new ErreurApi(409, "separation_des_taches");
      if (decision === "refuse" && !motif) throw new ErreurApi(400, "motif_obligatoire");
      if (decision === "annule" ? c.statut === "refuse" || c.statut === "annule" : c.statut !== "demande") throw new ErreurApi(409, "deja_decide");
      if (decision === "approuve" && c.type === "annuel" && !derogation) {
        const s = await soldeConges(ctx, e);
        const { rows: [d] } = await ctx.client.query("select ($2::date - $1::date + 1)::int as jours", [c.debut, c.fin]);
        if (s.parametre && d.jours > s.solde) throw new ErreurApi(409, "solde_conges_insuffisant", { solde: s.solde, jours: d.jours });
      }
      const { rows } = await ctx.client.query(
        "update conges set statut = $2, decide_par = $3, decide_le = now(), motif_refus = $4, derogation = $5 where id = $1 returning *",
        [req.params.id, decision, ctx.utilisateurId, motif ?? null, decision === "approuve" ? derogation ?? null : null],
      );
      await publierEvenement(ctx.client, `conge.${decision}`, { id: req.params.id });
      return rows[0];
    }),
  );
}
