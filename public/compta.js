"use strict";
/* Comptabilité SYSCOHADA, par branche. */
const debutAnnee = () => `${aujourdhui().slice(0, 4)}-01-01`;
const nombreFr = (n) => Number(n).toLocaleString("fr-FR");

let branchesCompta = [];
async function brancheCompta() {
  branchesCompta = await api("GET", "/compta/branches");
  const choisie = lireLocal(localStorage, "smarte.branche.compta", "");
  return branchesCompta.find((b) => b.id === choisie) ?? branchesCompta.find((b) => b.domaine === espaceCourant()) ?? branchesCompta[0];
}

function menuCompta(b, actif) {
  const o = [["Tableau", () => ecranCompta()], ["Écritures", () => ecranEcritures(b)], ["Nouvelle écriture", () => ecranSaisie(b)], ["Balance", () => ecranBalance(b)], ["Grand livre", () => ecranGrandLivre(b)], ["États", () => ecranEtats(b)], ["Fournisseurs", () => ecranFournisseurs(b)], ["Immobilisations", () => ecranImmobilisations(b)], ["États officiels", () => ecranEtatsOfficiels(b)], ["DSF", () => ecranDsf(b)], ["Fiscalité", () => ecranFiscal(b)], ["Budget", () => ecranBudget(b)], ["Groupe", () => ecranGroupe(b)], ["Clôtures", () => ecranClotures(b)], ["Plan et réglages", () => ecranPlan(b)]];
  return h("div", { class: "actions pas-imprimer" }, branchesCompta.length > 1 ? h("select", { "aria-label": "Branche comptable", onchange: (e) => { ecrireLocal(localStorage, "smarte.branche.compta", e.target.value); ecranCompta(); } }, branchesCompta.map((x) => h("option", { value: x.id, selected: x.id === b.id }, x.nom))) : null, o.map(([t, f]) => h("button", { class: t === actif ? "" : "discret", onclick: f }, t)));
}

async function ecranCompta(message) {
  const b = await brancheCompta();
  if (!b) return vue(h("h1", {}, "Comptabilité"), h("p", { class: "discret-texte" }, "Aucune comptabilité accessible dans cet espace."));
  const c = await api("GET", `/compta/controles?brancheId=${b.id}`);
  if (!c.initialisee) {
    return vue(h("h1", {}, `Comptabilité : ${b.nom}`), message ? h("div", { class: "succes" }, message) : null,
      h("div", { class: "carte" }, h("h2", {}, "Installer le plan comptable"),
        h("p", {}, "Le plan SYSCOHADA de départ, les journaux et les comptes proposés sont à faire valider par votre expert comptable. Tout reste modifiable."),
        droits.includes("compta.cloturer") ? formulaire(async () => {
          await api("POST", "/compta/initialisation", { brancheId: b.id });
          ecranCompta("Plan comptable installé.");
        }, [], "Installer") : h("p", { class: "discret-texte" }, "Demandez au responsable comptable de l'installer.")));
  }
  vue(
    h("h1", {}, `Comptabilité : ${b.nom}`),
    menuCompta(b, "Tableau"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, h("h2", {}, "Points à examiner"), c.points.length ? c.points.map((p) => h("div", { class: p.niveau === "action" ? "apprenant" : "alerte-caisse" }, p.texte))
      : h("p", { class: "discret-texte" }, "Aucun point pour le moment.")),
    droits.includes("compta.saisir") ? h("div", { class: "carte" }, h("h2", {}, "Préparer les écritures"),
      h("p", { class: "discret-texte" }, "Les factures, règlements, reçus, ventes et mouvements de trésorerie deviennent des brouillons. Ils ne comptent qu'après votre validation."),
      formulaire(async (v) => {
        const r = await api("POST", "/compta/generation", { brancheId: b.id, fin: v.fin });
        ecranEcritures(b, `${r.crees} brouillon(s) préparé(s).`);
      }, [champ("Jusqu'au", { name: "fin", type: "date", value: aujourdhui(), required: true })], "Préparer")) : null,
  );
}

function blocEcriture(e, b) {
  const t = e.lignes.reduce((s, l) => s + l.debit, 0);
  return h("details", { class: "apprenant" },
    h("summary", {}, `${dateFr(e.date_ecriture)} · ${e.journal} · ${e.libelle} · ${fcfa(t)}`),
    h("div", { class: "defilant" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Compte"), h("th", { class: "nombre" }, "Débit"), h("th", { class: "nombre" }, "Crédit"))),
      h("tbody", {}, e.lignes.map((l) => h("tr", {}, h("td", {}, `${l.numero} ${l.libelle}${l.tiers ? ` · ${l.tiers}` : ""}${l.section ? ` · ${l.section}` : ""}`), h("td", { class: "nombre" }, l.debit ? nombreFr(l.debit) : ""), h("td", { class: "nombre" }, l.credit ? nombreFr(l.credit) : "")))))),
    e.numero ? h("p", { class: "discret-texte" }, `N° ${e.numero}${e.contrepassee ? " · Contre-passée" : ""}`) : null,
    e.statut === "brouillon" && droits.includes("compta.saisir") ? h("div", { class: "actions" },
      h("button", { class: "discret", onclick: () => ecranSaisie(b, e) }, "Corriger"),
      h("button", { class: "danger", onclick: async () => { await api("DELETE", `/compta/ecritures/${e.id}`); ecranEcritures(b, "Brouillon supprimé."); } }, "Supprimer")) : null,
    e.statut === "validee" && !e.contrepassee && droits.includes("compta.saisir") ? h("details", {}, h("summary", {}, "Contre-passer"), formulaire(async (v) => {
      await api("POST", `/compta/ecritures/${e.id}/contrepassation`, { date: v.date, motif: v.motif.trim() });
      ecranEcritures(b, "Écriture inverse créée en brouillon.");
    }, [champ("Date", { name: "date", type: "date", value: aujourdhui(), required: true }), champ("Motif", { name: "motif", required: true, minlength: 5 })], "Créer l'écriture inverse")) : null);
}

