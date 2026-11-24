import { afterAll, describe, expect, it } from "vitest";
import { utilisateur } from "./canaloutils.js";
import { boutiqueCare, environnementCare, type BC } from "./careoutils.js";

const env = await environnementCare();
afterAll(env.fermer);

const texteIa = (points = ["3 vitesses", "Télécommande", "Diamètre de 16 pouces"], titre = "Ventilateur Binatone 16 pouces à télécommande") =>
  ({ titre, description: "Un ventilateur sur pied de 16 pouces, avec trois vitesses et une télécommande.", points_cles: points });
const corrige = { titre: "Ventilateur Binatone 16 pouces", description: "Ventilateur sur pied, trois vitesses, télécommande fournie.", points_cles: ["3 vitesses", "Télécommande", "16 pouces"] };

/** Un ventilateur de marque Binatone, catégorie Ventilation, à 25 000 FCFA. */
async function ventilateur(b: BC) {
  const marqueId = (await b.api("POST", "/marques", { entiteId: b.G, nom: "Binatone" })).corps.id as string;
  const categorieId = (await b.api("POST", "/categories-articles", { entiteId: b.G, nom: "Ventilation" })).corps.id as string;
  const id = (await b.api("POST", "/produits", {
    entiteId: b.G, code: "VENT16", nom: "Ventilateur Binatone 16 pouces", suiviStock: true, prixVente: 25000, tauxTaxe: 0, marqueId, categorieId,
  })).corps.id as string;
  await b.api("POST", "/stocks/mouvements", { entiteId: b.lieu, produitId: id, type: "entree", quantite: 5, coutUnitaire: 12000 });
  return id;
}
const catalogue = async (b: BC, id: string) =>
  ((await env.api("GET", `/marketplace/${b.org}/catalogue`)).corps.catalogue as { id: string; nom: string; vente: unknown }[]).find((a) => a.id === id)!;
const evenementsArticle = async (b: BC, id: string) =>
  (await b.sqlAdmin("select count(*)::int as n from evenements where organisation_id = org_courante() and type = 'catalogue.article_modifie' and charge->>'produit_id' = $1", [id])).rows[0]!.n as number;

