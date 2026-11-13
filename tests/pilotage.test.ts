import { afterAll, describe, expect, it } from "vitest";
import { avancement, commission, transitionPermise } from "../src/pilotage.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
async function compte(o: Org, code: string, entiteId: string) {
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
  await env.api("POST", "/utilisateurs", o.jeton, { email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((x: { code: string }) => x.code === code).id });
  return env.connecter(o.slug, email);
}

describe("calculs", () => {
  it("borne l'avancement, y compris pour une cible à la baisse", () => {
    expect(avancement(0, 100, 25)).toBe(25);
    expect(avancement(0, 100, 150)).toBe(100);
    expect(avancement(100, 50, 75)).toBe(50);
    expect(avancement(0, 100, -5)).toBe(0);
  });
  it("limite les étapes d'un colis et calcule la commission", () => {
    expect(transitionPermise("prepare", "expedie")).toBe(true);
    expect(transitionPermise("livre", "en_transit")).toBe(false);
    expect(transitionPermise("retour", "en_livraison")).toBe(false);
    expect(commission(10000, 7.5)).toBe(750);
  });
});

describe("pilotage", () => {
  it("aligne les objectifs du groupe vers les branches et cloisonne les entités", async () => {
    const o = await env.nouvelleOrganisation();
    const groupe = await env.api("POST", "/objectifs", o.jeton, { entiteId: o.entites.SGC, titre: "Croître", periode: "2026-T4", resultats: [{ libelle: "Ventes", cible: 100 }] });
    expect(groupe.statut).toBe(201);
    const fille = await env.api("POST", "/objectifs", o.jeton, { entiteId: o.entites.GLOMARI, parentId: groupe.corps.id, titre: "Vendre", periode: "2026-T4", resultats: [{ libelle: "CA", depart: 10, cible: 20 }, { libelle: "Clients", cible: 4 }] });
    const liste = (await env.api("GET", "/objectifs", o.jeton)).corps;
    const f = liste.find((x: { id: string }) => x.id === fille.corps.id);
    expect(f.parent_id).toBe(groupe.corps.id);
    await env.api("PATCH", `/resultats-cles/${f.resultats.find((r: { libelle: string }) => r.libelle === "CA").id}`, o.jeton, { actuel: 15 });
    expect((await env.api("GET", "/objectifs", o.jeton)).corps.find((x: { id: string }) => x.id === fille.corps.id).avancement).toBe(25);
    const gta = await compte(o, "responsable_pilotage", o.entites.GTA!);
    expect((await env.api("GET", "/objectifs", gta)).corps).toEqual([]);
    expect((await env.api("PATCH", `/resultats-cles/${f.resultats[0].id}`, gta, { actuel: 1 })).statut).toBe(403);
    expect((await env.api("POST", "/objectifs", o.jeton, { entiteId: o.entites.GTA, titre: "X", periode: "2026-T9", resultats: [{ libelle: "a", cible: 1 }] })).statut).toBe(400);
    const e = await env.nouvelleOrganisation();
    expect((await env.api("PATCH", `/resultats-cles/${f.resultats[0].id}`, e.jeton, { actuel: 1 })).statut).toBe(404);
  });

  it("suit tâches, temps et budget d'un projet, et classe les risques par score", async () => {
    const o = await env.nouvelleOrganisation();
    const p = await env.api("POST", "/projets", o.jeton, { entiteId: o.entites.GTA, nom: "Essai", budget: 1000 });
    const t = await env.api("POST", `/projets/${p.corps.id}/taches`, o.jeton, { titre: "Salle", jalon: true });
    await env.api("POST", `/taches-projet/${t.corps.id}/temps`, o.jeton, { jour: "2026-11-03", minutes: 90 });
    await env.api("PATCH", `/taches-projet/${t.corps.id}`, o.jeton, { statut: "termine" });
    expect((await env.api("POST", `/projets/${p.corps.id}/depenses`, o.jeton, { libelle: "Location", montant: 1200, jour: "2026-11-03" })).corps).toEqual({ depense: 1200, depassement: true });
    const d = (await env.api("GET", `/projets/${p.corps.id}`, o.jeton)).corps;
    expect(d.taches[0]).toMatchObject({ minutes: 90, statut: "termine", jalon: true });
    const r = (x: object) => env.api("POST", "/registre", o.jeton, { entiteId: o.entites.GTA, ...x });
    expect((await r({ type: "risque", titre: "Sans note" })).statut).toBe(400);
    await r({ type: "risque", titre: "Faible", probabilite: 1, impact: 2 });
    await r({ type: "risque", titre: "Fort", probabilite: 5, impact: 5 });
    await r({ type: "decision", titre: "Choix hébergeur" });
    const l = (await env.api("GET", "/registre", o.jeton)).corps;
    expect(l[0].titre).toBe("Fort");
    expect(l[0].score).toBe(25);
    await env.api("PATCH", `/registre/${l[0].id}`, o.jeton, { statut: "clos" });
    expect((await env.api("GET", "/registre", o.jeton)).corps.at(-1).titre).toBe("Fort");
  });
});

