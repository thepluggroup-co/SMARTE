import type { Client } from "./base.js";
import { ErreurApi, type Contexte } from "./serveur.js";

/** "tout" : l'accès couvre toute l'organisation, comme pour le super administrateur. */
export async function branchesVisibles(c: Client, utilisateurId: string, permission?: string): Promise<{ tout: boolean; ids: string[] }> {
  // Avec une permission, seules comptent les attributions qui la donnent : un rôle ailleurs n'ouvre pas cette branche.
  const { rows } = await c.query(
    `select a.entite_id, case when a.entite_id is null then null else entite_branche(a.entite_id) end as branche
     from attributions a where a.utilisateur_id = $1 and (a.expire_le is null or a.expire_le > now())
       and ($2::text is null or exists (select 1 from role_permissions p where p.role_id = a.role_id and p.permission = $2))`,
    [utilisateurId, permission ?? null],
  );
  return { tout: rows.some((r) => r.branche === null), ids: [...new Set(rows.map((r) => r.branche).filter(Boolean))] };
}

export async function exigerTiersVisible(ctx: Contexte, tiersId: string, permission?: string) {
  const { rows: [t] } = await ctx.client.query("select * from tiers where id = $1", [tiersId]);
  if (!t) throw new ErreurApi(404, "introuvable");
  const v = await branchesVisibles(ctx.client, ctx.utilisateurId, permission);
  if (!v.tout && !v.ids.includes(t.branche_id)) throw new ErreurApi(404, "introuvable");
  return t;
}

export async function exigerNonBloque(c: Client, tiersId: string | null | undefined, portee: "livraison" | "cours" | "certificat"): Promise<void> {
  if (!tiersId) return;
  const { rows } = await c.query("select 1 from blocages_tiers where tiers_id = $1 and portee = $2 and leve_le is null", [tiersId, portee]);
  if (rows[0]) throw new ErreurApi(409, "client_bloque", { portee });
}

/** Une fiche ne sert que dans sa branche. Une fiche du groupe rejoint la première branche qui l'utilise. */
export async function lierTiers(ctx: Contexte, tiersId: string, entiteId: string) {
  const t = await exigerTiersVisible(ctx, tiersId);
  if (t.archive) throw new ErreurApi(404, "introuvable");
  const { rows: [e] } = await ctx.client.query("select entite_branche($1) as branche", [entiteId]);
  if (!e.branche) return t;
  if (t.branche_id && t.branche_id !== e.branche) throw new ErreurApi(409, "tiers_autre_branche");
  if (!t.branche_id) await ctx.client.query("update tiers set branche_id = $2 where id = $1", [tiersId, e.branche]);
  return t;
}
