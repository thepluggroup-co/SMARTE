import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { adressePrivee, urlAutorisee } from "../src/controle.js";
import { situationScolarite } from "../src/scolarite.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";
const env = await environnement();
afterAll(() => env.fermer());
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
const G = (o: Org) => o.entites.GLOMARI!;
const T = (o: Org) => o.entites.GTA!;
const j = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
async function compte(o: Org, code: string, entiteId: string) {
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
  const u = await env.api("POST", "/utilisateurs", o.jeton, { email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((x: { code: string }) => x.code === code).id });
  return { jeton: await env.connecter(o.slug, email), id: u.corps.id as string, email };
}
async function bulletinValide(o: Org) {
  const e = (await env.api("POST", "/employes", o.jeton, { entiteId: G(o), nom: "Awa", poste: "V", typeContrat: "cdi", dateEmbauche: "2025-01-01" })).corps;
  await env.api("PUT", `/employes/${e.id}/salaire`, o.jeton, { salaireBase: 100000 });
  await env.api("PUT", "/paie/validation", o.jeton, { entiteId: G(o), expert: "Cabinet X", valideLe: j(0) });
  const per = j(-40).slice(0, 7);
  const b = (await env.api("POST", "/bulletins", o.jeton, { employeId: e.id, periode: per })).corps;
  await env.api("POST", `/bulletins/${b.id}/validation`, o.jeton);
  return { e, b, per };
}
describe("failles corrigées", () => {
  it("les RH ne peuvent pas se relier à une fiche pour lire un salaire", async () => {
    const o = await env.nouvelleOrganisation();
    const { e } = await bulletinValide(o);
    const rh = await compte(o, "ressources_humaines", G(o));
    expect((await env.api("PUT", `/employes/${e.id}/compte`, rh.jeton, { email: rh.email })).statut).toBe(403);
    expect((await env.api("PATCH", `/employes/${e.id}/compte`, rh.jeton, { utilisateurId: rh.id })).statut).toBe(403);
    const a = await compte(o, "secretariat", G(o)), b = await compte(o, "secretariat", G(o));
    expect((await env.api("PUT", `/employes/${e.id}/compte`, o.jeton, { email: a.email })).corps.lie).toBe(true);
    expect((await env.api("PUT", `/employes/${e.id}/compte`, o.jeton, { email: b.email })).corps.erreur).toBe("fiche_deja_reliee");
    expect((await env.api("GET", "/employes", o.jeton)).corps[0].compte_paiement_chiffre).toBeUndefined();
  });
  it("une règle reste dans sa branche et n'est créée que par qui voit tout le groupe", async () => {
    const o = await env.nouvelleOrganisation();
    const moi = (await env.api("GET", "/moi", o.jeton)).corps.id;
    const r = await compte(o, "responsable_pilotage", T(o));
    const corps = { entiteId: T(o), nom: "Espion", evenement: "prospect.capte", titre: "Voir", assigneA: moi, action: "ticket" };
    expect((await env.api("POST", "/regles-auto", r.jeton, corps)).statut).toBe(403);
    await env.api("POST", "/regles-auto", o.jeton, corps);
    const f = (await env.api("POST", "/formulaires-capture", o.jeton, { entiteId: G(o), titre: "O", source: "S" })).corps;
    await env.app.inject({ method: "POST", url: `/capture/${encodeURIComponent(f.lien.split("c=")[1])}`, payload: { nom: "Cliente Glomari", consentement: true, telephone: "699000777" }, remoteAddress: "10.7.1.1" });
    await env.app.executerTaches(o.organisationId);
    expect((await env.api("GET", "/tickets", o.jeton)).corps).toEqual([]);
  });
  it("un rôle sans droit de fiches n'ouvre pas sa branche", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Client GTA", entiteId: T(o) });
    const roles = (await env.api("GET", "/roles", o.jeton)).corps;
    const code = (c: string) => roles.find((x: { code: string }) => x.code === c).id;
    const email = `mix${Math.random().toString(36).slice(2)}@test.cm`;
    const u = await env.api("POST", "/utilisateurs", o.jeton, { email, nom: "M", motDePasse: MOT_DE_PASSE, entiteId: o.entites.IP2EL, roleId: code("enseignant") });
    await env.api("POST", `/utilisateurs/${u.corps.id}/acces`, o.jeton, { roleId: code("service_client"), entiteId: G(o) });
    const jeton = await env.connecter(o.slug, email);
    expect((await env.api("GET", "/tiers", jeton)).corps.map((t: { nom: string }) => t.nom)).not.toContain("Client GTA");
  });
  it("le filtre d'adresses reconnaît les formes masquées", async () => {
    for (const ip of ["::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1", "fec0::1", "fe80::1", "::1", "::", "::ffff:127.0.0.1", "2002:7f00:1::", "198.18.0.1"]) expect(adressePrivee(ip), ip).toBe(true);
    expect(adressePrivee("2606:4700:4700::1111")).toBe(false);
    expect(await urlAutorisee("https://[::ffff:7f00:1]/x")).toBe(false);
  });
  it("cinq échecs depuis une adresse ne bloquent pas la personne ailleurs", async () => {
    const o = await env.nouvelleOrganisation();
    const c = await compte(o, "secretariat", G(o));
    const essai = (ip: string, m: string) => env.app.inject({ method: "POST", url: "/connexion", remoteAddress: ip, payload: { organisation: o.slug, email: c.email, motDePasse: m } });
    for (let i = 0; i < 5; i++) expect((await essai("10.50.0.1", "mauvais-mot-de-passe")).statusCode).toBe(401);
    expect((await essai("10.50.0.1", MOT_DE_PASSE)).statusCode).toBe(401);
    expect((await essai("10.50.0.2", MOT_DE_PASSE)).statusCode).toBe(200);
  });
  it("chacun change son mot de passe en donnant l'actuel", async () => {
    const o = await env.nouvelleOrganisation();
    const c = await compte(o, "secretariat", G(o));
    expect((await env.api("GET", "/moi", c.jeton)).corps.mot_de_passe_provisoire).toBe(true);
    expect((await env.api("POST", "/moi/mot-de-passe", c.jeton, { actuel: "faux", nouveau: "un-nouveau-mot-de-passe" })).corps.erreur).toBe("mot_de_passe_incorrect");
    expect((await env.api("POST", "/moi/mot-de-passe", c.jeton, { actuel: MOT_DE_PASSE, nouveau: "un-nouveau-mot-de-passe" })).corps.modifie).toBe(true);
    expect((await env.api("GET", "/moi", c.jeton)).corps.mot_de_passe_provisoire).toBe(false);
  });
  it("une organisation suspendue ferme ses pages publiques", async () => {
    const o = await env.nouvelleOrganisation();
    const f = (await env.api("POST", "/formulaires-capture", o.jeton, { entiteId: G(o), titre: "O", source: "S" })).corps;
    const url = `/capture/${encodeURIComponent(f.lien.split("c=")[1])}`;
    expect((await env.app.inject({ method: "GET", url })).statusCode).toBe(200);
    await env.poolAdmin.query("update organisations set statut = 'suspendue' where id = $1", [o.organisationId]);
    expect((await env.app.inject({ method: "GET", url })).statusCode).toBe(404);
  });
});
describe("argent", () => {
  it("un bulletin versé ne s'annule plus, et un versement ne s'annule pas depuis le portefeuille", async () => {
    const o = await env.nouvelleOrganisation();
    const { b, per } = await bulletinValide(o);
    const w = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: G(o), nom: "B", type: "banque", soldeInitial: 500000 })).corps;
    await env.api("POST", "/paie/versements", o.jeton, { entiteId: G(o), periode: per, portefeuilleId: w.id, bulletins: [b.id] });
    expect((await env.api("POST", `/bulletins/${b.id}/annulation`, o.jeton, { motif: "Erreur de saisie" })).corps.erreur).toBe("bulletin_deja_verse");
    const m = (await env.api("GET", `/portefeuilles/${w.id}/mouvements`, o.jeton)).corps.mouvements.find((x: { montant: number }) => x.montant === -100000);
    expect((await env.api("POST", `/mouvements-portefeuille/${m.id}/annulation`, o.jeton, { motif: "Essai de fraude" })).corps.erreur).toBe("mouvement_non_annulable");
    await expect(dansOrganisation(env.poolApp, o.organisationId, (c) => c.query("update versements_paie set montant = 1"))).rejects.toThrow();
  });
  it("la paie et son versement se soldent en comptabilité, un bulletin annulé se contre-passe", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("POST", "/compta/initialisation", o.jeton, { brancheId: G(o) });
    const { b, per } = await bulletinValide(o);
    const w = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: G(o), nom: "B", type: "banque", soldeInitial: 500000 })).corps;
    await env.api("POST", "/paie/versements", o.jeton, { entiteId: G(o), periode: per, portefeuilleId: w.id, bulletins: [b.id] });
    const G2 = () => env.api("POST", "/compta/generation", o.jeton, { brancheId: G(o), fin: j(0) });
    await G2();
    const l = (await env.api("GET", `/compta/ecritures?brancheId=${G(o)}&statut=brouillon`, o.jeton)).corps;
    await env.api("POST", "/compta/ecritures/validation", o.jeton, { ids: l.map((x: { id: string }) => x.id) });
    const bal = (await env.api("GET", `/compta/balance?brancheId=${G(o)}&debut=2025-01-01&fin=${j(0)}`, o.jeton)).corps;
    const ligne = (n: string) => (bal.lignes ?? bal).find((x: { numero: string }) => x.numero === n);
    expect(Number(ligne("422").debit)).toBe(100000);
    expect(Number(ligne("422").credit)).toBe(100000);
  });
  it("une écriture manuelle ne peut pas usurper une pièce d'un autre module", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("POST", "/compta/initialisation", o.jeton, { brancheId: G(o) });
    const faux = "00000000-0000-4000-8000-000000000001";
    const e = await env.api("POST", "/compta/ecritures", o.jeton, { brancheId: G(o), journal: "OD", date: j(0), libelle: "Faux", sourceType: "reglement", sourceId: faux, auteur: null, lignes: [{ numero: "622", debit: 1 }, { numero: "5711", credit: 1 }] });
    expect(e.corps.source_id ?? null).toBe(null);
    expect(e.corps.cree_par).toBeTruthy();
  });
  it("la remise d'un contre-remboursement règle la facture une seule fois", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("PATCH", `/entites/${G(o)}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const t = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "C", entiteId: G(o) })).corps.id;
    const d = (await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: G(o), tiersId: t, date: j(0), lignes: [{ designation: "X", quantite: 1, prixUnitaire: 50000 }] })).corps.id;
    await env.api("POST", `/documents-vente/${d}/emission`, o.jeton);
    const w = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: G(o), nom: "Caisse", type: "especes" })).corps.id;
    const c = (await env.api("POST", "/colis", o.jeton, { entiteId: G(o), destinataire: "C", documentId: d, aEncaisser: 50000 })).corps;
    const tr = (await env.api("POST", "/tournees", o.jeton, { entiteId: G(o), jour: j(0), livreur: "Paul", colis: [c.id] })).corps;
    expect((await env.api("POST", `/colis/${c.id}/livraison`, o.jeton, { recuPar: "C", encaisse: 50000, code: c.code_confirmation })).corps.statut).toBe("livre");
    expect((await env.api("POST", `/tournees/${tr.id}/remise`, o.jeton, { portefeuilleId: w, compte: 50000 })).corps.ecart).toBe(0);
    expect((await env.api("GET", "/creances", o.jeton)).corps).toEqual([]);
    expect((await env.api("GET", "/portefeuilles", o.jeton)).corps.find((x: { id: string }) => x.id === w).solde).toBe(50000);
  });
  it("garde le trop-perçu visible après une bourse tardive", () => {
    expect(situationScolarite([{ montant: 200, echeance: "2026-01-01" }], 100, 200, "2026-02-01")).toMatchObject({ reste: 0, trop_percu: 100 });
  });
  it("une facture passée en perte refuse un avoir", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("PATCH", `/entites/${G(o)}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const t = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "C", entiteId: G(o) })).corps.id;
    const d = (await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: G(o), tiersId: t, date: j(0), lignes: [{ designation: "X", quantite: 1, prixUnitaire: 100 }] })).corps.id;
    await env.api("POST", `/documents-vente/${d}/emission`, o.jeton);
    await env.api("POST", `/recouvrement/factures/${d}/douteuse`, o.jeton, { provision: 0, motif: "Client injoignable" });
    await env.api("POST", `/recouvrement/factures/${d}/perte`, o.jeton, { motif: "Société liquidée" });
    const c = await compte(o, "chef_comptable", G(o));
    await env.api("POST", `/recouvrement/factures/${d}/perte/validation`, c.jeton);
    const route = (await env.api("POST", `/factures/${d}/avoir`, o.jeton, { date: j(0), motif: "Erreur de client" }));
    expect(route.corps.erreur).toBe("facture_passee_en_perte");
  });
  it("une facture fournisseur validée s'annule encore, et rien d'autre n'y change", async () => {
    const o = await env.nouvelleOrganisation();
    const f = (await env.api("POST", "/tiers", o.jeton, { type: "entreprise", nom: "F", entiteId: G(o) })).corps.id;
    await env.api("POST", "/compta/initialisation", o.jeton, { brancheId: G(o) });
    const rx = await env.api("POST", "/fournisseurs/factures", o.jeton, { entiteId: G(o), fournisseurId: f, numeroFournisseur: "Z1", date: j(-1), niu: "M", lignes: [{ designation: "x", compte: "622", montantHt: 500 }] }); const x = rx.corps;
    expect((await env.api("POST", `/fournisseurs/factures/${x.id}/validation`, o.jeton)).statut).toBe(200);
    const r = await env.api("POST", `/fournisseurs/factures/${x.id}/annulation`, o.jeton, { motif: "Saisie en double" });
    expect(r.corps).toEqual({ annulee: true });
  });
  it("deux colis d'une même facture ne la surpaient pas, et l'argent va au portefeuille choisi", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("PATCH", `/entites/${G(o)}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const t = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "C", entiteId: G(o) })).corps.id;
    const d = (await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: G(o), tiersId: t, date: j(0), lignes: [{ designation: "X", quantite: 1, prixUnitaire: 10000 }] })).corps.id;
    await env.api("POST", `/documents-vente/${d}/emission`, o.jeton);
    await env.api("POST", "/portefeuilles", o.jeton, { entiteId: G(o), nom: "Caisse", type: "especes" });
    const coffre = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: G(o), nom: "Coffre", type: "especes" })).corps.id;
    const c1 = (await env.api("POST", "/colis", o.jeton, { entiteId: G(o), destinataire: "C", documentId: d, aEncaisser: 6000 })).corps;
    const c2 = (await env.api("POST", "/colis", o.jeton, { entiteId: G(o), destinataire: "C", documentId: d, aEncaisser: 6000 })).corps;
    const tr = (await env.api("POST", "/tournees", o.jeton, { entiteId: G(o), jour: j(0), livreur: "Paul", colis: [c1.id, c2.id] })).corps;
    for (const c of [c1, c2]) await env.api("POST", `/colis/${c.id}/livraison`, o.jeton, { recuPar: "C", encaisse: 6000, code: c.code_confirmation });
    await env.api("POST", `/tournees/${tr.id}/remise`, o.jeton, { portefeuilleId: coffre, compte: 12000 });
    const { rows } = await dansOrganisation(env.poolAdmin, o.organisationId, (x) => x.query("select coalesce(sum(montant), 0)::int8 as s from reglements where facture_id = $1", [d]));
    expect(Number(rows[0].s)).toBe(10000);
    const ws = (await env.api("GET", "/portefeuilles", o.jeton)).corps;
    expect(ws.find((x: { id: string }) => x.id === coffre).solde).toBe(12000);
    expect(ws.reduce((a: number, x: { solde: number }) => a + x.solde, 0)).toBe(12000);
  });
  it("un rôle dans une autre branche n'ouvre pas la fiche d'un client", async () => {
    const o = await env.nouvelleOrganisation();
    const fiche = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Client GLOMARI", entiteId: G(o) })).corps.id;
    const c = await compte(o, "service_client", T(o));
    const roles = (await env.api("GET", "/roles", o.jeton)).corps;
    await dansOrganisation(env.poolAdmin, o.organisationId, (x) => x.query("insert into attributions (organisation_id, utilisateur_id, role_id, entite_id) values ($1, $2, $3, $4)", [o.organisationId, c.id, roles.find((r: { code: string }) => r.code === "enseignant").id, G(o)]));
    expect((await env.api("GET", `/tiers/${fiche}`, c.jeton)).statut).toBe(404);
    expect((await env.api("PATCH", `/tiers/${fiche}`, c.jeton, { nom: "Autre" })).statut).toBe(404);
  });
  it("une fiche déjà reliée à un compte n'est pas écrasée", async () => {
    const o = await env.nouvelleOrganisation();
    const e = (await env.api("POST", "/employes", o.jeton, { entiteId: G(o), nom: "Awa", poste: "V", typeContrat: "cdi", dateEmbauche: "2025-01-01" })).corps;
    const a = await compte(o, "caissier", G(o));
    const b = await compte(o, "caissier", G(o));
    await env.api("PATCH", `/employes/${e.id}/compte`, o.jeton, { utilisateurId: a.id });
    expect((await env.api("PATCH", `/employes/${e.id}/compte`, o.jeton, { utilisateurId: b.id })).corps.erreur).toBe("fiche_deja_reliee");
  });
  it("une connexion réussie remet le compteur à zéro", async () => {
    const o = await env.nouvelleOrganisation();
    const c = await compte(o, "caissier", G(o));
    for (let i = 0; i < 4; i++) await env.connecter(o.slug, c.email, "mauvais-mot-de-passe").catch(() => null);
    await env.connecter(o.slug, c.email);
    await env.connecter(o.slug, c.email, "mauvais-mot-de-passe").catch(() => null);
    expect(await env.connecter(o.slug, c.email)).toBeTruthy();
  });
  it("une référence de paiement ne sert qu'une fois, même en même temps et d'un module à l'autre", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("PATCH", `/entites/${G(o)}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const t = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "C", entiteId: G(o) })).corps.id;
    const facture = async () => { const d = (await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: G(o), tiersId: t, date: j(0), lignes: [{ designation: "X", quantite: 1, prixUnitaire: 5000 }] })).corps.id; await env.api("POST", `/documents-vente/${d}/emission`, o.jeton); return d; };
    const [a, b, c] = [await facture(), await facture(), await facture()];
    const payer = (d: string, reference: string) => env.api("POST", `/factures/${d}/reglements`, o.jeton, { montant: 5000, moyen: "mtn_momo", reference });
    const r = await Promise.all([payer(a, "MP1"), payer(b, "mp1 ")]);
    expect(r.map((x) => x.statut).sort()).toEqual([201, 409]);
    expect((await payer(c, "MP1")).corps.erreur).toBe("reference_deja_utilisee");
    const gagnant = r.find((x) => x.statut === 201)!;
    await env.api("POST", `/reglements/${gagnant.corps.id}/annulation`, o.jeton, { motif: "Erreur de saisie" });
    expect((await payer(c, "MP1")).statut).toBe(201);
  });
  it("le service après vente ne rembourse pas sans droit de trésorerie", async () => {
    const o = await env.nouvelleOrganisation();
    const care = await compte(o, "care", G(o));
    const t = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "C", entiteId: G(o) })).corps.id;
    const d = (await env.api("POST", "/sav", o.jeton, { entiteId: G(o), tiersId: t, demande: "retour", motif: "Panne", delaiJours: 3 })).corps.id;
    const etape = (e: string) => env.api("POST", `/sav/${d}/etape`, o.jeton, { statut: e });
    await etape("autorise"); await etape("recu");
    const w = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: G(o), nom: "Coffre", type: "especes", soldeInitial: 900000 })).corps.id;
    expect((await env.api("POST", `/sav/${d}/decision`, care.jeton, { decision: "remboursement", montant: 900000, portefeuilleId: w })).statut).toBe(403);
  });
  it("un inventaire et une réservation refusent ce qui vient de l'autre branche", async () => {
    const o = await env.nouvelleOrganisation();
    const p = (await env.api("POST", "/produits", o.jeton, { entiteId: T(o), code: "F", nom: "Formation", prixVente: 1000 })).corps.id;
    const c = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Apprenant", entiteId: T(o) })).corps.id;
    const g = (await env.api("POST", "/produits", o.jeton, { entiteId: G(o), code: "A", nom: "A", prixVente: 1000, suiviStock: true })).corps.id;
    await env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: G(o), produitId: g, type: "entree", quantite: 5, coutUnitaire: 100 });
    const i = (await env.api("POST", "/inventaires", o.jeton, { entiteId: G(o), libelle: "Mensuel" })).corps.id;
    expect((await env.api("PUT", `/inventaires/${i}/lignes`, o.jeton, { produitId: p, compte: 3 })).statut).toBe(404);
    expect((await env.api("POST", "/reservations-stock", o.jeton, { entiteId: G(o), produitId: g, quantite: 1, tiersId: c })).statut).toBeGreaterThanOrEqual(400);
  });
  it("une ligne par tranches garde son total exact, à la caisse comme sur la facture", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("PATCH", `/entites/${G(o)}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const p = (await env.api("POST", "/produits", o.jeton, { entiteId: G(o), code: "A", nom: "A", prixVente: 1000 })).corps.id;
    await env.api("PUT", `/produits/${p}/paliers`, o.jeton, { actif: true, paliers: [{ quantiteMin: 2, prix: 999 }] });
    await env.api("PUT", `/produits/${p}/mode-palier`, o.jeton, { mode: "tranches" });
    const t = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "C", entiteId: G(o) })).corps.id;
    const d = (await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: G(o), tiersId: t, date: j(0), lignes: [{ produitId: p, quantite: 3 }] })).corps;
    expect(d.total_ht).toBe(2998);
  });
});
