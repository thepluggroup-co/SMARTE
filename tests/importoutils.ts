import { dansOrganisation } from "../src/base.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

type Env = Awaited<ReturnType<typeof environnement>>;

/** Date du jour à Douala. */
export const aujourdhui = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);

/**
 * GLOMARI prêt pour les achats à l'import : dépôt avec le module de stock, comptabilité initialisée, fournisseur de la branche,
 * article catégorisé et portefeuille bancaire approvisionné (50 000 000 FCFA par défaut).
 */
export async function magasinImport(env: Env, { solde = 50_000_000 } = {}) {
  const o = await env.nouvelleOrganisation();
  const G = o.entites.GLOMARI!;
  const api = (methode: string, url: string, corps?: object, jeton = o.jeton) => env.api(methode, url, jeton, corps);
  const depot = (await api("POST", "/entites", { parentId: G, code: "DEPOT", nom: "Dépôt Bonabéri", type: "entrepot" })).corps.id as string;
  await api("PUT", `/entites/${depot}/modules/achats_stocks`, { actif: true });
  if ((await api("POST", "/compta/initialisation", { brancheId: G })).statut !== 200) throw new Error("initialisation comptable refusée");
  const fournisseurId = (await api("POST", "/tiers", { type: "entreprise", nom: "Usine Guangzhou", entiteId: G })).corps.id as string;
  const categorieId = (await api("POST", "/categories-articles", { entiteId: G, nom: "Électroménager" })).corps.id as string;
  const article = async (code: string, extra: object = {}, categorie: string | null = categorieId) => {
    const r = await api("POST", "/produits", { entiteId: G, code, nom: `Article ${code}`, suiviStock: true, ...extra });
    if (r.statut !== 201) throw new Error(`article refusé : ${JSON.stringify(r.corps)}`);
    if (categorie) await api("PUT", `/produits/${r.corps.id}/classement`, { categorieId: categorie });
    return r.corps.id as string;
  };
  const produitId = await article("MIXEUR", { prixVente: 25000 });
  const portefeuille = async (nom: string, soldeInitial: number, entiteId = G, type = "banque") =>
    (await api("POST", "/portefeuilles", { entiteId, nom, type, soldeInitial })).corps.id as string;
  const banque = await portefeuille("Banque Afriland", solde);
  const roles = (await api("GET", "/roles")).corps as { id: string; code: string }[];
  const compte = async (role: string, entiteId = G) => {
    const email = `${role}${Math.random().toString(36).slice(2)}@test.cm`;
    const u = await api("POST", "/utilisateurs", { email, nom: role, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((r) => r.code === role)!.id });
    if (u.statut !== 201) throw new Error(`compte refusé : ${JSON.stringify(u.corps)}`);
    return { id: u.corps.id as string, jeton: await env.connecter(o.slug, email) };
  };
  const solde_ = async (portefeuilleId = banque) => (await api("GET", `/portefeuilles/${portefeuilleId}/mouvements`)).corps.solde as number;
  const sql = (texte: string, valeurs: unknown[] = []) => dansOrganisation(env.poolAdmin, o.organisationId, (c) => c.query(texte, valeurs));
  return { ...o, G, depot, api, fournisseurId, categorieId, article, produitId, portefeuille, banque, compte, solde: solde_, sql };
}
export type M = Awaited<ReturnType<typeof magasinImport>>;

/** Bon de commande du jour au dépôt, approuvé par l'administrateur. */
export async function commandeApprouvee(o: M, lignes: object[], extra: object = {}) {
  const c = await o.api("POST", "/achats/commandes", { entiteId: o.depot, fournisseurId: o.fournisseurId, date: aujourdhui(), lignes, ...extra });
  if (c.statut !== 201) throw new Error(`commande refusée : ${JSON.stringify(c.corps)}`);
  const a = await o.api("POST", `/achats/commandes/${c.corps.id}/approbation`);
  if (a.statut !== 200) throw new Error(`approbation refusée : ${JSON.stringify(a.corps)}`);
  return { ...c.corps, approbation: a.corps } as Record<string, any>;
}

/**
 * Facture du fabricant reliée à la commande, au compte 601. Validée par défaut (motif d'écart fourni, la marchandise
 * pouvant ne pas être reçue), par l'administrateur ou par la personne du jeton donné.
 */
export async function factureFournisseur(o: M, commandeId: string, montant: number, { valider = true, jeton = o.jeton, motifEcart = "Facture du fabricant avant réception" } = {}) {
  const f = await o.api("POST", "/fournisseurs/factures", {
    entiteId: o.G, fournisseurId: o.fournisseurId, numeroFournisseur: `PI-${Math.random().toString(36).slice(2, 10)}`, date: aujourdhui(),
    commandeId, niu: "M0123", lignes: [{ designation: "Marchandises importées", compte: "601", montantHt: montant }],
  });
  if (f.statut !== 201) throw new Error(`facture refusée : ${JSON.stringify(f.corps)}`);
  const validation = valider ? await o.api("POST", `/fournisseurs/factures/${f.corps.id}/validation`, motifEcart ? { motifEcart } : undefined, jeton) : null;
  return { id: f.corps.id as string, validation };
}

/** Acompte versé depuis la banque de la branche, à la date du jour. */
export const verserAcompte = (o: M, commandeId: string, montant: number, extra: object = {}, jeton = o.jeton) =>
  o.api("POST", `/achats/commandes/${commandeId}/acomptes`, { portefeuilleId: o.banque, montant, date: aujourdhui(), ...extra }, jeton);

/** Taux de change saisi par la comptabilité, pour le jour donné. */
export const tauxDuJour = (o: M, devise: string, taux: number, jour = aujourdhui()) => o.api("PUT", "/devises/taux", { devise, jour, taux });
