"use strict";
(async () => {
  const zone = document.getElementById("zone");
  const code = encodeURIComponent(new URLSearchParams(location.search).get("c") || "");
  const el = (t, a = {}, ...e) => { const n = document.createElement(t); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); n.append(...e); return n; };
  const fin = (texte, c = "etat vert") => zone.replaceChildren(el("p", { class: c, role: c === "etat rouge" ? "alert" : "status" }, texte));
  try {
    const r = await fetch(`/evaluer/${code}`);
    if (!r.ok) return fin("Ce lien n'est pas valide.", "etat rouge");
    const d = await r.json();
    if (d.repondu) return fin("Votre avis a déjà été reçu. Merci.");
    const envoyer = async (f, erreur, corps) => {
      const bouton = f.querySelector('button[type="submit"]');
      if (bouton.disabled) return;
      erreur.hidden = true;
      bouton.disabled = true;
      f.setAttribute("aria-busy", "true");
      const s = await fetch(`/evaluer/${code}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps) }).catch(() => null);
      if (s?.ok) return fin("Merci pour votre avis.");
      erreur.textContent = "L'envoi a échoué. Réessayez.";
      erreur.hidden = false;
      bouton.disabled = false;
      f.removeAttribute("aria-busy");
    };
    // Une commande se note article par article ; chaque note est facultative, au moins une est demandée.
    if (d.articles) {
      const blocs = d.articles.map((a, n) => {
        const choix = el("fieldset", { class: "notes" }, el("legend", {}, a.nom));
        for (let i = 5; i >= 1; i -= 1) choix.append(el("label", { class: "choix" }, el("input", { type: "radio", name: `note${n}`, value: String(i) }), ` ${i} sur 5`));
        choix.append(el("label", {}, "Commentaire (facultatif). N'indiquez pas de numéro ni d'adresse.", el("textarea", { name: `commentaire${n}`, rows: "3", maxlength: "2000" })));
        return choix;
      });
      const erreur = el("p", { class: "erreur", role: "alert", hidden: "" });
      const f = el("form", {}, ...blocs, erreur, el("button", { type: "submit" }, "Envoyer"));
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        const v = new FormData(f);
        const notes = d.articles.map((a, n) => ({ produitId: a.produit_id, note: Number(v.get(`note${n}`)), commentaire: v.get(`commentaire${n}`) || undefined })).filter((x) => x.note);
        if (!notes.length) { erreur.textContent = "Donnez une note à au moins un article."; erreur.hidden = false; return; }
        await envoyer(f, erreur, { notes });
      });
      return zone.replaceChildren(el("h1", {}, d.cible), el("p", {}, "Notez les articles reçus, de 1 à 5."), f);
    }
    const notes = el("fieldset", { class: "notes" }, el("legend", {}, "Votre note"));
    for (let i = 5; i >= 1; i -= 1) notes.append(el("label", { class: "choix" }, el("input", { type: "radio", name: "note", value: String(i), required: "" }), ` ${i} sur 5`));
    const erreur = el("p", { class: "erreur", role: "alert", hidden: "" });
    const f = el("form", {}, notes, el("label", {}, "Commentaire (facultatif). N'indiquez pas de numéro ni d'adresse.", el("textarea", { name: "commentaire", rows: "4", maxlength: "2000" })),
      el("label", { class: "choix" }, el("input", { type: "checkbox", name: "temoignage" }), " J'accepte que cet avis soit repris comme témoignage"), erreur, el("button", { type: "submit" }, "Envoyer"));
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = new FormData(f);
      await envoyer(f, erreur, { note: Number(v.get("note")), commentaire: v.get("commentaire") || undefined, temoignage: v.get("temoignage") === "on" });
    });
    zone.replaceChildren(el("h1", {}, d.cible), f);
  } catch { fin("Connexion impossible. Réessayez.", "etat rouge"); }
})();
