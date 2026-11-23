import { afterAll, describe, expect, it } from "vitest";
import { htPourTtc } from "../src/precommandes.js";
import { environnementPaiement } from "./paiementoutils.js";
import {
  avisAcompte, balayer, campagneEssai, dansJours, evenements, inscrire, inscrireEtPayer, inscriptionEnBase, lancerAcompte, payerAcompte, referenceAcompte, suivrePrecommande,
} from "./precommandesoutils.js";

const env = await environnementPaiement();
afterAll(env.fermer);

const publique = async (org: string) => (await env.api("GET", `/marketplace/${org}/campagnes`)).corps;

describe("précommandes : annoncer un arrivage et s'inscrire en payant l'acompte", () => {
  it("Q1 : la liste publique montre prix, acompte, date et progression, jamais quantité, seuil, fournisseur ni lieu", async () => {
    const b = await campagneEssai(env);
    expect(b.campagne).toMatchObject({ numero: expect.stringMatching(/^ARR-\d{4}-000001$/), statut: "ouverte", prix_ttc: 85000, acompte_unitaire: 25500 });
    const l = await publique(b.org);
    expect(l.campagnes).toEqual([{
      id: b.campagne.id, titre: "Robot pâtissier Pro", texte: null, produit: { id: b.produitId, nom: "Article ROBOT", photos: [] },
      prix_ttc: 85000, acompte_unitaire: 25500, date_limite: b.corpsCampagne.dateLimite, progression: 0, seuil_atteint: false, complet: false,
    }]);
    expect(JSON.stringify(l)).not.toMatch(/Usine|40000|seuil"|quantite|lieu/);
    const detail = (await env.api("GET", `/marketplace/${b.org}/campagnes/${b.campagne.id}`)).corps;
    expect(detail).toMatchObject({ delai_solde_jours: 7, moyens_paiement: ["orange_money", "mtn_momo"] });
    expect(detail.conditions).toContain("dans les 7 jours");
    expect(detail.conditions).toContain("remboursé en entier");
  });

  it("Q2 : l'avis signé valide l'inscription et encaisse l'acompte une seule fois", async () => {
    const b = await campagneEssai(env);
    const r = await inscrire(env, b.org, b.campagne.id, { quantite: 2 });
    expect(r.statut).toBe(201);
    expect(r.corps).toMatchObject({ reference: expect.stringMatching(/^PRE-\d{4}-000001$/), statut: "en_attente", quantite: 2, total_ttc: 170000, acompte: 51000 });
    expect(r.corps.conditions).toContain("l'acompte reste acquis à GLOMARI");
    expect((await lancerAcompte(env, b.org, r.corps)).corps).toMatchObject({ statut: "lance", moyen: "orange_money", montant: 51000 });
    const ref = await referenceAcompte(b, r.corps.reference);
    for (const attendu of ["traite", "deja_traite", "deja_traite"]) {
      expect((await avisAcompte(env, b, r.corps, ref)).corps.issue).toBe(attendu);
    }
    expect((await inscriptionEnBase(b, r.corps.reference)).statut).toBe("validee");
    const { rows: m } = await b.sql("select portefeuille_id, montant from mouvements_portefeuille where reference = $1 and source_type = 'paiement_en_ligne'", [ref]);
    expect(m).toEqual([{ portefeuille_id: b.portefeuilles.orange_money, montant: 51000 }]);
    expect((await publique(b.org)).campagnes[0].progression).toBe(40);
    expect(await evenements(b, "precommande.inscription_validee")).toHaveLength(1);
    const s = (await suivrePrecommande(env, b.org, r.corps)).corps;
    expect(s).toMatchObject({ statut: "validee", quantite: 2, acompte: 51000, campagne: { progression: 40 } });
    for (const cle of ["nom_client", "telephone", "tiers_id"]) expect(s).not.toHaveProperty(cle);
    // Le trésorier retrouve l'acompte dans les paiements en ligne du jour.
    const liste = (await b.api("GET", "/paiements-en-ligne")).corps;
    expect(liste.paiements).toEqual([expect.objectContaining({ inscription: r.corps.reference, campagne: b.campagne.numero, commande: null, montant: 51000 })]);
  });

  it("Q3 : sans les conditions, pas d'inscription ; une inscription non payée expire et ne compte pas", async () => {
    const b = await campagneEssai(env);
    expect((await inscrire(env, b.org, b.campagne.id, { conditionsAcceptees: false })).corps.erreur).toBe("conditions_non_acceptees");
    const r = await inscrire(env, b.org, b.campagne.id, { quantite: 3 });
    await b.sql("update inscriptions_precommande set expire_le = now() - interval '1 minute' where reference = $1", [r.corps.reference]);
    await balayer(env, b.org);
    expect((await inscriptionEnBase(b, r.corps.reference)).statut).toBe("expiree");
    expect((await publique(b.org)).campagnes[0].progression).toBe(0);
    expect((await lancerAcompte(env, b.org, r.corps)).corps.erreur).toBe("paiement_impossible");
  });

  it("Q4 : acompte tardif validé s'il reste de la place, sinon à rembourser ; un acompte payé deux fois n'est compté qu'une fois", async () => {
    const b = await campagneEssai(env, { seuil: 2, quantiteMax: 3 });
    const tardif = (await inscrire(env, b.org, b.campagne.id, { quantite: 1, telephone: "699111111" })).corps;
    await lancerAcompte(env, b.org, tardif);
    await b.sql("update inscriptions_precommande set expire_le = now() - interval '1 minute' where reference = $1", [tardif.reference]);
    expect((await avisAcompte(env, b, tardif)).corps.statut).toBe("validee");

    const sansPlace = (await inscrire(env, b.org, b.campagne.id, { quantite: 2, telephone: "699222222" })).corps;
    await lancerAcompte(env, b.org, sansPlace);
    await b.sql("update inscriptions_precommande set expire_le = now() - interval '1 minute' where reference = $1", [sansPlace.reference]);
    await inscrireEtPayer(env, b, 2, "699333333");
    expect((await avisAcompte(env, b, sansPlace)).corps.statut).toBe("a_rembourser");
    expect(await inscriptionEnBase(b, sansPlace.reference)).toMatchObject({ statut: "a_rembourser", motif: "complet" });
    const { rows: t } = await b.sql("select titre from taches where titre like 'Rembourser l''acompte%'");
    expect(t).toHaveLength(1);

    const double = await campagneEssai(env);
    const i = (await inscrire(env, double.org, double.campagne.id)).corps;
    await lancerAcompte(env, double.org, i);
    const premier = await referenceAcompte(double, i.reference);
    await lancerAcompte(env, double.org, i);
    const second = await referenceAcompte(double, i.reference);
    expect((await avisAcompte(env, double, i, premier)).corps.statut).toBe("validee");
    expect((await avisAcompte(env, double, i, second)).corps.statut).toBe("a_rembourser");
    expect((await double.sql("select motif from paiements_en_ligne where reference_prestataire = $1", [second])).rows[0]!.motif).toBe("deja_payee");
    expect((await inscriptionEnBase(double, i.reference)).statut).toBe("validee");
  });

  it("un téléphone connu rend la même fiche ; le prix est figé au premier acompte ; un TTC inatteignable est refusé", async () => {
    const b = await campagneEssai(env);
    const a = await inscrireEtPayer(env, b, 1, "699444444");
    const c = (await inscrire(env, b.org, b.campagne.id, { telephone: "+237 699 44 44 44", nomClient: "Awa N." })).corps;
    const [x, y] = [await inscriptionEnBase(b, a.reference), await inscriptionEnBase(b, c.reference)];
    expect(x.tiers_id).toBe(y.tiers_id);

    const url = `/precommandes/campagnes/${b.campagne.id}`;
    expect((await b.api("PATCH", url, { prixTtc: 90000 })).corps.erreur).toBe("campagne_figee");
    expect((await b.api("PATCH", url, { seuil: 3 })).corps.erreur).toBe("campagne_figee");
    const report = await b.api("PATCH", url, { dateLimite: dansJours(20) });
    expect(report.statut).toBe(200);
    expect((await b.api("PATCH", url, { dateLimite: dansJours(15) })).corps.erreur).toBe("date_limite_invalide");

    let ttc = 85000;
    while ("ht" in htPourTtc(ttc, 19.25)) ttc++;
    const avecTva = await b.article("FOUR", 60000, 19.25, 0);
    const refus = await b.api("POST", "/precommandes/campagnes", { ...b.corpsCampagne, produitId: avecTva, prixTtc: ttc });
    expect(refus.corps.erreur).toBe("prix_annonce_impossible");
    expect(refus.corps.details.proches).toHaveLength(2);
    expect((await b.api("POST", "/precommandes/campagnes", { ...b.corpsCampagne, acompteType: "montant", acompteValeur: 85000 })).corps.erreur).toBe("acompte_invalide");
    expect((await b.api("POST", "/precommandes/campagnes", { ...b.corpsCampagne, dateLimite: "2020-01-01" })).corps.erreur).toBe("date_limite_invalide");
    const ok = await b.api("POST", "/precommandes/campagnes", { ...b.corpsCampagne, produitId: avecTva, prixTtc: ttc + 1 });
    expect(ok.statut === 201 || ok.corps.erreur === "prix_annonce_impossible").toBe(true);
  });

  it("un avis d'acompte rejoué ou au mauvais montant ne change rien", async () => {
    const b = await campagneEssai(env);
    const i = (await inscrire(env, b.org, b.campagne.id)).corps;
    await payerAcompte(env, b, i);
    expect((await avisAcompte(env, b, { ...i, acompte: i.acompte - 1 })).corps.issue).toBe("deja_traite");
    const autre = (await inscrire(env, b.org, b.campagne.id, { telephone: "699555555" })).corps;
    await lancerAcompte(env, b.org, autre);
    expect((await avisAcompte(env, b, { ...autre, acompte: autre.acompte - 1 })).statut).toBe(409);
    expect((await inscriptionEnBase(b, autre.reference)).statut).toBe("en_attente");
  });
});
