import { migrer } from "../src/migrations.js";

const { DATABASE_ADMIN_URL, ERP_APP_MOT_DE_PASSE } = process.env;
if (!DATABASE_ADMIN_URL || !ERP_APP_MOT_DE_PASSE) {
  throw new Error("DATABASE_ADMIN_URL et ERP_APP_MOT_DE_PASSE sont obligatoires");
}
console.log("Migrations appliquées :", await migrer(DATABASE_ADMIN_URL, ERP_APP_MOT_DE_PASSE));
