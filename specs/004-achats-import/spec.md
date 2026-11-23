# Feature Specification: Achats à l'import de GLOMARI (lot 3, partie B)

**Feature Branch**: `lot3b-achats-import`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "lot 3B" : partie B du lot 3 de la Fiche technique globale GLOMARI (section 9) : acompte au fournisseur avant sa facture, imputé ensuite sur la facture fournisseur ; prix d'achat en devise (USD, CNY, EUR) avec la table des taux existante, montants stockés en FCFA entiers ; dépôt-vente (stock confié par un fournisseur local, suivi à part, payé au fournisseur à la vente) ; option, désactivée par défaut, pour appliquer le coefficient d'importation au coût moyen à la réception ; alerte quand la couverture de stock d'une catégorie dépasse 60 jours (règle R11).

## Contexte

GLOMARI importe l'essentiel de ses articles de fabricants chinois, qui sont payés d'avance, sans crédit (règle R5) : un acompte à la commande, le solde à l'expédition. Aujourd'hui, l'ERP ne sait payer un fournisseur qu'une fois sa facture validée, et les prix d'achat ne s'écrivent qu'en FCFA : les acomptes et les achats en yuans ou en dollars se suivent hors de l'ERP. GLOMARI veut aussi vendre des produits de fournisseurs locaux (Made in Cameroun) en dépôt-vente, sans les acheter d'avance. Enfin, le stock est plafonné à deux mois de ventes (règle R11) : il faut être averti quand une catégorie dépasse 60 jours de couverture.

La partie A du lot 3 (précommandes) est livrée ; cette partie B complète le côté achats.

## Clarifications

### Session 2026-11-23

- Q : Dépôt-vente, comment le fournisseur est-il rémunéré ? → R : Au choix pour chaque article : un prix de reversement fixe par pièce vendue, ou une commission en pourcentage du prix de vente.
- Q : Que doit faire l'option « coefficient d'importation au coût moyen » de la fiche ? → R : Rien de plus : les frais saisis sur le bon de commande (fret, transit, dédouanement) entrent déjà dans le coût du stock à la réception ; le dossier d'importation reste un tableau de suivi. Aucune option n'est ajoutée.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Payer le fabricant d'avance, puis imputer l'acompte sur sa facture (Priority: P1)

L'acheteur passe une commande de 2 000 robots à un fabricant de Shenzhen, approuvée. Le trésorier verse un acompte de 30 % par virement depuis le compte bancaire de GLOMARI, puis le solde à l'expédition. Quand la facture du fabricant arrive et est validée en comptabilité, les deux versements s'y imputent seuls : la facture est soldée, sans que personne ne repaie ni ne ressaisisse.

**Why this priority**: C'est la règle R5 et la façon réelle dont GLOMARI achète. Sans elle, les sorties d'argent les plus importantes de l'entreprise se suivent hors de l'ERP.

**Independent Test**: Sur un bon de commande approuvé de 10 000 000 FCFA, verser un acompte de 3 000 000 puis de 7 000 000 : le portefeuille baisse de 10 000 000, le bon de commande affiche 10 000 000 versés ; valider une facture de 10 000 000 reliée à ce bon : elle est soldée, rien ne reste à payer, et les acomptes sont imputés une seule fois.

**Acceptance Scenarios**:

1. **Given** un bon de commande approuvé, **When** le trésorier enregistre un acompte de 3 000 000 FCFA depuis un portefeuille de la branche, **Then** l'argent sort de ce portefeuille, l'acompte apparaît sur le bon de commande avec la date et la référence du virement.
2. **Given** ce même bon, **When** une personne sans droit de trésorerie tente d'enregistrer un acompte, **Then** c'est refusé.
3. **Given** des acomptes de 10 000 000 FCFA sur un bon de commande, **When** une facture de 10 000 000 FCFA reliée à ce bon est validée, **Then** les acomptes s'imputent sur la facture, qui ne laisse plus rien à payer.
4. **Given** des acomptes de 4 000 000 FCFA et une première facture de 2 500 000 FCFA, **When** la facture est validée, **Then** 2 500 000 s'imputent ; les 1 500 000 restants restent disponibles pour la facture suivante du même bon.
5. **Given** un acompte qui dépasserait le total de la commande, **When** il est saisi, **Then** il est refusé.

---

### User Story 2 - Commander en devise, compter en FCFA (Priority: P1)

