"use strict";
/* Rapports stock et ventes, et commission des vendeurs. Les valeurs de stock et les marges n'apparaissent qu'aux personnes autorisées. */

const moisCourant = () => aujourdhui().slice(0, 7);
const tableRapport = (titres, lignes, vide = "Rien sur cette période.") => (lignes.length ? h("div", { class: "defilant" }, h("table", {},
  h("thead", {}, h("tr", {}, titres.map((t) => h("th", { scope: "col" }, t)))),
  h("tbody", {}, lignes.map((l) => h("tr", {}, l.map((c, i) => h("td", { class: typeof c === "number" ? "nombre" : "" }, typeof c === "number" ? c.toLocaleString("fr-FR") : c ?? "")))))))
  : h("p", { class: "discret-texte" }, vide));
const LIBELLES_MOYEN = { especes: "Espèces", mtn_momo: "MTN Mobile Money", orange_money: "Orange Money", carte: "Carte", virement: "Virement", cheque: "Chèque", points: "Points de fidélité" };

async function ecranRapportsStockVentes(filtres = {}) {
  const q = new URLSearchParams(Object.entries(filtres).filter(([, v]) => v));
  const r = await api("GET", `/rapports/ventes-stock${q.size ? `?${q}` : ""}`);
  // Chaque section : titre, colonnes, lignes. La même liste sert à l'écran, au CSV et à l'impression.
  const sections = [
    ["Meilleures ventes", ["Code", "Article", "Unité", "Quantité", "Montant TTC (FCFA)"], r.meilleures_ventes.map((x) => [x.code, x.nom, x.unite, x.quantite, x.montant])],
    ["Ventes par vendeur", ["Vendeur", "Ventes", "Montant TTC (FCFA)"], r.ventes_par_vendeur.map((x) => [x.nom, x.nombre, x.ventes])],
    ["Ventes par caissier", ["Caissier", "Ventes", "Montant TTC (FCFA)"], r.ventes_par_caissier.map((x) => [x.nom, x.nombre, x.ventes])],
    ["Ventes par lieu", ["Lieu", "Ventes", "Montant TTC (FCFA)"], r.ventes_par_lieu.map((x) => [x.nom, x.nombre, x.ventes])],
    ["Paiements reçus par moyen", ["Moyen", "Montant net (FCFA)"], r.paiements_par_moyen.map((x) => [LIBELLES_MOYEN[x.moyen] || x.moyen, x.montant])],
    ["État du stock par lieu", ["Lieu", "Articles", "Quantité", ...(r.voit_valeurs ? ["Valeur (FCFA)"] : [])], r.stock_par_lieu.map((x) => [x.entite, x.articles, x.quantite, ...(r.voit_valeurs ? [x.valeur ?? ""] : [])])],
    ["Alertes de quantité", ["Lieu", "Code", "Article", "Unité", "Stock", "Seuil"], r.alertes.map((x) => [x.entite, x.code, x.nom, x.unite, x.quantite, x.seuil])],
    ...(r.voit_valeurs ? [["Marge brute par article", ["Code", "Article", "Quantité", "Ventes HT (FCFA)", "Coût (FCFA)", "Marge (FCFA)", "Taux %"], r.marges.map((x) => [x.code, x.nom, x.quantite, x.ventes_ht, x.cout, x.marge, x.taux ?? ""])]] : []),
    ["Restes dus par les clients", ["Client", "Téléphone", "Reste dû (FCFA)"], r.restes_clients.map((x) => [x.nom, x.telephone || "", x.reste])],
    ["Restes dus aux fournisseurs", ["Fournisseur", "Téléphone", "Reste dû (FCFA)"], r.restes_fournisseurs.map((x) => [x.nom, x.telephone || "", x.reste])],
  ];
  const lieu = r.lieux.find((l) => l.id === filtres.entiteId)?.nom, branche = r.branches.find((b) => b.id === filtres.brancheId)?.nom;
  const titre = `Rapports stock et ventes du ${dateFr(r.du)} au ${dateFr(r.au)}`;
  const exporter = () => fichierCsv(nomFichier(`Rapports stock et ventes ${r.du} ${r.au}`), [[titre], [`Lieu : ${lieu || "tous"} · Branche : ${branche || "toutes"}`],
    ...sections.flatMap(([nom, colonnes, lignes]) => [[], [nom], colonnes, ...lignes])]);
  vue(
    h("div", { class: "actions pas-imprimer" }, h("button", { class: "discret", onclick: () => ecranCommissions() }, "Commission des vendeurs"),
      h("button", { class: "discret", onclick: exporter }, "Télécharger en CSV (Excel)"), h("button", { class: "discret", onclick: () => window.print() }, "Imprimer ou enregistrer en PDF")),
    h("h1", {}, "Rapports stock et ventes"),
    h("p", { class: "discret-texte" }, `Du ${dateFr(r.du)} au ${dateFr(r.au)}${lieu ? ` · ${lieu}` : ""}${branche ? ` · ${branche}` : ""}. Ventes de caisse, retours déduits. Le stock est celui d'aujourd'hui.`),
    h("div", { class: "carte pas-imprimer" }, formulaire(async (v) => ecranRapportsStockVentes(v), [h("div", { class: "grille" },
      champ("Du", { name: "du", type: "date", value: r.du, required: true }), champ("Au", { name: "au", type: "date", value: r.au, required: true }),
      choix("entiteId", "Lieu", [["", "Tous"], ...r.lieux.map((l) => [l.id, l.nom])], filtres.entiteId || ""),
      r.branches.length > 1 ? choix("brancheId", "Branche", [["", "Toutes"], ...r.branches.map((b) => [b.id, b.nom])], filtres.brancheId || "") : null)], "Afficher")),
    sections.map(([nom, colonnes, lignes]) => h("div", { class: "carte" }, h("h2", {}, nom), tableRapport(colonnes, lignes))),
    r.voit_valeurs ? null : h("p", { class: "discret-texte" }, "Les valeurs de stock et les marges sont réservées aux personnes qui valident le stock ou administrent la facturation."),
    h("p", { class: "discret-texte" }, "Documents de gestion : ils ne remplacent ni la comptabilité ni l'avis d'un expert-comptable agréé."));
}

