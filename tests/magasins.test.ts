import { afterAll, describe, expect, it } from "vitest";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;

async function utilisateur(o: Org, code: string, entiteId: string) {
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
  const r = await env.api("POST", "/utilisateurs", o.jeton, {
    email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((x: { code: string }) => x.code === code).id,
  });
  return r.statut === 201 ? await env.connecter(o.slug, email) : r.corps.erreur as string;
}
const creer = (o: Org, nom: string, jeton = o.jeton, parentId = o.entites.GLOMARI, type = "point_de_vente") =>
  env.api("POST", "/magasins", jeton, { parentId, nom, type });

async function article(o: Org) {
  const p = await env.api("POST", "/produits", o.jeton, { entiteId: o.entites.GLOMARI, code: "SAC", nom: "Sac", suiviStock: true, prixVente: 1000 });
  return p.corps.id as string;
}
const quantite = async (o: Org, produitId: string, entiteId: string) =>
  (await env.api("GET", "/stocks", o.jeton)).corps.find((n: { produit_id: string; entite_id: string }) => n.produit_id === produitId && n.entite_id === entiteId)?.quantite ?? 0;

describe("magasins et points de vente", () => {
  it("crée autant de lieux que voulu, prêts à recevoir du stock et à vendre", async () => {
    const o = await env.nouvelleOrganisation();
    const noms = ["Akwa", "Bonamoussadi", "Bastos", "Dépôt central"];
    const crees = await Promise.all(noms.map((n) => creer(o, n)));
    expect(crees.every((c) => c.statut === 201)).toBe(true);
    expect(new Set(crees.map((c) => c.corps.code)).size).toBe(4);
    const p = await article(o);
    const m = crees[0]!.corps.id;
    expect((await env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: m, produitId: p, type: "entree", quantite: 1, coutUnitaire: 1 })).statut).toBe(201);
    expect((await env.api("GET", "/magasins", o.jeton)).corps).toHaveLength(4);
  });

  it("n'existe que chez GLOMARI, et selon les droits", async () => {
    const o = await env.nouvelleOrganisation();
    expect((await creer(o, "X", o.jeton, o.entites.GTA)).statut).toBe(403);
    expect(await utilisateur(o, "responsable_magasins", o.entites.GTA!)).toBe("role_incompatible");
    const resp = await utilisateur(o, "responsable_magasins", o.entites.GLOMARI!) as string;
    expect((await creer(o, "Akwa", resp)).statut).toBe(201);
    const magasinier = await utilisateur(o, "magasinier", o.entites.GLOMARI!) as string;
    expect((await creer(o, "Interdit", magasinier)).statut).toBe(403);
    const gta = await utilisateur(o, "administrateur", o.entites.GTA!) as string;
    expect((await env.api("GET", "/magasins", gta)).statut).toBe(403);
    const autre = await env.nouvelleOrganisation();
    expect((await creer(autre, "X", autre.jeton, o.entites.GLOMARI)).statut).toBe(404);
    expect((await env.api("GET", "/magasins", autre.jeton)).corps).toEqual([]);
  });

  it("un responsable de magasin ne voit que son lieu", async () => {
    const o = await env.nouvelleOrganisation();
    const a = await creer(o, "A");
    const b = await creer(o, "B");
    const p = await article(o);
    await env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: b.corps.id, produitId: p, type: "entree", quantite: 2, coutUnitaire: 1 });
    const local = await utilisateur(o, "magasinier", a.corps.id) as string;
    expect((await env.api("GET", "/stocks", local)).corps).toEqual([]);
    expect((await env.api("POST", "/stocks/mouvements", local, { entiteId: b.corps.id, produitId: p, type: "sortie", quantite: 1, motif: "Vol" })).statut).toBe(403);
  });

  it("refuse de désactiver un lieu avec du stock, puis garde l'historique", async () => {
    const o = await env.nouvelleOrganisation();
    const m = await creer(o, "Akwa");
    const p = await article(o);
    const entree = { entiteId: m.corps.id, produitId: p, quantite: 1 };
    await env.api("POST", "/stocks/mouvements", o.jeton, { ...entree, type: "entree", coutUnitaire: 1 });
    const url = `/magasins/${m.corps.id}`;
    expect((await env.api("PATCH", url, o.jeton, { actif: false })).corps.erreur).toBe("magasin_non_vide");
    await env.api("POST", "/stocks/mouvements", o.jeton, { ...entree, type: "sortie", motif: "Vente" });
    expect((await env.api("PATCH", url, o.jeton, { actif: false })).corps.actif).toBe(false);
    expect((await env.api("POST", "/stocks/mouvements", o.jeton, { ...entree, type: "entree", coutUnitaire: 1 })).statut).toBe(403);
    expect((await env.api("GET", "/magasins", o.jeton)).corps[0].actif).toBe(false);
    expect((await env.api("PATCH", url, o.jeton, { actif: true })).corps.actif).toBe(true);
    expect((await env.api("POST", "/stocks/mouvements", o.jeton, { ...entree, type: "entree", coutUnitaire: 1 })).statut).toBe(201);
  });
});

describe("mise à jour automatique du stock", () => {
  it("achat, transfert et vente confirmés font bouger le stock sans aucune autre saisie", async () => {
    const o = await env.nouvelleOrganisation();
    const depot = (await creer(o, "Dépôt", o.jeton, o.entites.GLOMARI, "entrepot")).corps.id as string;
    const magasin = (await creer(o, "Akwa")).corps.id as string;
    await env.api("PATCH", `/entites/${magasin}/identite`, o.jeton, { raisonSociale: "GLOMARI Sarl", niu: "N1" });
    const p = await article(o);
    const f = await env.api("POST", "/tiers", o.jeton, { type: "entreprise", nom: "Fournisseur" });

    const c = await env.api("POST", "/achats/commandes", o.jeton, { entiteId: depot, fournisseurId: f.corps.id, date: "2026-03-01", lignes: [{ produitId: p, quantite: 10, prixUnitaire: 500 }] });
    const url = `/achats/commandes/${c.corps.id}`;
    expect(await quantite(o, p, depot)).toBe(0);
    await env.api("POST", `${url}/approbation`, o.jeton);
    const ligneId = (await env.api("GET", url, o.jeton)).corps.lignes[0].id;
    await env.api("POST", `${url}/receptions`, o.jeton, { lignes: [{ ligneId, quantite: 10 }] });
    expect(await quantite(o, p, depot)).toBe(10);

    const t = await env.api("POST", "/transferts", o.jeton, { depuisId: depot, versId: magasin, lignes: [{ produitId: p, quantite: 6 }] });
    expect(await quantite(o, p, depot)).toBe(10);
    await env.api("POST", `/transferts/${t.corps.id}/expedition`, o.jeton);
    expect(await quantite(o, p, depot)).toBe(4);
    await env.api("POST", `/transferts/${t.corps.id}/reception`, o.jeton, { lignes: [{ produitId: p, quantiteRecue: 6 }] });
    expect(await quantite(o, p, magasin)).toBe(6);

    const client = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Client" });
    const b = await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: magasin, tiersId: client.corps.id, date: "2026-03-05", lignes: [{ produitId: p, quantite: 2 }] });
    expect(await quantite(o, p, magasin)).toBe(6); // Un brouillon ne touche pas au stock.
    expect((await env.api("POST", `/documents-vente/${b.corps.id}/emission`, o.jeton)).statut).toBe(200);
    expect(await quantite(o, p, magasin)).toBe(4);
    expect(await quantite(o, p, depot)).toBe(4);
  });

});
