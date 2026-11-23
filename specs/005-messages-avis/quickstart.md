# Quickstart : vérifier les messages et les avis (lot 4, partie A)

## Prérequis

- Lot 3B fusionné (demande n° 8).
- Contrôle GitHub `verification.yml` : PostgreSQL 16, rôle `erp_proprio`, tests avec le rôle restreint `erp_app`. Ce poste n'a ni PostgreSQL ni Docker : les tests tournent dans GitHub Actions.

```sh
npm ci
npx tsc --noEmit
TEST_ADMIN_URL=postgres://erp_proprio:erp_proprio@localhost:5432/postgres npm test
```

## Mise en place commune des tests

`tests/messagesoutils.ts` prépare un environnement avec le prestataire factice (`prestataireMessagesFactice`) passé au serveur, et :

- une organisation avec la boutique GLOMARI ouverte, un lieu, un article et un client au téléphone mobile valide ;
- `envoyer(heureDouala, decalageJours)` : appelle `app.pousserMessages` à une date choisie (10 h par défaut, le jour même) ;
- `envoyes()` : les messages reçus par le prestataire factice (canal, numéro, texte) ;
- `journal()` : `GET /messages` de la branche.

Les routes sont décrites dans [routes.md](./contracts/routes.md), et les tables dans [data-model.md](./data-model.md).

## Scénarios

| N° | Scénario | Résultat attendu | Fichier |
| --- | --- | --- | --- |
| Q1 | Colis créé pour un client au mobile connu | un SMS avec le lien `suivi.html?c=…` vers ce numéro ; journal « envoyé », numéro masqué | `messagescolis` |
| Q2 | Colis passé « en livraison », paiement à la livraison de 25 000 | un message avec le code à six chiffres et « 25 000 FCFA » | `messagescolis` |
| Q3 | Colis d'une commande en ligne en point relais « arrivé », puis « en livraison », puis livré ; colis à domicile passé par « arrivé » | « prêt à retirer » avec le code, aucun second code, puis « livré » ; rien pour le colis à domicile à l'étape « arrivé » | `messagescolis` |
| Q4 | Même étape enregistrée deux fois, envoi relancé | un seul message par étape | `messagescolis` |
| Q5 | Colis sans téléphone ; numéro fixe | aucun envoi, statut « sans numéro » | `messagescolis` |
| Q6 | Étape à 23 h, envoi à 23 h puis à 7 h | rien à 23 h, envoyé à 7 h | `messagescolis` |
| Q7 | Acompte de précommande validé | message avec la référence, la quantité et la date limite ; jamais le jeton | `messagesprecommandes` |
| Q8 | Étape d'arrivage, deux inscrits payés et un remboursé | un message par inscrit payé, aucun au remboursé | `messagesprecommandes` |
| Q9 | Réception : solde à payer ; rappel deux jours avant ; solde payé avant le rappel | message de solde ; rappel une seule fois ; aucun rappel si le solde est payé | `messagesprecommandes` |
| Q10 | Campagne annulée ; acompte conservé | message de remboursement ; message d'acompte conservé | `messagesprecommandes` |
| Q11 | Colis livré d'une commande en ligne (Mobile Money, puis paiement à la livraison) et colis saisi à la main relié à une facture ; envoi au 13e puis au 14e jour | rien au 13e jour, un lien d'avis au 14e, une seule fois ; aucun lien pour un colis sans commande en ligne ni facture | `avisproduits` |
| Q12 | Client « ne pas contacter » | aucun lien d'avis ; les messages du colis partent | `avisproduits` |
| Q13 | Lien ouvert : deux articles notés 5 et 2 ; second envoi | deux avis vérifiés ; un ticket pour l'équipe Care ; `409 deja_repondu` ; article étranger : `409 article_hors_commande` | `avisproduits` |
| Q14 | Trois avis publiés, un masqué | route publique : 3 avis, moyenne, nombre ; catalogue : même moyenne ; auteur « Awa N. » sans nom complet | `avispublics` |
| Q15 | Vente en caisse à un client identifié | aucun lien tant que le type est inactif ; activé, un lien au 14e jour | `avisproduits` |
| Q16 | Type désactivé, puis réactivé ; type coupé alors qu'un message attend ; type réglé sur WhatsApp | aucun message créé, rien de passé ne part à la réactivation ; message en attente annulé ; il passe par WhatsApp | `messagesreglages` |
| Q17 | Prestataire factice en panne ; renvoi avec un numéro corrigé, puis invalide | trois tentatives en une heure, puis « échec » ; téléphone de l'objet remplacé, nouvelle ligne envoyée, l'ancienne gardée ; `400 numero_invalide` | `messagesreglages` |
| Q18 | Journal | numéros masqués, aucun code ni texte ; totaux du mois par type et par canal | `messagesreglages` |
| Q19 | Utilisateur de GTA ; autre organisation | aucun accès aux réglages ni au journal ; avis publics d'une autre organisation introuvables | `messagesreglages` |

## Essai manuel (serveur d'essai, données fictives)

1. Démarrer le serveur avec `ERP_MESSAGES_FACTICE=1` : les messages sont marqués envoyés sans partir ; le journal des envois les montre, sans texte ni numéro complet.
2. Ouvrir « Messages aux clients » : vérifier les types actifs et leur canal.
3. Passer une commande sur la Marketplace, la payer avec le prestataire factice, faire avancer le colis jusqu'à la livraison : lire le journal.
4. Ouvrir le lien d'avis d'un colis livré (après avoir avancé la date d'envoi dans un test), noter les articles, puis voir les avis sur la page publique de l'article.
