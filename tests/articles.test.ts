import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { cleEan13, ean13Valide, unitesArticle } from "../src/articles.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
// PNG d'un pixel, pour les photos.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function magasin() {
  const o = await env.nouvelleOrganisation();
  const G = o.entites.GLOMARI!;
  const M = (await env.api("POST", "/magasins", o.jeton, { parentId: G, nom: "Akwa", type: "point_de_vente" })).corps.id as string;
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const compte = async (role: string, entiteId: string) => {
    const email = `${role}${Math.random().toString(36).slice(2)}@test.cm`;
    await env.api("POST", "/utilisateurs", o.jeton, { email, nom: role, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((r: { code: string }) => r.code === role).id });
    return env.connecter(o.slug, email);
  };
  const article = async (corps: object) => (await env.api("POST", "/produits", o.jeton, { entiteId: G, suiviStock: true, ...corps })).corps;
  const entrer = (produitId: string, quantite: number) => env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: M, produitId, type: "entree", quantite, coutUnitaire: 100 });
  const stock = async (produitId: string) => (await env.api("GET", "/caisse", o.jeton)).corps.ouvertes[0].stocks[produitId];
  return { ...o, G, M, compte, article, entrer, stock };
}
const lignesDe = (o: { organisationId: string }, table: string, cle: string, id: string) => dansOrganisation(env.poolApp, o.organisationId, async (c) =>
  (await c.query(`select quantite::float, prix_unitaire::int, unite, quantite_unite::float, prix_unite::int from ${table} where ${cle} = $1`, [id])).rows);

