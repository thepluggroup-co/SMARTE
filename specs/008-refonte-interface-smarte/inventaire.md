# Inventaire de la refonte SMARTE

Le relevé initial couvre les entrées autonomes et le cadre connecté. Le relevé des écrans connectés figure dans l’index ci-dessous. Le contrôle navigateur ci-dessous a utilisé des réponses d’API fictives.

| Point d’entrée | Module et espace | Accès | Modèle | Lot | Vérification | État |
| --- | --- | --- | --- | --- | --- | --- |
| `public/index.html` → `ecranConnexion` | Session · commun | Connexion | Formulaire autonome | 4 | Connexion, erreur, clavier et mobile | Recensé |
| `public/index.html` → `vue` | Cadre connecté · GTA et GLOMARI | Session et droits du module | Barre, navigation et contenu | 1 | Changement de thème, destination active, focus et restauration du dernier module | Premier contrôle Chromium |
| `public/tableau.js` → `ecranTableauDeBord` | Accueil · GTA et GLOMARI | Selon rôle | Indicateurs et actions | 1 | Raccourcis vers sessions et commandes réservées | Premier contrôle Chromium |
| `public/app.js` → `ecranSessions` | Formation · GTA | `formations.voir` | Liste de sessions | 1 et 2 | Ouvrir une session et faire l’appel | Appel, filtres, tri et focus de retour vérifiés avec le rôle Formateur à 360 px |
| `public/canalenligne.js` → `ecranCommandesEnLigne` | Commandes · GLOMARI | `facturation.voir` | Liste et détail | 1 et 3 | Ouvrir une liste filtrée, puis tester le lieu, la fiche et le retour | Filtre, panneau et retour vérifiés avec API simulée |
| `public/cours.html` | Cours · GTA | Lien de cours | Portail | 2 | Ouvrir un lien existant et ses états d’accès | Progression jusqu’à la fin du cours et retrait de l’accès vérifiés à 360 px |
| `public/verifier.html` | Certificats · GTA | Lien de vérification | Résultat public | 2 | Vérifier un certificat et un code invalide | Recensé |
| `public/avis.html` | Avis de formation · GTA | Lien d’avis | Formulaire public | 2 | Ouvrir un lien de formation et vérifier les états d’accès | Recensé |
| `public/boutique.html` | Boutique de cours · GTA | Accès public prévu | Catalogue de cours | 2 | Parcourir les cours et tester la demande d’accès | Recensé |
| `public/evaluer.html` | Avis · GLOMARI | Lien d’évaluation | Formulaire public | 3 | Soumettre un avis de recette | Recensé |
| `public/portail.html` | Portail grossiste · GLOMARI | Lien du portail | Portail | 3 | Ouvrir un lien et vérifier les actions autorisées | Recensé |
| `public/suivi.html` | Suivi · GLOMARI | Lien de suivi | Suivi public | 3 | Ouvrir un lien valide et un lien expiré ou invalide | Recensé |
| `public/capture.html` | Prospection · selon formulaire | Lien de formulaire | Formulaire public | 4 | Conserver le lien et contrôler la saisie | Recensé |
| `public/console.html` | Administration · groupe | Accès console | Console autonome | 4 | Vérifier l’accès et l’affichage par rôle | Recensé |
| `public/evenement.html` | Événements · selon événement | Lien événement | Formulaire public | 4 | Ouvrir l’événement et vérifier la validation | Recensé |
| `public/postuler.html` | Recrutement · selon offre | Lien offre | Formulaire public | 4 | Ouvrir l’offre et vérifier la candidature | Recensé |
| `public/reserver.html` | Réservation · selon ressource | Lien de réservation | Formulaire public | 4 | Ouvrir un créneau et vérifier la réservation | Recensé |

## Premier contrôle du cadre

Chromium à 390 px sur les fichiers réels de `public/`. Un compte simulé habilité aux deux entités a ouvert les sessions GTA depuis l’accueil, changé vers GLOMARI, ouvert les commandes au statut réservé et retrouvé le module Formations au retour. La sélection du menu et le focus sur le titre ont été observés.

## Contrôle des parcours pilotes

Chromium à 390 px avec données et réponses API fictives. GTA a conservé la recherche et rendu le focus à la session après enregistrement de l’appel. GLOMARI a conservé le statut et le magasin après fermeture du panneau de commande et a rendu le focus à la commande. Les contrôles serveur du filtre et de l’isolement sont ajoutés à `tests/canalgestion.test.ts`. PostgreSQL refuse l’authentification du compte de test, ce qui bloque leur exécution locale.

## Index des écrans connectés à vérifier

Relevé statique des fonctions d’écran, de fiche et de formulaire dans les scripts chargés par le cadre. Les droits d’action repérés ne remplacent pas le contrôle du droit d’accès à l’écran. Les variantes créées à l’intérieur d’une fonction restent à vérifier pendant la recette du module.

