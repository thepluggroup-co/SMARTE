# Contrats API : routes publiques de la Marketplace (lot 1)

**Module** : `src/canalenligne.ts`
**Référence** : `docs/Fiche technique globale GLOMARI.md`, section 6.1 et section 9 (lot 1). Les prompts W3 à W5 de la Marketplace appellent exactement ces routes.
**Accès** : sans authentification, débit limité par adresse IP, sur le modèle de `/portail/:code` (`src/mall.ts`).
**Format** : JSON. Corps de requête en camelCase, réponses en snake_case.
**Montants** : FCFA entiers ; `_ttc` inclut la taxe de la fiche article.

---

## Paramètre commun `:org`

Identifiant (UUID) de l'organisation. Le serveur ouvre `dansOrganisation(pool, org, …)` et cherche la boutique active (`config_canal.actif`). UUID mal formé, organisation inconnue, aucune boutique active, ou erreur PostgreSQL `22P02` : `404 introuvable`, sans distinction.

Jamais renvoyés par aucune route : `cout_moyen`, coût, marge, fournisseur, commission d'un point relais, article ou client d'une autre branche (dont GTA) ou d'une autre organisation.

---

## GET `/marketplace/:org/catalogue`

**Débit** : 60 par minute. Mis en cache par la Marketplace, invalidé par l'événement `catalogue.article_modifie`. Ne contient donc pas de quantité.

**Réponse 200**

```json
{
  "branche": "GLOMARI",
  "durees_reservation": { "mobile_money": 30, "a_la_livraison": 1440 },
  "catalogue": [
    {
      "id": "uuid",
      "code": "SAM-S25",
      "nom": "Samsung Galaxy S25",
      "unite": "pièce",
      "categorie": { "id": "uuid", "nom": "Smartphones", "parent": "Téléphonie" },
      "marque": "Samsung",
      "photos": [1, 2],
      "prix_ttc": 417375,
      "promotion": { "type": "pourcentage", "valeur": 5, "fin": "2026-11-30" }
    }
  ]
}
```

- Articles `actif`, `type = 'produit'`, `suivi_stock`, de la branche de la boutique (`entite_branche(entite_id)`), 2 000 au plus, triés par nom. Liste de colonnes explicite.
- `prix_ttc` : prix d'une unité, calculé comme à la caisse (`prixProduit()` puis `calculerLigne(1, prix, 0, taux_taxe)`), promotion du jour comprise.
- `photos` : positions présentes dans `photos_produits`.

## GET `/marketplace/:org/produits/:id/photos/:position`

**Débit** : 120 par minute. Image de l'article (`photos_produits`), seulement s'il figure au catalogue ci-dessus, sinon `404 introuvable`. En-têtes : `cache-control: public, max-age=86400`, `etag` tiré de `maj_le`, `x-content-type-options: nosniff` (comme `/produits/:id/photos/:position`, `src/articles.ts` l. 218).

## GET `/marketplace/:org/disponibilite?produits=id1,id2,…`

**Débit** : 60 par minute. Jamais mis en cache plus de 30 secondes par la Marketplace.

`produits` : 1 à 100 UUID séparés par des virgules, sinon `400 donnees_invalides`. Les identifiants hors catalogue sont ignorés.

**Réponse 200**

```json
[
  { "produit_id": "uuid", "lieux": { "uuid-lieu-douala": 12, "uuid-lieu-yaounde": 0 } }
]
```

Quantité vendable par lieu actif (`quantite_vendable()`), plancher 0, en une requête groupée. Clé : `entite_id` du lieu.

## GET `/marketplace/:org/zones`

**Débit** : 60 par minute.

**Réponse 200**

```json
{
  "lieux": [{ "id": "uuid", "nom": "GLOMARI Mall Douala" }],
  "zones": [{ "id": "uuid", "nom": "Akwa", "frais": 1000, "delai_jours": 1 }],
  "points_relais": [{ "id": "uuid", "nom": "Relais Bonamoussadi", "adresse": "Carrefour Kotto" }],
  "modes_livraison": ["domicile", "agence_voyage", "point_relais", "retrait_magasin"],
  "moyens_paiement": ["orange_money", "mtn_momo", "a_la_livraison"]
}
```

- `zones` : table existante `zones_livraison` dont `entite_id` est la branche de la boutique. Un lieu n'a pas le module transport : ni zone ni colis à son nom.
- `points_relais` : relais `actif` de la branche ; jamais `commission` ni `telephone`.

---

## POST `/marketplace/:org/commandes`

**Débit** : 20 par minute.

**Corps**

```json
{
  "lieuId": "uuid",
  "lignes": [{ "produitId": "uuid", "quantite": 2 }],
  "nomClient": "Jean Mbarga",
  "telephone": "699 00 00 01",
  "modeLivraison": "domicile",
  "zoneId": "uuid",
  "pointRelaisId": "uuid",
  "adresse": "Bonanjo, rue des Bananiers",
  "moyenPaiement": "a_la_livraison",
  "note": "Appeler avant de livrer"
}
```

