"use strict";
/* Caisse : les ventes faites sans connexion attendent sur l'appareil, avec une clé qui empêche tout doublon à l'envoi. */
let utilisateurCaisse = null;
let synchroEnCours = false;

const lireLocal = (magasin, cle, defaut) => {
  try {
    const v = magasin.getItem(cle);
    return v ? JSON.parse(v) : defaut;
  } catch {
    return defaut;
  }
};
const ecrireLocal = (magasin, cle, valeur) => {
  try {
    magasin.setItem(cle, JSON.stringify(valeur));
    return true;
  } catch {
    return false;
  }
};
const cleFile = () => `smarte.ventes.${utilisateurCaisse}`;
const fileVentes = () => lireLocal(localStorage, cleFile(), []);
const ecrireFile = (file) => ecrireLocal(localStorage, cleFile(), file);

function majBandeauCaisse(message) {
  const zone = document.getElementById("bandeau-caisse");
  if (!zone) return;
  const file = fileVentes();
  const attente = file.filter((v) => !v.erreur);
  const refusees = file.filter((v) => v.erreur);
  zone.replaceChildren(h("div", {},
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    attente.length ? h("div", { class: "alerte-caisse", role: "status" }, `${attente.length} vente(s) sur cet appareil, en attente d'internet. Ne videz pas les données du navigateur.`) : null,
    refusees.map((v) => h("div", { class: "erreur", role: "alert" },
      h("p", {}, `Vente du ${heure(v.corps.vendueLe)}, ${fcfa(v.total)} : non acceptée. ${MESSAGES[v.erreur] || "Erreur inconnue."}`),
      h("div", { class: "actions" },
        h("button", { type: "button", class: "discret", onclick: () => synchroniserCaisse() }, "Réessayer"),
        h("details", {}, h("summary", {}, "Abandonner"),
          h("p", {}, "Notez d'abord cette vente : elle sera effacée de cet appareil."),
          h("button", { type: "button", class: "danger", onclick: () => {
            ecrireFile(fileVentes().filter((x) => x.corps.cleAppareil !== v.corps.cleAppareil));
            majBandeauCaisse();
          } }, "Effacer la vente")))))));
}

