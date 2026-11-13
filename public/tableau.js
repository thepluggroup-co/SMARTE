"use strict";
/* Tableau de bord de GLOMARI et de GTA, logo sur l'en-tête et les documents, photo de profil. */

const PERIODES_TDB = [["jour", "Aujourd'hui"], ["semaine", "Cette semaine"], ["mois", "Ce mois"], ["annee", "Cette année"]];
const MOYENS_TDB = { especes: "Espèces", orange_money: "Orange Money", mtn_momo: "MTN Mobile Money", banque: "Banque", autre: "Autre" };
const SOURCES_TDB = { facture: "Facture", avoir: "Avoir", caisse: "Caisse", retour: "Retour de caisse", formation: "Formation" };

/** Dates de début et de fin d'une période, au jour de Douala. */
function bornesPeriode(code) {
  const au = aujourdhui();
  const d = new Date(`${au}T00:00:00Z`);
  if (code === "semaine") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (code === "mois") d.setUTCDate(1);
  if (code === "annee") { d.setUTCMonth(0); d.setUTCDate(1); }
  return { du: d.toISOString().slice(0, 10), au };
}

/** Montant court pour les axes : 45 k, 1,2 M. */
const montantCourt = (n) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Md`;
  if (a >= 1e6) return `${(n / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M`;
  if (a >= 1e3) return `${(n / 1e3).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} k`;
  return n.toLocaleString("fr-FR");
};
const dateCourte = (d, gran) => gran === "mois"
  ? new Date(`${d}T00:00:00Z`).toLocaleDateString("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" })
  : `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function svg(tag, attrs = {}, ...enfants) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const e of enfants.flat()) if (e != null) el.append(e);
  return el;
}

/** Variation par rapport à la période précédente, avec flèche et mot : jamais la couleur seule. */
function variationTdb(actuel, precedent, hausseFavorable = true) {
  if (!precedent) return h("span", { class: "variation" }, "Pas de comparaison possible");
  const pct = Math.round(((actuel - precedent) * 100) / Math.abs(precedent));
  if (pct === 0) return h("span", { class: "variation" }, "= stable par rapport à la période précédente");
  const bon = (pct > 0) === hausseFavorable;
  const texte = pct > 999 ? "▲ plus de 10 fois" : `${pct > 0 ? "▲ +" : "▼ "}${pct} %`;
  return h("span", { class: `variation ${bon ? "favorable" : "defavorable"}` }, `${texte} par rapport à la période précédente`);
}

/**
 * Courbe de plusieurs séries sur un même axe, en FCFA.
 * Survol ou flèches du clavier : une ligne verticale suit la date et l'info-bulle donne toutes les valeurs.
 */
