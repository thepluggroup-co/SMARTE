import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { dansOrganisation, reactionsEvenements, type Client } from "./base.js";
import { heureDouala } from "./performance.js";
import { aPermissionSurEntite } from "./permissions.js";
import { normaliserTelephone } from "./securite.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";

/**
 * Messages automatiques aux clients de GLOMARI (lot 4, partie A) : suivi des colis, étapes des précommandes, demandes d'avis.
 * Les messages naissent des événements publiés, dans la transaction métier, et partent chaque minute par un prestataire
 * interchangeable, hors transaction, entre 7 h et 21 h. Le texte se prépare à l'envoi et n'est jamais enregistré :
 * le journal ne garde ni le numéro complet ni le code de livraison.
 */

declare module "fastify" { interface FastifyInstance { pousserMessages: (maintenant?: Date, organisationId?: string) => Promise<number> } }

export const TYPES_MESSAGES = {
  colis_cree: { libelle: "Colis créé : lien de suivi", actif: true },
  colis_en_livraison: { libelle: "Colis en livraison : code", actif: true },
  colis_pret_retrait: { libelle: "Colis prêt à retirer : code", actif: true },
  colis_livre: { libelle: "Colis livré", actif: true },
  acompte_confirme: { libelle: "Précommande : acompte confirmé", actif: true },
  etape_arrivage: { libelle: "Précommande : étape d'arrivage", actif: true },
  solde_a_payer: { libelle: "Précommande : solde à payer", actif: true },
  rappel_solde: { libelle: "Précommande : rappel du solde", actif: true },
  acompte_a_rembourser: { libelle: "Précommande : acompte à rembourser", actif: true },
  acompte_conserve: { libelle: "Précommande : acompte conservé", actif: true },
  avis_livraison: { libelle: "Demande d'avis après livraison", actif: true },
  avis_magasin: { libelle: "Demande d'avis après achat en magasin", actif: false },
} as const;
export type TypeMessage = keyof typeof TYPES_MESSAGES;
export type Canal = "sms" | "whatsapp";

export const HEURE_DEBUT_ENVOI = 7;
export const HEURE_FIN_ENVOI = 21;
export const TENTATIVES_MAX = 3;
export const DELAI_ESSAI_MINUTES = 20;
export const DELAI_AVIS_JOURS = 14;
const LOT = 100;

const ETAPES_ARRIVAGE: Record<string, string> = {
  commandee: "commandée au fabricant", achetee: "achetée", en_production: "en production", expediee: "expédiée", en_transit: "en transport",
  arrivee_port: "arrivée au port", dedouanee: "dédouanée", enlevee: "enlevée au port", livree: "livrée à notre dépôt", en_stock: "en stock",
};

// ---------- Prestataire ----------

export interface MessageAEnvoyer { canal: Canal; telephone: string; texte: string; reference: string }
export interface PrestataireMessages { nom: string; envoyer(m: MessageAEnvoyer): Promise<{ ok: boolean; reference?: string }> }

/** Essai privé et tests seulement : rien ne part ; les messages restent en mémoire, et une panne se simule. */
export function prestataireMessagesFactice(): PrestataireMessages & { envoyes: (MessageAEnvoyer & { le: Date })[]; enPanne: boolean } {
  const p = {
    nom: "factice", envoyes: [] as (MessageAEnvoyer & { le: Date })[], enPanne: false,
    async envoyer(m: MessageAEnvoyer) {
      if (p.enPanne) return { ok: false };
      p.envoyes.push({ ...m, le: new Date() });
      if (p.envoyes.length > 1000) p.envoyes.shift();
      return { ok: true, reference: `factice-${m.reference}` };
    },
  };
  return p;
}

// ---------- Numéros ----------

/** SMS et WhatsApp ne vont qu'aux mobiles camerounais (237 6XX XX XX XX). */
export function mobileCamerounais(tel: string | null | undefined): string | null {
  if (!tel?.trim()) return null;
  const n = normaliserTelephone(tel);
  return /^2376[0-9]{8}$/.test(n) ? n : null;
}
export const masquerNumero = (tel: string) => `*******${tel.slice(-2)}`;

// ---------- Réglages et mise en file ----------

