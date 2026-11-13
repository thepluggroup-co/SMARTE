import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { escalader, estOuvre, journeePerformance, joursOuvresAvant, ponctualite, preparerJournee } from "../src/performance.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);

const LUNDI = "2026-11-02";
const mois = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 7);

/** Une organisation avec, dans GLOMARI : un responsable, deux vendeurs, les RH et la direction ; dans GTA : un responsable. */
async function equipe() {
  const o = await env.nouvelleOrganisation();
  const G = o.entites.GLOMARI!, T = o.entites.GTA!;
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const compte = async (role: string, entiteId: string) => {
    const email = `${role}${Math.random().toString(36).slice(2)}@test.cm`;
    const u = await env.api("POST", "/utilisateurs", o.jeton, { email, nom: `${role} ${email.slice(-6, -3)}`, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((r: { code: string }) => r.code === role).id });
    expect(u.statut).toBe(201);
    return { id: u.corps.id as string, jeton: await env.connecter(o.slug, email) };
  };
  const fiche = async (nom: string, poste: string, entiteId: string, utilisateurId: string, responsableId?: string) => {
    const e = await env.api("POST", "/employes", o.jeton, { entiteId, nom, poste, typeContrat: "cdi", dateEmbauche: "2025-01-01" });
    expect((await env.api("PATCH", `/employes/${e.corps.id}/compte`, o.jeton, { utilisateurId })).statut).toBe(200);
    if (responsableId) expect((await env.api("PUT", `/employes/${e.corps.id}/responsable`, o.jeton, { responsableId })).statut).toBe(200);
    return e.corps.id as string;
  };
  const chef = await compte("evaluation", G);
  const chefFiche = await fiche("Chef", "Responsable", G, chef.id);
  const vendeur = await compte("commercial", G);
  const vendeurFiche = await fiche("Awa", "Vendeur", G, vendeur.id, chefFiche);
  const collegue = await compte("commercial", G);
  const collegueFiche = await fiche("Bello", "Vendeur", G, collegue.id, chefFiche);
  const rh = await compte("ressources_humaines", G);
  const direction = await compte("direction", G);
  const chefGta = await compte("evaluation", T);
  await fiche("Chef GTA", "Responsable", T, chefGta.id);
  const dans = <R>(f: (c: Parameters<Parameters<typeof dansOrganisation>[2]>[0]) => Promise<R>) => dansOrganisation(env.poolApp, o.organisationId, f);
  const messages = async (jeton: string) => (await env.api("GET", "/moi/messages", jeton)).corps as { texte: string; niveau: string }[];
  return { ...o, G, T, chef, chefFiche, vendeur, vendeurFiche, collegue, collegueFiche, rh, direction, chefGta, dans, messages };
}
type Equipe = Awaited<ReturnType<typeof equipe>>;

async function modeles(o: Equipe) {
  const m = (corps: object) => env.api("POST", "/performance/modeles", o.chef.jeton, { entiteId: o.G, poste: "Vendeur", ...corps });
  expect((await m({ libelle: "Tâches terminées", type: "mesure_systeme", kpi: "taches_terminees", cible: 2, poids: 40 })).statut).toBe(201);
  expect((await m({ libelle: "Appels clients", type: "chiffre_declare", cible: 10, poids: 40 })).statut).toBe(201);
  expect((await m({ libelle: "Ranger la réserve", type: "tache", cible: 1, poids: 20 })).statut).toBe(201);
}

describe("calendrier", () => {
  it("connaît les jours ouvrés et la ponctualité à l'heure de Douala", () => {
    expect([estOuvre("2026-11-02"), estOuvre("2026-11-07"), estOuvre("2026-11-08")]).toEqual([true, false, false]);
    expect(joursOuvresAvant("2026-11-09", 2)).toEqual(["2026-11-06", "2026-11-05"]);
    expect(ponctualite(LUNDI, new Date("2026-11-02T18:59:00Z"))).toBe(100);
    expect(ponctualite(LUNDI, new Date("2026-11-03T08:30:00Z"))).toBe(50);
    expect(ponctualite(LUNDI, new Date("2026-11-03T10:00:00Z"))).toBe(0);
    expect(ponctualite(LUNDI, null)).toBe(0);
  });
});