- Obligatoires : `lieuId`, `lignes` (1 à 50, `produitId` distincts), `nomClient`, `telephone`, `modeLivraison`, `moyenPaiement`.
- `zoneId` et `adresse` : obligatoires pour `domicile` et `agence_voyage`, sinon absents. `pointRelaisId` : obligatoire pour `point_relais`, sinon absent.
- `quantite` : entier de 1 à 10 000, unité de base. Tout prix envoyé est ignoré.

**Déroulé serveur (une seule transaction)**

1. Expirer les commandes échues de l'organisation (`expirerCommandesWeb`).
2. Contrôler le lieu, la zone (`entite_id` = branche de la boutique), le point relais (actif, de la branche), le mode et le téléphone (`normaliserTelephone()`, au moins 8 chiffres, sinon `400 telephone_invalide`).
3. Retrouver la fiche client de la branche par téléphone, sinon la créer (`type 'personne'`, rôle `client`, `branche_id`, `entite_origine_id` = lieu), comme `POST /caisse/clients` (`src/caisse.ts` l. 439 à 446) ; publier `tiers.cree` si elle est créée.
4. Trier les lignes par `produitId`, verrouiller chaque article par `produitSuivi()` (`select … for update`), contrôler `quantiteDisponible(lieu, produit)`, sinon `409 stock_insuffisant` avec `{ produitId, disponible }`.
5. Calculer les prix comme la caisse, tirer `reference` (`prochainNumero(c, "WEB-AAAA")`) et le jeton (`randomBytes(32)` en base64url), fixer `expire_le` selon le moyen de paiement.
6. Insérer la commande, ses lignes et une `reservations_stock` par ligne ; publier `commande_web.creee`.

**Réponse 201**

```json
{
  "reference": "WEB-2026-000001",
  "jeton": "43 caractères base64url",
  "suivi": "/marketplace/{org}/commandes/WEB-2026-000001?jeton=…",
  "statut": "reservee",
  "moyen_paiement": "a_la_livraison",
  "expire_le": "2026-11-22T14:00:00.000Z",
  "frais_livraison": 1000,
  "total_ttc": 835750,
  "lignes": [{ "produit_id": "uuid", "nom": "Samsung Galaxy S25", "quantite": 2, "prix_unitaire_ttc": 417375, "total_ttc": 834750 }]
}
```

`suivi` est le chemin de l'API ; la Marketplace construit sa propre page de suivi. Le jeton brut n'est renvoyé qu'ici ; seul `hacherJeton(jeton)` est stocké. Au lot 1, une commande `orange_money` ou `mtn_momo` attend le paiement du lot 2 et expire au bout de 30 minutes.

**Erreurs** : `400 donnees_invalides`, `400 telephone_invalide`, `400 lieu_invalide`, `400 zone_invalide`, `400 point_relais_invalide`, `400 mode_livraison_invalide`, `404 introuvable` (article hors catalogue, dont GTA), `409 stock_insuffisant`, `409 produit_sans_stock`, `429`.

---

## GET `/marketplace/:org/commandes/:reference?jeton=…`

**Débit** : 60 par minute.

`reference` : `/^WEB-[0-9]{4}-[0-9]{6}$/` ; `jeton` : `/^[A-Za-z0-9_-]{43}$/`. La commande doit correspondre aux deux (référence et `hacherJeton(jeton)`), sinon `404 introuvable`.

**Réponse 200**

```json
{
  "reference": "WEB-2026-000001",
  "statut": "reservee",
  "lieu": "GLOMARI Mall Douala",
  "mode_livraison": "domicile",
  "zone": "Akwa",
  "point_relais": null,
  "moyen_paiement": "a_la_livraison",
  "frais_livraison": 1000,
  "total_ttc": 835750,
  "expire_le": "…",
  "cree_le": "…",
  "lignes": [{ "nom": "Samsung Galaxy S25", "quantite": 2, "prix_unitaire_ttc": 417375, "total_ttc": 834750 }],
  "colis": { "statut": "prepare", "lien_suivi": "https://…/suivi.html?c={org}.{code_suivi}" }
}
```

`colis` vaut `null` avant la confirmation. Jamais le nom, le téléphone, l'adresse ni le `code_confirmation` du colis : le lien peut circuler.

---

## Codes d'erreur

Déjà présents dans `MESSAGES` (`public/app.js`) : `introuvable`, `donnees_invalides`, `stock_insuffisant`, `produit_sans_stock`, `telephone_invalide`.

À ajouter :

| Code | Message |
|---|---|
| `lieu_invalide` | Ce lieu n'est pas proposé en ligne. |
| `zone_invalide` | Cette zone de livraison n'est pas proposée. |
| `point_relais_invalide` | Ce point relais n'est pas disponible. |
| `mode_livraison_invalide` | Ce mode de livraison n'est pas proposé. |
| `commande_non_modifiable` | Cette commande est déjà traitée. |
| `confirmation_impossible` | Seule une commande payée à la livraison se confirme ici ; les autres attendent le paiement en ligne. |
| `boutique_deja_active` | Une autre branche a déjà sa boutique en ligne ouverte. |
