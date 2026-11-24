---

description: "Liste des tâches des comptes clients en ligne de GLOMARI (lot 4, partie B)"
---

# Tâches : comptes clients en ligne de GLOMARI (lot 4, partie B)

**Entrée** : documents de `specs/006-comptes-clients/` ; besoin : `docs/Fiche technique globale GLOMARI.md`, section 9 (lot 4, point 3) et W6

**Prérequis** : [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests** : demandés (fiche, lot 4 : « tests avec implémentations factices ; aucun appel réseau réel »). Dans chaque étape, le fichier de test s'écrit d'abord. Les tests tournent dans GitHub Actions (pas de PostgreSQL sur le poste).

**Contraintes de champ** : `data-model.md` fait foi ; les tâches citent `Entité.champ`.

## Format : `[ID] [P?] [Story] Description`

- **[P]** : parallélisable (autre fichier, aucune dépendance non terminée)
- **[US1]** à **[US5]** : parcours de la spécification

---

## Phase 1 : préparation

- [X] T001 Vérifier que la branche `lot4b-comptes-clients` part de `lot4a-messages-avis` (demande n° 9), et la remettre sur `main` dès la fusion de la n° 9 ; y versionner `specs/006-comptes-clients/`.
- [X] T002 Créer `src/comptesclients.ts` avec `enregistrerComptesClients(app, pool, outils, { prestataire, cleSecrets, codesParMinute, connexionsParMinute })` vide, et l'enregistrer dans `src/serveur.ts` après `enregistrerMessages`.
  - Ajouter `debitCanal.codes` (30 par défaut) et `debitCanal.connexions` (60 par défaut) aux options du serveur.
  - Dans `src/index.ts`, ajouter `ERP_CANAL_CODES_PAR_MINUTE` et `ERP_CANAL_CONNEXIONS_PAR_MINUTE`.

---

## Phase 2 : fondations (bloquent tous les parcours)

- [X] T003 Écrire `migrations/0052_comptes_clients.sql` selon data-model.md, sans modifier aucune migration existante.
  - Table `codes_connexion` : `codes_connexion.id`, `codes_connexion.organisation_id`, `codes_connexion.branche_id`, `codes_connexion.telephone`, `codes_connexion.code_hache`, `codes_connexion.essais`, `codes_connexion.expire_le`, `codes_connexion.utilise_le`, `codes_connexion.invalide_le`, `codes_connexion.envoi`, `codes_connexion.cree_le` ; checks et index.
  - Table `sessions_clients` : `sessions_clients.id`, `sessions_clients.organisation_id`, `sessions_clients.branche_id`, `sessions_clients.tiers_id`, `sessions_clients.telephone`, `sessions_clients.jeton_hache` (unique), `sessions_clients.cree_le`, `sessions_clients.expire_le`, `sessions_clients.revoque_le`, `sessions_clients.revoque_par` ; index.
  - Table `adresses_clients` : `adresses_clients.id`, `adresses_clients.organisation_id`, `adresses_clients.tiers_id`, `adresses_clients.nom`, `adresses_clients.zone_id`, `adresses_clients.adresse`, `adresses_clients.repere`, `adresses_clients.par_defaut` (index unique partiel), `adresses_clients.cree_le` ; audit.
  - RLS forcée, politique `cloison` et droits `erp_app` sur les trois tables, sans audit sur les codes ni les sessions.
- [X] T004 [P] Dans `public/app.js`, ajouter à `MESSAGES` : `code_trop_tot`, `sms_indisponible`, `code_incorrect`, `code_expire`, `nom_requis`, `session_invalide`, `adresses_max`. Vérifier que `zone_invalide`, `numero_invalide` et `solde_impossible` y sont.
- [X] T005 [P] Créer `tests/comptesoutils.ts`, à partir de `tests/messagesoutils.ts` :
  - `demanderCode(numero)` (`POST /marketplace/:org/compte/code`) ;
  - `codeRecu(numero)` : dernier code envoyé à ce numéro, lu dans le prestataire factice ;
  - `connecter(numero, nom?)` : demande puis saisie du code, rend le jeton ;
  - `client(jeton)` : appels aux routes `/marketplace/:org/compte/…` avec `Authorization: Client <jeton>`.
- [X] T006 [P] Dans `src/canalenligne.ts`, extraire `trouverFicheClient(c, branche, telephone)` de `ficheClient`, déterministe (`order by cree_le, id`), et l'exporter ; `ficheClient` l'appelle (research.md R4).

**Point d'étape** : la migration s'applique, `npx tsc --noEmit` passe, toute la suite existante reste verte.

---

## Phase 3 : parcours 1, se connecter avec son téléphone et un code SMS (P1) 🎯 MVP

**Objectif** : code à six chiffres envoyé aussitôt, protégé, limité ; session de 7 jours sur la fiche existante ou une fiche créée (FR-001 à FR-007, FR-017).

**Test indépendant** : `tests/comptesconnexion.test.ts` (scénarios Q1 à Q6 de quickstart.md).

- [X] T007 [P] [US1] Écrire `tests/comptesconnexion.test.ts` :
  - Q1 : même réponse pour un numéro connu et un numéro inconnu ; un SMS à six chiffres chacun, la nuit comme le jour ; en base, `codes_connexion.code_hache` ne contient pas le code ;
  - Q2 : mauvais code → `401 code_incorrect` (4 essais restants) ; bon code → jeton, `expire_le` à 7 jours ; bon code rejoué → `401 code_expire` ;
  - Q3 : cinq codes faux → code invalidé, le bon donne `401 code_expire` ; journal `compte_client.blocage` ;
  - Q4 : deuxième demande dans la minute → `409 code_trop_tot` avec `attendre_secondes` ; plus de trois en un quart d'heure, plus de dix en 24 heures (dates reculées par le compte d'administration de la base de test) ; un nouveau code invalide l'ancien ;
  - Q5 : numéro inconnu, bon code sans nom → `409 nom_requis`, puis avec nom → fiche client créée dans la branche, retrouvée par la commande en ligne suivante ;
  - Q6 : numéro fixe → `400 numero_invalide` sans SMS ; prestataire en panne → `503 sms_indisponible` compté dans les limites ; débit de la boutique dépassé → `429`.
