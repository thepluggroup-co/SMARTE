# Recette de la refonte

## Préparer

- Utiliser un environnement d’essai avec PostgreSQL et des données fictives. Préparer des comptes GTA, GLOMARI et multi-entités. Ouvrir une session de caisse pour le scénario hors ligne.
- Suivre le [démarrage local](../../README.md) pour configurer la base et les comptes. Démarrer ensuite `npm run dev`. Pour la suite Vitest, utiliser la base dédiée et le rôle restreint du contrôle GitHub.

```powershell
npm run verifier-types
npm test
```

## Exécuter les parcours

| Parcours | Vérification |
| --- | --- |
| GTA | Ouvrir les présences depuis l’accueil, ouvrir une session, faire l’appel et vérifier le retour avec le tri, les filtres et la position de liste. |
| GLOMARI | Sélectionner un magasin autorisé, ouvrir les commandes à préparer, consulter une fiche et vérifier la restauration du contexte. |
| Droits et changement d’espace | Ouvrir un écran par espace avec un compte multi-entités puis revenir à chacun. Répéter avec les comptes mono-entité et après révocation d’un accès. Pour chaque lot qui migre des écrans, vérifier les points d’entrée concernés avec un compte autorisé, puis avec un compte sans le droit nécessaire ou dont le droit a été révoqué. Vérifier la recherche, l’accès direct, la lecture d’une fiche et l’exécution d’une action côté serveur. Confirmer le refus sans divulgation ni modification des données. |
| Mobile et clavier | Répéter les parcours à 360 et 1 280 px. Tester le menu, le maintien du focus dans la fiche modale avec Tab et Maj+Tab, Échap et le retour au déclencheur. Pendant une transition active, déclencher une autre navigation et vérifier qu’elle répond immédiatement et que seul l’écran attendu s’affiche. Activer le mouvement réduit et contrôler les changements d’état. |
| Caisse | Après une ouverture en ligne, couper le réseau, enregistrer une vente prise en charge, rétablir le réseau et vérifier une synchronisation unique. Répéter après un changement de version du cache avec le parcours existant. |
| Impression et pages autonomes | Contrôler un document multi-page par entité, un reçu et des liens publics existants. Vérifier marques, montants, mentions, mise en page et absence de navigation sur l’impression. |
| Couverture | Reporter chaque résultat sur l’inventaire et conserver les captures représentatives. Pour SC-002, recruter au moins cinq participants par parcours et relever le taux de réussite au premier essai sans aide. Le seuil est de 80 % par parcours. Consigner aussi les résultats de SC-001 et SC-003 à SC-006. |

Les interactions attendues figurent dans le [contrat d’interface](contracts/interface.md).

## Captures et preuves locales

Les captures de référence utilisent les fichiers avant refonte ou la révision `HEAD` avec des réponses fictives. Les exemples intégrés utilisent les fichiers du clone avec des réponses fictives. Les rôles simulés sont le formateur GTA, le préparateur GLOMARI, le compte multi-entités et le caissier.

| Famille | Référence | Interface intégrée |
| --- | --- | --- |
| Accueil GTA | [Capture](<../../output/aperçus SMARTE/GTA actuel.png>) | [Capture](<../../output/recette-interface-008/GTA accueil intégré.png>) |
| Accueil GLOMARI | [Capture](<../../output/aperçus SMARTE/GLOMARI actuel.png>) | [Capture](<../../output/recette-interface-008/GLOMARI accueil intégré.png>) |
| Sessions GTA | [Capture](<../../output/recette-interface-008/GTA sessions référence.png>) | [Capture](<../../output/recette-interface-008/GTA liste des sessions.png>) |
| Commandes GLOMARI | [Capture](<../../output/recette-interface-008/GLOMARI commandes référence.png>) | [Capture](<../../output/recette-interface-008/GLOMARI commandes par magasin.png>) |
| Formulaire autonome | [Capture](<../../output/recette-interface-008/Formulaire public référence.png>) | [Capture](<../../output/recette-interface-008/Formulaire public intégré.png>) |
| Caisse | [Capture](<../../output/recette-interface-008/Caisse catalogue référence.png>) | [Capture](<../../output/recette-interface-008/Caisse catalogue et panier.png>) |
| Document imprimable | [Ticket de référence](<../../output/recette-interface-008/Caisse ticket référence.png>) | [Ticket PDF](<../../output/recette-interface-008/Caisse ticket provisoire.pdf>), [reçu GTA](<../../output/recette-interface-008/GTA impression A4.pdf>), [devis GLOMARI](<../../output/recette-interface-008/GLOMARI impression A4.pdf>) |

Le devis GLOMARI illustre la pagination sur quatre pages. Les exports A4 utilisent des logos de recette. Le contrôle Chromium du ticket a couvert les réglages 58 et 80 mm.

## Recette restante avant clôture

- **T021 et T026** — Reprendre les variantes de l’inventaire qui dépassent les contrôles d’ouverture. Consigner pour chacune le rôle utilisé, l’action essayée, le résultat et la preuve. Les contrôles prioritaires portent sur les parcours de scolarité et d’apprenant GTA, ainsi que sur les actions détaillées des précommandes, stocks et achats, catalogue, réseau et Service client GLOMARI.
- **T036 et SC-002** — Faire exécuter les parcours GTA et GLOMARI à au moins cinq utilisateurs représentatifs chacun. Pour chaque essai, noter le rôle, la réussite au premier essai sans aide et la difficulté observée. Calculer le taux séparément pour chaque parcours. L’objectif est d’au moins 80 % par parcours.
