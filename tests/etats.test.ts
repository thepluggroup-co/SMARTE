import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { bilan, calculFiscal, compteDeResultat, dotationAnnee, fluxDeTresorerie, LIBELLES } from "../src/etats.js";
import { controleTroisVoies } from "../src/fournisseurs.js";
import { PLAN_DE_DEPART } from "../src/plan_comptable.js";
import { environnement } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
const L = (numero: string, debit: number, credit = 0) => ({ numero, debit, credit });

describe("modèles officiels", () => {
  it("calcule les soldes intermédiaires du compte de résultat", () => {
    const { lignes: m, nonClasses } = compteDeResultat([L("7011", 0, 1000), L("6011", 400), L("7061", 0, 500), L("622", 100), L("6611", 200), L("6813", 50), L("771", 0, 10), L("671", 20), L("822", 0, 30), L("812", 10), L("891", 40)]);
    expect(nonClasses).toEqual([]);
    expect(m).toMatchObject({ XA: 600, XB: 1500, XC: 1000, XD: 800, XE: 750, XF: -10, XG: 740, XH: 20, XI: 720 });
  });
  it("équilibre le bilan, sépare brut et amortissements, et classe les tiers selon leur solde", () => {
    const b = bilan([L("101", 0, 1000), L("2442", 600), L("2844", 0, 100), L("4111", 300), L("419", 0, 50), L("5711", 700), L("4011", 0, 400), L("4431", 0, 50), L("7011", 0, 200), L("601", 200)]);
    expect(b.equilibre).toBe(true);
    const a = (r: string) => b.actif.find((x) => x.ref === r)!;
    expect(a("AM")).toMatchObject({ brut: 600, amort: 100, net: 500 });
    expect(a("BI").net).toBe(300);
    expect(a("BS").net).toBe(700);
    const p = (r: string) => b.passif.find((x) => x.ref === r)!.net;
    expect([p("DI"), p("DJ"), p("DK"), p("CA"), p("CJ")]).toEqual([50, 400, 50, 1000, 0]);
    expect(b.tresorerie).toBe(700);
  });
  it("le tableau des flux retrouve la trésorerie, investissement, emprunt et cession compris", () => {
    const m = [L("101", 0, 1000), L("5711", 1000 + 500 - 300 + 200, 0), L("162", 0, 500), L("2442", 300), L("7011", 0, 500), L("4111", 300), L("6813", 60), L("2844", 0, 60), L("4851", 0), L("812", 0)];
    const f = fluxDeTresorerie(m, 100, 1500);
    const v = Object.fromEntries(f.lignes.map((l) => [l.ref, l.montant]));
    expect(v.FA).toBe(500);
    expect(v.FD).toBe(-300);
    expect(v.FG).toBe(-300);
    expect(v.FK).toBe(1000);
    expect(v.FO).toBe(500);
    expect(v.ZH).toBe(1500);
    expect(f.ecart).toBe(0);
  });
  it("chaque compte du plan de départ a une rubrique, sauf les comptes généraux d'amortissement", () => {
    const hors = PLAN_DE_DEPART.map(([n]) => n).filter((n) => {
      const b = [L(n, 100), L("5711", 0, 100)];
      return bilan(b).nonClasses.includes(n) || compteDeResultat(b).nonClasses.includes(n);
    });
    expect(hors).toEqual(["28", "29"]);
    for (const r of ["AE", "BZ", "DZ", "XI", "ZG"]) expect(LIBELLES[r]).toBeTruthy();
  });
  it("amortit au mois, solde la dernière année, arrête à la cession", () => {
    const i = { cout: 1200, valeur_residuelle: 0, duree_mois: 24, date_service: "2025-07-15" };
    expect([2024, 2025, 2026, 2027, 2028].map((a) => dotationAnnee(i, a))).toEqual([0, 300, 600, 300, 0]);
    expect(dotationAnnee({ ...i, cout: 1000 }, 2025) + dotationAnnee({ ...i, cout: 1000 }, 2026) + dotationAnnee({ ...i, cout: 1000 }, 2027)).toBe(1000);
    expect(dotationAnnee({ ...i, cession_le: "2026-04-10" }, 2026)).toBe(150);
    expect(dotationAnnee({ ...i, cession_le: "2026-04-10" }, 2027)).toBe(0);
  });
  it("passe au résultat fiscal avec les seuls taux saisis, déficit et minimum compris", () => {
    const d = { reintegrations: [{ libelle: "x", montant: 100 }], deductions: [{ libelle: "y", montant: 50 }], deficit_anterieur: 50, taux_is: 30, taux_cac: 10, minimum_du: 0, acomptes: 10 };
    expect(calculFiscal(900, 100, d)).toMatchObject({ avantImpot: 1000, resultatFiscal: 1050, imposable: 1000, principal: 300, cac: 30, du: 330, solde: 320, tauxManquants: false });
    expect(calculFiscal(-100, 0, { ...d, minimum_du: 77 })).toMatchObject({ imposable: 0, du: 77 });
    expect(calculFiscal(0, 0, { ...d, taux_is: null }).tauxManquants).toBe(true);
  });
  it("compare facture, commande et réception", () => {
    expect(controleTroisVoies(100, null, null).statut).toBe("sans_commande");
    expect(controleTroisVoies(100, 100, 0).statut).toBe("non_recu");
    expect(controleTroisVoies(100, 100, 100).statut).toBe("conforme");
    expect(controleTroisVoies(120, 100, 100)).toEqual({ statut: "ecart", ecart: 20 });
  });
});

