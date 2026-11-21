# Modèle de données : module canal en ligne (lot 1)

**Feature** : 001-glomari-plateforme-commerce
**Phase** : 1 (conception)
**Révision** : 2026-11-21, alignée sur `docs/Fiche technique globale GLOMARI.md` (sections 5, 6 et 9, lot 1) après `/speckit-analyze`

Source de référence des contraintes de champ. Tout est créé par `migrations/0046_canal_en_ligne.sql`. Chaque table nouvelle a la RLS activée et forcée, la politique `cloison`, les droits `select, insert, update` pour `erp_app` (aucune suppression : on désactive), et des clés étrangères composites incluant `organisation_id`.

Tables existantes **réutilisées sans les recréer** : `zones_livraison` (0019), `points_relais` (0021), `colis` (0019), `tiers` (0001, 0010), `reservations_stock` (0030, modifiée ci-dessous).

---

## Tables nouvelles

### `config_canal`

Interrupteur de la boutique en ligne d'une branche. Une seule boutique active par organisation : c'est elle que servent les routes `/marketplace/:org/...`.

| Champ | Type | Contrainte |
|---|---|---|
| `id` | `uuid` | PK, `default gen_random_uuid()` |
| `organisation_id` | `uuid` | `not null` |
| `entite_id` | `uuid` | `not null`, FK `entites`. Branche ayant le module `achats_stocks` actif (vérifié par le serveur) |
| `actif` | `boolean` | `not null default false` |
| `cree_le` | `timestamptz` | `not null default now()` |

- `unique (organisation_id, id)`, `unique (organisation_id, entite_id)`.
- Index unique partiel `(organisation_id) where actif` : une seule boutique active par organisation.

### `lieux_canal`

Lieux dont le stock est vendu en ligne et qui servent les commandes : « GLOMARI Mall Douala » et « Agence de Yaoundé », créés par le lot 0. « Entrepôt GLOMARI Mall Douala » n'est pas déclaré : son stock rejoint le rayon par transfert.

| Champ | Type | Contrainte |
|---|---|---|
| `id` | `uuid` | PK |
| `organisation_id` | `uuid` | `not null` |
| `config_id` | `uuid` | `not null`, FK `config_canal` |
| `entite_id` | `uuid` | `not null`, FK `entites`. Entité qui détient le stock ; `entite_branche(entite_id)` doit égaler `config_canal.entite_id` (vérifié par le serveur) |
| `nom_public` | `text` | `not null`, `check (length(trim(nom_public)) between 1 and 100)` |
| `actif` | `boolean` | `not null default true` |

- `unique (organisation_id, id)`, `unique (organisation_id, config_id, entite_id)`.
- Le lieu est désigné partout (routes publiques, commandes, événements) par son `entite_id`.

### `commandes_web`

Commande passée sur la Marketplace. Noms des colonnes repris de la fiche (section 9, lot 1).

