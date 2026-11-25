"use strict";

const ETATS_FICHES_VENTE = [
  ["aucun", "Sans fiche"], ["brouillon", "Brouillon"], ["publie", "Publié"],
  ["publie_et_brouillon", "Publié et brouillon"], ["remplace", "Remplacé"], ["retire", "Retiré"],
];

async function ecranFichesVente(branche = filtresEcran("fichesVente", {}).branche, filtres = filtresEcran("fichesVente", {}).filtres ?? {}, retour) {
  const branches = await branchesStudioCommerce();
  const b = branches.find((e) => e.id === branche)?.id ?? branches[0]?.id;
  if (!b) return vue(h("h1", {}, "Fiches de vente"), h("p", {}, "Aucune branche de commerce."));
  const q = new URLSearchParams({ branche: b });
  const titre = h("h1", { tabindex: "-1" }, "Fiches de vente");
  if (filtres.etat) q.set("etat", filtres.etat);
  if (filtres.recherche) q.set("recherche", filtres.recherche);
  let liste;
  try {
    const articles = await api("GET", `/fiches-vente?${q}`);
    garderFiltresEcran("fichesVente", { branche: b, filtres });
    liste = articles.length ? tableau(["Code", "Article", "État", ""], articles.map((a) => h("tr", {},
      h("td", {}, a.code), h("td", {}, a.nom), h("td", {}, libelle(ETATS_FICHES_VENTE, a.etat)),
      h("td", {}, h("button", { class: "discret", id: `fiche-vente-${a.id}`, onclick: () => {
        const position = { id: a.id, scroll: window.scrollY };
        return ecranFicheVente(a.id, () => ecranFichesVente(b, filtres, position));
      } }, "Ouvrir")))))
      : h("p", {}, "Aucun article pour ces filtres.");
  } catch (e) {
    if (e.code !== "permission_refusee" && e.code !== "module_inactif") throw e;
    liste = h("p", { role: "status" }, MESSAGES[e.code]);
  }
  vue(titre,
    branches.length > 1 ? formulaire((v) => ecranFichesVente(v.branche),
      [choix("branche", "Branche", branches.map((e) => [e.id, e.nom]), b)], "Afficher") : null,
    formulaire((v) => ecranFichesVente(b, v), [h("div", { class: "grille" },
      champ("Nom ou code de l’article", { name: "recherche", maxlength: 100, value: filtres.recherche }),
      choix("etat", "État", [["", "Tous"], ...ETATS_FICHES_VENTE.slice(0, 4)], filtres.etat || ""))], "Filtrer"),
    liste);
  if (retour) {
    window.scrollTo(0, retour.scroll);
    (document.getElementById(`fiche-vente-${retour.id}`) || titre).focus({ preventScroll: true });
  }
}

function contenuFicheVente(v) {
  return [h("h3", {}, v.titre), h("p", { class: "contenu" }, v.description),
    h("ul", {}, v.points_cles.map((point) => h("li", {}, point)))];
}

async function ecranFicheVente(id, retour, message) {
  const url = `/fiches-vente/${id}`;
  const d = await api("GET", url);
  const { article: a, brouillon, publie } = d;
  const gere = droits.includes("marketing.gerer");
  const modele = brouillon || publie;
  const action = (methode, chemin, corps, avis) => async () => {
    await api(methode, `${url}/${chemin}`, corps);
    await ecranFicheVente(id, retour, avis);
  };
  const editeur = formulaire(async (v) => {
    const points = Array.from({ length: 6 }, (_, i) => v[`point${i}`].trim()).filter(Boolean);
    await action("PUT", "brouillon", { titre: v.titre, description: v.description, points_cles: points }, "Brouillon enregistré.")();
  }, [
    champ("Titre de vente", { name: "titre", maxlength: 80, required: true, value: modele?.titre }),
    h("label", {}, "Description", h("textarea", { name: "description", rows: 6, maxlength: 1500, required: true }, modele?.description)),
    ...Array.from({ length: 6 }, (_, i) => champ(`Point clé ${i + 1}${i >= 3 ? " (facultatif)" : ""}`,
      { name: `point${i}`, maxlength: 120, required: i < 3, value: modele?.points_cles[i] })),
  ], "Enregistrer le brouillon");
  vue(h("button", { class: "discret", onclick: () => retour() }, "← Tous les articles"),
    h("h1", {}, a.nom),
    h("p", {}, [a.code, a.categorie, a.marque, a.unite, a.prix_ttc == null ? null : fcfa(a.prix_ttc)].filter(Boolean).join(" · ")),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("section", { class: "carte" }, h("h2", {}, "Brouillon"),
      gere ? [
        d.ia_disponible ? h("details", { open: !brouillon }, h("summary", {}, "Générer un brouillon"),
          brouillon ? h("p", {}, "La génération remplace le brouillon enregistré.") : null,
          formulaire((v) => action("POST", "brouillon-ia", { notes: v.notes }, "Brouillon généré.")(),
            [h("label", {}, "Notes de rédaction (facultatif)", h("textarea", { name: "notes", rows: 3, maxlength: 1000 }, brouillon?.notes))],
            "Proposer un brouillon")) : h("p", { class: "discret-texte" }, "Génération par IA indisponible."),
        editeur,
        brouillon ? formulaire(action("POST", "publication", undefined, "Fiche publiée."), [], "Publier le brouillon enregistré") : null,
      ] : brouillon ? contenuFicheVente(brouillon) : h("p", {}, "Aucun brouillon.")),
    h("section", { class: "carte" }, h("h2", {}, "Texte publié"),
      publie ? [contenuFicheVente(publie),
        gere ? formulaire(action("POST", "retrait", undefined, "Fiche retirée."), [], "Retirer") : null]
        : h("p", {}, "Aucun texte publié.")),
    h("section", { class: "carte" }, h("h2", {}, "Historique"),
      d.historique.length ? d.historique.map((v) => h("details", {},
        h("summary", {}, `Version ${v.version} · ${libelle(ETATS_FICHES_VENTE, v.statut)} · ${v.source === "ia" ? "IA" : "Manuel"}`),
        h("p", { class: "discret-texte" }, [v.auteur, heure(v.cree_le), v.publie_le ? `Publication par ${v.publie_par || "—"} le ${heure(v.publie_le)}` : null].filter(Boolean).join(" · ")),
        contenuFicheVente(v))) : h("p", {}, "Aucune version enregistrée.")));
}
