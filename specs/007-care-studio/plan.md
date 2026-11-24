# Implementation Plan: Assistant GLOMARI Care et studio des fiches produits (lot 4, partie C)

**Branch**: `lot4c-care-studio` | **Date**: 2026-11-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-care-studio/spec.md` ; besoin : `docs/Fiche technique globale GLOMARI.md`, section 9 (lot 4, points 4 et 5) et W8.

---

## Summary

Deux outils qui s'appuient sur l'IA déjà configurée pour le studio des cours, sans jamais la laisser décider seule.

1. **Assistant GLOMARI Care** (Marketplace, tout visiteur) :
   - à chaque question, le serveur réunit lui-même ce que l'IA a le droit de savoir : réponses validées actives, articles proches de la question (prix, texte de vente, disponibilité « oui / non » par lieu), zones et points relais, et les commandes du client s'il est identifié par sa session ou par le lien d'une commande ;
   - des règles en code, avant et après l'IA, écartent toute promesse de remboursement ou de geste commercial ;
   - « je ne sais pas » et « pas aidé » mènent à un conseiller ;
   - le relais ouvre un ticket existant pour l'équipe, avec toute la conversation, un seul par conversation, en priorité haute pour un remboursement ou un litige ;
   - limites : 30 messages par conversation, 1 000 caractères, débit par boutique ; clôture après 30 minutes sans message, effacement à 12 mois.
2. **Base de réponses et indicateur** (équipe Care) : réponses validées par branche, part des conversations closes sans conseiller, avis, questions restées sans réponse, lecture des conversations.
3. **Studio des fiches produits** (marketing) :
   - l'IA propose un titre, une description et des points clés à partir de l'article et de notes ;
   - le marketing corrige ou écrit lui-même, puis publie ;
   - versions conservées ; le catalogue public montre le texte publié ; le nom de l'article dans l'ERP ne change jamais.

---

## Technical Context

**Language/Version**: TypeScript 5, Node.js 22

**Primary Dependencies**: Fastify 5, pg 8, `@fastify/rate-limit` (déjà utilisé). Aucune nouvelle dépendance : l'appel à l'IA passe par `generateurClaude` (`src/studio.ts`, `fetch`), le jeton par `node:crypto`.

**Storage**: PostgreSQL 16, migration `0053_care_studio.sql` :

- tables nouvelles : `conversations_care`, `messages_care`, `reponses_care`, `textes_vente` ;
- réutilisées : `tickets`, `tiers`, `produits`, `commandes_web`, `zones_livraison`, `points_relais`, `lieux_canal`, `config_canal`, `promotions`, `categories_articles`, `marques` ;
- fonctions réutilisées : `quantite_vendable()`, `canal_publier_article()`.

**Testing**: vitest 3, rôle restreint `erp_app`, générateur d'IA factice injecté (aucun appel réseau) ; un fichier par groupe de parcours.

**Target Platform**: serveur Linux (Docker), Node.js 22

**Project Type**: modules d'un monolithe modulaire Fastify ; fenêtre de conversation de la Marketplace (W8) dans `glomari-web`, hors de ce dépôt ; écrans de l'équipe dans `public/`.

**Performance Goals**: réponse en moins de 10 secondes pour 95 % des questions (SC-002) : un seul appel à l'IA par question, limité à 9 secondes et à une réponse courte, contexte borné (100 réponses, 8 articles, 5 commandes, 10 messages) ; aucune connexion à la base retenue pendant l'appel ; volumes d'essai.

**Constraints**:

- l'IA ne reçoit jamais un coût, une marge, un fournisseur, une quantité, ni le nom ou le téléphone d'un client ;
- aucune promesse de remboursement ni de geste commercial, garantie par du code et non par la seule consigne ;
- commandes visibles seulement par la session du client ou le lien d'une commande ;
- fiches séparées par branche, jamais GTA (`parBoutique`, module de stock) ;
- clé de l'IA dans `.env` du serveur, jamais dans le dépôt ;
- débit par boutique (la Marketplace appelle l'ERP depuis une seule adresse).

**Scale/Scope**: essai privé, données fictives

**Prerequisite**: lot 4B fusionné (demande n° 10) ; la branche part de `main` (4c37d1d).

---

## Constitution Check

*`.specify/memory/constitution.md` est un modèle vide ; contrôle fait contre CLAUDE.md et la section 2 de la fiche.*

| Règle | Statut | Note |
| --- | --- | --- |
| Ne jamais modifier une migration appliquée | ✅ | Migration 0053 ; 0046 seulement réutilisée (`canal_publier_article()`) |
| RLS forcée, `cloison`, droits `erp_app`, clés composites | ✅ | Quatre tables nouvelles ; audit sur `reponses_care` et `textes_vente` (elles ont un `id`), pas sur les conversations |
| Ne jamais demander de mot de passe | ✅ | Aucun mot de passe ; la clé de l'IA reste dans `.env` |
| Droits vérifiés côté serveur | ✅ | `care.voir`, `care.gerer`, `support.voir`, `tiers.voir`, `marketing.voir`, `marketing.gerer` sur la branche ; aucun droit ajouté d'office à un rôle |
| Fichiers clients séparés par branche | ✅ | Fiche trouvée ou créée dans la branche de la boutique (`ficheClient`) |
| GTA formations, GLOMARI stocks | ✅ | Boutique ouverte seulement ; studio réservé aux articles suivis en stock d'une branche avec le module de stock ; tests GTA |
| Une sortie d'argent exige `tresorerie.gerer` | ✅ | Aucune sortie d'argent : l'assistant ne rembourse jamais, il passe la main |
| Codes d'erreur dans `MESSAGES` | ✅ | Quatre codes nouveaux |
| Noms de fichiers sans tiret ni tiret bas | ✅ | `care.ts`, `fichesvente.ts`, `assistantcare.js`, `tests/careassistant.test.ts`… |
| Fournisseurs factices : essai privé seulement | ✅ | L'IA factice n'existe que dans les tests ; la recette se fait avec l'IA réelle et des données fictives |

**Résultat** : aucune violation. Après la conception (Phase 1), le contrôle reste sans violation.

---

## Project Structure

### Documentation (this feature)

```text
specs/007-care-studio/
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
└── 0053_care_studio.sql       # conversations, messages, réponses validées, textes de vente, déclencheur

