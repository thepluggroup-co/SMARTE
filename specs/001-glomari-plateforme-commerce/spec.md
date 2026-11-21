# Feature Specification: Plateforme Numérique Unifiée GLOMARI

**Feature Branch**: `001-glomari-plateforme-commerce`

**Created**: 2026-11-20

**Status**: Draft

## Contexte et objectif

GLOMARI (Global Market International) est la branche commerce du groupe Smart Global Concepts (SGC) à Douala. Elle vend de l'électroménager, des gadgets électroniques, des meubles et des articles de bien-être.

La promesse centrale est **« un seul stock, en rayon et en ligne »** : le même article, au même prix, vendu au GLOMARI Mall (supermarché-entrepôt à Douala, agence à Yaoundé) et sur la boutique en ligne. Sans système unique, les prix et les stocks divergent entre le magasin et le web, les ruptures se multiplient et la confiance des clients — premier frein à l'achat en ligne au Cameroun — s'effondre.

Le business plan 2027–2031 cible 1 629 M FCFA de chiffre d'affaires en 2027 et 6 697 M en 2031, avec 7 200 puis 26 400 clients actifs.

**Ce système couvre trois parties qui partagent les mêmes données :**
1. **L'ERP SMARTE** (existant, à compléter) — articles, prix, stock, achats, caisse, facturation, livraison, service client, trésorerie, comptabilité, RH, pilotage.
2. **Le site web GLOMARI** — vitrine institutionnelle, recrutement de partenaires, offres d'emploi.
3. **GLOMARI Marketplace** — boutique en ligne, d'abord sur le web, puis sur Android et iOS.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Commande en ligne, paiement Mobile Money (Priority: P1)

Un client particulier consulte le catalogue GLOMARI Marketplace depuis son téléphone. Il voit le stock disponible au Mall de Douala et à Yaoundé, ajoute un article à son panier, choisit la livraison à domicile à Douala, paie par Orange Money, et reçoit une confirmation. L'article est réservé dès la validation de la commande (le panier ne réserve rien) et la commande est clôturée automatiquement quand Orange Money confirme le paiement. La facture, la sortie de stock et le colis sont créés sans aucune saisie manuelle. Si le paiement n'est pas reçu dans le délai fixé, le stock est libéré.

**Pourquoi cette priorité** : C'est le cœur de la promesse GLOMARI — « un seul stock, en rayon et en ligne ». Sans ce parcours, la Marketplace n'existe pas.

**Test indépendant** : Un client peut passer une commande complète en ligne (du catalogue au paiement confirmé) et voir sa commande apparaître dans l'ERP avec le stock correctement décompté, sans aucune action humaine entre le paiement et la création du colis.

**Acceptance Scenarios** :

1. **Étant donné** que l'article X a 3 unités disponibles au Mall de Douala, **quand** un client le commande et paie par Orange Money, **alors** le stock passe à 2, une facture est émise, un colis est créé et le client reçoit une confirmation avec un lien de suivi.
2. **Étant donné** qu'un client a commandé l'article Y (1 unité restante) sans avoir encore payé, **quand** un autre client essaie de commander ce même article, **alors** le deuxième client est informé que l'article est temporairement indisponible.
3. **Étant donné** qu'un client a passé une commande mais n'a pas payé dans le délai fixé, **alors** le stock est libéré automatiquement et le client reçoit un message d'annulation.
4. **Étant donné** qu'Orange Money confirme un paiement, **alors** la commande passe à l'état « payée » en moins d'une minute, sans aucune saisie manuelle.

---

### User Story 2 — Vente en caisse au Mall (avec ou sans connexion) (Priority: P2)

Un caissier au Mall de Douala scanne les articles d'un client, encaisse le paiement (espèces, Mobile Money) et imprime le ticket. Le stock est décompté immédiatement. Si la connexion internet est coupée, le caissier continue de vendre ; les ventes sont synchronisées dès le retour de la connexion.

**Pourquoi cette priorité** : Le Mall est la source principale de revenus en phase 1 (60 % de détail). La continuité des ventes en cas de panne réseau est non négociable au Cameroun.

