(async () => {
  const zone = document.getElementById("zone");
  const code = encodeURIComponent(new URLSearchParams(location.search).get("c") || "");
  const el = (tag, props = {}, ...enfants) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) n.setAttribute(k, v);
    n.append(...enfants);
    return n;
  };
  const fin = (texte) => zone.replaceChildren(el("p", { class: "etat vert" }, texte));
  let info;
  try {
    const r = await fetch(`/avis-public/${code}`);
    if (!r.ok) return zone.replaceChildren(el("p", { class: "etat rouge" }, "Ce lien n'est pas valide."));
    info = await r.json();
  } catch {
    return zone.replaceChildren(el("p", { class: "etat rouge" }, "Connexion impossible. Réessayez."));
  }
  if (info.repondu) return fin("Votre avis a déjà été enregistré. Merci.");
  const notes = [["noteGlobale", "Votre satisfaction globale"], ["noteContenu", "Le contenu de la formation"], ["noteFormateur", "Le formateur"], ["noteOrganisation", "L'organisation et la salle"]];
  const groupe = (nom, libelle) => el("fieldset", { class: "notes" }, el("legend", {}, libelle),
    ...[1, 2, 3, 4, 5].map((n) => el("label", {}, el("input", { type: "radio", name: nom, value: n, required: "" }), ` ${n}`)));
  const erreur = el("div");
  const form = el("form", {},
    erreur,
    ...notes.map(([n, l]) => groupe(n, l)),
    el("fieldset", { class: "notes" }, el("legend", {}, "Recommanderiez-vous cette formation ?"),
      el("label", {}, el("input", { type: "radio", name: "recommande", value: "oui", required: "" }), " Oui"),
      el("label", {}, el("input", { type: "radio", name: "recommande", value: "non", required: "" }), " Non")),
    el("label", {}, "Commentaire (facultatif)", el("textarea", { name: "commentaire", rows: 4, maxlength: 2000 })),
    el("button", { type: "submit" }, "Envoyer mon avis"));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const v = Object.fromEntries(new FormData(form).entries());
    const r = await fetch(`/avis-public/${code}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        noteGlobale: +v.noteGlobale, noteContenu: +v.noteContenu, noteFormateur: +v.noteFormateur,
        noteOrganisation: +v.noteOrganisation, recommande: v.recommande === "oui",
        ...(v.commentaire.trim() ? { commentaire: v.commentaire.trim() } : {}),
      }),
    }).catch(() => null);
    if (r && (r.ok || r.status === 409)) return fin("Merci, votre avis est enregistré.");
    erreur.replaceChildren(el("div", { class: "erreur", role: "alert" }, "L'envoi a échoué. Réessayez."));
  });
  zone.replaceChildren(
    el("h1", {}, "Votre avis"),
    el("p", {}, `${info.programme}, ${info.ville}`),
    el("p", { class: "discret-texte" }, "Notez de 1 (faible) à 5 (excellent). Votre nom n'apparaît pas dans les résultats."),
    form);
})();
