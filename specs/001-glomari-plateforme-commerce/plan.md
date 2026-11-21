# Implementation Plan: Module canal en ligne GLOMARI (lot 1)

**Branch**: `lot1-canal-en-ligne` | **Date**: 2026-11-21 (révisé après `/speckit-analyze`) | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-glomari-plateforme-commerce/spec.md` ; besoin du lot 1 : `docs/Fiche technique globale GLOMARI.md`, sections 2, 5, 6 et 9.

---

## Summary

Ajouter à SMARTE les routes publiques que la Marketplace GLOMARI appellera (`/marketplace/:org/catalogue`, `/disponibilite`, `/zones`, `/commandes`, suivi par référence et jeton haché), et l'écran interne « Commandes en ligne ». Une commande retrouve ou crée la fiche client par téléphone, recalcule les prix comme la caisse et réserve sous verrou le stock du lieu qui la sert ; elle expire seule (30 minutes en Mobile Money, 24 heures en paiement à la livraison) ou se confirme pour un paiement à la livraison, ce qui crée le colis « à encaisser ». Les zones, points relais, colis et fiches clients existants sont réutilisés. Des déclencheurs publient `stock.disponibilite_modifiee` et `catalogue.article_modifie` pour tenir la Marketplace à jour. Pas de paiement en ligne (lot 2).

---

## Technical Context

**Language/Version**: TypeScript 5, Node.js 22

**Primary Dependencies**: Fastify 5, pg 8 (aucune nouvelle dépendance)

**Storage**: PostgreSQL 16 — migration `0046_canal_en_ligne.sql` : 4 tables nouvelles (`config_canal`, `lieux_canal`, `commandes_web`, `lignes_commande_web`), `reservations_stock` modifiée, fonction `quantite_vendable()`, déclencheurs d'événements. Réutilisées : `zones_livraison`, `points_relais`, `colis`, `tiers`.

**Testing**: vitest 3, rôle restreint `erp_app`, un fichier par étape, dont la concurrence sur le dernier article

**Target Platform**: serveur Linux (Docker), Node.js 22

**Project Type**: module d'un monolithe modulaire Fastify

**Performance Goals**: une commande apparaît dans l'ERP et réserve le stock en moins d'une minute (SC-001) ; elle est traitée de façon synchrone par la route

**Constraints**: FCFA entiers, aucun secret dans le code, RLS forcée, GLOMARI et GTA jamais mélangés, jamais de coût ni de marge côté public

**Scale/Scope**: essai privé avec données fictives

**Prerequisite**: points 1 et 2 du lot 0 fusionnés (demandes n° 1 et n° 2) : `.github/workflows/verification.yml` et lieux de GLOMARI créés par `scripts/provisionnerglomari.ts`. Zones et colis du canal au nom de la branche GLOMARI (les lieux n'ont pas le module transport)

---

## Constitution Check

*`.specify/memory/constitution.md` est un modèle vide ; contrôle fait contre CLAUDE.md et la section 3.2 de la fiche.*

| Règle | Statut | Note |
|---|---|---|
| Ne jamais modifier une migration appliquée | ✅ | Migration 0046 seulement ; aucune table existante recréée |
| RLS forcée, politique `cloison`, droits `erp_app`, clés composites | ✅ | Sur les 4 tables nouvelles |
| Droits vérifiés côté serveur, sur l'entité | ✅ | `exigerSurEntite` sur la branche ou le lieu |
| Codes d'erreur dans `MESSAGES` | ✅ | 7 nouveaux, 6 déjà présents |
| FCFA entiers | ✅ | `bigint` partout |
| Sortie d'argent avec `tresorerie.gerer` | ✅ | Aucune sortie d'argent au lot 1 |
| GTA et GLOMARI séparés | ✅ | Catalogue, fiches clients, points relais et événements filtrés par branche |
| Jamais coût, marge, fournisseur côté public | ✅ | Colonnes explicites, test dédié |
| Noms de fichiers sans tiret ni tiret bas | ✅ | `canalenligne.ts`, `canalenligne.js` ; migration à la forme imposée |
| Aucun secret | ✅ | Durées de réservation = constantes métier |

**Résultat** : aucune violation.

---

## Project Structure

### Documentation (this feature)

```text
specs/001-glomari-plateforme-commerce/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── routes-publiques.md
│   └── routes-internes.md
└── tasks.md
```

### Source Code (repository root)

```text
migrations/
└── 0046_canal_en_ligne.sql    # tables, reservations_stock, quantite_vendable(), déclencheurs

src/
├── canalenligne.ts            # routes publiques /marketplace, routes internes, expiration
├── stocks.ts                  # quantiteDisponible() appelle quantite_vendable()
├── pilotage.ts                # creerColis() extraite de POST /colis, comportement inchangé
└── serveur.ts                 # enregistrement, tâche horaire, minuterie de 60 s

public/
├── canalenligne.js            # écran « Commandes en ligne »
├── app.js                     # MESSAGES, bouton du menu commerce
├── index.html                 # balise script
└── sw.js                      # FICHIERS, version du CACHE

tests/
├── canaloutils.ts             # boutique d'essai
├── canalcatalogue.test.ts
├── canalcommandes.test.ts
├── canalexpiration.test.ts
├── canalgestion.test.ts
└── canalevenements.test.ts
```

**Structure Decision**: monolithe modulaire, un fichier par domaine dans `src/`, enregistré dans `src/serveur.ts`, comme `src/mall.ts`.

---

## Complexity Tracking

Aucune violation à justifier. Choix à surveiller : événements par déclencheurs (premier déclencheur du dépôt à écrire dans `evenements`), justifiés par les 35 points d'écriture du stock et du catalogue (research.md, section 8).
