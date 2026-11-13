"use strict";
/* Performance au quotidien : Ma journée, problèmes et solutions, Mon équipe, vue direction, réglages, messages. */

const CATEGORIES_PB = [["client", "Client"], ["stock", "Stock"], ["caisse", "Caisse"], ["materiel", "Matériel"], ["informatique", "Informatique"], ["logistique", "Logistique"],
  ["fournisseur", "Fournisseur"], ["securite", "Sécurité (cas sensible)"], ["harcelement", "Harcèlement (cas sensible)"], ["equipe", "Équipe"], ["conflit_responsable", "Conflit avec le responsable (cas sensible)"], ["autre", "Autre"]];
const LIB_CATEGORIE = Object.fromEntries(CATEGORIES_PB.map(([c, l]) => [c, l.replace(" (cas sensible)", "")]));
const DESTINATAIRES_PB = [["responsable", "Mon responsable"], ["rh", "Ressources humaines"], ["finance", "Finance"], ["logistique", "Logistique"], ["informatique", "Informatique"], ["direction", "Direction de la branche"]];
const PRIORITES_PB = { normal: "Normal", important: "Important", urgent: "Urgent" };
const STATUTS_PB = { signale: "Signalé", pris_en_charge: "Pris en charge", en_cours: "En cours", resolu: "Résolu", clos: "Clos" };
const DECISIONS_SOL = { en_attente: "En attente", acceptee: "Acceptée", acceptee_modifiee: "Acceptée avec modifications", a_etudier: "À étudier", refusee: "Refusée" };
const STATUTS_ACTION = { prevue: "Prévue", en_cours: "En cours", realisee: "Réalisée" };
const TYPES_OBJECTIF = { mesure_systeme: "Mesuré par le système", chiffre_declare: "Chiffre déclaré", tache: "Tâche à faire" };
const SENSIBLES_PB = ["securite", "harcelement", "conflit_responsable"];

const pastillePrio = (p) => h("span", { class: `pastille prio-${p}` }, PRIORITES_PB[p]);
const nombreOuVide = (v) => (v === "" || v === undefined || v === null ? undefined : Number(v));
async function telechargerPiece(id, nom) {
  const r = await fetch(`/performance/pieces/${id}`, { headers: { authorization: `Bearer ${jeton}` } });
  if (!r.ok) throw Object.assign(new Error(), { code: (await r.json().catch(() => ({}))).erreur || "inconnue" });
  const u = URL.createObjectURL(await r.blob());
  h("a", { href: u, download: nom }).click();
  setTimeout(() => URL.revokeObjectURL(u), 10000);
}
const listePieces = (pieces) => (pieces.length ? h("div", { class: "actions" }, pieces.map((p) => h("button", { class: "discret", onclick: () => telechargerPiece(p.id, p.nom) }, `📎 ${p.nom}`))) : null);
function joindre(objet, id, relire) {
  return h("details", {}, h("summary", {}, "Joindre une pièce (photo, PDF)"), h("form", { onsubmit: envoiCatch(async (f) => {
    const fichier = f.fichier.files[0];
    if (!fichier) return;
    await envoyerFichier(`/performance/pieces?objet=${objet}&id=${id}&nom=${encodeURIComponent(fichier.name)}`, fichier);
    relire("Pièce jointe ajoutée.");
  }) }, h("input", { type: "file", name: "fichier", required: true, accept: ".pdf,.png,.jpg,.jpeg", "aria-label": "Fichier" }), h("div", { class: "message-envoi" }), h("button", { type: "submit" }, "Envoyer")));
}

/** Score détaillé : chaque ligne, sa cible, son réalisé et sa part ; rien n'est caché au collaborateur. */
function detailScore(s) {
  return h("div", { class: "defilant" }, h("table", {},
    h("thead", {}, h("tr", {}, ["Objectif", "Cible", "Réalisé", "Poids", "Score"].map((t) => h("th", { scope: "col" }, t)))),
    h("tbody", {}, s.detail.map((l) => h("tr", {}, h("td", {}, l.libelle, l.en_attente ? h("span", { class: "discret-texte" }, " · en attente de validation") : null),
      h("td", { class: "nombre" }, String(l.cible)), h("td", { class: "nombre" }, l.realise === null ? "–" : String(l.realise)),
      h("td", { class: "nombre" }, String(l.poids)), h("td", { class: "nombre" }, String(l.score)))))));
}
function carteForce(f) {
  return h("div", { class: "carte" }, h("h2", {}, "Force de proposition du mois"),
    f.evalue ? h("p", { class: "grand" }, `${f.score}/100`) : h("p", {}, h("b", {}, "Non évalué ce mois"), h("span", { class: "discret-texte" }, ` : il faut au moins 3 problèmes ou solutions (vous en avez ${f.problemes + f.solutions}).`)),
    h("div", { class: "defilant" }, h("table", {}, h("tbody", {}, f.parts.map((p) => h("tr", {}, h("td", {}, `${p.libelle} (${p.poids} %)`), h("td", { class: "nombre" }, p.valeur === null ? "non comptée" : `${p.valeur}/100`), h("td", { class: "discret-texte" }, p.detail)))))),
    h("p", { class: "discret-texte" }, "Les cas sensibles n'entrent jamais dans ce calcul. Une solution refusée ne compte que par sa note de qualité. Signaler un problème ne baisse jamais aucun score."));
}

