import type { FastifyInstance } from "fastify";
import { aRelancer } from "./recouvrement.js";
import { entitesAccessibles, aPermission, aPermissionGlobale } from "./permissions.js";
import type { Contexte, Outils } from "./serveur.js";
import { branchesVisibles } from "./tiers.js";

const JOUR = "(now() at time zone 'Africa/Douala')::date";

export function enregistrerSocle(app: FastifyInstance, outils: Outils): void {
  const { protege, exiger } = outils;
  const ids = async (ctx: Contexte, p: Parameters<typeof entitesAccessibles>[2]) => (await entitesAccessibles(ctx.client, ctx.utilisateurId, p)).map((e) => e.id);

  /** Chaque source garde ses propres droits : la recherche ne montre rien de plus que les écrans. */
  app.get<{ Querystring: { q: string } }>("/recherche", {
    schema: { querystring: { type: "object", required: ["q"], properties: { q: { type: "string", minLength: 2, maxLength: 100 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const motif = `%${req.query.q.replace(/[\\%_]/g, "\\$&")}%`;
      const res: { genre: string; id: string; titre: string; detail: string }[] = [];
      const ajouter = (genre: string, rows: { id: string; titre: string; detail: string | null }[]) => { for (const r of rows) res.push({ genre, id: r.id, titre: r.titre, detail: r.detail ?? "" }); };
      if (await aPermission(ctx.client, ctx.utilisateurId, "tiers.voir")) {
        const v = await branchesVisibles(ctx.client, ctx.utilisateurId, "tiers.voir");
        ajouter("client", (await ctx.client.query(
          "select id, nom as titre, coalesce(telephone, email) as detail from tiers where not archive and ($2::boolean or branche_id = any($3::uuid[])) and (nom ilike $1 or telephone ilike $1 or email ilike $1) order by nom limit 10", [motif, v.tout, v.ids],
        )).rows);
      }
      const f = await ids(ctx, "facturation.voir");
      if (f.length) {
        ajouter("document", (await ctx.client.query(
          "select d.id, d.numero as titre, coalesce(d.client_nom, t.nom) as detail from documents_vente d join tiers t on t.id = d.tiers_id where d.entite_id = any($2::uuid[]) and d.numero ilike $1 order by d.cree_le desc limit 10", [motif, f],
        )).rows);
        ajouter("produit", (await ctx.client.query("select id, nom as titre, code as detail from produits where entite_id = any($2::uuid[]) and (nom ilike $1 or code ilike $1) order by nom limit 10", [motif, f])).rows);
      }
      const s = await ids(ctx, "formations.voir");
      if (s.length) ajouter("session", (await ctx.client.query("select s.id, s.code as titre, p.nom as detail from sessions_formation s join programmes p on p.id = s.programme_id where s.entite_id = any($2::uuid[]) and (s.code ilike $1 or p.nom ilike $1) order by s.debut desc limit 10", [motif, s])).rows);
      const t = await ids(ctx, "support.voir");
      if (t.length) ajouter("ticket", (await ctx.client.query("select id, sujet as titre, statut as detail from tickets where entite_id = any($2::uuid[]) and sujet ilike $1 order by cree_le desc limit 10", [motif, t])).rows);
      return res;
    }),
  );

  /** Calculé à l'ouverture, selon les droits de chacun. */
  app.get("/notifications", async (req) =>
    protege(req, async (ctx) => {
      const n: { genre: string; texte: string; nombre: number }[] = [];
      const noter = (genre: string, nombre: number, texte: string) => { if (nombre) n.push({ genre, nombre, texte }); };
      const compte = async (sql: string, p: unknown[]) => (await ctx.client.query(sql, p)).rows[0].n as number;
      const { rows: [moi] } = await ctx.client.query("select totp_actif, mot_de_passe_provisoire from utilisateurs where id = $1", [ctx.utilisateurId]);
      if (moi.mot_de_passe_provisoire) noter("compte", 1, "mot de passe provisoire à changer");
      if (!moi.totp_actif && await aPermissionGlobale(ctx.client, ctx.utilisateurId, "utilisateurs.gerer")) noter("compte", 1, "double authentification à activer sur votre compte d'administrateur");
      const { rows: [m] } = await ctx.client.query("select count(*) filter (where niveau = 'urgent')::int as u, count(*)::int as n from notifications_personnes where utilisateur_id = $1 and lu_le is null", [ctx.utilisateurId]);
      noter("messages_urgents", m.u, "message(s) urgent(s) de la performance au quotidien");
      noter("messages", m.n - m.u, "nouveau(x) message(s) de la performance au quotidien");
      noter("taches", await compte(`select count(*)::int as n from taches where assigne_a = $1 and statut in ('a_faire', 'en_cours') and echeance <= ${JOUR}`, [ctx.utilisateurId]), "tâche(s) à faire aujourd'hui ou en retard");
      noter("tickets", await compte("select count(*)::int as n from tickets where assigne_a = $1 and statut in ('ouvert', 'en_cours') and echeance < now()", [ctx.utilisateurId]), "ticket(s) en retard");
      const k = await ids(ctx, "pilotage.gerer");
      if (k.length) noter("alertes", await compte("select count(*)::int as n from alertes_kpi a join kpi_suivis s on s.id = a.kpi_id where a.statut = 'nouvelle' and s.entite_id = any($1::uuid[])", [k]), "alerte(s) d'indicateur à décider");
      const f = await ids(ctx, "facturation.gerer");
      if (f.length) {
        const { rows: br } = await ctx.client.query("select distinct entite_branche(id) as id from entites where id = any($1::uuid[])", [f]);
        let total = 0;
        for (const b of br) if (b.id) total += (await aRelancer(ctx.client, b.id)).length;
        noter("relances", total, "relance(s) à envoyer");
      }
      const t = await ids(ctx, "tresorerie.gerer");
      if (t.length) noter("tresorerie", await compte("select count(*)::int as n from encaissements_en_attente where affecte_le is null and annule_le is null and entite_branche(entite_id) = any($1::uuid[])", [t]), "encaissement(s) à placer dans un portefeuille");
      const a = await ids(ctx, "apprentissage.gerer");
      if (a.length) {
        noter("questions", await compte("select count(*)::int as n from questions_cours q join cours c on c.id = q.cours_id where q.reponse is null and c.entite_id = any($1::uuid[])", [a]), "question(s) d'apprenants sans réponse");
        noter("inactifs", await compte("select count(*)::int as n from acces_cours x join cours c on c.id = x.cours_id where x.actif and x.termine_le is null and coalesce(x.derniere_activite, x.cree_le) < now() - interval '14 days' and c.entite_id = any($1::uuid[])", [a]), "apprenant(s) inactif(s) depuis 14 jours");
      }
      const dc = await ids(ctx, "documents.voir");
      if (dc.length) noter("contrats", await compte(`select count(*)::int as n from contrats where resilie_le is null and fin is not null and fin - ${JOUR} <= rappel_jours and entite_id = any($1::uuid[])`, [dc]), "contrat(s) à renouveler ou expiré(s)");
      if (k.length) noter("maintenance", await compte(`select count(*)::int as n from equipements where actif and prochaine <= ${JOUR} and entite_id = any($1::uuid[])`, [k]), "maintenance(s) due(s)");
      const c = await ids(ctx, "compta.valider");
      if (c.length) {
        noter("ecritures", await compte("select count(*)::int as n from ecritures where statut = 'brouillon' and branche_id = any($1::uuid[])", [c]), "écriture(s) à valider");
        noter("fiscal", await compte(`select count(*)::int as n from echeances_fiscales where faite_le is null and jour <= ${JOUR} + 7 and branche_id = any($1::uuid[])`, [c]), "échéance(s) fiscale(s) sous 7 jours ou en retard");
        noter("pertes", await compte("select count(*)::int as n from creances_douteuses where statut = 'perte_demandee' and branche_id = any($1::uuid[])", [c]), "passage(s) en perte à valider");
      }
      return n;
    }),
  );

  app.get("/separation", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "utilisateurs.gerer");
      const { rows: [r] } = await ctx.client.query("select ecritures, commandes, factures_fournisseur, pertes from regles_separation");
      return r ?? { ecritures: false, commandes: false, factures_fournisseur: false, pertes: true };
    }),
  );
  app.put<{ Body: { ecritures: boolean; commandes: boolean; facturesFournisseur: boolean; pertes: boolean } }>("/separation", {
    schema: { body: { type: "object", required: ["ecritures", "commandes", "facturesFournisseur", "pertes"], properties: { ecritures: { type: "boolean" }, commandes: { type: "boolean" }, facturesFournisseur: { type: "boolean" }, pertes: { type: "boolean" } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "utilisateurs.gerer");
      const b = req.body;
      await ctx.client.query(
        `insert into regles_separation (organisation_id, ecritures, commandes, factures_fournisseur, pertes) values ($1, $2, $3, $4, $5)
         on conflict (organisation_id) do update set ecritures = excluded.ecritures, commandes = excluded.commandes, factures_fournisseur = excluded.factures_fournisseur, pertes = excluded.pertes`,
        [ctx.organisationId, b.ecritures, b.commandes, b.facturesFournisseur, b.pertes],
      );
      await ctx.client.query("select journal_evenement('securite.separation', $1)", [JSON.stringify(b)]);
      return { enregistre: true };
    }),
  );
}
