"use strict";
const STATUTS_DOC = { brouillon: "Brouillon", emis: "Émis", accepte: "Accepté", refuse: "Refusé", annule: "Abandonné" };
const TYPES_DOC = { facture: "Facture", devis: "Devis", avoir: "Avoir" };
const MODES = [["aucun", "Aucun"], ["retrait", "Retrait sur place"], ["livraison", "Livraison"], ["expedition", "Expédition"]];
const SUIVI = [["preparation", "En préparation"], ["expediee", "Expédiée"], ["en_transit", "En transit"], ["livree", "Livrée"], ["retournee", "Retournée"]];
const STATUTS_ACHAT = { brouillon: "Brouillon", approuvee: "Approuvée", recue_partiellement: "Reçue en partie", recue: "Reçue", annulee: "Annulée" };
const STATUTS_TRANSFERT = { demande: "À expédier", expedie: "À réceptionner", recu: "Reçu", annule: "Annulé" };
const MOYENS = [["especes", "Espèces"], ["mtn_momo", "MTN Mobile Money"], ["orange_money", "Orange Money"], ["virement", "Virement"], ["cheque", "Chèque"], ["carte", "Carte"]];
const quantiteFr = (q) => Number(q).toLocaleString("fr-FR", { maximumFractionDigits: 3 });

async function ecranFacturation(message, type = "facture") {
  const b = await brancheEspace();
  const filtre = b ? `brancheId=${b}` : "";
  const [docs, creances] = await Promise.all([api("GET", `/documents-vente?type=${type}&${filtre}`), api("GET", `/creances?${filtre}`)]);
  const totalDu = creances.reduce((s, c) => s + c.total, 0);
  vue(
    h("h1", {}, "Facturation"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "actions" },
      Object.entries({ facture: "Factures", devis: "Devis", avoir: "Avoirs" }).map(([t, l]) =>
        h("button", { class: t === type ? "" : "discret", onclick: () => ecranFacturation(undefined, t) }, l)),
      droits.includes("facturation.gerer") ? h("button", { class: "discret", onclick: ecranNouveauDocument }, "Nouveau document") : null,
      droits.includes("catalogue.gerer") ? h("button", { class: "discret", onclick: () => ecranCatalogue() }, "Catalogue") : null,
      droits.includes("facturation.administrer") ? h("button", { class: "discret", onclick: () => ecranIdentites() }, "Identité légale") : null),
    h("div", { class: "carte" }, docs.length ? docs.map((d) => h("button", { class: "session", onclick: () => ecranDocument(d.id) },
      h("div", { class: "ligne" },
        h("span", { class: "nom" }, `${d.numero || "Brouillon"} : ${d.client}`),
        d.reste === 0 ? h("span", { class: "pastille ok" }, "Soldée")
          : d.reste > 0 ? h("span", { class: "pastille attente" }, `Reste ${fcfa(d.reste)}`)
            : h("span", { class: "pastille attente" }, STATUTS_DOC[d.statut])),
      h("div", { class: "discret-texte" }, `${dateFr(d.date_document)} · ${fcfa(d.total_ttc)}`)))
      : h("p", { class: "discret-texte" }, "Aucun document.")),
    h("div", { class: "carte" }, h("h2", {}, `Créances : ${fcfa(totalDu)}`),
      creances.length ? h("div", { class: "defilant" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Client", "Non échu", "1 à 30 j", "31 à 60 j", "+ de 60 j", "Total"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", {}, creances.map((c) => h("tr", {}, h("td", {}, c.client), [c.non_echu, c.de_1_a_30, c.de_31_a_60, c.plus_de_60, c.total].map((v) => h("td", { class: "nombre" }, Number(v).toLocaleString("fr-FR"))))))))
        : h("p", { class: "discret-texte" }, "Aucune créance.")),
  );
}

async function ecranNouveauDocument() {
  const [entites, produits, clients] = await Promise.all([entitesPour("facturation"), api("GET", "/produits"), api("GET", "/tiers")]);
  const actifs = produits.filter((p) => p.actif);
  const lignes = h("div");
  const ajouter = () => {
    const prix = h("input", { name: "prix", type: "number", min: 0, "aria-label": "Prix unitaire" });
    const designation = h("input", { name: "designation", "aria-label": "Désignation", required: true });
    const taxe = h("input", { name: "taxe", type: "number", min: 0, max: 100, step: 0.001, value: 0 });
    const produit = h("select", { name: "produit", "aria-label": "Produit", onchange: () => {
      const p = actifs.find((x) => x.id === produit.value);
      if (!p) return;
      designation.value = p.nom;
      prix.value = p.prix_vente;
      taxe.value = p.taux_taxe;
    } }, h("option", { value: "" }, "Saisie libre"), actifs.map((p) => h("option", { value: p.id }, p.nom)));
    const ligne = h("div", { class: "ligne-doc" },
      h("label", {}, "Produit", produit), h("label", {}, "Désignation", designation),
      h("label", {}, "Quantité", h("input", { name: "quantite", type: "number", min: 0.001, step: 0.001, value: 1, required: true })),
      h("label", {}, "Prix unitaire HT", prix),
      h("label", {}, "Remise %", h("input", { name: "remise", type: "number", min: 0, max: 100, step: 0.01, value: 0 })),
      h("label", {}, "Taxe % (facultatif)", taxe),
      h("button", { type: "button", class: "discret", onclick: () => { if (lignes.children.length > 1) ligne.remove(); } }, "Retirer"));
    lignes.append(ligne);
  };
  ajouter();
  vue(
    h("button", { class: "discret", onclick: () => ecranFacturation() }, "← Retour"),
    h("h1", {}, "Nouveau document"),
    h("div", { class: "carte" }, formulaire(async (v, f, zone) => {
      const saisie = [...lignes.children].map((l) => {
        const val = (n) => l.querySelector(`[name=${n}]`).value;
        return {
          produitId: val("produit") || undefined, designation: val("designation").trim(), quantite: Number(val("quantite")),
          prixUnitaire: val("prix") === "" ? undefined : Number(val("prix")), remisePct: Number(val("remise")), tauxTaxe: Number(val("taxe") || 0),
        };
      });
      const creer = async (tiersId) => {
        const d = await api("POST", "/documents-vente", {
          type: v.type, entiteId: v.entiteId, tiersId, date: v.date, echeance: v.echeance || undefined,
          clientNiu: v.niu.trim() || undefined, lignes: saisie, modeRemise: v.mode,
          adresseLivraison: v.adresse.trim() || undefined, transporteur: v.transporteur.trim() || undefined,
          fraisLivraison: Number(v.frais || 0), tauxFrais: Number(v.tauxFrais || 0),
        });
        ecranDocument(d.id);
      };
      if (v.tiersId) await creer(v.tiersId);
      else {
        if (!v.nom.trim()) throw Object.assign(new Error(), { code: "donnees_invalides" });
        await ficheClient(zone, { type: "personne", nom: v.nom.trim(), telephone: v.telephone.trim() || undefined, entiteId: v.entiteId }, creer);
      }
    }, [
      h("div", { class: "grille" },
        choix("type", "Type", [["facture", "Facture"], ["devis", "Devis"]]),
        choix("entiteId", "Entité émettrice", entites),
        choix("tiersId", "Client existant", [["", "Nouveau client"], ...clients.map((c) => [c.id, c.branche ? `${c.nom} (${c.branche})` : c.nom])]),
        champ("Nom du nouveau client", { name: "nom" }),
        champ("Téléphone du nouveau client", { name: "telephone", type: "tel" }),
        champ("NIU du client (facultatif)", { name: "niu" }),
        champ("Date", { name: "date", type: "date", value: aujourdhui(), required: true }),
        champ("Échéance", { name: "echeance", type: "date" })),
      h("h2", {}, "Lignes"), lignes,
      h("p", {}, h("button", { type: "button", class: "discret", onclick: ajouter }, "Ajouter une ligne")),
      h("h2", {}, "Livraison ou expédition"),
      h("div", { class: "grille" },
        choix("mode", "Mode", MODES),
        champ("Frais (FCFA)", { name: "frais", type: "number", min: 0, value: 0 }),
        champ("Taxe sur les frais % (facultatif)", { name: "tauxFrais", type: "number", min: 0, max: 100, step: 0.001, value: 0 }),
        champ("Transporteur", { name: "transporteur" }),
        champ("Adresse", { name: "adresse" })),
    ], "Enregistrer le brouillon")));
}

