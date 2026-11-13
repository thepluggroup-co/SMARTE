import { afterAll, describe, expect, it } from "vitest";
import { situationScolarite } from "../src/scolarite.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(() => env.fermer());
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
const G = (o: Org) => o.entites.GLOMARI!;
const U = (o: Org) => o.entites.IP2EL!;
const j = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
async function compte(o: Org, code: string, entiteId: string) {
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
  const u = await env.api("POST", "/utilisateurs", o.jeton, { email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((x: { code: string }) => x.code === code).id });
  return { jeton: await env.connecter(o.slug, email), id: u.corps.id as string };
}
const ANNEE = "2026-2027";
async function univ() {
  const o = await env.nouvelleOrganisation();
  const f = (await env.api("POST", "/filieres", o.jeton, { entiteId: U(o), code: "INF", nom: "Informatique", diplome: "Licence", creditsRequis: 6, noteValidation: 10 })).corps;
  const ue = (await env.api("POST", `/filieres/${f.id}/ues`, o.jeton, { code: "UE1", nom: "Algo", credits: 6, semestre: 1 })).corps;
  const t = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Étudiant", entiteId: U(o) })).corps;
  const c = (await env.api("POST", `/filieres/${f.id}/candidatures`, o.jeton, { tiersId: t.id, annee: ANNEE })).corps;
  const d = (await env.api("POST", `/candidatures-univ/${c.id}/decision`, o.jeton, { decision: "admise" })).corps;
  return { o, f, ue, t, c, d };
}

