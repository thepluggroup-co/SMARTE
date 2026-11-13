"use strict";
async function blocSessions() {
  const s = await api("GET", "/caisse/sessions");
  return h("details", { class: "carte" }, h("summary", {}, "Suivi de toutes les caisses"), s.map((x) => h("div", { class: "apprenant" },
    h("div", { class: "ligne" }, h("span", { class: "nom" }, `${x.entite} : ${x.caissier}`), x.fermee_le ? (x.ecart ? h("span", { class: "pastille retard" }, `Écart ${fcfa(x.ecart)}`) : h("span", { class: "pastille ok" }, "Clôturée")) : h("span", { class: "pastille attente" }, "Ouverte")),
    h("div", { class: "discret-texte" }, `${heure(x.ouverte_le)} · Ventes ${fcfa(x.ventes)}${x.motif_ecart ? ` · ${x.motif_ecart}` : ""}`))));
}

async function ecranCours(message) {
  setTimeout(() => { const m = document.querySelector("main"); if (m && !m.querySelector(".lien-pedagogie")) m.prepend(h("div", { class: "actions lien-pedagogie" }, h("button", { class: "discret", onclick: () => ecranPedagogie() }, "Banque de questions, parcours et boutique"))); }, 0);
  const gere = droits.includes("apprentissage.gerer");
  const [cours, entites, studio] = await Promise.all([api("GET", "/cours"), gere ? entitesPour("apprentissage") : [], gere ? api("GET", "/studio/etat") : { disponible: false }]);
  vue(
    h("h1", {}, "Cours en ligne"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, cours.length ? cours.map((c) => h("button", { class: "session", onclick: () => ecranUnCours(c.id) },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, c.titre), h("span", { class: c.publie ? "pastille ok" : "pastille attente" }, c.publie ? "Publié" : "Brouillon")),
      h("div", { class: "discret-texte" }, `${c.lecons} leçon(s) · ${c.apprenants} apprenant(s)`))) : h("p", { class: "discret-texte" }, "Aucun cours.")),
    entites.length ? h("div", { class: "carte" }, h("h2", {}, "Nouveau cours"), formulaire(async (v) => {
      const c = await api("POST", "/cours", { entiteId: v.entiteId, titre: v.titre.trim(), description: v.description.trim() || undefined, seuilReussite: Number(v.seuil) });
      ecranUnCours(c.id);
    }, [h("div", { class: "grille" }, champ("Titre", { name: "titre", required: true }), champ("Description", { name: "description" }),
      champ("Note minimale aux quiz (%)", { name: "seuil", type: "number", min: 0, max: 100, value: 70, required: true }), choix("entiteId", "Entité", entites))], "Créer le cours")) : null,
    entites.length ? h("details", { class: "carte" }, h("summary", {}, "Studio IA : préparer un brouillon"),
      studio.disponible ? [
        h("p", { class: "discret-texte" }, "L'IA écrit un brouillon non publié, que vous relisez et corrigez. Elle peut se tromper. N'indiquez aucune donnée personnelle : la demande part chez le fournisseur d'IA."),
        formulaire(async (v, f, zone) => {
          zone.replaceChildren(h("p", { class: "discret-texte" }, "Rédaction en cours, cela peut prendre quelques minutes…"));
          const c = await api("POST", "/studio/brouillons", {
            entiteId: v.entiteId, sujet: v.sujet.trim(), public: v.public.trim() || undefined, nombreLecons: Number(v.nombre), consignes: v.consignes.trim() || undefined,
          });
          ecranUnCours(c.id, "Brouillon créé. Relisez chaque leçon et chaque réponse avant de publier.");
        }, [h("div", { class: "grille" }, champ("Sujet du cours", { name: "sujet", required: true, minlength: 3 }), champ("Public visé", { name: "public" }),
          champ("Nombre de leçons", { name: "nombre", type: "number", min: 1, max: 15, value: 5, required: true }), choix("entiteId", "Entité", entites)),
        h("label", {}, "Consignes (facultatif)", h("textarea", { name: "consignes", rows: 3 }))], "Générer le brouillon"),
      ] : h("p", { class: "discret-texte" }, "Le studio n'est pas encore configuré sur ce serveur : il faut une clé d'API et un modèle, à renseigner par le responsable technique.")) : null,
  );
}

/** Douala est à UTC+1, sans heure d'été. */
const isoDouala = (v) => v ? new Date(`${v}:00+01:00`).toISOString() : undefined;

