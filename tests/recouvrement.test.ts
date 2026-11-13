import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { SOURCES } from "../src/controle.js";
import { scoreProspect } from "../src/prospection.js";
import { etatPlan, MODELES, niveauAtteint, rendreModele } from "../src/recouvrement.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(() => env.fermer());
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
const G = (o: Org) => o.entites.GLOMARI!;
const decale = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
async function compte(o: Org, code: string, entiteId: string) {
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
  const u = await env.api("POST", "/utilisateurs", o.jeton, { email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((x: { code: string }) => x.code === code).id });
  return { jeton: await env.connecter(o.slug, email), id: u.corps.id as string };
}
async function facture(o: Org, retard: number, montant = 1000) {
  const tel = `6${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  await env.api("PATCH", `/entites/${G(o)}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
  const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: `C${Math.random()}`, entiteId: G(o), telephone: tel });
  const d = await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: G(o), tiersId: t.corps.id, date: decale(-Math.max(retard, 0) - 1), echeance: decale(-retard), lignes: [{ designation: "X", quantite: 1, prixUnitaire: montant }] });
  const e = await env.api("POST", `/documents-vente/${d.corps.id}/emission`, o.jeton);
  expect(e.statut).toBeLessThan(300);
  return { id: d.corps.id as string, tiers: t.corps.id as string };
}

describe("règles", () => {
  it("niveaux, modèle, plan et score", () => {
    expect([niveauAtteint(-5, MODELES), niveauAtteint(-3, MODELES), niveauAtteint(10, MODELES), niveauAtteint(40, MODELES)]).toEqual([null, "avant", "rappel", "mise_en_demeure"]);
    expect(rendreModele("{client} {reste} {autre}", { client: "A", reste: "5" })).toBe("A 5 {autre}");
    const e = [{ jour: "2026-01-01", montant: 100 }, { jour: "2026-02-01", montant: 100 }];
    expect(etatPlan(e, 100, "2026-01-15").statut).toBe("a_jour");
    expect(etatPlan(e, 50, "2026-02-15")).toMatchObject({ statut: "en_retard", retard: 150 });
    expect(etatPlan(e, 200, "2026-01-01").statut).toBe("solde");
    expect(scoreProspect({ telephone: "1", email: "a", montant: 600000, etape: "proposition", activites30: 9, joursSansContact: 1 }).score).toBe(100);
    expect(scoreProspect({ montant: 0, etape: "nouveau", activites30: 0, joursSansContact: null }).score).toBe(0);
  });
  it("chaque source d'indicateur s'exécute", async () => {
    const o = await env.nouvelleOrganisation();
    await dansOrganisation(env.poolApp, o.organisationId, async (c) => {
      for (const s of Object.values(SOURCES)) {
        const { rows } = await c.query(s.requete, [[G(o)], "2026-01-01", "2026-12-31"]);
        expect(typeof rows[0].v).toBe("number");
      }
    });
  });
});

