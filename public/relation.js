"use strict";
const ETAPES = [["nouveau", "Nouveau"], ["contacte", "Contacté"], ["qualifie", "Qualifié"], ["proposition", "Proposition"], ["gagne", "Gagné"], ["perdu", "Perdu"]];
const GENRES = { activite: "Échange", opportunite: "Opportunité", inscription: "Inscription", paiement: "Paiement", ticket: "Ticket" };
const STATUTS_TICKET = [["ouvert", "Ouvert"], ["en_cours", "En cours"], ["resolu", "Résolu"], ["ferme", "Fermé"]];
const libelle = (liste, c) => (liste.find(([k]) => k === c) || [c, c])[1];
const heure = (d) => new Date(d).toLocaleString("fr-FR", { timeZone: "Africa/Douala", dateStyle: "short", timeStyle: "short" });
const choix = (nom, texte, options, valeur) => h("label", {}, texte, h("select", { name: nom }, options.map(([c, l]) => h("option", { value: c, selected: c === valeur }, l))));

/** Entités où le droit s'applique et où le module est actif. */
/** La branche de l'espace choisi. Sans objet pour une personne qui n'a accès qu'à une branche. */
async function brancheEspace() {
  if (!deuxEspaces()) return null;
  const e = await api("GET", "/entites");
  return e.find((x) => x.code === (dansEspace("formation") ? "GTA" : "GLOMARI"))?.id ?? null;
}
async function entitesPour(module) {
  const entites = await api("GET", "/entites");
  const avecModule = await Promise.all(entites.map(async (e) => {
    const m = await api("GET", `/entites/${e.id}/modules`);
    return m.some((x) => x.module === module && x.actif) ? e : null;
  }));
  return avecModule.filter(Boolean).map((e) => [e.id, e.nom]);
}

/** Crée la fiche, ou demande quoi faire si elle semble déjà exister. */
function ficheClient(zone, corps, suite) {
  return api("POST", "/tiers", corps).then((t) => suite(t.id)).catch((e) => {
    if (e.code !== "doublon_probable") throw e;
    const reprendre = (fn) => () => fn().catch((x) => zone.replaceChildren(h("div", { class: "erreur", role: "alert" }, texteErreur(x))));
    zone.replaceChildren(h("div", { class: "erreur" },
      h("p", {}, "Cette personne semble déjà exister. Que voulez-vous faire ?"),
      e.details.map((t) => h("button", { type: "button", class: "discret", onclick: reprendre(() => suite(t.id)) }, `Utiliser ${t.nom}${t.telephone ? ` (${t.telephone})` : ""}`)),
      " ",
      h("button", { type: "button", class: "discret", onclick: reprendre(async () => suite((await api("POST", "/tiers", { ...corps, ignorerDoublons: true })).id)) }, "Créer une nouvelle fiche")));
  });
}

const champsClient = () => [
  champ("Nom du client", { name: "nom", required: true }),
  champ("Téléphone", { name: "telephone", type: "tel" }),
  champ("E-mail", { name: "email", type: "email" }),
];
const corpsClient = (v) => ({ type: "personne", nom: v.nom.trim(), telephone: v.telephone.trim() || undefined, email: v.email.trim() || undefined, entiteId: v.entiteId });

