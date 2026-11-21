# Manuel d’intégration stratégique de GLOMARI : l’exécution du modèle omnicanal

Nov 20, 2026 · @THE PLUG

GLOMARI vend un seul stock, au même prix, en rayon au GLOMARI Mall et en ligne sur GLOMARI Marketplace. Ce manuel montre comment chaque aspect du business plan (technique, commercial, financier, lien avec GTA) est activé, tracé et mesuré par le système numérique complet : l’ERP SMARTE, le site web GLOMARI et la plateforme e-commerce GLOMARI Marketplace, de la phase de lancement en 2027 à la conquête des marchés après 2031.

**Lecture des statuts.** Chaque rôle décrit ici est la cible du logiciel complet. Entre crochets : **\[Existant\]** = présent et testé dans le dépôt SMARTE au 20 novembre 2026 ; **\[Lot n\]** = à construire dans le lot n de la fiche technique. Le détail des écarts est dans l’onglet Cahier des charges et écarts.

## I. Phase 1 (2027) : Vendre et livrer, le lancement omnicanal

Cette première phase installe le modèle : le Mall de Douala et l’agence de Yaoundé, la Marketplace, la livraison et GLOMARI Care. L’objectif chiffré est un chiffre d’affaires de 1 629 M FCFA, 7 200 clients actifs au détail et un résultat net de 72 M FCFA (scénario optimiste).

### 1. Croisement technique : du stock unique à la livraison suivie

L’aspect technique de la phase 1 est le GLOMARI Mall, supermarché-entrepôt en local loué et aménagé, relié en temps réel à la Marketplace web, Android et iOS. Il correspond directement au **Processus d’approvisionnement** (réception, contrôle, codification) et au **Processus de livraison** (préparation, livraison suivie).

- **Rôle de SMARTE.** Dès la première réception, le module **Achats et stocks** enregistre chaque article avec sa référence, son code-barres EAN13 interne, ses photos et son lieu de stockage **\[Existant\]**. Le stock bouge sans saisie à chaque vente, réception ou transfert confirmé **\[Existant\]**. Ce même stock alimente la caisse du Mall **\[Existant\]** et la Marketplace, qui ne garde ni prix ni quantité propres **\[Lot 1\]**. Le module **Transport** prépare les colis dans l’ordre des emplacements, les affecte aux 4 motos, 2 tricycles et 1 utilitaire, puis les suit jusqu’à la remise contre code de confirmation **\[Existant\]**.

### 2. Croisement commercial : du message « un seul stock » à la première commande

L’aspect commercial commence par la migration des 4 000 clients des réseaux sociaux vers la Marketplace et par le message central « Un seul stock, en rayon et en ligne ». C’est la base du **Processus de prévente** puis du **Processus de mise en vente**, sur quatre canaux : détail, gros, B2B et affiliation.

- **Rôle de SMARTE et du digital.** Le **site web GLOMARI** capte les demandes (revendeur, entreprise, affilié) par des formulaires publics, que le **CRM** de SMARTE transforme en fiches qualifiées par un score de prospect **\[Existant\]**. Les campagnes d’arrivage ouvrent les **précommandes avec acompte en Mobile Money** **\[Lots 2 et 3\]**. Le client achète en caisse ou en ligne ; l’article est aussitôt réservé et décompté du stock **\[Existant en caisse, Lot 1 en ligne\]**. Les revendeurs du marché central commandent sur le **portail grossiste** aux prix dégressifs **\[Existant\]**, et ACEP comme les autres entreprises reçoivent devis et factures sur leur compte professionnel **\[Existant\]**.

### 3. Croisement financier : du capital au chiffre d’affaires encaissé

Les aspects financiers de la phase 1 sont le capital de 390 M FCFA (355 M en numéraire, 35 M d’apport de la plateforme), l’emprunt de 100 M à 12 % sur 5 ans, la ligne de crédit de campagne de 150 M et le stock plafonné à 2 mois.

