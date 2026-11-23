import { afterAll, describe, expect, it } from "vitest";
import { environnement } from "./outils.js";
import { aujourdhui, commandeApprouvee, factureFournisseur, magasinImport, verserAcompte } from "./importoutils.js";

const env = await environnement();
afterAll(env.fermer);

type Ligne = { numero: string; debit: number; credit: number; tiersId?: string | null };
type Ecriture = { id: string; source_type: string; journal: string; lignes: Ligne[] };
const sens = (e: Ecriture) => Object.fromEntries(e.lignes.map((l) => [l.numero, l.debit - l.credit]));

describe("achats à l'import : écritures proposées à l'expert-comptable", () => {
  it("Q19 : acompte, annulation, imputation et relevé de dépôt-vente ; le compte d'avances revient à zéro", async () => {
    const o = await magasinImport(env);
    const c = await commandeApprouvee(o, [{ produitId: o.produitId, quantite: 100, prixUnitaire: 10_000 }]);
    expect((await verserAcompte(o, c.id, 600_000)).statut).toBe(201);
    const rembourse = (await verserAcompte(o, c.id, 100_000)).corps.id;
    expect((await o.api("POST", `/achats/acomptes/${rembourse}/annulation`, { motif: "Remboursé par le fabricant" })).statut).toBe(200);
    const f = await factureFournisseur(o, c.id, 1_000_000);
    expect(f.validation!.corps.acomptes_imputes).toHaveLength(1);
    expect((await o.api("POST", `/fournisseurs/factures/${f.id}/paiements`, { portefeuilleId: o.banque, montant: 400_000, date: aujourdhui() })).statut).toBe(201);

    // Dépôt-vente : 4 pièces facturées à un client, 2 500 FCFA chacune reversés au fournisseur local.
    await o.api("PATCH", `/entites/${o.G}/identite`, { raisonSociale: "GLOMARI SARL", niu: "M0123" });
    const local = (await o.api("POST", "/tiers", { type: "entreprise", nom: "Atelier Bonamoussadi", entiteId: o.G })).corps.id as string;
    const confie = await o.article("CONFIE", { prixVente: 4000 });
    await o.api("POST", "/depots-vente", { produitId: confie, fournisseurId: local, mode: "prix_fixe", prixReversement: 2500 });
    await o.api("POST", `/depots-vente/${confie}/entrees`, { lieuId: o.depot, quantite: 10 });
    const client = (await o.api("POST", "/tiers", { type: "personne", nom: "Madame Eto", entiteId: o.G })).corps.id;
    const d = await o.api("POST", "/documents-vente", { type: "facture", entiteId: o.G, tiersId: client, date: aujourdhui(), lignes: [{ produitId: confie, quantite: 4 }] });
    expect((await o.api("POST", `/documents-vente/${d.corps.id}/emission`, { entrepotId: o.depot })).statut).toBe(200);
    const r = await o.api("POST", "/depots-vente/releves", { fournisseurId: local, du: aujourdhui(), au: aujourdhui() });
    expect(r.corps.releve.total_du).toBe(10_000);
    // Le relevé est une facture fournisseur en brouillon : rien n'est proposé avant sa validation.
    expect((await o.api("POST", `/fournisseurs/factures/${r.corps.facture.id}/validation`)).statut).toBe(200);

    expect((await o.api("POST", "/compta/generation", { brancheId: o.G, fin: "2100-01-01" })).statut).toBe(200);
    const brouillons: Ecriture[] = (await o.api("GET", `/compta/ecritures?brancheId=${o.G}&statut=brouillon`)).corps;
    const de = (type: string) => brouillons.filter((e) => e.source_type === type);

    expect(de("acompte_fournisseur").map(sens)).toEqual(expect.arrayContaining([{ "4091": 600_000, "5211": -600_000 }, { "4091": 100_000, "5211": -100_000 }]));
    expect(de("acompte_fournisseur")).toHaveLength(2);
    expect(de("acompte_fournisseur").every((e) => e.journal === "BQ")).toBe(true);
    expect(de("acompte_fournisseur").flatMap((e) => e.lignes).find((l) => l.numero === "4091")!.tiersId).toBe(o.fournisseurId);
    expect(de("acompte_fournisseur_annule").map(sens)).toEqual([{ "4091": -100_000, "5211": 100_000 }]);
    const paiements = de("paiement_fournisseur");
    expect(paiements.map(sens)).toEqual(expect.arrayContaining([{ "4011": 600_000, "4091": -600_000 }, { "4011": 400_000, "5211": -400_000 }]));
    expect(paiements.find((e) => sens(e)["4091"])!.journal).toBe("OD");
    expect(paiements.find((e) => sens(e)["5211"])!.journal).toBe("BQ");
    expect(de("facture_fournisseur").map(sens)).toEqual(expect.arrayContaining([{ "601": 1_000_000, "4011": -1_000_000 }, { "6011": 10_000, "4011": -10_000 }]));

    expect((await o.api("POST", "/compta/ecritures/validation", { ids: brouillons.map((e) => e.id) })).statut).toBe(200);
    const balance = (await o.api("GET", `/compta/balance?brancheId=${o.G}&debut=2000-01-01&fin=2100-12-31`)).corps;
    const solde = (n: string) => { const l = balance.lignes.find((x: Ligne) => x.numero === n); return l ? l.debit - l.credit : 0; };
    expect(balance.debit).toBe(balance.credit);
    expect(solde("4091")).toBe(0);
    expect(solde("4011")).toBe(-10_000);
    expect(solde("5211")).toBe(49_000_000);
    expect((await o.api("POST", "/compta/generation", { brancheId: o.G, fin: "2100-01-01" })).corps.crees).toBe(0);
  });
});
