# Feature Specification: Comptes clients en ligne de GLOMARI (lot 4, partie B)

**Feature Branch**: `lot4b-comptes-clients`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "lot 4B" : partie B du lot 4 de la Fiche technique globale GLOMARI (section 9, point 3) : comptes clients en ligne, connexion par téléphone et code à usage unique envoyé par SMS, durée de vie courte, tentatives limitées ; historique des commandes, adresses, points de fidélité. Côté Marketplace (W6) : session courte, déconnexion sur tous les appareils, aucune donnée sensible dans le stockage du navigateur.

## Contexte

Aujourd'hui, un client de la Marketplace commande sans compte : il donne son nom et son téléphone, et ne suit sa commande ou sa précommande que par le lien secret reçu à ce moment-là. S'il perd ce lien, il doit appeler. Il ne retrouve ni ses anciennes commandes, ni ses adresses, ni ses points de fidélité, qu'il gagne pourtant au Mall.

La partie A du lot 4 a construit l'envoi de SMS, avec un prestataire factice en attendant le choix de la direction. Cette partie B s'en sert pour un compte client simple : le client se connecte avec son numéro de téléphone et un code reçu par SMS, sans mot de passe. Le compte est la fiche client que GLOMARI connaît déjà par ce numéro. La Marketplace affichera l'espace client (W6) ; l'ERP fournit la connexion et les données, et les protège.

## Clarifications

### Session 2026-11-23

- Q : Quels achats le client voit-il dans son historique ? → R : Ses commandes de la Marketplace (statut, suivi du colis) et ses précommandes (étapes, solde à payer). Les achats faits au Mall n'y figurent pas encore.
- Q : Combien de temps le client reste-t-il connecté sur un appareil avant de redemander un code ? → R : 7 jours. Il peut se déconnecter de tous ses appareils à tout moment.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Se connecter avec son téléphone et un code reçu par SMS (Priority: P1)

Madame Ngo ouvre la Marketplace et choisit « Mon compte ». Elle saisit son numéro ; un code à six chiffres lui arrive par SMS. Elle le saisit et se retrouve dans son espace, sans mot de passe. Elle reste connectée sept jours sur ce téléphone. Monsieur Fotso, qui n'a jamais rien acheté, fait de même : après le code, on lui demande son nom, et son compte est créé.

**Why this priority**: Sans connexion, aucun des autres parcours n'existe ; c'est aussi la partie qui doit résister aux abus (codes devinés, SMS envoyés en masse).

**Independent Test**: Demander un code pour un numéro connu, saisir un mauvais code puis le bon : la connexion réussit au bon code, une seule fois ; six erreurs de suite invalident le code ; une seconde demande de code dans la minute est refusée.

**Acceptance Scenarios**:

1. **Given** un numéro de mobile camerounais, **When** le client demande un code, **Then** un code à six chiffres part par SMS aussitôt, de jour comme de nuit, et la réponse est la même que le numéro soit connu ou non.
2. **Given** un code reçu, **When** le client le saisit dans les 10 minutes, **Then** il est connecté pour 7 jours sur cet appareil, et le code ne sert plus.
3. **Given** un code, **When** le client se trompe cinq fois, **Then** ce code ne marche plus, même juste ensuite ; il doit en demander un nouveau.
4. **Given** une demande de code, **When** le client en redemande un dans la minute, ou plus de trois en un quart d'heure, **Then** c'est refusé avec le délai à attendre.
5. **Given** un numéro inconnu de GLOMARI, **When** le client saisit le bon code, **Then** on lui demande son nom et sa fiche client est créée dans la branche ; ses commandes futures y seront rattachées.
6. **Given** un numéro déjà connu (une commande passée sans compte), **When** le client se connecte, **Then** il retrouve la fiche existante et ses commandes passées avec ce numéro.

---

### User Story 2 - Retrouver ses commandes et ses précommandes (Priority: P1)

Connectée, Madame Ngo voit la liste de ses commandes de la Marketplace, de la plus récente à la plus ancienne : date, articles, montant, mode de livraison, statut, et le suivi de son colis. Elle voit aussi ses précommandes : l'article, l'acompte payé, l'étape de l'arrivage et, à l'arrivée, le solde à payer avec sa date limite. Elle n'a plus besoin des liens reçus à la commande.

