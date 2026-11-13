import { afterAll, describe, expect, it } from "vitest";
import { corriger } from "../src/apprentissage.js";
import { dansOrganisation } from "../src/base.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;

async function utilisateur(o: Org, code: string, entiteId: string) {
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
  const r = await env.api("POST", "/utilisateurs", o.jeton, {
    email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((x: { code: string }) => x.code === code).id,
  });
  return r.statut === 201 ? await env.connecter(o.slug, email) : r.corps.erreur as string;
}

describe("corrections", () => {
  it("un avoir peut remettre la marchandise vendue en stock, sans dépasser la vente", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("PATCH", `/entites/${o.entites.GLOMARI}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const p = (await env.api("POST", "/produits", o.jeton, { entiteId: o.entites.GLOMARI, code: "A", nom: "A", suiviStock: true, prixVente: 100 })).corps.id;
    await env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: o.entites.GLOMARI, produitId: p, type: "entree", quantite: 5, coutUnitaire: 10 });
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "C" });
    const d = await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: o.entites.GLOMARI, tiersId: t.corps.id, date: "2026-01-01", lignes: [{ produitId: p, quantite: 3 }] });
    await env.api("POST", `/documents-vente/${d.corps.id}/emission`, o.jeton);
    const niveau = async () => (await env.api("GET", "/stocks", o.jeton)).corps[0].quantite;
    expect(await niveau()).toBe(2);
    const avoir = (quantite: number, retourStock = true) => env.api("POST", `/factures/${d.corps.id}/avoir`, o.jeton, {
      date: "2026-01-02", motif: "Retour client", retourStock, lignes: [{ produitId: p, quantite }],
    });
    expect((await avoir(1, false)).statut).toBe(201);
    expect(await niveau()).toBe(2);
    expect((await avoir(1)).statut).toBe(201);
    expect(await niveau()).toBe(3);
    expect((await avoir(1)).statut).toBe(201);
    expect(await niveau()).toBe(4);
    const trop = await env.api("POST", `/factures/${d.corps.id}/avoir`, o.jeton, {
      date: "2026-01-02", motif: "Retour excessif", retourStock: true, lignes: [{ produitId: p, quantite: 2, prixUnitaire: 0 }],
    });
    expect(trop.corps.erreur).toBe("retour_superieur_a_la_vente");
    expect(await niveau()).toBe(4);
  });

  it("la liste des collaborateurs reste dans la branche", async () => {
    const o = await env.nouvelleOrganisation();
    const gta = await utilisateur(o, "commercial", o.entites.GTA!) as string;
    const glomari = await utilisateur(o, "commercial", o.entites.GLOMARI!) as string;
    const liste = async (j: string) => (await env.api("GET", "/collaborateurs", j)).corps.length;
    expect(await liste(o.jeton)).toBe(3);
    expect(await liste(gta)).toBe(2); // lui et le super administrateur
    expect(await liste(glomari)).toBe(2);
  });
});

describe("caisse", () => {
  async function magasin() {
    const o = await env.nouvelleOrganisation();
    const m = await env.api("POST", "/magasins", o.jeton, { parentId: o.entites.GLOMARI, nom: "Akwa", type: "point_de_vente" });
    const p = (await env.api("POST", "/produits", o.jeton, { entiteId: o.entites.GLOMARI, code: "A", nom: "Article", suiviStock: true, prixVente: 1000, tauxTaxe: 10 })).corps.id as string;
    await env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: m.corps.id, produitId: p, type: "entree", quantite: 5, coutUnitaire: 100 });
    return { ...o, magasinId: m.corps.id as string, produitId: p };
  }
  type M = Awaited<ReturnType<typeof magasin>>;
  const vendre = (o: M, jeton: string, quantite: number, paiements: object[], extra = {}) =>
    env.api("POST", "/caisse/ventes", jeton, { entiteId: o.magasinId, lignes: [{ produitId: o.produitId, quantite, ...extra }], paiements });
  const stock = async (o: M) => (await env.api("GET", "/stocks", o.jeton)).corps[0].quantite;
  const ouvrir = (o: M, jeton = o.jeton, fondOuverture = 5000) => env.api("POST", "/caisse/ouverture", jeton, { entiteId: o.magasinId, fondOuverture });

  it("va de l'ouverture à la clôture, avec paiements mixtes, rendu et stock automatique", async () => {
    const o = await magasin();
    expect((await vendre(o, o.jeton, 1, [{ moyen: "especes", montant: 1100 }])).corps.erreur).toBe("caisse_fermee");
    const s = await ouvrir(o);
    expect(s.statut).toBe(201);
    expect((await ouvrir(o)).corps.erreur).toBe("caisse_deja_ouverte");

    expect((await vendre(o, o.jeton, 1, [{ moyen: "especes", montant: 1000 }])).corps).toMatchObject({ erreur: "paiement_insuffisant", details: { total: 1100 } });
    expect((await vendre(o, o.jeton, 1, [{ moyen: "mtn_momo", montant: 1100 }])).corps.erreur).toBe("reference_obligatoire");
    expect((await vendre(o, o.jeton, 1, [{ moyen: "carte", montant: 2000, reference: "C" }])).corps.erreur).toBe("rendu_impossible");
    expect(await stock(o)).toBe(5);

    const v = await vendre(o, o.jeton, 2, [{ moyen: "mtn_momo", montant: 1000, reference: "M1" }, { moyen: "especes", montant: 2000 }]);
    expect(v.corps).toMatchObject({ numero: expect.stringMatching(/^TCK-\d{4}-000001$/), total_ttc: 2200, rendu: 800 });
    expect(await stock(o)).toBe(3);
    expect((await vendre(o, o.jeton, 4, [{ moyen: "especes", montant: 9000 }])).corps.erreur).toBe("stock_insuffisant");
    expect(await stock(o)).toBe(3);

    const a = await vendre(o, o.jeton, 1, [{ moyen: "especes", montant: 1100 }]);
    expect((await env.api("POST", `/caisse/ventes/${a.corps.id}/annulation`, o.jeton, { motif: "Erreur client" })).statut).toBe(200);
    expect(await stock(o)).toBe(3);

    const url = `/caisse/sessions/${s.corps.id}/cloture`;
    expect((await env.api("POST", url, o.jeton, { especesComptees: 6000 })).corps).toMatchObject({ erreur: "motif_ecart_obligatoire", details: { attendues: 6200, ecart: -200 } });
    const c = await env.api("POST", url, o.jeton, { especesComptees: 6000, motifEcart: "Erreur de monnaie" });
    expect(c.corps).toMatchObject({ ventes: 2200, nombre: 1, attendues: 6200, ecart: -200 });
    expect((await env.api("POST", url, o.jeton, { especesComptees: 1 })).corps.erreur).toBe("caisse_deja_cloturee");
    expect((await vendre(o, o.jeton, 1, [{ moyen: "especes", montant: 1100 }])).corps.erreur).toBe("caisse_fermee");
    expect((await env.api("POST", `/caisse/ventes/${v.corps.id}/annulation`, o.jeton, { motif: "Trop tard" })).corps.erreur).toBe("caisse_deja_cloturee");
    expect((await env.api("GET", "/caisse/sessions", o.jeton)).corps[0]).toMatchObject({ caissier: "Admin", ecart: -200, ventes: 2200 });
  });

  it("deux caisses simultanées ne vendent jamais la même pièce", async () => {
    const o = await magasin();
    await ouvrir(o);
    const r = await Promise.all(Array.from({ length: 10 }, () => vendre(o, o.jeton, 1, [{ moyen: "especes", montant: 1100 }])));
    expect(r.filter((x) => x.statut === 201)).toHaveLength(5);
    expect(new Set(r.filter((x) => x.statut === 201).map((x) => x.corps.numero)).size).toBe(5);
    expect(await stock(o)).toBe(0);
  });

  it("le caissier vend dans son magasin, sans grosse remise ni annulation", async () => {
    const o = await magasin();
    const c = await utilisateur(o, "caissier", o.magasinId) as string;
    await ouvrir(o, c);
    expect((await vendre(o, c, 1, [{ moyen: "especes", montant: 1100 }], { remisePct: 11 })).corps.erreur).toBe("remise_non_autorisee");
    const v = await vendre(o, c, 1, [{ moyen: "especes", montant: 1100 }], { remisePct: 10 });
    expect(v.corps.total_ttc).toBe(990);
    expect((await env.api("POST", `/caisse/ventes/${v.corps.id}/annulation`, c, { motif: "Je veux annuler" })).statut).toBe(403);
    expect((await env.api("GET", "/caisse/sessions", c)).statut).toBe(403);
    await expect(dansOrganisation(env.poolApp, o.organisationId, (x) => x.query("update ventes_comptoir set total_ttc = 1"))).rejects.toThrow(/ne peut pas être modifiée/);
  });

  it("n'existe pas chez GTA, et isole les clients", async () => {
    const o = await magasin();
    expect(await utilisateur(o, "caissier", o.entites.GTA!)).toBe("role_incompatible");
    const gta = await utilisateur(o, "administrateur", o.entites.GTA!) as string;
    expect((await env.api("GET", "/caisse", gta)).statut).toBe(403);
    expect((await env.api("PUT", `/entites/${o.entites.GTA}/modules/commerce`, o.jeton, { actif: true })).corps.erreur).toBe("module_incompatible");
    const autre = await env.nouvelleOrganisation();
    expect((await env.api("POST", "/caisse/ouverture", autre.jeton, { entiteId: o.magasinId, fondOuverture: 0 })).statut).toBe(404);
  });
});

describe("apprentissage en ligne", () => {
  const Q = [
    { enonce: "2 + 2 ?", choix: ["3", "4"], bonne: 1 },
    { enonce: "Capitale du Cameroun ?", choix: ["Douala", "Yaoundé"], bonne: 1 },
  ];
  async function cours(publier = true) {
    const o = await env.nouvelleOrganisation();
    const c = await env.api("POST", "/cours", o.jeton, { entiteId: o.entites.GTA, titre: "E-commerce", seuilReussite: 50 });
    const url = `/cours/${c.corps.id}`;
    expect((await env.api("PATCH", url, o.jeton, { publie: true })).corps.erreur).toBe("cours_vide");
    const l1 = await env.api("POST", `${url}/lecons`, o.jeton, { titre: "Bases", contenu: "Texte", questions: Q });
    const l2 = await env.api("POST", `${url}/lecons`, o.jeton, { titre: "Suite", contenu: "Secret", url: "https://exemple.test/video" });
    if (publier) await env.api("PATCH", url, o.jeton, { publie: true });
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Awa" });
    const a = await env.api("POST", `${url}/acces`, o.jeton, { tiersId: t.corps.id });
    return { ...o, coursId: c.corps.id as string, l1: l1.corps.id as string, l2: l2.corps.id as string, code: a.corps.lien.split("?c=")[1] as string, accesId: a.corps.id as string };
  }

  it("corrige sur le serveur", () => {
    expect(corriger(Q, [1, 0])).toBe(50);
    expect(corriger(Q, [1, 1])).toBe(100);
    expect(corriger(Q, [])).toBe(0);
    expect(corriger([], [])).toBe(100);
  });

  it("déroule le cours dans l'ordre, sans révéler les réponses ni la suite", async () => {
    const o = await cours();
    const lire = async () => (await env.api("GET", `/apprendre/${o.code}`)).corps;
    const d = await lire();
    expect(JSON.stringify(d)).not.toContain("bonne");
    expect(JSON.stringify(d)).not.toContain("Secret");
    expect(d.lecons[1]).toMatchObject({ ouverte: false });
    const envoyer = (l: string, reponses?: number[]) => env.api("POST", `/apprendre/${o.code}/lecons/${l}`, undefined, { reponses });
    expect((await envoyer(o.l2)).corps.erreur).toBe("lecon_verrouillee");
    expect((await envoyer(o.l1, [0, 0])).corps).toMatchObject({ score: 0, reussi: false });
    expect((await lire()).lecons[1].ouverte).toBe(false);
    expect((await envoyer(o.l1, [1, 0])).corps).toMatchObject({ score: 50, reussi: true, cours_termine: false });
    const suite = await lire();
    expect(suite.lecons[1]).toMatchObject({ ouverte: true, contenu: "Secret", url: "https://exemple.test/video" });
    expect(suite.progression).toBe(50);
    expect((await envoyer(o.l2)).corps).toMatchObject({ reussi: true, cours_termine: true });
    const s = (await env.api("GET", `/cours/${o.coursId}/suivi`, o.jeton)).corps[0];
    expect(s).toMatchObject({ nom: "Awa", progression: 100, terminees: 2, score_moyen: 50 });
    expect(s.termine_le).toBeTruthy();
    expect((await envoyer(o.l1, [0, 0])).corps.score).toBe(0);
    expect((await env.api("GET", `/cours/${o.coursId}/suivi`, o.jeton)).corps[0].score_moyen).toBe(50);
  });

  it("refuse un cours non publié, un accès retiré, un lien non sécurisé ou une mauvaise réponse", async () => {
    const o = await cours(false);
    expect((await env.api("GET", `/apprendre/${o.code}`)).statut).toBe(404);
    await env.api("PATCH", `/cours/${o.coursId}`, o.jeton, { publie: true });
    expect((await env.api("GET", `/apprendre/${o.code}`)).statut).toBe(200);
    await env.api("POST", `/acces-cours/${o.accesId}/retrait`, o.jeton);
    expect((await env.api("GET", `/apprendre/${o.code}`)).statut).toBe(404);
    const url = `/cours/${o.coursId}/lecons`;
    expect((await env.api("POST", url, o.jeton, { titre: "X", url: "javascript:alert(1)" })).statut).toBe(400);
    expect((await env.api("POST", url, o.jeton, { titre: "X", questions: [{ enonce: "E", choix: ["a", "b"], bonne: 5 }] })).statut).toBe(400);
    expect((await env.api("GET", "/apprendre/mauvais")).statut).toBe(404);
  });

  it("réserve le module à GTA, et isole les clients", async () => {
    const o = await cours();
    const glomari = await utilisateur(o, "administrateur", o.entites.GLOMARI!) as string;
    expect((await env.api("GET", "/cours", glomari)).statut).toBe(403);
    expect(await utilisateur(o, "formateur_en_ligne", o.entites.GLOMARI!)).toBe("role_incompatible");
    expect((await env.api("POST", "/cours", o.jeton, { entiteId: o.entites.GLOMARI, titre: "X" })).statut).toBe(403);
    const f = await utilisateur(o, "formateur_en_ligne", o.entites.GTA!) as string;
    expect((await env.api("GET", `/cours/${o.coursId}`, f)).statut).toBe(200);
    const autre = await cours();
    expect((await env.api("GET", `/cours/${o.coursId}`, autre.jeton)).statut).toBe(404);
    expect((await env.api("GET", `/apprendre/${autre.organisationId}.${o.code.split(".")[1]}`)).statut).toBe(404);
  });
});

describe("ressources humaines", () => {
  async function equipe() {
    const o = await env.nouvelleOrganisation();
    const e = await env.api("POST", "/employes", o.jeton, { entiteId: o.entites.GTA, nom: "Paul", poste: "Formateur", typeContrat: "cdi", dateEmbauche: "2026-01-01" });
    expect(e.corps.matricule).toBe("EMP-00001");
    return { ...o, employeId: e.corps.id as string };
  }
  const conge = (o: { jeton: string; employeId: string }, debut: string, fin: string) =>
    env.api("POST", `/employes/${o.employeId}/conges`, o.jeton, { type: "annuel", debut, fin });

  it("gère les congés, avec décision, motif et sans chevauchement", async () => {
    const o = await equipe();
    expect((await conge(o, "2026-06-10", "2026-06-01")).corps.erreur).toBe("dates_invalides");
    const c = await conge(o, "2026-06-01", "2026-06-10");
    expect((await conge(o, "2026-06-10", "2026-06-12")).corps.erreur).toBe("conge_chevauche");
    const url = `/conges/${c.corps.id}/decision`;
    expect((await env.api("POST", url, o.jeton, { decision: "refuse" })).corps.erreur).toBe("motif_obligatoire");
    expect((await env.api("POST", url, o.jeton, { decision: "approuve" })).corps.statut).toBe("approuve");
    expect((await env.api("POST", url, o.jeton, { decision: "refuse", motif: "Trop tard" })).corps.erreur).toBe("deja_decide");
    expect((await env.api("GET", `/employes/${o.employeId}/conges`, o.jeton)).corps[0]).toMatchObject({ jours: 10, decide_par_nom: "Admin" });
    await env.api("POST", url, o.jeton, { decision: "annule" });
    expect((await conge(o, "2026-06-10", "2026-06-12")).statut).toBe(201);
    expect((await env.api("PATCH", `/employes/${o.employeId}`, o.jeton, { dateSortie: "2020-01-01" })).corps.erreur).toBe("dates_invalides");
    expect((await env.api("PATCH", `/employes/${o.employeId}`, o.jeton, { dateSortie: "2027-01-01" })).corps.date_sortie).toBe("2027-01-01");
  });

  it("sépare les branches et réserve les dossiers aux RH", async () => {
    const o = await equipe();
    const rhGlo = await utilisateur(o, "ressources_humaines", o.entites.GLOMARI!) as string;
    expect((await env.api("GET", "/employes", rhGlo)).corps).toEqual([]);
    expect((await env.api("GET", `/employes/${o.employeId}/conges`, rhGlo)).statut).toBe(403);
    const rhGta = await utilisateur(o, "ressources_humaines", o.entites.GTA!) as string;
    expect((await env.api("GET", "/employes", rhGta)).corps).toHaveLength(1);
    const com = await utilisateur(o, "commercial", o.entites.GTA!) as string;
    expect((await env.api("GET", "/employes", com)).statut).toBe(403);
    const autre = await equipe();
    expect((await env.api("GET", `/employes/${o.employeId}/conges`, autre.jeton)).statut).toBe(404);
    const colonnes = await env.poolAdmin.query("select column_name from information_schema.columns where table_name = 'employes'");
    expect(colonnes.rows.map((c) => c.column_name)).not.toContain("salaire");
  });
});

describe("compléments de la caisse", () => {
  async function magasin(quantite = 2) {
    const o = await env.nouvelleOrganisation();
    const m = await env.api("POST", "/magasins", o.jeton, { parentId: o.entites.GLOMARI, nom: "Akwa", type: "point_de_vente" });
    const p = (await env.api("POST", "/produits", o.jeton, { entiteId: o.entites.GLOMARI, code: "A", nom: "Article", suiviStock: true, prixVente: 1000, codeBarres: "6111234567890" })).corps.id as string;
    await env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: m.corps.id, produitId: p, type: "entree", quantite, coutUnitaire: 100 });
    const s = await env.api("POST", "/caisse/ouverture", o.jeton, { entiteId: m.corps.id, fondOuverture: 0 });
    return { ...o, magasinId: m.corps.id as string, produitId: p, sessionId: s.corps.id as string };
  }
  type M = Awaited<ReturnType<typeof magasin>>;
  const vente = (o: M, quantite: number, paiements: object[], extra = {}) =>
    env.api("POST", "/caisse/ventes", o.jeton, { entiteId: o.magasinId, lignes: [{ produitId: o.produitId, quantite }], paiements, ...extra });
  const stock = async (o: M) => (await env.api("GET", "/stocks", o.jeton)).corps[0];

  it("retrouve un article par son code-barres et refuse un code en double", async () => {
    const o = await magasin();
    const r = (await env.api("GET", "/produits?q=6111234567890", o.jeton)).corps;
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe(o.produitId);
    expect((await env.api("POST", "/produits", o.jeton, { entiteId: o.entites.GLOMARI, code: "B", nom: "B", codeBarres: "6111234567890" })).statut).toBe(409);
  });

  it("une vente hors connexion renvoyée plusieurs fois ne compte qu'une fois", async () => {
    const o = await magasin();
    const cle = "11111111-1111-4111-8111-111111111111";
    const envoi = () => vente(o, 1, [{ moyen: "especes", montant: 1000 }], { cleAppareil: cle, horsLigne: true, vendueLe: "2026-11-03T08:00:00.000Z" });
    const [a, b, c] = [await envoi(), await envoi(), await envoi()];
    expect(a.statut).toBe(201);
    expect(a.corps.hors_ligne).toBe(true);
    expect(c.corps.deja_recue).toBe(true);
    expect(b.corps.numero).toBe(a.corps.numero);
    expect((await stock(o)).quantite).toBe(1);
    const liste = (await env.api("GET", `/caisse/sessions/${o.sessionId}/ventes`, o.jeton)).corps;
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({ hors_ligne: true, vendue_le: expect.stringContaining("2026-11-03") });
  });

  it("une vente déjà faite pendant une coupure est gardée même si le stock manque, et reste visible", async () => {
    const o = await magasin(1);
    expect((await vente(o, 3, [{ moyen: "especes", montant: 3000 }])).corps.erreur).toBe("stock_insuffisant");
    expect((await vente(o, 3, [{ moyen: "especes", montant: 3000 }], { horsLigne: true, vendueLe: "2026-11-03T08:00:00.000Z", cleAppareil: "22222222-2222-4222-8222-222222222222" })).statut).toBe(201);
    expect(await stock(o)).toMatchObject({ quantite: -2, en_alerte: true });
  });

  it("ne retire le rendu qu'une fois, garde la taxe de la fiche et protège le stock réservé", async () => {
    const o = await magasin(5);
    const w = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: o.entites.GLOMARI, nom: "Tiroir", type: "especes" })).corps.id;
    await env.api("PUT", "/portefeuilles/defauts", o.jeton, { entiteId: o.entites.GLOMARI, moyen: "especes", portefeuilleId: w });
    expect((await vente(o, 1, [{ moyen: "especes", montant: 600 }, { moyen: "especes", montant: 600 }])).statut).toBe(201);
    expect((await env.api("GET", "/portefeuilles", o.jeton)).corps.find((x: { id: string }) => x.id === w).solde).toBe(1000);
    const roles = (await env.api("GET", "/roles", o.jeton)).corps;
    const email = `c${Math.random().toString(36).slice(2)}@test.cm`;
    await env.api("POST", "/utilisateurs", o.jeton, { email, nom: "C", motDePasse: MOT_DE_PASSE, entiteId: o.magasinId, roleId: roles.find((x: { code: string }) => x.code === "caissier").id });
    const c = await env.connecter(o.slug, email);
    await env.api("POST", "/caisse/ouverture", c, { entiteId: o.magasinId, fondOuverture: 0 });
    expect((await env.api("POST", "/caisse/ventes", c, { entiteId: o.magasinId, lignes: [{ produitId: o.produitId, quantite: 1, tauxTaxe: 0 }, { produitId: o.produitId, quantite: 1, tauxTaxe: 50 }], paiements: [{ moyen: "especes", montant: 5000 }] })).corps.erreur).toBe("taxe_non_autorisee");
    expect((await env.api("POST", "/reservations-stock", o.jeton, { entiteId: o.magasinId, produitId: o.produitId, quantite: 4 })).statut).toBe(201);
    expect((await vente(o, 1, [{ moyen: "especes", montant: 1000 }])).corps.erreur).toBe("stock_insuffisant");
  });

  it("ne donne aucun point tant que la branche n'a pas fixé ses règles", async () => {
    const o = await magasin();
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Awa", telephone: "699000123", entiteId: o.entites.GLOMARI });
    const v = await vente(o, 1, [{ moyen: "especes", montant: 1000 }], { tiersId: t.corps.id });
    expect(v.corps.points_gagnes).toBe(0);
    expect((await env.api("GET", `/fidelite?entiteId=${o.magasinId}`, o.jeton)).corps.actif).toBe(false);
  });

  it("fait gagner, dépenser et rendre les points, sans jamais payer deux fois", async () => {
    const o = await magasin(10);
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Awa", telephone: "699000123", entiteId: o.entites.GLOMARI });
    await env.api("PUT", `/entites/${o.entites.GLOMARI}/fidelite`, o.jeton, { actif: true, fcfaParPoint: 100, valeurPoint: 10 });
    const solde = async () => (await env.api("GET", `/fidelite/client?telephone=699000123&entiteId=${o.magasinId}`, o.jeton)).corps;
    const v1 = await vente(o, 2, [{ moyen: "especes", montant: 2000 }], { tiersId: t.corps.id });
    expect(v1.corps.points_gagnes).toBe(20);
    expect(await solde()).toMatchObject({ nom: "Awa", points: 20 });
    expect((await vente(o, 1, [{ moyen: "points", montant: 1000 }], { tiersId: t.corps.id })).corps.erreur).toBe("points_insuffisants");
    expect((await vente(o, 1, [{ moyen: "points", montant: 1000 }])).corps.erreur).toBe("fidelite_inactive");
    const v2 = await vente(o, 1, [{ moyen: "points", montant: 100 }, { moyen: "especes", montant: 900 }], { tiersId: t.corps.id });
    expect(v2.corps.points_gagnes).toBe(9);
    expect((await solde()).points).toBe(19);
    await env.api("POST", `/caisse/ventes/${v2.corps.id}/annulation`, o.jeton, { motif: "Erreur client" });
    expect((await solde()).points).toBe(20);
    const c = await env.api("POST", `/caisse/sessions/${o.sessionId}/cloture`, o.jeton, { especesComptees: 2000 });
    expect(c.corps.ecart).toBe(0);
    expect((await env.api("GET", `/fidelite/client?telephone=699000123&entiteId=${o.entites.GTA}`, o.jeton)).statut).toBe(403);
  });
});

describe("compléments des cours", () => {
  async function cours(o: Org, lecons: object[]) {
    const c = (await env.api("POST", "/cours", o.jeton, { entiteId: o.entites.GTA, titre: "E-commerce" })).corps.id as string;
    const ids: string[] = [];
    for (const l of lecons) ids.push((await env.api("POST", `/cours/${c}/lecons`, o.jeton, l)).corps.id);
    await env.api("PATCH", `/cours/${c}`, o.jeton, { publie: true });
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Awa", entiteId: o.entites.GTA });
    const a = await env.api("POST", `/cours/${c}/acces`, o.jeton, { tiersId: t.corps.id });
    return { coursId: c, ids, accesId: a.corps.id as string, code: new URL(a.corps.lien).searchParams.get("c") as string };
  }

  it("délivre seul le certificat à la fin du cours, vérifiable en public, puis révocable", async () => {
    const o = await env.nouvelleOrganisation();
    const c = await cours(o, [{ titre: "1", questions: [{ enonce: "?", choix: ["a", "b"], bonne: 1 }] }, { titre: "2" }]);
    const voir = async () => (await env.api("GET", `/apprendre/${c.code}`)).corps;
    await env.api("POST", `/apprendre/${c.code}/lecons/${c.ids[0]}`, undefined, { reponses: [0] });
    await env.api("POST", `/apprendre/${c.code}/lecons/${c.ids[1]}`, undefined, {});
    expect((await voir()).certificat).toBeNull();
    await env.api("POST", `/apprendre/${c.code}/lecons/${c.ids[0]}`, undefined, { reponses: [1] });
    await env.api("POST", `/apprendre/${c.code}/lecons/${c.ids[1]}`, undefined, {});
    const cert = (await voir()).certificat;
    expect(cert).toMatchObject({ titulaire: "Awa", cours: "E-commerce" });
    expect(cert.qr_svg).toContain("<svg");
    const jeton = new URL(cert.url_verification).searchParams.get("c");
    expect((await env.api("GET", `/verification/${jeton}`)).corps).toMatchObject({ valide: true, titulaire: "Awa", programme: "E-commerce" });
    await env.api("POST", `/apprendre/${c.code}/lecons/${c.ids[1]}`, undefined, {});
    const { rows } = await dansOrganisation(env.poolAdmin, o.organisationId, (x) => x.query("select count(*)::int as n from certificats_cours where acces_id = $1", [c.accesId]));
    expect(rows[0].n).toBe(1);
    expect((await env.api("POST", `/acces-cours/${c.accesId}/certificat/revocation`, o.jeton, { motif: "Fraude avérée" })).statut).toBe(200);
    expect((await env.api("GET", `/verification/${jeton}`)).corps.valide).toBe(false);
  });

  it("donne le direct seulement quand la leçon est ouverte", async () => {
    const o = await env.nouvelleOrganisation();
    const c = await cours(o, [{ titre: "1" }, { titre: "2", directLe: "2026-11-20T10:00:00.000Z", directLien: "https://meet.example.com/x" }]);
    const avant = (await env.api("GET", `/apprendre/${c.code}`)).corps.lecons[1];
    expect(avant.direct_lien).toBeUndefined();
    await env.api("POST", `/apprendre/${c.code}/lecons/${c.ids[0]}`, undefined, {});
    expect((await env.api("GET", `/apprendre/${c.code}`)).corps.lecons[1].direct_lien).toBe("https://meet.example.com/x");
    expect((await env.api("POST", `/cours/${c.coursId}/lecons`, o.jeton, { titre: "x", directLien: "http://non-chiffre.test" })).statut).toBe(400);
  });

  it("reste utilisable sans hébergement vidéo ni IA configurés", async () => {
    const o = await env.nouvelleOrganisation();
    const c = await cours(o, [{ titre: "1" }]);
    const r = await env.app.inject({ method: "PUT", url: `/lecons/${c.ids[0]}/video`, headers: { authorization: `Bearer ${o.jeton}`, "content-type": "video/mp4" }, payload: Buffer.from("x") });
    expect(r.json().erreur).toBe("medias_non_configures");
    expect((await env.api("GET", "/studio/etat", o.jeton)).corps.disponible).toBe(false);
    expect((await env.api("POST", "/studio/brouillons", o.jeton, { entiteId: o.entites.GTA, sujet: "Vendre", nombreLecons: 1 })).corps.erreur).toBe("ia_non_configuree");
  });
});
