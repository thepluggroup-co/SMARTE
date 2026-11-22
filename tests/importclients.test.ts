import { afterAll, describe, expect, it } from "vitest";
import { dansOrganisation } from "../src/base.js";
import { utilisateur } from "./canaloutils.js";
import { environnement } from "./outils.js";

const env = await environnement();
afterAll(env.fermer);
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
const importer = (o: Org, entiteId: string, lignes: object[], jeton = o.jeton) => env.api("POST", "/tiers/import", jeton, { entiteId, lignes });
const sql = (o: Org, texte: string, valeurs: unknown[] = []) => dansOrganisation(env.poolApp, o.organisationId, (c) => c.query(texte, valeurs));
/** Numéros camerounais distincts à 9 chiffres. */
const clients = (n: number) => Array.from({ length: n }, (_, i) => ({ nom: `Client ${i}`, telephone: `6${10000000 + i}`, ville: "Douala", source: "Salon" }));
const fiche = (o: Org, nom: string, telephone: string, branche: string, roles = "{client}") =>
  sql(o, "insert into tiers (organisation_id, type, nom, telephone, roles, branche_id) values ($1, 'personne', $2, $3, $4, $5) returning id", [o.organisationId, nom, telephone, roles, branche]);

describe("import des clients", () => {
  it("importe 4 000 clients sans doublon, et relancer le même fichier ne crée rien", async () => {
    const o = await env.nouvelleOrganisation();
    const G = o.entites.GLOMARI!;
    const fichier = clients(4000);
    const r = await importer(o, G, fichier);
    expect(r.statut).toBe(200);
    expect(r.corps).toEqual({ crees: 4000, deja_presents: 0, nb_doublons: 0, doublons: [] });
    expect((await importer(o, G, fichier)).corps).toMatchObject({ crees: 0, deja_presents: 4000, nb_doublons: 0 });

    const { rows: [n] } = await sql(o, "select count(*)::int as n, count(distinct telephone)::int as d from tiers where branche_id = $1 and nom like 'Client %'", [G]);
    expect(n).toEqual({ n: 4000, d: 4000 });
    const { rows: [t] } = await sql(o, "select roles, ville, source, telephone, entite_origine_id from tiers where nom = 'Client 7'");
    expect(t).toEqual({ roles: ["client"], ville: "Douala", source: "Salon", telephone: "237610000007", entite_origine_id: G });
    const { rows: ev } = await sql(o, "select type, charge from evenements where organisation_id = org_courante() and type in ('tiers.importes', 'tiers.cree')");
    expect(ev.map((e) => `${e.type} ${e.charge.crees}`).sort()).toEqual(["tiers.importes 0", "tiers.importes 4000"]);
  });

  it("ignore les doublons du fichier et les clients déjà connus, sans jamais toucher une fiche de GTA", async () => {
    const o = await env.nouvelleOrganisation();
    const G = o.entites.GLOMARI!;
    const GTA = o.entites.GTA!;
    const gta = (await fiche(o, "Awa GTA", "237699000001", GTA, "{apprenant}")).rows[0].id as string;
    await fiche(o, "Déjà là", "237699000002", G);
    const r = await importer(o, G, [
      { nom: "Awa", telephone: "699 00 00 01", email: "Awa@Exemple.cm", ligne: 2 },
      { nom: "Déjà là", telephone: "+237 699000002", ligne: 3 },
      { nom: "Awa bis", telephone: "699000001", ligne: 4 },
      { nom: "Sans téléphone", email: "contact@exemple.cm", ligne: 5 },
      { nom: "Même e-mail", email: "CONTACT@exemple.cm", ligne: 6 },
    ]);
    expect(r.corps).toEqual({ crees: 2, deja_presents: 1, nb_doublons: 2, doublons: [{ ligne: 4, nom: "Awa bis" }, { ligne: 6, nom: "Même e-mail" }] });
    const { rows: crees } = await sql(o, "select nom, telephone, email from tiers where branche_id = $1 and nom in ('Awa', 'Sans téléphone') order by nom", [G]);
    expect(crees).toEqual([
      { nom: "Awa", telephone: "237699000001", email: "awa@exemple.cm" },
      { nom: "Sans téléphone", telephone: null, email: "contact@exemple.cm" },
    ]);
    expect((await sql(o, "select nom, roles, branche_id from tiers where id = $1", [gta])).rows[0]).toEqual({ nom: "Awa GTA", roles: ["apprenant"], branche_id: GTA });
    expect((await sql(o, "select count(*)::int as n from tiers where branche_id = $1 and telephone = '237699000001'", [GTA])).rows[0].n).toBe(1);
  });

  it("refuse tout le fichier à la moindre erreur de format, avec les lignes à corriger", async () => {
    const o = await env.nouvelleOrganisation();
    const G = o.entites.GLOMARI!;
    const r = await importer(o, G, [
      { nom: "Bon", telephone: "699000010" },
      { nom: "  ", telephone: "699000011" },
      { nom: "Court", telephone: "12345" },
      { nom: "Mauvais e-mail", email: "pas-un-email" },
      { nom: "Sans contact" },
    ]);
    expect(r.statut).toBe(400);
    expect(r.corps.erreur).toBe("import_clients_invalide");
    expect(r.corps.details).toEqual({
      total: 4,
      erreurs: [
        { ligne: 3, motif: "Nom vide" }, { ligne: 4, motif: "Téléphone invalide" },
        { ligne: 5, motif: "E-mail invalide" }, { ligne: 6, motif: "Ni téléphone ni e-mail" },
      ],
    });
    expect((await sql(o, "select count(*)::int as n from tiers where nom = 'Bon'")).rows[0].n).toBe(0);
  });

  it("exige le droit de créer des clients sur la branche, et reste dans son organisation", async () => {
    const o = await env.nouvelleOrganisation();
    const G = o.entites.GLOMARI!;
    const magasinier = await utilisateur(env, o, "magasinier", G);
    expect((await importer(o, G, clients(1), magasinier)).statut).toBe(403);
    const autre = await env.nouvelleOrganisation();
    expect((await importer(autre, G, clients(1))).statut).not.toBe(200);
    expect((await sql(o, "select count(*)::int as n from tiers where nom like 'Client %'")).rows[0].n).toBe(0);
  });
});