const preparer = async () => {
  const o = await env.nouvelleOrganisation();
  await env.api("POST", "/compta/initialisation", o.jeton, { brancheId: o.entites.GLOMARI });
  return o;
};
const B = (o: Org) => o.entites.GLOMARI!;
const toutPasser = async (o: Org, fin = "2030-12-31") => {
  const g = await env.api("POST", "/compta/generation", o.jeton, { brancheId: B(o), fin });
  expect(g.statut).toBe(200);
  const b = (await env.api("GET", `/compta/ecritures?brancheId=${B(o)}&statut=brouillon`, o.jeton)).corps.map((x: { id: string }) => x.id);
  if (b.length) expect((await env.api("POST", "/compta/ecritures/validation", o.jeton, { ids: b })).statut).toBe(200);
};
const soldes = async (o: Org) => {
  const b = (await env.api("GET", `/compta/balance?brancheId=${B(o)}&debut=2000-01-01&fin=2100-01-01`, o.jeton)).corps;
  expect(b.debit).toBe(b.credit);
  return Object.fromEntries(b.lignes.map((l: { numero: string; debit: number; credit: number }) => [l.numero, l.debit - l.credit]));
};
const facture = async (o: Org, extra: object = {}, lignes = [{ designation: "Loyer", compte: "622", montantHt: 100000, montantTaxes: 19250 }]) => {
  const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: `F${Math.random()}`, entiteId: B(o) });
  return env.api("POST", "/fournisseurs/factures", o.jeton, { entiteId: B(o), fournisseurId: t.corps.id, numeroFournisseur: "A1", date: "2026-02-01", niu: "M0123", lignes, ...extra });
};
const portefeuille = async (o: Org, type = "banque", soldeInitial = 500000) => (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: B(o), nom: `P${Math.random()}`, type, soldeInitial })).corps.id as string;

