import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from "fastify";
import pg from "pg";
import { dansOrganisation, publierEvenement, type Client } from "./base.js";
import { leverReservations } from "./canalenligne.js";
import { creerBrouillon, emettre } from "./facturation.js";
import { prochainNumero } from "./formations.js";
import { confierAuxTitulaires } from "./performance.js";
import { entitesAccessibles } from "./permissions.js";
import { creerColis } from "./pilotage.js";
import { apresRemboursement, leverReservationsInscription, solderInscription, traiterAcompte } from "./precommandes.js";
import { hacherJeton } from "./securite.js";
import { ErreurApi, type Contexte, type Outils } from "./serveur.js";

/**
 * Paiement Mobile Money des commandes en ligne (lot 2). Une commande n'est payée que sur avis signé du prestataire ;
 * la vente se termine alors seule : règlement (qui encaisse), facture avec sortie du stock réservé, colis.
 */

export type MoyenEnLigne = "orange_money" | "mtn_momo";
export interface DemandePaiement {
  referenceCommande: string; montant: number; moyen: MoyenEnLigne; telephone: string; adresseAvis: string; libelle: string;
}
export interface AvisPaiement { referencePrestataire: string; statut: "reussi" | "echoue"; montant: number }
export type Instruction = { type: "telephone"; texte: string } | { type: "lien"; url: string };
export interface PrestatairePaiement {
  nom: string;
  moyens: MoyenEnLigne[];
  initier(d: DemandePaiement): Promise<{ referencePrestataire: string; instruction: Instruction }>;
  /** Null si la signature manque ou est fausse, ou si le corps est illisible. */
  verifierAvis(entetes: Record<string, string | string[] | undefined>, corpsBrut: string): AvisPaiement | null;
}

const signer = (secret: string, corpsBrut: string) => createHmac("sha256", secret).update(corpsBrut).digest("hex");

/** Pour les tests et l'essai privé seulement : il n'appelle aucun opérateur. */
export function prestataireFactice(secret: string): PrestatairePaiement {
  return {
    nom: "factice",
    moyens: ["orange_money", "mtn_momo"],
    async initier() {
      return { referencePrestataire: `FACTICE-${randomBytes(16).toString("hex")}`, instruction: { type: "telephone", texte: "Validez le paiement sur votre téléphone." } };
    },
    verifierAvis(entetes, corpsBrut) {
      const recue = entetes["x-signature"];
      if (typeof recue !== "string" || !/^[0-9a-f]{64}$/.test(recue)) return null;
      if (!timingSafeEqual(Buffer.from(signer(secret, corpsBrut), "hex"), Buffer.from(recue, "hex"))) return null;
      try {
        const c = JSON.parse(corpsBrut);
        if (typeof c?.reference_prestataire !== "string" || !["reussi", "echoue"].includes(c.statut) || !Number.isSafeInteger(c.montant) || c.montant < 0) return null;
        return { referencePrestataire: c.reference_prestataire, statut: c.statut, montant: c.montant };
      } catch {
        return null;
      }
    },
  };
}

