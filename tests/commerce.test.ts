import { afterAll, describe, expect, it } from "vitest";
import { aModerer, prixPourQuantite, scoreGlobal, scoreKpi } from "../src/commerce.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
const G = (o: Org) => o.entites.GLOMARI!;
const fiche = async (o: Org, nom: string, e = G(o)) => (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom, entiteId: e })).corps.id as string;
const wallet = async (o: Org, s = 100000, e = G(o)) => (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: e, nom: `W${Math.random()}`, type: "banque", soldeInitial: s })).corps.id as string;
const solde = async (o: Org, w: string) => (await env.api("GET", `/portefeuilles/${w}/mouvements`, o.jeton)).corps.solde;
async function compte(o: Org, code: string, entiteId: string) {
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
  const u = await env.api("POST", "/utilisateurs", o.jeton, { email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((x: { code: string }) => x.code === code).id });
  return { jeton: await env.connecter(o.slug, email), id: u.corps.id as string };
}
const facture = async (o: Org, tiersId: string, lignes: object[] = [{ designation: "X", quantite: 1, prixUnitaire: 10000 }]) => {
  await env.api("PATCH", `/entites/${G(o)}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
  const d = await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: G(o), tiersId, date: "2026-02-01", lignes });
  return { id: d.corps.id as string, total: d.corps.total_ttc as number, emettre: (jeton = o.jeton) => env.api("POST", `/documents-vente/${d.corps.id}/emission`, jeton) };
};

describe("calculs", () => {
  it("applique le palier atteint à toute la ligne, seulement s'il est actif", () => {
    const p = [{ quantite_min: 5, prix: 90 }, { quantite_min: 21, prix: 80 }];
    expect([1, 5, 20, 21].map((q) => prixPourQuantite(100, true, p, q))).toEqual([100, 90, 90, 80]);
    expect(prixPourQuantite(100, false, p, 50)).toBe(100);
  });
  it("repère les coordonnées et les injures, mais pas une critique", () => {
    expect(aModerer("Appelez le 699 00 01 11")).toBe(true);
    expect(aModerer("écrivez à a@b.cm")).toBe(true);
    expect(aModerer("quel voleur")).toBe(true);
    expect(aModerer("Produit très mauvais, je déconseille")).toBe(false);
    expect(aModerer(undefined)).toBe(false);
  });
  it("plafonne l'atteinte et gère les indicateurs à la baisse", () => {
    expect(scoreKpi(1, 100, 150)).toBe(100);
    expect(scoreKpi(1, 100, 50)).toBe(50);
    expect(scoreKpi(-1, 10, 5)).toBe(100);
    expect(scoreKpi(-1, 10, 20)).toBe(50);
    expect(scoreKpi(-1, 0, 20)).toBe(0);
    expect(scoreGlobal([{ poids: 3, score: 100 }, { poids: 1, score: 0 }])).toBe(75);
  });
});

describe("GLOMARI Care", () => {
  async function prep() {
    const o = await env.nouvelleOrganisation();
    const c = await fiche(o, "Client");
    const p = (await env.api("POST", "/produits", o.jeton, { entiteId: G(o), code: "A", nom: "A", suiviStock: true, prixVente: 1000 })).corps.id as string;
    await env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: G(o), produitId: p, type: "entree", quantite: 5, coutUnitaire: 100 });
    return { ...o, c, p };
  }
  type P = Awaited<ReturnType<typeof prep>>;
  const ouvrir = (o: P, x: object = {}) => env.api("POST", "/sav", o.jeton, { entiteId: G(o), tiersId: o.c, produitId: o.p, demande: "retour", motif: "Panne", delaiJours: 3, ...x });
  const etape = (o: P, id: string, statut: string, note?: string) => env.api("POST", `/sav/${id}/etape`, o.jeton, { statut, note });

  it("suit le dossier dans l'ordre et remet le produit en stock", async () => {
    const o = await prep();
    const d = await ouvrir(o);
    expect(d.corps.numero).toMatch(/^SAV-/);
    const decider = (x: object) => env.api("POST", `/sav/${d.corps.id}/decision`, o.jeton, x);
    expect((await decider({ decision: "rebut" })).corps.erreur).toBe("etape_impossible");
    expect((await etape(o, d.corps.id, "recu")).corps.erreur).toBe("etape_impossible");
    await etape(o, d.corps.id, "autorise");
    await etape(o, d.corps.id, "recu");
    expect((await decider({ decision: "remise_stock" })).corps.erreur).toBe("entrepot_obligatoire");
    expect((await decider({ decision: "remise_stock", entrepotId: G(o), aRefacturer: 500 })).statut).toBe(200);
    expect((await env.api("GET", "/stocks", o.jeton)).corps[0].quantite).toBe(6);
    expect((await etape(o, d.corps.id, "clos")).statut).toBe(200);
    expect((await env.api("GET", "/sav", o.jeton)).corps.parProduit[0]).toMatchObject({ produit: "A", a_refacturer: 500 });
  });

  it("rembourse depuis un portefeuille suffisant, et calcule la garantie", async () => {
    const o = await prep();
    const f = await ouvrir(o, { dateAchat: "2020-01-01", demande: "remboursement" });
    await env.app.inject({ method: "GET", url: "/" });
    await etape(o, f.corps.id, "autorise");
    await etape(o, f.corps.id, "recu");
    const vide = await wallet(o, 0);
    const u = `/sav/${f.corps.id}/decision`;
    expect((await env.api("POST", u, o.jeton, { decision: "remboursement", montant: 10, portefeuilleId: vide })).corps.erreur).toBe("solde_portefeuille_insuffisant");
    const gta = await wallet(o, 100, o.entites.GTA!);
    expect((await env.api("POST", u, o.jeton, { decision: "remboursement", montant: 10, portefeuilleId: gta })).corps.erreur).toBe("transfert_autre_branche");
    const w = await wallet(o);
    expect((await env.api("POST", u, o.jeton, { decision: "remboursement", montant: 1000, portefeuilleId: w })).statut).toBe(200);
    expect(await solde(o, w)).toBe(99000);
  });

  it("refuse GTA et les autres organisations", async () => {
    const o = await prep();
    const c = await fiche(o, "G", o.entites.GTA!);
    expect((await env.api("POST", "/sav", o.jeton, { entiteId: o.entites.GTA, tiersId: c, demande: "retour", motif: "x", delaiJours: 1 })).statut).toBe(403);
    const d = await ouvrir(o);
    const e = await env.nouvelleOrganisation();
    expect((await env.api("POST", `/sav/${d.corps.id}/etape`, e.jeton, { statut: "autorise" })).statut).toBe(404);
  });
});

describe("avis du groupe", () => {
  async function prep() {
    const o = await env.nouvelleOrganisation();
    const c = await fiche(o, "Client");
    const f = await facture(o, c);
    await f.emettre();
    return { ...o, c, f };
  }
  const demander = (o: Awaited<ReturnType<typeof prep>>, x: object = {}) => env.api("POST", "/retours/demandes", o.jeton, { entiteId: G(o), cibleType: "produit", cible: "Sac", sourceType: "facture", sourceId: o.f.id, ...x });
  const code = (l: string) => new URL(l).searchParams.get("c");

  it("n'accepte qu'un achat réel, une seule réponse, et ouvre un ticket sur note basse sans masquer l'avis", async () => {
    const o = await prep();
    expect((await demander(o, { sourceId: o.organisationId })).corps.erreur).toBe("achat_non_verifie");
    const d = await demander(o);
    const c = code(d.corps.lien);
    expect((await env.api("GET", `/evaluer/${c}`)).corps).toEqual({ cible: "Sac", repondu: false });
    expect((await env.api("POST", `/evaluer/${c}`, undefined, { note: 1, commentaire: "Très mauvais" })).statut).toBe(201);
    expect((await env.api("POST", `/evaluer/${c}`, undefined, { note: 5 })).corps.erreur).toBe("deja_repondu");
    const r = (await env.api("GET", "/retours", o.jeton)).corps;
    expect(r.avis[0]).toMatchObject({ note: 1, statut: "publie" });
    expect(r.moyennes[0]).toMatchObject({ moyenne: 1, avis: 1 });
    expect((await env.api("GET", "/tickets", o.jeton)).corps[0]).toMatchObject({ priorite: "haute" });
    expect((await env.api("POST", `/retours/${r.avis[0].id}`, o.jeton, { statut: "masque" })).corps.erreur).toBe("motif_obligatoire");
    expect((await env.api("GET", "/evaluer/faux")).statut).toBe(404);
  });
  it("met en modération un commentaire avec des coordonnées", async () => {
    const o = await prep();
    const d = await demander(o, { cibleType: "magasin" });
    await env.api("POST", `/evaluer/${code(d.corps.lien)}`, undefined, { note: 5, commentaire: "Appelez le 699000111" });
    const r = (await env.api("GET", "/retours", o.jeton)).corps;
    expect(r.avis[0].statut).toBe("a_moderer");
    expect(r.moyennes).toEqual([]);
  });
});

describe("campagnes", () => {
  it("calcule le retour sur investissement, avoirs déduits, sans doublon", async () => {
    const o = await env.nouvelleOrganisation();
    const c = await env.api("POST", "/campagnes", o.jeton, { entiteId: G(o), nom: "Noël", canal: "WhatsApp", cout: 5000 });
    const f = await facture(o, await fiche(o, "A"));
    const em = await f.emettre();
    const u = `/campagnes/${c.corps.id}/ventes`;
    expect((await env.api("POST", u, o.jeton, { numeroFacture: em.corps.numero })).statut).toBe(201);
    expect((await env.api("POST", u, o.jeton, { numeroFacture: em.corps.numero })).statut).toBe(409);
    expect((await env.api("GET", "/campagnes", o.jeton)).corps[0]).toMatchObject({ chiffre: 10000, roi: 100, cout_par_client: 5000 });
    await env.api("POST", `/factures/${f.id}/avoir`, o.jeton, { date: "2026-02-05", motif: "Retour partiel", lignes: [{ designation: "X", quantite: 1, prixUnitaire: 5000 }] });
    expect((await env.api("GET", "/campagnes", o.jeton)).corps[0]).toMatchObject({ chiffre: 5000, roi: 0 });
  });
});

describe("prix par palier et crédit", () => {
  it("refuse un palier sous le coût, reste en veille, puis s'applique en facture et en caisse", async () => {
    const o = await env.nouvelleOrganisation();
    const p = (await env.api("POST", "/produits", o.jeton, { entiteId: G(o), code: "A", nom: "A", suiviStock: true, prixVente: 1000 })).corps.id;
    await env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: G(o), produitId: p, type: "entree", quantite: 100, coutUnitaire: 500 });
    const put = (actif: boolean, paliers: object[]) => env.api("PUT", `/produits/${p}/paliers`, o.jeton, { actif, paliers });
    expect((await put(true, [{ quantiteMin: 5, prix: 400 }])).corps.erreur).toBe("palier_sous_le_cout");
    expect((await put(true, [{ quantiteMin: 5, prix: 1200 }])).corps.erreur).toBe("paliers_non_degressifs");
    expect((await put(false, [{ quantiteMin: 5, prix: 800 }])).statut).toBe(200);
    const c = await fiche(o, "C");
    expect((await facture(o, c, [{ produitId: p, quantite: 5 }])).total).toBe(5000);
    await put(true, [{ quantiteMin: 5, prix: 800 }]);
    expect((await facture(o, c, [{ produitId: p, quantite: 5 }])).total).toBe(4000);
    expect((await facture(o, c, [{ produitId: p, quantite: 4 }])).total).toBe(4000);
    expect((await facture(o, c, [{ produitId: p, quantite: 5, prixUnitaire: 900 }])).total).toBe(4500);
    await env.api("POST", "/caisse/ouverture", o.jeton, { entiteId: G(o), fondOuverture: 0 });
    const v = await env.api("POST", "/caisse/ventes", o.jeton, { entiteId: G(o), lignes: [{ produitId: p, quantite: 5 }], paiements: [{ moyen: "especes", montant: 4000 }] });
    expect(v.corps.total_ttc).toBe(4000);
    const liste = (await env.api("GET", "/produits", o.jeton)).corps[0];
    expect(liste.paliers[0]).toEqual({ quantite_min: 5, prix: 800 });
  });

  it("bloque une facture au-delà du plafond, sauf pour un responsable", async () => {
    const o = await env.nouvelleOrganisation();
    const c = await fiche(o, "Grossiste");
    expect((await env.api("PUT", `/tiers/${c}/compte-pro`, o.jeton, { entiteId: G(o), categorie: "grossiste", plafondCredit: 15000, delaiJours: 30 })).statut).toBe(200);
    const roles = (await env.api("GET", "/roles", o.jeton)).corps;
    const code = roles.find((r: { code: string }) => r.code === "commercial").id;
    const email = `c${Math.random().toString(36).slice(2)}@test.cm`;
    await env.api("POST", "/utilisateurs", o.jeton, { email, nom: "C", motDePasse: MOT_DE_PASSE, entiteId: G(o), roleId: code });
    const com = await env.connecter(o.slug, email);
    const f1 = await facture(o, c);
    expect((await f1.emettre(com)).statut).toBe(200);
    const f2 = await facture(o, c);
    expect((await f2.emettre(com)).corps).toMatchObject({ erreur: "plafond_credit_depasse", details: { encours: 10000, plafond: 15000 } });
    await env.api("POST", `/factures/${f1.id}/reglements`, o.jeton, { montant: 10000, moyen: "especes" });
    expect((await f2.emettre(com)).statut).toBe(200);
    const f3 = await facture(o, c, [{ designation: "Y", quantite: 1, prixUnitaire: 90000 }]);
    expect((await f3.emettre()).statut).toBe(200);
  });
});

describe("vendeurs et franchises", () => {
  it("ne reverse qu'après livraison, sans litige, commission et retenue déduites", async () => {
    const o = await env.nouvelleOrganisation();
    const v = await env.api("POST", "/vendeurs", o.jeton, { entiteId: G(o), tiersId: await fiche(o, "V"), tauxCommission: 10 });
    const cmd = () => env.api("POST", `/vendeurs/${v.corps.id}/commandes`, o.jeton, { reference: "C1", montant: 10000 });
    expect((await cmd()).corps.erreur).toBe("vendeur_non_verifie");
    await env.api("POST", `/vendeurs/${v.corps.id}/statut`, o.jeton, { statut: "verifie" });
    const c = await cmd();
    expect(c.corps.commission).toBe(1000);
    const act = (x: object) => env.api("POST", `/commandes-vendeur/${c.corps.id}`, o.jeton, x);
    const w = await wallet(o);
    expect((await act({ action: "reverser", portefeuilleId: w })).corps.erreur).toBe("etape_impossible");
    await act({ action: "livrer" });
    expect((await act({ action: "litige" })).corps.erreur).toBe("motif_obligatoire");
    await act({ action: "litige", motif: "Colis abîmé" });
    expect((await act({ action: "reverser", portefeuilleId: w })).corps.erreur).toBe("etape_impossible");
    await act({ action: "lever_litige" });
    expect((await env.api("GET", "/vendeurs", o.jeton)).corps[0].a_reverser).toBe(9000);
    expect((await act({ action: "reverser", portefeuilleId: w, retenue: 500 })).corps.statut).toBe("reversee");
    expect(await solde(o, w)).toBe(100000 - 8500);
    expect((await act({ action: "reverser", portefeuilleId: w })).statut).toBe(409);
  });
  it("calcule la redevance d'une franchise active, un mois une fois", async () => {
    const o = await env.nouvelleOrganisation();
    const f = await env.api("POST", "/franchises", o.jeton, { entiteId: G(o), tiersId: await fiche(o, "F"), tauxRedevance: 5 });
    const m = () => env.api("POST", `/franchises/${f.corps.id}/ventes`, o.jeton, { periode: "2026-10", ventes: 100000, scoreAudit: 80 });
    expect((await m()).corps.erreur).toBe("franchise_inactive");
    await env.api("PATCH", `/franchises/${f.corps.id}`, o.jeton, { statut: "actif" });
    expect((await m()).corps.redevance).toBe(5000);
    expect((await m()).statut).toBe(409);
    expect((await env.api("GET", "/franchises", o.jeton)).corps[0]).toMatchObject({ redevance_due: 5000, score: 80 });
  });
});

describe("évaluation et API", () => {
  it("calcule depuis l'activité réelle, garde le brouillon privé et permet de contester", async () => {
    const o = await env.nouvelleOrganisation();
    const caissier = await compte(o, "caissier", G(o));
    const autre = await compte(o, "caissier", G(o));
    const e = await env.api("POST", "/employes", o.jeton, { entiteId: G(o), nom: "Paul", poste: "Caissier", typeContrat: "cdi", dateEmbauche: "2026-01-01" });
    const ev = () => env.api("POST", "/evaluations", o.jeton, { employeId: e.corps.id, periode: new Date().toISOString().slice(0, 7) });
    expect((await ev()).corps.erreur).toBe("employe_sans_compte");
    await env.api("PATCH", `/employes/${e.corps.id}/compte`, o.jeton, { utilisateurId: caissier.id });
    expect((await ev()).corps.erreur).toBe("poste_sans_regles");
    await env.api("PUT", "/evaluations/regles", o.jeton, { entiteId: G(o), poste: "Caissier", lignes: [{ kpi: "ventes_caisse", poids: 3, cible: 2000 }, { kpi: "ecarts_caisse", poids: 1, cible: 0 }] });
    const p = (await env.api("POST", "/produits", o.jeton, { entiteId: G(o), code: "A", nom: "A", prixVente: 1000 })).corps.id;
    await env.api("POST", "/caisse/ouverture", caissier.jeton, { entiteId: G(o), fondOuverture: 0 });
    await env.api("POST", "/caisse/ventes", caissier.jeton, { entiteId: G(o), lignes: [{ produitId: p, quantite: 1 }], paiements: [{ moyen: "especes", montant: 1000 }] });
    const r = await ev();
    expect(r.corps.score).toBe(63);
    expect((await env.api("GET", "/moi/evaluations", caissier.jeton)).corps).toEqual([]);
    await env.api("POST", `/evaluations/${r.corps.id}/suivi`, o.jeton, { statut: "partagee", commentaire: "Nouveau poste" });
    expect((await env.api("GET", "/moi/evaluations", caissier.jeton)).corps[0].score).toBe(63);
    expect((await env.api("GET", "/moi/evaluations", autre.jeton)).corps).toEqual([]);
    expect((await env.api("POST", `/moi/evaluations/${r.corps.id}/contestation`, autre.jeton, { commentaire: "Pas moi" })).statut).toBe(404);
    expect((await env.api("POST", `/moi/evaluations/${r.corps.id}/contestation`, caissier.jeton, { commentaire: "Panne de caisse" })).corps.statut).toBe("contestee");
    expect((await env.api("GET", "/evaluations", caissier.jeton)).statut).toBe(403);
  });
  it("publie la description de l'API à partir des routes", async () => {
    const r = await env.api("GET", "/api/openapi.json");
    expect(r.corps.openapi).toMatch(/^3/);
    expect(r.corps.paths["/sav"]).toBeTruthy();
    expect(r.corps.paths["/compta/balance"]).toBeTruthy();
  });
});
