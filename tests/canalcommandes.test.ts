import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { boutique, commander, corpsCommande, suivre } from "./canaloutils.js";
import { environnement } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);

describe("canal en ligne : commande, fiche client et réservation", () => {
  it("réserve le stock du lieu, que les sorties de stock voient aussi, et se suit par référence et jeton", async () => {
    const b = await boutique(env);
    const p = await b.article("TV", 100000, 0, 3);
    const r = await commander(env, b.org, corpsCommande(b, [{ produitId: p, quantite: 2, prix: 1 }]));
    expect(r.statut).toBe(201);
    expect(r.corps.reference).toMatch(/^WEB-[0-9]{4}-[0-9]{6}$/);
    expect(r.corps.jeton).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.corps).toMatchObject({ statut: "reservee", frais_livraison: 1000, total_ttc: 201000 });
    expect(await b.dispo(p)).toBe(1);
    const sortie = await b.api("POST", "/stocks/mouvements", { entiteId: b.lieu, produitId: p, type: "sortie", quantite: 2, motif: "Vente au comptoir" });
    expect(sortie.corps.erreur).toBe("stock_insuffisant");

    const s = await suivre(env, b.org, r.corps);
    expect(s.statut).toBe(200);
    expect(s.corps).toMatchObject({ reference: r.corps.reference, statut: "reservee", lieu: "GLOMARI Mall Douala", zone: "Akwa", colis: null });
    expect(s.corps.lignes).toEqual([{ nom: "Article TV", quantite: 2, prix_unitaire_ttc: 100000, total_ttc: 200000 }]);
    for (const cle of ["telephone", "nom_client", "adresse", "code_confirmation", "tiers_id"]) expect(s.corps).not.toHaveProperty(cle);

    expect((await suivre(env, b.org, { reference: r.corps.reference, jeton: "A".repeat(43) })).statut).toBe(404);
    const autre = await boutique(env);
    expect((await suivre(env, autre.org, r.corps)).statut).toBe(404);
  });

  it("ne vend jamais deux fois la dernière pièce", async () => {
    const b = await boutique(env);
    const p = await b.article("VELO", 50000, 0, 1);
    const [x, y] = await Promise.all([1, 2].map((i) =>
      commander(env, b.org, corpsCommande(b, [{ produitId: p, quantite: 1 }], { telephone: `69900000${i}` }))));
    expect([x!.statut, y!.statut].sort()).toEqual([201, 409]);
    expect([x!.corps.erreur, y!.corps.erreur]).toContain("stock_insuffisant");
    expect(await b.dispo(p)).toBe(0);
  });

  it("retrouve ou crée la fiche client GLOMARI par téléphone, sans reprendre celle de GTA", async () => {
    const b = await boutique(env);
    const p = await b.article("SAC", 1000, 0, 10);
    const gta = (await b.sql(
      "insert into tiers (organisation_id, type, nom, telephone, roles, branche_id) values ($1, 'personne', 'Client GTA', '237677112233', '{client}', $2) returning id",
      [b.org, b.o.entites.GTA],
    )).rows[0].id as string;
    expect((await commander(env, b.org, corpsCommande(b, [{ produitId: p, quantite: 1 }], { telephone: "677 11 22 33" }))).statut).toBe(201);
    expect((await commander(env, b.org, corpsCommande(b, [{ produitId: p, quantite: 1 }], { telephone: "+237677112233" }))).statut).toBe(201);
    const { rows } = await b.sql("select distinct tiers_id from commandes_web");
    expect(rows).toHaveLength(1);
    expect(rows[0].tiers_id).not.toBe(gta);
    const fiche = (await b.sql("select roles, branche_id, telephone from tiers where id = $1", [rows[0].tiers_id])).rows[0];
    expect(fiche).toEqual({ roles: ["client"], branche_id: b.G, telephone: "237677112233" });
  });

  it("contrôle lieu, zone, point relais, mode, téléphone et articles, et fixe l'échéance selon le paiement", async () => {
    const b = await boutique(env);
    const p = await b.article("LAMPE", 2000, 0, 5);
    const gta = (await b.sql(
      "insert into produits (organisation_id, entite_id, code, nom, suivi_stock, prix_vente) values ($1, $2, 'GTA1', 'Article GTA', true, 100) returning id",
      [b.org, b.o.entites.GTA],
    )).rows[0].id as string;
    const une = [{ produitId: p, quantite: 1 }];
    const relais = { modeLivraison: "point_relais", zoneId: undefined, adresse: undefined };
    const erreur = async (extra: object, lignes = une) => (await commander(env, b.org, corpsCommande(b, lignes, extra))).corps.erreur;
    expect(await erreur({}, [{ produitId: gta, quantite: 1 }])).toBe("introuvable");
    expect(await erreur({ zoneId: randomUUID() })).toBe("zone_invalide");
    expect(await erreur({ zoneId: undefined })).toBe("zone_invalide");
    expect(await erreur(relais)).toBe("point_relais_invalide");
    expect(await erreur({ ...relais, pointRelaisId: randomUUID() })).toBe("point_relais_invalide");
    expect(await erreur({ modeLivraison: "drone" })).toBe("mode_livraison_invalide");
    expect(await erreur({ telephone: "12345" })).toBe("telephone_invalide");
    expect(await erreur({ lieuId: b.G })).toBe("lieu_invalide");

    const om = await commander(env, b.org, corpsCommande(b, une, { ...relais, pointRelaisId: b.relaisId, moyenPaiement: "orange_money" }));
    expect(om.statut).toBe(201);
    expect(om.corps.frais_livraison).toBe(0);
    const minutes = (new Date(om.corps.expire_le).getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(28);
    expect(minutes).toBeLessThanOrEqual(30.1);
    const cod = await commander(env, b.org, corpsCommande(b, une));
    expect((new Date(cod.corps.expire_le).getTime() - Date.now()) / 3600000).toBeGreaterThan(23.9);
    expect((await suivre(env, b.org, om.corps)).corps).toMatchObject({ mode_livraison: "point_relais", point_relais: "Relais Kotto", zone: null });
  });
});
