"use strict";
async function ecranAvis(id, s, message) {
  const peutGerer = droits.includes("formations.gerer");
  const [r, liens] = await Promise.all([
    api("GET", `/sessions/${id}/avis`),
    peutGerer ? api("GET", `/sessions/${id}/avis/demandes`) : [],
  ]);
  const chiffre = (valeur, texte) => h("div", { class: "chiffre" }, h("b", {}, valeur ?? "–"), h("span", {}, texte));
  const peutModerer = droits.includes("avis.moderer");
  const relire = (m) => ecranAvis(id, s, m);
  vue(
    h("button", { class: "discret", onclick: () => ecranSession(id) }, "← Retour à la session"),
    h("h1", {}, "Avis et satisfaction"),
    h("p", { class: "discret-texte" }, s.code),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "chiffres" },
      chiffre(r.reponses, `Réponses${r.taux_reponse === null ? "" : `, ${r.taux_reponse} %`}`),
      chiffre(r.globale, "Note globale sur 5"), chiffre(r.contenu, "Contenu"),
      chiffre(r.formateur, "Formateur"), chiffre(r.organisation, "Organisation"),
      chiffre(r.recommande === null ? null : `${r.recommande} %`, "Recommandent"),
      chiffre(r.notes_basses, "Notes de 1 ou 2")),
    h("div", { class: "carte" }, h("h2", {}, "Commentaires"),
      r.commentaires.length ? r.commentaires.map((c) => h("div", { class: "apprenant" },
        c.commentaire_masque
          ? h("div", { class: "discret-texte" }, `Commentaire masqué. Motif : ${c.motif_masquage}`)
          : h("div", {}, `${c.note_globale}/5 : ${c.commentaire}`),
        peutModerer ? (c.commentaire_masque
          ? h("button", { class: "discret", onclick: async () => { await api("POST", `/avis/${c.id}/moderation`, { masquer: false }); relire("Commentaire rétabli."); } }, "Rétablir")
          : h("details", {}, h("summary", {}, "Masquer ce commentaire"), formulaire(async (v) => {
            await api("POST", `/avis/${c.id}/moderation`, { masquer: true, motif: v.motif.trim() });
            relire("Commentaire masqué. Ses notes restent comptées.");
          }, [champ("Motif (propos injurieux, coordonnées…)", { name: "motif", required: true, minlength: 5 })], "Confirmer"))) : null))
        : h("p", { class: "discret-texte" }, "Aucun commentaire.")),
    peutGerer ? h("div", { class: "carte" }, h("h2", {}, "Liens à envoyer"),
      h("p", { class: "discret-texte" }, "Chaque apprenant reçoit un lien personnel, utilisable une seule fois."),
      h("button", { onclick: async () => { await api("POST", `/sessions/${id}/avis/demandes`); relire("Liens créés."); } }, "Créer les liens manquants"),
      liens.map((l) => h("div", { class: "apprenant ligne" },
        h("span", {}, l.nom),
        l.repondu ? h("span", { class: "pastille ok" }, "A répondu") : h("span", { class: "actions" },
          l.telephone ? h("a", { class: "lien-bouton", target: "_blank", rel: "noopener", href: `https://wa.me/${l.telephone}?text=${encodeURIComponent(`Bonjour, merci de donner votre avis sur la formation : ${l.lien}`)}` }, "Envoyer sur WhatsApp") : null,
          h("button", { class: "discret", onclick: async (e) => { await navigator.clipboard.writeText(l.lien); e.target.textContent = "Copié"; } }, "Copier le lien"))))) : null,
  );
}

const valeurKpi = (k) => {
  if (k.valeur === null) return "–";
  if (k.unite === "fcfa") return fcfa(k.valeur);
  if (k.unite === "pourcent") return `${k.valeur} %`;
  if (k.unite === "note") return `${k.valeur}/5`;
  if (k.unite === "heures") return `${k.valeur} h`;
  return String(k.valeur);
};

