# Contrats API : routes internes du canal en ligne (lot 1)

**Module** : `src/canalenligne.ts`
**Accès** : jeton de session via `protege()`, droit vérifié côté serveur par `exigerSurEntite()`.

| Domaine | Lecture | Écriture | Entité contrôlée |
|---|---|---|---|
| Commandes en ligne | `facturation.voir` | `facturation.gerer` | branche (`commandes_web.entite_id`) |
| Boutique et lieux | `facturation.voir` | `facturation.administrer` (comme l'ouverture du portail grossiste) | branche |
| Zones de livraison | inchangé | `transport.gerer` | branche GLOMARI, par la route existante `POST /zones-livraison` (`src/pilotage.ts` l. 241). Un droit exige son module sur l'entité elle-même (`src/permissions.ts` l. 27 à 30) et les lieux n'ont pas le module transport |
| Points relais | inchangé | droits existants | route existante `POST /points-relais` (`src/mall.ts` l. 186) |

---

## Commandes

### GET `/commandes-web`

Lance d'abord `expirerCommandesWeb`, puis renvoie les commandes des branches de `entitesAccessibles(ctx.client, ctx.utilisateurId, "facturation.voir")`. Filtre facultatif `statut`. 300 lignes au plus, `reservee` sans colis d'abord, puis `cree_le desc`.

```json
[{ "id": "uuid", "reference": "WEB-2026-000001", "statut": "reservee", "lieu": "GLOMARI Mall Douala", "nom_client": "Jean Mbarga", "telephone": "237699000001", "mode_livraison": "domicile", "moyen_paiement": "a_la_livraison", "total_ttc": 835750, "expire_le": "…", "colis_id": null, "cree_le": "…" }]
```

### GET `/commandes-web/:id`

`facturation.voir` sur la branche. Commande complète (adresse, zone, point relais, note, motif, `traite_par`, `traite_le`, fiche client), lignes avec le nom de l'article, colis (numéro, statut, montant à encaisser) s'il existe. `404 introuvable` sinon.

### POST `/commandes-web/:id/confirmer`

Paiement à la livraison seulement (fiche, section 5.2).

1. Verrou `for update` sur la commande ; `exigerSurEntite(ctx, "facturation.gerer", entite_id)` (la branche).
2. Exige `moyen_paiement = 'a_la_livraison'`, sinon `409 confirmation_impossible` ; exige `statut = 'reservee'`, `colis_id` nul et `expire_le > now()`, sinon `409 commande_non_modifiable`.
3. Crée le colis par `creerColis()` (fonction extraite de `POST /colis`, `src/pilotage.ts` l. 252 à 288, comportement inchangé) : `entiteId` = branche (`commandes_web.entite_id`, qui a le module transport : le colis apparaît dans l'écran des colis et pour les livreurs), `destinataire` = `nom_client`, `telephone`, `adresse` (celle du point relais pour ce mode), `zoneId`, `aEncaisser` = `total_ttc`. Le droit `facturation.gerer` suffit, comme « vendre donne le droit de sortir la marchandise vendue » (`src/facturation.ts` l. 329).
4. Renseigne `colis_id`, `traite_par`, `traite_le` ; garde les réservations ; publie `commande_web.confirmee`.

**Réponse 200** : `{ "statut": "reservee", "colis": { "id": "uuid", "numero": "COL-2026-000001", "lien_suivi": "…" } }`

Pour un point relais, le dépôt du colis au relais se fait ensuite par la route existante `POST /colis/:id/depot-relais`.

### POST `/commandes-web/:id/annuler`

`facturation.gerer` sur la branche. Corps : `{ "motif": "3 à 500 caractères" }`, obligatoire. Exige `statut = 'reservee'` et, si un colis existe, son statut parmi `prepare`, `echec`, `retour` ; sinon `409 commande_non_modifiable`. Lève les réservations, passe à `annulee`, renseigne `motif`, `traite_par`, `traite_le`, publie `commande_web.annulee`. Le colis éventuel n'est pas modifié : son retour suit le circuit des colis.

**Réponse 200** : `{ "statut": "annulee" }`

---

## Boutique et lieux

### GET `/canal-config?entiteId=`

`facturation.voir` sur la branche. Réponse : `{ "actif": true, "lieux": [{ "entite_id", "nom_public", "actif" }] }`, ou `{ "actif": false, "lieux": [] }` sans boutique.

### POST `/canal-config`

`facturation.administrer` sur la branche. Corps : `{ "entiteId": "uuid", "actif": true }`. Module `achats_stocks` actif exigé (`modules_entite`, comme `exigerStock`, `src/entrepots.ts` l. 48), sinon `409 module_inactif`. Crée la ligne au besoin (`on conflict (organisation_id, entite_id)`). Une autre branche déjà active : `409 boutique_deja_active` (violation de l'index unique partiel). Journal : `journal_evenement('canal.acces', …)`.

**Réponse 200** : `{ "actif": true }`

### POST `/canal-config/lieux`

`facturation.administrer` sur la branche. Corps : `{ "entiteId": "uuid", "lieuEntiteId": "uuid", "nomPublic": "GLOMARI Mall Douala", "actif": true }`. Création ou mise à jour (`on conflict (organisation_id, config_id, entite_id)`). `entite_branche(lieuEntiteId)` doit égaler `entiteId`, sinon `400 lieu_invalide`.

---

## Expiration des réservations

Fonction exportée `expirerCommandesWeb(c: Client): Promise<number>`, idempotente :

```sql
select id from commandes_web
 where statut = 'reservee' and colis_id is null and expire_le < now()
 for update skip locked;
-- pour chaque id, dans la même transaction :
update reservations_stock set levee_le = now() where commande_web_id = $1 and levee_le is null;
update commandes_web set statut = 'expiree', traite_le = now() where id = $1;
-- publierEvenement(c, 'commande_web.expiree', { id, reference })
```

Appelée :

1. chaque minute, par une minuterie de `src/serveur.ts` (sous `options.webhooksAuto`, sur chaque organisation de `registre_organisations`), comme le demande la fiche (section 9, lot 1) ;
2. par la tâche planifiée horaire (`taches`), ce qui la rend testable par `app.executerTaches(orgId)` ;
3. au début de `POST /marketplace/:org/commandes` et de `GET /commandes-web`.

Aucune route HTTP ne l'expose.

---

## Événements publiés

| Événement | Émis par | Charge |
|---|---|---|
| `commande_web.creee` | création | `{ id, reference, total_ttc }` |
| `commande_web.confirmee` | confirmation | `{ id, reference, colis_id }` |
| `commande_web.annulee` | annulation | `{ id, reference, motif }` |
| `commande_web.expiree` | expiration | `{ id, reference }` |
| `stock.disponibilite_modifiee` | déclencheurs de la migration 0046 | `{ produit_id, lieu_id, disponible }` |
| `catalogue.article_modifie` | déclencheurs de la migration 0046 | `{ produit_id }` |
| `tiers.cree` | création de la fiche client | `{ id }` |

Les webhooks existants les livrent au moins une fois ; la Marketplace dédoublonne par l'identifiant d'événement.

---

## Écran « Commandes en ligne »

**Fichier** : `public/canalenligne.js`, chargé par `public/index.html`, ajouté à `FICHIERS` dans `public/sw.js` (et `CACHE` porté à `smarte-solutions-v2`).
**Accès** : bouton dans l'espace commerce de `public/app.js`, visible avec `facturation.voir`, près de « Portail grossiste ».
**Contenu** : liste filtrable par statut, détail, Confirmer (paiement à la livraison) et Annuler (motif) avec `facturation.gerer` ; onglet Boutique (ouvrir ou fermer, lieux) avec `facturation.administrer`. Les zones et points relais se règlent dans leurs écrans existants.