describe("recouvrement", () => {
  it("classe l'âge, prépare la bonne relance une seule fois, en anglais si besoin", async () => {
    const o = await env.nouvelleOrganisation();
    const f = await facture(o, 10, 1000);
    await facture(o, 100, 500);
    const t = (await env.api("GET", `/recouvrement/tableau?brancheId=${G(o)}`, o.jeton)).corps;
    expect(t.total).toBe(1500);
    expect(t.lignes.find((x: { plus: number }) => x.plus === 500).proposer_blocage).toBe(true);
    expect(t.factures.find((x: { reste: number }) => x.reste === 500).a_declasser).toBe(true);
    const r = (await env.api("GET", `/recouvrement/relances?brancheId=${G(o)}`, o.jeton)).corps.a_relancer;
    expect(r.map((x: { niveau: string }) => x.niveau).sort()).toEqual(["mise_en_demeure", "rappel"]);
    const corps = { brancheId: G(o), sourceType: "facture", sourceId: f.id, canal: "whatsapp" };
    expect((await env.api("POST", "/recouvrement/relances", o.jeton, corps)).corps.niveau).toBe("rappel");
    expect((await env.api("POST", "/recouvrement/relances", o.jeton, corps)).corps.erreur).toBe("relance_non_due");
    const gta = await compte(o, "chef_comptable", o.entites.GTA!);
    expect((await env.api("GET", `/recouvrement/tableau?brancheId=${G(o)}`, gta.jeton)).statut).toBe(403);
  });
  it("suit un plan : pas de relance à jour, reste exact exigé", async () => {
    const o = await env.nouvelleOrganisation();
    const f = await facture(o, 10, 1000);
    const c = { factureId: f.id, motif: "Accord client", echeances: [{ jour: decale(5), montant: 400 }, { jour: decale(35), montant: 500 }] };
    expect((await env.api("POST", "/recouvrement/plans", o.jeton, c)).corps.erreur).toBe("plan_different_du_reste");
    c.echeances[1]!.montant = 600;
    expect((await env.api("POST", "/recouvrement/plans", o.jeton, c)).statut).toBe(201);
    expect((await env.api("POST", "/recouvrement/plans", o.jeton, c)).corps.erreur).toBe("plan_deja_actif");
    expect((await env.api("GET", `/recouvrement/relances?brancheId=${G(o)}`, o.jeton)).corps.a_relancer).toEqual([]);
    expect((await env.api("GET", `/recouvrement/plans?brancheId=${G(o)}`, o.jeton)).corps[0].statut).toBe("a_jour");
  });
  it("le blocage arrête la livraison et se lève", async () => {
    const o = await env.nouvelleOrganisation();
    const f = await facture(o, 10);
    const b = await env.api("POST", "/recouvrement/blocages", o.jeton, { tiersId: f.tiers, portee: "livraison", motif: "Impayé ancien" });
    expect((await env.api("POST", `/factures/${f.id}/expedition`, o.jeton, { mode: "retrait" })).corps.erreur).toBe("client_bloque");
    expect((await env.api("POST", "/recouvrement/blocages", o.jeton, { tiersId: f.tiers, portee: "livraison", motif: "Impayé ancien" })).corps.erreur).toBe("deja_bloque");
    await env.api("POST", `/recouvrement/blocages/${b.corps.id}/levee`, o.jeton);
    expect((await env.api("POST", `/factures/${f.id}/expedition`, o.jeton, { mode: "retrait" })).statut).toBe(201);
  });
  it("une perte demande deux personnes, sort des créances et prépare les écritures", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("POST", "/compta/initialisation", o.jeton, { brancheId: G(o) });
    const f = await facture(o, 100, 1000);
    expect((await env.api("POST", `/recouvrement/factures/${f.id}/douteuse`, o.jeton, { provision: 2000, motif: "Client injoignable" })).corps.erreur).toBe("provision_superieure_au_reste");
    await env.api("POST", `/recouvrement/factures/${f.id}/douteuse`, o.jeton, { provision: 600, motif: "Client injoignable" });
    await env.api("POST", `/recouvrement/factures/${f.id}/perte`, o.jeton, { motif: "Société liquidée" });
    expect((await env.api("POST", `/recouvrement/factures/${f.id}/perte/validation`, o.jeton)).corps.erreur).toBe("separation_des_taches");
    const cpt = await compte(o, "chef_comptable", G(o));
    expect((await env.api("POST", `/recouvrement/factures/${f.id}/perte/validation`, cpt.jeton)).corps).toEqual({ statut: "perte", montant: 1000 });
    expect((await env.api("GET", "/creances", o.jeton)).corps).toEqual([]);
    expect((await env.api("POST", `/factures/${f.id}/reglements`, o.jeton, { montant: 100, moyen: "especes" })).corps.erreur).toBe("facture_passee_en_perte");
    await env.api("POST", "/compta/generation", o.jeton, { brancheId: G(o), fin: decale(1) });
    const e = (await env.api("GET", `/compta/ecritures?brancheId=${G(o)}&statut=brouillon`, o.jeton)).corps;
    expect(e.some((x: { libelle: string }) => x.libelle.startsWith("Dépréciation"))).toBe(true);
    expect(e.some((x: { libelle: string }) => x.libelle.startsWith("Perte"))).toBe(true);
    const n = e.length;
    await env.api("POST", "/compta/generation", o.jeton, { brancheId: G(o), fin: decale(1) });
    expect((await env.api("GET", `/compta/ecritures?brancheId=${G(o)}&statut=brouillon`, o.jeton)).corps.length).toBe(n);
  });
  it("génère les factures récurrentes sans doublon", async () => {
    const o = await env.nouvelleOrganisation();
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "R", entiteId: G(o) });
    const r = await env.api("POST", "/factures-recurrentes", o.jeton, { entiteId: G(o), tiersId: t.corps.id, libelle: "Abonnement", jour: 1, debut: decale(-70), delaiJours: 15, lignes: [{ designation: "A", quantite: 1, prixUnitaire: 100 }] });
    expect(r.statut).toBe(201);
    const g = (await env.api("POST", "/factures-recurrentes/generation", o.jeton)).corps.crees;
    expect(g).toBeGreaterThanOrEqual(2);
    expect((await env.api("POST", "/factures-recurrentes/generation", o.jeton)).corps.crees).toBe(0);
    expect((await env.api("GET", "/documents-vente?type=facture", o.jeton)).corps.filter((d: { statut: string }) => d.statut === "brouillon")).toHaveLength(g);
  });
});

