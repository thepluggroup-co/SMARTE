import { afterAll, describe, expect, it } from "vitest";
import { environnement } from "./outils.js";
import { aujourdhui, commandeApprouvee, factureFournisseur, magasinImport, verserAcompte, type M } from "./importoutils.js";

const env = await environnement();
afterAll(env.fermer);

const detail = async (o: M, id: string, jeton = o.jeton) => (await o.api("GET", `/achats/commandes/${id}`, undefined, jeton)).corps;
const annulerAcompte = (o: M, id: string, motif = "Remboursé par le fabricant", jeton = o.jeton) =>
  o.api("POST", `/achats/acomptes/${id}/annulation`, { motif }, jeton);
const mouvements = async (o: M) =>
  (await o.sql("select count(*)::int as n from mouvements_portefeuille where portefeuille_id = $1", [o.banque])).rows[0]!.n as number;
/** 1 000 pièces à 10 000 FCFA : 10 000 000 FCFA. */
const dixMillions = (o: M) => commandeApprouvee(o, [{ produitId: o.produitId, quantite: 1000, prixUnitaire: 10000 }]);

describe("acomptes au fournisseur", () => {
  it("verse deux acomptes, sort l'argent de la banque et les montre sur la commande (Q1)", async () => {
    const o = await magasinImport(env);
    const c = await dixMillions(o);
    expect(c.total).toBe(10_000_000);
    const a1 = await verserAcompte(o, c.id, 3_000_000, { reference: "SWIFT-001" });
    expect(a1.statut).toBe(201);
    expect(a1.corps).toMatchObject({ montant: 3_000_000, disponible: 3_000_000, fournisseur_id: o.fournisseurId, devise: null });
    // Un acompte en yuans garde la devise, le montant et le taux ensemble ; jamais l'un sans les autres.
    expect((await verserAcompte(o, c.id, 7_000_000, { devise: "CNY" })).corps.erreur).toBe("donnees_invalides");
    expect((await verserAcompte(o, c.id, 7_000_000, { devise: "CNY", montantDevise: 82_236.5, taux: 85.12 })).statut).toBe(201);
    expect(await o.solde()).toBe(40_000_000);
    const d = await detail(o, c.id);
    expect(d.acomptes).toMatchObject({ verse: 10_000_000, impute: 0, disponible: 10_000_000 });
    expect(d.acomptes.liste).toMatchObject([
      { montant: 3_000_000, reference: "SWIFT-001", portefeuille: "Banque Afriland", disponible: 3_000_000, devise: null },
      { montant: 7_000_000, devise: "CNY", montant_devise: 82_236.5, taux: 85.12, disponible: 7_000_000 },
    ]);
    const { rows } = await o.sql("select type, montant, source_type from mouvements_portefeuille where portefeuille_id = $1 and type = 'sortie' order by cree_le", [o.banque]);
    expect(rows).toEqual([
      { type: "sortie", montant: -3_000_000, source_type: "acompte_fournisseur" },
      { type: "sortie", montant: -7_000_000, source_type: "acompte_fournisseur" },
    ]);
  });

  it("refuse sans droit de trésorerie, en brouillon, au-delà du total, sans solde ou depuis une autre branche (Q2)", async () => {
    const o = await magasinImport(env, { solde: 5_000_000 });
    const c = await commandeApprouvee(o, [{ produitId: o.produitId, quantite: 10, prixUnitaire: 200_000 }]);
    const acheteur = await o.compte("acheteur");
    expect((await verserAcompte(o, c.id, 1000, {}, acheteur.jeton)).statut).toBe(403);
    const brouillon = await o.api("POST", "/achats/commandes", { entiteId: o.depot, fournisseurId: o.fournisseurId, date: aujourdhui(), lignes: [{ produitId: o.produitId, quantite: 1, prixUnitaire: 1000 }] });
    expect((await verserAcompte(o, brouillon.corps.id, 500)).corps.erreur).toBe("commande_non_approuvee");
    expect((await verserAcompte(o, c.id, 2_000_001)).corps).toMatchObject({ erreur: "acompte_superieur_commande", details: { possible: 2_000_000 } });
    const vide = await o.portefeuille("Caisse vide", 0, o.G, "especes");
    expect((await verserAcompte(o, c.id, 1000, { portefeuilleId: vide })).corps.erreur).toBe("solde_portefeuille_insuffisant");
    const gta = await o.portefeuille("Banque GTA", 1_000_000, o.entites.GTA);
    expect((await verserAcompte(o, c.id, 1000, { portefeuilleId: gta })).corps.erreur).toBe("transfert_autre_branche");
    expect((await verserAcompte(o, c.id, 1_500_000)).statut).toBe(201);
    expect((await verserAcompte(o, c.id, 600_000)).corps).toMatchObject({ erreur: "acompte_superieur_commande", details: { possible: 500_000 } });
    expect(await o.solde()).toBe(3_500_000);
  });

  it("des acomptes simultanés ne dépassent jamais le total de la commande", async () => {
    const o = await magasinImport(env);
    const c = await commandeApprouvee(o, [{ produitId: o.produitId, quantite: 10, prixUnitaire: 200_000 }]);
    const r = await Promise.all(Array.from({ length: 5 }, () => verserAcompte(o, c.id, 600_000)));
    expect(r.filter((x) => x.statut === 201)).toHaveLength(3);
    expect(r.filter((x) => x.statut !== 201).every((x) => x.corps.erreur === "acompte_superieur_commande")).toBe(true);
    expect((await detail(o, c.id)).acomptes.verse).toBe(1_800_000);
    expect(await o.solde()).toBe(48_200_000);
  });

  it("impute les acomptes à la validation de la facture, une seule fois et sans nouvelle sortie d'argent (Q3)", async () => {
    const o = await magasinImport(env);
    const c = await dixMillions(o);
    const a1 = (await verserAcompte(o, c.id, 3_000_000)).corps.id;
    const a2 = (await verserAcompte(o, c.id, 7_000_000)).corps.id;
    const avant = await mouvements(o);
    const f = await factureFournisseur(o, c.id, 10_000_000);
    expect(f.validation!.statut).toBe(200);
    expect(f.validation!.corps.acomptes_imputes).toEqual([{ acompte: a1, montant: 3_000_000 }, { acompte: a2, montant: 7_000_000 }]);
    expect(await mouvements(o)).toBe(avant);
    expect(await o.solde()).toBe(40_000_000);
    const fiche = (await o.api("GET", `/fournisseurs/factures/${f.id}`)).corps;
    expect(fiche).toMatchObject({ statut: "validee", paye: 10_000_000 });
    expect(fiche.paiements).toHaveLength(2);
    const { rows } = await o.sql("select acompte_id from paiements_fournisseur where facture_id = $1 order by montant", [f.id]);
    expect(rows.map((r) => r.acompte_id)).toEqual([a1, a2]);
    // La facture est soldée : rien ne peut plus être payé dessus.
    expect((await o.api("POST", `/fournisseurs/factures/${f.id}/paiements`, { portefeuilleId: o.banque, montant: 1, date: aujourdhui() })).corps.erreur).toBe("montant_superieur_au_reste");
    const d = await detail(o, c.id);
    expect(d.acomptes).toMatchObject({ verse: 10_000_000, impute: 10_000_000, disponible: 0 });
    expect(d.paiement).toMatchObject({ statut: "paye", facture: 10_000_000, paye: 10_000_000, reste: 0 });
    expect(d.paiement.paiements.map((p: { acompte_impute: boolean }) => p.acompte_impute)).toEqual([true, true]);
  });

  it("impute dans l'ordre de versement sur des factures successives (Q4)", async () => {
    const o = await magasinImport(env);
    const c = await commandeApprouvee(o, [{ produitId: o.produitId, quantite: 500, prixUnitaire: 10000 }]);
    const a1 = (await verserAcompte(o, c.id, 1_000_000)).corps.id;
    const a2 = (await verserAcompte(o, c.id, 3_000_000)).corps.id;
    const f1 = await factureFournisseur(o, c.id, 2_500_000);
    expect(f1.validation!.corps.acomptes_imputes).toEqual([{ acompte: a1, montant: 1_000_000 }, { acompte: a2, montant: 1_500_000 }]);
    expect((await detail(o, c.id)).acomptes).toMatchObject({ verse: 4_000_000, impute: 2_500_000, disponible: 1_500_000 });
    const f2 = await factureFournisseur(o, c.id, 1_500_000);
    expect(f2.validation!.corps.acomptes_imputes).toEqual([{ acompte: a2, montant: 1_500_000 }]);
    expect((await detail(o, c.id)).acomptes).toMatchObject({ impute: 4_000_000, disponible: 0 });
    // Plus rien à imputer : la troisième facture se paie normalement, avec une vraie sortie d'argent.
    const f3 = await factureFournisseur(o, c.id, 1_000_000);
    expect(f3.validation!.corps.acomptes_imputes).toEqual([]);
    expect((await o.api("POST", `/fournisseurs/factures/${f3.id}/paiements`, { portefeuilleId: o.banque, montant: 1_000_000, date: aujourdhui() })).statut).toBe(201);
    expect(await o.solde()).toBe(45_000_000);
  });

  it("annule un acompte non imputé, jamais un acompte imputé, et rend les imputations avec la facture (Q5)", async () => {
    const o = await magasinImport(env);
    const c = await commandeApprouvee(o, [{ produitId: o.produitId, quantite: 500, prixUnitaire: 10000 }]);
    const a1 = (await verserAcompte(o, c.id, 2_000_000)).corps.id;
    expect((await annulerAcompte(o, a1, "    ")).statut).toBe(400);
    expect((await annulerAcompte(o, a1)).corps).toEqual({ annule: true });
    expect(await o.solde()).toBe(50_000_000);
    expect((await annulerAcompte(o, a1)).corps.erreur).toBe("deja_annule");

    const a2 = (await verserAcompte(o, c.id, 3_000_000)).corps.id;
    const f = await factureFournisseur(o, c.id, 3_000_000);
    expect(f.validation!.corps.acomptes_imputes).toEqual([{ acompte: a2, montant: 3_000_000 }]);
    expect((await annulerAcompte(o, a2)).corps.erreur).toBe("acompte_impute");
    // Une ligne d'imputation ne s'annule pas seule : seule l'annulation de la facture rend l'acompte.
    const imputation = (await o.api("GET", `/fournisseurs/factures/${f.id}`)).corps.paiements[0];
    expect((await o.api("POST", `/fournisseurs/paiements/${imputation.id}/annulation`, { motif: "Erreur de saisie" })).corps.erreur).toBe("imputation_non_annulable");
    expect((await o.api("POST", `/fournisseurs/factures/${f.id}/annulation`, { motif: "Facture refaite par le fabricant" })).corps).toEqual({ annulee: true });
    expect((await detail(o, c.id)).acomptes).toMatchObject({ verse: 3_000_000, impute: 0, disponible: 3_000_000 });
    expect((await annulerAcompte(o, a2)).corps).toEqual({ annule: true });
    expect(await o.solde()).toBe(50_000_000);
    expect((await detail(o, c.id)).acomptes).toMatchObject({ verse: 0, impute: 0, disponible: 0 });
  });

  it("refuse d'annuler une commande tant qu'un acompte garde un disponible (Q6)", async () => {
    const o = await magasinImport(env);
    const c = await commandeApprouvee(o, [{ produitId: o.produitId, quantite: 100, prixUnitaire: 10000 }]);
    const a = (await verserAcompte(o, c.id, 400_000)).corps.id;
    const annuler = () => o.api("POST", `/achats/commandes/${c.id}/annulation`, { motif: "Fabricant défaillant" });
    expect((await annuler()).corps.erreur).toBe("acompte_a_recuperer");
    expect((await annulerAcompte(o, a, "Remboursé par virement")).statut).toBe(200);
    expect((await annuler()).corps).toEqual({ statut: "annulee" });
    expect((await verserAcompte(o, c.id, 1)).corps.erreur).toBe("commande_non_approuvee");
  });

  it("réserve toute sortie d'argent au droit de trésorerie, même pour qui valide en comptabilité", async () => {
    const o = await magasinImport(env);
    const chef = await o.compte("chef_comptable");
    const tresorier = await o.compte("tresorier");
    const magasinier = await o.compte("magasinier", o.depot);
    const c = await commandeApprouvee(o, [{ produitId: o.produitId, quantite: 10, prixUnitaire: 100_000 }]);
    expect((await verserAcompte(o, c.id, 400_000, {}, chef.jeton)).statut).toBe(403);
    const a = await verserAcompte(o, c.id, 400_000, {}, tresorier.jeton);
    expect(a.statut).toBe(201);
    expect((await annulerAcompte(o, a.corps.id, "Essai d'annulation", chef.jeton)).statut).toBe(403);
    // Les acomptes sont de l'argent : la trésorerie et la comptabilité les voient, pas le magasin.
    expect((await detail(o, c.id)).acomptes.verse).toBe(400_000);
    expect((await detail(o, c.id, magasinier.jeton)).acomptes).toBeNull();

    // Le chef comptable valide la facture ; l'acompte s'impute, mais il ne paie pas le reste lui-même.
    const f = await factureFournisseur(o, c.id, 1_000_000, { jeton: chef.jeton });
    expect(f.validation!.corps.acomptes_imputes).toEqual([{ acompte: a.corps.id, montant: 400_000 }]);
    const payer = (jeton: string) => o.api("POST", `/fournisseurs/factures/${f.id}/paiements`, { portefeuilleId: o.banque, montant: 600_000, date: aujourdhui() }, jeton);
    expect((await payer(chef.jeton)).statut).toBe(403);
    expect((await o.api("POST", "/fournisseurs/lots-paiement", { portefeuilleId: o.banque, date: aujourdhui(), factures: [f.id] }, chef.jeton)).statut).toBe(403);
    expect((await payer(o.jeton)).statut).toBe(201);
    expect(await o.solde()).toBe(49_000_000);
  });

  it("GTA ne voit aucun acompte, et le tableau de bord de GLOMARI ne les compte pas en dépenses (Q20)", async () => {
    const o = await magasinImport(env);
    const c = await commandeApprouvee(o, [{ produitId: o.produitId, quantite: 100, prixUnitaire: 30_000 }]);
    const a = (await verserAcompte(o, c.id, 1_500_000)).corps.id;
    const tresorierGta = await o.compte("tresorier", o.entites.GTA);
    expect((await verserAcompte(o, c.id, 1000, {}, tresorierGta.jeton)).statut).toBe(403);
    expect((await annulerAcompte(o, a, "Tentative depuis GTA", tresorierGta.jeton)).statut).toBe(403);
    const comptaGta = await o.compte("comptabilite", o.entites.GTA);
    expect([403, 404]).toContain((await o.api("GET", `/achats/commandes/${c.id}`, undefined, comptaGta.jeton)).statut);
    const ailleurs = await env.nouvelleOrganisation();
    expect((await env.api("POST", `/achats/acomptes/${a}/annulation`, ailleurs.jeton, { motif: "Autre organisation" })).statut).toBe(404);
    expect((await env.api("POST", `/achats/commandes/${c.id}/acomptes`, ailleurs.jeton, { portefeuilleId: o.banque, montant: 1, date: aujourdhui() })).statut).toBe(404);

    // Une vraie dépense compte ; l'acompte, qui paie de la marchandise, non (elle compte déjà en achats).
    await o.api("POST", `/portefeuilles/${o.banque}/mouvements`, { sens: "sortie", montant: 25_000, libelle: "Loyer du dépôt" });
    const t = (await o.api("GET", `/tableau-de-bord/branche?espace=commerce&du=${aujourdhui()}&au=${aujourdhui()}`)).corps;
    expect(t.depenses.total).toBe(25_000);
    expect(t.achats.total).toBe(3_000_000);
  });
});
