# Smarte Solutions

ERP SaaS du Groupe Smart Global Concepts (SGC, Douala), logiciel propriétaire. Le responsable est Achille Satieu, qui n'est pas développeur : réponses en français, simples, une étape à la fois. Son développeur est le responsable technique.

## Règles métier à ne jamais casser

- GTA fait uniquement les formations, GLOMARI les stocks. Ne jamais mélanger.
- Fichiers clients et points de fidélité séparés par branche.
- Les collaborateurs de GTA n'ont pas accès au stock. Seul le super administrateur accède à tout et donne les accès.
- TVA libre et facultative.
- Titres de documents et noms de fichiers sans tiret ni tiret bas (fichiers imposés par les outils exceptés, et noms de fichiers de code existants inchangés).
- Comptabilité, paie et DSF : dire clairement que cela ne remplace pas un expert agréé.
- Ne jamais demander de mot de passe. Ils se saisissent uniquement sur le serveur.

## Technique

TypeScript, Node 22, Fastify 5, PostgreSQL 16, monolithe modulaire, interface en JavaScript sans framework (`public/`). Multi organisation par sécurité au niveau des lignes : `org_courante()`, FORCE RLS, rôle applicatif `erp_app`.

- Code : `src/`. Migrations numérotées : `migrations/`, ne jamais modifier une migration déjà appliquée, en ajouter une.
- Toute nouvelle table : RLS forcée, politique `cloison`, droits accordés à `erp_app`.
- Tout droit se vérifie côté serveur, sur l'entité ou la branche concernée, pas seulement dans l'écran.
- Tout code d'erreur envoyé par le serveur a son message dans `MESSAGES` (`public/app.js`).
- Argent en FCFA entiers. Une sortie d'argent exige `tresorerie.gerer`. Seule exception, décidée par Achille le 11 novembre 2026 : le remboursement d'un retour de caisse, que le responsable de caisse (`caisse.superviser`) fait seul. Paiements, factures validées et billets sont figés par déclencheurs.

## Vérifier

```sh
npm ci
npx tsc --noEmit
TEST_ADMIN_URL=postgres://erp_proprio:erp_proprio@localhost:5432/postgres npm test
```

Il faut un PostgreSQL local avec le rôle `erp_proprio`. Voir `.github/workflows/verification.yml` pour la préparation exacte. Supprimer la base `erp_test` avant de relancer. Tester avec le rôle restreint, pas en super utilisateur, sinon la RLS n'est pas éprouvée.

Tout changement passe par une branche, une demande de fusion et les contrôles GitHub au vert.

## État au 5 novembre 2026

Tous les modules prévus sont développés et relus. Verdict : prêt pour un essai privé avec des données fictives, pas pour de vraies données ni une ouverture au public. Guide : `docs/Guide de mise en ligne.md`. Couverture : `docs/Couverture du cahier des charges.md`.

À faire ensuite :
1. Essai privé sur un serveur : construction de l'image Docker, HTTPS, tâches planifiées et restauration d'une sauvegarde, jamais essayés.