async function ecranDocument(id, message) {
  const d = await api("GET", `/documents-vente/${id}`);
  const gere = droits.includes("facturation.gerer");
  const brouillon = d.statut === "brouillon";
  const aStock = d.type === "facture" && brouillon && d.lignes.some((l) => l.produit_id);
  const entrepots = aStock ? await entitesPour("achats_stocks") : [];
  const action = (texte, url, corps, ok, classe = "discret") => h("button", { class: classe, onclick: async () => {
    await api("POST", url, corps);
    ecranDocument(id, ok);
  } }, texte);
  vue(
    h("div", { class: "actions pas-imprimer" },
      h("button", { class: "discret", onclick: () => ecranFacturation(undefined, d.type) }, "← Retour"),
      !brouillon ? h("button", { class: "discret", onclick: () => window.print() }, "Imprimer") : null,
      !brouillon && d.type === "facture" && droits.includes("stocks.gerer") ? h("button", { class: "discret", onclick: () => ecranPreparation(d.id) }, "Préparer la commande") : null),
    message ? h("div", { class: "succes pas-imprimer", role: "status" }, message) : null,
    h("div", { class: "document" },
      h("div", { class: "ligne" },
        h("h2", {}, `${TYPES_DOC[d.type]} ${d.numero || "(brouillon)"}`),
        h("span", { class: "pastille attente pas-imprimer" }, STATUTS_DOC[d.statut])),
      !brouillon ? h("p", {}, h("b", {}, d.vendeur_nom), d.vendeur_niu ? ` · NIU ${d.vendeur_niu}` : "", d.vendeur_rccm ? ` · RCCM ${d.vendeur_rccm}` : "", d.vendeur_adresse ? ` · ${d.vendeur_adresse}` : "") : null,
      h("p", {}, `Client : ${d.client_nom || d.client.nom}${d.client_niu ? `, NIU ${d.client_niu}` : ""}`),
      h("p", {}, `Date : ${dateFr(d.date_document)}${d.date_echeance ? ` · Échéance : ${dateFr(d.date_echeance)}` : ""}`),
      d.motif ? h("p", {}, `Motif : ${d.motif}`) : null,
      d.mode_remise !== "aucun" ? h("p", {}, `${libelle(MODES, d.mode_remise)}${d.transporteur ? `, ${d.transporteur}` : ""}${d.adresse_livraison ? `, ${d.adresse_livraison}` : ""}`) : null,
      h("div", { class: "defilant" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Désignation", "Qté", "Prix", "Remise", "Taxe", "Total HT"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", {}, d.lignes.map((l) => h("tr", {},
          h("td", {}, l.designation), h("td", { class: "nombre" }, quantiteFr(l.quantite)),
          h("td", { class: "nombre" }, Number(l.prix_unitaire).toLocaleString("fr-FR")),
          h("td", { class: "nombre" }, l.remise_pct ? `${l.remise_pct} %` : "–"),
          h("td", { class: "nombre" }, `${String(l.taux).replace(".", ",")} %`),
          h("td", { class: "nombre" }, Number(l.montant_ht).toLocaleString("fr-FR"))))))),
      h("p", { class: "totaux" },
        d.frais_livraison > 0 ? [`Frais de livraison HT : ${fcfa(d.frais_livraison)}`, h("br")] : null,
        `Total HT : ${fcfa(d.total_ht)}`, h("br"),
        d.total_taxes > 0 ? [`Taxes : ${fcfa(d.total_taxes)}`, h("br")] : null,
        h("b", {}, `Total à payer : ${fcfa(d.total_ttc)}`)),
      d.soldes ? h("p", { class: "totaux" }, `Réglé : ${fcfa(d.soldes.regle)}`, d.soldes.avoirs ? ` · Avoirs : ${fcfa(d.soldes.avoirs)}` : "", " · ", h("b", {}, `Reste : ${fcfa(d.soldes.reste)}`)) : null),
    gere && brouillon ? h("div", { class: "carte" }, h("h2", {}, "Émettre le document"),
      h("p", { class: "discret-texte" }, "Après l'émission, le numéro est attribué et le document ne peut plus être modifié."),
      formulaire(async (v) => {
        await api("POST", `/documents-vente/${id}/emission`, v.entrepotId ? { entrepotId: v.entrepotId } : null);
        ecranDocument(id, "Document émis.");
      }, [aStock && entrepots.length && !entrepots.some(([e]) => e === d.entite_id)
        ? choix("entrepotId", "Entrepôt d'où sort la marchandise", entrepots)
        : aStock ? h("p", { class: "discret-texte" }, "Le stock de ce magasin sera mis à jour automatiquement à l'émission.") : null], "Émettre"),
      h("p", {}, action("Abandonner ce brouillon", `/documents-vente/${id}/abandon`, null, "Brouillon abandonné.", "danger"))) : null,
    gere && d.type === "devis" && d.statut === "emis" ? h("div", { class: "actions pas-imprimer" },
      h("button", { onclick: async () => { await api("POST", `/devis/${id}/decision`, { decision: "accepte" }); ecranDocument(id, "Devis accepté."); } }, "Marquer comme accepté"),
      h("button", { class: "discret", onclick: async () => { await api("POST", `/devis/${id}/decision`, { decision: "refuse" }); ecranDocument(id, "Devis refusé."); } }, "Marquer comme refusé")) : null,
    gere && d.type === "devis" && d.statut === "accepte" && !d.lies.some((l) => l.type === "facture") ? h("div", { class: "actions pas-imprimer" },
      h("button", { onclick: async () => { const f = await api("POST", `/devis/${id}/facture`, { date: aujourdhui() }); ecranDocument(f.id, "Facture créée depuis le devis."); } }, "Créer la facture")) : null,
    d.soldes && d.soldes.reste > 0 && droits.includes("facturation.encaisser") ? h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Enregistrer un règlement"), formulaire(async (v) => {
      const r = await api("POST", `/factures/${id}/reglements`, { montant: Number(v.montant), moyen: v.moyen, reference: v.reference.trim() || undefined });
      ecranDocument(id, `Règlement ${r.numero_recu} enregistré. Reste : ${fcfa(r.reste_apres)}.`);
    }, [h("div", { class: "grille" },
      champ("Montant (FCFA)", { name: "montant", type: "number", min: 1, max: d.soldes.reste, value: d.soldes.reste, required: true }),
      choix("moyen", "Moyen", MOYENS),
      champ("Référence (sauf espèces)", { name: "reference" }))], "Enregistrer le règlement")) : null,
    d.type === "facture" && d.statut === "emis" ? blocExpedition(d) : null,
    d.reglements.length ? h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Règlements"), d.reglements.map((r) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${r.numero_recu} : ${fcfa(r.montant)}`), r.annule_le ? h("span", { class: "pastille retard" }, "Annulé") : null),
      h("div", { class: "discret-texte" }, `${libelle(MOYENS, r.moyen)}${r.reference ? `, ${r.reference}` : ""} · ${heure(r.encaisse_le)} · ${r.encaisse_par_nom}${r.motif_annulation ? ` · Motif : ${r.motif_annulation}` : ""}`),
      !r.annule_le && droits.includes("facturation.administrer") ? h("details", {}, h("summary", {}, "Annuler ce règlement"), formulaire(async (v) => {
        await api("POST", `/reglements/${r.id}/annulation`, { motif: v.motif.trim() });
        ecranDocument(id, "Règlement annulé.");
      }, [champ("Motif (obligatoire)", { name: "motif", required: true, minlength: 5 })], "Confirmer")) : null))) : null,
    d.lies.length ? h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Documents liés"), d.lies.map((l) => h("button", { class: "session", onclick: () => ecranDocument(l.id) }, `${TYPES_DOC[l.type]} ${l.numero || "(brouillon)"} : ${fcfa(l.total_ttc)}`))) : null,
    gere && d.soldes && d.soldes.reste > 0 ? h("details", { class: "carte pas-imprimer" }, h("summary", {}, "Corriger par un avoir"),
      h("p", { class: "discret-texte" }, "Une facture émise ne se modifie pas. Indiquez le montant à déduire, dans la limite du reste à payer."),
      formulaire(async (v) => {
        const a = await api("POST", `/factures/${id}/avoir`, {
          date: aujourdhui(), motif: v.motif.trim(),
          lignes: [{ designation: v.designation.trim(), quantite: 1, prixUnitaire: Number(v.ht), tauxTaxe: Number(v.taux || 0) }],
        });
        ecranDocument(a.id, "Avoir émis.");
      }, [h("div", { class: "grille" },
        champ("Objet", { name: "designation", value: "Remise commerciale", required: true }),
        champ("Montant hors taxe (FCFA)", { name: "ht", type: "number", min: 1, required: true }),
        champ("Taxe % (facultatif)", { name: "taux", type: "number", min: 0, max: 100, step: 0.001, value: 0 }),
        champ("Motif (obligatoire)", { name: "motif", required: true, minlength: 5 }))], "Émettre l'avoir")) : null,
  );
}

function blocExpedition(d) {
  const gere = droits.includes("facturation.gerer");
  const e = d.expedition;
  if (!e) {
    return gere ? h("details", { class: "carte pas-imprimer" }, h("summary", {}, "Suivre la livraison ou l'expédition"), formulaire(async (v) => {
      await api("POST", `/factures/${d.id}/expedition`, { mode: v.mode, transporteur: v.transporteur.trim() || undefined, numeroSuivi: v.suivi.trim() || undefined, adresse: v.adresse.trim() || undefined });
      ecranDocument(d.id, "Suivi créé.");
    }, [h("div", { class: "grille" },
      choix("mode", "Mode", MODES.slice(1), d.mode_remise === "aucun" ? "livraison" : d.mode_remise),
      champ("Transporteur", { name: "transporteur", value: d.transporteur || "" }),
      champ("Numéro de suivi", { name: "suivi" }),
      champ("Adresse", { name: "adresse", value: d.adresse_livraison || "" }))], "Créer le suivi")) : null;
  }
  return h("div", { class: "carte pas-imprimer" }, h("h2", {}, `${libelle(MODES, e.mode)} : ${libelle(SUIVI, e.statut)}`),
    h("p", { class: "discret-texte" }, [e.transporteur, e.numero_suivi && `Suivi ${e.numero_suivi}`, e.adresse, e.expediee_le && `Partie le ${heure(e.expediee_le)}`, e.livree_le && `Livrée le ${heure(e.livree_le)}`, e.preuve && `Preuve : ${e.preuve}`].filter(Boolean).join(" · ")),
    gere ? formulaire(async (v) => {
      await api("PATCH", `/expeditions/${e.id}`, { statut: v.statut, ...(v.suivi.trim() ? { numeroSuivi: v.suivi.trim() } : {}), ...(v.preuve.trim() ? { preuve: v.preuve.trim() } : {}) });
      ecranDocument(d.id, "Suivi mis à jour.");
    }, [h("div", { class: "grille" }, choix("statut", "Statut", SUIVI, e.statut),
      champ("Numéro de suivi", { name: "suivi", value: e.numero_suivi || "" }),
      champ("Preuve de livraison", { name: "preuve" }))], "Mettre à jour le suivi") : null);
}

async function ecranIdentites(message) {
  const entites = await api("GET", "/entites");
  vue(
    h("button", { class: "discret", onclick: () => ecranFacturation() }, "← Retour"),
    h("h1", {}, "Identité légale"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, h("h2", {}, "Identité d'une entité"),
      h("p", { class: "discret-texte" }, "Ces informations figurent sur les factures. Elles doivent provenir de vos documents officiels."),
      formulaire(async (v) => {
        const c = Object.fromEntries(Object.entries({ raisonSociale: v.raisonSociale, niu: v.niu, rccm: v.rccm, adresse: v.adresse }).filter(([, x]) => x.trim()).map(([k, x]) => [k, x.trim()]));
        await api("PATCH", `/entites/${v.entiteId}/identite`, c);
        ecranIdentites("Identité enregistrée.");
      }, [h("div", { class: "grille" },
        choix("entiteId", "Entité", entites.map((e) => [e.id, e.nom])),
        champ("Raison sociale", { name: "raisonSociale" }), champ("NIU", { name: "niu" }),
        champ("RCCM", { name: "rccm" }), champ("Adresse", { name: "adresse" }))], "Enregistrer l'identité")),
  );
}