/** La branche de l'entité, si elle gère du stock (GLOMARI) ; jamais GTA. */
export async function brancheCommerce(c: Client, entiteId: string): Promise<string | null> {
  const { rows: [b] } = await c.query(
    `select entite_branche($1) as id where exists (select 1 from modules_entite m where m.entite_id = entite_branche($1) and m.module = 'achats_stocks' and m.actif)`,
    [entiteId],
  );
  return b?.id ?? null;
}

export async function reglageEffectif(c: Client, brancheId: string, type: TypeMessage): Promise<{ actif: boolean; canal: Canal }> {
  const { rows: [r] } = await c.query("select actif, canal from reglages_messages where branche_id = $1 and type = $2", [brancheId, type]);
  return r ? { actif: r.actif, canal: r.canal } : { actif: TYPES_MESSAGES[type].actif, canal: "sms" };
}

interface NouveauMessage { type: TypeMessage; cle: string; objetType: "colis" | "inscription" | "vente_comptoir"; objetId: string; entiteId: string; duLe?: Date | string }

/** Un message par clé : un événement répété ou une étape enregistrée deux fois ne crée rien de plus. Un type coupé ne crée rien. */
export async function mettreEnFile(c: Client, m: NouveauMessage): Promise<void> {
  const branche = await brancheCommerce(c, m.entiteId);
  if (!branche || !(await reglageEffectif(c, branche, m.type)).actif) return;
  await c.query(
    `insert into envois_messages (organisation_id, branche_id, type, cle, objet_type, objet_id, du_le)
     values (org_courante(), $1, $2, $3, $4, $5, coalesce($6::timestamptz, now())) on conflict (organisation_id, cle) do nothing`,
    [branche, m.type, m.cle, m.objetType, m.objetId, m.duLe ?? null],
  );
}

/** Le client d'un colis : celui de la commande en ligne qui le porte, sinon celui de sa facture. */
async function clientDuColis(c: Client, colisId: string): Promise<string | null> {
  const { rows: [r] } = await c.query(
    `select coalesce((select w.tiers_id from commandes_web w where w.colis_id = k.id limit 1),
       (select d.tiers_id from documents_vente d where d.id = k.document_id and d.type = 'facture')) as tiers_id
     from colis k where k.id = $1`,
    [colisId],
  );
  return r?.tiers_id ?? null;
}

const quatorzeJoursApres = (col: string) => `${col} + make_interval(days => ${DELAI_AVIS_JOURS})`;

