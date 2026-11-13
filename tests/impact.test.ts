import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;

const tiers = async (o: Org, nom: string) =>
  (await env.api("POST", "/tiers", o.jeton, { type: "personne", nom, ignorerDoublons: true })).corps.id as string;

async function utilisateur(o: Org, code: string, entiteId: string) {
  const roles = (await env.api("GET", "/roles", o.jeton)).corps;
  const email = `${code}${Math.random().toString(36).slice(2)}@test.cm`;
  await env.api("POST", "/utilisateurs", o.jeton, {
    email, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: roles.find((r: { code: string }) => r.code === code).id,
  });
  return env.connecter(o.slug, email);
}

const nouveauMentorat = async (o: Org, jeton = o.jeton) =>
  env.api("POST", "/mentorats", jeton, {
    entiteId: o.entites.GTA, mentorId: await tiers(o, "Mentor"), mentoreId: await tiers(o, "Mentoré"),
    objectif: "Lancer son activité", debut: "2026-01-01",
  });

const nouveauProjet = async (o: Org) =>
  (await env.api("POST", "/projets-sociaux", o.jeton, { entiteId: o.entites.FOUNDATION, nom: "Bourses", objectifMontant: 100000 })).corps.id as string;

describe("mentorat", () => {
  it("suit les séances jusqu'à la fin du mentorat", async () => {
    const o = await env.nouvelleOrganisation();
    const m = await nouveauMentorat(o);
    expect(m.statut).toBe(201);
    const url = `/mentorats/${m.corps.id}`;
    const seance = (corps: object) => env.api("POST", `${url}/seances`, o.jeton, corps);
    expect((await seance({ date: "2025-12-01", compteRendu: "Avant le début" })).statut).toBe(400);
    expect((await seance({ date: "2026-02-01", compteRendu: "Bon départ", progres: 6 })).statut).toBe(400);
    expect((await seance({ date: "2026-02-01", compteRendu: "Bon départ", progres: 4, prochaineAction: "Faire le budget" })).statut).toBe(201);
    const liste = (await env.api("GET", "/mentorats", o.jeton)).corps;
    expect(liste[0]).toMatchObject({ mentor: "Mentor", mentore: "Mentoré", seances: 1, derniere_seance: "2026-02-01" });
    await env.api("PATCH", url, o.jeton, { statut: "termine", fin: "2026-06-01" });
    expect((await seance({ date: "2026-07-01", compteRendu: "Après" })).corps.erreur).toBe("mentorat_inactif");
    expect((await env.api("PATCH", url, o.jeton, { fin: "2020-01-01" })).corps.erreur).toBe("dates_invalides");
  });

  it("refuse la même personne des deux côtés et le module inactif", async () => {
    const o = await env.nouvelleOrganisation();
    const id = await tiers(o, "Seul");
    const corps = { entiteId: o.entites.GTA, mentorId: id, mentoreId: id, objectif: "X", debut: "2026-01-01" };
    expect((await env.api("POST", "/mentorats", o.jeton, corps)).corps.erreur).toBe("mentor_identique");
    const glomari = await env.api("POST", "/mentorats", o.jeton, {
      ...corps, entiteId: o.entites.GLOMARI, mentoreId: await tiers(o, "Autre"),
    });
    expect(glomari.corps.erreur).toBe("permission_refusee");
  });

  it("le compte rendu n'est visible qu'avec le droit de gestion", async () => {
    const o = await env.nouvelleOrganisation();
    const m = await nouveauMentorat(o);
    await env.api("POST", `/mentorats/${m.corps.id}/seances`, o.jeton, { date: "2026-02-01", compteRendu: "Confidentiel", prochaineAction: "Privé", progres: 3 });
    const { corps: gestion } = await env.api("GET", `/mentorats/${m.corps.id}`, o.jeton);
    expect(gestion.seances[0].compte_rendu).toBe("Confidentiel");

    const lecteur = await utilisateur(o, "mentorat", o.entites.GTA!);
    expect((await env.api("GET", `/mentorats/${m.corps.id}`, lecteur)).corps.seances[0].compte_rendu).toBe("Confidentiel");

    await dansOrganisation(env.poolAdmin, o.organisationId, async (c) => {
      const r = await c.query("insert into roles (organisation_id, code, nom) values (org_courante(), 'lecture', 'Lecture') returning id");
      await c.query("insert into role_permissions (organisation_id, role_id, permission) values (org_courante(), $1, 'mentorat.voir'), (org_courante(), $1, 'entites.voir')", [r.rows[0].id]);
    });
    const lecture = await utilisateur(o, "lecture", o.entites.GTA!);
    const vue = await env.api("GET", `/mentorats/${m.corps.id}`, lecture);
    expect(vue.statut).toBe(200);
    expect(vue.corps.seances[0]).toEqual({ id: vue.corps.seances[0].id, date_seance: "2026-02-01", progres: 3 });
    expect(JSON.stringify(vue.corps)).not.toContain("Confidentiel");
    expect((await env.api("POST", `/mentorats/${m.corps.id}/seances`, lecture, { date: "2026-03-01", compteRendu: "X" })).statut).toBe(403);
  });
});

