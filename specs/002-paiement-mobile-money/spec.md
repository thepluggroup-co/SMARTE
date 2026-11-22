# Feature Specification: Paiement Mobile Money des commandes en ligne GLOMARI (lot 2)

**Feature Branch**: `lot2-paiement-mobile-money`

**Created**: 2026-11-22

**Status**: Draft

**Input**: User description: "Lot 2 de la Fiche technique globale GLOMARI (section 9) : paiement Mobile Money (Orange Money et MTN MoMo) des commandes en ligne créées au lot 1. Une commande n'est payée que sur avis signé du prestataire ; avis non signé refusé, avis rejoué sans effet, montant différent refusé. Paiement confirmé : encaissement, facture avec sortie du stock réservé, commande payée puis facturée, colis créé, sans saisie. Paiement tardif : commande à rembourser, journal, tâche au trésorier. Prestataire interchangeable, factice pour les tests, le vrai branché plus tard. Recette : 20 paiements de test rapprochés au franc près."

## Contexte

Le lot 1 permet à un client de la Marketplace GLOMARI de commander : le stock du lieu est réservé 30 minutes pour un paiement Orange Money ou MTN MoMo, puis libéré s'il n'est pas payé. Le lot 2 ferme la boucle : le client paie depuis son téléphone et, dès que l'opérateur le confirme, la vente se termine seule (argent encaissé, facture, sortie de stock, colis), sans aucune saisie. C'est la condition du « un seul stock, en rayon et en ligne » (règle R1) et du paiement validé seulement par l'opérateur (règles non négociables de la fiche, section 2).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Payer sa commande par Mobile Money et recevoir la vente terminée (Priority: P1)

Un client a commandé un article sur la Marketplace en choisissant Orange Money. Il lance le paiement, valide l'opération sur son téléphone, et l'opérateur confirme. Sans qu'aucun employé n'intervienne, l'argent est enregistré dans le compte Orange Money de GLOMARI, la facture est émise à son nom, l'article sort du stock du Mall, le colis est prêt à préparer, et sa page de suivi affiche « payée » puis « facturée ».

**Why this priority**: Sans ce parcours, la Marketplace ne peut vendre qu'en paiement à la livraison. C'est le cœur du lot 2 et la condition de la recette (20 paiements rapprochés sans saisie).

**Independent Test**: Avec le prestataire factice, une commande Orange Money de 2 pièces sur 3 en stock est payée : la facture existe, le stock du lieu passe à 1 sans double décompte, le portefeuille Orange Money de la branche augmente du total au franc près, un colis existe, et le suivi affiche « facturée ».

**Acceptance Scenarios**:

1. **Given** une commande réservée, non échue, à payer par Orange Money, **When** le client lance le paiement, **Then** il reçoit l'instruction de l'opérateur (validation sur son téléphone ou lien de paiement) et la commande reste réservée.
2. **Given** ce paiement lancé, **When** l'opérateur envoie un avis signé de réussite pour le montant exact, **Then** dans la même opération : le paiement est enregistré avec la référence de l'opérateur, le portefeuille du moyen est crédité, la réservation est levée, la facture est émise avec ses lignes et les frais de livraison, le stock du lieu baisse, la commande passe à « payée » puis « facturée » et un colis est créé.
3. **Given** une commande payée et facturée, **When** le client ouvre son lien de suivi, **Then** il voit « facturée » et l'état de son colis.
4. **Given** une commande à payer par MTN MoMo, **When** le même parcours se déroule avec MTN, **Then** le résultat est identique, dans le portefeuille MTN MoMo.

---

### User Story 2 - Ne jamais croire un faux avis ni compter deux fois un paiement (Priority: P1)

Un fraudeur envoie un faux avis de paiement pour obtenir une marchandise. L'opérateur, lui, renvoie parfois le même avis plusieurs fois. Dans aucun cas une facture, une sortie de stock ou un encaissement ne doit être créé à tort ou en double.

**Why this priority**: Un seul faux avis accepté fait perdre une marchandise ; un avis compté deux fois fausse la caisse et le stock. Ce risque financier direct justifie la même priorité que le parcours principal.

**Independent Test**: Envoyer un avis sans signature, un avis mal signé, un avis au mauvais montant, puis trois fois le même avis valide : seule la première réception de l'avis valide produit une facture et un encaissement ; les autres ne changent rien et sont tracées.

