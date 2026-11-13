"use strict";
/* SMARTE Coaching et IP2EL University. */
const texteLibre = (libelle, nom, valeur = "") => {
  const t = h("textarea", { name: nom, rows: 4 });
  t.value = valeur;
  return h("label", {}, libelle, t);
};
const qrDe = (svg) => {
  const qr = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  qr.setAttribute("class", "qr");
  qr.setAttribute("role", "img");
  qr.setAttribute("aria-label", "QR code de vérification");
  return qr;
};
function voirTitre(titre, c, retour) {
  vue(h("div", { class: "actions pas-imprimer" }, h("button", { class: "discret", onclick: retour }, "← Retour"), h("button", { onclick: () => window.print() }, "Imprimer")),
    h("div", { class: "document" }, h("h2", {}, titre), h("p", { class: "grand" }, c.titulaire), h("p", {}, c.programme), h("p", {}, `N° ${c.numero}, délivré le ${dateFr(c.delivre_le)}`), qrDe(c.qr_svg),
      h("p", { class: "discret-texte" }, "Scannez ce code pour vérifier l'authenticité.")));
}

async function ecranCoaching(message) {
  const gere = droits.includes("coaching.gerer");
  const [coachs, accs, entites] = await Promise.all([api("GET", "/coachs"), api("GET", "/accompagnements"), gere ? entitesPour("coaching") : []]);
  const entiteId = entites[0]?.[0];
  const [reseau, regles, niveaux, parcours] = gere && entiteId
    ? await Promise.all([api("GET", `/coachs/reseau?entiteId=${entiteId}`), api("GET", `/redevances/regles?entiteId=${entiteId}`), api("GET", "/certification/niveaux"), api("GET", "/certification/parcours")])
    : [[], [], [], []];
  const nouveau = (zone, v, suite) => ficheClient(zone, { type: "personne", nom: v.nom.trim(), telephone: v.telephone?.trim() || undefined, entiteId }, suite);
  vue(
    h("div", { class: "actions" }, h("button", { class: "discret", onclick: () => ecranReservations() }, "Créneaux et réservation en ligne"), h("button", { class: "discret", onclick: () => ecranBibliotheque() }, "Bibliothèque")),
    h("h1", {}, "SMARTE Coaching"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, h("h2", {}, "Accompagnements"), accs.length ? accs.map((a) => h("button", { class: "session", onclick: () => ecranAccompagnement(a.id) },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${a.client} : ${a.titre}`), h("span", { class: a.statut === "actif" ? "pastille ok" : "pastille attente" }, a.statut)),
      h("div", { class: "discret-texte" }, `Coach ${a.coach} · ${a.seances_tenues}${a.forfait_seances ? `/${a.forfait_seances}` : ""} séance(s) · Progrès ${a.progres} %`))) : h("p", { class: "discret-texte" }, "Aucun accompagnement.")),
    gere && coachs.length ? h("details", { class: "carte" }, h("summary", {}, "Nouvel accompagnement"), formulaire(async (v, f, zone) => {
      await nouveau(zone, v, async (tiersId) => {
        const a = await api("POST", "/accompagnements", { coachId: v.coachId, tiersId, titre: v.titre.trim(), objectifs: v.objectifs.trim() || undefined, consentementLe: v.consentement, forfaitSeances: v.forfait ? Number(v.forfait) : undefined });
        ecranAccompagnement(a.id, "Accompagnement créé.");
      });
    }, [h("div", { class: "grille" }, champ("Nom du client", { name: "nom", required: true }), champ("Téléphone", { name: "telephone", type: "tel" }),
      choix("coachId", "Coach", coachs.map((c) => [c.id, c.nom])), champ("Titre", { name: "titre", required: true }),
      champ("Date du consentement du client", { name: "consentement", type: "date", required: true }), champ("Séances du forfait (facultatif)", { name: "forfait", type: "number", min: 1 })),
    texteLibre("Objectifs", "objectifs")], "Créer")) : null,
    h("div", { class: "carte" }, h("h2", {}, "Réseau de coachs"),
      reseau.length ? h("p", { class: "discret-texte" }, reseau.map((g) => `Génération ${g.generation} : ${g.coachs}`).join(" · ")) : null,
      coachs.length ? coachs.map((c) => h("div", { class: "apprenant" },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, c.nom), c.licence_fin && c.licence_fin >= aujourdhui() ? h("span", { class: "pastille ok" }, `Licence jusqu'au ${dateFr(c.licence_fin)}`) : h("span", { class: "pastille retard" }, "Sans licence en cours")),
        h("div", { class: "discret-texte" }, `${c.formes} coach(s) formé(s) · Redevances calculées ${fcfa(c.redevances_dues)}`),
        gere ? h("details", {}, h("summary", {}, "Licence et revenus"),
          formulaire(async (v) => {
            await api("POST", `/coachs/${c.id}/licences`, { debut: v.debut, fin: v.fin, montant: Number(v.montant) });
            ecranCoaching("Licence enregistrée.");
          }, [h("div", { class: "grille" }, champ("Début", { name: "debut", type: "date", required: true }), champ("Fin", { name: "fin", type: "date", required: true }), champ("Montant (FCFA)", { name: "montant", type: "number", min: 0, required: true }))], "Enregistrer la licence"),
          formulaire(async (v) => {
            const r = await api("POST", `/coachs/${c.id}/revenus`, { periode: v.periode, libelle: v.libelle.trim(), montant: Number(v.montant) });
            ecranCoaching(`Revenu enregistré. ${r.redevances.length} redevance(s) calculée(s).`);
          }, [h("div", { class: "grille" }, champ("Mois", { name: "periode", type: "month", required: true }), champ("Libellé", { name: "libelle", required: true }), champ("Revenu (FCFA)", { name: "montant", type: "number", min: 1, required: true }))], "Déclarer le revenu")) : null))
        : h("p", { class: "discret-texte" }, "Aucun coach.")),
    gere && entiteId ? h("details", { class: "carte" }, h("summary", {}, "Ajouter un coach"), formulaire(async (v, f, zone) => {
      await nouveau(zone, v, async (tiersId) => {
        await api("POST", "/coachs", { entiteId, tiersId, parentId: v.parentId || undefined });
        ecranCoaching("Coach ajouté.");
      });
    }, [h("div", { class: "grille" }, champ("Nom", { name: "nom", required: true }), champ("Téléphone", { name: "telephone", type: "tel" }),
      choix("parentId", "Formé par", [["", "Personne (sommet du réseau)"], ...coachs.map((c) => [c.id, c.nom])]))], "Ajouter")) : null,
    gere && entiteId ? h("details", { class: "carte" }, h("summary", {}, "Taux de redevance en cascade"),
      h("p", { class: "discret-texte" }, "Le taux vient de vos contrats de licence. Un taux par ligne : niveau ; taux. Niveau 1 : le formateur direct."),
      formulaire(async (v) => {
        const taux = v.taux.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
          const [p, t] = l.split(";").map(Number);
          return { profondeur: p, taux: t };
        });
        await api("PUT", "/redevances/regles", { entiteId, taux });
        ecranCoaching("Taux enregistrés.");
      }, [texteLibre("Taux", "taux", regles.map((r) => `${r.profondeur} ; ${r.taux}`).join("\n"))], "Enregistrer les taux")) : null,
    gere && entiteId ? h("div", { class: "carte" }, h("h2", {}, "Parcours de certification"),
      parcours.map((p) => h("div", { class: "apprenant" },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, `${p.nom} : ${p.niveau}`), p.numero ? h("span", { class: p.revoque_le ? "pastille retard" : "pastille ok" }, p.revoque_le ? "Révoqué" : p.numero) : h("span", { class: "pastille attente" }, "En cours")),
        p.numero ? null : formulaire(async (v) => {
          const corps = { heures: Number(v.heures), supervisions: Number(v.supervisions), examenReussi: v.examen === "oui", soutenanceReussie: v.soutenance === "oui" };
          await api("PATCH", `/certification/parcours/${p.id}`, corps);
          if (v.delivrer === "oui") return voirTitre("Certificat SMARTE Coaching", await api("POST", `/certification/parcours/${p.id}/delivrance`), () => ecranCoaching());
          ecranCoaching("Parcours enregistré.");
        }, [h("div", { class: "grille" }, champ(`Heures (sur ${p.heures_requises})`, { name: "heures", type: "number", min: 0, value: p.heures }), champ(`Supervisions (sur ${p.supervisions_requises})`, { name: "supervisions", type: "number", min: 0, value: p.supervisions }),
          choix("examen", "Examen", [["non", "Pas encore réussi"], ["oui", "Réussi"]], p.examen_reussi ? "oui" : "non"), choix("soutenance", "Soutenance", [["non", "Pas encore réussie"], ["oui", "Réussie"]], p.soutenance_reussie ? "oui" : "non"),
          choix("delivrer", "Après enregistrement", [["non", "Ne rien délivrer"], ["oui", "Délivrer le certificat"]]))], "Enregistrer"))),
      niveaux.length ? h("details", {}, h("summary", {}, "Inscrire un candidat"), formulaire(async (v, f, zone) => {
        await nouveau(zone, v, async (tiersId) => {
          await api("POST", `/certification/niveaux/${v.niveauId}/parcours`, { tiersId });
          ecranCoaching("Candidat inscrit.");
        });
      }, [h("div", { class: "grille" }, champ("Nom", { name: "nom", required: true }), champ("Téléphone", { name: "telephone", type: "tel" }), choix("niveauId", "Niveau", niveaux.map((n) => [n.id, `${n.ordre}. ${n.nom}`])))], "Inscrire")) : null,
      h("details", {}, h("summary", {}, "Ajouter un niveau"), formulaire(async (v) => {
        await api("POST", "/certification/niveaux", { entiteId, ordre: Number(v.ordre), nom: v.nom.trim(), heuresRequises: Number(v.heures), supervisionsRequises: Number(v.supervisions) });
        ecranCoaching("Niveau ajouté.");
      }, [h("div", { class: "grille" }, champ("Ordre", { name: "ordre", type: "number", min: 1, max: 20, value: niveaux.length + 1, required: true }), champ("Nom", { name: "nom", required: true }),
        champ("Heures requises", { name: "heures", type: "number", min: 0, required: true }), champ("Supervisions requises", { name: "supervisions", type: "number", min: 0, required: true }))], "Ajouter le niveau"))) : null,
  );
}

