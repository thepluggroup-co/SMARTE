import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { rentabilite } from "../src/achats.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);

async function magasin() {
  const o = await env.nouvelleOrganisation();
  const depot = async (code: string) => {
    const d = await env.api("POST", "/entites", o.jeton, { parentId: o.entites.GLOMARI, code, nom: code, type: "entrepot" });
    await env.api("PUT", `/entites/${d.corps.id}/modules/achats_stocks`, o.jeton, { actif: true });
    return d.corps.id as string;
  };
  const [depotA, depotB, depotC] = [await depot("DEPOT-A"), await depot("DEPOT-B"), await depot("DEPOT-C")];
  const creer = async (code: string, extra = {}) =>
    (await env.api("POST", "/produits", o.jeton, { entiteId: o.entites.GLOMARI, code, nom: code, suiviStock: true, ...extra })).corps.id as string;
  const fournisseur = await env.api("POST", "/tiers", o.jeton, { type: "entreprise", nom: "Fournisseur" });
  return { ...o, depotA, depotB, depotC, a: await creer("A"), b: await creer("B"), fournisseurId: fournisseur.corps.id as string, creer };
}
type M = Awaited<ReturnType<typeof magasin>>;

const stock = async (o: M, produitId: string, entite: string) =>
  (await env.api("GET", "/stocks", o.jeton)).corps.find((n: { produit_id: string; entite_id: string }) => n.produit_id === produitId && n.entite_id === entite)?.quantite ?? 0;
const coutMoyen = async (o: M, id: string) =>
  (await env.api("GET", "/produits", o.jeton)).corps.find((p: { id: string }) => p.id === id).cout_moyen;
const entree = (o: M, produitId: string, quantite: number, entiteId = o.depotA, coutUnitaire = 100) =>
  env.api("POST", "/stocks/mouvements", o.jeton, { entiteId, produitId, type: "entree", quantite, coutUnitaire });
const commander = (o: M, lignes: object[], jeton = o.jeton) =>
  env.api("POST", "/achats/commandes", jeton, { entiteId: o.depotA, fournisseurId: o.fournisseurId, date: "2026-03-01", lignes });

async function utilisateur(o: M, code: string, entiteId: string) {
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
  await env.api("POST", "/utilisateurs", o.jeton, {
    email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((r: { code: string }) => r.code === code).id,
  });
  return env.connecter(o.slug, email);
}

