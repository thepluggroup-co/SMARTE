# Quickstart : vérifier les précommandes (lot 3A)

## Prérequis

- Lots 1 et 2 fusionnés (canal en ligne, paiement en ligne avec prestataire factice).
- Contrôle GitHub `verification.yml` : PostgreSQL 16, rôle `erp_proprio`, tests avec le rôle restreint `erp_app`. Ce poste n'a ni PostgreSQL ni Docker : les tests tournent dans GitHub Actions.

```sh
npm ci
npx tsc --noEmit
TEST_ADMIN_URL=postgres://erp_proprio:erp_proprio@localhost:5432/postgres npm test
```

## Mise en place commune des tests

`tests/precommandesoutils.ts` s'appuie sur `boutiquePayante` (lot 2) :

- un fournisseur ;
- un article sans stock ;
- une campagne, par exemple : prix 85 000 FCFA, acompte 30 %, seuil 5, date limite dans 10 jours ;
- des fonctions pour inscrire, payer l'acompte (avis signé du prestataire factice), approuver et recevoir le bon de commande, choisir le mode de remise et payer le solde ;
- une fonction pour lancer le balayage (`app.executerTaches`).

Les routes sont décrites dans [routes-publiques.md](./contracts/routes-publiques.md) et [routes-internes.md](./contracts/routes-internes.md), et les tables dans [data-model.md](./data-model.md).

## Scénarios

| N° | Scénario | Résultat attendu | Fichier |
|---|---|---|---|
| Q1 | Liste publique des campagnes | prix TTC, acompte, date, progression en %, aucun fournisseur, prix d'achat, quantité ni seuil chiffré | `precommandesinscription` |
| Q2 | Inscription de 2 pièces, puis avis signé de l'acompte | inscription « validée », portefeuille Orange Money + 51 000, progression 40 % ; l'avis rejoué 3 fois ne change rien | `precommandesinscription` |
| Q3 | Inscription sans accepter les conditions ; inscription non payée après 30 minutes | `400 conditions_non_acceptees` ; « expirée », hors progression | `precommandesinscription` |
| Q4 | Acompte tardif avec place libre, puis sans place | validée ; puis « à rembourser » (motif `complet`) avec tâche au trésorier | `precommandesinscription` |
| Q5 | Deux acomptes simultanés franchissent le seuil | campagne « déclenchée », un seul bon de commande en brouillon, relié | `precommandesseuil` |
| Q6 | Approbation pour moins que les pièces validées ; par l'auteur du brouillon | `409 quantite_inferieure_aux_precommandes` ; `409 separation_des_taches` si la règle est active | `precommandesseuil` |
| Q7 | Après approbation de 6 pièces pour 5 validées : demande de 2, puis de 1 | `409 campagne_complete` ; acceptée | `precommandesseuil` |
| Q8 | Date limite dépassée sous le seuil, puis balayage | campagne « annulée » (`seuil_non_atteint`), inscriptions « à rembourser », tâche avec la liste au trésorier | `precommandesannulation` |
| Q9 | Remboursement enregistré par le trésorier, puis une seconde fois ; par un utilisateur sans droit | sortie du portefeuille, statut « remboursé » ; `409 remboursement_impossible` ; `403` | `precommandesannulation` |
| Q10 | Retrait d'un client avant le seuil ; après le seuil | « à rembourser », progression en baisse ; `409 inscription_non_annulable` | `precommandesannulation` |
| Q11 | Utilisateur de GTA | aucune campagne, aucune inscription, création refusée | `precommandesannulation` |
| Q12 | Réception complète de l'arrivage | pièces réservées dans l'ordre, non vendables (disponibilité Marketplace, caisse), événement `arrivage_recu` | `precommandesreception` |
| Q13 | Solde choisi en livraison, puis payé | facture = total de l'inscription + frais ; règlement d'acompte + règlement du solde ; portefeuille + solde seulement ; stock sorti ; colis ; « soldée » | `precommandesreception` |
| Q14 | Réception partielle ; surplus | premiers servis en entier, les suivants attendent ; surplus en vente normale | `precommandesreception` |
| Q15 | Délai du solde passé ; paiement du solde ensuite | « acompte conservé », pièces remises en vente ; paiement « à rembourser » | `precommandesreception` |
| Q16 | Étapes enregistrées sur le bon de commande | 3 événements `arrivage_etape` ; étapes et dates sur le lien de suivi, sans fournisseur ni note | `precommandesetapes` |
| Q17 | Écritures proposées | acompte : 552 / 4191 ; imputation : 4191 / 4111 ; remboursement : 4191 / 552 ; conservé : 4191 / 758 | `precommandescompta` |
| Q18 | Recette : campagne complète de 3 inscrits jusqu'aux colis | campagne « livrée », égalité SC-003 vérifiée au franc près | `precommandesrecette` |

## Essai manuel (serveur d'essai, données fictives)

1. Avec `ERP_PAIEMENT_FACTICE_SECRET` défini, régler les portefeuilles par défaut Orange Money et MTN MoMo de GLOMARI, puis ouvrir la boutique.
2. Créer un fournisseur et un article, puis une campagne depuis l'écran « Précommandes » (module Commerce, à côté des commandes en ligne).
3. Inscrire deux clients et payer leurs acomptes en envoyant des avis signés avec le secret factice.
4. Approuver le bon de commande avec une autre personne, puis enregistrer « expédiée » et la réception.
5. Ouvrir le lien de suivi d'un inscrit, choisir le retrait, payer le solde : vérifier la facture et le règlement d'acompte dans la facturation.
6. Pour une autre campagne : annuler, puis enregistrer le remboursement depuis « Paiements en ligne ».

Ne jamais faire cet essai avec de vraies données : le prestataire factice permet à quiconque connaît son secret de simuler un paiement.
