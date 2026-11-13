import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { repartirRedevances } from "../src/coaching.js";
import { calculerResultat } from "../src/universite.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
async function compte(o: Org, code: string, entiteId: string) {
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
  const u = await env.api("POST", "/utilisateurs", o.jeton, { email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((x: { code: string }) => x.code === code).id });
  return { jeton: await env.connecter(o.slug, email), id: u.corps.id as string };
}
const tiers = async (o: Org, nom: string, entite: string) => (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom, entiteId: entite })).corps.id as string;

describe("séparation des branches", () => {
  it("un administrateur de GLOMARI n'a aucun droit de formation", async () => {
    const o = await env.nouvelleOrganisation();
    const a = await compte(o, "administrateur", o.entites.GLOMARI!);
    const { permissions } = (await env.api("GET", "/moi", a.jeton)).corps;
    for (const d of ["formations.voir", "apprentissage.voir", "mentorat.voir", "foundation.voir", "coaching.voir", "universite.voir"]) expect(permissions).not.toContain(d);
    expect(permissions).toContain("stocks.voir");
    expect((await env.api("GET", "/sessions", a.jeton)).statut).toBe(403);
    const g = await compte(o, "administrateur", o.entites.GTA!);
    const dg = (await env.api("GET", "/moi", g.jeton)).corps.permissions;
    for (const d of ["stocks.voir", "caisse.vendre", "achats.voir"]) expect(dg).not.toContain(d);
    expect(dg).toContain("formations.voir");
  });
});

