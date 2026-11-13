"use strict";
/* OKR : arbre par branche pour la direction, vue équipe pour le responsable, « Mes OKR » pour chacun. Mobile d'abord. */

const FEUX = { vert: ["ok", "Dans les temps"], orange: ["attente", "À surveiller"], rouge: ["retard", "En retard"] };
const NIVEAUX_OKR = [["branche", "Branche"], ["equipe", "Équipe ou service"], ["individuel", "Individuel"]];
const TYPES_OKR = [["engage", "Engagé"], ["ambitieux", "Ambitieux"]];
const STATUTS_OKR = { propose: "Proposé, à valider", actif: "En cours", clos: "Clos", abandonne: "Abandonné" };
const STATUTS_INITIATIVE = [["a_faire", "À faire"], ["en_cours", "En cours"], ["terminee", "Terminée"], ["abandonnee", "Abandonnée"]];
const SOURCES_VALEUR = { reprise: "reprise", creation: "départ", manuel: "saisie", point: "point", auto: "mesure de nuit" };
const CATEGORIES_BLOCAGE = [["autre", "Autre"], ["client", "Client"], ["stock", "Stock"], ["caisse", "Caisse"], ["materiel", "Matériel"], ["informatique", "Informatique"], ["logistique", "Logistique"], ["fournisseur", "Fournisseur"], ["equipe", "Équipe"]];
const DESTINATAIRES_BLOCAGE = [["responsable", "Mon responsable"], ["rh", "Ressources humaines"], ["finance", "Finance"], ["logistique", "Logistique"], ["informatique", "Informatique"], ["direction", "Direction"]];

const periodeOkr = (jour = aujourdhui()) => `${jour.slice(0, 4)}-T${Math.ceil(Number(jour.slice(5, 7)) / 3)}`;
const decalerPeriode = (p, n) => { let [a, t] = p.split("-T").map(Number); t += n; while (t > 4) { t -= 4; a += 1; } while (t < 1) { t += 4; a -= 1; } return `${a}-T${t}`; };
const libellePeriode = (p) => `${p.split("-T")[1]}e trimestre ${p.split("-T")[0]}`.replace(/^1e/, "1er");
const nombreOkr = (n) => Number(n).toLocaleString("fr-FR");
const feuOkr = (f) => h("span", { class: `pastille ${FEUX[f][0]}` }, FEUX[f][1]);
const noteOkr = (o) => o.note === null || o.note === undefined ? null : h("span", { class: `pastille ${o.reussi ? "ok" : "retard"}` }, `Note ${String(o.note).replace(".", ",")}${o.reussi ? " · réussi" : ""}`);
const valeurKr = (r) => `${nombreOkr(r.actuel)} / ${nombreOkr(r.cible)}${r.unite ? ` ${r.unite}` : ""}`;
const choixPeriode = (periode, suite) => h("label", {}, "Trimestre", h("select", { onchange: (e) => suite(e.target.value) },
  [-3, -2, -1, 0, 1].map((n) => decalerPeriode(periodeOkr(), n)).concat(periode).filter((p, i, l) => l.indexOf(p) === i).sort()
    .map((p) => h("option", { value: p, selected: p === periode }, libellePeriode(p)))));

/** Ligne résumée d'un résultat clé : valeur, avancement, feu, confiance. */
function resumeKr(r) {
  return h("div", { class: "okr-kr" },
    h("div", { class: "ligne" }, h("span", {}, r.libelle), r.note !== null ? noteOkr(r) : feuOkr(r.feu)),
    barre(r.avancement),
    h("div", { class: "discret-texte" }, [
      `${valeurKr(r)} · ${r.avancement} %`, r.proprietaire, r.mode === "auto" ? "mesuré chaque nuit" : null,
      r.dernier_point ? `confiance ${r.dernier_point.confiance}/10` : "pas encore de point", r.confiance_en_baisse ? "confiance en baisse" : null,
      r.initiatives_en_retard ? `${r.initiatives_en_retard} initiative(s) en retard` : null,
    ].filter(Boolean).join(" · ")));
}