async function ecranMaJournee(message, jour = aujourdhui()) {
  const [j, f, rattachables] = await Promise.all([api("GET", `/moi/journee?jour=${jour}`), api("GET", `/moi/force-proposition?mois=${jour.slice(0, 7)}`), api("GET", "/moi/resultats-cles").catch(() => [])]);
  const relire = (m) => ecranMaJournee(m, jour);
  const r = j.rapport;
  const remis = r?.statut === "remis";
  const c = r?.contenu || {};
  const m = j.mesures || { conversions: {}, taches_terminees: [], taches_en_retard: [] };
  const declares = j.objectifs.filter((o) => o.type !== "mesure_systeme");
  const champsSaisie = (pref) => [
    declares.length ? h("fieldset", {}, h("legend", {}, "Mes réalisés"), declares.map((o) => o.type === "tache"
      ? choix(`r${o.id}`, o.libelle, [["", "Pas encore"], ["1", "Fait"], ["0", "Pas fait"]], o.realise_declare === null ? "" : String(o.realise_declare))
      : champ(`${o.libelle} (cible ${o.cible})`, { name: `r${o.id}`, type: "number", min: 0, step: "any", value: o.realise_declare ?? "" }))) : null,
    h("fieldset", {}, h("legend", {}, "Tâches"),
      h("p", { class: "discret-texte" }, `Terminées aujourd'hui : ${m.taches_terminees.map((t) => t.titre).join(", ") || "aucune"}. En retard : ${m.taches_en_retard.map((t) => t.titre).join(", ") || "aucune"}.`),
      h("label", {}, "Tâches reportées et pourquoi", h("textarea", { name: "reportees", rows: 2 }, pref.taches?.reportees || ""))),
    h("fieldset", {}, h("legend", {}, "Conversions"),
      h("div", { class: "grille" },
        champ(`Contacts (mesurés : ${m.conversions.contacts ?? 0})`, { name: "contacts", type: "number", min: 0, value: pref.conversions?.contacts ?? m.conversions.contacts ?? "" }),
        champ(`Prospects intéressés (mesurés : ${m.conversions.interesses ?? 0})`, { name: "interesses", type: "number", min: 0, value: pref.conversions?.interesses ?? m.conversions.interesses ?? "" }),
        champ(`Ventes ou inscriptions (mesurées : ${m.conversions.conclus ?? 0})`, { name: "conclus", type: "number", min: 0, value: pref.conversions?.conclus ?? m.conversions.conclus ?? "" })),
      h("p", { class: "discret-texte" }, "Le taux de conversion se calcule seul : ventes ou inscriptions divisées par les contacts.")),
    h("fieldset", {}, h("legend", {}, "Suivi"),
      champ(`Relances faites (mesurées : ${m.relances ?? 0})`, { name: "relances", type: "number", min: 0, value: pref.suivi?.relances ?? m.relances ?? "" }),
      h("label", {}, "Prochaines actions", h("textarea", { name: "prochaines", rows: 2 }, pref.suivi?.prochaines_actions || "")),
      h("label", {}, "Plan de demain", h("textarea", { name: "plan", rows: 2 }, pref.suivi?.plan_lendemain || ""))),
    h("label", {}, "Commentaire", h("textarea", { name: "commentaire", rows: 2 }, pref.commentaire || "")),
  ];
  const lireSaisie = (v) => ({
    jour,
    realises: declares.filter((o) => v[`r${o.id}`] !== "" && v[`r${o.id}`] !== undefined).map((o) => ({ objectifId: o.id, valeur: Number(v[`r${o.id}`]) })),
    taches: { reportees: v.reportees.trim() },
    conversions: { contacts: nombreOuVide(v.contacts), interesses: nombreOuVide(v.interesses), conclus: nombreOuVide(v.conclus) },
    suivi: { relances: nombreOuVide(v.relances), prochaines_actions: v.prochaines.trim(), plan_lendemain: v.plan.trim() },
    commentaire: v.commentaire.trim(),
  });
  vue(
    h("div", { class: "actions" }, h("button", { class: "discret", onclick: () => ecranMonEspace() }, "← Mon espace"), h("button", { class: "discret", onclick: () => ecranProblemes() }, "Mes problèmes"), h("button", { class: "discret", onclick: () => ecranMessages() }, "Mes messages")),
    h("h1", {}, "Ma journée"),
    h("div", { class: "ligne" }, h("span", {}, `${dateFr(jour)} · ${j.employe.poste}`), h("input", { type: "date", value: jour, max: aujourdhui(), "aria-label": "Changer de jour", onchange: (e) => e.target.value && ecranMaJournee(null, e.target.value) })),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    j.urgence ? h("div", { class: "bandeau-urgent", role: "alert" }, "Vous avez signalé un problème urgent aujourd'hui.") : null,
    j.conge ? h("div", { class: "carte" }, h("p", {}, "Jour de congé : pas d'objectifs, pas de rapport, pas de score.")) : null,
    !j.conge ? h("div", { class: "carte" }, h("h2", {}, "Mes objectifs"),
      j.objectifs.length ? j.objectifs.map((o) => h("div", { class: "apprenant" },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, o.libelle), h("span", { class: o.valide ? "pastille ok" : "pastille" },
          o.type === "mesure_systeme" ? `${o.mesure ?? 0} / ${o.cible}` : o.realise_declare === null ? `cible ${o.cible}` : `${o.realise_declare} / ${o.cible}${o.valide ? " · validé" : " · à valider"}`)),
        h("div", { class: "discret-texte" }, `${TYPES_OBJECTIF[o.type]}${o.origine === "personnel" ? " · personnel" : ""}${o.motif_ajustement ? ` · cible ajustée (avant : ${o.cible_initiale}) : ${o.motif_ajustement}` : ""}`),
        lienResultatCle(o, rattachables, remis, relire),
        o.origine === "personnel" && !remis && jour === aujourdhui() ? h("button", { class: "discret", onclick: async () => { await api("DELETE", `/moi/objectifs/${o.id}`); relire("Objectif retiré."); } }, "Retirer") : null))
        : h("p", { class: "discret-texte" }, j.ouvre ? "Aucun objectif pour ce jour." : "Pas d'objectifs le week-end."),
      !remis && jour === aujourdhui() && j.objectifs.filter((o) => o.origine === "personnel").length < j.max_personnels ? h("details", {}, h("summary", {}, "Ajouter un objectif personnel (3 au plus)"), formulaire(async (v) => {
        await api("POST", "/moi/objectifs", { libelle: v.l.trim(), type: v.t, cible: v.t === "tache" ? undefined : Number(v.c || 1) });
        relire("Objectif ajouté.");
      }, [h("div", { class: "grille" }, champ("Objectif", { name: "l", required: true }), choix("t", "Type", [["chiffre_declare", "Un chiffre à atteindre"], ["tache", "Une tâche à faire"]]), champ("Cible (pour un chiffre)", { name: "c", type: "number", min: 0, step: "any" }))], "Ajouter")) : null) : null,

    !j.conge ? h("div", { class: "carte" }, h("h2", {}, remis ? `Rapport du jour remis${r.version > 1 ? ` (version ${r.version})` : ""}` : "Rapport du jour"),
      remis ? h("div", {},
        h("p", {}, `Remis le ${heure(r.remis_le)}.`),
        h("p", { class: "discret-texte" }, `Conversions : ${c.conversions?.contacts ?? 0} contact(s), ${c.conversions?.interesses ?? 0} intéressé(s), ${c.conversions?.conclus ?? 0} vente(s) ou inscription(s)${c.conversions?.taux !== null && c.conversions?.taux !== undefined ? `, taux ${c.conversions.taux} %` : ""}.`),
        c.suivi?.plan_lendemain ? h("p", { class: "discret-texte" }, `Plan de demain : ${c.suivi.plan_lendemain}`) : null,
        listePieces(j.pieces),
        h("details", {}, h("summary", {}, "Corriger : nouvelle version avec un motif"), formulaire(async (v) => {
          await api("POST", "/moi/rapport/version", { ...lireSaisie(v), motif: v.motif.trim() });
          relire("Nouvelle version remise. L'ancienne reste visible.");
        }, [champ("Motif de la correction (obligatoire)", { name: "motif", required: true, minlength: 3 }), ...champsSaisie(c)], "Remettre la nouvelle version")))
        : h("div", {},
          h("p", { class: "discret-texte" }, "Les valeurs mesurées par le système sont déjà indiquées. Une fois remis, le rapport ne se modifie plus."),
          formulaire(async (v, form) => {
            await api("PUT", "/moi/rapport", lireSaisie(v));
            if (form.dataset.remettre === "1") { const x = await api("POST", "/moi/rapport/remise", { jour }); return relire(`Rapport remis. Score du jour : ${x.score ?? "–"}/100.`); }
            relire("Brouillon enregistré.");
          }, [...champsSaisie(c), h("button", { type: "submit", class: "discret", onclick: (e) => { e.target.form.dataset.remettre = "1"; } }, "Remettre le rapport")], "Enregistrer le brouillon"),
          r ? joindre("rapport", r.id, relire) : h("p", { class: "discret-texte" }, "Enregistrez un brouillon pour joindre des pièces."),
          listePieces(j.pieces))) : null,

    h("div", { class: "carte" }, h("h2", {}, "Problèmes du jour"),
      j.problemes.length ? j.problemes.map((p) => h("button", { class: "session", onclick: () => ecranProbleme(p.id) },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, LIB_CATEGORIE[p.categorie]), h("span", {}, pastillePrio(p.priorite), " ", h("span", { class: "pastille" }, STATUTS_PB[p.statut]))),
        h("div", { class: "discret-texte" }, p.description.slice(0, 120)))) : h("p", { class: "discret-texte" }, "Aucun problème signalé ce jour."),
      h("button", { onclick: () => ecranSignaler() }, "Signaler un problème")),

    j.score ? h("div", { class: "carte" }, h("h2", {}, "Score du jour"),
      h("div", { class: "ligne" }, h("span", { class: "grand" }, `${j.score.score}/100`), h("span", { class: "pastille" }, { calcule: "Calculé", valide: "Validé", corrige: "Corrigé", conteste: "Contesté" }[j.score.statut])),
      j.score.score !== j.score.score_calcule ? h("p", { class: "discret-texte" }, `Calculé : ${j.score.score_calcule}/100. Correction : ${j.score.motif_correction}`) : null,
      j.score.commentaire_responsable ? h("p", {}, `Responsable : ${j.score.commentaire_responsable}`) : null,
      detailScore(j.score),
      h("p", { class: "discret-texte" }, "Chaque objectif compte au plus 100. Un chiffre déclaré compte une fois validé par votre responsable. Le score aide à décider : il ne décide pas."),
      j.score.statut !== "conteste" ? h("details", {}, h("summary", {}, "Contester ce score"), formulaire(async (v) => {
        await api("POST", `/moi/scores-jour/${j.score.id}/contestation`, { commentaire: v.c.trim() }); relire("Contestation envoyée à votre responsable.");
      }, [h("label", {}, "Expliquez", h("textarea", { name: "c", required: true, minlength: 5, rows: 3 }))], "Envoyer")) : h("p", {}, `Votre contestation : ${j.score.contestation}`)) : null,

    j.semaine.length ? h("div", { class: "carte" }, h("h2", {}, "Ma semaine"), h("ol", { class: "barres-tdb" }, j.semaine.map((s) => h("li", {},
      h("div", { class: "ligne" }, h("span", {}, dateFr(s.jour)), h("b", {}, `${s.score}/100`)), h("div", { class: "piste" }, h("div", { class: "barre", style: `width: ${Math.max(2, s.score)}%` })))))) : null,
    carteForce(f),
  );
}

