"use strict";
(async () => {
  const anglais = (new URLSearchParams(location.search).get("lang") || navigator.language || "fr").startsWith("en");
  document.documentElement.lang = anglais ? "en" : "fr";
  const L = (f, e) => (anglais ? e : f);
  const zone = document.getElementById("zone");
  const code = encodeURIComponent(new URLSearchParams(location.search).get("c") || "");
  const el = (tag, props = {}, ...enfants) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(props)) n.setAttribute(k, v); n.append(...enfants); return n; };
  const r = await fetch(`/offre-public/${code}`).catch(() => null);
  if (!r?.ok) return zone.replaceChildren(el("p", { class: "etat rouge" }, L("Cette offre n'est plus disponible.", 'This job offer is no longer available.')));
  const o = await r.json();
  const champ = (t, a) => el("label", {}, t, el("input", a));
  const erreur = el("div", { role: "alert" });
  const form = el("form", { class: "carte" }, erreur, el("h2", {}, L('Postuler', 'Apply')), champ(L('Votre nom', 'Your name'), { name: "nom", required: "", maxlength: "200" }), champ(L('Téléphone', 'Phone'), { name: "telephone", type: "tel", maxlength: "30" }), champ("Email", { name: "email", type: "email", maxlength: "320" }),
    el("label", {}, L('Présentation', 'About you'), el("textarea", { name: "presentation", rows: "5", maxlength: "3000" })), champ(L('Votre CV en PDF, 5 Mo au plus (facultatif)', 'Your CV as a PDF, 5 MB maximum (optional)'), { name: "cv", type: "file", accept: "application/pdf" }), champ(L('Ou un lien vers votre CV (https, facultatif)', 'Or a link to your CV (https, optional)'), { name: "lienCv", type: "url", pattern: "https://.*", maxlength: "1000" }),
    el("label", { style: "position:absolute;left:-9999px", "aria-hidden": "true" }, "Site", el("input", { name: "site", tabindex: "-1", autocomplete: "off" })),
    el("label", {}, el("input", { type: "checkbox", name: "consentement", required: "" }), L(" J'accepte que ces informations soient conservées pour traiter ma candidature.", ' I agree that this information is kept to process my application.')), el("button", { type: "submit" }, L('Envoyer', 'Send')));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = new FormData(form);
    if (!v.get("telephone") && !v.get("email")) return erreur.replaceChildren(el("p", { class: "etat rouge" }, L('Indiquez un téléphone ou un email.', 'Enter a phone number or an email.')));
    const corps = { nom: v.get("nom"), consentement: true, telephone: v.get("telephone") || undefined, email: v.get("email") || undefined, presentation: v.get("presentation") || undefined, lienCv: v.get("lienCv") || undefined, site: v.get("site") || undefined };
    const x = await fetch(`/offre-public/${code}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps) }).catch(() => null);
    if (x?.ok) {
      const cv = form.cv.files[0];
      let note = "";
      if (cv) {
        const { depot } = await x.json();
        const d = await fetch(`/offre-public/${code}/cv?depot=${encodeURIComponent(depot)}`, { method: "PUT", headers: { "content-type": "application/pdf" }, body: cv }).catch(() => null);
        if (!d?.ok) note = L(" Votre CV n'a pas pu être joint : il doit être un PDF de 5 Mo au plus.", " Your CV could not be attached: it must be a PDF of 5 MB at most.");
      }
      return zone.replaceChildren(el("p", { class: "etat vert" }, `${L("Merci. Votre candidature est enregistrée.", "Thank you. Your application is recorded.")}${note}`));
    }
    erreur.replaceChildren(el("p", { class: "etat rouge" }, L("L'envoi a échoué. Vérifiez vos informations et réessayez.", 'Sending failed. Check your details and try again.')));
  });
  const p = el("p", {}); p.textContent = o.description;
  zone.replaceChildren(el("h1", {}, o.titre), el("p", { class: "discret-texte" }, [o.employeur, o.lieu].filter(Boolean).join(" · ")), p, form);
})();
