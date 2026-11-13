#!/bin/sh
# À lancer chaque nuit par cron sur le serveur. Garde 14 jours sur place : copier aussi le dossier ailleurs.
set -eu
cd "$(dirname "$0")/.."
jour=$(date +%Y%m%d%H%M)
mkdir -p sauvegardes
docker compose -f docker-compose.production.yml exec -T base sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "sauvegardes/erp-$jour.dump"
docker compose -f docker-compose.production.yml exec -T application tar czf - -C /medias . > "sauvegardes/medias-$jour.tgz"
test -s "sauvegardes/erp-$jour.dump"
find sauvegardes -type f -mtime +14 -delete
