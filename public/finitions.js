"use strict";
/* Langue, rapports, prévisions, préparation, devises et charte. */
function langueCourante() { try { return localStorage.getItem("langue") === "en" ? "en" : "fr"; } catch { return "fr"; } }
const ANGLAIS = { "Tableau de bord": "Dashboard", "Menu": "Menu", "Cet écran accueillera les statistiques, les courbes, les graphiques et la synthèse des rapports.": "This screen will hold statistics, curves, charts and the report summary.", "Contenu en cours de définition.": "Content being defined.", "Se déconnecter": "Sign out","Notifications": "Notifications", "Mon compte": "My account", "Mon espace": "My space", "Rechercher": "Search", "Formations": "Training", "Clients": "Customers", "Facturation": "Invoicing", "Cours en ligne": "Online courses", "RH": "HR", "Marketing": "Marketing", "Performance": "Performance", "Pilotage": "Management", "Affiliés": "Affiliates", "Comptabilité": "Accounting", "Trésorerie": "Treasury", "Service client": "Customer service", "Tâches": "Tasks", "Indicateurs": "Indicators", "Accès": "Access", "Mentorat": "Mentoring", "Foundation": "Foundation", "Coaching": "Coaching", "Université": "University", "Tour de contrôle": "Control tower", "Documents": "Documents", "Agenda": "Calendar", "Promotions": "Promotions", "Prospection": "Prospecting", "Recouvrement": "Collections", "Événements": "Events", "Entrepôt et importation": "Warehouse and imports", "Caisse": "Till", "Stocks": "Stock", "Achats": "Purchasing", "Magasins": "Shops", "Livraisons": "Deliveries", "Mall": "Mall", "Rayons et lots": "Aisles and batches", "Points relais": "Pickup points", "GLOMARI Care": "GLOMARI Care", "Vendeurs et gros": "Sellers and wholesale", "Enregistrer": "Save", "Ajouter": "Add", "Créer": "Create", "Annuler": "Cancel", "Valider": "Validate", "Envoyer": "Send", "Modifier": "Edit", "Supprimer": "Delete", "Retirer": "Remove", "Arrêter": "Stop", "Télécharger": "Download", "Imprimer": "Print", "Refuser": "Refuse", "Accepter": "Accept", "Reporter": "Postpone", "Approuver": "Approve", "Payer": "Pay", "Encaisser": "Collect", "Chercher": "Search", "Publier": "Publish", "Appliquer": "Apply", "Retour": "Back", "Nom": "Name", "Téléphone": "Phone", "Email": "Email", "E-mail": "Email", "Entité": "Entity", "Branche": "Branch", "Date": "Date", "Montant": "Amount", "Libellé": "Label", "Motif": "Reason", "Prix": "Price", "Quantité": "Quantity", "Produit": "Product", "Client": "Customer", "Fournisseur": "Supplier", "Statut": "Status", "Année": "Year", "Mois": "Month", "Du": "From", "Au": "To", "Total": "Total", "Titre": "Title", "Description": "Description", "Lieu": "Place", "Rôle": "Role", "Langue": "Language", "Thème": "Theme", "Clair": "Light", "Sombre": "Dark", "Affichage": "Display", "Taille du texte": "Text size", "Normale": "Normal", "Grande": "Large", "Très grande": "Very large", "Double authentification": "Two-factor authentication", "Activer": "Enable", "Confirmer": "Confirm", "Activée": "Enabled", "Rien à traiter.": "Nothing to handle.", "Aucun résultat.": "No result.", "Tableau": "Dashboard", "Écritures": "Entries", "Nouvelle écriture": "New entry", "Balance": "Trial balance", "Grand livre": "General ledger", "États": "Statements", "Fournisseurs": "Suppliers", "Immobilisations": "Fixed assets", "États officiels": "Official statements", "Fiscalité": "Tax", "Budget": "Budget", "Groupe": "Group", "Clôtures": "Closings", "Plan et réglages": "Chart and settings", "Factures": "Invoices", "Devis": "Quotes", "Avoirs": "Credit notes", "Nouveau document": "New document", "Catalogue": "Catalogue", "Rapports": "Reports", "Prévisions": "Forecasts", "Règles automatiques": "Automatic rules", "Contrats": "Contracts", "Maintenance": "Maintenance", "Audits": "Audits", "Aide": "Help", "Recrutement": "Recruitment", "Notes de frais": "Expense claims", "Ressources humaines": "Human resources" };
function traduire(t) { return langueCourante() === "en" ? (ANGLAIS[t] ?? t) : t; }
document.documentElement.lang = langueCourante();