describe("factures fournisseurs", () => {
  it("va de la saisie au paiement, avec les écritures et le portefeuille", async () => {
    const o = await preparer();
    const f = await facture(o);
    expect(f.corps.total_ttc).toBe(119250);
    const u = `/fournisseurs/factures/${f.corps.id}`;
    const w = await portefeuille(o);
    const payer = (montant: number) => env.api("POST", `${u}/paiements`, o.jeton, { portefeuilleId: w, montant, date: "2026-02-10" });
    expect((await payer(1)).corps.erreur).toBe("facture_non_validee");
    expect((await env.api("POST", `${u}/validation`, o.jeton)).corps.numero).toMatch(/^FF-2026/);
    expect((await env.api("POST", `${u}/validation`, o.jeton)).statut).toBe(409);
    expect((await payer(200000)).corps.erreur).toBe("montant_superieur_au_reste");
    const p = await payer(100000);
    expect(p.statut).toBe(201);
    expect((await env.api("POST", `${u}/annulation`, o.jeton, { motif: "Erreur de saisie" })).corps.erreur).toBe("facture_payee");
    await toutPasser(o);
    let s = await soldes(o);
    expect(s).toMatchObject({ "622": 100000, "4452": 19250, "4011": -19250, "5211": 400000 });
    expect((await env.api("GET", `/portefeuilles/${w}/mouvements`, o.jeton)).corps.solde).toBe(400000);
    expect((await env.api("POST", `/fournisseurs/paiements/${p.corps.id}/annulation`, o.jeton, { motif: "Erreur de saisie" })).statut).toBe(200);
    expect((await env.api("GET", `/portefeuilles/${w}/mouvements`, o.jeton)).corps.solde).toBe(500000);
    await toutPasser(o);
    s = await soldes(o);
    expect(s["5211"]).toBe(500000);
    expect(s["4011"]).toBe(-119250);
  });

  it("refuse un paiement sans solde, un doublon et un compte hors achats, et signale les espèces", async () => {
    const o = await preparer();
    const f = await facture(o);
    const t = f.corps.fournisseur_id;
    expect((await env.api("POST", "/fournisseurs/factures", o.jeton, { entiteId: B(o), fournisseurId: t, numeroFournisseur: "A1", date: "2026-02-01", lignes: [{ designation: "x", compte: "622", montantHt: 1 }] })).statut).toBe(409);
    expect((await facture(o, {}, [{ designation: "x", compte: "7011", montantHt: 1, montantTaxes: 0 }])).corps.erreur).toBe("compte_achat_invalide");
    await env.api("POST", `/fournisseurs/factures/${f.corps.id}/validation`, o.jeton);
    const vide = await portefeuille(o, "orange_money", 0);
    expect((await env.api("POST", `/fournisseurs/factures/${f.corps.id}/paiements`, o.jeton, { portefeuilleId: vide, montant: 1, date: "2026-02-10" })).corps.erreur).toBe("solde_portefeuille_insuffisant");
    const cash = await portefeuille(o, "especes");
    const p = await env.api("POST", `/fournisseurs/factures/${f.corps.id}/paiements`, o.jeton, { portefeuilleId: cash, montant: 100000, date: "2026-02-10" });
    expect(p.corps.alerte_especes).toBe(true);
    const gta = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: o.entites.GTA, nom: "G", type: "banque", soldeInitial: 100 })).corps.id;
    expect((await env.api("POST", `/fournisseurs/factures/${f.corps.id}/paiements`, o.jeton, { portefeuilleId: gta, montant: 1, date: "2026-02-10" })).corps.erreur).toBe("transfert_autre_branche");
    const e = await env.nouvelleOrganisation();
    expect((await env.api("GET", `/fournisseurs/factures/${f.corps.id}`, e.jeton)).statut).toBe(404);
  });

  it("exige un motif quand la facture ne correspond pas à la réception", async () => {
    const o = await preparer();
    const t = await env.api("POST", "/tiers", o.jeton, { type: "entreprise", nom: "Fourni", entiteId: B(o) });
    const p = await env.api("POST", "/produits", o.jeton, { entiteId: B(o), code: "A", nom: "A", suiviStock: true, prixVente: 10 });
    const c = await env.api("POST", "/achats/commandes", o.jeton, { entiteId: B(o), fournisseurId: t.corps.id, date: "2026-01-01", lignes: [{ produitId: p.corps.id, quantite: 2, prixUnitaire: 1000 }] });
    expect(c.statut).toBe(201);
    const f = await env.api("POST", "/fournisseurs/factures", o.jeton, { entiteId: B(o), fournisseurId: t.corps.id, numeroFournisseur: "Z", date: "2026-01-05", commandeId: c.corps.id, lignes: [{ designation: "A", compte: "601", montantHt: 3000 }] });
    expect(f.statut).toBe(201);
    const v = (b?: object) => env.api("POST", `/fournisseurs/factures/${f.corps.id}/validation`, o.jeton, b);
    expect((await v()).corps).toMatchObject({ erreur: "ecart_trois_voies", details: { statut: "non_recu" } });
    expect((await v({ motifEcart: "Service accepté sans bon" })).corps.motif_ecart).toBe("Service accepté sans bon");
  });

  it("passe un investissement au compte des fournisseurs d'investissements", async () => {
    const o = await preparer();
    const f = await facture(o, {}, [{ designation: "PC", compte: "2442", montantHt: 800000, montantTaxes: 0 }]);
    await env.api("POST", `/fournisseurs/factures/${f.corps.id}/validation`, o.jeton);
    await toutPasser(o);
    expect(await soldes(o)).toMatchObject({ "2442": 800000, "4812": -800000 });
  });
});

