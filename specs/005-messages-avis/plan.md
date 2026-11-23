# Implementation Plan: Messages automatiques et avis publiés de GLOMARI (lot 4, partie A)

**Branch**: `lot4a-messages-avis` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-messages-avis/spec.md` ; besoin : `docs/Fiche technique globale GLOMARI.md`, section 9 (lot 4, points 1, 2 et 6), règles R4, R7 et R9.

---

## Summary

Trois ajouts, sans toucher à la logique des colis, des précommandes ni des avis existants.

1. **Envoi de messages** :
   - un prestataire SMS et WhatsApp interchangeable, factice tant que la direction n'a pas choisi ;
   - une file d'envoi qui sert aussi de journal, un message par type et par objet, des messages datés (quatorzième jour, rappel du solde) ;
   - un envoi chaque minute, hors transaction, entre 7 h et 21 h, avec trois tentatives au plus ;
   - le texte est préparé à l'envoi et jamais conservé.
2. **Déclencheurs** : `publierEvenement` appelle les réactions inscrites, dans la même transaction. Les messages naissent ainsi des événements existants (`colis.livre`, `vente.comptoir`, `precommande.*`) et de deux nouveaux (`colis.cree`, `colis.etape`).
3. **Avis par article** :
   - la demande d'avis existante couvre une commande entière, et chaque article reçoit sa note ;
   - la Marketplace lit les avis publiés d'un article, et le catalogue sa moyenne.

La direction règle chaque type (actif, canal) ; l'équipe Care lit le journal et renvoie un message en échec.

---

## Technical Context

**Language/Version**: TypeScript 5, Node.js 22

**Primary Dependencies**: Fastify 5, pg 8. Aucune nouvelle dépendance.

**Storage**: PostgreSQL 16, migration `0051_messages_avis.sql` :

- tables nouvelles : `reglages_messages`, `envois_messages` ;
- colonnes ajoutées : `tiers.ne_pas_contacter`, `retours_clients.produit_id` ;
- contraintes élargies : `demandes_retour.cible_type` (`commande`) et `source_type` (`vente_comptoir`) ; unicité de `retours_clients` par demande et article ;
- réutilisées : `evenements`, `colis`, `inscriptions_precommande`, `campagnes_arrivage`, `documents_vente`, `lignes_vente`, `ventes_comptoir`, `lignes_comptoir`, `demandes_retour`, `retours_clients`, `tickets`.

**Testing**: vitest 3, rôle restreint `erp_app`, prestataire factice passé au serveur, date d'envoi injectée ; un fichier par groupe de parcours

**Target Platform**: serveur Linux (Docker), Node.js 22

**Project Type**: modules d'un monolithe modulaire Fastify, écrans en JavaScript sans framework

**Performance Goals** :

- envoi par lots de 100 messages par organisation et par minute ;
- un message part dans les 5 minutes de son étape pendant les heures d'envoi (SC-001) ;
- avis publics paginés par 20.

**Constraints** :

- un message par type et par objet ;
- aucun numéro complet ni code dans le journal ;
- envoi entre 7 h et 21 h (heure de Douala) ;
- aucun appel réseau réel dans les tests ;
- GTA et GLOMARI séparés ;
- jamais de nom complet ni de téléphone dans les avis publics.

**Scale/Scope**: essai privé, données fictives

**Prerequisite**: lot 3B fusionné (demande n° 8)

---

## Constitution Check

*`.specify/memory/constitution.md` est un modèle vide ; contrôle fait contre CLAUDE.md et la section 2 de la fiche.*

| Règle | Statut | Note |
| --- | --- | --- |
| Ne jamais modifier une migration appliquée | ✅ | Migration 0051 ; les contraintes de 0020 sont remplacées par `alter table`, pas réécrites |
| RLS forcée, `cloison`, droits `erp_app`, clés composites | ✅ | Deux tables nouvelles ; `envois_messages.objet_id` sans FK (trois tables possibles), justifié ci-dessous |
| Droits vérifiés côté serveur, sur l'entité | ✅ | `facturation.administrer` (réglages), `care.voir` ou `facturation.administrer` (journal), `care.gerer` (renvoi), `tiers.modifier` (« ne pas contacter ») |
| GTA formations, GLOMARI stocks | ✅ | Mise en file et routes limitées aux branches avec le module de stock ; avis publics de la boutique ouverte ; test GTA |
| Fichiers clients séparés par branche | ✅ | Le client d'un avis est celui de la facture ou de la vente de la branche |
| Sortie d'argent avec `tresorerie.gerer` | ✅ | Aucune sortie d'argent dans cette partie |
| Ne jamais demander de mot de passe | ✅ | Aucun ; identifiants du prestataire dans `.env` |
| Codes d'erreur dans `MESSAGES` | ✅ | `renvoi_impossible`, `article_hors_commande` |
| Noms de fichiers sans tiret ni tiret bas | ✅ | `messages.ts`, `messages.js`, `tests/messagescolis.test.ts`… |
| Prestataire factice : essai privé seulement | ✅ | Activé par `ERP_MESSAGES_FACTICE=1`, jamais avec de vraies données |

**Résultat** : aucune violation. Après la conception (Phase 1), le contrôle reste sans violation.

---

## Project Structure

### Documentation (this feature)

```text
specs/005-messages-avis/
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
└── 0051_messages_avis.sql     # réglages, file d'envoi, ne_pas_contacter, avis par article

