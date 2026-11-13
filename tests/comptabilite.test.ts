import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { celluleCsv, etatsDeSynthese, ligne, totaux } from "../src/comptabilite.js";
import { PARAMETRES_DE_DEPART, PLAN_DE_DEPART } from "../src/plan_comptable.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
const preparer = async () => {
  const o = await env.nouvelleOrganisation();
  expect((await env.api("POST", "/compta/initialisation", o.jeton, { brancheId: o.entites.GLOMARI })).statut).toBe(200);
  return o;
};
const saisir = (o: Org, lignes: object[], date = "2025-03-10", journal = "OD", jeton = o.jeton) =>
  env.api("POST", "/compta/ecritures", jeton, { brancheId: o.entites.GLOMARI, journal, date, libelle: "Écriture de test", lignes });
const valider = (o: Org, ids: string[], jeton = o.jeton) => env.api("POST", "/compta/ecritures/validation", jeton, { ids });
const SIMPLE = [{ numero: "5711", debit: 1000 }, { numero: "7011", credit: 1000 }];
const brouillons = async (o: Org) => (await env.api("GET", `/compta/ecritures?brancheId=${o.entites.GLOMARI}&statut=brouillon`, o.jeton)).corps;
const balance = async (o: Org, debut = "2000-01-01", fin = "2100-12-31") => (await env.api("GET", `/compta/balance?brancheId=${o.entites.GLOMARI}&debut=${debut}&fin=${fin}`, o.jeton)).corps;
const soldeDe = (b: { lignes: { numero: string; debit: number; credit: number }[] }, n: string) => { const l = b.lignes.find((x) => x.numero === n); return l ? l.debit - l.credit : 0; };
async function compte(o: Org, code: string, entiteId: string) {
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
  await env.api("POST", "/utilisateurs", o.jeton, { email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((x: { code: string }) => x.code === code).id });
  return env.connecter(o.slug, email);
}

describe("calculs comptables", () => {
  it("place le montant du bon côté", () => {
    expect(ligne("411", 100)).toEqual([{ numero: "411", debit: 100, tiersId: undefined, section: undefined }]);
    expect(ligne("411", -100)[0]!.credit).toBe(100);
    expect(ligne("411", 0)).toEqual([]);
    expect(totaux([{ debit: 5 }, { credit: 5 }])).toEqual({ debit: 5, credit: 5 });
  });
  it("équilibre le bilan avec le résultat, amortissements et comptes créditeurs compris", () => {
    const e = etatsDeSynthese([
      { numero: "101", libelle: "", debit: 0, credit: 1000 }, { numero: "24", libelle: "", debit: 500, credit: 0 }, { numero: "28", libelle: "", debit: 0, credit: 100 },
      { numero: "5711", libelle: "", debit: 900, credit: 0 }, { numero: "4011", libelle: "", debit: 0, credit: 200 }, { numero: "7011", libelle: "", debit: 0, credit: 300 },
      { numero: "601", libelle: "", debit: 100, credit: 0 }, { numero: "681", libelle: "", debit: 100, credit: 0 },
    ]);
    expect(e).toMatchObject({ resultat: 100, totalActif: 1300, totalPassif: 1300, equilibre: true });
  });
  it("neutralise une cellule qui ressemblerait à une formule", () => {
    expect(celluleCsv("=2+2")).toBe("'=2+2");
    expect(celluleCsv('a;"b"')).toBe('"a;""b"""');
  });
  it("propose uniquement des comptes présents dans le plan de départ, sans doublon", () => {
    const n = PLAN_DE_DEPART.map(([x]) => x);
    expect(new Set(n).size).toBe(n.length);
    for (const c of Object.values(PARAMETRES_DE_DEPART)) expect(n).toContain(c);
    for (const c of ["552", "585", "4431", "131", "139"]) expect(n).toContain(c);
  });
});

