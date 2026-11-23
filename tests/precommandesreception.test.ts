import { afterAll, describe, expect, it } from "vitest";
import { suivre } from "./canaloutils.js";
import { avis, environnementPaiement, payer, referencePaiement } from "./paiementoutils.js";
import {
  approuver, balayer, campagneEnBase, campagneEssai, choisirSolde, commandeAchat, evenements, inscrire, inscrireEtPayer, inscriptionEnBase, payerSolde,
  recevoir, suivrePrecommande, type C, type Inscription,
} from "./precommandesoutils.js";

const env = await environnementPaiement();
afterAll(env.fermer);

/** Campagne déclenchée par les quantités données, bon de commande approuvé (avec sa quantité commandée). */
async function declenchee(quantites: number[], commandee?: number) {
  const b = await campagneEssai(env, { seuil: quantites.reduce((s, q) => s + q, 0) });
  const inscrits: Inscription[] = [];
  for (const [n, q] of quantites.entries()) inscrits.push(await inscrireEtPayer(env, b, q, `69950000${n}`));
  const bc = await commandeAchat(b);
  if (commandee) await b.api("PUT", `/achats/commandes/${bc}/lignes`, { lignes: [{ produitId: b.produitId, quantite: commandee, prixUnitaire: 40000 }] });
  expect((await approuver(env, b, bc)).statut).toBe(200);
  return { b, inscrits, bc };
}
const statuts = async (b: C, inscrits: Inscription[]) => Promise.all(inscrits.map(async (i) => (await inscriptionEnBase(b, i.reference)).statut));