function courbeTdb(points, series, gran) {
  const L = 760, H = 260, g = 56, d = 14, hh = 14, b = 30;
  const max = Math.max(1, ...points.flatMap((p) => series.map((s) => Number(p[s.cle]))));
  const pas = Math.pow(10, Math.floor(Math.log10(max)));
  const plafond = Math.ceil(max / pas) * pas;
  const x = (i) => g + (points.length > 1 ? (i * (L - g - d)) / (points.length - 1) : (L - g - d) / 2);
  const y = (v) => hh + (H - hh - b) * (1 - v / plafond);
  const grille = [0, 0.25, 0.5, 0.75, 1].map((f) => svg("g", {},
    svg("line", { x1: g, x2: L - d, y1: y(plafond * f), y2: y(plafond * f), class: "quadrillage-tdb" }),
    svg("text", { x: g - 6, y: y(plafond * f) + 4, "text-anchor": "end", class: "axe-tdb" }, montantCourt(plafond * f))));
  const pasEtiquette = Math.max(1, Math.ceil(points.length / 8));
  // Une date sur quelques-unes, et la dernière, sans chevauchement avec sa voisine.
  const montree = (i) => i === points.length - 1 || (i % pasEtiquette === 0 && points.length - 1 - i >= pasEtiquette / 2);
  const etiquettes = points.map((p, i) => (montree(i)
    ? svg("text", { x: x(i), y: H - 8, "text-anchor": "middle", class: "axe-tdb" }, dateCourte(p.date, gran)) : null));
  const traces = series.map((s) => svg("polyline", {
    points: points.map((p, i) => `${x(i).toFixed(1)},${y(Number(p[s.cle])).toFixed(1)}`).join(" "),
    fill: "none", stroke: `var(${s.couleur})`, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round",
  }));
  const repere = svg("line", { y1: hh, y2: H - b, class: "repere-tdb", visibility: "hidden" });
  const marques = series.map((s) => svg("circle", { r: 4, fill: `var(${s.couleur})`, stroke: "var(--surface-tdb)", "stroke-width": 2, visibility: "hidden" }));
  const bulle = h("div", { class: "bulle-tdb", hidden: true, role: "status" });
  const graphique = svg("svg", { viewBox: `0 0 ${L} ${H}`, class: "courbe-tdb", tabindex: 0, role: "img",
    "aria-label": `${series.map((s) => s.nom).join(" et ")}, ${points.length} points. Flèches gauche et droite pour parcourir.` },
  grille, etiquettes, traces, repere, marques);
  let courant = -1;
  const montrer = (i) => {
    courant = Math.max(0, Math.min(points.length - 1, i));
    const p = points[courant];
    repere.setAttribute("x1", x(courant)); repere.setAttribute("x2", x(courant)); repere.setAttribute("visibility", "visible");
    series.forEach((s, k) => { marques[k].setAttribute("cx", x(courant)); marques[k].setAttribute("cy", y(Number(p[s.cle]))); marques[k].setAttribute("visibility", "visible"); });
    bulle.replaceChildren(h("div", { class: "discret-texte" }, gran === "mois" ? dateCourte(p.date, gran) : dateFr(p.date)),
      ...series.map((s) => h("div", { class: "ligne-bulle" }, h("span", { class: "trait", style: `background: var(${s.couleur})` }), h("b", {}, fcfa(Number(p[s.cle]))), ` ${s.nom}`)));
    bulle.hidden = false;
    const r = graphique.getBoundingClientRect();
    const gauche = (x(courant) / L) * r.width;
    bulle.style.left = `${Math.min(Math.max(gauche - 90, 0), r.width - 180)}px`;
  };
  const cacher = () => { bulle.hidden = true; repere.setAttribute("visibility", "hidden"); marques.forEach((m) => m.setAttribute("visibility", "hidden")); };
  graphique.addEventListener("pointermove", (e) => {
    const r = graphique.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * L;
    montrer(Math.round(((px - g) / (L - g - d)) * (points.length - 1)));
  });
  graphique.addEventListener("pointerleave", cacher);
  graphique.addEventListener("blur", cacher);
  graphique.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); montrer(courant + (e.key === "ArrowRight" ? 1 : -1)); }
  });
  graphique.addEventListener("focus", () => montrer(points.length - 1));
  const legende = series.length > 1 ? h("div", { class: "legende-tdb" }, series.map((s) => h("span", {}, h("span", { class: "trait", style: `background: var(${s.couleur})` }), s.nom))) : null;
  const table = h("details", { class: "pas-imprimer" }, h("summary", {}, "Voir les chiffres"), h("div", { class: "defilant" }, h("table", {},
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Date"), series.map((s) => h("th", { scope: "col" }, s.nom)))),
    h("tbody", {}, points.map((p) => h("tr", {}, h("td", {}, gran === "mois" ? dateCourte(p.date, gran) : dateFr(p.date)),
      series.map((s) => h("td", { class: "nombre" }, Number(p[s.cle]).toLocaleString("fr-FR")))))))));
  return h("div", {}, legende, h("div", { class: "zone-courbe" }, graphique, bulle), table);
}

/** Classement en barres horizontales : nom, barre proportionnelle, valeur écrite. */
function barresTdb(lignes, valeur, libelle, detail) {
  if (!lignes.length) return h("p", { class: "discret-texte" }, "Rien sur cette période.");
  const max = Math.max(...lignes.map((l) => Number(valeur(l))), 1);
  return h("ol", { class: "barres-tdb" }, lignes.map((l, i) => h("li", { title: `${libelle(l)} : ${fcfa(Number(valeur(l)))}` },
    h("div", { class: "ligne" }, h("span", {}, `${i + 1}. ${libelle(l)}`), h("b", {}, fcfa(Number(valeur(l))))),
    h("div", { class: "piste" }, h("div", { class: "barre", style: `width: ${Math.max(2, (Number(valeur(l)) * 100) / max)}%` })),
    detail ? h("div", { class: "discret-texte" }, detail(l)) : null)));
}

