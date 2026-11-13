import { afterAll, describe, expect, it } from "vitest";
import { classerAbc, conditionVraie } from "../src/automatisation.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";
const env = await environnement();
afterAll(() => env.fermer());
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
const G = (o: Org) => o.entites.GLOMARI!;
const j = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
async function compte(o: Org, code: string, entiteId: string) {
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
  await env.api("POST", "/utilisateurs", o.jeton, { email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((x: { code: string }) => x.code === code).id });
  return env.connecter(o.slug, email);
}
describe("règles", () => {
  it("conditions et classement", () => {
    expect([conditionVraie({ a: 1 }, "a", "1"), conditionVraie({ a: 1 }, "a", "2"), conditionVraie({}, null, null)]).toEqual([true, false, true]);
    expect(classerAbc([{ ca: 10 }, { ca: 80 }, { ca: 10 }]).map((x) => x.classe)).toEqual(["A", "B", "B"]);
    expect(classerAbc([{ ca: 96 }, { ca: 3 }, { ca: 1 }]).map((x) => x.classe)).toEqual(["A", "C", "C"]);
  });
  it("crée une seule tâche par événement, arrêtée sur demande, simulation sans effet", async () => {
    const o = await env.nouvelleOrganisation();
    const moi = (await env.api("GET", "/moi", o.jeton)).corps.id;
    const r = await env.api("POST", "/regles-auto", o.jeton, { entiteId: G(o), nom: "Prospect", evenement: "prospect.capte", titre: "Rappeler", assigneA: moi, delaiJours: 1 });
    const f = (await env.api("POST", "/formulaires-capture", o.jeton, { entiteId: G(o), titre: "Offre", source: "Site" })).corps;
    const code = encodeURIComponent(f.lien.split("c=")[1]);
    await env.app.inject({ method: "POST", url: `/capture/${code}`, payload: { nom: "A", consentement: true, telephone: "699000123" }, remoteAddress: "10.9.1.1" });
    expect((await env.api("GET", `/regles-auto/${r.corps.id}/simulation`, o.jeton)).corps).toEqual({ evenements: 1, declenchements: 1 });
    const n = async () => (await env.api("GET", "/taches", o.jeton)).corps.filter((t: { titre: string }) => t.titre === "Rappeler").length;
    expect(await n()).toBe(0);
    await env.app.executerTaches(o.organisationId);
    await env.app.executerTaches(o.organisationId);
    expect(await n()).toBe(1);
    await env.api("POST", `/regles-auto/${r.corps.id}/etat`, o.jeton, { actif: false });
    await env.app.inject({ method: "POST", url: `/capture/${code}`, payload: { nom: "B", consentement: true, telephone: "699000124" }, remoteAddress: "10.9.1.2" });
    await env.app.executerTaches(o.organisationId);
    expect(await n()).toBe(1);
    expect((await env.api("POST", "/regles-auto", o.jeton, { entiteId: G(o), nom: "X", evenement: "drop table;", titre: "T", assigneA: moi })).statut).toBe(400);
  });
});
describe("analyses et assistant", () => {
  it("répond selon les droits, signale les doublons", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("POST", "/compta/initialisation", o.jeton, { brancheId: G(o) });
    await env.api("PATCH", `/entites/${G(o)}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const t = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Client", entiteId: G(o) })).corps.id;
    const p = (await env.api("POST", "/produits", o.jeton, { entiteId: G(o), code: "A", nom: "Savon", prixVente: 1000 })).corps.id;
    await env.api("POST", "/produits", o.jeton, { entiteId: G(o), code: "B", nom: "Dormant", prixVente: 5 });
    const d = (await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: G(o), tiersId: t, date: j(0), echeance: j(0), lignes: [{ produitId: p, quantite: 2 }] })).corps.id;
    await env.api("POST", `/documents-vente/${d}/emission`, o.jeton);
    const a = (await env.api("GET", `/analyses/produits?debut=${j(-1)}&fin=${j(1)}`, o.jeton)).corps;
    expect(a.lignes[0]).toMatchObject({ nom: "Savon", classe: "A", ca: 2000 });
    expect(a.dormants.map((x: { nom: string }) => x.nom)).toEqual(["Dormant"]);
    const Q = (q: string, jeton = o.jeton) => env.api("POST", "/assistant", jeton, { question: q });
    expect((await Q("Quelles sont les factures impayées ?")).corps.lignes[0]).toEqual({ libelle: "Client", valeur: 2000 });
    expect((await Q("impayés de plus de 30 jours")).corps.lignes).toEqual([]);
    expect((await Q("meilleur produit du mois")).corps.lignes[0].libelle).toBe("Savon");
    expect((await Q("quelle météo ?")).corps.inconnu).toBe(true);
    const sec = await compte(o, "secretariat", G(o));
    expect((await Q("factures impayées", sec)).corps.reponse).toContain("pas accès");
    const f = (await env.api("POST", "/tiers", o.jeton, { type: "entreprise", nom: "F", entiteId: G(o) })).corps.id;
    for (const n of ["A1", "A2"]) { const x = (await env.api("POST", "/fournisseurs/factures", o.jeton, { entiteId: G(o), fournisseurId: f, numeroFournisseur: n, date: j(-1), niu: "M", lignes: [{ designation: "x", compte: "622", montantHt: 500 }] })).corps; expect(x.id).toBeTruthy(); }
    expect((await env.api("GET", "/anomalies", o.jeton)).corps[0].genre).toBe("facture_double");
    expect((await env.api("GET", "/tour-de-controle", o.jeton)).corps).toHaveProperty("colis_en_cours", 0);
  });
});
describe("gestion courante", () => {
  it("contrats, maintenance, audits", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("POST", "/contrats", o.jeton, { entiteId: G(o), objet: "Assurance Mall", type: "assurance", fin: j(10), rappelJours: 30 });
    expect((await env.api("GET", "/contrats", o.jeton)).corps[0].a_renouveler).toBe(true);
    const q = (await env.api("POST", "/equipements", o.jeton, { entiteId: G(o), nom: "Groupe", periodiciteJours: 30, prochaine: j(0) })).corps.id;
    const notif = async () => (await env.api("GET", "/notifications", o.jeton)).corps.map((n: { genre: string }) => n.genre);
    expect(await notif()).toEqual(expect.arrayContaining(["contrats", "maintenance"]));
    await env.api("POST", `/equipements/${q}/interventions`, o.jeton, { jour: j(0), nature: "preventive", description: "Vidange", cout: 5000 });
    expect((await env.api("GET", "/equipements", o.jeton)).corps[0]).toMatchObject({ prochaine: j(30), due: false, cout_total: 5000 });
    const m = (await env.api("POST", "/modeles-audit", o.jeton, { entiteId: G(o), nom: "Boutique", points: ["Propre", "Prix", "Accueil", "Caisse"] })).corps.id;
    expect((await env.api("POST", `/modeles-audit/${m}/audits`, o.jeton, { lieu: "Akwa", jour: j(0), reponses: [true] })).corps.erreur).toBe("reponses_incompletes");
    expect((await env.api("POST", `/modeles-audit/${m}/audits`, o.jeton, { lieu: "Akwa", jour: j(0), reponses: [true, true, true, false] })).corps.score).toBe(75);
  });
  it("exporte et anonymise sans changer la facture", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("PATCH", `/entites/${G(o)}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const t = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Awa", entiteId: G(o), email: "awa@test.cm" })).corps.id;
    const d = (await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: G(o), tiersId: t, date: j(0), lignes: [{ designation: "X", quantite: 1, prixUnitaire: 5 }] })).corps.id;
    await env.api("POST", `/documents-vente/${d}/emission`, o.jeton);
    expect((await env.api("GET", `/tiers/${t}/donnees-personnelles`, o.jeton)).corps).toMatchObject({ fiche: { nom: "Awa" }, donnees: { factures: 1 } });
    expect((await env.api("POST", `/tiers/${t}/anonymisation`, o.jeton, { motif: "Demande de la personne" })).corps.anonymise).toBe(true);
    expect((await env.api("POST", `/tiers/${t}/anonymisation`, o.jeton, { motif: "Demande de la personne" })).corps.erreur).toBe("deja_anonymise");
    expect((await env.api("GET", `/documents-vente/${d}`, o.jeton)).corps.client_nom).toBe("Awa");
    const c = await compte(o, "caissier", G(o));
    expect((await env.api("GET", `/tiers/${t}/donnees-personnelles`, c)).statut).toBe(403);
  });
});
