import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation, type Client } from "../src/base.js";
import { environnement, MOT_DE_PASSE } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);

/** Le compte d'administration passe lui aussi par le cloisonnement s'il n'est pas superutilisateur. */
function enAdmin<T>(organisationId: string, fn: (c: Client) => Promise<T>): Promise<T> {
  return dansOrganisation(env.poolAdmin, organisationId, fn);
}

async function role(jeton: string, code: string): Promise<string> {
  const { corps } = await env.api("GET", "/roles", jeton);
  return corps.find((r: { code: string }) => r.code === code).id;
}

async function creerUtilisateur(org: { jeton: string; slug: string }, code: string, entiteId?: string) {
  const email = `${code}.${Math.random().toString(36).slice(2)}@test.cm`;
  const r = await env.api("POST", "/utilisateurs", org.jeton, {
    email, nom: code, motDePasse: MOT_DE_PASSE, roleId: await role(org.jeton, code), entiteId,
  });
  expect(r.statut).toBe(201);
  return { id: r.corps.id as string, email, jeton: await env.connecter(org.slug, email) };
}

describe("isolation entre clients", () => {
  it("un client ne voit ni ne lit les données d'un autre", async () => {
    const a = await env.nouvelleOrganisation();
    const b = await env.nouvelleOrganisation();
    const t = await env.api("POST", "/tiers", b.jeton, { type: "personne", nom: "Secret de B" });
    expect(t.statut).toBe(201);

    expect((await env.api("GET", "/tiers?q=Secret", a.jeton)).corps).toEqual([]);
    expect((await env.api("GET", `/tiers/${t.corps.id}`, a.jeton)).statut).toBe(404);
    const entites = (await env.api("GET", "/entites", a.jeton)).corps.map((e: { id: string }) => e.id);
    expect(entites).not.toContain(b.entites.GTA);
    expect((await env.api("GET", `/entites/${b.entites.GTA}/modules`, a.jeton)).statut).toBe(404);
  });

  it("un jeton modifié pour viser un autre client est refusé", async () => {
    const a = await env.nouvelleOrganisation();
    const b = await env.nouvelleOrganisation();
    const falsifie = `${b.organisationId}.${a.jeton.split(".")[1]}`;
    expect((await env.api("GET", "/moi", falsifie)).statut).toBe(401);
  });

  it("une référence vers l'entité d'un autre client est refusée", async () => {
    const a = await env.nouvelleOrganisation();
    const b = await env.nouvelleOrganisation();
    const r1 = await env.api("POST", "/entites", a.jeton, {
      parentId: b.entites.GTA, code: "X", nom: "X", type: "programme",
    });
    expect(r1.statut).toBe(404);
    const r2 = await env.api("POST", "/tiers", a.jeton, {
      type: "personne", nom: "X", entiteOrigineId: b.entites.GTA,
    });
    expect(r2.statut).toBe(400);
  });

  it("la base refuse elle-même, même si le code applicatif oublie un filtre", async () => {
    const a = await env.nouvelleOrganisation();
    const b = await env.nouvelleOrganisation();
    await env.api("POST", "/tiers", b.jeton, { type: "personne", nom: "Secret" });

    const compte = await env.poolApp.query(
      "select rolsuper, rolbypassrls from pg_roles where rolname = current_user",
    );
    expect(compte.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });

    // Sans organisation : aucune ligne, dans aucune table.
    for (const table of ["tiers", "utilisateurs", "entites", "journal_audit", "sessions", "organisations"]) {
      const { rows } = await env.poolApp.query(`select count(*)::int as n from ${table}`);
      expect(rows[0].n, table).toBe(0);
    }

    await dansOrganisation(env.poolApp, a.organisationId, async (c) => {
      // Une requête volontairement sans aucun filtre ne renvoie que l'organisation courante.
      const { rows } = await c.query("select distinct organisation_id from tiers");
      expect(rows.every((r) => r.organisation_id === a.organisationId)).toBe(true);
      const organisations = await c.query("select id from organisations");
      expect(organisations.rows.map((r) => r.id)).toEqual([a.organisationId]);
    });

    await expect(
      dansOrganisation(env.poolApp, a.organisationId, (c) =>
        c.query("insert into tiers (organisation_id, type, nom) values ($1, 'personne', 'Intrus')", [b.organisationId]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("le contexte ne fuit pas vers la requête suivante sur la même connexion", async () => {
    const a = await env.nouvelleOrganisation();
    await dansOrganisation(env.poolApp, a.organisationId, async () => undefined);
    const { rows } = await env.poolApp.query("select org_courante() as id");
    expect(rows[0].id).toBeNull();
  });
});

describe("connexion", () => {
  it("refuse sans jeton et avec un mauvais mot de passe, sans révéler si le compte existe", async () => {
    const a = await env.nouvelleOrganisation();
    expect((await env.api("GET", "/moi")).statut).toBe(401);
    const mauvais = await env.api("POST", "/connexion", undefined, {
      organisation: a.slug, email: a.email, motDePasse: "faux",
    });
    const inconnu = await env.api("POST", "/connexion", undefined, {
      organisation: a.slug, email: "personne@test.cm", motDePasse: "faux",
    });
    expect(mauvais).toEqual(inconnu);
    expect(mauvais.statut).toBe(401);
  });

  it("verrouille le compte après 5 échecs, même avec ensuite le bon mot de passe", async () => {
    const a = await env.nouvelleOrganisation();
    for (let i = 0; i < 5; i++) {
      await env.api("POST", "/connexion", undefined, { organisation: a.slug, email: a.email, motDePasse: "faux" });
    }
    const r = await env.api("POST", "/connexion", undefined, {
      organisation: a.slug, email: a.email, motDePasse: MOT_DE_PASSE,
    });
    expect(r.statut).toBe(401);
  });

  it("la déconnexion et l'expiration invalident la session", async () => {
    const a = await env.nouvelleOrganisation();
    expect((await env.api("POST", "/deconnexion", a.jeton)).statut).toBe(204);
    expect((await env.api("GET", "/moi", a.jeton)).statut).toBe(401);

    const jeton = await env.connecter(a.slug, a.email);
    await enAdmin(a.organisationId, (c) => c.query("update sessions set expire_le = now() - interval '1 minute'"));
    expect((await env.api("GET", "/moi", jeton)).statut).toBe(401);
  });

  it("une organisation suspendue ne peut plus accéder", async () => {
    const a = await env.nouvelleOrganisation();
    await env.poolAdmin.query("update organisations set statut = 'suspendue' where id = $1", [a.organisationId]);
    expect((await env.api("GET", "/moi", a.jeton)).statut).toBe(401);
  });

  it("le mot de passe n'apparaît jamais dans le journal et le jeton n'est pas stocké en clair", async () => {
    const a = await env.nouvelleOrganisation();
    const audit = JSON.stringify((await env.api("GET", "/audit?limite=200", a.jeton)).corps);
    expect(audit).not.toContain("mot_de_passe");
    expect(audit).not.toContain("scrypt");
    const { rows } = await enAdmin(a.organisationId, (c) => c.query("select jeton_hash from sessions"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.jeton_hash)).not.toContain(a.jeton);
  });
});

describe("permissions", () => {
  it("un commercial crée des tiers mais ne gère ni les entités ni le journal", async () => {
    const a = await env.nouvelleOrganisation();
    const c = await creerUtilisateur(a, "commercial");
    expect((await env.api("POST", "/tiers", c.jeton, { type: "personne", nom: "Client" })).statut).toBe(201);
    expect((await env.api("POST", "/entites", c.jeton, {
      parentId: a.entites.GTA, code: "Y", nom: "Y", type: "programme",
    })).statut).toBe(403);
    expect((await env.api("GET", "/audit", c.jeton)).statut).toBe(403);
    expect((await env.api("PUT", `/entites/${a.entites.GTA}/modules/formations`, c.jeton, { actif: true })).statut).toBe(403);
  });

  it("un droit sur GTA vaut pour ses descendantes, pas pour GLOMARI", async () => {
    const a = await env.nouvelleOrganisation();
    const g = await creerUtilisateur(a, "administrateur", a.entites.GTA);
    const put = (id: string) => env.api("PUT", `/entites/${id}/modules/formations`, g.jeton, { actif: true });
    expect((await put(a.entites.GTA!)).statut).toBe(200);
    expect((await put(a.entites.IP2EL!)).statut).toBe(200);
    expect((await put(a.entites.GLOMARI!)).statut).toBe(403);
    const visibles = (await env.api("GET", "/entites", g.jeton)).corps.map((e: { code: string }) => e.code).sort();
    expect(visibles).toEqual(["FOUNDATION", "GTA", "IP2EL", "SMARTE"]);
    expect((await env.api("GET", "/audit", g.jeton)).statut).toBe(403);
  });

  it("seul le super administrateur donne ou retire des accès", async () => {
    const a = await env.nouvelleOrganisation();
    const g = await creerUtilisateur(a, "administrateur", a.entites.GTA);
    const corps = { email: `x${Math.random()}@test.cm`, nom: "X", motDePasse: MOT_DE_PASSE, roleId: await role(a.jeton, "formateur"), entiteId: a.entites.GTA };
    expect((await env.api("POST", "/utilisateurs", g.jeton, corps)).statut).toBe(403);
    expect((await env.api("GET", "/utilisateurs", g.jeton)).statut).toBe(403);
    expect((await env.api("GET", "/roles", g.jeton)).statut).toBe(403);
    expect((await env.api("POST", `/utilisateurs/${g.id}/acces`, g.jeton, { roleId: await role(a.jeton, "super_administrateur") })).statut).toBe(403);
    expect((await env.api("PATCH", `/utilisateurs/${a.adminId}`, g.jeton, { actif: false })).statut).toBe(403);
    expect((await env.api("POST", "/utilisateurs", a.jeton, corps)).statut).toBe(201);
    expect((await env.api("POST", "/utilisateurs", a.jeton, {
      ...corps, email: `y${Math.random()}@test.cm`, roleId: await role(a.jeton, "super_administrateur"), entiteId: a.entites.GTA,
    })).corps.erreur).toBe("super_sur_toute_organisation");
  });

  it("garde toujours un super administrateur et coupe les sessions d'un compte désactivé", async () => {
    const a = await env.nouvelleOrganisation();
    expect((await env.api("PATCH", `/utilisateurs/${a.adminId}`, a.jeton, { actif: false })).corps.erreur).toBe("dernier_super_administrateur");
    const liste = (await env.api("GET", "/utilisateurs", a.jeton)).corps;
    const acces = liste[0].acces[0].id;
    expect((await env.api("DELETE", `/acces/${acces}`, a.jeton)).corps.erreur).toBe("dernier_super_administrateur");
    const u = await creerUtilisateur(a, "commercial");
    expect((await env.api("GET", "/tiers", u.jeton)).statut).toBe(200);
    await env.api("PATCH", `/utilisateurs/${u.id}`, a.jeton, { actif: false });
    expect((await env.api("GET", "/tiers", u.jeton)).statut).toBe(401);
    await env.api("PATCH", `/utilisateurs/${u.id}`, a.jeton, { actif: true });
    await expect(env.connecter(a.slug, u.email, "faux")).rejects.toThrow();
    const nouveau = "un-autre-mot-de-passe-long";
    const jeton = await env.connecter(a.slug, u.email);
    await env.api("PATCH", `/utilisateurs/${u.id}`, a.jeton, { motDePasse: nouveau });
    expect((await env.api("GET", "/tiers", jeton)).statut).toBe(401);
    expect(await env.connecter(a.slug, u.email, nouveau)).toBeTruthy();
  });

  it("retirer un accès l'enlève, et un second super administrateur peut prendre le relais", async () => {
    const a = await env.nouvelleOrganisation();
    const u = await creerUtilisateur(a, "commercial");
    const super2 = await env.api("POST", `/utilisateurs/${u.id}/acces`, a.jeton, { roleId: await role(a.jeton, "super_administrateur") });
    expect(super2.statut).toBe(201);
    expect((await env.api("GET", "/utilisateurs", u.jeton)).statut).toBe(200);
    expect((await env.api("DELETE", `/acces/${super2.corps.id}`, a.jeton)).statut).toBe(204);
    expect((await env.api("GET", "/utilisateurs", u.jeton)).statut).toBe(403);
  });

  it("un gestionnaire d'utilisateurs ne peut pas accorder un rôle aux droits qu'il n'a pas", async () => {
    const a = await env.nouvelleOrganisation();
    const roleLimite = await enAdmin(a.organisationId, async (c) => {
      const r = await c.query(
        "insert into roles (organisation_id, code, nom) values (org_courante(), 'rh', 'RH') returning id",
      );
      await c.query(
        "insert into role_permissions (organisation_id, role_id, permission) values (org_courante(), $1, 'utilisateurs.gerer')",
        [r.rows[0].id],
      );
      return r.rows[0].id as string;
    });
    const email = "rh@test.cm";
    await env.api("POST", "/utilisateurs", a.jeton, { email, nom: "RH", motDePasse: MOT_DE_PASSE, roleId: roleLimite });
    const rh = await env.connecter(a.slug, email);
    const accorder = async (roleId: string) =>
      (await env.api("POST", "/utilisateurs", rh, {
        email: `x${Math.random()}@test.cm`, nom: "X", motDePasse: MOT_DE_PASSE, roleId,
      })).statut;
    expect(await accorder(await role(a.jeton, "administrateur"))).toBe(403);
    expect(await accorder(await role(a.jeton, "commercial"))).toBe(403);
    expect(await accorder(roleLimite)).toBe(201);
  });

  it("une délégation expirée ne donne plus aucun droit", async () => {
    const a = await env.nouvelleOrganisation();
    const c = await creerUtilisateur(a, "commercial");
    expect((await env.api("GET", "/tiers", c.jeton)).statut).toBe(200);
    await enAdmin(a.organisationId, (x) => x.query("update attributions set expire_le = now() - interval '1 minute' where utilisateur_id = $1", [c.id]));
    expect((await env.api("GET", "/tiers", c.jeton)).statut).toBe(403);
  });
});

describe("séparation de GTA et GLOMARI", () => {
  async function organisation() {
    const a = await env.nouvelleOrganisation();
    const p = await env.api("POST", "/produits", a.jeton, { entiteId: a.entites.GLOMARI, code: "SAC", nom: "Sac", suiviStock: true, prixVente: 1000 });
    await env.api("POST", "/stocks/mouvements", a.jeton, { entiteId: a.entites.GLOMARI, produitId: p.corps.id, type: "entree", quantite: 5, coutUnitaire: 100 });
    return { ...a, produitId: p.corps.id as string };
  }

  it("le super administrateur voit les deux branches", async () => {
    const a = await organisation();
    expect((await env.api("GET", "/stocks", a.jeton)).corps).toHaveLength(1);
    expect((await env.api("GET", "/sessions", a.jeton)).statut).toBe(200);
    const droits = (await env.api("GET", "/moi", a.jeton)).corps.permissions;
    expect(droits).toEqual(expect.arrayContaining(["stocks.voir", "formations.voir", "utilisateurs.gerer"]));
  });

  it("un administrateur de GTA n'a aucun accès aux stocks ni aux articles de GLOMARI", async () => {
    const a = await organisation();
    const g = await creerUtilisateur(a, "administrateur", a.entites.GTA);
    for (const url of ["/stocks", "/transferts", "/stocks/reajustements", "/achats/commandes", "/achats/reapprovisionnement", `/stocks/mouvements?produitId=${a.produitId}`]) {
      expect((await env.api("GET", url, g.jeton)).statut, url).toBe(403);
    }
    expect((await env.api("POST", "/stocks/mouvements", g.jeton, { entiteId: a.entites.GTA, produitId: a.produitId, type: "entree", quantite: 1, coutUnitaire: 1 })).statut).toBe(403);
    expect((await env.api("GET", "/produits", g.jeton)).corps).toEqual([]);
    expect((await env.api("PATCH", `/produits/${a.produitId}`, g.jeton, { nom: "X" })).statut).toBe(403);
    const droits = (await env.api("GET", "/moi", g.jeton)).corps.permissions;
    expect(droits.filter((d: string) => d.startsWith("stocks.") || d.startsWith("achats."))).toEqual([]);
    expect(droits).toContain("formations.voir");
    const t = await env.api("POST", "/tiers", g.jeton, { type: "personne", nom: "C" });
    const doc = await env.api("POST", "/documents-vente", g.jeton, {
      type: "facture", entiteId: a.entites.GTA, tiersId: t.corps.id, date: "2026-01-15", lignes: [{ produitId: a.produitId, quantite: 1 }],
    });
    expect(doc.statut).toBe(404);
  });

  it("un administrateur de GLOMARI n'a aucun accès aux formations", async () => {
    const a = await organisation();
    const g = await creerUtilisateur(a, "administrateur", a.entites.GLOMARI);
    expect((await env.api("GET", "/sessions", g.jeton)).statut).toBe(403);
    expect((await env.api("GET", "/programmes", g.jeton)).statut).toBe(403);
    expect((await env.api("GET", "/stocks", g.jeton)).corps).toHaveLength(1);
    const droits = (await env.api("GET", "/moi", g.jeton)).corps.permissions;
    expect(droits.filter((d: string) => d.startsWith("formations."))).toEqual([]);
  });

  it("le système refuse de mélanger les branches, même au super administrateur", async () => {
    const a = await env.nouvelleOrganisation();
    expect((await env.api("PUT", `/entites/${a.entites.GTA}/modules/achats_stocks`, a.jeton, { actif: true })).corps.erreur).toBe("module_incompatible");
    expect((await env.api("PUT", `/entites/${a.entites.IP2EL}/modules/achats_stocks`, a.jeton, { actif: true })).corps.erreur).toBe("module_incompatible");
    expect((await env.api("PUT", `/entites/${a.entites.GLOMARI}/modules/formations`, a.jeton, { actif: true })).corps.erreur).toBe("module_incompatible");
    expect((await env.api("PUT", `/entites/${a.entites.SGC}/modules/formations`, a.jeton, { actif: true })).corps.erreur).toBe("module_incompatible");
    expect((await env.api("POST", "/produits", a.jeton, { entiteId: a.entites.GTA, code: "X", nom: "X", suiviStock: true })).corps.erreur).toBe("module_inactif");
    const creer = (code: string, entiteId: string) => env.api("POST", "/utilisateurs", a.jeton, {
      email: `${code}${Math.random()}@test.cm`, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: "",
    });
    expect((await creer("x", a.entites.GTA!)).statut).toBe(400);
    const accorder = async (code: string, entiteId: string) => (await env.api("POST", "/utilisateurs", a.jeton, {
      email: `${code}${Math.random()}@test.cm`, nom: code, motDePasse: MOT_DE_PASSE, entiteId, roleId: await role(a.jeton, code),
    })).corps.erreur;
    expect(await accorder("magasinier", a.entites.GTA!)).toBe("role_incompatible");
    expect(await accorder("formateur", a.entites.GLOMARI!)).toBe("role_incompatible");
    const d = await env.api("POST", "/entites", a.jeton, { parentId: a.entites.GTA, code: "C1", nom: "Centre", type: "centre_formation" });
    expect(d.corps.domaine).toBe("formation");
  });
});

describe("fiches clients séparées par branche", () => {
  async function equipes() {
    const a = await env.nouvelleOrganisation();
    return { a, gta: await creerUtilisateur(a, "commercial", a.entites.GTA), glomari: await creerUtilisateur(a, "commercial", a.entites.GLOMARI) };
  }
  const CLIENT = { type: "personne", nom: "Awa Secret", telephone: "699123456", email: "awa@test.cm" };

  it("une branche ne voit, ne cherche ni ne modifie les fiches de l'autre", async () => {
    const { a, gta, glomari } = await equipes();
    const t = await env.api("POST", "/tiers", glomari.jeton, CLIENT);
    expect(t.corps.branche_id).toBe(a.entites.GLOMARI);
    expect((await env.api("GET", "/tiers?q=Awa", gta.jeton)).corps).toEqual([]);
    expect((await env.api("GET", `/tiers/${t.corps.id}`, gta.jeton)).statut).toBe(404);
    expect((await env.api("PATCH", `/tiers/${t.corps.id}`, gta.jeton, { nom: "X" })).statut).toBe(404);
    expect((await env.api("GET", `/tiers/${t.corps.id}/chronologie`, gta.jeton)).statut).toBe(404);
    expect((await env.api("POST", "/opportunites", gta.jeton, { entiteId: a.entites.GTA, tiersId: t.corps.id, titre: "X" })).statut).toBe(404);
    expect((await env.api("GET", "/tiers?q=Awa", glomari.jeton)).corps).toHaveLength(1);
  });

  it("une même personne a une fiche par branche, sans révéler l'autre", async () => {
    const { gta, glomari } = await equipes();
    await env.api("POST", "/tiers", glomari.jeton, CLIENT);
    const r = await env.api("POST", "/tiers", gta.jeton, CLIENT);
    expect(r.statut).toBe(201);
    const doublon = await env.api("POST", "/tiers", gta.jeton, { ...CLIENT, nom: "Autre" });
    expect(doublon.corps.erreur).toBe("doublon_probable");
    expect(doublon.corps.details).toHaveLength(1);
    expect(doublon.corps.details[0].id).toBe(r.corps.id);
  });

  it("le super administrateur voit tout, mais ne mélange pas les branches", async () => {
    const { a, gta, glomari } = await equipes();
    const t1 = await env.api("POST", "/tiers", glomari.jeton, CLIENT);
    await env.api("POST", "/tiers", gta.jeton, CLIENT);
    const liste = (await env.api("GET", "/tiers?q=Awa", a.jeton)).corps;
    expect(liste).toHaveLength(2);
    expect(liste.map((t: { branche: string }) => t.branche).sort()).toEqual(["GLOMARI", "Global Training Academy"]);
    expect((await env.api("GET", `/tiers?q=Awa&entiteId=${a.entites.IP2EL}`, a.jeton)).corps).toHaveLength(1);
    const lien = await env.api("POST", "/opportunites", a.jeton, { entiteId: a.entites.GTA, tiersId: t1.corps.id, titre: "X" });
    expect(lien.corps.erreur).toBe("tiers_autre_branche");
  });

  it("une fiche créée par le groupe rejoint la première branche qui l'utilise", async () => {
    const { a, gta, glomari } = await equipes();
    const t = await env.api("POST", "/tiers", a.jeton, { type: "personne", nom: "Groupe" });
    expect(t.corps.branche_id).toBeNull();
    expect((await env.api("GET", "/tiers?q=Groupe", gta.jeton)).corps).toEqual([]);
    await env.api("POST", "/opportunites", a.jeton, { entiteId: a.entites.GTA, tiersId: t.corps.id, titre: "X" });
    expect((await env.api("GET", "/tiers?q=Groupe", gta.jeton)).corps).toHaveLength(1);
    expect((await env.api("GET", "/tiers?q=Groupe", glomari.jeton)).corps).toEqual([]);
  });

  it("une personne présente dans les deux branches doit préciser l'entité, et reste limitée à ses branches", async () => {
    const { a, gta } = await equipes();
    const roles = (await env.api("GET", "/roles", a.jeton)).corps;
    const commercial = roles.find((r: { code: string }) => r.code === "commercial").id;
    await env.api("POST", `/utilisateurs/${gta.id}/acces`, a.jeton, { roleId: commercial, entiteId: a.entites.GLOMARI });
    expect((await env.api("POST", "/tiers", gta.jeton, { type: "personne", nom: "X" })).corps.erreur).toBe("entite_obligatoire");
    expect((await env.api("POST", "/tiers", gta.jeton, { type: "personne", nom: "X", entiteId: a.entites.GLOMARI })).statut).toBe(201);
    const seul = await creerUtilisateur(a, "commercial", a.entites.GLOMARI);
    expect((await env.api("POST", "/tiers", seul.jeton, { type: "personne", nom: "Y", entiteId: a.entites.GTA })).statut).toBe(403);
  });
});

describe("fiche tiers unique", () => {
  it("détecte un doublon par e-mail ou téléphone, quel que soit le format", async () => {
    const a = await env.nouvelleOrganisation();
    await env.api("POST", "/tiers", a.jeton, {
      type: "personne", nom: "Awa", email: "Awa@Test.cm", telephone: "699 41 57 00", roles: ["apprenant"],
    });
    const parMail = await env.api("POST", "/tiers", a.jeton, { type: "personne", nom: "A.", email: "awa@test.cm" });
    expect(parMail.statut).toBe(409);
    expect(parMail.corps.erreur).toBe("doublon_probable");
    const parTel = await env.api("POST", "/tiers", a.jeton, { type: "personne", nom: "A.", telephone: "+237699415700" });
    expect(parTel.statut).toBe(409);
    const force = await env.api("POST", "/tiers", a.jeton, {
      type: "personne", nom: "Homonyme", telephone: "+237699415700", ignorerDoublons: true,
    });
    expect(force.statut).toBe(201);
  });

  it("un même client d'un autre groupe n'est pas considéré comme doublon", async () => {
    const a = await env.nouvelleOrganisation();
    const b = await env.nouvelleOrganisation();
    const corps = { type: "personne", nom: "Awa", email: "partage@test.cm" };
    expect((await env.api("POST", "/tiers", a.jeton, corps)).statut).toBe(201);
    expect((await env.api("POST", "/tiers", b.jeton, corps)).statut).toBe(201);
  });

  it("refuse un rôle inconnu et traite un motif de recherche comme du texte", async () => {
    const a = await env.nouvelleOrganisation();
    expect((await env.api("POST", "/tiers", a.jeton, { type: "personne", nom: "X", roles: ["pirate"] })).statut).toBe(400);
    await env.api("POST", "/tiers", a.jeton, { type: "personne", nom: "Client" });
    expect((await env.api("GET", "/tiers?q=%25", a.jeton)).corps).toEqual([]);
  });
});

describe("modules par entité", () => {
  it("désactiver un module est réversible et rejette un module inconnu", async () => {
    const a = await env.nouvelleOrganisation();
    const url = `/entites/${a.entites.GTA}/modules`;
    await env.api("PUT", `${url}/formations`, a.jeton, { actif: true });
    await env.api("PUT", `${url}/formations`, a.jeton, { actif: false });
    await env.api("PUT", `${url}/formations`, a.jeton, { actif: true });
    const modules = (await env.api("GET", url, a.jeton)).corps;
    expect(modules.find((m: { module: string }) => m.module === "formations").actif).toBe(true);
    expect(modules.find((m: { module: string }) => m.module === "commerce").actif).toBe(false);
    expect((await env.api("PUT", `${url}/socle`, a.jeton, { actif: false })).statut).toBe(400);
  });
});

describe("journal d'audit", () => {
  it("enregistre qui a fait quoi, avec l'avant et l'après", async () => {
    const a = await env.nouvelleOrganisation();
    const t = await env.api("POST", "/tiers", a.jeton, { type: "personne", nom: "Tracé" });
    const lignes = (await env.api("GET", "/audit", a.jeton)).corps;
    const ligne = lignes.find((l: { objet_id: string }) => l.objet_id === t.corps.id);
    expect(ligne.action).toBe("insert");
    expect(ligne.acteur_id).toBe(a.adminId);
    expect(ligne.apres.nom).toBe("Tracé");
  });

  it("une opération annulée ne laisse aucune trace ni aucun événement", async () => {
    const a = await env.nouvelleOrganisation();
    const compter = () => enAdmin(a.organisationId, (c) => c.query("select count(*)::int as n from journal_audit"));
    const avant = await compter();
    await expect(dansOrganisation(env.poolApp, a.organisationId, async (c) => {
      await c.query("insert into tiers (organisation_id, type, nom) values ($1, 'personne', 'Annulé')", [a.organisationId]);
      throw new Error("échec");
    })).rejects.toThrow("échec");
    const apres = await compter();
    expect(avant.rows[0].n).toBeGreaterThan(0);
    expect(apres.rows[0].n).toBe(avant.rows[0].n);
  });

  it("l'application ne peut ni écrire, ni modifier, ni supprimer une ligne", async () => {
    const a = await env.nouvelleOrganisation();
    for (const sql of [
      "update journal_audit set action = 'x'",
      "delete from journal_audit",
      "truncate journal_audit",
      "insert into journal_audit (organisation_id, sequence, horodatage, action, empreinte_precedente, empreinte) values (org_courante(), 999, now(), 'faux', 'x', 'x')",
      "select journal_ecrire(org_courante(), 'faux', null, null, null, null)",
    ]) {
      await expect(dansOrganisation(env.poolApp, a.organisationId, (c) => c.query(sql)), sql).rejects.toThrow(/permission denied/);
    }
  });

  it("même le compte d'administration est bloqué par le déclencheur", async () => {
    const a = await env.nouvelleOrganisation();
    await expect(enAdmin(a.organisationId, (c) => c.query("update journal_audit set action = 'x'")))
      .rejects.toThrow(/ne peut pas être modifié/);
    await expect(enAdmin(a.organisationId, (c) => c.query("truncate journal_audit")))
      .rejects.toThrow(/ne peut pas être modifié/);
  });

  it("reste une chaîne continue sous 40 écritures simultanées", async () => {
    const a = await env.nouvelleOrganisation();
    const reponses = await Promise.all(Array.from({ length: 40 }, (_, i) =>
      env.api("POST", "/tiers", a.jeton, { type: "personne", nom: `Tiers ${i}` }),
    ));
    expect(reponses.every((r) => r.statut === 201)).toBe(true);
    const v = (await env.api("GET", "/audit/verification", a.jeton)).corps;
    expect(v.valide).toBe(true);
    expect(v.total).toBeGreaterThan(40);
  });

  it("détecte une falsification faite en contournant les protections", async () => {
    const a = await env.nouvelleOrganisation();
    await env.api("POST", "/tiers", a.jeton, { type: "personne", nom: "Original" });
    expect((await env.api("GET", "/audit/verification", a.jeton)).corps.valide).toBe(true);

    const modifiees = await enAdmin(a.organisationId, async (c) => {
      await c.query("alter table journal_audit disable trigger immuable");
      const r = await c.query(
        `update journal_audit set apres = jsonb_set(apres, '{nom}', '"Falsifié"')
         where apres->>'nom' = 'Original'`,
      );
      await c.query("alter table journal_audit enable trigger immuable");
      return r.rowCount;
    });
    expect(modifiees).toBe(1);

    const v = (await env.api("GET", "/audit/verification", a.jeton)).corps;
    expect(v.valide).toBe(false);
    expect(v.rupture_sequence).not.toBeNull();
  });
});

describe("robustesse", () => {
  it("rejette les identifiants mal formés sans erreur interne", async () => {
    const a = await env.nouvelleOrganisation();
    expect((await env.api("GET", "/tiers/pas-un-uuid", a.jeton)).statut).toBe(400);
    expect((await env.api("GET", "/moi", "pas-un-jeton")).statut).toBe(401);
    expect((await env.api("POST", "/tiers", a.jeton, { nom: "sans type" })).statut).toBe(400);
  });

  it("les événements sont écrits avec le fait métier, pour les modules futurs", async () => {
    const a = await env.nouvelleOrganisation();
    const t = await env.api("POST", "/tiers", a.jeton, { type: "personne", nom: "Évènement" });
    const { rows } = await enAdmin(a.organisationId, (c) =>
      c.query("select type, charge from evenements where organisation_id = org_courante() and type = 'tiers.cree'"));
    expect(rows).toEqual([{ type: "tiers.cree", charge: { id: t.corps.id } }]);
  });
});