describe("scolarité", () => {
  it("calcule le reste, les bourses et l'accès aux examens", () => {
    const fr = [{ montant: 100, echeance: "2026-01-01" }, { montant: 100, echeance: "2026-06-01" }];
    expect(situationScolarite(fr, 0, 100, "2026-02-01")).toMatchObject({ reste: 100, impaye_echu: 0, acces_examen: true });
    expect(situationScolarite(fr, 0, 50, "2026-02-01")).toMatchObject({ reste: 150, impaye_echu: 50, acces_examen: false });
    expect(situationScolarite(fr, 100, 0, "2026-02-01")).toMatchObject({ net: 100, impaye_echu: 100, acces_examen: false });
    expect(situationScolarite(fr, 200, 0, "2026-07-01")).toMatchObject({ net: 0, reste: 0, acces_examen: true });
  });
  it("encaisse dans un portefeuille, refuse le trop-perçu et bloque le diplôme", async () => {
    const { o, f, d } = await univ();
    const insc = d.inscription?.id ?? d.id;
    await env.api("POST", `/filieres/${f.id}/frais`, o.jeton, { annee: ANNEE, libelle: "Scolarité", montant: 1000, echeance: j(-1) });
    const s = (await env.api("GET", `/filieres/${f.id}/scolarite?annee=${ANNEE}`, o.jeton)).corps;
    expect(s.etudiants[0]).toMatchObject({ reste: 1000, acces_examen: false });
    const w = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: o.entites.GTA!, nom: "Caisse", type: "especes" })).corps;
    const P = (m: number) => env.api("POST", `/inscriptions-univ/${s.etudiants[0].id}/paiements`, o.jeton, { montant: m, portefeuilleId: w.id });
    await env.api("POST", `/inscriptions-univ/${s.etudiants[0].id}/bourses`, o.jeton, { libelle: "Mérite", montant: 200 });
    expect((await env.api("GET", `/filieres/${f.id}/scolarite?annee=${ANNEE}`, o.jeton)).corps.etudiants[0].net).toBe(800);
    expect((await env.api("POST", `/inscriptions-univ/${s.etudiants[0].id}/diplome`, o.jeton)).corps.erreur).toBe("deliberation_manquante");
    expect((await P(900)).corps.erreur).toBe("paiement_superieur_au_reste");
    expect((await P(800)).corps.numero).toMatch(/^SCO-/);
    expect((await env.api("GET", `/filieres/${f.id}/scolarite?annee=${ANNEE}`, o.jeton)).corps.etudiants[0]).toMatchObject({ reste: 0, acces_examen: true });
    expect((await env.api("GET", "/portefeuilles", o.jeton)).corps.find((x: { id: string }) => x.id === w.id).solde).toBe(800);
    const glo = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: G(o), nom: "G", type: "especes" })).corps;
    expect((await env.api("POST", `/inscriptions-univ/${s.etudiants[0].id}/bourses`, o.jeton, { libelle: "B", montant: 1 })).statut).toBe(201);
    expect((await env.api("POST", `/inscriptions-univ/${s.etudiants[0].id}/paiements`, o.jeton, { montant: 1, portefeuilleId: glo.id })).statut).toBeGreaterThanOrEqual(404);
    expect(insc).toBeTruthy();
  });
  it("refuse les conflits d'emploi du temps et enregistre l'appel", async () => {
    const { o, f, ue } = await univ();
    const C = (x: object) => env.api("POST", `/filieres/${f.id}/cours`, o.jeton, { ueId: ue.id, annee: ANNEE, jour: j(3), debut: "08:00", fin: "10:00", salle: "A1", ...x });
    const a = await C({});
    expect(a.statut).toBe(201);
    expect((await C({ debut: "09:00", fin: "11:00", salle: "B2" })).corps.erreur).toBe("conflit_promotion");
    const f2 = (await env.api("POST", "/filieres", o.jeton, { entiteId: U(o), code: "GES", nom: "Gestion", diplome: "Licence", creditsRequis: 6, noteValidation: 10 })).corps;
    const ue2 = (await env.api("POST", `/filieres/${f2.id}/ues`, o.jeton, { code: "UE2", nom: "Compta", credits: 6, semestre: 1 })).corps;
    expect((await env.api("POST", `/filieres/${f2.id}/cours`, o.jeton, { ueId: ue2.id, annee: ANNEE, jour: j(3), debut: "09:00", fin: "11:00", salle: "A1" })).corps.erreur).toBe("conflit_salle");
    expect((await C({ debut: "10:00", fin: "12:00", salle: "A1" })).statut).toBe(201);
    const s = (await env.api("GET", `/filieres/${f.id}/scolarite?annee=${ANNEE}`, o.jeton)).corps;
    expect((await env.api("PUT", `/cours-planifies/${a.corps.id}/appel`, o.jeton, { absents: [s.etudiants[0].id] })).corps).toEqual({ appeles: 1, absents: 1 });
    expect((await env.api("PUT", `/cours-planifies/${a.corps.id}/appel`, o.jeton, { absents: [] })).corps.absents).toBe(0);
    expect((await env.api("GET", `/filieres/${f.id}/cours?annee=${ANNEE}`, o.jeton)).corps[0]).toMatchObject({ presents: 1, appeles: 1 });
  });
});

