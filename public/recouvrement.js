"use strict";
/* Recouvrement, prospection, recherche, notifications et compte. */
const NIVEAUX_RELANCE = { avant: "Avant échéance", rappel: "Premier rappel", mise_en_demeure: "Mise en demeure" };
const PORTEES = [["livraison", "Livraison"], ["cours", "Cours en ligne"], ["certificat", "Certificat"]];


async function ecranRecouvrement(message, brancheId) {
  const liste = await entitesPour("facturation");
  const toutes = await api("GET", "/entites");
  const branches = liste.filter(([id]) => { const e = toutes.find((x) => x.id === id); return e && ["GLOMARI", "GTA"].includes(e.code); });
  const id = brancheId || branches.find(([x]) => toutes.find((e) => e.id === x)?.code === (espaceCourant() === "formation" ? "GTA" : "GLOMARI"))?.[0] || branches[0]?.[0] || liste[0]?.[0];
  if (!id) return vue(h("h1", {}, "Recouvrement"), h("p", {}, "Aucune branche accessible."));
  const [t, rel, plans] = await Promise.all([api("GET", `/recouvrement/tableau?brancheId=${id}`), api("GET", `/recouvrement/relances?brancheId=${id}`), api("GET", `/recouvrement/plans?brancheId=${id}`)]);
  const admin = droits.includes("facturation.administrer");
  const gere = droits.includes("facturation.gerer");
  const relire = (m) => ecranRecouvrement(m, id);
  const nombre = (v) => h("td", { class: "nombre" }, Number(v).toLocaleString("fr-FR"));
  const lienWa = (x) => x.telephone ? `https://wa.me/${x.telephone.replace(/\D/g, "")}?text=${encodeURIComponent(x.texte)}` : null;
  const marquer = async (x, canal) => { await api("POST", "/recouvrement/relances", { brancheId: id, sourceType: x.source_type, sourceId: x.source_id, canal }); relire("Relance enregistrée."); };
  vue(h("h1", {}, `Recouvrement : ${fcfa(t.total)}`), message ? h("div", { class: "succes", role: "status" }, message) : null,
    branches.length > 1 ? h("label", {}, "Branche", h("select", { onchange: (e) => ecranRecouvrement(null, e.target.value) }, branches.map(([x, n]) => h("option", { value: x, selected: x === id }, n)))) : null,
    h("div", { class: "actions" }, h("button", { class: "discret", onclick: () => ecranRecurrentes() }, "Factures récurrentes"), admin ? h("button", { class: "discret", onclick: () => ecranModelesRelance(id) }, "Modèles et seuils") : null),
    h("div", { class: "carte" }, h("h2", {}, "Âge des créances"), t.lignes.length ? h("div", { class: "defilant" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Client", "Non échu", "1 à 30 j", "31 à 60 j", "61 à 90 j", "+ de 90 j", "Total", ""].map((c) => h("th", { scope: "col" }, c)))),
      h("tbody", {}, t.lignes.map((l) => h("tr", {}, h("td", {}, l.client), nombre(l.non_echu), nombre(l.j30), nombre(l.j60), nombre(l.j90), nombre(l.plus), nombre(l.total),
        h("td", {}, admin ? h("details", {}, h("summary", {}, l.proposer_blocage ? "Bloquer (proposé)" : "Bloquer"), formulaire(async (v) => { await api("POST", "/recouvrement/blocages", { tiersId: l.tiers_id, portee: v.p, motif: v.m.trim() }); relire("Client bloqué."); }, [choix("p", "Opération", PORTEES), champ("Motif", { name: "m", required: true, minlength: 5 })], "Bloquer")) : null)))))) : h("p", { class: "discret-texte" }, "Aucune créance.")),
    t.programmes.length ? h("div", { class: "carte" }, h("h2", {}, "Par programme"), t.programmes.map((p) => h("div", { class: "ligne" }, h("span", {}, p.nom), h("b", {}, fcfa(p.reste))))) : null,
    h("div", { class: "carte" }, h("h2", {}, `Relances à envoyer (${rel.a_relancer.length})`), h("p", { class: "discret-texte" }, "Aucun message ne part seul. Ouvrez WhatsApp, envoyez, puis confirmez."),
      rel.a_relancer.map((x) => h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", { class: "nom" }, `${x.client} · ${x.reference}`), h("span", { class: x.niveau === "mise_en_demeure" ? "pastille retard" : "pastille attente" }, NIVEAUX_RELANCE[x.niveau])), h("p", {}, x.texte),
        gere ? h("div", { class: "actions" }, lienWa(x) ? h("a", { href: lienWa(x), target: "_blank", rel: "noopener", class: "bouton-lien" }, "Ouvrir WhatsApp") : null, h("button", { onclick: () => marquer(x, "whatsapp") }, "Envoyée par WhatsApp"), h("button", { class: "discret", onclick: () => marquer(x, "appel") }, "Faite par appel")) : null))),
    rel.historique.length ? h("details", { class: "carte" }, h("summary", {}, "Historique des relances"), rel.historique.map((x) => h("div", { class: "discret-texte" }, `${heure(x.cree_le)} · ${x.nom} · ${NIVEAUX_RELANCE[x.niveau]} · ${x.canal} · ${x.auteur}`))) : null,
    h("div", { class: "carte" }, h("h2", {}, "Plans de paiement"), plans.length ? plans.map((p) => h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", { class: "nom" }, `${p.numero} · ${p.client}`), h("span", { class: p.statut === "en_retard" ? "pastille retard" : "pastille ok" }, p.statut === "en_retard" ? `En retard de ${fcfa(p.retard)}` : p.statut === "solde" ? "Soldé" : "À jour")), h("div", { class: "discret-texte" }, `Payé ${fcfa(p.paye)} sur ${fcfa(p.total)} · ${p.echeances.map((e) => `${dateFr(e.jour)} : ${fcfa(e.montant)}`).join(", ")}`), admin ? h("button", { class: "discret", onclick: async () => { await api("POST", `/recouvrement/plans/${p.id}/arret`); relire("Plan arrêté."); } }, "Arrêter le plan") : null)) : h("p", { class: "discret-texte" }, "Aucun plan actif."),
      admin && t.factures.length ? h("details", {}, h("summary", {}, "Négocier un plan"), formulaire(async (v) => {
        const echeances = v.e.split("\n").map((x) => x.trim()).filter(Boolean).map((x) => { const [jour, m] = x.split(";").map((y) => y.trim()); return { jour, montant: Number(m) }; });
        await api("POST", "/recouvrement/plans", { factureId: v.f, motif: v.m.trim(), echeances }); relire("Plan enregistré.");
      }, [choix("f", "Facture", t.factures.map((f) => [f.id, `${f.reference} · ${f.client} · ${fcfa(f.reste)}`])), champ("Motif", { name: "m", required: true, minlength: 5 }), h("label", {}, "Une échéance par ligne : AAAA-MM-JJ ; montant", h("textarea", { name: "e", rows: 4, required: true }))], "Enregistrer")) : null),
    h("div", { class: "carte" }, h("h2", {}, "Blocages en cours"), t.blocages.length ? t.blocages.map((b) => h("div", { class: "ligne apprenant" }, h("span", {}, `${b.nom} · ${PORTEES.find((p) => p[0] === b.portee)[1]} · ${b.motif}`), admin ? h("button", { class: "discret", onclick: async () => { await api("POST", `/recouvrement/blocages/${b.id}/levee`); relire("Blocage levé."); } }, "Lever") : null)) : h("p", { class: "discret-texte" }, "Aucun blocage.")),
    h("div", { class: "carte" }, h("h2", {}, "Créances douteuses et pertes"), t.douteuses.map((d) => h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", { class: "nom" }, `${d.numero} · ${d.nom}`), h("span", { class: d.statut === "perte" ? "pastille retard" : "pastille attente" }, { douteuse: "Douteuse", perte_demandee: "Perte à valider", perte: "Passée en perte" }[d.statut])), h("div", { class: "discret-texte" }, `Provision ${fcfa(d.provision)} · ${d.motif}`),
      d.statut === "douteuse" && admin ? h("details", {}, h("summary", {}, "Demander le passage en perte"), formulaire(async (v) => { await api("POST", `/recouvrement/factures/${d.facture_id}/perte`, { motif: v.m.trim() }); relire("Demande enregistrée."); }, [champ("Motif", { name: "m", required: true, minlength: 5 })], "Demander")) : null,
      d.statut === "perte_demandee" && droits.includes("compta.valider") ? h("button", { onclick: async () => { const r = await api("POST", `/recouvrement/factures/${d.facture_id}/perte/validation`); relire(`Perte de ${fcfa(r.montant)} validée. L'écriture part en brouillon à la prochaine génération.`); } }, "Valider la perte") : null)),
      admin && t.factures.length ? h("details", {}, h("summary", {}, "Déclasser une créance"), formulaire(async (v) => { await api("POST", `/recouvrement/factures/${v.f}/douteuse`, { provision: Number(v.p), motif: v.m.trim() }); relire("Créance déclassée. L'écriture part en brouillon à la prochaine génération."); }, [choix("f", "Facture", t.factures.filter((f) => !t.douteuses.some((d) => d.facture_id === f.id)).map((f) => [f.id, `${f.reference} · ${f.client} · ${fcfa(f.reste)}${f.a_declasser ? " · proposée" : ""}`])), champ("Provision (FCFA)", { name: "p", type: "number", min: 0, required: true }), champ("Motif", { name: "m", required: true, minlength: 5 })], "Déclasser")) : null));
}

