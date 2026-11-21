"use strict";
/* Commandes en ligne de la Marketplace GLOMARI. Le serveur calcule et contrôle tout : l'écran affiche et transmet. */

const STATUTS_WEB = { reservee: "Réservée", payee: "Payée", facturee: "Facturée", expediee: "Expédiée", livree: "Livrée", annulee: "Annulée", expiree: "Expirée" };
const MOYENS_WEB = { orange_money: "Orange Money", mtn_momo: "MTN MoMo", a_la_livraison: "À la livraison" };
const MODES_WEB = { domicile: "Domicile", agence_voyage: "Agence de voyage", point_relais: "Point relais", retrait_magasin: "Retrait au magasin" };
const enAttenteWeb = (c) => c.statut === "reservee" && !c.colis_id;
const pastilleWeb = (c) => ["annulee", "expiree"].includes(c.statut) ? "pastille retard" : enAttenteWeb(c) ? "pastille attente" : "pastille ok";
const dateHeureFr = (d) => new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

async function ecranCommandesEnLigne(message, filtre = "") {
  const commandes = await api("GET", `/commandes-web${filtre ? `?statut=${filtre}` : ""}`);
  const gere = droits.includes("facturation.gerer");
  vue(h("h1", {}, "Commandes en ligne"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "actions" },
      h("label", {}, "Statut ", h("select", { onchange: (e) => ecranCommandesEnLigne(null, e.target.value) }, h("option", { value: "" }, "Tous"),
        Object.entries(STATUTS_WEB).map(([code, libelle]) => h("option", { value: code, selected: code === filtre }, libelle)))),
      droits.includes("facturation.administrer") ? h("button", { class: "discret", onclick: () => ecranBoutiqueEnLigne() }, "Réglages de la boutique") : null),
    h("div", { class: "carte" }, commandes.length ? commandes.map((c) => carteCommandeWeb(c, gere, filtre)) : h("p", { class: "discret-texte" }, "Aucune commande.")));
}

function carteCommandeWeb(c, gere, filtre) {
  const detail = h("div");
  let charge = false;
  const ouvrir = async (e) => {
    if (!e.currentTarget.open || charge) return;
    charge = true;
    const d = await api("GET", `/commandes-web/${c.id}`);
    const livraison = [MODES_WEB[d.mode_livraison], d.zone, d.point_relais, d.adresse].filter(Boolean).join(" · ");
    detail.replaceChildren(
      h("p", {}, `${d.client} · ${d.telephone}`),
      h("p", { class: "discret-texte" }, [d.lieu, livraison, MOYENS_WEB[d.moyen_paiement]].filter(Boolean).join(" · ")),
      h("ul", {}, d.lignes.map((l) => h("li", {}, `${l.nom} × ${quantiteFr(l.quantite)} : ${fcfa(l.total_ttc)}`))),
      d.frais_livraison ? h("p", {}, `Livraison : ${fcfa(d.frais_livraison)}`) : null,
      d.note ? h("p", {}, d.note) : null,
      d.motif ? h("p", { class: "discret-texte" }, `Motif : ${d.motif}`) : null,
      d.colis ? h("p", {}, `Colis ${d.colis.numero} (${d.colis.statut}), à encaisser : ${fcfa(d.colis.a_encaisser)}`) : null,
      gere && d.statut === "reservee" ? h("div", { class: "actions" },
        d.moyen_paiement === "a_la_livraison" && !d.colis ? h("button", {
          onclick: async () => {
            const r = await api("POST", `/commandes-web/${c.id}/confirmer`);
            ecranCommandesEnLigne(`Commande confirmée : colis ${r.colis.numero} créé, à encaisser à la livraison.`, filtre);
          },
        }, "Confirmer") : null,
        h("details", {}, h("summary", {}, "Annuler"), formulaire(async (v) => {
          await api("POST", `/commandes-web/${c.id}/annuler`, { motif: v.m.trim() });
          ecranCommandesEnLigne("Commande annulée : le stock est remis en vente.", filtre);
        }, [champ("Motif", { name: "m", required: true, minlength: 3, maxlength: 500 })], "Confirmer l'annulation"))) : null);
  };
  return h("details", { class: "apprenant", ontoggle: ouvrir },
    h("summary", {}, h("span", { class: "nom" }, `${c.reference} : ${c.nom_client} · ${fcfa(c.total_ttc)}`), " ",
      h("span", { class: pastilleWeb(c) }, c.colis_id && c.statut === "reservee" ? "Confirmée" : STATUTS_WEB[c.statut]),
      enAttenteWeb(c) ? h("span", { class: "discret-texte" }, ` jusqu'au ${dateHeureFr(c.expire_le)}`) : null),
    detail);
}

async function ecranBoutiqueEnLigne(message) {
  const entites = await api("GET", "/entites");
  const branches = entites.filter((e) => e.type === "branche" && e.domaine === "commerce");
  const reglages = await Promise.all(branches.map((b) => api("GET", `/canal-config?entiteId=${b.id}`)));
  const organisation = (jeton || "").split(".")[0];
  vue(h("h1", {}, "Boutique en ligne"), message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("p", { class: "discret-texte" }, `Identifiant de l'organisation à donner à la Marketplace : ${organisation}`),
    branches.map((b, i) => {
      const k = reglages[i];
      const possibles = entites.filter((e) => e.parent_id === b.id && ["point_de_vente", "entrepot"].includes(e.type) && e.actif && !k.lieux.some((l) => l.entite_id === e.id));
      return h("div", { class: "carte" }, h("h2", {}, b.nom),
        h("div", { class: "ligne" }, h("span", { class: k.actif ? "pastille ok" : "pastille attente" }, k.actif ? "Boutique ouverte" : "Boutique fermée"),
          h("button", {
            class: k.actif ? "danger" : "",
            onclick: async () => { await api("POST", "/canal-config", { entiteId: b.id, actif: !k.actif }); ecranBoutiqueEnLigne(k.actif ? "Boutique fermée." : "Boutique ouverte."); },
          }, k.actif ? "Fermer la boutique" : "Ouvrir la boutique")),
        h("h3", {}, "Lieux qui servent les commandes"),
        k.lieux.length ? k.lieux.map((l) => h("div", { class: "ligne" }, h("span", { class: "nom" }, l.nom_public),
          h("button", {
            class: "discret",
            onclick: async () => { await api("POST", "/canal-config/lieux", { entiteId: b.id, lieuEntiteId: l.entite_id, nomPublic: l.nom_public, actif: !l.actif }); ecranBoutiqueEnLigne(); },
          }, l.actif ? "Retirer de la boutique" : "Remettre en ligne"))) : h("p", { class: "discret-texte" }, "Aucun lieu en ligne."),
        possibles.length ? h("details", {}, h("summary", {}, "Ajouter un lieu"), formulaire(async (v) => {
          await api("POST", "/canal-config/lieux", { entiteId: b.id, lieuEntiteId: v.l, nomPublic: v.n.trim() });
          ecranBoutiqueEnLigne("Lieu ajouté.");
        }, [choix("l", "Lieu", possibles.map((e) => [e.id, e.nom])), champ("Nom affiché en ligne", { name: "n", required: true, maxlength: 100 })], "Ajouter")) : null,
        h("p", { class: "discret-texte" }, "Un entrepôt dont le stock rejoint le rayon par transfert n'a pas besoin d'être en ligne. Les zones de livraison se règlent dans les transports, au nom de la branche ; les points relais dans leur écran."));
    }),
    h("button", { class: "discret", onclick: () => ecranCommandesEnLigne() }, "Retour aux commandes"));
}