describe("précommandes : l'arrivage est réservé aux inscrits, le solde se paie en ligne", () => {
  it("Q12 : la réception réserve les pièces aux inscrits, dans l'ordre ; ni la caisse, ni la Marketplace, ni un transfert ne les prennent", async () => {
    const { b, inscrits, bc } = await declenchee([1, 1, 1]);
    expect((await recevoir(b, bc, 3)).corps.statut).toBe("recue");
    expect(await statuts(b, inscrits)).toEqual(["servie", "servie", "servie"]);
    const { rows: res } = await b.sql(
      "select i.reference from reservations_stock r join inscriptions_precommande i on i.id = r.inscription_id where r.levee_le is null order by i.validee_le",
    );
    expect(res.map((r) => r.reference)).toEqual(inscrits.map((i) => i.reference));
    const i0 = await inscriptionEnBase(b, inscrits[0]!.reference);
    expect(new Date(i0.solde_avant).getTime() - new Date(i0.servie_le).getTime()).toBe(7 * 86400000);
    expect(await b.dispo(b.produitId)).toBe(0);
    expect((await b.api("POST", "/stocks/mouvements", { entiteId: b.lieu, produitId: b.produitId, type: "sortie", quantite: 1, motif: "Vente au comptoir" })).corps.erreur).toBe("stock_insuffisant");
    const depot = (await b.api("POST", "/magasins", { parentId: b.G, nom: "Dépôt", type: "entrepot" })).corps.id;
    const t = await b.api("POST", "/transferts", { depuisId: b.lieu, versId: depot, lignes: [{ produitId: b.produitId, quantite: 1 }] });
    expect((await b.api("POST", `/transferts/${t.corps.id}/expedition`)).corps.erreur).toBe("stock_insuffisant");
    expect(await evenements(b, "precommande.arrivage_recu")).toHaveLength(3);
    expect((await inscrire(env, b.org, b.campagne.id, { telephone: "699599999" })).corps.erreur).toBe("campagne_close");
    expect((await suivrePrecommande(env, b.org, inscrits[0]!)).corps).toMatchObject({ statut: "servie", solde: { montant: 85000 - 25500 } });
  });

  it("Q13 : le solde payé donne la facture du total, l'acompte imputé une fois sans nouvel encaissement, la sortie du stock et le colis", async () => {
    const { b, inscrits, bc } = await declenchee([1, 1]);
    await recevoir(b, bc, 2);
    const [a] = inscrits;
    const s = await choisirSolde(env, b.org, a!, { modeLivraison: "domicile", zoneId: b.zoneId, adresse: "Akwa, rue Joss" });
    expect(s.statut).toBe(201);
    expect(s.corps.commande).toMatchObject({ total_ttc: 86000, acompte: 25500, montant_a_payer: 60500, frais_livraison: 1000 });
    expect((await suivre(env, b.org, s.corps.commande)).corps).toMatchObject({ acompte: 25500, montant_a_payer: 60500 });
    expect((await suivrePrecommande(env, b.org, a!)).corps.commande_solde).toMatchObject({ statut: "reservee", montant_a_payer: 60500 });

    expect((await payerSolde(env, b, s.corps.commande)).corps.statut).toBe("facturee");
    const { rows: [w] } = await b.sql(
      "select w.statut, w.colis_id, f.id as facture, f.total_ttc from commandes_web w join documents_vente f on f.id = w.facture_id where w.reference = $1", [s.corps.commande.reference],
    );
    expect(w).toMatchObject({ statut: "facturee", total_ttc: 86000 });
    expect(w!.colis_id).not.toBeNull();
    const { rows: reg } = await b.sql("select id, montant, (acompte_id is not null) as acompte from reglements where facture_id = $1 order by montant", [w!.facture]);
    expect(reg.map((r) => [r.montant, r.acompte])).toEqual([[25500, true], [60500, false]]);
    expect((await b.sql("select count(*)::int as n from mouvements_portefeuille where source_id = $1", [reg[0]!.id])).rows[0]!.n).toBe(0);
    const { rows: [e] } = await b.sql("select coalesce(sum(montant), 0)::int8 as s from mouvements_portefeuille where portefeuille_id = $1 and type = 'encaissement'", [b.portefeuilles.orange_money]);
    expect(e!.s).toBe(2 * 25500 + 60500);
    const { rows: [physique] } = await b.sql("select sum(quantite)::float as q from mouvements_stock where entite_id = $1 and produit_id = $2", [b.lieu, b.produitId]);
    expect(physique!.q).toBe(1);
    expect(await b.dispo(b.produitId)).toBe(0);
    expect((await inscriptionEnBase(b, a!.reference)).statut).toBe("soldee");
    expect(await evenements(b, "precommande.soldee")).toHaveLength(1);
    expect((await b.api("POST", `/reglements/${reg[0]!.id}/annulation`, { motif: "Erreur de saisie" })).corps.erreur).toBe("reglement_acompte_non_annulable");
  });

  it("Q14 : réception partielle servie dans l'ordre, chacun en entier ; commande close, les non servis sont remboursés ; le surplus reste en vente", async () => {
    const { b, inscrits, bc } = await declenchee([1, 2, 1]);
    expect((await recevoir(b, bc, 2)).corps.statut).toBe("recue_partiellement");
    expect(await statuts(b, inscrits)).toEqual(["servie", "validee", "validee"]);
    expect(await b.dispo(b.produitId)).toBe(1);
    expect((await recevoir(b, bc, 2)).corps.statut).toBe("recue");
    expect(await statuts(b, inscrits)).toEqual(["servie", "servie", "a_rembourser"]);
    expect((await inscriptionEnBase(b, inscrits[2]!.reference)).motif).toBe("non_servie");
    expect((await b.sql("select titre from taches where titre like 'Rembourser 1 acompte(s)%'")).rows).toHaveLength(1);

    const surplus = await declenchee([1], 3);
    await recevoir(surplus.b, surplus.bc, 3);
    expect(await surplus.b.dispo(surplus.b.produitId)).toBe(2);
  });

  it("Q15 : délai du solde dépassé, l'acompte est conservé et l'article remis en vente ; un paiement du solde ensuite est à rembourser", async () => {
    const { b, inscrits, bc } = await declenchee([1]);
    await recevoir(b, bc, 1);
    const [a] = inscrits;
    const premier = (await choisirSolde(env, b.org, a!)).corps.commande;
    const second = (await choisirSolde(env, b.org, a!, { modeLivraison: "point_relais", pointRelaisId: b.relaisId })).corps.commande;
    expect((await b.sql("select statut from commandes_web where reference = $1", [premier.reference])).rows[0]!.statut).toBe("annulee");
    expect(await b.dispo(b.produitId)).toBe(0);
    await payer(env, b.org, second);
    await b.sql("update inscriptions_precommande set solde_avant = now() - interval '1 minute' where reference = $1", [a!.reference]);
    await b.sql("update commandes_web set expire_le = now() - interval '1 minute' where reference = $1", [second.reference]);
    await balayer(env, b.org);
    expect((await inscriptionEnBase(b, a!.reference)).statut).toBe("acompte_conserve");
    expect(await b.dispo(b.produitId)).toBe(1);
    expect(await evenements(b, "precommande.acompte_conserve")).toHaveLength(1);
    expect(await campagneEnBase(b)).toMatchObject({ statut: "livree" });
    const r = await avis(env, b.org, { reference_prestataire: await referencePaiement(b, second.reference), statut: "reussi", montant: second.montant_a_payer });
    expect(r.corps.statut).toBe("a_rembourser");
    expect((await b.sql("select count(*)::int as n from reglements where acompte_id is not null")).rows[0]!.n).toBe(0);
  });

  it("un solde payé dont la facture attend n'est jamais conservé ; une fois terminée, la précommande est soldée", async () => {
    const { b, inscrits, bc } = await declenchee([1]);
    await recevoir(b, bc, 1);
    const commande = (await choisirSolde(env, b.org, inscrits[0]!)).corps.commande;
    await b.sql("update entites set niu = null where id = $1", [b.G]);
    expect((await payerSolde(env, b, commande)).corps.statut).toBe("payee");
    await b.sql("update inscriptions_precommande set solde_avant = now() - interval '1 minute' where reference = $1", [inscrits[0]!.reference]);
    await balayer(env, b.org);
    expect((await inscriptionEnBase(b, inscrits[0]!.reference)).statut).toBe("servie");
    expect(await b.dispo(b.produitId)).toBe(0);
    await b.api("PATCH", `/entites/${b.G}/identite`, { raisonSociale: "GLOMARI Sarl", niu: "M0123456789" });
    const id = (await b.sql("select id from commandes_web where reference = $1", [commande.reference])).rows[0]!.id;
    expect((await b.api("POST", `/commandes-web/${id}/terminer`)).corps.statut).toBe("facturee");
    expect((await inscriptionEnBase(b, inscrits[0]!.reference)).statut).toBe("soldee");
    expect(await campagneEnBase(b)).toMatchObject({ statut: "livree" });
  });

  it("si l'acompte est déjà conservé quand le solde arrive, le paiement est à rembourser : jamais conservé et imputé à la fois", async () => {
    const { b, inscrits, bc } = await declenchee([1]);
    await recevoir(b, bc, 1);
    const commande = (await choisirSolde(env, b.org, inscrits[0]!)).corps.commande;
    await payer(env, b.org, commande);
    await b.sql("update inscriptions_precommande set statut = 'acompte_conserve' where reference = $1", [inscrits[0]!.reference]);
    const r = await avis(env, b.org, { reference_prestataire: await referencePaiement(b, commande.reference), statut: "reussi", montant: commande.montant_a_payer });
    expect(r.corps.statut).toBe("a_rembourser");
    expect((await b.sql("select statut from commandes_web where reference = $1", [commande.reference])).rows[0]!.statut).toBe("a_rembourser");
    expect((await b.sql("select count(*)::int as n from documents_vente where type = 'facture'")).rows[0]!.n).toBe(0);
  });
});