**Test indépendant** : Un caissier peut vendre un article hors connexion et vérifier que le stock est correctement décompté après synchronisation.

**Acceptance Scenarios** :

1. **Étant donné** qu'un caissier est connecté, **quand** il encaisse une vente, **alors** le stock est décompté en temps réel et la vente apparaît dans l'ERP immédiatement.
2. **Étant donné** qu'un caissier est hors connexion, **quand** il encaisse une vente, **alors** la vente est enregistrée localement ; dès le retour de la connexion, elle est synchronisée avec l'ERP et le stock est décompté.
3. **Étant donné** qu'une vente hors connexion a rendu le stock négatif, **alors** la situation est signalée au responsable de caisse pour vérification.

---

### User Story 3 — Tableau de bord de la direction (Priority: P3)

Un directeur ou actionnaire ouvre le tableau de bord et lit en temps réel, sans exporter vers un tableur : le chiffre d'affaires par canal, la marge brute, la rotation du stock, la trésorerie disponible, le nombre de clients actifs, la part des ventes en ligne et l'état d'avancement vers les quatre seuils de passage en phase 2.

**Pourquoi cette priorité** : Le pilotage en temps réel est un engagement du business plan. Les quatre seuils de passage commandent des décisions stratégiques (ouverture de nouveaux points relais, recrutement).

**Test indépendant** : Un directeur peut lire les quatre indicateurs de passage en phase 2 (CA, marge, rotation, trésorerie) sur une seule page, calculés depuis les données de l'ERP, sans manipulation de tableur.

**Acceptance Scenarios** :

1. **Étant donné** que des ventes ont eu lieu ce jour, **quand** le directeur ouvre le tableau de bord, **alors** il voit le CA du jour, du mois et de l'année ventilé par canal (détail, gros, B2B, réseau).
2. **Étant donné** que la marge brute tombe sous 25 %, **alors** un indicateur visuel alerte la direction sur le tableau de bord.
3. **Étant donné** que la trésorerie dépasse 100 M FCFA, **alors** le seuil correspondant est marqué comme atteint sur le tableau de bord.

---

### User Story 4 — Espace revendeur (commerçant grossiste) (Priority: P4)

Un commerçant revendeur se connecte à son espace dédié. Il consulte le catalogue avec ses prix dégressifs, passe une commande en gros, voit son encours et son plafond de crédit, et reçoit sa facture. GLOMARI suit ses commandes séparément du canal de détail.

**Pourquoi cette priorité** : Le canal B2B revendeur représente une part significative de l'objectif 40 % gros/B2B/services à pleine activité.

**Test indépendant** : Un revendeur peut passer une commande en gros avec les prix dégressifs qui lui sont attribués, et cette commande apparaît dans le canal « gros » de l'ERP.

**Acceptance Scenarios** :

1. **Étant donné** qu'un revendeur est connecté à son espace, **quand** il consulte le catalogue, **alors** il voit les prix dégressifs selon les quantités commandées.
2. **Étant donné** qu'un revendeur a atteint son plafond de crédit, **quand** il essaie de passer une nouvelle commande à crédit, **alors** la commande est bloquée et il en est informé.
3. **Étant donné** qu'une entreprise cliente (référence ACEP) commande tôt en saison, **alors** elle bénéficie de sa remise contractuelle et reçoit un devis puis une facture.

---

### User Story 5 — GLOMARI Care (assistance client 24 h/24) (Priority: P5)

Un client contacte GLOMARI Care pour suivre sa commande, demander une garantie ou signaler un problème. Un assistant traite 80 % des demandes courantes sans intervention humaine (suivi, disponibilité, procédure de retour). Pour un litige, un remboursement ou une réparation sous garantie, l'assistant transfère à un conseiller humain qui dispose de tout le contexte.

**Pourquoi cette priorité** : Le service client est le principal levier de confiance au Cameroun. L'assistant évite de bloquer la croissance sur les tâches répétitives.

**Test indépendant** : Un client peut connaître l'état de sa commande à n'importe quelle heure sans parler à un conseiller.

**Acceptance Scenarios** :

