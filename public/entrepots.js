"use strict";
/* Module Stocks de GLOMARI, en onglets : état par entrepôt, articles et catégories, mouvements et transferts, dates d'expiration, avariés, import.
   Les articles, catégories, unités et colis créés ici servent tels quels à la facturation, aux achats, à la caisse et aux entrepôts. */

const ETATS_STOCK = [["", "Tous les articles"], ["alerte", "Sous le seuil d'alerte"], ["avarie", "Avec des avariés"], ["perime", "Expirés"], ["expire", "Expirés ou bientôt expirés"]];
const COLONNES_IMPORT_STOCK = [
  ["code", "Code"], ["nom", "Nom"], ["prixVente", "Prix de vente"], ["unite", "Unité"], ["categorie", "Catégorie"], ["sousCategorie", "Sous-catégorie"],
  ["marque", "Marque"], ["typeColis", "Type de colis"], ["piecesParUnite", "Pièces par unité"], ["quantite", "Quantité"], ["coutUnitaire", "Coût unitaire"], ["codeBarres", "Code-barres"],
];
const sansAccent = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const valeurStock = (v) => (v === null || v === undefined ? "–" : fcfa(v));
const tableau = (titres, lignes) => h("div", { class: "defilant" }, h("table", {},
  h("thead", {}, h("tr", {}, titres.map((t) => h("th", { scope: "col" }, t)))), h("tbody", {}, lignes)));
/** Les unités de vente d'un article, comme le serveur (src/articles.ts) : base, conditionnements, pièce. */
function unitesDeProduit(p) {
  const meme = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  const unites = [{ nom: p.unite || "pièce", facteur: 1, prix: null, base: true }];
  for (const c of p.conditionnements || []) if (Number(c.facteur) > 0 && !unites.some((u) => meme(u.nom, c.nom))) unites.push({ nom: c.nom, facteur: Number(c.facteur), prix: c.prix ?? null, base: false });
  if (Number(p.pieces_par_unite) > 1 && !unites.some((u) => meme(u.nom, "pièce"))) unites.push({ nom: "pièce", facteur: 1 / Number(p.pieces_par_unite), prix: p.prix_piece === null || p.prix_piece === undefined ? null : Number(p.prix_piece), base: false });
  return unites;
}
const photosEnMemoire = new Map();
/** Charge une photo d'article dans une balise image. Le navigateur la garde en cache ; sans réseau, l'image reste vide. */
async function chargerPhotoArticle(img, produitId, photo) {
  const url = `/produits/${produitId}/photos/${photo.position}?v=${photo.version}`;
  try {
    if (!photosEnMemoire.has(url)) {
      photosEnMemoire.set(url, (async () => {
        const r = await fetch(url, { headers: { authorization: `Bearer ${jeton}` } });
        if (!r.ok) throw new Error("photo");
        const lecteur = new FileReader();
        const fini = new Promise((ok, ko) => { lecteur.onload = () => ok(lecteur.result); lecteur.onerror = ko; });
        lecteur.readAsDataURL(await r.blob());
        return fini;
      })());
    }
    img.src = await photosEnMemoire.get(url);
    img.hidden = false;
  } catch { photosEnMemoire.delete(url); }
}
/** Réduit une photo choisie à 600 pixels de côté au plus, en JPEG : légère à charger en caisse. */
function reduirePhoto(fichier) {
  return new Promise((ok, ko) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => ko(Object.assign(new Error(), { code: "format_image" }));
    lecteur.onload = () => {
      const image = new Image();
      image.onerror = () => ko(Object.assign(new Error(), { code: "format_image" }));
      image.onload = () => {
        const ratio = Math.min(600 / Math.max(image.width, image.height), 1);
        const toile = h("canvas", { width: Math.round(image.width * ratio), height: Math.round(image.height * ratio) });
        const dessin = toile.getContext("2d");
        dessin.fillStyle = "#fff";
        dessin.fillRect(0, 0, toile.width, toile.height);
        dessin.drawImage(image, 0, 0, toile.width, toile.height);
        ok(toile.toDataURL("image/jpeg", 0.82));
      };
      image.src = lecteur.result;
    };
    lecteur.readAsDataURL(fichier);
  });
}
let numeroListe = 0;
/** Champ avec propositions : la liste aide, une autre valeur reste permise. */
const saisieListe = (libelle, nom, liste, valeur = "") => {
  const id = `liste-${nom}-${numeroListe += 1}`;
  return h("label", {}, libelle, h("input", { name: nom, list: id, value: valeur, maxlength: 40 }), h("datalist", { id }, liste.map((x) => h("option", { value: x }))));
};

