import { dansOrganisation } from "../src/base.js";
import { MOT_DE_PASSE, type environnement } from "./outils.js";

type Env = Awaited<ReturnType<typeof environnement>>;

/** Organisation d'essai : boutique GLOMARI ouverte, un point de vente en ligne, une zone et un point relais sur la branche. */
export async function boutique(env: Env) {
  const o = await env.nouvelleOrganisation();
  const G = o.entites.GLOMARI!;
  const org = o.organisationId;
  const api = (methode: string, url: string, corps?: object) => env.api(methode, url, o.jeton, corps);
  const lieu = (await api("POST", "/magasins", { parentId: G, nom: "Mall", type: "point_de_vente" })).corps.id as string;
  // La zone et le point relais sont au nom de la branche : un lieu n'a pas le module transport.
  const zoneId = (await api("POST", "/zones-livraison", { entiteId: G, nom: "Akwa", frais: 1000, delaiJours: 1 })).corps.id as string;
  const relaisId = (await api("POST", "/points-relais", { entiteId: G, nom: "Relais Kotto", adresse: "Carrefour Kotto", commission: 300 })).corps.id as string;
  await api("POST", "/canal-config", { entiteId: G, actif: true });
  await api("POST", "/canal-config/lieux", { entiteId: G, lieuEntiteId: lieu, nomPublic: "GLOMARI Mall Douala" });
  const article = async (code: string, prixVente = 1000, tauxTaxe = 0, stock = 3) => {
    const id = (await api("POST", "/produits", { entiteId: G, code, nom: `Article ${code}`, suiviStock: true, prixVente, tauxTaxe })).corps.id as string;
    if (stock) await api("POST", "/stocks/mouvements", { entiteId: lieu, produitId: id, type: "entree", quantite: stock, coutUnitaire: 400 });
    return id;
  };
  const sql = (texte: string, valeurs: unknown[] = []) => dansOrganisation(env.poolApp, org, (c) => c.query(texte, valeurs));
  const dispo = async (produitId: string) =>
    (await env.api("GET", `/marketplace/${org}/disponibilite?produits=${produitId}`)).corps[0]?.lieux[lieu] as number;
  return { o, G, org, lieu, zoneId, relaisId, api, article, sql, dispo };
}

/** Commande livrée à domicile et payée à la livraison, sauf réglage contraire. */
export const corpsCommande = (b: { lieu: string; zoneId: string }, lignes: Record<string, unknown>[], extra: object = {}) => ({
  lieuId: b.lieu, lignes, nomClient: "Jean Mbarga", telephone: "699 00 00 01", modeLivraison: "domicile", zoneId: b.zoneId,
  adresse: "Bonanjo, rue des Bananiers", moyenPaiement: "a_la_livraison", ...extra,
});

export const commander = (env: Env, org: string, corps: object) => env.api("POST", `/marketplace/${org}/commandes`, undefined, corps);

export const suivre = (env: Env, org: string, commande: { reference: string; jeton: string }) =>
  env.api("GET", `/marketplace/${org}/commandes/${commande.reference}?jeton=${commande.jeton}`);

/** Jeton d'un nouvel utilisateur qui n'a que le rôle donné, sur l'entité donnée. */
export async function utilisateur(env: Env, o: { jeton: string; slug: string }, role: string, entiteId: string): Promise<string> {
  const roles = (await env.api("GET", "/roles", o.jeton)).corps as { id: string; code: string }[];
  const email = `${role}${Math.random().toString(36).slice(2)}@test.cm`;
  await env.api("POST", "/utilisateurs", o.jeton, { email, nom: role, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((r) => r.code === role)!.id });
  return env.connecter(o.slug, email);
}

/** Date du jour à Douala. */
export const jour = () => new Date(Date.now() + 3600000).toISOString().slice(0, 10);