- [X] T008 [US1] Dans `src/comptesclients.ts`, `POST /marketplace/:org/compte/code` selon contracts/routes.md (research.md R1 à R3) :
  - `parBoutique`, débit `codesParMinute`, `mobileCamerounais` ;
  - limites par numéro sous le verrou consultatif `code:<numéro>`, à partir de `codes_connexion.cree_le` ;
  - les codes encore valables du numéro reçoivent `codes_connexion.invalide_le` ;
  - nouveau code : `codes_connexion.code_hache` (HMAC avec `cleSecrets`), `codes_connexion.expire_le`, `codes_connexion.branche_id`, `codes_connexion.telephone` ;
  - envoi immédiat par le prestataire, puis `codes_connexion.envoi` ; `503 sms_indisponible` sans prestataire ou en échec ; réponse identique pour un numéro connu ou non.
- [X] T009 [US1] Dans `src/comptesclients.ts` :
  - `POST /marketplace/:org/compte/connexion` (research.md R4, R5) : débit `connexionsParMinute` ; dernier code valable du numéro ; comparaison en temps constant ; `codes_connexion.essais` et, au cinquième, `codes_connexion.invalide_le` et le journal `compte_client.blocage` ;
  - au bon code : fiche par `trouverFicheClient`, sinon `409 nom_requis` ou création par `ficheClient` ; puis `codes_connexion.utilise_le` ;
  - session : `sessions_clients.tiers_id`, `sessions_clients.branche_id`, `sessions_clients.telephone`, `sessions_clients.jeton_hache`, `sessions_clients.expire_le` ; journal `compte_client.connexion` ;
  - `clientConnecte(c, b, req)` : en-tête `Authorization: Client <jeton>`, session non révoquée ni échue, fiche de la branche ni archivée ni fusionnée, téléphone inchangé, sinon `401 session_invalide` ;
  - `GET /marketplace/:org/compte` (client et échéance de la session).

