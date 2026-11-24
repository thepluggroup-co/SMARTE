# Fiche technique globale GLOMARI : ERP SMARTE, site web et Marketplace

Version 2.0 du 20 novembre 2026, établie par THE PLUG. Elle remplace la version 1.0 (« Fiche technique d'ajustement GLOMARI »).

**Sources :**
- business plan GLOMARI 2027-2031 (draft 05) ;
- diagramme stratégique GLOMARI ;
- modèle financier FIPROSOFT GLOMARI v3.1, scénario optimiste ;
- dépôt `thepluggroup-co/SMARTE`, commit `fd91101` du 13 novembre 2026.

Elle sert à trois choses :

1. **Fiche technique** du système numérique complet de GLOMARI. Elle couvre l'ERP SMARTE, le site web GLOMARI et la boutique en ligne GLOMARI Marketplace, tous construits selon les logiques de fonctionnement du business plan.
2. **Cahier des charges technique.** Pour chaque système, elle décrit ce qui existe, ce qu'il faut construire et comment les systèmes se branchent entre eux.
3. **Prompts.** Chaque bloc « PROMPT » se colle tel quel dans l'assistant de code de VS Code (Claude Code, Copilot Chat ou équivalent) pour créer, modifier ou brancher les systèmes.

Elle complète le **Manuel d'intégration GLOMARI × Smarte Solutions**, qui décrit la vision stratégique, et son onglet **Cahier des charges et écarts**. Si un besoin est flou, le manuel tranche. Pour les règles techniques de l'ERP, c'est `CLAUDE.md` du dépôt qui tranche.

---

## Sommaire

0. Mode d'emploi dans VS Code
1. Vue d'ensemble du système GLOMARI
2. Logiques de fonctionnement du business plan à respecter
3. Fiche technique de l'ERP SMARTE
4. Fiche technique du site web GLOMARI
5. Fiche technique de GLOMARI Marketplace
6. Contrats d'interface entre les systèmes
7. Charte visuelle et contenus
8. PROMPT MAÎTRE
9. Prompts ERP (lots 0 à 5)
10. Prompts site web et Marketplace (W1 à W10)
11. Prompts d'intégration et de tests de bout en bout
12. Vérifications et recette
13. Prompt d'ajustement rapide
14. Décisions attendues de la direction

---

## 0. Mode d'emploi dans VS Code

| Étape | Action |
| --- | --- |
| 1 | Ouvrir le dépôt concerné dans VS Code : `SMARTE` pour l'ERP, `glomari-web` pour le site web et la Marketplace (à créer, prompt W1). |
| 2 | Placer cette fiche dans le dossier `docs/` de chaque dépôt. |
| 3 | Créer une branche par lot, par exemple `git checkout -b lot1-canal-en-ligne`. |
| 4 | Coller le **PROMPT MAÎTRE** (section 8), puis le prompt du lot (sections 9 à 11). Un seul lot à la fois. |
| 5 | Lire le plan proposé par l'assistant, l'accepter ou le corriger, puis le laisser coder. |
| 6 | Exiger les vérifications de la section 12 avant toute fusion. |
| 7 | Pour un simple réglage, utiliser le prompt de la section 13. |

Ordre des lots, imposé par le business plan (la vente en ligne payée avant tout le reste) :

```text
ERP lot 0 ──► ERP lot 1 + Web W1 à W4 ──► ERP lot 2 + Web W5 ──► ERP lot 3 + Web W7
          ──► ERP lot 4 + Web W8 ──► (phase 2, 2029) ERP lot 5 + Web W6, W9 ──► Web W10 (applications mobiles)
```

Prérequis sur le poste : Node.js 22, Git, PostgreSQL 16 local ou Docker.

---

## 1. Vue d'ensemble du système GLOMARI

### 1.1 Les trois systèmes

| Système | Rôle | Utilisateurs | État au 20/11/2026 |
| --- | --- | --- | --- |
| **ERP SMARTE** (dépôt `SMARTE`) | Source unique de vérité : articles, prix, stock, clients, commandes, paiements, livraisons, SAV, finance, RH, pilotage | Personnel GLOMARI selon son rôle ; direction ; expert-comptable | Construit et testé (404 tests réussis), jamais utilisé en réel |
| **Site web GLOMARI** (dépôt `glomari-web`, partie publique) | Présenter GLOMARI, le Mall et les quatre canaux ; recruter revendeurs, entreprises, affiliés, franchisés et employés | Public, prospects, partenaires | À construire |
| **GLOMARI Marketplace** (dépôt `glomari-web`, partie boutique ; puis applications Android et iOS) | Vendre en ligne le stock unique au même prix qu'au Mall, avec paiement mobile, livraison suivie, précommandes, avis, fidélité et Care | Clients particuliers, puis affiliés | À construire |

**Choix recommandé :** un seul dépôt `glomari-web` en **Next.js (React)**, installable sur téléphone (PWA). Il regroupe le site web, indexé par les moteurs de recherche, et la Marketplace. Le dossier d'architecture de SMARTE propose déjà React. Next.js ajoute le rendu côté serveur, nécessaire au référencement des fiches produits. Les applications Android et iOS viendront ensuite en React Native, comme le prévoit aussi ce dossier. Ce choix reste à valider par le responsable technique de SGC.

### 1.2 Schéma des flux

```text
               CLIENTS            REVENDEURS / ENTREPRISES        AFFILIÉS / FRANCHISÉS
                  │                        │                              │
       ┌──────────┴──────────┐    ┌────────┴────────┐            ┌────────┴────────┐
       │  GLOMARI Marketplace │    │ Portail grossiste│            │  Site web GLOMARI│
       │  (glomari-web)       │    │ (SMARTE, existe) │            │  (glomari-web)   │
       └──────────┬──────────┘    └────────┬────────┘            └────────┬────────┘
                  │ routes publiques       │                              │ formulaires
                  │ + serveur Next.js      │                              │ /capture/:code
                  ▼                        ▼                              ▼
       ┌───────────────────────────────────────────────────────────────────────────┐
       │                        ERP SMARTE, branche GLOMARI                          │
       │  Catalogue et stock unique · Achats et import · Précommandes · Caisse Mall  │
       │  Facturation · Transport et relais · CRM, Care, avis, fidélité · Réseau     │
       │  Trésorerie · Comptabilité SYSCOHADA · RH et paie · Indicateurs et OKR      │
       └───────┬──────────────────┬──────────────────┬──────────────────┬──────────┘
               │ avis signés      │ envois           │ appels IA        │ webhooks
               ▼                  ▼                  ▼                  ▼
        Orange Money /      SMS / WhatsApp     Fournisseur IA      glomari-web
        MTN MoMo            (prestataire)      (clé SGC)           (cache catalogue)
```

### 1.3 Principes d'architecture

1. **Une seule vérité.** Article, prix, promotion, stock, client et commande vivent dans SMARTE. `glomari-web` ne garde que des copies de cache, rafraîchies par webhook.
2. **Aucun secret dans le navigateur.** Le navigateur appelle soit les routes publiques limitées en débit de SMARTE, soit le serveur Next.js. Seul le serveur Next.js détient une clé d'API SMARTE et les clés du prestataire de paiement.
3. **Le paiement est confirmé par l'opérateur.** Une commande n'est payée que sur avis signé du prestataire, reçu par SMARTE.
4. **GLOMARI et GTA ne se mélangent jamais.** Le site web et la Marketplace ne voient que la branche GLOMARI.
5. **Tout est traçable.** Chaque fait important (commande, paiement, colis, avis, ticket) est un événement SMARTE, diffusable par webhook.

---

## 2. Logiques de fonctionnement du business plan à respecter

Toute fonction construite doit respecter ces règles, qui viennent du business plan et du diagramme stratégique.

| N° | Règle métier | Conséquence technique |
| --- | --- | --- |
| R1 | **Un seul stock, au même prix, en rayon et en ligne.** | La Marketplace lit le prix et la quantité vendable dans SMARTE ; aucune table de prix ni de stock dans `glomari-web`. |
| R2 | **Quatre canaux :** détail (Mall et Marketplace), gros aux revendeurs, B2B entreprises (référence ACEP), réseau d'affiliés puis de franchisés. | Chaque vente porte son canal ; indicateurs par canal. |
| R3 | **Objectif à pleine activité : 60 % de détail, 40 % de gros, B2B et services.** | Indicateur de répartition par canal. |
| R4 | **La prévente est une précommande avec acompte, pas du financement participatif.** Commande au fabricant seulement au seuil atteint ; solde payé à la réception ; client informé à chaque étape. | Module Précommandes : campagne, liste d'attente, acompte, seuil, bon de commande en brouillon, notifications. |
| R5 | **Les fabricants chinois sont payés d'avance, sans crédit.** | Acompte fournisseur avant facture ; achats en devise convertis en FCFA. |
| R6 | **Paiement Mobile Money (Orange, MTN) ou à la livraison.** | Prestataire de paiement raccordé ; livraison contre paiement portée par le colis. |
| R7 | **Modes de livraison :** livreur urbain à Douala et Yaoundé, agence de voyage pour les autres villes, point relais, retrait au Mall. | Frais par zone ; colis créé automatiquement ; suivi public par code. |
| R8 | **GLOMARI Care traite 80 % des demandes par l'IA, 24 h/24 ; l'équipe traite les litiges.** | Assistant IA avec reprise par un humain via un dossier SAV ; jamais de remboursement décidé par l'IA. |
| R9 | **Relance de satisfaction environ deux semaines après l'achat ; avis publics ; points de fidélité.** | Envoi automatique du lien d'avis à J+14 ; avis vérifiés publiés ; fidélité GLOMARI séparée de GTA. |
| R10 | **Affiliation rémunérée dès 2027 ; franchise à 8 % de commission en 2029 ; vendeurs particuliers accrédités par un franchisé parrain, sans vente directe « fourre-tout ».** | Lien d'affilié ; lieu de stock par franchisé ; parrainage obligatoire pour un vendeur. |
| R11 | **Stock plafonné à 2 mois.** | Alerte quand la couverture de stock dépasse 60 jours. |
| R12 | **Passage en phase 2 si CA 2028 ≥ 1,9 Md FCFA, marge brute ≥ 25 %, rotation du stock ≤ 60 jours, trésorerie ≥ 100 M FCFA.** | Quatre indicateurs suivis dans SMARTE. |
| R13 | **GTA forme le personnel, les franchisés et les vendeurs accrédités.** | Refacturation interne GTA → GLOMARI ; certificat GTA vérifiable. |
| R14 | **GLOMARI Pay et SMARTCOIN sous réserve des autorisations réglementaires.** | Aucun code avant autorisation écrite. |
| R15 | **Prix de vente = coût d'achat + charges d'exploitation + marge.** | Coût d'achat avec frais d'importation ; alerte de marge faible. |

---

## 3. Fiche technique de l'ERP SMARTE

### 3.1 Carte d'identité

| Élément | Valeur constatée |
| --- | --- |
| Produit | Smarte Solutions, ERP SaaS du Groupe Smart Global Concepts (SGC, Douala) |
| Branche | GLOMARI, code `GLOMARI`, domaine `commerce`, sous l'entité racine `SGC` |
| Modules actifs sur GLOMARI | crm, support, pilotage, facturation, achats_stocks, commerce, rh_paie, tresorerie, comptabilite, transport (`src/provisionnement.ts`, `STRUCTURE_SGC`) |
| Technique | TypeScript, Node 22, Fastify 5, PostgreSQL 16, monolithe modulaire ; écrans en JavaScript sans framework dans `public/` |
| Isolation | Sécurité au niveau des lignes forcée (`org_courante()`, politique `cloison`), compte applicatif `erp_app`, clés composites |
| Taille | 55 fichiers dans `src/` (18 942 lignes), 45 migrations, 41 fichiers de tests |
| Vérification du 20/11/2026 | `npx tsc --noEmit` sans erreur ; `npx vitest run` : 404 tests réussis sur 404, avec le rôle restreint |
| API | REST, description OpenAPI sur `/api/openapi.json`, clés d'API liées aux droits d'un compte avec quota, webhooks signés vers des adresses https publiques |
| Statut déclaré | Prêt pour un essai privé avec données fictives, pas pour de vraies données |
| Manque | `.github/workflows/verification.yml` cité dans `CLAUDE.md` mais absent du dépôt |

### 3.2 Règles techniques non négociables (extraites de `CLAUDE.md`)

- GTA fait uniquement les formations, GLOMARI uniquement les stocks.
- Fichiers clients et points de fidélité séparés par branche.
- Seul le super administrateur donne et retire les accès.
- Nouvelle table : `organisation_id`, RLS forcée, politique `cloison`, droits à `erp_app`, clés étrangères composites.
- Ne jamais modifier une migration appliquée ; prochaine migration : `0046`.
- Toute requête authentifiée passe par `protege()` ; droits vérifiés côté serveur avec `exiger()` ou `exigerSurEntite()`.
- Tout code d'erreur a son message dans `MESSAGES` (`public/app.js`).
- Argent en FCFA entiers. Une sortie d'argent exige `tresorerie.gerer`. Paiements, factures validées et billets sont figés par déclencheurs.
- TVA libre et facultative.
- Titres et noms de fichiers sans tiret ni tiret bas (fichiers imposés et fichiers de code existants exceptés).
- Comptabilité, paie et DSF : rappeler qu'elles ne remplacent pas un expert agréé.
- Aucun secret dans le dépôt ; ne jamais demander de mot de passe.

### 3.3 Organigramme du BP traduit en rôles SMARTE

| Direction ou service | Poste du BP | Rôle SMARTE (code) |
| --- | --- | --- |
| Gouvernance | Auditeur général ; expert-comptable | `auditeur` ; `reviseur` |
| Direction générale | Directeur général (A. SATIEU) | `super_administrateur` |
| Direction générale | Secrétaire de direction | `secretariat` |
| Administratif et financier | Chef comptable ; comptable | `chef_comptable` ; `comptable` |
| Administratif et financier | Caissier | `caissier` |
| Administratif et financier | Contrôleur de gestion | `responsable_pilotage` ; `tresorier` |
| Administratif et financier | Juridique, contentieux, recouvrement | `comptabilite` (rôle « Juridique et recouvrement » à créer, section 13) |
| Administratif et financier | RH, carrières, paie | `ressources_humaines` ; `paie` ; `evaluation` |
| Technique | Développement, maintenance, bases de données, cybersécurité | `administrateur` sur l'entité GLOMARI |
| Technique | Suivi, analyse, optimisation | `responsable_pilotage` |
| Marketing et commercial | Chargé de clientèle ; conseillers | `commercial` ; `service_client` ; `care` |
| Marketing et commercial | Chauffeur-livreur | `livreur` |
| Marketing et commercial | Responsable d'entrepôt ; manœuvres | `responsable_magasins` ; `magasinier` ; `logistique` |
| Marketing et commercial | Promotion, publicité, communication | `marketing` ; `affiliation` ; `reseau` |
| Opérations | Responsable des opérations | `responsable_magasins` ; `acheteur` ; `logistique` |

### 3.4 Paramètres ajustables

| Paramètre | Valeur actuelle | Où le changer |
| --- | --- | --- |
| Structure du groupe et modules | SGC > GLOMARI, GTA | `src/provisionnement.ts`, `STRUCTURE_SGC` |
| Rôles et permissions | 37 rôles | `src/catalogue.ts`, `ROLES_INITIAUX`, `PERMISSIONS` |
| Seuil de marge faible | 20 % | `src/achats.ts`, `SEUIL_MARGE_FAIBLE` |
| Remise maximale d'un caissier | 10 % | `src/caisse.ts`, `REMISE_MAX_CAISSIER` |
| Alerte avant expiration d'un lot | 30 jours | `src/entrepots.ts`, `JOURS_ALERTE_EXPIRATION` |
| Mot de passe minimal | 8 caractères | `src/serveur.ts` (lignes 367, 521, 618), `src/finitions.ts` (ligne 225) |
| Planches d'étiquettes | A4 de 24, 40, 65 ; rouleau 50 × 30 mm | `public/mall.js`, `PLANCHES` |
| Sources d'indicateurs | 8 sources | `src/controle.ts`, `SOURCES` |
| Vignettes du tableau de bord | Ventes, Achats, Sorties ou dépenses, Bénéfice | `src/tableau.ts`, `public/tableau.js` |
| Messages d'erreur | Liste `MESSAGES` | `public/app.js` |
| Studio IA | Non configuré | `.env` : `ERP_IA_CLE`, `ERP_IA_MODELE` |
| Médias | Non configuré | `.env` : `ERP_DOSSIER_MEDIAS` |
| Durée de réservation d'un panier | 30 minutes en Mobile Money, 24 heures à la livraison | `src/canalenligne.ts`, `DUREE_RESERVATION_MINUTES` et `DUREE_RESERVATION_LIVRAISON_MINUTES` (lot 1) |
| Délai d'envoi du lien d'avis (à créer) | 14 jours | `src/envoi_messages.ts`, `DELAI_AVIS_JOURS` (lot 4) |
| Commission des franchisés (à créer) | 8 % | Fiche de chaque franchise (lot 5) |

### 3.5 Process d'exploitation et code

| Process | Étape | Fichiers SMARTE | Statut | Lot |
| --- | --- | --- | --- | --- |
| Prévente | Exploration du marché | `prospection.ts`, `automatisation.ts`, `logistique.ts`, `documents.ts` | Partiel | 0 (import clients) |
| Prévente | Développement de l'offre | `logistique.ts`, `articles.ts`, `commerce.ts`, `finitions.ts` | Partiel (dépôt-vente absent) | 3 |
| Prévente | Création de contenus | `studio.ts` (cours seulement), `articles.ts` | À construire | 4 |
| Prévente | Génération de précommandes | Aucun | À construire | 3 |
| Approvisionnement | Planification | `achats.ts`, `rapports.ts`, `controle.ts` | Partiel | 3 |
| Approvisionnement | Commande fournisseurs | `achats.ts`, `fournisseurs.ts` | Partiel (pas d'acompte avant facture ni de devise) | 3 |
| Approvisionnement | Transport et dédouanement | `logistique.ts` | Partiel (coefficient non appliqué) | 3 |
| Approvisionnement | Réception et contrôle | `achats.ts`, `entrepots.ts`, `articles.ts` | Prêt | — |
| Mise en vente | Rayon et en ligne | `magasins.ts`, `finitions.ts` | Partiel | 1 |
| Mise en vente | Vente et paiement | `caisse.ts`, `facturation.ts`, `tresorerie.ts` | Partiel (Mobile Money manuel) | 1, 2 |
| Mise en vente | B2B et gros | `facturation.ts`, `mall.ts`, `commerce.ts` | Prêt | 5 (comptes du portail) |
| Mise en vente | Réseau de vente | `pilotage.ts`, `commerce.ts` | Partiel | 5 |
| Livraison | Préparation | `finitions.ts`, `pilotage.ts`, `mall.ts` | Prêt | 2 (colis automatique) |
| Livraison | Livraison suivie | `pilotage.ts` | Partiel (sans notification) | 4 |
| Livraison | SAV et garantie | `commerce.ts`, `relation.ts` | Partiel (sans IA) | 4 |
| Livraison | Fidélisation | `avis.ts`, `caisse.ts`, `automatisation.ts` | Partiel (sans envoi) | 4 |

---

## 4. Fiche technique du site web GLOMARI

### 4.1 Objectif

Présenter GLOMARI et recruter les partenaires des quatre canaux. Toute demande arrive dans le CRM de SMARTE par les formulaires publics existants (`/capture/:code`) ou dans le recrutement (`/offre-public/:code`). Le site ne garde aucune donnée de client.

### 4.2 Arborescence

| Page | Contenu | Branchement SMARTE | Statut ERP |
| --- | --- | --- | --- |
| Accueil | Message « Un seul stock, en rayon et en ligne » ; catégories (électroménager, gadgets électroniques, meubles, bien-être) ; promotions du jour ; accès boutique | Catalogue public (lot 1) | Lot 1 |
| Le Mall | Adresse, horaires, plan, espace d'accueil et retrait des commandes en ligne ; agence de Yaoundé | Aucun (contenu fixe) | — |
| Livraison et paiement | Zones et frais, agences de voyage, points relais, Mobile Money et paiement à la livraison | Zones de livraison (lecture publique à créer, lot 1) | Lot 1 |
| Devenir revendeur | Avantages du gros, grille dégressive, formulaire | Formulaire `/capture/:code` → CRM, segment « revendeurs » | Existant |
| Entreprises (B2B) | Offres de services, conventions, référence ACEP, demande de devis | Formulaire `/capture/:code` → CRM, opportunité | Existant |
| Affiliation | Principe, rémunération, inscription | Formulaire `/capture/:code` → affilié créé par le responsable | Existant (lien de suivi au lot 5) |
| Franchise (phase 2, 2029) | Modèle, commission de 8 %, villes visées, formation GTA, candidature | Formulaire `/capture/:code` | Existant |
| Formation avec GTA | Partenariat GTA, intrapreneurs SMART | Lien vers le site de GTA | — |
| Recrutement | Offres d'emploi GLOMARI | Liste et candidature par `/offre-public/:code` | Existant |
| GLOMARI Care | FAQ, garantie, retours, suivi de colis, assistant | Suivi `/suivi/:code` ; assistant (lot 4) | Partiel |
| Contact | Téléphone, WhatsApp, e-mail, formulaire | Formulaire `/capture/:code` → ticket | Existant |
| Mentions légales et données personnelles | Société, RCCM, NIU, politique de données, consentement | Aucun | Contenu à fournir |

### 4.3 Exigences

- Français et anglais.
- Pages rendues côté serveur (référencement) ; temps d'affichage court sur réseau mobile 3G et 4G.
- Consentement explicite sur chaque formulaire (déjà exigé par les routes publiques de SMARTE).
- Champ piège anti-robot (champ `site` déjà prévu par les routes publiques).
- Aucun cookie publicitaire sans consentement.

---

## 5. Fiche technique de GLOMARI Marketplace

### 5.1 Parcours et pages

| Page ou fonction | Exigence | Source SMARTE | Statut ERP | Prompt |
| --- | --- | --- | --- | --- |
| Catalogue et recherche | Catégories sur deux niveaux, marques, filtres, recherche, prix et promotion du jour | Catalogue public | Lot 1 | W3 |
| Fiche produit | 4 photos, description, prix, disponibilité par lieu, avis vérifiés, produits liés | Catalogue, disponibilité, avis | Lots 1 et 4 | W3, W8 |
| Panier | Quantités limitées au stock vendable, frais de livraison par zone | Disponibilité, zones | Lot 1 | W4 |
| Commande | Nom, téléphone, mode de livraison (domicile, agence de voyage, point relais, retrait au Mall), moyen de paiement | Commande en ligne avec réservation | Lot 1 | W4 |
| Paiement | Orange Money, MTN MoMo, paiement à la livraison | Paiement en ligne | Lot 2 | W5 |
| Suivi | Statut de la commande et du colis par lien sécurisé | Suivi de commande ; `/suivi/:code` | Lot 1 ; existant | W5 |
| Compte client | Connexion par téléphone et code à usage unique ; historique ; adresses ; points de fidélité | Comptes clients en ligne | Lot 4 (dépend des SMS) | W6 |
| Précommandes | Fiche d'arrivage, liste d'attente, acompte, suivi de l'arrivage | Précommandes | Lot 3 | W7 |
| GLOMARI Care | Assistant 24 h/24, ouverture et suivi d'un dossier SAV | Assistant Care, dossiers SAV | Lot 4 | W8 |
| Avis | Dépôt par lien vérifié reçu à J+14 ; affichage sur la fiche produit | Avis | Lot 4 | W8 |
| Affiliation | Code ou lien d'affilié retenu jusqu'à la commande | Affiliation | Lot 5 | W9 |
| Applications mobiles | Android et iOS après l'essai réel | Mêmes routes | — | W10 |

### 5.2 Cycle de vie d'une commande en ligne

```text
reservee ──(avis de paiement signé)──► payee ──► facturee ──► expediee ──► livree
    │                                                 │
    ├──(délai dépassé)──► expiree (stock libéré)      └──(retour Care)──► dossier SAV
    └──(annulation motivée)──► annulee (stock libéré)

Paiement à la livraison : reservee ──(confirmation interne)──► colis « à encaisser » ──► livree + encaissement à la remise de caisse
```

### 5.3 Règles

- Le prix affiché est toujours recalculé par SMARTE à la commande (R1).
- Le panier ne réserve rien. La réservation commence à la validation de la commande et dure `DUREE_RESERVATION_MINUTES`.
- Un client est reconnu par son téléphone dans la branche GLOMARI, comme le « client rapide » de la caisse.
- Aucune donnée de paiement (numéro de compte, code) n'est stockée par `glomari-web`.

---

## 6. Contrats d'interface entre les systèmes

### 6.1 Routes publiques de SMARTE (appelées par le navigateur)

| Méthode et route | Rôle | Statut |
| --- | --- | --- |
| `GET /marketplace/:org/catalogue` | Articles actifs de GLOMARI : id, code, nom, catégorie, marque, photos, prix TTC, promotion. Le champ `vente` contient le titre, la description et les points clés publiés, ou `null`. | Lots 1 et 4C |
| `POST /marketplace/:org/care/messages` | Poser une question, démarrer ou poursuivre une conversation | Lot 4C |
| `GET /marketplace/:org/care/conversations/:id` | Relire la conversation avec son jeton | Lot 4C |
| `POST /marketplace/:org/care/avis` | Indiquer si une réponse a aidé | Lot 4C |
| `POST /marketplace/:org/care/conseiller` | Transmettre la conversation au Service client dans un ticket | Lot 4C |
| `GET /marketplace/:org/disponibilite?produits=…` | Quantité vendable par lieu (hors avariés et réservations) | Lot 1 |
| `GET /marketplace/:org/zones` | Zones et frais de livraison, points relais actifs | Lot 1 |
| `POST /marketplace/:org/commandes` | Crée la commande et réserve le stock ; renvoie référence et lien de suivi | Lot 1 |
| `GET /marketplace/:org/commandes/:reference?jeton=…` | Statut de la commande et du colis | Lot 1 |
| `POST /marketplace/:org/commandes/:reference/payer` | Lance le paiement Mobile Money | Lot 2 |
| `GET /marketplace/:org/campagnes` (et `…/campagnes/:id`) et `POST …/campagnes/:id/inscriptions` | Campagnes ouvertes (prix, acompte, date limite, progression en %, conditions), inscription sur la liste d'attente. Jamais de quantité, de fournisseur ni de prix d'achat | Lot 3A |
| `POST /marketplace/:org/precommandes/:reference/payer` | Lance le paiement Mobile Money de l'acompte | Lot 3A |
| `GET /marketplace/:org/precommandes/:reference?jeton=…` | Suivi de la précommande : statut, étapes de l'arrivage, solde et son délai | Lot 3A |
| `POST /marketplace/:org/precommandes/:reference/solde` | Choix de la remise et création de la commande du solde, acompte déduit ; elle se paie par la route de paiement des commandes | Lot 3A |
| `POST /marketplace/:org/compte/code` et `POST /marketplace/:org/compte/connexion` | Code de connexion par SMS, puis session de 7 jours (en-tête `Authorization: Client <jeton>`) | Lot 4B |
| `GET /marketplace/:org/compte`, `…/commandes`, `…/precommandes`, `…/fidelite`, `POST …/precommandes/:reference/solde`, `…/adresses` (lecture, ajout, modification, suppression), `PATCH …/compte`, `POST …/deconnexion` | Espace client : historique, solde d'une précommande, adresses, profil, fidélité, déconnexion | Lot 4B |
| `POST /marketplace/:org/care/messages` | Conversation avec l'assistant Care | Lot 4 |
| `GET /capture/:code` et `POST /capture/:code` | Formulaires du site web → CRM | Existant |
| `GET /offre-public/:code` et `POST /offre-public/:code` | Offres d'emploi et candidatures | Existant |
| `GET /suivi/:code` | Suivi public d'un colis | Existant |
| `GET /avis-public/:code` | Dépôt d'un avis par lien vérifié | Existant |
| `GET /portail/:code` et `POST /portail/:code/commandes` | Portail grossiste | Existant |

Toutes ces routes sont limitées en débit, comme celles qui existent déjà. Elles ne renvoient jamais de coût, de marge ni de donnée d'un autre client.

### 6.2 Appels de serveur à serveur

| Appel | Sens | Mécanisme | Statut |
| --- | --- | --- | --- |
| Avis de paiement | Prestataire → SMARTE | `POST /paiements/avis/:prestataire/:org` (l'organisation dans l'adresse ouvre son cloisonnement), signature vérifiée, idempotent | Lot 2 |
| Webhooks | SMARTE → serveur Next.js | Clés et webhooks signés existants ; événements ci-dessous | Existant (événements nouveaux aux lots 1 à 4) |
| Messages | SMARTE → prestataire SMS ou WhatsApp | Interface `EnvoiMessage` | Lot 4 |
| IA | SMARTE → fournisseur IA | Interface `GenerateurIa` existante | Existant, étendu au lot 4 |

### 6.3 Événements

| Événement | Émis quand | Statut |
| --- | --- | --- |
| `expedition.creee`, `expedition.modifiee`, `colis.livre` | Colis créé, étape changée, livré | Existant |
| `facture.reglement`, `paiement.recu` | Règlement enregistré | Existant |
| `avis.recu`, `ticket.cree`, `ticket.resolu`, `prospect.capte` | Avis, ticket, prospect | Existant |
| `vente.comptoir`, `achat.recu`, `transfert.recu` | Vente en caisse, réception, transfert | Existant |
| `commande_web.creee`, `commande_web.confirmee`, `commande_web.payee`, `commande_web.facturee`, `commande_web.expiree`, `commande_web.annulee` | Cycle de la commande en ligne (confirmée : paiement à la livraison, colis créé) | Lots 1 et 2 |
| `stock.disponibilite_modifiee`, `catalogue.article_modifie` | Stock vendable ou article modifié | Lot 1 |
| `precommande.inscription_validee`, `precommande.seuil_atteint`, `precommande.arrivage_etape`, `precommande.arrivage_recu`, `precommande.soldee`, `precommande.acompte_conserve`, `precommande.a_rembourser`, `precommande.campagne_annulee`, `precommande.campagne_livree` | Cycle des précommandes ; sans nom ni téléphone, le destinataire se retrouve par la référence | Lot 3A |
| `colis.cree`, `colis.etape` | Colis créé ; étape enregistrée (statut) ; sans téléphone ni adresse | Lot 4A |

Les webhooks sont livrés au moins une fois. `glomari-web` dédoublonne par l'identifiant d'événement.

---

## 7. Charte visuelle et contenus

| Élément | Valeur |
| --- | --- |
| Indigo (principal) | `#2B0185` |
| Violet | `#6F2F9F` |
| Orange (accent, boutons d'action) | `#F4A327` |
| Lavande (fonds) | `#F6F2FB` |
| Nom | GLOMARI (Global Market International) |
| Accroche | « Un seul stock, en rayon et en ligne » |
| Univers | Électroménager, gadgets électroniques, meubles et bien-être |
| Langues | Français, anglais |
| Contenus à fournir par GLOMARI | Logo vectoriel, photos du Mall, adresse et horaires, textes légaux (RCCM, NIU), conditions générales de vente, politique de retours et de garantie |

---

## 8. PROMPT MAÎTRE (à coller en premier, dans chaque dépôt)

```text
Tu travailles sur le système numérique de GLOMARI (Global Market International), branche commerce du Groupe SGC.
Il compte trois systèmes : l'ERP SMARTE (dépôt SMARTE), le site web GLOMARI et la boutique en ligne GLOMARI Marketplace
(dépôt glomari-web). Lis d'abord docs/Fiche technique globale GLOMARI.md, puis, dans le dépôt SMARTE, CLAUDE.md,
README.md, docs/Dossier d architecture.md et docs/Couverture du cahier des charges.md.

Logique du business plan : un seul stock, au même prix, en rayon au GLOMARI Mall (Douala, Yaoundé) et en ligne ;
quatre canaux (détail, gros, B2B, réseau d'affiliés puis de franchisés) ; prévente par précommande avec acompte ;
paiement Orange Money, MTN MoMo ou à la livraison ; livraison urbaine, agence de voyage, point relais ou retrait ;
GLOMARI Care assisté par l'IA ; avis à J+14 ; fidélité séparée de GTA. Les règles R1 à R15 de la section 2 de la fiche
sont obligatoires.

Règles techniques : dans SMARTE, celles de CLAUDE.md (nouvelle migration numérotée à la suite, RLS forcée, politique
cloison, droits à erp_app, clés composites, protege() et exiger(), codes d'erreur dans MESSAGES, FCFA entiers,
aucun secret, GLOMARI et GTA jamais mélangés). Dans glomari-web : aucune clé secrète côté navigateur, aucun prix ni stock
stocké, tout vient de SMARTE.

Méthode : avant de coder, écris en français simple le plan des fichiers que tu vas créer ou modifier et attends mon accord.
Code par petites étapes, avec des tests. Lance les vérifications de la section 12 de la fiche. Mets à jour la
documentation du dépôt. Si une décision métier manque, pose la question au lieu d'inventer.
```

---

## 9. Prompts ERP (dépôt SMARTE)

### Lot 0 · Mise en service, contrôle continu, données de départ

```text
PROMPT ERP LOT 0
1. Crée .github/workflows/verification.yml : Node 22, service PostgreSQL 16, création du rôle erp_proprio
   (login, createdb, createrole), npm ci, npx tsc --noEmit, puis npx vitest run avec
   TEST_ADMIN_URL=postgres://erp_proprio:erp_proprio@localhost:5432/postgres. Le contrôle doit être vert.
2. Ajoute scripts/provisionner-glomari.ts (commande npm « provisionner:glomari »), idempotent, qui crée sous l'entité
   GLOMARI les lieux « GLOMARI Mall Douala » (magasin et entrepôt) et « Agence de Yaoundé » (magasin) avec les fonctions
   existantes de src/magasins.ts.
3. Ajoute un import de clients GLOMARI depuis un fichier .xlsx ou CSV (nom, téléphone, e-mail, ville, source),
   sur le modèle de l'import d'articles existant : doublons détectés par téléphone dans la branche, rapport d'import,
   aucun client créé dans GTA.
4. Rends la double authentification obligatoire pour les rôles qui ont tresorerie.gerer, stocks.valider,
   compta.valider, utilisateurs.gerer ou caisse.superviser, avec un code d'erreur et son message dans MESSAGES.
5. Tests pour chaque point. Ne touche à aucune migration existante.
```

Recette : contrôle GitHub vert ; script relancé deux fois sans doublon ; import des 4 000 clients sans doublon ; un trésorier sans double authentification est refusé.

### Lot 1 · Canal en ligne

```text
PROMPT ERP LOT 1
Crée le module « canal en ligne » de GLOMARI (src/canalenligne.ts), sans toucher aux migrations existantes.

Migration 0046_canal_en_ligne.sql :
- commandes_web : organisation_id, id, entite_id (branche GLOMARI), lieu_id, tiers_id, reference (unique par
  organisation), jeton_suivi_hache, statut ('reservee','payee','facturee','expediee','livree','annulee','expiree'),
  mode_livraison ('domicile','agence_voyage','point_relais','retrait_magasin'), zone_id, point_relais_id,
  frais_livraison, total_ttc, moyen_paiement ('orange_money','mtn_momo','a_la_livraison'), canal ('marketplace'),
  code_affilie, expire_le, cree_le.
- lignes_commande_web : organisation_id, commande_id, produit_id, quantite, prix_unitaire_ttc (calculé serveur).
- RLS forcée, politique cloison, droits à erp_app, clés composites ; lien vers reservations_stock.

Routes publiques (débit limité, sur le modèle de /portail/:code dans src/mall.ts) :
GET /marketplace/:org/catalogue ; GET /marketplace/:org/disponibilite ; GET /marketplace/:org/zones ;
POST /marketplace/:org/commandes ; GET /marketplace/:org/commandes/:reference?jeton=…
Contenu exact : section 6.1 de la fiche. Jamais le coût, la marge, le fournisseur ni un article de GTA.
La commande retrouve ou crée la fiche client GLOMARI par téléphone, recalcule les prix, réserve le stock et fixe
expire_le = maintenant + DUREE_RESERVATION_MINUTES (constante exportée, 30 provisoirement).

Routes internes (protege + exigerSurEntite, facturation.voir et facturation.gerer) :
GET /commandes-web, GET /commandes-web/:id, POST /commandes-web/:id/confirmer (paiement à la livraison : crée le colis
avec a_encaisser = total, fonction existante de src/pilotage.ts), POST /commandes-web/:id/annuler (motif obligatoire).
Ajoute l'écran interne « Commandes en ligne » dans public/ (liste, filtres par statut, détail, actions).

Tâche planifiée chaque minute : expirer les commandes « reservee » dépassées et libérer leur stock, une seule fois par
commande, sûre après un redémarrage.

Événements (publierEvenement) : commande_web.creee, commande_web.expiree, commande_web.annulee,
stock.disponibilite_modifiee, catalogue.article_modifie.

Tests : catalogue sans coût ni marge ; aucun article de GTA ; deux commandes simultanées ne dépassent jamais le stock ;
expiration et annulation libèrent le stock ; jeton faux refusé ; paiement à la livraison crée un colis à encaisser.
```

Recette : une commande en ligne réserve le stock du Mall et apparaît dans l'ERP en moins d'une minute ; une commande non payée expire et rend son stock.

### Lot 2 · Paiement Mobile Money

```text
PROMPT ERP LOT 2
Prérequis : prestataire de paiement choisi ; identifiants dans .env, jamais dans le code.
1. src/paiementenligne.ts : interface interchangeable sur le modèle de GenerateurIa (src/studio.ts) :
   PrestatairePaiement { initier(commande) ; verifierAvis(entetes, corps) }. Implémentation factice pour les tests,
   implémentation réelle pour le prestataire choisi.
2. POST /marketplace/:org/commandes/:reference/payer : lance le paiement (Orange Money ou MTN MoMo).
3. POST /paiements/avis/:prestataire/:org : signature vérifiée ; avis non signé refusé ; idempotent par référence du
   prestataire (contrainte d'unicité) ; montant différent refusé. Si payé, dans une seule transaction :
   encaissement dans le portefeuille par défaut du moyen (portefeuilles_defaut), facture émise (sortie de stock
   automatique existante), commande « payee » puis « facturee », colis créé.
4. Paiement reçu après expiration : statut « a_rembourser », journal, tâche au trésorier ; jamais de vente sans stock.
5. Événements commande_web.payee et commande_web.facturee.
6. Tests : avis non signé, avis rejoué, montant faux, paiement tardif. Noter dans CLAUDE.md que l'écriture comptable
   de ces encaissements reste à valider par l'expert-comptable.
```

Recette : 20 paiements de test Orange et MTN rapprochés au franc près, sans saisie manuelle.

### Lot 3 · Précommandes et achats à l'import

```text
PROMPT ERP LOT 3
Migration 0047_precommandes.sql et src/precommandes.ts (GLOMARI seulement, module achats_stocks requis) :
- campagnes_arrivage : produit, prix annoncé, acompte (FCFA ou %), seuil (quantité), date limite,
  statut ('ouverte','declenchee','annulee','livree'), bon de commande lié.
- inscriptions_precommande : campagne, client, quantité, acompte payé (lot 2), statut.
- Routes publiques GET /marketplace/:org/campagnes et POST /marketplace/:org/campagnes/:id/inscriptions.
- Seuil atteint : bon de commande fournisseur en brouillon à approuver (achats.approuver) ; aucun envoi automatique.
- Chaque étape du dossier d'importation lié publie precommande.arrivage_etape (pour informer les inscrits, lot 4).
- Réception : stock réservé pour les inscrits, puis commande_web pour le solde.
- Annulation : remboursements préparés, sortie d'argent avec tresorerie.gerer.
Achats :
- Acompte fournisseur avant facture, imputé ensuite sur la facture (compte d'avances à confirmer par l'expert).
- Prix d'achat en devise (USD, CNY, EUR) avec la table taux_change existante ; montants stockés en FCFA entiers.
- Dépôt-vente : stock confié par un fournisseur local, suivi à part, payé au fournisseur à la vente.
- Option, désactivée par défaut, pour appliquer le coefficient d'importation au coût moyen à la réception.
- Alerte quand la couverture de stock d'une catégorie dépasse 60 jours (règle R11).
Tests : seuil atteint = un seul brouillon ; acompte jamais compté deux fois ; GTA ne voit rien.
```

Recette : une campagne complète, de la liste d'attente à la livraison des précommandes.

**État au 23 novembre 2026.**

- **Partie A (précommandes) livrée** :
  - fichiers : migration `0049_precommandes.sql` (la numérotation a glissé), `src/precommandes.ts`, `public/precommandes.js` ; spécification `specs/003-precommandes-arrivage/` ;
  - les étapes publiées aux inscrits sont celles du bon de commande relié ; le dossier d'importation porte les frais ;
  - le solde se paie par une commande en ligne qui porte l'acompte ; celui-ci s'impute sur la facture par un règlement relié, sans nouvel encaissement.
- **Partie B (achats à l'import) livrée** :
  - fichiers : migration `0050_achats_import.sql`, `src/acomptes.ts`, `src/depotvente.ts`, `src/couverture.ts`, `public/depotvente.js`, onglet « Couverture » du module Stocks ; spécification `specs/004-achats-import/` ;
  - acompte au fournisseur sur un bon de commande approuvé, versé par le trésorier (`tresorerie.gerer`), imputé seul et une seule fois à la validation de la facture reliée (paiement relié, sans nouvelle sortie d'argent) ; payer une facture fournisseur exige désormais aussi le droit de trésorerie ;
  - commande en USD, CNY ou EUR au taux de `taux_change` du jour de commande, total exact en FCFA, taux figé à l'approbation ;
  - dépôt-vente : stock confié au coût 0, rémunération au choix par article (prix fixe par pièce ou commission, choix d'Achille du 23 novembre 2026), relevé qui crée la facture du fournisseur en brouillon, chaque vente relevée une seule fois ;
  - couverture de stock par catégorie (stock divisé par les ventes moyennes des 90 derniers jours), notification unique au-delà de 60 jours, avertissement à l'approbation d'une commande ;
  - l'option « coefficient d'importation au coût moyen » n'est pas construite : les frais du bon de commande entrent déjà dans le coût à la réception (décision d'Achille du 23 novembre 2026) ;
  - comptes 4091 (avances fournisseurs) et 6011 (relevés de dépôt-vente) à confirmer par l'expert-comptable.

### Lot 4 · Messages, Care et IA

```text
PROMPT ERP LOT 4
1. src/envoi_messages.ts : interface EnvoiMessage { sms, whatsapp } avec implémentation factice ; identifiants dans
   .env ; journal des envois (destinataire masqué, statut).
2. Envois automatiques, chacun désactivable par la direction : lien de suivi à la création du colis ; « en route » ;
   « livré » ; étapes d'arrivage aux inscrits des précommandes ; lien d'avis vérifié à DELAI_AVIS_JOURS (14) après
   la livraison.
3. Comptes clients en ligne : connexion par téléphone et code à usage unique envoyé par SMS ; durée de vie courte ;
   tentatives limitées ; historique des commandes, adresses, points de fidélité.
4. Assistant GLOMARI Care : POST /marketplace/:org/care/messages ; réutilise GenerateurIa ; répond à partir du catalogue,
   de la commande (jeton) et d'une base de réponses validées ; ouvre un dossier SAV s'il ne sait pas ou si le client le
   demande ; jamais de remboursement ni de promesse décidés par l'IA. Indicateur : part des conversations closes sans
   humain.
5. Studio fiches produits : brouillon de titre, description et points clés ; publication après validation par le rôle
   marketing.
6. Avis publiés : route publique des avis validés par produit, pour la fiche produit.
Tests avec implémentations factices ; aucun appel réseau réel.
```

Recette : 80 % des questions courantes réglées sans humain sur 100 conversations test (objectif du BP).

**État au 23 novembre 2026.** Le lot 4 est découpé en trois parties (décision du 23 novembre 2026).

- **Partie A (messages et avis publiés, points 1, 2 et 6) livrée** :
  - fichiers : migration `0051_messages_avis.sql`, `src/messages.ts` (le nom `envoi_messages.ts` du prompt n'est pas retenu : pas de tiret bas dans les noms de fichiers), `public/messages.js`, `public/evaluer.js` ; spécification `specs/005-messages-avis/` ;
  - les messages naissent des événements publiés (réactions appelées par `publierEvenement`), partent chaque minute entre 7 h et 21 h, trois tentatives au plus ; seul le prestataire factice existe ;
  - « prêt à retirer » seulement pour une commande en agence de voyage ou en point relais ;
  - la demande d'avis porte sur toute la commande et se note article par article ; les colis de la Marketplace étant créés sans leur facture, le client et les articles se lisent par la commande en ligne ;
  - avis publics : `GET /marketplace/:org/produits/:id/avis`, moyenne dans le catalogue.
- **Partie B (comptes clients en ligne par code SMS, point 3) livrée** :
  - fichiers : migration `0052_comptes_clients.sql`, `src/comptesclients.ts` ; spécification `specs/006-comptes-clients/` ;
  - code à six chiffres envoyé aussitôt, gardé par une empreinte à clé, 10 minutes, cinq essais ; limites par numéro et débit de la boutique ;
  - session de 7 jours (choix du 23 novembre 2026), révocable sur un appareil, sur tous, ou par l'équipe Care ;
  - historique des commandes en ligne et des précommandes, sans les achats en caisse (choix du 23 novembre 2026) ; solde payable depuis l'espace ; adresses et fidélité ;
  - l'espace client s'affiche dans `glomari-web` (W6) ; le code d'essai se lit dans l'ERP avec le prestataire factice seulement.
- **Partie C (assistant GLOMARI Care et studio des fiches produits, points 4 et 5)** : livrée le 24 novembre 2026 (demande n° 11, contrôle GitHub au vert) ; recette avec l’IA réelle sur le serveur d’essai en attente.
  - L’assistant s’appuie sur les réponses validées, les données publiques de la boutique et les commandes auxquelles le client a accès. Les conseillers retrouvent la conversation dans le ticket de relais.
  - Le studio permet de générer, corriger, publier et retirer les textes de vente, avec un historique des versions.
  - La fenêtre publique de l’assistant relève de W8 dans `glomari-web`. Les contrats et la recette sont dans `specs/007-care-studio/`.

### Lot 5 · Réseau et indicateurs (phase 2, 2029)

```text
PROMPT ERP LOT 5
1. Franchises : chaque franchise devient un lieu de stock rattaché à GLOMARI ; ses ventes sont enregistrées comme des
   ventes de caisse ; commission paramétrable par franchise (8 % par défaut, valeur du BP).
2. Vendeurs accrédités : rattachement obligatoire à un franchisé parrain ; commissions par parrain.
3. Affiliés : code dans l'adresse conservé jusqu'à la commande (champ code_affilie de commandes_web) ; page de
   l'affilié par lien secret (ventes, commissions, paiements).
4. Écran du point relais : colis déposés, retraits par code, commissions.
5. Portail grossiste : vrais comptes avec mot de passe, en plus du lien secret.
6. Nouvelles sources dans SOURCES (src/controle.ts) : marge_brute, rotation_stock, couverture_stock, clients_actifs
   (12 mois glissants), revendeurs_actifs, franchises_actives, part_ventes_en_ligne, repartition_canaux.
   Ajoute chiffre_affaires_ht : additionne factures et caisse hors taxe (aujourd'hui ca_facture est HT et
   ventes_caisse TTC).
7. Accès en lecture du tableau de bord et des états pour l'assemblée générale et le conseil d'administration.
Tests pour chaque source sur des données connues.
```

Recette : les quatre seuils de passage en phase 2 se lisent dans SMARTE sans tableur.

### Lot 6 · Innovation (phase 3, 2031) : ne pas coder

GLOMARI Pay, SMARTCOIN et conversion des points en crédit d'achat : aucun code avant l'autorisation écrite des autorités monétaires de la CEMAC.

---

## 10. Prompts site web et Marketplace (dépôt glomari-web)

### W1 · Création du projet et design

```text
PROMPT WEB W1
Crée le dépôt glomari-web : Next.js (App Router) en TypeScript, application installable (PWA), français et anglais,
tests avec Vitest et Playwright. Structure : app/(site) pour le site web, app/(boutique) pour la Marketplace,
lib/smarte pour l'accès à l'ERP, components pour l'interface.
Charte : indigo #2B0185, violet #6F2F9F, orange #F4A327 pour les boutons d'action, lavande #F6F2FB pour les fonds ;
typographie lisible sur téléphone ; contrastes accessibles.
lib/smarte : client typé des routes publiques de la section 6.1 (navigateur) et client serveur avec clé d'API lue
dans les variables d'environnement (jamais exposée au navigateur). Variables : SMARTE_URL, SMARTE_ORG,
SMARTE_CLE_API (serveur seulement), SMARTE_SECRET_WEBHOOK.
Route serveur /api/webhooks/smarte : vérifie la signature, dédoublonne par identifiant d'événement, vide le cache
du catalogue concerné.
Ajoute .github/workflows/verification.yml (types, lint, tests) et un README en français simple.
```

### W2 · Site web institutionnel

```text
PROMPT WEB W2
Construis les pages du site web listées en section 4.2 de la fiche : Accueil, Le Mall, Livraison et paiement,
Devenir revendeur, Entreprises, Affiliation, Franchise, Formation avec GTA, Recrutement, GLOMARI Care, Contact,
Mentions légales. Rendu côté serveur, métadonnées de référencement, plan du site et robots.txt.
Chaque formulaire appelle GET puis POST /capture/:code de SMARTE (un code par formulaire, en variable
d'environnement), avec consentement obligatoire et champ piège « site ». Recrutement : liste et candidature par
/offre-public/:code. Aucune donnée personnelle conservée par glomari-web.
Les contenus fixes (adresse, horaires, textes légaux) sont dans des fichiers de contenu faciles à modifier,
avec des repères [À FOURNIR] tant que GLOMARI ne les a pas donnés.
```

### W3 · Catalogue et fiche produit

```text
PROMPT WEB W3
Prérequis : ERP lot 1 en place.
Pages catalogue (catégories sur deux niveaux, marques, filtres, tri, recherche) et fiche produit (4 photos, prix TTC,
promotion du jour, disponibilité par lieu, produits de la même catégorie).
Données : GET /marketplace/:org/catalogue (mis en cache, invalidé par webhook catalogue.article_modifie) et
GET /marketplace/:org/disponibilite (jamais mis en cache plus de 30 secondes).
Ne stocke ni prix ni stock. Affiche « Disponible au Mall de Douala », « Disponible à Yaoundé » ou « Sur précommande ».
Tests : un article sans stock ne peut pas être ajouté au panier ; le prix affiché égale celui de SMARTE.
```

### W4 · Panier et commande

```text
PROMPT WEB W4
Panier côté navigateur (articles et quantités seulement, pas de prix gardé). À l'étape commande : nom, téléphone,
mode de livraison (domicile avec zone, agence de voyage avec ville, point relais, retrait au Mall), moyen de paiement.
Frais par GET /marketplace/:org/zones. Validation par POST /marketplace/:org/commandes via une route serveur
Next.js. Afficher la référence, le délai de réservation et le lien de suivi. Gérer les refus (stock insuffisant,
prix changé) avec des messages clairs.
Test Playwright : parcours complet jusqu'à la commande réservée, sur un SMARTE de test.
```

### W5 · Paiement et suivi

```text
PROMPT WEB W5
Prérequis : ERP lot 2.
Après la commande, lancer le paiement par POST /marketplace/:org/commandes/:reference/payer et suivre l'instruction
du prestataire (validation sur le téléphone du client). Page d'attente qui interroge le statut de la commande toutes
les 5 secondes, 10 minutes au plus. Ne jamais déclarer une commande payée sur la seule redirection du prestataire :
seul le statut lu dans SMARTE fait foi.
Page de suivi : statut de la commande et étapes du colis (GET /marketplace/:org/commandes/:reference?jeton=…).
Paiement à la livraison : message de confirmation et rappel du montant à remettre au livreur.
```

### W6 · Compte client et fidélité

```text
PROMPT WEB W6
Prérequis : ERP lot 4 (codes à usage unique par SMS).
Connexion par téléphone et code ; espace client : commandes, suivi, adresses, points de fidélité GLOMARI.
Session courte, déconnexion sur tous les appareils, aucune donnée sensible dans le stockage du navigateur.
```

### W7 · Précommandes

```text
PROMPT WEB W7
Prérequis : ERP lot 3.
Page « Arrivages » : campagnes ouvertes, prix annoncé, acompte, date limite, jauge du seuil (sans chiffre de stock
fournisseur). Inscription avec paiement de l'acompte (même parcours que W5). Page de suivi de l'arrivage pour
l'inscrit. Message clair : précommande avec acompte, solde à la réception, remboursement si la campagne est annulée.
```

### W8 · GLOMARI Care et avis

```text
PROMPT WEB W8
Prérequis : ERP lot 4.
Fenêtre de conversation Care sur toutes les pages (POST /marketplace/:org/care/messages), avec bouton « Parler à un
conseiller » qui ouvre un dossier SAV et affiche son numéro. Affichage des avis validés sur la fiche produit
(note moyenne, nombre d'avis, avis récents). Le dépôt d'un avis passe par le lien vérifié reçu par SMS ou WhatsApp.
```

### W9 · Affiliation

```text
PROMPT WEB W9
Prérequis : ERP lot 5.
Lire le code d'affilié dans l'adresse (?a=CODE), le conserver 30 jours dans un cookie de première partie
(durée à confirmer par la direction) et l'envoyer avec la commande. Page d'explication de l'affiliation reliée au
formulaire d'inscription du site web.
```

### W10 · Applications mobiles (après l'essai réel)

```text
PROMPT WEB W10
Crée les applications Android et iOS en React Native (Expo), qui réutilisent lib/smarte et les écrans de la
Marketplace : catalogue, panier, commande, paiement, suivi, compte, précommandes, Care. Notifications push pour le
suivi du colis. Publication sous les comptes développeur au nom de SGC.
```

---

## 11. Prompts d'intégration et de tests de bout en bout

```text
PROMPT INTÉGRATION I1 · Scénario complet
Monte un environnement de test avec SMARTE (base PostgreSQL de test, provisionnement SGC et GLOMARI, 3 articles,
stock au Mall) et glomari-web pointant vers lui, avec le prestataire de paiement factice et l'envoi de messages factice.
Écris un test Playwright qui enchaîne : affichage du catalogue → ajout au panier → commande avec livraison à domicile
→ paiement Orange Money factice → avis de paiement signé reçu par SMARTE → facture émise → stock diminué →
colis créé → page de suivi à jour → colis livré → lien d'avis envoyé (horloge avancée de 14 jours) → avis publié.
Le test vérifie à chaque étape la donnée dans SMARTE, pas seulement l'écran.
```

```text
PROMPT INTÉGRATION I2 · Concurrence et pannes
Teste : deux clients commandent le dernier article en même temps (un seul réussit) ; l'avis de paiement arrive deux
fois (un seul encaissement) ; le webhook vers glomari-web échoue puis reprend (aucun doublon) ; SMARTE indisponible
(la Marketplace affiche un message clair et ne prend aucune commande).
```

```text
PROMPT INTÉGRATION I3 · Cloisonnement
Vérifie qu'aucune route publique ne renvoie un article, un client ou une commande de GTA ou d'une autre organisation,
même avec des identifiants devinés.
```

---

## 12. Vérifications et recette

**Dépôt SMARTE, à chaque lot :**

```sh
npm ci
npx tsc --noEmit
TEST_ADMIN_URL=postgres://erp_proprio:erp_proprio@localhost:5432/postgres npx vitest run
```

**Dépôt glomari-web, à chaque lot :**

```sh
npm ci
npx tsc --noEmit
npm run lint
npx vitest run
npx playwright test
```

**Contrôles communs :**
- 0 erreur de types et 100 % des tests verts, nouveaux tests compris.
- Nouvelle table SMARTE : RLS forcée, politique `cloison`, droits `erp_app`, clés composites.
- Nouveau code d'erreur présent dans `MESSAGES`.
- Aucune clé secrète dans le code de `glomari-web` exécuté par le navigateur (recherche des noms de variables dans le bundle).
- Documentation mise à jour : section « État » de `CLAUDE.md`, `docs/Couverture du cahier des charges.md`, README de `glomari-web`.
- Demande de fusion avec contrôles GitHub verts et relecture par le responsable technique.

**Avant toute vraie donnée :**
- essai privé sur le serveur ;
- sauvegardes chiffrées et restauration testée ;
- validation de l'expert-comptable ;
- DSF officielle de la DGI ;
- test d'intrusion ;
- vérification par un juriste du cadre camerounais de protection des données personnelles.

---

## 13. Prompt d'ajustement rapide

```text
Dans le dépôt [SMARTE ou glomari-web], en respectant CLAUDE.md et la Fiche technique globale GLOMARI :
change [PARAMÈTRE] de [VALEUR ACTUELLE] à [NOUVELLE VALEUR], décidé par [NOM] le [DATE].
Montre-moi d'abord les fichiers et lignes concernés. Mets à jour les tests qui dépendent de cette valeur,
lance les vérifications de la section 12, puis note la décision dans la documentation du dépôt.
```

Exemples :
- remise maximale du caissier de 10 % à 15 % ;
- durée de réservation d'un panier de 30 à 45 minutes ;
- nouveau rôle « Juridique et recouvrement » avec les permissions de facturation en lecture ;
- nouvelle zone de livraison ;
- changement d'un texte du site web ;
- ajout d'une catégorie au menu de la Marketplace.

---

## 14. Décisions attendues de la direction

| Décision | Bloque | Valeur provisoire |
| --- | --- | --- |
| Hébergeur et budget | ERP lot 0, W1 | Aucune |
| Prestataire de paiement Mobile Money | ERP lot 2, W5 | Aucune |
| Prestataire SMS et WhatsApp | ERP lot 4, W6, W8 | Les deux, désactivables |
| Durée de réservation d'un panier non payé | ERP lot 1 | 30 minutes |
| Durée de conservation du code d'affilié | W9 | 30 jours |
| Prestataire de la plateforme : développeur de SGC ou sous-traitant | Tous les lots | À confirmer |
| Next.js pour glomari-web | W1 | Recommandé, à valider par le responsable technique |
| Application du coefficient d'importation au coût moyen | ERP lot 3 | Tranchée le 23 novembre 2026 : pas d'option, les frais du bon de commande suffisent |
| Contenus du site : adresse du Mall, horaires, textes légaux, conditions de vente, politique de retours | W2 | [À FOURNIR] |
