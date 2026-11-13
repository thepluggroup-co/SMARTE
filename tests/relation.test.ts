import { afterAll, describe, expect, it } from "vitest";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;

const client = async (o: Org, nom = "Awa", extra = {}) =>
  (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom, ignorerDoublons: true, ...extra })).corps.id as string;

async function utilisateur(o: Org, code: string, entiteId?: string) {
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
  const r = await env.api("POST", "/utilisateurs", o.jeton, {
    email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((x: { code: string }) => x.code === code).id,
  });
  expect(r.statut).toBe(201);
  return { id: r.corps.id as string, jeton: await env.connecter(o.slug, email) };
}

const opportunite = async (o: Org, tiersId: string, jeton = o.jeton) =>
  env.api("POST", "/opportunites", jeton, { entiteId: o.entites.GTA, tiersId, titre: "Formation", montantEstime: 120000, source: "Facebook" });

describe("fiche client", () => {
  it("se modifie, détecte les doublons et reste archivable", async () => {
    const o = await env.nouvelleOrganisation();
    await client(o, "Autre", { telephone: "699000001" });
    const id = await client(o);
    const url = `/tiers/${id}`;
    expect((await env.api("PATCH", url, o.jeton, { telephone: "+237 699 000 001" })).corps.erreur).toBe("doublon_probable");
    const r = await env.api("PATCH", url, o.jeton, { nom: "Awa Mballa", telephone: "677000000", email: "AWA@test.cm" });
    expect(r.corps).toMatchObject({ nom: "Awa Mballa", telephone: "237677000000", email: "awa@test.cm" });
    expect((await env.api("PATCH", url, o.jeton, { roles: ["pirate"] })).statut).toBe(400);
    expect((await env.api("PATCH", url, o.jeton, { telephone: null })).corps.telephone).toBeNull();
    await env.api("PATCH", url, o.jeton, { archive: true });
    expect((await env.api("GET", "/tiers?q=Mballa", o.jeton)).corps).toEqual([]);
  });

  it("montre un historique limité à ce que l'utilisateur a le droit de voir", async () => {
    const o = await env.nouvelleOrganisation();
    const id = await client(o);
    const op = await opportunite(o, id);
    await env.api("POST", "/activites", o.jeton, { opportuniteId: op.corps.id, type: "appel", contenu: "Rappeler lundi" });
    await env.api("POST", "/tickets", o.jeton, { entiteId: o.entites.GTA, tiersId: id, sujet: "Accès", message: "Problème" });
    const genres = async (j: string) =>
      (await env.api("GET", `/tiers/${id}/chronologie`, j)).corps.map((c: { genre: string }) => c.genre).sort();
    expect(await genres(o.jeton)).toEqual(["activite", "opportunite", "ticket"]);
    expect(await genres((await utilisateur(o, "commercial", o.entites.GTA)).jeton)).toEqual(["activite", "opportunite"]);
    expect(await genres((await utilisateur(o, "service_client", o.entites.GTA)).jeton)).toEqual(["ticket"]);
    const ailleurs = await utilisateur(o, "commercial", o.entites.GLOMARI);
    expect((await env.api("GET", `/tiers/${id}/chronologie`, ailleurs.jeton)).statut).toBe(404);
  });
});