let minuterieTdb;
/** Icônes dessinées ici, en traits simples : panier (ventes), colis qui entre (achats), argent qui sort (dépenses), courbe (bénéfice). */
const ICONES_TDB = {
  ventes: ["M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 7H6.2", "M9 20a1.2 1.2 0 1 0 0-2.4A1.2 1.2 0 0 0 9 20z", "M17 20a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z"],
  achats: ["M4 8l8-4 8 4v9l-8 4-8-4z", "M4 8l8 4 8-4", "M12 12v9", "M12 2v5", "M9.5 4.8L12 7l2.5-2.2"],
  entree: ["M4 7h16v11H4z", "M4 10h16", "M12 2v4", "M9.5 4L12 6.5 14.5 4"],
  depenses: ["M3 8h14v10H3z", "M3 11h14", "M17 13h4", "M19 11l2 2-2 2"],
  benefice: ["M3 20h18", "M4 16l5-5 4 3 7-8", "M15 6h5v5"],
};
function iconeTdb(nom) {
  if (!ICONES_TDB[nom]) return null;
  return svg("svg", { viewBox: "0 0 24 24", class: `icone-tdb icone-${nom}`, "aria-hidden": "true" }, ICONES_TDB[nom].map((d) => svg("path", { d })));
}
const tuileTdb = (valeur, libelle, extra, classe = "", icone = "") => h("div", { class: `chiffre ${classe}${icone ? " avec-icone" : ""}` }, iconeTdb(icone), h("b", {}, valeur), h("span", {}, libelle), extra || null);

