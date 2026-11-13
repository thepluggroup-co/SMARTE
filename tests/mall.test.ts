import { afterAll, describe, expect, it } from "vitest";
import { moisDansBail } from "../src/mall.js";
import { environnement } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
const G = (o: Org) => o.entites.GLOMARI!;
const fiche = async (o: Org, nom: string) => (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom, entiteId: G(o) })).corps.id as string;
const identite = (o: Org) => env.api("PATCH", `/entites/${G(o)}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
const produit = async (o: Org, extra = {}) => (await env.api("POST", "/produits", o.jeton, { entiteId: G(o), code: `P${Math.random()}`, nom: "Lait", suiviStock: true, prixVente: 1000, ...extra })).corps.id as string;

describe("Mall", () => {
  it("borne le mois au bail", () => {
    expect(moisDansBail("2026-02", "2026-01-15", "2026-12-31")).toBe(true);
    expect(moisDansBail("2027-01", "2026-01-15", "2026-12-31")).toBe(false);
  });
  it("loue sans chevauchement, facture un mois une fois et suit les impayés", async () => {
    const o = await env.nouvelleOrganisation();
    await identite(o);
    const l = await env.api("POST", "/locaux", o.jeton, { entiteId: G(o), code: "B1", nom: "Boutique 1", type: "boutique" });
    await env.api("POST", "/locaux", o.jeton, { entiteId: G(o), code: "B2", nom: "Boutique 2", type: "boutique" });
    const auj = new Date().getFullYear();
    const bail = (x = {}) => env.api("POST", "/baux", o.jeton, { localId: l.corps.id, tiersId: x && "tiersId" in x ? (x as { tiersId: string }).tiersId : t, debut: `${auj}-01-01`, fin: `${auj}-12-31`, loyer: 100000, charges: 10000, ...x });
    const t = await fiche(o, "Locataire");
    const b = await bail();
    expect(b.statut).toBe(201);
    expect((await bail()).corps.erreur).toBe("local_deja_loue");
    const fact = (periode: string) => env.api("POST", `/baux/${b.corps.id}/facturation`, o.jeton, { periode });
    expect((await fact(`${auj + 1}-01`)).corps.erreur).toBe("hors_bail");
    const f = await fact(`${auj}-03`);
    expect(f.corps).toMatchObject({ total: 110000 });
    expect((await fact(`${auj}-03`)).statut).toBe(409);
    const d = (await env.api("GET", "/locaux", o.jeton)).corps;
    expect(d.occupation).toBe(50);
    expect(d.locaux[0]).toMatchObject({ locataire: "Locataire", impayes: 110000 });
    const fid = (await env.api("GET", "/documents-vente?type=facture", o.jeton)).corps.find((x: { numero: string }) => x.numero === f.corps.numero).id;
    await env.api("POST", `/factures/${fid}/reglements`, o.jeton, { montant: 110000, moyen: "especes" });
    expect((await env.api("GET", "/locaux", o.jeton)).corps.locaux[0].impayes).toBe(0);
    const e = await env.nouvelleOrganisation();
    expect((await env.api("POST", `/baux/${b.corps.id}/facturation`, e.jeton, { periode: `${auj}-04` })).statut).toBe(404);
  });
  it("libère la période de la réservation si la facture échoue", async () => {
    const o = await env.nouvelleOrganisation();
    const l = await env.api("POST", "/locaux", o.jeton, { entiteId: G(o), code: "B1", nom: "B", type: "boutique" });
    const b = await env.api("POST", "/baux", o.jeton, { localId: l.corps.id, tiersId: await fiche(o, "L"), debut: "2026-01-01", fin: "2026-12-31", loyer: 100 });
    const f = () => env.api("POST", `/baux/${b.corps.id}/facturation`, o.jeton, { periode: "2026-02" });
    expect((await f()).corps.erreur).toBe("identite_vendeur_incomplete");
    await identite(o);
    expect((await f()).statut).toBe(201);
  });
  it("refuse GTA", async () => {
    const o = await env.nouvelleOrganisation();
    expect((await env.api("POST", "/locaux", o.jeton, { entiteId: o.entites.GTA, code: "X", nom: "X", type: "boutique" })).statut).toBe(403);
  });
});

describe("lots", () => {
  it("consomme d'abord le lot qui périme le plus tôt, alimente le stock et valorise la perte", async () => {
    const o = await env.nouvelleOrganisation();
    const p = await produit(o);
    const lot = (numero: string, peremption: string, quantite: number) => env.api("POST", "/lots", o.jeton, { entiteId: G(o), produitId: p, numero, peremption, quantite, coutUnitaire: 500 });
    expect((await lot("TARD", "2099-06-01", 5)).statut).toBe(201);
    await lot("TOT", "2000-01-01", 3);
    expect((await env.api("GET", "/stocks", o.jeton)).corps[0].quantite).toBe(8);
    await env.api("POST", "/caisse/ouverture", o.jeton, { entiteId: G(o), fondOuverture: 0 });
    await env.api("POST", "/caisse/ventes", o.jeton, { entiteId: G(o), lignes: [{ produitId: p, quantite: 4 }], paiements: [{ moyen: "especes", montant: 4000 }] });
    const liste = (await env.api("GET", "/lots?jours=3650", o.jeton)).corps;
    expect(liste).toEqual([]);
    const r = await env.api("POST", "/demarques", o.jeton, { entiteId: G(o), produitId: p, quantite: 1, motif: "Casse" });
    expect(r.corps.valeur).toBe(500);
    expect((await env.api("GET", "/stocks", o.jeton)).corps[0].quantite).toBe(3);
  });
  it("signale un lot périmé", async () => {
    const o = await env.nouvelleOrganisation();
    const p = await produit(o);
    await env.api("POST", "/lots", o.jeton, { entiteId: G(o), produitId: p, numero: "L", peremption: "2020-01-01", quantite: 2, coutUnitaire: 1 });
    expect((await env.api("GET", "/lots", o.jeton)).corps[0]).toMatchObject({ perime: true, quantite: 2 });
  });
});

describe("points relais", () => {
  it("dépose, retire par code, fait naître la commission et la paie une fois", async () => {
    const o = await env.nouvelleOrganisation();
    const r = await env.api("POST", "/points-relais", o.jeton, { entiteId: G(o), nom: "Relais Akwa", commission: 300 });
    const c = await env.api("POST", "/colis", o.jeton, { entiteId: G(o), destinataire: "Awa", aEncaisser: 1000 });
    const u = `/colis/${c.corps.id}`;
    const retrait = (x: object) => env.api("POST", `${u}/retrait`, o.jeton, { recuPar: "Awa", encaisse: 1000, ...x });
    expect((await retrait({ code: c.corps.code_confirmation })).corps.erreur).toBe("etape_impossible");
    await env.api("POST", `${u}/depot-relais`, o.jeton, { pointRelaisId: r.corps.id });
    expect((await env.api("GET", "/points-relais", o.jeton)).corps[0].colis).toHaveLength(1);
    expect((await retrait({ code: c.corps.code_confirmation === "111111" ? "222222" : "111111" })).corps.erreur).toBe("code_incorrect");
    expect((await retrait({ code: c.corps.code_confirmation, encaisse: 1 })).corps.erreur).toBe("encaissement_incomplet");
    expect((await retrait({ code: c.corps.code_confirmation })).corps.statut).toBe("livre");
    const l = (await env.api("GET", "/points-relais", o.jeton)).corps[0];
    expect(l.a_payer).toBe(300);
    const w = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: G(o), nom: "W", type: "banque", soldeInitial: 1000 })).corps.id;
    const payer = () => env.api("POST", `/points-relais/${r.corps.id}/paiement`, o.jeton, { portefeuilleId: w });
    expect((await payer()).corps.paye).toBe(300);
    expect((await payer()).corps.erreur).toBe("rien_a_payer");
    expect((await env.api("GET", `/portefeuilles/${w}/mouvements`, o.jeton)).corps.solde).toBe(700);
  });
});

describe("portail grossiste", () => {
  async function prep() {
    const o = await env.nouvelleOrganisation();
    await identite(o);
    const c = await fiche(o, "Grossiste");
    await env.api("PUT", `/tiers/${c}/compte-pro`, o.jeton, { entiteId: G(o), categorie: "grossiste", plafondCredit: 1000000, delaiJours: 30 });
    const p = await produit(o);
    await env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: G(o), produitId: p, type: "entree", quantite: 100, coutUnitaire: 500 });
    await env.api("PUT", `/produits/${p}/paliers`, o.jeton, { actif: true, paliers: [{ quantiteMin: 10, prix: 800 }] });
    const l = await env.api("POST", `/tiers/${c}/portail`, o.jeton, { entiteId: G(o), actif: true });
    return { ...o, c, p, code: new URL(l.corps.lien).searchParams.get("c") as string };
  }
  it("affiche prix et paliers sans le coût, et calcule le prix sur le serveur", async () => {
    const o = await prep();
    const d = (await env.api("GET", `/portail/${o.code}`)).corps;
    expect(d.nom).toBe("Grossiste");
    expect(d.catalogue[0].paliers).toEqual([{ quantite_min: 10, prix: 800 }]);
    expect(JSON.stringify(d)).not.toContain("cout");
    expect(d.credit).toEqual({ plafond: 1000000, encours: 0 });
    const c = await env.api("POST", `/portail/${o.code}/commandes`, undefined, { lignes: [{ produitId: o.p, quantite: 10, prix: 1 }] });
    expect(c.corps).toMatchObject({ total_ht: 8000, statut: "soumise" });
    const a = await env.api("POST", `/commandes-portail/${c.corps.id}/decision`, o.jeton, { decision: "acceptee" });
    expect(a.corps.statut).toBe("acceptee");
    expect((await env.api("GET", `/documents-vente/${a.corps.documentId}`, o.jeton)).corps.total_ttc).toBe(8000);
    expect((await env.api("POST", `/commandes-portail/${c.corps.id}/decision`, o.jeton, { decision: "acceptee" })).statut).toBe(409);
  });
  it("refuse un produit d'une autre branche, un mauvais lien, et un lien retiré", async () => {
    const o = await prep();
    const gta = (await env.api("POST", "/produits", o.jeton, { entiteId: o.entites.GTA, code: "G", nom: "G", prixVente: 1 })).corps.id;
    expect((await env.api("POST", `/portail/${o.code}/commandes`, undefined, { lignes: [{ produitId: gta, quantite: 1 }] })).statut).toBe(404);
    expect((await env.api("GET", "/portail/faux")).statut).toBe(404);
    const autre = await env.nouvelleOrganisation();
    expect((await env.api("GET", "/commandes-portail", autre.jeton)).corps).toEqual([]);
    const pros = (await env.api("GET", "/comptes-pro", o.jeton)).corps;
    expect(pros[0].portail).toBe(true);
    expect(JSON.stringify(pros)).not.toContain(o.code.split(".")[1]);
    await env.api("POST", `/tiers/${o.c}/portail`, o.jeton, { entiteId: G(o), actif: false });
    expect((await env.api("GET", `/portail/${o.code}`)).statut).toBe(404);
  });
});