async function ecranEcritures(b, message) {
  const [brouillons, validees] = await Promise.all([api("GET", `/compta/ecritures?brancheId=${b.id}&statut=brouillon`), api("GET", `/compta/ecritures?brancheId=${b.id}&statut=validee`)]);
  vue(
    h("h1", {}, "Écritures"), menuCompta(b, "Écritures"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, h("h2", {}, `Brouillons (${brouillons.length})`), brouillons.map((e) => blocEcriture(e, b)),
      brouillons.length && droits.includes("compta.valider") ? h("div", {},
        h("p", { class: "discret-texte" }, "Une écriture validée ne se modifie plus et ne se supprime plus. Une erreur se corrigera par une écriture inverse."),
        formulaire(async () => {
          const r = await api("POST", "/compta/ecritures/validation", { ids: brouillons.map((e) => e.id) });
          ecranEcritures(b, `${r.validees} écriture(s) validée(s).`);
        }, [], "Valider tous les brouillons")) : null),
    h("div", { class: "carte" }, h("h2", {}, "Écritures validées"), validees.length ? validees.map((e) => blocEcriture(e, b)) : h("p", { class: "discret-texte" }, "Aucune.")),
  );
}

/** Une ligne par compte : "numéro ; débit ; crédit ; section". */
const lireLignesCompta = (texte, anciennes = []) => texte.split("\n").map((x) => x.trim()).filter(Boolean).map((x) => {
  const [numero, debit, credit, section] = x.split(";").map((y) => y.trim());
  const avant = anciennes.find((a) => a.numero === numero);
  return { numero, debit: Number(debit || 0) || undefined, credit: Number(credit || 0) || undefined, section: section || undefined, tiersId: avant?.tiersId || undefined };
});

async function ecranSaisie(b, e) {
  const r = await api("GET", `/compta/referentiel?brancheId=${b.id}`);
  const liste = h("datalist", { id: "liste-comptes" }, r.comptes.filter((c) => c.actif).map((c) => h("option", { value: c.numero }, c.libelle)));
  const zone = h("textarea", { name: "lignes", rows: 6, required: true, list: "liste-comptes" });
  zone.value = e ? e.lignes.map((l) => `${l.numero} ; ${l.debit || ""} ; ${l.credit || ""} ; ${l.section || ""}`).join("\n") : "";
  vue(
    h("h1", {}, e ? "Corriger le brouillon" : "Nouvelle écriture"), menuCompta(b, "Nouvelle écriture"),
    h("div", { class: "carte" }, formulaire(async (v) => {
      const lignes = lireLignesCompta(v.lignes, e?.lignes);
      if (e) await api("PUT", `/compta/ecritures/${e.id}`, { date: v.date, libelle: v.libelle.trim(), piece: v.piece.trim() || undefined, lignes });
      else await api("POST", "/compta/ecritures", { brancheId: b.id, journal: v.journal, date: v.date, libelle: v.libelle.trim(), piece: v.piece.trim() || undefined, lignes });
      ecranEcritures(b, "Brouillon enregistré.");
    }, [h("div", { class: "grille" },
      e ? null : choix("journal", "Journal", r.journaux.map((j) => [j.code, `${j.code} ${j.libelle}`])),
      champ("Date", { name: "date", type: "date", value: e?.date_ecriture || aujourdhui(), required: true }), champ("Libellé", { name: "libelle", value: e?.libelle || "", required: true, minlength: 3 }), champ("Pièce justificative", { name: "piece", value: e?.piece || "" })),
    h("label", {}, "Lignes, une par compte : numéro ; débit ; crédit ; section (facultative)", zone),
    h("details", {}, h("summary", {}, "Voir les comptes"), liste, r.comptes.filter((c) => c.actif).map((c) => h("div", { class: "discret-texte" }, `${c.numero} ${c.libelle}`)))], "Enregistrer le brouillon")),
  );
}

const filtrePeriode = (rappel, d = {}) => h("div", { class: "carte pas-imprimer" }, formulaire(async (v) => rappel(v), [h("div", { class: "grille" },
  champ("Du", { name: "debut", type: "date", value: d.debut || debutAnnee(), required: true }), champ("Au", { name: "fin", type: "date", value: d.fin || aujourdhui(), required: true }),
  d.avecCompte ? champ("Compte (début du numéro)", { name: "compte", value: d.compte || "" }) : null)], "Afficher"));

