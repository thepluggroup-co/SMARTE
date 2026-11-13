import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { decomposerTtc, repartirRemise } from "../src/caisse.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);

async function magasin() {
  const o = await env.nouvelleOrganisation();
  const G = o.entites.GLOMARI!;
  await env.api("PATCH", `/entites/${G}/identite`, o.jeton, { raisonSociale: "GLOMARI Sarl", niu: "M0123456789", rccm: "RC/DLA/2020/B/123" });
  const M = (await env.api("POST", "/magasins", o.jeton, { parentId: G, nom: "Akwa", type: "point_de_vente" })).corps.id as string;
  const article = async (code: string, prixVente: number, tauxTaxe: number, stock = 20) => {
    const id = (await env.api("POST", "/produits", o.jeton, { entiteId: G, code, nom: `Article ${code}`, suiviStock: true, prixVente, tauxTaxe })).corps.id as string;
    await env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: M, produitId: id, type: "entree", quantite: stock, coutUnitaire: 100 });
    return id;
  };
  const A = await article("A", 1000, 10), B = await article("B", 500, 0);
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const compte = async (role: string, entiteId: string, nom = role) => {
    const email = `${role}${Math.random().toString(36).slice(2)}@test.cm`;
    const u = await env.api("POST", "/utilisateurs", o.jeton, { email, nom, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((r: { code: string }) => r.code === role).id });
    return { id: u.corps.id as string, jeton: await env.connecter(o.slug, email) };
  };
  const caissier = await compte("caissier", M, "Awa Caissière");
  await env.api("POST", "/caisse/ouverture", o.jeton, { entiteId: M, fondOuverture: 0 });
  await env.api("POST", "/caisse/ouverture", caissier.jeton, { entiteId: M, fondOuverture: 0 });
  const vendre = (jeton: string, corps: object) => env.api("POST", "/caisse/ventes", jeton, { entiteId: M, paiements: [], ...corps });
  const especes = (montant: number) => [{ moyen: "especes", montant }];
  return { ...o, G, M, A, B, compte, caissier, vendre, especes };
}
const lignesDe = (o: { organisationId: string }, venteId: string) => dansOrganisation(env.poolApp, o.organisationId, async (c) =>
  (await c.query("select designation, montant_ht::int, montant_taxes::int, remise_pct::float, remise_montant::int, numeros_serie from lignes_comptoir where vente_id = $1 order by designation", [venteId])).rows);

