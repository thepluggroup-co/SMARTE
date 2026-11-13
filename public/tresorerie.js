"use strict";
const TYPES_PORTEFEUILLE = [["especes", "Espèces"], ["orange_money", "Orange Money"], ["mtn_momo", "MTN MoMo"], ["banque", "Banque"], ["autre", "Autre"]];

async function ecranTresorerie(message) {
  const gere = droits.includes("tresorerie.gerer");
  // Une personne sans rôle métier (trésorier, comptable) voit tous ses portefeuilles, sans filtre d'espace.
  const domaine = aDroitDe(DROITS_COMMERCE) || aDroitDe(DROITS_FORMATION) ? espaceCourant() : null;
  const [tous, entitesBrutes] = await Promise.all([api("GET", "/portefeuilles"), gere ? api("GET", "/entites") : []]);
  const liste = tous.filter((p) => !domaine || p.domaine === domaine);
  const actifs = liste.filter((p) => p.actif);
  const entites = gere ? await entitesPour("tresorerie") : [];
  const dansEspaceCourant = entites.filter(([id]) => !domaine || entitesBrutes.find((e) => e.id === id)?.domaine === domaine);
  const branche = dansEspaceCourant[0]?.[0];
  const defauts = branche ? await api("GET", `/portefeuilles/defauts?entiteId=${branche}`) : [];
  const total = actifs.reduce((s, p) => s + p.solde, 0);
  // Argent encaissé sans portefeuille par défaut : il attend qu'on dise où il est arrivé.
  const attente = gere ? (await api("GET", "/encaissements-en-attente"))
    .filter((a) => !domaine || entitesBrutes.find((e) => e.id === a.branche)?.domaine === domaine) : [];
  vue(
    h("h1", {}, "Trésorerie"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "chiffres" }, h("div", { class: "chiffre" }, h("b", {}, fcfa(total)), h("span", {}, "Total des portefeuilles"))),
    attente.length ? h("div", { class: "carte" }, h("h2", {}, "Encaissements à placer"),
      h("div", { class: "alerte-caisse" }, `${attente.length} encaissement(s), ${fcfa(attente.reduce((s, a) => s + Number(a.montant), 0))}, sans portefeuille par défaut. Indiquez où l'argent est arrivé.`),
      attente.map((a) => {
        const possibles = actifs.filter((p) => p.branche === a.branche);
        return h("div", { class: "apprenant" },
          h("div", { class: "ligne" }, h("span", { class: "nom" }, a.libelle), h("span", { class: "montant-plus" }, fcfa(a.montant))),
          h("div", { class: "discret-texte" }, `${libelle(MOYENS, a.moyen)} · ${a.entite} · ${heure(a.cree_le)}${a.reference ? ` · ${a.reference}` : ""}`),
          possibles.length ? formulaire(async (v) => {
            await api("POST", `/encaissements-en-attente/${a.id}/affectation`, { portefeuilleId: v.portefeuilleId, parDefaut: v.parDefaut === "on" });
            ecranTresorerie("Encaissement placé dans le portefeuille.");
          }, [choix("portefeuilleId", "Portefeuille", possibles.map((p) => [p.id, p.nom])),
            h("label", { class: "appel" }, h("input", { type: "checkbox", name: "parDefaut" }), `Utiliser aussi ce portefeuille pour les prochains paiements en ${libelle(MOYENS, a.moyen)} à ${a.entite}`)], "Placer")
            : h("p", { class: "discret-texte" }, "Ajoutez d'abord un portefeuille pour cette branche."));
      })) : null,
    h("div", { class: "carte" }, h("h2", {}, "Portefeuilles"), liste.length ? liste.map((p) => h("button", { class: "session", onclick: () => ecranPortefeuille(p.id) },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, p.nom), h("span", { class: "grand" }, fcfa(p.solde))),
      h("div", { class: "discret-texte" }, `${libelle(TYPES_PORTEFEUILLE, p.type)} · ${p.entite}${p.actif ? "" : " · Inactif"}`))) : h("p", { class: "discret-texte" }, "Aucun portefeuille.")),
    branche ? h("div", { class: "actions" }, h("button", { class: "discret", onclick: () => ecranPrevision(branche) }, "Prévision à 30, 60 et 90 jours")) : null,
    gere && actifs.length > 1 ? h("div", { class: "carte" }, h("h2", {}, "Transférer"), formulaire(async (v) => {
      await api("POST", "/portefeuilles/transferts", { deId: v.de, versId: v.vers, montant: Number(v.montant), frais: Number(v.frais || 0), reference: v.reference.trim() || undefined });
      ecranTresorerie("Transfert enregistré.");
    }, [h("div", { class: "grille" }, choix("de", "De", actifs.map((p) => [p.id, `${p.nom} (${fcfa(p.solde)})`])), choix("vers", "Vers", actifs.map((p) => [p.id, p.nom]), actifs[1].id),
      champ("Montant (FCFA)", { name: "montant", type: "number", min: 1, required: true }), champ("Frais de transfert (FCFA)", { name: "frais", type: "number", min: 0 }), champ("Référence", { name: "reference" }))], "Transférer")) : null,
    gere && dansEspaceCourant.length ? h("details", { class: "carte" }, h("summary", {}, "Ajouter un portefeuille"), formulaire(async (v) => {
      await api("POST", "/portefeuilles", { entiteId: v.entiteId, nom: v.nom.trim(), type: v.type, reference: v.reference.trim() || undefined, soldeInitial: Number(v.solde || 0) });
      ecranTresorerie("Portefeuille ajouté.");
    }, [h("div", { class: "grille" }, champ("Nom", { name: "nom", required: true, placeholder: "Orange Money principal" }), choix("type", "Type", TYPES_PORTEFEUILLE), choix("entiteId", "Entité", dansEspaceCourant),
      champ("Numéro ou compte (facultatif)", { name: "reference" }), champ("Solde actuel (FCFA)", { name: "solde", type: "number", min: 0 }))], "Ajouter")) : null,
    gere && branche && actifs.length ? h("details", { class: "carte" }, h("summary", {}, "Où arrivent les encaissements"),
      h("p", { class: "discret-texte" }, "Les reçus, factures et ventes en caisse créditent automatiquement ces portefeuilles. Sans choix, le paiement est enregistré et attend dans « Encaissements à placer »."),
      MOYENS.map(([m, nomMoyen]) => h("label", {}, nomMoyen, h("select", { onchange: async (e) => {
        await api("PUT", "/portefeuilles/defauts", { entiteId: branche, moyen: m, portefeuilleId: e.target.value || null });
        ecranTresorerie(`${nomMoyen} : réglage enregistré.`);
      } }, h("option", { value: "" }, "Aucun portefeuille"), actifs.map((p) => h("option", { value: p.id, selected: defauts.some((d) => d.moyen === m && d.portefeuille_id === p.id) }, p.nom)))))) : null,
  );
}