/** Envoie le fichier tel quel, avec une progression visible : une vidéo peut être longue à partir. */
function envoyerVideo(leconId, fichier, surProgres) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", `/lecons/${leconId}/video`);
    x.setRequestHeader("authorization", `Bearer ${jeton}`);
    x.setRequestHeader("content-type", fichier.type === "video/webm" ? "video/webm" : "video/mp4");
    x.upload.addEventListener("progress", (e) => { if (e.lengthComputable) surProgres(Math.round((e.loaded * 100) / e.total)); });
    x.addEventListener("load", () => {
      if (x.status < 300) return resolve();
      let code = "inconnue";
      try { code = JSON.parse(x.responseText).erreur; } catch { /* réponse sans détail */ }
      reject(Object.assign(new Error(), { code }));
    });
    x.addEventListener("error", () => reject(new TypeError()));
    x.send(fichier);
  });
}

function blocLecon(id, l) {
  return h("details", {}, h("summary", {}, "Modifier"),
    formulaire(async (v) => {
      await api("PUT", `/lecons/${l.id}`, {
        titre: v.titre.trim(), contenu: v.contenu.trim() || undefined, url: l.url || undefined,
        directLe: isoDouala(v.directLe), directLien: v.directLien.trim() || undefined, questions: lireQuestions(v.questions),
      });
      ecranUnCours(id, "Leçon modifiée.");
    }, [champ("Titre", { name: "titre", value: l.titre, required: true }),
      h("label", {}, "Contenu", (() => { const t = h("textarea", { name: "contenu", rows: 6 }); t.value = l.contenu || ""; return t; })()),
      champ("Cours en direct : date et heure de Douala", { name: "directLe", type: "datetime-local", value: l.direct_le ? new Date(new Date(l.direct_le).getTime() + 3600000).toISOString().slice(0, 16) : "" }),
      champ("Lien de la réunion en direct (https)", { name: "directLien", type: "url", value: l.direct_lien || "" }),
      h("label", {}, "Quiz, une question par ligne : Question ; choix ; *bonne réponse ; choix", (() => {
        const t = h("textarea", { name: "questions", rows: 4 });
        t.value = l.questions.map((q) => [q.enonce, ...q.choix.map((c, i) => (i === q.bonne ? `*${c}` : c))].join(" ; ")).join("\n");
        return t;
      })())], "Enregistrer la leçon"),
    formulaire(async (v, f, zone) => {
      const fichier = f.querySelector("input[type=file]").files[0];
      if (!fichier) throw Object.assign(new Error(), { code: "format_video" });
      const etat = h("p", { class: "discret-texte", role: "status" }, "Envoi : 0 %");
      zone.replaceChildren(etat);
      await envoyerVideo(l.id, fichier, (p) => { etat.textContent = `Envoi : ${p} %`; });
      ecranUnCours(id, "Vidéo ajoutée.");
    }, [h("label", {}, l.video_fichier ? "Remplacer la vidéo (MP4 ou WebM)" : "Ajouter la vidéo ou l'enregistrement (MP4 ou WebM)", h("input", { type: "file", accept: "video/mp4,video/webm" }))], "Envoyer la vidéo"),
    l.video_fichier ? h("button", { type: "button", class: "danger", onclick: async () => {
      await api("DELETE", `/lecons/${l.id}/video`);
      ecranUnCours(id, "Vidéo retirée.");
    } }, "Retirer la vidéo") : null);
}

/** Questions saisies en texte : "Question ; choix 1 ; *bonne réponse ; choix 3", une par ligne. */
function lireQuestions(texte) {
  return texte.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const [enonce, ...choix] = l.split(";").map((x) => x.trim());
    const bonne = choix.findIndex((c) => c.startsWith("*"));
    if (!enonce || choix.length < 2 || bonne < 0) throw Object.assign(new Error(), { code: "donnees_invalides" });
    return { enonce, choix: choix.map((c) => c.replace(/^\*/, "").trim()), bonne };
  });
}