describe("écritures", () => {
  it("refuse une écriture déséquilibrée, une ligne double et un compte inconnu", async () => {
    const o = await preparer();
    expect((await saisir(o, [{ numero: "5711", debit: 1000 }, { numero: "7011", credit: 900 }])).corps.erreur).toBe("ecriture_desequilibree");
    expect((await saisir(o, [{ numero: "5711", debit: 10, credit: 10 }, { numero: "7011", credit: 1 }])).corps.erreur).toBe("ligne_comptable_invalide");
    expect((await saisir(o, [{ numero: "999", debit: 10 }, { numero: "7011", credit: 10 }])).corps.erreur).toBe("compte_inconnu");
    expect((await env.api("POST", "/compta/ecritures", o.jeton, { brancheId: o.entites.GTA, journal: "OD", date: "2025-01-01", libelle: "Autre", lignes: SIMPLE })).statut).toBe(404);
  });

  it("numérote sans trou à la validation, ne compte que le validé, et rend le validé intangible", async () => {
    const o = await preparer();
    const a = await saisir(o, SIMPLE);
    const b = await saisir(o, SIMPLE);
    expect(a.corps.numero).toBeNull();
    expect((await balance(o)).lignes).toEqual([]);
    await env.api("DELETE", `/compta/ecritures/${a.corps.id}`, o.jeton);
    const c = await saisir(o, SIMPLE);
    expect((await valider(o, [b.corps.id, c.corps.id])).corps.validees).toBe(2);
    const v = (await env.api("GET", `/compta/ecritures?brancheId=${o.entites.GLOMARI}&statut=validee`, o.jeton)).corps.map((x: { numero: string }) => x.numero).sort();
    expect(v).toEqual(["GLOMARI-OD-2025-000001", "GLOMARI-OD-2025-000002"]);
    expect(soldeDe(await balance(o), "5711")).toBe(2000);
    expect((await env.api("DELETE", `/compta/ecritures/${b.corps.id}`, o.jeton)).corps.erreur).toBe("ecriture_validee");
    expect((await valider(o, [b.corps.id])).corps.erreur).toBe("ecriture_validee");
    for (const sql of ["update ecritures set libelle = 'x' where id = $1", "delete from ecritures where id = $1", "update lignes_ecriture set debit = 1 where ecriture_id = $1 and debit > 0", "delete from lignes_ecriture where ecriture_id = $1"]) {
      await expect(dansOrganisation(env.poolApp, o.organisationId, (x) => x.query(sql, [b.corps.id]))).rejects.toThrow(/intangible/);
    }
  });

  it("la base refuse elle-même une validation déséquilibrée", async () => {
    const o = await preparer();
    const a = await saisir(o, SIMPLE);
    await dansOrganisation(env.poolApp, o.organisationId, (x) => x.query("delete from lignes_ecriture where ecriture_id = $1 and credit > 0", [a.corps.id]));
    await expect(dansOrganisation(env.poolApp, o.organisationId, (x) => x.query("update ecritures set statut = 'validee', numero = 'X' where id = $1", [a.corps.id]))).rejects.toThrow(/desequilibree/);
  });

  it("corrige par contre-passation une seule fois, et le total revient à zéro", async () => {
    const o = await preparer();
    const a = await saisir(o, SIMPLE);
    const cp = (x: string) => env.api("POST", `/compta/ecritures/${x}/contrepassation`, o.jeton, { date: "2025-03-20", motif: "Erreur de compte" });
    expect((await cp(a.corps.id)).corps.erreur).toBe("ecriture_non_validee");
    await valider(o, [a.corps.id]);
    const r = await cp(a.corps.id);
    expect(r.statut).toBe(201);
    expect((await cp(a.corps.id)).statut).toBe(409);
    await valider(o, [r.corps.id]);
    expect(soldeDe(await balance(o), "5711")).toBe(0);
  });

  it("sépare les droits : le comptable saisit, le chef valide, le réviseur lit, GTA ne voit pas GLOMARI", async () => {
    const o = await preparer();
    const [c, chef, rev, gta] = [await compte(o, "comptable", o.entites.GLOMARI!), await compte(o, "chef_comptable", o.entites.GLOMARI!), await compte(o, "reviseur", o.entites.GLOMARI!), await compte(o, "chef_comptable", o.entites.GTA!)];
    const a = await saisir(o, SIMPLE, "2025-03-10", "OD", c);
    expect(a.statut).toBe(201);
    expect((await valider(o, [a.corps.id], c)).statut).toBe(403);
    expect((await valider(o, [a.corps.id], gta)).statut).toBe(403);
    expect((await valider(o, [a.corps.id], chef)).statut).toBe(200);
    expect((await env.api("GET", `/compta/balance?brancheId=${o.entites.GLOMARI}&debut=2025-01-01&fin=2025-12-31`, rev)).statut).toBe(200);
    expect((await saisir(o, SIMPLE, "2025-03-10", "OD", rev)).statut).toBe(403);
    expect((await env.api("GET", `/compta/balance?brancheId=${o.entites.GLOMARI}&debut=2025-01-01&fin=2025-12-31`, gta)).statut).toBe(403);
    const e = await env.nouvelleOrganisation();
    expect((await valider(o, [a.corps.id], e.jeton)).statut).toBe(404);
    expect((await env.api("GET", `/compta/export?brancheId=${o.entites.GLOMARI}&debut=2025-01-01&fin=2025-12-31`, e.jeton)).statut).toBe(404);
  });
});

