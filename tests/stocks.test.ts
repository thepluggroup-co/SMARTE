import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);

async function magasin(seuil = 2) {
  const o = await env.nouvelleOrganisation();
  const p = await env.api("POST", "/produits", o.jeton, { entiteId: o.entites.GLOMARI, code: "A", nom: "Article", suiviStock: true, seuilAlerte: seuil, prixVente: 1000 });
  expect(p.statut).toBe(201);
  return { ...o, produitId: p.corps.id as string };
}
type M = Awaited<ReturnType<typeof magasin>>;
const entree = (o: M, quantite: number, coutUnitaire: number, entiteId = o.entites.GLOMARI) =>
  env.api("POST", "/stocks/mouvements", o.jeton, { entiteId, produitId: o.produitId, type: "entree", quantite, coutUnitaire });
const sortie = (o: M, quantite: number, motif?: string) =>
  env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: o.entites.GLOMARI, produitId: o.produitId, type: "sortie", quantite, motif });
const niveaux = async (o: M) => (await env.api("GET", "/stocks", o.jeton)).corps;

describe("stocks", () => {
  it("calcule le stock et le coût moyen pondéré, sans stock négatif", async () => {
    const o = await magasin();
    expect((await env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: o.entites.GLOMARI, produitId: o.produitId, type: "entree", quantite: 1 })).corps.erreur).toBe("cout_obligatoire");
    await entree(o, 10, 1000);
    expect((await entree(o, 10, 2000)).corps.niveau).toBe(20);
    expect((await env.api("GET", "/produits", o.jeton)).corps[0].cout_moyen).toBe(1500);
    expect((await sortie(o, 1)).corps.erreur).toBe("motif_obligatoire");
    expect((await sortie(o, 21, "Trop")).corps.erreur).toBe("stock_insuffisant");
    expect((await sortie(o, 5, "Casse")).corps.niveau).toBe(15);
    expect((await env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: o.entites.GLOMARI, produitId: o.produitId, type: "entree", quantite: 1.0005, coutUnitaire: 1 })).statut).toBe(400);
  });

  it("des sorties simultanées ne vendent jamais la même pièce", async () => {
    const o = await magasin();
    await entree(o, 5, 100);
    const r = await Promise.all(Array.from({ length: 12 }, () => sortie(o, 1, "Vente")));
    expect(r.filter((x) => x.statut === 201)).toHaveLength(5);
    expect((await niveaux(o))[0].quantite).toBe(0);
  });

  it("refuse un produit sans suivi de stock et le module inactif", async () => {
    const o = await magasin();
    const s = await env.api("POST", "/produits", o.jeton, { entiteId: o.entites.GLOMARI, code: "S", nom: "Service", type: "service" });
    expect((await env.api("POST", "/stocks/mouvements", o.jeton, { entiteId: o.entites.GLOMARI, produitId: s.corps.id, type: "entree", quantite: 1, coutUnitaire: 1 })).corps.erreur).toBe("produit_sans_stock");
    expect((await env.api("POST", "/produits", o.jeton, { entiteId: o.entites.GLOMARI, code: "X", nom: "X", type: "service", suiviStock: true })).statut).toBe(400);
    expect((await entree(o, 1, 1, o.entites.GTA)).statut).toBe(403);
  });

  it("sort le stock à l'émission de la facture, ou ne fait rien en cas d'échec", async () => {
    const o = await magasin();
    await env.api("PATCH", `/entites/${o.entites.GLOMARI}/identite`, o.jeton, { raisonSociale: "GLOMARI", niu: "N" });
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "C" });
    await entree(o, 3, 100);
    const creer = (quantite: number) => env.api("POST", "/documents-vente", o.jeton, {
      type: "facture", entiteId: o.entites.GLOMARI, tiersId: t.corps.id, date: "2026-01-15",
      lignes: [{ produitId: o.produitId, quantite }],
    });
    const emettre = (id: string, entrepotId?: string) => env.api("POST", `/documents-vente/${id}/emission`, o.jeton, entrepotId ? { entrepotId } : undefined);
    const a = await creer(2);
    expect((await niveaux(o))[0].quantite).toBe(3);
    expect((await emettre(a.corps.id)).corps.numero).toBe("FAC-GLOMARI-2026-000001");
    expect((await niveaux(o))[0].quantite).toBe(1);
    const b = await creer(2);
    expect((await emettre(b.corps.id)).corps.erreur).toBe("stock_insuffisant");
    expect((await env.api("GET", `/documents-vente/${b.corps.id}`, o.jeton)).corps).toMatchObject({ statut: "brouillon", numero: null });
    const m = (await env.api("GET", `/stocks/mouvements?produitId=${o.produitId}`, o.jeton)).corps;
    expect(m[0]).toMatchObject({ type: "vente", quantite: -2, document: "FAC-GLOMARI-2026-000001" });
  });

  it("respecte les droits et isole les clients", async () => {
    const o = await magasin();
    await entree(o, 1, 100);
    const d = await env.api("POST", "/entites", o.jeton, { parentId: o.entites.GLOMARI, code: "D", nom: "Dépôt", type: "entrepot" });
    const voisin = d.corps.id as string;
    await env.api("PUT", `/entites/${voisin}/modules/achats_stocks`, o.jeton, { actif: true });
    const roles = (await env.api("GET", "/roles", o.jeton)).corps;
    const email = `m${Math.random()}@test.cm`;
    await env.api("POST", "/utilisateurs", o.jeton, {
      email, nom: "M", motDePasse: MOT_DE_PASSE, entiteId: voisin, roleId: roles.find((r: { code: string }) => r.code === "magasinier").id,
    });
    const gta = await env.connecter(o.slug, email);
    expect((await env.api("GET", "/stocks", gta)).corps).toEqual([]);
    expect((await env.api("GET", `/stocks/mouvements?produitId=${o.produitId}`, gta)).corps).toEqual([]);
    expect((await env.api("POST", "/stocks/mouvements", gta, { entiteId: o.entites.GLOMARI, produitId: o.produitId, type: "sortie", quantite: 1, motif: "Vol" })).statut).toBe(403);
    const autre = await magasin();
    expect((await env.api("GET", "/stocks", autre.jeton)).corps).toEqual([]);
    expect((await env.api("POST", "/stocks/mouvements", autre.jeton, { entiteId: autre.entites.GLOMARI, produitId: o.produitId, type: "entree", quantite: 1, coutUnitaire: 1 })).statut).toBe(404);
  });
});
