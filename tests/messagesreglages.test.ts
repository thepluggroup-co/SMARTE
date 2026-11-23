import { afterAll, describe, expect, it } from "vitest";
import { utilisateur } from "./canaloutils.js";
import { aDouala, environnementMessages, magasinMessages, type MM } from "./messagesoutils.js";

const env = await environnementMessages();
afterAll(env.fermer);

const colisManuel = async (b: MM, telephone = "677 00 00 05") =>
  (await b.api("POST", "/colis", { entiteId: b.G, destinataire: "Paul Eto", telephone })).corps.id as string;
const regler = (b: MM, type: string, actif: boolean, canal = "sms") => b.api("PUT", "/messages/reglages", { brancheId: b.G, type, actif, canal });
const ligneDe = async (b: MM, objetId: string, type = "colis_cree") => (await b.enBase(type)).filter((m) => m.objet_id === objetId);

describe("réglages et journal des messages", () => {
  it("coupe, réactive et change le canal d'un type de message (Q16)", async () => {
    const b = await magasinMessages(env);
    const r = (await b.api("GET", `/messages/reglages?brancheId=${b.G}`)).corps;
    expect(r).toMatchObject({ prestataire: "factice", heures: { debut: 7, fin: 21 } });
    expect(r.types).toHaveLength(12);
    expect(r.types.find((t: { type: string }) => t.type === "avis_magasin")).toMatchObject({ actif: false, canal: "sms", defaut: true });

    expect((await regler(b, "colis_cree", false)).statut).toBe(200);
    const coupe = await colisManuel(b);
    expect(await ligneDe(b, coupe)).toEqual([]);
    await regler(b, "colis_cree", true);
    b.vider();
    expect(await b.envoyer()).toBe(0);
    const actif = await colisManuel(b);
    expect(await b.envoyer()).toBe(1);
    expect((await ligneDe(b, actif))[0]).toMatchObject({ statut: "envoye", canal: "sms" });

    // Un message qui attend est annulé si son type est coupé avant l'envoi.
    const attente = await colisManuel(b);
    await regler(b, "colis_cree", false);
    expect(await b.envoyer()).toBe(0);
    expect((await ligneDe(b, attente))[0]).toMatchObject({ statut: "annule", erreur: "desactive" });

    await regler(b, "colis_cree", true, "whatsapp");
    b.vider();
    const wa = await colisManuel(b);
    expect(await b.envoyer()).toBe(1);
    expect(b.recus()[0]).toMatchObject({ canal: "whatsapp" });
    expect((await ligneDe(b, wa))[0]).toMatchObject({ statut: "envoye", canal: "whatsapp" });
    expect((await b.api("GET", `/messages/reglages?brancheId=${b.G}`)).corps.types.find((t: { type: string }) => t.type === "colis_cree"))
      .toMatchObject({ actif: true, canal: "whatsapp", defaut: false });
  });

  it("tente trois fois en une heure, puis permet un renvoi vers un numéro corrigé (Q17)", async () => {
    const b = await magasinMessages(env);
    const id = await colisManuel(b, "677 00 00 10");
    env.factice.enPanne = true;
    expect(await b.envoyer(aDouala(10, 1, 0))).toBe(0);
    expect((await ligneDe(b, id))[0]).toMatchObject({ statut: "en_attente", tentatives: 1, erreur: "prestataire" });
    await b.envoyer(aDouala(10, 1, 20));
    expect((await ligneDe(b, id))[0]).toMatchObject({ statut: "en_attente", tentatives: 2 });
    await b.envoyer(aDouala(10, 1, 40));
    const [rate] = await ligneDe(b, id);
    expect(rate).toMatchObject({ statut: "echec", tentatives: 3, erreur: "prestataire", numero_masque: "*******10" });
    b.vider();

    const renvoyer = (corps?: object, jeton = b.o.jeton) => env.api("POST", `/messages/${rate!.id}/renvoi`, jeton, corps);
    const magasinier = await utilisateur(env, b.o, "magasinier", b.lieu);
    expect((await renvoyer({}, magasinier)).statut).toBe(403);
    expect((await renvoyer({ telephone: "233 42 12 34" })).corps.erreur).toBe("numero_invalide");
    const r = await renvoyer({ telephone: "677 11 22 33" });
    expect(r.statut).toBe(201);
    expect((await b.colisDe(id)).telephone).toBe("237677112233");
    expect(await b.envoyer(aDouala(11, 1))).toBe(1);
    expect(b.recus()[0]).toMatchObject({ telephone: "237677112233" });
    const lignes = await ligneDe(b, id);
    expect(lignes.map((m) => [m.statut, m.renvoi_de])).toEqual([["echec", null], ["envoye", rate!.id]]);
    expect((await renvoyer()).corps.erreur).toBe("renvoi_impossible");
    expect((await env.api("POST", `/messages/${r.corps.id}/renvoi`, b.o.jeton)).corps.erreur).toBe("renvoi_impossible");
  });

  it("tient un journal sans numéro complet ni code, avec les totaux du mois (Q18)", async () => {
    const b = await magasinMessages(env);
    const w = await b.commandeLivraison();
    await b.etape(w.colisId, "en_livraison");
    b.vider();
    await b.envoyer();
    const code = (await b.colisDe(w.colisId)).code_confirmation as string;
    expect(b.recus().some((m) => m.texte.includes(code))).toBe(true);
    const j = (await b.journal()).corps;
    expect(j.messages).toHaveLength(2);
    for (const m of j.messages) {
      expect(m.numero_masque).toMatch(/^\*{7}[0-9]{2}$/);
      expect(m).not.toHaveProperty("texte");
      expect(m).not.toHaveProperty("telephone");
      for (const champ of ["numero_masque", "objet", "libelle", "erreur"]) expect(String(m[champ] ?? "")).not.toContain(code);
    }
    expect(JSON.stringify(j)).not.toContain("237699000001");
    expect(j.mois).toEqual(expect.arrayContaining([
      { type: "colis_cree", canal: "sms", envoyes: 1, echecs: 0, sans_numero: 0 },
      { type: "colis_en_livraison", canal: "sms", envoyes: 1, echecs: 0, sans_numero: 0 },
    ]));
    expect((await env.api("GET", `/messages?brancheId=${b.G}&type=colis_cree`, b.o.jeton)).corps.messages).toHaveLength(1);
    expect((await env.api("GET", `/messages?brancheId=${b.G}&statut=echec`, b.o.jeton)).corps.messages).toEqual([]);
  });

  it("réserve les réglages à la direction et n'ouvre rien à GTA ni à une autre organisation (Q19)", async () => {
    const b = await magasinMessages(env);
    const id = await colisManuel(b, "233 42 12 34");
    await b.envoyer();
    const [sans] = await ligneDe(b, id);
    expect(sans).toMatchObject({ statut: "sans_numero" });

    const care = await utilisateur(env, b.o, "care", b.G);
    expect((await b.journal(care)).statut).toBe(200);
    expect((await env.api("PUT", "/messages/reglages", care, { brancheId: b.G, type: "colis_cree", actif: false, canal: "sms" })).statut).toBe(403);
    expect((await env.api("POST", `/messages/${sans!.id}/renvoi`, care, { telephone: "677 00 00 11" })).statut).toBe(201);

    const gta = await utilisateur(env, b.o, "comptabilite", b.o.entites.GTA!);
    expect((await env.api("GET", `/messages/reglages?brancheId=${b.G}`, gta)).statut).toBe(403);
    expect((await b.journal(gta)).statut).toBe(403);
    expect((await env.api("GET", `/messages/reglages?brancheId=${b.o.entites.GTA}`, b.o.jeton)).corps.erreur).toBe("module_inactif");

    const ailleurs = await env.nouvelleOrganisation();
    expect((await env.api("POST", `/messages/${sans!.id}/renvoi`, ailleurs.jeton, {})).statut).toBe(404);
    expect((await env.api("GET", `/messages?brancheId=${b.G}`, ailleurs.jeton)).statut).toBe(403);
  });
});
