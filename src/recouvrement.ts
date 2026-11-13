import type { FastifyInstance } from "fastify";
import { publierEvenement, type Client } from "./base.js";
import { exigerSeparation } from "./permissions.js";
import { situationScolarite } from "./scolarite.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";
import { exigerTiersVisible } from "./tiers.js";

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const motif = { type: "string", minLength: 5, maxLength: 500 } as const;
const montant = { type: "integer", minimum: 1, maximum: 1_000_000_000_000 } as const;
const JOUR = "(now() at time zone 'Africa/Douala')::date";
export const RESTE_FACTURE = `d.total_ttc
  - (select coalesce(sum(r.montant), 0) from reglements r where r.facture_id = d.id and r.annule_le is null)
  - (select coalesce(sum(a.total_ttc), 0) from documents_vente a where a.origine_id = d.id and a.type = 'avoir' and a.statut = 'emis')`;
export const SANS_PERTE = "not exists (select 1 from creances_douteuses x where x.facture_id = d.id and x.statut = 'perte')";

export type Niveau = "avant" | "rappel" | "mise_en_demeure";
type Modele = { decalage: number; fr: string; en: string };
export const MODELES: Record<Niveau, Modele> = {
  avant: { decalage: -3, fr: "Bonjour {client}, votre échéance {reference} de {reste} arrive le {echeance}. Merci de prévoir le règlement.", en: "Hello {client}, your payment {reference} of {reste} is due on {echeance}. Please arrange payment." },
  rappel: { decalage: 7, fr: "Bonjour {client}, sauf erreur de notre part, {reste} restent dus pour {reference}, échu le {echeance}. Merci de régulariser ou de nous contacter.", en: "Hello {client}, unless we are mistaken, {reste} remains due for {reference}, which fell due on {echeance}. Please settle or contact us." },
  mise_en_demeure: { decalage: 30, fr: "{client}, malgré nos rappels, {reste} restent impayés pour {reference}, échu le {echeance}. Nous vous demandons de régler cette somme sous 8 jours.", en: "{client}, despite our reminders, {reste} remains unpaid for {reference}, due on {echeance}. We ask you to pay this amount within 8 days." },
};
const ORDRE: Niveau[] = ["avant", "rappel", "mise_en_demeure"];

export function rendreModele(texte: string, v: Record<string, string>): string {
  return texte.replace(/\{(client|reference|reste|echeance)\}/g, (_, k: string) => v[k] ?? "");
}
/** Le niveau le plus avancé atteint ; les niveaux dépassés ne s'envoient plus après coup. */
export function niveauAtteint(retard: number, m: Record<Niveau, Modele>): Niveau | null {
  let n: Niveau | null = null;
  for (const x of ORDRE) if (retard >= m[x].decalage) n = x;
  return n;
}
/** Les paiements reçus depuis le plan couvrent les échéances dans l'ordre. */
export function etatPlan(echeances: { jour: string; montant: number }[], paye: number, jour: string) {
  const total = echeances.reduce((s, e) => s + e.montant, 0);
  const du = echeances.filter((e) => e.jour <= jour).reduce((s, e) => s + e.montant, 0);
  return { total, du, paye, retard: Math.max(du - paye, 0), statut: paye >= total ? "solde" : du > paye ? "en_retard" : "a_jour" };
}
const fcfaTexte = (n: number) => `${n.toLocaleString("fr-FR").replace(/\s/g, " ")} FCFA`;

export interface Du { source_type: "facture" | "echeance" | "scolarite"; source_id: string; tiers_id: string; client: string; telephone: string | null; email: string | null; langue: string; reference: string; programme: string | null; echeance: string; reste: number; retard: number; plan_a_jour?: boolean }

async function paiementsPlan(c: Client, plan: { facture_id: string; cree_le: Date }) {
  const { rows: [r] } = await c.query("select coalesce(sum(montant), 0)::int8 as s from reglements where facture_id = $1 and annule_le is null and encaisse_le >= $2", [plan.facture_id, plan.cree_le]);
  // Un avoir émis après le plan réduit aussi ce qui reste dû.
  const { rows: [a] } = await c.query("select coalesce(sum(total_ttc), 0)::int8 as s from documents_vente where origine_id = $1 and type = 'avoir' and statut = 'emis' and emis_le >= $2", [plan.facture_id, plan.cree_le]);
  return Number(r.s) + Number(a.s);
}

