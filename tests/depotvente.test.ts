import { afterAll, describe, expect, it } from "vitest";
import { environnement } from "./outils.js";
import { aujourdhui, magasinImport } from "./importoutils.js";

const env = await environnement();
afterAll(env.fermer);

/** GLOMARI avec un magasin ouvert en caisse, l'identité pour facturer, un fournisseur local et un article à 5 000 FCFA sans taxe. */
async function depotVente() {
  const o = await magasinImport(env);
  await o.api("PATCH", `/entites/${o.G}/identite`, { raisonSociale: "GLOMARI SARL", niu: "M0123" });
  const lieu = (await o.api("POST", "/magasins", { parentId: o.G, nom: "Akwa", type: "point_de_vente" })).corps.id as string;
  const caisse = await o.portefeuille("Caisse Akwa", 0, o.G, "especes");
  await o.api("PUT", "/portefeuilles/defauts", { entiteId: o.G, moyen: "especes", portefeuilleId: caisse });
  await o.api("POST", "/caisse/ouverture", { entiteId: lieu, fondOuverture: 0 });
  const local = (await o.api("POST", "/tiers", { type: "entreprise", nom: "Atelier Bonamoussadi", entiteId: o.G })).corps.id as string;
  const savon = await o.article("SAVON", { prixVente: 5000, tauxTaxe: 0 });
  const declarer = (produitId: string, remuneration: object, fournisseurId = local, jeton = o.jeton) =>
    o.api("POST", "/depots-vente", { produitId, fournisseurId, ...remuneration }, jeton);
  const entrer = (produitId: string, quantite: number, jeton = o.jeton) => o.api("POST", `/depots-vente/${produitId}/entrees`, { lieuId: lieu, quantite }, jeton);
  const vendre = (produitId: string, quantite: number, montant: number, extra: object = {}) =>
    o.api("POST", "/caisse/ventes", { entiteId: lieu, lignes: [{ produitId, quantite }], paiements: [{ moyen: "especes", montant }], ...extra });
  const facturer = async (produitId: string, quantite: number) => {
    const client = (await o.api("POST", "/tiers", { type: "personne", nom: "Madame Eto", entiteId: o.G })).corps.id;
    const d = await o.api("POST", "/documents-vente", { type: "facture", entiteId: o.G, tiersId: client, date: aujourdhui(), lignes: [{ produitId, quantite }] });
    const e = await o.api("POST", `/documents-vente/${d.corps.id}/emission`, { entrepotId: lieu });
    if (e.statut !== 200) throw new Error(`émission refusée : ${JSON.stringify(e.corps)}`);
    return d.corps.id as string;
  };
  const apercu = async (du = aujourdhui(), au = aujourdhui(), fournisseurId = local, jeton = o.jeton) =>
    o.api("GET", `/depots-vente/releves/apercu?fournisseurId=${fournisseurId}&du=${du}&au=${au}`, undefined, jeton);
  const releve = (du = aujourdhui(), au = aujourdhui(), fournisseurId = local) => o.api("POST", "/depots-vente/releves", { fournisseurId, du, au });
  return { ...o, lieu, local, savon, declarer, entrer, vendre, facturer, apercu, releve };
}
type D = Awaited<ReturnType<typeof depotVente>>;

const stockDe = async (o: D, produitId: string) =>
  (await o.sql("select coalesce(sum(quantite), 0)::float as q, coalesce(sum(quantite * cout_unitaire), 0)::float as valeur from mouvements_stock where produit_id = $1", [produitId])).rows[0]!;

