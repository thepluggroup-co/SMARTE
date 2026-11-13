import { exigerNonBloque } from "./tiers.js";
import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { dansOrganisation, publierEvenement } from "./base.js";
import { prochainNumero } from "./formations.js";
import { entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";
import { lierTiers } from "./tiers.js";

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max = 300) => ({ type: "string", minLength: 1, maxLength: max }) as const;
const entier = { type: "integer", minimum: 0, maximum: 1_000_000_000_000 } as const;
const JETON_SUIVI = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{22}$/;

/** Avancement d'un résultat clé, de son point de départ à sa cible, borné entre 0 et 100. */
export function avancement(depart: number, cible: number, actuel: number): number {
  return Math.round(Math.min(Math.max((actuel - depart) / (cible - depart), 0), 1) * 100);
}
/** Les étapes vont dans un seul sens. Un échec peut être retenté ou finir en retour. */
const SUITES: Record<string, string[]> = {
  prepare: ["expedie", "en_livraison", "retour"], expedie: ["en_transit", "arrive", "en_livraison", "retour"], en_transit: ["arrive", "en_livraison", "retour"],
  arrive: ["en_livraison", "retour"], en_livraison: ["echec", "retour"], echec: ["en_livraison", "retour"], livre: ["retour"], retour: [],
};
export const transitionPermise = (de: string, vers: string) => SUITES[de]?.includes(vers) ?? false;
export const commission = (base: number, taux: number) => Math.round((base * taux) / 100);

