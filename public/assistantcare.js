"use strict";

const STATUTS_ASSISTANT_CARE = [["ouverte", "Ouverte"], ["close", "Close"], ["transmise", "Transmise"]];

function filAssistantCare(messages) {
  return h("section", { class: "carte" }, h("h2", {}, "Conversation avec l’assistant"),
    messages.map((m) => h("div", { class: "apprenant" },
      h("div", { class: "discret-texte" }, m.role === "assistant" ? "Assistant" : "Visiteur",
        ` · ${heure(m.cree_le)}`, m.sans_reponse ? " · Sans réponse" : ""),
      h("div", { class: "contenu" }, m.contenu))));
}

async function branchesStudioCommerce() {
  const entites = await api("GET", "/entites");
  return entites.filter((e) => e.type === "branche" && e.domaine === "commerce");
}

function datesAssistantCare(filtres) {
  return [
    champ("Du", { name: "du", type: "date", value: filtres.du }),
    champ("Au", { name: "au", type: "date", value: filtres.au }),
  ];
}

function formulaireReponseCare(branche, reponse, relire) {
  return formulaire(async (v) => {
    if (reponse) await api("PATCH", `/care/reponses/${reponse.id}`, v);
    else await api("POST", "/care/reponses", { branche, ...v });
    await relire("Réponse enregistrée.");
  }, [
    champ("Sujet", { name: "sujet", required: true, maxlength: 100, value: reponse?.sujet }),
    champ("Question", { name: "question", required: true, minlength: 3, maxlength: 500, value: reponse?.question }),
    h("label", {}, "Réponse", h("textarea", { name: "reponse", required: true, minlength: 3, maxlength: 2000, rows: 4 }, reponse?.reponse)),
  ], "Enregistrer");
}

async function ecranAssistantCare(branche, onglet = "conversations", filtres = {}, message) {
  const branches = await branchesStudioCommerce();
  const b = branches.find((e) => e.id === branche)?.id ?? branches[0]?.id;
  if (!b) return vue(h("h1", {}, "Assistant Care"), h("p", {}, "Aucune branche de commerce."));

  const onglets = [["conversations", "Conversations"]];
  if (droits.includes("care.voir")) onglets.push(["reponses", "Réponses validées"], ["indicateur", "Indicateur"]);
  const q = new URLSearchParams({ branche: b });
  for (const [cle, valeur] of Object.entries(filtres)) if (valeur) q.set(cle, valeur);
  const relire = (avis) => ecranAssistantCare(b, onglet, filtres, avis);
  let corps;
  try {
    const d = await api("GET", `/care/${onglet}?${q}`);
    if (onglet === "reponses") {
      const gere = droits.includes("care.gerer");
      corps = [
        h("p", {}, `${d.actives} réponse(s) active(s). L’assistant reçoit jusqu’à ${d.plafond} réponses par question.`),
        d.actives > d.plafond ? h("div", { class: "alerte-caisse", role: "status" },
          `Plus de ${d.plafond} réponses actives : l’assistant ne lit que les ${d.plafond} modifiées le plus récemment. Désactivez celles qui ne servent plus.`) : null,
        gere ? h("details", { class: "carte" }, h("summary", {}, "Ajouter une réponse"), formulaireReponseCare(b, null, relire)) : null,
        d.reponses.map((r) => h("details", { class: "carte" },
          h("summary", {}, `${r.sujet} · ${r.actif ? "Active" : "Désactivée"}`),
          h("p", {}, r.question), h("p", { class: "contenu" }, r.reponse),
          h("p", { class: "discret-texte" }, `${r.modifie_par || r.auteur} · ${heure(r.modifie_le)}`),
          gere ? [formulaireReponseCare(b, r, relire), formulaire(async () => {
            await api("PATCH", `/care/reponses/${r.id}`, { actif: !r.actif });
            await relire(r.actif ? "Réponse désactivée." : "Réponse activée.");
          }, [], r.actif ? "Désactiver" : "Activer")] : null)),
      ];
    } else {
      const ouvrir = (id) => ecranConversationAssistantCare(id, relire);
      const champs = datesAssistantCare(filtres);
      if (onglet === "conversations") champs.push(
        choix("statut", "Statut", [["", "Tous"], ...STATUTS_ASSISTANT_CARE], filtres.statut || ""),
        h("label", {}, h("input", { type: "checkbox", name: "sans_reponse", value: "true", checked: filtres.sans_reponse === "true" }), " Avec une question sans réponse"));
      corps = [
        formulaire((v) => ecranAssistantCare(b, onglet, v), [h("div", { class: "grille" }, champs)], "Filtrer"),
        onglet === "conversations"
          ? (d.length ? tableau(["Début", "Statut", "Client", "Ticket", "Questions", ""], d.map((v) => h("tr", {},
            h("td", {}, heure(v.cree_le)), h("td", {}, libelle(STATUTS_ASSISTANT_CARE, v.statut)),
            h("td", {}, v.client?.nom || "—"), h("td", {}, v.ticket || "—"),
            h("td", {}, `${v.messages}${v.sans_reponse ? " · Sans réponse" : ""}`),
            h("td", {}, h("button", { class: "discret", onclick: () => ouvrir(v.id) }, "Ouvrir")))))
            : h("p", {}, "Aucune conversation pour cette période."))
          : h("section", { class: "carte" },
            h("p", {}, `Du ${dateFr(d.du)} au ${dateFr(d.au)} · ${d.conversations} conversation(s)`),
            h("ul", {},
              h("li", {}, `Closes sans conseiller · ${d.closes_sans_conseiller} (${d.part_sans_conseiller} %)`),
              h("li", {}, `Transmises · ${d.transmises} (${d.part_transmises} %)`),
              h("li", {}, `Ouvertes · ${d.ouvertes}`),
              h("li", {}, `Avis · ${d.avis.aide} utile(s), ${d.avis.pas_aide} peu utile(s)`)),
            h("h2", {}, "Questions sans réponse"),
            d.sans_reponse.length ? h("ul", {}, d.sans_reponse.map((v) => h("li", {}, v.question,
              ` · ${heure(v.le)} `, h("button", { class: "discret", onclick: () => ouvrir(v.conversation) }, "Ouvrir"))))
              : h("p", {}, "Aucune question sans réponse sur cette période.")),
      ];
    }
  } catch (e) {
    if (e.code !== "permission_refusee" && e.code !== "module_inactif") throw e;
    corps = h("p", { role: "status" }, MESSAGES[e.code]);
  }
  vue(h("h1", {}, "Assistant Care"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    branches.length > 1 ? formulaire((v) => ecranAssistantCare(v.branche, onglet),
      [choix("branche", "Branche", branches.map((e) => [e.id, e.nom]), b)], "Afficher") : null,
    h("nav", { "aria-label": "Assistant Care" }, onglets.map(([id, nom]) =>
      h("button", { class: "discret", "aria-current": onglet === id ? "page" : null, onclick: () => ecranAssistantCare(b, id) }, nom))),
    corps);
}

async function ecranConversationAssistantCare(id, retour) {
  const v = await api("GET", `/care/conversations/${id}`);
  vue(h("button", { class: "discret", onclick: () => retour() }, "← Retour"),
    h("h1", {}, "Conversation"),
    h("p", {}, [libelle(STATUTS_ASSISTANT_CARE, v.statut), v.ticket, v.client?.nom,
      v.client?.telephone, v.commande?.reference].filter(Boolean).join(" · ")),
    filAssistantCare(v.messages));
}
