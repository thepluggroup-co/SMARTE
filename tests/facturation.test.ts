import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { calculerLigne } from "../src/facturation.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;

async function societe() {
  const o = await env.nouvelleOrganisation();
  await env.api("PATCH", `/entites/${o.entites.GTA}/identite`, o.jeton, {
    raisonSociale: "Global Training Academy", niu: "M000000000000A", rccm: "RC/DLA/0", adresse: "Douala",
  });
  const client = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Client" });
  return { ...o, tiersId: client.corps.id as string };
}
type Soc = Awaited<ReturnType<typeof societe>>;

const brouillon = (o: Soc, type: string, lignes: object[], extra = {}) =>
  env.api("POST", "/documents-vente", o.jeton, { type, entiteId: o.entites.GTA, tiersId: o.tiersId, date: "2026-01-15", lignes, ...extra });
const LIGNE = { designation: "Formation", quantite: 1, prixUnitaire: 100000, tauxTaxe: 19.25 };
async function facture(o: Soc, lignes: object[] = [LIGNE], extra = {}) {
  const b = await brouillon(o, "facture", lignes, extra);
  expect(b.statut).toBe(201);
  const e = await env.api("POST", `/documents-vente/${b.corps.id}/emission`, o.jeton);
  expect(e.statut).toBe(200);
  return e.corps;
}
const creances = async (o: Org) => (await env.api("GET", "/creances", o.jeton)).corps;

describe("calculs", () => {
  it("arrondit au franc sans erreur de virgule", () => {
    expect(calculerLigne(1, 100000, 0, 19.25)).toEqual({ ht: 100000, taxes: 19250 });
    expect(calculerLigne(3, 333, 0, 19.25)).toEqual({ ht: 999, taxes: 192 });
    expect(calculerLigne(1.5, 1001, 10, 19.25)).toEqual({ ht: 1351, taxes: 260 });
    expect(calculerLigne(0.1, 30, 0, 0)).toEqual({ ht: 3, taxes: 0 });
    expect(calculerLigne(2, 5000, 100, 19.25)).toEqual({ ht: 0, taxes: 0 });
  });
});