- **Rôle de SMARTE.** Le module **Trésorerie** tient un portefeuille par compte réel : espèces, Orange Money, MTN MoMo, banque **\[Existant\]**. Chaque paiement Mobile Money confirmé par l’opérateur s’y inscrit seul et déclenche la facture et la sortie de stock **\[Lot 2\]**. Le module **Comptabilité** produit les journaux, la balance et les états financiers SYSCOHADA, à faire valider par l’expert-comptable **\[Existant\]**. Les **budgets** et la **prévision de trésorerie** suivent la ligne de campagne et le plafond de stock **\[Existant\]**.

### 4. Croisement GTA : des commerciaux formés comme intrapreneurs SMART

Les commerciaux de GLOMARI sont recrutés et formés par Global Training Academy pour devenir des « intrapreneurs SMART ». Une boutique prête à l’emploi et une offre de lancement pour les apprenants de GTA restent à valider avec GTA.

- **Rôle de SMARTE.** GTA et GLOMARI sont deux branches cloisonnées du même groupe SGC : GTA gère les formations, GLOMARI le stock, jamais l’un chez l’autre **\[Existant\]**. La formation achetée par GLOMARI à GTA passe par la **refacturation interne** au compte de liaison 185 **\[Existant\]**. Le module **RH** suit les objectifs de vente et les commissions de chaque vendeur, proposées à la paie **\[Existant\]**.

## II. Phase 2 (2029) : Étendre le réseau, franchise et points relais

GLOMARI ne passe en phase 2 que si quatre seuils sont atteints : CA 2028 ≥ 1,9 Md FCFA, marge brute ≥ 25 %, rotation du stock ≤ 60 jours, trésorerie ≥ 100 M FCFA. La cible 2029 est un CA de 3 826 M FCFA, 12 franchisés actifs et un résultat net de 365 M FCFA.

### 1. Croisement technique : le schéma « hub and spoke »

Le Mall de Douala devient le centre d’un réseau de franchisés et de points relais à Garoua, Bafoussam, Bamenda, Buea, Kribi, Bertoua et Ebolowa. Le stock des franchisés rejoint le stock unique ; les RH passent à 36 emplois en 2029, puis 40 en 2030.

- **Rôle de SMARTE.** Chaque franchisé devient un lieu de stock rattaché à GLOMARI, avec ses ventes enregistrées comme celles d’une caisse **\[Lot 5\]**. Les **points relais** reçoivent les colis, remettent la commande contre un code et touchent leur commission **\[Existant\]**, avec un écran simple qui leur est propre **\[Lot 5\]**. Les **transferts** entre le Mall et les villes sortent puis entrent du stock à leurs deux confirmations **\[Existant\]**.

### 2. Croisement commercial : la franchise et les vendeurs accrédités

Les franchisés sont des boutiques formalisées qui vendent leurs articles et ceux de GLOMARI, avec une commission de 8 %. Les vendeurs particuliers sont accrédités par un franchisé parrain, sans vente directe « fourre-tout ». La marque GLOMARI couvre des modèles exclusifs importés.

- **Rôle de SMARTE.** Le module **Réseau** gère vendeurs, franchises, commissions, redevances et litiges **\[Existant\]**. Le parrainage et le calcul des commissions par parrain sont ajoutés **\[Lot 5\]**. Les **affiliés** disposent d’un lien de suivi et d’une page de leurs ventes **\[Lot 5\]**. Les **marques** sont gérées par branche, la marque GLOMARI comprise **\[Existant\]**.

### 3. Croisement financier : l’expansion autofinancée

Les investissements complémentaires de 2029, soit 45 M FCFA, sont financés par la capacité d’autofinancement de l’année précédente.

- **Rôle de SMARTE.** Les quatre seuils de passage se lisent dans le module **Indicateurs**, avec cible, seuil d’alerte et responsable : CA et trésorerie **\[Existant\]**, marge brute et rotation du stock **\[Lot 5\]**. Le registre des **immobilisations** amortit les nouveaux équipements au mois **\[Existant\]**.

### 4. Croisement GTA : franchisés et vendeurs formés

Les franchisés et les vendeurs accrédités sont formés par GTA. Des frais de transaction réduits pour les vendeurs certifiés restent à valider.