describe("achats", () => {
  it("va de la commande approuvée aux réceptions partielles, avec coût moyen exact", async () => {
    const o = await magasin();
    await entree(o, o.a, 10, o.depotA, 1000);
    const c = await commander(o, [{ produitId: o.a, quantite: 10, prixUnitaire: 2000 }, { produitId: o.b, quantite: 5, prixUnitaire: 300 }]);
    expect(c.corps).toMatchObject({ numero: expect.stringMatching(/^BC-\d{4}-000001$/), statut: "brouillon", total: 21500 });
    expect((await env.api("GET", `/tiers/${o.fournisseurId}`, o.jeton)).corps.roles).toContain("fournisseur");
    const url = `/achats/commandes/${c.corps.id}`;
    const d = async () => (await env.api("GET", url, o.jeton)).corps;
    const [la, lb] = (await d()).lignes;
    const recevoir = (lignes: object[], extra = {}) => env.api("POST", `${url}/receptions`, o.jeton, { lignes, ...extra });

    expect((await recevoir([{ ligneId: la.id, quantite: 1 }])).corps.erreur).toBe("commande_non_approuvee");
    expect(await stock(o, o.a, o.depotA)).toBe(10);
    expect((await env.api("POST", `${url}/approbation`, o.jeton)).statut).toBe(200);
    expect((await env.api("POST", `${url}/approbation`, o.jeton)).statut).toBe(409);
    expect((await env.api("PUT", `${url}/lignes`, o.jeton, { lignes: [{ produitId: o.a, quantite: 1, prixUnitaire: 1 }] })).corps.erreur).toBe("commande_figee");

    expect((await recevoir([{ ligneId: la.id, quantite: 11 }])).corps.erreur).toBe("quantite_superieure_a_la_commande");
    expect(await stock(o, o.a, o.depotA)).toBe(10);
    const r1 = await recevoir([{ ligneId: la.id, quantite: 10 }]);
    expect(r1.corps.statut).toBe("recue_partiellement");
    expect(await stock(o, o.a, o.depotA)).toBe(20);
    expect(await coutMoyen(o, o.a)).toBe(1500);
    const r2 = await recevoir([{ ligneId: lb.id, quantite: 2 }], { cloturer: true, note: "Reliquat abandonné" });
    expect(r2.corps.statut).toBe("recue");
    expect((await d()).receptions).toHaveLength(2);
    expect((await env.api("POST", `${url}/annulation`, o.jeton, { motif: "Trop tard" })).corps.erreur).toBe("commande_deja_recue");
    const m = (await env.api("GET", `/stocks/mouvements?produitId=${o.a}`, o.jeton)).corps;
    expect(m[0]).toMatchObject({ type: "achat", document: c.corps.numero });
  });

  it("deux réceptions simultanées ne dépassent jamais la commande", async () => {
    const o = await magasin();
    const c = await commander(o, [{ produitId: o.a, quantite: 3, prixUnitaire: 100 }]);
    const url = `/achats/commandes/${c.corps.id}`;
    await env.api("POST", `${url}/approbation`, o.jeton);
    const ligneId = (await env.api("GET", url, o.jeton)).corps.lignes[0].id;
    const r = await Promise.all(Array.from({ length: 6 }, () => env.api("POST", `${url}/receptions`, o.jeton, { lignes: [{ ligneId, quantite: 1 }] })));
    expect(r.filter((x) => x.statut === 201)).toHaveLength(3);
    expect(await stock(o, o.a, o.depotA)).toBe(3);
  });

  it("une commande annulée ne se reçoit pas, et une ligne doit être un produit suivi", async () => {
    const o = await magasin();
    const c = await commander(o, [{ produitId: o.a, quantite: 1, prixUnitaire: 1 }]);
    const url = `/achats/commandes/${c.corps.id}`;
    expect((await env.api("POST", `${url}/annulation`, o.jeton, {})).statut).toBe(400);
    await env.api("POST", `${url}/annulation`, o.jeton, { motif: "Erreur" });
    expect((await env.api("POST", `${url}/approbation`, o.jeton)).statut).toBe(409);
    const s = await env.api("POST", "/produits", o.jeton, { entiteId: o.entites.GLOMARI, code: "S", nom: "S", type: "service" });
    expect((await commander(o, [{ produitId: s.corps.id, quantite: 1, prixUnitaire: 1 }])).corps.erreur).toBe("produit_sans_stock");
    expect((await commander(o, [{ produitId: o.a, quantite: 1, prixUnitaire: 1 }, { produitId: o.a, quantite: 2, prixUnitaire: 1 }])).corps.erreur).toBe("produit_en_double");
  });

  it("sépare les rôles : l'acheteur commande, n'approuve pas et ne reçoit pas", async () => {
    const o = await magasin();
    const acheteur = await utilisateur(o, "acheteur", o.depotA);
    const magasinier = await utilisateur(o, "magasinier", o.depotA);
    const f = await env.api("POST", "/tiers", acheteur, { type: "entreprise", nom: "Son fournisseur" });
    const c = await env.api("POST", "/achats/commandes", acheteur, { entiteId: o.depotA, fournisseurId: f.corps.id, date: "2026-03-01", lignes: [{ produitId: o.a, quantite: 1, prixUnitaire: 1 }] });
    expect(c.statut).toBe(201);
    const url = `/achats/commandes/${c.corps.id}`;
    expect((await env.api("POST", `${url}/approbation`, acheteur)).statut).toBe(403);
    expect((await env.api("POST", `${url}/approbation`, magasinier)).statut).toBe(403);
    await env.api("POST", `${url}/approbation`, o.jeton);
    const ligneId = (await env.api("GET", url, magasinier)).corps.lignes[0].id;
    expect((await env.api("POST", `${url}/receptions`, acheteur, { lignes: [{ ligneId, quantite: 1 }] })).statut).toBe(403);
    expect((await env.api("POST", `${url}/receptions`, magasinier, { lignes: [{ ligneId, quantite: 1 }] })).statut).toBe(201);
  });
});

describe("approvisionnement", () => {
  it("suggère jusqu'au stock cible, moins ce qui est déjà attendu", async () => {
    const o = await magasin();
    const p = await o.creer("C", { seuilAlerte: 5, stockCible: 20 });
    await entree(o, p, 3);
    const l = async () => (await env.api("GET", "/achats/reapprovisionnement", o.jeton)).corps;
    expect((await l())[0]).toMatchObject({ produit_id: p, stock: 3, attendu: 0, a_commander: 17 });
    await commander(o, [{ produitId: p, quantite: 7, prixUnitaire: 1 }]);
    expect((await l())[0]).toMatchObject({ attendu: 7, a_commander: 10 });
    await entree(o, p, 5);
    expect(await l()).toEqual([]);
  });
});