/** Pastilles d'un article : expiré en rouge, bientôt expiré, avarié, sous le seuil. */
function etatsArticle(l) {
  return [
    l.expiration_etat === "perime" ? h("span", { class: "pastille retard" }, `Expiré : ${quantiteFr(l.perime)}`) : null,
    l.expiration_etat === "expire" ? h("span", { class: "pastille attente" }, `Expire le ${dateFr(l.expiration)}`) : null,
    l.avarie > 0 ? h("span", { class: "pastille prio-important" }, `Avarié : ${quantiteFr(l.avarie)}`) : null,
    l.en_alerte ? h("span", { class: "pastille retard" }, "Alerte") : null,
  ];
}

/** Lit un fichier d'articles : la première ligne donne les colonnes, dans n'importe quel ordre. */
function lignesImportStock(rangs) {
  const tete = (rangs[0] || []).map(sansAccent);
  const position = Object.fromEntries(COLONNES_IMPORT_STOCK.map(([cle, titre]) => [cle, tete.indexOf(sansAccent(titre))]));
  if (position.code < 0 || position.nom < 0 || position.prixVente < 0) throw Object.assign(new Error(), { code: "import_colonnes" });
  const texte = (r, cle) => (position[cle] < 0 ? "" : String(r[position[cle]] ?? "").trim());
  const nombre = (r, cle) => (texte(r, cle) === "" ? undefined : nombreSaisi(texte(r, cle)) ?? undefined);
  return rangs.slice(1).filter((r) => texte(r, "code")).map((r) => ({
    code: texte(r, "code"), nom: texte(r, "nom"), prixVente: Math.round(nombre(r, "prixVente") ?? 0), unite: texte(r, "unite") || undefined,
    categorie: texte(r, "categorie") || undefined, sousCategorie: texte(r, "sousCategorie") || undefined, marque: texte(r, "marque") || undefined, typeColis: texte(r, "typeColis") || undefined,
    piecesParUnite: nombre(r, "piecesParUnite"), quantite: nombre(r, "quantite"), coutUnitaire: nombre(r, "coutUnitaire") === undefined ? undefined : Math.round(nombre(r, "coutUnitaire")),
    codeBarres: texte(r, "codeBarres") || undefined,
  }));
}

const ONGLETS_STOCK = [["etat", "État du stock"], ["articles", "Articles et catégories"], ["mouvements", "Mouvements et transferts"], ["expirations", "Dates d'expiration"], ["avaries", "Avariés"], ["import", "Importer un fichier"]];
const ouvrirOngletStock = (c, message) => ({ etat: ecranStocks, articles: ecranStockArticles, mouvements: ecranStockMouvements, expirations: ecranStockExpirations, avaries: ecranStockAvaries, import: ecranStockImport })[c](message);
const ongletsStock = (actif) => h("div", { class: "actions onglets pas-imprimer", role: "tablist", "aria-label": "Parties du module Stocks" },
  ONGLETS_STOCK.filter(([c]) => c !== "import" || droits.includes("catalogue.gerer")).map(([c, l]) => h("button", { class: c === actif ? "" : "discret", role: "tab", "aria-selected": c === actif ? "true" : "false", onclick: () => ouvrirOngletStock(c) }, l)));
const enteteStock = (actif, message) => [h("h1", {}, "Stocks"), ongletsStock(actif), message ? h("div", { class: "succes", role: "status" }, message) : null];
/** Catégories en liste : « Alimentation », puis « Alimentation › Boissons ». */
const choixCategoriesStock = (categories) => categories.filter((c) => !c.parent_id && c.actif).flatMap((c) => [[c.id, c.nom], ...categories.filter((x) => x.parent_id === c.id && x.actif).map((x) => [x.id, `${c.nom} › ${x.nom}`])]);

