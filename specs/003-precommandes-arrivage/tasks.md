---

description: "Liste des tâches des précommandes d'arrivage GLOMARI avec acompte (lot 3, partie A)"
---

# Tâches : précommandes d'arrivage GLOMARI avec acompte (lot 3, partie A)

**Entrée** : documents de `specs/003-precommandes-arrivage/` ; besoin : `docs/Fiche technique globale GLOMARI.md`, section 9 (lot 3), règle R4

**Prérequis** : [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests** : demandés (fiche, lot 3 : « seuil atteint = un seul brouillon ; acompte jamais compté deux fois ; GTA ne voit rien »). Dans chaque étape, le fichier de test s'écrit d'abord et doit échouer avant l'implémentation. Prestataire factice seulement : aucun argent réel, aucun réseau.

**Contraintes de champ** : `data-model.md` fait foi ; les tâches citent `Entité.champ`.

## Format : `[ID] [P?] [Story] Description`

- **[P]** : parallélisable (autre fichier, aucune dépendance non terminée)
- **[US1]** à **[US5]** : parcours de la spécification

---

## Phase 1 : préparation

- [X] T001 Vérifier que la branche `lot3-precommandes` part de `main` à jour (lot 2 fusionné, demande n° 6) et y versionner `specs/003-precommandes-arrivage/` ainsi que la mise à jour en attente de `specs/002-paiement-mobile-money/tasks.md`
- [X] T002 Créer `src/precommandes.ts` avec :
  - les constantes `DELAI_SOLDE_JOURS_DEFAUT = 7` et la durée de paiement de l'acompte reprise de `DUREE_RESERVATION_MINUTES` (`src/canalenligne.ts`) ;
  - `conditionsPrecommande(delaiJours)`, qui renvoie le texte exact des conditions (solde dans le délai après l'arrivée, acompte conservé sinon, remboursement intégral si la campagne est annulée ou n'atteint pas son seuil) ;
  - une fonction vide `enregistrerPrecommandes(app: FastifyInstance, pool: pg.Pool, outils: Outils, taches: TachePlanifiee[], options: { commandesParMinute: number })` ;
  - une fonction exportée vide `expirerPrecommandes(c: Client): Promise<number>` ;
  - un objet exporté `suiviPrecommandes`, vide au départ (typé `SuiviAchats` une fois T005 fait), que T009 branche sur les achats et que T025, T034 et T042 remplissent.
  - *Fait autrement, selon l'usage du code (`crochetsPerformance`) : `src/achats.ts` exporte l'objet `crochetsAchats`, que `enregistrerPrecommandes` remplit (approbation, étape, réception) ; rien à brancher dans `src/serveur.ts`.*

---

## Phase 2 : fondations (bloquent tous les parcours)

- [X] T003 Écrire `migrations/0049_precommandes.sql` selon data-model.md, sans modifier aucune migration existante.
  - Table `campagnes_arrivage` :
    - colonnes : `campagnes_arrivage.id`, `campagnes_arrivage.organisation_id`, `campagnes_arrivage.entite_id` (FK `config_canal(organisation_id, entite_id)`), `campagnes_arrivage.lieu_id`, `campagnes_arrivage.produit_id`, `campagnes_arrivage.fournisseur_id`, `campagnes_arrivage.numero`, `campagnes_arrivage.origine`, `campagnes_arrivage.titre`, `campagnes_arrivage.texte`, `campagnes_arrivage.prix_ht`, `campagnes_arrivage.taux_taxe`, `campagnes_arrivage.prix_ttc`, `campagnes_arrivage.acompte_type`, `campagnes_arrivage.acompte_valeur`, `campagnes_arrivage.acompte_unitaire`, `campagnes_arrivage.seuil`, `campagnes_arrivage.quantite_max`, `campagnes_arrivage.date_limite`, `campagnes_arrivage.delai_solde_jours`, `campagnes_arrivage.prix_achat_prevu`, `campagnes_arrivage.statut`, `campagnes_arrivage.motif_annulation`, `campagnes_arrivage.annulee_le`, `campagnes_arrivage.annulee_par`, `campagnes_arrivage.declenchee_le`, `campagnes_arrivage.commande_achat_id`, `campagnes_arrivage.premiere_reception_le`, `campagnes_arrivage.cree_par`, `campagnes_arrivage.cree_le` ;
    - clés uniques, checks et index de data-model.md.
  - Table `inscriptions_precommande` :
    - colonnes : `inscriptions_precommande.id`, `inscriptions_precommande.organisation_id`, `inscriptions_precommande.campagne_id`, `inscriptions_precommande.tiers_id`, `inscriptions_precommande.reference`, `inscriptions_precommande.jeton_suivi_hache`, `inscriptions_precommande.nom_client`, `inscriptions_precommande.telephone`, `inscriptions_precommande.quantite`, `inscriptions_precommande.moyen_paiement`, `inscriptions_precommande.total_ttc`, `inscriptions_precommande.acompte`, `inscriptions_precommande.conditions_texte`, `inscriptions_precommande.conditions_acceptees_le`, `inscriptions_precommande.statut`, `inscriptions_precommande.expire_le`, `inscriptions_precommande.validee_le`, `inscriptions_precommande.servie_le`, `inscriptions_precommande.solde_avant`, `inscriptions_precommande.motif`, `inscriptions_precommande.traite_le`, `inscriptions_precommande.traite_par`, `inscriptions_precommande.cree_le` ;
    - clés uniques, checks et index de data-model.md.
  - `paiements_en_ligne` :
    - `paiements_en_ligne.commande_id` rendue facultative ;
    - ajouts : `paiements_en_ligne.inscription_id` avec `num_nonnulls(...) = 1`, `paiements_en_ligne.rembourse_le`, `paiements_en_ligne.rembourse_par`, `paiements_en_ligne.reference_remboursement` ;
    - contraintes de `paiements_en_ligne.statut` (avec `rembourse`) et de `paiements_en_ligne.motif` recréées, ainsi que le check entre statut et motif, retrouvé par `pg_get_constraintdef` dans un bloc `do $$` comme en 0048.
  - Ajouts sur les autres tables :
    - `commandes_web.inscription_id` et `commandes_web.acompte`, avec leurs checks ;
    - `reservations_stock.inscription_id`, et la contrainte `reservations_stock_auteur` recréée ;
    - `reglements.acompte_id` et son index unique partiel ;
    - index unique partiel des remboursements sur `mouvements_portefeuille`.
  - `tresorerie_reglement()` remplacée : `if new.acompte_id is not null` → aucun encaissement ; la branche d'annulation est inchangée.
  - Sur les deux tables nouvelles : RLS forcée et politique `cloison`, audit, `grant select, insert, update` à `erp_app`.
- [X] T004 [P] Dans `src/canalenligne.ts`, sortir au niveau du module et exporter, sans changer le comportement des routes du lot 1 (`tests/canal*.test.ts` restent verts) :
  - `parBoutique(pool, org, fn)` (l. 144 à 151) ;
  - `ficheClient(c, boutique, lieuId, nom, telephone)` (l. 244 à 255) ;
  - `livraisonDe(c, boutique, corps)`, qui valide le mode de remise, la zone, le point relais et l'adresse et renvoie les frais (extrait de `POST /marketplace/:org/commandes`, l. 281 à 311).
  - *Fait en deux fonctions, pour garder l'ordre des contrôles du lot 1 : `verifierLivraison(corps)` (avant toute lecture en base) et `fraisLivraison(c, branche, corps)`.*
- [X] T005 [P] Dans `src/achats.ts`, sans changer le comportement des routes (`tests/achats*.test.ts` restent verts) :
  - sortir au niveau du module `ecrireLignes`, `verifierAcheteur` et `exigerModule`, puis exporter `creerCommandeAchat(ctx, exigerSurEntite, corps)`, extrait de `POST /achats/commandes` (l. 195 à 221), que la route appelle ;
  - ajouter l'interface exportée `SuiviAchats { approbation?(ctx, commandeId): Promise<void>; etape?(ctx, commandeId, etape, date): Promise<void>; reception?(ctx, commandeId, receptionId, statut): Promise<void> }` et le paramètre `suivi: SuiviAchats = {}` à `enregistrerAchats` ;
  - l'approbation (l. 592 à 604) appelle `suivi.approbation` avant la mise à jour ;
  - la route des étapes (l. 487 à 508) appelle `suivi.etape` après `achat.etape` ;
  - la réception (l. 618 à 674) appelle `suivi.reception` après la mise à jour du statut.
- [X] T006 [P] Dans `src/performance.ts`, exporter `confierAuxTitulaires(c, org, entiteId, permission, repli, titre, tiersId, description?)`, reprise de `confier` (`src/paiementenligne.ts`, l. 83 à 91) avec le champ facultatif `taches.description`. `src/paiementenligne.ts` l'utilise à la place de `confier` ; `tests/paiement*.test.ts` restent verts.
- [X] T007 [P] Dans `public/app.js`, ajouter à `MESSAGES` les codes absents, avec des textes simples en français : `conditions_non_acceptees`, `campagne_close`, `campagne_complete`, `solde_impossible`, `boutique_absente`, `prix_annonce_impossible`, `acompte_invalide`, `date_limite_invalide`, `campagne_figee`, `campagne_non_annulable`, `bon_de_commande_existant`, `inscription_non_annulable`, `quantite_inferieure_aux_precommandes`, `remboursement_impossible`, `encaissement_a_placer`, `reglement_acompte_non_annulable`. Vérifier aussi que `branche_attendue`, `lieu_invalide`, `module_inactif`, `solde_portefeuille_insuffisant` et `separation_des_taches` y sont.
- [X] T008 [P] Créer `tests/precommandesoutils.ts` à partir de `boutiquePayante` (`tests/paiementoutils.ts`) :
  - `campagneEssai(b, options)` : fournisseur, article sans stock, campagne par défaut à 85 000 FCFA, acompte 30 %, seuil 5, date limite dans 10 jours ;
  - `inscrire(env, org, campagneId, corps?)` ;
  - `payerAcompte(env, b, inscription)`, qui lance puis envoie l'avis signé du montant exact ;
  - `referenceAcompte(b, reference)`, lue en base ;
  - `approuver(b, commandeId)`, avec un second utilisateur titulaire de `achats.approuver` ;
  - `recevoir(b, commandeId, quantite, cloturer?)` ;
  - `choisirSolde(env, org, inscription, corps?)` ;
  - `balayer(env, org)` (`app.executerTaches`).
- [X] T009 Dans `src/serveur.ts` :
  - passer `suiviPrecommandes` (T002) à `enregistrerAchats` (l. 782) ;
  - appeler `enregistrerPrecommandes(app, pool, outils, taches, { commandesParMinute: options.debitCanal?.commandes ?? 20 })` après `enregistrerCanalEnLigne` ;
  - ajouter `expirerPrecommandes` à la minuterie d'une minute (l. 831 à 836), à côté de `expirerCommandesWeb`.

**Point d'étape** : la migration s'applique, `npx tsc --noEmit` passe, toute la suite existante reste verte.

---

## Phase 3 : parcours 1, annoncer un arrivage et s'inscrire en payant l'acompte (P1) 🎯 MVP

**Objectif** : créer une campagne, la publier, inscrire un client et valider son inscription sur avis signé de l'acompte, encaissé une seule fois (FR-001 à FR-010, FR-031, FR-033, FR-034).

**Test indépendant** : `tests/precommandesinscription.test.ts` (scénarios Q1 à Q4 de quickstart.md).

- [X] T010 [P] [US1] Écrire `tests/precommandesinscription.test.ts`.
  - Q1 : la liste publique ne contient ni quantité, ni seuil chiffré, ni fournisseur, ni prix d'achat, ni lieu.
  - Q2 : inscription de 2 pièces et avis signé → inscription `validee`, mouvement d'encaissement de 51 000 dans le portefeuille Orange Money, progression 40 %, événement `precommande.inscription_validee`. Le même avis envoyé trois fois donne un seul mouvement, puis `deja_traite`.
  - Q3 : sans `conditionsAcceptees` → `400 conditions_non_acceptees` ; inscription non payée, `expire_le` reculé puis balayage → `expiree`, hors progression.
  - Q4 :
    - acompte tardif avec place → `validee` ;
    - acompte tardif sans place (`quantite_max` atteinte) → paiement et inscription `a_rembourser`, motif `complet`, une tâche au titulaire de `tresorerie.gerer` ;
    - second paiement de la même inscription → ce paiement seul `a_rembourser`, motif `deja_payee` ; l'inscription reste `validee`.
  - Autres cas :
    - téléphone déjà connu → même fiche client ;
    - prix TTC inatteignable avec 19,25 % → `400 prix_annonce_impossible` avec deux prix proches ;
    - `PATCH` après le premier acompte → `409 campagne_figee` pour le prix, report de la date permis ;
    - `GET /paiements-en-ligne` montre l'acompte avec sa référence d'inscription.
- [X] T011 [US1] Dans `src/precommandes.ts`, route `POST /precommandes/campagnes` selon contracts/routes-internes.md.
  - Droits : `achats.gerer` sur la branche et sur le lieu ; branche avec le module de stock et `config_canal` présent ; lieu actif de `lieux_canal` ; article actif, suivi en stock, de la branche.
  - `htPourTtc(ttc, taux)` cherche le HT entier tel que `calculerLigne(1, ht, 0, taux)` donne le TTC, sinon renvoie les deux prix atteignables les plus proches.
  - Acompte par pièce (data-model.md, « Calculs »).
  - Champs écrits : `campagnes_arrivage.prix_ht`, `campagnes_arrivage.taux_taxe`, `campagnes_arrivage.prix_ttc`, `campagnes_arrivage.acompte_type`, `campagnes_arrivage.acompte_valeur`, `campagnes_arrivage.acompte_unitaire`, `campagnes_arrivage.seuil`, `campagnes_arrivage.quantite_max`, `campagnes_arrivage.date_limite`, `campagnes_arrivage.delai_solde_jours`, `campagnes_arrivage.prix_achat_prevu`, `campagnes_arrivage.origine`, `campagnes_arrivage.titre`, `campagnes_arrivage.texte`, `campagnes_arrivage.numero` (`prochainNumero`, série `ARR-AAAA`), `campagnes_arrivage.cree_par`.
  - Fournisseur lié à la branche (`lierTiers`) avec le rôle fournisseur.
- [X] T012 [US1] Dans `src/precommandes.ts`, routes `GET /precommandes/campagnes`, `GET /precommandes/campagnes/:id` et `PATCH /precommandes/campagnes/:id` selon contracts/routes-internes.md.
  - Branches de `achats.voir` et de `facturation.voir` ; la liste lance d'abord `expirerPrecommandes`.
  - Totaux par campagne : quantité validée, inscrits, acomptes encaissés, à rembourser, remboursés, conservés.
  - Règles de figement de `PATCH` : après le premier acompte, `campagnes_arrivage.date_limite` seulement reportée et `campagnes_arrivage.quantite_max` seulement relevée (jamais sous la quantité retenue) ; tout autre champ → `409 campagne_figee`.
- [X] T013 [US1] Dans `src/precommandes.ts` :
  - écrire `quantites(c, campagne)` : quantité validée, quantité retenue, capacité et progression (data-model.md, « Calculs ») ;
  - écrire `accepteInscriptions(campagne)` : statut `ouverte` ou `declenchee`, date limite non passée à Douala, `campagnes_arrivage.premiere_reception_le` nulle ;
  - écrire les routes `GET /marketplace/:org/campagnes` et `GET /marketplace/:org/campagnes/:id` selon contracts/routes-publiques.md, par `parBoutique`, avec le balayage en tête, une liste de colonnes fermée, et `conditions` = `conditionsPrecommande(campagnes_arrivage.delai_solde_jours)`.
- [X] T014 [US1] Dans `src/precommandes.ts`, route `POST /marketplace/:org/campagnes/:id/inscriptions` selon contracts/routes-publiques.md.
  - Balayage en tête ; débit `commandesParMinute` ; `conditionsAcceptees` doit valoir `true`.
  - Sous le verrou `for update` de la campagne, vérifier `accepteInscriptions` et la capacité.
  - Fiche client par `ficheClient`.
  - Champs écrits : `inscriptions_precommande.reference` (série `PRE-AAAA`), `inscriptions_precommande.jeton_suivi_hache` (`hacherJeton` d'un jeton de 32 octets), `inscriptions_precommande.total_ttc` (`calculerLigne(quantite, prix_ht, 0, taux_taxe)`), `inscriptions_precommande.acompte`, `inscriptions_precommande.conditions_texte`, `inscriptions_precommande.conditions_acceptees_le`, `inscriptions_precommande.expire_le` (maintenant + 30 minutes), `inscriptions_precommande.moyen_paiement`.
  - Réponse 201.
- [X] T015 [US1] Dans `src/precommandes.ts`, route `GET /marketplace/:org/precommandes/:reference?jeton=` selon contracts/routes-publiques.md : balayage en tête ; référence et jeton contrôlés comme au lot 1 ; réponse sans nom ni téléphone (référence, statut, campagne, article, quantité, total, acompte, conditions, motif en clair). Les étapes et le solde viennent avec T042 et T038.
- [X] T016 [US1] Dans `src/paiementenligne.ts`, route `POST /marketplace/:org/precommandes/:reference/payer`, sur le modèle de la route des commandes (l. 196 à 231).
  - Refus : inscription non `en_attente`, échue, ou campagne qui n'accepte plus → `409 paiement_impossible` ; prestataire ou responsable de la boutique absent → `503 paiement_indisponible`.
  - Montant : `inscriptions_precommande.acompte`.
  - Ligne écrite : `paiements_en_ligne` avec `paiements_en_ligne.inscription_id` et `paiements_en_ligne.commande_id` nulle.
- [X] T017 [US1] Dans `src/precommandes.ts`, exporter `traiterAcompte(c, org, paiement, journal)` selon research.md R1, R2 et R5.
  - Verrou de la campagne, puis de l'inscription.
  - Inscription déjà payée (`validee`, `servie`, `soldee` ou `acompte_conserve`) : seul ce paiement passe « à rembourser », motif `deja_payee` ; l'inscription ne change pas.
  - Validation, selon l'état de l'inscription :
    - en attente et non échue : validée si la campagne n'est ni annulée ni déjà reçue (`campagnes_arrivage.premiere_reception_le` nulle), même si la date limite vient de passer ;
    - expirée, ou en attente échue : validée seulement si `accepteInscriptions` et la capacité le permettent.
  - Effets d'une validation :
    - `paiements_en_ligne.statut` passe `reussi` ;
    - `inscriptions_precommande.statut` passe `validee`, avec `inscriptions_precommande.validee_le` ;
    - `tresorerie_encaisser(..., 'paiement_en_ligne', paiement.id)` ;
    - événement `precommande.inscription_validee` ;
    - appel de `declencherSiSeuil(c, org, campagne)`, sans effet jusqu'à T023.
  - Sinon, le paiement et l'inscription passent « à rembourser » (`paiements_en_ligne.motif` et `inscriptions_precommande.motif`) :
    - campagne annulée : motif de la campagne (`campagne_annulee` ou `seuil_non_atteint`) ;
    - inscription annulée par le personnel : `retrait_client` ;
    - plus de place, campagne close ou arrivage déjà reçu : `complet`.
  - Dans tous les cas « à rembourser » : encaissement `paiement_en_ligne`, `confierAuxTitulaires(..., 'tresorerie.gerer', ...)`, événement `precommande.a_rembourser`, journal.
  - Retourne `{ issue: 'traite', statut }`.
- [X] T018 [US1] Dans `src/paiementenligne.ts`, dans `traiterAvis` (l. 142 à 192), après les contrôles du paiement (déjà traité, montant, échec) : si `paiements_en_ligne.inscription_id` est renseigné, renvoyer le résultat de `traiterAcompte` ; le reste (trace, `RP001`, réponses) est inchangé.
- [X] T019 [US1] Dans `src/precommandes.ts`, `expirerPrecommandes`, étape 1 : les inscriptions `en_attente` dont `inscriptions_precommande.expire_le` est passée deviennent `expiree` (`for update skip locked`, relançable). Enregistrer la tâche horaire (`taches.push`) dans `enregistrerPrecommandes`.
- [X] T020 [US1] Dans `src/paiementenligne.ts`, élargir `GET /paiements-en-ligne` (l. 292 à 329) selon contracts/routes-internes.md :
  - jointures externes vers `commandes_web`, `inscriptions_precommande` et `campagnes_arrivage` ;
  - branche prise sur la commande ou la campagne ;
  - colonnes `inscription` et `campagne` ;
  - filtre `statut` avec `rembourse` ;
  - total des paiements `reussi`, `a_rembourser` et `rembourse`.
  `tests/paiementrapprochement.test.ts` reste vert.
- [X] T021 [P] [US1] Interface :
  - créer `public/precommandes.js` avec `ecranPrecommandes` : liste des campagnes (statut, progression, totaux) et formulaire de création (lieu servi en ligne, article, fournisseur, prix TTC, acompte en FCFA ou en %, seuil, quantité maximale, date limite, délai du solde, prix d'achat prévu, texte) ;
  - l'ajouter dans `public/index.html` ;
  - ajouter un bouton « Précommandes » en tête de `ecranCommandesEnLigne` dans `public/canalenligne.js` (visible avec `achats.voir` ou `facturation.voir`) ;
  - dans `public/sw.js`, cache `smarte-solutions-v4` avec `precommandes.js`.

**Point d'étape** : T010 vert ; une campagne reçoit des inscriptions payées, chaque acompte encaissé une fois.

---

## Phase 4 : parcours 2, seuil atteint et un seul bon de commande (P1)

**Objectif** : le premier acompte qui atteint le seuil déclenche la campagne et crée un seul brouillon ; l'approbation reste humaine et ne descend pas sous les précommandes (FR-011 à FR-015).

**Test indépendant** : `tests/precommandesseuil.test.ts` (scénarios Q5 à Q7).

- [X] T022 [P] [US2] Écrire `tests/precommandesseuil.test.ts`.
  - Q5 : deux acomptes simultanés (`Promise.all`) franchissent le seuil → campagne `declenchee`, un seul `commandes_achat` en `brouillon`, relié par `campagnes_arrivage.commande_achat_id`, ligne de l'article pour la quantité validée, événement `precommande.seuil_atteint`.
  - Q6 : personne sans `achats.approuver` → `403` ; approbation pour moins que la quantité validée → `409 quantite_inferieure_aux_precommandes` ; règle de séparation active et approbation par l'auteur → `409 separation_des_taches` ; un autre approbateur → `approuvee`.
  - Q7 : 6 commandées pour 5 validées : inscription de 2 → `409 campagne_complete`, de 1 → acceptée.
  - Auteur de la campagne privé de `achats.gerer` avant le seuil : acompte validé, campagne déclenchée sans bon de commande, une tâche aux titulaires de `achats.gerer`. Ensuite, `POST /precommandes/campagnes/:id/bon-de-commande` crée le brouillon ; un second appel → `409 bon_de_commande_existant`.
- [X] T023 [US2] Dans `src/precommandes.ts`, écrire `declencherSiSeuil` selon research.md R5.
  - Condition : campagne `ouverte` et quantité validée ≥ `campagnes_arrivage.seuil`.
  - Effets :
    - `campagnes_arrivage.statut` passe `declenchee`, avec `campagnes_arrivage.declenchee_le` ;
    - `savepoint achat` ;
    - `creerCommandeAchat` dans le contexte de `campagnes_arrivage.cree_par` (fournisseur, lieu, origine, une ligne avec l'article, la quantité validée, `prixUnitaire` = `campagnes_arrivage.prix_achat_prevu` ou 0, `prixVente` = `campagnes_arrivage.prix_ht`, une note avec le numéro de la campagne) ;
    - `campagnes_arrivage.commande_achat_id` renseigné ;
    - événement `precommande.seuil_atteint` et journal `precommande.seuil_atteint`.
  - En cas d'erreur : `rollback to savepoint achat`, tâche aux titulaires de `achats.gerer` du lieu, journal `precommande.bon_a_preparer`.
- [X] T024 [US2] Dans `src/precommandes.ts`, route `POST /precommandes/campagnes/:id/bon-de-commande` selon contracts/routes-internes.md : campagne `declenchee` dont le bon de commande est absent ou `annulee`, sinon `409 bon_de_commande_existant`. Brouillon créé au nom de la personne connectée, avec les mêmes lignes que T023.
- [X] T025 [US2] Dans `src/precommandes.ts`, point d'appel `approbation` du `SuiviAchats` :
  - pour la campagne reliée au bon de commande, refuser avec `409 quantite_inferieure_aux_precommandes` (`{ validee, commandee }`) si la quantité de l'article dans `lignes_achat` est inférieure à la quantité validée ;
  - faire tenir compte à `quantites` de la quantité commandée une fois le bon approuvé (capacité, FR-015).
- [X] T026 [P] [US2] Dans `public/precommandes.js`, détail de la campagne : bon de commande relié (numéro, statut, quantité commandée) et bouton « Préparer le bon de commande » quand il manque ou est annulé (`achats.gerer`).

**Point d'étape** : T022 vert ; jamais deux bons de commande, approbation protégée.

---

## Phase 5 : parcours 3, campagne annulée ou seuil manqué, rembourser chaque acompte une fois (P1)

**Objectif** : annulation manuelle ou d'office et retrait d'un client rendent les acomptes « à rembourser » ; le trésorier enregistre chaque remboursement une seule fois, avec son droit ; GTA ne voit rien (FR-025 à FR-030, FR-034).

**Test indépendant** : `tests/precommandesannulation.test.ts` (scénarios Q8 à Q11).

- [X] T027 [P] [US3] Écrire `tests/precommandesannulation.test.ts`.
  - Q8 : `date_limite` reculée sous le seuil puis balayage → campagne `annulee`, motif `seuil_non_atteint`, inscriptions validées et paiements `a_rembourser`, inscription en attente `annulee`, une tâche par titulaire de `tresorerie.gerer` dont la description liste client, téléphone, montant, moyen et référence, événement `precommande.campagne_annulee`. Annulation manuelle d'une campagne déclenchée avant réception : même effet, bon de commande inchangé.
  - Q9 :
    - remboursement par le trésorier : sortie du montant exact dans le portefeuille de l'encaissement, paiement `rembourse` avec la référence, inscription `remboursee` ;
    - second appel → `409 remboursement_impossible` ;
    - utilisateur sans `tresorerie.gerer` → `403` ;
    - acompte encore dans les encaissements en attente → `409 encaissement_a_placer` ;
    - remboursement d'un paiement en double (`deja_payee`) : sortie faite, inscription toujours `validee`.
  - Q10 : retrait d'un client avant le seuil → `a_rembourser`, progression en baisse ; après déclenchement → `409 inscription_non_annulable`.
  - Q11 : un utilisateur de GTA (rôle administrateur sur GTA) voit zéro campagne, sa création est refusée, et `GET /paiements-en-ligne` ne lui montre aucun acompte.
- [X] T028 [US3] Dans `src/precommandes.ts`, écrire `annulerCampagne(c, org, campagne, motif, auteurId | null)` selon contracts/routes-internes.md, puis la route `POST /precommandes/campagnes/:id/annulation`.
  - Champs écrits : `campagnes_arrivage.statut` `annulee`, `campagnes_arrivage.motif_annulation`, `campagnes_arrivage.annulee_le`, `campagnes_arrivage.annulee_par`.
  - Inscriptions validées → `a_rembourser` (`inscriptions_precommande.motif` `campagne_annulee` ou `seuil_non_atteint`), avec leur paiement (`paiements_en_ligne.statut` `a_rembourser`, `paiements_en_ligne.motif`) ; inscriptions en attente → `annulee`.
  - Une tâche par titulaire de `tresorerie.gerer` avec la liste en description (`confierAuxTitulaires`).
  - Événements `precommande.campagne_annulee` et `precommande.a_rembourser`, journal.
  - Refus `409 campagne_non_annulable` si `campagnes_arrivage.premiere_reception_le` est renseignée, ou si la campagne est annulée ou livrée.
- [X] T029 [US3] Dans `src/precommandes.ts`, `expirerPrecommandes`, étape 2 : une campagne `ouverte` dont `campagnes_arrivage.date_limite` est passée (date de Douala) est annulée par `annulerCampagne(..., 'seuil_non_atteint', null)`, prise en `for update skip locked` pour qu'un acompte simultané et l'échéance donnent une seule issue.
- [X] T030 [US3] Dans `src/precommandes.ts`, route `POST /precommandes/inscriptions/:id/annulation` selon contracts/routes-internes.md (`achats.gerer` sur la branche, campagne `ouverte`) : en attente → `annulee` ; validée → `a_rembourser`, motif `retrait_client`, avec le paiement et la tâche au trésorier ; sinon `409 inscription_non_annulable`.
- [X] T031 [US3] Remboursement, selon contracts/routes-internes.md et research.md R10.
  - Dans `src/paiementenligne.ts`, route `POST /paiements-en-ligne/:id/remboursement` :
    - verrou du paiement ; branche de la commande ou de la campagne ; `tresorerie.gerer` sur la branche ;
    - paiement `a_rembourser`, sinon `409 remboursement_impossible` ;
    - mouvement d'encaissement du paiement, sinon `409 encaissement_a_placer` ;
    - verrou du portefeuille, solde suffisant sinon `409 solde_portefeuille_insuffisant` ;
    - sortie `source_type = 'remboursement_en_ligne'`, `source_id` = paiement, `auteur_id` ;
    - champs écrits : `paiements_en_ligne.statut` `rembourse`, `paiements_en_ligne.rembourse_le`, `paiements_en_ligne.rembourse_par`, `paiements_en_ligne.reference_remboursement` ;
    - journal `canal.paiement_rembourse`.
  - Pour un acompte, appeler `apresRemboursement(c, inscriptionId, paiementId)`, exportée par `src/precommandes.ts`. Seulement si l'inscription est « à rembourser » et que le paiement n'est pas un paiement en double (`paiements_en_ligne.motif` différent de `deja_payee`) : `inscriptions_precommande.statut` passe `remboursee`, puis contrôle « livrée » de la campagne (T037). Sinon, l'inscription ne change pas.
- [X] T032 [P] [US3] Interface :
  - dans `public/precommandes.js`, boutons « Annuler la campagne » et « Annuler l'inscription » (avec motif) ;
  - dans `public/canalenligne.js`, sur les lignes « à rembourser » de `ecranPaiementsEnLigne` (l. 69), bouton « Enregistrer le remboursement » avec la référence de l'opérateur (`tresorerie.gerer`), et libellé de l'état `rembourse`.

**Point d'étape** : T027 vert ; tout acompte pris peut être rendu, une fois, par le trésorier.

---

## Phase 6 : parcours 4, arrivage reçu, servir les inscrits et encaisser le solde (P2)

**Objectif** : la réception réserve le stock aux inscrits dans l'ordre ; le solde payé en ligne produit la facture du total, l'acompte imputé une fois ; le solde non payé à temps laisse l'acompte à GLOMARI (FR-018 à FR-024, FR-031).

**Test indépendant** : `tests/precommandesreception.test.ts` (scénarios Q12 à Q15).

- [X] T033 [P] [US4] Écrire `tests/precommandesreception.test.ts`.
  - Q12 : réception complète pour 3 inscrits →
    - réservations `inscription_id` dans l'ordre de `validee_le` ;
    - disponibilité Marketplace et `quantite_vendable` réduites d'autant ;
    - vente de caisse et transfert de ces pièces vers un autre lieu refusés ;
    - événements `precommande.arrivage_recu` ;
    - inscription à la campagne refusée après réception (`409 campagne_close`).
  - Q13 : solde choisi en livraison puis payé →
    - facture `emis` égale à `inscriptions_precommande.total_ttc` + frais ;
    - deux règlements : celui d'acompte (`acompte_id`, sans mouvement de portefeuille) et celui du solde ;
    - portefeuille augmenté du solde seulement ;
    - stock sorti, réservation levée, colis créé ;
    - inscription `soldee`, événements `precommande.soldee` et `commande_web.facturee` ;
    - `POST /reglements/:id/annulation` sur le règlement d'acompte → `409 reglement_acompte_non_annulable`.
  - Q14 : réception partielle → premiers servis en entier, le suivant attend ; réception du surplus → reste en vente normale ; commande clôturée sans tout recevoir → non servis `a_rembourser`, motif `non_servie`.
  - Q15 : `solde_avant` reculée puis balayage → `acompte_conserve`, réservation levée, événement ; paiement du solde ensuite → `a_rembourser`. Un nouveau choix du mode de remise annule la commande du solde non payée, la réservation reste.
  - Commande du solde payée mais restée `payee` (identité vendeur effacée), puis délai dépassé et balayage → inscription toujours `servie`, réservation gardée ; identité rétablie et `POST /commandes-web/:id/terminer` → `soldee`.
  - Inscription passée `acompte_conserve` alors que sa commande du solde est encore en cours, puis avis du solde → commande `expiree`, paiement `a_rembourser` (motif `expiree`), aucune facture, acompte ni imputé ni réencaissé.
- [X] T034 [US4] Dans `src/precommandes.ts`, point d'appel `reception` du `SuiviAchats` selon research.md R7, pour la campagne reliée qui n'est pas annulée.
  - Budget = quantité de l'article dans cette réception (`lignes_reception`), bornée par `quantite_vendable(lieu, article)`.
  - Inscriptions `validee` servies en entier, par ordre de `inscriptions_precommande.validee_le` puis de `id`, en s'arrêtant au premier qu'on ne peut pas servir en entier. Pour chacune :
    - insertion dans `reservations_stock` (`reservations_stock.inscription_id`, tiers, motif `precommande`) ;
    - champs écrits : `inscriptions_precommande.statut` `servie`, `inscriptions_precommande.servie_le`, `inscriptions_precommande.solde_avant` = maintenant + `campagnes_arrivage.delai_solde_jours` jours ;
    - événement `precommande.arrivage_recu`.
  - `campagnes_arrivage.premiere_reception_le` est renseignée à la première réception.
  - Si le statut est `recue` : les inscriptions encore `validee` passent `a_rembourser`, motif `non_servie`, avec leur paiement et la tâche au trésorier.
- [X] T035 [US4] Dans `src/precommandes.ts`, route `POST /marketplace/:org/precommandes/:reference/solde` selon contracts/routes-publiques.md.
  - Balayage en tête ; refus : inscription non `servie`, ou `solde_avant` passée → `409 solde_impossible`.
  - Mode de remise et frais par `livraisonDe`.
  - Verrouiller d'abord la commande du solde existante, puis l'inscription (même ordre que la réception d'un avis, pour que les deux ne s'attendent jamais l'une l'autre) ; une commande du solde `reservee`, sans paiement réussi, est passée `annulee` (motif « remplacée »).
  - Nouvelle commande `commandes_web` :
    - champs écrits : `commandes_web.inscription_id`, `commandes_web.acompte` = `inscriptions_precommande.acompte`, `lieu_id` = `campagnes_arrivage.lieu_id`, `expire_le` = `inscriptions_precommande.solde_avant`, moyen choisi ;
    - une ligne avec `prix_unitaire_ht` = `campagnes_arrivage.prix_ht`, `taux_taxe` = `campagnes_arrivage.taux_taxe`, `total_ht` et `total_ttc` = `calculerLigne(quantite, prix_ht, 0, taux)` ;
    - nouveau jeton ; aucune réservation propre.
  - Réponse 201 avec `montant_a_payer`.
- [X] T036 [US4] Dans `src/paiementenligne.ts`, selon research.md R3 et R8.
  - Route de paiement des commandes (l. 196 à 231) : montant envoyé et `paiements_en_ligne.montant` = `total_ttc − commandes_web.acompte`.
  - `traiterAvis` (l. 142 à 192), pour une commande du solde : verrouiller l'inscription juste après la commande. Si elle n'est plus `servie`, la commande passe `expiree` (comme une commande échue) et le paiement « à rembourser » (motif `expiree`) par `aRembourser`, sans facture.
  - `terminerVente` (l. 94 à 126), si `commandes_web.inscription_id` est renseigné :
    - revérifier que l'inscription est `servie` (sinon `409 solde_impossible`), puis lever aussi ses réservations avant `emettre` ;
    - après la facture (contrôle inchangé : total égal à `commandes_web.total_ttc`), insérer d'abord le règlement d'acompte (`reglements.acompte_id` = paiement réussi de l'inscription, son moyen et sa référence, montant = `commandes_web.acompte`), puis celui du solde (montant = `total_ttc − acompte`) ;
    - appeler `solderInscription(c, commande, factureId)`, exportée par `src/precommandes.ts` : `soldee`, événement `precommande.soldee`, contrôle « livrée ».
  - Dans `src/canalenligne.ts`, le suivi public d'une commande (`GET /marketplace/:org/commandes/:reference`) renvoie aussi `acompte` et `montant_a_payer`.
- [X] T037 [US4] Dans `src/precommandes.ts` :
  - écrire `verifierLivree(c, campagneId)` : une campagne `declenchee` dont `campagnes_arrivage.premiere_reception_le` est renseignée passe `livree` quand toutes ses inscriptions validées sont `soldee`, `remboursee` ou `acompte_conserve` ; une campagne annulée ne change jamais ;
  - `expirerPrecommandes`, étape 3 : les inscriptions `servie` dont `inscriptions_precommande.solde_avant` est passée, prises en `for update skip locked`, deviennent `acompte_conserve`, avec la réservation levée, l'événement `precommande.acompte_conserve`, le journal `precommande.acompte_conserve` et `verifierLivree`. Une inscription dont la commande du solde est `payee` ou `facturee` est ignorée.
- [X] T038 [US4] Dans `src/precommandes.ts` :
  - compléter le suivi public (T015) avec `solde` (montant et `solde_avant`) pour une inscription servie, et `commande_solde` (référence, statut, montant à payer) ;
  - compléter le détail interne avec le rang, `servie_le`, `solde_avant`, la commande du solde et la facture.
- [X] T039 [P] [US4] Dans `src/facturation.ts`, `POST /reglements/:id/annulation` (l. 550 à 560) répond `409 reglement_acompte_non_annulable` quand `reglements.acompte_id` est renseigné.
- [X] T040 [P] [US4] Dans `public/precommandes.js`, détail : inscriptions avec rang, état, date limite du solde, commande du solde et facture.

**Point d'étape** : T033 vert ; une précommande va de l'arrivage à la facture, l'acompte imputé une fois.

---

## Phase 7 : parcours 5, suivre l'arrivage étape par étape (P3)

**Objectif** : chaque étape du bon de commande est publiée et visible sur le lien de chaque inscrit, sans donnée du fournisseur (FR-016, FR-017).

**Test indépendant** : `tests/precommandesetapes.test.ts` (scénario Q16).

- [X] T041 [P] [US5] Écrire `tests/precommandesetapes.test.ts` :
  - approbation puis trois étapes (`expediee`, `arrivee_port`, `dedouanee`) avec une note contenant le nom du fournisseur → quatre événements `precommande.arrivage_etape` (`commandee` compris) ;
  - le lien de suivi d'un inscrit liste les étapes dans l'ordre avec leur date, sans note, ni fournisseur, ni transitaire ;
  - une étape sur un bon de commande sans campagne ne publie rien vers les précommandes.
- [X] T042 [US5] Dans `src/precommandes.ts`, selon research.md R13 :
  - point d'appel `etape` du `SuiviAchats` : événement `precommande.arrivage_etape` (campagne, étape, date) pour la campagne reliée ;
  - le point d'appel `approbation` (T025) publie aussi l'étape `commandee` ;
  - le suivi public reçoit `etapes` : `commandee` à la date d'approbation, puis les lignes de `etapes_achat` du bon de commande autres que `commandee`, avec seulement l'étape et la date.
- [X] T043 [P] [US5] Dans `public/precommandes.js`, détail : étapes de l'arrivage avec leur date.

**Point d'étape** : T041 vert ; l'inscrit suit l'arrivage sur son lien.

---

## Phase 8 : finitions

- [X] T044 [P] Écrire `tests/precommandescompta.test.ts` (Q17) : après `/compta/initialisation` et `/compta/generation` de la branche, les brouillons d'écritures contiennent les quatre écritures attendues :
  - encaissement de l'acompte : débit 552, crédit 4191 ;
  - imputation : débit 4191, crédit 4111 ;
  - remboursement : débit 4191, crédit 552 ;
  - acompte conservé : débit 4191, crédit 758.
- [X] T045 Dans `src/comptabilite.ts` (`pieces()`, l. 64 à 307) et `src/plan_comptable.ts` (`PARAMETRES_DE_DEPART`, l. 35 à 39), selon research.md R14 :
  - paramètres `avances_clients` (4191) et `produits_divers` (758), avec repli sur ces numéros si la branche ne les a pas ;
  - nouvelles écritures `encaissement_en_ligne` (mouvements `source_type = 'paiement_en_ligne'`), `remboursement_en_ligne` (sorties) et `acompte_conserve` (inscriptions) ;
  - règlement avec `reglements.acompte_id` : compte `avances_clients` à la place du compte du moyen.
- [X] T046 [P] Ajuster les lectures existantes selon research.md R15 :
  - exclure `reglements.acompte_id` non nul des encaissements dans `src/rapports.ts` (l. 128), `src/commerce.ts` (l. 136) et `src/finitions.ts` (l. 36) ;
  - exclure `source_type = 'remboursement_en_ligne'` des dépenses de GLOMARI dans `src/tableau.ts` (l. 266) ;
  - `tests/rapports*.test.ts` et `tests/tableau*.test.ts` restent verts.
- [X] T047 [P] Écrire `tests/precommandesrecette.test.ts` (Q18, SC-001, SC-003, SC-004) : campagne de 3 inscrits, acomptes, seuil, approbation, deux étapes, réception, trois soldes avec retrait, livraison et point relais. Vérifier :
  - campagne `livree` ;
  - pour chaque facture, total = total de l'inscription + frais = acompte + solde ;
  - égalité de data-model.md : acomptes encaissés = imputés + remboursés + conservés + à rembourser + détenus, au franc près.
- [X] T048 [P] Mettre à jour `CLAUDE.md`.
  - État : lot 3A livré.
  - Entrée « Précommandes (`src/precommandes.ts`, `public/precommandes.js`, migration 0049, lot 3A) » dans « Limites connues » :
    - prix figé en HT avec son taux ;
    - acompte encaissé comme avance, imputé par un règlement relié, jamais réencaissé ;
    - un bon de commande par campagne, au nom de l'auteur de la campagne ;
    - réservation à la réception, inscrits servis en entier dans l'ordre ;
    - solde par Mobile Money seulement ;
    - acompte conservé après le délai du solde (choix d'Achille du 22 novembre 2026, conditions à faire relire par un juriste) ;
    - remboursement par `POST /paiements-en-ligne/:id/remboursement` avec `tresorerie.gerer` ;
    - écritures proposées (4191, 758) à valider par l'expert-comptable, sans remplacer un expert agréé ;
    - la caisse hors connexion peut encore vendre une pièce réservée à un inscrit (limite déjà connue de la vente hors connexion) ;
    - partie B (achats à l'import) restant à faire.
- [X] T049 [P] Mettre à jour `docs/Couverture du cahier des charges.md` (Commerce et Logistique : précommandes avec acompte, seuil, bon de commande en brouillon, réservation à l'arrivée, remboursements tracés).
- [X] T050 [P] Dans `docs/Fiche technique globale GLOMARI.md`, section 9 lot 3 et sections des routes et des événements : migration `0049_precommandes.sql`, `src/precommandes.ts`, routes publiques réelles, événements `precommande.*`, partie B à venir.
- [X] T051 [P] Dans `docs/Guide de mise en ligne.md`, section « Précommandes » : conditions à faire relire par un juriste avant l'ouverture au public ; portefeuilles Mobile Money par défaut ; règle de séparation des tâches pour l'approbation des achats ; essai avec le prestataire factice seulement.
- [X] T052 Relire `src/precommandes.ts` et les ajouts de `src/paiementenligne.ts` :
  - aucune quantité, aucun fournisseur ni prix d'achat dans les réponses publiques ;
  - aucun nom ni téléphone dans les événements ;
  - chaque droit vérifié côté serveur sur la branche ;
  - chaque code passé à `ErreurApi` présent dans `MESSAGES` ;
  - aucun secret dans le code.
- [ ] T053 Lancer `npx tsc --noEmit` et la suite complète avec le rôle restreint par le contrôle GitHub (`.github/workflows/verification.yml`) : tout vert.
- [ ] T054 Dérouler les scénarios de `specs/003-precommandes-arrivage/quickstart.md` (automatisés par les tests ; essai privé sur serveur quand il existera).
- [ ] T055 Avec l'accord du responsable technique, pousser la branche, ouvrir la demande de fusion et attendre le contrôle GitHub au vert (`.github/workflows/verification.yml`).

---

## Dépendances et ordre d'exécution

- **Phase 1** puis **phase 2** :
  - T003 bloque tout ;
  - T004 bloque T014 et T035 ;
  - T005 bloque T009, T023 et T025 ;
  - T006 bloque T017 ;
  - T002 et T005 bloquent T009.
- **Parcours 1** : socle des suivants (campagne, inscription, acompte).
- **Parcours 2** : après T017 (`declencherSiSeuil`).
- **Parcours 3** : après T017 ; T031 sert aussi aux paiements « à rembourser » du lot 2.
- **Parcours 4** : après le parcours 2 (il faut un bon de commande approuvé).
- **Parcours 5** : après le parcours 2 (T025) ; indépendant du parcours 4.
- **Finitions** : T045 après les parcours 1, 3 et 4 ; T047 après tous les parcours.
- Même fichier, donc dans l'ordre :
  - dans `src/precommandes.ts` : T011 → T012 → T013 → T014 → T015 → T017 → T019 → T023 → T024 → T025 → T028 → T029 → T030 → T034 → T035 → T037 → T038 → T042 ;
  - dans `src/paiementenligne.ts` : T016 → T018 → T020 → T031 → T036.
- **Parallélisable** :
  - T004 à T008 après T003 ;
  - chaque fichier de test (T010, T022, T027, T033, T041, T044, T047) dès la phase 2 ;
  - les tâches d'interface (T021, T026, T032, T040, T043) en parallèle des routes de leur parcours ;
  - T039 et T046 seuls dans leur fichier ;
  - T048 à T051 ensemble.

## Exemple de travail en parallèle : phase 2

```text
Tâche : « parBoutique, ficheClient, livraisonDe exportés » (T004, src/canalenligne.ts)
Tâche : « creerCommandeAchat et points d'appel SuiviAchats » (T005, src/achats.ts)
Tâche : « confierAuxTitulaires » (T006, src/performance.ts)
Tâche : « codes d'erreur » (T007, public/app.js)
Tâche : « outils de test » (T008, tests/precommandesoutils.ts)
```

## Exemple de travail en parallèle : parcours 4

```text
Tâche : « tests de réception et de solde » (T033, tests/precommandesreception.test.ts)
Tâche : « annulation refusée d'un règlement d'acompte » (T039, src/facturation.ts)
Tâche : « détail des inscriptions servies » (T040, public/precommandes.js)
```

## Stratégie

- **MVP** : phases 1 et 2, puis parcours 1. Une campagne reçoit des inscriptions payées, et chaque acompte est encaissé une fois.
- **Avant toute vraie campagne** : parcours 2 (bon de commande) et parcours 3 (remboursements). On ne prend pas l'argent des clients sans pouvoir le rendre.
- **Ensuite** : parcours 4 (arrivée et solde : la recette), puis parcours 5 (suivi des étapes), puis les finitions (comptabilité, recette complète, documents).
- **Partie B** (achats à l'import : acompte au fournisseur, devises, dépôt-vente, coefficient d'importation, couverture de stock) : cycle séparé, sur une autre branche, après la fusion du lot 3A.
