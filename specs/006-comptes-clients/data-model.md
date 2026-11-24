# Data model : comptes clients en ligne (lot 4, partie B)

Migration `0052_comptes_clients.sql`. Toute table nouvelle : RLS forcée, politique `cloison`, droits accordés à `erp_app`, clés étrangères composites `(organisation_id, id)`.

## codes_connexion (nouvelle)

Un code de connexion demandé pour un numéro auprès d'une boutique.

| Champ | Type | Règle |
| --- | --- | --- |
| `id` | uuid | clé |
| `organisation_id` | uuid | |
| `branche_id` | uuid | FK `entites` ; branche de la boutique ouverte |
| `telephone` | text | mobile camerounais normalisé (`^2376[0-9]{8}$`) |
| `code_hache` | text | HMAC-SHA-256 hexadécimal (64 caractères) ; jamais le code |
| `essais` | int | essais faux, 0 à 5 |
| `expire_le` | timestamptz | création + 10 minutes |
| `utilise_le` | timestamptz | renseigné au bon code |
| `invalide_le` | timestamptz | renseigné après cinq essais faux ou à la demande d'un nouveau code |
| `envoi` | text | `envoye` ou `echec` |
| `cree_le` | timestamptz | défaut `now()` |

- Index `(organisation_id, telephone, cree_le)`.
- Check : `utilise_le` et `invalide_le` ne sont jamais renseignés ensemble.
- Pas d'audit : l'empreinte n'a rien à faire dans le journal. Droits `erp_app` : select, insert, update.

## sessions_clients (nouvelle)

L'accès d'un appareil à une fiche client pendant 7 jours.

| Champ | Type | Règle |
| --- | --- | --- |
| `id` | uuid | clé |
| `organisation_id` | uuid | |
| `branche_id` | uuid | FK `entites` ; branche de la boutique |
| `tiers_id` | uuid | FK `tiers` ; la fiche du compte |
| `telephone` | text | numéro au moment de la connexion ; la session tombe s'il change sur la fiche |
| `jeton_hache` | text | SHA-256 hexadécimal du jeton ; unique ; jamais le jeton |
| `cree_le` | timestamptz | défaut `now()` |
| `expire_le` | timestamptz | `cree_le` + 7 jours, sans prolongation |
| `revoque_le` | timestamptz | déconnexion, déconnexion de tous les appareils, fusion |
| `revoque_par` | uuid | FK `utilisateurs` ; personne de l'équipe qui a révoqué, sinon null |

- Index `(organisation_id, tiers_id)`. Pas d'audit. Droits `erp_app` : select, insert, update.
- Lien de fiche ajouté à `LIENS_TIERS` (les sessions d'un doublon sont révoquées avant la fusion).

## adresses_clients (nouvelle)

Jusqu'à cinq adresses de livraison par fiche client.

| Champ | Type | Règle |
| --- | --- | --- |
| `id` | uuid | clé |
| `organisation_id` | uuid | |
| `tiers_id` | uuid | FK `tiers` |
| `nom` | text | 1 à 50 caractères (« Maison », « Bureau ») |
| `zone_id` | uuid | FK `zones_livraison`, facultative ; zone de la branche (contrôle applicatif) |
| `adresse` | text | 3 à 500 caractères |
| `repere` | text | facultatif, 200 caractères au plus |
| `par_defaut` | boolean | défaut `false` ; une seule vraie par fiche (index unique partiel) |
| `cree_le` | timestamptz | défaut `now()` |

- Au plus cinq par fiche (`ADRESSES_MAX`, contrôle sous le verrou de la fiche). Audit. Droits `erp_app` : select, insert, update, delete.
- Lien de fiche ajouté à `LIENS_TIERS` (le « par défaut » du doublon est retiré avant la fusion).

## tiers (existante)

Inchangée. La fiche du compte est trouvée par `trouverFicheClient` (numéro dans la branche, la plus ancienne non archivée). Le nom et l'e-mail se modifient depuis l'espace client, le téléphone non.

## Transitions

```text
Code : créé ──(bon code, avant 10 min)──► utilisé
       créé ──(5 essais faux, ou nouveau code demandé)──► invalidé
       créé ──(10 min passées)──► échu (sans écriture)

Session : ouverte ──(7 jours)──► échue
          ouverte ──(déconnexion, tous les appareils, équipe Care, fusion)──► révoquée
          ouverte ──(fiche archivée, fusionnée, téléphone changé, boutique fermée)──► refusée à la requête suivante
```
