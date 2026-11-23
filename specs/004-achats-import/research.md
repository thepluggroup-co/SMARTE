# Research : Achats à l'import (lot 3B)

Décisions prises en lisant le code existant : achats, factures et paiements fournisseurs, trésorerie, taux de change, caisse, retours, rapports, comptabilité. Aucune inconnue ne reste ouverte.

## R1. Acompte fournisseur : une sortie d'argent tracée, reliée au bon de commande

- **Decision** : nouvelle table `acomptes_fournisseur`, rattachée à un bon de commande approuvé ou reçu en partie. L'enregistrement :
  - exige `tresorerie.gerer` sur la branche ;
  - prend un portefeuille de la même branche, verrouillé, et refuse un solde insuffisant ;
  - écrit une sortie `source_type = 'acompte_fournisseur'`.
  Le total des acomptes actifs ne dépasse pas le total de la commande. Le montant en devise et le taux sont gardés pour information.
- **Rationale** : la règle du projet veut que toute sortie d'argent exige `tresorerie.gerer`. La sortie suit la même forme que le paiement d'une facture fournisseur (verrou, solde, même branche), ce qui la rend lisible par la trésorerie, le tableau de bord et la comptabilité.
- **Alternatives considered** : une fausse facture « d'acompte » en brouillon. Elle fausserait le contrôle entre commande, réception et facture, et la TVA.

## R2. Imputation : un règlement de la facture relié à l'acompte, sans nouvelle sortie

- **Decision** : `paiements_fournisseur.acompte_id` (nouvelle colonne). À la validation d'une facture fournisseur reliée à un bon de commande, les acomptes disponibles de ce bon s'imputent dans l'ordre de versement : une ligne de paiement par acompte, pour le plus petit du disponible et du reste de la facture, avec le portefeuille de l'acompte et sans mouvement de portefeuille. Un déclencheur refuse qu'un acompte soit imputé au-delà de son montant (somme des imputations actives).
- **Rationale** : le reste à payer (`total_ttc − payé`), le paiement du solde, l'échéancier et le suivi de paiement du bon de commande additionnent déjà les paiements ; ils restent justes sans rien toucher. La base elle-même empêche le double comptage. C'est la même logique que l'imputation de l'acompte client au lot 3A.
- **Alternatives considered** : une table d'imputations à part. Il fallait alors corriger chaque somme de paiements de l'ERP.

## R3. Annulations

- **Decision** :
  - **acompte non imputé** : il s'annule avec un motif (le fournisseur a remboursé), et une contre-passation remet l'argent dans le portefeuille ; refusé dès qu'une imputation active existe (`acompte_impute`) ;
  - **facture fournisseur** : l'annulation reste refusée s'il y a un vrai paiement ; s'il n'y a que des imputations, elles s'annulent et les acomptes redeviennent disponibles ;
  - **bon de commande** : refusé tant qu'un acompte garde un disponible (`acompte_a_recuperer`).
- **Rationale** : spécification FR-006 et FR-007. On ne perd jamais la trace d'un argent versé.

## R4. Achats en devise : conversion exacte en entiers

- **Decision** : sur le bon de commande, trois nouvelles colonnes : `devise` (USD, CNY, EUR, ou vide pour FCFA), `taux` et `taux_jour`, fixées à la création. Le taux est le dernier de `taux_change` pour la devise à la date de commande ou avant ; sans taux, refus `taux_inconnu`. Chaque ligne garde `prix_devise` (par unité achetée, quatre décimales au plus) :
  - le prix unitaire en FCFA, qui sert au coût du stock et aux marges, vaut `round(prix_devise × taux)` ;
  - le total de la ligne vaut `round(quantité × prix_devise × taux)`, calculé en entiers exacts (`BigInt`), comme le total d'un achat par carton reste celui de l'unité achetée.
  Les lignes ne changent qu'en brouillon ; leur modification reprend le taux de la date de commande. Le taux est donc figé de fait à l'approbation.
- **Rationale** : spécification FR-009 à FR-012 et SC-002 (2 000 × 210 CNY × 85,1234 = 35 751 828 FCFA exactement). Le stock et les marges restent en FCFA entiers.
- **Alternatives considered** : arrondir le prix unitaire puis multiplier. L'écart peut atteindre la moitié de la quantité en francs (172 FCFA dans l'exemple).

