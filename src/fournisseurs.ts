import { exigerSeparation } from "./permissions.js";
import type { FastifyInstance } from "fastify";
import { calculFiscal, bilan, CATEGORIES_IMMO, compteDeResultat, dotationAnnee, fluxDeTresorerie, LIBELLES, type LigneBalance } from "./etats.js";
import { celluleCsv } from "./comptabilite.js";
import { prochainNumero } from "./formations.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";
import { lierTiers } from "./tiers.js";

const uuid = { type: "string", format: "uuid" } as const;
const date = { type: "string", format: "date" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: uuid } } as const;
const montant = { type: "integer", minimum: 1, maximum: 1_000_000_000_000 } as const;
const queryBranche = { type: "object", required: ["brancheId"], properties: { brancheId: uuid } } as const;
const queryAnnee = { type: "object", required: ["brancheId", "annee"], properties: { brancheId: uuid, annee: { type: "integer", minimum: 2000, maximum: 2100 } } } as const;

/**
 * Compare le montant facturé à ce qui a été commandé et reçu. Un écart n'interdit rien,
 * mais il exige un motif écrit, conservé avec la facture.
 */
export function controleTroisVoies(totalHt: number, commande: number | null, recu: number | null) {
  if (commande === null) return { statut: "sans_commande" as const, ecart: 0 };
  if (!recu) return { statut: "non_recu" as const, ecart: totalHt };
  const ecart = totalHt - (recu ?? 0);
  return { statut: ecart === 0 ? "conforme" as const : "ecart" as const, ecart };
}