L'acheteur commande en yuans : 2 000 robots à 210 CNY. L'ERP prend le taux du yuan enregistré pour le jour de la commande, calcule et garde chaque montant en FCFA, et montre les deux. À l'approbation, le taux est figé : le coût du stock à l'arrivée, les marges et les acomptes se comptent en FCFA, au même taux.

**Why this priority**: Les fabricants facturent en yuans ou en dollars. Sans conversion tracée, le coût de revient, la marge et le budget de la ligne de campagne sont faux ou faits au tableur.

**Independent Test**: Avec un taux du yuan enregistré à 85,1234 FCFA pour le jour, une commande de 2 000 pièces à 210 CNY donne 35 751 828 FCFA (au franc près), affiche aussi 420 000 CNY et le taux, et garde ces montants après un nouveau taux enregistré le lendemain.

**Acceptance Scenarios**:

1. **Given** un taux du yuan enregistré pour le jour de la commande, **When** l'acheteur saisit des prix en CNY, **Then** chaque ligne montre le prix en CNY et en FCFA, et la commande son total dans les deux, avec le taux et sa date.
2. **Given** aucun taux enregistré pour cette devise à cette date ni avant, **When** l'acheteur saisit la commande, **Then** c'est refusé avec un message qui demande d'enregistrer le taux.
3. **Given** une commande approuvée en CNY, **When** un nouveau taux est enregistré, **Then** les montants de la commande ne changent pas.
4. **Given** cette commande reçue, **When** le stock entre, **Then** son coût est calculé en FCFA au taux figé, frais compris comme aujourd'hui.

---

### User Story 3 - Vendre en dépôt-vente les produits d'un fournisseur local (Priority: P2)

Une coopérative de Bafoussam confie à GLOMARI 200 pots de miel. GLOMARI ne les achète pas : elle les vend au Mall et en ligne, et reverse à la coopérative, pour chaque pot vendu, soit un prix convenu, soit le prix de vente moins sa commission, selon ce qui a été réglé pour l'article. Chaque fin de mois, l'ERP établit le relevé des pots vendus et le montant dû ; ce relevé devient une facture du fournisseur, payée par le circuit habituel. Les pots invendus repartent chez la coopérative.

**Why this priority**: Élargit l'offre (Made in Cameroun) sans immobiliser de trésorerie, mais n'est pas indispensable à l'import. Vient après les acomptes et les devises.

**Independent Test**: Déclarer un article en dépôt-vente à 3 000 FCFA par pièce, y entrer 200 pièces, en vendre 30 en caisse et 5 en ligne, en reprendre 2 en retour de caisse : le relevé de la période donne 33 pièces et 99 000 FCFA dus ; la valeur du stock de GLOMARI n'inclut pas ces pièces ; le relevé ne peut pas être facturé deux fois. Un autre article à 25 % de commission, vendu 10 000 FCFA hors taxes, donne 7 500 FCFA dus par pièce.

**Acceptance Scenarios**:

1. **Given** un article déclaré en dépôt-vente d'un fournisseur de la branche, **When** le magasinier enregistre l'arrivée de 200 pièces confiées, **Then** elles sont vendables, mais n'entrent ni dans la valeur du stock de GLOMARI ni dans son coût moyen.
2. **Given** ces pièces, **When** elles se vendent en caisse, par facture ou sur la Marketplace, **Then** chaque vente fait naître un montant dû au fournisseur, et un retour de caisse le diminue.
3. **Given** des ventes sur le mois, **When** le responsable établit le relevé du fournisseur, **Then** le relevé liste les ventes et retours de la période, le montant dû, et devient une facture du fournisseur en brouillon, à valider et payer par le circuit existant ; une vente n'entre que dans un seul relevé.
4. **Given** des pièces invendues, **When** elles repartent chez le fournisseur, **Then** elles sortent du stock sans montant dû.

---

### User Story 4 - Être averti quand une catégorie dépasse deux mois de stock (Priority: P2)

Chaque matin, l'acheteur et le responsable des stocks voient les catégories dont le stock couvre plus de 60 jours de ventes. Avant d'approuver un nouveau bon de commande, l'ERP les avertit si la commande ferait dépasser ce plafond.

**Why this priority**: Applique la règle R11 (stock plafonné à deux mois), qui protège la trésorerie, mais n'empêche aucune opération. Vient après les flux d'argent.