function champsSolution() {
  return [h("label", {}, "Solution proposée", h("textarea", { name: "sd", rows: 2 })), h("div", { class: "grille" },
    champ("Moyens nécessaires", { name: "sm" }), champ("Coût estimé (FCFA), facultatif", { name: "sc", type: "number", min: 0 }),
    champ("Délai", { name: "sl" }), champ("Résultat attendu", { name: "sr" })),
  h("p", { class: "discret-texte" }, "Une solution chiffrée n'engage aucune dépense : un achat ou un paiement passe toujours par les circuits habituels.")];
}
const lireSolution = (v) => ({ description: v.sd.trim(), moyens: v.sm.trim() || undefined, coutEstime: nombreOuVide(v.sc), delai: v.sl.trim() || undefined, resultatAttendu: v.sr.trim() || undefined });

function ecranSignaler() {
  const motif = h("div", { hidden: true }, champ("Pourquoi est-ce urgent ? (obligatoire)", { name: "mu" }));
  const avis = h("p", { class: "alerte-caisse", hidden: true }, "Cas sensible : seuls les ressources humaines et la direction de la branche le verront, jamais votre responsable.");
  vue(h("button", { class: "discret", onclick: () => ecranMaJournee() }, "← Ma journée"), h("h1", {}, "Signaler un problème"),
    h("div", { class: "carte" }, formulaire(async (v) => {
      const sol = v.sd.trim() ? [lireSolution(v)] : [];
      const r = await api("POST", "/problemes", { categorie: v.cat, description: v.d.trim(), impact: v.i.trim() || undefined, aideAttendue: v.a.trim() || undefined, destinataire: v.dest, priorite: v.p, motifUrgence: v.mu?.trim() || undefined, solutions: sol });
      ecranProbleme(r.id, "Problème signalé. Signaler un problème ne baisse jamais votre score.");
    }, [
      h("label", {}, "Catégorie", h("select", { name: "cat", onchange: (e) => { avis.hidden = !SENSIBLES_PB.includes(e.target.value); } }, CATEGORIES_PB.map(([c, l]) => h("option", { value: c }, l)))),
      avis,
      h("label", {}, "Que se passe-t-il ?", h("textarea", { name: "d", rows: 3, required: true, minlength: 3 })),
      h("label", {}, "Impact sur le travail", h("textarea", { name: "i", rows: 2 })),
      h("label", {}, "Aide attendue", h("textarea", { name: "a", rows: 2 })),
      choix("dest", "À qui l'adresser", DESTINATAIRES_PB),
      h("fieldset", { class: "priorites" }, h("legend", {}, "Priorité"), ["normal", "important", "urgent"].map((p) => h("label", { class: `choix-prio prio-${p}` },
        h("input", { type: "radio", name: "p", value: p, checked: p === "normal", onchange: () => { motif.hidden = p !== "urgent"; } }), ` ${PRIORITES_PB[p]}`))),
      motif,
      h("details", {}, h("summary", {}, "Proposer tout de suite une solution (facultatif)"), ...champsSolution()),
    ], "Signaler")));
}

