"use strict";
/* Mall, rayons, points relais et portail grossiste. */
async function ecranMall(message) {
  const gere = droits.includes("mall.gerer");
  const [d, entites, clients] = await Promise.all([api("GET", "/locaux"), gere ? entitesPour("commerce") : [], gere ? api("GET", "/tiers") : []]);
  const libres = d.locaux.filter((l) => !l.bail_id && l.actif);
  vue(h("h1", {}, "Mall"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "chiffres" }, h("div", { class: "chiffre" }, h("b", {}, d.occupation === null ? "-" : `${d.occupation} %`), h("span", {}, "Occupation")), h("div", { class: "chiffre" }, h("b", {}, fcfa(d.locaux.reduce((s, l) => s + (l.impayes || 0), 0))), h("span", {}, "Loyers impayés"))),
    h("div", { class: "carte" }, h("h2", {}, "Locaux"), d.locaux.length ? d.locaux.map((l) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${l.code} : ${l.nom}`), h("span", { class: l.bail_id ? "pastille ok" : "pastille attente" }, l.bail_id ? "Loué" : "Libre")),
      l.bail_id ? h("div", { class: "discret-texte" }, `${l.locataire} · ${fcfa(l.loyer + l.charges)} par mois · Jusqu'au ${dateFr(l.fin)} · Impayés ${fcfa(l.impayes)}`) : null,
      gere && l.bail_id ? h("details", {}, h("summary", {}, "Facturer un mois"), formulaire(async (v) => { const r = await api("POST", `/baux/${l.bail_id}/facturation`, { periode: v.p }); ecranMall(`Facture ${r.numero} émise : ${fcfa(r.total)}.`); }, [champ("Mois", { name: "p", type: "month", required: true })], "Facturer")) : null)) : h("p", { class: "discret-texte" }, "Aucun local.")),
    gere && libres.length ? h("details", { class: "carte" }, h("summary", {}, "Nouveau bail"), formulaire(async (v) => {
      await api("POST", "/baux", { localId: v.l, tiersId: v.t, debut: v.d, fin: v.f, loyer: Number(v.m), charges: Number(v.c || 0), tauxTaxe: Number(v.x || 0), depot: Number(v.g || 0) });
      ecranMall("Bail créé.");
    }, [h("div", { class: "grille" }, choix("l", "Local", libres.map((l) => [l.id, `${l.code} ${l.nom}`])), choix("t", "Locataire", clients.map((c) => [c.id, c.nom])), champ("Début", { name: "d", type: "date", required: true }), champ("Fin", { name: "f", type: "date", required: true }), champ("Loyer mensuel (FCFA)", { name: "m", type: "number", min: 1, required: true }), champ("Charges (FCFA)", { name: "c", type: "number", min: 0 }), champ("Taxe % (facultatif)", { name: "x", type: "number", min: 0, max: 100, step: 0.001 }), champ("Dépôt de garantie", { name: "g", type: "number", min: 0 }))], "Créer")) : null,
    gere && entites.length ? h("details", { class: "carte" }, h("summary", {}, "Nouveau local"), formulaire(async (v) => { await api("POST", "/locaux", { entiteId: v.e, code: v.c.trim(), nom: v.n.trim(), type: v.t, surface: v.s ? Number(v.s) : undefined }); ecranMall("Local ajouté."); }, [h("div", { class: "grille" }, champ("Code", { name: "c", required: true }), champ("Nom", { name: "n", required: true }), choix("t", "Type", [["boutique", "Boutique"], ["espace", "Espace"], ["bureau", "Bureau"], ["parking", "Parking"], ["autre", "Autre"]]), champ("Surface (m²)", { name: "s", type: "number", min: 0, step: 0.01 }), choix("e", "Entité", entites))], "Ajouter")) : null);
}

