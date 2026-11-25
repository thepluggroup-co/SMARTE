# Plan d’implémentation de la refonte UI/UX de SMARTE

**Fonctionnalité** — `008-refonte-interface-smarte`\
**Date** — 25 novembre 2026\
**Spécification** — [spec.md](spec.md)

## Résumé

Adopter une interface commune à GTA et GLOMARI à partir des maquettes v2 et du prototype référencés dans la spécification. Déployer le cadre de navigation et les deux accueils, valider un parcours métier complet par entité, puis migrer le reste de SMARTE par lots. Appliquer le bleu et vert à GTA, le violet et orange à GLOMARI, sur une grille et des composants communs.

## Contexte technique

- **Front-end** — Conserver le JavaScript natif, le HTML et le CSS actuels de `public/`. Réutiliser les fonctions de rendu, d’API, de formulaire et de tableau existantes. Aucune migration vers un framework ou une chaîne de compilation front-end.
- **Serveur et données** — Node.js 22, TypeScript, Fastify, PostgreSQL. Réutiliser les routes et permissions existantes. Aucun changement de schéma prévu. Si une donnée d’accueil manque, documenter la source et la permission avant de proposer une extension ciblée.
- **Navigation** — Centraliser les destinations, groupes, libellés et règles de visibilité autour des écrans existants. Le serveur reste l’autorité sur les droits et le périmètre. Restaurer uniquement un contexte encore autorisé.
- **Accessibilité et mouvement** — Prévoir les tailles de référence de 360 et 1 280 px, le focus visible, la navigation clavier et les transitions de 150 à 220 ms sans délai fonctionnel. Respecter `prefers-reduced-motion`.
- **Validation** — Vérification TypeScript et suite Vitest existante, puis recette navigateur, clavier, impression et caisse hors connexion. Voir [quickstart.md](quickstart.md).

## Vérification de la constitution

La constitution Spec Kit du clone contient les champs du modèle initial. Les règles métier documentées dans `CLAUDE.md` s’appliquent. La conception préserve la séparation GTA/GLOMARI, les contrôles serveur par entité, les sessions et la synchronisation de caisse. Il n’y a aucune exception à justifier avant ou après la conception.

## Structure du projet

| Zone | Rôle dans la refonte |
| --- | --- |
| `public/app.js`, `public/index.html` | Cadre de navigation, points d’entrée, contexte et rendu des écrans connectés |
| `public/style.css`, `public/finitions.js` | Variables de thème, charte d’entité, composants communs, modes sombre et impression |
| `public/tableau.js`, `public/gta.js`, `public/scolarite.js`, `public/canalenligne.js` | Accueils et premiers parcours métier |
| `public/caisse.js`, `public/sw.js` | Caisse, fonctionnement hors connexion et cohérence des versions du cache |
| Modules et pages autonomes de `public/` | Migration par famille d’écran, selon l’inventaire |
| `specs/008-refonte-interface-smarte/` | Spécification, plan, recherche, modèle d’état, contrat UI et recette. Le découpage exécutable sera produit dans `tasks.md`. |

## Lots de migration

| Lot | Périmètre | Critère de passage |
| --- | --- | --- |
| 0 · Inventaire et références | Recenser chaque destination, sous-écran, page autonome et sortie imprimable. Capturer les écrans types avant modification. Associer chaque entrée à un lot, un rôle, une entité, un modèle et un test. | Chaque point d’entrée actuel figure dans l’inventaire, y compris les écrans ouverts depuis une fiche. |
| 1 · Cadre commun et parcours pilotes | Thèmes, logos, en-tête, menu, recherche, composants, transitions et deux accueils. GTA, ouvrir une session et faire l’appel. GLOMARI, filtrer les commandes par magasin, puis ouvrir et refermer une fiche. | Les deux parcours passent avec des données de recette, sur ordinateur et mobile. Les écrans en attente restent accessibles sous le cadre commun. |
| 2 · GTA | Formations, inscriptions, apprenants, sessions, présences, pédagogie, cours en ligne et vues liées. | Les fonctions autorisées pour la scolarité, les formateurs et les apprenants restent accessibles et les écrans de l’inventaire sont vérifiés. |
| 3 · GLOMARI | Commandes, caisse, magasins, stocks, achats, livraisons, précommandes, catalogue, Care, avis et dépôts. | Les parcours magasin, préparation et caisse passent, dont une vente hors ligne suivie d’une synchronisation unique. |
| 4 · Transversal et vues autonomes | Finance, RH, pilotage, CRM, documents, administration, accès, portails et pages publiques encore à migrer. | Vérifier la marque, les droits, le clavier et l’impression selon le rôle et le type de page. |
| 5 · Recette complète | Réconcilier l’inventaire avec la navigation et les points d’entrée réels. Vérifier les deux thèmes, les modes clair et sombre, les droits, la caisse, l’impression et les captures par famille d’écran. | Satisfaire SC-001 à SC-006 de la spécification et documenter les résultats de recette. |

Les lots 2 à 4 utilisent les composants validés au lot 1. Chaque lot conserve des points d’entrée utilisables et peut être relu indépendamment. Garder les sélecteurs CSS historiques nécessaires jusqu’à la migration de leurs derniers écrans. Tout changement d’actif nécessaire hors connexion est livré avec la mise à jour du cache de cette version.

## Livrables de conception

- [Recherche et décisions](research.md)
- [Modèle d’état et de couverture](data-model.md)
- [Contrat d’interface](contracts/interface.md)
- [Guide de recette](quickstart.md)
