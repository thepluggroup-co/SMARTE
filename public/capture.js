"use strict";
(async () => {
  const anglais = (new URLSearchParams(location.search).get("lang") || navigator.language || "fr").startsWith("en");
  document.documentElement.lang = anglais ? "en" : "fr";
  const L = (f, e) => (anglais ? e : f);
  const zone = document.getElementById("zone");
  const code = encodeURIComponent(new URLSearchParams(location.search).get("c") || "");
  const el = (tag, props = {}, ...enfants) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) n.setAttribute(k, v);
    n.append(...enfants);
    return n;
  };
  const r = await fetch(`/capture/${code}`).catch(() => null);
  if (!r?.ok) return zone.replaceChildren(el("p", { class: "etat rouge" }, L("Ce formulaire n'est pas disponible.", 'This form is not available.')));
  const f = await r.json();
  const champ = (texte, attrs) => el("label", {}, texte, el("input", attrs));
  const erreur = el("div", { role: "alert" });
  const form = el("form", { class: "carte" }, erreur,
    champ(L('Votre nom', 'Your name'), { name: "nom", required: "", maxlength: "200", autocomplete: "name" }),
    champ(L('Téléphone ou WhatsApp', 'Phone or WhatsApp'), { name: "telephone", type: "tel", maxlength: "30", autocomplete: "tel" }),
    champ("Email", { name: "email", type: "email", maxlength: "320", autocomplete: "email" }),
    el("label", {}, L('Votre besoin', 'Your need'), el("textarea", { name: "message", rows: "3", maxlength: "2000" })),
    el("label", { style: "position:absolute;left:-9999px", "aria-hidden": "true" }, "Site", el("input", { name: "site", tabindex: "-1", autocomplete: "off" })),
    el("label", {}, el("input", { type: "checkbox", name: "consentement", required: "" }), L(" J'accepte d'être recontacté et que ces informations soient conservées pour cela.", ' I agree to be contacted and that this information is kept for that purpose.')),
    el("button", { type: "submit" }, L('Envoyer', 'Send')));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = new FormData(form);
    if (!v.get("telephone") && !v.get("email")) { erreur.replaceChildren(el("p", { class: "etat rouge" }, L('Indiquez un téléphone ou un email.', 'Enter a phone number or an email.'))); return; }
    const corps = { nom: v.get("nom"), consentement: true, message: v.get("message") || undefined, site: v.get("site") || undefined, telephone: v.get("telephone") || undefined, email: v.get("email") || undefined };
    const x = await fetch(`/capture/${code}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps) }).catch(() => null);
    if (x?.ok) return zone.replaceChildren(el("p", { class: "etat vert" }, L('Merci. Nous vous recontactons rapidement.', 'Thank you. We will contact you shortly.')));
    erreur.replaceChildren(el("p", { class: "etat rouge" }, L("L'envoi a échoué. Vérifiez vos informations et réessayez.", 'Sending failed. Check your details and try again.')));
  });
  zone.replaceChildren(el("h1", {}, f.titre), f.introduction ? el("p", {}, f.introduction) : el("span"), form);
})();