| Point d’entrée | Module et espace | Accès | Modèle | Lot | Vérification | État |
| --- | --- | --- | --- | --- | --- | --- |
| `public/relation.js` → `ecranClients` | relation · selon contexte | `crm.gerer`, `tiers.creer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/relation.js` → `ecranOpportunite` | relation · selon contexte | `crm.gerer`, `care.gerer` (actions repérées) | Écran ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/relation.js` → `ecranSupport` | relation · selon contexte | `support.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recherche et focus rétablis au retour de la fiche avec le rôle Service client GLOMARI à 360 px |
| `public/relation.js` → `ecranTicket` | relation · selon contexte | `support.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Réponse enregistrée avec le rôle Service client GLOMARI à 360 px |
| `public/relation.js` → `ecranTaches` | relation · selon contexte | `taches.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/gta.js` → `ecranAvis` | gta · GTA | `formations.gerer`, `avis.moderer` (actions repérées) | Liste ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/gta.js` → `ecranIndicateurs` | gta · GTA | `entites.voir` (actions repérées) | Liste ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/gta.js` → `ecranMentorats` | gta · GTA | `mentorat.gerer` (actions repérées) | Liste ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/gta.js` → `ecranMentorat` | gta · GTA | `mentorat.gerer` (actions repérées) | Liste ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/gta.js` → `ecranFoundation` | gta · GTA | `foundation.gerer` (actions repérées) | Liste ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/gta.js` → `ecranProjetFoundation` | gta · GTA | `foundation.gerer` (actions repérées) | Liste ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/tableau.js` → `ecranTableauDeBord` | tableau · selon contexte | `formations.voir`, `apprentissage.voir`, `facturation.voir`, `stocks.voir`, `caisse.vendre` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/quotidien.js` → `ecranSignaler` | quotidien · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/quotidien.js` → `ecranProblemes` | quotidien · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/quotidien.js` → `ecranProbleme` | quotidien · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/quotidien.js` → `ecranJourneeCollaborateur` | quotidien · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/quotidien.js` → `ecranDirectionPerf` | quotidien · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/quotidien.js` → `ecranReglagesQuotidien` | quotidien · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/quotidien.js` → `ecranMessages` | quotidien · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/fiches.js` → `ecranMaFiche` | fiches · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/fiches.js` → `ecranFichesPoste` | fiches · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/fiches.js` → `ecranFichePoste` | fiches · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/okr.js` → `ecranObjectifOkr` | okr · selon contexte | `documents.voir`, `pilotage.voir` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/entrepots.js` → `ecranStocks` | entrepots · GLOMARI | Rôle hérité du parcours, à vérifier | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recherche par code vérifiée avec le rôle Magasinier à 360 px |
| `public/entrepots.js` → `ecranStockCouverture` | entrepots · GLOMARI | Rôle hérité du parcours, à vérifier | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/entrepots.js` → `ecranStockArticles` | entrepots · GLOMARI | `catalogue.gerer` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Onglet Articles et catégories ouvert avec le rôle Magasinier, import masqué |
| `public/entrepots.js` → `ecranStockExpirations` | entrepots · GLOMARI | `stocks.gerer` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/entrepots.js` → `ecranStockAvaries` | entrepots · GLOMARI | `stocks.gerer` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/entrepots.js` → `ecranStockImport` | entrepots · GLOMARI | Rôle hérité du parcours, à vérifier | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/rapports.js` → `ecranRapportsStockVentes` | rapports · GLOMARI | `rh.paie`, `rh.gerer` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/gestion.js` → `ecranFacturation` | gestion · selon contexte | `facturation.gerer`, `catalogue.gerer`, `facturation.administrer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/gestion.js` → `ecranNouveauDocument` | gestion · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/gestion.js` → `ecranDocument` | gestion · selon contexte | `facturation.gerer`, `stocks.gerer`, `facturation.encaisser`, `facturation.administrer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/gestion.js` → `ecranIdentites` | gestion · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/gestion.js` → `ecranCatalogue` | gestion · selon contexte | `stocks.voir` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/gestion.js` → `ecranStockMouvements` | gestion · selon contexte | `stocks.gerer`, `stocks.valider` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/gestion.js` → `ecranAchats` | gestion · selon contexte | `achats.gerer`, `tiers.voir`, `tresorerie.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recherche par numéro de bon vérifiée avec le rôle Acheteur à 1 280 px |
| `public/gestion.js` → `ecranCommande` | gestion · selon contexte | `achats.gerer`, `tresorerie.gerer`, `tiers.voir`, `achats.approuver`, `stocks.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Ouverture du bon en brouillon vérifiée avec le rôle Acheteur, approbation masquée |
| `public/gestion.js` → `ecranMouvements` | gestion · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/gestion.js` → `ecranAcces` | gestion · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/gestion.js` → `ecranMagasins` | gestion · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/caisse.js` → `ecranCaisse` | caisse · GLOMARI | `caisse.superviser` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/caisse.js` → `voirTicket` | caisse · GLOMARI | Rôle hérité du parcours, à vérifier | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/caisse.js` → `ecranTicketCaisse` | caisse · GLOMARI | `caisse.superviser` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/mall.js` → `ecranMall` | mall · GLOMARI | `mall.gerer` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/mall.js` → `ecranRayons` | mall · GLOMARI | `catalogue.gerer` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/mall.js` → `voirEtiquettes` | mall · GLOMARI | Rôle hérité du parcours, à vérifier | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/mall.js` → `ecranRelais` | mall · GLOMARI | `tresorerie.voir`, `transport.gerer` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/mall.js` → `ecranPortail` | mall · GLOMARI | `facturation.gerer`, `facturation.administrer` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/canalenligne.js` → `ecranCommandesEnLigne` | canalenligne · GLOMARI | `facturation.gerer`, `tresorerie.voir`, `facturation.voir`, `facturation.administrer`, `tresorerie.gerer` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/canalenligne.js` → `ecranBoutiqueEnLigne` | canalenligne · GLOMARI | Rôle hérité du parcours, à vérifier | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/precommandes.js` → `ecranPrecommandes` | precommandes · GLOMARI | `achats.gerer`, `tiers.voir`, `facturation.voir` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Filtre des campagnes ouvertes et lecture d’un acompte vérifiés avec le rôle Magasinier, création masquée |
| `public/depotvente.js` → `ecranDepotVente` | depotvente · GLOMARI | `achats.gerer`, `stocks.gerer`, `compta.saisir`, `tiers.voir` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/messages.js` → `ecranMessagesClients` | messages · GLOMARI | `facturation.administrer`, `care.gerer`, `entites.gerer` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/assistantcare.js` → `ecranAssistantCare` | assistantcare · GLOMARI | `care.voir`, `care.gerer` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/assistantcare.js` → `ecranConversationAssistantCare` | assistantcare · GLOMARI | Rôle hérité du parcours, à vérifier | Écran ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/fichesvente.js` → `ecranFichesVente` | fichesvente · GLOMARI | Rôle hérité du parcours, à vérifier | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/fichesvente.js` → `ecranFicheVente` | fichesvente · GLOMARI | `marketing.gerer` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/commerce.js` → `ecranCare` | commerce · GLOMARI | `care.gerer`, `catalogue.gerer`, `tresorerie.voir`, `stocks.gerer` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/commerce.js` → `ecranMarketing` | commerce · GLOMARI | `marketing.gerer`, `retours.voir`, `retours.gerer` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/commerce.js` → `ecranReseau` | commerce · GLOMARI | `reseau.gerer`, `tresorerie.voir`, `facturation.voir`, `catalogue.gerer`, `facturation.administrer` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Vérification d’un vendeur enregistrée avec le rôle Réseau à 360 px |
| `public/commerce.js` → `ecranPerformance` | commerce · GLOMARI | `rh.evaluer`, `audit.voir`, `entites.gerer`, `rh.gerer` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/recouvrement.js` → `ecranRecouvrement` | recouvrement · selon contexte | `facturation.administrer`, `facturation.gerer`, `compta.valider` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/recouvrement.js` → `ecranModelesRelance` | recouvrement · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/recouvrement.js` → `ecranRecurrentes` | recouvrement · selon contexte | `facturation.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/recouvrement.js` → `ecranProspection` | recouvrement · selon contexte | `crm.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/recouvrement.js` → `ecranSegment` | recouvrement · selon contexte | `crm.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/recouvrement.js` → `ecranRecherche` | recouvrement · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/recouvrement.js` → `ecranNotifications` | recouvrement · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/recouvrement.js` → `ecranCompte` | recouvrement · selon contexte | `entites.gerer` (actions repérées) | Écran ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/recouvrement.js` → `ecranSeparation` | recouvrement · selon contexte | Rôle hérité du parcours, à vérifier | Écran ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/documents.js` → `ecranDocuments` | documents · selon contexte | `agenda.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/documents.js` → `ecranMonEspace` | documents · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/documents.js` → `ecranMonBulletin` | documents · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/documents.js` → `ecranNotesFrais` | documents · selon contexte | `tresorerie.gerer`, `rh.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/documents.js` → `ecranSites` | documents · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/documents.js` → `ecranBorne` | documents · selon contexte | Rôle hérité du parcours, à vérifier | Écran ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/documents.js` → `ecranComptesEmployes` | documents · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/documents.js` → `ecranRecrutement` | documents · selon contexte | `rh.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/documents.js` → `ecranOffre` | documents · selon contexte | `rh.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/documents.js` → `ecranPromotions` | documents · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/scolarite.js` → `ecranReservations` | scolarite · GTA | Rôle hérité du parcours, à vérifier | Liste ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/evenements.js` → `ecranEvenements` | evenements · selon contexte | `marketing.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/evenements.js` → `ecranEvenement` | evenements · selon contexte | `marketing.gerer`, `tresorerie.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/evenements.js` → `ecranBibliotheque` | evenements · selon contexte | `coaching.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/pedagogie.js` → `ecranPedagogie` | pedagogie · GTA | `apprentissage.gerer` (actions repérées) | Liste ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/pedagogie.js` → `ecranAnimation` | pedagogie · GTA | Rôle hérité du parcours, à vérifier | Liste ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/pedagogie.js` → `ecranGestionSession` | pedagogie · GTA | Rôle hérité du parcours, à vérifier | Liste ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/logistique.js` → `ecranLogistique` | logistique · GLOMARI | `achats.voir`, `tiers.voir`, `stocks.gerer`, `achats.gerer`, `catalogue.gerer` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/logistique.js` → `ecranInventaire` | logistique · GLOMARI | `stocks.gerer` (actions repérées) | Liste ou fiche | 3 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/tour.js` → `ecranTour` | tour · selon contexte | `pilotage.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/tour.js` → `ecranRegles` | tour · selon contexte | `pilotage.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/tour.js` → `ecranContrats` | tour · selon contexte | `documents.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/tour.js` → `ecranMaintenance` | tour · selon contexte | `pilotage.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/tour.js` → `ecranAudits` | tour · selon contexte | `pilotage.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/tour.js` → `ecranAide` | tour · selon contexte | `support.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/finitions.js` → `ecranRapports` | finitions · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/finitions.js` → `ecranPrevisions` | finitions · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/finitions.js` → `ecranPreparation` | finitions · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/controle.js` → `ecranKpi` | controle · selon contexte | `pilotage.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/controle.js` → `ecranApi` | controle · selon contexte | `compta.cloturer`, `utilisateurs.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/controle.js` → `ecranPrevision` | controle · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/pilotage.js` → `ecranPilotage` | pilotage · selon contexte | `pilotage.gerer`, `utilisateurs.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/pilotage.js` → `ecranProjet` | pilotage · selon contexte | `pilotage.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/pilotage.js` → `ecranLivraisons` | pilotage · selon contexte | `transport.gerer`, `tresorerie.voir`, `transport.livrer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/pilotage.js` → `ecranAffilies` | pilotage · selon contexte | `affiliation.gerer`, `tresorerie.voir` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/compta.js` → `ecranCompta` | compta · selon contexte | `compta.cloturer`, `compta.saisir` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/compta.js` → `ecranEcritures` | compta · selon contexte | `compta.valider` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/compta.js` → `ecranSaisie` | compta · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/compta.js` → `ecranBalance` | compta · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/compta.js` → `ecranGrandLivre` | compta · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/compta.js` → `ecranEtats` | compta · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/compta.js` → `ecranClotures` | compta · selon contexte | `compta.cloturer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/compta.js` → `ecranPlan` | compta · selon contexte | `compta.cloturer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/compta.js` → `ecranFournisseurs` | compta · selon contexte | `compta.saisir` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/compta.js` → `ecranFactureFournisseur` | compta · selon contexte | `compta.valider`, `compta.saisir`, `compta.cloturer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/tresorerie.js` → `ecranTresorerie` | tresorerie · selon contexte | `tresorerie.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/tresorerie.js` → `ecranPortefeuille` | tresorerie · selon contexte | `tresorerie.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/academie.js` → `voirTitre` | academie · GTA | Rôle hérité du parcours, à vérifier | Écran ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/academie.js` → `ecranCoaching` | academie · GTA | `coaching.gerer` (actions repérées) | Liste ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/academie.js` → `ecranAccompagnement` | academie · GTA | Rôle hérité du parcours, à vérifier | Liste ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/academie.js` → `ecranUniversite` | academie · GTA | `universite.gerer` (actions repérées) | Liste ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/academie.js` → `ecranFiliere` | academie · GTA | `universite.gerer` (actions repérées) | Liste ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/academie.js` → `ecranEtudiant` | academie · GTA | `universite.notes`, `universite.gerer` (actions repérées) | Liste ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/modules.js` → `ecranCours` | modules · selon contexte | `apprentissage.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/modules.js` → `ecranUnCours` | modules · selon contexte | `apprentissage.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/modules.js` → `ecranRh` | modules · selon contexte | `rh.gerer`, `rh.paie` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/modules.js` → `ecranEmploye` | modules · selon contexte | `rh.gerer`, `rh.paie` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/modules.js` → `ecranRubriques` | modules · selon contexte | `entites.gerer` (actions repérées) | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/modules.js` → `ecranPaieEmploye` | modules · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/modules.js` → `voirBulletin` | modules · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/app.js` → `ecranConnexion` | app · selon contexte | Rôle hérité du parcours, à vérifier | Écran ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/app.js` → `ecranSessions` | app · GTA | `formations.voir`, `coaching.voir`, `universite.voir`, `caisse.vendre`, `stocks.voir`, `rh.voir`, `apprentissage.voir`, `crm.voir`, `support.voir`, `formations.gerer` (actions repérées) | Liste ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/app.js` → `ecranEcheancier` | app · selon contexte | Rôle hérité du parcours, à vérifier | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/app.js` → `ecranDerogation` | app · selon contexte | Rôle hérité du parcours, à vérifier | Écran ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/app.js` → `ecranSession` | app · GTA | `formations.voir`, `formations.gerer`, `tiers.creer`, `presences.saisir` | Liste ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Visibilité des actions vérifiée avec Formateur, Gestion des formations et Administrateur |
| `public/app.js` → `ecranPaiement` | app · GTA | Rôle hérité du parcours, à vérifier | Liste ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/app.js` → `voirRecu` | app · GTA | Rôle hérité du parcours, à vérifier | Écran ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/app.js` → `ecranHistorique` | app · GTA | `formations.voir`, `paiements.annuler` | Liste ou fiche | 4 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Affichage d’un reçu et visibilité de l’annulation vérifiés avec les trois rôles de recette |
| `public/app.js` → `ecranAppel` | app · GTA | `presences.saisir` | Liste ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Appel enregistré et retour à la liste vérifiés avec le rôle Formateur |
| `public/app.js` → `voirCertificat` | app · GTA | Rôle hérité du parcours, à vérifier | Écran ou fiche | 2 | Ouvrir depuis son entrée métier et vérifier thème, actions et retour | Recensé |
| `public/quotidien.js` → `ecranMaJournee` | quotidien · Selon contexte | Rôle hérité du parcours | Écran ou fiche | 4 | Ouvrir depuis le module et vérifier retour, droits et interactions | Recensé |
| `public/quotidien.js` → `ecranMonEquipe` | quotidien · Selon contexte | Rôle hérité du parcours | Écran ou fiche | 4 | Ouvrir depuis le module et vérifier retour, droits et interactions | Recensé |
| `public/okr.js` → `ecranOkr` | okr · Selon contexte | `pilotage.gerer` | Écran ou fiche | 4 | Ouvrir depuis le module et vérifier retour, droits et interactions | Recensé |
| `public/okr.js` → `ecranEquipeOkr` | okr · Selon contexte | `pilotage.voir` | Écran ou fiche | 4 | Ouvrir depuis le module et vérifier retour, droits et interactions | Recensé |
| `public/okr.js` → `ecranMesOkr` | okr · Selon contexte | `documents.voir` | Écran ou fiche | 4 | Ouvrir depuis le module et vérifier retour, droits et interactions | Recensé |
| `public/rapports.js` → `ecranCommissions` | rapports · GLOMARI | `rh.paie`, `rh.gerer` | Écran ou fiche | 3 | Ouvrir depuis le module et vérifier retour, droits et interactions | Recensé |
| `public/canalenligne.js` → `ecranPaiementsEnLigne` | canalenligne · GLOMARI | `tresorerie.gerer` | Écran ou fiche | 3 | Ouvrir depuis le module et vérifier retour, droits et interactions | Recensé |
| `public/documents.js` → `ecranAgenda` | documents · Selon contexte | `agenda.gerer` | Écran ou fiche | 4 | Ouvrir depuis le module et vérifier retour, droits et interactions | Recensé |
| `public/scolarite.js` → `ecranScolarite` | scolarite · GTA | `universite.gerer`, `tresorerie.voir` | Écran ou fiche | 2 | Ouvrir depuis le module et vérifier retour, droits et interactions | Ouverture d’une filière et ajout d’un frais vérifiés avec le rôle Scolarité à 360 px |
| `public/scolarite.js` → `ecranEmploiDuTemps` | scolarite · GTA | `universite.gerer`, `universite.notes` | Écran ou fiche | 2 | Ouvrir depuis le module et vérifier retour, droits et interactions | Recensé |
| `public/scolarite.js` → `ecranEtatPaie` | scolarite · GTA | `tresorerie.gerer` | Écran ou fiche | 2 | Ouvrir depuis le module et vérifier retour, droits et interactions | Recensé |
| `public/evenements.js` → `ecranStatsUniversite` | evenements · Selon contexte | Rôle hérité du parcours | Écran ou fiche | 4 | Ouvrir depuis le module et vérifier retour, droits et interactions | Recensé |
| `public/fiscal.js` → `ecranFiscal` | fiscal · Selon contexte | `tresorerie.voir`, `compta.cloturer`, `compta.saisir`, `compta.valider`, `utilisateurs.gerer` | Écran ou fiche | 4 | Ouvrir depuis le module et vérifier retour, droits et interactions | Recensé |
| `public/tour.js` → `ecranAnalyse` | tour · Selon contexte | Rôle hérité du parcours | Écran ou fiche | 4 | Ouvrir depuis le module et vérifier retour, droits et interactions | Recensé |
| `public/controle.js` → `ecranBudget` | controle · Selon contexte | `compta.cloturer` | Écran ou fiche | 4 | Ouvrir depuis le module et vérifier retour, droits et interactions | Recensé |
| `public/controle.js` → `ecranGroupe` | controle · Selon contexte | `utilisateurs.gerer` | Écran ou fiche | 4 | Ouvrir depuis le module et vérifier retour, droits et interactions | Recensé |
| `public/compta.js` → `ecranImmobilisations` | compta · Selon contexte | `compta.saisir`, `compta.valider` | Écran ou fiche | 4 | Ouvrir depuis le module et vérifier retour, droits et interactions | Recensé |
| `public/compta.js` → `ecranEtatsOfficiels` | compta · Selon contexte | Rôle hérité du parcours | Écran ou fiche | 4 | Ouvrir depuis le module et vérifier retour, droits et interactions | Recensé |
| `public/compta.js` → `ecranDsf` | compta · Selon contexte | `compta.cloturer` | Écran ou fiche | 4 | Ouvrir depuis le module et vérifier retour, droits et interactions | Recensé |

## Vérifications du socle

- Chromium à 360 et 1 280 px avec données fictives. Les deux parcours pilotes, le retour de focus, le lien d’évitement et les thèmes déclarés des pages autonomes de cours et de boutique sont passés.
- PostgreSQL 16 isolé sur le poste et rôle de préparation restreint. La suite complète est passée avec 543 tests dans 78 fichiers. Le contrôle ciblé suivant est passé avec 26 tests, y compris les nouvelles assertions de périmètre de recherche et de filtre des commandes.
- Les pages autonomes et les écrans connectés héritent des styles partagés. La vérification réelle des variantes par module, rôle et format d’impression reste à reporter dans les lignes d’inventaire.
- Les captures initiales des deux tableaux de bord figurent dans `output/aperçus SMARTE/`. Les captures initiales des autres familles restent à constituer.
- Chromium a installé le cache versionné sur un profil neuf et restitué la feuille de styles depuis le cache après coupure simulée du serveur. La recette de vente complète hors connexion reste distincte.

## Vérifications complémentaires

- Les 47 destinations déclarées dans le menu sont présentes dans l’index. Les 12 pages autonomes ont chargé à 360 px avec leurs données fictives ou leur état d’accès indisponible.
- Le parcours formateur a été testé après une erreur de saisie et après validation. La saisie reste en place après l’erreur. Quand la session sort du filtre « Présences à saisir », la recherche reste active et le focus revient au titre de la liste.
- Le parcours GLOMARI a été testé avec deux magasins, un détail devenu indisponible, des changements d’espace rapides et un rechargement de l’onglet. Le statut et le magasin sont rétablis. Les tests serveur couvrent aussi l’isolement et la révocation du rôle.
- Le parcours de caisse avec réponse API simulée a produit un ticket provisoire et conservé la clé initiale de la vente. Après reprise, une seule transmission a été observée. Le même contrôle a réussi lors du passage du cache v13 au v14.
- Les preuves d’impression de recette comprennent un reçu GTA A4, un devis GLOMARI de quatre pages et un ticket. Chromium a vérifié les réglages du ticket à 58 et 80 mm. Les autres variantes imprimables et les logos configurés sur le serveur de recette restent à vérifier.
- Les références visuelles figurent dans le [guide de recette](quickstart.md).
- Sur Fastify avec la base PostgreSQL isolée, Chromium a ouvert toutes les entrées visibles d’un compte multi-entités de recette, soit 28 dans GTA et 41 dans GLOMARI en comptant les modules communs dans chaque espace. Les menus mono-entité du formateur et du commercial ont été vérifiés avec leurs rôles réels. L’ouverture d’un écran ne valide pas ses variantes, ses sous-écrans ou toutes ses actions.
- La suite complète a réussi avec 544 tests dans 78 fichiers après l’ajout des droits d’affichage par espace. Aucune session de recette avec des participants représentatifs n’a été organisée.
- Le même contrôle d’ouverture des 69 destinations a réussi à 360 px, sans débordement du contenu principal. Dans le Service client, le retour de la fiche conserve la recherche, le statut et le focus. Les 24 tests ciblés de relation client, relais Care et recouvrement ont réussi après l’ajout du filtre de branche des tickets.
## Dialogues et sorties imprimables dans le code

Relevé des dialogues natifs et des conteneurs imprimables déclarés dans les scripts chargés par SMARTE. Les variantes paramétrées partagent le scénario de leur écran parent.

| Point d’entrée | Module et espace | Accès | Modèle | Lot | Vérification | État |
| --- | --- | --- | --- | --- | --- | --- |
| `public/fiches.js:10` | `contenuFiche` · Selon parcours | Rôle et accès de l’écran parent | Impression | 4 | Prévisualiser la marque, les mentions et le format | Recensé |
| `public/gestion.js:141` | `ecranDocument` · Selon parcours | Rôle et accès de l’écran parent | Impression | 4 | Prévisualiser la marque, les mentions et le format | Recensé |
| `public/gestion.js:780` | `ecranCommande` · Selon parcours | Rôle et accès de l’écran parent | Impression | 4 | Prévisualiser la marque, les mentions et le format | Recensé |
| `public/caisse.js:215` | `d` · GLOMARI | Rôle et accès de l’écran parent | Dialogue | 3 | Ouvrir, vérifier le clavier et fermer sans perdre le contexte | Recensé |
| `public/caisse.js:543` | `voirTicket` · GLOMARI | Rôle et accès de l’écran parent | Impression | 4 | Prévisualiser la marque, les mentions et le format | Recensé |
| `public/caisse.js:590` | `ecranTicketCaisse` · GLOMARI | Rôle et accès de l’écran parent | Impression | 4 | Prévisualiser la marque, les mentions et le format | Recensé |
| `public/canalenligne.js:55` | `dialogue` · GLOMARI | Rôle et accès de l’écran parent | Dialogue | 3 | Ouvrir, vérifier le clavier et fermer sans perdre le contexte | Recensé |
| `public/academie.js:17` | `voirTitre` · GTA | Rôle et accès de l’écran parent | Impression | 4 | Prévisualiser la marque, les mentions et le format | Recensé |
| `public/academie.js:194` | `ecranEtudiant` · GTA | Rôle et accès de l’écran parent | Impression | 4 | Prévisualiser la marque, les mentions et le format | Recensé |
| `public/modules.js:344` | `voirBulletin` · Selon parcours | Rôle et accès de l’écran parent | Impression | 4 | Prévisualiser la marque, les mentions et le format | Recensé |
| `public/app.js:1062` | `voirRecu` · Selon parcours | Rôle et accès de l’écran parent | Impression | 4 | Prévisualiser la marque, les mentions et le format | Recensé |
| `public/app.js:1159` | `voirCertificat` · Selon parcours | Rôle et accès de l’écran parent | Impression | 4 | Prévisualiser la marque, les mentions et le format | Recensé |

## Formulaires déclarés dans les écrans

Les numéros renvoient aux appels qui rendent un formulaire. Les droits affichés sont les conditions d’interface repérées. Le droit exact et le périmètre se confirment sur l’action serveur de chaque scénario. Pour chaque formulaire de la famille et du lot de son écran, vérifier l’ouverture, l’erreur conservant la saisie et le retour après succès.

| Script | Nombre | Lignes | Droits d’interface repérés |
| --- | ---: | --- | --- |
| `public/academie.js` | 17 | 36, 51, 55, 60, 69, 80, 88, 94, 109, 120, 126, 143, 161, 168, 169, 180, 198 | Écran parent ou validation serveur |
| `public/app.js` | 12 | 726, 754, 836, 855, 892, 908, 935, 951, 961, 1053, 1103, 1145 | Écran parent ou validation serveur |
| `public/assistantcare.js` | 4 | 26, 61, 73, 100 | Écran parent ou validation serveur |
| `public/avis.js` | 1 | 24 | Écran parent ou validation serveur |
| `public/boutique.js` | 1 | 15 | Écran parent ou validation serveur |
| `public/caisse.js` | 12 | 128, 184, 246, 271, 348, 355, 404, 475, 485, 492, 499, 610 | `caisse.superviser` |
| `public/canalenligne.js` | 3 | 102, 136, 166 | `tresorerie.gerer` |
| `public/capture.js` | 1 | 19 | Écran parent ou validation serveur |
| `public/commerce.js` | 19 | 13, 16, 22, 37, 38, 45, 46, 60, 61, 62, 67, 68, 70, 71, 87, 90, 91, 92, 96 | `retours.gerer`, `facturation.administrer`, `facturation.voir` |
| `public/compta.js` | 19 | 32, 45, 62, 76, 98, 111, 170, 176, 181, 200, 221, 244, 248, 252, 253, 264, 265, 269, 318 | `compta.cloturer`, `compta.saisir`, `compta.valider` |
| `public/console.js` | 2 | 8, 17 | Écran parent ou validation serveur |
| `public/controle.js` | 5 | 17, 29, 31, 39, 49 | `compta.cloturer`, `utilisateurs.gerer` |
| `public/cours.js` | 2 | 72, 103 | Écran parent ou validation serveur |
| `public/depotvente.js` | 6 | 35, 45, 54, 67, 76, 86 | Écran parent ou validation serveur |
| `public/documents.js` | 17 | 50, 51, 52, 68, 69, 81, 83, 85, 86, 101, 102, 108, 119, 127, 138, 139, 145 | `rh.gerer` |
| `public/entrepots.js` | 12 | 122, 161, 190, 201, 210, 213, 218, 267, 294, 298, 322, 338 | Écran parent ou validation serveur |
| `public/evaluer.js` | 2 | 34, 47 | Écran parent ou validation serveur |
| `public/evenement.js` | 1 | 18 | Écran parent ou validation serveur |
| `public/evenements.js` | 4 | 8, 17, 19, 28 | Écran parent ou validation serveur |
| `public/fiches.js` | 1 | 66 | Écran parent ou validation serveur |
| `public/fichesvente.js` | 6 | 32, 34, 59, 76, 80, 84 | Écran parent ou validation serveur |
| `public/finitions.js` | 4 | 18, 29, 68, 76 | Écran parent ou validation serveur |
| `public/fiscal.js` | 4 | 15, 18, 20, 22 | `compta.saisir`, `compta.valider`, `utilisateurs.gerer` |
| `public/gestion.js` | 32 | 78, 166, 178, 189, 196, 214, 225, 241, 262, 264, 279, 320, 326, 339, 345, 365, 371, 588, 642, 732, 738, 814, 836, 850, 861, 892, 902, 920, 955, 959, 967, 992 | `facturation.encaisser`, `facturation.administrer`, `stocks.gerer` |
| `public/gta.js` | 8 | 29, 66, 96, 126, 153, 174, 190, 204 | `mentorat.gerer`, `foundation.gerer` |
| `public/logistique.js` | 11 | 10, 12, 13, 14, 15, 16, 17, 18, 20, 21, 28 | `catalogue.gerer`, `achats.voir` |
| `public/mall.js` | 9 | 12, 13, 17, 26, 93, 94, 95, 96, 107 | `catalogue.gerer` |
| `public/messages.js` | 4 | 18, 39, 56, 66 | Écran parent ou validation serveur |
| `public/modules.js` | 18 | 19, 27, 64, 79, 119, 138, 161, 198, 208, 217, 221, 227, 232, 278, 293, 307, 311, 354 | `entites.gerer` |
| `public/okr.js` | 10 | 81, 116, 133, 176, 199, 204, 212, 217, 219, 223 | Écran parent ou validation serveur |
| `public/pedagogie.js` | 10 | 10, 12, 13, 14, 21, 22, 23, 35, 36, 37 | Écran parent ou validation serveur |
| `public/pilotage.js` | 15 | 17, 25, 40, 41, 43, 59, 61, 62, 66, 76, 80, 82, 90, 96, 101 | `transport.livrer` |
| `public/postuler.js` | 1 | 14 | Écran parent ou validation serveur |
| `public/precommandes.js` | 3 | 44, 107, 128 | Écran parent ou validation serveur |
| `public/quotidien.js` | 19 | 26, 99, 110, 116, 136, 158, 209, 224, 227, 236, 242, 284, 287, 301, 320, 351, 358, 360, 364 | Écran parent ou validation serveur |
| `public/rapports.js` | 2 | 36, 61 | Écran parent ou validation serveur |
| `public/recouvrement.js` | 12 | 26, 33, 39, 41, 49, 64, 76, 78, 138, 141, 143, 151 | Écran parent ou validation serveur |
| `public/relation.js` | 9 | 61, 106, 132, 158, 162, 231, 264, 269, 297 | `crm.gerer`, `support.gerer` |
| `public/scolarite.js` | 7 | 24, 27, 28, 36, 37, 53, 59 | `universite.notes` |
| `public/tableau.js` | 2 | 173, 301 | Écran parent ou validation serveur |
| `public/tour.js` | 9 | 10, 13, 22, 38, 45, 46, 52, 54, 60 | `pilotage.gerer`, `support.gerer` |
| `public/tresorerie.js` | 6 | 30, 41, 46, 69, 74, 82 | Écran parent ou validation serveur |

## Points d’entrée délégués et vérification de couverture

Ces entrées complètent le relevé des vues. La validation métier reste associée au scénario de leur lot.

| Point d’entrée | Lot | Rôle ou modèle | Vérification |
| --- | --- | --- | --- |
| `public/app.js` → `ecranAccueil` | 4 | Accès et état transmis au parcours appelé | Vérifier depuis la destination parente |

Contrôle statique réalisé sur les 47 destinations nommées, les 13 pages HTML et les 36 scripts chargés par le cadre. Tous les scripts référencés sont présents dans le manifeste hors connexion.

## Vérification des derniers lots

Les écrans connectés reprennent la grille, les cartes, les formulaires, les statuts et les styles d’impression du cadre commun. Les pages autonomes déclarent leur contexte sans changer les adresses ni les paramètres des liens. La boutique de cours et l’avis de formation prennent le thème GTA. L’avis produit, le suivi du colis et le portail grossiste prennent le thème GLOMARI.

| Famille | Preuve observée |
| --- | --- |
| GTA | 28 entrées visibles ouvertes avec le compte de recette multi-entités. Six entrées ouvertes avec le rôle Formateur et six avec le rôle Scolarité. Le cours, le certificat, la boutique de cours et l’avis de formation ont rendu leur contenu de recette à 360 px. |
| GLOMARI | 41 entrées visibles ouvertes avec le compte multi-entités. Onze entrées ouvertes avec le rôle Commercial et douze avec le rôle Magasinier. Le lien de suivi, le portail et l’avis produit ont rendu leur contenu de recette à 360 px. Après un échec d’envoi de l’avis, le commentaire saisi est resté en place. |
| Transversal | Sept entrées ouvertes avec le rôle Comptable. Dans la facturation, l’onglet Devis et le focus sont revenus après fermeture du document. Le choix d’onglet a aussi été retrouvé après navigation vers un autre module. Le formulaire public et la console se sont rendus sur mobile. |
| Couverture technique | TypeScript, analyse syntaxique JavaScript, 544 tests PostgreSQL et vérification de toutes les destinations et références au cache. |

Les tests navigateur sur serveur ont utilisé des comptes de recette et des rôles réels. Les contrôles de contenu autonome et de restauration de la facturation ont utilisé des réponses API simulées. Les parcours de détail à vérifier au-delà de ces cas restent visibles dans l’index. Le seuil SC-002 exige au moins cinq personnes représentatives par parcours.

## Vérifications du 25 novembre 2026

- La vérification TypeScript et les 544 tests Vitest répartis sur 78 fichiers ont réussi sur PostgreSQL 16 avec le rôle de préparation restreint.
- Avec le rôle Formateur, l’inscription, l’encaissement et la délivrance de certificat sont masqués. Après l’appel, la session enregistrée sort du filtre « Présences à saisir ». Le serveur refuse aussi l’encaissement direct avec ce rôle.
- À 1 280 px, les rôles Gestion des formations et Administrateur voient les actions d’inscription, d’encaissement et de délivrance. L’annulation du reçu reste visible pour l’Administrateur.
- Chromium a vérifié que le service worker installe le script des sessions corrigé dans le cache v16.
