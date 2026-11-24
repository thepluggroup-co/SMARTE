import { afterAll, describe, expect, it } from "vitest";
import { utilisateur } from "./canaloutils.js";
import { boutiqueCare, environnementCare, reponseIa } from "./careoutils.js";

const env = await environnementCare();
afterAll(env.fermer);

describe("relais vers un conseiller", () => {
  it("ouvre un ticket de la branche pour un visiteur sans compte, sur la fiche de son numéro (Q8)", async () => {
    const b = await boutiqueCare(env);
    const r = await b.demander("Quelle garantie pour le climatiseur ?");
    const { conversation, jeton } = r.corps;
    expect((await b.conseiller(conversation, jeton, { nom: "Paul Eto" })).corps).toEqual({ erreur: "telephone_invalide" });
    expect((await b.conseiller(conversation, jeton, { nom: "P", telephone: "699 44 55 66" })).corps).toEqual({ erreur: "donnees_invalides" });
    expect((await b.conseiller(conversation, "A".repeat(43), { nom: "Paul Eto", telephone: "699 44 55 66" })).statut).toBe(404);

    const t = await b.conseiller(conversation, jeton, { nom: "Paul Eto", telephone: "699 44 55 66" });
    expect(t.statut).toBe(201);
    expect(t.corps).toEqual({ ticket: expect.stringMatching(/^TIC-[0-9]{4}-[0-9]{6}$/), priorite: "normale" });
    const { rows: [k] } = await b.sqlAdmin(
      `select k.entite_id, k.canal, k.priorite, k.sujet, k.statut, t.nom, t.telephone, t.branche_id, round(extract(epoch from k.echeance - k.cree_le) / 3600)::int as heures
       from tickets k join tiers t on t.id = k.tiers_id where k.numero = $1`, [t.corps.ticket],
    );
    expect(k).toEqual({
      entite_id: b.G, canal: "site", priorite: "normale", sujet: "Assistant Care : Quelle garantie pour le climatiseur ?", statut: "ouvert",
      nom: "Paul Eto", telephone: "237699445566", branche_id: b.G, heures: 24,
    });
    const { rows: [v] } = await b.sqlAdmin("select v.statut, k.numero from conversations_care v join tickets k on k.id = v.ticket_id where v.id = $1", [conversation]);
    expect(v).toEqual({ statut: "transmise", numero: t.corps.ticket });
    expect((await b.sqlAdmin("select count(*)::int as n from journal_audit where organisation_id = org_courante() and action = 'care.relais'")).rows[0]!.n).toBe(1);
    // L'assistant continue de répondre et rappelle le numéro.
    expect((await b.demander("Merci, à demain", { conversation, jeton })).corps.ticket).toBe(t.corps.ticket);

    // Un numéro déjà connu dans la branche rend la fiche existante.
    const connu = (await b.api("POST", "/tiers", { type: "personne", nom: "Madame Ngo", telephone: "699 77 88 99", entiteId: b.G })).corps.id as string;
    const autre = await b.demander("Je voudrais parler à quelqu'un");
    const t2 = await b.conseiller(autre.corps.conversation, autre.corps.jeton, { nom: "Mme Ngo", telephone: "699 77 88 99" });
    expect((await b.sqlAdmin("select tiers_id from tickets where numero = $1", [t2.corps.ticket])).rows[0]!.tiers_id).toBe(connu);
  });

  it("met en priorité haute un remboursement ou un litige, sur la fiche du client connecté, sans doublon (Q9)", async () => {
    const b = await boutiqueCare(env);
    const jeton = await b.connecter("699 11 22 33", "Madame Ngo");
    const r = await b.demander("Je veux un remboursement", { client: jeton });
    const t = await b.conseiller(r.corps.conversation, r.corps.jeton, { client: jeton });
    expect(t).toEqual({ statut: 201, corps: { ticket: expect.any(String), priorite: "haute" } });
    const { rows: [k] } = await b.sqlAdmin(
      "select t.telephone, round(extract(epoch from k.echeance - k.cree_le) / 3600)::int as heures from tickets k join tiers t on t.id = k.tiers_id where k.numero = $1", [t.corps.ticket],
    );
    expect(k).toEqual({ telephone: "237699112233", heures: 4 });
    const encore = await b.conseiller(r.corps.conversation, r.corps.jeton, { client: jeton });
    expect(encore).toEqual({ statut: 200, corps: { ticket: t.corps.ticket, priorite: "haute" } });
    expect((await b.sqlAdmin("select count(*)::int as n from tickets where entite_id = $1 and sujet like 'Assistant Care :%'", [b.G])).rows[0]!.n).toBe(1);

    // Un litige reconnu par l'IA donne aussi la priorité haute.
    env.ia.etat.file.push(reponseIa("Je transmets votre réclamation à un conseiller.", { propose_conseiller: true, motif: "litige" }));
    const l = await b.demander("Mon colis est arrivé vide !", { client: jeton });
    expect(l.corps.message.propose_conseiller).toBe(true);
    expect((await b.conseiller(l.corps.conversation, l.corps.jeton, { client: jeton })).corps.priorite).toBe("haute");
  });

  it("montre la conversation dans le ticket, et la conversation suit la fiche gardée à la fusion (Q10)", async () => {
    const b = await boutiqueCare(env);
    const r = await b.demander("Quelle garantie pour le climatiseur ?");
    await b.demander("Et pour le ventilateur ?", { conversation: r.corps.conversation, jeton: r.corps.jeton });
    const t = await b.conseiller(r.corps.conversation, r.corps.jeton, { nom: "Paul Eto", telephone: "699 44 55 66" });
    const ticketId = (await b.sqlAdmin("select id from tickets where numero = $1", [t.corps.ticket])).rows[0]!.id as string;

    const service = await utilisateur(env, b.o, "service_client", b.G);
    const d = await env.api("GET", `/tickets/${ticketId}`, service);
    expect(d.statut).toBe(200);
    expect(d.corps.conversation.map((m: { role: string; contenu: string }) => [m.role, m.contenu])).toEqual([
      ["visiteur", "Quelle garantie pour le climatiseur ?"], ["assistant", "Réponse de test."],
      ["visiteur", "Et pour le ventilateur ?"], ["assistant", "Réponse de test."],
    ]);
    const manuel = await b.api("POST", "/tickets", { entiteId: b.G, tiersId: d.corps.tiers_id, sujet: "Appel", message: "Rappeler le client" });
    expect((await b.api("GET", `/tickets/${manuel.corps.id}`)).corps.conversation).toBeUndefined();

    const garde = (await b.api("POST", "/tiers", { type: "personne", nom: "Paul Eto (fiche gardée)", telephone: "699 00 99 88", entiteId: b.G })).corps.id as string;
    expect((await b.api("POST", `/tiers/${garde}/fusion`, { doublonId: d.corps.tiers_id })).statut).toBe(200);
    expect((await b.sqlAdmin("select tiers_id from conversations_care where id = $1", [r.corps.conversation])).rows[0]!.tiers_id).toBe(garde);
  });
});
