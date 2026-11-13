# Smarte Solutions

ERP SaaS du Groupe Smart Global Concepts : système de gestion intégré, modulaire et multi locataire pour GLOMARI, GTA et les activités du groupe.
La référence fonctionnelle est le cahier des charges version 3.0 du 2 novembre 2026.
Les choix techniques sont expliqués dans [le dossier d'architecture](<docs/Dossier d architecture.md>).

**État actuel :** socle et module Formations, avec des écrans provisoires. Ce code n'a pas encore été relu par le responsable technique ni soumis à une revue de sécurité.

## Démarrer en local

Prérequis : Node.js 22 et Docker.

```bash
npm ci
cp .env.example .env      # puis remplacer les mots de passe
docker compose up -d
npm run migrer
npm run provisionner:sgc  # crée le groupe SGC et son administrateur
npm run dev               # puis ouvrir http://localhost:3000
```

## Vérifier

```bash
npm run verifier-types
TEST_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres npm test
```

Les tests utilisent une vraie base PostgreSQL et recréent la base `erp_test` à chaque lancement.

## Règles à respecter

- GTA gère les formations et GLOMARI les stocks. Un droit ne vaut que si le module de l'entité est actif, et le domaine de l'entité interdit d'activer le module de l'autre branche.
- Seul le super administrateur, sur toute l'organisation, donne et retire les accès.
- Toute nouvelle table de client porte `organisation_id`, active le cloisonnement et utilise des clés étrangères composites.
- L'application se connecte toujours avec le compte `erp_app`, jamais avec le compte d'administration.
- Toute requête authentifiée passe par `protege()`.
- Aucun secret dans le dépôt. Les comptes, clés et domaines restent au nom de SGC.