describe("SMARTE Coaching", () => {
  const coach = async (o: Org, nom: string, parentId?: string, utilisateurId?: string) =>
    (await env.api("POST", "/coachs", o.jeton, { entiteId: o.entites.SMARTE, tiersId: await tiers(o, nom, o.entites.SMARTE!), parentId, utilisateurId })).corps.id as string;

  it("répartit les redevances selon les taux réglés, sans taux par défaut", () => {
    expect(repartirRedevances(1000, ["a", "b", "c"], new Map([[1, 10], [3, 2.5]]))).toEqual([
      { beneficiaire: "a", profondeur: 1, taux: 10, montant: 100 }, { beneficiaire: "c", profondeur: 3, taux: 2.5, montant: 25 },
    ]);
    expect(repartirRedevances(1000, ["a"], new Map())).toEqual([]);
  });

  it("calcule la cascade du réseau et sa croissance", async () => {
    const o = await env.nouvelleOrganisation();
    const a = await coach(o, "A");
    const b = await coach(o, "B", a);
    const c = await coach(o, "C", b);
    await env.api("PUT", "/redevances/regles", o.jeton, { entiteId: o.entites.SMARTE, taux: [{ profondeur: 1, taux: 10 }, { profondeur: 2, taux: 5 }] });
    const r = await env.api("POST", `/coachs/${c}/revenus`, o.jeton, { periode: "2026-11", libelle: "Formation", montant: 100000 });
    expect(r.corps.redevances.map((x: { beneficiaire: string; montant: number }) => [x.beneficiaire, x.montant])).toEqual([[b, 10000], [a, 5000]]);
    expect((await env.api("GET", `/coachs/reseau?entiteId=${o.entites.SMARTE}`, o.jeton)).corps).toEqual([{ generation: 1, coachs: 1 }, { generation: 2, coachs: 1 }, { generation: 3, coachs: 1 }]);
    const liste = (await env.api("GET", "/coachs", o.jeton)).corps;
    expect(liste.find((x: { id: string }) => x.id === a).redevances_dues).toBe(5000);
  });

  it("garde les notes pour le seul coach, pas même le super administrateur, et chiffrées", async () => {
    const o = await env.nouvelleOrganisation();
    const u1 = await compte(o, "coach", o.entites.SMARTE!);
    const u2 = await compte(o, "coach", o.entites.SMARTE!);
    const c = await coach(o, "Coach 1", undefined, u1.id);
    const a = await env.api("POST", "/accompagnements", o.jeton, { coachId: c, tiersId: await tiers(o, "Client", o.entites.SMARTE!), titre: "Résilience", consentementLe: "2026-11-01", forfaitSeances: 1 });
    expect(a.statut).toBe(201);
    const url = `/accompagnements/${a.corps.id}`;
    expect((await env.api("POST", `${url}/notes`, o.jeton, { contenu: "x" })).statut).toBe(403);
    expect((await env.api("POST", `${url}/notes`, u1.jeton, { contenu: "Secret du client" })).statut).toBe(201);
    expect((await env.api("GET", url, u1.jeton)).corps.notes[0].contenu).toBe("Secret du client");
    const admin = (await env.api("GET", url, o.jeton)).corps;
    expect(admin.titre).toBe("Résilience");
    expect(admin.notes).toEqual([]);
    expect((await env.api("GET", url, u2.jeton)).statut).toBe(403);
    expect((await env.api("GET", "/accompagnements", u2.jeton)).corps).toEqual([]);
    expect((await env.api("GET", "/accompagnements", u1.jeton)).corps).toHaveLength(1);
    const { rows } = await dansOrganisation(env.poolAdmin, o.organisationId, (x) => x.query(
      `select (select string_agg(contenu_chiffre, '') from notes_coaching where accompagnement_id = $1) as n,
        (select string_agg(coalesce(avant::text, '') || coalesce(apres::text, ''), '') from journal_audit where organisation_id = $2) as j`, [a.corps.id, o.organisationId]));
    expect(rows[0].n).not.toContain("Secret");
    expect(rows[0].j).not.toContain("Secret");
    expect((await env.api("POST", `${url}/seances`, u1.jeton, { debut: "2026-12-01T10:00:00.000Z", dureeMinutes: 60 })).statut).toBe(201);
    expect((await env.api("POST", `${url}/seances`, u1.jeton, { debut: "2026-12-02T10:00:00.000Z", dureeMinutes: 60 })).corps.erreur).toBe("forfait_epuise");
  });

  it("délivre le certificat seulement si le parcours et le niveau précédent sont complets", async () => {
    const o = await env.nouvelleOrganisation();
    const niveau = async (ordre: number) => (await env.api("POST", "/certification/niveaux", o.jeton, { entiteId: o.entites.SMARTE, ordre, nom: `Niveau ${ordre}`, heuresRequises: 10, supervisionsRequises: 1 })).corps.id;
    const [n1, n2] = [await niveau(1), await niveau(2)];
    const t = await tiers(o, "Awa", o.entites.SMARTE!);
    const p = async (n: string) => (await env.api("POST", `/certification/niveaux/${n}/parcours`, o.jeton, { tiersId: t })).corps.id;
    const [p1, p2] = [await p(n1), await p(n2)];
    const remplir = (id: string) => env.api("PATCH", `/certification/parcours/${id}`, o.jeton, { heures: 10, supervisions: 1, examenReussi: true, soutenanceReussie: true });
    const delivrer = (id: string) => env.api("POST", `/certification/parcours/${id}/delivrance`, o.jeton);
    expect((await delivrer(p1)).corps.erreur).toBe("parcours_incomplet");
    await remplir(p2);
    expect((await delivrer(p2)).corps.erreur).toBe("niveau_precedent_manquant");
    await remplir(p1);
    const c = await delivrer(p1);
    expect(c.corps.numero).toMatch(/^SMARTE-/);
    const j = new URL(c.corps.url_verification).searchParams.get("c");
    expect((await env.api("GET", `/verification/${j}`)).corps).toMatchObject({ valide: true, titulaire: "Awa" });
    expect((await remplir(p1)).corps.erreur).toBe("certificat_deja_delivre");
    expect((await delivrer(p2)).statut).toBe(201);
    await env.api("POST", `/certification/parcours/${p1}/revocation`, o.jeton, { motif: "Erreur de dossier" });
    expect((await env.api("GET", `/verification/${j}`)).corps.valide).toBe(false);
  });

  it("refuse le coaching sur GLOMARI et aux autres organisations", async () => {
    const o = await env.nouvelleOrganisation();
    expect((await env.api("POST", "/coachs", o.jeton, { entiteId: o.entites.GLOMARI, tiersId: await tiers(o, "X", o.entites.GLOMARI!) })).statut).toBe(403);
    const c = await coach(o, "A");
    const e = await env.nouvelleOrganisation();
    expect((await env.api("POST", `/coachs/${c}/revenus`, e.jeton, { periode: "2026-11", libelle: "x", montant: 1 })).statut).toBe(404);
  });
});

