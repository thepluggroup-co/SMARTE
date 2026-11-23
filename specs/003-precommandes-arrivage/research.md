# Research : Précommandes d'arrivage (lot 3A)

Décisions prises en lisant le code existant (lots 1 et 2, achats, trésorerie, comptabilité). Aucune inconnue ne reste ouverte.

## R1. Payer l'acompte avec le circuit du lot 2

- **Decision** : `paiements_en_ligne` reçoit une colonne `inscription_id` ; `commande_id` devient facultative, et l'une des deux exactement est renseignée. Le lancement passe par une route publique jumelle de celle des commandes (`POST /marketplace/:org/precommandes/:reference/payer`), dans `src/paiementenligne.ts`. L'avis arrive sur la route existante `/paiements/avis/:prestataire/:org`, puis `traiterAvis` aiguille vers `traiterAcompte` (exporté par `src/precommandes.ts`) quand le paiement porte une inscription.
- **Rationale** : le prestataire n'envoie ses avis qu'à une seule adresse. L'unicité `(prestataire, reference_prestataire)`, la signature vérifiée sur le corps brut, le montant exact et la trace dans `avis_paiement` valent ainsi pour l'acompte sans rien recopier (FR-007).
- **Alternatives considered** : une table et une route d'avis propres aux acomptes. Cela demandait une seconde adresse chez le prestataire et dupliquait toutes les garanties du lot 2.

## R2. Encaisser l'acompte sans facture

- **Decision** : à la validation de l'inscription, `tresorerie_encaisser(org, branche, moyen, montant, libellé, référence, 'paiement_en_ligne', paiement.id)`. L'argent va au portefeuille par défaut du moyen, sinon dans les encaissements en attente (comportement de 0036). Aucune facture, aucune vente.
- **Rationale** : même forme que le paiement « à rembourser » du lot 2 : un seul mouvement d'encaissement par paiement, retrouvable par `source_id`. L'acompte reste une avance du client (FR-031).
- **Alternatives considered** : une facture d'acompte. La facturation n'en a pas, et elle ferait compter l'acompte comme vente.

## R3. Imputer l'acompte une seule fois sur la facture finale