/** Tout ce qui reste dû dans une branche : factures et tranches de formation, sans double compte. */
export async function dus(c: Client, brancheId: string): Promise<Du[]> {
  const { rows: [{ jour }] } = await c.query(`select ${JOUR}::text as jour`);
  const { rows: fact } = await c.query(
    `select d.id, d.numero, d.tiers_id, t.nom, t.telephone, t.email, t.langue, coalesce(d.date_echeance, d.date_document)::text as echeance, (${RESTE_FACTURE})::int8 as reste
     from documents_vente d join tiers t on t.id = d.tiers_id where d.type = 'facture' and d.statut = 'emis' and entite_branche(d.entite_id) = $1 and ${SANS_PERTE}`, [brancheId],
  );
  const { rows: plans } = await c.query("select p.* from plans_paiement p join documents_vente d on d.id = p.facture_id where p.actif and entite_branche(d.entite_id) = $1", [brancheId]);
  const res: Du[] = [];
  const ecart = (e: string) => Math.round((Date.parse(jour) - Date.parse(e)) / 86400000);
  for (const f of fact) {
    if (Number(f.reste) <= 0) continue;
    const p = plans.find((x) => x.facture_id === f.id);
    const aJour = p ? etatPlan(p.echeances, await paiementsPlan(c, p), jour).statut !== "en_retard" : false;
    res.push({ source_type: "facture", source_id: f.id, tiers_id: f.tiers_id, client: f.nom, telephone: f.telephone, email: f.email, langue: f.langue, reference: f.numero, programme: null, echeance: f.echeance, reste: Number(f.reste), retard: ecart(f.echeance), plan_a_jour: aJour });
  }
  const { rows: tr } = await c.query(
    `select e.id, e.inscription_id, e.libelle, e.montant::int8 as montant, e.date_echeance::text as echeance, i.tiers_id, t.nom, t.telephone, t.email, t.langue, p.nom as programme, s.code,
       (select coalesce(sum(x.montant), 0) from paiements x where x.inscription_id = i.id and x.annule_le is null)::int8 as paye
     from echeances e join inscriptions i on i.id = e.inscription_id join sessions_formation s on s.id = i.session_id join programmes p on p.id = s.programme_id join tiers t on t.id = i.tiers_id
     where i.statut = 'active' and entite_branche(s.entite_id) = $1 order by e.inscription_id, e.ordre`, [brancheId],
  );
  const cumul = new Map<string, number>();
  for (const e of tr) {
    const avant = cumul.get(e.inscription_id) ?? 0;
    cumul.set(e.inscription_id, avant + Number(e.montant));
    const reste = Math.min(Number(e.montant), avant + Number(e.montant) - Number(e.paye));
    if (reste <= 0) continue;
    res.push({ source_type: "echeance", source_id: e.id, tiers_id: e.tiers_id, client: e.nom, telephone: e.telephone, email: e.email, langue: e.langue, reference: `${e.libelle} (${e.code})`, programme: e.programme, echeance: e.echeance, reste, retard: ecart(e.echeance) });
  }
  // Scolarité d'IP2EL : une ligne par inscription, à la date de la plus ancienne tranche non couverte.
  const { rows: ins } = await c.query(
    `select i.id, i.tiers_id, i.matricule, i.annee, t.nom, t.telephone, t.email, t.langue, f.nom as filiere, f.id as filiere_id,
       (select coalesce(sum(b.montant), 0) from bourses_univ b where b.inscription_id = i.id)::int8 as bourses,
       (select coalesce(sum(p.montant), 0) from paiements_univ p where p.inscription_id = i.id and p.annule_le is null)::int8 as paye
     from inscriptions_univ i join filieres f on f.id = i.filiere_id join tiers t on t.id = i.tiers_id where entite_branche(f.entite_id) = $1`, [brancheId],
  );
  for (const i of ins) {
    const { rows: frais } = await c.query("select montant::int8, echeance::text from frais_filiere where filiere_id = $1 and annee = $2 order by echeance", [i.filiere_id, i.annee]);
    const fr = frais.map((f) => ({ montant: Number(f.montant), echeance: f.echeance as string }));
    const s = situationScolarite(fr, Number(i.bourses), Number(i.paye), jour);
    if (s.reste <= 0) continue;
    // Comme dans la situation : la bourse couvre d'abord les dernières tranches, les paiements les premières.
    let resteBourse = Number(i.bourses);
    const nets = fr.map((f) => f.montant);
    for (let k = nets.length - 1; k >= 0 && resteBourse > 0; k--) { const x = Math.min(nets[k]!, resteBourse); nets[k]! -= x; resteBourse -= x; }
    let cumul = 0;
    const premier = fr.find((_f, k) => { cumul += nets[k]!; return cumul > Number(i.paye); }) ?? fr[fr.length - 1]!;
    res.push({ source_type: "scolarite", source_id: i.id, tiers_id: i.tiers_id, client: i.nom, telephone: i.telephone, email: i.email, langue: i.langue, reference: `Scolarité ${i.matricule} ${i.annee}`, programme: i.filiere, echeance: premier.echeance, reste: s.reste, retard: ecart(premier.echeance) });
  }
  return res;
}