async function ecranProblemes() {
  const p = await api("GET", "/moi/problemes");
  const ligne = (x) => h("button", { class: "session", onclick: () => ecranProbleme(x.id) },
    h("div", { class: "ligne" }, h("span", { class: "nom" }, `${LIB_CATEGORIE[x.categorie]}${x.employe ? ` · ${x.employe}` : ""}`), h("span", {}, pastillePrio(x.priorite), " ", h("span", { class: "pastille" }, STATUTS_PB[x.statut]))),
    h("div", { class: "discret-texte" }, x.description.slice(0, 140)));
  vue(h("button", { class: "discret", onclick: () => ecranMaJournee() }, "← Ma journée"), h("h1", {}, "Problèmes"),
    h("div", { class: "actions" }, h("button", { onclick: () => ecranSignaler() }, "Signaler un problème")),
    h("div", { class: "carte" }, h("h2", {}, "Mes problèmes"), p.mes.length ? p.mes.map(ligne) : h("p", { class: "discret-texte" }, "Aucun.")),
    h("div", { class: "carte" }, h("h2", {}, "Problèmes des collègues"), h("p", { class: "discret-texte" }, "Vous pouvez proposer une solution. Les cas sensibles n'apparaissent jamais ici."),
      p.collegues.length ? p.collegues.map(ligne) : h("p", { class: "discret-texte" }, "Aucun.")));
}