/** Carte d'un objectif dans l'arbre, avec ses enfants en retrait. */
function carteOkr(o, tous) {
  const enfants = tous.filter((x) => x.parent_id === o.id);
  return h("div", { class: "okr-noeud" },
    h("button", { class: "session", onclick: () => ecranObjectifOkr(o.id) },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, o.titre), o.statut === "clos" ? noteOkr(o) : o.statut === "actif" ? feuOkr(o.feu) : h("span", { class: "pastille" }, STATUTS_OKR[o.statut])),
      barre(o.avancement),
      h("div", { class: "discret-texte" }, [libelle(NIVEAUX_OKR, o.niveau), libelle(TYPES_OKR, o.type), o.entite, o.proprietaire || (o.ancien_responsable ? `ancien responsable : ${o.ancien_responsable}` : "sans propriétaire"), `${o.avancement} %`].join(" · ")),
      o.resultats.map(resumeKr)),
    enfants.length ? h("div", { class: "okr-enfants" }, enfants.map((e) => carteOkr(e, tous))) : null);
}

/** Lignes de résultats clés à ajouter dans le formulaire : mesure automatique ou valeur saisie au point hebdomadaire. */
function lignesResultats(mesures, personnes) {
  const zone = h("div");
  const ajouter = () => zone.append(h("fieldset", { class: "ligne-kr" },
    h("legend", {}, `Résultat clé ${zone.children.length + 1}`),
    h("div", { class: "grille" },
      champ("Libellé", { name: "kl", required: true, maxlength: 300 }),
      choix("kk", "Mesure", [["", "Saisie au point hebdomadaire"], ...mesures.map((m) => [m.code, `Automatique : ${m.libelle}`])]),
      champ("Départ", { name: "kd", type: "number", step: "any", value: 0 }),
      champ("Cible", { name: "kc", type: "number", step: "any", required: true }),
      champ("Unité", { name: "ku", maxlength: 30 }),
      choix("kp", "Propriétaire", [["", "Celui de l'objectif"], ...personnes.map((p) => [p.id, p.nom])]))));
  ajouter();
  const lire = () => [...zone.children].map((l) => {
    const v = (n) => l.querySelector(`[name=${n}]`).value;
    return { libelle: v("kl").trim(), kpi: v("kk") || undefined, depart: Number(v("kd") || 0), cible: Number(v("kc")), unite: v("ku").trim() || undefined, proprietaireId: v("kp") || undefined };
  });
  return { zone, ajouter, lire };
}

/** Formulaire d'un nouvel OKR. Les listes de mesures et de personnes suivent l'entité choisie : celles de sa branche seulement. */
function formulaireOkr({ entites, objectifs, periode, individuel }, suite) {
  const zoneDyn = h("div");
  let lignes = null;
  const charger = async (entiteId) => {
    const [mesures, personnes] = individuel ? [[], []] : await Promise.all([api("GET", `/okr/mesures?entiteId=${entiteId}`), api("GET", `/okr/personnes?entiteId=${entiteId}`)]);
    lignes = lignesResultats(mesures, personnes);
    zoneDyn.replaceChildren(
      individuel ? null : choix("proprietaireId", "Propriétaire de l'objectif", [["", "Moi"], ...personnes.map((p) => [p.id, p.nom])]),
      lignes.zone, h("button", { type: "button", class: "discret", onclick: () => lignes.ajouter() }, "Ajouter un résultat clé"),
      h("p", { class: "discret-texte" }, "Conseil : 3 à 5 objectifs par niveau et 3 à 5 résultats clés par objectif."));
  };
  const selectEntite = h("select", { name: "entiteId", onchange: (e) => charger(e.target.value) }, entites.map(([id, nom]) => h("option", { value: id }, nom)));
  const f = formulaire(async (v) => {
    const r = await api("POST", "/okr", {
      entiteId: v.entiteId, niveau: individuel ? "individuel" : v.niveau, type: v.type, titre: v.titre.trim(), description: v.description.trim() || undefined,
      periode: v.periode, parentId: v.parentId || undefined, proprietaireId: v.proprietaireId || undefined, resultats: lignes.lire(),
    });
    suite(r);
  }, [
    h("div", { class: "grille" },
      champ("Objectif", { name: "titre", required: true, maxlength: 300 }),
      h("label", {}, "Entité", selectEntite),
      individuel ? null : choix("niveau", "Niveau", NIVEAUX_OKR, "branche"),
      choix("type", "Type", [["engage", "Engagé : à tenir entièrement"], ["ambitieux", "Ambitieux : réussi dès 0,6"]], "engage"),
      champ("Trimestre", { name: "periode", value: periode, pattern: "[0-9]{4}-T[1-4]", required: true }),
      choix("parentId", "Aligné sur", [["", "Aucun"], ...objectifs.map((o) => [o.id, o.titre])])),
    h("label", {}, "Description", h("textarea", { name: "description", rows: 2, maxlength: 2000 })),
    zoneDyn,
  ], individuel ? "Proposer à mon responsable" : "Créer l'OKR");
  if (entites.length) charger(entites[0][0]);
  return f;
}

