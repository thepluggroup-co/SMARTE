import { afterAll, describe, expect, it } from "vitest";
import { boutique, commander, corpsCommande, suivre, utilisateur } from "./canaloutils.js";
import { environnement } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);

describe("canal en ligne : traitement par le personnel", () => {
  it("liste, confirme avec un colis à encaisser au nom de la branche, puis annule", async () => {
    const b = await boutique(env);
    const p = await b.article("MIXEUR", 25000, 0, 3);
    const r = await commander(env, b.org, corpsCommande(b, [{ produitId: p, quantite: 2 }]));
    const liste = (await b.api("GET", "/commandes-web")).corps;
    expect(liste).toEqual([expect.objectContaining({ reference: r.corps.reference, statut: "reservee", lieu: "GLOMARI Mall Douala", total_ttc: 51000, colis_id: null })]);
    const id = liste[0].id as string;
    const detail = (await b.api("GET", `/commandes-web/${id}`)).corps;
    expect(detail).toMatchObject({ client: "Jean Mbarga", zone: "Akwa", colis: null, moyen_paiement: "a_la_livraison" });
    expect(detail.lignes).toEqual([expect.objectContaining({ produit_id: p, quantite: 2, total_ttc: 50000 })]);

    const c = await b.api("POST", `/commandes-web/${id}/confirmer`);
    expect(c.statut).toBe(200);
    const colis = (await b.api("GET", "/colis")).corps.find((x: { id: string }) => x.id === c.corps.colis.id);
    expect(colis).toMatchObject({ entite_id: b.G, a_encaisser: 51000, zone: "Akwa", destinataire: "Jean Mbarga" });
    expect((await suivre(env, b.org, r.corps)).corps.colis).toMatchObject({ statut: "prepare" });
    expect((await b.api("POST", `/commandes-web/${id}/confirmer`)).corps.erreur).toBe("commande_non_modifiable");

    await b.sql("update commandes_web set expire_le = now() - interval '1 minute' where id = $1", [id]);
    await env.app.executerTaches(b.org);
    expect((await b.api("GET", `/commandes-web/${id}`)).corps.statut).toBe("reservee");
    expect(await b.dispo(p)).toBe(1);

    expect((await b.api("POST", `/commandes-web/${id}/annuler`, {})).statut).toBe(400);
    expect((await b.api("POST", `/commandes-web/${id}/annuler`, { motif: "Client injoignable" })).corps).toEqual({ statut: "annulee" });
    expect(await b.dispo(p)).toBe(3);
    expect((await b.api("POST", `/commandes-web/${id}/annuler`, { motif: "Encore" })).corps.erreur).toBe("commande_non_modifiable");
  });

  it("ne confirme ni un paiement en ligne ni une commande échue", async () => {
    const b = await boutique(env);
    const p = await b.article("FOUR", 90000, 0, 3);
    const om = await commander(env, b.org, corpsCommande(b, [{ produitId: p, quantite: 1 }], { moyenPaiement: "orange_money" }));
    const cod = await commander(env, b.org, corpsCommande(b, [{ produitId: p, quantite: 1 }], { telephone: "677000003" }));
    const id = async (ref: string) => (await b.sql("select id from commandes_web where reference = $1", [ref])).rows[0].id as string;
    expect((await b.api("POST", `/commandes-web/${await id(om.corps.reference)}/confirmer`)).corps.erreur).toBe("confirmation_impossible");
    const idCod = await id(cod.corps.reference);
    await b.sql("update commandes_web set expire_le = now() - interval '1 minute' where id = $1", [idCod]);
    expect((await b.api("POST", `/commandes-web/${idCod}/confirmer`)).corps.erreur).toBe("commande_non_modifiable");
  });

  it("cloisonne par droit et par organisation", async () => {
    const b = await boutique(env);
    const p = await b.article("BOL", 500, 0, 2);
    const r = await commander(env, b.org, corpsCommande(b, [{ produitId: p, quantite: 1 }]));
    const id = (await b.sql("select id from commandes_web where reference = $1", [r.corps.reference])).rows[0].id as string;
    const magasinier = await utilisateur(env, b.o, "magasinier", b.G);
    expect((await env.api("GET", "/commandes-web", magasinier)).statut).toBe(403);
    expect((await env.api("POST", `/commandes-web/${id}/annuler`, magasinier, { motif: "Pas mon rôle" })).statut).toBe(403);
    const autre = await env.nouvelleOrganisation();
    expect((await env.api("GET", `/commandes-web/${id}`, autre.jeton)).statut).toBe(404);
    expect((await env.api("POST", `/commandes-web/${id}/annuler`, autre.jeton, { motif: "Intrusion" })).statut).toBe(404);
    expect((await env.api("GET", "/commandes-web", autre.jeton)).corps).toEqual([]);
  });
});
