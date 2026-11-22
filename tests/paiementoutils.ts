import { prestataireFactice, signerAvisFactice } from "../src/paiementenligne.js";
import { boutique, commander, corpsCommande } from "./canaloutils.js";
import { environnement } from "./outils.js";

type Env = Awaited<ReturnType<typeof environnement>>;
export const SECRET = "secret-de-test-du-prestataire-factice";

/** Prestataire factice et débits relevés : la recette fait 20 commandes et 20 paiements d'affilée. */
export const environnementPaiement = () =>
  environnement({ prestatairesPaiement: [prestataireFactice(SECRET)], debitCanal: { commandes: 1000, paiements: 1000 } });

/** Boutique ouverte (son responsable est l'administrateur), identité vendeur réglée, portefeuilles Mobile Money par défaut. */
export async function boutiquePayante(env: Env, { portefeuilles = true } = {}) {
  const b = await boutique(env);
  await b.api("PATCH", `/entites/${b.G}/identite`, { raisonSociale: "GLOMARI Sarl", niu: "M0123456789" });
  const wallets: Record<string, string> = {};
  if (portefeuilles) {
    for (const moyen of ["orange_money", "mtn_momo"]) {
      wallets[moyen] = (await b.api("POST", "/portefeuilles", { entiteId: b.G, nom: `Compte ${moyen}`, type: moyen })).corps.id as string;
      await b.api("PUT", "/portefeuilles/defauts", { entiteId: b.G, moyen, portefeuilleId: wallets[moyen] });
    }
  }
  return { ...b, portefeuilles: wallets };
}

export type Commande = { reference: string; jeton: string; total_ttc: number };

/** Commande d'un article, payée par Mobile Money (Orange par défaut), livrée à domicile sauf réglage contraire. */
export async function commandeMobile(env: Env, b: { org: string; lieu: string; zoneId: string }, produitId: string, quantite = 1, extra: object = {}): Promise<Commande> {
  const r = await commander(env, b.org, corpsCommande(b, [{ produitId, quantite }], { moyenPaiement: "orange_money", ...extra }));
  if (r.statut !== 201) throw new Error(`commande refusée : ${JSON.stringify(r.corps)}`);
  return r.corps;
}

export const payer = (env: Env, org: string, c: { reference: string; jeton: string }) =>
  env.api("POST", `/marketplace/${org}/commandes/${c.reference}/payer`, undefined, { jeton: c.jeton });

/** Envoie un avis au corps brut ; signé avec le bon secret, sauf signature imposée (null : sans signature). */
export async function avis(env: Env, org: string, corps: object, signature?: string | null, prestataire = "factice") {
  const s = signerAvisFactice(SECRET, corps);
  const r = await env.app.inject({
    method: "POST", url: `/paiements/avis/${prestataire}/${org}`, payload: s.corpsBrut,
    headers: { "content-type": "application/json", ...(signature === null ? {} : { "x-signature": signature ?? s.signature }) },
  });
  return { statut: r.statusCode, corps: JSON.parse(r.body) };
}

type Sql = (texte: string, valeurs?: unknown[]) => Promise<{ rows: Record<string, any>[] }>;

/** Référence du dernier paiement lancé pour la commande. */
export async function referencePaiement(b: { sql: Sql }, reference: string): Promise<string> {
  const { rows: [p] } = await b.sql(
    "select p.reference_prestataire from paiements_en_ligne p join commandes_web w on w.id = p.commande_id where w.reference = $1 order by p.lance_le desc limit 1",
    [reference],
  );
  return p!.reference_prestataire as string;
}

/** Lance le paiement puis envoie l'avis de réussite du montant exact. */
export async function payerEtConfirmer(env: Env, b: { org: string; sql: Sql }, c: Commande) {
  const lance = await payer(env, b.org, c);
  if (lance.statut !== 201) throw new Error(`lancement refusé : ${JSON.stringify(lance.corps)}`);
  return avis(env, b.org, { reference_prestataire: await referencePaiement(b, c.reference), statut: "reussi", montant: c.total_ttc });
}