async function ecranOkr(message, periode = periodeOkr(), brancheId = "") {
  const gere = droits.includes("pilotage.gerer");
  const [r, vision, entites] = await Promise.all([
    api("GET", `/okr?periode=${periode}${brancheId ? `&brancheId=${brancheId}` : ""}`), api("GET", "/okr/vision"), gere ? entitesPour("pilotage") : [],
  ]);
  const relire = (m) => ecranOkr(m, periode, brancheId);
  const ids = new Set(r.objectifs.map((o) => o.id));
  const racines = r.objectifs.filter((o) => !o.parent_id || !ids.has(o.parent_id));
  const parBranche = r.branches.map((b) => [b, racines.filter((o) => o.branche_id === b.id)]).filter(([, l]) => l.length);
  vue(
    h("div", { class: "actions" }, h("button", { class: "discret", onclick: () => ecranPilotage() }, "← Pilotage"), h("button", { class: "discret", onclick: () => ecranEquipeOkr() }, "Vue équipe"), h("button", { class: "discret", onclick: () => ecranMesOkr() }, "Mes OKR")),
    h("h1", {}, "OKR"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte okr-vision" }, h("h2", {}, "Vision SGC"), h("p", {}, vision ? vision.texte : "La vision du groupe n'est pas encore écrite."),
      r.gerer ? h("details", {}, h("summary", {}, vision ? "Modifier la vision" : "Écrire la vision"), formulaire(async (v) => { await api("POST", "/okr/vision", { texte: v.texte.trim() }); relire("Vision enregistrée."); },
        [h("label", {}, "Vision", h("textarea", { name: "texte", rows: 3, required: true, minlength: 3 }, vision?.texte || ""))], "Enregistrer")) : null),
    h("div", { class: "grille" }, choixPeriode(periode, (p) => ecranOkr(null, p, brancheId)),
      r.branches.length > 1 ? h("label", {}, "Branche", h("select", { onchange: (e) => ecranOkr(null, periode, e.target.value) }, h("option", { value: "" }, "Toutes"), r.branches.map((b) => h("option", { value: b.id, selected: b.id === brancheId }, b.nom)))) : null),
    h("p", { class: "discret-texte" }, `${r.ecoule} % du trimestre écoulé. Feu vert : dans les temps ; orange : à surveiller ; rouge : en retard sur le temps écoulé. Un OKR ambitieux est attendu à 70 %.`),
    r.alertes.map((a) => h("div", { class: "alerte-caisse" }, `${a.nombre} objectifs au niveau « ${libelle(NIVEAUX_OKR, a.niveau)} » pour ${a.entite} : au-delà de 5, l'équipe se disperse.`)),
    parBranche.length ? parBranche.map(([b, l]) => h("div", { class: "carte" }, h("h2", {}, b.nom), l.map((o) => carteOkr(o, r.objectifs))))
      : h("div", { class: "carte" }, h("p", { class: "discret-texte" }, "Aucun OKR pour ce trimestre.")),
    gere && entites.length ? h("details", { class: "carte" }, h("summary", {}, "Nouvel OKR"),
      formulaireOkr({ entites, objectifs: r.objectifs.filter((o) => o.statut === "actif"), periode }, (x) => ecranObjectifOkr(x.id, x.alertes.length ? "OKR créé. Attention : plus de 5 objectifs ou résultats clés à ce niveau." : "OKR créé."))) : null);
}