async function ecranTableauDeBord(choix) {
  let reglage = choix || lireLocal(localStorage, "smarte.tdb", { code: "jour" });
  if (!choix && reglage.code === "perso") reglage = { code: "jour" };
  const bornes = reglage.code === "perso" ? { du: reglage.du, au: reglage.au } : bornesPeriode(reglage.code);
  ecrireLocal(localStorage, "smarte.tdb", reglage);
  const espace = espaceCourant();
  const depart = navigation;
  const t = await api("GET", `/tableau-de-bord/branche?espace=${espace}&du=${bornes.du}&au=${bornes.au}`);
  const nomEspace = espace === "formation" ? "GTA" : "GLOMARI";
  const logo = await logoEspace();
  const libellePeriode = reglage.code === "perso" ? `du ${dateFr(bornes.du)} au ${dateFr(bornes.au)}` : PERIODES_TDB.find((p) => p[0] === reglage.code)[1].toLowerCase();
  const f = t.finances, v = t.ventes, fo = t.formation, a = t.achats, dp = t.depenses, re = t.resume;
  const vide = !f && !v && !fo && !t.stocks && !a;

  vue(
    h("div", { class: "entete-tdb" },
      logo ? h("img", { src: logo, alt: `Logo ${nomEspace}`, class: "logo-tdb" }) : null,
      h("div", {}, h("h1", {}, `Tableau de bord ${nomEspace}`), h("p", { class: "discret-texte" }, `Période : ${libellePeriode}. Mis à jour à ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`))),
    h("div", { class: "carte pas-imprimer filtres-tdb" },
      h("div", { class: "actions" }, PERIODES_TDB.map(([code, nom]) => h("button", { class: code === reglage.code ? "" : "discret", "aria-pressed": String(code === reglage.code), onclick: () => ecranTableauDeBord({ code }) }, nom))),
      formulaire(async (x) => ecranTableauDeBord({ code: "perso", du: x.du, au: x.au }), [h("div", { class: "grille" },
        champ("Du", { name: "du", type: "date", value: bornes.du, required: true }), champ("Au", { name: "au", type: "date", value: bornes.au, max: aujourdhui(), required: true }))], "Afficher cette période")),
    vide ? h("div", { class: "carte" }, h("p", {}, "Vous n'avez pas encore accès aux chiffres de cette branche. Le super administrateur peut vous donner les droits nécessaires.")) : null,

    // GLOMARI : ventes, achats, sorties ou dépenses, bénéfice. GTA garde ventes, entrées, sorties, bénéfice brut.
    espace === "commerce" ? (v || a || dp ? h("div", { class: "chiffres chiffres-tdb" },
      v ? tuileTdb(fcfa(v.total), "Ventes", variationTdb(v.total, v.precedent.total), "entree", "ventes") : null,
      a ? tuileTdb(fcfa(a.total), `Achats (${a.nombre} commande${a.nombre > 1 ? "s" : ""})`, variationTdb(a.total, a.precedent.total, false), "achat", "achats") : null,
      dp ? tuileTdb(fcfa(dp.total), "Sorties ou dépenses", variationTdb(dp.total, dp.precedent.total, false), "sortie", "depenses") : null,
      re ? tuileTdb(fcfa(re.benefice), "Bénéfice", variationTdb(re.benefice, re.precedent.benefice), re.benefice < 0 ? "perte" : "benefice", "benefice") : null) : null)
    : f || v ? h("div", { class: "chiffres chiffres-tdb" },
      v ? tuileTdb(fcfa(v.total), "Ventes", variationTdb(v.total, v.precedent.total), "", "ventes") : null,
      f ? tuileTdb(fcfa(f.entrees), "Entrées d'argent", variationTdb(f.entrees, f.precedent.entrees), "entree", "entree") : null,
      f ? tuileTdb(fcfa(f.sorties), "Sorties et charges", variationTdb(f.sorties, f.precedent.sorties, false), "sortie", "depenses") : null,
      f ? tuileTdb(fcfa(f.benefice), "Bénéfice brut (entrées moins sorties)", variationTdb(f.benefice, f.precedent.benefice), f.benefice < 0 ? "perte" : "benefice", "benefice") : null) : null,
    espace === "commerce" && (v || a || dp) ? h("p", { class: "discret-texte" }, [
      re ? "Bénéfice = ventes moins achats moins dépenses de la période." : null,
      "Achats : bons de commande approuvés. Dépenses : argent sorti des portefeuilles, hors paiement de ces achats et hors remboursements de retours.",
      f ? `Argent entré dans les portefeuilles : ${fcfa(f.entrees)}. Trésorerie disponible : ${fcfa(f.tresorerie)}.` : null,
      "Ces chiffres se mettent à jour seuls à chaque opération. Ce n'est pas le résultat comptable, qui se trouve dans Comptabilité et ne remplace pas l'avis d'un expert agréé.",
    ].filter(Boolean).join(" ")) : null,
    espace !== "commerce" && f ? h("p", { class: "discret-texte" }, `Trésorerie disponible dans les portefeuilles : ${fcfa(f.tresorerie)}. Le bénéfice brut est l'argent entré moins l'argent sorti sur la période ; ce n'est pas le résultat comptable, qui se trouve dans Comptabilité et ne remplace pas l'avis d'un expert agréé.`) : null,

    f ? h("div", { class: "carte" }, h("h2", {}, "Évolution des entrées et des sorties"),
      courbeTdb(f.serie, [{ cle: "entrees", nom: "Entrées", couleur: "--serie-entree" }, { cle: "sorties", nom: "Sorties", couleur: "--serie-sortie" }], t.graphique.granularite),
      t.graphique.du !== t.periode.du ? h("p", { class: "discret-texte" }, "La courbe montre les 30 derniers jours, pour voir la tendance.") : null)
      : v ? h("div", { class: "carte" }, h("h2", {}, "Évolution des ventes"), courbeTdb(v.serie, [{ cle: "montant", nom: "Ventes", couleur: "--serie-entree" }], t.graphique.granularite)) : null,

    h("div", { class: "chiffres" },
      v ? tuileTdb(String(v.nombre), "ventes enregistrées", variationTdb(v.nombre, v.precedent.nombre)) : null,
      v ? tuileTdb(fcfa(v.panier), "panier moyen") : null,
      t.creances ? tuileTdb(fcfa(t.creances.montant), `à encaisser sur ${t.creances.factures} facture${t.creances.factures > 1 ? "s" : ""}`) : null,
      t.stocks ? tuileTdb(fcfa(t.stocks.valeur), "valeur du stock au coût") : null,
      t.stocks ? tuileTdb(String(t.stocks.alertes), "articles sous le seuil d'alerte", null, t.stocks.alertes ? "perte" : "") : null,
      fo ? tuileTdb(String(fo.inscriptions), "inscriptions", variationTdb(fo.inscriptions, fo.inscriptions_prec)) : null,
      fo ? tuileTdb(String(fo.sessions_en_cours), "sessions en cours aujourd'hui") : null,
      fo && fo.remplissage !== null ? tuileTdb(`${fo.remplissage} %`, "remplissage des sessions") : null),

    h("div", { class: "grille-tdb" },
      t.articles ? h("div", { class: "carte" }, h("h2", {}, "Articles les plus vendus"),
        barresTdb(t.articles, (a) => a.montant, (a) => a.nom, (a) => `${quantiteFr(a.quantite)} vendus`)) : null,
      fo ? h("div", { class: "carte" }, h("h2", {}, "Programmes les plus vendus"),
        barresTdb(fo.programmes, (p) => p.encaisse, (p) => p.nom, (p) => `${p.inscriptions} inscription${p.inscriptions > 1 ? "s" : ""} sur la période`)) : null,
      v ? h("div", { class: "carte" }, h("h2", {}, "Meilleurs clients"),
        barresTdb(v.meilleurs_clients, (c) => c.montant, (c) => c.nom, (c) => `${c.achats} achat${c.achats > 1 ? "s" : ""}`)) : null,
      v ? h("div", { class: "carte" }, h("h2", {}, espace === "formation" ? "Meilleurs collaborateurs (encaissements)" : "Meilleurs vendeurs"),
        barresTdb(v.meilleurs_employes, (e) => e.montant, (e) => e.nom, (e) => `${e.ventes} vente${e.ventes > 1 ? "s" : ""}`)) : null,
      fo ? h("div", { class: "carte" }, h("h2", {}, "Meilleurs formateurs"), fo.formateurs.length
        ? h("ol", { class: "barres-tdb" }, fo.formateurs.map((x, i) => h("li", {},
          h("div", { class: "ligne" }, h("span", {}, `${i + 1}. ${x.nom}`), h("b", {}, x.note === null ? "Pas encore d'avis" : `${String(x.note).replace(".", ",")} / 5`)),
          h("div", { class: "discret-texte" }, `${x.sessions} session${x.sessions > 1 ? "s" : ""}, ${x.apprenants} apprenant${x.apprenants > 1 ? "s" : ""}${x.avis ? `, ${x.avis} avis` : ""}`))))
        : h("p", { class: "discret-texte" }, "Aucune session avec formateur sur cette période.")) : null,
      f ? h("div", { class: "carte" }, h("h2", {}, "Entrées par moyen de paiement"),
        barresTdb(f.par_moyen, (m) => m.montant, (m) => MOYENS_TDB[m.moyen] || m.moyen)) : null),

    h("div", { class: "grille-tdb" },
      v ? h("div", { class: "carte" }, h("h2", {}, "Dernières ventes"), v.dernieres.length ? v.dernieres.map((x) => h("div", { class: "apprenant" },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, `${SOURCES_TDB[x.source]} ${x.ref || ""}`), h("b", {}, fcfa(x.montant))),
        h("div", { class: "discret-texte" }, `${heure(x.quand)}${x.client ? ` · ${x.client}` : ""}${x.employe ? ` · ${x.employe}` : ""}`)))
        : h("p", { class: "discret-texte" }, "Aucune vente sur cette période.")) : null,
      f ? h("div", { class: "carte" }, h("h2", {}, "Dernières opérations de trésorerie"), f.operations.length ? f.operations.map((x) => h("div", { class: "apprenant" },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, x.libelle), h("b", {}, x.annulation ? `Annulation ${x.montant > 0 ? "+" : "−"}${fcfa(Math.abs(x.montant))}` : `${x.sens === "sortie" ? "Sortie" : "Entrée"} ${fcfa(Math.abs(x.montant))}`)),
        h("div", { class: "discret-texte" }, `${heure(x.cree_le)} · ${x.portefeuille}`)))
        : h("p", { class: "discret-texte" }, "Aucune opération sur cette période.")) : null),
  );
  // Les chiffres se mettent à jour seuls toutes les minutes tant que l'écran reste ouvert.
  clearTimeout(minuterieTdb);
  minuterieTdb = setTimeout(() => {
    if (depart === navigation && document.visibilityState === "visible" && document.querySelector(".entete-tdb")) ecranTableauDeBord(reglage).catch(() => {});
  }, 60000);
}