async function ecranProbleme(id, message) {
  const p = await api("GET", `/problemes/${id}`);
  const relire = (m) => ecranProbleme(id, m);
  const gestion = p.role === "gestion", auteur = p.role === "auteur";
  const ouvert = !["resolu", "clos"].includes(p.statut);
  const pieces = (type, oid) => listePieces(p.pieces.filter((x) => x.objet_type === type && x.objet_id === oid));
  vue(h("button", { class: "discret", onclick: () => (gestion ? ecranMonEquipe() : ecranProblemes()) }, gestion ? "← Mon équipe" : "← Problèmes"),
    h("h1", {}, LIB_CATEGORIE[p.categorie]),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    p.priorite === "urgent" && ouvert ? h("div", { class: "bandeau-urgent", role: "alert" }, `Urgent${p.hors_delai ? " · délai de prise en charge dépassé" : ""}`) : null,
    h("div", { class: "carte" },
      h("div", { class: "ligne" }, h("span", {}, `${p.employe} · ${heure(p.cree_le)}`), h("span", {}, pastillePrio(p.priorite), " ", h("span", { class: "pastille" }, STATUTS_PB[p.statut]))),
      p.sensible ? h("p", { class: "alerte-caisse" }, "Cas sensible : visible seulement des ressources humaines et de la direction de la branche.") : null,
      h("p", {}, p.description), p.impact ? h("p", {}, `Impact : ${p.impact}`) : null, p.aide_attendue ? h("p", {}, `Aide attendue : ${p.aide_attendue}`) : null,
      p.motif_urgence ? h("p", {}, `Pourquoi urgent : ${p.motif_urgence}`) : null,
      h("p", { class: "discret-texte" }, p.pris_en_charge_par ? `Pris en charge par ${p.pris_en_charge_par} le ${heure(p.pris_en_charge_le)}.` : `Prise en charge attendue avant le ${heure(p.echeance)}${p.niveau_escalade ? ` · remonté ${p.niveau_escalade} fois` : ""}.`),
      pieces("probleme", p.id), auteur ? joindre("probleme", p.id, relire) : null,
      gestion && p.statut === "signale" ? h("button", { onclick: async () => { await api("POST", `/problemes/${id}/prise-en-charge`); relire("Vous prenez en charge ce problème."); } }, "Je prends en charge") : null,
      gestion && ouvert ? h("div", { class: "actions" },
        p.statut !== "en_cours" ? h("button", { class: "discret", onclick: async () => { await api("POST", `/problemes/${id}/statut`, { statut: "en_cours" }); relire("Problème en cours de traitement."); } }, "Passer en cours") : null,
        h("button", { class: "discret", onclick: async () => { await api("POST", `/problemes/${id}/statut`, { statut: "resolu" }); relire("Marqué résolu : le collaborateur doit confirmer."); } }, "Marquer résolu")) : null,
      gestion && ouvert ? h("details", {}, h("summary", {}, "Changer la priorité"), formulaire(async (v) => {
        await api("POST", `/problemes/${id}/priorite`, { priorite: v.p, motif: v.m.trim() }); relire("Priorité changée.");
      }, [choix("p", "Priorité", Object.entries(PRIORITES_PB), p.priorite), champ("Motif (obligatoire)", { name: "m", required: true, minlength: 3 })], "Changer")) : null,
      auteur && p.statut === "resolu" ? h("div", { class: "actions" },
        h("button", { onclick: async () => { await api("POST", `/problemes/${id}/confirmation`, { resolu: true }); relire("Merci : problème clos."); } }, "C'est réglé"),
        h("button", { class: "danger", onclick: async () => { await api("POST", `/problemes/${id}/confirmation`, { resolu: false }); relire("Problème rouvert."); } }, "Ce n'est pas réglé")) : null),

    h("div", { class: "carte" }, h("h2", {}, "Solutions"),
      p.solutions.length ? p.solutions.map((s) => h("div", { class: "apprenant" },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, s.auteur), h("span", { class: s.decision.startsWith("acceptee") ? "pastille ok" : s.decision === "refusee" ? "pastille retard" : "pastille attente" }, DECISIONS_SOL[s.decision])),
        h("p", {}, s.description),
        h("div", { class: "discret-texte" }, [s.moyens && `Moyens : ${s.moyens}`, s.cout_estime !== null && `Coût estimé : ${fcfa(s.cout_estime)}`, s.delai && `Délai : ${s.delai}`, s.resultat_attendu && `Résultat attendu : ${s.resultat_attendu}`].filter(Boolean).join(" · ")),
        s.note ? h("div", { class: "discret-texte" }, `Note de qualité : ${s.note}/5${s.motif ? ` · ${s.motif}` : ""}${s.modifications ? ` · Modifications : ${s.modifications}` : ""}${s.date_reexamen ? ` · Réexamen le ${dateFr(s.date_reexamen)}` : ""}`) : null,
        pieces("solution", s.id),
        s.action_id ? h("div", { class: "discret-texte" }, `Action : ${STATUTS_ACTION[s.action_statut]}, par ${s.action_responsable}, échéance ${dateFr(s.action_echeance)}${s.efficace === null ? "" : s.efficace ? " · problème réglé" : " · problème non réglé"}`) : null,
        s.action_id && gestion && s.efficace === null ? h("details", {}, h("summary", {}, "Suivre l'action"), formulaire(async (v) => {
          await api("PATCH", `/actions-solution/${s.action_id}`, { statut: v.st, ...(v.st === "realisee" && v.ef ? { efficace: v.ef === "oui" } : {}) }); relire("Action mise à jour.");
        }, [choix("st", "Statut", Object.entries(STATUTS_ACTION), s.action_statut), choix("ef", "Une fois réalisée, le problème est-il réglé ?", [["", "Pas encore jugé"], ["oui", "Oui"], ["non", "Non"]])], "Enregistrer")) : null,
        gestion && ["en_attente", "a_etudier"].includes(s.decision) ? h("details", {}, h("summary", {}, "Décider"), formulaire(async (v) => {
          const r = await api("POST", `/solutions/${s.id}/decision`, { decision: v.d, note: Number(v.n), motif: v.m.trim() || undefined, modifications: v.mo.trim() || undefined, dateReexamen: v.dr || undefined, echeance: v.e || undefined });
          relire(r.action ? "Solution acceptée : action de mise en œuvre créée. Aucune dépense n'est engagée." : "Décision enregistrée.");
        }, [h("div", { class: "grille" },
          choix("d", "Décision", [["acceptee", "Acceptée"], ["acceptee_modifiee", "Acceptée avec modifications"], ["a_etudier", "À étudier"], ["refusee", "Refusée"]]),
          choix("n", "Note de qualité (obligatoire, même si refusée)", [["5", "5 · excellente"], ["4", "4"], ["3", "3"], ["2", "2"], ["1", "1 · faible"]], "3"),
          champ("Motif (obligatoire si refusée)", { name: "m" }), champ("Modifications demandées", { name: "mo" }),
          champ("Date de réexamen (si à étudier)", { name: "dr", type: "date" }), champ("Échéance de l'action (si acceptée)", { name: "e", type: "date" }))], "Enregistrer la décision")) : null))
        : h("p", { class: "discret-texte" }, "Aucune solution proposée."),
      p.statut !== "clos" && (auteur || !p.sensible) ? h("details", {}, h("summary", {}, "Proposer une solution"), formulaire(async (v) => {
        await api("POST", `/problemes/${id}/solutions`, lireSolution(v)); relire("Solution proposée.");
      }, champsSolution(), "Proposer")) : null),

    p.role !== "collegue" ? h("div", { class: "carte" }, h("h2", {}, "Échanges"),
      p.commentaires.map((x) => h("div", { class: "apprenant" }, h("div", { class: "discret-texte" }, `${x.auteur} · ${heure(x.cree_le)}`), h("p", {}, x.texte), pieces("commentaire", x.id))),
      formulaire(async (v) => { await api("POST", `/problemes/${id}/commentaires`, { texte: v.t.trim() }); relire("Message ajouté."); }, [h("label", {}, "Message", h("textarea", { name: "t", rows: 2, required: true }))], "Envoyer"),
      p.historique.length ? h("details", {}, h("summary", {}, "Historique"), p.historique.map((x) => h("div", { class: "discret-texte" }, `${heure(x.cree_le)} · ${x.action.replace("_", " ")}${x.auteur ? ` · ${x.auteur}` : ""}${x.details?.motif ? ` · ${x.details.motif}` : ""}`))) : null) : null,
  );
}

