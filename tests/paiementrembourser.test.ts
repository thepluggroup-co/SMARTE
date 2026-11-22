import { afterAll, describe, expect, it } from "vitest";
import { suivre } from "./canaloutils.js";
import { avis, boutiquePayante, commandeMobile, environnementPaiement, payer, referencePaiement } from "./paiementoutils.js";

const env = await environnementPaiement();
afterAll(env.fermer);
type B = Awaited<ReturnType<typeof boutiquePayante>>;
const reussi = async (b: B, ref: string, montant: number) => avis(env, b.org, { reference_prestataire: ref, statut: "reussi", montant });
const taches = async (b: B, debut: string) => (await b.sql("select titre from taches where titre like $1", [`${debut}%`])).rows;

describe("paiement en ligne : tardif, en trop, ou vente à terminer", () => {
  it("P7 : payé après l'échéance, la commande est à rembourser, encaissée, sans facture ni sortie de stock", async () => {
    const b = await boutiquePayante(env);
    const p = await b.article("FRIGO", 200000, 0, 3);
    for (const balayage of [false, true]) {
      const c = await commandeMobile(env, b, p);
      await payer(env, b.org, c);
      const ref = await referencePaiement(b, c.reference);
      await b.sql("update commandes_web set expire_le = now() - interval '1 minute' where reference = $1", [c.reference]);
      if (balayage) await env.app.executerTaches(b.org);
      expect((await reussi(b, ref, c.total_ttc)).corps).toEqual({ recu: true, issue: "traite", statut: "a_rembourser" });
      const { rows: [w] } = await b.sql("select statut, facture_id from commandes_web where reference = $1", [c.reference]);
      expect(w).toEqual({ statut: "a_rembourser", facture_id: null });
      expect((await b.sql("select statut, motif from paiements_en_ligne where reference_prestataire = $1", [ref])).rows[0]).toEqual({ statut: "a_rembourser", motif: "expiree" });
      expect((await b.sql("select montant from mouvements_portefeuille where reference = $1 and source_type = 'paiement_en_ligne'", [ref])).rows).toEqual([{ montant: c.total_ttc }]);
      expect((await suivre(env, b.org, c)).corps.statut).toBe("a_rembourser");
    }
    expect(await b.dispo(p)).toBe(3);
    expect((await b.sql("select count(*)::int as n from documents_vente where type = 'facture'")).rows[0]!.n).toBe(0);
    expect(await taches(b, "Rembourser le paiement")).toHaveLength(2);
  });

  it("payé après une annulation : à rembourser, motif annulée", async () => {
    const b = await boutiquePayante(env);
    const p = await b.article("TABLE", 60000, 0, 1);
    const c = await commandeMobile(env, b, p);
    await payer(env, b.org, c);
    const id = (await b.sql("select id from commandes_web where reference = $1", [c.reference])).rows[0]!.id;
    expect((await b.api("POST", `/commandes-web/${id}/annuler`, { motif: "Client injoignable" })).statut).toBe(200);
    expect((await reussi(b, await referencePaiement(b, c.reference), c.total_ttc)).corps.statut).toBe("a_rembourser");
    expect((await b.sql("select motif from paiements_en_ligne")).rows[0]!.motif).toBe("annulee");
  });

  it("P8 : un second paiement réussi pour une commande déjà facturée est à rembourser, sans seconde facture", async () => {
    const b = await boutiquePayante(env);
    const p = await b.article("CHAISE", 25000, 0, 2);
    const c = await commandeMobile(env, b, p);
    await payer(env, b.org, c);
    const premier = await referencePaiement(b, c.reference);
    await payer(env, b.org, c);
    const second = await referencePaiement(b, c.reference);
    expect(second).not.toBe(premier);
    expect((await reussi(b, premier, c.total_ttc)).corps.statut).toBe("facturee");
    expect((await reussi(b, second, c.total_ttc)).corps.statut).toBe("a_rembourser");
    expect((await b.sql("select statut from commandes_web where reference = $1", [c.reference])).rows[0]!.statut).toBe("facturee");
    expect((await b.sql("select motif from paiements_en_ligne where reference_prestataire = $1", [second])).rows[0]!.motif).toBe("deja_payee");
    expect((await b.sql("select count(*)::int as n from documents_vente where type = 'facture'")).rows[0]!.n).toBe(1);
  });

  it("P9 : sans identité vendeur, le paiement reste « payée » ; une fois corrigé, la vente se termine une seule fois", async () => {
    const b = await boutiquePayante(env);
    const p = await b.article("LAMPE", 8000, 0, 2);
    const c = await commandeMobile(env, b, p);
    await payer(env, b.org, c);
    await b.sql("update entites set niu = null where id = $1", [b.G]);
    expect((await reussi(b, await referencePaiement(b, c.reference), c.total_ttc)).corps.statut).toBe("payee");
    const { rows: [w] } = await b.sql("select id, statut, facture_id from commandes_web where reference = $1", [c.reference]);
    expect(w).toMatchObject({ statut: "payee", facture_id: null });
    expect(await b.dispo(p)).toBe(1);
    expect(await taches(b, "Terminer la vente")).toEqual([{ titre: `Terminer la vente de la commande ${c.reference} : identite_vendeur_incomplete` }]);
    expect((await b.api("POST", `/commandes-web/${w!.id}/terminer`)).corps.erreur).toBe("identite_vendeur_incomplete");

    await b.api("PATCH", `/entites/${b.G}/identite`, { raisonSociale: "GLOMARI Sarl", niu: "M0123456789" });
    const fin = await b.api("POST", `/commandes-web/${w!.id}/terminer`);
    expect(fin.statut).toBe(200);
    expect(fin.corps.statut).toBe("facturee");
    expect((await b.api("POST", `/commandes-web/${w!.id}/terminer`)).corps.erreur).toBe("vente_deja_terminee");
    expect((await b.sql("select count(*)::int as n from documents_vente where type = 'facture'")).rows[0]!.n).toBe(1);
    expect(await b.dispo(p)).toBe(1);
  });
});
