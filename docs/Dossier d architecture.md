# Dossier d'architecture de Smarte Solutions

Version 1.0, 3 novembre 2026. À relire et valider par le responsable technique de SGC.

## Décision principale

L'ERP est un **monolithe modulaire multi locataire** : une seule application, découpée en modules activables, avec une seule base PostgreSQL dont les données sont cloisonnées par client. Cette forme couvre les sections 4 et 23 du cahier sans imposer dès le départ le coût d'exploitation de dizaines de services.

Un module pourra devenir un service séparé plus tard si la charge le justifie. Les échanges par événements préparent cette possibilité.

## Choix techniques

| Sujet | Choix | Raison | Solution écartée |
| --- | --- | --- | --- |
| Point de départ | Développement neuf | Décision de SGC du 2 novembre 2026 | Base open source comme Odoo ou ERPNext, permise par la section 4 du cahier |
| Langage | TypeScript sur Node.js 22 | Même langage pour le serveur, le web et le mobile | Plusieurs langages à maintenir |
| API | Fastify, REST | Léger, avec validation intégrée | Cadre plus lourd |
| Base de données | PostgreSQL 16 | Transactions fiables pour la comptabilité, cloisonnement natif | Base sans transactions complètes |
| Isolation SaaS | Une base partagée et le cloisonnement par ligne (RLS) | Une seule installation pour tous les clients, comme le demande la section 4 | Une base par client, plus lourde à mettre à jour |
| Web | React, en application installable (PWA), proposé | Utilisable sur téléphone avant les applications | Non encore construit |
| Mobile | React Native, proposé | Une base de code Android et iOS, en TypeScript | Flutter, qui ajoute un langage |
| Hébergement | À décider | Dépend du budget et des tests de latence depuis Douala | |

## Isolation des clients

C'est la décision la plus difficile à corriger plus tard. Elle repose sur quatre protections :

1. **Dans la base :** chaque table de client est cloisonnée par PostgreSQL. Sans organisation définie, une requête ne renvoie aucune ligne.
2. **Compte limité :** l'application utilise `erp_app`, sans droit de contourner le cloisonnement, de créer des tables ou de modifier le journal.
3. **Contexte par transaction :** l'organisation disparaît à la fin de chaque transaction et ne peut pas passer à la requête suivante.
4. **Clés composites :** PostgreSQL ne filtre pas les clés étrangères par cloisonnement. Les clés incluent donc `organisation_id`, ce qui bloque tout lien vers les données d'un autre client.

## Droits et séparation des branches

Décision de SGC du 2 novembre 2026 : GTA fait uniquement de la formation et GLOMARI gère les stocks. Les deux branches sont distinctes dans le système.

- **Domaine :** chaque entité a un domaine, hérité de son parent. GTA ne peut pas activer les stocks, et GLOMARI ne peut pas activer les formations.
- **Droit effectif :** un droit sur les stocks ou les formations n'a d'effet que si le module est actif sur l'entité. Le rôle seul ne suffit pas.
- **Catalogue :** un produit appartient à une entité. Il n'est visible et utilisable que dans cette entité, ses descendantes et par ses ancêtres.
- **Super administrateur :** rôle unique sur toute l'organisation. Il voit tout et il est le seul à donner ou retirer les accès. Il en reste toujours au moins un actif.
- **Administrateur d'entité :** il gère son entité et ses descendantes, sans pouvoir créer de comptes.

- **Fiches clients :** chaque fiche appartient à une branche. Seul un accès sur toute l'organisation, comme celui du super administrateur, voit les deux. Une personne cliente des deux branches a deux fiches distinctes, et les doublons se détectent dans chaque branche.
- **Facturation et CRM :** ils restent disponibles dans les deux branches, chacune avec ses propres documents.

## Journal d'audit

Les modifications sont enregistrées dans la même transaction, avec l'auteur, l'avant et l'après. Chaque ligne contient l'empreinte de la précédente, ce qui rend une modification détectable.

**Limite connue :** la section 24 demande un journal infalsifiable. Une personne ayant tous les droits sur la base pourrait recalculer toute la chaîne. Il faudra donc copier régulièrement la dernière empreinte hors de la base, sur un stockage en écriture unique. L'écriture est aussi sérialisée par organisation, ce qui devra être mesuré aux volumes de la section 4.

## Stock automatique

