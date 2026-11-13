import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

/** Applique les migrations dans l'ordre, chacune dans une transaction. */
export async function migrer(adminUrl: string, motDePasseApp: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  const appliquees: string[] = [];
  try {
    await client.query("select pg_advisory_lock(727001)");
    const existe = await client.query("select 1 from pg_roles where rolname = 'erp_app'");
    const mdp = client.escapeLiteral(motDePasseApp);
    await client.query(
      existe.rows[0]
        ? `alter role erp_app login password ${mdp}`
        : `create role erp_app login password ${mdp} nosuperuser nocreatedb nocreaterole nobypassrls`,
    );
    await client.query(
      "create table if not exists schema_migrations (nom text primary key, appliquee_le timestamptz not null default now())",
    );
    const dossier = join(import.meta.dirname, "..", "migrations");
    for (const nom of (await readdir(dossier)).filter((f) => f.endsWith(".sql")).sort()) {
      const deja = await client.query("select 1 from schema_migrations where nom = $1", [nom]);
      if (deja.rows[0]) continue;
      await client.query("begin");
      try {
        await client.query(await readFile(join(dossier, nom), "utf8"));
        await client.query("insert into schema_migrations (nom) values ($1)", [nom]);
        await client.query("commit");
      } catch (e) {
        await client.query("rollback");
        throw e;
      }
      appliquees.push(nom);
    }
    return appliquees;
  } finally {
    await client.end();
  }
}
