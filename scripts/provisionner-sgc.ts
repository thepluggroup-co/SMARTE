import pg from "pg";
import { provisionnerOrganisation, STRUCTURE_SGC } from "../src/provisionnement.js";

const { DATABASE_ADMIN_URL, SGC_ADMIN_EMAIL, SGC_ADMIN_MOT_DE_PASSE } = process.env;
if (!DATABASE_ADMIN_URL || !SGC_ADMIN_EMAIL || !SGC_ADMIN_MOT_DE_PASSE) {
  throw new Error("DATABASE_ADMIN_URL, SGC_ADMIN_EMAIL et SGC_ADMIN_MOT_DE_PASSE sont obligatoires");
}
if (SGC_ADMIN_MOT_DE_PASSE.length < 8) throw new Error("SGC_ADMIN_MOT_DE_PASSE doit compter 8 caractères au moins");
const pool = new pg.Pool({ connectionString: DATABASE_ADMIN_URL });
const { organisationId } = await provisionnerOrganisation(pool, {
  slug: "sgc",
  nom: "Smart Global Concepts Group Sarl",
  racine: STRUCTURE_SGC,
  admin: { email: SGC_ADMIN_EMAIL, nom: "Administrateur SGC", motDePasse: SGC_ADMIN_MOT_DE_PASSE },
});
console.log("Organisation créée :", organisationId);
await pool.end();
