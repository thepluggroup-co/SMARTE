"use strict";
const zone = document.getElementById("zone");
const code = encodeURIComponent(new URLSearchParams(location.search).get("c") || "");
const el = (tag, props = {}, ...enfants) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  n.append(...enfants.flat().filter((x) => x !== null && x !== undefined));
  return n;
};

async function charger(message) {
  let d;
  try {
    const r = await fetch(`/apprendre/${code}`);
    if (r.status === 409) return zone.replaceChildren(el("div", { class: "carte" }, el("p", { class: "etat rouge" }, "Votre accès est suspendu. Merci de contacter l'organisme.")));
    if (!r.ok) return zone.replaceChildren(el("div", { class: "carte" }, el("p", { class: "etat rouge" }, "Ce lien n'est pas valide ou l'accès a été retiré.")));
    d = await r.json();
  } catch {
    return zone.replaceChildren(el("div", { class: "carte" }, el("p", { class: "etat rouge" }, "Connexion impossible. Réessayez.")));
  }
  const echanges = await fetch(`/apprendre/${code}/echanges`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
  const courante = d.lecons.find((l) => l.ouverte && !l.terminee);
  zone.replaceChildren(el("div", {},
    el("h1", {}, d.titre),
    d.description ? el("p", { class: "discret-texte" }, d.description) : null,
    el("p", {}, `Progression : ${d.progression} %`),
    message ? el("div", { class: message.ok ? "succes" : "erreur", role: "status" }, message.texte) : null,
    d.termine ? el("div", { class: "carte" }, el("p", { class: "etat vert" }, "Félicitations, vous avez terminé ce cours.")) : null,
    d.certificat ? certificat(d.certificat) : null,
    courante ? lecon(courante, d.seuil) : null,
    echanges ? zoneEchanges(echanges) : null,
    el("div", { class: "carte" }, el("h2", {}, "Programme"), d.lecons.map((l, i) => el("div", { class: "ligne apprenant" },
      el("span", {}, `${i + 1}. ${l.titre}`),
      el("span", { class: l.terminee ? "pastille ok" : "pastille attente" }, l.terminee ? "Terminée" : l.ouverte ? "En cours" : "À venir")))),
  ));
  window.scrollTo(0, 0);
}

function certificat(c) {
  const qr = new DOMParser().parseFromString(c.qr_svg, "image/svg+xml").documentElement;
  qr.setAttribute("class", "qr");
  qr.setAttribute("role", "img");
  qr.setAttribute("aria-label", "QR code de vérification du certificat");
  return el("div", { class: "document" },
    el("h2", {}, "Certificat de réussite"),
    el("p", {}, "Ce certificat est délivré à"),
    el("p", { class: "grand" }, c.titulaire),
    el("p", {}, `pour avoir terminé le cours : ${c.cours}`),
    el("p", {}, `N° ${c.numero}, délivré le ${c.delivre_le.split("-").reverse().join("/")}`),
    qr,
    el("p", { class: "discret-texte" }, "Scannez ce code pour vérifier l'authenticité du certificat."),
    el("button", { type: "button", class: "pas-imprimer", onclick: () => window.print() }, "Imprimer"));
}

function direct(l) {
  const debut = new Date(l.direct_le);
  const passe = debut.getTime() + 4 * 3600 * 1000 < Date.now();
  return el("div", { class: "alerte-caisse" },
    el("p", {}, `Cours en direct : ${debut.toLocaleString("fr-FR", { timeZone: "Africa/Douala", dateStyle: "full", timeStyle: "short" })}`),
    l.direct_lien && !passe ? el("a", { href: l.direct_lien, target: "_blank", rel: "noopener noreferrer", class: "lien-bouton" }, "Rejoindre le cours en direct") : null,
    passe ? el("p", {}, "Ce direct est passé. Regardez l'enregistrement s'il est disponible.") : null);
}

function lecon(l, seuil) {
  const form = el("form", {}, l.questions.map((q, i) => el("fieldset", { class: "notes" }, el("legend", {}, q.enonce),
    q.choix.map((c, j) => el("label", { class: "choix" }, el("input", { type: "radio", name: `q${i}`, value: j, required: "" }), ` ${c}`)))),
    el("button", { type: "submit" }, l.questions.length ? "Envoyer mes réponses" : "Marquer comme terminée"));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const v = new FormData(form);
    const reponses = l.questions.map((_, i) => Number(v.get(`q${i}`)));
    const r = await fetch(`/apprendre/${code}/lecons/${l.id}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reponses }),
    }).catch(() => null);
    if (!r || !r.ok) return charger({ ok: false, texte: "L'envoi a échoué. Réessayez." });
    const d = await r.json();
    if (d.score === null) return charger({ ok: true, texte: "Leçon terminée." });
    charger(d.reussi ? { ok: true, texte: `Réussi : ${d.score} %.` } : { ok: false, texte: `Résultat : ${d.score} %. Il faut ${d.seuil} %. Relisez la leçon et réessayez.` });
  });
  return el("div", { class: "carte" }, el("h2", {}, l.titre),
    l.direct_le ? direct(l) : null,
    l.video ? el("video", { class: "video-cours", controls: "", preload: "metadata", playsinline: "", controlslist: "nodownload", src: `/apprendre/${code}/lecons/${l.id}/video` }) : null,
    l.contenu ? el("p", { class: "contenu" }, l.contenu) : null,
    l.url ? el("p", {}, el("a", { href: l.url, target: "_blank", rel: "noopener noreferrer", class: "lien-bouton" }, "Ouvrir la vidéo ou le document")) : null,
    l.questions.length ? el("p", { class: "discret-texte" }, `Note minimale : ${seuil} %.`) : null,
    form);
}

function zoneEchanges(e) {
  const poster = async (url, corps) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps) }).catch(() => null);
    charger(r?.ok ? { ok: true, texte: "C'est enregistré." } : { ok: false, texte: "L'envoi a échoué." });
  };
  const formulaireTexte = (etiquette, bouton, envoyer) => {
    const t = el("textarea", { rows: "3", required: "", maxlength: "5000", "aria-label": etiquette });
    const f = el("form", {}, el("label", {}, etiquette, t), el("button", { type: "submit" }, bouton));
    f.addEventListener("submit", (ev) => { ev.preventDefault(); envoyer(t.value.trim()); });
    return f;
  };
  return el("div", {},
    el("p", { class: "discret-texte" }, `Vos points : ${e.points}`),
    e.devoirs.length ? el("div", { class: "carte" }, el("h2", {}, "Devoirs"), e.devoirs.map((d) => el("div", { class: "apprenant" }, el("div", { class: "nom" }, d.titre), el("p", {}, d.consigne), d.note !== null ? el("p", { class: "etat vert" }, `Note : ${Number(d.note)} / 20${d.commentaire ? `. ${d.commentaire}` : ""}`) : formulaireTexte(d.contenu ? "Modifier votre rendu" : "Votre rendu", "Rendre", (v) => poster(`/apprendre/${code}/devoirs/${d.id}`, { contenu: v }))))) : null,
    el("div", { class: "carte" }, el("h2", {}, "Questions au formateur"), e.mes_questions.map((q) => el("p", {}, `${q.question}${q.reponse ? ` : ${q.reponse}` : " (en attente)"}`)), e.questions.filter((q) => !e.mes_questions.some((m) => m.question === q.question)).map((q) => el("p", { class: "discret-texte" }, `${q.auteur} : ${q.question} : ${q.reponse}`)), formulaireTexte("Votre question", "Envoyer", (v) => poster(`/apprendre/${code}/questions`, { question: v }))));
}

charger();