describe("immobilisations", () => {
  it("passe dotation et cession une seule fois, et le bilan reste juste", async () => {
    const o = await preparer();
    const i = await env.api("POST", "/immobilisations", o.jeton, { brancheId: B(o), code: "PC1", designation: "Ordinateur", categorie: "informatique", dateAcquisition: "2025-01-05", dateService: "2025-01-10", cout: 1200000, dureeMois: 48 });
    expect(i.corps).toMatchObject({ compte_numero: "2442", compte_amort: "2844" });
    expect(Number(i.corps.taux_fiscal)).toBe(25);
    await env.api("POST", "/compta/ecritures", o.jeton, { brancheId: B(o), journal: "OD", date: "2025-01-05", libelle: "Achat comptant", lignes: [{ numero: "2442", debit: 1200000 }, { numero: "101", credit: 1200000 }] });
    const dot = (annee: number) => env.api("POST", "/immobilisations/dotations", o.jeton, { brancheId: B(o), annee });
    expect((await dot(2025)).corps.crees).toBe(1);
    expect((await dot(2025)).corps.crees).toBe(0);
    await toutPasser(o, "2025-12-31");
    expect(await soldes(o)).toMatchObject({ "6813": 300000, "2844": -300000 });
    expect((await env.api("POST", `/immobilisations/${i.corps.id}/cession`, o.jeton, { date: "2026-01-20", prix: 1000000 })).statut).toBe(200);
    expect((await env.api("POST", `/immobilisations/${i.corps.id}/cession`, o.jeton, { date: "2026-01-20", prix: 1 })).corps.erreur).toBe("deja_cede");
    await toutPasser(o, "2026-12-31");
    const s = await soldes(o);
    expect(s).toMatchObject({ "2442": 0, "2844": 0, "812": 900000, "822": -1000000, "4851": 1000000 });
    const l = (await env.api("GET", `/immobilisations?brancheId=${B(o)}&annee=2026`, o.jeton)).corps[0];
    expect(l.dotation_annee).toBe(0);
  });
});