async function ecranMonEquipe(message, jour = aujourdhui()) {
  const e = await api("GET", `/equipe/journee?jour=${jour}`);
  const relire = (m) => ecranMonEquipe(m, jour);
  const etatRapport = (m) => (m.conge ? h("span", { class: "pastille" }, "Congé") : m.rapport === "remis" ? h("span", { class: "pastille ok" }, "Rapport remis")
    : m.rapport === "brouillon" ? h("span", { class: "pastille attente" }, "En cours") : m.objectifs ? h("span", { class: "pastille retard" }, "Rapport manquant") : h("span", { class: "pastille" }, "Sans objectifs"));
  vue(h("div", { class: "actions" }, h("button", { class: "discret", onclick: () => ecranPerformance() }, "← Performance"), h("button", { class: "discret", onclick: () => ecranDirectionPerf() }, "Vue direction"), h("button", { class: "discret", onclick: () => ecranReglagesQuotidien() }, "Réglages")),
    h("h1", {}, "Mon équipe"),
    e.urgences ? h("div", { class: "bandeau-urgent", role: "alert" }, `${e.urgences} urgence${e.urgences > 1 ? "s" : ""} ouverte${e.urgences > 1 ? "s" : ""}`) : null,
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "ligne" }, h("span", {}, `${dateFr(jour)} · ${e.rapports.rendus} rapport(s) rendu(s) sur ${e.rapports.attendus}`), h("input", { type: "date", value: jour, max: aujourdhui(), "aria-label": "Changer de jour", onchange: (x) => x.target.value && ecranMonEquipe(null, x.target.value) })),
    h("div", { class: "carte" }, h("h2", {}, "Collaborateurs"), e.membres.length ? e.membres.map((m) => h("div", { class: "apprenant" },
      h("button", { class: "session", onclick: () => ecranJourneeCollaborateur(m.id, jour) },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, m.nom, m.urgence ? h("span", { class: "point-urgent", title: "Problème urgent ce jour", "aria-label": "Problème urgent ce jour" }) : null),
          h("span", {}, etatRapport(m), " ", m.score ? h("b", {}, `${m.score.score}/100`) : null)),
        h("div", { class: "discret-texte" }, `${m.poste} · ${m.entite}${m.score?.statut === "conteste" ? " · score contesté" : ""}`)),
      m.a_valider.length ? h("div", { class: "actions" }, m.a_valider.map((o) => h("button", { class: "discret", onclick: async () => { await api("POST", `/objectifs-jour/${o.id}/validation`, {}); relire(`${m.nom} : « ${o.libelle} » validé.`); } },
        `Valider « ${o.libelle} » : ${o.declare} / ${o.cible}`))) : null))
      : h("p", { class: "discret-texte" }, "Aucun collaborateur relié à un compte dans vos entités.")),
    h("div", { class: "carte" }, h("h2", {}, "Problèmes à traiter"), e.problemes.length ? e.problemes.map((p) => h("button", { class: `session bord-${p.priorite}`, onclick: () => ecranProbleme(p.id) },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${LIB_CATEGORIE[p.categorie]} · ${p.employe}`), h("span", {}, pastillePrio(p.priorite), " ", h("span", { class: "pastille" }, STATUTS_PB[p.statut]))),
      h("div", { class: "discret-texte" }, `${p.description.slice(0, 120)}${p.hors_delai ? " · délai dépassé" : ""}`))) : h("p", { class: "discret-texte" }, "Rien à traiter.")),
    h("div", { class: "carte" }, h("h2", {}, "Solutions à décider"), e.solutions.length ? e.solutions.map((s) => h("button", { class: "session", onclick: () => ecranProbleme(s.probleme_id) },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${s.auteur} · ${LIB_CATEGORIE[s.categorie]}`), h("span", { class: "pastille attente" }, DECISIONS_SOL[s.decision])),
      h("div", { class: "discret-texte" }, `${s.description.slice(0, 120)}${s.date_reexamen ? ` · réexamen le ${dateFr(s.date_reexamen)}` : ""}`))) : h("p", { class: "discret-texte" }, "Aucune solution en attente.")),
    h("p", { class: "alerte-caisse" }, "Les scores aident à décider : aucune sanction n'est automatique. Tenez compte du contexte, et rien ne surveille l'écran ni la localisation des collaborateurs."));
}

async function ecranJourneeCollaborateur(id, jour, message) {
  const [j, f] = await Promise.all([api("GET", `/equipe/employes/${id}/journee?jour=${jour}`), api("GET", `/equipe/employes/${id}/force-proposition?mois=${jour.slice(0, 7)}`)]);
  const relire = (m) => ecranJourneeCollaborateur(id, jour, m);
  const ajustable = jour === aujourdhui() && new Date(Date.now() + 3600000).getUTCHours() < 12;
  vue(h("button", { class: "discret", onclick: () => ecranMonEquipe(null, jour) }, "← Mon équipe"), h("h1", {}, j.employe.nom), h("p", { class: "discret-texte" }, `${j.employe.poste} · ${dateFr(jour)}`),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    j.conge ? h("div", { class: "carte" }, h("p", {}, "Jour de congé : pas de score.")) : null,
    h("div", { class: "carte" }, h("h2", {}, "Objectifs"), j.objectifs.map((o) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, o.libelle), h("span", {}, o.type === "mesure_systeme" ? `${o.mesure ?? 0} / ${o.cible}` : `${o.realise_declare ?? "–"} / ${o.cible}${o.valide ? " · validé" : ""}`)),
      o.motif_ajustement ? h("div", { class: "discret-texte" }, `Cible ajustée (avant : ${o.cible_initiale}) : ${o.motif_ajustement}`) : null,
      ajustable && o.type !== "tache" ? h("details", {}, h("summary", {}, "Ajuster la cible (avant midi)"), formulaire(async (v) => {
        await api("PATCH", `/objectifs-jour/${o.id}`, { cible: Number(v.c), motif: v.m.trim() }); relire("Cible ajustée.");
      }, [h("div", { class: "grille" }, champ("Nouvelle cible", { name: "c", type: "number", min: 0, step: "any", required: true, value: o.cible }), champ("Motif (obligatoire)", { name: "m", required: true, minlength: 3 }))], "Ajuster")) : null,
      o.type !== "mesure_systeme" && !o.valide && o.realise_declare !== null ? h("details", {}, h("summary", {}, "Valider ou corriger le réalisé"), formulaire(async (v) => {
        const corps = v.v !== "" && Number(v.v) !== o.realise_declare ? { valeur: Number(v.v), motif: v.m.trim() } : {};
        await api("POST", `/objectifs-jour/${o.id}/validation`, corps); relire("Réalisé validé.");
      }, [h("div", { class: "grille" }, champ("Réalisé retenu", { name: "v", type: "number", min: 0, step: "any", value: o.realise_declare }), champ("Motif si vous corrigez", { name: "m" }))], "Valider")) : null))),
    j.versions.length ? h("div", { class: "carte" }, h("h2", {}, "Rapport"), j.versions.map((r) => h("details", { class: "apprenant", open: r === j.versions.at(-1) }, h("summary", {}, `Version ${r.version}${r.remis_le ? ` · remis le ${heure(r.remis_le)}` : " · brouillon"}${r.motif_version ? ` · ${r.motif_version}` : ""}`),
      h("p", { class: "discret-texte" }, `Conversions : ${r.contenu.conversions?.contacts ?? 0} contact(s), ${r.contenu.conversions?.interesses ?? 0} intéressé(s), ${r.contenu.conversions?.conclus ?? 0} conclu(s)${r.contenu.conversions?.taux != null ? `, taux ${r.contenu.conversions.taux} %` : ""}`),
      r.contenu.taches?.reportees ? h("p", {}, `Reporté : ${r.contenu.taches.reportees}`) : null,
      r.contenu.suivi?.prochaines_actions ? h("p", {}, `Prochaines actions : ${r.contenu.suivi.prochaines_actions}`) : null,
      r.contenu.suivi?.plan_lendemain ? h("p", {}, `Plan de demain : ${r.contenu.suivi.plan_lendemain}`) : null,
      r.contenu.commentaire ? h("p", {}, r.contenu.commentaire) : null,
      (r.contenu.problemes || []).some((p) => p.priorite === "urgent") ? h("p", {}, h("span", { class: "pastille prio-urgent" }, "Problème urgent signalé ce jour")) : null))) : h("div", { class: "carte" }, h("p", {}, "Pas de rapport pour ce jour.")),
    j.problemes.length ? h("div", { class: "carte" }, h("h2", {}, "Problèmes du jour"), j.problemes.map((p) => h("button", { class: "session", onclick: () => ecranProbleme(p.id) }, pastillePrio(p.priorite), ` ${LIB_CATEGORIE[p.categorie]} · ${STATUTS_PB[p.statut]}`))) : null,
    j.score ? h("div", { class: "carte" }, h("h2", {}, `Score : ${j.score.score}/100`), detailScore(j.score),
      j.score.contestation ? h("p", {}, `Contestation : ${j.score.contestation}`) : null,
      formulaire(async (v) => {
        await api("POST", `/scores-jour/${j.score.id}/decision`, { action: v.a, score: v.a === "corriger" ? Number(v.s) : undefined, commentaire: v.c.trim() || undefined, motif: v.m.trim() || undefined });
        relire("Score mis à jour.");
      }, [h("div", { class: "grille" }, choix("a", "Action", [["valider", "Valider"], ["commenter", "Commenter"], ["corriger", "Corriger"]]), champ("Score corrigé", { name: "s", type: "number", min: 0, max: 100, value: j.score.score }),
        champ("Commentaire", { name: "c" }), champ("Motif (obligatoire pour corriger)", { name: "m" }))], "Enregistrer")) : null,
    carteForce(f));
}

