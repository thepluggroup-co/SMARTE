import { afterAll, describe, expect, it } from "vitest";
import { boutique, commander, corpsCommande, jour } from "./canaloutils.js";
import { environnement } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);

describe("canal en ligne : diffusion à la Marketplace", () => {
  it("publie la disponibilité des lieux en ligne et les changements d'article, jamais pour GTA ni un coût", async () => {
    const b = await boutique(env);
    const evenements = async (type: string) =>
      (await b.sql("select charge from evenements where organisation_id = org_courante() and type = $1", [type])).rows.map((r) => r.charge);

    const p = await b.article("RADIO", 8000, 0, 4);
    expect(await evenements("stock.disponibilite_modifiee")).toContainEqual({ produit_id: p, lieu_id: b.lieu, disponible: 4 });
    expect(await evenements("catalogue.article_modifie")).toContainEqual({ produit_id: p });

    const r = await commander(env, b.org, corpsCommande(b, [{ produitId: p, quantite: 1 }]));
    expect(await evenements("stock.disponibilite_modifiee")).toContainEqual({ produit_id: p, lieu_id: b.lieu, disponible: 3 });
    const id = (await b.sql("select id from commandes_web where reference = $1", [r.corps.reference])).rows[0].id;
    await b.api("POST", `/commandes-web/${id}/annuler`, { motif: "Essai" });
    const quatre = (await evenements("stock.disponibilite_modifiee")).filter((c) => c.produit_id === p && c.disponible === 4);
    expect(quatre).toHaveLength(2);

    const articles = async () => (await evenements("catalogue.article_modifie")).filter((c) => c.produit_id === p).length;
    const avant = await articles();
    expect((await b.api("POST", "/promotions", { produitId: p, nom: "Fête", type: "pourcentage", valeur: 10, debut: jour(), fin: jour() })).statut).toBe(201);
    expect(await articles()).toBe(avant + 1);
    const famille = (await b.api("POST", "/categories-articles", { entiteId: b.G, nom: "Audio" })).corps.id;
    await b.api("PUT", `/produits/${p}/classement`, { categorieId: famille });
    expect(await articles()).toBe(avant + 2);
    // Une entrée à un autre prix d'achat change le coût moyen, pas ce que voit la Marketplace.
    await b.api("POST", "/stocks/mouvements", { entiteId: b.lieu, produitId: p, type: "entree", quantite: 1, coutUnitaire: 999 });
    expect(await articles()).toBe(avant + 2);

    const depot = (await b.api("POST", "/magasins", { parentId: b.G, nom: "Dépôt", type: "entrepot" })).corps.id;
    const stock = (await evenements("stock.disponibilite_modifiee")).length;
    await b.api("POST", "/stocks/mouvements", { entiteId: depot, produitId: p, type: "entree", quantite: 5, coutUnitaire: 100 });
    expect(await evenements("stock.disponibilite_modifiee")).toHaveLength(stock);
    const tous = (await evenements("catalogue.article_modifie")).length;
    await b.sql("insert into produits (organisation_id, entite_id, code, nom, suivi_stock, prix_vente) values ($1, $2, 'GTA2', 'Article GTA', true, 100)", [b.org, b.o.entites.GTA]);
    expect(await evenements("catalogue.article_modifie")).toHaveLength(tous);
  });
});