/** Une vente refusée reste visible et conservée : elle n'est jamais perdue en silence. */
async function synchroniserCaisse() {
  if (synchroEnCours || !jeton || !utilisateurCaisse) return 0;
  synchroEnCours = true;
  let envoyees = 0;
  try {
    for (const v of fileVentes()) {
      let r;
      try {
        r = await fetch("/caisse/ventes", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${jeton}` },
          body: JSON.stringify(v.corps),
        });
      } catch {
        break;
      }
      if (r.status === 401 || r.status === 429 || r.status >= 500) break;
      const reste = fileVentes().filter((x) => x.corps.cleAppareil !== v.corps.cleAppareil);
      if (r.ok) {
        ecrireFile(reste);
        envoyees += 1;
      } else {
        const d = await r.json().catch(() => ({}));
        ecrireFile([...reste, { ...v, erreur: d.erreur || "inconnue" }]);
      }
    }
  } finally {
    synchroEnCours = false;
  }
  majBandeauCaisse(envoyees ? `${envoyees} vente(s) hors connexion envoyée(s).` : undefined);
  return envoyees;
}
window.addEventListener("online", () => synchroniserCaisse());
setInterval(() => { if (utilisateurCaisse && fileVentes().length) synchroniserCaisse(); }, 60000);

/** La caméra lit les codes quand le navigateur le permet. Sinon, la douchette USB suffit. */
function blocCamera(surCode) {
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) return null;
  const zone = h("div");
  return h("div", {}, h("button", { type: "button", class: "discret", onclick: async () => {
    zone.replaceChildren();
    let flux;
    try {
      flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch {
      zone.replaceChildren(h("p", { class: "erreur" }, "La caméra n'est pas accessible."));
      return;
    }
    const video = h("video", { class: "camera", playsinline: true, muted: true });
    video.srcObject = flux;
    let actif = true;
    const arreter = () => {
      actif = false;
      flux.getTracks().forEach((p) => p.stop());
      zone.replaceChildren();
    };
    zone.replaceChildren(video, h("button", { type: "button", class: "discret", onclick: arreter }, "Fermer la caméra"));
    await video.play().catch(() => {});
    const detecteur = new BarcodeDetector();
    while (actif && video.isConnected) {
      const trouves = await detecteur.detect(video).catch(() => []);
      if (trouves[0]?.rawValue) {
        arreter();
        surCode(trouves[0].rawValue);
        return;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    if (actif) arreter();
  } }, "Scanner avec la caméra"), zone);
}

function blocReglesFidelite(entiteId, regle) {
  return h("details", { class: "carte" }, h("summary", {}, "Règles de fidélité de cette branche"),
    h("p", { class: "discret-texte" }, "Ces valeurs sont les vôtres : aucune n'est imposée par le système."),
    formulaire(async (v) => {
      await api("PUT", `/entites/${entiteId}/fidelite`, { actif: v.actif === "oui", fcfaParPoint: Number(v.fcfa), valeurPoint: Number(v.valeur) });
      ecranCaisse("Règles de fidélité enregistrées.");
    }, [h("div", { class: "grille" },
      choix("actif", "Fidélité", [["oui", "Active"], ["non", "Inactive"]], regle.actif ? "oui" : "non"),
      champ("FCFA d'achat pour gagner 1 point", { name: "fcfa", type: "number", min: 1, value: regle.fcfa_par_point ?? "", required: true }),
      champ("Valeur de 1 point (FCFA)", { name: "valeur", type: "number", min: 0, value: regle.valeur_point ?? "", required: true }))], "Enregistrer les règles"));
}

/** Montant TTC d'une ligne, calculé comme le serveur (src/facturation.ts, calculerLigne). */
function ttcCaisse(quantite, prix, remisePct, taux) {
  const ht = Math.round((Math.round(quantite * 1000) * prix * (10000 - Math.round(remisePct * 100))) / 10000000);
  return ht + Math.round((ht * Math.round(taux * 1000)) / 100000);
}
const sansAccentCaisse = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Les unités qui se vendent au poids ou au volume acceptent des décimales ; les autres se comptent en entiers. */
const quantiteDecimale = (unite) => ["kilogramme", "kg", "gramme", "g", "litre", "l", "metre", "m"].includes(sansAccentCaisse(unite).trim());
let raccourcisCaisse = () => {};
let sonCaisse = null;
/** Bip court produit par le navigateur, sans fichier son. */
function bipCaisse() {
  try {
    sonCaisse ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = sonCaisse.createOscillator(), g = sonCaisse.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.05;
    o.connect(g).connect(sonCaisse.destination);
    o.start();
    o.stop(sonCaisse.currentTime + 0.06);
  } catch { /* pas de son : la vente continue */ }
}

async function ecranCaisse(message) {
  let c, produits, ventes = [], regle = { actif: false }, horsLigne = false;
  try {
    const moi = await api("GET", "/moi");
    utilisateurCaisse = moi.utilisateurId || moi.id;
    droits = moi.permissions;
    [c, produits] = await Promise.all([api("GET", "/caisse"), api("GET", "/produits")]);
    if (c.ouvertes[0]) {
      await synchroniserCaisse();
      [c, ventes, regle] = await Promise.all([api("GET", "/caisse"), api("GET", `/caisse/sessions/${c.ouvertes[0].id}/ventes`), api("GET", `/fidelite?entiteId=${c.ouvertes[0].entite_id}`)]);
    }
    ecrireLocal(sessionStorage, "smarte.caisse", { utilisateurCaisse, droits, c, produits });
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    const copie = lireLocal(sessionStorage, "smarte.caisse", null);
    if (!copie?.c.ouvertes[0]) throw e;
    ({ utilisateurCaisse, droits, c, produits } = copie);
    horsLigne = true;
  }
  if (!c.lieux.length) return vue(h("h1", {}, "Caisse"), h("p", { class: "discret-texte" }, "Aucun lieu de vente disponible."));
  const session = c.ouvertes[0];
  const bandeau = h("div", { id: "bandeau-caisse" });
  if (!session) {
    vue(h("h1", {}, "Caisse"), message ? h("div", { class: "succes", role: "status" }, message) : null, bandeau,
      h("div", { class: "carte" }, h("h2", {}, "Ouvrir ma caisse"), formulaire(async (v) => {
        await api("POST", "/caisse/ouverture", { entiteId: v.entiteId, fondOuverture: Number(v.fond) });
        ecranCaisse("Caisse ouverte.");
      }, [h("div", { class: "grille" }, choix("entiteId", "Lieu", c.lieux.map((l) => [l.id, l.nom])),
        champ("Fond de caisse (FCFA)", { name: "fond", type: "number", min: 0, value: 0, required: true }))], "Ouvrir la caisse")),
      droits.includes("caisse.superviser") ? await blocSessions() : null);
    return majBandeauCaisse();
  }
  const actifs = produits.filter((p) => p.actif);
  const stocks = session.stocks || {}, series = session.series || {}, categories = session.categories || [], marques = session.marques || [];
  const remiseMax = session.remise_max ?? 10;
  const panier = new Map();
  let client = null, remiseGlobale = null, page = 0, categorie = "", marque = "";
  const taxe = (p) => p.taux_taxe || 0;
  // Prix de l'unité de base : paliers selon la quantité de base, puis promotion. Comme le serveur.
  const prixBase = (p, q) => {
    const x = p.paliers_actif ? [...(p.paliers || [])].sort((a, b) => b.quantite_min - a.quantite_min).find((y) => q >= y.quantite_min)?.prix ?? p.prix_vente : p.prix_vente;
    const o = p.promo;
    return !o ? x : o.type === "pourcentage" ? Math.round((x * (100 - o.valeur)) / 100) : Math.max(x - o.valeur, 0);
  };
  /** Unité de vente de la ligne : celle du stock, sauf autre choix (pièce, carton…). */
  const uniteLigne = (l) => { const u = unitesDeProduit(l.p); return u.find((x) => x.nom === l.unite) || u[0]; };
  const prixLigne = (l) => { const u = uniteLigne(l); const b = prixBase(l.p, l.q * u.facteur); return u.base ? b : u.prix ?? Math.round(b * u.facteur); };
  const brutLigne = (l) => ttcCaisse(l.q, prixLigne(l), 0, taxe(l.p));
  const ttcLigne = (l) => (l.remise?.type === "montant" ? Math.max(brutLigne(l) - l.remise.valeur, 0) : ttcCaisse(l.q, prixLigne(l), l.remise?.type === "pct" ? l.remise.valeur : 0, taxe(l.p)));
  const sousTotal = () => [...panier.values()].reduce((s, l) => s + ttcLigne(l), 0);
  const montantRemiseGlobale = () => (!remiseGlobale ? 0 : remiseGlobale.type === "pct" ? Math.round((sousTotal() * Math.round(remiseGlobale.valeur * 100)) / 10000) : Math.min(remiseGlobale.valeur, sousTotal()));
  const total = () => sousTotal() - montantRemiseGlobale();
  const zonePanier = h("div", { class: "caisse-lignes" }), zoneTotaux = h("div"), zoneGrille = h("div"), zoneSuggestions = h("div", { class: "caisse-suggestions" }), zoneScan = h("div"), zoneClient = h("div");
  const vendeur = h("select", { "aria-label": "Vendeur" }, (session.vendeurs?.length ? session.vendeurs : [{ id: utilisateurCaisse, nom: "Moi" }]).map((x) => h("option", { value: x.id, selected: x.id === utilisateurCaisse }, x.nom)));
  const fenetre = (titre, contenu) => {
    const d = h("dialog", { class: "fenetre", "aria-label": titre }, h("div", { class: "ligne" }, h("h2", {}, titre), h("button", { type: "button", class: "discret", onclick: () => d.close() }, "Fermer")), contenu);
    d.addEventListener("close", () => d.remove());
    document.body.append(d);
    d.showModal();
    return d;
  };

  const dessiner = () => {
    const lignes = [...panier.values()];
    zonePanier.replaceChildren(...(lignes.length ? lignes.map((l) => h("button", { type: "button", class: "session caisse-ligne", onclick: () => ouvrirLigne(l) },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, l.p.nom), h("span", {}, fcfa(ttcLigne(l)))),
      h("div", { class: "discret-texte" }, [`${quantiteFr(l.q)} ${uniteLigne(l).nom} × ${fcfa(ttcCaisse(1, prixLigne(l), 0, taxe(l.p)))}`,
        l.remise ? `remise ${l.remise.type === "pct" ? `${l.remise.valeur} %` : fcfa(l.remise.valeur)}` : null, l.series?.length ? `série : ${l.series.join(", ")}` : null].filter(Boolean).join(" · "))))
      : [h("p", { class: "discret-texte" }, "Panier vide. Touchez un article, cherchez-le ou scannez son code.")]));
    const g = montantRemiseGlobale();
    zoneTotaux.replaceChildren(
      g ? h("div", { class: "ligne" }, h("span", {}, "Sous-total"), h("span", {}, fcfa(sousTotal()))) : null,
      g ? h("div", { class: "ligne" }, h("span", {}, `Remise sur la vente${remiseGlobale.type === "pct" ? ` (${remiseGlobale.valeur} %)` : ""}`), h("span", {}, `− ${fcfa(g)}`)) : null,
      h("div", { class: "ligne caisse-total" }, h("span", {}, "Total"), h("b", {}, fcfa(total()))));
  };
  const ajouter = (p, q = 1) => {
    const l = panier.get(p.id) || { p, q: 0 };
    l.q = Math.round((l.q + q) * 1000) / 1000;
    panier.set(p.id, l);
    bipCaisse();
    dessiner();
  };
  /** Fenêtre d'une ligne : quantité, remise en % ou en montant, numéros de série. */
  const ouvrirLigne = (l) => {
    const unites = unitesDeProduit(l.p);
    const decimal = quantiteDecimale(uniteLigne(l).nom);
    const d = fenetre(l.p.nom, formulaire(async (v) => {
      const u = unites.find((x) => x.nom === v.unite) || unites[0];
      const decimal = quantiteDecimale(u.nom);
      const q = Number(String(v.q).replace(",", "."));
      if (!(q > 0)) { panier.delete(l.p.id); d.close(); return dessiner(); }
      const valeur = Number(String(v.remise || "0").replace(",", "."));
      const numeros = (v.series || "").split(/[\n,;]/).map((x) => x.trim()).filter(Boolean);
      if (numeros.length > Math.ceil(q)) throw Object.assign(new Error(), { code: "donnees_invalides" });
      l.q = decimal ? Math.round(q * 1000) / 1000 : Math.round(q);
      l.unite = u.base ? undefined : u.nom;
      l.remise = v.type !== "aucune" && valeur > 0 ? { type: v.type, valeur: v.type === "pct" ? Math.min(valeur, 100) : Math.round(valeur) } : null;
      l.series = numeros;
      d.close();
      dessiner();
    }, [h("div", { class: "grille" },
      champ("Quantité", { name: "q", type: "number", min: 0, step: decimal ? "0.001" : "1", value: l.q, required: true, inputmode: decimal ? "decimal" : "numeric", autofocus: true }),
      unites.length > 1 ? choix("unite", "Unité de vente", unites.map((u) => [u.nom, `${u.nom} : ${fcfa(ttcCaisse(1, u.base ? prixBase(l.p, 1) : u.prix ?? Math.round(prixBase(l.p, u.facteur) * u.facteur), 0, taxe(l.p)))}`]), uniteLigne(l).nom)
        : h("label", {}, "Unité de vente", h("input", { name: "unite", value: unites[0].nom, readonly: true })),
      choix("type", "Remise", [["aucune", "Aucune"], ["pct", "En pourcentage"], ["montant", "En montant (FCFA)"]], l.remise?.type || "aucune"),
      champ("Valeur de la remise", { name: "remise", type: "number", min: 0, step: "any", value: l.remise?.valeur ?? "" })),
      h("p", { class: "discret-texte" }, session.superviseur ? "Vous pouvez accorder toute remise." : `Au delà de ${remiseMax} %, la remise doit être accordée par un responsable.`),
      series[l.p.id] && !horsLigne ? h("label", {}, `Numéros de série vendus (${series[l.p.id]} en stock), un par ligne`, h("textarea", { name: "series", rows: 2 }, (l.series || []).join("\n"))) : null,
      h("p", { class: "discret-texte" }, `Stock de ce lieu : ${quantiteFr(stocks[l.p.id] ?? 0)} ${l.p.unite || ""}. Une quantité à zéro retire l'article du panier.`)], "Valider"));
  };
  const ouvrirRemiseGlobale = () => {
    const d = fenetre("Remise sur toute la vente", formulaire(async (v) => {
      const valeur = Number(String(v.valeur || "0").replace(",", "."));
      remiseGlobale = v.type !== "aucune" && valeur > 0 ? { type: v.type, valeur: v.type === "pct" ? Math.min(valeur, 100) : Math.round(valeur) } : null;
      d.close();
      dessiner();
    }, [h("div", { class: "grille" }, choix("type", "Remise", [["aucune", "Aucune"], ["pct", "En pourcentage"], ["montant", "En montant (FCFA)"]], remiseGlobale?.type || "pct"),
      champ("Valeur", { name: "valeur", type: "number", min: 0, step: "any", value: remiseGlobale?.valeur ?? "", autofocus: true })),
      h("p", { class: "discret-texte" }, `La remise est répartie sur chaque article. ${session.superviseur ? "" : `Plafond sans responsable : ${remiseMax} %.`}`)], "Valider"));
  };

  // ---------- Articles : recherche unique, filtre par catégorie, vignettes ----------
  const recherche = h("input", { name: "recherche", type: "search", placeholder: "Chercher ou scanner : nom, code, code-barres (F2)", autocomplete: "off", "aria-label": "Chercher un article" });
  const correspond = (p, q) => sansAccentCaisse(p.nom).includes(q) || sansAccentCaisse(p.code).includes(q) || (p.code_barres || "").includes(q);
  const filtres = () => {
    const q = sansAccentCaisse(recherche.value.trim());
    const sous = categorie ? new Set([categorie, ...categories.filter((c) => c.parent_id === categorie).map((c) => c.id)]) : null;
    return actifs.filter((p) => (!q || correspond(p, q)) && (!sous || sous.has(p.categorie_id)) && (!marque || p.marque_id === marque));
  };
  const ajouterCode = (code) => {
    const p = actifs.find((x) => x.code_barres === code || x.code.toLowerCase() === code.toLowerCase());
    zoneScan.replaceChildren(p ? h("span", { class: "discret-texte", role: "status" }, `Ajouté : ${p.nom}`) : h("div", { class: "erreur", role: "alert" }, `Code inconnu : ${code}`));
    if (p) ajouter(p);
    return !!p;
  };
  const PAR_PAGE = 24;
  const dessinerGrille = () => {
    const liste = filtres();
    const pages = Math.max(Math.ceil(liste.length / PAR_PAGE), 1);
    page = Math.min(page, pages - 1);
    zoneGrille.replaceChildren(
      h("div", { class: "caisse-grille" }, liste.slice(page * PAR_PAGE, (page + 1) * PAR_PAGE).map((p) => {
        const q = stocks[p.id];
        // Photo de l'article si elle existe (et si le réseau répond), sinon son initiale.
        const initiale = h("span", { class: "caisse-initiale", "aria-hidden": "true" }, (p.nom.trim()[0] || "?").toUpperCase());
        const photo = p.photos?.length && !horsLigne ? h("img", { class: "caisse-photo", alt: "", hidden: true, onload: () => { initiale.hidden = true; } }) : null;
        if (photo) chargerPhotoArticle(photo, p.id, p.photos[0]);
        return h("button", { type: "button", class: "caisse-vignette", onclick: () => ajouter(p), "aria-label": `Ajouter ${p.nom}` },
          photo, initiale,
          h("span", { class: "nom" }, p.nom),
          h("b", {}, fcfa(ttcCaisse(1, prixLigne({ p, q: 1 }), 0, taxe(p)))),
          p.suivi_stock ? h("span", { class: `pastille${(q ?? 0) <= 0 ? " retard" : (q ?? 0) <= (p.seuil_alerte || 0) ? " attente" : " ok"}` }, `Stock : ${quantiteFr(q ?? 0)}`) : h("span", { class: "discret-texte" }, "Sans stock"));
      })),
      liste.length ? null : h("p", { class: "discret-texte" }, "Aucun article pour cette recherche."),
      pages > 1 ? h("div", { class: "actions" }, h("button", { type: "button", class: "discret", disabled: page === 0, onclick: () => { page -= 1; dessinerGrille(); } }, "← Précédents"),
        h("span", { class: "discret-texte" }, `Page ${page + 1} sur ${pages}`), h("button", { type: "button", class: "discret", disabled: page >= pages - 1, onclick: () => { page += 1; dessinerGrille(); } }, "Suivants →")) : null);
  };
  const dessinerSuggestions = () => {
    const q = sansAccentCaisse(recherche.value.trim());
    zoneSuggestions.replaceChildren(...(q.length < 2 ? [] : filtres().slice(0, 6).map((p) => h("button", { type: "button", class: "discret", onclick: () => { ajouter(p); recherche.value = ""; dessinerSuggestions(); dessinerGrille(); recherche.focus(); } }, `${p.nom} · ${p.code}`))));
  };
  recherche.addEventListener("input", () => { page = 0; dessinerSuggestions(); dessinerGrille(); });
  recherche.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const saisie = recherche.value.trim();
    if (!saisie) return;
    // Un code exact (douchette ou clavier) ajoute l'article ; sinon l'unique résultat de la recherche.
    const seul = filtres();
    if (ajouterCode(saisie) || (seul.length === 1 && (ajouter(seul[0]), zoneScan.replaceChildren(), true))) { recherche.value = ""; page = 0; dessinerSuggestions(); dessinerGrille(); }
  });
  const choixCategorie = categories.length ? h("select", { "aria-label": "Catégorie", onchange: (e) => { categorie = e.target.value; page = 0; dessinerGrille(); } }, h("option", { value: "" }, "Toutes les catégories"),
    categories.filter((c) => !c.parent_id).flatMap((c) => [h("option", { value: c.id }, c.nom), ...categories.filter((x) => x.parent_id === c.id).map((x) => h("option", { value: x.id }, `${c.nom} › ${x.nom}`))])) : null;

  const choixMarque = marques.length ? h("select", { "aria-label": "Marque", onchange: (e) => { marque = e.target.value; page = 0; dessinerGrille(); } }, h("option", { value: "" }, "Toutes les marques"), marques.map((m) => h("option", { value: m.id }, m.nom))) : null;

  // ---------- Client : recherche, création rapide, points ----------
  const montrerClient = () => zoneClient.replaceChildren(client ? h("div", { class: "ligne" },
    h("span", {}, h("b", {}, client.nom), ` · ${client.telephone || ""}${client.points !== undefined ? ` · ${client.points} point(s)` : ""}${client.reste_du > 0 ? ` · doit déjà ${fcfa(client.reste_du)}` : ""}`),
    h("button", { type: "button", class: "discret", onclick: () => { client = null; montrerClient(); } }, "Retirer")) : null);
  const choisirClient = async (t) => {
    client = { ...t };
    if (regle.actif && t.telephone) client.points = (await api("GET", `/fidelite/client?telephone=${encodeURIComponent(t.telephone)}&entiteId=${session.entite_id}`).catch(() => ({ points: 0 }))).points;
    montrerClient();
  };
  const ouvrirClient = () => {
    const resultats = h("div");
    const d = fenetre("Client", h("div", {},
      formulaire(async (v) => {
        const liste = await api("GET", `/caisse/clients?entiteId=${session.entite_id}&q=${encodeURIComponent(v.q.trim())}`);
        resultats.replaceChildren(...(liste.length ? liste.map((t) => h("button", { type: "button", class: "session", onclick: async () => { await choisirClient(t); d.close(); } },
          h("span", { class: "nom" }, t.nom), h("div", { class: "discret-texte" }, `${t.telephone || ""}${t.reste_du > 0 ? ` · doit ${fcfa(t.reste_du)}` : ""}`)))
          : [h("p", { class: "discret-texte" }, "Aucun client trouvé dans cette branche.")]));
      }, [champ("Nom ou téléphone", { name: "q", required: true, minlength: 2, autofocus: true })], "Chercher"),
      resultats,
      h("details", {}, h("summary", {}, "Nouveau client"), formulaire(async (v) => {
        const t = await api("POST", "/caisse/clients", { entiteId: session.entite_id, nom: v.nom.trim(), telephone: v.telephone.trim() });
        await choisirClient(t);
        d.close();
      }, [h("div", { class: "grille" }, champ("Nom", { name: "nom", required: true, minlength: 2 }), champ("Téléphone", { name: "telephone", type: "tel", required: true, minlength: 6 }))], "Créer et choisir"))));
  };

  // ---------- Paiement : plusieurs moyens dans une seule fenêtre ----------
  const corpsVente = (paiements, credit, echeance) => ({
    entiteId: session.entite_id, cleAppareil: crypto.randomUUID(), tiersId: client?.id, vendeurId: vendeur.value || undefined,
    lignes: [...panier.values()].map((l) => ({
      produitId: l.p.id, quantite: l.q, ...(l.unite ? { unite: l.unite } : {}),
      ...(l.remise?.type === "pct" ? { remisePct: l.remise.valeur } : l.remise?.type === "montant" ? { remiseMontant: Math.min(l.remise.valeur, brutLigne(l)) } : {}),
      ...(l.series?.length && !horsLigne ? { numerosSerie: l.series } : {}),
    })),
    ...(remiseGlobale ? { remiseGlobaleMontant: montantRemiseGlobale() } : {}),
    paiements, ...(credit ? { credit: true, echeance: echeance || undefined } : {}),
  });
  const ticketLocal = (paiements, ttc) => ({
    numero: "provisoire", provisoire: true, total_ttc: ttc, total_taxes: 0, rendu: Math.max(paiements.reduce((s, p) => s + p.montant, 0) - ttc, 0), reste_du: 0,
    vendeur: vendeur.selectedOptions[0]?.textContent, client: client?.nom, remise_totale: [...panier.values()].reduce((s, l) => s + brutLigne(l) - ttcLigne(l), 0) + montantRemiseGlobale(), paiements,
    lignes: [...panier.values()].map((l) => ({ designation: l.p.nom, quantite: l.q, unite: uniteLigne(l).nom, montant_ttc: ttcLigne(l), remise_montant: brutLigne(l) - ttcLigne(l) })),
  });
  const ouvrirPaiement = () => {
    if (!panier.size) return zoneScan.replaceChildren(h("div", { class: "erreur", role: "alert" }, "Le panier est vide."));
    const ttc = total();
    const zoneLignes = h("div"), zoneBilan = h("div", { class: "caisse-bilan" });
    const moyens = MOYENS.filter(([m]) => m !== "virement");
    const peutCredit = session.credit && !horsLigne;
    const credit = h("input", { type: "checkbox", name: "credit" }), echeance = h("input", { type: "date", name: "echeance", min: aujourdhui() });
    const points = h("input", { type: "number", min: 0, value: 0, "aria-label": "Payer avec les points (FCFA)" });
    const lire = () => [...zoneLignes.children].map((l) => ({ moyen: l.querySelector("select").value, montant: Math.round(Number(l.querySelector("[name=montant]").value || 0)), reference: l.querySelector("[name=reference]").value.trim() })).filter((p) => p.montant > 0);
    const bilan = () => {
      const recu = lire().reduce((s, p) => s + p.montant, 0) + Number(points.value || 0);
      zoneBilan.replaceChildren(
        h("div", { class: "ligne caisse-total" }, h("span", {}, "Total à payer"), h("b", {}, fcfa(ttc))),
        h("div", { class: "ligne" }, h("span", {}, "Reçu"), h("span", {}, fcfa(recu))),
        recu >= ttc ? h("div", { class: "ligne grand" }, h("span", {}, "Monnaie à rendre"), h("b", {}, fcfa(recu - ttc)))
          : h("div", { class: "ligne grand texte-rouge" }, h("span", {}, credit.checked ? "Reste dû (crédit)" : "Il manque"), h("b", {}, fcfa(ttc - recu))));
    };
    const ajouterLigne = (montant = "") => {
      const ligne = h("div", { class: "grille caisse-paiement" },
        h("label", {}, "Moyen", h("select", { onchange: bilan }, moyens.map(([c, l]) => h("option", { value: c }, l)))),
        h("label", {}, "Montant (FCFA)", h("input", { name: "montant", type: "number", min: 0, value: montant, oninput: bilan, inputmode: "numeric" })),
        h("label", {}, "Référence (sauf espèces)", h("input", { name: "reference", maxlength: 100 })),
        h("button", { type: "button", class: "discret", onclick: () => { if (zoneLignes.children.length > 1) { ligne.remove(); bilan(); } } }, "Retirer"));
      zoneLignes.append(ligne);
      bilan();
    };
    const d = fenetre("Encaisser", formulaire(async () => {
      const paiements = lire();
      const pts = client && regle.valeur_point ? Math.round(Number(points.value || 0)) : 0;
      for (const p of paiements) if (p.moyen !== "especes" && !p.reference) throw Object.assign(new Error(), { code: "reference_obligatoire" });
      const envoi = [...(pts ? [{ moyen: "points", montant: pts }] : []), ...paiements.map((p) => ({ moyen: p.moyen, montant: p.montant, reference: p.reference || undefined }))];
      const recu = envoi.reduce((s, p) => s + p.montant, 0);
      const aCredit = peutCredit && credit.checked && recu < ttc;
      if (recu < ttc && !aCredit) throw Object.assign(new Error(), { code: "paiement_insuffisant" });
      if (aCredit && !client) throw Object.assign(new Error(), { code: "credit_sans_client" });
      const corps = corpsVente(envoi, aCredit, echeance.value);
      let ticket;
      try {
        ticket = { ...(await api("POST", "/caisse/ventes", corps)), client: client?.nom };
      } catch (e) {
        if (!(e instanceof TypeError)) throw e;
        // Sans connexion : la vente attend sur l'appareil. Jamais de crédit dans ce cas.
        if (aCredit) throw Object.assign(new Error(), { code: "credit_hors_connexion" });
        const enAttente = { ...corps, horsLigne: true, vendueLe: new Date().toISOString() };
        enAttente.lignes = enAttente.lignes.map(({ numerosSerie, ...l }) => l);
        if (!ecrireFile([...fileVentes(), { corps: enAttente, total: ttc }])) throw Object.assign(new Error(), { code: "stockage_impossible" });
        ticket = ticketLocal(envoi, ttc);
      }
      d.close();
      voirTicket(ticket, session);
    }, [zoneLignes,
      h("button", { type: "button", class: "discret", onclick: () => ajouterLigne() }, "Ajouter un moyen de paiement"),
      client?.points > 0 && regle.valeur_point && !horsLigne ? h("label", {}, `Payer avec les points (${client.points} point(s), soit ${fcfa(client.points * regle.valeur_point)})`, points) : null,
      peutCredit ? h("fieldset", {}, h("legend", {}, "Vente à crédit"),
        client ? h("label", { class: "case" }, credit, `Laisser le reste en crédit à ${client.nom}`) : h("p", { class: "discret-texte" }, "Choisissez d'abord un client pour vendre à crédit."),
        client ? h("label", {}, "À payer avant le (facultatif)", echeance) : null) : null,
      zoneBilan], "Valider la vente"));
    points.addEventListener("input", bilan);
    credit.addEventListener("change", bilan);
    ajouterLigne(ttc);
    d.querySelector("[name=montant]").select();
  };

  // ---------- Raccourcis : F2 recherche, F9 encaisser. Échap ferme la fenêtre ouverte (comportement du navigateur). ----------
  document.removeEventListener("keydown", raccourcisCaisse);
  raccourcisCaisse = (e) => {
    if (!document.querySelector(".caisse-deux")) return document.removeEventListener("keydown", raccourcisCaisse);
    if (e.key === "F2") { e.preventDefault(); if (!document.querySelector("dialog[open]")) recherche.focus(); }
    if (e.key === "F9") { e.preventDefault(); if (!document.querySelector("dialog[open]")) ouvrirPaiement(); }
  };
  document.addEventListener("keydown", raccourcisCaisse);

  const credits = horsLigne ? [] : await api("GET", `/caisse/credits?entiteId=${session.entite_id}`).catch(() => []);
  vue(
    h("div", { class: "ligne" }, h("h1", {}, `Caisse : ${session.entite}`),
      h("button", { type: "button", class: "discret pas-imprimer", onclick: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {})) }, "Plein écran")),
    horsLigne ? h("div", { class: "alerte-caisse", role: "status" }, "Pas de connexion. Vous pouvez continuer à vendre : les ventes partiront au retour d'internet. Le stock affiché n'est pas vérifié. Crédit et nouveaux clients attendent la connexion.") : null,
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    bandeau,
    h("div", { class: "caisse-deux" },
      h("section", { class: "carte caisse-panier", "aria-label": "Panier" },
        h("div", { class: "ligne" }, h("h2", {}, "Panier"), h("label", { class: "caisse-vendeur" }, "Vendeur", vendeur)),
        horsLigne ? null : h("div", { class: "actions" }, h("button", { type: "button", class: "discret", onclick: ouvrirClient }, "Client")),
        zoneClient, zonePanier, zoneTotaux,
        h("div", { class: "actions" }, h("button", { type: "button", class: "discret", onclick: ouvrirRemiseGlobale }, "Remise sur la vente"),
          h("button", { type: "button", class: "discret", onclick: () => { panier.clear(); remiseGlobale = null; dessiner(); } }, "Vider")),
        h("button", { type: "button", class: "caisse-encaisser", onclick: ouvrirPaiement }, "Encaisser (F9)")),
      h("section", { class: "carte caisse-articles", "aria-label": "Articles" },
        h("div", { class: "grille" }, h("label", {}, "Article", recherche), choixCategorie ? h("label", {}, "Catégorie", choixCategorie) : null, choixMarque ? h("label", {}, "Marque", choixMarque) : null),
        zoneSuggestions, zoneScan, blocCamera(ajouterCode), zoneGrille)),
    h("div", { class: "chiffres" },
      h("div", { class: "chiffre" }, h("b", {}, fcfa(session.ventes)), h("span", {}, `${session.nombre} vente(s)`)),
      h("div", { class: "chiffre" }, h("b", {}, fcfa(session.fond_ouverture + session.especes_nettes)), h("span", {}, "Espèces attendues")),
      session.credits_accordes ? h("div", { class: "chiffre" }, h("b", {}, fcfa(session.credits_accordes)), h("span", {}, "Crédits accordés")) : null),
    credits.length ? h("details", { class: "carte" }, h("summary", {}, `Crédits à encaisser (${credits.length})`), credits.map((x) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${x.client} : reste ${fcfa(x.reste)}`), x.en_retard ? h("span", { class: "pastille retard" }, "En retard") : null),
      h("div", { class: "discret-texte" }, `${x.numero} · ${heure(x.vendue_le)} · total ${fcfa(x.total_ttc)}${x.echeance ? ` · à payer avant le ${dateFr(x.echeance)}` : ""}${x.telephone ? ` · ${x.telephone}` : ""}`),
      h("details", {}, h("summary", {}, "Encaisser"), formulaire(async (v) => {
        const r = await api("POST", `/caisse/ventes/${x.id}/reglements`, { paiements: [{ moyen: v.moyen, montant: Number(v.montant), reference: v.reference.trim() || undefined }] });
        ecranCaisse(`Règlement de ${fcfa(r.regle)} enregistré pour ${r.numero}. Reste dû : ${fcfa(r.reste)}.`);
      }, [h("div", { class: "grille" }, choix("moyen", "Moyen", MOYENS.filter(([m]) => m !== "virement")), champ("Montant (FCFA)", { name: "montant", type: "number", min: 1, max: x.reste, value: x.reste, required: true }), champ("Référence (sauf espèces)", { name: "reference" }))], "Encaisser"))))) : null,
    horsLigne ? null : h("div", { class: "carte" }, h("h2", {}, "Ventes de cette caisse"), ventes.length ? ventes.map((x) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${x.numero} : ${fcfa(x.total_ttc)}`),
        x.reste_du > 0 && !x.annulee_le ? h("span", { class: "pastille attente" }, `Crédit : ${fcfa(x.reste_du)}`) : null,
        x.annulee_le ? h("span", { class: "pastille retard" }, "Annulée") : x.hors_ligne ? h("span", { class: "pastille attente" }, "Hors connexion : stock à vérifier") : null),
      h("div", { class: "discret-texte" }, [heure(x.vendue_le || x.cree_le), x.vendeur ? `vendeur : ${x.vendeur}` : null, x.client, x.motif_annulation].filter(Boolean).join(" · ")),
      h("div", { class: "actions" }, h("button", { type: "button", class: "discret", onclick: () => ecranTicketCaisse(x.id, session) }, "Voir le ticket ou faire un retour")),
      !x.annulee_le && droits.includes("caisse.superviser") ? h("details", {}, h("summary", {}, "Annuler"), formulaire(async (f) => {
        await api("POST", `/caisse/ventes/${x.id}/annulation`, { motif: f.motif.trim() });
        ecranCaisse("Vente annulée. Les articles sont revenus en stock.");
      }, [champ("Motif (obligatoire)", { name: "motif", required: true, minlength: 5 })], "Confirmer")) : null))
      : h("p", { class: "discret-texte" }, "Aucune vente.")),
    horsLigne ? null : h("details", { class: "carte" }, h("summary", {}, "Retrouver un ticket (retour, réimpression)"), (() => {
      const trouves = h("div");
      return h("div", {}, formulaire(async (v) => {
        const liste = await api("GET", `/caisse/tickets?entiteId=${session.entite_id}&numero=${encodeURIComponent(v.numero.trim())}`);
        trouves.replaceChildren(...(liste.length ? liste.map((t) => h("button", { type: "button", class: "session", onclick: () => ecranTicketCaisse(t.id, session) },
          h("div", { class: "ligne" }, h("span", { class: "nom" }, `${t.numero} : ${fcfa(t.total_ttc)}`), t.annulee_le ? h("span", { class: "pastille retard" }, "Annulée") : null),
          h("div", { class: "discret-texte" }, `${heure(t.cree_le)}${t.client ? ` · ${t.client}` : ""}`))) : [h("p", { class: "discret-texte" }, "Aucun ticket avec ce numéro dans ce lieu.")]));
      }, [champ("Numéro du ticket, ou ses derniers chiffres", { name: "numero", required: true, minlength: 3 })], "Chercher"), trouves);
    })()),
    horsLigne ? null : h("details", { class: "carte" }, h("summary", {}, "Clôturer ma caisse"), formulaire(async (v) => {
      await synchroniserCaisse();
      if (fileVentes().length) throw Object.assign(new Error(), { code: "ventes_en_attente" });
      const r = await api("POST", `/caisse/sessions/${session.id}/cloture`, { especesComptees: Number(v.compte), motifEcart: v.motif.trim() || undefined });
      ecranCaisse(`Caisse clôturée. Attendu ${fcfa(r.attendues)}, compté ${fcfa(r.comptees)}, écart ${fcfa(r.ecart)}.`);
    }, [h("div", { class: "grille" }, champ("Espèces comptées (FCFA)", { name: "compte", type: "number", min: 0, required: true }),
      champ("Motif, en cas d'écart", { name: "motif" }))], "Clôturer")),
    !horsLigne && droits.includes("caisse.superviser") ? blocReglesFidelite(session.entite_id, regle) : null,
    !horsLigne && droits.includes("caisse.superviser") ? await blocSessions() : null,
  );
  dessiner();
  dessinerGrille();
  majBandeauCaisse();
  if (matchMedia("(pointer: fine)").matches) recherche.focus();
}

