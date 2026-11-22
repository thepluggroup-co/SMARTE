# Implementation Plan: Paiement Mobile Money des commandes en ligne (lot 2)

**Branch**: `lot2-paiement-mobile-money` | **Date**: 2026-11-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-paiement-mobile-money/spec.md` ; besoin : `docs/Fiche technique globale GLOMARI.md`, section 9 (lot 2).

---

## Summary

Fermer la boucle du canal en ligne : le client lance le paiement Orange Money ou MTN MoMo de sa commande ; seul l'avis signé du prestataire la déclare payée. Dans une seule transaction, le système enchaîne des briques existantes : levée de la réservation, facture émise sur la branche avec sortie du stock du lieu, règlement qui crédite seul le portefeuille par défaut (ou les encaissements en attente), colis. Un paiement tardif ou en trop est encaissé et marqué « à rembourser », avec une tâche au trésorier. Le prestataire est une interface interchangeable : un factice signé par HMAC sert aux tests et à l'essai ; le vrai se branchera après le choix de la direction. Les ventes automatiques se font au nom du responsable de la boutique.

---

## Technical Context

**Language/Version**: TypeScript 5, Node.js 22

**Primary Dependencies**: Fastify 5, pg 8 ; `node:crypto` pour le HMAC. Aucune nouvelle dépendance.

**Storage**: PostgreSQL 16, migration `0048_paiement_en_ligne.sql` : tables `paiements_en_ligne` et `avis_paiement` ; `commandes_web` (état `a_rembourser`, `facture_id`, contrainte du colis levée) ; `config_canal.responsable_id`. Réutilisées : `reglements` et son déclencheur de trésorerie, `encaissements_en_attente`, `references_paiement`, `documents_vente`, `colis`, `taches`.

**Testing**: vitest 3, rôle restreint `erp_app`, prestataire factice, un fichier par parcours

**Target Platform**: serveur Linux (Docker), Node.js 22

**Project Type**: module d'un monolithe modulaire Fastify

**Performance Goals**: facture, sortie de stock et colis en moins d'une minute après l'avis (SC-002) ; traitement synchrone

**Constraints**: un avis non signé ne change jamais rien ; une transaction de l'opérateur ne se traite qu'une fois ; argent jamais perdu ; FCFA entiers ; identifiants seulement dans `.env` ; GTA et GLOMARI séparés

**Scale/Scope**: essai privé ; recette de 20 paiements de test

**Prerequisite**: lot 1 fusionné ; choix du prestataire réel par la direction seulement pour la mise en service réelle, pas pour ce lot

---

## Constitution Check

*`.specify/memory/constitution.md` est un modèle vide ; contrôle fait contre CLAUDE.md et la section 2 de la fiche.*

| Règle | Statut | Note |
|---|---|---|
| Ne jamais modifier une migration appliquée | ✅ | Migration 0048 ; la contrainte du lot 1 est levée par la nouvelle migration |
| RLS forcée, `cloison`, droits `erp_app`, clés composites | ✅ | Deux tables nouvelles ; `avis_paiement` en insertion seule |
| Droits vérifiés côté serveur, sur l'entité | ✅ | Routes internes sur la branche ; la vente automatique exige que le responsable ait `facturation.gerer` sur le lieu (contrôle de `emettre`) |
| Codes d'erreur dans `MESSAGES` | ✅ | 4 nouveaux |
| FCFA entiers | ✅ | Montants `bigint` ; facture égale au franc près grâce à `brutHt` |
| Sortie d'argent avec `tresorerie.gerer` | ✅ | Aucune sortie automatique : le remboursement reste manuel, par le trésorier |
| Paiements, factures validées figés | ✅ | Factures et règlements passent par les fonctions et déclencheurs existants |
| Paiement valide seulement sur avis signé (fiche, règle GLOMARI) | ✅ | Signature vérifiée sur le corps brut, comparaison en temps constant |
| Aucune clé dans le navigateur ni le code (fiche) | ✅ | Identifiants dans `.env` ; la Marketplace appelle depuis son serveur |
| Comptabilité : pas de remplacement de l'expert | ✅ | Note dans CLAUDE.md : écritures de ces encaissements à valider par l'expert-comptable |
| Noms de fichiers sans tiret ni tiret bas | ✅ | `paiementenligne.ts`, `tests/paiement*.test.ts` ; migration à la forme imposée |

**Résultat** : aucune violation.

---

## Project Structure

### Documentation (this feature)

```text
specs/002-paiement-mobile-money/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── routes-publiques.md
│   ├── routes-internes.md
│   └── prestataire.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
migrations/
└── 0048_paiement_en_ligne.sql   # paiements_en_ligne, avis_paiement, commandes_web, config_canal

src/
├── paiementenligne.ts           # interface, prestataire factice, routes payer et avis, vente automatique, rapprochement
├── facturation.ts               # creerBrouillon et emettre exportés ; LigneSaisie.brutHt
├── canalenligne.ts              # responsable de la boutique, détail de commande complété
├── serveur.ts                   # option prestatairesPaiement, enregistrement
└── index.ts                     # prestataire factice si ERP_PAIEMENT_FACTICE_SECRET

public/
├── canalenligne.js              # paiement, facture, « Terminer la vente », onglet « Paiements en ligne »
└── app.js                       # MESSAGES

tests/
├── paiementoutils.ts            # boutique avec responsable, portefeuilles, avis signés
├── paiementvente.test.ts        # P1, P2, P6, P10, P12
├── paiementavis.test.ts         # P3, P4, P5, P11, P13
└── paiementrembourser.test.ts   # P7, P8, P9
```

**Structure Decision**: monolithe modulaire ; un fichier de domaine dans `src/`, enregistré dans `src/serveur.ts`, comme `src/canalenligne.ts`.

---

## Complexity Tracking

| Choix | Pourquoi | Alternative écartée |
|---|---|---|
| Sous-contexte Fastify qui lit le JSON comme texte pour la seule route d'avis | La signature se vérifie sur les octets reçus | Ressérialiser le JSON analysé : la signature ne correspondrait plus |
| Point de sauvegarde dans la transaction de l'avis | Garder le paiement enregistré si la facture ne peut pas être émise | Tout annuler : l'opérateur a déjà débité le client |
| Exporter `creerBrouillon` et `emettre` | Une seule règle de facture, sans session | Dupliquer la facturation ; `app.inject` qui exige un jeton |
| Responsable de la boutique comme auteur | Colonnes `cree_par` et `encaisse_par` obligatoires, droit vérifié par `emettre` | Compte technique (nouvelle surface d'attaque) ; colonnes facultatives (traçabilité affaiblie) |
