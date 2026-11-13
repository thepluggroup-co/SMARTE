import { afterAll, describe, expect, it } from "vitest";
import { coutRevient } from "../src/logistique.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";
const env = await environnement();
afterAll(() => env.fermer());
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
const G = (o: Org) => o.entites.GLOMARI!;
const j = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
async function compte(o: Org, code: string, entiteId: string) {
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
  await env.api("POST", "/utilisateurs", o.jeton, { email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((x: { code: string }) => x.code === code).id });
  return env.connecter(o.slug, email);
}
const stock = async (o: Org, q: number) => { const p = (await env.api("POST", "/produits", o.jeton, { entiteId: G(o), code: `P${Math.floor(Math.random() * 1e6)}`, nom: "Savon", prixVente: 1000, suiviStock: true })).corps.id as string; if (q) await env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: G(o), produitId: p, type: "entree", quantite: q, coutUnitaire: 500 }); return p; };
const niv = async (o: Org, p: string) => { const s = (await env.api("GET", `/stocks?entiteId=${G(o)}`, o.jeton)).corps; const l = (Array.isArray(s) ? s : s.lignes).find((x: { produit_id?: string; id?: string }) => (x.produit_id ?? x.id) === p); return Number(l.quantite ?? l.stock ?? l.niveau); };
describe("prix et catalogue", () => {
  it("le prix négocié prime, jamais sous le coût", async () => {
    const o = await env.nouvelleOrganisation();
    const p = await stock(o, 10);
    const t = (await env.api("POST", "/tiers", o.jeton, { type: "entreprise", nom: "Gros", entiteId: G(o) })).corps.id;
    expect((await env.api("PUT", `/tiers/${t}/prix`, o.jeton, { produitId: p, prix: 100 })).corps.erreur).toBe("palier_sous_le_cout");
    await env.api("PUT", `/tiers/${t}/prix`, o.jeton, { produitId: p, prix: 800 });
    const d = await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: G(o), tiersId: t, date: j(0), lignes: [{ produitId: p, quantite: 2 }] });
    expect((await env.api("GET", `/documents-vente/${d.corps.id}`, o.jeton)).corps.total_ht).toBe(1600);
  });
  it("importe le catalogue, met à jour, refuse les doublons du fichier", async () => {
    const o = await env.nouvelleOrganisation();
    const I = (lignes: object[]) => env.api("POST", "/produits/import", o.jeton, { entiteId: G(o), lignes });
    expect((await I([{ code: "A", nom: "A", prixVente: 1 }, { code: "A", nom: "B", prixVente: 2 }])).corps.erreur).toBe("import_invalide");
    expect((await I([{ code: "A", nom: "A", prixVente: 1 }, { code: "B", nom: "B", prixVente: 2 }])).corps).toMatchObject({ crees: 2, maj: 0 });
    expect((await I([{ code: "A", nom: "A2", prixVente: 5 }])).corps).toMatchObject({ crees: 0, maj: 1 });
    expect((await env.api("GET", "/produits?q=A2", o.jeton)).corps[0].prix_vente).toBe(5);
  });
  it("le portail respecte minimum et multiple", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("PATCH", `/entites/${G(o)}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const p = await stock(o, 100);
    const t = (await env.api("POST", "/tiers", o.jeton, { type: "entreprise", nom: "Gros", entiteId: G(o) })).corps.id;
    await env.api("PUT", `/tiers/${t}/compte-pro`, o.jeton, { entiteId: G(o), categorie: "grossiste", plafondCredit: 1000000, delaiJours: 30 });
    const code = new URL((await env.api("POST", `/tiers/${t}/portail`, o.jeton, { entiteId: G(o), actif: true })).corps.lien).searchParams.get("c");
    await env.api("PUT", `/produits/${p}/gros`, o.jeton, { quantiteMin: 12, multiple: 12, conditionnements: [{ nom: "Carton", facteur: 12 }] });
    const C = (q: number) => env.api("POST", `/portail/${code}/commandes`, undefined, { lignes: [{ produitId: p, quantite: q }] });
    expect((await C(6)).corps.erreur).toBe("quantite_minimale");
    expect((await C(13)).corps.erreur).toBe("multiple_obligatoire");
    expect((await C(24)).statut).toBe(201);
  });
});
describe("entrepôt", () => {
  it("l'inventaire passe l'écart seulement après validation par une autre personne", async () => {
    const o = await env.nouvelleOrganisation();
    const p = await stock(o, 10);
    const i = (await env.api("POST", "/inventaires", o.jeton, { entiteId: G(o), libelle: "Novembre" })).corps.id;
    await env.api("PUT", `/inventaires/${i}/lignes`, o.jeton, { produitId: p, compte: 7 });
    expect((await env.api("GET", `/inventaires/${i}`, o.jeton)).corps.lignes[0].ecart).toBe(-3);
    expect((await env.api("POST", `/inventaires/${i}/validation`, o.jeton)).corps.erreur).toBe("separation_des_taches");
    expect(await niv(o, p)).toBe(10);
    const a = await compte(o, "administrateur", G(o));
    expect((await env.api("POST", `/inventaires/${i}/validation`, a)).corps.ecarts).toBe(1);
    expect(await niv(o, p)).toBe(7);
    expect((await env.api("PUT", `/inventaires/${i}/lignes`, o.jeton, { produitId: p, compte: 1 })).corps.erreur).toBe("inventaire_valide");
  });
  it("réserve dans la limite du disponible, trace les séries, retourne au fournisseur", async () => {
    const o = await env.nouvelleOrganisation();
    const p = await stock(o, 5);
    const R = (q: number) => env.api("POST", "/reservations-stock", o.jeton, { entiteId: G(o), produitId: p, quantite: q });
    const r = await R(4);
    expect(r.statut).toBe(201);
    expect((await R(2)).corps.erreur).toBe("stock_insuffisant");
    await env.api("POST", `/reservations-stock/${r.corps.id}/levee`, o.jeton);
    expect((await R(2)).statut).toBe(201);
    expect((await env.api("POST", `/produits/${p}/series`, o.jeton, { numeros: ["S1", "S2", "S1"] })).corps).toEqual({ crees: 2, doublons: 1 });
    const s = (await env.api("GET", "/series?numero=S1", o.jeton)).corps[0];
    const t = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "C", entiteId: G(o) })).corps.id;
    expect((await env.api("POST", `/series/${s.id}/vente`, o.jeton, { tiersId: t })).corps.vendu).toBe(true);
    expect((await env.api("POST", `/series/${s.id}/vente`, o.jeton, { tiersId: t })).corps.erreur).toBe("serie_deja_vendue");
    expect((await env.api("POST", "/retours-fournisseur", o.jeton, { entiteId: G(o), fournisseurId: t, produitId: p, quantite: 1, motif: "Produit abîmé" })).statut).toBe(201);
    expect(await niv(o, p)).toBe(4);
  });
});
describe("achats", () => {
  it("demande un motif si l'offre n'est pas la moins chère, calcule le coefficient", async () => {
    expect(coutRevient(1000, 250, 100)).toBe(125);
    const o = await env.nouvelleOrganisation();
    const d = (await env.api("POST", "/demandes-prix", o.jeton, { entiteId: G(o), objet: "Cartons" })).corps.id;
    const F = async (n: string) => (await env.api("POST", "/tiers", o.jeton, { type: "entreprise", nom: n, entiteId: G(o) })).corps.id;
    const a = (await env.api("POST", `/demandes-prix/${d}/offres`, o.jeton, { fournisseurId: await F("A"), montant: 100 })).corps.id;
    const b = (await env.api("POST", `/demandes-prix/${d}/offres`, o.jeton, { fournisseurId: await F("B"), montant: 200 })).corps.id;
    expect(a).toBeTruthy();
    expect((await env.api("POST", `/demandes-prix/${d}/attribution`, o.jeton, { offreId: b })).corps.erreur).toBe("motif_obligatoire");
    expect((await env.api("POST", `/demandes-prix/${d}/attribution`, o.jeton, { offreId: b, motif: "Livraison plus sûre" })).corps.attribuee).toBe(true);
    const x = (await env.api("POST", "/dossiers-import", o.jeton, { entiteId: G(o), reference: "IMP1", valeurMarchandise: 1000 })).corps.id;
    await env.api("POST", `/dossiers-import/${x}/frais`, o.jeton, { nature: "douane", montant: 250 });
    expect((await env.api("GET", "/dossiers-import", o.jeton)).corps[0]).toMatchObject({ frais: 250, coefficient: 1.25 });
  });
});