describe("catalogue complet", () => {
  it("calcule les unités de vente et la clé d'un EAN13", () => {
    expect(cleEan13("400638133393")).toBe(1);
    expect(ean13Valide("4006381333931")).toBe(true);
    expect(ean13Valide("4006381333932")).toBe(false);
    expect(unitesArticle({ unite: "carton", pieces_par_unite: 24, prix_piece: null, conditionnements: [{ nom: "palette", facteur: 40, prix: 900000 }, { nom: "Carton", facteur: 2 }] }))
      .toEqual([{ nom: "carton", facteur: 1, prix: null, base: true }, { nom: "palette", facteur: 40, prix: 900000, base: false }, { nom: "pièce", facteur: 1 / 24, prix: null, base: false }]);
    expect(unitesArticle({ unite: "pièce", pieces_par_unite: 1, prix_piece: null, conditionnements: null })).toHaveLength(1);
  });

  it("dessine des codes-barres EAN13 et CODE128 corrects", () => {
    const source = readFileSync(new URL("../public/codesbarres.js", import.meta.url), "utf8");
    const f = new Function(`${source}; return { ean13Valide, barresEan13, valeursCode128, barresCode128, CODE128, formatCodeBarres };`)();
    // Chaque symbole CODE128 fait 11 modules, et tous sont différents.
    expect(f.CODE128).toHaveLength(106);
    expect(f.CODE128.every((x: string) => [...x].reduce((s, c) => s + Number(c), 0) === 11)).toBe(true);
    expect(new Set(f.CODE128).size).toBe(106);
    // Exemple de référence : 5901234123457.
    expect(f.barresEan13("5901234123457")).toBe("10100010110100111011001100100110111101001110101010110011011011001000010101110010011101000100101");
    expect(f.barresEan13("5901234123458")).toBeNull();
    // « PJJ123C » en jeu B : départ 104, clé 55, 9 symboles et l'arrêt.
    expect(f.valeursCode128("PJJ123C")).toEqual([104, 48, 42, 42, 17, 18, 19, 35, 55]);
    expect(f.barresCode128("PJJ123C")).toHaveLength(9 * 11 + 13);
    expect(f.barresCode128("été")).toBeNull();
    expect([f.formatCodeBarres("5901234123457"), f.formatCodeBarres("5901234123457", "CODE128"), f.formatCodeBarres("RIZ25", "EAN13")]).toEqual(["EAN13", "CODE128", "CODE128"]);
  });

  it("gère les marques par branche et les rattache aux articles", async () => {
    const o = await magasin();
    const m = await env.api("POST", "/marques", o.jeton, { entiteId: o.M, nom: "Samsung" });
    expect(m.corps).toMatchObject({ nom: "Samsung", branche_id: o.G });
    expect((await env.api("POST", "/marques", o.jeton, { entiteId: o.G, nom: "samsung" })).corps.erreur).toBe("marque_existante");
    // GTA ne gère pas de stock : pas de marques.
    expect((await env.api("POST", "/marques", o.jeton, { entiteId: o.entites.GTA, nom: "Livres" })).corps.erreur).toBe("module_inactif");
    const caissier = await o.compte("caissier", o.M);
    expect((await env.api("POST", "/marques", caissier, { entiteId: o.G, nom: "LG" })).statut).toBe(403);
    expect((await env.api("GET", "/marques", caissier)).corps.map((x: { nom: string }) => x.nom)).toEqual(["Samsung"]);
    const formateur = await o.compte("formateur", o.entites.GTA!);
    expect((await env.api("GET", "/marques", formateur)).statut).toBe(403);

    const tv = await o.article({ code: "TV", nom: "Téléviseur", prixVente: 185000, marqueId: m.corps.id });
    expect(tv.marque_id).toBe(m.corps.id);
    const fer = await o.article({ code: "FER", nom: "Fer", prixVente: 12000 });
    expect((await env.api("PUT", `/produits/${fer.id}/classement`, o.jeton, { marqueId: m.corps.id })).corps.marque_id).toBe(m.corps.id);
    const autre = await env.nouvelleOrganisation();
    const x = (await env.api("POST", "/produits", autre.jeton, { entiteId: autre.entites.GLOMARI, code: "X", nom: "X" })).corps.id;
    expect((await env.api("PUT", `/produits/${x}/classement`, autre.jeton, { marqueId: m.corps.id })).corps.erreur).toBe("marque_autre_branche");
    expect((await env.api("POST", "/produits", autre.jeton, { entiteId: autre.entites.GLOMARI, code: "Y", nom: "Y", marqueId: m.corps.id })).corps.erreur).toBe("marque_autre_branche");
    expect((await env.api("GET", "/produits", o.jeton)).corps.find((p: { code: string }) => p.code === "TV").marque).toBe("Samsung");
    // Filtre par marque dans le module Stocks et liste des marques à la caisse.
    await o.entrer(tv.id, 3);
    const sel = await o.article({ code: "SEL", nom: "Sel", prixVente: 200 });
    await o.entrer(sel.id, 5);
    expect((await env.api("GET", `/entrepots/etat?marqueId=${m.corps.id}`, o.jeton)).corps.lignes.map((l: { code: string; marque: string }) => [l.code, l.marque])).toEqual([["TV", "Samsung"]]);
    await env.api("POST", "/caisse/ouverture", o.jeton, { entiteId: o.M, fondOuverture: 0 });
    expect((await env.api("GET", "/caisse", o.jeton)).corps.ouvertes[0].marques).toEqual([{ id: m.corps.id, nom: "Samsung" }]);
    // L'import crée la marque absente et réutilise l'existante.
    const imp = await env.api("POST", "/produits/import", o.jeton, { entiteId: o.G, lignes: [{ code: "LG1", nom: "Écran LG", prixVente: 90000, marque: "LG" }, { code: "S2", nom: "Tablette", prixVente: 80000, marque: "SAMSUNG" }] });
    expect(imp.statut).toBe(201);
    expect((await env.api("GET", "/marques", o.jeton)).corps.map((x: { nom: string; articles: number }) => [x.nom, x.articles])).toEqual([["LG", 1], ["Samsung", 3]]);
  });

  it("garde jusqu'à 4 photos par article, vérifiées et servies avec cache", async () => {
    const o = await magasin();
    const p = await o.article({ code: "A", nom: "Article" });
    const caissier = await o.compte("caissier", o.M);
    const url = (position: number) => `/produits/${p.id}/photos/${position}`;
    expect((await env.api("PUT", url(1), caissier, { image: PNG })).statut).toBe(403);
    expect((await env.api("PUT", url(1), o.jeton, { image: PNG })).corps).toEqual({ enregistre: true, position: 1 });
    expect((await env.api("PUT", url(4), o.jeton, { image: PNG })).statut).toBe(200);
    expect((await env.api("PUT", url(5), o.jeton, { image: PNG })).statut).toBe(400);
    expect((await env.api("PUT", url(2), o.jeton, { image: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" })).corps.erreur).toBe("format_image");
    const lourde = `data:image/png;base64,${Buffer.concat([Buffer.from(PNG.split(",")[1]!, "base64"), Buffer.alloc(530_000)]).toString("base64")}`;
    expect((await env.api("PUT", url(2), o.jeton, { image: lourde })).corps.erreur).toBe("image_trop_lourde");
    expect((await env.api("GET", "/produits", o.jeton)).corps[0].photos.map((f: { position: number }) => f.position)).toEqual([1, 4]);

    const lire = (jeton: string, entetes = {}) => env.app.inject({ method: "GET", url: url(1), headers: { authorization: `Bearer ${jeton}`, ...entetes } });
    const r = await lire(caissier);
    expect([r.statusCode, r.headers["content-type"], r.headers["cache-control"]]).toEqual([200, "image/png", "private, max-age=86400"]);
    expect(r.rawPayload.subarray(1, 4).toString()).toBe("PNG");
    expect((await lire(caissier, { "if-none-match": r.headers.etag })).statusCode).toBe(304);
    // Un compte de GTA ou d'une autre organisation ne voit pas la photo.
    const formateur = await o.compte("formateur", o.entites.GTA!);
    expect((await lire(formateur)).statusCode).toBe(403);
    const autre = await env.nouvelleOrganisation();
    expect((await lire(autre.jeton)).statusCode).toBe(404);
    expect((await env.app.inject({ method: "GET", url: url(1) })).statusCode).toBe(401);
    expect((await env.api("DELETE", url(1), caissier)).statut).toBe(403);
    expect((await env.api("DELETE", url(1), o.jeton)).corps).toEqual({ retire: true });
    expect((await lire(o.jeton)).statusCode).toBe(404);
  });

  it("donne un code-barres EAN13 interne, unique, aux articles qui n'en ont pas", async () => {
    const o = await magasin();
    const a = await o.article({ code: "A", nom: "Avec code auto", codeBarresAuto: true });
    expect(a.code_barres).toMatch(/^200\d{10}$/);
    expect(ean13Valide(a.code_barres)).toBe(true);
    const b = await o.article({ code: "B", nom: "Avec son propre code", codeBarres: "5901234123457", codeBarresAuto: true });
    expect(b.code_barres).toBe("5901234123457");
    const c = await o.article({ code: "C", nom: "Sans code" });
    expect(c.code_barres).toBeNull();
    const g = await env.api("POST", `/produits/${c.id}/code-barres`, o.jeton);
    expect(g.statut).toBe(201);
    expect(ean13Valide(g.corps.code_barres)).toBe(true);
    expect(g.corps.code_barres).not.toBe(a.code_barres);
    expect((await env.api("POST", `/produits/${c.id}/code-barres`, o.jeton)).corps.erreur).toBe("code_barres_existant");
    await o.article({ code: "D", nom: "D" }); await o.article({ code: "E", nom: "E" });
    const caissier = await o.compte("caissier", o.M);
    expect((await env.api("POST", "/produits/codes-barres", caissier, { entiteId: o.G })).statut).toBe(403);
    expect((await env.api("POST", "/produits/codes-barres", o.jeton, { entiteId: o.G })).corps).toEqual({ generes: 2 });
    const codes = (await env.api("GET", "/produits", o.jeton)).corps.map((p: { code_barres: string }) => p.code_barres);
    expect(new Set(codes).size).toBe(5);
    expect(codes.every((x: string) => ean13Valide(x))).toBe(true);
  });

  it("vend et achète dans une autre unité : le stock bouge toujours dans l'unité de base", async () => {
    const o = await magasin();
    // Stock en cartons de 24 pièces, à 12 000 FCFA le carton ; palette de 40 cartons à prix fixé.
    const eau = await o.article({ code: "EAU", nom: "Eau", unite: "carton", prixVente: 12000, piecesParUnite: 24 });
    await o.entrer(eau.id, 100);
    const caissier = await o.compte("caissier", o.M);
    expect((await env.api("PUT", `/produits/${eau.id}/unites`, caissier, { conditionnements: [] })).statut).toBe(403);
    expect((await env.api("PUT", `/produits/${eau.id}/unites`, o.jeton, { conditionnements: [{ nom: "Carton", facteur: 2 }] })).corps.erreur).toBe("unite_en_double");
    const u = await env.api("PUT", `/produits/${eau.id}/unites`, o.jeton, { conditionnements: [{ nom: "palette", facteur: 40, prix: 450000 }], prixPiece: 600 });
    expect(u.corps.unites.map((x: { nom: string; facteur: number; prix_calcule: number }) => [x.nom, x.prix_calcule])).toEqual([["carton", 12000], ["palette", 450000], ["pièce", 600]]);
    // Le réglage du minimum de gros ne fait pas perdre le prix de la palette.
    await env.api("PUT", `/produits/${eau.id}/gros`, o.jeton, { quantiteMin: 0, multiple: 0, conditionnements: [{ nom: "palette", facteur: 40 }] });
    expect((await env.api("GET", "/produits", o.jeton)).corps[0]).toMatchObject({ conditionnements: [{ nom: "palette", facteur: 40, prix: 450000 }], prix_piece: 600 });

    await env.api("POST", "/caisse/ouverture", o.jeton, { entiteId: o.M, fondOuverture: 0 });
    const vendre = (lignes: object[], montant: number) => env.api("POST", "/caisse/ventes", o.jeton, { entiteId: o.M, lignes, paiements: [{ moyen: "especes", montant }] });
    // 12 pièces à 600 = 7 200 FCFA, soit un demi-carton sorti du stock.
    const v = await vendre([{ produitId: eau.id, quantite: 12, unite: "pièce" }], 7200);
    expect(v.corps).toMatchObject({ total_ttc: 7200, lignes: [{ quantite: 12, unite: "pièce", quantite_base: 0.5, prix_unitaire: 600 }] });
    expect(await o.stock(eau.id)).toBe(99.5);
    expect(await lignesDe(o, "lignes_comptoir", "vente_id", v.corps.id)).toEqual([{ quantite: 0.5, prix_unitaire: 12000, unite: "pièce", quantite_unite: 12, prix_unite: 600 }]);
    // Une palette au prix fixé : 40 cartons sortent.
    expect((await vendre([{ produitId: eau.id, quantite: 1, unite: "Palette" }], 450000)).corps.total_ttc).toBe(450000);
    expect(await o.stock(eau.id)).toBe(59.5);
    // Sans prix fixé, le prix de l'unité se calcule ; l'unité de base reste comme avant.
    await env.api("PUT", `/produits/${eau.id}/unites`, o.jeton, { conditionnements: [{ nom: "palette", facteur: 40 }], prixPiece: null });
    expect((await vendre([{ produitId: eau.id, quantite: 1, unite: "palette" }], 480000)).corps.total_ttc).toBe(480000);
    expect((await vendre([{ produitId: eau.id, quantite: 6, unite: "pièce" }], 3000)).corps.total_ttc).toBe(3000);
    const base = await vendre([{ produitId: eau.id, quantite: 2 }], 24000);
    expect(base.corps.lignes[0]).toMatchObject({ unite: "carton", quantite_base: 2 });
    expect((await lignesDe(o, "lignes_comptoir", "vente_id", base.corps.id))[0]).toMatchObject({ quantite: 2, unite: null, quantite_unite: null });
    expect((await vendre([{ produitId: eau.id, quantite: 1, unite: "fût" }], 1)).corps.erreur).toBe("unite_inconnue");
    // L'annulation remet en stock la quantité de base.
    await env.api("POST", `/caisse/ventes/${v.corps.id}/annulation`, o.jeton, { motif: "Erreur de saisie" });
    expect(await o.stock(eau.id)).toBe(17.75);

    // Achat de 2 palettes à 400 000 : 80 cartons attendus, coût de base 10 000, total de la commande exact.
    const f = (await env.api("POST", "/tiers", o.jeton, { type: "entreprise", nom: "Grossiste" })).corps.id;
    const c = await env.api("POST", "/achats/commandes", o.jeton, { entiteId: o.M, fournisseurId: f, date: "2026-03-01", lignes: [{ produitId: eau.id, quantite: 2, prixUnitaire: 400000, unite: "palette" }] });
    expect(c.statut).toBe(201);
    expect(await lignesDe(o, "lignes_achat", "commande_id", c.corps.id)).toEqual([{ quantite: 80, prix_unitaire: 10000, unite: "palette", quantite_unite: 2, prix_unite: 400000 }]);
    const detail = (await env.api("GET", `/achats/commandes/${c.corps.id}`, o.jeton)).corps;
    expect(detail.total).toBe(800000);
    expect(detail.lignes[0]).toMatchObject({ quantite: 80, unite_achat: "palette", quantite_unite: 2, prix_unite: 400000 });
  });
});
