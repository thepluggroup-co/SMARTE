"use strict";
const racine = document.getElementById("app");
let jeton = sessionStorage.getItem("jeton");
let droits = [];
const estAdmin = () => droits.includes("formations.administrer");

const MESSAGES = {
  identifiants_invalides: "Identifiants incorrects, ou compte temporairement verrouillé.",
  trop_de_tentatives: "Trop de tentatives. Réessayez dans une minute.",
  permission_refusee: "Vous n'avez pas le droit de faire cette action.",
  session_complete: "Cette session est complète.",
  session_fermee: "Cette session n'accepte plus d'inscriptions.",
  existe_deja: "Cet élément existe déjà.",
  reference_obligatoire: "Indiquez la référence de la transaction.",
  taxe_non_autorisee: "Seul un superviseur peut changer la taxe sur une vente.",
  reajustement_en_attente: "Un réajustement attend déjà une décision pour ce produit.",
  reference_deja_utilisee: "Cette référence a déjà été enregistrée.",
  montant_superieur_au_reste: "Le montant dépasse le reste à payer.",
  session_non_terminee: "Certificat impossible : la session n'est pas terminée.",
  solde_non_regle: "Certificat impossible : le solde n'est pas réglé.",
  presence_insuffisante: "Certificat impossible : présence insuffisante.",
  code_invalide: "Code incorrect.",
  donnees_invalides: "Vérifiez les informations saisies.",
  date_hors_session: "Cette date est hors de la session.",
  total_inferieur_au_paye: "Le nouveau total ne peut pas être inférieur à ce qui est déjà payé.",
  capacite_inferieure_aux_inscrits: "La capacité ne peut pas être inférieure au nombre d'inscrits.",
  dates_invalides: "La date de fin doit suivre la date de début.",
  solde_insuffisant: "Le montant dépasse ce qui est disponible sur ce projet.",
  mentor_identique: "Le mentor et le mentoré doivent être deux personnes différentes.",
  mentorat_inactif: "Ce mentorat n'est plus actif.",
  projet_clos: "Ce projet est clos.",
  identite_vendeur_incomplete: "Renseignez d'abord la raison sociale et le NIU de l'entité.",
  entrepot_obligatoire: "Choisissez l'entrepôt d'où sort la marchandise.",
  stock_insuffisant: "Le stock disponible est insuffisant.",
  avoir_superieur_au_reste: "L'avoir dépasse ce qui reste à payer. Annulez d'abord un règlement si nécessaire.",
  commande_figee: "Cette commande est déjà approuvée et ne peut plus changer.",
  commande_non_approuvee: "La commande doit être approuvée avant la réception.",
  commande_deja_recue: "Cette commande a déjà été reçue.",
  quantite_superieure_a_la_commande: "La quantité dépasse ce qui reste à recevoir.",
  acheteur_invalide: "Cette personne ne peut pas être l'acheteur : son compte doit être actif et avoir le droit de passer des commandes sur ce lieu.",
  etape_invalide: "Cette étape ne correspond pas à l'origine de la commande.",
  date_avant_commande: "Cette date ne peut pas précéder la date de la commande.",
  commande_cloturee: "Cette commande est reçue ou annulée : elle ne peut plus changer.",
  frais_deja_retire: "Ce frais a déjà été retiré.",
  forfait_incomplet: "Pour un forfait, indiquez la base (kilo ou mètre cube), la quantité et le tarif.",
  montant_obligatoire: "Indiquez le montant du frais, ou un forfait au kilo ou au mètre cube.",
  format_image: "Cette image n'est pas acceptée. Choisissez une image PNG, JPEG ou WebP.",
  image_trop_lourde: "Cette image est trop lourde. Choisissez une image plus petite.",
  periode_invalide: "Choisissez une date de début avant la date de fin, sur deux ans au plus.",
  dossier_employe_absent: "Votre compte n'est pas encore relié à un dossier employé. Demandez-le aux ressources humaines.",
  jour_de_conge: "Ce jour est un jour de congé : pas d'objectifs, de rapport ni de score.",
  trop_objectifs_personnels: "Vous avez déjà ajouté 3 objectifs personnels aujourd'hui.",
  ajustement_trop_tard: "Les cibles du jour s'ajustent seulement le jour même, avant midi.",
  rapport_fige: "Ce rapport est remis : il ne se modifie plus. Faites une nouvelle version avec un motif.",
  rapport_deja_remis: "Ce rapport est déjà remis.",
  rapport_non_remis: "Remettez d'abord le rapport avant d'en faire une nouvelle version.",
  jour_futur: "Le rapport ne peut pas porter sur un jour à venir.",
  motif_requis: "Indiquez le motif.",
  rien_a_valider: "Le collaborateur n'a encore rien déclaré pour cet objectif.",
  auto_validation_interdite: "Vous ne pouvez pas valider ou décider pour vous-même.",
  modele_invalide: "Choisissez un indicateur du catalogue pour une mesure du système, et seulement dans ce cas.",
  responsable_invalide: "Ce responsable n'est pas possible : il doit être un employé actif de la même branche, sans boucle.",
  poids_total_100: "La somme des cinq poids doit faire 100.",
  branche_attendue: "Choisissez une branche (GLOMARI ou GTA).",
  motif_urgence_obligatoire: "Pour un problème urgent, expliquez pourquoi c'est urgent.",
  deja_pris_en_charge: "Ce problème est déjà pris en charge.",
  probleme_clos: "Ce problème est clos.",
  probleme_non_resolu: "Ce problème n'est pas encore marqué résolu.",
  cas_sensible: "Sur un cas sensible, seule la personne qui l'a signalé peut proposer une solution.",
  solution_deja_decidee: "Une décision a déjà été prise sur cette solution.",
  motif_refus_obligatoire: "Indiquez pourquoi la solution est refusée.",
  date_reexamen_obligatoire: "Indiquez la date à laquelle la solution sera réexaminée.",
  modifications_obligatoires: "Indiquez les modifications demandées.",
  action_non_realisee: "L'efficacité se juge une fois l'action réalisée.",
  fiche_invalide: "Vérifiez les indicateurs et les objectifs types : une mesure du système demande un indicateur journalier du catalogue.",
  fiche_existante: "Une fiche existe déjà pour ce poste dans cette entité : modifiez-la, cela créera une nouvelle version.",
  rattachement_invalide: "Le poste de rattachement doit être une autre fiche de la même branche.",
  fiche_sans_objectifs: "Cette fiche n'a pas d'objectifs types.",
  modeles_deja_generes: "Les objectifs journaliers de cette version sont déjà en place.",
  fiche_obsolete: "Votre fiche a changé entre-temps : relisez la version en vigueur.",
  parent_autre_branche: "L'objectif parent doit être de la même branche : GTA et GLOMARI ne se mélangent pas.",
  parent_autre_periode: "L'objectif parent doit être du même trimestre.",
  parent_invalide: "Cet objectif ne peut pas être son propre parent, ni celui d'un objectif qui en dépend.",
  mesure_invalide: "Cette mesure automatique n'existe pas pour cette branche.",
  proprietaire_invalide: "Le propriétaire doit travailler dans la même branche.",
  objectif_non_actif: "Cet objectif n'est plus en cours : il est clos, abandonné ou pas encore validé.",
  trop_de_resultats: "Un objectif a au plus 10 résultats clés ; 3 à 5 suffisent en général.",
  resultat_automatique: "Ce résultat clé se met à jour seul chaque nuit : sa valeur ne se saisit pas.",
  valeur_requise: "Indiquez la valeur atteinte cette semaine.",
  document_invalide: "Cette preuve est introuvable, d'une autre branche ou hors de vos droits.",
  blocage_requis: "Décrivez le blocage pour pouvoir le signaler comme problème.",
  probleme_deja_signale: "Un problème a déjà été signalé pour ce point de la semaine.",
  projet_autre_branche: "Le projet doit être de la même branche que l'objectif.",
  trimestre_en_cours: "La note se pose dans les deux dernières semaines du trimestre ou après.",
  notation_incomplete: "Notez d'abord tous les résultats clés de cet objectif.",
  deja_reconduit: "Cet objectif a déjà été reconduit au trimestre suivant.",
  import_colonnes: "La première ligne du fichier doit contenir au moins les colonnes Code, Nom et Prix de vente.",
  categorie_trop_profonde: "Une sous-catégorie ne peut pas contenir d'autre sous-catégorie.",
  categorie_existante: "Cette catégorie existe déjà.",
  marque_existante: "Cette marque existe déjà.",
  marque_autre_branche: "Cette marque est introuvable, désactivée ou d'une autre branche.",
  unite_inconnue: "Cette unité n'existe pas pour cet article.",
  unite_en_double: "Deux unités portent le même nom, ou le nom de l'unité de stock.",
  code_barres_existant: "Cet article a déjà un code-barres.",
  code_barres_indisponible: "Impossible de créer un nouveau code-barres pour le moment. Réessayez.",
  categorie_autre_branche: "Cette catégorie est introuvable, désactivée ou d'une autre branche.",
  resultat_non_rattachable: "Ce résultat clé n'est pas de votre branche ou n'est plus en cours.",
  fichier_illisible: "Ce fichier ne peut pas être lu. Enregistrez-le au format Excel (.xlsx) ou CSV, puis réessayez.",
  quantite_superieure_a_lexpedie: "La quantité reçue dépasse ce qui a été expédié.",
  motif_ecart_obligatoire: "Indiquez le motif de l'écart entre l'expédié et le reçu.",
  transfert_non_expedie: "Le transfert doit d'abord être expédié.",
  transfert_deja_traite: "Ce transfert a déjà été traité.",
  deja_decide: "Ce réajustement a déjà été traité.",
  produit_en_double: "Un même produit figure deux fois.",
  ligne_incomplete: "Chaque ligne doit avoir une désignation et un prix.",
  devis_non_accepte: "Le devis doit d'abord être accepté.",
  deja_facture: "Ce devis a déjà une facture.",
  produit_sans_stock: "Ce produit n'est pas suivi en stock.",
  transfert_identique: "Choisissez deux entités différentes.",
  cout_obligatoire: "Indiquez le coût unitaire de l'entrée.",
  deja_annule: "Cette opération est déjà annulée.",
  role_incompatible: "Ce rôle n'a aucun effet sur cette entité. Par exemple, GTA ne gère pas de stock.",
  module_incompatible: "Ce module n'est pas autorisé pour cette entité.",
  super_sur_toute_organisation: "Le super administrateur s'attribue sur toute l'organisation.",
  dernier_super_administrateur: "Il doit toujours rester un super administrateur actif.",
  magasin_non_vide: "Ce magasin contient encore du stock. Transférez-le avant de le désactiver.",
  tiers_autre_branche: "Cette fiche appartient à une autre branche. Créez une fiche distincte ici.",
  entite_obligatoire: "Indiquez l'entité de cette fiche.",
  caisse_fermee: "Ouvrez d'abord votre caisse.",
  caisse_deja_ouverte: "Votre caisse est déjà ouverte ici.",
  caisse_deja_cloturee: "Cette caisse est déjà clôturée.",
  paiement_insuffisant: "Le montant reçu est inférieur au total.",
  rendu_impossible: "La monnaie ne se rend qu'en espèces. Ajustez les montants.",
  remise_non_autorisee: "Cette remise doit être accordée par un responsable.",
  remise_invalide: "La remise dépasse le montant de la ligne ou de la vente.",
  vendeur_invalide: "Ce vendeur ne travaille pas dans ce lieu de vente.",
  credit_hors_connexion: "La vente à crédit n'est pas possible sans connexion.",
  credit_sans_client: "Choisissez d'abord le client : une vente à crédit se fait à un client identifié.",
  credit_non_autorise: "Vous n'avez pas le droit de vendre à crédit. Demandez-le au super administrateur.",
  credit_deja_regle: "Ce crédit a déjà reçu un règlement : la vente ne s'annule plus ici.",
  vente_sans_credit: "Cette vente n'a pas de reste dû.",
  reglement_trop_eleve: "Le montant dépasse ce que le client doit encore.",
  vente_avec_retour: "Cette vente a déjà un retour : elle ne s'annule plus.",
  retour_trop_grand: "La quantité retournée dépasse ce qui reste de cette ligne.",
  retour_sans_montant: "Ce retour ne représente aucun montant.",
  remboursement_inexact: "Le total remboursé doit être égal au montant du retour.",
  commission_non_reglee: "Réglez d'abord l'objectif et le pourcentage de commission sur la fiche de l'employé.",
  serie_indisponible: "Un numéro de série saisi n'est pas en stock pour cet article.",
  cours_vide: "Ajoutez au moins une leçon avant de publier.",
  conge_chevauche: "Cette période chevauche un autre congé.",
  retour_superieur_a_la_vente: "La quantité retournée dépasse la quantité vendue.",
  fidelite_inactive: "La fidélité n'est pas active pour cette vente.",
  points_insuffisants: "Le client n'a pas assez de points.",
  stockage_impossible: "Cet appareil ne peut pas garder la vente. Libérez de l'espace, ou notez-la sur papier.",
  ventes_en_attente: "Des ventes attendent encore d'être envoyées. Attendez internet, ou traitez celles qui sont refusées.",
  medias_non_configures: "L'hébergement des vidéos n'est pas encore configuré sur ce serveur.",
  video_trop_lourde: "Cette vidéo dépasse la taille autorisée.",
  format_video: "Format non reconnu. Utilisez une vidéo MP4 ou WebM.",
  ia_non_configuree: "Le studio IA n'est pas encore configuré sur ce serveur.",
  ia_indisponible: "Le service d'IA ne répond pas. Réessayez plus tard.",
  ia_reponse_invalide: "La réponse de l'IA est inutilisable. Réessayez ou précisez la demande.",
  heures_invalides: "L'heure de départ doit suivre l'heure d'arrivée.",
  solde_conges_insuffisant: "Le solde de congés est insuffisant. Une dérogation motivée est possible.",
  salaire_manquant: "Renseignez d'abord le salaire de cet employé.",
  paie_non_validee: "Un expert doit d'abord valider les rubriques de paie de cette entité. Le bulletin reste un brouillon.",
  bulletin_a_recalculer: "Ce brouillon est antérieur à la dernière validation. Supprimez-le et recréez-le.",
  bulletin_fige: "Ce bulletin est déjà validé ou annulé.",
  net_negatif: "Les retenues dépassent le brut. Vérifiez le bulletin.",
  rubrique_invalide: "Vérifiez le mode, le taux, le montant ou les tranches de cette rubrique.",
  forfait_epuise: "Toutes les séances de ce forfait sont déjà prévues.",
  certificat_deja_delivre: "Le certificat de ce niveau est déjà délivré.",
  parcours_incomplet: "Certificat impossible : heures, supervisions, examen ou soutenance incomplets.",
  niveau_precedent_manquant: "Le candidat doit d'abord obtenir le niveau précédent.",
  deliberation_figee: "Cette session est délibérée : ses notes ne changent plus.",
  aucun_inscrit: "Aucun étudiant inscrit pour cette année.",
  deliberation_manquante: "Le diplôme demande d'abord une délibération.",
  credits_insuffisants: "Crédits insuffisants pour le diplôme.",
  portefeuille_non_vide: "Ce portefeuille contient encore de l'argent. Transférez-le d'abord.",
  portefeuille_inactif: "Ce portefeuille est désactivé.",
  encaissement_deja_traite: "Cet encaissement a déjà été placé dans un portefeuille ou annulé.",
  solde_portefeuille_insuffisant: "Le solde de ce portefeuille est insuffisant.",
  transfert_autre_branche: "GLOMARI et GTA sont distinctes : pas de transfert direct entre leurs portefeuilles.",
  mouvement_non_annulable: "Ce mouvement ne s'annule pas ici. Un encaissement s'annule depuis son reçu ou sa vente.",
  compta_non_initialisee: "Installez d'abord le plan comptable.",
  branche_attendue: "La comptabilité se tient par branche.",
  ecriture_desequilibree: "L'écriture n'est pas équilibrée : le total des débits doit égaler celui des crédits.",
  ligne_comptable_invalide: "Chaque ligne doit avoir soit un débit, soit un crédit.",
  compte_inconnu: "Un compte n'existe pas dans le plan, ou il est inactif.",
  periode_close: "Cette période est close. Datez l'écriture dans la période en cours.",
  ecriture_validee: "Cette écriture est validée : elle ne se modifie plus.",
  ecriture_non_validee: "Seule une écriture validée se contre-passe.",
  brouillons_restants: "Des brouillons restent à valider sur cette période.",
  mois_precedent_ouvert: "Clôturez d'abord les mois précédents.",
  cloture_definitive: "Cette clôture est définitive : le mois ne se rouvre plus.",
  exercice_clos: "Cet exercice est déjà clos.",
  mois_non_definitifs: "Tous les mois de l'exercice doivent être clôturés définitivement.",
  bilan_desequilibre: "Le bilan n'est pas équilibré : vérifiez les à-nouveaux avant de clôturer.",
  compte_achat_invalide: "Une facture fournisseur s'impute sur un compte de charge (6), de stock (3) ou d'immobilisation (2).",
  commande_autre_fournisseur: "Cette commande appartient à un autre fournisseur.",
  facture_deja_traitee: "Cette facture a déjà été traitée.",
  ecart_trois_voies: "Le montant ne correspond pas à ce qui a été reçu. Indiquez le motif de l'écart pour valider.",
  facture_payee: "Annulez d'abord les paiements de cette facture.",
  facture_non_validee: "La facture doit d'abord être validée.",
  deja_cede: "Ce bien est déjà cédé.",
  etape_impossible: "Ce colis ne peut pas passer à cette étape.",
  code_incorrect: "Code de confirmation incorrect.",
  encaissement_incomplet: "Le montant encaissé ne correspond pas à ce qui est dû.",
  remise_deja_faite: "La remise de cette tournée est déjà faite.",
  periode_retour_en_cours: "La période de retour n'est pas terminée.",
  commission_non_validee: "La commission doit d'abord être validée.",
  entrepot_obligatoire: "Choisissez l'entrepôt de remise.",
  achat_non_verifie: "Aucun achat vérifié ne correspond à cette demande d'avis.",
  deja_repondu: "Cet avis a déjà été reçu.",
  paliers_non_degressifs: "Le prix doit baisser quand la quantité monte.",
  palier_sous_le_cout: "Ce prix est sous le coût moyen du produit.",
  plafond_credit_depasse: "Le plafond de crédit de ce client serait dépassé. Un responsable doit émettre la facture.",
  vendeur_non_verifie: "Ce vendeur n'est pas encore vérifié.",
  franchise_inactive: "Cette franchise n'est pas active.",
  employe_sans_compte: "Liez d'abord cet employé à son compte utilisateur.",
  poste_sans_regles: "Définissez d'abord les indicateurs de ce poste.",
  local_deja_loue: "Ce local a déjà un bail sur cette période.",
  hors_bail: "Ce mois est en dehors de la durée du bail.",
  rien_a_payer: "Aucune commission à payer.",
  compte_pro_manquant: "Réglez d'abord le compte professionnel de ce client.",
  separation_des_taches: "Une autre personne doit valider ce que vous avez préparé.",
  client_bloque: "Ce client est bloqué pour cette opération. Levez le blocage dans le recouvrement.",
  facture_passee_en_perte: "Cette facture est passée en perte.",
  relance_non_due: "Cette relance n'est plus due.",
  plan_different_du_reste: "Le total des échéances doit être égal au reste dû.",
  plan_deja_actif: "Un plan est déjà actif sur cette facture.",
  provision_superieure_au_reste: "La provision dépasse le reste dû.",
  deja_declassee: "Cette créance est déjà déclassée.",
  creance_non_douteuse: "Déclassez d'abord cette créance en douteuse.",
  ordre_relances_invalide: "Les délais doivent aller de l'avant-échéance à la mise en demeure.",
  deja_bloque: "Ce client est déjà bloqué pour cette opération.",
  ressource_occupee: "Cette ressource est déjà réservée sur ce créneau.",
  format_document: "Format refusé : PDF, PNG, JPEG, Word ou Excel uniquement.",
  document_trop_lourd: "Ce document est trop lourd.",
  medias_non_configures: "Le stockage des fichiers n'est pas configuré sur ce serveur.",
  compte_sans_dossier: "Votre compte n'est pas relié à un dossier employé.",
  compte_introuvable: "Aucun compte actif avec cet email.",
  compte_deja_lie: "Ce compte est déjà relié à un autre employé.",
  pointage_termine: "Votre journée est déjà pointée.",
  note_non_approuvee: "Cette note n'est pas approuvée.",
  note_deja_traitee: "Cette note est déjà traitée.",
  deja_embauche: "Cette personne est déjà embauchée.",
  code_pointage_requis: "Saisissez le code affiché sur la borne.",
  code_pointage_invalide: "Ce code n'est plus valable. Reprenez celui de la borne.",
  fusion_impossible: "Ces deux fiches ont une inscription ou un rôle identique. Traitez ce doublon avant de fusionner.",
  deja_fusionne: "Une de ces fiches est déjà fusionnée.",
  deja_signe: "Vous avez déjà approuvé ce document.",
  conflit_salle: "Cette salle est déjà occupée sur ce créneau.",
  conflit_enseignant: "Cet enseignant a déjà un cours sur ce créneau.",
  conflit_promotion: "Cette promotion a déjà un cours sur ce créneau.",
  scolarite_impayee: "La scolarité n'est pas soldée.",
  paiement_superieur_au_reste: "Ce paiement dépasse le reste dû.",
  bulletins_non_payables: "Certains bulletins sont déjà versés ou non validés.",
  compte_paiement_obligatoire: "Indiquez le compte ou le numéro.",
  creneau_existant: "Ce créneau existe déjà.",
  billet_invalide: "Billet inconnu ou annulé.",
  billet_deja_utilise: "Ce billet a déjà servi à l'entrée.",
  billet_non_paye: "Ce billet n'est pas encore payé.",
  billet_paye: "Un billet payé ne s'annule pas ici : traitez d'abord le remboursement.",
  variante_de_variante: "Une variante ne peut pas avoir de variantes.",
  dsf_deposee: "Cette DSF est déposée : elle ne se modifie plus.",
  deja_en_attente: "Cette personne est déjà sur la liste d'attente.",
  code_promo_invalide: "Ce code n'est pas valable.",
  code_deja_utilise: "Un code a déjà été appliqué à cette inscription.",
  rien_a_remiser: "Tout est déjà payé.",
  theme_vide: "Aucune question sur ce thème.",
  bonne_reponse_invalide: "La bonne réponse ne fait pas partie des choix.",
  inventaire_valide: "Cet inventaire est déjà validé.",
  serie_deja_vendue: "Ce numéro est déjà vendu.",
  demande_close: "Cette demande de prix est close.",
  import_invalide: "Le fichier contient des lignes refusées : code en double, sous-catégorie sans catégorie, ou quantité sans entrepôt choisi.",
  quantite_minimale: "Quantité inférieure au minimum de commande.",
  multiple_obligatoire: "Cette quantité doit être un multiple du conditionnement.",
  deja_anonymise: "Cette fiche est déjà anonymisée.",
  reponses_incompletes: "Répondez à tous les points.",
  limite_utilisateurs: "Votre offre a atteint son nombre maximal d'utilisateurs.",
  article_hors_commande: "Cet article n'est pas dans la commande.",
  article_deja_complet: "Cet article est déjà complet.",
  preparation_terminee: "Cette préparation est terminée.",
  rien_a_preparer: "Aucun article suivi en stock dans cette facture.",
  rapport_invalide: "Ce regroupement n'existe pas pour cette source.",
  "2fa_deja_active": "La double authentification est déjà activée.",
  activation_non_demandee: "Relancez l'activation de la double authentification.",
  annulation_trop_tardive: "Annulation possible jusqu'à 24 heures avant.",
  apprenant_hors_session: "Cette personne n'est pas inscrite à cette session.",
  billet_deja_traite: "Ce billet est déjà traité.",
  branches_identiques: "Choisissez deux branches différentes.",
  consentement_obligatoire: "Le consentement est obligatoire.",
  contact_obligatoire: "Indiquez un téléphone ou un email.",
  creneau_pris: "Ce créneau vient d'être pris.",
  devoir_deja_corrige: "Ce devoir est déjà corrigé.",
  document_emis: "Ce document est émis : il ne se modifie plus.",
  evenement_complet: "Cet événement est complet.",
  evenement_gratuit: "Cet événement est gratuit : rien à encaisser.",
  facture_non_emise: "Cette facture n'est pas émise.",
  fusion_invalide: "Choisissez deux fiches différentes.",
  inscription_inactive: "Cette inscription n'est plus active.",
  introuvable: "Élément introuvable, ou vous n'y avez pas accès.",
  lecon_verrouillee: "Terminez d'abord la leçon précédente.",
  lignes_incompletes: "Complétez toutes les lignes.",
  non_authentifie: "Votre session a expiré. Reconnectez-vous.",
  operation_impossible: "Cette opération n'est pas possible dans l'état actuel.",
  organisation_existante: "Cet identifiant est déjà utilisé.",
  perte_non_demandee: "Aucune demande de passage en perte n'est en attente.",
  pointage_trop_proche: "Vous venez de pointer. Réessayez dans un instant.",
  pourcentage_invalide: "Le pourcentage ne peut pas dépasser 100.",
  rien_a_passer_en_perte: "Il ne reste rien à passer en perte.",
  telephone_invalide: "Ce numéro de téléphone n'est pas valide.",
  tiers_sans_branche: "Cette fiche n'est rattachée à aucune branche.",
  fiche_deja_reliee: "Cette fiche est déjà reliée à un autre compte. Retirez d'abord le lien.",
  bulletin_deja_verse: "Ce salaire est déjà versé : le bulletin ne peut plus être annulé.",
  mot_de_passe_incorrect: "Le mot de passe actuel est incorrect.",
  a_nouveau_non_supprimable: "Un à-nouveau ne se supprime pas : corrigez-le.",
  mouvement_non_annulable: "Cette opération s'annule depuis son origine (reçu, bulletin, billet).",
  seuils_incoherents: "Les seuils doivent aller de la cible vers le seuil critique.",
  cle_super_interdite: "Une clé d'API ne peut pas agir avec un compte de super administrateur.",
  url_webhook_refusee: "Cette adresse est refusée : https obligatoire, et aucune adresse interne.",
  quota_depasse: "Trop de requêtes. Réessayez dans une minute.",
  motif_obligatoire: "Indiquez le motif de la perte.",
  doublon_probable: "Une fiche avec ce téléphone ou cet e-mail existe déjà.",
  module_inactif: "Le module Formations n'est pas activé pour cette entité.",
};
const texteErreur = (e) => e instanceof TypeError ? "Pas de connexion. Réessayez quand internet revient." : MESSAGES[e.code] || "Une erreur est survenue. Réessayez.";