/** État du stock : par entrepôt, par catégorie, par type de colis, avec filtres et téléchargements. */
async function ecranStocks(message, filtres = {}) {
  const q = new URLSearchParams(Object.entries(filtres).filter(([, v]) => v));
  const [e, categories, lieux, marques] = await Promise.all([api("GET", `/entrepots/etat${q.size ? `?${q}` : ""}`), api("GET", "/categories-articles"), entitesPour("achats_stocks"), api("GET", "/marques")]);
  const total = (cle) => e.entrepots.reduce((s, x) => s + (x[cle] ?? 0), 0);
  const valeurTotale = e.entrepots.some((x) => x.valeur === null) ? null : total("valeur");
  const lieuChoisi = lieux.find(([id]) => id === filtres.entiteId)?.[1];
  const infos = [`Stock au ${dateFr(e.au)} · mouvements du ${dateFr(e.du)} au ${dateFr(e.au)}`, `Lieu : ${lieuChoisi || "tous"}${filtres.q ? ` · Recherche : ${filtres.q}` : ""}`];
  const exporter = (format) => exporterTableau(format, {
    nom: nomFichier(`Stock ${lieuChoisi || "tous les lieux"} ${e.au}`), titre: "État du stock par entrepôt", feuille: "Stock", infos,
    colonnes: [{ titre: "Lieu", poids: 2 }, { titre: "Code" }, { titre: "Article", poids: 3 }, { titre: "Catégorie", poids: 2 }, { titre: "Sous-catégorie", poids: 2 }, { titre: "Marque" }, { titre: "Unité" }, { titre: "Type de colis" },
      { titre: "Quantité", droite: true }, { titre: "Pièces", droite: true }, { titre: "Valeur (FCFA)", droite: true }, { titre: "Entrées", droite: true }, { titre: "Sorties", droite: true }, { titre: "Avariés", droite: true }, { titre: "Expirés", droite: true }, { titre: "Expiration" }],
    lignes: [...e.lignes.map((l) => [l.entite, l.code, l.nom, l.categorie || "", l.sous_categorie || "", l.marque || "", l.unite, l.type_colis || "", l.quantite, l.pieces, l.valeur ?? "", l.entrees, l.sorties, l.avarie, l.perime, l.expiration ? dateFr(l.expiration) : ""]),
      { gras: true, cellules: ["Total", "", `${e.lignes.length} ligne(s)`, "", "", "", "", "", total("quantite"), total("pieces"), valeurTotale ?? "", "", "", total("avarie"), total("perime"), ""] }],
    note: "Valeur au coût moyen actuel. Document de gestion : il ne remplace pas l'inventaire validé ni l'avis d'un expert-comptable agréé.",
  });
  vue(
    enteteStock("etat", message),
    h("div", { class: "carte pas-imprimer" }, formulaire(async (v) => ecranStocks(null, v), [h("div", { class: "grille" },
      choix("entiteId", "Entrepôt ou magasin", [["", "Tous"], ...lieux], filtres.entiteId || ""),
      choix("categorieId", "Catégorie", [["", "Toutes"], ...choixCategoriesStock(categories)], filtres.categorieId || ""),
      marques.length ? choix("marqueId", "Marque", [["", "Toutes"], ...marques.filter((m) => m.actif).map((m) => [m.id, m.nom])], filtres.marqueId || "") : null,
      champ("Nom ou code de l'article", { name: "q", value: filtres.q || "" }),
      champ("Mouvements du", { name: "du", type: "date", value: e.du }), champ("Stock au", { name: "au", type: "date", value: e.au, max: aujourdhui() }),
      choix("etat", "Afficher", ETATS_STOCK, filtres.etat || ""))], "Filtrer")),
    h("div", { class: "chiffres" },
      h("div", { class: "chiffre" }, h("b", {}, quantiteFr(total("articles"))), h("span", {}, "Articles en stock")),
      h("div", { class: "chiffre" }, h("b", {}, quantiteFr(total("pieces"))), h("span", {}, "Pièces")),
      h("div", { class: "chiffre" }, h("b", {}, valeurStock(valeurTotale)), h("span", {}, "Valeur du stock")),
      h("div", { class: "chiffre" }, h("b", {}, quantiteFr(total("avarie"))), h("span", {}, "Avariés")),
      h("div", { class: "chiffre" }, h("b", { class: total("perime") ? "texte-rouge" : "" }, quantiteFr(total("perime"))), h("span", {}, "Expirés"))),
    total("perime") ? h("div", { class: "bandeau-urgent", role: "alert" }, "Des articles ont dépassé leur date d'expiration : retirez-les de la vente.") : null,
    h("div", { class: "carte" }, h("h2", {}, "Par entrepôt ou magasin"), e.entrepots.length ? tableau(["Lieu", "Articles", "Quantité", "Pièces", "Valeur", "Avariés", "Expirés"],
      e.entrepots.map((x) => h("tr", {}, h("td", {}, h("button", { class: "lien", onclick: () => ecranStocks(null, { ...filtres, entiteId: x.entite_id }) }, x.entite)), h("td", { class: "nombre" }, String(x.articles)), h("td", { class: "nombre" }, quantiteFr(x.quantite)),
        h("td", { class: "nombre" }, quantiteFr(x.pieces)), h("td", { class: "nombre" }, valeurStock(x.valeur)), h("td", { class: "nombre" }, quantiteFr(x.avarie)), h("td", { class: `nombre${x.perime ? " texte-rouge" : ""}` }, quantiteFr(x.perime))))) : h("p", { class: "discret-texte" }, "Aucun stock pour ces filtres.")),
    e.categories.length ? h("div", { class: "carte" }, h("h2", {}, "Par catégorie"), tableau(["Catégorie", "Sous-catégorie", "Articles", "Pièces", "Valeur"],
      e.categories.map((x) => h("tr", {}, h("td", {}, x.categorie), h("td", {}, x.sous_categorie || ""), h("td", { class: "nombre" }, String(x.articles)), h("td", { class: "nombre" }, quantiteFr(x.pieces)), h("td", { class: "nombre" }, valeurStock(x.valeur)))))) : null,
    e.colis.length ? h("details", { class: "carte" }, h("summary", {}, "Par type de colis"), tableau(["Lieu", "Type de colis", "Articles", "Quantité", "Pièces"],
      e.colis.map((x) => h("tr", {}, h("td", {}, x.entite), h("td", {}, x.type_colis), h("td", { class: "nombre" }, String(x.articles)), h("td", { class: "nombre" }, quantiteFr(x.quantite)), h("td", { class: "nombre" }, quantiteFr(x.pieces)))))) : null,
    h("div", { class: "carte" }, h("div", { class: "ligne" }, h("h2", {}, `Articles en stock (${e.lignes.length})`), e.lignes.length ? boutonsExport(exporter) : null),
      h("p", { class: "discret-texte" }, "Touchez un article pour voir ses entrées et ses sorties."),
      e.lignes.length ? e.lignes.map((l) => h("button", { class: `session${l.expiration_etat === "perime" ? " bord-urgent" : ""}`, onclick: () => ecranMouvements(l) },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, `${l.code} : ${l.nom}`), h("span", {}, etatsArticle(l))),
        h("div", { class: "discret-texte" }, [l.entite, [l.categorie, l.sous_categorie].filter(Boolean).join(" › ") || "sans catégorie", l.marque, `${quantiteFr(l.quantite)} ${l.unite}`,
          l.pieces !== l.quantite ? `${quantiteFr(l.pieces)} pièces` : null, l.type_colis ? `colis : ${l.type_colis}` : null, l.valeur === null ? null : `valeur ${fcfa(l.valeur)}`,
          `entrées ${quantiteFr(l.entrees)}, sorties ${quantiteFr(l.sorties)}`].filter(Boolean).join(" · "))))
        : h("p", { class: "discret-texte" }, "Aucun article pour ces filtres.")));
}

