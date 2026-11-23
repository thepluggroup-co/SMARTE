import { randomBytes } from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import pg from "pg";
import { dansOrganisation, publierEvenement, type Client } from "./base.js";
import { creerCommandeAchat, crochetsAchats } from "./achats.js";
import { DUREE_RESERVATION_MINUTES, ficheClient, fraisLivraison, parBoutique, verifierLivraison } from "./canalenligne.js";
import { calculerLigne } from "./facturation.js";
import { prochainNumero } from "./formations.js";
import { confierAuxTitulaires } from "./performance.js";
import { aPermissionSurEntite, entitesAccessibles } from "./permissions.js";
import { hacherJeton, normaliserTelephone } from "./securite.js";
import { ErreurApi, type Contexte, type Outils, type TachePlanifiee } from "./serveur.js";
import { lierTiers } from "./tiers.js";

/**
 * Précommandes d'arrivage de GLOMARI (lot 3A) : une prévente est une précommande avec acompte, pas un financement
 * participatif (règle R4). Campagne, liste d'attente payée d'un acompte par Mobile Money, bon de commande en brouillon
 * au seuil, réservation du stock à l'arrivée, solde payé par une commande en ligne, remboursements confiés au trésorier.
 */

export const DELAI_SOLDE_JOURS_DEFAUT = 7;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE = /^PRE-[0-9]{4}-[0-9]{6}$/;
const JETON = /^[A-Za-z0-9_-]{43}$/;
const MOYENS = ["orange_money", "mtn_momo"];
const STATUTS = ["ouverte", "declenchee", "annulee", "livree"];
/** Une inscription dont l'acompte est encaissé et compte dans la progression. */
const VALIDEES = ["validee", "servie", "soldee", "acompte_conserve"];
/** Une inscription qui a déjà un paiement réussi : tout autre paiement est en trop. */
const PAYEES = [...VALIDEES, "a_rembourser", "remboursee"];
const MOTIFS: Record<string, string> = {
  campagne_annulee: "campagne annulée", seuil_non_atteint: "seuil non atteint à la date limite", retrait_client: "retrait du client",
  non_servie: "arrivage insuffisant", complet: "campagne complète ou close", deja_payee: "acompte payé deux fois",
};
const NOMS_MOYENS: Record<string, string> = { orange_money: "Orange Money", mtn_momo: "MTN MoMo" };
const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const motifBody = { type: "object", required: ["motif"], properties: { motif: { type: "string", minLength: 3, maxLength: 500 } } } as const;
const parMinute = (max: number) => ({ rateLimit: { max, timeWindow: "1 minute" } });
const jourDouala = () => new Date(Date.now() + 3600000).toISOString().slice(0, 10);
const anneeDouala = () => new Date(Date.now() + 3600000).getUTCFullYear();
const fcfa = (n: number) => `${Number(n).toLocaleString("fr-FR")} FCFA`;

/** Le texte exact que le client accepte avant de payer l'acompte ; il est gardé sur son inscription. */
export function conditionsPrecommande(delaiJours: number): string {
  return "Précommande avec acompte, pas un financement participatif. L'acompte réserve votre place sur la liste d'attente. "
    + "GLOMARI ne commande au fabricant que si le seuil est atteint ; si la campagne est annulée ou n'atteint pas son seuil à la date limite, "
    + "l'acompte vous est remboursé en entier. À l'arrivée de l'article, le solde se paie par Mobile Money "
    + `dans les ${delaiJours} jours ; sans paiement dans ce délai, l'acompte reste acquis à GLOMARI et l'article est remis en vente.`;
}

/** TTC d'une pièce, calculé comme une ligne de facture. */
const ttcUnitaire = (ht: number, taux: number) => { const m = calculerLigne(1, ht, 0, taux); return m.ht + m.taxes; };

/**
 * Le prix HT entier qui donne exactement ce TTC. La taxe s'arrondit par ligne : avec un taux, certains TTC ne sont
 * atteints par aucun HT ; on propose alors les deux plus proches.
 */
export function htPourTtc(ttc: number, taux: number): { ht: number } | { proches: number[] } {
  const estime = Math.floor((ttc * 100) / (100 + taux));
  for (let ht = Math.max(1, estime - 2); ht <= estime + 2; ht++) if (ttcUnitaire(ht, taux) === ttc) return { ht };
  let bas: number | null = null, haut: number | null = null;
  for (let ht = Math.max(1, estime - 3); ht <= estime + 3; ht++) {
    const t = ttcUnitaire(ht, taux);
    if (t < ttc) bas = t;
    if (t > ttc && haut === null) haut = t;
  }
  return { proches: [bas, haut].filter((x): x is number => x !== null) };
}

const acompteUnitaire = (type: string, valeur: number, prixTtc: number) =>
  type === "montant" ? valeur : Math.max(1, Math.round((prixTtc * valeur) / 100));

type Campagne = Record<string, any>;

/** Quantité validée, retenue (avec les inscriptions en attente non échues), capacité et progression publique. */
export async function quantites(c: Client, k: Campagne) {
  const { rows: [q] } = await c.query(
    `select coalesce(sum(quantite) filter (where statut = any($2::text[])), 0)::int as validee,
       coalesce(sum(quantite) filter (where statut = any($2::text[]) or (statut = 'en_attente' and expire_le > now())), 0)::int as retenue
     from inscriptions_precommande where campagne_id = $1`,
    [k.id, VALIDEES],
  );
  // Une fois le bon de commande approuvé, on ne promet pas plus que ce qui est commandé.
  const { rows: [b] } = await c.query(
    `select coalesce(sum(l.quantite), 0)::float as commandee from commandes_achat a join lignes_achat l on l.commande_id = a.id
     where a.id = $1 and l.produit_id = $2 and a.statut in ('approuvee', 'recue_partiellement', 'recue')`,
    [k.commande_achat_id, k.produit_id],
  );
  const { rows: [a] } = await c.query("select statut from commandes_achat where id = $1", [k.commande_achat_id]);
  const limites = [k.quantite_max, a && ["approuvee", "recue_partiellement", "recue"].includes(a.statut) ? b.commandee : null].filter((x) => x !== null && x !== undefined) as number[];
  const capacite = limites.length ? Math.min(...limites) : null;
  return { validee: q.validee, retenue: q.retenue, capacite, progression: Math.min(100, Math.floor((q.validee * 100) / k.seuil)) };
}

/** Ouverte ou déclenchée, date limite non passée à Douala, arrivage pas encore reçu. */
const accepteInscriptions = (k: Campagne) =>
  ["ouverte", "declenchee"].includes(k.statut) && String(k.date_limite) >= jourDouala() && !k.premiere_reception_le;

/** Le motif d'annulation d'une campagne : d'office à la date limite, ou par une personne. */
const motifCampagne = (k: Campagne) => (k.annulee_par ? "campagne_annulee" : "seuil_non_atteint");

export async function leverReservationsInscription(c: Client, inscriptionId: string): Promise<void> {
  await c.query("update reservations_stock set levee_le = now() where inscription_id = $1 and levee_le is null", [inscriptionId]);
}

