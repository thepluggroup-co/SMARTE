"use strict";
/* Messages aux clients de GLOMARI (lot 4, partie A) : réglages par type, journal des envois, renvoi d'un message raté.
   Le serveur prépare et envoie tout ; le journal ne montre jamais le numéro complet ni le texte du message. */

const STATUTS_MESSAGE_CLIENT = {
  en_attente: ["En attente", "pastille attente"], en_cours: ["En cours", "pastille attente"], envoye: ["Envoyé", "pastille ok"],
  echec: ["Échec", "pastille retard"], sans_numero: ["Sans numéro", "pastille retard"], annule: ["Annulé", "pastille"],
};
const RAISONS_MESSAGE_CLIENT = {
  prestataire: "le prestataire n'a pas accepté l'envoi", sans_numero: "numéro absent ou qui n'est pas un mobile camerounais",
  desactive: "type de message coupé", ne_pas_contacter: "le client ne souhaite pas être contacté", sans_objet: "message devenu sans objet",
};

/** Essai privé : sans vrai SMS, le dernier code de connexion d'un numéro se lit ici. Rien de tel avec un vrai prestataire. */
function blocCodeEssai() {
  const resultat = h("div");
  return h("details", { class: "carte" }, h("summary", {}, "Code d'essai (connexion d'un client, essai privé)"),
    formulaire(async (v) => {
      const r = await api("GET", `/messages/code-essai?telephone=${encodeURIComponent(v.telephone.trim())}`);
      resultat.replaceChildren(h("p", {}, "Dernier code envoyé : ", h("b", {}, r.code), ` (${heure(r.envoye_le)})`));
    }, [champ("Numéro du client", { name: "telephone", type: "tel", required: true })], "Lire le code"), resultat);
}