describe("factures", () => {
  it("calcule les totaux, numérote sans rupture et fige la facture à l'émission", async () => {
    const o = await societe();
    const b = await brouillon(o, "facture", [LIGNE, { designation: "Support", quantite: 2, prixUnitaire: 5000, tauxTaxe: 0 }], { echeance: "2026-02-15" });
    expect(b.corps).toMatchObject({ statut: "brouillon", numero: null, total_ht: 110000, total_taxes: 19250, total_ttc: 129250 });
    await env.api("PUT", `/documents-vente/${b.corps.id}/lignes`, o.jeton, { lignes: [LIGNE] });
    const e = await env.api("POST", `/documents-vente/${b.corps.id}/emission`, o.jeton);
    expect(e.corps).toMatchObject({
      statut: "emis", numero: "FAC-GTA-2026-000001", total_ttc: 119250, client_nom: "Client",
      vendeur_nom: "Global Training Academy", vendeur_niu: "M000000000000A",
    });
    const url = `/documents-vente/${b.corps.id}`;
    expect((await env.api("PUT", `${url}/lignes`, o.jeton, { lignes: [LIGNE] })).statut).toBe(409);
    expect((await env.api("POST", `${url}/emission`, o.jeton)).statut).toBe(409);
    expect((await env.api("POST", `${url}/abandon`, o.jeton)).statut).toBe(409);
    await expect(dansOrganisation(env.poolApp, o.organisationId, (c) => c.query("update documents_vente set total_ttc = 1 where id = $1", [b.corps.id])))
      .rejects.toThrow(/ne peut pas être modifié/);
    await expect(dansOrganisation(env.poolApp, o.organisationId, (c) => c.query("update lignes_vente set prix_unitaire = 1 where document_id = $1", [b.corps.id])))
      .rejects.toThrow(/ne peut pas être modifié/);
    await expect(dansOrganisation(env.poolApp, o.organisationId, (c) => c.query("delete from documents_vente"))).rejects.toThrow(/permission denied/);
    const f2 = await facture(o);
    expect(f2.numero).toBe("FAC-GTA-2026-000002");
  });

  it("refuse d'émettre sans identité légale, mais un brouillon abandonné ne consomme pas de numéro", async () => {
    const o = await env.nouvelleOrganisation();
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "C" });
    const corps = { type: "facture", entiteId: o.entites.GTA, tiersId: t.corps.id, date: "2026-01-15", lignes: [LIGNE] };
    const b = await env.api("POST", "/documents-vente", o.jeton, corps);
    expect((await env.api("POST", `/documents-vente/${b.corps.id}/emission`, o.jeton)).corps.erreur).toBe("identite_vendeur_incomplete");
    await env.api("PATCH", `/entites/${o.entites.GTA}/identite`, o.jeton, { raisonSociale: "GTA", niu: "N1" });
    expect((await env.api("POST", `/documents-vente/${b.corps.id}/abandon`, o.jeton)).statut).toBe(200);
    expect((await env.api("GET", "/documents-vente", o.jeton)).corps).toEqual([]);
    const b2 = await env.api("POST", "/documents-vente", o.jeton, corps);
    expect((await env.api("POST", `/documents-vente/${b2.corps.id}/emission`, o.jeton)).corps.numero).toBe("FAC-GTA-2026-000001");
  });

  it("n'ajoute aucune taxe automatiquement, et accepte tout pourcentage saisi", async () => {
    const o = await societe();
    const sans = { designation: "F", quantite: 1, prixUnitaire: 100000 };
    expect((await brouillon(o, "facture", [sans])).corps).toMatchObject({ total_ht: 100000, total_taxes: 0, total_ttc: 100000 });
    expect((await brouillon(o, "facture", [{ ...sans, tauxTaxe: 7.5 }])).corps.total_taxes).toBe(7500);
    expect((await brouillon(o, "facture", [{ ...sans, tauxTaxe: 120 }])).statut).toBe(400);
    const p = await env.api("POST", "/produits", o.jeton, { entiteId: o.entites.GTA, code: "P", nom: "P", prixVente: 1000 });
    expect((await brouillon(o, "facture", [{ produitId: p.corps.id, quantite: 1 }])).corps.total_taxes).toBe(0);
    await env.api("PATCH", `/produits/${p.corps.id}`, o.jeton, { tauxTaxe: 10 });
    expect((await brouillon(o, "facture", [{ produitId: p.corps.id, quantite: 1 }])).corps.total_taxes).toBe(100);
    expect((await brouillon(o, "facture", [{ produitId: p.corps.id, quantite: 1, tauxTaxe: 0 }])).corps.total_taxes).toBe(0);
    const emis = await facture(o, [{ ...sans, tauxTaxe: 7.5 }]);
    expect((await env.api("GET", `/documents-vente/${emis.id}`, o.jeton)).corps.lignes[0].taux).toBe(7.5);
  });

  it("ajoute la livraison ou l'expédition au total et les suit après l'émission", async () => {
    const o = await societe();
    const f = await facture(o, [{ designation: "F", quantite: 1, prixUnitaire: 10000 }], {
      modeRemise: "expedition", transporteur: "Transport X", adresseLivraison: "Yaoundé", fraisLivraison: 2000, tauxFrais: 10,
    });
    expect(f).toMatchObject({ total_ht: 12000, total_taxes: 200, total_ttc: 12200, mode_remise: "expedition" });
    expect((await env.api("POST", `/factures/${f.id}/expedition`, o.jeton, { mode: "camion" })).statut).toBe(400);
    const e = await env.api("POST", `/factures/${f.id}/expedition`, o.jeton, { mode: "expedition", numeroSuivi: "S1" });
    expect(e.corps).toMatchObject({ statut: "preparation", transporteur: "Transport X", adresse: "Yaoundé" });
    expect((await env.api("POST", `/factures/${f.id}/expedition`, o.jeton, { mode: "retrait" })).statut).toBe(409);
    const url = `/expeditions/${e.corps.id}`;
    expect((await env.api("PATCH", url, o.jeton, { statut: "expediee" })).corps.expediee_le).toBeTruthy();
    const l = await env.api("PATCH", url, o.jeton, { statut: "livree", preuve: "Signé par le client" });
    expect(l.corps.livree_le).toBeTruthy();
    expect((await env.api("GET", `/documents-vente/${f.id}`, o.jeton)).corps.expedition.statut).toBe("livree");
    expect((await env.api("PATCH", url, o.jeton, { statut: "retournee" })).corps.livree_le).toBeNull();
    const av = await env.api("POST", `/factures/${f.id}/avoir`, o.jeton, { date: "2026-02-01", motif: "Annulation totale" });
    expect(av.corps.total_ttc).toBe(12200);
    const d = await brouillon(o, "devis", [{ designation: "F", quantite: 1, prixUnitaire: 1000 }], { modeRemise: "livraison", fraisLivraison: 500 });
    await env.api("POST", `/documents-vente/${d.corps.id}/emission`, o.jeton);
    await env.api("POST", `/devis/${d.corps.id}/decision`, o.jeton, { decision: "accepte" });
    const cf = await env.api("POST", `/devis/${d.corps.id}/facture`, o.jeton, { date: "2026-02-01" });
    expect(cf.corps).toMatchObject({ total_ttc: 1500, frais_livraison: 500, mode_remise: "livraison" });
  });

  it("garde le prix du moment si le catalogue change", async () => {
    const o = await societe();
    const p = await env.api("POST", "/produits", o.jeton, { entiteId: o.entites.GTA, code: "F1", nom: "Formation", type: "formation", prixVente: 50000 });
    const f = await facture(o, [{ produitId: p.corps.id, quantite: 2, remisePct: 10 }]);
    expect(f.total_ht).toBe(90000);
    await env.api("PATCH", `/produits/${p.corps.id}`, o.jeton, { prixVente: 99999 });
    const d = (await env.api("GET", `/documents-vente/${f.id}`, o.jeton)).corps;
    expect(d.lignes[0]).toMatchObject({ designation: "Formation", prix_unitaire: 50000, montant_ht: 90000 });
    await env.api("PATCH", `/produits/${p.corps.id}`, o.jeton, { actif: false });
    expect((await brouillon(o, "facture", [{ produitId: p.corps.id, quantite: 1 }])).statut).toBe(404);
  });
});

