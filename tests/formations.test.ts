import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { repartir } from "../src/formations.js";
import { codeTotp, pasActuel } from "../src/securite.js";
import { creerServeur } from "../src/serveur.js";
import { environnement, MOT_DE_PASSE, OPTIONS } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);

const PLAN = [
  { libelle: "Inscription", montant: 20000, jours_apres_debut: 0 },
  { libelle: "Tranche 1", montant: 50000, jours_apres_debut: 0 },
  { libelle: "Tranche 2", montant: 50000, jours_apres_debut: 30 },
];

async function preparer(capacite?: number) {
  const o = await env.nouvelleOrganisation();
  const p = await env.api("POST", "/programmes", o.jeton, {
    entiteId: o.entites.GTA, code: "ECOM", nom: "Formation E-commerce", planPaiement: PLAN,
  });
  expect(p.statut).toBe(201);
  const s = await env.api("POST", "/sessions", o.jeton, {
    programmeId: p.corps.id, code: "ECOM-DLA-01", ville: "Douala", debut: "2026-10-09", fin: "2026-10-31", capacite,
  });
  expect(s.statut).toBe(201);
  return { ...o, programmeId: p.corps.id as string, sessionId: s.corps.id as string };
}

async function inscrire(o: { jeton: string; sessionId: string }, nom = "Awa Test") {
  const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom, ignorerDoublons: true });
  const i = await env.api("POST", `/sessions/${o.sessionId}/inscriptions`, o.jeton, { tiersId: t.corps.id });
  expect(i.statut).toBe(201);
  return { inscriptionId: i.corps.id as string, tiersId: t.corps.id as string };
}

const encaisser = (jeton: string, id: string, montant: number, moyen = "especes", reference?: string) =>
  env.api("POST", `/inscriptions/${id}/paiements`, jeton, { montant, moyen, reference });

const suivi = async (o: { jeton: string; sessionId: string }) =>
  (await env.api("GET", `/sessions/${o.sessionId}/suivi`, o.jeton)).corps;

describe("double authentification", () => {
  it("respecte le vecteur de test de la RFC 6238", () => {
    // Secret "12345678901234567890" en base 32, pas 1 (59 s) : 287082 sur 6 chiffres.
    expect(codeTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1)).toBe("287082");
  });

  it("exige le code une fois activée et refuse sa réutilisation", async () => {
    const o = await env.nouvelleOrganisation();
    const a = await env.api("POST", "/2fa/activation", o.jeton);
    expect((await env.api("POST", "/2fa/confirmation", o.jeton, { code: "000000" })).statut).toBe(400);
    const pas = pasActuel();
    expect((await env.api("POST", "/2fa/confirmation", o.jeton, { code: codeTotp(a.corps.secret, pas - 1) })).statut).toBe(200);

    const ident = { organisation: o.slug, email: o.email, motDePasse: MOT_DE_PASSE };
    const sans = await env.api("POST", "/connexion", undefined, ident);
    expect(sans.corps.erreur).toBe("code_2fa_requis");
    expect((await env.api("POST", "/connexion", undefined, { ...ident, code: "000000" })).statut).toBe(401);
    // Le mot de passe seul ne révèle rien sur la double authentification s'il est faux.
    const faux = await env.api("POST", "/connexion", undefined, { ...ident, motDePasse: "faux" });
    expect(faux.corps.erreur).toBe("identifiants_invalides");

    const code = codeTotp(a.corps.secret, pas);
    expect((await env.api("POST", "/connexion", undefined, { ...ident, code })).statut).toBe(200);
    expect((await env.api("POST", "/connexion", undefined, { ...ident, code })).statut).toBe(401);
  });

  it("stocke le secret chiffré, jamais dans le journal, et un administrateur peut réinitialiser", async () => {
    const o = await env.nouvelleOrganisation();
    const a = await env.api("POST", "/2fa/activation", o.jeton);
    await env.api("POST", "/2fa/confirmation", o.jeton, { code: codeTotp(a.corps.secret, pasActuel()) });
    const { rows } = await dansOrganisation(env.poolAdmin, o.organisationId, (c) =>
      c.query("select totp_secret_chiffre from utilisateurs where id = $1", [o.adminId]));
    expect(rows[0].totp_secret_chiffre).toBeTruthy();
    expect(rows[0].totp_secret_chiffre).not.toContain(a.corps.secret);
    const audit = JSON.stringify((await env.api("GET", "/audit?limite=200", o.jeton)).corps);
    expect(audit).not.toContain(a.corps.secret);
    expect(audit).not.toContain("totp_secret");

    expect((await env.api("POST", `/utilisateurs/${o.adminId}/2fa/reinitialisation`, o.jeton)).statut).toBe(204);
    expect(await env.connecter(o.slug, o.email)).toBeTruthy();
  });
});

