# Implementation Plan: Précommandes d'arrivage GLOMARI avec acompte (lot 3, partie A)

**Branch**: `lot3-precommandes` | **Date**: 2026-11-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-precommandes-arrivage/spec.md` ; besoin : `docs/Fiche technique globale GLOMARI.md`, section 9 (lot 3), règle R4, page W7.

---

## Summary

GLOMARI annonce un arrivage par une campagne : article, prix annoncé figé en hors taxes avec son taux, acompte par pièce, seuil, date limite, fournisseur et lieu de réception.

**Inscription.** Le client s'inscrit depuis la Marketplace et paie l'acompte par le circuit du lot 2 :

- même avis signé, même route d'avis ;
- `paiements_en_ligne` gagne une inscription à la place d'une commande ;
- l'acompte est encaissé dans le portefeuille comme une avance, sans facture.

**Seuil.** Sous le verrou de la campagne, le premier acompte qui atteint le seuil la déclenche une seule fois et crée un bon de commande en brouillon, au nom de l'auteur de la campagne. L'approbation reste humaine et séparée.

**Achats.** Trois points d'appel injectés dans les achats relient la campagne à son bon de commande :

- l'approbation refuse une quantité inférieure aux précommandes ;
- les étapes sont publiées aux inscrits ;
- la réception réserve le stock aux inscrits, dans l'ordre, chacun servi en entier.

**Solde.** L'inscrit paie le solde par une commande en ligne qui porte l'acompte. La vente automatique du lot 2 émet la facture du total, l'impute une seule fois par un règlement relié à l'acompte (sans nouvel encaissement, garanti par un index unique), sort le stock et crée le colis.

**Annulation, seuil manqué, retrait.** Ces cas rendent chaque acompte « à rembourser ». Le trésorier enregistre la sortie d'argent par une route unique, avec son droit. Le solde non payé à temps laisse l'acompte à GLOMARI (décision du 22 novembre 2026).

**Comptabilité.** Elle reçoit les écritures proposées (avances clients 4191, produits divers 758), à valider par l'expert-comptable.

---

## Technical Context

**Language/Version**: TypeScript 5, Node.js 22

**Primary Dependencies**: Fastify 5, pg 8. Aucune nouvelle dépendance.

**Storage**: PostgreSQL 16, migration `0049_precommandes.sql` :

- tables nouvelles : `campagnes_arrivage`, `inscriptions_precommande` ;
- tables modifiées : `paiements_en_ligne`, `commandes_web`, `reservations_stock`, `reglements` (avec le déclencheur `tresorerie_reglement`), `mouvements_portefeuille` (index unique des remboursements) ;
- réutilisées : `commandes_achat`, `lignes_achat`, `etapes_achat`, `documents_vente`, `colis`, `taches`, `encaissements_en_attente`, `references_paiement`.

**Testing**: vitest 3, rôle restreint `erp_app`, prestataire factice, un fichier par parcours et une recette complète

**Target Platform**: serveur Linux (Docker), Node.js 22

**Project Type**: module d'un monolithe modulaire Fastify, écran en JavaScript sans framework

**Performance Goals**:

- étape visible sur le lien de suivi en moins d'une minute (SC-007), car le traitement est synchrone ;
- annulation : tous les remboursements préparés en moins d'une minute (SC-005) ;
- balayage chaque minute.

**Constraints**:

- jamais deux bons de commande par campagne ;
- un acompte n'est compté qu'une fois ;
- argent jamais perdu ;
- FCFA entiers ;
- sortie d'argent avec `tresorerie.gerer` ;
- GTA et GLOMARI séparés ;
- aucune quantité, aucun fournisseur ni prix d'achat dans les routes publiques.

**Scale/Scope**: essai privé ; recette d'une campagne complète

**Prerequisite**: lots 1 et 2 fusionnés (demande n° 6) ; prestataire réel seulement pour la mise en service réelle

---

## Constitution Check

*`.specify/memory/constitution.md` est un modèle vide ; contrôle fait contre CLAUDE.md et la section 2 de la fiche.*

| Règle | Statut | Note |
|---|---|---|
| Ne jamais modifier une migration appliquée | ✅ | Migration 0049 ; les contraintes de 0030, 0046 et 0048 sont remplacées par la nouvelle migration |
| RLS forcée, `cloison`, droits `erp_app`, clés composites | ✅ | Deux tables nouvelles, déclencheur d'audit |
| Droits vérifiés côté serveur, sur l'entité | ✅ | `achats.gerer` et `achats.voir` (ou `facturation.voir`) sur la branche et le lieu ; `tresorerie.gerer` sur la branche ; le brouillon automatique revérifie le droit de son auteur |
| GTA formations, GLOMARI stocks | ✅ | Droits `achats.*` liés au module de stock ; boutique et lieu de GLOMARI exigés ; test « GTA ne voit rien » |
| Fichiers clients séparés par branche | ✅ | Fiche retrouvée par téléphone dans la branche de la boutique (règle du lot 1) |
| Codes d'erreur dans `MESSAGES` | ✅ | Une quinzaine de nouveaux codes listés dans les contrats |
| FCFA entiers | ✅ | `bigint` ; prix HT exact pour un TTC annoncé (R4) |
| Sortie d'argent avec `tresorerie.gerer` | ✅ | Remboursement seulement par le trésorier, tracé, une fois ; aucune sortie automatique |
| Paiements et factures figés | ✅ | Règlements insérés, jamais modifiés ; annulation d'un règlement d'acompte refusée |
| Paiement valide seulement sur avis signé (fiche) | ✅ | Circuit du lot 2 réutilisé tel quel |
| Comptabilité : pas de remplacement de l'expert | ✅ | Écritures proposées, à valider ; note dans CLAUDE.md |
| Ne jamais demander de mot de passe ; aucun secret dans le code | ✅ | Rien de nouveau dans `.env` |
| Noms de fichiers sans tiret ni tiret bas | ✅ | `precommandes.ts`, `precommandes.js`, `tests/precommandes*.test.ts` ; migration à la forme imposée |

**Résultat** : aucune violation. Après la conception (Phase 1), le contrôle reste sans violation.

---

## Project Structure

### Documentation (this feature)

```text
specs/003-precommandes-arrivage/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── routes-publiques.md
│   └── routes-internes.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
migrations/
└── 0049_precommandes.sql      # campagnes, inscriptions ; paiements_en_ligne, commandes_web, reservations_stock, reglements, mouvements_portefeuille

