# Modèle de données : paiement Mobile Money (lot 2)

**Feature** : 002-paiement-mobile-money
**Phase** : 1
**Date** : 2026-11-22

Source de référence des contraintes de champ. Tout est créé par `migrations/0048_paiement_en_ligne.sql`. Tables nouvelles : RLS activée et forcée, politique `cloison`, clés étrangères composites incluant `organisation_id`, audit.

---

## Tables nouvelles

### `paiements_en_ligne`

Une tentative de paiement d'une commande auprès d'un prestataire.

| Champ | Type | Contrainte |
|---|---|---|
| `id` | `uuid` | PK, `default gen_random_uuid()` |
| `organisation_id` | `uuid` | `not null` |
| `commande_id` | `uuid` | `not null`, FK `commandes_web` |
| `prestataire` | `text` | `not null`, `check (prestataire ~ '^[a-z0-9]{2,30}$')` |
| `moyen` | `text` | `not null`, `check (moyen in ('orange_money', 'mtn_momo'))`. Celui de la commande |
| `reference_prestataire` | `text` | `not null`, `check (length(reference_prestataire) between 1 and 100)` |
| `montant` | `bigint` | `not null`, `check (montant > 0)`. Égal à `commandes_web.total_ttc` au lancement |
| `statut` | `text` | `not null default 'lance'`, `check (statut in ('lance', 'reussi', 'echoue', 'a_rembourser'))` |
| `motif` | `text` | nullable, `check (motif in ('expiree', 'annulee', 'deja_payee'))`. Check : `(statut = 'a_rembourser') = (motif is not null)` |
| `lance_le` | `timestamptz` | `not null default now()` |
| `traite_le` | `timestamptz` | nullable. Réception de l'avis qui a fixé le statut |

- `unique (organisation_id, id)`, `unique (organisation_id, prestataire, reference_prestataire)` : une transaction de l'opérateur ne se traite qu'une fois.
- Index : `(organisation_id, commande_id)`, `(organisation_id, traite_le)`.
- Droits `erp_app` : `select, insert, update`.

### `avis_paiement`

Trace de chaque avis reçu d'un prestataire, accepté ou refusé. Insertion seule.

| Champ | Type | Contrainte |
|---|---|---|
| `id` | `uuid` | PK |
| `organisation_id` | `uuid` | `not null`. Organisation de l'adresse de rappel |
| `prestataire` | `text` | `not null`, `check (length(prestataire) between 1 and 30)` |
| `reference_prestataire` | `text` | nullable, `check (length(reference_prestataire) <= 100)`. Nulle si l'avis est illisible |
| `signature_valide` | `boolean` | `not null` |
| `issue` | `text` | `not null`, `check (issue in ('traite', 'deja_traite', 'signature_invalide', 'montant_different', 'inconnu', 'echec'))` |
| `montant` | `bigint` | nullable, `check (montant >= 0)`. Montant annoncé |
| `recu_le` | `timestamptz` | `not null default now()` |

- `unique (organisation_id, id)` ; index `(organisation_id, recu_le desc)`.
- Droits `erp_app` : `select, insert` seulement.

---

## Tables existantes modifiées

### `commandes_web` (lot 1, 0046)

| Changement | Détail |
|---|---|
| `statut` | La contrainte reçoit `'a_rembourser'` : `('reservee', 'payee', 'facturee', 'expediee', 'livree', 'annulee', 'expiree', 'a_rembourser')`. Contrainte `commandes_web_statut_check` supprimée puis recréée |
| Contrainte `colis_id is null or moyen_paiement = 'a_la_livraison'` | **Supprimée** : une commande payée par Mobile Money reçoit aussi son colis. Le nom étant généré, la migration la retrouve par sa définition (`pg_get_constraintdef`) |
| `facture_id uuid` | Colonne nouvelle, nullable, FK `documents_vente` |

### `config_canal` (lot 1, 0046)

| Changement | Détail |
|---|---|
| `responsable_id uuid` | Colonne nouvelle, nullable, FK `utilisateurs`. Personne au nom de qui les ventes automatiques sont créées et encaissées ; renseignée par celui qui ouvre la boutique. Sans elle, le paiement en ligne est indisponible |

### `lignes_vente` : aucun changement de table

`LigneSaisie.brutHt` (champ interne du code, non exposé par les routes) transmet le HT exact de la ligne à `calculerLigne`.

---

## Transitions

### Commande (`commandes_web.statut`)

```text
 reservee ── avis réussi, avant l'échéance ──▶ payee ── vente terminée ──▶ facturee
    │                                            │
    │                                            └─ étape de vente impossible : reste payee (tâche « vente à terminer »,
    │                                               puis POST /commandes-web/:id/terminer)
    ├── échéance (lot 1) ──▶ expiree ── avis réussi tardif ──▶ a_rembourser
    └── annulation (lot 1) ──▶ annulee ── avis réussi tardif ──▶ a_rembourser

 payee ou facturee + second avis réussi : la commande ne change pas, le second paiement est a_rembourser (motif deja_payee)
 paiement à la livraison : inchangé (lot 1)
```

### Paiement (`paiements_en_ligne.statut`)

```text
 lance ── avis réussi, commande payable ──▶ reussi
   │  └── avis réussi, commande expirée, annulée ou déjà payée ──▶ a_rembourser (motif)
   └── avis d'échec ──▶ echoue
 reussi, echoue, a_rembourser : finaux (un nouvel avis est « déjà traité »)
```

---

## Ce qu'une vente terminée écrit (tables existantes)

| Table | Écrit |
|---|---|
| `reservations_stock` | `levee_le` des réservations de la commande |
| `documents_vente`, `lignes_vente` | facture sur la branche, `cree_par` = responsable, lignes avec `brutHt` = `lignes_commande_web.total_ht`, `frais_livraison` = celui de la commande, `taux_frais` = 0 |
| `mouvements_stock` | sortie `vente` au lieu de la commande (par `emettre`) |
| `reglements` | montant = total, moyen, `reference` = référence de l'opérateur, `encaisse_par` = responsable |
| `mouvements_portefeuille` ou `encaissements_en_attente` | par le déclencheur `tresorerie` du règlement |
| `colis` | sauf retrait au magasin, `a_encaisser` = 0, au nom de la branche |
| `evenements` | `commande_web.payee`, `facture.emis`, `facture.reglement`, `commande_web.facturee` |

Un paiement à rembourser écrit `mouvements_portefeuille` (ou `encaissements_en_attente`) par `tresorerie_encaisser(…, 'paiement_en_ligne', id)`, une `taches` par titulaire de `tresorerie.gerer` de la branche et `commande_web.a_rembourser`.
