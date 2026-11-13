import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { LIENS_TIERS } from "../src/relation.js";
import { codeSite } from "../src/portail_rh.js";
import { creerServeur } from "../src/serveur.js";
import { environnement, MOT_DE_PASSE, OPTIONS } from "./outils.js";

const env = await environnement();
const dossier = await mkdtemp(join(tmpdir(), "aj-"));
const app = await creerServeur(env.poolApp, { ...OPTIONS, dossierMedias: dossier });
afterAll(async () => { await app.close(); await env.fermer(); await rm(dossier, { recursive: true, force: true }); });
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
const G = (o: Org) => o.entites.GLOMARI!;
const j = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const tel = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
async function compte(o: Org, code: string, entiteId: string) {
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
  const u = await env.api("POST", "/utilisateurs", o.jeton, { email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((x: { code: string }) => x.code === code).id });
  return { jeton: await env.connecter(o.slug, email), id: u.corps.id as string, email };
}
const A = (m: string, url: string, jeton: string, corps?: object) => app.inject({ method: m as "GET", url, headers: { authorization: `Bearer ${jeton}` }, ...(corps ? { payload: corps } : {}) });

describe("tâches planifiées", () => {
  it("connaît chaque organisation, prépare les récurrentes une fois et lève les alertes", async () => {
    const o = await env.nouvelleOrganisation();
    expect((await env.poolApp.query("select 1 from registre_organisations where id = $1", [o.organisationId])).rows).toHaveLength(1);
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "R", entiteId: G(o) });
    await env.api("POST", "/factures-recurrentes", o.jeton, { entiteId: G(o), tiersId: t.corps.id, libelle: "Abo", jour: 1, debut: j(-40), lignes: [{ designation: "A", quantite: 1, prixUnitaire: 100 }] });
    await env.api("POST", "/kpi", o.jeton, { entiteId: G(o), source: "tresorerie", cible: 1000, seuilAlerte: 500, seuilCritique: 100 });
    await app.executerTaches(o.organisationId);
    await app.executerTaches(o.organisationId);
    const d = (await env.api("GET", "/documents-vente?type=facture", o.jeton)).corps;
    expect(d.length).toBeGreaterThanOrEqual(1);
    expect(d.length).toBeLessThanOrEqual(2);
    const n = (await env.api("GET", "/notifications", o.jeton)).corps;
    expect(n.find((x: { genre: string }) => x.genre === "alertes").nombre).toBe(1);
  });
});

describe("fusion de fiches", () => {
  it("couvre tous les liens vers une fiche", async () => {
    const { rows } = await env.poolAdmin.query(`select conrelid::regclass::text as t, a.attname as c from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[2] where k.contype = 'f' and k.confrelid = 'tiers'::regclass`);
    const attendus = rows.map((r) => `${r.t}.${r.c}`).filter((x) => x !== "lignes_ecriture.tiers_id" && x !== "tiers.fusionne_vers").sort();
    expect(LIENS_TIERS.map(([t, c]) => `${t}.${c}`).sort()).toEqual(attendus);
  });
  it("déplace les factures émises sans changer leur nom imprimé", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("PATCH", `/entites/${G(o)}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const a = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Awa", entiteId: G(o), telephone: tel() });
    const b = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Awa M", entiteId: G(o), email: "awa@test.cm" });
    const d = await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: G(o), tiersId: b.corps.id, date: j(0), lignes: [{ designation: "X", quantite: 1, prixUnitaire: 500 }] });
    await env.api("POST", `/documents-vente/${d.corps.id}/emission`, o.jeton);
    const fu = await env.api("POST", `/tiers/${a.corps.id}/fusion`, o.jeton, { doublonId: b.corps.id });
    expect(fu.corps.fusion).toBe(true);
    const c = (await env.api("GET", "/creances", o.jeton)).corps;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ client: "Awa", total: 500 });
    expect((await env.api("GET", `/documents-vente/${d.corps.id}`, o.jeton)).corps.client_nom).toBe("Awa M");
    expect((await env.api("GET", "/tiers", o.jeton)).corps.map((t: { nom: string }) => t.nom)).not.toContain("Awa M");
    expect((await env.api("POST", `/tiers/${a.corps.id}/fusion`, o.jeton, { doublonId: b.corps.id })).corps.erreur).toBe("deja_fusionne");
    const roleAcces = await env.poolApp.query("select has_column_privilege('erp_app', 'dons', 'donateur_id', 'UPDATE') as a, has_column_privilege('erp_app', 'points_fidelite', 'tiers_id', 'UPDATE') as b");
    expect(roleAcces.rows[0]).toEqual({ a: true, b: true });
    await expect(env.poolApp.query("select 1")).resolves.toBeTruthy();
    const e = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "GTA", entiteId: o.entites.GTA! });
    expect((await env.api("POST", `/tiers/${a.corps.id}/fusion`, o.jeton, { doublonId: e.corps.id })).corps.erreur).toBe("tiers_autre_branche");
  });
  it("refuse la modification d'une facture hors fusion", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("PATCH", `/entites/${G(o)}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const a = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "A", entiteId: G(o) });
    const b = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "B", entiteId: G(o) });
    const d = await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: G(o), tiersId: a.corps.id, date: j(0), lignes: [{ designation: "X", quantite: 1, prixUnitaire: 500 }] });
    await env.api("POST", `/documents-vente/${d.corps.id}/emission`, o.jeton);
    await expect(dansOrganisation(env.poolApp, o.organisationId, (c) => c.query("update documents_vente set tiers_id = $2 where id = $1", [d.corps.id, b.corps.id]))).rejects.toThrow(/ne peut pas être modifié/);
  });
});

