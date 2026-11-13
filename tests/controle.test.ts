import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { adressePrivee, niveauKpi, projectionMois, signature, urlAutorisee } from "../src/controle.js";
import { creerServeur } from "../src/serveur.js";
import { environnement, MOT_DE_PASSE, OPTIONS } from "./outils.js";

const env = await environnement();
const recus: { url: string; init: RequestInit }[] = [];
let codeReponse = 200;
const appW = await creerServeur(env.poolApp, { ...OPTIONS, quotaApiParMinute: 3, envoiWebhooks: {
  resoudre: async (h) => [{ address: h === "interne.test" ? "10.0.0.5" : "93.184.216.34" }],
  envoyer: (async (url: string, init: RequestInit) => { recus.push({ url, init }); return { status: codeReponse } as Response; }) as typeof fetch,
} });
afterAll(async () => { await appW.close(); await env.fermer(); });
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
const G = (o: Org) => o.entites.GLOMARI!;
const appel = async (methode: string, url: string, jeton: string, corps?: object) => {
  const r = await appW.inject({ method: methode as "GET", url, headers: { authorization: `Bearer ${jeton}` }, ...(corps ? { payload: corps } : {}) });
  return { statut: r.statusCode, corps: r.json() };
};
async function compte(o: Org, code: string, entiteId: string) {
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
  const u = await env.api("POST", "/utilisateurs", o.jeton, { email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((x: { code: string }) => x.code === code).id });
  return { jeton: await env.connecter(o.slug, email), id: u.corps.id as string };
}

describe("calculs", () => {
  it("classe un indicateur selon son sens", () => {
    expect([niveauKpi(1, 100, 80, 50), niveauKpi(1, 70, 80, 50), niveauKpi(1, 50, 80, 50)]).toEqual(["ok", "alerte", "critique"]);
    expect([niveauKpi(-1, 1, 5, 10), niveauKpi(-1, 5, 5, 10), niveauKpi(-1, 11, 5, 10)]).toEqual(["ok", "alerte", "critique"]);
    expect(projectionMois(100, 10, 30)).toBe(300);
  });
  it("refuse les adresses internes, y compris masquées", async () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1", "100.64.0.1"]) expect(adressePrivee(ip)).toBe(true);
    expect(adressePrivee("93.184.216.34")).toBe(false);
    expect(await urlAutorisee("http://exemple.cm/x")).toBe(false);
    expect(await urlAutorisee("https://127.0.0.1/x")).toBe(false);
    expect(await urlAutorisee("https://u:p@93.184.216.34/x")).toBe(false);
    expect(await urlAutorisee("https://a.test/x", async () => [{ address: "93.184.216.34" }, { address: "10.0.0.1" }])).toBe(false);
    expect(await urlAutorisee("https://a.test/x", async () => [{ address: "93.184.216.34" }])).toBe(true);
  });
});

describe("indicateurs", () => {
  it("alerte une seule fois, et la décision crée une tâche", async () => {
    const o = await env.nouvelleOrganisation();
    const k = (x: object) => env.api("POST", "/kpi", o.jeton, { entiteId: G(o), source: "tresorerie", cible: 1000, seuilAlerte: 500, seuilCritique: 100, ...x });
    expect((await k({ seuilAlerte: 50 })).corps.erreur).toBe("seuils_incoherents");
    expect((await k({})).statut).toBe(201);
    await env.api("POST", "/portefeuilles", o.jeton, { entiteId: G(o), nom: "B", type: "banque", soldeInitial: 300 });
    const t = (await env.api("GET", "/kpi/tableau", o.jeton)).corps;
    expect(t.lignes[0]).toMatchObject({ valeur: 300, niveau: "alerte" });
    await env.api("GET", "/kpi/tableau", o.jeton);
    const a = (await env.api("GET", "/kpi/tableau", o.jeton)).corps.alertes;
    expect(a).toHaveLength(1);
    expect((await env.api("POST", `/alertes-kpi/${a[0].id}/decision`, o.jeton, { decision: "acceptee" })).corps.tache).toBe(true);
    expect((await env.api("POST", `/alertes-kpi/${a[0].id}/decision`, o.jeton, { decision: "refusee" })).corps.erreur).toBe("deja_decide");
    expect((await env.api("GET", "/taches", o.jeton)).corps.some((x: { titre: string }) => x.titre.includes("Trésorerie"))).toBe(true);
    const gta = await compte(o, "responsable_pilotage", o.entites.GTA!);
    expect((await env.api("GET", "/kpi/tableau", gta.jeton)).corps.lignes).toEqual([]);
    expect((await env.api("POST", `/alertes-kpi/${a[0].id}/decision`, gta.jeton, { decision: "refusee" })).statut).toBe(403);
  });
});

