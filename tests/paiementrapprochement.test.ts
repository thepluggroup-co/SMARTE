import { afterAll, describe, expect, it } from "vitest";
import { utilisateur } from "./canaloutils.js";
import { boutiquePayante, commandeMobile, environnementPaiement, payerEtConfirmer } from "./paiementoutils.js";

const env = await environnementPaiement();
afterAll(env.fermer);

describe("paiement en ligne : rapprochement au franc près", () => {
  it("P12 : 20 paiements Orange et MTN se retrouvent dans la liste du jour, au franc près", async () => {
    const b = await boutiquePayante(env);
    const p = await b.article("SAVON", 1750, 0, 20);
    let somme = 0;
    for (let i = 0; i < 20; i++) {
      const c = await commandeMobile(env, b, p, 1, { moyenPaiement: i % 2 ? "mtn_momo" : "orange_money", telephone: `69900${String(i).padStart(4, "0")}` });
      expect((await payerEtConfirmer(env, b, c)).corps.statut).toBe("facturee");
      somme += c.total_ttc;
    }
    const liste = (await b.api("GET", "/paiements-en-ligne")).corps;
    expect(liste.nombre).toBe(20);
    expect(liste.total).toBe(somme);
    expect(liste.paiements.every((x: { facture: string | null; portefeuille: string | null }) => x.facture && x.portefeuille)).toBe(true);
    for (const moyen of ["orange_money", "mtn_momo"]) {
      const r = (await b.api("GET", `/paiements-en-ligne?moyen=${moyen}`)).corps;
      expect(r.nombre).toBe(10);
      expect(r.total).toBe(somme / 2);
    }
  });

  it("P10 : sans portefeuille par défaut, la vente se termine et l'argent attend le trésorier", async () => {
    const b = await boutiquePayante(env, { portefeuilles: false });
    const p = await b.article("SEAU", 3000, 0, 1);
    const c = await commandeMobile(env, b, p);
    expect((await payerEtConfirmer(env, b, c)).corps.statut).toBe("facturee");
    expect((await b.sql("select montant from encaissements_en_attente")).rows).toEqual([{ montant: c.total_ttc }]);
    const liste = (await b.api("GET", "/paiements-en-ligne")).corps;
    expect(liste.paiements).toEqual([expect.objectContaining({ commande: c.reference, en_attente: true, portefeuille: null })]);
  });

  it("refuse la liste à qui ne voit ni la trésorerie ni la facturation", async () => {
    const b = await boutiquePayante(env);
    const magasinier = await utilisateur(env, b.o, "magasinier", b.G);
    expect((await env.api("GET", "/paiements-en-ligne", magasinier)).statut).toBe(403);
  });
});
