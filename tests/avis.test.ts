import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);

async function session(noms = ["Awa", "Paul"]) {
  const o = await env.nouvelleOrganisation();
  const p = await env.api("POST", "/programmes", o.jeton, {
    entiteId: o.entites.GTA, code: "P", nom: "E-commerce",
    planPaiement: [{ libelle: "U", montant: 1000, jours_apres_debut: 0 }],
  });
  const s = await env.api("POST", "/sessions", o.jeton, {
    programmeId: p.corps.id, code: "S1", ville: "Douala", debut: "2026-10-01", fin: "2026-10-31", formateurId: o.adminId,
  });
  const inscriptions: string[] = [];
  for (const nom of noms) {
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom, telephone: `69900${inscriptions.length}000` });
    inscriptions.push((await env.api("POST", `/sessions/${s.corps.id}/inscriptions`, o.jeton, { tiersId: t.corps.id })).corps.id);
  }
  return { ...o, sessionId: s.corps.id as string, inscriptions };
}
const code = (lien: string) => lien.split("?c=")[1]!;
const REPONSE = { noteGlobale: 5, noteContenu: 4, noteFormateur: 5, noteOrganisation: 3, recommande: true };

describe("avis de formation", () => {
  it("recueille un avis une seule fois et calcule les résultats", async () => {
    const o = await session();
    const liens = (await env.api("POST", `/sessions/${o.sessionId}/avis/demandes`, o.jeton)).corps;
    expect(liens).toHaveLength(2);
    const [a, b] = liens.map((l: { lien: string }) => code(l.lien));

    const info = await env.api("GET", `/avis-public/${a}`);
    expect(info.corps).toEqual({ programme: "E-commerce", ville: "Douala", repondu: false });
    expect((await env.api("POST", `/avis-public/${a}`, undefined, { ...REPONSE, noteGlobale: 6 })).statut).toBe(400);
    expect((await env.api("POST", `/avis-public/${a}`, undefined, { ...REPONSE, commentaire: "Très bien" })).statut).toBe(201);
    expect((await env.api("POST", `/avis-public/${a}`, undefined, REPONSE)).corps.erreur).toBe("deja_repondu");
    await env.api("POST", `/avis-public/${b}`, undefined, { ...REPONSE, noteGlobale: 2, recommande: false });

    const r = (await env.api("GET", `/sessions/${o.sessionId}/avis`, o.jeton)).corps;
    expect(r).toMatchObject({ demandes: 2, reponses: 2, taux_reponse: 100, globale: 3.5, recommande: 50, notes_basses: 1 });
    expect(r.commentaires.map((c: { commentaire: string }) => c.commentaire)).toEqual(["Très bien"]);
  });

  it("deux envois simultanés du même lien ne comptent qu'une fois", async () => {
    const o = await session(["Awa"]);
    const [l] = (await env.api("POST", `/sessions/${o.sessionId}/avis/demandes`, o.jeton)).corps;
    const r = await Promise.all(Array.from({ length: 5 }, () => env.api("POST", `/avis-public/${code(l.lien)}`, undefined, REPONSE)));
    expect(r.filter((x) => x.statut === 201)).toHaveLength(1);
    expect((await env.api("GET", `/sessions/${o.sessionId}/avis`, o.jeton)).corps.reponses).toBe(1);
  });

  it("un lien existant reste le même et les nouveaux inscrits reçoivent le leur", async () => {
    const o = await session(["Awa"]);
    const [l1] = (await env.api("POST", `/sessions/${o.sessionId}/avis/demandes`, o.jeton)).corps;
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Zoé" });
    await env.api("POST", `/sessions/${o.sessionId}/inscriptions`, o.jeton, { tiersId: t.corps.id });
    const liens = (await env.api("POST", `/sessions/${o.sessionId}/avis/demandes`, o.jeton)).corps;
    expect(liens).toHaveLength(2);
    expect(liens[0].lien).toBe(l1.lien);
  });

  it("ne garde aucun lien entre l'avis et son auteur, ni dans le résultat ni dans le journal", async () => {
    const o = await session(["Awa Secrète"]);
    const [l] = (await env.api("POST", `/sessions/${o.sessionId}/avis/demandes`, o.jeton)).corps;
    await env.api("POST", `/avis-public/${code(l.lien)}`, undefined, { ...REPONSE, commentaire: "Mon avis privé" });
    const r = await env.api("GET", `/sessions/${o.sessionId}/avis`, o.jeton);
    expect(JSON.stringify(r.corps)).not.toContain("Awa");
    const audit = JSON.stringify((await env.api("GET", "/audit?limite=200", o.jeton)).corps);
    expect(audit).not.toContain("Mon avis privé");
    const colonnes = await env.poolAdmin.query(
      "select column_name from information_schema.columns where table_name = 'avis_formation'",
    );
    const noms = colonnes.rows.map((c) => c.column_name);
    expect(noms).not.toContain("tiers_id");
    expect(noms).not.toContain("inscription_id");
    const { rows } = await dansOrganisation(env.poolAdmin, o.organisationId, (c) =>
      c.query("select repondu_le from demandes_avis where organisation_id = org_courante() and repondu_le is not null"));
    // Seul le jour est gardé, pour ne pas rapprocher une réponse de l'heure d'un avis.
    expect(new Date(rows[0].repondu_le).getMinutes()).toBe(0);
  });

  it("masquer un commentaire exige un motif et garde ses notes dans les moyennes", async () => {
    const o = await session(["Awa"]);
    const [l] = (await env.api("POST", `/sessions/${o.sessionId}/avis/demandes`, o.jeton)).corps;
    await env.api("POST", `/avis-public/${code(l.lien)}`, undefined, { ...REPONSE, noteGlobale: 1, commentaire: "Propos injurieux" });
    const lire = async () => (await env.api("GET", `/sessions/${o.sessionId}/avis`, o.jeton)).corps;
    const id = (await lire()).commentaires[0].id;
    expect((await env.api("POST", `/avis/${id}/moderation`, o.jeton, { masquer: true })).corps.erreur).toBe("motif_obligatoire");
    await env.api("POST", `/avis/${id}/moderation`, o.jeton, { masquer: true, motif: "Propos injurieux" });
    const m = await lire();
    expect(m.globale).toBe(1);
    expect(m.commentaires[0]).toMatchObject({ commentaire: null, commentaire_masque: true });
    await env.api("POST", `/avis/${id}/moderation`, o.jeton, { masquer: false });
    expect((await lire()).commentaires[0].commentaire).toBe("Propos injurieux");
    const audit = (await env.api("GET", "/audit?limite=20", o.jeton)).corps;
    expect(audit.some((x: { objet: string }) => x.objet === "avis_formation")).toBe(true);
  });

  it("respecte les droits et l'isolation", async () => {
    const o = await session(["Awa"]);
    const roles = (await env.api("GET", "/roles", o.jeton)).corps;
    const email = `f${Math.random()}@test.cm`;
    await env.api("POST", "/utilisateurs", o.jeton, {
      email, nom: "F", motDePasse: MOT_DE_PASSE, entiteId: o.entites.GTA,
      roleId: roles.find((r: { code: string }) => r.code === "formateur").id,
    });
    const formateur = await env.connecter(o.slug, email);
    expect((await env.api("POST", `/sessions/${o.sessionId}/avis/demandes`, formateur)).statut).toBe(403);
    expect((await env.api("GET", `/sessions/${o.sessionId}/avis`, formateur)).statut).toBe(200);

    const [l] = (await env.api("POST", `/sessions/${o.sessionId}/avis/demandes`, o.jeton)).corps;
    await env.api("POST", `/avis-public/${code(l.lien)}`, undefined, { ...REPONSE, commentaire: "Texte" });
    const id = (await env.api("GET", `/sessions/${o.sessionId}/avis`, o.jeton)).corps.commentaires[0].id;
    expect((await env.api("POST", `/avis/${id}/moderation`, formateur, { masquer: true, motif: "Je veux masquer" })).statut).toBe(403);

    const autre = await session(["X"]);
    expect((await env.api("GET", `/sessions/${o.sessionId}/avis`, autre.jeton)).statut).toBe(404);
    expect((await env.api("POST", `/avis/${id}/moderation`, autre.jeton, { masquer: true, motif: "Autre client" })).statut).toBe(404);
    const secret = code(l.lien).split(".")[1];
    expect((await env.api("GET", `/avis-public/${autre.organisationId}.${secret}`)).statut).toBe(404);
    expect((await env.api("GET", "/avis-public/mauvais")).statut).toBe(404);
  });

  it("un apprenant retiré ne peut plus répondre", async () => {
    const o = await session(["Awa"]);
    const [l] = (await env.api("POST", `/sessions/${o.sessionId}/avis/demandes`, o.jeton)).corps;
    await env.api("POST", `/inscriptions/${o.inscriptions[0]}/statut`, o.jeton, { statut: "annulee" });
    expect((await env.api("POST", `/avis-public/${code(l.lien)}`, undefined, REPONSE)).statut).toBe(404);
  });
});
