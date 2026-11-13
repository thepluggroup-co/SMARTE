import type { Client } from "./base.js";
import { moduleRequis, type Permission } from "./catalogue.js";
import { ErreurApi, type Contexte } from "./serveur.js";

/** Quand la règle est active, personne ne valide ce qu'il a lui-même préparé. */
export async function exigerSeparation(ctx: Contexte, regle: "ecritures" | "commandes" | "factures_fournisseur" | "pertes", auteurId: string | null): Promise<void> {
  if (!auteurId || auteurId !== ctx.utilisateurId) return;
  const { rows: [r] } = await ctx.client.query("select * from regles_separation");
  const active = r ? r[regle] : regle === "pertes";
  if (active) throw new ErreurApi(409, "separation_des_taches");
}

const ATTRIBUTIONS_ACTIVES = `
  select a.entite_id from attributions a
  join role_permissions rp on rp.role_id = a.role_id
  where a.utilisateur_id = $1 and rp.permission = $2
    and (a.expire_le is null or a.expire_le > now())`;

/**
 * La permission vaut pour cette entité si elle est accordée sur elle, un ancêtre ou toute l'organisation,
 * et si le module concerné y est actif. Le rôle ne suffit donc jamais : un administrateur de GTA n'a aucun
 * droit sur les stocks, car GTA n'a pas ce module. "brut" ignore le module, pour vérifier une délégation de droits.
 */
export async function aPermissionSurEntite(
  client: Client, utilisateurId: string, permission: Permission, entiteId: string, brut = false,
): Promise<boolean> {
  const module = moduleRequis(permission);
  if (module && !brut) {
    const { rows } = await client.query(
      "select actif from modules_entite where entite_id = $1 and module = $2", [entiteId, module],
    );
    if (!rows[0]?.actif) return false;
  }
  const { rows } = await client.query(
    `with recursive ancetres as (
       select id, parent_id from entites where id = $3
       union all select e.id, e.parent_id from entites e join ancetres a on e.id = a.parent_id
     )
     select exists (
       select 1 from (${ATTRIBUTIONS_ACTIVES}) p
       where p.entite_id is null or p.entite_id in (select id from ancetres)
     ) as ok`,
    [utilisateurId, permission, entiteId],
  );
  return rows[0].ok;
}

/** Accordée sur toute l'organisation, sans limite d'entité. */
export async function aPermissionGlobale(
  client: Client, utilisateurId: string, permission: Permission,
): Promise<boolean> {
  const { rows } = await client.query(
    `select exists (select 1 from (${ATTRIBUTIONS_ACTIVES}) p where p.entite_id is null) as ok`,
    [utilisateurId, permission],
  );
  return rows[0].ok;
}

/** Accordée au moins sur une entité : suffit pour les données partagées comme les tiers. */
export async function aPermission(
  client: Client, utilisateurId: string, permission: Permission,
): Promise<boolean> {
  if (moduleRequis(permission)) return (await entitesAccessibles(client, utilisateurId, permission)).length > 0;
  const { rows } = await client.query(
    `select exists (${ATTRIBUTIONS_ACTIVES}) as ok`, [utilisateurId, permission],
  );
  return rows[0].ok;
}

export async function entitesAccessibles(
  client: Client, utilisateurId: string, permission: Permission,
): Promise<Record<string, unknown>[]> {
  const { rows } = await client.query(
    `with recursive p as (${ATTRIBUTIONS_ACTIVES}),
     portee as (
       select e.id from entites e
       where exists (select 1 from p where p.entite_id is null)
          or e.id in (select entite_id from p)
       union
       select e.id from entites e join portee on e.parent_id = portee.id
     )
     select e.id, e.parent_id, e.code, e.nom, e.type, e.actif, e.domaine
     from entites e where e.id in (select id from portee)
       and ($3::text is null or exists (select 1 from modules_entite m where m.entite_id = e.id and m.module = $3 and m.actif))
     order by e.nom`,
    [utilisateurId, permission, moduleRequis(permission)],
  );
  return rows;
}