**Acceptance Scenarios**:

1. **Given** une commande réservée, **When** un avis sans signature valide arrive, **Then** il est refusé, rien ne change et la tentative est tracée.
2. **Given** un avis valide déjà traité, **When** le même avis arrive de nouveau, **Then** il est reconnu comme déjà traité : aucune nouvelle facture, aucun nouvel encaissement.
3. **Given** une commande de 51 000 FCFA, **When** un avis signé annonce 50 000 FCFA, **Then** il est refusé, la commande reste réservée et l'écart est tracé.
4. **Given** deux organisations clientes de l'ERP, **When** un avis vise une commande, **Then** il ne peut agir que sur la commande de la boutique et de l'organisation visées.

---

### User Story 3 - Paiement arrivé trop tard : rembourser, jamais vendre sans stock (Priority: P2)

Un client paie après l'expiration de sa commande : son article a été remis en vente, peut-être déjà vendu au Mall. Le système ne doit ni facturer ni sortir un stock qui n'est plus réservé ; il signale le paiement comme « à rembourser » et le confie au trésorier.

**Why this priority**: Rare mais inévitable avec les réseaux mobiles. Mal traité, il crée une vente sans stock ou un client débité sans marchandise.

**Independent Test**: Laisser expirer une commande, puis envoyer un avis valide : la commande passe à « à rembourser », aucune facture ni sortie de stock, une tâche apparaît pour le trésorier avec le montant et la référence de l'opérateur.

**Acceptance Scenarios**:

1. **Given** une commande expirée, **When** un avis valide de réussite arrive, **Then** la commande passe à « à rembourser », le paiement est enregistré, aucune facture ni sortie de stock n'est faite, l'événement est tracé et une tâche est créée pour les titulaires du droit de trésorerie de la branche.
2. **Given** une commande annulée par le personnel, **When** un avis valide arrive, **Then** même traitement « à rembourser ».
3. **Given** une commande déjà payée, **When** un second paiement réussi arrive avec une autre référence d'opérateur, **Then** ce second paiement est marqué « à rembourser » sans seconde facture.
4. **Given** une commande dont l'échéance tombe au moment exact où l'avis arrive, **When** l'expiration et le paiement se croisent, **Then** une seule issue s'applique : soit vendue et facturée, soit expirée et à rembourser, jamais les deux.

---

### User Story 4 - Rapprocher chaque paiement au franc près (Priority: P3)

Le trésorier et le comptable retrouvent, pour chaque jour et chaque moyen, la liste des paiements en ligne avec la référence de l'opérateur, la commande, la facture et le mouvement du portefeuille, et des totaux qui collent au relevé de l'opérateur, sans tableur.

**Why this priority**: C'est l'indicateur de succès de la direction (100 % des paiements rapprochés sans saisie). Il s'appuie sur les parcours 1 à 3.

**Independent Test**: Après 20 paiements de test (Orange et MTN), la liste du jour et du moyen donne 20 lignes et un total égal à la somme des avis, au franc près ; les paiements « à rembourser » apparaissent à part.

**Acceptance Scenarios**:

1. **Given** des paiements confirmés dans la journée, **When** le trésorier consulte les paiements en ligne du jour pour Orange Money, **Then** chaque ligne montre la référence de l'opérateur, la commande, la facture, le montant et le portefeuille, avec le total.
2. **Given** des paiements « à rembourser », **When** le trésorier les consulte, **Then** ils apparaissent à part, avec le motif (commande expirée, annulée, payée deux fois).

---

### Edge Cases

- Le client lance le paiement deux fois avant d'avoir validé : seul le premier paiement réussi solde la commande ; un éventuel second paiement réussi est « à rembourser ».
- L'opérateur annonce un échec (solde insuffisant, refus du client, délai dépassé) : la commande reste réservée jusqu'à son échéance ; le client peut relancer.
- Le prestataire est injoignable au lancement : message clair au client, la commande reste réservée.
- Aucun prestataire n'est configuré : le lancement répond « paiement en ligne indisponible » ; le paiement à la livraison reste possible.
- Une commande « à la livraison » ne se paie pas en ligne au lot 2.
- Le portefeuille par défaut du moyen n'est pas réglé pour la branche : le paiement n'est jamais perdu ; il est enregistré et facturé, et une tâche signale au trésorier l'encaissement à placer.
- L'identité vendeur de la branche (raison sociale, NIU) manque et empêche la facture : le paiement est enregistré, la commande passe à « payée », une tâche demande de compléter l'identité ; la facture s'émet ensuite, une seule fois.
- Retrait au magasin : pas de colis ; la commande facturée est prête à remettre au client.
- Un avis vise une référence de commande inconnue ou une autre organisation : refusé et tracé, sans rien révéler.