/** Une campagne déclenchée et déjà reçue est livrée quand plus aucune inscription n'attend son solde ou son remboursement. */
export async function verifierLivree(c: Client, campagneId: string): Promise<void> {
  const { rows: [k] } = await c.query("select statut, premiere_reception_le from campagnes_arrivage where id = $1", [campagneId]);
  if (k?.statut !== "declenchee" || !k.premiere_reception_le) return;
  const { rows: [r] } = await c.query(
    "select count(*) filter (where statut in ('validee', 'servie', 'a_rembourser'))::int as ouvertes from inscriptions_precommande where campagne_id = $1",
    [campagneId],
  );
  if (r.ouvertes === 0) {
    await c.query("update campagnes_arrivage set statut = 'livree' where id = $1", [campagneId]);
    await publierEvenement(c, "precommande.campagne_livree", { campagne: campagneId });
  }
}

/** Les acomptes validés deviennent « à rembourser » ; les titulaires du droit de trésorerie reçoivent une tâche avec la liste. */
async function preparerRemboursements(c: Client, org: string, k: Campagne, inscriptions: Record<string, any>[], motif: string, auteur: string | null) {
  if (!inscriptions.length) return;
  const lignes: string[] = [];
  let total = 0;
  for (const i of inscriptions) {
    const { rows: [p] } = await c.query(
      "update paiements_en_ligne set statut = 'a_rembourser', motif = $2 where inscription_id = $1 and statut = 'reussi' returning moyen, montant, reference_prestataire",
      [i.id, motif],
    );
    await c.query("update inscriptions_precommande set statut = 'a_rembourser', motif = $2, traite_le = now(), traite_par = $3 where id = $1", [i.id, motif, auteur]);
    await publierEvenement(c, "precommande.a_rembourser", { campagne: k.id, inscription: i.id, reference: i.reference, motif });
    if (p) {
      total += Number(p.montant);
      lignes.push(`${i.nom_client}, ${i.telephone} : ${fcfa(p.montant)}, ${NOMS_MOYENS[p.moyen]}, référence ${p.reference_prestataire} (précommande ${i.reference})`);
    }
  }
  await confierAuxTitulaires(c, org, k.entite_id, "tresorerie.gerer", k.cree_par,
    `Rembourser ${lignes.length} acompte(s) de la campagne ${k.numero} : ${fcfa(total)} (${MOTIFS[motif]})`,
    inscriptions.length === 1 ? inscriptions[0]!.tiers_id : null, lignes.join("\n"));
  await c.query("select journal_evenement('precommande.acomptes_a_rembourser', $1)", [JSON.stringify({ campagne: k.id, motif, nombre: lignes.length, total })]);
}

/** Annulation par une personne, ou d'office à la date limite (auteur nul). Le bon de commande n'est pas touché. */
async function annulerCampagne(c: Client, org: string, k: Campagne, texte: string, motif: "campagne_annulee" | "seuil_non_atteint", auteur: string | null) {
  await c.query(
    "update campagnes_arrivage set statut = 'annulee', motif_annulation = $2, annulee_le = now(), annulee_par = $3 where id = $1",
    [k.id, texte, auteur],
  );
  const { rows: validees } = await c.query("select * from inscriptions_precommande where campagne_id = $1 and statut = 'validee' for update", [k.id]);
  await preparerRemboursements(c, org, k, validees, motif, auteur);
  await c.query(
    "update inscriptions_precommande set statut = 'annulee', motif = $2, traite_le = now(), traite_par = $3 where campagne_id = $1 and statut in ('en_attente', 'expiree')",
    [k.id, motif, auteur],
  );
  await publierEvenement(c, "precommande.campagne_annulee", { campagne: k.id, numero: k.numero, motif });
  await c.query("select journal_evenement('precommande.campagne_annulee', $1)", [JSON.stringify({ campagne: k.id, motif, texte })]);
}

/** Brouillon au fournisseur prévu, pour le lieu de réception, au nom de l'utilisateur du contexte. Jamais envoyé seul. */
async function creerBonDeCommande(ctx: Contexte, exigerSurEntite: Outils["exigerSurEntite"], k: Campagne, quantite: number) {
  const bc = await creerCommandeAchat(ctx, exigerSurEntite, {
    entiteId: k.lieu_id, fournisseurId: k.fournisseur_id, date: jourDouala(), origine: k.origine,
    notes: `Précommandes de la campagne ${k.numero}`,
    lignes: [{ produitId: k.produit_id, quantite, prixUnitaire: Number(k.prix_achat_prevu ?? 0), prixVente: Number(k.prix_ht) }],
  });
  await ctx.client.query("update campagnes_arrivage set commande_achat_id = $2 where id = $1", [k.id, bc.id]);
  return bc;
}

/**
 * Sous le verrou de la campagne : le premier acompte qui atteint le seuil la déclenche, une seule fois. Si le brouillon
 * ne peut pas être créé (droit retiré à l'auteur…), l'acompte reste validé et une tâche va aux acheteurs.
 */
async function declencherSiSeuil(c: Client, org: string, k: Campagne, exigerSurEntite: Outils["exigerSurEntite"], journal: FastifyBaseLogger) {
  if (k.statut !== "ouverte") return;
  const q = await quantites(c, k);
  if (q.validee < k.seuil) return;
  await c.query("update campagnes_arrivage set statut = 'declenchee', declenchee_le = now() where id = $1", [k.id]);
  k.statut = "declenchee";
  await publierEvenement(c, "precommande.seuil_atteint", { campagne: k.id, numero: k.numero });
  await c.query("savepoint achat");
  try {
    const bc = await creerBonDeCommande({ client: c, utilisateurId: k.cree_par, organisationId: org }, exigerSurEntite, k, q.validee);
    await c.query("release savepoint achat");
    await c.query("select journal_evenement('precommande.seuil_atteint', $1)", [JSON.stringify({ campagne: k.id, commande: bc.id })]);
  } catch (e) {
    await c.query("rollback to savepoint achat");
    if (!(e instanceof ErreurApi)) journal.error(e, "bon de commande d'une précommande");
    const cause = e instanceof ErreurApi ? e.code : "erreur_interne";
    await confierAuxTitulaires(c, org, k.lieu_id, "achats.gerer", k.cree_par, `Préparer le bon de commande de la campagne ${k.numero} : ${cause}`, null);
    await c.query("select journal_evenement('precommande.bon_a_preparer', $1)", [JSON.stringify({ campagne: k.id, cause })]);
  }
}

/**
 * Avis signé de réussite pour l'acompte d'une inscription (appelé par la route d'avis du lot 2, paiement verrouillé).
 * L'argent est encaissé une fois ; il valide l'inscription, ou devient « à rembourser ».
 */
