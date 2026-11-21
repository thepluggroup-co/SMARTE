# Guide de validation : module canal en ligne (lot 1)

**Feature** : 001-glomari-plateforme-commerce
**Révision** : 2026-11-21

---

## Prérequis

- Points 1 et 2 du lot 0 fusionnés : `.github/workflows/verification.yml` présent, lieux de GLOMARI créés par `npm run provisionner:glomari`.
- PostgreSQL 16 local avec le rôle `erp_proprio` ; base `erp_test` supprimée avant chaque lancement.

```sh
npm ci
npx tsc --noEmit
TEST_ADMIN_URL=postgres://erp_proprio:erp_proprio@localhost:5432/postgres npm test
```

`tests/preparation.ts` connecte l'application avec le rôle restreint `erp_app` : la RLS est réellement éprouvée. Pour le seul canal en ligne :

```sh
TEST_ADMIN_URL=postgres://erp_proprio:erp_proprio@localhost:5432/postgres npx vitest run tests/canal
```

---

## Scénarios et résultat attendu

Routes : [contracts/routes-publiques.md](./contracts/routes-publiques.md), [contracts/routes-internes.md](./contracts/routes-internes.md). Champs : [data-model.md](./data-model.md).

| N° | Scénario | Attendu | Fichier |
|---|---|---|---|
| S1 | Boutique ouverte, `GET /marketplace/:org/catalogue` sans jeton | 200 ; prix TTC de la caisse ; catégorie, marque, photos ; aucune trace de coût | `canalcatalogue` |
| S2 | Article GTA ; boutique sur GTA ; boutique fermée | article absent ; `409 module_inactif` ; 404 | `canalcatalogue` |
| S3 | `GET /disponibilite` et `GET /zones` | vendable par lieu ; zones de la branche ; relais sans commission | `canalcatalogue` |
| S4 | Commande de 2 sur 3, puis sortie manuelle de 2 au même lieu | 201 avec référence et jeton ; vendable à 1 ; sortie refusée `409 stock_insuffisant` | `canalcommandes` |
| S5 | Deux commandes simultanées sur la dernière pièce | une 201, une `409 stock_insuffisant` | `canalcommandes` |
| S6 | Deux commandes avec le même téléphone ; même numéro connu dans GTA | une seule fiche client GLOMARI ; la fiche GTA n'est pas reprise | `canalcommandes` |
| S7 | Suivi par référence et jeton ; jeton faux | 200 sans données personnelles ; 404 | `canalcommandes` |
| S8 | Échéance dépassée, tâche lancée deux fois | `expiree`, stock libéré, un seul événement | `canalexpiration` |
| S9 | Confirmer une commande payée à la livraison | colis créé avec montant à encaisser = total ; n'expire plus | `canalgestion` |
| S10 | Confirmer une commande Orange Money ; annuler deux fois | `409 confirmation_impossible` ; `annulee` puis `409 commande_non_modifiable` | `canalgestion` |
| S11 | Cloisonnement | autre organisation : 404 ; sans `facturation.voir` : 403 | `canalgestion` |
| S12 | Mouvement de stock au Mall ; prix d'un article modifié ; article GTA modifié | `stock.disponibilite_modifiee` avec le bon vendable ; `catalogue.article_modifie` ; rien pour GTA | `canalevenements` |

---

## Contrôle manuel de l'écran

1. `npm run dev`, connexion en administrateur d'une organisation d'essai (données fictives).
2. Espace commerce, « Commandes en ligne », onglet Boutique : ouvrir la boutique et déclarer « GLOMARI Mall Douala » et « Agence de Yaoundé » (pas l'entrepôt, dont le stock rejoint le rayon par transfert).
3. Créer une zone pour la branche GLOMARI dans l'écran des transports.
4. `curl -X POST http://localhost:3000/marketplace/<org>/commandes -H "content-type: application/json" -d '…'` (corps du contrat, `moyenPaiement` `a_la_livraison`).
5. La commande apparaît en tête ; Confirmer : le colis apparaît dans l'écran des colis avec son montant à encaisser.
