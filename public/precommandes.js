"use strict";
/* Précommandes d'arrivage de GLOMARI (lot 3A). Le serveur calcule et contrôle tout : l'écran affiche et transmet. */

const STATUTS_CAMPAGNE = { ouverte: "Ouverte", declenchee: "Seuil atteint", annulee: "Annulée", livree: "Livrée" };
const STATUTS_INSCRIPTION = {
  en_attente: "En attente de l'acompte", expiree: "Expirée", validee: "Acompte payé", servie: "Arrivé, solde à payer", soldee: "Soldée",
  acompte_conserve: "Acompte conservé", a_rembourser: "À rembourser", remboursee: "Remboursée", annulee: "Annulée",
};
const MOTIFS_PRECOMMANDE = { campagne_annulee: "campagne annulée", seuil_non_atteint: "seuil non atteint", retrait_client: "retrait du client", non_servie: "arrivage insuffisant", complet: "campagne complète ou close" };
const ETAPES_ARRIVAGE = {
  commandee: "Commandée", achetee: "Achetée", en_production: "En production", expediee: "Expédiée", en_transport: "En transport",
  arrivee_port: "Arrivée au port", dedouanee: "Dédouanée", enlevee: "Enlevée", livree: "Livrée", en_stock: "En stock",
};
const pastilleCampagne = (k) => k.statut === "annulee" ? "pastille retard" : k.statut === "ouverte" ? "pastille attente" : "pastille ok";