## Requirements *(mandatory)*

### Functional Requirements

**Lancer le paiement**

- **FR-001** : Le client DOIT pouvoir lancer le paiement d'une commande réservée et non échue, payable par Orange Money ou MTN MoMo, en présentant sa référence et son jeton de suivi.
- **FR-002** : Le lancement DOIT transmettre à l'opérateur le montant exact de la commande (total toutes taxes et frais de livraison compris) et renvoyer au client l'instruction de l'opérateur.
- **FR-003** : Le client DOIT pouvoir relancer un paiement tant que la commande est réservée et non échue.
- **FR-004** : Sans prestataire configuré, ou prestataire injoignable, le lancement DOIT répondre clairement que le paiement en ligne est indisponible, sans modifier la commande.

**Recevoir l'avis de l'opérateur**

- **FR-005** : Une commande DOIT être considérée comme payée uniquement sur un avis de l'opérateur dont la signature est vérifiée. Le retour du navigateur du client ne confirme jamais un paiement.
- **FR-006** : Un avis sans signature valide DOIT être refusé sans aucun effet et tracé.
- **FR-007** : Chaque transaction de l'opérateur DOIT être traitée une seule fois : un avis rejoué est reconnu comme déjà traité et ne crée ni facture, ni encaissement, ni sortie de stock.
- **FR-008** : Le montant de l'avis DOIT égaler au franc près le total de la commande ; sinon l'avis est refusé, la commande reste inchangée et l'écart est tracé.
- **FR-009** : Un avis ne DOIT agir que sur une commande de la boutique et de l'organisation qu'il vise.
- **FR-010** : Un avis d'échec DOIT être enregistré sans changer la réservation.

**Terminer la vente sans saisie**

- **FR-011** : Sur avis valide de réussite pour une commande réservée et non échue, le système DOIT, en une seule opération indivisible :
  1. enregistrer le paiement avec la référence de l'opérateur et le moyen ;
  2. créditer le portefeuille par défaut de la branche pour ce moyen ;
  3. lever la réservation et sortir le stock du lieu qui sert la commande, sans que la même pièce soit comptée deux fois ;
  4. émettre la facture au nom du client de la commande, avec les lignes et les prix de la commande et les frais de livraison ;
  5. passer la commande à « payée » puis « facturée » ;
  6. créer le colis, sauf pour un retrait au magasin.
- **FR-012** : Si une étape empêche de terminer la vente (identité vendeur incomplète, portefeuille par défaut absent), le paiement NE DOIT JAMAIS être perdu : il est enregistré, la commande passe au moins à « payée », et une tâche est confiée à la personne qui peut corriger. La facture s'émet ensuite une seule fois.
- **FR-013** : Les événements « commande payée » et « commande facturée » DOIVENT être publiés, pour que la Marketplace se mette à jour.

**Paiement tardif ou en trop**

