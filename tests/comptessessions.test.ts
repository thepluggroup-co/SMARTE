import { afterAll, describe, expect, it } from "vitest";
import { comptes } from "./comptesoutils.js";
import { utilisateur } from "./canaloutils.js";
import { environnementMessages, magasinMessages } from "./messagesoutils.js";
import { environnement } from "./outils.js";

const env = await environnementMessages();
afterAll(env.fermer);

async function boutique() {
  const b = await magasinMessages(env);
  const fiche = (await b.api("POST", "/tiers", { type: "personne", nom: "Madame Ngo", telephone: "699 11 22 33", entiteId: b.G })).corps.id as string;
  return { ...b, fiche, ...comptes(env, b.org) };
}

describe("sessions des comptes clients", () => {
  it("déconnecte un appareil ou tous, refuse une session échue, et montre les appareils sur la fiche (Q11)", async () => {
    const b = await boutique();
    const [j1, j2] = [await b.connecter("699 11 22 33"), await b.connecter("699 11 22 33")];
    for (const j of [j1, j2]) expect((await b.appel("GET", "", j)).statut).toBe(200);
    expect((await b.api("GET", `/tiers/${b.fiche}`)).corps.compte_en_ligne).toMatchObject({ appareils: 2, derniere_connexion: expect.any(String) });
    expect((await b.appel("POST", "/deconnexion", j1, { tous: true })).corps).toEqual({ deconnecte: true, sessions: 2 });
    for (const j of [j1, j2]) expect((await b.appel("GET", "", j)).corps.erreur).toBe("session_invalide");

    const [j3, j4] = [await b.connecter("699 11 22 33"), await b.connecter("699 11 22 33")];
    expect((await b.appel("POST", "/deconnexion", j3)).corps).toEqual({ deconnecte: true, sessions: 1 });
    expect((await b.appel("GET", "", j3)).statut).toBe(401);
    expect((await b.appel("GET", "", j4)).statut).toBe(200);
    await b.sqlAdmin("update sessions_clients set cree_le = now() - interval '8 days', expire_le = now() - interval '1 day' where organisation_id = org_courante() and revoque_le is null");
    expect((await b.appel("GET", "", j4)).statut).toBe(401);
  });

  it("laisse l'équipe Care déconnecter tous les appareils, et tombe si la fiche change (Q11)", async () => {
    const b = await boutique();
    const j5 = await b.connecter("699 11 22 33");
    const care = await utilisateur(env, b.o, "care", b.G);
    const magasinier = await utilisateur(env, b.o, "magasinier", b.lieu);
    expect((await env.api("POST", `/tiers/${b.fiche}/comptes-en-ligne/deconnexion`, magasinier)).statut).toBe(403);
    expect((await env.api("POST", `/tiers/${b.fiche}/comptes-en-ligne/deconnexion`, care)).corps).toEqual({ sessions: 1 });
    expect((await b.appel("GET", "", j5)).statut).toBe(401);
    const idCare = (await env.api("GET", "/moi", care)).corps.id;
    const { rows } = await b.sqlAdmin("select revoque_par from sessions_clients where organisation_id = org_courante() and tiers_id = $1", [b.fiche]);
    expect(rows).toEqual([{ revoque_par: idCare }]);

    const j6 = await b.connecter("699 11 22 33");
    await b.api("PATCH", `/tiers/${b.fiche}`, { archive: true });
    expect((await b.appel("GET", "", j6)).statut).toBe(401);
    await b.api("PATCH", `/tiers/${b.fiche}`, { archive: false });

    const j7 = await b.connecter("699 11 22 33");
    expect((await b.api("PATCH", `/tiers/${b.fiche}`, { telephone: "699 99 99 99" })).statut).toBe(200);
    expect((await b.appel("GET", "", j7)).statut).toBe(401);

    // Une fiche fusionnée dans une autre perd ses appareils.
    const doublon = (await b.api("POST", "/tiers", { type: "personne", nom: "Ngo bis", telephone: "677 88 77 66", entiteId: b.G })).corps.id as string;
    const j8 = await b.connecter("677 88 77 66");
    expect((await b.api("POST", `/tiers/${b.fiche}/fusion`, { doublonId: doublon })).statut).toBe(200);
    expect((await b.appel("GET", "", j8)).statut).toBe(401);
  });

  it("donne le code d'essai au responsable technique, avec le prestataire factice seulement (Q12)", async () => {
    const b = await boutique();
    await b.demanderCode("699 55 44 33");
    const code = b.codeRecu("699 55 44 33");
    const lire = (jeton: string, numero = "699 55 44 33") => env.api("GET", `/messages/code-essai?telephone=${encodeURIComponent(numero)}`, jeton);
    expect((await lire(b.o.jeton)).corps).toEqual({ code, envoye_le: expect.any(String) });
    expect((await lire(b.o.jeton, "699 00 00 99")).statut).toBe(404);
    const care = await utilisateur(env, b.o, "care", b.G);
    expect((await lire(care)).statut).toBe(403);
    // Une autre organisation du même serveur ne lit pas ce code.
    const ailleurs = await env.nouvelleOrganisation();
    expect((await lire(ailleurs.jeton)).statut).toBe(404);

    const sans = await environnement();
    try {
      const o = await sans.nouvelleOrganisation();
      expect((await sans.api("GET", "/messages/code-essai?telephone=699554433", o.jeton)).statut).toBe(404);
    } finally {
      await sans.fermer();
    }
  });

  it("refuse le jeton d'une autre boutique, et ferme l'espace avec la boutique (Q13)", async () => {
    const b = await boutique();
    const jeton = await b.connecter("699 11 22 33");
    const ailleurs = await magasinMessages(env);
    expect((await comptes(env, ailleurs.org).appel("GET", "", jeton)).corps.erreur).toBe("session_invalide");
    await b.api("POST", "/canal-config", { entiteId: b.G, actif: false });
    expect((await b.appel("GET", "", jeton)).statut).toBe(404);
    expect((await b.demanderCode("699 11 22 33")).statut).toBe(404);
  });
});