async function ecranRapports(message) {
  const sauves = await api("GET", "/rapports/sauves");
  const S = { ventes: ["Factures", { mois: "Mois", client: "Client", entite: "Entité" }], caisse: ["Caisse", { mois: "Mois", jour: "Jour", entite: "Entité" }], encaissements: ["Encaissements", { mois: "Mois", client: "Client", moyen: "Moyen" }] };
  const zone = h("div");
  const lancer = async (source, dimension, debut, fin) => {
    const r = await api("POST", "/rapports/execution", { source, dimension, debut, fin, comparer: true });
    zone.replaceChildren(h("button", { class: "discret", onclick: () => exporterCsv(`Rapport ${S[source][0]}`, [[dimension, "Total", "Nombre", "Période précédente"], ...r.lignes.map((l) => [l.cle, l.total, l.nombre, l.precedent])]) }, "Exporter en CSV"), h("div", { class: "defilant" }, h("table", {}, h("thead", {}, h("tr", {}, [S[source][1][dimension], "Total", "Nombre", "Période précédente"].map((c) => h("th", { scope: "col" }, c)))), h("tbody", {}, r.lignes.map((l) => h("tr", {}, h("td", {}, l.cle ?? ""), h("td", { class: "nombre" }, fcfa(l.total)), h("td", { class: "nombre" }, l.nombre), h("td", { class: "nombre" }, fcfa(l.precedent))))))));
  };
  const options = Object.entries(S).flatMap(([s, [n, d]]) => Object.entries(d).map(([k, l]) => [`${s}:${k}`, `${n} par ${l.toLowerCase()}`]));
  vue(h("button", { class: "discret", onclick: () => ecranTour() }, "← Tour de contrôle"), h("h1", {}, "Rapports"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, formulaire(async (v) => { const [s, d] = v.r.split(":"); await lancer(s, d, v.a, v.b); if (v.n.trim()) await api("POST", "/rapports/sauves", { nom: v.n.trim(), definition: { source: s, dimension: d } }); }, [h("div", { class: "grille" }, choix("r", "Rapport", options), champ("Du", { name: "a", type: "date", value: `${new Date().getFullYear()}-01-01`, required: true }), champ("Au", { name: "b", type: "date", value: aujourdhui(), required: true }), champ("Enregistrer sous, facultatif", { name: "n" }))], "Afficher"), sauves.length ? h("div", { class: "actions" }, sauves.map((x) => h("button", { class: "discret", onclick: () => lancer(x.definition.source, x.definition.dimension, `${new Date().getFullYear()}-01-01`, aujourdhui()) }, x.nom))) : null, zone));
}
async function ecranPrevisions() {
  const p = await api("GET", "/previsions/ventes");
  vue(h("button", { class: "discret", onclick: () => ecranTour() }, "← Tour de contrôle"), h("h1", {}, "Prévision des ventes"), h("div", { class: "alerte-caisse" }, "Estimation d'après les six derniers mois complets. Avec peu de mois connus, elle reste très approximative."),
    h("div", { class: "carte" }, p.length ? h("div", { class: "defilant" }, h("table", {}, h("thead", {}, h("tr", {}, ["Produit", "Prévu le mois prochain", "Stock", "Mois couverts", "Mois connus"].map((c) => h("th", { scope: "col" }, c)))), h("tbody", {}, p.map((x) => h("tr", {}, h("td", {}, x.nom), h("td", { class: "nombre" }, nombreFr(x.prevu)), h("td", { class: "nombre" }, nombreFr(x.stock)), h("td", { class: "nombre" }, x.mois_couverts ?? "–"), h("td", { class: "nombre" }, x.mois_connus)))))) : h("p", { class: "discret-texte" }, "Pas encore assez de ventes.")));
}
async function ecranPreparation(documentId) {
  const p = await api("POST", `/documents-vente/${documentId}/preparation`);
  const afficher = (lignes, statut, erreur) => {
    const saisie = h("input", { "aria-label": "Code scanné", autofocus: true, placeholder: "Scannez ou saisissez le code" });
    const f = h("form", { onsubmit: async (e) => { e.preventDefault(); try { const r = await api("POST", `/preparations/${p.id}/scan`, { code: saisie.value }); afficher(r.lignes, r.statut); } catch (x) { afficher(lignes, statut, MESSAGES[x.code] || "Code refusé."); } } }, saisie, h("button", { type: "submit" }, "Valider"));
    vue(h("button", { class: "discret", onclick: () => ecranDocument(documentId) }, "← Document"), h("h1", {}, "Préparation"), erreur ? h("div", { class: "erreur", role: "alert" }, erreur) : null, statut === "terminee" ? h("div", { class: "succes", role: "status" }, "Préparation terminée.") : f,
      h("div", { class: "carte" }, lignes.map((l) => h("div", { class: "ligne apprenant" }, h("span", {}, `${l.emplacement ?? "Sans emplacement"} · ${l.nom}`), h("span", { class: l.pris >= l.quantite ? "pastille ok" : "pastille attente" }, `${l.pris} / ${l.quantite}`)))));
    if (statut !== "terminee") saisie.focus();
  };
  afficher(p.lignes, p.statut);
}

