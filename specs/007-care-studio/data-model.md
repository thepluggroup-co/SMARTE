# Data model : assistant GLOMARI Care et studio des fiches produits (lot 4, partie C)

Migration `0053_care_studio.sql`. Toute table nouvelle : RLS forcée, politique `cloison`, droits accordés à `erp_app`, clés étrangères composites `(organisation_id, id)`.

## conversations_care (nouvelle)

Un échange entre un visiteur de la Marketplace et l'assistant, pour la boutique ouverte.

| Champ | Type | Règle |
| --- | --- | --- |
| `id` | uuid | clé |
| `organisation_id` | uuid | |
| `branche_id` | uuid | FK `entites` ; branche de la boutique ouverte |
| `jeton_hache` | text | SHA-256 hexadécimal du jeton de conversation ; unique ; jamais le jeton |
| `tiers_id` | uuid | FK `tiers`, facultative ; fiche du client connecté, ou fiche trouvée ou créée au relais |
| `commande_web_id` | uuid | FK `commandes_web`, facultative ; commande ouverte par son lien de suivi |
| `statut` | text | `ouverte`, `close` ou `transmise` ; défaut `ouverte` |
| `ticket_id` | uuid | FK `tickets`, facultative ; renseignée si et seulement si `statut = 'transmise'` (check) |
| `messages_visiteur` | int | 0 à 30 (`MESSAGES_MAX_CONVERSATION`), défaut 0 |
| `derniere_activite` | timestamptz | défaut `now()` ; mise à jour à chaque message |
| `close_le` | timestamptz | renseigné au passage à `close` |
| `cree_le` | timestamptz | défaut `now()` |

- Index `(organisation_id, branche_id, cree_le)` pour l'indicateur ; index partiel `(derniere_activite) where statut = 'ouverte'` pour la tâche horaire.
- Index unique partiel `(organisation_id, ticket_id) where ticket_id is not null` : un ticket, une conversation.
- Pas d'audit : volume élevé, aucun réglage. Droits `erp_app` : select, insert, update, delete (purge à 12 mois).
- Lien de fiche ajouté à `LIENS_TIERS`.

## messages_care (nouvelle)

Une question du visiteur ou une réponse de l'assistant.

| Champ | Type | Règle |
| --- | --- | --- |
| `id` | uuid | clé |
| `organisation_id` | uuid | |
| `conversation_id` | uuid | FK `conversations_care`, `on delete cascade` |
| `role` | text | `visiteur` ou `assistant` |
| `contenu` | text | 1 à 2 000 caractères (1 000 au plus pour le visiteur, contrôle applicatif) |
| `sans_reponse` | boolean | défaut `false` ; vrai seulement pour l'assistant (check) |
| `propose_conseiller` | boolean | défaut `false` ; vrai seulement pour l'assistant (check) |
| `motif` | text | `remboursement`, `litige`, `autre` ou null ; null pour le visiteur (check) |
| `aide` | boolean | null tant que le visiteur n'a rien dit ; renseigné seulement sur une réponse de l'assistant (check) |
| `cree_le` | timestamptz | défaut `now()` |

- Index `(organisation_id, conversation_id, cree_le)`. Pas d'audit. Droits `erp_app` : select, insert, update (avis, anonymisation), delete (purge).
- Anonymisation de la fiche de la conversation : `contenu` devient « Message effacé » ; les autres champs restent, pour l'indicateur.

## reponses_care (nouvelle)

Une réponse validée par l'équipe Care, pour une branche.

| Champ | Type | Règle |
| --- | --- | --- |
| `id` | uuid | clé |
| `organisation_id` | uuid | |
| `branche_id` | uuid | FK `entites` ; branche qui a le module de stock |
| `sujet` | text | 1 à 100 caractères (« Livraison », « Retours ») |
| `question` | text | 3 à 500 caractères ; question type |
| `reponse` | text | 3 à 2 000 caractères |
| `actif` | boolean | défaut `true` ; seules les actives entrent dans le contexte de l'assistant |
| `auteur_id` | uuid | FK `utilisateurs` |
| `modifie_par` | uuid | FK `utilisateurs`, facultative |
| `cree_le` | timestamptz | défaut `now()` |
| `modifie_le` | timestamptz | défaut `now()` |

- Index `(organisation_id, branche_id, actif)`. Audit (`audit_ligne()`). Droits `erp_app` : select, insert, update ; aucune suppression.
- Au plus 100 actives par branche servent à l'assistant (les plus récemment modifiées) ; au-delà, l'écran le signale.

## textes_vente (nouvelle)

Une version du texte de vente d'un article, affiché sur la Marketplace.

| Champ | Type | Règle |
| --- | --- | --- |
| `id` | uuid | clé |
| `organisation_id` | uuid | |
| `produit_id` | uuid | FK `produits` ; article suivi en stock, d'une branche qui a le module de stock |
| `version` | int | 1, 2, 3… ; unique par article |
| `titre` | text | 1 à 80 caractères |
| `description` | text | 1 à 1 500 caractères |
| `points_cles` | text[] | 3 à 6 éléments, chacun de 1 à 120 caractères (contrôle applicatif ; nombre en check) |
| `source` | text | `ia` ou `manuel` |
| `notes` | text | facultatives, 1 000 caractères au plus ; notes données à l'IA |
| `statut` | text | `brouillon`, `publie`, `remplace` ou `retire` |
| `auteur_id` | uuid | FK `utilisateurs` |
| `publie_par` | uuid | FK `utilisateurs`, facultative ; renseignée à la publication |
| `publie_le` | timestamptz | renseigné à la publication |
| `cree_le` | timestamptz | défaut `now()` |

- Index unique `(organisation_id, produit_id, version)`.
- Index unique partiel `(organisation_id, produit_id) where statut = 'publie'` : un seul texte publié par article.
- Index unique partiel `(organisation_id, produit_id) where statut = 'brouillon'` : un seul brouillon en cours.
- Audit. Droits `erp_app` : select, insert, update ; aucune suppression (historique).
- `titre`, `description`, `points_cles` et `source` ne changent plus une fois la version publiée (contrôle applicatif) ; seul le statut avance.
- Déclencheur `after insert or update of statut` : quand le statut devient `publie` ou `retire` (un remplacement accompagne toujours une publication), appelle `canal_publier_article(organisation_id, produit_id)` (migration 0046), qui publie `catalogue.article_modifie` seulement si la boutique de la branche est ouverte.

## Tables existantes

- **tickets** : inchangée. Le relais crée un ticket avec `canal = 'site'`, la priorité de R5 et une fiche client (`tiers_id` obligatoire).
- **produits** : inchangée. Le nom de l'article n'est jamais modifié par le studio.
- **tiers** : inchangée. La fiche d'un visiteur sans compte est trouvée ou créée par `ficheClient`, comme pour une commande en ligne.

## Transitions

```text
Conversation : ouverte ──(30 min sans message, tâche horaire)──► close
               ouverte ou close ──(demande de conseiller)──► transmise (ticket créé)
               transmise ──(nouvelle demande)──► transmise (même ticket)
               close ──(nouveau message du visiteur)──► ouverte
               close, non transmise, plus de 12 mois ──► effacée avec ses messages

Texte de vente : brouillon ──(publication)──► publie
                 publie ──(nouvelle publication)──► remplace
                 publie ──(retrait)──► retire
                 brouillon ──(correction à la main ou nouveau brouillon par l'IA)──► brouillon (même version, contenu remplacé)
```
