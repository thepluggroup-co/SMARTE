# Routes publiques (Marketplace) : précommandes

Appelées par le serveur de la Marketplace, sans session. Même cadre que le lot 1 :

- `:org` est l'identifiant de l'organisation ;
- un échec d'organisation, de boutique fermée, de référence ou de jeton répond `404 introuvable` sans rien révéler ;
- le débit est limité par route ;
- le jeton de suivi n'est conservé que haché.

Au début de chaque route, le balayage `expirerPrecommandes` s'applique.

## GET /marketplace/:org/campagnes

Campagnes de la boutique ouverte qui acceptent encore des inscriptions : statut `ouverte` ou `declenchee`, date limite non passée, aucune réception encore. Débit : 60 par minute.

Réponse 200 :

```json
{
  "branche": "GLOMARI",
  "campagnes": [
    {
      "id": "uuid", "titre": "Robot pâtissier Pro", "texte": "…",
      "produit": { "id": "uuid", "nom": "Robot pâtissier", "photos": [1, 2] },
      "prix_ttc": 85000, "acompte_unitaire": 25500, "date_limite": "2027-01-15",
      "progression": 64, "seuil_atteint": false, "complet": false
    }
  ]
}
```

Jamais de quantité, de seuil chiffré, de fournisseur, de prix d'achat ni de lieu de réception. Les photos se lisent par la route existante `/marketplace/:org/produits/:id/photos/:position`.

## GET /marketplace/:org/campagnes/:id

Détail d'une campagne visible, avec les conditions à accepter. Débit : 60 par minute.

Réponse 200 : les champs de la liste, plus `delai_solde_jours`, `moyens_paiement: ["orange_money", "mtn_momo"]` et `conditions` (texte exact que le client accepte, construit par le serveur avec le délai du solde de la campagne).

## POST /marketplace/:org/campagnes/:id/inscriptions

Débit : celui des commandes (`ERP_CANAL_COMMANDES_PAR_MINUTE`).

Corps :

```json
{ "nomClient": "Awa Ngono", "telephone": "699 00 00 02", "quantite": 2, "moyenPaiement": "orange_money", "conditionsAcceptees": true }
```

Contrôles :

- nom de 2 à 200 caractères ;
- téléphone normalisé de 8 à 15 chiffres ;
- quantité de 1 à 10000 ;
- moyen `orange_money` ou `mtn_momo` ;
- `conditionsAcceptees` doit valoir `true`, sinon `400 conditions_non_acceptees` ;
- la campagne doit accepter des inscriptions, sinon `409 campagne_close` ;
- la quantité retenue doit tenir dans la capacité, sinon `409 campagne_complete` avec `{ "disponible": n }`.

La fiche client est retrouvée par téléphone dans la branche, ou créée (même règle et même verrou qu'au lot 1).

Réponse 201 :

```json
{
  "reference": "PRE-2026-000001", "jeton": "…43 caractères…",
  "suivi": "/marketplace/<org>/precommandes/PRE-2026-000001?jeton=…",
  "statut": "en_attente", "quantite": 2, "total_ttc": 170000, "acompte": 51000,
  "moyen_paiement": "orange_money", "expire_le": "2026-11-22T15:30:00Z", "conditions": "…"
}
```

## POST /marketplace/:org/precommandes/:reference/payer

Dans `src/paiementenligne.ts`. Débit : `ERP_CANAL_PAIEMENTS_PAR_MINUTE`.

Corps : `{ "jeton": "…" }`.

Conditions :

- l'inscription doit être `en_attente` et non échue, et la campagne accepter des inscriptions, sinon `409 paiement_impossible` ;
- un prestataire doit couvrir le moyen et la boutique avoir un responsable, sinon `503 paiement_indisponible`.

Le montant envoyé à l'opérateur est `acompte`.

Réponse 201 : `{ "statut": "lance", "moyen": "orange_money", "montant": 51000, "instruction": { … } }`, même forme qu'au lot 2.

L'avis de l'opérateur arrive sur la route existante `POST /paiements/avis/:prestataire/:org`. Ses réponses sont inchangées : `traite`, `deja_traite`, `echec`, et un statut parmi `validee` ou `a_rembourser`.

## GET /marketplace/:org/precommandes/:reference?jeton=

Suivi de l'inscription. Débit : 60 par minute. Sans nom, sans téléphone.

Réponse 200 :

```json
{
  "reference": "PRE-2026-000001", "statut": "servie",
  "campagne": { "titre": "Robot pâtissier Pro", "statut": "declenchee", "date_limite": "2027-01-15", "progression": 100 },
  "produit": "Robot pâtissier", "quantite": 2, "total_ttc": 170000, "acompte": 51000,
  "etapes": [ { "etape": "commandee", "date": "2027-01-16" }, { "etape": "expediee", "date": "2027-02-02" } ],
  "solde": { "montant": 119000, "avant": "2027-03-12T10:00:00Z" },
  "commande_solde": { "reference": "WEB-2027-000045", "statut": "reservee", "montant_a_payer": 120000 },
  "conditions": "…"
}
```

- `solde` n'apparaît que pour une inscription servie ; `commande_solde`, seulement si une commande du solde existe.
- Les étapes viennent de l'approbation (« commandée ») puis des étapes du bon de commande, sans note, sans fournisseur ni transitaire.
- Pour un remboursement : `"statut": "a_rembourser"` ou `"remboursee"`, avec le motif en clair.

## POST /marketplace/:org/precommandes/:reference/solde

Débit : celui des commandes.

Corps : `{ "jeton": "…", "modeLivraison": "domicile", "zoneId": "uuid", "adresse": "…", "moyenPaiement": "orange_money" }`.

Règles du mode de remise et frais : celles du lot 1 (zone pour domicile et agence de voyage, point relais, retrait). Le moyen doit être `orange_money` ou `mtn_momo`.

Conditions :

- l'inscription doit être `servie` et `solde_avant` non passé, sinon `409 solde_impossible`.

Une commande du solde encore `reservee` et non payée est annulée (motif « remplacée ») avant de créer la nouvelle. La réservation du stock reste sur l'inscription.

Réponse 201 :

```json
{
  "commande": {
    "reference": "WEB-2027-000045", "jeton": "…", "suivi": "/marketplace/<org>/commandes/WEB-2027-000045?jeton=…",
    "total_ttc": 171000, "acompte": 51000, "montant_a_payer": 120000, "frais_livraison": 1000, "expire_le": "2027-03-12T10:00:00Z"
  }
}
```

Le client paie ensuite par la route existante `POST /marketplace/:org/commandes/:reference/payer` (montant `total_ttc − acompte`). L'avis signé termine la vente (lot 2) : facture du total, règlement d'acompte, règlement du solde, sortie du stock, colis sauf retrait, inscription « soldée ».

## Événements publiés (webhooks existants)

| Type | Contenu |
|---|---|
| `precommande.inscription_validee` | campagne, inscription, référence, quantité |
| `precommande.seuil_atteint` | campagne, numéro |
| `precommande.arrivage_etape` | campagne, étape, date |
| `precommande.arrivage_recu` | campagne, inscription, référence, `solde_avant` |
| `precommande.acompte_conserve` | campagne, inscription, référence |
| `precommande.campagne_annulee` | campagne, motif |
| `precommande.a_rembourser` | campagne, inscription, référence, motif |
| `precommande.soldee` | campagne, inscription, référence, facture |
