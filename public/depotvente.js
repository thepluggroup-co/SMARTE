"use strict";
/* Dépôt-vente de GLOMARI (lot 3B) : articles confiés par des fournisseurs locaux, vendus sans être achetés.
   Le serveur calcule et contrôle tout (rémunération du jour de chaque vente, relevé unique) : l'écran affiche et transmet. */

const SOURCES_RELEVE = { comptoir: "Vente en caisse", retour: "Retour en caisse", facture: "Facture", avoir: "Avoir" };
const remunerationDepot = (r) => !r ? "Rémunération non fixée"
  : r.mode === "prix_fixe" ? `${fcfa(r.prix_reversement)} reversés par pièce vendue` : `Prix encaissé moins ${quantiteFr(r.commission_pct)} % de commission`;
const champsRemuneration = () => [
  choix("mode", "Rémunération du fournisseur", [["prix_fixe", "Prix fixe par pièce vendue"], ["commission", "Commission sur le prix encaissé"]]),
  champ("Prix reversé par pièce (FCFA), pour un prix fixe", { name: "prixReversement", type: "number", min: 0 }),
  champ("Commission gardée par GLOMARI (%), pour une commission", { name: "commissionPct", type: "number", min: 0, max: 100, step: 0.01 }),
];
const corpsRemuneration = (v) => v.mode === "prix_fixe"
  ? { mode: v.mode, prixReversement: v.prixReversement === "" ? undefined : Number(v.prixReversement) }
  : { mode: v.mode, commissionPct: v.commissionPct === "" ? undefined : Number(v.commissionPct) };

