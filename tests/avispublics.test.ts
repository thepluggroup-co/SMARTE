import { afterAll, describe, expect, it } from "vitest";
import { auteurPublic } from "../src/canalenligne.js";
import { boutique } from "./canaloutils.js";
import { environnement } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
type B = Awaited<ReturnType<typeof boutique>>;

/** Un avis vérifié sur un article : client, demande d'avis de sa commande et note, en une instruction. */
const avis = (b: B, produitId: string, nom: string, note: number, extra: { statut?: string; reponse?: string; commentaire?: string } = {}) => b.sql(
  `with t as (insert into tiers (organisation_id, type, nom, telephone, roles, branche_id) values (org_courante(), 'personne', $1, '237699000077', '{client}', $2) returning id),
   d as (insert into demandes_retour (organisation_id, entite_id, code, cible_type, cible, source_type, source_id, tiers_id, repondu_le)
         select org_courante(), $2, md5(random()::text), 'commande', 'Commande livrée', 'colis', gen_random_uuid(), t.id, now() from t returning id)
   insert into retours_clients (organisation_id, demande_id, produit_id, note, commentaire, statut, reponse, motif_moderation)
   select org_courante(), d.id, $3, $4, $5, $6, $7, $8 from d`,
  [nom, b.G, produitId, note, extra.commentaire ?? null, extra.statut ?? "publie", extra.reponse ?? null, extra.statut === "masque" ? "Propos injurieux" : null],
);

describe("avis publics des articles", () => {
  it("abrège le nom de l'auteur", () => {
    expect([auteurPublic("Awa Ngono"), auteurPublic("Jean Pierre Mbarga"), auteurPublic("Alain"), auteurPublic(null), auteurPublic("  ")]).toEqual(["Awa N.", "Jean M.", "Alain", "Client", "Client"]);
  });

  it("montre les avis publiés, leur moyenne et leur nombre, sans nom complet ni téléphone (Q14)", async () => {
    const b = await boutique(env);
    const ventilateur = await b.article("VENT", 24000, 0, 5);
    const lampe = await b.article("LAMPE", 5000, 0, 5);
    await avis(b, ventilateur, "Awa Ngono", 5, { commentaire: "Très bon ventilateur", reponse: "Merci Awa !" });
    await avis(b, ventilateur, "Jean Pierre Mbarga", 4);
    await avis(b, ventilateur, "Alain", 3);
    await avis(b, ventilateur, "Marie Essomba", 1, { statut: "masque", commentaire: "Injure" });

    const r = await env.api("GET", `/marketplace/${b.org}/produits/${ventilateur}/avis`);
    expect(r.statut).toBe(200);
    expect(r.corps).toMatchObject({ produit_id: ventilateur, moyenne: 4, nombre: 3, page: 1, pages: 1 });
    expect(r.corps.avis.map((a: { auteur: string; note: number }) => [a.auteur, a.note])).toEqual([["Alain", 3], ["Jean M.", 4], ["Awa N.", 5]]);
    expect(r.corps.avis[2]).toMatchObject({ commentaire: "Très bon ventilateur", reponse: "Merci Awa !", achat_verifie: true, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    const brut = JSON.stringify(r.corps);
    for (const interdit of ["Ngono", "Mbarga", "Essomba", "237699000077", "Injure"]) expect(brut).not.toContain(interdit);

    const catalogue = (await env.api("GET", `/marketplace/${b.org}/catalogue`)).corps.catalogue;
    expect(catalogue.find((p: { id: string }) => p.id === ventilateur).avis).toEqual({ moyenne: 4, nombre: 3 });
    expect(catalogue.find((p: { id: string }) => p.id === lampe).avis).toEqual({ moyenne: null, nombre: 0 });

    // Un avis masqué ensuite disparaît de la fiche et de la moyenne.
    await b.sql("update retours_clients set statut = 'masque', motif_moderation = 'Hors sujet' where produit_id = $1 and note = 3", [ventilateur]);
    expect((await env.api("GET", `/marketplace/${b.org}/produits/${ventilateur}/avis`)).corps).toMatchObject({ moyenne: 4.5, nombre: 2 });
  });

  it("pagine par 20 et reste introuvable hors de la boutique", async () => {
    const b = await boutique(env);
    const lampe = await b.article("LAMPE", 5000, 0, 5);
    for (let i = 0; i < 22; i += 1) await avis(b, lampe, `Client ${i}`, 1 + (i % 5));
    const page2 = (await env.api("GET", `/marketplace/${b.org}/produits/${lampe}/avis?page=2`)).corps;
    expect(page2).toMatchObject({ nombre: 22, page: 2, pages: 2 });
    expect(page2.avis).toHaveLength(2);
    expect((await env.api("GET", `/marketplace/${b.org}/produits/${lampe}/avis`)).corps.avis).toHaveLength(20);

    const service = (await b.api("POST", "/produits", { entiteId: b.G, code: "POSE", nom: "Pose", type: "service", prixVente: 1000 })).corps.id;
    expect((await env.api("GET", `/marketplace/${b.org}/produits/${service}/avis`)).statut).toBe(404);
    expect((await env.api("GET", `/marketplace/${b.org}/produits/pas-un-identifiant/avis`)).statut).toBe(404);
    const ailleurs = await boutique(env);
    expect((await env.api("GET", `/marketplace/${ailleurs.org}/produits/${lampe}/avis`)).statut).toBe(404);
    await b.api("POST", "/canal-config", { entiteId: b.G, actif: false });
    expect((await env.api("GET", `/marketplace/${b.org}/produits/${lampe}/avis`)).statut).toBe(404);
  });
});
