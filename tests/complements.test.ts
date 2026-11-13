import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { appliquerBareme, calculerBulletin, type Rubrique } from "../src/paie.js";
import { moisComplets } from "../src/rh.js";
import { creerServeur } from "../src/serveur.js";
import { generateurClaude, validerPlan, type GenerateurIa } from "../src/studio.js";
import { environnement, MOT_DE_PASSE, OPTIONS } from "./outils.js";

const env = await environnement();
const dossier = await mkdtemp(join(tmpdir(), "medias"));
const planValide = { description: "Un cours", lecons: [{ titre: "Bases", contenu: "Texte", questions: [{ enonce: "?", choix: ["a", "b"], bonne: 1 }] }] };
let reponseIa: unknown = planValide;
let consigneRecue = "";
const generateur: GenerateurIa = async (c) => {
  consigneRecue = c;
  return reponseIa;
};
const app2 = await creerServeur(env.poolApp, { ...OPTIONS, dossierMedias: dossier, videoMaxOctets: 2000, generateurIa: generateur });
afterAll(async () => {
  await app2.close();
  await env.fermer();
  await rm(dossier, { recursive: true, force: true });
});
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(88, 7)]);
async function acces(o: Org, lecons = 2) {
  const c = (await env.api("POST", "/cours", o.jeton, { entiteId: o.entites.GTA, titre: "Vidéo" })).corps.id as string;
  const ids: string[] = [];
  for (let i = 0; i < lecons; i += 1) ids.push((await env.api("POST", `/cours/${c}/lecons`, o.jeton, { titre: `L${i}` })).corps.id);
  await env.api("PATCH", `/cours/${c}`, o.jeton, { publie: true });
  const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Awa", entiteId: o.entites.GTA });
  const a = await env.api("POST", `/cours/${c}/acces`, o.jeton, { tiersId: t.corps.id });
  return { ids, accesId: a.corps.id as string, code: new URL(a.corps.lien).searchParams.get("c") as string };
}
const envoi = (id: string, jeton: string, corps: Buffer, type = "video/mp4") =>
  app2.inject({ method: "PUT", url: `/lecons/${id}/video`, headers: { authorization: `Bearer ${jeton}`, "content-type": type }, payload: corps });

describe("vidéos de cours", () => {
  it("refuse ce qui n'est pas une vidéo ou est trop lourd, sans rien laisser sur le disque", async () => {
    const o = await env.nouvelleOrganisation();
    const a = await acces(o);
    const avant = (await readdir(dossier)).length;
    expect((await envoi(a.ids[0]!, o.jeton, Buffer.from("<script>alert(1)</script>"))).json().erreur).toBe("format_video");
    expect((await envoi(a.ids[0]!, o.jeton, Buffer.concat([MP4, Buffer.alloc(3000)]))).statusCode).toBe(413);
    expect(await readdir(dossier)).toHaveLength(avant);
  });

  it("sert la vidéo par plages, seulement si la leçon est ouverte et l'accès actif", async () => {
    const o = await env.nouvelleOrganisation();
    const a = await acces(o);
    expect((await envoi(a.ids[1]!, o.jeton, MP4)).statusCode).toBe(200);
    const url = `/apprendre/${a.code}/lecons/${a.ids[1]}/video`;
    expect((await app2.inject({ url })).statusCode).toBe(404);
    await env.api("POST", `/apprendre/${a.code}/lecons/${a.ids[0]}`, undefined, {});
    const plein = await app2.inject({ url });
    expect(plein.statusCode).toBe(200);
    expect(plein.headers["content-type"]).toBe("video/mp4");
    expect(plein.rawPayload.equals(MP4)).toBe(true);
    const partie = await app2.inject({ url, headers: { range: "bytes=4-11" } });
    expect(partie.statusCode).toBe(206);
    expect(partie.headers["content-range"]).toBe(`bytes 4-11/${MP4.length}`);
    expect(partie.rawPayload.toString("latin1")).toBe("ftypisom");
    expect((await app2.inject({ url, headers: { range: "bytes=9999-" } })).statusCode).toBe(416);
    await env.api("POST", `/acces-cours/${a.accesId}/retrait`, o.jeton);
    expect((await app2.inject({ url })).statusCode).toBe(404);
  });

  it("remplace et retire le fichier, et bloque ceux qui ne gèrent pas le cours", async () => {
    const o = await env.nouvelleOrganisation();
    const a = await acces(o);
    const autre = await env.nouvelleOrganisation();
    expect((await envoi(a.ids[0]!, autre.jeton, MP4)).statusCode).toBe(404);
    const avant = (await readdir(dossier)).length;
    await envoi(a.ids[0]!, o.jeton, MP4);
    await envoi(a.ids[0]!, o.jeton, MP4);
    expect(await readdir(dossier)).toHaveLength(avant + 1);
    const vide = await app2.inject({ method: "DELETE", url: `/lecons/${a.ids[0]}/video`, headers: { authorization: `Bearer ${o.jeton}` } });
    expect(vide.statusCode).toBe(200);
    expect(await readdir(dossier)).toHaveLength(avant);
    expect((await stat(dossier)).isDirectory()).toBe(true);
  });
});