async function ecranCatalogue(message) {
  const [produits, entites, refs] = await Promise.all([api("GET", "/produits"), api("GET", "/entites"), api("GET", "/entrepots/references").catch(() => ({ unites: [] }))]);
  vue(
    h("button", { class: "discret", onclick: () => ecranFacturation() }, "← Facturation"),
    h("h1", {}, "Catalogue"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    dansEspace("commerce") && droits.includes("stocks.voir") ? h("p", { class: "discret-texte" }, "Les articles de stock, leurs catégories, unités et colis se créent dans le module Stocks et apparaissent ici d'eux-mêmes. ",
      h("button", { class: "lien", onclick: () => ecranStockArticles() }, "Ouvrir les articles du stock")) : null,
    h("div", { class: "carte" }, produits.length ? produits.map((p) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${p.code} : ${p.nom}`), p.actif ? h("span", {}, fcfa(p.prix_vente)) : h("span", { class: "pastille attente" }, "Inactif")),
      p.parent_id ? null : h("details", {}, h("summary", {}, "Ajouter une variante"), formulaire(async (v) => { const attributs = {}; if (v.t) attributs.Taille = v.t.trim(); if (v.k) attributs.Couleur = v.k.trim(); await api("POST", `/produits/${p.id}/variantes`, { code: v.c.trim(), attributs, prixVente: v.x ? Number(v.x) : undefined, codeBarres: v.b.trim() || undefined }); ecranCatalogue("Variante ajoutée."); }, [h("div", { class: "grille" }, champ("Code", { name: "c", required: true }), champ("Taille", { name: "t" }), champ("Couleur", { name: "k" }), champ("Prix, si différent", { name: "x", type: "number", min: 0 }), champ("Code-barres", { name: "b" }))], "Ajouter")),
      h("div", { class: "discret-texte" }, `${p.type} · ${p.unite}${p.categorie ? ` · ${p.categorie}` : ""}${p.taux_taxe ? ` · Taxe ${p.taux_taxe} %` : ""}${p.suivi_stock ? ` · Alerte à ${quantiteFr(p.seuil_alerte)}, cible ${quantiteFr(p.stock_cible)}` : ""}${p.cout_moyen !== undefined && p.suivi_stock ? ` · Coût moyen ${fcfa(p.cout_moyen)}` : ""}`),
      h("details", {}, h("summary", {}, "Modifier"), formulaire(async (v) => {
        await api("PATCH", `/produits/${p.id}`, {
          nom: v.nom.trim(), prixVente: Number(v.prix), actif: v.actif === "oui", tauxTaxe: Number(v.taxe || 0),
          seuilAlerte: Number(v.seuil || 0), stockCible: Number(v.cible || 0), codeBarres: v.codeBarres.trim() || undefined,
        });
        ecranCatalogue("Produit modifié.");
      }, [h("div", { class: "grille" },
        champ("Nom", { name: "nom", value: p.nom, required: true }),
        champ("Prix de vente HT", { name: "prix", type: "number", min: 0, value: p.prix_vente, required: true }),
        champ("Taxe % (facultatif)", { name: "taxe", type: "number", min: 0, max: 100, step: 0.001, value: p.taux_taxe }),
        champ("Seuil d'alerte", { name: "seuil", type: "number", min: 0, value: p.seuil_alerte }),
        champ("Stock cible", { name: "cible", type: "number", min: 0, value: p.stock_cible }),
        champ("Code-barres", { name: "codeBarres", value: p.code_barres || "" }),
        choix("actif", "État", [["oui", "Actif"], ["non", "Inactif"]], p.actif ? "oui" : "non"))], "Enregistrer"))))
      : h("p", { class: "discret-texte" }, "Aucun produit.")),
    h("div", { class: "carte" }, h("h2", {}, "Nouveau produit ou service"), formulaire(async (v) => {
      await api("POST", "/produits", {
        entiteId: v.entiteId, code: v.code.trim(), nom: v.nom.trim(), type: v.type, unite: v.unite.trim() || undefined, prixVente: Number(v.prix || 0),
        tauxTaxe: Number(v.taxe || 0), suiviStock: v.stock === "oui", seuilAlerte: Number(v.seuil || 0), stockCible: Number(v.cible || 0), codeBarres: v.codeBarres.trim() || undefined,
      });
      ecranCatalogue("Produit créé.");
    }, [h("div", { class: "grille" },
      choix("entiteId", "Entité propriétaire", entites.map((e) => [e.id, e.nom])),
      champ("Code ou référence", { name: "code", required: true }), champ("Nom", { name: "nom", required: true }),
      choix("type", "Type", [["produit", "Produit"], ["service", "Service"], ["formation", "Formation"], ["abonnement", "Abonnement"]]),
      saisieListe("Unité", "unite", refs.unites, "pièce"),
      champ("Prix de vente HT (FCFA)", { name: "prix", type: "number", min: 0 }),
      champ("Taxe % (facultatif)", { name: "taxe", type: "number", min: 0, max: 100, step: 0.001, value: 0 }),
      choix("stock", "Suivre le stock", [["non", "Non"], ["oui", "Oui"]]),
      champ("Seuil d'alerte", { name: "seuil", type: "number", min: 0 }),
      champ("Stock cible", { name: "cible", type: "number", min: 0 }),
      champ("Code-barres (facultatif)", { name: "codeBarres" }))], "Créer le produit")),
  );
}

async function ecranStockMouvements(message) {
  const gere = droits.includes("stocks.gerer");
  const valide = droits.includes("stocks.valider");
  const [produits, entites, transferts, reajustements] = await Promise.all([
    api("GET", "/produits"), gere ? entitesPour("achats_stocks") : [],
    api("GET", "/transferts"), api("GET", "/stocks/reajustements"),
  ]);
  const suivis = produits.filter((p) => p.suivi_stock && p.actif).map((p) => [p.id, p.nom]);
  const toutes = entites;
  const enAttente = reajustements.filter((r) => r.statut === "en_attente");
  vue(
    h("h1", {}, "Stocks"), ongletsStock("mouvements"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, h("h2", {}, "Transferts entre entrepôts"), transferts.length ? transferts.map((t) => ligneTransfert(t))
      : h("p", { class: "discret-texte" }, "Aucun transfert.")),
    h("div", { class: "carte" }, h("h2", {}, `Réajustements${enAttente.length ? ` à confirmer : ${enAttente.length}` : ""}`),
      reajustements.length ? reajustements.map((r) => h("div", { class: "apprenant" },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, `${r.produit}, ${r.entite}`), r.statut === "en_attente" ? h("span", { class: "pastille attente" }, "À confirmer") : h("span", { class: r.statut === "confirme" ? "pastille ok" : "pastille retard" }, r.statut === "confirme" ? "Confirmé" : "Rejeté")),
        h("div", { class: "discret-texte" }, `Stock ${quantiteFr(r.stock_constate)}, compté ${quantiteFr(r.quantite_comptee)}, écart ${r.ecart > 0 ? "+" : ""}${quantiteFr(r.ecart)} · ${r.motif} · ${r.propose_par}${r.motif_rejet ? ` · Rejet : ${r.motif_rejet}` : ""}`),
        r.statut === "en_attente" && valide ? h("div", { class: "actions" },
          h("button", { onclick: async () => { await api("POST", `/stocks/reajustements/${r.id}/decision`, { decision: "confirme" }); ecranStockMouvements("Réajustement confirmé."); } }, "Confirmer"),
          h("details", {}, h("summary", {}, "Rejeter"), formulaire(async (v) => {
            await api("POST", `/stocks/reajustements/${r.id}/decision`, { decision: "rejete", motif: v.motif.trim() });
            ecranStockMouvements("Réajustement rejeté.");
          }, [champ("Motif", { name: "motif", required: true, minlength: 3 })], "Confirmer le rejet"))) : null))
        : h("p", { class: "discret-texte" }, "Aucun réajustement.")),
    gere && suivis.length && entites.length ? [
      h("details", { class: "carte" }, h("summary", {}, "Entrée ou sortie directe"), formulaire(async (v) => {
        await api("POST", "/stocks/mouvements", {
          entiteId: v.entiteId, produitId: v.produitId, type: v.type, quantite: Number(v.quantite),
          coutUnitaire: v.cout === "" ? undefined : Number(v.cout), motif: v.motif.trim() || undefined,
        });
        ecranStockMouvements("Mouvement enregistré.");
      }, [h("div", { class: "grille" }, choix("produitId", "Produit", suivis), choix("entiteId", "Entrepôt", entites),
        choix("type", "Type", [["entree", "Entrée"], ["sortie", "Sortie"]]),
        champ("Quantité", { name: "quantite", type: "number", min: 0.001, step: 0.001, required: true }),
        champ("Coût unitaire (entrée)", { name: "cout", type: "number", min: 0 }),
        champ("Motif (obligatoire en sortie)", { name: "motif" }))], "Enregistrer le mouvement")),
      h("details", { class: "carte" }, h("summary", {}, "Proposer un réajustement"),
        h("p", { class: "discret-texte" }, "Le stock ne change qu'après confirmation par un responsable."),
        formulaire(async (v) => {
          const r = await api("POST", "/stocks/reajustements", { entiteId: v.entiteId, produitId: v.produitId, compte: Number(v.compte), motif: v.motif.trim() });
          ecranStockMouvements(`Réajustement proposé. Écart : ${quantiteFr(r.ecart)}.`);
        }, [h("div", { class: "grille" }, choix("produitId", "Produit", suivis), choix("entiteId", "Entrepôt", entites),
          champ("Quantité comptée", { name: "compte", type: "number", min: 0, step: 0.001, required: true }),
          champ("Motif", { name: "motif", required: true, minlength: 3 }))], "Proposer le réajustement")),
      toutes.length > 1 ? h("details", { class: "carte" }, h("summary", {}, "Demander un transfert"), formulaire(async (v) => {
        await api("POST", "/transferts", { depuisId: v.depuisId, versId: v.versId, lignes: [{ produitId: v.produitId, quantite: Number(v.quantite) }] });
        ecranStockMouvements("Transfert demandé. L'entrepôt d'origine doit confirmer l'expédition.");
      }, [h("div", { class: "grille" }, choix("produitId", "Produit", suivis), choix("depuisId", "Depuis", toutes), choix("versId", "Vers", toutes),
        champ("Quantité", { name: "quantite", type: "number", min: 0.001, step: 0.001, required: true }))], "Demander le transfert")) : null,
    ] : gere ? h("p", { class: "discret-texte" }, "Créez d'abord un article dans l'onglet « Articles et catégories ».") : null,
  );
}

function ligneTransfert(t) {
  const gere = droits.includes("stocks.gerer");
  return h("div", { class: "apprenant" },
    h("div", { class: "ligne" }, h("span", { class: "nom" }, `${t.numero} : ${t.depuis} vers ${t.vers}`),
      h("span", { class: t.statut === "recu" ? "pastille ok" : t.statut === "annule" ? "pastille retard" : "pastille attente" }, STATUTS_TRANSFERT[t.statut])),
    h("div", { class: "discret-texte" }, t.lignes.map((l) => `${l.nom} : ${quantiteFr(l.quantite)}${l.quantite_recue === null ? "" : `, reçu ${quantiteFr(l.quantite_recue)}`}`).join(" · "),
      t.motif_ecart ? ` · Écart : ${t.motif_ecart}` : "", t.motif_annulation ? ` · Annulation : ${t.motif_annulation}` : ""),
    gere && t.statut === "demande" ? h("div", { class: "actions" }, h("button", { onclick: async () => {
      await api("POST", `/transferts/${t.id}/expedition`);
      ecranStockMouvements(`${t.numero} expédié. La destination doit confirmer la réception.`);
    } }, "Confirmer l'expédition")) : null,
    gere && t.statut === "expedie" ? h("details", {}, h("summary", {}, "Confirmer la réception"), formulaire(async (v, f) => {
      const lignes = t.lignes.map((l) => ({ produitId: l.produit_id, quantiteRecue: Number(f.querySelector(`[name="q${l.produit_id}"]`).value) }));
      await api("POST", `/transferts/${t.id}/reception`, { lignes, motifEcart: v.motif.trim() || undefined });
      ecranStockMouvements(`${t.numero} reçu.`);
    }, [t.lignes.map((l) => champ(`${l.nom}, quantité reçue`, { name: `q${l.produit_id}`, type: "number", min: 0, max: l.quantite, step: 0.001, value: l.quantite, required: true })),
      champ("Motif, en cas d'écart", { name: "motif" })], "Confirmer la réception")) : null,
    gere && ["demande", "expedie"].includes(t.statut) ? h("details", {}, h("summary", {}, "Annuler le transfert"), formulaire(async (v) => {
      await api("POST", `/transferts/${t.id}/annulation`, { motif: v.motif.trim() });
      ecranStockMouvements(`${t.numero} annulé.`);
    }, [champ("Motif (obligatoire)", { name: "motif", required: true, minlength: 3 })], "Confirmer l'annulation")) : null);
}

const LIBELLES_ETAPE_ACHAT = {
  commandee: "Commandée", achetee: "Achetée chez le fournisseur", en_production: "En préparation chez le fournisseur",
  expediee: "Partie du pays d'origine", en_transport: "En route vers l'entrepôt", arrivee_port: "Arrivée au port",
  dedouanee: "Dédouanée", enlevee: "Enlevée au port", livree: "Livrée à l'entrepôt", en_stock: "Reçue en stock",
};
const LIBELLES_FRAIS_ACHAT = {
  pre_acheminement: "Pré-acheminement (du fournisseur au port ou à l'aéroport de départ)",
  fret: "Transport principal, forfait tout compris (fret, assurance, dédouanement)",
  enlevement: "Enlèvement (au port ou à l'aéroport)", post_acheminement: "Post-acheminement (jusqu'à l'entrepôt)",
  transport_local: "Transport (achat local)", manutention: "Manutention", autre: "Autre",
};
const MODES_TRANSPORT = { maritime: "Maritime", aerien: "Aérien" };
const BASES_FORFAIT = { poids: "kg", volume: "m³" };
/** Les fiches qui portent un rôle viennent en premier dans la liste. */
const avecRole = (tiers, role) => [...tiers.filter((t) => t.roles.includes(role)), ...tiers.filter((t) => !t.roles.includes(role))];
const FRAIS_ACHAT_LOCAL = ["transport_local", "manutention", "autre"];
const ORIGINES_ACHAT = { local: "Achat local", import: "Importation" };
const AVIS_MARGE = {
  rentable: ["Rentable", "pastille ok"], faible: ["Marge faible", "pastille attente"],
  a_perte: ["À perte", "pastille retard"], a_renseigner: ["Prix de vente à saisir", "pastille"],
};
const tauxFr = (t) => t === null || t === undefined ? "" : `${String(t).replace(".", ",")} %`;
/** Noms de fichiers sans tiret ni tiret bas. */
const nomFichier = (t) => String(t).replace(/[-_/]/g, " ").replace(/\s+/g, " ").trim();
const avisGlobal = (r, seuil) => !r.chiffre_affaires ? null : r.marge < 0 ? "a_perte" : r.taux_marge < seuil ? "faible" : "rentable";
const boutonsExport = (exporter) => h("span", { class: "export" }, "Télécharger : ",
  ...["pdf", "excel", "csv"].map((f) => h("button", { type: "button", class: "discret", onclick: () => exporter(f) }, f === "pdf" ? "PDF" : f === "excel" ? "Excel" : "CSV")));

/** Même contenu pour les trois formats : un tableau, avec titre et informations au-dessus. */
function exporterTableau(format, { nom, titre, feuille, infos, colonnes, lignes, note }) {
  if (format === "pdf") return fichierPdf(nom, { titre, infos, colonnes, lignes, note });
  const tete = [[titre], ...infos.map((i) => [i]), [], colonnes.map((c) => c.titre)];
  const corps = lignes.map((l) => (Array.isArray(l) ? l : l.cellules));
  const tout = [...tete, ...corps, ...(note ? [[], [note]] : [])];
  if (format === "csv") return fichierCsv(nom, tout);
  const grasses = [0, tete.length - 1, ...lignes.map((l, i) => (l.gras ? tete.length + i : -1)).filter((i) => i >= 0)];
  return fichierExcel(nom, feuille || nom, tout, { grasses, largeurs: colonnes.map((c) => Math.max(10, Math.round((c.poids || 1) * 9))) });
}

function exporterListeAchats(format, commandes, s, filtres) {
  const periode = filtres.du || filtres.au ? `Période : ${filtres.du ? `du ${dateFr(filtres.du)}` : "depuis le début"} ${filtres.au ? `au ${dateFr(filtres.au)}` : "à aujourd'hui"}` : "Toutes les dates";
  const marge = (c) => (c.chiffre_affaires_prevu === null ? "" : c.chiffre_affaires_prevu - c.total - Number(c.frais));
  exporterTableau(format, {
    nom: nomFichier(`Achats ${filtres.du || ""} ${filtres.au || aujourdhui()}`),
    titre: "Achats et approvisionnement",
    infos: [
      `${periode}${filtres.q ? ` · Recherche : ${filtres.q}` : ""}. Les commandes annulées ne comptent pas dans les montants.`,
      `${s.commandes} commandes, ${s.en_cours} en cours, ${s.recues} reçues · Marchandises ${fcfa(s.montant)} · Frais ${fcfa(s.frais)} · Coût total ${fcfa(s.cout_total)}`,
      s.chiffre_affaires_prevu ? `Ventes prévues ${fcfa(s.chiffre_affaires_prevu)} · Marge prévue ${fcfa(s.marge_prevue)} (${tauxFr(s.taux_marge_prevu)})` : "Ventes et marge prévues : prix de vente à saisir.",
    ],
    colonnes: [
      { titre: "Code d'achat", poids: 1.6 }, { titre: "Date", poids: 1 }, { titre: "Origine", poids: 1.4 }, { titre: "Fournisseur", poids: 2 },
      { titre: "Transitaire", poids: 1.6 }, { titre: "Acheteur", poids: 1.4 }, { titre: "Articles", poids: 2.4 }, { titre: "Statut", poids: 1.2 },
      { titre: "Marchandises", poids: 1.3, droite: true }, { titre: "Frais", poids: 1.2, droite: true }, { titre: "Coût total", poids: 1.3, droite: true },
      { titre: "Marge prévue", poids: 1.3, droite: true },
    ],
    lignes: [
      ...commandes.map((c) => [c.numero, dateFr(c.date_commande), `${ORIGINES_ACHAT[c.origine]}${c.mode_transport ? ` ${MODES_TRANSPORT[c.mode_transport].toLowerCase()}` : ""}`,
        c.fournisseur, c.transitaire || "", c.acheteur, c.articles || "", STATUTS_ACHAT[c.statut], c.total, Number(c.frais), c.total + Number(c.frais), marge(c)]),
      { gras: true, cellules: ["Total", "", "", "", "", "", "", "", s.montant, s.frais, s.cout_total, s.chiffre_affaires_prevu ? s.marge_prevue : ""] },
    ],
  });
}

function exporterCommande(format, c) {
  const r = c.rentabilite;
  exporterTableau(format, {
    nom: nomFichier(`Achat ${c.numero}`),
    titre: `Achat ${c.numero} : coûts et marge prévue`,
    infos: [
      `Fournisseur : ${c.fournisseur.nom}${c.reference_fournisseur ? ` · Référence : ${c.reference_fournisseur}` : ""} · Acheteur : ${c.acheteur.nom}`,
      `${ORIGINES_ACHAT[c.origine]}${c.pays_origine ? ` depuis ${c.pays_origine}` : ""}${c.transitaire ? ` · Transitaire : ${c.transitaire.nom}` : ""}${c.mode_transport ? ` · Transport ${MODES_TRANSPORT[c.mode_transport].toLowerCase()}` : ""}`,
      `Commandée le ${dateFr(c.date_commande)} · ${STATUTS_ACHAT[c.statut]} · ${LIBELLES_ETAPE_ACHAT[c.etape]} · Réception : ${c.entite}`,
      `Marchandises ${fcfa(c.total)} · Frais ${fcfa(c.total_frais)} · Coût total ${fcfa(c.cout_total)}`
        + (r.chiffre_affaires ? ` · Ventes prévues ${fcfa(r.chiffre_affaires)} · Marge ${fcfa(r.marge)} (${tauxFr(r.taux_marge)})` : ""),
    ],
    colonnes: [
      { titre: "Code", poids: 1 }, { titre: "Article", poids: 2.4 }, { titre: "Quantité", poids: 0.9, droite: true }, { titre: "Poids kg", poids: 0.9, droite: true },
      { titre: "Prix d'achat", poids: 1, droite: true }, { titre: "Total achat", poids: 1.2, droite: true }, { titre: "Coût de revient", poids: 1.2, droite: true },
      { titre: "Prix de vente", poids: 1.1, droite: true }, { titre: "Marge unitaire", poids: 1.1, droite: true }, { titre: "Marge %", poids: 0.8, droite: true },
      { titre: "Marge totale", poids: 1.2, droite: true }, { titre: "Avis", poids: 1.3 },
    ],
    lignes: [
      ...c.lignes.map((l) => [l.code, l.nom, l.quantite, l.poids_kg ?? "", l.prix_unitaire, Math.round(l.quantite * l.prix_unitaire), l.cout_revient,
        l.prix_vente_prevu ?? "", l.marge_unitaire ?? "", l.taux_marge ?? "", l.marge_totale ?? "", AVIS_MARGE[l.avis][0]]),
      { gras: true, cellules: ["Total", "", "", c.poids_kg || "", "", c.total, c.cout_total, r.chiffre_affaires || "", "", r.taux_marge ?? "", r.chiffre_affaires ? r.marge : "", ""] },
      ...(c.frais.some((f) => !f.retire_le) ? [{ gras: true, cellules: ["", "Frais d'acheminement", "", "", "", "", "", "", "", "", "", ""] }] : []),
      ...c.frais.filter((f) => !f.retire_le).map((f) => ["", LIBELLES_FRAIS_ACHAT[f.nature],
        f.base_calcul ? `${quantiteFr(f.quantite_base)} ${BASES_FORFAIT[f.base_calcul]}` : "", "", f.base_calcul ? f.tarif : "", Number(f.montant), "", "", "", "", "", f.prestataire || ""]),
    ],
    note: `Coût de revient : prix d'achat plus sa part des frais, répartis selon la valeur. Marge en % du prix de vente ; jugée faible sous ${c.seuil_marge_faible} %. Estimation interne, à ne pas envoyer au fournisseur.`,
  });
}

/** Lignes d'un fichier Excel ou CSV : code ou nom d'article, quantité, prix d'achat, poids, prix de vente. */
function lignesDepuisTableur(rangs, produits) {
  const norm = (t) => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const entetes = (rangs[0] || []).map(norm);
  const pris = new Set();
  const colonne = (mots) => {
    const i = entetes.findIndex((e, j) => !pris.has(j) && mots.some((m) => e.includes(m)));
    if (i >= 0) pris.add(i);
    return i;
  };
  const iVente = colonne(["prix de vente", "vente"]);
  const iPrix = colonne(["prix d'achat", "prix achat", "prix unitaire", "cout unitaire", "prix"]);
  const iCode = colonne(["code", "reference", "ref"]);
  const iQte = colonne(["quantite", "qte", "qty"]);
  const iPoids = colonne(["poids"]);
  const iNom = colonne(["article", "designation", "produit", "nom"]);
  if ((iCode < 0 && iNom < 0) || iQte < 0 || iPrix < 0) return { erreur: "Colonnes attendues : code ou nom de l'article, quantité, prix d'achat unitaire. Téléchargez le modèle." };
  const parCode = new Map(produits.map((p) => [norm(p.code), p]));
  const parNom = new Map(produits.map((p) => [norm(p.nom), p]));
  const lignes = [], inconnus = [], invalides = [];
  rangs.slice(1).forEach((r, i) => {
    const numero = i + 2;
    const libelle = [r[iCode], r[iNom]].filter((x) => x !== undefined && String(x).trim()).join(" ");
    const p = (iCode >= 0 && parCode.get(norm(r[iCode]))) || (iNom >= 0 && parNom.get(norm(r[iNom])));
    if (!p) { inconnus.push(`${libelle || "sans nom"} (ligne ${numero})`); return; }
    const quantite = nombreSaisi(r[iQte]), prix = nombreSaisi(r[iPrix]);
    if (!quantite || quantite <= 0 || prix === null || prix < 0) { invalides.push(`${libelle} (ligne ${numero})`); return; }
    const poids = iPoids >= 0 ? nombreSaisi(r[iPoids]) : null, vente = iVente >= 0 ? nombreSaisi(r[iVente]) : null;
    lignes.push({ produitId: p.id, quantite, prix: Math.round(prix), poids: poids ?? "", prixVente: vente === null ? undefined : Math.round(vente) });
  });
  return { lignes, inconnus, invalides };
}

function modeleImportAchat(format, produits) {
  const lignes = [["Code article", "Article", "Quantité", "Prix d'achat unitaire (FCFA)", "Poids (kg)", "Prix de vente prévu (FCFA)"],
    ...produits.slice(0, 3).map((p) => [p.code, p.nom, 1, "", "", Number(p.prix_vente) || ""])];
  if (format === "csv") fichierCsv("Modele import achats", lignes);
  else fichierExcel("Modele import achats", "Lignes", lignes, { grasses: [0], largeurs: [16, 30, 10, 26, 12, 26] });
}
const PAIEMENT_ACHAT = { non_facture: "Pas encore facturée", non_paye: "Non payée", partiel: "Payée en partie", paye: "Payée" };
const debutMois = () => `${aujourdhui().slice(0, 8)}01`;

async function ecranAchats(message, filtres = {}) {
  const gere = droits.includes("achats.gerer");
  const qs = new URLSearchParams(Object.entries(filtres).filter(([, v]) => v)).toString();
  const suffixe = qs ? `?${qs}` : "";
  const [commandes, s, suggestions, acheteurs, produits, entites, tiers] = await Promise.all([
    api("GET", `/achats/commandes${suffixe}`), api("GET", `/achats/synthese${suffixe}`), api("GET", "/achats/reapprovisionnement"),
    api("GET", "/achats/acheteurs"), gere ? api("GET", "/produits") : [], gere ? entitesPour("achats_stocks") : [],
    droits.includes("tiers.voir") ? api("GET", "/tiers") : [],
  ]);
  const suivis = produits.filter((p) => p.suivi_stock && p.actif);
  const fournisseurs = avecRole(tiers, "fournisseur");
  const transitaires = avecRole(tiers, "transitaire");
  const lignes = h("div");
  const prixCatalogue = (id) => Number(suivis.find((p) => p.id === id)?.prix_vente) || "";
  const ajouter = (produitId = "", quantite = 1, x = {}) => {
    const vente = h("input", { name: "prixVente", type: "number", min: 0, value: x.prixVente ?? prixCatalogue(produitId || suivis[0]?.id) });
    // Unité d'achat : celle du stock, ou un conditionnement de l'article (carton, palette…). Le stock entre toujours dans l'unité de base.
    const unite = h("select", { name: "unite" });
    const majUnites = (id) => unite.replaceChildren(...unitesDeProduit(suivis.find((p) => p.id === id) || {}).map((u) => h("option", { value: u.base ? "" : u.nom }, u.base ? u.nom : `${u.nom} (${quantiteFr(u.facteur)} ${suivis.find((p) => p.id === id)?.unite || ""})`)));
    majUnites(produitId || suivis[0]?.id);
    const ligne = h("div", { class: "ligne-doc" },
      h("label", {}, "Article", h("select", { name: "produit", required: true, onchange: (e) => { vente.value = prixCatalogue(e.target.value); majUnites(e.target.value); } },
        suivis.map((p) => h("option", { value: p.id, selected: p.id === produitId }, p.nom)))),
      h("label", {}, "Quantité", h("input", { name: "quantite", type: "number", min: 0.001, step: 0.001, value: quantite, required: true })),
      h("label", {}, "Unité", unite),
      h("label", {}, "Prix d'achat de cette unité (FCFA)", h("input", { name: "prix", type: "number", min: 0, required: true, value: x.prix ?? "" })),
      h("label", {}, "Poids en kg, facultatif", h("input", { name: "poids", type: "number", min: 0, step: 0.001, value: x.poids ?? "" })),
      h("label", {}, "Prix de vente prévu (FCFA)", vente),
      h("button", { type: "button", class: "discret", onclick: () => { if (lignes.children.length > 1) ligne.remove(); } }, "Retirer"));
    lignes.append(ligne);
  };
  if (suivis.length) ajouter();
  const compteRendu = h("div");
  const blocImport = h("div", { hidden: true },
    h("h3", {}, "Importation : transitaire et transport"),
    h("div", { class: "grille" },
      choix("transitaireId", "Transitaire", [["", "Pas encore choisi"], ["nouveau", "Nouveau transitaire"], ...transitaires.map((t) => [t.id, t.nom])]),
      champ("Nom du nouveau transitaire", { name: "nomTransitaire" }),
      champ("Téléphone du nouveau transitaire", { name: "telTransitaire", type: "tel" }),
      choix("mode", "Mode de transport", [["", "Pas encore connu"], ["maritime", "Maritime"], ["aerien", "Aérien"]]),
      champ("Volume en m³, facultatif", { name: "volume", type: "number", min: 0, step: 0.001 })));
  const preparer = (x) => {
    lignes.replaceChildren();
    ajouter(x.produit_id, x.a_commander);
    document.getElementById("nouvelle-commande").scrollIntoView();
  };
  const periode = (du, au) => ecranAchats(null, { ...filtres, du, au });
  const chiffre = (valeur, texte) => h("div", { class: "chiffre" }, h("b", {}, valeur), h("span", {}, texte));
  const repartition = (titre, liste) => liste.length ? h("div", { class: "defilant" }, h("table", {},
    h("thead", {}, h("tr", {}, [titre, "Commandes", "Montant"].map((t) => h("th", { scope: "col" }, t)))),
    h("tbody", {}, liste.map((x) => h("tr", {}, h("td", {}, x.nom), h("td", { class: "nombre" }, x.commandes), h("td", { class: "nombre" }, fcfa(x.montant))))))) : null;
  const choisis = Object.values(filtres).some((v) => v);
  vue(
    h("h1", {}, "Achats et approvisionnement"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Rechercher et filtrer"),
      h("div", { class: "actions" },
        h("button", { class: "discret", onclick: () => periode(debutMois(), aujourdhui()) }, "Ce mois"),
        h("button", { class: "discret", onclick: () => periode(debutAnnee(), aujourdhui()) }, "Cette année"),
        choisis ? h("button", { class: "discret", onclick: () => ecranAchats() }, "Tout afficher") : null),
      formulaire(async (v) => ecranAchats(null, v), [h("div", { class: "grille" },
        champ("Rechercher : code d'achat, article, fournisseur, transitaire", { name: "q", type: "search", value: filtres.q || "" }),
        champ("Du", { name: "du", type: "date", value: filtres.du || "" }),
        champ("Au", { name: "au", type: "date", value: filtres.au || "" }),
        choix("statut", "Statut", [["", "Tous"], ["en_cours", "En cours"], ["recue", "Reçues en stock"], ["annulee", "Annulées"]], filtres.statut || ""),
        choix("origine", "Origine", [["", "Toutes"], ["local", "Achat local"], ["import", "Importation"]], filtres.origine || ""),
        choix("acheteurId", "Acheteur", [["", "Tous"], ...acheteurs.map((u) => [u.id, u.nom])], filtres.acheteurId || ""),
        fournisseurs.length ? choix("fournisseurId", "Fournisseur", [["", "Tous"], ...fournisseurs.map((t) => [t.id, t.nom])], filtres.fournisseurId || "") : null,
        tiers.some((t) => t.roles.includes("transitaire")) ? choix("transitaireId", "Transitaire", [["", "Tous"], ...tiers.filter((t) => t.roles.includes("transitaire")).map((t) => [t.id, t.nom])], filtres.transitaireId || "") : null)],
      "Afficher")),
    h("p", { class: "discret-texte" }, filtres.du || filtres.au
      ? `Période : ${filtres.du ? `du ${dateFr(filtres.du)}` : "depuis le début"} ${filtres.au ? `au ${dateFr(filtres.au)}` : "à aujourd'hui"}. Les commandes annulées ne comptent pas dans les montants.`
      : "Toutes les dates. Les commandes annulées ne comptent pas dans les montants."),
    h("div", { class: "chiffres" },
      chiffre(s.commandes, `commandes, dont ${s.en_cours} en cours et ${s.recues} reçues`),
      chiffre(fcfa(s.montant), "marchandises commandées"),
      chiffre(fcfa(s.frais), "frais d'acheminement"),
      chiffre(fcfa(s.cout_total), "coût total des achats"),
      chiffre(quantiteFr(s.quantite), `quantité commandée, ${quantiteFr(s.quantite_recue)} reçue`),
      chiffre(fcfa(s.montant_recu), "valeur déjà reçue en stock"),
      s.poids_kg ? chiffre(`${quantiteFr(s.poids_kg)} kg`, s.frais_par_kg === null ? "poids déclaré" : `poids déclaré, ${fcfa(s.frais_par_kg)} de frais par kg`) : null,
      s.volume_m3 ? chiffre(`${quantiteFr(s.volume_m3)} m³`, "volume déclaré") : null,
      chiffre(s.en_retard, "en retard sur la date prévue"),
      s.chiffre_affaires_prevu ? chiffre(fcfa(s.marge_prevue), `marge prévue (${tauxFr(s.taux_marge_prevu)}) sur ${fcfa(s.chiffre_affaires_prevu)} de ventes`) : null),
    s.sans_prix_vente ? h("p", { class: "discret-texte" }, `${s.sans_prix_vente} commande${s.sans_prix_vente > 1 ? "s" : ""} sans prix de vente prévu sur toutes les lignes : non comptée${s.sans_prix_vente > 1 ? "s" : ""} dans la marge.`) : null,
    s.par_fournisseur.length ? h("details", { class: "carte" }, h("summary", {}, "Dépenses par fournisseur, acheteur, transitaire et nature de frais"),
      repartition("Fournisseur", s.par_fournisseur), repartition("Acheteur", s.par_acheteur),
      s.par_transitaire.length ? h("div", { class: "defilant" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Transitaire", "Commandes", "Frais", "Poids", "Volume", "Frais par kg"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", {}, s.par_transitaire.map((x) => h("tr", {}, h("td", {}, x.nom), h("td", { class: "nombre" }, x.commandes), h("td", { class: "nombre" }, fcfa(x.frais)),
          h("td", { class: "nombre" }, x.poids_kg ? `${quantiteFr(x.poids_kg)} kg` : ""), h("td", { class: "nombre" }, x.volume_m3 ? `${quantiteFr(x.volume_m3)} m³` : ""),
          h("td", { class: "nombre" }, x.frais_par_kg === null ? "" : fcfa(x.frais_par_kg))))))) : null,
      s.frais_par_nature.length ? h("div", { class: "defilant" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Nature de frais", "Nombre", "Montant"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", {}, s.frais_par_nature.map((x) => h("tr", {}, h("td", {}, LIBELLES_FRAIS_ACHAT[x.nature]), h("td", { class: "nombre" }, x.nombre), h("td", { class: "nombre" }, fcfa(x.montant))))))) : null) : null,
    h("div", { class: "carte" },
      h("div", { class: "ligne" }, h("h2", {}, "Commandes"), h("span", { class: "pas-imprimer" },
        boutonsExport((f) => exporterListeAchats(f, commandes, s, filtres)), " ", h("button", { class: "discret", onclick: () => window.print() }, "Imprimer"))),
      commandes.length ? commandes.map((c) => h("button", { class: "session", onclick: () => ecranCommande(c.id) },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, `${c.numero} · ${c.fournisseur}`),
          h("span", {}, c.alerte_prix ? h("span", { class: "pastille retard" }, "Prix à vérifier") : null, " ",
            c.en_retard ? h("span", { class: "pastille retard" }, "En retard") : null, " ",
            h("span", { class: c.statut === "recue" ? "pastille ok" : c.statut === "annulee" ? "pastille retard" : "pastille attente" }, STATUTS_ACHAT[c.statut]))),
        h("div", { class: "discret-texte" }, `${dateFr(c.date_commande)} · ${ORIGINES_ACHAT[c.origine]}${c.mode_transport ? ` ${MODES_TRANSPORT[c.mode_transport].toLowerCase()}` : ""}${c.transitaire ? ` via ${c.transitaire}` : ""} · Acheteur : ${c.acheteur} · ${c.entite}`),
        h("div", { class: "discret-texte" }, `${c.articles || ""} · ${fcfa(c.total)}${Number(c.frais) ? ` + ${fcfa(c.frais)} de frais` : ""}${c.statut === "annulee" ? "" : ` · ${LIBELLES_ETAPE_ACHAT[c.etape]}`}`
          + (c.chiffre_affaires_prevu !== null && c.statut !== "annulee" ? ` · Marge prévue ${fcfa(c.chiffre_affaires_prevu - c.total - Number(c.frais))}` : ""))))
      : h("p", { class: "discret-texte" }, choisis ? "Aucune commande ne correspond." : "Aucun bon de commande.")),
    h("details", { class: "carte pas-imprimer", open: suggestions.length > 0 }, h("summary", {}, `À réapprovisionner (${suggestions.length})`), suggestions.length ? suggestions.map((x) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${x.nom}, ${x.entite}`), h("span", { class: "pastille retard" }, `Stock ${quantiteFr(x.stock)}`)),
      h("div", { class: "discret-texte" }, `Seuil ${quantiteFr(x.seuil)}, cible ${quantiteFr(x.cible)}, attendu ${quantiteFr(x.attendu)}, à commander ${quantiteFr(x.a_commander)}`),
      gere && x.a_commander > 0 ? h("div", { class: "actions" }, h("button", { class: "discret", onclick: () => preparer(x) }, "Préparer la commande")) : null))
      : h("p", { class: "discret-texte" }, "Aucun article sous son seuil.")),
    gere && entites.length && suivis.length ? h("div", { class: "carte pas-imprimer", id: "nouvelle-commande" }, h("h2", {}, "Nouveau bon de commande"),
      h("p", { class: "discret-texte" }, "Le code d'achat est attribué automatiquement. La commande doit ensuite être approuvée, puis suivie étape par étape jusqu'à sa réception en stock."),
      formulaire(async (v, f, zone) => {
        const saisie = [...lignes.children].map((l) => {
          const poids = l.querySelector("[name=poids]").value;
          return {
            produitId: l.querySelector("[name=produit]").value, quantite: Number(l.querySelector("[name=quantite]").value),
            prixUnitaire: Number(l.querySelector("[name=prix]").value), ...(poids ? { poidsKg: Number(poids) } : {}),
            ...(l.querySelector("[name=unite]").value ? { unite: l.querySelector("[name=unite]").value } : {}),
            ...(l.querySelector("[name=prixVente]").value ? { prixVente: Number(l.querySelector("[name=prixVente]").value) } : {}),
          };
        });
        const importe = v.origine === "import";
        const creer = async (fournisseurId, transitaireId) => {
          const c = await api("POST", "/achats/commandes", {
            entiteId: v.entiteId, fournisseurId, date: v.date, datePrevue: v.prevue || undefined, lignes: saisie, origine: v.origine,
            acheteurId: v.acheteurId || undefined, referenceFournisseur: v.reference.trim() || undefined, paysOrigine: v.pays.trim() || undefined,
            ...(importe ? { transitaireId, modeTransport: v.mode || undefined, volumeM3: v.volume ? Number(v.volume) : undefined } : {}),
          });
          ecranCommande(c.id, `Commande ${c.numero} créée. Elle doit être approuvée.`);
        };
        // Le transitaire d'abord (choisi, nouveau ou aucun), puis le fournisseur.
        const avecTransitaire = (suite) => !importe || v.transitaireId !== "nouveau" ? suite(importe && v.transitaireId ? v.transitaireId : undefined)
          : !v.nomTransitaire.trim() ? Promise.reject(Object.assign(new Error(), { code: "donnees_invalides" }))
            : ficheClient(zone, { type: "entreprise", nom: v.nomTransitaire.trim(), telephone: v.telTransitaire.trim() || undefined, entiteId: v.entiteId, roles: ["transitaire"] }, suite);
        await avecTransitaire(async (transitaireId) => {
          if (v.fournisseurId) return creer(v.fournisseurId, transitaireId);
          if (!v.nom.trim()) throw Object.assign(new Error(), { code: "donnees_invalides" });
          return ficheClient(zone, { type: "entreprise", nom: v.nom.trim(), telephone: v.telephone.trim() || undefined, entiteId: v.entiteId }, (id) => creer(id, transitaireId));
        });
      }, [h("div", { class: "grille" },
        h("label", {}, "Origine", h("select", { name: "origine", onchange: (e) => { blocImport.hidden = e.target.value !== "import"; } },
          h("option", { value: "local" }, "Achat local"), h("option", { value: "import" }, "Importation (Chine, Dubaï…)"))),
        choix("acheteurId", "Acheteur", [["", "Moi-même"], ...acheteurs.map((u) => [u.id, u.nom])]),
        choix("fournisseurId", "Fournisseur", [["", "Nouveau fournisseur"], ...fournisseurs.map((t) => [t.id, t.branche ? `${t.nom} (${t.branche})` : t.nom])]),
        champ("Nom du nouveau fournisseur", { name: "nom" }),
        champ("Téléphone du nouveau fournisseur", { name: "telephone", type: "tel" }),
        champ("Référence du fournisseur (proforma), facultatif", { name: "reference" }),
        champ("Pays d'origine, facultatif", { name: "pays" }),
        choix("entiteId", "Entrepôt de réception", entites),
        champ("Date de la commande", { name: "date", type: "date", value: aujourdhui(), required: true }),
        champ("Arrivée prévue", { name: "prevue", type: "date" })),
        blocImport,
        lignes,
        h("p", {}, h("button", { type: "button", class: "discret", onclick: () => ajouter() }, "Ajouter une ligne")),
        h("details", {}, h("summary", {}, "Importer les lignes depuis un fichier Excel ou CSV"),
          h("p", { class: "discret-texte" }, "Colonnes : code article (ou nom), quantité, prix d'achat unitaire, et si vous les avez, poids et prix de vente prévu. Les articles doivent exister dans le catalogue. Les lignes importées remplacent celles du formulaire ; vous les vérifiez avant d'enregistrer."),
          h("div", { class: "actions" },
            h("button", { type: "button", class: "discret", onclick: () => modeleImportAchat("excel", suivis) }, "Modèle Excel"),
            h("button", { type: "button", class: "discret", onclick: () => modeleImportAchat("csv", suivis) }, "Modèle CSV")),
          h("label", {}, "Fichier (.xlsx ou .csv)", h("input", { type: "file", accept: ".xlsx,.csv,.txt", onchange: async (e) => {
            const fichier = e.target.files[0];
            if (!fichier) return;
            try {
              const r = lignesDepuisTableur(await lireTableur(fichier), suivis);
              if (r.erreur || !r.lignes.length) {
                compteRendu.replaceChildren(h("div", { class: "erreur", role: "alert" }, r.erreur || "Aucune ligne utilisable dans ce fichier.",
                  ...[...(r.inconnus || []).length ? [h("br"), `Introuvables dans le catalogue : ${r.inconnus.join(", ")}.`] : [], ...(r.invalides || []).length ? [h("br"), `Quantité ou prix illisible : ${r.invalides.join(", ")}.`] : []]));
                return;
              }
              lignes.replaceChildren();
              for (const l of r.lignes) ajouter(l.produitId, l.quantite, l);
              compteRendu.replaceChildren(h("div", { class: r.inconnus.length || r.invalides.length ? "erreur" : "succes", role: "status" },
                `${r.lignes.length} ligne${r.lignes.length > 1 ? "s" : ""} importée${r.lignes.length > 1 ? "s" : ""}. Vérifiez-les puis enregistrez.`,
                ...r.inconnus.length ? [h("br"), `Ignorées, introuvables dans le catalogue : ${r.inconnus.join(", ")}. Créez-les d'abord dans le catalogue.`] : [],
                ...r.invalides.length ? [h("br"), `Ignorées, quantité ou prix illisible : ${r.invalides.join(", ")}.`] : []));
            } catch (x) {
              compteRendu.replaceChildren(h("div", { class: "erreur", role: "alert" }, texteErreur(x.code ? x : { code: "fichier_illisible" })));
            } finally { e.target.value = ""; }
          } })),
          compteRendu),
      ], "Enregistrer le bon de commande")) : gere ? h("p", { class: "discret-texte" }, "Créez d'abord un produit suivi en stock dans le catalogue.") : null,
  );
}

