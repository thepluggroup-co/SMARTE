# Feature Specification: Messages automatiques et avis publiés de GLOMARI (lot 4, partie A)

**Feature Branch**: `lot4a-messages-avis`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "lot 4" : lot 4 de la Fiche technique globale GLOMARI (section 9), partie A retenue : envoi de SMS et de messages WhatsApp avec un prestataire factice et un journal des envois (destinataire masqué, statut) ; envois automatiques désactivables par la direction (lien de suivi à la création du colis, « en route », « livré », étapes d'arrivage aux inscrits des précommandes, lien d'avis vérifié 14 jours après la livraison) ; avis validés publiés par produit pour la fiche produit de la Marketplace.

## Contexte

GLOMARI vend en rayon et en ligne, livre à Douala, à Yaoundé et dans les autres villes par agence de voyage ou point relais (règle R7), et ouvre des précommandes d'arrivage où le client doit être informé à chaque étape (règle R4). Le business plan prévoit aussi une relance de satisfaction environ deux semaines après l'achat et des avis publics (règle R9). Aujourd'hui, l'ERP crée les colis, leur lien de suivi et leur code de livraison, suit les précommandes et sait recueillir un avis vérifié par un lien, mais il n'envoie aucun message : le personnel doit appeler ou écrire à chaque client à la main, et les avis ne s'affichent nulle part sur la Marketplace.

Le lot 4 de la fiche compte six chantiers. Il est découpé en trois parties : A (cette spécification) pour les messages automatiques et les avis publiés ; B pour les comptes clients en ligne par code reçu par SMS ; C pour l'assistant GLOMARI Care et le studio des fiches produits. B et C s'appuieront sur l'envoi de messages construit ici.

## Clarifications

### Session 2026-11-23