async function ecranPortefeuille(id, message) {
  const gere = droits.includes("tresorerie.gerer");
  const p = await api("GET", `/portefeuilles/${id}/mouvements`);
  vue(
    h("button", { class: "discret", onclick: () => ecranTresorerie() }, "← Trésorerie"),
    h("h1", {}, p.nom),
    h("p", { class: "grand" }, fcfa(p.solde)),
    p.reference ? h("p", { class: "discret-texte" }, p.reference) : null,
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    gere && p.actif ? h("div", { class: "carte" }, h("h2", {}, "Entrée ou dépense"), formulaire(async (v) => {
      await api("POST", `/portefeuilles/${id}/mouvements`, { sens: v.sens, montant: Number(v.montant), libelle: v.libelle.trim(), reference: v.reference.trim() || undefined });
      ecranPortefeuille(id, "Mouvement enregistré.");
    }, [h("div", { class: "grille" }, choix("sens", "Sens", [["sortie", "Dépense"], ["entree", "Entrée"]]), champ("Montant (FCFA)", { name: "montant", type: "number", min: 1, required: true }),
      champ("Motif", { name: "libelle", required: true, minlength: 3 }), champ("Référence", { name: "reference" }))], "Enregistrer")) : null,
    gere ? h("details", { class: "carte" }, h("summary", {}, "Rapprocher avec le relevé"), h("p", { class: "discret-texte" }, "Une ligne de relevé par ligne : date (AAAA-MM-JJ) ; montant, négatif pour une sortie. Facultatif."), formulaire(async (v, f, zone) => {
      const lignes = v.lignes.split("\n").map((x) => x.trim()).filter(Boolean).map((x) => { const [jour, m] = x.split(";").map((y) => y.trim()); return { jour, montant: Number(m) }; });
      const r = await api("POST", `/portefeuilles/${id}/rapprochement`, { jour: v.jour, soldeReleve: Number(v.solde), lignes: lignes.length ? lignes : undefined });
      zone.replaceChildren(h("div", { class: r.ecart ? "alerte-caisse" : "succes" }, `Relevé ${fcfa(r.solde_releve)}, système ${fcfa(r.solde_systeme)}, écart ${fcfa(r.ecart)}. ${r.correspondances} correspondance(s), ${r.absents_du_systeme.length} ligne(s) absente(s) du système, ${r.absents_du_releve.length} mouvement(s) absent(s) du relevé.`));
    }, [h("div", { class: "grille" }, champ("Date du relevé", { name: "jour", type: "date", value: aujourdhui(), required: true }), champ("Solde du relevé (FCFA)", { name: "solde", type: "number", required: true })), h("label", {}, "Lignes du relevé", h("textarea", { name: "lignes", rows: 4 }))], "Rapprocher")) : null,
    h("div", { class: "carte" }, h("h2", {}, "Mouvements"), p.mouvements.length ? p.mouvements.map((m) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, m.libelle), h("span", { class: m.montant > 0 ? "montant-plus" : "montant-moins" }, `${m.montant > 0 ? "+" : ""}${fcfa(m.montant)}`)),
      h("div", { class: "discret-texte" }, `${heure(m.cree_le)}${m.auteur ? ` · ${m.auteur}` : " · Automatique"}${m.reference ? ` · ${m.reference}` : ""}${m.annule ? " · Annulé" : ""}`),
      gere && !m.annule && ["entree", "sortie", "transfert", "frais"].includes(m.type) ? h("details", {}, h("summary", {}, "Annuler"), formulaire(async (v) => {
        await api("POST", `/mouvements-portefeuille/${m.id}/annulation`, { motif: v.motif.trim() });
        ecranPortefeuille(id, "Mouvement annulé par une écriture inverse.");
      }, [champ("Motif", { name: "motif", required: true, minlength: 5 })], "Confirmer")) : null)) : h("p", { class: "discret-texte" }, "Aucun mouvement.")),
    gere && p.actif ? h("details", { class: "carte" }, h("summary", {}, "Désactiver ce portefeuille"), h("p", { class: "discret-texte" }, "Il doit d'abord être à zéro. Son historique reste conservé."),
      h("button", { class: "danger", onclick: async (e) => {
        try {
          await api("PATCH", `/portefeuilles/${id}`, { actif: false });
          ecranTresorerie("Portefeuille désactivé.");
        } catch (x) {
          e.target.after(h("div", { class: "erreur", role: "alert" }, texteErreur(x)));
        }
      } }, "Désactiver")) : null,
  );
}