describe("transferts confirmés", () => {
  const creer = (o: M, quantite = 4, jeton = o.jeton) => env.api("POST", "/transferts", jeton, {
    depuisId: o.depotA, versId: o.depotB, lignes: [{ produitId: o.a, quantite }],
  });

  it("déplace le stock seulement à chaque confirmation", async () => {
    const o = await magasin();
    await entree(o, o.a, 5);
    const t = await creer(o);
    expect(t.corps).toMatchObject({ statut: "demande", numero: expect.stringMatching(/^TR-\d{4}-000001$/) });
    expect(await stock(o, o.a, o.depotA)).toBe(5);
    const url = `/transferts/${t.corps.id}`;
    const reception = (quantiteRecue: number, motifEcart?: string) =>
      env.api("POST", `${url}/reception`, o.jeton, { lignes: [{ produitId: o.a, quantiteRecue }], motifEcart });
    expect((await reception(4)).corps.erreur).toBe("transfert_non_expedie");
    expect((await env.api("POST", `${url}/expedition`, o.jeton)).corps.statut).toBe("expedie");
    expect(await stock(o, o.a, o.depotA)).toBe(1);
    expect(await stock(o, o.a, o.depotB)).toBe(0);
    expect((await env.api("POST", `${url}/expedition`, o.jeton)).statut).toBe(409);
    expect((await reception(5)).corps.erreur).toBe("quantite_superieure_a_lexpedie");
    expect((await reception(3)).corps.erreur).toBe("motif_ecart_obligatoire");
    expect((await reception(3, "Un article cassé")).corps).toEqual({ statut: "recu", ecart: true });
    expect(await stock(o, o.a, o.depotB)).toBe(3);
    expect((await reception(3, "Encore")).statut).toBe(409);
    const liste = (await env.api("GET", "/transferts", o.jeton)).corps;
    expect(liste[0]).toMatchObject({ statut: "recu", motif_ecart: "Un article cassé", depuis: "DEPOT-A" });
    expect(liste[0].lignes[0]).toMatchObject({ quantite: 4, quantite_recue: 3 });
  });

  it("refuse une expédition sans stock, et ne dépasse pas le disponible en simultané", async () => {
    const o = await magasin();
    await entree(o, o.a, 5);
    const [t1, t2] = [await creer(o, 4), await creer(o, 4)];
    const r = await Promise.all([t1, t2].map((t) => env.api("POST", `/transferts/${t.corps.id}/expedition`, o.jeton)));
    expect(r.filter((x) => x.statut === 200)).toHaveLength(1);
    expect(r.find((x) => x.statut !== 200)!.corps.erreur).toBe("stock_insuffisant");
    expect(await stock(o, o.a, o.depotA)).toBe(1);
  });

  it("une annulation après expédition rend le stock à l'origine", async () => {
    const o = await magasin();
    await entree(o, o.a, 5);
    const t = await creer(o);
    await env.api("POST", `/transferts/${t.corps.id}/expedition`, o.jeton);
    expect((await env.api("POST", `/transferts/${t.corps.id}/annulation`, o.jeton, { motif: "Camion en panne" })).corps.statut).toBe("annule");
    expect(await stock(o, o.a, o.depotA)).toBe(5);
    expect((await env.api("POST", `/transferts/${t.corps.id}/annulation`, o.jeton, { motif: "Encore" })).statut).toBe(409);
    expect((await env.api("POST", "/transferts", o.jeton, { depuisId: o.depotB, versId: o.depotB, lignes: [{ produitId: o.a, quantite: 1 }] })).corps.erreur).toBe("transfert_identique");
  });

  it("chaque entrepôt ne confirme que sa part", async () => {
    const o = await magasin();
    await entree(o, o.a, 5);
    const origine = await utilisateur(o, "magasinier", o.depotA);
    const arrivee = await utilisateur(o, "magasinier", o.depotB);
    const ailleurs = await utilisateur(o, "magasinier", o.depotC);
    expect((await creer(o, 1, ailleurs)).statut).toBe(403); // Un droit sur IP2EL ne remonte pas à GTA.
    const t = await creer(o, 2, arrivee);
    const url = `/transferts/${t.corps.id}`;
    expect((await env.api("POST", `${url}/expedition`, arrivee)).statut).toBe(403);
    expect((await env.api("POST", `${url}/expedition`, origine)).statut).toBe(200);
    const corps = { lignes: [{ produitId: o.a, quantiteRecue: 2 }] };
    expect((await env.api("POST", `${url}/reception`, origine, corps)).statut).toBe(403);
    expect((await env.api("POST", `${url}/reception`, arrivee, corps)).statut).toBe(200);
  });
});

describe("réajustements", () => {
  const proposer = (o: M, compte: number, jeton = o.jeton) => env.api("POST", "/stocks/reajustements", jeton, {
    entiteId: o.depotA, produitId: o.a, compte, motif: "Inventaire",
  });

  it("ne change le stock qu'après confirmation, en gardant les ventes intermédiaires", async () => {
    const o = await magasin();
    await entree(o, o.a, 10);
    const magasinier = await utilisateur(o, "magasinier", o.depotA);
    const r = await proposer(o, 8, magasinier);
    expect(r.corps).toMatchObject({ statut: "en_attente", stock_constate: 10, quantite_comptee: 8, ecart: -2 });
    expect(await stock(o, o.a, o.depotA)).toBe(10);
    const url = `/stocks/reajustements/${r.corps.id}/decision`;
    expect((await env.api("POST", url, magasinier, { decision: "confirme" })).statut).toBe(403);
    await env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: o.depotA, produitId: o.a, type: "sortie", quantite: 1, motif: "Vente" });
    expect((await env.api("POST", url, o.jeton, { decision: "confirme" })).corps).toEqual({ statut: "confirme", ecart: -2 });
    expect(await stock(o, o.a, o.depotA)).toBe(7);
    expect((await env.api("POST", url, o.jeton, { decision: "confirme" })).corps.erreur).toBe("deja_decide");
    expect((await env.api("GET", "/stocks/reajustements", o.jeton)).corps[0]).toMatchObject({ statut: "confirme", propose_par: "magasinier", ecart: -2 });
  });

  it("le rejet exige un motif, et rien n'est modifié", async () => {
    const o = await magasin();
    await entree(o, o.a, 10);
    const r = await proposer(o, 50);
    const url = `/stocks/reajustements/${r.corps.id}/decision`;
    expect((await env.api("POST", url, o.jeton, { decision: "rejete" })).statut).toBe(400);
    expect((await env.api("POST", url, o.jeton, { decision: "rejete", motif: "Recompter" })).corps.statut).toBe("rejete");
    expect(await stock(o, o.a, o.depotA)).toBe(10);
  });

  it("refuse une confirmation qui rendrait le stock négatif", async () => {
    const o = await magasin();
    await entree(o, o.a, 5);
    const r = await proposer(o, 0);
    await env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: o.depotA, produitId: o.a, type: "sortie", quantite: 3, motif: "Vente" });
    expect((await env.api("POST", `/stocks/reajustements/${r.corps.id}/decision`, o.jeton, { decision: "confirme" })).corps.erreur).toBe("stock_insuffisant");
    expect(await stock(o, o.a, o.depotA)).toBe(2);
  });
});