async function ecranCommande(id, message) {
  const c = await api("GET", `/achats/commandes/${id}`);
  const gere = droits.includes("achats.gerer");
  const modifiable = gere && !["recue", "annulee"].includes(c.statut);
  const [acheteurs, tiers] = await Promise.all([
    gere && c.statut === "brouillon" ? api("GET", "/achats/acheteurs") : [],
    modifiable && c.origine === "import" && droits.includes("tiers.voir") ? api("GET", "/tiers") : [],
  ]);
  const ouverte = ["approuvee", "recue_partiellement"].includes(c.statut);
  const restantes = c.lignes.filter((l) => l.quantite_recue < l.quantite);
  const relire = (m) => ecranCommande(id, m);
  const parcours = [...c.etapes_possibles, "en_stock"];
  const faites = new Map(c.etapes.map((e) => [e.etape, e.date_etape]));
  const suivante = c.etapes_possibles[c.etapes_possibles.indexOf(c.etape) + 1] || c.etapes_possibles.at(-1);
  const alertes = c.lignes.filter((l) => l.alerte_prix);
  const p = c.paiement;
  vue(
    h("div", { class: "actions pas-imprimer" },
      h("button", { class: "discret", onclick: () => ecranAchats() }, "← Achats"),
      h("button", { class: "discret", onclick: () => window.print() }, "Imprimer le bon de commande"),
      boutonsExport((f) => exporterCommande(f, c))),
    message ? h("div", { class: "succes pas-imprimer", role: "status" }, message) : null,
    h("div", { class: "document" },
      h("div", { class: "ligne" }, h("h2", {}, `Bon de commande ${c.numero}`), h("span", { class: `pastille ${c.statut === "recue" ? "ok" : c.statut === "annulee" ? "retard" : "attente"} pas-imprimer` }, STATUTS_ACHAT[c.statut])),
      h("p", {}, `Fournisseur : ${c.fournisseur.nom}${c.fournisseur.telephone ? `, ${c.fournisseur.telephone}` : ""}${c.reference_fournisseur ? ` · Référence : ${c.reference_fournisseur}` : ""}`),
      h("p", {}, `${ORIGINES_ACHAT[c.origine]}${c.pays_origine ? ` depuis ${c.pays_origine}` : ""} · Acheteur : ${c.acheteur.nom}`),
      c.origine === "import" ? h("p", {}, `Transitaire : ${c.transitaire ? `${c.transitaire.nom}${c.transitaire.telephone ? `, ${c.transitaire.telephone}` : ""}` : "pas encore choisi"}`
        + `${c.mode_transport ? ` · Transport ${MODES_TRANSPORT[c.mode_transport].toLowerCase()}` : ""}${c.volume_m3 ? ` · ${quantiteFr(c.volume_m3)} m³` : ""}`) : null,
      h("p", {}, `Réception : ${c.entite} · Commandée le ${dateFr(c.date_commande)}${c.date_prevue ? ` · Arrivée prévue le ${dateFr(c.date_prevue)}` : ""}`),
      c.notes ? h("p", {}, `Notes : ${c.notes}`) : null,
      c.motif_annulation ? h("p", {}, `Annulation : ${c.motif_annulation}`) : null,
      h("div", { class: "defilant" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Article", "Commandé", "Reçu", "Poids (kg)", "Prix unitaire", "Total", "Coût de revient unitaire"].map((t, i) => h("th", { scope: "col", class: i === 6 ? "pas-imprimer" : "" }, t)))),
        h("tbody", {}, c.lignes.map((l) => h("tr", {}, h("td", {}, l.nom, l.unite_achat ? h("div", { class: "discret-texte" }, `Acheté : ${quantiteFr(l.quantite_unite)} ${l.unite_achat} à ${fcfa(l.prix_unite)}`) : null), h("td", { class: "nombre" }, quantiteFr(l.quantite)), h("td", { class: "nombre" }, quantiteFr(l.quantite_recue)),
          h("td", { class: "nombre" }, l.poids_kg === null ? "" : quantiteFr(l.poids_kg)),
          h("td", { class: "nombre" }, Number(l.prix_unitaire).toLocaleString("fr-FR")), h("td", { class: "nombre" }, Math.round(l.quantite * l.prix_unitaire).toLocaleString("fr-FR")),
          h("td", { class: "nombre pas-imprimer" }, Number(l.cout_revient).toLocaleString("fr-FR"))))))),
      // Le fournisseur ne voit que le montant des marchandises : frais et coût de revient restent internes.
      h("p", { class: "totaux" }, h("b", {}, `Marchandises : ${fcfa(c.total)}`),
        h("span", { class: "pas-imprimer" }, h("br"), `Frais d'acheminement : ${fcfa(c.total_frais)}`, h("br"), `Coût total : ${fcfa(c.cout_total)}`))),
    h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Rentabilité prévue sur le marché local"),
      c.statut === "brouillon" ? h("p", { class: "discret-texte" }, "Cette commande en brouillon sert d'étude : rien n'est engagé tant qu'elle n'est pas approuvée. Ajoutez les frais estimés (forfait au kilo ou au mètre cube…) pour une marge réaliste, puis décidez de commander ou d'annuler.") : null,
      h("div", { class: "defilant" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Article", "Coût de revient unitaire", "Prix de vente prévu", "Marge unitaire", "Marge", "Marge totale", "Avis"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", {}, c.lignes.map((l) => h("tr", {}, h("td", {}, l.nom), h("td", { class: "nombre" }, Number(l.cout_revient).toLocaleString("fr-FR")),
          h("td", { class: "nombre" }, l.prix_vente_prevu === null ? "" : Number(l.prix_vente_prevu).toLocaleString("fr-FR")),
          h("td", { class: "nombre" }, l.marge_unitaire === null ? "" : l.marge_unitaire.toLocaleString("fr-FR")),
          h("td", { class: "nombre" }, tauxFr(l.taux_marge)), h("td", { class: "nombre" }, l.marge_totale === null ? "" : l.marge_totale.toLocaleString("fr-FR")),
          h("td", {}, h("span", { class: AVIS_MARGE[l.avis][1] }, AVIS_MARGE[l.avis][0]))))))),
      c.rentabilite.chiffre_affaires ? h("div", { class: "ligne" },
        h("span", {}, `Ventes prévues ${fcfa(c.rentabilite.chiffre_affaires)} · Coût ${fcfa(c.rentabilite.cout)} · `, h("b", {}, `Marge ${fcfa(c.rentabilite.marge)} (${tauxFr(c.rentabilite.taux_marge)})`)),
        h("span", { class: AVIS_MARGE[avisGlobal(c.rentabilite, c.seuil_marge_faible)][1] }, AVIS_MARGE[avisGlobal(c.rentabilite, c.seuil_marge_faible)][0])) : null,
      c.rentabilite.lignes_sans_prix ? h("p", { class: "discret-texte" }, `${c.rentabilite.lignes_sans_prix} ligne${c.rentabilite.lignes_sans_prix > 1 ? "s" : ""} sans prix de vente : non comptée${c.rentabilite.lignes_sans_prix > 1 ? "s" : ""} dans le total.`) : null,
      h("p", { class: "discret-texte" }, `Le coût de revient comprend le prix d'achat et sa part des frais. La marge est en % du prix de vente ; elle est jugée faible sous ${c.seuil_marge_faible} %. C'est une estimation interne : elle n'apparaît pas sur le bon de commande imprimé.`),
      gere && c.statut !== "annulee" ? h("details", {}, h("summary", {}, "Saisir ou modifier les prix de vente prévus"), formulaire(async (v, f) => {
        const prix = c.lignes.map((l) => { const x = f.querySelector(`[name="pv${l.id}"]`).value; return { ligneId: l.id, prixVente: x === "" ? null : Number(x) }; });
        await api("PUT", `/achats/commandes/${id}/prix-vente`, { prix });
        relire("Prix de vente prévus enregistrés.");
      }, [h("div", { class: "grille" }, c.lignes.map((l) => champ(`${l.nom}${l.prix_catalogue ? ` (catalogue : ${fcfa(l.prix_catalogue)})` : ""}`,
        { name: `pv${l.id}`, type: "number", min: 0, value: l.prix_vente_prevu ?? l.prix_catalogue ?? "" })))], "Enregistrer les prix de vente")) : null),
    h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Contrôle des prix"),
      alertes.length ? h("div", { class: "erreur", role: "alert" }, alertes.map((l) => h("p", {},
        `${l.nom} : ${Number(l.prix_unitaire).toLocaleString("fr-FR")} FCFA, soit ${l.ecart_prix} % de plus que le prix moyen des trois achats précédents (${fcfa(l.prix_habituel)}).`
        + (l.meilleur_prix ? ` Meilleur prix sur un an : ${fcfa(l.meilleur_prix.prix)} chez ${l.meilleur_prix.fournisseur}, le ${dateFr(l.meilleur_prix.date)}.` : ""))))
        : null,
      c.lignes.map((l) => h("div", { class: "discret-texte" }, l.prix_habituel === null
        ? `${l.nom} : premier achat enregistré, pas de prix de comparaison.`
        : `${l.nom} : prix habituel ${fcfa(l.prix_habituel)}, écart ${l.ecart_prix > 0 ? "+" : ""}${l.ecart_prix} %.`)),
      h("p", { class: "discret-texte" }, `Une alerte apparaît au-delà de ${c.seuil_alerte_prix} % au-dessus du prix habituel. Elle invite à vérifier, elle ne bloque rien.`)),
    c.statut === "annulee" ? null : h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Suivi étape par étape"),
      h("div", { class: "etapes-achat" }, parcours.map((e) => h("span", { class: faites.has(e) ? "pastille ok" : "pastille" },
        `${faites.has(e) ? "✓ " : ""}${LIBELLES_ETAPE_ACHAT[e]}${faites.has(e) ? ` (${dateFr(faites.get(e))})` : ""}`))),
      c.etapes.slice().reverse().map((e) => h("div", { class: "apprenant" },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, LIBELLES_ETAPE_ACHAT[e.etape]), h("span", {}, dateFr(e.date_etape))),
        h("div", { class: "discret-texte" }, `${e.auteur}${e.note ? ` · ${e.note}` : ""}`))),
      c.statut === "brouillon" ? h("p", { class: "discret-texte" }, "Le suivi commence une fois la commande approuvée.") : null,
      gere && ouverte ? h("details", { class: "pas-imprimer" }, h("summary", {}, "Enregistrer une nouvelle étape"), formulaire(async (v) => {
        await api("POST", `/achats/commandes/${id}/etapes`, { etape: v.etape, date: v.date, note: v.note.trim() || undefined });
        relire("Étape enregistrée.");
      }, [h("div", { class: "grille" },
        choix("etape", "Étape", c.etapes_possibles.filter((e) => e !== "commandee").map((e) => [e, LIBELLES_ETAPE_ACHAT[e]]), suivante),
        champ("Date", { name: "date", type: "date", value: aujourdhui(), required: true }),
        champ("Note, facultatif (conteneur, transporteur…)", { name: "note", maxlength: 500 }))], "Enregistrer l'étape")) : null,
      ouverte ? h("p", { class: "discret-texte" }, "La dernière étape, « Reçue en stock », s'enregistre seule quand le magasinier confirme la réception complète.") : null),
    h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Frais d'acheminement"),
      c.frais.length ? c.frais.map((x) => h("div", { class: "apprenant" },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, `${LIBELLES_FRAIS_ACHAT[x.nature]}${x.libelle ? ` : ${x.libelle}` : ""}`),
          x.retire_le ? h("span", { class: "pastille retard" }, "Retiré") : h("span", {}, fcfa(x.montant))),
        x.base_calcul ? h("div", { class: "discret-texte" }, `Forfait : ${quantiteFr(x.quantite_base)} ${BASES_FORFAIT[x.base_calcul]} × ${fcfa(x.tarif)} par ${BASES_FORFAIT[x.base_calcul]}`) : null,
        h("div", { class: "discret-texte" }, `${x.prestataire ? `${x.prestataire} · ` : ""}saisi par ${x.auteur} le ${heure(x.cree_le)}${x.retire_le ? ` · retiré : ${x.motif_retrait} (${fcfa(x.montant)})` : ""}`),
        gere && !x.retire_le ? h("details", {}, h("summary", {}, "Retirer ce frais"), formulaire(async (v) => {
          await api("POST", `/achats/frais/${x.id}/retrait`, { motif: v.motif.trim() });
          relire("Frais retiré. Il reste visible dans l'historique.");
        }, [champ("Motif (obligatoire)", { name: "motif", required: true, minlength: 3 })], "Confirmer le retrait")) : null))
        : h("p", { class: "discret-texte" }, "Aucun frais saisi."),
      c.frais_par_nature.length > 1 ? h("div", { class: "defilant" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Par nature", "Montant"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", {}, c.frais_par_nature.map((x) => h("tr", {}, h("td", {}, LIBELLES_FRAIS_ACHAT[x.nature]), h("td", { class: "nombre" }, fcfa(x.montant))))))) : null,
      c.frais_par_kg !== null ? h("p", { class: "discret-texte" }, `Frais par kg : ${fcfa(c.frais_par_kg)}, pour ${quantiteFr(c.poids_kg)} kg déclarés. Utile pour comparer les transitaires.`) : null,
      c.frais_par_m3 !== null ? h("p", { class: "discret-texte" }, `Frais par m³ : ${fcfa(c.frais_par_m3)}, pour ${quantiteFr(c.volume_m3)} m³ déclarés.`) : null,
      h("p", { class: "discret-texte" }, "Les frais saisis avant la réception sont répartis sur les articles, selon leur valeur, et entrent dans le coût de revient du stock."),
      gere && c.statut !== "annulee" ? h("details", {}, h("summary", {}, "Ajouter un frais"), formulaire(async (v) => {
        const forfait = v.base ? { base: v.base, quantiteBase: Number(v.quantiteBase), tarif: Number(v.tarif) } : { montant: Number(v.montant) || undefined };
        await api("POST", `/achats/commandes/${id}/frais`, { nature: v.nature, ...forfait, libelle: v.libelle.trim() || undefined, prestataire: v.prestataire.trim() || undefined });
        relire("Frais ajouté.");
      }, [h("div", { class: "grille" },
        choix("nature", "Nature", Object.entries(LIBELLES_FRAIS_ACHAT).filter(([k]) => c.origine === "import" ? k !== "transport_local" : FRAIS_ACHAT_LOCAL.includes(k))),
        choix("base", "Calcul", [["", "Montant global"], ["poids", "Forfait au kilo"], ["volume", "Forfait au mètre cube"]]),
        champ("Montant (FCFA), pour un montant global", { name: "montant", type: "number", min: 1 }),
        champ("Quantité en kg ou m³, pour un forfait", { name: "quantiteBase", type: "number", min: 0.001, step: 0.001, value: c.poids_kg || c.volume_m3 || "" }),
        champ("Tarif par kg ou par m³ (FCFA)", { name: "tarif", type: "number", min: 1 }),
        champ("Prestataire, facultatif", { name: "prestataire", value: c.transitaire?.nom || "" }),
        champ("Détail, facultatif", { name: "libelle" }))], "Ajouter le frais")) : null),
    p ? h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Paiement"),
      h("div", { class: "ligne" }, h("span", {}, `Facturé ${fcfa(p.facture)} · Payé ${fcfa(p.paye)} · Reste ${fcfa(p.reste)}`),
        h("span", { class: p.statut === "paye" ? "pastille ok" : "pastille attente" }, PAIEMENT_ACHAT[p.statut])),
      p.paiements.map((x) => h("div", { class: "discret-texte" }, `${dateFr(x.date_paiement)} · ${fcfa(x.montant)} · ${x.moyen}${x.reference ? ` · ${x.reference}` : ""} · facture ${x.facture}`)),
      p.statut === "non_facture" ? h("p", { class: "discret-texte" }, "La facture du fournisseur, liée à cette commande, et son paiement s'enregistrent en comptabilité. Ils apparaîtront ici.") : null) : null,
    c.statut === "brouillon" && droits.includes("achats.approuver") ? h("div", { class: "actions pas-imprimer" }, h("button", { onclick: async () => {
      await api("POST", `/achats/commandes/${id}/approbation`);
      relire("Commande approuvée.");
    } }, "Approuver la commande")) : null,
    ouverte && droits.includes("stocks.gerer") ? h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Confirmer une réception en stock"),
      h("p", { class: "discret-texte" }, "Saisissez ce qui est réellement arrivé à l'entrepôt. Seule cette quantité entre en stock."),
      formulaire(async (v, f) => {
        const saisies = restantes.map((l) => ({ ligneId: l.id, quantite: Number(f.querySelector(`[name="q${l.id}"]`).value) })).filter((l) => l.quantite > 0);
        if (!saisies.length) throw Object.assign(new Error(), { code: "donnees_invalides" });
        const r = await api("POST", `/achats/commandes/${id}/receptions`, { lignes: saisies, note: v.note.trim() || undefined, cloturer: v.cloturer === "oui" });
        relire(`Réception ${r.numero} enregistrée.`);
      }, [restantes.map((l) => champ(`${l.nom}, reste ${quantiteFr(l.quantite - l.quantite_recue)}`, { name: `q${l.id}`, type: "number", min: 0, max: l.quantite - l.quantite_recue, step: 0.001, value: l.quantite - l.quantite_recue })),
        champ("Note", { name: "note" }),
        choix("cloturer", "Le reste n'arrivera pas", [["non", "Non, garder la commande ouverte"], ["oui", "Oui, clôturer la commande"]])], "Confirmer la réception")) : null,
    c.receptions.length ? h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Réceptions"), c.receptions.map((r) => h("div", { class: "apprenant" },
      h("div", { class: "nom" }, r.numero), h("div", { class: "discret-texte" }, `${heure(r.cree_le)} · ${r.auteur}${r.note ? ` · ${r.note}` : ""}`)))) : null,
    modifiable ? h("details", { class: "carte pas-imprimer" }, h("summary", {}, "Modifier les informations de la commande"), formulaire(async (v) => {
      await api("PATCH", `/achats/commandes/${id}`, {
        referenceFournisseur: v.reference.trim() || null, paysOrigine: v.pays.trim() || null, datePrevue: v.prevue || null, notes: v.notes.trim() || null,
        ...(c.origine === "import" ? { modeTransport: v.mode || null, volumeM3: v.volume ? Number(v.volume) : null, ...(v.transitaireId !== undefined ? { transitaireId: v.transitaireId || null } : {}) } : {}),
        ...(c.statut === "brouillon" ? { origine: v.origine, acheteurId: v.acheteurId } : {}),
      });
      relire("Informations enregistrées.");
    }, [h("div", { class: "grille" },
      champ("Référence du fournisseur", { name: "reference", value: c.reference_fournisseur || "" }),
      champ("Pays d'origine", { name: "pays", value: c.pays_origine || "" }),
      champ("Arrivée prévue", { name: "prevue", type: "date", value: c.date_prevue ? String(c.date_prevue).slice(0, 10) : "" }),
      champ("Notes", { name: "notes", value: c.notes || "" }),
      c.origine === "import" && tiers.length ? choix("transitaireId", "Transitaire", [["", "Pas encore choisi"], ...avecRole(tiers, "transitaire").map((t) => [t.id, t.nom])], c.transitaire?.id || "") : null,
      c.origine === "import" ? choix("mode", "Mode de transport", [["", "Pas encore connu"], ...Object.entries(MODES_TRANSPORT)], c.mode_transport || "") : null,
      c.origine === "import" ? champ("Volume en m³", { name: "volume", type: "number", min: 0, step: 0.001, value: c.volume_m3 ?? "" }) : null,
      c.statut === "brouillon" ? choix("origine", "Origine", Object.entries(ORIGINES_ACHAT), c.origine) : null,
      c.statut === "brouillon" ? choix("acheteurId", "Acheteur", acheteurs.map((u) => [u.id, u.nom]), c.acheteur.id) : null)],
      "Enregistrer")) : null,
    ["brouillon", "approuvee"].includes(c.statut) && gere ? h("details", { class: "carte pas-imprimer" }, h("summary", {}, "Annuler la commande"), formulaire(async (v) => {
      await api("POST", `/achats/commandes/${id}/annulation`, { motif: v.motif.trim() });
      relire("Commande annulée.");
    }, [champ("Motif (obligatoire)", { name: "motif", required: true, minlength: 3 })], "Confirmer l'annulation")) : null,
  );
}