- **Rôle de SMARTE.** La certification délivrée par GTA est vérifiable par QR code **\[Existant côté GTA\]**. Le lien entre un certificat GTA et le taux de commission d’un vendeur GLOMARI reste à construire, dans le respect du cloisonnement des branches **\[Lot 5\]**.

## III. Phase 3 (2031) et au-delà : Innover, puis conquérir les marchés

La phase 3 vise un CA de 6 697 M FCFA, un résultat net de 798 M FCFA (11,9 %), une trésorerie de 1 656 M FCFA, 48 franchisés, 120 revendeurs et 26 400 clients actifs. L’emprunt est remboursé fin 2031 ; aucun dividende n’est versé avant 2030.

### 1. Croisement technique : paiement propre et recommandation par l’IA

GLOMARI Pay et SMARTCOIN sont prévus sous réserve des autorisations réglementaires. L’IA recommande des articles selon les achats de chaque client. Le Mall-entrepôt, saturé à 100 % de l’activité, appelle une extension ou un second entrepôt, à confirmer.

- **Rôle de SMARTE.** L’historique d’achat de chaque client, déjà conservé par la caisse et la facturation **\[Existant\]**, nourrit les recommandations **\[Lot 6\]**. Un second entrepôt se crée comme un lieu de plus, avec son stock et ses transferts **\[Existant\]**. GLOMARI Pay et SMARTCOIN ne seront codés qu’après autorisation écrite des autorités monétaires de la CEMAC **\[Lot 6\]**.

### 2. Croisement commercial : la fidélité devient un moyen de paiement

Les points de fidélité sont convertibles en remises, puis en crédit d’achat avec GLOMARI Pay.

- **Rôle de SMARTE.** La **fidélité** GLOMARI, paramétrable et séparée de celle de GTA, est le point de départ **\[Existant\]**. Sa conversion en crédit d’achat dépend de GLOMARI Pay **\[Lot 6\]**.

### 3. Croisement financier : rentabilité et transparence

- **Rôle de SMARTE.** Les **états financiers SYSCOHADA**, le **cumul du groupe SGC** et la **préparation de la DSF** donnent aux actionnaires une lecture fidèle, après validation de l’expert-comptable **\[Existant\]**. Un accès en lecture pour l’assemblée générale et le conseil d’administration reste à construire **\[Lot 5\]**. Le financement de GLOMARI Pay et de SMARTCOIN n’est pas chiffré dans le business plan.

### 4. Horizon : la conquête des marchés de la CEMAC

Au-delà de 2031, le business plan prévoit d’étendre la franchise et les points relais à d’autres pays de la CEMAC, d’ouvrir la plateforme à de nouvelles langues, devises et logistiques, et d’installer des diplômés de GTA comme franchisés. Ces points sont encore à définir.

- **Rôle de SMARTE.** L’ERP est déjà multi-organisation et multi-entités : un pays devient une entité sous GLOMARI, avec ses lieux et ses droits **\[Existant\]**. La comptabilité et les factures restent aujourd’hui en FCFA seulement ; une autre devise demandera un développement dédié **\[Horizon\]**.

## IV. Options optimales et intégration systémique : les quatre canaux de GLOMARI

L’exécution de GLOMARI repose sur un système numérique unique à trois faces : l’**ERP SMARTE** (stock, achats, ventes, livraison, finance, RH, pilotage), le **site web GLOMARI** (présentation, recrutement des revendeurs, entreprises, affiliés et franchisés) et la **Marketplace** (boutique en ligne web, puis Android et iOS). Nous recommandons de bâtir le site web et la Marketplace dans une même application React installée (PWA), qui ne tient ni stock ni prix et lit tout dans SMARTE. Le prestataire de paiement Mobile Money et le canal de messages (SMS, WhatsApp) sont à choisir par la direction.

### Canal 1 : Vente au détail omnicanale (GLOMARI Mall et Marketplace)

Ce canal porte la promesse centrale : un seul stock, au même prix, en rayon et en ligne.