describe("isolation", () => {
  it("un autre client ne voit et ne touche rien", async () => {
    const a = await magasin();
    const b = await magasin();
    await entree(b, b.a, 5);
    const c = await commander(b, [{ produitId: b.a, quantite: 1, prixUnitaire: 1 }]);
    const t = await env.api("POST", "/transferts", b.jeton, { depuisId: b.depotA, versId: b.depotB, lignes: [{ produitId: b.a, quantite: 1 }] });
    const r = await env.api("POST", "/stocks/reajustements", b.jeton, { entiteId: b.depotA, produitId: b.a, compte: 1, motif: "Inv" });
    for (const [m, u, x] of [
      ["GET", `/achats/commandes/${c.corps.id}`, undefined], ["POST", `/achats/commandes/${c.corps.id}/approbation`, undefined],
      ["POST", `/transferts/${t.corps.id}/expedition`, undefined], ["POST", `/stocks/reajustements/${r.corps.id}/decision`, { decision: "confirme" }],
    ] as const) expect((await env.api(m, u, a.jeton, x)).statut, u).toBe(404);
    expect((await env.api("GET", "/achats/commandes", a.jeton)).corps).toEqual([]);
    expect((await env.api("GET", "/transferts", a.jeton)).corps).toEqual([]);
    expect((await env.api("GET", "/stocks/reajustements", a.jeton)).corps).toEqual([]);
    expect((await env.api("GET", "/achats/reapprovisionnement", a.jeton)).corps).toEqual([]);
    expect((await commander(a, [{ produitId: b.a, quantite: 1, prixUnitaire: 1 }])).statut).toBe(404);
    expect((await env.api("POST", "/achats/commandes", a.jeton, { entiteId: a.depotA, fournisseurId: b.fournisseurId, date: "2026-01-01", lignes: [{ produitId: a.a, quantite: 1, prixUnitaire: 1 }] })).statut).toBe(404);
  });

  it("un mouvement issu d'un achat reste dans le journal", async () => {
    const o = await magasin();
    const c = await commander(o, [{ produitId: o.a, quantite: 1, prixUnitaire: 1 }]);
    const { rows } = await dansOrganisation(env.poolAdmin, o.organisationId, (x) =>
      x.query("select action from journal_audit where objet_id = $1 and organisation_id = org_courante()", [c.corps.id]));
    expect(rows.map((r) => r.action)).toContain("insert");
  });
});

describe("rentabilité prévue", () => {
  it("répartit les frais selon la valeur et classe la marge", () => {
    const r = rentabilite([{ quantite: 2, prix_unitaire: 500, prix_vente_prevu: 700 }], 1000, 200);
    expect(r.detail[0]).toMatchObject({ cout_revient: 600, cout_ligne: 1200, chiffre_affaires: 1400, marge_totale: 200, taux_marge: 14.3, avis: "faible" });
    expect(rentabilite([{ quantite: 1, prix_unitaire: 0, prix_vente_prevu: 0 }], 0, 0).detail[0]).toMatchObject({ marge_totale: 0, taux_marge: null, avis: "faible" });
    expect(rentabilite([], 0, 0).total).toMatchObject({ complet: true, chiffre_affaires: 0, taux_marge: null });
  });
});