describe("objectifs du jour", () => {
  it("se créent le matin depuis les modèles du poste, une seule fois, sauf week-end et congé", async () => {
    const o = await equipe();
    await modeles(o);
    expect((await env.api("POST", "/performance/modeles", o.chef.jeton, { entiteId: o.G, poste: "Vendeur", libelle: "X", type: "mesure_systeme", cible: 1, poids: 1 })).corps.erreur).toBe("modele_invalide");
    expect((await env.api("POST", "/performance/modeles", o.chefGta.jeton, { entiteId: o.G, poste: "Vendeur", libelle: "X", type: "tache", cible: 1, poids: 1 })).statut).toBe(403);
    const conge = await env.api("POST", `/employes/${o.collegueFiche}/conges`, o.jeton, { type: "annuel", debut: LUNDI, fin: "2026-11-03" });
    await env.api("POST", `/conges/${conge.corps.id}/decision`, o.jeton, { decision: "approuve" });

    expect(await o.dans((c) => preparerJournee(c, LUNDI))).toBe(3);
    expect(await o.dans((c) => preparerJournee(c, LUNDI))).toBe(0);
    expect(await o.dans((c) => preparerJournee(c, "2026-11-07"))).toBe(0);
    const j = (jeton: string, jour = LUNDI) => env.api("GET", `/moi/journee?jour=${jour}`, jeton);
    expect((await j(o.vendeur.jeton)).corps.objectifs.map((x: { libelle: string }) => x.libelle).sort()).toEqual(["Appels clients", "Ranger la réserve", "Tâches terminées"]);
    expect((await j(o.collegue.jeton)).corps).toMatchObject({ conge: true, objectifs: [], score: null });

    // La tâche planifiée du soir rappelle le rapport à qui ne l'a pas remis, une seule fois.
    await o.dans((c) => journeePerformance(c, new Date(`${LUNDI}T17:30:00Z`)));
    await o.dans((c) => journeePerformance(c, new Date(`${LUNDI}T17:45:00Z`)));
    const textes = (await o.messages(o.vendeur.jeton)).map((m) => m.texte);
    expect(textes.filter((t) => t.includes("remettre votre rapport"))).toHaveLength(1);
    expect(textes.filter((t) => t.includes("objectifs du jour"))).toHaveLength(1);
    expect((await o.messages(o.collegue.jeton)).filter((m) => m.texte.includes("rapport"))).toHaveLength(0);
  });

  it("garde au plus 3 objectifs personnels et refuse l'ajustement après midi", async () => {
    const o = await equipe();
    for (let i = 1; i <= 3; i += 1) expect((await env.api("POST", "/moi/objectifs", o.vendeur.jeton, { libelle: `Perso ${i}`, type: "chiffre_declare", cible: 5 })).statut).toBe(201);
    expect((await env.api("POST", "/moi/objectifs", o.vendeur.jeton, { libelle: "Perso 4", type: "tache" })).corps.erreur).toBe("trop_objectifs_personnels");
    await modeles(o);
    await o.dans((c) => preparerJournee(c, LUNDI));
    const obj = (await env.api("GET", `/moi/journee?jour=${LUNDI}`, o.vendeur.jeton)).corps.objectifs.find((x: { libelle: string }) => x.libelle === "Appels clients");
    expect((await env.api("PATCH", `/objectifs-jour/${obj.id}`, o.chef.jeton, { cible: 8, motif: "Journée courte" })).corps.erreur).toBe("ajustement_trop_tard");
    expect((await env.api("PATCH", `/objectifs-jour/${obj.id}`, o.chef.jeton, { cible: 8 })).statut).toBe(400);
  });
});