export function signerAvisFactice(secret: string, corps: object): { corpsBrut: string; signature: string } {
  const corpsBrut = JSON.stringify(corps);
  return { corpsBrut, signature: signer(secret, corpsBrut) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE = /^WEB-[0-9]{4}-[0-9]{6}$/;
const REFERENCE_PRECOMMANDE = /^PRE-[0-9]{4}-[0-9]{6}$/;
const JETON = /^[A-Za-z0-9_-]{43}$/;
const MOYENS: MoyenEnLigne[] = ["orange_money", "mtn_momo"];
const REMISE: Record<string, string> = { domicile: "livraison", agence_voyage: "expedition", point_relais: "livraison", retrait_magasin: "retrait" };
const MOTIFS: Record<string, string> = { expiree: "commande expirée", annulee: "commande annulée", deja_payee: "commande déjà payée" };
const paramId = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
const jourDouala = () => new Date(Date.now() + 3600000).toISOString().slice(0, 10);

type Issue = "traite" | "deja_traite" | "montant_different" | "inconnu" | "echec";

export function enregistrerPaiementEnLigne(
  app: FastifyInstance, pool: pg.Pool, outils: Outils,
  options: { prestataires: PrestatairePaiement[]; urlPublique: string; paiementsParMinute: number },
): void {
  const { protege, exigerSurEntite } = outils;
  const introuvable = (e: { code?: string }) => { if (e.code === "22P02") throw new ErreurApi(404, "introuvable"); throw e; };

  /**
   * Lève la réservation, facture au franc près sur la branche (le stock sort du lieu), règle, crée le colis.
   * Solde d'une précommande : la réservation est celle de l'inscription, et l'acompte déjà encaissé s'impute sur la facture.
   */
  const terminerVente = async (ctx: Contexte, w: Record<string, any>, referenceOperateur: string, moyen: string) => {
    const c = ctx.client;
    if (w.inscription_id) {
      const { rows: [i] } = await c.query("select statut from inscriptions_precommande where id = $1 for update", [w.inscription_id]);
      if (i?.statut !== "servie") throw new ErreurApi(409, "solde_impossible");
      await leverReservationsInscription(c, w.inscription_id);
    }
    await leverReservations(c, w.id);
    const { rows: lignes } = await c.query(
      "select produit_id, quantite, prix_unitaire_ht, taux_taxe::float as taux, total_ht from lignes_commande_web where commande_id = $1 order by produit_id",
      [w.id],
    );
    let adresse: string | undefined = w.adresse ?? undefined;
    if (w.point_relais_id) {
      const { rows: [r] } = await c.query("select nom, adresse from points_relais where id = $1", [w.point_relais_id]);
      adresse = [r.nom, r.adresse].filter(Boolean).join(", ");
    }
    const factureId = await creerBrouillon(ctx, "facture", {
      entiteId: w.entite_id, tiersId: w.tiers_id, date: jourDouala(), notes: `Commande en ligne ${w.reference}`,
      modeRemise: REMISE[w.mode_livraison], adresseLivraison: adresse, fraisLivraison: Number(w.frais_livraison), tauxFrais: 0,
    }, lignes.map((l) => ({ produitId: l.produit_id, quantite: l.quantite, prixUnitaire: Number(l.prix_unitaire_ht), tauxTaxe: l.taux, brutHt: Number(l.total_ht) })));
    const facture = await emettre(ctx, exigerSurEntite, factureId, w.lieu_id);
    // Le client a payé le total de la commande : la facture doit lui être égale au franc près.
    if (Number(facture.total_ttc) !== Number(w.total_ttc)) throw new ErreurApi(409, "montant_facture_different", { facture: facture.total_ttc, commande: w.total_ttc });
    const serie = `REG-${new Date(Date.now() + 3600000).getUTCFullYear()}`;
    const acompte = Number(w.acompte ?? 0);
    if (acompte > 0) {
      // L'argent de l'acompte est déjà dans le portefeuille : il s'impute sans nouvel encaissement, une seule fois (index unique).
      const { rows: [a] } = await c.query("select id, moyen, reference_prestataire from paiements_en_ligne where inscription_id = $1 and statut = 'reussi'", [w.inscription_id]);
      if (!a) throw new ErreurApi(409, "solde_impossible");
      await c.query(
        "insert into reglements (organisation_id, facture_id, numero_recu, montant, moyen, reference, encaisse_par, acompte_id) values ($1, $2, $3, $4, $5, $6, $7, $8)",
        [ctx.organisationId, factureId, await prochainNumero(c, serie), acompte, a.moyen, a.reference_prestataire, ctx.utilisateurId, a.id],
      );
    }
    const solde = Number(w.total_ttc) - acompte;
    const { rows: [reglement] } = await c.query(
      "insert into reglements (organisation_id, facture_id, numero_recu, montant, moyen, reference, encaisse_par) values ($1, $2, $3, $4, $5, $6, $7) returning id",
      [ctx.organisationId, factureId, await prochainNumero(c, serie), solde, moyen, referenceOperateur, ctx.utilisateurId],
    );
    await publierEvenement(c, "facture.reglement", { id: reglement.id, factureId, montant: solde });
    const colis = w.mode_livraison === "retrait_magasin" ? null : await creerColis(ctx, {
      entiteId: w.entite_id, destinataire: w.nom_client, telephone: w.telephone, adresse, zoneId: w.zone_id ?? undefined, aEncaisser: 0,
    });
    await c.query("update commandes_web set statut = 'facturee', facture_id = $2, colis_id = $3 where id = $1", [w.id, factureId, colis?.id ?? null]);
    await c.query("select journal_evenement('canal.vente_automatique', $1)", [JSON.stringify({ commande: w.id, facture: factureId, responsable: ctx.utilisateurId })]);
    await publierEvenement(c, "commande_web.facturee", { id: w.id, reference: w.reference, facture: facture.numero });
    if (w.inscription_id) await solderInscription(c, w.inscription_id, facture.numero);
    return facture;
  };

  /** L'argent est réellement chez l'opérateur : il est encaissé, puis remboursé à la main par le trésorier. */
  const aRembourser = async (c: Client, org: string, p: Record<string, any>, w: Record<string, any>, motif: string) => {
    await c.query("update paiements_en_ligne set statut = 'a_rembourser', motif = $2, traite_le = now() where id = $1", [p.id, motif]);
    if (w.statut === "expiree" || w.statut === "annulee") await c.query("update commandes_web set statut = 'a_rembourser' where id = $1", [w.id]);
    await c.query(
      "select tresorerie_encaisser($1, $2, $3, $4, $5, $6, 'paiement_en_ligne', $7)",
      [org, w.entite_id, p.moyen, p.montant, `Paiement à rembourser, commande ${w.reference}`, p.reference_prestataire, p.id],
    );
    await confierAuxTitulaires(c, org, w.entite_id, "tresorerie.gerer", w.responsable_id,
      `Rembourser le paiement ${p.reference_prestataire} : ${Number(p.montant).toLocaleString("fr-FR")} FCFA (${MOTIFS[motif]}, commande ${w.reference})`, w.tiers_id);
    await c.query("select journal_evenement('canal.paiement_a_rembourser', $1)", [JSON.stringify({ paiement: p.id, commande: w.id, motif })]);
    await publierEvenement(c, "commande_web.a_rembourser", { id: w.id, reference: w.reference, paiement: p.id, motif });
  };

  const traiterAvis = async (c: Client, org: string, nom: string, avis: AvisPaiement, journal: FastifyBaseLogger): Promise<{ issue: Issue; statut?: string }> => {
    const { rows: [p] } = await c.query(
      "select * from paiements_en_ligne where prestataire = $1 and reference_prestataire = $2 for update", [nom, avis.referencePrestataire],
    );
    if (!p) return { issue: "inconnu" };
    if (p.statut !== "lance") return { issue: "deja_traite", statut: p.statut };
    if (avis.montant !== Number(p.montant)) return { issue: "montant_different" };
    if (avis.statut === "echoue") {
      await c.query("update paiements_en_ligne set statut = 'echoue', traite_le = now() where id = $1", [p.id]);
      return { issue: "echec", statut: "echoue" };
    }
    if (p.inscription_id) return traiterAcompte(c, org, p, exigerSurEntite, journal);
    // Le balayage d'expiration prend ses commandes en « skip locked » : une seule des deux issues s'applique.
    const { rows: [w] } = await c.query(
      "select w.*, w.expire_le > now() as en_cours, k.responsable_id from commandes_web w join config_canal k on k.entite_id = w.entite_id where w.id = $1 for update of w",
      [p.commande_id],
    );
    if (w.statut === "reservee" && !w.colis_id && !w.en_cours) {
      await leverReservations(c, w.id);
      await c.query("update commandes_web set statut = 'expiree', traite_le = now() where id = $1", [w.id]);
      await publierEvenement(c, "commande_web.expiree", { id: w.id, reference: w.reference });
      w.statut = "expiree";
    }
    // Solde d'une précommande : l'inscription se verrouille après la commande. Délai passé (acompte conservé),
    // la commande expire et ce paiement est à rembourser ; l'acompte n'est jamais à la fois conservé et imputé.
    if (w.inscription_id && w.statut === "reservee") {
      const { rows: [i] } = await c.query("select statut from inscriptions_precommande where id = $1 for update", [w.inscription_id]);
      if (i.statut !== "servie") {
        await c.query("update commandes_web set statut = 'expiree', traite_le = now() where id = $1", [w.id]);
        await publierEvenement(c, "commande_web.expiree", { id: w.id, reference: w.reference });
        w.statut = "expiree";
      }
    }
    let motif: string | null = null;
    if (w.statut === "expiree" || w.statut === "annulee") motif = w.statut;
    else if (w.statut === "a_rembourser") {
      const { rows: [premier] } = await c.query("select motif from paiements_en_ligne where commande_id = $1 and statut = 'a_rembourser' order by traite_le limit 1", [w.id]);
      motif = premier?.motif ?? "expiree";
    } else if (w.statut !== "reservee" || w.colis_id) motif = "deja_payee";
    if (motif) {
      await aRembourser(c, org, p, w, motif);
      return { issue: "traite", statut: "a_rembourser" };
    }

    await c.query("update paiements_en_ligne set statut = 'reussi', traite_le = now() where id = $1", [p.id]);
    await c.query("update commandes_web set statut = 'payee' where id = $1", [w.id]);
    await publierEvenement(c, "commande_web.payee", { id: w.id, reference: w.reference, montant: Number(p.montant) });
    // Si la vente ne peut pas se terminer, le paiement reste enregistré : la commande demeure « payee ».
    await c.query("savepoint vente");
    try {
      await terminerVente({ client: c, utilisateurId: w.responsable_id, organisationId: org }, w, p.reference_prestataire, p.moyen);
      await c.query("release savepoint vente");
      return { issue: "traite", statut: "facturee" };
    } catch (e) {
      await c.query("rollback to savepoint vente");
      if (!(e instanceof ErreurApi)) journal.error(e, "vente automatique");
      const cause = e instanceof ErreurApi ? e.code : "erreur_interne";
      await confierAuxTitulaires(c, org, w.entite_id, "facturation.administrer", w.responsable_id, `Terminer la vente de la commande ${w.reference} : ${cause}`, w.tiers_id);
      await c.query("select journal_evenement('canal.vente_a_terminer', $1)", [JSON.stringify({ commande: w.id, cause })]);
      return { issue: "traite", statut: "payee" };
    }
  };

  // ---------- Routes publiques ----------

  /** L'opérateur est appelé hors transaction : aucune ligne n'est verrouillée pendant l'échange réseau. */
  const lancer = async (
    req: FastifyRequest, org: string, cible: { colonne: "commande_id" | "inscription_id"; id: string }, d: Omit<DemandePaiement, "adresseAvis">, responsable: string | null,
  ) => {
    const prestataire = options.prestataires.find((p) => p.moyens.includes(d.moyen));
    if (!prestataire || !responsable) throw new ErreurApi(503, "paiement_indisponible");
    let lancement: Awaited<ReturnType<PrestatairePaiement["initier"]>>;
    try {
      lancement = await prestataire.initier({ ...d, adresseAvis: `${options.urlPublique}/paiements/avis/${prestataire.nom}/${org}` });
    } catch (e) {
      req.log.warn(e, "lancement du paiement en ligne");
      throw new ErreurApi(503, "paiement_indisponible");
    }
    await dansOrganisation(pool, org, (c) => c.query(
      `insert into paiements_en_ligne (organisation_id, ${cible.colonne}, prestataire, moyen, reference_prestataire, montant) values ($1, $2, $3, $4, $5, $6)`,
      [org, cible.id, prestataire.nom, d.moyen, lancement.referencePrestataire, d.montant],
    ));
    return { statut: "lance", moyen: d.moyen, montant: d.montant, instruction: lancement.instruction };
  };

  app.post<{ Params: { org: string; reference: string }; Body: { jeton: string } }>("/marketplace/:org/commandes/:reference/payer", {
    config: { rateLimit: { max: options.paiementsParMinute, timeWindow: "1 minute" } },
    schema: { body: { type: "object", required: ["jeton"], properties: { jeton: { type: "string", maxLength: 100 } } } },
  }, async (req, reponse) => {
    const { org, reference } = req.params;
    if (!UUID.test(org) || !REFERENCE.test(reference) || !JETON.test(req.body.jeton)) throw new ErreurApi(404, "introuvable");
    const w = await dansOrganisation(pool, org, async (c) => {
      const { rows: [x] } = await c.query(
        `select w.id, w.statut, w.colis_id, w.moyen_paiement, w.total_ttc, w.acompte, w.telephone, w.expire_le > now() as en_cours, k.responsable_id
         from commandes_web w join config_canal k on k.entite_id = w.entite_id and k.actif
         where w.reference = $1 and w.jeton_suivi_hache = $2`,
        [reference, hacherJeton(req.body.jeton)],
      );
      if (!x) throw new ErreurApi(404, "introuvable");
      return x;
    }).catch(introuvable);
    if (w.statut !== "reservee" || w.colis_id || !w.en_cours || !MOYENS.includes(w.moyen_paiement)) throw new ErreurApi(409, "paiement_impossible", { statut: w.statut });
    // Le solde d'une précommande : l'acompte déjà versé est déduit.
    const montant = Number(w.total_ttc) - Number(w.acompte);
    return reponse.status(201).send(await lancer(req, org, { colonne: "commande_id", id: w.id }, {
      referenceCommande: reference, montant, moyen: w.moyen_paiement, telephone: w.telephone, libelle: `GLOMARI, commande ${reference}`,
    }, w.responsable_id));
  });

  /** L'acompte d'une précommande (lot 3A) : même circuit, seul l'avis signé de l'opérateur le valide. */
  app.post<{ Params: { org: string; reference: string }; Body: { jeton: string } }>("/marketplace/:org/precommandes/:reference/payer", {
    config: { rateLimit: { max: options.paiementsParMinute, timeWindow: "1 minute" } },
    schema: { body: { type: "object", required: ["jeton"], properties: { jeton: { type: "string", maxLength: 100 } } } },
  }, async (req, reponse) => {
    const { org, reference } = req.params;
    if (!UUID.test(org) || !REFERENCE_PRECOMMANDE.test(reference) || !JETON.test(req.body.jeton)) throw new ErreurApi(404, "introuvable");
    const i = await dansOrganisation(pool, org, async (c) => {
      const { rows: [x] } = await c.query(
        `select i.id, i.statut, i.acompte, i.telephone, i.moyen_paiement, i.expire_le > now() as en_cours, k.responsable_id,
           a.statut in ('ouverte', 'declenchee') and a.date_limite >= (now() at time zone 'Africa/Douala')::date and a.premiere_reception_le is null as accepte
         from inscriptions_precommande i join campagnes_arrivage a on a.id = i.campagne_id
         join config_canal k on k.entite_id = a.entite_id and k.actif
         where i.reference = $1 and i.jeton_suivi_hache = $2`,
        [reference, hacherJeton(req.body.jeton)],
      );
      if (!x) throw new ErreurApi(404, "introuvable");
      return x;
    }).catch(introuvable);
    if (i.statut !== "en_attente" || !i.en_cours || !i.accepte) throw new ErreurApi(409, "paiement_impossible", { statut: i.statut });
    return reponse.status(201).send(await lancer(req, org, { colonne: "inscription_id", id: i.id }, {
      referenceCommande: reference, montant: Number(i.acompte), moyen: i.moyen_paiement, telephone: i.telephone, libelle: `GLOMARI, acompte de la précommande ${reference}`,
    }, i.responsable_id));
  });

  // La signature se vérifie sur les octets reçus : dans ce seul sous-contexte, le JSON est lu comme texte.
  app.register(async (sous) => {
    sous.removeContentTypeParser(["application/json"]);
    sous.addContentTypeParser("application/json", { parseAs: "string" }, (_req, corps, fait) => fait(null, corps));
    sous.post<{ Params: { prestataire: string; org: string } }>("/paiements/avis/:prestataire/:org", {
      config: { rateLimit: { max: 300, timeWindow: "1 minute" } },
    }, async (req) => {
      const { prestataire: nom, org } = req.params;
      const prestataire = options.prestataires.find((p) => p.nom === nom);
      if (!prestataire || !UUID.test(org)) throw new ErreurApi(404, "introuvable");
      const corpsBrut = typeof req.body === "string" ? req.body : "";
      const avis = prestataire.verifierAvis(req.headers as Record<string, string | string[] | undefined>, corpsBrut);
      // Trace hors de la transaction de vente, et seulement pour une organisation qui a une boutique ouverte.
      const tracer = (issue: Issue | "signature_invalide") => dansOrganisation(pool, org, async (c) => {
        const { rows: [k] } = await c.query("select 1 from config_canal where actif limit 1");
        if (!k) return;
        await c.query(
          "insert into avis_paiement (organisation_id, prestataire, reference_prestataire, signature_valide, issue, montant) values ($1, $2, $3, $4, $5, $6)",
          [org, nom, avis?.referencePrestataire.slice(0, 100) ?? null, avis !== null, issue, avis?.montant ?? null],
        );
      }).catch((e) => req.log.error(e, "trace d'un avis de paiement"));
      if (!avis) {
        await tracer("signature_invalide");
        throw new ErreurApi(401, "avis_refuse");
      }
      let r: { issue: Issue; statut?: string };
      try {
        r = await dansOrganisation(pool, org, (c) => traiterAvis(c, org, nom, avis, req.log));
      } catch (e) {
        // Le règlement porte la référence de l'opérateur : une seconde barrière contre le double encaissement.
        if ((e as { code?: string }).code !== "RP001") throw e;
        r = { issue: "deja_traite" };
      }
      await tracer(r.issue);
      if (r.issue === "inconnu") throw new ErreurApi(404, "introuvable");
      if (r.issue === "montant_different") throw new ErreurApi(409, "avis_refuse");
      return { recu: true, issue: r.issue, ...(r.statut ? { statut: r.statut } : {}) };
    });
  });

  // ---------- Routes internes ----------

  /** Une vente restée « payee » se termine une fois la cause corrigée, toujours au nom du responsable de la boutique. */
  app.post<{ Params: { id: string } }>("/commandes-web/:id/terminer", { schema: { params: paramId } }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [w] } = await ctx.client.query(
        "select w.*, k.responsable_id from commandes_web w join config_canal k on k.entite_id = w.entite_id where w.id = $1 for update of w", [req.params.id],
      );
      if (!w) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "facturation.gerer", w.entite_id);
      const { rows: [p] } = await ctx.client.query(
        "select reference_prestataire, moyen from paiements_en_ligne where commande_id = $1 and statut = 'reussi' order by traite_le limit 1", [w.id],
      );
      if (w.statut !== "payee" || !p || !w.responsable_id) throw new ErreurApi(409, "vente_deja_terminee");
      const facture = await terminerVente({ client: ctx.client, utilisateurId: w.responsable_id, organisationId: ctx.organisationId }, w, p.reference_prestataire, p.moyen);
      return { statut: "facturee", facture: facture.numero };
    }),
  );

  app.get<{ Querystring: { jour?: string; moyen?: string; statut?: string } }>("/paiements-en-ligne", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          jour: { type: "string", format: "date" }, moyen: { type: "string", enum: MOYENS },
          statut: { type: "string", enum: ["lance", "reussi", "echoue", "a_rembourser", "rembourse"] },
        },
      },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const branches = [...new Set([
        ...await entitesAccessibles(ctx.client, ctx.utilisateurId, "tresorerie.voir"),
        ...await entitesAccessibles(ctx.client, ctx.utilisateurId, "facturation.voir"),
      ].map((e) => e.id))];
      if (!branches.length) throw new ErreurApi(403, "permission_refusee");
      const { rows } = await ctx.client.query(
        `select p.id, p.reference_prestataire, p.prestataire, p.moyen, p.montant, p.statut, p.motif, p.lance_le, p.traite_le, p.rembourse_le,
           p.reference_remboursement, w.reference as commande, i.reference as inscription, k.numero as campagne,
           f.numero as facture, coalesce(pr.nom, pa.nom) as portefeuille, (ea.id is not null) as en_attente
         from paiements_en_ligne p
         left join commandes_web w on w.id = p.commande_id
         left join inscriptions_precommande i on i.id = p.inscription_id
         left join campagnes_arrivage k on k.id = i.campagne_id
         left join documents_vente f on f.id = w.facture_id and p.statut = 'reussi'
         left join reglements r on r.facture_id = w.facture_id and r.reference = p.reference_prestataire and p.statut = 'reussi' and r.annule_le is null
         left join mouvements_portefeuille mr on mr.source_id = r.id and mr.type = 'encaissement'
         left join portefeuilles pr on pr.id = mr.portefeuille_id
         left join mouvements_portefeuille mp on mp.source_id = p.id and mp.type = 'encaissement'
         left join portefeuilles pa on pa.id = mp.portefeuille_id
         left join encaissements_en_attente ea on ea.source_id in (r.id, p.id) and ea.affecte_le is null and ea.annule_le is null
         where coalesce(w.entite_id, k.entite_id) = any($1::uuid[]) and (coalesce(p.traite_le, p.lance_le) at time zone 'Africa/Douala')::date = $2::date
           and ($3::text is null or p.moyen = $3) and ($4::text is null or p.statut = $4)
         order by coalesce(p.traite_le, p.lance_le)`,
        [branches, req.query.jour ?? jourDouala(), req.query.moyen ?? null, req.query.statut ?? null],
      );
      const verses = rows.filter((x) => ["reussi", "a_rembourser", "rembourse"].includes(x.statut));
      return { paiements: rows, total: verses.reduce((s, x) => s + Number(x.montant), 0), nombre: verses.length };
    }),
  );

  /**
   * Le trésorier a rendu l'argent par l'opérateur : la sortie part du portefeuille qui a reçu l'encaissement, une seule fois.
   * Vaut pour un acompte de précommande comme pour un paiement en trop d'une commande.
   */
  app.post<{ Params: { id: string }; Body: { referenceOperateur?: string; note?: string } }>("/paiements-en-ligne/:id/remboursement", {
    schema: {
      params: paramId,
      body: { type: "object", additionalProperties: false, properties: { referenceOperateur: { type: "string", maxLength: 100 }, note: { type: "string", maxLength: 500 } } },
    },
  }, async (req) =>
    protege(req, async (ctx) => {
      const c = ctx.client;
      const { rows: [p] } = await c.query(
        `select p.*, coalesce(w.entite_id, k.entite_id) as branche, coalesce(w.reference, i.reference) as cible from paiements_en_ligne p
         left join commandes_web w on w.id = p.commande_id
         left join inscriptions_precommande i on i.id = p.inscription_id left join campagnes_arrivage k on k.id = i.campagne_id
         where p.id = $1 for update of p`,
        [req.params.id],
      ).catch(introuvable);
      if (!p) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "tresorerie.gerer", p.branche);
      if (p.statut !== "a_rembourser") throw new ErreurApi(409, "remboursement_impossible");
      const { rows: [m] } = await c.query(
        `select m.portefeuille_id from mouvements_portefeuille m where m.source_id = $1 and m.type = 'encaissement' and m.source_type = 'paiement_en_ligne'
           and not exists (select 1 from mouvements_portefeuille x where x.annule_mouvement_id = m.id) limit 1`,
        [p.id],
      );
      if (!m) throw new ErreurApi(409, "encaissement_a_placer");
      const { rows: [x] } = await c.query("select id, nom, actif from portefeuilles where id = $1 for update", [m.portefeuille_id]);
      if (!x.actif) throw new ErreurApi(409, "portefeuille_inactif");
      const { rows: [s] } = await c.query("select coalesce(sum(montant), 0)::int8 as solde from mouvements_portefeuille where portefeuille_id = $1", [x.id]);
      if (Number(s.solde) < Number(p.montant)) throw new ErreurApi(409, "solde_portefeuille_insuffisant");
      const reference = req.body.referenceOperateur?.trim() || null;
      await c.query(
        `insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, reference, source_type, source_id, auteur_id)
         values ($1, $2, 'sortie', $3, $4, $5, 'remboursement_en_ligne', $6, $7)`,
        [ctx.organisationId, x.id, -Number(p.montant), `Remboursement du paiement ${p.reference_prestataire} (${p.cible})`, reference ?? p.reference_prestataire, p.id, ctx.utilisateurId],
      );
      await c.query(
        "update paiements_en_ligne set statut = 'rembourse', rembourse_le = now(), rembourse_par = $2, reference_remboursement = $3 where id = $1",
        [p.id, ctx.utilisateurId, reference],
      );
      if (p.inscription_id) await apresRemboursement(c, p.inscription_id, p.motif);
      await c.query("select journal_evenement('canal.paiement_rembourse', $1)", [JSON.stringify({ paiement: p.id, montant: Number(p.montant), note: req.body.note ?? null })]);
      return { statut: "rembourse", portefeuille: x.nom, solde: Number(s.solde) - Number(p.montant) };
    }),
  );
}
