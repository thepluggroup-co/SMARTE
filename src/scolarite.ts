import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { dansOrganisation, type Client } from "./base.js";
import { prochainNumero } from "./formations.js";
import { chiffrer, dechiffrer } from "./securite.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max = 200) => ({ type: "string", minLength: 1, maxLength: max }) as const;
const montant = { type: "integer", minimum: 1, maximum: 1_000_000_000_000 } as const;
const annee = { type: "string", pattern: "^[0-9]{4}-[0-9]{4}$" } as const;
const mois = { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" } as const;
const heure = { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" } as const;
const JOUR = "(now() at time zone 'Africa/Douala')::date";

/** Les bourses couvrent d'abord les dernières tranches, les paiements les premières. */
export function situationScolarite(frais: { montant: number; echeance: string }[], bourses: number, paye: number, jour: string) {
  const du = frais.reduce((s, f) => s + f.montant, 0);
  const net = Math.max(du - bourses, 0);
  let cumulNet = 0, echu = 0;
  let resteBourse = bourses;
  const ordre = [...frais].sort((a, b) => a.echeance.localeCompare(b.echeance));
  const nets = ordre.map((f) => f.montant);
  for (let i = nets.length - 1; i >= 0 && resteBourse > 0; i--) { const x = Math.min(nets[i]!, resteBourse); nets[i]! -= x; resteBourse -= x; }
  ordre.forEach((f, i) => { cumulNet += nets[i]!; if (f.echeance <= jour) echu = cumulNet; });
  return { du, bourses, net, paye, trop_percu: Math.max(paye - net, 0), reste: Math.max(net - paye, 0), impaye_echu: Math.max(echu - paye, 0), acces_examen: echu <= paye };
}
export async function resteScolarite(c: Client, inscriptionId: string, jour: string) {
  const { rows: [i] } = await c.query("select filiere_id, annee from inscriptions_univ where id = $1", [inscriptionId]);
  const { rows: frais } = await c.query("select montant::int8, echeance::text from frais_filiere where filiere_id = $1 and annee = $2", [i.filiere_id, i.annee]);
  const { rows: [{ b }] } = await c.query("select coalesce(sum(montant), 0)::int8 as b from bourses_univ where inscription_id = $1", [inscriptionId]);
  const { rows: [{ p }] } = await c.query("select coalesce(sum(montant), 0)::int8 as p from paiements_univ where inscription_id = $1 and annule_le is null", [inscriptionId]);
  return situationScolarite(frais.map((f) => ({ montant: Number(f.montant), echeance: f.echeance })), Number(b), Number(p), jour);
}

export function enregistrerScolariteEtPaie(app: FastifyInstance, pool: pg.Pool, outils: Outils, cle: Buffer): void {
  const { protege, exigerSurEntite } = outils;
  const filiere = async (ctx: Contexte, id: string, p: "universite.voir" | "universite.gerer" | "universite.notes") => {
    const { rows: [f] } = await ctx.client.query("select * from filieres where id = $1", [id]);
    if (!f) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, p, f.entite_id);
    return f;
  };
  const inscription = async (ctx: Contexte, id: string, p: "universite.voir" | "universite.gerer" | "universite.notes") => {
    const { rows: [i] } = await ctx.client.query("select i.*, t.nom from inscriptions_univ i join tiers t on t.id = i.tiers_id where i.id = $1", [id]);
    if (!i) throw new ErreurApi(404, "introuvable");
    const f = await filiere(ctx, i.filiere_id, p);
    return { ...i, entite_id: f.entite_id };
  };

  // Frais, bourses et paiements
  app.post<{ Params: { id: string }; Body: { annee: string; libelle: string; montant: number; echeance: string } }>("/filieres/:id/frais", {
    schema: { params: paramId, body: { type: "object", required: ["annee", "libelle", "montant", "echeance"], properties: { annee, libelle: texte(), montant, echeance: date } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      await filiere(ctx, req.params.id, "universite.gerer");
      const b = req.body;
      return (await ctx.client.query("insert into frais_filiere (organisation_id, filiere_id, annee, libelle, montant, echeance) values ($1, $2, $3, $4, $5, $6) returning id", [ctx.organisationId, req.params.id, b.annee, b.libelle, b.montant, b.echeance])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get<{ Params: { id: string }; Querystring: { annee: string } }>("/filieres/:id/scolarite", {
    schema: { params: paramId, querystring: { type: "object", required: ["annee"], properties: { annee } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await filiere(ctx, req.params.id, "universite.voir");
      const { rows: [{ jour }] } = await ctx.client.query(`select ${JOUR}::text as jour`);
      const { rows: frais } = await ctx.client.query("select id, libelle, montant::int8, echeance::text from frais_filiere where filiere_id = $1 and annee = $2 order by echeance", [req.params.id, req.query.annee]);
      const { rows: ins } = await ctx.client.query("select i.id, i.matricule, t.nom from inscriptions_univ i join tiers t on t.id = i.tiers_id where i.filiere_id = $1 and i.annee = $2 order by t.nom", [req.params.id, req.query.annee]);
      const etudiants = [];
      for (const i of ins) etudiants.push({ ...i, ...(await resteScolarite(ctx.client, i.id, jour)) });
      return { frais, etudiants };
    }),
  );
  app.post<{ Params: { id: string }; Body: { libelle: string; montant: number } }>("/inscriptions-univ/:id/bourses", {
    schema: { params: paramId, body: { type: "object", required: ["libelle", "montant"], properties: { libelle: texte(), montant } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      await inscription(ctx, req.params.id, "universite.gerer");
      return (await ctx.client.query("insert into bourses_univ (organisation_id, inscription_id, libelle, montant, auteur_id) values ($1, $2, $3, $4, $5) returning id", [ctx.organisationId, req.params.id, req.body.libelle, req.body.montant, ctx.utilisateurId])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.post<{ Params: { id: string }; Body: { montant: number; portefeuilleId: string; reference?: string } }>("/inscriptions-univ/:id/paiements", {
    schema: { params: paramId, body: { type: "object", required: ["montant", "portefeuilleId"], properties: { montant, portefeuilleId: uuid, reference: texte(100) } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const i = await inscription(ctx, req.params.id, "universite.gerer");
      const { rows: [{ jour }] } = await ctx.client.query(`select ${JOUR}::text as jour`);
      await ctx.client.query("select 1 from inscriptions_univ where id = $1 for update", [i.id]);
      const s = await resteScolarite(ctx.client, i.id, jour);
      if (req.body.montant > s.reste) throw new ErreurApi(409, "paiement_superieur_au_reste", { reste: s.reste });
      const { rows: [w] } = await ctx.client.query("select id, actif, entite_branche(entite_id) as branche, entite_branche($2) as attendue from portefeuilles where id = $1", [req.body.portefeuilleId, i.entite_id]);
      if (!w) throw new ErreurApi(404, "introuvable");
      if (w.branche !== w.attendue) throw new ErreurApi(409, "transfert_autre_branche");
      if (!w.actif) throw new ErreurApi(409, "portefeuille_inactif");
      const numero = await prochainNumero(ctx.client, `SCO-${jour.slice(0, 4)}`);
      const { rows: [p] } = await ctx.client.query("insert into paiements_univ (organisation_id, inscription_id, portefeuille_id, montant, reference, numero, auteur_id) values ($1, $2, $3, $4, $5, $6, $7) returning id, numero, montant", [ctx.organisationId, i.id, w.id, req.body.montant, req.body.reference ?? null, numero, ctx.utilisateurId]);
      await ctx.client.query("insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, reference, auteur_id, source_type) values ($1, $2, 'entree', $3, $4, $5, $6, 'scolarite')", [ctx.organisationId, w.id, req.body.montant, `Scolarité ${i.matricule} ${i.nom}`.slice(0, 300), numero, ctx.utilisateurId]);
      return p;
    });
    return reponse.status(201).send(r);
  });

  /** Annule un reçu de scolarité par un mouvement inverse. */
  app.post<{ Params: { id: string }; Body: { motif: string } }>("/paiements-univ/:id/annulation", {
    schema: { params: paramId, body: { type: "object", required: ["motif"], properties: { motif: { type: "string", minLength: 5, maxLength: 500 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [p] } = await ctx.client.query("select * from paiements_univ where id = $1 for update", [req.params.id]);
      if (!p) throw new ErreurApi(404, "introuvable");
      await inscription(ctx, p.inscription_id, "universite.gerer");
      if (p.annule_le) throw new ErreurApi(409, "deja_annule");
      const { rows: [w] } = await ctx.client.query("select coalesce(sum(montant), 0)::int8 as s from mouvements_portefeuille where portefeuille_id = $1", [p.portefeuille_id]);
      if (Number(p.montant) > Number(w.s)) throw new ErreurApi(409, "solde_portefeuille_insuffisant");
      const { rows: [m] } = await ctx.client.query("select id from mouvements_portefeuille where source_type = 'scolarite' and reference = $1 and portefeuille_id = $2 and montant > 0", [p.numero, p.portefeuille_id]);
      await ctx.client.query("update paiements_univ set annule_le = now(), motif_annulation = $2 where id = $1", [p.id, req.body.motif]);
      await ctx.client.query("insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, reference, auteur_id, source_type, annule_mouvement_id) values ($1, $2, 'annulation', $3, $4, $5, $6, 'scolarite', $7)", [ctx.organisationId, p.portefeuille_id, -Number(p.montant), `Annulation scolarité : ${req.body.motif}`.slice(0, 300), p.numero, ctx.utilisateurId, m?.id ?? null]);
      return { annule: true };
    }),
  );

  // Emploi du temps : un conflit de salle, d'enseignant ou de semestre est refusé.
  app.post<{ Params: { id: string }; Body: { ueId: string; annee: string; jour: string; debut: string; fin: string; salle?: string; enseignantId?: string } }>("/filieres/:id/cours", {
    schema: { params: paramId, body: { type: "object", required: ["ueId", "annee", "jour", "debut", "fin"], properties: { ueId: uuid, annee, jour: date, debut: heure, fin: heure, salle: texte(100), enseignantId: uuid } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const f = await filiere(ctx, req.params.id, "universite.gerer");
      const b = req.body;
      if (b.fin <= b.debut) throw new ErreurApi(400, "dates_invalides");
      const { rows: [ue] } = await ctx.client.query("select id, semestre from unites_enseignement where id = $1 and filiere_id = $2", [b.ueId, f.id]);
      if (!ue) throw new ErreurApi(404, "introuvable");
      // Le verrou évite que deux saisies simultanées passent le même contrôle.
      await ctx.client.query("select pg_advisory_xact_lock(hashtext($1))", [`emploi:${ctx.organisationId}:${b.jour}`]);
      const { rows } = await ctx.client.query(
        `select c.salle, c.enseignant_id, c.debut::text, c.fin::text, u.code, u.filiere_id, u.semestre from cours_planifies c join unites_enseignement u on u.id = c.ue_id
         where c.jour = $1 and c.debut < $3 and c.fin > $2`, [b.jour, b.debut, b.fin],
      );
      for (const x of rows) {
        if (b.salle && x.salle === b.salle) throw new ErreurApi(409, "conflit_salle", { cours: x.code });
        if (b.enseignantId && x.enseignant_id === b.enseignantId) throw new ErreurApi(409, "conflit_enseignant", { cours: x.code });
        if (x.filiere_id === f.id && x.semestre === ue.semestre) throw new ErreurApi(409, "conflit_promotion", { cours: x.code });
      }
      return (await ctx.client.query("insert into cours_planifies (organisation_id, ue_id, annee, jour, debut, fin, salle, enseignant_id) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id", [ctx.organisationId, b.ueId, b.annee, b.jour, b.debut, b.fin, b.salle ?? null, b.enseignantId ?? null])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get<{ Params: { id: string }; Querystring: { annee: string } }>("/filieres/:id/cours", {
    schema: { params: paramId, querystring: { type: "object", required: ["annee"], properties: { annee } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await filiere(ctx, req.params.id, "universite.voir");
      return (await ctx.client.query(
        `select c.id, c.jour::text, c.debut::text, c.fin::text, c.salle, u.code, u.nom as ue, x.nom as enseignant, (select count(*)::int from presences_univ p where p.cours_id = c.id and p.present) as presents, (select count(*)::int from presences_univ p where p.cours_id = c.id) as appeles
         from cours_planifies c join unites_enseignement u on u.id = c.ue_id left join utilisateurs x on x.id = c.enseignant_id where u.filiere_id = $1 and c.annee = $2 order by c.jour, c.debut limit 1000`, [req.params.id, req.query.annee],
      )).rows;
    }),
  );
  /** L'appel se saisit par un enseignant ou la scolarité. Refaire l'appel remplace le précédent. */
  app.put<{ Params: { id: string }; Body: { absents: string[] } }>("/cours-planifies/:id/appel", {
    schema: { params: paramId, body: { type: "object", required: ["absents"], properties: { absents: { type: "array", maxItems: 2000, items: uuid } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [c] } = await ctx.client.query("select c.*, u.filiere_id from cours_planifies c join unites_enseignement u on u.id = c.ue_id where c.id = $1", [req.params.id]);
      if (!c) throw new ErreurApi(404, "introuvable");
      await filiere(ctx, c.filiere_id, "universite.notes");
      const { rows: ins } = await ctx.client.query("select id from inscriptions_univ where filiere_id = $1 and annee = $2", [c.filiere_id, c.annee]);
      const absents = new Set(req.body.absents);
      for (const i of ins) {
        await ctx.client.query(
          "insert into presences_univ (organisation_id, cours_id, inscription_id, present, saisi_par) values ($1, $2, $3, $4, $5) on conflict (organisation_id, cours_id, inscription_id) do update set present = excluded.present, saisi_par = excluded.saisi_par",
          [ctx.organisationId, c.id, i.id, !absents.has(i.id), ctx.utilisateurId],
        );
      }
      return { appeles: ins.length, absents: ins.filter((i) => absents.has(i.id)).length };
    }),
  );

  // Paie : état préparatoire, moyens de paiement et versement
  const entiteRh = async (ctx: Contexte, id: string) => exigerSurEntite(ctx, "rh.paie", id);
  app.put<{ Params: { id: string }; Body: { mode: string; compte?: string } }>("/employes/:id/paiement", {
    schema: { params: paramId, body: { type: "object", required: ["mode"], properties: { mode: { type: "string", enum: ["virement", "mtn_momo", "orange_money", "especes"] }, compte: texte(60) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [e] } = await ctx.client.query("select entite_id from employes where id = $1", [req.params.id]);
      if (!e) throw new ErreurApi(404, "introuvable");
      await entiteRh(ctx, e.entite_id);
      if (req.body.mode !== "especes" && !req.body.compte) throw new ErreurApi(400, "compte_paiement_obligatoire");
      await ctx.client.query("update employes set mode_paiement = $2, compte_paiement_chiffre = $3 where id = $1", [req.params.id, req.body.mode, req.body.compte ? chiffrer(req.body.compte, cle) : null]);
      return { enregistre: true };
    }),
  );
  app.get<{ Querystring: { entiteId: string; periode: string } }>("/paie/etat", {
    schema: { querystring: { type: "object", required: ["entiteId", "periode"], properties: { entiteId: uuid, periode: mois } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const q = req.query;
      await entiteRh(ctx, q.entiteId);
      const { rows } = await ctx.client.query(
        `select b.id, b.numero, b.brut::int8, b.retenues::int8, b.charges::int8, b.net::int8, b.lignes, e.matricule, e.nom, e.mode_paiement, e.compte_paiement_chiffre, v.id as verse
         from bulletins_paie b join employes e on e.id = b.employe_id left join versements_paie v on v.bulletin_id = b.id where b.statut = 'valide' and b.periode = $1 and e.entite_id = $2 order by e.nom`, [q.periode, q.entiteId],
      );
      const rubriques = new Map<string, { code: string; libelle: string; sens: string; assiette: number; montant: number }>();
      for (const b of rows) for (const l of b.lignes as { code: string; libelle: string; sens: string; assiette: number | null; montant: number }[]) {
        const x = rubriques.get(`${l.code}|${l.libelle}|${l.sens}`) ?? { code: l.code, libelle: l.libelle, sens: l.sens, assiette: 0, montant: 0 };
        x.assiette += l.assiette ?? 0; x.montant += l.montant;
        rubriques.set(`${l.code}|${l.libelle}|${l.sens}`, x);
      }
      const total = (k: "brut" | "retenues" | "charges" | "net") => rows.reduce((s, b) => s + Number(b[k]), 0);
      if (rows.length) await ctx.client.query("select journal_evenement('paie.etat_consulte', $1)", [JSON.stringify({ entite: q.entiteId, periode: q.periode })]);
      return {
        periode: q.periode, totaux: { brut: total("brut"), retenues: total("retenues"), charges: total("charges"), net: total("net") }, rubriques: [...rubriques.values()],
        salaries: rows.map((b) => ({ bulletin: b.id, numero: b.numero, matricule: b.matricule, nom: b.nom, net: Number(b.net), mode: b.mode_paiement, compte: b.compte_paiement_chiffre ? dechiffrer(b.compte_paiement_chiffre, cle) : null, verse: !!b.verse })),
      };
    }),
  );
  /** Enregistre les versements réellement faits : le virement lui-même se passe à la banque ou chez l'opérateur. */
  app.post<{ Body: { entiteId: string; periode: string; portefeuilleId: string; bulletins: string[] } }>("/paie/versements", {
    schema: { body: { type: "object", required: ["entiteId", "periode", "portefeuilleId", "bulletins"], properties: { entiteId: uuid, periode: mois, portefeuilleId: uuid, bulletins: { type: "array", minItems: 1, maxItems: 2000, items: uuid } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await entiteRh(ctx, b.entiteId);
      await exigerSurEntite(ctx, "tresorerie.gerer", b.entiteId);
      const { rows: [w] } = await ctx.client.query("select id, actif, entite_branche(entite_id) as branche, entite_branche($2) as attendue from portefeuilles where id = $1 for update", [b.portefeuilleId, b.entiteId]);
      if (!w) throw new ErreurApi(404, "introuvable");
      if (w.branche !== w.attendue) throw new ErreurApi(409, "transfert_autre_branche");
      if (!w.actif) throw new ErreurApi(409, "portefeuille_inactif");
      const { rows } = await ctx.client.query("select b.id, b.net::int8, e.nom from bulletins_paie b join employes e on e.id = b.employe_id where b.id = any($1::uuid[]) and b.statut = 'valide' and b.periode = $2 and e.entite_id = $3 and not exists (select 1 from versements_paie v where v.bulletin_id = b.id)", [b.bulletins, b.periode, b.entiteId]);
      if (rows.length !== new Set(b.bulletins).size) throw new ErreurApi(409, "bulletins_non_payables");
      const total = rows.reduce((s, x) => s + Number(x.net), 0);
      const { rows: [{ s }] } = await ctx.client.query("select coalesce(sum(montant), 0)::int8 as s from mouvements_portefeuille where portefeuille_id = $1", [w.id]);
      if (total > Number(s)) throw new ErreurApi(409, "solde_portefeuille_insuffisant");
      for (const x of rows) await ctx.client.query("insert into versements_paie (organisation_id, bulletin_id, portefeuille_id, montant, auteur_id) values ($1, $2, $3, $4, $5)", [ctx.organisationId, x.id, w.id, x.net, ctx.utilisateurId]);
      await ctx.client.query("insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, auteur_id, source_type) values ($1, $2, 'sortie', $3, $4, $5, 'paie')", [ctx.organisationId, w.id, -total, `Salaires ${b.periode} (${rows.length})`, ctx.utilisateurId]);
      return { verses: rows.length, total };
    });
    return reponse.status(201).send(r);
  });

  // Réservation de séances par le client
  const accompagnementGere = async (ctx: Contexte, id: string) => {
    const { rows: [a] } = await ctx.client.query("select a.*, c.utilisateur_id as coach_utilisateur from accompagnements a join coachs c on c.id = a.coach_id where a.id = $1", [id]);
    if (!a) throw new ErreurApi(404, "introuvable");
    if (a.coach_utilisateur !== ctx.utilisateurId) await exigerSurEntite(ctx, "coaching.gerer", a.entite_id);
    return a;
  };
  app.post<{ Params: { id: string } }>("/accompagnements/:id/lien-client", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await accompagnementGere(ctx, req.params.id);
      const code = randomBytes(24).toString("base64url");
      await ctx.client.query("update accompagnements set code_client = $2 where id = $1", [req.params.id, code]);
      return { lien: `/reserver.html?c=${ctx.organisationId}.${code}` };
    }),
  );
  app.post<{ Params: { id: string }; Body: { debut: string; dureeMinutes: number; lienVisio?: string } }>("/coachs/:id/creneaux", {
    schema: { params: paramId, body: { type: "object", required: ["debut", "dureeMinutes"], properties: { debut: { type: "string", format: "date-time" }, dureeMinutes: { type: "integer", minimum: 5, maximum: 600 }, lienVisio: { type: "string", pattern: "^https://", maxLength: 500 } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const { rows: [c] } = await ctx.client.query("select * from coachs where id = $1", [req.params.id]);
      if (!c) throw new ErreurApi(404, "introuvable");
      if (c.utilisateur_id !== ctx.utilisateurId) await exigerSurEntite(ctx, "coaching.gerer", c.entite_id);
      const { rows: [x] } = await ctx.client.query("insert into creneaux_coaching (organisation_id, coach_id, debut, duree_minutes, lien_visio) values ($1, $2, $3, $4, $5) on conflict do nothing returning id", [ctx.organisationId, c.id, req.body.debut, req.body.dureeMinutes, req.body.lienVisio ?? null]);
      if (!x) throw new ErreurApi(409, "creneau_existant");
      return x;
    });
    return reponse.status(201).send(r);
  });
  const CODE = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{20,}$/;
  const dansReservation = <T>(code: string, fn: (c: Client, a: Record<string, any>, org: string) => Promise<T>) => {
    if (!CODE.test(code)) throw new ErreurApi(404, "introuvable");
    const [org, secret] = code.split(".") as [string, string];
    return dansOrganisation(pool, org, async (c) => {
      const { rows: [a] } = await c.query("select a.*, t.nom as client from accompagnements a join tiers t on t.id = a.tiers_id where a.code_client = $1 and a.statut = 'actif' for update of a", [secret]);
      if (!a) throw new ErreurApi(404, "introuvable");
      return fn(c, a, org);
    }).catch((e) => { if (e.code === "22P02") throw new ErreurApi(404, "introuvable"); throw e; });
  };
  const restant = async (c: Client, a: Record<string, any>) => {
    if (!a.forfait_seances) return null;
    const { rows: [n] } = await c.query("select count(*)::int as n from seances_coaching where accompagnement_id = $1 and statut <> 'annulee'", [a.id]);
    return a.forfait_seances - n.n;
  };
  app.get<{ Params: { code: string } }>("/reservation-coaching/:code", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) =>
    dansReservation(req.params.code, async (c, a) => {
      const { rows: creneaux } = await c.query("select id, debut, duree_minutes from creneaux_coaching where coach_id = $1 and seance_id is null and debut > now() order by debut limit 100", [a.coach_id]);
      const { rows: seances } = await c.query("select id, debut, duree_minutes, lien_visio, statut, debut > now() + interval '24 hours' as annulable from seances_coaching where accompagnement_id = $1 and debut > now() - interval '1 day' and statut = 'planifiee' order by debut", [a.id]);
      const { rows: [{ niveau }] } = await c.query("select coalesce(max(n.ordre), 0)::int as niveau from parcours_certification p join niveaux_certification n on n.id = p.niveau_id where p.tiers_id = $1 and p.delivre_le is not null and p.revoque_le is null", [a.tiers_id]);
      const { rows: ressources } = await c.query("select titre, categorie, url from ressources_coaching where actif and niveau_min <= $1 and entite_id = $2 order by categorie, titre", [niveau, a.entite_id]);
      return { titre: a.titre, client: a.client, restant: await restant(c, a), creneaux, seances, ressources };
    }),
  );
  /** Le verrou sur le créneau garantit qu'une seule personne l'obtient. */
  app.post<{ Params: { code: string }; Body: { creneauId: string } }>("/reservation-coaching/:code", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: { body: { type: "object", required: ["creneauId"], properties: { creneauId: uuid } } },
  }, async (req, reponse) => {
    const r = await dansReservation(req.params.code, async (c, a, org) => {
      const reste = await restant(c, a);
      if (reste !== null && reste <= 0) throw new ErreurApi(409, "forfait_epuise");
      const { rows: [x] } = await c.query("select * from creneaux_coaching where id = $1 and coach_id = $2 and debut > now() for update", [req.body.creneauId, a.coach_id]);
      if (!x) throw new ErreurApi(404, "introuvable");
      if (x.seance_id) throw new ErreurApi(409, "creneau_pris");
      const { rows: [s] } = await c.query("insert into seances_coaching (organisation_id, accompagnement_id, debut, duree_minutes, lien_visio) values ($1, $2, $3, $4, $5) returning id, debut, lien_visio", [org, a.id, x.debut, x.duree_minutes, x.lien_visio]);
      await c.query("update creneaux_coaching set seance_id = $2 where id = $1", [x.id, s.id]);
      return s;
    });
    return reponse.status(201).send(r);
  });
  app.post<{ Params: { code: string; id: string } }>("/reservation-coaching/:code/seances/:id/annulation", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) =>
    dansReservation(req.params.code, async (c, a) => {
      const { rows: [s] } = await c.query("select id, debut > now() + interval '24 hours' as ok from seances_coaching where id = $1 and accompagnement_id = $2 and statut = 'planifiee' for update", [req.params.id, a.id]);
      if (!s) throw new ErreurApi(404, "introuvable");
      if (!s.ok) throw new ErreurApi(409, "annulation_trop_tardive");
      await c.query("update seances_coaching set statut = 'annulee' where id = $1", [s.id]);
      await c.query("update creneaux_coaching set seance_id = null where seance_id = $1", [s.id]);
      return { annulee: true };
    }),
  );
}
