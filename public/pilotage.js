"use strict";
/* Pilotage, livraisons et affiliation. */
const barre = (p) => h("div", { class: "barre-progres", role: "img", "aria-label": `${p} %` }, h("div", { style: `width:${p}%` }));
const NOMS_REGISTRE = [["risque", "Risque"], ["non_conformite", "Non-conformité"], ["incident", "Incident"], ["decision", "Décision"]];

async function ecranPilotage(message) {
  const gere = droits.includes("pilotage.gerer");
  const [projets, registre, entites] = await Promise.all([api("GET", "/projets"), api("GET", "/registre"), gere ? entitesPour("pilotage") : []]);
  vue(h("h1", {}, "Pilotage"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "actions" }, h("button", { class: "discret", onclick: () => ecranKpi() }, "Indicateurs et alertes"), droits.includes("utilisateurs.gerer") ? h("button", { class: "discret", onclick: () => ecranApi() }, "API et webhooks") : null),
    h("div", { class: "carte" }, h("h2", {}, "Objectifs et résultats clés (OKR)"),
      h("p", { class: "discret-texte" }, "Vision du groupe, OKR de branche, d'équipe et individuels par trimestre, point hebdomadaire et feux de couleur."),
      h("div", { class: "actions" }, h("button", { onclick: () => ecranOkr() }, "Ouvrir les OKR"), h("button", { class: "discret", onclick: () => ecranEquipeOkr() }, "Vue équipe"))),
    h("div", { class: "carte" }, h("h2", {}, "Projets"), projets.length ? projets.map((p) => h("button", { class: "session", onclick: () => ecranProjet(p.id) },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, p.nom), p.budget && p.depense > p.budget ? h("span", { class: "pastille retard" }, "Budget dépassé") : null),
      barre(p.taches ? Math.round((p.terminees * 100) / p.taches) : 0), h("div", { class: "discret-texte" }, `${p.entite} · ${p.terminees}/${p.taches} tâches · ${fcfa(p.depense)}${p.budget ? ` sur ${fcfa(p.budget)}` : ""}`))) : h("p", { class: "discret-texte" }, "Aucun projet.")),
    gere && entites.length ? h("details", { class: "carte" }, h("summary", {}, "Nouveau projet"), formulaire(async (v) => {
      const p = await api("POST", "/projets", { entiteId: v.entiteId, nom: v.nom.trim(), responsable: v.responsable.trim() || undefined, debut: v.debut || undefined, fin: v.fin || undefined, budget: Number(v.budget || 0) });
      ecranProjet(p.id, "Projet créé.");
    }, [h("div", { class: "grille" }, champ("Nom", { name: "nom", required: true }), choix("entiteId", "Entité", entites), champ("Responsable", { name: "responsable" }), champ("Début", { name: "debut", type: "date" }), champ("Fin", { name: "fin", type: "date" }), champ("Budget (FCFA)", { name: "budget", type: "number", min: 0 }))], "Créer")) : null,
    h("div", { class: "carte" }, h("h2", {}, "Risques, qualité et décisions"), registre.length ? registre.map((r) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${libelle(NOMS_REGISTRE, r.type)} : ${r.titre}`), r.score ? h("span", { class: r.score >= 15 ? "pastille retard" : "pastille attente" }, `Score ${r.score}`) : null),
      h("div", { class: "discret-texte" }, `${r.entite} · ${r.statut}${r.responsable ? ` · ${r.responsable}` : ""}${r.echeance ? ` · Échéance ${dateFr(r.echeance)}` : ""}${r.plan_action ? ` · ${r.plan_action}` : ""}`),
      gere && r.statut !== "clos" ? h("button", { class: "discret", onclick: async () => { await api("PATCH", `/registre/${r.id}`, { statut: "clos" }); ecranPilotage("Point clos."); } }, "Clore") : null)) : h("p", { class: "discret-texte" }, "Aucun point.")),
    gere && entites.length ? h("details", { class: "carte" }, h("summary", {}, "Ajouter au registre"), formulaire(async (v) => {
      await api("POST", "/registre", { entiteId: v.entiteId, type: v.type, titre: v.titre.trim(), probabilite: v.p ? Number(v.p) : undefined, impact: v.i ? Number(v.i) : undefined, planAction: v.plan.trim() || undefined, responsable: v.responsable.trim() || undefined, echeance: v.echeance || undefined });
      ecranPilotage("Point ajouté.");
    }, [h("div", { class: "grille" }, choix("type", "Type", NOMS_REGISTRE), champ("Titre", { name: "titre", required: true }), choix("entiteId", "Entité", entites), champ("Probabilité (1 à 5, pour un risque)", { name: "p", type: "number", min: 1, max: 5 }), champ("Impact (1 à 5, pour un risque)", { name: "i", type: "number", min: 1, max: 5 }), champ("Plan d'action", { name: "plan" }), champ("Responsable", { name: "responsable" }), champ("Échéance", { name: "echeance", type: "date" }))], "Ajouter")) : null);
}

async function ecranProjet(id, message) {
  const gere = droits.includes("pilotage.gerer");
  const p = await api("GET", `/projets/${id}`);
  vue(h("button", { class: "discret", onclick: () => ecranPilotage() }, "← Pilotage"), h("h1", {}, p.nom), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "chiffres" }, h("div", { class: "chiffre" }, h("b", {}, fcfa(p.depense)), h("span", {}, p.budget ? `sur ${fcfa(p.budget)}` : "Dépensé")), h("div", { class: "chiffre" }, h("b", {}, `${Math.round(p.taches.reduce((s, t) => s + t.minutes, 0) / 60)} h`), h("span", {}, "Temps passé"))),
    h("div", { class: "carte" }, h("h2", {}, "Tâches et jalons"), p.taches.length ? p.taches.map((t) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${t.jalon ? "Jalon : " : ""}${t.titre}`), h("span", { class: t.statut === "termine" ? "pastille ok" : t.fin && t.fin < aujourdhui() ? "pastille retard" : "pastille attente" }, { a_faire: "À faire", en_cours: "En cours", termine: "Terminé" }[t.statut])),
      h("div", { class: "discret-texte" }, `${t.responsable || ""}${t.debut ? ` · ${dateFr(t.debut)}` : ""}${t.fin ? ` → ${dateFr(t.fin)}` : ""} · ${Math.round(t.minutes / 60 * 10) / 10} h`),
      gere ? h("div", { class: "actions" }, t.statut !== "termine" ? h("button", { class: "discret", onclick: async () => { await api("PATCH", `/taches-projet/${t.id}`, { statut: t.statut === "a_faire" ? "en_cours" : "termine" }); ecranProjet(id); } }, t.statut === "a_faire" ? "Commencer" : "Terminer") : null,
        h("details", {}, h("summary", {}, "Temps"), formulaire(async (v) => { await api("POST", `/taches-projet/${t.id}/temps`, { jour: v.jour, minutes: Math.round(Number(v.heures) * 60) }); ecranProjet(id, "Temps ajouté."); }, [champ("Jour", { name: "jour", type: "date", value: aujourdhui(), required: true }), champ("Heures", { name: "heures", type: "number", min: 0.1, step: 0.1, required: true })], "Ajouter"))) : null)) : h("p", { class: "discret-texte" }, "Aucune tâche.")),
    gere ? h("details", { class: "carte" }, h("summary", {}, "Ajouter une tâche"), formulaire(async (v) => { await api("POST", `/projets/${id}/taches`, { titre: v.titre.trim(), responsable: v.responsable.trim() || undefined, debut: v.debut || undefined, fin: v.fin || undefined, jalon: v.jalon === "oui" }); ecranProjet(id, "Tâche ajoutée."); },
      [h("div", { class: "grille" }, champ("Titre", { name: "titre", required: true }), champ("Responsable", { name: "responsable" }), champ("Début", { name: "debut", type: "date" }), champ("Fin", { name: "fin", type: "date" }), choix("jalon", "Type", [["non", "Tâche"], ["oui", "Jalon"]]))], "Ajouter")) : null,
    gere ? h("details", { class: "carte" }, h("summary", {}, "Ajouter une dépense"), formulaire(async (v) => { const r = await api("POST", `/projets/${id}/depenses`, { libelle: v.libelle.trim(), montant: Number(v.montant), jour: v.jour }); ecranProjet(id, r.depassement ? "Dépense ajoutée. Attention : budget dépassé." : "Dépense ajoutée."); },
      [h("div", { class: "grille" }, champ("Libellé", { name: "libelle", required: true }), champ("Montant (FCFA)", { name: "montant", type: "number", min: 1, required: true }), champ("Jour", { name: "jour", type: "date", value: aujourdhui(), required: true }))], "Ajouter")) : null);
}

