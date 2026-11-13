"use strict";
(async () => {
  const zone = document.getElementById("zone");
  const org = encodeURIComponent(new URLSearchParams(location.search).get("o") || "");
  const en = (new URLSearchParams(location.search).get("lang") || navigator.language || "fr").startsWith("en");
  const L = (f, e) => (en ? e : f);
  document.documentElement.lang = en ? "en" : "fr";
  const el = (tag, props = {}, ...enfants) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(props)) n.setAttribute(k, v); n.append(...enfants); return n; };
  const r = await fetch(`/boutique/${org}`).catch(() => null);
  if (!r?.ok) return zone.replaceChildren(el("p", { class: "etat rouge" }, L("Cette boutique n'est pas disponible.", "This shop is not available.")));
  const cours = await r.json();
  const champ = (t, a) => el("label", {}, t, el("input", a));
  zone.replaceChildren(el("h1", {}, L("Nos cours", "Our courses")), ...(cours.length ? cours.map((c) => {
    const err = el("div", { role: "alert" });
    const f = el("form", {}, err, champ(L("Votre nom", "Your name"), { name: "nom", required: "", maxlength: "200" }), champ(L("Téléphone", "Phone"), { name: "telephone", type: "tel", maxlength: "30" }), champ("Email", { name: "email", type: "email" }), el("label", { style: "position:absolute;left:-9999px", "aria-hidden": "true" }, "Site", el("input", { name: "site", tabindex: "-1", autocomplete: "off" })), el("label", {}, el("input", { type: "checkbox", name: "consentement", required: "" }), L(" J'accepte d'être contacté pour ce cours.", " I agree to be contacted about this course.")), el("button", { type: "submit" }, L("Je suis intéressé", "I am interested")));
    const carte = el("div", { class: "carte" }, el("h2", {}, c.titre), el("p", {}, c.description ?? ""), el("p", { class: "discret-texte" }, `${c.lecons} ${L("leçons", "lessons")} · ${c.prix ? `${Number(c.prix).toLocaleString(en ? "en-GB" : "fr-FR")} FCFA` : L("Gratuit", "Free")}`), f);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = new FormData(f);
      if (!v.get("telephone") && !v.get("email")) return err.replaceChildren(el("p", { class: "etat rouge" }, L("Indiquez un téléphone ou un email.", "Enter a phone number or an email.")));
      const x = await fetch(`/boutique/${org}/cours/${c.id}/demande`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nom: v.get("nom"), consentement: true, telephone: v.get("telephone") || undefined, email: v.get("email") || undefined, site: v.get("site") || undefined }) }).catch(() => null);
      if (x?.ok) f.replaceWith(el("p", { class: "etat vert" }, L("Merci. Nous vous contactons pour le paiement et l'accès.", "Thank you. We will contact you about payment and access.")));
      else err.replaceChildren(el("p", { class: "etat rouge" }, L("L'envoi a échoué.", "Sending failed.")));
    });
    return carte;
  }) : [el("p", {}, L("Aucun cours pour le moment.", "No course yet."))]));
})();