| Fonction critique | Outil ou partenaire optimal | Lien opérationnel via SMARTE |
| --- | --- | --- |
| Stock et prix uniques | SMARTE (Achats et stocks, Caisse) + Marketplace | Le prix, la promotion du jour et la quantité vendable sont lus dans SMARTE par des routes publiques sécurisées ; une commande en ligne réserve le stock du Mall et expire si elle n’est pas payée **\[Lot 1\]**. En rayon, la caisse vend hors connexion et décompte le stock **\[Existant\]**. |
| Paiement | Orange Money et MTN MoMo via le prestataire choisi ; espèces ; paiement à la livraison | L’avis signé de l’opérateur inscrit l’encaissement dans le bon portefeuille, émet la facture et sort le stock dans une seule opération **\[Lot 2\]**. Le paiement à la livraison est porté par le colis et remis à la caisse **\[Existant\]**. |
| Livraison | Smart Delivery (interne) ; Livraison Express, Ongola Express, IS Express ; agences de voyage | Le module Transport crée le colis, calcule les frais par zone, planifie la tournée et publie une page de suivi par code **\[Existant\]** ; le client est prévenu à chaque étape par SMS ou WhatsApp **\[Lot 4\]**. |
| Service client | GLOMARI Care : assistant IA 24 h/24 + équipe | L’assistant répond à partir du catalogue et de la commande, et ouvre un dossier SAV quand il ne sait pas **\[Lot 4\]** ; garantie, retours, remise en stock et remboursement sont traités dans SMARTE **\[Existant\]**. |

### Canal 2 : Vente en gros aux commerçants revendeurs

Ce canal écoule les volumes vers les commerçants du marché central, puis vers 120 revendeurs en 2031.

| Fonction critique | Outil ou partenaire optimal | Lien opérationnel via SMARTE |
| --- | --- | --- |
| Prix dégressifs | Portail grossiste SMARTE | Le revendeur voit le catalogue avec ses paliers, ses prix négociés et ses factures, et commande en ligne ; le prix est toujours recalculé par le serveur **\[Existant\]**. De vrais comptes avec mot de passe remplacent le lien secret **\[Lot 5\]**. |
| Crédit et encours | Comptes professionnels SMARTE | Chaque revendeur a une catégorie (grossiste, demi-grossiste, revendeur), un délai et un plafond de crédit ; le recouvrement envoie des relances graduées confirmées par une personne **\[Existant\]**. |
| Volume d’approvisionnement | Fabricants via Alibaba ; transitaires | Les suggestions de réapprovisionnement et les dossiers d’importation calculent le coût de revient **\[Existant\]** ; l’acompte au fabricant avant facture et l’achat en devise sont ajoutés **\[Lot 3\]**. |

### Canal 3 : Vente B2B aux entreprises (référence ACEP)

Ce canal sécurise des commandes récurrentes par des offres de services, protocoles d’accord et conventions de partenariat.

| Fonction critique | Outil ou partenaire optimal | Lien opérationnel via SMARTE |
| --- | --- | --- |
| Devis et convention | Module Facturation + Contrats | Le devis négocié devient facture ; la convention est suivie avec ses échéances dans le module Contrats **\[Existant\]**. |
| Remise pour commande anticipée | Prix négociés, grilles par catégorie et période | Les remises aux entreprises qui commandent tôt en saison sont des grilles datées par client **\[Existant\]**. |
| Facturation et paiement | Facturation, factures récurrentes, recouvrement | Les factures mensuelles sont préparées en brouillon, émises puis suivies jusqu’au règlement **\[Existant\]** ; la facture électronique de la DGI n’est pas raccordée **\[Externe\]**. |

### Canal 4 : Réseau d’affiliés, puis de franchisés

Ce canal étend la couverture sans ouvrir de magasins : affiliés rémunérés dès 2027, 12 franchisés en 2029, 48 en 2031.

| Fonction critique | Outil ou partenaire optimal | Lien opérationnel via SMARTE |
| --- | --- | --- |
| Recrutement et accréditation | Site web GLOMARI + GTA | La candidature arrive par un formulaire public dans le CRM **\[Existant\]** ; la formation et la certification sont faites par GTA, branche séparée **\[Existant\]**. |
| Commissions | Modules Affiliation et Réseau | Les commissions sont calculées sur facture, validées après le délai de retour et payées depuis un portefeuille **\[Existant\]** ; le lien de suivi et la page de l’affilié sont ajoutés **\[Lot 5\]**. |
| Stock des franchisés | SMARTE, lieu de stock par franchisé | Le stock du franchisé rejoint le stock unique et ses ventes remontent comme une caisse **\[Lot 5\]**. |

