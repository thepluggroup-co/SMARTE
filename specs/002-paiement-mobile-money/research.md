# Recherche : paiement Mobile Money des commandes en ligne (lot 2)

**Feature** : 002-paiement-mobile-money
**Phase** : 0
**Date** : 2026-11-22
**Sources** : `docs/Fiche technique globale GLOMARI.md` (section 9, lot 2 ; section 2, règles), CLAUDE.md, code du dépôt après le lot 1.

---

## 1. Ce qui existe déjà et que le lot 2 réutilise

| Besoin du lot 2 | Existant | Où |
|---|---|---|
| Encaisser dans le portefeuille par défaut du moyen | Un `reglements` inséré déclenche `tresorerie_encaisser()`, qui crédite le portefeuille par défaut de l'entité (ou de ses parents) pour le moyen | migrations 0016 (déclencheur `tresorerie` sur `reglements`), 0036 |
| Ne jamais perdre un encaissement sans portefeuille | `tresorerie_encaisser()` range alors l'argent dans `encaissements_en_attente` et l'écrit au journal ; le trésorier l'affecte ensuite | migration 0036 |
| Une référence d'opérateur ne sert qu'une fois | Déclencheur `reference_unique` sur `reglements` (table `references_paiement`, erreur `RP001`) | migration 0035 |
| Facture avec sortie de stock | `emettre(ctx, id, entrepotId)` : contrôle d'identité vendeur, sortie du stock du lieu (`sortirDuStock`, type `vente`), numérotation, événement `facture.emis` | `src/facturation.ts` l. 299 à 347 |
| Lignes de facture au franc près | `ecrireLignes` calcule par `calculerLigne`, accepte un prix imposé ; les frais de livraison sont des colonnes du document (`frais_livraison`, `taux_frais`) | `src/facturation.ts` l. 56 à 96 |
| Colis | `creerColis(ctx, …)` (extrait au lot 1) | `src/pilotage.ts` |
| Réservation et expiration | `leverReservations`, `expirerCommandesWeb` (`for update skip locked`) | `src/canalenligne.ts` |
| Tâche à quelqu'un | Table `taches` (`assigne_a`, `cree_par` obligatoires) ; `titulaires(c, permissions, entite)` | migration 0004 ; `src/performance.ts` l. 56 |
| Écritures comptables | La comptabilité lit `documents_vente` et `reglements` | `src/comptabilite.ts` l. 73 et 95 |
| Interface interchangeable | `GenerateurIa`, fonction injectée par `OptionsServeur`, réelle en production, remplacée dans les tests | `src/studio.ts` l. 8 ; `src/serveur.ts` l. 95 |

**Décision** : le lot 2 n'invente ni encaissement, ni sortie de stock, ni numérotation. Il enchaîne les briques existantes dans une seule transaction.

## 2. Au nom de qui, quand personne n'est connecté

L'avis de l'opérateur arrive sans session. Or `documents_vente.cree_par`, `reglements.encaisse_par` et `taches.cree_par` sont obligatoires, et `emettre` vérifie `facturation.gerer` sur le lieu pour l'utilisateur du contexte.

| Option | Pour | Contre |
|---|---|---|
| Rendre ces colonnes facultatives | Rien à configurer | Modifie trois tables et des règles d'immuabilité ; affaiblit la traçabilité partout |
| Compte technique par organisation | Clair dans le journal | Compte à créer, rôle à donner, connexion à interdire : nouvelle surface d'attaque |
| **Responsable de la boutique** | Une personne réelle, qui a déjà les droits ; rien de nouveau à sécuriser | Il faut le désigner |

**Décision** : `config_canal.responsable_id`, renseigné par la personne qui ouvre la boutique (`facturation.administrer`), qui peut le reprendre en rouvrant. Les documents automatiques portent son nom comme créateur et encaisseur. Le contexte de base de données ne définit pas d'acteur (`app.utilisateur_id` vide) : l'audit montre une action automatique, et `journal_evenement('canal.vente_automatique', …)` la décrit. Sans responsable, le paiement en ligne est indisponible.