async function ecranMessagesClients(message, brancheId, filtres = {}) {
  const branches = (await api("GET", "/entites")).filter((e) => e.type === "branche" && e.domaine === "commerce");
  const b = brancheId || branches[0]?.id;
  if (!b) return vue(h("h1", {}, "Messages aux clients"), h("p", { class: "discret-texte" }, "Aucune branche de commerce."));
  const relire = (m) => ecranMessagesClients(m, b, filtres);
  const q = new URLSearchParams({ brancheId: b, ...Object.fromEntries(Object.entries(filtres).filter(([, v]) => v)) });
  const [reglages, journal] = await Promise.all([api("GET", `/messages/reglages?brancheId=${b}`), api("GET", `/messages?${q}`)]);
  const administre = droits.includes("facturation.administrer");
  const renvoie = droits.includes("care.gerer");

  vue(h("h1", {}, "Messages aux clients"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("p", { class: "discret-texte" }, `Les messages partent seuls après chaque étape (colis, précommandes, demande d'avis), entre ${reglages.heures.debut} h et ${reglages.heures.fin} h, heure de Douala. Un message raté est tenté trois fois en une heure.`),
    reglages.prestataire ? null : h("div", { class: "alerte-caisse", role: "status" }, "Aucun prestataire de SMS ni de WhatsApp n'est configuré : les messages attendent dans la file."),
    reglages.prestataire === "factice" ? h("div", { class: "alerte-caisse", role: "status" }, "Prestataire factice : essai privé seulement, aucun message ne part réellement.") : null,
    reglages.prestataire === "factice" && droits.includes("entites.gerer") ? blocCodeEssai() : null,
    branches.length > 1 ? h("div", { class: "carte" }, formulaire(async (v) => ecranMessagesClients(null, v.brancheId),
      [choix("brancheId", "Branche", branches.map((x) => [x.id, x.nom]), b)], "Afficher")) : null,
    h("div", { class: "carte" }, h("h2", {}, "Types de messages"),
      tableau(["Message", "Envoi", "Canal", ""], reglages.types.map((t) => h("tr", {},
        h("td", {}, t.libelle, t.defaut ? h("div", { class: "discret-texte" }, "réglage par défaut") : null),
        h("td", {}, h("span", { class: t.actif ? "pastille ok" : "pastille" }, t.actif ? "Actif" : "Coupé")),
        h("td", {}, t.canal === "whatsapp" ? "WhatsApp" : "SMS"),
        h("td", {}, administre ? h("span", {},
          h("button", { class: "discret", onclick: async () => { await api("PUT", "/messages/reglages", { brancheId: b, type: t.type, actif: !t.actif, canal: t.canal }); relire(t.actif ? "Message coupé." : "Message activé."); } }, t.actif ? "Couper" : "Activer"), " ",
          h("button", { class: "discret", onclick: async () => { await api("PUT", "/messages/reglages", { brancheId: b, type: t.type, actif: t.actif, canal: t.canal === "sms" ? "whatsapp" : "sms" }); relire("Canal changé."); } }, t.canal === "sms" ? "Passer à WhatsApp" : "Passer au SMS"))
          : null)))),
      administre ? null : h("p", { class: "discret-texte" }, "Seule la direction (administration de la boutique en ligne) change ces réglages.")),
    journal.mois.length ? h("div", { class: "carte" }, h("h2", {}, "Ce mois-ci"),
      tableau(["Message", "Canal", "Envoyés", "Échecs", "Sans numéro"], journal.mois.map((x) => h("tr", {},
        h("td", {}, reglages.types.find((t) => t.type === x.type)?.libelle || x.type), h("td", {}, x.canal === "whatsapp" ? "WhatsApp" : x.canal ? "SMS" : ""),
        h("td", { class: "nombre" }, String(x.envoyes)), h("td", { class: "nombre" }, String(x.echecs)), h("td", { class: "nombre" }, String(x.sans_numero)))))) : null,
    h("div", { class: "carte" }, h("h2", {}, "Journal des envois"),
      formulaire(async (v) => ecranMessagesClients(null, b, v), [h("div", { class: "grille" },
        choix("statut", "Statut", [["", "Tous"], ...Object.entries(STATUTS_MESSAGE_CLIENT).map(([k, [l]]) => [k, l])], filtres.statut || ""),
        choix("type", "Message", [["", "Tous"], ...reglages.types.map((t) => [t.type, t.libelle])], filtres.type || ""),
        champ("Du", { name: "du", type: "date", value: filtres.du || "" }), champ("Au", { name: "au", type: "date", value: filtres.au || "" }))], "Filtrer"),
      journal.messages.length ? journal.messages.map((m) => h("div", { class: "apprenant" },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, `${m.libelle}${m.objet ? ` · ${m.objet}` : ""}`),
          h("span", { class: STATUTS_MESSAGE_CLIENT[m.statut][1] }, STATUTS_MESSAGE_CLIENT[m.statut][0])),
        h("div", { class: "discret-texte" }, [`créé le ${heure(m.cree_le)}`, m.envoye_le ? `envoyé le ${heure(m.envoye_le)}` : null,
          m.canal ? (m.canal === "whatsapp" ? "WhatsApp" : "SMS") : null, m.numero_masque, m.tentatives ? `${m.tentatives} tentative(s)` : null,
          m.erreur && m.statut !== "envoye" ? RAISONS_MESSAGE_CLIENT[m.erreur] : null, m.renvoi_de ? "renvoi" : null].filter(Boolean).join(" · ")),
        renvoie && ["echec", "sans_numero"].includes(m.statut) ? h("details", {}, h("summary", {}, "Renvoyer ce message"), formulaire(async (v) => {
          await api("POST", `/messages/${m.id}/renvoi`, v.telephone.trim() ? { telephone: v.telephone.trim() } : {});
          relire("Message remis dans la file : il part au prochain passage.");
        }, [champ("Numéro corrigé (facultatif ; il remplace celui du colis, de la précommande ou du client)", { name: "telephone", type: "tel" })], "Renvoyer")) : null))
        : h("p", { class: "discret-texte" }, "Aucun message pour ces filtres.")));
}