async function brancheCourante() {
  const e = await api("GET", "/entites");
  return e.find((x) => x.code === (dansEspace("formation") ? "GTA" : "GLOMARI")) || e.find((x) => x.type === "branche");
}

async function ecranDirectionPerf(choixDates) {
  const b = await brancheCourante();
  const du = choixDates?.du || `${aujourdhui().slice(0, 8)}01`, au = choixDates?.au || aujourdhui();
  const d = await api("GET", `/performance/direction/${b.id}?du=${du}&au=${au}`);
  const nb = (v, suf = "") => (v === null || v === undefined ? "–" : `${String(v).replace(".", ",")}${suf}`);
  vue(h("button", { class: "discret", onclick: () => ecranPerformance() }, "← Performance"), h("h1", {}, `Performance au quotidien · ${b.nom}`),
    h("div", { class: "carte" }, formulaire(async (v) => ecranDirectionPerf({ du: v.du, au: v.au }), [h("div", { class: "grille" }, champ("Du", { name: "du", type: "date", value: du }), champ("Au", { name: "au", type: "date", value: au }))], "Afficher")),
    h("div", { class: "chiffres" },
      h("div", { class: `chiffre ${d.delais.urgences_hors_delai ? "perte" : ""}` }, h("b", {}, nb(d.delais.urgences_hors_delai)), h("span", {}, "urgences hors délai")),
      h("div", { class: "chiffre" }, h("b", {}, nb(d.delais.urgences_ouvertes)), h("span", {}, "urgences ouvertes")),
      h("div", { class: "chiffre" }, h("b", {}, nb(d.delais.prise_en_charge_h, " h")), h("span", {}, "délai moyen de prise en charge")),
      h("div", { class: "chiffre" }, h("b", {}, nb(d.delais.resolution_h, " h")), h("span", {}, "délai moyen de résolution")),
      h("div", { class: "chiffre" }, h("b", {}, nb(d.solutions.proposees)), h("span", {}, "solutions proposées")),
      h("div", { class: "chiffre" }, h("b", {}, nb(d.solutions.taux_acceptation, " %")), h("span", {}, "taux d'acceptation")),
      h("div", { class: "chiffre" }, h("b", {}, nb(d.solutions.actions_realisees)), h("span", {}, "actions réalisées"))),
    h("div", { class: "grille-tdb" },
      h("div", { class: "carte" }, h("h2", {}, "Scores moyens"), d.scores.length ? h("ol", { class: "barres-tdb" }, d.scores.map((s) => h("li", {},
        h("div", { class: "ligne" }, h("span", {}, `${s.nom} · ${s.poste}`), h("b", {}, `${s.score}/100`)), h("div", { class: "piste" }, h("div", { class: "barre", style: `width: ${Math.max(2, s.score)}%` })),
        h("div", { class: "discret-texte" }, `${s.jours} jour(s) noté(s)`)))) : h("p", { class: "discret-texte" }, "Aucun score sur la période.")),
      h("div", { class: "carte" }, h("h2", {}, "Problèmes par catégorie"), d.categories.length ? h("ol", { class: "barres-tdb" }, d.categories.map((c) => h("li", {},
        h("div", { class: "ligne" }, h("span", {}, c.categorie === "sensible" ? "Cas sensibles (non détaillés)" : LIB_CATEGORIE[c.categorie]), h("b", {}, String(c.nombre))),
        h("div", { class: "piste" }, h("div", { class: "barre", style: `width: ${(c.nombre * 100) / Math.max(...d.categories.map((x) => x.nombre))}%` }))))) : h("p", { class: "discret-texte" }, "Aucun problème sur la période."))));
}