## V. Liens opérationnels optimaux : SMARTE et partenaires dans le process d’exploitation

Chaque étape du process global d’exploitation (prévente, approvisionnement, mise en vente, livraison et après-vente) est sécurisée par une fonction de SMARTE et par un partenaire nommé dans le business plan. Le pilotage global ferme la boucle.

### 1. Phase de prévente : mesurer la demande avant d’acheter

La prévente est une précommande avec acompte, pas un financement participatif. Elle réduit les ruptures en haute saison et finance une partie du réapprovisionnement. Leviers transversaux : veille, networking, leadership.

| Action du processus | Outils et partenaires optimaux | Lien opérationnel via SMARTE |
| --- | --- | --- |
| Exploration du marché | CRM SMARTE ; 4 000 clients des réseaux sociaux ; transitaires pour les règles d’import | La base clients est importée dans les fiches GLOMARI et segmentée ; l’analyse ABC et les produits dormants orientent les catégories et la saisonnalité **\[Existant\]**. Les normes d’import sont classées dans Documents **\[Existant\]**. |
| Développement de l’offre | Fabricants via Alibaba ; fournisseurs locaux et Made in Cameroun ; Longrich, Dynace Global | Les demandes de prix comparent les offres et exigent un motif si la moins chère n’est pas retenue **\[Existant\]**. La grille détail, gros et B2B se règle par paliers, grilles et prix négociés **\[Existant\]**. Le dépôt-vente avec les fournisseurs locaux est ajouté **\[Lot 3\]**. |
| Création de contenus | Studio IA de SMARTE ; équipe marketing | L’IA rédige en brouillon le titre, la description et les points clés de chaque fiche produit ; le marketing valide avant publication sur la Marketplace **\[Lot 4\]**. Les campagnes mesurent leur coût et leur retour sur investissement **\[Existant\]**. |
| Génération de précommandes | Marketplace ; Orange Money, MTN MoMo ; entreprises B2B | La campagne d’arrivage ouvre une liste d’attente avec acompte ; au seuil, SMARTE prépare le bon de commande au fabricant, à approuver **\[Lot 3\]**. Les entreprises reçoivent une offre de services par devis **\[Existant\]**. |

### 2. Phase d’approvisionnement : transformer les précommandes en stock contrôlé

Leviers transversaux : système d’information, réseau d’acteurs, cadre normatif.

| Action du processus | Outils et partenaires optimaux | Lien opérationnel via SMARTE |
| --- | --- | --- |
| Planification des achats | Module Achats ; banques et microfinances | Les suggestions de réapprovisionnement et la prévision des ventes par catégorie proposent les quantités ; le budget et la prévision de trésorerie vérifient la ligne de campagne de 150 M FCFA **\[Existant\]**. Le seuil de précommandes alimente ces suggestions **\[Lot 3\]**. |
| Commande fournisseurs | Fabricants ; banques pour les transferts | Le bon de commande est approuvé par un autre que son auteur (séparation des tâches) **\[Existant\]**. L’acompte à la commande, le solde à l’expédition et les prix en devise sont gérés **\[Lot 3\]**. |
| Transport et dédouanement | OUWAN CARGO, JOE CARGO, A&J CARGO, DF LOGISTICS, FAST LEGUERY LOGISTICS ; douanes | Le dossier d’importation regroupe fret, droits et frais, et calcule le coefficient de coût de revient **\[Existant\]**. Les clients en précommande sont prévenus à chaque étape de l’arrivage **\[Lots 3 et 4\]**. |
| Réception et contrôle qualité | Équipe de réception ; douchette et étiquettes | La réception confirmée fait entrer le stock ; un article abîmé passe en avarié, ni vendable ni transférable ; chaque article reçoit son code-barres et son étiquette **\[Existant\]**. |

### 3. Phase de mise en vente : écouler le stock sur quatre canaux

Levier transversal : mix marketing.

