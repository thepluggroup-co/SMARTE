import { afterAll, describe, expect, it } from "vitest";
import { utilisateur } from "./canaloutils.js";
import { environnementPaiement } from "./paiementoutils.js";
import {
  approuver, avisAcompte, campagneEnBase, campagneEssai, commandeAchat, evenements, inscrire, inscrireEtPayer, lancerAcompte,
} from "./precommandesoutils.js";

const env = await environnementPaiement();
afterAll(env.fermer);

describe("précommandes : seuil atteint, un seul bon de commande en brouillon", () => {
  it("Q5 : deux acomptes simultanés qui franchissent le seuil ne créent qu'un bon de commande", async () => {
    const b = await campagneEssai(env, { seuil: 5 });
    await inscrireEtPayer(env, b, 3);
    const [x, y] = [
      (await inscrire(env, b.org, b.campagne.id, { telephone: "699100001" })).corps,
      (await inscrire(env, b.org, b.campagne.id, { telephone: "699100002" })).corps,
    ];
    await lancerAcompte(env, b.org, x);
    await lancerAcompte(env, b.org, y);
    const r = await Promise.all([avisAcompte(env, b, x), avisAcompte(env, b, y)]);
    expect(r.map((a) => a.corps.statut)).toEqual(["validee", "validee"]);

    const k = await campagneEnBase(b);
    expect(k.statut).toBe("declenchee");
    const { rows: bc } = await b.sql("select id, statut, entite_id, fournisseur_id, cree_par from commandes_achat");
    expect(bc).toEqual([{ id: k.commande_achat_id, statut: "brouillon", entite_id: b.lieu, fournisseur_id: b.fournisseurId, cree_par: b.o.adminId }]);
    const { rows: lignes } = await b.sql("select produit_id, quantite::float, prix_unitaire from lignes_achat where commande_id = $1", [k.commande_achat_id]);
    expect(lignes).toEqual([{ produit_id: b.produitId, quantite: 5, prix_unitaire: 40000 }]);
    expect(await evenements(b, "precommande.seuil_atteint")).toHaveLength(1);
    expect((await env.api("GET", `/marketplace/${b.org}/campagnes`)).corps.campagnes[0]).toMatchObject({ progression: 100, seuil_atteint: true });
  });

  it("Q6 : l'approbation exige le droit, ne descend pas sous les précommandes et respecte la séparation des tâches", async () => {
    const b = await campagneEssai(env, { seuil: 2 });
    await inscrireEtPayer(env, b, 2);
    const id = await commandeAchat(b);
    const acheteur = await utilisateur(env, b.o, "acheteur", b.lieu);
    expect((await approuver(env, b, id, acheteur)).statut).toBe(403);

    await b.api("PUT", `/achats/commandes/${id}/lignes`, { lignes: [{ produitId: b.produitId, quantite: 1, prixUnitaire: 40000 }] });
    const trop = await approuver(env, b, id);
    expect(trop.corps).toEqual({ erreur: "quantite_inferieure_aux_precommandes", details: { validee: 2, commandee: 1 } });

    await b.api("PUT", `/achats/commandes/${id}/lignes`, { lignes: [{ produitId: b.produitId, quantite: 2, prixUnitaire: 38000 }] });
    await b.api("PUT", "/separation", { ecritures: false, commandes: true, facturesFournisseur: false, pertes: true });
    expect((await approuver(env, b, id)).corps.erreur).toBe("separation_des_taches");
    const autre = await utilisateur(env, b.o, "administrateur", b.G);
    expect((await approuver(env, b, id, autre)).statut).toBe(200);
    expect((await b.sql("select statut from commandes_achat where id = $1", [id])).rows[0]!.statut).toBe("approuvee");
    // Approuver, c'est commander au fabricant : les inscrits en sont informés.
    expect(await evenements(b, "precommande.arrivage_etape")).toEqual([expect.objectContaining({ campagne: b.campagne.id, etape: "commandee" })]);
  });

  it("Q7 : une fois le bon approuvé, les inscriptions ne dépassent pas la quantité commandée", async () => {
    const b = await campagneEssai(env, { seuil: 5 });
    await inscrireEtPayer(env, b, 5);
    const id = await commandeAchat(b);
    await b.api("PUT", `/achats/commandes/${id}/lignes`, { lignes: [{ produitId: b.produitId, quantite: 6, prixUnitaire: 40000 }] });
    expect((await approuver(env, b, id)).statut).toBe(200);
    const deux = await inscrire(env, b.org, b.campagne.id, { quantite: 2, telephone: "699200001" });
    expect(deux.corps).toEqual({ erreur: "campagne_complete", details: { disponible: 1 } });
    expect((await inscrire(env, b.org, b.campagne.id, { quantite: 1, telephone: "699200002" })).statut).toBe(201);
    expect((await env.api("GET", `/marketplace/${b.org}/campagnes`)).corps.campagnes[0].complet).toBe(true);
  });

  it("si l'auteur ne peut plus commander, l'acompte reste validé et les acheteurs préparent le bon de commande", async () => {
    const b = await campagneEssai(env, { seuil: 1 });
    // Une campagne créée par une acheteuse, qui quitte ensuite l'entreprise.
    const jeton = await utilisateur(env, b.o, "acheteur", b.G);
    const creee = await env.api("POST", "/precommandes/campagnes", jeton, b.corpsCampagne);
    expect(creee.statut).toBe(201);
    await b.sql("update utilisateurs set actif = false where id = $1", [creee.corps.cree_par]);
    const i = (await inscrire(env, b.org, creee.corps.id, { telephone: "699300001" })).corps;
    await lancerAcompte(env, b.org, i);
    expect((await avisAcompte(env, b, i)).corps.statut).toBe("validee");
    const k = (await b.sql("select statut, commande_achat_id from campagnes_arrivage where id = $1", [creee.corps.id])).rows[0]!;
    expect(k).toEqual({ statut: "declenchee", commande_achat_id: null });
    const { rows: t } = await b.sql("select titre from taches where titre like 'Préparer le bon de commande%'");
    expect(t).toEqual([{ titre: `Préparer le bon de commande de la campagne ${creee.corps.numero} : acheteur_invalide` }]);

    const url = `/precommandes/campagnes/${creee.corps.id}/bon-de-commande`;
    const bc = await b.api("POST", url);
    expect(bc.statut).toBe(201);
    expect(bc.corps.commande_achat).toMatchObject({ statut: "brouillon" });
    expect((await b.api("POST", url)).corps.erreur).toBe("bon_de_commande_existant");
  });
});