1. **Étant donné** qu'un client envoie « Où est ma commande ? », **alors** l'assistant lui donne l'état du colis et le prochain jalon de livraison sans intervention humaine.
2. **Étant donné** qu'un client signale un article défectueux, **alors** l'assistant lui présente la procédure de retour et, si nécessaire, transfère à un conseiller avec l'historique complet de la conversation.
3. **Étant donné** qu'une décision de remboursement est nécessaire, **alors** seul un conseiller humain autorisé peut la prendre — l'assistant ne rembourse jamais seul.

---

### User Story 6 — Programme d'affiliation (Priority: P6)

Un affilié partage son lien ou code personnel sur les réseaux sociaux. Quand un client achète via ce lien, l'affilié voit la vente dans son espace. Sa commission est calculée et validée automatiquement 14 jours après la livraison (délai de retour). Elle est visible dans son tableau de bord et est payée depuis l'ERP.

**Pourquoi cette priorité** : L'affiliation est le principal levier de croissance organique en phase 1, avant les franchisés (2029).

**Test indépendant** : Un affilié peut voir une commission apparaître dans son espace 14 jours après une livraison confirmée, sans saisie manuelle.

**Acceptance Scenarios** :

1. **Étant donné** qu'un client clique sur le lien d'un affilié et commande, **alors** la vente est attribuée à cet affilié dans son espace.
2. **Étant donné** que 14 jours se sont écoulés depuis la livraison sans retour, **alors** la commission de l'affilié est validée automatiquement.
3. **Étant donné** qu'un client retourne un article dans le délai de 14 jours, **alors** la commission associée est annulée.

---

### User Story 7 — Prévente avec liste d'attente et acompte (Priority: P7)

GLOMARI annonce un arrivage d'articles exclusifs. Un client s'inscrit sur la liste d'attente en versant un acompte. Quand le seuil est atteint, une commande au fabricant est préparée. Le client est informé à chaque étape. À l'arrivée, il est livré en priorité et paie le solde. Si la campagne est annulée, l'acompte est remboursé.

**Pourquoi cette priorité** : La prévente permet de financer les achats importés avant l'expédition et de tester la demande sur de nouveaux produits.

**Test indépendant** : Une campagne de prévente peut aller de l'annonce jusqu'à la livraison prioritaire des inscrits, avec remboursement automatique si elle est annulée.

**Acceptance Scenarios** :

1. **Étant donné** qu'une campagne de prévente est ouverte, **quand** un client verse un acompte, **alors** il est inscrit sur la liste d'attente et reçoit une confirmation.
2. **Étant donné** que le seuil d'inscriptions est atteint, **alors** l'ERP génère un projet de bon de commande au fabricant pour approbation.
3. **Étant donné** que la campagne est annulée, **alors** tous les acomptes sont remboursés intégralement et les clients sont notifiés.

---

### User Story 8 — Achats auprès de fournisseurs étrangers (Priority: P8)

L'équipe achats passe une commande auprès d'un fabricant étranger. Elle saisit l'acompte en devise, qui est converti en francs CFA. À la réception, les frais de transport et de dédouanement sont ajoutés, et le coût de revient est calculé automatiquement. Le seuil de marge faible est contrôlé à la création du bon de commande.

**Pourquoi cette priorité** : Les achats importés sont la principale source d'approvisionnement. Le coût de revient doit être exact pour que les prix de vente soient rentables.

**Test indépendant** : Une commande à un fournisseur étranger peut être saisie avec un acompte en devise et un coût de revient complet (acompte + transport + dédouanement) calculé en FCFA.

**Acceptance Scenarios** :

1. **Étant donné** qu'un acheteur saisit un acompte en dollars US, **alors** le montant est converti en FCFA au taux du jour et enregistré.
2. **Étant donné** que les frais de transport et de dédouanement sont saisis à la réception, **alors** le coût moyen des articles reçus est recalculé et intègre ces frais.
3. **Étant donné** que le prix de vente d'un article génère une marge inférieure au seuil défini, **alors** une alerte est affichée à l'acheteur avant validation.

---

### User Story 9 — Site web vitrine GLOMARI (Priority: P9)

