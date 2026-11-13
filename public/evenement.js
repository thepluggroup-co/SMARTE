"use strict";
(async () => {
  const zone = document.getElementById("zone");
  const code = encodeURIComponent(new URLSearchParams(location.search).get("c") || "");
  const en = (new URLSearchParams(location.search).get("lang") || navigator.language || "fr").startsWith("en");
  const T = en
    ? { absent: "This event is not available.", nom: "Your name", tel: "Phone or WhatsApp", mail: "Email", ok: "I agree to be contacted about this event and that this information is kept for that purpose.", go: "Register", contact: "Enter a phone number or an email.", plein: "This event is full.", err: "Registration failed. Please try again.", places: "Seats left", gratuit: "Free", merci: "You are registered. Show this code at the entrance:", payer: "Payment is due before entry: ", deja: "Your registration is recorded. If you already registered, your earlier ticket remains valid.", par: "Speakers: " }
    : { absent: "Cet événement n'est pas disponible.", nom: "Votre nom", tel: "Téléphone ou WhatsApp", mail: "Email", ok: "J'accepte d'être contacté pour cet événement et que ces informations soient conservées pour cela.", go: "S'inscrire", contact: "Indiquez un téléphone ou un email.", plein: "Cet événement est complet.", err: "L'inscription a échoué. Réessayez.", places: "Places restantes", gratuit: "Gratuit", merci: "Vous êtes inscrit. Présentez ce code à l'entrée :", payer: "Paiement à régler avant l'entrée : ", deja: "Votre inscription est enregistrée. Si vous étiez déjà inscrit, votre premier billet reste valable.", par: "Intervenants : " };
  document.documentElement.lang = en ? "en" : "fr";
  const el = (tag, props = {}, ...enfants) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(props)) n.setAttribute(k, v); n.append(...enfants); return n; };
  const r = await fetch(`/evenement-public/${code}`).catch(() => null);
  if (!r?.ok) return zone.replaceChildren(el("p", { class: "etat rouge" }, T.absent));
  const m = await r.json();
  const fmt = (n) => `${Number(n).toLocaleString(en ? "en-GB" : "fr-FR")} FCFA`;
  const quand = new Date(m.debut).toLocaleString(en ? "en-GB" : "fr-FR", { dateStyle: "full", timeStyle: "short", timeZone: "Africa/Douala" });
  const champ = (t, a) => el("label", {}, t, el("input", a));
  const erreur = el("div", { role: "alert" });
  const form = el("form", { class: "carte" }, erreur, champ(T.nom, { name: "nom", required: "", maxlength: "200" }), champ(T.tel, { name: "telephone", type: "tel", maxlength: "30" }), champ(T.mail, { name: "email", type: "email", maxlength: "320" }),
    el("label", { style: "position:absolute;left:-9999px", "aria-hidden": "true" }, "Site", el("input", { name: "site", tabindex: "-1", autocomplete: "off" })),
    el("label", {}, el("input", { type: "checkbox", name: "consentement", required: "" }), ` ${T.ok}`), el("button", { type: "submit" }, T.go));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = new FormData(form);
    if (!v.get("telephone") && !v.get("email")) return erreur.replaceChildren(el("p", { class: "etat rouge" }, T.contact));
    const x = await fetch(`/evenement-public/${code}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nom: v.get("nom"), consentement: true, telephone: v.get("telephone") || undefined, email: v.get("email") || undefined, site: v.get("site") || undefined }) }).catch(() => null);
    const d = x ? await x.json().catch(() => ({})) : {};
    if (!x?.ok) return erreur.replaceChildren(el("p", { class: "etat rouge" }, d.erreur === "evenement_complet" ? T.plein : T.err));
    if (!d.code) return zone.replaceChildren(el("p", { class: "etat vert" }, T.deja));
    zone.replaceChildren(el("h1", {}, m.titre), el("p", { class: "etat vert" }, T.merci), el("img", { src: `data:image/svg+xml;base64,${btoa(d.qr_svg)}`, alt: "QR", width: "220", height: "220" }), el("p", { style: "font-size:1.5rem" }, d.code), d.prix ? el("p", {}, `${T.payer}${fmt(d.prix)}`) : el("span"));
  });
  const desc = el("p"); desc.textContent = m.description ?? "";
  zone.replaceChildren(el("h1", {}, m.titre), el("p", { class: "discret-texte" }, [quand, m.lieu].filter(Boolean).join(" · ")), desc, m.intervenants ? el("p", {}, `${T.par}${m.intervenants}`) : el("span"), el("p", {}, `${m.prix ? fmt(m.prix) : T.gratuit} · ${T.places} : ${m.places}`), m.places ? form : el("p", { class: "etat rouge" }, T.plein));
})();