async function ecranClients(message) {
  const [d, entites, b] = await Promise.all([api("GET", "/opportunites"), entitesPour("crm"), brancheEspace()]);
  const tous = await api("GET", "/entites");
  const dansBranche = (id) => { if (!b) return true; for (let x = tous.find((e) => e.id === id); x; x = tous.find((e) => e.id === x.parent_id)) if (x.id === b) return true; return false; };
  d.opportunites = d.opportunites.filter((o) => dansBranche(o.entite_id));
  const peutGerer = droits.includes("crm.gerer");
  vue(
    h("h1", {}, "Suivi commercial"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("p", { class: "discret-texte" }, d.taux_conversion === null ? "Pas encore d'opportunité close." : `Taux de conversion : ${d.taux_conversion} %`),
    h("div", { class: "chiffres" }, d.etapes.map((e) => h("div", { class: "chiffre" }, h("b", {}, e.nombre), h("span", {}, `${libelle(ETAPES, e.etape)}, ${fcfa(e.montant)}`)))),
    h("div", { class: "carte" }, h("h2", {}, "Opportunités"),
      d.opportunites.length ? d.opportunites.map((o) => h("button", { class: "session", onclick: () => ecranOpportunite(o) },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, `${o.client} : ${o.titre}`), h("span", { class: o.etape === "gagne" ? "pastille ok" : o.etape === "perdu" ? "pastille retard" : "pastille attente" }, libelle(ETAPES, o.etape))),
        h("div", { class: "discret-texte" }, `${fcfa(o.montant_estime)}${o.source ? ` · ${o.source}` : ""}${o.responsable ? ` · ${o.responsable}` : ""}`))) : h("p", { class: "discret-texte" }, "Aucune opportunité pour le moment.")),
    peutGerer && entites.length ? h("div", { class: "carte" }, h("h2", {}, "Nouvelle opportunité"),
      formulaire(async (v, f, zone) => {
        await ficheClient(zone, corpsClient(v), async (tiersId) => {
          await api("POST", "/opportunites", {
            entiteId: v.entiteId, tiersId, titre: v.titre.trim(), source: v.source.trim() || undefined,
            montantEstime: v.montant ? Number(v.montant) : 0,
          });
          ecranClients(`Opportunité créée pour ${v.nom.trim()}.`);
        });
      }, [h("div", { class: "grille" },
        ...champsClient(),
        champ("Objet", { name: "titre", required: true }),
        champ("Montant estimé (FCFA)", { name: "montant", type: "number", min: 0 }),
        champ("Source", { name: "source" }),
        choix("entiteId", "Entité", entites)),
      ], "Créer l'opportunité")) : null,
  );
}

async function chronologie(tiersId) {
  const lignes = await api("GET", `/tiers/${tiersId}/chronologie`);
  return h("div", { class: "carte" }, h("h2", {}, "Historique du client"),
    lignes.length ? lignes.map((c) => h("div", { class: "apprenant" },
      h("div", { class: "nom" }, `${GENRES[c.genre] || c.genre} : ${c.libelle}`),
      h("div", { class: "discret-texte" }, `${c.detail} · ${heure(c.quand)}`))) : h("p", { class: "discret-texte" }, "Aucun événement."));
}

function formFiche(t, retour) {
  if (!droits.includes("tiers.modifier")) return null;
  return h("details", { class: "carte" }, h("summary", {}, "Modifier la fiche client"), formulaire(async (v) => {
    await api("PATCH", `/tiers/${t.id}`, { nom: v.nom.trim(), telephone: v.telephone.trim() || null, email: v.email.trim() || null });
    retour();
  }, [h("div", { class: "grille" },
    champ("Nom", { name: "nom", value: t.nom, required: true }),
    champ("Téléphone", { name: "telephone", value: t.telephone || "" }),
    champ("E-mail", { name: "email", type: "email", value: t.email || "" })),
  ], "Enregistrer la fiche"));
}

