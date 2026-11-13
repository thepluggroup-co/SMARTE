import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { prixPromo } from "../src/commerce.js";
import { typeFichier } from "../src/documents.js";
import { creerServeur } from "../src/serveur.js";
import { environnement, MOT_DE_PASSE, OPTIONS } from "./outils.js";

const env = await environnement();
const dossier = await mkdtemp(join(tmpdir(), "ged-"));
const app = await creerServeur(env.poolApp, { ...OPTIONS, dossierMedias: dossier });
afterAll(async () => { await app.close(); await env.fermer(); await rm(dossier, { recursive: true, force: true }); });
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
const G = (o: Org) => o.entites.GLOMARI!;
const PDF = Buffer.from("%PDF-1.7 contenu");
const j = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
async function compte(o: Org, code: string, entiteId: string) {
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
  const u = await env.api("POST", "/utilisateurs", o.jeton, { email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((x: { code: string }) => x.code === code).id });
  return { jeton: await env.connecter(o.slug, email), id: u.corps.id as string, email };
}
const envoi = (url: string, jeton: string, corps: Buffer, type = "application/pdf") => app.inject({ method: "PUT", url, headers: { authorization: `Bearer ${jeton}`, "content-type": type }, payload: corps });
const lire = (url: string, jeton: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${jeton}` } });

describe("documents", () => {
  it("reconnaît le type par le contenu", () => {
    expect(typeFichier(PDF, "image/png")).toBe("application/pdf");
    expect(typeFichier(Buffer.from("<script>"), "application/pdf")).toBe(null);
    expect(typeFichier(Buffer.from("PK\u0003\u0004abc", "latin1"), "application/pdf")).toBe(null);
  });
  it("garde les versions, refuse un faux fichier, cloisonne le RH et archive sans effacer", async () => {
    const o = await env.nouvelleOrganisation();
    const url = `/documents?entiteId=${G(o)}&titre=Bail&categorie=contrat`;
    expect((await envoi(url, o.jeton, Buffer.from("<html>"))).statusCode).toBe(415);
    const d = await envoi(url, o.jeton, PDF);
    expect(d.statusCode).toBe(201);
    const v2 = await envoi(`${url}&remplace=${d.json().id}`, o.jeton, Buffer.from("%PDF-1.7 v2"));
    expect(v2.json().version).toBe(2);
    expect((await lire("/documents", o.jeton)).json()).toHaveLength(1);
    expect((await lire(`/documents/${d.json().id}/versions`, o.jeton)).json()).toHaveLength(2);
    const f = await lire(`/documents/${v2.json().id}/fichier`, o.jeton);
    expect(f.body).toContain("v2");
    expect(f.headers["content-disposition"]).toContain("attachment");
    const rhDoc = await envoi(`/documents?entiteId=${G(o)}&titre=Contrat%20de%20travail&categorie=rh`, o.jeton, PDF);
    const sec = await compte(o, "secretariat", G(o));
    expect((await lire("/documents", sec.jeton)).json().map((x: { titre: string }) => x.titre)).toEqual(["Bail"]);
    expect((await lire(`/documents/${rhDoc.json().id}/fichier`, sec.jeton)).statusCode).toBe(403);
    expect((await envoi(`/documents?entiteId=${G(o)}&titre=X&categorie=rh`, sec.jeton, PDF)).statusCode).toBe(403);
    const gta = await compte(o, "secretariat", o.entites.GTA!);
    expect((await lire(`/documents/${d.json().id}/fichier`, gta.jeton)).statusCode).toBe(403);
    await env.api("POST", `/documents/${d.json().id}/archivage`, o.jeton, { motif: "Bail terminé" });
    expect((await lire("/documents", sec.jeton)).json()).toEqual([]);
    expect((await lire("/documents?archives=true", sec.jeton)).json()).toHaveLength(1);
    const e = await env.nouvelleOrganisation();
    expect((await lire(`/documents/${d.json().id}/fichier`, e.jeton)).statusCode).toBe(404);
  });
});

describe("agenda", () => {
  it("refuse un chevauchement et accepte le créneau suivant", async () => {
    const o = await env.nouvelleOrganisation();
    const r = await env.api("POST", "/ressources", o.jeton, { entiteId: o.entites.GTA!, nom: "Salle A", type: "salle", capacite: 30 });
    const P = (d: string, f: string) => env.api("POST", "/reservations", o.jeton, { ressourceId: r.corps.id, debut: `${j(1)}T${d}:00Z`, fin: `${j(1)}T${f}:00Z`, objet: "Atelier" });
    expect((await P("09:00", "11:00")).statut).toBe(201);
    expect((await P("10:00", "12:00")).corps.erreur).toBe("ressource_occupee");
    expect((await P("08:00", "09:00")).statut).toBe(201);
    const x = await P("11:00", "12:00");
    expect(x.statut).toBe(201);
    expect((await P("10:00", "09:00")).statut).toBe(400);
    await env.api("POST", `/reservations/${x.corps.id}/annulation`, o.jeton);
    expect((await P("11:00", "12:00")).statut).toBe(201);
    expect((await env.api("GET", `/agenda?debut=${j(0)}&fin=${j(3)}`, o.jeton)).corps.reservations).toHaveLength(3);
    const g = await compte(o, "secretariat", G(o));
    expect((await env.api("GET", `/agenda?debut=${j(0)}&fin=${j(3)}`, g.jeton)).corps.reservations).toEqual([]);
  });
});

describe("espace employé", () => {
  const prep = async () => {
    const o = await env.nouvelleOrganisation();
    const c = await compte(o, "secretariat", G(o));
    const e = await env.api("POST", "/employes", o.jeton, { entiteId: G(o), nom: "Awa", poste: "Vendeuse", typeContrat: "cdi", dateEmbauche: "2025-01-01" });
    expect((await env.api("PUT", `/employes/${e.corps.id}/compte`, o.jeton, { email: c.email })).corps.lie).toBe(true);
    return { o, c, e: e.corps };
  };
  it("donne à chacun son dossier, le pointage et les congés", async () => {
    const { o, c, e } = await prep();
    expect((await env.api("GET", "/moi/employe", o.jeton)).corps.lie).toBe(false);
    expect((await env.api("POST", "/moi/pointage", o.jeton)).corps.erreur).toBe("compte_sans_dossier");
    expect((await env.api("POST", "/moi/pointage", c.jeton)).corps.sens).toBe("arrivee");
    expect((await env.api("GET", "/moi/employe", c.jeton)).corps.pointage.arrivee).toBeTruthy();
    const d = await env.api("POST", "/moi/conges", c.jeton, { type: "annuel", debut: j(10), fin: j(12) });
    expect(d.corps.statut).toBe("demande");
    expect((await env.api("POST", "/moi/conges", c.jeton, { type: "annuel", debut: j(11), fin: j(13) })).corps.erreur).toBe("conge_chevauche");
    expect((await env.api("GET", `/employes/${e.id}/conges`, o.jeton)).corps).toHaveLength(1);
    expect((await env.api("GET", "/employes", c.jeton)).statut).toBe(403);
  });
  it("note de frais : déclarée, approuvée par une autre personne, payée une fois", async () => {
    const { o, c, e } = await prep();
    const n = await env.api("POST", "/moi/notes-frais", c.jeton, { jour: j(0), categorie: "transport", libelle: "Taxi", montant: 500 });
    expect((await envoi(`/moi/notes-frais/${n.corps.id}/justificatif`, c.jeton, PDF)).statusCode).toBe(200);
    expect((await env.api("GET", "/moi/employe", c.jeton)).corps.notes[0].document_id).toBeTruthy();
    const w = await env.api("POST", "/portefeuilles", o.jeton, { entiteId: G(o), nom: "Caisse", type: "especes", soldeInitial: 300 });
    expect((await env.api("POST", `/notes-frais/${n.corps.id}/paiement`, o.jeton, { portefeuilleId: w.corps.id })).corps.erreur).toBe("note_non_approuvee");
    await env.api("POST", `/notes-frais/${n.corps.id}/decision`, o.jeton, { decision: "approuvee" });
    expect((await env.api("POST", `/notes-frais/${n.corps.id}/paiement`, o.jeton, { portefeuilleId: w.corps.id })).corps.erreur).toBe("solde_portefeuille_insuffisant");
    await env.api("POST", `/portefeuilles/${w.corps.id}/mouvements`, o.jeton, { sens: "entree", montant: 500, libelle: "Appro" });
    expect((await env.api("POST", `/notes-frais/${n.corps.id}/paiement`, o.jeton, { portefeuilleId: w.corps.id })).corps.statut).toBe("payee");
    expect((await env.api("POST", `/notes-frais/${n.corps.id}/paiement`, o.jeton, { portefeuilleId: w.corps.id })).corps.erreur).toBe("note_non_approuvee");
    const moi = (await env.api("GET", "/moi", o.jeton)).corps;
    const e2 = await env.api("POST", "/employes", o.jeton, { entiteId: G(o), nom: "Chef", poste: "DG", typeContrat: "cdi", dateEmbauche: "2025-01-01" });
    await env.api("PUT", `/employes/${e2.corps.id}/compte`, o.jeton, { email: moi.email });
    const n2 = await env.api("POST", "/moi/notes-frais", o.jeton, { jour: j(0), categorie: "repas", libelle: "Déjeuner", montant: 100 });
    expect((await env.api("POST", `/notes-frais/${n2.corps.id}/decision`, o.jeton, { decision: "approuvee" })).corps.erreur).toBe("separation_des_taches");
    expect(e.id).toBeTruthy();
  });
});

describe("recrutement", () => {
  it("publie, reçoit sans doublon, et embauche", async () => {
    const o = await env.nouvelleOrganisation();
    const f = (await env.api("POST", "/offres-emploi", o.jeton, { entiteId: G(o), titre: "Caissière", description: "Poste à Douala", typeContrat: "cdd" })).corps;
    const code = encodeURIComponent(f.lien.split("c=")[1]);
    const P = (c: object) => env.app.inject({ method: "POST", url: `/offre-public/${code}`, payload: c, remoteAddress: `10.1.${Math.floor(Math.random() * 200)}.1` });
    expect((await env.app.inject({ method: "GET", url: `/offre-public/${code}` })).json().titre).toBe("Caissière");
    expect((await P({ nom: "A", consentement: false, telephone: "699" })).statusCode).toBe(400);
    expect((await P({ nom: "B", consentement: true, telephone: "699111222", lienCv: "http://x.cm" })).statusCode).toBe(400);
    await P({ nom: "Bella", consentement: true, telephone: "699111222" });
    await P({ nom: "Encore", consentement: true, telephone: "+237699111222" });
    const c = (await env.api("GET", `/offres-emploi/${f.id}/candidatures`, o.jeton)).corps;
    expect(c).toHaveLength(1);
    await env.api("POST", `/candidatures/${c[0].id}/entretiens`, o.jeton, { quand: `${j(2)}T10:00:00Z` });
    await env.api("PATCH", `/candidatures/${c[0].id}`, o.jeton, { etape: "retenue" });
    const em = await env.api("POST", `/candidatures/${c[0].id}/embauche`, o.jeton, { dateEmbauche: j(5) });
    expect(em.corps).toMatchObject({ nom: "Bella", poste: "Caissière", type_contrat: "cdd" });
    expect((await env.api("POST", `/candidatures/${c[0].id}/embauche`, o.jeton, { dateEmbauche: j(5) })).corps.erreur).toBe("deja_embauche");
    await env.api("POST", `/offres-emploi/${f.id}/cloture`, o.jeton);
    expect((await P({ nom: "Z", consentement: true, telephone: "699111333" })).statusCode).toBe(404);
  });
});

describe("promotions", () => {
  it("baisse le prix pendant la période seulement", async () => {
    expect([prixPromo(1000, "pourcentage", 25), prixPromo(1000, "montant", 1500)]).toEqual([750, 0]);
    const o = await env.nouvelleOrganisation();
    const p = (await env.api("POST", "/produits", o.jeton, { entiteId: G(o), code: "A", nom: "A", prixVente: 1000 })).corps.id;
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "C", entiteId: G(o) });
    const prix = async () => (await env.api("GET", `/documents-vente/${(await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: G(o), tiersId: t.corps.id, date: j(0), lignes: [{ produitId: p, quantite: 1 }] })).corps.id}`, o.jeton)).corps.total_ht;
    expect(await prix()).toBe(1000);
    await env.api("POST", "/promotions", o.jeton, { produitId: p, nom: "Future", type: "pourcentage", valeur: 50, debut: j(5), fin: j(9) });
    expect(await prix()).toBe(1000);
    expect((await env.api("POST", "/promotions", o.jeton, { produitId: p, nom: "X", type: "pourcentage", valeur: 150, debut: j(0), fin: j(9) })).corps.erreur).toBe("pourcentage_invalide");
    const x = await env.api("POST", "/promotions", o.jeton, { produitId: p, nom: "Rentrée", type: "pourcentage", valeur: 20, debut: j(-1), fin: j(1) });
    expect(await prix()).toBe(800);
    expect((await env.api("GET", "/produits", o.jeton)).corps[0].promo).toMatchObject({ type: "pourcentage", valeur: 20 });
    await env.api("POST", "/caisse/ouverture", o.jeton, { entiteId: G(o), fondOuverture: 0 });
    expect((await env.api("POST", "/caisse/ventes", o.jeton, { entiteId: G(o), lignes: [{ produitId: p, quantite: 1 }], paiements: [{ moyen: "especes", montant: 800 }] })).statut).toBe(201);
    await env.api("POST", `/promotions/${x.corps.id}/arret`, o.jeton);
    expect(await prix()).toBe(1000);
  });
});