async function ecranModelesRelance(id) {
  const p = await api("GET", `/recouvrement/parametres?brancheId=${id}`);
  vue(h("button", { class: "discret", onclick: () => ecranRecouvrement(null, id) }, "← Recouvrement"), h("h1", {}, "Modèles et seuils"),
    h("div", { class: "alerte-caisse" }, "Faites relire la mise en demeure par votre conseil avant de l'utiliser."),
    h("p", { class: "discret-texte" }, "Variables : {client}, {reference}, {reste}, {echeance}. Délai négatif : avant l'échéance."),
    formulaire(async (v) => {
      const modeles = {};
      for (const n of Object.keys(NIVEAUX_RELANCE)) modeles[n] = { decalage: Number(v[`d_${n}`]), fr: v[`fr_${n}`], en: v[`en_${n}`] };
      await api("PUT", "/recouvrement/parametres", { brancheId: id, seuilBlocage: Number(v.b), seuilDouteuse: Number(v.t), modeles });
      ecranRecouvrement("Réglages enregistrés.", id);
    }, [h("div", { class: "grille" }, champ("Proposer le blocage après (jours)", { name: "b", type: "number", min: 1, value: p.seuil_blocage, required: true }), champ("Proposer le déclassement après (jours)", { name: "t", type: "number", min: 1, value: p.seuil_douteuse, required: true })),
      ...Object.entries(NIVEAUX_RELANCE).map(([n, l]) => h("div", { class: "carte" }, h("h2", {}, l), champ("Délai en jours", { name: `d_${n}`, type: "number", value: p.modeles[n].decalage, required: true }), h("label", {}, "Français", h("textarea", { name: `fr_${n}`, rows: 3, required: true }, p.modeles[n].fr)), h("label", {}, "Anglais", h("textarea", { name: `en_${n}`, rows: 3, required: true }, p.modeles[n].en))))], "Enregistrer"));
}