describe("limitation par adresse IP", () => {
  it("bloque après le nombre de tentatives autorisé", async () => {
    const app = await creerServeur(env.poolApp, { ...OPTIONS, connexionsParMinute: 3 });
    const essayer = () => app.inject({
      method: "POST", url: "/connexion",
      payload: { organisation: "inconnue", email: "a@b.cm", motDePasse: "x" },
    });
    for (let i = 0; i < 3; i++) expect((await essayer()).statusCode).toBe(401);
    expect((await essayer()).statusCode).toBe(429);
    await app.close();
  });
});

describe("parcours complet d'une formation", () => {
  it("va de l'inscription au certificat vérifiable", async () => {
    const o = await preparer();
    const { inscriptionId } = await inscrire(o);

    let s = await suivi(o);
    expect(s.totaux).toEqual({ inscrits: 1, du: 120000, paye: 0, reste: 120000 });
    expect(s.inscrits[0].echeances.map((e: { date_echeance: string }) => e.date_echeance))
      .toEqual(["2026-10-09", "2026-10-09", "2026-11-08"]);

    const p1 = await encaisser(o.jeton, inscriptionId, 70000, "mtn_momo", "MP2611090001");
    expect(p1.statut).toBe(201);
    expect(p1.corps.numero_recu).toMatch(/^REC-\d{4}-000001$/);
    expect(p1.corps.reste_apres).toBe(50000);

    // Pas de certificat tant qu'il reste à payer.
    const c1 = await env.api("POST", `/inscriptions/${inscriptionId}/certificat`, o.jeton);
    expect(c1.corps.erreur).toBe("solde_non_regle");
    expect(c1.corps.details.reste).toBe(50000);

    await encaisser(o.jeton, inscriptionId, 50000);
    s = await suivi(o);
    expect(s.totaux.reste).toBe(0);

    // Pas de certificat sans présence suffisante.
    const c2 = await env.api("POST", `/inscriptions/${inscriptionId}/certificat`, o.jeton);
    expect(c2.corps.erreur).toBe("presence_insuffisante");

    await env.api("PUT", `/sessions/${o.sessionId}/presences`, o.jeton, { date: "2026-10-09", presents: [inscriptionId] });
    await env.api("PUT", `/sessions/${o.sessionId}/presences`, o.jeton, { date: "2026-10-10", presents: [inscriptionId] });
    await env.api("PUT", `/sessions/${o.sessionId}/presences`, o.jeton, { date: "2026-10-11", presents: [inscriptionId] });
    await env.api("PUT", `/sessions/${o.sessionId}/presences`, o.jeton, { date: "2026-10-12", presents: [] });
    expect((await suivi(o)).inscrits[0].taux_presence).toBe(75);

    const c3 = await env.api("POST", `/inscriptions/${inscriptionId}/certificat`, o.jeton);
    expect(c3.statut).toBe(201);
    expect(c3.corps.numero).toMatch(/^CERT-\d{4}-000001$/);
    expect(c3.corps.qr_svg).toContain("<svg");
    const code = c3.corps.url_verification.split("?c=")[1];

    // Vérification publique, sans connexion.
    const v = await env.api("GET", `/verification/${code}`);
    expect(v.corps).toMatchObject({ valide: true, titulaire: "Awa Test", programme: "Formation E-commerce" });
    expect(Object.keys(v.corps).sort()).toEqual(["delivre_le", "numero", "programme", "titulaire", "valide"]);

    expect((await env.api("POST", `/inscriptions/${inscriptionId}/certificat`, o.jeton)).statut).toBe(409);
    await env.api("POST", `/certificats/${c3.corps.id}/revocation`, o.jeton, { motif: "Erreur de saisie" });
    expect((await env.api("GET", `/verification/${code}`)).corps.valide).toBe(false);
  });

  it("refuse le certificat tant que la session n'est pas terminée", async () => {
    const o = await env.nouvelleOrganisation();
    const p = await env.api("POST", "/programmes", o.jeton, {
      entiteId: o.entites.GTA, code: "F", nom: "Future", seuilPresence: 0,
      planPaiement: [{ libelle: "Unique", montant: 1000, jours_apres_debut: 0 }],
    });
    const s = await env.api("POST", "/sessions", o.jeton, {
      programmeId: p.corps.id, code: "F1", ville: "Douala", debut: "2099-01-01", fin: "2099-02-01",
    });
    const { inscriptionId } = await inscrire({ jeton: o.jeton, sessionId: s.corps.id });
    await encaisser(o.jeton, inscriptionId, 1000);
    await env.api("PUT", `/sessions/${s.corps.id}/presences`, o.jeton, { date: "2099-01-01", presents: [inscriptionId] });
    const c = await env.api("POST", `/inscriptions/${inscriptionId}/certificat`, o.jeton);
    expect(c.corps.erreur).toBe("session_non_terminee");
  });

  it("répartit les paiements sur les tranches dans l'ordre", () => {
    const r = repartir([{ montant: 20000 }, { montant: 50000 }, { montant: 50000 }], 30000);
    expect(r.map((e) => e.solde)).toEqual([0, 40000, 50000]);
  });
});