async function ecranBalance(b, p = {}) {
  const debut = p.debut || debutAnnee();
  const fin = p.fin || aujourdhui();
  const r = await api("GET", `/compta/balance?brancheId=${b.id}&debut=${debut}&fin=${fin}`);
  vue(h("h1", {}, "Balance générale"), menuCompta(b, "Balance"), filtrePeriode((v) => ecranBalance(b, v), { debut, fin }),
    h("div", { class: "actions pas-imprimer" }, h("button", { class: "discret", onclick: () => window.print() }, "Imprimer"), h("button", { class: "discret", onclick: () => telechargerCompta(b, debut, fin) }, "Exporter le journal")),
    h("div", { class: "carte defilant" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Compte"), h("th", { class: "nombre" }, "Débit"), h("th", { class: "nombre" }, "Crédit"), h("th", { class: "nombre" }, "Solde"))),
      h("tbody", {}, r.lignes.map((l) => h("tr", {}, h("td", {}, `${l.numero} ${l.libelle}`), h("td", { class: "nombre" }, nombreFr(l.debit)), h("td", { class: "nombre" }, nombreFr(l.credit)), h("td", { class: "nombre" }, nombreFr(l.debit - l.credit)))),
        h("tr", {}, h("th", {}, "Total"), h("th", { class: "nombre" }, nombreFr(r.debit)), h("th", { class: "nombre" }, nombreFr(r.credit)), h("th", {}))))));
}

