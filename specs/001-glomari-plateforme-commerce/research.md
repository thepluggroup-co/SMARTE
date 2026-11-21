# Recherche : module canal en ligne GLOMARI (lot 1)

**Feature** : 001-glomari-plateforme-commerce
**Phase** : 0
**Révision** : 2026-11-21, après lecture de `docs/Fiche technique globale GLOMARI.md` (version 2.0) et `/speckit-analyze`

---

## 1. Documents de référence

| Document | Rôle |
|---|---|
| `docs/Fiche technique globale GLOMARI.md` (v2.0) | Fait foi pour le besoin du lot 1 : règles R1 à R15 (section 2), Marketplace (section 5), contrats d'interface (section 6), prompt du lot 1 (section 9) |
| `docs/Fiche technique d ajustement GLOMARI.md` (v1.0) | Remplacée par la v2.0 (en-tête de la v2.0) ; non utilisée |
| `CLAUDE.md` | Fait foi pour les règles techniques (la fiche le dit elle-même, l. 17) |
| `docs/Manuel d’intégration.md` | Tranche un besoin flou ; rien de contraire relevé pour le lot 1 |

Ordre imposé des lots : 0, puis 1 (fiche, section 0). Points 1 et 2 du lot 0 livrés le 21 novembre 2026 : contrôle GitHub `verification.yml` (demande n° 1, fusionnée) et lieux « GLOMARI Mall Douala », « Entrepôt GLOMARI Mall Douala », « Agence de Yaoundé » par `npm run provisionner:glomari` (demande n° 2). Les points 3 (import des clients) et 4 (double authentification) ne conditionnent pas le lot 1.

## 2. Routes publiques : celles de la fiche

La fiche (6.1) et les prompts W3 à W5 de la Marketplace appellent `/marketplace/:org/catalogue`, `/disponibilite?produits=`, `/zones`, `/commandes` et `/commandes/:reference?jeton=` ; les lots 2 à 4 y ajoutent `/payer`, `/campagnes`, `/care/messages`.

**Décision** : reprendre exactement ces routes, avec `:org` = identifiant de l'organisation. Le code secret de boutique du premier plan est abandonné : la Marketplace est publique, un secret embarqué dans son code ne protégerait rien. `config_canal` ne garde qu'un interrupteur par branche, une seule boutique active par organisation. Modèle technique inchangé : `parCode()` et le catalogue public de `src/mall.ts` (l. 286 à 300), débit par route, `404 introuvable` pour tout échec.

Le catalogue ne contient pas de quantité : la Marketplace le met en cache (invalidé par `catalogue.article_modifie`) alors que la disponibilité n'est jamais gardée plus de 30 secondes (fiche, W3).

## 3. Réutiliser l'existant au lieu de le recréer

| Besoin | Existant | Décision |
|---|---|---|
| Zones et frais | `zones_livraison` (0019 l. 57 : `entite_id, nom, frais, delai_jours`), `POST /zones-livraison` avec `transport.gerer` | Réutiliser, sur la branche GLOMARI : un droit exige son module sur l'entité elle-même (`src/permissions.ts` l. 27 à 30) et les lieux créés par `creerMagasin` n'ont pas le module transport. Zones et colis du canal sont donc au nom de la branche (`POST /colis` exige zone et colis sur la même entité, l. 269). Toutes les zones de la branche sont publiques (pas de colonne « actif ») |
| Points relais | `points_relais` (0021 l. 52), `POST /points-relais`, dépôt `POST /colis/:id/depot-relais` | Proposés dès le lot 1 (**décision du 21 novembre 2026**) ; FR-007 corrigé |
| Colis à encaisser | `POST /colis` (`aEncaisser`, `zoneId`), `colis.a_encaisser`, remise de caisse du livreur | Extraire la création en `creerColis()`, appelée par la confirmation ; colis créé sur la branche, donc visible dans l'écran des colis et pour les livreurs |
| Fiche client | `POST /caisse/clients` (téléphone normalisé, branche, rôle client) ; création publique déjà faite par `/capture/:code` (`src/prospection.ts` l. 94) | Même règle dans la commande ; `tiers_id` obligatoire |
| Numérotation | `prochainNumero(client, serie)` (`src/formations.ts` l. 17), utilisé pour `COL-AAAA` | `reference` = `WEB-AAAA-000001` |
| Catégories, marques, photos | `categories_articles` (0042), `marques` (0044), `photos_produits` (0044), route photo protégée (`src/articles.ts` l. 208) | Exposées au catalogue ; route publique de photo pour les seuls articles du catalogue |

