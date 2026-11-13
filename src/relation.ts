import type { FastifyInstance } from "fastify";
import { publierEvenement } from "./base.js";
import type { Permission } from "./catalogue.js";
import { prochainNumero } from "./formations.js";
import { aPermission, aPermissionSurEntite, entitesAccessibles } from "./permissions.js";
import { normaliserTelephone } from "./securite.js";
import { exigerTiersVisible, lierTiers } from "./tiers.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";

const uuid = { type: "string", format: "uuid" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max: number) => ({ type: "string", minLength: 1, maxLength: max }) as const;
const ETAPES = ["nouveau", "contacte", "qualifie", "proposition", "gagne", "perdu"];
/** Délais de réponse proposés, à rendre paramétrables après l'essai. */
const HEURES_PAR_PRIORITE: Record<string, number> = { haute: 4, normale: 24, basse: 72 };

/** Tout sauf lignes_ecriture : une écriture validée ne change pas. Un test vérifie que cette liste reste complète. */
export const LIENS_TIERS: [string, string][] = [
  ["inscriptions", "tiers_id"], ["opportunites", "tiers_id"], ["activites", "tiers_id"], ["tickets", "tiers_id"], ["taches", "tiers_id"], ["mentorats", "mentor_id"], ["mentorats", "mentore_id"], ["dons", "donateur_id"], ["aides_beneficiaires", "beneficiaire_id"],
  ["documents_vente", "tiers_id"], ["commandes_achat", "fournisseur_id"], ["commandes_achat", "transitaire_id"], ["ventes_comptoir", "tiers_id"], ["acces_cours", "tiers_id"], ["points_fidelite", "tiers_id"], ["coachs", "tiers_id"], ["accompagnements", "tiers_id"], ["parcours_certification", "tiers_id"], ["candidatures_univ", "tiers_id"], ["inscriptions_univ", "tiers_id"], ["diplomes", "tiers_id"],
  ["factures_fournisseur", "fournisseur_id"], ["affilies", "tiers_id"], ["dossiers_sav", "fournisseur_id"], ["dossiers_sav", "tiers_id"], ["demandes_retour", "tiers_id"], ["comptes_pro", "tiers_id"], ["vendeurs", "tiers_id"], ["franchises", "tiers_id"], ["baux", "tiers_id"], ["commandes_portail", "tiers_id"], ["relances", "tiers_id"], ["blocages_tiers", "tiers_id"], ["factures_recurrentes", "tiers_id"], ["captures", "tiers_id"], ["documents_ged", "tiers_id"], ["attente_session", "tiers_id"], ["demandes_b2b", "tiers_id"], ["prix_clients", "tiers_id"], ["membres_parcours", "tiers_id"], ["numeros_serie", "tiers_id"], ["offres_fournisseur", "fournisseur_id"], ["retours_fournisseur", "fournisseur_id"], ["contrats", "tiers_id"],
];

