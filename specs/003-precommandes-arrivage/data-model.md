# Data Model : Précommandes d'arrivage (lot 3A)

Migration `0049_precommandes.sql`. Toute table nouvelle : RLS forcée, politique `cloison`, clés étrangères composites `(organisation_id, …)`, déclencheur `audit_ligne`, droits accordés à `erp_app`. Montants en FCFA entiers (`bigint`).

## Tables nouvelles

### campagnes_arrivage

Une annonce d'arrivage pour un article, sur la branche de la boutique en ligne.

| Colonne | Type | Règle |
|---|---|---|
| id | uuid | clé |
| organisation_id | uuid | non nul |
| entite_id | uuid | branche ; FK `config_canal(organisation_id, entite_id)` (boutique réglée) |
| lieu_id | uuid | lieu de réception ; FK `entites` ; lieu servi en ligne, avec le module de stock (vérifié par la route) |
| produit_id | uuid | FK `produits` ; article actif, suivi en stock, de la branche |
| fournisseur_id | uuid | FK `tiers` ; reçoit le rôle fournisseur |
| numero | text | `^ARR-[0-9]{4}-[0-9]{6}$`, unique par organisation |
| origine | text | `local` ou `import`, défaut `import` (étapes possibles du bon de commande) |
| titre | text | 1 à 200 caractères |
| texte | text | au plus 2000 caractères, facultatif |
| prix_ht | bigint | > 0 ; figé dès le premier acompte payé |
| taux_taxe | numeric(6,3) | 0 à 100 ; figé |
| prix_ttc | bigint | = `calculerLigne(1, prix_ht, 0, taux_taxe)` ; > 0 |
| acompte_type | text | `montant` ou `pourcentage` |
| acompte_valeur | bigint | FCFA par pièce, ou pour cent de 1 à 99 |
| acompte_unitaire | bigint | acompte par pièce calculé, > 0 et < `prix_ttc` |
| seuil | integer | > 0 |
| quantite_max | integer | facultatif ; ≥ `seuil` |
| date_limite | date | heure de Douala ; à la création, après aujourd'hui ; reportable seulement |
| delai_solde_jours | integer | 1 à 60, défaut 7 |
| prix_achat_prevu | bigint | facultatif, ≥ 0 ; prix de la ligne du bon de commande en brouillon |
| statut | text | `ouverte`, `declenchee`, `annulee`, `livree` ; défaut `ouverte` |
| motif_annulation | text | 3 à 500 caractères ; présent si et seulement si `annulee` |
| annulee_le | timestamptz | |
| annulee_par | uuid | FK `utilisateurs` ; nul pour l'annulation d'office |
| declenchee_le | timestamptz | |
| commande_achat_id | uuid | FK `commandes_achat` ; unique |
| premiere_reception_le | timestamptz | ferme les inscriptions |
| cree_par | uuid | FK `utilisateurs` ; auteur du bon de commande en brouillon |
| cree_le | timestamptz | |

Contraintes : `unique (organisation_id, id)`, `unique (organisation_id, numero)`, `unique (organisation_id, commande_achat_id)`, `check ((statut = 'annulee') = (motif_annulation is not null))`, `check (quantite_max is null or quantite_max >= seuil)`, `check (acompte_unitaire < prix_ttc)`, et `check (acompte_type = 'montant' or acompte_valeur between 1 and 99)`. Index `(organisation_id, entite_id, statut)`.

### inscriptions_precommande

Un client, une quantité, une campagne.

| Colonne | Type | Règle |
|---|---|---|
| id | uuid | clé |
| organisation_id | uuid | non nul |
| campagne_id | uuid | FK `campagnes_arrivage` |
| tiers_id | uuid | FK `tiers` ; fiche du client dans la branche, retrouvée par téléphone |
| reference | text | `^PRE-[0-9]{4}-[0-9]{6}$`, unique par organisation |
| jeton_suivi_hache | text | `^[0-9a-f]{64}$`, unique par organisation |
| nom_client | text | 2 à 200 caractères |
| telephone | text | `^[0-9]{8,15}$` |
| quantite | integer | 1 à 10000 |
| moyen_paiement | text | `orange_money` ou `mtn_momo` |
| total_ttc | bigint | `calculerLigne(quantite, prix_ht, 0, taux_taxe)`, figé à l'inscription |
| acompte | bigint | `quantite × acompte_unitaire` ; > 0 et < `total_ttc` |
| conditions_texte | text | texte exact accepté, 1 à 2000 caractères |
| conditions_acceptees_le | timestamptz | non nul |
| statut | text | voir le cycle de vie ; défaut `en_attente` |
| expire_le | timestamptz | fin du délai de paiement de l'acompte (30 minutes) |
| validee_le | timestamptz | confirmation de l'acompte ; fixe le rang |
| servie_le | timestamptz | stock réservé |
| solde_avant | timestamptz | `servie_le + delai_solde_jours` |
| motif | text | `campagne_annulee`, `seuil_non_atteint`, `retrait_client`, `non_servie`, `complet` ; pour `a_rembourser`, `remboursee`, `annulee` |
| traite_le | timestamptz | dernier changement d'état |
| traite_par | uuid | FK `utilisateurs` ; nul pour une action automatique |
| cree_le | timestamptz | |