async function ecranPrecommandes(message) {
  const gere = droits.includes("achats.gerer");
  const [campagnes, entites, produits, tiers] = await Promise.all([
    api("GET", "/precommandes/campagnes"),
    gere ? api("GET", "/entites") : [],
    gere ? api("GET", "/produits") : [],
    gere && droits.includes("tiers.voir") ? api("GET", "/tiers") : [],
  ]);
  // Le lieu de réception est un lieu servi en ligne : l'inscrit y retire ou s'y fait livrer.
  const branches = entites.filter((e) => e.type === "branche" && e.domaine === "commerce");
  const reglages = await Promise.all(branches.map((b) => api("GET", `/canal-config?entiteId=${b.id}`).catch(() => ({ lieux: [] }))));
  const lieux = branches.flatMap((b, i) => reglages[i].lieux.filter((l) => l.actif).map((l) => [`${b.id}|${l.entite_id}`, `${b.nom} › ${l.nom_public}`]));
  const cartes = h("div");
  const etat = h("select", {},
    [["", "Toutes les campagnes"], ...Object.entries(STATUTS_CAMPAGNE)].map(([code, nom]) =>
      h("option", { value: code, selected: code === filtresEcran("precommandes", "") }, nom)));
  const afficherCampagnes = () => {
    garderFiltresEcran("precommandes", etat.value);
    const selection = campagnes.filter((c) => !etat.value || c.statut === etat.value);
    cartes.replaceChildren(...(selection.length ? selection.map((k) => carteCampagne(k, gere))
      : [h("p", { class: "discret-texte", role: "status" }, "Aucune campagne pour ce statut.")]));
  };
  etat.addEventListener("change", afficherCampagnes);
  afficherCampagnes();
  vue(h("h1", {}, "Précommandes"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("p", { class: "discret-texte" }, "Une précommande avec acompte, pas un financement participatif : le bon de commande au fabricant se prépare au seuil, et chaque acompte est remboursé si la campagne est annulée ou manque son seuil."),
    h("div", { class: "actions" }, droits.includes("facturation.voir") ? h("button", { class: "discret", onclick: () => ecranCommandesEnLigne() }, "Commandes en ligne") : null),
    gere ? h("details", { class: "carte" }, h("summary", {}, "Nouvelle campagne"),
      lieux.length ? formulaire(async (v, f, zone) => {
        const [entiteId, lieuId] = v.l.split("|");
        try {
          await api("POST", "/precommandes/campagnes", {
            entiteId, lieuId, produitId: v.p, fournisseurId: v.f, origine: v.o, titre: v.t.trim(), texte: v.x.trim() || undefined,
            prixTtc: Number(v.prix), acompteType: v.at, acompteValeur: Number(v.av), seuil: Number(v.s), quantiteMax: v.q ? Number(v.q) : undefined,
            dateLimite: v.d, delaiSoldeJours: Number(v.dj), prixAchatPrevu: v.pa ? Number(v.pa) : undefined,
          });
        } catch (e) {
          if (e.code !== "prix_annonce_impossible") throw e;
          zone.replaceChildren(h("div", { class: "erreur", role: "alert" }, `${texteErreur(e)} Prix possibles : ${e.details.proches.map(fcfa).join(" ou ")}.`));
          return;
        }
        ecranPrecommandes("Campagne créée : elle est visible sur la Marketplace.");
      }, [
        h("div", { class: "grille" },
          choix("l", "Lieu de réception", lieux),
          choix("p", "Article", produits.filter((p) => p.suivi_stock && p.actif !== false).map((p) => [p.id, `${p.code} · ${p.nom}`])),
          choix("f", "Fournisseur prévu", tiers.filter((t) => t.type === "entreprise").map((t) => [t.id, t.nom])),
          choix("o", "Origine", [["import", "Importation"], ["local", "Achat local"]]),
          champ("Titre affiché", { name: "t", required: true, maxlength: 200 }),
          champ("Prix annoncé, toutes taxes comprises (FCFA)", { name: "prix", type: "number", min: 1, required: true }),
          choix("at", "Acompte", [["pourcentage", "En pourcentage du prix"], ["montant", "En FCFA par pièce"]]),
          champ("Valeur de l'acompte", { name: "av", type: "number", min: 1, required: true }),
          champ("Seuil (pièces)", { name: "s", type: "number", min: 1, required: true }),
          champ("Quantité maximale (facultative)", { name: "q", type: "number", min: 1 }),
          champ("Date limite", { name: "d", type: "date", required: true }),
          champ("Délai du solde (jours)", { name: "dj", type: "number", min: 1, max: 60, value: 7, required: true }),
          champ("Prix d'achat prévu par pièce (facultatif)", { name: "pa", type: "number", min: 0 })),
        h("label", {}, "Présentation", h("textarea", { name: "x", maxlength: 2000, rows: 3 })),
      ], "Créer la campagne")
      : h("p", { class: "discret-texte" }, "Ouvrez d'abord la boutique en ligne et déclarez ses lieux (Commandes en ligne › Réglages de la boutique).")) : null,
    h("div", { class: "carte" }, h("label", { class: "pas-imprimer" }, "Statut de la campagne", etat), cartes));
}

function carteCampagne(k, gere) {
  const detail = h("div");
  let charge = false;
  const ouvrir = async (e) => {
    if (!e.currentTarget.open || charge) return;
    charge = true;
    const d = await api("GET", `/precommandes/campagnes/${k.id}`);
    const bc = d.commande_achat;
    const preparer = gere && d.statut === "declenchee" && (!bc || bc.statut === "annulee");
    const annulable = gere && ["ouverte", "declenchee"].includes(d.statut) && !d.premiere_reception_le;
    detail.replaceChildren(
      h("p", {}, `${d.produit} · ${d.lieu} · fournisseur ${d.fournisseur}`),
      h("p", { class: "discret-texte" }, `Prix ${fcfa(d.prix_ttc)} · acompte ${fcfa(d.acompte_unitaire)} par pièce · seuil ${d.seuil}${d.quantite_max ? ` · maximum ${d.quantite_max}` : ""} · date limite ${dateFr(d.date_limite)} · solde dans les ${d.delai_solde_jours} jours après l'arrivée`),
      h("div", { class: "chiffres" },
        h("div", { class: "chiffre" }, h("b", {}, `${d.validee} / ${d.seuil}`), h("span", {}, "pièces précommandées")),
        h("div", { class: "chiffre" }, h("b", {}, fcfa(d.acomptes_encaisses)), h("span", {}, "acomptes encaissés")),
        h("div", { class: "chiffre" }, h("b", {}, fcfa(d.a_rembourser)), h("span", {}, "à rembourser")),
        h("div", { class: "chiffre" }, h("b", {}, fcfa(d.rembourses)), h("span", {}, "remboursés")),
        h("div", { class: "chiffre" }, h("b", {}, fcfa(d.conserves)), h("span", {}, "conservés"))),
      d.motif_annulation ? h("p", { class: "discret-texte" }, `Motif d'annulation : ${d.motif_annulation}`) : null,
      bc ? h("div", {}, h("p", {}, `Bon de commande ${bc.numero} (${bc.statut}), ${bc.quantite_commandee} pièce(s) commandée(s)`),
        bc.etapes.length ? h("ul", { class: "discret-texte" }, bc.etapes.map((x) => h("li", {}, `${ETAPES_ARRIVAGE[x.etape] || x.etape} le ${dateFr(x.date)}`))) : null)
        : d.statut !== "ouverte" ? h("p", { class: "discret-texte" }, "Pas encore de bon de commande.") : null,
      preparer ? h("div", { class: "actions" }, h("button", {
        onclick: async () => { const r = await api("POST", `/precommandes/campagnes/${k.id}/bon-de-commande`); ecranPrecommandes(`Bon de commande ${r.commande_achat.numero} préparé : il attend son approbation dans les achats.`); },
      }, "Préparer le bon de commande")) : null,
      h("h3", {}, "Inscriptions"),
      d.inscriptions.length ? h("div", {}, d.inscriptions.map((i) => carteInscription(i, gere && d.statut === "ouverte"))) : h("p", { class: "discret-texte" }, "Aucune inscription."),
      annulable ? h("details", {}, h("summary", {}, "Annuler la campagne"), formulaire(async (v) => {
        await api("POST", `/precommandes/campagnes/${k.id}/annulation`, { motif: v.m.trim() });
        ecranPrecommandes("Campagne annulée : chaque acompte payé est à rembourser, le trésorier a reçu la liste.");
      }, [champ("Motif", { name: "m", required: true, minlength: 3, maxlength: 500 })], "Confirmer l'annulation")) : null);
  };
  return h("details", { class: "apprenant", ontoggle: ouvrir },
    h("summary", {}, h("span", { class: "nom" }, `${k.numero} : ${k.titre}`), " ",
      h("span", { class: pastilleCampagne(k) }, STATUTS_CAMPAGNE[k.statut]),
      h("span", { class: "discret-texte" }, ` ${k.quantite_validee} / ${k.seuil} pièces · jusqu'au ${dateFr(k.date_limite)}`)),
    detail);
}

function carteInscription(i, retirable) {
  return h("div", { class: "ligne" },
    h("span", { class: "nom" }, `${i.rang ? `${i.rang}. ` : ""}${i.reference} : ${i.nom_client} · ${i.telephone} · ${i.quantite} pièce(s)`),
    h("span", { class: ["a_rembourser", "acompte_conserve", "expiree", "annulee"].includes(i.statut) ? "pastille retard" : i.statut === "soldee" ? "pastille ok" : "pastille attente" },
      `${STATUTS_INSCRIPTION[i.statut]}${i.motif ? ` (${MOTIFS_PRECOMMANDE[i.motif]})` : ""}`),
    h("span", { class: "discret-texte" }, [
      `acompte ${fcfa(i.acompte)}`, i.statut === "servie" && i.solde_avant ? `solde avant le ${dateHeureFr(i.solde_avant)}` : null,
      i.commande_solde ? `commande ${i.commande_solde} (${STATUTS_WEB[i.commande_solde_statut] || i.commande_solde_statut})` : null, i.facture ? `facture ${i.facture}` : null,
    ].filter(Boolean).join(" · ")),
    retirable && ["en_attente", "expiree", "validee"].includes(i.statut) ? h("details", {}, h("summary", {}, "Annuler l'inscription"), formulaire(async (v) => {
      const r = await api("POST", `/precommandes/inscriptions/${i.id}/annulation`, { motif: v.m.trim() });
      ecranPrecommandes(r.statut === "a_rembourser" ? "Inscription annulée : l'acompte est à rembourser, le trésorier a reçu une tâche." : "Inscription annulée.");
    }, [champ("Motif (demande du client)", { name: "m", required: true, minlength: 3, maxlength: 500 })], "Confirmer")) : null);
}