**Independent Test**: Une catégorie avec 300 pièces en stock et 120 pièces vendues sur les 90 derniers jours (couverture de 225 jours) apparaît dans l'alerte du lendemain ; ses responsables reçoivent une seule notification ; à l'approbation d'un bon de commande de cette catégorie, un avertissement s'affiche sans bloquer.

**Acceptance Scenarios**:

1. **Given** une catégorie dont la couverture dépasse 60 jours, **When** le calcul quotidien passe, **Then** elle apparaît dans la liste des alertes avec sa couverture en jours, et les titulaires du droit de gérer les achats ou de valider les stocks de la branche reçoivent une notification.
2. **Given** la même catégorie le lendemain, toujours au-dessus, **When** le calcul passe, **Then** aucune nouvelle notification n'est envoyée ; elle en recevra une si elle repasse sous le plafond puis le dépasse de nouveau.
3. **Given** un bon de commande dont les articles feraient dépasser 60 jours à leur catégorie, **When** l'acheteur l'approuve, **Then** il voit un avertissement avec la couverture prévue, et l'approbation reste possible.

---

### Edge Cases

- Un acompte est saisi sur un bon de commande encore en brouillon ou annulé : refusé.
- Le fournisseur rembourse un acompte (commande abandonnée) : l'acompte est annulé, l'argent revient dans le portefeuille ; un acompte déjà imputé ne s'annule plus.
- Un bon de commande qui porte un acompte non imputé ne s'annule pas : l'acompte doit d'abord être remboursé ou imputé.
- La facture du fournisseur est annulée après imputation : les acomptes imputés redeviennent disponibles.
- Le portefeuille n'a pas assez d'argent pour l'acompte : refusé.
- Un acompte est versé en devise par virement : le montant en FCFA effectivement débité fait foi ; le montant en devise et le taux sont gardés pour information.
- Taux de change enregistré le jour même après la commande : la commande garde le taux qu'elle avait au moment où elle a été établie ; tant qu'elle est en brouillon, une modification des lignes reprend le taux du jour de la commande.
- Facture en devise différente du taux de la commande : l'écart de change est signalé à l'expert-comptable ; l'ERP ne le passe pas seul.
- Un article en dépôt-vente ne peut pas figurer sur un bon de commande, et un article acheté ne peut pas passer en dépôt-vente tant qu'il a du stock acheté.
- Une vente en dépôt-vente est annulée en caisse : le montant dû disparaît du relevé ouvert.
- Un article à commission vendu avec une remise ou en promotion : la commission se calcule sur le prix réellement encaissé, hors taxes.
- La rémunération d'un article en dépôt-vente change : les ventes déjà faites gardent la rémunération en vigueur au jour de la vente.
- Une catégorie sans aucune vente sur 90 jours mais avec du stock : couverture infinie, donc alerte (stock dormant).
- Une catégorie sans stock : pas d'alerte.
- Une branche sans module de stock (GTA) : rien de tout cela n'existe.

## Requirements *(mandatory)*

### Functional Requirements

**Acompte au fournisseur**