| Action du processus | Outils et partenaires optimaux | Lien opérationnel via SMARTE |
| --- | --- | --- |
| Mise en rayon et en ligne | Mall (rayons, emplacements) ; Marketplace | L’article est exposé au Mall avec son étiquette **\[Existant\]** et publié en ligne au même prix avec la quantité disponible affichée **\[Lot 1\]**. |
| Vente et paiement | Caisse SMARTE ; Marketplace ; Orange Money, MTN MoMo | En caisse : paiements mixtes, crédit plafonné, ticket avec NIU et RCCM **\[Existant\]**. En ligne : réservation immédiate, paiement confirmé par l’opérateur **\[Lots 1 et 2\]**. |
| Vente B2B et en gros | Portail grossiste ; facturation ; ACEP et revendeurs | Devis, convention, grille dégressive et encours sont suivis par client **\[Existant\]**. |
| Réseau de vente | Affiliés ; franchisés | Commissions calculées et payées depuis SMARTE **\[Existant\]** ; liens de suivi, parrainage et stock franchisé **\[Lot 5\]**. |

### 4. Phase de livraison et d’après-vente : fermer la boucle

Leviers transversaux : système d’information, réseau d’acteurs, cadre normatif.

| Action du processus | Outils et partenaires optimaux | Lien opérationnel via SMARTE |
| --- | --- | --- |
| Préparation des commandes | Équipe de préparation ; points relais | La préparation suit l’ordre des emplacements et le scan contrôle chaque article ; le colis est affecté à un livreur, une agence ou un point relais **\[Existant\]**, et créé seul pour une commande en ligne payée **\[Lot 2\]**. |
| Livraison suivie | Smart Delivery ; prestataires urbains ; MTA, Général Voyage, Nso Boy, Cerises Express | Zones, tournées, code de confirmation, paiement à la livraison et page de suivi publique **\[Existant\]** ; messages au client à chaque étape **\[Lot 4\]**. |
| SAV et garantie (GLOMARI Care) | Assistant IA ; conseillers Care ; fabricants pour la garantie | Dossier SAV, garantie, retour autorisé, remise en stock ou avarié, remboursement **\[Existant\]** ; premier niveau répondu par l’IA 24 h/24 **\[Lot 4\]**. |
| Fidélisation et retour d’expérience | Avis vérifiés ; programme de fidélité | Une note basse ouvre un ticket ; les points de fidélité sont séparés de ceux de GTA **\[Existant\]**. Le lien d’avis part seul à J+14 et les avis s’affichent sur la fiche produit **\[Lot 4\]**. |

### 5. Pilotage global : l’intelligence pour décider

| Action du processus | Outils et partenaires optimaux | Lien opérationnel via SMARTE |
| --- | --- | --- |
| Tableau de bord de la direction | Tableau de bord et Indicateurs SMARTE | Ventes, achats, dépenses et bénéfice de gestion chaque jour, indicateurs avec seuils et alertes **\[Existant\]** ; marge brute, rotation, clients actifs et réseau actif **\[Lot 5\]**. |
| Objectifs en cascade | OKR SMARTE ; groupe SGC | Les objectifs du groupe se déclinent sur GLOMARI, ses équipes et chaque personne, avec un point hebdomadaire **\[Existant\]**. |
| Reporting financier | Comptabilité SYSCOHADA ; expert-comptable | États financiers, cumul du groupe et préparation de la DSF, à valider par l’expert **\[Existant\]**. |

## VI. Acteurs clés par phase et leur lien avec SMARTE

Les partenaires ne sont pas mobilisés tous en même temps : chaque phase active ceux qui portent son objectif, et SMARTE leur donne une place tracée.

### Phase 1 (2027) : Vendre et livrer, la légitimité du modèle

L’implication des partenaires se concentre sur la preuve que le stock unique, le paiement mobile et la livraison fonctionnent.