describe("rapport et score du jour", () => {
  it("ne compte un réalisé déclaré qu'après validation, et fige le rapport remis", async () => {
    const o = await equipe();
    await modeles(o);
    await o.dans((c) => preparerJournee(c, LUNDI));
    const objectifs = (await env.api("GET", `/moi/journee?jour=${LUNDI}`, o.vendeur.jeton)).corps.objectifs as { id: string; libelle: string }[];
    const id = (l: string) => objectifs.find((x) => x.libelle === l)!.id;
    const saisie = { jour: LUNDI, realises: [{ objectifId: id("Appels clients"), valeur: 10 }, { objectifId: id("Ranger la réserve"), valeur: 1 }], conversions: { contacts: 10, interesses: 4, conclus: 2 }, suivi: { relances: 3, plan_lendemain: "Relancer Mahima" } };
    expect((await env.api("PUT", "/moi/rapport", o.vendeur.jeton, saisie)).statut).toBe(200);
    const remise = await env.api("POST", "/moi/rapport/remise", o.vendeur.jeton, { jour: LUNDI });
    expect(remise.corps).toEqual({ statut: "remis", score: 0 });
    const avant = (await env.api("GET", `/moi/journee?jour=${LUNDI}`, o.vendeur.jeton)).corps;
    expect(avant.rapport.contenu.conversions).toMatchObject({ contacts: 10, conclus: 2, taux: 20 });
    expect(avant.score.detail.filter((l: { en_attente?: boolean }) => l.en_attente)).toHaveLength(2);

    // Figé : plus de brouillon, ni par l'écran ni directement en base.
    expect((await env.api("PUT", "/moi/rapport", o.vendeur.jeton, saisie)).corps.erreur).toBe("rapport_fige");
    await expect(o.dans((c) => c.query("update rapports_jour set contenu = '{}' where id = $1", [avant.rapport.id]))).rejects.toThrow(/remis/);

    // Validation : le collaborateur ne peut pas, un responsable de GTA non plus.
    expect((await env.api("POST", `/objectifs-jour/${id("Appels clients")}/validation`, o.vendeur.jeton, {})).statut).toBe(403);
    expect((await env.api("POST", `/objectifs-jour/${id("Appels clients")}/validation`, o.chefGta.jeton, {})).statut).toBe(403);
    expect((await env.api("POST", `/objectifs-jour/${id("Appels clients")}/validation`, o.chef.jeton, { valeur: 7 })).corps.erreur).toBe("motif_requis");
    await env.api("POST", `/objectifs-jour/${id("Appels clients")}/validation`, o.chef.jeton, {});
    const v = await env.api("POST", `/objectifs-jour/${id("Ranger la réserve")}/validation`, o.chef.jeton, {});
    // (40 × 0 mesuré + 40 × 100 + 20 × 100 + 10 × 0 ponctualité, le rapport du lundi est remis en retard) / 110
    expect(v.corps.score).toBe(55);

    // Une nouvelle version demande un motif ; l'ancienne reste.
    expect((await env.api("POST", "/moi/rapport/version", o.vendeur.jeton, { ...saisie })).statut).toBe(400);
    expect((await env.api("POST", "/moi/rapport/version", o.vendeur.jeton, { ...saisie, motif: "Oubli d'un contact", conversions: { contacts: 11, conclus: 2 } })).corps.version).toBe(2);
    const versions = (await env.api("GET", `/equipe/employes/${o.vendeurFiche}/journee?jour=${LUNDI}`, o.chef.jeton)).corps.versions;
    expect(versions.map((x: { version: number; motif_version: string | null }) => [x.version, x.motif_version])).toEqual([[1, null], [2, "Oubli d'un contact"]]);

    // Le responsable corrige avec un motif ; le collaborateur conteste.
    const s = (await env.api("GET", `/moi/journee?jour=${LUNDI}`, o.vendeur.jeton)).corps.score;
    expect((await env.api("POST", `/scores-jour/${s.id}/decision`, o.chef.jeton, { action: "corriger", score: 70 })).corps.erreur).toBe("motif_requis");
    expect((await env.api("POST", `/scores-jour/${s.id}/decision`, o.chef.jeton, { action: "corriger", score: 70, motif: "Panne réseau l'après-midi" })).corps.statut).toBe("corrige");
    expect((await env.api("POST", `/moi/scores-jour/${s.id}/contestation`, o.vendeur.jeton, { commentaire: "J'ai aussi fait 3 relances" })).corps.statut).toBe("conteste");
    expect((await o.messages(o.chef.jeton)).some((m) => m.texte.includes("conteste"))).toBe(true);
  });

  it("ne donne aucun score un jour de congé", async () => {
    const o = await equipe();
    await modeles(o);
    const conge = await env.api("POST", `/employes/${o.vendeurFiche}/conges`, o.jeton, { type: "maladie", debut: LUNDI, fin: LUNDI });
    await env.api("POST", `/conges/${conge.corps.id}/decision`, o.jeton, { decision: "approuve" });
    await o.dans((c) => preparerJournee(c, LUNDI));
    expect((await env.api("PUT", "/moi/rapport", o.vendeur.jeton, { jour: LUNDI })).corps.erreur).toBe("jour_de_conge");
    expect((await env.api("POST", "/moi/rapport/remise", o.vendeur.jeton, { jour: LUNDI })).corps.erreur).toBe("jour_de_conge");
    expect((await env.api("GET", `/moi/journee?jour=${LUNDI}`, o.vendeur.jeton)).corps).toMatchObject({ conge: true, score: null });
  });

  it("sépare GTA et GLOMARI dans Mon équipe", async () => {
    const o = await equipe();
    const noms = async (jeton: string) => (await env.api("GET", "/equipe/journee", jeton)).corps.membres.map((m: { nom: string }) => m.nom);
    expect(await noms(o.chef.jeton)).toEqual(["Awa", "Bello"]);
    expect(await noms(o.chefGta.jeton)).toEqual([]);
    expect((await env.api("GET", `/equipe/employes/${o.vendeurFiche}/journee?jour=${LUNDI}`, o.chefGta.jeton)).statut).toBe(403);
    expect((await env.api("GET", "/equipe/journee", o.vendeur.jeton)).statut).toBe(403);
    expect((await env.api("PUT", `/employes/${o.vendeurFiche}/responsable`, o.chefGta.jeton, { responsableId: null })).statut).toBe(403);
    expect((await env.api("PUT", `/employes/${o.chefFiche}/responsable`, o.jeton, { responsableId: o.vendeurFiche })).corps.erreur).toBe("responsable_invalide");
  });
});

