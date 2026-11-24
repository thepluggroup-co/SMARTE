# Contrats : comptes clients en ligne (lot 4, partie B)

Tout code d'erreur a son message dans `MESSAGES` (`public/app.js`). Les routes `/marketplace/:org/compte/…` passent par `parBoutique` : boutique fermée ou organisation inconnue donnent `404 introuvable`.

## Connexion (`src/comptesclients.ts`)

### POST /marketplace/:org/compte/code

- Corps : `{ telephone }`.
- Débit : `debitCanal.codes` par minute pour la boutique (30 par défaut).
- Refus : `400 numero_invalide` (pas un mobile camerounais) ; `409 code_trop_tot` avec `{ attendre_secondes }` (moins d'une minute, plus de trois en un quart d'heure, plus de dix en 24 heures) ; `503 sms_indisponible` (aucun prestataire, ou prestataire en échec ; la demande compte dans les limites).
- Effet : invalide les codes précédents du numéro, enregistre le nouveau (`codes_connexion`), l'envoie par SMS aussitôt.
- Réponse `200` : `{ envoye: true, valable_minutes: 10 }`, la même que le numéro soit connu ou non.

### POST /marketplace/:org/compte/connexion

- Corps : `{ telephone, code (six chiffres), nom? (2 à 200 caractères) }`.
- Débit : `debitCanal.connexions` par minute pour la boutique (60 par défaut).
- Refus :
  - `401 code_incorrect` avec `{ essais_restants }` ; au cinquième essai faux, le code est invalidé (journal `compte_client.blocage`) ;
  - `401 code_expire` : aucun code valable pour ce numéro (jamais demandé, échu, utilisé ou invalidé) ;
  - `409 nom_requis` : numéro inconnu dans la branche et nom absent ; le code reste valable.
- Effet : code utilisé ; fiche trouvée ou créée (rôle client) ; session de 7 jours ; journal `compte_client.connexion`.
- Réponse `200` : `{ jeton, expire_le, client: { nom, telephone, email } }`. Le jeton n'est rendu qu'ici.

### POST /marketplace/:org/compte/deconnexion

- En-tête `Authorization: Client <jeton>`. Corps facultatif : `{ tous: boolean }`.
- Effet : révoque la session, ou toutes celles de la fiche (journal `compte_client.deconnexion_tous`).
- Réponse `200` : `{ deconnecte: true, sessions: n }`.

## Espace client

Toutes les routes ci-dessous exigent `Authorization: Client <jeton>` ; une session absente, échue, révoquée ou refusée rend `401 session_invalide`.

### GET /marketplace/:org/compte

- Réponse : `{ client: { nom, telephone, email }, session: { expire_le } }`.

### PATCH /marketplace/:org/compte

- Corps : `{ nom?, email? (ou null) }`, au moins un champ. Le téléphone n'est pas modifiable.
- Réponse : le client mis à jour.

### GET /marketplace/:org/compte/commandes

- Réponse : les 100 dernières commandes de la fiche, la plus récente d'abord, chacune comme le suivi par lien : `reference, statut, lieu, mode_livraison, zone, point_relais, moyen_paiement, frais_livraison, total_ttc, acompte, montant_a_payer, expire_le, cree_le, lignes, colis`.

### GET /marketplace/:org/compte/precommandes

- Réponse : les précommandes de la fiche, chacune comme le suivi par lien (`reference, statut, campagne, produit, quantite, total_ttc, acompte, etapes, solde?, commande_solde?, conditions`), sans `jeton`.

### POST /marketplace/:org/compte/precommandes/:reference/solde

- Corps : comme la route par lien, sans `jeton` : `{ modeLivraison, zoneId?, pointRelaisId?, adresse?, moyenPaiement }`.
- Refus : `404 introuvable` (précommande d'une autre fiche) ; `409 solde_impossible` comme la route par lien.
- Réponse `201` : `{ commande: { reference, jeton, suivi, total_ttc, acompte, montant_a_payer, frais_livraison, expire_le } }`. Le paiement passe par `POST /marketplace/:org/commandes/:reference/payer` avec ce jeton.

### GET /marketplace/:org/compte/adresses

- Réponse : `[{ id, nom, zone_id, zone, adresse, repere, par_defaut }]`, l'adresse par défaut d'abord.

### POST /marketplace/:org/compte/adresses

- Corps : `{ nom, zoneId?, adresse, repere?, parDefaut? }`.
- Refus : `409 adresses_max` (déjà cinq) ; `400 zone_invalide` (zone d'une autre branche).
- Réponse `201` : l'adresse. Avec `parDefaut`, les autres perdent le « par défaut ».

### PUT /marketplace/:org/compte/adresses/:id et DELETE /marketplace/:org/compte/adresses/:id

- Modifie (mêmes champs) ou supprime une adresse de la fiche ; `404 introuvable` pour une adresse d'une autre fiche.

### GET /marketplace/:org/compte/fidelite

- Réponse : `{ actif, solde, valeur_fcfa, mouvements: [{ date, points, motif }] }` (50 derniers mouvements).

## Routes du personnel

### POST /tiers/:id/comptes-en-ligne/deconnexion

- Droit : `care.gerer` sur la branche de la fiche.
- Effet : révoque toutes les sessions de la fiche, avec `revoque_par` ; journal `compte_client.deconnexion_tous`.
- Réponse : `{ sessions: n }`.

### GET /tiers/:id (existante)

- Ajoute `compte_en_ligne: { appareils, derniere_connexion }` (sessions ouvertes et non échues ; date de la dernière connexion, ou null).

### GET /messages/code-essai?telephone=

- N'existe qu'avec le prestataire factice (sinon `404`). Droit : `entites.gerer`, vérifié aussi sur la branche du code ; un code d'une autre organisation reste introuvable.
- Réponse : `{ code, envoye_le }`, le dernier code envoyé à ce numéro, lu dans la mémoire du prestataire factice ; `404` s'il n'y en a pas.

## Codes d'erreur nouveaux

| Code | Statut | Sens |
| --- | --- | --- |
| `code_trop_tot` | 409 | un code vient d'être envoyé, ou trop de codes pour ce numéro ; `attendre_secondes` |
| `sms_indisponible` | 503 | le SMS ne peut pas partir pour le moment |
| `code_incorrect` | 401 | code faux ; `essais_restants` |
| `code_expire` | 401 | aucun code valable : en demander un nouveau |
| `nom_requis` | 409 | première connexion : le nom est demandé |
| `session_invalide` | 401 | se reconnecter avec un nouveau code |
| `adresses_max` | 409 | cinq adresses au plus |
| `zone_invalide` | 400 | existant ; réutilisé pour une zone d'une autre branche |
| `numero_invalide` | 400 | existant (lot 4A) |