describe("états officiels et DSF", () => {
  async function exercice(o: Org) {
    const ecr = (date: string, lignes: object[]) => env.api("POST", "/compta/ecritures", o.jeton, { brancheId: B(o), journal: "OD", date, libelle: "Écriture", lignes });
    const ids = [
      await ecr("2025-01-02", [{ numero: "5211", debit: 2000000 }, { numero: "101", credit: 2000000 }]),
      await ecr("2025-01-10", [{ numero: "2442", debit: 600000 }, { numero: "5211", credit: 600000 }]),
      await ecr("2025-02-01", [{ numero: "4111", debit: 1192500 }, { numero: "7011", credit: 1000000 }, { numero: "4431", credit: 192500 }]),
      await ecr("2025-03-01", [{ numero: "5711", debit: 500000 }, { numero: "4111", credit: 500000 }]),
      await ecr("2025-03-05", [{ numero: "622", debit: 200000 }, { numero: "5711", credit: 200000 }]),
      await ecr("2025-12-31", [{ numero: "6813", debit: 150000 }, { numero: "2844", credit: 150000 }]),
      await ecr("2025-12-31", [{ numero: "891", debit: 100000 }, { numero: "441", credit: 100000 }]),
    ].map((x) => x.corps.id);
    await env.api("POST", "/compta/ecritures/validation", o.jeton, { ids });
    for (const m of ["2025-01", "2025-02", "2025-03", "2025-12"]) await env.api("POST", "/compta/clotures", o.jeton, { brancheId: B(o), mois: m, definitive: true });
    expect((await env.api("POST", "/compta/exercices/cloture", o.jeton, { brancheId: B(o), annee: 2025 })).corps.resultat).toBe(550000);
    const an = (await env.api("GET", `/compta/ecritures?brancheId=${B(o)}&statut=brouillon`, o.jeton)).corps[0].id;
    await env.api("POST", "/compta/ecritures/validation", o.jeton, { ids: [an] });
  }

  it("produit des états équilibrés, et le report sur N+1 se retrouve", async () => {
    const o = await preparer();
    await exercice(o);
    const e = (await env.api("GET", `/compta/etats-officiels?brancheId=${B(o)}&annee=2025`, o.jeton)).corps;
    expect(e.bilan.equilibre).toBe(true);
    expect(e.bilan.nonClasses).toEqual([]);
    expect(e.compteDeResultat.lignes.XI).toBe(550000);
    expect(e.compteDeResultat.lignes.XB).toBe(1000000);
    expect(e.flux.ecart).toBe(0);
    expect(e.bilan.tresorerie).toBe(1700000);
    expect(e.clos).toBe(true);
    const a = (r: string) => e.bilan.actif.find((x: { ref: string }) => x.ref === r);
    expect(a("AM")).toMatchObject({ brut: 600000, amort: 150000, net: 450000 });
    const n = (await env.api("GET", `/compta/etats-officiels?brancheId=${B(o)}&annee=2026`, o.jeton)).corps;
    expect(n.bilan.equilibre).toBe(true);
    expect(n.bilan.totalActif).toBe(e.bilan.totalActif);
    expect(n.flux.lignes.find((l: { ref: string }) => l.ref === "ZA").montant).toBe(1700000);
    expect(n.flux.ecart).toBe(0);
    expect(n.n1.resultat.XI).toBe(550000);
    expect(n.n1.actif.AM).toBe(450000);
  });

  it("n'annonce un dossier prêt qu'après les taux et la relecture de l'expert, et suggère les réintégrations", async () => {
    const o = await preparer();
    await exercice(o);
    const u = `/compta/dsf?brancheId=${B(o)}&annee=2025`;
    const d = (await env.api("GET", u, o.jeton)).corps;
    expect(d.pret).toBe(false);
    expect(d.blocages.join()).toContain("taux");
    expect(d.suggestions[0].montant).toBe(200000);
    const corps = { brancheId: B(o), annee: 2025, centre: "cime", reintegrations: [{ libelle: "Espèces", montant: 200000 }], deductions: [], deficitAnterieur: 0, tauxIs: 30, tauxCac: 10, minimumDu: 0, acomptes: 50000 };
    const p = (await env.api("PUT", "/compta/dsf", o.jeton, corps)).corps;
    expect(p.fiscal).toMatchObject({ avantImpot: 650000, resultatFiscal: 850000, principal: 255000, cac: 25500, du: 280500, solde: 230500 });
    expect(p.pret).toBe(false);
    expect(p.echeance.date).toBe("15 avril");
    const r = (await env.api("PUT", "/compta/dsf", o.jeton, { ...corps, relueParExpert: "Cabinet X", relueLe: "2026-03-01" })).corps;
    expect(r.pret).toBe(true);
    const x = await env.api("GET", `/compta/dsf/export?brancheId=${B(o)}&annee=2025`, o.jeton);
    expect(x.corps).toContain("Actif;AM;");
    expect(x.corps).toContain("Impot du");
    const roles = (await env.api("GET", "/roles", o.jeton)).corps;
    expect(roles.length).toBeGreaterThan(0);
    const e = await env.nouvelleOrganisation();
    expect((await env.api("GET", u, e.jeton)).statut).toBe(404);
    await expect(dansOrganisation(env.poolApp, o.organisationId, (c) => c.query("delete from preparations_dsf"))).rejects.toThrow(/permission denied/);
  });
});
