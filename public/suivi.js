"use strict";
(async () => {
  const zone = document.getElementById("zone");
  const NOMS = { prepare: "Préparé", expedie: "Expédié", en_transit: "En transit", arrive: "Arrivé", en_livraison: "En livraison", livre: "Livré", echec: "Livraison manquée", retour: "Retourné" };
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x !== undefined) n.textContent = x; return n; };
  zone.textContent = "";
  try {
    const r = await fetch(`/suivi/${encodeURIComponent(new URLSearchParams(location.search).get("c") || "")}`);
    if (!r.ok) return zone.append(el("p", "etat rouge", "Ce lien de suivi n'est pas valide."));
    const d = await r.json();
    const carte = el("div", "carte");
    carte.append(el("h1", "", `Colis ${d.numero}`), el("p", "grand", NOMS[d.statut] || d.statut));
    if (d.prevu_le && d.statut !== "livre") carte.append(el("p", "discret-texte", `Livraison prévue le ${d.prevu_le.split("-").reverse().join("/")}`));
    for (const e of d.etapes) {
      const l = el("div", "ligne apprenant");
      l.append(el("span", "", NOMS[e.statut] || e.statut), el("span", "discret-texte", new Date(e.le).toLocaleString("fr-FR", { timeZone: "Africa/Douala", dateStyle: "short", timeStyle: "short" })));
      carte.append(l);
    }
    zone.append(carte);
  } catch {
    zone.append(el("p", "etat rouge", "Connexion impossible. Réessayez."));
  }
})();