describe("problèmes rencontrés", () => {
  const signaler = (jeton: string, corps: object) => env.api("POST", "/problemes", jeton, { categorie: "stock", description: "Rupture sur le riz", destinataire: "responsable", priorite: "normal", ...corps });

  it("classe les urgences en tête, en rouge, et prévient selon la priorité", async () => {
    const o = await equipe();
    expect((await signaler(o.vendeur.jeton, { priorite: "urgent" })).corps.erreur).toBe("motif_urgence_obligatoire");
    await signaler(o.vendeur.jeton, { description: "Imprimante en panne", categorie: "materiel" });
    await signaler(o.vendeur.jeton, { description: "Client agressif en boutique", categorie: "client", priorite: "urgent", motifUrgence: "Il menace de revenir ce soir" });
    await signaler(o.vendeur.jeton, { description: "Fournisseur en retard", categorie: "fournisseur", priorite: "important" });
    const e = (await env.api("GET", "/equipe/journee", o.chef.jeton)).corps;
    expect(e.urgences).toBe(1);
    expect(e.problemes.map((p: { priorite: string; couleur: string }) => [p.priorite, p.couleur])).toEqual([["urgent", "rouge"], ["important", "orange"], ["normal", "gris"]]);
    expect(e.membres.find((m: { nom: string }) => m.nom === "Awa").urgence).toBe(true);
    expect((await o.messages(o.chef.jeton)).map((m) => m.niveau).sort()).toEqual(["important", "info", "urgent"]);
    expect((await o.messages(o.direction.jeton)).map((m) => m.niveau)).toEqual(["urgent"]);
    const n = (await env.api("GET", "/notifications", o.chef.jeton)).corps;
    expect(n.find((x: { genre: string }) => x.genre === "messages_urgents").nombre).toBe(1);
  });

  it("monte au niveau supérieur puis au super administrateur quand le délai passe", async () => {
    const o = await equipe();
    const p = (await signaler(o.vendeur.jeton, { priorite: "important" })).corps.id;
    const retard = () => o.dans((c) => c.query("update problemes set echeance = now() - interval '1 minute' where id = $1", [p]));
    await retard();
    expect(await o.dans((c) => escalader(c, new Date()))).toBe(1);
    expect((await o.messages(o.direction.jeton)).some((m) => m.texte.includes("non pris en charge"))).toBe(true);
    await retard();
    await o.dans((c) => escalader(c, new Date()));
    expect((await o.messages(o.jeton)).some((m) => m.texte.includes("non pris en charge"))).toBe(true);
    await retard();
    expect(await o.dans((c) => escalader(c, new Date()))).toBe(0);
    const d = (await env.api("GET", `/problemes/${p}`, o.vendeur.jeton)).corps;
    expect(d.historique.filter((h: { action: string }) => h.action === "escalade")).toHaveLength(2);
    expect((await env.api("POST", `/problemes/${p}/priorite`, o.chef.jeton, { priorite: "normal" })).statut).toBe(400);
    expect((await env.api("POST", `/problemes/${p}/priorite`, o.chef.jeton, { priorite: "normal", motif: "Livraison confirmée demain" })).statut).toBe(200);
    expect((await env.api("POST", `/problemes/${p}/prise-en-charge`, o.chef.jeton)).statut).toBe(200);
    expect((await env.api("GET", `/problemes/${p}`, o.vendeur.jeton)).corps.pris_en_charge_par).toMatch(/^evaluation/);
    await env.api("POST", `/problemes/${p}/statut`, o.chef.jeton, { statut: "resolu" });
    expect((await env.api("POST", `/problemes/${p}/confirmation`, o.vendeur.jeton, { resolu: false, commentaire: "Toujours en rupture" })).corps.statut).toBe("en_cours");
    await env.api("POST", `/problemes/${p}/statut`, o.chef.jeton, { statut: "resolu" });
    expect((await env.api("POST", `/problemes/${p}/confirmation`, o.vendeur.jeton, { resolu: true })).corps.statut).toBe("clos");
  });

  it("cache un cas sensible au responsable concerné et aux collègues", async () => {
    const o = await equipe();
    const p = (await signaler(o.vendeur.jeton, { categorie: "harcelement", description: "Remarques déplacées répétées", destinataire: "responsable", priorite: "urgent", motifUrgence: "Cela recommence chaque jour" })).corps;
    expect(p.sensible).toBe(true);
    expect((await env.api("GET", `/problemes/${p.id}`, o.chef.jeton)).statut).toBe(404);
    expect((await env.api("GET", "/equipe/journee", o.chef.jeton)).corps.problemes).toEqual([]);
    expect((await o.messages(o.chef.jeton))).toEqual([]);
    expect((await env.api("GET", `/problemes/${p.id}`, o.collegue.jeton)).statut).toBe(404);
    expect((await env.api("POST", `/problemes/${p.id}/solutions`, o.collegue.jeton, { description: "Changer d'équipe" })).statut).toBe(404);
    expect((await env.api("GET", `/problemes/${p.id}`, o.rh.jeton)).corps).toMatchObject({ role: "gestion", destinataire: "rh" });
    expect((await env.api("GET", `/problemes/${p.id}`, o.direction.jeton)).corps.role).toBe("gestion");
    expect((await o.messages(o.rh.jeton)).map((m) => m.niveau)).toEqual(["urgent"]);
    expect((await env.api("GET", `/equipe/employes/${o.vendeurFiche}/journee?jour=${new Date(Date.now() + 3600_000).toISOString().slice(0, 10)}`, o.chef.jeton)).corps.problemes).toEqual([]);
  });
});

