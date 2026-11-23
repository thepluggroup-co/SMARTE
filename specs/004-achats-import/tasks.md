---

description: "Liste des tâches des achats à l'import de GLOMARI (lot 3, partie B)"
---

# Tâches : achats à l'import de GLOMARI (lot 3, partie B)

**Entrée** : documents de `specs/004-achats-import/` ; besoin : `docs/Fiche technique globale GLOMARI.md`, section 9 (lot 3), règles R5 et R11

**Prérequis** : [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests** : demandés (fiche, lot 3 : « acompte jamais compté deux fois ; GTA ne voit rien »). Dans chaque étape, le fichier de test s'écrit d'abord. Les tests tournent dans GitHub Actions (pas de PostgreSQL sur le poste).

**Contraintes de champ** : `data-model.md` fait foi ; les tâches citent `Entité.champ`.

## Format : `[ID] [P?] [Story] Description`

- **[P]** : parallélisable (autre fichier, aucune dépendance non terminée)
- **[US1]** à **[US4]** : parcours de la spécification

---

## Phase 1 : préparation

- [X] T001 Vérifier que la branche `lot3b-achats-import` part de `main` à jour (lot 3A fusionné, demande n° 7) et y versionner `specs/004-achats-import/` ainsi que la mise à jour en attente de `specs/003-precommandes-arrivage/tasks.md`
- [X] T002 Créer trois modules vides et les enregistrer dans `src/serveur.ts`, après `enregistrerPrecommandes` :
  - `src/acomptes.ts` : `enregistrerAcomptes(app, outils)` et une fonction exportée vide `imputerAcomptes(c, org, facture, auteurId)` ;
  - `src/depotvente.ts` : `enregistrerDepotVente(app, outils)` ;
  - `src/couverture.ts` : `enregistrerCouverture(app, pool, outils, taches)`, avec les constantes `SEUIL_COUVERTURE_JOURS = 60` et `PERIODE_VENTES_JOURS = 90`, et des fonctions exportées vides `couvertures(c, brancheId)` et `couverturePrevue(c, commandeId)`.

---

## Phase 2 : fondations (bloquent tous les parcours)

- [X] T003 Écrire `migrations/0050_achats_import.sql` selon data-model.md, sans modifier aucune migration existante.
  - Table `acomptes_fournisseur` : `acomptes_fournisseur.id`, `acomptes_fournisseur.organisation_id`, `acomptes_fournisseur.commande_id`, `acomptes_fournisseur.fournisseur_id`, `acomptes_fournisseur.portefeuille_id`, `acomptes_fournisseur.montant`, `acomptes_fournisseur.date_versement`, `acomptes_fournisseur.reference`, `acomptes_fournisseur.devise`, `acomptes_fournisseur.montant_devise`, `acomptes_fournisseur.taux`, `acomptes_fournisseur.annule_le`, `acomptes_fournisseur.motif_annulation`, `acomptes_fournisseur.annule_par`, `acomptes_fournisseur.auteur_id`, `acomptes_fournisseur.cree_le`, avec ses checks et son index.
  - Table `articles_depot` : `articles_depot.id`, `articles_depot.organisation_id`, `articles_depot.produit_id` (unique), `articles_depot.fournisseur_id`, `articles_depot.actif`, `articles_depot.cree_par`, `articles_depot.cree_le`.
  - Table `remunerations_depot`, sans droit `update` ni `delete` : `remunerations_depot.id`, `remunerations_depot.organisation_id`, `remunerations_depot.produit_id` (FK `articles_depot(organisation_id, produit_id)`), `remunerations_depot.mode`, `remunerations_depot.prix_reversement`, `remunerations_depot.commission_pct`, `remunerations_depot.depuis_le`, `remunerations_depot.auteur_id`.
  - Table `releves_depot` : `releves_depot.id`, `releves_depot.organisation_id`, `releves_depot.branche_id`, `releves_depot.fournisseur_id`, `releves_depot.numero`, `releves_depot.du`, `releves_depot.au`, `releves_depot.total_du`, `releves_depot.facture_fournisseur_id`, `releves_depot.cree_par`, `releves_depot.cree_le`.
  - Table `lignes_releve_depot` : `lignes_releve_depot.id`, `lignes_releve_depot.organisation_id`, `lignes_releve_depot.releve_id`, `lignes_releve_depot.source_type`, `lignes_releve_depot.source_id`, `lignes_releve_depot.produit_id`, `lignes_releve_depot.quantite`, `lignes_releve_depot.montant_ht`, `lignes_releve_depot.montant_du`, `lignes_releve_depot.vendu_le`, avec la clé unique `(organisation_id, source_type, source_id)`.
  - Table `alertes_couverture` : `alertes_couverture.id`, `alertes_couverture.organisation_id`, `alertes_couverture.branche_id`, `alertes_couverture.categorie_id`, `alertes_couverture.stock`, `alertes_couverture.ventes_90`, `alertes_couverture.couverture_jours`, `alertes_couverture.au_dessus`, `alertes_couverture.depasse_depuis`, `alertes_couverture.calcule_le`, avec l'index unique sur `coalesce(categorie_id, …)`.
  - Colonnes ajoutées : `commandes_achat.devise`, `commandes_achat.taux`, `commandes_achat.taux_jour` (check commun) ; `lignes_achat.prix_devise` ; `paiements_fournisseur.acompte_id` avec son index.
  - Déclencheur `acompte_non_depasse` avant insertion sur `paiements_fournisseur` (erreur `AF001`).
  - Fonction stable `remuneration_depot(p_produit, p_quand, p_quantite, p_ht)`, `grant execute` à `erp_app`.
  - RLS forcée, politique `cloison` et audit sur les tables nouvelles ; droits `erp_app`.
- [X] T004 [P] Dans `public/app.js`, ajouter à `MESSAGES` : `acompte_superieur_commande`, `acompte_impute`, `acompte_a_recuperer`, `acompte_insuffisant`, `taux_inconnu`, `prix_devise_obligatoire`, `article_en_depot_vente`, `article_deja_achete`, `depot_inactif`, `stock_restant`, `releve_vide`, `periode_invalide`, `imputation_non_annulable`, `prix_obligatoire`. Vérifier que `commande_non_approuvee`, `transfert_autre_branche`, `portefeuille_inactif`, `solde_portefeuille_insuffisant`, `deja_annule` et `facture_payee` y sont.
- [X] T005 [P] Créer `tests/importoutils.ts` :
  - `magasinImport(env)` : organisation, dépôt GLOMARI (module de stock), fournisseur, article catégorisé, portefeuille bancaire de la branche approvisionné (`POST /portefeuilles` avec un solde initial), initialisation comptable ;
  - `commandeApprouvee(o, lignes, extra?)` ;
  - `factureFournisseur(o, commandeId, montant)` : saisie puis validation, par un second utilisateur titulaire de `compta.valider` si la séparation est active ;
  - `verserAcompte(o, commandeId, montant, jeton?)` ;
  - `tauxDuJour(o, devise, taux)` (`PUT /devises/taux`).
- [X] T006 [P] Dans `src/plan_comptable.ts`, ajouter à `PARAMETRES_DE_DEPART` `avances_fournisseurs: "4091"` et `achats_marchandises: "6011"`, deux comptes déjà présents dans `PLAN_DE_DEPART`.

**Point d'étape** : la migration s'applique, `npx tsc --noEmit` passe, toute la suite existante reste verte.

---

## Phase 3 : parcours 1, payer le fabricant d'avance puis imputer l'acompte (P1) 🎯 MVP

**Objectif** : acomptes sur un bon de commande approuvé, sortie d'argent avec le droit de trésorerie, imputation automatique et unique à la validation de la facture (FR-001 à FR-008).

**Test indépendant** : `tests/acomptes.test.ts` (scénarios Q1 à Q6 et Q20 de quickstart.md).

- [X] T007 [P] [US1] Écrire `tests/acomptes.test.ts` :
  - Q1 : deux acomptes, portefeuille diminué, détail du bon de commande (versé, disponible) ;
  - Q2 : un acheteur sans `tresorerie.gerer` → `403` ; commande en brouillon → `409 commande_non_approuvee` ; dépassement du total → `409 acompte_superieur_commande` ; portefeuille vide → `409 solde_portefeuille_insuffisant` ;
  - Q3 : facture égale aux acomptes, validée → deux paiements avec `acompte_id`, facture soldée, aucun nouveau mouvement de portefeuille, paiement du reste refusé (`montant_superieur_au_reste`) ;
  - Q4 : deux factures successives, imputation dans l'ordre de versement, disponible restant puis nul ;
  - Q5 : annulation d'un acompte non imputé (argent revenu) ; d'un acompte imputé → `409 acompte_impute` ; annulation de la facture → imputations annulées, acompte de nouveau disponible puis annulable ;
  - Q6 : annulation de la commande avec un disponible → `409 acompte_a_recuperer` ;
  - règle de trésorerie : un utilisateur titulaire de `compta.valider` sans `tresorerie.gerer` ne peut ni verser d'acompte ni payer le reste d'une facture (`403`) ; l'annulation d'une ligne d'imputation par `POST /fournisseurs/paiements/:id/annulation` → `409 imputation_non_annulable` ;
  - Q20 : un utilisateur de GTA ne voit aucun acompte ; les dépenses du tableau de bord de GLOMARI n'incluent pas les acomptes.
- [X] T008 [US1] Dans `src/acomptes.ts`, route `POST /achats/commandes/:id/acomptes` selon contracts/routes-internes.md.
  - Verrou de la commande (`for update`) ; `tresorerie.gerer` sur sa branche ; statut `approuvee` ou `recue_partiellement`.
  - Verrou du portefeuille ; même branche, actif, solde suffisant.
  - Total des acomptes actifs + montant ≤ `commandes_achat.total`.
  - Champs écrits : `acomptes_fournisseur.montant`, `acomptes_fournisseur.date_versement`, `acomptes_fournisseur.reference`, `acomptes_fournisseur.devise`, `acomptes_fournisseur.montant_devise`, `acomptes_fournisseur.taux` (les trois ensemble), `acomptes_fournisseur.fournisseur_id` = celui de la commande, `acomptes_fournisseur.auteur_id`.
  - Sortie dans `mouvements_portefeuille` (`type = 'sortie'`, `source_type = 'acompte_fournisseur'`, `source_id`, auteur) ; journal `achat.acompte`.
- [X] T009 [US1] Dans `src/acomptes.ts`, route `POST /achats/acomptes/:id/annulation` :
  - verrou de l'acompte ; `tresorerie.gerer` sur la branche ;
  - refus `409 deja_annule`, ou `409 acompte_impute` si une imputation active existe ;
  - contre-passation du mouvement (`type = 'annulation'`, `annule_mouvement_id`), comme `POST /fournisseurs/paiements/:id/annulation` ;
  - champs écrits : `acomptes_fournisseur.annule_le`, `acomptes_fournisseur.motif_annulation`, `acomptes_fournisseur.annule_par`.
- [X] T010 [US1] Dans `src/acomptes.ts`, exporter :
  - `imputerAcomptes(c, org, facture, auteurId)` : pour une facture reliée à un bon de commande, prend les acomptes non annulés de ce bon par ordre de `date_versement` puis `cree_le` (verrouillés), calcule le disponible et insère dans `paiements_fournisseur`, pour le plus petit du disponible et du reste de la facture, une ligne avec `paiements_fournisseur.acompte_id`, le portefeuille de l'acompte, la date du jour et la référence de l'acompte, **sans** mouvement de portefeuille. Renvoie `[{ acompte, montant }]` ;
  - `annulerImputations(c, factureId, motif)` : `annule_le` et motif sur les paiements de la facture dont `acompte_id` est renseigné.
- [X] T011 [US1] Dans `src/fournisseurs.ts` :
  - la validation (l. 133 à 150) appelle `imputerAcomptes` après la mise à jour du statut, et ajoute `acomptes_imputes` à la réponse ;
  - l'annulation (l. 152 à 162) ne refuse (`facture_payee`) que s'il existe un paiement actif **sans** `acompte_id`, et appelle sinon `annulerImputations` avant d'annuler ;
  - l'erreur `AF001` du déclencheur devient `409 acompte_insuffisant` ;
  - `payerFacture` (l. 164), qui sert au paiement d'une facture et aux lots, exige en plus `tresorerie.gerer` sur l'entité du portefeuille (research.md R14), avant le contrôle de branche, pour garder `transfert_autre_branche` ;
  - `POST /fournisseurs/paiements/:id/annulation` (l. 215) refuse une ligne dont `paiements_fournisseur.acompte_id` est renseigné : `409 imputation_non_annulable`.
- [X] T012 [US1] Dans `src/achats.ts` :
  - l'annulation d'une commande (l. 617) refuse `409 acompte_a_recuperer` si un acompte non annulé garde un disponible ;
  - `GET /achats/commandes/:id` (l. 349) ajoute `acomptes` (versé, imputé, disponible, liste) ;
  - le suivi `paiement()` (l. 428) marque les paiements d'imputation (« acompte imputé »).
- [X] T013 [P] [US1] Dans `src/tableau.ts` (l. 267), exclure `source_type = 'acompte_fournisseur'` des dépenses de GLOMARI, à côté de `remboursement_en_ligne`.
- [X] T014 [P] [US1] Dans `public/gestion.js`, détail d'une commande d'achat (`ecranCommande`), section « Acomptes » :
  - versé, imputé, disponible et liste ;
  - formulaire de versement (portefeuille de la branche, montant, date, référence, devise facultative avec montant et taux), visible avec `tresorerie.gerer` ;
  - bouton d'annulation avec motif.

**Point d'étape** : T007 vert ; l'argent versé d'avance est tracé et déduit une seule fois.

---

## Phase 4 : parcours 2, commander en devise, compter en FCFA (P1)

**Objectif** : prix en USD, CNY ou EUR convertis au taux du jour de commande, total exact en FCFA, taux figé à l'approbation (FR-009 à FR-013).

**Test indépendant** : `tests/devises.test.ts` (scénarios Q7 à Q9).

- [X] T015 [P] [US2] Écrire `tests/devises.test.ts` :
  - Q7 : taux CNY 85,1234 du jour, commande de 2 000 × 210 CNY → `lignes_achat.prix_unitaire` 17 876, total 35 751 828, `total_devise` 420 000, taux et date dans le détail ;
  - Q8 : USD sans taux → `409 taux_inconnu` avec la devise et le jour ; ligne sans `prixDevise` ou avec `prixUnitaire` → `400 prix_devise_obligatoire` ; taux d'une date antérieure utilisé s'il n'y en a pas pour le jour ;
  - Q9 : nouveau taux après l'approbation, montants inchangés ; réception, coût unitaire du stock égal à `coutRevient` du prix FCFA, frais compris ; en brouillon, modifier les lignes après un nouveau taux du même jour reprend ce taux ;
  - écart de facture : une facture fournisseur en FCFA différente de la commande reçue demande un motif d'écart à la validation (`409 ecart_trois_voies`, contrôle existant) ;
  - commande en FCFA dont une ligne n'a pas de `prixUnitaire` → `400 prix_obligatoire`.
- [X] T016 [US2] Dans `src/achats.ts` :
  - **Taux** : `tauxApplicable(c, devise, jour)` (dernier taux de `taux_change` à cette date ou avant, sinon `409 taux_inconnu`) ;
  - **Total** : `totalLigneDevise(quantite, prixDevise, taux)`, en `BigInt` : quantité au millième, prix et taux au dix-millième, arrondi au franc ;
  - **Schéma** : `schemaLignes` (l. 199) rend `prixUnitaire` facultatif et ajoute `prixDevise` (nombre ≥ 0, quatre décimales au plus, contrôlées) ; `NouvelleCommandeAchat` reçoit `devise` (USD, CNY, EUR) ;
  - **Création** : `creerCommandeAchat` (l. 162) écrit `commandes_achat.devise`, `commandes_achat.taux`, `commandes_achat.taux_jour` (taux du jour de commande) ;
  - **Lignes** : `ecrireLignes` (l. 112) reçoit la devise et le taux ; avec une devise, `prixDevise` est exigé et `prixUnitaire` refusé (`400 prix_devise_obligatoire`) ; sans devise, `prixDevise` est refusé (`400 prix_devise_obligatoire`) et `prixUnitaire` exigé (`400 prix_obligatoire`). Il écrit `lignes_achat.prix_devise` ; le prix de l'unité achetée en FCFA vaut `round(prixDevise × taux)` (la suite du calcul par unité de base est inchangée), et le total de la ligne vaut `totalLigneDevise` ;
  - **Modification** : `PUT /achats/commandes/:id/lignes` reprend le taux applicable à `date_commande` et le réécrit sur la commande.
- [X] T017 [US2] Dans `src/achats.ts`, `GET /achats/commandes/:id` (l. 349) ajoute `devise`, `taux`, `taux_jour`, `total_devise` (somme quantité × `prix_devise`) et `prix_devise` sur chaque ligne.
- [X] T018 [P] [US2] Dans `public/gestion.js` :
  - formulaire de commande : choix de la devise (FCFA par défaut) et prix saisis dans la devise ;
  - import des lignes par fichier (l. 663) : pour une commande en devise, la colonne prix est lue comme `prixDevise` ;
  - détail : prix et totaux en devise et en FCFA, taux et sa date.

**Point d'étape** : T015 vert ; une commande en yuans donne des montants FCFA exacts et figés.

---

## Phase 5 : parcours 3, vendre en dépôt-vente les produits d'un fournisseur local (P2)

**Objectif** : article confié, stock sans valeur pour GLOMARI, montant dû calculé sur les ventes, relevé facturé une seule fois, invendus rendus (FR-014 à FR-020).

**Test indépendant** : `tests/depotvente.test.ts` (scénarios Q10 à Q15).

- [X] T019 [P] [US3] Écrire `tests/depotvente.test.ts` :
  - Q10 : prix fixe 3 000, 200 confiés, 30 vendus en caisse, 5 par facture, 2 en retour de caisse → valeur du stock nulle, aperçu de 33 pièces et 99 000 ;
  - Q11 : commission 25 %, vente de 10 000 HT avec 10 % de remise → 6 750 dus ;
  - Q12 : relevé → facture fournisseur en brouillon de 99 000 (compte 6011, sans taxe) ; second relevé de la même période → `409 releve_vide` ; une vente du mois suivant entre dans le relevé suivant ; une vente oubliée d'un mois antérieur, jamais relevée, est signalée par l'aperçu et entre dans le relevé ;
  - Q13 : rémunération changée en cours de mois, les ventes d'avant gardent l'ancienne ;
  - Q14 : article en dépôt-vente sur un bon de commande → `409 article_en_depot_vente` ; article avec du stock mis en dépôt → `409 article_deja_achete` ; retour de 20 invendus → sortie sans montant dû ; fin du dépôt avec du stock → `409 stock_restant` ;
  - Q15 : marge du rapport des ventes = ventes HT − rémunération due ;
  - GTA : aucune donnée.
- [X] T020 [US3] Dans `src/depotvente.ts`, routes `POST /depots-vente`, `POST /depots-vente/:produitId/remuneration`, `POST /depots-vente/:produitId/fin` et `GET /depots-vente` selon contracts/routes-internes.md :
  - `achats.gerer` sur la branche de l'article ; `achats.voir` ou `stocks.voir` pour la liste ;
  - refus `article_deja_achete` si l'article a du stock ou une ligne dans une commande non annulée ;
  - le fournisseur est lié à la branche (`lierTiers`) et reçoit le rôle fournisseur ;
  - champs écrits : `articles_depot.produit_id`, `articles_depot.fournisseur_id`, `articles_depot.actif` ; une ligne de `remunerations_depot` (`remunerations_depot.mode`, `remunerations_depot.prix_reversement` ou `remunerations_depot.commission_pct`, `remunerations_depot.depuis_le`) à chaque rémunération.
- [X] T021 [US3] Dans `src/depotvente.ts`, routes `POST /depots-vente/:produitId/entrees` (`entrerEnStock` au coût 0, motif « Dépôt-vente : <fournisseur> », `stocks.gerer` sur le lieu, refus `depot_inactif`) et `POST /depots-vente/:produitId/retours` (`sortirDuStock` type `sortie`, motif « Retour au déposant »).
- [X] T022 [US3] Dans `src/depotvente.ts` :
  - **Calcul** : écrire `lignesAReleve(c, fournisseurId, du, au)`. Il prend toutes les lignes des articles du fournisseur jusqu'à `au` (dates de Douala) qui ne sont pas encore dans `lignes_releve_depot` ; `releves_depot.du` est indicatif et l'aperçu compte à part les lignes antérieures à `du` (`anterieures`) :
    - en positif : `lignes_comptoir` des ventes non annulées, et `lignes_vente` des factures émises ;
    - en négatif : `lignes_retour_comptoir`, et `lignes_vente` des avoirs émis ;
    - pour chacune : `remuneration_depot(...)`.
  - **Routes** : `GET /depots-vente/releves/apercu`, `POST /depots-vente/releves` et `GET /depots-vente/releves`, selon contracts/routes-internes.md, avec `compta.saisir` sur la branche pour le relevé et le verrou consultatif du fournisseur.
  - **Le relevé écrit** :
    - `releves_depot.numero` (série `RDV-AAAA`), `releves_depot.du`, `releves_depot.au`, `releves_depot.total_du` (> 0, sinon `409 releve_vide`) ;
    - ses `lignes_releve_depot` ;
    - une facture fournisseur en brouillon (numéro fournisseur = numéro du relevé, une ligne au compte `achats_marchandises`, sans taxe) reliée par `releves_depot.facture_fournisseur_id`.
- [X] T023 [US3] Dans `src/achats.ts`, `ecrireLignes` (l. 112) refuse `409 article_en_depot_vente` pour un article de `articles_depot` actif.
- [X] T024 [P] [US3] Dans `src/rapports.ts` (l. 84 à 103), le coût d'une ligne d'un article en dépôt-vente est `remuneration_depot(produit, date de la vente, quantité, montant HT)` au lieu de `quantité × coût moyen`.
- [X] T025 [P] [US3] Interface :
  - créer `public/depotvente.js` : écran « Dépôt-vente » avec les articles confiés (fournisseur, rémunération, stock par lieu, montant dû), la déclaration d'un article, le changement de rémunération, les entrées et retours, l'aperçu et la création du relevé, et la liste des relevés ;
  - l'ajouter dans `public/index.html` et au menu GLOMARI de `public/app.js` (droits `achats.voir` ou `stocks.voir`) ;
  - dans `public/sw.js`, cache `smarte-solutions-v5` avec le fichier.

**Point d'étape** : T019 vert ; un fournisseur local est payé exactement pour ce qui s'est vendu.

---

## Phase 6 : parcours 4, être averti au-delà de deux mois de stock (P2)

**Objectif** : couverture quotidienne par catégorie, notification unique au franchissement, avertissement à l'approbation (FR-021 à FR-024).

**Test indépendant** : `tests/couverture.test.ts` (scénarios Q16 à Q18 et Q20).

- [X] T026 [P] [US4] Écrire `tests/couverture.test.ts` :
  - Q16 : catégorie avec 300 en stock et 120 sorties `vente` sur 90 jours → 225 jours, au-dessus ; une notification aux titulaires de `achats.gerer` et `stocks.valider` ; aucune le lendemain ; une nouvelle après repassage sous le plafond puis dépassement ;
  - Q17 : catégorie avec du stock et aucune vente → infinie, au-dessus ; sans stock → absente ;
  - Q18 : détail d'une commande qui ferait dépasser → `couverture_prevue` ; approbation réussie avec `avertissements` ;
  - Q20 : GTA ne voit rien ; les articles en dépôt-vente sont exclus.
  - Les ventes se créent au moment du test (factures émises ou ventes de caisse : sorties `vente`). Pour reculer une date, le test passe par `env.poolAdmin` (compte d'administration de la base de test), jamais par le rôle `erp_app`, qui ne peut pas modifier les mouvements de stock. Le calcul quotidien se lance par `calculerAlertesCouverture(c, jour)` avec le jour simulé.
- [X] T027 [US4] Dans `src/couverture.ts`, écrire `couvertures(c, brancheId)` (requête agrégée selon research.md R10, hors `articles_depot` actifs, par catégorie de l'article, sous-catégorie comprise, sans regroupement par catégorie mère) et `GET /stocks/couverture` (`achats.voir` ou `stocks.voir` sur la branche), catégories au-dessus en tête.
- [X] T028 [US4] Dans `src/couverture.ts`, tâche quotidienne (`taches.push`) : une fois par jour après 2 h (heure de Douala), pour chaque branche avec le module de stock, elle écrit `alertes_couverture.stock`, `alertes_couverture.ventes_90`, `alertes_couverture.couverture_jours`, `alertes_couverture.au_dessus`, `alertes_couverture.depasse_depuis` (posé au franchissement, effacé en dessous) et `alertes_couverture.calcule_le`. Au franchissement, `notifier(c, titulaires(['achats.gerer','stocks.valider'], branche), 'couverture:<branche>:<catégorie>:<depasse_depuis>', texte, 'important')`. Exporter `calculerAlertesCouverture(c, jour)` pour les tests.
- [X] T029 [US4] Dans `src/couverture.ts`, `couverturePrevue(c, commandeId)` : par catégorie des lignes, couverture avec le stock plus la quantité commandée, gardée si elle dépasse le plafond. Dans `src/achats.ts`, `GET /achats/commandes/:id` ajoute `couverture_prevue`, et l'approbation (l. 602) renvoie `avertissements`, sans jamais bloquer.
- [X] T030 [P] [US4] Interface :
  - dans `public/entrepots.js`, onglet « Couverture » du module Stocks : catégorie, stock, ventes sur 90 jours, couverture et alerte ;
  - dans `public/gestion.js`, avertissement de couverture dans le détail d'une commande à approuver.

**Point d'étape** : T026 vert ; la règle des deux mois de stock est surveillée chaque jour.

---

## Phase 7 : finitions

- [X] T031 [P] Écrire `tests/achatsimportcompta.test.ts` (Q19) : après génération, les écritures proposées sont :
  - acompte : débit 4091 (avec le fournisseur), crédit 5211 ;
  - annulation d'acompte : l'inverse ;
  - imputation : débit 4011, crédit 4091, au journal OD ;
  - facture du relevé : 6011 / 4011.
  Après validation, le solde du 4091 est nul pour une commande soldée.
- [X] T032 Dans `src/comptabilite.ts` (`pieces()`) :
  - nouvelles écritures `acompte_fournisseur` et `acompte_fournisseur_annule`, à partir de `acomptes_fournisseur` (débit `avances_fournisseurs`, crédit compte du portefeuille ; l'inverse pour l'annulation) ;
  - dans le bloc des paiements fournisseurs (l. 190 à 207), un paiement avec `paiements_fournisseur.acompte_id` prend le compte `avances_fournisseurs` à la place du compte du portefeuille, au journal OD (et symétriquement pour son annulation) ;
  - repli sur `PARAMETRES_DE_DEPART` pour une branche déjà initialisée.
- [X] T033 [P] Mettre à jour `CLAUDE.md` :
  - état : lot 3B livré ;
  - retirer de « Limites connues » l'absence d'acompte fournisseur et de devise ;
  - entrées « Acomptes fournisseurs et devises » et « Dépôt-vente et couverture de stock » : règles, droits, imputation par paiement relié, taux de la comptabilité, rémunération datée, relevé facturé une fois, seuil de 60 jours sur 90 jours de ventes, pas d'option de coefficient d'importation (décision du 23 novembre 2026), écritures à valider par l'expert-comptable, sans remplacer un expert agréé ;
  - changement de droit : payer une facture fournisseur exige désormais `tresorerie.gerer` en plus de `compta.valider` ;
  - limites : pas d'acompte sur une commande reçue en entier (elle se paie par sa facture) ; retours de caisse non déduits des ventes sur 90 jours ; une vente en dépôt-vente payée à la livraison n'entre dans un relevé qu'une fois facturée (limite des lots 1 et 2).
- [X] T034 [P] Mettre à jour `docs/Couverture du cahier des charges.md` (Logistique, Finance, Commerce).
- [X] T035 [P] Dans `docs/Fiche technique globale GLOMARI.md`, section 9 lot 3, état de la partie B (fichiers, migration 0050, décision sur le coefficient).
- [X] T036 [P] Dans `docs/Guide de mise en ligne.md`, section « Achats à l'import » : taux de change à saisir par la comptabilité avant de commander en devise ; acomptes versés par le trésorier ; séparation des tâches pour la validation des factures fournisseurs.
- [X] T037 Relire `src/acomptes.ts`, `src/depotvente.ts`, `src/couverture.ts` et les ajouts :
  - chaque sortie d'argent sous `tresorerie.gerer` ;
  - verrous et ordre constant (commande, puis acompte, puis portefeuille) ;
  - chaque code passé à `ErreurApi` présent dans `MESSAGES` ;
  - aucune donnée de GTA ;
  - la règle « aucun nom déclaré deux fois » des écrans respectée.
- [ ] T038 Lancer `npx tsc --noEmit` et la suite complète avec le rôle restreint par le contrôle GitHub (`.github/workflows/verification.yml`) : tout vert.
- [ ] T039 Dérouler les scénarios de `specs/004-achats-import/quickstart.md` (automatisés par les tests ; essai privé sur serveur quand il existera).
- [ ] T040 Avec l'accord du responsable technique, pousser la branche, ouvrir la demande de fusion et attendre le contrôle GitHub au vert.

---

## Dépendances et ordre d'exécution

- **Phase 1** puis **phase 2** : T003 bloque tout ; T002 bloque les modules ; T006 bloque T022 et T032.
- **Parcours 1** et **parcours 2** : indépendants l'un de l'autre, mais tous deux touchent `src/achats.ts` ; T012, T016, T017, T023 et T029 se suivent dans ce fichier.
- **Parcours 3** : indépendant ; T023 touche `src/achats.ts` après T016.
- **Parcours 4** : indépendant ; T029 touche `src/achats.ts` en dernier.
- Même fichier, donc dans l'ordre :
  - `src/acomptes.ts` : T008 → T009 → T010 ;
  - `src/depotvente.ts` : T020 → T021 → T022 ;
  - `src/couverture.ts` : T027 → T028 → T029 ;
  - `public/gestion.js` : T014 → T018 → T030.
- **Parallélisable** :
  - T004 à T006 après T003 ;
  - chaque fichier de test (T007, T015, T019, T026, T031) dès la phase 2 ;
  - T013 et T024 seuls dans leur fichier ;
  - T025 en parallèle de T020 à T022 ;
  - T033 à T036 ensemble.

## Exemple de travail en parallèle : phase 2

```text
Tâche : « codes d'erreur » (T004, public/app.js)
Tâche : « outils de test » (T005, tests/importoutils.ts)
Tâche : « paramètres comptables » (T006, src/plan_comptable.ts)
```

## Exemple de travail en parallèle : parcours 3

```text
Tâche : « tests du dépôt-vente » (T019, tests/depotvente.test.ts)
Tâche : « marge des articles en dépôt » (T024, src/rapports.ts)
Tâche : « écran Dépôt-vente » (T025, public/depotvente.js)
```

## Stratégie

- **MVP** : phases 1 et 2, puis parcours 1. Les acomptes au fabricant sont tracés et déduits une seule fois (règle R5).
- **Ensuite** : parcours 2 (devises), qui complète l'import ; puis parcours 3 (dépôt-vente) et parcours 4 (couverture), indépendants ; puis les finitions (comptabilité, documents).