/** Tout le texte passe par des noeuds texte : une saisie ne peut jamais devenir du code. */
function h(tag, props = {}, ...enfants) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, (k === "placeholder" || k === "aria-label") && typeof traduire === "function" ? traduire(v) : v);
  }
  for (const e of enfants.flat(Infinity)) if (e != null && e !== false) el.append(typeof e === "string" && typeof traduire === "function" ? traduire(e) : e);
  return el;
}

/** Une réponse lente d'un écran quitté ne doit pas remplacer l'écran ouvert depuis, ni effacer une saisie. */
let navigation = 0;

async function api(methode, url, corps) {
  const depart = navigation;
  const r = await fetch(url, {
    method: methode,
    headers: {
      ...(corps ? { "content-type": "application/json" } : {}),
      ...(jeton ? { authorization: `Bearer ${jeton}` } : {}),
    },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const d = r.status === 204 ? null : await r.json();
  if (depart !== navigation) throw Object.assign(new Error(), { code: "obsolete" });
  if (r.status === 401 && jeton) { sortir(); throw Object.assign(new Error(), { code: "expire" }); }
  if (!r.ok) throw Object.assign(new Error(), { code: d.erreur, details: d.details });
  return d;
}

const fcfa = (n) => `${Number(n).toLocaleString("fr-FR")} FCFA`;
const dateFr = (d) => String(d).slice(0, 10).split("-").reverse().join("/");
const aujourdhui = () => new Date(Date.now() + 3600000).toISOString().slice(0, 10);
const champ = (libelle, attrs) => h("label", {}, libelle, h("input", attrs));
const valeurs = (f) => Object.fromEntries(new FormData(f).entries());

/**
 * GLOMARI et GTA sont deux métiers distincts : seuls les onglets de l'espace choisi s'affichent.
 * C'est un confort d'affichage. La séparation réelle reste contrôlée par le serveur, droit par droit.
 */
const ESPACES = [["formation", "GTA"], ["commerce", "GLOMARI"]];
const DROITS_COMMERCE = ["achats.voir", "stocks.voir", "magasins.gerer", "caisse.vendre", "transport.voir", "care.voir", "reseau.voir", "mall.voir"];
const DROITS_FORMATION = ["formations.voir", "apprentissage.voir", "mentorat.voir", "foundation.voir", "coaching.voir", "universite.voir"];
const aDroitDe = (liste) => liste.some((d) => droits.includes(d));
const deuxEspaces = () => aDroitDe(DROITS_COMMERCE) && aDroitDe(DROITS_FORMATION);
function espaceCourant() {
  if (!aDroitDe(DROITS_COMMERCE)) return "formation";
  if (!aDroitDe(DROITS_FORMATION)) return "commerce";
  return lireLocal(localStorage, "smarte.espace", "formation");
}
const dansEspace = (e) => espaceCourant() === e;
function choisirEspace(e) {
  ecrireLocal(localStorage, "smarte.espace", e);
  navigation += 1;
  ecranAccueil();
}

function vue(...contenu) {
  if (typeof appliquerCharte === "function") appliquerCharte();
  const nav = () => racine.querySelector("nav.navigation")?.addEventListener("click", () => { navigation += 1; }, true);
  // Sur téléphone, le menu vertical se replie derrière le bouton « Menu ».
  const basculerMenu = (e) => {
    const ouvert = racine.querySelector("nav.navigation")?.classList.toggle("ouvert");
    e.currentTarget.setAttribute("aria-expanded", ouvert ? "true" : "false");
  };
  racine.replaceChildren(
    h("header", { class: "barre" },
      h("button", { class: "discret bouton-menu pas-imprimer", "aria-expanded": "false", "aria-controls": "menu-modules", onclick: basculerMenu }, "Menu"),
      h("strong", {}, "Smarte Solutions"),
      deuxEspaces() ? h("select", { class: "choix-espace pas-imprimer", "aria-label": "Espace de travail", onchange: (e) => choisirEspace(e.target.value) },
        ESPACES.map(([c, l]) => h("option", { value: c, selected: c === espaceCourant() }, l))) : null,
      h("input", { class: "recherche-globale pas-imprimer", type: "search", placeholder: "Rechercher", "aria-label": "Recherche globale", onkeydown: (e) => { if (e.key === "Enter" && e.target.value.trim().length >= 2) ecranRecherche(e.target.value.trim()); } }),
      h("button", { class: "discret", onclick: () => ecranNotifications() }, "Notifications"),
      h("button", { class: "discret bouton-compte", onclick: () => ecranCompte() }, "Mon compte"),
      h("button", { class: "discret", onclick: sortir }, "Se déconnecter")),
    h("div", { class: "cadre" },
    h("nav", { class: "navigation pas-imprimer", id: "menu-modules", "aria-label": "Modules" },
      h("button", { class: "discret", onclick: () => ecranTableauDeBord() }, "Tableau de bord"),
      dansEspace("formation") && droits.includes("formations.voir") ? h("button", { class: "discret", onclick: ecranSessions }, "Formations") : null,
      droits.includes("crm.voir") ? h("button", { class: "discret", onclick: () => ecranClients() }, "Clients") : null,
      droits.includes("facturation.voir") ? h("button", { class: "discret", onclick: () => ecranFacturation() }, "Facturation") : null,
      dansEspace("commerce") && droits.includes("achats.voir") ? h("button", { class: "discret", onclick: () => ecranAchats() }, "Achats") : null,
      dansEspace("commerce") && droits.includes("stocks.voir") ? h("button", { class: "discret", onclick: () => ecranStocks() }, "Stocks") : null,
      dansEspace("commerce") && droits.includes("magasins.gerer") ? h("button", { class: "discret", onclick: () => ecranMagasins() }, "Magasins") : null,
      dansEspace("commerce") && (droits.includes("stocks.voir") || droits.includes("caisse.superviser")) ? h("button", { class: "discret", onclick: () => ecranRapportsStockVentes() }, "Rapports stock et ventes") : null,
      dansEspace("commerce") && droits.includes("caisse.vendre") ? h("button", { class: "discret", onclick: () => ecranCaisse() }, "Caisse") : null,
      dansEspace("formation") && droits.includes("apprentissage.voir") ? h("button", { class: "discret", onclick: () => ecranCours() }, "Cours en ligne") : null,
      droits.includes("rh.voir") ? h("button", { class: "discret", onclick: () => ecranRh() }, "RH") : null,
      dansEspace("commerce") && droits.includes("mall.voir") ? h("button", { class: "discret", onclick: () => ecranMall() }, "Mall") : null,
      dansEspace("commerce") && droits.includes("stocks.voir") ? h("button", { class: "discret", onclick: () => ecranRayons() }, "Rayons et étiquettes") : null,
      dansEspace("commerce") && droits.includes("transport.voir") ? h("button", { class: "discret", onclick: () => ecranRelais() }, "Points relais") : null,
      dansEspace("commerce") && droits.includes("facturation.voir") && droits.includes("stocks.voir") ? h("button", { class: "discret", onclick: () => ecranPortail() }, "Portail grossiste") : null,
      dansEspace("commerce") && droits.includes("care.voir") ? h("button", { class: "discret", onclick: () => ecranCare() }, "GLOMARI Care") : null,
      dansEspace("commerce") && droits.includes("reseau.voir") ? h("button", { class: "discret", onclick: () => ecranReseau() }, "Vendeurs et gros") : null,
      h("button", { class: "discret", onclick: () => ecranMonEspace() }, "Mon espace"),
      droits.includes("pilotage.voir") ? h("button", { class: "discret", onclick: () => ecranTour() }, "Tour de contrôle") : null,
      droits.includes("documents.voir") || droits.includes("rh.voir") || droits.includes("compta.voir") ? h("button", { class: "discret", onclick: () => ecranDocuments() }, "Documents") : null,
      droits.includes("agenda.voir") ? h("button", { class: "discret", onclick: () => ecranAgenda() }, "Agenda") : null,
      droits.includes("catalogue.gerer") ? h("button", { class: "discret", onclick: () => ecranPromotions() }, "Promotions") : null,
      dansEspace("commerce") && droits.includes("stocks.voir") ? h("button", { class: "discret", onclick: () => ecranLogistique() }, "Entrepôt et importation") : null,
      droits.includes("crm.voir") ? h("button", { class: "discret", onclick: () => ecranProspection() }, "Prospection") : null,
      droits.includes("facturation.voir") ? h("button", { class: "discret", onclick: () => ecranRecouvrement() }, "Recouvrement") : null,
      droits.includes("marketing.voir") ? h("button", { class: "discret", onclick: () => ecranMarketing() }, "Marketing") : null,
      droits.includes("marketing.voir") ? h("button", { class: "discret", onclick: () => ecranEvenements() }, "Événements") : null,
      h("button", { class: "discret", onclick: () => ecranPerformance() }, "Performance"),
      droits.includes("pilotage.voir") ? h("button", { class: "discret", onclick: () => ecranPilotage() }, "Pilotage") : null,
      droits.includes("affiliation.voir") ? h("button", { class: "discret", onclick: () => ecranAffilies() }, "Affiliés") : null,
      dansEspace("commerce") && droits.includes("transport.voir") ? h("button", { class: "discret", onclick: () => ecranLivraisons() }, "Livraisons") : null,
      droits.includes("compta.voir") ? h("button", { class: "discret", onclick: () => ecranCompta() }, "Comptabilité") : null,
      droits.includes("tresorerie.voir") ? h("button", { class: "discret", onclick: () => ecranTresorerie() }, "Trésorerie") : null,
      droits.includes("support.voir") ? h("button", { class: "discret", onclick: () => ecranSupport() }, "Service client") : null,
      h("button", { class: "discret", onclick: () => ecranTaches() }, "Tâches"),
      h("button", { class: "discret", onclick: () => ecranIndicateurs() }, "Indicateurs"),
      droits.includes("utilisateurs.gerer") ? h("button", { class: "discret", onclick: () => ecranAcces() }, "Accès") : null,
      dansEspace("formation") && droits.includes("mentorat.voir") ? h("button", { class: "discret", onclick: () => ecranMentorats() }, "Mentorat") : null,
      dansEspace("formation") && droits.includes("foundation.voir") ? h("button", { class: "discret", onclick: () => ecranFoundation() }, "Foundation") : null,
      dansEspace("formation") && droits.includes("coaching.voir") ? h("button", { class: "discret", onclick: () => ecranCoaching() }, "Coaching") : null,
      dansEspace("formation") && droits.includes("universite.voir") ? h("button", { class: "discret", onclick: () => ecranUniversite() }, "Université") : null),
    h("main", {}, contenu)));
  nav();
  window.scrollTo(0, 0);
  if (typeof poserEntete === "function") poserEntete().catch(() => {});
}

/** Après la connexion : le tableau de bord pour qui suit les chiffres, l'écran de travail pour les autres. */
async function ecranAccueil() {
  droits = (await api("GET", "/moi")).permissions;
  return aDroitDe(["tresorerie.voir", "pilotage.voir"]) ? ecranTableauDeBord() : ecranSessions();
}

function sortir() {
  if (jeton) fetch("/deconnexion", { method: "POST", headers: { authorization: `Bearer ${jeton}` } }).catch(() => {});
  jeton = null;
  sessionStorage.removeItem("jeton");
  sessionStorage.removeItem("smarte.caisse");
  if (typeof oublierSession === "function") oublierSession();
  ecranConnexion();
}

/** Formulaire qui affiche ses erreurs et empêche un double envoi. */
function formulaire(action, enfants, libelle) {
  const zone = h("div");
  const bouton = h("button", { type: "submit" }, libelle);
  const f = h("form", {
    onsubmit: async (ev) => {
      ev.preventDefault();
      zone.replaceChildren();
      bouton.disabled = true;
      try {
        await action(valeurs(f), f, zone);
      } catch (e) {
        if (e.code !== "expire" && e.code !== "obsolete") zone.replaceChildren(h("div", { class: "erreur", role: "alert" }, texteErreur(e)));
      } finally {
        bouton.disabled = false;
      }
    },
  }, zone, enfants, bouton);
  return f;
}

function ecranConnexion() {
  const zoneCode = h("div");
  racine.replaceChildren(h("main", { class: "centre" }, h("div", { class: "carte" },
    h("h1", {}, "Smarte Solutions"),
    h("p", { class: "discret-texte" }, "Connectez-vous à votre espace."),
    formulaire(async (v) => {
      try {
        const r = await api("POST", "/connexion", {
          organisation: v.organisation.trim(), email: v.email.trim(), motDePasse: v.motDePasse,
          ...(v.code ? { code: v.code.trim() } : {}),
        });
        jeton = r.jeton;
        sessionStorage.setItem("jeton", jeton);
        await ecranAccueil();
      } catch (e) {
        if (e.code !== "code_2fa_requis") throw e;
        zoneCode.replaceChildren(champ("Code à 6 chiffres", { name: "code", inputmode: "numeric", required: true, autofocus: true, autocomplete: "one-time-code" }));
      }
    }, [
      champ("Organisation", { name: "organisation", value: "sgc", required: true }),
      champ("E-mail", { name: "email", type: "email", required: true, autocomplete: "username" }),
      champ("Mot de passe", { name: "motDePasse", type: "password", required: true, autocomplete: "current-password" }),
      zoneCode,
    ], "Se connecter"))));
}

async function ecranSessions() {
  droits = (await api("GET", "/moi")).permissions;
  if (!droits.includes("formations.voir") || !dansEspace("formation")) return dansEspace("formation") && droits.includes("coaching.voir") ? ecranCoaching() : dansEspace("formation") && droits.includes("universite.voir") ? ecranUniversite() : droits.includes("caisse.vendre") ? ecranCaisse() : droits.includes("stocks.voir") ? ecranStocks() : droits.includes("rh.voir") ? ecranRh() : droits.includes("apprentissage.voir") ? ecranCours() : droits.includes("crm.voir") ? ecranClients() : droits.includes("support.voir") ? ecranSupport() : ecranTaches();
  const [sessions, programmes, entites] = await Promise.all([
    api("GET", "/sessions"), api("GET", "/programmes"), api("GET", "/entites"),
  ]);
  const liste = sessions.map((s) => h("button", { class: "session", onclick: () => ecranSession(s.id) },
    h("div", { class: "ligne" },
      h("span", { class: "nom" }, s.programme),
      h("span", { class: "pastille ok" }, `${s.inscrits} inscrit${s.inscrits > 1 ? "s" : ""}`)),
    h("div", { class: "discret-texte" }, `${s.code} · ${s.ville}${s.lieu ? `, ${s.lieu}` : ""} · du ${dateFr(s.debut)} au ${dateFr(s.fin)}`)));

  const gta = entites.find((e) => e.code === "GTA") || entites[0];
  // Le serveur exige formations.gerer pour créer : on ne montre pas un formulaire qui serait refusé.
  const peutCreer = droits.includes("formations.gerer");
  vue(
    h("h1", {}, "Sessions de formation"),
    h("p", { class: "discret-texte" }, sessions.length ? "Choisissez une session." : "Aucune session pour le moment."),
    liste,
    peutCreer && programmes.length ? h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Nouvelle session"),
      formulaire(async (v) => {
        const s = await api("POST", "/sessions", {
          programmeId: v.programmeId, code: v.code.trim(), ville: v.ville.trim(), lieu: v.lieu.trim() || undefined,
          debut: v.debut, fin: v.fin, capacite: v.capacite ? Number(v.capacite) : undefined,
        });
        ecranSession(s.id);
      }, [
        h("label", {}, "Programme", h("select", { name: "programmeId", required: true }, programmes.map((p) => h("option", { value: p.id }, p.nom)))),
        h("div", { class: "grille" },
          champ("Code de la session", { name: "code", required: true }),
          champ("Ville", { name: "ville", required: true }),
          champ("Lieu", { name: "lieu" }),
          champ("Début", { name: "debut", type: "date", required: true }),
          champ("Fin", { name: "fin", type: "date", required: true }),
          champ("Capacité (facultatif)", { name: "capacite", type: "number", min: 1 })),
      ], "Créer la session")) : null,
    estAdmin() && programmes.length ? h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Modifier un programme"),
      programmes.map(formProgramme)) : null,
    peutCreer && gta ? h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Nouveau programme"),
      formulaire(async (v, f, zone) => {
        const plan = [];
        if (Number(v.inscription) > 0) plan.push({ libelle: "Inscription", montant: Number(v.inscription), jours_apres_debut: 0 });
        if (Number(v.tranche1) > 0) plan.push({ libelle: "Tranche 1", montant: Number(v.tranche1), jours_apres_debut: 0 });
        if (Number(v.tranche2) > 0) plan.push({ libelle: "Tranche 2", montant: Number(v.tranche2), jours_apres_debut: Number(v.jours2 || 30) });
        if (!plan.length) throw Object.assign(new Error(), { code: "donnees_invalides" });
        await api("POST", "/programmes", {
          entiteId: gta.id, code: v.code.trim(), nom: v.nom.trim(), planPaiement: plan,
          seuilPresence: Number(v.seuil),
        });
        ecranSessions();
      }, [
        h("div", { class: "grille" },
          champ("Nom du programme", { name: "nom", required: true }),
          champ("Code", { name: "code", required: true }),
          champ("Frais d'inscription (FCFA)", { name: "inscription", type: "number", min: 0 }),
          champ("Tranche 1 (FCFA)", { name: "tranche1", type: "number", min: 0 }),
          champ("Tranche 2 (FCFA)", { name: "tranche2", type: "number", min: 0 }),
          champ("Tranche 2 due après (jours)", { name: "jours2", type: "number", min: 0, value: 30 }),
          champ("Présence minimale pour le certificat (%)", { name: "seuil", type: "number", min: 0, max: 100, value: 75, required: true })),
      ], "Créer le programme")) : null,
  );
}

