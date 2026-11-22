# Contrats API : routes internes du paiement en ligne (lot 2)

**Accès** : session (`protege()`), droit vérifié sur la branche par `exigerSurEntite()`.

---

## GET `/paiements-en-ligne?jour=AAAA-MM-JJ&moyen=&statut=`

Rapprochement. Branches de `entitesAccessibles(…, "tresorerie.voir")` et de `entitesAccessibles(…, "facturation.voir")` ; sans aucune des deux : `403 permission_refusee`.

- `jour` : date de Douala de `traite_le` (par défaut aujourd'hui) ; `moyen` et `statut` facultatifs.
- Réponse : `{ "paiements": [ … ], "total": 0, "nombre": 0 }`. Chaque ligne : `id`, `reference_prestataire`, `prestataire`, `moyen`, `montant`, `statut`, `motif`, `commande` (référence), `facture` (numéro), `portefeuille` (nom) ou `en_attente: true`, `traite_le`.
- `total` et `nombre` portent sur les paiements `reussi` et `a_rembourser` de la sélection : ce que l'opérateur a réellement versé.

## GET `/commandes-web/:id` (lot 1, complété)

Ajoute `facture` (numéro), `responsable` et `paiements` (`reference_prestataire`, `moyen`, `montant`, `statut`, `motif`, `lance_le`, `traite_le`).

## POST `/commandes-web/:id/terminer`

Termine une vente restée `payee` (étape de vente impossible au moment de l'avis), une fois la cause corrigée.

- `facturation.gerer` sur la branche ; commande `payee` avec un paiement `reussi` : sinon `409 vente_deja_terminee`.
- Refait l'étape « vente » de `research.md` section 5 au nom du responsable de la boutique. En cas de nouvel échec, l'erreur d'origine est renvoyée (ex. `409 identite_vendeur_incomplete`) et rien ne change.
- Réponse : `{ "statut": "facturee", "facture": "FAC-GLOMARI-2026-000001" }`.

## POST `/canal-config` (lot 1, complété)

Avec `actif: true`, enregistre aussi `responsable_id` = la personne qui ouvre la boutique. `GET /canal-config` renvoie `responsable` (nom).

---

## Tâches créées automatiquement

| Cas | Assignée à | Titre |
|---|---|---|
| Paiement à rembourser | chaque titulaire de `tresorerie.gerer` sur la branche (`titulaires`) ; à défaut le responsable | « Rembourser le paiement {référence opérateur} : {montant} FCFA ({motif}) » |
| Vente à terminer | chaque titulaire de `facturation.administrer` sur la branche ; à défaut le responsable | « Terminer la vente de la commande {référence} : {cause} » |

`cree_par` = responsable de la boutique ; `entite_id` = branche ; `echeance` = le lendemain.

---

## Écran

- « Commandes en ligne » (`public/canalenligne.js`) : état du paiement, référence de l'opérateur, facture, bouton « Terminer la vente » pour une commande `payee` (`facturation.gerer`).
- Onglet « Paiements en ligne » dans le même écran : liste du jour par moyen, total, paiements à rembourser (visible avec `tresorerie.voir` ou `facturation.voir`).
