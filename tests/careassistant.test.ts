import { afterAll, describe, expect, it } from "vitest";
import { TEXTE_INDISPONIBLE, TEXTE_SANS_REPONSE } from "../src/care.js";
import { generateurClaude } from "../src/studio.js";
import { jour } from "./canaloutils.js";
import { boutiqueCare, environnementCare, iaEnPanne, reponseIa } from "./careoutils.js";

const env = await environnementCare();
afterAll(env.fermer);

describe("réponse immédiate de l'assistant", () => {
  it("confie à l'IA les seules informations permises, jamais un coût, une quantité ni un numéro (Q1)", async () => {
    const b = await boutiqueCare(env);
    const marque = (await b.api("POST", "/marques", { entiteId: b.G, nom: "Binatone" })).corps.id as string;
    const vent = (await b.api("POST", "/produits", {
      entiteId: b.G, code: "VENT16", nom: "Ventilateur Binatone 16 pouces", suiviStock: true, prixVente: 25000, tauxTaxe: 0, marqueId: marque,
    })).corps.id as string;
    await b.api("POST", "/stocks/mouvements", { entiteId: b.lieu, produitId: vent, type: "entree", quantite: 4321, coutUnitaire: 13579 });
    expect((await b.api("POST", "/promotions", { produitId: vent, nom: "Fin d'année", type: "montant", valeur: 2000, debut: jour(), fin: jour() })).statut).toBe(201);
    await b.article("RADIO", 5000, 0, 0);
    const frigo = await b.article("FRIGO", 300000, 0, 2);
    await b.sql("update produits set actif = false where id = $1", [frigo]);
    await b.reponseValidee("Livraison", "Livrez-vous à Bafoussam ?", "Nous livrons seulement à Douala pour le moment.");
    const ancienne = await b.reponseValidee("Retours", "Quel délai pour un retour ?", "Ancienne règle des retours sous trente jours.");
    expect((await b.api("PATCH", `/care/reponses/${ancienne}`, { actif: false })).statut).toBe(200);

    const r = await b.demander("Livrez-vous à Bafoussam ? Le ventilateur Binatone, la radio et le frigo sont-ils disponibles ? Mon numéro : 699 12 34 56");
    expect(r.statut).toBe(200);
    expect(r.corps).toMatchObject({
      conversation: expect.any(String), jeton: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), ticket: null, messages_restants: 29,
      message: { id: expect.any(String), reponse: "Réponse de test.", sans_reponse: false, propose_conseiller: false },
    });
    const consigne = b.derniereConsigne();
    expect(consigne).toContain("Nous livrons seulement à Douala pour le moment.");
    expect(consigne).not.toContain("Ancienne règle");
    expect(consigne).toContain("Akwa : 1000 FCFA, 1 jour(s)");
    expect(consigne).toContain("Relais Kotto (Carrefour Kotto)");
    expect(consigne).toMatch(/Ventilateur Binatone 16 pouces \(code VENT16, marque Binatone[^)]*\) : 23000 FCFA TTC, prix en promotion/);
    expect(consigne).toMatch(/Article RADIO[\s\S]*GLOMARI Mall Douala : non/);
    expect(consigne).toMatch(/Ventilateur[^\n]*\n {2}Disponibilité par lieu : GLOMARI Mall Douala : oui/);
    expect(consigne).not.toContain("Article FRIGO");
    expect(consigne).toContain("Client : non identifié");
    for (const interdit of ["4321", "13579", "699 12 34 56", "699123456"]) expect(consigne).not.toContain(interdit);
    expect(consigne).toContain("[numéro masqué]");
    const appel = env.ia.etat.appels.at(-1)!;
    expect(appel.reglages).toMatchObject({ delaiMs: 9000, systeme: expect.stringContaining("Ne promets et ne décide jamais un remboursement") });
    expect(appel.reglages!.systeme).toContain("reste poli");
    // Aucune connexion de l'application n'est retenue pendant que l'IA répond.
    expect(appel.connexions).toBe(0);
    const { rows: [v] } = await b.sqlAdmin("select jeton_hache, messages_visiteur, statut from conversations_care where id = $1", [r.corps.conversation]);
    expect(v).toEqual({ jeton_hache: expect.stringMatching(/^[0-9a-f]{64}$/), messages_visiteur: 1, statut: "ouverte" });
    expect(v!.jeton_hache).not.toContain(r.corps.jeton);

    // La question suivante porte le fil, numéros masqués.
    const suite = await b.demander("Et à Douala ?", { conversation: r.corps.conversation, jeton: r.corps.jeton });
    expect(suite.statut).toBe(200);
    expect(suite.corps.jeton).toBeUndefined();
    expect(suite.corps.messages_restants).toBe(28);
    const fil = b.derniereConsigne();
    expect(fil).toMatch(/Conversation récente :\nVisiteur : Livrez-vous à Bafoussam[^\n]*\[numéro masqué\]\nAssistant : Réponse de test\./);
    expect(fil).not.toContain("699 12 34 56");
    const relu = await b.appelCare("GET", `/conversations/${r.corps.conversation}?jeton=${r.corps.jeton}`);
    expect(relu.corps).toMatchObject({ statut: "ouverte", ticket: null });
    expect(relu.corps.messages.map((m: { role: string }) => m.role)).toEqual(["visiteur", "assistant", "visiteur", "assistant"]);
  });

  it("dit qu'il ne sait pas, propose un conseiller et note l'avis du visiteur (Q2)", async () => {
    const b = await boutiqueCare(env);
    env.ia.etat.file.push(reponseIa("Je ne sais pas répondre à cela.", { sans_reponse: true }));
    const r = await b.demander("Quelle est la garantie du climatiseur ?");
    expect(r.corps.message).toMatchObject({ reponse: "Je ne sais pas répondre à cela.", sans_reponse: true, propose_conseiller: true });
    const { rows: [m] } = await b.sqlAdmin("select sans_reponse, propose_conseiller from messages_care where id = $1", [r.corps.message.id]);
    expect(m).toEqual({ sans_reponse: true, propose_conseiller: true });

    const ok = await b.demander("Livrez-vous à Akwa ?", { conversation: r.corps.conversation, jeton: r.corps.jeton });
    const avis = (aide: boolean, message = ok.corps.message.id, jeton = r.corps.jeton) =>
      b.appelCare("POST", "/avis", { conversation: r.corps.conversation, jeton, message, aide });
    expect((await avis(false)).corps).toEqual({ propose_conseiller: true });
    expect((await b.sqlAdmin("select aide from messages_care where id = $1", [ok.corps.message.id])).rows[0]!.aide).toBe(false);
    expect((await avis(true)).corps).toEqual({ propose_conseiller: false });
    expect((await b.sqlAdmin("select aide from messages_care where id = $1", [ok.corps.message.id])).rows[0]!.aide).toBe(true);
    const { rows: [question] } = await b.sqlAdmin("select id from messages_care where conversation_id = $1 and role = 'visiteur' limit 1", [r.corps.conversation]);
    expect((await avis(true, question!.id)).statut).toBe(404);
    expect((await avis(true, ok.corps.message.id, "A".repeat(43))).statut).toBe(404);
  });

  it("répond par un texte de repli quand l'IA manque, tombe, tarde ou rend une sortie inutilisable (Q3)", async () => {
    const b = await boutiqueCare(env);
    const essai = async (sortie: unknown) => {
      env.ia.etat.file.push(sortie);
      const r = await b.demander("Livrez-vous à Akwa ?");
      expect(r.statut).toBe(200);
      return r.corps.message;
    };
    expect(await essai(iaEnPanne())).toMatchObject({ reponse: TEXTE_INDISPONIBLE, sans_reponse: false, propose_conseiller: true });
    expect(await essai("du texte")).toMatchObject({ reponse: TEXTE_SANS_REPONSE, sans_reponse: true, propose_conseiller: true });
    expect(await essai({ reponse: "Oui", sans_reponse: "non" })).toMatchObject({ reponse: TEXTE_SANS_REPONSE });
    expect(await essai(reponseIa("x".repeat(2001)))).toMatchObject({ reponse: TEXTE_SANS_REPONSE, sans_reponse: true });

    const sansIa = await environnementCare({ avecIa: false });
    try {
      const s = await boutiqueCare(sansIa);
      const r = await s.demander("Livrez-vous à Akwa ?");
      expect(r.statut).toBe(200);
      expect(r.corps.message).toMatchObject({ reponse: TEXTE_INDISPONIBLE, propose_conseiller: true });
    } finally {
      await sansIa.fermer();
    }

    // Le générateur réel abandonne au délai demandé, avec la consigne et la longueur demandées.
    let corps: Record<string, unknown> = {};
    const lent = generateurClaude("c", "m", (async (_u: string, i: RequestInit) => {
      corps = JSON.parse(String(i.body));
      return new Promise<Response>((_ok, refus) => i.signal!.addEventListener("abort", () => refus(new Error("abandon"))));
    }) as unknown as typeof fetch);
    await expect(lent("x", {}, { delaiMs: 30, systeme: "Rôle de test", maxJetons: 123 })).rejects.toMatchObject({ code: "ia_indisponible" });
    expect(corps).toMatchObject({ system: "Rôle de test", max_tokens: 123 });
  });

  it("refuse un message vide ou trop long, au-delà de 30 messages, au-delà du débit, hors de sa boutique (Q4)", async () => {
    const b = await boutiqueCare(env);
    const avant = env.ia.etat.appels.length;
    expect((await b.demander("   ")).corps).toEqual({ erreur: "message_vide" });
    expect(env.ia.etat.appels.length).toBe(avant);
    expect((await b.demander("a".repeat(1001))).corps.erreur).toBe("donnees_invalides");

    const r = await b.demander("Bonjour");
    const suite = { conversation: r.corps.conversation, jeton: r.corps.jeton };
    await b.sqlAdmin("update conversations_care set messages_visiteur = 29 where id = $1", [suite.conversation]);
    const trentieme = await b.demander("Dernière question", suite);
    expect(trentieme.corps).toMatchObject({ messages_restants: 0, message: { propose_conseiller: true } });
    expect((await b.demander("Encore une", suite)).corps).toEqual({ erreur: "conversation_pleine" });

    // Deux messages simultanés au 30e : un seul passe, l'autre est refusé proprement.
    const autre = await b.demander("Bonjour");
    const s2 = { conversation: autre.corps.conversation, jeton: autre.corps.jeton };
    await b.sqlAdmin("update conversations_care set messages_visiteur = 29 where id = $1", [s2.conversation]);
    const ensemble = await Promise.all([b.demander("Un", s2), b.demander("Deux", s2)]);
    expect(ensemble.map((x) => x.statut).sort()).toEqual([200, 409]);

    expect((await b.demander("Bonjour", { conversation: suite.conversation, jeton: "A".repeat(43) })).corps).toEqual({ erreur: "introuvable" });
    const ailleurs = await boutiqueCare(env);
    expect((await ailleurs.demander("Bonjour", s2)).statut).toBe(404);
    const sansBoutique = await env.nouvelleOrganisation();
    expect((await env.api("POST", `/marketplace/${sansBoutique.organisationId}/care/messages`, undefined, { texte: "Bonjour" })).statut).toBe(404);
    await ailleurs.api("POST", "/canal-config", { entiteId: ailleurs.G, actif: false });
    expect((await ailleurs.demander("Bonjour")).corps).toEqual({ erreur: "introuvable" });

    const limite = await environnementCare({ care: 2 });
    try {
      const l = await boutiqueCare(limite);
      expect((await l.demander("Un")).statut).toBe(200);
      expect((await l.demander("Deux")).statut).toBe(200);
      expect((await l.demander("Trois")).statut).toBe(429);
    } finally {
      await limite.fermer();
    }
  });
});
