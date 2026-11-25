# Tâches de la refonte UI/UX de SMARTE

**Entrées** — [Spécification](spec.md), [plan](plan.md), [recherche](research.md), [modèle d’état](data-model.md), [contrat d’interface](contracts/interface.md), [recette](quickstart.md).

**Format** — `Txxx` indique l’ordre de référence. `[P]` indique une tâche qui peut être menée en parallèle après ses prérequis. `[USx]` renvoie au scénario de la spécification. Les chemins partent de la racine du clone.

## Lot 0 · Inventaire et référence

- [x] T001 Recenser les destinations, sous-écrans, dialogues, formulaires et variantes d’accès depuis `public/app.js`, les scripts chargés par `public/index.html` et les routes statiques de `src/serveur.ts`. Créer `specs/008-refonte-interface-smarte/inventaire.md` selon `data-model.md` (`Écran inventorié.Point d’entrée`, `Écran inventorié.module`, `Écran inventorié.espace`, `Écran inventorié.rôles`, `Écran inventorié.modèle d’écran`, `Écran inventorié.lot`, `Écran inventorié.scénario`, `Écran inventorié.état de validation`).
- [x] T002 [P] Capturer les accueils, listes, formulaires, caisse, sorties imprimables et pages autonomes actuels avec des données fictives. Consigner les références de capture et les comptes utilisés dans `specs/008-refonte-interface-smarte/quickstart.md`.
- [x] T003 Réconcilier `specs/008-refonte-interface-smarte/inventaire.md` avec les pages HTML autonomes, les liens publics générés par le serveur et les écrans accessibles depuis une fiche. Vérifier que chaque entrée a un lot et un scénario avant la migration.

## Lot 1 · Fondations partagées

- [x] T004 [P] Ajouter dans `public/style.css` les variables communes et les palettes GTA/GLOMARI, la grille, les contours de focus, les seuils responsives et les règles de mouvement réduit. Appliquer des transitions de 150 à 220 ms aux menus, panneaux et changements d’écran. Une nouvelle action peut interrompre la transition et reste disponible immédiatement. Vérifier les contrastes et la compatibilité des modes clair, sombre et impression.
- [x] T005 [P] Adapter `public/finitions.js` et `public/tableau.js` pour résoudre nom, logo, palette et repli selon `data-model.md` (`Espace.Clé GTA ou GLOMARI`, `Espace.nom`, `Espace.logo`, `Espace.thème`). Utiliser les ressources de marque disponibles et conserver le repli branche vers groupe pour les documents.
- [x] T006 Étendre les composants existants de `public/app.js`, `public/entrepots.js` et `public/style.css` pour partager en-têtes, actions, tableaux, statuts, messages et états de formulaire. Préserver les valeurs après erreur et rendre l’enregistrement perceptible sans déclencher de double envoi.
- [x] T007 Intégrer au besoin les nouveaux actifs locaux à `public/index.html` et `public/sw.js`. Versionner ensemble le cadre et ses actifs nécessaires hors ligne. Vérifier le chargement existant, avec et sans cache préexistant.

### US1 · Se repérer et changer d’espace

**Vérification indépendante** — Avec un compte multi-entités, ouvrir un module de chaque espace et retrouver chacun au retour. Avec un compte GTA seul, vérifier le menu, la recherche et un accès direct. Répéter au clavier et sur mobile.

- [x] T008 [US1] Regrouper dans `public/app.js` les destinations existantes par métier, avec menu actif, visibilité selon le rôle et repli vers l’accueil autorisé. Vérifier la protection serveur des accès directs, des lectures de fiches et des actions du lot 1 par rôle et entité, y compris après révocation. Appliquer `data-model.md` (`Destination.Clé stable`, `Destination.groupe`, `Destination.titre`, `Destination.écran`, `Destination.condition d’accès` et `Espace.destinations autorisées`).
- [x] T009 [US1] Dans `public/app.js`, distinguer le choix GTA/GLOMARI du choix de lieu, mémoriser le contexte par compte, organisation et espace pendant la session, le revalider à la restauration et l’effacer à la déconnexion. Préserver le garde-fou contre les réponses retardées et traiter la sortie d’une saisie modifiée. Appliquer `data-model.md` (`Contexte de navigation.Destination`, `Contexte de navigation.identifiant de lieu`, `Contexte de navigation.recherche`, `Contexte de navigation.filtres`, `Contexte de navigation.tri`, `Contexte de navigation.page`, `Contexte de navigation.repère de retour`).
- [x] T010 [US1] Vérifier les sources de `GET /recherche` dans `src/socle.ts` et adapter le périmètre côté serveur si nécessaire. Relier `public/app.js` à une recherche limitée aux droits et à l’espace actif, avec résultats, chargement, erreur et relance.
- [x] T011 [US1] Adapter `public/app.js` et `public/style.css` pour le menu mobile, la fermeture après choix et le focus sur le titre. Vérifier la navigation au clavier, le mouvement réduit et les changements rapides d’espace selon `specs/008-refonte-interface-smarte/quickstart.md`.