describe("devis", () => {
  it("passe du devis accepté à une seule facture", async () => {
    const o = await societe();
    const b = await brouillon(o, "devis", [LIGNE]);
    const url = `/devis/${b.corps.id}`;
    expect((await env.api("POST", `${url}/decision`, o.jeton, { decision: "accepte" })).statut).toBe(409);
    const e = await env.api("POST", `/documents-vente/${b.corps.id}/emission`, o.jeton);
    expect(e.corps.numero).toBe("DEV-GTA-2026-000001");
    expect((await env.api("POST", `${url}/facture`, o.jeton, { date: "2026-01-20" })).corps.erreur).toBe("devis_non_accepte");
    await env.api("POST", `${url}/decision`, o.jeton, { decision: "accepte" });
    const f = await env.api("POST", `${url}/facture`, o.jeton, { date: "2026-01-20" });
    expect(f.corps).toMatchObject({ type: "facture", statut: "brouillon", total_ttc: 119250, origine_id: b.corps.id });
    expect((await env.api("POST", `${url}/facture`, o.jeton, { date: "2026-01-20" })).corps.erreur).toBe("deja_facture");
  });
});

describe("règlements et avoirs", () => {
  it("suit le reste dû, refuse le trop perçu et les références répétées", async () => {
    const o = await societe();
    const f = await facture(o);
    const url = `/factures/${f.id}/reglements`;
    const regler = (c: object) => env.api("POST", url, o.jeton, c);
    expect((await regler({ montant: 119251, moyen: "especes" })).corps.erreur).toBe("montant_superieur_au_reste");
    expect((await regler({ montant: 1000, moyen: "mtn_momo" })).corps.erreur).toBe("reference_obligatoire");
    const r = await regler({ montant: 19250, moyen: "mtn_momo", reference: "R1" });
    expect(r.corps).toMatchObject({ numero_recu: expect.stringMatching(/^REG-\d{4}-000001$/), reste_apres: 100000 });
    expect((await regler({ montant: 1000, moyen: "mtn_momo", reference: "R1" })).corps.erreur).toBe("reference_deja_utilisee");
    expect((await env.api("POST", `/reglements/${r.corps.id}/annulation`, o.jeton, { motif: "Erreur de saisie" })).statut).toBe(200);
    expect((await env.api("POST", `/reglements/${r.corps.id}/annulation`, o.jeton, { motif: "Encore une fois" })).statut).toBe(409);
    const d = (await env.api("GET", `/documents-vente/${f.id}`, o.jeton)).corps;
    expect(d.soldes).toEqual({ ttc: 119250, regle: 0, avoirs: 0, reste: 119250 });
  });

  it("des règlements simultanés ne dépassent jamais le dû", async () => {
    const o = await societe();
    const f = await facture(o);
    const r = await Promise.all(Array.from({ length: 8 }, () =>
      env.api("POST", `/factures/${f.id}/reglements`, o.jeton, { montant: 50000, moyen: "especes" })));
    expect(r.filter((x) => x.statut === 201)).toHaveLength(2);
  });

  it("corrige par un avoir plafonné, et non en modifiant la facture", async () => {
    const o = await societe();
    const f = await facture(o);
    await env.api("POST", `/factures/${f.id}/reglements`, o.jeton, { montant: 60000, moyen: "especes" });
    const url = `/factures/${f.id}/avoir`;
    expect((await env.api("POST", url, o.jeton, { date: "2026-02-01", motif: "Annulation totale" })).corps.erreur).toBe("avoir_superieur_au_reste");
    const a = await env.api("POST", url, o.jeton, {
      date: "2026-02-01", motif: "Remise commerciale", lignes: [{ designation: "Remise", quantite: 1, prixUnitaire: 20000, tauxTaxe: 19.25 }],
    });
    expect(a.corps).toMatchObject({ type: "avoir", numero: "AV-GTA-2026-000001", total_ttc: 23850, motif: "Remise commerciale" });
    const d = (await env.api("GET", `/documents-vente/${f.id}`, o.jeton)).corps;
    expect(d.soldes).toEqual({ ttc: 119250, regle: 60000, avoirs: 23850, reste: 35400 });
    expect(d.lies[0].numero).toBe("AV-GTA-2026-000001");
    expect((await env.api("POST", `/factures/${a.corps.id}/reglements`, o.jeton, { montant: 1, moyen: "especes" })).corps.erreur).toBe("facture_non_emise");
    // Un avoir refusé ne consomme pas de numéro.
    expect((await env.api("POST", url, o.jeton, { date: "2026-02-02", motif: "Trop élevé" })).statut).toBe(409);
    const a2 = await env.api("POST", url, o.jeton, { date: "2026-02-02", motif: "Petite remise", lignes: [{ designation: "R", quantite: 1, prixUnitaire: 100, tauxTaxe: 0 }] });
    expect(a2.corps.numero).toBe("AV-GTA-2026-000002");
  });

  it("classe les créances selon leur retard, sans les factures soldées", async () => {
    const o = await societe();
    const jour = (d: number) => new Date(Date.now() + 3600000 - d * 86400000).toISOString().slice(0, 10);
    const avec = (echeanceIlYa: number) => facture(o, [{ ...LIGNE, tauxTaxe: 0 }], { date: jour(echeanceIlYa + 1), echeance: jour(echeanceIlYa) });
    await avec(-10);
    await avec(5);
    await avec(45);
    const soldee = await avec(90);
    await avec(90);
    await env.api("POST", `/factures/${soldee.id}/reglements`, o.jeton, { montant: 100000, moyen: "especes" });
    expect(await creances(o)).toMatchObject([{
      client: "Client", total: 400000, non_echu: 100000, de_1_a_30: 100000, de_31_a_60: 100000, plus_de_60: 100000,
    }]);
  });
});