/** Plan de paiement saisi ligne par ligne : "Libellé ; montant ; jours ou date". */
const lignesPlan = (texte, cle, conv) => texte.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
  const [libelle, montant, dernier] = l.split(";").map((x) => x.trim());
  if (!libelle || !(Number(montant) > 0) || !dernier) throw Object.assign(new Error(), { code: "donnees_invalides" });
  return { libelle, montant: Number(montant), [cle]: conv(dernier) };
});

function formProgramme(p) {
  const plan = p.plan_paiement.map((e) => `${e.libelle} ; ${e.montant} ; ${e.jours_apres_debut}`).join("\n");
  return h("details", {}, h("summary", {}, p.nom), formulaire(async (v) => {
    await api("PATCH", `/programmes/${p.id}`, {
      nom: v.nom.trim(), seuilPresence: Number(v.seuil),
      planPaiement: lignesPlan(v.plan, "jours_apres_debut", Number),
    });
    ecranSessions();
  }, [
    champ("Nom", { name: "nom", value: p.nom, required: true }),
    champ("Présence minimale pour le certificat (%)", { name: "seuil", type: "number", min: 0, max: 100, value: p.seuil_presence, required: true }),
    h("label", {}, "Tarif, une ligne par tranche : libellé ; montant ; jours après le début",
      h("textarea", { name: "plan", rows: 4, required: true }, plan)),
    h("p", { class: "discret-texte" }, "Le nouveau tarif vaut pour les prochains inscrits. Pour un inscrit existant, modifiez son échéancier."),
  ], "Enregistrer le programme"));
}