describe("GTA Foundation", () => {
  it("suit dons, aides et rapport, sans jamais distribuer plus que collecté", async () => {
    const o = await env.nouvelleOrganisation();
    const p = await nouveauProjet(o);
    const beneficiaire = await tiers(o, "Bénéficiaire");
    const don = (montant: number, x = {}) => env.api("POST", `/projets-sociaux/${p}/dons`, o.jeton, { montant, moyen: "especes", ...x });
    const aide = (montant: number) => env.api("POST", `/projets-sociaux/${p}/aides`, o.jeton, { beneficiaireId: beneficiaire, description: "Bourse", montant, date: "2026-03-01" });

    const d1 = await don(60000, { donateurId: await tiers(o, "Mécène") });
    expect(d1.corps.numero_recu).toMatch(/^DON-\d{4}-000001$/);
    await don(10000);
    expect((await don(1000, { moyen: "mtn_momo" })).corps.erreur).toBe("reference_obligatoire");
    expect((await aide(80000)).corps.erreur).toBe("solde_insuffisant");
    expect((await aide(50000)).statut).toBe(201);
    expect((await aide(0)).statut).toBe(201);

    const r = (await env.api("GET", `/projets-sociaux/${p}/rapport`, o.jeton)).corps;
    expect(r).toMatchObject({ collecte: 70000, distribue: 50000, disponible: 20000, beneficiaires: 1, atteinte_objectif: 70 });
    expect(JSON.stringify(r)).not.toContain("Bénéficiaire");
    expect(JSON.stringify(r)).not.toContain("Mécène");

    expect((await env.api("POST", `/dons/${d1.corps.id}/annulation`, o.jeton, { motif: "Chèque refusé" })).corps.erreur).toBe("solde_insuffisant");
    const detail = (await env.api("GET", `/projets-sociaux/${p}/detail`, o.jeton)).corps;
    expect(detail.dons.map((d: { donateur: string | null }) => d.donateur).sort()).toEqual([null, "Mécène"].sort());
    const aidePayee = detail.aides.find((a: { montant: number }) => a.montant === 50000);
    expect((await env.api("POST", `/aides/${aidePayee.id}/annulation`, o.jeton, { motif: "Bourse refusée" })).statut).toBe(200);
    expect((await env.api("POST", `/dons/${d1.corps.id}/annulation`, o.jeton, { motif: "Chèque refusé" })).statut).toBe(200);
    expect((await env.api("POST", `/dons/${d1.corps.id}/annulation`, o.jeton, { motif: "Encore une fois" })).statut).toBe(409);
    expect((await env.api("GET", `/projets-sociaux/${p}/rapport`, o.jeton)).corps).toMatchObject({ collecte: 10000, distribue: 0 });
  });

  it("des aides simultanées ne dépassent jamais le disponible", async () => {
    const o = await env.nouvelleOrganisation();
    const p = await nouveauProjet(o);
    await env.api("POST", `/projets-sociaux/${p}/dons`, o.jeton, { montant: 30000, moyen: "especes" });
    const b = await tiers(o, "B");
    const r = await Promise.all(Array.from({ length: 8 }, () =>
      env.api("POST", `/projets-sociaux/${p}/aides`, o.jeton, { beneficiaireId: b, description: "Aide", montant: 10000, date: "2026-03-01" })));
    expect(r.filter((x) => x.statut === 201)).toHaveLength(3);
    expect((await env.api("GET", `/projets-sociaux/${p}/rapport`, o.jeton)).corps.disponible).toBe(0);
  });

  it("un don enregistré ne se modifie pas et ne se supprime pas", async () => {
    const o = await env.nouvelleOrganisation();
    const p = await nouveauProjet(o);
    const d = await env.api("POST", `/projets-sociaux/${p}/dons`, o.jeton, { montant: 1000, moyen: "especes" });
    await expect(dansOrganisation(env.poolApp, o.organisationId, (c) => c.query("update dons set montant = 1 where id = $1", [d.corps.id])))
      .rejects.toThrow(/ne peut pas être modifiée/);
    await expect(dansOrganisation(env.poolApp, o.organisationId, (c) => c.query("delete from dons"))).rejects.toThrow(/permission denied/);
  });

  it("protège les noms, respecte les entités et isole les clients", async () => {
    const o = await env.nouvelleOrganisation();
    const p = await nouveauProjet(o);
    expect((await env.api("POST", "/projets-sociaux", o.jeton, { entiteId: o.entites.GLOMARI, nom: "X" })).corps.erreur).toBe("permission_refusee");
    const direction = await utilisateur(o, "direction", o.entites.FOUNDATION!);
    expect((await env.api("GET", "/projets-sociaux", direction)).statut).toBe(403);
    const foundation = await utilisateur(o, "foundation", o.entites.FOUNDATION!);
    expect((await env.api("GET", `/projets-sociaux/${p}/detail`, foundation)).statut).toBe(200);
    const roles = (await env.api("GET", "/roles", o.jeton)).corps;
    const ailleurs = await env.api("POST", "/utilisateurs", o.jeton, {
      email: `f${Math.random().toString(36).slice(2)}@test.cm`, nom: "F", motDePasse: "un-mot-de-passe-solide", entiteId: o.entites.GLOMARI,
      roleId: roles.find((x: { code: string }) => x.code === "foundation").id,
    });
    expect(ailleurs.corps.erreur).toBe("role_incompatible");

    const autre = await env.nouvelleOrganisation();
    expect((await env.api("GET", `/projets-sociaux/${p}/rapport`, autre.jeton)).statut).toBe(404);
    expect((await env.api("POST", `/projets-sociaux/${p}/dons`, autre.jeton, { montant: 1, moyen: "especes" })).statut).toBe(404);
    const m = await nouveauMentorat(o);
    expect((await env.api("GET", `/mentorats/${m.corps.id}`, autre.jeton)).statut).toBe(404);
    expect((await env.api("GET", "/mentorats", autre.jeton)).corps).toEqual([]);
    const pa = await nouveauProjet(autre);
    const etranger = await tiers(o, "Étranger");
    await env.api("POST", `/projets-sociaux/${pa}/dons`, autre.jeton, { montant: 1000, moyen: "especes" });
    expect((await env.api("POST", `/projets-sociaux/${pa}/aides`, autre.jeton, { beneficiaireId: etranger, description: "X", date: "2026-01-01" })).statut).toBe(404);
  });
});