- Q : Comment découper le lot 4 ? → R : En trois parties. A : messages SMS et WhatsApp automatiques (colis, précommandes, lien d'avis à 14 jours) avec un prestataire factice, et avis vérifiés publiés par produit. B : comptes clients en ligne par code SMS. C : assistant GLOMARI Care par IA et studio des fiches produits. On commence par A.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Le client suit sa livraison sans appeler (Priority: P1)

Madame Ngo commande un ventilateur sur la Marketplace, livré à Bonamoussadi. Dès que le colis est créé, elle reçoit un message avec le lien de suivi. Quand le livreur part, un second message lui donne le code à six chiffres qu'elle remettra au livreur. À la remise, un dernier message confirme la livraison. Monsieur Fotso, à Bafoussam, reçoit lui un message quand son colis est arrivé à l'agence de voyage, avec le code à donner pour le retirer.

**Why this priority**: C'est le message le plus attendu par un client qui achète à distance, et le code de livraison doit lui parvenir pour que la livraison soit prouvée. Sans ces messages, chaque colis demande des appels.

**Independent Test**: Créer un colis pour un client au téléphone connu, le faire passer en livraison puis le livrer : trois messages partent vers ce numéro (lien de suivi, code, confirmation), chacun une seule fois, et le journal les montre avec un numéro masqué.

**Acceptance Scenarios**:

1. **Given** une commande payée qui crée un colis pour un client au téléphone connu, **When** le colis est créé, **Then** un message avec le lien public de suivi part vers ce téléphone.
2. **Given** ce colis, **When** il passe « en livraison », **Then** un message part avec le code de confirmation à remettre au livreur et, pour un paiement à la livraison, le montant à préparer.
3. **Given** le colis d'une commande en ligne à retirer en agence de voyage ou en point relais, **When** il est marqué « arrivé », **Then** un message indique qu'il est prêt à retirer, avec le code à donner ; au passage « en livraison » qui suit, le code n'est pas renvoyé. Un colis livré à domicile qui passe par l'étape « arrivé » ne reçoit pas ce message.
4. **Given** ce colis, **When** il est livré, **Then** un message de confirmation part.
5. **Given** la même étape enregistrée deux fois, ou le même événement reçu deux fois, **When** les envois se font, **Then** le client ne reçoit qu'un seul message pour cette étape.
6. **Given** un colis sans téléphone ou avec un numéro invalide, **When** une étape arrive, **Then** rien n'est envoyé et le journal l'indique (« sans numéro »).

---

### User Story 2 - L'inscrit d'une précommande est informé à chaque étape (Priority: P1)

Awa a payé l'acompte d'un robot pâtissier en précommande. Elle reçoit la confirmation de son acompte, puis un message à chaque étape de l'arrivage (commandé au fabricant, expédié, arrivé au port, dédouané). À l'arrivée, un message lui indique le solde à payer et la date limite ; deux jours avant cette date, si elle n'a pas payé, un rappel part. Si la campagne avait été annulée, elle aurait reçu un message lui annonçant le remboursement de son acompte.

**Why this priority**: Le business plan fait de l'information à chaque étape une condition de la précommande (règle R4) ; sans message, un inscrit peut perdre son acompte faute d'avoir su que le solde était à payer.

**Independent Test**: Sur une campagne avec deux inscrits payés, enregistrer une étape d'arrivage puis la réception : chaque inscrit reçoit un message par étape et un message de solde à payer ; un inscrit déjà remboursé ne reçoit rien.

**Acceptance Scenarios**:

1. **Given** un acompte de précommande confirmé, **When** l'inscription est validée, **Then** l'inscrit reçoit un message avec la référence, la quantité et la date limite de la campagne.
2. **Given** une campagne avec des inscrits payés, **When** une étape d'arrivage est enregistrée sur le bon de commande, **Then** chaque inscrit encore concerné reçoit un message qui nomme l'étape.
3. **Given** la marchandise reçue et la place d'un inscrit servie, **When** sa précommande passe « solde à payer », **Then** il reçoit le montant du solde et la date limite.
4. **Given** un solde non payé deux jours avant la date limite, **When** le rappel est dû, **Then** un rappel part, une seule fois.
5. **Given** une campagne annulée, un seuil manqué ou une place non servie, **When** l'acompte passe « à rembourser », **Then** l'inscrit reçoit un message qui annonce le remboursement ; un acompte conservé après le délai donne aussi un message.
6. **Given** un message de précommande, **When** il est rédigé, **Then** il porte la référence de la précommande et jamais le lien secret de suivi.

---

### User Story 3 - Le client donne son avis deux semaines après la livraison (Priority: P2)

Quatorze jours après la livraison de sa commande, Madame Ngo reçoit un lien. Elle note chacun des deux articles reçus, de une à cinq étoiles, et laisse un commentaire sur le ventilateur. Le lien ne sert qu'une fois. Une note de une ou deux étoiles ouvre un ticket de suivi pour l'équipe Care, comme aujourd'hui.

**Why this priority**: La relance à deux semaines et les avis vérifiés sont prévus par le business plan (règle R9) ; ils nourrissent la fiche produit et alertent l'équipe Care des clients mécontents.

**Independent Test**: Livrer le colis d'une commande passée sur la Marketplace, puis simuler le quatorzième jour : un seul lien part ; l'ouvrir montre les articles de la commande ; noter les deux articles crée deux avis vérifiés, et un second envoi du formulaire est refusé.

**Acceptance Scenarios**:

1. **Given** un colis livré, issu d'une commande en ligne (payée par Mobile Money ou à la livraison) ou relié à la facture d'un client, **When** quatorze jours ont passé, **Then** le client reçoit un lien d'avis, une seule fois pour cette commande.
2. **Given** ce lien, **When** le client l'ouvre, **Then** il voit les articles de sa commande et peut noter chacun d'eux, avec un commentaire facultatif.
3. **Given** un avis donné, **When** le client rouvre le lien, **Then** il ne peut plus le modifier ni en donner un autre.
4. **Given** une note de une ou deux étoiles, **When** l'avis est enregistré, **Then** un ticket de suivi est ouvert pour l'équipe Care, et l'avis n'est pas masqué pour cette raison.
5. **Given** un client qui a demandé à ne pas être contacté, **When** le quatorzième jour arrive, **Then** aucun lien d'avis ne part.

---

### User Story 4 - Les avis vérifiés s'affichent sur la fiche produit (Priority: P2)

Sur la Marketplace, la fiche du ventilateur montre sa note moyenne, le nombre d'avis et les derniers commentaires, avec la mention « achat vérifié », le prénom et l'initiale du client, et la réponse de GLOMARI s'il y en a une. Un avis masqué par le marketing disparaît de la fiche.

**Why this priority**: Les avis publics font vendre en ligne (règle R9) et ne se montrent qu'à partir des avis vérifiés recueillis au parcours 3.

**Independent Test**: Avec trois avis publiés et un avis masqué sur un article, la page publique de l'article donne trois avis, leur moyenne et leur nombre ; le catalogue public montre la même moyenne ; aucun nom complet ni téléphone n'apparaît.

**Acceptance Scenarios**:

1. **Given** des avis publiés sur un article, **When** la Marketplace demande ses avis, **Then** elle reçoit la moyenne, le nombre et les avis du plus récent au plus ancien, par pages.
2. **Given** un avis masqué par le marketing, **When** la Marketplace redemande les avis, **Then** il n'y figure plus et ne compte plus dans la moyenne.
3. **Given** le catalogue public, **When** il est lu, **Then** chaque article montre sa note moyenne et son nombre d'avis publiés.
4. **Given** un avis publié, **When** il est affiché, **Then** on voit la note, le commentaire, la date, le prénom et l'initiale du nom, la mention d'achat vérifié et la réponse de GLOMARI, jamais le nom complet ni le téléphone.

---

### User Story 5 - La direction règle les envois et les surveille (Priority: P2)

La directrice de GLOMARI décide quels messages partent et par quel canal : SMS pour tout, sauf les étapes des précommandes envoyées par WhatsApp. Elle coupe le message « livré » pendant un essai. L'équipe Care consulte le journal des envois : ce qui est parti, ce qui attend la matinée, ce qui a échoué, avec le nombre de messages du mois par type et par canal, et renvoie un message en échec après avoir corrigé le numéro du client.

**Why this priority**: Chaque envoi coûte et engage l'image de GLOMARI ; la fiche demande que chacun soit désactivable par la direction, et un envoi raté doit se voir.

**Independent Test**: Désactiver un type de message, provoquer l'étape correspondante : rien ne part ; le réactiver : la suivante part. Simuler une panne du prestataire : le message est retenté, puis marqué en échec, et peut être renvoyé.

**Acceptance Scenarios**:

1. **Given** un type de message désactivé, **When** l'étape correspondante arrive, **Then** rien ne part pour ce type ; le réactiver ne renvoie pas les messages passés.
2. **Given** un type de message réglé sur WhatsApp, **When** il part, **Then** il passe par WhatsApp ; réglé sur SMS, par SMS.
3. **Given** un prestataire indisponible, **When** un envoi échoue, **Then** il est tenté au plus trois fois en une heure, puis marqué en échec dans le journal.
4. **Given** un message en échec, **When** une personne de l'équipe Care le renvoie, avec au besoin un numéro corrigé, **Then** il repart vers ce numéro, qui remplace l'ancien sur le colis, l'inscription ou la fiche client, et le journal garde les deux tentatives.
5. **Given** le journal, **When** il est consulté, **Then** il montre pour chaque message le type, le canal, le numéro masqué, l'objet lié, les dates et le statut, et le total du mois par type et par canal, sans aucun code ni numéro complet.
6. **Given** une personne de GTA, **When** elle cherche les réglages ou le journal de GLOMARI, **Then** elle n'y a pas accès.

---

### Edge Cases

- Un événement survient la nuit : le message attend 7 h (heure de Douala) et part à partir de là ; aucun message automatique ne part entre 21 h et 7 h.
- Le même événement arrive deux fois, ou une étape est enregistrée deux fois : un seul message par type et par objet.
- Le prestataire répond « échec » ou ne répond pas : nouvelle tentative, puis échec visible ; jamais d'envoi en double si une réponse tardive confirme le premier envoi.
- Un numéro est absent, trop court ou étranger au Cameroun : pas d'envoi, statut « sans numéro » ; l'équipe Care renvoie en saisissant le bon numéro.
- Un colis livré à domicile passe par l'étape « arrivé » (dépôt d'une autre ville) : aucun message « prêt à retirer » ; seul le passage « en livraison » envoie le code.
- Un type est désactivé entre l'étape et l'envoi : le message en attente n'est pas envoyé.
- Le colis échoue ou revient : aucun message automatique pour ces étapes dans cette partie ; l'équipe appelle le client.
- Une commande en retrait au magasin n'a pas de colis : pas de message de suivi ni de lien d'avis dans cette partie.
- Un colis saisi à la main sans facture ni commande en ligne : les messages de suivi partent vers son téléphone, mais aucun lien d'avis, faute d'achat vérifié.
- Un inscrit de précommande remboursé, annulé ou expiré ne reçoit plus les étapes d'arrivage.
- Un article noté devient inactif : ses avis restent enregistrés mais ne s'affichent plus dans le catalogue public.
- Un client a acheté deux fois le même article : chaque commande livrée donne son propre lien et son propre avis.
- Une organisation sans boutique en ligne ouverte : les messages des colis et des précommandes partent quand même si la direction les active ; les avis publics ne se lisent que pour une boutique ouverte.

