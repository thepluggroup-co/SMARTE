# Data Model : Achats à l'import (lot 3B)

Migration `0050_achats_import.sql`. Toute table nouvelle : RLS forcée, politique `cloison`, clés étrangères composites `(organisation_id, …)`, audit, droits accordés à `erp_app`. Montants en FCFA entiers (`bigint`).

## Tables nouvelles

### acomptes_fournisseur

Un versement au fournisseur d'un bon de commande, avant sa facture.

| Colonne | Type | Règle |
|---|---|---|
| id | uuid | clé |
| organisation_id | uuid | non nul |
| commande_id | uuid | FK `commandes_achat` ; commande `approuvee` ou `recue_partiellement` à l'enregistrement |
| fournisseur_id | uuid | FK `tiers` ; celui de la commande |
| portefeuille_id | uuid | FK `portefeuilles` ; même branche que la commande |
| montant | bigint | > 0 |
| date_versement | date | non nulle |
| reference | text | au plus 200 caractères |
| devise | text | facultative ; `^[A-Z]{3}$` |
| montant_devise | numeric(16,2) | facultatif ; > 0 ; présent si et seulement si `devise` l'est |
| taux | numeric(14,4) | facultatif ; > 0 ; présent si et seulement si `devise` l'est |
| annule_le | timestamptz | |
| motif_annulation | text | 5 à 500 caractères ; présent si et seulement si `annule_le` l'est |
| annule_par | uuid | FK `utilisateurs` |
| auteur_id | uuid | FK `utilisateurs` ; non nul |
| cree_le | timestamptz | |

Contraintes : `unique (organisation_id, id)` ; `check ((devise is null) = (montant_devise is null) and (devise is null) = (taux is null))` ; `check ((annule_le is null) = (motif_annulation is null))`. Index `(organisation_id, commande_id)`.

**Disponible** = `montant − somme des paiements_fournisseur actifs (annule_le nul) dont acompte_id = id`, si l'acompte n'est pas annulé ; sinon 0.

### articles_depot

Un article confié par un fournisseur de la branche.

| Colonne | Type | Règle |
|---|---|---|
| id | uuid | clé |
| organisation_id | uuid | non nul |
| produit_id | uuid | FK `produits` ; unique par organisation ; article suivi en stock d'une branche avec le module de stock |
| fournisseur_id | uuid | FK `tiers` ; même branche, reçoit le rôle fournisseur |
| actif | boolean | défaut vrai ; faux quand l'article quitte le dépôt-vente (stock nul exigé) |
| cree_par | uuid | FK `utilisateurs` |
| cree_le | timestamptz | |

Contraintes : `unique (organisation_id, id)`, `unique (organisation_id, produit_id)`.

### remunerations_depot

Historique des rémunérations, en insertion seule.

| Colonne | Type | Règle |
|---|---|---|
| id | uuid | clé |
| organisation_id | uuid | non nul |
| produit_id | uuid | FK `articles_depot(organisation_id, produit_id)` |
| mode | text | `prix_fixe` ou `commission` |
| prix_reversement | bigint | ≥ 0 ; présent si et seulement si `mode = 'prix_fixe'` |
| commission_pct | numeric(5,2) | entre 0 et 100 ; présente si et seulement si `mode = 'commission'` |
| depuis_le | timestamptz | défaut `now()` ; date d'effet |
| auteur_id | uuid | FK `utilisateurs` |

Contraintes : `check ((mode = 'prix_fixe') = (prix_reversement is not null))`, `check ((mode = 'commission') = (commission_pct is not null))`. Index `(organisation_id, produit_id, depuis_le desc)`. Aucun droit `update` ni `delete` pour `erp_app`.

### releves_depot

| Colonne | Type | Règle |
|---|---|---|
| id | uuid | clé |
| organisation_id | uuid | non nul |
| branche_id | uuid | FK `entites` ; branche avec le module de stock |
| fournisseur_id | uuid | FK `tiers` |
| numero | text | `^RDV-[0-9]{4}-[0-9]{6}$`, unique par organisation |
| du | date | début de période, indicatif : le relevé prend toutes les lignes non encore relevées jusqu'à `au` |
| au | date | fin de période ; ≥ `du` ; pas après aujourd'hui |
| total_du | bigint | > 0 |
| facture_fournisseur_id | uuid | FK `factures_fournisseur` ; non nul |
| cree_par | uuid | FK `utilisateurs` |
| cree_le | timestamptz | |