async function ecranOpportunite(o) {
  const [fiche, histo] = await Promise.all([api("GET", `/tiers/${o.tiers_id}`), chronologie(o.tiers_id)]);
  const recharger = async (message) => {
    const d = await api("GET", "/opportunites");
    const maj = d.opportunites.find((x) => x.id === o.id);
    await ecranOpportunite(maj);
    if (message) racine.querySelector("main").prepend(h("div", { class: "succes", role: "status" }, message));
  };
  vue(
    h("button", { class: "discret", onclick: () => ecranClients() }, "← Toutes les opportunités"),
    h("h1", {}, o.titre),
    h("p", { class: "discret-texte" }, `${fiche.nom}${fiche.telephone ? ` · ${fiche.telephone}` : ""} · ${fcfa(o.montant_estime)} · ${libelle(ETAPES, o.etape)}`),
    o.motif_perte ? h("p", { class: "discret-texte" }, `Motif de perte : ${o.motif_perte}`) : null,
    droits.includes("crm.gerer") ? [
      h("div", { class: "carte" }, h("h2", {}, "Changer d'étape"), formulaire(async (v) => {
        await api("PATCH", `/opportunites/${o.id}`, { etape: v.etape, ...(v.motif.trim() ? { motifPerte: v.motif.trim() } : {}) });
        await recharger("Étape modifiée.");
      }, [choix("etape", "Étape", ETAPES, o.etape), champ("Motif, si perdu", { name: "motif" })], "Enregistrer l'étape")),
      h("div", { class: "carte" }, h("h2", {}, "Noter un échange"), formulaire(async (v) => {
        await api("POST", "/activites", { opportuniteId: o.id, type: v.type, contenu: v.contenu.trim() });
        await recharger("Échange enregistré.");
      }, [choix("type", "Type", [["appel", "Appel"], ["whatsapp", "WhatsApp"], ["email", "E-mail"], ["visite", "Visite"], ["note", "Note"]]), champ("Résumé", { name: "contenu", required: true })], "Enregistrer l'échange")),
    ] : null,
    formFiche(fiche, () => recharger("Fiche modifiée.")),
    histo,
  );
}

const pastilleTicket = (k) => k.en_retard ? h("span", { class: "pastille retard" }, "En retard")
  : h("span", { class: ["resolu", "ferme"].includes(k.statut) ? "pastille ok" : "pastille attente" }, libelle(STATUTS_TICKET, k.statut));

async function ecranSupport(message) {
  const [tickets, entites] = await Promise.all([api("GET", "/tickets"), entitesPour("support")]);
  vue(
    h("h1", {}, "Service client"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, h("h2", {}, "Tickets"),
      tickets.length ? tickets.map((k) => h("button", { class: "session", onclick: () => ecranTicket(k.id) },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, `${k.numero} : ${k.sujet}`), pastilleTicket(k)),
        h("div", { class: "discret-texte" }, `${k.client} · ${k.canal} · À traiter avant ${heure(k.echeance)}${k.assigne ? ` · ${k.assigne}` : ""}`))) : h("p", { class: "discret-texte" }, "Aucun ticket.")),
    droits.includes("support.gerer") && entites.length ? h("div", { class: "carte" }, h("h2", {}, "Nouveau ticket"),
      formulaire(async (v, f, zone) => {
        await ficheClient(zone, corpsClient(v), async (tiersId) => {
          const k = await api("POST", "/tickets", {
            entiteId: v.entiteId, tiersId, sujet: v.sujet.trim(), message: v.message.trim(), canal: v.canal, priorite: v.priorite,
          });
          ecranTicket(k.id);
        });
      }, [h("div", { class: "grille" },
        ...champsClient(),
        champ("Sujet", { name: "sujet", required: true }),
        choix("canal", "Canal", [["whatsapp", "WhatsApp"], ["telephone", "Téléphone"], ["email", "E-mail"], ["site", "Site"], ["application", "Application"], ["magasin", "Magasin"]]),
        choix("priorite", "Priorité", [["normale", "Normale, 24 h"], ["haute", "Haute, 4 h"], ["basse", "Basse, 72 h"]], "normale"),
        choix("entiteId", "Entité", entites)),
        champ("Message du client", { name: "message", required: true }),
      ], "Créer le ticket")) : null,
  );
}