async function ecranIndicateurs(periode = {}) {
  // GTA et GLOMARI ne se mélangent pas : avec les deux espaces, l'écran se limite à la branche de l'espace choisi.
  const branche = await brancheEspace();
  const toutes = droits.includes("entites.voir") ? await api("GET", "/entites") : [];
  const dansBranche = (e) => { for (let x = e; x; x = toutes.find((y) => y.id === x.parent_id)) if (x.id === branche) return true; return false; };
  const entites = branche ? toutes.filter(dansBranche) : toutes;
  if (branche && !entites.some((e) => e.id === periode.entiteId)) periode = { ...periode, entiteId: branche };
  const q = new URLSearchParams(Object.entries(periode).filter(([, v]) => v));
  const d = await api("GET", `/tableau-de-bord${q.size ? `?${q}` : ""}`);
  vue(
    h("h1", {}, "Indicateurs"),
    h("p", { class: "discret-texte" }, `Du ${dateFr(d.debut)} au ${dateFr(d.fin)}. Touchez un indicateur pour voir son calcul.`),
    h("div", { class: "carte pas-imprimer" }, formulaire(async (v) => ecranIndicateurs(v), [h("div", { class: "grille" },
      champ("Du", { name: "debut", type: "date", value: d.debut, required: true }),
      champ("Au", { name: "fin", type: "date", value: d.fin, required: true }),
      entites.length ? h("label", {}, "Entité", h("select", { name: "entiteId" }, branche ? null : h("option", { value: "" }, "Toutes mes entités"),
        entites.map((e) => h("option", { value: e.id, selected: e.id === periode.entiteId }, e.nom)))) : null)], "Afficher")),
    d.sections.length ? d.sections.map((s) => h("section", {}, h("h2", {}, s.libelle),
      h("div", { class: "chiffres" }, s.indicateurs.map((k) => h("details", { class: "chiffre" },
        h("summary", {}, h("b", {}, valeurKpi(k)), h("span", {}, k.libelle)),
        h("p", { class: "discret-texte" }, k.definition))))))
      : h("p", { class: "discret-texte" }, "Aucun indicateur n'est disponible pour vos droits."),
  );
}

/** Choisit une fiche existante, ou en crée une à partir du nom saisi. */
async function ficheParNom(zone, nom, suite, entiteId) {
  const trouves = await api("GET", `/tiers?q=${encodeURIComponent(nom)}&entiteId=${entiteId}`);
  const exact = trouves.filter((t) => t.nom.toLowerCase() === nom.toLowerCase());
  if (exact.length === 1) return suite(exact[0].id);
  return suite((await api("POST", "/tiers", { type: "personne", nom, ignorerDoublons: true, entiteId })).id);
}