async function ecranReglagesQuotidien(message) {
  const [modeles, kpi, employes, entites] = await Promise.all([api("GET", "/performance/modeles"), api("GET", "/performance/kpi"), api("GET", "/employes"), entitesPour("rh_paie")]);
  const b = await brancheCourante();
  const delais = await api("GET", `/performance/delais/${b.id}`).catch(() => null);
  const relire = (m) => ecranReglagesQuotidien(m);
  const kpiJour = kpi.filter((k) => !k.mensuel);
  vue(h("button", { class: "discret", onclick: () => ecranMonEquipe() }, "← Mon équipe"), h("h1", {}, "Réglages de la performance au quotidien"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, h("h2", {}, "Objectifs du jour par poste"),
      modeles.length ? modeles.map((m) => h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", { class: "nom" }, `${m.poste} · ${m.libelle}`), h("span", { class: m.actif ? "pastille ok" : "pastille" }, m.actif ? "Actif" : "Arrêté")),
        h("div", { class: "discret-texte" }, `${m.entite} · ${TYPES_OBJECTIF[m.type]}${m.kpi ? ` (${kpi.find((k) => k.code === m.kpi)?.libelle ?? m.kpi})` : ""} · cible ${Number(m.cible)} · poids ${m.poids}`),
        h("button", { class: "discret", onclick: async () => { await api("PATCH", `/performance/modeles/${m.id}`, { actif: !m.actif }); relire(m.actif ? "Modèle arrêté." : "Modèle réactivé."); } }, m.actif ? "Arrêter" : "Réactiver")))
        : h("p", { class: "discret-texte" }, "Aucun modèle. Les objectifs se créent chaque matin, jours ouvrés, à partir de ces modèles."),
      h("details", {}, h("summary", {}, "Nouveau modèle"), formulaire(async (v) => {
        await api("POST", "/performance/modeles", { entiteId: v.e, poste: v.p.trim(), libelle: v.l.trim(), type: v.t, kpi: v.t === "mesure_systeme" ? v.k : undefined, cible: Number(v.c || 1), poids: Number(v.w) });
        relire("Modèle enregistré.");
      }, [h("div", { class: "grille" }, choix("e", "Entité", entites), champ("Poste, exactement comme sur la fiche", { name: "p", required: true }), champ("Libellé", { name: "l", required: true }),
        choix("t", "Type", Object.entries(TYPES_OBJECTIF)), choix("k", "Indicateur (mesure du système)", kpiJour.map((k) => [k.code, k.libelle])),
        champ("Cible", { name: "c", type: "number", min: 0, step: "any" }), champ("Poids (1 à 100)", { name: "w", type: "number", min: 1, max: 100, value: 20, required: true }))], "Enregistrer"))),
    h("div", { class: "carte" }, h("h2", {}, "Responsable direct"), h("p", { class: "discret-texte" }, "Il reçoit les alertes et les problèmes. Pour un cas sensible, il est toujours exclu."),
      formulaire(async (v) => { await api("PUT", `/employes/${v.e}/responsable`, { responsableId: v.r || null }); relire("Responsable enregistré."); },
        [h("div", { class: "grille" }, choix("e", "Collaborateur", employes.map((e) => [e.id, `${e.nom} · ${e.poste}`])), choix("r", "Responsable", [["", "Aucun"], ...employes.map((e) => [e.id, e.nom])]))], "Enregistrer")),
    delais ? h("div", { class: "carte" }, h("h2", {}, `Délais de prise en charge · ${b.nom}`), formulaire(async (v) => {
      await api("PUT", `/performance/delais/${b.id}`, { normal_h: Number(v.n), important_h: Number(v.i), urgent_h: Number(v.u) }); relire("Délais enregistrés.");
    }, [h("div", { class: "grille" }, champ("Normal (heures)", { name: "n", type: "number", min: 1, max: 720, value: delais.normal_h }), champ("Important (heures)", { name: "i", type: "number", min: 1, max: 720, value: delais.important_h }), champ("Urgent (heures)", { name: "u", type: "number", min: 1, max: 720, value: delais.urgent_h }))], "Enregistrer")) : null,
    h("div", { class: "carte" }, h("h2", {}, "Poids de la force de proposition par poste"), h("p", { class: "discret-texte" }, "Par défaut : réflexe solution 20, qualité 30, acceptation 20, efficacité 20, contribution 10. Le total doit faire 100."),
      formulaire(async (v) => {
        await api("PUT", "/performance/poids", { entiteId: v.e, poste: v.p.trim(), reflexe: Number(v.a), qualite: Number(v.b), acceptation: Number(v.c), efficacite: Number(v.d), contribution: Number(v.f) }); relire("Poids enregistrés.");
      }, [h("div", { class: "grille" }, choix("e", "Entité", entites), champ("Poste", { name: "p", required: true }), champ("Réflexe solution", { name: "a", type: "number", min: 0, max: 100, value: 20 }),
        champ("Qualité", { name: "b", type: "number", min: 0, max: 100, value: 30 }), champ("Acceptation", { name: "c", type: "number", min: 0, max: 100, value: 20 }),
        champ("Efficacité", { name: "d", type: "number", min: 0, max: 100, value: 20 }), champ("Contribution", { name: "f", type: "number", min: 0, max: 100, value: 10 }))], "Enregistrer")));
}

async function ecranMessages() {
  const m = await api("GET", "/moi/messages");
  await api("POST", "/moi/messages/lus").catch(() => {});
  vue(h("h1", {}, "Mes messages"), h("div", { class: "carte" }, m.length ? m.map((x) => h(["probleme", "okr"].includes(x.objet_type) ? "button" : "div", { class: `session${x.niveau === "urgent" ? " bord-urgent" : x.niveau === "important" ? " bord-important" : ""}`, onclick: x.objet_type === "probleme" ? () => ecranProbleme(x.objet_id) : x.objet_type === "okr" ? () => ecranObjectifOkr(x.objet_id) : undefined },
    h("div", { class: "ligne" }, h("span", { class: x.lu_le ? "" : "nom" }, x.texte), x.niveau !== "info" ? pastillePrio(x.niveau === "urgent" ? "urgent" : "important") : null),
    h("div", { class: "discret-texte" }, heure(x.cree_le)))) : h("p", { class: "discret-texte" }, "Aucun message.")));
}