async function ecranUnCours(id, message) {
  const gere = droits.includes("apprentissage.gerer");
  const [c, suivi] = await Promise.all([api("GET", `/cours/${id}`), api("GET", `/cours/${id}/suivi`)]);
  vue(
    h("button", { class: "discret", onclick: () => ecranCours() }, "← Tous les cours"),
    h("h1", {}, c.titre),
    h("p", { class: "discret-texte" }, `${c.description || ""} Note minimale : ${c.seuil_reussite} %.`),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    gere ? h("div", { class: "actions" }, h("button", { class: c.publie ? "discret" : "", onclick: async () => {
      await api("PATCH", `/cours/${id}`, { publie: !c.publie });
      ecranUnCours(id, c.publie ? "Cours retiré." : "Cours publié.");
    } }, c.publie ? "Retirer de la publication" : "Publier le cours")) : null,
    h("div", { class: "carte" }, h("h2", {}, "Leçons"), c.lecons.length ? c.lecons.map((l) => h("div", { class: "apprenant" },
      h("div", { class: "nom" }, `${l.ordre}. ${l.titre}`),
      h("div", { class: "discret-texte" }, `${l.direct_le ? `En direct le ${heure(l.direct_le)} · ` : ""}${l.video_fichier ? `Vidéo hébergée (${Math.round(l.video_taille / 1048576)} Mo) · ` : ""}${l.url ? "Lien · " : ""}${l.questions.length} question(s)`),
      gere ? blocLecon(id, l) : null)) : h("p", { class: "discret-texte" }, "Aucune leçon.")),
    gere ? h("details", { class: "carte" }, h("summary", {}, "Ajouter une leçon"), formulaire(async (v) => {
      await api("POST", `/cours/${id}/lecons`, { titre: v.titre.trim(), contenu: v.contenu.trim() || undefined, url: v.url.trim() || undefined, directLe: isoDouala(v.directLe), directLien: v.directLien.trim() || undefined, questions: lireQuestions(v.questions) });
      ecranUnCours(id, "Leçon ajoutée.");
    }, [champ("Titre", { name: "titre", required: true }),
      h("label", {}, "Contenu", h("textarea", { name: "contenu", rows: 6 })),
      champ("Lien vidéo ou document (https)", { name: "url", type: "url" }),
      champ("Cours en direct : date et heure de Douala", { name: "directLe", type: "datetime-local" }),
      champ("Lien de la réunion en direct (https)", { name: "directLien", type: "url" }),
      h("label", {}, "Quiz, une question par ligne : Question ; choix ; *bonne réponse ; choix", h("textarea", { name: "questions", rows: 4 })),
    ], "Ajouter la leçon")) : null,
    h("div", { class: "carte" }, h("h2", {}, "Suivi des apprenants"), suivi.length ? suivi.map((a) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, a.nom), a.termine_le ? h("span", { class: "pastille ok" }, "Terminé") : h("span", { class: "pastille attente" }, `${a.progression} %`)),
      a.certificat ? h("div", { class: "discret-texte" }, `Certificat ${a.certificat}`) : null,
      h("div", { class: "discret-texte" }, `${a.terminees}/${a.total} leçons${a.score_moyen === null ? "" : ` · Score ${a.score_moyen} %`}${a.derniere_activite ? ` · Vu le ${heure(a.derniere_activite)}` : " · Pas encore commencé"}`),
      a.lien && a.actif ? h("div", { class: "actions" },
        a.telephone ? h("a", { class: "lien-bouton", target: "_blank", rel: "noopener", href: `https://wa.me/${a.telephone}?text=${encodeURIComponent(`Bonjour, voici votre accès au cours : ${a.lien}`)}` }, "Envoyer sur WhatsApp") : null,
        h("button", { class: "discret", onclick: async (e) => { await navigator.clipboard.writeText(a.lien); e.target.textContent = "Copié"; } }, "Copier le lien"),
        h("button", { class: "danger", onclick: async () => { await api("POST", `/acces-cours/${a.id}/retrait`); ecranUnCours(id, "Accès retiré."); } }, "Retirer l'accès")) : null))
      : h("p", { class: "discret-texte" }, "Aucun apprenant.")),
    gere ? h("div", { class: "carte" }, h("h2", {}, "Donner l'accès à un apprenant"), formulaire(async (v, f, zone) => {
      await ficheClient(zone, { type: "personne", nom: v.nom.trim(), telephone: v.telephone.trim() || undefined, email: v.email.trim() || undefined, entiteId: c.entite_id }, async (tiersId) => {
        await api("POST", `/cours/${id}/acces`, { tiersId });
        ecranUnCours(id, `Accès créé pour ${v.nom.trim()}.`);
      });
    }, [h("div", { class: "grille" }, ...champsClient())], "Donner l'accès")) : null,
  );
}