export function enregistrerRelation(app: FastifyInstance, outils: Outils): void {
  const { protege, exiger, exigerSurEntite } = outils;

  async function exigerModule(ctx: Contexte, entiteId: string, module: string) {
    const { rows } = await ctx.client.query(
      "select actif from modules_entite where entite_id = $1 and module = $2", [entiteId, module],
    );
    if (!rows[0]?.actif) throw new ErreurApi(409, "module_inactif");
  }

  const idsAccessibles = async (ctx: Contexte, permission: Permission) =>
    (await entitesAccessibles(ctx.client, ctx.utilisateurId, permission)).map((e) => e.id);

  /** Liste minimale pour choisir un responsable : un nom et un identifiant, rien d'autre. */
  app.get("/collaborateurs", async (req) =>
    protege(req, async ({ client, utilisateurId }) =>
      (await client.query(
        // Une branche ne voit que ses collègues et les personnes ayant un accès sur tout le groupe.
        `with moi as (
           select a.entite_id, case when a.entite_id is null then null else entite_branche(a.entite_id) end as branche
           from attributions a where a.utilisateur_id = $1 and (a.expire_le is null or a.expire_le > now())
         )
         select distinct u.id, u.nom from utilisateurs u
         left join attributions x on x.utilisateur_id = u.id
         where u.actif and (
           u.id = $1 or exists (select 1 from moi where branche is null) or x.entite_id is null
           or entite_branche(x.entite_id) in (select branche from moi)
         ) order by u.nom`,
        [utilisateurId],
      )).rows),
  );

  app.patch<{
    Params: { id: string };
    Body: {
      nom?: string; email?: string | null; telephone?: string | null; langue?: string;
      roles?: string[]; archive?: boolean; ignorerDoublons?: boolean;
    };
  }>("/tiers/:id", {
    schema: {
      params: paramId,
      body: {
        type: "object", minProperties: 1,
        properties: {
          nom: texte(200),
          email: { type: ["string", "null"], format: "email", maxLength: 320 },
          telephone: { type: ["string", "null"], maxLength: 30 },
          langue: { type: "string", enum: ["fr", "en"] },
          roles: { type: "array", items: { type: "string", maxLength: 30 }, maxItems: 10 },
          archive: { type: "boolean" },
          ignorerDoublons: { type: "boolean" },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "tiers.modifier");
      await exigerTiersVisible(ctx, req.params.id, "tiers.modifier");
      const t = await ctx.client.query("select * from tiers where id = $1 for update", [req.params.id]);
      const b = req.body;
      const email = b.email === undefined ? t.rows[0].email : b.email?.toLowerCase() ?? null;
      const telephone = b.telephone === undefined ? t.rows[0].telephone : b.telephone ? normaliserTelephone(b.telephone) : null;
      if (!b.ignorerDoublons && (email || telephone)) {
        const d = await ctx.client.query(
          `select id, nom, email, telephone, roles from tiers
           where id <> $1 and not archive and (email = $2 or telephone = $3)
             and ($4::uuid is null or branche_id = $4) limit 10`,
          [req.params.id, email, telephone, t.rows[0].branche_id],
        );
        if (d.rows.length) throw new ErreurApi(409, "doublon_probable", d.rows);
      }
      try {
        const { rows } = await ctx.client.query(
          `update tiers set nom = coalesce($2, nom), email = $3, telephone = $4, langue = coalesce($5, langue),
             roles = coalesce($6, roles), archive = coalesce($7, archive)
           where id = $1 returning id, type, nom, email, telephone, langue, roles, archive`,
          [req.params.id, b.nom ?? null, email, telephone, b.langue ?? null, b.roles ?? null, b.archive ?? null],
        );
        return rows[0];
      } catch (e) {
        if ((e as { code?: string }).code === "23514") throw new ErreurApi(400, "donnees_invalides");
        throw e;
      }
    }),
  );

  /** Tout ce qui s'est passé avec ce client, limité aux domaines que l'utilisateur a le droit de voir. */
  /** La fiche gardée reprend tout l'historique. Les écritures validées restent sur l'ancienne fiche, intangibles. */
  app.post<{ Params: { id: string }; Body: { doublonId: string } }>("/tiers/:id/fusion", {
    schema: { params: paramId, body: { type: "object", required: ["doublonId"], properties: { doublonId: { type: "string", format: "uuid" } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "utilisateurs.gerer");
      if (req.params.id === req.body.doublonId) throw new ErreurApi(400, "fusion_invalide");
      const garde = await exigerTiersVisible(ctx, req.params.id, "utilisateurs.gerer");
      const doublon = await exigerTiersVisible(ctx, req.body.doublonId, "utilisateurs.gerer");
      if (garde.fusionne_vers || doublon.fusionne_vers) throw new ErreurApi(409, "deja_fusionne");
      if (garde.branche_id && doublon.branche_id && garde.branche_id !== doublon.branche_id) throw new ErreurApi(409, "tiers_autre_branche");
      await ctx.client.query(
        `update tiers set email = coalesce(email, $2), telephone = coalesce(telephone, $3), roles = (select array(select distinct unnest(roles || $4::text[]))), branche_id = coalesce(branche_id, $5) where id = $1`,
        [garde.id, doublon.email, doublon.telephone, doublon.roles, doublon.branche_id],
      );
      await ctx.client.query("update tiers set fusionne_vers = $2, archive = true, email = null, telephone = null where id = $1", [doublon.id, garde.id]);
      let table = "";
      try {
        for (const [t, col] of LIENS_TIERS) {
          table = t;
          await ctx.client.query(`update ${t} set ${col} = $2 where ${col} = $1`, [doublon.id, garde.id]);
        }
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new ErreurApi(409, "fusion_impossible", { table });
        throw e;
      }
      await ctx.client.query("select journal_evenement('tiers.fusion', $1)", [JSON.stringify({ garde: garde.id, doublon: doublon.id })]);
      return { fusion: true };
    }),
  );

  app.get<{ Params: { id: string } }>("/tiers/:id/chronologie", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "tiers.voir");
      await exigerTiersVisible(ctx, req.params.id, "tiers.voir");
      const peut = (p: Permission) => aPermission(ctx.client, ctx.utilisateurId, p);
      const portee = async (p: Permission) => (await peut(p)) ? idsAccessibles(ctx, p) : [];
      const crm = await portee("crm.voir");
      const formations = await portee("formations.voir");
      const support = await portee("support.voir");
      const { rows } = await ctx.client.query(
        `select * from (
           select 'activite' as genre, a.type as detail, a.contenu as libelle, a.cree_le as quand
             from activites a where a.tiers_id = $1 and a.entite_id = any($2::uuid[])
           union all select 'opportunite', o.etape, o.titre, o.cree_le
             from opportunites o where o.tiers_id = $1 and o.entite_id = any($2::uuid[])
           union all select 'inscription', i.statut, p.nom, i.cree_le
             from inscriptions i join sessions_formation s on s.id = i.session_id
             join programmes p on p.id = s.programme_id
             where i.tiers_id = $1 and s.entite_id = any($3::uuid[])
           union all select 'paiement', case when pa.annule_le is null then 'valide' else 'annule' end,
               pa.numero_recu || ' : ' || pa.montant || ' FCFA', pa.encaisse_le
             from paiements pa join inscriptions i on i.id = pa.inscription_id
             join sessions_formation s on s.id = i.session_id
             where i.tiers_id = $1 and s.entite_id = any($3::uuid[])
           union all select 'ticket', k.statut, k.numero || ' : ' || k.sujet, k.cree_le
             from tickets k where k.tiers_id = $1 and k.entite_id = any($4::uuid[])
         ) c order by quand desc limit 200`,
        [req.params.id, crm, formations, support],
      );
      return rows;
    }),
  );

  app.post<{
    Body: { entiteId: string; tiersId: string; titre: string; montantEstime?: number; source?: string; responsableId?: string };
  }>("/opportunites", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "tiersId", "titre"],
        properties: {
          entiteId: uuid, tiersId: uuid, titre: texte(200),
          montantEstime: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 },
          source: { type: "string", maxLength: 100 },
          responsableId: uuid,
        },
      },
    },
  }, async (req, reponse) => {
    const o = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "crm.gerer", b.entiteId);
      await exigerModule(ctx, b.entiteId, "crm");
      await lierTiers(ctx, b.tiersId, b.entiteId);
      const { rows } = await ctx.client.query(
        `insert into opportunites (organisation_id, entite_id, tiers_id, titre, montant_estime, source, responsable_id)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [ctx.organisationId, b.entiteId, b.tiersId, b.titre, b.montantEstime ?? 0, b.source ?? null, b.responsableId ?? ctx.utilisateurId],
      );
      await ctx.client.query(
        "update tiers set roles = array_append(roles, 'prospect') where id = $1 and not ('prospect' = any(roles)) and not ('client' = any(roles))",
        [b.tiersId],
      );
      await publierEvenement(ctx.client, "opportunite.creee", { id: rows[0].id });
      return rows[0];
    });
    return reponse.status(201).send(o);
  });

  app.get("/opportunites", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "crm.voir");
      const { rows } = await ctx.client.query(
        `select o.*, t.nom as client, t.telephone, u.nom as responsable
         from opportunites o join tiers t on t.id = o.tiers_id
         left join utilisateurs u on u.id = o.responsable_id
         where o.entite_id = any($1::uuid[]) order by o.cree_le desc limit 500`,
        [await idsAccessibles(ctx, "crm.voir")],
      );
      const gagnees = rows.filter((o) => o.etape === "gagne").length;
      const closes = gagnees + rows.filter((o) => o.etape === "perdu").length;
      return {
        opportunites: rows,
        etapes: ETAPES.map((etape) => {
          const l = rows.filter((o) => o.etape === etape);
          return { etape, nombre: l.length, montant: l.reduce((s, o) => s + o.montant_estime, 0) };
        }),
        taux_conversion: closes ? Math.round((gagnees * 100) / closes) : null,
      };
    }),
  );

  app.patch<{
    Params: { id: string };
    Body: { etape?: string; titre?: string; montantEstime?: number; responsableId?: string; motifPerte?: string };
  }>("/opportunites/:id", {
    schema: {
      params: paramId,
      body: {
        type: "object", minProperties: 1,
        properties: {
          etape: { type: "string", enum: ETAPES }, titre: texte(200),
          montantEstime: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 },
          responsableId: uuid, motifPerte: { type: "string", minLength: 3, maxLength: 500 },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const o = await ctx.client.query("select * from opportunites where id = $1 for update", [req.params.id]);
      if (!o.rows[0]) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "crm.gerer", o.rows[0].entite_id);
      const b = req.body;
      const etape = b.etape ?? o.rows[0].etape;
      if (etape === "perdu" && !b.motifPerte && !o.rows[0].motif_perte) throw new ErreurApi(400, "motif_obligatoire");
      const close = etape === "gagne" || etape === "perdu";
      const { rows } = await ctx.client.query(
        `update opportunites set etape = $2, titre = coalesce($3, titre), montant_estime = coalesce($4, montant_estime),
           responsable_id = coalesce($5, responsable_id),
           motif_perte = case when $2 = 'perdu' then coalesce($6, motif_perte) else null end,
           clos_le = case when $7 then coalesce(clos_le, now()) else null end
         where id = $1 returning *`,
        [req.params.id, etape, b.titre ?? null, b.montantEstime ?? null, b.responsableId ?? null, b.motifPerte ?? null, close],
      );
      if (etape === "gagne" && o.rows[0].etape !== "gagne") {
        await ctx.client.query(
          "update tiers set roles = array_append(array_remove(roles, 'prospect'), 'client') where id = $1 and not ('client' = any(roles))",
          [o.rows[0].tiers_id],
        );
        await publierEvenement(ctx.client, "opportunite.gagnee", { id: req.params.id });
      }
      return rows[0];
    }),
  );

  app.post<{ Body: { opportuniteId: string; type: string; contenu: string } }>("/activites", {
    schema: {
      body: {
        type: "object", required: ["opportuniteId", "type", "contenu"],
        properties: {
          opportuniteId: uuid,
          type: { type: "string", enum: ["appel", "whatsapp", "email", "visite", "note"] },
          contenu: texte(2000),
        },
      },
    },
  }, async (req, reponse) => {
    const a = await protege(req, async (ctx) => {
      const o = await ctx.client.query("select entite_id, tiers_id from opportunites where id = $1", [req.body.opportuniteId]);
      if (!o.rows[0]) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "crm.gerer", o.rows[0].entite_id);
      const { rows } = await ctx.client.query(
        `insert into activites (organisation_id, entite_id, tiers_id, opportunite_id, type, contenu, auteur_id)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [ctx.organisationId, o.rows[0].entite_id, o.rows[0].tiers_id, req.body.opportuniteId, req.body.type, req.body.contenu, ctx.utilisateurId],
      );
      return rows[0];
    });
    return reponse.status(201).send(a);
  });

  app.post<{
    Body: { entiteId: string; tiersId: string; sujet: string; message: string; canal?: string; priorite?: string; assigneA?: string };
  }>("/tickets", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "tiersId", "sujet", "message"],
        properties: {
          entiteId: uuid, tiersId: uuid, sujet: texte(200), message: texte(5000),
          canal: { type: "string", enum: ["telephone", "whatsapp", "email", "site", "application", "magasin"] },
          priorite: { type: "string", enum: ["basse", "normale", "haute"] },
          assigneA: uuid,
        },
      },
    },
  }, async (req, reponse) => {
    const k = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "support.gerer", b.entiteId);
      await exigerModule(ctx, b.entiteId, "support");
      await lierTiers(ctx, b.tiersId, b.entiteId);
      const priorite = b.priorite ?? "normale";
      const numero = await prochainNumero(ctx.client, `TIC-${new Date().getFullYear()}`);
      const { rows } = await ctx.client.query(
        `insert into tickets (organisation_id, entite_id, numero, tiers_id, sujet, canal, priorite, assigne_a, echeance)
         values ($1, $2, $3, $4, $5, coalesce($6, 'whatsapp'), $7, $8, now() + make_interval(hours => $9)) returning *`,
        [ctx.organisationId, b.entiteId, numero, b.tiersId, b.sujet, b.canal ?? null, priorite, b.assigneA ?? null, HEURES_PAR_PRIORITE[priorite]],
      );
      await ctx.client.query(
        "insert into ticket_messages (organisation_id, ticket_id, auteur_id, contenu) values ($1, $2, $3, $4)",
        [ctx.organisationId, rows[0].id, ctx.utilisateurId, b.message],
      );
      await publierEvenement(ctx.client, "ticket.cree", { id: rows[0].id });
      return rows[0];
    });
    return reponse.status(201).send(k);
  });

  app.get("/tickets", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "support.voir");
      const { rows } = await ctx.client.query(
        `select k.*, t.nom as client, t.telephone, u.nom as assigne,
           k.statut in ('ouvert', 'en_cours') and k.echeance < now() as en_retard
         from tickets k join tiers t on t.id = k.tiers_id left join utilisateurs u on u.id = k.assigne_a
         where k.entite_id = any($1::uuid[])
         order by k.statut in ('resolu', 'ferme'), k.echeance limit 500`,
        [await idsAccessibles(ctx, "support.voir")],
      );
      return rows;
    }),
  );

  const ticketAutorise = async (ctx: Contexte, id: string, permission: Permission, verrou = false) => {
    const { rows } = await ctx.client.query(
      `select k.*, t.nom as client, t.telephone, u.nom as assigne,
         k.statut in ('ouvert', 'en_cours') and k.echeance < now() as en_retard
       from tickets k join tiers t on t.id = k.tiers_id left join utilisateurs u on u.id = k.assigne_a
       where k.id = $1 ${verrou ? "for update of k" : ""}`,
      [id],
    );
    if (!rows[0]) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, permission, rows[0].entite_id);
    return rows[0];
  };

  app.get<{ Params: { id: string } }>("/tickets/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const ticket = await ticketAutorise(ctx, req.params.id, "support.voir");
      const { rows } = await ctx.client.query(
        `select m.contenu, m.cree_le, u.nom as auteur from ticket_messages m join utilisateurs u on u.id = m.auteur_id
         where m.ticket_id = $1 order by m.cree_le`,
        [req.params.id],
      );
      return { ...ticket, messages: rows };
    }),
  );

  app.post<{ Params: { id: string }; Body: { contenu: string } }>("/tickets/:id/messages", {
    schema: { params: paramId, body: { type: "object", required: ["contenu"], properties: { contenu: texte(5000) } } },
  }, async (req, reponse) => {
    await protege(req, async (ctx) => {
      await ticketAutorise(ctx, req.params.id, "support.gerer");
      await ctx.client.query(
        "insert into ticket_messages (organisation_id, ticket_id, auteur_id, contenu) values ($1, $2, $3, $4)",
        [ctx.organisationId, req.params.id, ctx.utilisateurId, req.body.contenu],
      );
    });
    return reponse.status(201).send({ ajoute: true });
  });

  app.patch<{ Params: { id: string }; Body: { statut?: string; priorite?: string; assigneA?: string } }>("/tickets/:id", {
    schema: {
      params: paramId,
      body: {
        type: "object", minProperties: 1,
        properties: {
          statut: { type: "string", enum: ["ouvert", "en_cours", "resolu", "ferme"] },
          priorite: { type: "string", enum: ["basse", "normale", "haute"] },
          assigneA: uuid,
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const k = await ticketAutorise(ctx, req.params.id, "support.gerer", true);
      const b = req.body;
      const statut = b.statut ?? k.statut;
      const termine = statut === "resolu" || statut === "ferme";
      const nouvellePriorite = b.priorite && b.priorite !== k.priorite;
      const { rows } = await ctx.client.query(
        `update tickets set statut = $2, priorite = coalesce($3, priorite), assigne_a = coalesce($4, assigne_a),
           resolu_le = case when $5 then coalesce(resolu_le, now()) else null end,
           echeance = case when $6::int is null then echeance else cree_le + make_interval(hours => $6::int) end
         where id = $1 returning *`,
        [req.params.id, statut, b.priorite ?? null, b.assigneA ?? null, termine, nouvellePriorite ? HEURES_PAR_PRIORITE[b.priorite!] : null],
      );
      if (termine && !k.resolu_le) await publierEvenement(ctx.client, "ticket.resolu", { id: req.params.id });
      return rows[0];
    }),
  );

  app.post<{
    Body: { entiteId: string; titre: string; description?: string; assigneA?: string; echeance?: string; tiersId?: string };
  }>("/taches", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "titre"],
        properties: {
          entiteId: uuid, titre: texte(200), description: { type: "string", maxLength: 2000 },
          assigneA: uuid, echeance: { type: "string", format: "date" }, tiersId: uuid,
        },
      },
    },
  }, async (req, reponse) => {
    const t = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "taches.gerer", b.entiteId);
      await exigerModule(ctx, b.entiteId, "pilotage");
      if (b.tiersId) await lierTiers(ctx, b.tiersId, b.entiteId);
      const { rows } = await ctx.client.query(
        `insert into taches (organisation_id, entite_id, titre, description, assigne_a, cree_par, echeance, tiers_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
        [ctx.organisationId, b.entiteId, b.titre, b.description ?? null, b.assigneA ?? ctx.utilisateurId, ctx.utilisateurId, b.echeance ?? null, b.tiersId ?? null],
      );
      await publierEvenement(ctx.client, "tache.creee", { id: rows[0].id, assigneA: rows[0].assigne_a });
      return rows[0];
    });
    return reponse.status(201).send(t);
  });

  /** Chacun voit ses tâches, et celles des entités qu'il gère. */
  app.get("/taches", async (req) =>
    protege(req, async (ctx) => {
      const { rows } = await ctx.client.query(
        `select t.*, u.nom as assigne, t.statut in ('a_faire', 'en_cours') and t.echeance < current_date as en_retard
         from taches t join utilisateurs u on u.id = t.assigne_a
         where t.assigne_a = $1 or t.entite_id = any($2::uuid[])
         order by t.statut in ('terminee', 'annulee'), t.echeance nulls last, t.cree_le desc limit 500`,
        [ctx.utilisateurId, await idsAccessibles(ctx, "taches.gerer")],
      );
      return rows;
    }),
  );

  app.patch<{ Params: { id: string }; Body: { statut: string } }>("/taches/:id", {
    schema: {
      params: paramId,
      body: { type: "object", required: ["statut"], properties: { statut: { type: "string", enum: ["a_faire", "en_cours", "terminee", "annulee"] } } },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const t = await ctx.client.query("select * from taches where id = $1 for update", [req.params.id]);
      if (!t.rows[0]) throw new ErreurApi(404, "introuvable");
      const gere = await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "taches.gerer", t.rows[0].entite_id);
      if (!gere && t.rows[0].assigne_a !== ctx.utilisateurId) throw new ErreurApi(403, "permission_refusee");
      const { rows } = await ctx.client.query(
        `update taches set statut = $2, termine_le = case when $2 = 'terminee' then coalesce(termine_le, now()) else null end
         where id = $1 returning *`,
        [req.params.id, req.body.statut],
      );
      return rows[0];
    }),
  );
}