| Aspect stratégique | Acteurs clés impliqués | Rôle progressif et lien SMARTE |
| --- | --- | --- |
| Technique : Mall, stock unique, livraison | Fabricants via Alibaba ; transitaires (OUWAN CARGO, JOE CARGO, A&J CARGO, DF LOGISTICS, FAST LEGUERY LOGISTICS) ; Smart Delivery et prestataires urbains | **Rôle :** approvisionner le Mall et livrer à Douala et Yaoundé. **Progression :** fiches fournisseurs, dossiers d’importation et colis sont ouverts dans SMARTE dès la première commande **\[Existant\]**. |
| Technique : plateforme et paiement | Prestataire de la plateforme (à confirmer) ; Orange Money, MTN MoMo ; CAMTEL, Orange, MTN, Nexttel | **Rôle :** mettre en ligne la Marketplace et encaisser par mobile. **Progression :** routes publiques et avis de paiement signés raccordent la boutique à SMARTE **\[Lots 1 et 2\]**. |
| Commercial : migration des clients, gros et B2B | 4 000 clients des réseaux sociaux ; revendeurs du marché central ; ACEP ; affiliés | **Rôle :** créer le premier volume. **Progression :** fiches clients GLOMARI, comptes professionnels, portail grossiste et codes affiliés **\[Existant\]**. |
| Financier : capital, emprunt, campagne | Actionnaires (390 M FCFA) ; banque prêteuse (100 M FCFA) ; ligne de campagne (150 M FCFA) | **Rôle :** financer le démarrage et le stock. **Progression :** portefeuilles, budgets, prévision de trésorerie et états SYSCOHADA justifient l’usage des fonds **\[Existant\]**. |
| GTA : vendeurs intrapreneurs | Global Training Academy | **Rôle :** recruter et former les commerciaux. **Progression :** refacturation interne et objectifs de vente suivis en RH **\[Existant\]**. |

### Phase 2 (2029) : Étendre le réseau, la fiabilisation de la chaîne

| Aspect stratégique | Acteurs clés impliqués | Rôle progressif et lien SMARTE |
| --- | --- | --- |
| Technique : hub and spoke | Franchisés ; points relais de Garoua, Bafoussam, Bamenda, Buea, Kribi, Bertoua, Ebolowa ; agences de voyage (MTA, Général Voyage, Nso Boy, Cerises Express) | **Rôle :** porter le stock et les retraits hors de Douala. **Progression :** chaque franchisé devient un lieu de stock, chaque relais a son écran **\[Lot 5\]**. |
| Commercial : franchise et marque GLOMARI | Franchisés (commission de 8 %) ; vendeurs accrédités par parrain ; fournisseurs des modèles exclusifs | **Rôle :** multiplier les points de vente sans magasin propre. **Progression :** module Réseau avec parrainage et commissions par parrain **\[Existant, complété au Lot 5\]**. |
| Financier : autofinancement | Banques et microfinances | **Rôle :** accompagner 45 M FCFA d’investissements autofinancés. **Progression :** les quatre seuils de passage sont lus dans SMARTE sans tableur **\[Lot 5\]**. |
| GTA : formation du réseau | Global Training Academy | **Rôle :** former franchisés et vendeurs accrédités. **Progression :** certificat GTA vérifiable par QR code, relié au taux du vendeur **\[Lot 5\]**. |

### Phase 3 (2031) et horizon : Innover et conquérir

| Aspect stratégique | Acteurs clés impliqués | Rôle progressif et lien SMARTE |
| --- | --- | --- |
| Technique : GLOMARI Pay, SMARTCOIN | Autorités monétaires de la CEMAC ; partenaire bancaire | **Rôle :** autoriser et adosser le paiement propre. **Progression :** aucun code avant autorisation écrite **\[Lot 6\]**. |
| Commercial : fidélité et sous-région | 26 400 clients actifs ; 48 franchisés ; partenaires de la ZLECAf (à définir) | **Rôle :** transformer la fidélité en crédit d’achat et ouvrir la sous-région. **Progression :** fidélité paramétrable **\[Existant\]**, recommandations IA **\[Lot 6\]**. |
| Financier : nouvelle ouverture du capital | Investisseurs de l’expansion régionale (à définir) | **Rôle :** financer la conquête. **Progression :** accès en lecture aux tableaux de bord pour les actionnaires **\[Lot 5\]**. |
| GTA : diplômés franchisés | Diplômés de GTA | **Rôle :** ouvrir de nouvelles villes comme franchisés, à valider. **Progression :** une ville ou un pays devient une entité sous GLOMARI **\[Existant\]**. |

