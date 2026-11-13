import { afterAll, describe, expect, it } from "vitest";
import { commission } from "../src/rapports.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
const MOIS = new Date(Date.now() + 3600_000).toISOString().slice(0, 7);

async function magasin() {
  const o = await env.nouvelleOrganisation();
  const G = o.entites.GLOMARI!;
  const M = (await env.api("POST", "/magasins", o.jeton, { parentId: G, nom: "Akwa", type: "point_de_vente" })).corps.id as string;
  const article = async (code: string, prixVente: number, tauxTaxe: number, seuilAlerte = 0) => {
    const id = (await env.api("POST", "/produits", o.jeton, { entiteId: G, code, nom: `Article ${code}`, suiviStock: true, prixVente, tauxTaxe, seuilAlerte })).corps.id as string;
    await env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: M, produitId: id, type: "entree", quantite: 20, coutUnitaire: 100 });
    return id;
  };
  const A = await article("A", 1000, 10), B = await article("B", 500, 0, 19);
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const compte = async (role: string, entiteId: string, nom = role) => {
    const email = `${role}${Math.random().toString(36).slice(2)}@test.cm`;
    const u = await env.api("POST", "/utilisateurs", o.jeton, { email, nom, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((r: { code: string }) => r.code === role).id });
    return { id: u.corps.id as string, jeton: await env.connecter(o.slug, email) };
  };
  const caisse = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: G, nom: "Caisse", type: "especes", soldeInitial: 0 })).corps.id as string;
  await env.api("PUT", "/portefeuilles/defauts", o.jeton, { entiteId: G, moyen: "especes", portefeuilleId: caisse });
  const ouvrir = (jeton: string) => env.api("POST", "/caisse/ouverture", jeton, { entiteId: M, fondOuverture: 0 });
  await ouvrir(o.jeton);
  const vendre = (jeton: string, corps: object) => env.api("POST", "/caisse/ventes", jeton, { entiteId: M, paiements: [], ...corps });
  const especes = (montant: number) => [{ moyen: "especes", montant }];
  const stock = async (produitId: string) => (await env.api("GET", "/caisse", o.jeton)).corps.ouvertes[0].stocks[produitId];
  const solde = async () => (await env.api("GET", "/portefeuilles", o.jeton)).corps.find((w: { id: string }) => w.id === caisse).solde;
  return { ...o, G, M, A, B, compte, ouvrir, vendre, especes, stock, solde };
}

