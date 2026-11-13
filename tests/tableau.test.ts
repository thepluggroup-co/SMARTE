import { afterAll, describe, expect, it } from "vitest";
import { lireImage } from "../src/images.js";
import { decaler, periodes } from "../src/tableau.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;

const aujourdhui = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
const tableau = (jeton: string, espace: string, du = aujourdhui(), au = aujourdhui()) =>
  env.api("GET", `/tableau-de-bord/branche?espace=${espace}&du=${du}&au=${au}`, jeton);
const portefeuille = async (o: Org, nom: string, type: string, soldeInitial = 0, entiteId = o.entites.GLOMARI) =>
  (await env.api("POST", "/portefeuilles", o.jeton, { entiteId, nom, type, soldeInitial })).corps.id as string;

async function utilisateur(o: Org, code: string, entiteId: string) {
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
  const r = await env.api("POST", "/utilisateurs", o.jeton, {
    email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((x: { code: string }) => x.code === code).id,
  });
  expect(r.statut).toBe(201);
  return env.connecter(o.slug, email);
}

describe("périodes du tableau de bord", () => {
  it("compare à la période précédente et élargit la courbe à 30 jours", () => {
    expect(decaler("2026-03-01", -1)).toBe("2026-02-28");
    expect(periodes("2026-11-08", "2026-11-08")).toMatchObject({ jours: 1, precedent: { du: "2026-11-07", au: "2026-11-07" }, graphique: { du: "2026-10-10", granularite: "jour" } });
    expect(periodes("2026-11-01", "2026-11-30")).toMatchObject({ precedent: { du: "2026-10-02", au: "2026-10-31" }, graphique: { du: "2026-11-01" } });
    expect(periodes("2026-01-01", "2026-12-31").graphique.granularite).toBe("mois");
  });
});