## 3. Facture au franc près

Le total payé doit égaler le total de la facture, sinon le règlement dépasserait le reste dû. `ecrireLignes` recalcule une ligne à prix imposé par `calculerLigne(q, prix, 0, taux)` : juste pour un prix unitaire, faux d'un franc possible pour un article vendu par tranches (le total exact vient de `brutTranches`).

**Décision** : ajouter à `LigneSaisie` un champ interne facultatif `brutHt`, transmis à `calculerLigne` comme montant exact. Il n'est pas exposé par le schéma des routes. La facture reprend `lignes_commande_web.total_ht` et `taux_taxe` : HT, taxes et TTC sont identiques à la commande. Frais de livraison : `frais_livraison` du document, `taux_frais` à 0 (comme au lot 1).

## 4. Réutiliser la facturation sans passer par une route

`creerBrouillon` et `emettre` sont des fonctions internes à `enregistrerFacturation`, liées à `outils.exigerSurEntite`.

**Décision** : les sortir au niveau du module, exportées, avec `exigerSurEntite` en paramètre ; les routes existantes les appellent sans changer de comportement (la suite `tests/facturation.test.ts` le garantit). Écarté : `app.inject` (il faudrait un jeton de session) ; dupliquer la facturation (deux règles pour une même facture).

La facture est émise sur la **branche** (identité vendeur de GLOMARI, numéro `FAC-GLOMARI-AAAA-…`), avec `entrepotId` = lieu de la commande : le stock sort du lieu qui la sert.

## 5. Une seule transaction, et ne jamais perdre l'argent

Sur avis valide de réussite, dans une transaction, verrou `for update` sur le paiement puis sur la commande :

1. Paiement `reussi`, commande `payee`, événement `commande_web.payee`.
2. Point de sauvegarde `vente`, puis : levée des réservations, facture (brouillon puis `emettre`), règlement (le déclencheur encaisse), colis sauf retrait au magasin, commande `facturee`, événement `commande_web.facturee`.
3. Si l'étape 2 échoue (identité vendeur incomplète, droit retiré au responsable, stock passé en négatif par la caisse hors connexion) : retour au point de sauvegarde, la commande reste `payee` avec sa réservation, une tâche « vente à terminer » va aux titulaires de `facturation.administrer` de la branche, journal. Une route `POST /commandes-web/:id/terminer` (`facturation.gerer`) refait l'étape 2 une fois corrigé.

Dans ce cas, l'argent n'est encaissé qu'à la fin de la vente (le règlement crée l'encaissement) : il reste visible dans la liste des paiements en ligne. Écarté : encaisser tout de suite puis annuler à la fin (deux mouvements de trésorerie pour une vente).

## 6. Paiement tardif ou en trop

Commande `expiree`, `annulee`, ou déjà `payee` ou `facturee` (second paiement) :

- paiement `a_rembourser` avec son motif (`expiree`, `annulee`, `deja_payee`) ;
- commande `a_rembourser` si elle était expirée ou annulée (nouvel état, migration 0048), inchangée si elle était déjà payée ;
- argent encaissé tout de suite par `tresorerie_encaisser(org, branche, moyen, montant, libellé, référence, 'paiement_en_ligne', id)` : il est réellement sur le compte de l'opérateur, et le rapprochement doit le retrouver ;
- tâche à chaque titulaire de `tresorerie.gerer` de la branche (à défaut, au responsable de la boutique) ; journal ; événement `commande_web.a_rembourser`.

Le remboursement reste une sortie d'argent faite à la main par le trésorier (`tresorerie.gerer`), qui termine ensuite sa tâche.

Une commande encore `reservee` mais échue (balayage pas encore passé) est d'abord expirée dans la même transaction, puis traitée comme ci-dessus.

## 7. Course entre expiration et paiement

`expirerCommandesWeb` prend `for update skip locked` sur les commandes ; le traitement de l'avis prend `for update` (il attend). Si l'avis tient le verrou, le balayage passe son tour et retrouve ensuite une commande payée ; si le balayage le tient, l'avis attend et trouve une commande expirée. **Une seule issue**, sans code supplémentaire.