describe("droits et isolation", () => {
  async function utilisateur(o: Org, code: string, entiteId: string) {
    const roles = (await env.api("GET", "/roles", o.jeton)).corps;
    const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
    await env.api("POST", "/utilisateurs", o.jeton, {
      email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((r: { code: string }) => r.code === code).id,
    });
    return env.connecter(o.slug, email);
  }

  it("la caisse encaisse sans émettre ni annuler, et le coût reste réservé", async () => {
    const o = await societe();
    const f = await facture(o);
    const caisse = await utilisateur(o, "caisse", o.entites.GTA!);
    const r = await env.api("POST", `/factures/${f.id}/reglements`, caisse, { montant: 100, moyen: "especes" });
    expect(r.statut).toBe(201);
    expect((await env.api("POST", `/reglements/${r.corps.id}/annulation`, caisse, { motif: "Je veux annuler" })).statut).toBe(403);
    expect((await env.api("POST", "/documents-vente", caisse, { type: "facture", entiteId: o.entites.GTA, tiersId: o.tiersId, date: "2026-01-15", lignes: [LIGNE] })).statut).toBe(403);
    await env.api("POST", "/produits", o.jeton, { entiteId: o.entites.GTA, code: "A", nom: "A" });
    const liste = (await env.api("GET", "/produits", caisse)).corps;
    expect(liste[0]).not.toHaveProperty("cout_moyen");
    expect((await env.api("GET", "/produits", o.jeton)).corps[0]).toHaveProperty("cout_moyen");
    expect((await env.api("POST", "/produits", caisse, { entiteId: o.entites.GTA, code: "B", nom: "B" })).statut).toBe(403);
  });

  it("une entité ne voit pas les factures d'une autre", async () => {
    const o = await societe();
    const f = await facture(o);
    const ailleurs = await utilisateur(o, "comptabilite", o.entites.GLOMARI!);
    expect((await env.api("GET", "/documents-vente", ailleurs)).corps).toEqual([]);
    expect((await env.api("GET", `/documents-vente/${f.id}`, ailleurs)).statut).toBe(403);
    expect((await env.api("POST", `/factures/${f.id}/reglements`, ailleurs, { montant: 1, moyen: "especes" })).statut).toBe(403);
    expect((await env.api("GET", "/creances", ailleurs)).corps).toEqual([]);
  });

  it("un autre client ne voit rien, et sa numérotation est indépendante", async () => {
    const a = await societe();
    const b = await societe();
    const f = await facture(b);
    const p = await env.api("POST", "/produits", b.jeton, { entiteId: b.entites.GTA, code: "S", nom: "Secret" });
    expect((await env.api("GET", `/documents-vente/${f.id}`, a.jeton)).statut).toBe(404);
    expect((await env.api("POST", `/factures/${f.id}/avoir`, a.jeton, { date: "2026-02-01", motif: "Tentative" })).statut).toBe(404);
    expect((await env.api("GET", "/produits", a.jeton)).corps).toEqual([]);
    expect((await env.api("PATCH", `/produits/${p.corps.id}`, a.jeton, { nom: "X" })).statut).toBe(404);
    expect((await brouillon(a, "facture", [{ produitId: p.corps.id, quantite: 1 }])).statut).toBe(404);
    expect((await env.api("POST", "/documents-vente", a.jeton, { type: "facture", entiteId: a.entites.GTA, tiersId: b.tiersId, date: "2026-01-15", lignes: [LIGNE] })).statut).toBe(404);
    expect((await facture(a)).numero).toBe(f.numero);
  });
});
