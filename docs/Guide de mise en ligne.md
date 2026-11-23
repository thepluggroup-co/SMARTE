# Guide de mise en ligne d'essai

Pour le développeur. Le serveur vise un essai sur GTA, pas encore la production de tout le groupe.

## Avant de commencer

1. Relire puis fusionner la demande unique vers `main`.
2. Serveur Linux avec Docker, 2 vCPU et 4 Go de mémoire au moins, ports 80 et 443 ouverts. Aucun mot de passe n'est à transmettre à Claude.
3. Un sous-domaine, par exemple `erp.smartecoaching.com`, pointant vers le serveur.

## Installation

```sh
git clone <dépôt> erp && cd erp
cp .env.production.exemple .env     # remplir : mots de passe avec openssl rand -hex 32
C="docker compose -f docker-compose.production.yml"
$C --profile outils build
$C up -d base
$C run --rm migration
$C run --rm provisionnement
$C run --rm provisionnement node --import tsx scripts/provisionnerglomari.ts   # lieux de GLOMARI, relançable
$C up -d application web
curl -f https://<domaine>/sante
```

La deuxième commande de provisionnement crée sous GLOMARI les lieux « GLOMARI Mall Douala », « Entrepôt GLOMARI Mall Douala » et « Agence de Yaoundé » ; relancée, elle ne recrée rien (en local : `npm run provisionner:glomari`). Vider ensuite `SGC_ADMIN_MOT_DE_PASSE` dans `.env`. Conserver `ERP_CLE_SECRETS` hors du serveur : sans elle, les données chiffrées sont perdues. Se connecter, changer le mot de passe et activer la double authentification depuis « Mon compte ».

## Paiement en ligne (Marketplace)

- Avant d'ouvrir le paiement Mobile Money : dans Trésorerie, régler les portefeuilles par défaut Orange Money et MTN MoMo de la branche GLOMARI ; ouvrir la boutique en ligne avec la personne qui sera responsable des ventes automatiques ; vérifier l'identité vendeur (raison sociale, NIU) de la branche.
- Essai privé, données fictives seulement : `ERP_PAIEMENT_FACTICE_SECRET` (générer avec `openssl rand -hex 32`) active le prestataire factice. Ne jamais le définir avec de vraies données : quiconque connaît ce secret peut simuler un paiement.
- Le prestataire réel se branche après le choix de la direction ; ses identifiants vont dans `.env`, jamais dans le dépôt.
- Avant l'ouverture au public, relever `ERP_CANAL_COMMANDES_PAR_MINUTE` et `ERP_CANAL_PAIEMENTS_PAR_MINUTE` : le serveur de la Marketplace appelle l'ERP depuis une seule adresse.

## Précommandes (lot 3A)

- Les acomptes passent par le paiement en ligne : mêmes portefeuilles par défaut Orange Money et MTN MoMo, même prestataire. Essai privé avec le prestataire factice seulement.
- Avant l'ouverture au public, faire relire par un juriste le texte des conditions montré au client (solde à payer dans le délai, acompte conservé sinon, remboursement si la campagne est annulée).
- Activer la séparation des tâches pour les commandes (« Accès » › séparation) : le bon de commande préparé au seuil est au nom de l'auteur de la campagne, une autre personne l'approuve.
- Le trésorier enregistre chaque remboursement depuis « Paiements en ligne » après avoir rendu l'argent par l'opérateur ; un acompte encore dans les encaissements en attente se place d'abord dans un portefeuille.

## Achats à l'import (lot 3B)

- Avant de commander en yuans, dollars ou euros : la comptabilité enregistre le taux du jour (Comptabilité › Devises). Sans taux connu à la date de la commande, ou avant, la commande est refusée.
- Les acomptes au fabricant se versent depuis le détail du bon de commande approuvé, par une personne qui a le rôle Trésorier (droit `tresorerie.gerer`). Payer une facture fournisseur demande désormais aussi ce droit : donner le rôle Trésorier à qui paie les fournisseurs.
- Activer la séparation des tâches pour les factures fournisseurs (« Accès » › séparation) : celui qui saisit la facture du fabricant n'est pas celui qui la valide, et c'est la validation qui impute les acomptes.
- Dépôt-vente : déclarer l'article (rôle Achats), enregistrer l'arrivée de la marchandise confiée (magasinier), puis établir chaque mois le relevé du fournisseur (comptable) ; la facture créée se valide et se paie en comptabilité.
- Couverture de stock : calculée chaque nuit après 2 h ; les acheteurs et responsables du stock voient la notification le matin. Les tâches planifiées doivent donc tourner sur le serveur.
- Faire confirmer par l'expert-comptable les comptes 4091 (avances fournisseurs) et 6011 (relevés de dépôt-vente) avant de vraies données : le système ne remplace pas un expert agréé.

## Sauvegardes

```cron
30 2 * * * /chemin/erp/scripts/sauvegarde.sh
```

Copier le dossier `sauvegardes` chiffré vers un autre lieu. Essayer la restauration sur une base vide avant d'accueillir des données réelles :

```sh
$C exec -T base pg_restore -U erp_proprio -d erp --clean --if-exists /sauvegardes/<fichier>
```

## Mise à jour

Faire une sauvegarde, puis :

```sh
C="docker compose -f docker-compose.production.yml"
git pull
$C --profile outils build
$C run --rm migration
$C up -d application
```

## À vérifier avant des données réelles

- [ ] Connexion en https, double authentification activée pour le super administrateur
- [ ] Restauration d'une sauvegarde réussie
- [ ] Pare-feu : seuls les ports 80, 443 et l'accès d'administration sont ouverts
- [ ] Le port de l'application n'est pas joignable sans passer par Caddy : un en-tête X-Forwarded-For envoyé à la main ne change pas l'adresse enregistrée
- [ ] Une seule instance de l'application (tâches planifiées et quotas en mémoire)
- [ ] Plan comptable, DSF et paie validés par l'expert-comptable
- [ ] Test d'intrusion avant toute ouverture au-delà de l'essai
- [ ] Formation E-commerce saisie et essayée en parallèle du suivi actuel
