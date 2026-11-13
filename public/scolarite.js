"use strict";
/* Scolarité, emploi du temps, paie et réservations de coaching. */
function exporterCsv(nom, lignes) {
  const cel = (v) => { const t = String(v ?? ""); const x = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t; return `"${x.replace(/"/g, '""')}"`; };
  const u = URL.createObjectURL(new Blob(["﻿", lignes.map((l) => l.map(cel).join(";")).join("\r\n")], { type: "text/csv" }));
  h("a", { href: u, download: `${nom}.csv` }).click();
  setTimeout(() => URL.revokeObjectURL(u), 10000);
}
/** Les portefeuilles de la branche de cette entité, jamais ceux de l'autre branche. */
async function portefeuillesDe(entiteId) {
  const [entites, wallets] = await Promise.all([api("GET", "/entites"), api("GET", "/portefeuilles")]);
  const branche = (id) => { let e = entites.find((x) => x.id === id); while (e && e.parent_id && e.type !== "branche") e = entites.find((x) => x.id === e.parent_id); return e?.id; };
  return wallets.filter((w) => w.actif && branche(w.entite_id) === branche(entiteId));
}
const anneeUniv = () => { const d = new Date(); const a = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1; return `${a}-${a + 1}`; };

async function ecranScolarite(id, message, annee = anneeUniv()) {
  const gere = droits.includes("universite.gerer");
  const [s, f] = await Promise.all([api("GET", `/filieres/${id}/scolarite?annee=${annee}`), api("GET", `/filieres/${id}`)]);
  const actifs = gere && droits.includes("tresorerie.voir") ? await portefeuillesDe(f.entite_id) : [];
  vue(h("button", { class: "discret", onclick: () => ecranFiliere(id) }, "← Filière"), h("h1", {}, `Scolarité ${annee}`), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("label", {}, "Année", h("input", { value: annee, pattern: "[0-9]{4}-[0-9]{4}", onchange: (e) => ecranScolarite(id, null, e.target.value) })),
    h("div", { class: "carte" }, h("h2", {}, "Frais"), s.frais.map((f) => h("div", { class: "ligne" }, h("span", {}, `${f.libelle} · échéance ${dateFr(f.echeance)}`), h("b", {}, fcfa(f.montant)))),
      gere ? h("details", {}, h("summary", {}, "Ajouter un frais"), formulaire(async (v) => { await api("POST", `/filieres/${id}/frais`, { annee, libelle: v.l.trim(), montant: Number(v.m), echeance: v.e }); ecranScolarite(id, "Frais ajouté.", annee); }, [h("div", { class: "grille" }, champ("Libellé", { name: "l", required: true }), champ("Montant (FCFA)", { name: "m", type: "number", min: 1, required: true }), champ("Échéance", { name: "e", type: "date", required: true }))], "Ajouter")) : null),
    h("div", { class: "carte" }, h("h2", {}, "Étudiants"), s.etudiants.length ? s.etudiants.map((e) => h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", { class: "nom" }, `${e.nom} · ${e.matricule}`), h("span", { class: e.acces_examen ? "pastille ok" : "pastille retard" }, e.acces_examen ? "Accès aux examens" : `Impayé ${fcfa(e.impaye_echu)}`)),
      h("div", { class: "discret-texte" }, `Dû ${fcfa(e.du)} · Bourses ${fcfa(e.bourses)} · Payé ${fcfa(e.paye)} · Reste ${fcfa(e.reste)}`),
      gere ? h("div", { class: "actions" }, actifs.length && e.reste > 0 ? h("details", {}, h("summary", {}, "Encaisser"), formulaire(async (v) => { const r = await api("POST", `/inscriptions-univ/${e.id}/paiements`, { montant: Number(v.m), portefeuilleId: v.w, reference: v.r.trim() || undefined }); ecranScolarite(id, `Reçu ${r.numero}.`, annee); }, [champ("Montant", { name: "m", type: "number", min: 1, max: e.reste, required: true }), choix("w", "Portefeuille", actifs.map((w) => [w.id, w.nom])), champ("Référence", { name: "r" })], "Encaisser")) : null,
        h("details", {}, h("summary", {}, "Accorder une bourse"), formulaire(async (v) => { await api("POST", `/inscriptions-univ/${e.id}/bourses`, { libelle: v.l.trim(), montant: Number(v.m) }); ecranScolarite(id, "Bourse enregistrée.", annee); }, [champ("Libellé", { name: "l", required: true }), champ("Montant", { name: "m", type: "number", min: 1, required: true })], "Accorder"))) : null)) : h("p", { class: "discret-texte" }, "Aucun inscrit cette année.")));
}

