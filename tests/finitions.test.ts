import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { prevoirMois, totalParTranches } from "../src/finitions.js";
import { creerServeur } from "../src/serveur.js";
import { environnement, MOT_DE_PASSE, OPTIONS } from "./outils.js";
const env = await environnement();
const adm = new pg.Pool({ connectionString: process.env.TEST_BASE_ADMIN_URL });
const app = await creerServeur(env.poolApp, { ...OPTIONS, cleConsole: "cle-de-test-longue", poolAdmin: adm });
afterAll(async () => { await app.close(); await adm.end(); await env.fermer(); });
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
const G = (o: Org) => o.entites.GLOMARI!;
const j = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const prixFacture = async (o: Org, t: string, p: string, q: number) => (await env.api("GET", `/documents-vente/${(await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: G(o), tiersId: t, date: j(0), lignes: [{ produitId: p, quantite: q }] })).corps.id}`, o.jeton)).corps.total_ht;
describe("prix", () => {
  it("calcule les tranches et la prévision", () => {
    expect(totalParTranches(100, [{ quantite_min: 5, prix: 80 }, { quantite_min: 21, prix: 50 }], 10)).toBe(4 * 100 + 6 * 80);
    expect(totalParTranches(100, [{ quantite_min: 5, prix: 80 }], 3)).toBe(300);
    expect(prevoirMois([10, 10, 10])).toBe(10);
    expect(prevoirMois([])).toBe(0);
    expect(prevoirMois([100, 0])).toBe(0);
  });
  it("priorité : prix client, grille de catégorie, tranches", async () => {
    const o = await env.nouvelleOrganisation();
    const p = (await env.api("POST", "/produits", o.jeton, { entiteId: G(o), code: "A", nom: "A", prixVente: 1000 })).corps.id;
    const t = (await env.api("POST", "/tiers", o.jeton, { type: "entreprise", nom: "Gros", entiteId: G(o) })).corps.id;
    await env.api("PUT", `/produits/${p}/paliers`, o.jeton, { actif: true, paliers: [{ quantiteMin: 5, prix: 800 }] });
    expect(await prixFacture(o, t, p, 10)).toBe(8000);
    await env.api("PUT", `/produits/${p}/mode-palier`, o.jeton, { mode: "tranches" });
    expect(await prixFacture(o, t, p, 10)).toBe(8800 + 0);
    await env.api("PUT", `/tiers/${t}/compte-pro`, o.jeton, { entiteId: G(o), categorie: "grossiste", plafondCredit: 0, delaiJours: 0 });
    await env.api("POST", `/produits/${p}/grilles`, o.jeton, { categorie: "detaillant", prix: 500 });
    expect(await prixFacture(o, t, p, 1)).toBe(1000);
    await env.api("POST", `/produits/${p}/grilles`, o.jeton, { categorie: "grossiste", prix: 700, debut: j(-1), fin: j(1) });
    expect(await prixFacture(o, t, p, 1)).toBe(700);
    await env.api("PUT", `/tiers/${t}/prix`, o.jeton, { produitId: p, prix: 650 });
    expect(await prixFacture(o, t, p, 1)).toBe(650);
  });
});
describe("préparation et rapports", () => {
  it("contrôle chaque scan et finit la préparation", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("PATCH", `/entites/${G(o)}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const p = (await env.api("POST", "/produits", o.jeton, { entiteId: G(o), code: "SAV", nom: "Savon", prixVente: 100, suiviStock: true })).corps.id;
    await env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: G(o), produitId: p, type: "entree", quantite: 5, coutUnitaire: 10 });
    await env.api("PUT", `/produits/${p}/emplacement`, o.jeton, { emplacement: "A1" });
    const t = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "C", entiteId: G(o) })).corps.id;
    const d = (await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: G(o), tiersId: t, date: j(0), lignes: [{ produitId: p, quantite: 2 }] })).corps.id;
    await env.api("POST", `/documents-vente/${d}/emission`, o.jeton, { entrepotId: G(o) });
    const x = (await env.api("POST", `/documents-vente/${d}/preparation`, o.jeton)).corps;
    expect(x.lignes[0]).toMatchObject({ emplacement: "A1", pris: 0, quantite: 2 });
    const S = (c: string) => env.api("POST", `/preparations/${x.id}/scan`, o.jeton, { code: c });
    expect((await S("AUTRE")).corps.erreur).toBe("article_hors_commande");
    expect((await S("SAV")).corps.statut).toBe("en_cours");
    expect((await S("SAV")).corps.statut).toBe("terminee");
    expect((await S("SAV")).corps.erreur).toBe("preparation_terminee");
    const R = (b: object) => env.api("POST", "/rapports/execution", o.jeton, { debut: j(-1), fin: j(1), ...b });
    expect((await R({ source: "ventes", dimension: "client", comparer: true })).corps.lignes[0]).toMatchObject({ cle: "C", total: 200, precedent: 0 });
    expect((await R({ source: "ventes", dimension: "t.nom; drop table" })).corps.erreur).toBe("rapport_invalide");
    expect((await R({ source: "autre", dimension: "client" })).statut).toBe(400);
    expect(Array.isArray((await env.api("GET", "/previsions/ventes", o.jeton)).corps)).toBe(true);
  });
  it("règle qui crée un ticket", async () => {
    const o = await env.nouvelleOrganisation();
    const moi = (await env.api("GET", "/moi", o.jeton)).corps.id;
    await env.api("POST", "/regles-auto", o.jeton, { entiteId: G(o), nom: "T", evenement: "prospect.capte", titre: "Vérifier", assigneA: moi, action: "ticket" });
    const f = (await env.api("POST", "/formulaires-capture", o.jeton, { entiteId: G(o), titre: "O", source: "S" })).corps;
    await env.app.inject({ method: "POST", url: `/capture/${encodeURIComponent(f.lien.split("c=")[1])}`, payload: { nom: "A", consentement: true, telephone: "699000555" }, remoteAddress: "10.8.1.1" });
    await env.app.executerTaches(o.organisationId);
    expect((await env.api("GET", "/tickets", o.jeton)).corps.some((t: { sujet: string }) => t.sujet === "Vérifier")).toBe(true);
  });
});
describe("console", () => {
  const K = (m: string, url: string, cle: string | null, payload?: object) => app.inject({ method: m as "GET", url, headers: cle ? { "x-console-cle": cle } : {}, ...(payload ? { payload } : {}) });
  it("refuse sans clé, fermée sans réglage, crée, limite et suspend", async () => {
    expect((await K("GET", "/console/organisations", null)).statusCode).toBe(401);
    expect((await K("GET", "/console/organisations", "fausse")).statusCode).toBe(401);
    expect((await env.app.inject({ method: "GET", url: "/console/organisations" })).statusCode).toBe(404);
    const slug = `cl${Math.random().toString(36).slice(2, 10)}`;
    const email = `${slug}@test.cm`;
    const c = await K("POST", "/console/organisations", "cle-de-test-longue", { slug, nom: "Client SaaS", plan: "essentiel", adminEmail: email, adminNom: "A", adminMotDePasse: MOT_DE_PASSE });
    expect(c.statusCode).toBe(201);
    expect((await K("POST", "/console/organisations", "cle-de-test-longue", { slug, nom: "X", plan: "essentiel", adminEmail: email, adminNom: "A", adminMotDePasse: MOT_DE_PASSE })).json().erreur).toBe("organisation_existante");
    expect((await K("GET", "/console/organisations", "cle-de-test-longue")).json().find((o: { slug: string }) => o.slug === slug)).toMatchObject({ plan: "essentiel", utilisateurs: 1 });
    const jeton = await env.connecter(slug, email);
    expect((await env.api("GET", "/abonnement", jeton)).corps).toMatchObject({ plan: "essentiel", max_utilisateurs: 10, utilisateurs: 1 });
    await K("PATCH", `/console/organisations/${c.json().id}`, "cle-de-test-longue", { statut: "suspendue" });
    expect((await env.api("GET", "/moi", jeton)).statut).toBe(401);
  });
});
