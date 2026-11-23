import { afterAll, describe, expect, it } from "vitest";
import { environnementPaiement } from "./paiementoutils.js";
import {
  approuver, balayer, campagneEssai, choisirSolde, inscrire, inscrireEtPayer, payerAcompte, payerSolde, recevoir, type C,
} from "./precommandesoutils.js";

const env = await environnementPaiement();
afterAll(env.fermer);

type Ligne = { numero: string; debit: number; credit: number };
type Ecriture = { id: string; source_type: string; journal: string; lignes: Ligne[] };
const sens = (e: Ecriture) => Object.fromEntries(e.lignes.map((l) => [l.numero, l.debit - l.credit]));

/** Une autre campagne sur le même article, dans la même organisation. */
async function autreCampagne(b: C, seuil: number) {
  const r = await b.api("POST", "/precommandes/campagnes", { ...b.corpsCampagne, seuil });
  return r.corps as { id: string; commande_achat_id: string | null };
}

describe("précommandes : écritures proposées à l'expert-comptable", () => {
  it("Q17 : acompte, imputation, remboursement et acompte conservé passent par le compte d'avances clients, qui revient à zéro", async () => {
    const b = await campagneEssai(env, { seuil: 1 });
    expect((await b.api("POST", "/compta/initialisation", { brancheId: b.G })).statut).toBe(200);

    // A : acompte, arrivage, solde payé au retrait.
    const a = await inscrireEtPayer(env, b, 1, "699700001");
    const bcA = (await b.sql("select commande_achat_id from campagnes_arrivage where id = $1", [b.campagne.id])).rows[0]!.commande_achat_id;
    await approuver(env, b, bcA);
    await recevoir(b, bcA, 1);
    expect((await payerSolde(env, b, (await choisirSolde(env, b.org, a)).corps.commande)).corps.statut).toBe("facturee");

    // B : campagne annulée, acompte remboursé par le trésorier.
    const kB = await autreCampagne(b, 5);
    const iB = (await inscrire(env, b.org, kB.id, { telephone: "699700002" })).corps;
    await payerAcompte(env, b, iB);
    await b.api("POST", `/precommandes/campagnes/${kB.id}/annulation`, { motif: "Arrivage reporté" });
    const pB = (await b.sql("select p.id from paiements_en_ligne p join inscriptions_precommande i on i.id = p.inscription_id where i.reference = $1", [iB.reference])).rows[0]!.id;
    expect((await b.api("POST", `/paiements-en-ligne/${pB}/remboursement`, {})).statut).toBe(200);

    // C : arrivage reçu, solde jamais payé : l'acompte est conservé.
    const kC = await autreCampagne(b, 1);
    const iC = (await inscrire(env, b.org, kC.id, { telephone: "699700003" })).corps;
    await payerAcompte(env, b, iC);
    const bcC = (await b.sql("select commande_achat_id from campagnes_arrivage where id = $1", [kC.id])).rows[0]!.commande_achat_id;
    await approuver(env, b, bcC);
    await recevoir(b, bcC, 1);
    await b.sql("update inscriptions_precommande set solde_avant = now() - interval '1 minute' where reference = $1", [iC.reference]);
    await balayer(env, b.org);

    expect((await b.api("POST", "/compta/generation", { brancheId: b.G, fin: "2100-01-01" })).statut).toBe(200);
    const brouillons: Ecriture[] = (await b.api("GET", `/compta/ecritures?brancheId=${b.G}&statut=brouillon`)).corps;
    const de = (type: string) => brouillons.filter((e) => e.source_type === type);

    expect(de("encaissement_en_ligne").map(sens)).toEqual(Array(3).fill({ "552": 25500, "4191": -25500 }));
    expect(de("remboursement_en_ligne").map(sens)).toEqual([{ "4191": 25500, "552": -25500 }]);
    expect(de("acompte_conserve").map(sens)).toEqual([{ "4191": 25500, "758": -25500 }]);
    const reglements = de("reglement");
    expect(reglements.map(sens)).toEqual(expect.arrayContaining([{ "4191": 25500, "4111": -25500 }, { "552": 59500, "4111": -59500 }]));
    expect(reglements.find((e) => sens(e)["4191"])!.journal).toBe("OD");

    expect((await b.api("POST", "/compta/ecritures/validation", { ids: brouillons.map((e) => e.id) })).statut).toBe(200);
    const balance = (await b.api("GET", `/compta/balance?brancheId=${b.G}&debut=2000-01-01&fin=2100-12-31`)).corps;
    const solde = (n: string) => { const l = balance.lignes.find((x: Ligne) => x.numero === n); return l ? l.debit - l.credit : 0; };
    expect(balance.debit).toBe(balance.credit);
    expect(solde("4191")).toBe(0);
    expect(solde("4111")).toBe(0);
    expect(solde("758")).toBe(-25500);
    expect((await b.api("POST", "/compta/generation", { brancheId: b.G, fin: "2100-01-01" })).corps.crees).toBe(0);
  });
});
