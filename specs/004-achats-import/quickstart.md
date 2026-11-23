# Quickstart : vérifier les achats à l'import (lot 3B)

## Prérequis

- Lot 3A fusionné (demande n° 7).
- Contrôle GitHub `verification.yml` : PostgreSQL 16, rôle `erp_proprio`, tests avec le rôle restreint `erp_app`. Ce poste n'a ni PostgreSQL ni Docker : les tests tournent dans GitHub Actions.

```sh
npm ci
npx tsc --noEmit
TEST_ADMIN_URL=postgres://erp_proprio:erp_proprio@localhost:5432/postgres npm test
```

## Mise en place commune des tests

`tests/importoutils.ts` prépare :

- une organisation avec un dépôt GLOMARI (module de stock) ;
- un fournisseur ;
- un article catégorisé ;
- un portefeuille bancaire de la branche approvisionné (entrée manuelle) ;
- l'initialisation comptable ;
- des fonctions pour créer et approuver une commande, et pour saisir une facture fournisseur reliée.

Les routes sont décrites dans [routes-internes.md](./contracts/routes-internes.md), et les tables dans [data-model.md](./data-model.md).

## Scénarios

| N° | Scénario | Résultat attendu | Fichier |
|---|---|---|---|
| Q1 | Commande approuvée de 10 000 000, acomptes de 3 000 000 puis 7 000 000 | portefeuille − 10 000 000 ; détail : versé 10 000 000, disponible 10 000 000 | `acomptes` |
| Q2 | Acompte par un acheteur sans droit de trésorerie ; sur une commande en brouillon ; au-delà du total | `403` ; `409 commande_non_approuvee` ; `409 acompte_superieur_commande` | `acomptes` |
| Q3 | Facture de 10 000 000 reliée, validée | deux imputations (3 000 000 puis 7 000 000), facture soldée, aucun mouvement de portefeuille nouveau | `acomptes` |
| Q4 | Acomptes 4 000 000, facture 2 500 000 puis facture 1 500 000 | 2 500 000 imputés, 1 500 000 disponibles, puis 0 | `acomptes` |
| Q5 | Annulation d'un acompte non imputé ; d'un acompte imputé ; annulation de facture puis de l'acompte | argent revenu ; `409 acompte_impute` ; acompte de nouveau disponible puis annulable | `acomptes` |
| Q6 | Annulation d'une commande avec acompte disponible | `409 acompte_a_recuperer` | `acomptes` |
| Q7 | Taux CNY 85,1234 du jour ; commande de 2 000 × 210 CNY | ligne 35 751 828 FCFA, prix unitaire 17 876, total en devise 420 000, taux et date affichés | `devises` |
| Q8 | Commande en USD sans taux ; ligne sans `prixDevise` | `409 taux_inconnu` ; `400 prix_devise_obligatoire` | `devises` |
| Q9 | Nouveau taux enregistré après l'approbation ; réception | montants inchangés ; coût du stock au taux figé, frais compris | `devises` |
| Q10 | Article à 3 000 par pièce : 200 confiés, 30 vendus en caisse, 5 facturés, 2 retours | valeur du stock nulle ; aperçu de 33 pièces et 99 000 dus | `depotvente` |
| Q11 | Article à 25 % de commission, vendu 10 000 HT avec remise de 10 % | dû = 6 750 (sur 9 000 encaissés) | `depotvente` |
| Q12 | Relevé de la période ; second relevé de la même période | facture fournisseur en brouillon de 99 000 ; `409 releve_vide` (aucune vente deux fois) | `depotvente` |
| Q13 | Rémunération changée en cours de mois | les ventes d'avant gardent l'ancienne | `depotvente` |
| Q14 | Article en dépôt-vente sur un bon de commande ; article déjà acheté mis en dépôt ; retour des invendus | `409 article_en_depot_vente` ; `409 article_deja_achete` ; sortie sans montant dû | `depotvente` |
| Q15 | Marge du rapport pour l'article en dépôt-vente | coût = rémunération due, pas le coût moyen | `depotvente` |
| Q16 | Catégorie avec 300 en stock et 120 vendus sur 90 jours | couverture 225 jours, au-dessus ; notification unique ; aucune nouvelle le lendemain ; une nouvelle après repassage sous le plafond puis dépassement | `couverture` |
| Q17 | Catégorie avec du stock et aucune vente ; catégorie sans stock | infinie et au-dessus ; absente des alertes | `couverture` |
| Q18 | Détail et approbation d'une commande qui ferait dépasser 60 jours | `couverture_prevue` et avertissement à l'approbation, approbation faite | `couverture` |
| Q19 | Écritures proposées | acompte : 4091 / 5211 ; imputation : 4011 / 4091 au journal OD ; relevé : facture fournisseur 6011 / 4011 | `achatsimportcompta` |
| Q20 | Utilisateur de GTA ; tableau de bord de GLOMARI | aucune donnée ; les acomptes ne comptent pas en dépenses | `acomptes`, `couverture` |

## Essai manuel (serveur d'essai, données fictives)

1. Enregistrer un taux du yuan (Comptabilité › Devises), créer une commande en CNY et l'approuver.
2. Verser un acompte depuis « Achats › commande › Acomptes » avec un compte de trésorier.
3. Saisir la facture du fabricant reliée à la commande, la faire valider : vérifier qu'elle est soldée.
4. Déclarer un article en dépôt-vente, enregistrer une arrivée, vendre en caisse, établir le relevé du mois.
5. Lire « Stocks › Couverture » et vérifier les notifications du matin.