describe("suivi commercial", () => {
  it("suit une opportunité jusqu'à la conversion du prospect en client", async () => {
    const o = await env.nouvelleOrganisation();
    const id = await client(o);
    const op = await opportunite(o, id);
    expect(op.statut).toBe(201);
    expect((await env.api("GET", `/tiers/${id}`, o.jeton)).corps.roles).toEqual(["prospect"]);
    const url = `/opportunites/${op.corps.id}`;
    await env.api("PATCH", url, o.jeton, { etape: "proposition" });
    let liste = (await env.api("GET", "/opportunites", o.jeton)).corps;
    expect(liste.etapes.find((e: { etape: string }) => e.etape === "proposition")).toEqual({ etape: "proposition", nombre: 1, montant: 120000 });
    expect(liste.taux_conversion).toBeNull();
    const g = await env.api("PATCH", url, o.jeton, { etape: "gagne" });
    expect(g.corps.clos_le).toBeTruthy();
    expect((await env.api("GET", `/tiers/${id}`, o.jeton)).corps.roles).toEqual(["client"]);

    const perdue = await opportunite(o, await client(o, "Paul"));
    const urlPerdue = `/opportunites/${perdue.corps.id}`;
    expect((await env.api("PATCH", urlPerdue, o.jeton, { etape: "perdu" })).corps.erreur).toBe("motif_obligatoire");
    expect((await env.api("PATCH", urlPerdue, o.jeton, { etape: "perdu", motifPerte: "Budget" })).statut).toBe(200);
    liste = (await env.api("GET", "/opportunites", o.jeton)).corps;
    expect(liste.taux_conversion).toBe(50);
    const reprise = await env.api("PATCH", urlPerdue, o.jeton, { etape: "contacte" });
    expect(reprise.corps).toMatchObject({ motif_perte: null, clos_le: null });
  });

  it("respecte les droits, les entités et le module", async () => {
    const o = await env.nouvelleOrganisation();
    const id = await client(o);
    const glomari = await utilisateur(o, "commercial", o.entites.GLOMARI);
    expect((await opportunite(o, id, glomari.jeton)).statut).toBe(403);
    const op = await opportunite(o, id);
    expect((await env.api("GET", "/opportunites", glomari.jeton)).corps.opportunites).toEqual([]);
    expect((await env.api("PATCH", `/opportunites/${op.corps.id}`, glomari.jeton, { etape: "gagne" })).statut).toBe(403);
    const formateur = await utilisateur(o, "formateur", o.entites.GTA);
    expect((await env.api("GET", "/opportunites", formateur.jeton)).statut).toBe(403);
    await env.api("PUT", `/entites/${o.entites.GTA}/modules/crm`, o.jeton, { actif: false });
    expect((await opportunite(o, id)).corps.erreur).toBe("module_inactif");
  });
});

describe("service client", () => {
  it("suit un ticket, avec numéro, délai, échanges et résolution", async () => {
    const o = await env.nouvelleOrganisation();
    const id = await client(o);
    const k = await env.api("POST", "/tickets", o.jeton, {
      entiteId: o.entites.GTA, tiersId: id, sujet: "Certificat", message: "Non reçu", priorite: "haute",
    });
    expect(k.corps.numero).toMatch(/^TIC-\d{4}-000001$/);
    const heures = (Date.parse(k.corps.echeance) - Date.parse(k.corps.cree_le)) / 3600000;
    expect(heures).toBeCloseTo(4, 1);
    const url = `/tickets/${k.corps.id}`;
    await env.api("POST", `${url}/messages`, o.jeton, { contenu: "Renvoyé par WhatsApp" });
    expect((await env.api("GET", url, o.jeton)).corps.messages.map((m: { contenu: string }) => m.contenu)).toEqual(["Non reçu", "Renvoyé par WhatsApp"]);
    const r = await env.api("PATCH", url, o.jeton, { statut: "resolu", assigneA: o.adminId });
    expect(r.corps.resolu_le).toBeTruthy();
    expect((await env.api("PATCH", url, o.jeton, { statut: "ouvert" })).corps.resolu_le).toBeNull();
  });

  it("signale un ticket en retard et recalcule le délai si la priorité change", async () => {
    const o = await env.nouvelleOrganisation();
    const k = await env.api("POST", "/tickets", o.jeton, { entiteId: o.entites.GTA, tiersId: await client(o), sujet: "S", message: "M" });
    const r = await env.api("PATCH", `/tickets/${k.corps.id}`, o.jeton, { priorite: "basse" });
    expect((Date.parse(r.corps.echeance) - Date.parse(r.corps.cree_le)) / 3600000).toBeCloseTo(72, 1);
    expect((await env.api("GET", "/tickets", o.jeton)).corps[0].en_retard).toBe(false);
    const { dansOrganisation } = await import("../src/base.js");
    await dansOrganisation(env.poolAdmin, o.organisationId, (c) => c.query("update tickets set echeance = now() - interval '1 hour'"));
    expect((await env.api("GET", "/tickets", o.jeton)).corps[0].en_retard).toBe(true);
  });

  it("le numéro n'est pas consommé par un refus et les droits sont respectés", async () => {
    const o = await env.nouvelleOrganisation();
    const id = await client(o);
    const corps = { entiteId: o.entites.GTA, tiersId: id, sujet: "S", message: "M" };
    const fx = await utilisateur(o, "formateur", o.entites.GTA);
    expect((await env.api("POST", "/tickets", fx.jeton, corps)).statut).toBe(403);
    expect((await env.api("POST", "/tickets", o.jeton, { ...corps, assigneA: "00000000-0000-4000-8000-000000000000" })).statut).toBe(400);
    expect((await env.api("POST", "/tickets", o.jeton, corps)).corps.numero).toMatch(/000001$/);
  });
});