describe("tableau de bord GLOMARI", () => {
  it("additionne ventes, entrées et sorties du jour, sans transferts ni soldes d'ouverture", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("PATCH", `/entites/${o.entites.GLOMARI}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const magasin = (await env.api("POST", "/magasins", o.jeton, { parentId: o.entites.GLOMARI, nom: "Akwa", type: "point_de_vente" })).corps.id;
    const caisse = await portefeuille(o, "Caisse", "especes", 10000);
    const banque = await portefeuille(o, "Banque", "banque");
    for (const entiteId of [o.entites.GLOMARI, magasin]) await env.api("PUT", "/portefeuilles/defauts", o.jeton, { entiteId, moyen: "especes", portefeuilleId: caisse });

    // Deux factures, dont une réglée, et une vente en caisse.
    const client = async (nom: string) => (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom, entiteId: o.entites.GLOMARI })).corps.id;
    const facture = async (tiersId: string, montant: number) => {
      const d = await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: o.entites.GLOMARI, tiersId, date: aujourdhui(), lignes: [{ designation: "Service", quantite: 1, prixUnitaire: montant }] });
      await env.api("POST", `/documents-vente/${d.corps.id}/emission`, o.jeton);
      return d.corps.id as string;
    };
    const awa = await facture(await client("Awa"), 5000);
    await facture(await client("Bello"), 12000);
    expect((await env.api("POST", `/factures/${awa}/reglements`, o.jeton, { montant: 5000, moyen: "especes" })).statut).toBe(201);
    const produit = (await env.api("POST", "/produits", o.jeton, { entiteId: o.entites.GLOMARI, code: "VENT", nom: "Ventilateur", prixVente: 1000 })).corps.id;
    await env.api("POST", "/caisse/ouverture", o.jeton, { entiteId: magasin, fondOuverture: 0 });
    expect((await env.api("POST", "/caisse/ventes", o.jeton, { entiteId: magasin, lignes: [{ produitId: produit, quantite: 2 }], paiements: [{ moyen: "especes", montant: 2000 }] })).statut).toBe(201);

    // Une dépense, une dépense annulée, un transfert interne.
    await env.api("POST", `/portefeuilles/${caisse}/mouvements`, o.jeton, { sens: "sortie", montant: 1500, libelle: "Loyer" });
    await env.api("POST", `/portefeuilles/${caisse}/mouvements`, o.jeton, { sens: "sortie", montant: 300, libelle: "Erreur" });
    const erreur = (await env.api("GET", `/portefeuilles/${caisse}/mouvements`, o.jeton)).corps.mouvements.find((m: { libelle: string }) => m.libelle === "Erreur");
    expect((await env.api("POST", `/mouvements-portefeuille/${erreur.id}/annulation`, o.jeton, { motif: "Erreur de saisie" })).statut).toBe(200);
    expect((await env.api("POST", "/portefeuilles/transferts", o.jeton, { deId: caisse, versId: banque, montant: 4000 })).statut).toBe(201);

    const t = await tableau(o.jeton, "commerce");
    expect(t.statut).toBe(200);
    expect(t.corps.finances).toMatchObject({ entrees: 7000, sorties: 1500, benefice: 5500, tresorerie: 15500, precedent: { entrees: 0, sorties: 0 } });
    expect(t.corps.finances.par_moyen).toEqual([{ moyen: "especes", montant: 7000 }]);
    expect(t.corps.finances.serie).toHaveLength(30);
    expect(t.corps.finances.serie.at(-1)).toEqual({ date: aujourdhui(), entrees: 7000, sorties: 1500 });
    const operations = t.corps.finances.operations as { libelle: string; sens: string; annulation: boolean; montant: number }[];
    expect(operations.filter((x) => x.annulation)).toEqual([expect.objectContaining({ sens: "sortie", montant: 300 })]);
    expect(operations.find((x) => x.libelle === "Loyer")).toMatchObject({ sens: "sortie", annulation: false, montant: -1500 });
    expect(operations.some((x) => x.libelle.includes("ransfert"))).toBe(false);
    expect(t.corps.ventes).toMatchObject({ total: 19000, nombre: 3, panier: 6333, precedent: { total: 0 } });
    expect(t.corps.ventes.meilleurs_clients).toEqual([{ nom: "Bello", achats: 1, montant: 12000 }, { nom: "Awa", achats: 1, montant: 5000 }]);
    expect(t.corps.ventes.meilleurs_employes).toEqual([{ nom: "Admin", ventes: 3, montant: 19000 }]);
    expect(t.corps.ventes.dernieres).toHaveLength(3);
    expect(t.corps.articles).toEqual([{ nom: "Ventilateur", code: "VENT", quantite: 2, montant: 2000 }]);
    expect(t.corps.creances).toEqual({ montant: 12000, factures: 1 });
    expect(t.corps.stocks).not.toBeNull();
    expect(t.corps.formation).toBeNull();

    // Hier : rien. Une période impossible est refusée.
    const hier = decaler(aujourdhui(), -1);
    expect((await tableau(o.jeton, "commerce", hier, hier)).corps.finances).toMatchObject({ entrees: 0, sorties: 0, precedent: { entrees: 0 } });
    expect((await tableau(o.jeton, "commerce", aujourdhui(), hier)).corps.erreur).toBe("periode_invalide");
  });

  it("ne montre à chacun que ce que ses droits permettent, dans sa branche", async () => {
    const o = await env.nouvelleOrganisation();
    const magasinier = await utilisateur(o, "magasinier", o.entites.GLOMARI!);
    const vueMagasinier = (await tableau(magasinier, "commerce")).corps;
    expect(vueMagasinier).toMatchObject({ finances: null, ventes: null, creances: null, formation: null });
    expect(vueMagasinier.stocks).not.toBeNull();
    const formateur = await utilisateur(o, "formateur", o.entites.GTA!);
    expect((await tableau(formateur, "commerce")).corps).toMatchObject({ finances: null, ventes: null, stocks: null, articles: null });
    const autre = await env.nouvelleOrganisation();
    const caisse = await portefeuille(autre, "Caisse", "especes", 50000);
    await env.api("POST", `/portefeuilles/${caisse}/mouvements`, autre.jeton, { sens: "entree", montant: 9999, libelle: "Ailleurs" });
    expect((await tableau(o.jeton, "commerce")).corps.finances).toMatchObject({ entrees: 0, tresorerie: 0 });
  });
});

describe("tableau de bord GTA", () => {
  it("classe programmes et formateurs, et compte les encaissements comme des ventes", async () => {
    const o = await env.nouvelleOrganisation();
    const moi = (await env.api("GET", "/moi", o.jeton)).corps.id;
    const plan = [{ libelle: "Inscription", montant: 50000, jours_apres_debut: 0 }];
    const programme = (await env.api("POST", "/programmes", o.jeton, { entiteId: o.entites.GTA, code: "ECOM", nom: "E-commerce", planPaiement: plan })).corps.id;
    const session = (await env.api("POST", "/sessions", o.jeton, {
      programmeId: programme, code: "S1", ville: "Douala", debut: decaler(aujourdhui(), -2), fin: decaler(aujourdhui(), 20), capacite: 4, formateurId: moi,
    })).corps.id;
    for (const [nom, montant] of [["Awa", 50000], ["Bello", 20000]] as const) {
      const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom, ignorerDoublons: true });
      const i = await env.api("POST", `/sessions/${session}/inscriptions`, o.jeton, { tiersId: t.corps.id });
      expect((await env.api("POST", `/inscriptions/${i.corps.id}/paiements`, o.jeton, { montant, moyen: "especes" })).statut).toBe(201);
    }
    const t = (await tableau(o.jeton, "formation")).corps;
    expect(t.ventes).toMatchObject({ total: 70000, nombre: 2 });
    expect(t.ventes.meilleurs_clients[0]).toMatchObject({ nom: "Awa", montant: 50000 });
    expect(t.formation).toMatchObject({ inscriptions: 2, sessions_en_cours: 1, remplissage: 50 });
    expect(t.formation.programmes).toEqual([{ nom: "E-commerce", inscriptions: 2, encaisse: 70000 }]);
    expect(t.formation.formateurs).toEqual([{ nom: "Admin", sessions: 1, apprenants: 2, note: null, avis: 0 }]);
    expect(t.articles).toBeNull();
    expect(t.stocks).toBeNull();
    // Rien de GTA dans le tableau de GLOMARI.
    expect((await tableau(o.jeton, "commerce")).corps.ventes).toMatchObject({ total: 0, nombre: 0 });
  });
});

describe("logo et photo de profil", () => {
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const png = () => `data:image/png;base64,${PNG.toString("base64")}`;

  it("reconnaît le type par le contenu et refuse le reste", () => {
    expect(lireImage(png(), 1000).type).toBe("image/png");
    expect(lireImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString("base64"), 1000).type).toBe("image/jpeg");
    expect(() => lireImage(Buffer.from("<svg onload=alert(1)>").toString("base64"), 1000)).toThrow();
    expect(() => lireImage(png(), 10)).toThrow();
  });

  it("enregistre le logo d'une entité, visible des seuls comptes de l'organisation", async () => {
    const o = await env.nouvelleOrganisation();
    const url = `/entites/${o.entites.GLOMARI}/logo`;
    expect((await env.api("PUT", url, o.jeton, { image: png() })).statut).toBe(200);
    expect((await env.api("PUT", url, o.jeton, { image: `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}` })).corps.erreur).toBe("format_image");
    const logos = (await env.api("GET", "/logos", o.jeton)).corps;
    expect(logos).toEqual([expect.objectContaining({ entite_id: o.entites.GLOMARI, code: "GLOMARI" })]);
    expect((await env.api("GET", `/logos/${o.entites.GLOMARI}`, o.jeton)).corps.image).toBe(png());
    const magasinier = await utilisateur(o, "magasinier", o.entites.GLOMARI!);
    expect((await env.api("GET", `/logos/${o.entites.GLOMARI}`, magasinier)).statut).toBe(200);
    expect((await env.api("PUT", url, magasinier, { image: png() })).statut).toBe(403);
    const autre = await env.nouvelleOrganisation();
    expect((await env.api("GET", `/logos/${o.entites.GLOMARI}`, autre.jeton)).statut).toBe(404);
    expect((await env.api("GET", "/logos", autre.jeton)).corps).toEqual([]);
    expect((await env.api("PUT", url, autre.jeton, { image: png() })).statut).toBe(404);
    expect((await env.api("DELETE", url, o.jeton)).statut).toBe(200);
    expect((await env.api("GET", "/logos", o.jeton)).corps).toEqual([]);
  });

  it("garde une photo par compte, que chacun gère seul", async () => {
    const o = await env.nouvelleOrganisation();
    const magasinier = await utilisateur(o, "magasinier", o.entites.GLOMARI!);
    expect((await env.api("GET", "/moi/photo", magasinier)).corps.image).toBeNull();
    expect((await env.api("PUT", "/moi/photo", magasinier, { image: png() })).statut).toBe(200);
    expect((await env.api("GET", "/moi/photo", magasinier)).corps.image).toBe(png());
    expect((await env.api("GET", "/moi/photo", o.jeton)).corps.image).toBeNull();
    const lourde = Buffer.concat([PNG, Buffer.alloc(600 * 1024)]).toString("base64");
    expect((await env.api("PUT", "/moi/photo", magasinier, { image: lourde })).corps.erreur).toBe("image_trop_lourde");
    expect((await env.api("DELETE", "/moi/photo", magasinier)).statut).toBe(200);
    expect((await env.api("GET", "/moi/photo", magasinier)).corps.image).toBeNull();
  });
});

describe("mot de passe", () => {
  it("accepte 8 caractères et refuse 7", async () => {
    const o = await env.nouvelleOrganisation();
    const roles = (await env.api("GET", "/roles", o.jeton)).corps;
    const creer = (motDePasse: string) => env.api("POST", "/utilisateurs", o.jeton, {
      email: `u${Math.random().toString(36).slice(2)}@test.cm`, nom: "U", motDePasse, entiteId: o.entites.GLOMARI,
      roleId: roles.find((x: { code: string }) => x.code === "magasinier").id,
    });
    expect((await creer("abcdefg")).statut).toBe(400);
    expect((await creer("abcdefgh")).statut).toBe(201);
  });
});