- **Decision** : la facture du solde est réglée par deux règlements. Le premier porte l'acompte : `reglements.acompte_id` référence le paiement de l'acompte, avec son moyen et sa référence d'opérateur. Le second porte le solde payé en ligne. Le déclencheur `tresorerie_reglement` est remplacé pour ne rien encaisser quand `acompte_id` est renseigné, car l'argent est déjà dans le portefeuille. Un index unique `(organisation_id, acompte_id) where annule_le is null`, et la table `references_paiement` (moyen et référence de l'opérateur), empêchent toute seconde imputation. La route `/reglements/:id/annulation` refuse d'annuler un règlement d'acompte.
- **Rationale** : la facture garde son vrai total (le prix complet). Le reste dû, les relances et les états qui additionnent les règlements restent justes sans aucune modification. La base elle-même interdit le double comptage (SC-003).
- **Alternatives considered** :
  - un moyen « acompte » ajouté à `reglements.moyen` : il change la contrainte du moyen et brouille les rapports par moyen ;
  - une ligne négative sur la facture : le total de la facture devient faux ;
  - un avoir : ce n'est pas une annulation de vente.

## R4. Prix annoncé exact au franc près

- **Decision** : la campagne stocke `prix_ht` et `taux_taxe`, figés à la création. Le prix toutes taxes comprises (TTC) unitaire affiché est `calculerLigne(1, prix_ht, 0, taux)`. La personne saisit le TTC ; la route cherche le hors taxes (HT) entier qui donne exactement ce TTC. S'il n'existe pas, elle refuse (`prix_annonce_impossible`) en proposant les deux prix atteignables les plus proches. Le total d'une inscription vaut `calculerLigne(quantité, prix_ht, 0, taux)` ; il est figé sur l'inscription et affiché avant le paiement. La commande du solde reprend ces valeurs ligne pour ligne, et la facture les reçoit par `brutHt` : facture et commande sont égales au franc près, comme au lot 2.
- **Rationale** : la taxe s'arrondit ligne par ligne, en entiers. Avec 19,25 % de TVA, environ un TTC sur cinq ne peut être atteint par aucun HT entier. Sans TVA, le HT égale le TTC et tout tombe juste. La spécification (FR-021, SC-004) parle donc du « total de l'inscription ».
- **Alternatives considered** : stocker le TTC et recalculer le HT au moment de la facture. La facture pourrait différer de quelques francs du montant payé, et le lot 2 refuserait alors la vente automatique (`montant_facture_different`).

## R5. Seuil atteint : un seul bon de commande

- **Decision** : `traiterAcompte` verrouille la ligne de la campagne (`for update`) avant l'inscription. Le passage de « ouverte » à « déclenchée » ne se fait donc qu'une fois, et `campagnes_arrivage.commande_achat_id` est unique. Le brouillon est créé par `creerCommandeAchat`, extrait de `POST /achats/commandes` (comme `creerColis` au lot 1), au nom de la personne qui a créé la campagne : elle a le droit de gérer les achats sur le lieu de réception, vérifié à la création et de nouveau à ce moment. La création se fait sous un point de sauvegarde : en cas d'échec, l'acompte reste validé, la campagne reste déclenchée, une tâche va aux titulaires de `achats.gerer` et `POST /precommandes/campagnes/:id/bon-de-commande` crée le brouillon ensuite. La règle de séparation existante (`exigerSeparation`) fait approuver par une autre personne.
- **Rationale** : un avis de paiement ne doit jamais échouer à cause des achats. C'est le même schéma que la « vente à terminer » du lot 2 (FR-011, FR-012).
- **Alternatives considered** :
  - un compte technique comme auteur : nouvelle surface d'attaque ;
  - la création différée par une tâche planifiée : une fenêtre de temps sans bon de commande, et un risque de doublon.

## R6. Brancher les précommandes sur les achats sans dépendance circulaire

- **Decision** : `enregistrerAchats(app, outils, suivi)` reçoit trois points d'appel facultatifs, fournis par `src/serveur.ts` depuis `src/precommandes.ts` :
  - `approbation(ctx, commandeId)` : refuse si la quantité commandée de l'article est inférieure aux précommandes validées (FR-014) et publie l'étape « commandée » ;
  - `etape(ctx, commandeId, etape, date)` : publie `precommande.arrivage_etape` (FR-016) ;
  - `reception(ctx, commandeId, receptionId, statut)` : réserve le stock pour les inscrits (FR-018).
  Tous s'exécutent dans la transaction de la route d'achat.
- **Rationale** : `src/precommandes.ts` importe `creerCommandeAchat` depuis `src/achats.ts`. Si les achats importaient aussi les précommandes, les deux fichiers dépendraient l'un de l'autre. La réservation doit être dans la même transaction que l'entrée en stock, sinon la caisse pourrait vendre les pièces entre les deux.
- **Alternatives considered** :
  - écouter les événements `achat.recu` : ils sont traités après coup, hors transaction ;
  - des déclencheurs SQL pour la réservation : trop de règles métier cachées dans la base.

## R7. Réserver l'arrivage aux inscrits

- **Decision** : `reservations_stock.inscription_id` (nouvelle colonne). À chaque réception, le budget est la quantité reçue de l'article dans cette réception, bornée par `quantite_vendable` du lieu. Les inscriptions validées non servies sont servies en entier, par ordre de `validee_le`. On s'arrête au premier inscrit qu'on ne peut pas servir en entier ; le reste est en vente normale. Chaque inscrit servi reçoit son échéance `solde_avant = now() + délai`. La première réception ferme les inscriptions (`premiere_reception_le`). Quand le bon de commande passe à « reçue », les inscriptions validées non servies deviennent « à rembourser » (motif `non_servie`).
- **Rationale** : c'est la règle de la spécification (FR-018), sans fractionner un inscrit, donc sans acompte partiel à rembourser. La quantité vendable exclut déjà les réservations : caisse, Marketplace et facture ne peuvent pas prendre ces pièces (FR-019).
- **Alternatives considered** : servir partiellement le dernier inscrit. Cela demandait un remboursement partiel de l'acompte et compliquait le solde.

## R8. Payer le solde par une commande en ligne

- **Decision** : la route `POST /marketplace/:org/precommandes/:reference/solde` crée une commande en ligne avec `inscription_id` et `acompte`. Les lignes reprennent le prix de la campagne ; les frais de livraison et la validation du mode de remise réutilisent le lot 1. L'échéance `expire_le` vaut `solde_avant`, et la commande ne réserve rien elle-même : la réservation reste sur l'inscription. Le client paie ensuite par la route existante `/marketplace/:org/commandes/:reference/payer`, dont le montant devient `total_ttc − acompte`. `terminerVente` (lot 2) est complétée : elle lève la réservation de l'inscription avant `emettre`, insère le règlement d'acompte puis celui du solde, et passe l'inscription à « soldée ». Un nouveau choix du mode de remise annule la commande du solde non payée et en crée une autre, sans perdre la réservation.
- **Rationale** : facture, sortie de stock, colis, signature et paiement tardif sont déjà traités par les lots 1 et 2 ; seul l'acompte s'ajoute. Le paiement du solde à la livraison ou au comptoir n'est pas proposé (décision du 22 novembre 2026).
- **Alternatives considered** : une facture émise directement par les précommandes, hors commande en ligne. Elle dupliquait la vente automatique du lot 2.

## R9. Solde non payé à temps

- **Decision** : le balayage passe l'inscription servie dont `solde_avant` est dépassé à « acompte conservé », sauf si sa commande du solde a déjà un paiement réussi (vente « à terminer »). Il lève sa réservation, publie `precommande.acompte_conserve` et note l'opération au journal. La commande du solde éventuelle expire au même moment (même échéance). Un paiement du solde qui arrive ensuite suit le lot 2 : « à rembourser ».
- **Rationale** : choix d'Achille du 22 novembre 2026 (FR-023). Les conditions acceptées sont gardées sur l'inscription (FR-006a).
- **Alternatives considered** : aucune (décision de la direction).

## R10. Rembourser : une sortie d'argent tracée, une seule fois

- **Decision** : une route `POST /paiements-en-ligne/:id/remboursement` dans `src/paiementenligne.ts`, valable pour tout paiement en ligne « à rembourser » (acompte ou commande du lot 2). Elle demande `tresorerie.gerer` sur la branche. Elle retrouve le portefeuille qui a reçu l'encaissement (`source_id` du paiement) ; si l'argent est encore dans les encaissements en attente, elle refuse (`encaissement_a_placer`). Elle verrouille le portefeuille, refuse un solde insuffisant, écrit une sortie `source_type = 'remboursement_en_ligne'`, puis passe le paiement à « remboursé » (avec la date, l'auteur et la référence de l'opérateur) et l'inscription à « remboursée ». Un index unique partiel sur les mouvements de portefeuille (`type = 'sortie'`, `source_type = 'remboursement_en_ligne'`, `source_id`) interdit une seconde sortie.
- **Rationale** : la sortie d'argent exige `tresorerie.gerer` (CLAUDE.md, FR-029). Le lot 2 laissait ces remboursements à une saisie libre ; la même route les rend traçables.
- **Alternatives considered** : laisser le trésorier saisir une dépense libre. Rien ne relierait alors la dépense au paiement, et rien n'empêcherait un double remboursement.

## R11. Échéances : inscription en attente, date limite, délai du solde

- **Decision** : `expirerPrecommandes(c)`, sans effet si on la relance et prenant ses lignes en `skip locked`, fait trois choses :
  1. elle fait expirer les inscriptions en attente échues ;
  2. elle annule les campagnes ouvertes dont la date limite (une date, heure de Douala) est passée sans seuil atteint ;
  3. elle passe à « acompte conservé » les inscriptions servies dont l'échéance du solde est dépassée.
  Elle est appelée par la minuterie de 60 secondes qui expire déjà les commandes en ligne, par les tâches horaires, et au début des routes publiques et de la liste interne (comme au lot 1).
- **Rationale** : une inscription en attente retient sa quantité pendant 30 minutes (FR-008). La date limite et le seuil se croisent sous le verrou de la campagne : une seule issue.
- **Alternatives considered** : une tâche horaire seule. Elle laissait une quantité retenue jusqu'à une heure.

## R12. Droits

- **Decision** :
  - créer, modifier ou annuler une campagne, annuler une inscription, créer le bon de commande : `achats.gerer` sur la branche (et sur le lieu de réception à la création) ;
  - consulter : `achats.voir` ou `facturation.voir` sur la branche ;
  - approuver le bon de commande : `achats.approuver` existant, avec la séparation des tâches ;
  - rembourser : `tresorerie.gerer` sur la branche.
  La campagne exige une branche avec le module de stock et une boutique en ligne réglée ; le lieu de réception doit être un lieu servi en ligne.
- **Rationale** : un droit `achats.*` n'agit que là où le module de stock est actif (`moduleRequis`). GTA est donc exclu par construction (FR-004, FR-034), sans nouveau droit à attribuer.
- **Alternatives considered** : un nouveau droit `precommandes.gerer`. Il fallait l'ajouter aux rôles existants, alors que le bon de commande exige de toute façon le droit d'achat.

## R13. Ce que voit le public

- **Decision** :
  - la liste et le détail des campagnes donnent l'article, les photos (route existante), le prix TTC unitaire, l'acompte par pièce, la date limite, la progression en pour cent (plafonnée à 100), « seuil atteint », « complet » et le texte des conditions ;
  - jamais de quantité, de fournisseur, de prix d'achat ni de transitaire ;
  - le suivi par référence et jeton haché, comme au lot 1, ne montre ni nom ni téléphone ;
  - les étapes montrées sont la date d'approbation (« commandée ») puis les étapes du bon de commande, sans leur note.
- **Rationale** : spécification FR-005 et FR-017, fiche W7 (« jauge du seuil sans chiffre de stock fournisseur »).
- **Alternatives considered** : afficher « 32 sur 50 ». Ce serait la quantité demandée, une donnée commerciale.

## R14. Écritures proposées à l'expert-comptable

- **Decision** : `pieces()` (`src/comptabilite.ts`) propose quatre nouvelles écritures, à valider comme les autres :
  - encaissement d'un paiement en ligne sans facture (acompte ou paiement « à rembourser ») : débit du compte du moyen, crédit 4191 (Clients, avances et acomptes reçus) ;
  - remboursement : débit 4191, crédit du compte du moyen ;
  - acompte conservé : débit 4191, crédit 758 (Produits divers) ;
  - règlement d'imputation (`acompte_id`) : débit 4191, crédit 4111, à la place du compte du moyen.
  Nouveaux paramètres `avances_clients` (4191) et `produits_divers` (758) dans `PARAMETRES_DE_DEPART`, avec repli sur ces numéros pour une branche déjà initialisée.
- **Rationale** : sans ces propositions, l'argent des acomptes serait dans les portefeuilles mais absent de la comptabilité. Le système propose ; l'expert-comptable valide (FR-036). Le paiement « à rembourser » du lot 2 en profite.
- **Alternatives considered** : ne rien proposer et le noter dans CLAUDE.md. Un écart silencieux entre trésorerie et comptabilité.

## R15. Lectures existantes à ajuster

- **Decision** : les règlements d'imputation (`acompte_id`) ne sont pas de l'argent reçu ce jour-là. Ils sont exclus :
  - des encaissements par moyen du rapport (`src/rapports.ts`) ;
  - de l'indicateur « encaissements saisis » (`src/commerce.ts`) ;
  - de l'analyse « encaissements » (`src/finitions.ts`).
  Les remboursements en ligne (`remboursement_en_ligne`) sont exclus des dépenses du tableau de bord de GLOMARI (`src/tableau.ts`), comme les remboursements de retours de caisse. La liste « Paiements en ligne » montre aussi les acomptes et le statut « remboursé ».
- **Rationale** : un acompte n'est jamais compté deux fois, et rendre son argent à un client n'est pas une dépense.
- **Alternatives considered** : aucune.

## R16. Événements

- **Decision** :
  - `precommande.inscription_validee`, `precommande.seuil_atteint`, `precommande.arrivage_etape`, `precommande.arrivage_recu`, `precommande.acompte_conserve`, `precommande.campagne_annulee` (FR-035) ;
  - plus `precommande.a_rembourser` et `precommande.soldee`.
  Contenu : identifiants, références et étapes, sans nom ni téléphone. La commande du solde publie en plus ses événements `commande_web.*` du lot 2.
- **Rationale** : la Marketplace et les messages du lot 4 retrouvent le destinataire par la référence.

## R17. Tests

- **Decision** : vitest avec le rôle restreint `erp_app` et le prestataire factice, un fichier par parcours, plus un fichier de recette qui fait une campagne complète et vérifie l'égalité de SC-003. Les échéances se testent en reculant `date_limite`, `expire_le` ou `solde_avant` en SQL, puis en lançant le balayage. Les tests ne tournent que dans GitHub Actions (pas de PostgreSQL sur ce poste).
- **Rationale** : même méthode qu'aux lots 1 et 2.