describe("solutions proposées", () => {
  it("exige une note, un motif de refus, et crée une action sans engager de dépense", async () => {
    const o = await equipe();
    const p = (await env.api("POST", "/problemes", o.vendeur.jeton, {
      categorie: "materiel", description: "Le terminal de paiement coupe", destinataire: "responsable", priorite: "important",
      solutions: [{ description: "Acheter un terminal neuf", coutEstime: 150000, delai: "1 semaine", resultatAttendu: "Plus de coupure" }],
    })).corps.id;
    const d = (await env.api("GET", `/problemes/${p}`, o.chef.jeton)).corps;
    const s = d.solutions[0].id;
    expect((await env.api("POST", `/problemes/${p}/solutions`, o.collegue.jeton, { description: "Changer la carte SIM du terminal" })).statut).toBe(201);
    const decider = (corps: object, jeton = o.chef.jeton, id = s) => env.api("POST", `/solutions/${id}/decision`, jeton, corps);
    expect((await decider({ decision: "refusee", note: 2 })).corps.erreur).toBe("motif_refus_obligatoire");
    expect((await decider({ decision: "acceptee" })).statut).toBe(400);
    expect((await decider({ decision: "a_etudier", note: 3 })).corps.erreur).toBe("date_reexamen_obligatoire");
    expect((await decider({ decision: "acceptee", note: 4 }, o.vendeur.jeton)).statut).toBe(403);
    const mouvements = async () => Number((await o.dans((c) => c.query("select count(*) as n from mouvements_portefeuille"))).rows[0].n);
    const avant = await mouvements();
    const r = await decider({ decision: "acceptee", note: 4, echeance: "2026-12-01" });
    expect(r.corps).toMatchObject({ decision: "acceptee", depense_engagee: false, action: { statut: "prevue", echeance: "2026-12-01" } });
    expect(await mouvements()).toBe(avant);
    expect((await o.messages(o.vendeur.jeton)).some((m) => m.texte.includes("acceptée (note 4/5)"))).toBe(true);
    expect((await decider({ decision: "refusee", note: 1, motif: "Déjà fait" })).corps.erreur).toBe("solution_deja_decidee");
    expect((await env.api("PATCH", `/actions-solution/${r.corps.action.id}`, o.chef.jeton, { efficace: true })).corps.erreur).toBe("action_non_realisee");
    expect((await env.api("PATCH", `/actions-solution/${r.corps.action.id}`, o.chef.jeton, { statut: "realisee", efficace: true })).statut).toBe(200);
  });
});

