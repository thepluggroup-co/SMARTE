# Routes internes : précommandes

Session obligatoire (`protege`). Chaque droit se vérifie côté serveur, sur la branche de la campagne. Toute erreur a son message dans `MESSAGES` (`public/app.js`).

## Campagnes (`src/precommandes.ts`)

### GET /precommandes/campagnes?statut=

- **Droit** : `achats.voir` ou `facturation.voir` ; liste limitée aux branches accessibles. Passe d'abord le balayage.
- **Réponse** : un tableau de campagnes, chacune avec :
  - `id`, `numero`, `titre`, `statut`, `produit`, `lieu`, `fournisseur`, `prix_ttc`, `acompte_unitaire`, `seuil`, `quantite_max`, `date_limite` ;
  - `quantite_validee`, `inscrits`, `acomptes_encaisses`, `a_rembourser`, `rembourses`, `conserves` ;
  - `commande_achat` (`id`, `numero`, `statut`).

### POST /precommandes/campagnes

- **Droit** : `achats.gerer` sur la branche et sur le lieu de réception.
- **Corps** :

```json
{
  "entiteId": "uuid branche", "lieuId": "uuid", "produitId": "uuid", "fournisseurId": "uuid", "origine": "import",
  "titre": "Robot pâtissier Pro", "texte": "…", "prixTtc": 85000, "acompteType": "pourcentage", "acompteValeur": 30,
  "seuil": 50, "quantiteMax": 80, "dateLimite": "2027-01-15", "delaiSoldeJours": 7, "prixAchatPrevu": 42000
}
```

- **Contrôles et refus** :

| Refus | Cas |
|---|---|
| `400 branche_attendue` | `entiteId` n'est pas une branche |
| `409 module_inactif` | la branche n'a pas le module de stock |
| `409 boutique_absente` | la branche n'a pas de boutique réglée |
| `400 lieu_invalide` | le lieu n'est pas un lieu servi en ligne de la branche |
| `404 introuvable` | l'article n'est pas actif, suivi en stock et de la branche |
| `400 prix_annonce_impossible` | aucun prix hors taxes ne donne ce prix toutes taxes comprises ; réponse `{ "proches": [84999, 85001] }` |
| `400 acompte_invalide` | acompte nul ou supérieur ou égal au prix |
| `400 date_limite_invalide` | date limite pas après aujourd'hui (heure de Douala) |
| `400 donnees_invalides` | quantité maximale inférieure au seuil |

Le fournisseur est lié à la branche et reçoit le rôle fournisseur, comme dans les achats.

- **Réponse 201** : la campagne, avec `numero` (`ARR-AAAA-NNNNNN`).

### GET /precommandes/campagnes/:id

- **Droit** : `achats.voir` ou `facturation.voir` sur la branche.
- **Réponse** :
  - la campagne et ses totaux ;
  - `inscriptions` : référence, client, téléphone, quantité, acompte, statut, rang, `validee_le`, `servie_le`, `solde_avant`, motif, commande du solde, facture ;
  - `commande_achat` : statut, quantité commandée de l'article, étapes ;
  - `conditions`.

### PATCH /precommandes/campagnes/:id