## 8. Avis rejoué, faux ou au mauvais montant

- **Signature** : chaque prestataire vérifie la sienne sur le **corps brut** de la requête. Fastify analyse le JSON avant le gestionnaire : la route d'avis est enregistrée dans un sous-contexte encapsulé qui lit `application/json` comme texte (`addContentTypeParser(..., { parseAs: "string" })`), sans toucher aux autres routes.
- **Rejeu** : `paiements_en_ligne` a une clé unique `(organisation_id, prestataire, reference_prestataire)` ; un avis pour un paiement déjà `reussi`, `echoue` ou `a_rembourser` est « déjà traité » (réponse 200 pour que l'opérateur cesse de renvoyer). La contrainte `references_paiement` du règlement est une seconde barrière.
- **Montant** : montant de l'avis ≠ montant du paiement lancé (= total de la commande) : refus, commande inchangée.
- **Trace** : chaque avis reçu est conservé dans `avis_paiement` avec son issue, y compris les refus.
- **Organisation** : l'adresse de rappel transmise au prestataire contient l'organisation (`/paiements/avis/:prestataire/:org`), ce qui ouvre la bonne organisation (RLS) ; la signature reste exigée. Écart à la fiche, qui écrit `/paiements/avis/:prestataire` : sans l'organisation, il faudrait chercher la référence dans toutes les organisations, ce que la RLS interdit.

## 9. Prestataire interchangeable

```ts
interface PrestatairePaiement {
  nom: string;                                  // « factice », puis le prestataire choisi
  moyens: ("orange_money" | "mtn_momo")[];
  initier(demande): Promise<{ referencePrestataire, instruction }>;
  verifierAvis(entetes, corpsBrut): AvisPaiement | null;   // null : signature invalide
}
```

- Injecté par `OptionsServeur.prestatairesPaiement` (liste), comme `generateurIa`.
- **Factice** : signature HMAC SHA-256 du corps avec un secret de configuration ; `initier` renvoie une référence `FACTICE-…` et l'instruction « valider sur le téléphone ». Il sert aux tests et à l'essai privé (données fictives), activé seulement par `ERP_PAIEMENT_FACTICE_SECRET` dans `.env`. Jamais avec de vraies données.
- **Réel** : un fichier par prestataire, ajouté quand la direction aura choisi (opérateurs en direct ou agrégateur). Identifiants dans `.env`, jamais dans le code ni le navigateur.
- Sans prestataire pour le moyen de la commande, ou sans responsable de boutique : `503 paiement_indisponible`.
- `initier` appelle le réseau : il est appelé hors transaction, entre le contrôle de la commande et l'enregistrement du paiement lancé.

## 10. Rapprochement

`GET /paiements-en-ligne?jour=&moyen=&statut=` (`tresorerie.voir` ou `facturation.voir` sur la branche) : référence de l'opérateur, commande, facture, montant, mouvement de portefeuille ou encaissement en attente, et total. La recette « 20 paiements rapprochés au franc près » se vérifie par cette liste, comparée à la somme des avis.

## 11. Nommage, migration, événements

- Fichier `src/paiementenligne.ts` (sans tiret bas, décision du 21 novembre 2026 ; la fiche écrit `src/paiement_en_ligne.ts`).
- Migration `0048_paiement_en_ligne.sql` : la 0047 a servi à l'import des clients. La fiche prévoyait 0047 pour le lot 3 : il glissera aussi.
- Événements : `commande_web.payee`, `commande_web.facturee`, `commande_web.a_rembourser`.
- Codes d'erreur nouveaux : `paiement_indisponible`, `paiement_impossible`, `avis_refuse`, `vente_deja_terminee`.

## 12. Hors lot 2

Remboursement automatique, notifications (lot 4), précommandes et acomptes (lot 3), prestataire réel (attend la décision de la direction), double authentification obligatoire (reportée le 22 novembre 2026, reste activable par chacun).