describe("borne de pointage", () => {
  it("exige le code du moment dès qu'une borne existe", async () => {
    const o = await env.nouvelleOrganisation();
    expect(codeSite("s", 1)).toMatch(/^[0-9]{6}$/);
    const c = await compte(o, "secretariat", G(o));
    const e = await env.api("POST", "/employes", o.jeton, { entiteId: G(o), nom: "Awa", poste: "V", typeContrat: "cdi", dateEmbauche: "2025-01-01" });
    await env.api("PUT", `/employes/${e.corps.id}/compte`, o.jeton, { email: c.email });
    const s = await env.api("POST", "/sites-pointage", o.jeton, { entiteId: G(o), nom: "Makepe" });
    expect((await env.api("POST", "/moi/pointage", c.jeton, {})).corps.erreur).toBe("code_pointage_requis");
    expect((await env.api("POST", "/moi/pointage", c.jeton, { code: "000000" })).corps.erreur).toBe("code_pointage_invalide");
    const b = (await env.api("GET", `/sites-pointage/${s.corps.id}/code`, o.jeton)).corps;
    expect(b.qr_svg).toContain("<svg");
    expect((await env.api("GET", `/sites-pointage/${s.corps.id}/code`, c.jeton)).statut).toBe(403);
    expect((await env.api("POST", "/moi/pointage", c.jeton, { code: b.code })).corps.sens).toBe("arrivee");
  });
});

describe("candidature avec CV", () => {
  it("garde un PDF, refuse le reste, et ne dépose qu'une fois", async () => {
    const o = await env.nouvelleOrganisation();
    const f = (await A("POST", "/offres-emploi", o.jeton, { entiteId: G(o), titre: "Poste", description: "Texte", typeContrat: "cdd" })).json();
    const code = encodeURIComponent(f.lien.split("c=")[1]);
    const r = (await app.inject({ method: "POST", url: `/offre-public/${code}`, payload: { nom: "Bella", consentement: true, telephone: tel() } })).json();
    const P = (d: string, corps: Buffer, t = "application/pdf") => app.inject({ method: "PUT", url: `/offre-public/${code}/cv?depot=${d}`, headers: { "content-type": t }, payload: corps });
    expect((await P(r.depot, Buffer.from("<html>"))).statusCode).toBe(415);
    expect((await P("x".repeat(30), Buffer.from("%PDF-1.7 a"))).statusCode).toBe(201);
    expect((await P(r.depot, Buffer.from("%PDF-1.7 cv"))).statusCode).toBe(201);
    const c = (await A("GET", `/offres-emploi/${f.id}/candidatures`, o.jeton)).json()[0];
    const t = await A("GET", `/candidatures/${c.id}/cv`, o.jeton);
    expect(t.body).toContain("cv");
    await P(r.depot, Buffer.from("%PDF-1.7 autre"));
    expect((await A("GET", `/candidatures/${c.id}/cv`, o.jeton)).body).toContain("%PDF-1.7 cv");
    const s = await compte(o, "secretariat", G(o));
    expect((await A("GET", `/candidatures/${c.id}/cv`, s.jeton)).statusCode).toBe(403);
  });
});

