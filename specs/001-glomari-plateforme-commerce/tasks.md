---

description: "Liste des tâches du module canal en ligne GLOMARI (lot 1)"
---

# Tâches : module canal en ligne GLOMARI (lot 1)

**Entrée** : documents de `specs/001-glomari-plateforme-commerce/` ; besoin : `docs/Fiche technique globale GLOMARI.md`, sections 5, 6 et 9 (lot 1)

**Prérequis** : [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Révision** : 2026-11-21, après `/speckit-analyze` et les décisions du même jour (points relais dès le lot 1, 24 heures de réservation pour le paiement à la livraison, fichier `canalenligne.ts`).

**Tests** : demandés (entrée du plan et fiche, section 9). Dans chaque étape, le fichier de test s'écrit d'abord et doit échouer avant l'implémentation.

**Périmètre** : partie « commande en ligne et réservation » du parcours 1 (P1), sans paiement en ligne. Parcours 2 à 10 hors lot 1. Le parcours 1 est découpé en cinq étapes testables (A à E), étiquetées `[US1]`.

**Contraintes de champ** : `data-model.md` fait foi ; les tâches citent `Entité.champ`.

## Format : `[ID] [P?] [Story] Description`

- **[P]** : parallélisable (autre fichier, aucune dépendance non terminée)
- **[US1]** : parcours 1 de la spécification

---

## Phase 0 : prérequis (lot 0)

- [X] T001 Vérifier sur `main` que les points 1 et 2 du lot 0 sont fusionnés (demandes n° 1 et n° 2) : `.github/workflows/verification.yml` présent et vert, `scripts/provisionnerglomari.ts` (commande `npm run provisionner:glomari`) présent ; sinon s'arrêter et fusionner d'abord la demande manquante. Les points 3 et 4 du lot 0 ne conditionnent pas le lot 1

---

## Phase 1 : préparation

- [X] T002 Créer la branche `lot1-canal-en-ligne` depuis `main` (fiche, section 0) et y versionner `specs/001-glomari-plateforme-commerce/`
- [X] T003 Créer `src/canalenligne.ts` avec les constantes exportées `DUREE_RESERVATION_MINUTES = 30` et `DUREE_RESERVATION_LIVRAISON_MINUTES = 1440` et une fonction vide `enregistrerCanalEnLigne(app: FastifyInstance, pool: pg.Pool, outils: Outils, taches: TachePlanifiee[], urlPublique: string): void`, puis l'appeler dans `src/serveur.ts` juste après `enregistrerMall(...)` (l. 806), avant la définition de `executerTaches`

---

## Phase 2 : fondations (bloquent toutes les étapes)

- [X] T004 Écrire `migrations/0046_canal_en_ligne.sql` selon data-model.md : tables `config_canal` (`config_canal.id`, `config_canal.organisation_id`, `config_canal.entite_id`, `config_canal.actif`, `config_canal.cree_le`, index unique partiel sur l'organisation où `actif`), `lieux_canal` (`lieux_canal.id`, `lieux_canal.organisation_id`, `lieux_canal.config_id`, `lieux_canal.entite_id`, `lieux_canal.nom_public`, `lieux_canal.actif`), `commandes_web` (`commandes_web.id`, `commandes_web.organisation_id`, `commandes_web.entite_id`, `commandes_web.lieu_id`, `commandes_web.tiers_id`, `commandes_web.reference`, `commandes_web.jeton_suivi_hache`, `commandes_web.statut`, `commandes_web.nom_client`, `commandes_web.telephone`, `commandes_web.mode_livraison`, `commandes_web.zone_id`, `commandes_web.point_relais_id`, `commandes_web.adresse`, `commandes_web.note`, `commandes_web.moyen_paiement`, `commandes_web.canal`, `commandes_web.code_affilie`, `commandes_web.frais_livraison`, `commandes_web.total_ht`, `commandes_web.total_ttc`, `commandes_web.expire_le`, `commandes_web.colis_id`, `commandes_web.motif`, `commandes_web.traite_par`, `commandes_web.traite_le`, `commandes_web.cree_le`, avec les checks entre champs et les index), `lignes_commande_web` (`lignes_commande_web.id`, `lignes_commande_web.organisation_id`, `lignes_commande_web.commande_id`, `lignes_commande_web.produit_id`, `lignes_commande_web.quantite`, `lignes_commande_web.prix_unitaire_ht`, `lignes_commande_web.prix_unitaire_ttc`, `lignes_commande_web.taux_taxe`, `lignes_commande_web.total_ht`, `lignes_commande_web.total_ttc`) ; modification de `reservations_stock` (`reservations_stock.commande_web_id`, `reservations_stock.auteur_id`) ; fonction `quantite_vendable(p_entite, p_produit)` ; **ne pas recréer** `zones_livraison`, `points_relais`, `colis` ni `tiers` (clés étrangères vers les tables existantes) ; terminer par le bloc `do $$ … $$` de `migrations/0030_commerce_logistique.sql` l. 59 à 66 sur les quatre tables nouvelles ; ne modifier aucune migration existante
- [X] T005 [P] Dans `src/stocks.ts`, ajouter `export async function quantiteDisponible(c: Client, entiteId: string, produitId: string): Promise<number>` qui renvoie `select quantite_vendable($1, $2)::float`, et l'utiliser dans `sortirDuStock` (l. 28 à 32) hors type `ajustement`, sans changer le comportement ; `tests/stocks.test.ts`, `tests/caisse.test.ts` et `tests/logistique.test.ts` restent verts
- [X] T006 [P] Dans `src/pilotage.ts`, extraire le corps de `POST /colis` (l. 263 à 284) en `export async function creerColis(ctx: Contexte, b: { entiteId: string; destinataire: string; telephone?: string; adresse?: string; zoneId?: string; transporteur?: string; documentId?: string; aEncaisser?: number })` qui renvoie la ligne du colis, sans contrôle de droit à l'intérieur ; la route garde `exigerSurEntite(ctx, "transport.gerer", …)` et construit `lien_suivi` ; comportement inchangé, `tests/pilotage.test.ts` et `tests/mall.test.ts` restent verts
- [X] T007 [P] Dans `public/app.js`, ajouter à `MESSAGES` `lieu_invalide`, `zone_invalide`, `point_relais_invalide`, `mode_livraison_invalide`, `commande_non_modifiable`, `confirmation_impossible`, `boutique_deja_active` (textes de contracts/routes-publiques.md, section « Codes d'erreur ») et rendre générique le message de `module_inactif` (« Ce module n'est pas activé pour cette entité. »)
- [X] T008 [P] Créer `tests/canaloutils.ts` : `boutique(env)` crée une organisation, un point de vente « Mall » sous GLOMARI (`POST /magasins`, comme `tests/caisse.test.ts` l. 13), une zone de 1 000 FCFA sur la branche GLOMARI (`POST /zones-livraison` avec `entiteId` = GLOMARI, comme `tests/pilotage.test.ts` l. 72 à 80 ; un lieu n'a pas le module transport), un point relais (`POST /points-relais`, comme `tests/mall.test.ts` l. 85), ouvre la boutique (`POST /canal-config`) et déclare le lieu (`POST /canal-config/lieux`) ; renvoie `{ o, G, lieu, zoneId, relaisId, article(code, prixVente, tauxTaxe, stock) }` où `article` crée un produit suivi en stock et l'entre au lieu (`POST /stocks/mouvements`) ; ajouter `commander(env, org, corps)` (`POST /marketplace/:org/commandes` sans jeton)

**Point d'étape** : la migration s'applique, `npx tsc --noEmit` passe, toute la suite existante reste verte.

---

## Phase 3 : étape A, boutique et catalogue public (US1, P1) 🎯 MVP

**Objectif** : la boutique de GLOMARI s'ouvre ; la Marketplace lit catalogue, disponibilité, zones et points relais, au prix de la caisse, sans coût ni article de GTA (FR-001, FR-002, FR-006, FR-007, FR-038 ; fiche 6.1).

**Test indépendant** : `tests/canalcatalogue.test.ts` (scénarios S1 à S3).

- [X] T009 [P] [US1] Écrire `tests/canalcatalogue.test.ts` : `GET /marketplace/:org/catalogue` sans jeton → 200 ; article à 1 000 FCFA HT et 19,25 % → `prix_ttc` = HT + taxes de `calculerLigne(1, 1000, 0, 19.25)` ; catégorie (`POST /categories-articles`), marque (`POST /marques`) posées par `PUT /produits/:id/classement`, photo par `PUT /produits/:id/photos/1` → présentes, et `GET /marketplace/:org/produits/:id/photos/1` renvoie l'image avec `cache-control` public ; `JSON.stringify` de chaque réponse ne contient pas `cout` ni `commission` ; article créé sur `o.entites.GTA` absent et sa photo en 404 ; `GET /disponibilite?produits=` → vendable du lieu, diminué d'une réservation `POST /reservations-stock` ; `GET /zones` → zone de la branche et relais ; `POST /canal-config` sur GTA → `409 module_inactif` ; lieu pris dans GTA → `400 lieu_invalide` ; boutique fermée ou UUID d'une autre organisation → 404
- [X] T010 [US1] Dans `src/canalenligne.ts`, routes `GET /canal-config` (`facturation.voir`), `POST /canal-config` et `POST /canal-config/lieux` (`facturation.administrer`) selon contracts/routes-internes.md : `config_canal.entite_id` exige le module `achats_stocks` (requête de `exigerStock`, `src/entrepots.ts` l. 48), sinon `409 module_inactif` ; `config_canal.actif`, violation de l'index unique partiel → `409 boutique_deja_active` ; `lieux_canal.entite_id` doit vérifier `entite_branche(lieuEntiteId) = entiteId`, sinon `400 lieu_invalide` ; `lieux_canal.nom_public` et `lieux_canal.actif` en création ou mise à jour ; `journal_evenement('canal.acces', …)`
- [X] T011 [US1] Dans `src/canalenligne.ts`, aide `parBoutique(org, fn)` sur le modèle de `parCode` (`src/mall.ts` l. 286 : UUID validé, `dansOrganisation(pool, org, …)`, boutique `actif`, `404 introuvable` pour tout échec dont `22P02`), puis `GET /marketplace/:org/catalogue` (débit 60) et `GET /marketplace/:org/produits/:id/photos/:position` (débit 120) selon contracts/routes-publiques.md : colonnes explicites de `produits` (jamais `cout_moyen`), filtre `actif`, `type = 'produit'`, `suivi_stock`, branche de la boutique, 2 000 articles ; catégorie et parent (`categories_articles`), marque (`marques`), positions de `photos_produits` ; `prix_ttc` par `prixProduit()` puis `calculerLigne(1, …)` ; photo avec `cache-control: public, max-age=86400`, `etag`, `nosniff`
- [X] T012 [US1] Dans `src/canalenligne.ts`, `GET /marketplace/:org/disponibilite?produits=` (1 à 100 UUID, sinon `400 donnees_invalides`) et `GET /marketplace/:org/zones` (débit 60) : vendable par lieu actif par `quantite_vendable()` en une requête groupée, plancher 0 ; zones de `zones_livraison` dont `entite_id` est la branche de la boutique ; points relais `actif` de la branche sans `commission` ni `telephone` ; listes des modes et moyens de paiement

**Point d'étape** : T009 vert ; la Marketplace (W3) peut afficher le catalogue.

---

## Phase 4 : étape B, commande, fiche client et réservation (US1, P1)

**Objectif** : un client commande sans compte ; sa fiche GLOMARI est retrouvée ou créée par téléphone ; le stock du lieu est réservé sous verrou ; deux clients ne prennent jamais la même dernière pièce ; il suit sa commande par référence et jeton (FR-003, FR-004, FR-007, FR-008 pour le choix du moyen, FR-011 sans notification, FR-020, FR-038 ; SC-001, SC-002).

**Test indépendant** : `tests/canalcommandes.test.ts` (scénarios S4 à S7).

- [X] T013 [P] [US1] Écrire `tests/canalcommandes.test.ts` (moins de 20 commandes dans le fichier) : 2 sur 3 en domicile et `a_la_livraison` → 201, `reference` au format `WEB-AAAA-000001`, jeton de 43 caractères, `total_ttc` = lignes + 1 000, vendable à 1, puis `POST /stocks/mouvements` en sortie de 2 au même lieu → `409 stock_insuffisant` ; stock à 1 et deux commandes par `Promise.all` (modèle `tests/achats.test.ts` l. 80) → une 201 et une `409 stock_insuffisant` ; deux commandes au même téléphone écrit différemment → un seul `tiers_id`, rôle `client`, branche GLOMARI ; une fiche GTA au même numéro n'est pas reprise ; un champ `prix` envoyé ne change rien ; article GTA → 404 ; zone inconnue ou d'une autre organisation → `400 zone_invalide` ; `point_relais` sans relais ou avec un relais inactif → `400 point_relais_invalide` ; téléphone de 5 chiffres → `400 telephone_invalide` ; `orange_money` → `expire_le` à 30 minutes, `a_la_livraison` → 24 heures ; `GET /marketplace/:org/commandes/:reference?jeton=` → 200 sans `telephone`, `nom_client`, `adresse` ni `code_confirmation`, `colis` nul ; jeton faux, ou référence d'une autre commande avec ce jeton → 404
- [X] T014 [US1] Dans `src/canalenligne.ts`, `POST /marketplace/:org/commandes` (débit 20) selon contracts/routes-publiques.md (déroulé en 6 points) : contrôles de `commandes_web.lieu_id` (lieu actif de la boutique), `commandes_web.mode_livraison`, `commandes_web.zone_id` (zone dont `entite_id` = `commandes_web.entite_id`, la branche ; règle de `src/pilotage.ts` l. 269), `commandes_web.point_relais_id` (relais actif de la branche), `commandes_web.adresse`, `commandes_web.nom_client`, `commandes_web.telephone` (`normaliserTelephone()`, au moins 8 chiffres sinon `400 telephone_invalide`), `commandes_web.note`, `commandes_web.moyen_paiement` ; `commandes_web.tiers_id` retrouvé par téléphone dans la branche ou créé comme `POST /caisse/clients` (`src/caisse.ts` l. 439 à 446, sans `lierTiers` qui exige un utilisateur), événement `tiers.cree` ; `lignes_commande_web.produit_id` (catalogue de la boutique, sinon 404) et `lignes_commande_web.quantite` ; lignes triées, `produitSuivi()`, `quantiteDisponible()` au lieu, sinon `409 stock_insuffisant` ; prix comme la caisse pour `lignes_commande_web.prix_unitaire_ht`, `lignes_commande_web.prix_unitaire_ttc`, `lignes_commande_web.taux_taxe`, `lignes_commande_web.total_ht`, `lignes_commande_web.total_ttc`, puis `commandes_web.frais_livraison` (frais de la zone, 0 sinon), `commandes_web.total_ht`, `commandes_web.total_ttc` ; `commandes_web.reference` par `prochainNumero(c, "WEB-" + année)` ; `commandes_web.jeton_suivi_hache` = `hacherJeton(randomBytes(32).toString("base64url"))` ; `commandes_web.expire_le` selon `DUREE_RESERVATION_MINUTES` ou `DUREE_RESERVATION_LIVRAISON_MINUTES` ; `commandes_web.canal` `'marketplace'`, `commandes_web.code_affilie` nul ; une `reservations_stock` par ligne avec `reservations_stock.commande_web_id`, `reservations_stock.auteur_id` nul, `motif` `'commande_web'` ; `publierEvenement(c, "commande_web.creee", …)` ; réponse 201
- [X] T015 [US1] Dans `src/canalenligne.ts`, `GET /marketplace/:org/commandes/:reference?jeton=` (débit 60) : formats validés, recherche par référence **et** `hacherJeton(jeton)`, réponse limitée au contrat, colis (statut et lien `${urlPublique}/suivi.html?c=${org}.${code_suivi}`) s'il existe, sinon `404 introuvable`

**Point d'étape** : T013 vert ; la Marketplace (W4) peut passer commande.

---

## Phase 5 : étape C, libération automatique du stock (US1, P1)

**Objectif** : une commande non payée ou non confirmée à son échéance est expirée et son stock libéré une seule fois, chaque minute (FR-004, scénario 3 du parcours 1 ; fiche, section 9).

**Test indépendant** : `tests/canalexpiration.test.ts` (scénario S8).

- [X] T016 [P] [US1] Écrire `tests/canalexpiration.test.ts` : échéance avancée par `dansOrganisation(env.poolApp, o.organisationId, (c) => c.query("update commandes_web set expire_le = now() - interval '1 minute' where id = $1", [id]))` (modèle `tests/caisse.test.ts` l. 2), `env.app.executerTaches(o.organisationId)` deux fois → suivi `expiree`, vendable revenu, un seul `commande_web.expiree` dans `evenements` ; échéance dépassée sans tâche, une nouvelle commande sur la même dernière pièce passe ; une commande confirmée (colis) n'expire pas ; une autre organisation n'est pas touchée
- [X] T017 [US1] Dans `src/canalenligne.ts`, `leverReservations(c, commandeId)` et `export async function expirerCommandesWeb(c: Client): Promise<number>` selon contracts/routes-internes.md (« Expiration des réservations ») : sélection sur `commandes_web.statut` `'reservee'`, `commandes_web.colis_id` nul et `commandes_web.expire_le` dépassé, `for update skip locked`, réservations levées, `commandes_web.statut` à `'expiree'`, `commandes_web.traite_le` renseigné, événement `commande_web.expiree` ; pousser dans `taches` une `TachePlanifiee` qui l'exécute dans `dansOrganisation(pool, organisationId, …)`
- [X] T018 [US1] Dans `src/canalenligne.ts`, appeler `expirerCommandesWeb(c)` au début de `POST /marketplace/:org/commandes`, dans la même transaction et avant de verrouiller les articles
- [X] T019 [US1] Dans `src/serveur.ts`, sous `if (options.webhooksAuto)` (l. 813), ajouter une minuterie de 60 secondes qui parcourt `registre_organisations` et exécute `expirerCommandesWeb` dans `dansOrganisation(pool, id, …)`, avec `unref()`, `clearInterval` dans le crochet `onClose` existant et journal d'erreur « expiration commandes web »

**Point d'étape** : T016 vert ; aucun stock ne reste bloqué plus d'une minute après l'échéance.

---

## Phase 6 : étape D, traitement interne, colis à encaisser et écran (US1, P1)

**Objectif** : le personnel voit les commandes de sa branche, confirme celles payées à la livraison (le colis « à encaisser » se crée seul) et annule les autres (FR-012 pour le colis, FR-040 ; fiche 5.2).

**Test indépendant** : `tests/canalgestion.test.ts` (scénarios S9 à S11) et contrôle manuel de l'écran.

- [X] T020 [P] [US1] Écrire `tests/canalgestion.test.ts` : `GET /commandes-web` en administrateur contient la commande ; un utilisateur sans `facturation.voir` → 403 ; une autre organisation → 404 sur `GET /commandes-web/:id` ; `POST /commandes-web/:id/confirmer` d'une commande `a_la_livraison` → colis présent dans `GET /colis` avec `a_encaisser` = `total_ttc` et la zone, suivi public avec `colis` renseigné, puis échéance avancée et `executerTaches` → toujours `reservee` et vendable inchangé ; confirmer une commande `orange_money` → `409 confirmation_impossible` ; confirmer deux fois → `409 commande_non_modifiable` ; annuler sans motif → 400, avec motif → `annulee` et vendable revenu, deuxième annulation → `409 commande_non_modifiable`
- [X] T021 [US1] Dans `src/canalenligne.ts`, `GET /commandes-web` (expiration d'abord, branches de `entitesAccessibles(ctx.client, ctx.utilisateurId, "facturation.voir")`, filtre `statut`, ordre et limite du contrat) et `GET /commandes-web/:id` (`exigerSurEntite(ctx, "facturation.voir", entite_id)`, lignes, fiche client, colis, `404 introuvable`)
- [X] T022 [US1] Dans `src/canalenligne.ts`, `POST /commandes-web/:id/confirmer` et `POST /commandes-web/:id/annuler` selon contracts/routes-internes.md : verrou `for update` ; confirmer exige `commandes_web.moyen_paiement` `'a_la_livraison'` (sinon `409 confirmation_impossible`), `commandes_web.statut` `'reservee'`, `commandes_web.colis_id` nul et échéance non dépassée (sinon `409 commande_non_modifiable`), contrôle `facturation.gerer` sur la branche (`commandes_web.entite_id`), appelle `creerColis()` (T006) avec `entiteId` = la branche (qui a le module transport), `aEncaisser` = `total_ttc` et l'adresse du relais pour ce mode, renseigne `commandes_web.colis_id`, `commandes_web.traite_par`, `commandes_web.traite_le`, publie `commande_web.confirmee` ; annuler exige `commandes_web.motif` (3 à 500 caractères), `facturation.gerer` sur la branche, statut `'reservee'` et colis absent ou au statut `prepare`, `echec` ou `retour`, lève les réservations, publie `commande_web.annulee`
- [X] T023 [P] [US1] Créer `public/canalenligne.js` avec `ecranCommandesEnLigne(message)` sur le modèle de `ecranPortail` (`public/mall.js` l. 100 à 112, aides `h`, `api`, `formulaire`, `champ`) : liste filtrable par statut, détail, Confirmer (paiement à la livraison) et Annuler (motif) avec `facturation.gerer`, onglet Boutique (ouvrir ou fermer, lieux) avec `facturation.administrer` ; montants en FCFA entiers ; aucun calcul de prix
- [X] T024 [US1] Brancher l'écran : `<script src="/canalenligne.js"></script>` après `/mall.js` dans `public/index.html` (l. 25) ; `"/canalenligne.js"` dans `FICHIERS` et `CACHE` à `"smarte-solutions-v2"` dans `public/sw.js` ; bouton « Commandes en ligne » dans `public/app.js` près de « Portail grossiste » (l. 423), visible avec `dansEspace("commerce") && droits.includes("facturation.voir")`

**Point d'étape** : T020 vert ; le parcours paiement à la livraison va de la commande au colis à encaisser.

---

## Phase 7 : étape E, diffusion à la Marketplace (US1, P1)

**Objectif** : chaque changement de stock vendable ou d'article de la boutique publie un événement, livré par les webhooks existants, pour que la Marketplace ne garde jamais un prix ou une quantité périmés (R1 ; fiche 6.3 et section 9).

**Test indépendant** : `tests/canalevenements.test.ts` (scénario S12).

- [X] T025 [P] [US1] Écrire `tests/canalevenements.test.ts` (lecture de `evenements` par `dansOrganisation(env.poolApp, …)`) : entrée de stock au lieu → `stock.disponibilite_modifiee` avec `produit_id`, `lieu_id` et `disponible` exact ; commande puis annulation → deux événements de disponibilité ; promotion (`POST /promotions`) et classement (`PUT /produits/:id/classement`) → `catalogue.article_modifie` ; simple changement de coût par une entrée de stock → pas de `catalogue.article_modifie` ; mouvement sur un lieu non déclaré et article GTA modifié → aucun événement
- [X] T026 [US1] Ajouter à `migrations/0046_canal_en_ligne.sql` les fonctions de déclencheur et déclencheurs décrits dans data-model.md (« Fonction et déclencheurs ») : `stock.disponibilite_modifiee` sur `mouvements_stock` (insert), `reservations_stock` et `avaries` (insert, update) pour les seuls lieux actifs d'une boutique active, charge calculée par `quantite_vendable()` ; `catalogue.article_modifie` sur `produits` (insert, update des seules colonnes publiques), `promotions`, `paliers_prix`, `photos_produits` (insert, update, delete) pour la seule branche d'une boutique active ; insertion dans `evenements` (`organisation_id`, `type`, `charge`)

**Point d'étape** : T025 vert ; la Marketplace peut tenir son cache à jour par webhook.

---

## Phase 8 : finitions

- [X] T027 [P] Mettre à jour `CLAUDE.md` : section « État », et entrée « Canal en ligne (`src/canalenligne.ts`, `public/canalenligne.js`, migration 0046) » dans « Limites connues » : routes `/marketplace/:org`, prix de la caisse, réservation par lieu (30 min, 24 h à la livraison), expiration chaque minute, événements par déclencheurs ; limites : pas de paiement en ligne ni de facture ou sortie de stock automatiques avant le lot 2, une commande livrée garde sa réservation jusqu'au lot 2, unité de base seulement, pas de description d'article, toutes les zones d'un lieu en ligne sont publiques, pas de notification, minuterie active seulement avec `webhooksAuto`
- [X] T028 [P] Mettre à jour `docs/Couverture du cahier des charges.md` : canal en ligne lot 1 couvert ; paiement, notifications et compte client à venir
- [X] T029 [P] Dans `docs/Fiche technique globale GLOMARI.md`, remplacer `src/canal_en_ligne.ts` par `src/canalenligne.ts` (l. 202 et l. 416) et ajouter `commande_web.confirmee` à la liste des événements (section 6.3)
- [X] T030 Relire `src/canalenligne.ts` : aucune requête publique avec `*` ni `cout_moyen` ; chaque route interne appelle `exigerSurEntite` ; chaque code passé à `ErreurApi` a son message dans `public/app.js` ; aucun secret
- [X] T031 Supprimer la base `erp_test`, lancer `npx tsc --noEmit` puis `TEST_ADMIN_URL=postgres://erp_proprio:erp_proprio@localhost:5432/postgres npm test` : tout vert avec le rôle restreint
- [ ] T032 Dérouler les scénarios et le contrôle manuel de `specs/001-glomari-plateforme-commerce/quickstart.md`
- [X] T033 Avec l'accord du responsable technique, pousser la branche, ouvrir la demande de fusion et attendre les contrôles GitHub au vert (`.github/workflows/verification.yml`)

---

## Dépendances et ordre d'exécution

### Entre phases

- **Phase 0** bloque tout : sans les points 1 et 2 du lot 0, pas de contrôle GitHub ni de lieux GLOMARI.
- **Phase 1** puis **phase 2** : T004 bloque toutes les routes ; T005 bloque T012 et T014 ; T006 bloque T022.
- **Étape A** : socle des étapes suivantes (boutique ouverte, `parBoutique`).
- **Étape B** : après A.
- **Étape C** : après B.
- **Étape D** : après B ; T020 utilise l'expiration (C).
- **Étape E** : après la phase 2 (déclencheurs sur les tables existantes) ; T025 utilise une commande (B).
- **Phase 8** : après les étapes voulues.

### Dans `src/canalenligne.ts`

T010 → T011 → T012 → T014 → T015 → T017 → T018 → T021 → T022 se suivent (même fichier). T019 (`src/serveur.ts`) dès T017. T026 et T004 touchent le même fichier de migration : T026 après T004.

### Parallélisable

- Phase 2 : T005, T006, T007, T008 après T004.
- Chaque fichier de test (T009, T013, T016, T020, T025) en parallèle de l'implémentation de son étape, et dès la phase 2.
- T023 (écran) en parallèle de T021 et T022.
- T027, T028, T029 en parallèle.

---

## Exemple de travail en parallèle : phase 2

```text
Tâche : « quantiteDisponible() dans src/stocks.ts » (T005)
Tâche : « creerColis() dans src/pilotage.ts » (T006)
Tâche : « Codes d'erreur dans public/app.js » (T007)
Tâche : « tests/canaloutils.ts » (T008)
```

## Exemple de travail en parallèle : étape D

```text
Tâche : « tests/canalgestion.test.ts » (T020)
Tâche : « Écran public/canalenligne.js » (T023)
Tâche : « Routes /commandes-web dans src/canalenligne.ts » (T021, puis T022)
```

---

## Stratégie

### MVP

Phases 0 à 2, puis étape A : la Marketplace affiche le catalogue réel de GLOMARI. Arrêt et validation (T009 vert).

### Livraison par étapes

1. A : catalogue, disponibilité, zones → prompt W3 de la Marketplace.
2. B : commande et réservation → prompt W4 ; « un seul stock » tenu.
3. C : libération chaque minute.
4. D : colis à encaisser et écran → essai du paiement à la livraison de bout en bout.
5. E : événements → cache de la Marketplace toujours juste.

La suite complète reste verte à chaque point d'étape.

---

## Notes

- Fichiers sans tiret bas (CLAUDE.md, décision du 21 novembre 2026) ; migration à la forme imposée `0046_canal_en_ligne.sql`.
- Questions ouvertes de la spécification non bloquantes pour le lot 1 : FR-011 (canal de notification, lot 4 ; valeur provisoire de la fiche : SMS et WhatsApp, désactivables), FR-012 (plafond du paiement à la livraison).
- Données fictives seulement : le verdict de CLAUDE.md (essai privé) s'applique.
