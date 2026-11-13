import { exigerSeparation } from "./permissions.js";
import type { FastifyInstance } from "fastify";
import type { Client } from "./base.js";
import { prochainNumero } from "./formations.js";
import { entitesAccessibles } from "./permissions.js";
import { JOURNAUX_DE_DEPART, PARAMETRES_DE_DEPART, PLAN_DE_DEPART } from "./plan_comptable.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";
import { exigerTiersVisible } from "./tiers.js";

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const queryPeriode = {
  type: "object", required: ["brancheId", "debut", "fin"],
  properties: { brancheId: uuid, debut: date, fin: date, compte: { type: "string", maxLength: 12 } },
} as const;
const AUJOURDHUI = "(now() at time zone 'Africa/Douala')::date";

export interface LigneSaisie { numero: string; debit?: number; credit?: number; tiersId?: string | null; section?: string | null; libelle?: string | null }
export interface Proposition { sourceType: string; sourceId: string; journal: string; date: string; libelle: string; piece: string | null; lignes: LigneSaisie[] }

/** Un montant négatif passe de l'autre côté, et une ligne à zéro n'existe pas. */
export function ligne(numero: string, montant: number, tiersId?: string | null, section?: string | null): LigneSaisie[] {
  if (!montant) return [];
  return [{ numero, ...(montant > 0 ? { debit: montant } : { credit: -montant }), tiersId, section }];
}

export function totaux(lignes: { debit?: number; credit?: number }[]) {
  return lignes.reduce<{ debit: number; credit: number }>((t, l) => ({ debit: t.debit + (l.debit ?? 0), credit: t.credit + (l.credit ?? 0) }), { debit: 0, credit: 0 });
}

/** Regroupe la balance en états : le résultat vient des classes 6 à 8, et le bilan doit s'équilibrer avec lui. */
export function etatsDeSynthese(balance: { numero: string; libelle: string; debit: number; credit: number }[]) {
  const solde = (b: { debit: number; credit: number }) => b.debit - b.credit;
  const classe = (b: { numero: string }) => Number(b.numero[0]);
  const parRubrique = (liste: typeof balance, signe: number) => {
    const m = new Map<string, number>();
    for (const b of liste) m.set(b.numero.slice(0, 2), (m.get(b.numero.slice(0, 2)) ?? 0) + signe * solde(b));
    return [...m].filter(([, v]) => v !== 0).sort().map(([rubrique, montant]) => ({ rubrique, montant }));
  };
  const resultat = -balance.filter((b) => [6, 7, 8].includes(classe(b))).reduce((s, b) => s + solde(b), 0);
  const haut = balance.filter((b) => [2, 3].includes(classe(b)));
  const tiersTreso = balance.filter((b) => [4, 5].includes(classe(b)));
  const actif = [...haut, ...tiersTreso.filter((b) => solde(b) > 0)];
  const passif = [...balance.filter((b) => classe(b) === 1), ...tiersTreso.filter((b) => solde(b) < 0)];
  const totalActif = actif.reduce((s, b) => s + solde(b), 0);
  const totalPassif = -passif.reduce((s, b) => s + solde(b), 0) + resultat;
  return {
    resultat, totalActif, totalPassif, equilibre: totalActif === totalPassif,
    charges: parRubrique(balance.filter((b) => classe(b) === 6 || ["81", "83", "85", "87", "89"].includes(b.numero.slice(0, 2))), 1),
    produits: parRubrique(balance.filter((b) => classe(b) === 7 || ["82", "84", "86", "88"].includes(b.numero.slice(0, 2))), -1),
    actif: parRubrique(actif, 1), passif: parRubrique(passif, -1),
  };
}

