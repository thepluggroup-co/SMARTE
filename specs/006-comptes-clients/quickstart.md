# Quickstart : vérifier les comptes clients (lot 4, partie B)

## Prérequis

- Lot 4A fusionné (demande n° 9) : l'envoi des SMS et le prestataire factice.
- Contrôle GitHub `verification.yml` : PostgreSQL 16, rôle `erp_proprio`, tests avec le rôle restreint `erp_app`. Ce poste n'a ni PostgreSQL ni Docker : les tests tournent dans GitHub Actions.

```sh
npm ci
npx tsc --noEmit
TEST_ADMIN_URL=postgres://erp_proprio:erp_proprio@localhost:5432/postgres npm test
```

## Mise en place commune des tests

`tests/comptesoutils.ts` réutilise `tests/messagesoutils.ts` (prestataire de messages factice) et ajoute :

- `demanderCode(numero)` et `codeRecu(numero)` (dernier code lu dans le prestataire factice) ;
- `connecter(numero, nom?)` : demande et saisie du code, rend le jeton ;
- `client(jeton)` : appels aux routes du compte avec `Authorization: Client <jeton>`.

Les routes sont décrites dans [routes.md](./contracts/routes.md), et les tables dans [data-model.md](./data-model.md).

## Scénarios

| N° | Scénario | Résultat attendu | Fichier |
| --- | --- | --- | --- |
| Q1 | Code demandé pour un numéro connu et pour un numéro inconnu | même réponse ; un SMS à six chiffres chacun, à 23 h comme à 10 h ; aucun code en base en clair | `comptesconnexion` |
| Q2 | Mauvais code, puis bon code ; bon code réutilisé | `401 code_incorrect` avec 4 essais restants ; connexion ; `401 code_expire` | `comptesconnexion` |
| Q3 | Cinq codes faux, puis le bon | code invalidé : `401 code_expire` ; journal de blocage | `comptesconnexion` |
| Q4 | Deux demandes dans la minute ; quatre dans le quart d'heure ; onze dans la journée | `409 code_trop_tot` avec le délai ; un nouveau code invalide l'ancien | `comptesconnexion` |
| Q5 | Numéro inconnu : bon code sans nom, puis avec nom | `409 nom_requis`, code toujours valable ; fiche client créée dans la branche | `comptesconnexion` |
| Q6 | Numéro fixe ; prestataire en panne ; débit de la boutique dépassé | `400 numero_invalide` sans SMS ; `503 sms_indisponible` ; `429` | `comptesconnexion` |
| Q7 | Deux commandes et une précommande du client, une commande d'un autre | les siennes seulement, avec lignes et suivi du colis | `comptesespace` |
| Q8 | Précommande arrivée : solde depuis l'espace, puis paiement par le jeton rendu | commande du solde créée, payée, précommande soldée ; précommande d'un autre : `404` | `comptesespace` |
| Q9 | Cinq adresses, une sixième, changement du « par défaut », suppression, zone d'une autre branche | `409 adresses_max` ; une seule par défaut ; `400 zone_invalide` ; adresse d'un autre client : `404` ; nom et e-mail modifiés, téléphone non | `comptesadresses` |
| Q10 | Points gagnés et utilisés en caisse ; programme inactif | solde, valeur et mouvements exacts ; « non actif » ; points d'une fiche de GTA absents | `comptesfidelite` |
| Q11 | Deux appareils, déconnexion de tous ; session de plus de 7 jours ; équipe Care ; fiche archivée, fusionnée, téléphone changé | accès refusés (`401 session_invalide`) ; révocation tracée | `comptessessions` |
| Q12 | Code lu par le responsable technique pendant l'essai | avec le prestataire factice et `entites.gerer` : le code ; sans ce droit : `403` ; sans prestataire factice : `404` | `comptessessions` |
| Q13 | Autre organisation ; boutique fermée | jeton refusé hors de sa boutique ; espace client introuvable boutique fermée | `comptessessions` |

## Essai manuel (serveur d'essai, données fictives)

1. Démarrer le serveur avec `ERP_MESSAGES_FACTICE=1` et ouvrir la boutique en ligne.
2. Demander un code depuis la Marketplace (ou par la route `POST /marketplace/:org/compte/code`).
3. Lire le code dans « Messages aux clients » › « Code d'essai », avec un compte qui gère les entités.
4. Se connecter, consulter les commandes, enregistrer une adresse, puis « déconnecter tous mes appareils ».