### US2 · Agir depuis l’accueil GTA

**Vérification indépendante** — Depuis les présences à saisir, ouvrir une session, enregistrer l’appel et retrouver les filtres, le tri et la position de liste.

- [x] T012 [US2] Dans `public/tableau.js` et `public/app.js`, mettre en avant les sessions, inscriptions et présences selon le rôle. Relier les indicateurs aux listes réelles dans `public/app.js` et `public/scolarite.js` avec le périmètre et les filtres annoncés.
- [x] T013 [US2] Adapter dans `public/app.js` le parcours liste de sessions, détail et appel. Afficher le résultat d’enregistrement et restaurer le contexte au retour selon `data-model.md` (`État de fiche.Destination parente`, `État de fiche.référence de fiche`, `État de fiche.référence du déclencheur`).
- [x] T014 [US2] Dérouler le scénario de `specs/008-refonte-interface-smarte/quickstart.md` avec un formateur, y compris une session qui sort du filtre après validation. Vérifier le repère de retour et l’état après erreur.

### US3 · Préparer une commande GLOMARI

**Vérification indépendante** — Sélectionner un magasin, ouvrir une commande à préparer, fermer sa fiche et retrouver le magasin, les filtres et la position.

- [x] T015 [P] [US3] Identifier dans `public/canalenligne.js` et `src/canalenligne.ts` les données disponibles pour les commandes et leurs lieux. Adapter si nécessaire la lecture filtrée avec contrôle serveur par lieu et droits, en conservant les appels existants.
- [x] T016 [US3] Dans `public/tableau.js` et `public/canalenligne.js`, mettre en avant les commandes, stocks et autres indicateurs métier disponibles. Relier les commandes à préparer à la liste filtrée et afficher le magasin sur la liste et la fiche.
- [x] T017 [US3] Ouvrir la fiche courte depuis `public/canalenligne.js` avec un panneau sur ordinateur et une vue pleine largeur sur mobile. Maintenir le focus dans le panneau modal avec Tab et Maj+Tab. Gérer Échap, Retour et la restauration du focus selon `specs/008-refonte-interface-smarte/contracts/interface.md` et `data-model.md` (`État de fiche.Destination parente`, `État de fiche.référence de fiche`, `État de fiche.référence du déclencheur`).
- [x] T018 [US3] Vérifier le parcours de `specs/008-refonte-interface-smarte/quickstart.md` avec deux magasins et un compte à droits limités, y compris liste vide, fiche devenue indisponible et restauration du contexte.

## Lots 2 à 4 · US4 · Migrer toutes les familles d’écran

**Vérification indépendante** — Comparer les listes, fiches et erreurs d’un parcours GTA, d’un parcours GLOMARI, d’un module transversal et d’une page autonome. Vérifier les actions, les thèmes, le clavier et le mouvement réduit à 360 et 1 280 px.

### Lot 2 · GTA

- [x] T019 [US4] Migrer les écrans de formation, inscriptions, apprenants, sessions et planning dans `public/app.js`, `public/gta.js` et `public/scolarite.js`. Vérifier les entrées, listes, fiches et formulaires de la scolarité.
- [x] T020 [P] [US4] Migrer les écrans pédagogiques et les parcours autonomes GTA dans `public/pedagogie.js`, `public/academie.js`, `public/cours.html`, `public/cours.js`, `public/verifier.html`, `public/verifier.js`, `public/boutique.html`, `public/boutique.js`, `public/avis.html` et `public/avis.js`. Vérifier les liens existants et les états de chargement, accès et erreur.
- [ ] T021 [US4] Vérifier toutes les entrées GTA dans `specs/008-refonte-interface-smarte/inventaire.md` avec les droits de scolarité, formateur et apprenant applicables.

### Lot 3 · GLOMARI

- [x] T022 [P] [US4] Migrer commandes, précommandes, suivi, magasins et livraisons dans `public/canalenligne.js`, `public/precommandes.js`, `public/logistique.js`, `public/suivi.html` et `public/suivi.js`. Vérifier le contexte lieu et les liens de suivi.
- [x] T023 [P] [US4] Migrer stocks, achats, entrepôt, dépôt-vente, rayons et rapports dans `public/entrepots.js`, `public/depotvente.js`, `public/codesbarres.js` et `public/rapports.js`. Vérifier filtres, saisies et restitution des tableaux sur mobile.
- [x] T024 [P] [US4] Migrer catalogue, gros et réseau commercial dans `public/commerce.js`, `public/mall.js`, `public/fichesvente.js`, `public/portail.html` et `public/portail.js`. Vérifier les points d’entrée et les actions selon les droits.
- [x] T025 [P] [US4] Migrer Care, messages, avis et tickets dans `public/relation.js`, `public/assistantcare.js`, `public/messages.js`, `public/evaluer.html` et `public/evaluer.js`. Vérifier le contexte public des liens et les sections accessibles selon le rôle.
- [ ] T026 [US4] Vérifier les entrées GLOMARI migrées par T022–T025 dans `specs/008-refonte-interface-smarte/inventaire.md`. La vérification de la caisse relève de T032 et T034.