Un visiteur découvre GLOMARI sur le site vitrine. Il consulte la présentation du Mall, les options de livraison, les offres d'emploi, et les formulaires de candidature pour devenir revendeur, affilié, entreprise cliente ou franchisé. Il est redirigé vers la Marketplace pour acheter.

**Pourquoi cette priorité** : Le site vitrine est la porte d'entrée pour tous les partenaires (revendeurs, affiliés, franchisés) et pour le recrutement.

**Test indépendant** : Un visiteur peut soumettre un formulaire de candidature revendeur et cette candidature apparaît dans l'ERP pour traitement.

**Acceptance Scenarios** :

1. **Étant donné** qu'un commerçant remplit le formulaire de candidature revendeur, **alors** sa demande est enregistrée dans l'ERP et l'équipe commerciale reçoit une notification.
2. **Étant donné** qu'une offre d'emploi est publiée dans l'ERP, **alors** elle apparaît automatiquement sur le site vitrine.

---

### User Story 10 — Franchisés et points relais (Priority: P10 — Phase 2, à partir de 2029)

Un franchisé à Garoua vend des articles GLOMARI depuis son espace, à partir du stock unique du groupe. Un client commande en ligne et choisit le retrait dans ce point relais. Le stock du franchisé fait partie du stock GLOMARI. Sa commission de 8 % est calculée automatiquement.

**Pourquoi cette priorité** : L'expansion vers Garoua, Bafoussam, Bamenda, Buea, Kribi, Bertoua et Ebolowa est prévue en 2029. Cette fonctionnalité est hors périmètre pour le lancement de 2027 mais doit être prévue dans l'architecture.

**Test indépendant** : Un franchisé peut vendre un article et voir sa commission calculée automatiquement dans son espace.

**Acceptance Scenarios** :

1. **Étant donné** qu'un franchisé vend un article, **alors** le stock est décompté du stock unique GLOMARI et sa commission de 8 % est enregistrée.
2. **Étant donné** qu'un client choisit un point relais comme mode de retrait, **alors** son colis est acheminé vers ce point relais et le client est notifié quand il est disponible.

---

### Edge Cases

- Que se passe-t-il si Orange Money confirme un paiement deux fois (doublon de webhook) ? Le système ne doit pas créer deux factures ni décaisser deux fois.
- Que se passe-t-il si le stock tombe à zéro au moment exact où deux clients passent commande en même temps ? Le système garantit qu'un seul des deux est accepté.
- Que se passe-t-il si le livreur ne collecte pas le paiement à la livraison (client absent, refus) ? La commande doit pouvoir être retournée et le stock remis en vente.
- Que se passe-t-il si un article est en cours de transfert entre le Mall de Douala et l'agence de Yaoundé au moment d'une commande en ligne ? Le stock en transit ne doit pas être vendu deux fois.
- Que se passe-t-il si un fournisseur en dépôt-vente reprend ses articles ? Le stock doit être ajusté sans impacter le coût moyen des articles de GLOMARI.
- Que se passe-t-il si un affilié génère sa propre commande pour toucher une commission ? Un mécanisme de détection des auto-commandes doit exister.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Catalogue et stock unique

- **FR-001** : Le système DOIT maintenir un catalogue unique d'articles partagé entre la caisse du Mall, la Marketplace en ligne et l'espace revendeur. Aucun canal ne garde ses propres prix ou quantités.
- **FR-002** : Le stock DOIT être visible en temps réel par lieu (Mall Douala, Yaoundé, et en phase 2 les franchisés). La quantité affichée en ligne correspond à la quantité physiquement disponible dans le lieu sélectionné par le client.
- **FR-003** : Le système DOIT empêcher la vente d'une même unité à deux clients simultanément (verrouillage de la réservation).
- **FR-004** : Un article DOIT être réservé dès la commande et libéré automatiquement si le paiement n'est pas confirmé dans le délai paramétré.
- **FR-005** : Le stock d'une catégorie NE DOIT PAS dépasser deux mois de ventes ; une alerte DOIT être affichée à l'acheteur si cette limite est franchie lors d'un achat.

#### Commande en ligne

