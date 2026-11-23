import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { calculerAlertesCouverture, PERIODE_VENTES_JOURS, SEUIL_COUVERTURE_JOURS } from "../src/couverture.js";
import { decalerJour } from "../src/performance.js";
import { environnement } from "./outils.js";
import { aujourdhui, magasinImport, type M } from "./importoutils.js";

const env = await environnement();
afterAll(env.fermer);

/** GLOMARI qui facture depuis son dépôt : chaque facture émise sort du stock en « vente ». */
async function magasin() {
  const o = await magasinImport(env);
  await o.api("PATCH", `/entites/${o.G}/identite`, { raisonSociale: "GLOMARI SARL", niu: "M0123" });
  const client = (await o.api("POST", "/tiers", { type: "personne", nom: "Monsieur Kamga", entiteId: o.G })).corps.id as string;
  const entrer = (produitId: string, quantite: number) =>
    o.api("POST", "/stocks/mouvements", { entiteId: o.depot, produitId, type: "entree", quantite, coutUnitaire: 1000 });
  const vendre = async (produitId: string, quantite: number) => {
    const d = await o.api("POST", "/documents-vente", { type: "facture", entiteId: o.G, tiersId: client, date: aujourdhui(), lignes: [{ produitId, quantite, prixUnitaire: 2000 }] });
    const e = await o.api("POST", `/documents-vente/${d.corps.id}/emission`, { entrepotId: o.depot });
    if (e.statut !== 200) throw new Error(`émission refusée : ${JSON.stringify(e.corps)}`);
  };
  const couverture = async (jeton = o.jeton) => o.api("GET", `/stocks/couverture?brancheId=${o.G}`, undefined, jeton);
  const calculer = (jour: string) => dansOrganisation(env.poolApp, o.organisationId, (c) => calculerAlertesCouverture(c, jour));
  return { ...o, entrer, vendre, couverture, calculer };
}

const notifications = async (o: M, utilisateurId?: string) => (await o.sql(
  "select utilisateur_id, cle, niveau from notifications_personnes where organisation_id = org_courante() and cle like 'couverture:%' and ($1::uuid is null or utilisateur_id = $1) order by cree_le",
  [utilisateurId ?? null],
)).rows;
const moi = async (o: M, jeton: string) => (await o.api("GET", "/moi", undefined, jeton)).corps.id as string;