describe("écritures automatiques", () => {
  const generer = (o: Org, fin = "2100-01-01") => env.api("POST", "/compta/generation", o.jeton, { brancheId: o.entites.GLOMARI, fin });
  const toutValider = async (o: Org) => valider(o, (await brouillons(o)).map((x: { id: string }) => x.id));

  it("passe facture, avoir, règlement et annulation, sans doublon", async () => {
    const o = await preparer();
    await env.api("PATCH", `/entites/${o.entites.GLOMARI}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const prod = (await env.api("POST", "/produits", o.jeton, { entiteId: o.entites.GLOMARI, code: "A", nom: "A", prixVente: 1000 })).corps.id;
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "C", entiteId: o.entites.GLOMARI });
    const d = await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: o.entites.GLOMARI, tiersId: t.corps.id, date: "2026-02-01", lignes: [{ produitId: prod, quantite: 2, tauxTaxe: 10 }, { designation: "Pose", quantite: 1, prixUnitaire: 500 }] });
    expect((await env.api("POST", `/documents-vente/${d.corps.id}/emission`, o.jeton)).statut).toBe(200);
    const r = await env.api("POST", `/factures/${d.corps.id}/reglements`, o.jeton, { montant: 1000, moyen: "orange_money", reference: "OM9" });
    expect((await generer(o)).corps.crees).toBe(2);
    expect((await generer(o)).corps.crees).toBe(0);
    await toutValider(o);
    const b = await balance(o);
    expect(b.debit).toBe(b.credit);
    expect(soldeDe(b, "7011")).toBe(-2000);
    expect(soldeDe(b, "7061")).toBe(-500);
    expect(soldeDe(b, "4431")).toBe(-200);
    expect(soldeDe(b, "4111")).toBe(2700 - 1000);
    expect(soldeDe(b, "552")).toBe(1000);
    await env.api("POST", `/reglements/${r.corps.id}/annulation`, o.jeton, { motif: "Erreur de saisie" });
    expect((await generer(o)).corps.crees).toBe(1);
    await toutValider(o);
    expect(soldeDe(await balance(o), "552")).toBe(0);
    const tiers = (await env.api("GET", `/compta/grand-livre?brancheId=${o.entites.GLOMARI}&debut=2000-01-01&fin=2100-01-01&compte=4111`, o.jeton)).corps;
    expect(tiers[0].tiers).toBe("C");
  });

  it("passe une vente mixte avec monnaie rendue et points, puis son annulation", async () => {
    const o = await preparer();
    const m = await env.api("POST", "/magasins", o.jeton, { parentId: o.entites.GLOMARI, nom: "Akwa", type: "point_de_vente" });
    const prod = (await env.api("POST", "/produits", o.jeton, { entiteId: o.entites.GLOMARI, code: "A", nom: "A", prixVente: 1000, tauxTaxe: 10 })).corps.id;
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Awa", telephone: "699000123", entiteId: o.entites.GLOMARI });
    await env.api("PUT", `/entites/${o.entites.GLOMARI}/fidelite`, o.jeton, { actif: true, fcfaParPoint: 100, valeurPoint: 1 });
    await env.api("POST", "/caisse/ouverture", o.jeton, { entiteId: m.corps.id, fondOuverture: 0 });
    const vendre = (paiements: object[]) => env.api("POST", "/caisse/ventes", o.jeton, { entiteId: m.corps.id, tiersId: t.corps.id, lignes: [{ produitId: prod, quantite: 1 }], paiements });
    await vendre([{ moyen: "especes", montant: 2000 }]);
    const v = await vendre([{ moyen: "points", montant: 10 }, { moyen: "mtn_momo", montant: 1090, reference: "M1" }]);
    expect(v.statut).toBe(201);
    await generer(o);
    await toutValider(o);
    const b = await balance(o);
    expect(b.debit).toBe(b.credit);
    expect(soldeDe(b, "5711")).toBe(1100);
    expect(soldeDe(b, "552")).toBe(1090);
    expect(soldeDe(b, "658")).toBe(10);
    expect(soldeDe(b, "7011")).toBe(-2000);
    expect(soldeDe(b, "4431")).toBe(-200);
    await env.api("POST", `/caisse/ventes/${v.corps.id}/annulation`, o.jeton, { motif: "Erreur client" });
    await generer(o);
    await toutValider(o);
    expect(soldeDe(await balance(o), "552")).toBe(0);
  });

  it("passe les transferts par le 585, les frais au 631, et met les dépenses en attente d'imputation", async () => {
    const o = await preparer();
    const nouveau = async (nom: string, type: string, s = 0) => (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: o.entites.GLOMARI, nom, type, soldeInitial: s })).corps.id;
    const [om, bq] = [await nouveau("OM", "orange_money"), await nouveau("BQ", "banque")];
    await env.api("POST", `/portefeuilles/${om}/mouvements`, o.jeton, { sens: "entree", montant: 5000, libelle: "Apport" });
    await env.api("POST", `/portefeuilles/${om}/mouvements`, o.jeton, { sens: "sortie", montant: 200, libelle: "Crédit téléphone" });
    await env.api("POST", "/portefeuilles/transferts", o.jeton, { deId: om, versId: bq, montant: 4000, frais: 50 });
    await generer(o);
    await toutValider(o);
    const b = await balance(o);
    expect(soldeDe(b, "552")).toBe(5000 - 200 - 4000 - 50);
    expect(soldeDe(b, "5211")).toBe(4000);
    expect(soldeDe(b, "585")).toBe(0);
    expect(soldeDe(b, "631")).toBe(50);
    expect(soldeDe(b, "4711")).toBe(-4800);
    const pts = (await env.api("GET", `/compta/controles?brancheId=${o.entites.GLOMARI}`, o.jeton)).corps.points.map((x: { code: string }) => x.code);
    expect(pts).toContain("compte_attente");
  });

  it("le brouillon d'une dépense s'impute, et le contrôle signale la charge en espèces de 100 000 FCFA", async () => {
    const o = await preparer();
    const a = await saisir(o, [{ numero: "622", debit: 100000 }, { numero: "5711", credit: 100000 }], "2026-01-10", "CA");
    await valider(o, [a.corps.id]);
    const p = (await env.api("GET", `/compta/controles?brancheId=${o.entites.GLOMARI}`, o.jeton)).corps.points;
    expect(p.find((x: { code: string }) => x.code === "charges_en_especes").nombre).toBe(1);
    expect(p.map((x: { code: string }) => x.code)).toContain("tresorerie_creditrice");
    const b = await saisir(o, SIMPLE, "2026-01-11");
    expect((await env.api("PUT", `/compta/ecritures/${b.corps.id}`, o.jeton, { date: "2026-01-12", libelle: "Corrigée", lignes: [{ numero: "5711", debit: 7 }, { numero: "706", credit: 7 }] })).statut).toBe(200);
    expect((await brouillons(o))[0].lignes[1].numero).toBe("706");
  });
});

describe("clôtures", () => {
  it("bloque un mois clos, trace la réouverture et interdit de rouvrir le définitif", async () => {
    const o = await preparer();
    const B = o.entites.GLOMARI;
    const clore = (mois: string, definitive = false) => env.api("POST", "/compta/clotures", o.jeton, { brancheId: B, mois, definitive });
    const a = await saisir(o, SIMPLE, "2025-01-10");
    expect((await clore("2025-01")).corps.erreur).toBe("brouillons_restants");
    await valider(o, [a.corps.id]);
    const f = await saisir(o, SIMPLE, "2025-02-10");
    await valider(o, [f.corps.id]);
    expect((await clore("2025-02")).corps).toMatchObject({ erreur: "mois_precedent_ouvert", details: { mois: "2025-01" } });
    expect((await clore("2025-01")).statut).toBe(201);
    expect((await saisir(o, SIMPLE, "2025-01-20")).corps.erreur).toBe("periode_close");
    const r = (m: string) => env.api("POST", "/compta/clotures/reouverture", o.jeton, { brancheId: B, mois: m, motif: "Oubli de pièce" });
    expect((await r("2025-01")).statut).toBe(200);
    expect((await saisir(o, SIMPLE, "2025-01-20")).statut).toBe(201);
    await valider(o, (await brouillons(o)).map((x: { id: string }) => x.id));
    await clore("2025-01", true);
    expect((await r("2025-01")).corps.erreur).toBe("cloture_definitive");
  });

  it("date dans la période en cours une pièce arrivée après la clôture", async () => {
    const o = await preparer();
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "C", entiteId: o.entites.GLOMARI });
    await env.api("PATCH", `/entites/${o.entites.GLOMARI}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const d = await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: o.entites.GLOMARI, tiersId: t.corps.id, date: "2025-01-05", lignes: [{ designation: "X", quantite: 1, prixUnitaire: 100 }] });
    await env.api("POST", `/documents-vente/${d.corps.id}/emission`, o.jeton);
    await env.api("POST", "/compta/clotures", o.jeton, { brancheId: o.entites.GLOMARI, mois: "2025-01" });
    await env.api("POST", "/compta/generation", o.jeton, { brancheId: o.entites.GLOMARI, fin: "2025-01-31" });
    const [e] = await brouillons(o);
    expect(e.date_ecriture).not.toBe("2025-01-05");
    expect(e.libelle).toContain("du 2025-01-05");
  });

  it("clôt l'exercice : à-nouveaux équilibrés, résultat reporté, plus rien dans l'année", async () => {
    const o = await preparer();
    const B = o.entites.GLOMARI;
    const a = await saisir(o, [{ numero: "5711", debit: 1000 }, { numero: "7011", credit: 1000 }], "2025-01-10");
    const b = await saisir(o, [{ numero: "622", debit: 300 }, { numero: "5711", credit: 300 }], "2025-01-11");
    await valider(o, [a.corps.id, b.corps.id]);
    const clore = () => env.api("POST", "/compta/exercices/cloture", o.jeton, { brancheId: B, annee: 2025 });
    expect((await clore()).corps.erreur).toBe("mois_non_definitifs");
    await env.api("POST", "/compta/clotures", o.jeton, { brancheId: B, mois: "2025-01", definitive: true });
    const r = await clore();
    expect(r.corps.resultat).toBe(700);
    expect((await clore()).corps.erreur).toBe("exercice_clos");
    expect((await saisir(o, SIMPLE, "2025-06-01")).corps.erreur).toBe("periode_close");
    const [an] = await brouillons(o);
    expect(an.date_ecriture).toBe("2026-01-01");
    await valider(o, [an.id]);
    const n = await balance(o, "2026-01-01", "2026-12-31");
    expect(soldeDe(n, "5711")).toBe(700);
    expect(soldeDe(n, "131")).toBe(-700);
    const etats = (await env.api("GET", `/compta/etats?brancheId=${B}&debut=2026-01-01&fin=2026-12-31`, o.jeton)).corps;
    expect(etats).toMatchObject({ equilibre: true, resultat: 0 });
  });

  it("exporte le journal validé pour l'expert", async () => {
    const o = await preparer();
    const a = await saisir(o, SIMPLE);
    await valider(o, [a.corps.id]);
    const r = await env.api("GET", `/compta/export?brancheId=${o.entites.GLOMARI}&debut=2025-01-01&fin=2025-12-31`, o.jeton);
    expect(r.statut).toBe(200);
    expect(r.corps).toContain("GLOMARI-OD-2025-000001");
  });
});