async function ecranRecurrentes(message) {
  const [l, entites, clients, produits] = await Promise.all([api("GET", "/factures-recurrentes"), entitesPour("facturation"), api("GET", "/tiers"), api("GET", "/produits")]);
  const gere = droits.includes("facturation.gerer");
  vue(h("button", { class: "discret", onclick: () => ecranRecouvrement() }, "← Recouvrement"), h("h1", {}, "Factures récurrentes"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    gere ? h("button", { onclick: async () => { const r = await api("POST", "/factures-recurrentes/generation"); ecranRecurrentes(`${r.crees} brouillon(s) créé(s), à contrôler et à émettre dans Facturation.`); } }, "Préparer les factures du mois") : null,
    h("div", { class: "carte" }, l.length ? l.map((r) => h("div", { class: "ligne apprenant" }, h("span", {}, `${r.libelle} · ${r.client} · le ${r.jour} du mois${r.actif ? ` · Prochaine ${dateFr(r.prochaine)}` : " · Arrêtée"}`), r.actif && gere ? h("button", { class: "discret", onclick: async () => { await api("POST", `/factures-recurrentes/${r.id}/arret`); ecranRecurrentes("Arrêtée."); } }, "Arrêter") : null)) : h("p", { class: "discret-texte" }, "Aucun modèle.")),
    gere && produits.length ? h("details", { class: "carte" }, h("summary", {}, "Nouveau modèle"), formulaire(async (v) => {
      await api("POST", "/factures-recurrentes", { entiteId: v.e, tiersId: v.t, libelle: v.l.trim(), jour: Number(v.j), debut: v.d, fin: v.f || undefined, delaiJours: Number(v.a || 0), lignes: [{ produitId: v.p, quantite: Number(v.q) }] });
      ecranRecurrentes("Modèle enregistré.");
    }, [h("div", { class: "grille" }, choix("e", "Entité", entites), choix("t", "Client", clients.map((c) => [c.id, c.nom])), champ("Libellé", { name: "l", required: true }), choix("p", "Produit ou service", produits.filter((p) => p.actif).map((p) => [p.id, p.nom])), champ("Quantité", { name: "q", type: "number", min: 1, value: 1, required: true }), champ("Jour du mois (1 à 28)", { name: "j", type: "number", min: 1, max: 28, value: 1, required: true }), champ("Début", { name: "d", type: "date", value: aujourdhui(), required: true }), champ("Fin, facultative", { name: "f", type: "date" }), champ("Délai de paiement (jours)", { name: "a", type: "number", min: 0, value: 0 }))], "Enregistrer")) : null);
}

async function ecranProspection(message) {
  const [prospects, formulaires, segments, entites] = await Promise.all([api("GET", "/prospects/classement"), api("GET", "/formulaires-capture"), api("GET", "/segments"), entitesPour("crm")]);
  const gere = droits.includes("crm.gerer");
  vue(h("h1", {}, "Prospection"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, h("h2", {}, "Prospects classés"), prospects.length ? prospects.slice(0, 50).map((p) => h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", { class: "nom" }, `${p.nom} · ${p.titre}`), h("b", {}, `${p.score} / 100`)), barre(p.score), h("div", { class: "discret-texte" }, p.raisons.map((r) => `${r.texte} +${r.points}`).join(" · ") || "Aucun signal"))) : h("p", { class: "discret-texte" }, "Aucun prospect ouvert.")),
    h("div", { class: "carte" }, h("h2", {}, "Formulaires publics"), formulaires.map((f) => h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", { class: "nom" }, `${f.titre} · ${f.entite}`), h("span", {}, `${f.reponses} réponse(s)`)), f.actif ? h("div", { class: "ligne" }, h("a", { href: f.lien, target: "_blank", rel: "noopener" }, "Ouvrir le formulaire"), gere ? h("button", { class: "discret", onclick: async () => { await api("POST", `/formulaires-capture/${f.id}/arret`); ecranProspection("Formulaire arrêté."); } }, "Arrêter") : null) : h("div", { class: "discret-texte" }, "Arrêté"))),
      gere && entites.length ? h("details", {}, h("summary", {}, "Nouveau formulaire"), formulaire(async (v) => { await api("POST", "/formulaires-capture", { entiteId: v.e, titre: v.t.trim(), introduction: v.i.trim() || undefined, source: v.s.trim() }); ecranProspection("Formulaire créé."); }, [h("div", { class: "grille" }, choix("e", "Entité", entites), champ("Titre", { name: "t", required: true }), champ("Source (Facebook, site…)", { name: "s", required: true })), h("label", {}, "Introduction", h("textarea", { name: "i", rows: 2 }))], "Créer")) : null),
    h("div", { class: "carte" }, h("h2", {}, "Segments"), segments.map((s) => h("div", { class: "ligne apprenant" }, h("span", {}, `${s.nom} · ${s.branche}`), h("button", { class: "discret", onclick: () => ecranSegment(s.id) }, "Voir"))),
      gere ? h("details", {}, h("summary", {}, "Nouveau segment"), formulaire(async (v) => {
        const criteres = {};
        if (v.r) criteres.role = v.r; if (v.l) criteres.langue = v.l; if (v.j) criteres.inactifJours = Number(v.j); if (v.a) criteres.achatMin = Number(v.a);
        await api("POST", "/segments", { brancheId: v.b, nom: v.n.trim(), criteres }); ecranProspection("Segment créé.");
      }, [h("div", { class: "grille" }, champ("Nom", { name: "n", required: true }), choix("b", "Branche", entites), choix("r", "Rôle", [["", "Tous"], ["prospect", "Prospect"], ["client", "Client"], ["apprenant", "Apprenant"]]), choix("l", "Langue", [["", "Toutes"], ["fr", "Français"], ["en", "Anglais"]]), champ("Sans contact depuis (jours)", { name: "j", type: "number", min: 1 }), champ("Achats minimum (FCFA)", { name: "a", type: "number", min: 1 }))], "Créer")) : null));
}

async function ecranSegment(id) {
  const s = await api("GET", `/segments/${id}/membres`);
  vue(h("button", { class: "discret", onclick: () => ecranProspection() }, "← Prospection"), h("h1", {}, `${s.segment} : ${s.membres.length}`), h("div", { class: "carte" }, s.membres.length ? s.membres.map((m) => h("div", { class: "ligne apprenant" }, h("span", {}, `${m.nom} · ${m.telephone ?? m.email ?? "Sans contact"}`), h("span", {}, fcfa(m.achats)))) : h("p", { class: "discret-texte" }, "Personne pour l'instant.")),
    s.membres.length ? h("button", { class: "discret", onclick: () => {
      const cel = (v) => { const t = String(v ?? ""); const x = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t; return `"${x.replace(/"/g, '""')}"`; };
      const csv = ["Nom;Téléphone;Email;Achats", ...s.membres.map((m) => [m.nom, m.telephone, m.email, m.achats].map(cel).join(";"))].join("\r\n");
      const u = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv" })); h("a", { href: u, download: `Segment ${s.segment}.csv` }).click(); setTimeout(() => URL.revokeObjectURL(u), 10000);
    } }, "Exporter en CSV") : null,
    droits.includes("crm.gerer") ? h("button", { class: "danger", onclick: async () => { await api("DELETE", `/segments/${id}`); ecranProspection("Segment supprimé."); } }, "Supprimer le segment") : null);
}

async function ecranRecherche(q) {
  const r = await api("GET", `/recherche?q=${encodeURIComponent(q)}`);
  const G = { client: "Client", document: "Document", produit: "Produit", session: "Session", ticket: "Ticket" };
  const ouvrir = { document: (x) => ecranDocument(x.id), ticket: (x) => ecranTicket(x.id) };
  vue(h("h1", {}, `Recherche : ${q}`), h("div", { class: "carte" }, r.length ? r.map((x) => ouvrir[x.genre] ? h("button", { class: "session", onclick: () => ouvrir[x.genre](x) }, `${G[x.genre]} · ${x.titre} · ${x.detail}`) : h("div", { class: "apprenant" }, `${G[x.genre]} · ${x.titre} · ${x.detail}`)) : h("p", { class: "discret-texte" }, "Aucun résultat.")));
}

async function ecranNotifications() {
  const n = await api("GET", "/notifications");
  const A = { taches: () => ecranTaches(), tickets: () => ecranSupport(), alertes: () => ecranKpi(), relances: () => ecranRecouvrement(), compte: () => ecranCompte(), contrats: () => ecranContrats(), maintenance: () => ecranMaintenance(), questions: () => ecranCours(), inactifs: () => ecranCours(), ecritures: () => ecranCompta(), fiscal: () => ecranCompta(), pertes: () => ecranRecouvrement(), tresorerie: () => ecranTresorerie(), messages: () => ecranMessages(), messages_urgents: () => ecranMessages() };
  vue(h("h1", {}, "Notifications"), h("div", { class: "carte" }, n.length ? n.map((x) => h("button", { class: "session", onclick: A[x.genre] }, `${x.nombre} ${x.texte}`)) : h("p", { class: "discret-texte" }, "Rien à traiter.")));
}

async function ecranCompte(message, activation) {
  const m = await api("GET", "/moi");
  const entitesCharte = droits.includes("entites.gerer") ? await api("GET", "/entites") : [];
  vue(h("h1", {}, "Mon compte"), message ? h("div", { class: "succes", role: "status" }, message) : null, h("p", {}, `${m.nom} · ${m.email}`),
    cartePhotoProfil((x) => ecranCompte(x)),
    m.mot_de_passe_provisoire ? h("div", { class: "alerte-caisse" }, "Votre mot de passe a été fixé par un administrateur. Changez-le maintenant.") : null,
    h("div", { class: "carte" }, h("h2", {}, "Mot de passe"), formulaire(async (v) => { await api("POST", "/moi/mot-de-passe", { actuel: v.a, nouveau: v.n }); ecranCompte("Mot de passe changé."); }, [h("div", { class: "grille" }, champ("Mot de passe actuel", { name: "a", type: "password", required: true, autocomplete: "current-password" }), champ("Nouveau, 8 caractères minimum", { name: "n", type: "password", minlength: 8, required: true, autocomplete: "new-password" }))], "Changer")),
    h("div", { class: "carte" }, h("h2", {}, "Double authentification"), m.totp_actif ? h("p", {}, h("span", { class: "pastille ok" }, "Activée")) : activation
      ? h("div", {}, h("p", {}, "Scannez ce code avec Google Authenticator ou une application équivalente, puis saisissez le code à 6 chiffres."), h("img", { src: `data:image/svg+xml;base64,${btoa(activation.qr_svg)}`, alt: "Code à scanner", width: 200, height: 200 }), h("p", { class: "discret-texte" }, "Ou saisissez cette clé : "), h("code", { class: "secret" }, activation.secret),
        formulaire(async (v) => { await api("POST", "/2fa/confirmation", { code: v.c.trim() }); ecranCompte("Double authentification activée."); }, [champ("Code", { name: "c", required: true, inputmode: "numeric", pattern: "[0-9]{6}", autocomplete: "one-time-code" })], "Confirmer"))
      : h("button", { onclick: async () => ecranCompte(null, await api("POST", "/2fa/activation")) }, "Activer")),
    h("div", { class: "carte" }, h("h2", {}, "Affichage"), formulaire(async (v) => { try { localStorage.setItem("affichage", JSON.stringify({ theme: v.t, taille: Number(v.s) })); localStorage.setItem("langue", v.l); } catch { /* préférence non gardée */ } appliquerAffichage(); ecranCompte("Affichage mis à jour."); }, [h("div", { class: "grille" }, choix("t", "Thème", [["clair", "Clair"], ["sombre", "Sombre"]]), choix("s", "Taille du texte", [["16", "Normale"], ["18", "Grande"], ["20", "Très grande"]]), choix("l", "Langue", langueCourante() === "en" ? [["en", "English"], ["fr", "Français"]] : [["fr", "Français"], ["en", "English"]]))], "Appliquer")), entitesCharte.length ? formulaireCharte(entitesCharte) : null);
}

async function ecranSeparation(message) {
  const s = await api("GET", "/separation");
  const case_ = (nom, l, v) => h("label", {}, h("input", { type: "checkbox", name: nom, checked: v }), ` ${l}`);
  vue(h("button", { class: "discret", onclick: () => ecranAcces() }, "← Accès"), h("h1", {}, "Séparation des tâches"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("p", {}, "Quand une règle est cochée, une autre personne doit valider. Avec une petite équipe, activez d'abord ce que vous pouvez tenir."),
    h("form", { class: "carte", onsubmit: async (e) => { e.preventDefault(); const f = e.target; await api("PUT", "/separation", { ecritures: f.a.checked, commandes: f.b.checked, facturesFournisseur: f.c.checked, pertes: f.d.checked }); ecranSeparation("Règles enregistrées."); } },
      case_("a", "Écritures comptables : l'auteur ne valide pas", s.ecritures), case_("b", "Bons de commande : l'auteur n'approuve pas", s.commandes), case_("c", "Factures fournisseurs : l'auteur ne valide pas", s.factures_fournisseur), case_("d", "Passage en perte : le demandeur ne valide pas", s.pertes), h("button", { type: "submit" }, "Enregistrer")));
}