describe("studio IA", () => {
  const demande = (o: Org, entite: string, nombreLecons = 1) => app2.inject({
    method: "POST", url: "/studio/brouillons", headers: { authorization: `Bearer ${o.jeton}` },
    payload: { entiteId: entite, sujet: "Vendre en ligne", public: "Débutants", nombreLecons },
  });

  it("crée un brouillon jamais publié, avec les réponses du quiz", async () => {
    const o = await env.nouvelleOrganisation();
    reponseIa = planValide;
    const r = await demande(o, o.entites.GTA!);
    expect(r.statusCode).toBe(201);
    expect(r.json().publie).toBe(false);
    expect(consigneRecue).toContain("Débutants");
    const c = (await env.api("GET", `/cours/${r.json().id}`, o.jeton)).corps;
    expect(c.lecons[0]).toMatchObject({ titre: "Bases", questions: [{ bonne: 1 }] });
  });

  it("n'enregistre rien si la réponse de l'IA est invalide", async () => {
    const o = await env.nouvelleOrganisation();
    for (const mauvais of [null, "texte", { description: "x", lecons: [] }, { ...planValide, lecons: [{ titre: "t", contenu: "c", questions: [{ enonce: "?", choix: ["a", "b"], bonne: 5 }] }] }]) {
      reponseIa = mauvais;
      expect((await demande(o, o.entites.GTA!)).json().erreur).toBe("ia_reponse_invalide");
    }
    reponseIa = { ...planValide, lecons: [...planValide.lecons, ...planValide.lecons] };
    expect((await demande(o, o.entites.GTA!, 1)).statusCode).toBe(502);
    expect((await env.api("GET", "/cours", o.jeton)).corps).toEqual([]);
    reponseIa = planValide;
  });

  it("n'appelle pas l'IA pour une entité sans le module, et valide le format attendu", async () => {
    const o = await env.nouvelleOrganisation();
    consigneRecue = "";
    expect((await demande(o, o.entites.GLOMARI!)).statusCode).toBe(403);
    expect(consigneRecue).toBe("");
    expect(() => validerPlan(planValide, 1)).not.toThrow();
  });

  it("appelle l'API Claude avec la clé et le modèle configurés, et détecte une réponse coupée", async () => {
    let requete: RequestInit | undefined;
    const reponse = (corps: object, ok = true) => ({ ok, json: async () => corps }) as Response;
    const gen = generateurClaude("cle-test", "modele-test", (async (_u: string, i: RequestInit) => {
      requete = i;
      return reponse({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(planValide) }] });
    }) as typeof fetch);
    expect(await gen("Bonjour", { type: "object" })).toEqual(planValide);
    const h = requete!.headers as Record<string, string>;
    expect(h["x-api-key"]).toBe("cle-test");
    expect(h["anthropic-version"]).toBe("2026-10-21");
    const corps = JSON.parse(requete!.body as string);
    expect(corps.model).toBe("modele-test");
    expect(corps.temperature).toBeUndefined();
    expect(corps.output_config.format.type).toBe("json_schema");
    const coupe = generateurClaude("c", "m", (async () => reponse({ stop_reason: "max_tokens", content: [] })) as unknown as typeof fetch);
    await expect(coupe("x", {})).rejects.toMatchObject({ code: "ia_reponse_invalide" });
    const panne = generateurClaude("c", "m", (async () => reponse({}, false)) as unknown as typeof fetch);
    await expect(panne("x", {})).rejects.toMatchObject({ code: "ia_indisponible" });
  });
});