async function ecranTicket(id, message) {
  const [k, collaborateurs] = await Promise.all([api("GET", `/tickets/${id}`), api("GET", "/collaborateurs")]);
  vue(
    h("button", { class: "discret", onclick: () => ecranSupport() }, "← Tous les tickets"),
    h("h1", {}, `${k.numero} : ${k.sujet}`),
    h("p", { class: "discret-texte" }, `${k.client}${k.telephone ? ` · ${k.telephone}` : ""} · À traiter avant ${heure(k.echeance)} `, pastilleTicket(k)),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, h("h2", {}, "Échanges"), k.messages.map((m) => h("div", { class: "apprenant" },
      h("div", {}, m.contenu), h("div", { class: "discret-texte" }, `${m.auteur} · ${heure(m.cree_le)}`)))),
    droits.includes("support.gerer") ? [
      h("div", { class: "carte" }, h("h2", {}, "Ajouter une réponse"), formulaire(async (v) => {
        await api("POST", `/tickets/${id}/messages`, { contenu: v.contenu.trim() });
        ecranTicket(id, "Réponse enregistrée.");
      }, [champ("Réponse", { name: "contenu", required: true })], "Enregistrer la réponse"),
      h("p", { class: "discret-texte" }, "La réponse est enregistrée ici. Elle n'est pas encore envoyée automatiquement au client.")),
      h("div", { class: "carte" }, h("h2", {}, "Traitement"), formulaire(async (v) => {
        await api("PATCH", `/tickets/${id}`, { statut: v.statut, ...(v.assigneA ? { assigneA: v.assigneA } : {}) });
        ecranTicket(id, "Ticket mis à jour.");
      }, [h("div", { class: "grille" }, choix("statut", "Statut", STATUTS_TICKET, k.statut),
        choix("assigneA", "Responsable", [["", "Non attribué"], ...collaborateurs.map((c) => [c.id, c.nom])], k.assigne_a || ""))], "Mettre à jour")),
    ] : null,
  );
}

async function ecranTaches(message) {
  if (!droits.length) droits = (await api("GET", "/moi")).permissions;
  const gere = droits.includes("taches.gerer");
  const [taches, entites, collaborateurs] = await Promise.all([
    api("GET", "/taches"), gere ? entitesPour("pilotage") : [], gere ? api("GET", "/collaborateurs") : [],
  ]);
  const modifier = (t, statut, texte) => h("button", { class: "discret", onclick: async () => {
    await api("PATCH", `/taches/${t.id}`, { statut });
    ecranTaches(texte);
  } }, statut === "terminee" ? "Terminer" : "Rouvrir");
  vue(
    h("h1", {}, "Tâches"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, taches.length ? taches.map((t) => h("div", { class: "apprenant" },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, t.titre),
        t.en_retard ? h("span", { class: "pastille retard" }, "En retard") : t.statut === "terminee" ? h("span", { class: "pastille ok" }, "Terminée") : t.echeance ? h("span", { class: "pastille attente" }, dateFr(t.echeance)) : null),
      h("div", { class: "discret-texte" }, `${t.assigne}${t.echeance ? ` · Échéance ${dateFr(t.echeance)}` : ""}${t.description ? ` · ${t.description}` : ""}`),
      h("div", { class: "actions" }, t.statut === "terminee" ? modifier(t, "a_faire", "Tâche rouverte.") : modifier(t, "terminee", "Tâche terminée."))))
      : h("p", { class: "discret-texte" }, "Aucune tâche.")),
    gere && entites.length ? h("div", { class: "carte" }, h("h2", {}, "Nouvelle tâche"), formulaire(async (v) => {
      await api("POST", "/taches", {
        entiteId: v.entiteId, titre: v.titre.trim(), assigneA: v.assigneA, echeance: v.echeance || undefined,
        description: v.description.trim() || undefined,
      });
      ecranTaches("Tâche créée.");
    }, [h("div", { class: "grille" },
      champ("Titre", { name: "titre", required: true }),
      choix("assigneA", "Responsable", collaborateurs.map((c) => [c.id, c.nom])),
      champ("Échéance", { name: "echeance", type: "date" }),
      choix("entiteId", "Entité", entites),
      champ("Détails", { name: "description" })),
    ], "Créer la tâche")) : null,
  );
}
