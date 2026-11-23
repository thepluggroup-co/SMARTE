# Contrats : messages automatiques et avis publiés (lot 4, partie A)

Tout code d'erreur a son message dans `MESSAGES` (`public/app.js`). Les droits se vérifient côté serveur, sur la branche de l'objet.

## Routes internes (`src/messages.ts`)

### GET /messages/reglages?brancheId

- Droit : `care.voir` ou `facturation.administrer` sur la branche, qui doit avoir le module de stock (`409 module_inactif` sinon).
- Réponse : `{ prestataire: string | null, heures: { debut: 7, fin: 21 }, types: [{ type, libelle, actif, canal, defaut: boolean }] }`. `prestataire` est null si aucun prestataire n'est configuré : les messages attendent.

### PUT /messages/reglages

- Corps : `{ brancheId, type, actif, canal }` ; `type` parmi les types de `data-model.md`, `canal` `sms` ou `whatsapp`.
- Droit : `facturation.administrer` sur la branche (module de stock exigé).
- Effet : écrit `reglages_messages` ; journal `messages.reglage`.
- Réponse : le réglage.

### GET /messages?brancheId&statut&type&du&au

- Droit : `care.voir` ou `facturation.administrer` sur la branche.
- Réponse :
  - `messages` : les 500 derniers, avec `id, type, libelle, canal, numero_masque, objet_type, objet_id, objet (numéro du colis ou référence de la précommande), statut, du_le, tentatives, essai_le, envoye_le, erreur, renvoi_de, cree_le` ;
  - `mois` : pour le mois en cours, `[{ type, canal, envoyes, echecs, sans_numero }]`.
- Jamais de numéro complet, de code de livraison ni de texte de message.

### POST /messages/:id/renvoi

- Corps facultatif : `{ telephone }`, numéro corrigé.
- Droit : `care.gerer` sur la branche du message.
- Refus : `409 renvoi_impossible` si le message n'est ni `echec` ni `sans_numero`, ou s'il a déjà un renvoi en attente ou envoyé ; `400 numero_invalide` si le numéro corrigé n'est pas un mobile camerounais.
- Effet :
  - un numéro corrigé remplace `colis.telephone` (messages de colis), `inscriptions_precommande.telephone` (précommandes) ou `tiers.telephone` (demandes d'avis) ;
  - nouvelle ligne `en_attente`, `renvoi_de`, due tout de suite, envoyée au numéro actuel de l'objet ;
  - journal `messages.renvoi` avec le message et l'objet corrigé, jamais le numéro.
- Réponse `201` : `{ id, statut: "en_attente" }`.

### PATCH /tiers/:id (existante)

- Ajoute `nePasContacter: boolean` au corps accepté (`tiers.modifier`) ; la réponse rend `ne_pas_contacter`.

### Envoi (pas de route)

- `app.pousserMessages(maintenant?: Date)` : décorée sur l'application, appelée chaque minute quand `webhooksAuto` est vrai, et par les tests avec une date choisie. Renvoie le nombre de messages envoyés.

## Routes publiques

### GET /evaluer/:code (existante)

- Ajoute, pour une demande de `cible_type = 'commande'` : `articles: [{ produit_id, nom }]`, articles distincts, actifs ou non, lus dans les lignes de la commande en ligne du colis (`lignes_commande_web`), sinon de la facture du colis (`lignes_vente`), sinon de la vente de caisse (`lignes_comptoir`).
- Inchangée pour les autres demandes.

### POST /evaluer/:code (existante)

- Pour une demande de commande, corps : `{ notes: [{ produitId, note (1 à 5), commentaire? (2 000 caractères au plus) }] }`, de 1 à 50 articles, chacun une fois.
- Refus : `409 deja_repondu` (lien déjà utilisé), `409 article_hors_commande` (article absent de la commande), `400 donnees_invalides` (ancien format pour une demande de commande, ou article en double).
- Effet : un `retours_clients` par article (`produit_id`), statut `publie` ou `a_moderer` comme aujourd'hui ; une seule fiche de suivi si une note vaut 1 ou 2 ; `repondu_le` posé.
- Réponse `201` : `{ merci: true }`.
- Pour les autres demandes : corps et réponse inchangés.

### GET /marketplace/:org/produits/:id/avis?page

- Boutique ouverte (`parBoutique`), article en ligne de sa branche ; sinon `404 introuvable`.
- Débit limité à 60 par minute et par adresse.
- Réponse : `{ produit_id, moyenne (au dixième, null sans avis), nombre, page, pages, avis: [{ note, commentaire, date, auteur ("Awa N."), achat_verifie: true, reponse }] }`, 20 avis par page, du plus récent au plus ancien, statut `publie` seulement.
- Jamais de nom complet, de téléphone ni de référence de commande.

### GET /marketplace/:org/catalogue (existante)

- Chaque article gagne `avis: { moyenne, nombre }` (avis publiés seulement ; `moyenne` null et `nombre` 0 sans avis).

## Événements

| Événement | Charge | Note |
| --- | --- | --- |
| `colis.cree` | `{ id, numero }` | nouveau |
| `colis.etape` | `{ id, statut }` | nouveau ; `statut` parmi `expedie`, `en_transit`, `arrive`, `en_livraison`, `echec`, `retour` |

## Codes d'erreur nouveaux

| Code | Statut | Sens |
| --- | --- | --- |
| `renvoi_impossible` | 409 | le message n'est ni en échec ni sans numéro, ou il a déjà un renvoi en attente ou envoyé |
| `article_hors_commande` | 409 | l'article noté n'est pas dans la commande du lien |
| `numero_invalide` | 400 | le numéro corrigé saisi au renvoi n'est pas un mobile camerounais |