async function ecranAccompagnement(id, message) {
  const a = await api("GET", `/accompagnements/${id}`);
  vue(
    h("button", { class: "discret", onclick: () => ecranCoaching() }, "← SMARTE Coaching"),
    h("h1", {}, `${a.client} : ${a.titre}`),
    h("p", { class: "discret-texte" }, `Consentement du ${dateFr(a.consentement_le)}`),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, h("h2", {}, "Suivi"), formulaire(async (v) => {
      await api("PATCH", `/accompagnements/${id}`, { objectifs: v.objectifs, diagnostic: v.diagnostic, planAction: v.plan, progres: Number(v.progres), statut: v.statut });
      ecranAccompagnement(id, "Suivi enregistré.");
    }, [texteLibre("Objectifs", "objectifs", a.objectifs || ""), texteLibre("Diagnostic", "diagnostic", a.diagnostic || ""), texteLibre("Plan d'action", "plan", a.plan_action || ""),
      h("div", { class: "grille" }, champ("Progrès (%)", { name: "progres", type: "number", min: 0, max: 100, value: a.progres }), choix("statut", "État", [["actif", "Actif"], ["suspendu", "Suspendu"], ["termine", "Terminé"]], a.statut))], "Enregistrer le suivi")),
    h("div", { class: "carte" }, h("h2", {}, "Séances"), a.seances.map((s) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${heure(s.debut)} · ${s.duree_minutes} min`), h("span", { class: s.statut === "tenue" ? "pastille ok" : s.statut === "annulee" ? "pastille retard" : "pastille attente" }, s.statut)),
      s.statut === "planifiee" ? h("div", { class: "actions" },
        s.lien_visio ? h("a", { class: "lien-bouton", href: s.lien_visio, target: "_blank", rel: "noopener noreferrer" }, "Rejoindre") : null,
        h("button", { onclick: async () => { await api("POST", `/seances-coaching/${s.id}/statut`, { statut: "tenue" }); ecranAccompagnement(id, "Séance tenue."); } }, "Séance tenue"),
        h("button", { class: "discret", onclick: async () => { await api("POST", `/seances-coaching/${s.id}/statut`, { statut: "annulee" }); ecranAccompagnement(id, "Séance annulée."); } }, "Annuler")) : null)),
      formulaire(async (v) => {
        await api("POST", `/accompagnements/${id}/seances`, { debut: isoDouala(v.debut), dureeMinutes: Number(v.duree), lienVisio: v.lien.trim() || undefined });
        ecranAccompagnement(id, "Séance planifiée.");
      }, [h("div", { class: "grille" }, champ("Date et heure de Douala", { name: "debut", type: "datetime-local", required: true }), champ("Durée (minutes)", { name: "duree", type: "number", min: 5, value: 60, required: true }), champ("Lien de visioconférence (https)", { name: "lien", type: "url" }))], "Planifier")),
    a.estCoach ? h("div", { class: "carte" }, h("h2", {}, "Mes notes confidentielles"), h("p", { class: "discret-texte" }, "Vous seul pouvez les lire, et elles ne se modifient pas."),
      a.notes.map((n) => h("div", { class: "apprenant" }, h("div", { class: "discret-texte" }, heure(n.cree_le)), h("p", { class: "contenu" }, n.contenu))),
      formulaire(async (v) => {
        await api("POST", `/accompagnements/${id}/notes`, { contenu: v.contenu.trim() });
        ecranAccompagnement(id, "Note ajoutée.");
      }, [texteLibre("Nouvelle note", "contenu")], "Ajouter la note")) : null,
  );
}

async function ecranUniversite(message) {
  const gere = droits.includes("universite.gerer");
  const [filieres, entites] = await Promise.all([api("GET", "/filieres"), gere ? entitesPour("universite") : []]);
  vue(
    h("div", { class: "actions" }, h("button", { class: "discret", onclick: () => ecranStatsUniversite() }, "Statistiques et diplômés")),
    h("h1", {}, "IP2EL University"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, h("h2", {}, "Filières"), filieres.length ? filieres.map((f) => h("button", { class: "session", onclick: () => ecranFiliere(f.id) },
      h("div", { class: "nom" }, `${f.code} : ${f.nom}`),
      h("div", { class: "discret-texte" }, `${f.diplome} · ${f.ues} UE · ${f.inscrits} inscription(s) · ${f.candidatures} candidature(s) en attente`))) : h("p", { class: "discret-texte" }, "Aucune filière.")),
    entites.length ? h("details", { class: "carte" }, h("summary", {}, "Nouvelle filière"), formulaire(async (v) => {
      await api("POST", "/filieres", { entiteId: v.entiteId, code: v.code.trim(), nom: v.nom.trim(), diplome: v.diplome.trim(), creditsRequis: Number(v.credits), noteValidation: Number(v.note) });
      ecranUniversite("Filière créée.");
    }, [h("div", { class: "grille" }, choix("entiteId", "Établissement", entites), champ("Code", { name: "code", required: true }), champ("Nom", { name: "nom", required: true }), champ("Diplôme délivré", { name: "diplome", required: true }),
      champ("Crédits requis pour le diplôme", { name: "credits", type: "number", min: 1, required: true }), champ("Note de validation d'une UE (sur 20)", { name: "note", type: "number", min: 0, max: 20, step: 0.01, required: true }))], "Créer la filière")) : null,
  );
}

async function ecranFiliere(id, message) {
  const gere = droits.includes("universite.gerer");
  const f = await api("GET", `/filieres/${id}`);
  vue(
    h("div", { class: "actions" }, h("button", { class: "discret", onclick: () => ecranScolarite(id) }, "Scolarité et frais"), h("button", { class: "discret", onclick: () => ecranEmploiDuTemps(id) }, "Emploi du temps")),
    h("button", { class: "discret", onclick: () => ecranUniversite() }, "← Filières"),
    h("h1", {}, f.nom),
    h("p", { class: "discret-texte" }, `${f.diplome} · ${f.credits_requis} crédits · Validation à ${Number(f.note_validation)}/20`),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, h("h2", {}, "Unités d'enseignement"), f.ues.map((u) => h("div", { class: "ligne apprenant" }, h("span", {}, `${u.code} : ${u.nom}`), h("span", { class: "discret-texte" }, `S${u.semestre} · ${u.credits} crédits`))),
      gere ? h("details", {}, h("summary", {}, "Ajouter une UE"), formulaire(async (v) => {
        await api("POST", `/filieres/${id}/ues`, { code: v.code.trim(), nom: v.nom.trim(), credits: Number(v.credits), semestre: Number(v.semestre) });
        ecranFiliere(id, "UE ajoutée.");
      }, [h("div", { class: "grille" }, champ("Code", { name: "code", required: true }), champ("Nom", { name: "nom", required: true }), champ("Crédits", { name: "credits", type: "number", min: 1, required: true }), champ("Semestre", { name: "semestre", type: "number", min: 1, required: true }))], "Ajouter")) : null),
    gere ? h("div", { class: "carte" }, h("h2", {}, "Candidatures"), f.candidatures.map((c) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${c.nom} (${c.annee})`), h("span", { class: c.statut === "admise" ? "pastille ok" : c.statut === "refusee" ? "pastille retard" : "pastille attente" }, c.statut)),
      c.statut === "soumise" ? h("div", { class: "actions" }, h("button", { onclick: async () => { await api("POST", `/candidatures-univ/${c.id}/decision`, { decision: "admise" }); ecranFiliere(id, "Candidat admis et inscrit."); } }, "Admettre"),
        h("details", {}, h("summary", {}, "Refuser"), formulaire(async (v) => { await api("POST", `/candidatures-univ/${c.id}/decision`, { decision: "refusee", motif: v.motif.trim() }); ecranFiliere(id, "Candidature refusée."); }, [champ("Motif", { name: "motif", required: true, minlength: 3 })], "Confirmer"))) : null)),
      h("details", {}, h("summary", {}, "Nouvelle candidature"), formulaire(async (v, fo, zone) => {
        await ficheClient(zone, { type: "personne", nom: v.nom.trim(), telephone: v.telephone.trim() || undefined, entiteId: f.entite_id }, async (tiersId) => {
          await api("POST", `/filieres/${id}/candidatures`, { tiersId, annee: v.annee.trim() });
          ecranFiliere(id, "Candidature enregistrée.");
        });
      }, [h("div", { class: "grille" }, champ("Nom", { name: "nom", required: true }), champ("Téléphone", { name: "telephone", type: "tel" }), champ("Année universitaire", { name: "annee", required: true, placeholder: "2026-2027", pattern: "[0-9]{4}-[0-9]{4}" }))], "Enregistrer"))) : null,
    h("div", { class: "carte" }, h("h2", {}, "Étudiants"), f.inscrits.length ? f.inscrits.map((i) => h("button", { class: "session", onclick: () => ecranEtudiant(id, i) },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, i.nom), i.diplome ? h("span", { class: "pastille ok" }, "Diplômé") : null), h("div", { class: "discret-texte" }, `${i.matricule} · ${i.annee}`))) : h("p", { class: "discret-texte" }, "Aucun étudiant.")),
    h("div", { class: "carte" }, h("h2", {}, "Délibérations"), f.deliberations.map((d) => h("details", { class: "apprenant" }, h("summary", {}, `${d.annee}, session ${d.session}`),
      h("p", { class: "discret-texte" }, `Président : ${d.president} · ${heure(d.deliberee_le)}`),
      d.resultats.map((r) => h("div", { class: "ligne" }, h("span", {}, `${r.matricule} ${r.nom}`), h("span", {}, `${r.moyenne ?? "-"}/20 · ${r.credits_acquis} crédits`))))),
      gere ? h("details", {}, h("summary", {}, "Délibérer et figer les notes"), formulaire(async (v) => {
        await api("POST", `/filieres/${id}/deliberations`, { annee: v.annee.trim(), session: v.session, president: v.president.trim() });
        ecranFiliere(id, "Délibération enregistrée. Les notes de cette session sont figées.");
      }, [h("div", { class: "grille" }, champ("Année universitaire", { name: "annee", required: true, pattern: "[0-9]{4}-[0-9]{4}" }), choix("session", "Session", [["normale", "Normale"], ["rattrapage", "Rattrapage"]]), champ("Président du jury", { name: "president", required: true, minlength: 3 }))], "Délibérer")) : null),
  );
}