async function ecranMentorats(message) {
  const [liste, entites] = await Promise.all([api("GET", "/mentorats"), entitesPour("mentorat")]);
  vue(
    h("h1", {}, "Mentorat"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, liste.length ? liste.map((m) => h("button", { class: "session", onclick: () => ecranMentorat(m.id) },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${m.mentore}, avec ${m.mentor}`), h("span", { class: m.statut === "actif" ? "pastille ok" : "pastille attente" }, m.statut)),
      h("div", { class: "discret-texte" }, `${m.objectif} · ${m.seances} séance(s)${m.derniere_seance ? `, dernière le ${dateFr(m.derniere_seance)}` : ""}`)))
      : h("p", { class: "discret-texte" }, "Aucun mentorat pour le moment.")),
    droits.includes("mentorat.gerer") && entites.length ? h("div", { class: "carte" }, h("h2", {}, "Nouveau mentorat"), formulaire(async (v, f, zone) => {
      await ficheParNom(zone, v.mentor.trim(), async (mentorId) => {
        await ficheParNom(zone, v.mentore.trim(), async (mentoreId) => {
          await api("POST", "/mentorats", { entiteId: v.entiteId, mentorId, mentoreId, objectif: v.objectif.trim(), debut: v.debut });
          ecranMentorats("Mentorat créé.");
        }, v.entiteId);
      }, v.entiteId);
    }, [h("div", { class: "grille" },
      champ("Mentor (nom complet)", { name: "mentor", required: true }),
      champ("Mentoré (nom complet)", { name: "mentore", required: true }),
      champ("Objectif", { name: "objectif", required: true }),
      champ("Début", { name: "debut", type: "date", value: aujourdhui(), required: true }),
      choix("entiteId", "Entité", entites)),
    ], "Créer le mentorat")) : null,
  );
}

async function ecranMentorat(id, message) {
  const m = await api("GET", `/mentorats/${id}`);
  const gere = droits.includes("mentorat.gerer");
  vue(
    h("button", { class: "discret", onclick: () => ecranMentorats() }, "← Tous les mentorats"),
    h("h1", {}, `${m.mentore}, avec ${m.mentor}`),
    h("p", { class: "discret-texte" }, `${m.objectif} · Depuis le ${dateFr(m.debut)} · ${m.statut}`),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, h("h2", {}, "Séances"), m.seances.length ? m.seances.map((s) => h("div", { class: "apprenant" },
      h("div", { class: "nom" }, `${dateFr(s.date_seance)}${s.progres ? `, progrès ${s.progres}/5` : ""}`),
      s.compte_rendu ? h("div", {}, s.compte_rendu) : h("div", { class: "discret-texte" }, "Compte rendu confidentiel."),
      s.prochaine_action ? h("div", { class: "discret-texte" }, `Prochaine action : ${s.prochaine_action}`) : null))
      : h("p", { class: "discret-texte" }, "Aucune séance.")),
    gere && m.statut === "actif" ? h("div", { class: "carte" }, h("h2", {}, "Ajouter une séance"), formulaire(async (v) => {
      await api("POST", `/mentorats/${id}/seances`, {
        date: v.date, compteRendu: v.compteRendu.trim(), progres: v.progres ? Number(v.progres) : undefined,
        prochaineAction: v.action.trim() || undefined,
      });
      ecranMentorat(id, "Séance enregistrée.");
    }, [h("div", { class: "grille" },
      champ("Date", { name: "date", type: "date", value: aujourdhui(), required: true }),
      champ("Progrès de 1 à 5", { name: "progres", type: "number", min: 1, max: 5 }),
      champ("Prochaine action", { name: "action" })),
      h("label", {}, "Compte rendu", h("textarea", { name: "compteRendu", rows: 3, required: true })),
    ], "Enregistrer la séance")) : null,
    gere ? h("div", { class: "actions" }, m.statut === "actif"
      ? [h("button", { class: "discret", onclick: async () => { await api("PATCH", `/mentorats/${id}`, { statut: "termine", fin: aujourdhui() }); ecranMentorat(id, "Mentorat terminé."); } }, "Terminer le mentorat")]
      : [h("button", { class: "discret", onclick: async () => { await api("PATCH", `/mentorats/${id}`, { statut: "actif", fin: null }); ecranMentorat(id, "Mentorat réactivé."); } }, "Réactiver")]) : null,
  );
}

async function ecranFoundation(message) {
  const [projets, entites] = await Promise.all([api("GET", "/projets-sociaux"), entitesPour("foundation")]);
  vue(
    h("h1", {}, "GTA Foundation"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, projets.length ? projets.map((p) => h("button", { class: "session", onclick: () => ecranProjetFoundation(p.id) },
      h("div", { class: "nom" }, p.nom),
      h("div", { class: "discret-texte" }, `Collecté ${fcfa(p.collecte)} · Distribué ${fcfa(p.distribue)} · ${p.beneficiaires} bénéficiaire(s)`)))
      : h("p", { class: "discret-texte" }, "Aucun projet pour le moment.")),
    droits.includes("foundation.gerer") && entites.length ? h("div", { class: "carte" }, h("h2", {}, "Nouveau projet"), formulaire(async (v) => {
      await api("POST", "/projets-sociaux", {
        entiteId: v.entiteId, nom: v.nom.trim(), description: v.description.trim() || undefined,
        objectifMontant: v.objectif ? Number(v.objectif) : undefined,
      });
      ecranFoundation("Projet créé.");
    }, [h("div", { class: "grille" },
      champ("Nom", { name: "nom", required: true }),
      champ("Objectif (FCFA)", { name: "objectif", type: "number", min: 1 }),
      champ("Description", { name: "description" }),
      choix("entiteId", "Entité", entites)),
    ], "Créer le projet")) : null,
  );
}

async function ecranProjetFoundation(id, message) {
  const gere = droits.includes("foundation.gerer");
  const [r, d] = await Promise.all([
    api("GET", `/projets-sociaux/${id}/rapport`),
    gere ? api("GET", `/projets-sociaux/${id}/detail`) : { dons: [], aides: [] },
  ]);
  const annuler = (url, texte) => h("details", {}, h("summary", {}, "Annuler"), formulaire(async (v) => {
    await api("POST", url, { motif: v.motif.trim() });
    ecranProjetFoundation(id, texte);
  }, [champ("Motif (obligatoire)", { name: "motif", required: true, minlength: 5 })], "Confirmer"));
  const chiffre = (valeur, texte) => h("div", { class: "chiffre" }, h("b", {}, valeur), h("span", {}, texte));
  vue(
    h("div", { class: "actions pas-imprimer" },
      h("button", { class: "discret", onclick: () => ecranFoundation() }, "← Tous les projets"),
      h("button", { class: "discret", onclick: () => window.print() }, "Imprimer le rapport")),
    h("h1", {}, r.nom),
    r.description ? h("p", {}, r.description) : null,
    message ? h("div", { class: "succes pas-imprimer", role: "status" }, message) : null,
    h("div", { class: "chiffres" },
      chiffre(fcfa(r.collecte), r.objectif ? `Collecté, ${r.atteinte_objectif} % de l'objectif` : "Collecté"),
      chiffre(fcfa(r.distribue), "Distribué"), chiffre(fcfa(r.disponible), "Disponible"), chiffre(r.beneficiaires, "Bénéficiaires")),
    gere ? [
      h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Enregistrer un don"), formulaire(async (v, f, zone) => {
        const enregistrer = async (donateurId) => {
          await api("POST", `/projets-sociaux/${id}/dons`, {
            montant: Number(v.montant), moyen: v.moyen, reference: v.reference.trim() || undefined, donateurId,
          });
          ecranProjetFoundation(id, "Don enregistré.");
        };
        if (v.donateur.trim()) await ficheParNom(zone, v.donateur.trim(), enregistrer, r.entite_id); else await enregistrer();
      }, [h("div", { class: "grille" },
        champ("Montant (FCFA)", { name: "montant", type: "number", min: 1, required: true }),
        choix("moyen", "Moyen", [["especes", "Espèces"], ["mtn_momo", "MTN Mobile Money"], ["orange_money", "Orange Money"], ["virement", "Virement"], ["cheque", "Chèque"], ["carte", "Carte"], ["nature", "En nature"]]),
        champ("Référence (sauf espèces et nature)", { name: "reference" }),
        champ("Donateur (vide : anonyme)", { name: "donateur" })),
      ], "Enregistrer le don")),
      h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Enregistrer une aide"), formulaire(async (v, f, zone) => {
        await ficheParNom(zone, v.beneficiaire.trim(), async (beneficiaireId) => {
          await api("POST", `/projets-sociaux/${id}/aides`, {
            beneficiaireId, description: v.description.trim(), date: v.date, montant: v.montant ? Number(v.montant) : 0,
          });
          ecranProjetFoundation(id, "Aide enregistrée.");
        }, r.entite_id);
      }, [h("div", { class: "grille" },
        champ("Bénéficiaire (nom complet)", { name: "beneficiaire", required: true }),
        champ("Aide apportée", { name: "description", required: true }),
        champ("Montant (FCFA, 0 si en nature)", { name: "montant", type: "number", min: 0 }),
        champ("Date", { name: "date", type: "date", value: aujourdhui(), required: true })),
      ], "Enregistrer l'aide")),
      h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Dons"), d.dons.length ? d.dons.map((x) => h("div", { class: "apprenant" },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, `${x.numero_recu} : ${fcfa(x.montant)}`), x.annule_le ? h("span", { class: "pastille retard" }, "Annulé") : null),
        h("div", { class: "discret-texte" }, `${x.donateur || "Anonyme"} · ${x.moyen} · ${heure(x.encaisse_le)}${x.motif_annulation ? ` · Motif : ${x.motif_annulation}` : ""}`),
        x.annule_le ? null : annuler(`/dons/${x.id}/annulation`, "Don annulé."))) : h("p", { class: "discret-texte" }, "Aucun don.")),
      h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Bénéficiaires"), d.aides.length ? d.aides.map((x) => h("div", { class: "apprenant" },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, x.beneficiaire), x.annule_le ? h("span", { class: "pastille retard" }, "Annulée") : h("span", {}, fcfa(x.montant))),
        h("div", { class: "discret-texte" }, `${x.description} · ${dateFr(x.date_aide)}${x.motif_annulation ? ` · Motif : ${x.motif_annulation}` : ""}`),
        x.annule_le ? null : annuler(`/aides/${x.id}/annulation`, "Aide annulée."))) : h("p", { class: "discret-texte" }, "Aucune aide.")),
    ] : null,
  );
}
