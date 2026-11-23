# Feature Specification: Précommandes d'arrivage GLOMARI avec acompte (lot 3, partie A)

**Feature Branch**: `lot3-precommandes`

**Created**: 2026-11-22

**Status**: Draft

**Input**: User description: "Lot 3, partie A, de la Fiche technique globale GLOMARI (section 9) : précommandes de GLOMARI (règle R4 : une prévente est une précommande avec acompte, pas un financement participatif). Campagne d'arrivage (article, prix annoncé, acompte en FCFA ou en %, seuil, date limite) ; inscription depuis la Marketplace avec acompte payé par Mobile Money (lot 2, avis signé) ; seuil atteint : bon de commande fournisseur en brouillon à approuver, sans envoi automatique ; chaque étape de l'arrivage diffusée aux inscrits et visible sur leur lien de suivi ; à la réception, stock réservé aux inscrits dans l'ordre d'inscription, solde payé par une commande en ligne, acompte déduit ; campagne annulée ou seuil non atteint : acomptes remboursés intégralement, sortie d'argent par le trésorier ; un acompte n'est jamais compté deux fois ; GLOMARI seulement. Achats à l'import : partie B. Recette : une campagne complète, de la liste d'attente à la livraison des précommandes."

## Contexte

Les lots 1 et 2 permettent de vendre en ligne le stock existant et de l'encaisser par Mobile Money sans saisie. Le lot 3A ouvre la vente de ce qui n'est pas encore en stock : GLOMARI annonce un arrivage (article exclusif ou saisonnier importé), mesure la demande par une liste d'attente payée d'un acompte, ne commande au fabricant qu'une fois le seuil atteint, informe les inscrits à chaque étape et les sert en priorité à l'arrivée. C'est la règle R4 de la fiche : une précommande avec acompte, pas un financement participatif ; commande au fabricant seulement au seuil atteint, solde payé à la réception, client informé à chaque étape.

## Clarifications

### Session 2026-11-22

- Q : Solde non payé dans le délai : que devient l'acompte ? → R : GLOMARI le conserve ; la règle est affichée et acceptée par le client avant le paiement de l'acompte.
- Q : Comment se paie le solde ? → R : Par Mobile Money seulement au lot 3A ; la livraison et le comptoir pourront venir plus tard.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Annoncer un arrivage et s'inscrire en payant l'acompte (Priority: P1)

Le responsable commercial de GLOMARI annonce l'arrivage d'un modèle de robot pâtissier : prix annoncé 85 000 FCFA, acompte de 30 %, seuil de 50 pièces, date limite au 15 janvier. La campagne apparaît sur la Marketplace avec la progression vers le seuil. Une cliente choisit 2 pièces, donne son nom et son téléphone, paie l'acompte de 51 000 FCFA par Orange Money et reçoit son lien de suivi. Dès que l'opérateur confirme, son inscription compte dans la progression.

**Why this priority**: C'est le point d'entrée de la prévente et le premier argent reçu des clients. Sans lui, rien d'autre n'a d'objet.

**Independent Test**: Créer une campagne, inscrire deux clients et payer leurs acomptes avec le prestataire factice : la progression publique augmente, le portefeuille Orange Money de GLOMARI augmente exactement de la somme des acomptes, et un avis rejoué ne change rien.

**Acceptance Scenarios**:

