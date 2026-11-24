import { afterAll, describe, expect, it } from "vitest";
import { comptes } from "./comptesoutils.js";
import { environnementMessages, magasinMessages } from "./messagesoutils.js";

const env = await environnementMessages();
afterAll(env.fermer);

describe("adresses et profil du compte client", () => {
  it("garde cinq adresses au plus, une seule par défaut, invisibles des autres clients (Q9)", async () => {
    const b = await magasinMessages(env);
    const c = comptes(env, b.org);
    const jeton = await c.connecter("699 11 22 33", "Madame Ngo");
    const ajouter = (n: number, extra: object = {}, j = jeton) =>
      c.appel("POST", "/adresses", j, { nom: `Adresse ${n}`, zoneId: b.zoneId, adresse: `Rue ${n}, Bonamoussadi`, ...extra });
    const premiere = await ajouter(1, { parDefaut: true, repere: "Face à la pharmacie" });
    expect(premiere.statut).toBe(201);
    expect(premiere.corps).toMatchObject({ nom: "Adresse 1", zone_id: b.zoneId, zone: "Akwa", repere: "Face à la pharmacie", par_defaut: true });
    const ids = [premiere.corps.id as string];
    for (let n = 2; n <= 5; n += 1) ids.push((await ajouter(n)).corps.id);
    expect((await ajouter(6)).corps.erreur).toBe("adresses_max");
    expect((await c.appel("GET", "/adresses", jeton)).corps.map((a: { id: string }) => a.id)).toEqual(ids);

    const troisieme = await c.appel("PUT", `/adresses/${ids[2]}`, jeton, { nom: "Bureau", zoneId: null, adresse: "Immeuble Hilton, Akwa", parDefaut: true });
    expect(troisieme.corps).toMatchObject({ id: ids[2], nom: "Bureau", zone_id: null, par_defaut: true });
    const liste = (await c.appel("GET", "/adresses", jeton)).corps;
    expect(liste.filter((a: { par_defaut: boolean }) => a.par_defaut).map((a: { id: string }) => a.id)).toEqual([ids[2]]);
    expect(liste[0].id).toBe(ids[2]);

    expect((await c.appel("DELETE", `/adresses/${ids[4]}`, jeton)).corps).toEqual({ supprime: true });
    expect((await c.appel("GET", "/adresses", jeton)).corps).toHaveLength(4);
    const ailleurs = await magasinMessages(env);
    expect((await ajouter(7, { zoneId: ailleurs.zoneId })).corps.erreur).toBe("zone_invalide");
    expect((await ajouter(7, { adresse: "  " })).statut).toBe(400);

    // Un autre client ne voit ni ne touche ces adresses.
    const autre = await c.connecter("677 12 34 56", "Paul Eto");
    expect((await c.appel("GET", "/adresses", autre)).corps).toEqual([]);
    expect((await c.appel("DELETE", `/adresses/${ids[0]}`, autre)).statut).toBe(404);
    expect((await c.appel("PUT", `/adresses/${ids[0]}`, autre, { nom: "Volée", adresse: "Ailleurs, Douala" })).statut).toBe(404);
    expect((await c.appel("GET", "/adresses", jeton)).corps).toHaveLength(4);
  });

  it("modifie le nom et l'e-mail, jamais le téléphone", async () => {
    const b = await magasinMessages(env);
    const c = comptes(env, b.org);
    const jeton = await c.connecter("699 11 22 33", "Madame Ngo");
    expect((await c.appel("PATCH", "", jeton, { nom: "Awa Ngono", email: "AWA@exemple.cm" })).corps)
      .toEqual({ client: { nom: "Awa Ngono", telephone: "237699112233", email: "awa@exemple.cm" } });
    expect((await c.appel("PATCH", "", jeton, { telephone: "677 00 00 00" })).statut).toBe(400);
    expect((await c.appel("PATCH", "", jeton, { email: null })).corps.client).toEqual({ nom: "Awa Ngono", telephone: "237699112233", email: null });
    expect((await c.appel("GET", "", jeton)).corps.client.nom).toBe("Awa Ngono");
  });
});
