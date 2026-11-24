import { afterAll, describe, expect, it } from "vitest";
import { comptes } from "./comptesoutils.js";
import { commander, corpsCommande } from "./canaloutils.js";
import { environnementMessages } from "./messagesoutils.js";
import { approuver, campagneEssai, commandeAchat, inscrireEtPayer, payerSolde, recevoir } from "./precommandesoutils.js";

const env = await environnementMessages();
afterAll(env.fermer);

describe("historique du compte client", () => {
  it("montre ses commandes en ligne et ses précommandes, jamais celles d'un autre client (Q7)", async () => {
    const b = await campagneEssai(env, { seuil: 5 });
    const c = comptes(env, b.org);
    const ventilateur = await b.article("VENT", 1000, 0, 5);
    const precommande = await inscrireEtPayer(env, b, 1, "699000001");
    const commande = async (quantite: number, extra: object = {}) =>
      (await commander(env, b.org, corpsCommande(b, [{ produitId: ventilateur, quantite }], extra))).corps.reference as string;
    const avecColis = await commande(1);
    const sansColis = await commande(2);
    const autre = await commande(1, { telephone: "677 12 34 56", nomClient: "Paul Eto" });
    const id = (await b.sql("select id from commandes_web where reference = $1", [avecColis])).rows[0]!.id;
    expect((await b.api("POST", `/commandes-web/${id}/confirmer`)).statut).toBe(200);

    const jeton = await c.connecter("699 00 00 01");
    const commandes = (await c.appel("GET", "/commandes", jeton)).corps;
    expect(commandes.map((w: { reference: string }) => w.reference).sort()).toEqual([avecColis, sansColis].sort());
    expect(commandes.map((w: { reference: string }) => w.reference)).not.toContain(autre);
    expect(commandes.find((w: { reference: string }) => w.reference === avecColis)).toMatchObject({
      lignes: [{ nom: "Article VENT", quantite: 1 }], colis: { statut: "prepare", lien_suivi: expect.stringContaining("/suivi.html?c=") },
    });
    expect(commandes.find((w: { reference: string }) => w.reference === sansColis)).toMatchObject({ statut: "reservee", colis: null, lignes: [{ quantite: 2 }] });

    const precommandes = (await c.appel("GET", "/precommandes", jeton)).corps;
    expect(precommandes).toEqual([expect.objectContaining({ reference: precommande.reference, statut: "validee", quantite: 1, produit: "Article ROBOT" })]);
    expect(JSON.stringify(precommandes)).not.toContain(precommande.jeton);
    // L'autre client ne voit que sa commande.
    const sien = await c.connecter("677 12 34 56");
    expect((await c.appel("GET", "/commandes", sien)).corps.map((w: { reference: string }) => w.reference)).toEqual([autre]);
    expect((await c.appel("GET", "/precommandes", sien)).corps).toEqual([]);
  });

  it("choisit et paie le solde d'une précommande depuis l'espace, jamais celle d'un autre client (Q8)", async () => {
    const b = await campagneEssai(env, { seuil: 2 });
    const c = comptes(env, b.org);
    const sienne = await inscrireEtPayer(env, b, 1, "699000001");
    const autre = await inscrireEtPayer(env, b, 1, "677123456");
    const bc = await commandeAchat(b);
    await approuver(env, b, bc);
    await recevoir(b, bc, 2);

    const jeton = await c.connecter("699 00 00 01");
    const choix = { modeLivraison: "retrait_magasin", moyenPaiement: "orange_money" };
    expect((await c.appel("POST", `/precommandes/${autre.reference}/solde`, jeton, choix)).statut).toBe(404);
    expect((await c.appel("POST", `/precommandes/${sienne.reference}/solde`, undefined, choix)).statut).toBe(401);
    const s = await c.appel("POST", `/precommandes/${sienne.reference}/solde`, jeton, choix);
    expect(s.statut).toBe(201);
    expect(s.corps.commande).toMatchObject({ montant_a_payer: 59500, jeton: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect((await payerSolde(env, b, s.corps.commande)).corps.statut).toBe("facturee");
    expect((await c.appel("GET", "/precommandes", jeton)).corps[0]).toMatchObject({ reference: sienne.reference, statut: "soldee" });
    expect((await c.appel("POST", `/precommandes/${sienne.reference}/solde`, jeton, choix)).corps.erreur).toBe("solde_impossible");
  });
});