async function ecranMouvements(n) {
  const m = await api("GET", `/stocks/mouvements?produitId=${n.produit_id}&entiteId=${n.entite_id}`);
  vue(
    h("button", { class: "discret", onclick: () => ecranStocks() }, "← Stocks"),
    h("h1", {}, n.nom),
    h("p", { class: "discret-texte" }, `${n.entite} · ${quantiteFr(n.quantite)} ${n.unite}`),
    h("div", { class: "carte" }, m.map((x) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, x.type.replace("_", " ")), h("span", {}, `${x.quantite > 0 ? "+" : ""}${quantiteFr(x.quantite)}`)),
      h("div", { class: "discret-texte" }, `${heure(x.cree_le)} · ${x.auteur}${x.document ? ` · ${x.document}` : ""}${x.motif ? ` · ${x.motif}` : ""}`)))),
  );
}

async function ecranAcces(message) {
  const [utilisateurs, roles, entites] = await Promise.all([api("GET", "/utilisateurs"), api("GET", "/roles"), api("GET", "/entites")]);
  const choixRoles = roles.map((r) => [r.id, r.nom]);
  const choixEntites = [["", "Toute l'organisation"], ...entites.map((e) => [e.id, e.nom])];
  const relire = (m) => ecranAcces(m);
  vue(
    h("h1", {}, "Accès des collaborateurs"),
    h("button", { class: "discret", onclick: () => ecranSeparation() }, "Séparation des tâches"),
    h("p", { class: "discret-texte" }, "Chaque accès associe un rôle à une entité. Un collaborateur de GTA ne voit jamais les stocks de GLOMARI, et inversement."),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, utilisateurs.map((u) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, u.nom), u.actif ? null : h("span", { class: "pastille retard" }, "Désactivé")),
      h("div", { class: "discret-texte" }, u.email),
      u.acces.map((a) => h("div", { class: "ligne" },
        h("span", {}, `${a.role} : ${a.entite || "toute l'organisation"}${a.expire_le ? ` · jusqu'au ${dateFr(new Date(new Date(a.expire_le).getTime() - 1).toISOString().slice(0, 10))}` : ""}`),
        h("button", { class: "danger", onclick: async () => { await api("DELETE", `/acces/${a.id}`); relire("Accès retiré."); } }, "Retirer"))),
      h("details", {}, h("summary", {}, "Ajouter un accès ou une délégation"), formulaire(async (v) => {
        await api("POST", `/utilisateurs/${u.id}/acces`, { roleId: v.roleId, entiteId: v.entiteId || undefined, expireLe: v.expire || undefined });
        relire("Accès ajouté.");
      }, [h("div", { class: "grille" }, choix("roleId", "Rôle", choixRoles), choix("entiteId", "Entité", choixEntites), champ("Fin de la délégation, facultatif", { name: "expire", type: "date" }))], "Ajouter l'accès")),
      h("details", {}, h("summary", {}, "Changer le mot de passe"), formulaire(async (v) => {
        await api("PATCH", `/utilisateurs/${u.id}`, { motDePasse: v.mdp });
        relire("Mot de passe changé. Les sessions de cette personne sont fermées.");
      }, [champ("Nouveau mot de passe, 8 caractères minimum", { name: "mdp", type: "password", minlength: 8, required: true, autocomplete: "new-password" })], "Enregistrer")),
      h("div", { class: "actions" }, h("button", { class: u.actif ? "danger" : "discret", onclick: async () => {
        await api("PATCH", `/utilisateurs/${u.id}`, { actif: !u.actif });
        relire(u.actif ? "Compte désactivé." : "Compte réactivé.");
      } }, u.actif ? "Désactiver le compte" : "Réactiver le compte"))))),
    h("div", { class: "carte" }, h("h2", {}, "Nouveau collaborateur"), formulaire(async (v) => {
      await api("POST", "/utilisateurs", { nom: v.nom.trim(), email: v.email.trim(), motDePasse: v.mdp, roleId: v.roleId, entiteId: v.entiteId || undefined });
      relire(`Compte créé pour ${v.nom.trim()}.`);
    }, [h("div", { class: "grille" },
      champ("Nom", { name: "nom", required: true }),
      champ("E-mail", { name: "email", type: "email", required: true }),
      champ("Mot de passe provisoire, 8 caractères minimum", { name: "mdp", type: "password", minlength: 8, required: true, autocomplete: "new-password" }),
      choix("roleId", "Rôle", choixRoles), choix("entiteId", "Entité", choixEntites))], "Créer le compte")),
  );
}

