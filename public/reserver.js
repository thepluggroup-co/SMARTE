"use strict";
(async () => {
  const anglais = (new URLSearchParams(location.search).get("lang") || navigator.language || "fr").startsWith("en");
  document.documentElement.lang = anglais ? "en" : "fr";
  const L = (f, e) => (anglais ? e : f);
  const zone = document.getElementById("zone");
  const code = encodeURIComponent(new URLSearchParams(location.search).get("c") || "");
  const el = (tag, props = {}, ...enfants) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === "onclick") n.onclick = v; else n.setAttribute(k, v); } n.append(...enfants); return n; };
  const quand = (d) => new Date(d).toLocaleString(anglais ? "en-GB" : "fr-FR", { dateStyle: "full", timeStyle: "short", timeZone: "Africa/Douala" });
  const charger = async (message) => {
    const r = await fetch(`/reservation-coaching/${code}`).catch(() => null);
    if (!r?.ok) return zone.replaceChildren(el("p", { class: "etat rouge" }, L("Ce lien n'est pas valide.", 'This link is not valid.')));
    const d = await r.json();
    const agir = async (url, corps) => {
      const x = await fetch(url, { method: "POST", headers: corps ? { "content-type": "application/json" } : {}, body: corps ? JSON.stringify(corps) : undefined }).catch(() => null);
      const e = x ? await x.json().catch(() => ({})) : {};
      if (x?.ok) return charger(L("C'est enregistré.", "Saved."));
      charger({ creneau_pris: L("Ce créneau vient d'être pris.", "This slot was just taken."), forfait_epuise: L("Votre forfait est épuisé.", "Your package is used up."), annulation_trop_tardive: L("Annulation possible jusqu'à 24 heures avant.", "Cancellation is possible up to 24 hours before.") }[e.erreur] || L("L'opération a échoué.", "The operation failed."));
    };
    zone.replaceChildren(el("h1", {}, d.titre), el("p", {}, d.client), message ? el("p", { class: "etat", role: "status" }, message) : el("span"),
      d.restant === null ? el("span") : el("p", { class: "discret-texte" }, `${L("Séances restantes", "Sessions left")} : ${d.restant}`),
      el("div", { class: "carte" }, el("h2", {}, L('Mes séances', 'My sessions')), ...(d.seances.length ? d.seances.map((s) => el("div", { class: "apprenant" }, el("p", {}, quand(s.debut)), s.lien_visio ? el("a", { href: s.lien_visio, target: "_blank", rel: "noopener noreferrer" }, L('Rejoindre', 'Join')) : el("span"), s.annulable ? el("button", { class: "discret", onclick: () => agir(`/reservation-coaching/${code}/seances/${s.id}/annulation`) }, L('Annuler', 'Cancel')) : el("span"))) : [el("p", {}, L('Aucune séance prévue.', 'No session planned.'))])),
      d.ressources.length ? el("div", { class: "carte" }, el("h2", {}, L('Ressources', 'Resources')), ...d.ressources.map((r) => el("p", {}, el("a", { href: r.url, target: "_blank", rel: "noopener noreferrer" }, r.titre)))) : el("span"),
      el("div", { class: "carte" }, el("h2", {}, L('Créneaux disponibles', 'Available slots')), ...(d.creneaux.length ? d.creneaux.map((c) => el("div", { class: "ligne apprenant" }, el("span", {}, `${quand(c.debut)} · ${c.duree_minutes} min`), el("button", { onclick: () => agir(`/reservation-coaching/${code}`, { creneauId: c.id }) }, L('Réserver', 'Book')))) : [el("p", {}, L('Aucun créneau pour le moment.', 'No slot for now.'))])));
  };
  charger();
})();