## VII. Mix marketing : chaque levier tracé dans SMARTE

### 1. Politique de prix : le coût juste, visible à chaque vente

Le business plan fixe la formule PRIX DE VENTE = COÛT D’ACHAT DES ARTICLES + CHARGES D’EXPLOITATION + MARGE BÉNÉFICIAIRE. Le même prix vaut en rayon et en ligne ; le gros et le B2B ont leurs grilles.

- **Lien opérationnel.** Le coût d’achat vient du module Achats, frais d’importation compris par le coefficient du dossier d’import **\[Existant\]**, appliqué au coût moyen **\[Lot 3\]**. Une alerte signale toute marge sous 20 % au moment de l’achat (`SEUIL_MARGE_FAIBLE`) **\[Existant\]**. Le prix de vente, les paliers et les promotions sont saisis une seule fois dans SMARTE et repris par la caisse, le portail grossiste et la Marketplace **\[Existant, Lot 1 pour la Marketplace\]**.
- **Lien stratégique.** La marge brute est l’un des quatre seuils de passage en phase 2 (≥ 25 %) : elle doit être lue chaque mois dans SMARTE, pas recalculée à la main **\[Lot 5\]**.
- **Correction à faire dans le business plan.** La phrase actuelle applique la formule « aux produits issus de transformation du bois » : c’est un reste d’un autre dossier, sans rapport avec GLOMARI, à supprimer.

### 2. Stratégie de vente : directe, indirecte et en ligne

La vente se fait par des commerciaux recrutés (renforcés par des saisonniers en pointe), par les réseaux sociaux et par l’application et le site web, avec une présence sur les salons, foires et kermesses. L’objectif à pleine activité est de 60 % de ventes au détail et 40 % de gros, B2B et services.

- **Lien opérationnel.** Chaque vente porte son vendeur : la commission au-delà de l’objectif mensuel est proposée à la paie **\[Existant\]**. Les prospects des salons sont saisis par formulaire et notés dans le CRM **\[Existant\]**. Les vendeurs saisonniers reçoivent un compte limité à la caisse de leur lieu, avec date d’expiration **\[Existant\]**.
- **Lien stratégique.** La part détail contre gros et B2B, et la part en ligne contre rayon, sont suivies comme indicateurs pour vérifier la répartition 60 / 40 du business plan **\[Lot 5\]**.

### 3. Promotion des ventes : fidéliser des clients volatils

Le business plan prévoit des ventes périodiques avec bonus, d’abord avec les partenaires clés (entreprises privées et publiques), sur les produits d’appel : électroménager, ameublement, informatique.

- **Lien opérationnel.** Les promotions par produit et par dates s’appliquent en facture et en caisse **\[Existant\]**, puis sur la Marketplace **\[Lot 1\]**. Les points de fidélité GLOMARI récompensent chaque achat **\[Existant\]**. Chaque campagne mesure son coût et ses ventes rattachées, donc son retour sur investissement **\[Existant\]**.
- **Lien stratégique.** Les avis vérifiés, demandés à J+14 et publiés sur la fiche produit, deviennent l’argument de confiance que le marché camerounais exige pour acheter en ligne **\[Lot 4\]**.

### 4. Communication : site internet et réseaux sociaux

La communication passe par le téléphone, internet, le site de la société et les réseaux sociaux : LinkedIn, Facebook, YouTube, X.

- **Lien opérationnel.** Le **site web GLOMARI** présente le Mall, les canaux et les offres, et recueille les candidatures de revendeurs, d’entreprises, d’affiliés et de franchisés dans le CRM **\[Lot 1\]**. Les fiches produits rédigées par l’IA fournissent textes et visuels aux réseaux sociaux **\[Lot 4\]**. La publication automatique sur les réseaux sociaux n’est pas prévue : elle reste manuelle.
- **Lien stratégique.** Chaque lien publié porte un code de campagne, pour que SMARTE rattache la vente à la campagne et au réseau social d’origine **\[Lot 4\]**. Le plan média conjoint GLOMARI – GTA reste à définir.