function formSession(id, s, collaborateurs) {
  return h("details", { class: "carte pas-imprimer" }, h("summary", {}, "Modifier la session"), formulaire(async (v) => {
    await api("PATCH", `/sessions/${id}`, {
      code: v.code.trim(), ville: v.ville.trim(), lieu: v.lieu.trim(), debut: v.debut, fin: v.fin,
      capacite: v.capacite ? Number(v.capacite) : null, statut: v.statut, formateurId: v.formateurId || null,
    });
    ecranSession(id, "Session modifiée.");
  }, [h("div", { class: "grille" },
    champ("Code", { name: "code", value: s.code, required: true }),
    champ("Ville", { name: "ville", value: s.ville, required: true }),
    champ("Lieu", { name: "lieu", value: s.lieu || "" }),
    champ("Début", { name: "debut", type: "date", value: s.debut, required: true }),
    champ("Fin", { name: "fin", type: "date", value: s.fin, required: true }),
    champ("Capacité (vide : sans limite)", { name: "capacite", type: "number", min: 1, value: s.capacite ?? "" }),
    h("label", {}, "Formateur", h("select", { name: "formateurId" }, h("option", { value: "" }, "Non attribué"),
      collaborateurs.map((c) => h("option", { value: c.id, selected: c.id === s.formateur_id }, c.nom)))),
    h("label", {}, "Statut", h("select", { name: "statut" },
      [["planifiee", "Planifiée"], ["ouverte", "Ouverte"], ["en_cours", "En cours"], ["terminee", "Terminée"], ["annulee", "Annulée"]]
        .map(([c, l]) => h("option", { value: c, selected: c === s.statut }, l))))),
  ], "Enregistrer la session"));
}