**Point d'étape** : T007 vert ; un client se connecte sans mot de passe, et les abus sont bloqués.

---

## Phase 4 : parcours 2, retrouver ses commandes et ses précommandes (P1)

**Objectif** : historique des commandes en ligne et des précommandes de la fiche, solde payable depuis l'espace (FR-008 à FR-010).

**Test indépendant** : `tests/comptesespace.test.ts` (scénarios Q7 et Q8).

- [X] T010 [P] [US2] Écrire `tests/comptesespace.test.ts` :
  - Q7 : deux commandes et une précommande passées avec le numéro du client, une commande d'un autre client → les siennes seulement, avec lignes, statut et lien de suivi du colis ; aucun achat en caisse ;
  - Q8 : précommande arrivée → `POST …/compte/precommandes/:reference/solde` rend la commande du solde et son jeton ; paiement par la route existante et le prestataire factice → précommande soldée ; précommande d'un autre client → `404`.
- [X] T011 [P] [US2] Dans `src/canalenligne.ts`, extraire `detailCommandeWeb(c, b, condition)` de `GET /marketplace/:org/commandes/:reference` (colonnes, lignes, colis) et l'exporter ; la route par lien l'appelle (research.md R6).
- [X] T012 [P] [US2] Dans `src/precommandes.ts`, extraire et exporter `detailPrecommande(c, inscription)` (de `GET /marketplace/:org/precommandes/:reference`) et `creerCommandeSolde(c, boutique, inscriptionId, choix)` (de `POST …/solde`) ; les routes par lien les appellent, sans changement de comportement.
- [X] T013 [US2] Dans `src/comptesclients.ts`, `GET /marketplace/:org/compte/commandes` (100 dernières de la fiche), `GET /marketplace/:org/compte/precommandes` et `POST /marketplace/:org/compte/precommandes/:reference/solde`, selon contracts/routes.md, avec `clientConnecte` ; une ressource d'une autre fiche rend `404`.

**Point d'étape** : T010 vert ; le client retrouve ses achats en ligne sans les liens reçus.

---

## Phase 5 : parcours 3, enregistrer ses adresses et son profil (P2)

**Objectif** : cinq adresses au plus, une par défaut ; nom et e-mail modifiables (FR-011, FR-012).

**Test indépendant** : `tests/comptesadresses.test.ts` (scénario Q9).

- [X] T014 [P] [US3] Écrire `tests/comptesadresses.test.ts` :
  - Q9 : cinq adresses puis une sixième → `409 adresses_max` ; changement du « par défaut » → une seule ; modification et suppression ; zone d'une autre branche → `400 zone_invalide` ; adresse d'un autre client → `404` ;
  - profil : nom et e-mail modifiés ; le téléphone ne change pas.
- [X] T015 [US3] Dans `src/comptesclients.ts`, routes `GET`, `POST`, `PUT /:id` et `DELETE /:id` de `/marketplace/:org/compte/adresses`, et `PATCH /marketplace/:org/compte`, selon contracts/routes.md :
  - champs `adresses_clients.nom`, `adresses_clients.zone_id` (zone de la branche de la boutique), `adresses_clients.adresse`, `adresses_clients.repere`, `adresses_clients.par_defaut` ;
  - au plus cinq sous le verrou de la fiche (`ADRESSES_MAX`) ; un seul « par défaut » (research.md R7) ;
  - `PATCH` écrit le nom et l'e-mail de la fiche, jamais le téléphone.

**Point d'étape** : T014 vert ; le client commande plus vite.

