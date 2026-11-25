# Spécification de la refonte UI/UX de SMARTE

**Dossier de fonctionnalité** — `008-refonte-interface-smarte`\
**Créée le** — 25 novembre 2026\
**Statut** — Brouillon prêt pour la planification\
**Demande** — Décliner les maquettes v2 de GTA et GLOMARI et les interactions du prototype sur toutes les pages de SMARTE.

### Références et décisions visuelles

| Référence | Éléments à reprendre |
| --- | --- |
| [GTA v2](<../../output/aperçus SMARTE/GTA maquette v2.png>) | Logo Global Training Academy sur fond clair, bleu pour les actions principales, vert en accent, sessions et présences au premier plan. |
| [GLOMARI v2](<../../output/aperçus SMARTE/GLOMARI maquette v2.png>) | Logo GLOMARI sur un fond offrant un contraste suffisant, violet pour les actions principales, orange en accent, commandes et alertes de stock au premier plan. |
| [Navigation SMARTE](<../../output/aperçus SMARTE/Navigation SMARTE.html>) | Structure commune, espace actif explicite, choix de lieu distinct, menu mobile, indicateurs ouvrant une liste, recherche et fiche contextuelle animée. |

Les deux espaces partagent la même grille, les mêmes repères de navigation, la même hiérarchie typographique et les mêmes interactions. Les couleurs et logos créent l’identité de chaque espace. Les données de démonstration, noms de lieux et contrôles illustratifs sont remplacés par les données et actions autorisées dans SMARTE.

## Scénarios utilisateurs et tests

### US1 — Se repérer et changer d’espace (P1)

Un collaborateur repère son espace, accède à ses modules et retrouve son contexte lorsqu’il change d’entité. La navigation commune réduit le temps passé à retrouver une action.

**Test indépendant** — Ouvrir SMARTE avec un compte habilité aux deux entités, ouvrir un module dans chacune et basculer à nouveau. Répéter avec un compte limité à GTA.

1. Avec deux habilitations, le changement d’espace met à jour le logo, le thème et les destinations autorisées. Le retour rétablit le dernier écran encore autorisé.
2. Avec une seule habilitation, l’utilisateur voit son espace et les destinations auxquelles son rôle donne accès.
3. Sur téléphone, le menu s’ouvre depuis un bouton identifié, se referme après la sélection et place le focus sur le titre de destination.

### US2 — Agir depuis l’accueil GTA (P1)

Un formateur repère une session et saisit les présences depuis l’accueil. La scolarité peut accéder aux inscriptions selon ses droits.

**Test indépendant** — Depuis l’accueil GTA, ouvrir les présences à saisir, sélectionner une session, enregistrer l’appel et revenir à la liste.

1. Un indicateur cliquable ouvre la liste correspondante avec le bon filtre.
2. Après enregistrement ou fermeture de la fiche, la liste retrouve ses filtres, son tri et sa position lorsque la ligne est encore disponible. Un retour d’enregistrement informe le formateur du résultat.

### US3 — Préparer une commande GLOMARI (P1)

Un préparateur repère les commandes à traiter pour le magasin sélectionné et consulte le détail depuis la liste.

**Test indépendant** — Sélectionner un magasin autorisé, ouvrir les commandes à préparer, consulter une commande puis fermer sa fiche.

1. La sélection du magasin agit sur les informations qui en dépendent et le périmètre reste visible sur la liste et la fiche.
2. Sur ordinateur, une fiche courte s’ouvre à côté de la liste. Sur mobile, elle dispose de la largeur de l’écran et d’un retour explicite. En revenant, l’utilisateur retrouve les filtres et la position de la liste.

### US4 — Retrouver les mêmes repères sur toutes les pages (P2)

Un collaborateur utilise des listes, fiches et formulaires cohérents entre modules. Les portails et vues autonomes reprennent les repères visuels adaptés à leur usage.

**Test indépendant** — Comparer une liste d’apprenants, une liste de stocks, un formulaire transversal et une page publique sur ordinateur et téléphone.

1. Sur chaque écran, le titre, l’action principale, les statuts et les messages d’erreur suivent les mêmes conventions.
2. En mode mouvement réduit, le menu, les changements d’écran et les fiches restent utilisables au clavier et au toucher, avec des transitions de déplacement supprimées.
3. Une erreur de validation est affichée près du champ concerné et les autres valeurs restent saisies.

### US5 — Continuer à vendre et à imprimer (P1)

Un caissier peut poursuivre le parcours hors connexion déjà pris en charge. Les collaborateurs peuvent imprimer les documents avec le logo approprié et les informations métier complètes.

**Test indépendant** — Ouvrir une caisse en ligne, perdre la connexion, enregistrer une vente dans le parcours existant, rétablir la connexion et contrôler la synchronisation. Prévisualiser un document multi-page par entité et un reçu de caisse.

1. La caisse indique l’état de connexion et le nombre de ventes en attente si cette information est disponible. Après le retour du réseau, le résultat de synchronisation est visible et une vente n’est comptabilisée qu’une fois.
2. À l’impression, le document présente le logo applicable, conserve les montants, références et mentions existantes et masque les commandes de navigation. Le reçu reste lisible dans son format prévu.

### Cas limites