export function enregistrerFournisseurs(app: FastifyInstance, outils: Outils): void {
  const { protege, exigerSurEntite } = outils;
  const branche = async (ctx: Contexte, entiteId: string): Promise<string> =>
    (await ctx.client.query("select entite_branche($1) as b", [entiteId])).rows[0].b;
  const exigerBranche = async (ctx: Contexte, entiteId: string, p: "compta.voir" | "compta.saisir" | "compta.valider" | "compta.cloturer") => {
    const b = await branche(ctx, entiteId);
    if (!b) throw new ErreurApi(400, "branche_attendue");
    await exigerSurEntite(ctx, p, b);
    return b;
  };
  const noter = (ctx: Contexte, action: string, details: object) =>
    ctx.client.query("select journal_evenement($1, $2)", [action, JSON.stringify(details)]);

  app.post<{
    Body: { entiteId: string; fournisseurId: string; numeroFournisseur: string; date: string; echeance?: string; commandeId?: string; niu?: string; lignes: { designation: string; compte: string; montantHt: number; montantTaxes?: number }[] };
  }>("/fournisseurs/factures", {
    schema: {
      body: {
        type: "object", required: ["entiteId", "fournisseurId", "numeroFournisseur", "date", "lignes"],
        properties: {
          entiteId: uuid, fournisseurId: uuid, numeroFournisseur: { type: "string", minLength: 1, maxLength: 100 }, date, echeance: date, commandeId: uuid, niu: { type: "string", maxLength: 40 },
          lignes: {
            type: "array", minItems: 1, maxItems: 200,
            items: {
              type: "object", required: ["designation", "compte", "montantHt"],
              properties: { designation: { type: "string", minLength: 1, maxLength: 300 }, compte: { type: "string", pattern: "^[1-9][0-9]{1,11}$" }, montantHt: montant, montantTaxes: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 } },
            },
          },
        },
      },
    },
  }, async (req, reponse) => {
    const f = await protege(req, async (ctx) => {
      const b = req.body;
      const br = await exigerBranche(ctx, b.entiteId, "compta.saisir");
      await lierTiers(ctx, b.fournisseurId, b.entiteId);
      if (b.echeance && b.echeance < b.date) throw new ErreurApi(400, "dates_invalides");
      const { rows: comptes } = await ctx.client.query("select numero from comptes where branche_id = $1 and actif and numero = any($2::text[])", [br, b.lignes.map((l) => l.compte)]);
      const connus = new Set(comptes.map((c) => c.numero));
      for (const l of b.lignes) {
        if (!connus.has(l.compte)) throw new ErreurApi(409, "compte_inconnu", { numero: l.compte });
        if (!["2", "6"].includes(l.compte[0]!) && !l.compte.startsWith("3")) throw new ErreurApi(400, "compte_achat_invalide");
      }
      if (b.commandeId) {
        const { rows } = await ctx.client.query("select fournisseur_id from commandes_achat where id = $1", [b.commandeId]);
        if (rows[0]?.fournisseur_id !== b.fournisseurId) throw new ErreurApi(409, "commande_autre_fournisseur");
      }
      const ht = b.lignes.reduce((s, l) => s + l.montantHt, 0);
      const taxes = b.lignes.reduce((s, l) => s + (l.montantTaxes ?? 0), 0);
      const { rows: [x] } = await ctx.client.query(
        `insert into factures_fournisseur (organisation_id, entite_id, fournisseur_id, numero_fournisseur, commande_id, date_facture, date_echeance, total_ht, total_taxes, total_ttc, niu_fournisseur, cree_par)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning *`,
        [ctx.organisationId, b.entiteId, b.fournisseurId, b.numeroFournisseur, b.commandeId ?? null, b.date, b.echeance ?? null, ht, taxes, ht + taxes, b.niu?.trim() || null, ctx.utilisateurId],
      );
      for (const [i, l] of b.lignes.entries()) {
        await ctx.client.query(
          "insert into lignes_facture_fournisseur (organisation_id, facture_id, ordre, designation, compte_numero, montant_ht, montant_taxes) values ($1, $2, $3, $4, $5, $6, $7)",
          [ctx.organisationId, x.id, i + 1, l.designation, l.compte, l.montantHt, l.montantTaxes ?? 0],
        );
      }
      return x;
    });
    return reponse.status(201).send(f);
  });

  const lire = async (ctx: Contexte, id: string, p: "compta.voir" | "compta.saisir" | "compta.valider") => {
    const { rows: [f] } = await ctx.client.query(
      `select f.*, t.nom as fournisseur,
         coalesce((select sum(p.montant) from paiements_fournisseur p where p.facture_id = f.id and p.annule_le is null), 0)::int8 as paye,
         (select c.total from commandes_achat c where c.id = f.commande_id)::int8 as commande_total,
         (select sum(l.quantite_recue * l.prix_unitaire) from lignes_achat l where l.commande_id = f.commande_id)::float as recu
       from factures_fournisseur f join tiers t on t.id = f.fournisseur_id where f.id = $1 for update of f`,
      [id],
    );
    if (!f) throw new ErreurApi(404, "introuvable");
    await exigerBranche(ctx, f.entite_id, p);
    return { ...f, controle: controleTroisVoies(f.total_ht, f.commande_total, f.recu === null ? null : Math.round(f.recu)) };
  };

  /** Échéancier : ce qui reste à payer, avec les alertes de déductibilité fiscale. */
  app.get<{ Querystring: { brancheId: string } }>("/fournisseurs/factures", { schema: { querystring: queryBranche } }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "compta.voir", req.query.brancheId);
      const { rows } = await ctx.client.query(
        `select f.id, f.numero, f.numero_fournisseur, f.statut, f.date_facture, f.date_echeance, f.total_ttc, f.niu_fournisseur, f.commande_id, t.nom as fournisseur,
           coalesce((select sum(p.montant) from paiements_fournisseur p where p.facture_id = f.id and p.annule_le is null), 0)::int8 as paye,
           (select count(*) from paiements_fournisseur p join portefeuilles x on x.id = p.portefeuille_id where p.facture_id = f.id and p.annule_le is null and x.type = 'especes' and p.montant >= 100000)::int as especes_100k
         from factures_fournisseur f join tiers t on t.id = f.fournisseur_id
         where entite_branche(f.entite_id) = $1 order by f.statut = 'validee' desc, f.date_echeance nulls last, f.date_facture desc limit 1000`,
        [req.query.brancheId],
      );
      return rows;
    }),
  );

  app.get<{ Params: { id: string } }>("/fournisseurs/factures/:id", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const f = await lire(ctx, req.params.id, "compta.voir");
      const [lignes, paiements] = await Promise.all([
        ctx.client.query("select designation, compte_numero, montant_ht, montant_taxes from lignes_facture_fournisseur where facture_id = $1 order by ordre", [f.id]),
        ctx.client.query("select p.id, p.montant, p.date_paiement, p.reference, p.annule_le, p.motif_annulation, x.nom as portefeuille from paiements_fournisseur p join portefeuilles x on x.id = p.portefeuille_id where p.facture_id = $1 order by p.cree_le desc", [f.id]),
      ]);
      return { ...f, lignes: lignes.rows, paiements: paiements.rows };
    }),
  );

  app.post<{ Params: { id: string }; Body?: { motifEcart?: string } | null }>("/fournisseurs/factures/:id/validation", {
    schema: { params: paramId, body: { type: ["object", "null"], properties: { motifEcart: { type: "string", minLength: 5, maxLength: 500 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const f = await lire(ctx, req.params.id, "compta.valider");
      if (f.statut !== "brouillon") throw new ErreurApi(409, "facture_deja_traitee");
      await exigerSeparation(ctx, "factures_fournisseur", f.cree_par);
      if (["ecart", "non_recu"].includes(f.controle.statut) && !req.body?.motifEcart) {
        throw new ErreurApi(409, "ecart_trois_voies", f.controle);
      }
      const numero = await prochainNumero(ctx.client, `FF-${f.date_facture.slice(0, 4)}`);
      const { rows } = await ctx.client.query(
        "update factures_fournisseur set statut = 'validee', numero = $2, motif_ecart = $3, valide_par = $4, valide_le = now() where id = $1 returning *",
        [f.id, numero, req.body?.motifEcart ?? null, ctx.utilisateurId],
      );
      return rows[0];
    }),
  );

  app.post<{ Params: { id: string }; Body: { motif: string } }>("/fournisseurs/factures/:id/annulation", {
    schema: { params: paramId, body: { type: "object", required: ["motif"], properties: { motif: { type: "string", minLength: 5, maxLength: 500 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const f = await lire(ctx, req.params.id, "compta.valider");
      if (f.statut === "annulee") throw new ErreurApi(409, "facture_deja_traitee");
      if (f.paye > 0) throw new ErreurApi(409, "facture_payee");
      await ctx.client.query("update factures_fournisseur set statut = 'annulee', motif_annulation = $2, annulee_le = now() where id = $1", [f.id, req.body.motif]);
      return { annulee: true };
    }),
  );

  const payerFacture = async (ctx: Contexte, id: string, b: { portefeuilleId: string; montant: number; date: string; reference?: string }) => {
    const f = await lire(ctx, id, "compta.valider");
    if (f.statut !== "validee") throw new ErreurApi(409, "facture_non_validee");
    if (b.montant > f.total_ttc - f.paye) throw new ErreurApi(409, "montant_superieur_au_reste");
    const { rows: [w] } = await ctx.client.query("select *, entite_branche(entite_id) as branche from portefeuilles where id = $1 for update", [b.portefeuilleId]);
    if (!w) throw new ErreurApi(404, "introuvable");
    if (w.branche !== (await branche(ctx, f.entite_id))) throw new ErreurApi(409, "transfert_autre_branche");
    if (!w.actif) throw new ErreurApi(409, "portefeuille_inactif");
    const { rows: [{ s }] } = await ctx.client.query("select coalesce(sum(montant), 0)::int8 as s from mouvements_portefeuille where portefeuille_id = $1", [w.id]);
    if (b.montant > s) throw new ErreurApi(409, "solde_portefeuille_insuffisant");
    const { rows: [p] } = await ctx.client.query(
      "insert into paiements_fournisseur (organisation_id, facture_id, portefeuille_id, montant, date_paiement, reference, auteur_id) values ($1, $2, $3, $4, $5, $6, $7) returning *",
      [ctx.organisationId, f.id, w.id, b.montant, b.date, b.reference?.trim() || null, ctx.utilisateurId],
    );
    await ctx.client.query(
      `insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, reference, source_type, source_id, auteur_id)
       values ($1, $2, 'sortie', $3, $4, $5, 'paiement_fournisseur', $6, $7)`,
      [ctx.organisationId, w.id, -b.montant, `Paiement ${f.numero} à ${f.fournisseur}`, b.reference?.trim() || null, p.id, ctx.utilisateurId],
    );
    return { ...p, alerte_especes: w.type === "especes" && b.montant >= 100000 };
  };
  /** Tout passe ou rien ne passe : un lot ne laisse jamais la moitié des factures payées. */
  app.post<{ Body: { portefeuilleId: string; date: string; factures: string[]; reference?: string } }>("/fournisseurs/lots-paiement", {
    schema: { body: { type: "object", required: ["portefeuilleId", "date", "factures"], properties: { portefeuilleId: uuid, date, reference: { type: "string", maxLength: 200 }, factures: { type: "array", minItems: 1, maxItems: 200, uniqueItems: true, items: uuid } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      let total = 0;
      for (const id of req.body.factures) {
        const f = await lire(ctx, id, "compta.valider");
        const reste = f.total_ttc - f.paye;
        if (reste <= 0) throw new ErreurApi(409, "montant_superieur_au_reste");
        await payerFacture(ctx, id, { portefeuilleId: req.body.portefeuilleId, montant: reste, date: req.body.date, reference: req.body.reference });
        total += reste;
      }
      return { payees: req.body.factures.length, total };
    });
    return reponse.status(201).send(r);
  });
  /** Le paiement sort du portefeuille choisi : il faut de l'argent, et il reste dans la même branche. */
  app.post<{ Params: { id: string }; Body: { portefeuilleId: string; montant: number; date: string; reference?: string } }>("/fournisseurs/factures/:id/paiements", {
    schema: {
      params: paramId,
      body: { type: "object", required: ["portefeuilleId", "montant", "date"], properties: { portefeuilleId: uuid, montant, date, reference: { type: "string", maxLength: 200 } } },
    },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      return payerFacture(ctx, req.params.id, req.body);
    });
    return reponse.status(201).send(r);
  });

  app.post<{ Params: { id: string }; Body: { motif: string } }>("/fournisseurs/paiements/:id/annulation", {
    schema: { params: paramId, body: { type: "object", required: ["motif"], properties: { motif: { type: "string", minLength: 5, maxLength: 500 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [p] } = await ctx.client.query("select * from paiements_fournisseur where id = $1 for update", [req.params.id]);
      if (!p) throw new ErreurApi(404, "introuvable");
      await lire(ctx, p.facture_id, "compta.valider");
      if (p.annule_le) throw new ErreurApi(409, "deja_annule");
      await ctx.client.query("update paiements_fournisseur set annule_le = now(), motif_annulation = $2 where id = $1", [p.id, req.body.motif]);
      await ctx.client.query(
        `insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, source_type, source_id, annule_mouvement_id, auteur_id)
         select organisation_id, portefeuille_id, 'annulation', -montant, $2, source_type, source_id, id, $3 from mouvements_portefeuille where source_id = $1 and type = 'sortie'`,
        [p.id, `Annulation : ${req.body.motif}`, ctx.utilisateurId],
      );
      return { annule: true };
    }),
  );

  // Immobilisations
  app.get("/immobilisations/categories", async (req) => protege(req, async () => CATEGORIES_IMMO));

  app.post<{
    Body: { brancheId: string; code: string; designation: string; categorie: string; dateAcquisition: string; dateService: string; cout: number; valeurResiduelle?: number; dureeMois: number; tauxFiscal?: number; factureId?: string };
  }>("/immobilisations", {
    schema: {
      body: {
        type: "object", required: ["brancheId", "code", "designation", "categorie", "dateAcquisition", "dateService", "cout", "dureeMois"],
        properties: {
          brancheId: uuid, code: { type: "string", minLength: 1, maxLength: 40 }, designation: { type: "string", minLength: 2, maxLength: 300 }, categorie: { type: "string", enum: Object.keys(CATEGORIES_IMMO) },
          dateAcquisition: date, dateService: date, cout: montant, valeurResiduelle: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 },
          dureeMois: { type: "integer", minimum: 1, maximum: 1200 }, tauxFiscal: { type: "number", minimum: 0, maximum: 100 }, factureId: uuid,
        },
      },
    },
  }, async (req, reponse) => {
    const i = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "compta.saisir", b.brancheId);
      if (b.dateService < b.dateAcquisition) throw new ErreurApi(400, "dates_invalides");
      if ((b.valeurResiduelle ?? 0) >= b.cout) throw new ErreurApi(400, "donnees_invalides");
      const c = CATEGORIES_IMMO[b.categorie]!;
      const { rows } = await ctx.client.query(
        `insert into immobilisations (organisation_id, branche_id, code, designation, categorie, compte_numero, compte_amort, compte_dotation, date_acquisition, date_service, cout, valeur_residuelle, duree_mois, taux_fiscal, facture_id, cree_par)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning *`,
        [ctx.organisationId, b.brancheId, b.code, b.designation, b.categorie, c.compte, c.amort, c.dotation, b.dateAcquisition, b.dateService, b.cout, b.valeurResiduelle ?? 0, b.dureeMois, b.tauxFiscal ?? c.tauxCgi, b.factureId ?? null, ctx.utilisateurId],
      );
      return { ...rows[0], alerte_petit_materiel: b.cout < 500000 };
    });
    return reponse.status(201).send(i);
  });

  /** Registre : valeur nette à la fin de l'année demandée. */
  app.get<{ Querystring: { brancheId: string; annee: number } }>("/immobilisations", { schema: { querystring: queryAnnee } }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "compta.voir", req.query.brancheId);
      const { rows } = await ctx.client.query(
        `select i.*, coalesce((select sum(d.montant) from dotations_immobilisation d where d.immobilisation_id = i.id), 0)::int8 as amorti_comptabilise from immobilisations i where i.branche_id = $1 order by i.date_service, i.code`,
        [req.query.brancheId],
      );
      return rows.map((i) => {
        let cumul = 0;
        for (let a = Number(i.date_service.slice(0, 4)); a <= req.query.annee; a += 1) cumul += dotationAnnee(i, a);
        return { ...i, dotation_annee: dotationAnnee(i, req.query.annee), amorti_cumule: cumul, valeur_nette: i.cout - cumul };
      });
    }),
  );

  /** Prépare les dotations de l'année en brouillon, une seule fois par bien. */
  app.post<{ Body: { brancheId: string; annee: number } }>("/immobilisations/dotations", {
    schema: { body: { type: "object", required: ["brancheId", "annee"], properties: { brancheId: uuid, annee: queryAnnee.properties.annee } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { brancheId, annee } = req.body;
      await exigerSurEntite(ctx, "compta.saisir", brancheId);
      const { rows } = await ctx.client.query(
        `select i.* from immobilisations i where i.branche_id = $1 and not exists (select 1 from dotations_immobilisation d where d.immobilisation_id = i.id and d.annee = $2) for update`,
        [brancheId, annee],
      );
      let crees = 0;
      for (const i of rows) {
        const m = dotationAnnee(i, annee);
        if (m > 0) {
          await ctx.client.query(
            "insert into dotations_immobilisation (organisation_id, immobilisation_id, annee, montant) values ($1, $2, $3, $4)",
            [ctx.organisationId, i.id, annee, m],
          );
          crees += 1;
        }
      }
      return { crees };
    }),
  );

  /** La cession arrête l'amortissement au mois de la vente. L'écriture suit à la prochaine préparation. */
  app.post<{ Params: { id: string }; Body: { date: string; prix: number } }>("/immobilisations/:id/cession", {
    schema: { params: paramId, body: { type: "object", required: ["date", "prix"], properties: { date, prix: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [i] } = await ctx.client.query("select * from immobilisations where id = $1 for update", [req.params.id]);
      if (!i) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "compta.valider", i.branche_id);
      if (i.cession_le) throw new ErreurApi(409, "deja_cede");
      if (req.body.date < i.date_service) throw new ErreurApi(400, "dates_invalides");
      await ctx.client.query("update immobilisations set cession_le = $2, cession_prix = $3 where id = $1", [i.id, req.body.date, req.body.prix]);
      return { cede: true };
    }),
  );

  // États officiels
  const balancePour = async (ctx: Contexte, brancheId: string, debut: string, fin: string, sansAn = false) => (await ctx.client.query(
    `select c.numero, sum(l.debit)::int8 as debit, sum(l.credit)::int8 as credit
     from lignes_ecriture l join ecritures e on e.id = l.ecriture_id join comptes c on c.id = l.compte_id join journaux j on j.id = e.journal_id
     where e.branche_id = $1 and e.statut = 'validee' and e.date_ecriture between $2 and $3 ${sansAn ? "and j.code <> 'AN'" : ""} group by c.numero order by c.numero`,
    [brancheId, debut, fin],
  )).rows as LigneBalance[];

  const etats = async (ctx: Contexte, brancheId: string, annee: number) => {
    const [debut, fin] = [`${annee}-01-01`, `${annee}-12-31`];
    const toute = await balancePour(ctx, brancheId, debut, fin);
    const mouvements = await balancePour(ctx, brancheId, debut, fin, true);
    const ouverture = (await ctx.client.query(
      `select coalesce(sum(l.debit - l.credit), 0)::int8 as t
       from lignes_ecriture l join ecritures e on e.id = l.ecriture_id join comptes c on c.id = l.compte_id join journaux j on j.id = e.journal_id
       where e.branche_id = $1 and e.statut = 'validee' and e.date_ecriture between $2 and $3 and j.code = 'AN' and c.numero like '5%' and c.numero not like '59%'`,
      [brancheId, debut, fin],
    )).rows[0].t as number;
    const anterieure = await balancePour(ctx, brancheId, `${annee - 1}-01-01`, `${annee - 1}-12-31`);
    const b = bilan(toute);
    const cr = compteDeResultat(toute);
    const tresoCloture = toute.filter((x) => x.numero[0] === "5" && !x.numero.startsWith("59")).reduce((s, x) => s + x.debit - x.credit, 0);
    const flux = fluxDeTresorerie(mouvements, ouverture, tresoCloture);
    const crN1 = compteDeResultat(anterieure).lignes;
    const bN1 = bilan(anterieure);
    const { rows: [br] } = await ctx.client.query("select count(*)::int as n from ecritures where branche_id = $1 and statut = 'brouillon' and extract(year from date_ecriture)::int = $2", [brancheId, annee]);
    const { rows: [clos] } = await ctx.client.query("select 1 as x from clotures_exercice where branche_id = $1 and annee = $2", [brancheId, annee]);
    return {
      annee, clos: !!clos, brouillons: br.n, libelles: LIBELLES, bilan: b, compteDeResultat: cr, flux,
      n1: { resultat: crN1, actif: Object.fromEntries(bN1.actif.map((l) => [l.ref, l.net])), passif: Object.fromEntries(bN1.passif.map((l) => [l.ref, l.net])) },
    };
  };

  app.get<{ Querystring: { brancheId: string; annee: number } }>("/compta/etats-officiels", { schema: { querystring: queryAnnee } }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "compta.voir", req.query.brancheId);
      return etats(ctx, req.query.brancheId, req.query.annee);
    }),
  );

  // Préparation de la DSF
  const suggestions = async (ctx: Contexte, brancheId: string, annee: number) => {
    const { rows: [e] } = await ctx.client.query(
      `select coalesce(sum(l.debit), 0)::int8 as m from lignes_ecriture l join ecritures x on x.id = l.ecriture_id join comptes c on c.id = l.compte_id
       where x.branche_id = $1 and x.statut = 'validee' and extract(year from x.date_ecriture)::int = $2 and c.numero like '6%' and l.debit >= 100000
         and exists (select 1 from lignes_ecriture k join comptes kc on kc.id = k.compte_id where k.ecriture_id = x.id and kc.numero like '57%' and k.credit > 0)`,
      [brancheId, annee],
    );
    const { rows: immo } = await ctx.client.query("select * from immobilisations where branche_id = $1 and taux_fiscal is not null", [brancheId]);
    const exces = immo.reduce((s, i) => {
      const comptable = dotationAnnee(i, annee);
      const fiscal = Math.round((i.cout * Number(i.taux_fiscal)) / 100);
      return s + Math.max(comptable - fiscal, 0);
    }, 0);
    const { rows: [nf] } = await ctx.client.query(
      `select coalesce(sum(f.total_ht), 0)::int8 as m from factures_fournisseur f where entite_branche(f.entite_id) = $1 and f.statut = 'validee' and f.niu_fournisseur is null and extract(year from f.date_facture)::int = $2`,
      [brancheId, annee],
    );
    return [
      { libelle: "Charges de 100 000 FCFA ou plus payées en espèces (CGI art. 8 bis)", montant: e.m as number },
      { libelle: "Amortissement comptable au-delà du taux fiscal (CGI art. 7)", montant: exces },
      { libelle: "Factures fournisseurs sans NIU (CGI art. 8 bis), à vérifier : fournisseurs étrangers exclus", montant: nf.m as number },
    ].filter((x) => x.montant > 0);
  };
  const CENTRES: Record<string, { libelle: string; date: string }> = {
    dge: { libelle: "Grandes entreprises", date: "15 mars" },
    cime: { libelle: "Moyennes entreprises et centres spécialisés", date: "15 avril" },
    cdi: { libelle: "Centres divisionnaires et individuels", date: "15 mai" },
  };

  const dossierDsf = async (ctx: Contexte, brancheId: string, annee: number) => {
    const e = await etats(ctx, brancheId, annee);
    const { rows: [p] } = await ctx.client.query("select * from preparations_dsf where branche_id = $1 and annee = $2", [brancheId, annee]);
    const d = {
      reintegrations: (p?.reintegrations ?? []) as { libelle: string; montant: number }[], deductions: (p?.deductions ?? []) as { libelle: string; montant: number }[],
      deficit_anterieur: Number(p?.deficit_anterieur ?? 0), taux_is: p?.taux_is === null || p?.taux_is === undefined ? null : Number(p.taux_is), taux_cac: p?.taux_cac === null || p?.taux_cac === undefined ? null : Number(p.taux_cac),
      minimum_du: Number(p?.minimum_du ?? 0), acomptes: Number(p?.acomptes ?? 0),
    };
    const impot = -(e.compteDeResultat.lignes.RS ?? 0);
    const fiscal = calculFiscal(e.compteDeResultat.lignes.XI ?? 0, impot, d);
    const blocages = [
      ...(e.clos ? [] : ["L'exercice n'est pas clos."]),
      ...(e.brouillons ? [`${e.brouillons} brouillon(s) sur l'année.`] : []),
      ...(e.bilan.equilibre ? [] : ["Le bilan n'est pas équilibré."]),
      ...(e.flux.ecart ? ["Le tableau des flux ne retrouve pas la trésorerie."] : []),
      ...(e.bilan.nonClasses.length || e.compteDeResultat.nonClasses.length ? [`Comptes sans rubrique : ${[...e.bilan.nonClasses, ...e.compteDeResultat.nonClasses].join(", ")}.`] : []),
      ...(fiscal.tauxManquants ? ["Les taux d'impôt ne sont pas saisis."] : []),
      ...(p?.relue_par ? [] : ["La relecture de l'expert comptable n'est pas enregistrée."]),
    ];
    return { ...e, preparation: { ...d, centre: p?.centre ?? null, relue_par: p?.relue_par ?? null, relue_le: p?.relue_le ?? null }, fiscal, suggestions: await suggestions(ctx, brancheId, annee), blocages, pret: blocages.length === 0, echeance: p?.centre ? CENTRES[p.centre] : null, centres: CENTRES };
  };

  app.get<{ Querystring: { brancheId: string; annee: number } }>("/compta/dsf", { schema: { querystring: queryAnnee } }, async (req) =>
    protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "compta.voir", req.query.brancheId);
      return dossierDsf(ctx, req.query.brancheId, req.query.annee);
    }),
  );

  const lignesMontant = {
    type: "array", maxItems: 100,
    items: { type: "object", required: ["libelle", "montant"], properties: { libelle: { type: "string", minLength: 2, maxLength: 300 }, montant: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 } } },
  } as const;

  app.put<{
    Body: { brancheId: string; annee: number; centre: string; reintegrations: object[]; deductions: object[]; deficitAnterieur: number; tauxIs: number; tauxCac: number; minimumDu: number; acomptes: number; relueParExpert?: string; relueLe?: string };
  }>("/compta/dsf", {
    schema: {
      body: {
        type: "object", required: ["brancheId", "annee", "centre", "reintegrations", "deductions", "deficitAnterieur", "tauxIs", "tauxCac", "minimumDu", "acomptes"],
        properties: {
          brancheId: uuid, annee: queryAnnee.properties.annee, centre: { type: "string", enum: ["dge", "cime", "cdi"] }, reintegrations: lignesMontant, deductions: lignesMontant,
          deficitAnterieur: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 }, tauxIs: { type: "number", minimum: 0, maximum: 100 }, tauxCac: { type: "number", minimum: 0, maximum: 100 },
          minimumDu: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 }, acomptes: { type: "integer", minimum: 0, maximum: 1_000_000_000_000 },
          relueParExpert: { type: "string", minLength: 3, maxLength: 200 }, relueLe: date,
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "compta.cloturer", b.brancheId);
      await dsfOuverte(ctx, b.brancheId, b.annee);
      await ctx.client.query(
        `insert into preparations_dsf (organisation_id, branche_id, annee, centre, reintegrations, deductions, deficit_anterieur, taux_is, taux_cac, minimum_du, acomptes, relue_par, relue_le)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         on conflict (organisation_id, branche_id, annee) do update set centre = excluded.centre, reintegrations = excluded.reintegrations, deductions = excluded.deductions, deficit_anterieur = excluded.deficit_anterieur,
           taux_is = excluded.taux_is, taux_cac = excluded.taux_cac, minimum_du = excluded.minimum_du, acomptes = excluded.acomptes, relue_par = excluded.relue_par, relue_le = excluded.relue_le, maj_le = now()`,
        [ctx.organisationId, b.brancheId, b.annee, b.centre, JSON.stringify(b.reintegrations), JSON.stringify(b.deductions), b.deficitAnterieur, b.tauxIs, b.tauxCac, b.minimumDu, b.acomptes, b.relueParExpert ?? null, b.relueLe ?? null],
      );
      await noter(ctx, "dsf.preparation", { branche: b.brancheId, annee: b.annee, relue_par: b.relueParExpert ?? null });
      return dossierDsf(ctx, b.brancheId, b.annee);
    }),
  );

  const dsfOuverte = async (ctx: Contexte, brancheId: string, annee: number) => {
    const { rows } = await ctx.client.query("select 1 from dsf_versions where branche_id = $1 and annee = $2 and statut = 'deposee'", [brancheId, annee]);
    if (rows[0]) throw new ErreurApi(409, "dsf_deposee");
  };
  /** Une correction ne touche pas la comptabilité. Elle remplace la case dans l'export, avec sa justification. */
  app.put<{ Body: { brancheId: string; annee: number; etat: string; reference: string; montant: number; justification: string } }>("/compta/dsf/corrections", {
    schema: { body: { type: "object", required: ["brancheId", "annee", "etat", "reference", "montant", "justification"], properties: { brancheId: uuid, annee: queryAnnee.properties.annee, etat: { type: "string", enum: ["Actif", "Passif", "Resultat", "Flux"] }, reference: { type: "string", minLength: 1, maxLength: 20 }, montant: { type: "integer" }, justification: { type: "string", minLength: 10, maxLength: 1000 } } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "compta.cloturer", b.brancheId);
      await dsfOuverte(ctx, b.brancheId, b.annee);
      await ctx.client.query(
        `insert into dsf_corrections (organisation_id, branche_id, annee, etat, reference, montant, justification, auteur_id) values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (organisation_id, branche_id, annee, etat, reference) do update set montant = excluded.montant, justification = excluded.justification, auteur_id = excluded.auteur_id, cree_le = now()`,
        [ctx.organisationId, b.brancheId, b.annee, b.etat, b.reference, b.montant, b.justification, ctx.utilisateurId],
      );
      return { enregistre: true };
    }),
  );
  app.get<{ Querystring: { brancheId: string; annee: number } }>("/compta/dsf/suivi", { schema: { querystring: queryAnnee } }, async (req) =>
    protege(req, async (ctx) => {
      const q = req.query;
      await exigerSurEntite(ctx, "compta.voir", q.brancheId);
      const { rows: corrections } = await ctx.client.query("select c.etat, c.reference, c.montant::int8, c.justification, c.cree_le, u.nom as auteur from dsf_corrections c join utilisateurs u on u.id = c.auteur_id where c.branche_id = $1 and c.annee = $2 order by c.etat, c.reference", [q.brancheId, q.annee]);
      const { rows: versions } = await ctx.client.query("select v.numero, v.statut, v.cree_le, u.nom as auteur, (v.contenu->'fiscal'->>'resultatFiscal')::int8 as resultat_fiscal, (v.contenu->'bilan'->>'totalActif')::int8 as total_actif from dsf_versions v join utilisateurs u on u.id = v.auteur_id where v.branche_id = $1 and v.annee = $2 order by v.numero desc", [q.brancheId, q.annee]);
      return { corrections, versions };
    }),
  );
  /** Chaque version fige tout le dossier, corrections comprises. Après le dépôt, rien ne se modifie plus. */
  app.post<{ Body: { brancheId: string; annee: number; statut: string } }>("/compta/dsf/versions", {
    schema: { body: { type: "object", required: ["brancheId", "annee", "statut"], properties: { brancheId: uuid, annee: queryAnnee.properties.annee, statut: { type: "string", enum: ["validee", "deposee"] } } } },
  }, async (req, reponse) => {
    const r = await protege(req, async (ctx) => {
      const b = req.body;
      await exigerSurEntite(ctx, "compta.cloturer", b.brancheId);
      await ctx.client.query("select pg_advisory_xact_lock(hashtext($1))", [`dsf:${b.brancheId}:${b.annee}`]);
      await dsfOuverte(ctx, b.brancheId, b.annee);
      const d = await dossierDsf(ctx, b.brancheId, b.annee);
      const { rows: corrections } = await ctx.client.query("select etat, reference, montant::int8, justification from dsf_corrections where branche_id = $1 and annee = $2", [b.brancheId, b.annee]);
      const { rows: [{ n }] } = await ctx.client.query("select coalesce(max(numero), 0) + 1 as n from dsf_versions where branche_id = $1 and annee = $2", [b.brancheId, b.annee]);
      await ctx.client.query("insert into dsf_versions (organisation_id, branche_id, annee, numero, statut, contenu, auteur_id) values ($1, $2, $3, $4, $5, $6, $7)", [ctx.organisationId, b.brancheId, b.annee, n, b.statut, JSON.stringify({ ...d, corrections }), ctx.utilisateurId]);
      await noter(ctx, "dsf.version", { branche: b.brancheId, annee: b.annee, numero: n, statut: b.statut });
      return { numero: n, statut: b.statut };
    });
    return reponse.status(201).send(r);
  });

  /** Valeurs à reporter dans le modèle Excel de la DGI, téléchargé depuis le portail de télédéclaration. */
  app.get<{ Querystring: { brancheId: string; annee: number } }>("/compta/dsf/export", { schema: { querystring: queryAnnee } }, async (req, reponse) => {
    const { d, corr } = await protege(req, async (ctx) => {
      await exigerSurEntite(ctx, "compta.voir", req.query.brancheId);
      const { rows } = await ctx.client.query("select etat, reference, montant::int8 from dsf_corrections where branche_id = $1 and annee = $2", [req.query.brancheId, req.query.annee]);
      return { d: await dossierDsf(ctx, req.query.brancheId, req.query.annee), corr: new Map(rows.map((x) => [`${x.etat}:${x.reference}`, Number(x.montant)])) };
    });
    const lignes: unknown[][] = [["Etat", "Reference", "Libelle", "Brut", "Amortissements", "Net N", "Net N-1"]];
    for (const l of d.bilan.actif) lignes.push(["Actif", l.ref, LIBELLES[l.ref], l.brut, l.amort, corr.get(`Actif:${l.ref}`) ?? l.net, d.n1.actif[l.ref] ?? 0]);
    for (const l of d.bilan.passif) lignes.push(["Passif", l.ref, LIBELLES[l.ref], "", "", corr.get(`Passif:${l.ref}`) ?? l.net, d.n1.passif[l.ref] ?? 0]);
    for (const r of Object.keys(LIBELLES).filter((x) => /^(T|R|X)/.test(x))) lignes.push(["Resultat", r, LIBELLES[r], "", "", corr.get(`Resultat:${r}`) ?? d.compteDeResultat.lignes[r] ?? 0, d.n1.resultat[r] ?? 0]);
    for (const l of d.flux.lignes) lignes.push(["Flux", l.ref, LIBELLES[l.ref], "", "", corr.get(`Flux:${l.ref}`) ?? l.montant, ""]);
    const f = d.fiscal;
    for (const [lib, v] of [["Resultat avant impot", f.avantImpot], ["Reintegrations", f.reintegrations], ["Deductions", f.deductions], ["Resultat fiscal", f.resultatFiscal], ["Base imposable", f.imposable], ["Impot principal", f.principal], ["Centimes additionnels", f.cac], ["Impot du", f.du], ["Solde apres acomptes", f.solde]] as [string, number][]) lignes.push(["Fiscal", "", lib, "", "", v, ""]);
    return reponse.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="Preparation DSF ${req.query.annee}.csv"`)
      .send(`﻿${lignes.map((l) => l.map(celluleCsv).join(";")).join("\r\n")}`);
  });
}