## R5. Taux de change

- **Decision** : la table et l'écran existants (`PUT /devises/taux`, droit `compta.saisir`) restent la seule source. Aucun appel à un service en ligne.
- **Rationale** : la comptabilité décide du taux retenu ; aucune dépendance extérieure.

## R6. Dépôt-vente : l'article, sa rémunération datée, et les ventes déjà enregistrées

- **Decision** :
  - **Tables** : `articles_depot` (un article confié par un fournisseur de la branche) et `remunerations_depot`, en insertion seule (mode `prix_fixe` ou `commission`, valeur, date d'effet).
  - **Formule unique** : la fonction SQL `remuneration_depot(produit, quand, quantité, montant_ht)` prend la rémunération en vigueur à la date de la vente : `quantité × prix` pour un prix fixe, `montant_ht × (100 − commission) / 100` pour une commission, arrondi au franc par ligne.
  - **Relevé** : il se calcule à partir des pièces existantes, en positif les lignes de caisse non annulées et les lignes de facture émises, en négatif les lignes de retour de caisse et les lignes d'avoir émises.
  - **Unicité** : chaque ligne retenue entre dans `lignes_releve_depot`, avec une clé unique (type de source, identifiant de la ligne) ; une vente n'entre donc que dans un seul relevé.
- **Rationale** :
  - les ventes de la Marketplace sont facturées (lot 2), elles entrent donc par les factures ;
  - on ne touche ni à la caisse, ni à la facturation, ni aux retours ;
  - la rémunération « au jour de la vente » se lit dans l'historique, et la même fonction sert au relevé et à la marge (FR-020).
- **Alternatives considered** :
  - des déclencheurs sur chaque vente : trop d'endroits d'écriture, et la caisse hors connexion ;
  - un montant dû stocké à la vente : il dupliquerait les ventes.

## R7. Stock confié : vendable, sans valeur pour GLOMARI

- **Decision** :
  - l'arrivée entre en stock avec un coût unitaire de 0 (`entrerEnStock`, motif « Dépôt-vente ») ;
  - un article en dépôt-vente ne peut ni figurer sur un bon de commande, ni passer en dépôt s'il a du stock ou une ligne de commande ouverte ;
  - son coût moyen reste donc 0, et sa valeur de stock aussi ;
  - le retour des invendus est une sortie (`sortirDuStock`, motif « Retour au déposant »), sans montant dû.
- **Rationale** : FR-015, FR-018 et FR-019, sans toucher au calcul du coût moyen ni à la valeur du stock.

## R8. Relevé : une facture fournisseur en brouillon, le circuit existant pour le reste

- **Decision** : `POST /depots-vente/releves` (droit `compta.saisir` sur la branche) crée :
  - le relevé (numéro `RDV-AAAA-NNNNNN`, période, total dû) ;
  - ses lignes ;
  - une facture fournisseur en brouillon, au numéro fournisseur = numéro du relevé, une ligne au compte d'achats de marchandises (paramètre `achats_marchandises`, 6011 par défaut), sans taxe.
  La validation (séparation des tâches) et le paiement suivent le circuit existant. Un relevé à zéro ou négatif est refusé (`releve_vide`).
- **Rationale** : FR-017 ; aucune nouvelle sortie d'argent, le paiement reste celui des factures fournisseurs.

## R9. Marges et rapports des articles en dépôt-vente

- **Decision** : dans `src/rapports.ts`, le coût d'une ligne d'un article en dépôt-vente est `remuneration_depot(...)` au lieu de `quantité × coût moyen`.
- **Rationale** : FR-020 ; sans cela, la marge serait égale à toute la vente.

## R10. Couverture de stock par catégorie (règle R11)

- **Decision** : la fonction `couvertures(c, branche)` calcule, par catégorie d'article (« sans catégorie » à part) :
  - le stock : somme des mouvements dans les lieux de la branche, hors articles en dépôt-vente ;
  - les ventes des 90 derniers jours : sorties de type `vente`, communes à la caisse, à la facture et à la Marketplace ;
  - la couverture : stock ÷ (ventes / 90), infinie s'il y a du stock sans vente, nulle sans stock.
  Une tâche quotidienne (après 2 h, heure de Douala, comme les mesures OKR) écrit l'état dans `alertes_couverture` et notifie par `notifier` (performance), avec la clé `couverture:<branche>:<catégorie>:<date du franchissement>` : une seule notification par franchissement. Destinataires : titulaires de `achats.gerer` ou `stocks.valider` de la branche.
  La liste se lit par `GET /stocks/couverture`. Le détail d'un bon de commande calcule la couverture prévue (stock + quantité commandée) ; l'approbation la renvoie aussi en avertissement, sans bloquer.
- **Rationale** : FR-021 à FR-024. Les sorties `vente` donnent les quantités dans l'unité de base, quelle que soit la façon de vendre. Limite connue : les retours de caisse ne sont pas déduits des ventes sur 90 jours, ce qui sous-estime un peu la couverture.
- **Alternatives considered** : la prévision mensuelle existante (`/previsions/ventes`). Elle porte sur l'article, ne compte ni la Marketplace ni les retours de la même façon, et ne notifie pas.

## R11. Tableau de bord et comptabilité

- **Decision** :
  - **Tableau de bord** : les sorties `acompte_fournisseur` sont exclues des dépenses de GLOMARI (FR-008), comme le paiement d'une facture reliée à une commande.
  - **Comptabilité** (`pieces()`) : nouvelles écritures proposées :
    - acompte versé : débit 4091 (avances fournisseurs, avec le fournisseur), crédit compte du portefeuille ;
    - son annulation : l'inverse ;
    - paiement d'imputation (`acompte_id`) : débit 4011, crédit 4091, au journal OD au lieu du compte du portefeuille ; son annulation est symétrique.
  - **Paramètres** : `avances_fournisseurs` (4091) et `achats_marchandises` (6011), avec repli pour une branche déjà initialisée.
- **Rationale** : FR-027 ; l'expert-comptable valide.

## R12. Où vit le code

- **Decision** :
  - `src/acomptes.ts` : acomptes et imputation ; `imputerAcomptes` est appelée par la validation des factures (`src/fournisseurs.ts`) ;
  - `src/depotvente.ts` : articles, rémunérations, entrées, retours, relevés ;
  - `src/couverture.ts` : calcul, alerte, tâche quotidienne ;
  - `src/achats.ts` : devise dans `ecrireLignes` et à la création ; refus d'un article en dépôt ; refus de l'annulation avec acompte disponible ; couverture prévue dans le détail et à l'approbation.
  Dépendances à sens unique :
  - `fournisseurs` dépend de `acomptes` ;
  - `achats` dépend de `couverture` ;
  - `couverture`, `acomptes` et `depotvente` lisent les achats en SQL, sans import.
- **Rationale** : un fichier par domaine, comme le reste du monolithe ; aucune dépendance circulaire.

## R14. Paiement des factures fournisseurs : la règle de trésorerie rétablie

- **Decision** : `payerFacture` (`src/fournisseurs.ts`), qui sert au paiement d'une facture et aux lots de paiement, exige en plus `tresorerie.gerer` sur l'entité du portefeuille. La route d'annulation d'un paiement fournisseur refuse une ligne d'imputation d'acompte (`imputation_non_annulable`) : seule l'annulation de la facture rend les acomptes.
- **Rationale** : la règle du projet veut que toute sortie d'argent exige `tresorerie.gerer`. Ce paiement ne demandait que `compta.valider`, et le lot 3B s'appuie sur lui (reste après acomptes, relevés de dépôt-vente). Les tests existants paient avec l'administrateur, qui a les deux droits.
- **Alternatives considered** : laisser l'écart. Le critère SC-005 serait faux.

## R13. Tests

- **Decision** : vitest avec le rôle restreint, un fichier par parcours, plus un fichier comptable. Le calcul quotidien se teste en appelant la fonction exportée ou la tâche, avec des ventes et des stocks posés par les routes existantes. Les tests tournent dans GitHub Actions.
