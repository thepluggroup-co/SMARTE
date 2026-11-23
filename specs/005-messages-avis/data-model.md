# Data model : messages automatiques et avis publiés (lot 4, partie A)

Migration `0051_messages_avis.sql`. Toute table nouvelle : RLS forcée, politique `cloison`, droits accordés à `erp_app`, clés étrangères composites `(organisation_id, id)`.

## Types de messages

Constante `TYPES_MESSAGES` (`src/messages.ts`), reprise dans le check de la base :

| Type | Déclencheur | Objet | Clé d'unicité | Défaut |
| --- | --- | --- | --- | --- |
| `colis_cree` | `colis.cree` | colis | `colis_cree:<colis>` | actif, SMS |
| `colis_en_livraison` | `colis.etape` (`en_livraison`) | colis | `colis_en_livraison:<colis>` | actif, SMS |
| `colis_pret_retrait` | `colis.etape` (`arrive`), seulement pour un colis d'une commande en ligne en `agence_voyage` ou `point_relais` | colis | `colis_pret_retrait:<colis>` | actif, SMS |
| `colis_livre` | `colis.livre` | colis | `colis_livre:<colis>` | actif, SMS |
| `acompte_confirme` | `precommande.inscription_validee` | inscription | `acompte_confirme:<inscription>` | actif, SMS |
| `etape_arrivage` | `precommande.arrivage_etape` | inscription | `etape_arrivage:<inscription>:<etape>` | actif, SMS |
| `solde_a_payer` | `precommande.arrivage_recu` | inscription | `solde_a_payer:<inscription>` | actif, SMS |
| `rappel_solde` | `precommande.arrivage_recu`, daté de `solde_avant - 2 jours` | inscription | `rappel_solde:<inscription>` | actif, SMS |
| `acompte_a_rembourser` | `precommande.a_rembourser` | inscription | `acompte_a_rembourser:<inscription>` | actif, SMS |
| `acompte_conserve` | `precommande.acompte_conserve` | inscription | `acompte_conserve:<inscription>` | actif, SMS |
| `avis_livraison` | `colis.livre`, daté de la livraison + 14 jours, si la commande en ligne du colis ou sa facture a un client | colis | `avis_livraison:<colis>` | actif, SMS |
| `avis_magasin` | `vente.comptoir`, daté de la vente + 14 jours | vente de caisse | `avis_magasin:<vente>` | inactif, SMS |

## reglages_messages (nouvelle)

Réglage d'un type de message pour une branche. Sans ligne, le défaut du tableau ci-dessus s'applique.

| Champ | Type | Règle |
| --- | --- | --- |
| `organisation_id` | uuid | clé |
| `branche_id` | uuid | clé ; FK `entites` ; branche avec le module de stock (contrôle applicatif) |
| `type` | text | clé ; un des types ci-dessus |
| `actif` | boolean | obligatoire |
| `canal` | text | `sms` ou `whatsapp` |
| `modifie_par` | uuid | FK `utilisateurs` |
| `modifie_le` | timestamptz | défaut `now()` |

- Identifiant `id` (exigé par la trace d'audit), unique `(organisation_id, branche_id, type)` ; audit.
- Droits `erp_app` : select, insert, update.

## envois_messages (nouvelle)

Un message à envoyer, envoyé ou abandonné : à la fois la file et le journal.

| Champ | Type | Règle |
| --- | --- | --- |
| `id` | uuid | clé ; sert de référence auprès du prestataire |
| `organisation_id` | uuid | |
| `branche_id` | uuid | FK `entites` ; branche de l'objet |
| `type` | text | check : un des types |
| `cle` | text | unique par organisation (voir le tableau ; `<clé>#<id>` pour un renvoi) |
| `objet_type` | text | `colis`, `inscription` ou `vente_comptoir` |
| `objet_id` | uuid | identifiant de l'objet (pas de FK : trois tables possibles) |
| `statut` | text | `en_attente` (défaut), `en_cours`, `envoye`, `echec`, `sans_numero`, `annule` |
| `canal` | text | `sms` ou `whatsapp`, écrit à la tentative ; null avant |
| `numero_masque` | text | sept astérisques puis les deux derniers chiffres ; jamais le numéro complet |
| `du_le` | timestamptz | pas d'envoi avant ; défaut `now()` |
| `tentatives` | int | ≥ 0, ≤ 3 |
| `essai_le` | timestamptz | dernière tentative |
| `envoye_le` | timestamptz | renseigné si `envoye` |
| `erreur` | text | code court (`prestataire`, `sans_numero`, `desactive`, `ne_pas_contacter`, `sans_objet`) ; jamais le texte du message |
| `reference_prestataire` | text | référence rendue par le prestataire |
| `renvoi_de` | uuid | FK `envois_messages` ; renvoi d'un message en échec ou sans numéro |
| `renvoye_par` | uuid | FK `utilisateurs` |
| `cree_le` | timestamptz | défaut `now()` |

- Unique `(organisation_id, cle)` ; index `(statut, du_le)` ; index `(organisation_id, branche_id, cree_le)`.
- Check : `envoye_le` renseigné si et seulement si `statut = 'envoye'`.
- Pas d'audit : la table est elle-même un journal. Droits `erp_app` : select, insert, update.
- Le texte du message n'est jamais enregistré.

Transitions :

```text
en_attente ──(passage, heures d'envoi)──► en_cours ──(prestataire ok)──► envoye
     ▲                                       │
     └──────(échec, tentatives < 3, +20 min)─┤
                                             ├──(échec, 3e tentative)──► echec ──(renvoi)──► nouvelle ligne en_attente
en_attente ──(numéro absent ou invalide)──► sans_numero ──(renvoi)──► nouvelle ligne en_attente
en_attente ──(type coupé depuis la mise en file, client « ne pas contacter », sans objet)──► annule
en_cours depuis plus de 15 minutes ──► en_attente (tentative comptée)
```

## tiers (colonne ajoutée)

| Champ | Type | Règle |
| --- | --- | --- |
| `ne_pas_contacter` | boolean | défaut `false` ; vrai : aucune demande d'avis |

Modifiable par `PATCH /tiers/:id` (`tiers.modifier`) ; reportée sur la fiche gardée lors d'une fusion si l'une des deux fiches l'a.

## demandes_retour (existante, contraintes élargies)

- `cible_type` accepte aussi `commande` : demande d'avis sur les articles d'une commande livrée ou d'un achat en magasin.
- `source_type` accepte aussi `vente_comptoir`.
- L'unicité existante `(organisation_id, source_type, source_id, cible_type)` garantit une seule demande par colis ou par vente.

## retours_clients (existante, colonne ajoutée)

| Champ | Type | Règle |
| --- | --- | --- |
| `produit_id` | uuid | FK `produits` ; renseigné pour un avis sur un article d'une commande |

- L'unicité sur `demande_id` est remplacée par un index unique `(organisation_id, demande_id, coalesce(produit_id, '00000000-0000-0000-0000-000000000000'))` : un avis par article, et toujours un seul avis pour les autres demandes.
- Index `(organisation_id, produit_id, statut)` pour les avis publics.

## Événements ajoutés

| Événement | Émis quand | Charge |
| --- | --- | --- |
| `colis.cree` | colis créé (`creerColis`) | `{ id, numero }` |
| `colis.etape` | étape enregistrée (`POST /colis/:id/etape`) | `{ id, statut }` |

Sans téléphone ni adresse : la Marketplace retrouve le colis par son identifiant.