/** Articles, catégories, unités et colis : créés une fois ici, repris partout (facturation, achats, caisse, entrepôts). */
async function ecranStockArticles(message, recherche = "") {
  const catalogue = droits.includes("catalogue.gerer");
  const [produits, categories, refs, lieux, marques] = await Promise.all([api("GET", `/produits${recherche ? `?q=${encodeURIComponent(recherche)}` : ""}`), api("GET", "/categories-articles"), api("GET", "/entrepots/references"), entitesPour("achats_stocks"), api("GET", "/marques")]);
  const choixMarques = [["", "Sans marque"], ...marques.filter((m) => m.actif).map((m) => [m.id, m.nom])];
  const relire = (m) => ecranStockArticles(m, recherche);
  const racines = categories.filter((c) => !c.parent_id);
  const cats = choixCategoriesStock(categories);
  const articles = produits.filter((p) => p.type === "produit");
  const champsClassement = (p = {}) => [choix("categorieId", "Catégorie", [["", "Sans catégorie"], ...cats], p.categorie_id || ""), choix("marqueId", "Marque", choixMarques, p.marque_id || ""),
    saisieListe("Unité de mesure (kilogramme, litre, colis, ballot…)", "unite", refs.unites, p.unite || "pièce"), saisieListe("Type de colis", "typeColis", refs.typesColis, p.type_colis || ""),
    champ("Pièces dans une unité (ex. 24 par carton)", { name: "pieces", type: "number", min: 0.001, step: 0.001, value: p.pieces_par_unite ?? 1 })];
  vue(
    enteteStock("articles", message),
    h("p", { class: "discret-texte" }, "Un article créé ici, avec sa catégorie, son unité et son colis, sert directement à la facturation, aux achats, à la caisse et aux entrepôts : rien n'est à ressaisir ailleurs."),
    catalogue && lieux.length ? h("details", { class: "carte" }, h("summary", {}, "Nouvel article"), formulaire(async (v) => {
      await api("POST", "/produits", {
        entiteId: v.entiteId, code: v.code.trim(), nom: v.nom.trim(), type: "produit", unite: v.unite.trim() || undefined, prixVente: Number(v.prix || 0), suiviStock: true,
        seuilAlerte: Number(v.seuil || 0), codeBarres: v.codeBarres.trim() || undefined, categorieId: v.categorieId || undefined, marqueId: v.marqueId || undefined, typeColis: v.typeColis.trim() || undefined, piecesParUnite: v.pieces ? Number(v.pieces) : undefined,
        codeBarresAuto: !v.codeBarres.trim(),
      });
      relire("Article créé. Son stock se suit dans chaque entrepôt.");
    }, [h("div", { class: "grille" }, champ("Code ou référence", { name: "code", required: true, maxlength: 60 }), champ("Nom", { name: "nom", required: true, maxlength: 200 }), choix("entiteId", "Catalogue de", lieux),
      ...champsClassement(), champ("Prix de vente HT (FCFA)", { name: "prix", type: "number", min: 0 }), champ("Seuil d'alerte", { name: "seuil", type: "number", min: 0, step: "any" }), champ("Code-barres (vide : créé automatiquement)", { name: "codeBarres" }))], "Créer l'article")) : null,
    catalogue ? h("details", { class: "carte" }, h("summary", {}, `Marques (${marques.length})`),
      marques.length ? h("p", {}, marques.map((m) => `${m.nom} (${m.articles})`).join(" · ")) : h("p", { class: "discret-texte" }, "Aucune marque."),
      lieux.length ? formulaire(async (v) => { await api("POST", "/marques", { entiteId: lieux[0][0], nom: v.nom.trim() }); relire("Marque créée."); }, [champ("Nouvelle marque", { name: "nom", required: true, maxlength: 100 })], "Créer") : null) : null,
    catalogue && lieux.length && articles.some((p) => !p.code_barres) ? h("div", { class: "actions" }, h("button", { class: "discret", onclick: async () => {
      let n = 0;
      for (const [id] of lieux) n += (await api("POST", "/produits/codes-barres", { entiteId: id }).catch(() => ({ generes: 0 }))).generes;
      relire(`${n} code(s)-barres créé(s).`);
    } }, "Créer les codes-barres manquants")) : null,
    catalogue ? h("details", { class: "carte" }, h("summary", {}, `Catégories et sous-catégories (${categories.length})`),
      racines.length ? racines.map((c) => h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", { class: "nom" }, c.nom), h("span", { class: "discret-texte" }, `${c.articles} article(s)`)),
        h("div", { class: "discret-texte" }, categories.filter((x) => x.parent_id === c.id).map((x) => `${x.nom} (${x.articles})`).join(" · ") || "Aucune sous-catégorie"))) : h("p", { class: "discret-texte" }, "Aucune catégorie."),
      lieux.length ? formulaire(async (v) => { await api("POST", "/categories-articles", { entiteId: lieux[0][0], nom: v.nom.trim(), parentId: v.parentId || undefined }); relire("Catégorie créée."); },
        [h("div", { class: "grille" }, champ("Nom", { name: "nom", required: true, maxlength: 100 }), choix("parentId", "Sous-catégorie de", [["", "Aucune : c'est une catégorie"], ...racines.map((c) => [c.id, c.nom])]))], "Créer") : null) : null,
    h("div", { class: "carte" }, h("h2", {}, `Articles (${articles.length})`),
      formulaire(async (v) => ecranStockArticles(null, v.q.trim()), [champ("Chercher par nom ou code", { name: "q", value: recherche })], "Chercher"),
      articles.length ? articles.map((p) => h("div", { class: "apprenant" },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, vignettePhoto(p), `${p.code} : ${p.nom}`), p.actif ? h("span", {}, fcfa(p.prix_vente)) : h("span", { class: "pastille attente" }, "Inactif")),
        h("div", { class: "discret-texte" }, [p.categorie || "sans catégorie", p.marque, p.code_barres ? `code-barres ${p.code_barres}` : "sans code-barres", `unité : ${p.unite}`, p.type_colis ? `colis : ${p.type_colis}` : null, p.pieces_par_unite !== 1 ? `${quantiteFr(p.pieces_par_unite)} pièces par ${p.unite}` : null,
          p.suivi_stock ? `alerte à ${quantiteFr(p.seuil_alerte)}` : "stock non suivi"].filter(Boolean).join(" · ")),
        catalogue ? h("details", {}, h("summary", {}, "Classer : catégorie, unité, colis"), formulaire(async (v) => {
          await api("PUT", `/produits/${p.id}/classement`, { categorieId: v.categorieId || null, marqueId: v.marqueId || null, unite: v.unite.trim() || undefined, typeColis: v.typeColis.trim() || null, piecesParUnite: v.pieces ? Number(v.pieces) : undefined });
          relire("Article classé.");
        }, [h("div", { class: "grille" }, ...champsClassement(p))], "Enregistrer")) : null,
        catalogue ? blocPhotosArticle(p, relire) : null,
        catalogue ? blocUnitesArticle(p, relire) : null))
        : h("p", { class: "discret-texte" }, "Aucun article.")));
}