Limites connues :
- Vente hors connexion : un caissier peut encore faire passer le stock en négatif, chaque dépassement va au journal (`caisse.stock_negatif`).
- Achats : pas d'acompte au fournisseur avant sa facture (le paiement passe par la facture fournisseur en comptabilité). Un frais saisi après la réception ne change plus le coût du stock déjà entré. Prix en FCFA seulement, pas de devise étrangère. Import des lignes : .xlsx ou CSV (pas l'ancien .xls), articles déjà au catalogue. Seuil de marge faible fixé à 20 % dans le code (`SEUIL_MARGE_FAIBLE`).
- Tableau de bord (`src/tableau.ts`, `public/tableau.js`) : bénéfice brut = entrées moins sorties d'argent des portefeuilles, pas le résultat comptable. Sans portefeuille réglé, les entrées restent à zéro même s'il y a des ventes. Pour GLOMARI, les quatre vignettes sont Ventes, Achats, Sorties ou dépenses, Bénéfice (choix d'Achille du 11 novembre 2026) : achats = bons de commande approuvés à leur date ; dépenses = sorties des portefeuilles hors paiement des factures fournisseur liées à une commande et hors remboursements de retours de caisse ; bénéfice = ventes moins achats moins dépenses, vue de gestion et non résultat comptable ; les ventes sont nettes des retours de caisse. GTA garde ventes, entrées, sorties, bénéfice brut. Icônes dessinées dans `ICONES_TDB`. Logo par branche, sinon celui du groupe, posé sur chaque `.document`.
- Performance au quotidien (`src/performance.ts`, `public/quotidien.js`, migration 0039) : jours ouvrés du lundi au vendredi ; ponctualité 100 avant 20 h, 50 le lendemain avant 10 h ; ligne de ponctualité de poids 10. Responsable direct sur la fiche employé (`responsable_id`), sinon les titulaires de `rh.evaluer`. Services destinataires repérés par droit (RH `rh.gerer`, finance `tresorerie.gerer`, logistique `transport.gerer` ou `stocks.valider`, informatique `entites.gerer`), donc le super administrateur les reçoit aussi. Direction de la branche = rôles `direction` ou `administrateur`. Notifications stockées dans `notifications_personnes`, sans e-mail ni SMS. Pièces jointes : il faut `ERP_DOSSIER_MEDIAS`. Contribution à 0 sans solution aux collègues ; acceptation calculée sans les refus.
- Fiches de poste (`src/fiches.ts`, `public/fiches.js`, migration 0040) : versions en insertion seule, intitulé et entité fixes ; rédigées par `rh.gerer` ou `rh.evaluer`. La fiche d'un employé est celle dont l'intitulé égale son poste, dans son entité ou la plus proche au-dessus. La lecture se confirme par version. Générer les objectifs arrête ceux d'une version précédente, jamais les modèles saisis à la main. Les indicateurs de la fiche ne remplissent pas encore les règles d'évaluation mensuelle.
- OKR (`src/okr.ts`, `public/okr.js`, migration 0041) : reprise des anciens objectifs (sans parent : branche, avec parent : équipe ; propriétaire retrouvé seulement si l'ancien texte égale le nom d'un seul utilisateur). Parent de la même branche ou du groupe SGC, même trimestre. Créer ou noter : `pilotage.gerer` sur l'entité, ou le responsable direct pour un OKR individuel ; le collaborateur propose seulement le sien. Point hebdomadaire et initiatives : propriétaire du résultat clé ou de l'objectif. Feux : vert jusqu'à 10 points de retard sur le temps écoulé, orange jusqu'à 25 ; ambitieux attendu à 70 %. Réussi : ambitieux dès 0,6, engagé à 1. Note possible dans les deux dernières semaines du trimestre. Mesures d'entité calculées la nuit (après 2 h, heure de Douala) sur l'entité et ses sous-entités ; ruptures = articles suivis à stock nul ou négatif. Vision : `pilotage.gerer` sur toute l'organisation. Preuve : document déjà dans le module Documents, pas de dépôt depuis l'écran OKR.
- Stocks et entrepôts (`src/entrepots.ts`, `public/entrepots.js`, migration 0042) : tout est dans le module Stocks, en onglets (état, articles et catégories, mouvements et transferts, dates d'expiration, avariés, import) ; l'ancien écran des mouvements est `ecranStockMouvements` (`public/gestion.js`). Articles, catégories, unités et colis vivent dans la table `produits` commune : rien n'est à recréer en facturation, achats ou caisse. État du stock par lieu depuis les mouvements ; pièces = quantité × `pieces_par_unite` de l'article ; valeur au coût moyen actuel (même pour une date passée), visible seulement avec `stocks.valider` ou `facturation.administrer`. Catégories sur deux niveaux, par branche, réservées aux branches avec le module de stock. Unités et types de colis : listes proposées, saisie libre permise. Avarié : compté dans le lieu mais ni vendable ni transférable, jusqu'à la sortie en perte ou la remise en vente (`stocks.gerer`). Expiration : par lot (`lots_produit`), alerte 30 jours avant (`JOURS_ALERTE_EXPIRATION`), notification unique aux titulaires de `stocks.gerer` du lieu. Import : la colonne Quantité fixe le stock compté d'un lieu et exige `stocks.valider` ; elle ne crée pas de lot ni de date d'expiration.
- Caisse rapide (`src/caisse.ts`, `public/caisse.js`, migration 0043) : remise en % ou en FCFA TTC par ligne, et sur toute la vente (répartie sur les lignes au prorata, `repartirRemise`) ; plafond `REMISE_MAX_CAISSIER` (10 %) sur le cumul de la ligne, au delà `caisse.superviser`. Vente à crédit : droit `caisse.credit` (donné d'office au super administrateur et à l'administrateur seulement), client de la branche, jamais hors connexion, plafond de crédit du client respecté ; reste dû dans `/creances` ; règlement ultérieur dans `reglements_comptoir`, compté dans la caisse ouverte de celui qui encaisse ; l'unicité des références de paiement (0035) ne couvre pas ces règlements ; un crédit déjà réglé en partie ne s'annule plus à la caisse. L'écriture comptable d'une vente à crédit reste à valider par l'expert comptable. Vendeur choisi parmi les titulaires de `caisse.vendre` du lieu (le super administrateur y figure). Client rapide : nom et téléphone, un numéro déjà connu dans la branche rend la fiche existante. Vignettes : initiale à la place de la photo, filtre par marque et unités de vente absents (lot 2). Numéros de série : seulement en ligne. Le total affiché est recalculé par l'écran comme le serveur, sauf prix par tranches (approché). Hors connexion : ni crédit, ni client, ni numéro de série.
- Catalogue complet (`src/articles.ts`, `public/codesbarres.js`, migration 0044) : photos en base (`photos_produits`, 4 par article, 512 Ko, réduites à 600 px par le navigateur avant l'envoi), servies avec cache, absentes hors connexion. Marques par branche, réservées aux branches avec le module de stock. Unités de vente (`unitesArticle`) : unité de base, `conditionnements` (avec prix facultatif) et « pièce » si `pieces_par_unite` > 1 (`prix_piece`) ; le stock, les paliers et les marges restent dans l'unité de base ; un prix d'unité fixé ignore paliers et promotions ; en achat, le coût de base est arrondi au franc, le total de la commande reste celui de l'unité achetée. Codes-barres : EAN13 interne préfixe 200 (compteur `EAN`), sans valeur hors de l'entreprise ; CODE128 jeu B seulement (caractères ASCII imprimables). Étiquettes : planches A4 de 24, 40 ou 65 et rouleau 50 × 30 mm, dimensions fixées dans `PLANCHES` (`public/mall.js`) ; lecture par une vraie douchette et calage sur de vraies planches non vérifiés.
- Retours, rapports, commissions (`src/retours.ts`, `src/rapports.ts`, `public/rapports.js`, migration 0045) : retour partiel avec `caisse.superviser` et la caisse ouverte de celui qui le fait ; ce droit suffit pour rendre l'argent ou imputer le retour sur le reste dû ; quantités retournées dans l'unité de base ; montant au prorata de la ligne payée ; article remis en vente ou mis en avarié ; points repris sans passer le solde sous zéro ; une vente avec retour ne s'annule plus ; les numéros de série ne reviennent pas en stock par un retour ; sans portefeuille réglé pour le moyen, le remboursement n'est pas écrit en trésorerie (journal `tresorerie.remboursement_sans_portefeuille`). L'écriture comptable d'un retour reste à valider par l'expert comptable. Rapports : ventes de caisse seulement (pas les factures, sauf leurs règlements et restes dus), retours déduits à leur date, stock du jour, marge = ventes HT moins coût moyen actuel, valeurs et marges avec `stocks.valider` ou `facturation.administrer`. Commission : ventes TTC de caisse du mois par vendeur, pourcentage au delà de l'objectif (`employes.objectif_ventes`, `taux_commission`, réglés avec `rh.gerer`) ; `commissions_proposees` est une proposition lue par la paie (`rh.paie`), jamais ajoutée seule à un bulletin ; l'écran de paie ne la préremplit pas.
- Mot de passe : 8 caractères minimum, sans maximum, choix d'Achille du 8 novembre 2026 (12 avant).
- Prix négociés et grilles non appliqués à la caisse. Tranches arrondies à l'unité au portail grossiste.
- Double authentification non imposée, mot de passe provisoire non imposé côté serveur, sauvegardes non chiffrées, documentation de l'API publique.
- Trois alertes moyennes de `npm audit` via `@fastify/static` : ne pas lancer `npm audit fix --force`, qui reviendrait à une version bien plus ancienne.
- Non vérifié : refacturations entre branches pour un rôle limité à une branche ; essais pratiques sur studio, indicateurs, transferts, lots.
- Avant de vraies données : validation par l'expert comptable, DSF officielle de la DGI, test d'intrusion.

Applications mobiles reportées après le premier essai réel : la session E-commerce de Douala, dont la nouvelle date reste à donner.