async function reagir(c: Client, type: string, charge: Record<string, unknown>): Promise<void> {
  const id = typeof charge.id === "string" ? charge.id : null;
  const inscription = typeof charge.inscription === "string" ? charge.inscription : null;
  if (type === "colis.cree" || type === "colis.etape" || type === "colis.livre") {
    if (!id) return;
    const { rows: [k] } = await c.query(
      `select k.id, k.entite_id, ${quatorzeJoursApres("coalesce(k.livre_le, now())")} as avis_le,
         (select w.mode_livraison from commandes_web w where w.colis_id = k.id limit 1) as mode
       from colis k where k.id = $1`,
      [id],
    );
    if (!k) return;
    const colis = (t: TypeMessage, duLe?: Date) => mettreEnFile(c, { type: t, cle: `${t}:${k.id}`, objetType: "colis", objetId: k.id, entiteId: k.entite_id, duLe });
    if (type === "colis.cree") await colis("colis_cree");
    else if (type === "colis.etape" && charge.statut === "en_livraison") await colis("colis_en_livraison");
    // « Arrivé » sert aussi au dépôt d'une autre ville avant une livraison à domicile : seul un retrait est « prêt à retirer ».
    else if (type === "colis.etape" && charge.statut === "arrive" && ["agence_voyage", "point_relais"].includes(k.mode)) await colis("colis_pret_retrait");
    else if (type === "colis.livre") {
      await colis("colis_livre");
      if (await clientDuColis(c, k.id)) await colis("avis_livraison", k.avis_le);
    }
    return;
  }
  if (type === "precommande.arrivage_etape") {
    if (typeof charge.campagne !== "string" || typeof charge.etape !== "string") return;
    const { rows } = await c.query(
      "select i.id, k.entite_id from inscriptions_precommande i join campagnes_arrivage k on k.id = i.campagne_id where k.id = $1 and i.statut = 'validee'",
      [charge.campagne],
    );
    for (const i of rows) {
      await mettreEnFile(c, { type: "etape_arrivage", cle: `etape_arrivage:${i.id}:${charge.etape}`, objetType: "inscription", objetId: i.id, entiteId: i.entite_id });
    }
    return;
  }
  const parInscription: Record<string, TypeMessage> = {
    "precommande.inscription_validee": "acompte_confirme", "precommande.arrivage_recu": "solde_a_payer",
    "precommande.a_rembourser": "acompte_a_rembourser", "precommande.acompte_conserve": "acompte_conserve",
  };
  if (parInscription[type] && inscription) {
    const { rows: [i] } = await c.query(
      `select i.id, k.entite_id, i.solde_avant - interval '2 days' as rappel_le, i.solde_avant - interval '2 days' > now() as rappel_a_venir
       from inscriptions_precommande i join campagnes_arrivage k on k.id = i.campagne_id where i.id = $1`,
      [inscription],
    );
    if (!i) return;
    const t = parInscription[type]!;
    await mettreEnFile(c, { type: t, cle: `${t}:${i.id}`, objetType: "inscription", objetId: i.id, entiteId: i.entite_id });
    if (t === "solde_a_payer" && i.rappel_a_venir) {
      await mettreEnFile(c, { type: "rappel_solde", cle: `rappel_solde:${i.id}`, objetType: "inscription", objetId: i.id, entiteId: i.entite_id, duLe: i.rappel_le });
    }
    return;
  }
  if (type === "vente.comptoir" && id) {
    const { rows: [v] } = await c.query(
      `select id, entite_id, ${quatorzeJoursApres("coalesce(vendue_le, cree_le)")} as avis_le from ventes_comptoir where id = $1 and tiers_id is not null`, [id],
    );
    if (v) await mettreEnFile(c, { type: "avis_magasin", cle: `avis_magasin:${v.id}`, objetType: "vente_comptoir", objetId: v.id, entiteId: v.entite_id, duLe: v.avis_le });
  }
}
reactionsEvenements.push(reagir);

// ---------- Textes ----------

type Preparation = { telephone: string | null; texte: string } | { abandon: "sans_objet" | "ne_pas_contacter" };
interface Ligne { id: string; type: TypeMessage; cle: string; objet_type: string; objet_id: string; branche_id: string; tentatives: number }
interface Cadre { urlPublique: string; organisationId: string; marque: string }

const montantFr = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const jourFr = (jour: string) => jour.split("-").reverse().join("/");
const jourDoualaDe = (d: Date) => jourFr(new Date(d.getTime() + 3600_000).toISOString().slice(0, 10));

async function colisDe(c: Client, id: string) {
  const { rows: [k] } = await c.query("select id, numero, telephone, code_suivi, code_confirmation, a_encaisser, statut from colis where id = $1", [id]);
  return k as Record<string, any> | undefined;
}
async function inscriptionDe(c: Client, id: string) {
  const { rows: [i] } = await c.query(
    `select i.reference, i.telephone, i.quantite, i.total_ttc, i.acompte, i.statut, i.solde_avant, k.titre, k.date_limite
     from inscriptions_precommande i join campagnes_arrivage k on k.id = i.campagne_id where i.id = $1`,
    [id],
  );
  return i as Record<string, any> | undefined;
}
/** Le client, son numéro et sa marque « ne pas contacter ». */
async function tiersDe(c: Client, id: string | null) {
  if (!id) return undefined;
  const { rows: [t] } = await c.query("select id, telephone, ne_pas_contacter from tiers where id = $1", [id]);
  return t as { id: string; telephone: string | null; ne_pas_contacter: boolean } | undefined;
}