Décision de SGC du 2 novembre 2026 : le stock se met à jour sans saisie à chaque événement confirmé. Une vente sort à l'émission de la facture, un achat entre à la réception confirmée, et un transfert sort puis entre à ses deux confirmations. Le réajustement manuel reste réservé aux écarts d'inventaire, à confirmer par un responsable.

Les utilisateurs autorisés créent autant de magasins, de points de vente et d'entrepôts que nécessaire sous GLOMARI. Chaque lieu a son stock et reçoit automatiquement ses modules.

## Modules et événements

Le socle est toujours actif. Les autres modules s'activent par entité, et les désactiver ne supprime pas leurs données. Les faits importants sont écrits dans une table d'événements, dans la même transaction que l'opération. Le processus qui les distribue reste à construire.

## État de la première tranche

| Exigence | État |
| --- | --- |
| Organisations, entités et structure SGC | Construit |
| Connexion, sessions, verrouillage après 5 échecs | Construit |
| Rôles, droits par entité, délégation avec expiration | Construit, sans écran ni API de délégation |
| Fiche tiers unique et détection des doublons | Construit, sans fusion : les documents émis sont figés sur leur fiche |
| Activation des modules par entité | Construit |
| Journal d'audit chaîné | Construit, avec la limite ci-dessus |
| Authentification à deux facteurs | Construit côté serveur, sans écran d'activation |
| SSO | À faire |
| Limitation des tentatives par adresse IP | Construit |
| Formations : programmes, sessions, inscriptions, échéanciers | Construit |
| Encaissements saisis à la main, reçus, annulation motivée | Construit, sans passerelle Mobile Money ni écriture comptable |
| Présences et certificats à QR code vérifiables | Construit |
| Écrans de l'essai | Provisoires, en JavaScript simple, à remplacer par React |
| Fiche client modifiable et historique | Construit, sans fusion de doublons |
| Suivi commercial de base : opportunités, échanges, conversion | Construit, avec des étapes fixes et sans campagnes marketing |
| Service client : tickets, délais, échanges | Construit, sans envoi automatique au client |
| Tâches et échéances | Construit, sans rappel automatique |
| Avis de formation par liens personnels, résultats, modération | Construit, limité aux formations et sans envoi automatique |
| Tableau de bord : 21 indicateurs de formation, vente, service client et tâches | Construit, sans objectifs, alertes ni évaluation individuelle |
| Mentorat : jumelage, séances, progrès, comptes rendus confidentiels | Construit |
| GTA Foundation : projets, dons, aides, rapport | Construit, sans reçu fiscal ni comptabilité |
| Catalogue unique, taxe libre facultative | Construit, sans variantes ni grilles de prix |
| Devis, factures, avoirs, règlements, créances | Construit, sans écriture comptable, envoi automatique, relances ni facturation électronique certifiée |
| Livraison et expédition : frais, transporteur, suivi, preuve | Construit, saisie manuelle, sans tournées ni transporteur connecté |
| Achats : bons de commande, approbation, réceptions partielles, suggestions | Construit, sans demandes de prix, factures fournisseurs ni coûts d'importation |
| Caisse : sessions, ventes, paiements mixtes, rendu, annulation, clôture | Construit, avec vente hors connexion sur un onglet déjà ouvert, douchette USB, caméra selon le navigateur, ticket 58 ou 80 mm par le pilote d'impression, et fidélité paramétrable. À essayer sur le matériel réel |
| Apprentissage en ligne : cours, leçons, quiz, progression, accès par lien | Construit, avec vidéos hébergées sans conversion, direct par lien de réunion externe, certificat automatique vérifiable et studio IA qui écrit texte et quiz en brouillon. Le studio exige une clé d'API ; ni audio, ni vidéo, ni diapositives générés |
| RH : employés, contrats, congés, soldes, pointage saisi par les RH | Construit, sans demande par l'employé ni badgeuse |
| Paie : salaires séparés, rubriques et barèmes paramétrables, bulletins figés | Construit sans aucun taux légal préenregistré. Aucun bulletin ne se valide sans accord enregistré d'un expert. Déclarations et virements à faire |
| Stocks : transferts confirmés, réajustements validés, alertes, coût moyen | Construit, sans lots, codes-barres ni retour automatique sur avoir |
| Espaces GLOMARI et GTA dans la navigation | Construit. Facturation et suivi commercial filtrés par espace. Les autres onglets communs montrent encore les deux branches au super administrateur |
| SMARTE Coaching : accompagnements, séances, notes chiffrées réservées au coach, certification par niveaux, licences, redevances en cascade | Construit, sans réservation en ligne, rappels, bibliothèque, tests d'évaluation, événements ni paiement des redevances |
| IP2EL University : filières, UE, candidatures, inscriptions, notes, délibérations, relevés, diplômes à QR code | Construit, sans candidature en ligne, pièces jointes, frais et bourses, emplois du temps, présences, enseignants affectés aux UE, alumni ni formats de tutelle |
| Trésorerie : portefeuilles espèces, Orange Money, MTN MoMo, banque et autres, transferts avec frais, encaissements automatiques | Construit, avec saisie manuelle des dépenses, sans connexion aux opérateurs ou banques, rapprochement, prévision ni écriture comptable. Dons et paie non reliés |
| Comptabilité SYSCOHADA par branche : plan de départ, journaux, brouillons automatiques, validation irréversible, contre-passation, balance, grand livre, clôtures, à-nouveaux, contrôles | Construit, à faire valider par l'expert. Sans modèle officiel des états, DSF, immobilisations, factures fournisseurs, écritures de stock et de paie, rapprochement ni consolidation |
| Factures fournisseurs : saisie, contrôle commande et réception, échéancier, paiement depuis un portefeuille | Construit, une ligne à l'écran, sans lecture automatique, lots de paiement ni notes de frais |
| Immobilisations : registre, amortissement linéaire au mois, cessions, écritures | Construit, sans mode dégressif, composants ni réévaluation |
| États financiers au format SYSCOHADA système normal | Construits, rattachement des comptes à valider, sans notes annexes ni système minimal de trésorerie |
| Préparation de la DSF : résultat fiscal, contrôles, export des chiffres | Construite. Le dépôt reste manuel, dans le modèle Excel de la DGI, ou par son API non raccordée |
| Pilotage : objectifs en cascade, projets, temps, budget, registre des risques, non-conformités, incidents et décisions | Construit, sans diagramme de planning, modèles de projets ni documents joints |
| Transport : colis, suivi public, zones, tournées, code de confirmation, livraison contre paiement, remise de caisse, flotte | Construit, sans optimisation d'itinéraires, géolocalisation, photo, transporteurs connectés ni notifications automatiques. Retours sans remise en stock automatique |
| Affiliation : codes, commissions sur facture, validation après retour, paiement depuis un portefeuille | Construit, attribution manuelle, sans liens de suivi, tableau de bord de l'affilié ni taux par produit |
| GLOMARI Care : dossiers, garantie, retour autorisé, décision, remise en stock, remboursement, statistiques | Construit, sans ramassage, pièces détachées, écritures de provision ni refacturation émise |
| Marketing : campagnes et retour sur investissement | Construit, coûts et rattachements saisis, sans envoi ni automatisation |
| Avis du groupe : liens vérifiés, modération, réponse, ticket sur note basse | Construit pour produits, livraison, magasin et SAV, sans publication sur un site ni envoi automatique |
| Prix par palier, comptes professionnels, plafond de crédit | Construit, palier appliqué à toute la ligne, sans tranches cumulées, grilles par client ni portail grossiste |
| Marketplace et franchises : vendeurs, commissions, reversements, litiges, redevances | Construit, commandes saisies, sans raccordement à la plateforme, Mall ni points relais. Pas d'écriture comptable automatique |
| Évaluation individuelle : indicateurs par poste, score, contestation | Construit avec six indicateurs, sans KPI personnalisables, alertes ni évaluation à 360 degrés |
| Description de l'API | `/api/openapi.json` produit depuis les routes, sans clés d'API, webhooks ni bac à sable |
| Application installable | Fichier manifeste et cache. Les applications Android et iOS restent à faire |
| Mall : locaux, baux, loyers facturés, occupation, impayés | Construit, sans maintenance, accès ni révision de loyer. Dépôt de garantie noté, non comptabilisé |
| Supermarché : rayons, lots, péremption, sortie du lot le plus proche, pertes, étiquettes | Construit, sans balance, promotions ni inventaire tournant. Les lots suivent le stock par lieu |
| Points relais : dépôt, retrait par code, commission, paiement | Construit, sans écran propre au relais |
| Portail grossiste par lien secret : catalogue, paliers, commande, encours, factures | Construit, sans compte ni mot de passe, grilles par client, import ni commande récurrente |
| Fidélité | Points séparés entre GLOMARI et GTA, décision de SGC du 3 novembre 2026 |
| Indicateurs suivis : cibles, seuils, comparaison, alertes, recommandation à décider | Construit avec huit indicateurs de la bibliothèque, calculés à l'ouverture du tableau. Sans formule libre, envoi d'alertes ni cascade automatique |
| Clés d'API et webhooks signés | Construit : droits du compte lié, quota, adresses internes refusées. Le quota vit en mémoire. Envoi au moins une fois, à dédoublonner par l'identifiant d'événement ; après un redémarrage, l'envoi automatique reprend à la première requête de l'organisation. Sans bac à sable ni versions |
| Budgets, cumul du groupe, rapprochement, prévision de trésorerie | Construit. Éliminations entre branches saisies par le comptable, sans repérage automatique : ce n'est pas une consolidation certifiée. Rapprochement sans import bancaire |
| Documentation de l'API | Description OpenAPI publiée. Sans interface interactive |
| Recouvrement : âge des créances, relances graduées bilingues, plans, blocages, douteuses et pertes | Construit, factures et tranches de formation. Relances préparées et confirmées par une personne : aucun envoi automatique. Provision et perte en brouillon sur 659, 491, 651 et 759, taxe à examiner par l'expert |
| Factures récurrentes mensuelles | Construit : brouillons préparés à la demande, à émettre. Sans génération planifiée |
| Formulaires publics, score de prospect, segments | Construit. Score à règles fixes, sans IA. Sans pipelines configurables, enrichissement, export ni envoi aux segments |
| Recherche globale, notifications dans l'application, double authentification à l'écran, délégations datées | Construit. Notifications calculées à l'ouverture, sans courriel ni SMS |
| Documents : versions, catégories, type vérifié, archivage sans effacement | Construit, 20 Mo par fichier, sans modèles, signature électronique ni archivage à valeur légale |
| Agenda et réservation de salles, véhicules, équipements, formateurs | Construit, chevauchements refusés, sans vue calendrier graphique ni rappels |
| Portail employé : pointage, congés, bulletins, notes de frais avec justificatif | Construit. Le pointage n'a ni QR code, ni géolocalisation : il atteste seulement le compte connecté |
| Recrutement : offres publiques, candidatures, entretiens, embauche | Construit, CV par lien, sans intégration ni placement GLOMARI |
| Promotions par produit et par dates | Construit en facture et en caisse, sans cumul, codes promo, bons d'achat ni application au portail grossiste. Une vente hors connexion garde le prix connu à l'ouverture de l'écran |
| Tâches planifiées | Chaque heure dans le serveur : factures récurrentes en brouillon, alertes d'indicateurs. Webhooks chaque minute, reprise seule après redémarrage. Une seule instance du serveur à ce stade |
| Fusion de fiches clients | Construit. Écritures validées laissées sur l'ancienne fiche, refus si un même rôle existe des deux côtés |
| Bornes de pointage | Code à 6 chiffres et QR changeant chaque minute. Une photo envoyée dans la minute reste utilisable |
| Approbation d'un document | Trace interne avec empreinte, pas une signature électronique qualifiée |
| Paie : état préparatoire, moyens de paiement chiffrés, versements, brouillons comptables | Construit. Virements exécutés hors du logiciel ; retenues globales au 431, à ventiler. Pas de formulaire officiel CNPS ou DGI |
| Scolarité IP2EL : frais, bourses, paiements, accès aux examens, blocage du diplôme | Construit. Sans remboursement à l'écran |
| Emploi du temps et appel | Construit, conflits de salle, d'enseignant et de promotion refusés |
| Réservation en ligne des séances de coaching par lien personnel | Construit, annulation jusqu'à 24 heures avant, sans paiement en ligne ni rappel envoyé |
| Événements : page publique, capacité, billet à QR, encaissement, contrôle à l'entrée, bilan | Construit, paiement au guichet, sans remboursement ni envoi du billet |
| Variantes de produits | Chaque variante est un produit à part, avec prix, code-barres et stock propres |
| Bibliothèque SMARTE par niveau | Liens visibles sur la page du client selon son niveau certifié. Fichiers hébergés ailleurs, tests non notés |
| Statistiques IP2EL et diplômés | Effectifs, réussite, recettes, liste des diplômés. Sans abandon, origine ni format de tutelle |
| Scolarité dans le recouvrement | Âge et relances. Blocage d'examen et de diplôme gérés par la scolarité |
| Fiscalité : calendrier avec alertes, DSF corrigeable avec justification, versions et verrouillage après dépôt | Construit. Échéances à confirmer par l'expert. Sans clic jusqu'à la pièce ni fichier de dépôt officiel |
| Modèles d'écritures, lots de paiement fournisseurs, balance âgée fournisseurs, inventaire des immobilisations | Construit |
| Refacturation interne | Brouillons des deux côtés au compte de liaison 185, retirée du chiffre d'affaires du cumul. À valider par l'expert |
| Formations : liste d'attente, codes promotionnels, coûts et rentabilité, tests et remarques, demandes d'entreprises, feuille d'émargement et convocations imprimables | Construit, sans inscription publique directe ni formateurs externes payés à la session |
| Apprentissage : banque de questions, devoirs, questions au formateur, parcours, points, apprenants inactifs, boutique publique | Construit. Achat par demande, accès ouvert après paiement. Sans SCORM, surveillance, forum à plusieurs fils, enregistrement dans le navigateur ni filigrane |
| Prix négociés par client, quantité minimale, multiples, conditionnements, import du catalogue | Construit. Tranches cumulées, grilles par groupe, ville ou canal à faire |
| Inventaires à validation séparée, réservations de stock, numéros de série, retours fournisseurs | Construit. Réservation contrôlée à sa création, sans blocage de la vente. Numéros de série rattachés à la main |
| Demandes de prix avec motif si l'offre n'est pas la moins chère, dossiers d'importation et coefficient de coût de revient | Construit. Coefficient affiché, sans mise à jour automatique du coût moyen ni suivi de conteneur connecté |
| Règles si, alors | Événement, condition simple, création de tâche, journal, simulation sur 30 jours. Sans éditeur visuel ni autres actions |
| Tour de contrôle, points à vérifier, analyse ABC et produits dormants | Construit. Marge calculée au coût moyen actuel. Sans carte du réseau, salle de crise ni constructeur de rapports |
| Assistant | Quatre questions préparées, selon les droits. Pas un modèle de langage |
| Contrats et échéances, maintenance, audits, annonces, aide | Construit, sans messagerie d'équipe ni vidéos d'aide |
| Données personnelles | Export de la fiche et anonymisation motivée, factures conservées avec le nom imprimé |
| Thème sombre et taille du texte | Construit sur ce navigateur |
| Grilles par catégorie et période, tranches cumulées | Construit en facture et au portail. En caisse, palier et promotion seulement |
| Devises | Taux datés et conversion pour information. Comptabilité et factures en FCFA |
| Emplacements et préparation par scan | Construit. Sans application mobile dédiée |
| Rapports à sources fermées, comparaison, prévision de ventes | Construit. Prévision par moyenne et pente, à lire comme une estimation |
| Console de plateforme, offres, limite d'utilisateurs, suspension | Construit, protégée par une clé. Facturation de l'abonnement manuelle, sans sous-domaine propre ni marque blanche |
| Écrans internes en anglais | Navigation et libellés fréquents seulement. Le reste s'affiche en français |
| Séparation des tâches | Construit pour écritures, commandes, factures fournisseurs et pertes, réglable. Droits par champ à faire |

