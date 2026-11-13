import { createHmac, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import QRCode from "qrcode";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { dansOrganisation, publierEvenement } from "./base.js";
import { stockerFichier } from "./documents.js";
import { entitesAccessibles } from "./permissions.js";
import { chiffrer, dechiffrer, normaliserTelephone } from "./securite.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max = 200) => ({ type: "string", minLength: 1, maxLength: max }) as const;
const CONTRATS = ["cdi", "cdd", "stage", "prestataire", "autre"];
const CODE = /^[0-9a-f-]{36}\.[A-Za-z0-9_-]{20,}$/;
const JOUR = "(now() at time zone 'Africa/Douala')";

export interface AppuisRh {
  soldeConges: (ctx: Contexte, e: Record<string, any>) => Promise<unknown>;
  creerEmploye: (ctx: Contexte, b: { entiteId: string; nom: string; poste: string; typeContrat: string; dateEmbauche: string; telephone?: string | null; email?: string | null }) => Promise<Record<string, any>>;
}

const PAS_CODE = 60000;
export function codeSite(secret: string, pas: number): string {
  const h = createHmac("sha256", secret).update(String(pas)).digest();
  return String(h.readUInt32BE(h[31]! & 15) % 1000000).padStart(6, "0");
}

export function enregistrerPortailRh(app: FastifyInstance, pool: pg.Pool, outils: Outils, appuis: AppuisRh, cle: Buffer, urlPublique: string, dossier?: string): void {
  const { protege, exiger, exigerSurEntite } = outils;
  const moi = async (ctx: Contexte) => {
    const { rows: [e] } = await ctx.client.query("select * from employes where utilisateur_id = $1 and (date_sortie is null or date_sortie >= (now() at time zone 'Africa/Douala')::date)", [ctx.utilisateurId]);
    if (!e) throw new ErreurApi(404, "compte_sans_dossier");
    return e;
  };

  app.put<{ Params: { id: string }; Body: { email: string | null } }>("/employes/:id/compte", {
    schema: { params: paramId, body: { type: "object", required: ["email"], properties: { email: { type: ["string", "null"], format: "email", maxLength: 320 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [e] } = await ctx.client.query("select entite_id from employes where id = $1", [req.params.id]);
      if (!e) throw new ErreurApi(404, "introuvable");
      // Relier un compte ouvre les bulletins de la fiche : même exigence que pour lire un salaire.
      await exigerSurEntite(ctx, "rh.paie", e.entite_id);
      const { rows: [actuel] } = await ctx.client.query("select utilisateur_id from employes where id = $1 for update", [req.params.id]);
      let id: string | null = null;
      if (req.body.email) {
        const { rows: [u] } = await ctx.client.query("select id from utilisateurs where email = $1 and actif", [req.body.email.toLowerCase()]);
        if (!u) throw new ErreurApi(404, "compte_introuvable");
        id = u.id;
        const { rows: [deja] } = await ctx.client.query("select 1 from employes where utilisateur_id = $1 and id <> $2", [id, req.params.id]);
        if (deja) throw new ErreurApi(409, "compte_deja_lie");
        if (actuel.utilisateur_id && actuel.utilisateur_id !== id) throw new ErreurApi(409, "fiche_deja_reliee");
      }
      await ctx.client.query("update employes set utilisateur_id = $2 where id = $1", [req.params.id, id]);
      await ctx.client.query("select journal_evenement('rh.compte_relie', $1)", [JSON.stringify({ employe: req.params.id, compte: id, ancien: actuel.utilisateur_id })]);
      return { lie: !!id };
    }),
  );

  // L'espace personnel : chacun ne voit que son dossier, sans droit RH particulier.
  app.get("/moi/employe", async (req) =>
    protege(req, async (ctx) => {
      const { rows: [e] } = await ctx.client.query("select * from employes where utilisateur_id = $1", [ctx.utilisateurId]);
      if (!e) return { lie: false };
      const c = ctx.client;
      const [conges, bulletins, notes, pointage] = await Promise.all([
        c.query("select id, type, debut::text, fin::text, statut, motif_refus from conges where employe_id = $1 order by debut desc limit 50", [e.id]),
        c.query("select id, periode, numero, net from bulletins_paie where employe_id = $1 and statut = 'valide' order by periode desc limit 36", [e.id]),
        c.query("select id, jour::text, categorie, libelle, montant, statut, motif_refus, document_id from notes_frais where employe_id = $1 order by jour desc limit 100", [e.id]),
        c.query(`select arrivee::text, depart::text from pointages where employe_id = $1 and jour = ${JOUR}::date`, [e.id]),
      ]);
      return {
        lie: true, id: e.id, matricule: e.matricule, nom: e.nom, poste: e.poste, solde: await appuis.soldeConges(ctx, e),
        conges: conges.rows, bulletins: bulletins.rows, notes: notes.rows, pointage: pointage.rows[0] ?? null,
      };
    }),
  );
  app.get<{ Params: { id: string } }>("/moi/bulletins/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const e = await moi(ctx);
      const { rows: [b] } = await ctx.client.query("select periode, numero, salaire_base, brut, retenues, net, lignes from bulletins_paie where id = $1 and employe_id = $2 and statut = 'valide'", [req.params.id, e.id]);
      if (!b) throw new ErreurApi(404, "introuvable");
      // Les charges de l'employeur ne figurent pas dans ce que l'employé reçoit ici.
      return { ...b, lignes: (b.lignes as { sens: string }[]).filter((l) => l.sens !== "charge") };
    }),
  );
  /** L'heure vient du serveur : on pointe maintenant, pas à l'heure qu'on annonce. */
  app.post<{ Body?: { code?: string } | null }>("/moi/pointage", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: { body: { type: ["object", "null"], properties: { code: { type: "string", pattern: "^[0-9]{6}$" } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const e = await moi(ctx);
      // Dès qu'un site existe dans la branche, il faut le code affiché sur place.
      const { rows: sites } = await ctx.client.query("select id, secret_chiffre from sites_pointage where actif and entite_branche(entite_id) = entite_branche($1)", [e.entite_id]);
      let siteId: string | null = null;
      if (sites.length) {
        if (!req.body?.code) throw new ErreurApi(409, "code_pointage_requis");
        const pas = Math.floor(Date.now() / PAS_CODE);
        const site = sites.find((s) => [pas, pas - 1].some((p) => codeSite(dechiffrer(s.secret_chiffre, cle), p) === req.body!.code));
        if (!site) throw new ErreurApi(409, "code_pointage_invalide");
        siteId = site.id;
      }
      const { rows: [p] } = await ctx.client.query(`select id, depart, arrivee::text, to_char(${JOUR}, 'HH24:MI:SS') as maintenant from pointages where employe_id = $1 and jour = ${JOUR}::date for update`, [e.id]);
      if (!p) {
        const { rows: [x] } = await ctx.client.query(`insert into pointages (organisation_id, employe_id, jour, arrivee, note, saisi_par, site_id) values ($1, $2, ${JOUR}::date, ${JOUR}::time, 'Pointage personnel', $3, $4) returning arrivee::text`, [ctx.organisationId, e.id, ctx.utilisateurId, siteId]);
        return { sens: "arrivee", heure: x.arrivee };
      }
      if (p.depart) throw new ErreurApi(409, "pointage_termine");
      if (p.maintenant <= p.arrivee) throw new ErreurApi(409, "pointage_trop_proche");
      const { rows: [x] } = await ctx.client.query(`update pointages set depart = ${JOUR}::time where id = $1 returning depart::text`, [p.id]);
      return { sens: "depart", heure: x.depart };
    }),
  );
  app.post<{ Body: { type: string; debut: string; fin: string; motif?: string } }>("/moi/conges", {
    schema: { body: { type: "object", required: ["type", "debut", "fin"], properties: { type: { type: "string", enum: ["annuel", "maladie", "maternite", "permission", "sans_solde", "autre"] }, debut: date, fin: date, motif: { type: "string", maxLength: 500 } } } },
  }, async (req, reponse) => {
    const c = await protege(req, async (ctx) => {
      const e = await moi(ctx);
      const b = req.body;
      if (b.fin < b.debut) throw new ErreurApi(400, "dates_invalides");
      await ctx.client.query("select 1 from employes where id = $1 for update", [e.id]);
      const { rows: x } = await ctx.client.query("select 1 from conges where employe_id = $1 and statut in ('demande', 'approuve') and debut <= $3 and fin >= $2 limit 1", [e.id, b.debut, b.fin]);
      if (x[0]) throw new ErreurApi(409, "conge_chevauche");
      return (await ctx.client.query("insert into conges (organisation_id, employe_id, type, debut, fin, motif) values ($1, $2, $3, $4, $5, $6) returning id, statut", [ctx.organisationId, e.id, b.type, b.debut, b.fin, b.motif ?? null])).rows[0];
    });
    return reponse.status(201).send(c);
  });

  // Sites de pointage : la borne affiche un code qui change chaque minute.
  app.post<{ Body: { entiteId: string; nom: string } }>("/sites-pointage", {
    schema: { body: { type: "object", required: ["entiteId", "nom"], properties: { entiteId: uuid, nom: texte() } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "rh.gerer", req.body.entiteId);
      return (await ctx.client.query("insert into sites_pointage (organisation_id, entite_id, nom, secret_chiffre) values ($1, $2, $3, $4) returning id, nom", [ctx.organisationId, req.body.entiteId, req.body.nom, chiffrer(randomBytes(32).toString("base64"), cle)])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/sites-pointage", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "rh.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "rh.voir")).map((e) => e.id);
      return (await ctx.client.query("select s.id, s.nom, s.actif, e.nom as entite from sites_pointage s join entites e on e.id = s.entite_id where s.entite_id = any($1::uuid[]) order by s.nom", [ids])).rows;
    }),
  );
  app.post<{ Params: { id: string } }>("/sites-pointage/:id/arret", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [s] } = await ctx.client.query("select entite_id from sites_pointage where id = $1", [req.params.id]);
      if (!s) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "rh.gerer", s.entite_id);
      await ctx.client.query("update sites_pointage set actif = false where id = $1", [req.params.id]);
      return { actif: false };
    }),
  );
  app.get<{ Params: { id: string } }>("/sites-pointage/:id/code", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [s] } = await ctx.client.query("select entite_id, secret_chiffre from sites_pointage where id = $1 and actif", [req.params.id]);
      if (!s) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "rh.gerer", s.entite_id);
      const code = codeSite(dechiffrer(s.secret_chiffre, cle), Math.floor(Date.now() / PAS_CODE));
      return { code, qr_svg: await QRCode.toString(`${urlPublique}/?pointage=${code}`, { type: "svg", margin: 1 }), valide_ms: PAS_CODE - (Date.now() % PAS_CODE) };
    }),
  );

  // Notes de frais : l'employé déclare, les RH approuvent, la trésorerie paie.
  app.post<{ Body: { jour: string; categorie: string; libelle: string; montant: number } }>("/moi/notes-frais", {
    schema: { body: { type: "object", required: ["jour", "categorie", "libelle", "montant"], properties: { jour: date, categorie: { type: "string", enum: ["transport", "repas", "hebergement", "communication", "autre"] }, libelle: texte(300), montant: { type: "integer", minimum: 1, maximum: 100_000_000 } } } },
  }, async (req, reponse) => {
    const n = await protege(req, async (ctx) => {
      const e = await moi(ctx);
      const b = req.body;
      return (await ctx.client.query("insert into notes_frais (organisation_id, employe_id, jour, categorie, libelle, montant) values ($1, $2, $3, $4, $5, $6) returning id", [ctx.organisationId, e.id, b.jour, b.categorie, b.libelle, b.montant])).rows[0];
    });
    return reponse.status(201).send(n);
  });
  app.put<{ Params: { id: string } }>("/moi/notes-frais/:id/justificatif", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: { params: paramId },
  }, async (req) => {
    const verifier = async (ctx: Contexte) => {
      const e = await moi(ctx);
      const { rows: [n] } = await ctx.client.query("select id, statut, libelle from notes_frais where id = $1 and employe_id = $2", [req.params.id, e.id]);
      if (!n) throw new ErreurApi(404, "introuvable");
      if (n.statut !== "soumise") throw new ErreurApi(409, "note_deja_traitee");
      return { e, n };
    };
    await protege(req, verifier);
    const s = await stockerFichier(req, dossier, 5 * 1024 ** 2);
    try {
      return await protege(req, async (ctx) => {
        const { e, n } = await verifier(ctx);
        const { rows: [d] } = await ctx.client.query(
          `insert into documents_ged (organisation_id, entite_id, groupe_id, titre, categorie, fichier, type_mime, taille, empreinte, auteur_id) values ($1, $2, gen_random_uuid(), $3, 'rh', $4, $5, $6, $7, $8) returning id`,
          [ctx.organisationId, e.entite_id, `Justificatif ${e.matricule} ${n.libelle}`.slice(0, 200), s.fichier, s.type_mime, s.taille, s.empreinte, ctx.utilisateurId],
        );
        await ctx.client.query("update notes_frais set document_id = $2 where id = $1", [n.id, d.id]);
        return { document: d.id };
      });
    } catch (x) {
      await rm(join(dossier!, s.fichier), { force: true });
      throw x;
    }
  });
  app.get("/notes-frais", async (req) =>
    protege(req, async (ctx) => {
      const ids = new Set<string>();
      for (const p of ["rh.voir", "tresorerie.voir"] as const) for (const e of await entitesAccessibles(ctx.client, ctx.utilisateurId, p)) ids.add(e.id as string);
      const { rows } = await ctx.client.query(
        `select n.id, n.jour::text, n.categorie, n.libelle, n.montant, n.statut, n.motif_refus, n.document_id, e.nom as employe, e.entite_id from notes_frais n join employes e on e.id = n.employe_id
         where e.entite_id = any($1::uuid[]) order by n.statut = 'soumise' desc, n.statut = 'approuvee' desc, n.jour desc limit 300`, [[...ids]],
      );
      return rows;
    }),
  );
  const note = async (ctx: Contexte, id: string) => {
    const { rows: [n] } = await ctx.client.query("select n.*, e.entite_id, e.nom as employe, e.utilisateur_id from notes_frais n join employes e on e.id = n.employe_id where n.id = $1 for update of n", [id]);
    if (!n) throw new ErreurApi(404, "introuvable");
    return n;
  };
  app.post<{ Params: { id: string }; Body: { decision: string; motif?: string } }>("/notes-frais/:id/decision", {
    schema: { params: paramId, body: { type: "object", required: ["decision"], properties: { decision: { type: "string", enum: ["approuvee", "refusee"] }, motif: { type: "string", minLength: 3, maxLength: 500 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const n = await note(ctx, req.params.id);
      await exigerSurEntite(ctx, "rh.gerer", n.entite_id);
      if (n.utilisateur_id === ctx.utilisateurId) throw new ErreurApi(409, "separation_des_taches");
      if (n.statut !== "soumise") throw new ErreurApi(409, "note_deja_traitee");
      if (req.body.decision === "refusee" && !req.body.motif) throw new ErreurApi(400, "motif_obligatoire");
      await ctx.client.query("update notes_frais set statut = $2, motif_refus = $3, decide_par = $4 where id = $1", [n.id, req.body.decision, req.body.motif ?? null, ctx.utilisateurId]);
      return { statut: req.body.decision };
    }),
  );
  /** Le mouvement part vers le compte d'attente : le comptable l'impute ensuite. */
  app.post<{ Params: { id: string }; Body: { portefeuilleId: string } }>("/notes-frais/:id/paiement", {
    schema: { params: paramId, body: { type: "object", required: ["portefeuilleId"], properties: { portefeuilleId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const n = await note(ctx, req.params.id);
      await exigerSurEntite(ctx, "tresorerie.gerer", n.entite_id);
      if (n.statut !== "approuvee") throw new ErreurApi(409, "note_non_approuvee");
      const { rows: [w] } = await ctx.client.query("select id, actif, entite_branche(entite_id) as branche, entite_branche($2) as attendue from portefeuilles where id = $1 for update", [req.body.portefeuilleId, n.entite_id]);
      if (!w) throw new ErreurApi(404, "introuvable");
      if (w.branche !== w.attendue) throw new ErreurApi(409, "transfert_autre_branche");
      if (!w.actif) throw new ErreurApi(409, "portefeuille_inactif");
      const { rows: [{ s }] } = await ctx.client.query("select coalesce(sum(montant), 0)::int8 as s from mouvements_portefeuille where portefeuille_id = $1", [w.id]);
      if (n.montant > s) throw new ErreurApi(409, "solde_portefeuille_insuffisant");
      await ctx.client.query("insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, auteur_id, source_type) values ($1, $2, 'sortie', $3, $4, $5, 'note_frais')", [ctx.organisationId, w.id, -n.montant, `Note de frais ${n.employe} : ${n.libelle}`.slice(0, 300), ctx.utilisateurId]);
      await ctx.client.query("update notes_frais set statut = 'payee', portefeuille_id = $2, paye_par = $3, paye_le = now() where id = $1", [n.id, w.id, ctx.utilisateurId]);
      return { statut: "payee" };
    }),
  );

  // Recrutement
  app.post<{ Body: { entiteId: string; titre: string; description: string; lieu?: string; typeContrat: string } }>("/offres-emploi", {
    schema: { body: { type: "object", required: ["entiteId", "titre", "description", "typeContrat"], properties: { entiteId: uuid, titre: texte(), description: texte(5000), lieu: texte(), typeContrat: { type: "string", enum: CONTRATS } } } },
  }, async (req, reponse) => {
    const o = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "rh.gerer", b.entiteId);
      return (await ctx.client.query("insert into offres_emploi (organisation_id, entite_id, titre, description, lieu, type_contrat, code) values ($1, $2, $3, $4, $5, $6, $7) returning *", [ctx.organisationId, b.entiteId, b.titre, b.description, b.lieu ?? null, b.typeContrat, randomBytes(24).toString("base64url")])).rows[0];
    });
    return reponse.status(201).send({ ...o, lien: `/postuler.html?c=${o.organisation_id}.${o.code}` });
  });
  app.get("/offres-emploi", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "rh.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "rh.voir")).map((e) => e.id);
      const { rows } = await ctx.client.query("select o.id, o.titre, o.lieu, o.type_contrat, o.ouverte, o.organisation_id, o.code, o.entite_id, e.nom as entite, (select count(*)::int from candidatures c where c.offre_id = o.id) as candidats from offres_emploi o join entites e on e.id = o.entite_id where o.entite_id = any($1::uuid[]) order by o.ouverte desc, o.cree_le desc limit 200", [ids]);
      return rows.map(({ organisation_id, code, ...o }) => ({ ...o, lien: `/postuler.html?c=${organisation_id}.${code}` }));
    }),
  );
  const offre = async (ctx: Contexte, id: string, p: "rh.voir" | "rh.gerer") => {
    const { rows: [o] } = await ctx.client.query("select * from offres_emploi where id = $1", [id]);
    if (!o) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, p, o.entite_id);
    return o;
  };
  app.post<{ Params: { id: string } }>("/offres-emploi/:id/cloture", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => { await offre(ctx, req.params.id, "rh.gerer"); await ctx.client.query("update offres_emploi set ouverte = false where id = $1", [req.params.id]); return { ouverte: false }; }),
  );
  app.get<{ Params: { id: string } }>("/offres-emploi/:id/candidatures", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await offre(ctx, req.params.id, "rh.voir");
      const { rows } = await ctx.client.query(
        `select c.id, c.nom, c.telephone, c.email, c.presentation, c.lien_cv, c.etape, c.note, c.employe_id, c.cree_le, c.cv_fichier is not null as cv_fichier, coalesce((select json_agg(json_build_object('id', x.id, 'quand', x.quand, 'lieu', x.lieu, 'compte_rendu', x.compte_rendu) order by x.quand) from entretiens x where x.candidature_id = c.id), '[]') as entretiens
         from candidatures c where c.offre_id = $1 order by c.cree_le desc limit 500`, [req.params.id],
      );
      return rows;
    }),
  );
  const candidature = async (ctx: Contexte, id: string) => {
    const { rows: [c] } = await ctx.client.query("select c.*, o.entite_id, o.titre, o.type_contrat from candidatures c join offres_emploi o on o.id = c.offre_id where c.id = $1 for update of c", [id]);
    if (!c) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, "rh.gerer", c.entite_id);
    return c;
  };
  app.patch<{ Params: { id: string }; Body: { etape?: string; note?: string } }>("/candidatures/:id", {
    schema: { params: paramId, body: { type: "object", minProperties: 1, properties: { etape: { type: "string", enum: ["recue", "preselection", "entretien", "retenue", "refusee"] }, note: { type: "string", maxLength: 2000 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const c = await candidature(ctx, req.params.id);
      if (c.etape === "embauchee") throw new ErreurApi(409, "deja_embauche");
      await ctx.client.query("update candidatures set etape = coalesce($2, etape), note = coalesce($3, note) where id = $1", [c.id, req.body.etape ?? null, req.body.note ?? null]);
      return { enregistre: true };
    }),
  );
  app.post<{ Params: { id: string }; Body: { quand: string; lieu?: string } }>("/candidatures/:id/entretiens", {
    schema: { params: paramId, body: { type: "object", required: ["quand"], properties: { quand: { type: "string", format: "date-time" }, lieu: texte() } } },
  }, async (req, reponse) => {
    const e = await protege(req, async (ctx) => {
      const c = await candidature(ctx, req.params.id);
      if (["recue", "preselection"].includes(c.etape)) await ctx.client.query("update candidatures set etape = 'entretien' where id = $1", [c.id]);
      return (await ctx.client.query("insert into entretiens (organisation_id, candidature_id, quand, lieu, intervenant_id) values ($1, $2, $3, $4, $5) returning id", [ctx.organisationId, c.id, req.body.quand, req.body.lieu ?? null, ctx.utilisateurId])).rows[0];
    });
    return reponse.status(201).send(e);
  });
  app.post<{ Params: { id: string }; Body: { dateEmbauche: string; poste?: string; typeContrat?: string } }>("/candidatures/:id/embauche", {
    schema: { params: paramId, body: { type: "object", required: ["dateEmbauche"], properties: { dateEmbauche: date, poste: texte(), typeContrat: { type: "string", enum: CONTRATS } } } },
  }, async (req, reponse) => {
    const e = await protege(req, async (ctx) => {
      const c = await candidature(ctx, req.params.id);
      if (c.etape === "embauchee") throw new ErreurApi(409, "deja_embauche");
      const emp = await appuis.creerEmploye(ctx, { entiteId: c.entite_id, nom: c.nom, poste: req.body.poste ?? c.titre, typeContrat: req.body.typeContrat ?? c.type_contrat, dateEmbauche: req.body.dateEmbauche, telephone: c.telephone, email: c.email });
      await ctx.client.query("update candidatures set etape = 'embauchee', employe_id = $2 where id = $1", [c.id, emp.id]);
      return emp;
    });
    return reponse.status(201).send(e);
  });

  const dansOffre = <T>(code: string, fn: (c: pg.PoolClient, o: Record<string, any>) => Promise<T>) => {
    if (!CODE.test(code)) throw new ErreurApi(404, "introuvable");
    const [org, secret] = code.split(".") as [string, string];
    return dansOrganisation(pool, org, async (c) => {
      const { rows: [o] } = await c.query("select o.*, e.nom as employeur from offres_emploi o join entites e on e.id = o.entite_id where o.code = $1 and o.ouverte", [secret]);
      if (!o) throw new ErreurApi(404, "introuvable");
      return fn(c as pg.PoolClient, o);
    }).catch((x) => { if (x.code === "22P02") throw new ErreurApi(404, "introuvable"); throw x; });
  };
  app.get<{ Params: { code: string } }>("/offre-public/:code", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) =>
    dansOffre(req.params.code, async (_c, o) => ({ titre: o.titre, description: o.description, lieu: o.lieu, type_contrat: o.type_contrat, employeur: o.employeur })),
  );
  /** Une seconde candidature avec le même contact ne s'ajoute pas, sans que l'auteur l'apprenne. */
  app.post<{ Params: { code: string }; Body: { nom: string; telephone?: string; email?: string; presentation?: string; lienCv?: string; consentement: boolean; site?: string } }>("/offre-public/:code", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: { body: { type: "object", required: ["nom", "consentement"], properties: { nom: texte(), telephone: { type: "string", maxLength: 30 }, email: { type: "string", format: "email", maxLength: 320 }, presentation: { type: "string", maxLength: 3000 }, lienCv: { type: "string", pattern: "^https://", maxLength: 1000 }, consentement: { type: "boolean" }, site: { type: "string", maxLength: 200 } } } },
  }, async (req, reponse) => {
    const b = req.body;
    if (b.site) return reponse.status(201).send({ recu: true });
    if (b.consentement !== true) throw new ErreurApi(400, "consentement_obligatoire");
    const tel = b.telephone?.trim() ? normaliserTelephone(b.telephone) : null;
    const email = b.email?.trim().toLowerCase() || null;
    if (!tel && !email) throw new ErreurApi(400, "contact_obligatoire");
    const jeton = randomBytes(24).toString("base64url");
    await dansOffre(req.params.code, async (c, o) => {
      const { rows: [d] } = await c.query("select 1 from candidatures where offre_id = $1 and ((telephone is not null and telephone = $2) or (email is not null and email = $3))", [o.id, tel, email]);
      if (d) return;
      await c.query("insert into candidatures (organisation_id, offre_id, nom, telephone, email, presentation, lien_cv, cv_jeton) values ($1, $2, $3, $4, $5, $6, $7, $8)", [o.organisation_id, o.id, b.nom.trim(), tel, email, b.presentation ?? null, b.lienCv ?? null, jeton]);
      await publierEvenement(c, "candidature.recue", { offre: o.id });
    });
    return reponse.status(201).send({ recu: true, depot: jeton });
  });
  /** PDF seulement, un dépôt par candidature. Un jeton inconnu reçoit la même réponse et rien n'est gardé. */
  app.put<{ Params: { code: string }; Querystring: { depot: string } }>("/offre-public/:code/cv", {
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    schema: { querystring: { type: "object", required: ["depot"], properties: { depot: { type: "string", minLength: 20, maxLength: 100 } } } },
  }, async (req, reponse) => {
    await dansOffre(req.params.code, async () => null);
    const s = await stockerFichier(req, dossier, 5 * 1024 ** 2);
    const garde = s.type_mime === "application/pdf" && await dansOffre(req.params.code, async (c, o) => {
      const { rowCount } = await c.query("update candidatures set cv_fichier = $3, cv_taille = $4, cv_jeton = null where offre_id = $1 and cv_jeton = $2", [o.id, req.query.depot, s.fichier, s.taille]);
      return !!rowCount;
    });
    if (!garde) await rm(join(dossier!, s.fichier), { force: true });
    if (s.type_mime !== "application/pdf") throw new ErreurApi(415, "format_document");
    return reponse.status(201).send({ recu: true });
  });
  app.get<{ Params: { id: string } }>("/candidatures/:id/cv", { schema: { params: paramId } }, async (req, reponse) => {
    const c = await protege(req, async (ctx) => {
      const { rows: [x] } = await ctx.client.query("select c.nom, c.cv_fichier, c.cv_taille, o.entite_id from candidatures c join offres_emploi o on o.id = c.offre_id where c.id = $1", [req.params.id]);
      if (!x?.cv_fichier) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "rh.voir", x.entite_id);
      return x;
    });
    return reponse.header("content-type", "application/pdf").header("content-length", c.cv_taille).header("x-content-type-options", "nosniff").header("content-disposition", `attachment; filename*=UTF-8\'\'${encodeURIComponent(`CV ${c.nom}.pdf`)}`).send(createReadStream(join(dossier!, c.cv_fichier)));
  });
}