/** Le lien d'avis à usage unique, créé une seule fois par colis ou par vente. */
async function lienAvis(c: Client, m: Ligne, x: Cadre, source: "colis" | "vente_comptoir", cible: string, tiersId: string): Promise<string> {
  await c.query(
    `insert into demandes_retour (organisation_id, entite_id, code, cible_type, cible, source_type, source_id, tiers_id)
     values (org_courante(), $1, $2, 'commande', $3, $4, $5, $6) on conflict (organisation_id, source_type, source_id, cible_type) do nothing`,
    [m.branche_id, randomBytes(16).toString("base64url"), cible, source, m.objet_id, tiersId],
  );
  const { rows: [d] } = await c.query("select code from demandes_retour where source_type = $1 and source_id = $2 and cible_type = 'commande'", [source, m.objet_id]);
  return `${x.urlPublique}/evaluer.html?c=${x.organisationId}.${d.code}`;
}

const aPayer = (k: Record<string, any>) => (Number(k.a_encaisser) > 0 ? ` Montant à payer : ${montantFr(Number(k.a_encaisser))} FCFA.` : "");

const PREPARATEURS: Record<TypeMessage, (c: Client, m: Ligne, x: Cadre) => Promise<Preparation>> = {
  colis_cree: async (c, m, x) => {
    const k = await colisDe(c, m.objet_id);
    if (!k) return { abandon: "sans_objet" };
    return { telephone: k.telephone, texte: `${x.marque} : votre colis ${k.numero} est en préparation. Suivez-le ici : ${x.urlPublique}/suivi.html?c=${x.organisationId}.${k.code_suivi}` };
  },
  colis_en_livraison: async (c, m, x) => {
    const k = await colisDe(c, m.objet_id);
    if (!k) return { abandon: "sans_objet" };
    // Un retrait en point relais passe aussi par « en livraison » : le code est déjà chez le client.
    const { rows: [deja] } = await c.query("select 1 from envois_messages where type = 'colis_pret_retrait' and objet_id = $1 and statut = 'envoye' limit 1", [k.id]);
    if (deja) return { abandon: "sans_objet" };
    return { telephone: k.telephone, texte: `${x.marque} : votre colis ${k.numero} est en route. Code à donner au livreur : ${k.code_confirmation}.${aPayer(k)}` };
  },
  colis_pret_retrait: async (c, m, x) => {
    const k = await colisDe(c, m.objet_id);
    if (!k) return { abandon: "sans_objet" };
    return { telephone: k.telephone, texte: `${x.marque} : votre colis ${k.numero} est arrivé et prêt à retirer. Code à donner au retrait : ${k.code_confirmation}.${aPayer(k)}` };
  },
  colis_livre: async (c, m, x) => {
    const k = await colisDe(c, m.objet_id);
    if (!k) return { abandon: "sans_objet" };
    return { telephone: k.telephone, texte: `${x.marque} : votre colis ${k.numero} a été livré. Merci de votre confiance.` };
  },
  acompte_confirme: async (c, m, x) => {
    const i = await inscriptionDe(c, m.objet_id);
    if (!i || !["validee", "servie", "soldee"].includes(i.statut)) return { abandon: "sans_objet" };
    return { telephone: i.telephone, texte: `${x.marque} : acompte reçu pour votre précommande ${i.reference} (${i.quantite} × ${i.titre}). Date limite de la campagne : ${jourFr(i.date_limite)}.` };
  },
  etape_arrivage: async (c, m, x) => {
    const i = await inscriptionDe(c, m.objet_id);
    if (!i || i.statut !== "validee") return { abandon: "sans_objet" };
    const etape = m.cle.split(":")[2] ?? "";
    return { telephone: i.telephone, texte: `${x.marque} : votre précommande ${i.reference} (${i.titre}) avance : ${ETAPES_ARRIVAGE[etape] ?? etape}.` };
  },
  solde_a_payer: async (c, m, x) => {
    const i = await inscriptionDe(c, m.objet_id);
    if (!i || i.statut !== "servie") return { abandon: "sans_objet" };
    return {
      telephone: i.telephone,
      texte: `${x.marque} : votre ${i.titre} est arrivé. Solde à payer : ${montantFr(Number(i.total_ttc) - Number(i.acompte))} FCFA avant le ${jourDoualaDe(i.solde_avant)}, sur la Marketplace avec la référence ${i.reference}.`,
    };
  },
  rappel_solde: async (c, m, x) => {
    const i = await inscriptionDe(c, m.objet_id);
    if (!i || i.statut !== "servie") return { abandon: "sans_objet" };
    return {
      telephone: i.telephone,
      texte: `${x.marque} : rappel, le solde de votre précommande ${i.reference} (${montantFr(Number(i.total_ttc) - Number(i.acompte))} FCFA) est à payer avant le ${jourDoualaDe(i.solde_avant)}. Passé ce délai, l'acompte reste acquis selon les conditions acceptées.`,
    };
  },
  acompte_a_rembourser: async (c, m, x) => {
    const i = await inscriptionDe(c, m.objet_id);
    if (!i || !["a_rembourser", "remboursee"].includes(i.statut)) return { abandon: "sans_objet" };
    return { telephone: i.telephone, texte: `${x.marque} : votre acompte de ${montantFr(Number(i.acompte))} FCFA pour la précommande ${i.reference} va vous être remboursé.` };
  },
  acompte_conserve: async (c, m, x) => {
    const i = await inscriptionDe(c, m.objet_id);
    if (!i || i.statut !== "acompte_conserve") return { abandon: "sans_objet" };
    return {
      telephone: i.telephone,
      texte: `${x.marque} : le délai du solde de votre précommande ${i.reference} est dépassé. L'acompte de ${montantFr(Number(i.acompte))} FCFA reste acquis, selon les conditions acceptées.`,
    };
  },
  avis_livraison: async (c, m, x) => {
    const k = await colisDe(c, m.objet_id);
    const t = await tiersDe(c, k ? await clientDuColis(c, k.id) : null);
    if (!k || !t) return { abandon: "sans_objet" };
    if (t.ne_pas_contacter) return { abandon: "ne_pas_contacter" };
    const lien = await lienAvis(c, m, x, "colis", `Commande livrée ${k.numero}`, t.id);
    return { telephone: t.telephone, texte: `${x.marque} : votre avis compte. Notez les articles de votre commande ${k.numero} : ${lien}` };
  },
  avis_magasin: async (c, m, x) => {
    const { rows: [v] } = await c.query("select numero, tiers_id, annulee_le from ventes_comptoir where id = $1", [m.objet_id]);
    const t = await tiersDe(c, v?.tiers_id ?? null);
    if (!v || v.annulee_le || !t) return { abandon: "sans_objet" };
    if (t.ne_pas_contacter) return { abandon: "ne_pas_contacter" };
    const lien = await lienAvis(c, m, x, "vente_comptoir", `Achat en magasin ${v.numero}`, t.id);
    return { telephone: t.telephone, texte: `${x.marque} : merci pour votre achat. Notez les articles achetés (ticket ${v.numero}) : ${lien}` };
  },
};

