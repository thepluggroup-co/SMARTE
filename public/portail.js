"use strict";
const zone = document.getElementById("zone");
const code = encodeURIComponent(new URLSearchParams(location.search).get("c") || "");
const el = (t, a = {}, ...e) => { const n = document.createElement(t); for (const [k, v] of Object.entries(a)) { if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); } n.append(...e.flat().filter((x) => x !== null && x !== undefined)); return n; };
const fcfa = (n) => `${Number(n).toLocaleString("fr-FR")} FCFA`;
const prixAvant = (p, q) => [...p.paliers].sort((a, b) => b.quantite_min - a.quantite_min).find((x) => q >= x.quantite_min)?.prix ?? p.prix_vente;
const prixPour = (p, q) => { const x = prixAvant(p, q); const o = p.promo; return !o ? x : o.type === "pourcentage" ? Math.round((x * (100 - o.valeur)) / 100) : Math.max(x - o.valeur, 0); };
async function charger(message) {
  let d;
  try {
    const r = await fetch(`/portail/${code}`);
    if (!r.ok) return zone.replaceChildren(el("p", { class: "etat rouge" }, "Ce lien n'est pas valide ou l'accès a été retiré."));
    d = await r.json();
  } catch { return zone.replaceChildren(el("p", { class: "etat rouge" }, "Connexion impossible. Réessayez.")); }
  const total = el("p", { class: "grand" }, "Total HT estimé : 0 FCFA");
  const champs = d.catalogue.map((p) => {
    const i = el("input", { type: "number", min: "0", step: "any", "aria-label": `Quantité de ${p.nom}`, oninput: () => {
      total.textContent = `Total HT estimé : ${fcfa(champs.reduce((s, c) => s + Math.round(Number(c.i.value || 0) * prixPour(c.p, Number(c.i.value || 0))), 0))}`;
    } });
    return { p, i };
  });
  const note = el("textarea", { rows: "2", "aria-label": "Note" });
  const erreur = el("div");
  zone.replaceChildren(el("div", {},
    el("h1", {}, d.nom), message ? el("div", { class: "succes", role: "status" }, message) : null,
    d.credit ? el("div", { class: "carte" }, el("h2", {}, "Crédit"), el("p", {}, `Encours ${fcfa(d.credit.encours)} sur ${fcfa(d.credit.plafond)}. Délai : ${d.delai_jours} jours.`)) : null,
    el("div", { class: "carte" }, el("h2", {}, "Commander"), champs.map(({ p, i }) => el("div", { class: "apprenant" }, el("div", { class: "ligne" }, el("span", { class: "nom" }, p.nom), el("span", {}, fcfa(p.prix_vente))),
      p.paliers.length ? el("div", { class: "discret-texte" }, p.paliers.map((x) => `Dès ${x.quantite_min} : ${fcfa(x.prix)}`).join(" · ")) : null, i)),
    total, el("label", {}, "Note", note), erreur, el("button", { type: "button", onclick: async () => {
      const lignes = champs.filter((c) => Number(c.i.value) > 0).map((c) => ({ produitId: c.p.id, quantite: Number(c.i.value) }));
      if (!lignes.length) return erreur.replaceChildren(el("div", { class: "erreur" }, "Indiquez au moins une quantité."));
      const r = await fetch(`/portail/${code}/commandes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lignes, note: note.value || undefined }) }).catch(() => null);
      if (!r?.ok) return erreur.replaceChildren(el("div", { class: "erreur" }, "L'envoi a échoué. Réessayez."));
      charger("Commande envoyée. Un commercial va la confirmer.");
    } }, "Envoyer la commande")),
    el("div", { class: "carte" }, el("h2", {}, "Mes commandes"), d.commandes.length ? d.commandes.map((c) => el("div", { class: "ligne apprenant" }, el("span", {}, `${fcfa(c.total_ht)} HT`), el("span", { class: "pastille attente" }, { soumise: "En attente", acceptee: "Acceptée", refusee: `Refusée : ${c.motif}` }[c.statut]))) : el("p", { class: "discret-texte" }, "Aucune commande.")),
    el("div", { class: "carte" }, el("h2", {}, "Mes factures"), d.factures.length ? d.factures.map((f) => el("div", { class: "ligne apprenant" }, el("span", {}, `${f.numero} · ${String(f.date_document).split("-").reverse().join("/")}`), el("span", {}, `Reste ${fcfa(f.reste)}`))) : el("p", { class: "discret-texte" }, "Aucune facture.")),
  ));
}
charger();
