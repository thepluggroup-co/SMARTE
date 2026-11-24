import { afterAll, describe, expect, it } from "vitest";
import { comptes } from "./comptesoutils.js";
import { commander, corpsCommande } from "./canaloutils.js";
import { environnementMessages, magasinMessages } from "./messagesoutils.js";

const env = await environnementMessages();
afterAll(env.fermer);

/** Une boutique, un client connu au 699 11 22 33. */
async function boutique() {
  const b = await magasinMessages(env);
  const connu = (await b.api("POST", "/tiers", { type: "personne", nom: "Madame Ngo", telephone: "699 11 22 33", entiteId: b.G })).corps.id as string;
  return { ...b, connu, ...comptes(env, b.org) };
}
const autreCode = (code: string) => (code === "000000" ? "111111" : "000000");

describe("connexion par téléphone et code SMS", () => {
  it("envoie un code à six chiffres, avec la même réponse pour un numéro connu ou inconnu, sans le garder en clair (Q1)", async () => {
    const b = await boutique();
    b.vider();
    const connu = await b.demanderCode("699 11 22 33");
    const inconnu = await b.demanderCode("699 55 66 77");
    expect(connu).toEqual({ statut: 200, corps: { envoye: true, valable_minutes: 10 } });
    expect(inconnu).toEqual(connu);
    expect(b.recus().map((m) => [m.canal, m.telephone])).toEqual([["sms", "237699112233"], ["sms", "237699556677"]]);
    const code = b.codeRecu("699 11 22 33")!;
    expect(code).toMatch(/^[0-9]{6}$/);
    const { rows } = await b.sqlAdmin("select code_hache, envoi from codes_connexion where organisation_id = org_courante() and telephone = '237699112233'");
    expect(rows).toEqual([{ code_hache: expect.stringMatching(/^[0-9a-f]{64}$/), envoi: "envoye" }]);
    expect(rows[0]!.code_hache).not.toContain(code);
  });

  it("connecte au bon code, une seule fois, après un essai faux (Q2)", async () => {
    const b = await boutique();
    await b.demanderCode("699 11 22 33");
    const code = b.codeRecu("699 11 22 33")!;
    expect((await b.saisir("699 11 22 33", autreCode(code))).corps).toEqual({ erreur: "code_incorrect", details: { essais_restants: 4 } });
    const r = await b.saisir("699 11 22 33", code);
    expect(r.statut).toBe(200);
    expect(r.corps).toMatchObject({ jeton: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), client: { nom: "Madame Ngo", telephone: "237699112233", email: null } });
    const jours = (new Date(r.corps.expire_le).getTime() - Date.now()) / 86_400_000;
    expect(jours).toBeGreaterThan(6.9);
    expect(jours).toBeLessThan(7.1);
    expect((await b.saisir("699 11 22 33", code)).corps.erreur).toBe("code_expire");
    expect((await b.appel("GET", "", r.corps.jeton)).corps).toMatchObject({ client: { nom: "Madame Ngo" } });
    expect((await b.appel("GET", "")).statut).toBe(401);
    expect((await env.api("GET", `/marketplace/${b.org}/compte`, b.o.jeton)).statut).toBe(401);
  });

  it("invalide le code après cinq essais faux (Q3)", async () => {
    const b = await boutique();
    await b.demanderCode("699 11 22 33");
    const code = b.codeRecu("699 11 22 33")!;
    for (let i = 4; i >= 0; i -= 1) {
      expect((await b.saisir("699 11 22 33", autreCode(code))).corps).toEqual({ erreur: "code_incorrect", details: { essais_restants: i } });
    }
    expect((await b.saisir("699 11 22 33", code)).corps.erreur).toBe("code_expire");
    const { rows } = await b.sqlAdmin("select count(*)::int as n from journal_audit where organisation_id = org_courante() and action = 'compte_client.blocage'");
    expect(rows[0]!.n).toBe(1);
  });

  it("limite les demandes par numéro, et un nouveau code invalide l'ancien (Q4)", async () => {
    const b = await boutique();
    expect((await b.demanderCode("699 11 22 33")).statut).toBe(200);
    const premier = b.codeRecu("699 11 22 33")!;
    const trop = await b.demanderCode("699 11 22 33");
    expect(trop.corps.erreur).toBe("code_trop_tot");
    expect(trop.corps.details.attendre_secondes).toBeGreaterThan(0);
    expect(trop.corps.details.attendre_secondes).toBeLessThanOrEqual(60);

    // Trois codes par quart d'heure au plus.
    await b.reculerCodes("699 11 22 33", 2);
    expect((await b.demanderCode("699 11 22 33")).statut).toBe(200);
    await b.reculerCodes("699 11 22 33", 2);
    expect((await b.demanderCode("699 11 22 33")).statut).toBe(200);
    const troisieme = b.codeRecu("699 11 22 33")!;
    await b.reculerCodes("699 11 22 33", 2);
    const quart = await b.demanderCode("699 11 22 33");
    expect(quart.corps.erreur).toBe("code_trop_tot");
    expect(quart.corps.details.attendre_secondes).toBeGreaterThan(60);

    // Dix codes par 24 heures au plus, d'où que viennent les demandes.
    await b.reculerCodes("699 11 22 33", 60);
    await b.sqlAdmin(
      `insert into codes_connexion (organisation_id, branche_id, telephone, code_hache, expire_le, cree_le, invalide_le)
       select org_courante(), $1, '237699112233', md5(g::text) || md5(g::text), now() - interval '5 hours', now() - interval '5 hours', now() - interval '5 hours'
       from generate_series(1, 7) g`,
      [b.G],
    );
    const jour = await b.demanderCode("699 11 22 33");
    expect(jour.corps.erreur).toBe("code_trop_tot");
    expect(jour.corps.details.attendre_secondes).toBeGreaterThan(3600);

    // Seul le dernier code vaut ; les précédents sont invalidés.
    const { rows } = await b.sqlAdmin(
      "select count(*) filter (where invalide_le is null)::int as valables from codes_connexion where organisation_id = org_courante() and telephone = '237699112233'",
    );
    expect(rows[0]!.valables).toBe(1);
    if (premier !== troisieme) expect((await b.saisir("699 11 22 33", premier)).corps.erreur).toBe("code_incorrect");
  });

  it("crée la fiche d'un numéro inconnu après le code et son nom, retrouvée ensuite par la commande en ligne (Q5)", async () => {
    const b = await boutique();
    await b.demanderCode("699 55 66 77");
    const code = b.codeRecu("699 55 66 77")!;
    expect((await b.saisir("699 55 66 77", code)).corps.erreur).toBe("nom_requis");
    const r = await b.saisir("699 55 66 77", code, "Awa Ngono");
    expect(r.statut).toBe(200);
    expect(r.corps.client).toEqual({ nom: "Awa Ngono", telephone: "237699556677", email: null });
    const { rows } = await b.sql("select id, nom, roles from tiers where telephone = '237699556677' and branche_id = $1", [b.G]);
    expect(rows).toEqual([{ id: expect.any(String), nom: "Awa Ngono", roles: ["client"] }]);
    const w = await commander(env, b.org, corpsCommande(b, [{ produitId: b.produit, quantite: 1 }], { telephone: "699 55 66 77", nomClient: "Awa" }));
    expect((await b.commandeDe(w.corps.reference)).tiers_id).toBe(rows[0]!.id);
  });

  it("refuse un numéro fixe, compte un SMS raté, et limite le débit de la boutique (Q6)", async () => {
    const b = await boutique();
    b.vider();
    expect((await b.demanderCode("233 42 12 34")).corps.erreur).toBe("numero_invalide");
    expect(b.recus()).toEqual([]);
    env.factice.enPanne = true;
    expect((await b.demanderCode("699 11 22 33")).corps.erreur).toBe("sms_indisponible");
    env.factice.enPanne = false;
    const { rows } = await b.sqlAdmin("select envoi from codes_connexion where organisation_id = org_courante() and telephone = '237699112233'");
    expect(rows).toEqual([{ envoi: "echec" }]);
    expect((await b.demanderCode("699 11 22 33")).corps.erreur).toBe("code_trop_tot");

    const limite = await environnementMessages({ codes: 2 });
    try {
      const l = await magasinMessages(limite);
      const c = comptes(limite, l.org);
      expect((await c.demanderCode("699 00 00 21")).statut).toBe(200);
      expect((await c.demanderCode("699 00 00 22")).statut).toBe(200);
      expect((await c.demanderCode("699 00 00 23")).statut).toBe(429);
    } finally {
      await limite.fermer();
    }
  });
});