describe("encaissements", () => {
  it("refuse un trop perçu, une référence manquante ou déjà utilisée", async () => {
    const o = await preparer();
    const { inscriptionId } = await inscrire(o);
    const trop = await encaisser(o.jeton, inscriptionId, 120001);
    expect(trop.corps.erreur).toBe("montant_superieur_au_reste");
    expect((await encaisser(o.jeton, inscriptionId, 1000, "mtn_momo")).corps.erreur).toBe("reference_obligatoire");
    expect((await encaisser(o.jeton, inscriptionId, 1000, "mtn_momo", "REF1")).statut).toBe(201);
    const b = await inscrire(o, "Autre");
    expect((await encaisser(o.jeton, b.inscriptionId, 1000, "mtn_momo", "REF1")).corps.erreur).toBe("reference_deja_utilisee");
    expect((await encaisser(o.jeton, inscriptionId, -5)).statut).toBe(400);
    expect((await encaisser(o.jeton, inscriptionId, 1.5)).statut).toBe(400);
  });

  it("deux encaissements simultanés ne dépassent jamais le dû et les reçus ne se répètent pas", async () => {
    const o = await preparer();
    const { inscriptionId } = await inscrire(o);
    const r = await Promise.all(Array.from({ length: 10 }, () => encaisser(o.jeton, inscriptionId, 50000)));
    const acceptes = r.filter((x) => x.statut === 201);
    expect(acceptes).toHaveLength(2);
    expect(new Set(acceptes.map((x) => x.corps.numero_recu)).size).toBe(2);
    expect((await suivi(o)).totaux.paye).toBe(100000);
  });

  it("l'annulation exige un motif, rétablit le reste, et un reçu ne change jamais", async () => {
    const o = await preparer();
    const { inscriptionId } = await inscrire(o);
    const p = await encaisser(o.jeton, inscriptionId, 20000);
    const url = `/paiements/${p.corps.id}/annulation`;
    expect((await env.api("POST", url, o.jeton, {})).statut).toBe(400);
    expect((await env.api("POST", url, o.jeton, { motif: "Erreur de saisie" })).statut).toBe(200);
    expect((await env.api("POST", url, o.jeton, { motif: "Encore une fois" })).statut).toBe(409);
    expect((await suivi(o)).totaux.reste).toBe(120000);

    const suivant = await encaisser(o.jeton, inscriptionId, 20000);
    expect(suivant.corps.numero_recu).toMatch(/000002$/);

    await expect(dansOrganisation(env.poolApp, o.organisationId, (c) =>
      c.query("update paiements set montant = 1 where id = $1", [suivant.corps.id]),
    )).rejects.toThrow(/ne peut pas être modifié/);
    await expect(dansOrganisation(env.poolApp, o.organisationId, (c) =>
      c.query("delete from paiements"),
    )).rejects.toThrow(/permission denied/);
  });
});