async function ecranCommissions(message, mois = moisCourant()) {
  const [r, proposees] = await Promise.all([api("GET", `/rapports/commissions?mois=${mois}`), droits.includes("rh.paie") ? api("GET", `/paie/commissions-proposees?mois=${mois}`).catch(() => []) : []]);
  const relire = (m) => ecranCommissions(m, mois);
  const regle = droits.includes("rh.gerer");
  vue(
    h("div", { class: "actions pas-imprimer" }, h("button", { class: "discret", onclick: () => ecranRapportsStockVentes() }, "← Rapports"), h("button", { class: "discret", onclick: () => window.print() }, "Imprimer")),
    h("h1", {}, "Commission des vendeurs"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("label", { class: "pas-imprimer" }, "Mois", h("input", { type: "month", value: mois, max: moisCourant(), onchange: (e) => e.target.value && ecranCommissions(null, e.target.value) })),
    h("p", { class: "discret-texte" }, "Commission = pourcentage appliqué aux ventes TTC de caisse du mois qui dépassent l'objectif, retours déduits. C'est une proposition : la paie décide, et elle ne remplace pas l'avis d'un expert agréé."),
    h("div", { class: "carte" }, r.vendeurs.length ? r.vendeurs.map((x) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${x.nom} · ${x.poste}`), x.commission === null ? h("span", { class: "pastille attente" }, "Commission non réglée") : h("b", {}, fcfa(x.commission))),
      h("div", { class: "discret-texte" }, [x.entite, `${x.nombre} vente(s)`, `ventes ${fcfa(x.ventes)}`, x.objectif_ventes === null ? null : `objectif ${fcfa(x.objectif_ventes)}`, x.taux_commission === null ? null : `${String(x.taux_commission).replace(".", ",")} % au delà`,
        x.propose === null ? null : `proposé à la paie : ${fcfa(x.propose)} le ${heure(x.propose_le)}`].filter(Boolean).join(" · ")),
      h("div", { class: "actions pas-imprimer" },
        x.commission !== null && x.propose !== x.commission ? h("button", { class: "discret", onclick: async () => { const p = await api("POST", "/rapports/commissions/propositions", { employeId: x.employe_id, mois }); relire(`${fcfa(p.montant)} proposés à la paie pour ${x.nom}.`); } }, x.propose === null ? "Proposer à la paie" : "Mettre à jour la proposition") : null,
        regle ? h("details", {}, h("summary", {}, "Régler l'objectif et le pourcentage"), formulaire(async (v) => {
          await api("PUT", `/employes/${x.employe_id}/commission`, { objectifVentes: v.objectif === "" ? null : Number(v.objectif), tauxCommission: v.taux === "" ? null : Number(String(v.taux).replace(",", ".")) });
          relire("Commission réglée.");
        }, [h("div", { class: "grille" }, champ("Objectif mensuel de ventes (FCFA)", { name: "objectif", type: "number", min: 0, value: x.objectif_ventes ?? "" }), champ("Pourcentage au delà de l'objectif", { name: "taux", type: "number", min: 0, max: 100, step: 0.01, value: x.taux_commission ?? "" }))], "Enregistrer")) : null)))
      : h("p", { class: "discret-texte" }, "Aucun vendeur avec des ventes ou une commission réglée ce mois-ci.")),
    proposees.length ? h("div", { class: "carte" }, h("h2", {}, "Propositions reçues par la paie"),
      h("p", { class: "discret-texte" }, "À reprendre, si vous le décidez, comme élément variable (gain) du bulletin du mois. Rien n'est ajouté tout seul."),
      tableRapport(["Employé", "Poste", "Ventes (FCFA)", "Objectif (FCFA)", "Taux %", "Commission proposée (FCFA)", "Proposé par"], proposees.map((p) => [p.nom, p.poste, Number(p.ventes), Number(p.objectif), p.taux, Number(p.montant), p.propose_par]))) : null);
}