## Requirements *(mandatory)*

### Functional Requirements

#### Envoi des messages

- **FR-001**: Le système MUST envoyer des SMS et des messages WhatsApp par un prestataire interchangeable. Tant que la direction n'a pas choisi le prestataire réel, seul un prestataire factice existe, pour l'essai privé avec des données fictives ; les tests ne font aucun appel réseau réel.
- **FR-002**: Chaque type de message automatique MUST pouvoir être activé ou désactivé séparément par la direction de la branche, et réglé sur un canal (SMS ou WhatsApp). Les types sont : colis créé (lien de suivi), colis en livraison (code), colis prêt au retrait (code), colis livré, acompte de précommande confirmé, étape d'arrivage, solde à payer, rappel du solde, acompte à rembourser, acompte conservé, demande d'avis après livraison, demande d'avis après achat en magasin.
- **FR-003**: Le système MUST n'envoyer qu'un message par type et par objet (colis, inscription, commande), même si l'événement ou l'étape se répète.
- **FR-004**: Les messages automatiques MUST partir seulement entre 7 h et 21 h (heure de Douala) ; un message dû en dehors de ces heures attend 7 h.
- **FR-005**: Un envoi qui échoue MUST être tenté au plus trois fois en une heure (le premier essai compris), puis marqué en échec ; une personne de l'équipe Care MUST pouvoir renvoyer un message en échec ou « sans numéro ». En renvoyant, elle peut saisir un numéro corrigé : il remplace le téléphone du colis, de l'inscription ou de la fiche client selon le message, et la correction est notée au journal.
- **FR-006**: Le système MUST tenir un journal des envois : type, canal, numéro masqué (seuls les deux derniers chiffres lisibles), objet lié, date de création, date d'envoi, nombre de tentatives, statut (en attente, en cours, envoyé, échec, sans numéro, annulé : type coupé, client « ne pas contacter » ou message devenu sans objet). Le journal ne MUST garder ni le numéro complet ni aucun code de livraison.
- **FR-007**: Le journal et le total du mois par type et par canal MUST être visibles par la direction et l'équipe Care de la branche, et par elles seules.
- **FR-008**: Un numéro absent ou qui n'est pas un numéro camerounais valide MUST empêcher l'envoi, avec le statut « sans numéro ».
- **FR-009**: Un client marqué « ne souhaite pas être contacté » MUST ne recevoir aucune demande d'avis ; les messages liés à sa commande ou à son acompte (suivi, code, solde, remboursement) restent envoyés. Le personnel qui gère les clients MUST pouvoir poser et retirer cette marque.
- **FR-010**: Les textes des messages MUST être courts, en français, et porter le nom de GLOMARI ; ils ne contiennent jamais de lien secret de suivi de commande ou de précommande.