const CONTRATS = [["cdi", "CDI"], ["cdd", "CDD"], ["stage", "Stage"], ["prestataire", "Prestataire"], ["autre", "Autre"]];
const TYPES_CONGE = [["annuel", "Congé annuel"], ["maladie", "Maladie"], ["maternite", "Maternité"], ["permission", "Permission"], ["sans_solde", "Sans solde"], ["autre", "Autre"]];

async function ecranRh(message) {
  const gere = droits.includes("rh.gerer");
  const [employes, entites] = await Promise.all([api("GET", "/employes"), gere ? entitesPour("rh_paie") : []]);
  vue(
    h("h1", {}, "Ressources humaines"),
    h("div", { class: "actions" }, h("button", { class: "discret", onclick: () => ecranRecrutement() }, "Recrutement"), h("button", { class: "discret", onclick: () => ecranNotesFrais() }, "Notes de frais"), gere ? h("button", { class: "discret", onclick: () => ecranSites() }, "Bornes de pointage") : null, droits.includes("rh.paie") ? h("button", { class: "discret", onclick: () => ecranEtatPaie() }, "État et versements de paie") : null, gere ? h("button", { class: "discret", onclick: () => ecranComptesEmployes() }, "Comptes des employés") : null),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    droits.includes("rh.paie") ? h("div", { class: "actions" }, h("button", { class: "discret", onclick: () => ecranRubriques() }, "Rubriques de paie")) : null,
    h("div", { class: "carte" }, employes.length ? employes.map((e) => h("button", { class: "session", onclick: () => ecranEmploye(e) },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, e.nom), e.date_sortie ? h("span", { class: "pastille retard" }, "Sorti") : e.en_conge ? h("span", { class: "pastille attente" }, "En congé") : null),
      h("div", { class: "discret-texte" }, `${e.matricule} · ${e.poste} · ${e.entite}`))) : h("p", { class: "discret-texte" }, "Aucun employé.")),
    gere && entites.length ? h("div", { class: "carte" }, h("h2", {}, "Nouvel employé"), formulaire(async (v) => {
      await api("POST", "/employes", {
        entiteId: v.entiteId, nom: v.nom.trim(), poste: v.poste.trim(), typeContrat: v.contrat, dateEmbauche: v.date,
        telephone: v.telephone.trim() || undefined, email: v.email.trim() || undefined,
      });
      ecranRh("Employé créé.");
    }, [h("div", { class: "grille" }, champ("Nom", { name: "nom", required: true }), champ("Poste", { name: "poste", required: true }),
      choix("contrat", "Contrat", CONTRATS), champ("Date d'embauche", { name: "date", type: "date", required: true }),
      champ("Téléphone", { name: "telephone", type: "tel" }), champ("E-mail", { name: "email", type: "email" }), choix("entiteId", "Entité", entites))], "Créer l'employé")) : null,
  );
}