describe("studio des fiches produits", () => {
  it("propose un brouillon par l'IA, le laisse corriger puis publier sans changer le nom de l'article (Q14)", async () => {
    const b = await boutiqueCare(env);
    const id = await ventilateur(b);
    env.ia.etat.file.push(texteIa());
    const brouillon = await b.api("POST", `/fiches-vente/${id}/brouillon-ia`, { notes: "3 vitesses, télécommande" });
    expect(brouillon.statut).toBe(201);
    expect(brouillon.corps).toMatchObject({ version: 1, statut: "brouillon", source: "ia", notes: "3 vitesses, télécommande", titre: texteIa().titre });
    const appel = env.ia.etat.appels.at(-1)!;
    for (const attendu of ["Article : Ventilateur Binatone 16 pouces", "Catégorie : Ventilation", "Marque : Binatone", "Prix : 25000 FCFA TTC", "Notes du marketing : 3 vitesses, télécommande"]) {
      expect(appel.consigne).toContain(attendu);
    }
    expect(appel.consigne).not.toContain("12000");
    expect(appel.reglages).toMatchObject({ delaiMs: 60000, systeme: expect.stringContaining("N'invente aucune caractéristique") });
    expect(appel.connexions).toBe(0);
    expect((await catalogue(b, id)).vente).toBeNull();

    const c = await b.api("PUT", `/fiches-vente/${id}/brouillon`, corrige);
    expect(c.corps).toMatchObject({ version: 1, statut: "brouillon", source: "manuel", titre: corrige.titre, notes: "3 vitesses, télécommande" });
    const avant = await evenementsArticle(b, id);
    const p = await b.api("POST", `/fiches-vente/${id}/publication`);
    expect(p.corps).toMatchObject({ version: 1, statut: "publie", publie_par: "Admin", publie_le: expect.any(String) });
    expect(await evenementsArticle(b, id)).toBe(avant + 1);
    expect(await catalogue(b, id)).toMatchObject({ nom: "Ventilateur Binatone 16 pouces", vente: corrige });
    expect((await b.sql("select nom from produits where id = $1", [id])).rows[0]!.nom).toBe("Ventilateur Binatone 16 pouces");
  });

  it("garde l'historique, remplace l'ancienne publication et la retire (Q15)", async () => {
    const b = await boutiqueCare(env);
    const id = await ventilateur(b);
    expect((await b.api("POST", `/fiches-vente/${id}/publication`)).corps).toEqual({ erreur: "brouillon_absent" });
    expect((await b.api("POST", `/fiches-vente/${id}/retrait`)).corps).toEqual({ erreur: "aucun_texte_publie" });
    await b.api("PUT", `/fiches-vente/${id}/brouillon`, corrige);
    await b.api("POST", `/fiches-vente/${id}/publication`);
    const nouveau = { ...corrige, titre: "Ventilateur Binatone 16 pouces, édition 2027" };
    expect((await b.api("PUT", `/fiches-vente/${id}/brouillon`, nouveau)).corps.version).toBe(2);
    // Le texte publié reste affiché tant que le nouveau brouillon n'est pas publié.
    expect((await catalogue(b, id)).vente).toMatchObject({ titre: corrige.titre });
    await b.api("POST", `/fiches-vente/${id}/publication`);
    const fiche = (await b.api("GET", `/fiches-vente/${id}`)).corps;
    expect(fiche.historique.map((v: { version: number; statut: string }) => [v.version, v.statut])).toEqual([[2, "publie"], [1, "remplace"]]);
    expect(fiche).toMatchObject({ publie: { version: 2 }, brouillon: null, article: { nom: "Ventilateur Binatone 16 pouces", prix_ttc: 25000 } });
    expect((await catalogue(b, id)).vente).toMatchObject({ titre: nouveau.titre });

    expect((await b.api("POST", `/fiches-vente/${id}/retrait`)).corps).toEqual({ retire: true });
    expect((await catalogue(b, id)).vente).toBeNull();
    expect((await b.api("GET", `/fiches-vente/${id}`)).corps.publie).toBeNull();
  });

  it("s'écrit à la main sans IA, refuse une sortie hors limites, les personnes sans droit et les articles hors stock (Q16)", async () => {
    const b = await boutiqueCare(env);
    const id = await ventilateur(b);
    env.ia.etat.file.push(texteIa(undefined, "T".repeat(81)));
    expect((await b.api("POST", `/fiches-vente/${id}/brouillon-ia`)).corps.erreur).toBe("ia_reponse_invalide");
    env.ia.etat.file.push(texteIa(["Un", "Deux"]));
    expect((await b.api("POST", `/fiches-vente/${id}/brouillon-ia`, {})).corps.erreur).toBe("ia_reponse_invalide");
    expect((await b.api("GET", `/fiches-vente/${id}`)).corps.brouillon).toBeNull();

    const care = await utilisateur(env, b.o, "care", b.G);
    expect((await env.api("PUT", `/fiches-vente/${id}/brouillon`, care, corrige)).statut).toBe(403);
    const marketing = await utilisateur(env, b.o, "marketing", b.G);
    expect((await env.api("PUT", `/fiches-vente/${id}/brouillon`, marketing, corrige)).statut).toBe(200);
    expect((await env.api("POST", `/fiches-vente/${id}/publication`, marketing)).statut).toBe(200);
    expect((await b.api("PUT", `/fiches-vente/${id}/brouillon`, { ...corrige, points_cles: ["Un", "Deux"] })).corps.erreur).toBe("donnees_invalides");

    const service = (await b.api("POST", "/produits", { entiteId: b.G, code: "POSE", nom: "Pose de climatiseur", type: "service" })).corps.id as string;
    expect((await b.api("GET", `/fiches-vente/${service}`)).corps.erreur).toBe("module_inactif");
    const gta = (await b.api("POST", "/produits", { entiteId: b.o.entites.GTA, code: "LIVRE", nom: "Livre de formation" })).corps.id as string;
    expect((await b.api("PUT", `/fiches-vente/${gta}/brouillon`, corrige)).corps.erreur).toBe("module_inactif");
    const sansFiche = await b.article("RADIO", 5000, 0, 1);
    const aucun = (await b.api("GET", `/fiches-vente?branche=${b.G}&etat=aucun`)).corps.map((a: { id: string }) => a.id);
    expect(aucun).toContain(sansFiche);
    expect(aucun).not.toContain(id);

    const sansIa = await environnementCare({ avecIa: false });
    try {
      const s = await boutiqueCare(sansIa);
      const v = await ventilateur(s);
      expect((await s.api("POST", `/fiches-vente/${v}/brouillon-ia`)).corps.erreur).toBe("ia_non_configuree");
      expect((await s.api("GET", `/fiches-vente/${v}`)).corps.ia_disponible).toBe(false);
      expect((await s.api("PUT", `/fiches-vente/${v}/brouillon`, corrige)).statut).toBe(200);
      expect((await s.api("POST", `/fiches-vente/${v}/publication`)).statut).toBe(200);
    } finally {
      await sansIa.fermer();
    }
  });

  it("sert à l'assistant pour répondre sur l'article, puis plus après le retrait (Q17)", async () => {
    const b = await boutiqueCare(env);
    const id = await ventilateur(b);
    await b.api("PUT", `/fiches-vente/${id}/brouillon`, corrige);
    await b.api("POST", `/fiches-vente/${id}/publication`);
    await b.demander("Le ventilateur Binatone a-t-il une télécommande ?");
    expect(b.derniereConsigne()).toContain(`Texte de vente : ${corrige.titre}. ${corrige.description} Points clés : 3 vitesses ; Télécommande ; 16 pouces.`);
    await b.api("POST", `/fiches-vente/${id}/retrait`);
    await b.demander("Le ventilateur Binatone a-t-il une télécommande ?");
    expect(b.derniereConsigne()).toContain("Ventilateur Binatone 16 pouces");
    expect(b.derniereConsigne()).not.toContain("Texte de vente");
  });
});