async function telechargerCompta(b, debut, fin) {
  const r = await fetch(`/compta/export?brancheId=${b.id}&debut=${debut}&fin=${fin}`, { headers: { authorization: `Bearer ${jeton}` } });
  if (!r.ok) throw Object.assign(new Error(), { code: "inconnue" });
  const url = URL.createObjectURL(await r.blob());
  const a = h("a", { href: url, download: `Journal comptable ${b.nom} ${debut} ${fin}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function ecranGrandLivre(b, p = {}) {
  const debut = p.debut || debutAnnee();
  const fin = p.fin || aujourdhui();
  const q = new URLSearchParams({ brancheId: b.id, debut, fin, ...(p.compte ? { compte: p.compte } : {}) });
  const lignes = await api("GET", `/compta/grand-livre?${q}`);
  const groupes = new Map();
  for (const l of lignes) groupes.set(l.numero, [...(groupes.get(l.numero) || []), l]);
  vue(h("h1", {}, "Grand livre"), menuCompta(b, "Grand livre"), filtrePeriode((v) => ecranGrandLivre(b, v), { debut, fin, compte: p.compte, avecCompte: true }),
    groupes.size ? [...groupes].map(([numero, ls]) => {
      let solde = 0;
      return h("div", { class: "carte defilant" }, h("h2", {}, `${numero} ${ls[0].compte}`), h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Date"), h("th", {}, "Écriture"), h("th", { class: "nombre" }, "Débit"), h("th", { class: "nombre" }, "Crédit"), h("th", { class: "nombre" }, "Solde"))),
        h("tbody", {}, ls.map((l) => { solde += l.debit - l.credit; return h("tr", {}, h("td", {}, dateFr(l.date_ecriture)), h("td", {}, `${l.ecriture} ${l.libelle}${l.tiers ? ` · ${l.tiers}` : ""}`), h("td", { class: "nombre" }, l.debit ? nombreFr(l.debit) : ""), h("td", { class: "nombre" }, l.credit ? nombreFr(l.credit) : ""), h("td", { class: "nombre" }, nombreFr(solde))); }))));
    }) : h("p", { class: "discret-texte" }, "Aucune écriture validée."));
}

async function ecranEtats(b, p = {}) {
  const debut = p.debut || debutAnnee();
  const fin = p.fin || aujourdhui();
  const q = `brancheId=${b.id}&debut=${debut}&fin=${fin}`;
  const [e, ana, tva] = await Promise.all([api("GET", `/compta/etats?${q}`), api("GET", `/compta/analytique?${q}`), api("GET", `/compta/tva?${q}`)]);
  const table = (titre, ls, total) => h("div", { class: "carte" }, h("h2", {}, titre), ls.map((l) => h("div", { class: "ligne apprenant" }, h("span", {}, `Comptes ${l.rubrique}`), h("span", {}, nombreFr(l.montant)))), total !== undefined ? h("p", { class: "totaux grand" }, `Total : ${fcfa(total)}`) : null);
  vue(h("h1", {}, "États de synthèse"), menuCompta(b, "États"), filtrePeriode((v) => ecranEtats(b, v), { debut, fin }),
    h("div", { class: "alerte-caisse" }, "Synthèse de contrôle, à partir des écritures validées. Ce n'est ni le modèle officiel OHADA, ni la DSF, qui restent à établir et à faire signer par votre expert comptable."),
    e.equilibre ? null : h("div", { class: "erreur", role: "alert" }, "Le bilan n'est pas équilibré sur cette période : des à-nouveaux manquent peut-être."),
    h("div", { class: "chiffres" }, h("div", { class: "chiffre" }, h("b", {}, fcfa(e.resultat)), h("span", {}, "Résultat")), h("div", { class: "chiffre" }, h("b", {}, fcfa(tva.solde)), h("span", {}, "TVA collectée moins récupérable"))),
    table("Produits", e.produits), table("Charges", e.charges), table("Actif", e.actif, e.totalActif), table("Passif, résultat compris", e.passif, e.totalPassif),
    h("div", { class: "carte" }, h("h2", {}, "Par activité"), ana.length ? ana.map((a) => h("div", { class: "ligne apprenant" }, h("span", {}, a.section), h("span", {}, `${nombreFr(a.produits)} − ${nombreFr(a.charges)} = ${nombreFr(a.produits - a.charges)}`))) : h("p", { class: "discret-texte" }, "Aucune donnée.")));
}

async function ecranClotures(b, message) {
  const r = await api("GET", `/compta/referentiel?brancheId=${b.id}`);
  const gere = droits.includes("compta.cloturer");
  vue(h("h1", {}, "Clôtures"), menuCompta(b, "Clôtures"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    gere ? h("div", { class: "carte" }, h("h2", {}, "Clôturer un mois"),
      h("p", { class: "discret-texte" }, "Une clôture définitive ne se rouvre jamais. L'Acte uniforme demande une clôture au moins chaque trimestre."),
      formulaire(async (v) => {
        await api("POST", "/compta/clotures", { brancheId: b.id, mois: v.mois, definitive: v.definitive === "oui" });
        ecranClotures(b, "Mois clôturé.");
      }, [h("div", { class: "grille" }, champ("Mois", { name: "mois", type: "month", required: true }), choix("definitive", "Clôture", [["non", "Mensuelle, réouverture possible"], ["oui", "Définitive"]]))], "Clôturer")) : null,
    h("div", { class: "carte" }, h("h2", {}, "Mois clôturés"), r.clotures.length ? r.clotures.map((c) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, c.mois), h("span", { class: c.definitive ? "pastille ok" : "pastille attente" }, c.definitive ? "Définitive" : "Réouverture possible")),
      gere && !c.definitive ? h("details", {}, h("summary", {}, "Rouvrir"), formulaire(async (v) => {
        await api("POST", "/compta/clotures/reouverture", { brancheId: b.id, mois: c.mois, motif: v.motif.trim() });
        ecranClotures(b, "Mois rouvert.");
      }, [champ("Motif", { name: "motif", required: true, minlength: 5 })], "Rouvrir")) : null)) : h("p", { class: "discret-texte" }, "Aucun.")),
    gere ? h("details", { class: "carte" }, h("summary", {}, "Clôturer l'exercice"), h("p", { class: "discret-texte" }, "Tous les mois doivent être clôturés définitivement. Un brouillon d'à-nouveaux est créé pour l'année suivante. Faites d'abord vos écritures d'inventaire avec l'expert comptable."),
      formulaire(async (v) => {
        const x = await api("POST", "/compta/exercices/cloture", { brancheId: b.id, annee: Number(v.annee) });
        ecranClotures(b, `Exercice ${x.annee} clos. Résultat : ${fcfa(x.resultat)}.`);
      }, [champ("Année", { name: "annee", type: "number", required: true, value: Number(aujourdhui().slice(0, 4)) - 1 })], "Clôturer l'exercice")) : null,
    r.exercices.length ? h("div", { class: "carte" }, h("h2", {}, "Exercices clos"), r.exercices.map((x) => h("div", { class: "ligne apprenant" }, h("span", {}, String(x.annee)), h("span", {}, fcfa(x.resultat))))) : null,
  );
}

const LIBELLES_PARAMETRES = { clients: "Clients", ventes_marchandises: "Ventes de marchandises", ventes_services: "Ventes de services", formations: "Reçus de formation", tva_collectee: "TVA collectée", especes: "Espèces", orange_money: "Orange Money", mtn_momo: "MTN MoMo", virement: "Virement", cheque: "Chèque", carte: "Carte", banque: "Banque", autre: "Autre portefeuille", virements_internes: "Virements internes", frais_bancaires: "Frais de transfert", fournisseurs: "Fournisseurs", fournisseurs_investissement: "Fournisseurs d'investissements", tva_recuperable: "TVA récupérable", creances_cessions: "Créances sur cessions", valeur_cession: "Valeur comptable des cessions", produit_cession: "Produit des cessions", attente: "Dépenses à imputer", fidelite: "Points de fidélité" };

async function ecranPlan(b, message) {
  const r = await api("GET", `/compta/referentiel?brancheId=${b.id}`);
  const gere = droits.includes("compta.cloturer");
  vue(h("h1", {}, "Plan et réglages"), menuCompta(b, "Plan et réglages"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "alerte-caisse" }, "À faire valider par l'expert comptable avant toute écriture réelle, surtout : les reçus de formation, les points de fidélité et la TVA sur services."),
    h("div", { class: "carte" }, h("h2", {}, "Comptes utilisés automatiquement"), Object.entries(LIBELLES_PARAMETRES).map(([cle, l]) => h("label", {}, l, h("select", { disabled: !gere, onchange: async (e) => {
      await api("PUT", "/compta/parametres", { brancheId: b.id, cle, numero: e.target.value });
      ecranPlan(b, `${l} : compte ${e.target.value}.`);
    } }, r.comptes.filter((c) => c.actif).map((c) => h("option", { value: c.numero, selected: r.parametres[cle] === c.numero }, `${c.numero} ${c.libelle}`)))))),
    gere ? h("details", { class: "carte" }, h("summary", {}, "Ajouter un compte"), formulaire(async (v) => {
      await api("POST", "/compta/comptes", { brancheId: b.id, numero: v.numero.trim(), libelle: v.libelle.trim() });
      ecranPlan(b, "Compte ajouté.");
    }, [h("div", { class: "grille" }, champ("Numéro", { name: "numero", required: true, pattern: "[1-9][0-9]{1,11}" }), champ("Libellé", { name: "libelle", required: true }))], "Ajouter")) : null,
    h("details", { class: "carte" }, h("summary", {}, `Plan comptable (${r.comptes.length} comptes)`), r.comptes.map((c) => h("div", { class: "discret-texte" }, `${c.numero} ${c.libelle}`))));
}

const anneeCompta = () => Number(aujourdhui().slice(0, 4));

async function ecranFournisseurs(b, message) {
  const [factures, tiers, ref] = await Promise.all([api("GET", `/fournisseurs/factures?brancheId=${b.id}`), api("GET", "/tiers"), api("GET", `/compta/referentiel?brancheId=${b.id}`)]);
  const achats = ref.comptes.filter((c) => c.actif && /^[236]/.test(c.numero) && c.numero.length > 2);
  const auj = aujourdhui();
  const ouvertes = factures.filter((f) => f.statut === "validee" && f.paye < f.total_ttc);
  const total = ouvertes.reduce((s, f) => s + f.total_ttc - f.paye, 0);
  const retard = ouvertes.filter((f) => f.date_echeance && f.date_echeance < auj).reduce((s, f) => s + f.total_ttc - f.paye, 0);
  vue(h("h1", {}, "Factures fournisseurs"), menuCompta(b, "Fournisseurs"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "chiffres" }, h("div", { class: "chiffre" }, h("b", {}, fcfa(total)), h("span", {}, "Reste à payer")), h("div", { class: "chiffre" }, h("b", {}, fcfa(retard)), h("span", {}, "Dont en retard"))),
    h("div", { class: "carte" }, h("h2", {}, "Factures"), factures.length ? factures.map((f) => h("button", { class: "session", onclick: () => ecranFactureFournisseur(b, f.id) },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${f.fournisseur} : ${f.numero_fournisseur}`), h("span", { class: f.statut === "annulee" ? "pastille retard" : f.statut === "brouillon" ? "pastille attente" : f.paye >= f.total_ttc ? "pastille ok" : "pastille attente" }, f.statut === "validee" ? (f.paye >= f.total_ttc ? "Payée" : "À payer") : f.statut)),
      h("div", { class: "discret-texte" }, `${fcfa(f.total_ttc)} · Payé ${fcfa(f.paye)}${f.date_echeance ? ` · Échéance ${dateFr(f.date_echeance)}` : ""}${f.niu_fournisseur ? "" : " · Sans NIU : charge à vérifier"}${f.especes_100k ? " · Espèces : charge non déductible" : ""}`))) : h("p", { class: "discret-texte" }, "Aucune facture.")),
    droits.includes("compta.saisir") ? h("details", { class: "carte" }, h("summary", {}, "Saisir une facture"), formulaire(async (v) => {
      const f = await api("POST", "/fournisseurs/factures", {
        entiteId: b.id, fournisseurId: v.fournisseur, numeroFournisseur: v.numero.trim(), date: v.date, echeance: v.echeance || undefined, niu: v.niu.trim() || undefined,
        lignes: [{ designation: v.designation.trim(), compte: v.compte, montantHt: Number(v.ht), montantTaxes: Number(v.taxes || 0) }],
      });
      ecranFactureFournisseur(b, f.id, "Facture enregistrée en brouillon.");
    }, [h("div", { class: "grille" }, choix("fournisseur", "Fournisseur", tiers.map((t) => [t.id, t.nom])), champ("Numéro de sa facture", { name: "numero", required: true }), champ("NIU du fournisseur", { name: "niu" }),
      champ("Date", { name: "date", type: "date", value: auj, required: true }), champ("Échéance", { name: "echeance", type: "date" }), champ("Désignation", { name: "designation", required: true }),
      choix("compte", "Compte", achats.map((c) => [c.numero, `${c.numero} ${c.libelle}`])), champ("Montant HT (FCFA)", { name: "ht", type: "number", min: 1, required: true }), champ("TVA ou taxes (FCFA)", { name: "taxes", type: "number", min: 0 }))], "Enregistrer")) : null);
}