function ecranEcheancier(sessionId, i) {
  const texte = i.echeances.map((e) => `${e.libelle} ; ${e.montant} ; ${e.date_echeance}`).join("\n");
  vue(
    h("button", { class: "discret", onclick: () => ecranSession(sessionId) }, "← Retour"),
    h("h1", {}, `Échéancier : ${i.nom}`),
    h("p", { class: "discret-texte" }, `Déjà payé : ${fcfa(i.paye)}. Le nouveau total ne peut pas être inférieur.`),
    h("div", { class: "carte" }, formulaire(async (v) => {
      await api("PUT", `/inscriptions/${i.id}/echeances`, {
        motif: v.motif.trim(), echeances: lignesPlan(v.plan, "date_echeance", (x) => x),
      });
      ecranSession(sessionId, `Échéancier de ${i.nom} modifié.`);
    }, [
      h("label", {}, "Une ligne par tranche : libellé ; montant ; date (AAAA-MM-JJ)", h("textarea", { name: "plan", rows: 5, required: true }, texte)),
      champ("Motif (obligatoire)", { name: "motif", required: true, minlength: 5 }),
    ], "Enregistrer l'échéancier")));
}

function ecranDerogation(sessionId, i) {
  vue(
    h("button", { class: "discret", onclick: () => ecranSession(sessionId) }, "← Retour"),
    h("h1", {}, `Certificat par exception : ${i.nom}`),
    h("p", { class: "discret-texte" }, "Les contrôles de fin de session, de solde et de présence seront ignorés. Le motif reste enregistré."),
    h("div", { class: "carte" }, formulaire(async (v) => {
      await api("POST", `/inscriptions/${i.id}/certificat`, { derogation: v.motif.trim() });
      voirCertificat(sessionId, i.id);
    }, [champ("Motif (obligatoire)", { name: "motif", required: true, minlength: 5 })], "Délivrer par exception")));
}

