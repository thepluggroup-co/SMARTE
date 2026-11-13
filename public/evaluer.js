"use strict";
(async () => {
  const zone = document.getElementById("zone");
  const code = encodeURIComponent(new URLSearchParams(location.search).get("c") || "");
  const el = (t, a = {}, ...e) => { const n = document.createElement(t); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); n.append(...e); return n; };
  const fin = (texte, c = "etat vert") => zone.replaceChildren(el("p", { class: c }, texte));
  try {
    const r = await fetch(`/evaluer/${code}`);
    if (!r.ok) return fin("Ce lien n'est pas valide.", "etat rouge");
    const d = await r.json();
    if (d.repondu) return fin("Votre avis a déjà été reçu. Merci.");
    const notes = el("fieldset", { class: "notes" }, el("legend", {}, "Votre note"));
    for (let i = 5; i >= 1; i -= 1) notes.append(el("label", { class: "choix" }, el("input", { type: "radio", name: "note", value: String(i), required: "" }), ` ${i} sur 5`));
    const f = el("form", {}, notes, el("label", {}, "Commentaire (facultatif). N'indiquez pas de numéro ni d'adresse.", el("textarea", { name: "commentaire", rows: "4", maxlength: "2000" })),
      el("label", { class: "choix" }, el("input", { type: "checkbox", name: "temoignage" }), " J'accepte que cet avis soit repris comme témoignage"), el("button", { type: "submit" }, "Envoyer"));
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = new FormData(f);
      const s = await fetch(`/evaluer/${code}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note: Number(v.get("note")), commentaire: v.get("commentaire") || undefined, temoignage: v.get("temoignage") === "on" }) }).catch(() => null);
      fin(s?.ok ? "Merci pour votre avis." : "L'envoi a échoué. Réessayez.", s?.ok ? "etat vert" : "etat rouge");
    });
    zone.replaceChildren(el("h1", {}, d.cible), f);
  } catch { fin("Connexion impossible. Réessayez.", "etat rouge"); }
})();
