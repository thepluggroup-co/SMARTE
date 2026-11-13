import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { valeurKpi } from "../src/commerce.js";
import { bornes, confianceEnBaisse, ecoule, feu, journeeOkr, lundi, periodeDe, periodeSuivante, reussi } from "../src/okr.js";
import { jourDouala } from "../src/performance.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);

type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
const aujourdhui = jourDouala();
const PERIODE = periodeDe(aujourdhui);

async function equipe() {
  const o = await env.nouvelleOrganisation();
  const G = o.entites.GLOMARI!, T = o.entites.GTA!;
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const compte = async (role: string, entiteId: string, nom = role) => {
    const email = `${role}${Math.random().toString(36).slice(2)}@test.cm`;
    const u = await env.api("POST", "/utilisateurs", o.jeton, { email, nom, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((r: { code: string }) => r.code === role).id });
    return { id: u.corps.id as string, jeton: await env.connecter(o.slug, email) };
  };
  const fiche = async (nom: string, poste: string, entiteId: string, utilisateurId: string) => {
    const e = await env.api("POST", "/employes", o.jeton, { entiteId, nom, poste, typeContrat: "cdi", dateEmbauche: "2025-01-01" });
    await env.api("PATCH", `/employes/${e.corps.id}/compte`, o.jeton, { utilisateurId });
    return e.corps.id as string;
  };
  const piloteG = await compte("responsable_pilotage", G, "Pilote GLOMARI");
  const piloteT = await compte("responsable_pilotage", T, "Pilote GTA");
  const bello = await compte("commercial", G, "Bello");
  const belloE = await fiche("Bello", "Chef de rayon", G, bello.id);
  const awa = await compte("commercial", G, "Awa");
  const awaE = await fiche("Awa", "Vendeur", G, awa.id);
  expect((await env.api("PUT", `/employes/${awaE}/responsable`, o.jeton, { responsableId: belloE })).statut).toBe(200);
  const kofi = await compte("formateur", T, "Kofi");
  await fiche("Kofi", "Formateur", T, kofi.id);
  return { ...o, G, T, piloteG, piloteT, bello, awa, awaE, kofi };
}
const kr = (libelle: string, extra = {}) => ({ libelle, depart: 0, cible: 100, ...extra });
const creer = async (o: Org, jeton: string, corps: object) => env.api("POST", "/okr", jeton, { niveau: "branche", type: "engage", periode: PERIODE, ...corps });
const dans = <R>(o: Org, f: (c: Parameters<Parameters<typeof dansOrganisation>[2]>[0]) => Promise<R>) => dansOrganisation(env.poolApp, o.organisationId, f);

describe("règles des OKR", () => {
  it("calcule trimestres, feux, réussite et baisse de confiance", () => {
    expect(bornes("2026-T4")).toEqual({ debut: "2026-10-01", fin: "2026-12-31" });
    expect(periodeSuivante("2026-T4")).toBe("2027-T1");
    expect(lundi("2026-11-12")).toBe("2026-11-09");
    expect(ecoule("2026-T4", "2026-11-15")).toBeCloseTo(46 / 92, 2);
    // À mi-trimestre : 45 % est vert, 30 % orange, 10 % rouge ; un ambitieux est attendu à 70 % du rythme.
    expect([feu(45, 0.5, "engage"), feu(30, 0.5, "engage"), feu(10, 0.5, "engage")]).toEqual(["vert", "orange", "rouge"]);
    expect(feu(25, 0.5, "ambitieux")).toBe("vert");
    expect([reussi("ambitieux", 0.6), reussi("ambitieux", 0.7), reussi("ambitieux", 0.5), reussi("engage", 0.7), reussi("engage", 1)]).toEqual([true, true, false, false, true]);
    expect(confianceEnBaisse([{ semaine: "2026-11-02", confiance: 4 }, { semaine: "2026-10-19", confiance: 8 }, { semaine: "2026-10-26", confiance: 6 }])).toBe(true);
    expect(confianceEnBaisse([{ semaine: "2026-10-19", confiance: 8 }, { semaine: "2026-10-26", confiance: 6 }, { semaine: "2026-11-02", confiance: 6 }])).toBe(false);
  });
});