- **FR-014** : Un paiement réussi pour une commande expirée, annulée ou déjà payée DOIT être enregistré et marqué « à rembourser », sans facture ni sortie de stock.
- **FR-015** : Chaque paiement « à rembourser » DOIT être tracé au journal et créer une tâche pour les titulaires du droit de trésorerie de la branche, avec le montant, la référence de l'opérateur et le motif.
- **FR-016** : L'expiration d'une commande et la réception de son paiement NE DOIVENT JAMAIS s'appliquer toutes les deux : une seule issue.
- **FR-017** : Le remboursement lui-même reste une décision et une opération humaines (sortie d'argent avec le droit de trésorerie).

**Suivre et rapprocher**

- **FR-018** : Le personnel DOIT voir, pour chaque commande en ligne, l'état du paiement, la référence de l'opérateur, le numéro de facture et le colis.
- **FR-019** : Le trésorier DOIT disposer de la liste des paiements en ligne par jour et par moyen (référence de l'opérateur, commande, facture, montant, portefeuille), avec le total, et de la liste des paiements « à rembourser ».
- **FR-020** : Le client DOIT voir l'état « payée », « facturée » ou « à rembourser » sur son lien de suivi.

**Prestataire interchangeable**

- **FR-021** : Le système DOIT fonctionner avec un prestataire de paiement interchangeable : changer de prestataire ne change ni les commandes, ni les factures, ni le stock.
- **FR-022** : Un prestataire factice DOIT permettre de tester tout le parcours sans argent réel.
- **FR-023** : Les identifiants d'un vrai prestataire DOIVENT se trouver seulement dans la configuration du serveur, jamais dans le code ni dans le navigateur.

**Séparation et contrôle**

- **FR-024** : GLOMARI et GTA DOIVENT rester séparés : un paiement ne crée de facture, d'encaissement ou de tâche que dans la branche de la commande.
- **FR-025** : Les écritures comptables de ces encaissements DOIVENT être signalées comme à valider par l'expert-comptable ; le système ne remplace pas un expert agréé.

### Key Entities *(include if feature involves data)*

- **Paiement en ligne** : une tentative de paiement d'une commande auprès d'un opérateur. Moyen (Orange Money, MTN MoMo), prestataire, référence de l'opérateur (unique), montant, état (lancé, réussi, échoué, à rembourser), motif s'il est à rembourser, date de confirmation.
- **Avis de paiement** : chaque message reçu de l'opérateur, valide ou non, conservé pour la trace (signature vérifiée ou non, issue du traitement).
- **Commande en ligne** (lot 1) : gagne les états « payée », « facturée » et « à rembourser » ; reliée à son paiement, sa facture et son colis.
- **Facture** et **règlement** (existants) : la facture de la commande et le règlement Mobile Money qui la solde.
- **Portefeuille** (existant) : le compte Orange Money ou MTN MoMo de la branche qui reçoit l'argent.
- **Tâche** (existante) : confiée au trésorier ou à la comptabilité pour un paiement à rembourser ou une vente à terminer.
- **Prestataire de paiement** : le service qui parle aux opérateurs ; factice pour les tests, réel plus tard.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** : 20 paiements de test (Orange Money et MTN MoMo) sont rapprochés au franc près, sans aucune saisie manuelle.
- **SC-002** : Après un avis de réussite, la facture, la sortie de stock et le colis existent en moins d'une minute, sans intervention humaine.
- **SC-003** : Un même avis reçu au moins trois fois ne produit qu'une facture et qu'un encaissement.
- **SC-004** : Aucun avis non signé, mal signé ou au mauvais montant ne produit de facture, d'encaissement ou de sortie de stock.
- **SC-005** : 100 % des paiements arrivés après expiration ou en trop finissent « à rembourser » avec une tâche au trésorier ; aucune vente sans stock.
- **SC-006** : Remplacer le prestataire factice par un vrai prestataire ne change aucun résultat des parcours 1 à 4.

## Assumptions

- La direction n'a pas encore choisi le prestataire (opérateurs en direct ou agrégateur couvrant les deux) : le lot 2 se construit et se teste avec le prestataire factice ; le vrai se branche ensuite sans changer le reste.
- Chaque prestataire signe ses avis selon ses propres règles ; la vérification se fait côté serveur avec un secret de configuration.
- Avant d'ouvrir le paiement Mobile Money, la branche règle ses portefeuilles par défaut Orange Money et MTN MoMo ; un oubli ne fait pas perdre de paiement (tâche au trésorier).
- La facture est émise au nom de la branche, sans utilisateur connecté ; l'opération est tracée comme une action automatique du canal en ligne.
- Les frais de livraison figurent sur la facture.
- La durée de réservation reste celle du lot 1 (30 minutes pour Orange Money et MTN MoMo).
- Le remboursement automatique est hors lot 2 : le trésorier rembourse à la main, avec son droit.
- Les notifications au client (WhatsApp et SMS) arrivent au lot 4 ; au lot 2, le client voit l'état sur son lien de suivi.
- Précommandes et acomptes : lot 3.
- L'écriture comptable des encaissements Mobile Money reste à valider par l'expert-comptable.
