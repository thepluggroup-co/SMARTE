import { afterAll, describe, expect, it } from "vitest";
import { environnementPaiement } from "./paiementoutils.js";
import { approuver, campagneEssai, commandeAchat, dansJours, evenements, inscrireEtPayer, suivrePrecommande } from "./precommandesoutils.js";

const env = await environnementPaiement();
afterAll(env.fermer);

describe("précommandes : suivre l'arrivage étape par étape", () => {
  it("Q16 : chaque étape du bon de commande est publiée et visible sur le lien de l'inscrit, sans fournisseur, transitaire ni note", async () => {
    const b = await campagneEssai(env, { seuil: 1 });
    const i = await inscrireEtPayer(env, b, 1);
    const bc = await commandeAchat(b);
    expect((await suivrePrecommande(env, b.org, i)).corps.etapes).toEqual([]);
    const transitaire = (await b.api("POST", "/tiers", { type: "entreprise", nom: "Transit Express Douala" })).corps.id;
    await b.api("PATCH", `/achats/commandes/${bc}`, { transitaireId: transitaire });
    expect((await approuver(env, b, bc)).statut).toBe(200);
    const jours = [dansJours(1), dansJours(2), dansJours(3)];
    for (const [n, etape] of ["expediee", "arrivee_port", "dedouanee"].entries()) {
      const r = await b.api("POST", `/achats/commandes/${bc}/etapes`, { etape, date: jours[n], note: "Conteneur de l'Usine Shenzhen, par Transit Express Douala" });
      expect(r.statut).toBe(201);
    }
    const publies = await evenements(b, "precommande.arrivage_etape");
    expect(publies.map((e) => e.etape)).toEqual(["commandee", "expediee", "arrivee_port", "dedouanee"]);
    expect(publies.slice(1).map((e) => e.date)).toEqual(jours);

    const s = (await suivrePrecommande(env, b.org, i)).corps;
    expect(s.etapes.map((e: { etape: string }) => e.etape)).toEqual(["commandee", "expediee", "arrivee_port", "dedouanee"]);
    expect(s.etapes.slice(1).map((e: { date: string }) => e.date)).toEqual(jours);
    expect(Object.keys(s.etapes[1])).toEqual(["etape", "date"]);
    expect(JSON.stringify(s)).not.toMatch(/Usine|Transit|Conteneur|40000/);
  });

  it("une étape d'un bon de commande sans campagne ne publie rien vers les précommandes", async () => {
    const b = await campagneEssai(env);
    const bc = await b.api("POST", "/achats/commandes", {
      entiteId: b.lieu, fournisseurId: b.fournisseurId, date: dansJours(0), origine: "import", lignes: [{ produitId: b.produitId, quantite: 2, prixUnitaire: 1000 }],
    });
    await approuver(env, b, bc.corps.id);
    await b.api("POST", `/achats/commandes/${bc.corps.id}/etapes`, { etape: "expediee", date: dansJours(1) });
    expect(await evenements(b, "precommande.arrivage_etape")).toEqual([]);
  });
});
