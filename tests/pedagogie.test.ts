import { afterAll, describe, expect, it } from "vitest";
import { appliquerRemise } from "../src/pedagogie.js";
import { environnement } from "./outils.js";
const env = await environnement();
afterAll(() => env.fermer());
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
const T = (o: Org) => o.entites.GTA!;
const j = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const fiche = async (o: Org, nom: string) => (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom, entiteId: T(o) })).corps.id as string;
async function sessionFormation(o: Org) {
  const p = (await env.api("POST", "/programmes", o.jeton, { entiteId: T(o), nom: "Prog", code: `P${Math.floor(Math.random() * 1e6)}`, planPaiement: [{ libelle: "T1", montant: 100000, jours_apres_debut: 0 }, { libelle: "T2", montant: 50000, jours_apres_debut: 30 }] }));
  expect(p.statut).toBe(201);
  const s = await env.api("POST", "/sessions", o.jeton, { programmeId: p.corps.id, code: `S${Math.floor(Math.random() * 1e6)}`, ville: "Douala", debut: j(5), fin: j(6) });
  expect(s.statut).toBe(201);
  return s.corps.id as string;
}
describe("formations", () => {
  it("remise depuis la dernière tranche", () => {
    expect(appliquerRemise([{ id: "a", montant: 100 }, { id: "b", montant: 50 }], 70)).toEqual([{ id: "a", montant: 80 }, { id: "b", montant: 0 }]);
  });
  it("applique un code une fois, gère l'attente, les coûts et la marge", async () => {
    const o = await env.nouvelleOrganisation();
    const s = await sessionFormation(o);
    const t = await fiche(o, "Awa");
    const i = (await env.api("POST", `/sessions/${s}/inscriptions`, o.jeton, { tiersId: t })).corps.id;
    await env.api("POST", "/codes-promo", o.jeton, { entiteId: T(o), code: "RENTREE", type: "pourcentage", valeur: 10, debut: j(-1), fin: j(1), maxUsages: 5 });
    const C = () => env.api("POST", `/inscriptions/${i}/code-promo`, o.jeton, { code: "rentree" });
    expect((await C()).corps.remise).toBe(15000);
    expect((await C()).corps.erreur).toBe("code_deja_utilise");
    expect((await env.api("POST", `/inscriptions/${i}/code-promo`, o.jeton, { code: "FAUX" })).corps.erreur).toBe("code_promo_invalide");
    await env.api("POST", `/sessions/${s}/couts`, o.jeton, { nature: "salle", libelle: "Salle", montant: 30000 });
    const a = await fiche(o, "Bella");
    expect((await env.api("POST", `/sessions/${s}/attente`, o.jeton, { tiersId: a })).statut).toBe(201);
    expect((await env.api("POST", `/sessions/${s}/attente`, o.jeton, { tiersId: a })).corps.erreur).toBe("deja_en_attente");
    const g = (await env.api("GET", `/sessions/${s}/gestion`, o.jeton)).corps;
    expect(g.rentabilite).toMatchObject({ attendu: 135000, cout: 30000, marge_attendue: 105000 });
    expect(g.attente).toHaveLength(1);
    expect((await env.api("GET", "/programmes/rentabilite", o.jeton)).corps[0]).toMatchObject({ cout: 30000, inscrits: 1 });
    expect((await env.api("POST", `/inscriptions/${i}/evaluations`, o.jeton, { type: "test_fin", note: 14 })).statut).toBe(201);
    const d = await env.api("POST", "/demandes-b2b", o.jeton, { entiteId: T(o), tiersId: t, besoin: "Former 20 vendeurs", effectif: 20 });
    expect((await env.api("PATCH", `/demandes-b2b/${d.corps.id}`, o.jeton, { statut: "realisee", rapport: "Bilan" })).corps.enregistre).toBe(true);
  });
});
describe("apprentissage", () => {
  const prep = async () => {
    const o = await env.nouvelleOrganisation();
    const C = async (titre: string) => { const c = (await env.api("POST", "/cours", o.jeton, { entiteId: T(o), titre })).corps; await env.api("POST", `/cours/${c.id}/lecons`, o.jeton, { titre: "L1", contenu: "Texte" }); await env.api("PATCH", `/cours/${c.id}`, o.jeton, { publie: true }); return c.id as string; };
    return { o, C };
  };
  it("tire des questions, reçoit devoir et question, corrige", async () => {
    const { o, C } = await prep();
    const c = await C("Vente");
    const lecon = (await env.api("GET", `/cours/${c}`, o.jeton)).corps.lecons[0].id;
    await env.api("POST", "/banque-questions", o.jeton, { entiteId: T(o), theme: "Vente", enonce: "Q1", choix: ["A", "B"], bonne: 1 });
    expect((await env.api("POST", "/banque-questions", o.jeton, { entiteId: T(o), theme: "Vente", enonce: "Q2", choix: ["A", "B"], bonne: 5 })).corps.erreur).toBe("bonne_reponse_invalide");
    expect((await env.api("POST", `/lecons/${lecon}/tirage`, o.jeton, { theme: "Vente", nombre: 3 })).corps.ajoutees).toBe(1);
    const t = await fiche(o, "Apprenant");
    const l = (await env.api("POST", `/cours/${c}/acces`, o.jeton, { tiersId: t })).corps.lien;
    const code = encodeURIComponent(new URL(l).searchParams.get("c") as string);
    const d = (await env.api("POST", `/cours/${c}/devoirs`, o.jeton, { titre: "D", consigne: "Faire" })).corps.id;
    const P = (u: string, x: object) => env.app.inject({ method: "POST", url: `/apprendre/${code}/${u}`, payload: x });
    expect((await P(`devoirs/${d}`, { contenu: "Rendu" })).statusCode).toBe(201);
    expect((await P("questions", { question: "Pourquoi ?" })).statusCode).toBe(201);
    const an = (await env.api("GET", `/cours/${c}/animation`, o.jeton)).corps;
    expect(an.devoirs[0].rendus[0].contenu).toBe("Rendu");
    await env.api("POST", `/rendus/${an.devoirs[0].rendus[0].id}/correction`, o.jeton, { note: 15 });
    expect((await P(`devoirs/${d}`, { contenu: "Autre" })).json().erreur).toBe("devoir_deja_corrige");
    await env.api("POST", `/questions-cours/${an.questions[0].id}/reponse`, o.jeton, { reponse: "Parce que" });
    const e = (await env.app.inject({ method: "GET", url: `/apprendre/${code}/echanges` })).json();
    expect(e.questions[0].reponse).toBe("Parce que");
    expect(Number(e.devoirs[0].note)).toBe(15);
    await env.api("POST", "/recouvrement/blocages", o.jeton, { tiersId: t, portee: "cours", motif: "Impayé ancien" });
    expect((await env.app.inject({ method: "GET", url: `/apprendre/${code}/echanges` })).statusCode).toBe(409);
  });
  it("ouvre le cours suivant du parcours une fois le précédent terminé", async () => {
    const { o, C } = await prep();
    const a = await C("A"), b = await C("B");
    const t = await fiche(o, "Membre");
    const p = (await env.api("POST", "/parcours-cours", o.jeton, { entiteId: T(o), nom: "Vente", cours: [a, b] })).corps.id;
    expect((await env.api("POST", `/parcours-cours/${p}/membres`, o.jeton, { tiersId: t })).corps.ouvert).toBe(true);
    await env.app.executerTaches(o.organisationId);
    const acces = async (c: string) => (await env.api("GET", `/cours/${c}/suivi`, o.jeton)).corps;
    expect(JSON.stringify(await acces(b))).not.toContain("Membre");
    const lien = (await env.api("POST", `/cours/${a}/acces`, o.jeton, { tiersId: t })).corps.lien;
    const code = encodeURIComponent(new URL(lien).searchParams.get("c") as string);
    const l = (await env.app.inject({ method: "GET", url: `/apprendre/${code}` })).json().lecons[0];
    await env.app.inject({ method: "POST", url: `/apprendre/${code}/lecons/${l.id}`, payload: { reponses: [] } });
    await env.app.executerTaches(o.organisationId);
    expect(JSON.stringify(await acces(b))).toContain("Membre");
  });
  it("affiche la boutique et transforme une demande en opportunité", async () => {
    const { o, C } = await prep();
    const c = await C("Vente");
    expect((await env.app.inject({ method: "GET", url: `/boutique/${o.organisationId}` })).json()).toEqual([]);
    await env.api("PUT", `/cours/${c}/boutique`, o.jeton, { enBoutique: true, prix: 20000 });
    expect((await env.app.inject({ method: "GET", url: `/boutique/${o.organisationId}` })).json()[0]).toMatchObject({ titre: "Vente", prix: 20000 });
    const D = (x: object) => env.app.inject({ method: "POST", url: `/boutique/${o.organisationId}/cours/${c}/demande`, payload: x });
    expect((await D({ nom: "A", consentement: false, telephone: "699" })).statusCode).toBe(400);
    expect((await D({ nom: "Acheteur", consentement: true, telephone: "699123456" })).statusCode).toBe(201);
    expect((await env.api("GET", "/prospects/classement", o.jeton)).corps[0]).toMatchObject({ nom: "Acheteur", source: "Boutique de cours" });
  });
});