let chartes = null;
async function appliquerCharte() {
  try {
    if (!chartes) chartes = await api("GET", "/entites-chartes");
    const c = chartes.find((e) => e.code === (dansEspace("formation") ? "GTA" : "GLOMARI"));
    if (c?.couleur) document.documentElement.style.setProperty("--marine", c.couleur);
    else document.documentElement.style.removeProperty("--marine");
  } catch { /* la couleur par défaut reste */ }
}
/** Couleur et logo par entité. Le logo du groupe sert partout où une branche n'a pas le sien. */
function formulaireCharte(entites) {
  return h("div", { class: "carte" }, h("h2", {}, "Couleur et logo par entité"),
    h("p", { class: "discret-texte" }, "Le logo apparaît en haut de l'écran, sur le tableau de bord et sur les devis, factures, reçus, bons de commande et autres documents. Une branche sans logo prend celui du groupe."),
    formulaire(async (v, f) => {
      await api("PATCH", `/entites/${v.e}/charte`, { couleur: v.c || null });
      const fichier = f.querySelector("input[type=file]").files[0];
      if (fichier) await api("PUT", `/entites/${v.e}/logo`, { image: await imageReduite(fichier, { cote: 800, carre: false, type: fichier.type === "image/jpeg" ? "image/jpeg" : "image/png" }) });
      chartes = null; oublierLogos();
      ecranCompte(fichier ? "Couleur et logo enregistrés." : "Couleur enregistrée.");
    }, [h("div", { class: "grille" }, choix("e", "Entité", entites.map((x) => [x.id, x.nom])), champ("Couleur", { name: "c", type: "color", value: "#232f8c" }),
      h("label", {}, "Logo (PNG, JPEG ou WebP), facultatif", h("input", { type: "file", accept: "image/png,image/jpeg,image/webp" })))], "Enregistrer"),
    h("details", {}, h("summary", {}, "Retirer un logo"), formulaire(async (v) => {
      await api("DELETE", `/entites/${v.e}/logo`); oublierLogos(); ecranCompte("Logo retiré.");
    }, [choix("e", "Entité", entites.map((x) => [x.id, x.nom]))], "Retirer le logo")));
}