describe("règles de session", () => {
  it("ne dépasse pas la capacité, même avec des inscriptions simultanées", async () => {
    const o = await preparer(5);
    const tiers = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      env.api("POST", "/tiers", o.jeton, { type: "personne", nom: `T${i}` })));
    const r = await Promise.all(tiers.map((t) =>
      env.api("POST", `/sessions/${o.sessionId}/inscriptions`, o.jeton, { tiersId: t.corps.id })));
    expect(r.filter((x) => x.statut === 201)).toHaveLength(5);
    expect(r.filter((x) => x.corps.erreur === "session_complete")).toHaveLength(7);
    expect((await suivi(o)).totaux.inscrits).toBe(5);
  });

  it("refuse une double inscription et donne le rôle apprenant une seule fois", async () => {
    const o = await preparer();
    const { tiersId } = await inscrire(o);
    expect((await env.api("POST", `/sessions/${o.sessionId}/inscriptions`, o.jeton, { tiersId })).statut).toBe(409);
    expect((await env.api("GET", `/tiers/${tiersId}`, o.jeton)).corps.roles).toEqual(["apprenant"]);
  });

  it("refuse le module inactif et une présence hors session", async () => {
    const o = await preparer();
    const { inscriptionId } = await inscrire(o);
    const url = `/sessions/${o.sessionId}/presences`;
    expect((await env.api("PUT", url, o.jeton, { date: "2026-12-01", presents: [] })).corps.erreur).toBe("date_hors_session");
    expect((await env.api("PUT", url, o.jeton, { date: "2026-10-09", presents: ["00000000-0000-4000-8000-000000000000"] })).corps.erreur).toBe("apprenant_hors_session");
    await env.api("PUT", `/entites/${o.entites.GTA}/modules/formations`, o.jeton, { actif: false });
    expect((await env.api("GET", `/sessions/${o.sessionId}/suivi`, o.jeton)).statut).toBe(403);
    await env.api("PUT", `/entites/${o.entites.GTA}/modules/formations`, o.jeton, { actif: true });
    expect((await suivi(o)).inscrits[0].id).toBe(inscriptionId);
    const glomari = await env.api("POST", "/programmes", o.jeton, {
      entiteId: o.entites.GLOMARI, code: "X", nom: "X", planPaiement: PLAN,
    });
    expect(glomari.statut).toBe(403);
  });
});