describe("dépôt-vente", () => {
  it("compte les pièces vendues, facturées et retournées, sans valeur de stock pour GLOMARI (Q10)", async () => {
    const o = await depotVente();
    expect((await o.declarer(o.savon, { mode: "prix_fixe", prixReversement: 3000 })).statut).toBe(201);
    expect((await o.api("GET", `/tiers/${o.local}`)).corps.roles).toContain("fournisseur");
    expect((await o.entrer(o.savon, 200)).statut).toBe(201);
    expect(await stockDe(o, o.savon)).toEqual({ q: 200, valeur: 0 });

    const v = await o.vendre(o.savon, 30, 150_000);
    expect(v.statut).toBe(201);
    await o.facturer(o.savon, 5);
    const ligne = (await o.api("GET", `/caisse/ventes/${v.corps.id}`)).corps.lignes[0];
    const r = await o.api("POST", `/caisse/ventes/${v.corps.id}/retours`, { motif: "Savon abîmé à l'achat", lignes: [{ ligneId: ligne.id, quantite: 2, destination: "vente" }], remboursements: [{ moyen: "especes", montant: 10_000 }] });
    expect(r.statut).toBe(201);
    expect(await stockDe(o, o.savon)).toEqual({ q: 167, valeur: 0 });

    const a = (await o.apercu()).corps;
    expect(a).toMatchObject({ total: 99_000, anterieures: 0 });
    expect(a.lignes.map((l: { source_type: string; quantite: number; montant_du: number }) => [l.source_type, l.quantite, l.montant_du]).sort())
      .toEqual([["comptoir", 30, 90_000], ["facture", 5, 15_000], ["retour", -2, -6_000]].sort());
    expect(a.lignes.reduce((s: number, l: { quantite: number }) => s + l.quantite, 0)).toBe(33);
    const liste = (await o.api("GET", `/depots-vente?brancheId=${o.G}`)).corps;
    expect(liste).toMatchObject([{ produit_id: o.savon, fournisseur: "Atelier Bonamoussadi", actif: true, remuneration: { mode: "prix_fixe", prix_reversement: 3000 }, stock: [{ lieu: "Akwa", quantite: 167 }], du_non_releve: 99_000 }]);

    // La marge du rapport des ventes de caisse : ventes HT moins ce qui est reversé au fournisseur (Q15).
    const rapport = (await o.api("GET", `/rapports/ventes-stock?du=${aujourdhui()}&au=${aujourdhui()}`)).corps;
    expect(rapport.marges.find((x: { code: string }) => x.code === "SAVON")).toMatchObject({ quantite: 28, ventes_ht: 140_000, cout: 84_000, marge: 56_000 });
  });

  it("reverse le prix encaissé moins la commission, remise comprise (Q11)", async () => {
    const o = await depotVente();
    const pagne = await o.article("PAGNE", { prixVente: 10_000, tauxTaxe: 0 });
    expect((await o.declarer(pagne, { mode: "commission", commissionPct: 25 })).statut).toBe(201);
    expect((await o.declarer(o.savon, { mode: "commission" })).corps.erreur).toBe("donnees_invalides");
    await o.entrer(pagne, 10);
    const v = await o.api("POST", "/caisse/ventes", { entiteId: o.lieu, lignes: [{ produitId: pagne, quantite: 1, remisePct: 10 }], paiements: [{ moyen: "especes", montant: 9000 }] });
    expect(v.corps.total_ttc).toBe(9000);
    expect((await o.apercu()).corps).toMatchObject({ total: 6750, lignes: [{ source_type: "comptoir", montant_ht: 9000, montant_du: 6750 }] });
  });

  it("établit le relevé une seule fois et facture le fournisseur en brouillon (Q12)", async () => {
    const o = await depotVente();
    await o.declarer(o.savon, { mode: "prix_fixe", prixReversement: 3000 });
    // Le dépôt date de dix jours : une vente hors connexion d'il y a trois jours a donc une rémunération.
    await o.sql("update remunerations_depot set depuis_le = depuis_le - interval '10 days' where organisation_id = org_courante() and produit_id = $1", [o.savon]);
    await o.entrer(o.savon, 200);
    expect((await o.releve()).corps.erreur).toBe("releve_vide");
    await o.vendre(o.savon, 30, 150_000);
    await o.facturer(o.savon, 3);
    const hier = new Date(Date.now() + 3600_000 - 86_400_000).toISOString().slice(0, 10);
    const demain = new Date(Date.now() + 3600_000 + 86_400_000).toISOString().slice(0, 10);
    expect((await o.apercu(aujourdhui(), demain)).corps.erreur).toBe("periode_invalide");
    expect((await o.apercu(aujourdhui(), hier)).corps.erreur).toBe("periode_invalide");
    expect((await o.apercu(hier, hier)).corps.total).toBe(0);

    const r = await o.releve();
    expect(r.statut).toBe(201);
    expect(r.corps.releve).toMatchObject({ numero: expect.stringMatching(/^RDV-\d{4}-000001$/), total_du: 99_000, lignes: 2, fournisseur_id: o.local, branche_id: o.G });
    expect(r.corps.facture).toMatchObject({ statut: "brouillon", total_ttc: 99_000 });
    const f = (await o.api("GET", `/fournisseurs/factures/${r.corps.facture.id}`)).corps;
    expect(f).toMatchObject({ numero_fournisseur: r.corps.releve.numero, fournisseur_id: o.local, total_ht: 99_000, total_taxes: 0, commande_id: null });
    expect(f.lignes).toEqual([expect.objectContaining({ compte_numero: "6011", montant_ht: 99_000, montant_taxes: 0 })]);
    // Aucune vente n'est relevée deux fois.
    expect((await o.releve()).corps.erreur).toBe("releve_vide");
    expect((await o.apercu()).corps).toMatchObject({ total: 0, lignes: [] });

    // Une vente plus récente entre dans le relevé suivant ; une vente oubliée d'un jour antérieur est signalée et entre aussi.
    await o.vendre(o.savon, 2, 10_000);
    const ilYA3Jours = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect((await o.vendre(o.savon, 1, 5000, { horsLigne: true, vendueLe: ilYA3Jours, cleAppareil: crypto.randomUUID() })).statut).toBe(201);
    expect((await o.apercu()).corps).toMatchObject({ total: 9000, anterieures: 1 });
    const suivant = await o.releve();
    expect(suivant.corps.releve).toMatchObject({ numero: expect.stringMatching(/000002$/), total_du: 9000, lignes: 2 });
    expect((await o.api("GET", `/depots-vente/releves?brancheId=${o.G}`)).corps.map((x: { total_du: number; facture_statut: string }) => [x.total_du, x.facture_statut]))
      .toEqual([[9000, "brouillon"], [99_000, "brouillon"]]);
    const { rows } = await o.sql("select count(*)::int as n, count(distinct (source_type, source_id))::int as d from lignes_releve_depot where organisation_id = org_courante()");
    expect(rows[0]).toEqual({ n: 4, d: 4 });
  });

  it("garde la rémunération du jour de chaque vente (Q13)", async () => {
    const o = await depotVente();
    await o.declarer(o.savon, { mode: "prix_fixe", prixReversement: 3000 });
    await o.entrer(o.savon, 50);
    await o.vendre(o.savon, 2, 10_000);
    expect((await o.api("POST", `/depots-vente/${o.savon}/remuneration`, { mode: "prix_fixe", prixReversement: 3500 })).corps).toEqual({ enregistre: true });
    await o.vendre(o.savon, 1, 5000);
    await o.api("POST", `/depots-vente/${o.savon}/remuneration`, { mode: "commission", commissionPct: 20 });
    await o.vendre(o.savon, 1, 5000);
    const a = (await o.apercu()).corps;
    expect(a.lignes.map((l: { montant_du: number }) => l.montant_du)).toEqual([6000, 3500, 4000]);
    expect(a.total).toBe(13_500);
    const magasinier = await o.compte("magasinier", o.lieu);
    expect((await o.api("POST", `/depots-vente/${o.savon}/remuneration`, { mode: "prix_fixe", prixReversement: 1 }, magasinier.jeton)).statut).toBe(403);
  });

  it("n'achète jamais un article en dépôt-vente, rend les invendus et clôt le dépôt sans stock (Q14)", async () => {
    const o = await depotVente();
    await o.declarer(o.savon, { mode: "prix_fixe", prixReversement: 3000 });
    expect((await o.declarer(o.savon, { mode: "prix_fixe", prixReversement: 3000 })).corps.erreur).toBe("existe_deja");
    const commande = (produitId: string) => o.api("POST", "/achats/commandes", { entiteId: o.depot, fournisseurId: o.fournisseurId, date: aujourdhui(), lignes: [{ produitId, quantite: 1, prixUnitaire: 1000 }] });
    expect((await commande(o.savon)).corps).toMatchObject({ erreur: "article_en_depot_vente", details: { produitId: o.savon } });
    // Un article déjà acheté (en stock ou commandé) ne passe pas en dépôt-vente.
    await o.api("POST", "/stocks/mouvements", { entiteId: o.depot, produitId: o.produitId, type: "entree", quantite: 5, coutUnitaire: 1000 });
    expect((await o.declarer(o.produitId, { mode: "prix_fixe", prixReversement: 1 })).corps.erreur).toBe("article_deja_achete");
    const commandee = await o.article("THERMOS");
    expect((await commande(commandee)).statut).toBe(201);
    expect((await o.declarer(commandee, { mode: "prix_fixe", prixReversement: 1 })).corps.erreur).toBe("article_deja_achete");

    await o.entrer(o.savon, 30);
    await o.vendre(o.savon, 10, 50_000);
    const retour = (quantite: number) => o.api("POST", `/depots-vente/${o.savon}/retours`, { lieuId: o.lieu, quantite });
    expect((await retour(21)).corps.erreur).toBe("stock_insuffisant");
    expect((await retour(19)).statut).toBe(201);
    expect((await o.apercu()).corps.total).toBe(30_000);
    expect((await o.api("POST", `/depots-vente/${o.savon}/fin`)).corps.erreur).toBe("stock_restant");
    await retour(1);
    expect((await o.api("POST", `/depots-vente/${o.savon}/fin`)).corps).toEqual({ actif: false });
    expect((await o.entrer(o.savon, 1)).corps.erreur).toBe("depot_inactif");
    expect((await o.api("POST", `/depots-vente/${o.savon}/remuneration`, { mode: "prix_fixe", prixReversement: 1 })).corps.erreur).toBe("depot_inactif");
    // Les ventes passées restent dues et le dépôt peut reprendre.
    expect((await o.apercu()).corps.total).toBe(30_000);
    expect((await o.declarer(o.savon, { mode: "prix_fixe", prixReversement: 2500 })).statut).toBe(201);
    const { rows } = await o.sql("select motif from mouvements_stock where produit_id = $1 order by cree_le", [o.savon]);
    expect(rows.map((r) => r.motif)).toEqual(["Dépôt-vente : Atelier Bonamoussadi", null, "Retour au déposant", "Retour au déposant"]);
  });

  it("reste invisible depuis GTA et une autre organisation", async () => {
    const o = await depotVente();
    await o.declarer(o.savon, { mode: "prix_fixe", prixReversement: 3000 });
    await o.entrer(o.savon, 10);
    await o.vendre(o.savon, 1, 5000);
    const gta = await o.compte("comptabilite", o.entites.GTA);
    const comptableGta = await o.compte("comptable", o.entites.GTA);
    expect((await o.api("GET", `/depots-vente?brancheId=${o.G}`, undefined, gta.jeton)).statut).toBe(403);
    // GTA n'a pas le module de stock : ses collaborateurs n'y ont aucun droit de stock ni d'achat.
    expect((await o.api("GET", `/depots-vente?brancheId=${o.entites.GTA}`, undefined, gta.jeton)).statut).toBe(403);
    expect((await o.apercu(aujourdhui(), aujourdhui(), o.local, comptableGta.jeton)).statut).toBe(403);
    expect((await o.api("GET", `/depots-vente/releves?brancheId=${o.G}`, undefined, comptableGta.jeton)).statut).toBe(403);
    expect((await o.declarer(o.savon, { mode: "prix_fixe", prixReversement: 1 }, o.local, gta.jeton)).statut).toBe(403);
    const ailleurs = await env.nouvelleOrganisation();
    expect((await env.api("POST", `/depots-vente/${o.savon}/entrees`, ailleurs.jeton, { lieuId: o.lieu, quantite: 1 })).statut).toBe(404);
    expect((await env.api("GET", `/depots-vente/releves/apercu?fournisseurId=${o.local}&du=${aujourdhui()}&au=${aujourdhui()}`, ailleurs.jeton)).statut).toBe(404);
  });
});