async function ecranRayons(message) {
  const produits = await api("GET", "/produits");
  const parRayon = new Map();
  for (const p of produits.filter((x) => x.actif)) parRayon.set(p.rayon || "Sans rayon", [...(parRayon.get(p.rayon || "Sans rayon") || []), p]);
  vue(h("h1", {}, "Rayons et étiquettes"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("p", { class: "discret-texte pas-imprimer" }, "Les lots et les dates d'expiration se gèrent dans le module Stocks. ", h("button", { class: "lien", onclick: () => ecranStockExpirations() }, "Ouvrir les dates d'expiration")),
    h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Rayons"), droits.includes("catalogue.gerer") ? formulaire(async (v) => { await api("PATCH", `/produits/${v.p}/rayon`, { rayon: v.r.trim() || null }); ecranRayons("Rayon enregistré."); }, [h("div", { class: "grille" }, choix("p", "Produit", produits.map((p) => [p.id, p.nom])), champ("Rayon", { name: "r" }))], "Enregistrer") : null,
      h("button", { class: "discret", onclick: () => voirEtiquettes(produits.filter((p) => p.actif)) }, "Imprimer les étiquettes")),
    [...parRayon].map(([r, ps]) => h("div", { class: "carte" }, h("h2", {}, r), ps.map((p) => h("div", { class: "ligne apprenant" }, h("span", {}, p.nom), h("span", {}, fcfa(Math.round(p.prix_vente * (1 + (p.taux_taxe || 0) / 100)))))))));
}

/** Planches d'étiquettes : colonnes, rangées, taille d'une étiquette et marges de la feuille, en millimètres. */
const PLANCHES = {
  a4_24: { nom: "A4, 24 étiquettes (70 × 37 mm)", colonnes: 3, rangees: 8, l: 70, h: 37, margeH: 0, margeV: 0.5, page: "A4" },
  a4_40: { nom: "A4, 40 étiquettes (52,5 × 29,7 mm)", colonnes: 4, rangees: 10, l: 52.5, h: 29.7, margeH: 0, margeV: 0, page: "A4" },
  a4_65: { nom: "A4, 65 étiquettes (38,1 × 21,2 mm)", colonnes: 5, rangees: 13, l: 38.1, h: 21.2, margeH: 9.75, margeV: 10.7, page: "A4" },
  rouleau: { nom: "Rouleau, une étiquette (50 × 30 mm)", colonnes: 1, rangees: 1, l: 50, h: 30, margeH: 0, margeV: 0, page: "50mm 30mm" },
};
const prixTtcArticle = (p) => Math.round(p.prix_vente * (1 + (p.taux_taxe || 0) / 100));

