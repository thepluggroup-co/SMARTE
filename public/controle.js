"use strict";
/* Indicateurs, API, budget et groupe. */
async function ecranKpi(message) {
  const gere = droits.includes("pilotage.gerer");
  const [t, sources, entites] = await Promise.all([api("GET", "/kpi/tableau"), api("GET", "/kpi/sources"), gere ? entitesPour("pilotage") : []]);
  const P = { ok: "pastille ok", alerte: "pastille attente", critique: "pastille retard" };
  vue(h("button", { class: "discret", onclick: () => ecranPilotage() }, "← Pilotage"), h("h1", {}, `Indicateurs ${t.mois}`), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, h("h2", {}, "Suivi"), t.lignes.length ? t.lignes.map((k) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${k.libelle} · ${k.entite}`), h("span", { class: P[k.niveau] }, k.niveau === "ok" ? "Dans la cible" : k.niveau === "alerte" ? "Alerte" : "Critique")),
      h("div", { class: "discret-texte" }, `Réalisé ${nombreFr(k.valeur)}${k.flux ? ` · Estimé en fin de mois ${nombreFr(k.estimee)}` : ""} · Cible ${nombreFr(k.cible)}${k.precedent === null ? "" : ` · Mois précédent ${nombreFr(k.precedent)}`}`))) : h("p", { class: "discret-texte" }, "Aucun indicateur suivi.")),
    h("div", { class: "carte" }, h("h2", {}, "Alertes et recommandations"), t.alertes.length ? t.alertes.map((a) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `${a.libelle} · ${a.entite} · ${a.periode}`), h("span", { class: a.niveau === "critique" ? "pastille retard" : "pastille attente" }, a.statut)),
      h("p", {}, a.recommandation),
      gere && ["nouvelle", "reportee"].includes(a.statut) ? h("div", { class: "actions" }, h("button", { onclick: async () => { await api("POST", `/alertes-kpi/${a.id}/decision`, { decision: "acceptee" }); ecranKpi("Tâche créée."); } }, "Accepter"),
        a.statut === "nouvelle" ? h("button", { class: "discret", onclick: async () => { await api("POST", `/alertes-kpi/${a.id}/decision`, { decision: "reportee" }); ecranKpi("Reportée."); } }, "Reporter") : null,
        h("button", { class: "discret", onclick: async () => { await api("POST", `/alertes-kpi/${a.id}/decision`, { decision: "refusee" }); ecranKpi("Refusée."); } }, "Refuser")) : null)) : h("p", { class: "discret-texte" }, "Aucune alerte.")),
    gere && entites.length ? h("details", { class: "carte" }, h("summary", {}, "Suivre un indicateur"), formulaire(async (v) => {
      await api("POST", "/kpi", { entiteId: v.e, source: v.s, cible: Number(v.c), seuilAlerte: Number(v.a), seuilCritique: Number(v.k) });
      ecranKpi("Indicateur enregistré.");
    }, [h("div", { class: "grille" }, choix("s", "Indicateur", sources.map((x) => [x.code, `${x.libelle}${x.sens === 1 ? " (plus c'est haut, mieux c'est)" : " (plus c'est bas, mieux c'est)"}`])), choix("e", "Entité", entites), champ("Cible", { name: "c", type: "number", step: "any", required: true }), champ("Seuil d'alerte", { name: "a", type: "number", step: "any", required: true }), champ("Seuil critique", { name: "k", type: "number", step: "any", required: true }))], "Enregistrer")) : null);
}

async function ecranApi(message, secret) {
  const [cles, hooks, comptes] = await Promise.all([api("GET", "/cles-api"), api("GET", "/webhooks"), api("GET", "/utilisateurs")]);
  vue(h("button", { class: "discret", onclick: () => ecranPilotage() }, "← Pilotage"), h("h1", {}, "API et webhooks"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    secret ? h("div", { class: "alerte-caisse" }, h("p", {}, "À copier maintenant : cette valeur ne sera plus jamais affichée."), h("code", { class: "secret" }, secret)) : null,
    h("p", {}, h("a", { href: "/api/openapi.json", target: "_blank", rel: "noopener" }, "Description technique de l'API")),
    h("div", { class: "carte" }, h("h2", {}, "Clés d'API"), cles.map((c) => h("div", { class: "ligne apprenant" }, h("span", {}, `${c.nom} · ${c.compte}${c.revoquee_le ? " · Révoquée" : ""}${c.utilisee_le ? ` · Utilisée le ${heure(c.utilisee_le)}` : ""}`), c.revoquee_le ? null : h("button", { class: "danger", onclick: async () => { await api("POST", `/cles-api/${c.id}/revocation`); ecranApi("Clé révoquée."); } }, "Révoquer"))),
      formulaire(async (v) => { const r = await api("POST", "/cles-api", { nom: v.n.trim(), utilisateurId: v.u, expireLe: v.e || undefined }); ecranApi("Clé créée.", r.cle); }, [h("div", { class: "grille" }, champ("Nom", { name: "n", required: true }), choix("u", "Agit avec les droits de", comptes.map((u) => [u.id, u.nom])), champ("Expire le", { name: "e", type: "date" }))], "Créer une clé")),
    h("div", { class: "carte" }, h("h2", {}, "Webhooks"), hooks.map((w) => h("div", { class: "apprenant" }, h("div", { class: "nom" }, `${w.nom} ${w.actif ? "" : "(arrêté)"}`), h("div", { class: "discret-texte" }, `${w.url} · ${w.evenements.join(", ")} · ${w.envoyes} envoyé(s), ${w.en_attente} en attente, ${w.abandonnes} abandonné(s)`), w.actif ? h("button", { class: "discret", onclick: async () => { await api("POST", `/webhooks/${w.id}/arret`); ecranApi("Webhook arrêté."); } }, "Arrêter") : null)),
      formulaire(async (v) => { const r = await api("POST", "/webhooks", { nom: v.n.trim(), url: v.u.trim(), evenements: v.e.split(",").map((x) => x.trim()).filter(Boolean) }); ecranApi("Webhook créé.", r.secret); }, [h("div", { class: "grille" }, champ("Nom", { name: "n", required: true }), champ("Adresse https", { name: "u", type: "url", required: true }), champ("Événements, séparés par des virgules", { name: "e", required: true, placeholder: "colis.livre, vente.comptoir" }))], "Créer un webhook")));
}

async function ecranBudget(b, annee = anneeCompta(), message) {
  const l = await api("GET", `/budgets?brancheId=${b.id}&annee=${annee}`);
  vue(h("h1", {}, `Budget ${annee}`), menuCompta(b, "Budget"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("label", {}, "Année", h("input", { type: "number", value: annee, onchange: (e) => ecranBudget(b, Number(e.target.value)) })),
    h("div", { class: "carte" }, l.length ? l.map((x) => h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", { class: "nom" }, `${x.compte_prefixe} ${x.libelle}`), x.nature === "charge" && x.ecart > 0 ? h("span", { class: "pastille retard" }, "Dépassé") : null), barre(Math.min(x.consomme ?? 0, 100)), h("div", { class: "discret-texte" }, `Réalisé ${fcfa(x.realise)} sur ${fcfa(x.montant)} · Écart ${fcfa(x.ecart)}`))) : h("p", { class: "discret-texte" }, "Aucun budget.")),
    droits.includes("compta.cloturer") ? h("details", { class: "carte" }, h("summary", {}, "Ajouter ou modifier une ligne"), formulaire(async (v) => { await api("PUT", "/budgets", { brancheId: b.id, annee, comptePrefixe: v.c.trim(), libelle: v.l.trim(), montant: Number(v.m) }); ecranBudget(b, annee, "Budget enregistré."); }, [h("div", { class: "grille" }, champ("Début du compte (6 ou 7…)", { name: "c", required: true, pattern: "[67][0-9]{0,11}" }), champ("Libellé", { name: "l", required: true }), champ("Montant annuel (FCFA)", { name: "m", type: "number", min: 0, required: true }))], "Enregistrer")) : null);
}

async function ecranGroupe(b, annee = anneeCompta()) {
  const c = await api("GET", `/compta/cumul-groupe?annee=${annee}`);
  const ligne = (n, x) => h("div", { class: "apprenant" }, h("div", { class: "nom" }, n), h("div", { class: "discret-texte" }, `Chiffre d'affaires ${fcfa(x.chiffre)} · Résultat ${fcfa(x.resultat)} · Trésorerie ${fcfa(x.tresorerie)}`));
  vue(h("h1", {}, `Cumul du groupe ${annee}`), menuCompta(b, "Groupe"), h("label", {}, "Année", h("input", { type: "number", value: annee, onchange: (e) => ecranGroupe(b, Number(e.target.value)) })),
    h("div", { class: "alerte-caisse" }, "Addition des branches accessibles, moins les éliminations saisies par le comptable. Ce ne sont pas des comptes consolidés certifiés."),
    h("div", { class: "carte" }, c.branches.map((x) => ligne(x.nom, x)), ligne("Total", c.groupe)),
    h("div", { class: "carte" }, h("h2", {}, "Éliminations saisies"), c.eliminations.map((e) => h("div", { class: "discret-texte" }, `${e.libelle} · Chiffre d'affaires ${fcfa(e.chiffre)} · Résultat ${fcfa(e.resultat)}`)), h("p", {}, `Après éliminations : chiffre d'affaires ${fcfa(c.apres_eliminations.chiffre)}, résultat ${fcfa(c.apres_eliminations.resultat)}`),
      droits.includes("utilisateurs.gerer") ? formulaire(async (v) => { await api("POST", "/compta/eliminations", { annee, libelle: v.l.trim(), chiffre: Number(v.c), resultat: Number(v.r) }); ecranGroupe(b, annee); }, [h("div", { class: "grille" }, champ("Libellé", { name: "l", required: true }), champ("À retirer du chiffre d'affaires", { name: "c", type: "number", value: 0, required: true }), champ("À retirer du résultat", { name: "r", type: "number", value: 0, required: true }))], "Ajouter") : null));
}

async function ecranPrevision(brancheId) {
  const p = await api("GET", `/tresorerie/prevision?brancheId=${brancheId}`);
  vue(h("button", { class: "discret", onclick: () => ecranTresorerie() }, "← Trésorerie"), h("h1", {}, "Prévision de trésorerie"), h("div", { class: "chiffres" }, h("div", { class: "chiffre" }, h("b", {}, fcfa(p.disponible)), h("span", {}, "Disponible"))),
    h("div", { class: "alerte-caisse" }, `Factures clients et fournisseurs, plus une paie estimée à ${fcfa(p.paie_mensuelle)} par mois d'après le dernier mois validé. Impôts et dépenses courantes ne sont pas comptés.`),
    h("div", { class: "carte" }, p.horizons.map((x) => h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", { class: "nom" }, `Sous ${x.jours} jours`), h("span", { class: x.solde < 0 ? "pastille retard" : "pastille ok" }, fcfa(x.solde))), h("div", { class: "discret-texte" }, `À encaisser ${fcfa(x.encaissements)} · À payer ${fcfa(x.decaissements)} · Paie estimée ${fcfa(x.paie)}`)))));
}