describe("transport", () => {
  const B = (o: Org) => o.entites.GLOMARI!;
  it("n'est pas accessible à GTA", async () => {
    const o = await env.nouvelleOrganisation();
    expect((await env.api("POST", "/colis", o.jeton, { entiteId: o.entites.GTA, destinataire: "X" })).statut).toBe(403);
  });

  it("suit un colis jusqu'à la remise de caisse, avec preuve par code et suivi public sans données privées", async () => {
    const o = await env.nouvelleOrganisation();
    const z = await env.api("POST", "/zones-livraison", o.jeton, { entiteId: B(o), nom: "Akwa", frais: 1000, delaiJours: 2 });
    const c = await env.api("POST", "/colis", o.jeton, { entiteId: B(o), destinataire: "Awa", telephone: "699000111", adresse: "Rue secrète", zoneId: z.corps.id, aEncaisser: 5000 });
    expect(c.corps.prevu_le).toBeTruthy();
    const jeton = new URL(c.corps.lien_suivi).searchParams.get("c");
    const pub = await env.api("GET", `/suivi/${jeton}`);
    expect(pub.corps.statut).toBe("prepare");
    expect(JSON.stringify(pub.corps)).not.toMatch(/secrète|699000111|Awa|5000/);
    expect((await env.api("GET", "/suivi/nimporte")).statut).toBe(404);
    const t = await env.api("POST", "/tournees", o.jeton, { entiteId: B(o), jour: "2026-11-03", livreur: "Paul", colis: [c.corps.id] });
    expect(t.statut).toBe(201);
    const livreur = await compte(o, "livreur", B(o));
    const vu = (await env.api("GET", "/colis", livreur)).corps[0];
    expect(vu.code_confirmation).toBeUndefined();
    const liv = (x: object) => env.api("POST", `/colis/${c.corps.id}/livraison`, livreur, { recuPar: "Awa", encaisse: 5000, ...x });
    const faux = c.corps.code_confirmation === "111111" ? "222222" : "111111";
    expect((await liv({ code: faux })).corps.erreur).toBe("code_incorrect");
    expect((await liv({ code: c.corps.code_confirmation, encaisse: 4000 })).corps.erreur).toBe("encaissement_incomplet");
    expect((await env.api("POST", `/colis/${c.corps.id}/etape`, livreur, { statut: "echec" })).statut).toBe(400);
    expect((await liv({ code: c.corps.code_confirmation })).corps.statut).toBe("livre");
    expect((await liv({ code: c.corps.code_confirmation })).corps.erreur).toBe("etape_impossible");
    expect((await env.api("POST", `/colis/${c.corps.id}/etape`, livreur, { statut: "en_transit" })).corps.erreur).toBe("etape_impossible");
    expect((await env.api("GET", `/suivi/${jeton}`)).corps.etapes.map((x: { statut: string }) => x.statut)).toEqual(["prepare", "en_livraison", "livre"]);
    expect((await env.api("POST", `/tournees/${t.corps.id}/remise`, livreur, { portefeuilleId: t.corps.id, compte: 1 })).statut).toBe(403);
    const w = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: B(o), nom: "Cash", type: "especes" })).corps.id;
    const remise = (x: object) => env.api("POST", `/tournees/${t.corps.id}/remise`, o.jeton, { portefeuilleId: w, ...x });
    expect((await remise({ compte: 4500 })).corps).toMatchObject({ erreur: "motif_ecart_obligatoire", details: { attendu: 5000 } });
    expect((await remise({ compte: 4500, motif: "Monnaie perdue" })).corps.ecart).toBe(-500);
    expect((await remise({ compte: 4500, motif: "Monnaie perdue" })).corps.erreur).toBe("remise_deja_faite");
    expect((await env.api("GET", `/portefeuilles/${w}/mouvements`, o.jeton)).corps.solde).toBe(4500);
    expect((await env.api("GET", "/transport/indicateurs", o.jeton)).corps).toMatchObject({ livres: 1, taux_reussite: 100 });
    const e = await env.nouvelleOrganisation();
    expect((await env.api("POST", `/colis/${c.corps.id}/livraison`, e.jeton, { code: "111111", recuPar: "X" })).statut).toBe(404);
  });

  it("calcule le coût au kilomètre de la flotte", async () => {
    const o = await env.nouvelleOrganisation();
    const v = await env.api("POST", "/vehicules", o.jeton, { entiteId: B(o), immatriculation: "lt 123 ab" });
    expect(v.corps.immatriculation).toBe("LT 123 AB");
    const f = (x: object) => env.api("POST", `/vehicules/${v.corps.id}/frais`, o.jeton, { type: "carburant", jour: "2026-11-01", ...x });
    await f({ montant: 10000, kilometrage: 1000 });
    await f({ montant: 20000, kilometrage: 1300 });
    expect((await env.api("GET", "/vehicules", o.jeton)).corps[0]).toMatchObject({ cout: 30000, kilometres: 300, cout_km: 100 });
  });
});