async function ecranSession(id, message) {
  const d = await api("GET", `/sessions/${id}/suivi`);
  if (!droits.length) droits = (await api("GET", "/moi")).permissions;
  const s = d.session;
  const formInscription = formulaire(async (v, f, zone) => {
    const corps = {
      type: "personne", nom: v.nom.trim(), entiteId: s.entite_id,
      telephone: v.telephone.trim() || undefined, email: v.email.trim() || undefined,
    };
    const inscrire = async (tiersId) => {
      await api("POST", `/sessions/${id}/inscriptions`, { tiersId });
      ecranSession(id, `${corps.nom} est inscrit.`);
    };
    try {
      await inscrire((await api("POST", "/tiers", corps)).id);
    } catch (e) {
      if (e.code !== "doublon_probable") throw e;
      zone.replaceChildren(h("div", { class: "erreur" },
        h("p", {}, "Cette personne semble déjà exister. Que voulez-vous faire ?"),
        e.details.map((t) => h("button", { type: "button", class: "discret", onclick: () => inscrire(t.id).catch((x) => zone.replaceChildren(h("div", { class: "erreur" }, texteErreur(x)))) }, `Inscrire ${t.nom}${t.telephone ? ` (${t.telephone})` : ""}`)),
        " ",
        h("button", { type: "button", class: "discret", onclick: async () => inscrire((await api("POST", "/tiers", { ...corps, ignorerDoublons: true })).id) }, "Créer une nouvelle fiche")));
    }
  }, [h("div", { class: "grille" },
    champ("Nom complet", { name: "nom", required: true }),
    champ("Téléphone", { name: "telephone", type: "tel" }),
    champ("E-mail", { name: "email", type: "email" }))], "Inscrire");

  vue(
    h("button", { class: "discret pas-imprimer", onclick: ecranSessions }, "← Toutes les sessions"),
    h("h1", {}, s.programme),
    droits.includes("formations.gerer") ? h("button", { class: "discret pas-imprimer", onclick: () => ecranGestionSession(id, s.code) }, "Coûts, attente, documents et codes") : null,
    h("p", { class: "discret-texte" }, `${s.code} · ${s.ville}${s.lieu ? `, ${s.lieu}` : ""} · du ${dateFr(s.debut)} au ${dateFr(s.fin)}`),
    message ? h("div", { class: "succes", role: "status" }, message) : null,
    h("div", { class: "chiffres" },
      h("div", { class: "chiffre" }, h("b", {}, d.totaux.inscrits), h("span", {}, "Inscrits actifs")),
      h("div", { class: "chiffre" }, h("b", {}, fcfa(d.totaux.du)), h("span", {}, "Total dû")),
      h("div", { class: "chiffre" }, h("b", {}, fcfa(d.totaux.paye)), h("span", {}, "Encaissé")),
      h("div", { class: "chiffre" }, h("b", {}, fcfa(d.totaux.reste)), h("span", {}, "Reste à encaisser"))),
    h("div", { class: "actions pas-imprimer" },
      h("button", { onclick: () => ecranAppel(id, d) }, "Faire l'appel"),
      h("button", { class: "discret", onclick: () => ecranAvis(id, s) }, "Avis et satisfaction")),
    h("div", { class: "carte", style: null },
      h("h2", {}, "Apprenants"),
      d.inscrits.length ? d.inscrits.map((i) => ligneApprenant(id, i)) : h("p", { class: "discret-texte" }, "Aucun inscrit pour le moment.")),
    h("div", { class: "carte pas-imprimer" }, h("h2", {}, "Inscrire un apprenant"), formInscription),
    estAdmin() ? formSession(id, s, await api("GET", "/collaborateurs")) : null,
  );
}

