import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { dansOrganisation, publierEvenement, type Client } from "./base.js";
import { entitesAccessibles } from "./permissions.js";
import { normaliserTelephone } from "./securite.js";
import { ErreurApi, type Contexte, type Outils, type TachePlanifiee } from "./serveur.js";
import { lierTiers } from "./tiers.js";

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max = 300) => ({ type: "string", minLength: 1, maxLength: max }) as const;
const montant = { type: "integer", minimum: 1, maximum: 1_000_000_000_000 } as const;
const JOUR = "(now() at time zone 'Africa/Douala')::date";

/** Retire la remise en partant de la dernière tranche, sans jamais toucher ce qui est déjà payé. */
export function appliquerRemise(tranches: { id: string; montant: number }[], remise: number): { id: string; montant: number }[] {
  const r = tranches.map((t) => ({ ...t }));
  let reste = remise;
  for (let i = r.length - 1; i >= 0 && reste > 0; i--) { const x = Math.min(r[i]!.montant, reste); r[i]!.montant -= x; reste -= x; }
  return r;
}

export function enregistrerPedagogie(app: FastifyInstance, pool: pg.Pool, outils: Outils, taches: TachePlanifiee[]): void {
  const { protege, exiger, exigerSurEntite } = outils;
  const session = async (ctx: Contexte, id: string, p: "formations.voir" | "formations.gerer") => {
    const { rows: [s] } = await ctx.client.query("select * from sessions_formation where id = $1", [id]);
    if (!s) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, p, s.entite_id);
    return s;
  };
  const inscription = async (ctx: Contexte, id: string, p: "formations.voir" | "formations.gerer") => {
    const { rows: [i] } = await ctx.client.query("select i.*, s.entite_id from inscriptions i join sessions_formation s on s.id = i.session_id where i.id = $1 for update of i", [id]);
    if (!i) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, p, i.entite_id);
    return i;
  };

  // Liste d'attente
  app.post<{ Params: { id: string }; Body: { tiersId: string } }>("/sessions/:id/attente", {
    schema: { params: paramId, body: { type: "object", required: ["tiersId"], properties: { tiersId: uuid } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const s = await session(ctx, req.params.id, "formations.gerer");
      await lierTiers(ctx, req.body.tiersId, s.entite_id);
      const { rows: [a] } = await ctx.client.query("insert into attente_session (organisation_id, session_id, tiers_id) values ($1, $2, $3) on conflict do nothing returning id", [ctx.organisationId, s.id, req.body.tiersId]);
      if (!a) throw new ErreurApi(409, "deja_en_attente");
      return a;
    });
    return reponse.status(201).send(r);
  });
  app.get<{ Params: { id: string } }>("/sessions/:id/gestion", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await session(ctx, req.params.id, "formations.voir");
      const c = ctx.client;
      const [attente, couts, recettes, inscrits] = await Promise.all([
        c.query("select a.id, a.tiers_id, t.nom, t.telephone, a.cree_le from attente_session a join tiers t on t.id = a.tiers_id where a.session_id = $1 and a.statut = 'attente' order by a.cree_le", [req.params.id]),
        c.query("select id, nature, libelle, montant::int8 from couts_session where session_id = $1 order by cree_le", [req.params.id]),
        c.query("select coalesce(sum(p.montant), 0)::int8 as encaisse, (select coalesce(sum(e.montant), 0) from echeances e join inscriptions i on i.id = e.inscription_id where i.session_id = $1 and i.statut = 'active')::int8 as attendu from paiements p join inscriptions i on i.id = p.inscription_id where i.session_id = $1 and p.annule_le is null", [req.params.id]),
        c.query("select count(*)::int as n from inscriptions where session_id = $1 and statut = 'active'", [req.params.id]),
      ]);
      const cout = couts.rows.reduce((s, x) => s + Number(x.montant), 0);
      const { encaisse, attendu } = recettes.rows[0];
      return { attente: attente.rows, couts: couts.rows, inscrits: inscrits.rows[0].n, rentabilite: { attendu: Number(attendu), encaisse: Number(encaisse), cout, marge_attendue: Number(attendu) - cout, marge_encaissee: Number(encaisse) - cout } };
    }),
  );
  app.post<{ Params: { id: string } }>("/attente/:id/retrait", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [a] } = await ctx.client.query("select session_id from attente_session where id = $1", [req.params.id]);
      if (!a) throw new ErreurApi(404, "introuvable");
      await session(ctx, a.session_id, "formations.gerer");
      await ctx.client.query("update attente_session set statut = 'retire' where id = $1", [req.params.id]);
      return { retire: true };
    }),
  );

  // Coûts et rentabilité
  app.post<{ Params: { id: string }; Body: { nature: string; libelle: string; montant: number } }>("/sessions/:id/couts", {
    schema: { params: paramId, body: { type: "object", required: ["nature", "libelle", "montant"], properties: { nature: { type: "string", enum: ["salle", "formateur", "supports", "publicite", "autre"] }, libelle: texte(), montant } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      await session(ctx, req.params.id, "formations.gerer");
      return (await ctx.client.query("insert into couts_session (organisation_id, session_id, nature, libelle, montant, auteur_id) values ($1, $2, $3, $4, $5, $6) returning id", [ctx.organisationId, req.params.id, req.body.nature, req.body.libelle, req.body.montant, ctx.utilisateurId])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/programmes/rentabilite", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "formations.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "formations.voir")).map((e) => e.id);
      const { rows } = await ctx.client.query(
        `select p.id, p.nom, count(distinct s.id)::int as sessions, (select count(*)::int from inscriptions i join sessions_formation x on x.id = i.session_id where x.programme_id = p.id and i.statut = 'active') as inscrits,
           (select coalesce(sum(a.montant), 0)::int8 from paiements a join inscriptions i on i.id = a.inscription_id join sessions_formation x on x.id = i.session_id where x.programme_id = p.id and a.annule_le is null) as encaisse,
           (select coalesce(sum(c.montant), 0)::int8 from couts_session c join sessions_formation x on x.id = c.session_id where x.programme_id = p.id) as cout
         from programmes p left join sessions_formation s on s.programme_id = p.id where p.entite_id = any($1::uuid[]) group by p.id order by p.nom`, [ids],
      );
      return rows.map((r) => ({ ...r, encaisse: Number(r.encaisse), cout: Number(r.cout), marge: Number(r.encaisse) - Number(r.cout) }));
    }),
  );

  // Évaluations et remarques du formateur
  app.post<{ Params: { id: string }; Body: { type: string; note?: number; commentaire?: string } }>("/inscriptions/:id/evaluations", {
    schema: { params: paramId, body: { type: "object", required: ["type"], properties: { type: { type: "string", enum: ["test_debut", "test_fin", "remarque"] }, note: { type: "number", minimum: 0, maximum: 20 }, commentaire: texte(2000) } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      await inscription(ctx, req.params.id, "formations.gerer");
      return (await ctx.client.query("insert into evaluations_session (organisation_id, inscription_id, type, note, commentaire, auteur_id) values ($1, $2, $3, $4, $5, $6) returning id", [ctx.organisationId, req.params.id, req.body.type, req.body.note ?? null, req.body.commentaire ?? null, ctx.utilisateurId])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get<{ Params: { id: string } }>("/inscriptions/:id/evaluations", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await inscription(ctx, req.params.id, "formations.voir");
      return (await ctx.client.query("select type, note::float, commentaire, cree_le from evaluations_session where inscription_id = $1 order by cree_le", [req.params.id])).rows;
    }),
  );

  // Codes promotionnels
  app.post<{ Body: { entiteId: string; code: string; type: string; valeur: number; debut: string; fin: string; maxUsages?: number } }>("/codes-promo", {
    schema: { body: { type: "object", required: ["entiteId", "code", "type", "valeur", "debut", "fin"], properties: { entiteId: uuid, code: { type: "string", pattern: "^[A-Z0-9_]{3,30}$" }, type: { type: "string", enum: ["pourcentage", "montant"] }, valeur: montant, debut: date, fin: date, maxUsages: { type: "integer", minimum: 1 } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "formations.gerer", b.entiteId);
      if (b.type === "pourcentage" && b.valeur > 100) throw new ErreurApi(400, "pourcentage_invalide");
      if (b.fin < b.debut) throw new ErreurApi(400, "dates_invalides");
      return (await ctx.client.query("insert into codes_promo (organisation_id, entite_id, code, type, valeur, debut, fin, max_usages) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id", [ctx.organisationId, b.entiteId, b.code, b.type, b.valeur, b.debut, b.fin, b.maxUsages ?? null])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/codes-promo", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "formations.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "formations.voir")).map((e) => e.id);
      return (await ctx.client.query("select id, code, type, valeur, debut::text, fin::text, max_usages, usages, actif from codes_promo where entite_id = any($1::uuid[]) order by fin desc limit 200", [ids])).rows;
    }),
  );
  /** Une seule remise par inscrit, sans descendre sous ce qui est déjà encaissé. */
  app.post<{ Params: { id: string }; Body: { code: string } }>("/inscriptions/:id/code-promo", {
    schema: { params: paramId, body: { type: "object", required: ["code"], properties: { code: texte(30) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const i = await inscription(ctx, req.params.id, "formations.gerer");
      const { rows: [c] } = await ctx.client.query(
        `with recursive a as (select id, parent_id from entites where id = $2 union all select e.id, e.parent_id from entites e join a on e.id = a.parent_id)
         select * from codes_promo where code = $1 and actif and entite_id in (select id from a) and ${JOUR} between debut and fin and (max_usages is null or usages < max_usages) for update`, [req.body.code.toUpperCase(), i.entite_id],
      );
      if (!c) throw new ErreurApi(404, "code_promo_invalide");
      const { rows: tr } = await ctx.client.query("select id, montant::int8 from echeances where inscription_id = $1 order by ordre", [i.id]);
      const total = tr.reduce((s, t) => s + Number(t.montant), 0);
      const { rows: [{ paye }] } = await ctx.client.query("select coalesce(sum(montant), 0)::int8 as paye from paiements where inscription_id = $1 and annule_le is null", [i.id]);
      const voulue = c.type === "pourcentage" ? Math.round((total * Number(c.valeur)) / 100) : Number(c.valeur);
      const remise = Math.min(voulue, total - Number(paye));
      if (remise <= 0) throw new ErreurApi(409, "rien_a_remiser");
      const { rowCount } = await ctx.client.query("insert into usages_code_promo (organisation_id, code_id, inscription_id, remise, auteur_id) values ($1, $2, $3, $4, $5) on conflict do nothing", [ctx.organisationId, c.id, i.id, remise, ctx.utilisateurId]);
      if (!rowCount) throw new ErreurApi(409, "code_deja_utilise");
      for (const t of appliquerRemise(tr.map((x) => ({ id: x.id, montant: Number(x.montant) })), remise)) {
        if (t.montant === 0) await ctx.client.query("delete from echeances where id = $1", [t.id]);
        else await ctx.client.query("update echeances set montant = $2 where id = $1", [t.id, t.montant]);
      }
      await ctx.client.query("update codes_promo set usages = usages + 1 where id = $1", [c.id]);
      return { remise };
    }),
  );

  // Formation en entreprise
  app.post<{ Body: { entiteId: string; tiersId: string; besoin: string; effectif?: number } }>("/demandes-b2b", {
    schema: { body: { type: "object", required: ["entiteId", "tiersId", "besoin"], properties: { entiteId: uuid, tiersId: uuid, besoin: texte(3000), effectif: { type: "integer", minimum: 1 } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "formations.gerer", b.entiteId);
      await lierTiers(ctx, b.tiersId, b.entiteId);
      return (await ctx.client.query("insert into demandes_b2b (organisation_id, entite_id, tiers_id, besoin, effectif) values ($1, $2, $3, $4, $5) returning id, statut", [ctx.organisationId, b.entiteId, b.tiersId, b.besoin, b.effectif ?? null])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/demandes-b2b", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "formations.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "formations.voir")).map((e) => e.id);
      return (await ctx.client.query("select d.id, d.besoin, d.effectif, d.statut, d.rapport, d.session_id, t.nom as entreprise from demandes_b2b d join tiers t on t.id = d.tiers_id where d.entite_id = any($1::uuid[]) order by d.cree_le desc limit 200", [ids])).rows;
    }),
  );
  app.patch<{ Params: { id: string }; Body: { statut?: string; rapport?: string; sessionId?: string } }>("/demandes-b2b/:id", {
    schema: { params: paramId, body: { type: "object", minProperties: 1, properties: { statut: { type: "string", enum: ["recue", "devis", "planifiee", "realisee", "abandonnee"] }, rapport: texte(5000), sessionId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [d] } = await ctx.client.query("select entite_id from demandes_b2b where id = $1", [req.params.id]);
      if (!d) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "formations.gerer", d.entite_id);
      if (req.body.sessionId) await session(ctx, req.body.sessionId, "formations.gerer");
      await ctx.client.query("update demandes_b2b set statut = coalesce($2, statut), rapport = coalesce($3, rapport), session_id = coalesce($4, session_id) where id = $1", [req.params.id, req.body.statut ?? null, req.body.rapport ?? null, req.body.sessionId ?? null]);
      return { enregistre: true };
    }),
  );

  // Banque de questions
  const coursGere = async (ctx: Contexte, id: string, p: "apprentissage.voir" | "apprentissage.gerer" = "apprentissage.gerer") => {
    const { rows: [c] } = await ctx.client.query("select * from cours where id = $1", [id]);
    if (!c) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, p, c.entite_id);
    return c;
  };
  app.post<{ Body: { entiteId: string; theme: string; niveau?: number; enonce: string; choix: string[]; bonne: number; explication?: string } }>("/banque-questions", {
    schema: { body: { type: "object", required: ["entiteId", "theme", "enonce", "choix", "bonne"], properties: { entiteId: uuid, theme: texte(100), niveau: { type: "integer", minimum: 1, maximum: 5 }, enonce: texte(1000), choix: { type: "array", minItems: 2, maxItems: 8, items: texte(500) }, bonne: { type: "integer", minimum: 0 }, explication: texte(1000) } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "apprentissage.gerer", b.entiteId);
      if (b.bonne >= b.choix.length) throw new ErreurApi(400, "bonne_reponse_invalide");
      return (await ctx.client.query("insert into banque_questions (organisation_id, entite_id, theme, niveau, enonce, choix, bonne, explication) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id", [ctx.organisationId, b.entiteId, b.theme, b.niveau ?? 1, b.enonce, JSON.stringify(b.choix), b.bonne, b.explication ?? null])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/banque-questions", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "apprentissage.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "apprentissage.voir")).map((e) => e.id);
      return (await ctx.client.query("select theme, count(*)::int as nombre, min(niveau)::int as niveau_min, max(niveau)::int as niveau_max from banque_questions where entite_id = any($1::uuid[]) group by theme order by theme", [ids])).rows;
    }),
  );
  /** Tire au hasard des questions du thème et les ajoute au quiz de la leçon, que le formateur relit ensuite. */
  app.post<{ Params: { id: string }; Body: { theme: string; nombre: number } }>("/lecons/:id/tirage", {
    schema: { params: paramId, body: { type: "object", required: ["theme", "nombre"], properties: { theme: texte(100), nombre: { type: "integer", minimum: 1, maximum: 50 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [l] } = await ctx.client.query("select l.id, l.cours_id, l.questions, c.entite_id from lecons l join cours c on c.id = l.cours_id where l.id = $1 for update of l", [req.params.id]);
      if (!l) throw new ErreurApi(404, "introuvable");
      await coursGere(ctx, l.cours_id);
      const { rows } = await ctx.client.query(
        `with recursive a as (select id, parent_id from entites where id = $3 union all select e.id, e.parent_id from entites e join a on e.id = a.parent_id)
         select enonce, choix, bonne from banque_questions where theme = $1 and entite_id in (select id from a) order by random() limit $2`, [req.body.theme, req.body.nombre, l.entite_id],
      );
      if (!rows.length) throw new ErreurApi(404, "theme_vide");
      await ctx.client.query("update lecons set questions = $2 where id = $1", [l.id, JSON.stringify([...(l.questions as object[]), ...rows])]);
      return { ajoutees: rows.length };
    }),
  );

  // Devoirs et questions au formateur
  app.post<{ Params: { id: string }; Body: { titre: string; consigne: string; echeance?: string } }>("/cours/:id/devoirs", {
    schema: { params: paramId, body: { type: "object", required: ["titre", "consigne"], properties: { titre: texte(), consigne: texte(5000), echeance: date } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      await coursGere(ctx, req.params.id);
      return (await ctx.client.query("insert into devoirs (organisation_id, cours_id, titre, consigne, echeance) values ($1, $2, $3, $4, $5) returning id", [ctx.organisationId, req.params.id, req.body.titre, req.body.consigne, req.body.echeance ?? null])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get<{ Params: { id: string } }>("/cours/:id/animation", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await coursGere(ctx, req.params.id, "apprentissage.voir");
      const c = ctx.client;
      const [devoirs, questions, risque] = await Promise.all([
        c.query(`select d.id, d.titre, d.consigne, d.echeance::text, coalesce(json_agg(json_build_object('id', r.id, 'nom', t.nom, 'contenu', r.contenu, 'note', r.note, 'commentaire', r.commentaire)) filter (where r.id is not null), '[]') as rendus
                 from devoirs d left join rendus_devoir r on r.devoir_id = d.id left join acces_cours a on a.id = r.acces_id left join tiers t on t.id = a.tiers_id where d.cours_id = $1 group by d.id order by d.titre`, [req.params.id]),
        c.query("select id, auteur, question, reponse, cree_le from questions_cours where cours_id = $1 order by reponse is not null, cree_le desc limit 200", [req.params.id]),
        c.query("select t.nom, t.telephone, a.derniere_activite from acces_cours a join tiers t on t.id = a.tiers_id where a.cours_id = $1 and a.actif and a.termine_le is null and (a.derniere_activite is null or a.derniere_activite < now() - interval '14 days') order by a.derniere_activite nulls first limit 200", [req.params.id]),
      ]);
      return { devoirs: devoirs.rows, questions: questions.rows, a_risque: risque.rows };
    }),
  );
  app.post<{ Params: { id: string }; Body: { note: number; commentaire?: string } }>("/rendus/:id/correction", {
    schema: { params: paramId, body: { type: "object", required: ["note"], properties: { note: { type: "number", minimum: 0, maximum: 20 }, commentaire: texte(2000) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [r] } = await ctx.client.query("select d.cours_id from rendus_devoir r join devoirs d on d.id = r.devoir_id where r.id = $1", [req.params.id]);
      if (!r) throw new ErreurApi(404, "introuvable");
      await coursGere(ctx, r.cours_id);
      await ctx.client.query("update rendus_devoir set note = $2, commentaire = $3, corrige_par = $4 where id = $1", [req.params.id, req.body.note, req.body.commentaire ?? null, ctx.utilisateurId]);
      return { corrige: true };
    }),
  );
  app.post<{ Params: { id: string }; Body: { reponse: string } }>("/questions-cours/:id/reponse", {
    schema: { params: paramId, body: { type: "object", required: ["reponse"], properties: { reponse: texte(3000) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [q] } = await ctx.client.query("select cours_id from questions_cours where id = $1", [req.params.id]);
      if (!q) throw new ErreurApi(404, "introuvable");
      await coursGere(ctx, q.cours_id);
      await ctx.client.query("update questions_cours set reponse = $2, repondu_par = $3 where id = $1", [req.params.id, req.body.reponse, ctx.utilisateurId]);
      return { repondu: true };
    }),
  );
  const CODE = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{16,}$/;
  const dansApprenant = <T>(code: string, fn: (c: Client, a: Record<string, any>, org: string) => Promise<T>) => {
    if (!CODE.test(code)) throw new ErreurApi(404, "introuvable");
    const [org, secret] = code.split(".") as [string, string];
    return dansOrganisation(pool, org, async (c) => {
      const { rows: [a] } = await c.query("select a.id, a.cours_id, a.tiers_id, t.nom, c.publie from acces_cours a join tiers t on t.id = a.tiers_id join cours c on c.id = a.cours_id where a.code = $1 and a.actif and c.publie", [secret]);
      if (!a) throw new ErreurApi(404, "introuvable");
      const { rows: b } = await c.query("select 1 from blocages_tiers where tiers_id = $1 and portee = 'cours' and leve_le is null", [a.tiers_id]);
      if (b[0]) throw new ErreurApi(409, "client_bloque");
      return fn(c, a, org);
    }).catch((e) => { if (e.code === "22P02") throw new ErreurApi(404, "introuvable"); throw e; });
  };
  app.get<{ Params: { code: string } }>("/apprendre/:code/echanges", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) =>
    dansApprenant(req.params.code, async (c, a) => {
      const { rows: devoirs } = await c.query("select d.id, d.titre, d.consigne, d.echeance::text, r.contenu, r.note, r.commentaire from devoirs d left join rendus_devoir r on r.devoir_id = d.id and r.acces_id = $2 where d.cours_id = $1 order by d.titre", [a.cours_id, a.id]);
      const { rows: questions } = await c.query("select auteur, question, reponse from questions_cours where cours_id = $1 and reponse is not null order by cree_le desc limit 100", [a.cours_id]);
      const { rows: mes } = await c.query("select question, reponse from questions_cours where acces_id = $1 order by cree_le desc limit 50", [a.id]);
      const { rows: [{ points }] } = await c.query("select (count(*) filter (where terminee_le is not null) * 10 + coalesce(sum(score) filter (where terminee_le is not null), 0) / 10)::int as points from progressions where acces_id = $1", [a.id]);
      return { devoirs, questions, mes_questions: mes, points };
    }),
  );
  app.post<{ Params: { code: string; id: string }; Body: { contenu: string } }>("/apprendre/:code/devoirs/:id", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: { body: { type: "object", required: ["contenu"], properties: { contenu: texte(20000) } } },
  }, async (req, reponse) => {
    const r = await dansApprenant(req.params.code, async (c, a, org) => {
      const { rows: [d] } = await c.query("select id from devoirs where id = $1 and cours_id = $2", [req.params.id, a.cours_id]);
      if (!d) throw new ErreurApi(404, "introuvable");
      const { rows: [x] } = await c.query("insert into rendus_devoir (organisation_id, devoir_id, acces_id, contenu) values ($1, $2, $3, $4) on conflict (organisation_id, devoir_id, acces_id) do update set contenu = excluded.contenu, rendu_le = now() where rendus_devoir.note is null returning id", [org, d.id, a.id, req.body.contenu]);
      if (!x) throw new ErreurApi(409, "devoir_deja_corrige");
      return x;
    });
    return reponse.status(201).send(r);
  });
  app.post<{ Params: { code: string }; Body: { question: string } }>("/apprendre/:code/questions", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: { body: { type: "object", required: ["question"], properties: { question: texte(2000) } } },
  }, async (req, reponse) => {
    await dansApprenant(req.params.code, async (c, a, org) => c.query("insert into questions_cours (organisation_id, cours_id, acces_id, auteur, question) values ($1, $2, $3, $4, $5)", [org, a.cours_id, a.id, a.nom, req.body.question]));
    return reponse.status(201).send({ recu: true });
  });

  // Parcours : le cours suivant s'ouvre quand le précédent est terminé.
  app.post<{ Body: { entiteId: string; nom: string; cours: string[] } }>("/parcours-cours", {
    schema: { body: { type: "object", required: ["entiteId", "nom", "cours"], properties: { entiteId: uuid, nom: texte(200), cours: { type: "array", minItems: 2, maxItems: 30, uniqueItems: true, items: uuid } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "apprentissage.gerer", req.body.entiteId);
      for (const c of req.body.cours) await coursGere(ctx, c);
      return (await ctx.client.query("insert into parcours_cours (organisation_id, entite_id, nom, cours) values ($1, $2, $3, $4) returning id", [ctx.organisationId, req.body.entiteId, req.body.nom, req.body.cours])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/parcours-cours", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "apprentissage.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "apprentissage.voir")).map((e) => e.id);
      return (await ctx.client.query("select p.id, p.nom, (select array_agg(c.titre order by array_position(p.cours, c.id)) from cours c where c.id = any(p.cours)) as cours, (select count(*)::int from membres_parcours m where m.parcours_id = p.id) as membres from parcours_cours p where p.entite_id = any($1::uuid[]) order by p.nom", [ids])).rows;
    }),
  );
  const ouvrirSuivant = async (c: Client, org: string, cours: string[], tiers: string) => {
    for (const id of cours) {
      const { rows: [a] } = await c.query("select id, code, termine_le from acces_cours where cours_id = $1 and tiers_id = $2 and actif", [id, tiers]);
      if (a?.termine_le) continue;
      if (a) return { ouvert: false };
      await c.query("insert into acces_cours (organisation_id, cours_id, tiers_id, code) values ($1, $2, $3, $4) on conflict do nothing", [org, id, tiers, randomBytes(16).toString("base64url")]);
      await publierEvenement(c, "parcours.cours_ouvert", { cours: id, tiers });
      return { ouvert: true };
    }
    return { ouvert: false };
  };
  app.post<{ Params: { id: string }; Body: { tiersId: string } }>("/parcours-cours/:id/membres", {
    schema: { params: paramId, body: { type: "object", required: ["tiersId"], properties: { tiersId: uuid } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const { rows: [p] } = await ctx.client.query("select * from parcours_cours where id = $1", [req.params.id]);
      if (!p) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "apprentissage.gerer", p.entite_id);
      await lierTiers(ctx, req.body.tiersId, p.entite_id);
      await ctx.client.query("insert into membres_parcours (organisation_id, parcours_id, tiers_id) values ($1, $2, $3) on conflict do nothing", [ctx.organisationId, p.id, req.body.tiersId]);
      return ouvrirSuivant(ctx.client, ctx.organisationId, p.cours, req.body.tiersId);
    });
    return reponse.status(201).send(r);
  });
  taches.push((org) => dansOrganisation(pool, org, async (c) => {
    const { rows } = await c.query("select p.cours, m.tiers_id from membres_parcours m join parcours_cours p on p.id = m.parcours_id");
    for (const m of rows) await ouvrirSuivant(c, org, m.cours, m.tiers_id);
  }));

  // Boutique publique de cours : la demande arrive en prospection, l'accès s'ouvre après paiement.
  app.put<{ Params: { id: string }; Body: { enBoutique: boolean; prix: number } }>("/cours/:id/boutique", {
    schema: { params: paramId, body: { type: "object", required: ["enBoutique", "prix"], properties: { enBoutique: { type: "boolean" }, prix: { type: "integer", minimum: 0, maximum: 100_000_000 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await coursGere(ctx, req.params.id);
      await ctx.client.query("update cours set en_boutique = $2, prix = $3 where id = $1", [req.params.id, req.body.enBoutique, req.body.prix]);
      return { enregistre: true };
    }),
  );
  const dansBoutique = <T>(org: string, fn: (c: Client) => Promise<T>) =>
    dansOrganisation(pool, org, fn).catch((e) => { if (e.code === "22P02") throw new ErreurApi(404, "introuvable"); throw e; });
  app.get<{ Params: { org: string } }>("/boutique/:org", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } }, schema: { params: { type: "object", properties: { org: uuid } } } }, async (req) =>
    dansBoutique(req.params.org, async (c) => (await c.query("select c.id, c.titre, c.description, c.prix::int8, (select count(*)::int from lecons l where l.cours_id = c.id) as lecons from cours c where c.en_boutique and c.publie order by c.titre limit 500")).rows),
  );
  app.post<{ Params: { org: string; id: string }; Body: { nom: string; telephone?: string; email?: string; consentement: boolean; site?: string } }>("/boutique/:org/cours/:id/demande", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: { params: { type: "object", properties: { org: uuid, id: uuid } }, body: { type: "object", required: ["nom", "consentement"], properties: { nom: texte(200), telephone: { type: "string", maxLength: 30 }, email: { type: "string", format: "email", maxLength: 320 }, consentement: { type: "boolean" }, site: { type: "string", maxLength: 200 } } } },
  }, async (req, reponse) => {
    const b = req.body;
    if (b.site) return reponse.status(201).send({ recu: true });
    if (b.consentement !== true) throw new ErreurApi(400, "consentement_obligatoire");
    const tel = b.telephone?.trim() ? normaliserTelephone(b.telephone) : null;
    const email = b.email?.trim().toLowerCase() || null;
    if (!tel && !email) throw new ErreurApi(400, "contact_obligatoire");
    await dansBoutique(req.params.org, async (c) => {
      const { rows: [x] } = await c.query("select c.id, c.titre, c.prix, c.entite_id, entite_branche(c.entite_id) as branche from cours c where c.id = $1 and c.en_boutique and c.publie", [req.params.id]);
      if (!x) throw new ErreurApi(404, "introuvable");
      const { rows: [t] } = await c.query("select id from tiers where branche_id = $1 and not archive and ((telephone is not null and telephone = $2) or (email is not null and email = $3)) limit 1", [x.branche, tel, email]);
      const tiers = t?.id ?? (await c.query("insert into tiers (organisation_id, type, nom, email, telephone, roles, entite_origine_id, branche_id) values ($1, 'personne', $2, $3, $4, '{prospect}', $5, $6) returning id", [req.params.org, b.nom.trim(), email, tel, x.entite_id, x.branche])).rows[0].id;
      const { rows: mod } = await c.query("select 1 from modules_entite where entite_id = $1 and module = 'crm' and actif", [x.entite_id]);
      const entite = mod[0] ? x.entite_id : x.branche;
      await c.query("insert into opportunites (organisation_id, entite_id, tiers_id, titre, montant_estime, source) values ($1, $2, $3, $4, $5, 'Boutique de cours')", [req.params.org, entite, tiers, `Cours : ${x.titre}`.slice(0, 200), x.prix]);
    });
    return reponse.status(201).send({ recu: true });
  });
}
