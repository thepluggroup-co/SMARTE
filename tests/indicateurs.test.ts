import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;

const PERIODE = "debut=2020-01-01&fin=2099-12-31";
async function valeurs(jeton: string, q = PERIODE) {
  const { corps } = await env.api("GET", `/tableau-de-bord?${q}`, jeton);
  return Object.fromEntries(corps.sections.flatMap((s: { indicateurs: { code: string; valeur: unknown }[] }) =>
    s.indicateurs.map((k) => [k.code, k.valeur]))) as Record<string, number | null>;
}

async function jeu(o: Org, entiteId = o.entites.GTA) {
  const p = await env.api("POST", "/programmes", o.jeton, {
    entiteId, code: `P${Math.random()}`, nom: "P",
    planPaiement: [
      { libelle: "Échue", montant: 40000, jours_apres_debut: 0 },
      { libelle: "Future", montant: 60000, jours_apres_debut: 3650 },
    ],
  });
  const s = await env.api("POST", "/sessions", o.jeton, {
    programmeId: p.corps.id, code: `S${Math.random()}`, ville: "Douala", debut: "2026-01-01", fin: "2026-12-31", capacite: 4,
  });
  const inscrire = async (nom: string) => {
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom, ignorerDoublons: true });
    return (await env.api("POST", `/sessions/${s.corps.id}/inscriptions`, o.jeton, { tiersId: t.corps.id })).corps.id as string;
  };
  return { sessionId: s.corps.id as string, a: await inscrire("A"), b: await inscrire("B") };
}