describe("autres ajustements", () => {
  it("la prévision compte la paie estimée", async () => {
    const o = await env.nouvelleOrganisation();
    expect((await env.api("GET", `/tresorerie/prevision?brancheId=${G(o)}`, o.jeton)).corps.paie_mensuelle).toBe(0);
    const e = await env.api("POST", "/employes", o.jeton, { entiteId: G(o), nom: "S", poste: "V", typeContrat: "cdi", dateEmbauche: "2025-01-01" });
    await env.api("PUT", `/employes/${e.corps.id}/salaire`, o.jeton, { salaireBase: 100000 });
    await env.api("PUT", "/paie/validation", o.jeton, { entiteId: G(o), expert: "Cabinet X", valideLe: j(0) });
    const b = await env.api("POST", "/bulletins", o.jeton, { employeId: e.corps.id, periode: j(0).slice(0, 7) });
    await env.api("POST", `/bulletins/${b.corps.id}/validation`, o.jeton);
    const p = (await env.api("GET", `/tresorerie/prevision?brancheId=${G(o)}`, o.jeton)).corps;
    expect(p.paie_mensuelle).toBe(100000);
    expect(p.horizons[2].paie).toBeGreaterThanOrEqual(200000);
    expect(p.horizons[2].solde).toBe(-p.horizons[2].paie);
  });
  it("les éliminations s'ajoutent au cumul, et une approbation garde l'empreinte", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("POST", "/compta/eliminations", o.jeton, { annee: 2026, libelle: "Vente interne", chiffre: 1000, resultat: 100 });
    expect((await env.api("GET", "/compta/cumul-groupe?annee=2026", o.jeton)).corps.apres_eliminations).toEqual({ chiffre: -1000, resultat: -100 });
    const d = (await app.inject({ method: "PUT", url: `/documents?entiteId=${G(o)}&titre=Bail&categorie=contrat`, headers: { authorization: `Bearer ${o.jeton}`, "content-type": "application/pdf" }, payload: Buffer.from("%PDF-1.7") })).json();
    expect((await A("POST", `/documents/${d.id}/signature`, o.jeton, { mention: "Lu" })).json().empreinte).toBe(d.empreinte);
    expect((await A("POST", `/documents/${d.id}/signature`, o.jeton, { mention: "Lu" })).json().erreur).toBe("deja_signe");
  });
  it("une promotion vaut aussi sur le portail grossiste", async () => {
    const o = await env.nouvelleOrganisation();
    const t = await env.api("POST", "/tiers", o.jeton, { type: "entreprise", nom: "Gros", entiteId: G(o) });
    const p = (await env.api("POST", "/produits", o.jeton, { entiteId: G(o), code: "A", nom: "A", prixVente: 1000 })).corps.id;
    await env.api("POST", "/promotions", o.jeton, { produitId: p, nom: "P", type: "montant", valeur: 100, debut: j(-1), fin: j(1) });
    await env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: G(o), produitId: p, type: "entree", quantite: 10, coutUnitaire: 500 });
    await env.api("PATCH", `/entites/${G(o)}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    await env.api("PUT", `/tiers/${t.corps.id}/compte-pro`, o.jeton, { entiteId: G(o), categorie: "grossiste", plafondCredit: 1000000, delaiJours: 30 });
    const l = await env.api("POST", `/tiers/${t.corps.id}/portail`, o.jeton, { entiteId: G(o), actif: true });
    const code = new URL(l.corps.lien).searchParams.get("c") as string;
    expect((await env.api("GET", `/portail/${code}`)).corps.catalogue[0].promo).toMatchObject({ valeur: 100 });
    expect((await env.api("POST", `/portail/${code}/commandes`, undefined, { lignes: [{ produitId: p, quantite: 2 }] })).corps.total_ht).toBe(1800);
  });
  it("filtre la facturation par branche", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("PATCH", `/entites/${G(o)}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "A", entiteId: G(o) });
    await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: G(o), tiersId: t.corps.id, date: j(0), lignes: [{ designation: "X", quantite: 1, prixUnitaire: 5 }] });
    expect((await env.api("GET", `/documents-vente?brancheId=${G(o)}`, o.jeton)).corps).toHaveLength(1);
    expect((await env.api("GET", `/documents-vente?brancheId=${o.entites.GTA}`, o.jeton)).corps).toEqual([]);
  });
});