describe("suivi des achats", () => {
  const moi = async (jeton: string) => (await env.api("GET", "/moi", jeton)).corps.id as string;

  it("suit une importation étape par étape et ajoute les frais au coût de revient", async () => {
    const o = await magasin();
    const acheteur = await utilisateur(o, "acheteur", o.depotA);
    const acheteurId = await moi(acheteur);
    const c = await env.api("POST", "/achats/commandes", o.jeton, {
      entiteId: o.depotA, fournisseurId: o.fournisseurId, date: "2026-03-01", datePrevue: "2026-05-01", origine: "import",
      acheteurId, referenceFournisseur: "PI-889", paysOrigine: "Chine",
      lignes: [{ produitId: o.a, quantite: 100, prixUnitaire: 1000, poidsKg: 250 }],
    });
    expect(c.statut).toBe(201);
    expect(c.corps).toMatchObject({ origine: "import", acheteur_id: acheteurId, etape: "commandee", reference_fournisseur: "PI-889" });
    const url = `/achats/commandes/${c.corps.id}`;

    // Une étape n'est possible qu'après approbation, et seulement parmi celles de l'importation.
    expect((await env.api("POST", `${url}/etapes`, o.jeton, { etape: "expediee", date: "2026-03-10" })).corps.erreur).toBe("commande_non_approuvee");
    await env.api("POST", `${url}/approbation`, o.jeton);
    expect((await env.api("POST", `${url}/etapes`, o.jeton, { etape: "achetee", date: "2026-03-10" })).corps.erreur).toBe("etape_invalide");
    expect((await env.api("POST", `${url}/etapes`, o.jeton, { etape: "en_stock", date: "2026-03-10" })).corps.erreur).toBe("etape_invalide");
    expect((await env.api("POST", `${url}/etapes`, o.jeton, { etape: "expediee", date: "2026-02-10" })).corps.erreur).toBe("date_avant_commande");
    expect((await env.api("POST", `${url}/etapes`, o.jeton, { etape: "expediee", date: "2026-03-10", note: "Départ Guangzhou" })).statut).toBe(201);
    expect((await env.api("POST", `${url}/etapes`, acheteur, { etape: "arrivee_port", date: "2026-04-20" })).statut).toBe(201);
    expect((await env.api("PATCH", url, acheteur, { acheteurId })).corps.erreur).toBe("commande_figee");

    // Frais : 20 000 de fret et 10 000 de douane, un frais erroné retiré mais conservé.
    expect((await env.api("POST", `${url}/frais`, acheteur, { nature: "fret", montant: 20000, prestataire: "Transitaire" })).statut).toBe(201);
    expect((await env.api("POST", `${url}/frais`, acheteur, { nature: "pre_acheminement", montant: 4000 })).statut).toBe(201);
    expect((await env.api("POST", `${url}/frais`, acheteur, { nature: "post_acheminement", montant: 6000 })).statut).toBe(201);
    expect((await env.api("POST", `${url}/frais`, acheteur, { nature: "inconnue", montant: 1 })).statut).toBe(400);
    const erreur = await env.api("POST", `${url}/frais`, acheteur, { nature: "autre", montant: 999999 });
    expect((await env.api("POST", `/achats/frais/${erreur.corps.id}/retrait`, acheteur, { motif: "Saisi deux fois" })).statut).toBe(200);
    expect((await env.api("POST", `/achats/frais/${erreur.corps.id}/retrait`, acheteur, { motif: "Saisi deux fois" })).corps.erreur).toBe("frais_deja_retire");

    const d = (await env.api("GET", url, o.jeton)).corps;
    expect(d).toMatchObject({ total: 100000, total_frais: 30000, cout_total: 130000, acheteur: { nom: "acheteur" }, etape: "arrivee_port" });
    expect(d.etapes.map((e: { etape: string }) => e.etape)).toEqual(["commandee", "expediee", "arrivee_port"]);
    expect(d.frais).toHaveLength(4);
    expect(d.frais_par_nature).toEqual([{ nature: "pre_acheminement", montant: 4000 }, { nature: "fret", montant: 20000 }, { nature: "post_acheminement", montant: 6000 }]);
    expect(d).toMatchObject({ poids_kg: 250, frais_par_kg: 120 });
    expect(d.lignes[0]).toMatchObject({ poids_kg: 250, cout_revient: 1300 });

    // La réception complète met en stock au coût de revient et clôt le suivi.
    await env.api("POST", `${url}/receptions`, o.jeton, { lignes: [{ ligneId: d.lignes[0].id, quantite: 100 }] });
    expect(await coutMoyen(o, o.a)).toBe(1300);
    const apres = (await env.api("GET", url, o.jeton)).corps;
    expect(apres).toMatchObject({ statut: "recue", etape: "en_stock" });
    expect(apres.etapes.at(-1).etape).toBe("en_stock");
    expect((await env.api("POST", `${url}/etapes`, o.jeton, { etape: "livree", date: "2026-05-01" })).corps.erreur).toBe("commande_non_approuvee");
    expect((await env.api("PATCH", url, o.jeton, { datePrevue: "2026-06-01" })).corps.erreur).toBe("commande_cloturee");
  });

  it("refuse un acheteur sans droit d'achat et réserve étapes et frais à qui gère les achats", async () => {
    const o = await magasin();
    const magasinier = await utilisateur(o, "magasinier", o.depotA);
    const ailleurs = await utilisateur(o, "acheteur", o.depotB);
    const lignes = [{ produitId: o.a, quantite: 1, prixUnitaire: 100 }];
    const base = { entiteId: o.depotA, fournisseurId: o.fournisseurId, date: "2026-03-01", lignes };
    expect((await env.api("POST", "/achats/commandes", o.jeton, { ...base, acheteurId: await moi(magasinier) })).corps.erreur).toBe("acheteur_invalide");
    expect((await env.api("POST", "/achats/commandes", o.jeton, { ...base, acheteurId: await moi(ailleurs) })).corps.erreur).toBe("acheteur_invalide");
    expect((await env.api("POST", "/achats/commandes", o.jeton, { ...base, datePrevue: "2026-02-01" })).corps.erreur).toBe("date_avant_commande");
    const c = await env.api("POST", "/achats/commandes", o.jeton, base);
    const url = `/achats/commandes/${c.corps.id}`;
    await env.api("POST", `${url}/approbation`, o.jeton);
    expect((await env.api("POST", `${url}/etapes`, magasinier, { etape: "achetee", date: "2026-03-02" })).statut).toBe(403);
    expect((await env.api("POST", `${url}/frais`, magasinier, { nature: "transport_local", montant: 500 })).statut).toBe(403);
    expect((await env.api("POST", `${url}/etapes`, ailleurs, { etape: "achetee", date: "2026-03-02" })).statut).toBe(403);
    expect((await env.api("POST", `${url}/etapes`, o.jeton, { etape: "en_production", date: "2026-03-02" })).corps.erreur).toBe("etape_invalide");
    expect((await env.api("POST", `${url}/etapes`, o.jeton, { etape: "achetee", date: "2026-03-02" })).statut).toBe(201);
    // Le magasinier voit la commande, mais pas les paiements, réservés à la comptabilité.
    const vue = (await env.api("GET", url, magasinier)).corps;
    expect(vue.paiement).toBeNull();
    expect((await env.api("GET", url, o.jeton)).corps.paiement).toMatchObject({ statut: "non_facture" });
    const acheteurs = (await env.api("GET", "/achats/acheteurs", magasinier)).corps.map((u: { nom: string }) => u.nom);
    expect(acheteurs).toContain("acheteur");
    expect(acheteurs).not.toContain("magasinier");
  });

  it("signale un prix au-dessus de l'habitude", async () => {
    const o = await magasin();
    const passer = async (date: string, prix: number) => {
      const c = await env.api("POST", "/achats/commandes", o.jeton, { entiteId: o.depotA, fournisseurId: o.fournisseurId, date, lignes: [{ produitId: o.a, quantite: 1, prixUnitaire: prix }] });
      return c.corps.id as string;
    };
    await passer("2026-01-01", 1000);
    await passer("2026-01-15", 1000);
    const normal = await passer("2026-02-01", 1080);
    const cher = await passer("2026-02-15", 1300);
    const annulee = await passer("2026-02-20", 5000);
    await env.api("POST", `/achats/commandes/${annulee}/annulation`, o.jeton, { motif: "Erreur de saisie" });
    const ligne = async (id: string) => (await env.api("GET", `/achats/commandes/${id}`, o.jeton)).corps.lignes[0];
    expect(await ligne(normal)).toMatchObject({ prix_habituel: 1000, ecart_prix: 8, alerte_prix: false });
    expect(await ligne(cher)).toMatchObject({ prix_habituel: 1027, ecart_prix: 27, alerte_prix: true, meilleur_prix: { prix: 1000 } });
    const liste = (await env.api("GET", "/achats/commandes", o.jeton)).corps;
    expect(liste.find((c: { id: string }) => c.id === cher).alerte_prix).toBe(true);
    expect(liste.find((c: { id: string }) => c.id === normal).alerte_prix).toBe(false);
  });

  it("filtre par période, statut, origine, acheteur et recherche, avec les totaux", async () => {
    const o = await magasin();
    const acheteur = await utilisateur(o, "acheteur", o.depotA);
    const acheteurId = await moi(acheteur);
    const creer = async (extra: object, lignes: object[]) => (await env.api("POST", "/achats/commandes", o.jeton, {
      entiteId: o.depotA, fournisseurId: o.fournisseurId, lignes, ...extra,
    })).corps;
    const mars = await creer({ date: "2026-03-05", origine: "import", acheteurId, referenceFournisseur: "PI-100" }, [{ produitId: o.a, quantite: 10, prixUnitaire: 500, poidsKg: 12.5 }]);
    const ciment = await o.creer("CIM", { nom: "Ciment gris" });
    const avril = await creer({ date: "2026-04-05" }, [{ produitId: ciment, quantite: 4, prixUnitaire: 250 }]);
    const annulee = await creer({ date: "2026-03-20" }, [{ produitId: ciment, quantite: 1, prixUnitaire: 99999 }]);
    await env.api("POST", `/achats/commandes/${annulee.id}/annulation`, o.jeton, { motif: "Doublon" });
    await env.api("POST", `/achats/commandes/${mars.id}/frais`, o.jeton, { nature: "fret", montant: 700 });

    const liste = async (q: string) => (await env.api("GET", `/achats/commandes${q}`, o.jeton)).corps.map((c: { numero: string }) => c.numero);
    const totaux = async (q: string) => (await env.api("GET", `/achats/synthese${q}`, o.jeton)).corps;
    expect(await liste("?du=2026-03-01&au=2026-03-31")).toEqual([annulee.numero, mars.numero]);
    expect(await liste("?origine=import")).toEqual([mars.numero]);
    expect(await liste(`?acheteurId=${acheteurId}`)).toEqual([mars.numero]);
    expect(await liste("?q=pi-100")).toEqual([mars.numero]);
    expect(await liste("?q=ciment")).toEqual([avril.numero, annulee.numero]);
    expect(await liste(`?q=${encodeURIComponent(mars.numero)}`)).toEqual([mars.numero]);
    expect(await liste("?q=%25")).toEqual([]);
    expect(await liste("?statut=annulee")).toEqual([annulee.numero]);
    expect(await liste("?statut=en_cours")).toEqual([avril.numero, mars.numero]);
    expect((await env.api("GET", "/achats/commandes?du=2026-13-01", o.jeton)).statut).toBe(400);

    expect(await totaux("?du=2026-03-01&au=2026-03-31")).toMatchObject({
      commandes: 2, en_cours: 1, annulees: 1, montant: 5000, frais: 700, cout_total: 5700, quantite: 10, poids_kg: 12.5, frais_par_kg: 56,
      frais_par_nature: [{ nature: "fret", nombre: 1, montant: 700 }],
      par_fournisseur: [{ nom: "Fournisseur", commandes: 1, montant: 5000 }], par_acheteur: [{ nom: "acheteur", commandes: 1, montant: 5000 }],
    });
    expect(await totaux("")).toMatchObject({ commandes: 3, montant: 6000, quantite: 14, quantite_recue: 0, montant_recu: 0 });
  });

  it("désigne le transitaire et calcule le transport principal au kilo ou au mètre cube", async () => {
    const o = await magasin();
    const transitaire = (await env.api("POST", "/tiers", o.jeton, { type: "entreprise", nom: "Transit Express" })).corps.id as string;
    const autre = (await env.api("POST", "/tiers", o.jeton, { type: "entreprise", nom: "Cargo Rapide" })).corps.id as string;
    const c = await env.api("POST", "/achats/commandes", o.jeton, {
      entiteId: o.depotA, fournisseurId: o.fournisseurId, date: "2026-03-01", origine: "import", transitaireId: transitaire,
      modeTransport: "maritime", volumeM3: 2.5, lignes: [{ produitId: o.a, quantite: 10, prixUnitaire: 10000, poidsKg: 400 }],
    });
    expect(c.statut).toBe(201);
    expect(c.corps).toMatchObject({ transitaire_id: transitaire, mode_transport: "maritime" });
    expect((await env.api("GET", `/tiers/${transitaire}`, o.jeton)).corps.roles).toContain("transitaire");
    const url = `/achats/commandes/${c.corps.id}`;

    // Forfait au kilo : 400 kg × 1 250 FCFA. Le montant est calculé par le serveur.
    const fret = await env.api("POST", `${url}/frais`, o.jeton, { nature: "fret", base: "poids", quantiteBase: 400, tarif: 1250, montant: 1 });
    expect(fret.corps).toMatchObject({ nature: "fret", montant: 500000 });
    expect((await env.api("POST", `${url}/frais`, o.jeton, { nature: "fret", base: "volume", quantiteBase: 2.5 })).corps.erreur).toBe("forfait_incomplet");
    expect((await env.api("POST", `${url}/frais`, o.jeton, { nature: "fret", tarif: 100 })).corps.erreur).toBe("forfait_incomplet");
    expect((await env.api("POST", `${url}/frais`, o.jeton, { nature: "enlevement" })).corps.erreur).toBe("montant_obligatoire");
    expect((await env.api("POST", `${url}/frais`, o.jeton, { nature: "douane", montant: 1000 })).statut).toBe(400);
    expect((await env.api("POST", `${url}/frais`, o.jeton, { nature: "post_acheminement", montant: 50000 })).statut).toBe(201);

    const d = (await env.api("GET", url, o.jeton)).corps;
    expect(d).toMatchObject({ transitaire: { nom: "Transit Express" }, volume_m3: 2.5, total_frais: 550000, frais_par_kg: 1375, frais_par_m3: 220000 });
    expect(d.frais.find((f: { nature: string }) => f.nature === "fret")).toMatchObject({ base_calcul: "poids", quantite_base: 400, tarif: 1250 });

    // Le transitaire se change après l'approbation, tant que la marchandise n'est pas reçue.
    await env.api("POST", `${url}/approbation`, o.jeton);
    expect((await env.api("PATCH", url, o.jeton, { transitaireId: autre, modeTransport: "aerien" })).statut).toBe(200);
    expect((await env.api("GET", url, o.jeton)).corps).toMatchObject({ transitaire: { nom: "Cargo Rapide" }, mode_transport: "aerien" });

    expect((await env.api("GET", `/achats/commandes?transitaireId=${autre}`, o.jeton)).corps).toHaveLength(1);
    expect((await env.api("GET", `/achats/commandes?transitaireId=${transitaire}`, o.jeton)).corps).toHaveLength(0);
    expect((await env.api("GET", "/achats/commandes?q=cargo", o.jeton)).corps[0]).toMatchObject({ transitaire: "Cargo Rapide", mode_transport: "aerien" });
    expect((await env.api("GET", "/achats/synthese", o.jeton)).corps).toMatchObject({
      volume_m3: 2.5, par_transitaire: [{ nom: "Cargo Rapide", commandes: 1, frais: 550000, poids_kg: 400, volume_m3: 2.5, frais_par_kg: 1375 }],
    });
  });

  it("refuse un transitaire d'une autre organisation", async () => {
    const a = await magasin();
    const b = await magasin();
    const etranger = (await env.api("POST", "/tiers", b.jeton, { type: "entreprise", nom: "Ailleurs" })).corps.id as string;
    const r = await env.api("POST", "/achats/commandes", a.jeton, {
      entiteId: a.depotA, fournisseurId: a.fournisseurId, date: "2026-03-01", origine: "import", transitaireId: etranger,
      lignes: [{ produitId: a.a, quantite: 1, prixUnitaire: 1 }],
    });
    expect(r.statut).toBe(404);
  });

  it("calcule la marge prévue avec le prix de vente local, frais compris", async () => {
    const o = await magasin();
    const montre = await o.creer("MONTRE", { prixVente: 2000 });
    const sac = await o.creer("SAC");
    const c = await env.api("POST", "/achats/commandes", o.jeton, {
      entiteId: o.depotA, fournisseurId: o.fournisseurId, date: "2026-03-01", origine: "import",
      lignes: [{ produitId: montre, quantite: 10, prixUnitaire: 1000 }, { produitId: sac, quantite: 5, prixUnitaire: 400 }],
    });
    const url = `/achats/commandes/${c.corps.id}`;
    await env.api("POST", `${url}/frais`, o.jeton, { nature: "fret", base: "poids", quantiteBase: 30, tarif: 100 });
    const lire = async () => (await env.api("GET", url, o.jeton)).corps;
    const ligne = (d: { lignes: { produit_id: string }[] }, id: string) => d.lignes.find((l) => l.produit_id === id);

    // Le prix du catalogue sert de prix de vente par défaut ; 3 000 de frais sur 12 000 de marchandises, soit +25 %.
    let d = await lire();
    expect(ligne(d, montre)).toMatchObject({ prix_vente_prevu: 2000, cout_revient: 1250, marge_unitaire: 750, taux_marge: 37.5, marge_totale: 7500, avis: "rentable" });
    expect(ligne(d, sac)).toMatchObject({ prix_vente_prevu: null, cout_revient: 500, marge_unitaire: null, avis: "a_renseigner" });
    expect(d.rentabilite).toMatchObject({ complet: false, lignes_sans_prix: 1, chiffre_affaires: 20000, cout: 12500, marge: 7500, taux_marge: 37.5 });
    expect((await env.api("GET", "/achats/commandes", o.jeton)).corps[0].chiffre_affaires_prevu).toBeNull();

    const ligneSac = ligne(d, sac) as unknown as { id: string };
    const ligneMontre = ligne(d, montre) as unknown as { id: string };
    expect((await env.api("PUT", `${url}/prix-vente`, o.jeton, { prix: [{ ligneId: ligneSac.id, prixVente: 550 }] })).statut).toBe(200);
    d = await lire();
    expect(ligne(d, sac)).toMatchObject({ marge_totale: 250, taux_marge: 9.1, avis: "faible" });
    expect(d.rentabilite).toMatchObject({ complet: true, chiffre_affaires: 22750, cout: 15000, marge: 7750, taux_marge: 34.1 });

    // Vendue sous son coût de revient, la montre est signalée à perte, même si son prix d'achat est inférieur.
    await env.api("PUT", `${url}/prix-vente`, o.jeton, { prix: [{ ligneId: ligneMontre.id, prixVente: 1200 }] });
    expect(ligne(await lire(), montre)).toMatchObject({ marge_unitaire: -50, marge_totale: -500, avis: "a_perte" });
    expect((await env.api("GET", "/achats/commandes", o.jeton)).corps[0].chiffre_affaires_prevu).toBe(14750);
    expect((await env.api("GET", "/achats/synthese", o.jeton)).corps).toMatchObject({ chiffre_affaires_prevu: 14750, marge_prevue: -250, taux_marge_prevu: -1.7, sans_prix_vente: 0 });

    // Le prix saisi à la création l'emporte sur le catalogue ; seul qui gère les achats peut changer un prix prévu.
    const autre = await env.api("POST", "/achats/commandes", o.jeton, {
      entiteId: o.depotA, fournisseurId: o.fournisseurId, date: "2026-03-02", lignes: [{ produitId: montre, quantite: 1, prixUnitaire: 1000, prixVente: 2500 }],
    });
    expect((await env.api("GET", `/achats/commandes/${autre.corps.id}`, o.jeton)).corps.lignes[0].prix_vente_prevu).toBe(2500);
    expect((await env.api("PUT", `/achats/commandes/${autre.corps.id}/prix-vente`, o.jeton, { prix: [{ ligneId: ligneSac.id, prixVente: 1 }] })).statut).toBe(404);
    const magasinier = await utilisateur(o, "magasinier", o.depotA);
    expect((await env.api("PUT", `${url}/prix-vente`, magasinier, { prix: [{ ligneId: ligneSac.id, prixVente: 1 }] })).statut).toBe(403);
    await env.api("POST", `${url}/annulation`, o.jeton, { motif: "Pas rentable" });
    expect((await env.api("PUT", `${url}/prix-vente`, o.jeton, { prix: [{ ligneId: ligneSac.id, prixVente: 1 }] })).corps.erreur).toBe("commande_cloturee");
  });

  it("n'expose ni les commandes ni les totaux d'une autre organisation", async () => {
    const a = await magasin();
    const b = await magasin();
    await commander(b, [{ produitId: b.a, quantite: 1, prixUnitaire: 100 }]);
    expect((await env.api("GET", "/achats/synthese", a.jeton)).corps).toMatchObject({ commandes: 0, montant: 0 });
    const c = await commander(b, [{ produitId: b.a, quantite: 1, prixUnitaire: 100 }]);
    const url = `/achats/commandes/${c.corps.id}`;
    expect((await env.api("POST", `${url}/frais`, a.jeton, { nature: "fret", montant: 1 })).statut).toBe(404);
    expect((await env.api("POST", `${url}/etapes`, a.jeton, { etape: "achetee", date: "2026-03-02" })).statut).toBe(404);
    expect((await env.api("PATCH", url, a.jeton, { paysOrigine: "Chine" })).statut).toBe(404);
    expect((await env.api("GET", "/achats/acheteurs", a.jeton)).corps.map((u: { nom: string }) => u.nom)).toEqual(["Admin"]);
  });
});
