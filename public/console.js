"use strict";
(() => {
  const zone = document.getElementById("zone");
  const el = (tag, props = {}, ...enfants) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); } n.append(...enfants.flat().filter((x) => x != null)); return n; };
  let cle = "";
  const api = async (m, u, c) => { const r = await fetch(u, { method: m, headers: { "x-console-cle": cle, ...(c ? { "content-type": "application/json" } : {}) }, body: c ? JSON.stringify(c) : undefined }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.erreur || "erreur"); return d; };
  const champ = (t, a) => el("label", {}, t, el("input", a));
  const connexion = (msg) => zone.replaceChildren(el("h1", {}, "Console de la plateforme"), msg ? el("p", { class: "etat rouge" }, msg) : "", el("form", { class: "carte", onsubmit: (e) => { e.preventDefault(); cle = e.target.c.value; e.target.c.value = ""; charger(); } }, champ("Clé de la console", { name: "c", type: "password", required: "", autocomplete: "off" }), el("button", { type: "submit" }, "Entrer")));
  const charger = async (msg) => {
    let o, p;
    try { [o, p] = await Promise.all([api("GET", "/console/organisations"), api("GET", "/console/plans")]); } catch { cle = ""; return connexion("Clé refusée ou console fermée."); }
    const agir = (fn, m) => async (e) => { e.preventDefault?.(); try { await fn(e); charger(m); } catch (x) { charger(`Échec : ${x.message}`); } };
    zone.replaceChildren(el("h1", {}, "Organisations"), msg ? el("p", { class: "etat", role: "status" }, msg) : "",
      el("div", { class: "carte" }, o.map((x) => el("div", { class: "apprenant" }, el("div", { class: "nom" }, `${x.nom} (${x.slug})`), el("div", { class: "discret-texte" }, `${x.statut} · Offre ${x.plan ?? "aucune"} · ${x.utilisateurs} utilisateur(s)${x.prochaine_echeance ? ` · Échéance ${x.prochaine_echeance}` : ""}`),
        el("button", { class: "discret", onclick: agir(() => api("PATCH", `/console/organisations/${x.id}`, { statut: x.statut === "active" ? "suspendue" : "active" }), "Statut modifié.") }, x.statut === "active" ? "Suspendre" : "Réactiver"),
        el("select", { "aria-label": "Offre", onchange: agir((e) => api("PATCH", `/console/organisations/${x.id}`, { plan: e.target.value }), "Offre modifiée.") }, el("option", { value: "" }, "Changer d'offre"), p.map((y) => el("option", { value: y.code }, y.nom)))))),
      el("form", { class: "carte", onsubmit: agir((e) => { const f = e.target; return api("POST", "/console/organisations", { slug: f.s.value.trim(), nom: f.n.value.trim(), plan: f.p.value, adminEmail: f.e.value.trim(), adminNom: f.a.value.trim(), adminMotDePasse: f.m.value }); }, "Organisation créée.") }, el("h2", {}, "Nouvelle organisation"), champ("Identifiant court", { name: "s", required: "", pattern: "[a-z0-9-]{2,40}" }), champ("Nom", { name: "n", required: "" }), el("label", {}, "Offre", el("select", { name: "p" }, p.map((y) => el("option", { value: y.code }, y.nom)))), champ("Email de l'administrateur", { name: "e", type: "email", required: "" }), champ("Nom de l'administrateur", { name: "a", required: "" }), champ("Mot de passe, 8 caractères minimum", { name: "m", type: "password", minlength: "8", required: "", autocomplete: "new-password" }), el("button", { type: "submit" }, "Créer")));
  };
  connexion();
})();
