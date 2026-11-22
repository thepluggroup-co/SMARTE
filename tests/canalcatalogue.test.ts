import { afterAll, describe, expect, it } from "vitest";
import { prixPromo } from "../src/commerce.js";
import { calculerLigne } from "../src/facturation.js";
import { boutique, jour } from "./canaloutils.js";
import { environnement } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
// PNG d'un pixel, pour les photos.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const ttc = (prix: number, taux: number) => { const m = calculerLigne(1, prix, 0, taux); return m.ht + m.taxes; };

describe("canal en ligne : boutique et catalogue public", () => {
  it("publie le catalogue au prix de la caisse, avec catégorie, marque, photos et promotion, sans coût", async () => {
    const b = await boutique(env);
    const p = await b.article("TEL", 1000, 19.25, 5);
    const famille = (await b.api("POST", "/categories-articles", { entiteId: b.G, nom: "Téléphonie" })).corps.id;
    const sous = (await b.api("POST", "/categories-articles", { entiteId: b.G, nom: "Smartphones", parentId: famille })).corps.id;
    const marque = (await b.api("POST", "/marques", { entiteId: b.G, nom: "Samsung" })).corps.id;
    expect((await b.api("PUT", `/produits/${p}/classement`, { categorieId: sous, marqueId: marque })).statut).toBe(200);
    expect((await b.api("PUT", `/produits/${p}/photos/1`, { image: PNG })).statut).toBe(200);

    const r = await env.api("GET", `/marketplace/${b.org}/catalogue`);
    expect(r.statut).toBe(200);
    expect(r.corps.durees_reservation).toEqual({ mobile_money: 30, a_la_livraison: 1440 });
    expect(r.corps.catalogue).toEqual([expect.objectContaining({
      id: p, prix_ttc: ttc(1000, 19.25), marque: "Samsung", photos: [1], promotion: null,
      categorie: { id: sous, nom: "Smartphones", parent: "Téléphonie" },
    })]);
    expect(JSON.stringify(r.corps)).not.toMatch(/cout|commission|fournisseur/);

    expect((await b.api("POST", "/promotions", { produitId: p, nom: "Fête", type: "pourcentage", valeur: 10, debut: jour(), fin: jour() })).statut).toBe(201);
    const promo = (await env.api("GET", `/marketplace/${b.org}/catalogue`)).corps.catalogue[0];
    expect(promo.prix_ttc).toBe(ttc(prixPromo(1000, "pourcentage", 10), 19.25));

    const photo = await env.app.inject({ method: "GET", url: `/marketplace/${b.org}/produits/${p}/photos/1` });
    expect(photo.statusCode).toBe(200);
    expect(photo.headers["cache-control"]).toContain("public");
    expect(photo.headers["content-type"]).toBe("image/png");
  });

  it("exclut GTA, déduit les réservations et liste lieux, zones et points relais", async () => {
    const b = await boutique(env);
    const p = await b.article("RIZ", 500, 0, 10);
    const gta = (await b.sql(
      "insert into produits (organisation_id, entite_id, code, nom, suivi_stock, prix_vente) values ($1, $2, 'GTA1', 'Article GTA', true, 100) returning id",
      [b.org, b.o.entites.GTA],
    )).rows[0].id as string;

    expect((await env.api("GET", `/marketplace/${b.org}/catalogue`)).corps.catalogue.map((x: { id: string }) => x.id)).toEqual([p]);
    expect((await env.api("GET", `/marketplace/${b.org}/produits/${gta}/photos/1`)).statut).toBe(404);

    expect((await b.api("POST", "/reservations-stock", { entiteId: b.lieu, produitId: p, quantite: 2 })).statut).toBe(201);
    const d = await env.api("GET", `/marketplace/${b.org}/disponibilite?produits=${p},${gta}`);
    expect(d.corps).toEqual([{ produit_id: p, lieux: { [b.lieu]: 8 } }]);
    expect((await env.api("GET", `/marketplace/${b.org}/disponibilite?produits=pas-un-uuid`)).corps.erreur).toBe("donnees_invalides");

    const z = (await env.api("GET", `/marketplace/${b.org}/zones`)).corps;
    expect(z.lieux).toEqual([{ id: b.lieu, nom: "GLOMARI Mall Douala" }]);
    expect(z.zones).toEqual([{ id: b.zoneId, nom: "Akwa", frais: 1000, delai_jours: 1 }]);
    expect(z.points_relais).toEqual([{ id: b.relaisId, nom: "Relais Kotto", adresse: "Carrefour Kotto" }]);
    expect(z.modes_livraison).toContain("point_relais");
  });

  it("refuse une boutique sur GTA ou un lieu hors de la branche, cloisonne et se ferme", async () => {
    const b = await boutique(env);
    expect((await b.api("POST", "/canal-config", { entiteId: b.o.entites.GTA, actif: true })).corps.erreur).toBe("module_inactif");
    expect((await b.api("POST", "/canal-config/lieux", { entiteId: b.G, lieuEntiteId: b.o.entites.GTA, nomPublic: "Ailleurs" })).corps.erreur).toBe("lieu_invalide");
    expect((await b.api("GET", `/canal-config?entiteId=${b.G}`)).corps).toEqual({ actif: true, responsable: "Admin", lieux: [{ entite_id: b.lieu, nom_public: "GLOMARI Mall Douala", actif: true }] });

    const autre = await env.nouvelleOrganisation();
    expect((await env.api("GET", `/canal-config?entiteId=${b.G}`, autre.jeton)).statut).not.toBe(200);
    expect((await env.api("GET", `/marketplace/${autre.organisationId}/catalogue`)).statut).toBe(404);
    expect((await env.api("GET", "/marketplace/pas-un-uuid/catalogue")).statut).toBe(404);

    expect((await b.api("POST", "/canal-config", { entiteId: b.G, actif: false })).corps).toEqual({ actif: false });
    expect((await env.api("GET", `/marketplace/${b.org}/catalogue`)).statut).toBe(404);
  });
});