describe("prospection", () => {
  it("le formulaire crée un prospect, rattache un contact connu, et filtre les robots", async () => {
    const o = await env.nouvelleOrganisation();
    const f = (await env.api("POST", "/formulaires-capture", o.jeton, { entiteId: G(o), titre: "Offre", source: "Facebook" })).corps;
    const code = encodeURIComponent(f.lien.split("c=")[1]);
    const P = (c: object) => env.app.inject({ method: "POST", url: `/capture/${code}`, payload: c, remoteAddress: `10.0.${Math.floor(Math.random() * 200)}.1` });
    expect((await env.app.inject({ method: "GET", url: `/capture/${code}` })).json().titre).toBe("Offre");
    expect((await P({ nom: "A", consentement: false, telephone: "699000222" })).statusCode).toBe(400);
    expect((await P({ nom: "A", consentement: true })).statusCode).toBe(400);
    expect((await P({ nom: "Robot", consentement: true, telephone: "699000999", site: "x" })).statusCode).toBe(201);
    expect((await P({ nom: "Awa", consentement: true, telephone: "699 000 222", message: "Intéressée" })).statusCode).toBe(201);
    expect((await P({ nom: "Autre nom", consentement: true, telephone: "+237699000222" })).statusCode).toBe(201);
    const c = (await env.api("GET", "/prospects/classement", o.jeton)).corps;
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ nom: "Awa", source: "Facebook" });
    expect((await env.api("GET", "/tiers", o.jeton)).corps.filter((t: { nom: string }) => t.nom === "Robot" || t.nom === "Autre nom")).toEqual([]);
    await env.api("POST", `/formulaires-capture/${f.id}/arret`, o.jeton);
    expect((await P({ nom: "B", consentement: true, telephone: "699000333" })).statusCode).toBe(404);
    expect((await env.app.inject({ method: "GET", url: `/capture/${o.organisationId}.mauvais-code-mauvais-code` })).statusCode).toBe(404);
  });
  it("segmente sans sortir de la branche", async () => {
    const o = await env.nouvelleOrganisation();
    await facture(o, 1, 800);
    await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Sans achat", entiteId: G(o) });
    await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Client GTA", entiteId: o.entites.GTA! });
    const s = await env.api("POST", "/segments", o.jeton, { brancheId: G(o), nom: "Gros", criteres: { achatMin: 500 } });
    expect((await env.api("GET", `/segments/${s.corps.id}/membres`, o.jeton)).corps.membres).toHaveLength(1);
    const t = await env.api("POST", "/segments", o.jeton, { brancheId: G(o), nom: "Tous", criteres: {} });
    expect((await env.api("GET", `/segments/${t.corps.id}/membres`, o.jeton)).corps.membres.map((m: { nom: string }) => m.nom)).not.toContain("Client GTA");
    expect((await env.api("POST", "/segments", o.jeton, { brancheId: G(o), nom: "X", criteres: { injection: "1" } })).statut).toBeLessThan(500);
  });
});