describe("retours de caisse", () => {
  it("retourne une partie d'une vente : stock, avarié, remboursement, points, ticket d'origine figé", async () => {
    const o = await magasin();
    await env.api("PUT", `/entites/${o.G}/fidelite`, o.jeton, { actif: true, fcfaParPoint: 100, valeurPoint: 1 });
    const client = (await env.api("POST", "/caisse/clients", o.jeton, { entiteId: o.M, nom: "Madame Ngo", telephone: "699112233" })).corps.id;
    const v = await o.vendre(o.jeton, { tiersId: client, lignes: [{ produitId: o.A, quantite: 4 }, { produitId: o.B, quantite: 2 }], paiements: o.especes(5400) });
    expect(v.corps).toMatchObject({ total_ttc: 5400, points_gagnes: 54 });
    const url = `/caisse/ventes/${v.corps.id}`;
    const t = (await env.api("GET", url, o.jeton)).corps;
    const [la, lb] = t.lignes;
    expect(t.lignes.map((l: { designation: string; quantite: number; retourne: number; montant_ttc: number }) => [l.designation, l.quantite, l.retourne, l.montant_ttc])).toEqual([["Article A", 4, 0, 4400], ["Article B", 2, 0, 1000]]);
    const retour = (jeton: string, lignes: object[], remboursements: object[], motif = "Le client a changé d'avis") => env.api("POST", `${url}/retours`, jeton, { motif, lignes, remboursements });
    const lignes = [{ ligneId: la.id, quantite: 1, destination: "vente" }, { ligneId: lb.id, quantite: 1, destination: "avarie" }];

    // Droits : le caissier ne fait pas de retour ; le responsable de caisse rend l'argent seul (décision d'Achille).
    const caissier = await o.compte("caissier", o.M);
    expect((await retour(caissier.jeton, lignes, o.especes(1600))).statut).toBe(403);
    const responsable = await o.compte("responsable_magasins", o.M);
    await o.ouvrir(responsable.jeton);
    expect((await retour(responsable.jeton, lignes, o.especes(1500))).corps.erreur).toBe("remboursement_inexact");
    expect((await retour(o.jeton, lignes, o.especes(1500))).corps).toMatchObject({ erreur: "remboursement_inexact", details: { total: 1600 } });
    expect((await retour(o.jeton, [{ ligneId: la.id, quantite: 5, destination: "vente" }], o.especes(5500))).corps).toMatchObject({ erreur: "retour_trop_grand", details: { restant: 4 } });
    expect((await retour(o.jeton, lignes, o.especes(1600), "Non")).statut).toBe(400);
    expect((await retour(o.jeton, lignes, [{ moyen: "mtn_momo", montant: 1600 }])).corps.erreur).toBe("reference_obligatoire");

    const r = await retour(o.jeton, lignes, o.especes(1600));
    expect(r.statut).toBe(201);
    expect(r.corps).toMatchObject({ numero: expect.stringMatching(/^RET-\d{4}-000001$/), total_ttc: 1600, vente: v.corps.numero, points_repris: 16 });
    // Le stock revient ; l'article abîmé est mis de côté comme avarié.
    expect([await o.stock(o.A), await o.stock(o.B)]).toEqual([17, 19]);
    expect((await env.api("GET", "/avaries?statut=constatee", o.jeton)).corps).toEqual([expect.objectContaining({ produit: "Article B", quantite: 1, motif: expect.stringContaining(r.corps.numero) })]);
    expect((await env.api("GET", `/fidelite/client?telephone=699112233&entiteId=${o.M}`, o.jeton)).corps.points).toBe(38);
    // Le reste de la ligne A : le dernier retour prend le montant exact, puis plus rien n'est retournable.
    expect((await retour(o.jeton, [{ ligneId: la.id, quantite: 3, destination: "vente" }], o.especes(3300))).corps).toMatchObject({ total_ttc: 3300, numero: expect.stringMatching(/000002$/) });
    expect((await retour(o.jeton, [{ ligneId: la.id, quantite: 1, destination: "vente" }], o.especes(1100))).corps).toMatchObject({ erreur: "retour_trop_grand", details: { restant: 0 } });
    // Le ticket d'origine n'a pas changé ; les retours ont leurs propres numéros.
    const apres = (await env.api("GET", url, o.jeton)).corps;
    expect(apres).toMatchObject({ total_ttc: 5400, numero: v.corps.numero, annulee_le: null });
    expect(apres.lignes.map((l: { retourne: number; rembourse: number }) => [l.retourne, l.rembourse])).toEqual([[4, 4400], [1, 500]]);
    expect(apres.retours.map((x: { total_ttc: number }) => x.total_ttc)).toEqual([1600, 3300]);
    expect((await env.api("POST", `${url}/annulation`, o.jeton, { motif: "Trop tard" })).corps.erreur).toBe("vente_avec_retour");
    // La caisse et la trésorerie : 5 400 reçus, 4 900 rendus.
    expect((await env.api("GET", "/caisse", o.jeton)).corps.ouvertes[0]).toMatchObject({ especes_nettes: 500, remboursements: [{ moyen: "especes", montant: 4900 }] });
    expect(await o.solde()).toBe(500);
    const autre = await env.nouvelleOrganisation();
    expect((await env.api("GET", url, autre.jeton)).statut).toBe(404);
    expect((await env.api("POST", `${url}/retours`, autre.jeton, { motif: "Tentative", lignes, remboursements: o.especes(1) })).statut).toBe(404);
  });

  it("impute un retour sur le reste dû d'une vente à crédit, sans sortie d'argent", async () => {
    const o = await magasin();
    const client = (await env.api("POST", "/caisse/clients", o.jeton, { entiteId: o.M, nom: "Monsieur Fotso", telephone: "677000111" })).corps.id;
    const v = await o.vendre(o.jeton, { tiersId: client, credit: true, lignes: [{ produitId: o.A, quantite: 2 }], paiements: o.especes(200) });
    expect(v.corps.reste_du).toBe(2000);
    const ligne = (await env.api("GET", `/caisse/ventes/${v.corps.id}`, o.jeton)).corps.lignes[0];
    const responsable = await o.compte("responsable_magasins", o.M);
    await o.ouvrir(responsable.jeton);
    const retour = (remboursements: object[]) => env.api("POST", `/caisse/ventes/${v.corps.id}/retours`, responsable.jeton, { motif: "Article non conforme", lignes: [{ ligneId: ligne.id, quantite: 1, destination: "vente" }], remboursements });
    expect((await retour([{ moyen: "credit", montant: 1100 }])).statut).toBe(201);
    expect((await env.api("GET", `/caisse/ventes/${v.corps.id}`, o.jeton)).corps).toMatchObject({ reste_du: 2000, reste_restant: 900 });
    expect((await env.api("GET", "/creances", o.jeton)).corps).toEqual([expect.objectContaining({ client: "Monsieur Fotso", total: 900 })]);
    expect((await env.api("GET", `/caisse/credits?entiteId=${o.M}`, o.jeton)).corps[0].reste).toBe(900);
    expect((await retour([{ moyen: "credit", montant: 1100 }])).corps).toMatchObject({ erreur: "reglement_trop_eleve", details: { reste: 900 } });
    expect(await o.solde()).toBe(200);
    // Le responsable de caisse, sans droit de trésorerie, rend aussi des espèces : elles sortent de sa caisse et du portefeuille.
    const w = await o.vendre(responsable.jeton, { lignes: [{ produitId: o.B, quantite: 2 }], paiements: o.especes(1000) });
    const lb = (await env.api("GET", `/caisse/ventes/${w.corps.id}`, responsable.jeton)).corps.lignes[0];
    const r = await env.api("POST", `/caisse/ventes/${w.corps.id}/retours`, responsable.jeton, { motif: "Article en double", lignes: [{ ligneId: lb.id, quantite: 1, destination: "vente" }], remboursements: o.especes(500) });
    expect(r.statut).toBe(201);
    expect((await env.api("GET", "/caisse", responsable.jeton)).corps.ouvertes[0]).toMatchObject({ especes_nettes: 500, remboursements: [{ moyen: "especes", montant: 500 }] });
    expect(await o.solde()).toBe(700);
  });
});