async function ecranEmploye(e, message, alerte) {
  const gere = droits.includes("rh.gerer");
  const mois = new Date().toISOString().slice(0, 7);
  const [conges, solde, pointage] = await Promise.all([api("GET", `/employes/${e.id}/conges`), api("GET", `/employes/${e.id}/solde-conges`), api("GET", `/employes/${e.id}/pointages?mois=${mois}`)]);
  const decider = (c, decision, texte) => h("button", { class: decision === "approuve" ? "" : "discret", onclick: async () => {
    try {
      await api("POST", `/conges/${c.id}/decision`, { decision });
      ecranEmploye(e, texte);
    } catch (x) {
      if (x.code !== "solde_conges_insuffisant") throw x;
      ecranEmploye(e, undefined, `Solde insuffisant : ${x.details.solde} jour(s) disponibles pour ${x.details.jours} demandés. Une dérogation motivée reste possible ci-dessous.`);
    }
  } }, decision === "approuve" ? "Approuver" : "Annuler le congé");
  vue(
    h("button", { class: "discret", onclick: () => ecranRh() }, "← Tous les employés"),
    h("h1", {}, e.nom),
    h("p", { class: "discret-texte" }, `${e.matricule} · ${e.poste} · ${libelle(CONTRATS, e.type_contrat)} · Depuis le ${dateFr(e.date_embauche)}${e.telephone ? ` · ${e.telephone}` : ""}`),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    alerte ? h("div", { class: "erreur", role: "alert" }, alerte) : null,
    droits.includes("rh.paie") ? h("div", { class: "actions" }, h("button", { onclick: () => ecranPaieEmploye(e) }, "Salaire et bulletins")) : null,
    h("div", { class: "carte" }, h("h2", {}, "Solde de congés annuels"),
      solde.parametre ? h("p", { class: "grand" }, `${solde.solde} jour(s)`) : h("p", { class: "discret-texte" }, "Non réglé : aucun solde n'est calculé ni contrôlé."),
      solde.parametre ? h("p", { class: "discret-texte" }, `Acquis ${solde.acquis} · Pris ${solde.pris} · ${solde.jours_par_mois} jour(s) par mois depuis le ${dateFr(solde.solde_au)}`) : null,
      gere ? h("details", {}, h("summary", {}, "Régler le solde"),
        h("p", { class: "discret-texte" }, "À fixer selon le contrat et la validation de votre expert : le système ne suppose aucun taux. Les jours sont comptés en jours calendaires."),
        formulaire(async (v) => {
          await api("PUT", `/employes/${e.id}/solde-conges`, { joursParMois: Number(v.rythme), soldeInitial: Number(v.initial), soldeAu: v.date });
          ecranEmploye(e, "Solde réglé.");
        }, [h("div", { class: "grille" },
          champ("Jours acquis par mois", { name: "rythme", type: "number", min: 0, max: 31, step: 0.01, value: solde.jours_par_mois ?? "", required: true }),
          champ("Solde de départ (jours)", { name: "initial", type: "number", step: 0.01, value: solde.solde_initial ?? 0, required: true }),
          champ("À la date du", { name: "date", type: "date", value: solde.solde_au || e.date_embauche, required: true }))], "Enregistrer le solde")) : null),
    h("div", { class: "carte" }, h("h2", {}, "Pointage du mois"),
      h("p", { class: "discret-texte" }, `${pointage.jours} jour(s) · ${Math.floor(pointage.minutes / 60)} h ${String(pointage.minutes % 60).padStart(2, "0")}`),
      pointage.lignes.map((l) => h("div", { class: "ligne apprenant" }, h("span", {}, dateFr(l.jour)), h("span", {}, `${l.arrivee} → ${l.depart || "…"}`))),
      gere ? h("details", {}, h("summary", {}, "Saisir ou corriger un jour"), formulaire(async (v) => {
        await api("PUT", `/employes/${e.id}/pointages`, { jour: v.jour, arrivee: v.arrivee, depart: v.depart || undefined, note: v.note.trim() || undefined });
        ecranEmploye(e, "Pointage enregistré.");
      }, [h("div", { class: "grille" }, champ("Jour", { name: "jour", type: "date", value: new Date().toISOString().slice(0, 10), required: true }),
        champ("Arrivée", { name: "arrivee", type: "time", required: true }), champ("Départ", { name: "depart", type: "time" }), champ("Note", { name: "note" }))], "Enregistrer le pointage")) : null),
    h("div", { class: "carte" }, h("h2", {}, "Congés"), conges.length ? conges.map((c) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${libelle(TYPES_CONGE, c.type)} : ${c.jours} jour(s)`), h("span", { class: c.statut === "approuve" ? "pastille ok" : c.statut === "demande" ? "pastille attente" : "pastille retard" }, c.statut)),
      h("div", { class: "discret-texte" }, `Du ${dateFr(c.debut)} au ${dateFr(c.fin)}${c.motif ? ` · ${c.motif}` : ""}${c.motif_refus ? ` · Refus : ${c.motif_refus}` : ""}${c.derogation ? ` · Dérogation : ${c.derogation}` : ""}`),
      gere && c.statut === "demande" ? h("div", { class: "actions" }, decider(c, "approuve", "Congé approuvé."),
        c.type === "annuel" ? h("details", {}, h("summary", {}, "Approuver par dérogation"), formulaire(async (v) => {
          await api("POST", `/conges/${c.id}/decision`, { decision: "approuve", derogation: v.derogation.trim() });
          ecranEmploye(e, "Congé approuvé par dérogation.");
        }, [champ("Motif de la dérogation", { name: "derogation", required: true, minlength: 5 })], "Confirmer la dérogation")) : null,
        h("details", {}, h("summary", {}, "Refuser"), formulaire(async (v) => {
          await api("POST", `/conges/${c.id}/decision`, { decision: "refuse", motif: v.motif.trim() });
          ecranEmploye(e, "Congé refusé.");
        }, [champ("Motif", { name: "motif", required: true, minlength: 3 })], "Confirmer le refus"))) : null,
      gere && c.statut === "approuve" ? h("div", { class: "actions" }, decider(c, "annule", "Congé annulé.")) : null))
      : h("p", { class: "discret-texte" }, "Aucun congé.")),
    gere ? h("div", { class: "carte" }, h("h2", {}, "Enregistrer une demande"), formulaire(async (v) => {
      await api("POST", `/employes/${e.id}/conges`, { type: v.type, debut: v.debut, fin: v.fin, motif: v.motif.trim() || undefined });
      ecranEmploye(e, "Demande enregistrée.");
    }, [h("div", { class: "grille" }, choix("type", "Type", TYPES_CONGE), champ("Début", { name: "debut", type: "date", required: true }),
      champ("Fin", { name: "fin", type: "date", required: true }), champ("Motif", { name: "motif" }))], "Enregistrer")) : null,
    gere && !e.date_sortie ? h("details", { class: "carte" }, h("summary", {}, "Enregistrer une sortie"), formulaire(async (v) => {
      await api("PATCH", `/employes/${e.id}`, { dateSortie: v.date });
      ecranRh(`Sortie de ${e.nom} enregistrée.`);
    }, [champ("Date de sortie", { name: "date", type: "date", required: true })], "Confirmer la sortie")) : null,
  );
}

const SENS_PAIE = [["gain", "Gain"], ["retenue", "Retenue du salarié"], ["charge", "Charge de l'employeur"]];
const MODES_PAIE = [["pourcentage", "Pourcentage"], ["fixe", "Montant fixe"], ["bareme", "Barème par tranches"]];
const ASSIETTES_PAIE = [["brut", "Salaire brut"], ["base", "Salaire de base"], ["apres_retenues", "Brut après retenues précédentes"], ["rubrique", "Une autre rubrique"]];

/** Une tranche par ligne : "plafond ; taux", et "reste ; taux" pour la dernière. */
function lireTranches(texte) {
  const lignes = texte.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lignes.length) return undefined;
  return lignes.map((l) => {
    const [haut, taux] = l.split(";").map((x) => x.trim());
    if (taux === undefined || Number.isNaN(Number(taux))) throw Object.assign(new Error(), { code: "rubrique_invalide" });
    return { jusqua: haut === "reste" ? null : Number(haut), taux: Number(taux) };
  });
}

async function ecranRubriques(entiteChoisie, message) {
  const entites = await entitesPour("rh_paie");
  if (!entites.length) return vue(h("h1", {}, "Rubriques de paie"), h("p", { class: "discret-texte" }, "Aucune entité disponible."));
  const entiteId = entiteChoisie || entites[0][0];
  const { rubriques, validation } = await api("GET", `/rubriques-paie?entiteId=${entiteId}`);
  vue(
    h("button", { class: "discret", onclick: () => ecranRh() }, "← Ressources humaines"),
    h("h1", {}, "Rubriques de paie"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("label", {}, "Entité", h("select", { onchange: (e) => ecranRubriques(e.target.value) }, entites.map(([id, nom]) => h("option", { value: id, selected: id === entiteId }, nom)))),
    validation
      ? h("div", { class: "succes" }, `Validé par ${validation.expert} le ${dateFr(validation.valide_le)}.`)
      : h("div", { class: "alerte-caisse", role: "status" }, "Non validé par un expert : les bulletins restent des brouillons. Aucun taux légal n'est préenregistré ; saisissez ceux que votre expert-comptable vous donne."),
    h("div", { class: "carte" }, h("h2", {}, "Rubriques"), rubriques.length ? rubriques.map((r) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${r.ordre}. ${r.libelle}`), r.actif ? null : h("span", { class: "pastille retard" }, "Inactive")),
      h("div", { class: "discret-texte" }, `${r.code} · ${libelle(SENS_PAIE, r.sens)} · ${libelle(MODES_PAIE, r.mode)}${r.taux !== null ? ` · ${Number(r.taux)} %` : ""}${r.montant !== null ? ` · ${fcfa(r.montant)}` : ""}${r.plafond !== null ? ` · Plafond ${fcfa(r.plafond)}` : ""}`),
      h("button", { class: "discret", onclick: async () => {
        await api("PUT", `/rubriques-paie/${r.id}`, {
          code: r.code, libelle: r.libelle, sens: r.sens, mode: r.mode, assiette: r.assiette, assietteRubrique: r.assiette_rubrique || undefined,
          montant: r.montant ?? undefined, taux: r.taux === null ? undefined : Number(r.taux), plafond: r.plafond ?? undefined,
          abattementPct: Number(r.abattement_pct), annualise: r.annualise, tranches: r.tranches || undefined, ordre: r.ordre, actif: !r.actif,
        });
        ecranRubriques(entiteId, r.actif ? "Rubrique désactivée." : "Rubrique activée.");
      } }, r.actif ? "Désactiver" : "Activer"))) : h("p", { class: "discret-texte" }, "Aucune rubrique.")),
    h("details", { class: "carte" }, h("summary", {}, "Nouvelle rubrique"), formulaire(async (v) => {
      await api("POST", "/rubriques-paie", {
        entiteId, code: v.code.trim(), libelle: v.libelle.trim(), sens: v.sens, mode: v.mode, assiette: v.assiette,
        assietteRubrique: v.assietteRubrique.trim() || undefined, montant: v.montant ? Number(v.montant) : undefined, taux: v.taux ? Number(v.taux) : undefined,
        plafond: v.plafond ? Number(v.plafond) : undefined, abattementPct: Number(v.abattement || 0), annualise: v.annualise === "oui",
        tranches: lireTranches(v.tranches), ordre: Number(v.ordre || 100),
      });
      ecranRubriques(entiteId, "Rubrique ajoutée. La validation de l'expert est à refaire.");
    }, [h("div", { class: "grille" }, champ("Code", { name: "code", required: true, pattern: "[A-Za-z0-9_]{1,30}" }), champ("Libellé", { name: "libelle", required: true }),
      choix("sens", "Sens", SENS_PAIE), choix("mode", "Mode", MODES_PAIE), choix("assiette", "Assiette", ASSIETTES_PAIE),
      champ("Code de la rubrique d'assiette", { name: "assietteRubrique" }), champ("Taux (%)", { name: "taux", type: "number", min: 0, step: 0.0001 }),
      champ("Montant fixe (FCFA)", { name: "montant", type: "number", min: 0 }), champ("Plafond de l'assiette (FCFA)", { name: "plafond", type: "number", min: 0 }),
      champ("Abattement sur l'assiette (%)", { name: "abattement", type: "number", min: 0, max: 100, step: 0.001 }),
      choix("annualise", "Barème annuel", [["non", "Non"], ["oui", "Oui : calculé sur 12 mois"]]), champ("Ordre de calcul", { name: "ordre", type: "number", min: 0, value: 100 })),
    h("label", {}, "Tranches, une par ligne : plafond ; taux. Dernière ligne : reste ; taux", h("textarea", { name: "tranches", rows: 4 }))], "Ajouter la rubrique")),
    droits.includes("entites.gerer") ? h("details", { class: "carte" }, h("summary", {}, "Enregistrer la validation de l'expert"), formulaire(async (v) => {
      await api("PUT", "/paie/validation", { entiteId, expert: v.expert.trim(), valideLe: v.date });
      ecranRubriques(entiteId, "Validation enregistrée.");
    }, [h("p", { class: "discret-texte" }, "À faire seulement après l'accord écrit de l'expert sur toutes les rubriques ci-dessus."),
      h("div", { class: "grille" }, champ("Nom de l'expert ou du cabinet", { name: "expert", required: true, minlength: 3 }), champ("Date de son accord", { name: "date", type: "date", required: true }))], "Enregistrer")) : null,
  );
}