const NOMS_COLIS = { prepare: "Préparé", expedie: "Expédié", en_transit: "En transit", arrive: "Arrivé", en_livraison: "En livraison", livre: "Livré", echec: "Manqué", retour: "Retourné" };

async function ecranLivraisons(message) {
  const gere = droits.includes("transport.gerer");
  const [colis, tournees, vehicules, ind, entites, wallets] = await Promise.all([api("GET", "/colis"), api("GET", "/tournees"), api("GET", "/vehicules"), api("GET", "/transport/indicateurs"), gere ? entitesPour("transport") : [], droits.includes("tresorerie.voir") ? api("GET", "/portefeuilles") : []]);
  const aPlanifier = colis.filter((c) => ["prepare", "expedie", "en_transit", "arrive", "echec"].includes(c.statut));
  vue(h("h1", {}, "Livraisons"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "chiffres" }, h("div", { class: "chiffre" }, h("b", {}, String(ind.total)), h("span", {}, "Colis")), h("div", { class: "chiffre" }, h("b", {}, ind.taux_reussite === null ? "-" : `${ind.taux_reussite} %`), h("span", {}, "Livraisons réussies")), h("div", { class: "chiffre" }, h("b", {}, String(ind.en_retard)), h("span", {}, "Livrés en retard"))),
    h("div", { class: "carte" }, h("h2", {}, "Colis"), colis.length ? colis.map((c) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${c.numero} : ${c.destinataire}`), h("span", { class: c.statut === "livre" ? "pastille ok" : ["echec", "retour"].includes(c.statut) ? "pastille retard" : "pastille attente" }, NOMS_COLIS[c.statut])),
      h("div", { class: "discret-texte" }, `${c.zone || ""}${c.adresse ? ` · ${c.adresse}` : ""}${c.a_encaisser ? ` · À encaisser ${fcfa(c.a_encaisser)}` : ""}${c.prevu_le ? ` · Prévu ${dateFr(c.prevu_le)}` : ""}${c.code_confirmation ? ` · Code client ${c.code_confirmation}` : ""}`),
      c.lien_suivi && c.telephone ? h("a", { class: "lien-bouton", target: "_blank", rel: "noopener", href: `https://wa.me/${c.telephone.replace(/\D/g, "")}?text=${encodeURIComponent(`Bonjour, suivez votre colis : ${c.lien_suivi}\nCode à donner au livreur : ${c.code_confirmation}`)}` }, "Envoyer le suivi") : null,
      droits.includes("transport.livrer") && c.statut === "en_livraison" ? h("details", {}, h("summary", {}, "Confirmer la livraison"), formulaire(async (v) => { await api("POST", `/colis/${c.id}/livraison`, { code: v.code.trim(), recuPar: v.recu.trim(), encaisse: Number(v.encaisse || 0) }); ecranLivraisons("Colis livré."); },
        [h("div", { class: "grille" }, champ("Code du client", { name: "code", required: true, pattern: "[0-9]{6}", inputmode: "numeric" }), champ("Reçu par", { name: "recu", value: c.destinataire, required: true }), champ("Encaissé (FCFA)", { name: "encaisse", type: "number", min: 0, value: c.a_encaisser }))], "Confirmer"),
        formulaire(async (v) => { await api("POST", `/colis/${c.id}/etape`, { statut: "echec", note: v.note.trim() }); ecranLivraisons("Échec enregistré."); }, [champ("Si la livraison a échoué : motif", { name: "note", required: true })], "Enregistrer l'échec")) : null)) : h("p", { class: "discret-texte" }, "Aucun colis.")),
    gere && entites.length ? h("details", { class: "carte" }, h("summary", {}, "Nouveau colis"), formulaire(async (v) => {
      await api("POST", "/colis", { entiteId: v.entiteId, destinataire: v.nom.trim(), telephone: v.telephone.trim() || undefined, adresse: v.adresse.trim() || undefined, aEncaisser: Number(v.encaisse || 0) });
      ecranLivraisons("Colis créé.");
    }, [h("div", { class: "grille" }, champ("Destinataire", { name: "nom", required: true }), champ("Téléphone", { name: "telephone", type: "tel" }), champ("Adresse", { name: "adresse" }), champ("À encaisser à la livraison", { name: "encaisse", type: "number", min: 0 }), choix("entiteId", "Entité", entites))], "Créer")) : null,
    gere && aPlanifier.length ? h("div", { class: "carte" }, h("h2", {}, "Nouvelle tournée"), formulaire(async (v, f) => {
      const ids = [...f.querySelectorAll("input[name=c]:checked")].map((x) => x.value);
      if (!ids.length) throw Object.assign(new Error(), { code: "donnees_invalides" });
      await api("POST", "/tournees", { entiteId: aPlanifier.find((c) => c.id === ids[0]).entite_id, jour: v.jour, livreur: v.livreur.trim(), vehiculeId: v.vehicule || undefined, colis: ids });
      ecranLivraisons("Tournée créée.");
    }, [h("div", { class: "grille" }, champ("Jour", { name: "jour", type: "date", value: aujourdhui(), required: true }), champ("Livreur", { name: "livreur", required: true }), choix("vehicule", "Véhicule", [["", "Aucun"], ...vehicules.map((x) => [x.id, x.immatriculation])])),
      aPlanifier.map((c) => h("label", { class: "choix" }, h("input", { type: "checkbox", name: "c", value: c.id }), ` ${c.numero} : ${c.destinataire}`))], "Créer la tournée")) : null,
    h("div", { class: "carte" }, h("h2", {}, "Tournées"), tournees.length ? tournees.map((t) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${dateFr(t.jour)} : ${t.livreur}`), t.remise_le ? h("span", { class: t.remise_comptee === t.remise_attendue ? "pastille ok" : "pastille retard" }, t.remise_comptee === t.remise_attendue ? "Remise faite" : `Écart ${fcfa(t.remise_comptee - t.remise_attendue)}`) : null),
      h("div", { class: "discret-texte" }, `${t.livres}/${t.colis} livrés · Encaissé ${fcfa(t.encaisse)}`),
      gere && !t.remise_le && wallets.length ? h("details", {}, h("summary", {}, "Remise de caisse"), formulaire(async (v) => { const r = await api("POST", `/tournees/${t.id}/remise`, { portefeuilleId: v.w, compte: Number(v.compte), motif: v.motif.trim() || undefined }); ecranLivraisons(`Remise enregistrée. Écart : ${fcfa(r.ecart)}.`); },
        [h("div", { class: "grille" }, choix("w", "Vers", wallets.filter((w) => w.actif).map((w) => [w.id, w.nom])), champ("Montant compté", { name: "compte", type: "number", min: 0, value: t.encaisse, required: true }), champ("Motif en cas d'écart", { name: "motif" }))], "Enregistrer")) : null)) : h("p", { class: "discret-texte" }, "Aucune tournée.")),
    h("div", { class: "carte" }, h("h2", {}, "Flotte"), vehicules.map((x) => h("div", { class: "apprenant" }, h("div", { class: "nom" }, `${x.immatriculation}${x.modele ? ` ${x.modele}` : ""}`),
      h("div", { class: "discret-texte" }, `Coûts ${fcfa(x.cout)}${x.cout_km ? ` · ${fcfa(x.cout_km)} par km` : ""}${x.prochaine_echeance ? ` · Échéance le ${dateFr(x.prochaine_echeance)}` : ""}`),
      gere ? h("details", {}, h("summary", {}, "Ajouter un frais"), formulaire(async (v) => { await api("POST", `/vehicules/${x.id}/frais`, { type: v.type, montant: Number(v.montant), jour: v.jour, kilometrage: v.km ? Number(v.km) : undefined, echeance: v.echeance || undefined }); ecranLivraisons("Frais ajouté."); },
        [h("div", { class: "grille" }, choix("type", "Type", [["carburant", "Carburant"], ["maintenance", "Maintenance"], ["assurance", "Assurance"], ["document", "Document"], ["autre", "Autre"]]), champ("Montant", { name: "montant", type: "number", min: 0, required: true }), champ("Jour", { name: "jour", type: "date", value: aujourdhui(), required: true }), champ("Kilométrage", { name: "km", type: "number", min: 0 }), champ("Expire le", { name: "echeance", type: "date" }))], "Ajouter")) : null)),
      gere && entites.length ? h("details", {}, h("summary", {}, "Ajouter un véhicule"), formulaire(async (v) => { await api("POST", "/vehicules", { entiteId: v.entiteId, immatriculation: v.immat.trim(), modele: v.modele.trim() || undefined }); ecranLivraisons("Véhicule ajouté."); }, [h("div", { class: "grille" }, champ("Immatriculation", { name: "immat", required: true }), champ("Modèle", { name: "modele" }), choix("entiteId", "Entité", entites))], "Ajouter")) : null));
}

async function ecranAffilies(message) {
  const gere = droits.includes("affiliation.gerer");
  const [affilies, commissions, entites, wallets] = await Promise.all([api("GET", "/affilies"), api("GET", "/affilies/commissions"), gere ? entitesPour("crm") : [], droits.includes("tresorerie.voir") ? api("GET", "/portefeuilles") : []]);
  vue(h("h1", {}, "Affiliés"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, h("h2", {}, "Classement"), affilies.length ? affilies.map((a, i) => h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", { class: "nom" }, `${i + 1}. ${a.nom} (${a.code})`), h("span", {}, `${a.taux} %`)), h("div", { class: "discret-texte" }, `${a.ventes} vente(s) · En attente ${fcfa(a.en_attente)} · À payer ${fcfa(a.a_payer)} · Payé ${fcfa(a.paye)}`))) : h("p", { class: "discret-texte" }, "Aucun affilié.")),
    gere && entites.length ? h("details", { class: "carte" }, h("summary", {}, "Nouvel affilié"), formulaire(async (v, f, zone) => {
      await ficheClient(zone, { type: "personne", nom: v.nom.trim(), telephone: v.telephone.trim() || undefined, entiteId: v.entiteId }, async (tiersId) => {
        await api("POST", "/affilies", { entiteId: v.entiteId, tiersId, code: v.code.trim(), taux: Number(v.taux), joursRetour: Number(v.jours || 0) });
        ecranAffilies("Affilié ajouté.");
      });
    }, [h("div", { class: "grille" }, champ("Nom", { name: "nom", required: true }), champ("Téléphone", { name: "telephone", type: "tel" }), champ("Code", { name: "code", required: true, pattern: "[A-Za-z0-9]{3,20}" }), champ("Commission (%)", { name: "taux", type: "number", min: 0, max: 100, step: 0.01, required: true }), champ("Jours de retour avant validation", { name: "jours", type: "number", min: 0 }), choix("entiteId", "Entité", entites))], "Ajouter")) : null,
    gere && affilies.length ? h("div", { class: "carte" }, h("h2", {}, "Attribuer une vente"), formulaire(async (v) => { const c = await api("POST", "/affilies/ventes", { code: v.code.trim(), numeroFacture: v.facture.trim() }); ecranAffilies(`Commission de ${fcfa(c.montant)} en attente.`); }, [h("div", { class: "grille" }, champ("Code de l'affilié", { name: "code", required: true }), champ("Numéro de la facture", { name: "facture", required: true }))], "Attribuer")) : null,
    h("div", { class: "carte" }, h("h2", {}, "Commissions"), commissions.length ? commissions.map((c) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${c.nom} : ${fcfa(c.montant)}`), h("span", { class: c.statut === "payee" ? "pastille ok" : c.statut === "annulee" ? "pastille retard" : "pastille attente" }, { en_attente: "En attente", validee: "À payer", payee: "Payée", annulee: "Annulée" }[c.statut])),
      h("div", { class: "discret-texte" }, `Facture ${c.facture} · Validable dès le ${dateFr(c.disponible_le)}`),
      gere && c.statut === "en_attente" ? h("button", { class: "discret", onclick: async (e) => { try { await api("POST", `/affilies/commissions/${c.id}/validation`); ecranAffilies("Commission traitée."); } catch (x) { e.target.after(h("div", { class: "erreur", role: "alert" }, texteErreur(x))); } } }, "Valider") : null,
      gere && c.statut === "validee" && wallets.length ? h("details", {}, h("summary", {}, "Payer"), formulaire(async (v) => { await api("POST", `/affilies/commissions/${c.id}/paiement`, { portefeuilleId: v.w, reference: v.r.trim() || undefined }); ecranAffilies("Commission payée."); }, [h("div", { class: "grille" }, choix("w", "Depuis", wallets.filter((w) => w.actif).map((w) => [w.id, `${w.nom} (${fcfa(w.solde)})`])), champ("Référence Mobile Money", { name: "r" }))], "Payer")) : null)) : h("p", { class: "discret-texte" }, "Aucune commission.")));
}