1. **Given** une campagne ouverte, **When** un visiteur consulte les arrivages, **Then** il voit l'article, ses photos, le prix annoncé, l'acompte par pièce, la date limite et la progression vers le seuil en pourcentage, sans fournisseur, sans prix d'achat ni quantité en stock.
2. **Given** une campagne ouverte, **When** un client s'inscrit pour 2 pièces avec son nom et son téléphone, **Then** il reçoit une référence, un lien de suivi, le montant exact de l'acompte et les conditions (solde à payer à l'arrivée dans le délai annoncé, acompte conservé sinon, remboursé si la campagne est annulée), et peut lancer le paiement Orange Money ou MTN MoMo après les avoir acceptées.
3. **Given** cette inscription en attente, **When** l'opérateur envoie un avis signé de réussite au montant exact, **Then** l'inscription est validée, l'acompte est encaissé une fois dans le portefeuille du moyen, et la progression de la campagne augmente de 2 pièces.
4. **Given** une inscription non payée, **When** le délai de paiement passe, **Then** elle expire et ne compte pas dans la progression.
5. **Given** un numéro de téléphone déjà connu dans le fichier clients de GLOMARI, **When** ce client s'inscrit, **Then** l'inscription est rattachée à sa fiche existante, sans doublon.

---

### User Story 2 - Seuil atteint : un seul bon de commande en brouillon à approuver (Priority: P1)

Avec le dernier acompte confirmé, la campagne atteint 50 pièces. L'ERP prépare le bon de commande au fabricant prévu, pour le lieu de réception, en brouillon. L'acheteur le relit, ajuste le prix d'achat et l'approuve. Rien n'est envoyé seul au fournisseur.

**Why this priority**: C'est la raison d'être de la prévente : ne commander qu'à demande prouvée. Un double bon de commande ferait acheter deux fois.

**Independent Test**: Deux acomptes confirmés au même instant font franchir le seuil : il existe exactement un bon de commande en brouillon, relié à la campagne, et la campagne est « déclenchée ».

**Acceptance Scenarios**:

1. **Given** une campagne à 48 pièces validées sur un seuil de 50, **When** un acompte pour 2 pièces est confirmé, **Then** la campagne passe à « déclenchée », un seul bon de commande en brouillon est créé pour le fournisseur prévu et le lieu de réception, pour la quantité validée, relié à la campagne, et l'événement « seuil atteint » est publié.
2. **Given** deux acomptes confirmés simultanément qui franchissent le seuil, **When** ils sont traités, **Then** un seul bon de commande existe.
3. **Given** ce brouillon, **When** une personne sans le droit d'approuver les achats tente de l'approuver, **Then** c'est refusé ; l'acheteur habilité, lui, peut l'approuver.
4. **Given** ce brouillon, **When** l'acheteur tente de l'approuver pour une quantité inférieure aux pièces précommandées validées, **Then** c'est refusé avec un message clair.
5. **Given** un bon de commande approuvé pour 60 pièces et 55 pièces validées, **When** un client demande 10 pièces, **Then** l'inscription est refusée ; une demande de 5 pièces est acceptée.

---

### User Story 3 - Campagne annulée ou seuil manqué : rembourser chaque acompte, une fois (Priority: P1)

Au 15 janvier, la campagne n'a réuni que 31 pièces. Elle est annulée d'office. Chaque acompte payé devient « à rembourser » et le trésorier reçoit la liste : client, téléphone, montant, référence de l'opérateur. Il rembourse chaque client par l'opérateur puis enregistre le remboursement, qui sort l'argent du portefeuille.

**Why this priority**: On ne peut pas prendre l'argent des clients sans pouvoir le rendre proprement. Cette histoire est donc indispensable avant la première vraie campagne, au même rang que l'inscription.

**Independent Test**: Laisser passer la date limite d'une campagne sous le seuil : toutes les inscriptions validées passent « à rembourser » avec leur acompte exact, une tâche apparaît pour le trésorier ; après enregistrement des remboursements, le portefeuille revient à son solde de départ et une seconde saisie du même remboursement est refusée.

**Acceptance Scenarios**:

1. **Given** une campagne ouverte sous le seuil, **When** la date limite passe, **Then** la campagne est annulée avec le motif « seuil non atteint », chaque inscription validée passe « à rembourser » pour son acompte entier, les inscriptions en attente sont annulées, et les titulaires du droit de trésorerie de GLOMARI reçoivent une tâche.
2. **Given** une campagne déclenchée dont le fabricant ne peut plus livrer, **When** le responsable l'annule avec un motif avant la réception de l'arrivage, **Then** le même traitement s'applique et l'événement d'annulation est publié.
3. **Given** une inscription « à rembourser », **When** le trésorier enregistre le remboursement effectué, **Then** l'argent sort du portefeuille du moyen d'origine, l'inscription passe « remboursée » et une seconde saisie pour la même inscription est refusée.
4. **Given** une personne sans le droit de trésorerie, **When** elle tente d'enregistrer un remboursement, **Then** c'est refusé.
5. **Given** une campagne ouverte non encore déclenchée, **When** un client demande à se retirer et le responsable annule son inscription, **Then** l'inscription passe « à rembourser » et la progression diminue.

---

### User Story 4 - Arrivage reçu : servir les inscrits en priorité et encaisser le solde (Priority: P2)

Les 60 robots arrivent à l'entrepôt de Douala. À la réception du bon de commande, le stock est réservé aux inscrits, du premier au dernier inscrit. Chacun voit sur son lien « Votre article est arrivé : solde de 119 000 FCFA à payer avant le 12 mars », choisit retrait, livraison ou point relais, et paie le solde. La facture est émise pour le prix total, l'acompte déduit, et le colis part. Les 5 pièces non précommandées restent en vente normale.

**Why this priority**: C'est la fin du parcours et la recette du lot. Elle intervient des semaines après l'inscription (délai d'importation), d'où la priorité 2 : les histoires 1 à 3 peuvent servir avant.

**Independent Test**: Recevoir le bon de commande d'une campagne de 3 inscrits : leurs quantités sont réservées dans l'ordre et ne sont vendables ni en caisse ni en ligne ; un inscrit paie son solde : sa facture porte le prix annoncé, l'acompte imputé une fois et le solde, le stock baisse de sa quantité, un colis est créé.

**Acceptance Scenarios**:

1. **Given** une campagne déclenchée dont le bon de commande est approuvé, **When** l'arrivage est reçu au lieu de réception, **Then** la quantité reçue est réservée aux inscriptions validées dans l'ordre de confirmation de leur acompte, chaque inscription servie en entier, et l'événement « arrivage reçu » est publié pour chacune.
2. **Given** une réservation pour un inscrit, **When** la caisse du Mall ou la Marketplace tente de vendre ces pièces, **Then** elles ne sont pas disponibles.
3. **Given** un inscrit servi, **When** il ouvre son lien, **Then** il voit le solde exact (total de l'inscription + frais de livraison − acompte) et la date limite de paiement du solde.
4. **Given** un inscrit qui choisit la livraison et paie le solde, **When** l'avis signé de l'opérateur arrive au montant exact, **Then** en une seule opération : la facture est émise pour le total de l'inscription avec les frais de livraison, l'acompte y est imputé une seule fois, le solde est encaissé, la réservation est levée et le stock sort, un colis est créé (sauf retrait) et l'inscription passe « soldée ».
5. **Given** une réception partielle de 40 pièces pour 50 précommandées, **When** elle est enregistrée, **Then** les premiers inscrits sont servis en entier, dans l'ordre ; le premier qui ne peut pas l'être en entier et les suivants attendent la suite de l'arrivage.
6. **Given** une réception de 60 pièces pour 55 précommandées, **When** elle est enregistrée, **Then** les 5 pièces restantes sont en vente normale.

---

### User Story 5 - Suivre l'arrivage étape par étape (Priority: P3)

L'acheteur enregistre les étapes du bon de commande : commandé, en production, expédié, arrivé au port, dédouané, en stock. Chaque inscrit voit ces étapes et leur date sur son lien de suivi, et chaque étape est publiée pour que les messages WhatsApp et SMS du lot 4 les relaient.

**Why this priority**: Rassure le client pendant plusieurs semaines d'attente et réduit les appels au service client. Elle s'appuie sur le suivi d'achat existant ; sans elle, la prévente fonctionne mais le client est moins informé.

**Independent Test**: Enregistrer trois étapes sur le bon de commande d'une campagne : le lien de suivi de chaque inscrit les affiche dans l'ordre avec leur date, et trois événements d'étape sont publiés, sans nom de fournisseur, prix d'achat ni transitaire.

**Acceptance Scenarios**:

1. **Given** un bon de commande relié à une campagne, **When** l'acheteur enregistre l'étape « expédiée », **Then** l'événement d'étape d'arrivage est publié pour la campagne et l'étape apparaît avec sa date sur le lien de chaque inscrit validé.
2. **Given** une étape enregistrée, **When** un inscrit ouvre son lien, **Then** il ne voit ni le fournisseur, ni le prix d'achat, ni le transitaire.
3. **Given** un bon de commande sans campagne, **When** une étape est enregistrée, **Then** rien n'est publié vers les précommandes.

---

### Edge Cases

- Un acompte arrive après l'expiration de l'inscription en attente : l'inscription est validée si la campagne accepte encore cette quantité ; sinon l'acompte est « à rembourser », avec tâche au trésorier.
- Un acompte arrive pour une campagne annulée, close ou après la date limite : « à rembourser ».
- Le même client paie deux fois la même inscription : le second paiement est « à rembourser ».
- Un avis non signé, mal signé, au mauvais montant ou rejoué : mêmes garanties qu'au lot 2, aucun effet.
- Le seuil est atteint au moment exact de la date limite : une seule issue, déclenchée ou annulée, jamais les deux.
- Le portefeuille par défaut du moyen n'est pas réglé : l'acompte n'est jamais perdu ; il apparaît dans les encaissements à placer de la trésorerie, et la liste des paiements en ligne le marque « en attente » (comme au lot 2).
- Le prix de l'article change au catalogue après l'annonce : l'inscrit paie le prix annoncé.
- L'inscrit commence à payer son solde puis abandonne : ses pièces restent réservées jusqu'à la fin du délai de solde ; il peut relancer.
- Le délai de solde passe sans paiement : les pièces sont remises en vente, l'inscription est close et GLOMARI conserve l'acompte. Un paiement du solde qui arrive ensuite est « à rembourser ».
- Le bon de commande est clos sans que tout l'arrivage soit reçu : les inscriptions validées non servies passent « à rembourser ».
- Une campagne déjà déclenchée : le retrait individuel d'un client n'est plus possible ; seule l'annulation de toute la campagne rend les acomptes.
- L'arrivage est déjà reçu : la campagne ne s'annule plus ; chaque cas restant se règle inscription par inscription.
- Un client s'inscrit plusieurs fois : chaque inscription est distincte, avec son acompte et son rang.
- Une branche sans module de stock (GTA) : aucune campagne possible, rien de visible.

## Requirements *(mandatory)*

### Functional Requirements

**Créer une campagne**

- **FR-001** : Le personnel habilité de GLOMARI DOIT pouvoir créer une campagne d'arrivage avec : un article du catalogue, le prix annoncé (prix payé par le client, taxes comprises), l'acompte par pièce (montant en FCFA ou pourcentage du prix annoncé, arrondi au franc), le seuil (quantité minimale), la date limite, le fournisseur prévu, le lieu de réception, une quantité maximale facultative, le délai de paiement du solde et un texte de présentation.
- **FR-002** : L'acompte DOIT être supérieur à zéro et inférieur au prix annoncé ; le seuil supérieur à zéro ; la quantité maximale, si elle existe, au moins égale au seuil ; la date limite dans le futur.
- **FR-003** : Dès qu'un premier acompte est payé, l'article, le prix annoncé, l'acompte et le seuil NE DOIVENT PLUS changer ; la date limite peut seulement être reportée, et la quantité maximale relevée.
- **FR-004** : Une campagne NE DOIT être possible que dans une branche qui gère du stock (GLOMARI) ; GTA ne peut ni en créer ni en voir.

**S'inscrire et payer l'acompte**

- **FR-005** : Le public DOIT voir les campagnes ouvertes : article, photos, prix annoncé, acompte par pièce, date limite et progression vers le seuil en pourcentage, sans fournisseur, prix d'achat ni quantité en stock.
- **FR-006** : Un client DOIT pouvoir s'inscrire avec son nom, son téléphone et une quantité ; il est rattaché à la fiche client de GLOMARI qui porte ce téléphone, ou une fiche est créée ; il reçoit une référence, un lien de suivi personnel et le montant de l'acompte.
- **FR-006a** : Avant de payer l'acompte, le client DOIT voir et accepter les conditions : solde à payer à l'arrivée dans le délai de la campagne, acompte conservé par GLOMARI si le solde n'est pas payé à temps, acompte remboursé en entier si la campagne est annulée. L'inscription garde la trace de cette acceptation et du texte accepté.
- **FR-007** : L'acompte DOIT se payer par Orange Money ou MTN MoMo, avec toutes les garanties du lot 2 : payé seulement sur avis signé de l'opérateur, avis rejoué sans effet, montant exact exigé, avis limité à l'organisation et à la boutique visées.
- **FR-008** : Une inscription NE DOIT compter dans la progression qu'une fois son acompte confirmé. Une inscription non payée expire après le délai de paiement d'une commande en ligne ; pendant ce délai, elle retient sa quantité dans la limite de la quantité maximale.
- **FR-009** : Un acompte confirmé après l'expiration de son inscription DOIT valider l'inscription si la campagne accepte encore cette quantité, sinon être « à rembourser ». Un acompte pour une campagne annulée ou close, ou payé en double, DOIT être « à rembourser ». Chaque cas crée une tâche pour le trésorier.
- **FR-010** : Les inscriptions DOIVENT être refusées après la date limite, au-delà de la quantité maximale, au-delà de la quantité commandée une fois le bon de commande approuvé, dès la première réception de l'arrivage, et pour une campagne annulée.

**Seuil atteint et bon de commande**

- **FR-011** : Quand la quantité validée atteint le seuil, le système DOIT, une seule fois : passer la campagne à « déclenchée », créer un bon de commande fournisseur en brouillon (fournisseur prévu, lieu de réception, article, quantité validée à cet instant) relié à la campagne, et publier l'événement « seuil atteint ».
- **FR-012** : Même si plusieurs acomptes franchissent le seuil en même temps, il NE DOIT exister qu'un bon de commande par campagne.
- **FR-013** : Le bon de commande NE DOIT JAMAIS être envoyé automatiquement au fournisseur ; il suit le circuit d'achat existant et s'approuve par une personne qui a le droit d'approuver les achats.
- **FR-014** : Le bon de commande d'une campagne NE DOIT PAS être approuvé pour une quantité inférieure à la quantité précommandée validée. L'acheteur peut ajuster le prix d'achat et augmenter la quantité.
- **FR-015** : Après le déclenchement, les inscriptions DOIVENT rester possibles jusqu'à la date limite, dans la limite de la quantité maximale, puis de la quantité commandée une fois le bon approuvé.

**Suivre l'arrivage**

- **FR-016** : Chaque étape enregistrée sur le bon de commande d'une campagne (commandé, acheté, en production, expédié, en transport, arrivé au port, dédouané, enlevé, livré, en stock) DOIT publier l'événement « étape d'arrivage » de la campagne et apparaître, avec sa date, sur le lien de suivi de chaque inscrit validé.
- **FR-017** : Le lien de suivi d'un inscrit DOIT montrer la campagne, la quantité, l'acompte payé, l'état de l'inscription, les étapes de l'arrivage et, après réception, le solde et sa date limite ; jamais le fournisseur, le prix d'achat ni le transitaire.

**Réception et solde**

- **FR-018** : À chaque réception du bon de commande, la quantité reçue DOIT être réservée aux inscriptions validées non encore servies, dans l'ordre de confirmation de leur acompte, chacune servie en entier ; le premier inscrit qui ne peut pas l'être en entier et les suivants attendent la réception suivante. Le reste est en vente normale.
- **FR-019** : Les pièces réservées à un inscrit NE DOIVENT être ni vendables (caisse, Marketplace, facture), ni transférables, jusqu'à la vente à cet inscrit ou la fin de sa réservation.
- **FR-020** : L'inscrit servi DOIT pouvoir choisir son mode de remise (retrait, livraison par zone, point relais, avec les frais du lot 1) et payer le solde par Orange Money ou MTN MoMo, avec les garanties du lot 2. Le paiement du solde à la livraison ou au comptoir n'est pas proposé au lot 3A.
- **FR-021** : Le solde DOIT égaler au franc près : total de l'inscription + frais de livraison − acompte. Le total de l'inscription est le prix annoncé pour la quantité, calculé et affiché à l'inscription comme sur une facture (avec TVA, il peut différer de quelques francs du prix unitaire multiplié par la quantité).
- **FR-022** : Sur paiement confirmé du solde, le système DOIT, en une seule opération indivisible : émettre la facture au nom de l'inscrit au prix annoncé avec les frais de livraison, y imputer l'acompte une seule fois, enregistrer le paiement du solde, lever la réservation et sortir le stock, créer le colis sauf pour un retrait, et passer l'inscription à « soldée ».
- **FR-023** : Le solde DOIT être payé dans le délai fixé par la campagne. À la fin de ce délai sans paiement, le système DOIT remettre les pièces en vente, passer l'inscription à « acompte conservé », publier l'événement correspondant et tracer l'opération ; un paiement du solde arrivé ensuite est « à rembourser ».
- **FR-024** : La campagne DOIT passer à « livrée » quand chaque inscription validée est soldée, remboursée ou à « acompte conservé ».

**Annulation et remboursements**

- **FR-025** : Le responsable DOIT pouvoir annuler une campagne, avec un motif, tant que l'arrivage n'est pas reçu.
- **FR-026** : Une campagne ouverte qui n'a pas atteint son seuil à la date limite DOIT être annulée d'office avec le motif « seuil non atteint ».
- **FR-027** : À l'annulation, chaque inscription validée DOIT passer « à rembourser » pour son acompte entier, les inscriptions en attente passer « annulée », l'événement d'annulation être publié et une tâche créée pour les titulaires du droit de trésorerie de GLOMARI, avec la liste : client, téléphone, montant, moyen et référence de l'opérateur.
- **FR-028** : Le responsable DOIT pouvoir annuler une inscription à la demande du client tant que la campagne n'est pas déclenchée ; elle passe « à rembourser ».
- **FR-029** : Le remboursement reste une opération humaine : le trésorier rembourse le client par l'opérateur, puis l'enregistre. L'enregistrement DOIT exiger le droit de trésorerie, sortir l'argent du portefeuille du moyen d'origine pour le montant exact de l'acompte, passer l'inscription à « remboursée » et être refusé s'il a déjà été fait.
- **FR-030** : L'annulation d'une campagne NE DOIT PAS annuler seule le bon de commande fournisseur : l'acheteur le traite dans les achats.

**Compter juste et contrôler**

- **FR-031** : Un acompte NE DOIT JAMAIS être compté deux fois : un seul encaissement par acompte ; tenu comme avance du client et non comme vente ; puis soit imputé une fois sur la facture finale, soit remboursé une fois, soit conservé une fois, jamais deux de ces issues.
- **FR-032** : Le personnel DOIT voir, pour chaque campagne : progression, nombre d'inscrits, total des acomptes encaissés, à rembourser et remboursés, bon de commande relié, et la liste des inscriptions avec leur état et leur rang.
- **FR-033** : Le trésorier DOIT retrouver les acomptes dans la liste des paiements en ligne par jour et par moyen, avec la référence de l'opérateur et l'inscription, et la liste des acomptes à rembourser.
- **FR-034** : Campagnes, inscriptions, acomptes, remboursements et tâches NE DOIVENT exister que dans la branche GLOMARI ; le personnel de GTA n'en voit rien ; le public ne voit que les campagnes de la boutique en ligne visée.
- **FR-035** : Les événements « inscription validée », « seuil atteint », « étape d'arrivage », « arrivage reçu », « acompte conservé » et « campagne annulée » DOIVENT être publiés pour la Marketplace et pour les messages du lot 4.
- **FR-036** : Les écritures comptables des acomptes, de leur imputation, de leur remboursement et des acomptes conservés DOIVENT être signalées comme à valider par l'expert-comptable ; le système ne remplace pas un expert agréé.

### Key Entities *(include if feature involves data)*

- **Campagne d'arrivage** : l'annonce d'un arrivage pour un article. Prix annoncé, acompte par pièce (montant ou pourcentage), seuil, quantité maximale facultative, date limite, délai de solde, fournisseur prévu, lieu de réception, texte, état (ouverte, déclenchée, annulée, livrée), motif d'annulation, bon de commande relié.
- **Inscription de précommande** : un client, une quantité, une campagne. Référence et lien de suivi, acompte dû, conditions acceptées, rang (ordre de confirmation de l'acompte), état (en attente de paiement, expirée, validée, servie, soldée, acompte conservé, à rembourser, remboursée, annulée), commande en ligne du solde.
- **Acompte** : le paiement en ligne (lot 2) de l'inscription, avec la référence de l'opérateur ; avance du client jusqu'à son imputation ou son remboursement.
- **Remboursement d'acompte** : la sortie d'argent enregistrée par le trésorier, une seule par inscription, avec le portefeuille et la date.
- **Bon de commande fournisseur** (existant) : créé en brouillon au seuil, approuvé dans les achats ; ses étapes et ses réceptions alimentent la campagne.
- **Commande en ligne, facture, colis, réservation de stock** (existants, lots 1 et 2) : servent au paiement du solde et à la livraison.
- **Tâche** (existante) : confiée au trésorier pour les remboursements et les encaissements à placer.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** : Une campagne complète va de l'annonce à la livraison des précommandes (inscriptions, acomptes, seuil, bon de commande, étapes, réception, soldes, colis) sans ressaisie : les seules actions humaines sont les décisions (créer, approuver, enregistrer les étapes et la réception, rembourser).
- **SC-002** : Quel que soit le nombre d'acomptes confirmés au même instant, une campagne n'a jamais plus d'un bon de commande.
- **SC-003** : Pour chaque campagne, la somme des acomptes encaissés égale, au franc près, la somme des acomptes imputés sur les factures, plus les acomptes remboursés, plus les acomptes conservés, plus les acomptes encore en attente d'issue.
- **SC-004** : Chaque facture de précommande égale le total annoncé à l'inscription + frais de livraison, et la somme de l'acompte et du solde égale cette facture, au franc près.
- **SC-005** : Après une annulation, 100 % des inscriptions validées sont « à rembourser » en moins d'une minute, chacune pour son acompte exact, avec une tâche au trésorier ; aucun remboursement ne s'enregistre deux fois.
- **SC-006** : Aucune pièce réservée à un inscrit n'est vendue à quelqu'un d'autre pendant sa réservation.
- **SC-007** : Une étape enregistrée sur le bon de commande apparaît en moins d'une minute sur le lien de suivi de chaque inscrit.
- **SC-008** : Un utilisateur de GTA voit zéro campagne, zéro inscription et zéro acompte.

## Assumptions

- L'article de la campagne existe déjà au catalogue de GLOMARI, même sans stock ; ses photos servent à l'annonce.
- Une campagne porte sur un seul article.
- Le délai de paiement d'une inscription est celui d'une commande en ligne Mobile Money (30 minutes).
- Le délai de paiement du solde est fixé par campagne, 7 jours par défaut.
- La conservation de l'acompte quand le solde n'est pas payé à temps est un choix d'Achille du 22 novembre 2026 ; la formulation des conditions présentées au client est à faire vérifier par un juriste avant l'ouverture au public.
- Les étapes de l'arrivage sont celles du bon de commande, déjà suivies dans les achats ; le dossier d'importation relié porte les frais, pas les étapes.
- Le bon de commande créé au seuil a pour auteur la personne qui a créé la campagne, qui doit avoir le droit de gérer les achats sur le lieu de réception ; la règle existante qui veut qu'un autre que l'auteur l'approuve s'applique.
- Le remboursement par l'opérateur se fait à la main, comme au lot 2 ; le remboursement automatique par le prestataire est hors lot.
- Les messages WhatsApp et SMS aux inscrits viennent au lot 4 ; au lot 3A, l'inscrit suit tout sur son lien.
- La page « Arrivages » de la Marketplace (W7) se construit dans le dépôt de la Marketplace, sur les routes publiques de ce lot.
- Hors lot 3A, prévus en partie B : acompte au fournisseur, prix d'achat en devise, dépôt-vente, coefficient d'importation au coût moyen, alerte de couverture de stock.
- L'écriture comptable des acomptes reste à valider par l'expert-comptable.