describe("couverture de stock", () => {
  it("prévient une seule fois au franchissement des deux mois, puis de nouveau après un retour sous le plafond (Q16)", async () => {
    const o = await magasin();
    expect([SEUIL_COUVERTURE_JOURS, PERIODE_VENTES_JOURS]).toEqual([60, 90]);
    const acheteur = await o.compte("acheteur");
    const acheteurGta = await o.compte("acheteur", o.entites.GTA);
    await o.entrer(o.produitId, 420);
    await o.vendre(o.produitId, 120);
    const r = await o.couverture();
    expect(r.corps).toMatchObject({ seuil_jours: 60, periode_jours: 90 });
    expect(r.corps.categories).toEqual([
      { categorie_id: o.categorieId, categorie: "Électroménager", stock: 300, ventes_90: 120, couverture_jours: 225, au_dessus: true, depasse_depuis: null },
    ]);

    const j = aujourdhui();
    expect(await o.calculer(j)).toBe(1);
    const recues = await notifications(o);
    expect(recues).toHaveLength(2);
    expect(recues.map((n) => n.utilisateur_id).sort()).toEqual([await moi(o, o.jeton), acheteur.id].sort());
    expect(recues[0]).toMatchObject({ cle: `couverture:${o.G}:${o.categorieId}:${j}`, niveau: "important" });
    expect(await notifications(o, acheteurGta.id)).toEqual([]);
    expect((await o.couverture()).corps.categories[0].depasse_depuis).toBe(j);

    // Le lendemain, toujours au-dessus : pas de nouvelle notification.
    expect(await o.calculer(decalerJour(j, 1))).toBe(0);
    expect(await notifications(o)).toHaveLength(2);

    // Les ventes reprennent : 160 en stock pour 260 vendus, soit 55,4 jours, sous le plafond.
    await o.vendre(o.produitId, 140);
    expect(await o.calculer(decalerJour(j, 2))).toBe(0);
    expect((await o.couverture()).corps.categories[0]).toMatchObject({ stock: 160, ventes_90: 260, couverture_jours: 55.4, au_dessus: false, depasse_depuis: null });
    const { rows: [etat] } = await o.sql("select au_dessus, depasse_depuis, calcule_le from alertes_couverture where organisation_id = org_courante() and categorie_id = $1", [o.categorieId]);
    expect(etat).toEqual({ au_dessus: false, depasse_depuis: null, calcule_le: decalerJour(j, 2) });

    // Un nouvel arrivage repasse au-dessus : nouvelle notification, datée du nouveau franchissement.
    await o.entrer(o.produitId, 200);
    expect(await o.calculer(decalerJour(j, 3))).toBe(1);
    const toutes = await notifications(o, acheteur.id);
    expect(toutes.map((n) => n.cle)).toEqual([`couverture:${o.G}:${o.categorieId}:${j}`, `couverture:${o.G}:${o.categorieId}:${decalerJour(j, 3)}`]);
  });

  it("une catégorie sans vente est au-dessus, une catégorie sans stock n'apparaît pas (Q17)", async () => {
    const o = await magasin();
    const cuisine = (await o.api("POST", "/categories-articles", { entiteId: o.G, nom: "Cuisine" })).corps.id as string;
    const casserole = await o.article("CASSEROLE", {}, cuisine);
    const jardin = (await o.api("POST", "/categories-articles", { entiteId: o.G, nom: "Jardin" })).corps.id as string;
    const vide = await o.article("VIDE", {}, jardin);
    const libre = await o.article("LIBRE", {}, null);
    await o.entrer(casserole, 10);
    await o.entrer(vide, 5);
    await o.vendre(vide, 5);
    // Exactement 60 jours (40 en stock pour 60 vendus) : pas au-delà du plafond.
    await o.entrer(libre, 100);
    await o.vendre(libre, 60);
    const categories = (await o.couverture()).corps.categories;
    expect(categories.map((c: { categorie: string; couverture_jours: number | null; au_dessus: boolean }) => [c.categorie, c.couverture_jours, c.au_dessus]))
      .toEqual([["Cuisine", null, true], ["Sans catégorie", 60, false]]);
    expect(categories[0]).toMatchObject({ stock: 10, ventes_90: 0 });
    expect(await o.calculer(aujourdhui())).toBe(1);
    const { rows } = await o.sql("select categorie_id, au_dessus, couverture_jours::float as couverture_jours from alertes_couverture where organisation_id = org_courante() order by stock desc");
    expect(rows).toEqual([
      { categorie_id: null, au_dessus: false, couverture_jours: 60 },
      { categorie_id: cuisine, au_dessus: true, couverture_jours: null },
      { categorie_id: jardin, au_dessus: false, couverture_jours: 0 },
    ]);
  });

  it("avertit à l'approbation d'une commande qui ferait dépasser le plafond, sans la bloquer (Q18)", async () => {
    const o = await magasin();
    await o.entrer(o.produitId, 150);
    await o.vendre(o.produitId, 120);
    const commander = async (quantite: number) => (await o.api("POST", "/achats/commandes", {
      entiteId: o.depot, fournisseurId: o.fournisseurId, date: aujourdhui(), lignes: [{ produitId: o.produitId, quantite, prixUnitaire: 1000 }],
    })).corps.id as string;
    const petite = await commander(5);
    expect((await o.api("GET", `/achats/commandes/${petite}`)).corps.couverture_prevue).toEqual([]);
    expect((await o.api("POST", `/achats/commandes/${petite}/approbation`)).corps).toEqual({ statut: "approuvee", avertissements: [] });

    const grosse = await commander(300);
    expect((await o.api("GET", `/achats/commandes/${grosse}`)).corps.couverture_prevue).toEqual([
      { categorie: "Électroménager", couverture_actuelle: 22.5, couverture_prevue: 247.5 },
    ]);
    expect((await o.api("POST", `/achats/commandes/${grosse}/approbation`)).corps).toEqual({
      statut: "approuvee", avertissements: [{ categorie: "Électroménager", couverture_prevue: 247.5 }],
    });
    // Une fois la marchandise reçue, plus rien n'est attendu : l'avertissement disparaît du détail.
    const ligne = (await o.api("GET", `/achats/commandes/${grosse}`)).corps.lignes[0];
    await o.api("POST", `/achats/commandes/${grosse}/receptions`, { lignes: [{ ligneId: ligne.id, quantite: 300 }] });
    expect((await o.api("GET", `/achats/commandes/${grosse}`)).corps.couverture_prevue).toEqual([]);
  });

  it("reste invisible depuis GTA et ne compte pas les articles en dépôt-vente (Q20)", async () => {
    const o = await magasin();
    const confie = await o.article("CONFIE");
    const local = (await o.api("POST", "/tiers", { type: "entreprise", nom: "Artisan local", entiteId: o.G })).corps.id as string;
    expect((await o.api("POST", "/depots-vente", { produitId: confie, fournisseurId: local, mode: "prix_fixe", prixReversement: 500 })).statut).toBe(201);
    expect((await o.api("POST", `/depots-vente/${confie}/entrees`, { lieuId: o.depot, quantite: 1000 })).statut).toBe(201);
    await o.entrer(o.produitId, 10);
    await o.vendre(o.produitId, 10);
    expect((await o.couverture()).corps.categories).toEqual([]);
    expect(await o.calculer(aujourdhui())).toBe(0);

    const gta = await o.compte("comptabilite", o.entites.GTA);
    expect((await o.couverture(gta.jeton)).statut).toBe(403);
    // GTA n'a pas le module de stock : ses collaborateurs n'y ont aucun droit de stock.
    expect((await o.api("GET", `/stocks/couverture?brancheId=${o.entites.GTA}`, undefined, gta.jeton)).statut).toBe(403);
    const ailleurs = await env.nouvelleOrganisation();
    expect((await env.api("GET", `/stocks/couverture?brancheId=${o.G}`, ailleurs.jeton)).statut).toBe(403);
  });
});
