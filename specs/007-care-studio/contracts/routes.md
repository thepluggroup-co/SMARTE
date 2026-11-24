# Contrats : assistant GLOMARI Care et studio des fiches produits (lot 4, partie C)

Tout code d'erreur a son message dans `MESSAGES` (`public/app.js`). Codes nouveaux : `message_vide`, `conversation_pleine`, `brouillon_absent`, `aucun_texte_publie`. Les autres existent déjà.

Les routes `/marketplace/:org/care/…` passent par `parBoutique` : boutique fermée ou organisation inconnue donnent `404 introuvable`. Une conversation inconnue, ou un jeton qui ne lui correspond pas, donne aussi `404 introuvable`.

Pour poser une question ou demander un conseiller, une session ouverte sur un autre compte que celui déjà associé à la conversation donne aussi `404 introuvable`. Le client peut ouvrir une nouvelle conversation après un changement de compte.

## Assistant, côté Marketplace (`src/care.ts`)

### POST /marketplace/:org/care/messages

- En-tête facultatif : `Authorization: Client <jeton>` (session du lot 4B). Une session invalide rend `401 session_invalide`, comme l'espace client.
- Corps : `{ conversation?, jeton?, texte (1 à 1 000 caractères), commande?: { reference, jeton } }`.
  - Sans `conversation` : une conversation est créée.
  - `commande` : le lien de suivi d'une commande ; vérifié comme `GET /marketplace/:org/commandes/:reference`. Faux, il est ignoré sans le dire (rien n'est révélé).
- Débit : `debitCanal.care` messages par minute pour la boutique (30 par défaut, `ERP_CANAL_CARE_PAR_MINUTE`) ; au-delà, `429` comme les autres débits.
- Refus :
  - `400 message_vide` : texte vide après nettoyage des espaces ; aucun appel à l'IA ;
  - `400 donnees_invalides` : plus de 1 000 caractères ;
  - `409 conversation_pleine` : 30 messages du visiteur déjà reçus dans cette conversation.
- Effet, en trois temps (research.md R4) ; aucune connexion à la base n'est retenue pendant l'appel à l'IA :
  - enregistre le message du visiteur, puis la réponse (R2, R3) ;
  - IA absente, en panne ou au-delà de 9 secondes : réponse de repli avec l'offre d'un conseiller, toujours `200` ;
  - note la fiche du client connecté et la commande du lien sur la conversation ;
  - une conversation close repasse à `ouverte` ; une conversation transmise reste `transmise`.
- Réponse `200` :

  ```json
  {
    "conversation": "uuid",
    "jeton": "rendu seulement à la création",
    "message": {
      "id": "uuid",
      "reponse": "texte",
      "sans_reponse": false,
      "propose_conseiller": false
    },
    "ticket": "TIC-2026-0001 ou null",
    "messages_restants": 29
  }
  ```

  Au 30e message, la réponse propose toujours un conseiller.

### GET /marketplace/:org/care/conversations/:id

- Requête : `?jeton=`.
- Réponse : `{ statut, ticket, messages: [{ id, role, contenu, propose_conseiller, aide, cree_le }] }`. Sert à rouvrir la fenêtre après un rechargement. Jamais le nom ni le téléphone.

### POST /marketplace/:org/care/avis

- Corps : `{ conversation, jeton, message, aide: boolean }`.
- Refus : `404 introuvable` si `message` n'est pas une réponse de l'assistant de cette conversation.
- Effet : note l'avis ; un nouvel avis remplace le précédent.
- Réponse `200` : `{ propose_conseiller }`, qui vaut `true` si `aide` est faux.

### POST /marketplace/:org/care/conseiller

- En-tête facultatif : `Authorization: Client <jeton>`.
- Corps : `{ conversation, jeton, nom?, telephone? }`.
  - `nom` et `telephone` sont exigés seulement si aucune fiche n'est connue (ni session, ni fiche déjà notée sur la conversation).
- Refus :
  - `400 telephone_invalide` : téléphone absent ou faux alors qu'il est exigé ;
  - `400 donnees_invalides` : nom de moins de 2 caractères.
- Effet, dans une transaction :
  - fiche trouvée ou créée (`ficheClient`) ;
  - ticket ouvert pour la branche (R5) ;
  - conversation `transmise` avec son ticket ;
  - journal `care.relais`.
- Réponse `201` : `{ ticket: "TIC-2026-0001", priorite }`. Si la conversation est déjà transmise : `200` avec le même numéro, sans nouveau ticket.

## Base de réponses, conversations, indicateur (`src/care.ts`)

Routes protégées, une branche qui a le module commerce (droits `care.*`).

### GET /care/reponses?branche=&actif=

- Droit : `care.voir` sur la branche.
- Réponse : les réponses validées, les actives d'abord, par sujet : `{ id, sujet, question, reponse, actif, auteur, modifie_par, modifie_le }`. Avec `{ actives, plafond: 100 }`.

### POST /care/reponses

- Droit : `care.gerer` sur la branche.
- Corps : `{ branche, sujet, question, reponse }`. Longueurs : voir `data-model.md`.
- Refus : `400 donnees_invalides`.
- Réponse `201` : la réponse créée.

### PATCH /care/reponses/:id

