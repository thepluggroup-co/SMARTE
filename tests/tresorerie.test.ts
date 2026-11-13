import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
const PLAN = [
  { libelle: "Inscription", montant: 20000, jours_apres_debut: 0 },
  { libelle: "Tranche 1", montant: 50000, jours_apres_debut: 0 },
  { libelle: "Tranche 2", montant: 50000, jours_apres_debut: 30 },
];
const creer = async (o: Org, nom: string, entite = o.entites.GLOMARI, type = "orange_money", soldeInitial = 0) =>
  (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: entite, nom, type, soldeInitial })).corps.id as string;
const solde = async (o: Org, id: string) => (await env.api("GET", `/portefeuilles/${id}/mouvements`, o.jeton)).corps.solde as number;

describe("portefeuilles", () => {
  it("transfère avec frais, sans dépasser le solde, et annule par écriture inverse", async () => {
    const o = await env.nouvelleOrganisation();
    const [om, banque] = [await creer(o, "OM", undefined, "orange_money", 10000), await creer(o, "Banque", undefined, "banque")];
    const t = (montant: number, frais = 0) => env.api("POST", "/portefeuilles/transferts", o.jeton, { deId: om, versId: banque, montant, frais });
    expect((await t(10000, 1)).corps.erreur).toBe("solde_portefeuille_insuffisant");
    expect((await t(9000, 100)).corps).toMatchObject({ solde_de: 900, solde_vers: 9000 });
    expect((await env.api("POST", "/portefeuilles/transferts", o.jeton, { deId: om, versId: om, montant: 1 })).corps.erreur).toBe("transfert_identique");
    const mv = (await env.api("GET", `/portefeuilles/${banque}/mouvements`, o.jeton)).corps.mouvements[0];
    expect((await env.api("POST", `/mouvements-portefeuille/${mv.id}/annulation`, o.jeton, { motif: "Erreur de saisie" })).corps.annule).toBe(3);
    expect([await solde(o, om), await solde(o, banque)]).toEqual([10000, 0]);
    expect((await env.api("POST", `/mouvements-portefeuille/${mv.id}/annulation`, o.jeton, { motif: "Erreur de saisie" })).corps.erreur).toBe("deja_annule");
  });

  it("n'accepte pas deux dépenses simultanées au-delà du solde", async () => {
    const o = await env.nouvelleOrganisation();
    const p = await creer(o, "Caisse", undefined, "especes", 1000);
    const r = await Promise.all(Array.from({ length: 5 }, () => env.api("POST", `/portefeuilles/${p}/mouvements`, o.jeton, { sens: "sortie", montant: 400, libelle: "Dépense" })));
    expect(r.filter((x) => x.statut === 201)).toHaveLength(2);
    expect(await solde(o, p)).toBe(200);
  });

  it("garde GLOMARI et GTA séparées et cloisonne les droits", async () => {
    const o = await env.nouvelleOrganisation();
    const [g, a] = [await creer(o, "G", undefined, "banque", 100), await creer(o, "A", o.entites.GTA, "banque")];
    expect((await env.api("POST", "/portefeuilles/transferts", o.jeton, { deId: g, versId: a, montant: 1 })).corps.erreur).toBe("transfert_autre_branche");
    expect((await env.api("PUT", "/portefeuilles/defauts", o.jeton, { entiteId: o.entites.GTA, moyen: "virement", portefeuilleId: g })).corps.erreur).toBe("transfert_autre_branche");
    const roles = (await env.api("GET", "/roles", o.jeton)).corps;
    const email = `t${Math.random().toString(36).slice(2)}@test.cm`;
    await env.api("POST", "/utilisateurs", o.jeton, { email, nom: "T", motDePasse: MOT_DE_PASSE, entiteId: o.entites.GTA, roleId: roles.find((x: { code: string }) => x.code === "tresorier").id });
    const tresorier = await env.connecter(o.slug, email);
    expect((await env.api("GET", "/portefeuilles", tresorier)).corps.map((x: { id: string }) => x.id)).toEqual([a]);
    expect((await env.api("GET", `/portefeuilles/${g}/mouvements`, tresorier)).statut).toBe(403);
    const autre = await env.nouvelleOrganisation();
    expect((await env.api("GET", `/portefeuilles/${g}/mouvements`, autre.jeton)).statut).toBe(404);
  });

  it("n'efface jamais un mouvement et refuse de désactiver un portefeuille non vide", async () => {
    const o = await env.nouvelleOrganisation();
    const p = await creer(o, "P", undefined, "autre", 5);
    expect((await env.api("PATCH", `/portefeuilles/${p}`, o.jeton, { actif: false })).corps.erreur).toBe("portefeuille_non_vide");
    await expect(dansOrganisation(env.poolApp, o.organisationId, (c) => c.query("update mouvements_portefeuille set montant = 1"))).rejects.toThrow(/permission denied/);
    await expect(dansOrganisation(env.poolApp, o.organisationId, (c) => c.query("delete from mouvements_portefeuille"))).rejects.toThrow(/permission denied/);
  });
});