/* Logo : celui de la branche de l'espace, sinon celui du groupe. */
let logosConnus = null;
const imagesLogos = new Map();
async function logoEspace() {
  try {
    if (!logosConnus) logosConnus = await api("GET", "/logos");
    const code = dansEspace("formation") ? "GTA" : "GLOMARI";
    const l = logosConnus.find((x) => x.code === code) || logosConnus.find((x) => x.type === "groupe");
    if (!l) return null;
    if (!imagesLogos.has(l.entite_id)) imagesLogos.set(l.entite_id, (await api("GET", `/logos/${l.entite_id}`)).image);
    return imagesLogos.get(l.entite_id);
  } catch { return null; }
}
function oublierLogos() { logosConnus = null; imagesLogos.clear(); }
function oublierSession() { oublierLogos(); photoProfil = undefined; clearTimeout(minuterieTdb); }

let photoProfil;
async function maPhoto() {
  if (photoProfil === undefined) { try { photoProfil = (await api("GET", "/moi/photo")).image; } catch { photoProfil = null; } }
  return photoProfil;
}

/** Après chaque écran : logo en tête de page et sur chaque document à imprimer, photo sur le bouton du compte. */
async function poserEntete() {
  const [logo, photo] = await Promise.all([logoEspace(), maPhoto()]);
  const marque = document.querySelector("header.barre strong");
  if (marque && logo && !marque.querySelector("img")) marque.prepend(h("img", { src: logo, alt: "", class: "logo-barre" }));
  if (logo) for (const d of document.querySelectorAll(".document")) if (!d.querySelector(":scope > .logo-document")) d.prepend(h("img", { src: logo, alt: "Logo", class: "logo-document" }));
  const compte = document.querySelector("header.barre .bouton-compte");
  if (compte && photo && !compte.querySelector("img")) compte.prepend(h("img", { src: photo, alt: "", class: "avatar-barre" }));
}