describe("calcul de la paie", () => {
  const r = (x: Partial<Rubrique>): Rubrique => ({ code: "R", libelle: "R", sens: "retenue", mode: "pourcentage", assiette: "brut", ...x });

  it("applique un barème progressif tranche par tranche", () => {
    const t = [{ jusqua: 100, taux: 10 }, { jusqua: 200, taux: 20 }, { jusqua: null, taux: 50 }];
    expect(appliquerBareme(50, t)).toBe(5);
    expect(appliquerBareme(150, t)).toBe(20);
    expect(appliquerBareme(300, t)).toBe(80);
  });

  it("calcule gains, plafond, retenues, charges et assiette sur une autre rubrique", () => {
    const b = calculerBulletin(100000, [
      r({ code: "P", sens: "gain", mode: "fixe", montant: 20000 }),
      r({ code: "A", taux: 10, plafond: 50000 }),
      r({ code: "B", taux: 10, assiette: "apres_retenues" }),
      r({ code: "C", taux: 10, assiette: "rubrique", assiette_rubrique: "B" }),
      r({ code: "E", sens: "charge", taux: 5, assiette: "base" }),
    ], [{ libelle: "Prime", sens: "gain", montant: 5000 }, { libelle: "Avance", sens: "retenue", montant: 1000 }]);
    expect(b.brut).toBe(125000);
    expect(b.lignes.find((l) => l.code === "A")!.montant).toBe(5000);
    expect(b.lignes.find((l) => l.code === "B")!.montant).toBe(12000);
    expect(b.lignes.find((l) => l.code === "C")!.montant).toBe(1200);
    expect(b.charges).toBe(5000);
    expect(b.retenues).toBe(5000 + 12000 + 1200 + 1000);
    expect(b.net).toBe(125000 - 19200);
  });

  it("gère l'abattement et le barème annualisé, sans contenir de taux par défaut", () => {
    const b = calculerBulletin(100000, [r({ code: "I", mode: "bareme", abattement_pct: 30, annualise: true, tranches: [{ jusqua: 600000, taux: 10 }, { jusqua: null, taux: 20 }] })]);
    expect(b.lignes[1]).toMatchObject({ assiette: 70000, montant: Math.round(((600000 * 0.1) + (240000 * 0.2)) / 12) });
    expect(calculerBulletin(100000, []).net).toBe(100000);
  });

  it("compte les mois entiers", () => {
    expect(moisComplets("2026-01-15", "2026-03-14")).toBe(1);
    expect(moisComplets("2026-01-15", "2026-03-15")).toBe(2);
    expect(moisComplets("2026-05-01", "2026-01-01")).toBe(0);
  });
});

