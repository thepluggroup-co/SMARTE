import { afterAll, describe, expect, it } from "vitest";
import { aDouala, environnementMessages, magasinMessages, type MM } from "./messagesoutils.js";
import { jour } from "./canaloutils.js";

const env = await environnementMessages();
afterAll(env.fermer);

const avisDe = async (b: MM, colisId: string) => (await b.enBase("avis_livraison")).find((m) => m.objet_id === colisId);
/** Le code du lien d'avis contenu dans le dernier message qui en porte un. */
const codeAvis = (b: MM) => {
  const m = b.recus().reverse().find((x) => x.texte.includes("/evaluer.html?c="));
  return m ? decodeURIComponent(m.texte.match(/evaluer\.html\?c=(\S+)/)![1]!) : null;
};

describe("demandes d'avis après livraison", () => {
  it("envoie le lien le quatorzième jour, une seule fois, pour une commande en ligne ou un colis relié à une facture (Q11)", async () => {
    const b = await magasinMessages(env);
    const payee = await b.commandePayee();
    const livraison = await b.commandeLivraison();
    const client = (await b.api("POST", "/tiers", { type: "personne", nom: "Client Facture", telephone: "677 55 44 33", entiteId: b.G })).corps.id;
    const d = await b.api("POST", "/documents-vente", { type: "facture", entiteId: b.G, tiersId: client, date: jour(), lignes: [{ produitId: b.produit, quantite: 1 }] });
    expect((await b.api("POST", `/documents-vente/${d.corps.id}/emission`, { entrepotId: b.lieu })).statut).toBe(200);
    const facture = (await b.api("POST", "/colis", { entiteId: b.G, destinataire: "Client Facture", telephone: "677 55 44 33", documentId: d.corps.id })).corps.id as string;
    const sansAchat = (await b.api("POST", "/colis", { entiteId: b.G, destinataire: "Paul Eto", telephone: "677 00 00 09" })).corps.id as string;
    for (const id of [payee.colisId, livraison.colisId, facture, sansAchat]) await b.livrer(id);

    await b.envoyer(aDouala(20, 13));
    for (const id of [payee.colisId, livraison.colisId, facture]) expect(await avisDe(b, id)).toMatchObject({ statut: "en_attente", tentatives: 0 });
    expect(await avisDe(b, sansAchat)).toBeUndefined();
    b.vider();
    expect(await b.envoyer(aDouala(10, 15))).toBe(3);
    expect(b.recus().every((m) => m.texte.includes("/evaluer.html?c="))).toBe(true);
    expect(b.recus().map((m) => m.telephone).sort()).toEqual(["237677554433", "237699000001", "237699000001"]);
    expect(await b.envoyer(aDouala(11, 15))).toBe(0);
  });

  it("n'envoie aucun lien au client qui ne souhaite pas être contacté, mais garde les messages du colis (Q12)", async () => {
    const b = await magasinMessages(env);
    const w = await b.commandePayee();
    const r = await b.api("PATCH", `/tiers/${w.tiersId}`, { nePasContacter: true });
    expect(r.corps.ne_pas_contacter).toBe(true);
    expect((await b.api("GET", `/tiers/${w.tiersId}`)).corps.ne_pas_contacter).toBe(true);
    await b.livrer(w.colisId);
    await b.envoyer(aDouala(10, 15));
    expect(await avisDe(b, w.colisId)).toMatchObject({ statut: "annule", erreur: "ne_pas_contacter" });
    expect((await b.enBase("colis_livre")).find((m) => m.objet_id === w.colisId)).toMatchObject({ statut: "envoye" });
  });

  it("fait noter chaque article une seule fois et ouvre un ticket sur une note basse (Q13)", async () => {
    const b = await magasinMessages(env);
    const lampe = await b.article("LAMPE", 5000, 0, 10);
    const autre = await b.article("AUTRE", 1000, 0, 0);
    const w = await b.commandePayee([{ produitId: b.produit, quantite: 1 }, { produitId: lampe, quantite: 2 }]);
    await b.livrer(w.colisId);
    b.vider();
    await b.envoyer(aDouala(10, 15));
    const code = codeAvis(b)!;
    expect((await env.api("GET", `/evaluer/${code}`)).corps).toEqual({
      cible: expect.stringContaining("Commande livrée"), repondu: false,
      articles: [{ produit_id: lampe, nom: "Article LAMPE" }, { produit_id: b.produit, nom: "Article VENT" }],
    });
    const noter = (corps: object) => env.api("POST", `/evaluer/${code}`, undefined, corps);
    expect((await noter({ note: 5 })).statut).toBe(400);
    expect((await noter({ notes: [{ produitId: autre, note: 4 }] })).corps.erreur).toBe("article_hors_commande");
    expect((await noter({ notes: [{ produitId: lampe, note: 4 }, { produitId: lampe, note: 3 }] })).statut).toBe(400);
    expect((await noter({ notes: [{ produitId: b.produit, note: 5, commentaire: "Très bon ventilateur" }, { produitId: lampe, note: 2 }] })).statut).toBe(201);
    expect((await noter({ notes: [{ produitId: b.produit, note: 1 }] })).corps.erreur).toBe("deja_repondu");
    expect((await env.api("GET", `/evaluer/${code}`)).corps.repondu).toBe(true);

    const { rows } = await b.sql("select produit_id, note, statut from retours_clients where organisation_id = org_courante() order by note");
    expect(rows).toEqual([{ produit_id: lampe, note: 2, statut: "publie" }, { produit_id: b.produit, note: 5, statut: "publie" }]);
    const tickets = (await b.sql("select sujet from tickets where organisation_id = org_courante() and tiers_id = $1", [w.tiersId])).rows;
    expect(tickets).toEqual([{ sujet: expect.stringMatching(/^Avis de 2\/5/) }]);
    // L'écran du marketing nomme l'article noté.
    const retours = (await b.api("GET", "/retours")).corps;
    expect(retours.avis.map((a: { cible: string; cible_type: string }) => [a.cible, a.cible_type]).sort()).toEqual([["Article LAMPE", "produit"], ["Article VENT", "produit"]]);
  });

  it("demande un avis après un achat en magasin seulement si la direction l'active (Q15)", async () => {
    const b = await magasinMessages(env);
    await b.api("POST", "/caisse/ouverture", { entiteId: b.lieu, fondOuverture: 0 });
    const client = (await b.api("POST", "/caisse/clients", { entiteId: b.lieu, nom: "Madame Ngo", telephone: "699 88 77 66" })).corps.id;
    const vendre = () => b.api("POST", "/caisse/ventes", { entiteId: b.lieu, tiersId: client, lignes: [{ produitId: b.produit, quantite: 1 }], paiements: [{ moyen: "especes", montant: 24000 }] });
    expect((await vendre()).statut).toBe(201);
    expect(await b.enBase("avis_magasin")).toEqual([]);
    expect((await b.api("PUT", "/messages/reglages", { brancheId: b.G, type: "avis_magasin", actif: true, canal: "sms" })).statut).toBe(200);
    const v = await vendre();
    expect(await b.enBase("avis_magasin")).toEqual([expect.objectContaining({ objet_id: v.corps.id, statut: "en_attente" })]);
    b.vider();
    expect(await b.envoyer(aDouala(10, 15))).toBe(1);
    expect(b.recus()[0]).toMatchObject({ telephone: "237699887766" });
    expect((await env.api("GET", `/evaluer/${codeAvis(b)}`)).corps.articles).toEqual([{ produit_id: b.produit, nom: "Article VENT" }]);
  });
});