describe("OKR", () => {
  it("reprend les anciens objectifs : niveau, propriétaire retrouvé par son nom, ancien texte gardé, historique", async () => {
    const o = await equipe();
    // Un objectif créé comme avant la migration : responsable en texte libre, sans propriétaire ni historique.
    const ids = await dansOrganisation(env.poolAdmin, o.organisationId, async (c) => {
      const ins = async (titre: string, responsable: string, parent: string | null) =>
        (await c.query("insert into objectifs (organisation_id, entite_id, parent_id, titre, periode, responsable) values ($1, $2, $3, $4, '2026-T3', $5) returning id", [o.organisationId, o.G, parent, titre, responsable])).rows[0].id as string;
      const haut = await ins("Doubler les ventes", "  bello ", null);
      const bas = await ins("Ouvrir Bonapriso", "Quelqu'un d'inconnu", haut);
      await c.query("insert into resultats_cles (organisation_id, objectif_id, libelle, depart, cible, actuel) values ($1, $2, 'CA mensuel', 0, 1000, 400)", [o.organisationId, haut]);
      return { haut, bas };
    });
    // La reprise de la migration 0041, telle qu'écrite, limitée à cette organisation pour ne pas toucher aux autres tests.
    const sql = readFileSync(new URL("../migrations/0041_okr.sql", import.meta.url), "utf8");
    const reprise = sql.slice(sql.indexOf("-- Reprise des objectifs existants.")).replace("for org in select id from organisations loop", `for org in select id from organisations where id = '${o.organisationId}' loop`);
    expect(reprise).toContain(o.organisationId);
    await env.poolAdmin.query(reprise);

    const arbre = (await env.api("GET", "/okr?periode=2026-T3", o.piloteG.jeton)).corps;
    const haut = arbre.objectifs.find((x: { id: string }) => x.id === ids.haut);
    const bas = arbre.objectifs.find((x: { id: string }) => x.id === ids.bas);
    expect(haut).toMatchObject({ niveau: "branche", type: "engage", statut: "actif", proprietaire: "Bello", ancien_responsable: "  bello " });
    expect(haut.resultats[0]).toMatchObject({ proprietaire: "Bello", actuel: 400, avancement: 40, mode: "manuel" });
    expect(bas).toMatchObject({ niveau: "equipe", proprietaire: null, ancien_responsable: "Quelqu'un d'inconnu", parent_id: ids.haut });
    const detail = (await env.api("GET", `/okr/${ids.haut}`, o.piloteG.jeton)).corps;
    expect(detail.resultats[0].historique).toMatchObject([{ valeur: 400, source: "reprise" }]);
    // L'ancien écran continue de lire les objectifs.
    expect((await env.api("GET", "/objectifs", o.piloteG.jeton)).corps.map((x: { titre: string }) => x.titre)).toContain("Doubler les ventes");
  });

  it("cloisonne GTA et GLOMARI : parent, lecture, mesures, propriétaires et objectifs du jour", async () => {
    const o = await equipe();
    const g = await creer(o, o.piloteG.jeton, { entiteId: o.G, titre: "GLOMARI leader du quartier", resultats: [kr("Clients fidèles")] });
    expect(g.statut).toBe(201);
    expect((await creer(o, o.piloteT.jeton, { entiteId: o.G, titre: "Intrus", resultats: [kr("X")] })).statut).toBe(403);
    expect((await creer(o, o.piloteT.jeton, { entiteId: o.T, niveau: "equipe", parentId: g.corps.id, titre: "Aligné ailleurs", resultats: [kr("X")] })).statut).toBe(404);
    expect((await creer(o, o.jeton, { entiteId: o.T, niveau: "equipe", parentId: g.corps.id, titre: "Aligné ailleurs", resultats: [kr("X")] })).corps.erreur).toBe("parent_autre_branche");
    await expect(dans(o, (c) => c.query("insert into objectifs (organisation_id, entite_id, parent_id, titre, periode) values ($1, $2, $3, 'Par la base', $4)", [o.organisationId, o.T, g.corps.id, PERIODE]))).rejects.toThrow(/autre branche/);
    // Un objectif du groupe, au-dessus des deux branches, peut être le parent d'un OKR de GTA comme de GLOMARI.
    const sgc = await creer(o, o.jeton, { entiteId: o.entites.SGC, titre: "Groupe en croissance", resultats: [kr("Branches rentables", { cible: 2 })] });
    expect((await creer(o, o.piloteT.jeton, { entiteId: o.T, parentId: sgc.corps.id, titre: "GTA rentable", resultats: [kr("Marge")] })).statut).toBe(201);
    expect((await creer(o, o.piloteT.jeton, { entiteId: o.T, titre: "Ventes à GTA", resultats: [kr("CA", { kpi: "ventes_glomari" })] })).corps.erreur).toBe("mesure_invalide");
    expect((await creer(o, o.piloteG.jeton, { entiteId: o.G, titre: "Inscrits à GLOMARI", resultats: [kr("Inscrits", { kpi: "inscriptions_gta" })] })).corps.erreur).toBe("mesure_invalide");
    expect((await creer(o, o.piloteT.jeton, { entiteId: o.T, titre: "Confié à Awa", proprietaireId: o.awa.id, resultats: [kr("X")] })).corps.erreur).toBe("proprietaire_invalide");
    const t = await creer(o, o.piloteT.jeton, { entiteId: o.T, titre: "Former 300 personnes", type: "ambitieux", resultats: [kr("Inscriptions", { kpi: "inscriptions_gta", cible: 300 })] });
    expect(t.statut).toBe(201);
    expect((await env.api("GET", "/okr/mesures?entiteId=" + o.T, o.piloteT.jeton)).corps.map((m: { code: string }) => m.code)).toEqual(expect.arrayContaining(["inscriptions_gta", "taux_conversion"]));
    expect((await env.api("GET", "/okr/mesures?entiteId=" + o.T, o.piloteT.jeton)).corps.map((m: { code: string }) => m.code)).not.toContain("ventes_glomari");

    // Lecture : chacun sa branche, rien d'une autre organisation.
    expect((await env.api("GET", "/okr", o.piloteT.jeton)).corps.objectifs.map((x: { titre: string }) => x.titre).sort()).toEqual(["Former 300 personnes", "GTA rentable"]);
    expect((await env.api("GET", `/okr/${g.corps.id}`, o.piloteT.jeton)).statut).toBe(404);
    expect((await env.api("GET", "/okr", o.awa.jeton)).statut).toBe(403);
    const autre = await env.nouvelleOrganisation();
    expect((await env.api("GET", `/okr/${g.corps.id}`, autre.jeton)).statut).toBe(404);

    // Objectifs du jour : Awa (GLOMARI) peut rattacher à un résultat clé de GLOMARI, jamais de GTA.
    const perso = await env.api("POST", "/moi/objectifs", o.awa.jeton, { libelle: "Appeler 5 anciens clients", type: "chiffre_declare", cible: 5 });
    expect(perso.statut).toBe(201);
    const krG = (await env.api("GET", `/okr/${g.corps.id}`, o.piloteG.jeton)).corps.resultats[0].id;
    const krT = (await env.api("GET", `/okr/${t.corps.id}`, o.piloteT.jeton)).corps.resultats[0].id;
    expect((await env.api("GET", "/moi/resultats-cles", o.awa.jeton)).corps.map((r: { id: string }) => r.id)).toEqual([krG]);
    expect((await env.api("PUT", `/moi/objectifs-jour/${perso.corps.id}/resultat-cle`, o.awa.jeton, { resultatCleId: krT })).corps.erreur).toBe("resultat_non_rattachable");
    expect((await env.api("PUT", `/moi/objectifs-jour/${perso.corps.id}/resultat-cle`, o.awa.jeton, { resultatCleId: krG })).statut).toBe(200);
    await env.api("PUT", "/moi/rapport", o.awa.jeton, { jour: aujourdhui, realises: [{ objectifId: perso.corps.id, valeur: 5 }] });
    const detail = (await env.api("GET", `/okr/${g.corps.id}`, o.piloteG.jeton)).corps;
    expect(detail.resultats[0].contributions).toEqual([{ resultat_id: krG, nom: "Awa", objectifs: 1, atteints: 1 }]);
    // Une fois le rapport remis, le lien ne change plus.
    expect((await env.api("POST", "/moi/rapport/remise", o.awa.jeton, { jour: aujourdhui })).statut).toBe(200);
    expect((await env.api("PUT", `/moi/objectifs-jour/${perso.corps.id}/resultat-cle`, o.awa.jeton, { resultatCleId: null })).corps.erreur).toBe("rapport_fige");
  });

  it("propose un OKR individuel validé par le responsable, point hebdomadaire avec preuve et problème, initiatives, alerte au-delà de 5", async () => {
    const o = await equipe();
    const b = await creer(o, o.piloteG.jeton, { entiteId: o.G, titre: "Boutique de référence", resultats: [kr("Note des clients", { proprietaireId: o.bello.id, cible: 5, unite: "/5" })] });
    // Awa n'a pas le droit de pilotage : elle propose son OKR individuel, Bello (son responsable) le valide.
    const ind = await creer(o, o.awa.jeton, { entiteId: o.G, niveau: "individuel", parentId: b.corps.id, titre: "Devenir la meilleure conseillère", resultats: [kr("Clients conseillés", { cible: 60 })] });
    expect(ind.corps).toMatchObject({ statut: "propose" });
    expect((await creer(o, o.awa.jeton, { entiteId: o.G, niveau: "equipe", titre: "Pas à moi", resultats: [kr("X")] })).statut).toBe(403);
    expect((await env.api("GET", "/moi/messages", o.bello.jeton)).corps.map((m: { texte: string }) => m.texte)).toEqual([expect.stringContaining("attend votre validation")]);
    expect((await env.api("POST", `/okr/${ind.corps.id}/validation`, o.awa.jeton, { decision: "accepter" })).corps.erreur).toBe("auto_validation_interdite");
    expect((await env.api("POST", `/okr/${ind.corps.id}/validation`, o.bello.jeton, { decision: "accepter" })).corps).toEqual({ statut: "actif" });

    // Point hebdomadaire de Awa sur son résultat clé : valeur, confiance, blocage qui devient un problème.
    const det = (await env.api("GET", `/okr/${ind.corps.id}`, o.awa.jeton)).corps;
    const k = det.resultats[0];
    expect(k.peut_pointer).toBe(true);
    expect((await env.api("POST", `/okr/resultats/${k.id}/points`, o.awa.jeton, { confiance: 7 })).corps.erreur).toBe("valeur_requise");
    expect((await env.api("POST", `/okr/resultats/${k.id}/points`, o.awa.jeton, { valeur: 12, confiance: 7, probleme: { categorie: "stock", destinataire: "responsable", priorite: "normal" } })).corps.erreur).toBe("blocage_requis");
    const p = await env.api("POST", `/okr/resultats/${k.id}/points`, o.awa.jeton, {
      valeur: 12, confiance: 6, blocages: "Rupture sur les produits phares", prochaineAction: "Relancer le dépôt",
      probleme: { categorie: "stock", destinataire: "responsable", priorite: "important" },
    });
    expect(p.statut).toBe(201);
    expect(p.corps).toMatchObject({ semaine: lundi(aujourdhui), avancement: 20 });
    const prob = (await env.api("GET", "/moi/problemes", o.awa.jeton)).corps.mes;
    expect(prob.map((x: { id: string }) => x.id)).toContain(p.corps.probleme_id);
    expect((await env.api("POST", `/okr/resultats/${k.id}/points`, o.awa.jeton, { valeur: 14, confiance: 6, blocages: "Toujours", probleme: { categorie: "stock", destinataire: "responsable", priorite: "normal" } })).corps.erreur).toBe("probleme_deja_signale");
    // Corriger le point de la semaine : une seule ligne, l'historique garde chaque valeur.
    expect((await env.api("POST", `/okr/resultats/${k.id}/points`, o.awa.jeton, { valeur: 15, confiance: 6, blocages: "Rupture sur les produits phares" })).statut).toBe(201);
    const apres = (await env.api("GET", `/okr/${ind.corps.id}`, o.awa.jeton)).corps.resultats[0];
    expect(apres.points).toHaveLength(1);
    expect(apres.points[0]).toMatchObject({ valeur: 15, probleme_id: p.corps.probleme_id });
    expect(apres.historique.map((h: { valeur: number; source: string }) => [h.valeur, h.source])).toEqual([[0, "creation"], [12, "point"], [15, "point"]]);
    // Bello ne fait pas le point du résultat clé de la boutique à la place de... si : il en est le propriétaire. Awa non.
    const kb = (await env.api("GET", `/okr/${b.corps.id}`, o.piloteG.jeton)).corps.resultats[0];
    expect((await env.api("POST", `/okr/resultats/${kb.id}/points`, o.awa.jeton, { valeur: 4, confiance: 8 })).statut).toBe(404);
    expect((await env.api("POST", `/okr/resultats/${kb.id}/points`, o.bello.jeton, { valeur: 4, confiance: 8 })).statut).toBe(201);
    // Preuve : un document d'une autre branche est refusé.
    const doc = (entiteId: string) => dans(o, async (c) => (await c.query(
      "insert into documents_ged (organisation_id, entite_id, groupe_id, titre, categorie, fichier, type_mime, taille, empreinte, auteur_id) values ($1, $2, gen_random_uuid(), 'Preuve', 'general', 'x.pdf', 'application/pdf', 10, 'e', $3) returning id",
      [o.organisationId, entiteId, o.adminId])).rows[0].id as string);
    expect((await env.api("POST", `/okr/resultats/${kb.id}/points`, o.jeton, { valeur: 4, confiance: 8, documentId: await doc(o.T) })).corps.erreur).toBe("document_invalide");
    const preuve = await doc(o.G);
    expect((await env.api("POST", `/okr/resultats/${kb.id}/points`, o.jeton, { valeur: 4, confiance: 8, documentId: preuve })).statut).toBe(201);
    expect((await env.api("GET", `/okr/${b.corps.id}`, o.jeton)).corps.resultats[0].points[0]).toMatchObject({ document_id: preuve, document: "Preuve" });

    // Initiatives : un projet d'une autre branche est refusé, une initiative en retard se voit dans la vue équipe.
    const projetT = await env.api("POST", "/projets", o.jeton, { entiteId: o.T, nom: "Campus" });
    expect((await env.api("POST", `/okr/resultats/${k.id}/initiatives`, o.awa.jeton, { titre: "X", projetId: projetT.corps.id })).corps.erreur).toBe("projet_autre_branche");
    const projetG = await env.api("POST", "/projets", o.jeton, { entiteId: o.G, nom: "Vitrine" });
    expect((await env.api("POST", `/okr/resultats/${k.id}/initiatives`, o.awa.jeton, { titre: "Refaire la vitrine", echeance: "2020-01-01", projetId: projetG.corps.id })).statut).toBe(201);
    const equipeOkr = await creer(o, o.piloteG.jeton, { entiteId: o.G, niveau: "equipe", titre: "Rayon qui fidélise", proprietaireId: o.bello.id, resultats: [kr("Clients revenus", { proprietaireId: o.awa.id })] });
    const krAwa = (await env.api("GET", `/okr/${equipeOkr.corps.id}`, o.bello.jeton)).corps.resultats[0];
    expect(krAwa.peut_pointer).toBe(true);
    expect((await env.api("POST", `/okr/resultats/${krAwa.id}/initiatives`, o.bello.jeton, { titre: "Rappeler les clients de 2025" })).statut).toBe(201);
    expect((await env.api("POST", `/okr/resultats/${krAwa.id}/note`, o.bello.jeton, { note: 1, commentaire: "Pas lui" })).statut).toBe(403);
    const vue = (await env.api("GET", "/okr/equipe", o.bello.jeton)).corps;
    expect(vue.initiatives_en_retard.map((i: { titre: string }) => i.titre)).toEqual(["Refaire la vitrine"]);
    expect(vue.blocages).toEqual([expect.objectContaining({ proprietaire: "Awa", blocages: "Rupture sur les produits phares" })]);
    expect((await env.api("GET", "/okr/equipe", o.kofi.jeton)).statut).toBe(403);
    const mes = (await env.api("GET", "/moi/okr", o.awa.jeton)).corps;
    expect(mes.objectifs[0]).toMatchObject({ titre: "Devenir la meilleure conseillère", parent_titre: "Boutique de référence" });
    expect(mes.objectifs[0].resultats[0]).toMatchObject({ a_moi: true, point_semaine: true });

    // Au-delà de 5 objectifs au même niveau ou de 5 résultats clés : alerte, sans blocage.
    for (let i = 0; i < 4; i++) await creer(o, o.piloteG.jeton, { entiteId: o.G, titre: `Objectif ${i}`, resultats: [kr("X")] });
    const sixieme = await creer(o, o.piloteG.jeton, { entiteId: o.G, titre: "Sixième", resultats: [1, 2, 3, 4, 5, 6].map((n) => kr(`R${n}`)) });
    expect(sixieme.statut).toBe(201);
    expect(sixieme.corps.alertes.map((a: { code: string }) => a.code)).toEqual(["plus_de_5_objectifs", "plus_de_5_resultats"]);
    expect((await env.api("GET", "/okr", o.piloteG.jeton)).corps.alertes).toEqual([expect.objectContaining({ code: "plus_de_5_objectifs", niveau: "branche", nombre: 6 })]);
  });

  it("met à jour chaque nuit les résultats clés reliés à une mesure, une seule fois par jour", async () => {
    const o = await equipe();
    const g = await creer(o, o.piloteG.jeton, { entiteId: o.G, titre: "Vendre plus", resultats: [kr("Chiffre d'affaires du trimestre", { kpi: "ventes_glomari", cible: 1_000_000, unite: "FCFA" })] });
    const krId = (await env.api("GET", `/okr/${g.corps.id}`, o.piloteG.jeton)).corps.resultats[0].id;
    expect((await env.api("POST", `/okr/resultats/${krId}/points`, o.piloteG.jeton, { confiance: 8 })).statut).toBe(201);
    expect((await env.api("PATCH", `/resultats-cles/${krId}`, o.piloteG.jeton, { actuel: 5 })).corps.erreur).toBe("resultat_automatique");
    await env.api("PATCH", `/entites/${o.G}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const tiersId = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Client", entiteId: o.G })).corps.id;
    const d = await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: o.G, tiersId, date: aujourdhui, lignes: [{ designation: "Service", quantite: 1, prixUnitaire: 250_000 }] });
    expect((await env.api("POST", `/documents-vente/${d.corps.id}/emission`, o.jeton)).statut).toBe(200);
    // Une facture de GTA ne compte pas pour GLOMARI.
    await env.api("PATCH", `/entites/${o.T}/identite`, o.jeton, { raisonSociale: "T", niu: "M" });
    const tiersT = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Apprenant", entiteId: o.T })).corps.id;
    const dT = await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: o.T, tiersId: tiersT, date: aujourdhui, lignes: [{ designation: "Formation", quantite: 1, prixUnitaire: 90_000 }] });
    await env.api("POST", `/documents-vente/${dT.corps.id}/emission`, o.jeton);

    const nuit = new Date(`${aujourdhui}T02:30:00Z`); // 3 h 30 à Douala
    await dans(o, (c) => journeeOkr(c, nuit));
    let r = (await env.api("GET", `/okr/${g.corps.id}`, o.piloteG.jeton)).corps.resultats[0];
    expect(r).toMatchObject({ actuel: 250_000, avancement: 25 });
    // Une deuxième facture le même jour n'est reprise que la nuit suivante.
    const d2 = await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: o.G, tiersId, date: aujourdhui, lignes: [{ designation: "Service", quantite: 1, prixUnitaire: 100_000 }] });
    await env.api("POST", `/documents-vente/${d2.corps.id}/emission`, o.jeton);
    await dans(o, (c) => journeeOkr(c, new Date(nuit.getTime() + 3_600_000)));
    expect((await env.api("GET", `/okr/${g.corps.id}`, o.piloteG.jeton)).corps.resultats[0].actuel).toBe(250_000);
    await dans(o, (c) => c.query("update resultats_cles set mesure_le = mesure_le - 1 where id = $1", [krId]));
    await dans(o, (c) => journeeOkr(c, nuit));
    r = (await env.api("GET", `/okr/${g.corps.id}`, o.piloteG.jeton)).corps.resultats[0];
    expect(r.actuel).toBe(350_000);
    expect(r.historique.map((h: { valeur: number; source: string }) => [h.valeur, h.source])).toEqual([[0, "creation"], [250_000, "auto"], [350_000, "auto"]]);
    // Chaque mesure d'entité du catalogue se calcule sans erreur, pour GLOMARI comme pour GTA.
    const { mesureEntite, mesuresPour } = await import("../src/okr.js");
    for (const [entite, domaine] of [[o.G, "commerce"], [o.T, "formation"]] as const) {
      for (const m of mesuresPour(domaine)) await expect(dans(o, (c) => mesureEntite(c, m.code, entite, bornes(PERIODE).debut, aujourdhui))).resolves.not.toBeNaN();
    }
    expect(mesuresPour("commerce").map((m) => m.code).sort()).toEqual(["delai_livraison", "ruptures_stock", "taux_conversion", "ventes_glomari"]);
    expect(mesuresPour("formation").map((m) => m.code).sort()).toEqual(["inscriptions_gta", "taux_conversion"]);
  });

  it("alerte le lundi : rappel du point, retard sur le trimestre, confiance en baisse deux semaines de suite", async () => {
    const o = await equipe();
    const LUNDI = "2026-11-09"; // 44 % du trimestre écoulé
    const g = await creer(o, o.piloteG.jeton, { entiteId: o.G, periode: "2026-T4", titre: "Fidéliser", resultats: [kr("Clients revenus", { proprietaireId: o.awa.id }), kr("Avis positifs", { proprietaireId: o.bello.id })] });
    const [k1, k2] = (await env.api("GET", `/okr/${g.corps.id}`, o.piloteG.jeton)).corps.resultats;
    // Trois points passés pour Awa : la confiance descend de 8 à 6 puis à 4 ; Bello est à 40 %, dans les temps.
    await dans(o, async (c) => {
      for (const [semaine, confiance] of [["2026-10-19", 8], ["2026-10-26", 6], ["2026-11-02", 4]] as const) {
        await c.query("insert into points_okr (organisation_id, resultat_id, semaine, valeur, confiance, auteur_id) values ($1, $2, $3, 5, $4, $5)", [o.organisationId, k1.id, semaine, confiance, o.awa.id]);
      }
      await c.query("update resultats_cles set actuel = 40 where id = $1", [k2.id]);
    });
    await dans(o, (c) => journeeOkr(c, new Date(`${LUNDI}T08:30:00Z`)));
    const textes = async (jeton: string) => (await env.api("GET", "/moi/messages", jeton)).corps.map((m: { texte: string }) => m.texte);
    const awa = await textes(o.awa.jeton);
    expect(awa).toEqual(expect.arrayContaining([expect.stringContaining("Point hebdomadaire OKR : 1 résultat"), expect.stringContaining("feu rouge"), expect.stringContaining("Confiance en baisse")]));
    // Le responsable direct de Awa est prévenu de la baisse de confiance ; Bello n'a pas d'alerte de retard pour lui-même.
    const bello = await textes(o.bello.jeton);
    expect(bello).toEqual(expect.arrayContaining([expect.stringContaining("Confiance en baisse deux semaines de suite : Clients revenus"), expect.stringContaining("Point hebdomadaire OKR")]));
    expect(bello.filter((t: string) => t.includes("feu rouge : Avis positifs"))).toEqual([]);
    // Une seule fois par lundi.
    await dans(o, (c) => journeeOkr(c, new Date(`${LUNDI}T10:30:00Z`)));
    expect(await textes(o.awa.jeton)).toHaveLength(awa.length);
    const vue = (await env.api("GET", "/okr/equipe?periode=2026-T4", o.piloteG.jeton)).corps;
    expect(vue.resultats[0]).toMatchObject({ libelle: "Clients revenus", confiance_en_baisse: true });
  });

  it("note de 0 à 1, bilan guidé, reconduction sans ressaisie et historique consultable", async () => {
    const o = await equipe();
    const T3 = "2026-T3";
    const parent = await creer(o, o.piloteG.jeton, { entiteId: o.G, periode: T3, titre: "Être la référence", resultats: [kr("Part de marché")] });
    const amb = await creer(o, o.piloteG.jeton, { entiteId: o.G, periode: T3, niveau: "equipe", parentId: parent.corps.id, type: "ambitieux", titre: "Viser haut", resultats: [kr("Nouveaux clients", { proprietaireId: o.awa.id }), kr("Panier moyen", { cible: 50, unite: "k" })] });
    const krs = (await env.api("GET", `/okr/${amb.corps.id}`, o.piloteG.jeton)).corps.resultats;
    expect((await env.api("POST", `/okr/resultats/${krs[0].id}/note`, o.awa.jeton, { note: 1, commentaire: "Moi" })).statut).toBe(403);
    expect((await env.api("POST", `/okr/resultats/${krs[0].id}/note`, o.piloteG.jeton, { note: 0.65, commentaire: "Bon trimestre" })).corps).toEqual({ note: 0.65, reussi: true });
    expect((await env.api("POST", `/okr/${amb.corps.id}/cloture`, o.piloteG.jeton, { appris: "Il faut des relances" })).corps.erreur).toBe("notation_incomplete");
    await env.api("POST", `/okr/resultats/${krs[1].id}/note`, o.piloteG.jeton, { note: 0.6, commentaire: "Correct" });
    const clos = await env.api("POST", `/okr/${amb.corps.id}/cloture`, o.piloteG.jeton, { appris: "Il faut des relances", garder: "Le point du lundi", abandonner: "Les flyers" });
    // Ambitieux noté 0,63 : réussi.
    expect(clos.corps).toEqual({ statut: "clos", note: 0.63, reussi: true });
    expect((await env.api("POST", `/okr/resultats/${krs[0].id}/points`, o.awa.jeton, { valeur: 1, confiance: 5 })).corps.erreur).toBe("objectif_non_actif");
    // Un engagé noté 0,65 n'est pas réussi.
    const eng = await creer(o, o.piloteG.jeton, { entiteId: o.G, periode: T3, titre: "Tenir les délais", resultats: [kr("Livraisons à l'heure")] });
    const ke = (await env.api("GET", `/okr/${eng.corps.id}`, o.piloteG.jeton)).corps.resultats[0];
    expect((await env.api("POST", `/okr/resultats/${ke.id}/note`, o.piloteG.jeton, { note: 0.65, commentaire: "Moyen" })).corps.reussi).toBe(false);
    // Pas de note au milieu d'un trimestre lointain.
    const futur = await creer(o, o.piloteG.jeton, { entiteId: o.G, periode: "2099-T1", titre: "Plus tard", resultats: [kr("X")] });
    const kf = (await env.api("GET", `/okr/${futur.corps.id}`, o.piloteG.jeton)).corps.resultats[0];
    expect((await env.api("POST", `/okr/resultats/${kf.id}/note`, o.piloteG.jeton, { note: 0.5, commentaire: "Trop tôt" })).corps.erreur).toBe("trimestre_en_cours");

    // Reconduction : le parent d'abord, puis l'objectif, qui retrouve son parent au trimestre suivant.
    const rp = await env.api("POST", `/okr/${parent.corps.id}/reconduction`, o.piloteG.jeton);
    const ra = await env.api("POST", `/okr/${amb.corps.id}/reconduction`, o.piloteG.jeton);
    expect(ra.corps).toMatchObject({ periode: "2026-T4", resultats: 2 });
    expect((await env.api("POST", `/okr/${amb.corps.id}/reconduction`, o.piloteG.jeton)).corps.erreur).toBe("deja_reconduit");
    const nouveau = (await env.api("GET", `/okr/${ra.corps.id}`, o.piloteG.jeton)).corps;
    expect(nouveau).toMatchObject({ titre: "Viser haut", type: "ambitieux", niveau: "equipe", statut: "actif", periode: "2026-T4", origine_id: amb.corps.id, parent_id: rp.corps.id });
    expect(nouveau.resultats.map((r: { libelle: string; proprietaire: string | null; actuel: number; note: number | null }) => [r.libelle, r.proprietaire, r.actuel, r.note])).toEqual([["Nouveaux clients", "Awa", 0, null], ["Panier moyen", "Pilote GLOMARI", 0, null]]);
    // L'historique du trimestre passé reste consultable.
    const ancien = (await env.api("GET", `/okr/${amb.corps.id}`, o.piloteG.jeton)).corps;
    expect(ancien).toMatchObject({ statut: "clos", note: 0.63, reussi: true, feu: "vert", reconduit_en: ra.corps.id, bilan: { appris: "Il faut des relances", garder: "Le point du lundi", abandonner: "Les flyers" } });
    expect((await env.api("GET", `/okr?periode=${T3}`, o.piloteG.jeton)).corps.objectifs.map((x: { titre: string; statut: string }) => [x.titre, x.statut])).toEqual(expect.arrayContaining([["Viser haut", "clos"]]));
  });

  it("évalue la régularité des points et l'atteinte des OKR engagés ; la note des ambitieux reste une information", async () => {
    const o = await equipe();
    const eng = await creer(o, o.piloteG.jeton, { entiteId: o.G, titre: "Engagé", resultats: [kr("Engagé A", { proprietaireId: o.awa.id })] });
    const amb = await creer(o, o.piloteG.jeton, { entiteId: o.G, type: "ambitieux", titre: "Ambitieux", resultats: [kr("Ambitieux A", { proprietaireId: o.awa.id })] });
    const ke = (await env.api("GET", `/okr/${eng.corps.id}`, o.awa.jeton)).corps.resultats[0];
    const ka = (await env.api("GET", `/okr/${amb.corps.id}`, o.awa.jeton)).corps.resultats[0];
    const mois = aujourdhui.slice(0, 7);
    const kpi = (code: string) => dans(o, (c) => valeurKpi(c, code, o.awa.id, mois));
    expect(await kpi("regularite_points_okr")).toBe(0);
    await env.api("POST", `/okr/resultats/${ke.id}/points`, o.awa.jeton, { valeur: 50, confiance: 7 });
    expect(await kpi("regularite_points_okr")).toBe(50);
    await env.api("POST", `/okr/resultats/${ka.id}/points`, o.awa.jeton, { valeur: 100, confiance: 9 });
    expect(await kpi("regularite_points_okr")).toBe(100);
    // L'ambitieux à 100 % ne gonfle pas l'atteinte : seul l'engagé compte (50 %).
    expect(await kpi("atteinte_okr_engages")).toBe(50);
    // Les mesures d'OKR entrent dans les règles d'évaluation ; les mesures d'entité, non.
    const regles = await env.api("PUT", "/evaluations/regles", o.jeton, { entiteId: o.G, poste: "Vendeur", lignes: [{ kpi: "atteinte_okr_engages", poids: 60, cible: 100 }, { kpi: "regularite_points_okr", poids: 40, cible: 100 }] });
    expect(regles.statut).toBe(200);
    expect((await env.api("PUT", "/evaluations/regles", o.jeton, { entiteId: o.G, poste: "Vendeur", lignes: [{ kpi: "ventes_glomari", poids: 60, cible: 100 }] })).statut).toBe(400);
    const ev = await env.api("POST", "/evaluations", o.jeton, { employeId: o.awaE, periode: mois });
    expect(ev.corps.lignes.map((l: { kpi: string; realise: number }) => [l.kpi, l.realise])).toEqual([["atteinte_okr_engages", 50], ["regularite_points_okr", 100]]);
    expect(ev.corps.score).toBe(70);
  });
});