/** Évite qu'une cellule de tableur soit interprétée comme une formule. */
export function celluleCsv(v: unknown): string {
  const t = String(v ?? "");
  const sur = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
  return /[";\n\r]/.test(sur) ? `"${sur.replace(/"/g, '""')}"` : sur;
}

/** Tout ce que les autres modules ont produit et qui n'a pas encore d'écriture. */
async function pieces(c: Client, brancheId: string, fin: string, p: Record<string, string>): Promise<Proposition[]> {
  const res: Proposition[] = [];
  const pas = (type: string, col: string) => `not exists (select 1 from ecritures e where e.source_type = '${type}' and e.source_id = ${col})`;
  const compteMoyen = (m: string) => p[m] ?? p.attente!;
  const ajout = (x: Proposition) => res.push(x);

  const docs = await c.query(
    `select d.id, d.type, d.numero, d.date_document::text as date, d.tiers_id, d.total_ht, d.total_taxes, d.total_ttc, e.nom as section,
       coalesce((select sum(l.montant_ht) from lignes_vente l join produits x on x.id = l.produit_id where l.document_id = d.id and x.type = 'produit'), 0)::int8 as marchandises
     from documents_vente d join entites e on e.id = d.entite_id
     where d.type in ('facture', 'avoir') and d.numero is not null and d.statut <> 'brouillon' and entite_branche(d.entite_id) = $1 and d.date_document <= $2 and ${pas("document", "d.id")}
     order by d.date_document limit 2000`,
    [brancheId, fin],
  );
  for (const d of docs.rows) {
    const s = d.type === "avoir" ? -1 : 1;
    ajout({
      sourceType: "document", sourceId: d.id, journal: "VE", date: d.date, libelle: `${d.type === "avoir" ? "Avoir" : "Facture"} ${d.numero}`, piece: d.numero,
      lignes: [
        ...ligne(p.clients!, s * d.total_ttc, d.tiers_id, d.section),
        ...ligne(p.ventes_marchandises!, -s * d.marchandises, null, d.section),
        ...ligne(p.ventes_services!, -s * (d.total_ht - d.marchandises), null, d.section),
        ...ligne(p.tva_collectee!, -s * d.total_taxes, null, d.section),
      ],
    });
  }

  for (const annule of [false, true]) {
    const type = annule ? "reglement_annule" : "reglement";
    const { rows } = await c.query(
      `select r.id, r.montant, r.moyen, r.numero_recu, d.tiers_id, e.nom as section, ((${annule ? "r.annule_le" : "r.encaisse_le"}) at time zone 'Africa/Douala')::date::text as date
       from reglements r join documents_vente d on d.id = r.facture_id join entites e on e.id = d.entite_id
       where entite_branche(d.entite_id) = $1 ${annule ? "and r.annule_le is not null" : ""} and ((${annule ? "r.annule_le" : "r.encaisse_le"}) at time zone 'Africa/Douala')::date <= $2 and ${pas(type, "r.id")} limit 2000`,
      [brancheId, fin],
    );
    for (const r of rows) {
      const s = annule ? -1 : 1;
      ajout({
        sourceType: type, sourceId: r.id, journal: r.moyen === "especes" ? "CA" : "BQ", date: r.date, libelle: `${annule ? "Annulation du r" : "R"}èglement ${r.numero_recu}`, piece: r.numero_recu,
        lignes: [...ligne(compteMoyen(r.moyen), s * r.montant, null, r.section), ...ligne(p.clients!, -s * r.montant, r.tiers_id, r.section)],
      });
    }
    const type2 = annule ? "paiement_annule" : "paiement";
    const { rows: forma } = await c.query(
      `select x.id, x.montant, x.moyen, x.numero_recu, i.tiers_id, s.code as section, ((${annule ? "x.annule_le" : "x.encaisse_le"}) at time zone 'Africa/Douala')::date::text as date
       from paiements x join inscriptions i on i.id = x.inscription_id join sessions_formation s on s.id = i.session_id
       where entite_branche(s.entite_id) = $1 ${annule ? "and x.annule_le is not null" : ""} and ((${annule ? "x.annule_le" : "x.encaisse_le"}) at time zone 'Africa/Douala')::date <= $2 and ${pas(type2, "x.id")} limit 2000`,
      [brancheId, fin],
    );
    for (const r of forma) {
      const s = annule ? -1 : 1;
      ajout({
        sourceType: type2, sourceId: r.id, journal: r.moyen === "especes" ? "CA" : "BQ", date: r.date, libelle: `${annule ? "Annulation du r" : "R"}eçu de formation ${r.numero_recu}`, piece: r.numero_recu,
        lignes: [...ligne(compteMoyen(r.moyen), s * r.montant, null, r.section), ...ligne(p.formations!, -s * r.montant, r.tiers_id, r.section)],
      });
    }
    const type3 = annule ? "vente_annulee" : "vente";
    const { rows: ventes } = await c.query(
      `select v.id, v.numero, v.tiers_id, v.total_ht, v.total_taxes, v.rendu, e.nom as section, ((${annule ? "v.annulee_le" : "coalesce(v.vendue_le, v.cree_le)"}) at time zone 'Africa/Douala')::date::text as date,
         coalesce((select sum(l.montant_ht) from lignes_comptoir l join produits x on x.id = l.produit_id where l.vente_id = v.id and x.type = 'produit'), 0)::int8 as marchandises,
         (select json_agg(json_build_object('moyen', y.moyen, 'montant', y.montant)) from paiements_comptoir y where y.vente_id = v.id) as paiements
       from ventes_comptoir v join entites e on e.id = v.entite_id
       where entite_branche(v.entite_id) = $1 ${annule ? "and v.annulee_le is not null" : ""} and ((${annule ? "v.annulee_le" : "coalesce(v.vendue_le, v.cree_le)"}) at time zone 'Africa/Douala')::date <= $2 and ${pas(type3, "v.id")} limit 2000`,
      [brancheId, fin],
    );
    for (const v of ventes) {
      const s = annule ? -1 : 1;
      const paiements = (v.paiements ?? []) as { moyen: string; montant: number }[];
      // Le rendu ne se retire qu'une fois, même avec plusieurs lignes d'espèces.
      let aRendre = Number(v.rendu);
      const nets = paiements.map((x) => { if (x.moyen !== "especes") return x.montant; const r = Math.min(aRendre, x.montant); aRendre -= r; return x.montant - r; });
      ajout({
        sourceType: type3, sourceId: v.id, journal: "VE", date: v.date, libelle: `${annule ? "Annulation de la v" : "V"}ente ${v.numero}`, piece: v.numero,
        lignes: [
          ...paiements.flatMap((x, n) => ligne(x.moyen === "points" ? p.fidelite! : compteMoyen(x.moyen), s * nets[n]!, null, v.section)),
          ...ligne(p.ventes_marchandises!, -s * v.marchandises, null, v.section),
          ...ligne(p.ventes_services!, -s * (v.total_ht - v.marchandises), null, v.section),
          ...ligne(p.tva_collectee!, -s * v.total_taxes, null, v.section),
        ],
      });
    }
  }

  // Factures fournisseurs et leurs paiements. Une facture d'investissement seul passe au compte dédié.
  const { rows: ff } = await c.query(
    `select f.id, f.numero, f.numero_fournisseur, f.fournisseur_id, f.total_taxes, f.total_ttc, f.date_facture::text as date, e.nom as section,
       (select json_agg(json_build_object('compte', l.compte_numero, 'ht', l.montant_ht) order by l.ordre) from lignes_facture_fournisseur l where l.facture_id = f.id) as lignes
     from factures_fournisseur f join entites e on e.id = f.entite_id
     where entite_branche(f.entite_id) = $1 and f.numero is not null and f.date_facture <= $2 and ${pas("facture_fournisseur", "f.id")} limit 2000`,
    [brancheId, fin],
  );
  const estInvest = (ls: { compte: string }[]) => ls.every((l) => l.compte.startsWith("2"));
  for (const f of ff) {
    const ls = f.lignes as { compte: string; ht: number }[];
    ajout({
      sourceType: "facture_fournisseur", sourceId: f.id, journal: "AC", date: f.date, libelle: `Facture ${f.numero_fournisseur}`, piece: f.numero,
      lignes: [
        ...ls.flatMap((l) => ligne(l.compte, l.ht, null, f.section)),
        ...ligne(p.tva_recuperable!, f.total_taxes, null, f.section),
        ...ligne(estInvest(ls) ? p.fournisseurs_investissement! : p.fournisseurs!, -f.total_ttc, f.fournisseur_id, f.section),
      ],
    });
  }
  const { rows: ffa } = await c.query(
    `select f.id, f.numero, f.fournisseur_id, f.total_taxes, f.total_ttc, (f.annulee_le at time zone 'Africa/Douala')::date::text as date,
       (select json_agg(json_build_object('compte', l.compte_numero, 'ht', l.montant_ht) order by l.ordre) from lignes_facture_fournisseur l where l.facture_id = f.id) as lignes
     from factures_fournisseur f where entite_branche(f.entite_id) = $1 and f.numero is not null and f.annulee_le is not null and (f.annulee_le at time zone 'Africa/Douala')::date <= $2 and ${pas("facture_fournisseur_annulee", "f.id")} limit 2000`,
    [brancheId, fin],
  );
  for (const f of ffa) {
    const ls = f.lignes as { compte: string; ht: number }[];
    ajout({
      sourceType: "facture_fournisseur_annulee", sourceId: f.id, journal: "AC", date: f.date, libelle: `Annulation de la facture ${f.numero}`, piece: f.numero,
      lignes: [
        ...ls.flatMap((l) => ligne(l.compte, -l.ht)),
        ...ligne(p.tva_recuperable!, -f.total_taxes),
        ...ligne(estInvest(ls) ? p.fournisseurs_investissement! : p.fournisseurs!, f.total_ttc, f.fournisseur_id),
      ],
    });
  }
  for (const annule of [false, true]) {
    const type = annule ? "paiement_fournisseur_annule" : "paiement_fournisseur";
    const quand = annule ? "x.annule_le" : "x.cree_le";
    const { rows } = await c.query(
      `select x.id, x.montant, x.reference, w.type as portefeuille, f.fournisseur_id, f.numero, ${annule ? "(x.annule_le at time zone 'Africa/Douala')::date::text" : "x.date_paiement::text"} as date,
         (select bool_and(l.compte_numero like '2%') from lignes_facture_fournisseur l where l.facture_id = f.id) as invest
       from paiements_fournisseur x join factures_fournisseur f on f.id = x.facture_id join portefeuilles w on w.id = x.portefeuille_id
       where entite_branche(f.entite_id) = $1 ${annule ? "and x.annule_le is not null" : ""} and (${quand} at time zone 'Africa/Douala')::date <= $2 and ${pas(type, "x.id")} limit 2000`,
      [brancheId, fin],
    );
    for (const r of rows) {
      const s = annule ? -1 : 1;
      ajout({
        sourceType: type, sourceId: r.id, journal: r.portefeuille === "especes" ? "CA" : "BQ", date: r.date, libelle: `${annule ? "Annulation du p" : "P"}aiement ${r.numero}`, piece: r.reference,
        lignes: [...ligne(r.invest ? p.fournisseurs_investissement! : p.fournisseurs!, s * r.montant, r.fournisseur_id), ...ligne(compteMoyen(r.portefeuille), -s * r.montant)],
      });
    }
  }
  // Dotations et cessions d'immobilisations.
  const { rows: dot } = await c.query(
    `select d.id, d.annee, d.montant, i.code, i.designation, i.compte_amort, i.compte_dotation from dotations_immobilisation d join immobilisations i on i.id = d.immobilisation_id
     where i.branche_id = $1 and d.annee <= extract(year from $2::date)::int and ${pas("dotation", "d.id")} limit 2000`,
    [brancheId, fin],
  );
  for (const d of dot) {
    ajout({
      sourceType: "dotation", sourceId: d.id, journal: "IM", date: `${d.annee}-12-31`, libelle: `Dotation ${d.annee} : ${d.designation}`.slice(0, 300), piece: d.code,
      lignes: [...ligne(d.compte_dotation, d.montant), ...ligne(d.compte_amort, -d.montant)],
    });
  }
  const { rows: ces } = await c.query(
    `select i.id, i.code, i.designation, i.cout, i.compte_numero, i.compte_amort, i.cession_le::text as date, i.cession_prix,
       coalesce((select sum(d.montant) from dotations_immobilisation d where d.immobilisation_id = i.id), 0)::int8 as amorti
     from immobilisations i where i.branche_id = $1 and i.cession_le is not null and i.cession_le <= $2 and ${pas("cession", "i.id")} limit 2000`,
    [brancheId, fin],
  );
  for (const i of ces) {
    ajout({
      sourceType: "cession", sourceId: i.id, journal: "IM", date: i.date, libelle: `Cession : ${i.designation}`.slice(0, 300), piece: i.code,
      lignes: [
        ...ligne(i.compte_amort, i.amorti), ...ligne(p.valeur_cession!, i.cout - i.amorti), ...ligne(i.compte_numero, -i.cout),
        ...ligne(p.creances_cessions!, i.cession_prix), ...ligne(p.produit_cession!, -i.cession_prix),
      ],
    });
  }

  // Paie : brouillon global du mois, la ventilation des retenues par organisme reste au comptable.
  const { rows: bulls } = await c.query(
    `select b.id, b.numero, b.periode, b.brut::int8, b.retenues::int8, b.charges::int8, b.net::int8, e.nom from bulletins_paie b join employes e on e.id = b.employe_id
     where b.statut = 'valide' and entite_branche(e.entite_id) = $1 and b.periode <= to_char($2::date, 'YYYY-MM') and ${pas("bulletin", "b.id")} limit 2000`, [brancheId, fin],
  );
  for (const b of bulls) {
    const [a, m] = b.periode.split("-").map(Number) as [number, number];
    const date = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
    if (date > fin) continue;
    const brut = Number(b.brut), charges = Number(b.charges), net = Number(b.net), ret = Number(b.retenues);
    ajout({ sourceType: "bulletin", sourceId: b.id, journal: "OD", date, libelle: `Paie ${b.periode} ${b.nom}, retenues à ventiler`.slice(0, 300), piece: b.numero,
      lignes: [...ligne("6611", brut, null, null), ...(charges ? ligne("6641", charges, null, null) : []), ...ligne("422", -net, null, null), ...(ret + charges ? ligne("431", -(ret + charges), null, null) : [])] });
  }

  const { rows: annules } = await c.query(
    `select b.id, b.numero, b.periode, b.brut::int8, b.retenues::int8, b.charges::int8, b.net::int8, e.nom from bulletins_paie b join employes e on e.id = b.employe_id
     where b.statut = 'annule' and entite_branche(e.entite_id) = $1 and exists (select 1 from ecritures x where x.source_type = 'bulletin' and x.source_id = b.id) and ${pas("bulletin_annule", "b.id")} limit 500`, [brancheId],
  );
  for (const b of annules) {
    const brut = Number(b.brut), charges = Number(b.charges), net = Number(b.net), ret = Number(b.retenues);
    ajout({ sourceType: "bulletin_annule", sourceId: b.id, journal: "OD", date: fin, libelle: `Annulation paie ${b.periode} ${b.nom}`.slice(0, 300), piece: b.numero,
      lignes: [...ligne("6611", -brut, null, null), ...(charges ? ligne("6641", -charges, null, null) : []), ...ligne("422", net, null, null), ...(ret + charges ? ligne("431", ret + charges, null, null) : [])] });
  }

  // Refacturation interne : compte de liaison 185 des deux côtés.
  const { rows: refs } = await c.query(
    `select r.id, r.jour::text as jour, r.libelle, r.montant::int8, r.de_branche, r.vers_branche from refacturations_internes r where (r.de_branche = $1 or r.vers_branche = $1) and r.jour <= $2
       and not exists (select 1 from ecritures e where e.source_type = (case when r.de_branche = $1 then 'refact_emise' else 'refact_recue' end) and e.source_id = r.id)`, [brancheId, fin],
  );
  for (const r of refs) {
    const m = Number(r.montant);
    if (r.de_branche === brancheId) ajout({ sourceType: "refact_emise", sourceId: r.id, journal: "OD", date: r.jour, libelle: `Refacturation interne : ${r.libelle}`.slice(0, 300), piece: null as unknown as string, lignes: [...ligne("185", m, null, null), ...ligne(p.ventes_services!, -m, null, null)] });
    else ajout({ sourceType: "refact_recue", sourceId: r.id, journal: "OD", date: r.jour, libelle: `Refacturation interne : ${r.libelle}`.slice(0, 300), piece: null as unknown as string, lignes: [...ligne(p.attente!, m, null, null), ...ligne("185", -m, null, null)] });
  }

  // Créances douteuses et pertes : le traitement de la taxe reste à examiner par le comptable.
  const { rows: dts } = await c.query(
    `select x.id, x.tiers_id, x.provision, x.statut, x.montant_perte, x.jour_provision::text as jp, x.jour_perte::text as jq, d.numero, d.total_ttc - (select coalesce(sum(r.montant), 0) from reglements r where r.facture_id = d.id and r.annule_le is null) - (select coalesce(sum(a.total_ttc), 0) from documents_vente a where a.origine_id = d.id and a.type = 'avoir' and a.statut = 'emis') as reste from creances_douteuses x join documents_vente d on d.id = x.facture_id where x.branche_id = $1 order by x.jour_provision`, [brancheId],
  );
  const faites = dts.length ? new Set((await c.query("select source_type, source_id from ecritures where source_type in ('creance_provision', 'creance_perte', 'creance_reprise') and source_id = any($1::uuid[])", [dts.map((x) => x.id)])).rows.map((r) => `${r.source_type}:${r.source_id}`)) : new Set<string>();
  for (const x of dts) {
    const provision = Number(x.provision);
    if (provision > 0 && x.jp <= fin && !faites.has(`creance_provision:${x.id}`)) {
      ajout({ sourceType: "creance_provision", sourceId: x.id, journal: "OD", date: x.jp, libelle: `Dépréciation de la créance ${x.numero}`, piece: x.numero, lignes: [...ligne("659", provision, null, null), ...ligne("491", -provision, null, null)] });
    }
    // La créance déclassée est finalement payée : la provision se reprend.
    if (provision > 0 && x.statut === "douteuse" && Number(x.reste) <= 0 && faites.has(`creance_provision:${x.id}`) && !faites.has(`creance_reprise:${x.id}`)) {
      ajout({ sourceType: "creance_reprise", sourceId: x.id, journal: "OD", date: fin, libelle: `Reprise de dépréciation ${x.numero}`, piece: x.numero, lignes: [...ligne("491", provision, null, null), ...ligne("759", -provision, null, null)] });
    }
    if (x.statut === "perte" && x.jq <= fin && !faites.has(`creance_perte:${x.id}`)) {
      const m = Number(x.montant_perte);
      ajout({
        sourceType: "creance_perte", sourceId: x.id, journal: "OD", date: x.jq, libelle: `Perte sur la créance ${x.numero}, taxe à examiner`, piece: x.numero,
        lignes: [...ligne("651", m, null, null), ...ligne(p.clients!, -m, x.tiers_id, null), ...(provision > 0 ? [...ligne("491", provision, null, null), ...ligne("759", -provision, null, null)] : [])],
      });
    }
  }

  // Les mouvements saisis dans la trésorerie. Une dépense passe par un compte d'attente, que le comptable impute.
  const { rows: mv } = await c.query(
    `select m.id, m.type, m.montant, m.libelle, m.reference, m.source_type, x.type as portefeuille, x.nom, (m.cree_le at time zone 'Africa/Douala')::date::text as date, o.type as origine
     from mouvements_portefeuille m join portefeuilles x on x.id = m.portefeuille_id
     left join mouvements_portefeuille o on o.id = m.annule_mouvement_id
     where entite_branche(x.entite_id) = $1 and m.source_id is null and m.type in ('entree', 'sortie', 'transfert', 'frais', 'annulation', 'ouverture')
       and (m.cree_le at time zone 'Africa/Douala')::date <= $2 and ${pas("mouvement", "m.id")} order by m.cree_le limit 2000`,
    [brancheId, fin],
  );
  for (const m of mv) {
    const nature = m.type === "annulation" ? m.origine : m.type;
    // La paie solde le 422 ; scolarité et billets vont directement en produit, à vérifier par le comptable.
    const contre = m.source_type === "paie" ? "422" : m.source_type === "scolarite" ? p.formations! : m.source_type === "billet" ? p.ventes_services! : nature === "transfert" ? p.virements_internes! : nature === "frais" ? p.frais_bancaires! : p.attente!;
    ajout({
      sourceType: "mouvement", sourceId: m.id, journal: m.portefeuille === "especes" ? "CA" : "BQ", date: m.date, libelle: `${m.nom} : ${m.libelle}`.slice(0, 300), piece: m.reference,
      lignes: [...ligne(compteMoyen(m.portefeuille), m.montant, null, null), ...ligne(contre, -m.montant, null, null)],
    });
  }
  return res;
}

export function enregistrerComptabilite(app: FastifyInstance, outils: Outils): void {
  const { protege, exiger, exigerSurEntite } = outils;

  const exigerBranche = async (ctx: Contexte, brancheId: string, p: "compta.voir" | "compta.saisir" | "compta.valider" | "compta.cloturer") => {
    await exigerSurEntite(ctx, p, brancheId);
    const { rows: [e] } = await ctx.client.query("select entite_branche($1) as branche", [brancheId]);
    if (e.branche !== brancheId) throw new ErreurApi(400, "branche_attendue");
  };
  const noter = (ctx: Contexte, action: string, details: object) =>
    ctx.client.query("select journal_evenement($1, $2)", [action, JSON.stringify(details)]);
  const parametres = async (c: Client, brancheId: string): Promise<Record<string, string>> =>
    Object.fromEntries((await c.query("select cle, numero from parametres_comptables where branche_id = $1", [brancheId])).rows.map((r) => [r.cle, r.numero]));

  /** Période fermée, ou exercice clos. Rien n'y entre plus. */
  const periodeFermee = async (c: Client, brancheId: string, d: string) => (await c.query(
    `select exists (select 1 from clotures_periode where branche_id = $1 and mois = to_char($2::date, 'YYYY-MM'))
       or exists (select 1 from clotures_exercice where branche_id = $1 and annee = extract(year from $2::date)::int) as ferme`,
    [brancheId, d],
  )).rows[0].ferme as boolean;

  const creerEcriture = async (ctx: Contexte, brancheId: string, x: {
    journal: string; date: string; libelle: string; piece?: string | null; lignes: LigneSaisie[]; sourceType?: string; sourceId?: string; contrepasseId?: string; auteur?: string | null;
  }) => {
    const t = totaux(x.lignes);
    if (x.lignes.length < 2 || t.debit !== t.credit || t.debit === 0) throw new ErreurApi(409, "ecriture_desequilibree", t);
    if (await periodeFermee(ctx.client, brancheId, x.date)) throw new ErreurApi(409, "periode_close");
    const { rows: [j] } = await ctx.client.query("select id from journaux where branche_id = $1 and code = $2", [brancheId, x.journal]);
    if (!j) throw new ErreurApi(404, "introuvable");
    const { rows: comptes } = await ctx.client.query(
      "select id, numero, actif from comptes where branche_id = $1 and numero = any($2::text[])", [brancheId, x.lignes.map((l) => l.numero)],
    );
    const parNumero = new Map(comptes.filter((c) => c.actif).map((c) => [c.numero as string, c.id as string]));
    const { rows: [e] } = await ctx.client.query(
      `insert into ecritures (organisation_id, branche_id, journal_id, date_ecriture, libelle, piece, source_type, source_id, contrepasse_id, cree_par)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
      [ctx.organisationId, brancheId, j.id, x.date, x.libelle, x.piece ?? null, x.sourceType ?? null, x.sourceId ?? null, x.contrepasseId ?? null, x.auteur === undefined ? ctx.utilisateurId : x.auteur],
    );
    await ecrireLignes(ctx, e.id, x.lignes, parNumero);
    return e;
  };
  const ecrireLignes = async (ctx: Contexte, ecritureId: string, lignes: LigneSaisie[], comptes: Map<string, string>) => {
    for (const [i, l] of lignes.entries()) {
      const compte = comptes.get(l.numero);
      if (!compte) throw new ErreurApi(409, "compte_inconnu", { numero: l.numero });
      await ctx.client.query(
        `insert into lignes_ecriture (organisation_id, ecriture_id, ordre, compte_id, debit, credit, tiers_id, section, libelle)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [ctx.organisationId, ecritureId, i + 1, compte, l.debit ?? 0, l.credit ?? 0, l.tiersId ?? null, l.section ?? null, l.libelle ?? null],
      );
    }
  };

  /** Installe le plan, les journaux et les comptes proposés. Ne touche pas à ce qui existe déjà. */
  app.post<{ Body: { brancheId: string } }>("/compta/initialisation", {
    schema: { body: { type: "object", required: ["brancheId"], properties: { brancheId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { brancheId } = req.body;
      await exigerBranche(ctx, brancheId, "compta.cloturer");
      for (const [numero, libelle] of PLAN_DE_DEPART) {
        await ctx.client.query(
          "insert into comptes (organisation_id, branche_id, numero, libelle) values ($1, $2, $3, $4) on conflict do nothing",
          [ctx.organisationId, brancheId, numero, libelle],
        );
      }
      for (const [code, libelle] of JOURNAUX_DE_DEPART) {
        await ctx.client.query(
          "insert into journaux (organisation_id, branche_id, code, libelle) values ($1, $2, $3, $4) on conflict do nothing",
          [ctx.organisationId, brancheId, code, libelle],
        );
      }
      for (const [cle, numero] of Object.entries(PARAMETRES_DE_DEPART)) {
        await ctx.client.query(
          "insert into parametres_comptables (organisation_id, branche_id, cle, numero) values ($1, $2, $3, $4) on conflict do nothing",
          [ctx.organisationId, brancheId, cle, numero],
        );
      }
      await noter(ctx, "compta.initialisation", { branche: brancheId });
      return { comptes: PLAN_DE_DEPART.length, journaux: JOURNAUX_DE_DEPART.length };
    }),
  );

  app.get<{ Querystring: { brancheId: string } }>("/compta/referentiel", {
    schema: { querystring: { type: "object", required: ["brancheId"], properties: { brancheId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerBranche(ctx, req.query.brancheId, "compta.voir");
      const [comptes, journaux, p, clotures, exercices] = await Promise.all([
        ctx.client.query("select numero, libelle, actif from comptes where branche_id = $1 order by numero", [req.query.brancheId]),
        ctx.client.query("select code, libelle from journaux where branche_id = $1 order by code", [req.query.brancheId]),
        parametres(ctx.client, req.query.brancheId),
        ctx.client.query("select mois, definitive, close_le from clotures_periode where branche_id = $1 order by mois desc", [req.query.brancheId]),
        ctx.client.query("select annee, resultat, close_le from clotures_exercice where branche_id = $1 order by annee desc", [req.query.brancheId]),
      ]);
      return { comptes: comptes.rows, journaux: journaux.rows, parametres: p, clotures: clotures.rows, exercices: exercices.rows };
    }),
  );

  app.post<{ Body: { brancheId: string; numero: string; libelle: string } }>("/compta/comptes", {
    schema: {
      body: {
        type: "object", required: ["brancheId", "numero", "libelle"],
        properties: { brancheId: uuid, numero: { type: "string", pattern: "^[1-9][0-9]{1,11}$" }, libelle: { type: "string", minLength: 2, maxLength: 200 } },
      },
    },
  }, async (req, reponse) => {
    const c = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerBranche(ctx, b.brancheId, "compta.cloturer");
      const { rows } = await ctx.client.query(
        "insert into comptes (organisation_id, branche_id, numero, libelle) values ($1, $2, $3, $4) returning numero, libelle, actif",
        [ctx.organisationId, b.brancheId, b.numero, b.libelle],
      );
      return rows[0];
    });
    return reponse.status(201).send(c);
  });

  app.put<{ Body: { brancheId: string; cle: string; numero: string } }>("/compta/parametres", {
    schema: {
      body: {
        type: "object", required: ["brancheId", "cle", "numero"],
        properties: { brancheId: uuid, cle: { type: "string", enum: Object.keys(PARAMETRES_DE_DEPART) }, numero: { type: "string", maxLength: 12 } },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const b = req.body;
      await exigerBranche(ctx, b.brancheId, "compta.cloturer");
      const { rows } = await ctx.client.query("select 1 from comptes where branche_id = $1 and numero = $2 and actif", [b.brancheId, b.numero]);
      if (!rows[0]) throw new ErreurApi(409, "compte_inconnu", { numero: b.numero });
      await ctx.client.query(
        `insert into parametres_comptables (organisation_id, branche_id, cle, numero) values ($1, $2, $3, $4)
         on conflict (organisation_id, branche_id, cle) do update set numero = excluded.numero`,
        [ctx.organisationId, b.brancheId, b.cle, b.numero],
      );
      return { cle: b.cle, numero: b.numero };
    }),
  );

  /** Prépare les brouillons : un comptable les contrôle avant de les valider. Relancer ne crée aucun doublon. */
  app.post<{ Body: { brancheId: string; fin: string } }>("/compta/generation", {
    schema: { body: { type: "object", required: ["brancheId", "fin"], properties: { brancheId: uuid, fin: date } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { brancheId, fin } = req.body;
      await exigerBranche(ctx, brancheId, "compta.saisir");
      const p = await parametres(ctx.client, brancheId);
      if (!p.clients) throw new ErreurApi(409, "compta_non_initialisee");
      const { rows: [{ jour }] } = await ctx.client.query(`select ${AUJOURDHUI}::text as jour`);
      let crees = 0;
      // Comptes ajoutés après l'initialisation de certaines branches.
      for (const [numero, libelle] of [["185", "Comptes de liaison entre établissements"], ["659", "Charges pour dépréciations et provisions à court terme d'exploitation"], ["491", "Dépréciations des comptes clients"], ["759", "Reprises de charges pour dépréciations et provisions à court terme d'exploitation"]] as const) {
        await ctx.client.query("insert into comptes (organisation_id, branche_id, numero, libelle) values ($1, $2, $3, $4) on conflict do nothing", [ctx.organisationId, brancheId, numero, libelle]);
      }
      for (const x of await pieces(ctx.client, brancheId, fin, p)) {
        // Art. 22 : une pièce tardive d'une période close se date dans la période en cours.
        const tardive = await periodeFermee(ctx.client, brancheId, x.date);
        await creerEcriture(ctx, brancheId, { ...x, date: tardive ? jour : x.date, libelle: tardive ? `${x.libelle} (du ${x.date})` : x.libelle, auteur: null });
        crees += 1;
      }
      await noter(ctx, "compta.generation", { branche: brancheId, fin, crees });
      return { crees };
    }),
  );

  const corpsEcriture = {
    journal: { type: "string", maxLength: 6 }, date, libelle: { type: "string", minLength: 3, maxLength: 300 }, piece: { type: "string", maxLength: 100 },
    lignes: {
      type: "array", minItems: 2, maxItems: 200,
      items: {
        type: "object", required: ["numero"],
        properties: {
          numero: { type: "string", maxLength: 12 }, debit: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 }, credit: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 },
          tiersId: uuid, section: { type: "string", maxLength: 100 }, libelle: { type: "string", maxLength: 300 },
        },
      },
    },
  } as const;
  const verifierLignes = async (ctx: Contexte, lignes: LigneSaisie[]) => {
    for (const l of lignes) {
      if (!!l.debit === !!l.credit) throw new ErreurApi(400, "ligne_comptable_invalide");
      if (l.tiersId) await exigerTiersVisible(ctx, l.tiersId, "compta.saisir");
    }
  };

  app.post<{ Body: { brancheId: string; journal: string; date: string; libelle: string; piece?: string; lignes: LigneSaisie[] } }>("/compta/ecritures", {
    schema: { body: { type: "object", required: ["brancheId", "journal", "date", "libelle", "lignes"], properties: { brancheId: uuid, ...corpsEcriture } } },
  }, async (req, reponse) => {
    const e = await protege(req, async (ctx) => {
      await exigerBranche(ctx, req.body.brancheId, "compta.saisir");
      await verifierLignes(ctx, req.body.lignes);
      const b = req.body;
      return creerEcriture(ctx, b.brancheId, { journal: b.journal, date: b.date, libelle: b.libelle, piece: b.piece, lignes: b.lignes });
    });
    return reponse.status(201).send(e);
  });

  const lireEcriture = async (ctx: Contexte, id: string, p: "compta.voir" | "compta.saisir" | "compta.valider") => {
    const { rows } = await ctx.client.query("select * from ecritures where id = $1 for update", [id]);
    if (!rows[0]) throw new ErreurApi(404, "introuvable");
    await exigerBranche(ctx, rows[0].branche_id, p);
    return rows[0];
  };

  app.get<{ Querystring: { brancheId: string; statut?: string } }>("/compta/ecritures", {
    schema: { querystring: { type: "object", required: ["brancheId"], properties: { brancheId: uuid, statut: { type: "string", enum: ["brouillon", "validee"] } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      await exigerBranche(ctx, req.query.brancheId, "compta.voir");
      const { rows } = await ctx.client.query(
        `select e.id, e.date_ecriture, e.numero, e.libelle, e.piece, e.statut, e.source_type, j.code as journal,
           (select json_agg(json_build_object('numero', c.numero, 'libelle', c.libelle, 'debit', l.debit, 'credit', l.credit, 'section', l.section, 'tiers', t.nom, 'tiersId', l.tiers_id) order by l.ordre)
            from lignes_ecriture l join comptes c on c.id = l.compte_id left join tiers t on t.id = l.tiers_id where l.ecriture_id = e.id) as lignes,
           exists (select 1 from ecritures r where r.contrepasse_id = e.id) as contrepassee
         from ecritures e join journaux j on j.id = e.journal_id
         where e.branche_id = $1 and ($2::text is null or e.statut = $2) order by e.date_ecriture desc, e.numero desc nulls first limit 500`,
        [req.query.brancheId, req.query.statut ?? null],
      );
      return rows;
    }),
  );

  /** Le brouillon reste corrigeable : c'est là que le comptable impute une dépense en attente. */
  app.put<{ Params: { id: string }; Body: { date: string; libelle: string; piece?: string; lignes: LigneSaisie[] } }>("/compta/ecritures/:id", {
    schema: { params: paramId, body: { type: "object", required: ["date", "libelle", "lignes"], properties: { date: corpsEcriture.date, libelle: corpsEcriture.libelle, piece: corpsEcriture.piece, lignes: corpsEcriture.lignes } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const e = await lireEcriture(ctx, req.params.id, "compta.saisir");
      if (e.statut !== "brouillon") throw new ErreurApi(409, "ecriture_validee");
      const b = req.body;
      await verifierLignes(ctx, b.lignes);
      const t = totaux(b.lignes);
      if (t.debit !== t.credit || t.debit === 0) throw new ErreurApi(409, "ecriture_desequilibree", t);
      if (await periodeFermee(ctx.client, e.branche_id, b.date)) throw new ErreurApi(409, "periode_close");
      const { rows: comptes } = await ctx.client.query("select id, numero from comptes where branche_id = $1 and actif and numero = any($2::text[])", [e.branche_id, b.lignes.map((l) => l.numero)]);
      await ctx.client.query("delete from lignes_ecriture where ecriture_id = $1", [e.id]);
      await ecrireLignes(ctx, e.id, b.lignes, new Map(comptes.map((c) => [c.numero, c.id])));
      await ctx.client.query("update ecritures set date_ecriture = $2, libelle = $3, piece = $4 where id = $1", [e.id, b.date, b.libelle, b.piece ?? e.piece]);
      return { modifie: true };
    }),
  );

  /** Une pièce d'un autre module revient au prochain lancement : supprimer ne fait donc pas disparaître l'opération. */
  app.delete<{ Params: { id: string } }>("/compta/ecritures/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const e = await lireEcriture(ctx, req.params.id, "compta.saisir");
      if (e.statut !== "brouillon") throw new ErreurApi(409, "ecriture_validee");
      if (e.source_type === "a_nouveau") throw new ErreurApi(409, "a_nouveau_non_supprimable");
      await ctx.client.query("delete from lignes_ecriture where ecriture_id = $1", [e.id]);
      await ctx.client.query("delete from ecritures where id = $1", [e.id]);
      return { supprime: true };
    }),
  );

  /** La validation attribue le numéro définitif, sans trou, journal par journal et année par année. */
  app.post<{ Body: { ids: string[] } }>("/compta/ecritures/validation", {
    schema: { body: { type: "object", required: ["ids"], properties: { ids: { type: "array", minItems: 1, maxItems: 1000, items: uuid } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows } = await ctx.client.query(
        "select e.id, e.branche_id, e.statut, e.cree_par, e.date_ecriture::text as date, j.code from ecritures e join journaux j on j.id = e.journal_id where e.id = any($1::uuid[]) order by e.date_ecriture, e.cree_le for update of e",
        [req.body.ids],
      );
      if (rows.length !== new Set(req.body.ids).size) throw new ErreurApi(404, "introuvable");
      for (const e of rows) {
        await exigerBranche(ctx, e.branche_id, "compta.valider");
        if (e.statut !== "brouillon") throw new ErreurApi(409, "ecriture_validee");
        await exigerSeparation(ctx, "ecritures", e.cree_par);
        if (await periodeFermee(ctx.client, e.branche_id, e.date)) throw new ErreurApi(409, "periode_close", { date: e.date });
        const { rows: [branche] } = await ctx.client.query("select code from entites where id = $1", [e.branche_id]);
        const numero = await prochainNumero(ctx.client, `${branche.code}-${e.code}-${e.date.slice(0, 4)}`);
        await ctx.client.query("update ecritures set statut = 'validee', numero = $2, valide_par = $3, valide_le = now() where id = $1", [e.id, numero, ctx.utilisateurId]);
      }
      return { validees: rows.length };
    }),
  );

  /** Art. 20 : une erreur se corrige par une écriture inverse, jamais en touchant l'écriture d'origine. */
  app.post<{ Params: { id: string }; Body: { date: string; motif: string } }>("/compta/ecritures/:id/contrepassation", {
    schema: { params: paramId, body: { type: "object", required: ["date", "motif"], properties: { date, motif: { type: "string", minLength: 5, maxLength: 300 } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const e = await lireEcriture(ctx, req.params.id, "compta.saisir");
      if (e.statut !== "validee") throw new ErreurApi(409, "ecriture_non_validee");
      const { rows: lignes } = await ctx.client.query(
        "select c.numero, l.debit, l.credit, l.tiers_id, l.section from lignes_ecriture l join comptes c on c.id = l.compte_id where l.ecriture_id = $1 order by l.ordre", [e.id],
      );
      const { rows: [j] } = await ctx.client.query("select code from journaux where id = $1", [e.journal_id]);
      return creerEcriture(ctx, e.branche_id, {
        journal: j.code, date: req.body.date, libelle: `Contre-passation de ${e.numero} : ${req.body.motif}`, piece: e.numero, contrepasseId: e.id,
        lignes: lignes.map((l) => ({ numero: l.numero, debit: l.credit, credit: l.debit, tiersId: l.tiers_id, section: l.section })),
      });
    });
    return reponse.status(201).send(r);
  });

  const balance = async (c: Client, brancheId: string, debut: string, fin: string) => (await c.query(
    `select c.numero, c.libelle, sum(l.debit)::int8 as debit, sum(l.credit)::int8 as credit
     from lignes_ecriture l join ecritures e on e.id = l.ecriture_id join comptes c on c.id = l.compte_id
     where e.branche_id = $1 and e.statut = 'validee' and e.date_ecriture between $2 and $3
     group by c.numero, c.libelle order by c.numero`,
    [brancheId, debut, fin],
  )).rows as { numero: string; libelle: string; debit: number; credit: number }[];

  app.get<{ Querystring: { brancheId: string; debut: string; fin: string } }>("/compta/balance", { schema: { querystring: queryPeriode } }, async (req) =>
    protege(req, async (ctx) => {
      const q = req.query;
      await exigerBranche(ctx, q.brancheId, "compta.voir");
      const lignes = await balance(ctx.client, q.brancheId, q.debut, q.fin);
      return { lignes, ...totaux(lignes) };
    }),
  );

  app.get<{ Querystring: { brancheId: string; debut: string; fin: string; compte?: string } }>("/compta/grand-livre", { schema: { querystring: queryPeriode } }, async (req) =>
    protege(req, async (ctx) => {
      const q = req.query;
      await exigerBranche(ctx, q.brancheId, "compta.voir");
      const { rows } = await ctx.client.query(
        `select c.numero, c.libelle as compte, e.date_ecriture, e.numero as ecriture, j.code as journal, e.libelle, e.piece, l.debit, l.credit, l.section, t.nom as tiers
         from lignes_ecriture l join ecritures e on e.id = l.ecriture_id join comptes c on c.id = l.compte_id
         join journaux j on j.id = e.journal_id left join tiers t on t.id = l.tiers_id
         where e.branche_id = $1 and e.statut = 'validee' and e.date_ecriture between $2 and $3 and ($4::text is null or c.numero like $4 || '%')
         order by c.numero, e.date_ecriture, e.numero limit 5000`,
        [q.brancheId, q.debut, q.fin, q.compte || null],
      );
      return rows;
    }),
  );

  app.get<{ Querystring: { brancheId: string; debut: string; fin: string } }>("/compta/etats", { schema: { querystring: queryPeriode } }, async (req) =>
    protege(req, async (ctx) => {
      const q = req.query;
      await exigerBranche(ctx, q.brancheId, "compta.voir");
      return etatsDeSynthese(await balance(ctx.client, q.brancheId, q.debut, q.fin));
    }),
  );

  /** Résultat par activité, à partir de la section notée sur chaque ligne. */
  app.get<{ Querystring: { brancheId: string; debut: string; fin: string } }>("/compta/analytique", { schema: { querystring: queryPeriode } }, async (req) =>
    protege(req, async (ctx) => {
      const q = req.query;
      await exigerBranche(ctx, q.brancheId, "compta.voir");
      const { rows } = await ctx.client.query(
        `select coalesce(l.section, 'Sans section') as section,
           sum(case when c.numero like '7%' then l.credit - l.debit else 0 end)::int8 as produits,
           sum(case when c.numero like '6%' then l.debit - l.credit else 0 end)::int8 as charges
         from lignes_ecriture l join ecritures e on e.id = l.ecriture_id join comptes c on c.id = l.compte_id
         where e.branche_id = $1 and e.statut = 'validee' and e.date_ecriture between $2 and $3 and (c.numero like '6%' or c.numero like '7%')
         group by 1 order by 1`,
        [q.brancheId, q.debut, q.fin],
      );
      return rows;
    }),
  );

  /** TVA des comptes, pour préparer la déclaration. Le montant à déclarer reste à contrôler par le comptable. */
  app.get<{ Querystring: { brancheId: string; debut: string; fin: string } }>("/compta/tva", { schema: { querystring: queryPeriode } }, async (req) =>
    protege(req, async (ctx) => {
      const q = req.query;
      await exigerBranche(ctx, q.brancheId, "compta.voir");
      const b = await balance(ctx.client, q.brancheId, q.debut, q.fin);
      const collectee = b.filter((x) => x.numero.startsWith("443")).reduce((s, x) => s + x.credit - x.debit, 0);
      const recuperable = b.filter((x) => x.numero.startsWith("445")).reduce((s, x) => s + x.debit - x.credit, 0);
      return { collectee, recuperable, solde: collectee - recuperable };
    }),
  );

  /** Les contrôles qu'un réviseur fait d'abord. Chacun indique un point à examiner, pas une erreur certaine. */
  app.get<{ Querystring: { brancheId: string } }>("/compta/controles", {
    schema: { querystring: { type: "object", required: ["brancheId"], properties: { brancheId: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { brancheId } = req.query;
      await exigerBranche(ctx, brancheId, "compta.voir");
      const p = await parametres(ctx.client, brancheId);
      if (!p.clients) return { initialisee: false, points: [] };
      const points: { code: string; niveau: string; texte: string; nombre?: number; details?: unknown }[] = [];
      const { rows: [{ fin, annee }] } = await ctx.client.query(`select ${AUJOURDHUI}::text as fin, extract(year from ${AUJOURDHUI})::int as annee`);
      const attente = (await pieces(ctx.client, brancheId, fin, p)).length;
      if (attente) points.push({ code: "pieces_a_comptabiliser", niveau: "action", nombre: attente, texte: `${attente} opération(s) des autres modules sans écriture.` });
      const { rows: [br] } = await ctx.client.query("select count(*)::int as n from ecritures where branche_id = $1 and statut = 'brouillon'", [brancheId]);
      if (br.n) points.push({ code: "brouillons", niveau: "action", nombre: br.n, texte: `${br.n} brouillon(s) à contrôler et valider.` });
      const soldes = await balance(ctx.client, brancheId, "1900-01-01", fin);
      for (const s of soldes.filter((x) => (x.numero.startsWith("57") || x.numero.startsWith("55")) && x.credit > x.debit)) {
        points.push({ code: "tresorerie_creditrice", niveau: "alerte", texte: `Le compte ${s.numero} ${s.libelle} est créditeur de ${s.credit - s.debit} FCFA : une caisse ou un portefeuille ne peut pas être négatif. Vérifiez les saisies.` });
      }
      const virements = soldes.filter((x) => x.numero.startsWith("585")).reduce((t, x) => t + x.debit - x.credit, 0);
      if (virements) points.push({ code: "virements_non_soldes", niveau: "alerte", texte: `Le compte de virements de fonds n'est pas soldé (${virements} FCFA).` });
      const att = soldes.filter((x) => x.numero === p.attente).reduce((t, x) => t + x.debit - x.credit, 0);
      if (att) points.push({ code: "compte_attente", niveau: "alerte", texte: `Le compte d'attente ${p.attente} n'est pas soldé (${att} FCFA) : des dépenses restent à imputer.` });
      const { rows: especes } = await ctx.client.query(
        `select e.numero, e.libelle, c.numero as compte, l.debit
         from lignes_ecriture l join ecritures e on e.id = l.ecriture_id join comptes c on c.id = l.compte_id
         where e.branche_id = $1 and c.numero like '6%' and l.debit >= 100000
           and exists (select 1 from lignes_ecriture k join comptes kc on kc.id = k.compte_id where k.ecriture_id = e.id and kc.numero like '57%' and k.credit > 0)
         order by e.date_ecriture desc limit 50`,
        [brancheId],
      );
      if (especes.length) points.push({ code: "charges_en_especes", niveau: "fiscal", nombre: especes.length, details: especes, texte: `${especes.length} charge(s) de 100 000 FCFA ou plus payée(s) en espèces : non déductibles selon l'article 8 bis du CGI.` });
      const { rows: [mois] } = await ctx.client.query(
        `select count(*)::int as n from generate_series(make_date($2, 1, 1), date_trunc('month', ${AUJOURDHUI}::timestamp) - interval '1 month', interval '1 month') g
         where not exists (select 1 from clotures_periode p where p.branche_id = $1 and p.mois = to_char(g, 'YYYY-MM'))
           and exists (select 1 from ecritures e where e.branche_id = $1 and to_char(e.date_ecriture, 'YYYY-MM') = to_char(g, 'YYYY-MM'))`,
        [brancheId, annee],
      );
      if (mois.n) points.push({ code: "mois_non_clos", niveau: "action", nombre: mois.n, texte: `${mois.n} mois écoulé(s) avec écritures, non clôturé(s). La clôture doit être au moins trimestrielle (AUDCIF, art. 22).` });
      return { initialisee: true, points };
    }),
  );

  /** Clôture du mois. "Définitive" ferme toute réouverture : l'Acte uniforme l'exige au moins chaque trimestre. */
  app.post<{ Body: { brancheId: string; mois: string; definitive?: boolean } }>("/compta/clotures", {
    schema: {
      body: {
        type: "object", required: ["brancheId", "mois"],
        properties: { brancheId: uuid, mois: { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" }, definitive: { type: "boolean" } },
      },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerBranche(ctx, b.brancheId, "compta.cloturer");
      await ctx.client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`compta:${b.brancheId}`]);
      const { rows: [br] } = await ctx.client.query(
        "select count(*)::int as n from ecritures where branche_id = $1 and statut = 'brouillon' and to_char(date_ecriture, 'YYYY-MM') = $2", [b.brancheId, b.mois],
      );
      if (br.n) throw new ErreurApi(409, "brouillons_restants", { nombre: br.n });
      const { rows: [av] } = await ctx.client.query(
        `select max(to_char(g, 'YYYY-MM')) as mois from generate_series(($2 || '-01')::date - interval '12 month', ($2 || '-01')::date - interval '1 month', interval '1 month') g
         where g >= date_trunc('year', ($2 || '-01')::date)
           and not exists (select 1 from clotures_periode p where p.branche_id = $1 and p.mois = to_char(g, 'YYYY-MM'))
           and exists (select 1 from ecritures e where e.branche_id = $1 and to_char(e.date_ecriture, 'YYYY-MM') = to_char(g, 'YYYY-MM'))`,
        [b.brancheId, b.mois],
      );
      if (av.mois) throw new ErreurApi(409, "mois_precedent_ouvert", { mois: av.mois });
      await ctx.client.query(
        `insert into clotures_periode (organisation_id, branche_id, mois, definitive, close_par) values ($1, $2, $3, $4, $5)
         on conflict (organisation_id, branche_id, mois) do update set definitive = clotures_periode.definitive or excluded.definitive`,
        [ctx.organisationId, b.brancheId, b.mois, b.definitive ?? false, ctx.utilisateurId],
      );
      await noter(ctx, "compta.cloture", { branche: b.brancheId, mois: b.mois, definitive: b.definitive ?? false });
      return { mois: b.mois, definitive: b.definitive ?? false };
    });
    return reponse.status(201).send(r);
  });

  /** Réouverture motivée et tracée, pour ajouter une écriture. Ce qui est validé reste intangible. */
  app.post<{ Body: { brancheId: string; mois: string; motif: string } }>("/compta/clotures/reouverture", {
    schema: {
      body: {
        type: "object", required: ["brancheId", "mois", "motif"],
        properties: { brancheId: uuid, mois: { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" }, motif: { type: "string", minLength: 5, maxLength: 300 } },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const b = req.body;
      await exigerBranche(ctx, b.brancheId, "compta.cloturer");
      const { rows: [c] } = await ctx.client.query("select definitive from clotures_periode where branche_id = $1 and mois = $2 for update", [b.brancheId, b.mois]);
      if (!c) throw new ErreurApi(404, "introuvable");
      if (c.definitive) throw new ErreurApi(409, "cloture_definitive");
      await ctx.client.query("delete from clotures_periode where branche_id = $1 and mois = $2", [b.brancheId, b.mois]);
      await noter(ctx, "compta.reouverture", { branche: b.brancheId, mois: b.mois, motif: b.motif });
      return { rouvert: true };
    }),
  );

  /**
   * Clôture de l'exercice : tous les mois doivent être définitifs. Reporte les comptes de bilan en à-nouveaux
   * sur l'exercice suivant, avec le résultat au compte 131 ou 139, en brouillon à contrôler.
   */
  app.post<{ Body: { brancheId: string; annee: number } }>("/compta/exercices/cloture", {
    schema: { body: { type: "object", required: ["brancheId", "annee"], properties: { brancheId: uuid, annee: { type: "integer", minimum: 2000, maximum: 2100 } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const { brancheId, annee } = req.body;
      await exigerBranche(ctx, brancheId, "compta.cloturer");
      await ctx.client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`compta:${brancheId}`]);
      const { rows: [deja] } = await ctx.client.query("select 1 as x from clotures_exercice where branche_id = $1 and annee = $2", [brancheId, annee]);
      if (deja) throw new ErreurApi(409, "exercice_clos");
      const { rows: [br] } = await ctx.client.query("select count(*)::int as n from ecritures where branche_id = $1 and statut = 'brouillon' and extract(year from date_ecriture)::int = $2", [brancheId, annee]);
      if (br.n) throw new ErreurApi(409, "brouillons_restants", { nombre: br.n });
      const { rows: [ouverts] } = await ctx.client.query(
        `select count(distinct to_char(e.date_ecriture, 'YYYY-MM'))::int as n from ecritures e
         where e.branche_id = $1 and extract(year from e.date_ecriture)::int = $2
           and not exists (select 1 from clotures_periode p where p.branche_id = $1 and p.mois = to_char(e.date_ecriture, 'YYYY-MM') and p.definitive)`,
        [brancheId, annee],
      );
      if (ouverts.n) throw new ErreurApi(409, "mois_non_definitifs", { nombre: ouverts.n });
      const debut = `${annee}-01-01`;
      const fin = `${annee}-12-31`;
      const etats = etatsDeSynthese(await balance(ctx.client, brancheId, debut, fin));
      if (!etats.equilibre) throw new ErreurApi(409, "bilan_desequilibre");
      const { rows: soldes } = await ctx.client.query(
        `select c.numero, l.tiers_id, sum(l.debit - l.credit)::int8 as solde
         from lignes_ecriture l join ecritures e on e.id = l.ecriture_id join comptes c on c.id = l.compte_id
         where e.branche_id = $1 and e.statut = 'validee' and e.date_ecriture between $2 and $3 and left(c.numero, 1) in ('1', '2', '3', '4', '5')
         group by c.numero, l.tiers_id having sum(l.debit - l.credit) <> 0 order by c.numero`,
        [brancheId, debut, fin],
      );
      await ctx.client.query(
        "insert into clotures_exercice (organisation_id, branche_id, annee, resultat, close_par) values ($1, $2, $3, $4, $5)",
        [ctx.organisationId, brancheId, annee, etats.resultat, ctx.utilisateurId],
      );
      const lignes = [
        ...soldes.flatMap((s) => ligne(s.numero, s.solde, s.tiers_id)),
        ...ligne(etats.resultat >= 0 ? "131" : "139", -etats.resultat),
      ];
      const an = lignes.length >= 2 ? await creerEcriture(ctx, brancheId, {
        journal: "AN", date: `${annee + 1}-01-01`, libelle: `À-nouveaux de l'exercice ${annee}`, lignes,
        sourceType: "a_nouveaux", sourceId: undefined,
      }) : null;
      await noter(ctx, "compta.cloture_exercice", { branche: brancheId, annee, resultat: etats.resultat });
      return { annee, resultat: etats.resultat, aNouveaux: an?.id ?? null };
    });
    return reponse.status(201).send(r);
  });

  /** Journal complet pour l'expert ou le contrôle fiscal. */
  app.get<{ Querystring: { brancheId: string; debut: string; fin: string } }>("/compta/export", { schema: { querystring: queryPeriode } }, async (req, reponse) => {
    const q = req.query;
    const lignes = await protege(req, async (ctx) => {
      await exigerBranche(ctx, q.brancheId, "compta.voir");
      return (await ctx.client.query(
        `select j.code, e.numero, e.date_ecriture, c.numero as compte, c.libelle as compte_libelle, t.nom as tiers, e.piece, e.libelle, l.debit, l.credit, l.section, e.valide_le
         from lignes_ecriture l join ecritures e on e.id = l.ecriture_id join comptes c on c.id = l.compte_id join journaux j on j.id = e.journal_id left join tiers t on t.id = l.tiers_id
         where e.branche_id = $1 and e.statut = 'validee' and e.date_ecriture between $2 and $3 order by j.code, e.numero, l.ordre`,
        [q.brancheId, q.debut, q.fin],
      )).rows;
    });
    const entete = "Journal;Numero;Date;Compte;Libelle compte;Tiers;Piece;Libelle;Debit;Credit;Section;Validee le";
    const corps = lignes.map((l) => [l.code, l.numero, l.date_ecriture, l.compte, l.compte_libelle, l.tiers, l.piece, l.libelle, l.debit, l.credit, l.section, l.valide_le?.toISOString()].map(celluleCsv).join(";"));
    return reponse.header("content-type", "text/csv; charset=utf-8").header("content-disposition", 'attachment; filename="journal comptable.csv"').send(`﻿${[entete, ...corps].join("\r\n")}`);
  });

  app.get("/compta/branches", async (req) =>
    protege(req, async (ctx) => {
      await exiger(ctx, "compta.voir");
      const ids = (await entitesAccessibles(ctx.client, ctx.utilisateurId, "compta.voir"));
      const { rows } = await ctx.client.query("select id, nom, domaine from entites where id = any($1::uuid[]) and entite_branche(id) = id order by nom", [ids.map((e) => e.id)]);
      return rows;
    }),
  );
}
