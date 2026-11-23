# Routes internes : achats à l'import (lot 3B)

Session obligatoire (`protege`). Chaque droit se vérifie côté serveur, sur la branche ou le lieu concerné. Toute erreur a son message dans `MESSAGES` (`public/app.js`). Aucune route publique.

## Acomptes fournisseurs (`src/acomptes.ts`)

### POST /achats/commandes/:id/acomptes

- **Droit** : `tresorerie.gerer` sur la branche de la commande.
- **Corps** : `{ "portefeuilleId": "uuid", "montant": 3000000, "date": "2026-11-23", "reference": "VIR-0042", "devise": "CNY", "montantDevise": 35250.00, "taux": 85.1064 }`. Le montant en devise et le taux sont facultatifs, à donner ensemble avec la devise.
- **Refus** :

| Refus | Cas |
|---|---|
| `409 commande_non_approuvee` | commande ni `approuvee` ni `recue_partiellement` |
| `409 transfert_autre_branche` | portefeuille d'une autre branche |
| `409 portefeuille_inactif` | portefeuille inactif |
| `409 solde_portefeuille_insuffisant` | portefeuille sans assez d'argent |
| `409 acompte_superieur_commande` | le total des acomptes actifs dépasserait le total de la commande |

- **Effet** : l'acompte est enregistré, avec une sortie dans le portefeuille (`source_type = 'acompte_fournisseur'`, auteur) ; le journal note `achat.acompte`.
- **Réponse 201** : l'acompte et son disponible.

### POST /achats/acomptes/:id/annulation

- **Droit** : `tresorerie.gerer` sur la branche.
- **Corps** : `{ "motif": "Commande abandonnée, remboursée par le fabricant" }`.
- **Refus** : `409 acompte_impute` (une imputation active existe), `409 deja_annule`.
- **Effet** : contre-passation du mouvement (l'argent revient dans le portefeuille), `annule_le`, motif, auteur.

### Bon de commande (`GET /achats/commandes/:id`, existante)

Ajoute :

- `acomptes` : `{ verse, impute, disponible, liste: [{ id, montant, date_versement, reference, portefeuille, devise, montant_devise, taux, disponible, annule_le }] }`, ou `null` sans `compta.voir` ni `tresorerie.voir` sur la branche (comme `paiement`) ;
- `devise`, `taux`, `taux_jour`, `total_devise`, et `prix_devise` sur chaque ligne ;
- `couverture_prevue` : `[{ categorie, couverture_actuelle, couverture_prevue }]` pour les catégories qui dépasseraient 60 jours.

### Validation d'une facture fournisseur (`POST /fournisseurs/factures/:id/validation`, existante)

- Après la validation, si la facture est reliée à un bon de commande : `imputerAcomptes` crée une ligne de paiement par acompte disponible (ordre de versement), pour le plus petit du disponible et du reste de la facture, sans mouvement de portefeuille.
- Réponse : la facture, plus `acomptes_imputes: [{ acompte, montant }]`.

### Paiement d'une facture fournisseur (`POST /fournisseurs/factures/:id/paiements` et `/fournisseurs/lots-paiement`, existantes)

- Exigent en plus `tresorerie.gerer` sur l'entité du portefeuille (règle des sorties d'argent).

### Annulation d'un paiement fournisseur (`POST /fournisseurs/paiements/:id/annulation`, existante)

- Refuse une ligne d'imputation d'acompte : `409 imputation_non_annulable`.

### Annulation d'une facture fournisseur (existante)

- Toujours refusée s'il existe un paiement réel actif (`facture_payee`).
- Les imputations d'acompte actives sont annulées avec la facture : les acomptes redeviennent disponibles.

### Annulation d'un bon de commande (existante)

- Refusée avec `409 acompte_a_recuperer` si un acompte de la commande garde un disponible.

## Achats en devise (`src/achats.ts`, routes existantes)

### POST /achats/commandes

- Champ facultatif `devise` : `USD`, `CNY` ou `EUR`.
- Avec une devise, chaque ligne porte `prixDevise` (au plus quatre décimales, par unité achetée) au lieu de `prixUnitaire` ; sans devise, `prixUnitaire` comme aujourd'hui.
- **Refus** :

| Refus | Cas |
|---|---|
| `409 taux_inconnu` | aucun taux pour cette devise à la date de commande ou avant ; réponse `{ "devise": "CNY", "jour": "2026-11-23" }` |
| `400 prix_devise_obligatoire` | une ligne sans `prixDevise` pour une commande en devise, ou avec `prixDevise` pour une commande en FCFA |
| `400 prix_obligatoire` | une ligne sans `prixUnitaire` pour une commande en FCFA |
| `409 article_en_depot_vente` | une ligne porte un article en dépôt-vente |