/** Point hebdomadaire d'un résultat clé : valeur, confiance, blocages, prochaine action, preuve, et problème au besoin. */
function formulairePoint(r, documents, suite) {
  const zoneProbleme = h("div", { hidden: true },
    h("div", { class: "grille" }, choix("categorie", "Catégorie", CATEGORIES_BLOCAGE, "autre"), choix("destinataire", "À qui", DESTINATAIRES_BLOCAGE, "responsable"),
      choix("priorite", "Priorité", [["normal", "Normal"], ["important", "Important"], ["urgent", "Urgent"]], "normal"), champ("Motif de l'urgence", { name: "motifUrgence" })));
  return formulaire(async (v) => {
    const res = await api("POST", `/okr/resultats/${r.id}/points`, {
      valeur: r.mode === "manuel" ? Number(v.valeur) : undefined, confiance: Number(v.confiance), blocages: v.blocages.trim() || undefined, prochaineAction: v.prochaine.trim() || undefined,
      documentId: v.documentId || undefined,
      probleme: v.signaler === "oui" ? { categorie: v.categorie, destinataire: v.destinataire, priorite: v.priorite, motifUrgence: v.motifUrgence?.trim() || undefined } : undefined,
    });
    suite(`Point enregistré${res.probleme_id && v.signaler === "oui" ? " et problème signalé" : ""}.${res.confiance_en_baisse ? " Confiance en baisse deux semaines de suite : parlez-en à votre responsable." : ""}`);
  }, [
    h("div", { class: "grille" },
      r.mode === "manuel" ? champ(`Valeur atteinte${r.unite ? ` (${r.unite})` : ""}`, { name: "valeur", type: "number", step: "any", required: true, value: r.actuel }) : h("p", { class: "discret-texte" }, `Valeur mesurée par le système : ${valeurKr(r)}.`),
      choix("confiance", "Confiance d'atteindre la cible (1 à 10)", Array.from({ length: 10 }, (_, i) => [String(10 - i), String(10 - i)]), String(r.dernier_point?.confiance ?? r.confiance ?? 7))),
    h("label", {}, "Blocages", h("textarea", { name: "blocages", rows: 2, maxlength: 3000 })),
    h("label", {}, "Prochaine action", h("textarea", { name: "prochaine", rows: 2, maxlength: 2000 })),
    documents.length ? choix("documentId", "Preuve (module Documents, facultatif)", [["", "Aucune"], ...documents.map((d) => [d.id, `${d.titre} · ${d.entite}`])]) : null,
    h("label", { class: "case" }, h("input", { type: "checkbox", name: "signaler", value: "oui", onchange: (e) => { zoneProbleme.hidden = !e.target.checked; } }), "Signaler ce blocage comme problème rencontré"),
    zoneProbleme,
  ], "Enregistrer le point");
}