describe("clés d'API", () => {
  it("agit avec les seuls droits du compte, se révoque, respecte le quota et refuse un super administrateur", async () => {
    const o = await env.nouvelleOrganisation();
    const moi = (await env.api("GET", "/moi", o.jeton)).corps.id;
    expect((await env.api("POST", "/cles-api", o.jeton, { nom: "X", utilisateurId: moi })).corps.erreur).toBe("cle_super_interdite");
    const caissier = await compte(o, "caissier", G(o));
    expect((await env.api("POST", "/cles-api", caissier.jeton, { nom: "X", utilisateurId: caissier.id })).statut).toBe(403);
    const c = await env.api("POST", "/cles-api", o.jeton, { nom: "Site", utilisateurId: caissier.id });
    const cle = c.corps.cle as string;
    expect((await env.api("GET", "/cles-api", o.jeton)).corps[0].cle_hash).toBeUndefined();
    expect((await env.api("GET", "/moi", cle)).corps.id).toBe(caissier.id);
    expect((await env.api("GET", "/utilisateurs", cle)).statut).toBe(403);
    await appel("GET", "/moi", cle); await appel("GET", "/moi", cle); await appel("GET", "/moi", cle);
    expect((await appel("GET", "/moi", cle)).statut).toBe(429);
    await env.api("POST", `/cles-api/${c.corps.id}/revocation`, o.jeton);
    expect((await env.api("GET", "/moi", cle)).statut).toBe(401);
    const exp = await env.api("POST", "/cles-api", o.jeton, { nom: "Vieille", utilisateurId: caissier.id, expireLe: "2020-01-01" });
    expect((await env.api("GET", "/moi", exp.corps.cle)).statut).toBe(401);
  });
});

describe("webhooks", () => {
  it("refuse une adresse interne, signe l'envoi, et réessaie sans doublon", async () => {
    const o = await env.nouvelleOrganisation();
    expect((await appel("POST", "/webhooks", o.jeton, { nom: "I", url: "https://interne.test/x", evenements: ["colis.livre"] })).corps.erreur).toBe("url_webhook_refusee");
    const w = await appel("POST", "/webhooks", o.jeton, { nom: "S", url: "https://site.test/x", evenements: ["vente.comptoir"] });
    const p = (await env.api("POST", "/produits", o.jeton, { entiteId: G(o), code: "A", nom: "A", prixVente: 10 })).corps.id;
    await env.api("POST", "/caisse/ouverture", o.jeton, { entiteId: G(o), fondOuverture: 0 });
    await env.api("POST", "/caisse/ventes", o.jeton, { entiteId: G(o), lignes: [{ produitId: p, quantite: 1 }], paiements: [{ moyen: "especes", montant: 10 }] });
    recus.length = 0;
    codeReponse = 500;
    expect((await appel("POST", "/webhooks/envoi", o.jeton)).corps.envoyes).toBe(0);
    expect(recus).toHaveLength(1);
    expect((await appel("POST", "/webhooks/envoi", o.jeton)).corps.envoyes).toBe(0);
    expect(recus).toHaveLength(1);
    await dansOrganisation(env.poolApp, o.jeton.split(".")[0]!, (c) => c.query("update livraisons_webhook set prochain_essai = now() where webhook_id = $1", [w.corps.id]));
    codeReponse = 200;
    expect((await appel("POST", "/webhooks/envoi", o.jeton)).corps.envoyes).toBe(1);
    const init = recus[1]!.init;
    expect((init.headers as Record<string, string>)["x-smarte-signature"]).toBe(`sha256=${signature(w.corps.secret, init.body as string)}`);
    expect(init.redirect).toBe("error");
    expect((await appel("POST", "/webhooks/envoi", o.jeton)).corps.envoyes).toBe(0);
    expect((await appel("GET", "/webhooks", o.jeton)).corps[0]).toMatchObject({ envoyes: 1, en_attente: 0 });
    const caissier = await compte(o, "caissier", G(o));
    expect((await appel("POST", "/webhooks/envoi", caissier.jeton)).statut).toBe(403);
    const e = await env.nouvelleOrganisation();
    expect((await appel("GET", "/webhooks", e.jeton)).corps).toEqual([]);
  });
});

