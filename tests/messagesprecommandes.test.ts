import { afterAll, describe, expect, it } from "vitest";
import { aDouala, environnementMessages } from "./messagesoutils.js";
import { approuver, balayer, campagneEssai, choisirSolde, commandeAchat, inscrireEtPayer, payerSolde, recevoir, type C } from "./precommandesoutils.js";

const env = await environnementMessages();
afterAll(env.fermer);

const envoyer = (b: C, maintenant = aDouala()) => env.app.pousserMessages(maintenant, b.org);
const vider = () => { env.factice.envoyes.length = 0; env.factice.enPanne = false; };
const lignes = async (b: C, type: string) =>
  (await b.sql("select * from envois_messages where organisation_id = org_courante() and type = $1 order by cree_le", [type])).rows;
const inscriptionId = async (b: C, reference: string) => (await b.sql("select id from inscriptions_precommande where reference = $1", [reference])).rows[0]!.id as string;

describe("messages des précommandes", () => {
  it("confirme l'acompte avec la référence, la quantité et la date limite, sans jamais le jeton (Q7)", async () => {
    const b = await campagneEssai(env, { seuil: 5 });
    vider();
    const i = await inscrireEtPayer(env, b, 2, "699123456");
    expect(await envoyer(b)).toBe(1);
    const m = env.factice.envoyes[0]!;
    expect(m.telephone).toBe("237699123456");
    expect(m.texte).toContain(i.reference);
    expect(m.texte).toContain("2 × Robot pâtissier Pro");
    expect(m.texte).toContain(b.corpsCampagne.dateLimite.split("-").reverse().join("/"));
    expect(m.texte).not.toContain(i.jeton);
  });

  it("annonce chaque étape d'arrivage aux seuls inscrits encore concernés (Q8)", async () => {
    const b = await campagneEssai(env, { seuil: 2 });
    const a = await inscrireEtPayer(env, b, 1, "699200001");
    const r = await inscrireEtPayer(env, b, 1, "699200002");
    await envoyer(b);
    vider();
    const bc = await commandeAchat(b);
    expect((await approuver(env, b, bc)).statut).toBe(200);
    // Le second inscrit se retire avant l'envoi : son message devient sans objet.
    await b.sql("update inscriptions_precommande set statut = 'a_rembourser', motif = 'retrait_client' where reference = $1", [r.reference]);
    expect(await envoyer(b)).toBe(1);
    expect(env.factice.envoyes[0]).toMatchObject({ telephone: "237699200001" });
    expect(env.factice.envoyes[0]!.texte).toContain(`${a.reference} (Robot pâtissier Pro) avance : commandée au fabricant`);
    const idRetire = await inscriptionId(b, r.reference);
    expect((await lignes(b, "etape_arrivage")).find((m) => m.objet_id === idRetire)).toMatchObject({ statut: "annule", erreur: "sans_objet" });
    vider();
    expect((await b.api("POST", `/achats/commandes/${bc}/etapes`, { etape: "expediee", date: aDouala(10, 0).toISOString().slice(0, 10) })).statut).toBe(201);
    expect(await envoyer(b)).toBe(1);
    expect(env.factice.envoyes[0]!.texte).toContain("avance : expédiée");
    expect((await lignes(b, "etape_arrivage")).filter((m) => m.objet_id === idRetire)).toHaveLength(1);
  });

  it("annonce le solde à payer à l'arrivée, puis un seul rappel deux jours avant la date limite (Q9)", async () => {
    const b = await campagneEssai(env, { seuil: 1, delaiSoldeJours: 7 });
    const i = await inscrireEtPayer(env, b, 1, "699300001");
    const bc = await commandeAchat(b);
    await approuver(env, b, bc);
    expect((await recevoir(b, bc, 1)).statut).toBe(201);
    vider();
    await envoyer(b);
    const solde = env.factice.envoyes.find((m) => m.texte.includes("Solde à payer"))!;
    expect(solde.texte).toContain("59 500 FCFA");
    expect(solde.texte).toContain(i.reference);
    expect((await lignes(b, "rappel_solde"))[0]).toMatchObject({ statut: "en_attente", tentatives: 0 });
    vider();
    expect(await envoyer(b, aDouala(10, 6))).toBe(1);
    expect(env.factice.envoyes[0]!.texte).toContain("rappel, le solde de votre précommande");
    expect(await envoyer(b, aDouala(11, 6))).toBe(0);
  });

  it("ne rappelle pas un solde déjà payé", async () => {
    const b = await campagneEssai(env, { seuil: 1 });
    const i = await inscrireEtPayer(env, b, 1, "699300002");
    const bc = await commandeAchat(b);
    await approuver(env, b, bc);
    await recevoir(b, bc, 1);
    expect((await payerSolde(env, b, (await choisirSolde(env, b.org, i)).corps.commande)).corps.statut).toBe("facturee");
    await envoyer(b, aDouala(10, 6));
    expect((await lignes(b, "rappel_solde"))[0]).toMatchObject({ statut: "annule", erreur: "sans_objet" });
  });

  it("annonce le remboursement d'une campagne annulée, et un acompte conservé (Q10)", async () => {
    const b = await campagneEssai(env, { seuil: 5 });
    await inscrireEtPayer(env, b, 1, "699400001");
    await envoyer(b);
    vider();
    expect((await b.api("POST", `/precommandes/campagnes/${b.campagne.id}/annulation`, { motif: "Fabricant défaillant" })).statut).toBeLessThan(300);
    expect(await envoyer(b)).toBe(1);
    expect(env.factice.envoyes[0]!.texte).toContain("acompte de 25 500 FCFA");
    expect(env.factice.envoyes[0]!.texte).toContain("va vous être remboursé");

    const k = await campagneEssai(env, { seuil: 1 });
    const i = await inscrireEtPayer(env, k, 1, "699400002");
    const bc = await commandeAchat(k);
    await approuver(env, k, bc);
    await recevoir(k, bc, 1);
    await k.sql("update inscriptions_precommande set solde_avant = now() - interval '1 minute' where reference = $1", [i.reference]);
    await balayer(env, k.org);
    vider();
    await envoyer(k);
    const conserve = env.factice.envoyes.find((m) => m.texte.includes("reste acquis"))!;
    expect(conserve.texte).toContain(i.reference);
  });
});