export async function traiterAcompte(
  c: Client, org: string, p: Record<string, any>, exigerSurEntite: Outils["exigerSurEntite"], journal: FastifyBaseLogger,
): Promise<{ issue: "traite"; statut: string }> {
  const { rows: [x] } = await c.query("select campagne_id from inscriptions_precommande where id = $1", [p.inscription_id]);
  // Toujours la campagne avant l'inscription : deux acomptes simultanés franchissent le seuil l'un après l'autre.
  const { rows: [k] } = await c.query("select * from campagnes_arrivage where id = $1 for update", [x.campagne_id]);
  const { rows: [i] } = await c.query("select *, expire_le > now() as en_cours from inscriptions_precommande where id = $1 for update", [p.inscription_id]);
  const encaisser = (libelle: string) => c.query(
    "select tresorerie_encaisser($1, $2, $3, $4, $5, $6, 'paiement_en_ligne', $7)",
    [org, k.entite_id, p.moyen, p.montant, libelle, p.reference_prestataire, p.id],
  );

  let motif: string | null = null;
  const dejaPayee = PAYEES.includes(i.statut);
  if (dejaPayee) motif = "deja_payee";
  else if (k.statut === "annulee") motif = motifCampagne(k);
  else if (i.statut === "annulee") motif = "retrait_client";
  else if (i.statut === "en_attente" && i.en_cours) {
    // Payée dans son délai : la place était retenue, même si la date limite vient de passer.
    if (k.premiere_reception_le) motif = "complet";
  } else {
    const q = await quantites(c, k);
    if (!accepteInscriptions(k) || (q.capacite !== null && q.retenue + i.quantite > q.capacite)) motif = "complet";
  }

  if (motif) {
    await c.query("update paiements_en_ligne set statut = 'a_rembourser', motif = $2, traite_le = now() where id = $1", [p.id, motif]);
    if (!dejaPayee) await c.query("update inscriptions_precommande set statut = 'a_rembourser', motif = $2, traite_le = now() where id = $1", [i.id, motif]);
    await encaisser(`Acompte à rembourser, précommande ${i.reference}`);
    await confierAuxTitulaires(c, org, k.entite_id, "tresorerie.gerer", k.cree_par,
      `Rembourser l'acompte ${p.reference_prestataire} : ${fcfa(p.montant)} (${MOTIFS[motif]}, précommande ${i.reference})`, i.tiers_id,
      `${i.nom_client}, ${i.telephone}, ${NOMS_MOYENS[p.moyen]}`);
    await c.query("select journal_evenement('precommande.acompte_a_rembourser', $1)", [JSON.stringify({ paiement: p.id, inscription: i.id, motif })]);
    await publierEvenement(c, "precommande.a_rembourser", { campagne: k.id, inscription: i.id, reference: i.reference, motif });
    return { issue: "traite", statut: "a_rembourser" };
  }

  await c.query("update paiements_en_ligne set statut = 'reussi', traite_le = now() where id = $1", [p.id]);
  await c.query("update inscriptions_precommande set statut = 'validee', validee_le = now(), motif = null, traite_le = now() where id = $1", [i.id]);
  await encaisser(`Acompte de la précommande ${i.reference}, campagne ${k.numero}`);
  await publierEvenement(c, "precommande.inscription_validee", { campagne: k.id, inscription: i.id, reference: i.reference, quantite: i.quantite });
  await declencherSiSeuil(c, org, k, exigerSurEntite, journal);
  return { issue: "traite", statut: "validee" };
}

/** Le solde est payé et la facture émise (vente automatique du lot 2). */
export async function solderInscription(c: Client, inscriptionId: string, facture: string): Promise<void> {
  const { rows: [i] } = await c.query(
    "update inscriptions_precommande set statut = 'soldee', traite_le = now() where id = $1 returning campagne_id, reference", [inscriptionId],
  );
  await publierEvenement(c, "precommande.soldee", { campagne: i.campagne_id, inscription: inscriptionId, reference: i.reference, facture });
  await verifierLivree(c, i.campagne_id);
}

/** Après le remboursement d'un acompte : l'inscription n'est « remboursée » que si c'est bien son acompte, pas un paiement en double. */
export async function apresRemboursement(c: Client, inscriptionId: string, motifPaiement: string): Promise<void> {
  if (motifPaiement === "deja_payee") return;
  const { rows: [i] } = await c.query(
    "update inscriptions_precommande set statut = 'remboursee', traite_le = now() where id = $1 and statut = 'a_rembourser' returning campagne_id", [inscriptionId],
  );
  if (i) await verifierLivree(c, i.campagne_id);
}

/**
 * Relançable sans effet de bord, lignes prises en « skip locked » : inscriptions en attente échues, campagnes ouvertes
 * passées leur date limite sous le seuil, soldes non payés à temps (l'acompte reste acquis à GLOMARI).
 */
export async function expirerPrecommandes(c: Client): Promise<number> {
  const { rowCount } = await c.query(
    `update inscriptions_precommande set statut = 'expiree', traite_le = now() where id in (
       select id from inscriptions_precommande where statut = 'en_attente' and expire_le < now() order by expire_le limit 500 for update skip locked)`,
  );
  let n = rowCount ?? 0;
  const { rows: echues } = await c.query(
    "select * from campagnes_arrivage where statut = 'ouverte' and date_limite < (now() at time zone 'Africa/Douala')::date order by date_limite limit 100 for update skip locked",
  );
  for (const k of echues) {
    await annulerCampagne(c, k.organisation_id, k, "Seuil non atteint à la date limite", "seuil_non_atteint", null);
    n++;
  }
  // Un solde déjà payé mais dont la facture attend (vente « à terminer ») n'est jamais pris.
  const { rows: servies } = await c.query(
    `select i.id, i.campagne_id, i.reference from inscriptions_precommande i
     where i.statut = 'servie' and i.solde_avant < now()
       and not exists (select 1 from commandes_web w where w.inscription_id = i.id and w.statut in ('payee', 'facturee', 'expediee', 'livree'))
     order by i.solde_avant limit 500 for update of i skip locked`,
  );
  for (const i of servies) {
    await c.query("update inscriptions_precommande set statut = 'acompte_conserve', traite_le = now() where id = $1", [i.id]);
    await leverReservationsInscription(c, i.id);
    await publierEvenement(c, "precommande.acompte_conserve", { campagne: i.campagne_id, inscription: i.id, reference: i.reference });
    await c.query("select journal_evenement('precommande.acompte_conserve', $1)", [JSON.stringify({ inscription: i.id })]);
    await verifierLivree(c, i.campagne_id);
    n++;
  }
  return n;
}

interface CorpsCampagne {
  entiteId: string; lieuId: string; produitId: string; fournisseurId: string; origine?: "local" | "import"; titre: string; texte?: string;
  prixTtc: number; acompteType: "montant" | "pourcentage"; acompteValeur: number; seuil: number; quantiteMax?: number | null;
  dateLimite: string; delaiSoldeJours?: number; prixAchatPrevu?: number | null;
}
/** Le lieu, l'article et la branche ne changent pas : on annule et on recrée la campagne. */
const proprietesModifiables = {
  fournisseurId: uuid, origine: { type: "string", enum: ["local", "import"] },
  titre: { type: "string", minLength: 1, maxLength: 200 }, texte: { type: "string", maxLength: 2000 },
  prixTtc: { type: "integer", minimum: 1, maximum: 10_000_000_000 }, acompteType: { type: "string", enum: ["montant", "pourcentage"] },
  acompteValeur: { type: "integer", minimum: 1, maximum: 10_000_000_000 }, seuil: { type: "integer", minimum: 1, maximum: 1_000_000 },
  quantiteMax: { type: ["integer", "null"], minimum: 1, maximum: 1_000_000 }, dateLimite: date,
  delaiSoldeJours: { type: "integer", minimum: 1, maximum: 60 }, prixAchatPrevu: { type: ["integer", "null"], minimum: 0, maximum: 10_000_000_000 },
} as const;
const proprietesCampagne = { entiteId: uuid, lieuId: uuid, produitId: uuid, ...proprietesModifiables } as const;

