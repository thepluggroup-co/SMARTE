import { afterAll, describe, expect, it } from "vitest";
import { avis, boutiquePayante, commandeMobile, environnementPaiement, payer, referencePaiement } from "./paiementoutils.js";

const env = await environnementPaiement();
afterAll(env.fermer);

describe("paiement en ligne : jamais un faux avis, jamais deux fois", () => {
  it("refuse un avis sans signature ou mal signé, sans rien changer, et le trace", async () => {
    const b = await boutiquePayante(env);
    const p = await b.article("TEL", 50000, 0, 1);
    const c = await commandeMobile(env, b, p);
    await payer(env, b.org, c);
    const corps = { reference_prestataire: await referencePaiement(b, c.reference), statut: "reussi", montant: c.total_ttc };
    expect((await avis(env, b.org, corps, null)).statut).toBe(401);
    expect((await avis(env, b.org, corps, "0".repeat(64))).statut).toBe(401);
    expect((await avis(env, b.org, corps, "pas-une-signature")).statut).toBe(401);
    const { rows: [w] } = await b.sql("select statut, facture_id from commandes_web where reference = $1", [c.reference]);
    expect(w).toEqual({ statut: "reservee", facture_id: null });
    const { rows } = await b.sql("select issue, signature_valide from avis_paiement");
    expect(rows).toEqual(Array(3).fill({ issue: "signature_invalide", signature_valide: false }));
  });

  it("un avis valide reçu trois fois ne fait qu'une facture, un règlement et un encaissement", async () => {
    const b = await boutiquePayante(env);
    const p = await b.article("RADIO", 20000, 0, 2);
    const c = await commandeMobile(env, b, p);
    await payer(env, b.org, c);
    const corps = { reference_prestataire: await referencePaiement(b, c.reference), statut: "reussi", montant: c.total_ttc };
    const issues = [];
    for (let i = 0; i < 3; i++) issues.push((await avis(env, b.org, corps)).corps.issue);
    expect(issues).toEqual(["traite", "deja_traite", "deja_traite"]);
    const compter = async (texte: string) => (await b.sql(texte)).rows[0]!.n;
    expect(await compter("select count(*)::int as n from documents_vente where type = 'facture'")).toBe(1);
    expect(await compter("select count(*)::int as n from reglements")).toBe(1);
    expect(await compter(`select count(*)::int as n from mouvements_portefeuille where portefeuille_id = '${b.portefeuilles.orange_money}' and type = 'encaissement'`)).toBe(1);
    expect(await b.dispo(p)).toBe(1);
  });

  it("refuse un mauvais montant et une référence inconnue, sans rien changer", async () => {
    const b = await boutiquePayante(env);
    const p = await b.article("FOUR", 90000, 0, 1);
    const c = await commandeMobile(env, b, p);
    await payer(env, b.org, c);
    const ref = await referencePaiement(b, c.reference);
    expect((await avis(env, b.org, { reference_prestataire: ref, statut: "reussi", montant: c.total_ttc - 1000 })).statut).toBe(409);
    expect((await avis(env, b.org, { reference_prestataire: "FACTICE-inconnue", statut: "reussi", montant: c.total_ttc })).statut).toBe(404);
    const { rows: [w] } = await b.sql("select statut from commandes_web where reference = $1", [c.reference]);
    expect(w!.statut).toBe("reservee");
    const { rows } = await b.sql("select issue from avis_paiement order by recu_le");
    expect(rows.map((x) => x.issue)).toEqual(["montant_different", "inconnu"]);
    expect((await avis(env, b.org, { reference_prestataire: ref, statut: "reussi", montant: c.total_ttc })).corps.statut).toBe("facturee");
  });

  it("un avis adressé à une autre organisation ne touche à rien", async () => {
    const a = await boutiquePayante(env);
    const autre = await boutiquePayante(env);
    const p = await a.article("VELO", 70000, 0, 1);
    const c = await commandeMobile(env, a, p);
    await payer(env, a.org, c);
    const corps = { reference_prestataire: await referencePaiement(a, c.reference), statut: "reussi", montant: c.total_ttc };
    expect((await avis(env, autre.org, corps)).statut).toBe(404);
    expect((await a.sql("select statut from commandes_web where reference = $1", [c.reference])).rows[0]!.statut).toBe("reservee");
    expect((await autre.sql("select count(*)::int as n from documents_vente where type = 'facture'")).rows[0]!.n).toBe(0);
    expect((await avis(env, "pas-un-uuid", corps)).statut).toBe(404);
    expect((await avis(env, a.org, corps, undefined, "inconnu")).statut).toBe(404);
  });
});
