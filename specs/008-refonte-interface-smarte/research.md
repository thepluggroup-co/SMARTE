# Recherche et décisions

| Sujet | Décision et raison | Variante examinée |
| --- | --- | --- |
| Adoption | Étendre `vue()` et les helpers existants pour conserver les points d’entrée et permettre une livraison par lots. Centraliser les destinations et leur visibilité en réutilisant les règles actuelles. | Réécriture front-end complète, qui obligerait à migrer les comportements métier en même temps. |
| Thèmes | Utiliser des variables CSS communes et appliquer le thème dans le cadre authentifié. Conserver la personnalisation de charte et la règle de repli du logo sur les documents. Donner aux pages autonomes le contexte de leur parcours public. | Dupliquer les feuilles de style par entité, ce qui accroîtrait les écarts de comportement. |
| Navigation | Garder une référence de destination et un contexte par espace pour la session. Conserver la garantie existante contre les réponses asynchrones obsolètes lors d’un changement d’écran. | Conserver des copies d’écrans, avec le risque d’afficher des données ou permissions périmées. |
| Recherche et lieux | La recherche générale actuelle prend une requête textuelle. Si la recherche traverse plusieurs entités pour un rôle multi-entités, étendre le périmètre côté serveur de façon compatible. Les commandes en ligne ont déjà un filtre de statut. Utiliser les lieux métier autorisés disponibles pour tout filtre magasin et valider le périmètre côté serveur. | Filtrer uniquement l’affichage après réception de résultats appartenant à plusieurs entités. |
| Compatibilité | Préserver les liens publics, les codes d’accès et les règles de caisse. Coordonner chaque modification d’actif hors ligne avec la version et la liste de fichiers de `public/sw.js`. Garder les impressions A4 et ticket. | Ajouter un cache générique pour les réponses réseau ou convertir les impressions en images. |
| Recette | Utiliser les contrôles existants et des scénarios navigateur documentés. Vérifier les comportements avec des comptes réels de recette et capturer les familles d’écran dans chaque thème pertinent. | Comparer uniquement les maquettes ou tester la cohérence sur un seul compte administrateur. |

Les sources de données et chemins métier seront confirmés dans l’inventaire. Un indicateur sans source autorisée ne sera rendu interactif qu’une fois sa destination et son périmètre définis.