---

## Phase 6 : parcours 4, consulter ses points de fidélité (P2)

**Objectif** : solde, valeur et mouvements de la branche (FR-013).

**Test indépendant** : `tests/comptesfidelite.test.ts` (scénario Q10).

- [X] T016 [P] [US4] Écrire `tests/comptesfidelite.test.ts` :
  - Q10 : programme actif, points gagnés puis utilisés en caisse sur la fiche → solde, valeur en FCFA et mouvements exacts ;
  - programme inactif → `actif: false` ;
  - points d'une fiche de GTA au même numéro → absents.
- [X] T017 [US4] Dans `src/comptesclients.ts`, `GET /marketplace/:org/compte/fidelite` (research.md R8) : solde de `points_fidelite` de la fiche, règle de `regles_fidelite` de la branche, 50 derniers mouvements.

**Point d'étape** : T016 vert ; le client voit ses points.

---

## Phase 7 : parcours 5, se déconnecter partout et garder son compte sûr (P2)

**Objectif** : déconnexion d'un appareil ou de tous, révocation par l'équipe Care, refus après un changement de fiche, code d'essai (FR-014 à FR-016, FR-018).

**Test indépendant** : `tests/comptessessions.test.ts` (scénarios Q11 à Q13).

- [X] T018 [P] [US5] Écrire `tests/comptessessions.test.ts` :
  - Q11 : deux appareils, déconnexion de tous → `401 session_invalide` pour les deux ; session de plus de 7 jours (date reculée par le compte d'administration) → refusée ; équipe Care (`care.gerer`) → révocation tracée avec `sessions_clients.revoque_par` ; fiche archivée, fusionnée dans une autre, téléphone changé → refusée ; `GET /tiers/:id` montre `compte_en_ligne` ;
  - Q12 : `GET /messages/code-essai` avec `entites.gerer` → le code ; sans ce droit → `403` ; serveur sans prestataire factice → `404` ;
  - Q13 : jeton d'une organisation utilisé auprès d'une autre → `404` ; boutique fermée → espace introuvable.
- [X] T019 [US5] Dans `src/comptesclients.ts` :
  - `POST /marketplace/:org/compte/deconnexion` : `sessions_clients.revoque_le` sur la session, ou sur toutes celles de la fiche avec `{ tous: true }` (journal `compte_client.deconnexion_tous`) ;
  - `POST /tiers/:id/comptes-en-ligne/deconnexion` (`care.gerer` sur la branche de la fiche) : `sessions_clients.revoque_le` et `sessions_clients.revoque_par`.
- [X] T020 [US5] Dans `src/serveur.ts`, `GET /tiers/:id` ajoute `compte_en_ligne` (sessions ouvertes non échues, dernière connexion).
- [X] T021 [P] [US5] Dans `src/relation.ts`, fusion de deux fiches : révoquer les sessions du doublon et retirer le « par défaut » de ses adresses avant le report des liens ; ajouter `sessions_clients.tiers_id` et `adresses_clients.tiers_id` à `LIENS_TIERS` (research.md R9).
- [X] T022 [P] [US5] Dans `src/messages.ts`, `GET /messages/code-essai?telephone=` : seulement avec le prestataire factice (sinon `404`), droit `entites.gerer` sur toute l'organisation, dernier code lu dans la mémoire du prestataire, jamais en base (research.md R10).
- [X] T023 [P] [US5] Interface :
  - dans `public/relation.js`, sur la fiche client : appareils connectés, dernière connexion, bouton « Déconnecter tous ses appareils » (`care.gerer`) ;
  - dans `public/messages.js`, avec le prestataire factice et `entites.gerer` : formulaire « Code d'essai » qui lit le dernier code d'un numéro.

**Point d'étape** : T018 vert ; un téléphone perdu ne laisse plus le compte ouvert.

---

## Phase 8 : finitions

- [X] T024 [P] Mettre à jour `CLAUDE.md` :
  - état : lot 4, partie B livrée ;
  - entrée « Comptes clients en ligne » : code, limites, session de 7 jours, fiche existante, historique sans les achats en caisse (décision du 23 novembre 2026), adresses, fidélité, révocation, code d'essai ;
  - limites.
- [X] T025 [P] Mettre à jour `docs/Couverture du cahier des charges.md` (Commerce, CRM, Intégrations).
- [X] T026 [P] Dans `docs/Fiche technique globale GLOMARI.md` : section 9 lot 4, état de la partie B ; section 6.1, routes `/marketplace/:org/compte/…`.
- [X] T027 [P] Dans `docs/Guide de mise en ligne.md`, section « Comptes clients » : débits `ERP_CANAL_CODES_PAR_MINUTE` et `ERP_CANAL_CONNEXIONS_PAR_MINUTE`, code d'essai avec le prestataire factice seulement, prestataire réel requis avant l'ouverture au public.
- [X] T028 Relire `src/comptesclients.ts` et les ajouts :
  - aucun code ni jeton en clair, en base ou dans les journaux du serveur ;
  - chaque code passé à `ErreurApi` présent dans `MESSAGES` ;
  - toute lecture filtrée par la fiche de la session ;
  - aucune donnée de GTA ;
  - aucun appel réseau dans les tests ;
  - la règle « aucun nom déclaré deux fois » des écrans respectée.
- [X] T029 Lancer `npx tsc --noEmit` et la suite complète avec le rôle restreint par le contrôle GitHub (`.github/workflows/verification.yml`) : tout vert.
- [X] T030 Dérouler les scénarios de `specs/006-comptes-clients/quickstart.md` (automatisés par les tests ; essai privé sur serveur quand il existera).
- [X] T031 Après la fusion de la demande n° 9 et avec l'accord du responsable technique, remettre la branche sur `main`, la pousser, ouvrir la demande de fusion et attendre le contrôle GitHub au vert.

---

## Dépendances et ordre d'exécution

- **Phase 1** puis **phase 2** : T003 bloque tout ; T005 bloque les tests ; T006 bloque T009.
- **Parcours 1** : bloque les autres, qui ont besoin d'une session (T009).
- **Parcours 2 à 5** : indépendants entre eux une fois le parcours 1 fait, mais tous écrivent dans `src/comptesclients.ts`.
- Même fichier, donc dans l'ordre :
  - `src/comptesclients.ts` : T002 → T008 → T009 → T013 → T015 → T017 → T019 ;
  - `src/serveur.ts` : T002 → T020.
- **Parallélisable** :
  - T004, T005 et T006 après T003 ;
  - chaque fichier de test (T007, T010, T014, T016, T018) dès la phase 2 ;
  - T011, T012, T021 et T022 seuls dans leur fichier ;
  - T023 avec les tâches serveur du parcours 5 ;
  - T024 à T027 ensemble.

## Exemple de travail en parallèle : parcours 2

```text
Tâche : « tests de l'historique » (T010, tests/comptesespace.test.ts)
Tâche : « suivi de commande extrait » (T011, src/canalenligne.ts)
Tâche : « précommande et solde extraits » (T012, src/precommandes.ts)
```

## Exemple de travail en parallèle : parcours 5

```text
Tâche : « tests des sessions » (T018, tests/comptessessions.test.ts)
Tâche : « fusion et sessions » (T021, src/relation.ts)
Tâche : « code d'essai » (T022, src/messages.ts)
Tâche : « écrans » (T023, public/relation.js et public/messages.js)
```

## Stratégie

- **MVP** : phases 1 et 2, puis parcours 1. Un client se connecte sans mot de passe, avec un code protégé et limité.
- **Ensuite** : parcours 2 (historique), le plus attendu ; puis parcours 3 et 4 (adresses, fidélité) ; puis parcours 5 (sécurité des sessions) ; puis les finitions.