/** Le navigateur imprime sur l'imprimante de tickets installée. La largeur choisie reste sur cet appareil. */
function imprimerTicket() {
  const largeur = Number(lireLocal(localStorage, "smarte.ticket", "80"));
  const ticket = document.querySelector(".ticket");
  ticket.classList.add("papier");
  ticket.style.width = `${largeur - 4}mm`;
  // La page fait la hauteur du ticket : pas de papier blanc gaspillé à la fin.
  const hauteur = Math.ceil((ticket.getBoundingClientRect().height * 25.4) / 96) + 8;
  const style = h("style", {}, `@page { size: ${largeur}mm ${hauteur}mm; margin: 2mm; }`);
  document.head.append(style);
  window.addEventListener("afterprint", () => {
    style.remove();
    ticket.classList.remove("papier");
    ticket.style.width = "";
  }, { once: true });
  window.print();
}

function voirTicket(t, session) {
  const lieu = typeof session === "string" ? session : session?.entite;
  const id = typeof session === "string" ? null : session?.identite;
  const largeur = h("select", { "aria-label": "Largeur du papier", onchange: (e) => ecrireLocal(localStorage, "smarte.ticket", e.target.value) },
    [["80", "Papier 80 mm"], ["58", "Papier 58 mm"]].map(([v, l]) => h("option", { value: v, selected: lireLocal(localStorage, "smarte.ticket", "80") === v }, l)));
  const paye = (t.paiements || []).filter((p) => p.montant > 0);
  vue(
    h("div", { class: "actions pas-imprimer" }, h("button", { onclick: () => ecranCaisse() }, "Nouvelle vente"), largeur,
      h("button", { class: "discret", onclick: imprimerTicket }, "Imprimer")),
    h("div", { class: "document ticket" },
      h("h2", {}, id?.raison_sociale || lieu || "Ticket"),
      id?.raison_sociale && lieu ? h("p", {}, lieu) : null,
      id?.adresse ? h("p", { class: "discret-texte" }, id.adresse) : null,
      id?.niu ? h("p", { class: "discret-texte" }, `NIU : ${id.niu}`) : null,
      id?.rccm ? h("p", { class: "discret-texte" }, `RCCM : ${id.rccm}`) : null,
      h("p", {}, t.provisoire ? "Ticket provisoire : vente hors connexion" : `Ticket ${t.numero}`),
      h("p", { class: "discret-texte" }, [heure(t.cree_le || new Date().toISOString()), t.vendeur ? `Vendeur : ${t.vendeur}` : null, t.client ? `Client : ${t.client}` : null].filter(Boolean).join(" · ")),
      t.lignes.map((l) => [h("div", { class: "ligne" }, h("span", {}, `${l.designation} × ${quantiteFr(l.quantite)}${l.unite ? ` ${l.unite}` : ""}`), h("span", {}, Number(l.montant_ttc ?? l.montant_ht).toLocaleString("fr-FR"))),
        l.remise_montant > 0 ? h("div", { class: "discret-texte" }, `dont remise ${fcfa(l.remise_montant)}`) : null,
        l.numeros_serie?.length ? h("div", { class: "discret-texte" }, `N° de série : ${l.numeros_serie.join(", ")}`) : null]),
      t.remise_totale > 0 ? h("p", { class: "totaux" }, `Remises : ${fcfa(t.remise_totale)}`) : null,
      t.total_taxes > 0 ? h("p", { class: "totaux" }, `Dont taxes : ${fcfa(t.total_taxes)}`) : null,
      h("p", { class: "totaux" }, h("b", {}, `Total : ${fcfa(t.total_ttc)}`)),
      paye.map((p) => h("div", { class: "ligne" }, h("span", {}, p.moyen === "points" ? "Points de fidélité" : libelle(MOYENS, p.moyen)), h("span", {}, Number(p.montant).toLocaleString("fr-FR")))),
      t.rendu > 0 ? h("p", { class: "grand" }, `Monnaie à rendre : ${fcfa(t.rendu)}`) : null,
      t.reste_du > 0 ? h("p", { class: "grand" }, `Reste dû : ${fcfa(t.reste_du)}`) : null,
      t.reste_du > 0 && t.echeance ? h("p", {}, `À payer avant le ${dateFr(t.echeance)}`) : null,
      t.points_gagnes > 0 ? h("p", {}, `Points gagnés : ${t.points_gagnes}`) : null));
}