### lignes_releve_depot

| Colonne | Type | Règle |
|---|---|---|
| id | uuid | clé |
| organisation_id | uuid | non nul |
| releve_id | uuid | FK `releves_depot` |
| source_type | text | `comptoir`, `retour`, `facture` ou `avoir` |
| source_id | uuid | la ligne de caisse, de retour, de facture ou d'avoir |
| produit_id | uuid | FK `produits` |
| quantite | numeric(14,3) | signée : négative pour un retour ou un avoir |
| montant_ht | bigint | signé |
| montant_du | bigint | signé ; `remuneration_depot(...)` |
| vendu_le | timestamptz | date de la vente, du retour ou de l'avoir |

Contraintes : `unique (organisation_id, source_type, source_id)`, qui fait qu'une vente n'entre que dans un seul relevé.

### alertes_couverture

État de la dernière couverture calculée, par branche et catégorie.

| Colonne | Type | Règle |
|---|---|---|
| id | uuid | clé |
| organisation_id | uuid | non nul |
| branche_id | uuid | FK `entites` |
| categorie_id | uuid | FK `categories_articles` ; nul pour « sans catégorie » |
| stock | numeric(14,3) | |
| ventes_90 | numeric(14,3) | |
| couverture_jours | numeric(10,1) | nulle si infinie (stock sans vente) |
| au_dessus | boolean | couverture > 60 jours ou infinie |
| depasse_depuis | date | jour du franchissement en cours ; nul si en dessous |
| calcule_le | date | jour du calcul (Douala) |

Contraintes : index unique `(organisation_id, branche_id, coalesce(categorie_id, '00000000-0000-0000-0000-000000000000'))`.

## Tables modifiées

### commandes_achat (0008, 0037)

- `devise` text, valeurs `USD`, `CNY` ou `EUR` ; vide = FCFA.
- `taux` numeric(14,4), > 0.
- `taux_jour` date.
- `check ((devise is null) = (taux is null) and (devise is null) = (taux_jour is null))`.

### lignes_achat (0008, 0037, 0044)

- `prix_devise` numeric(16,4), ≥ 0 : prix par unité achetée dans la devise de la commande ; présent si et seulement si la commande a une devise (contrôlé par l'application).

### paiements_fournisseur (0018)

- `acompte_id` uuid, FK `acomptes_fournisseur` : paiement d'imputation, sans mouvement de portefeuille.
- Déclencheur `acompte_non_depasse`, avant insertion : refuse si la somme des imputations actives de l'acompte, avec la nouvelle, dépasse son montant, ou si l'acompte est annulé (code `AF001`, que l'application traduit en `acompte_insuffisant`).
- Index `(organisation_id, acompte_id) where acompte_id is not null`.

### Fonction SQL

`remuneration_depot(p_produit uuid, p_quand timestamptz, p_quantite numeric, p_ht bigint) returns bigint`, stable :

- elle prend la ligne de `remunerations_depot` du produit avec la plus grande `depuis_le ≤ p_quand` ;
- `prix_fixe` → `round(p_quantite × prix_reversement)` ;
- `commission` → `round(p_ht × (100 − commission_pct) / 100)` ;
- elle renvoie nul si aucune rémunération ne s'applique.

`grant execute` à `erp_app`.

## Cycles de vie

### Acompte

`versé (disponible = montant)` → imputations à la validation des factures → `imputé en partie` → `imputé en entier (disponible 0)`. `versé` sans imputation active → `annulé` (contre-passation). L'annulation d'une facture rend leurs imputations à l'acompte.

### Alerte de couverture

`en dessous` → (couverture > 60 jours ou infinie) → `au-dessus` (`depasse_depuis` = jour, notification unique) → (≤ 60 jours) → `en dessous` (`depasse_depuis` nul).

## Calculs

- **Total d'une ligne en devise** : `round(quantité × prix_devise × taux)` en entiers exacts.
- **Prix unitaire en FCFA** : `round(prix_devise × taux)`.
- **Couverture** : `stock ÷ (ventes_90 ÷ 90)`.
- **Dépassement** : au-dessus de 60 jours (`SEUIL_COUVERTURE_JOURS`), sur une période de 90 jours (`PERIODE_VENTES_JOURS`).
- **Relevé** : somme des `montant_du` de ses lignes.