La table `zones_livraison` existant déjà, la recréer aurait fait échouer la migration 0046 (constat critique D1 de l'analyse).

## 4. Prix : un seul calcul

`produits.prix_vente` est hors taxes, la taxe est `produits.taux_taxe`. La caisse fait `brutTranches()`, `prixProduit()` puis `calculerLigne()` (`src/caisse.ts` l. 310 à 315). **Décision** : mêmes fonctions, sans client (pas de prix négocié). Les lignes gardent `prix_unitaire_ttc` (nom de la fiche) et aussi le HT, la taxe et les totaux, utiles à la facture du lot 2. Unité de base seulement au lot 1.

## 5. Stock, réservation, concurrence

- Le stock vit par entité (`niveau()`, `src/stocks.ts` l. 9). La commande porte le `lieu_id` qui la sert ; la réservation est posée sur ce lieu, sinon la caisse du lieu ne la verrait pas.
- Vendable = niveau − réservations actives − avariés `constatee` (`sortirDuStock`, l. 29 à 32 ; `src/logistique.ts` l. 245). **Décision** : une fonction SQL `quantite_vendable()` porte cette formule ; `quantiteDisponible()` en TypeScript l'appelle, `sortirDuStock` aussi. Une seule formule pour la caisse, le canal et les événements.
- Verrou : `produitSuivi()` (`select … for update`, l. 18), lignes triées par article pour éviter les interblocages.
- `reservations_stock.auteur_id` est obligatoire et `expire_le` est une date : migration 0046 → `commande_web_id`, `auteur_id` nullable avec contrôle ; échéance portée par `commandes_web.expire_le`.
- Durées (**décision du 21 novembre 2026**) : 30 minutes pour Orange Money et MTN (`DUREE_RESERVATION_MINUTES`), 24 heures pour le paiement à la livraison (`DUREE_RESERVATION_LIVRAISON_MINUTES`), conformément à l'hypothèse de la spécification. Une commande confirmée (colis créé) n'expire plus.

## 6. Statuts

Liste de la fiche (section 9 et schéma 5.2) : `reservee, payee, facturee, expediee, livree, annulee, expiree`. Le lot 1 n'écrit que `reservee`, `annulee`, `expiree` ; la confirmation d'un paiement à la livraison laisse `reservee` et pose `colis_id` (fiche 5.2 : « reservee → confirmation interne → colis à encaisser → livree »). Limite : une commande livrée garde sa réservation jusqu'au lot 2 (facture et sortie de stock).

## 7. Expiration

Tâches planifiées existantes : toutes les heures (`src/serveur.ts` l. 818). La fiche demande « chaque minute ». **Décision** : minuterie de 60 secondes à côté de celle des webhooks (l. 819), plus la tâche horaire (testable par `app.executerTaches`), plus un appel au début de la création de commande. `for update skip locked` rend l'expiration sûre en cas de redémarrage ou d'exécutions simultanées.

## 8. Événements vers la Marketplace

La fiche demande `stock.disponibilite_modifiee` « à chaque mouvement de stock » et `catalogue.article_modifie`. Le code écrit le stock à 13 endroits (7 fichiers) et le catalogue à 22 endroits (9 fichiers). **Décision** : déclencheurs dans la migration 0046, qui insèrent dans `evenements` (même table que `publierEvenement`), limités aux lieux et à la branche d'une boutique active : aucun événement pour GTA. Aucun déclencheur n'insère encore d'événement dans le dépôt ; des déclencheurs existent déjà sur `mouvements_stock` (`lots`, 0021) et `colis` (`audit`, 0019).

## 9. Droits

| Usage | Droit | Source |
|---|---|---|
| Voir commandes et configuration | `facturation.voir` | fiche, section 9 |
| Confirmer (création du colis comprise), annuler | `facturation.gerer` sur la branche | fiche ; précédent « vendre donne le droit de sortir la marchandise vendue » (`src/facturation.ts` l. 329) |
| Ouvrir la boutique, déclarer les lieux | `facturation.administrer` | même droit que le lien du portail grossiste (`src/mall.ts` l. 277) |
| Zones, points relais | droits existants (`transport.gerer`…) | routes existantes, inchangées |

Module requis : `achats_stocks` sur la branche. GTA ne l'a pas : aucune boutique GTA possible.

## 10. Jeton et référence

`hacherJeton()` rend un SHA-256 hexadécimal : `jeton_suivi_hache text`. Jeton brut : `randomBytes(32)` en base64url (43 caractères), renvoyé une seule fois. Le suivi exige la référence **et** le jeton ; il ne montre ni nom, ni téléphone, ni adresse, ni code de confirmation du colis.

## 11. Erreurs

Déjà dans `MESSAGES` : `introuvable`, `donnees_invalides`, `stock_insuffisant`, `produit_sans_stock`, `telephone_invalide`, `module_inactif` (message à rendre générique : il parle aujourd'hui des Formations). Nouveaux : `lieu_invalide`, `zone_invalide`, `point_relais_invalide`, `mode_livraison_invalide`, `commande_non_modifiable`, `confirmation_impossible`, `boutique_deja_active`.

## 12. Tests

`tests/outils.ts` : `environnement()`, `api()` sans jeton pour le public, `nouvelleOrganisation()` (structure SGC, `entites.GLOMARI`, `entites.GTA`), `poolApp` (rôle restreint `erp_app`), `app.executerTaches`. Lieu : `POST /magasins` (`tests/caisse.test.ts` l. 13) ; zone : `POST /zones-livraison` (`tests/pilotage.test.ts` l. 80) ; relais : `POST /points-relais` (`tests/mall.test.ts` l. 85). Concurrence : `Promise.all` (`tests/achats.test.ts` l. 80). Débit : un fichier de test par étape, moins de 20 créations de commande par fichier.

## 13. Nommage

`src/canalenligne.ts`, `public/canalenligne.js`, `tests/canal*.test.ts` (**décision du 21 novembre 2026** : règle de CLAUDE.md, sans tiret bas, que la fiche reconnaît comme décisive pour les règles techniques). La migration garde la forme imposée `0046_canal_en_ligne.sql`. La fiche écrit `src/canal_en_ligne.ts` (l. 202 et 416) : à corriger dans la fiche.

## 14. Hors lot 1

Paiement en ligne, facture et sortie de stock automatiques (lot 2) ; notifications SMS ou WhatsApp (lot 4) ; compte client par code à usage unique (lot 4) ; affiliation (lot 5, `code_affilie` prévu vide) ; description d'article (aucune colonne dans `produits`) ; conditionnements ; colonne « actif » des zones.
