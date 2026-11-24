import { afterAll, describe, expect, it } from "vitest";
import { comptes } from "./comptesoutils.js";
import { environnementMessages, magasinMessages } from "./messagesoutils.js";

const env = await environnementMessages();
afterAll(env.fermer);

describe("fidélité du compte client", () => {
  it("montre le solde, sa valeur et les mouvements de la branche seulement (Q10)", async () => {
    const b = await magasinMessages(env);
    const c = comptes(env, b.org);
    const regler = (actif: boolean) => b.api("PUT", `/entites/${b.G}/fidelite`, { actif, fcfaParPoint: 100, valeurPoint: 1 });
    expect((await regler(true)).statut).toBe(200);
    await b.api("POST", "/caisse/ouverture", { entiteId: b.lieu, fondOuverture: 0 });
    const client = (await b.api("POST", "/caisse/clients", { entiteId: b.lieu, nom: "Madame Ngo", telephone: "699 44 55 66" })).corps.id as string;
    const vente = await b.api("POST", "/caisse/ventes", { entiteId: b.lieu, tiersId: client, lignes: [{ produitId: b.produit, quantite: 1 }], paiements: [{ moyen: "especes", montant: 24000 }] });
    expect(vente.corps.points_gagnes).toBe(240);
    await b.sql("insert into points_fidelite (organisation_id, tiers_id, points, motif) values (org_courante(), $1, -40, 'Points utilisés en caisse')", [client]);
    // Une fiche de GTA au même numéro garde ses propres points.
    const gta = (await b.api("POST", "/tiers", { type: "personne", nom: "Madame Ngo", telephone: "699 44 55 66", entiteId: b.o.entites.GTA })).corps.id as string;
    await b.sql("insert into points_fidelite (organisation_id, tiers_id, points, motif) values (org_courante(), $1, 500, 'Formation')", [gta]);

    const jeton = await c.connecter("699 44 55 66");
    const f = (await c.appel("GET", "/fidelite", jeton)).corps;
    expect(f).toMatchObject({ actif: true, solde: 200, valeur_fcfa: 200 });
    expect(f.mouvements.map((m: { points: number }) => m.points)).toEqual([-40, 240]);
    expect(f.mouvements[0]).toMatchObject({ motif: "Points utilisés en caisse", date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });

    await regler(false);
    expect((await c.appel("GET", "/fidelite", jeton)).corps).toMatchObject({ actif: false, solde: 200 });
    expect((await c.appel("GET", "/fidelite")).statut).toBe(401);
  });
});
