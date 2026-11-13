export const PERMISSIONS = [
  "entites.voir", "entites.gerer", "modules.gerer", "utilisateurs.gerer", "documents.voir", "documents.gerer", "agenda.voir", "agenda.gerer",
  "tiers.voir", "tiers.creer", "audit.voir",
  "formations.voir", "formations.gerer", "paiements.encaisser", "paiements.annuler",
  "presences.saisir", "certificats.delivrer", "formations.administrer",
  "tiers.modifier", "crm.voir", "crm.gerer", "support.voir", "support.gerer", "taches.gerer",
  "avis.moderer", "mentorat.voir", "mentorat.gerer", "foundation.voir", "foundation.gerer",
  "catalogue.gerer", "facturation.voir", "facturation.gerer", "facturation.encaisser", "facturation.administrer",
  "stocks.voir", "stocks.gerer", "stocks.valider", "achats.voir", "achats.gerer", "achats.approuver", "magasins.gerer",
  "caisse.vendre", "caisse.superviser", "caisse.credit", "apprentissage.voir", "apprentissage.gerer", "rh.voir", "rh.gerer", "rh.paie",
  "coaching.voir", "coaching.gerer", "universite.voir", "universite.gerer", "universite.notes",
  "tresorerie.voir", "tresorerie.gerer",
  "compta.voir", "compta.saisir", "compta.valider", "compta.cloturer",
  "pilotage.voir", "pilotage.gerer", "transport.voir", "transport.gerer", "transport.livrer", "affiliation.voir", "affiliation.gerer",
  "care.voir", "care.gerer", "marketing.voir", "marketing.gerer", "retours.voir", "retours.gerer", "reseau.voir", "reseau.gerer", "rh.evaluer",
  "mall.voir", "mall.gerer",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Le socle est toujours actif : il ne figure pas dans cette liste et ne peut pas être désactivé. */
export const MODULES = [
  "formations", "apprentissage", "universite", "coaching", "commerce", "achats_stocks",
  "transport", "crm", "support", "mentorat", "foundation", "facturation", "comptabilite", "fiscalite", "rh_paie", "pilotage", "tresorerie",
] as const;

/** Modules réservés à un domaine. Les autres, comme la facturation, sont communs. */
const MODULES_FORMATION = ["formations", "apprentissage", "universite", "coaching", "mentorat", "foundation"];
const MODULES_COMMERCE = ["commerce", "achats_stocks", "transport"];
export function moduleCompatible(domaine: string, module: string): boolean {
  if (domaine === "general") return true;
  if (domaine === "formation") return !MODULES_COMMERCE.includes(module);
  if (domaine === "commerce") return !MODULES_FORMATION.includes(module);
  return !MODULES_FORMATION.includes(module) && !MODULES_COMMERCE.includes(module);
}

/** Module sans lequel une permission n'a aucun effet, quel que soit le rôle de la personne. */
export function moduleRequis(permission: string): string | null {
  const domaine = permission.split(".")[0]!;
  if (["stocks", "achats", "magasins"].includes(domaine)) return "achats_stocks";
  if (domaine === "caisse") return "commerce";
  if (domaine === "apprentissage") return "apprentissage";
  if (domaine === "rh") return "rh_paie";
  if (domaine === "compta") return "comptabilite";
  if (domaine === "pilotage") return "pilotage";
  if (domaine === "transport") return "transport";
  if (domaine === "affiliation" || domaine === "marketing") return "crm";
  if (domaine === "care" || domaine === "reseau" || domaine === "mall") return "commerce";
  if (domaine === "retours") return "support";
  if (["coaching", "universite", "mentorat", "foundation", "tresorerie"].includes(domaine)) return domaine;
  if (["formations", "paiements", "presences", "certificats", "avis"].includes(domaine)) return "formations";
  return null;
}

export const ROLE_SUPER = "super_administrateur";

export const ROLES_INITIAUX: { code: string; nom: string; permissions: readonly Permission[] }[] = [
  { code: ROLE_SUPER, nom: "Super administrateur", permissions: PERMISSIONS },
  { code: "administrateur", nom: "Administrateur d'entité", permissions: PERMISSIONS.filter((p) => p !== "utilisateurs.gerer") },
  { code: "direction", nom: "Direction", permissions: ["entites.voir", "tiers.voir", "audit.voir", "formations.voir", "crm.voir", "support.voir", "taches.gerer"] },
  {
    code: "commercial", nom: "Commercial et marketing",
    permissions: ["entites.voir", "tiers.voir", "tiers.creer", "tiers.modifier", "crm.voir", "crm.gerer", "facturation.voir", "facturation.gerer"],
  },
  { code: "secretariat", nom: "Secrétariat", permissions: ["entites.voir", "documents.voir", "documents.gerer", "agenda.voir", "agenda.gerer"] },
  { code: "auditeur", nom: "Auditeur", permissions: ["entites.voir", "tiers.voir", "audit.voir", "formations.voir", "crm.voir", "support.voir"] },
  {
    code: "service_client", nom: "Service client",
    permissions: ["entites.voir", "tiers.voir", "tiers.creer", "tiers.modifier", "support.voir", "support.gerer"],
  },
  {
    code: "gestion_formation", nom: "Gestion des formations",
    permissions: ["entites.voir", "tiers.voir", "tiers.creer", "formations.voir", "formations.gerer",
      "paiements.encaisser", "presences.saisir", "certificats.delivrer"],
  },
  {
    code: "mentorat", nom: "Responsable du mentorat",
    permissions: ["entites.voir", "tiers.voir", "tiers.creer", "mentorat.voir", "mentorat.gerer"],
  },
  {
    code: "foundation", nom: "GTA Foundation",
    permissions: ["entites.voir", "tiers.voir", "tiers.creer", "foundation.voir", "foundation.gerer"],
  },
  {
    code: "comptabilite", nom: "Comptabilité et finance",
    permissions: ["entites.voir", "tiers.voir", "tiers.creer", "catalogue.gerer", "facturation.voir", "facturation.gerer",
      "facturation.encaisser", "facturation.administrer", "stocks.voir", "achats.voir"],
  },
  {
    code: "magasinier", nom: "Magasinier",
    permissions: ["entites.voir", "stocks.voir", "stocks.gerer", "achats.voir"],
  },
  {
    code: "responsable_magasins", nom: "Responsable des magasins",
    permissions: ["entites.voir", "magasins.gerer", "stocks.voir", "stocks.gerer", "stocks.valider", "achats.voir", "caisse.vendre", "caisse.superviser"],
  },
  { code: "caissier", nom: "Caissier", permissions: ["entites.voir", "caisse.vendre", "stocks.voir"] },
  {
    code: "formateur_en_ligne", nom: "Formateur en ligne",
    permissions: ["entites.voir", "tiers.voir", "tiers.creer", "apprentissage.voir", "apprentissage.gerer"],
  },
  { code: "ressources_humaines", nom: "Ressources humaines", permissions: ["entites.voir", "rh.voir", "rh.gerer"] },
  { code: "comptable", nom: "Comptable", permissions: ["entites.voir", "tiers.voir", "compta.voir", "compta.saisir"] },
  { code: "chef_comptable", nom: "Chef comptable", permissions: ["entites.voir", "tiers.voir", "compta.voir", "compta.saisir", "compta.valider", "compta.cloturer"] },
  { code: "reviseur", nom: "Expert comptable ou réviseur (lecture)", permissions: ["entites.voir", "audit.voir", "compta.voir"] },
  { code: "responsable_pilotage", nom: "Responsable du pilotage", permissions: ["entites.voir", "pilotage.voir", "pilotage.gerer"] },
  { code: "logistique", nom: "Logistique et livraisons", permissions: ["entites.voir", "transport.voir", "transport.gerer", "transport.livrer"] },
  { code: "livreur", nom: "Livreur", permissions: ["entites.voir", "transport.voir", "transport.livrer"] },
  { code: "affiliation", nom: "Responsable de l'affiliation", permissions: ["entites.voir", "tiers.voir", "tiers.creer", "affiliation.voir", "affiliation.gerer"] },
  { code: "care", nom: "Conseiller GLOMARI Care", permissions: ["entites.voir", "tiers.voir", "tiers.creer", "care.voir", "care.gerer"] },
  { code: "marketing", nom: "Marketing", permissions: ["entites.voir", "marketing.voir", "marketing.gerer", "retours.voir", "retours.gerer"] },
  { code: "reseau", nom: "Vendeurs et franchises", permissions: ["entites.voir", "tiers.voir", "tiers.creer", "reseau.voir", "reseau.gerer"] },
  { code: "evaluation", nom: "Responsable des évaluations", permissions: ["entites.voir", "rh.voir", "rh.evaluer"] },
  { code: "gestion_mall", nom: "Gestion du Mall", permissions: ["entites.voir", "tiers.voir", "tiers.creer", "mall.voir", "mall.gerer", "facturation.voir", "facturation.gerer"] },
  { code: "tresorier", nom: "Trésorier", permissions: ["entites.voir", "tresorerie.voir", "tresorerie.gerer"] },
  { code: "coach", nom: "Coach", permissions: ["entites.voir", "coaching.voir"] },
  { code: "coordination_coaching", nom: "Coordination SMARTE Coaching", permissions: ["entites.voir", "tiers.voir", "tiers.creer", "coaching.voir", "coaching.gerer"] },
  { code: "scolarite", nom: "Scolarité", permissions: ["entites.voir", "tiers.voir", "tiers.creer", "universite.voir", "universite.gerer", "universite.notes"] },
  { code: "enseignant", nom: "Enseignant", permissions: ["entites.voir", "universite.voir", "universite.notes"] },
  // Les salaires restent à part : même les RH n'y accèdent qu'avec ce rôle.
  { code: "paie", nom: "Paie", permissions: ["entites.voir", "rh.voir", "rh.paie"] },
  {
    code: "acheteur", nom: "Achats et approvisionnement",
    permissions: ["entites.voir", "tiers.voir", "tiers.creer", "catalogue.gerer", "stocks.voir", "achats.voir", "achats.gerer"],
  },
  { code: "formateur", nom: "Formateur", permissions: ["entites.voir", "formations.voir", "presences.saisir"] },
  { code: "caisse", nom: "Caisse", permissions: ["entites.voir", "tiers.voir", "formations.voir", "paiements.encaisser", "facturation.voir", "facturation.encaisser"] },
];
