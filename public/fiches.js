"use strict";
/* Fiches de poste : rédaction en versions par les RH ou le responsable des évaluations, lecture confirmée par le collaborateur. */

const TYPES_OBJ_FICHE = [["mesure_systeme", "Mesuré par le système"], ["chiffre_declare", "Chiffre déclaré"], ["tache", "Tâche à faire"]];
const listeTexte = (titre, l) => (l && l.length ? h("div", {}, h("h3", {}, titre), h("ul", {}, l.map((x) => h("li", {}, x)))) : null);

/** Contenu d'une fiche, identique pour le collaborateur, le rédacteur et l'impression. */
function contenuFiche(f, indicateurs) {
  const lib = (code) => indicateurs.find((k) => k.code === code)?.libelle ?? code;
  return h("div", { class: "document" },
    h("div", { class: "ligne" }, h("h2", {}, `Fiche de poste : ${f.intitule}`), h("span", { class: "pastille" }, `Version ${f.version}`)),
    h("p", {}, `${f.entite ? `Entité : ${f.entite}` : ""}${f.rattache_intitule || f.rattachement ? `${f.entite ? " · " : ""}Rattachement : ${[f.rattache_intitule, f.rattachement].filter(Boolean).join(", ")}` : ""}`),
    h("p", { class: "discret-texte" }, `Publiée le ${heure(f.cree_le)}${f.motif_version ? ` · Changement : ${f.motif_version}` : ""}`),
    listeTexte("Missions", f.missions), listeTexte("Responsabilités", f.responsabilites), listeTexte("Compétences attendues", f.competences),
    f.indicateurs.length ? h("div", {}, h("h3", {}, "Indicateurs du poste"), h("div", { class: "defilant" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Indicateur", "Cible", "Poids"].map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", {}, f.indicateurs.map((i) => h("tr", {}, h("td", {}, i.libelle || lib(i.kpi)), h("td", { class: "nombre" }, Number(i.cible).toLocaleString("fr-FR")), h("td", { class: "nombre" }, String(i.poids)))))))) : null,
    f.objectifs_types.length ? h("div", {}, h("h3", {}, "Objectifs types du jour"), h("div", { class: "defilant" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Objectif", "Type", "Cible", "Poids"].map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", {}, f.objectifs_types.map((o) => h("tr", {}, h("td", {}, o.libelle), h("td", {}, `${TYPES_OBJ_FICHE.find((t) => t[0] === o.type)[1]}${o.kpi ? ` (${o.kpi_libelle || lib(o.kpi)})` : ""}`),
        h("td", { class: "nombre" }, String(o.cible)), h("td", { class: "nombre" }, String(o.poids)))))))) : null);
}

async function ecranMaFiche(message) {
  const m = await api("GET", "/moi/fiche-poste");
  const f = m.fiche;
  vue(h("button", { class: "discret pas-imprimer", onclick: () => ecranMonEspace() }, "← Mon espace"), h("h1", { class: "pas-imprimer" }, "Ma fiche de poste"),
    message ? h("div", { class: "succes pas-imprimer", role: "status" }, message) : null,
    !f ? h("div", { class: "carte" }, h("p", {}, `Aucune fiche n'est encore publiée pour le poste « ${m.poste} ». Les ressources humaines la préparent.`))
      : h("div", {},
        m.lu_le ? h("p", { class: "succes pas-imprimer" }, `Vous avez confirmé avoir lu cette version le ${heure(m.lu_le)}.`)
          : h("div", { class: "alerte-caisse pas-imprimer" }, f.version > 1 ? "Votre fiche a changé : lisez-la puis confirmez." : "Lisez votre fiche puis confirmez."),
        contenuFiche(f, f.indicateurs),
        h("div", { class: "actions pas-imprimer" },
          m.lu_le ? null : h("button", { onclick: async () => { await api("POST", "/moi/fiche-poste/lecture", { ficheId: f.id }); ecranMaFiche("Merci : lecture confirmée."); } }, "J'ai lu ma fiche de poste"),
          h("button", { class: "discret", onclick: () => window.print() }, "Imprimer"))));
}