describe("rapports stock et ventes", () => {
  it("résume ventes, paiements, stock, marges et restes dus, selon les droits", async () => {
    const o = await magasin();
    const caissier = await o.compte("caissier", o.M, "Awa Caissière");
    await o.ouvrir(caissier.jeton);
    const client = (await env.api("POST", "/caisse/clients", o.jeton, { entiteId: o.M, nom: "Monsieur Fotso", telephone: "677000111" })).corps.id;
    await o.vendre(o.jeton, { lignes: [{ produitId: o.A, quantite: 3 }], paiements: o.especes(4000) }); // 3 300, 700 rendus
    await o.vendre(caissier.jeton, { lignes: [{ produitId: o.B, quantite: 4 }], paiements: [{ moyen: "mtn_momo", montant: 2000, reference: "MM1" }] });
    const v = await o.vendre(o.jeton, { vendeurId: caissier.id, tiersId: client, credit: true, lignes: [{ produitId: o.A, quantite: 2 }], paiements: o.especes(1200) }); // 2 200, reste 1 000
    const ligne = (await env.api("GET", `/caisse/ventes/${v.corps.id}`, o.jeton)).corps.lignes[0];
    await env.api("POST", `/caisse/ventes/${v.corps.id}/retours`, o.jeton, { motif: "Article non conforme", lignes: [{ ligneId: ligne.id, quantite: 1, destination: "vente" }], remboursements: o.especes(1100) });

    const r = (await env.api("GET", "/rapports/ventes-stock", o.jeton)).corps;
    expect(r.meilleures_ventes).toEqual([{ code: "A", nom: "Article A", unite: "pièce", quantite: 4, montant: 4400 }, { code: "B", nom: "Article B", unite: "pièce", quantite: 4, montant: 2000 }]);
    expect(r.ventes_par_vendeur).toEqual([{ nom: "Admin", ventes: 3300, nombre: 1 }, { nom: "Awa Caissière", ventes: 3100, nombre: 2 }]);
    expect(r.ventes_par_caissier).toEqual([{ nom: "Admin", ventes: 4400, nombre: 2 }, { nom: "Awa Caissière", ventes: 2000, nombre: 1 }]);
    expect(r.ventes_par_lieu).toEqual([{ nom: "Akwa", ventes: 6400, nombre: 3 }]);
    // Espèces : 4 000 + 1 200 reçus, 700 rendus, 1 100 remboursés.
    expect(r.paiements_par_moyen).toEqual([{ moyen: "especes", montant: 3400 }, { moyen: "mtn_momo", montant: 2000 }]);
    // Marge = ventes hors taxes moins coût moyen (100 FCFA la pièce).
    expect(r.marges).toEqual([{ code: "A", nom: "Article A", quantite: 4, ventes_ht: 4000, cout: 400, marge: 3600, taux: 90 }, { code: "B", nom: "Article B", quantite: 4, ventes_ht: 2000, cout: 400, marge: 1600, taux: 80 }]);
    expect(r.stock_par_lieu).toEqual([{ entite: "Akwa", articles: 2, quantite: 32, valeur: 3200 }]);
    expect(r.alertes).toEqual([{ entite: "Akwa", code: "B", nom: "Article B", unite: "pièce", quantite: 16, seuil: 19 }]);
    expect(r.restes_clients).toEqual([{ nom: "Monsieur Fotso", telephone: "237677000111", reste: 1000 }]);
    expect(r.voit_valeurs).toBe(true);
    // Filtres de dates et de lieu.
    expect((await env.api("GET", "/rapports/ventes-stock?du=2020-01-01&au=2020-01-31", o.jeton)).corps.meilleures_ventes).toEqual([]);
    expect((await env.api("GET", `/rapports/ventes-stock?entiteId=${o.entites.GTA}`, o.jeton)).corps).toMatchObject({ meilleures_ventes: [], stock_par_lieu: [] });
    expect((await env.api("GET", "/rapports/ventes-stock?du=2026-02-01&au=2026-01-01", o.jeton)).statut).toBe(400);
    // Le caissier voit le stock de son lieu, sans valeur, ni ventes des autres, ni marges.
    const c = (await env.api("GET", "/rapports/ventes-stock", caissier.jeton)).corps;
    expect(c).toMatchObject({ meilleures_ventes: [], ventes_par_vendeur: [], marges: [], restes_clients: [], voit_valeurs: false, stock_par_lieu: [{ entite: "Akwa", valeur: null }] });
    const formateur = await o.compte("formateur", o.entites.GTA!);
    expect((await env.api("GET", "/rapports/ventes-stock", formateur.jeton)).statut).toBe(403);
    const autre = await env.nouvelleOrganisation();
    expect((await env.api("GET", `/rapports/ventes-stock?entiteId=${o.M}`, autre.jeton)).corps.meilleures_ventes).toEqual([]);
  });

  it("calcule la commission au delà de l'objectif et la propose à la paie, sans l'imposer", async () => {
    expect([commission(500_000, 300_000, 5), commission(200_000, 300_000, 5), commission(333_333, 0, 2.5)]).toEqual([10_000, 0, 8_333]);
    const o = await magasin();
    const vendeur = await o.compte("caissier", o.M, "Awa Caissière");
    const e = (await env.api("POST", "/employes", o.jeton, { entiteId: o.G, nom: "Awa Caissière", poste: "Vendeuse", typeContrat: "cdi", dateEmbauche: "2025-01-01" })).corps.id;
    await env.api("PATCH", `/employes/${e}/compte`, o.jeton, { utilisateurId: vendeur.id });
    expect((await env.api("PUT", `/employes/${e}/commission`, vendeur.jeton, { objectifVentes: 0, tauxCommission: 50 })).statut).toBe(403);
    await o.vendre(o.jeton, { vendeurId: vendeur.id, lignes: [{ produitId: o.A, quantite: 5 }], paiements: o.especes(5500) });
    await o.vendre(o.jeton, { lignes: [{ produitId: o.B, quantite: 1 }], paiements: o.especes(500) });
    const url = `/rapports/commissions?mois=${MOIS}`;
    // Sans réglage, pas de commission calculée, et rien à proposer.
    expect((await env.api("GET", url, o.jeton)).corps.vendeurs).toEqual([expect.objectContaining({ nom: "Awa Caissière", ventes: 5500, nombre: 1, commission: null, propose: null })]);
    expect((await env.api("POST", "/rapports/commissions/propositions", o.jeton, { employeId: e, mois: MOIS })).corps.erreur).toBe("commission_non_reglee");
    expect((await env.api("PUT", `/employes/${e}/commission`, o.jeton, { objectifVentes: 3000, tauxCommission: 10 })).corps).toMatchObject({ taux_commission: 10 });
    expect((await env.api("GET", url, o.jeton)).corps.vendeurs[0]).toMatchObject({ ventes: 5500, objectif_ventes: 3000, taux_commission: 10, commission: 250 });
    expect((await env.api("GET", url, vendeur.jeton)).statut).toBe(403);
    expect((await env.api("POST", "/rapports/commissions/propositions", vendeur.jeton, { employeId: e, mois: MOIS })).statut).toBe(403);
    const p = await env.api("POST", "/rapports/commissions/propositions", o.jeton, { employeId: e, mois: MOIS });
    expect(p.corps).toMatchObject({ ventes: 5500, objectif: 3000, taux: 10, montant: 250 });
    // La paie voit la proposition ; aucun bulletin n'est créé ni modifié.
    expect((await env.api("GET", `/paie/commissions-proposees?mois=${MOIS}`, o.jeton)).corps).toEqual([expect.objectContaining({ nom: "Awa Caissière", montant: 250, propose_par: "Admin" })]);
    expect((await env.api("GET", `/paie/commissions-proposees?mois=${MOIS}`, vendeur.jeton)).statut).toBe(403);
    expect((await env.api("GET", `/employes/${e}/bulletins`, o.jeton)).corps).toEqual([]);
    expect((await env.api("GET", url, o.jeton)).corps.vendeurs[0].propose).toBe(250);
  });
});