describe("contrôle financier", () => {
  const prep = async () => {
    const o = await env.nouvelleOrganisation();
    await env.api("POST", "/compta/initialisation", o.jeton, { brancheId: G(o) });
    const e = await env.api("POST", "/compta/ecritures", o.jeton, { brancheId: G(o), journal: "OD", date: "2026-03-01", libelle: "Loyer", lignes: [{ numero: "622", debit: 1500 }, { numero: "5711", credit: 1500 }] });
    await env.api("POST", "/compta/ecritures/validation", o.jeton, { ids: [e.corps.id] });
    return o;
  };
  it("compare budget et réalisé validé", async () => {
    const o = await prep();
    await env.api("PUT", "/budgets", o.jeton, { brancheId: G(o), annee: 2026, comptePrefixe: "62", libelle: "Services", montant: 1000 });
    expect((await env.api("GET", `/budgets?brancheId=${G(o)}&annee=2026`, o.jeton)).corps[0]).toMatchObject({ realise: 1500, ecart: 500, consomme: 150, nature: "charge" });
    const gta = await compte(o, "chef_comptable", o.entites.GTA!);
    expect((await env.api("GET", `/budgets?brancheId=${G(o)}&annee=2026`, gta.jeton)).statut).toBe(403);
  });
  it("additionne les seules branches accessibles", async () => {
    const o = await prep();
    expect((await env.api("GET", "/compta/cumul-groupe?annee=2026", o.jeton)).corps.groupe).toMatchObject({ resultat: -1500, equilibre: true });
    const gta = await compte(o, "chef_comptable", o.entites.GTA!);
    expect((await env.api("GET", "/compta/cumul-groupe?annee=2026", gta.jeton)).corps.groupe.resultat).toBe(0);
  });
  it("rapproche un relevé et prévoit la trésorerie", async () => {
    const o = await env.nouvelleOrganisation();
    const w = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: G(o), nom: "B", type: "banque", soldeInitial: 1000 })).corps.id;
    await env.api("POST", `/portefeuilles/${w}/mouvements`, o.jeton, { sens: "sortie", montant: 200, libelle: "Dépense" });
    const j = new Date().toISOString().slice(0, 10);
    const r = await env.api("POST", `/portefeuilles/${w}/rapprochement`, o.jeton, { jour: j, soldeReleve: 790, lignes: [{ jour: j, montant: -200 }, { jour: j, montant: -10 }] });
    expect(r.corps).toMatchObject({ solde_systeme: 800, ecart: -10, correspondances: 1 });
    expect(r.corps.absents_du_systeme).toHaveLength(1);
    expect(r.corps.absents_du_releve).toHaveLength(1);
    await env.api("PATCH", `/entites/${G(o)}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "C", entiteId: G(o) });
    const d = await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: G(o), tiersId: t.corps.id, date: j, lignes: [{ designation: "X", quantite: 1, prixUnitaire: 500 }] });
    await env.api("POST", `/documents-vente/${d.corps.id}/emission`, o.jeton);
    expect((await env.api("GET", `/tresorerie/prevision?brancheId=${G(o)}`, o.jeton)).corps.horizons[0]).toMatchObject({ jours: 30, encaissements: 500, decaissements: 0, solde: 1300 });
  });
});