describe("socle", () => {
  it("la recherche respecte la branche et les caractères spéciaux", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Mbarga Glomari", entiteId: G(o) });
    expect((await env.api("GET", "/recherche?q=mbarga", o.jeton)).corps[0]).toMatchObject({ genre: "client", titre: "Mbarga Glomari" });
    expect((await env.api("GET", "/recherche?q=%25%25", o.jeton)).corps).toEqual([]);
    const gta = await compte(o, "commercial", o.entites.GTA!);
    expect((await env.api("GET", "/recherche?q=mbarga", gta.jeton)).corps).toEqual([]);
  });
  it("les notifications suivent les droits", async () => {
    const o = await env.nouvelleOrganisation();
    await facture(o, 10);
    expect((await env.api("GET", "/notifications", o.jeton)).corps.find((n: { genre: string }) => n.genre === "relances").nombre).toBe(1);
    const gta = await compte(o, "commercial", o.entites.GTA!);
    expect((await env.api("GET", "/notifications", gta.jeton)).corps.map((n: { genre: string }) => n.genre)).toEqual(["compte"]);
  });
  it("sépare les tâches quand la règle est active, et la délégation expire", async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("POST", "/compta/initialisation", o.jeton, { brancheId: G(o) });
    const e = await env.api("POST", "/compta/ecritures", o.jeton, { brancheId: G(o), journal: "OD", date: "2026-03-01", libelle: "Loyer", lignes: [{ numero: "622", debit: 10 }, { numero: "5711", credit: 10 }] });
    const cc = await compte(o, "caissier", G(o));
    expect((await env.api("PUT", "/separation", cc.jeton, { ecritures: true, commandes: false, facturesFournisseur: false, pertes: true })).statut).toBe(403);
    await env.api("PUT", "/separation", o.jeton, { ecritures: true, commandes: false, facturesFournisseur: false, pertes: true });
    expect((await env.api("POST", "/compta/ecritures/validation", o.jeton, { ids: [e.corps.id] })).corps.erreur).toBe("separation_des_taches");
    await env.api("PUT", "/separation", o.jeton, { ecritures: false, commandes: false, facturesFournisseur: false, pertes: true });
    expect((await env.api("POST", "/compta/ecritures/validation", o.jeton, { ids: [e.corps.id] })).statut).toBeLessThan(300);
    const role = (await env.api("GET", "/roles", o.jeton)).corps.find((r: { code: string }) => r.code === "commercial").id;
    const v = await compte(o, "caissier", G(o));
    const avant = (await env.api("GET", "/moi", v.jeton)).corps.permissions.includes("crm.voir");
    expect(avant).toBe(false);
    await env.api("POST", `/utilisateurs/${v.id}/acces`, o.jeton, { roleId: role, entiteId: G(o), expireLe: "2020-01-01" });
    expect((await env.api("GET", "/moi", v.jeton)).corps.permissions.includes("crm.voir")).toBe(false);
    await env.api("POST", `/utilisateurs/${cc.id}/acces`, o.jeton, { roleId: role, entiteId: G(o), expireLe: decale(3) });
    expect((await env.api("GET", "/moi", cc.jeton)).corps.permissions.includes("crm.voir")).toBe(true);
    expect((await env.api("POST", "/2fa/activation", o.jeton)).corps.qr_svg).toContain("<svg");
  });
});