describe("affiliation", () => {
  async function prep(joursRetour = 0) {
    const o = await env.nouvelleOrganisation();
    const B = o.entites.GLOMARI!;
    await env.api("PATCH", `/entites/${B}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Client", entiteId: B });
    const a = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Affilié", entiteId: B });
    const af = await env.api("POST", "/affilies", o.jeton, { entiteId: B, tiersId: a.corps.id, code: "awa10", taux: 10, joursRetour });
    expect(af.corps.code).toBe("AWA10");
    const d = await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: B, tiersId: t.corps.id, date: "2026-02-01", lignes: [{ designation: "X", quantite: 1, prixUnitaire: 10000 }] });
    const em = await env.api("POST", `/documents-vente/${d.corps.id}/emission`, o.jeton);
    return { ...o, B, factureId: d.corps.id as string, numero: em.corps.numero as string };
  }
  const attribuer = (o: Awaited<ReturnType<typeof prep>>) => env.api("POST", "/affilies/ventes", o.jeton, { code: "AWA10", numeroFacture: o.numero });

  it("va de la vente au paiement, une seule fois, depuis un portefeuille suffisant", async () => {
    const o = await prep();
    const c = await attribuer(o);
    expect(c.corps).toMatchObject({ montant: 1000, statut: "en_attente" });
    expect((await attribuer(o)).statut).toBe(409);
    const payer = (w: string) => env.api("POST", `/affilies/commissions/${c.corps.id}/paiement`, o.jeton, { portefeuilleId: w, reference: "MM1" });
    const vide = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: o.B, nom: "Vide", type: "mtn_momo" })).corps.id;
    expect((await payer(vide)).corps.erreur).toBe("commission_non_validee");
    expect((await env.api("POST", `/affilies/commissions/${c.corps.id}/validation`, o.jeton)).corps).toEqual({ statut: "validee", montant: 1000 });
    expect((await payer(vide)).corps.erreur).toBe("solde_portefeuille_insuffisant");
    const plein = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: o.B, nom: "Plein", type: "mtn_momo", soldeInitial: 5000 })).corps.id;
    const gta = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: o.entites.GTA, nom: "GTA", type: "banque", soldeInitial: 5000 })).corps.id;
    expect((await payer(gta)).corps.erreur).toBe("transfert_autre_branche");
    expect((await payer(plein)).corps.statut).toBe("payee");
    expect((await payer(plein)).statut).toBe(409);
    expect((await env.api("GET", `/portefeuilles/${plein}/mouvements`, o.jeton)).corps.solde).toBe(4000);
    expect((await env.api("GET", "/affilies", o.jeton)).corps[0]).toMatchObject({ paye: 1000, ventes: 1 });
  });

  it("attend la fin de la période de retour", async () => {
    const o = await prep(365);
    const c = await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: o.B, tiersId: (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "C2", entiteId: o.B })).corps.id, date: "2100-01-01", lignes: [{ designation: "X", quantite: 1, prixUnitaire: 100 }] });
    const em = await env.api("POST", `/documents-vente/${c.corps.id}/emission`, o.jeton);
    const v = await env.api("POST", "/affilies/ventes", o.jeton, { code: "AWA10", numeroFacture: em.corps.numero });
    expect((await env.api("POST", `/affilies/commissions/${v.corps.id}/validation`, o.jeton)).corps.erreur).toBe("periode_retour_en_cours");
  });

  it("déduit un avoir de la commission, et annule si tout est repris", async () => {
    const o = await prep();
    const c = await attribuer(o);
    const av = await env.api("POST", `/factures/${o.factureId}/avoir`, o.jeton, { date: "2026-02-05", motif: "Retour partiel", lignes: [{ designation: "X", quantite: 1, prixUnitaire: 4000 }] });
    expect(av.statut).toBe(201);
    expect((await env.api("POST", `/affilies/commissions/${c.corps.id}/validation`, o.jeton)).corps).toEqual({ statut: "validee", montant: 600 });
    const o2 = await prep();
    const c2 = await attribuer(o2);
    await env.api("POST", `/factures/${o2.factureId}/avoir`, o2.jeton, { date: "2026-02-05", motif: "Retour complet" });
    expect((await env.api("POST", `/affilies/commissions/${c2.corps.id}/validation`, o2.jeton)).corps).toEqual({ statut: "annulee", montant: 0 });
  });

  it("refuse une facture d'une autre branche ou d'un autre droit", async () => {
    const o = await prep();
    const g = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Affilié G", entiteId: o.entites.GTA });
    await env.api("POST", "/affilies", o.jeton, { entiteId: o.entites.GTA, tiersId: g.corps.id, code: "GTA1", taux: 5 });
    expect((await env.api("POST", "/affilies/ventes", o.jeton, { code: "GTA1", numeroFacture: o.numero })).statut).toBe(404);
    const glo = await compte(o, "affiliation", o.entites.GLOMARI!);
    expect((await env.api("POST", "/affilies/ventes", glo, { code: "GTA1", numeroFacture: o.numero })).statut).toBe(403);
    expect((await env.api("GET", "/affilies", glo)).corps).toHaveLength(1);
  });
});