/** Prix HT exact, acompte par pièce et contrôles communs à la création et à la modification. */
function calculerPrix(prixTtc: number, taux: number, acompteType: string, acompteValeur: number) {
  const r = htPourTtc(prixTtc, taux);
  if ("proches" in r) throw new ErreurApi(400, "prix_annonce_impossible", { proches: r.proches });
  if (acompteType === "pourcentage" && acompteValeur > 99) throw new ErreurApi(400, "acompte_invalide");
  const acompte = acompteUnitaire(acompteType, acompteValeur, prixTtc);
  if (acompte < 1 || acompte >= prixTtc) throw new ErreurApi(400, "acompte_invalide");
  return { prixHt: r.ht, acompte };
}

export function enregistrerPrecommandes(app: FastifyInstance, pool: pg.Pool, outils: Outils, taches: TachePlanifiee[], options: { commandesParMinute: number }): void {
  const { protege, exigerSurEntite } = outils;
  taches.push((organisationId) => dansOrganisation(pool, organisationId, async (c) => { await expirerPrecommandes(c); }));

  /** Les branches où la personne voit les précommandes : droit de voir les achats ou la facturation. */
  const branchesVisibles = async (ctx: Contexte): Promise<string[]> => {
    const ids = new Set<string>();
    for (const p of ["achats.voir", "facturation.voir"] as const) for (const e of await entitesAccessibles(ctx.client, ctx.utilisateurId, p)) ids.add(String(e.id));
    return [...ids];
  };
  const exigerVoir = async (ctx: Contexte, brancheId: string) => {
    if (await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "achats.voir", brancheId)) return;
    if (await aPermissionSurEntite(ctx.client, ctx.utilisateurId, "facturation.voir", brancheId)) return;
    throw new ErreurApi(403, "permission_refusee");
  };
  const campagneVerrouillee = async (ctx: Contexte, id: string) => {
    const { rows: [k] } = await ctx.client.query("select * from campagnes_arrivage where id = $1 for update", [id]);
    if (!k) throw new ErreurApi(404, "introuvable");
    return k as Campagne;
  };

  // ---------- Hooks des achats : la campagne suit son bon de commande ----------

  crochetsAchats.approbation = async (ctx, commandeId) => {
    const { rows: [k] } = await ctx.client.query("select * from campagnes_arrivage where commande_achat_id = $1 and statut <> 'annulee' for update", [commandeId]);
    if (!k) return;
    const { validee } = await quantites(ctx.client, k);
    const { rows: [l] } = await ctx.client.query(
      "select coalesce(sum(quantite), 0)::float as q from lignes_achat where commande_id = $1 and produit_id = $2", [commandeId, k.produit_id],
    );
    if (l.q < validee) throw new ErreurApi(409, "quantite_inferieure_aux_precommandes", { validee, commandee: l.q });
    await publierEvenement(ctx.client, "precommande.arrivage_etape", { campagne: k.id, etape: "commandee", date: jourDouala() });
  };

  crochetsAchats.etape = async (ctx, commandeId, etape, jour) => {
    const { rows: [k] } = await ctx.client.query("select id from campagnes_arrivage where commande_achat_id = $1 and statut <> 'annulee'", [commandeId]);
    if (k) await publierEvenement(ctx.client, "precommande.arrivage_etape", { campagne: k.id, etape, date: jour });
  };

  /** La quantité reçue est réservée aux inscrits, par ordre de confirmation de l'acompte, chacun servi en entier. */
  crochetsAchats.reception = async (ctx, commandeId, receptionId, statut) => {
    const c = ctx.client;
    const { rows: [k] } = await c.query("select * from campagnes_arrivage where commande_achat_id = $1 and statut = 'declenchee' for update", [commandeId]);
    if (!k) return;
    if (!k.premiere_reception_le) await c.query("update campagnes_arrivage set premiere_reception_le = now() where id = $1", [k.id]);
    const { rows: [r] } = await c.query(
      `select coalesce(sum(lr.quantite), 0)::float as recu from lignes_reception lr join lignes_achat la on la.id = lr.ligne_id
       where lr.reception_id = $1 and la.produit_id = $2`,
      [receptionId, k.produit_id],
    );
    const { rows: [v] } = await c.query("select quantite_vendable($1, $2)::float as q", [k.lieu_id, k.produit_id]);
    let budget = Math.min(r.recu, v.q);
    const { rows: attente } = await c.query(
      "select * from inscriptions_precommande where campagne_id = $1 and statut = 'validee' order by validee_le, id for update", [k.id],
    );
    const servies = new Set<string>();
    for (const i of attente) {
      if (i.quantite > budget) break;
      budget -= i.quantite;
      await c.query(
        `insert into reservations_stock (organisation_id, entite_id, produit_id, quantite, tiers_id, motif, inscription_id, auteur_id)
         values ($1, $2, $3, $4, $5, 'precommande', $6, $7)`,
        [ctx.organisationId, k.lieu_id, k.produit_id, i.quantite, i.tiers_id, i.id, ctx.utilisateurId],
      );
      const { rows: [s] } = await c.query(
        `update inscriptions_precommande set statut = 'servie', servie_le = now(), solde_avant = now() + make_interval(days => $2), traite_le = now()
         where id = $1 returning solde_avant`,
        [i.id, k.delai_solde_jours],
      );
      servies.add(i.id);
      await publierEvenement(c, "precommande.arrivage_recu", { campagne: k.id, inscription: i.id, reference: i.reference, solde_avant: s.solde_avant });
    }
    // Commande close sans tout recevoir : les inscrits non servis sont remboursés.
    if (statut === "recue") await preparerRemboursements(c, ctx.organisationId, k, attente.filter((i) => !servies.has(i.id)), "non_servie", ctx.utilisateurId);
  };

  // ---------- Campagnes (personnel) ----------

  app.get<{ Querystring: { statut?: string } }>("/precommandes/campagnes", {
    schema: { querystring: { type: "object", properties: { statut: { type: "string", enum: STATUTS } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const branches = await branchesVisibles(ctx);
      if (!branches.length) throw new ErreurApi(403, "permission_refusee");
      await expirerPrecommandes(ctx.client);
      return (await ctx.client.query(`${SELECT_CAMPAGNE} where k.entite_id = any($1::uuid[]) and ($2::text is null or k.statut = $2) order by k.cree_le desc limit 300`, [branches, req.query.statut ?? null])).rows;
    }),
  );

  app.post<{ Body: CorpsCampagne }>("/precommandes/campagnes", {
    schema: {
      body: {
        type: "object", additionalProperties: false,
        required: ["entiteId", "lieuId", "produitId", "fournisseurId", "titre", "prixTtc", "acompteType", "acompteValeur", "seuil", "dateLimite"],
        properties: proprietesCampagne,
      },
    },
  }, async (req, reponse) => {
    const k = await protege(req, async (ctx) => {
      const b = req.body;
      const c = ctx.client;
      const { rows: [e] } = await c.query(
        "select entite_branche($1) = $1 as branche, exists (select 1 from modules_entite where entite_id = $1 and module = 'achats_stocks' and actif) as stock",
        [b.entiteId],
      );
      if (!e.branche) throw new ErreurApi(400, "branche_attendue");
      if (!e.stock) throw new ErreurApi(409, "module_inactif");
      await exigerSurEntite(ctx, "achats.gerer", b.entiteId);
      const { rows: [boutique] } = await c.query("select id from config_canal where entite_id = $1", [b.entiteId]);
      if (!boutique) throw new ErreurApi(409, "boutique_absente");
      const { rows: [lieu] } = await c.query(
        "select 1 from lieux_canal l join entites e on e.id = l.entite_id where l.config_id = $1 and l.entite_id = $2 and l.actif and e.actif",
        [boutique.id, b.lieuId],
      );
      if (!lieu) throw new ErreurApi(400, "lieu_invalide");
      // Le brouillon du bon de commande sera créé au nom de cette personne, sur le lieu de réception.
      await exigerSurEntite(ctx, "achats.gerer", b.lieuId);
      const { rows: [p] } = await c.query(
        "select id, taux_taxe::float as taux from produits where id = $1 and actif and type = 'produit' and suivi_stock and entite_branche(entite_id) = $2",
        [b.produitId, b.entiteId],
      );
      if (!p) throw new ErreurApi(404, "introuvable");
      if (b.dateLimite <= jourDouala()) throw new ErreurApi(400, "date_limite_invalide");
      if (!b.titre.trim() || (b.quantiteMax != null && b.quantiteMax < b.seuil)) throw new ErreurApi(400, "donnees_invalides");
      const prix = calculerPrix(b.prixTtc, p.taux, b.acompteType, b.acompteValeur);
      await lierTiers(ctx, b.fournisseurId, b.entiteId);
      await c.query("update tiers set roles = array_append(roles, 'fournisseur') where id = $1 and not ('fournisseur' = any(roles))", [b.fournisseurId]);
      const numero = await prochainNumero(c, `ARR-${anneeDouala()}`);
      const { rows: [n] } = await c.query(
        `insert into campagnes_arrivage (organisation_id, entite_id, lieu_id, produit_id, fournisseur_id, numero, origine, titre, texte,
           prix_ht, taux_taxe, prix_ttc, acompte_type, acompte_valeur, acompte_unitaire, seuil, quantite_max, date_limite, delai_solde_jours,
           prix_achat_prevu, cree_par)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) returning *`,
        [ctx.organisationId, b.entiteId, b.lieuId, p.id, b.fournisseurId, numero, b.origine ?? "import", b.titre.trim(), b.texte?.trim() || null,
          prix.prixHt, p.taux, b.prixTtc, b.acompteType, b.acompteValeur, prix.acompte, b.seuil, b.quantiteMax ?? null, b.dateLimite,
          b.delaiSoldeJours ?? DELAI_SOLDE_JOURS_DEFAUT, b.prixAchatPrevu ?? null, ctx.utilisateurId],
      );
      return n;
    });
    return reponse.status(201).send(k);
  });

  app.get<{ Params: { id: string } }>("/precommandes/campagnes/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const c = ctx.client;
      const { rows: [k] } = await c.query(`${SELECT_CAMPAGNE} where k.id = $1`, [req.params.id]);
      if (!k) throw new ErreurApi(404, "introuvable");
      await exigerVoir(ctx, k.entite_id);
      await expirerPrecommandes(c);
      const { rows: inscriptions } = await c.query(
        `select i.id, i.reference, i.nom_client, i.telephone, i.quantite, i.total_ttc, i.acompte, i.statut, i.motif, i.moyen_paiement,
           i.validee_le, i.servie_le, i.solde_avant, i.cree_le, w.reference as commande_solde, w.statut as commande_solde_statut, f.numero as facture
         from inscriptions_precommande i
         left join lateral (select reference, statut, facture_id from commandes_web where inscription_id = i.id order by cree_le desc limit 1) w on true
         left join documents_vente f on f.id = w.facture_id
         where i.campagne_id = $1 order by i.validee_le nulls last, i.cree_le`,
        [k.id],
      );
      let rang = 0;
      const liste = inscriptions.map((i) => ({ ...i, rang: i.validee_le ? ++rang : null }));
      let commande = null;
      if (k.commande_achat_id) {
        const { rows: [a] } = await c.query(
          `select a.id, a.numero, a.statut, a.etape, (select coalesce(sum(quantite), 0)::float from lignes_achat where commande_id = a.id and produit_id = $2) as quantite_commandee
           from commandes_achat a where a.id = $1`,
          [k.commande_achat_id, k.produit_id],
        );
        const { rows: etapes } = await c.query("select etape, date_etape::text as date from etapes_achat where commande_id = $1 order by date_etape, cree_le", [k.commande_achat_id]);
        commande = { ...a, etapes };
      }
      return { ...k, ...(await quantites(c, k)), inscriptions: liste, commande_achat: commande, conditions: conditionsPrecommande(k.delai_solde_jours) };
    }),
  );

  app.patch<{ Params: { id: string }; Body: Partial<CorpsCampagne> }>("/precommandes/campagnes/:id", {
    schema: {
      params: paramId,
      body: {
        type: "object", additionalProperties: false, minProperties: 1,
        properties: proprietesModifiables,
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const c = ctx.client;
      const k = await campagneVerrouillee(ctx, req.params.id);
      await exigerSurEntite(ctx, "achats.gerer", k.entite_id);
      if (!["ouverte", "declenchee"].includes(k.statut)) throw new ErreurApi(409, "campagne_figee");
      const b = req.body;
      const { rows: [paye] } = await c.query("select exists (select 1 from inscriptions_precommande where campagne_id = $1 and validee_le is not null) as oui", [k.id]);
      // Dès le premier acompte, le prix, l'acompte et le seuil sont ceux que les inscrits ont acceptés.
      const libres = ["titre", "texte", "dateLimite", "quantiteMax"];
      if (paye.oui && Object.keys(b).some((cle) => !libres.includes(cle))) throw new ErreurApi(409, "campagne_figee");
      if (b.dateLimite !== undefined && (b.dateLimite <= jourDouala() || (paye.oui && b.dateLimite < String(k.date_limite)))) throw new ErreurApi(400, "date_limite_invalide");
      const seuil = b.seuil ?? k.seuil;
      const quantiteMax = b.quantiteMax !== undefined ? b.quantiteMax : k.quantite_max;
      if ((b.titre !== undefined && !b.titre.trim()) || (quantiteMax != null && quantiteMax < seuil)) throw new ErreurApi(400, "donnees_invalides");
      if (b.quantiteMax !== undefined && paye.oui && quantiteMax != null) {
        const q = await quantites(c, k);
        if ((k.quantite_max != null && quantiteMax < k.quantite_max) || quantiteMax < q.retenue) throw new ErreurApi(409, "campagne_figee");
      }
      const prixTtc = b.prixTtc ?? Number(k.prix_ttc);
      const acompteType = b.acompteType ?? k.acompte_type;
      const acompteValeur = b.acompteValeur ?? Number(k.acompte_valeur);
      const prix = calculerPrix(prixTtc, Number(k.taux_taxe), acompteType, acompteValeur);
      if (b.fournisseurId) {
        await lierTiers(ctx, b.fournisseurId, k.entite_id);
        await c.query("update tiers set roles = array_append(roles, 'fournisseur') where id = $1 and not ('fournisseur' = any(roles))", [b.fournisseurId]);
      }
      const { rows: [n] } = await c.query(
        `update campagnes_arrivage set titre = $2, texte = $3, date_limite = $4, quantite_max = $5, prix_ht = $6, prix_ttc = $7, acompte_type = $8,
           acompte_valeur = $9, acompte_unitaire = $10, seuil = $11, delai_solde_jours = $12, prix_achat_prevu = $13, fournisseur_id = $14, origine = $15
         where id = $1 returning *`,
        [k.id, b.titre?.trim() ?? k.titre, b.texte !== undefined ? b.texte.trim() || null : k.texte, b.dateLimite ?? k.date_limite, quantiteMax,
          prix.prixHt, prixTtc, acompteType, acompteValeur, prix.acompte, seuil, b.delaiSoldeJours ?? k.delai_solde_jours,
          b.prixAchatPrevu !== undefined ? b.prixAchatPrevu : k.prix_achat_prevu, b.fournisseurId ?? k.fournisseur_id, b.origine ?? k.origine],
      );
      return n;
    }),
  );

  app.post<{ Params: { id: string }; Body: { motif: string } }>("/precommandes/campagnes/:id/annulation", {
    schema: { params: paramId, body: motifBody },
  }, async (req) =>
    protege(req, async (ctx) => {
      const k = await campagneVerrouillee(ctx, req.params.id);
      await exigerSurEntite(ctx, "achats.gerer", k.entite_id);
      if (k.premiere_reception_le || !["ouverte", "declenchee"].includes(k.statut)) throw new ErreurApi(409, "campagne_non_annulable");
      const motif = req.body.motif.trim();
      if (motif.length < 3) throw new ErreurApi(400, "donnees_invalides");
      await annulerCampagne(ctx.client, ctx.organisationId, k, motif, "campagne_annulee", ctx.utilisateurId);
      return { statut: "annulee" };
    }),
  );

  /** Après un échec au seuil, ou un bon de commande annulé par l'acheteur. */
  app.post<{ Params: { id: string } }>("/precommandes/campagnes/:id/bon-de-commande", { schema: { params: paramId } }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const k = await campagneVerrouillee(ctx, req.params.id);
      await exigerSurEntite(ctx, "achats.gerer", k.entite_id);
      const { rows: [a] } = await ctx.client.query("select statut from commandes_achat where id = $1", [k.commande_achat_id]);
      if (k.statut !== "declenchee" || (a && a.statut !== "annulee")) throw new ErreurApi(409, "bon_de_commande_existant");
      const { validee } = await quantites(ctx.client, k);
      const bc = await creerBonDeCommande(ctx, exigerSurEntite, k, validee);
      return { commande_achat: { id: bc.id, numero: bc.numero, statut: bc.statut } };
    });
    return reponse.status(201).send(r);
  });

  /** À la demande du client, tant que la commande au fournisseur n'est pas lancée. */
  app.post<{ Params: { id: string }; Body: { motif: string } }>("/precommandes/inscriptions/:id/annulation", {
    schema: { params: paramId, body: motifBody },
  }, async (req) =>
    protege(req, async (ctx) => {
      const c = ctx.client;
      const { rows: [x] } = await c.query("select campagne_id from inscriptions_precommande where id = $1", [req.params.id]);
      if (!x) throw new ErreurApi(404, "introuvable");
      const k = await campagneVerrouillee(ctx, x.campagne_id);
      await exigerSurEntite(ctx, "achats.gerer", k.entite_id);
      const { rows: [i] } = await c.query("select * from inscriptions_precommande where id = $1 for update", [req.params.id]);
      if (k.statut !== "ouverte" || !["en_attente", "expiree", "validee"].includes(i.statut)) throw new ErreurApi(409, "inscription_non_annulable");
      if (i.statut === "validee") await preparerRemboursements(c, ctx.organisationId, k, [i], "retrait_client", ctx.utilisateurId);
      else await c.query("update inscriptions_precommande set statut = 'annulee', motif = 'retrait_client', traite_le = now(), traite_par = $2 where id = $1", [i.id, ctx.utilisateurId]);
      await c.query("select journal_evenement('precommande.inscription_annulee', $1)", [JSON.stringify({ inscription: i.id, motif: req.body.motif })]);
      return { statut: i.statut === "validee" ? "a_rembourser" : "annulee" };
    }),
  );

  // ---------- Routes publiques de la Marketplace ----------

  /** Jamais de quantité, de seuil chiffré, de fournisseur, de prix d'achat ni de lieu : la liste des colonnes est fermée. */
  const versPublic = async (c: Client, k: Campagne) => {
    const q = await quantites(c, k);
    const { rows: photos } = await c.query("select position from photos_produits where produit_id = $1 order by position", [k.produit_id]);
    return {
      id: k.id, titre: k.titre, texte: k.texte, produit: { id: k.produit_id, nom: k.produit, photos: photos.map((f) => f.position) },
      prix_ttc: Number(k.prix_ttc), acompte_unitaire: Number(k.acompte_unitaire), date_limite: k.date_limite,
      progression: q.progression, seuil_atteint: q.validee >= k.seuil, complet: q.capacite !== null && q.retenue >= q.capacite,
    };
  };
  const OUVERTES = `select k.*, p.nom as produit from campagnes_arrivage k join produits p on p.id = k.produit_id
    where k.entite_id = $1 and k.statut in ('ouverte', 'declenchee') and k.date_limite >= (now() at time zone 'Africa/Douala')::date and k.premiere_reception_le is null`;

  app.get<{ Params: { org: string } }>("/marketplace/:org/campagnes", { config: parMinute(60) }, async (req) =>
    parBoutique(pool, req.params.org, async (c, b) => {
      await expirerPrecommandes(c);
      const { rows } = await c.query(`${OUVERTES} order by k.date_limite, k.cree_le limit 200`, [b.branche]);
      const campagnes = [];
      for (const k of rows) campagnes.push(await versPublic(c, k));
      return { branche: b.nom, campagnes };
    }),
  );

  app.get<{ Params: { org: string; id: string } }>("/marketplace/:org/campagnes/:id", { config: parMinute(60) }, async (req) => {
    if (!UUID.test(req.params.id)) throw new ErreurApi(404, "introuvable");
    return parBoutique(pool, req.params.org, async (c, b) => {
      await expirerPrecommandes(c);
      const { rows: [k] } = await c.query(`${OUVERTES} and k.id = $2`, [b.branche, req.params.id]);
      if (!k) throw new ErreurApi(404, "introuvable");
      return { ...(await versPublic(c, k)), delai_solde_jours: k.delai_solde_jours, moyens_paiement: MOYENS, conditions: conditionsPrecommande(k.delai_solde_jours) };
    });
  });

  app.post<{ Params: { org: string; id: string }; Body: { nomClient: string; telephone: string; quantite: number; moyenPaiement: string; conditionsAcceptees: boolean } }>(
    "/marketplace/:org/campagnes/:id/inscriptions", {
      config: parMinute(options.commandesParMinute),
      schema: {
        body: {
          type: "object", required: ["nomClient", "telephone", "quantite", "moyenPaiement", "conditionsAcceptees"],
          properties: {
            nomClient: { type: "string", minLength: 2, maxLength: 200 }, telephone: { type: "string", minLength: 1, maxLength: 30 },
            quantite: { type: "integer", minimum: 1, maximum: 10000 }, moyenPaiement: { type: "string", enum: MOYENS },
            conditionsAcceptees: { type: "boolean" },
          },
        },
      },
    }, async (req, reponse) => {
      const b = req.body;
      if (!UUID.test(req.params.id)) throw new ErreurApi(404, "introuvable");
      if (b.conditionsAcceptees !== true) throw new ErreurApi(400, "conditions_non_acceptees");
      const nom = b.nomClient.trim();
      if (nom.length < 2) throw new ErreurApi(400, "donnees_invalides");
      const telephone = normaliserTelephone(b.telephone);
      if (!/^[0-9]{8,15}$/.test(telephone)) throw new ErreurApi(400, "telephone_invalide");
      const jeton = randomBytes(32).toString("base64url");
      const r = await parBoutique(pool, req.params.org, async (c, bq) => {
        await expirerPrecommandes(c);
        const { rows: [k] } = await c.query("select * from campagnes_arrivage where id = $1 and entite_id = $2 for update", [req.params.id, bq.branche]);
        if (!k) throw new ErreurApi(404, "introuvable");
        if (!accepteInscriptions(k)) throw new ErreurApi(409, "campagne_close");
        const q = await quantites(c, k);
        if (q.capacite !== null && q.retenue + b.quantite > q.capacite) throw new ErreurApi(409, "campagne_complete", { disponible: Math.max(q.capacite - q.retenue, 0) });
        const tiersId = await ficheClient(c, bq, k.lieu_id, nom, telephone);
        const m = calculerLigne(b.quantite, Number(k.prix_ht), 0, Number(k.taux_taxe));
        const total = m.ht + m.taxes;
        const acompte = b.quantite * Number(k.acompte_unitaire);
        const conditions = conditionsPrecommande(k.delai_solde_jours);
        const reference = await prochainNumero(c, `PRE-${anneeDouala()}`);
        const { rows: [i] } = await c.query(
          `insert into inscriptions_precommande (organisation_id, campagne_id, tiers_id, reference, jeton_suivi_hache, nom_client, telephone, quantite,
             moyen_paiement, total_ttc, acompte, conditions_texte, conditions_acceptees_le, expire_le)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now() + ($13::int * interval '1 minute')) returning statut, expire_le`,
          [bq.org, k.id, tiersId, reference, hacherJeton(jeton), nom, telephone, b.quantite, b.moyenPaiement, total, acompte, conditions, DUREE_RESERVATION_MINUTES],
        );
        return {
          reference, jeton, suivi: `/marketplace/${bq.org}/precommandes/${reference}?jeton=${jeton}`,
          statut: i.statut, quantite: b.quantite, total_ttc: total, acompte, moyen_paiement: b.moyenPaiement, expire_le: i.expire_le, conditions,
        };
      });
      return reponse.status(201).send(r);
    },
  );

  /** Ni nom ni téléphone : le lien de suivi peut circuler. Les étapes ne disent ni le fournisseur, ni le transitaire, ni les notes. */
  app.get<{ Params: { org: string; reference: string }; Querystring: { jeton?: string } }>("/marketplace/:org/precommandes/:reference", {
    config: parMinute(60),
    schema: { querystring: { type: "object", properties: { jeton: { type: "string", maxLength: 100 } } } },
  }, async (req) => {
    const jeton = req.query.jeton ?? "";
    if (!REFERENCE.test(req.params.reference) || !JETON.test(jeton)) throw new ErreurApi(404, "introuvable");
    return parBoutique(pool, req.params.org, async (c, b) => {
      await expirerPrecommandes(c);
      const { rows: [i] } = await c.query(
        `select i.*, row_to_json(k) as campagne, p.nom as produit from inscriptions_precommande i
         join campagnes_arrivage k on k.id = i.campagne_id join produits p on p.id = k.produit_id
         where i.reference = $1 and i.jeton_suivi_hache = $2 and k.entite_id = $3`,
        [req.params.reference, hacherJeton(jeton), b.branche],
      );
      if (!i) throw new ErreurApi(404, "introuvable");
      const k = i.campagne as Campagne;
      const q = await quantites(c, k);
      const etapes: { etape: string; date: string }[] = [];
      if (k.commande_achat_id) {
        const { rows: [a] } = await c.query("select (approuve_le at time zone 'Africa/Douala')::date::text as approuve from commandes_achat where id = $1", [k.commande_achat_id]);
        if (a?.approuve) {
          etapes.push({ etape: "commandee", date: a.approuve });
          const { rows } = await c.query(
            "select etape, date_etape::text as date from etapes_achat where commande_id = $1 and etape <> 'commandee' order by date_etape, cree_le", [k.commande_achat_id],
          );
          etapes.push(...rows);
        }
      }
      const { rows: [w] } = await c.query(
        "select reference, statut, total_ttc, acompte from commandes_web where inscription_id = $1 and statut <> 'annulee' order by cree_le desc limit 1", [i.id],
      );
      return {
        reference: i.reference, statut: i.statut, motif: i.motif ? MOTIFS[i.motif] : null,
        campagne: { titre: k.titre, statut: k.statut, date_limite: k.date_limite, progression: q.progression },
        produit: i.produit, quantite: i.quantite, total_ttc: Number(i.total_ttc), acompte: Number(i.acompte), moyen_paiement: i.moyen_paiement,
        ...(i.statut === "en_attente" ? { expire_le: i.expire_le } : {}),
        etapes,
        ...(i.statut === "servie" ? { solde: { montant: Number(i.total_ttc) - Number(i.acompte), avant: i.solde_avant } } : {}),
        ...(w ? { commande_solde: { reference: w.reference, statut: w.statut, montant_a_payer: Number(w.total_ttc) - Number(w.acompte) } } : {}),
        conditions: i.conditions_texte,
      };
    });
  });

  /** Le solde se paie par une commande en ligne qui porte l'acompte ; la réservation reste sur l'inscription. */
  app.post<{ Params: { org: string; reference: string }; Body: { jeton: string; modeLivraison: string; zoneId?: string; pointRelaisId?: string; adresse?: string; moyenPaiement: string } }>(
    "/marketplace/:org/precommandes/:reference/solde", {
      config: parMinute(options.commandesParMinute),
      schema: {
        body: {
          type: "object", required: ["jeton", "modeLivraison", "moyenPaiement"],
          properties: {
            jeton: { type: "string", maxLength: 100 }, modeLivraison: { type: "string", maxLength: 30 }, zoneId: uuid, pointRelaisId: uuid,
            adresse: { type: "string", maxLength: 500 }, moyenPaiement: { type: "string", enum: MOYENS },
          },
        },
      },
    }, async (req, reponse) => {
      const b = req.body;
      if (!REFERENCE.test(req.params.reference) || !JETON.test(b.jeton)) throw new ErreurApi(404, "introuvable");
      const adresse = verifierLivraison(b);
      const jeton = randomBytes(32).toString("base64url");
      const r = await parBoutique(pool, req.params.org, async (c, bq) => {
        await expirerPrecommandes(c);
        const { rows: [x] } = await c.query(
          `select i.id from inscriptions_precommande i join campagnes_arrivage k on k.id = i.campagne_id
           where i.reference = $1 and i.jeton_suivi_hache = $2 and k.entite_id = $3`,
          [req.params.reference, hacherJeton(b.jeton), bq.branche],
        );
        if (!x) throw new ErreurApi(404, "introuvable");
        // La commande du solde avant l'inscription : le même ordre que la réception d'un avis de paiement.
        const { rows: anciennes } = await c.query("select id, reference, statut from commandes_web where inscription_id = $1 and statut <> 'annulee' order by cree_le for update", [x.id]);
        const { rows: [i] } = await c.query("select *, solde_avant > now() as dans_le_delai from inscriptions_precommande where id = $1 for update", [x.id]);
        // Un solde déjà payé ne se paie pas deux fois ; une commande remplacée puis payée trop tard, elle, est à rembourser.
        if (i.statut !== "servie" || !i.dans_le_delai || anciennes.some((w) => ["payee", "facturee", "expediee", "livree"].includes(w.statut))) {
          throw new ErreurApi(409, "solde_impossible");
        }
        const frais = await fraisLivraison(c, bq.branche, b);
        for (const w of anciennes.filter((y) => y.statut === "reservee")) {
          await c.query("update commandes_web set statut = 'annulee', motif = 'Remplacée par un autre choix de livraison', traite_le = now() where id = $1", [w.id]);
          await publierEvenement(c, "commande_web.annulee", { id: w.id, reference: w.reference, motif: "remplacee" });
        }
        const { rows: [k] } = await c.query("select * from campagnes_arrivage where id = $1", [i.campagne_id]);
        const m = calculerLigne(i.quantite, Number(k.prix_ht), 0, Number(k.taux_taxe));
        const totalTtc = m.ht + m.taxes + frais;
        const reference = await prochainNumero(c, `WEB-${anneeDouala()}`);
        const { rows: [w] } = await c.query(
          `insert into commandes_web (organisation_id, entite_id, lieu_id, tiers_id, reference, jeton_suivi_hache, nom_client, telephone, mode_livraison,
             zone_id, point_relais_id, adresse, moyen_paiement, frais_livraison, total_ht, total_ttc, expire_le, inscription_id, acompte)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) returning id, expire_le`,
          [bq.org, bq.branche, k.lieu_id, i.tiers_id, reference, hacherJeton(jeton), i.nom_client, i.telephone, b.modeLivraison,
            b.zoneId ?? null, b.pointRelaisId ?? null, adresse, b.moyenPaiement, frais, m.ht, totalTtc, i.solde_avant, i.id, i.acompte],
        );
        await c.query(
          `insert into lignes_commande_web (organisation_id, commande_id, produit_id, quantite, prix_unitaire_ht, prix_unitaire_ttc, taux_taxe, total_ht, total_ttc)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [bq.org, w.id, k.produit_id, i.quantite, k.prix_ht, k.prix_ttc, k.taux_taxe, m.ht, m.ht + m.taxes],
        );
        await publierEvenement(c, "commande_web.creee", { id: w.id, reference, total_ttc: totalTtc });
        return {
          commande: {
            reference, jeton, suivi: `/marketplace/${bq.org}/commandes/${reference}?jeton=${jeton}`,
            total_ttc: totalTtc, acompte: Number(i.acompte), montant_a_payer: totalTtc - Number(i.acompte), frais_livraison: frais, expire_le: w.expire_le,
          },
        };
      });
      return reponse.status(201).send(r);
    },
  );
}

const SELECT_CAMPAGNE = `select k.id, k.entite_id, k.numero, k.titre, k.texte, k.statut, k.origine, k.lieu_id, k.produit_id, k.fournisseur_id,
    k.prix_ht, k.taux_taxe::float as taux_taxe, k.prix_ttc, k.acompte_type, k.acompte_valeur, k.acompte_unitaire, k.seuil, k.quantite_max,
    k.date_limite, k.delai_solde_jours, k.prix_achat_prevu, k.motif_annulation, k.declenchee_le, k.premiere_reception_le, k.commande_achat_id, k.cree_le,
    p.nom as produit, coalesce(lc.nom_public, e.nom) as lieu, t.nom as fournisseur,
    case when a.id is null then null else json_build_object('id', a.id, 'numero', a.numero, 'statut', a.statut) end as commande_achat,
    coalesce(s.validee, 0) as quantite_validee, coalesce(s.inscrits, 0) as inscrits, coalesce(s.conserves, 0) as conserves,
    coalesce(m.encaisses, 0) as acomptes_encaisses, coalesce(m.a_rembourser, 0) as a_rembourser, coalesce(m.rembourses, 0) as rembourses
  from campagnes_arrivage k
  join produits p on p.id = k.produit_id
  join entites e on e.id = k.lieu_id
  join tiers t on t.id = k.fournisseur_id
  left join config_canal cc on cc.entite_id = k.entite_id
  left join lieux_canal lc on lc.config_id = cc.id and lc.entite_id = k.lieu_id
  left join commandes_achat a on a.id = k.commande_achat_id
  left join lateral (
    select sum(quantite) filter (where statut in ('validee', 'servie', 'soldee', 'acompte_conserve'))::int as validee,
      count(*) filter (where validee_le is not null)::int as inscrits,
      sum(acompte) filter (where statut = 'acompte_conserve')::int8 as conserves
    from inscriptions_precommande where campagne_id = k.id) s on true
  left join lateral (
    select sum(x.montant) filter (where x.statut in ('reussi', 'a_rembourser', 'rembourse'))::int8 as encaisses,
      sum(x.montant) filter (where x.statut = 'a_rembourser')::int8 as a_rembourser,
      sum(x.montant) filter (where x.statut = 'rembourse')::int8 as rembourses
    from paiements_en_ligne x join inscriptions_precommande y on y.id = x.inscription_id where y.campagne_id = k.id) m on true`;