/** Formulaire d'une fiche : listes une ligne par élément, indicateurs et objectifs types ligne par ligne. */
function formulaireFiche({ f, indicateurs, fiches, entites, nouvelle }, envoyer) {
  const journaliers = indicateurs.filter((k) => !k.mensuel);
  const zoneInd = h("div"), zoneObj = h("div");
  const ajouterInd = (i = {}) => {
    const l = h("div", { class: "ligne-doc" },
      h("label", {}, "Indicateur", h("select", { name: "ik" }, indicateurs.map((k) => h("option", { value: k.code, selected: k.code === i.kpi }, k.libelle)))),
      h("label", {}, "Cible", h("input", { name: "ic", type: "number", min: 0, step: "any", required: true, value: i.cible ?? "" })),
      h("label", {}, "Poids", h("input", { name: "ip", type: "number", min: 1, max: 100, required: true, value: i.poids ?? 10 })),
      h("button", { type: "button", class: "discret", onclick: () => l.remove() }, "Retirer"));
    zoneInd.append(l);
  };
  const ajouterObj = (o = {}) => {
    const kpi = h("select", { name: "ok" }, journaliers.map((k) => h("option", { value: k.code, selected: k.code === o.kpi }, k.libelle)));
    const champKpi = h("label", { hidden: (o.type || "chiffre_declare") !== "mesure_systeme" }, "Indicateur", kpi);
    const l = h("div", { class: "ligne-doc" },
      h("label", {}, "Objectif", h("input", { name: "ol", required: true, value: o.libelle ?? "" })),
      h("label", {}, "Type", h("select", { name: "ot", onchange: (e) => { champKpi.hidden = e.target.value !== "mesure_systeme"; } }, TYPES_OBJ_FICHE.map(([c, x]) => h("option", { value: c, selected: c === (o.type || "chiffre_declare") }, x)))),
      champKpi,
      h("label", {}, "Cible", h("input", { name: "oc", type: "number", min: 0, step: "any", value: o.cible ?? 1 })),
      h("label", {}, "Poids", h("input", { name: "op", type: "number", min: 1, max: 100, required: true, value: o.poids ?? 20 })),
      h("button", { type: "button", class: "discret", onclick: () => l.remove() }, "Retirer"));
    zoneObj.append(l);
  };
  (f?.indicateurs || []).forEach(ajouterInd);
  (f?.objectifs_types || []).forEach(ajouterObj);
  const lignes = (t) => t.split("\n").map((x) => x.trim()).filter(Boolean);
  return formulaire(async (v, form) => {
    const corps = {
      rattacheA: v.ra || null, rattachement: v.rt.trim() || undefined,
      missions: lignes(v.mi), responsabilites: lignes(v.re), competences: lignes(v.co),
      indicateurs: [...zoneInd.children].map((l) => ({ kpi: l.querySelector("[name=ik]").value, cible: Number(l.querySelector("[name=ic]").value), poids: Number(l.querySelector("[name=ip]").value) })),
      objectifsTypes: [...zoneObj.children].map((l) => {
        const type = l.querySelector("[name=ot]").value;
        return { libelle: l.querySelector("[name=ol]").value.trim(), type, ...(type === "mesure_systeme" ? { kpi: l.querySelector("[name=ok]").value } : {}), cible: Number(l.querySelector("[name=oc]").value || 1), poids: Number(l.querySelector("[name=op]").value) };
      }),
    };
    await envoyer(corps, v, form);
  }, [
    nouvelle ? h("div", { class: "grille" }, choix("e", "Entité", entites), champ("Intitulé du poste, exactement comme sur les fiches des employés", { name: "in", required: true })) : null,
    h("div", { class: "grille" },
      choix("ra", "Rattaché au poste", [["", "Aucun poste de la liste"], ...fiches.filter((x) => x.groupe_id !== f?.groupe_id).map((x) => [x.groupe_id, `${x.intitule} · ${x.entite}`])], f?.rattache_a || ""),
      champ("Rattachement, en clair (facultatif)", { name: "rt", value: f?.rattachement || "" })),
    h("label", {}, "Missions, une par ligne", h("textarea", { name: "mi", rows: 4 }, (f?.missions || []).join("\n"))),
    h("label", {}, "Responsabilités, une par ligne", h("textarea", { name: "re", rows: 3 }, (f?.responsabilites || []).join("\n"))),
    h("label", {}, "Compétences attendues, une par ligne", h("textarea", { name: "co", rows: 3 }, (f?.competences || []).join("\n"))),
    h("fieldset", {}, h("legend", {}, "Indicateurs du poste (évaluation mensuelle)"), zoneInd, h("button", { type: "button", class: "discret", onclick: () => ajouterInd() }, "Ajouter un indicateur")),
    h("fieldset", {}, h("legend", {}, "Objectifs types du jour"), zoneObj, h("button", { type: "button", class: "discret", onclick: () => ajouterObj() }, "Ajouter un objectif type")),
    nouvelle ? null : champ("Motif du changement (obligatoire)", { name: "motif", required: true, minlength: 3 }),
  ], nouvelle ? "Publier la fiche" : "Publier la nouvelle version");
}

