import pg from "pg";

export type Client = pg.PoolClient;

// Une date reste une date : pas de décalage de fuseau. Les montants en FCFA tiennent dans un nombre.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

/**
 * Exécute fn dans une transaction limitée à une organisation.
 * Le contexte disparaît à la fin de la transaction : il ne peut pas fuiter
 * vers la requête suivante qui réutilise la même connexion.
 */
export async function dansOrganisation<T>(
  pool: pg.Pool,
  organisationId: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.organisation_id', $1, true)", [organisationId]);
    const resultat = await fn(client);
    await client.query("commit");
    return resultat;
  } catch (erreur) {
    await client.query("rollback");
    throw erreur;
  } finally {
    client.release();
  }
}

export async function definirActeur(client: Client, utilisateurId: string): Promise<void> {
  await client.query("select set_config('app.utilisateur_id', $1, true)", [utilisateurId]);
}

export async function publierEvenement(client: Client, type: string, charge: object): Promise<void> {
  await client.query(
    "insert into evenements (organisation_id, type, charge) values (org_courante(), $1, $2)",
    [type, JSON.stringify(charge)],
  );
}

/** Une connexion à la base ne traite qu'une requête à la fois : on les enchaîne au lieu de les lancer ensemble. */
export async function enchainer<T extends readonly unknown[]>(taches: { [K in keyof T]: () => Promise<T[K]> }): Promise<T> {
  const r: unknown[] = [];
  for (const t of taches as readonly (() => Promise<unknown>)[]) r.push(await t());
  return r as unknown as T;
}
