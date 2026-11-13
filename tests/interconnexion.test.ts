import { afterAll, describe, expect, it } from "vitest";
import { environnement } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
const aujourdhui = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);

/*
 * Une même marchandise suivie d'un module à l'autre : rien n'est ressaisi, chaque opération se retrouve
 * dans le stock, la caisse, la trésorerie, les rapports et le tableau de bord de GLOMARI.
 */
describe("interconnexion des modules", () => {
  it("met à jour stock, trésorerie, rapports et tableau de bord à chaque opération", async () => {
    const o = await env.nouvelleOrganisation();
    const G = o.entites.GLOMARI!;
    await env.api("POST", "/compta/initialisation", o.jeton, { brancheId: G });
    const M = (await env.api("POST", "/magasins", o.jeton, { parentId: G, nom: "Akwa", type: "point_de_vente" })).corps.id as string;
    const caisse = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: G, nom: "Caisse", type: "especes", soldeInitial: 20000 })).corps.id as string;
    await env.api("PUT", "/portefeuilles/defauts", o.jeton, { entiteId: G, moyen: "especes", portefeuilleId: caisse });
    const tableau = async () => (await env.api("GET", `/tableau-de-bord/branche?espace=commerce&du=${aujourdhui()}&au=${aujourdhui()}`, o.jeton)).corps;
    const resume = async () => { const t = await tableau(); return { ventes: t.ventes.total, achats: t.achats.total, depenses: t.depenses.total, benefice: t.resume.benefice, tresorerie: t.finances.tresorerie }; };
    const stock = async () => (await env.api("GET", `/entrepots/etat?entiteId=${M}`, o.jeton)).corps.lignes[0]?.quantite ?? 0;
    expect(await resume()).toEqual({ ventes: 0, achats: 0, depenses: 0, benefice: 0, tresorerie: 20000 });

    // 1. Stocks : l'article est créé une fois ; la facturation, les achats et la caisse le voient aussitôt.
    const cat = (await env.api("POST", "/categories-articles", o.jeton, { entiteId: G, nom: "Alimentation" })).corps.id;
    const riz = (await env.api("POST", "/produits", o.jeton, { entiteId: G, code: "RIZ", nom: "Riz 25 kg", unite: "sac", prixVente: 1000, suiviStock: true, categorieId: cat, codeBarresAuto: true })).corps;
    expect((await env.api("GET", "/produits?q=RIZ", o.jeton)).corps[0]).toMatchObject({ id: riz.id, categorie: "Alimentation", unite: "sac", code_barres: riz.code_barres });

    // 2. Achats : la commande approuvée compte dans les achats du tableau de bord ; sa réception remplit le stock du magasin.
    const f = (await env.api("POST", "/tiers", o.jeton, { type: "entreprise", nom: "Grossiste" })).corps.id;
    const c = await env.api("POST", "/achats/commandes", o.jeton, { entiteId: M, fournisseurId: f, date: aujourdhui(), lignes: [{ produitId: riz.id, quantite: 10, prixUnitaire: 600 }] });
    expect((await resume()).achats).toBe(0);
    await env.api("POST", `/achats/commandes/${c.corps.id}/approbation`, o.jeton);
    expect(await resume()).toMatchObject({ achats: 6000, benefice: -6000 });
    const ligne = (await env.api("GET", `/achats/commandes/${c.corps.id}`, o.jeton)).corps.lignes[0].id;
    expect((await env.api("POST", `/achats/commandes/${c.corps.id}/receptions`, o.jeton, { lignes: [{ ligneId: ligne, quantite: 10 }] })).statut).toBe(201);
    expect(await stock()).toBe(10);
    await env.api("POST", "/caisse/ouverture", o.jeton, { entiteId: M, fondOuverture: 0 });
    expect((await env.api("GET", "/caisse", o.jeton)).corps.ouvertes[0].stocks[riz.id]).toBe(10);

    // 3. Caisse : la vente sort le stock, entre dans le portefeuille, et monte les ventes.
    const v = await env.api("POST", "/caisse/ventes", o.jeton, { entiteId: M, lignes: [{ produitId: riz.id, quantite: 3 }], paiements: [{ moyen: "especes", montant: 3000 }] });
    expect(v.statut).toBe(201);
    expect(await stock()).toBe(7);
    expect(await resume()).toEqual({ ventes: 3000, achats: 6000, depenses: 0, benefice: -3000, tresorerie: 23000 });
    expect((await env.api("GET", "/rapports/ventes-stock", o.jeton)).corps).toMatchObject({
      meilleures_ventes: [{ code: "RIZ", quantite: 3, montant: 3000 }], paiements_par_moyen: [{ moyen: "especes", montant: 3000 }], stock_par_lieu: [{ entite: "Akwa", quantite: 7, valeur: 4200 }],
    });

    // 4. Retour : le stock revient, l'argent ressort, les ventes baissent ; le remboursement n'est pas compté deux fois.
    const lv = (await env.api("GET", `/caisse/ventes/${v.corps.id}`, o.jeton)).corps.lignes[0].id;
    expect((await env.api("POST", `/caisse/ventes/${v.corps.id}/retours`, o.jeton, { motif: "Sac percé au retour", lignes: [{ ligneId: lv, quantite: 1, destination: "avarie" }], remboursements: [{ moyen: "especes", montant: 1000 }] })).statut).toBe(201);
    expect(await stock()).toBe(8);
    expect((await env.api("GET", `/entrepots/etat?entiteId=${M}`, o.jeton)).corps.lignes[0].avarie).toBe(1);
    expect(await resume()).toEqual({ ventes: 2000, achats: 6000, depenses: 0, benefice: -4000, tresorerie: 22000 });

    // 5. Trésorerie : une dépense saisie dans un portefeuille apparaît dans les dépenses.
    await env.api("POST", `/portefeuilles/${caisse}/mouvements`, o.jeton, { sens: "sortie", montant: 500, libelle: "Transport" });
    expect(await resume()).toEqual({ ventes: 2000, achats: 6000, depenses: 500, benefice: -4500, tresorerie: 21500 });

    // 6. Fournisseur : payer la facture de cette commande vide le portefeuille, sans recompter l'achat en dépense.
    const ff = await env.api("POST", "/fournisseurs/factures", o.jeton, { entiteId: G, fournisseurId: f, numeroFournisseur: "F1", date: aujourdhui(), commandeId: c.corps.id, niu: "M0123", lignes: [{ designation: "Riz", compte: "601", montantHt: 6000 }] });
    expect(ff.statut).toBe(201);
    expect((await env.api("POST", `/fournisseurs/factures/${ff.corps.id}/validation`, o.jeton)).statut).toBe(200);
    expect((await env.api("GET", "/rapports/ventes-stock", o.jeton)).corps.restes_fournisseurs).toEqual([{ nom: "Grossiste", telephone: null, reste: 6000 }]);
    expect((await env.api("POST", `/fournisseurs/factures/${ff.corps.id}/paiements`, o.jeton, { portefeuilleId: caisse, montant: 6000, date: aujourdhui() })).statut).toBe(201);
    expect(await resume()).toEqual({ ventes: 2000, achats: 6000, depenses: 500, benefice: -4500, tresorerie: 15500 });
    expect((await env.api("GET", "/rapports/ventes-stock", o.jeton)).corps.restes_fournisseurs).toEqual([]);
    // Une facture de charge sans commande (loyer), elle, est bien une dépense quand elle est payée.
    const loyer = await env.api("POST", "/fournisseurs/factures", o.jeton, { entiteId: G, fournisseurId: f, numeroFournisseur: "L1", date: aujourdhui(), niu: "M0123", lignes: [{ designation: "Loyer", compte: "622", montantHt: 2000 }] });
    await env.api("POST", `/fournisseurs/factures/${loyer.corps.id}/validation`, o.jeton);
    expect((await env.api("POST", `/fournisseurs/factures/${loyer.corps.id}/paiements`, o.jeton, { portefeuilleId: caisse, montant: 2000, date: aujourdhui() })).statut).toBe(201);
    expect(await resume()).toEqual({ ventes: 2000, achats: 6000, depenses: 2500, benefice: -6500, tresorerie: 13500 });

    // GTA ne reçoit rien de tout cela : ni achats, ni dépenses de GLOMARI.
    const gta = (await env.api("GET", `/tableau-de-bord/branche?espace=formation&du=${aujourdhui()}&au=${aujourdhui()}`, o.jeton)).corps;
    expect(gta).toMatchObject({ achats: null, depenses: null, resume: null });
    expect(gta.ventes.total).toBe(0);
  });
});