### Lot 4 · Fonctions transversales et pages autonomes

- [x] T027 [P] [US4] Migrer finance, comptabilité, fiscalité et recouvrement dans `public/compta.js`, `public/tresorerie.js`, `public/fiscal.js` et `public/recouvrement.js`. Vérifier montants, filtres, statuts et actions autorisées.
- [x] T028 [P] [US4] Migrer RH, gestion, documents, fichiers et outils de pilotage dans `public/gestion.js`, `public/documents.js`, `public/fichiers.js`, `public/fiches.js`, `public/controle.js`, `public/pilotage.js`, `public/okr.js`, `public/quotidien.js` et `public/tour.js`. Vérifier les actions et états par rôle.
- [x] T029 [P] [US4] Migrer console, administration, événements, formulaires et pages publiques restantes dans `public/modules.js`, `public/console.html`, `public/console.js`, `public/evenements.js`, `public/evenement.html`, `public/evenement.js`, `public/capture.html`, `public/capture.js`, `public/postuler.html`, `public/postuler.js`, `public/reserver.html` et `public/reserver.js`. Vérifier les adresses, paramètres et contextes d’accès existants.
- [x] T030 [US4] Reprendre les écrans transversaux hébergés dans `public/app.js`, `public/relation.js` et `public/finitions.js`, dont connexion, notifications, compte, recherche et charte. Traiter toute entrée encore ouverte dans `specs/008-refonte-interface-smarte/inventaire.md`, puis vérifier les familles représentatives dans les deux thèmes.

## Lots 3 et 4 · US5 · Préserver la caisse et l’impression

**Vérification indépendante** — Après ouverture en ligne, effectuer une vente hors connexion et constater une seule synchronisation. Prévisualiser un reçu et un document multi-page par entité.

- [x] T031 [P] [US5] Au lot 3, adapter la présentation de la caisse et les états réseau et de file dans `public/caisse.js` et `public/style.css`. Garder la file existante, sa reprise et les restrictions du mode hors connexion.
- [x] T032 [US5] Aligner `public/sw.js` sur les ressources effectivement nécessaires à la caisse. Selon `specs/008-refonte-interface-smarte/quickstart.md`, tester la perte du réseau, la reprise et l’unicité d’une vente, avec cache courant puis après mise à jour.
- [x] T033 [P] [US5] Au lot 4, harmoniser les styles d’impression de `public/style.css` et l’en-tête de `public/tableau.js` pour les sorties inventoriées. Vérifier les logos, mentions, sauts de page et formats A4 et ticket.
- [x] T034 [US5] Consigner les preuves caisse et impression dans `specs/008-refonte-interface-smarte/inventaire.md` selon le scénario `specs/008-refonte-interface-smarte/quickstart.md` et SC-006.

## Lot 5 · Recette générale

- [x] T035 Réconcilier `specs/008-refonte-interface-smarte/inventaire.md` avec les destinations encore présentes dans `public/app.js`, les sous-écrans, les pages autonomes et les sorties imprimables. Vérifier la couverture complète et conserver les captures de référence par famille.
- [ ] T036 Exécuter les vérifications de `package.json` et la recette de `specs/008-refonte-interface-smarte/quickstart.md`. Mesurer SC-002 avec les utilisateurs représentatifs, confirmer SC-001 à SC-006 et consigner les écarts ou vérifications restantes dans l’inventaire.

## Dépendances et ordre d’exécution

- Le lot 0 et T004–T007 précèdent les parcours pilotes. US1 fournit le cadre commun de US2 et US3. Le lot 1 est livrable après les trois vérifications indépendantes.
- Les lots 2 à 4 utilisent les composants validés au lot 1. Exécuter T031–T032 pendant le lot 3, puis T033 pendant le lot 4. La recette générale dépend de la validation de tous les lots et de T034.
- Une tâche de vérification suit le parcours qu’elle valide. À chaque lot qui migre des écrans, vérifier les protections serveur des accès directs, lectures de fiches et actions sur les points d’entrée concernés selon le protocole du guide de recette. Pour les fichiers partagés, coordonner les changements avant d’ouvrir un travail parallèle.

## Travail en parallèle

- **US1** — préparer l’inventaire des destinations et les relevés de recherche en parallèle, puis intégrer T008–T011 dans le cadre commun.
- **US2 et US3** — lancer T015 pendant le pilote GTA. Séquencer T012 et T016 pour leurs modifications communes dans `public/tableau.js`.
- **US4** — T022–T025 peuvent avancer en parallèle une fois le lot 1 validé. Au lot 4, T027–T029 portent sur des modules distincts.
- **US5** — planifier séparément caisse et impression après les fondations. Coordonner leurs modifications communes dans `public/style.css` et jouer la recette hors ligne après l’intégration du cache.

## Stratégie de livraison

Livrer en premier l’inventaire, le cadre commun, les deux accueils et les deux parcours pilotes. Déployer ensuite les lots GTA, GLOMARI et transversaux sur le même JavaScript natif. Cocher une tâche et marquer un écran vérifié après exécution du scénario associé.