src/
├── care.ts                    # assistant (contexte, garde-fous), relais, avis, réponses validées, conversations, indicateur, tâche horaire
├── fichesvente.ts             # studio : brouillon par l'IA, brouillon à la main, publication, retrait, historique
├── studio.ts                  # GenerateurIa : réglages facultatifs (consigne de rôle, délai, longueur)
├── automatisation.ts          # anonymisation : texte des conversations effacé
├── canalenligne.ts            # prixEnLigne extrait de la route du catalogue ; « vente » dans le catalogue public
├── relation.ts                # HEURES_PAR_PRIORITE exportée ; conversation dans GET /tickets/:id ; LIENS_TIERS
├── comptesclients.ts          # clientConnecte exportée
├── serveur.ts                 # enregistrement, debitCanal.care, générateur passé aux deux modules
└── index.ts                   # ERP_CANAL_CARE_PAR_MINUTE

public/
├── assistantcare.js           # « Assistant Care » : réponses validées, conversations, indicateur
├── fichesvente.js             # « Fiches de vente » : liste, brouillon par l'IA, correction, publication, historique
├── relation.js                # détail du ticket : conversation de l'assistant
├── app.js                     # MESSAGES, boutons du menu
├── index.html                 # scripts
└── sw.js                      # cache v8

docs/
└── Guide de mise en ligne.md  # section lot 4C : clé de l'IA, débit, rôle Service client pour les relais, sujets de départ

tests/
├── careoutils.ts
├── careassistant.test.ts      # Q1 à Q4
├── carecommandes.test.ts      # Q5 à Q7
├── carerelais.test.ts         # Q8 à Q10
├── carereponses.test.ts       # Q11 à Q13
└── fichesvente.test.ts        # Q14 à Q17
```

**Structure Decision**: monolithe modulaire. Deux fichiers de domaine, `src/care.ts` et `src/fichesvente.ts`, enregistrés dans `src/serveur.ts`. Les dépendances vont dans un seul sens :

- `care` importe `parBoutique`, `prixEnLigne`, `ficheClient`, `detailCommandeWeb` de `canalenligne`, `detailPrecommande` de `precommandes`, `clientConnecte` (désormais exportée) de `comptesclients`, `HEURES_PAR_PRIORITE` de `relation`, `GenerateurIa` de `studio` ;
- `fichesvente` importe `prixEnLigne` de `canalenligne` et `GenerateurIa` de `studio` ;
- `relation` et `automatisation` lisent ou effacent `conversations_care` et `messages_care` par une requête, sans importer `care` ;
- aucun module existant n'importe `care` ni `fichesvente`.

Les nouveaux écrans s'appellent `ecranAssistantCare` et `ecranFichesVente` : `ecranCare` (SAV, `public/commerce.js`) et `ecranMarketing` restent inchangés.

---

## Complexity Tracking

| Choix | Pourquoi | Alternative écartée |
| --- | --- | --- |
| Contexte fermé construit par le serveur | Ce qui n'est pas confié à l'IA ne peut pas fuiter (SC-003) | Outils d'interrogation donnés à l'IA : elle choisirait ce qu'elle lit |
| Garde-fous en code avant et après l'IA | Zéro promesse sur 20 détournements (SC-004), sans dépendre de la consigne | Consigne seule, ou seconde IA de contrôle (coût et délai doublés) |
| Recherche d'articles par mots | Suffit pour l'essai et quelques centaines d'articles, sans extension de base | Recherche sémantique par vecteurs |
| Conversation lue depuis le ticket, pas recopiée | Un seul fil ; `ticket_messages` exige un auteur utilisateur | Copie des messages avec un auteur « système » inexistant |
| Textes de vente versionnés à part de `produits` | Historique, brouillon distinct du publié, nom de l'ERP intact | Colonne `description` sur `produits` ; réécriture de `produits.nom` |
