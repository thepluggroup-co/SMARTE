import type { FastifyInstance } from "fastify";
import { publierEvenement } from "./base.js";
import { prochainNumero } from "./formations.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";

export interface Tranche { jusqua: number | null; taux: number }
export interface Rubrique {
  code: string; libelle: string; sens: "gain" | "retenue" | "charge"; mode: "fixe" | "pourcentage" | "bareme";
  assiette: "base" | "brut" | "apres_retenues" | "rubrique"; assiette_rubrique?: string | null;
  montant?: number | null; taux?: number | string | null; plafond?: number | null;
  abattement_pct?: number | string | null; annualise?: boolean; tranches?: Tranche[] | null;
}
export interface Variable { libelle: string; sens: "gain" | "retenue"; montant: number }
export interface LigneBulletin { code: string; libelle: string; sens: string; assiette: number | null; montant: number }

/** Calcul progressif : chaque tranche ne s'applique qu'à ce qui se situe dans cette tranche. */
export function appliquerBareme(assiette: number, tranches: Tranche[]): number {
  let total = 0;
  let bas = 0;
  for (const t of tranches) {
    const haut = t.jusqua ?? Infinity;
    if (assiette > bas) total += ((Math.min(assiette, haut) - bas) * t.taux) / 100;
    bas = haut;
  }
  return total;
}

/**
 * Applique les rubriques saisies, dans leur ordre, sans contenir aucun taux légal.
 * Tous les montants sont arrondis au franc près, ligne par ligne.
 */
export function calculerBulletin(base: number, rubriques: Rubrique[], variables: Variable[] = []) {
  const lignes: LigneBulletin[] = [{ code: "BASE", libelle: "Salaire de base", sens: "gain", assiette: null, montant: base }];
  const montants = new Map<string, number>([["BASE", base]]);
  const calcul = (r: Rubrique, assietteBrute: number) => {
    if (r.mode === "fixe") return { assiette: null, montant: Math.round(r.montant ?? 0) };
    const plafonnee = r.plafond != null ? Math.min(assietteBrute, r.plafond) : assietteBrute;
    const assiette = plafonnee * (1 - Number(r.abattement_pct ?? 0) / 100);
    if (r.mode === "pourcentage") return { assiette: Math.round(assiette), montant: Math.round((assiette * Number(r.taux ?? 0)) / 100) };
    const montant = r.annualise ? appliquerBareme(assiette * 12, r.tranches ?? []) / 12 : appliquerBareme(assiette, r.tranches ?? []);
    return { assiette: Math.round(assiette), montant: Math.round(montant) };
  };
  const noter = (r: Rubrique, c: { assiette: number | null; montant: number }) => {
    lignes.push({ code: r.code, libelle: r.libelle, sens: r.sens, ...c });
    montants.set(r.code, c.montant);
    return c.montant;
  };
  let brut = base;
  for (const r of rubriques.filter((x) => x.sens === "gain")) brut += noter(r, calcul(r, base));
  for (const v of variables.filter((x) => x.sens === "gain")) {
    lignes.push({ code: "VARIABLE", libelle: v.libelle, sens: "gain", assiette: null, montant: v.montant });
    brut += v.montant;
  }
  let retenues = 0;
  let charges = 0;
  for (const r of rubriques.filter((x) => x.sens !== "gain")) {
    let assiette = brut;
    if (r.assiette === "base") assiette = base;
    if (r.assiette === "apres_retenues") assiette = brut - retenues;
    if (r.assiette === "rubrique") {
      const m = montants.get(r.assiette_rubrique ?? "");
      if (m === undefined) throw new ErreurApi(409, "rubrique_invalide", { code: r.code });
      assiette = m;
    }
    const m = noter(r, calcul(r, assiette));
    if (r.sens === "retenue") retenues += m; else charges += m;
  }
  for (const v of variables.filter((x) => x.sens === "retenue")) {
    lignes.push({ code: "VARIABLE", libelle: v.libelle, sens: "retenue", assiette: null, montant: v.montant });
    retenues += v.montant;
  }
  return { lignes, brut, retenues, charges, net: brut - retenues };
}

