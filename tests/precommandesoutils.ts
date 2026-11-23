import { avis, boutiquePayante, payer, referencePaiement, type environnementPaiement } from "./paiementoutils.js";

type Env = Awaited<ReturnType<typeof environnementPaiement>>;
type Sql = (texte: string, valeurs?: unknown[]) => Promise<{ rows: Record<string, any>[] }>;

/** Date de Douala dans n jours. */
export const dansJours = (n: number) => new Date(Date.now() + 3600000 + n * 86400000).toISOString().slice(0, 10);

export interface OptionsCampagne {
  prixTtc?: number; tauxTaxe?: number; acompteType?: "montant" | "pourcentage"; acompteValeur?: number; seuil?: number;
  quantiteMax?: number; jours?: number; delaiSoldeJours?: number; prixAchatPrevu?: number; portefeuilles?: boolean;
}

/** Boutique payante, fournisseur, article sans stock et campagne : 85 000 FCFA, acompte 30 %, seuil 5, date limite dans 10 jours. */
export async function campagneEssai(env: Env, o: OptionsCampagne = {}) {
  const b = await boutiquePayante(env, { portefeuilles: o.portefeuilles ?? true });
  const fournisseurId = (await b.api("POST", "/tiers", { type: "entreprise", nom: "Usine Shenzhen" })).corps.id as string;
  const produitId = await b.article("ROBOT", 50000, o.tauxTaxe ?? 0, 0);
  const corps = {
    entiteId: b.G, lieuId: b.lieu, produitId, fournisseurId, titre: "Robot pâtissier Pro", prixTtc: o.prixTtc ?? 85000,
    acompteType: o.acompteType ?? "pourcentage", acompteValeur: o.acompteValeur ?? 30, seuil: o.seuil ?? 5, dateLimite: dansJours(o.jours ?? 10),
    delaiSoldeJours: o.delaiSoldeJours ?? 7, prixAchatPrevu: o.prixAchatPrevu ?? 40000, ...(o.quantiteMax ? { quantiteMax: o.quantiteMax } : {}),
  };
  const r = await b.api("POST", "/precommandes/campagnes", corps);
  if (r.statut !== 201) throw new Error(`campagne refusée : ${JSON.stringify(r.corps)}`);
  return { ...b, fournisseurId, produitId, corpsCampagne: corps, campagne: r.corps as Record<string, any> };
}
export type C = Awaited<ReturnType<typeof campagneEssai>>;

export type Inscription = { reference: string; jeton: string; acompte: number; total_ttc: number; quantite: number };

export const inscrire = (env: Env, org: string, campagneId: string, corps: object = {}) =>
  env.api("POST", `/marketplace/${org}/campagnes/${campagneId}/inscriptions`, undefined, {
    nomClient: "Awa Ngono", telephone: "699 00 00 02", quantite: 1, moyenPaiement: "orange_money", conditionsAcceptees: true, ...corps,
  });

export const lancerAcompte = (env: Env, org: string, i: { reference: string; jeton: string }) =>
  env.api("POST", `/marketplace/${org}/precommandes/${i.reference}/payer`, undefined, { jeton: i.jeton });

/** Référence du dernier paiement lancé pour l'inscription. */
export async function referenceAcompte(b: { sql: Sql }, reference: string): Promise<string> {
  const { rows: [p] } = await b.sql(
    "select p.reference_prestataire from paiements_en_ligne p join inscriptions_precommande i on i.id = p.inscription_id where i.reference = $1 order by p.lance_le desc limit 1",
    [reference],
  );
  return p!.reference_prestataire as string;
}

export const avisAcompte = async (env: Env, b: { org: string; sql: Sql }, i: Inscription, ref?: string) =>
  avis(env, b.org, { reference_prestataire: ref ?? await referenceAcompte(b, i.reference), statut: "reussi", montant: i.acompte });

/** Lance le paiement de l'acompte puis envoie l'avis signé de réussite du montant exact. */
export async function payerAcompte(env: Env, b: { org: string; sql: Sql }, i: Inscription) {
  const l = await lancerAcompte(env, b.org, i);
  if (l.statut !== 201) throw new Error(`lancement refusé : ${JSON.stringify(l.corps)}`);
  return avisAcompte(env, b, i);
}

/** Inscription payée et validée ; téléphone différent par défaut pour chaque client. */
export async function inscrireEtPayer(env: Env, b: C, quantite = 1, telephone = `6990${Math.floor(Math.random() * 1e5).toString().padStart(5, "0")}`): Promise<Inscription> {
  const r = await inscrire(env, b.org, b.campagne.id, { quantite, telephone });
  if (r.statut !== 201) throw new Error(`inscription refusée : ${JSON.stringify(r.corps)}`);
  const a = await payerAcompte(env, b, r.corps);
  if (a.corps.statut !== "validee") throw new Error(`acompte non validé : ${JSON.stringify(a.corps)}`);
  return r.corps;
}

export const suivrePrecommande = (env: Env, org: string, i: { reference: string; jeton: string }) =>
  env.api("GET", `/marketplace/${org}/precommandes/${i.reference}?jeton=${i.jeton}`);

export const campagneEnBase = async (b: C) => (await b.sql("select * from campagnes_arrivage where id = $1", [b.campagne.id])).rows[0]!;
export const inscriptionEnBase = async (b: { sql: Sql }, reference: string) =>
  (await b.sql("select * from inscriptions_precommande where reference = $1", [reference])).rows[0]!;

/** Approbation par l'administrateur, ou par la personne du jeton donné. */
export const approuver = (env: Env, b: C, commandeId: string, jeton = b.o.jeton) =>
  env.api("POST", `/achats/commandes/${commandeId}/approbation`, jeton);

/** Le bon de commande relié à la campagne. */
export const commandeAchat = async (b: C) => (await campagneEnBase(b)).commande_achat_id as string;

/** Réception de la ligne de l'article de la campagne. */
export async function recevoir(b: C, commandeId: string, quantite: number, cloturer = false) {
  const d = await b.api("GET", `/achats/commandes/${commandeId}`);
  const ligne = d.corps.lignes.find((l: { produit_id: string }) => l.produit_id === b.produitId);
  return b.api("POST", `/achats/commandes/${commandeId}/receptions`, { lignes: [{ ligneId: ligne.id, quantite }], cloturer });
}

export const choisirSolde = (env: Env, org: string, i: { reference: string; jeton: string }, corps: object = {}) =>
  env.api("POST", `/marketplace/${org}/precommandes/${i.reference}/solde`, undefined, { jeton: i.jeton, modeLivraison: "retrait_magasin", moyenPaiement: "orange_money", ...corps });

/** Lance le paiement de la commande du solde puis envoie l'avis signé du montant à payer. */
export async function payerSolde(env: Env, b: { org: string; sql: Sql }, commande: { reference: string; jeton: string; montant_a_payer: number }) {
  const l = await payer(env, b.org, commande);
  if (l.statut !== 201) throw new Error(`lancement du solde refusé : ${JSON.stringify(l.corps)}`);
  return avis(env, b.org, { reference_prestataire: await referencePaiement(b, commande.reference), statut: "reussi", montant: commande.montant_a_payer });
}

export const balayer = (env: Env, org: string) => env.app.executerTaches(org);

/** Les événements publiés d'un type, pour cette organisation. */
export const evenements = async (b: { sql: Sql }, type: string) =>
  (await b.sql("select charge from evenements where organisation_id = org_courante() and type = $1 order by cree_le", [type])).rows.map((r) => r.charge);