async function ecranDepotVente(message, brancheId) {
  const gere = droits.includes("achats.gerer");
  const magasinier = droits.includes("stocks.gerer");
  const releve = droits.includes("compta.saisir");
  const branches = (await api("GET", "/entites")).filter((e) => e.type === "branche" && e.domaine === "commerce");
  const b = brancheId || branches[0]?.id;
  if (!b) return vue(h("h1", {}, "Dépôt-vente"), h("p", { class: "discret-texte" }, "Aucune branche avec du stock."));
  const relire = (m) => ecranDepotVente(m, b);
  const [articles, releves, produits, tiers, lieux] = await Promise.all([
    api("GET", `/depots-vente?brancheId=${b}`),
    api("GET", `/depots-vente/releves?brancheId=${b}`).catch(() => null),
    gere ? api("GET", "/produits") : [],
    gere && droits.includes("tiers.voir") ? api("GET", "/tiers") : [],
    magasinier ? entitesPour("achats_stocks") : [],
  ]);
  const deja = new Set(articles.filter((a) => a.actif).map((a) => a.produit_id));
  const fournisseurs = [...new Map(articles.map((a) => [a.fournisseur_id, a.fournisseur])).entries()];
  const resultat = h("div");
  const mouvement = (a, chemin, titre, bouton, texte) => h("details", {}, h("summary", {}, titre), formulaire(async (v) => {
    await api("POST", `/depots-vente/${a.produit_id}/${chemin}`, { lieuId: v.lieuId, quantite: Number(v.quantite), reference: v.reference.trim() || undefined });
    relire(texte);
  }, [h("div", { class: "grille" },
    choix("lieuId", "Lieu", lieux),
    champ("Quantité", { name: "quantite", type: "number", min: 0.001, step: 0.001, required: true }),
    champ("Référence du bon, facultatif", { name: "reference", maxlength: 100 }))], bouton));

  vue(h("h1", {}, "Dépôt-vente"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("p", { class: "discret-texte" }, "Un fournisseur local confie des articles : GLOMARI les vend sans les acheter, puis lui reverse, pour chaque pièce vendue, un prix fixe ou le prix encaissé moins une commission. Le stock confié n'a aucune valeur pour GLOMARI et ne compte pas dans la couverture de stock."),
    branches.length > 1 ? h("div", { class: "carte" }, formulaire(async (v) => ecranDepotVente(null, v.brancheId),
      [choix("brancheId", "Branche", branches.map((x) => [x.id, x.nom]), b)], "Afficher")) : null,
    h("div", { class: "carte" }, h("h2", {}, `Articles confiés (${articles.length})`),
      articles.length ? articles.map((a) => h("div", { class: "apprenant" },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, `${a.code} · ${a.nom}`),
          h("span", { class: a.actif ? "pastille ok" : "pastille" }, a.actif ? "En dépôt" : "Dépôt terminé")),
        h("div", { class: "discret-texte" }, `${a.fournisseur} · ${remunerationDepot(a.remuneration)}`),
        h("div", { class: "discret-texte" }, `Stock : ${a.stock.length ? a.stock.map((s) => `${s.lieu} ${quantiteFr(s.quantite)}`).join(", ") : "aucun"}`
          + ` · Dû au fournisseur, pas encore relevé : ${fcfa(a.du_non_releve)}`),
        gere && a.actif ? h("details", {}, h("summary", {}, "Changer la rémunération"), formulaire(async (v) => {
          await api("POST", `/depots-vente/${a.produit_id}/remuneration`, corpsRemuneration(v));
          relire("Rémunération enregistrée : elle vaut pour les ventes à partir de maintenant.");
        }, [h("div", { class: "grille" }, champsRemuneration())], "Enregistrer")) : null,
        magasinier && a.actif && lieux.length ? mouvement(a, "entrees", "Arrivée de marchandise confiée", "Enregistrer l'arrivée", "Arrivée enregistrée, sans valeur de stock pour GLOMARI.") : null,
        magasinier && a.stock.length && lieux.length ? mouvement(a, "retours", "Rendre des invendus au fournisseur", "Enregistrer le retour", "Retour au fournisseur enregistré, sans montant dû.") : null,
        gere && a.actif ? h("p", {}, h("button", { class: "discret", onclick: async () => {
          await api("POST", `/depots-vente/${a.produit_id}/fin`);
          relire("Dépôt terminé. Les ventes passées restent dues au fournisseur.");
        } }, "Terminer le dépôt (stock rendu en entier)")) : null))
        : h("p", { class: "discret-texte" }, "Aucun article en dépôt-vente.")),
    gere ? h("details", { class: "carte" }, h("summary", {}, "Déclarer un article en dépôt-vente"),
      h("p", { class: "discret-texte" }, "L'article doit exister au catalogue, sans stock acheté ni commande en cours : un article confié ne s'achète pas."),
      formulaire(async (v) => {
        await api("POST", "/depots-vente", { produitId: v.produitId, fournisseurId: v.fournisseurId, ...corpsRemuneration(v) });
        relire("Article déclaré en dépôt-vente. Enregistrez maintenant l'arrivée de la marchandise.");
      }, [h("div", { class: "grille" },
        choix("produitId", "Article", produits.filter((p) => p.suivi_stock && p.actif !== false && !deja.has(p.id)).map((p) => [p.id, `${p.code} · ${p.nom}`])),
        choix("fournisseurId", "Fournisseur qui confie", tiers.filter((t) => t.type === "entreprise" || t.roles.includes("fournisseur")).map((t) => [t.id, t.nom])),
        champsRemuneration())], "Déclarer l'article")) : null,
    releve && fournisseurs.length ? h("div", { class: "carte" }, h("h2", {}, "Relevé d'un fournisseur"),
      h("p", { class: "discret-texte" }, "Le relevé reprend toutes les ventes, factures, retours et avoirs pas encore relevés jusqu'à la date de fin, même plus anciens que le début de la période. Une vente n'entre que dans un seul relevé. Il crée la facture du fournisseur en brouillon, à valider puis payer en comptabilité."),
      formulaire(async (v) => {
        const q = `fournisseurId=${v.fournisseurId}&du=${v.du}&au=${v.au}`;
        const a = await api("GET", `/depots-vente/releves/apercu?${q}`);
        resultat.replaceChildren(
          a.anterieures ? h("div", { class: "alerte-caisse", role: "status" }, `${a.anterieures} ligne${a.anterieures > 1 ? "s" : ""} antérieure${a.anterieures > 1 ? "s" : ""} au début de la période, jamais relevée${a.anterieures > 1 ? "s" : ""} : elle${a.anterieures > 1 ? "s" : ""} entre${a.anterieures > 1 ? "nt" : ""} dans ce relevé.`) : null,
          a.lignes.length ? tableau(["Date", "Origine", "Article", "Quantité", "Montant HT", "Dû"], a.lignes.map((l) => h("tr", {},
            h("td", {}, dateFr(l.jour)), h("td", {}, SOURCES_RELEVE[l.source_type]), h("td", {}, l.nom), h("td", { class: "nombre" }, quantiteFr(l.quantite)),
            h("td", { class: "nombre" }, fcfa(l.montant_ht)), h("td", { class: "nombre" }, fcfa(l.montant_du)))))
            : h("p", { class: "discret-texte" }, "Rien à relever pour cette période."),
          h("p", {}, h("b", {}, `Total dû : ${fcfa(a.total)}`)),
          a.total > 0 ? formulaire(async () => {
            const r = await api("POST", "/depots-vente/releves", { fournisseurId: v.fournisseurId, du: v.du, au: v.au });
            relire(`Relevé ${r.releve.numero} établi : facture fournisseur de ${fcfa(r.releve.total_du)} en brouillon, à valider en comptabilité.`);
          }, [], "Établir le relevé") : null);
      }, [h("div", { class: "grille" },
        choix("fournisseurId", "Fournisseur", fournisseurs),
        champ("Du", { name: "du", type: "date", value: `${aujourdhui().slice(0, 8)}01`, required: true }),
        champ("Au", { name: "au", type: "date", value: aujourdhui(), max: aujourdhui(), required: true }))], "Voir l'aperçu"),
      resultat) : null,
    releves ? h("div", { class: "carte" }, h("h2", {}, "Relevés établis"),
      releves.length ? tableau(["Relevé", "Fournisseur", "Période", "Dû", "Facture", "Payé"], releves.map((r) => h("tr", {},
        h("td", {}, r.numero), h("td", {}, r.fournisseur), h("td", {}, `${dateFr(r.du)} au ${dateFr(r.au)}`), h("td", { class: "nombre" }, fcfa(r.total_du)),
        h("td", {}, r.facture_numero || (r.facture_statut === "brouillon" ? "En brouillon" : r.facture_statut)), h("td", { class: "nombre" }, fcfa(r.paye)))))
        : h("p", { class: "discret-texte" }, "Aucun relevé."),
      h("p", { class: "discret-texte" }, "Les écritures de ces factures restent à valider par l'expert-comptable : le système ne remplace pas un expert agréé.")) : null);
}
