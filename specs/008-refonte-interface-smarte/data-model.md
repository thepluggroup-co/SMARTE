# Modèle d’état et de couverture

Ce lot s’appuie sur les entités, rôles et données métier existants. Les nouveaux états sont des états d’interface.

| Élément | Champs | Règles |
| --- | --- | --- |
| Espace | Clé GTA ou GLOMARI, nom, logo, thème, destinations autorisées | Déterminé à partir de la session et des droits actuels. Une page autonome résout sa marque depuis son propre contexte. |
| Destination | Clé stable, groupe, titre, écran, condition d’accès | Une destination masquée ou interdite ne peut pas être restaurée. Les permissions du serveur restent nécessaires. |
| Contexte de navigation | Destination, identifiant de lieu, recherche, filtres, tri, page, repère de retour | Séparé par organisation, compte et espace pendant la session. Mémoriser des références et paramètres, limiter leur conservation à la session et les effacer à la déconnexion. |
| État de fiche | Destination parente, référence de fiche, référence du déclencheur | Au retour, réappliquer le contexte de liste et rendre le focus au déclencheur ou au titre si la ligne a disparu. |
| Entrée d’inventaire | Point d’entrée, module, espace, rôles, modèle d’écran, lot, scénario, état de validation | Inclure les vues autonomes, sous-écrans, états d’accès et variantes imprimables. Une entrée passe de recensée à migrée, puis à vérifiée. |

Au changement d’espace, sauvegarder le contexte courant, vérifier les droits sur la destination mémorisée et rouvrir l’accueil autorisé si nécessaire. Une réponse retardée de l’espace précédent ne doit pas mettre à jour le nouvel écran.