export function enregistrerPilotage(app: FastifyInstance, pool: pg.Pool, outils: Outils, urlPublique: string): void {
  const { protege, exiger, exigerSurEntite } = outils;
  const ids = async (ctx: Contexte, p: "pilotage.voir" | "transport.voir" | "affiliation.voir") =>
    (await entitesAccessibles(ctx.client, ctx.utilisateurId, p)).map((e) => e.id);

  // Objectifs
  app.post<{ Body: { entiteId: string; parentId?: string; titre: string; periode: string; responsable?: string; resultats: { libelle: string; unite?: string; depart?: number; cible: number }[] } }>("/objectifs", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "titre", "periode", "resultats"],
        properties: {
          entiteId: uuid, parentId: uuid, titre: texte(), periode: { type: "string", pattern: "^[0-9]{4}-T[1-4]$" }, responsable: texte(200),
          resultats: { type: "array", minItems: 1, maxItems: 10, items: { type: "object", required: ["libelle", "cible"], properties: { libelle: texte(), unite: texte(30), depart: { type: "number" }, cible: { type: "number" } } } },
        },
      },
    },
  }, async (req, reponse) => {
    const o = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "pilotage.gerer", b.entiteId);
      if (b.resultats.some((r) => r.cible === (r.depart ?? 0))) throw new ErreurApi(400, "donnees_invalides");
      if (b.parentId) {
        const { rows } = await ctx.client.query("select entite_id from objectifs where id = $1", [b.parentId]);
        if (!rows[0]) throw new ErreurApi(404, "introuvable");
        await exigerSurEntite(ctx, "pilotage.voir", rows[0].entite_id);
      }
      const { rows: [x] } = await ctx.client.query(
        "insert into objectifs (organisation_id, entite_id, parent_id, titre, periode, responsable) values ($1, $2, $3, $4, $5, $6) returning *",
        [ctx.organisationId, b.entiteId, b.parentId ?? null, b.titre, b.periode, b.responsable ?? null],
      );
      for (const r of b.resultats) {
        await ctx.client.query(
          "insert into resultats_cles (organisation_id, objectif_id, libelle, unite, depart, cible, actuel) values ($1, $2, $3, $4, $5, $6, $5)",
          [ctx.organisationId, x.id, r.libelle, r.unite ?? null, r.depart ?? 0, r.cible],
        );
      }
      return x;
    });
    return reponse.status(201).send(o);
  });

  app.get("/objectifs", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "pilotage.voir");
      const { rows } = await ctx.client.query(
        `select o.*, e.nom as entite, (select json_agg(json_build_object('id', r.id, 'libelle', r.libelle, 'unite', r.unite, 'depart', r.depart::float, 'cible', r.cible::float, 'actuel', r.actuel::float)) from resultats_cles r where r.objectif_id = o.id) as resultats
         from objectifs o join entites e on e.id = o.entite_id where o.entite_id = any($1::uuid[]) order by o.periode desc, o.parent_id nulls first, o.cree_le limit 500`,
        [await ids(ctx, "pilotage.voir")],
      );
      return rows.map((o) => {
        const resultats = (o.resultats ?? []).map((r: { depart: number; cible: number; actuel: number }) => ({ ...r, avancement: avancement(r.depart, r.cible, r.actuel) }));
        return { ...o, resultats, avancement: resultats.length ? Math.round(resultats.reduce((s: number, r: { avancement: number }) => s + r.avancement, 0) / resultats.length) : 0 };
      });
    }),
  );

  app.patch<{ Params: { id: string }; Body: { actuel: number } }>("/resultats-cles/:id", {
    schema: { params: paramId, body: { type: "object", required: ["actuel"], properties: { actuel: { type: "number" } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [r] } = await ctx.client.query("select o.entite_id, r.mode from resultats_cles r join objectifs o on o.id = r.objectif_id where r.id = $1", [req.params.id]);
      if (!r) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "pilotage.gerer", r.entite_id);
      // Une mesure automatique ne se saisit pas : la tâche de nuit la met à jour.
      if (r.mode === "auto") throw new ErreurApi(409, "resultat_automatique");
      await ctx.client.query("update resultats_cles set actuel = $2, maj_le = now() where id = $1", [req.params.id, req.body.actuel]);
      await ctx.client.query("insert into valeurs_resultat (organisation_id, resultat_id, valeur, source, auteur_id) values ($1, $2, $3, 'manuel', $4)", [ctx.organisationId, req.params.id, req.body.actuel, ctx.utilisateurId]);
      return { actuel: req.body.actuel };
    }),
  );

  // Projets
  app.post<{ Body: { entiteId: string; nom: string; responsable?: string; debut?: string; fin?: string; budget?: number } }>("/projets", {
    schema: { body: { type: "object", required: ["entiteId", "nom"], properties: { entiteId: uuid, nom: texte(200), responsable: texte(200), debut: date, fin: date, budget: entier } } },
  }, async (req, reponse) => {
    const p = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "pilotage.gerer", b.entiteId);
      if (b.debut && b.fin && b.fin < b.debut) throw new ErreurApi(400, "dates_invalides");
      return (await ctx.client.query(
        "insert into projets (organisation_id, entite_id, nom, responsable, debut, fin, budget) values ($1, $2, $3, $4, $5, $6, $7) returning *",
        [ctx.organisationId, b.entiteId, b.nom, b.responsable ?? null, b.debut ?? null, b.fin ?? null, b.budget ?? 0],
      )).rows[0];
    });
    return reponse.status(201).send(p);
  });

  app.get("/projets", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "pilotage.voir");
      return (await ctx.client.query(
        `select p.*, e.nom as entite, (select count(*) from taches_projet t where t.projet_id = p.id)::int as taches, (select count(*) from taches_projet t where t.projet_id = p.id and t.statut = 'termine')::int as terminees,
           (select coalesce(sum(d.montant), 0) from depenses_projet d where d.projet_id = p.id)::int8 as depense
         from projets p join entites e on e.id = p.entite_id where p.entite_id = any($1::uuid[]) order by p.statut, p.cree_le desc limit 500`,
        [await ids(ctx, "pilotage.voir")],
      )).rows;
    }),
  );

  const projet = async (ctx: Contexte, id: string, p: "pilotage.voir" | "pilotage.gerer") => {
    const { rows: [x] } = await ctx.client.query("select * from projets where id = $1", [id]);
    if (!x) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, p, x.entite_id);
    return x;
  };
  app.get<{ Params: { id: string } }>("/projets/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const p = await projet(ctx, req.params.id, "pilotage.voir");
      const [t, d] = await Promise.all([
        ctx.client.query("select t.*, (select coalesce(sum(x.minutes), 0) from temps_projet x where x.tache_id = t.id)::int as minutes from taches_projet t where t.projet_id = $1 order by t.debut nulls last, t.fin nulls last", [p.id]),
        ctx.client.query("select libelle, montant, jour from depenses_projet where projet_id = $1 order by jour desc", [p.id]),
      ]);
      return { ...p, taches: t.rows, depenses: d.rows, depense: d.rows.reduce((s, x) => s + x.montant, 0) };
    }),
  );
  app.post<{ Params: { id: string }; Body: { titre: string; responsable?: string; debut?: string; fin?: string; jalon?: boolean } }>("/projets/:id/taches", {
    schema: { params: paramId, body: { type: "object", required: ["titre"], properties: { titre: texte(), responsable: texte(200), debut: date, fin: date, jalon: { type: "boolean" } } } },
  }, async (req, reponse) => {
    const t = await protege(req, async (ctx) => {
      await projet(ctx, req.params.id, "pilotage.gerer");
      const b = req.body;
      if (b.debut && b.fin && b.fin < b.debut) throw new ErreurApi(400, "dates_invalides");
      return (await ctx.client.query(
        "insert into taches_projet (organisation_id, projet_id, titre, responsable, debut, fin, jalon) values ($1, $2, $3, $4, $5, $6, $7) returning *",
        [ctx.organisationId, req.params.id, b.titre, b.responsable ?? null, b.debut ?? null, b.fin ?? null, b.jalon ?? false],
      )).rows[0];
    });
    return reponse.status(201).send(t);
  });
  const tache = async (ctx: Contexte, id: string) => {
    const { rows: [t] } = await ctx.client.query("select projet_id from taches_projet where id = $1", [id]);
    if (!t) throw new ErreurApi(404, "introuvable");
    await projet(ctx, t.projet_id, "pilotage.gerer");
  };
  app.patch<{ Params: { id: string }; Body: { statut: string } }>("/taches-projet/:id", {
    schema: { params: paramId, body: { type: "object", required: ["statut"], properties: { statut: { type: "string", enum: ["a_faire", "en_cours", "termine"] } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await tache(ctx, req.params.id);
      await ctx.client.query("update taches_projet set statut = $2 where id = $1", [req.params.id, req.body.statut]);
      return { statut: req.body.statut };
    }),
  );
  app.post<{ Params: { id: string }; Body: { jour: string; minutes: number } }>("/taches-projet/:id/temps", {
    schema: { params: paramId, body: { type: "object", required: ["jour", "minutes"], properties: { jour: date, minutes: { type: "integer", minimum: 1, maximum: 1440 } } } },
  }, async (req, reponse) => {
    await protege(req, async (ctx) => {
      await tache(ctx, req.params.id);
      await ctx.client.query("insert into temps_projet (organisation_id, tache_id, jour, minutes, auteur_id) values ($1, $2, $3, $4, $5)", [ctx.organisationId, req.params.id, req.body.jour, req.body.minutes, ctx.utilisateurId]);
    });
    return reponse.status(201).send({ ajoute: true });
  });
  app.post<{ Params: { id: string }; Body: { libelle: string; montant: number; jour: string } }>("/projets/:id/depenses", {
    schema: { params: paramId, body: { type: "object", required: ["libelle", "montant", "jour"], properties: { libelle: texte(), montant: { ...entier, minimum: 1 }, jour: date } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const p = await projet(ctx, req.params.id, "pilotage.gerer");
      await ctx.client.query("insert into depenses_projet (organisation_id, projet_id, libelle, montant, jour, auteur_id) values ($1, $2, $3, $4, $5, $6)", [ctx.organisationId, p.id, req.body.libelle, req.body.montant, req.body.jour, ctx.utilisateurId]);
      const { rows: [s] } = await ctx.client.query("select sum(montant)::int8 as t from depenses_projet where projet_id = $1", [p.id]);
      return { depense: s.t, depassement: p.budget > 0 && s.t > p.budget };
    });
    return reponse.status(201).send(r);
  });

  // Registre : risques, non-conformités, incidents, décisions
  app.post<{ Body: { entiteId: string; type: string; titre: string; description?: string; probabilite?: number; impact?: number; planAction?: string; responsable?: string; echeance?: string } }>("/registre", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "type", "titre"],
        properties: {
          entiteId: uuid, type: { type: "string", enum: ["risque", "non_conformite", "incident", "decision"] }, titre: texte(), description: texte(5000),
          probabilite: { type: "integer", minimum: 1, maximum: 5 }, impact: { type: "integer", minimum: 1, maximum: 5 }, planAction: texte(5000), responsable: texte(200), echeance: date,
        },
      },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "pilotage.gerer", b.entiteId);
      if (b.type === "risque" && (!b.probabilite || !b.impact)) throw new ErreurApi(400, "donnees_invalides");
      return (await ctx.client.query(
        `insert into registre_pilotage (organisation_id, entite_id, type, titre, description, probabilite, impact, plan_action, responsable, echeance, cree_par)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
        [ctx.organisationId, b.entiteId, b.type, b.titre, b.description ?? null, b.probabilite ?? null, b.impact ?? null, b.planAction ?? null, b.responsable ?? null, b.echeance ?? null, ctx.utilisateurId],
      )).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/registre", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "pilotage.voir");
      return (await ctx.client.query(
        `select r.*, e.nom as entite, r.probabilite * r.impact as score from registre_pilotage r join entites e on e.id = r.entite_id
         where r.entite_id = any($1::uuid[]) order by r.statut = 'clos', r.probabilite * r.impact desc nulls last, r.cree_le desc limit 500`,
        [await ids(ctx, "pilotage.voir")],
      )).rows;
    }),
  );
  app.patch<{ Params: { id: string }; Body: { statut: string } }>("/registre/:id", {
    schema: { params: paramId, body: { type: "object", required: ["statut"], properties: { statut: { type: "string", enum: ["ouvert", "en_cours", "clos"] } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [r] } = await ctx.client.query("select entite_id from registre_pilotage where id = $1", [req.params.id]);
      if (!r) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "pilotage.gerer", r.entite_id);
      await ctx.client.query("update registre_pilotage set statut = $2 where id = $1", [req.params.id, req.body.statut]);
      return { statut: req.body.statut };
    }),
  );

  // Transport
  app.post<{ Body: { entiteId: string; nom: string; frais: number; delaiJours: number } }>("/zones-livraison", {
    schema: { body: { type: "object", required: ["entiteId", "nom", "frais", "delaiJours"], properties: { entiteId: uuid, nom: texte(100), frais: entier, delaiJours: { type: "integer", minimum: 0, maximum: 365 } } } },
  }, async (req, reponse) => {
    const z = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "transport.gerer", b.entiteId);
      return (await ctx.client.query("insert into zones_livraison (organisation_id, entite_id, nom, frais, delai_jours) values ($1, $2, $3, $4, $5) returning *", [ctx.organisationId, b.entiteId, b.nom, b.frais, b.delaiJours])).rows[0];
    });
    return reponse.status(201).send(z);
  });

  app.post<{ Body: { entiteId: string; destinataire: string; telephone?: string; adresse?: string; zoneId?: string; transporteur?: string; documentId?: string; aEncaisser?: number } }>("/colis", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "destinataire"],
        properties: { entiteId: uuid, destinataire: texte(200), telephone: texte(30), adresse: texte(500), zoneId: uuid, transporteur: texte(200), documentId: uuid, aEncaisser: entier },
      },
    },
  }, async (req, reponse) => {
    const c = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "transport.gerer", b.entiteId);
      if (b.documentId) {
        const { rows: [d] } = await ctx.client.query("select tiers_id from documents_vente where id = $1", [b.documentId]);
        await exigerNonBloque(ctx.client, d?.tiers_id, "livraison");
      }
      let prevu: string | null = null;
      if (b.zoneId) {
        const { rows: [z] } = await ctx.client.query("select ((now() at time zone 'Africa/Douala')::date + delai_jours)::text as prevu from zones_livraison where id = $1 and entite_id = $2", [b.zoneId, b.entiteId]);
        if (!z) throw new ErreurApi(404, "introuvable");
        prevu = z.prevu;
      }
      if (b.documentId) {
        const { rows: [d] } = await ctx.client.query("select entite_branche(entite_id) as b, entite_branche($2) as e from documents_vente where id = $1", [b.documentId, b.entiteId]);
        if (!d || d.b !== d.e) throw new ErreurApi(404, "introuvable");
      }
      const numero = await prochainNumero(ctx.client, `COL-${new Date().getFullYear()}`);
      const code = String(100000 + (randomBytes(4).readUInt32BE(0) % 900000));
      const { rows: [x] } = await ctx.client.query(
        `insert into colis (organisation_id, entite_id, numero, code_suivi, code_confirmation, destinataire, telephone, adresse, zone_id, transporteur, document_id, a_encaisser, prevu_le)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning *`,
        [ctx.organisationId, b.entiteId, numero, randomBytes(16).toString("base64url"), code, b.destinataire, b.telephone ?? null, b.adresse ?? null, b.zoneId ?? null, b.transporteur ?? null, b.documentId ?? null, b.aEncaisser ?? 0, prevu],
      );
      await ctx.client.query("insert into etapes_colis (organisation_id, colis_id, statut, auteur_id) values ($1, $2, 'prepare', $3)", [ctx.organisationId, x.id, ctx.utilisateurId]);
      return { ...x, lien_suivi: `${urlPublique}/suivi.html?c=${ctx.organisationId}.${x.code_suivi}` };
    });
    return reponse.status(201).send(c);
  });

  /** Le code de confirmation appartient au client : celui qui livre ne le voit pas. */
  app.get("/colis", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "transport.voir");
      const gere = new Set((await entitesAccessibles(ctx.client, ctx.utilisateurId, "transport.gerer")).map((e) => e.id));
      const { rows } = await ctx.client.query(
        `select c.*, z.nom as zone, t.livreur, t.jour as tournee_jour from colis c left join zones_livraison z on z.id = c.zone_id left join tournees t on t.id = c.tournee_id
         where c.entite_id = any($1::uuid[]) order by c.statut in ('livre', 'retour'), c.cree_le desc limit 1000`,
        [await ids(ctx, "transport.voir")],
      );
      return rows.map(({ code_confirmation, code_suivi, ...c }) => ({
        ...c, ...(gere.has(c.entite_id) ? { code_confirmation, lien_suivi: `${urlPublique}/suivi.html?c=${ctx.organisationId}.${code_suivi}` } : {}),
      }));
    }),
  );

  const colisVerrou = async (ctx: Contexte, id: string, p: "transport.gerer" | "transport.livrer") => {
    const { rows: [c] } = await ctx.client.query("select * from colis where id = $1 for update", [id]);
    if (!c) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, p, c.entite_id);
    return c;
  };
  const etape = (ctx: Contexte, id: string, statut: string, note?: string) =>
    ctx.client.query("insert into etapes_colis (organisation_id, colis_id, statut, note, auteur_id) values ($1, $2, $3, $4, $5)", [ctx.organisationId, id, statut, note ?? null, ctx.utilisateurId]);

  app.post<{ Params: { id: string }; Body: { statut: string; note?: string } }>("/colis/:id/etape", {
    schema: {
      params: paramId,
      body: { type: "object", required: ["statut"], properties: { statut: { type: "string", enum: ["expedie", "en_transit", "arrive", "en_livraison", "echec", "retour"] }, note: texte(500) } },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const c = await colisVerrou(ctx, req.params.id, "transport.livrer");
      const { statut, note } = req.body;
      if (!transitionPermise(c.statut, statut)) throw new ErreurApi(409, "etape_impossible");
      if (statut === "echec" && !note) throw new ErreurApi(400, "motif_obligatoire");
      await ctx.client.query("update colis set statut = $2 where id = $1", [c.id, statut]);
      await etape(ctx, c.id, statut, note);
      return { statut };
    }),
  );

  /** La livraison est prouvée par le code remis au client. Ce qui est encaissé doit être complet. */
  app.post<{ Params: { id: string }; Body: { code: string; recuPar: string; encaisse?: number } }>("/colis/:id/livraison", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: { params: paramId, body: { type: "object", required: ["code", "recuPar"], properties: { code: { type: "string", pattern: "^[0-9]{6}$" }, recuPar: texte(200), encaisse: entier } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const c = await colisVerrou(ctx, req.params.id, "transport.livrer");
      if (c.statut !== "en_livraison") throw new ErreurApi(409, "etape_impossible");
      const b = req.body;
      if (b.code !== c.code_confirmation) throw new ErreurApi(409, "code_incorrect");
      if ((b.encaisse ?? 0) !== c.a_encaisser) throw new ErreurApi(409, "encaissement_incomplet", { attendu: c.a_encaisser });
      await ctx.client.query("update colis set statut = 'livre', livre_a = $2, livre_le = now(), encaisse = $3 where id = $1", [c.id, b.recuPar, b.encaisse ?? 0]);
      await etape(ctx, c.id, "livre", `Reçu par ${b.recuPar}`);
      await publierEvenement(ctx.client, "colis.livre", { id: c.id });
      return { statut: "livre" };
    }),
  );

  /** Public, par lien secret : aucune adresse, aucun téléphone, aucun montant. */
  app.get<{ Params: { code: string } }>("/suivi/:code", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reponse) => {
    const non = () => reponse.status(404).send({ erreur: "introuvable" });
    if (!JETON_SUIVI.test(req.params.code)) return non();
    const [org, code] = req.params.code.split(".") as [string, string];
    const r = await dansOrganisation(pool, org, async (c) => {
      const { rows: [x] } = await c.query("select id, numero, statut, prevu_le from colis where code_suivi = $1", [code]);
      if (!x) return null;
      const { rows } = await c.query("select statut, le from etapes_colis where colis_id = $1 order by le", [x.id]);
      return { numero: x.numero, statut: x.statut, prevu_le: x.prevu_le, etapes: rows };
    }).catch((e) => {
      if (e.code === "22P02") return null;
      throw e;
    });
    return r ?? non();
  });

  app.post<{ Body: { entiteId: string; jour: string; livreur: string; vehiculeId?: string; colis: string[] } }>("/tournees", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "jour", "livreur", "colis"],
        properties: { entiteId: uuid, jour: date, livreur: texte(200), vehiculeId: uuid, colis: { type: "array", minItems: 1, maxItems: 200, items: uuid } },
      },
    },
  }, async (req, reponse) => {
    const t = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "transport.gerer", b.entiteId);
      const { rows: [x] } = await ctx.client.query(
        "insert into tournees (organisation_id, entite_id, jour, livreur, vehicule_id) values ($1, $2, $3, $4, $5) returning *",
        [ctx.organisationId, b.entiteId, b.jour, b.livreur, b.vehiculeId ?? null],
      );
      for (const id of b.colis) {
        const c = await colisVerrou(ctx, id, "transport.gerer");
        if (!["prepare", "expedie", "en_transit", "arrive", "echec"].includes(c.statut)) throw new ErreurApi(409, "etape_impossible");
        await ctx.client.query("update colis set tournee_id = $2, statut = 'en_livraison' where id = $1", [c.id, x.id]);
        await etape(ctx, c.id, "en_livraison", `Tournée de ${b.livreur}`);
      }
      return x;
    });
    return reponse.status(201).send(t);
  });

  app.get("/tournees", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "transport.voir");
      return (await ctx.client.query(
        `select t.*, v.immatriculation, (select count(*) from colis c where c.tournee_id = t.id)::int as colis, (select count(*) from colis c where c.tournee_id = t.id and c.statut = 'livre')::int as livres,
           (select coalesce(sum(c.encaisse), 0) from colis c where c.tournee_id = t.id)::int8 as encaisse
         from tournees t left join vehicules v on v.id = t.vehicule_id where t.entite_id = any($1::uuid[]) order by t.jour desc limit 300`,
        [await ids(ctx, "transport.voir")],
      )).rows;
    }),
  );

  /** Le livreur remet ce qu'il a encaissé. L'argent entre dans le portefeuille, tout écart est motivé et conservé. */
  app.post<{ Params: { id: string }; Body: { portefeuilleId: string; compte: number; motif?: string } }>("/tournees/:id/remise", {
    schema: { params: paramId, body: { type: "object", required: ["portefeuilleId", "compte"], properties: { portefeuilleId: uuid, compte: entier, motif: texte(500) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [t] } = await ctx.client.query("select * from tournees where id = $1 for update", [req.params.id]);
      if (!t) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "transport.gerer", t.entite_id);
      if (t.remise_le) throw new ErreurApi(409, "remise_deja_faite");
      const { rows: [w] } = await ctx.client.query("select id, actif, entite_branche(entite_id) as b, entite_branche($2) as e from portefeuilles where id = $1", [req.body.portefeuilleId, t.entite_id]);
      if (!w) throw new ErreurApi(404, "introuvable");
      if (w.b !== w.e) throw new ErreurApi(409, "transfert_autre_branche");
      if (!w.actif) throw new ErreurApi(409, "portefeuille_inactif");
      const { rows: [{ s }] } = await ctx.client.query("select coalesce(sum(encaisse), 0)::int8 as s from colis where tournee_id = $1", [t.id]);
      if (req.body.compte !== s && !req.body.motif) throw new ErreurApi(409, "motif_ecart_obligatoire", { attendu: s });
      await ctx.client.query("update tournees set remise_le = now(), remise_attendue = $2, remise_comptee = $3, motif_ecart = $4 where id = $1", [t.id, s, req.body.compte, req.body.motif ?? null]);
      // Ce qui a été encaissé pour une facture la règle : le client n'est plus relancé, et la somme n'est comptée qu'une fois.
      const { rows: lies } = await ctx.client.query(
        `select c.encaisse, c.numero, c.document_id, d.numero as facture, d.total_ttc - (select coalesce(sum(r.montant), 0) from reglements r where r.facture_id = d.id and r.annule_le is null) - (select coalesce(sum(a.total_ttc), 0) from documents_vente a where a.origine_id = d.id and a.type = 'avoir' and a.statut = 'emis') as reste
         from colis c join documents_vente d on d.id = c.document_id where c.tournee_id = $1 and c.encaisse > 0 and d.type = 'facture' and d.statut = 'emis' order by c.numero`, [t.id],
      );
      const { rows: [{ an }] } = await ctx.client.query("select extract(year from now() at time zone 'Africa/Douala')::int as an");
      let regle = 0;
      // Plusieurs colis peuvent porter la même facture : chacun règle ce que le précédent a laissé.
      const restes = new Map<string, number>();
      for (const c of lies) {
        const reste = restes.get(c.document_id) ?? Number(c.reste);
        const m = Math.min(Number(c.encaisse), reste, req.body.compte - regle);
        if (m <= 0) continue;
        const numero = await prochainNumero(ctx.client, `REG-${an}`);
        const { rows: [r] } = await ctx.client.query("insert into reglements (organisation_id, facture_id, numero_recu, montant, moyen, reference, encaisse_par) values ($1, $2, $3, $4, 'especes', $5, $6) returning id", [ctx.organisationId, c.document_id, numero, m, `Colis ${c.numero}`, ctx.utilisateurId]);
        restes.set(c.document_id, reste - m);
        // Le règlement crédite le portefeuille par défaut : l'argent remis est ensuite transféré là où il a été déposé.
        const { rows: [dejaM] } = await ctx.client.query("select portefeuille_id from mouvements_portefeuille where source_id = $1", [r.id]);
        if (dejaM && dejaM.portefeuille_id !== w.id) {
          const transfert = randomUUID();
          for (const [portefeuille, montant] of [[dejaM.portefeuille_id, -m], [w.id, m]]) await ctx.client.query("insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, reference, transfert_id, auteur_id) values ($1, $2, 'transfert', $3, $4, $5, $6, $7)", [ctx.organisationId, portefeuille, montant, `Remise de ${t.livreur}, ${c.facture}`, numero, transfert, ctx.utilisateurId]);
        }
        if (!dejaM) await ctx.client.query("insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, reference, source_type, source_id, auteur_id) values ($1, $2, 'encaissement', $3, $4, $5, 'reglement', $6, $7)", [ctx.organisationId, w.id, m, `Contre-remboursement ${c.facture}`, numero, r.id, ctx.utilisateurId]);
        regle += m;
      }
      if (req.body.compte - regle > 0) {
        await ctx.client.query(
          "insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, auteur_id) values ($1, $2, 'entree', $3, $4, $5)",
          [ctx.organisationId, w.id, req.body.compte - regle, `Remise de ${t.livreur}, tournée du ${t.jour}`, ctx.utilisateurId],
        );
      }
      return { attendu: s, compte: req.body.compte, ecart: req.body.compte - s };
    }),
  );

  // Flotte
  app.post<{ Body: { entiteId: string; immatriculation: string; modele?: string } }>("/vehicules", {
    schema: { body: { type: "object", required: ["entiteId", "immatriculation"], properties: { entiteId: uuid, immatriculation: texte(30), modele: texte(100) } } },
  }, async (req, reponse) => {
    const v = await protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "transport.gerer", req.body.entiteId);
      return (await ctx.client.query("insert into vehicules (organisation_id, entite_id, immatriculation, modele) values ($1, $2, $3, $4) returning *", [ctx.organisationId, req.body.entiteId, req.body.immatriculation.trim().toUpperCase(), req.body.modele ?? null])).rows[0];
    });
    return reponse.status(201).send(v);
  });
  app.post<{ Params: { id: string }; Body: { type: string; montant: number; jour: string; kilometrage?: number; echeance?: string; note?: string } }>("/vehicules/:id/frais", {
    schema: {
      params: paramId,
      body: {
        type: "object", required: ["type", "montant", "jour"],
        properties: { type: { type: "string", enum: ["carburant", "maintenance", "assurance", "document", "autre"] }, montant: entier, jour: date, kilometrage: { type: "integer", minimum: 0, maximum: 10_000_000 }, echeance: date, note: texte(300) },
      },
    },
  }, async (req, reponse) => {
    await protege(req, async (ctx) => {
      const { rows: [v] } = await ctx.client.query("select entite_id from vehicules where id = $1", [req.params.id]);
      if (!v) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "transport.gerer", v.entite_id);
      const b = req.body;
      await ctx.client.query(
        "insert into frais_vehicule (organisation_id, vehicule_id, type, montant, jour, kilometrage, echeance, note) values ($1, $2, $3, $4, $5, $6, $7, $8)",
        [ctx.organisationId, req.params.id, b.type, b.montant, b.jour, b.kilometrage ?? null, b.echeance ?? null, b.note ?? null],
      );
    });
    return reponse.status(201).send({ ajoute: true });
  });
  /** Coût au kilomètre sur les kilométrages relevés, et documents qui expirent dans les 30 jours. */
  app.get("/vehicules", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "transport.voir");
      const { rows } = await ctx.client.query(
        `select v.*, coalesce((select sum(f.montant) from frais_vehicule f where f.vehicule_id = v.id), 0)::int8 as cout,
           (select max(f.kilometrage) - min(f.kilometrage) from frais_vehicule f where f.vehicule_id = v.id) as kilometres,
           (select min(f.echeance) from frais_vehicule f where f.vehicule_id = v.id and f.echeance >= current_date and f.echeance <= current_date + 30) as prochaine_echeance
         from vehicules v where v.entite_id = any($1::uuid[]) order by v.immatriculation`,
        [await ids(ctx, "transport.voir")],
      );
      return rows.map((v) => ({ ...v, cout_km: v.kilometres ? Math.round(v.cout / v.kilometres) : null }));
    }),
  );
  app.get("/transport/indicateurs", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "transport.voir");
      const { rows: [r] } = await ctx.client.query(
        `select count(*) filter (where statut = 'livre')::int as livres, count(*) filter (where statut = 'retour')::int as retours, count(*) filter (where statut = 'echec')::int as echecs,
           count(*) filter (where statut = 'livre' and prevu_le is not null and livre_le::date > prevu_le)::int as en_retard,
           round(avg(extract(epoch from livre_le - cree_le) / 3600) filter (where statut = 'livre'))::int as delai_heures, count(*)::int as total
         from colis where entite_id = any($1::uuid[])`,
        [await ids(ctx, "transport.voir")],
      );
      const fini = r.livres + r.retours + r.echecs;
      return { ...r, taux_reussite: fini ? Math.round((r.livres * 100) / fini) : null };
    }),
  );

  // Affiliation
  app.post<{ Body: { entiteId: string; tiersId: string; code: string; taux: number; joursRetour?: number } }>("/affilies", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "tiersId", "code", "taux"],
        properties: { entiteId: uuid, tiersId: uuid, code: { type: "string", pattern: "^[A-Za-z0-9]{3,20}$" }, taux: { type: "number", minimum: 0, maximum: 100 }, joursRetour: { type: "integer", minimum: 0, maximum: 365 } },
      },
    },
  }, async (req, reponse) => {
    const a = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "affiliation.gerer", b.entiteId);
      await lierTiers(ctx, b.tiersId, b.entiteId);
      return (await ctx.client.query(
        "insert into affilies (organisation_id, entite_id, tiers_id, code, taux, jours_retour) values ($1, $2, $3, $4, $5, $6) returning *",
        [ctx.organisationId, b.entiteId, b.tiersId, b.code.toUpperCase(), b.taux, b.joursRetour ?? 0],
      )).rows[0];
    });
    return reponse.status(201).send(a);
  });
  /** Classement par ce qui a été gagné. */
  app.get("/affilies", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "affiliation.voir");
      return (await ctx.client.query(
        `select a.id, a.code, a.taux::float, a.jours_retour, a.entite_id, t.nom, t.telephone,
           coalesce(sum(c.montant) filter (where c.statut = 'en_attente'), 0)::int8 as en_attente, coalesce(sum(c.montant) filter (where c.statut = 'validee'), 0)::int8 as a_payer,
           coalesce(sum(c.montant) filter (where c.statut = 'payee'), 0)::int8 as paye, count(c.id) filter (where c.statut <> 'annulee')::int as ventes
         from affilies a join tiers t on t.id = a.tiers_id left join commissions_affilie c on c.affilie_id = a.id
         where a.entite_id = any($1::uuid[]) group by a.id, t.nom, t.telephone order by coalesce(sum(c.montant) filter (where c.statut <> 'annulee'), 0) desc limit 500`,
        [await ids(ctx, "affiliation.voir")],
      )).rows;
    }),
  );

  /** La commission suit une facture émise de la même branche, une seule fois, et se valide après la période de retour. */
  app.post<{ Body: { code: string; numeroFacture: string } }>("/affilies/ventes", {
    schema: { body: { type: "object", required: ["code", "numeroFacture"], properties: { code: texte(20), numeroFacture: texte(100) } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const { rows: [a] } = await ctx.client.query("select *, entite_branche(entite_id) as b from affilies where code = $1 and actif", [req.body.code.trim().toUpperCase()]);
      if (!a) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "affiliation.gerer", a.entite_id);
      const { rows: [f] } = await ctx.client.query(
        "select id, total_ht, date_document, entite_branche(entite_id) as b from documents_vente where numero = $1 and type = 'facture' and statut <> 'brouillon'", [req.body.numeroFacture.trim()],
      );
      if (!f || f.b !== a.b) throw new ErreurApi(404, "introuvable");
      const { rows } = await ctx.client.query(
        `insert into commissions_affilie (organisation_id, affilie_id, facture_id, base, taux, montant, disponible_le)
         values ($1, $2, $3, $4, $5, $6, $7::date + $8::int) returning *`,
        [ctx.organisationId, a.id, f.id, f.total_ht, a.taux, commission(f.total_ht, Number(a.taux)), f.date_document, a.jours_retour],
      );
      return rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/affilies/commissions", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "affiliation.voir");
      return (await ctx.client.query(
        `select c.*, a.code, t.nom, d.numero as facture from commissions_affilie c join affilies a on a.id = c.affilie_id join tiers t on t.id = a.tiers_id join documents_vente d on d.id = c.facture_id
         where a.entite_id = any($1::uuid[]) order by c.statut = 'payee', c.cree_le desc limit 1000`,
        [await ids(ctx, "affiliation.voir")],
      )).rows;
    }),
  );
  const commissionVerrou = async (ctx: Contexte, id: string) => {
    const { rows: [c] } = await ctx.client.query(
      "select c.*, a.entite_id, a.code, entite_branche(a.entite_id) as b from commissions_affilie c join affilies a on a.id = c.affilie_id where c.id = $1 for update of c", [id],
    );
    if (!c) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, "affiliation.gerer", c.entite_id);
    return c;
  };
  /** Un avoir réduit la commission avant validation ; une facture entièrement reprise l'annule. */
  app.post<{ Params: { id: string } }>("/affilies/commissions/:id/validation", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const c = await commissionVerrou(ctx, req.params.id);
      if (c.statut !== "en_attente") throw new ErreurApi(409, "deja_decide");
      const { rows: [t] } = await ctx.client.query(
        `select (now() at time zone 'Africa/Douala')::date::text as jour,
           (select coalesce(sum(x.total_ht), 0) from documents_vente x where x.origine_id = $1 and x.type = 'avoir' and x.statut = 'emis')::int8 as avoirs`, [c.facture_id],
      );
      if (t.jour < c.disponible_le) throw new ErreurApi(409, "periode_retour_en_cours", { date: c.disponible_le });
      const base = c.base - t.avoirs;
      const montant = base > 0 ? commission(base, Number(c.taux)) : 0;
      const statut = montant > 0 ? "validee" : "annulee";
      await ctx.client.query("update commissions_affilie set base = $2, montant = $3, statut = $4 where id = $1", [c.id, Math.max(base, 0), montant, statut]);
      return { statut, montant };
    }),
  );
  app.post<{ Params: { id: string }; Body: { portefeuilleId: string; reference?: string } }>("/affilies/commissions/:id/paiement", {
    schema: { params: paramId, body: { type: "object", required: ["portefeuilleId"], properties: { portefeuilleId: uuid, reference: texte(200) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const c = await commissionVerrou(ctx, req.params.id);
      if (c.statut !== "validee") throw new ErreurApi(409, "commission_non_validee");
      await exigerSurEntite(ctx, "tresorerie.gerer", c.entite_id);
      const { rows: [w] } = await ctx.client.query("select id, actif, entite_branche(entite_id) as b from portefeuilles where id = $1 for update", [req.body.portefeuilleId]);
      if (!w) throw new ErreurApi(404, "introuvable");
      if (w.b !== c.b) throw new ErreurApi(409, "transfert_autre_branche");
      if (!w.actif) throw new ErreurApi(409, "portefeuille_inactif");
      const { rows: [{ s }] } = await ctx.client.query("select coalesce(sum(montant), 0)::int8 as s from mouvements_portefeuille where portefeuille_id = $1", [w.id]);
      if (c.montant > s) throw new ErreurApi(409, "solde_portefeuille_insuffisant");
      await ctx.client.query("update commissions_affilie set statut = 'payee', portefeuille_id = $2, reference = $3, paye_le = now() where id = $1", [c.id, w.id, req.body.reference ?? null]);
      await ctx.client.query(
        "insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, reference, auteur_id, source_type) values ($1, $2, 'sortie', $3, $4, $5, $6, 'commission')",
        [ctx.organisationId, w.id, -c.montant, `Commission affilié ${c.code}`, req.body.reference ?? null, ctx.utilisateurId],
      );
      return { statut: "payee" };
    }),
  );
}