async function ecranEmploiDuTemps(id, message, annee = anneeUniv()) {
  const [cours, f, sco] = await Promise.all([api("GET", `/filieres/${id}/cours?annee=${annee}`), api("GET", `/filieres/${id}`), api("GET", `/filieres/${id}/scolarite?annee=${annee}`)]);
  const gere = droits.includes("universite.gerer");
  vue(h("button", { class: "discret", onclick: () => ecranFiliere(id) }, "← Filière"), h("h1", {}, `Emploi du temps ${annee}`), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, cours.length ? cours.map((c) => h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", { class: "nom" }, `${dateFr(c.jour)} ${c.debut.slice(0, 5)} à ${c.fin.slice(0, 5)} · ${c.code} ${c.ue}`), h("span", {}, c.appeles ? `${c.presents} / ${c.appeles} présents` : "Appel à faire")), h("div", { class: "discret-texte" }, [c.salle, c.enseignant].filter(Boolean).join(" · ")),
      droits.includes("universite.notes") && sco.etudiants.length ? h("details", {}, h("summary", {}, "Faire l'appel : cochez les absents"), h("form", { onsubmit: async (e) => { e.preventDefault(); const absents = [...e.target.querySelectorAll("input:checked")].map((x) => x.value); await api("PUT", `/cours-planifies/${c.id}/appel`, { absents }); ecranEmploiDuTemps(id, "Appel enregistré.", annee); } }, sco.etudiants.map((x) => h("label", {}, h("input", { type: "checkbox", value: x.id }), ` ${x.nom}`)), h("button", { type: "submit" }, "Enregistrer"))) : null)) : h("p", { class: "discret-texte" }, "Aucun cours planifié.")),
    gere && (f.ues ?? f.unites ?? []).length ? h("details", { class: "carte" }, h("summary", {}, "Planifier un cours"), formulaire(async (v) => { await api("POST", `/filieres/${id}/cours`, { ueId: v.u, annee, jour: v.j, debut: v.d, fin: v.f, salle: v.s.trim() || undefined }); ecranEmploiDuTemps(id, "Cours planifié.", annee); }, [h("div", { class: "grille" }, choix("u", "Unité d'enseignement", (f.ues ?? f.unites).map((u) => [u.id, `${u.code} ${u.nom}`])), champ("Jour", { name: "j", type: "date", required: true }), champ("Début", { name: "d", type: "time", required: true }), champ("Fin", { name: "f", type: "time", required: true }), champ("Salle", { name: "s" }))], "Planifier")) : null);
}