/** Un ticket déjà enregistré : réimpression, retours déjà faits, et nouveau retour partiel pour un responsable. */
async function ecranTicketCaisse(id, session, message) {
  const t = await api("GET", `/caisse/ventes/${id}`);
  const relire = (m) => ecranTicketCaisse(id, session, m);
  const superviseur = session?.superviseur ?? droits.includes("caisse.superviser");
  const retournables = t.lignes.filter((l) => l.retourne < l.quantite);
  const zoneTotal = h("p", { class: "grand" });
  const zoneRemb = h("div");
  const saisies = () => retournables.map((l) => ({ l, q: Number(document.querySelector(`[name="q${l.id}"]`)?.value || 0), destination: document.querySelector(`[name="d${l.id}"]`)?.value || "vente" })).filter((x) => x.q > 0);
  // Même calcul que le serveur : au prorata de ce qui a été payé pour la ligne ; le dernier retour prend le reste exact.
  const montantRetour = (x) => (x.q >= Math.round((x.l.quantite - x.l.retourne) * 1000) / 1000 ? x.l.montant_ttc - x.l.rembourse : Math.round((x.l.montant_ttc * Math.round(x.q * 1000)) / Math.round(x.l.quantite * 1000)));
  const totalRetour = () => saisies().reduce((s, x) => s + montantRetour(x), 0);
  const moyens = [...MOYENS.filter(([m]) => m !== "virement"), ...(t.reste_restant > 0 ? [["credit", `Diminuer le reste dû (${fcfa(t.reste_restant)})`]] : [])];
  const ajouterRemb = (montant = "") => zoneRemb.append(h("div", { class: "grille caisse-paiement" },
    h("label", {}, "Rendu par", h("select", { name: "moyen" }, moyens.map(([c, l]) => h("option", { value: c, selected: c === (t.reste_restant > 0 ? "credit" : "especes") }, l)))),
    h("label", {}, "Montant (FCFA)", h("input", { name: "montant", type: "number", min: 0, value: montant })),
    h("label", {}, "Référence (sauf espèces)", h("input", { name: "reference", maxlength: 100 }))));
  const majTotal = () => {
    const total = totalRetour();
    zoneTotal.textContent = `Montant à rendre : ${fcfa(total)}`;
    if (zoneRemb.children.length === 1) zoneRemb.querySelector("[name=montant]").value = total || "";
  };
  vue(
    h("div", { class: "actions pas-imprimer" }, h("button", { onclick: () => ecranCaisse() }, "← Caisse"), h("button", { class: "discret", onclick: imprimerTicket }, "Imprimer le ticket")),
    message ? h("div", { class: "succes pas-imprimer", role: "status" }, message) : null,
    h("div", { class: "document ticket" },
      h("h2", {}, session?.identite?.raison_sociale || t.entite),
      session?.identite?.niu ? h("p", { class: "discret-texte" }, `NIU : ${session.identite.niu}`) : null,
      session?.identite?.rccm ? h("p", { class: "discret-texte" }, `RCCM : ${session.identite.rccm}`) : null,
      h("p", {}, `Ticket ${t.numero}${t.annulee_le ? " (annulé)" : ""}`),
      h("p", { class: "discret-texte" }, [heure(t.cree_le), t.vendeur ? `Vendeur : ${t.vendeur}` : null, t.client ? `Client : ${t.client}` : null].filter(Boolean).join(" · ")),
      t.lignes.map((l) => [h("div", { class: "ligne" }, h("span", {}, `${l.designation} × ${quantiteFr(l.quantite_unite ?? l.quantite)} ${l.unite || ""}`), h("span", {}, Number(l.montant_ttc).toLocaleString("fr-FR"))),
        l.remise_montant > 0 ? h("div", { class: "discret-texte" }, `dont remise ${fcfa(l.remise_montant)}`) : null]),
      t.remise_totale > 0 ? h("p", { class: "totaux" }, `Remises : ${fcfa(t.remise_totale)}`) : null,
      t.total_taxes > 0 ? h("p", { class: "totaux" }, `Dont taxes : ${fcfa(t.total_taxes)}`) : null,
      h("p", { class: "totaux" }, h("b", {}, `Total : ${fcfa(t.total_ttc)}`)),
      t.paiements.map((p) => h("div", { class: "ligne" }, h("span", {}, p.moyen === "points" ? "Points de fidélité" : libelle(MOYENS, p.moyen)), h("span", {}, Number(p.montant).toLocaleString("fr-FR")))),
      t.rendu > 0 ? h("p", {}, `Monnaie rendue : ${fcfa(t.rendu)}`) : null,
      t.reste_du > 0 ? h("p", { class: "grand" }, `Reste dû : ${fcfa(t.reste_restant)}`) : null),
    t.retours.length ? h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Retours de ce ticket"), t.retours.map((r) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${r.numero} : ${fcfa(r.total_ttc)}`), h("span", { class: "discret-texte" }, heure(r.cree_le))),
      h("div", { class: "discret-texte" }, `${r.motif} · ${r.auteur} · ${(r.lignes || []).map((l) => `${l.designation} × ${quantiteFr(l.quantite)}${l.destination === "avarie" ? " (avarié)" : ""}`).join(", ")}`),
      h("div", { class: "discret-texte" }, `Rendu : ${(r.remboursements || []).map((x) => `${x.moyen === "credit" ? "sur le reste dû" : libelle(MOYENS, x.moyen)} ${fcfa(x.montant)}`).join(", ")}${r.points_repris ? ` · ${r.points_repris} point(s) repris` : ""}`)))) : null,
    superviseur && !t.annulee_le && retournables.length ? h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Faire un retour"),
      h("p", { class: "discret-texte" }, "Le ticket d'origine ne change pas : le retour reçoit son propre numéro. L'argent rendu sort de votre caisse ouverte."),
      formulaire(async (v) => {
        const lignes = saisies().map((x) => ({ ligneId: x.l.id, quantite: x.q, destination: x.destination }));
        if (!lignes.length) throw Object.assign(new Error(), { code: "donnees_invalides" });
        const remboursements = [...zoneRemb.children].map((l) => ({ moyen: l.querySelector("[name=moyen]").value, montant: Math.round(Number(l.querySelector("[name=montant]").value || 0)), reference: l.querySelector("[name=reference]").value.trim() || undefined })).filter((x) => x.montant > 0);
        const r = await api("POST", `/caisse/ventes/${id}/retours`, { motif: v.motif.trim(), lignes, remboursements });
        relire(`Retour ${r.numero} enregistré : ${fcfa(r.total_ttc)} rendus.${r.points_repris ? ` ${r.points_repris} point(s) repris.` : ""}`);
      }, [retournables.map((l) => h("div", { class: "grille" },
        h("label", {}, `${l.designation} : quantité retournée (reste ${quantiteFr(Math.round((l.quantite - l.retourne) * 1000) / 1000)} ${l.unite_base})`,
          h("input", { name: `q${l.id}`, type: "number", min: 0, max: Math.round((l.quantite - l.retourne) * 1000) / 1000, step: "any", value: 0, oninput: majTotal })),
        h("label", {}, "Que devient l'article ?", h("select", { name: `d${l.id}` }, h("option", { value: "vente" }, "Remis en vente"), h("option", { value: "avarie" }, "Avarié, mis de côté"))))),
        champ("Motif du retour (obligatoire)", { name: "motif", required: true, minlength: 5 }),
        zoneTotal, zoneRemb,
        h("button", { type: "button", class: "discret", onclick: () => ajouterRemb() }, "Rendre par un autre moyen aussi")], "Enregistrer le retour")) : null);
  if (zoneRemb.isConnected || superviseur) { ajouterRemb(); majTotal(); }
}