export async function parametresRecouvrement(c: Client, brancheId: string) {
  const { rows: [p] } = await c.query("select * from parametres_recouvrement where branche_id = $1", [brancheId]);
  const modeles = { ...MODELES } as Record<Niveau, Modele>;
  for (const n of ORDRE) modeles[n] = { ...MODELES[n], ...(p?.modeles?.[n] ?? {}) };
  return { seuil_blocage: p?.seuil_blocage ?? 60, seuil_douteuse: p?.seuil_douteuse ?? 90, modeles };
}

export async function aRelancer(c: Client, brancheId: string) {
  const p = await parametresRecouvrement(c, brancheId);
  const liste = await dus(c, brancheId);
  const { rows: faites } = await c.query("select source_id, niveau, cree_le from relances where branche_id = $1 order by cree_le", [brancheId]);
  const res = [];
  for (const d of liste) {
    if (d.plan_a_jour) continue;
    const niveau = niveauAtteint(d.retard, p.modeles);
    if (!niveau || faites.some((f) => f.source_id === d.source_id && f.niveau === niveau)) continue;
    const m = p.modeles[niveau];
    const texte = rendreModele(d.langue === "en" ? m.en : m.fr, { client: d.client, reference: d.reference, reste: fcfaTexte(d.reste), echeance: d.echeance.split("-").reverse().join("/") });
    res.push({ ...d, niveau, texte });
  }
  return res.sort((a, b) => b.retard - a.retard);
}

