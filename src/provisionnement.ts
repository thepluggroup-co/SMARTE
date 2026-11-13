import pg from "pg";
import { dansOrganisation } from "./base.js";
import { ROLE_SUPER, ROLES_INITIAUX } from "./catalogue.js";
import { hacherMotDePasse } from "./securite.js";

export interface EntiteModele {
  code: string;
  nom: string;
  type: string;
  domaine?: string;
  modules?: string[];
  enfants?: EntiteModele[];
}

export interface NouvelleOrganisation {
  slug: string;
  nom: string;
  racine: EntiteModele;
  admin: { email: string; nom: string; motDePasse: string };
}

export const STRUCTURE_SGC: EntiteModele = {
  code: "SGC", nom: "Groupe SGC Sarl", type: "groupe", domaine: "groupe", modules: ["pilotage"],
  enfants: [
    { code: "GLOMARI", nom: "GLOMARI", type: "branche", domaine: "commerce", modules: ["crm", "support", "pilotage", "facturation", "achats_stocks", "commerce", "rh_paie", "tresorerie", "comptabilite", "transport"] },
    {
      code: "GTA", nom: "Global Training Academy", type: "branche", domaine: "formation", modules: ["formations", "crm", "support", "pilotage", "mentorat", "facturation", "apprentissage", "rh_paie", "tresorerie", "comptabilite"],
      enfants: [
        { code: "IP2EL", nom: "IP2EL University", type: "etablissement", modules: ["universite"] },
        { code: "SMARTE", nom: "SMARTE Coaching", type: "programme", modules: ["coaching"] },
        { code: "FOUNDATION", nom: "GTA Foundation", type: "programme", modules: ["foundation", "pilotage"] },
      ],
    },
  ],
};

/** Crée un client de l'ERP. S'exécute avec le compte d'administration, jamais celui de l'application. */
export async function provisionnerOrganisation(
  poolAdmin: pg.Pool, o: NouvelleOrganisation,
): Promise<{ organisationId: string; adminId: string; entites: Record<string, string> }> {
  const hash = await hacherMotDePasse(o.admin.motDePasse);
  const { rows } = await poolAdmin.query(
    "insert into organisations (slug, nom) values ($1, $2) returning id", [o.slug, o.nom],
  );
  const organisationId: string = rows[0].id;

  return dansOrganisation(poolAdmin, organisationId, async (c) => {
    const entites: Record<string, string> = {};
    const creer = async (e: EntiteModele, parent: string | null, domaineParent = "general") => {
      const domaine = e.domaine ?? domaineParent;
      const r = await c.query(
        `insert into entites (organisation_id, parent_id, code, nom, type, domaine)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [organisationId, parent, e.code, e.nom, e.type, domaine],
      );
      entites[e.code] = r.rows[0].id;
      for (const module of e.modules ?? []) {
        await c.query(
          "insert into modules_entite (organisation_id, entite_id, module, actif) values ($1, $2, $3, true)",
          [organisationId, r.rows[0].id, module],
        );
      }
      for (const enfant of e.enfants ?? []) await creer(enfant, r.rows[0].id, domaine);
    };
    await creer(o.racine, null);

    let roleAdmin = "";
    for (const role of ROLES_INITIAUX) {
      const r = await c.query(
        "insert into roles (organisation_id, code, nom) values ($1, $2, $3) returning id",
        [organisationId, role.code, role.nom],
      );
      if (role.code === ROLE_SUPER) roleAdmin = r.rows[0].id;
      for (const permission of role.permissions) {
        await c.query(
          "insert into role_permissions (organisation_id, role_id, permission) values ($1, $2, $3)",
          [organisationId, r.rows[0].id, permission],
        );
      }
    }

    const u = await c.query(
      `insert into utilisateurs (organisation_id, email, nom, mot_de_passe_hash)
       values ($1, $2, $3, $4) returning id`,
      [organisationId, o.admin.email.toLowerCase(), o.admin.nom, hash],
    );
    await c.query(
      "insert into attributions (organisation_id, utilisateur_id, role_id) values ($1, $2, $3)",
      [organisationId, u.rows[0].id, roleAdmin],
    );
    return { organisationId, adminId: u.rows[0].id, entites };
  });
}
