import { afterAll, describe, expect, it } from "vitest";
import { aDouala, environnementMessages, magasinMessages, type MM } from "./messagesoutils.js";

const env = await environnementMessages();
afterAll(env.fermer);

const colisManuel = async (b: MM, telephone?: string) =>
  (await b.api("POST", "/colis", { entiteId: b.G, destinataire: "Paul Eto", adresse: "Akwa", ...(telephone ? { telephone } : {}) })).corps.id as string;

describe("messages du suivi des colis", () => {
  it("envoie le lien de suivi à la création du colis, une seule fois, avec un numéro masqué au journal (Q1)", async () => {
    const b = await magasinMessages(env);
    b.vider();
    const w = await b.commandePayee();
    const k = await b.colisDe(w.colisId);
    expect(await b.envoyer()).toBe(1);
    expect(b.recus()).toEqual([expect.objectContaining({ canal: "sms", telephone: "237699000001" })]);
    expect(b.recus()[0]!.texte).toContain(`/suivi.html?c=${b.org}.${k.code_suivi}`);
    expect(b.recus()[0]!.texte).toMatch(/^GLOMARI : /);
    const j = (await b.journal()).corps;
    expect(j.messages).toEqual([expect.objectContaining({ type: "colis_cree", statut: "envoye", canal: "sms", numero_masque: "*******01", objet: k.numero, tentatives: 1 })]);
    expect(await b.envoyer()).toBe(0);
  });

  it("donne le code et le montant à préparer au passage en livraison (Q2)", async () => {
    const b = await magasinMessages(env);
    const w = await b.commandeLivraison();
    await b.envoyer();
    b.vider();
    const k = await b.colisDe(w.colisId);
    expect(Number(k.a_encaisser)).toBe(25000);
    expect((await b.etape(w.colisId, "en_livraison")).statut).toBe(200);
    expect(await b.envoyer()).toBe(1);
    const texte = b.recus()[0]!.texte;
    expect(texte).toContain(`Code à donner au livreur : ${k.code_confirmation}`);
    expect(texte).toContain("25 000 FCFA");
  });

  it("prévient qu'un colis en point relais est prêt à retirer, sans renvoyer le code ensuite ; rien pour une livraison à domicile (Q3)", async () => {
    const b = await magasinMessages(env);
    const w = await b.commandeLivraison({ modeLivraison: "point_relais", pointRelaisId: b.relaisId, zoneId: undefined, adresse: undefined });
    const k = await b.colisDe(w.colisId);
    await b.etape(w.colisId, "expedie");
    await b.etape(w.colisId, "arrive");
    b.vider();
    expect(await b.envoyer()).toBe(2);
    const pret = b.recus().find((m) => m.texte.includes("prêt à retirer"))!;
    expect(pret.texte).toContain(`Code à donner au retrait : ${k.code_confirmation}`);
    expect(pret.texte).toContain("24 000 FCFA");
    b.vider();
    await b.etape(w.colisId, "en_livraison");
    expect(await b.envoyer()).toBe(0);
    expect((await b.enBase("colis_en_livraison")).find((m) => m.objet_id === w.colisId)).toMatchObject({ statut: "annule", erreur: "sans_objet" });
    await b.livrer(w.colisId);
    expect(await b.envoyer()).toBe(1);
    expect(b.recus()[0]!.texte).toContain("a été livré");

    // Un colis livré à domicile peut passer par un dépôt (« arrivé ») : pas de « prêt à retirer ».
    const domicile = await colisManuel(b, "677 00 00 02");
    await b.etape(domicile, "expedie");
    await b.etape(domicile, "arrive");
    expect((await b.enBase("colis_pret_retrait")).filter((m) => m.objet_id === domicile)).toEqual([]);
  });

  it("n'envoie qu'un message par étape, même répétée (Q4)", async () => {
    const b = await magasinMessages(env);
    const w = await b.commandeLivraison();
    await b.etape(w.colisId, "en_livraison");
    await b.envoyer();
    await b.etape(w.colisId, "echec", "Client absent");
    await b.etape(w.colisId, "en_livraison");
    b.vider();
    expect(await b.envoyer()).toBe(0);
    expect(await b.envoyer()).toBe(0);
    expect((await b.enBase("colis_en_livraison")).filter((m) => m.objet_id === w.colisId)).toHaveLength(1);
  });

  it("n'envoie rien sans numéro mobile camerounais (Q5)", async () => {
    const b = await magasinMessages(env);
    const sans = await colisManuel(b);
    const fixe = await colisManuel(b, "233 42 12 34");
    b.vider();
    expect(await b.envoyer()).toBe(0);
    const lignes = await b.enBase("colis_cree");
    for (const id of [sans, fixe]) {
      expect(lignes.find((m) => m.objet_id === id)).toMatchObject({ statut: "sans_numero", erreur: "sans_numero", numero_masque: null });
    }
    expect(b.recus()).toEqual([]);
  });

  it("n'envoie rien la nuit : le message attend 7 h (Q6)", async () => {
    const b = await magasinMessages(env);
    const id = await colisManuel(b, "677 00 00 03");
    b.vider();
    expect(await b.envoyer(aDouala(23))).toBe(0);
    expect(await b.envoyer(aDouala(6, 2, 59))).toBe(0);
    expect((await b.enBase("colis_cree")).find((m) => m.objet_id === id)).toMatchObject({ statut: "en_attente", tentatives: 0 });
    expect(await b.envoyer(aDouala(7, 2))).toBe(1);
    expect(b.recus()[0]).toMatchObject({ telephone: "237677000003" });
  });
});