| Champ | Type | Contrainte |
|---|---|---|
| `id` | `uuid` | PK |
| `organisation_id` | `uuid` | `not null` |
| `entite_id` | `uuid` | `not null`, FK `config_canal(organisation_id, entite_id)`. Branche GLOMARI de la boutique |
| `lieu_id` | `uuid` | `not null`, FK `entites`. Lieu actif de `lieux_canal` pour cette boutique (vérifié par le serveur) |
| `tiers_id` | `uuid` | `not null`, FK `tiers`. Fiche client de la branche, retrouvée par téléphone ou créée (règle du client rapide de la caisse) |
| `reference` | `text` | `not null`, `unique (organisation_id, reference)`, `check (reference ~ '^WEB-[0-9]{4}-[0-9]{6}$')`. Tirée par `prochainNumero(c, "WEB-AAAA")` (`src/formations.ts`) |
| `jeton_suivi_hache` | `text` | `not null`, `unique (organisation_id, jeton_suivi_hache)`, `check (jeton_suivi_hache ~ '^[0-9a-f]{64}$')`. `hacherJeton()` (`src/securite.ts`) du jeton brut |
| `statut` | `text` | `not null default 'reservee'`, `check (statut in ('reservee', 'payee', 'facturee', 'expediee', 'livree', 'annulee', 'expiree'))`. Le lot 1 n'écrit que `reservee`, `annulee`, `expiree` |
| `nom_client` | `text` | `not null`, `check (length(trim(nom_client)) between 2 and 200)`. Destinataire de la commande |
| `telephone` | `text` | `not null`, `check (telephone ~ '^[0-9]{8,15}$')`. Après `normaliserTelephone()` (`src/securite.ts`) |
| `mode_livraison` | `text` | `not null`, `check (mode_livraison in ('domicile', 'agence_voyage', 'point_relais', 'retrait_magasin'))` |
| `zone_id` | `uuid` | nullable, FK `zones_livraison` (table de 0019). Zone de la branche : `zones_livraison.entite_id` égale `commandes_web.entite_id` (règle de `POST /colis`, `src/pilotage.ts` l. 269 : zone et colis sur la même entité ; les lieux n'ont pas le module transport). Check : `(mode_livraison in ('domicile', 'agence_voyage')) = (zone_id is not null)` |
| `point_relais_id` | `uuid` | nullable, FK `points_relais` (table de 0021). Point relais actif de la branche. Check : `(mode_livraison = 'point_relais') = (point_relais_id is not null)` |
| `adresse` | `text` | nullable, `check (length(adresse) <= 500)`. Check : `mode_livraison not in ('domicile', 'agence_voyage') or length(trim(adresse)) > 0` |
| `note` | `text` | nullable, `check (length(note) <= 1000)` |
| `moyen_paiement` | `text` | `not null`, `check (moyen_paiement in ('orange_money', 'mtn_momo', 'a_la_livraison'))` |
| `canal` | `text` | `not null default 'marketplace'`, `check (canal in ('marketplace'))` |
| `code_affilie` | `text` | nullable, `check (length(code_affilie) <= 50)`. Toujours nul au lot 1 (affiliation au lot 5) |
| `frais_livraison` | `bigint` | `not null default 0`, `check (frais_livraison >= 0)`. Copié de `zones_livraison.frais` ; 0 pour `point_relais` et `retrait_magasin` |
| `total_ht` | `bigint` | `not null`, `check (total_ht >= 0)`. Somme des `lignes_commande_web.total_ht` |
| `total_ttc` | `bigint` | `not null`, `check (total_ttc >= total_ht)`. Somme des `lignes_commande_web.total_ttc` plus `frais_livraison` |
| `expire_le` | `timestamptz` | `not null`. Création + `DUREE_RESERVATION_MINUTES` (30) pour `orange_money` et `mtn_momo`, + `DUREE_RESERVATION_LIVRAISON_MINUTES` (1 440, soit 24 h) pour `a_la_livraison` |
| `colis_id` | `uuid` | nullable, FK `colis`. Colis créé sur la branche à la confirmation. Check : `colis_id is null or moyen_paiement = 'a_la_livraison'` |
| `motif` | `text` | nullable, `check (length(motif) <= 500)`. Motif d'annulation |
| `traite_par` | `uuid` | nullable. Utilisateur qui a confirmé ou annulé |
| `traite_le` | `timestamptz` | nullable |
| `cree_le` | `timestamptz` | `not null default now()` |

- `unique (organisation_id, id)`.
- Index : `(organisation_id, entite_id, cree_le desc)` ; index partiel `(expire_le) where statut = 'reservee' and colis_id is null`.

### `lignes_commande_web`

| Champ | Type | Contrainte |
|---|---|---|
| `id` | `uuid` | PK |
| `organisation_id` | `uuid` | `not null` |
| `commande_id` | `uuid` | `not null`, FK `commandes_web` |
| `produit_id` | `uuid` | `not null`, FK `produits`. Article `actif`, `type = 'produit'`, `suivi_stock`, de la branche de la boutique |
| `quantite` | `integer` | `not null`, `check (quantite between 1 and 10000)`. Unité de base seulement au lot 1 |
| `prix_unitaire_ht` | `bigint` | `not null`, `check (prix_unitaire_ht >= 0)`. Après paliers et promotion, par `prixProduit()` (`src/commerce.ts`) |
| `prix_unitaire_ttc` | `bigint` | `not null`, `check (prix_unitaire_ttc >= prix_unitaire_ht)`. `calculerLigne(1, prix_unitaire_ht, 0, taux_taxe)` (`src/facturation.ts`) |
| `taux_taxe` | `numeric(6,3)` | `not null default 0`, `check (taux_taxe between 0 and 100)`. Copié de `produits.taux_taxe` |
| `total_ht` | `bigint` | `not null`, `check (total_ht >= 0)` |
| `total_ttc` | `bigint` | `not null`, `check (total_ttc >= total_ht)` |

- `unique (organisation_id, id)`, `unique (organisation_id, commande_id, produit_id)`.
- `total_ht` et `total_ttc` : `calculerLigne(quantite, prix_unitaire_ht, 0, taux_taxe, brutTranches(...))`, exactement comme la caisse (`src/caisse.ts` l. 310 à 315).

---

## Table existante modifiée

### `reservations_stock` (0030)

| Changement | Détail |
|---|---|
| `commande_web_id uuid` | Colonne nouvelle, nullable, FK composite vers `commandes_web(organisation_id, id)` |
| `auteur_id` | `drop not null` : une commande web n'a pas d'utilisateur connecté |
| Check | `auteur_id is not null or commande_web_id is not null` |
| Index | `(organisation_id, commande_web_id) where commande_web_id is not null` |

Réservation d'une commande web : `entite_id` = `commandes_web.lieu_id`, `expire_le` nul (l'échéance est `commandes_web.expire_le`), `motif` = `'commande_web'`. Levée idempotente : `update reservations_stock set levee_le = now() where commande_web_id = $1 and levee_le is null`.

