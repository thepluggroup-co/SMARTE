import { afterAll, describe, expect, it } from "vitest";
import { totalLigneDevise } from "../src/achats.js";
import { coutRevient } from "../src/logistique.js";
import { decalerJour } from "../src/performance.js";
import { environnement } from "./outils.js";
import { aujourdhui, magasinImport, tauxDuJour, type M } from "./importoutils.js";

const env = await environnement();
afterAll(env.fermer);

const commander = (o: M, corps: object) =>
  o.api("POST", "/achats/commandes", { entiteId: o.depot, fournisseurId: o.fournisseurId, date: aujourdhui(), origine: "import", ...corps });
const detail = async (o: M, id: string) => (await o.api("GET", `/achats/commandes/${id}`)).corps;
const coutMoyen = async (o: M, id: string) => (await o.api("GET", "/produits")).corps.find((p: { id: string }) => p.id === id).cout_moyen;

describe("montant exact d'une ligne en devise", () => {
  it("calcule en entiers et arrondit au franc", () => {
    expect(totalLigneDevise(2000, 210, 85.1234)).toBe(35_751_828);
    expect(totalLigneDevise(1, 210, 85.1234)).toBe(17_876);
    expect(totalLigneDevise(3, 0.1, 0.1)).toBe(0);
    expect(totalLigneDevise(1, 0.0001, 5000)).toBe(1);
    expect(totalLigneDevise(0.5, 1.5, 655.957)).toBe(492);
  });
});

