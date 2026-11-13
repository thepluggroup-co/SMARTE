import type { FastifyInstance } from "fastify";
import pg from "pg";
import { dansOrganisation, type Client } from "./base.js";
import { prochainNumero } from "./formations.js";
import { aPermission, aPermissionGlobale, entitesAccessibles } from "./permissions.js";
import { ErreurApi, type Contexte, type Outils, type TachePlanifiee } from "./serveur.js";
import { exigerTiersVisible } from "./tiers.js";

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const texte = (max = 300) => ({ type: "string", minLength: 1, maxLength: max }) as const;
const JOUR = "(now() at time zone 'Africa/Douala')::date";

export const MODELES_REGLES = [
  { nom: "Suivre un prospect capté", evenement: "prospect.capte", titre: "Rappeler le nouveau prospect" },
  { nom: "Traiter une candidature", evenement: "candidature.recue", titre: "Lire la nouvelle candidature" },
  { nom: "Contrôler une perte", evenement: "creance.perte", titre: "Vérifier la créance passée en perte" },
  { nom: "Préparer un cours ouvert", evenement: "parcours.cours_ouvert", titre: "Accueillir l'apprenant sur son nouveau cours" },
];
/** Une condition simple : un champ de l'événement égal à une valeur. Rien n'est évalué comme du code. */
export function conditionVraie(charge: Record<string, unknown>, champ: string | null, valeur: string | null): boolean {
  return !champ || String(charge?.[champ] ?? "") === (valeur ?? "");
}
/** Classement ABC : A jusqu'à 80 % du chiffre d'affaires, B jusqu'à 95 %, C ensuite. */
export function classerAbc<T extends { ca: number }>(l: T[]): (T & { classe: string })[] {
  const total = l.reduce((s, x) => s + x.ca, 0);
  let cumul = 0;
  return [...l].sort((a, b) => b.ca - a.ca).map((x) => { const avant = cumul; cumul += x.ca; return { ...x, classe: !total || avant / total < 0.8 ? "A" : avant / total < 0.95 ? "B" : "C" }; });
}

