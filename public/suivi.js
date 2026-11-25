"use strict";
(async () => {
  const zone = document.getElementById("zone");
  const NOMS = { prepare: "Préparé", expedie: "Expédié", en_transit: "En transit", arrive: "Arrivé", en_livraison: "En livraison", livre: "Livré", echec: "Livraison manquée", retour: "Retourné" };
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x !== undefined) n.textContent = x; return n; };
  try {
    const r = await fetch(`/suivi/${encodeURIComponent(new URLSearchParams(location.search).get("c") || "")}`);
    if (!r.ok) {
      const erreur = el("p", "erreur", "Ce lien de suivi n'est pas valide.");
      erreur.setAttribute("role", "alert");
      return zone.replaceChildren(erreur);
    }
    const d = await r.json();
    const carte = el("div", "carte");
    carte.append(el("h1", "", `Colis ${d.numero}`), el("p", "grand", NOMS[d.statut] || d.statut));
    if (d.prevu_le && d.statut !== "livre") carte.append(el("p", "discret-texte", `Livraison prévue le ${d.prevu_le.split("-").reverse().join("/")}`));
    const etapes = el("ol", "etapes-suivi");
    for (const e of d.etapes) {
      const l = el("li", "ligne apprenant");
      l.append(el("span", "", NOMS[e.statut] || e.statut), el("span", "discret-texte", new Date(e.le).toLocaleString("fr-FR", { timeZone: "Africa/Douala", dateStyle: "short", timeStyle: "short" })));
      etapes.append(l);
    }
    if (d.etapes.length) carte.append(el("h2", "", "Historique de livraison"), etapes);
    zone.replaceChildren(carte);
  } catch {
    const erreur = el("p", "erreur", "Connexion impossible.");
    erreur.setAttribute("role", "alert");
    const bouton = el("button", "discret", "Réessayer");
    bouton.type = "button";
    bouton.addEventListener("click", () => location.reload());
    zone.replaceChildren(erreur, bouton);
  }
})();