#### Colis

- **FR-011**: À la création d'un colis, le système MUST envoyer au téléphone du colis un message avec son lien public de suivi.
- **FR-012**: Quand le colis passe « en livraison », le système MUST envoyer le code de confirmation à remettre au livreur et, pour un paiement à la livraison, le montant à préparer, sauf si le code a déjà été donné par le message « prêt à retirer ».
- **FR-013**: Quand le colis d'une commande en ligne à retirer en agence de voyage ou en point relais est marqué « arrivé », le système MUST envoyer un message « prêt à retirer » avec le code à donner au retrait et, s'il y a lieu, le montant à payer. Pour les autres colis, l'étape « arrivé » n'envoie rien.
- **FR-014**: À la livraison, le système MUST envoyer un message de confirmation.

#### Précommandes

- **FR-015**: À la validation d'un acompte de précommande, le système MUST envoyer à l'inscrit un message avec la référence, la quantité et la date limite de la campagne.
- **FR-016**: À chaque étape d'arrivage enregistrée, le système MUST envoyer un message à chaque inscrit dont l'acompte est validé et qui n'est ni remboursé, ni annulé, ni à rembourser.
- **FR-017**: Quand la place d'un inscrit est servie à la réception, le système MUST lui envoyer le montant du solde et sa date limite, avec l'invitation à payer sur la Marketplace par sa référence.
- **FR-018**: Deux jours avant la date limite du solde, si le solde n'est pas payé, le système MUST envoyer un rappel, une seule fois.
- **FR-019**: Quand un acompte passe « à rembourser » (campagne annulée, seuil manqué, place non servie), le système MUST l'annoncer à l'inscrit ; quand un acompte est conservé après le délai du solde, le système MUST l'en informer.