- **FR-001** : Une personne qui a le droit de trésorerie sur la branche DOIT pouvoir enregistrer un acompte versé au fournisseur d'un bon de commande approuvé ou reçu en partie, avant toute facture : montant en FCFA, portefeuille de la branche, date, référence du virement, et pour information un montant en devise avec son taux.
- **FR-002** : L'acompte DOIT sortir l'argent du portefeuille choisi, jamais au-delà de son solde. Toute sortie d'argent exige le droit de trésorerie, y compris le paiement d'une facture fournisseur par le circuit existant (reste après acomptes, relevé de dépôt-vente).
- **FR-003** : Plusieurs acomptes DOIVENT être possibles sur un même bon ; leur total NE DOIT PAS dépasser le total de la commande.
- **FR-004** : Le bon de commande DOIT montrer les acomptes versés, imputés et encore disponibles.
- **FR-005** : À la validation d'une facture du fournisseur reliée au bon de commande, les acomptes disponibles DOIVENT s'imputer d'eux-mêmes, dans l'ordre de versement, jusqu'au total de la facture ; le reste à payer de la facture en tient compte ; un acompte n'est jamais imputé deux fois ; ce qui dépasse reste disponible pour une facture suivante du même bon.
- **FR-006** : Un acompte non imputé DOIT pouvoir être annulé avec un motif quand le fournisseur le rembourse : l'argent revient dans le portefeuille. Un acompte imputé NE DOIT PLUS s'annuler. L'annulation d'une facture rend disponibles les acomptes qui y étaient imputés.
- **FR-007** : Un bon de commande qui porte un acompte non imputé NE DOIT PAS s'annuler.
- **FR-008** : Les acomptes fournisseurs NE DOIVENT PAS compter comme dépenses dans le tableau de bord de GLOMARI, puisque la commande compte déjà dans les achats (même règle que le paiement d'une facture reliée à une commande).

**Achats en devise**

- **FR-009** : Un bon de commande DOIT pouvoir être établi en USD, CNY ou EUR : prix unitaires saisis dans la devise, convertis au taux enregistré pour la devise au jour de la commande (le plus récent à ce jour ou avant), et gardés en FCFA entiers ; la devise, le taux, sa date et les montants en devise restent affichés.
- **FR-010** : Sans taux enregistré pour cette devise à cette date ou avant, la saisie DOIT être refusée avec un message clair.
- **FR-011** : Le taux DOIT être figé à l'approbation du bon de commande ; tant qu'il est en brouillon, une modification des lignes ou de la date reprend le taux applicable.
- **FR-012** : Le coût du stock à la réception, les contrôles de prix et de marge et le total de la commande DOIVENT se calculer en FCFA, au taux figé.
- **FR-013** : Un écart entre le montant en FCFA de la facture du fournisseur et celui de la commande DOIT rester visible (contrôle existant entre commande, réception et facture) ; l'ERP ne passe pas seul d'écriture de différence de change.

**Dépôt-vente**

- **FR-014** : Un article DOIT pouvoir être déclaré en dépôt-vente d'un fournisseur de la branche, avec sa rémunération, au choix pour chaque article : un prix de reversement fixe par pièce vendue, ou une commission en pourcentage gardée par GLOMARI sur le prix de vente hors taxes réellement encaissé. La rémunération d'une vente est celle en vigueur au jour de la vente.
- **FR-015** : L'arrivée de pièces confiées DOIT les rendre vendables dans le lieu, sans les faire entrer dans la valeur du stock de GLOMARI ni dans son coût moyen ; le stock en dépôt-vente se voit à part.
- **FR-016** : Chaque vente d'un article en dépôt-vente, en caisse, par facture ou sur la Marketplace, DOIT faire naître un montant dû au fournisseur ; un retour ou une annulation de vente le diminue.
- **FR-017** : Le responsable DOIT pouvoir établir le relevé d'un fournisseur jusqu'à une date de fin : toutes les ventes et tous les retours non encore relevés jusqu'à cette date, et le montant dû. La date de début est indicative ; les ventes plus anciennes jamais relevées sont signalées et incluses, pour que rien ne soit oublié. Le relevé DOIT créer une facture du fournisseur en brouillon, validée et payée par le circuit existant ; une vente n'entre que dans un seul relevé.
- **FR-018** : Les pièces invendues DOIVENT pouvoir être rendues au fournisseur : elles sortent du stock sans montant dû.
- **FR-019** : Un article en dépôt-vente NE DOIT PAS figurer sur un bon de commande ; un article qui a du stock acheté NE DOIT PAS passer en dépôt-vente.
- **FR-020** : La marge d'un article en dépôt-vente DOIT se calculer sur ce que GLOMARI reverse au fournisseur, pas sur un coût moyen.

**Couverture de stock (règle R11)**

- **FR-021** : Chaque jour, l'ERP DOIT calculer, pour chaque catégorie d'articles de GLOMARI (la catégorie de l'article, sous-catégorie comprise, sans regroupement par catégorie mère), la couverture en jours : quantité en stock dans les lieux de la branche, hors dépôt-vente, divisée par les ventes moyennes par jour des 90 derniers jours (caisse, factures, Marketplace).
- **FR-022** : Une catégorie au-delà de 60 jours, ou avec du stock et aucune vente sur 90 jours, DOIT apparaître dans la liste des alertes, avec sa couverture.
- **FR-023** : Les titulaires du droit de gérer les achats ou de valider les stocks de la branche DOIVENT recevoir une notification dans l'ERP quand une catégorie franchit le plafond, une seule fois tant qu'elle reste au-dessus.
- **FR-024** : À l'approbation d'un bon de commande, l'acheteur DOIT voir un avertissement, sans blocage, si la commande ferait dépasser 60 jours de couverture à une catégorie.

**Séparation et contrôle**

- **FR-025** : Le coût du stock à la réception DOIT rester calculé comme aujourd'hui, frais du bon de commande compris ; aucune option d'application du coefficient du dossier d'importation n'est ajoutée (décision du 23 novembre 2026).
- **FR-026** : Acomptes, achats en devise, dépôt-vente et alertes de couverture NE DOIVENT exister que pour une branche qui gère du stock (GLOMARI) ; le personnel de GTA n'en voit rien.
- **FR-027** : Les écritures comptables des acomptes, de leur imputation, des achats en devise et du dépôt-vente DOIVENT être proposées comme les autres, et signalées comme à valider par l'expert-comptable ; le système ne remplace pas un expert agréé.

### Key Entities *(include if feature involves data)*

- **Acompte fournisseur** : un versement au fournisseur sur un bon de commande, avant facture. Montant en FCFA, portefeuille, date, référence, montant et devise d'information, état (versé, imputé en tout ou en partie, annulé), motif d'annulation.
- **Imputation d'acompte** : la part d'un acompte déduite d'une facture du fournisseur ; une imputation par couple acompte et facture.
- **Bon de commande** (existant) : gagne une devise, un taux et sa date, figés à l'approbation ; ses lignes gardent le prix en devise et en FCFA.
- **Taux de change** (existant) : le taux d'une devise pour un jour.
- **Article en dépôt-vente** : l'article, le fournisseur qui le confie, sa rémunération (prix fixe par pièce ou commission en pourcentage), avec la date à partir de laquelle elle vaut.
- **Relevé de dépôt-vente** : un fournisseur, une période, les ventes et retours retenus, le montant dû, la facture du fournisseur qui en résulte.
- **Alerte de couverture** : une catégorie, sa couverture en jours, la date du calcul, l'état de notification.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** : Pour tout bon de commande payé d'avance puis facturé, le reste à payer égale au franc près le total des factures moins les acomptes imputés, et aucun acompte n'est imputé deux fois.
- **SC-002** : Une commande en devise donne, pour chaque ligne, un montant en FCFA égal à la quantité × le prix en devise × le taux du jour, arrondi au franc, et ce montant ne change plus après l'approbation.
- **SC-003** : Le relevé de dépôt-vente d'une période égale au franc près la rémunération due sur les ventes moins les retours ; chaque vente apparaît dans un seul relevé.
- **SC-004** : Une catégorie qui dépasse 60 jours de couverture apparaît dans l'alerte dans les 24 heures, et ses responsables ne reçoivent qu'une notification tant qu'elle reste au-dessus.
- **SC-005** : Aucune sortie d'argent vers un fournisseur ne s'enregistre sans le droit de trésorerie.
- **SC-006** : Un utilisateur de GTA voit zéro acompte, zéro dépôt-vente et zéro alerte de couverture.

## Assumptions

- Les taux de change sont saisis par la comptabilité dans l'écran existant des devises ; l'ERP ne va pas les chercher sur internet.
- Un acompte se verse sur une commande approuvée ou reçue en partie ; une commande reçue en entier se paie par sa facture.
- Payer une facture fournisseur exige désormais le droit de trésorerie (règle du projet) : une personne qui n'a que les droits de comptabilité ne peut plus payer.
- Les trois devises demandées par la fiche sont USD, CNY et EUR ; d'autres se déclareront de la même façon plus tard.
- Le montant en FCFA effectivement débité du compte fait foi pour un acompte ; le montant en devise est une information.
- Les différences de change entre la commande, les acomptes et la facture sont signalées et laissées à l'expert-comptable.
- Le relevé de dépôt-vente s'établit à la demande, en général chaque mois ; il n'y a pas de paiement automatique au fournisseur.
- Le seuil de 60 jours et la période de 90 jours de ventes sont fixés dans le code, comme le seuil de marge faible (20 %) ; ils pourront devenir des réglages.
- Les notifications sont celles de l'ERP (sans e-mail ni SMS) ; WhatsApp et SMS viendront au lot 4.
- Le compte d'avances fournisseurs (4091) et les comptes du dépôt-vente sont à confirmer par l'expert-comptable.
- Les précommandes (partie A) sont livrées ; leur seuil n'alimente pas encore les suggestions de réapprovisionnement.
- L'option « coefficient d'importation au coût moyen » de la fiche n'est pas construite : le besoin est couvert par les frais du bon de commande, déjà inclus dans le coût à la réception (choix d'Achille du 23 novembre 2026).