describe("modifications manuelles par l'administrateur", () => {
  const nouvelEcheancier = (montant: number) => ({
    motif: "Remise accordée par la direction",
    echeances: [{ libelle: "Solde négocié", montant, date_echeance: "2026-10-20" }],
  });

  it("change un échéancier individuel, sans passer sous ce qui est déjà payé, avec motif tracé", async () => {
    const o = await preparer();
    const a = await inscrire(o, "Avec remise");
    await inscrire(o, "Sans remise");
    await encaisser(o.jeton, a.inscriptionId, 30000);
    const url = `/inscriptions/${a.inscriptionId}/echeances`;
    expect((await env.api("PUT", url, o.jeton, nouvelEcheancier(10000))).corps.erreur).toBe("total_inferieur_au_paye");
    expect((await env.api("PUT", url, o.jeton, { echeances: nouvelEcheancier(90000).echeances })).statut).toBe(400);
    expect((await env.api("PUT", url, o.jeton, nouvelEcheancier(90000))).corps).toEqual({ total: 90000, paye: 30000, reste: 60000 });
    const s = await suivi(o);
    expect(s.inscrits.find((i: { nom: string }) => i.nom === "Avec remise").reste).toBe(60000);
    expect(s.inscrits.find((i: { nom: string }) => i.nom === "Sans remise").reste).toBe(120000);
    const audit = (await env.api("GET", "/audit?limite=20", o.jeton)).corps;
    expect(audit.find((l: { action: string }) => l.action === "echeancier.modifie").apres.motif).toBe("Remise accordée par la direction");
    expect((await env.api("GET", "/audit/verification", o.jeton)).corps.valide).toBe(true);
  });

  it("le nouveau tarif vaut pour les prochains inscrits, pas pour les anciens", async () => {
    const o = await preparer();
    await inscrire(o, "Ancien");
    const r = await env.api("PATCH", `/programmes/${o.programmeId}`, o.jeton, {
      seuilPresence: 50, planPaiement: [{ libelle: "Unique", montant: 90000, jours_apres_debut: 0 }],
    });
    expect(r.statut).toBe(200);
    expect(r.corps.seuil_presence).toBe(50);
    await inscrire(o, "Nouveau");
    const s = await suivi(o);
    expect(s.inscrits.find((i: { nom: string }) => i.nom === "Ancien").du).toBe(120000);
    expect(s.inscrits.find((i: { nom: string }) => i.nom === "Nouveau").du).toBe(90000);
  });

  it("modifie une session et garde les contrôles", async () => {
    const o = await preparer();
    await inscrire(o, "A");
    await inscrire(o, "B");
    const url = `/sessions/${o.sessionId}`;
    const r = await env.api("PATCH", url, o.jeton, { lieu: "Makepe", fin: "2026-11-30", statut: "en_cours" });
    expect(r.corps).toMatchObject({ lieu: "Makepe", fin: "2026-11-30", statut: "en_cours", ville: "Douala" });
    expect((await env.api("PATCH", url, o.jeton, { fin: "2020-01-01" })).corps.erreur).toBe("dates_invalides");
    expect((await env.api("PATCH", url, o.jeton, { capacite: 1 })).corps.erreur).toBe("capacite_inferieure_aux_inscrits");
    expect((await env.api("PATCH", url, o.jeton, { capacite: null })).statut).toBe(200);
  });

  it("délivre un certificat par exception, avec motif conservé", async () => {
    const o = await preparer();
    const { inscriptionId } = await inscrire(o);
    const url = `/inscriptions/${inscriptionId}/certificat`;
    expect((await env.api("POST", url, o.jeton, { derogation: "non" })).statut).toBe(400);
    const c = await env.api("POST", url, o.jeton, { derogation: "Validation par jury exceptionnel" });
    expect(c.statut).toBe(201);
    expect(c.corps.derogation_motif).toBe("Validation par jury exceptionnel");
    expect(c.corps.derogation_par).toBe(o.adminId);
    const v = await env.api("GET", `/verification/${c.corps.url_verification.split("?c=")[1]}`);
    expect(v.corps.valide).toBe(true);
    expect(JSON.stringify(v.corps)).not.toContain("jury");
  });

  it("réserve ces modifications à l'administrateur de l'entité", async () => {
    const o = await preparer();
    const { inscriptionId } = await inscrire(o);
    const roles = (await env.api("GET", "/roles", o.jeton)).corps;
    const creer = async (code: string, entiteId: string) => {
      const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
      await env.api("POST", "/utilisateurs", o.jeton, {
        email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((r: { code: string }) => r.code === code).id,
      });
      return env.connecter(o.slug, email);
    };
    const gestion = await creer("gestion_formation", o.entites.GTA!);
    const adminGlomari = await creer("administrateur", o.entites.GLOMARI!);
    for (const j of [gestion, adminGlomari]) {
      expect((await env.api("PUT", `/inscriptions/${inscriptionId}/echeances`, j, nouvelEcheancier(1000))).statut).toBe(403);
      expect((await env.api("PATCH", `/sessions/${o.sessionId}`, j, { lieu: "X" })).statut).toBe(403);
      expect((await env.api("PATCH", `/programmes/${o.programmeId}`, j, { seuilPresence: 0 })).statut).toBe(403);
      expect((await env.api("POST", `/inscriptions/${inscriptionId}/certificat`, j, { derogation: "Exception non permise" })).statut).toBe(403);
    }
    const autre = await preparer();
    expect((await env.api("PATCH", `/sessions/${o.sessionId}`, autre.jeton, { lieu: "X" })).statut).toBe(404);
    expect((await env.api("PUT", `/inscriptions/${inscriptionId}/echeances`, autre.jeton, nouvelEcheancier(1000))).statut).toBe(404);
  });
});