#### Avis

- **FR-020**: Quatorze jours après la livraison d'un colis, le système MUST envoyer au client un lien d'avis, une seule fois pour cette commande, quand le colis vient d'une commande en ligne (payée par Mobile Money ou à la livraison) ou qu'il est relié à la facture d'un client. Le délai de quatorze jours est fixé dans le code.
- **FR-021**: Le système MUST pouvoir envoyer de même un lien d'avis quatorze jours après une vente de caisse à un client identifié par son téléphone ; ce type est désactivé tant que la direction ne l'active pas.
- **FR-022**: Le lien d'avis MUST montrer les articles de la commande et permettre de noter chacun d'eux de une à cinq étoiles, avec un commentaire facultatif ; il ne sert qu'une fois.
- **FR-023**: Chaque article noté MUST donner un avis vérifié rattaché à cet article. La modération actuelle s'applique : avis publié sauf contenu à vérifier, masquage avec motif et réponse par le marketing, ticket de suivi ouvert pour l'équipe Care sur une note de une ou deux étoiles, jamais de masquage pour une note basse.
- **FR-024**: Le système MUST offrir à la Marketplace, sans connexion, les avis publiés d'un article de la boutique ouverte : note moyenne, nombre d'avis, et les avis du plus récent au plus ancien, par pages (note, commentaire, date, prénom et initiale du nom, mention d'achat vérifié, réponse de GLOMARI). Aucun nom complet, téléphone ni référence de commande n'y figure.
- **FR-025**: Le catalogue public MUST montrer pour chaque article sa note moyenne et son nombre d'avis publiés.
- **FR-026**: Les avis des formations de GTA MUST rester séparés et inchangés ; aucune donnée de GTA n'entre dans les messages ni dans les avis publics de GLOMARI.

#### Droits

- **FR-027**: Régler les types de messages MUST demander le droit d'administration de la boutique en ligne de la branche ; consulter le journal, le droit de voir GLOMARI Care ou ce même droit d'administration ; renvoyer un message, le droit de gérer GLOMARI Care. Tout droit se vérifie côté serveur, sur la branche concernée.

### Key Entities *(include if feature involves data)*

- **Réglage d'envoi** : pour une branche et un type de message, activé ou non, et le canal (SMS ou WhatsApp).
- **Message** : un envoi pour un type et un objet (colis, inscription, commande) ; canal, numéro masqué, statut, dates, tentatives ; unique par type et objet.
- **Demande d'avis** : le lien à usage unique envoyé au client après une livraison ou un achat en magasin ; existe déjà, elle porte désormais la liste des articles de la commande.
- **Avis produit** : la note et le commentaire d'un client sur un article, rattachés à la demande d'avis (achat vérifié) ; statut de modération et réponse de GLOMARI.
- **Marque « ne pas contacter »** : sur la fiche client, elle arrête les demandes d'avis.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Pendant les heures d'envoi, 95 % des messages automatiques partent dans les 5 minutes qui suivent l'étape qui les déclenche.
- **SC-002**: Sur la recette, aucun client ne reçoit deux fois le même message pour la même étape (zéro doublon).
- **SC-003**: Tous les colis livrés issus d'une commande en ligne ou reliés à la facture d'un client donnent une demande d'avis le quatorzième jour, sauf pour les clients qui ont demandé à ne pas être contactés.
- **SC-004**: Le journal ne laisse lire aucun numéro de téléphone complet ni aucun code de livraison.
- **SC-005**: Un avis publié ou masqué est reflété sur la fiche produit publique dès la lecture suivante.
- **SC-006**: Désactiver un type de message arrête tout nouvel envoi de ce type dès la minute suivante.
- **SC-007**: Les inscrits d'une précommande reçoivent un message pour 100 % des étapes d'arrivage enregistrées tant qu'ils sont concernés.
- **SC-008**: Une personne de GTA n'accède à aucun réglage, message ni avis de GLOMARI.

## Assumptions

- Le prestataire de SMS et de WhatsApp n'est pas encore choisi (section 14 de la fiche : « les deux, désactivables ») ; seul un prestataire factice existe, comme pour le paiement du lot 2. Le prestataire réel se branchera ensuite sans toucher au reste ; ses identifiants iront dans la configuration du serveur, jamais dans le dépôt.
- Avec un vrai prestataire WhatsApp, les modèles de messages devront être approuvés à l'avance ; les textes sont donc fixés dans le code et ne se modifient pas depuis l'écran dans cette partie.
- Le canal par défaut de chaque type est le SMS, qui fonctionne sur tous les téléphones ; tous les types sont activés par défaut, sauf la demande d'avis après achat en magasin.
- Les messages sont en français ; une version anglaise viendra plus tard.
- Les heures d'envoi (7 h à 21 h), les trois tentatives en une heure, le délai de quatorze jours et le rappel deux jours avant la fin du solde sont fixés dans le code, comme les autres seuils du projet.
- Le coût des envois n'est pas compté en FCFA ; le journal donne le nombre de messages par type et par canal, que la direction rapproche de la facture du prestataire.
- Les messages partent depuis l'ERP ; la Marketplace n'envoie rien elle-même.
- Le téléphone utilisé est celui du colis pour les messages de suivi, celui donné à l'inscription pour les précommandes, et celui de la fiche client pour les avis.
- Les comptes clients en ligne (partie B), l'assistant GLOMARI Care et le studio des fiches produits (partie C), les messages d'échec ou de retour d'un colis, et les messages des commandes en retrait au magasin sont hors de cette partie.
- Le lien d'avis et la page publique d'avis existants servent de base ; la page d'avis s'adapte pour noter chaque article d'une commande.
- La modération actuelle des avis est conservée : un avis est publié aussitôt, sauf contenu à vérifier, et le marketing peut le masquer avec un motif ; « avis validés » de la fiche désigne les avis publiés.
- Les données des messages relèvent des règles de confidentialité de l'entreprise ; aucun texte de message contenant un code n'est conservé en clair.
