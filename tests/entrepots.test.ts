import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { signalerExpirations } from "../src/entrepots.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;

async function magasins() {
  const o = await env.nouvelleOrganisation();
  const G = o.entites.GLOMARI!;
  const lieu = async (nom: string, type = "entrepot") => (await env.api("POST", "/magasins", o.jeton, { parentId: G, nom, type })).corps.id as string;
  const A = await lieu("Entrepôt Akwa"), B = await lieu("Magasin Bonapriso", "point_de_vente");
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const compte = async (role: string, entiteId: string) => {
    const email = `${role}${Math.random().toString(36).slice(2)}@test.cm`;
    await env.api("POST", "/utilisateurs", o.jeton, { email, nom: role, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((r: { code: string }) => r.code === role).id });
    return env.connecter(o.slug, email);
  };
  const article = async (code: string, nom: string, unite = "pièce") =>
    (await env.api("POST", "/produits", o.jeton, { entiteId: G, code, nom, unite, prixVente: 1000, suiviStock: true, seuilAlerte: 2 })).corps.id as string;
  const entrer = (entiteId: string, produitId: string, quantite: number, coutUnitaire = 500) =>
    env.api("POST", "/stocks/mouvements", o.jeton, { entiteId, produitId, type: "entree", quantite, coutUnitaire });
  return { ...o, G, A, B, compte, article, entrer };
}
const etat = async (jeton: string, q = "") => (await env.api("GET", `/entrepots/etat${q ? `?${q}` : ""}`, jeton)).corps;
const dans = <R>(o: Org, f: (c: Parameters<Parameters<typeof dansOrganisation>[2]>[0]) => Promise<R>) => dansOrganisation(env.poolApp, o.organisationId, f);