/** Choix des articles, du nombre d'étiquettes par article, de la planche et du format de code-barres. */
function voirEtiquettes(produits) {
  const choisis = new Map();
  const zoneListe = h("div"), zoneApercu = h("div");
  const recherche = h("input", { type: "search", placeholder: "Chercher un article", "aria-label": "Chercher un article" });
  const planche = h("select", { "aria-label": "Planche" }, Object.entries(PLANCHES).map(([c, x]) => h("option", { value: c }, x.nom)));
  const format = h("select", { "aria-label": "Format du code-barres" }, [["auto", "Automatique (EAN13 si possible)"], ["EAN13", "EAN13"], ["CODE128", "CODE128"]].map(([c, l]) => h("option", { value: c }, l)));
  const etiquette = (p) => h("div", { class: "etiquette" }, h("div", { class: "nom" }, p.nom), h("div", { class: "barres" }, dessinerCodeBarres(p.code_barres || p.code, format.value) || h("span", {}, p.code_barres || p.code)), h("div", { class: "prix" }, fcfa(prixTtcArticle(p))));
  const apercu = () => {
    const x = PLANCHES[planche.value];
    const toutes = [...choisis.values()].flatMap(({ p, n }) => Array.from({ length: n }, () => p));
    const parPage = x.colonnes * x.rangees;
    const pages = [];
    for (let i = 0; i < toutes.length; i += parPage) pages.push(toutes.slice(i, i + parPage));
    zoneApercu.replaceChildren(
      h("p", { class: "discret-texte pas-imprimer" }, toutes.length ? `${toutes.length} étiquette(s), ${pages.length} page(s). Imprimez à 100 %, sans « ajuster à la page ».` : "Cochez des articles pour préparer les étiquettes."),
      ...pages.map((page) => h("div", { class: "planche", style: `grid-template-columns: repeat(${x.colonnes}, ${x.l}mm); grid-auto-rows: ${x.h}mm; padding: ${x.margeV}mm ${x.margeH}mm; width: ${x.colonnes * x.l + 2 * x.margeH}mm;` }, page.map(etiquette))));
  };
  const lister = () => {
    const q = recherche.value.trim().toLowerCase();
    zoneListe.replaceChildren(...produits.filter((p) => !q || p.nom.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || (p.code_barres || "").includes(q)).slice(0, 200).map((p) => {
      const nombre = h("input", { type: "number", min: 1, max: 500, value: choisis.get(p.id)?.n ?? 1, "aria-label": `Nombre d'étiquettes pour ${p.nom}`, class: "nombre-etiquettes", oninput: (e) => { if (choisis.has(p.id)) { choisis.get(p.id).n = Math.min(Math.max(Math.round(Number(e.target.value) || 1), 1), 500); apercu(); } } });
      return h("label", { class: "ligne apprenant case" },
        h("input", { type: "checkbox", checked: choisis.has(p.id), onchange: (e) => { if (e.target.checked) choisis.set(p.id, { p, n: Math.max(Math.round(Number(nombre.value) || 1), 1) }); else choisis.delete(p.id); apercu(); } }),
        h("span", { class: "nom" }, `${p.nom} · ${fcfa(prixTtcArticle(p))}`), h("span", { class: "discret-texte" }, p.code_barres || `${p.code} (sans code-barres)`), nombre);
    }));
  };
  recherche.addEventListener("input", lister);
  planche.addEventListener("change", apercu);
  format.addEventListener("change", apercu);
  const imprimer = () => {
    const x = PLANCHES[planche.value];
    const style = h("style", {}, `@page { size: ${x.page}; margin: 0; }`);
    document.head.append(style);
    window.addEventListener("afterprint", () => style.remove(), { once: true });
    window.print();
  };
  vue(h("div", { class: "actions pas-imprimer" }, h("button", { class: "discret", onclick: () => ecranRayons() }, "← Rayons"), h("button", { onclick: imprimer }, "Imprimer")),
    h("h1", { class: "pas-imprimer" }, "Étiquettes"),
    h("div", { class: "carte pas-imprimer" }, h("div", { class: "grille" }, h("label", {}, "Planche", planche), h("label", {}, "Code-barres", format), h("label", {}, "Article", recherche)),
      h("div", { class: "actions" }, h("button", { type: "button", class: "discret", onclick: () => { for (const p of produits) if (!choisis.has(p.id)) choisis.set(p.id, { p, n: 1 }); lister(); apercu(); } }, "Tout cocher"),
        h("button", { type: "button", class: "discret", onclick: () => { choisis.clear(); lister(); apercu(); } }, "Tout décocher")),
      h("div", { class: "liste-etiquettes" }, zoneListe)),
    zoneApercu);
  lister();
  apercu();
}