async function ecranFichesPoste(message) {
  const [fiches, indicateurs, entites] = await Promise.all([api("GET", "/fiches-poste"), api("GET", "/fiches-poste/indicateurs"), entitesPour("rh_paie")]);
  vue(h("button", { class: "discret", onclick: () => ecranPerformance() }, "← Performance"), h("h1", {}, "Fiches de poste"),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "carte" }, fiches.length ? fiches.map((f) => h("button", { class: "session", onclick: () => ecranFichePoste(f.groupe_id) },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, f.intitule), h("span", { class: "pastille" }, `Version ${f.version}`)),
      h("div", { class: "discret-texte" }, `${f.entite} · publiée le ${heure(f.cree_le)}${f.modeles_actifs ? ` · ${f.modeles_actifs} objectif(s) journalier(s) en place` : ""}`)))
      : h("p", { class: "discret-texte" }, "Aucune fiche pour le moment.")),
    h("details", { class: "carte" }, h("summary", {}, "Nouvelle fiche de poste"),
      formulaireFiche({ indicateurs, fiches, entites, nouvelle: true }, async (corps, v) => {
        const f = await api("POST", "/fiches-poste", { ...corps, entiteId: v.e, intitule: v.in.trim() });
        ecranFichePoste(f.groupe_id, "Fiche publiée. Les collaborateurs du poste sont prévenus.");
      })));
}

async function ecranFichePoste(groupeId, message, versionId) {
  const [f, fiches, indicateurs] = await Promise.all([api("GET", `/fiches-poste/${groupeId}`), api("GET", "/fiches-poste"), api("GET", "/fiches-poste/indicateurs")]);
  const affichee = versionId ? await api("GET", `/fiches-poste/versions/${versionId}`) : f;
  const lus = f.lectures.filter((x) => x.lu).length;
  vue(h("button", { class: "discret pas-imprimer", onclick: () => ecranFichesPoste() }, "← Fiches de poste"),
    message ? h("div", { class: "succes pas-imprimer", role: "status" }, message) : null,
    versionId && versionId !== f.id ? h("div", { class: "alerte-caisse pas-imprimer" }, `Vous consultez l'ancienne version ${affichee.version}. La version en vigueur est la ${f.version}.`) : null,
    contenuFiche({ ...affichee, entite: fiches.find((x) => x.groupe_id === groupeId)?.entite, rattache_intitule: affichee.id === f.id ? f.rattache_intitule : null }, indicateurs),
    h("div", { class: "actions pas-imprimer" },
      h("button", { class: "discret", onclick: () => window.print() }, "Imprimer"),
      f.objectifs_types.length ? h("button", { onclick: async () => {
        const r = await api("POST", `/fiches-poste/${groupeId}/modeles`);
        ecranFichePoste(groupeId, `${r.crees} objectif(s) journalier(s) créé(s) depuis la version ${r.version}${r.arretes ? `, ${r.arretes} ancien(s) arrêté(s)` : ""}. Ils s'appliquent dès demain matin.`);
      } }, "Générer les objectifs journaliers du poste") : null),
    h("div", { class: "carte pas-imprimer" }, h("h2", {}, `Lecture de la version ${f.version} : ${lus} sur ${f.lectures.length}`),
      f.lectures.length ? f.lectures.map((x) => h("div", { class: "ligne" }, h("span", {}, x.nom), h("span", { class: x.lu ? "pastille ok" : "pastille retard" }, x.lu ? `Lue le ${heure(x.lu_le)}` : "Pas encore lue")))
        : h("p", { class: "discret-texte" }, "Aucun employé n'a encore ce poste.")),
    h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Versions"), f.versions.map((x) => h("button", { class: "session", onclick: () => ecranFichePoste(groupeId, null, x.id) },
      h("div", { class: "ligne" }, h("span", { class: "nom" }, `Version ${x.version}`), h("span", {}, heure(x.cree_le))),
      h("div", { class: "discret-texte" }, `${x.auteur}${x.motif_version ? ` · ${x.motif_version}` : " · première publication"}`)))),
    h("details", { class: "carte pas-imprimer" }, h("summary", {}, "Modifier : publier une nouvelle version"),
      h("p", { class: "discret-texte" }, "L'intitulé et l'entité ne changent pas. Les collaborateurs du poste devront relire la fiche."),
      formulaireFiche({ f, indicateurs, fiches }, async (corps, v) => {
        await api("PUT", `/fiches-poste/${groupeId}`, { ...corps, motif: v.motif.trim() });
        ecranFichePoste(groupeId, "Nouvelle version publiée. Les collaborateurs du poste sont prévenus.");
      })));
}