src/
├── precommandes.ts            # campagnes, inscriptions, routes publiques et internes, traiterAcompte, points d'appel achats, balayage
├── paiementenligne.ts         # payer l'acompte, aiguillage de l'avis, terminerVente avec acompte, remboursement, liste élargie
├── canalenligne.ts            # parBoutique, ficheClient et validation du mode de remise exportés au niveau du module
├── achats.ts                  # creerCommandeAchat exporté ; points d'appel approbation, étape, réception
├── performance.ts             # confierAuxTitulaires exporté (tâche par titulaire), repris du lot 2
├── facturation.ts             # annulation refusée pour un règlement d'acompte
├── comptabilite.ts            # quatre écritures proposées
├── plan_comptable.ts          # paramètres avances_clients (4191) et produits_divers (758)
├── rapports.ts, commerce.ts, finitions.ts, tableau.ts   # imputations et remboursements exclus des encaissements et des dépenses
└── serveur.ts                 # enregistrement, points d'appel injectés, balayage dans la minuterie d'une minute

public/
├── precommandes.js            # écran « Précommandes » : liste, création, détail, inscriptions, annulations, bon de commande
├── canalenligne.js            # bouton « Précommandes » ; remboursement dans « Paiements en ligne »
├── app.js                     # MESSAGES
├── index.html                 # script precommandes.js
└── sw.js                      # cache smarte-solutions-v4

tests/
├── precommandesoutils.ts
├── precommandesinscription.test.ts   # Q1 à Q4
├── precommandesseuil.test.ts         # Q5 à Q7
├── precommandesannulation.test.ts    # Q8 à Q11
├── precommandesreception.test.ts     # Q12 à Q15
├── precommandesetapes.test.ts        # Q16
├── precommandescompta.test.ts        # Q17
└── precommandesrecette.test.ts       # Q18

docs/
├── Couverture du cahier des charges.md, Fiche technique globale GLOMARI.md, Guide de mise en ligne.md
└── (CLAUDE.md à la racine : état et limites du lot 3A)
```

**Structure Decision**: monolithe modulaire. Un fichier de domaine `src/precommandes.ts`, enregistré dans `src/serveur.ts`, comme `canalenligne.ts` et `paiementenligne.ts`.

Les dépendances vont dans un seul sens :

- `paiementenligne` dépend de `precommandes` ;
- `precommandes` dépend de `achats`, `canalenligne` et `performance` ;
- `achats` ne connaît les précommandes que par les points d'appel injectés.

---

## Complexity Tracking

| Choix | Pourquoi | Alternative écartée |
|---|---|---|
| Points d'appel injectés dans `enregistrerAchats` | La réservation doit être dans la transaction de la réception, sans que les deux fichiers s'importent l'un l'autre | Événements traités après coup (pièces vendables entre les deux) ; déclencheurs SQL (règles cachées) |
| `paiements_en_ligne` partagée entre commande et inscription | Une seule adresse d'avis chez le prestataire, une seule unicité des transactions | Table d'acomptes séparée : seconde route d'avis, garanties recopiées |
| Règlement relié à l'acompte, sans encaissement | Facture au vrai total, reste dû juste partout, double imputation impossible par la base | Moyen « acompte » (rapports brouillés) ; ligne négative (total faux) |
| Déclencheur `tresorerie_reglement` remplacé | Ne pas encaisser deux fois l'argent de l'acompte | Encaisser puis contre-passer : deux mouvements inutiles, risque d'écart |
| Prix stocké hors taxes avec recherche du HT exact | La taxe s'arrondit par ligne : un TTC quelconque n'est pas toujours atteignable | Stocker le TTC : facture différente du montant payé |
| Route de remboursement commune aux paiements en ligne | Une sortie d'argent tracée et unique, aussi pour le lot 2 | Saisie libre d'une dépense : pas de lien, double remboursement possible |
| Écritures comptables proposées | L'argent des acomptes existe en trésorerie et doit exister en comptabilité | Silence comptable jusqu'à la facture |
