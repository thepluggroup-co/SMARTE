import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { preparerJournee } from "../src/performance.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
const LUNDI = "2026-11-02";

async function equipe() {
  const o = await env.nouvelleOrganisation();
  const G = o.entites.GLOMARI!, T = o.entites.GTA!;
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const compte = async (role: string, entiteId: string) => {
    const email = `${role}${Math.random().toString(36).slice(2)}@test.cm`;
    const u = await env.api("POST", "/utilisateurs", o.jeton, { email, nom: role, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((r: { code: string }) => r.code === role).id });
    return { id: u.corps.id as string, jeton: await env.connecter(o.slug, email) };
  };
  const fiche = async (nom: string, poste: string, entiteId: string, utilisateurId: string) => {
    const e = await env.api("POST", "/employes", o.jeton, { entiteId, nom, poste, typeContrat: "cdi", dateEmbauche: "2025-01-01" });
    await env.api("PATCH", `/employes/${e.corps.id}/compte`, o.jeton, { utilisateurId });
    return e.corps.id as string;
  };
  const rh = await compte("ressources_humaines", G);
  const chefGta = await compte("evaluation", T);
  const awa = await compte("commercial", G);
  await fiche("Awa", "Vendeur", G, awa.id);
  const bello = await compte("commercial", G);
  await fiche("Bello", "Vendeur", G, bello.id);
  const caissier = await compte("caissier", G);
  await fiche("Carine", "Caissier", G, caissier.id);
  return { ...o, G, T, rh, chefGta, awa, bello, caissier };
}

const contenu = (extra = {}) => ({
  rattachement: "Responsable de boutique",
  missions: ["Accueillir et conseiller les clients", "Tenir le rayon propre et étiqueté"],
  responsabilites: ["Exactitude des prix affichés"], competences: ["Écoute", "Connaissance des produits"],
  indicateurs: [{ kpi: "ventes_caisse", cible: 1500000, poids: 60 }, { kpi: "force_proposition", cible: 70, poids: 40 }],
  objectifsTypes: [
    { libelle: "Contacts clients enregistrés", type: "mesure_systeme", kpi: "contacts_clients", cible: 15, poids: 40 },
    { libelle: "Ventes conclues", type: "chiffre_declare", cible: 5, poids: 40 },
    { libelle: "Ranger le rayon", type: "tache", cible: 1, poids: 20 },
  ],
  ...extra,
});