async function ecranPaieEmploye(e, message) {
  const [salaire, bulletins] = await Promise.all([api("GET", `/employes/${e.id}/salaire`), api("GET", `/employes/${e.id}/bulletins`)]);
  vue(
    h("button", { class: "discret", onclick: () => ecranEmploye(e) }, `← ${e.nom}`),
    h("h1", {}, "Salaire et bulletins"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, h("h2", {}, "Salaire de base"), formulaire(async (v) => {
      await api("PUT", `/employes/${e.id}/salaire`, { salaireBase: Number(v.salaire) });
      ecranPaieEmploye(e, "Salaire enregistré. Les brouillons de cet employé ont été retirés.");
    }, [champ("Montant mensuel (FCFA)", { name: "salaire", type: "number", min: 0, value: salaire.salaire_base ?? "", required: true })], "Enregistrer le salaire")),
    h("div", { class: "carte" }, h("h2", {}, "Préparer un bulletin"), formulaire(async (v) => {
      const variables = [];
      if (v.prime) variables.push({ libelle: v.primeLibelle.trim() || "Prime", sens: "gain", montant: Number(v.prime) });
      if (v.retenue) variables.push({ libelle: v.retenueLibelle.trim() || "Retenue", sens: "retenue", montant: Number(v.retenue) });
      voirBulletin(e, (await api("POST", "/bulletins", { employeId: e.id, periode: v.periode, variables })).id);
    }, [h("div", { class: "grille" }, champ("Mois", { name: "periode", type: "month", value: new Date().toISOString().slice(0, 7), required: true }),
      champ("Libellé de la prime du mois", { name: "primeLibelle" }), champ("Prime du mois (FCFA)", { name: "prime", type: "number", min: 0 }),
      champ("Libellé de la retenue du mois", { name: "retenueLibelle" }), champ("Retenue du mois (FCFA)", { name: "retenue", type: "number", min: 0 }))], "Calculer le brouillon")),
    h("div", { class: "carte" }, h("h2", {}, "Bulletins"), bulletins.length ? bulletins.map((b) => h("button", { class: "session", onclick: () => voirBulletin(e, b.id) },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, b.periode), h("span", { class: b.statut === "valide" ? "pastille ok" : b.statut === "annule" ? "pastille retard" : "pastille attente" }, { brouillon: "Brouillon", valide: "Validé", annule: "Annulé" }[b.statut])),
      h("div", { class: "discret-texte" }, `Net : ${fcfa(b.net)}${b.numero ? ` · ${b.numero}` : ""}`))) : h("p", { class: "discret-texte" }, "Aucun bulletin.")),
  );
}

