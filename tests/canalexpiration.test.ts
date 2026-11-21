import { afterAll, describe, expect, it } from "vitest";
import { boutique, commander, corpsCommande, suivre } from "./canaloutils.js";
import { environnement } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
const echue = "update commandes_web set expire_le = now() - interval '1 minute'";

describe("canal en ligne : libération automatique du stock", () => {
  it("expire une commande échue une seule fois et rend son stock", async () => {
    const b = await boutique(env);
    const p = await b.article("FER", 15000, 0, 1);
    const r = await commander(env, b.org, corpsCommande(b, [{ produitId: p, quantite: 1 }], { moyenPaiement: "mtn_momo" }));
    expect(r.statut).toBe(201);
    expect(await b.dispo(p)).toBe(0);
    await b.sql(`${echue} where reference = $1`, [r.corps.reference]);
    await env.app.executerTaches(b.org);
    await env.app.executerTaches(b.org);
    expect((await suivre(env, b.org, r.corps)).corps.statut).toBe("expiree");
    expect(await b.dispo(p)).toBe(1);
    const ev = await b.sql("select charge from evenements where organisation_id = org_courante() and type = 'commande_web.expiree'");
    expect(ev.rows).toEqual([{ charge: expect.objectContaining({ reference: r.corps.reference }) }]);
  });

  it("libère la dernière pièce échue dès la commande suivante, sans attendre la tâche", async () => {
    const b = await boutique(env);
    const p = await b.article("PNEU", 30000, 0, 1);
    const r = await commander(env, b.org, corpsCommande(b, [{ produitId: p, quantite: 1 }], { moyenPaiement: "orange_money" }));
    await b.sql(`${echue} where reference = $1`, [r.corps.reference]);
    const s = await commander(env, b.org, corpsCommande(b, [{ produitId: p, quantite: 1 }], { telephone: "677000002" }));
    expect(s.statut).toBe(201);
    expect((await suivre(env, b.org, r.corps)).corps.statut).toBe("expiree");
  });

  it("n'expire ni une commande confirmée ni celle d'une autre organisation", async () => {
    const b = await boutique(env);
    const p = await b.article("FRIGO", 200000, 0, 2);
    const cod = await commander(env, b.org, corpsCommande(b, [{ produitId: p, quantite: 1 }]));
    const id = (await b.sql("select id from commandes_web where reference = $1", [cod.corps.reference])).rows[0].id;
    expect((await b.api("POST", `/commandes-web/${id}/confirmer`)).statut).toBe(200);

    const autre = await boutique(env);
    const q = await autre.article("FRIGO", 200000, 0, 1);
    const a = await commander(env, autre.org, corpsCommande(autre, [{ produitId: q, quantite: 1 }], { moyenPaiement: "orange_money" }));
    await b.sql(echue);
    await autre.sql(echue);
    await env.app.executerTaches(b.org);
    expect((await suivre(env, b.org, cod.corps)).corps.statut).toBe("reservee");
    expect(await b.dispo(p)).toBe(1);
    expect((await suivre(env, autre.org, a.corps)).corps.statut).toBe("reservee");
  });
});