### PUT /achats/commandes/:id/lignes

- Même règle de prix, selon la devise de la commande ; le taux est repris pour la date de commande.

### POST /achats/commandes/:id/approbation

- Réponse : `{ "statut": "approuvee", "avertissements": [{ "categorie": "Robots", "couverture_prevue": 84.5 }] }`.
- Les avertissements de couverture ne bloquent jamais.

## Dépôt-vente (`src/depotvente.ts`)

### GET /depots-vente?brancheId=

- **Droit** : `achats.voir` ou `stocks.voir` sur la branche.
- **Réponse** : pour chaque article confié :
  - article, fournisseur, actif, rémunération actuelle (mode, valeur, depuis) ;
  - stock en dépôt par lieu ;
  - montant dû non encore relevé.

### POST /depots-vente

- **Droit** : `achats.gerer` sur la branche de l'article.
- **Corps** : `{ "produitId": "uuid", "fournisseurId": "uuid", "mode": "prix_fixe", "prixReversement": 3000 }`, ou `{ …, "mode": "commission", "commissionPct": 25 }`.
- **Refus** : `409 article_deja_achete` (stock existant ou ligne de commande ouverte), `409 existe_deja`, `409 module_inactif`.
- **Effet** : l'article passe en dépôt-vente, avec sa première rémunération ; le fournisseur reçoit le rôle fournisseur.

### POST /depots-vente/:produitId/remuneration

- **Droit** : `achats.gerer`.
- **Corps** : mode et valeur.
- **Effet** : une nouvelle ligne d'historique, en vigueur à partir de maintenant.

### POST /depots-vente/:produitId/entrees

- **Droit** : `stocks.gerer` sur le lieu.
- **Corps** : `{ "lieuId": "uuid", "quantite": 200, "reference": "BL coopérative 12" }`.
- **Refus** : `409 depot_inactif`.
- **Effet** : entrée en stock au coût 0, motif « Dépôt-vente : <fournisseur> ».

### POST /depots-vente/:produitId/retours

- **Droit** : `stocks.gerer` sur le lieu.
- **Corps** : `{ "lieuId": "uuid", "quantite": 20 }`.
- **Effet** : sortie motif « Retour au déposant », sans montant dû ; refus `stock_insuffisant` au-delà du vendable.

### POST /depots-vente/:produitId/fin

- **Droit** : `achats.gerer`.
- **Refus** : `409 stock_restant` s'il reste du stock.
- **Effet** : `actif = false`.

### GET /depots-vente/releves/apercu?fournisseurId=&du=&au=

- **Droit** : `compta.saisir` sur la branche du fournisseur.
- **Réponse** : les lignes qui entreraient dans le relevé (type, date, article, quantité, montant HT, montant dû) et le total.

### POST /depots-vente/releves

- **Droit** : `compta.saisir` sur la branche.
- **Corps** : `{ "fournisseurId": "uuid", "du": "2026-11-01", "au": "2026-11-30" }`.
- **Refus** : `400 periode_invalide` (fin avant début, ou après aujourd'hui), `409 releve_vide` (total ≤ 0).
- **Lignes retenues** : toutes les lignes non encore relevées jusqu'à `au`. `du` est indicatif ; l'aperçu signale les lignes antérieures à `du` (`anterieures: n`), qui entrent aussi dans le relevé.
- **Effet** :
  - relevé `RDV-AAAA-NNNNNN` ;
  - lignes, chacune unique par source ;
  - facture fournisseur en brouillon (numéro fournisseur = numéro du relevé, une ligne au compte `achats_marchandises`, sans taxe) ;
  - journal `depot_vente.releve`.
- **Réponse 201** : `{ "releve": { … }, "facture": { "id", "statut": "brouillon", "total_ttc" } }`.

### GET /depots-vente/releves?brancheId=

- **Droit** : `compta.voir` ou `achats.voir`.
- **Réponse** : la liste des relevés, avec l'état de leur facture.

## Couverture de stock (`src/couverture.ts`)

### GET /stocks/couverture?brancheId=

- **Droit** : `achats.voir` ou `stocks.voir` sur la branche.
- **Réponse** : pour chaque catégorie, calculée à la demande :
  - `categorie` (ou « Sans catégorie »), `stock`, `ventes_90`, `couverture_jours` (nul si infinie), `au_dessus`, `depasse_depuis` ;
  - les catégories au-dessus du plafond viennent en tête.

### Tâche quotidienne

Après 2 h (heure de Douala), une fois par jour et par branche avec le module de stock :

- elle met à jour `alertes_couverture` ;
- au franchissement, elle envoie une notification `notifier` aux titulaires de `achats.gerer` ou `stocks.valider` de la branche, avec la clé `couverture:<branche>:<catégorie>:<depasse_depuis>`.