// ---------- Envoi ----------

type Pret = { canal: Canal; telephone: string; texte: string } | { statut: "annule" | "sans_numero"; erreur: string };

async function preparer(c: Client, m: Ligne, urlPublique: string, organisationId: string): Promise<Pret> {
  const reglage = await reglageEffectif(c, m.branche_id, m.type);
  if (!reglage.actif) return { statut: "annule", erreur: "desactive" };
  const { rows: [b] } = await c.query("select nom from entites where id = $1", [m.branche_id]);
  const p = await PREPARATEURS[m.type](c, m, { urlPublique, organisationId, marque: b?.nom ?? "GLOMARI" });
  if ("abandon" in p) return { statut: "annule", erreur: p.abandon };
  const telephone = mobileCamerounais(p.telephone);
  if (!telephone) return { statut: "sans_numero", erreur: "sans_numero" };
  return { canal: reglage.canal, telephone, texte: p.texte };
}

/** Aucune connexion n'est retenue pendant l'appel au prestataire. Renvoie le nombre de messages envoyés. */
async function pousserOrganisation(pool: pg.Pool, organisationId: string, prestataire: PrestataireMessages, urlPublique: string, maintenant: Date): Promise<number> {
  const lot: Ligne[] = await dansOrganisation(pool, organisationId, async (c) => {
    // Un passage interrompu laisse des messages « en cours » : ils repartent, ou s'arrêtent après la dernière tentative.
    await c.query(
      `update envois_messages set statut = case when tentatives >= $2 then 'echec' else 'en_attente' end,
         erreur = case when tentatives >= $2 then 'prestataire' else erreur end
       where statut = 'en_cours' and essai_le < $1::timestamptz - interval '15 minutes'`,
      [maintenant, TENTATIVES_MAX],
    );
    return (await c.query(
      `update envois_messages set statut = 'en_cours', tentatives = tentatives + 1, essai_le = $1
       where id in (select id from envois_messages where statut = 'en_attente' and du_le <= $1 order by du_le limit $2 for update skip locked)
       returning id, type, cle, objet_type, objet_id, branche_id, tentatives`,
      [maintenant, LOT],
    )).rows;
  });
  let envoyes = 0;
  for (const m of lot) {
    const pret = await dansOrganisation(pool, organisationId, (c) => preparer(c, m, urlPublique, organisationId));
    if ("statut" in pret) {
      await dansOrganisation(pool, organisationId, (c) =>
        c.query("update envois_messages set statut = $2, erreur = $3 where id = $1", [m.id, pret.statut, pret.erreur]));
      continue;
    }
    const r = await prestataire.envoyer({ canal: pret.canal, telephone: pret.telephone, texte: pret.texte, reference: m.id }).catch(() => ({ ok: false, reference: undefined }));
    if (r.ok) envoyes += 1;
    const statut = r.ok ? "envoye" : m.tentatives >= TENTATIVES_MAX ? "echec" : "en_attente";
    await dansOrganisation(pool, organisationId, (c) => c.query(
      `update envois_messages set statut = $2, canal = $3, numero_masque = $4, envoye_le = case when $2 = 'envoye' then $5::timestamptz end,
         erreur = case when $2 = 'envoye' then null else 'prestataire' end, reference_prestataire = $6,
         du_le = case when $2 = 'en_attente' then $5::timestamptz + make_interval(mins => $7) else du_le end
       where id = $1`,
      [m.id, statut, pret.canal, masquerNumero(pret.telephone), maintenant, r.reference?.slice(0, 200) ?? null, DELAI_ESSAI_MINUTES],
    ));
  }
  return envoyes;
}