describe("tâches", () => {
  it("l'assigné voit et termine sa tâche, sans voir celles des autres", async () => {
    const o = await env.nouvelleOrganisation();
    const a = await utilisateur(o, "formateur", o.entites.GTA);
    const b = await utilisateur(o, "formateur", o.entites.GTA);
    const t = await env.api("POST", "/taches", o.jeton, {
      entiteId: o.entites.GTA, titre: "Préparer la salle", assigneA: a.id, echeance: "2020-01-01",
    });
    expect(t.statut).toBe(201);
    expect((await env.api("GET", "/taches", a.jeton)).corps[0]).toMatchObject({ titre: "Préparer la salle", en_retard: true });
    expect((await env.api("GET", "/taches", b.jeton)).corps).toEqual([]);
    expect((await env.api("PATCH", `/taches/${t.corps.id}`, b.jeton, { statut: "terminee" })).statut).toBe(403);
    const fin = await env.api("PATCH", `/taches/${t.corps.id}`, a.jeton, { statut: "terminee" });
    expect(fin.corps.termine_le).toBeTruthy();
    expect((await env.api("GET", "/taches", a.jeton)).corps[0].en_retard).toBe(false);
    expect((await env.api("POST", "/taches", a.jeton, { entiteId: o.entites.GTA, titre: "Non permis" })).statut).toBe(403);
  });
});

describe("isolation entre clients", () => {
  it("rien n'est visible ni modifiable depuis un autre client", async () => {
    const a = await env.nouvelleOrganisation();
    const b = await env.nouvelleOrganisation();
    const id = await client(b);
    const op = await opportunite(b, id);
    const k = await env.api("POST", "/tickets", b.jeton, { entiteId: b.entites.GTA, tiersId: id, sujet: "Secret", message: "M" });
    const t = await env.api("POST", "/taches", b.jeton, { entiteId: b.entites.GTA, titre: "Secret" });
    for (const [m, u, c] of [
      ["PATCH", `/tiers/${id}`, { nom: "X" }], ["GET", `/tiers/${id}/chronologie`, undefined],
      ["PATCH", `/opportunites/${op.corps.id}`, { etape: "gagne" }], ["GET", `/tickets/${k.corps.id}`, undefined],
      ["POST", `/tickets/${k.corps.id}/messages`, { contenu: "X" }], ["PATCH", `/taches/${t.corps.id}`, { statut: "annulee" }],
    ] as const) {
      expect((await env.api(m, u, a.jeton, c)).statut, u).toBe(404);
    }
    expect((await env.api("GET", "/opportunites", a.jeton)).corps.opportunites).toEqual([]);
    expect((await env.api("GET", "/tickets", a.jeton)).corps).toEqual([]);
    expect((await env.api("GET", "/taches", a.jeton)).corps).toEqual([]);
    expect((await env.api("GET", "/collaborateurs", a.jeton)).corps.map((c: { id: string }) => c.id)).toEqual([a.adminId]);
    expect((await env.api("POST", "/opportunites", a.jeton, { entiteId: a.entites.GTA, tiersId: id, titre: "X" })).statut).toBe(404);
    expect((await env.api("POST", "/taches", a.jeton, { entiteId: a.entites.GTA, titre: "X", assigneA: b.adminId })).statut).toBe(400);
  });
});