async function ecranObjectifOkr(id, message) {
  const [o, documents] = await Promise.all([api("GET", `/okr/${id}`), droits.includes("documents.voir") ? api("GET", "/documents").catch(() => []) : []]);
  const relire = (m) => ecranObjectifOkr(id, m);
  const actif = o.statut === "actif";
  const projets = o.peut_gerer || o.resultats.some((r) => r.peut_pointer) ? await api("GET", "/projets").catch(() => []) : [];
  const toutesNotes = o.resultats.length && o.resultats.every((r) => r.note !== null);
  vue(
    h("div", { class: "actions" }, h("button", { class: "discret", onclick: () => (droits.includes("pilotage.voir") ? ecranOkr(null, o.periode) : ecranMesOkr()) }, "← OKR"), h("button", { class: "discret", onclick: () => ecranMesOkr() }, "Mes OKR")),
    h("h1", {}, o.titre),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" },
      h("div", { class: "ligne" }, h("span", {}, `${libelle(NIVEAUX_OKR, o.niveau)} · ${libelle(TYPES_OKR, o.type)} · ${libellePeriode(o.periode)}`), o.statut === "clos" ? noteOkr(o) : o.statut === "actif" ? feuOkr(o.feu) : h("span", { class: "pastille" }, STATUTS_OKR[o.statut])),
      barre(o.avancement),
      h("p", { class: "discret-texte" }, `${o.entite} · ${o.proprietaire || "sans propriétaire"}${o.ancien_responsable ? ` · ancien responsable : ${o.ancien_responsable}` : ""} · ${o.avancement} % pour ${o.ecoule} % du trimestre écoulé`),
      o.description ? h("p", {}, o.description) : null,
      o.motif_statut ? h("p", { class: "discret-texte" }, `Motif : ${o.motif_statut}`) : null,
      o.type === "ambitieux" ? h("p", { class: "discret-texte" }, "OKR ambitieux : réussi dès 0,6. Sa note est une information ; elle n'entre pas dans l'évaluation.") : null,
      o.parent ? h("p", {}, "Aligné sur : ", h("button", { class: "lien", onclick: () => ecranObjectifOkr(o.parent.id) }, o.parent.titre)) : null,
      o.enfants.length ? h("p", {}, "Y contribuent : ", o.enfants.map((e, i) => [i ? ", " : "", h("button", { class: "lien", onclick: () => ecranObjectifOkr(e.id) }, e.titre)])) : null,
      o.origine_id ? h("p", {}, h("button", { class: "lien", onclick: () => ecranObjectifOkr(o.origine_id) }, "Trimestre précédent")) : null,
      o.reconduit_en ? h("p", {}, h("button", { class: "lien", onclick: () => ecranObjectifOkr(o.reconduit_en) }, "Reconduit au trimestre suivant"))
        : null),
    o.statut === "propose" && o.peut_valider ? h("div", { class: "carte" }, h("h2", {}, "OKR proposé : votre décision"),
      h("div", { class: "actions" }, h("button", { onclick: async () => { await api("POST", `/okr/${id}/validation`, { decision: "accepter" }); relire("OKR validé."); } }, "Valider")),
      h("details", {}, h("summary", {}, "Ne pas retenir"), formulaire(async (v) => { await api("POST", `/okr/${id}/validation`, { decision: "refuser", motif: v.motif.trim() }); relire("OKR non retenu."); }, [champ("Motif", { name: "motif", required: true })], "Confirmer"))) : null,
    o.resultats.map((r) => h("div", { class: "carte" },
      h("div", { class: "ligne" }, h("h2", {}, r.libelle), r.note !== null ? noteOkr(r) : feuOkr(r.feu)),
      barre(r.avancement),
      h("p", {}, `${valeurKr(r)} · ${r.avancement} % · ${r.proprietaire || "sans propriétaire"}`),
      h("p", { class: "discret-texte" }, r.mode === "auto" ? `Mesuré chaque nuit : ${r.kpi_libelle}.` : "Mis à jour au point hebdomadaire.",
        r.dernier_point ? ` Confiance ${r.dernier_point.confiance}/10.` : "", r.confiance_en_baisse ? " Confiance en baisse deux semaines de suite." : ""),
      r.note !== null ? h("p", {}, `Note ${String(r.note).replace(".", ",")} : ${r.commentaire_note}`) : null,
      r.points.length ? h("details", {}, h("summary", {}, `Points hebdomadaires (${r.points.length})`), r.points.map((p) => h("div", { class: "apprenant" },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, `Semaine du ${dateFr(p.semaine)}`), h("span", { class: "pastille" }, `Confiance ${p.confiance}/10`)),
        h("div", { class: "discret-texte" }, [p.valeur !== null ? `Valeur ${nombreOkr(p.valeur)}` : null, p.auteur, p.blocages ? `Blocages : ${p.blocages}` : null, p.prochaine_action ? `Prochaine action : ${p.prochaine_action}` : null, p.document ? `Preuve : ${p.document}` : null].filter(Boolean).join(" · ")),
        p.probleme_id ? h("button", { class: "lien", onclick: () => ecranProbleme(p.probleme_id) }, "Voir le problème signalé") : null))) : null,
      r.historique.length > 1 ? h("details", {}, h("summary", {}, "Historique des valeurs"), h("ul", {}, r.historique.map((x) => h("li", {}, `${heure(x.cree_le)} : ${nombreOkr(x.valeur)} (${SOURCES_VALEUR[x.source]}${x.auteur ? `, ${x.auteur}` : ""})`)))) : null,
      r.contributions.length ? h("details", {}, h("summary", {}, "Contribution des objectifs du jour"), h("div", { class: "defilant" }, h("table", {},
        h("thead", {}, h("tr", {}, ["Personne", "Objectifs du jour liés", "Atteints"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", {}, r.contributions.map((c) => h("tr", {}, h("td", {}, c.nom), h("td", { class: "nombre" }, String(c.objectifs)), h("td", { class: "nombre" }, String(c.atteints)))))))) : null,
      h("div", {}, h("h3", {}, "Initiatives"), r.initiatives.length ? r.initiatives.map((i) => h("div", { class: "apprenant" },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, i.titre), h("span", { class: i.en_retard ? "pastille retard" : i.statut === "terminee" ? "pastille ok" : "pastille" }, i.en_retard ? "En retard" : libelle(STATUTS_INITIATIVE, i.statut))),
        h("div", { class: "discret-texte" }, [i.proprietaire, i.echeance ? `échéance ${dateFr(i.echeance)}` : null, i.projet ? `projet ${i.projet} : ${i.terminees}/${i.taches} tâches` : null].filter(Boolean).join(" · ")),
        actif && r.peut_pointer && !["terminee", "abandonnee"].includes(i.statut) ? h("div", { class: "actions" },
          STATUTS_INITIATIVE.filter(([s]) => s !== i.statut && s !== "a_faire").map(([s, l]) => h("button", { class: "discret", onclick: async () => { await api("PATCH", `/okr/initiatives/${i.id}`, { statut: s }); relire("Initiative mise à jour."); } }, l))) : null))
        : h("p", { class: "discret-texte" }, "Aucune initiative.")),
      actif && r.peut_pointer ? h("details", { open: !r.point_semaine }, h("summary", {}, r.point_semaine ? "Corriger le point de la semaine" : "Faire le point de la semaine"), formulairePoint(r, documents, relire)) : null,
      actif && r.peut_pointer ? h("details", {}, h("summary", {}, "Ajouter une initiative"), formulaire(async (v) => {
        await api("POST", `/okr/resultats/${r.id}/initiatives`, { titre: v.titre.trim(), echeance: v.echeance || undefined, projetId: v.projetId || undefined });
        relire("Initiative ajoutée.");
      }, [h("div", { class: "grille" }, champ("Action ou projet", { name: "titre", required: true, maxlength: 300 }), champ("Échéance", { name: "echeance", type: "date" }),
        projets.length ? choix("projetId", "Relier à un projet existant", [["", "Aucun"], ...projets.map((p) => [p.id, `${p.nom} · ${p.entite}`])]) : null)], "Ajouter")) : null,
      actif && o.peut_gerer && o.notation_ouverte ? h("details", { open: r.note === null && o.ecoule >= 100 }, h("summary", {}, r.note === null ? "Noter ce résultat clé" : "Corriger la note"), formulaire(async (v) => {
        const n = await api("POST", `/okr/resultats/${r.id}/note`, { note: Number(String(v.note).replace(",", ".")), commentaire: v.commentaire.trim() });
        relire(`Note enregistrée${n.reussi ? " : réussi." : "."}`);
      }, [h("div", { class: "grille" }, champ("Note de 0 à 1", { name: "note", type: "number", min: 0, max: 1, step: 0.05, required: true, value: r.note ?? "" }), champ("Commentaire", { name: "commentaire", required: true, minlength: 3, value: r.commentaire_note || "" }))], "Noter")) : null)),
    o.bilan ? h("div", { class: "carte" }, h("h2", {}, "Bilan du trimestre"), h("p", {}, h("strong", {}, "Appris : "), o.bilan.appris),
      o.bilan.garder ? h("p", {}, h("strong", {}, "À garder : "), o.bilan.garder) : null, o.bilan.abandonner ? h("p", {}, h("strong", {}, "À abandonner : "), o.bilan.abandonner) : null,
      h("p", { class: "discret-texte" }, `${o.bilan.auteur}, ${heure(o.bilan.cree_le)}`)) : null,
    o.peut_gerer && actif ? h("div", { class: "carte" }, h("h2", {}, "Gérer cet OKR"),
      toutesNotes ? h("details", { open: true }, h("summary", {}, "Clore le trimestre : bilan guidé"), formulaire(async (v) => {
        const c = await api("POST", `/okr/${id}/cloture`, { appris: v.appris.trim(), garder: v.garder.trim() || undefined, abandonner: v.abandonner.trim() || undefined });
        relire(`OKR clos avec la note ${String(c.note).replace(".", ",")}${c.reussi ? " : réussi." : "."}`);
      }, [h("label", {}, "Qu'avons-nous appris ?", h("textarea", { name: "appris", rows: 2, required: true, minlength: 3 })), h("label", {}, "Que garder ?", h("textarea", { name: "garder", rows: 2 })), h("label", {}, "Qu'abandonner ?", h("textarea", { name: "abandonner", rows: 2 }))], "Clore l'OKR"))
        : o.notation_ouverte ? h("p", { class: "discret-texte" }, "Notez chaque résultat clé de 0 à 1 pour clore le trimestre.") : null,
      h("details", {}, h("summary", {}, "Modifier"), formulaire(async (v) => { await api("PATCH", `/okr/${id}`, { titre: v.titre.trim(), type: v.type, description: v.description.trim() }); relire("OKR modifié."); },
        [h("div", { class: "grille" }, champ("Objectif", { name: "titre", required: true, value: o.titre }), choix("type", "Type", TYPES_OKR, o.type)), h("label", {}, "Description", h("textarea", { name: "description", rows: 2 }, o.description || ""))], "Enregistrer")),
      h("details", {}, h("summary", {}, "Ajouter un résultat clé"), formulaire(async (v) => {
        const r = await api("POST", `/okr/${id}/resultats`, { libelle: v.libelle.trim(), depart: Number(v.depart || 0), cible: Number(v.cible), unite: v.unite.trim() || undefined });
        relire(r.alertes.length ? "Résultat clé ajouté. Attention : plus de 5 résultats clés." : "Résultat clé ajouté.");
      }, [h("div", { class: "grille" }, champ("Libellé", { name: "libelle", required: true }), champ("Départ", { name: "depart", type: "number", step: "any", value: 0 }), champ("Cible", { name: "cible", type: "number", step: "any", required: true }), champ("Unité", { name: "unite" }))], "Ajouter")),
      h("details", {}, h("summary", {}, "Abandonner"), formulaire(async (v) => { await api("POST", `/okr/${id}/abandon`, { motif: v.motif.trim() }); relire("OKR abandonné."); }, [champ("Motif", { name: "motif", required: true, minlength: 3 })], "Abandonner"))) : null,
    o.peut_gerer && o.statut !== "propose" && !o.reconduit_en ? h("div", { class: "actions" }, h("button", { class: "discret", onclick: async () => {
      const x = await api("POST", `/okr/${id}/reconduction`);
      ecranObjectifOkr(x.id, `Reconduit au ${libellePeriode(x.periode)} avec ${x.resultats} résultat(s) clé(s).`);
    } }, "Reconduire au trimestre suivant")) : null);
}

async function ecranEquipeOkr(message, periode = periodeOkr()) {
  const r = await api("GET", `/okr/equipe?periode=${periode}`);
  vue(
    h("div", { class: "actions" }, droits.includes("pilotage.voir") ? h("button", { class: "discret", onclick: () => ecranOkr() }, "← OKR") : h("button", { class: "discret", onclick: () => ecranMonEspace() }, "← Mon espace"), h("button", { class: "discret", onclick: () => ecranMesOkr() }, "Mes OKR")),
    h("h1", {}, "OKR de mon équipe"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    choixPeriode(periode, (p) => ecranEquipeOkr(null, p)),
    h("p", { class: "discret-texte" }, `${r.ecoule} % du trimestre écoulé.`),
    r.a_valider.length ? h("div", { class: "carte" }, h("h2", {}, "OKR individuels à valider"), r.a_valider.map((o) => h("button", { class: "session", onclick: () => ecranObjectifOkr(o.id) }, h("span", { class: "nom" }, o.titre), h("div", { class: "discret-texte" }, o.proprietaire)))) : null,
    h("div", { class: "carte" }, h("h2", {}, "Confiance et avancement"), r.resultats.length ? r.resultats.map((k) => h("button", { class: "session", onclick: () => ecranObjectifOkr(k.objectif_id) },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, k.libelle), k.confiance_en_baisse ? h("span", { class: "pastille retard" }, "Confiance en baisse") : feuOkr(k.feu)),
      h("div", { class: "discret-texte" }, [k.objectif, k.proprietaire, `${k.avancement} %`, k.dernier_point ? `confiance ${k.dernier_point.confiance}/10` : "pas de point", k.point_semaine ? "point fait cette semaine" : "point de la semaine à faire"].filter(Boolean).join(" · ")))) : h("p", { class: "discret-texte" }, "Aucun résultat clé.")),
    h("div", { class: "carte" }, h("h2", {}, "Blocages signalés"), r.blocages.length ? r.blocages.map((b) => h("button", { class: "session", onclick: () => ecranObjectifOkr(b.objectif_id) },
      h("span", { class: "nom" }, `${b.resultat} · ${b.proprietaire || ""}`), h("div", { class: "discret-texte" }, `Semaine du ${dateFr(b.semaine)} : ${b.blocages}`))) : h("p", { class: "discret-texte" }, "Aucun blocage.")),
    h("div", { class: "carte" }, h("h2", {}, "Initiatives en retard"), r.initiatives_en_retard.length ? r.initiatives_en_retard.map((i) => h("button", { class: "session", onclick: () => ecranObjectifOkr(i.objectif_id) },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, i.titre), h("span", { class: "pastille retard" }, `Échéance ${dateFr(i.echeance)}`)), h("div", { class: "discret-texte" }, `${i.resultat} · ${i.proprietaire || ""}`))) : h("p", { class: "discret-texte" }, "Aucune initiative en retard.")));
}