export async function pousserMessages(pool: pg.Pool, prestataire: PrestataireMessages | undefined, urlPublique: string, maintenant = new Date(), organisationId?: string): Promise<number> {
  if (!prestataire) return 0;
  const heure = heureDouala(maintenant);
  if (heure < HEURE_DEBUT_ENVOI || heure >= HEURE_FIN_ENVOI) return 0;
  const orgs = organisationId ? [organisationId] : (await pool.query("select id from registre_organisations")).rows.map((r) => r.id as string);
  let total = 0;
  for (const o of orgs) total += await pousserOrganisation(pool, o, prestataire, urlPublique, maintenant);
  return total;
}

// ---------- Routes ----------

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const TYPES = Object.keys(TYPES_MESSAGES) as TypeMessage[];
const COLIS: TypeMessage[] = ["colis_cree", "colis_en_livraison", "colis_pret_retrait", "colis_livre"];

export function enregistrerMessages(app: FastifyInstance, pool: pg.Pool, outils: Outils, urlPublique: string, prestataire?: PrestataireMessages): void {
  const { protege, exigerSurEntite } = outils;
  app.decorate("pousserMessages", (maintenant?: Date, organisationId?: string) => pousserMessages(pool, prestataire, urlPublique, maintenant, organisationId));

  /** Une branche de l'organisation, puis le droit, puis le module de stock : jamais de messages pour GTA. */
  const exigerBranche = async (ctx: Contexte, brancheId: string, permissions: ("care.voir" | "care.gerer" | "facturation.administrer")[]) => {
    const { rows: [e] } = await ctx.client.query("select 1 from entites where id = $1", [brancheId]);
    if (!e) throw new ErreurApi(404, "introuvable");
    let ok = false;
    for (const p of permissions) if (await aPermissionSurEntite(ctx.client, ctx.utilisateurId, p, brancheId)) { ok = true; break; }
    if (!ok) throw new ErreurApi(403, "permission_refusee");
    if ((await brancheCommerce(ctx.client, brancheId)) !== brancheId) throw new ErreurApi(409, "module_inactif");
  };

  app.get<{ Querystring: { brancheId: string } }>("/messages/reglages", {
    schema: { querystring: { type: "object", required: ["brancheId"], properties: { brancheId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerBranche(ctx, req.query.brancheId, ["care.voir", "facturation.administrer"]);
      const types = [];
      for (const t of TYPES) {
        const { rows: [r] } = await ctx.client.query("select actif, canal from reglages_messages where branche_id = $1 and type = $2", [req.query.brancheId, t]);
        types.push({ type: t, libelle: TYPES_MESSAGES[t].libelle, actif: r ? r.actif : TYPES_MESSAGES[t].actif, canal: r ? r.canal : "sms", defaut: !r });
      }
      return { prestataire: prestataire?.nom ?? null, heures: { debut: HEURE_DEBUT_ENVOI, fin: HEURE_FIN_ENVOI }, types };
    }),
  );

  app.put<{ Body: { brancheId: string; type: TypeMessage; actif: boolean; canal: Canal } }>("/messages/reglages", {
    schema: {
      body: {
        type: "object", additionalProperties: false, required: ["brancheId", "type", "actif", "canal"],
        properties: { brancheId: uuid, type: { type: "string", enum: TYPES }, actif: { type: "boolean" }, canal: { type: "string", enum: ["sms", "whatsapp"] } },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const b = req.body;
      await exigerBranche(ctx, b.brancheId, ["facturation.administrer"]);
      await ctx.client.query(
        `insert into reglages_messages (organisation_id, branche_id, type, actif, canal, modifie_par) values ($1, $2, $3, $4, $5, $6)
         on conflict (organisation_id, branche_id, type) do update set actif = excluded.actif, canal = excluded.canal, modifie_par = excluded.modifie_par, modifie_le = now()`,
        [ctx.organisationId, b.brancheId, b.type, b.actif, b.canal, ctx.utilisateurId],
      );
      await ctx.client.query("select journal_evenement('messages.reglage', $1)", [JSON.stringify({ branche: b.brancheId, type: b.type, actif: b.actif, canal: b.canal })]);
      return { type: b.type, actif: b.actif, canal: b.canal };
    }),
  );

  app.get<{ Querystring: { brancheId: string; statut?: string; type?: string; du?: string; au?: string } }>("/messages", {
    schema: {
      querystring: {
        type: "object", required: ["brancheId"],
        properties: {
          brancheId: uuid, statut: { type: "string", enum: ["en_attente", "en_cours", "envoye", "echec", "sans_numero", "annule"] },
          type: { type: "string", enum: TYPES }, du: date, au: date,
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const q = req.query;
      await exigerBranche(ctx, q.brancheId, ["care.voir", "facturation.administrer"]);
      const { rows } = await ctx.client.query(
        `select m.id, m.type, m.canal, m.numero_masque, m.objet_type, m.objet_id, m.statut, m.du_le, m.tentatives, m.essai_le, m.envoye_le, m.erreur, m.renvoi_de, m.cree_le,
           coalesce((select k.numero from colis k where k.id = m.objet_id and m.objet_type = 'colis'),
             (select i.reference from inscriptions_precommande i where i.id = m.objet_id and m.objet_type = 'inscription'),
             (select v.numero from ventes_comptoir v where v.id = m.objet_id and m.objet_type = 'vente_comptoir')) as objet
         from envois_messages m
         where m.branche_id = $1 and ($2::text is null or m.statut = $2) and ($3::text is null or m.type = $3)
           and ($4::date is null or (m.cree_le at time zone 'Africa/Douala')::date >= $4) and ($5::date is null or (m.cree_le at time zone 'Africa/Douala')::date <= $5)
         order by m.cree_le desc limit 500`,
        [q.brancheId, q.statut ?? null, q.type ?? null, q.du ?? null, q.au ?? null],
      );
      const { rows: mois } = await ctx.client.query(
        `select type, canal, count(*) filter (where statut = 'envoye')::int as envoyes, count(*) filter (where statut = 'echec')::int as echecs,
           count(*) filter (where statut = 'sans_numero')::int as sans_numero
         from envois_messages where branche_id = $1
           and date_trunc('month', cree_le at time zone 'Africa/Douala') = date_trunc('month', now() at time zone 'Africa/Douala')
           and statut in ('envoye', 'echec', 'sans_numero')
         group by type, canal order by type, canal`,
        [q.brancheId],
      );
      return { messages: rows.map((m) => ({ ...m, libelle: TYPES_MESSAGES[m.type as TypeMessage].libelle })), mois };
    }),
  );

  /**
   * Essai privé seulement : avec le prestataire factice, aucun SMS ne part ; le responsable technique lit ici le dernier code
   * de connexion envoyé à un numéro. Le code n'est lu que dans la mémoire du prestataire, jamais en base ni dans un journal.
   */
  app.get<{ Querystring: { telephone: string } }>("/messages/code-essai", {
    schema: { querystring: { type: "object", required: ["telephone"], properties: { telephone: { type: "string", minLength: 1, maxLength: 30 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      if (!prestataire || !("envoyes" in prestataire)) throw new ErreurApi(404, "introuvable");
      await outils.exiger(ctx, "entites.gerer");
      const telephone = mobileCamerounais(req.query.telephone);
      if (!telephone) throw new ErreurApi(400, "numero_invalide");
      const envoyes = (prestataire as ReturnType<typeof prestataireMessagesFactice>).envoyes;
      for (const m of [...envoyes].reverse()) {
        const code = /code de connexion est ([0-9]{6})/.exec(m.texte)?.[1];
        if (m.telephone !== telephone || !code) continue;
        // La référence est le code enregistré : il doit être de cette organisation et d'une branche où l'on gère les entités.
        const { rows: [k] } = await ctx.client.query("select branche_id from codes_connexion where id = $1", [m.reference]);
        if (!k) continue;
        await exigerSurEntite(ctx, "entites.gerer", k.branche_id);
        return { code, envoye_le: m.le };
      }
      throw new ErreurApi(404, "introuvable");
    }),
  );

  /** Un message raté repart, au besoin vers un numéro corrigé qui remplace celui de l'objet ; l'ancien reste au journal. */
  app.post<{ Params: { id: string }; Body?: { telephone?: string } | null }>("/messages/:id/renvoi", {
    schema: {
      params: { type: "object", required: ["id"], properties: { id: uuid } },
      body: { type: ["object", "null"], additionalProperties: false, properties: { telephone: { type: "string", minLength: 1, maxLength: 30 } } },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const c = ctx.client;
      const { rows: [m] } = await c.query("select * from envois_messages where id = $1 for update", [req.params.id]);
      if (!m) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "care.gerer", m.branche_id);
      if (!["echec", "sans_numero"].includes(m.statut)) throw new ErreurApi(409, "renvoi_impossible");
      // Un renvoi en attente ou déjà parti suffit : seul un renvoi raté à son tour peut être relancé (par lui-même).
      const { rows: [deja] } = await c.query("select 1 from envois_messages where renvoi_de = $1 and statut in ('en_attente', 'en_cours', 'envoye') limit 1", [m.id]);
      if (deja) throw new ErreurApi(409, "renvoi_impossible");
      const brut = req.body?.telephone;
      if (brut !== undefined) {
        const telephone = mobileCamerounais(brut);
        if (!telephone) throw new ErreurApi(400, "numero_invalide");
        if (COLIS.includes(m.type)) await c.query("update colis set telephone = $2 where id = $1", [m.objet_id, telephone]);
        else if (m.objet_type === "inscription") await c.query("update inscriptions_precommande set telephone = $2 where id = $1", [m.objet_id, telephone]);
        else {
          const tiers = m.type === "avis_livraison" ? await clientDuColis(c, m.objet_id)
            : (await c.query("select tiers_id from ventes_comptoir where id = $1", [m.objet_id])).rows[0]?.tiers_id ?? null;
          if (tiers) await c.query("update tiers set telephone = $2 where id = $1", [tiers, telephone]);
        }
      }
      const id = randomUUID();
      await c.query(
        `insert into envois_messages (id, organisation_id, branche_id, type, cle, objet_type, objet_id, renvoi_de, renvoye_par)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, ctx.organisationId, m.branche_id, m.type, `${m.cle.split("#")[0]}#${id}`, m.objet_type, m.objet_id, m.id, ctx.utilisateurId],
      );
      await c.query("select journal_evenement('messages.renvoi', $1)", [JSON.stringify({ message: m.id, renvoi: id, numero_corrige: brut !== undefined ? m.objet_type : null })]);
      return { id, statut: "en_attente" };
    });
    return reponse.status(201).send(r);
  });
}
