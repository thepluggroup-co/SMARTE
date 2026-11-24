# Implementation Plan: Comptes clients en ligne de GLOMARI (lot 4, partie B)

**Branch**: `lot4b-comptes-clients` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-comptes-clients/spec.md` ; besoin : `docs/Fiche technique globale GLOMARI.md`, section 9 (lot 4, point 3) et W6.

---

## Summary

Un compte client sans mot de passe, bâti sur la fiche client existante.

1. **Connexion** :
   - un code à six chiffres part aussitôt par SMS, par le prestataire de la partie A ;
   - il est conservé seulement par une empreinte à clé, vaut 10 minutes, tombe après cinq essais faux ;
   - les demandes sont limitées par numéro et par boutique.
2. **Session** : au bon code, une session de 7 jours (jeton aléatoire conservé par son empreinte) donne accès à l'espace. Elle se révoque par le client, sur un appareil ou sur tous, ou par l'équipe Care. Elle tombe si la fiche change (archivée, fusionnée, téléphone modifié).
3. **Espace client** :
   - historique des commandes en ligne et des précommandes, avec le solde payable depuis l'espace ;
   - jusqu'à cinq adresses, et modification du nom et de l'e-mail ;
   - solde et mouvements de fidélité.

Le suivi et le solde réutilisent la logique existante, extraite en fonctions communes.

---

## Technical Context

**Language/Version**: TypeScript 5, Node.js 22

**Primary Dependencies**: Fastify 5, pg 8, `@fastify/rate-limit` (déjà utilisé). Aucune nouvelle dépendance (`node:crypto` pour le tirage, le HMAC et la comparaison en temps constant).

**Storage**: PostgreSQL 16, migration `0052_comptes_clients.sql` :

- tables nouvelles : `codes_connexion`, `sessions_clients`, `adresses_clients` ;
- réutilisées : `tiers`, `commandes_web`, `lignes_commande_web`, `colis`, `inscriptions_precommande`, `campagnes_arrivage`, `zones_livraison`, `points_fidelite`, `regles_fidelite`.

**Testing**: vitest 3, rôle restreint `erp_app`, prestataire de messages factice ; un fichier par groupe de parcours

**Target Platform**: serveur Linux (Docker), Node.js 22

**Project Type**: module d'un monolithe modulaire Fastify ; écrans de l'espace client dans `glomari-web` (W6), hors de ce dépôt

**Performance Goals** : code envoyé dans la requête ; historique limité aux 100 dernières commandes ; volumes d'essai.

**Constraints** :

- aucun code ni jeton conservé en clair, ni écrit dans un journal ;
- aucun mot de passe ;
- données lues par la fiche de la session seulement ;
- fidélité et fiches séparées par branche, jamais GTA ;
- limites de demandes par numéro et par boutique.

**Scale/Scope**: essai privé, données fictives

**Prerequisite**: lot 4A fusionné (demande n° 9) ; la branche part de `lot4a-messages-avis`

---

## Constitution Check

*`.specify/memory/constitution.md` est un modèle vide ; contrôle fait contre CLAUDE.md et la section 2 de la fiche.*

| Règle | Statut | Note |
| --- | --- | --- |
| Ne jamais modifier une migration appliquée | ✅ | Migration 0052 |
| RLS forcée, `cloison`, droits `erp_app`, clés composites | ✅ | Trois tables nouvelles ; audit sur les adresses, pas sur les codes ni les sessions (empreintes hors du journal) |
| Ne jamais demander de mot de passe | ✅ | Connexion par code SMS ; aucun mot de passe créé ni saisi |
| Droits vérifiés côté serveur | ✅ | Session contrôlée à chaque requête ; `care.gerer` (révocation par l'équipe) ; `entites.gerer` (code d'essai) |
| Fichiers clients et points séparés par branche | ✅ | Fiche et points de la branche de la boutique |
| GTA formations, GLOMARI stocks | ✅ | Boutique ouverte seulement (`parBoutique`) ; test GTA |
| Codes d'erreur dans `MESSAGES` | ✅ | Sept codes nouveaux |
| Noms de fichiers sans tiret ni tiret bas | ✅ | `comptesclients.ts`, `tests/comptesconnexion.test.ts`… |
| Prestataire factice : essai privé seulement | ✅ | Lecture du code d'essai seulement avec lui, et avec `entites.gerer` |

**Résultat** : aucune violation. Après la conception (Phase 1), le contrôle reste sans violation.

---

## Project Structure

### Documentation (this feature)

```text
specs/006-comptes-clients/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── routes.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
migrations/
└── 0052_comptes_clients.sql   # codes, sessions, adresses

src/
├── comptesclients.ts          # code, connexion, session, espace client, adresses, fidélité, révocation
├── canalenligne.ts            # trouverFicheClient (déterministe), detailCommandeWeb extraits ; option de débit
├── precommandes.ts            # detailPrecommande, creerCommandeSolde extraits
├── messages.ts                # GET /messages/code-essai (prestataire factice seulement)
├── relation.ts                # fusion : sessions révoquées, « par défaut » retiré ; LIENS_TIERS
├── serveur.ts                 # enregistrement, options de débit, compte_en_ligne dans GET /tiers/:id
└── index.ts                   # ERP_CANAL_CODES_PAR_MINUTE, ERP_CANAL_CONNEXIONS_PAR_MINUTE

public/
├── relation.js                # fiche client : appareils connectés, déconnexion par l'équipe Care
├── messages.js                # « Code d'essai » (prestataire factice seulement)
└── app.js                     # MESSAGES

tests/
├── comptesoutils.ts
├── comptesconnexion.test.ts   # Q1 à Q6
├── comptesespace.test.ts      # Q7, Q8
├── comptesadresses.test.ts    # Q9
├── comptesfidelite.test.ts    # Q10
└── comptessessions.test.ts    # Q11 à Q13
```

**Structure Decision**: monolithe modulaire. Un fichier de domaine, `src/comptesclients.ts`, enregistré dans `src/serveur.ts`. Les dépendances vont dans un seul sens :

- `comptesclients` importe les fonctions extraites de `canalenligne` et `precommandes`, et `mobileCamerounais` de `messages` ;
- aucun de ces modules n'importe `comptesclients`.

---

## Complexity Tracking

| Choix | Pourquoi | Alternative écartée |
| --- | --- | --- |
| Empreinte HMAC du code avec la clé du serveur | Six chiffres seulement : une empreinte simple se retrouverait en une seconde si la base fuyait | SHA-256 simple, ou code en mémoire |
| Session en table plutôt qu'en jeton signé | Révocation immédiate (un appareil, tous, équipe Care, fusion) | Jeton signé autoporteur : non révocable avant son échéance |
| Fonctions extraites du suivi et du solde | Un seul chemin pour le lien et le compte, déjà testé | Requêtes recopiées : deux versions qui divergent |
| Lecture du code d'essai par une route réservée | Essai possible sans SMS, sans code dans les journaux, rien avec un vrai prestataire | Code dans le journal du serveur, ou code fixe dans `.env` |