Contraintes : `unique (organisation_id, id)`, `unique (organisation_id, reference)`, `unique (organisation_id, jeton_suivi_hache)`, `check (acompte < total_ttc)`, `check ((statut in ('validee','servie','soldee','acompte_conserve')) <= (validee_le is not null))`, `check ((statut in ('servie','soldee','acompte_conserve')) = (servie_le is not null and solde_avant is not null))`. Index `(organisation_id, campagne_id, statut, validee_le)` et `(expire_le) where statut = 'en_attente'`.

## Tables modifiées

### paiements_en_ligne (0048)

- `commande_id` devient facultative ; ajout de `inscription_id uuid`, FK `inscriptions_precommande` ; `check (num_nonnulls(commande_id, inscription_id) = 1)`.
- `statut` : ajout de `rembourse`.
- `motif` : `expiree`, `annulee`, `deja_payee` (lot 2), plus `campagne_annulee`, `seuil_non_atteint`, `retrait_client`, `non_servie`, `complet`.
- La contrainte `(statut = 'a_rembourser') = (motif is not null)` devient `(statut in ('a_rembourser','rembourse')) = (motif is not null)`.
- Ajouts : `rembourse_le timestamptz`, `rembourse_par uuid` (FK `utilisateurs`), `reference_remboursement text` (au plus 100 caractères) ; `check ((statut = 'rembourse') = (rembourse_le is not null))`.
- Index `(organisation_id, inscription_id)`.

Les contraintes sans nom sont retrouvées par `pg_get_constraintdef`, comme en 0048.

### commandes_web (0046)

- `inscription_id uuid`, FK `inscriptions_precommande` : commande du solde.
- `acompte bigint not null default 0`, `check (acompte >= 0 and acompte < total_ttc)`, `check ((inscription_id is null) = (acompte = 0))`.
- Index `(organisation_id, inscription_id) where inscription_id is not null`.

Le montant payé en ligne vaut `total_ttc − acompte`.

### reservations_stock (0030, 0046)

- `inscription_id uuid`, FK `inscriptions_precommande`.
- La contrainte `reservations_stock_auteur` devient `auteur_id is not null or commande_web_id is not null or inscription_id is not null`.
- Index `(organisation_id, inscription_id) where inscription_id is not null`.

### reglements (0007)

- `acompte_id uuid`, FK `paiements_en_ligne(organisation_id, id)`.
- Index unique `(organisation_id, acompte_id) where acompte_id is not null and annule_le is null` : un acompte s'impute une fois.
- `tresorerie_reglement()` remplacée : pas d'encaissement si `acompte_id` est renseigné. La branche d'annulation est inchangée.

### mouvements_portefeuille (0016)

- Index unique `(organisation_id, source_id) where type = 'sortie' and source_type = 'remboursement_en_ligne'` : un paiement se rembourse une fois.

## Cycles de vie

### Campagne

```text
ouverte ──(seuil atteint par un acompte confirmé)──► declenchee ──(toutes les inscriptions validées closes)──► livree
   │                                                     │
   ├──(date limite passée sous le seuil : d'office)──► annulee
   └──(annulation par le responsable)──────────────► annulee ◄──(annulation avant la première réception)──┘
```

« Close » veut dire soldée, remboursée ou à acompte conservé.

### Inscription

```text
en_attente ──(acompte confirmé, place disponible)──► validee ──(réception, servie)──► servie ──(solde payé)──► soldee
   │  └──(délai de paiement passé)──► expiree ──(acompte tardif, place disponible)──► validee
   │                                                                     │              └──(délai du solde passé)──► acompte_conserve
   └──(annulation de la campagne ou par le responsable)──► annulee       │
validee ──(campagne annulée, retrait du client, bon de commande clos sans la servir)──► a_rembourser ──(remboursement enregistré)──► remboursee
```

Un acompte tardif sans place, ou payé pour une campagne close, donne un paiement « à rembourser » ; l'inscription expirée passe alors aussi « à rembourser ».

### Paiement en ligne

`lance → reussi | echoue | a_rembourser` (lot 2) ; `reussi → a_rembourser` (annulation de la campagne, retrait du client, non servie) ; `a_rembourser → rembourse` (trésorier). Un acompte payé deux fois : seul le second paiement est « à rembourser » (`deja_payee`) ; l'inscription ne change pas.

## Calculs

- Acompte par pièce : `montant` → `acompte_valeur` ; `pourcentage` → `round(prix_ttc × acompte_valeur / 100)`, au moins 1.
- Quantité validée : somme des quantités des inscriptions `validee`, `servie`, `soldee`, `acompte_conserve`.
- Quantité retenue : la quantité validée plus les inscriptions `en_attente` non échues.
- Capacité : le plus petit de `quantite_max` et de la quantité commandée de l'article sur le bon de commande approuvé (si les deux existent) ; sans limite sinon.
- Progression publique : `min(100, floor(quantité validée × 100 / seuil))`.
- Solde : `total_ttc` de l'inscription + frais de livraison − `acompte`.

## Égalité de contrôle (SC-003)

Pour une campagne, la somme des acomptes encaissés égale la somme de cinq parts :

- les règlements d'imputation ;
- les remboursements ;
- les acomptes conservés ;
- les acomptes « à rembourser » ;
- les acomptes encore détenus (validée ou servie).