async function ecranMagasins(message) {
  const [magasins, parents] = await Promise.all([api("GET", "/magasins"), entitesPour("achats_stocks")]);
  vue(
    h("h1", {}, "Magasins et points de vente"),
    h("p", { class: "discret-texte" }, "Chaque nouveau lieu a son propre stock. Les transferts, réceptions d'achats et ventes confirmés le mettent à jour automatiquement."),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, magasins.length ? magasins.map((m) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, m.nom), m.actif ? h("span", { class: "pastille ok" }, m.type === "entrepot" ? "Entrepôt" : "Point de vente") : h("span", { class: "pastille retard" }, "Désactivé")),
      h("div", { class: "discret-texte" }, `${m.code} · Stock total : ${quantiteFr(m.quantite)}`),
      h("div", { class: "actions" }, h("button", { class: m.actif ? "danger" : "discret", onclick: async () => {
        await api("PATCH", `/magasins/${m.id}`, { actif: !m.actif });
        ecranMagasins(m.actif ? "Magasin désactivé." : "Magasin réactivé.");
      } }, m.actif ? "Désactiver" : "Réactiver"))))
      : h("p", { class: "discret-texte" }, "Aucun magasin pour le moment.")),
    h("div", { class: "carte" }, h("h2", {}, "Nouveau magasin ou point de vente"), formulaire(async (v) => {
      const m = await api("POST", "/magasins", { parentId: v.parentId, nom: v.nom.trim(), type: v.type });
      ecranMagasins(`${m.nom} est créé.`);
    }, [h("div", { class: "grille" },
      champ("Nom", { name: "nom", required: true }),
      choix("type", "Type", [["point_de_vente", "Magasin ou point de vente"], ["entrepot", "Entrepôt"]]),
      choix("parentId", "Rattaché à", parents))], "Créer")),
  );
}