describe("droits et isolation des formations", () => {
  async function utilisateur(o: { jeton: string; slug: string }, code: string, entiteId?: string) {
    const roles = (await env.api("GET", "/roles", o.jeton)).corps;
    const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
    await env.api("POST", "/utilisateurs", o.jeton, {
      email, nom: code, motDePasse: MOT_DE_PASSE, entiteId,
      roleId: roles.find((r: { code: string }) => r.code === code).id,
    });
    return env.connecter(o.slug, email);
  }

  it("le formateur fait l'appel mais n'encaisse pas, la caisse encaisse mais n'annule pas", async () => {
    const o = await preparer();
    const { inscriptionId } = await inscrire(o);
    const formateur = await utilisateur(o, "formateur", o.entites.GTA);
    const caisse = await utilisateur(o, "caisse", o.entites.GTA);

    expect((await env.api("PUT", `/sessions/${o.sessionId}/presences`, formateur, { date: "2026-10-09", presents: [inscriptionId] })).statut).toBe(200);
    expect((await encaisser(formateur, inscriptionId, 1000)).statut).toBe(403);
    expect((await env.api("POST", `/inscriptions/${inscriptionId}/certificat`, formateur)).statut).toBe(403);

    const p = await encaisser(caisse, inscriptionId, 1000);
    expect(p.statut).toBe(201);
    expect((await env.api("POST", `/paiements/${p.corps.id}/annulation`, caisse, { motif: "Je veux annuler" })).statut).toBe(403);
    expect((await env.api("PUT", `/sessions/${o.sessionId}/presences`, caisse, { date: "2026-10-09", presents: [] })).statut).toBe(403);
  });

  it("un droit limité à GLOMARI ne donne aucun accès aux sessions de GTA", async () => {
    const o = await preparer();
    const autre = await utilisateur(o, "caisse", o.entites.GLOMARI);
    expect((await env.api("GET", "/sessions", autre)).statut).toBe(403);
    expect((await env.api("GET", `/sessions/${o.sessionId}/suivi`, autre)).statut).toBe(403);
  });

  it("un autre client ne voit rien et ne peut rien lier ou encaisser", async () => {
    const a = await preparer();
    const b = await preparer();
    const { inscriptionId, tiersId } = await inscrire(b);
    expect((await env.api("GET", `/sessions/${b.sessionId}/suivi`, a.jeton)).statut).toBe(404);
    expect((await encaisser(a.jeton, inscriptionId, 1000)).statut).toBe(404);
    expect((await env.api("POST", `/sessions/${a.sessionId}/inscriptions`, a.jeton, { tiersId })).statut).toBe(404);
    expect((await env.api("POST", `/sessions/${b.sessionId}/inscriptions`, a.jeton, { tiersId })).statut).toBe(404);
    expect((await env.api("GET", "/sessions", a.jeton)).corps.map((s: { id: string }) => s.id)).toEqual([a.sessionId]);
    // Les numéros de reçu de chaque client commencent à 1.
    const pa = await encaisser(a.jeton, (await inscrire(a)).inscriptionId, 1000);
    const pb = await encaisser(b.jeton, inscriptionId, 1000);
    expect(pa.corps.numero_recu).toBe(pb.corps.numero_recu);
  });

  it("un code de vérification valide pour un client ne fonctionne pas chez un autre", async () => {
    const a = await preparer();
    const b = await preparer();
    const { inscriptionId } = await inscrire(a);
    await encaisser(a.jeton, inscriptionId, 120000);
    await env.api("PUT", `/sessions/${a.sessionId}/presences`, a.jeton, { date: "2026-10-09", presents: [inscriptionId] });
    const c = await env.api("POST", `/inscriptions/${inscriptionId}/certificat`, a.jeton);
    const code = c.corps.url_verification.split("?c=")[1].split(".")[1];
    expect((await env.api("GET", `/verification/${b.organisationId}.${code}`)).statut).toBe(404);
    expect((await env.api("GET", "/verification/pas-un-code")).statut).toBe(404);
  });
});