describe("IP2EL University", () => {
  it("calcule la moyenne et les crédits avec la meilleure note", () => {
    expect(calculerResultat([
      { ue: "A", credits: 4, normale: 8, rattrapage: 12 },
      { ue: "B", credits: 2, normale: 6, rattrapage: null },
      { ue: "C", credits: 6, normale: null, rattrapage: null },
    ], 10)).toEqual({ moyenne: 10, creditsAcquis: 4 });
    expect(calculerResultat([], 10)).toEqual({ moyenne: null, creditsAcquis: 0 });
  });

  it("va de la candidature au diplôme vérifiable, et fige les notes délibérées", async () => {
    const o = await env.nouvelleOrganisation();
    const f = (await env.api("POST", "/filieres", o.jeton, { entiteId: o.entites.IP2EL, code: "MK", nom: "Marketing", diplome: "Licence", creditsRequis: 4, noteValidation: 10 })).corps.id as string;
    const ue = async (code: string, credits: number) => (await env.api("POST", `/filieres/${f}/ues`, o.jeton, { code, nom: code, credits, semestre: 1 })).corps.id as string;
    const [u1, u2] = [await ue("U1", 4), await ue("U2", 2)];
    const c = await env.api("POST", `/filieres/${f}/candidatures`, o.jeton, { tiersId: await tiers(o, "Awa", o.entites.IP2EL!), annee: "2026-2027" });
    const d = await env.api("POST", `/candidatures-univ/${c.corps.id}/decision`, o.jeton, { decision: "admise" });
    expect(d.corps.inscription.matricule).toMatch(/^ETU-2026/);
    expect((await env.api("POST", `/candidatures-univ/${c.corps.id}/decision`, o.jeton, { decision: "admise" })).statut).toBe(409);
    const i = d.corps.inscription.id as string;
    const note = (ueId: string, n: number, jeton = o.jeton, session = "normale") => env.api("PUT", "/notes-univ", jeton, { inscriptionId: i, ueId, session, note: n });
    const prof = await compte(o, "enseignant", o.entites.IP2EL!);
    expect((await note(u1, 8, prof.jeton)).statut).toBe(200);
    expect((await env.api("POST", `/filieres/${f}/ues`, prof.jeton, { code: "X", nom: "X", credits: 1, semestre: 1 })).statut).toBe(403);
    expect((await note(u2, 15)).statut).toBe(200);
    const diplome = () => env.api("POST", `/inscriptions-univ/${i}/diplome`, o.jeton);
    expect((await diplome()).corps.erreur).toBe("deliberation_manquante");
    const delib = () => env.api("POST", `/filieres/${f}/deliberations`, o.jeton, { annee: "2026-2027", session: "normale", president: "Pr Mbarga" });
    expect((await delib()).corps.resultats[0]).toMatchObject({ credits_acquis: 2, moyenne: 10.33 });
    expect((await delib()).statut).toBe(409);
    expect((await note(u1, 20)).corps.erreur).toBe("deliberation_figee");
    expect((await diplome()).corps).toMatchObject({ erreur: "credits_insuffisants", details: { acquis: 2, requis: 4 } });
    expect((await note(u1, 12, o.jeton, "rattrapage")).statut).toBe(200);
    expect((await diplome()).corps.erreur).toBe("credits_insuffisants");
    expect((await env.api("POST", `/filieres/${f}/deliberations`, o.jeton, { annee: "2026-2027", session: "rattrapage", president: "Pr Mbarga" })).statut).toBe(201);
    const fin = await diplome();
    expect(fin.statut).toBe(201);
    expect((await env.api("GET", `/verification/${new URL(fin.corps.url_verification).searchParams.get("c")}`)).corps).toMatchObject({ valide: true, programme: "Licence : Marketing" });
    expect((await diplome()).statut).toBe(409);
    expect((await env.api("GET", `/inscriptions-univ/${i}/releve`, o.jeton)).corps).toMatchObject({ creditsAcquis: 6, etudiant: "Awa" });
    const glo = await compte(o, "administrateur", o.entites.GLOMARI!);
    expect((await env.api("GET", `/filieres/${f}`, glo.jeton)).statut).toBe(403);
    const e = await env.nouvelleOrganisation();
    expect((await env.api("GET", `/filieres/${f}`, e.jeton)).statut).toBe(404);
  });

  it("refuse une note sur une UE d'une autre filière", async () => {
    const o = await env.nouvelleOrganisation();
    const fil = async (code: string) => (await env.api("POST", "/filieres", o.jeton, { entiteId: o.entites.IP2EL, code, nom: code, diplome: "L", creditsRequis: 1, noteValidation: 10 })).corps.id as string;
    const [f1, f2] = [await fil("A"), await fil("B")];
    const u = (await env.api("POST", `/filieres/${f2}/ues`, o.jeton, { code: "U", nom: "U", credits: 1, semestre: 1 })).corps.id;
    const c = await env.api("POST", `/filieres/${f1}/candidatures`, o.jeton, { tiersId: await tiers(o, "Awa", o.entites.IP2EL!), annee: "2026-2027" });
    const d = await env.api("POST", `/candidatures-univ/${c.corps.id}/decision`, o.jeton, { decision: "admise" });
    expect((await env.api("PUT", "/notes-univ", o.jeton, { inscriptionId: d.corps.inscription.id, ueId: u, session: "normale", note: 10 })).statut).toBe(404);
  });
});