describe("caisse rapide", () => {
  it("répartit une remise sans perdre un franc", () => {
    expect(repartirRemise([2200, 500], 270)).toEqual([220, 50]);
    expect(repartirRemise([100, 100, 100], 100)).toEqual([34, 33, 33]);
    expect(repartirRemise([5, 995], 1000)).toEqual([5, 995]);
    expect(repartirRemise([700], 0)).toEqual([0]);
    expect(decomposerTtc(990, 10)).toEqual({ ht: 900, taxes: 90 });
    expect(decomposerTtc(450, 0)).toEqual({ ht: 450, taxes: 0 });
  });

  it("accepte une remise en montant sur une ligne, convertie par le serveur, avec le plafond du caissier", async () => {
    const o = await magasin();
    const ligne = (extra: object) => ({ lignes: [{ produitId: o.A, quantite: 1, ...extra }] });
    // 1 100 FCFA TTC ; 110 FCFA de remise = 10 % : le caissier peut. Au delà, il faut un superviseur.
    const v = await o.vendre(o.caissier.jeton, { ...ligne({ remiseMontant: 110 }), paiements: o.especes(1000) });
    expect(v.corps).toMatchObject({ total_ht: 900, total_taxes: 90, total_ttc: 990, rendu: 10, remise_totale: 110 });
    expect(await lignesDe(o, v.corps.id)).toEqual([{ designation: "Article A", montant_ht: 900, montant_taxes: 90, remise_pct: 10, remise_montant: 110, numeros_serie: [] }]);
    expect((await o.vendre(o.caissier.jeton, { ...ligne({ remiseMontant: 111 }), paiements: o.especes(1100) })).corps.erreur).toBe("remise_non_autorisee");
    expect((await o.vendre(o.jeton, { ...ligne({ remiseMontant: 300 }), paiements: o.especes(800) })).corps).toMatchObject({ total_ttc: 800 });
    expect((await o.vendre(o.jeton, { ...ligne({ remiseMontant: 1200 }), paiements: o.especes(1) })).corps.erreur).toBe("remise_invalide");
    expect((await o.vendre(o.jeton, { ...ligne({ remiseMontant: 100, remisePct: 5 }), paiements: o.especes(1100) })).corps.erreur).toBe("donnees_invalides");
    // La remise en pourcentage d'avant fonctionne toujours, sans changement.
    expect((await o.vendre(o.caissier.jeton, { ...ligne({ remisePct: 10 }), paiements: o.especes(990) })).corps).toMatchObject({ total_ht: 900, total_taxes: 90 });
    expect((await o.vendre(o.caissier.jeton, { ...ligne({ remisePct: 11 }), paiements: o.especes(990) })).corps.erreur).toBe("remise_non_autorisee");
  });

  it("répartit la remise de toute la vente sur les lignes : taxe et total restent justes", async () => {
    const o = await magasin();
    const panier = { lignes: [{ produitId: o.A, quantite: 2 }, { produitId: o.B, quantite: 1 }] };
    // 2 200 + 500 = 2 700 FCFA. 270 FCFA de remise : 220 sur A (taxé), 50 sur B.
    const v = await o.vendre(o.caissier.jeton, { ...panier, remiseGlobaleMontant: 270, paiements: o.especes(2430) });
    expect(v.corps).toMatchObject({ total_ht: 2250, total_taxes: 180, total_ttc: 2430, remise_globale: 270, remise_totale: 270, rendu: 0 });
    expect(await lignesDe(o, v.corps.id)).toEqual([
      { designation: "Article A", montant_ht: 1800, montant_taxes: 180, remise_pct: 10, remise_montant: 220, numeros_serie: [] },
      { designation: "Article B", montant_ht: 450, montant_taxes: 0, remise_pct: 10, remise_montant: 50, numeros_serie: [] },
    ]);
    expect((await o.vendre(o.caissier.jeton, { ...panier, remiseGlobalePct: 10, paiements: o.especes(2430) })).corps).toMatchObject({ total_ttc: 2430, remise_globale: 270 });
    // Même plafond que pour une ligne, remises cumulées comprises.
    expect((await o.vendre(o.caissier.jeton, { ...panier, remiseGlobalePct: 20, paiements: o.especes(2700) })).corps.erreur).toBe("remise_non_autorisee");
    expect((await o.vendre(o.caissier.jeton, { lignes: [{ produitId: o.A, quantite: 2, remisePct: 8 }, { produitId: o.B, quantite: 1 }], remiseGlobalePct: 8, paiements: o.especes(2700) })).corps.erreur).toBe("remise_non_autorisee");
    expect((await o.vendre(o.jeton, { ...panier, remiseGlobalePct: 20, paiements: o.especes(2160) })).corps).toMatchObject({ total_ttc: 2160 });
    expect((await o.vendre(o.jeton, { ...panier, remiseGlobaleMontant: 2701, paiements: o.especes(1) })).corps.erreur).toBe("remise_invalide");
    expect((await o.vendre(o.jeton, { ...panier, remiseGlobaleMontant: 10, remiseGlobalePct: 1, paiements: o.especes(2700) })).corps.erreur).toBe("donnees_invalides");
  });

  it("enregistre le vendeur, crée un client rapide dans la branche et prépare l'écran de caisse", async () => {
    const o = await magasin();
    const formateur = await o.compte("formateur", o.entites.GTA!);
    const base = { lignes: [{ produitId: o.B, quantite: 1 }], paiements: o.especes(500) };
    expect((await o.vendre(o.jeton, base)).corps).toMatchObject({ vendeur_id: o.adminId, vendeur: "Admin" });
    expect((await o.vendre(o.jeton, { ...base, vendeurId: o.caissier.id })).corps).toMatchObject({ vendeur_id: o.caissier.id, vendeur: "Awa Caissière", caissier_id: o.adminId });
    expect((await o.vendre(o.jeton, { ...base, vendeurId: formateur.id })).corps.erreur).toBe("vendeur_invalide");

    const c = await env.api("POST", "/caisse/clients", o.caissier.jeton, { entiteId: o.M, nom: "Madame Ngo", telephone: "699 11 22 33" });
    expect(c.corps).toMatchObject({ nom: "Madame Ngo", telephone: "237699112233", deja_connu: false });
    expect((await env.api("POST", "/caisse/clients", o.caissier.jeton, { entiteId: o.M, nom: "Autre nom", telephone: "699112233" })).corps).toMatchObject({ id: c.corps.id, deja_connu: true });
    expect((await env.api("POST", "/caisse/clients", o.caissier.jeton, { entiteId: o.M, nom: "X Y", telephone: "12 34 56" })).corps.erreur).toBe("telephone_invalide");
    expect((await env.api("POST", "/caisse/clients", formateur.jeton, { entiteId: o.M, nom: "Intrus", telephone: "699000000" })).statut).toBe(403);
    // La fiche appartient à la branche GLOMARI : GTA ne la voit pas et ne peut pas la créer pour elle.
    const { rows: [t] } = await dansOrganisation(env.poolApp, o.organisationId, (x) => x.query("select branche_id, roles from tiers where id = $1", [c.corps.id]));
    expect(t).toEqual({ branche_id: o.G, roles: ["client"] });
    expect((await env.api("POST", "/caisse/clients", o.jeton, { entiteId: o.entites.GTA, nom: "Apprenant", telephone: "699000001" })).statut).toBe(403);
    expect((await env.api("GET", `/caisse/clients?entiteId=${o.M}&q=ngo`, o.caissier.jeton)).corps).toEqual([{ id: c.corps.id, nom: "Madame Ngo", telephone: "237699112233", reste_du: 0 }]);

    const cat = (await env.api("POST", "/categories-articles", o.jeton, { entiteId: o.G, nom: "Alimentation" })).corps.id;
    const ecran = (await env.api("GET", "/caisse", o.caissier.jeton)).corps.ouvertes[0];
    expect(ecran).toMatchObject({ identite: { raison_sociale: "GLOMARI Sarl", niu: "M0123456789", rccm: "RC/DLA/2020/B/123" }, superviseur: false, credit: false, remise_max: 10, categories: [{ id: cat, nom: "Alimentation" }] });
    expect(ecran.stocks[o.B]).toBe(18);
    expect(ecran.vendeurs.map((x: { nom: string }) => x.nom)).toEqual(["Admin", "Awa Caissière"]);
    const ventes = (await env.api("GET", `/caisse/sessions/${(await env.api("GET", "/caisse", o.jeton)).corps.ouvertes[0].id}/ventes`, o.jeton)).corps;
    expect(ventes.map((x: { vendeur: string }) => x.vendeur).sort()).toEqual(["Admin", "Awa Caissière"]);
  });

  it("vend à crédit à un client identifié, avec le droit dédié, puis encaisse le reste dû", async () => {
    const o = await magasin();
    const client = (await env.api("POST", "/caisse/clients", o.jeton, { entiteId: o.M, nom: "Monsieur Fotso", telephone: "677000111" })).corps.id;
    const panier = { lignes: [{ produitId: o.A, quantite: 2 }] }; // 2 200 FCFA
    expect((await o.vendre(o.jeton, { ...panier, paiements: o.especes(1000) })).corps.erreur).toBe("paiement_insuffisant");
    expect((await o.vendre(o.jeton, { ...panier })).corps.erreur).toBe("paiement_insuffisant");
    expect((await o.vendre(o.jeton, { ...panier, credit: true, paiements: o.especes(1000) })).corps.erreur).toBe("credit_sans_client");
    expect((await o.vendre(o.caissier.jeton, { ...panier, credit: true, tiersId: client, paiements: o.especes(1000) })).corps.erreur).toBe("credit_non_autorise");
    expect((await o.vendre(o.jeton, { ...panier, credit: true, tiersId: client, paiements: o.especes(1000), horsLigne: true, vendueLe: new Date().toISOString(), cleAppareil: crypto.randomUUID() })).corps.erreur).toBe("credit_hors_connexion");

    const v = await o.vendre(o.jeton, { ...panier, credit: true, tiersId: client, echeance: "2099-01-31", paiements: o.especes(1000) });
    expect(v.corps).toMatchObject({ total_ttc: 2200, reste_du: 1200, rendu: 0, tiers_id: client });
    // Crédit total, sans aucun paiement.
    const w = await o.vendre(o.jeton, { lignes: [{ produitId: o.B, quantite: 1 }], credit: true, tiersId: client });
    expect(w.corps).toMatchObject({ total_ttc: 500, reste_du: 500 });
    // La créance est visible avec celles des factures.
    expect((await env.api("GET", "/creances", o.jeton)).corps).toEqual([expect.objectContaining({ client: "Monsieur Fotso", total: 1700, non_echu: 1700 })]);
    expect((await env.api("GET", `/caisse/clients?entiteId=${o.M}&q=fotso`, o.jeton)).corps[0].reste_du).toBe(1700);
    const credits = (await env.api("GET", `/caisse/credits?entiteId=${o.M}`, o.caissier.jeton)).corps;
    expect(credits.map((x: { numero: string; reste: number }) => [x.numero, x.reste])).toEqual([[v.corps.numero, 1200], [w.corps.numero, 500]]);

    // Le caissier encaisse le reste dans sa propre caisse ouverte.
    const regler = (jeton: string, id: string, paiements: object[]) => env.api("POST", `/caisse/ventes/${id}/reglements`, jeton, { paiements });
    expect((await regler(o.caissier.jeton, v.corps.id, [{ moyen: "mtn_momo", montant: 500 }])).corps.erreur).toBe("reference_obligatoire");
    expect((await regler(o.caissier.jeton, v.corps.id, o.especes(1201))).corps).toMatchObject({ erreur: "reglement_trop_eleve", details: { reste: 1200 } });
    expect((await regler(o.caissier.jeton, v.corps.id, [...o.especes(400), { moyen: "mtn_momo", montant: 300, reference: "MM1" }])).corps).toEqual({ numero: v.corps.numero, regle: 700, reste: 500 });
    expect((await env.api("GET", "/creances", o.jeton)).corps[0].total).toBe(1000);
    const caisse = (await env.api("GET", "/caisse", o.caissier.jeton)).corps.ouvertes[0];
    expect(caisse).toMatchObject({ especes_nettes: 400, reglements_credit: [{ moyen: "especes", montant: 400 }, { moyen: "mtn_momo", montant: 300 }] });
    expect((await env.api("GET", "/caisse", o.jeton)).corps.ouvertes[0]).toMatchObject({ especes_nettes: 1000, credits_accordes: 1700 });
    const cloture = await env.api("POST", `/caisse/sessions/${caisse.id}/cloture`, o.caissier.jeton, { especesComptees: 400 });
    expect(cloture.corps).toMatchObject({ attendues: 400, ecart: 0 });
    expect((await regler(o.caissier.jeton, v.corps.id, o.especes(100))).corps.erreur).toBe("caisse_fermee");
    // Un crédit déjà réglé en partie ne s'annule plus ; un crédit intact s'annule et disparaît des créances.
    expect((await env.api("POST", `/caisse/ventes/${v.corps.id}/annulation`, o.jeton, { motif: "Erreur de saisie" })).corps.erreur).toBe("credit_deja_regle");
    expect((await env.api("POST", `/caisse/ventes/${w.corps.id}/annulation`, o.jeton, { motif: "Erreur de saisie" })).statut).toBe(200);
    expect((await env.api("GET", "/creances", o.jeton)).corps[0].total).toBe(500);
    expect((await regler(o.jeton, w.corps.id, o.especes(100))).corps.erreur).toBe("vente_sans_credit");
    const autre = await env.nouvelleOrganisation();
    expect((await regler(autre.jeton, v.corps.id, o.especes(100))).statut).toBe(404);
  });

  it("vend un numéro de série en stock, une seule fois, et le remet en stock à l'annulation", async () => {
    const o = await magasin();
    expect((await env.api("POST", `/produits/${o.A}/series`, o.jeton, { numeros: ["SN1", "SN2"] })).corps.crees).toBe(2);
    expect((await env.api("GET", "/caisse", o.jeton)).corps.ouvertes[0].series).toEqual({ [o.A]: 2 });
    const ligne = (numerosSerie: string[], quantite = 1) => ({ lignes: [{ produitId: o.A, quantite, numerosSerie }], paiements: o.especes(1100 * quantite) });
    expect((await o.vendre(o.jeton, ligne(["INCONNU"]))).corps.erreur).toBe("serie_indisponible");
    expect((await o.vendre(o.jeton, ligne(["SN1", "SN2"]))).corps.erreur).toBe("donnees_invalides");
    const v = await o.vendre(o.jeton, ligne(["SN1"]));
    expect(v.statut).toBe(201);
    expect((await lignesDe(o, v.corps.id))[0].numeros_serie).toEqual(["SN1"]);
    expect((await o.vendre(o.jeton, ligne(["SN1"]))).corps.erreur).toBe("serie_indisponible");
    expect((await env.api("GET", "/caisse", o.jeton)).corps.ouvertes[0].series).toEqual({ [o.A]: 1 });
    await env.api("POST", `/caisse/ventes/${v.corps.id}/annulation`, o.jeton, { motif: "Retour immédiat" });
    expect((await env.api("GET", "/caisse", o.jeton)).corps.ouvertes[0].series).toEqual({ [o.A]: 2 });
  });
});