describe("encaissements automatiques", () => {
  it("crédite et annule depuis la caisse, avec la monnaie rendue, sans compter les points", async () => {
    const o = await env.nouvelleOrganisation();
    const m = await env.api("POST", "/magasins", o.jeton, { parentId: o.entites.GLOMARI, nom: "Akwa", type: "point_de_vente" });
    const [cash, cashAkwa, momo] = [await creer(o, "Cash", undefined, "especes"), await creer(o, "Tiroir Akwa", undefined, "especes"), await creer(o, "MoMo", undefined, "mtn_momo")];
    const regle = (entiteId: string, moyen: string, portefeuilleId: string) => env.api("PUT", "/portefeuilles/defauts", o.jeton, { entiteId, moyen, portefeuilleId });
    await regle(o.entites.GLOMARI!, "especes", cash);
    await regle(m.corps.id, "especes", cashAkwa);
    await regle(o.entites.GLOMARI!, "mtn_momo", momo);
    const p = (await env.api("POST", "/produits", o.jeton, { entiteId: o.entites.GLOMARI, code: "A", nom: "A", prixVente: 1000 })).corps.id;
    await env.api("POST", "/caisse/ouverture", o.jeton, { entiteId: m.corps.id, fondOuverture: 0 });
    const vente = await env.api("POST", "/caisse/ventes", o.jeton, {
      entiteId: m.corps.id, lignes: [{ produitId: p, quantite: 2 }],
      paiements: [{ moyen: "mtn_momo", montant: 500, reference: "MM1" }, { moyen: "especes", montant: 2000 }],
    });
    expect(vente.corps.rendu).toBe(500);
    expect([await solde(o, cashAkwa), await solde(o, cash), await solde(o, momo)]).toEqual([1500, 0, 500]);
    await env.api("POST", `/caisse/ventes/${vente.corps.id}/annulation`, o.jeton, { motif: "Erreur client" });
    expect([await solde(o, cashAkwa), await solde(o, momo)]).toEqual([0, 0]);
    const ecr = (await env.api("GET", `/portefeuilles/${momo}/mouvements`, o.jeton)).corps.mouvements;
    expect(ecr.map((x: { type: string }) => x.type).sort()).toEqual(["annulation", "encaissement"]);
    expect((await env.api("POST", `/mouvements-portefeuille/${ecr.find((x: { type: string }) => x.type === "encaissement").id}/annulation`, o.jeton, { motif: "Pas ici" })).corps.erreur).toBe("mouvement_non_annulable");
  });

  it("crédite un règlement de facture, et ne bloque rien sans réglage", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("PATCH", `/entites/${o.entites.GLOMARI}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "C", entiteId: o.entites.GLOMARI });
    const d = await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: o.entites.GLOMARI, tiersId: t.corps.id, date: "2026-01-01", lignes: [{ designation: "X", quantite: 1, prixUnitaire: 5000 }] });
    await env.api("POST", `/documents-vente/${d.corps.id}/emission`, o.jeton);
    const regler = (montant: number, reference: string) => env.api("POST", `/factures/${d.corps.id}/reglements`, o.jeton, { montant, moyen: "orange_money", reference });
    expect((await regler(1000, "A1")).statut).toBe(201);
    const om = await creer(o, "OM");
    expect(await solde(o, om)).toBe(0);
    await env.api("PUT", "/portefeuilles/defauts", o.jeton, { entiteId: o.entites.GLOMARI, moyen: "orange_money", portefeuilleId: om });
    const r = await regler(2000, "A2");
    expect(await solde(o, om)).toBe(2000);
    await env.api("POST", `/reglements/${r.corps.id}/annulation`, o.jeton, { motif: "Erreur de saisie" });
    expect(await solde(o, om)).toBe(0);
  });

  it("crédite un paiement de formation dans le portefeuille de GTA", async () => {
    const o = await env.nouvelleOrganisation();
    const om = await creer(o, "OM GTA", o.entites.GTA);
    await env.api("PUT", "/portefeuilles/defauts", o.jeton, { entiteId: o.entites.GTA, moyen: "orange_money", portefeuilleId: om });
    const prog = await env.api("POST", "/programmes", o.jeton, { entiteId: o.entites.GTA, code: "E", nom: "E", planPaiement: PLAN });
    const s = await env.api("POST", "/sessions", o.jeton, { programmeId: prog.corps.id, code: "S1", ville: "Douala", debut: "2026-11-09", fin: "2026-12-09", capacite: 10 });
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Awa", entiteId: o.entites.GTA });
    const i = await env.api("POST", `/sessions/${s.corps.id}/inscriptions`, o.jeton, { tiersId: t.corps.id });
    const p = await env.api("POST", `/inscriptions/${i.corps.id}/paiements`, o.jeton, { montant: 20000, moyen: "orange_money", reference: "OM1" });
    expect(p.statut).toBe(201);
    expect(await solde(o, om)).toBe(20000);
    await env.api("POST", `/paiements/${p.corps.id}/annulation`, o.jeton, { motif: "Erreur de saisie" });
    expect(await solde(o, om)).toBe(0);
  });
});

describe("encaissements en attente", () => {
  const paiementGta = async (o: Org) => {
    const prog = await env.api("POST", "/programmes", o.jeton, { entiteId: o.entites.GTA, code: "E", nom: "E", planPaiement: PLAN });
    const s = await env.api("POST", "/sessions", o.jeton, { programmeId: prog.corps.id, code: "S1", ville: "Douala", debut: "2026-11-09", fin: "2026-12-09", capacite: 10 });
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Awa", entiteId: o.entites.GTA });
    const i = await env.api("POST", `/sessions/${s.corps.id}/inscriptions`, o.jeton, { tiersId: t.corps.id });
    return (montant: number, reference: string) => env.api("POST", `/inscriptions/${i.corps.id}/paiements`, o.jeton, { montant, moyen: "orange_money", reference });
  };
  const attente = async (o: Org, jeton = o.jeton) => (await env.api("GET", "/encaissements-en-attente", jeton)).corps as { id: string; montant: string | number }[];

  it("garde l'argent sans portefeuille par défaut et le place ensuite dans la bonne branche", async () => {
    const o = await env.nouvelleOrganisation();
    const payer = await paiementGta(o);
    const p = await payer(20000, "OM1");
    expect(p.statut).toBe(201);
    const [a] = await attente(o);
    expect(Number(a!.montant)).toBe(20000);
    const notif = (await env.api("GET", "/notifications", o.jeton)).corps as { genre: string; nombre: number }[];
    expect(notif.find((n) => n.genre === "tresorerie")?.nombre).toBe(1);

    const glomari = await creer(o, "OM GLOMARI");
    const gta = await creer(o, "OM GTA", o.entites.GTA);
    const placer = (portefeuilleId: string, parDefaut = false) => env.api("POST", `/encaissements-en-attente/${a!.id}/affectation`, o.jeton, { portefeuilleId, parDefaut });
    expect((await placer(glomari)).corps.erreur).toBe("transfert_autre_branche");
    expect((await placer(gta, true)).corps.solde).toBe(20000);
    expect((await placer(gta)).corps.erreur).toBe("encaissement_deja_traite");
    expect(await attente(o)).toEqual([]);

    // Le réglage enregistré au passage sert au paiement suivant, sans attente.
    await payer(5000, "OM2");
    expect([await solde(o, gta), (await attente(o)).length]).toEqual([25000, 0]);
    // L'annulation du reçu contre-passe aussi l'argent placé à la main.
    await env.api("POST", `/paiements/${p.corps.id}/annulation`, o.jeton, { motif: "Erreur de saisie" });
    expect(await solde(o, gta)).toBe(5000);
  });

  it("retire de l'attente un reçu annulé et cloisonne les droits", async () => {
    const o = await env.nouvelleOrganisation();
    const payer = await paiementGta(o);
    const p = await payer(20000, "OM1");
    await env.api("POST", `/paiements/${p.corps.id}/annulation`, o.jeton, { motif: "Erreur de saisie" });
    expect(await attente(o)).toEqual([]);

    await payer(3000, "OM3");
    const [a] = await attente(o);
    const roles = (await env.api("GET", "/roles", o.jeton)).corps;
    const email = `t${Math.random().toString(36).slice(2)}@test.cm`;
    await env.api("POST", "/utilisateurs", o.jeton, { email, nom: "T", motDePasse: MOT_DE_PASSE, entiteId: o.entites.GLOMARI, roleId: roles.find((x: { code: string }) => x.code === "tresorier").id });
    const tresorierGlomari = await env.connecter(o.slug, email);
    expect(await attente(o, tresorierGlomari)).toEqual([]);
    const sien = await creer(o, "OM G");
    expect((await env.api("POST", `/encaissements-en-attente/${a!.id}/affectation`, tresorierGlomari, { portefeuilleId: sien })).statut).toBe(403);
    expect((await env.api("GET", "/encaissements-en-attente", (await env.nouvelleOrganisation()).jeton)).corps).toEqual([]);
    await expect(dansOrganisation(env.poolApp, o.organisationId, (c) => c.query("update encaissements_en_attente set montant = 1 where id = $1", [a!.id]))).rejects.toThrow(/non modifiable/);
    await expect(dansOrganisation(env.poolApp, o.organisationId, (c) => c.query("delete from encaissements_en_attente"))).rejects.toThrow(/permission denied/);
  });
});