async function ecranFactureFournisseur(b, id, message) {
  const [f, wallets] = await Promise.all([api("GET", `/fournisseurs/factures/${id}`), api("GET", "/portefeuilles").catch(() => [])]);
  const valide = droits.includes("compta.valider");
  const reste = f.total_ttc - f.paye;
  const utilisables = wallets.filter((w) => w.actif && w.branche === b.id);
  vue(h("button", { class: "discret", onclick: () => ecranFournisseurs(b) }, "← Factures fournisseurs"), h("h1", {}, `${f.fournisseur} : ${f.numero_fournisseur}`),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    f.niu_fournisseur ? null : h("div", { class: "alerte-caisse" }, "Sans NIU sur la facture, la charge peut ne pas être déductible, sauf fournisseur étranger (CGI art. 8 bis)."),
    h("div", { class: "alerte-caisse" }, "Vérifiez aussi que cette facture est bien émise via le système électronique de l'administration fiscale, si le fournisseur y est soumis (CGI art. 8 bis)."),
    h("div", { class: "carte" }, h("p", { class: "grand" }, fcfa(f.total_ttc)), h("p", { class: "discret-texte" }, `${f.numero || "Brouillon"} · Du ${dateFr(f.date_facture)} · Reste ${fcfa(reste)}`),
      f.lignes.map((l) => h("div", { class: "ligne apprenant" }, h("span", {}, `${l.compte_numero} ${l.designation}`), h("span", {}, nombreFr(l.montant_ht + l.montant_taxes)))),
      f.controle.statut !== "sans_commande" ? h("p", {}, `Contrôle commande et réception : ${{ conforme: "conforme", ecart: `écart de ${fcfa(f.controle.ecart)}`, non_recu: "rien de reçu" }[f.controle.statut]}`) : null),
    f.statut === "brouillon" && valide ? h("div", { class: "carte" }, formulaire(async (v) => {
      await api("POST", `/fournisseurs/factures/${id}/validation`, { motifEcart: v.motif?.trim() || undefined });
      ecranFactureFournisseur(b, id, "Facture validée.");
    }, [["ecart", "non_recu"].includes(f.controle.statut) ? champ("Motif de l'écart", { name: "motif", required: true, minlength: 5 }) : null], "Valider la facture")) : null,
    f.statut === "validee" && reste > 0 && valide ? h("div", { class: "carte" }, h("h2", {}, "Payer"), utilisables.length ? formulaire(async (v) => {
      const r = await api("POST", `/fournisseurs/factures/${id}/paiements`, { portefeuilleId: v.p, montant: Number(v.m), date: v.d, reference: v.r.trim() || undefined });
      ecranFactureFournisseur(b, id, r.alerte_especes ? "Paiement enregistré. Attention : 100 000 FCFA ou plus en espèces rendent la charge non déductible." : "Paiement enregistré.");
    }, [h("div", { class: "grille" }, choix("p", "Depuis", utilisables.map((w) => [w.id, `${w.nom} (${fcfa(w.solde)})`])), champ("Montant", { name: "m", type: "number", min: 1, max: reste, value: reste, required: true }), champ("Date", { name: "d", type: "date", value: aujourdhui(), required: true }), champ("Référence", { name: "r" }))], "Payer") : h("p", { class: "discret-texte" }, "Aucun portefeuille accessible.")) : null,
    f.paiements.length ? h("div", { class: "carte" }, h("h2", {}, "Paiements"), f.paiements.map((p) => h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", {}, `${dateFr(p.date_paiement)} · ${p.portefeuille}`), h("span", {}, fcfa(p.montant))), p.annule_le ? h("span", { class: "pastille retard" }, "Annulé") : valide ? h("details", {}, h("summary", {}, "Annuler"), formulaire(async (v) => { await api("POST", `/fournisseurs/paiements/${p.id}/annulation`, { motif: v.motif.trim() }); ecranFactureFournisseur(b, id, "Paiement annulé."); }, [champ("Motif", { name: "motif", required: true, minlength: 5 })], "Confirmer")) : null))) : null,
    f.statut !== "annulee" && f.paye === 0 && valide ? h("details", { class: "carte" }, h("summary", {}, "Annuler la facture"), formulaire(async (v) => { await api("POST", `/fournisseurs/factures/${id}/annulation`, { motif: v.motif.trim() }); ecranFournisseurs(b, "Facture annulée."); }, [champ("Motif", { name: "motif", required: true, minlength: 5 })], "Confirmer")) : null);
}

async function ecranImmobilisations(b, annee = anneeCompta(), message) {
  const [liste, cat] = await Promise.all([api("GET", `/immobilisations?brancheId=${b.id}&annee=${annee}`), api("GET", "/immobilisations/categories")]);
  const saisir = droits.includes("compta.saisir");
  vue(h("h1", {}, "Immobilisations"), menuCompta(b, "Immobilisations"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("label", {}, "Année", h("input", { type: "number", value: annee, onchange: (e) => ecranImmobilisations(b, Number(e.target.value)) })),
    h("div", { class: "carte" }, h("h2", {}, "Registre"), liste.length ? liste.map((i) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${i.code} : ${i.designation}`), i.cession_le ? h("span", { class: "pastille retard" }, "Cédé") : null),
      h("div", { class: "discret-texte" }, `Coût ${fcfa(i.cout)} · Dotation ${annee} ${fcfa(i.dotation_annee)} · Cumul ${fcfa(i.amorti_cumule)} · Net ${fcfa(i.valeur_nette)} · ${i.duree_mois} mois${i.taux_fiscal === null ? " · Taux fiscal à préciser" : ` · Taux fiscal ${Number(i.taux_fiscal)} %`}`),
      !i.cession_le && droits.includes("compta.valider") ? h("details", {}, h("summary", {}, "Céder"), formulaire(async (v) => { await api("POST", `/immobilisations/${i.id}/cession`, { date: v.date, prix: Number(v.prix) }); ecranImmobilisations(b, annee, "Cession enregistrée."); }, [h("div", { class: "grille" }, champ("Date", { name: "date", type: "date", required: true }), champ("Prix (FCFA)", { name: "prix", type: "number", min: 0, required: true }))], "Confirmer")) : null)) : h("p", { class: "discret-texte" }, "Aucun bien.")),
    saisir ? h("div", { class: "carte" }, h("h2", {}, `Dotations ${annee}`), formulaire(async () => {
      const r = await api("POST", "/immobilisations/dotations", { brancheId: b.id, annee });
      ecranImmobilisations(b, annee, `${r.crees} dotation(s) enregistrée(s). Préparez ensuite les écritures depuis le tableau comptable.`);
    }, [], "Calculer les dotations")) : null,
    saisir ? h("details", { class: "carte" }, h("summary", {}, "Ajouter un bien"), h("p", { class: "discret-texte" }, "Le CGI ne fait pas passer à l'actif le petit matériel de moins de 500 000 FCFA. La durée d'utilité est votre estimation, le taux fiscal est le plafond déductible."), formulaire(async (v) => {
      const r = await api("POST", "/immobilisations", { brancheId: b.id, code: v.code.trim(), designation: v.designation.trim(), categorie: v.categorie, dateAcquisition: v.acq, dateService: v.service, cout: Number(v.cout), valeurResiduelle: Number(v.vr || 0), dureeMois: Number(v.duree), tauxFiscal: v.taux ? Number(v.taux) : undefined });
      ecranImmobilisations(b, annee, r.alerte_petit_materiel ? "Bien ajouté. Attention : moins de 500 000 FCFA, à vérifier avec l'expert." : "Bien ajouté.");
    }, [h("div", { class: "grille" }, champ("Code", { name: "code", required: true }), champ("Désignation", { name: "designation", required: true }), choix("categorie", "Catégorie", Object.entries(cat).map(([k, c]) => [k, `${c.libelle}${c.tauxCgi ? ` (CGI ${c.tauxCgi} %)` : ""}`])),
      champ("Acquisition", { name: "acq", type: "date", required: true }), champ("Mise en service", { name: "service", type: "date", required: true }), champ("Coût (FCFA)", { name: "cout", type: "number", min: 1, required: true }), champ("Valeur résiduelle", { name: "vr", type: "number", min: 0 }), champ("Durée (mois)", { name: "duree", type: "number", min: 1, required: true }), champ("Taux fiscal, si différent", { name: "taux", type: "number", min: 0, max: 100, step: 0.01 }))], "Ajouter")) : null);
}

function tableEtat(libelles, lignes, colonnes) {
  const estTotal = (r) => /^(A[DIQZ]|B[GKTZ]|C[P]|D[DFPTZ]|X.|Z.)$/.test(r);
  return h("div", { class: "defilant" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Réf."), h("th", {}, "Libellé"), colonnes.map((c) => h("th", { class: "nombre" }, c[0])))),
    h("tbody", {}, lignes.map((l) => h("tr", { class: estTotal(l.ref) ? "ligne-total" : "" }, h("td", {}, l.ref), h("td", {}, libelles[l.ref]), colonnes.map((c) => h("td", { class: "nombre" }, nombreFr(c[1](l)))))))));
}

const ORDRE_RESULTAT = ["TA", "RA", "RB", "XA", "TB", "TC", "TD", "XB", "TE", "TF", "TG", "TH", "TI", "RC", "RD", "RE", "RF", "RG", "RH", "RI", "RJ", "XC", "RK", "XD", "TJ", "RL", "XE", "TK", "TL", "TM", "RM", "RN", "XF", "XG", "TN", "TO", "RO", "RP", "XH", "RQ", "RS", "XI"];

async function ecranEtatsOfficiels(b, annee = anneeCompta() - 1) {
  const e = await api("GET", `/compta/etats-officiels?brancheId=${b.id}&annee=${annee}`);
  vue(h("h1", {}, `États financiers ${annee}`), menuCompta(b, "États officiels"),
    h("div", { class: "pas-imprimer" }, h("label", {}, "Exercice", h("input", { type: "number", value: annee, onchange: (x) => ecranEtatsOfficiels(b, Number(x.target.value)) })), h("button", { class: "discret", onclick: () => window.print() }, "Imprimer")),
    h("div", { class: "alerte-caisse" }, `Présentation du système normal SYSCOHADA. Rattachement des comptes aux rubriques à valider par l'expert comptable. ${e.clos ? "Exercice clos." : "Exercice non clos : états provisoires."}${e.brouillons ? ` ${e.brouillons} brouillon(s) non comptés.` : ""}`),
    !e.bilan.equilibre ? h("div", { class: "erreur", role: "alert" }, `Bilan non équilibré : actif ${fcfa(e.bilan.totalActif)}, passif ${fcfa(e.bilan.totalPassif)}.`) : null,
    e.flux.ecart ? h("div", { class: "erreur", role: "alert" }, `Le tableau des flux s'écarte de la trésorerie de ${fcfa(e.flux.ecart)}.`) : null,
    h("div", { class: "carte" }, h("h2", {}, "Bilan : actif"), tableEtat(e.libelles, e.bilan.actif, [["Brut", (l) => l.brut], ["Amort.", (l) => l.amort], ["Net", (l) => l.net], ["N-1", (l) => e.n1.actif[l.ref] || 0]])),
    h("div", { class: "carte" }, h("h2", {}, "Bilan : passif"), tableEtat(e.libelles, e.bilan.passif, [["Net", (l) => l.net], ["N-1", (l) => e.n1.passif[l.ref] || 0]])),
    h("div", { class: "carte" }, h("h2", {}, "Compte de résultat"), tableEtat(e.libelles, ORDRE_RESULTAT.map((ref) => ({ ref })), [["N", (l) => e.compteDeResultat.lignes[l.ref] || 0], ["N-1", (l) => e.n1.resultat[l.ref] || 0]])),
    h("div", { class: "carte" }, h("h2", {}, "Tableau des flux de trésorerie"), tableEtat(e.libelles, e.flux.lignes, [["N", (l) => l.montant]])),
    h("div", { class: "carte" }, h("h2", {}, "Notes annexes"), h("p", { class: "discret-texte" }, "À rédiger avec l'expert comptable : le système ne les produit pas.")));
}

const lignesVersTexte = (ls) => ls.map((l) => `${l.libelle} ; ${l.montant}`).join("\n");
const lireLignesMontant = (t) => t.split("\n").map((x) => x.trim()).filter(Boolean).map((x) => {
  const i = x.lastIndexOf(";");
  return { libelle: x.slice(0, i).trim(), montant: Number(x.slice(i + 1)) };
});

async function ecranDsf(b, annee = anneeCompta() - 1, message) {
  const d = await api("GET", `/compta/dsf?brancheId=${b.id}&annee=${annee}`);
  const f = d.fiscal;
  const p = d.preparation;
  const gere = droits.includes("compta.cloturer");
  const montantTexte = (nom, valeur) => { const t = h("textarea", { name: nom, rows: 4 }); t.value = valeur; return t; };
  vue(h("h1", {}, `Préparation de la DSF ${annee}`), menuCompta(b, "DSF"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("label", { class: "pas-imprimer" }, "Exercice", h("input", { type: "number", value: annee, onchange: (x) => ecranDsf(b, Number(x.target.value)) })),
    h("div", { class: "alerte-caisse" }, "Le système prépare les chiffres. Le dépôt officiel se fait sur le portail de la DGI, avec son modèle Excel, après relecture et signature de votre expert comptable. Maximum 12 dépôts par an."),
    d.blocages.length ? h("div", { class: "carte" }, h("h2", {}, "Reste à faire"), d.blocages.map((x) => h("p", {}, x))) : h("div", { class: "succes" }, "Dossier prêt à reporter dans le modèle de la DGI."),
    d.echeance ? h("p", { class: "grand" }, `Échéance : ${d.echeance.date} ${annee + 1}`) : null,
    h("div", { class: "carte" }, h("h2", {}, "Passage au résultat fiscal"),
      [["Résultat avant impôt", f.avantImpot], ["Réintégrations", f.reintegrations], ["Déductions", f.deductions], ["Résultat fiscal", f.resultatFiscal], ["Base imposable", f.imposable], ["Impôt calculé", f.impotCalcule], ["Impôt dû", f.du], ["Solde après acomptes", f.solde]].map(([l, v]) => h("div", { class: "ligne apprenant" }, h("span", {}, l), h("span", {}, fcfa(v))))),
    d.suggestions.length ? h("div", { class: "carte" }, h("h2", {}, "Réintégrations à examiner"), h("p", { class: "discret-texte" }, "Détectées dans vos écritures. C'est à vous et à l'expert de les retenir."), d.suggestions.map((s) => h("div", { class: "ligne apprenant" }, h("span", {}, s.libelle), h("span", {}, fcfa(s.montant))))) : null,
    gere ? h("details", { class: "carte", open: !p.centre }, h("summary", {}, "Saisir les données fiscales"), formulaire(async (v) => {
      await api("PUT", "/compta/dsf", {
        brancheId: b.id, annee, centre: v.centre, reintegrations: lireLignesMontant(v.reint), deductions: lireLignesMontant(v.deduc), deficitAnterieur: Number(v.deficit || 0), tauxIs: Number(v.is), tauxCac: Number(v.cac), minimumDu: Number(v.minimum || 0), acomptes: Number(v.acomptes || 0),
        relueParExpert: v.expert.trim() || undefined, relueLe: v.relue || undefined,
      });
      ecranDsf(b, annee, "Données enregistrées.");
    }, [choix("centre", "Votre centre des impôts", Object.entries(d.centres).map(([c, x]) => [c, `${x.libelle} (${x.date})`]), p.centre),
      h("label", {}, "Réintégrations, une par ligne : libellé ; montant", montantTexte("reint", lignesVersTexte(p.reintegrations))),
      h("label", {}, "Déductions, une par ligne : libellé ; montant", montantTexte("deduc", lignesVersTexte(p.deductions))),
      h("div", { class: "grille" }, champ("Déficits antérieurs reportables", { name: "deficit", type: "number", min: 0, value: p.deficit_anterieur }),
        champ("Taux d'impôt (%) : CGI 30, ou 25 si CA ≤ 3 milliards", { name: "is", type: "number", min: 0, max: 100, step: 0.001, value: p.taux_is ?? "", required: true }),
        champ("Centimes additionnels (%) : CGI 10", { name: "cac", type: "number", min: 0, max: 100, step: 0.001, value: p.taux_cac ?? "", required: true }),
        champ("Minimum de perception calculé par l'expert", { name: "minimum", type: "number", min: 0, value: p.minimum_du }), champ("Acomptes versés", { name: "acomptes", type: "number", min: 0, value: p.acomptes }),
        champ("Expert ayant relu", { name: "expert", value: p.relue_par || "" }), champ("Date de relecture", { name: "relue", type: "date", value: p.relue_le || "" }))], "Enregistrer")) : null,
    h("div", { class: "actions pas-imprimer" }, h("button", { class: "discret", onclick: () => ecranEtatsOfficiels(b, annee) }, "Voir les états"), h("button", { onclick: async () => {
      const r = await fetch(`/compta/dsf/export?brancheId=${b.id}&annee=${annee}`, { headers: { authorization: `Bearer ${jeton}` } });
      if (!r.ok) throw Object.assign(new Error(), { code: "inconnue" });
      const url = URL.createObjectURL(await r.blob());
      h("a", { href: url, download: `Preparation DSF ${b.nom} ${annee}.csv` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } }, "Exporter les chiffres")));
}
