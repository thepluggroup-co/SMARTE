"use strict";
/* Documents, agenda, espace employé, recrutement et promotions. */
const CATEGORIES_DOC = [["general", "Général"], ["contrat", "Contrat"], ["rh", "Dossier RH"], ["compta", "Pièce comptable"]];
const entreeFichier = () => h("input", { type: "file", name: "fichier", required: true, accept: ".pdf,.png,.jpg,.jpeg,.docx,.xlsx", "aria-label": "Fichier" });
async function envoyerFichier(url, fichier) {
  const r = await fetch(url, { method: "PUT", headers: { authorization: `Bearer ${jeton}`, "content-type": fichier.type || "application/octet-stream" }, body: fichier });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(), { code: d.erreur || "inconnue" });
  return d;
}
async function telechargerDocument(id, titre) {
  const r = await fetch(`/documents/${id}/fichier`, { headers: { authorization: `Bearer ${jeton}` } });
  if (!r.ok) throw Object.assign(new Error(), { code: "inconnue" });
  const url = URL.createObjectURL(await r.blob());
  h("a", { href: url, download: titre }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const envoiCatch = (f) => async (e) => { e.preventDefault(); const z = e.target.querySelector(".message-envoi"); try { await f(e.target); } catch (x) { if (z) z.replaceChildren(h("div", { class: "erreur", role: "alert" }, MESSAGES[x.code] || "L'envoi a échoué.")); } };

async function ecranDocuments(message, q = "", archives = false) {
  const [docs, entites] = await Promise.all([api("GET", `/documents?q=${encodeURIComponent(q)}${archives ? "&archives=true" : ""}`), api("GET", "/entites")]);
  vue(h("h1", {}, archives ? "Documents archivés" : "Documents"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "actions" }, h("input", { type: "search", value: q, placeholder: "Rechercher un titre", "aria-label": "Rechercher un titre", onkeydown: (e) => { if (e.key === "Enter") ecranDocuments(null, e.target.value, archives); } }), h("button", { class: "discret", onclick: () => ecranDocuments(null, q, !archives) }, archives ? "Documents actifs" : "Archives")),
    h("div", { class: "carte" }, docs.length ? docs.map((d) => h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", { class: "nom" }, `${d.titre} · v${d.version}`), h("span", {}, CATEGORIES_DOC.find((c) => c[0] === d.categorie)[1])),
      h("div", { class: "discret-texte" }, `${d.entite}${d.tiers ? ` · ${d.tiers}` : ""} · ${d.auteur} · ${heure(d.cree_le)}`),
      h("div", { class: "actions" }, h("button", { class: "discret", onclick: () => telechargerDocument(d.id, d.titre) }, "Télécharger"),
        h("button", { class: "discret", onclick: async () => { await api("POST", `/documents/${d.id}/signature`, { mention: "Lu et approuvé" }); ecranDocuments("Approbation enregistrée. Ce n'est pas une signature électronique qualifiée."); } }, "Approuver"),
        archives ? null : h("details", {}, h("summary", {}, "Nouvelle version"), h("form", { onsubmit: envoiCatch(async (f) => { await envoyerFichier(`/documents?entiteId=${d.entite_id}&titre=${encodeURIComponent(d.titre)}&categorie=${d.categorie}&remplace=${d.id}`, f.fichier.files[0]); ecranDocuments("Nouvelle version enregistrée."); }) }, h("div", { class: "message-envoi" }), entreeFichier(), h("button", { type: "submit" }, "Envoyer"))),
        archives ? null : h("details", {}, h("summary", {}, "Archiver"), formulaire(async (v) => { await api("POST", `/documents/${d.id}/archivage`, { motif: v.m.trim() }); ecranDocuments("Document archivé."); }, [champ("Motif", { name: "m", required: true, minlength: 5 })], "Archiver"))))) : h("p", { class: "discret-texte" }, "Aucun document.")),
    h("div", { class: "carte" }, h("h2", {}, "Ajouter un document"), h("form", { onsubmit: envoiCatch(async (f) => {
      await envoyerFichier(`/documents?entiteId=${f.e.value}&titre=${encodeURIComponent(f.t.value.trim())}&categorie=${f.c.value}`, f.fichier.files[0]); ecranDocuments("Document enregistré.");
    }) }, h("div", { class: "message-envoi" }), h("div", { class: "grille" }, champ("Titre", { name: "t", required: true }), choix("e", "Entité", entites.map((e) => [e.id, e.nom])), choix("c", "Catégorie", CATEGORIES_DOC)), entreeFichier(), h("button", { type: "submit" }, "Enregistrer"))));
}