describe("paie", () => {
  it("prépare l'état, chiffre le compte, verse une seule fois et prépare l'écriture", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("POST", "/compta/initialisation", o.jeton, { brancheId: G(o) });
    const e = (await env.api("POST", "/employes", o.jeton, { entiteId: G(o), nom: "Awa", poste: "V", typeContrat: "cdi", dateEmbauche: "2025-01-01" })).corps;
    await env.api("PUT", `/employes/${e.id}/salaire`, o.jeton, { salaireBase: 100000 });
    await env.api("PUT", "/paie/validation", o.jeton, { entiteId: G(o), expert: "Cabinet X", valideLe: j(0) });
    expect((await env.api("PUT", `/employes/${e.id}/paiement`, o.jeton, { mode: "mtn_momo" })).corps.erreur).toBe("compte_paiement_obligatoire");
    await env.api("PUT", `/employes/${e.id}/paiement`, o.jeton, { mode: "mtn_momo", compte: "677000111" });
    const per = j(-40).slice(0, 7);
    const b = (await env.api("POST", "/bulletins", o.jeton, { employeId: e.id, periode: per })).corps;
    await env.api("POST", `/bulletins/${b.id}/validation`, o.jeton);
    const et = (await env.api("GET", `/paie/etat?entiteId=${G(o)}&periode=${per}`, o.jeton)).corps;
    expect(et.totaux.net).toBe(100000);
    expect(et.salaries[0]).toMatchObject({ compte: "677000111", verse: false });
    const w = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: G(o), nom: "Banque", type: "banque", soldeInitial: 150000 })).corps;
    const V = { entiteId: G(o), periode: per, portefeuilleId: w.id, bulletins: [b.id] };
    expect((await env.api("POST", "/paie/versements", o.jeton, V)).corps).toEqual({ verses: 1, total: 100000 });
    expect((await env.api("POST", "/paie/versements", o.jeton, V)).corps.erreur).toBe("bulletins_non_payables");
    const rh = await compte(o, "ressources_humaines", G(o));
    expect((await env.api("GET", `/paie/etat?entiteId=${G(o)}&periode=${per}`, rh.jeton)).statut).toBe(403);
    await env.api("POST", "/compta/generation", o.jeton, { brancheId: G(o), fin: j(0) });
    const ec = (await env.api("GET", `/compta/ecritures?brancheId=${G(o)}&statut=brouillon`, o.jeton)).corps;
    expect(ec.some((x: { libelle: string }) => x.libelle.startsWith("Paie"))).toBe(true);
  });
});

describe("réservation de coaching", () => {
  it("laisse réserver par lien, sans doublon, dans le forfait, et annuler à temps", async () => {
    const o = await env.nouvelleOrganisation();
    const S = o.entites.SMARTE!;
    const tc = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Coach", entiteId: S })).corps;
    const coach = (await env.api("POST", "/coachs", o.jeton, { entiteId: S, tiersId: tc.id })).corps;
    const cl = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Client", entiteId: S })).corps;
    const a = (await env.api("POST", "/accompagnements", o.jeton, { entiteId: S, coachId: coach.id, tiersId: cl.id, titre: "Coaching", consentementLe: j(0), forfaitSeances: 1 })).corps;
    expect(a.id).toBeTruthy();
    const lien = (await env.api("POST", `/accompagnements/${a.id}/lien-client`, o.jeton)).corps.lien;
    const code = encodeURIComponent(lien.split("c=")[1]);
    const c1 = (await env.api("POST", `/coachs/${coach.id}/creneaux`, o.jeton, { debut: `${j(5)}T09:00:00Z`, dureeMinutes: 60 })).corps;
    const c2 = (await env.api("POST", `/coachs/${coach.id}/creneaux`, o.jeton, { debut: `${j(6)}T09:00:00Z`, dureeMinutes: 60 })).corps;
    const R = (id: string) => env.app.inject({ method: "POST", url: `/reservation-coaching/${code}`, payload: { creneauId: id } });
    const d = (await env.app.inject({ method: "GET", url: `/reservation-coaching/${code}` })).json();
    expect(d.creneaux).toHaveLength(2);
    expect(d.restant).toBe(1);
    const s = await R(c1.id);
    expect(s.statusCode).toBe(201);
    expect((await R(c2.id)).json().erreur).toBe("forfait_epuise");
    expect((await env.app.inject({ method: "POST", url: `/reservation-coaching/${code}/seances/${s.json().id}/annulation` })).json().annulee).toBe(true);
    const apres = (await env.app.inject({ method: "GET", url: `/reservation-coaching/${code}` })).json();
    expect(apres.creneaux).toHaveLength(2);
    expect(apres.restant).toBe(1);
    expect((await env.app.inject({ method: "GET", url: `/reservation-coaching/${o.organisationId}.mauvais-code-mauvais-code` })).statusCode).toBe(404);
  });
});
