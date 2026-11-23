# Implementation Plan: Achats à l'import de GLOMARI (lot 3, partie B)

**Branch**: `lot3b-achats-import` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-achats-import/spec.md` ; besoin : `docs/Fiche technique globale GLOMARI.md`, section 9 (lot 3), règles R5 et R11.

---

## Summary

Quatre ajouts autour des achats existants.

1. **Acomptes fournisseurs** (R5) :
   - le trésorier verse un ou plusieurs acomptes sur un bon de commande approuvé ; chacun est une sortie d'argent tracée, avec le droit de trésorerie ;
   - à la validation de la facture reliée, les acomptes s'imputent seuls : un paiement de la facture relié à l'acompte, sans nouvelle sortie ;
   - un déclencheur interdit d'imputer plus que l'acompte ; les restes à payer existants restent justes sans retouche.
2. **Achats en devise** (USD, CNY, EUR) :
   - le taux du jour de commande est pris dans la table existante, et chaque ligne garde son prix en devise ;
   - le total se calcule en FCFA exacts (entiers), et le prix unitaire en FCFA alimente le coût et les marges ;
   - le taux est figé de fait à l'approbation.
3. **Dépôt-vente** :
   - un article confié par un fournisseur, avec une rémunération datée (prix fixe ou commission) ;
   - le stock entre au coût 0, sans valeur pour GLOMARI ;
   - le relevé se calcule sur les ventes déjà enregistrées (caisse, factures donc Marketplace, retours, avoirs), une vente une seule fois ; il crée une facture fournisseur en brouillon, payée par le circuit habituel.
4. **Couverture de stock** (R11) : calcul quotidien par catégorie à partir des sorties « vente », notification unique au franchissement de 60 jours, avertissement non bloquant à l'approbation d'une commande.

La comptabilité reçoit les écritures proposées (4091, 6011), à valider par l'expert-comptable. Aucune option de coefficient d'importation (décision du 23 novembre 2026).

---

## Technical Context

**Language/Version**: TypeScript 5, Node.js 22

**Primary Dependencies**: Fastify 5, pg 8. Aucune nouvelle dépendance (`BigInt` natif pour la conversion exacte).

**Storage**: PostgreSQL 16, migration `0050_achats_import.sql` :

- tables nouvelles : `acomptes_fournisseur`, `articles_depot`, `remunerations_depot`, `releves_depot`, `lignes_releve_depot`, `alertes_couverture` ;
- colonnes ajoutées : `commandes_achat.devise`, `taux`, `taux_jour` ; `lignes_achat.prix_devise` ; `paiements_fournisseur.acompte_id` avec son déclencheur ;
- fonction `remuneration_depot` ;
- réutilisées : `taux_change`, `factures_fournisseur`, `mouvements_portefeuille`, `mouvements_stock`, lignes de caisse, de retour et de facture, `notifications_personnes`.

**Testing**: vitest 3, rôle restreint `erp_app`, un fichier par parcours et un fichier comptable

**Target Platform**: serveur Linux (Docker), Node.js 22

**Project Type**: modules d'un monolithe modulaire Fastify, écrans en JavaScript sans framework

**Performance Goals** :

- calcul de couverture quotidien, en une requête agrégée par branche ;
- relevé calculé à la demande sur une période ;
- volumes d'essai.

**Constraints** :

- sortie d'argent avec `tresorerie.gerer` ;
- un acompte n'est jamais imputé au-delà de son montant ;
- une vente n'entre que dans un seul relevé ;
- FCFA entiers ;
- GTA et GLOMARI séparés ;
- aucune notification en double.

**Scale/Scope**: essai privé

**Prerequisite**: lot 3A fusionné (demande n° 7) ; taux de change saisis par la comptabilité

---

## Constitution Check

*`.specify/memory/constitution.md` est un modèle vide ; contrôle fait contre CLAUDE.md et la section 2 de la fiche.*

| Règle | Statut | Note |
|---|---|---|
| Ne jamais modifier une migration appliquée | ✅ | Migration 0050 |
| RLS forcée, `cloison`, droits `erp_app`, clés composites | ✅ | Six tables nouvelles ; historique des rémunérations en insertion seule |
| Droits vérifiés côté serveur, sur l'entité | ✅ | `tresorerie.gerer` (acomptes), `achats.gerer` et `achats.voir`, `stocks.gerer` (lieu), `compta.saisir` (relevé) |
| GTA formations, GLOMARI stocks | ✅ | Droits liés au module de stock ; test GTA |
| Sortie d'argent avec `tresorerie.gerer` | ✅ | Acompte et son annulation ; le paiement des factures fournisseurs, qui ne demandait que `compta.valider`, exige désormais aussi `tresorerie.gerer` sur le portefeuille (research R14) ; le relevé ne sort pas d'argent |
| Paiements et factures figés | ✅ | Paiements insérés ou annulés, jamais modifiés ; facture validée inchangée |
| FCFA entiers | ✅ | Conversion exacte en `BigInt`, arrondi au franc |
| Codes d'erreur dans `MESSAGES` | ✅ | Une quinzaine de nouveaux codes |
| Comptabilité : pas de remplacement de l'expert | ✅ | Écritures proposées ; note dans CLAUDE.md |
| Noms de fichiers sans tiret ni tiret bas | ✅ | `acomptes.ts`, `depotvente.ts`, `couverture.ts`, `depotvente.js`, `tests/*.test.ts` |

**Résultat** : aucune violation. Après la conception (Phase 1), le contrôle reste sans violation.

---

## Project Structure

### Documentation (this feature)

```text
specs/004-achats-import/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── routes-internes.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
migrations/
└── 0050_achats_import.sql     # acomptes, devise, dépôt-vente, couverture, déclencheur, fonction

src/
├── acomptes.ts                # acomptes fournisseurs, annulation, imputerAcomptes
├── depotvente.ts              # articles, rémunérations, entrées, retours, aperçu, relevés
├── couverture.ts              # couvertures(), tâche quotidienne, GET /stocks/couverture, couverturePrevue()
├── achats.ts                  # devise dans ecrireLignes et la création ; refus article en dépôt ; annulation avec acompte ; acomptes et couverture dans le détail ; avertissement à l'approbation
├── fournisseurs.ts            # validation : imputerAcomptes ; annulation : imputations rendues
├── rapports.ts                # marge des articles en dépôt-vente (remuneration_depot)
├── tableau.ts                 # acomptes exclus des dépenses de GLOMARI
├── comptabilite.ts            # écritures : acompte, annulation, imputation
├── plan_comptable.ts          # avances_fournisseurs (4091), achats_marchandises (6011)
└── serveur.ts                 # enregistrement des trois modules

public/
├── gestion.js                 # commande : devise, acomptes, couverture prévue
├── depotvente.js              # écran « Dépôt-vente » : articles, entrées, retours, relevés
├── entrepots.js               # onglet « Couverture » du module Stocks
├── app.js                     # MESSAGES, menu
├── index.html                 # script depotvente.js
└── sw.js                      # cache smarte-solutions-v5

tests/
├── importoutils.ts
├── acomptes.test.ts           # Q1 à Q6, Q20
├── devises.test.ts            # Q7 à Q9
├── depotvente.test.ts         # Q10 à Q15
├── couverture.test.ts         # Q16 à Q18, Q20
└── achatsimportcompta.test.ts # Q19
```

**Structure Decision**: monolithe modulaire. Trois fichiers de domaine enregistrés dans `src/serveur.ts`. Les dépendances vont dans un seul sens :

- `fournisseurs` dépend de `acomptes` ;
- `achats` dépend de `couverture` ;
- les nouveaux modules lisent les achats en SQL, sans les importer.

---

## Complexity Tracking

| Choix | Pourquoi | Alternative écartée |
|---|---|---|
| Imputation comme paiement relié (`paiements_fournisseur.acompte_id`) | Restes à payer, échéancier et suivi du bon de commande justes sans retouche ; double imputation impossible par la base | Table d'imputations à part : chaque somme de paiements à corriger |
| Déclencheur `acompte_non_depasse` | Garantit en base qu'un acompte n'est jamais imputé au-delà de son montant, même en concurrence | Contrôle applicatif seul : une validation simultanée pourrait passer |
| Conversion en `BigInt` | Total exact au franc (SC-002) avec quantités au millième et prix à quatre décimales | Flottants : arrondis faux au-delà de 2⁵³ |
| Relevé calculé sur les ventes existantes, plus une table des lignes retenues | Aucun changement dans la caisse, la facturation ni les retours ; unicité par source | Déclencheurs sur chaque vente : nombreux points d'écriture, et la caisse hors connexion |
| Fonction SQL `remuneration_depot` | Une seule formule pour le relevé et la marge, rémunération lue à la date de la vente | Calcul recopié dans deux fichiers |