/** Petite photo de l'article devant son nom, quand il en a une. */
function vignettePhoto(p) {
  if (!p.photos?.length) return null;
  const img = h("img", { class: "photo-article", alt: "", hidden: true });
  chargerPhotoArticle(img, p.id, p.photos[0]);
  return img;
}
/** Jusqu'à 4 photos par article : la première sert de vignette à la caisse. */
function blocPhotosArticle(p, relire) {
  const prises = new Map((p.photos || []).map((f) => [f.position, f]));
  return h("details", {}, h("summary", {}, `Photos (${prises.size} sur 4)`),
    h("p", { class: "discret-texte" }, "PNG, JPEG ou WebP. La photo est réduite avant l'envoi ; la première sert de vignette à la caisse."),
    h("div", { class: "photos-article" }, [1, 2, 3, 4].map((position) => {
      const zone = h("div");
      const img = h("img", { alt: `Photo ${position} de ${p.nom}`, hidden: true });
      if (prises.has(position)) chargerPhotoArticle(img, p.id, prises.get(position));
      const envoyer = async (e) => {
        const fichier = e.target.files[0];
        if (!fichier) return;
        try {
          await api("PUT", `/produits/${p.id}/photos/${position}`, { image: await reduirePhoto(fichier) });
          relire("Photo enregistrée.");
        } catch (x) { if (x.code !== "obsolete") zone.replaceChildren(h("div", { class: "erreur", role: "alert" }, texteErreur(x))); }
      };
      return h("div", { class: "photo-case" }, img, prises.has(position) ? null : h("span", { class: "discret-texte" }, `Photo ${position}`),
        h("label", { class: "discret-texte" }, prises.has(position) ? "Remplacer" : "Ajouter", h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", onchange: envoyer })),
        prises.has(position) ? h("button", { type: "button", class: "discret", onclick: async () => { await api("DELETE", `/produits/${p.id}/photos/${position}`); relire("Photo retirée."); } }, "Retirer") : null, zone);
    })));
}
/** Unités de vente : conditionnements (carton, palette…) avec leur prix, et prix de la pièce. Le stock reste dans l'unité de base. */
function blocUnitesArticle(p, relire) {
  const zone = h("div");
  const ajouter = (c = {}) => zone.append(h("div", { class: "grille ligne-unite" },
    champ("Unité (carton, palette…)", { name: "un", value: c.nom || "", maxlength: 50 }), champ(`Contient combien de ${p.unite}`, { name: "uf", type: "number", min: 0.001, step: "any", value: c.facteur ?? "" }),
    champ("Prix de vente HT (vide : calculé)", { name: "up", type: "number", min: 0, value: c.prix ?? "" })));
  (p.conditionnements || []).forEach(ajouter);
  if (!zone.children.length) ajouter();
  const unites = unitesDeProduit(p);
  return h("details", {}, h("summary", {}, `Unités de vente (${unites.length})`),
    h("p", { class: "discret-texte" }, `Le stock se compte en ${p.unite}. ${unites.map((u) => `${u.nom} : ${fcfa(u.base ? p.prix_vente : u.prix ?? Math.round(p.prix_vente * u.facteur))}${u.base || u.prix !== null ? "" : " (calculé)"}`).join(" · ")}`),
    formulaire(async (v, f) => {
      const conditionnements = [...zone.children].map((l) => ({ nom: l.querySelector("[name=un]").value.trim(), facteur: Number(l.querySelector("[name=uf]").value), prix: l.querySelector("[name=up]").value === "" ? null : Number(l.querySelector("[name=up]").value) })).filter((c) => c.nom && c.facteur > 0);
      await api("PUT", `/produits/${p.id}/unites`, { conditionnements, ...(p.pieces_par_unite > 1 ? { prixPiece: v.prixPiece === "" ? null : Number(v.prixPiece) } : {}) });
      relire("Unités de vente enregistrées.");
    }, [zone, h("button", { type: "button", class: "discret", onclick: () => ajouter() }, "Ajouter une unité"),
      p.pieces_par_unite > 1 ? champ(`Prix d'une pièce HT (vide : ${fcfa(Math.round(p.prix_vente / p.pieces_par_unite))} calculé)`, { name: "prixPiece", type: "number", min: 0, value: p.prix_piece ?? "" }) : null], "Enregistrer les unités"));
}

/** Dates d'expiration : chaque lot reçu porte sa date ; les sorties consomment d'abord le lot qui expire le plus tôt. */
async function ecranStockExpirations(message) {
  const gere = droits.includes("stocks.gerer");
  const [lots, produits, lieux, refs] = await Promise.all([api("GET", "/lots?jours=3650"), gere ? api("GET", "/produits") : [], gere ? entitesPour("achats_stocks") : [], api("GET", "/entrepots/references")]);
  const suivis = produits.filter((p) => p.suivi_stock && p.actif).map((p) => [p.id, `${p.code} : ${p.nom}`]);
  const relire = (m) => ecranStockExpirations(m);
  const exporter = (format) => exporterTableau(format, {
    nom: nomFichier(`Dates d'expiration ${aujourdhui()}`), titre: "Articles avec date d'expiration", feuille: "Expirations", infos: [`Au ${dateFr(aujourdhui())}`],
    colonnes: [{ titre: "Article", poids: 3 }, { titre: "Lot" }, { titre: "Lieu", poids: 2 }, { titre: "Quantité", droite: true }, { titre: "Expiration" }, { titre: "Jours restants", droite: true }],
    lignes: lots.map((l) => [l.produit, l.numero, l.entite, l.quantite, dateFr(l.peremption), l.jours_restants]),
  });
  vue(
    enteteStock("expirations", message),
    lots.some((l) => l.perime) ? h("div", { class: "bandeau-urgent", role: "alert" }, "Des articles ont dépassé leur date d'expiration : retirez-les de la vente.") : null,
    h("div", { class: "carte" }, h("div", { class: "ligne" }, h("h2", {}, `Articles avec date d'expiration (${lots.length})`), lots.length ? boutonsExport(exporter) : null),
      h("p", { class: "discret-texte" }, `Rouge : date dépassée. Jaune : moins de ${refs.joursAlerte} jours. Les personnes qui gèrent le stock du lieu reçoivent un message.`),
      lots.length ? lots.map((l) => h("div", { class: `apprenant${l.perime ? " bord-urgent" : ""}` },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, `${l.produit} : lot ${l.numero}`), h("span", { class: l.perime ? "pastille retard" : l.jours_restants <= refs.joursAlerte ? "pastille attente" : "pastille ok" }, l.perime ? `Expiré le ${dateFr(l.peremption)}` : `Expire le ${dateFr(l.peremption)}`)),
        h("div", { class: "discret-texte" }, `${quantiteFr(l.quantite)} restant(s) · ${l.entite}${l.perime ? "" : ` · dans ${l.jours_restants} jour(s)`}`),
        gere ? h("details", {}, h("summary", {}, "Sortir en perte"), formulaire(async (v) => { const r = await api("POST", "/demarques", { entiteId: l.entite_id, produitId: l.produit_id, quantite: Number(v.q), motif: v.m.trim() }); relire(`Perte enregistrée : ${fcfa(r.valeur)}.`); },
          [champ("Quantité", { name: "q", type: "number", min: 0.001, step: "any", value: l.quantite, required: true }), champ("Motif", { name: "m", value: l.perime ? "Produit expiré" : "", required: true, minlength: 3 })], "Confirmer")) : null))
        : h("p", { class: "discret-texte" }, "Aucun article avec date d'expiration en stock.")),
    gere && lieux.length && suivis.length ? h("details", { class: "carte" }, h("summary", {}, "Entrée en stock avec date d'expiration"),
      formulaire(async (v) => { await api("POST", "/lots", { entiteId: v.e, produitId: v.p, numero: v.n.trim(), peremption: v.d, quantite: Number(v.q), coutUnitaire: Number(v.c) }); relire("Lot enregistré et entré en stock."); },
        [h("div", { class: "grille" }, choix("p", "Article", suivis), choix("e", "Entrepôt ou magasin", lieux), champ("Numéro de lot", { name: "n", required: true }), champ("Date d'expiration", { name: "d", type: "date", required: true }),
          champ("Quantité", { name: "q", type: "number", min: 0.001, step: "any", required: true }), champ("Coût unitaire (FCFA)", { name: "c", type: "number", min: 0, required: true }))], "Enregistrer")) : null);
}

