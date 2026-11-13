import { afterAll, describe, expect, it } from "vitest";
import { environnement } from "./outils.js";

const env = await environnement();
afterAll(() => env.fermer());
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
const G = (o: Org) => o.entites.GLOMARI!;
const j = (n: number) => new Date(Date.now() + n * 86400000).toISOString();
const tel = () => `6${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
async function evenement(o: Org, c: object = {}) {
  const m = (await env.api("POST", "/manifestations", o.jeton, { entiteId: G(o), titre: "Salon", debut: j(3), fin: j(4), capacite: 2, prix: 5000, ...c })).corps;
  const code = encodeURIComponent(m.lien.split("c=")[1]);
  const P = (x: object) => env.app.inject({ method: "POST", url: `/evenement-public/${code}`, payload: x, remoteAddress: `10.2.${Math.floor(Math.random() * 200)}.1` });
  return { m, code, P };
}

describe("événements", () => {
  it("respecte la capacité, évite le doublon et ne donne pas le billet d'un autre", async () => {
    const o = await env.nouvelleOrganisation();
    const { m, code, P } = await evenement(o);
    const t = tel();
    const a = (await P({ nom: "A", consentement: true, telephone: t })).json();
    expect(a.code).toBeTruthy();
    expect(a.prix).toBe(5000);
    const d = (await P({ nom: "Autre", consentement: true, telephone: t })).json();
    expect(d).toEqual({ recu: true });
    expect((await P({ nom: "B", consentement: true, telephone: tel() })).statusCode).toBe(201);
    expect((await P({ nom: "C", consentement: true, telephone: tel() })).json().erreur).toBe("evenement_complet");
    expect((await env.app.inject({ method: "GET", url: `/evenement-public/${code}` })).json().places).toBe(0);
    expect((await env.api("GET", "/manifestations", o.jeton)).corps[0]).toMatchObject({ inscrits: 2 });
    expect(m.id).toBeTruthy();
  });
  it("encaisse, contrôle l'entrée une fois et garde la bonne branche", async () => {
    const o = await env.nouvelleOrganisation();
    const { m, P } = await evenement(o);
    const a = (await P({ nom: "A", consentement: true, telephone: tel() })).json();
    const E = () => env.api("POST", `/manifestations/${m.id}/entree`, o.jeton, { code: a.code });
    expect((await E()).corps.erreur).toBe("billet_non_paye");
    const b = (await env.api("GET", `/manifestations/${m.id}/billets`, o.jeton)).corps[0];
    const gta = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: o.entites.GTA!, nom: "G", type: "especes" })).corps;
    expect((await env.api("POST", `/billets/${b.id}/paiement`, o.jeton, { portefeuilleId: gta.id })).corps.erreur).toBe("transfert_autre_branche");
    const w = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: G(o), nom: "C", type: "especes" })).corps;
    expect((await env.api("POST", `/billets/${b.id}/paiement`, o.jeton, { portefeuilleId: w.id })).corps.statut).toBe("paye");
    expect((await env.api("GET", "/portefeuilles", o.jeton)).corps.find((x: { id: string }) => x.id === w.id).solde).toBe(5000);
    expect((await E()).corps.nom).toBe("A");
    expect((await E()).corps.erreur).toBe("billet_deja_utilise");
    expect((await env.api("POST", `/billets/${b.id}/annulation`, o.jeton)).corps.erreur).toBe("billet_paye");
    const x = await env.nouvelleOrganisation();
    expect((await env.api("GET", `/manifestations/${m.id}/billets`, x.jeton)).statut).toBe(404);
  });
});

describe("variantes et bibliothèque", () => {
  it("crée une variante vendable avec son prix", async () => {
    const o = await env.nouvelleOrganisation();
    const p = (await env.api("POST", "/produits", o.jeton, { entiteId: G(o), code: "T", nom: "Chemise", prixVente: 1000 })).corps;
    const v = await env.api("POST", `/produits/${p.id}/variantes`, o.jeton, { code: "T-M-B", attributs: { Taille: "M", Couleur: "Bleu" }, prixVente: 1200 });
    expect(v.corps).toMatchObject({ nom: "Chemise M Bleu", prix_vente: 1200 });
    expect((await env.api("POST", `/produits/${v.corps.id}/variantes`, o.jeton, { code: "X", attributs: { A: "B" } })).corps.erreur).toBe("variante_de_variante");
    expect((await env.api("GET", "/produits", o.jeton)).corps.find((x: { id: string }) => x.id === v.corps.id).parent_id).toBe(p.id);
  });
  it("montre au client les seules ressources de son niveau", async () => {
    const o = await env.nouvelleOrganisation();
    const S = o.entites.SMARTE!;
    const tc = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Coach", entiteId: S })).corps;
    const coach = (await env.api("POST", "/coachs", o.jeton, { entiteId: S, tiersId: tc.id })).corps;
    const cl = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Client", entiteId: S })).corps;
    const a = (await env.api("POST", "/accompagnements", o.jeton, { entiteId: S, coachId: coach.id, tiersId: cl.id, titre: "C", consentementLe: j(0).slice(0, 10) })).corps;
    const lien = (await env.api("POST", `/accompagnements/${a.id}/lien-client`, o.jeton)).corps.lien;
    await env.api("POST", "/ressources-coaching", o.jeton, { entiteId: S, titre: "Ouverte", categorie: "ressource", url: "https://a.cm/1" });
    await env.api("POST", "/ressources-coaching", o.jeton, { entiteId: S, titre: "Niveau 2", categorie: "test", url: "https://a.cm/2", niveauMin: 2 });
    const d = (await env.app.inject({ method: "GET", url: `/reservation-coaching/${encodeURIComponent(lien.split("c=")[1])}` })).json();
    expect(d.ressources.map((r: { titre: string }) => r.titre)).toEqual(["Ouverte"]);
  });
});

describe("université dans le recouvrement et les statistiques", () => {
  it("compte la scolarité une fois, permet la relance et produit les statistiques", async () => {
    const o = await env.nouvelleOrganisation();
    const U = o.entites.IP2EL!;
    const f = (await env.api("POST", "/filieres", o.jeton, { entiteId: U, code: "INF", nom: "Info", diplome: "L", creditsRequis: 6, noteValidation: 10 })).corps;
    const ue = (await env.api("POST", `/filieres/${f.id}/ues`, o.jeton, { code: "U", nom: "A", credits: 6, semestre: 1 })).corps;
    const t = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Etu", entiteId: U, telephone: tel() })).corps;
    const c = (await env.api("POST", `/filieres/${f.id}/candidatures`, o.jeton, { tiersId: t.id, annee: "2026-2027" })).corps;
    await env.api("POST", `/candidatures-univ/${c.id}/decision`, o.jeton, { decision: "admise" });
    await env.api("POST", `/filieres/${f.id}/frais`, o.jeton, { annee: "2026-2027", libelle: "S", montant: 1000, echeance: j(-10).slice(0, 10) });
    const T = o.entites.GTA!;
    const tb = (await env.api("GET", `/recouvrement/tableau?brancheId=${T}`, o.jeton)).corps;
    expect(tb.total).toBe(1000);
    expect(tb.programmes[0]).toEqual({ nom: "Info", reste: 1000 });
    const r = (await env.api("GET", `/recouvrement/relances?brancheId=${T}`, o.jeton)).corps.a_relancer[0];
    expect(r).toMatchObject({ source_type: "scolarite", niveau: "rappel" });
    expect((await env.api("POST", "/recouvrement/relances", o.jeton, { brancheId: T, sourceType: "scolarite", sourceId: r.source_id, canal: "appel" })).statut).toBe(201);
    const s = (await env.api("GET", `/filieres/${f.id}/scolarite?annee=2026-2027`, o.jeton)).corps.etudiants[0];
    await env.api("PUT", "/notes-univ", o.jeton, { inscriptionId: s.id, ueId: ue.id, session: "normale", note: 12 });
    const st = (await env.api("GET", "/universite/statistiques?annee=2026-2027", o.jeton)).corps.filieres[0];
    expect(st).toMatchObject({ candidatures: 1, inscrits: 1 });
    expect(st.reussite).toBe(100);
    expect((await env.api("GET", `/recouvrement/tableau?brancheId=${G(o)}`, o.jeton)).corps.total).toBe(0);
  });
});
