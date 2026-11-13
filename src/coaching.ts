import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import QRCode from "qrcode";
import { prochainNumero } from "./formations.js";
import { entitesAccessibles } from "./permissions.js";
import { chiffrer, dechiffrer } from "./securite.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";
import { lierTiers } from "./tiers.js";

const uuid = { type: "string", format: "uuid" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max: number) => ({ type: "string", minLength: 1, maxLength: max }) as const;

/** Répartit un revenu sur les coachs au-dessus de lui. Sans taux réglé à une profondeur, rien n'y est dû. */
export function repartirRedevances(montant: number, lignee: string[], taux: Map<number, number>) {
  return lignee.flatMap((beneficiaire, i) => {
    const t = taux.get(i + 1);
    return t ? [{ beneficiaire, profondeur: i + 1, taux: t, montant: Math.round((montant * t) / 100) }] : [];
  });
}

export function enregistrerCoaching(app: FastifyInstance, outils: Outils, cle: Buffer, urlPublique: string): void {
  const { protege, exiger, exigerSurEntite } = outils;

  /** La lignée s'arrête au sommet ; le verrou empêche deux rattachements croisés de créer une boucle. */
  const lignee = async (ctx: Contexte, coachId: string): Promise<string[]> => {
    const { rows } = await ctx.client.query(
      `with recursive l as (
         select parent_id, 1 as n from coachs where id = $1
         union all select c.parent_id, l.n + 1 from coachs c join l on c.id = l.parent_id where l.n < 50
       ) select parent_id from l where parent_id is not null order by n`,
      [coachId],
    );
    return rows.map((r) => r.parent_id);
  };

  app.post<{ Body: { entiteId: string; tiersId: string; utilisateurId?: string; parentId?: string } }>("/coachs", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "tiersId"],
        properties: { entiteId: uuid, tiersId: uuid, utilisateurId: uuid, parentId: uuid },
      },
    },
  }, async (req, reponse) => {
    const c = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "coaching.gerer", b.entiteId);
      await lierTiers(ctx, b.tiersId, b.entiteId);
      if (b.parentId) {
        const p = await ctx.client.query("select 1 from coachs where id = $1 and entite_id = $2", [b.parentId, b.entiteId]);
        if (!p.rows[0]) throw new ErreurApi(404, "introuvable");
      }
      const { rows } = await ctx.client.query(
        "insert into coachs (organisation_id, entite_id, tiers_id, utilisateur_id, parent_id) values ($1, $2, $3, $4, $5) returning *",
        [ctx.organisationId, b.entiteId, b.tiersId, b.utilisateurId ?? null, b.parentId ?? null],
      );
      return rows[0];
    });
    return reponse.status(201).send(c);
  });

  /** Annuaire du réseau, avec la licence en cours et ce que chacun a formé. */
  app.get("/coachs", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "coaching.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "coaching.voir")).map((e) => e.id);
      const { rows } = await ctx.client.query(
        `select c.id, c.entite_id, c.parent_id, c.actif, c.utilisateur_id, t.nom, t.telephone,
           (select max(l.fin) from licences_coach l where l.coach_id = c.id) as licence_fin,
           (select count(*) from coachs f where f.parent_id = c.id)::int as formes,
           (select coalesce(sum(r.montant), 0)::int8 from redevances r where r.beneficiaire_id = c.id) as redevances_dues
         from coachs c join tiers t on t.id = c.tiers_id where c.entite_id = any($1::uuid[]) order by t.nom limit 2000`,
        [ids],
      );
      return rows;
    }),
  );

  const coachGere = async (ctx: Contexte, id: string) => {
    const { rows } = await ctx.client.query("select * from coachs where id = $1", [id]);
    if (!rows[0]) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, "coaching.gerer", rows[0].entite_id);
    return rows[0];
  };

  app.post<{ Params: { id: string }; Body: { debut: string; fin: string; montant: number } }>("/coachs/:id/licences", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["debut", "fin", "montant"],
        properties: { debut: { type: "string", format: "date" }, fin: { type: "string", format: "date" }, montant: { type: "integer", minimum: 0, maximum: 100_000_000_000 } },
      },
    },
  }, async (req, reponse) => {
    const l = await protege(req, async (ctx) => {
      await coachGere(ctx, req.params.id);
      if (req.body.fin <= req.body.debut) throw new ErreurApi(400, "dates_invalides");
      const { rows } = await ctx.client.query(
        "insert into licences_coach (organisation_id, coach_id, debut, fin, montant) values ($1, $2, $3, $4, $5) returning *",
        [ctx.organisationId, req.params.id, req.body.debut, req.body.fin, req.body.montant],
      );
      return rows[0];
    });
    return reponse.status(201).send(l);
  });

  app.put<{ Body: { entiteId: string; taux: { profondeur: number; taux: number }[] } }>("/redevances/regles", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "taux"],
        properties: {
          entiteId: uuid,
          taux: {
            type: "array", maxItems: 10,
            items: {
              type: "object", required: ["profondeur", "taux"],
              properties: { profondeur: { type: "integer", minimum: 1, maximum: 10 }, taux: { type: "number", minimum: 0, maximum: 100 } },
            },
          },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "coaching.gerer", b.entiteId);
      await ctx.client.query("delete from regles_redevance where entite_id = $1", [b.entiteId]);
      for (const t of b.taux) {
        await ctx.client.query(
          "insert into regles_redevance (organisation_id, entite_id, profondeur, taux) values ($1, $2, $3, $4)",
          [ctx.organisationId, b.entiteId, t.profondeur, t.taux],
        );
      }
      return { taux: b.taux };
    }),
  );

  app.get<{ Querystring: { entiteId: string } }>("/redevances/regles", {
    schema: { querystring: { type: "object", required: ["entiteId"], properties: { entiteId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "coaching.gerer", req.query.entiteId);
      return (await ctx.client.query("select profondeur, taux::float from regles_redevance where entite_id = $1 order by profondeur", [req.query.entiteId])).rows;
    }),
  );

  /** Un revenu déclaré calcule tout de suite ce qui revient à chaque niveau au-dessus. */
  app.post<{ Params: { id: string }; Body: { periode: string; libelle: string; montant: number } }>("/coachs/:id/revenus", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["periode", "libelle", "montant"],
        properties: { periode: { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" }, libelle: texte(200), montant: { type: "integer", minimum: 1, maximum: 100_000_000_000 } },
      },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const c = await coachGere(ctx, req.params.id);
      const b = req.body;
      const { rows: [revenu] } = await ctx.client.query(
        "insert into revenus_coach (organisation_id, coach_id, periode, libelle, montant, cree_par) values ($1, $2, $3, $4, $5, $6) returning *",
        [ctx.organisationId, c.id, b.periode, b.libelle, b.montant, ctx.utilisateurId],
      );
      const { rows: regles } = await ctx.client.query("select profondeur, taux::float from regles_redevance where entite_id = $1", [c.entite_id]);
      const lignes = repartirRedevances(b.montant, await lignee(ctx, c.id), new Map(regles.map((x) => [x.profondeur, x.taux])));
      for (const l of lignes) {
        await ctx.client.query(
          "insert into redevances (organisation_id, revenu_id, beneficiaire_id, profondeur, taux, montant) values ($1, $2, $3, $4, $5, $6)",
          [ctx.organisationId, revenu.id, l.beneficiaire, l.profondeur, l.taux, l.montant],
        );
      }
      return { ...revenu, redevances: lignes };
    });
    return reponse.status(201).send(r);
  });

  /** Tableau de croissance : nombre de coachs par génération sous le sommet du réseau. */
  app.get<{ Querystring: { entiteId: string } }>("/coachs/reseau", {
    schema: { querystring: { type: "object", required: ["entiteId"], properties: { entiteId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "coaching.gerer", req.query.entiteId);
      const { rows } = await ctx.client.query(
        `with recursive g as (
           select id, 1 as generation from coachs where parent_id is null and entite_id = $1
           union all select c.id, g.generation + 1 from coachs c join g on c.parent_id = g.id where g.generation < 50
         ) select generation, count(*)::int as coachs from g group by generation order by generation`,
        [req.query.entiteId],
      );
      return rows;
    }),
  );

  const accompagnement = async (ctx: Contexte, id: string) => {
    const { rows } = await ctx.client.query(
      `select a.*, t.nom as client, c.utilisateur_id as coach_utilisateur from accompagnements a
       join tiers t on t.id = a.tiers_id join coachs c on c.id = a.coach_id where a.id = $1`,
      [id],
    );
    if (!rows[0]) throw new ErreurApi(404, "introuvable");
    const estCoach = rows[0].coach_utilisateur === ctx.utilisateurId;
    if (!estCoach) await exigerSurEntite(ctx, "coaching.gerer", rows[0].entite_id);
    else await exigerSurEntite(ctx, "coaching.voir", rows[0].entite_id);
    return { ...rows[0], estCoach };
  };

  /** Sans consentement daté, l'accompagnement ne commence pas. */
  app.post<{
    Body: { coachId: string; tiersId: string; titre: string; objectifs?: string; consentementLe: string; forfaitSeances?: number };
  }>("/accompagnements", {
    schema: {
      body: {
        type: "object", required: ["coachId", "tiersId", "titre", "consentementLe"],
        properties: {
          coachId: uuid, tiersId: uuid, titre: texte(200), objectifs: { type: "string", maxLength: 5000 },
          consentementLe: { type: "string", format: "date" }, forfaitSeances: { type: "integer", minimum: 1, maximum: 1000 },
        },
      },
    },
  }, async (req, reponse) => {
    const a = await protege(req, async (ctx) => {
      const b = req.body;
      const c = await coachGere(ctx, b.coachId);
      await lierTiers(ctx, b.tiersId, c.entite_id);
      const { rows } = await ctx.client.query(
        `insert into accompagnements (organisation_id, entite_id, coach_id, tiers_id, titre, objectifs, consentement_le, forfait_seances)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
        [ctx.organisationId, c.entite_id, b.coachId, b.tiersId, b.titre, b.objectifs ?? null, b.consentementLe, b.forfaitSeances ?? null],
      );
      return rows[0];
    });
    return reponse.status(201).send(a);
  });

  /** Un coach voit ses accompagnements ; la coordination voit ceux de ses entités, sans les notes. */
  app.get("/accompagnements", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "coaching.voir");
      const gerees = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "coaching.gerer")).map((e) => e.id);
      const { rows } = await ctx.client.query(
        `select a.id, a.titre, a.statut, a.progres, a.forfait_seances, t.nom as client, ct.nom as coach,
           (select count(*) from seances_coaching s where s.accompagnement_id = a.id and s.statut = 'tenue')::int as seances_tenues
         from accompagnements a join tiers t on t.id = a.tiers_id join coachs c on c.id = a.coach_id join tiers ct on ct.id = c.tiers_id
         where a.entite_id = any($1::uuid[]) or c.utilisateur_id = $2 order by a.cree_le desc limit 1000`,
        [gerees, ctx.utilisateurId],
      );
      return rows;
    }),
  );

  app.get<{ Params: { id: string } }>("/accompagnements/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { coach_utilisateur: _c, ...a } = await accompagnement(ctx, req.params.id);
      const { rows: seances } = await ctx.client.query("select * from seances_coaching where accompagnement_id = $1 order by debut desc", [req.params.id]);
      const { rows: notes } = await ctx.client.query(
        "select id, contenu_chiffre, cree_le from notes_coaching where accompagnement_id = $1 and auteur_id = $2 order by cree_le desc",
        [req.params.id, ctx.utilisateurId],
      );
      return { ...a, seances, notes: notes.map((n) => ({ id: n.id, cree_le: n.cree_le, contenu: dechiffrer(n.contenu_chiffre, cle) })) };
    }),
  );

  app.patch<{ Params: { id: string }; Body: { objectifs?: string; diagnostic?: string; planAction?: string; progres?: number; statut?: string } }>("/accompagnements/:id", {
    schema: {
      params: paramId,
      body: {
        type: "object", minProperties: 1,
        properties: {
          objectifs: { type: "string", maxLength: 5000 }, diagnostic: { type: "string", maxLength: 20000 }, planAction: { type: "string", maxLength: 20000 },
          progres: { type: "integer", minimum: 0, maximum: 100 }, statut: { type: "string", enum: ["actif", "termine", "suspendu"] },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      await accompagnement(ctx, req.params.id);
      const b = req.body;
      await ctx.client.query(
        `update accompagnements set objectifs = coalesce($2, objectifs), diagnostic = coalesce($3, diagnostic), plan_action = coalesce($4, plan_action),
           progres = coalesce($5, progres), statut = coalesce($6, statut) where id = $1`,
        [req.params.id, b.objectifs ?? null, b.diagnostic ?? null, b.planAction ?? null, b.progres ?? null, b.statut ?? null],
      );
      return { modifie: true };
    }),
  );

  app.post<{ Params: { id: string }; Body: { debut: string; dureeMinutes: number; lienVisio?: string } }>("/accompagnements/:id/seances", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["debut", "dureeMinutes"],
        properties: { debut: { type: "string", format: "date-time" }, dureeMinutes: { type: "integer", minimum: 5, maximum: 600 }, lienVisio: { type: "string", pattern: "^https://", maxLength: 1000 } },
      },
    },
  }, async (req, reponse) => {
    const s = await protege(req, async (ctx) => {
      const a = await accompagnement(ctx, req.params.id);
      if (a.forfait_seances) {
        const { rows: [n] } = await ctx.client.query(
          "select count(*)::int as n from seances_coaching where accompagnement_id = $1 and statut <> 'annulee'", [a.id],
        );
        if (n.n >= a.forfait_seances) throw new ErreurApi(409, "forfait_epuise");
      }
      const { rows } = await ctx.client.query(
        "insert into seances_coaching (organisation_id, accompagnement_id, debut, duree_minutes, lien_visio) values ($1, $2, $3, $4, $5) returning *",
        [ctx.organisationId, a.id, req.body.debut, req.body.dureeMinutes, req.body.lienVisio ?? null],
      );
      return rows[0];
    });
    return reponse.status(201).send(s);
  });

  app.post<{ Params: { id: string }; Body: { statut: string } }>("/seances-coaching/:id/statut", {
    schema: { params: paramId, body: { type: "object", required: ["statut"], properties: { statut: { type: "string", enum: ["tenue", "annulee"] } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [s] } = await ctx.client.query("select accompagnement_id from seances_coaching where id = $1", [req.params.id]);
      if (!s) throw new ErreurApi(404, "introuvable");
      await accompagnement(ctx, s.accompagnement_id);
      await ctx.client.query("update seances_coaching set statut = $2 where id = $1", [req.params.id, req.body.statut]);
      return { statut: req.body.statut };
    }),
  );

  /** Seul le coach de cet accompagnement écrit, et seul l'auteur relit : pas même le super administrateur. */
  app.post<{ Params: { id: string }; Body: { contenu: string } }>("/accompagnements/:id/notes", {
    schema: { params: paramId, body: { type: "object", required: ["contenu"], properties: { contenu: texte(50000) } } },
  }, async (req, reponse) => {
    const n = await protege(req, async (ctx) => {
      const a = await accompagnement(ctx, req.params.id);
      if (!a.estCoach) throw new ErreurApi(403, "permission_refusee");
      const { rows } = await ctx.client.query(
        "insert into notes_coaching (organisation_id, accompagnement_id, auteur_id, contenu_chiffre) values ($1, $2, $3, $4) returning id, cree_le",
        [ctx.organisationId, a.id, ctx.utilisateurId, chiffrer(req.body.contenu, cle)],
      );
      return rows[0];
    });
    return reponse.status(201).send(n);
  });

  // Parcours de certification
  app.post<{ Body: { entiteId: string; ordre: number; nom: string; heuresRequises: number; supervisionsRequises: number } }>("/certification/niveaux", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "ordre", "nom", "heuresRequises", "supervisionsRequises"],
        properties: {
          entiteId: uuid, ordre: { type: "integer", minimum: 1, maximum: 20 }, nom: texte(200),
          heuresRequises: { type: "integer", minimum: 0, maximum: 100000 }, supervisionsRequises: { type: "integer", minimum: 0, maximum: 10000 },
        },
      },
    },
  }, async (req, reponse) => {
    const n = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "coaching.gerer", b.entiteId);
      const { rows } = await ctx.client.query(
        "insert into niveaux_certification (organisation_id, entite_id, ordre, nom, heures_requises, supervisions_requises) values ($1, $2, $3, $4, $5, $6) returning *",
        [ctx.organisationId, b.entiteId, b.ordre, b.nom, b.heuresRequises, b.supervisionsRequises],
      );
      return rows[0];
    });
    return reponse.status(201).send(n);
  });

  app.get("/certification/niveaux", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "coaching.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "coaching.voir")).map((e) => e.id);
      return (await ctx.client.query("select * from niveaux_certification where entite_id = any($1::uuid[]) order by ordre", [ids])).rows;
    }),
  );

  app.post<{ Params: { id: string }; Body: { tiersId: string } }>("/certification/niveaux/:id/parcours", {
    schema: { params: paramId, body: { type: "object", required: ["tiersId"], properties: { tiersId: uuid } } },
  }, async (req, reponse) => {
    const p = await protege(req, async (ctx) => {
      const { rows: [n] } = await ctx.client.query("select * from niveaux_certification where id = $1", [req.params.id]);
      if (!n) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "coaching.gerer", n.entite_id);
      await lierTiers(ctx, req.body.tiersId, n.entite_id);
      const { rows } = await ctx.client.query(
        "insert into parcours_certification (organisation_id, niveau_id, tiers_id) values ($1, $2, $3) returning *",
        [ctx.organisationId, n.id, req.body.tiersId],
      );
      return rows[0];
    });
    return reponse.status(201).send(p);
  });

  app.get("/certification/parcours", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "coaching.gerer");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "coaching.gerer")).map((e) => e.id);
      return (await ctx.client.query(
        `select p.*, t.nom, n.nom as niveau, n.ordre, n.heures_requises, n.supervisions_requises from parcours_certification p
         join tiers t on t.id = p.tiers_id join niveaux_certification n on n.id = p.niveau_id
         where n.entite_id = any($1::uuid[]) order by t.nom, n.ordre limit 2000`,
        [ids],
      )).rows;
    }),
  );

  const parcours = async (ctx: Contexte, id: string) => {
    const { rows } = await ctx.client.query(
      `select p.*, t.nom as candidat, n.entite_id, n.ordre, n.nom as niveau, n.heures_requises, n.supervisions_requises
       from parcours_certification p join tiers t on t.id = p.tiers_id join niveaux_certification n on n.id = p.niveau_id
       where p.id = $1 for update of p`,
      [id],
    );
    if (!rows[0]) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, "coaching.gerer", rows[0].entite_id);
    return rows[0];
  };

  app.patch<{ Params: { id: string }; Body: { heures?: number; supervisions?: number; examenReussi?: boolean; soutenanceReussie?: boolean } }>("/certification/parcours/:id", {
    schema: {
      params: paramId,
      body: {
        type: "object", minProperties: 1,
        properties: {
          heures: { type: "integer", minimum: 0, maximum: 100000 }, supervisions: { type: "integer", minimum: 0, maximum: 10000 },
          examenReussi: { type: "boolean" }, soutenanceReussie: { type: "boolean" },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const p = await parcours(ctx, req.params.id);
      if (p.numero) throw new ErreurApi(409, "certificat_deja_delivre");
      const b = req.body;
      const { rows } = await ctx.client.query(
        `update parcours_certification set heures = coalesce($2, heures), supervisions = coalesce($3, supervisions),
           examen_reussi = coalesce($4, examen_reussi), soutenance_reussie = coalesce($5, soutenance_reussie) where id = $1 returning *`,
        [p.id, b.heures ?? null, b.supervisions ?? null, b.examenReussi ?? null, b.soutenanceReussie ?? null],
      );
      return rows[0];
    }),
  );

  const vue = async (p: Record<string, any>, organisationId: string) => {
    const url = `${urlPublique}/verifier.html?c=${organisationId}.${p.code_verification}`;
    return { ...p, url_verification: url, qr_svg: await QRCode.toString(url, { type: "svg", margin: 1 }) };
  };

  /** Le certificat ne sort que si tout est rempli, et si le niveau précédent est déjà obtenu. */
  app.post<{ Params: { id: string } }>("/certification/parcours/:id/delivrance", { schema: { params: paramId } }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const p = await parcours(ctx, req.params.id);
      if (p.numero) throw new ErreurApi(409, "certificat_deja_delivre");
      if (p.heures < p.heures_requises || p.supervisions < p.supervisions_requises || !p.examen_reussi || !p.soutenance_reussie) {
        throw new ErreurApi(409, "parcours_incomplet");
      }
      const { rows: manque } = await ctx.client.query(
        `select 1 from niveaux_certification n where n.entite_id = $1 and n.ordre < $2 and not exists (
           select 1 from parcours_certification x where x.niveau_id = n.id and x.tiers_id = $3 and x.numero is not null and x.revoque_le is null) limit 1`,
        [p.entite_id, p.ordre, p.tiers_id],
      );
      if (manque[0]) throw new ErreurApi(409, "niveau_precedent_manquant");
      const numero = await prochainNumero(ctx.client, `SMARTE-${new Date().getFullYear()}`);
      const { rows } = await ctx.client.query(
        `update parcours_certification set numero = $2, code_verification = $3, titulaire = $4, programme = $5, delivre_le = current_date where id = $1 returning *`,
        [p.id, numero, randomBytes(16).toString("base64url"), p.candidat, `SMARTE Coaching : ${p.niveau}`],
      );
      return vue(rows[0], ctx.organisationId);
    });
    return reponse.status(201).send(r);
  });

  app.post<{ Params: { id: string }; Body: { motif: string } }>("/certification/parcours/:id/revocation", {
    schema: { params: paramId, body: { type: "object", required: ["motif"], properties: { motif: { type: "string", minLength: 5, maxLength: 500 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const p = await parcours(ctx, req.params.id);
      await ctx.client.query("update parcours_certification set revoque_le = now(), motif_revocation = $2 where id = $1 and revoque_le is null", [p.id, req.body.motif]);
      return { revoque: true };
    }),
  );

}