export function enregistrerAutomatisation(app: FastifyInstance, pool: pg.Pool, outils: Outils, taches: TachePlanifiee[]): void {
  const { protege, exiger, exigerSurEntite } = outils;
  const ids = async (ctx: Contexte, p: Parameters<typeof entitesAccessibles>[2]) => (await entitesAccessibles(ctx.client, ctx.utilisateurId, p)).map((e) => e.id);

  // Règles si, alors
  app.get("/regles-auto/modeles", async (req) => protege(req, async (ctx) => { await exiger(ctx, "pilotage.voir"); return MODELES_REGLES; }));
  app.post<{ Body: { entiteId: string; nom: string; evenement: string; champ?: string; valeur?: string; titre: string; assigneA: string; delaiJours?: number; action?: string } }>("/regles-auto", {
    schema: { body: { type: "object", required: ["entiteId", "nom", "evenement", "titre", "assigneA"], properties: { entiteId: uuid, nom: texte(200), evenement: { type: "string", pattern: "^[a-z_]+\\.[a-z_]+$", maxLength: 100 }, champ: { type: "string", pattern: "^[A-Za-z_]+$", maxLength: 50 }, valeur: texte(200), titre: texte(200), assigneA: uuid, delaiJours: { type: "integer", minimum: 0, maximum: 365 }, action: { type: "string", enum: ["tache", "ticket"] } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "pilotage.gerer", b.entiteId);
      // Les événements couvrent tout le groupe : une règle est réservée à qui voit tout le groupe.
      if (!(await aPermissionGlobale(ctx.client, ctx.utilisateurId, "pilotage.gerer"))) throw new ErreurApi(403, "permission_refusee");
      return (await ctx.client.query("insert into regles_auto (organisation_id, entite_id, nom, evenement, champ, valeur, action, titre, assigne_a, delai_jours, auteur_id) values ($1, $2, $3, $4, $5, $6, $11, $7, $8, $9, $10) returning id", [ctx.organisationId, b.entiteId, b.nom, b.evenement, b.champ ?? null, b.valeur ?? null, b.titre, b.assigneA, b.delaiJours ?? 3, ctx.utilisateurId, b.action ?? "tache"])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/regles-auto", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "pilotage.voir");
      return (await ctx.client.query("select r.id, r.nom, r.evenement, r.champ, r.valeur, r.titre, r.actif, r.delai_jours, u.nom as assigne, (select count(*)::int from executions_regle x where x.regle_id = r.id) as executions, (select max(x.cree_le) from executions_regle x where x.regle_id = r.id) as derniere from regles_auto r join utilisateurs u on u.id = r.assigne_a where r.entite_id = any($1::uuid[]) order by r.nom", [await ids(ctx, "pilotage.voir")])).rows;
    }),
  );
  const regle = async (ctx: Contexte, id: string) => {
    const { rows: [r] } = await ctx.client.query("select * from regles_auto where id = $1", [id]);
    if (!r) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, "pilotage.gerer", r.entite_id);
    return r;
  };
  app.get("/regles-auto/evenements", async (req) => protege(req, async (ctx) => { await exiger(ctx, "pilotage.voir"); return (await ctx.client.query("select distinct type from evenements order by type limit 200")).rows.map((r) => r.type as string); }));
  app.post<{ Params: { id: string }; Body: { actif: boolean } }>("/regles-auto/:id/etat", {
    schema: { params: paramId, body: { type: "object", required: ["actif"], properties: { actif: { type: "boolean" } } } },
  }, async (req) => protege(req, async (ctx) => { await regle(ctx, req.params.id); await ctx.client.query("update regles_auto set actif = $2 where id = $1", [req.params.id, req.body.actif]); return { actif: req.body.actif }; }));
  /** Simulation : ce que la règle aurait fait sur 30 jours, sans rien créer. */
  app.get<{ Params: { id: string } }>("/regles-auto/:id/simulation", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const r = await regle(ctx, req.params.id);
      const { rows } = await ctx.client.query("select charge from evenements where type = $1 and cree_le > now() - interval '30 days' limit 5000", [r.evenement]);
      return { evenements: rows.length, declenchements: rows.filter((e) => conditionVraie(e.charge, r.champ, r.valeur)).length };
    }),
  );
  const appliquerRegles = async (c: Client, org: string) => {
    const { rows: regles } = await c.query("select * from regles_auto where actif");
    for (const r of regles) {
      const { rows } = await c.query("select e.id, e.charge from evenements e where e.type = $1 and e.cree_le >= $2 and not exists (select 1 from executions_regle x where x.regle_id = $3 and x.evenement_id = e.id) order by e.cree_le limit 200", [r.evenement, r.depuis, r.id]);
      for (const e of rows) {
        const vrai = conditionVraie(e.charge, r.champ, r.valeur);
        const client = (e.charge?.tiers ?? null) as string | null;
        const memeBranche = client ? (await c.query("select 1 from tiers t where t.id = $1 and t.branche_id = entite_branche($2)", [client, r.entite_id])).rows.length > 0 : false;
        const enTicket = vrai && r.action === "ticket" && memeBranche;
        if (enTicket) {
          // Un ticket concerne un client : sans client dans l'événement, la règle crée une tâche.
          const numero = await prochainNumero(c, `TIC-${new Date().getFullYear()}`);
          await c.query(`insert into tickets (organisation_id, entite_id, tiers_id, numero, sujet, canal, priorite, assigne_a, echeance) values ($1, $2, $3, $4, $5, 'application', 'normale', $6, now() + make_interval(days => $7::int))`, [org, r.entite_id, client, numero, r.titre.slice(0, 200), r.assigne_a, r.delai_jours]);
        } else if (vrai) await c.query(`insert into taches (organisation_id, entite_id, titre, description, assigne_a, cree_par, echeance) values ($1, $2, $3, $4, $5, $6, ${JOUR} + $7::int)`, [org, r.entite_id, r.titre.slice(0, 200), `Règle : ${r.nom}`, r.assigne_a, r.auteur_id, r.delai_jours]);
        await c.query("insert into executions_regle (organisation_id, regle_id, evenement_id, resultat) values ($1, $2, $3, $4)", [org, r.id, e.id, vrai ? (enTicket ? "ticket_cree" : "tache_creee") : "condition_fausse"]);
      }
    }
  };
  taches.push((org) => dansOrganisation(pool, org, (c) => appliquerRegles(c, org)));

  // Analyses
  app.get<{ Querystring: { debut: string; fin: string; brancheId?: string } }>("/analyses/produits", {
    schema: { querystring: { type: "object", required: ["debut", "fin"], properties: { debut: date, fin: date, brancheId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "facturation.voir");
      const v = await ids(ctx, "facturation.voir");
      const { debut, fin, brancheId } = req.query;
      const { rows } = await ctx.client.query(
        `select p.id, p.code, p.nom, p.cout_moyen::int8 as cout, p.actif, coalesce(sum(l.q), 0)::float as quantite, coalesce(sum(l.ca), 0)::int8 as ca from produits p left join (
           select l.produit_id, l.quantite as q, case when d.type = 'avoir' then -l.montant_ht else l.montant_ht end as ca, d.entite_id from lignes_vente l join documents_vente d on d.id = l.document_id where d.type in ('facture', 'avoir') and d.statut = 'emis' and d.date_document between $2 and $3
           union all select l.produit_id, l.quantite, l.montant_ht, v.entite_id from lignes_comptoir l join ventes_comptoir v on v.id = l.vente_id where v.annulee_le is null and (v.cree_le at time zone 'Africa/Douala')::date between $2 and $3
         ) l on l.produit_id = p.id and l.entite_id = any($1::uuid[]) where p.entite_id = any($1::uuid[]) and ($4::uuid is null or entite_branche(p.entite_id) = $4) group by p.id limit 5000`, [v, debut, fin, brancheId ?? null],
      );
      const ventes = classerAbc(rows.filter((r) => r.quantite > 0).map((r) => ({ id: r.id, code: r.code, nom: r.nom, quantite: r.quantite, ca: Number(r.ca), marge: Number(r.ca) - Math.round(r.quantite * Number(r.cout)) })));
      return { lignes: ventes.slice(0, 200), dormants: rows.filter((r) => r.quantite === 0 && r.actif).map((r) => ({ code: r.code, nom: r.nom })).slice(0, 100), total: ventes.reduce((s, x) => s + x.ca, 0), marge: ventes.reduce((s, x) => s + x.marge, 0) };
    }),
  );

  // Tour de contrôle
  app.get("/tour-de-controle", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "pilotage.voir");
      const c = ctx.client;
      const v = await ids(ctx, "pilotage.voir");
      const sous = (await c.query("with recursive a as (select id from entites where id = any($1::uuid[]) union select e.id from entites e join a on e.parent_id = a.id) select id from a", [v])).rows.map((r) => r.id);
      const un = async (sql: string) => Number((await c.query(sql, [sous])).rows[0].n);
      return {
        colis_en_cours: await un("select count(*) as n from colis where entite_id = any($1::uuid[]) and statut not in ('livre', 'echec', 'retourne')"),
        colis_en_echec: await un("select count(*) as n from colis where entite_id = any($1::uuid[]) and statut = 'echec'"),
        sessions_du_jour: await un(`select count(*) as n from sessions_formation where entite_id = any($1::uuid[]) and ${JOUR} between debut and fin`),
        encaissements_du_jour: await un(`select coalesce(sum(m.montant), 0) as n from mouvements_portefeuille m join portefeuilles w on w.id = m.portefeuille_id where w.entite_id = any($1::uuid[]) and m.montant > 0 and m.type <> 'ouverture' and (m.cree_le at time zone 'Africa/Douala')::date = ${JOUR}`),
        caisses_ouvertes: await un("select count(*) as n from sessions_caisse where entite_id = any($1::uuid[]) and fermee_le is null"),
        tickets_en_retard: await un("select count(*) as n from tickets where entite_id = any($1::uuid[]) and statut in ('ouvert', 'en_cours') and echeance < now()"),
        alertes_critiques: await un("select count(*) as n from alertes_kpi a join kpi_suivis k on k.id = a.kpi_id where k.entite_id = any($1::uuid[]) and a.statut = 'nouvelle' and a.niveau = 'critique'"),
        ruptures: await un("select count(*) as n from (select m.produit_id, m.entite_id from mouvements_stock m join produits p on p.id = m.produit_id where m.entite_id = any($1::uuid[]) and p.seuil_alerte > 0 group by m.produit_id, m.entite_id, p.seuil_alerte having sum(m.quantite) <= p.seuil_alerte) x"),
      };
    }),
  );

  // Anomalies à regarder : un signal, jamais une accusation.
  app.get("/anomalies", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "pilotage.voir");
      const res: { genre: string; detail: string; quand: unknown }[] = [];
      if (await aPermission(ctx.client, ctx.utilisateurId, "compta.voir")) {
        const v = await ids(ctx, "compta.voir");
        const { rows } = await ctx.client.query(
          `select t.nom, a.numero_fournisseur as n1, b.numero_fournisseur as n2, a.total_ttc::int8 as m, a.date_facture from factures_fournisseur a join factures_fournisseur b on a.fournisseur_id = b.fournisseur_id and a.total_ttc = b.total_ttc and a.id < b.id and abs(a.date_facture - b.date_facture) <= 30 join tiers t on t.id = a.fournisseur_id
           where a.statut <> 'annulee' and b.statut <> 'annulee' and a.entite_id = any($1::uuid[]) limit 50`, [v],
        );
        for (const r of rows) res.push({ genre: "facture_double", detail: `${r.nom} : ${r.n1} et ${r.n2}, même montant ${r.m} FCFA`, quand: r.date_facture });
      }
      const caisses = await ids(ctx, "caisse.superviser");
      if (caisses.length) {
        const { rows } = await ctx.client.query("select e.nom, s.ecart::int8 as ecart, s.fermee_le, u.nom as caissier from sessions_caisse s join entites e on e.id = s.entite_id join utilisateurs u on u.id = s.caissier_id where s.entite_id = any($1::uuid[]) and s.ecart <> 0 and s.fermee_le > now() - interval '30 days' order by abs(s.ecart) desc limit 50", [caisses]);
        for (const r of rows) res.push({ genre: "ecart_caisse", detail: `${r.nom}, ${r.caissier} : écart de ${r.ecart} FCFA`, quand: r.fermee_le });
        const { rows: an } = await ctx.client.query("select u.nom, count(*)::int as n from ventes_comptoir v join utilisateurs u on u.id = v.annulee_par where v.entite_id = any($1::uuid[]) and v.annulee_le > now() - interval '30 days' group by u.nom having count(*) >= 5 order by n desc", [caisses]);
        for (const r of an) res.push({ genre: "annulations", detail: `${r.nom} : ${r.n} ventes annulées en 30 jours`, quand: null });
      }
      return res;
    }),
  );

  // Questions en langage courant, sur des réponses préparées et les droits de chacun.
  app.post<{ Body: { question: string } }>("/assistant", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    schema: { body: { type: "object", required: ["question"], properties: { question: texte(300) } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const q = req.body.question.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      const refuse = { reponse: "Vous n'avez pas accès à cette information." };
      if (/impaye|creance|unpaid|overdue/.test(q)) {
        const v = await ids(ctx, "facturation.voir");
        if (!v.length) return refuse;
        const jours = Number(q.match(/(\d+)\s*(jour|day)/)?.[1] ?? 0);
        const { rows } = await ctx.client.query(
          `select t.nom, sum(f.reste)::int8 as reste from (select d.tiers_id, d.total_ttc - (select coalesce(sum(r.montant), 0) from reglements r where r.facture_id = d.id and r.annule_le is null) - (select coalesce(sum(a.total_ttc), 0) from documents_vente a where a.origine_id = d.id and a.type = 'avoir' and a.statut = 'emis') as reste from documents_vente d
             where d.type = 'facture' and d.statut = 'emis' and d.entite_id = any($1::uuid[]) and ${JOUR} - coalesce(d.date_echeance, d.date_document) >= $2 and not exists (select 1 from creances_douteuses x where x.facture_id = d.id and x.statut = 'perte')) f join tiers t on t.id = f.tiers_id where f.reste > 0 group by t.nom order by reste desc limit 10`, [v, jours],
        );
        return { reponse: `${rows.length} client(s) doivent ${rows.reduce((s, r) => s + Number(r.reste), 0)} FCFA${jours ? ` depuis au moins ${jours} jours` : ""}.`, lignes: rows.map((r) => ({ libelle: r.nom, valeur: Number(r.reste) })) };
      }
      if (/meilleur|best|top/.test(q) && /produit|article|product/.test(q)) {
        const v = await ids(ctx, "facturation.voir");
        if (!v.length) return refuse;
        const { rows } = await ctx.client.query(`select l.designation as nom, sum(l.montant_ht)::int8 as ca from lignes_vente l join documents_vente d on d.id = l.document_id where d.type = 'facture' and d.statut = 'emis' and d.entite_id = any($1::uuid[]) and d.date_document >= date_trunc('month', ${JOUR}) group by l.designation order by ca desc limit 5`, [v]);
        return { reponse: rows[0] ? `Ce mois-ci : ${rows[0].nom}.` : "Aucune vente facturée ce mois-ci.", lignes: rows.map((r) => ({ libelle: r.nom, valeur: Number(r.ca) })) };
      }
      if (/tresorerie|solde|cash|portefeuille/.test(q)) {
        const v = await ids(ctx, "tresorerie.voir");
        if (!v.length) return refuse;
        const { rows } = await ctx.client.query("select w.nom, coalesce(sum(m.montant), 0)::int8 as s from portefeuilles w left join mouvements_portefeuille m on m.portefeuille_id = w.id where w.entite_id = any($1::uuid[]) and w.actif group by w.nom order by w.nom", [v]);
        return { reponse: `Total : ${rows.reduce((s, r) => s + Number(r.s), 0)} FCFA.`, lignes: rows.map((r) => ({ libelle: r.nom, valeur: Number(r.s) })) };
      }
      if (/inscrit|session|formation|enrol/.test(q)) {
        const v = await ids(ctx, "formations.voir");
        if (!v.length) return refuse;
        const { rows } = await ctx.client.query(`select s.code, count(i.id)::int as n from sessions_formation s left join inscriptions i on i.session_id = s.id and i.statut = 'active' where s.entite_id = any($1::uuid[]) and s.fin >= ${JOUR} group by s.code order by s.code limit 20`, [v]);
        return { reponse: `${rows.length} session(s) en cours ou à venir.`, lignes: rows.map((r) => ({ libelle: r.code, valeur: r.n })) };
      }
      return { reponse: "Je sais répondre sur les impayés, le meilleur produit du mois, la trésorerie et les inscriptions.", inconnu: true };
    }),
  );

  // Contrats et échéances
  app.post<{ Body: { entiteId: string; objet: string; type: string; tiersId?: string; debut?: string; fin?: string; montant?: number; rappelJours?: number; documentId?: string } }>("/contrats", {
    schema: { body: { type: "object", required: ["entiteId", "objet", "type"], properties: { entiteId: uuid, objet: texte(), type: { type: "string", enum: ["client", "fournisseur", "assurance", "licence", "autorisation", "bail", "autre"] }, tiersId: uuid, debut: date, fin: date, montant: { type: "integer", minimum: 0 }, rappelJours: { type: "integer", minimum: 0, maximum: 365 }, documentId: uuid } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "documents.gerer", b.entiteId);
      if (b.tiersId) await exigerTiersVisible(ctx, b.tiersId, "documents.gerer");
      return (await ctx.client.query("insert into contrats (organisation_id, entite_id, objet, type, tiers_id, debut, fin, montant, rappel_jours, document_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id", [ctx.organisationId, b.entiteId, b.objet, b.type, b.tiersId ?? null, b.debut ?? null, b.fin ?? null, b.montant ?? null, b.rappelJours ?? 30, b.documentId ?? null])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/contrats", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "documents.voir");
      return (await ctx.client.query(`select c.id, c.objet, c.type, c.debut::text, c.fin::text, c.montant, c.document_id, t.nom as tiers, e.nom as entite, c.fin is not null and c.fin - ${JOUR} <= c.rappel_jours as a_renouveler, c.fin < ${JOUR} as expire from contrats c join entites e on e.id = c.entite_id left join tiers t on t.id = c.tiers_id where c.entite_id = any($1::uuid[]) and c.resilie_le is null order by c.fin nulls last limit 500`, [await ids(ctx, "documents.voir")])).rows;
    }),
  );
  app.post<{ Params: { id: string } }>("/contrats/:id/resiliation", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [c] } = await ctx.client.query("select entite_id from contrats where id = $1", [req.params.id]);
      if (!c) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "documents.gerer", c.entite_id);
      await ctx.client.query("update contrats set resilie_le = now() where id = $1", [req.params.id]);
      return { resilie: true };
    }),
  );

  // Maintenance
  app.post<{ Body: { entiteId: string; nom: string; lieu?: string; periodiciteJours?: number; prochaine?: string } }>("/equipements", {
    schema: { body: { type: "object", required: ["entiteId", "nom"], properties: { entiteId: uuid, nom: texte(), lieu: texte(), periodiciteJours: { type: "integer", minimum: 1, maximum: 3650 }, prochaine: date } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "pilotage.gerer", b.entiteId);
      return (await ctx.client.query("insert into equipements (organisation_id, entite_id, nom, lieu, periodicite_jours, prochaine) values ($1, $2, $3, $4, $5, $6) returning id", [ctx.organisationId, b.entiteId, b.nom, b.lieu ?? null, b.periodiciteJours ?? null, b.prochaine ?? null])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/equipements", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "pilotage.voir");
      return (await ctx.client.query(`select q.id, q.nom, q.lieu, q.periodicite_jours, q.prochaine::text, q.prochaine <= ${JOUR} as due, e.nom as entite, (select coalesce(sum(i.cout), 0)::int8 from interventions i where i.equipement_id = q.id) as cout_total, (select count(*)::int from interventions i where i.equipement_id = q.id) as interventions from equipements q join entites e on e.id = q.entite_id where q.actif and q.entite_id = any($1::uuid[]) order by q.prochaine nulls last`, [await ids(ctx, "pilotage.voir")])).rows;
    }),
  );
  /** Une intervention préventive repousse la prochaine échéance de la périodicité. */
  app.post<{ Params: { id: string }; Body: { jour: string; nature: string; description: string; cout?: number } }>("/equipements/:id/interventions", {
    schema: { params: paramId, body: { type: "object", required: ["jour", "nature", "description"], properties: { jour: date, nature: { type: "string", enum: ["preventive", "corrective"] }, description: texte(1000), cout: { type: "integer", minimum: 0 } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const { rows: [q] } = await ctx.client.query("select * from equipements where id = $1 for update", [req.params.id]);
      if (!q) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "pilotage.gerer", q.entite_id);
      const b = req.body;
      const { rows: [x] } = await ctx.client.query("insert into interventions (organisation_id, equipement_id, jour, nature, description, cout, auteur_id) values ($1, $2, $3, $4, $5, $6, $7) returning id", [ctx.organisationId, q.id, b.jour, b.nature, b.description, b.cout ?? 0, ctx.utilisateurId]);
      if (b.nature === "preventive" && q.periodicite_jours) await ctx.client.query("update equipements set prochaine = $2::date + periodicite_jours where id = $1", [q.id, b.jour]);
      return x;
    });
    return reponse.status(201).send(r);
  });

  // Audits et check-lists
  app.post<{ Body: { entiteId: string; nom: string; points: string[] } }>("/modeles-audit", {
    schema: { body: { type: "object", required: ["entiteId", "nom", "points"], properties: { entiteId: uuid, nom: texte(), points: { type: "array", minItems: 1, maxItems: 100, items: texte(300) } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "pilotage.gerer", req.body.entiteId);
      return (await ctx.client.query("insert into modeles_audit (organisation_id, entite_id, nom, points) values ($1, $2, $3, $4) returning id", [ctx.organisationId, req.body.entiteId, req.body.nom, JSON.stringify(req.body.points)])).rows[0];
    });
    return reponse.status(201).send(r);
  });
  app.get("/audits", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "pilotage.voir");
      const v = await ids(ctx, "pilotage.voir");
      const { rows: modeles } = await ctx.client.query("select id, nom, points from modeles_audit where entite_id = any($1::uuid[]) order by nom", [v]);
      const { rows: audits } = await ctx.client.query("select a.id, a.lieu, a.jour::text, a.score, a.reponses, m.nom as modele, m.points, u.nom as auteur from audits a join modeles_audit m on m.id = a.modele_id join utilisateurs u on u.id = a.auteur_id where m.entite_id = any($1::uuid[]) order by a.jour desc limit 200", [v]);
      return { modeles, audits };
    }),
  );
  app.post<{ Params: { id: string }; Body: { lieu: string; jour: string; reponses: boolean[] } }>("/modeles-audit/:id/audits", {
    schema: { params: paramId, body: { type: "object", required: ["lieu", "jour", "reponses"], properties: { lieu: texte(), jour: date, reponses: { type: "array", maxItems: 100, items: { type: "boolean" } } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const { rows: [m] } = await ctx.client.query("select * from modeles_audit where id = $1", [req.params.id]);
      if (!m) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "pilotage.gerer", m.entite_id);
      if (req.body.reponses.length !== m.points.length) throw new ErreurApi(400, "reponses_incompletes");
      const score = Math.round((req.body.reponses.filter(Boolean).length * 100) / m.points.length);
      await ctx.client.query("insert into audits (organisation_id, modele_id, lieu, jour, reponses, score, auteur_id) values ($1, $2, $3, $4, $5, $6, $7)", [ctx.organisationId, m.id, req.body.lieu, req.body.jour, JSON.stringify(req.body.reponses), score, ctx.utilisateurId]);
      return { score };
    });
    return reponse.status(201).send(r);
  });

  // Annonces internes et base de connaissances
  app.post<{ Body: { titre: string; contenu: string } }>("/annonces", {
    schema: { body: { type: "object", required: ["titre", "contenu"], properties: { titre: texte(200), contenu: texte(5000) } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => { if (!(await aPermissionGlobale(ctx.client, ctx.utilisateurId, "pilotage.gerer"))) throw new ErreurApi(403, "permission_refusee"); return (await ctx.client.query("insert into annonces (organisation_id, titre, contenu, auteur_id) values ($1, $2, $3, $4) returning id", [ctx.organisationId, req.body.titre, req.body.contenu, ctx.utilisateurId])).rows[0]; });
    return reponse.status(201).send(r);
  });
  app.get("/annonces", async (req) => protege(req, async (ctx) => (await ctx.client.query("select a.id, a.titre, a.contenu, a.cree_le, u.nom as auteur from annonces a join utilisateurs u on u.id = a.auteur_id order by a.cree_le desc limit 30")).rows));
  app.post<{ Body: { titre: string; contenu: string; categorie?: string } }>("/aide", {
    schema: { body: { type: "object", required: ["titre", "contenu"], properties: { titre: texte(200), contenu: texte(20000), categorie: texte(100) } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => { await exiger(ctx, "support.gerer"); return (await ctx.client.query("insert into articles_aide (organisation_id, titre, contenu, categorie, auteur_id) values ($1, $2, $3, $4, $5) returning id", [ctx.organisationId, req.body.titre, req.body.contenu, req.body.categorie ?? null, ctx.utilisateurId])).rows[0]; });
    return reponse.status(201).send(r);
  });
  app.get<{ Querystring: { q?: string } }>("/aide", { schema: { querystring: { type: "object", properties: { q: { type: "string", maxLength: 100 } } } } }, async (req) =>
    protege(req, async (ctx) => {
      const motif = `%${(req.query.q ?? "").replace(/[\\%_]/g, "\\$&")}%`;
      return (await ctx.client.query("select id, titre, contenu, categorie from articles_aide where titre ilike $1 or contenu ilike $1 order by titre limit 100", [motif])).rows;
    }),
  );

  // Données personnelles
  app.get<{ Params: { id: string } }>("/tiers/:id/donnees-personnelles", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "utilisateurs.gerer");
      const t = await exigerTiersVisible(ctx, req.params.id, "utilisateurs.gerer");
      const c = ctx.client;
      const compte = async (sql: string) => (await c.query(sql, [t.id])).rows[0].n as number;
      await c.query("select journal_evenement('rgpd.export', $1)", [JSON.stringify({ tiers: t.id })]);
      return {
        fiche: { nom: t.nom, email: t.email, telephone: t.telephone, langue: t.langue, roles: t.roles, cree_le: t.cree_le },
        donnees: { factures: await compte("select count(*)::int as n from documents_vente where tiers_id = $1"), inscriptions: await compte("select count(*)::int as n from inscriptions where tiers_id = $1"), tickets: await compte("select count(*)::int as n from tickets where tiers_id = $1"), echanges: await compte("select count(*)::int as n from activites where tiers_id = $1") },
      };
    }),
  );
  /** Efface l'identité sur la fiche. Les factures émises gardent le nom imprimé, pour la conservation légale. */
  app.post<{ Params: { id: string }; Body: { motif: string } }>("/tiers/:id/anonymisation", {
    schema: { params: paramId, body: { type: "object", required: ["motif"], properties: { motif: { type: "string", minLength: 5, maxLength: 500 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "utilisateurs.gerer");
      const t = await exigerTiersVisible(ctx, req.params.id, "utilisateurs.gerer");
      if (t.anonymise_le) throw new ErreurApi(409, "deja_anonymise");
      await ctx.client.query("update tiers set nom = 'Personne anonymisée', email = null, telephone = null, archive = true, anonymise_le = now() where id = $1", [t.id]);
      await ctx.client.query("update activites set contenu = 'Contenu effacé' where tiers_id = $1", [t.id]);
      await ctx.client.query("select journal_evenement('rgpd.anonymisation', $1)", [JSON.stringify({ tiers: t.id, motif: req.body.motif })]);
      return { anonymise: true };
    }),
  );
}