const uuid = { type: "string", format: "uuid" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const entier = { type: "integer", minimum: 0, maximum: 100_000_000_000 } as const;

const schemaRubrique = {
  type: "object", required: ["code", "libelle", "sens", "mode"],
  properties: {
    code: { type: "string", pattern: "^[A-Za-z0-9_]{1,30}$" }, libelle: { type: "string", minLength: 1, maxLength: 200 },
    sens: { type: "string", enum: ["gain", "retenue", "charge"] }, mode: { type: "string", enum: ["fixe", "pourcentage", "bareme"] },
    assiette: { type: "string", enum: ["base", "brut", "apres_retenues", "rubrique"] }, assietteRubrique: { type: "string", maxLength: 30 },
    montant: entier, taux: { type: "number", minimum: 0, maximum: 1000 }, plafond: entier,
    abattementPct: { type: "number", minimum: 0, maximum: 100 }, annualise: { type: "boolean" },
    tranches: {
      type: "array", minItems: 1, maxItems: 30,
      items: {
        type: "object", required: ["taux"],
        properties: { jusqua: { type: ["integer", "null"], minimum: 1 }, taux: { type: "number", minimum: 0, maximum: 100 } },
      },
    },
    ordre: { type: "integer", minimum: 0, maximum: 100000 }, actif: { type: "boolean" },
  },
} as const;
interface CorpsRubrique {
  code: string; libelle: string; sens: string; mode: string; assiette?: string; assietteRubrique?: string; montant?: number; taux?: number;
  plafond?: number; abattementPct?: number; annualise?: boolean; tranches?: Tranche[]; ordre?: number; actif?: boolean;
}

function verifierRubrique(b: CorpsRubrique): void {
  const ok = b.mode === "fixe" ? b.montant !== undefined
    : b.mode === "pourcentage" ? b.taux !== undefined
    : !!b.tranches?.length && b.sens !== "gain"
      && b.tranches.every((t, i, l) => (i === l.length - 1 ? t.jusqua == null : t.jusqua != null && t.jusqua > (l[i - 1]?.jusqua ?? 0)));
  if (!ok || (b.assiette === "rubrique" && !b.assietteRubrique)) throw new ErreurApi(400, "rubrique_invalide");
}

/**
 * Confidentiel : tout passe par le droit rh.paie, et le journal ne reçoit jamais de montant.
 * Ces tables n'ont donc volontairement pas le déclencheur d'audit détaillé.
 */
export function enregistrerPaie(app: FastifyInstance, outils: Outils): void {
  const { protege, exigerSurEntite } = outils;

  const employePaie = async (ctx: Contexte, id: string) => {
    const { rows } = await ctx.client.query("select * from employes where id = $1", [id]);
    if (!rows[0]) throw new ErreurApi(404, "introuvable");
    await exigerSurEntite(ctx, "rh.paie", rows[0].entite_id);
    return rows[0];
  };
  const noter = (ctx: Contexte, action: string, details: object) =>
    ctx.client.query("select journal_evenement($1, $2)", [action, JSON.stringify(details)]);

  app.get<{ Params: { id: string } }>("/employes/:id/salaire", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await employePaie(ctx, req.params.id);
      const { rows } = await ctx.client.query("select salaire_base, maj_le from salaires where employe_id = $1", [req.params.id]);
      return rows[0] ?? { salaire_base: null };
    }),
  );

  app.put<{ Params: { id: string }; Body: { salaireBase: number } }>("/employes/:id/salaire", {
    schema: { params: paramId, body: { type: "object", required: ["salaireBase"], properties: { salaireBase: entier } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await employePaie(ctx, req.params.id);
      await ctx.client.query(
        `insert into salaires (organisation_id, employe_id, salaire_base) values ($1, $2, $3)
         on conflict (organisation_id, employe_id) do update set salaire_base = excluded.salaire_base, maj_le = now()`,
        [ctx.organisationId, req.params.id, req.body.salaireBase],
      );
      // Un brouillon calculé sur l'ancien salaire ne doit pas pouvoir être validé.
      await ctx.client.query("delete from bulletins_paie where employe_id = $1 and statut = 'brouillon'", [req.params.id]);
      await noter(ctx, "paie.salaire_modifie", { employe: req.params.id });
      return { salaire_base: req.body.salaireBase };
    }),
  );

  const etatEntite = async (ctx: Contexte, entiteId: string) => {
    const { rows } = await ctx.client.query("select expert, valide_le, saisi_le from validations_paie where entite_id = $1", [entiteId]);
    return rows[0] ?? null;
  };

  app.get<{ Querystring: { entiteId: string } }>("/rubriques-paie", {
    schema: { querystring: { type: "object", required: ["entiteId"], properties: { entiteId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "rh.paie", req.query.entiteId);
      const { rows } = await ctx.client.query("select * from rubriques_paie where entite_id = $1 order by ordre, code", [req.query.entiteId]);
      return { rubriques: rows, validation: await etatEntite(ctx, req.query.entiteId) };
    }),
  );

  const invaliderExpert = async (ctx: Contexte, entiteId: string) => {
    const { rowCount } = await ctx.client.query("delete from validations_paie where entite_id = $1", [entiteId]);
    if (rowCount) await noter(ctx, "paie.validation_retiree", { entite: entiteId });
  };
  const valeursRubrique = (b: CorpsRubrique) => [
    b.libelle, b.sens, b.mode, b.assiette ?? "brut", b.assietteRubrique ?? null, b.montant ?? null, b.taux ?? null, b.plafond ?? null,
    b.abattementPct ?? 0, b.annualise ?? false, b.tranches ? JSON.stringify(b.tranches) : null, b.ordre ?? 100, b.actif ?? true,
  ];

  app.post<{ Body: CorpsRubrique & { entiteId: string } }>("/rubriques-paie", {
    schema: {
      body: { ...schemaRubrique, required: [...schemaRubrique.required, "entiteId"], properties: { ...schemaRubrique.properties, entiteId: uuid } },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "rh.paie", b.entiteId);
      verifierRubrique(b);
      await invaliderExpert(ctx, b.entiteId);
      const { rows } = await ctx.client.query(
        `insert into rubriques_paie (libelle, sens, mode, assiette, assiette_rubrique, montant, taux, plafond, abattement_pct, annualise, tranches, ordre, actif, organisation_id, entite_id, code)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning *`,
        [...valeursRubrique(b), ctx.organisationId, b.entiteId, b.code],
      );
      return rows[0];
    });
    return reponse.status(201).send(r);
  });

  app.put<{ Params: { id: string }; Body: CorpsRubrique }>("/rubriques-paie/:id", {
    schema: { params: paramId, body: schemaRubrique },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [a] } = await ctx.client.query("select entite_id from rubriques_paie where id = $1", [req.params.id]);
      if (!a) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "rh.paie", a.entite_id);
      verifierRubrique(req.body);
      await invaliderExpert(ctx, a.entite_id);
      const { rows } = await ctx.client.query(
        `update rubriques_paie set libelle = $1, sens = $2, mode = $3, assiette = $4, assiette_rubrique = $5, montant = $6, taux = $7, plafond = $8,
           abattement_pct = $9, annualise = $10, tranches = $11, ordre = $12, actif = $13, code = $14 where id = $15 returning *`,
        [...valeursRubrique(req.body), req.body.code, req.params.id],
      );
      return rows[0];
    }),
  );

  /** La personne qui gère la paie ne peut pas se valider elle-même : ce droit reste à l'administration de l'entité. */
  app.put<{ Body: { entiteId: string; expert: string; valideLe: string } }>("/paie/validation", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "expert", "valideLe"],
        properties: { entiteId: uuid, expert: { type: "string", minLength: 3, maxLength: 200 }, valideLe: { type: "string", format: "date" } },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "entites.gerer", b.entiteId);
      await ctx.client.query(
        `insert into validations_paie (organisation_id, entite_id, expert, valide_le, saisi_par) values ($1, $2, $3, $4, $5)
         on conflict (organisation_id, entite_id) do update set expert = excluded.expert, valide_le = excluded.valide_le, saisi_par = excluded.saisi_par, saisi_le = now()`,
        [ctx.organisationId, b.entiteId, b.expert, b.valideLe, ctx.utilisateurId],
      );
      await noter(ctx, "paie.validation_expert", { entite: b.entiteId, expert: b.expert, valide_le: b.valideLe });
      return { expert: b.expert, valide_le: b.valideLe };
    }),
  );

  app.get<{ Params: { id: string } }>("/employes/:id/bulletins", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      await employePaie(ctx, req.params.id);
      return (await ctx.client.query("select * from bulletins_paie where employe_id = $1 order by periode desc, cree_le desc", [req.params.id])).rows;
    }),
  );

  app.post<{ Body: { employeId: string; periode: string; variables?: Variable[] } }>("/bulletins", {
    schema: {
      body: {
        type: "object", required: ["employeId", "periode"],
        properties: {
          employeId: uuid, periode: { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" },
          variables: {
            type: "array", maxItems: 50,
            items: {
              type: "object", required: ["libelle", "sens", "montant"],
              properties: { libelle: { type: "string", minLength: 1, maxLength: 200 }, sens: { type: "string", enum: ["gain", "retenue"] }, montant: entier },
            },
          },
        },
      },
    },
  }, async (req, reponse) => {
    const b = await protege(req, async (ctx) => {
      const e = await employePaie(ctx, req.body.employeId);
      const { rows: [s] } = await ctx.client.query("select salaire_base from salaires where employe_id = $1", [e.id]);
      if (!s) throw new ErreurApi(409, "salaire_manquant");
      const { rows: rubriques } = await ctx.client.query(
        "select * from rubriques_paie where entite_id = $1 and actif order by ordre, code", [e.entite_id],
      );
      const r = calculerBulletin(s.salaire_base, rubriques, req.body.variables);
      if (r.net < 0) throw new ErreurApi(409, "net_negatif");
      const { rows } = await ctx.client.query(
        `insert into bulletins_paie (organisation_id, employe_id, periode, salaire_base, brut, retenues, charges, net, lignes, cree_par)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
        [ctx.organisationId, e.id, req.body.periode, s.salaire_base, r.brut, r.retenues, r.charges, r.net, JSON.stringify(r.lignes), ctx.utilisateurId],
      );
      await noter(ctx, "paie.bulletin_cree", { bulletin: rows[0].id, periode: req.body.periode });
      return rows[0];
    });
    return reponse.status(201).send(b);
  });

  const bulletin = async (ctx: Contexte, id: string) => {
    const { rows } = await ctx.client.query("select * from bulletins_paie where id = $1 for update", [id]);
    if (!rows[0]) throw new ErreurApi(404, "introuvable");
    return { b: rows[0], e: await employePaie(ctx, rows[0].employe_id) };
  };

  app.get<{ Params: { id: string } }>("/bulletins/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { b, e } = await bulletin(ctx, req.params.id);
      return { ...b, employe: e.nom, matricule: e.matricule, poste: e.poste };
    }),
  );

  app.post<{ Params: { id: string } }>("/bulletins/:id/validation", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { b, e } = await bulletin(ctx, req.params.id);
      if (b.statut !== "brouillon") throw new ErreurApi(409, "bulletin_fige");
      const v = await etatEntite(ctx, e.entite_id);
      if (!v) throw new ErreurApi(409, "paie_non_validee");
      if (new Date(b.cree_le) < new Date(v.saisi_le)) throw new ErreurApi(409, "bulletin_a_recalculer");
      const numero = await prochainNumero(ctx.client, `PAIE-${b.periode.slice(0, 4)}`);
      const { rows } = await ctx.client.query(
        "update bulletins_paie set statut = 'valide', numero = $2, expert = $3, valide_par = $4, valide_le = now() where id = $1 returning *",
        [b.id, numero, v.expert, ctx.utilisateurId],
      );
      await noter(ctx, "paie.bulletin_valide", { bulletin: b.id, periode: b.periode, numero });
      await publierEvenement(ctx.client, "paie.bulletin_valide", { id: b.id });
      return rows[0];
    }),
  );

  app.delete<{ Params: { id: string } }>("/bulletins/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { b } = await bulletin(ctx, req.params.id);
      if (b.statut !== "brouillon") throw new ErreurApi(409, "bulletin_fige");
      await ctx.client.query("delete from bulletins_paie where id = $1", [b.id]);
      return { supprime: true };
    }),
  );

  app.post<{ Params: { id: string }; Body: { motif: string } }>("/bulletins/:id/annulation", {
    schema: { params: paramId, body: { type: "object", required: ["motif"], properties: { motif: { type: "string", minLength: 5, maxLength: 500 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { b } = await bulletin(ctx, req.params.id);
      if (b.statut !== "valide") throw new ErreurApi(409, "bulletin_fige");
      const { rows: verse } = await ctx.client.query("select 1 from versements_paie where bulletin_id = $1", [b.id]);
      if (verse[0]) throw new ErreurApi(409, "bulletin_deja_verse");
      await ctx.client.query("update bulletins_paie set statut = 'annule', motif_annulation = $2 where id = $1", [b.id, req.body.motif]);
      await noter(ctx, "paie.bulletin_annule", { bulletin: b.id });
      return { annule: true };
    }),
  );
}