- **FR-006** : La Marketplace DOIT permettre à un client non connecté de consulter le catalogue. La création de compte ou la connexion DOIT être demandée uniquement au moment de la commande.
- **FR-007** : Le client DOIT pouvoir choisir parmi les modes de livraison suivants : domicile Douala, domicile Yaoundé, expédition par agence de voyage (autres villes), point relais (ceux déjà enregistrés dans l'ERP dès le lancement ; réseau des villes de province en phase 2), retrait au Mall.
- **FR-008** : Le client DOIT pouvoir payer par Orange Money, MTN Mobile Money ou à la livraison (paiement en espèces à la réception).
- **FR-009** : Une commande DOIT être considérée comme payée uniquement après confirmation de l'opérateur de paiement. La facture, la sortie de stock et le colis DOIVENT être créés automatiquement à ce moment, sans saisie manuelle.
- **FR-010** : Un paiement confirmé en double par l'opérateur NE DOIT PAS générer deux factures ni deux sorties de stock.
- **FR-011** : Le client DOIT pouvoir suivre sa commande et son colis par un lien sécurisé, et DOIT recevoir une notification à chaque changement d'état, par WhatsApp et par SMS (décision du 21 novembre 2026 ; chaque canal désactivable ; envoi construit au lot 4).

#### Paiement à la livraison

- **FR-012** : Pour le paiement à la livraison, le livreur DOIT enregistrer la collecte dans l'application livreur. Le montant collecté DOIT être remis à la caisse et rapproché à la clôture. Aucun plafond par commande (décision du 21 novembre 2026).

#### Prévente

- **FR-013** : GLOMARI DOIT pouvoir créer une campagne de prévente avec un article, un prix, un acompte exigé, un seuil d'inscriptions et une date limite.
- **FR-014** : Un client DOIT pouvoir s'inscrire sur une liste d'attente en payant l'acompte par Mobile Money.
- **FR-015** : Quand le seuil est atteint, l'ERP DOIT générer un projet de bon de commande au fabricant pour approbation par l'acheteur.
- **FR-016** : Si la campagne est annulée, tous les acomptes DOIVENT être remboursés intégralement et les clients notifiés.

#### Espace revendeur et entreprises

- **FR-017** : Un revendeur accrédité DOIT avoir accès à un espace dédié avec les prix dégressifs négociés selon les quantités commandées.
- **FR-018** : Le système DOIT contrôler le plafond de crédit du revendeur et bloquer toute commande qui le dépasserait.
- **FR-019** : Une entreprise cliente DOIT pouvoir recevoir un devis, signer une convention et recevoir des factures avec sa remise contractuelle.
- **FR-020** : Les ventes des quatre canaux (détail, gros, B2B, réseau) DOIVENT être mesurées séparément dans les rapports.

#### Programme de fidélité

- **FR-021** : Les points de fidélité GLOMARI DOIVENT être strictement séparés des points GTA. Un client GLOMARI ne cumule des points que sur ses achats GLOMARI.
- **FR-022** : Le barème des points (points gagnés par tranche de montant dépensé, valeur d'un point) DOIT être paramétrable par l'équipe marketing.

#### Avis vérifiés

- **FR-023** : Environ 14 jours après une livraison confirmée, le client DOIT recevoir un lien personnel pour laisser un avis.
- **FR-024** : L'avis DOIT être publié sur la fiche produit après modération. Seul un client ayant réellement acheté l'article peut laisser un avis.

#### Affiliation

- **FR-025** : Un affilié DOIT recevoir un lien et un code personnels à partager. Les ventes générées par ce lien ou ce code DOIVENT lui être attribuées.
- **FR-026** : La commission DOIT être validée automatiquement 14 jours après la livraison si aucun retour n'a été enregistré. Elle DOIT être annulée en cas de retour dans ce délai.
- **FR-027** : Le système DOIT détecter et signaler les auto-commandes (un affilié qui commande via son propre lien).

#### GLOMARI Care

- **FR-028** : Un assistant automatisé DOIT être disponible 24 h/24 pour traiter les demandes courantes : suivi de commande, disponibilité d'un article, procédure de retour, état d'une garantie.
- **FR-029** : Pour tout litige, retour ou demande de remboursement, l'assistant DOIT transférer à un conseiller humain en lui communiquant l'historique complet de la conversation.
- **FR-030** : L'assistant NE DOIT JAMAIS valider seul un remboursement. Cette décision appartient exclusivement à un conseiller humain autorisé.

#### Achats et approvisionnement

- **FR-031** : Pour un fournisseur étranger, l'acheteur DOIT pouvoir saisir l'acompte dans la devise du fournisseur. Le montant DOIT être converti en FCFA au taux du jour saisi.
- **FR-032** : Les frais de transport et de dédouanement DOIVENT être intégrés au coût de revient des articles à la réception.
- **FR-033** : Un fournisseur local DOIT pouvoir travailler en dépôt-vente : ses articles sont en stock chez GLOMARI mais ne sont facturés qu'à la vente.
- **FR-034** : À la création d'un bon de commande, si le prix de vente prévu génère une marge inférieure au seuil paramétré, une alerte DOIT être affichée à l'acheteur.

#### Site web vitrine

- **FR-035** : Le site vitrine DOIT présenter GLOMARI (Mall, livraison, paiement), avec des formulaires de candidature pour revendeur, affilié, entreprise cliente et franchisé.
- **FR-036** : Les offres d'emploi publiées dans l'ERP (module RH) DOIVENT apparaître automatiquement sur le site vitrine.
- **FR-037** : Le site vitrine DOIT rediriger vers la Marketplace pour tout achat.

#### Séparation GLOMARI / GTA

- **FR-038** : GLOMARI et GTA DOIVENT rester strictement séparées : clients, points de fidélité, stock et droits d'accès. Aucune donnée GLOMARI n'est accessible depuis un compte GTA et vice-versa.
- **FR-039** : GTA DOIT former le personnel GLOMARI, les franchisés et les vendeurs accrédités via l'ERP, sans accès aux données commerciales GLOMARI.

#### Droits et séparation des tâches

- **FR-040** : Chaque collaborateur n'accède qu'aux données et fonctions de son poste. Seul le super administrateur crée et modifie les accès.
- **FR-041** : Celui qui prépare une commande d'achat, une écriture comptable ou une sortie en perte NE PEUT PAS la valider lui-même.

#### Franchisés et points relais (Phase 2 — 2029)

- **FR-042** : Le stock des franchisés DOIT faire partie du stock unique GLOMARI et être visible dans le tableau de bord de la direction.
- **FR-043** : La commission de 8 % du franchisé DOIT être calculée automatiquement à chaque vente et visible dans son espace.
- **FR-044** : Un vendeur accrédité DOIT avoir un franchisé parrain qui répond de son activité.

---

### Key Entities

- **Article** : référence unique, description, catégorie, prix de vente unique tous canaux, coût moyen, unités de vente, photos, codes-barres.
- **Lieu de stock** : Mall Douala, Agence Yaoundé, points relais et franchisés (phase 2). Chaque lieu a son stock propre ; le total constitue le stock GLOMARI.
- **Réservation de stock** : article, quantité, commande associée, heure d'expiration. Garantit l'exclusivité d'une unité pendant le délai de paiement.
- **Commande** : canal (détail / gros / B2B / réseau), état (réservée → payée → facturée → expédiée → livrée, ou annulée, ou expirée ; le panier ne réserve rien), lignes, mode de livraison, moyen de paiement.
- **Paiement** : moyen (Orange Money, MTN MoMo, paiement livraison), référence opérateur, montant en FCFA, état (en attente / confirmé / remboursé), rapprochement.
- **Client** : particulier, revendeur, entreprise. Profil unique par branche GLOMARI. Encours et plafond de crédit pour les revendeurs.
- **Livraison** : mode, colis, étapes de suivi, lien sécurisé, code de confirmation livreur.
- **Campagne de prévente** : article, acompte exigé, seuil, date limite, état, liste des inscrits.
- **Affilié** : lien et code personnels, parrain (franchisé en phase 2), commissions en attente et validées.
- **Franchisé** (phase 2) : zone géographique, stock propre intégré au stock unique, commission de 8 %.
- **Programme de fidélité GLOMARI** : points par client, barème paramétrable, historique des transactions.
- **Fournisseur** : local (possible dépôt-vente) ou étranger (acompte en devise, frais d'importation).
- **Avis vérifié** : lien personnel, note, texte, état (en attente de modération / publié / rejeté), rattaché à un achat réel.

---

## Success Criteria *(mandatory)*

### Résultats mesurables

- **SC-001** : Une commande en ligne apparaît dans l'ERP et réserve le stock en moins d'une minute après validation par le client.
- **SC-002** : Deux clients ne peuvent jamais acheter la même dernière pièce : le taux de doublon de vente sur une même unité est de zéro.
- **SC-003** : 100 % des paiements Mobile Money sont rapprochés au franc CFA près, sans saisie manuelle, dans les 24 heures suivant la confirmation de l'opérateur.
- **SC-004** : 80 % des demandes adressées à GLOMARI Care sont traitées sans intervention d'un conseiller humain.
- **SC-005** : La direction lit en temps réel, sur une seule page, sans tableur : chiffre d'affaires par canal, marge brute, rotation du stock, trésorerie, clients actifs, part des ventes en ligne, et état des quatre seuils de passage en phase 2.
- **SC-006** : Les quatre seuils de passage en phase 2 sont calculés et affichés en continu : CA 2028 ≥ 1 900 M FCFA, marge brute ≥ 25 %, rotation du stock ≤ 60 jours, trésorerie ≥ 100 M FCFA.
- **SC-007** : Un caissier au Mall peut continuer de vendre pendant une coupure réseau ; aucune vente n'est perdue lors de la synchronisation.
- **SC-008** : Le coût de revient d'un article importé (acompte + transport + dédouanement), converti en FCFA, est calculé automatiquement sans saisie multiple.
- **SC-009** : Le taux de satisfaction client mesuré par les avis vérifiés est visible dans le tableau de bord de la direction au même titre que les indicateurs financiers.

---

## Assumptions

- L'ERP SMARTE (existant) est la source de vérité unique pour les articles, le stock, la caisse, la facturation, les achats et la comptabilité. La Marketplace et le site vitrine s'appuient sur ces données sans les dupliquer.
- Les opérateurs Orange Money et MTN Mobile Money disposent d'une API de paiement avec notifications de confirmation (webhooks). L'intégration de ces API fait partie du périmètre.
- Le délai de réservation du stock avant libération est de 30 minutes pour un paiement Mobile Money et de 24 heures pour un paiement à la livraison. Ces valeurs sont paramétrables.
- Les notifications au client (confirmations, suivi de colis) sont envoyées par WhatsApp et par SMS, chaque canal pouvant être désactivé.
- Le délai de retour (validation des commissions d'affiliation et annulation des avis) est de 14 jours calendaires après la livraison confirmée.
- La séparation stricte GLOMARI / GTA est une contrainte non négociable, déjà inscrite dans l'architecture de l'ERP SMARTE.
- La comptabilité suit le référentiel SYSCOHADA et doit être validée par un expert-comptable agréé avant tout usage légal. Le système génère des brouillons d'écritures ; l'expert valide.
- La TVA est libre et facultative : le pourcentage est saisi par la personne qui facture, sous sa responsabilité.
- Les montants sont en francs CFA entiers, sans décimales.
- Les franchisés et points relais (Garoua, Bafoussam, Bamenda, Buea, Kribi, Bertoua, Ebolowa) sont hors périmètre pour le lancement de 2027 mais l'architecture doit les prévoir pour 2029.
- GLOMARI Pay, SMARTCOIN, les recommandations personnalisées par IA, l'expansion CEMAC et la publication automatique sur les réseaux sociaux sont hors périmètre.
- L'assistant GLOMARI Care est un chatbot à règles prédéfinies (arbre de décision), pas un modèle d'IA générative. Les recommandations personnalisées par l'IA sont explicitement hors périmètre.
- Le site vitrine GLOMARI est géré par l'équipe marketing via un outil d'administration simple intégré à l'ERP (offres d'emploi, actualités) ; les pages statiques de présentation sont mises à jour par le développeur.