**Why this priority**: C'est ce qu'un client attend d'un compte, et cela évite les appels « où en est ma commande ? ».

**Independent Test**: Avec deux commandes et une précommande passées avec son numéro, et une commande d'un autre client, le client connecté voit ses deux commandes et sa précommande, jamais celle de l'autre client.

**Acceptance Scenarios**:

1. **Given** des commandes en ligne passées avec son numéro, **When** le client ouvre son historique, **Then** il les voit avec leurs articles, leurs montants, leur statut et le suivi du colis.
2. **Given** une précommande arrivée, **When** il l'ouvre, **Then** il voit le solde à payer et sa date limite, et peut lancer le paiement du solde comme depuis le lien de suivi.
3. **Given** la commande d'un autre client, **When** il tente de l'ouvrir depuis son espace, **Then** elle est introuvable.
4. **Given** une commande passée au Mall, **When** il consulte son historique, **Then** elle n'y figure pas (décision du 23 novembre 2026).

---

### User Story 3 - Enregistrer ses adresses et son profil (Priority: P2)

Madame Ngo enregistre deux adresses de livraison, « Maison » à Bonamoussadi et « Bureau » à Akwa, et choisit « Maison » par défaut. À sa prochaine commande, la Marketplace lui propose ces adresses. Elle corrige aussi son nom et ajoute son adresse e-mail.

**Why this priority**: Commander plus vite et sans erreur d'adresse ; utile, mais pas indispensable au premier jour.

**Independent Test**: Ajouter cinq adresses, en refuser une sixième, en choisir une par défaut, en supprimer une : la liste suit ces changements et n'est visible que par ce client.

**Acceptance Scenarios**:

1. **Given** un client connecté, **When** il ajoute une adresse (nom, zone de livraison de GLOMARI, adresse précise, repère facultatif), **Then** elle est enregistrée sur sa fiche.
2. **Given** cinq adresses, **When** il en ajoute une sixième, **Then** c'est refusé.
3. **Given** plusieurs adresses, **When** il en choisit une par défaut, **Then** elle seule est par défaut.
4. **Given** un client connecté, **When** il change son nom ou son e-mail, **Then** sa fiche client est mise à jour ; son numéro de téléphone, lui, ne change pas depuis l'espace client.

---

### User Story 4 - Consulter ses points de fidélité (Priority: P2)

Madame Ngo voit son solde de points GLOMARI, ce qu'il vaut en FCFA, et ses derniers mouvements (points gagnés à ses achats, points utilisés).

**Why this priority**: La fidélité est prévue par le business plan (règle R9) ; le client gagne ses points au Mall sans pouvoir les consulter.

**Independent Test**: Avec des points gagnés et utilisés en caisse sur sa fiche, le client connecté voit le solde exact, sa valeur et les mouvements ; une branche sans fidélité active affiche « programme non actif ».

**Acceptance Scenarios**:

1. **Given** des points gagnés et utilisés sur sa fiche, **When** il ouvre sa fidélité, **Then** il voit son solde, sa valeur en FCFA et ses mouvements récents.
2. **Given** une branche dont le programme de fidélité n'est pas actif, **When** il ouvre sa fidélité, **Then** il voit que le programme n'est pas actif.
3. **Given** des points sur une fiche de GTA, **When** il consulte sa fidélité GLOMARI, **Then** ils n'apparaissent pas (fidélité séparée par branche).

---

### User Story 5 - Se déconnecter partout et garder son compte sûr (Priority: P2)

Madame Ngo a perdu son ancien téléphone. Depuis le nouveau, elle choisit « Me déconnecter de tous mes appareils » : l'ancien n'a plus accès à son compte. Au Mall, l'équipe Care peut faire de même à sa demande.

**Why this priority**: Un téléphone perdu ou prêté ne doit pas laisser ses commandes et ses adresses visibles (W6).

**Independent Test**: Connecter le même client sur deux appareils, demander la déconnexion de tous : les deux accès sont refusés à la requête suivante ; une session de plus de 7 jours est refusée.

**Acceptance Scenarios**:

1. **Given** un client connecté, **When** il se déconnecte, **Then** cet appareil n'a plus accès.
2. **Given** un client connecté sur deux appareils, **When** il demande la déconnexion de tous ses appareils, **Then** aucun des deux n'a plus accès.
3. **Given** une connexion de plus de 7 jours, **When** l'appareil revient, **Then** l'accès est refusé et un nouveau code est demandé.
4. **Given** une demande du client au Mall, **When** une personne de l'équipe Care déconnecte tous ses appareils, **Then** c'est fait et tracé.
5. **Given** une fiche client archivée, fusionnée dans une autre, ou dont le téléphone a changé, **When** l'appareil revient, **Then** l'accès est refusé.

---

### Edge Cases

- Numéro fixe, étranger ou mal saisi : refusé tout de suite, sans SMS envoyé.
- Prestataire de SMS indisponible : le client est prié de réessayer ; la demande compte dans les limites, pour éviter qu'un échec répété serve à forcer des envois.
- Prestataire factice (essai privé) : aucun SMS ne part ; le responsable technique lit le code par un moyen réservé à l'essai, qui n'existe pas avec un vrai prestataire.
- Plusieurs fiches de la branche portent le même numéro : la connexion prend la même fiche que la commande en ligne (la règle existante du client rapide), toujours la même.
- Le client a passé des commandes avec un autre numéro : elles ne sont pas dans son compte.
- La boutique en ligne est fermée : l'espace client est indisponible, comme le reste de la Marketplace.
- Un code demandé pour une organisation ne sert pas pour une autre.
- Beaucoup de demandes de code sur des numéros différents : le débit de la boutique les limite, pour empêcher l'envoi massif de SMS ; au-delà, les clients sont priés de réessayer dans une minute.
- Le nom donné à la création du compte est vide ou trop long : refusé, le code reste valable pour réessayer dans ses 10 minutes.
- Une adresse dont la zone n'est plus proposée par GLOMARI reste affichée, mais signalée comme à mettre à jour.
- Un client de GTA (formations) : aucun compte Marketplace n'est lié à sa fiche de GTA.

## Requirements *(mandatory)*

### Functional Requirements

#### Connexion

- **FR-001**: Le système MUST permettre de demander un code de connexion pour un numéro de mobile camerounais, auprès de la boutique en ligne ouverte d'une organisation ; tout autre numéro est refusé sans envoi.
- **FR-002**: Le code MUST compter six chiffres tirés au hasard, partir aussitôt par SMS à toute heure (hors des heures d'envoi des messages automatiques), ne servir qu'une fois, et expirer après 10 minutes. Il n'est jamais conservé en clair ni écrit dans un journal.
- **FR-003**: La réponse à une demande de code MUST être la même, que le numéro soit connu de GLOMARI ou non.
- **FR-004**: Le système MUST limiter les demandes : un nouveau code au plus une minute après le précédent, trois codes au plus par quart d'heure et dix par jour pour un même numéro, et un débit maximal de demandes de code par minute pour toute la boutique (30 par défaut, réglable par le responsable technique comme les autres débits de la Marketplace, dont le serveur appelle l'ERP depuis une seule adresse).
- **FR-005**: Un code MUST être invalidé après cinq essais faux ; demander un nouveau code invalide le précédent.
- **FR-006**: Au bon code, le système MUST ouvrir une session de 7 jours sur cet appareil. La fiche est la fiche client de la branche de la boutique trouvée par ce numéro, selon la même règle que la commande en ligne. Sans fiche, le client donne son nom et une fiche « client » est créée dans la branche.
- **FR-007**: La session MUST être un secret aléatoire jamais conservé en clair ; elle expire 7 jours après la connexion, sans prolongation, et ne vaut que pour la boutique de son organisation.

#### Historique

- **FR-008**: Le client connecté MUST voir ses commandes en ligne (celles de sa fiche dans la branche), de la plus récente à la plus ancienne : référence, date, articles et quantités, montants, mode de livraison, statut et, s'il y a un colis, son statut et son lien de suivi.
- **FR-009**: Le client connecté MUST voir ses précommandes : référence, campagne, quantité, acompte, statut, étapes de l'arrivage et, à l'arrivée, le solde à payer et sa date limite. Il MUST pouvoir choisir la remise du solde et lancer son paiement depuis son espace, comme depuis le lien de suivi.
- **FR-010**: L'historique MUST exclure les achats en caisse (décision du 23 novembre 2026), et ne jamais montrer un coût, une marge, ni une donnée d'un autre client.

#### Adresses et profil