async function ecranEtudiant(filiereId, i, message) {
  const r = await api("GET", `/inscriptions-univ/${i.id}/releve`);
  const f = droits.includes("universite.notes");
  vue(
    h("div", { class: "actions pas-imprimer" }, h("button", { class: "discret", onclick: () => ecranFiliere(filiereId) }, "← Filière"), h("button", { class: "discret", onclick: () => window.print() }, "Imprimer le relevé"),
      droits.includes("universite.gerer") ? h("button", { onclick: async () => voirTitre("Diplôme", await api("POST", `/inscriptions-univ/${i.id}/diplome`), () => ecranFiliere(filiereId)) }, "Délivrer le diplôme") : null),
    message ? h("div", { class: "succes pas-imprimer", role: "status" }, message) : null,
    h("div", { class: "document" }, h("h2", {}, "Relevé de notes"), h("p", {}, `${r.etudiant} · ${r.matricule} · ${r.filiere} · ${r.annee}`),
      h("div", { class: "defilant" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "UE"), h("th", { class: "nombre" }, "Crédits"), h("th", { class: "nombre" }, "Normale"), h("th", { class: "nombre" }, "Rattrapage"))),
        h("tbody", {}, r.lignes.map((l) => h("tr", {}, h("td", {}, `${l.code} ${l.nom}`), h("td", { class: "nombre" }, String(l.credits)), h("td", { class: "nombre" }, l.normale ?? "-"), h("td", { class: "nombre" }, l.rattrapage ?? "-")))))),
      h("p", { class: "totaux" }, `Moyenne : ${r.moyenne ?? "-"}/20`), h("p", { class: "totaux grand" }, `Crédits : ${r.creditsAcquis} sur ${r.credits_requis}`)),
    f ? h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Saisir une note"), formulaire(async (v) => {
      await api("PUT", "/notes-univ", { inscriptionId: i.id, ueId: v.ueId, session: v.session, note: Number(v.note) });
      ecranEtudiant(filiereId, i, "Note enregistrée.");
    }, [h("div", { class: "grille" }, choix("ueId", "UE", r.lignes.map((l) => [l.ue_id, `${l.code} ${l.nom}`])), choix("session", "Session", [["normale", "Normale"], ["rattrapage", "Rattrapage"]]), champ("Note sur 20", { name: "note", type: "number", min: 0, max: 20, step: 0.01, required: true }))], "Enregistrer la note")) : null,
  );
}