async function voirBulletin(e, id, message) {
  const b = await api("GET", `/bulletins/${id}`);
  const ligne = (l) => h("tr", {}, h("td", {}, l.libelle), h("td", { class: "nombre" }, l.assiette === null ? "" : l.assiette.toLocaleString("fr-FR")), h("td", { class: "nombre" }, l.montant.toLocaleString("fr-FR")));
  const groupe = (titre, sens) => {
    const lignes = b.lignes.filter((l) => l.sens === sens);
    return lignes.length ? [h("tr", {}, h("th", { colspan: 3 }, titre)), lignes.map(ligne)] : null;
  };
  vue(
    h("div", { class: "actions pas-imprimer" }, h("button", { class: "discret", onclick: () => ecranPaieEmploye(e) }, "← Bulletins"),
      h("button", { class: "discret", onclick: () => window.print() }, "Imprimer"),
      b.statut === "brouillon" ? h("button", { onclick: async () => {
        await api("POST", `/bulletins/${id}/validation`);
        voirBulletin(e, id, "Bulletin validé et figé.");
      } }, "Valider le bulletin") : null,
      b.statut === "brouillon" ? h("button", { class: "danger", onclick: async () => {
        await api("DELETE", `/bulletins/${id}`);
        ecranPaieEmploye(e, "Brouillon supprimé.");
      } }, "Supprimer le brouillon") : null),
    message ? h("div", { class: "succes pas-imprimer", role: "status" }, message) : null,
    h("div", { class: "document" },
      b.statut === "brouillon" ? h("p", { class: "etat rouge" }, "BROUILLON : sans valeur tant qu'il n'est pas validé") : null,
      b.statut === "annule" ? h("p", { class: "etat rouge" }, `ANNULÉ : ${b.motif_annulation}`) : null,
      h("h2", {}, `Bulletin de paie ${b.periode}`),
      h("p", {}, `${b.employe} · ${b.matricule} · ${b.poste}`),
      b.numero ? h("p", { class: "discret-texte" }, `N° ${b.numero}. Rubriques validées par ${b.expert}.`) : null,
      h("div", { class: "defilant" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Rubrique"), h("th", { class: "nombre" }, "Assiette"), h("th", { class: "nombre" }, "Montant"))),
        h("tbody", {}, groupe("Gains", "gain"), groupe("Retenues", "retenue"), groupe("Charges de l'employeur", "charge")))),
      h("p", { class: "totaux" }, `Brut : ${fcfa(b.brut)} · Retenues : ${fcfa(b.retenues)}`),
      h("p", { class: "totaux grand" }, `Net à payer : ${fcfa(b.net)}`)),
    b.statut === "valide" ? h("details", { class: "carte pas-imprimer" }, h("summary", {}, "Annuler ce bulletin"), formulaire(async (v) => {
      await api("POST", `/bulletins/${id}/annulation`, { motif: v.motif.trim() });
      voirBulletin(e, id, "Bulletin annulé.");
    }, [champ("Motif", { name: "motif", required: true, minlength: 5 })], "Confirmer l'annulation")) : null,
  );
}