| Français et anglais | À faire |
| Écrans définitifs et applications mobiles | À faire |

## Ordre de construction proposé

1. Essai réel sur la session E-commerce de Douala, en parallèle du suivi actuel.
2. Corrections issues de l'essai, modification des tiers, écran de double authentification.
3. Facturation, puis Mobile Money réel.
4. Comptabilité SYSCOHADA et écritures automatiques, validées par l'expert comptable.

## Règles de formation

Règles confirmées par SGC le 2 novembre 2026, modifiables par un administrateur :

- Présence minimale de 75 % pour le certificat, modifiable par programme.
- Certificat possible seulement après la fin de la session, avec un solde réglé. Un administrateur peut faire une exception, avec un motif conservé.
- Le tarif d'un programme vaut pour les prochains inscrits. L'échéancier d'un inscrit se modifie individuellement, avec un motif, sans passer sous ce qui est déjà payé.
- Pas de trop perçu : un paiement ne peut pas dépasser le reste dû.
- Un remboursement se traite par l'annulation motivée du paiement, sans suivi distinct de la sortie d'argent pour l'instant.

## Points à vérifier

- L'anonymat des avis tient dans l'application. Une personne qui accède directement à la base pourrait encore rapprocher les jours de réponse et les avis, surtout dans une petite session.
- Dans les écrans de mentorat et de la Foundation, un nom saisi rejoint la fiche portant exactement ce nom. Une recherche avec choix devra remplacer ce fonctionnement provisoire pour éviter les confusions d'homonymes.
- Les conditions légales d'un reçu fiscal de don restent à vérifier avec l'expert comptable.