async function ecranMesOkr(message, periode = periodeOkr()) {
  const [m, rattachables, documents] = await Promise.all([
    api("GET", `/moi/okr?periode=${periode}`), api("GET", "/moi/resultats-cles").catch(() => []), droits.includes("documents.voir") ? api("GET", "/documents").catch(() => []) : [],
  ]);
  const relire = (msg) => ecranMesOkr(msg, periode);
  const parents = rattachables.filter((r) => r.niveau !== "individuel").reduce((l, r) => (l.some((x) => x.id === r.objectif_id) ? l : [...l, { id: r.objectif_id, titre: r.objectif }]), []);
  vue(
    h("div", { class: "actions" }, h("button", { class: "discret", onclick: () => ecranMonEspace() }, "← Mon espace"), h("button", { class: "discret", onclick: () => ecranEquipeOkr() }, "Mon équipe")),
    h("h1", {}, "Mes OKR"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    choixPeriode(periode, (p) => ecranMesOkr(null, p)),
    h("p", { class: "discret-texte" }, `${m.ecoule} % du trimestre écoulé. Faites le point de chaque résultat clé une fois par semaine, le lundi de préférence.`),
    m.objectifs.length ? m.objectifs.map((o) => h("div", { class: "carte" },
      h("button", { class: "session", onclick: () => ecranObjectifOkr(o.id) },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, o.titre), o.statut === "clos" ? noteOkr(o) : o.statut === "actif" ? feuOkr(o.feu) : h("span", { class: "pastille" }, STATUTS_OKR[o.statut])),
        h("div", { class: "discret-texte" }, [libelle(NIVEAUX_OKR, o.niveau), libelle(TYPES_OKR, o.type), o.parent_titre ? `aligné sur : ${o.parent_titre}` : null].filter(Boolean).join(" · "))),
      o.resultats.map((r) => h("div", { class: "apprenant" }, resumeKr(r),
        r.mes_objectifs_jour ? h("div", { class: "discret-texte" }, `Mes objectifs du jour liés : ${r.mes_objectifs_jour}`) : null,
        r.a_moi && o.statut === "actif" ? h("details", { open: !r.point_semaine }, h("summary", {}, r.point_semaine ? "Point de la semaine fait : corriger" : "Faire le point de la semaine"), formulairePoint(r, documents, relire)) : null))))
      : h("div", { class: "carte" }, h("p", { class: "discret-texte" }, "Aucun OKR ne vous est confié ce trimestre.")),
    m.entite ? h("details", { class: "carte" }, h("summary", {}, "Proposer un OKR individuel"),
      h("p", { class: "discret-texte" }, "Facultatif. Votre responsable le valide avant qu'il compte."),
      formulaireOkr({ entites: [[m.entite.entite_id, m.entite.entite]], objectifs: parents, periode, individuel: true }, () => relire("OKR proposé à votre responsable."))) : null);
}

/** Dans « Ma journée » : rattacher un objectif du jour à un résultat clé. */
function lienResultatCle(o, rattachables, figee, suite) {
  if (!rattachables.length && !o.resultat_cle_id) return null;
  const erreur = h("div");
  return h("div", {}, h("label", { class: "okr-lien" }, "Fait avancer le résultat clé",
    h("select", { disabled: figee, onchange: async (e) => {
      erreur.replaceChildren();
      try { await api("PUT", `/moi/objectifs-jour/${o.id}/resultat-cle`, { resultatCleId: e.target.value || null }); suite(e.target.value ? "Objectif rattaché au résultat clé." : "Rattachement retiré."); }
      catch (x) { if (x.code !== "obsolete") erreur.replaceChildren(h("div", { class: "erreur", role: "alert" }, texteErreur(x))); }
    } }, h("option", { value: "" }, "Aucun"), rattachables.map((r) => h("option", { value: r.id, selected: r.id === o.resultat_cle_id }, `${r.libelle} (${r.objectif})`)))), erreur);
}