/** Réduit une image dans le navigateur avant l'envoi : carrée pour une photo, dans un cadre pour un logo. */
async function imageReduite(fichier, { cote, carre, type }) {
  // Lecture en data: : la politique de sécurité du site refuse les adresses blob: pour les images.
  const url = await new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => ko(Object.assign(new Error(), { code: "format_image" })); r.readAsDataURL(fichier); });
  {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(Object.assign(new Error(), { code: "format_image" })); i.src = url; });
    const c = document.createElement("canvas");
    if (carre) {
      const s = Math.min(img.width, img.height);
      c.width = c.height = Math.min(cote, s);
      c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, c.width, c.height);
    } else {
      const r = Math.min(1, cote / Math.max(img.width, img.height));
      c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    }
    return c.toDataURL(type, 0.88);
  }
}

function cartePhotoProfil(relire) {
  const apercu = h("div", { class: "photo-profil" });
  maPhoto().then((p) => apercu.replaceChildren(p ? h("img", { src: p, alt: "Votre photo de profil" }) : h("span", { class: "discret-texte" }, "Pas encore de photo")));
  return h("div", { class: "carte" }, h("h2", {}, "Photo de profil"), apercu,
    formulaire(async (v, f) => {
      const fichier = f.querySelector("input[type=file]").files[0];
      if (!fichier) throw Object.assign(new Error(), { code: "donnees_invalides" });
      await api("PUT", "/moi/photo", { image: await imageReduite(fichier, { cote: 256, carre: true, type: "image/jpeg" }) });
      photoProfil = undefined;
      relire("Photo de profil enregistrée.");
    }, [h("label", {}, "Choisir une photo (JPEG, PNG ou WebP)", h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", required: true }))], "Enregistrer la photo"),
    h("button", { class: "discret", onclick: async () => { await api("DELETE", "/moi/photo"); photoProfil = undefined; relire("Photo retirée."); } }, "Retirer la photo"));
}