describe("paie, pointage et soldes de congés", () => {
  async function utilisateur(o: Org, code: string, entiteId: string) {
    const roles = (await env.api("GET", "/roles", o.jeton)).corps;
    const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
    await env.api("POST", "/utilisateurs", o.jeton, { email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((x: { code: string }) => x.code === code).id });
    return env.connecter(o.slug, email);
  }
  const base = async () => {
    const o = await env.nouvelleOrganisation();
    const e = await env.api("POST", "/employes", o.jeton, { entiteId: o.entites.GTA, nom: "Paul", poste: "Vendeur", typeContrat: "cdi", dateEmbauche: "2026-01-01" });
    return { ...o, employeId: e.corps.id as string };
  };

  it("garde les salaires hors de portée des RH sans le droit de paie et hors du journal", async () => {
    const o = await base();
    const rh = await utilisateur(o, "ressources_humaines", o.entites.GTA!);
    const paie = await utilisateur(o, "paie", o.entites.GTA!);
    const paieGlo = await utilisateur(o, "paie", o.entites.GLOMARI!);
    expect((await env.api("PUT", `/employes/${o.employeId}/salaire`, rh, { salaireBase: 345678 })).statut).toBe(403);
    expect((await env.api("PUT", `/employes/${o.employeId}/salaire`, paieGlo, { salaireBase: 345678 })).statut).toBe(403);
    expect((await env.api("PUT", `/employes/${o.employeId}/salaire`, paie, { salaireBase: 345678 })).statut).toBe(200);
    expect((await env.api("GET", `/employes/${o.employeId}/salaire`, rh)).statut).toBe(403);
    expect((await env.api("GET", `/employes/${o.employeId}/bulletins`, rh)).statut).toBe(403);
    expect(JSON.stringify((await env.api("GET", "/employes", rh)).corps)).not.toContain("345678");
    await env.api("POST", "/bulletins", paie, { employeId: o.employeId, periode: "2026-11" });
    const { rows } = await dansOrganisation(env.poolAdmin, o.organisationId, (c) => c.query("select action, avant, apres from journal_audit where organisation_id = $1", [o.organisationId]));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((l) => l.action)).toContain("paie.salaire_modifie");
    expect(JSON.stringify(rows)).not.toMatch(/[:"]345678[,"}]/);
    const etranger = await env.nouvelleOrganisation();
    expect((await env.api("GET", `/employes/${o.employeId}/salaire`, etranger.jeton)).statut).toBe(404);
  });

  it("garde le bulletin en brouillon sans validation de l'expert, puis le fige", async () => {
    const o = await base();
    const paie = await utilisateur(o, "paie", o.entites.GTA!);
    const creer = (periode = "2026-11") => env.api("POST", "/bulletins", paie, { employeId: o.employeId, periode });
    expect((await creer()).corps.erreur).toBe("salaire_manquant");
    await env.api("PUT", `/employes/${o.employeId}/salaire`, paie, { salaireBase: 200000 });
    const r = await env.api("POST", "/rubriques-paie", paie, { entiteId: o.entites.GTA, code: "RET", libelle: "Retenue", sens: "retenue", mode: "pourcentage", taux: 10, assiette: "brut" });
    expect(r.statut).toBe(201);
    const b = await creer();
    expect(b.corps).toMatchObject({ statut: "brouillon", brut: 200000, retenues: 20000, net: 180000 });
    expect((await creer()).statut).toBe(409);
    expect((await env.api("POST", `/bulletins/${b.corps.id}/validation`, paie)).corps.erreur).toBe("paie_non_validee");
    expect((await env.api("PUT", "/paie/validation", paie, { entiteId: o.entites.GTA, expert: "Cabinet X", valideLe: "2026-11-01" })).statut).toBe(403);
    expect((await env.api("PUT", "/paie/validation", o.jeton, { entiteId: o.entites.GTA, expert: "Cabinet X", valideLe: "2026-11-01" })).statut).toBe(200);
    expect((await env.api("POST", `/bulletins/${b.corps.id}/validation`, paie)).corps.erreur).toBe("bulletin_a_recalculer");
    await env.api("DELETE", `/bulletins/${b.corps.id}`, paie);
    const b2 = await creer();
    const v = await env.api("POST", `/bulletins/${b2.corps.id}/validation`, paie);
    expect(v.corps).toMatchObject({ statut: "valide", expert: "Cabinet X" });
    expect(v.corps.numero).toMatch(/^PAIE-2026/);
    expect((await env.api("DELETE", `/bulletins/${b2.corps.id}`, paie)).statut).toBe(409);
    await expect(dansOrganisation(env.poolAdmin, o.organisationId, (c) => c.query("update bulletins_paie set net = 1 where id = $1", [b2.corps.id]))).rejects.toThrow(/fige/);
    await env.api("PUT", `/rubriques-paie/${r.corps.id}`, paie, { code: "RET", libelle: "Retenue", sens: "retenue", mode: "pourcentage", taux: 12 });
    expect((await env.api("GET", `/rubriques-paie?entiteId=${o.entites.GTA}`, paie)).corps.validation).toBeNull();
    expect((await env.api("POST", `/bulletins/${b2.corps.id}/annulation`, paie, { motif: "Erreur de saisie" })).statut).toBe(200);
    expect((await creer()).corps.retenues).toBe(24000);
  });

  it("refuse une rubrique incohérente ou une tranche finale manquante", async () => {
    const o = await base();
    const r = (x: object) => env.api("POST", "/rubriques-paie", o.jeton, { entiteId: o.entites.GTA, code: "X", libelle: "X", sens: "retenue", ...x });
    expect((await r({ mode: "pourcentage" })).corps.erreur).toBe("rubrique_invalide");
    expect((await r({ mode: "bareme", tranches: [{ jusqua: 100, taux: 10 }] })).corps.erreur).toBe("rubrique_invalide");
    expect((await r({ mode: "bareme", tranches: [{ jusqua: 100, taux: 10 }, { jusqua: 50, taux: 5 }, { jusqua: null, taux: 5 }] })).corps.erreur).toBe("rubrique_invalide");
    expect((await r({ mode: "pourcentage", taux: 1, assiette: "rubrique" })).corps.erreur).toBe("rubrique_invalide");
  });

  it("additionne le pointage et corrige un jour sans doublon", async () => {
    const o = await base();
    const p = (x: object) => env.api("PUT", `/employes/${o.employeId}/pointages`, o.jeton, x);
    expect((await p({ jour: "2026-11-02", arrivee: "17:00", depart: "08:00" })).corps.erreur).toBe("heures_invalides");
    await p({ jour: "2026-11-02", arrivee: "08:00", depart: "16:00" });
    await p({ jour: "2026-11-02", arrivee: "08:00", depart: "17:30" });
    await p({ jour: "2026-11-03", arrivee: "08:00" });
    const r = (await env.api("GET", `/employes/${o.employeId}/pointages?mois=2026-11`, o.jeton)).corps;
    expect(r).toMatchObject({ jours: 2, minutes: 570 });
    expect(r.lignes[1].arrivee).toBe("08:00");
    const glo = await utilisateur(o, "ressources_humaines", o.entites.GLOMARI!);
    expect((await env.api("PUT", `/employes/${o.employeId}/pointages`, glo, { jour: "2026-11-04", arrivee: "08:00" })).statut).toBe(403);
  });

  it("calcule le solde, bloque un congé annuel trop long et trace la dérogation", async () => {
    const o = await base();
    const url = `/employes/${o.employeId}/solde-conges`;
    expect((await env.api("GET", url, o.jeton)).corps.parametre).toBe(false);
    const demande = async (debut: string, fin: string, type = "annuel") => (await env.api("POST", `/employes/${o.employeId}/conges`, o.jeton, { type, debut, fin })).corps.id as string;
    const decider = (id: string, extra = {}) => env.api("POST", `/conges/${id}/decision`, o.jeton, { decision: "approuve", ...extra });
    const libre = await demande("2030-01-01", "2030-01-10");
    expect((await decider(libre)).statut).toBe(200);
    await env.api("POST", `/conges/${libre}/decision`, o.jeton, { decision: "annule" });
    const r = await env.api("PUT", url, o.jeton, { joursParMois: 2, soldeInitial: 5, soldeAu: "2100-01-01" });
    expect(r.corps).toMatchObject({ parametre: true, acquis: 5, pris: 0, solde: 5 });
    const hors = await demande("2100-02-01", "2100-02-10");
    expect((await decider(hors)).corps).toMatchObject({ erreur: "solde_conges_insuffisant", details: { solde: 5, jours: 10 } });
    const maladie = await demande("2100-03-01", "2100-03-20", "maladie");
    expect((await decider(maladie)).statut).toBe(200);
    expect((await decider(hors, { derogation: "Accord de la direction" })).corps.derogation).toBe("Accord de la direction");
    expect((await env.api("GET", url, o.jeton)).corps).toMatchObject({ pris: 10, solde: -5 });
  });
});