describe("force de proposition", () => {
  it("calcule les cinq parts, sans les cas sensibles, et attend 3 problèmes ou solutions", async () => {
    const o = await equipe();
    const signaler = (jeton: string, description: string, solutions: object[] = [], categorie = "stock") =>
      env.api("POST", "/problemes", jeton, { categorie, description, destinataire: "responsable", priorite: "normal", solutions }).then((r) => r.corps.id as string);
    const p1 = await signaler(o.vendeur.jeton, "Étiquettes de prix illisibles", [{ description: "Imprimer de nouvelles étiquettes" }]);
    const p2 = await signaler(o.vendeur.jeton, "Rayon mal éclairé", [{ description: "Acheter dix ampoules" }]);
    await signaler(o.vendeur.jeton, "Clients qui attendent à la caisse");
    await signaler(o.vendeur.jeton, "Remarques déplacées", [{ description: "En parler aux RH" }], "harcelement");
    const pc = await signaler(o.collegue.jeton, "Stock de sacs épuisé");
    const sc = (await env.api("POST", `/problemes/${pc}/solutions`, o.vendeur.jeton, { description: "Commander chez Grossiste Akwa" })).corps.id;
    const sol = async (p: string) => (await env.api("GET", `/problemes/${p}`, o.chef.jeton)).corps.solutions[0].id as string;
    const a = await env.api("POST", `/solutions/${await sol(p1)}/decision`, o.chef.jeton, { decision: "acceptee", note: 5 });
    await env.api("POST", `/solutions/${await sol(p2)}/decision`, o.chef.jeton, { decision: "refusee", note: 2, motif: "Le bailleur s'en occupe" });
    await env.api("POST", `/solutions/${sc}/decision`, o.chef.jeton, { decision: "acceptee_modifiee", note: 4, modifications: "Commander deux cartons seulement" });
    await env.api("PATCH", `/actions-solution/${a.corps.action.id}`, o.chef.jeton, { statut: "realisee", efficace: true });

    const f = (await env.api("GET", `/moi/force-proposition?mois=${mois()}`, o.vendeur.jeton)).corps;
    expect(f).toMatchObject({ evalue: true, problemes: 3, solutions: 3 });
    expect(Object.fromEntries(f.parts.map((x: { code: string; valeur: number }) => [x.code, x.valeur]))).toEqual({ reflexe: 67, qualite: 73, acceptation: 100, efficacite: 100, contribution: 100 });
    expect(f.score).toBe(85);
    // Bello : 1 problème, 0 solution : non évalué.
    expect((await env.api("GET", `/moi/force-proposition?mois=${mois()}`, o.collegue.jeton)).corps).toMatchObject({ evalue: false, score: null });
    // Poids par poste.
    expect((await env.api("PUT", "/performance/poids", o.chef.jeton, { entiteId: o.G, poste: "Vendeur", reflexe: 50, qualite: 50, acceptation: 0, efficacite: 0, contribution: 1 })).corps.erreur).toBe("poids_total_100");
    await env.api("PUT", "/performance/poids", o.chef.jeton, { entiteId: o.G, poste: "Vendeur", reflexe: 50, qualite: 50, acceptation: 0, efficacite: 0, contribution: 0 });
    expect((await env.api("GET", `/equipe/employes/${o.vendeurFiche}/force-proposition?mois=${mois()}`, o.chef.jeton)).corps.score).toBe(70);

    // L'évaluation mensuelle peut retenir ces indicateurs ; « non évalué » ne pèse pas.
    const kpi = (await env.api("GET", "/evaluations/kpi", o.chef.jeton)).corps.map((k: { code: string }) => k.code);
    expect(kpi).toEqual(expect.arrayContaining(["force_proposition", "moyenne_scores_jour", "regularite_rapports", "taches_terminees", "inscriptions_encaissees", "opportunites_gagnees", "relances_faites"]));
    await env.api("PUT", "/evaluations/regles", o.chef.jeton, { entiteId: o.G, poste: "Vendeur", lignes: [{ kpi: "force_proposition", poids: 50, cible: 80 }, { kpi: "relances_faites", poids: 50, cible: 10 }] });
    const ev = (await env.api("POST", "/evaluations", o.chef.jeton, { employeId: o.collegueFiche, periode: mois() })).corps;
    expect(ev.lignes[0]).toMatchObject({ kpi: "force_proposition", non_evalue: true, score: null });
    expect(ev.score).toBe(0);
  });
});
