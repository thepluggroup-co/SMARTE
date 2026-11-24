import { afterAll, describe, expect, it } from "vitest";
import { utilisateur } from "./canaloutils.js";
import { boutiqueCare, environnementCare, reponseIa, type BC } from "./careoutils.js";

const env = await environnementCare();
afterAll(env.fermer);

const reculer = (b: BC, conversation: string, intervalle: string) =>
  b.sqlAdmin(`update conversations_care set derniere_activite = now() - interval '${intervalle}' where id = $1`, [conversation]);

describe("base de réponses, conversations et indicateur de l'équipe Care", () => {
  it("crée, modifie et désactive une réponse validée, que l'assistant suit dès la question suivante (Q11)", async () => {
    const b = await boutiqueCare(env);
    const id = await b.reponseValidee("Livraison", "Quels délais de livraison ?", "Livraison en 24 heures à Douala.");
    await b.demander("Quels délais de livraison ?");
    expect(b.derniereConsigne()).toContain("[Livraison] Question : Quels délais de livraison ? Réponse : Livraison en 24 heures à Douala.");

    const m = await b.api("PATCH", `/care/reponses/${id}`, { reponse: "Livraison en 48 heures à Douala." });
    expect(m.corps).toMatchObject({ reponse: "Livraison en 48 heures à Douala.", actif: true, modifie_par: "Admin" });
    await b.demander("Quels délais de livraison ?");
    expect(b.derniereConsigne()).toContain("Livraison en 48 heures à Douala.");
    expect(b.derniereConsigne()).not.toContain("24 heures");
    expect((await b.api("PATCH", `/care/reponses/${id}`, { actif: false })).corps.actif).toBe(false);
    await b.demander("Quels délais de livraison ?");
    expect(b.derniereConsigne()).not.toContain("48 heures");
    expect((await b.api("GET", `/care/reponses?branche=${b.G}`)).corps).toMatchObject({ actives: 0, plafond: 100, reponses: [{ id, actif: false }] });

    for (const corps of [{ sujet: "  ", question: "Question ?", reponse: "Réponse." }, { sujet: "S", question: "ab", reponse: "Réponse." }, { sujet: "S", question: "Question ?", reponse: "x".repeat(2001) }]) {
      expect((await b.api("POST", "/care/reponses", { branche: b.G, ...corps })).corps.erreur).toBe("donnees_invalides");
    }
    expect((await b.api("PATCH", `/care/reponses/${id}`, {})).corps.erreur).toBe("donnees_invalides");
    expect((await b.api("PATCH", `/care/reponses/${id}`, { telephone: "699" })).corps.erreur).toBe("donnees_invalides");

    const marketing = await utilisateur(env, b.o, "marketing", b.G);
    expect((await env.api("POST", "/care/reponses", marketing, { branche: b.G, sujet: "S", question: "Question ?", reponse: "Réponse." })).statut).toBe(403);
    const care = await utilisateur(env, b.o, "care", b.G);
    expect((await env.api("POST", "/care/reponses", care, { branche: b.G, sujet: "Retours", question: "Puis-je retourner ?", reponse: "Sous 7 jours." })).statut).toBe(201);
    expect([403, 409]).toContain((await b.api("POST", "/care/reponses", { branche: b.o.entites.GTA, sujet: "S", question: "Question ?", reponse: "Réponse." })).statut);
    expect((await b.api("GET", "/care/reponses?branche=00000000-0000-4000-8000-000000000000")).statut).toBe(404);
  });

  it("compte les conversations closes sans conseiller, transmises et ouvertes, les avis et les questions sans réponse (Q12)", async () => {
    const b = await boutiqueCare(env);
    const close = await b.demander("Livrez-vous à Akwa ?");
    await b.appelCare("POST", "/avis", { conversation: close.corps.conversation, jeton: close.corps.jeton, message: close.corps.message.id, aide: true });
    await reculer(b, close.corps.conversation, "31 minutes");
    await env.app.executerTaches(b.org);
    expect((await b.sqlAdmin("select statut, close_le is not null as datee from conversations_care where id = $1", [close.corps.conversation])).rows[0])
      .toEqual({ statut: "close", datee: true });

    const transmise = await b.demander("Mon colis est en retard");
    await b.appelCare("POST", "/avis", { conversation: transmise.corps.conversation, jeton: transmise.corps.jeton, message: transmise.corps.message.id, aide: false });
    await b.conseiller(transmise.corps.conversation, transmise.corps.jeton, { nom: "Paul Eto", telephone: "699 44 55 66" });
    env.ia.etat.file.push(reponseIa("Je ne sais pas.", { sans_reponse: true }));
    const ouverte = await b.demander("Quelle est la garantie du climatiseur ?");
    const tardive = await b.demander("Avez-vous des fers à repasser ?");
    await reculer(b, tardive.corps.conversation, "31 minutes");

    const i = await b.api("GET", `/care/indicateur?branche=${b.G}`);
    expect(i.statut).toBe(200);
    expect(i.corps).toMatchObject({
      conversations: 4, closes_sans_conseiller: 2, transmises: 1, ouvertes: 1, part_sans_conseiller: 66.7, part_transmises: 33.3,
      avis: { aide: 1, pas_aide: 1 },
      sans_reponse: [{ question: "Quelle est la garantie du climatiseur ?", conversation: ouverte.corps.conversation }],
    });
    // L'ouverture de l'indicateur a fermé la conversation restée sans message.
    expect((await b.sqlAdmin("select statut from conversations_care where id = $1", [tardive.corps.conversation])).rows[0]!.statut).toBe("close");

    const liste = await b.api("GET", `/care/conversations?branche=${b.G}&sans_reponse=true`);
    expect(liste.corps.map((v: { id: string }) => v.id)).toEqual([ouverte.corps.conversation]);
    expect((await b.api("GET", `/care/indicateur?branche=${b.G}&du=2024-01-01`)).corps.erreur).toBe("periode_invalide");
    expect((await b.api("GET", `/care/indicateur?branche=${b.G}&du=2026-02-10&au=2026-02-01`)).corps.erreur).toBe("periode_invalide");
    expect((await b.api("GET", `/care/indicateur?branche=${b.G}&du=2026-02-30`)).corps.erreur).toBe("periode_invalide");
  });

  it("montre nom et téléphone seulement à qui voit les fiches, efface à 12 mois et à l'anonymisation (Q13)", async () => {
    const b = await boutiqueCare(env);
    const t = await b.demander("Quelle garantie pour le climatiseur ?");
    await b.conseiller(t.corps.conversation, t.corps.jeton, { nom: "Paul Eto", telephone: "699 44 55 66" });
    const libre = await b.demander("Livrez-vous à Akwa ?");

    // Un conseiller Care sans le droit de voir les fiches.
    await b.sqlAdmin("delete from role_permissions where organisation_id = org_courante() and permission = 'tiers.voir' and role_id = (select id from roles where code = 'care' and organisation_id = org_courante())");
    const care = await utilisateur(env, b.o, "care", b.G);
    const sansFiche = await env.api("GET", `/care/conversations/${t.corps.conversation}`, care);
    expect(sansFiche.statut).toBe(200);
    expect(sansFiche.corps.client).toBeUndefined();
    expect(sansFiche.corps.messages.length).toBe(2);
    expect((await b.api("GET", `/care/conversations/${t.corps.conversation}`)).corps.client).toMatchObject({ nom: "Paul Eto", telephone: "237699445566" });

    const service = await utilisateur(env, b.o, "service_client", b.G);
    expect((await env.api("GET", `/care/conversations/${t.corps.conversation}`, service)).statut).toBe(200);
    expect((await env.api("GET", `/care/conversations/${libre.corps.conversation}`, service)).statut).toBe(403);
    expect((await env.api("GET", `/care/conversations?branche=${b.G}`, service)).corps.map((v: { id: string }) => v.id)).toEqual([t.corps.conversation]);
    expect((await env.api("GET", `/care/indicateur?branche=${b.G}`, service)).statut).toBe(403);

    // Anonymisation : le texte s'efface, l'indicateur ne change pas.
    const avant = (await b.api("GET", `/care/indicateur?branche=${b.G}`)).corps;
    const tiersId = (await b.sqlAdmin("select tiers_id from conversations_care where id = $1", [t.corps.conversation])).rows[0]!.tiers_id as string;
    expect((await b.api("POST", `/tiers/${tiersId}/anonymisation`, { motif: "Demande de la cliente" })).statut).toBe(200);
    expect((await b.sqlAdmin("select distinct contenu from messages_care where conversation_id = $1", [t.corps.conversation])).rows).toEqual([{ contenu: "Message effacé" }]);
    expect((await b.api("GET", `/care/indicateur?branche=${b.G}`)).corps).toEqual(avant);

    // Purge à 12 mois : la conversation transmise reste avec son ticket.
    await reculer(b, t.corps.conversation, "13 months");
    await reculer(b, libre.corps.conversation, "13 months");
    await env.app.executerTaches(b.org);
    expect((await b.sqlAdmin("select id from conversations_care where id = any($1::uuid[])", [[t.corps.conversation, libre.corps.conversation]])).rows)
      .toEqual([{ id: t.corps.conversation }]);
    expect((await b.sqlAdmin("select count(*)::int as n from messages_care where conversation_id = $1", [libre.corps.conversation])).rows[0]!.n).toBe(0);
  });
});
