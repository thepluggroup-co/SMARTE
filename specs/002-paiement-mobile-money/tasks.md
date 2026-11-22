---

description: "Liste des tâches du paiement Mobile Money des commandes en ligne (lot 2)"
---

# Tâches : paiement Mobile Money des commandes en ligne GLOMARI (lot 2)

**Entrée** : documents de `specs/002-paiement-mobile-money/` ; besoin : `docs/Fiche technique globale GLOMARI.md`, section 9 (lot 2)

**Prérequis** : [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests** : demandés (fiche, lot 2 : « avis non signé, avis rejoué, montant faux, paiement tardif »). Dans chaque étape, le fichier de test s'écrit d'abord et doit échouer avant l'implémentation. Prestataire factice seulement : aucun argent réel, aucun réseau.

**Contraintes de champ** : `data-model.md` fait foi ; les tâches citent `Entité.champ`.

## Format : `[ID] [P?] [Story] Description`

- **[P]** : parallélisable (autre fichier, aucune dépendance non terminée)
- **[US1]** à **[US4]** : parcours de la spécification

---

## Phase 1 : préparation

- [X] T001 Vérifier que la branche `lot2-paiement-mobile-money` part de `main` à jour (lot 1 et import des clients fusionnés) et y versionner `specs/002-paiement-mobile-money/`
- [X] T002 Créer `src/paiementenligne.ts` avec les types `MoyenEnLigne`, `DemandePaiement`, `AvisPaiement`, `PrestatairePaiement` de contracts/prestataire.md et une fonction vide `enregistrerPaiementEnLigne(app: FastifyInstance, pool: pg.Pool, outils: Outils, options: { prestataires: PrestatairePaiement[]; urlPublique: string; paiementsParMinute: number })` ; dans `src/serveur.ts`, ajouter à `OptionsServeur` (l. 82 à 104) `prestatairesPaiement?: PrestatairePaiement[]` et `debitCanal?: { commandes?: number; paiements?: number }`, puis appeler la fonction juste après `enregistrerCanalEnLigne(...)`

---

## Phase 2 : fondations (bloquent tous les parcours)

- [X] T003 Écrire `migrations/0048_paiement_en_ligne.sql` selon data-model.md : table `paiements_en_ligne` (`paiements_en_ligne.id`, `paiements_en_ligne.organisation_id`, `paiements_en_ligne.commande_id`, `paiements_en_ligne.prestataire`, `paiements_en_ligne.moyen`, `paiements_en_ligne.reference_prestataire`, `paiements_en_ligne.montant`, `paiements_en_ligne.statut`, `paiements_en_ligne.motif`, `paiements_en_ligne.lance_le`, `paiements_en_ligne.traite_le`, avec la clé unique `(organisation_id, prestataire, reference_prestataire)`, le check entre statut et motif, les index) ; table `avis_paiement` (`avis_paiement.id`, `avis_paiement.organisation_id`, `avis_paiement.prestataire`, `avis_paiement.reference_prestataire`, `avis_paiement.signature_valide`, `avis_paiement.issue`, `avis_paiement.montant`, `avis_paiement.recu_le`) ; sur `commandes_web`, recréer la contrainte de `commandes_web.statut` avec `a_rembourser`, supprimer la contrainte du colis réservée au paiement à la livraison en la retrouvant par `pg_get_constraintdef` dans un bloc `do $$`, ajouter `commandes_web.facture_id` ; ajouter `config_canal.responsable_id` ; RLS forcée et politique `cloison` sur les deux tables nouvelles (bloc de `migrations/0046_canal_en_ligne.sql`), audit sur `paiements_en_ligne`, `grant select, insert, update on paiements_en_ligne` et `grant select, insert on avis_paiement` à `erp_app` ; ne modifier aucune migration existante
- [X] T004 [P] Dans `src/facturation.ts`, sortir `creerBrouillon` (l. 280 à 297) et `emettre` (l. 299 à 347) au niveau du module, exportées, avec `exigerSurEntite` en paramètre ; les routes les appellent sans changer de comportement ; ajouter à `LigneSaisie` un champ interne `brutHt?: number`, transmis par `ecrireLignes` à `calculerLigne` comme montant exact quand il est fourni, et absent de `schemaLignes` ; `tests/facturation.test.ts`, `tests/mall.test.ts` et `tests/magasins.test.ts` restent verts
- [X] T005 Dans `src/paiementenligne.ts`, écrire `prestataireFactice(secret)` et `signerAvisFactice(secret, corps)` selon contracts/prestataire.md (« Prestataire factice ») : HMAC SHA-256 hexadécimal du corps brut dans l'en-tête `x-signature`, comparaison par `timingSafeEqual`, `verifierAvis` qui renvoie `null` pour une signature absente, fausse ou un corps illisible, sans lever d'exception
- [X] T006 [P] Dans `src/index.ts`, passer `prestatairesPaiement: process.env.ERP_PAIEMENT_FACTICE_SECRET ? [prestataireFactice(process.env.ERP_PAIEMENT_FACTICE_SECRET)] : []` à `creerServeur`, sur le modèle de `generateurIa` (l. 20) ; ajouter `ERP_PAIEMENT_FACTICE_SECRET=` commenté « essai privé seulement, jamais avec de vraies données » dans `.env.example`
- [X] T007 [P] Dans `public/app.js`, ajouter à `MESSAGES` `paiement_indisponible`, `paiement_impossible`, `avis_refuse`, `vente_deja_terminee` (textes de contracts/routes-publiques.md)
- [X] T008 [P] Dans `src/canalenligne.ts` : `POST /canal-config` avec `actif: true` renseigne `config_canal.responsable_id` = `ctx.utilisateurId` ; `GET /canal-config` renvoie le nom du responsable ; la limite de `POST /marketplace/:org/commandes` vient de `debitCanal.commandes` (20 par défaut) au lieu d'être fixée dans le code (ajouter le paramètre à `enregistrerCanalEnLigne` et le passer depuis `src/serveur.ts`)
- [X] T009 [P] Permettre de passer des options à `environnement(options?)` dans `tests/outils.ts` (fusionnées dans `OPTIONS`), puis créer `tests/paiementoutils.ts` : `SECRET` de test ; `environnementPaiement()` avec `prestatairesPaiement: [prestataireFactice(SECRET)]` et `debitCanal: { commandes: 1000, paiements: 1000 }` ; `boutiquePayante(env)` qui reprend `boutique()` de `tests/canaloutils.ts`, règle l'identité vendeur de la branche (`PATCH /entites/:id/identite`), crée les portefeuilles Orange Money et MTN MoMo (`POST /portefeuilles`) et les désigne par défaut (`PUT /portefeuilles/defauts`) ; `payer(env, org, commande)` ; `avis(env, org, corps, signature?)` qui envoie le corps brut avec `x-signature` (signé par défaut avec `signerAvisFactice`) ; `referencePaiement(b, commande)` lue en base

**Point d'étape** : la migration s'applique, `npx tsc --noEmit` passe, toute la suite existante reste verte.

---

## Phase 3 : parcours 1, payer et recevoir la vente terminée (P1) 🎯 MVP

**Objectif** : un avis signé de réussite termine seul la vente : encaissement, facture au franc près avec sortie du stock réservé, colis (FR-001 à FR-005, FR-010, FR-011, FR-013, FR-020 à FR-024).

**Test indépendant** : `tests/paiementvente.test.ts` (scénarios P1, P2, P6, P11 de quickstart.md).

- [X] T010 [P] [US1] Écrire `tests/paiementvente.test.ts` avec `tests/paiementoutils.ts` : P1 (Orange Money, 2 pièces sur 3, livraison à domicile : facture `emis` au total exact de la commande, stock du lieu à 1 sans double décompte, réservation levée, mouvement d'encaissement du total dans le portefeuille Orange Money, colis créé, suivi `facturee` avec colis, événements `commande_web.payee` et `commande_web.facturee`) ; P2 (MTN MoMo et retrait au magasin : portefeuille MTN, aucun colis) ; P6 (avis d'échec : paiement `echoue`, commande toujours réservée ; nouveau lancement puis réussite) ; P11 (sans prestataire ou boutique sans responsable : `503 paiement_indisponible` ; commande à la livraison ou expirée : `409 paiement_impossible`) ; article vendu par tranches : facture égale au centime près à la commande
- [X] T011 [US1] Dans `src/paiementenligne.ts`, route `POST /marketplace/:org/commandes/:reference/payer` selon contracts/routes-publiques.md : débit `paiementsParMinute` ; référence et jeton contrôlés comme le suivi du lot 1 (`hacherJeton`) ; commande `reservee`, sans colis, non échue, moyen `orange_money` ou `mtn_momo`, sinon `409 paiement_impossible` ; prestataire du moyen et `config_canal.responsable_id` présents, sinon `503 paiement_indisponible` ; `initier` hors transaction avec `adresseAvis` = `${urlPublique}/paiements/avis/${nom}/${org}` ; enregistrement de `paiements_en_ligne.statut` `lance`, `paiements_en_ligne.montant` = `commandes_web.total_ttc`, `paiements_en_ligne.reference_prestataire` et `paiements_en_ligne.prestataire` ; réponse 201
- [X] T012 [US1] Dans `src/paiementenligne.ts`, écrire `terminerVente(c, contexteResponsable, commande, referenceOperateur)` selon research.md section 5, étape « vente », au nom de `config_canal.responsable_id` (contexte sans `definirActeur`, `journal_evenement('canal.vente_automatique', …)`) : `leverReservations`, `creerBrouillon` sur la branche (lignes avec `produitId`, `quantite`, `prixUnitaire` = `prix_unitaire_ht`, `tauxTaxe`, `brutHt` = `lignes_commande_web.total_ht` ; `fraisLivraison` = `commandes_web.frais_livraison`, `tauxFrais` 0), `emettre` avec `entrepotId` = `commandes_web.lieu_id`, insertion du règlement (`REG-AAAA`, moyen, `reference` = référence de l'opérateur, `encaisse_par` = responsable), `creerColis` sauf pour `retrait_magasin`, `commandes_web.statut` `facturee`, `commandes_web.facture_id`, événement `commande_web.facturee`
- [X] T013 [US1] Dans `src/paiementenligne.ts`, route `POST /paiements/avis/:prestataire/:org` dans un sous-contexte Fastify encapsulé (`app.register`) qui lit `application/json` comme texte (`addContentTypeParser(..., { parseAs: "string" })`), débit 300 par minute : prestataire inconnu ou organisation mal formée → `404` ; `verifierAvis` nul → `401 avis_refuse` ; dans `dansOrganisation(pool, org, …)`, verrou `for update` sur le paiement trouvé par `(prestataire, reference_prestataire)` puis sur la commande ; avis d'échec → `paiements_en_ligne.statut` `echoue`, `paiements_en_ligne.traite_le` ; avis de réussite pour une commande `reservee` non échue → paiement `reussi`, commande `payee`, événement `commande_web.payee`, puis `terminerVente` (T012) ; réponse `200 { recu, issue, statut }`
- [X] T014 [P] [US1] Compléter `GET /commandes-web/:id` dans `src/canalenligne.ts` (facture, responsable, paiements de la commande) et l'afficher dans le détail de `public/canalenligne.js` (référence de l'opérateur, état du paiement, numéro de facture)

**Point d'étape** : T010 vert ; une commande payée est vendue sans saisie.

---

## Phase 4 : parcours 2, ne jamais croire un faux avis ni compter deux fois (P1)

**Objectif** : avis non signé, rejoué, au mauvais montant, inconnu ou adressé à une autre organisation : aucun effet, une trace (FR-006 à FR-009).

**Test indépendant** : `tests/paiementavis.test.ts` (scénarios P3, P4, P5, P13).

- [X] T015 [P] [US2] Écrire `tests/paiementavis.test.ts` : avis sans `x-signature` et avis mal signé → `401`, aucune facture, `avis_paiement.issue` `signature_invalide` ; même avis valide envoyé trois fois → une facture, un règlement, un mouvement de portefeuille, deux réponses `deja_traite` ; avis signé au mauvais montant → `409`, commande `reservee`, issue `montant_different` ; référence inconnue → `404`, issue `inconnu` ; avis valide adressé à l'organisation B pour un paiement de A → `404`, rien ne change dans A ni B
- [X] T016 [US2] Dans `src/paiementenligne.ts`, compléter la route d'avis : chaque réception écrit une ligne `avis_paiement` (`avis_paiement.prestataire`, `avis_paiement.reference_prestataire`, `avis_paiement.signature_valide`, `avis_paiement.issue`, `avis_paiement.montant`), y compris pour les refus (dans une transaction séparée de celle de la vente, pour que la trace reste même si la vente est annulée) ; paiement déjà `reussi`, `echoue` ou `a_rembourser` → `200` issue `deja_traite` ; montant de l'avis ≠ `paiements_en_ligne.montant` → `409 avis_refuse`, issue `montant_different` ; erreur `RP001` du règlement traitée comme `deja_traite`

**Point d'étape** : T015 vert ; aucun faux avis ni rejeu ne change la caisse ou le stock.

---

## Phase 5 : parcours 3, paiement tardif ou en trop, vente à terminer (P2)

**Objectif** : jamais de vente sans stock ; un paiement tardif ou en trop est encaissé et confié au trésorier ; une vente qui ne peut pas se terminer garde le paiement (FR-012, FR-014 à FR-017).

**Test indépendant** : `tests/paiementrembourser.test.ts` (scénarios P7, P8, P9).

- [X] T017 [P] [US3] Écrire `tests/paiementrembourser.test.ts` : P7 (commande échue par `expire_le` dans le passé, avant et après `executerTaches` : commande et paiement `a_rembourser` motif `expiree`, mouvement d'encaissement du montant, aucune facture ni sortie de stock, une tâche pour le titulaire de `tresorerie.gerer`) ; commande annulée puis avis → motif `annulee` ; P8 (commande facturée puis second paiement réussi : commande inchangée, second paiement `a_rembourser` motif `deja_payee`, une seule facture) ; P9 (identité vendeur effacée avant l'avis : commande `payee`, réservation gardée, tâche « vente à terminer » ; identité rétablie puis `POST /commandes-web/:id/terminer` → `facturee`, une seule facture ; second appel → `409 vente_deja_terminee`)
- [X] T018 [US3] Dans `src/paiementenligne.ts`, branche « à rembourser » de la route d'avis selon research.md section 6 : commande `reservee` échue d'abord expirée (`leverReservations`, `expiree`) ; `paiements_en_ligne.statut` `a_rembourser` avec `paiements_en_ligne.motif` ; `commandes_web.statut` `a_rembourser` si elle était expirée ou annulée ; `select tresorerie_encaisser(org, branche, moyen, montant, libellé, référence, 'paiement_en_ligne', id)` ; une `taches` par titulaire de `tresorerie.gerer` sur la branche (`titulaires`, `src/performance.ts`), à défaut au responsable, `cree_par` = responsable, échéance le lendemain ; `journal_evenement` et événement `commande_web.a_rembourser`
- [X] T019 [US3] Dans `src/paiementenligne.ts`, protéger l'appel de `terminerVente` par un point de sauvegarde (`savepoint vente` / `rollback to savepoint vente`) : en cas d'échec, la commande reste `payee` avec sa réservation, une tâche « vente à terminer » va aux titulaires de `facturation.administrer` de la branche, journal ; puis route `POST /commandes-web/:id/terminer` selon contracts/routes-internes.md (`facturation.gerer` sur la branche, commande `payee` avec paiement `reussi` sinon `409 vente_deja_terminee`, `terminerVente` dans la transaction de la requête)
- [X] T020 [P] [US3] Dans `public/canalenligne.js`, bouton « Terminer la vente » pour une commande `payee` (`facturation.gerer`), libellés des états `payee`, `facturee`, `a_rembourser`

**Point d'étape** : T017 vert ; aucun paiement perdu, aucune vente sans stock.

---

## Phase 6 : parcours 4, rapprocher au franc près (P3)

**Objectif** : le trésorier retrouve chaque paiement en ligne du jour par moyen, avec facture, portefeuille et total (FR-018, FR-019 ; SC-001).

**Test indépendant** : `tests/paiementrapprochement.test.ts` (scénarios P10, P12).

- [X] T021 [P] [US4] Écrire `tests/paiementrapprochement.test.ts` : P12 (20 commandes, 10 Orange Money et 10 MTN MoMo, toutes payées par avis : `GET /paiements-en-ligne` du jour donne 20 lignes et un total égal à la somme des avis, au franc près ; filtre par moyen : 10 et 10) ; P10 (branche sans portefeuille par défaut Mobile Money : vente terminée, montant dans les encaissements en attente, ligne marquée `en_attente`) ; un utilisateur sans `tresorerie.voir` ni `facturation.voir` → `403`
- [X] T022 [US4] Dans `src/paiementenligne.ts`, route `GET /paiements-en-ligne` selon contracts/routes-internes.md : branches de `tresorerie.voir` et `facturation.voir`, jour de Douala sur `paiements_en_ligne.traite_le`, filtres `moyen` et `statut`, référence de commande, numéro de facture (par `commandes_web.facture_id`), portefeuille du mouvement d'encaissement ou `en_attente`, total et nombre des paiements `reussi` et `a_rembourser`
- [X] T023 [P] [US4] Dans `public/canalenligne.js`, onglet « Paiements en ligne » (jour, moyen, total, paiements à rembourser), visible avec `tresorerie.voir` ou `facturation.voir`

**Point d'étape** : T021 vert ; la recette des 20 paiements se lit dans l'ERP.

---

## Phase 7 : finitions

- [X] T024 [P] Mettre à jour `CLAUDE.md` : décision du 22 novembre 2026 (double authentification reportée, reste activable par chacun) dans « À faire ensuite » ; entrée « Paiement en ligne (`src/paiementenligne.ts`, migration 0048, lot 2) » dans « Limites connues » (prestataire factice seulement, réel à brancher ; ventes automatiques au nom du responsable de la boutique ; adresse d'avis avec l'organisation ; remboursement manuel ; écritures comptables de ces encaissements à valider par l'expert-comptable ; débits réglables par `debitCanal`)
- [X] T025 [P] Mettre à jour `docs/Couverture du cahier des charges.md` (Facturation et Intégrations : paiement Mobile Money, circuit complet avec prestataire factice, prestataire réel à brancher)
- [X] T026 [P] Dans `docs/Fiche technique globale GLOMARI.md`, section 9 lot 2 et section 6.2 : `src/paiementenligne.ts` et `POST /paiements/avis/:prestataire/:org`
- [X] T027 [P] Dans `docs/Guide de mise en ligne.md`, `ERP_PAIEMENT_FACTICE_SECRET` pour l'essai privé seulement, et portefeuilles par défaut Mobile Money à régler avant d'ouvrir le paiement
- [X] T028 Relire `src/paiementenligne.ts` : signature en temps constant, aucun secret dans le code, aucune donnée personnelle dans les réponses publiques, chaque code passé à `ErreurApi` présent dans `MESSAGES`
- [ ] T029 Lancer `npx tsc --noEmit` et la suite complète avec le rôle restreint par le contrôle GitHub (`.github/workflows/verification.yml`) : tout vert
- [ ] T030 Dérouler les scénarios de `specs/002-paiement-mobile-money/quickstart.md` (automatisés par les tests ; essai privé sur serveur quand il existera)
- [ ] T031 Avec l'accord du responsable technique, pousser la branche, ouvrir la demande de fusion et attendre le contrôle GitHub au vert (`.github/workflows/verification.yml`)

---

## Dépendances et ordre d'exécution

- **Phase 1** puis **phase 2** : T003 bloque tout ; T004 bloque T012 ; T005 bloque T010 et T013 ; T008 bloque T011.
- **Parcours 1** : socle des suivants (lancement, vente automatique, route d'avis).
- **Parcours 2** : après T013 (même route).
- **Parcours 3** : après T013 ; T019 enveloppe T012.
- **Parcours 4** : après le parcours 1 (il faut des paiements).
- Dans `src/paiementenligne.ts`, T005 → T011 → T012 → T013 → T016 → T018 → T019 → T022 se suivent (même fichier).
- **Parallélisable** : T004, T006, T007, T008, T009 après T003 ; chaque fichier de test (T010, T015, T017, T021) dès la phase 2 ; T014, T020, T023 en parallèle des routes de leur parcours ; T024 à T027 ensemble.

## Exemple de travail en parallèle : phase 2

```text
Tâche : « creerBrouillon et emettre exportés, brutHt » (T004, src/facturation.ts)
Tâche : « prestataire factice dans index.ts » (T006)
Tâche : « codes d'erreur » (T007, public/app.js)
Tâche : « responsable de la boutique et débit réglable » (T008, src/canalenligne.ts)
Tâche : « outils de test » (T009, tests/)
```

## Stratégie

- **MVP** : phases 1 et 2, puis parcours 1 : un paiement factice termine une vente de bout en bout.
- **Ensuite** : parcours 2 (sécurité des avis), indispensable avant tout prestataire réel ; parcours 3 (tardif, à terminer) ; parcours 4 (rapprochement, recette).
- **Branchement réel** : après le choix de la direction, un fichier par prestataire dans `src/`, sans toucher au reste ; la suite de tests doit rester identique (SC-006).