describe("tableau de bord", () => {
  it("calcule exactement les indicateurs de formation", async () => {
    const o = await env.nouvelleOrganisation();
    const { sessionId, a, b } = await jeu(o);
    await env.api("POST", `/inscriptions/${a}/paiements`, o.jeton, { montant: 50000, moyen: "especes" });
    const annule = await env.api("POST", `/inscriptions/${b}/paiements`, o.jeton, { montant: 10000, moyen: "especes" });
    await env.api("POST", `/paiements/${annule.corps.id}/annulation`, o.jeton, { motif: "Erreur de saisie" });
    await env.api("PUT", `/sessions/${sessionId}/presences`, o.jeton, { date: "2026-02-01", presents: [a] });

    const v = await valeurs(o.jeton);
    expect(v.sessions_actives).toBe(1);
    expect(v.nouveaux_inscrits).toBe(2);
    expect(v.remplissage).toBe(50);
    expect(v.encaisse).toBe(50000);
    expect(v.reste).toBe(150000);
    expect(v.retard).toBe(40000); // A a couvert son échue ; B doit encore la sienne.
    expect(v.recouvrement).toBe(25);
    expect(v.presence).toBe(50);
    expect(v.satisfaction).toBeNull();

    expect((await valeurs(o.jeton, "debut=2020-01-01&fin=2020-12-31")).encaisse).toBe(0);
  });

  it("ignore un inscrit retiré et n'invente rien sans données", async () => {
    const o = await env.nouvelleOrganisation();
    expect((await valeurs(o.jeton)).recouvrement).toBeNull();
    const { a } = await jeu(o);
    await env.api("POST", `/inscriptions/${a}/statut`, o.jeton, { statut: "annulee" });
    const v = await valeurs(o.jeton);
    expect(v.reste).toBe(100000);
    expect(v.remplissage).toBe(25);
  });

  it("calcule le commercial, le service client et les tâches", async () => {
    const o = await env.nouvelleOrganisation();
    const t = await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "C" });
    const creer = (montantEstime: number) => env.api("POST", "/opportunites", o.jeton, {
      entiteId: o.entites.GTA, tiersId: t.corps.id, titre: "O", montantEstime,
    });
    await creer(10000);
    const g = await creer(20000);
    const p = await creer(30000);
    await env.api("PATCH", `/opportunites/${g.corps.id}`, o.jeton, { etape: "gagne" });
    await env.api("PATCH", `/opportunites/${p.corps.id}`, o.jeton, { etape: "perdu", motifPerte: "Budget" });
    const k1 = await env.api("POST", "/tickets", o.jeton, { entiteId: o.entites.GTA, tiersId: t.corps.id, sujet: "S", message: "M" });
    await env.api("POST", "/tickets", o.jeton, { entiteId: o.entites.GTA, tiersId: t.corps.id, sujet: "S", message: "M" });
    await env.api("PATCH", `/tickets/${k1.corps.id}`, o.jeton, { statut: "resolu" });
    await env.api("POST", "/taches", o.jeton, { entiteId: o.entites.GTA, titre: "T", echeance: "2020-01-01" });
    // Trois opportunités pour la même personne : un seul nouveau prospect.
    const v = await valeurs(o.jeton);
    expect(v).toMatchObject({
      nouveaux_prospects: 1, portefeuille: 10000, opportunites_gagnees: 1, montant_gagne: 20000, conversion: 50,
      tickets_ouverts: 1, tickets_retard: 0, tickets_resolus: 1, respect_delais: 100,
      taches_ouvertes: 1, taches_retard: 1,
    });
    expect(v.delai_resolution).toBe(0);
    await dansOrganisation(env.poolAdmin, o.organisationId, (c) => c.query("update tickets set echeance = now() - interval '1 hour' where statut = 'ouvert' and organisation_id = org_courante()"));
    expect((await valeurs(o.jeton)).tickets_retard).toBe(1);
  });

  it("chaque indicateur porte sa définition", async () => {
    const o = await env.nouvelleOrganisation();
    const { corps } = await env.api("GET", "/tableau-de-bord", o.jeton);
    for (const s of corps.sections) for (const k of s.indicateurs) expect(k.definition.length, k.code).toBeGreaterThan(10);
    expect(corps.debut.endsWith("-01")).toBe(true);
  });

  it("filtre par entité, limite aux droits et isole les clients", async () => {
    const o = await env.nouvelleOrganisation();
    await jeu(o);
    const roles = (await env.api("GET", "/roles", o.jeton)).corps;
    const creer = async (code: string, entiteId: string) => {
      const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
      await env.api("POST", "/utilisateurs", o.jeton, {
        email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((r: { code: string }) => r.code === code).id,
      });
      return env.connecter(o.slug, email);
    };
    expect((await valeurs(o.jeton)).reste).toBe(200000);
    expect((await valeurs(o.jeton, `${PERIODE}&entiteId=${o.entites.GTA}`)).reste).toBe(200000);
    // GLOMARI vend des produits : ni formation ni montants de GTA, mais ses ventes et ses stocks.
    const g = (await env.api("GET", `/tableau-de-bord?${PERIODE}&entiteId=${o.entites.GLOMARI}`, o.jeton)).corps.sections.map((s: { code: string }) => s.code);
    expect(g).toContain("ventes");
    expect(g).not.toContain("formation");
    expect((await env.api("GET", `/tableau-de-bord?${PERIODE}&entiteId=${o.entites.GTA}`, o.jeton)).corps.sections.map((s: { code: string }) => s.code)).not.toContain("ventes");
    await env.api("PATCH", `/entites/${o.entites.GLOMARI}/identite`, o.jeton, { raisonSociale: "G", niu: "N" });
    const client = (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom: "Client", entiteId: o.entites.GLOMARI, ignorerDoublons: true })).corps.id;
    const f = await env.api("POST", "/documents-vente", o.jeton, { type: "facture", entiteId: o.entites.GLOMARI, tiersId: client, date: "2026-03-02", lignes: [{ designation: "Réfrigérateur", quantite: 1, prixUnitaire: 250000 }] });
    expect((await env.api("POST", `/documents-vente/${f.corps.id}/emission`, o.jeton)).statut).toBe(200);
    expect(await valeurs(o.jeton, `${PERIODE}&entiteId=${o.entites.GLOMARI}`)).toMatchObject({ ventes: 250000, nombre_ventes: 1, panier_moyen: 250000, ruptures: 0 });
    // La facture de GLOMARI ne passe jamais dans les chiffres de GTA.
    expect((await valeurs(o.jeton, `${PERIODE}&entiteId=${o.entites.GTA}`)).ventes).toBeUndefined();

    const caisse = await creer("caisse", o.entites.GTA!);
    const sections = (await env.api("GET", `/tableau-de-bord?${PERIODE}`, caisse)).corps.sections.map((s: { code: string }) => s.code);
    expect(sections).toEqual(["formation"]);
    const glomari = await creer("direction", o.entites.GLOMARI!);
    expect((await valeurs(glomari)).reste).toBeUndefined();

    const autre = await env.nouvelleOrganisation();
    expect((await valeurs(autre.jeton)).reste).toBe(0);
    // Une entité d'une autre organisation ne donne rien, pas même une section vide.
    expect((await valeurs(autre.jeton, `${PERIODE}&entiteId=${o.entites.GTA}`)).reste).toBeUndefined();
    expect((await env.api("GET", "/tableau-de-bord")).statut).toBe(401);
    expect((await env.api("GET", "/tableau-de-bord?debut=2026-02-01&fin=2026-01-01", o.jeton)).statut).toBe(400);
  });
});