## Conformité de la facturation

- Par décision de SGC du 2 novembre 2026, aucune TVA n'est ajoutée automatiquement : le pourcentage est libre et facultatif, par ligne et sur les frais de livraison. La personne qui facture répond donc du taux saisi, à faire valider par l'expert-comptable.
- Le Cameroun met en place une [facturation électronique à partir de la loi de finances 2026](https://edicomgroup.com/fr/blog/facturation-electronique-obligatoire-au-cameroun), avec une transmission à l'administration. Ses exigences techniques ne sont pas intégrées et restent à vérifier auprès de la DGI avant un usage légal des factures.
- Les paiements de formation (module Formations) et les factures (module Facturation) sont encore séparés.

## Caisse hors connexion

Un service worker garde seulement les fichiers de l'application, jamais les réponses de l'API. Les ventes en attente restent dans le navigateur, avec une clé créée par l'appareil : un envoi répété ne compte qu'une fois. Une vente refusée au retour d'internet reste visible jusqu'à ce qu'une personne la traite.

Limites assumées : le jeton reste lié à l'onglet, donc un navigateur fermé pendant une coupure impose d'attendre internet pour se reconnecter. Une vente hors connexion peut rendre le stock négatif, car elle a déjà eu lieu ; elle est signalée pour vérification. Vider les données du navigateur efface les ventes non envoyées.

## Paie

Les salaires et bulletins n'ont pas le déclencheur d'audit détaillé, pour qu'aucun montant n'entre dans le journal : seuls l'acte, l'auteur et le bulletin y figurent. Le droit `rh.paie` est distinct de `rh.gerer`. La validation de l'expert s'enregistre avec `entites.gerer`, et toute modification de rubrique l'efface.

## Médias et IA

Les vidéos sont dans `ERP_DOSSIER_MEDIAS`, à inclure dans les sauvegardes, et ne passent pas par la base. Le lien d'un apprenant donne accès à la vidéo : il peut être partagé, comme tout lien personnel. Le studio appelle l'API Claude avec `ERP_IA_CLE` et `ERP_IA_MODELE`, et se remplace par une autre fonction de génération. Toute réponse est revalidée, puis enregistrée dans un cours non publié.

## Comptabilité

Tenue par branche, en FCFA et en français. Sources : Acte uniforme de 2017 et Code général des impôts du Cameroun, édition 2026.

- Art. 15 à 17 et 22 : les opérations sont enregistrées une à une, datées et numérotées. Le numéro est attribué à la validation, sans trou, par branche, journal et année.
- Art. 20 et 22 : une écriture validée est bloquée par un déclencheur en base, et se corrige par une écriture inverse.
- Art. 22 : une pièce tardive d'une période close est datée dans la période en cours, et la mention de sa date d'origine est conservée. La clôture définitive ne se rouvre pas.
- Art. 24 : les écritures validées ne se suppriment jamais. La purge après dix ans n'est pas prévue. La conservation des pièces justificatives reste à organiser.
- CGI art. 8 bis : les charges de 100 000 FCFA ou plus réglées en espèces sont signalées.
- Mobile Money au compte 552, repris du plan SYSCOHADA révisé. Le compte 585 sert aux virements entre portefeuilles.

Choix à trancher par l'expert : les reçus de formation sont des produits à l'encaissement, sans étalement ni TVA ; les points de fidélité passent au compte 658 ; deux portefeuilles de même type partagent le même compte.

## Décisions à valider

- Les rubriques de paie, les taux et le rythme d'acquisition des congés, par l'expert comptable.
- Le coût de l'API d'IA et celui du stockage des vidéos, selon le volume réel.

- La pile technique proposée, par le responsable technique de SGC.
- Le report des applications mobiles après le premier essai réel, accepté par SGC le 2 novembre 2026. Le cahier les plaçait en phase 1.
- L'hébergeur et sa région.
- Le fournisseur de paiement Mobile Money.