function ligneApprenant(sessionId, i) {
  const prochaine = i.echeances.find((e) => e.solde > 0);
  return h("div", { class: "apprenant" },
    h("div", { class: "ligne" },
      h("span", { class: "nom" }, i.nom),
      i.reste === 0 ? h("span", { class: "pastille ok" }, "Soldé") : h("span", { class: "pastille attente" }, `Reste ${fcfa(i.reste)}`)),
    h("div", { class: "discret-texte" },
      `${i.telephone || "Sans téléphone"} · Présence : ${i.taux_presence === null ? "aucune séance" : `${i.taux_presence} %`}`,
      prochaine ? ` · Prochaine échéance : ${prochaine.libelle}, ${dateFr(prochaine.date_echeance)}` : ""),
    i.statut !== "active" ? h("div", { class: "discret-texte" }, `Inscription : ${i.statut}`) : null,
    h("div", { class: "actions pas-imprimer" },
      i.reste > 0 && i.statut === "active" ? h("button", { class: "discret", onclick: () => ecranPaiement(sessionId, i) }, "Encaisser") : null,
      h("button", { class: "discret", onclick: () => ecranHistorique(sessionId, i) }, "Historique"),
      i.certificat_id
        ? h("button", { class: "discret", onclick: () => voirCertificat(sessionId, i.id) }, "Voir le certificat")
        : i.statut === "active" ? h("button", { class: "discret", onclick: () => delivrer(sessionId, i) }, "Délivrer le certificat") : null,
      estAdmin() && i.statut === "active" ? h("button", { class: "discret", onclick: () => ecranEcheancier(sessionId, i) }, "Modifier l'échéancier") : null,
      estAdmin() && i.statut === "active" && !i.certificat_id ? h("button", { class: "discret", onclick: () => ecranDerogation(sessionId, i) }, "Certificat par exception") : null,
      estAdmin() ? h("button", { class: i.statut === "active" ? "danger" : "discret", onclick: () => changerStatut(sessionId, i) }, i.statut === "active" ? "Retirer de la session" : "Réactiver") : null));
}

async function changerStatut(sessionId, i) {
  const statut = i.statut === "active" ? "annulee" : "active";
  await api("POST", `/inscriptions/${i.id}/statut`, { statut });
  ecranSession(sessionId, statut === "active" ? `${i.nom} est réactivé.` : `${i.nom} est retiré de la session.`);
}

async function delivrer(sessionId, i) {
  try {
    await api("POST", `/inscriptions/${i.id}/certificat`);
    voirCertificat(sessionId, i.id);
  } catch (e) {
    if (e.code === "expire") return;
    let m = texteErreur(e);
    if (e.code === "presence_insuffisante") m += ` Présence ${e.details.taux ?? 0} %, minimum ${e.details.seuil} %.`;
    if (e.code === "solde_non_regle") m += ` Reste ${fcfa(e.details.reste)}.`;
    await ecranSession(sessionId);
    racine.querySelector("main").prepend(h("div", { class: "erreur", role: "alert" }, m));
  }
}

