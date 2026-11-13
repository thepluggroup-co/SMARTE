"use strict";
/* Événements, bibliothèque et statistiques. */
async function ecranEvenements(message) {
  const gere = droits.includes("marketing.gerer");
  const [l, entites] = await Promise.all([api("GET", "/manifestations"), gere ? entitesPour("crm") : []]);
  vue(h("h1", {}, "Événements"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, l.length ? l.map((m) => h("div", { class: "apprenant" }, h("button", { class: "session", onclick: () => ecranEvenement(m) }, `${m.titre} · ${heure(m.debut)} · ${m.inscrits} / ${m.capacite} inscrits · ${m.presents} présents · ${fcfa(m.recette)}`), m.ouverte ? h("a", { href: m.lien, target: "_blank", rel: "noopener" }, "Page publique") : null)) : h("p", { class: "discret-texte" }, "Aucun événement.")),
    gere && entites.length ? h("details", { class: "carte" }, h("summary", {}, "Nouvel événement"), formulaire(async (v) => { await api("POST", "/manifestations", { entiteId: v.e, titre: v.t.trim(), description: v.x.trim() || undefined, lieu: v.l.trim() || undefined, debut: new Date(v.d).toISOString(), fin: new Date(v.f).toISOString(), capacite: Number(v.c), prix: Number(v.p || 0), intervenants: v.i.trim() || undefined }); ecranEvenements("Événement créé."); }, [h("div", { class: "grille" }, champ("Titre", { name: "t", required: true }), choix("e", "Entité", entites), champ("Lieu", { name: "l" }), champ("Début", { name: "d", type: "datetime-local", required: true }), champ("Fin", { name: "f", type: "datetime-local", required: true }), champ("Places", { name: "c", type: "number", min: 1, required: true }), champ("Prix (FCFA)", { name: "p", type: "number", min: 0, value: 0 }), champ("Intervenants", { name: "i" })), h("label", {}, "Description", h("textarea", { name: "x", rows: 3 }))], "Créer")) : null);
}
async function ecranEvenement(m, message) {
  const gere = droits.includes("marketing.gerer");
  const payant = Number(m.prix) > 0;
  const [b, wallets] = await Promise.all([api("GET", `/manifestations/${m.id}/billets`), payant && droits.includes("tresorerie.gerer") ? portefeuillesDe(m.entite_id) : []]);
  const R = (t) => ecranEvenement(m, t);
  const zone = h("div");
  vue(h("button", { class: "discret", onclick: () => ecranEvenements() }, "← Événements"), h("h1", {}, m.titre), message ? h("div", { class: "succes", role: "status" }, message) : null,
    gere ? h("div", { class: "carte" }, h("h2", {}, "Contrôle à l'entrée"), zone, formulaire(async (v, f) => { const r = await api("POST", `/manifestations/${m.id}/entree`, { code: v.c.trim() }); R(`Entrée de ${r.nom} enregistrée.`); }, [champ("Code du billet", { name: "c", required: true, autofocus: true })], "Valider")) : null,
    h("div", { class: "carte" }, h("h2", {}, `Billets (${b.length})`), b.map((x) => h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", { class: "nom" }, `${x.nom} · ${x.telephone ?? x.email ?? ""}`), h("span", {}, `${{ reserve: "Réservé", paye: "Payé", annule: "Annulé" }[x.statut]}${x.present_le ? " · Présent" : ""}`)),
      gere && x.statut === "reserve" ? h("div", { class: "actions" }, payant && wallets.length ? formulaire(async (v) => { const r = await api("POST", `/billets/${x.id}/paiement`, { portefeuilleId: v.w }); R(`Reçu ${r.numero}.`); }, [choix("w", "Encaisser dans", wallets.map((w) => [w.id, w.nom]))], `Encaisser ${fcfa(m.prix)}`) : null, h("button", { class: "discret", onclick: async () => { await api("POST", `/billets/${x.id}/annulation`); R("Billet annulé."); } }, "Annuler")) : null))),
    gere && m.ouverte ? h("button", { class: "discret", onclick: async () => { await api("POST", `/manifestations/${m.id}/cloture`); ecranEvenements("Inscriptions fermées."); } }, "Fermer les inscriptions") : null);
}
async function ecranBibliotheque(message) {
  const gere = droits.includes("coaching.gerer");
  const [l, entites] = await Promise.all([api("GET", "/ressources-coaching"), gere ? entitesPour("coaching") : []]);
  const C = [["ressource", "Ressource"], ["exercice", "Exercice"], ["test", "Test"], ["modele", "Modèle"]];
  vue(h("button", { class: "discret", onclick: () => ecranCoaching() }, "← Coaching"), h("h1", {}, "Bibliothèque"), message ? h("div", { class: "succes", role: "status" }, message) : null, h("p", {}, "Le client voit ces liens sur sa page de réservation, selon le niveau de certification obtenu."),
    h("div", { class: "carte" }, l.length ? l.map((r) => h("div", { class: "ligne apprenant" }, h("a", { href: r.url, target: "_blank", rel: "noopener noreferrer" }, r.titre), h("span", {}, `${C.find((c) => c[0] === r.categorie)[1]} · ${r.niveau_min ? `Niveau ${r.niveau_min}` : "Tous"}`), gere ? h("button", { class: "discret", onclick: async () => { await api("POST", `/ressources-coaching/${r.id}/retrait`); ecranBibliotheque("Ressource retirée."); } }, "Retirer") : null)) : h("p", { class: "discret-texte" }, "Aucune ressource.")),
    gere && entites.length ? h("div", { class: "carte" }, formulaire(async (v) => { await api("POST", "/ressources-coaching", { entiteId: v.e, titre: v.t.trim(), categorie: v.c, url: v.u.trim(), niveauMin: Number(v.n || 0) }); ecranBibliotheque("Ressource ajoutée."); }, [h("div", { class: "grille" }, champ("Titre", { name: "t", required: true }), choix("c", "Type", C), choix("e", "Entité", entites), champ("Lien https", { name: "u", type: "url", pattern: "https://.*", required: true }), champ("Niveau minimum (0 : tous)", { name: "n", type: "number", min: 0, max: 20, value: 0 }))], "Ajouter")) : null);
}
async function ecranStatsUniversite(annee = anneeUniv()) {
  const s = await api("GET", `/universite/statistiques?annee=${annee}`);
  vue(h("button", { class: "discret", onclick: () => ecranUniversite() }, "← Université"), h("h1", {}, `Statistiques ${annee}`), h("label", {}, "Année", h("input", { value: annee, pattern: "[0-9]{4}-[0-9]{4}", onchange: (e) => ecranStatsUniversite(e.target.value) })),
    h("div", { class: "carte" }, h("div", { class: "defilant" }, h("table", {}, h("thead", {}, h("tr", {}, ["Filière", "Candidatures", "Inscrits", "UE réussies", "Diplômés", "Recettes"].map((c) => h("th", { scope: "col" }, c)))), h("tbody", {}, s.filieres.map((f) => h("tr", {}, h("td", {}, f.nom), h("td", { class: "nombre" }, f.candidatures), h("td", { class: "nombre" }, f.inscrits), h("td", { class: "nombre" }, f.reussite === null ? "–" : `${f.reussite} %`), h("td", { class: "nombre" }, f.diplomes), h("td", { class: "nombre" }, fcfa(f.recettes)))))))),
    h("div", { class: "carte" }, h("h2", {}, `Diplômés (${s.diplomes.length})`), s.diplomes.map((d) => h("div", { class: "discret-texte" }, `${d.nom} · ${d.filiere} · ${d.telephone ?? d.email ?? ""}`)), s.diplomes.length ? h("button", { class: "discret", onclick: () => exporterCsv("Diplômés", [["Nom", "Filière", "Téléphone", "Email"], ...s.diplomes.map((d) => [d.nom, d.filiere, d.telephone, d.email])]) }, "Exporter en CSV") : null));
}