describe("entrepôts et magasins", () => {
  it("classe les articles par catégorie et sous-catégorie, avec unité, type de colis et pièces", async () => {
    const o = await magasins();
    const cat = await env.api("POST", "/categories-articles", o.jeton, { entiteId: o.G, nom: "Alimentation" });
    expect(cat.statut).toBe(201);
    const sous = await env.api("POST", "/categories-articles", o.jeton, { entiteId: o.A, nom: "Boissons", parentId: cat.corps.id });
    expect(sous.corps).toMatchObject({ parent_id: cat.corps.id, branche_id: o.G });
    expect((await env.api("POST", "/categories-articles", o.jeton, { entiteId: o.G, nom: "alimentation" })).corps.erreur).toBe("categorie_existante");
    expect((await env.api("POST", "/categories-articles", o.jeton, { entiteId: o.G, nom: "Jus", parentId: sous.corps.id })).corps.erreur).toBe("categorie_trop_profonde");
    // GTA ne gère pas de stock : pas de catégories d'articles.
    expect((await env.api("POST", "/categories-articles", o.jeton, { entiteId: o.entites.GTA, nom: "Livres" })).corps.erreur).toBe("module_inactif");
    const magasinier = await o.compte("magasinier", o.A);
    expect((await env.api("POST", "/categories-articles", magasinier, { entiteId: o.G, nom: "Hygiène" })).statut).toBe(403);
    expect((await env.api("GET", "/categories-articles", magasinier)).corps.map((c: { nom: string }) => c.nom)).toEqual(["Alimentation", "Boissons"]);
    const formateur = await o.compte("formateur", o.entites.GTA!);
    expect((await env.api("GET", "/categories-articles", formateur)).statut).toBe(403);

    const p = await o.article("JUS1", "Jus d'ananas", "carton");
    const c = await env.api("PUT", `/produits/${p}/classement`, o.jeton, { categorieId: sous.corps.id, unite: "ballot", typeColis: "ballot", piecesParUnite: 24 });
    expect(c.corps).toMatchObject({ categorie_id: sous.corps.id, unite: "ballot", type_colis: "ballot", pieces_par_unite: 24 });
    expect((await env.api("PUT", `/produits/${p}/classement`, magasinier, { unite: "litre" })).statut).toBe(403);
    const autre = await env.nouvelleOrganisation();
    const pa = (await env.api("POST", "/produits", autre.jeton, { entiteId: autre.entites.GLOMARI, code: "X", nom: "X" })).corps.id;
    expect((await env.api("PUT", `/produits/${pa}/classement`, autre.jeton, { categorieId: sous.corps.id })).corps.erreur).toBe("categorie_autre_branche");
    // Un article créé avec son classement : la catégorie du module Stocks se retrouve dans le catalogue de la facturation.
    const riz = await env.api("POST", "/produits", o.jeton, { entiteId: o.G, code: "RIZ", nom: "Riz", unite: "sac", suiviStock: true, categorieId: cat.corps.id, typeColis: "sac", piecesParUnite: 1 });
    expect(riz.corps).toMatchObject({ categorie_id: cat.corps.id, type_colis: "sac", unite: "sac" });
    expect((await env.api("POST", "/produits", autre.jeton, { entiteId: autre.entites.GLOMARI, code: "Y", nom: "Y", categorieId: cat.corps.id })).corps.erreur).toBe("categorie_autre_branche");
    const catalogue = (await env.api("GET", "/produits", o.jeton)).corps;
    expect(catalogue.find((x: { code: string }) => x.code === "JUS1")).toMatchObject({ categorie: "Alimentation › Boissons", unite: "ballot", type_colis: "ballot", pieces_par_unite: 24 });
    expect(catalogue.find((x: { code: string }) => x.code === "RIZ").categorie).toBe("Alimentation");
    const refs = (await env.api("GET", "/entrepots/references", o.jeton)).corps;
    expect(refs.unites).toEqual(expect.arrayContaining(["kilogramme", "litre", "colis", "ballot"]));
    expect((await env.api("GET", "/categories-articles", o.jeton)).corps.find((x: { nom: string }) => x.nom === "Alimentation").articles).toBe(2);
  });

  it("donne par entrepôt la quantité réelle, les pièces, la valeur et les totaux par catégorie, avec filtres", async () => {
    const o = await magasins();
    const cat = (await env.api("POST", "/categories-articles", o.jeton, { entiteId: o.G, nom: "Alimentation" })).corps.id;
    const sous = (await env.api("POST", "/categories-articles", o.jeton, { entiteId: o.G, nom: "Boissons", parentId: cat })).corps.id;
    const jus = await o.article("JUS1", "Jus d'ananas"), riz = await o.article("RIZ1", "Riz parfumé"), savon = await o.article("SAV1", "Savon");
    await env.api("PUT", `/produits/${jus}/classement`, o.jeton, { categorieId: sous, unite: "carton", typeColis: "carton", piecesParUnite: 24 });
    await env.api("PUT", `/produits/${riz}/classement`, o.jeton, { categorieId: cat, unite: "sac", typeColis: "sac", piecesParUnite: 1 });
    await o.entrer(o.A, jus, 10, 6000); await o.entrer(o.A, riz, 4, 20000); await o.entrer(o.B, jus, 2, 6000); await o.entrer(o.B, savon, 50, 200);
    await env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: o.A, produitId: riz, type: "sortie", quantite: 3, motif: "Don" });

    const e = await etat(o.jeton);
    const ligne = (l: { entite: string; code: string }[], entite: string, code: string) => l.find((x) => x.entite === entite && x.code === code);
    expect(ligne(e.lignes, "Entrepôt Akwa", "JUS1")).toMatchObject({ quantite: 10, pieces: 240, valeur: 60000, unite: "carton", type_colis: "carton", categorie: "Alimentation", sous_categorie: "Boissons", en_alerte: false, entrees: 10, sorties: 0 });
    expect(ligne(e.lignes, "Entrepôt Akwa", "RIZ1")).toMatchObject({ quantite: 1, pieces: 1, valeur: 20000, categorie: "Alimentation", sous_categorie: null, en_alerte: true, entrees: 4, sorties: 3 });
    expect(e.entrepots).toEqual([
      expect.objectContaining({ entite: "Entrepôt Akwa", type_lieu: "entrepot", articles: 2, quantite: 11, pieces: 241, valeur: 80000 }),
      expect.objectContaining({ entite: "Magasin Bonapriso", type_lieu: "point_de_vente", articles: 2, quantite: 52, pieces: 98, valeur: 22000 }),
    ]);
    expect(e.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ categorie: "Alimentation", sous_categorie: "Boissons", articles: 2, pieces: 288, valeur: 72000 }),
      expect.objectContaining({ categorie: "Alimentation", sous_categorie: null, articles: 1, pieces: 1 }),
      expect.objectContaining({ categorie: "Sans catégorie", articles: 1, pieces: 50 }),
    ]));
    expect(e.colis).toEqual(expect.arrayContaining([expect.objectContaining({ entite: "Entrepôt Akwa", type_colis: "carton", quantite: 10 }), expect.objectContaining({ entite: "Magasin Bonapriso", type_colis: "Non précisé", quantite: 50 })]));

    // Filtres : par magasin, par nom, par catégorie (avec ses sous-catégories), par état, par date.
    expect((await etat(o.jeton, `entiteId=${o.B}`)).lignes.map((l: { code: string }) => l.code).sort()).toEqual(["JUS1", "SAV1"]);
    expect((await etat(o.jeton, "q=riz")).lignes.map((l: { code: string }) => l.code)).toEqual(["RIZ1"]);
    expect((await etat(o.jeton, `categorieId=${cat}`)).lignes).toHaveLength(3);
    expect((await etat(o.jeton, `categorieId=${sous}`)).lignes).toHaveLength(2);
    // Sous le seuil d'alerte (2) : le riz à Akwa (1) et le jus à Bonapriso (2).
    expect((await etat(o.jeton, "etat=alerte")).lignes.map((l: { entite: string; code: string }) => `${l.code} ${l.entite}`)).toEqual(["RIZ1 Entrepôt Akwa", "JUS1 Magasin Bonapriso"]);
    // Hier, rien n'était encore entré : le stock à cette date est nul.
    const hier = new Date(Date.now() + 3600_000 - 86_400_000).toISOString().slice(0, 10);
    expect((await etat(o.jeton, `du=${hier}&au=${hier}`)).lignes.every((l: { quantite: number; entrees: number }) => l.quantite === 0 && l.entrees === 0)).toBe(true);
    expect((await env.api("GET", `/entrepots/etat?du=2026-02-01&au=2026-01-01`, o.jeton)).statut).toBe(400);

    // Droits : le magasinier ne voit que son entrepôt, sans la valeur ; le responsable des magasins voit la valeur.
    const magasinier = await o.compte("magasinier", o.A);
    const m = await etat(magasinier);
    expect(m.entrepots.map((x: { entite: string; valeur: number | null }) => [x.entite, x.valeur])).toEqual([["Entrepôt Akwa", null]]);
    expect((await etat(magasinier, `entiteId=${o.B}`)).lignes).toEqual([]);
    const responsable = await o.compte("responsable_magasins", o.G);
    expect((await etat(responsable)).entrepots.map((x: { valeur: number }) => x.valeur)).toEqual([80000, 22000]);
    const formateur = await o.compte("formateur", o.entites.GTA!);
    expect((await env.api("GET", "/entrepots/etat", formateur)).statut).toBe(403);
    const autre = await env.nouvelleOrganisation();
    expect((await etat(autre.jeton, `entiteId=${o.A}`)).lignes).toEqual([]);
  });

  it("met de côté les articles avariés : plus vendables, puis sortis en perte ou remis en vente", async () => {
    const o = await magasins();
    const p = await o.article("TV1", "Téléviseur");
    await o.entrer(o.A, p, 10, 50000);
    const magasinier = await o.compte("magasinier", o.A);
    const caissier = await o.compte("caissier", o.A);
    expect((await env.api("POST", "/avaries", caissier, { entiteId: o.A, produitId: p, quantite: 1, motif: "Écran cassé" })).statut).toBe(403);
    expect((await env.api("POST", "/avaries", magasinier, { entiteId: o.B, produitId: p, quantite: 1, motif: "Écran cassé" })).statut).toBe(403);
    const a = await env.api("POST", "/avaries", magasinier, { entiteId: o.A, produitId: p, quantite: 3, motif: "Écran cassé au déchargement" });
    expect(a.statut).toBe(201);
    expect((await env.api("POST", "/avaries", magasinier, { entiteId: o.A, produitId: p, quantite: 8, motif: "Trop" })).corps.erreur).toBe("stock_insuffisant");
    expect((await etat(o.jeton, "etat=avarie")).lignes).toEqual([expect.objectContaining({ code: "TV1", quantite: 10, avarie: 3 })]);
    // Les 3 avariés ne sortent plus : 8 est refusé, 7 passe.
    const sortir = (quantite: number) => env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: o.A, produitId: p, type: "sortie", quantite, motif: "Vente directe" });
    expect((await sortir(8)).corps.erreur).toBe("stock_insuffisant");
    expect((await sortir(7)).statut).toBe(201);
    const d = await env.api("POST", `/avaries/${a.corps.id}/decision`, magasinier, { decision: "sortie", note: "Irréparable" });
    expect(d.corps).toEqual({ statut: "sortie", valeur: 150000 });
    expect((await env.api("POST", `/avaries/${a.corps.id}/decision`, magasinier, { decision: "remise" })).corps.erreur).toBe("deja_decide");
    expect((await etat(o.jeton)).lignes[0]).toMatchObject({ quantite: 0, avarie: 0 });
    // Remise en vente : la quantité redevient disponible.
    await o.entrer(o.A, p, 2, 50000);
    const b = await env.api("POST", "/avaries", magasinier, { entiteId: o.A, produitId: p, quantite: 2, motif: "Carton mouillé" });
    expect((await sortir(1)).corps.erreur).toBe("stock_insuffisant");
    expect((await env.api("POST", `/avaries/${b.corps.id}/decision`, magasinier, { decision: "remise" })).corps).toEqual({ statut: "remise", valeur: 0 });
    expect((await sortir(1)).statut).toBe(201);
    expect((await env.api("GET", "/avaries", magasinier)).corps.map((x: { statut: string }) => x.statut).sort()).toEqual(["remise", "sortie"]);
  });

  it("signale en rouge les articles expirés et prévient une fois ceux qui gèrent le stock", async () => {
    const o = await magasins();
    const lait = await o.article("LAIT1", "Lait"), yaourt = await o.article("YAO1", "Yaourt"), sel = await o.article("SEL1", "Sel");
    const jour = (n: number) => new Date(Date.now() + 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
    const lot = (produitId: string, numero: string, peremption: string, quantite: number) => env.api("POST", "/lots", o.jeton, { entiteId: o.A, produitId, numero, peremption, quantite, coutUnitaire: 300 });
    expect((await lot(lait, "L1", jour(-2), 5)).statut).toBe(201);
    await lot(lait, "L2", jour(200), 5);
    await lot(yaourt, "Y1", jour(10), 8);
    await lot(sel, "S1", jour(400), 3);
    const e = await etat(o.jeton);
    const par = Object.fromEntries(e.lignes.map((l: { code: string }) => [l.code, l]));
    expect(par.LAIT1).toMatchObject({ quantite: 10, perime: 5, expiration: jour(-2), expiration_etat: "perime" });
    expect(par.YAO1).toMatchObject({ perime: 0, jours_restants: 10, expiration_etat: "expire" });
    expect(par.SEL1).toMatchObject({ expiration_etat: null });
    expect(e.entrepots[0]).toMatchObject({ perime: 5 });
    expect((await etat(o.jeton, "etat=perime")).lignes.map((l: { code: string }) => l.code)).toEqual(["LAIT1"]);
    expect((await etat(o.jeton, "etat=expire")).lignes.map((l: { code: string }) => l.code).sort()).toEqual(["LAIT1", "YAO1"]);

    const magasinier = await o.compte("magasinier", o.A);
    const ailleurs = await o.compte("magasinier", o.B);
    expect(await dans(o, (c) => signalerExpirations(c))).toBe(2);
    await dans(o, (c) => signalerExpirations(c));
    const messages = (await env.api("GET", "/moi/messages", magasinier)).corps;
    expect(messages.map((m: { texte: string; niveau: string }) => [m.niveau, m.texte.split(" :")[0]]).sort()).toEqual([["important", "Expiration proche"], ["urgent", "Article expiré"]]);
    expect((await env.api("GET", "/moi/messages", ailleurs)).corps).toEqual([]);
  });

  it("importe les articles avec catégories, colis et stock compté, sans rien doubler", async () => {
    const o = await magasins();
    const lignes = [
      { code: "RIZ1", nom: "Riz parfumé 25 kg", prixVente: 21000, unite: "sac", categorie: "Alimentation", sousCategorie: "Céréales", typeColis: "sac", piecesParUnite: 1, quantite: 40, coutUnitaire: 18000 },
      { code: "HUI1", nom: "Huile 1 L", prixVente: 1500, unite: "carton", categorie: "Alimentation", typeColis: "carton", piecesParUnite: 12, quantite: 6, coutUnitaire: 15000 },
      { code: "SRV1", nom: "Article sans stock", prixVente: 500 },
    ];
    expect((await env.api("POST", "/produits/import", o.jeton, { entiteId: o.G, lignes })).corps.erreur).toBe("import_invalide");
    const r = await env.api("POST", "/produits/import", o.jeton, { entiteId: o.G, depotId: o.A, lignes });
    expect(r.corps).toEqual({ crees: 3, maj: 0, stocks: 2 });
    // Le même fichier relancé ne change rien ; une quantité corrigée ramène le stock au nombre compté.
    expect((await env.api("POST", "/produits/import", o.jeton, { entiteId: o.G, depotId: o.A, lignes })).corps).toEqual({ crees: 0, maj: 3, stocks: 0 });
    lignes[0]!.quantite = 35;
    expect((await env.api("POST", "/produits/import", o.jeton, { entiteId: o.G, depotId: o.A, lignes })).corps.stocks).toBe(1);
    const e = await etat(o.jeton);
    expect(e.lignes.map((l: { code: string; quantite: number; pieces: number; categorie: string; sous_categorie: string | null }) => [l.code, l.quantite, l.pieces, l.categorie, l.sous_categorie]).sort())
      .toEqual([["HUI1", 6, 72, "Alimentation", null], ["RIZ1", 35, 35, "Alimentation", "Céréales"]]);
    expect(e.entrepots[0]).toMatchObject({ valeur: 35 * 18000 + 6 * 15000 });
    expect((await env.api("GET", "/categories-articles", o.jeton)).corps.map((c: { nom: string }) => c.nom)).toEqual(["Alimentation", "Céréales"]);
    // Fixer un stock demande le droit de valider le stock du lieu, dans la même branche.
    const achats = await o.compte("acheteur", o.G);
    expect((await env.api("POST", "/produits/import", achats, { entiteId: o.G, depotId: o.A, lignes })).statut).toBe(403);
    expect((await env.api("POST", "/produits/import", achats, { entiteId: o.G, lignes: [{ code: "NEW", nom: "Nouveau", prixVente: 100, categorie: "Hygiène" }] })).statut).toBe(201);
    expect((await env.api("POST", "/produits/import", o.jeton, { entiteId: o.G, depotId: o.entites.GTA, lignes })).statut).toBeGreaterThanOrEqual(403);
  });
});