- **Droit** : `achats.gerer` sur la branche.
- **Corps** : champs facultatifs de la création (`additionalProperties: false`).
- **Règles** :
  - avant le premier acompte confirmé, tout peut changer (mêmes contrôles qu'à la création) ;
  - ensuite, seuls `titre` et `texte` changent librement ; `dateLimite` ne peut être que reportée ; `quantiteMax` ne peut être que relevée, et jamais sous la quantité retenue ;
  - un autre champ répond `409 campagne_figee` ;
  - une campagne annulée ou livrée répond `409 campagne_figee`.

### POST /precommandes/campagnes/:id/annulation

- **Droit** : `achats.gerer` sur la branche.
- **Corps** : `{ "motif": "…" }` (3 à 500 caractères).
- **Refus** : `409 campagne_non_annulable` si l'arrivage est déjà reçu, ou si la campagne est annulée ou livrée.
- **Effet** :
  - la campagne passe « annulée » ;
  - les inscriptions validées passent « à rembourser » (motif `campagne_annulee`), avec leur paiement ;
  - les inscriptions en attente passent « annulée » ;
  - une tâche par titulaire de `tresorerie.gerer` sur la branche, avec la liste dans la description ;
  - les événements `precommande.campagne_annulee` et `precommande.a_rembourser` sont publiés ;
  - le journal note `precommande.campagne_annulee`.
- Le bon de commande n'est pas touché.

### POST /precommandes/campagnes/:id/bon-de-commande

- **Droit** : `achats.gerer` sur la branche et sur le lieu de réception.
- **Refus** : `409 bon_de_commande_existant` si la campagne n'est pas « déclenchée » ou si son bon de commande n'est ni absent ni annulé.
- **Effet** : crée le brouillon (quantité validée, prix d'achat prévu, prix de vente prévu `prix_ht`, origine) au nom de la personne connectée, et le relie à la campagne.

### POST /precommandes/inscriptions/:id/annulation

- **Droit** : `achats.gerer` sur la branche.
- **Corps** : `{ "motif": "…" }`.
- **Effet** :
  - une inscription en attente passe « annulée » ;
  - une inscription validée passe « à rembourser » (motif `retrait_client`), avec la tâche au trésorier.
- **Refus** : `409 inscription_non_annulable` si la campagne n'est plus « ouverte », ou si l'inscription n'est ni en attente ni validée.

## Paiements en ligne (`src/paiementenligne.ts`)

### POST /paiements-en-ligne/:id/remboursement

- **Droit** : `tresorerie.gerer` sur la branche de la commande ou de la campagne.
- **Corps** : `{ "referenceOperateur": "…", "note": "…" }` (facultatifs ; au plus 100 et 500 caractères).
- **Refus** :

| Refus | Cas |
|---|---|
| `409 remboursement_impossible` | le paiement n'est pas « à rembourser » |
| `409 encaissement_a_placer` | l'encaissement est encore dans les encaissements en attente |
| `409 solde_portefeuille_insuffisant` | le portefeuille n'a pas assez d'argent |

- **Effet** :
  - une sortie dans le portefeuille qui a reçu l'encaissement (`source_type = 'remboursement_en_ligne'`, `source_id = paiement`, auteur) ;
  - le paiement passe « remboursé » (date, auteur, référence) ;
  - l'inscription passe « remboursée », et la campagne passe « livrée » si tout est clos ;
  - le journal note `canal.paiement_rembourse`.
- **Réponse** : `{ "statut": "rembourse", "portefeuille": "…", "solde": n }`.

### GET /paiements-en-ligne (existante)

- Ajoute les acomptes : colonnes `inscription` et `campagne`, `commande` vide pour un acompte.
- Ajoute le filtre `statut=rembourse`.
- Le total compte les paiements `reussi`, `a_rembourser` et `rembourse`.

## Facturation (`src/facturation.ts`, existante)

- `POST /reglements/:id/annulation` répond `409 reglement_acompte_non_annulable` pour un règlement d'imputation d'acompte.

## Achats (`src/achats.ts`, existantes) : effets ajoutés par les points d'appel

| Route | Ajout |
|---|---|
| `POST /achats/commandes/:id/approbation` | refuse avec `409 quantite_inferieure_aux_precommandes` (`{ "validee": n, "commandee": m }`) si la quantité commandée de l'article de la campagne est inférieure à la quantité validée ; sinon publie `precommande.arrivage_etape` avec l'étape `commandee` |
| `POST /achats/commandes/:id/etapes` | publie `precommande.arrivage_etape` pour la campagne reliée |
| `POST /achats/commandes/:id/receptions` | réserve la quantité reçue aux inscrits (R7), note `premiere_reception_le`, publie `precommande.arrivage_recu` pour chaque inscrit servi ; si la commande passe « reçue », les inscriptions validées non servies passent « à rembourser » (`non_servie`) avec la tâche au trésorier |
