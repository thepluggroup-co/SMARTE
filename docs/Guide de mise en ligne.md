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
$C up -d application web
curl -f https://<domaine>/sante
```

Vider ensuite `SGC_ADMIN_MOT_DE_PASSE` dans `.env`. Conserver `ERP_CLE_SECRETS` hors du serveur : sans elle, les données chiffrées sont perdues. Se connecter, changer le mot de passe et activer la double authentification depuis « Mon compte ».

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