async function ecranAgenda(message, debut = aujourdhui()) {
  const fin = new Date(Date.parse(debut) + 6 * 86400000).toISOString().slice(0, 10);
  const gere = droits.includes("agenda.gerer");
  const [a, entites] = await Promise.all([api("GET", `/agenda?debut=${debut}&fin=${fin}`), gere ? api("GET", "/entites") : []]);
  const T = { salle: "Salle", vehicule: "Véhicule", equipement: "Équipement", formateur: "Formateur" };
  vue(h("h1", {}, "Agenda"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("label", {}, "Semaine à partir du", h("input", { type: "date", value: debut, onchange: (e) => ecranAgenda(null, e.target.value) })),
    a.sessions.length ? h("div", { class: "carte" }, h("h2", {}, "Sessions de formation"), a.sessions.map((s) => h("div", { class: "discret-texte" }, `${s.programme} · ${s.code} · ${s.ville} · ${dateFr(s.debut)} au ${dateFr(s.fin)}`))) : null,
    h("div", { class: "carte" }, h("h2", {}, "Réservations"), a.reservations.length ? a.reservations.map((r) => h("div", { class: "ligne apprenant" }, h("span", {}, `${heure(r.debut)} à ${heure(r.fin)} · ${r.ressource} · ${r.objet} · ${r.auteur}`), gere ? h("button", { class: "discret", onclick: async () => { await api("POST", `/reservations/${r.id}/annulation`); ecranAgenda("Réservation annulée.", debut); } }, "Annuler") : null)) : h("p", { class: "discret-texte" }, "Aucune réservation sur cette semaine.")),
    gere && a.ressources.length ? h("div", { class: "carte" }, h("h2", {}, "Réserver"), formulaire(async (v) => { await api("POST", "/reservations", { ressourceId: v.r, debut: new Date(v.d).toISOString(), fin: new Date(v.f).toISOString(), objet: v.o.trim() }); ecranAgenda("Réservation enregistrée.", debut); }, [h("div", { class: "grille" }, choix("r", "Ressource", a.ressources.map((r) => [r.id, `${r.nom} · ${T[r.type]} · ${r.entite}`])), champ("Début", { name: "d", type: "datetime-local", required: true }), champ("Fin", { name: "f", type: "datetime-local", required: true }), champ("Objet", { name: "o", required: true }))], "Réserver")) : null,
    gere ? h("details", { class: "carte" }, h("summary", {}, "Ajouter une ressource"), formulaire(async (v) => { await api("POST", "/ressources", { entiteId: v.e, nom: v.n.trim(), type: v.t, capacite: v.c ? Number(v.c) : undefined }); ecranAgenda("Ressource ajoutée.", debut); }, [h("div", { class: "grille" }, champ("Nom", { name: "n", required: true }), choix("t", "Type", Object.entries(T)), choix("e", "Entité", entites.map((e) => [e.id, e.nom])), champ("Capacité", { name: "c", type: "number", min: 1 }))], "Ajouter")) : null);
}

const STATUTS_NOTE = { soumise: "Soumise", approuvee: "Approuvée", refusee: "Refusée", payee: "Payée" };
const CATEGORIES_FRAIS = [["transport", "Transport"], ["repas", "Repas"], ["hebergement", "Hébergement"], ["communication", "Communication"], ["autre", "Autre"]];
const TYPES_CONGE_PERSO = [["annuel", "Congé annuel"], ["permission", "Permission"], ["maladie", "Maladie"], ["maternite", "Maternité"], ["sans_solde", "Sans solde"], ["autre", "Autre"]];
async function ecranMonEspace(message) {
  const m = await api("GET", "/moi/employe");
  if (!m.lie) return vue(h("h1", {}, "Mon espace"), h("p", {}, "Votre compte n'est pas encore relié à un dossier employé. Demandez-le aux ressources humaines."));
  vue(h("h1", {}, m.nom), message ? h("div", { class: "succes", role: "status" }, message) : null, h("p", { class: "discret-texte" }, `${m.matricule} · ${m.poste}`),
    h("div", { class: "actions" }, h("button", { onclick: () => ecranMaJournee() }, "Ma journée"), h("button", { class: "discret", onclick: () => ecranMaFiche() }, "Ma fiche de poste"), h("button", { class: "discret", onclick: () => ecranMesOkr() }, "Mes OKR"), h("button", { class: "discret", onclick: () => ecranProblemes() }, "Problèmes et solutions"), h("button", { class: "discret", onclick: () => ecranMessages() }, "Mes messages")),
    h("div", { class: "carte" }, h("h2", {}, "Pointage du jour"), h("p", {}, m.pointage ? `Arrivée ${m.pointage.arrivee.slice(0, 5)}${m.pointage.depart ? ` · Départ ${m.pointage.depart.slice(0, 5)}` : ""}` : "Pas encore pointé."),
      m.pointage?.depart ? null : formulaire(async (v) => { const r = await api("POST", "/moi/pointage", v.c.trim() ? { code: v.c.trim() } : {}); history.replaceState(null, "", "/"); ecranMonEspace(`${r.sens === "arrivee" ? "Arrivée" : "Départ"} à ${r.heure.slice(0, 5)}.`); }, [champ("Code de la borne, s'il y en a une", { name: "c", inputmode: "numeric", pattern: "[0-9]{6}", value: new URLSearchParams(location.search).get("pointage") ?? "" })], m.pointage ? "Pointer mon départ" : "Pointer mon arrivée")),
    h("div", { class: "carte" }, h("h2", {}, "Congés"), m.solde.parametre ? h("p", {}, `Solde : ${m.solde.solde} jour(s)`) : null, m.conges.map((c) => h("div", { class: "discret-texte" }, `${TYPES_CONGE_PERSO.find((t) => t[0] === c.type)[1]} · ${dateFr(c.debut)} au ${dateFr(c.fin)} · ${c.statut}${c.motif_refus ? ` · ${c.motif_refus}` : ""}`)),
      h("details", {}, h("summary", {}, "Demander un congé"), formulaire(async (v) => { await api("POST", "/moi/conges", { type: v.t, debut: v.d, fin: v.f, motif: v.m.trim() || undefined }); ecranMonEspace("Demande envoyée."); }, [h("div", { class: "grille" }, choix("t", "Type", TYPES_CONGE_PERSO), champ("Du", { name: "d", type: "date", required: true }), champ("Au", { name: "f", type: "date", required: true }), champ("Motif", { name: "m" }))], "Envoyer"))),
    h("div", { class: "carte" }, h("h2", {}, "Notes de frais"), m.notes.map((n) => h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", {}, `${dateFr(n.jour)} · ${n.libelle}`), h("span", {}, `${fcfa(n.montant)} · ${STATUTS_NOTE[n.statut]}`)), n.motif_refus ? h("div", { class: "discret-texte" }, n.motif_refus) : null,
      n.statut === "soumise" && !n.document_id ? h("details", {}, h("summary", {}, "Joindre le justificatif"), h("form", { onsubmit: envoiCatch(async (f) => { await envoyerFichier(`/moi/notes-frais/${n.id}/justificatif`, f.fichier.files[0]); ecranMonEspace("Justificatif joint."); }) }, h("div", { class: "message-envoi" }), entreeFichier(), h("button", { type: "submit" }, "Envoyer"))) : null)),
      h("details", {}, h("summary", {}, "Nouvelle note"), formulaire(async (v) => { await api("POST", "/moi/notes-frais", { jour: v.j, categorie: v.c, libelle: v.l.trim(), montant: Number(v.m) }); ecranMonEspace("Note envoyée."); }, [h("div", { class: "grille" }, champ("Date", { name: "j", type: "date", value: aujourdhui(), required: true }), choix("c", "Catégorie", CATEGORIES_FRAIS), champ("Objet", { name: "l", required: true }), champ("Montant (FCFA)", { name: "m", type: "number", min: 1, required: true }))], "Envoyer"))),
    h("div", { class: "carte" }, h("h2", {}, "Mes bulletins"), m.bulletins.length ? m.bulletins.map((b) => h("button", { class: "session", onclick: () => ecranMonBulletin(b.id) }, `${b.periode} · Net ${fcfa(b.net)}`)) : h("p", { class: "discret-texte" }, "Aucun bulletin validé.")));
}
async function ecranMonBulletin(id) {
  const b = await api("GET", `/moi/bulletins/${id}`);
  vue(h("button", { class: "discret", onclick: () => ecranMonEspace() }, "← Mon espace"), h("h1", {}, `Bulletin ${b.periode}`), h("div", { class: "carte" }, (b.lignes || []).map((l) => h("div", { class: "ligne" }, h("span", {}, l.libelle ?? l.code), h("span", {}, `${l.sens === "retenue" ? "- " : ""}${fcfa(l.montant ?? 0)}`))), h("div", { class: "ligne" }, h("b", {}, "Net à payer"), h("b", {}, fcfa(b.net)))));
}
async function ecranNotesFrais(message) {
  const notes = await api("GET", "/notes-frais");
  const paye = droits.includes("tresorerie.gerer");
  const parNote = new Map();
  if (paye) for (const n of notes.filter((x) => x.statut === "approuvee")) parNote.set(n.id, await portefeuillesDe(n.entite_id));
  vue(h("button", { class: "discret", onclick: () => ecranRh() }, "← RH"), h("h1", {}, "Notes de frais"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, notes.length ? notes.map((n) => h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", { class: "nom" }, `${n.employe} · ${n.libelle}`), h("span", {}, `${fcfa(n.montant)} · ${STATUTS_NOTE[n.statut]}`)), h("div", { class: "discret-texte" }, dateFr(n.jour)),
      n.document_id ? h("button", { class: "discret", onclick: () => telechargerDocument(n.document_id, `Justificatif ${n.employe}`) }, "Voir le justificatif") : null,
      n.statut === "soumise" && droits.includes("rh.gerer") ? h("div", { class: "actions" }, h("button", { onclick: async () => { await api("POST", `/notes-frais/${n.id}/decision`, { decision: "approuvee" }); ecranNotesFrais("Note approuvée."); } }, "Approuver"), h("details", {}, h("summary", {}, "Refuser"), formulaire(async (v) => { await api("POST", `/notes-frais/${n.id}/decision`, { decision: "refusee", motif: v.m.trim() }); ecranNotesFrais("Note refusée."); }, [champ("Motif", { name: "m", required: true, minlength: 3 })], "Refuser"))) : null,
      parNote.get(n.id)?.length ? formulaire(async (v) => { await api("POST", `/notes-frais/${n.id}/paiement`, { portefeuilleId: v.w }); ecranNotesFrais("Note payée."); }, [choix("w", "Payer depuis", parNote.get(n.id).map((w) => [w.id, w.nom]))], "Payer") : null)) : h("p", { class: "discret-texte" }, "Aucune note.")));
}
async function ecranSites(message) {
  const [sites, entites] = await Promise.all([api("GET", "/sites-pointage"), entitesPour("rh_paie")]);
  vue(h("button", { class: "discret", onclick: () => ecranRh() }, "← RH"), h("h1", {}, "Bornes de pointage"), message ? h("div", { class: "succes", role: "status" }, message) : null, h("p", {}, "Dès qu'une borne existe dans une branche, ses employés doivent saisir ou scanner le code affiché. Le code change chaque minute, mais une photo envoyée dans la minute reste utilisable."),
    h("div", { class: "carte" }, sites.map((s) => h("div", { class: "ligne apprenant" }, h("span", {}, `${s.nom} · ${s.entite}${s.actif ? "" : " · Arrêtée"}`), s.actif ? h("button", { onclick: () => ecranBorne(s) }, "Afficher la borne") : null))),
    h("div", { class: "carte" }, formulaire(async (v) => { await api("POST", "/sites-pointage", { entiteId: v.e, nom: v.n.trim() }); ecranSites("Borne créée."); }, [h("div", { class: "grille" }, champ("Nom du site", { name: "n", required: true }), choix("e", "Entité", entites))], "Créer une borne")));
}
async function ecranBorne(s) {
  const c = await api("GET", `/sites-pointage/${s.id}/code`);
  vue(h("button", { class: "discret", onclick: () => ecranSites() }, "← Bornes"), h("h1", {}, s.nom), h("img", { src: `data:image/svg+xml;base64,${btoa(c.qr_svg)}`, alt: "Code à scanner", width: 280, height: 280 }), h("p", { style: "font-size:3rem;letter-spacing:.2em" }, c.code));
  const depart = navigation;
  setTimeout(() => { if (depart === navigation) ecranBorne(s).catch(() => {}); }, c.valide_ms + 200);
}
async function ecranComptesEmployes(message) {
  const employes = await api("GET", "/employes");
  vue(h("button", { class: "discret", onclick: () => ecranRh() }, "← RH"), h("h1", {}, "Comptes des employés"), message ? h("div", { class: "succes", role: "status" }, message) : null, h("p", {}, "Saisissez l'email du compte de connexion à relier. Le compte se crée dans Accès."),
    h("div", { class: "carte" }, employes.map((e) => h("details", { class: "apprenant" }, h("summary", {}, `${e.nom} · ${e.matricule}`), formulaire(async (v) => { await api("PUT", `/employes/${e.id}/compte`, { email: v.m.trim() }); ecranComptesEmployes(`${e.nom} est relié.`); }, [champ("Email du compte", { name: "m", type: "email", required: true })], "Relier")))));
}
const ETAPES_CANDIDAT = [["recue", "Reçue"], ["preselection", "Présélection"], ["entretien", "Entretien"], ["retenue", "Retenue"], ["refusee", "Refusée"]];
async function ecranRecrutement(message) {
  const gere = droits.includes("rh.gerer");
  const [offres, entites] = await Promise.all([api("GET", "/offres-emploi"), gere ? entitesPour("rh_paie") : []]);
  vue(h("button", { class: "discret", onclick: () => ecranRh() }, "← RH"), h("h1", {}, "Recrutement"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, offres.length ? offres.map((o) => h("div", { class: "apprenant" }, h("button", { class: "session", onclick: () => ecranOffre(o) }, `${o.titre} · ${o.entite} · ${o.candidats} candidature(s)${o.ouverte ? "" : " · Fermée"}`), o.ouverte ? h("a", { href: o.lien, target: "_blank", rel: "noopener" }, "Page publique de l'offre") : null)) : h("p", { class: "discret-texte" }, "Aucune offre.")),
    gere && entites.length ? h("details", { class: "carte" }, h("summary", {}, "Nouvelle offre"), formulaire(async (v) => { await api("POST", "/offres-emploi", { entiteId: v.e, titre: v.t.trim(), description: v.d.trim(), lieu: v.l.trim() || undefined, typeContrat: v.c }); ecranRecrutement("Offre publiée."); }, [h("div", { class: "grille" }, champ("Titre", { name: "t", required: true }), choix("e", "Entité", entites), champ("Lieu", { name: "l" }), choix("c", "Contrat", [["cdi", "CDI"], ["cdd", "CDD"], ["stage", "Stage"], ["prestataire", "Prestataire"], ["autre", "Autre"]])), h("label", {}, "Description", h("textarea", { name: "d", rows: 5, required: true }))], "Publier")) : null);
}
async function ecranOffre(o, message) {
  const c = await api("GET", `/offres-emploi/${o.id}/candidatures`);
  const gere = droits.includes("rh.gerer");
  const R = (m) => ecranOffre(o, m);
  vue(h("button", { class: "discret", onclick: () => ecranRecrutement() }, "← Recrutement"), h("h1", {}, o.titre), message ? h("div", { class: "succes", role: "status" }, message) : null,
    gere && o.ouverte ? h("button", { class: "discret", onclick: async () => { await api("POST", `/offres-emploi/${o.id}/cloture`); ecranRecrutement("Offre fermée."); } }, "Fermer l'offre") : null,
    h("div", { class: "carte" }, c.length ? c.map((x) => h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", { class: "nom" }, x.nom), h("span", {}, x.etape === "embauchee" ? "Embauchée" : ETAPES_CANDIDAT.find((e) => e[0] === x.etape)[1])), h("div", { class: "discret-texte" }, [x.telephone, x.email].filter(Boolean).join(" · ")), x.presentation ? h("p", {}, x.presentation) : null, x.lien_cv ? h("a", { href: x.lien_cv, target: "_blank", rel: "noopener noreferrer" }, "CV en ligne") : null, x.cv_fichier ? h("button", { class: "discret", onclick: async () => { const r = await fetch(`/candidatures/${x.id}/cv`, { headers: { authorization: `Bearer ${jeton}` } }); const u = URL.createObjectURL(await r.blob()); h("a", { href: u, download: `CV ${x.nom}.pdf` }).click(); setTimeout(() => URL.revokeObjectURL(u), 10000); } }, "Télécharger le CV") : null,
      x.entretiens.map((e) => h("div", { class: "discret-texte" }, `Entretien ${heure(e.quand)}${e.lieu ? ` · ${e.lieu}` : ""}`)),
      gere && x.etape !== "embauchee" ? h("div", { class: "actions" }, h("select", { "aria-label": "Étape", onchange: async (e) => { await api("PATCH", `/candidatures/${x.id}`, { etape: e.target.value }); R("Étape enregistrée."); } }, ETAPES_CANDIDAT.map(([k, l]) => h("option", { value: k, selected: k === x.etape }, l))),
        h("details", {}, h("summary", {}, "Planifier un entretien"), formulaire(async (v) => { await api("POST", `/candidatures/${x.id}/entretiens`, { quand: new Date(v.q).toISOString(), lieu: v.l.trim() || undefined }); R("Entretien planifié."); }, [champ("Date et heure", { name: "q", type: "datetime-local", required: true }), champ("Lieu", { name: "l" })], "Planifier")),
        x.etape === "retenue" ? h("details", {}, h("summary", {}, "Embaucher"), formulaire(async (v) => { await api("POST", `/candidatures/${x.id}/embauche`, { dateEmbauche: v.d }); R("Dossier employé créé."); }, [champ("Date d'embauche", { name: "d", type: "date", required: true })], "Créer le dossier")) : null) : null)) : h("p", { class: "discret-texte" }, "Aucune candidature.")));
}
async function ecranPromotions(message) {
  const [l, produits] = await Promise.all([api("GET", "/promotions"), api("GET", "/produits")]);
  vue(h("h1", {}, "Promotions"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, l.length ? l.map((x) => h("div", { class: "ligne apprenant" }, h("span", {}, `${x.nom} · ${x.produit} · ${x.type === "pourcentage" ? `-${x.valeur} %` : `-${fcfa(x.valeur)}`} · ${dateFr(x.debut)} au ${dateFr(x.fin)}${x.actif ? "" : " · Arrêtée"}`), x.actif ? h("button", { class: "discret", onclick: async () => { await api("POST", `/promotions/${x.id}/arret`); ecranPromotions("Promotion arrêtée."); } }, "Arrêter") : null)) : h("p", { class: "discret-texte" }, "Aucune promotion.")),
    produits.length ? h("div", { class: "carte" }, h("h2", {}, "Nouvelle promotion"), formulaire(async (v) => { await api("POST", "/promotions", { produitId: v.p, nom: v.n.trim(), type: v.t, valeur: Number(v.v), debut: v.d, fin: v.f }); ecranPromotions("Promotion enregistrée."); }, [h("div", { class: "grille" }, champ("Nom", { name: "n", required: true }), choix("p", "Produit", produits.filter((p) => p.actif).map((p) => [p.id, `${p.nom} : ${fcfa(p.prix_vente)}`])), choix("t", "Réduction", [["pourcentage", "Pourcentage"], ["montant", "Montant en FCFA"]]), champ("Valeur", { name: "v", type: "number", min: 1, required: true }), champ("Du", { name: "d", type: "date", value: aujourdhui(), required: true }), champ("Au", { name: "f", type: "date", required: true }))], "Enregistrer")) : null);
}
