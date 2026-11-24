import { prestataireMessagesFactice } from "../src/messages.js";
import { prestataireFactice } from "../src/paiementenligne.js";
import { commander, corpsCommande } from "./canaloutils.js";
import { environnement } from "./outils.js";
import { boutiquePayante, payerEtConfirmer, SECRET } from "./paiementoutils.js";

/** Prestataire de paiement et prestataire de messages factices : aucun appel réseau. */
export async function environnementMessages(debits: { codes?: number; connexions?: number } = {}) {
  const factice = prestataireMessagesFactice();
  const env = await environnement({
    prestatairesPaiement: [prestataireFactice(SECRET)], prestataireMessages: factice,
    debitCanal: { commandes: 1000, paiements: 1000, codes: 1000, connexions: 1000, ...debits },
  });
  return { ...env, factice };
}
type EnvM = Awaited<ReturnType<typeof environnementMessages>>;

/** Une heure de Douala, dans n jours. Par défaut demain à 10 h : tout message déjà dû part. */
export function aDouala(heure = 10, jours = 1, minutes = 0): Date {
  const jour = new Date(Date.now() + 3600_000 + jours * 86_400_000).toISOString().slice(0, 10);
  return new Date(`${jour}T${String(heure).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00+01:00`);
}

/** Boutique GLOMARI ouverte et payante, un article à 24 000 FCFA (25 000 avec la livraison), envoi et lecture des messages. */
export async function magasinMessages(env: EnvM) {
  const b = await boutiquePayante(env);
  const produit = await b.article("VENT", 24000, 0, 20);
  const envoyer = (maintenant = aDouala()) => env.app.pousserMessages(maintenant, b.org);
  /** Les messages remis au prestataire factice depuis le dernier vidage. */
  const recus = () => [...env.factice.envoyes];
  const vider = () => { env.factice.envoyes.length = 0; env.factice.enPanne = false; };
  const enBase = async (type?: string) => (await b.sql(
    "select * from envois_messages where organisation_id = org_courante() and ($1::text is null or type = $1) order by cree_le, cle", [type ?? null],
  )).rows;
  const journal = async (jeton = b.o.jeton) => env.api("GET", `/messages?brancheId=${b.G}`, jeton);
  const commandeDe = async (reference: string) => (await b.sql("select id, colis_id, tiers_id from commandes_web where reference = $1", [reference])).rows[0]!;
  const colisDe = async (id: string) => (await b.sql("select * from colis where id = $1", [id])).rows[0]!;

  /** Commande payée à la livraison puis confirmée : son colis porte le montant à encaisser. */
  const commandeLivraison = async (extra: object = {}, lignes: object[] = [{ produitId: produit, quantite: 1 }]) => {
    const r = await commander(env, b.org, corpsCommande(b, lignes as Record<string, unknown>[], extra));
    if (r.statut !== 201) throw new Error(`commande refusée : ${JSON.stringify(r.corps)}`);
    const w = await commandeDe(r.corps.reference);
    const c = await b.api("POST", `/commandes-web/${w.id}/confirmer`);
    if (c.statut !== 200) throw new Error(`confirmation refusée : ${JSON.stringify(c.corps)}`);
    return { ...r.corps, id: w.id as string, colisId: c.corps.colis.id as string, tiersId: w.tiers_id as string };
  };
  /** Commande payée par Mobile Money (prestataire factice) : facture et colis créés à l'avis de paiement. */
  const commandePayee = async (lignes: object[] = [{ produitId: produit, quantite: 1 }], extra: object = {}) => {
    const r = await commander(env, b.org, corpsCommande(b, lignes as Record<string, unknown>[], { moyenPaiement: "orange_money", ...extra }));
    if (r.statut !== 201) throw new Error(`commande refusée : ${JSON.stringify(r.corps)}`);
    const a = await payerEtConfirmer(env, b, r.corps);
    if (a.corps.statut !== "facturee") throw new Error(`commande non facturée : ${JSON.stringify(a.corps)}`);
    const w = await commandeDe(r.corps.reference);
    return { ...r.corps, id: w.id as string, colisId: w.colis_id as string, tiersId: w.tiers_id as string };
  };
  const etape = (colisId: string, statut: string, note?: string) => b.api("POST", `/colis/${colisId}/etape`, { statut, ...(note ? { note } : {}) });
  /** Remise au client avec le code du colis et le montant exact à encaisser. */
  const livrer = async (colisId: string) => {
    const k = await colisDe(colisId);
    if (k.statut !== "en_livraison") await etape(colisId, "en_livraison");
    const r = await b.api("POST", `/colis/${colisId}/livraison`, { code: k.code_confirmation, recuPar: "Le client", encaisse: Number(k.a_encaisser) });
    if (r.statut !== 200) throw new Error(`livraison refusée : ${JSON.stringify(r.corps)}`);
  };
  return { ...b, produit, envoyer, recus, vider, enBase, journal, commandeDe, colisDe, commandeLivraison, commandePayee, etape, livrer };
}
export type MM = Awaited<ReturnType<typeof magasinMessages>>;