- Quand un droit a changé depuis la dernière visite, l’utilisateur retrouve un écran autorisé. Une tentative d’accès direct applique les droits de l’entité concernée.
- Quand une fiche rend la ligne indisponible ou la fait sortir du filtre, conserver les filtres et ramener le focus vers la liste ou son titre.
- Quand une liste est vide, en chargement ou en erreur, afficher l’état correspondant et une action de relance si elle est possible.
- Quand un changement d’espace ou une fermeture ferait perdre une saisie en cours, laisser l’utilisateur choisir de rester ou de quitter.
- Quand le logo de l’entité est indisponible, afficher son nom et garder un thème lisible. Un document suit la règle de repli de marque en vigueur.

## Exigences

### Exigences fonctionnelles

- **FR-001** — L’ensemble des écrans livrés par SMARTE doit figurer dans un inventaire de couverture avec le contexte, les rôles concernés, le modèle d’écran et le scénario de vérification. Inclure les accueils, modules GTA et GLOMARI, modules transversaux, connexion, portails et pages publiques du projet, erreurs, caisse et documents imprimables.
- **FR-002** — Chaque écran doit reprendre les repères communs applicables à son usage, notamment la hiérarchie des titres, les espacements, les actions, le contraste, les statuts et le retour d’action. Les dispositions spécialisées de caisse, portail et impression doivent être documentées dans l’inventaire.
- **FR-003** — Chaque espace doit afficher son logo et décliner sa palette issue de la maquette v2. Un statut doit rester reconnaissable par son libellé ou son symbole en plus de la couleur.
- **FR-004** — Le menu doit signaler la destination active et regrouper les modules autorisés par métier. Le changement GTA/GLOMARI doit être distinct du choix de site ou de magasin, lequel apparaît sur les écrans où il a un effet.
- **FR-005** — Les menus, recherches, raccourcis, résultats, fiches et actions doivent respecter les droits du compte et le périmètre de l’entité active, y compris si une destination est ouverte directement.
- **FR-006** — Chaque accueil doit proposer des données et actions utiles au métier et au rôle. Tout indicateur présenté comme interactif doit ouvrir une destination correspondante avec le bon périmètre et les bons filtres.
- **FR-007** — En revenant d’une fiche, l’utilisateur doit retrouver la recherche, les filtres, le tri, la page et la position applicables. Le changement d’espace doit mémoriser le dernier écran autorisé et son contexte pour chaque espace dans la session.
- **FR-008** — La navigation et les actions principales doivent être utilisables au clavier et au toucher. Un panneau modal doit conserver le focus tant qu’il est ouvert, se fermer au clavier et rendre le focus à l’action d’origine ou à un repère équivalent.
- **FR-009** — Les menus, panneaux et changements d’écran doivent utiliser des transitions brèves et interruptibles sans bloquer la navigation. En mouvement réduit, les déplacements animés doivent être supprimés et les changements d’état rester perceptibles.
- **FR-010** — Les listes et formulaires doivent afficher de manière cohérente le chargement, l’absence de résultat, les erreurs, l’enregistrement et la confirmation. Un échec de saisie doit conserver les valeurs saisies tant que le formulaire est ouvert.
- **FR-011** — Les parcours métier existants de caisse hors connexion doivent rester disponibles dans leurs conditions actuelles. Les ventes en attente et les résultats de synchronisation doivent être visibles pendant le parcours.
- **FR-012** — Les vues imprimables doivent conserver les informations métier, mentions et formats existants. Un aperçu doit être lisible et exempt de menus, de commandes interactives et de coupures qui masquent un contenu métier.

### Entités clés

- **Espace de travail** — Entité GTA ou GLOMARI, identité de marque et périmètre autorisé.
- **Contexte de navigation** — Écran, site ou magasin, recherche, filtres, tri, page et repère de retour.
- **Écran inventorié** — Destination ou vue autonome, usages, rôles, modèle visuel et vérification associée.

## Critères de réussite

- **SC-001** — 100 % des écrans inventoriés ont une vérification de conformité au design commun et à l’identité applicable. La recette inclut des captures de chaque famille d’écran pour les deux thèmes pertinents.
- **SC-002** — Lors d’un essai avec au moins cinq utilisateurs représentatifs par parcours, au moins 80 % des participants terminent le parcours correspondant au premier essai sans aide.
- **SC-003** — Dans tous les scénarios de retour couvrant les listes de formation et de commandes, les filtres, le tri et la position sont restaurés ou un repère de repli est rendu visible si la ligne a disparu.
- **SC-004** — Les parcours de référence sont réalisables au clavier et au toucher sur des largeurs de référence de 360 px et 1 280 px. Ils ne présentent aucun débordement horizontal de la page, hors zones de tableau prévues à cet effet, et aucun déplacement animé en mouvement réduit.
- **SC-005** — Tous les scénarios de recette avec un compte GTA, un compte GLOMARI et un compte multi-entités présentent uniquement des destinations et données autorisées, y compris après une révocation de droit.
- **SC-006** — Une vente de recette effectuée hors connexion est synchronisée une seule fois au retour du réseau. Les aperçus d’impression vérifiés pour GTA, GLOMARI et la caisse conservent la totalité des informations et mentions attendues.

## Hypothèses

- Le périmètre est le clone SMARTE. La Marketplace indépendante relève de son propre projet.
- Les règles métier, les droits et les conditions actuelles d’utilisation hors connexion restent la référence. Les actions représentées dans une maquette sont reliées aux parcours existants lorsqu’ils sont disponibles.
- La cible visuelle initiale privilégie des surfaces de travail claires et une durée de transition de 150 à 220 ms à valider en recette. Les fichiers source des logos fournis servent de référence de marque.
- Les exemples de noms, montants et lieux des maquettes servent à illustrer la disposition.
