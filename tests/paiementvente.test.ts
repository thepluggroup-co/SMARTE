import { afterAll, describe, expect, it } from "vitest";
import { commander, corpsCommande, suivre } from "./canaloutils.js";
import { environnement } from "./outils.js";
import { avis, boutiquePayante, commandeMobile, environnementPaiement, payer, payerEtConfirmer, referencePaiement } from "./paiementoutils.js";

const env = await environnementPaiement();
const sansPrestataire = await environnement();
afterAll(async () => { await env.fermer(); await sansPrestataire.fermer(); });

describe("paiement en ligne : la vente se termine seule", () => {
  it("P1 : Orange Money, de l'avis signé à la facture, la sortie de stock, l'encaissement et le colis", async () => {
    const b = await boutiquePayante(env);
    const p = await b.article("TV", 100000, 19.25, 3);
    const c = await commandeMobile(env, b, p, 2);
    const lance = await payer(env, b.org, c);
    expect(lance.statut).toBe(201);
    expect(lance.corps).toMatchObject({ statut: "lance", moyen: "orange_money", montant: c.total_ttc, instruction: { type: "telephone" } });

    const r = await avis(env, b.org, { reference_prestataire: await referencePaiement(b, c.reference), statut: "reussi", montant: c.total_ttc });
    expect(r).toEqual({ statut: 200, corps: { recu: true, issue: "traite", statut: "facturee" } });

    const { rows: [w] } = await b.sql(
      "select w.statut, w.colis_id, f.statut as statut_facture, f.total_ttc from commandes_web w join documents_vente f on f.id = w.facture_id where w.reference = $1",
      [c.reference],
    );
    expect(w).toMatchObject({ statut: "facturee", statut_facture: "emis", total_ttc: c.total_ttc });
    expect(w!.colis_id).not.toBeNull();
    const { rows: [physique] } = await b.sql("select sum(quantite)::float as q from mouvements_stock where entite_id = $1 and produit_id = $2", [b.lieu, p]);
    expect(physique!.q).toBe(1);
    expect(await b.dispo(p)).toBe(1);
    const { rows: [encaisse] } = await b.sql("select coalesce(sum(montant), 0)::int8 as s from mouvements_portefeuille where portefeuille_id = $1 and type = 'encaissement'", [b.portefeuilles.orange_money]);
    expect(encaisse!.s).toBe(c.total_ttc);
    const s = await suivre(env, b.org, c);
    expect(s.corps.statut).toBe("facturee");
    expect(s.corps.colis).toMatchObject({ statut: "prepare" });
    const { rows: ev } = await b.sql("select type from evenements where organisation_id = org_courante() and type like 'commande_web.%'");
    expect(ev.map((e) => e.type)).toEqual(expect.arrayContaining(["commande_web.creee", "commande_web.payee", "commande_web.facturee"]));
  });

  it("P2 : MTN MoMo et retrait au magasin, sans colis", async () => {
    const b = await boutiquePayante(env);
    const p = await b.article("FER", 15000, 0, 2);
    const c = await commandeMobile(env, b, p, 1, { moyenPaiement: "mtn_momo", modeLivraison: "retrait_magasin", zoneId: undefined, adresse: undefined });
    expect((await payerEtConfirmer(env, b, c)).corps.statut).toBe("facturee");
    const { rows: [w] } = await b.sql("select statut, colis_id from commandes_web where reference = $1", [c.reference]);
    expect(w).toEqual({ statut: "facturee", colis_id: null });
    const { rows: [encaisse] } = await b.sql("select coalesce(sum(montant), 0)::int8 as s from mouvements_portefeuille where portefeuille_id = $1 and type = 'encaissement'", [b.portefeuilles.mtn_momo]);
    expect(encaisse!.s).toBe(15000);
  });

  it("P6 : un échec garde la réservation ; le client relance et paie", async () => {
    const b = await boutiquePayante(env);
    const p = await b.article("LIT", 80000, 0, 1);
    const c = await commandeMobile(env, b, p);
    await payer(env, b.org, c);
    const premier = await referencePaiement(b, c.reference);
    expect((await avis(env, b.org, { reference_prestataire: premier, statut: "echoue", montant: c.total_ttc })).corps).toMatchObject({ issue: "echec" });
    expect((await suivre(env, b.org, c)).corps.statut).toBe("reservee");
    expect(await b.dispo(p)).toBe(0);
    expect((await payerEtConfirmer(env, b, c)).corps.statut).toBe("facturee");
    const { rows } = await b.sql("select statut from paiements_en_ligne order by lance_le");
    expect(rows.map((x) => x.statut)).toEqual(["echoue", "reussi"]);
  });

  it("P11 : paiement indisponible sans prestataire ou sans responsable ; impossible à la livraison ou après l'échéance", async () => {
    const b = await boutiquePayante(env);
    const p = await b.article("SAC", 1000, 0, 10);
    const c = await commandeMobile(env, b, p);
    expect((await payer(sansPrestataire, b.org, c)).corps.erreur).toBe("paiement_indisponible");
    await b.sql("update config_canal set responsable_id = null");
    expect((await payer(env, b.org, c)).corps.erreur).toBe("paiement_indisponible");
    await b.api("POST", "/canal-config", { entiteId: b.G, actif: true });
    expect((await payer(env, b.org, c)).statut).toBe(201);

    const cod = (await commander(env, b.org, corpsCommande(b, [{ produitId: p, quantite: 1 }]))).corps;
    expect((await payer(env, b.org, cod)).corps.erreur).toBe("paiement_impossible");
    await b.sql("update commandes_web set expire_le = now() - interval '1 minute' where reference = $1", [c.reference]);
    expect((await payer(env, b.org, c)).corps.erreur).toBe("paiement_impossible");
    expect((await payer(env, b.org, { reference: c.reference, jeton: "A".repeat(43) })).statut).toBe(404);
  });

  it("facture égale au franc près à la commande, même pour un article vendu par tranches", async () => {
    const b = await boutiquePayante(env);
    const p = await b.article("CABLE", 1000, 0, 5);
    expect((await b.api("PUT", `/produits/${p}/paliers`, { actif: true, paliers: [{ quantiteMin: 2, prix: 999 }] })).statut).toBe(200);
    expect((await b.api("PUT", `/produits/${p}/mode-palier`, { mode: "tranches" })).statut).toBe(200);
    const c = await commandeMobile(env, b, p, 3);
    expect(c.total_ttc).toBe(1000 + 999 * 2 + 1000);
    expect((await payerEtConfirmer(env, b, c)).corps.statut).toBe("facturee");
    const { rows: [f] } = await b.sql("select f.total_ttc from commandes_web w join documents_vente f on f.id = w.facture_id where w.reference = $1", [c.reference]);
    expect(f!.total_ttc).toBe(c.total_ttc);
  });
});
