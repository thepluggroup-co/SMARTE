# Guide de validation : paiement Mobile Money (lot 2)

**Feature** : 002-paiement-mobile-money
**Date** : 2026-11-22

---

## Prérequis

- Lot 1 fusionné (canal en ligne). PostgreSQL 16 local avec le rôle `erp_proprio`, ou le contrôle GitHub.

```sh
npm ci
npx tsc --noEmit
TEST_ADMIN_URL=postgres://erp_proprio:erp_proprio@localhost:5432/postgres npx vitest run tests/paiement
```

Les tests utilisent le prestataire factice (`contracts/prestataire.md`) : aucun argent réel, aucun réseau.

---

## Scénarios et résultat attendu

Routes : [contracts/routes-publiques.md](./contracts/routes-publiques.md), [contracts/routes-internes.md](./contracts/routes-internes.md). Champs : [data-model.md](./data-model.md).

| N° | Scénario | Attendu |
|---|---|---|
| P1 | Commande Orange Money de 2 sur 3, paiement lancé, avis signé de réussite | facture émise au total exact, stock du lieu à 1, réservation levée, portefeuille Orange Money crédité du total, colis créé, suivi « facturee », événements `commande_web.payee` et `commande_web.facturee` |
| P2 | Même parcours avec MTN MoMo et un retrait au magasin | portefeuille MTN crédité, pas de colis |
| P3 | Avis sans signature, avis mal signé | `401`, aucune facture, avis tracé `signature_invalide` |
| P4 | Même avis valide envoyé trois fois | une seule facture, un seul règlement, un seul mouvement de portefeuille ; les deux renvois `deja_traite` |
| P5 | Avis signé au mauvais montant | `409`, commande toujours réservée |
| P6 | Avis d'échec, puis nouveau lancement et avis de réussite | premier paiement `echoue`, vente terminée par le second |
| P7 | Commande expirée puis avis de réussite | commande et paiement `a_rembourser`, argent dans le portefeuille, aucune facture ni sortie de stock, tâche au trésorier |
| P8 | Commande facturée puis second paiement réussi | commande inchangée, second paiement `a_rembourser` (`deja_payee`) |
| P9 | Identité vendeur incomplète au moment de l'avis | commande `payee`, réservation gardée, tâche « vente à terminer » ; après correction, `POST /commandes-web/:id/terminer` facture une seule fois |
| P10 | Aucun portefeuille par défaut Mobile Money | vente terminée, argent dans les encaissements en attente |
| P11 | Pas de prestataire, ou boutique sans responsable | `503 paiement_indisponible` |
| P12 | 20 paiements Orange et MTN | `GET /paiements-en-ligne` du jour : 20 lignes, total égal à la somme des avis au franc près |
| P13 | Avis adressé à une autre organisation | `404`, rien ne change dans aucune organisation |

---

## Essai privé (serveur, données fictives)

1. Dans `.env` : `ERP_PAIEMENT_FACTICE_SECRET=` suivi d'une valeur aléatoire (`openssl rand -hex 32`). Jamais avec de vraies données.
2. Ouvrir la boutique (le responsable est la personne qui l'ouvre), régler les portefeuilles par défaut Orange Money et MTN MoMo de la branche dans Trésorerie.
3. Passer une commande Orange Money, lancer le paiement, puis simuler l'avis avec `signerAvisFactice` (voir `contracts/prestataire.md`).
4. Vérifier dans l'ERP : facture, stock, portefeuille, colis, puis l'onglet « Paiements en ligne ».