describe("commandes en devise", () => {
  it("convertit au taux du jour de commande, avec un total exact en FCFA (Q7)", async () => {
    const o = await magasinImport(env);
    expect((await tauxDuJour(o, "CNY", 85.1234)).statut).toBe(200);
    const c = await commander(o, { devise: "CNY", lignes: [{ produitId: o.produitId, quantite: 2000, prixDevise: 210 }] });
    expect(c.statut).toBe(201);
    expect(c.corps).toMatchObject({ devise: "CNY", total: 35_751_828, taux_jour: aujourdhui() });
    const d = await detail(o, c.corps.id);
    expect(d).toMatchObject({ devise: "CNY", taux: 85.1234, taux_jour: aujourdhui(), total: 35_751_828, total_devise: 420_000 });
    expect(d.lignes[0]).toMatchObject({ quantite: 2000, prix_devise: 210, prix_unitaire: 17_876 });
  });

  it("refuse une devise sans taux, un prix mal saisi, et reprend le dernier taux connu (Q8)", async () => {
    const o = await magasinImport(env);
    expect((await commander(o, { devise: "USD", lignes: [{ produitId: o.produitId, quantite: 1, prixDevise: 10 }] })).corps)
      .toMatchObject({ erreur: "taux_inconnu", details: { devise: "USD", jour: aujourdhui() } });
    expect((await commander(o, { devise: "GBP", lignes: [{ produitId: o.produitId, quantite: 1, prixDevise: 10 }] })).statut).toBe(400);
    await tauxDuJour(o, "CNY", 85.1234);
    expect((await commander(o, { devise: "CNY", lignes: [{ produitId: o.produitId, quantite: 1 }] })).corps.erreur).toBe("prix_devise_obligatoire");
    expect((await commander(o, { devise: "CNY", lignes: [{ produitId: o.produitId, quantite: 1, prixUnitaire: 17876 }] })).corps.erreur).toBe("prix_devise_obligatoire");
    expect((await commander(o, { devise: "CNY", lignes: [{ produitId: o.produitId, quantite: 1, prixDevise: 1.23456 }] })).corps.erreur).toBe("donnees_invalides");
    // En FCFA, le prix en devise n'a pas de sens et le prix en FCFA reste obligatoire.
    expect((await commander(o, { lignes: [{ produitId: o.produitId, quantite: 1, prixDevise: 10 }] })).corps.erreur).toBe("prix_devise_obligatoire");
    expect((await commander(o, { lignes: [{ produitId: o.produitId, quantite: 1 }] })).corps.erreur).toBe("prix_obligatoire");
    expect((await commander(o, { lignes: [{ produitId: o.produitId, quantite: 1, prixUnitaire: 5000 }] })).corps).toMatchObject({ devise: null, total: 5000 });
    // Sans taux du jour, le dernier taux enregistré avant la date de commande s'applique.
    const hier = decalerJour(aujourdhui(), -1);
    await tauxDuJour(o, "EUR", 655.957, hier);
    const e = await commander(o, { devise: "EUR", lignes: [{ produitId: o.produitId, quantite: 3, prixDevise: 12.5 }] });
    expect(e.corps).toMatchObject({ total: totalLigneDevise(3, 12.5, 655.957), taux_jour: hier });
    expect((await detail(o, e.corps.id)).taux).toBe(655.957);
  });

  it("fige le taux à l'approbation et met en stock au taux figé, frais compris (Q9)", async () => {
    const o = await magasinImport(env);
    await tauxDuJour(o, "CNY", 85.1234);
    const a = (await commander(o, { devise: "CNY", lignes: [{ produitId: o.produitId, quantite: 2000, prixDevise: 210 }] })).corps;
    const autre = await o.article("BOUILLOIRE");
    const b = (await commander(o, { devise: "CNY", lignes: [{ produitId: autre, quantite: 100, prixDevise: 50 }] })).corps;
    expect((await o.api("POST", `/achats/commandes/${a.id}/approbation`)).statut).toBe(200);

    // Nouveau taux du même jour : la commande approuvée ne bouge pas ; le brouillon le reprend s'il est modifié.
    await tauxDuJour(o, "CNY", 90);
    expect(await detail(o, a.id)).toMatchObject({ taux: 85.1234, total: 35_751_828 });
    expect((await o.api("PUT", `/achats/commandes/${b.id}/lignes`, { lignes: [{ produitId: autre, quantite: 100, prixDevise: 50 }] })).corps.total).toBe(450_000);
    expect(await detail(o, b.id)).toMatchObject({ taux: 90, total: 450_000 });

    // Réception : le coût unitaire est le prix FCFA au taux figé, augmenté de la part des frais.
    expect((await o.api("POST", `/achats/commandes/${a.id}/frais`, { nature: "fret", montant: 1_000_000 })).statut).toBe(201);
    const ligne = (await detail(o, a.id)).lignes[0];
    expect((await o.api("POST", `/achats/commandes/${a.id}/receptions`, { lignes: [{ ligneId: ligne.id, quantite: 2000 }] })).statut).toBe(201);
    expect(await coutMoyen(o, o.produitId)).toBe(coutRevient(35_751_828, 1_000_000, 17_876));

    // La facture du fabricant, saisie en FCFA au taux de la commande, est conforme ; un autre montant demande un motif.
    const facture = async (montant: number, numero: string) => (await o.api("POST", "/fournisseurs/factures", {
      entiteId: o.G, fournisseurId: o.fournisseurId, numeroFournisseur: numero, date: aujourdhui(), commandeId: a.id, niu: "M0123",
      lignes: [{ designation: "420 000 CNY", compte: "601", montantHt: montant }],
    })).corps.id as string;
    const juste = await facture(35_751_828, "PI-CNY-1");
    const v = await o.api("POST", `/fournisseurs/factures/${juste}/validation`);
    expect(v.statut).toBe(200);
    expect((await o.api("GET", `/fournisseurs/factures/${juste}`)).corps.controle).toEqual({ statut: "conforme", ecart: 0 });
    const ecart = await facture(36_000_000, "PI-CNY-2");
    expect((await o.api("POST", `/fournisseurs/factures/${ecart}/validation`)).corps).toMatchObject({ erreur: "ecart_trois_voies", details: { statut: "ecart", ecart: 248_172 } });
    expect((await o.api("POST", `/fournisseurs/factures/${ecart}/validation`, { motifEcart: "Taux de la banque différent" })).statut).toBe(200);
  });
});