async function ecranEtatPaie(message, periode = new Date().toISOString().slice(0, 7), entiteChoisie) {
  const entites = await entitesPour("rh_paie");
  const entiteId = entiteChoisie || entites[0]?.[0];
  if (!entiteId) return vue(h("h1", {}, "État de paie"), h("p", {}, "Aucune entité accessible."));
  const [e, wallets] = await Promise.all([api("GET", `/paie/etat?entiteId=${entiteId}&periode=${periode}`), droits.includes("tresorerie.gerer") ? portefeuillesDe(entiteId) : []]);
  const aVerser = e.salaries.filter((s) => !s.verse);
  vue(h("button", { class: "discret", onclick: () => ecranRh() }, "← RH"), h("h1", {}, `État de paie ${periode}`), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "alerte-caisse" }, "Document préparatoire, à reporter dans les déclarations CNPS et DGI. Il ne remplace ni ces formulaires ni la vérification de l'expert."),
    h("div", { class: "grille" }, h("label", {}, "Mois", h("input", { type: "month", value: periode, onchange: (x) => ecranEtatPaie(null, x.target.value, entiteId) })), h("label", {}, "Entité", h("select", { onchange: (x) => ecranEtatPaie(null, periode, x.target.value) }, entites.map(([i, n]) => h("option", { value: i, selected: i === entiteId }, n))))),
    h("div", { class: "chiffres" }, [["Brut", e.totaux.brut], ["Retenues", e.totaux.retenues], ["Charges employeur", e.totaux.charges], ["Net à payer", e.totaux.net]].map(([l, v]) => h("div", { class: "chiffre" }, h("b", {}, fcfa(v)), h("span", {}, l)))),
    h("div", { class: "carte" }, h("h2", {}, "Par rubrique"), e.rubriques.map((r) => h("div", { class: "ligne" }, h("span", {}, r.libelle), h("span", {}, `${r.assiette ? `Base ${fcfa(r.assiette)} · ` : ""}${fcfa(r.montant)}`)))),
    h("div", { class: "carte" }, h("h2", {}, "Versements"), e.salaries.map((s) => h("div", { class: "ligne apprenant" }, h("span", {}, `${s.nom} · ${s.mode ?? "Moyen à renseigner"}${s.compte ? ` · ${s.compte}` : ""}`), h("span", {}, `${fcfa(s.net)}${s.verse ? " · Versé" : ""}`))),
      e.salaries.length ? h("button", { class: "discret", onclick: () => exporterCsv(`Virements paie ${periode}`, [["Matricule", "Nom", "Moyen", "Compte", "Net", "Bulletin"], ...aVerser.map((s) => [s.matricule, s.nom, s.mode, s.compte, s.net, s.numero])]) }, "Exporter les virements en CSV") : null,
      aVerser.length && wallets.length ? formulaire(async (v) => { const r = await api("POST", "/paie/versements", { entiteId, periode, portefeuilleId: v.w, bulletins: aVerser.map((s) => s.bulletin) }); ecranEtatPaie(`${r.verses} versement(s) enregistré(s) pour ${fcfa(r.total)}.`, periode, entiteId); }, [choix("w", "Payé depuis", wallets.map((w) => [w.id, w.nom]))], "Enregistrer les versements faits") : null));
}

async function ecranReservations(message) {
  const [coachs, accs] = await Promise.all([api("GET", "/coachs"), api("GET", "/accompagnements")]);
  vue(h("button", { class: "discret", onclick: () => ecranCoaching() }, "← Coaching"), h("h1", {}, "Réservation en ligne"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    coachs.length ? h("div", { class: "carte" }, h("h2", {}, "Ouvrir un créneau"), formulaire(async (v) => { await api("POST", `/coachs/${v.c}/creneaux`, { debut: new Date(v.d).toISOString(), dureeMinutes: Number(v.m), lienVisio: v.l.trim() || undefined }); ecranReservations("Créneau ouvert."); }, [h("div", { class: "grille" }, choix("c", "Coach", coachs.map((c) => [c.id, c.nom])), champ("Début", { name: "d", type: "datetime-local", required: true }), champ("Durée (minutes)", { name: "m", type: "number", min: 5, value: 60, required: true }), champ("Lien de visioconférence", { name: "l", type: "url", pattern: "https://.*" }))], "Ouvrir")) : null,
    h("div", { class: "carte" }, h("h2", {}, "Liens personnels des clients"), accs.map((a) => { const z = h("div"); return h("div", { class: "apprenant" }, h("div", { class: "ligne" }, h("span", {}, a.titre), h("button", { class: "discret", onclick: async () => { const r = await api("POST", `/accompagnements/${a.id}/lien-client`); z.replaceChildren(h("a", { href: r.lien, target: "_blank", rel: "noopener" }, "Lien de réservation du client"), h("p", { class: "discret-texte" }, "Créer un nouveau lien désactive l'ancien.")); } }, "Créer le lien")), z); })));
}
