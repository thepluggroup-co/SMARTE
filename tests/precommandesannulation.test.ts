import { afterAll, describe, expect, it } from "vitest";
import { utilisateur } from "./canaloutils.js";
import { environnementPaiement } from "./paiementoutils.js";
import {
  avisAcompte, balayer, campagneEnBase, campagneEssai, commandeAchat, evenements, inscrire, inscrireEtPayer, inscriptionEnBase, lancerAcompte, referenceAcompte,
} from "./precommandesoutils.js";

const env = await environnementPaiement();
afterAll(env.fermer);

type Sql = (texte: string, valeurs?: unknown[]) => Promise<{ rows: Record<string, any>[] }>;
const paiement = async (b: { sql: Sql }, reference: string) =>
  (await b.sql("select p.* from paiements_en_ligne p join inscriptions_precommande i on i.id = p.inscription_id where i.reference = $1 order by p.lance_le", [reference])).rows;
const rembourser = (b: { api: (m: string, u: string, c?: object) => Promise<{ statut: number; corps: any }> }, id: string, corps: object = {}) =>
  b.api("POST", `/paiements-en-ligne/${id}/remboursement`, corps);

describe("précommandes : campagne annulée ou seuil manqué, chaque acompte remboursé une fois", () => {
  it("Q8 : à la date limite sous le seuil, la campagne est annulée d'office et le trésorier reçoit la liste", async () => {
    const b = await campagneEssai(env, { seuil: 5 });
    const a = await inscrireEtPayer(env, b, 2, "699400001");
    const c = await inscrireEtPayer(env, b, 1, "699400002");
    const attente = (await inscrire(env, b.org, b.campagne.id, { telephone: "699400003" })).corps;
    await b.sql("update campagnes_arrivage set date_limite = current_date - 2 where id = $1", [b.campagne.id]);
    await balayer(env, b.org);

    expect(await campagneEnBase(b)).toMatchObject({ statut: "annulee", motif_annulation: "Seuil non atteint à la date limite", annulee_par: null });
    for (const i of [a, c]) {
      expect(await inscriptionEnBase(b, i.reference)).toMatchObject({ statut: "a_rembourser", motif: "seuil_non_atteint" });
      expect((await paiement(b, i.reference))[0]).toMatchObject({ statut: "a_rembourser", motif: "seuil_non_atteint" });
    }
    expect((await inscriptionEnBase(b, attente.reference)).statut).toBe("annulee");
    const { rows: [t] } = await b.sql("select titre, description from taches where titre like 'Rembourser 2 acompte(s)%'");
    expect(t!.titre).toContain(b.campagne.numero);
    expect(t!.description).toContain("237699400001");
    expect(t!.description).toContain(await referenceAcompte(b, a.reference));
    expect(await evenements(b, "precommande.campagne_annulee")).toEqual([{ campagne: b.campagne.id, numero: b.campagne.numero, motif: "seuil_non_atteint" }]);
    expect((await env.api("GET", `/marketplace/${b.org}/campagnes`)).corps.campagnes).toEqual([]);
    expect((await inscrire(env, b.org, b.campagne.id, { telephone: "699400004" })).corps.erreur).toBe("campagne_close");
  });

  it("annulée par le responsable après le seuil, avant l'arrivage : remboursements préparés, bon de commande inchangé", async () => {
    const b = await campagneEssai(env, { seuil: 1 });
    const a = await inscrireEtPayer(env, b, 1);
    const bc = await commandeAchat(b);
    const r = await b.api("POST", `/precommandes/campagnes/${b.campagne.id}/annulation`, { motif: "Le fabricant ne livre plus" });
    expect(r.corps).toEqual({ statut: "annulee" });
    expect(await campagneEnBase(b)).toMatchObject({ statut: "annulee", motif_annulation: "Le fabricant ne livre plus", annulee_par: b.o.adminId });
    expect(await inscriptionEnBase(b, a.reference)).toMatchObject({ statut: "a_rembourser", motif: "campagne_annulee" });
    expect((await b.sql("select statut from commandes_achat where id = $1", [bc])).rows[0]!.statut).toBe("brouillon");
    expect((await b.api("POST", `/precommandes/campagnes/${b.campagne.id}/annulation`, { motif: "Encore" })).corps.erreur).toBe("campagne_non_annulable");
  });

  it("Q9 : le trésorier enregistre chaque remboursement une seule fois, depuis le bon portefeuille", async () => {
    const b = await campagneEssai(env, { seuil: 5 });
    const a = await inscrireEtPayer(env, b, 2);
    await b.api("POST", `/precommandes/campagnes/${b.campagne.id}/annulation`, { motif: "Arrivage reporté" });
    const [p] = await paiement(b, a.reference);
    const commercial = await utilisateur(env, b.o, "commercial", b.G);
    expect((await env.api("POST", `/paiements-en-ligne/${p!.id}/remboursement`, commercial, {})).statut).toBe(403);

    const r = await rembourser(b, p!.id, { referenceOperateur: "OM-RMB-0001" });
    expect(r.statut).toBe(200);
    expect(r.corps).toMatchObject({ statut: "rembourse", solde: 0 });
    const { rows: m } = await b.sql("select portefeuille_id, montant, type, reference from mouvements_portefeuille where source_id = $1 and source_type = 'remboursement_en_ligne'", [p!.id]);
    expect(m).toEqual([{ portefeuille_id: b.portefeuilles.orange_money, montant: -a.acompte, type: "sortie", reference: "OM-RMB-0001" }]);
    expect((await paiement(b, a.reference))[0]).toMatchObject({ statut: "rembourse", reference_remboursement: "OM-RMB-0001" });
    expect((await inscriptionEnBase(b, a.reference)).statut).toBe("remboursee");
    expect((await rembourser(b, p!.id)).corps.erreur).toBe("remboursement_impossible");
    // La liste des paiements en ligne montre le remboursement.
    expect((await b.api("GET", "/paiements-en-ligne?statut=rembourse")).corps.paiements).toHaveLength(1);
  });

  it("un acompte encore à placer ne se rembourse pas ; un paiement en double se rembourse sans toucher l'inscription", async () => {
    const sans = await campagneEssai(env, { seuil: 5, portefeuilles: false });
    const a = await inscrireEtPayer(env, sans, 1);
    await sans.api("POST", `/precommandes/campagnes/${sans.campagne.id}/annulation`, { motif: "Annulée" });
    expect((await rembourser(sans, (await paiement(sans, a.reference))[0]!.id)).corps.erreur).toBe("encaissement_a_placer");

    const b = await campagneEssai(env, { seuil: 5 });
    const i = (await inscrire(env, b.org, b.campagne.id)).corps;
    await lancerAcompte(env, b.org, i);
    const premier = await referenceAcompte(b, i.reference);
    await lancerAcompte(env, b.org, i);
    const second = await referenceAcompte(b, i.reference);
    await avisAcompte(env, b, i, premier);
    await avisAcompte(env, b, i, second);
    const double = (await b.sql("select id from paiements_en_ligne where reference_prestataire = $1", [second])).rows[0]!.id;
    expect((await rembourser(b, double)).statut).toBe(200);
    expect((await inscriptionEnBase(b, i.reference)).statut).toBe("validee");
  });

  it("Q10 : un client se retire avant le seuil, pas après", async () => {
    const b = await campagneEssai(env, { seuil: 5 });
    const a = await inscrireEtPayer(env, b, 2);
    const id = (await inscriptionEnBase(b, a.reference)).id;
    const r = await b.api("POST", `/precommandes/inscriptions/${id}/annulation`, { motif: "Le client a changé d'avis" });
    expect(r.corps).toEqual({ statut: "a_rembourser" });
    expect(await inscriptionEnBase(b, a.reference)).toMatchObject({ statut: "a_rembourser", motif: "retrait_client" });
    expect((await env.api("GET", `/marketplace/${b.org}/campagnes`)).corps.campagnes[0].progression).toBe(0);

    const d = await campagneEssai(env, { seuil: 1 });
    const x = await inscrireEtPayer(env, d, 1);
    const apres = await d.api("POST", `/precommandes/inscriptions/${(await inscriptionEnBase(d, x.reference)).id}/annulation`, { motif: "Trop tard" });
    expect(apres.corps.erreur).toBe("inscription_non_annulable");
  });

  it("Q11 : GTA ne voit rien et ne crée rien", async () => {
    const b = await campagneEssai(env);
    await inscrireEtPayer(env, b, 1);
    const gta = await utilisateur(env, b.o, "administrateur", b.o.entites.GTA!);
    const liste = await env.api("GET", "/precommandes/campagnes", gta);
    expect(liste).toEqual({ statut: 200, corps: [] });
    expect((await env.api("GET", `/precommandes/campagnes/${b.campagne.id}`, gta)).statut).toBe(403);
    expect((await env.api("POST", "/precommandes/campagnes", gta, { ...b.corpsCampagne, entiteId: b.o.entites.GTA })).corps.erreur).toBe("module_inactif");
    expect((await env.api("POST", "/precommandes/campagnes", gta, b.corpsCampagne)).statut).toBe(403);
    expect((await env.api("GET", "/paiements-en-ligne", gta)).corps.paiements).toEqual([]);
  });
});