- **FR-011**: Le client connecté MUST pouvoir enregistrer jusqu'à cinq adresses de livraison (nom, zone de livraison de GLOMARI, adresse précise, repère facultatif), les modifier, les supprimer et en choisir une par défaut.
- **FR-012**: Le client connecté MUST pouvoir modifier son nom et son e-mail ; son numéro de téléphone ne se modifie pas depuis l'espace client.

#### Fidélité

- **FR-013**: Le client connecté MUST voir son solde de points de la branche, sa valeur en FCFA selon la règle de la branche, et ses 50 derniers mouvements (date, points, motif). Si le programme n'est pas actif, il le voit. Les points d'une autre branche n'apparaissent jamais.

#### Sécurité et sessions

- **FR-014**: Le client MUST pouvoir se déconnecter de l'appareil, ou de tous ses appareils à la fois.
- **FR-015**: Une personne de l'équipe Care MUST pouvoir déconnecter tous les appareils d'un client de sa branche ; l'action est tracée.
- **FR-016**: Une session MUST être refusée si la fiche est archivée, fusionnée dans une autre, si son téléphone a changé depuis la connexion, ou si la boutique est fermée.
- **FR-017**: Chaque connexion réussie, chaque déconnexion de tous les appareils et chaque blocage après trop d'essais MUST être tracés, sans le code ni le numéro complet.
- **FR-018**: Aucune donnée d'un client de GTA ne MUST entrer dans un compte de la Marketplace ; seule la branche de la boutique en ligne est concernée.

### Key Entities *(include if feature involves data)*

- **Code de connexion** : demandé pour un numéro et une boutique ; secret, durée de 10 minutes, essais restants, utilisé ou non.
- **Session client** : l'accès d'un appareil à une fiche client pendant 7 jours ; secret, date de connexion, d'expiration, de déconnexion.
- **Adresse de livraison** : jusqu'à cinq par fiche client ; nom, zone, adresse précise, repère, par défaut ou non.
- **Fiche client** (existante) : l'identité du compte ; nom, téléphone, e-mail, branche, points de fidélité.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un client reçoit son code et se connecte en moins d'une minute dans 95 % des cas, une fois le prestataire réel branché.
- **SC-002**: Aucune tentative de deviner un code ne réussit au-delà de cinq essais (sur un million de combinaisons, moins d'une chance sur 200 000 par code).
- **SC-003**: Sur la recette, aucun client connecté ne voit une commande, une précommande, une adresse ou des points d'un autre client.
- **SC-004**: Après une déconnexion de tous les appareils, 100 % des accès suivants de ce client sont refusés.
- **SC-005**: Un même numéro ne reçoit jamais plus de dix codes par jour, quelle que soit l'adresse d'où viennent les demandes.
- **SC-006**: Aucun code ni numéro complet n'apparaît dans les journaux.

## Assumptions

- Le prestataire de SMS est celui de la partie A ; tant que la direction ne l'a pas choisi, seul le prestataire factice existe (essai privé, données fictives). Le code de connexion part toujours par SMS, sans passer par les réglages de la direction : sans lui, personne ne pourrait se connecter.
- Pendant l'essai privé, le responsable technique peut lire le dernier code d'un numéro sur le serveur, par un moyen activé seulement avec le prestataire factice ; ce moyen disparaît avec un vrai prestataire.
- La Marketplace (`glomari-web`, W6) construit les écrans de l'espace client ; elle ne garde dans le navigateur que la session, jamais de code ni de donnée du client. L'ERP fournit les routes et les protège.
- Le compte est la fiche client existante ; aucun mot de passe n'est créé ni demandé (règle du projet).
- Les durées et limites (10 minutes, cinq essais, une minute, trois par quart d'heure, dix par jour, 7 jours, cinq adresses) sont fixées dans le code, comme les autres seuils du projet.
- Les adresses servent à préremplir la commande sur la Marketplace ; la commande garde ses propres règles (zone, adresse, frais) et son contrôle par le serveur.
- Les achats au Mall et dans les magasins n'entrent pas dans l'historique (décision du 23 novembre 2026) ; les points gagnés en caisse apparaissent, eux, dans la fidélité.
- La suppression d'un compte à la demande du client passe par l'équipe, avec l'anonymisation existante ; il n'y a pas de bouton de suppression dans l'espace client.
- La connexion par WhatsApp, par e-mail ou par mot de passe, et l'assistant GLOMARI Care (partie C) sont hors de cette partie.