describe("fiches de poste", () => {
  it("se rédigent par les RH de la branche, avec des indicateurs du catalogue", async () => {
    const o = await equipe();
    const creer = (jeton: string, corps: object) => env.api("POST", "/fiches-poste", jeton, { entiteId: o.G, intitule: "Vendeur", ...contenu(), ...corps });
    expect((await creer(o.awa.jeton, {})).statut).toBe(403);
    expect((await creer(o.chefGta.jeton, {})).statut).toBe(403);
    expect((await creer(o.rh.jeton, { objectifsTypes: [{ libelle: "X", type: "mesure_systeme", cible: 1, poids: 1 }] })).corps.erreur).toBe("fiche_invalide");
    expect((await creer(o.rh.jeton, { objectifsTypes: [{ libelle: "X", type: "mesure_systeme", kpi: "force_proposition", cible: 1, poids: 1 }] })).corps.erreur).toBe("fiche_invalide");
    expect((await creer(o.rh.jeton, { indicateurs: [{ kpi: "inconnu", cible: 1, poids: 1 }] })).corps.erreur).toBe("fiche_invalide");
    const f = await creer(o.rh.jeton, {});
    expect(f.statut).toBe(201);
    expect(f.corps).toMatchObject({ version: 1, intitule: "Vendeur", missions: ["Accueillir et conseiller les clients", "Tenir le rayon propre et étiqueté"] });
    expect((await creer(o.rh.jeton, {})).corps.erreur).toBe("fiche_existante");
    expect((await creer(o.rh.jeton, { intitule: "Caissier", rattacheA: f.corps.id })).corps.erreur).toBe("rattachement_invalide");
    expect((await creer(o.rh.jeton, { intitule: "Caissier", rattacheA: f.corps.groupe_id })).statut).toBe(201);
    expect((await env.api("GET", "/fiches-poste", o.rh.jeton)).corps.map((x: { intitule: string }) => x.intitule)).toEqual(["Caissier", "Vendeur"]);
    expect((await env.api("GET", "/fiches-poste", o.chefGta.jeton)).corps).toEqual([]);
    expect((await env.api("GET", "/fiches-poste/indicateurs", o.rh.jeton)).corps.map((k: { code: string }) => k.code)).toContain("force_proposition");
    expect((await env.api("GET", "/fiches-poste/indicateurs", o.awa.jeton)).statut).toBe(403);
    expect((await env.api("GET", `/fiches-poste/${f.corps.groupe_id}`, o.chefGta.jeton)).statut).toBe(403);
    const autre = await env.nouvelleOrganisation();
    expect((await env.api("GET", `/fiches-poste/${f.corps.groupe_id}`, autre.jeton)).statut).toBe(404);
  });

  it("publie une nouvelle version à chaque modification et demande une nouvelle lecture", async () => {
    const o = await equipe();
    const v1 = (await env.api("POST", "/fiches-poste", o.rh.jeton, { entiteId: o.G, intitule: "Vendeur", ...contenu() })).corps;
    const g = v1.groupe_id;
    const moi = async (jeton: string) => (await env.api("GET", "/moi/fiche-poste", jeton)).corps;
    expect(await moi(o.awa.jeton)).toMatchObject({ poste: "Vendeur", fiche: { version: 1 }, lu_le: null });
    expect((await moi(o.awa.jeton)).fiche.indicateurs[0]).toMatchObject({ kpi: "ventes_caisse", libelle: "Ventes en caisse (FCFA)" });
    expect((await moi(o.awa.jeton)).fiche).toMatchObject({ entite: "GLOMARI", objectifs_types: [{ kpi: "contacts_clients", kpi_libelle: "Contacts clients enregistrés" }, { kpi_libelle: null }, { kpi_libelle: null }] });
    expect((await moi(o.caissier.jeton)).fiche).toBeNull();
    expect((await env.api("GET", "/moi/messages", o.awa.jeton)).corps.map((m: { texte: string }) => m.texte)).toEqual([expect.stringContaining("est disponible")]);
    expect((await env.api("POST", "/moi/fiche-poste/lecture", o.awa.jeton, { ficheId: v1.id })).corps).toEqual({ lu: true, version: 1 });

    expect((await env.api("PUT", `/fiches-poste/${g}`, o.rh.jeton, contenu())).corps.erreur).toBe("motif_requis");
    expect((await env.api("PUT", `/fiches-poste/${g}`, o.awa.jeton, { ...contenu(), motif: "Moi" })).statut).toBe(403);
    const v2 = (await env.api("PUT", `/fiches-poste/${g}`, o.rh.jeton, { ...contenu({ missions: ["Accueillir et conseiller les clients", "Gérer la vitrine"] }), motif: "Ajout de la vitrine" })).corps;
    expect(v2).toMatchObject({ version: 2, motif_version: "Ajout de la vitrine" });
    // La version 1 reste telle quelle : ni l'écran ni la base ne la modifient.
    expect((await env.api("GET", `/fiches-poste/versions/${v1.id}`, o.rh.jeton)).corps.missions).toContain("Tenir le rayon propre et étiqueté");
    await expect(dansOrganisation(env.poolApp, o.organisationId, (c) => c.query("update fiches_poste set intitule = 'X' where id = $1", [v1.id]))).rejects.toThrow(/permission/);

    expect(await moi(o.awa.jeton)).toMatchObject({ fiche: { version: 2 }, lu_le: null });
    expect((await env.api("POST", "/moi/fiche-poste/lecture", o.awa.jeton, { ficheId: v1.id })).corps.erreur).toBe("fiche_obsolete");
    await env.api("POST", "/moi/fiche-poste/lecture", o.awa.jeton, { ficheId: v2.id });
    const d = (await env.api("GET", `/fiches-poste/${g}`, o.rh.jeton)).corps;
    expect(d.versions.map((x: { version: number }) => x.version)).toEqual([2, 1]);
    expect(d.lectures.map((x: { nom: string; lu: boolean }) => [x.nom, x.lu])).toEqual([["Awa", true], ["Bello", false]]);
  });

  it("génère les modèles d'objectifs journaliers du poste depuis les objectifs types", async () => {
    const o = await equipe();
    const v1 = (await env.api("POST", "/fiches-poste", o.rh.jeton, { entiteId: o.G, intitule: "Vendeur", ...contenu() })).corps;
    const g = v1.groupe_id;
    const manuel = await env.api("POST", "/performance/modeles", o.jeton, { entiteId: o.G, poste: "Vendeur", libelle: "Objectif saisi à la main", type: "tache", cible: 1, poids: 10 });
    expect(manuel.statut).toBe(201);
    expect((await env.api("POST", `/fiches-poste/${g}/modeles`, o.awa.jeton)).statut).toBe(403);
    expect((await env.api("POST", `/fiches-poste/${g}/modeles`, o.rh.jeton)).corps).toEqual({ crees: 3, arretes: 0, version: 1 });
    expect((await env.api("POST", `/fiches-poste/${g}/modeles`, o.rh.jeton)).corps.erreur).toBe("modeles_deja_generes");

    await env.api("PUT", `/fiches-poste/${g}`, o.rh.jeton, { ...contenu({ objectifsTypes: [{ libelle: "Ventes conclues", type: "chiffre_declare", cible: 6, poids: 100 }] }), motif: "Objectifs simplifiés" });
    expect((await env.api("POST", `/fiches-poste/${g}/modeles`, o.rh.jeton)).corps).toEqual({ crees: 1, arretes: 3, version: 2 });
    const actifs = (await env.api("GET", "/performance/modeles", o.jeton)).corps.filter((m: { actif: boolean }) => m.actif).map((m: { libelle: string; cible: string }) => [m.libelle, Number(m.cible)]);
    expect(actifs.sort()).toEqual([["Objectif saisi à la main", 1], ["Ventes conclues", 6]]);

    // Le matin, ces modèles deviennent les objectifs du jour de chaque vendeur.
    expect(await dansOrganisation(env.poolApp, o.organisationId, (c) => preparerJournee(c, LUNDI))).toBe(4);
    const objectifs = (await env.api("GET", `/moi/journee?jour=${LUNDI}`, o.bello.jeton)).corps.objectifs.map((x: { libelle: string }) => x.libelle).sort();
    expect(objectifs).toEqual(["Objectif saisi à la main", "Ventes conclues"]);
  });
});