/** Articles avariés : mis de côté dans leur lieu, puis sortis en perte ou remis en vente. */
async function ecranStockAvaries(message) {
  const gere = droits.includes("stocks.gerer");
  const [avaries, produits, lieux] = await Promise.all([api("GET", "/avaries"), gere ? api("GET", "/produits") : [], gere ? entitesPour("achats_stocks") : []]);
  const suivis = produits.filter((p) => p.suivi_stock && p.actif).map((p) => [p.id, `${p.code} : ${p.nom}`]);
  const relire = (m) => ecranStockAvaries(m);
  const enAttente = avaries.filter((a) => a.statut === "constatee"), decides = avaries.filter((a) => a.statut !== "constatee");
  vue(
    enteteStock("avaries", message),
    h("div", { class: "carte" }, h("h2", {}, `Articles avariés mis de côté${enAttente.length ? ` : ${enAttente.length}` : ""}`),
      enAttente.length ? enAttente.map((a) => h("div", { class: "apprenant" },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, `${a.produit} : ${quantiteFr(a.quantite)} ${a.unite}`), h("span", { class: "pastille prio-important" }, "Avarié")),
        h("div", { class: "discret-texte" }, `${a.entite} · ${a.motif} · ${a.auteur}, ${heure(a.cree_le)}`),
        gere ? h("div", { class: "actions" },
          h("button", { class: "danger", onclick: async () => { const r = await api("POST", `/avaries/${a.id}/decision`, { decision: "sortie" }); relire(`Sorti du stock en perte : ${fcfa(r.valeur)}.`); } }, "Sortir du stock (perte)"),
          h("button", { class: "discret", onclick: async () => { await api("POST", `/avaries/${a.id}/decision`, { decision: "remise" }); relire("Article remis en vente."); } }, "Remettre en vente")) : null))
        : h("p", { class: "discret-texte" }, "Aucun article avarié en attente.")),
    gere && suivis.length && lieux.length ? h("details", { class: "carte" }, h("summary", {}, "Signaler un article avarié"),
      h("p", { class: "discret-texte" }, "L'article reste compté dans l'entrepôt mais n'est plus vendable ni transférable, jusqu'à sa sortie en perte ou sa remise en vente."),
      formulaire(async (v) => { await api("POST", "/avaries", { entiteId: v.entiteId, produitId: v.produitId, quantite: Number(v.quantite), motif: v.motif.trim() }); relire("Article avarié mis de côté."); },
        [h("div", { class: "grille" }, choix("produitId", "Article", suivis), choix("entiteId", "Entrepôt ou magasin", lieux),
          champ("Quantité avariée", { name: "quantite", type: "number", min: 0.001, step: 0.001, required: true }), champ("Ce qui est arrivé", { name: "motif", required: true, minlength: 3 }))], "Mettre de côté")) : null,
    decides.length ? h("details", { class: "carte" }, h("summary", {}, `Historique (${decides.length})`), decides.map((a) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${a.produit} : ${quantiteFr(a.quantite)} ${a.unite}`), h("span", { class: a.statut === "sortie" ? "pastille retard" : "pastille ok" }, a.statut === "sortie" ? "Sorti en perte" : "Remis en vente")),
      h("div", { class: "discret-texte" }, `${a.entite} · ${a.motif} · ${a.decide_par || ""}, ${heure(a.decide_le)}`)))) : null);
}

/** Import d'un fichier d'articles, avec ou sans stock compté. */
async function ecranStockImport(message) {
  const lieux = await entitesPour("achats_stocks");
  vue(
    enteteStock("import", message),
    h("div", { class: "carte" }, h("h2", {}, "Importer des articles (Excel ou CSV)"),
      h("p", { class: "discret-texte" }, "Colonnes obligatoires : Code, Nom, Prix de vente. Facultatives : Unité, Catégorie, Sous-catégorie, Marque, Type de colis, Pièces par unité, Quantité, Coût unitaire, Code-barres. Les catégories et les marques absentes sont créées. Avec un entrepôt choisi, la colonne Quantité fixe le stock compté de ce lieu ; relancer le même fichier ne double rien."),
      h("div", { class: "actions" }, h("button", { type: "button", class: "discret", onclick: () => fichierExcel("Modele import articles", "Articles", [COLONNES_IMPORT_STOCK.map(([, t]) => t), ["RIZ25", "Riz parfumé 25 kg", 21000, "sac", "Alimentation", "Céréales", "Bijou", "sac", 1, 40, 18000, ""]], { grasses: [0], largeurs: [12, 28, 14, 10, 16, 16, 14, 14, 16, 10, 14, 16] }) }, "Télécharger le modèle Excel")),
      lieux.length ? formulaire(async (v, f) => {
        const lignes = lignesImportStock(await lireTableur(f.querySelector("input[type=file]").files[0]));
        const r = await api("POST", "/produits/import", { entiteId: v.entiteId, depotId: v.depotId || undefined, lignes: v.depotId ? lignes : lignes.map(({ quantite, coutUnitaire, ...l }) => l) });
        ecranStockImport(`${r.crees} article(s) créé(s), ${r.maj} mis à jour${v.depotId ? `, ${r.stocks} stock(s) ajusté(s)` : ""}.`);
      }, [h("div", { class: "grille" }, h("label", {}, "Fichier", h("input", { type: "file", accept: ".xlsx,.csv", required: true })),
        choix("entiteId", "Catalogue de", lieux), choix("depotId", "Fixer le stock compté dans", [["", "Ne pas toucher au stock"], ...lieux]))], "Importer") : null),
    h("p", { class: "discret-texte" }, "Pour télécharger le stock en PDF, Excel ou CSV : onglet « État du stock », boutons au-dessus de la liste des articles."));
}