src/
├── messages.ts                # types, prestataire factice, réglages, mise en file (réactions), textes, envoi, routes
├── base.ts                    # reactionsEvenements, appelées par publierEvenement
├── pilotage.ts                # événements colis.cree et colis.etape
├── commerce.ts                # /evaluer/:code par article ; /retours avec le nom de l'article
├── canalenligne.ts            # avis publics d'un article ; moyenne dans le catalogue
├── relation.ts                # PATCH /tiers/:id : nePasContacter ; fusion : la marque suit
├── serveur.ts                 # option prestataireMessages, enregistrement, minuterie d'envoi
└── index.ts                   # ERP_MESSAGES_FACTICE

public/
├── messages.js                # écran « Messages aux clients » : réglages, journal, renvoi
├── evaluer.js                 # page evaluer.html : note par article d'une commande
├── relation.js                # case « ne pas contacter » sur la fiche client
├── app.js                     # MESSAGES, menu
├── index.html                 # script messages.js
└── sw.js                      # cache smarte-solutions-v6

tests/
├── messagesoutils.ts
├── messagescolis.test.ts         # Q1 à Q6
├── messagesprecommandes.test.ts  # Q7 à Q10
├── avisproduits.test.ts          # Q11 à Q13, Q15
├── avispublics.test.ts           # Q14
└── messagesreglages.test.ts      # Q16 à Q19
```

**Structure Decision**: monolithe modulaire. Un fichier de domaine, `src/messages.ts`, enregistré dans `src/serveur.ts`. Les dépendances vont dans un seul sens :

- `messages` s'inscrit dans `base` (réactions) ;
- `messages` lit colis, précommandes et ventes en SQL, sans importer leurs modules ;
- `pilotage`, `precommandes` et `caisse` ne connaissent pas `messages`.

---

## Complexity Tracking

| Choix | Pourquoi | Alternative écartée |
| --- | --- | --- |
| Réactions appelées par `publierEvenement` | Un seul point couvre tous les chemins de colis et de précommandes, dans la transaction métier | Appels dans chaque route : nombreux et faciles à oublier |
| `envois_messages` à la fois file et journal | Unicité par clé en base (zéro doublon), messages datés, historique des tentatives au même endroit | File et journal séparés : deux écritures à garder cohérentes |
| `objet_id` sans clé étrangère | L'objet est un colis, une inscription ou une vente de caisse ; le type dit laquelle | Trois colonnes nullables avec chacune sa FK : plus lourd, sans gain pour un journal |
| Texte préparé à l'envoi, jamais stocké | Aucun code de livraison en clair (SC-004), numéro actuel au renvoi, message sans objet abandonné | Texte stocké à la mise en file : code en clair et texte périmé |
| Unicité de `retours_clients` élargie à l'article | Un avis par article réutilise le lien, la modération et l'écran existants | Table d'avis produits à part : modération et écran en double |
