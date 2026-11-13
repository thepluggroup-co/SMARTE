import { exigerNonBloque } from "./tiers.js";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import QRCode from "qrcode";
import { dansOrganisation, publierEvenement, type Client } from "./base.js";
import type { Permission } from "./catalogue.js";
import { aPermissionSurEntite, entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";
import { lierTiers } from "./tiers.js";

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const JETON_CERTIFICAT = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{22}$/;

export async function prochainNumero(client: Client, serie: string): Promise<string> {
  const { rows } = await client.query(
    `insert into compteurs (organisation_id, serie, valeur) values (org_courante(), $1, 1)
     on conflict (organisation_id, serie) do update set valeur = compteurs.valeur + 1 returning valeur`,
    [serie],
  );
  return `${serie}-${String(rows[0].valeur).padStart(6, "0")}`;
}

/** Échéances payées dans l'ordre : le plus ancien reste à payer est couvert en premier. */
export function repartir<T extends { montant: number }>(echeances: T[], paye: number) {
  let reste = paye;
  return echeances.map((e) => {
    const couvert = Math.min(e.montant, reste);
    reste -= couvert;
    return { ...e, paye: couvert, solde: e.montant - couvert };
  });
}

async function chiffres(client: Client, inscriptionId: string) {
  const { rows } = await client.query(
    `select
       (select coalesce(sum(montant), 0) from echeances where inscription_id = $1)::int8 as du,
       (select coalesce(sum(montant), 0) from paiements where inscription_id = $1 and annule_le is null)::int8 as paye`,
    [inscriptionId],
  );
  return { du: rows[0].du as number, paye: rows[0].paye as number, reste: rows[0].du - rows[0].paye };
}

/** Une séance compte dès qu'une présence y a été saisie pour un inscrit actif de la session. */
async function tauxPresence(client: Client, inscriptionId: string, sessionId: string): Promise<number | null> {
  const { rows } = await client.query(
    `select
       (select count(distinct p.date_seance) from presences p join inscriptions i on i.id = p.inscription_id
        where i.session_id = $2)::int as seances,
       (select count(*) from presences where inscription_id = $1 and present)::int as presents`,
    [inscriptionId, sessionId],
  );
  return rows[0].seances ? Math.round((rows[0].presents * 100) / rows[0].seances) : null;
}

export function enregistrerFormations(
  app: FastifyInstance, pool: pg.Pool, outils: Outils, urlPublique: string,
): void {
  const { protege, exiger, exigerSurEntite } = outils;

  async function exigerModule(ctx: Contexte, entiteId: string): Promise<void> {
    const { rows } = await ctx.client.query(
      "select actif from modules_entite where entite_id = $1 and module = 'formations'", [entiteId],
    );
    if (!rows[0]?.actif) throw new ErreurApi(409, "module_inactif");
  }

  async function sessionAutorisee(ctx: Contexte, sessionId: string, permission: Permission) {
    const { rows } = await ctx.client.query(
      `select s.*, p.nom as programme, p.plan_paiement, p.seuil_presence
       from sessions_formation s join programmes p on p.id = s.programme_id where s.id = $1`,
      [sessionId],
    );
    if (!rows[0]) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, permission, rows[0].entite_id);
    await exigerModule(ctx, rows[0].entite_id);
    return rows[0];
  }

  async function inscriptionAutorisee(ctx: Contexte, inscriptionId: string, permission: Permission, verrou = false) {
    const { rows } = await ctx.client.query(
      `select i.*, t.nom as apprenant, t.telephone, s.entite_id, s.code as session_code, (s.fin > (now() at time zone 'Africa/Douala')::date and s.statut <> 'terminee') as session_en_cours,
              p.nom as programme, p.seuil_presence
       from inscriptions i join tiers t on t.id = i.tiers_id
       join sessions_formation s on s.id = i.session_id
       join programmes p on p.id = s.programme_id
       where i.id = $1 ${verrou ? "for update of i" : ""}`,
      [inscriptionId],
    );
    if (!rows[0]) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, permission, rows[0].entite_id);
    return rows[0];
  }

  app.post<{
    Body: {
      entiteId: string; code: string; nom: string; description?: string; seuilPresence?: number;
      planPaiement: { libelle: string; montant: number; jours_apres_debut: number }[];
    };
  }>("/programmes", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "code", "nom", "planPaiement"],
        properties: {
          entiteId: uuid,
          code: { type: "string", minLength: 1, maxLength: 40 },
          nom: { type: "string", minLength: 1, maxLength: 200 },
          description: { type: "string", maxLength: 2000 },
          seuilPresence: { type: "integer", minimum: 0, maximum: 100 },
          planPaiement: {
            type: "array", minItems: 1, maxItems: 24,
            items: {
              type: "object", required: ["libelle", "montant", "jours_apres_debut"],
              properties: {
                libelle: { type: "string", minLength: 1, maxLength: 100 },
                montant: { type: "integer", minimum: 1, maximum: 1_000_000_000 },
                jours_apres_debut: { type: "integer", minimum: -365, maximum: 3650 },
              },
            },
          },
        },
      },
    },
  }, async (req, reponse) => {
    const programme = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "formations.gerer", b.entiteId);
      await exigerModule(ctx, b.entiteId);
      const { rows } = await ctx.client.query(
        `insert into programmes (organisation_id, entite_id, code, nom, description, plan_paiement, seuil_presence)
         values ($1, $2, $3, $4, $5, $6, coalesce($7, 75)) returning *`,
        [ctx.organisationId, b.entiteId, b.code, b.nom, b.description ?? null, JSON.stringify(b.planPaiement), b.seuilPresence ?? null],
      );
      return rows[0];
    });
    return reponse.status(201).send(programme);
  });

  app.get("/programmes", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "formations.voir");
      const entites = await entitesAccessibles(ctx.client, ctx.utilisateurId, "formations.voir");
      const { rows } = await ctx.client.query(
        "select * from programmes where entite_id = any($1::uuid[]) and actif order by nom", [entites.map((e) => e.id)],
      );
      return rows;
    }),
  );

  app.post<{
    Body: {
      programmeId: string; code: string; ville: string; lieu?: string; mode?: string;
      debut: string; fin: string; capacite?: number; formateurId?: string;
    };
  }>("/sessions", {
    schema: {
      body: {
        type: "object", required: ["programmeId", "code", "ville", "debut", "fin"],
        properties: {
          programmeId: uuid,
          code: { type: "string", minLength: 1, maxLength: 40 },
          ville: { type: "string", minLength: 1, maxLength: 100 },
          lieu: { type: "string", maxLength: 200 },
          mode: { type: "string", enum: ["presentiel", "en_ligne", "hybride"] },
          debut: date, fin: date,
          capacite: { type: "integer", minimum: 1, maximum: 100000 },
          formateurId: uuid,
        },
      },
    },
  }, async (req, reponse) => {
    const session = await protege(req, async (ctx) => {
      const b = req.body;
      if (b.fin < b.debut) throw new ErreurApi(400, "dates_invalides");
      const p = await ctx.client.query("select entite_id from programmes where id = $1", [b.programmeId]);
      if (!p.rows[0]) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "formations.gerer", p.rows[0].entite_id);
      await exigerModule(ctx, p.rows[0].entite_id);
      const { rows } = await ctx.client.query(
        `insert into sessions_formation (organisation_id, programme_id, entite_id, code, ville, lieu, mode, debut, fin, capacite, formateur_id)
         values ($1, $2, $3, $4, $5, $6, coalesce($7, 'presentiel'), $8, $9, $10, $11) returning *`,
        [ctx.organisationId, b.programmeId, p.rows[0].entite_id, b.code, b.ville, b.lieu ?? null, b.mode ?? null, b.debut, b.fin, b.capacite ?? null, b.formateurId ?? null],
      );
      await publierEvenement(ctx.client, "session.creee", { id: rows[0].id });
      return rows[0];
    });
    return reponse.status(201).send(session);
  });

  app.get("/sessions", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "formations.voir");
      const entites = await entitesAccessibles(ctx.client, ctx.utilisateurId, "formations.voir");
      const { rows } = await ctx.client.query(
        `select s.id, s.code, s.ville, s.lieu, s.mode, s.debut, s.fin, s.capacite, s.statut, p.nom as programme,
           (select count(*) from inscriptions i where i.session_id = s.id and i.statut = 'active')::int as inscrits
         from sessions_formation s join programmes p on p.id = s.programme_id
         where s.entite_id = any($1::uuid[]) order by s.debut desc limit 200`,
        [entites.map((e) => e.id)],
      );
      return rows;
    }),
  );

  /** Le nouveau tarif vaut pour les prochaines inscriptions ; le seuil de présence s'applique aussitôt. */
  app.patch<{
    Params: { id: string };
    Body: {
      nom?: string; description?: string; seuilPresence?: number; actif?: boolean;
      planPaiement?: { libelle: string; montant: number; jours_apres_debut: number }[];
    };
  }>("/programmes/:id", {
    schema: {
      params: paramId,
      body: {
        type: "object", minProperties: 1,
        properties: {
          nom: { type: "string", minLength: 1, maxLength: 200 },
          description: { type: "string", maxLength: 2000 },
          seuilPresence: { type: "integer", minimum: 0, maximum: 100 },
          actif: { type: "boolean" },
          planPaiement: {
            type: "array", minItems: 1, maxItems: 24,
            items: {
              type: "object", required: ["libelle", "montant", "jours_apres_debut"],
              properties: {
                libelle: { type: "string", minLength: 1, maxLength: 100 },
                montant: { type: "integer", minimum: 1, maximum: 1_000_000_000 },
                jours_apres_debut: { type: "integer", minimum: -365, maximum: 3650 },
              },
            },
          },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const p = await ctx.client.query("select entite_id from programmes where id = $1 for update", [req.params.id]);
      if (!p.rows[0]) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "formations.administrer", p.rows[0].entite_id);
      const b = req.body;
      const { rows } = await ctx.client.query(
        `update programmes set nom = coalesce($2, nom), description = coalesce($3, description),
           seuil_presence = coalesce($4, seuil_presence), actif = coalesce($5, actif),
           plan_paiement = coalesce($6::jsonb, plan_paiement)
         where id = $1 returning *`,
        [req.params.id, b.nom ?? null, b.description ?? null, b.seuilPresence ?? null, b.actif ?? null,
          b.planPaiement ? JSON.stringify(b.planPaiement) : null],
      );
      return rows[0];
    }),
  );

  app.patch<{
    Params: { id: string };
    Body: {
      code?: string; ville?: string; lieu?: string; mode?: string; debut?: string; fin?: string;
      capacite?: number | null; statut?: string; formateurId?: string | null;
    };
  }>("/sessions/:id", {
    schema: {
      params: paramId,
      body: {
        type: "object", minProperties: 1,
        properties: {
          code: { type: "string", minLength: 1, maxLength: 40 },
          ville: { type: "string", minLength: 1, maxLength: 100 },
          lieu: { type: "string", maxLength: 200 },
          mode: { type: "string", enum: ["presentiel", "en_ligne", "hybride"] },
          debut: date, fin: date,
          capacite: { type: ["integer", "null"], minimum: 1, maximum: 100000 },
          statut: { type: "string", enum: ["planifiee", "ouverte", "en_cours", "terminee", "annulee"] },
          formateurId: { type: ["string", "null"], format: "uuid" },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const s = await ctx.client.query("select * from sessions_formation where id = $1 for update", [req.params.id]);
      if (!s.rows[0]) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "formations.administrer", s.rows[0].entite_id);
      const b = req.body;
      const debut = b.debut ?? s.rows[0].debut;
      const fin = b.fin ?? s.rows[0].fin;
      if (fin < debut) throw new ErreurApi(400, "dates_invalides");
      const capacite = b.capacite === undefined ? s.rows[0].capacite : b.capacite;
      if (capacite !== null) {
        const n = await ctx.client.query(
          "select count(*)::int as n from inscriptions where session_id = $1 and statut = 'active'", [req.params.id],
        );
        if (capacite < n.rows[0].n) throw new ErreurApi(409, "capacite_inferieure_aux_inscrits", { inscrits: n.rows[0].n });
      }
      const { rows } = await ctx.client.query(
        `update sessions_formation set code = coalesce($2, code), ville = coalesce($3, ville), lieu = coalesce($4, lieu),
           mode = coalesce($5, mode), debut = $6, fin = $7, capacite = $8, statut = coalesce($9, statut),
           formateur_id = $10
         where id = $1 returning *`,
        [req.params.id, b.code ?? null, b.ville ?? null, b.lieu ?? null, b.mode ?? null, debut, fin, capacite, b.statut ?? null,
          b.formateurId === undefined ? s.rows[0].formateur_id : b.formateurId],
      );
      return rows[0];
    }),
  );

  /** Remplace l'échéancier d'un apprenant : remise, report de date ou tranches différentes. */
  app.put<{
    Params: { id: string };
    Body: { motif: string; echeances: { libelle: string; montant: number; date_echeance: string }[] };
  }>("/inscriptions/:id/echeances", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["motif", "echeances"],
        properties: {
          motif: { type: "string", minLength: 5, maxLength: 500 },
          echeances: {
            type: "array", minItems: 1, maxItems: 24,
            items: {
              type: "object", required: ["libelle", "montant", "date_echeance"],
              properties: {
                libelle: { type: "string", minLength: 1, maxLength: 100 },
                montant: { type: "integer", minimum: 1, maximum: 1_000_000_000 },
                date_echeance: date,
              },
            },
          },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      await inscriptionAutorisee(ctx, req.params.id, "formations.administrer", true);
      const { du, paye } = await chiffres(ctx.client, req.params.id);
      const total = req.body.echeances.reduce((s, e) => s + e.montant, 0);
      if (total < paye) throw new ErreurApi(409, "total_inferieur_au_paye", { paye });
      await ctx.client.query("delete from echeances where inscription_id = $1", [req.params.id]);
      let ordre = 1;
      for (const e of req.body.echeances) {
        await ctx.client.query(
          `insert into echeances (organisation_id, inscription_id, ordre, libelle, montant, date_echeance)
           values ($1, $2, $3, $4, $5, $6)`,
          [ctx.organisationId, req.params.id, ordre++, e.libelle, e.montant, e.date_echeance],
        );
      }
      await ctx.client.query("select journal_evenement('echeancier.modifie', $1)", [
        JSON.stringify({ inscription: req.params.id, motif: req.body.motif, ancien_total: du, nouveau_total: total }),
      ]);
      return { total, paye, reste: total - paye };
    }),
  );

  /** Tableau de suivi : qui a payé, quelle tranche, quel reste, quelle présence. */
  app.get<{ Params: { id: string } }>("/sessions/:id/suivi", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const session = await sessionAutorisee(ctx, req.params.id, "formations.voir");
      const { rows: inscrits } = await ctx.client.query(
        `select i.id, i.statut, t.id as tiers_id, t.nom, t.telephone, t.email,
           c.id as certificat_id, c.numero as certificat_numero, c.revoque_le
         from inscriptions i join tiers t on t.id = i.tiers_id
         left join certificats c on c.inscription_id = i.id
         where i.session_id = $1 order by t.nom`,
        [req.params.id],
      );
      const lignes = [];
      for (const i of inscrits) {
        const c = await chiffres(ctx.client, i.id);
        const { rows: echeances } = await ctx.client.query(
          "select ordre, libelle, montant, date_echeance from echeances where inscription_id = $1 order by ordre", [i.id],
        );
        lignes.push({
          ...i, ...c,
          echeances: repartir(echeances, c.paye),
          taux_presence: await tauxPresence(ctx.client, i.id, req.params.id),
        });
      }
      const actifs = lignes.filter((l) => l.statut === "active");
      return {
        session,
        inscrits: lignes,
        totaux: {
          inscrits: actifs.length,
          du: actifs.reduce((s, l) => s + l.du, 0),
          paye: actifs.reduce((s, l) => s + l.paye, 0),
          reste: actifs.reduce((s, l) => s + l.reste, 0),
        },
      };
    }),
  );

  app.post<{ Params: { id: string }; Body: { tiersId: string } }>("/sessions/:id/inscriptions", {
    schema: { params: paramId, body: { type: "object", required: ["tiersId"], properties: { tiersId: uuid } } },
  }, async (req, reponse) => {
    const inscription = await protege(req, async (ctx) => {
      const session = await sessionAutorisee(ctx, req.params.id, "formations.gerer");
      // Le verrou empêche deux inscriptions simultanées de dépasser la capacité.
      const { rows: [frais] } = await ctx.client.query("select statut, capacite from sessions_formation where id = $1 for update", [req.params.id]);
      if (!["ouverte", "en_cours"].includes(frais.statut)) throw new ErreurApi(409, "session_fermee");
      await lierTiers(ctx, req.body.tiersId, session.entite_id);
      if (frais.capacite !== null) {
        const n = await ctx.client.query(
          "select count(*)::int as n from inscriptions where session_id = $1 and statut = 'active'", [req.params.id],
        );
        if (n.rows[0].n >= frais.capacite) throw new ErreurApi(409, "session_complete");
      }
      const { rows } = await ctx.client.query(
        "insert into inscriptions (organisation_id, session_id, tiers_id) values ($1, $2, $3) returning id, session_id, tiers_id, statut",
        [ctx.organisationId, req.params.id, req.body.tiersId],
      );
      let ordre = 1;
      for (const e of session.plan_paiement) {
        await ctx.client.query(
          `insert into echeances (organisation_id, inscription_id, ordre, libelle, montant, date_echeance)
           values ($1, $2, $3, $4, $5, $6::date + $7::int)`,
          [ctx.organisationId, rows[0].id, ordre++, e.libelle, e.montant, session.debut, e.jours_apres_debut],
        );
      }
      await ctx.client.query(
        "update tiers set roles = array_append(roles, 'apprenant') where id = $1 and not ('apprenant' = any(roles))",
        [req.body.tiersId],
      );
      await publierEvenement(ctx.client, "inscription.creee", { id: rows[0].id, sessionId: req.params.id });
      return rows[0];
    });
    return reponse.status(201).send(inscription);
  });

  app.post<{ Params: { id: string }; Body: { statut: string; } }>("/inscriptions/:id/statut", {
    schema: {
      params: paramId,
      body: { type: "object", required: ["statut"], properties: { statut: { type: "string", enum: ["active", "abandon", "annulee"] } } },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const i = await inscriptionAutorisee(ctx, req.params.id, "formations.gerer", true);
      if (req.body.statut === "active" && i.statut !== "active") {
        const { rows: [s] } = await ctx.client.query("select capacite from sessions_formation where id = $1 for update", [i.session_id]);
        const { rows: [n] } = await ctx.client.query("select count(*)::int as n from inscriptions where session_id = $1 and statut = 'active'", [i.session_id]);
        if (s.capacite !== null && n.n >= s.capacite) throw new ErreurApi(409, "session_complete");
      }
      await ctx.client.query("update inscriptions set statut = $2 where id = $1", [req.params.id, req.body.statut]);
      return { statut: req.body.statut };
    }),
  );

  app.post<{
    Params: { id: string };
    Body: { montant: number; moyen: string; reference?: string };
  }>("/inscriptions/:id/paiements", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["montant", "moyen"],
        properties: {
          montant: { type: "integer", minimum: 1, maximum: 1_000_000_000 },
          moyen: { type: "string", enum: ["especes", "mtn_momo", "orange_money", "virement", "cheque", "carte"] },
          reference: { type: "string", maxLength: 100 },
        },
      },
    },
  }, async (req, reponse) => {
    const paiement = await protege(req, async (ctx) => {
      const i = await inscriptionAutorisee(ctx, req.params.id, "paiements.encaisser", true);
      if (i.statut !== "active") throw new ErreurApi(409, "inscription_inactive");
      const b = req.body;
      if (["mtn_momo", "orange_money", "virement", "cheque", "carte"].includes(b.moyen) && !b.reference?.trim()) {
        throw new ErreurApi(400, "reference_obligatoire");
      }
      const { reste } = await chiffres(ctx.client, req.params.id);
      if (b.montant > reste) throw new ErreurApi(409, "montant_superieur_au_reste", { reste });
      if (b.reference?.trim()) {
        const doublon = await ctx.client.query(
          "select numero_recu from paiements where moyen = $1 and reference = $2 and annule_le is null",
          [b.moyen, b.reference.trim()],
        );
        if (doublon.rows[0]) throw new ErreurApi(409, "reference_deja_utilisee", { recu: doublon.rows[0].numero_recu });
      }
      const numero = await prochainNumero(ctx.client, `REC-${new Date().getFullYear()}`);
      const { rows } = await ctx.client.query(
        `insert into paiements (organisation_id, inscription_id, numero_recu, montant, moyen, reference, encaisse_par)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [ctx.organisationId, req.params.id, numero, b.montant, b.moyen, b.reference?.trim() || null, ctx.utilisateurId],
      );
      await publierEvenement(ctx.client, "paiement.recu", { id: rows[0].id, inscriptionId: req.params.id, montant: b.montant });
      return { ...rows[0], reste_apres: reste - b.montant, apprenant: i.apprenant, programme: i.programme, session: i.session_code };
    });
    return reponse.status(201).send(paiement);
  });

  app.get<{ Params: { id: string } }>("/inscriptions/:id/paiements", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await inscriptionAutorisee(ctx, req.params.id, "formations.voir");
      const { rows } = await ctx.client.query(
        `select p.id, p.numero_recu, p.montant, p.moyen, p.reference, p.encaisse_le, p.annule_le, p.motif_annulation,
                u.nom as encaisse_par_nom
         from paiements p join utilisateurs u on u.id = p.encaisse_par
         where p.inscription_id = $1 order by p.encaisse_le desc`,
        [req.params.id],
      );
      return rows;
    }),
  );

  app.post<{ Params: { id: string }; Body: { motif: string } }>("/paiements/:id/annulation", {
    schema: {
      params: paramId,
      body: { type: "object", required: ["motif"], properties: { motif: { type: "string", minLength: 5, maxLength: 500 } } },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const p = await ctx.client.query("select inscription_id, annule_le from paiements where id = $1", [req.params.id]);
      if (!p.rows[0]) throw new ErreurApi(404, "introuvable");
      await inscriptionAutorisee(ctx, p.rows[0].inscription_id, "paiements.annuler");
      if (p.rows[0].annule_le) throw new ErreurApi(409, "deja_annule");
      await ctx.client.query(
        "update paiements set annule_le = now(), annule_par = $2, motif_annulation = $3 where id = $1",
        [req.params.id, ctx.utilisateurId, req.body.motif],
      );
      await publierEvenement(ctx.client, "paiement.annule", { id: req.params.id });
      return { annule: true };
    }),
  );

  /** Fait l'appel d'une séance : tout inscrit actif non cité est noté absent. */
  app.put<{ Params: { id: string }; Body: { date: string; presents: string[] } }>("/sessions/:id/presences", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["date", "presents"],
        properties: { date, presents: { type: "array", items: uuid, maxItems: 5000 } },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const session = await sessionAutorisee(ctx, req.params.id, "presences.saisir");
      if (req.body.date < session.debut || req.body.date > session.fin) throw new ErreurApi(400, "date_hors_session");
      const { rows } = await ctx.client.query(
        "select id from inscriptions where session_id = $1 and statut = 'active'", [req.params.id],
      );
      const actifs = new Set(rows.map((r) => r.id));
      if (req.body.presents.some((id) => !actifs.has(id))) throw new ErreurApi(400, "apprenant_hors_session");
      const presents = new Set(req.body.presents);
      for (const id of actifs) {
        await ctx.client.query(
          `insert into presences (organisation_id, inscription_id, date_seance, present) values ($1, $2, $3, $4)
           on conflict (organisation_id, inscription_id, date_seance) do update set present = excluded.present`,
          [ctx.organisationId, id, req.body.date, presents.has(id)],
        );
      }
      return { date: req.body.date, presents: presents.size, absents: actifs.size - presents.size };
    }),
  );

  app.get<{ Params: { id: string }; Querystring: { date: string } }>("/sessions/:id/presences", {
    schema: { params: paramId, querystring: { type: "object", required: ["date"], properties: { date } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await sessionAutorisee(ctx, req.params.id, "formations.voir");
      const { rows } = await ctx.client.query(
        `select p.inscription_id, p.present from presences p join inscriptions i on i.id = p.inscription_id
         where i.session_id = $1 and p.date_seance = $2`,
        [req.params.id, req.query.date],
      );
      return rows;
    }),
  );

  const vueCertificat = async (c: { code_verification: string; [k: string]: unknown }, organisationId: string) => {
    const url = `${urlPublique}/verifier.html?c=${organisationId}.${c.code_verification}`;
    return { ...c, url_verification: url, qr_svg: await QRCode.toString(url, { type: "svg", margin: 1 }) };
  };

  app.post<{ Params: { id: string }; Body?: { derogation?: string } | null }>("/inscriptions/:id/certificat", {
    schema: {
      params: paramId,
      body: {
        type: ["object", "null"],
        properties: { derogation: { type: "string", minLength: 5, maxLength: 500 } },
      },
    },
  }, async (req, reponse) => {
    const certificat = await protege(req, async (ctx) => {
      const i = await inscriptionAutorisee(ctx, req.params.id, "certificats.delivrer", true);
      if (i.statut !== "active") throw new ErreurApi(409, "inscription_inactive");
      await exigerNonBloque(ctx.client, i.tiers_id, "certificat");
      const derogation = req.body?.derogation?.trim() || null;
      if (derogation) {
        await exigerSurEntite(ctx, "formations.administrer", i.entite_id);
      } else {
        if (i.session_en_cours) throw new ErreurApi(409, "session_non_terminee");
        const { reste } = await chiffres(ctx.client, req.params.id);
        if (reste > 0) throw new ErreurApi(409, "solde_non_regle", { reste });
        const taux = await tauxPresence(ctx.client, req.params.id, i.session_id);
        if (taux === null || taux < i.seuil_presence) {
          throw new ErreurApi(409, "presence_insuffisante", { taux, seuil: i.seuil_presence });
        }
      }
      const numero = await prochainNumero(ctx.client, `CERT-${new Date().getFullYear()}`);
      const { rows } = await ctx.client.query(
        `insert into certificats (organisation_id, inscription_id, numero, code_verification, titulaire, programme, derogation_motif, derogation_par)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
        [ctx.organisationId, req.params.id, numero, randomBytes(16).toString("base64url"), i.apprenant, i.programme,
          derogation, derogation ? ctx.utilisateurId : null],
      );
      await publierEvenement(ctx.client, "certificat.delivre", { id: rows[0].id, inscriptionId: req.params.id });
      return vueCertificat(rows[0], ctx.organisationId);
    });
    return reponse.status(201).send(certificat);
  });

  app.get<{ Params: { id: string } }>("/inscriptions/:id/certificat", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await inscriptionAutorisee(ctx, req.params.id, "formations.voir");
      const { rows } = await ctx.client.query("select * from certificats where inscription_id = $1", [req.params.id]);
      if (!rows[0]) throw new ErreurApi(404, "introuvable");
      return vueCertificat(rows[0], ctx.organisationId);
    }),
  );

  app.post<{ Params: { id: string }; Body: { motif: string } }>("/certificats/:id/revocation", {
    schema: {
      params: paramId,
      body: { type: "object", required: ["motif"], properties: { motif: { type: "string", minLength: 5, maxLength: 500 } } },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const c = await ctx.client.query("select inscription_id from certificats where id = $1", [req.params.id]);
      if (!c.rows[0]) throw new ErreurApi(404, "introuvable");
      await inscriptionAutorisee(ctx, c.rows[0].inscription_id, "certificats.delivrer");
      await ctx.client.query(
        "update certificats set revoque_le = now(), motif_revocation = $2 where id = $1 and revoque_le is null",
        [req.params.id, req.body.motif],
      );
      return { revoque: true };
    }),
  );

  /** Public, sans connexion : ne révèle que ce qui figure déjà sur le certificat. */
  app.get<{ Params: { code: string } }>("/verification/:code", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (req, reponse) => {
    const introuvable = () => reponse.status(404).send({ valide: false });
    if (!JETON_CERTIFICAT.test(req.params.code)) return introuvable();
    const [organisationId, code] = req.params.code.split(".");
    const certificat = await dansOrganisation(pool, organisationId!, async (c) => {
      const { rows } = await c.query(
        `select numero, titulaire, programme, delivre_le, revoque_le is null as valide
         from certificats where code_verification = $1`,
        [code],
      );
      return rows[0];
    }).catch((e) => {
      if (e.code === "22P02") return undefined;
      throw e;
    });
    if (certificat) return certificat;
    // Un certificat de cours en ligne se vérifie à la même adresse.
    const cours = await dansOrganisation(pool, organisationId!, async (c) => (await c.query(
      `select numero, titulaire, cours as programme, delivre_le, revoque_le is null as valide from certificats_cours where code_verification = $1
       union all select numero, titulaire, programme, delivre_le, revoque_le is null from parcours_certification where code_verification = $1
       union all select numero, titulaire, programme, delivre_le, revoque_le is null from diplomes where code_verification = $1`,
      [code],
    )).rows[0]).catch((e) => {
      if (e.code === "22P02") return undefined;
      throw e;
    });
    return cours ?? introuvable();
  });
}