---

## Fonction et déclencheurs (même migration)

### `quantite_vendable(p_entite uuid, p_produit uuid) returns numeric`

`language sql stable`, droits de l'appelant (la RLS s'applique). Formule unique de la quantité vendable : somme de `mouvements_stock` du lieu, moins les réservations actives (`levee_le is null and (expire_le is null or expire_le >= jour de Douala)`), moins les avariés `constatee`. `quantiteDisponible()` (`src/stocks.ts`) l'appelle ; `sortirDuStock` aussi, par elle.

### `stock.disponibilite_modifiee`

Déclencheurs ligne `after insert` sur `mouvements_stock`, `after insert or update` sur `reservations_stock` et `avaries`. Si `new.entite_id` est un lieu actif d'une boutique active, insère dans `evenements` : `{ "produit_id", "lieu_id", "disponible": quantite_vendable(lieu, produit) }`. Rien pour un autre lieu, donc rien pour GTA.

### `catalogue.article_modifie`

Déclencheurs ligne sur `produits` (`after insert or update`, seulement si une colonne publique change : `code, nom, unite, type, actif, suivi_stock, prix_vente, taux_taxe, paliers_actif, mode_palier, categorie_id, marque_id, entite_id`), et sur `promotions`, `paliers_prix`, `photos_produits` (`after insert or update or delete`). Si la branche de l'article est celle d'une boutique active, insère `{ "produit_id" }`. Une variation de `cout_moyen` seule ne publie rien.

---

## Transitions de `commandes_web.statut` (lot 1)

```text
          création (POST /marketplace/:org/commandes)
                          │
                       reservee ──── expire_le dépassé, sans colis (tâche) ────▶ expiree
                       │      │
   confirmer           │      └──── annuler (facturation.gerer) ───────────────▶ annulee
   (a_la_livraison,    │
   facturation.gerer)  ▼
          reservee + colis_id (colis « à encaisser », n'expire plus)
                       │
                       └──── annuler si le colis est encore « prepare », « echec » ou « retour » ──▶ annulee
```

- `annulee` et `expiree` sont finales ; les réservations sont levées dans la même transaction et l'événement est publié.
- `payee`, `facturee`, `expediee`, `livree` sont posés par le lot 2 (paiement, facture, sortie de stock).
- Limite du lot 1 : une commande livrée garde sa réservation jusqu'au lot 2, qui la transformera en facture et en sortie de stock.

---

## Tables existantes lues

| Table | Usage | Jamais exposé côté public |
|---|---|---|
| `produits` | `id, code, nom, unite, type, actif, suivi_stock, prix_vente, taux_taxe, categorie_id, marque_id, entite_id` | `cout_moyen`, tout champ d'achat ou de fournisseur |
| `categories_articles`, `marques` | nom de la catégorie, de sa catégorie parente, de la marque | |
| `photos_produits` | positions disponibles et image | `auteur_id` |
| `paliers_prix`, `promotions` | par `prixProduit()` et `brutTranches()` | |
| `zones_livraison` | `id, nom, frais, delai_jours` des zones de la branche | |
| `points_relais` | `id, nom, adresse` des relais actifs de la branche | `commission`, `telephone` |
| `colis`, `etapes_colis` | statut du colis et lien de suivi existant (`/suivi/:code`) | `code_confirmation` |
| `tiers` | fiche client par téléphone dans la branche | |
| `mouvements_stock`, `avaries`, `entites`, `modules_entite`, `registre_organisations`, `compteurs` | stock, branche, module, minuterie, numérotation | |
