import pg from "pg";
import { provisionnerLieuxGlomari } from "../src/provisionnement.js";

const { DATABASE_ADMIN_URL } = process.env;
const slug = process.env.ORGANISATION_SLUG ?? "sgc";
if (!DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL est obligatoire");
const pool = new pg.Pool({ connectionString: DATABASE_ADMIN_URL });
try {
  const { rows: [o] } = await pool.query("select organisation_active_par_slug($1) as id", [slug]);
  if (!o?.id) throw new Error(`Organisation active « ${slug} » introuvable`);
  const { crees, existants } = await provisionnerLieuxGlomari(pool, o.id);
  console.log("Lieux créés :", crees.length ? crees.join(", ") : "aucun");
  console.log("Lieux déjà présents :", existants.length ? existants.join(", ") : "aucun");
} finally {
  await pool.end();
}