export function enregistrerRecouvrement(app: FastifyInstance, outils: Outils): void {
  const { protege, exigerSurEntite } = outils;
  type Q = { Querystring: { brancheId: string } };
  const qBranche = { querystring: { type: "object", required: ["brancheId"], properties: { brancheId: uuid } } } as const;

  app.get<Q>("/recouvrement/tableau", { schema: qBranche }, async (req) =>
    protege(req, async (ctx) => {
      const id = req.query.brancheId;
      await exigerSurEntite(ctx, "facturation.voir", id);
      const p = await parametresRecouvrement(ctx.client, id);
      const liste = await dus(ctx.client, id);
      const clients = new Map<string, any>();
      const programmes = new Map<string, number>();
      for (const d of liste) {
        const x = clients.get(d.tiers_id) ?? { tiers_id: d.tiers_id, client: d.client, telephone: d.telephone, non_echu: 0, j30: 0, j60: 0, j90: 0, plus: 0, total: 0, retard_max: 0 };
        x[d.retard <= 0 ? "non_echu" : d.retard <= 30 ? "j30" : d.retard <= 60 ? "j60" : d.retard <= 90 ? "j90" : "plus"] += d.reste;
        x.total += d.reste;
        x.retard_max = Math.max(x.retard_max, d.retard);
        clients.set(d.tiers_id, x);
        if (d.programme) programmes.set(d.programme, (programmes.get(d.programme) ?? 0) + d.reste);
      }
      const { rows: blocages } = await ctx.client.query("select b.id, b.tiers_id, b.portee, b.motif, t.nom from blocages_tiers b join tiers t on t.id = b.tiers_id where b.leve_le is null and t.branche_id = $1 order by b.cree_le desc", [id]);
      const { rows: douteuses } = await ctx.client.query("select c.*, d.numero, t.nom from creances_douteuses c join documents_vente d on d.id = c.facture_id join tiers t on t.id = c.tiers_id where c.branche_id = $1 order by c.jour_provision desc limit 200", [id]);
      const lignes = [...clients.values()].sort((a, b) => b.total - a.total).map((x) => ({
        ...x, proposer_blocage: x.retard_max >= p.seuil_blocage && !blocages.some((b) => b.tiers_id === x.tiers_id),
      }));
      return {
        lignes, total: lignes.reduce((s, x) => s + x.total, 0), programmes: [...programmes].map(([nom, reste]) => ({ nom, reste })), blocages, douteuses,
        factures: liste.filter((d) => d.source_type === "facture").map((d) => ({ id: d.source_id, reference: d.reference, client: d.client, reste: d.reste, retard: d.retard, a_declasser: d.retard >= p.seuil_douteuse && !douteuses.some((x) => x.facture_id === d.source_id) })),
      };
    }),
  );

  app.get<Q>("/recouvrement/parametres", { schema: qBranche }, async (req) =>
    protege(req, async (ctx) => { await exigerSurEntite(ctx, "facturation.voir", req.query.brancheId); return parametresRecouvrement(ctx.client, req.query.brancheId); }),
  );
  const modele = { type: "object", required: ["decalage", "fr", "en"], additionalProperties: false, properties: { decalage: { type: "integer", minimum: -60, maximum: 365 }, fr: { type: "string", minLength: 10, maxLength: 1000 }, en: { type: "string", minLength: 10, maxLength: 1000 } } } as const;
  app.put<{ Body: { brancheId: string; seuilBlocage: number; seuilDouteuse: number; modeles: Record<Niveau, Modele> } }>("/recouvrement/parametres", {
    schema: { body: { type: "object", required: ["brancheId", "seuilBlocage", "seuilDouteuse", "modeles"], properties: { brancheId: uuid, seuilBlocage: { type: "integer", minimum: 1, maximum: 3650 }, seuilDouteuse: { type: "integer", minimum: 1, maximum: 3650 }, modeles: { type: "object", required: ORDRE, additionalProperties: false, properties: { avant: modele, rappel: modele, mise_en_demeure: modele } } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "facturation.administrer", b.brancheId);
      if (!(b.modeles.avant.decalage < b.modeles.rappel.decalage && b.modeles.rappel.decalage < b.modeles.mise_en_demeure.decalage)) throw new ErreurApi(400, "ordre_relances_invalide");
      await ctx.client.query(
        `insert into parametres_recouvrement (organisation_id, branche_id, seuil_blocage, seuil_douteuse, modeles) values ($1, $2, $3, $4, $5)
         on conflict (organisation_id, branche_id) do update set seuil_blocage = excluded.seuil_blocage, seuil_douteuse = excluded.seuil_douteuse, modeles = excluded.modeles`,
        [ctx.organisationId, b.brancheId, b.seuilBlocage, b.seuilDouteuse, JSON.stringify(b.modeles)],
      );
      return { enregistre: true };
    }),
  );

  // Relances : préparées ici, envoyées par la personne tant qu'aucun opérateur n'est raccordé.
  app.get<Q>("/recouvrement/relances", { schema: qBranche }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "facturation.voir", req.query.brancheId);
      const a = await aRelancer(ctx.client, req.query.brancheId);
      const { rows: historique } = await ctx.client.query("select r.niveau, r.canal, r.reste, r.cree_le, t.nom, u.nom as auteur from relances r join tiers t on t.id = r.tiers_id join utilisateurs u on u.id = r.auteur_id where r.branche_id = $1 order by r.cree_le desc limit 100", [req.query.brancheId]);
      return { a_relancer: a, historique };
    }),
  );
  app.post<{ Body: { brancheId: string; sourceType: string; sourceId: string; canal: string } }>("/recouvrement/relances", {
    schema: { body: { type: "object", required: ["brancheId", "sourceType", "sourceId", "canal"], properties: { brancheId: uuid, sourceType: { type: "string", enum: ["facture", "echeance", "scolarite"] }, sourceId: uuid, canal: { type: "string", enum: ["whatsapp", "sms", "email", "appel", "courrier"] } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "facturation.gerer", b.brancheId);
      const x = (await aRelancer(ctx.client, b.brancheId)).find((d) => d.source_type === b.sourceType && d.source_id === b.sourceId);
      if (!x) throw new ErreurApi(409, "relance_non_due");
      await ctx.client.query(
        "insert into relances (organisation_id, branche_id, source_type, source_id, tiers_id, niveau, canal, texte, reste, auteur_id) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        [ctx.organisationId, b.brancheId, b.sourceType, b.sourceId, x.tiers_id, x.niveau, b.canal, x.texte, x.reste, ctx.utilisateurId],
      );
      await publierEvenement(ctx.client, "relance.envoyee", { source: b.sourceId, niveau: x.niveau, canal: b.canal });
      return { niveau: x.niveau };
    });
    return reponse.status(201).send(r);
  });

  // Plans de paiement négociés
  const facture = async (ctx: Contexte, id: string, permission: "facturation.voir" | "facturation.gerer" | "facturation.administrer" | "compta.valider") => {
    const { rows: [f] } = await ctx.client.query(
      `select d.id, d.numero, d.tiers_id, d.entite_id, entite_branche(d.entite_id) as branche_id, d.type, d.statut, (${RESTE_FACTURE})::int8 as reste from documents_vente d where d.id = $1 for update of d`, [id],
    );
    if (!f) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, permission, f.entite_id);
    if (f.type !== "facture" || f.statut !== "emis") throw new ErreurApi(409, "facture_non_emise");
    return { ...f, reste: Number(f.reste) };
  };
  app.post<{ Body: { factureId: string; motif: string; echeances: { jour: string; montant: number }[] } }>("/recouvrement/plans", {
    schema: { body: { type: "object", required: ["factureId", "motif", "echeances"], properties: { factureId: uuid, motif, echeances: { type: "array", minItems: 1, maxItems: 60, items: { type: "object", required: ["jour", "montant"], additionalProperties: false, properties: { jour: date, montant } } } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      const f = await facture(ctx, b.factureId, "facturation.administrer");
      const total = b.echeances.reduce((s, e) => s + e.montant, 0);
      if (total !== f.reste) throw new ErreurApi(409, "plan_different_du_reste", { reste: f.reste, total });
      const tri = [...b.echeances].sort((x, y) => x.jour.localeCompare(y.jour));
      const { rows: [p] } = await ctx.client.query(
        "insert into plans_paiement (organisation_id, facture_id, motif, echeances, auteur_id) values ($1, $2, $3, $4, $5) on conflict do nothing returning id",
        [ctx.organisationId, b.factureId, b.motif, JSON.stringify(tri), ctx.utilisateurId],
      );
      if (!p) throw new ErreurApi(409, "plan_deja_actif");
      return p;
    });
    return reponse.status(201).send(r);
  });
  app.get<Q>("/recouvrement/plans", { schema: qBranche }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "facturation.voir", req.query.brancheId);
      const { rows: [{ jour }] } = await ctx.client.query(`select ${JOUR}::text as jour`);
      const { rows } = await ctx.client.query(
        "select p.*, d.numero, t.nom as client from plans_paiement p join documents_vente d on d.id = p.facture_id join tiers t on t.id = d.tiers_id where entite_branche(d.entite_id) = $1 and p.actif order by p.cree_le desc limit 200", [req.query.brancheId],
      );
      const res = [];
      for (const p of rows) res.push({ id: p.id, numero: p.numero, client: p.client, motif: p.motif, echeances: p.echeances, ...etatPlan(p.echeances, await paiementsPlan(ctx.client, p), jour) });
      return res;
    }),
  );
  app.post<{ Params: { id: string } }>("/recouvrement/plans/:id/arret", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [p] } = await ctx.client.query("select facture_id from plans_paiement where id = $1 and actif", [req.params.id]);
      if (!p) throw new ErreurApi(404, "introuvable");
      await facture(ctx, p.facture_id, "facturation.administrer");
      await ctx.client.query("update plans_paiement set actif = false, arrete_le = now() where id = $1", [req.params.id]);
      return { actif: false };
    }),
  );

  // Blocages : décidés par une personne, avec un motif, et toujours levables.
  app.post<{ Body: { tiersId: string; portee: string; motif: string } }>("/recouvrement/blocages", {
    schema: { body: { type: "object", required: ["tiersId", "portee", "motif"], properties: { tiersId: uuid, portee: { type: "string", enum: ["livraison", "cours", "certificat"] }, motif } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const t = await exigerTiersVisible(ctx, req.body.tiersId, "facturation.administrer");
      if (!t.branche_id) throw new ErreurApi(409, "tiers_sans_branche");
      await exigerSurEntite(ctx, "facturation.administrer", t.branche_id);
      const { rows: [b] } = await ctx.client.query(
        "insert into blocages_tiers (organisation_id, tiers_id, portee, motif, auteur_id) values ($1, $2, $3, $4, $5) on conflict do nothing returning id",
        [ctx.organisationId, t.id, req.body.portee, req.body.motif, ctx.utilisateurId],
      );
      if (!b) throw new ErreurApi(409, "deja_bloque");
      return b;
    });
    return reponse.status(201).send(r);
  });
  app.post<{ Params: { id: string } }>("/recouvrement/blocages/:id/levee", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [b] } = await ctx.client.query("select b.id, t.branche_id from blocages_tiers b join tiers t on t.id = b.tiers_id where b.id = $1 and b.leve_le is null", [req.params.id]);
      if (!b) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "facturation.administrer", b.branche_id);
      await ctx.client.query("update blocages_tiers set leve_par = $2, leve_le = now() where id = $1", [b.id, ctx.utilisateurId]);
      return { leve: true };
    }),
  );

  // Créances douteuses et pertes : les écritures partent en brouillon vers le comptable.
  app.post<{ Params: { id: string }; Body: { provision: number; motif: string } }>("/recouvrement/factures/:id/douteuse", {
    schema: { params: paramId, body: { type: "object", required: ["provision", "motif"], properties: { provision: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 }, motif } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const f = await facture(ctx, req.params.id, "facturation.administrer");
      if (req.body.provision > f.reste) throw new ErreurApi(409, "provision_superieure_au_reste", { reste: f.reste });
      const { rows: [c] } = await ctx.client.query(
        `insert into creances_douteuses (organisation_id, facture_id, branche_id, tiers_id, provision, motif, jour_provision, cree_par) values ($1, $2, $3, $4, $5, $6, ${JOUR}, $7) on conflict do nothing returning id`,
        [ctx.organisationId, f.id, f.branche_id, f.tiers_id, req.body.provision, req.body.motif, ctx.utilisateurId],
      );
      if (!c) throw new ErreurApi(409, "deja_declassee");
      return c;
    });
    return reponse.status(201).send(r);
  });
  app.post<{ Params: { id: string }; Body: { motif: string } }>("/recouvrement/factures/:id/perte", {
    schema: { params: paramId, body: { type: "object", required: ["motif"], properties: { motif } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const f = await facture(ctx, req.params.id, "facturation.administrer");
      const { rowCount } = await ctx.client.query("update creances_douteuses set statut = 'perte_demandee', motif_perte = $2, demande_par = $3 where facture_id = $1 and statut = 'douteuse'", [f.id, req.body.motif, ctx.utilisateurId]);
      if (!rowCount) throw new ErreurApi(409, "creance_non_douteuse");
      return { statut: "perte_demandee" };
    }),
  );
  app.post<{ Params: { id: string } }>("/recouvrement/factures/:id/perte/validation", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const f = await facture(ctx, req.params.id, "compta.valider");
      const { rows: [c] } = await ctx.client.query("select demande_par from creances_douteuses where facture_id = $1 and statut = 'perte_demandee' for update", [f.id]);
      if (!c) throw new ErreurApi(409, "perte_non_demandee");
      await exigerSeparation(ctx, "pertes", c.demande_par);
      if (f.reste <= 0) throw new ErreurApi(409, "rien_a_passer_en_perte");
      await ctx.client.query(`update creances_douteuses set statut = 'perte', montant_perte = $2, valide_par = $3, jour_perte = ${JOUR} where facture_id = $1`, [f.id, f.reste, ctx.utilisateurId]);
      await publierEvenement(ctx.client, "creance.perte", { facture: f.id, montant: f.reste });
      return { statut: "perte", montant: f.reste };
    }),
  );
}