async function ecranRelais(message) {
  const [points, colis, wallets, entites] = await Promise.all([api("GET", "/points-relais"), api("GET", "/colis"), droits.includes("tresorerie.voir") ? api("GET", "/portefeuilles") : [], droits.includes("transport.gerer") ? entitesPour("transport") : []]);
  const aDeposer = colis.filter((c) => ["prepare", "expedie", "en_transit", "echec"].includes(c.statut));
  vue(h("h1", {}, "Points relais"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    points.length ? points.map((p) => h("div", { class: "carte" }, h("h2", {}, p.nom), h("p", { class: "discret-texte" }, `${p.adresse || ""} · ${fcfa(p.commission)} par colis retiré · À payer ${fcfa(p.a_payer)}`),
      (p.colis || []).map((c) => h("details", { class: "apprenant" }, h("summary", {}, `${c.numero} : ${c.destinataire}${c.a_encaisser ? ` · ${fcfa(c.a_encaisser)}` : ""}`), formulaire(async (v) => { await api("POST", `/colis/${c.id}/retrait`, { code: v.code.trim(), recuPar: v.r.trim(), encaisse: Number(v.e || 0) }); ecranRelais("Colis retiré."); }, [h("div", { class: "grille" }, champ("Code du client", { name: "code", required: true, pattern: "[0-9]{6}" }), champ("Retiré par", { name: "r", value: c.destinataire, required: true }), champ("Encaissé", { name: "e", type: "number", min: 0, value: c.a_encaisser }))], "Confirmer le retrait"))),
      aDeposer.length ? h("details", {}, h("summary", {}, "Déposer un colis"), formulaire(async (v) => { await api("POST", `/colis/${v.c}/depot-relais`, { pointRelaisId: p.id }); ecranRelais("Colis déposé."); }, [choix("c", "Colis", aDeposer.map((c) => [c.id, `${c.numero} : ${c.destinataire}`]))], "Déposer")) : null,
      p.a_payer && wallets.length ? h("details", {}, h("summary", {}, "Payer les commissions"), formulaire(async (v) => { const r = await api("POST", `/points-relais/${p.id}/paiement`, { portefeuilleId: v.w }); ecranRelais(`${fcfa(r.paye)} payés.`); }, [choix("w", "Depuis", wallets.filter((w) => w.actif).map((w) => [w.id, `${w.nom} (${fcfa(w.solde)})`]))], "Payer")) : null)) : h("p", { class: "discret-texte" }, "Aucun point relais."),
    entites.length ? h("details", { class: "carte" }, h("summary", {}, "Nouveau point relais"), formulaire(async (v) => { await api("POST", "/points-relais", { entiteId: v.e, nom: v.n.trim(), adresse: v.a.trim() || undefined, commission: Number(v.c) }); ecranRelais("Point relais ajouté."); }, [h("div", { class: "grille" }, champ("Nom", { name: "n", required: true }), champ("Adresse", { name: "a" }), champ("Commission par colis", { name: "c", type: "number", min: 0, required: true }), choix("e", "Entité", entites))], "Ajouter")) : null);
}

async function ecranPortail(message) {
  const [commandes, pros] = await Promise.all([api("GET", "/commandes-portail"), api("GET", "/comptes-pro")]);
  const gere = droits.includes("facturation.gerer");
  const admin = droits.includes("facturation.administrer");
  vue(h("h1", {}, "Portail grossiste"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, h("h2", {}, "Commandes reçues"), commandes.length ? commandes.map((c) => h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", { class: "nom" }, `${c.nom} : ${fcfa(c.total_ht)} HT`), h("span", { class: c.statut === "acceptee" ? "pastille ok" : c.statut === "refusee" ? "pastille retard" : "pastille attente" }, c.statut)),
      h("div", { class: "discret-texte" }, c.lignes.map((l) => `${l.nom} × ${quantiteFr(l.quantite)} à ${fcfa(l.prix)}`).join(" · ")), c.note ? h("p", {}, c.note) : null,
      gere && c.statut === "soumise" ? h("div", { class: "actions" }, h("button", { onclick: async () => { await api("POST", `/commandes-portail/${c.id}/decision`, { decision: "acceptee" }); ecranPortail("Commande acceptée : devis créé en brouillon dans Facturation."); } }, "Accepter"),
        h("details", {}, h("summary", {}, "Refuser"), formulaire(async (v) => { await api("POST", `/commandes-portail/${c.id}/decision`, { decision: "refusee", motif: v.m.trim() }); ecranPortail("Commande refusée."); }, [champ("Motif", { name: "m", required: true, minlength: 3 })], "Confirmer"))) : null)) : h("p", { class: "discret-texte" }, "Aucune commande.")),
    h("div", { class: "carte" }, h("h2", {}, "Accès des clients"), h("p", { class: "discret-texte" }, "Le lien donne accès aux factures et à l'encours du client. Transmettez-le à lui seul. Un nouveau lien annule le précédent."), pros.length ? pros.map((p) => {
      const zone = h("div");
      return h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", { class: "nom" }, p.nom), h("span", { class: p.portail ? "pastille ok" : "pastille attente" }, p.portail ? "Accès actif" : "Sans accès")), admin ? h("div", { class: "actions" },
        h("button", { class: "discret", onclick: async () => { const r = await api("POST", `/tiers/${p.tiers_id}/portail`, { entiteId: p.branche_id, actif: true }); zone.replaceChildren(h("a", { class: "lien-bouton", href: r.lien, target: "_blank", rel: "noopener" }, "Ouvrir le lien"), h("button", { class: "discret", onclick: () => navigator.clipboard.writeText(r.lien) }, "Copier")); } }, "Créer un lien"),
        p.portail ? h("button", { class: "danger", onclick: async () => { await api("POST", `/tiers/${p.tiers_id}/portail`, { entiteId: p.branche_id, actif: false }); ecranPortail("Accès retiré."); } }, "Retirer l'accès") : null) : null, zone);
    }) : h("p", { class: "discret-texte" }, "Réglez d'abord un compte professionnel dans Vendeurs et gros.")));
}