function ecranPaiement(sessionId, i) {
  vue(
    h("button", { class: "discret", onclick: () => ecranSession(sessionId) }, "← Retour"),
    h("h1", {}, `Encaisser : ${i.nom}`),
    h("p", { class: "discret-texte" }, `Reste à payer : ${fcfa(i.reste)}`),
    h("div", { class: "carte" }, formulaire(async (v) => {
      const p = await api("POST", `/inscriptions/${i.id}/paiements`, {
        montant: Number(v.montant), moyen: v.moyen, reference: v.reference.trim() || undefined,
      });
      voirRecu(sessionId, p);
    }, [
      champ("Montant (FCFA)", { name: "montant", type: "number", min: 1, max: i.reste, value: i.reste, required: true }),
      h("label", {}, "Moyen de paiement", h("select", { name: "moyen" },
        [["especes", "Espèces"], ["mtn_momo", "MTN Mobile Money"], ["orange_money", "Orange Money"], ["virement", "Virement"], ["cheque", "Chèque"], ["carte", "Carte"]]
          .map(([c, l]) => h("option", { value: c }, l)))),
      champ("Référence de la transaction (sauf espèces)", { name: "reference" }),
    ], "Enregistrer le paiement")));
}

function voirRecu(sessionId, p) {
  vue(
    h("div", { class: "actions pas-imprimer" },
      h("button", { class: "discret", onclick: () => ecranSession(sessionId) }, "← Retour à la session"),
      h("button", { onclick: () => window.print() }, "Imprimer")),
    h("div", { class: "document" },
      h("h2", {}, "Reçu de paiement"),
      h("p", {}, h("b", {}, p.numero_recu), ` · ${new Date(p.encaisse_le).toLocaleString("fr-FR", { timeZone: "Africa/Douala" })}`),
      h("p", {}, `Reçu de : ${p.apprenant}`),
      h("p", {}, `Formation : ${p.programme} (${p.session})`),
      h("p", { class: "grand" }, fcfa(p.montant)),
      h("p", {}, `Moyen : ${{ especes: "Espèces", mtn_momo: "MTN Mobile Money", orange_money: "Orange Money", virement: "Virement", cheque: "Chèque", carte: "Carte" }[p.moyen] ?? p.moyen}${p.reference ? `, référence ${p.reference}` : ""}`),
      h("p", {}, `Reste à payer après ce paiement : ${fcfa(p.reste_apres)}`)));
}

async function ecranHistorique(sessionId, i) {
  const paiements = await api("GET", `/inscriptions/${i.id}/paiements`);
  vue(
    h("button", { class: "discret", onclick: () => ecranSession(sessionId) }, "← Retour"),
    h("h1", {}, `Paiements : ${i.nom}`),
    h("div", { class: "carte" },
      h("h2", {}, "Échéancier"),
      i.echeances.map((e) => h("div", { class: "ligne apprenant" },
        h("span", {}, `${e.libelle}, ${dateFr(e.date_echeance)}`),
        e.solde === 0 ? h("span", { class: "pastille ok" }, `Payé ${fcfa(e.montant)}`) : h("span", { class: "pastille attente" }, `Reste ${fcfa(e.solde)} sur ${fcfa(e.montant)}`)))),
    h("div", { class: "carte" },
      h("h2", {}, "Reçus"),
      paiements.length ? paiements.map((p) => h("div", { class: "apprenant" },
        h("div", { class: "ligne" }, h("span", { class: "nom" }, `${p.numero_recu} : ${fcfa(p.montant)}`), p.annule_le ? h("span", { class: "pastille attente" }, "Annulé") : null),
        h("div", { class: "discret-texte" }, `${p.moyen}${p.reference ? `, ${p.reference}` : ""} · ${new Date(p.encaisse_le).toLocaleString("fr-FR", { timeZone: "Africa/Douala" })} · ${p.encaisse_par_nom}`),
        p.motif_annulation ? h("div", { class: "discret-texte" }, `Motif : ${p.motif_annulation}`) : null,
        !p.annule_le ? formAnnulation(sessionId, p) : null)) : h("p", { class: "discret-texte" }, "Aucun paiement.")));
}

function formAnnulation(sessionId, p) {
  return h("details", {}, h("summary", {}, "Annuler ce paiement"),
    formulaire(async (v) => {
      await api("POST", `/paiements/${p.id}/annulation`, { motif: v.motif.trim() });
      ecranSession(sessionId, `Le paiement ${p.numero_recu} est annulé.`);
    }, [champ("Motif (obligatoire)", { name: "motif", required: true, minlength: 5 })], "Confirmer l'annulation"));
}

async function ecranAppel(id, d) {
  const actifs = d.inscrits.filter((i) => i.statut === "active");
  const debut = d.session.debut, fin = d.session.fin;
  const jour = aujourdhui();
  const choisie = jour < debut ? debut : jour > fin ? fin : jour;
  const zone = h("div");
  const charger = async (date) => {
    const saisies = await api("GET", `/sessions/${id}/presences?date=${date}`);
    const present = new Map(saisies.map((p) => [p.inscription_id, p.present]));
    zone.replaceChildren(saisies.length ? h("p", { class: "discret-texte" }, "L'appel de cette date existe déjà : vous pouvez le corriger.") : "",
      ...actifs.map((i) => h("label", { class: "appel" },
        h("input", { type: "checkbox", name: "p", value: i.id, checked: present.get(i.id) ?? false }), i.nom)));
    zone.querySelectorAll("input").forEach((c, n) => { c.checked = present.get(actifs[n].id) ?? false; });
  };
  vue(
    h("button", { class: "discret", onclick: () => ecranSession(id) }, "← Retour"),
    h("h1", {}, "Faire l'appel"),
    h("div", { class: "carte" }, formulaire(async (v, f) => {
      const presents = [...f.querySelectorAll("input[name=p]:checked")].map((c) => c.value);
      const r = await api("PUT", `/sessions/${id}/presences`, { date: v.date, presents });
      ecranSession(id, `Appel enregistré : ${r.presents} présent(s), ${r.absents} absent(s).`);
    }, [
      champ("Date de la séance", { name: "date", type: "date", value: choisie, min: debut, max: fin, required: true, onchange: (e) => charger(e.target.value) }),
      zone,
    ], "Enregistrer l'appel")));
  await charger(choisie);
}

async function voirCertificat(sessionId, inscriptionId) {
  const c = await api("GET", `/inscriptions/${inscriptionId}/certificat`);
  const qr = new DOMParser().parseFromString(c.qr_svg, "image/svg+xml").documentElement;
  qr.setAttribute("class", "qr");
  qr.setAttribute("role", "img");
  qr.setAttribute("aria-label", "QR code de vérification du certificat");
  vue(
    h("div", { class: "actions pas-imprimer" },
      h("button", { class: "discret", onclick: () => ecranSession(sessionId) }, "← Retour à la session"),
      h("button", { onclick: () => window.print() }, "Imprimer")),
    h("div", { class: "document" },
      c.revoque_le ? h("p", { class: "etat rouge" }, "Certificat révoqué") : null,
      h("h2", {}, "Certificat de formation"),
      h("p", {}, "Global Training Academy certifie que"),
      h("p", { class: "grand" }, c.titulaire),
      h("p", {}, `a suivi avec succès la formation : ${c.programme}`),
      h("p", {}, `N° ${c.numero}, délivré le ${dateFr(c.delivre_le)}`),
      qr,
      h("p", { class: "discret-texte" }, "Scannez ce code pour vérifier l'authenticité du certificat.")));
}

window.addEventListener("unhandledrejection", (e) => {
  if (e.reason?.code === "expire" || e.reason?.code === "obsolete") return;
  racine.querySelector("main")?.prepend(h("div", { class: "erreur", role: "alert" }, texteErreur(e.reason || {})));
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

/** Sans internet au chargement, seule une caisse déjà ouverte dans cet onglet peut continuer. */
if (jeton) {
  ecranAccueil().catch((e) => {
    if (e instanceof TypeError && lireLocal(sessionStorage, "smarte.caisse", null)) return ecranCaisse();
    throw e;
  });
} else {
  ecranConnexion();
}