- Droit : `care.gerer` sur la branche de la réponse.
- Corps : `{ sujet?, question?, reponse?, actif? }`, au moins un champ (sinon `400 donnees_invalides`).
- Réponse `200` : la réponse modifiée ; elle sert dès la question suivante.

### GET /care/conversations?branche=&du=&au=&statut=&sans_reponse=

- Droit : `care.voir` sur la branche ; avec `support.voir` seul, la liste ne contient que les conversations transmises.
- Effet : ferme d'abord les conversations sans message depuis 30 minutes.
- Réponse : les 100 dernières conversations de la période :
  - champs : `id, statut, ticket, messages, sans_reponse, aide, pas_aide, cree_le, derniere_activite` ;
  - avec `client: { nom }` seulement si la personne a `tiers.voir` sur la branche.

### GET /care/conversations/:id

- Droit : `care.voir` sur la branche ; avec `support.voir` seul, seulement une conversation transmise (`403 permission_refusee` sinon).
- Réponse : la conversation et tout son fil :
  - par message : `role, contenu, sans_reponse, propose_conseiller, motif, aide, cree_le` ;
  - `client: { id, nom, telephone }` seulement avec `tiers.voir` ;
  - `commande: { reference }` si un lien a été donné.

### GET /care/indicateur?branche=&du=&au=

- Droit : `care.voir` sur la branche. Période par défaut : les 30 derniers jours ; 366 jours au plus (`400 periode_invalide` sinon, code existant).
- Effet : ferme d'abord les conversations sans message depuis 30 minutes.
- Réponse :

  ```json
  {
    "conversations": 100,
    "closes_sans_conseiller": 82,
    "part_sans_conseiller": 82.0,
    "transmises": 15,
    "part_transmises": 15.0,
    "ouvertes": 3,
    "avis": { "aide": 40, "pas_aide": 6 },
    "sans_reponse": [{ "question": "texte", "le": "date", "conversation": "uuid" }]
  }
  ```

  - La part sans conseiller se calcule sur les conversations closes ou transmises, hors celles encore ouvertes.
  - `sans_reponse` contient les 50 dernières questions suivies d'une réponse « sans réponse ».

### GET /tickets/:id (existante, `src/relation.ts`)

- Ajout : `conversation` (fil complet, mêmes champs que `GET /care/conversations/:id`, sans le client, déjà sur le ticket) quand une conversation porte ce ticket ; sinon le champ est absent.

## Studio des fiches produits (`src/fichesvente.ts`)

Routes protégées. L'article doit être suivi en stock, dans une branche qui a le module de stock (`409 module_inactif` sinon ; GTA exclu). Droits : `marketing.voir` pour lire, `marketing.gerer` pour écrire, sur la branche de l'article.

### GET /fiches-vente?branche=&etat=&recherche=

- Réponse : les articles de la branche (500 au plus), chacun avec `{ id, code, nom, en_ligne, etat }`.
  - `etat` : `publie`, `brouillon`, `publie_et_brouillon` ou `aucun`.
  - Le filtre `etat=aucun` sert à trouver les articles sans fiche.

### GET /fiches-vente/:produitId

- Réponse : `{ article: { id, code, nom, categorie, marque, unite, prix_ttc }, brouillon, publie, historique, ia_disponible }`.
  - `historique` : toutes les versions, la plus récente d'abord, avec `version, statut, source, auteur, publie_par, publie_le, cree_le`.

### POST /fiches-vente/:produitId/brouillon-ia

- Droit : `marketing.gerer`.
- Corps : `{ notes? (1 000 caractères au plus) }`.
- Refus : `503 ia_non_configuree` ; `502 ia_indisponible` ; `502 ia_reponse_invalide` (sortie hors des limites de `data-model.md`).
- Effet : remplace le brouillon en cours, ou en crée un (`source = ia`). Rien n'est publié.
- Réponse `201` : le brouillon.

### PUT /fiches-vente/:produitId/brouillon

- Droit : `marketing.gerer`.
- Corps : `{ titre, description, points_cles }`. Limites : voir `data-model.md`.
- Refus : `400 donnees_invalides`.
- Effet : remplace le contenu du brouillon en cours (sa `source` devient `manuel`), ou en crée un.
- Réponse `200` : le brouillon.

### POST /fiches-vente/:produitId/publication

- Droit : `marketing.gerer`.
- Refus : `409 brouillon_absent`.
- Effet, dans une transaction : l'ancien texte publié passe à `remplace`, le brouillon à `publie` (`publie_par`, `publie_le`). Événement `catalogue.article_modifie` si la boutique est ouverte. Journal `fiche_vente.publiee`.
- Réponse `200` : le texte publié.

### POST /fiches-vente/:produitId/retrait

- Droit : `marketing.gerer`.
- Refus : `409 aucun_texte_publie`.
- Effet : le texte publié passe à `retire`. Événement `catalogue.article_modifie` si la boutique est ouverte. Journal `fiche_vente.retiree`.
- Réponse `200` : `{ retire: true }`.

## Catalogue public (`src/canalenligne.ts`, existante)

### GET /marketplace/:org/catalogue

- Ajout à chaque article : `vente: { titre, description, points_cles } | null` (le texte publié). `nom` reste le nom de l'article dans l'ERP.
