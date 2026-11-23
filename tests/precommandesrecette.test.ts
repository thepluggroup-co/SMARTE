import { afterAll, describe, expect, it } from "vitest";
import { environnementPaiement } from "./paiementoutils.js";
import {
  approuver, campagneEnBase, campagneEssai, choisirSolde, commandeAchat, dansJours, inscrireEtPayer, payerSolde, recevoir, suivrePrecommande,
} from "./precommandesoutils.js";

const env = await environnementPaiement();
afterAll(env.fermer);

describe("précommandes : recette d'une campagne complète", () => {
  it("de la liste d'attente à la livraison des précommandes, chaque acompte compté une fois, au franc près", async () => {
    const b = await campagneEssai(env, { seuil: 4, tauxTaxe: 19.25 });
    expect(b.campagne).toMatchObject({ prix_ttc: 85000, taux_taxe: "19.250" });

    // Liste d'attente : trois clients paient leur acompte.
    const inscrits = [await inscrireEtPayer(env, b, 1, "699800001"), await inscrireEtPayer(env, b, 2, "699800002"), await inscrireEtPayer(env, b, 1, "699800003")];
    expect((await campagneEnBase(b)).statut).toBe("declenchee");

    // L'acheteur approuve, suit l'arrivage, reçoit.
    const bc = await commandeAchat(b);
    expect((await approuver(env, b, bc)).statut).toBe(200);
    for (const [n, etape] of ["expediee", "dedouanee"].entries()) await b.api("POST", `/achats/commandes/${bc}/etapes`, { etape, date: dansJours(n + 1) });
    expect((await suivrePrecommande(env, b.org, inscrits[0]!)).corps.etapes.map((e: { etape: string }) => e.etape)).toEqual(["commandee", "expediee", "dedouanee"]);
    expect((await recevoir(b, bc, 4)).corps.statut).toBe("recue");

    // Chacun choisit sa remise et paie son solde.
    const remises = [
      { modeLivraison: "retrait_magasin" },
      { modeLivraison: "domicile", zoneId: b.zoneId, adresse: "Bonapriso, rue Njo-Njo" },
      { modeLivraison: "point_relais", pointRelaisId: b.relaisId, moyenPaiement: "mtn_momo" },
    ];
    for (const [n, i] of inscrits.entries()) {
      const s = await choisirSolde(env, b.org, i, remises[n]);
      expect(s.statut).toBe(201);
      expect((await payerSolde(env, b, s.corps.commande)).corps.statut).toBe("facturee");
    }

    expect((await campagneEnBase(b)).statut).toBe("livree");
    const { rows: factures } = await b.sql(
      `select i.reference, i.total_ttc as inscription, i.acompte, w.frais_livraison, f.total_ttc as facture,
         (select sum(montant) from reglements r where r.facture_id = f.id and r.annule_le is null)::int8 as regle,
         (select sum(montant) from reglements r where r.facture_id = f.id and r.acompte_id is not null)::int8 as impute
       from inscriptions_precommande i join commandes_web w on w.inscription_id = i.id and w.statut = 'facturee' join documents_vente f on f.id = w.facture_id
       order by i.validee_le`,
    );
    expect(factures).toHaveLength(3);
    for (const f of factures) {
      expect(f.facture).toBe(f.inscription + f.frais_livraison);
      expect(f.regle).toBe(f.facture);
      expect(f.impute).toBe(f.acompte);
    }
    const colis = (await b.sql("select count(*)::int as n from commandes_web where inscription_id is not null and colis_id is not null")).rows[0]!.n;
    expect(colis).toBe(2);

    // SC-003 : acomptes encaissés = imputés + remboursés + conservés + à rembourser + encore détenus.
    const { rows: [e] } = await b.sql(
      `select
         (select coalesce(sum(m.montant), 0) from mouvements_portefeuille m join paiements_en_ligne p on p.id = m.source_id
          where m.source_type = 'paiement_en_ligne' and m.type = 'encaissement' and p.inscription_id is not null)::int8 as encaisses,
         (select coalesce(sum(montant), 0) from reglements where acompte_id is not null and annule_le is null)::int8 as imputes,
         (select coalesce(sum(montant), 0) from paiements_en_ligne where inscription_id is not null and statut in ('a_rembourser', 'rembourse'))::int8 as a_rendre,
         (select coalesce(sum(acompte), 0) from inscriptions_precommande where statut in ('acompte_conserve', 'validee', 'servie'))::int8 as gardes`,
    );
    expect(e!.encaisses).toBe(e!.imputes + e!.a_rendre + e!.gardes);
    expect(e!.encaisses).toBe(inscrits.reduce((s, i) => s + i.acompte, 0));
    expect(await b.dispo(b.produitId)).toBe(0);
  });
});
