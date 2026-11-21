# Fiche technique d'ajustement GLOMARI sur Smarte Solutions

Version 1.0 du 20 novembre 2026. Établie par THE PLUG à partir du business plan GLOMARI 2027-2031 (draft 05), du diagramme stratégique GLOMARI et du dépôt `thepluggroup-co/SMARTE` au commit `fd91101` du 13 novembre 2026.

Cette fiche a deux usages :

1. **Fiche technique** : elle dit où se règle chaque paramètre métier et ce qui manque, pour ajuster l'ERP sans le relire en entier.
2. **Prompt d'ajustement** : chaque bloc « PROMPT » se colle tel quel dans l'assistant de code de VS Code (Claude Code, Copilot Chat ou équivalent), dépôt SMARTE ouvert. Un seul lot par branche et par demande de fusion.

Le document de référence fonctionnel est le **Manuel d'intégration GLOMARI × Smarte Solutions**. En cas de doute, le manuel décide du besoin, et `CLAUDE.md` du dépôt décide des règles techniques.

---

## 0. Mode d'emploi dans VS Code

1. Ouvrir le dossier du dépôt SMARTE dans VS Code. Placer cette fiche dans `docs/`.
2. Créer une branche par lot : `git checkout -b lot1-canal-en-ligne` (exemple).
3. Coller d'abord le **PROMPT MAÎTRE** (section 5), puis le bloc du lot voulu (section 6).
4. Laisser l'assistant travailler, puis exiger les vérifications de la section 7 avant toute fusion.
5. Pour un simple réglage (une valeur, un libellé, un rôle), utiliser le **PROMPT D'AJUSTEMENT RAPIDE** (section 8).

Prérequis sur le poste : Node.js 22, Docker ou PostgreSQL 16 local, `npm ci` réussi.

---

## 1. Carte d'identité du système

| Élément | Valeur constatée |
| --- | --- |
| Produit | Smarte Solutions, ERP SaaS du Groupe Smart Global Concepts (SGC, Douala) |
| Branche concernée | GLOMARI, code `GLOMARI`, domaine `commerce`, sous l'entité racine `SGC` |
| Modules actifs sur GLOMARI | crm, support, pilotage, facturation, achats_stocks, commerce, rh_paie, tresorerie, comptabilite, transport (`src/provisionnement.ts`, `STRUCTURE_SGC`) |
| Langage et cadre | TypeScript, Node 22, Fastify 5, PostgreSQL 16, monolithe modulaire |
| Écrans | JavaScript sans framework dans `public/` (provisoires ; React proposé par le dossier d'architecture) |
| Isolation | Sécurité au niveau des lignes forcée (`org_courante()`, politique `cloison`), compte applicatif `erp_app` |
| Taille | 55 fichiers dans `src/` (18 942 lignes), 45 migrations, 41 fichiers de tests |
| Vérification du 20/11/2026 | `npx tsc --noEmit` sans erreur ; `npx vitest run` : 404 tests réussis sur 404, avec le rôle restreint |
| Statut déclaré | Prêt pour un essai privé avec données fictives. Pas pour de vraies données ni une ouverture au public |
| Manque relevé | `.github/workflows/verification.yml` cité dans `CLAUDE.md` mais absent du dépôt |

---

## 2. Règles non négociables

Toutes viennent de `CLAUDE.md` et `README.md`, sauf celles marquées « GLOMARI ».

- GTA fait uniquement les formations, GLOMARI uniquement les stocks. Ne jamais mélanger.
- Fichiers clients et points de fidélité séparés par branche.
- Seul le super administrateur donne et retire les accès.
- Toute nouvelle table de client porte `organisation_id`, active et force la RLS, crée la politique `cloison`, accorde ses droits à `erp_app` et utilise des clés étrangères composites incluant `organisation_id`.
- Ne jamais modifier une migration déjà appliquée : en ajouter une, numérotée à la suite (prochaine : `0046`).
- Toute requête authentifiée passe par `protege()` ; tout droit se vérifie côté serveur avec `exiger()` ou `exigerSurEntite()`.
- Tout code d'erreur renvoyé par le serveur a son message dans `MESSAGES` (`public/app.js`).
- Argent en FCFA entiers. Une sortie d'argent exige `tresorerie.gerer` (seule exception : remboursement d'un retour de caisse par `caisse.superviser`). Paiements, factures validées et billets sont figés par déclencheurs.
- TVA libre et facultative : jamais de taux imposé dans le code.
- Titres de documents et noms de fichiers sans tiret ni tiret bas (fichiers imposés par les outils et noms de fichiers de code existants exceptés).
- Comptabilité, paie et DSF : toujours écrire que cela ne remplace pas un expert agréé.
- Aucun secret dans le dépôt, jamais de mot de passe demandé ou écrit dans le code.
- Réponses en français simple : le responsable, Achille Satieu, n'est pas développeur.
- **GLOMARI** : un seul stock et un seul prix. Aucun canal (Marketplace, caisse, portail) ne garde ses propres prix ou quantités.
- **GLOMARI** : un paiement en ligne n'est valide que sur avis signé de l'opérateur ou de l'agrégateur, jamais sur la parole du navigateur.
- **GLOMARI** : aucune clé d'API dans le code exécuté par le navigateur.

---

## 3. Paramètres ajustables (sans nouvelle fonction)

| Paramètre | Valeur actuelle | Où le changer | Qui décide |
| --- | --- | --- | --- |
| Structure du groupe et modules par entité | SGC > GLOMARI, GTA (> IP2EL, SMARTE, FOUNDATION) | `src/provisionnement.ts`, constante `STRUCTURE_SGC` (au provisionnement seulement ; ensuite par l'écran des entités) | Direction SGC |
| Rôles et permissions de départ | 37 rôles | `src/catalogue.ts`, `ROLES_INITIAUX` et `PERMISSIONS` | Super administrateur |
| Seuil de marge faible en achat | 20 % | `src/achats.ts`, `SEUIL_MARGE_FAIBLE` | Direction GLOMARI |
| Remise maximale d'un caissier | 10 % | `src/caisse.ts`, `REMISE_MAX_CAISSIER` | Direction GLOMARI |
| Alerte avant expiration d'un lot | 30 jours | `src/entrepots.ts`, `JOURS_ALERTE_EXPIRATION` | Responsable des opérations |
| Longueur minimale du mot de passe | 8 caractères | `src/serveur.ts` (schémas `minLength: 8`, lignes 367, 521, 618) et `src/finitions.ts` ligne 225 | Super administrateur |
| Planches d'étiquettes | A4 de 24, 40, 65 ; rouleau 50 × 30 mm | `public/mall.js`, `PLANCHES` | Responsable des magasins |
| Sources d'indicateurs | 8 sources | `src/controle.ts`, `SOURCES` | Responsable du pilotage |
| Vignettes du tableau de bord GLOMARI | Ventes, Achats, Sorties ou dépenses, Bénéfice | `src/tableau.ts`, `public/tableau.js` (`ICONES_TDB`) | Direction GLOMARI |
| Messages d'erreur affichés | Liste `MESSAGES` | `public/app.js` | Tous lots |
| Clé et modèle du studio IA | Non définis | `.env` : `ERP_IA_CLE`, `ERP_IA_MODELE` | Direction SGC |
| Dossier des vidéos et pièces jointes | Non défini | `.env` : `ERP_DOSSIER_MEDIAS` | Responsable technique |
| Séparation des tâches | Active pour les pertes par défaut | Table `regles_separation` (écran de réglage) | Super administrateur |

---

## 4. Correspondance business plan → code

| Process du BP | Étape | Fichiers à connaître | Statut |
| --- | --- | --- | --- |
| Prévente | Exploration du marché | `src/prospection.ts` (formulaires, score, segments), `src/automatisation.ts` (ABC, dormants), `src/logistique.ts` (dossiers d'import) | Partiel |
| Prévente | Développement de l'offre | `src/logistique.ts` (demandes de prix, offres), `src/articles.ts` (marques), `src/commerce.ts` et `src/finitions.ts` (paliers, grilles) | Partiel, sans dépôt-vente |
| Prévente | Création de contenus | `src/studio.ts` (cours seulement), `src/articles.ts` (photos) | À construire |
| Prévente | Génération de précommandes | Rien | À construire |
| Approvisionnement | Planification | `src/achats.ts` (`/achats/reapprovisionnement`), `src/rapports.ts` (prévision), `src/controle.ts` (budgets) | Partiel |
| Approvisionnement | Commande fournisseurs | `src/achats.ts`, `src/fournisseurs.ts` | Partiel, sans acompte avant facture ni devise |
| Approvisionnement | Transport et dédouanement | `src/logistique.ts` (`dossiers_import`, `frais_import`) | Partiel, coefficient non appliqué au coût moyen |
| Approvisionnement | Réception et contrôle | `src/achats.ts`, `src/entrepots.ts`, `src/articles.ts` (EAN13) | Prêt |
| Mise en vente | Rayon et en ligne | `src/magasins.ts`, `src/finitions.ts` (emplacements), Marketplace absente | Partiel |
| Mise en vente | Vente et paiement | `src/caisse.ts`, `src/facturation.ts`, `src/tresorerie.ts` | Partiel, Mobile Money manuel |
| Mise en vente | B2B et gros | `src/facturation.ts`, `src/mall.ts` (`/portail/:code`), `src/commerce.ts` (`comptes_pro`) | Prêt |
| Mise en vente | Réseau de vente | `src/pilotage.ts` (affiliés), `src/commerce.ts` (vendeurs, franchises) | Partiel |
| Livraison | Préparation | `src/finitions.ts` (préparation par scan), `src/pilotage.ts` (colis, tournées), `src/mall.ts` (points relais) | Prêt |
| Livraison | Livraison suivie | `src/pilotage.ts` (`/suivi/:code`, zones, flotte) | Partiel, sans notification |
| Livraison | SAV et garantie | `src/commerce.ts` (`dossiers_sav`, retours), `src/relation.ts` (tickets) | Partiel, sans IA |
| Livraison | Fidélisation | `src/avis.ts`, `src/caisse.ts` (fidélité), `src/automatisation.ts` (règles si-alors) | Partiel, sans envoi |

Modèle à imiter pour toute route publique : `GET /portail/:code` et `POST /portail/:code/commandes` dans `src/mall.ts` (débit limité, prix recalculé côté serveur, jamais le coût ni la marge).

---

## 5. PROMPT MAÎTRE (à coller en premier)

```text
Tu travailles sur le dépôt Smarte Solutions, l'ERP du Groupe SGC. Lis d'abord CLAUDE.md, README.md,
docs/Dossier d architecture.md, docs/Couverture du cahier des charges.md et docs/Fiche technique d ajustement GLOMARI.md.

Contexte métier : GLOMARI est la branche commerce de SGC. Son business plan 2027-2031 repose sur un seul stock,
vendu au même prix au GLOMARI Mall (Douala, Yaoundé) et sur la plateforme GLOMARI Marketplace (web puis Android et iOS),
avec paiement Mobile Money ou à la livraison, livraison suivie, SAV GLOMARI Care et réseau d'affiliés puis de franchisés.

Règles absolues : celles de CLAUDE.md et de la section 2 de la fiche technique. En particulier : nouvelle migration
numérotée à la suite (jamais modifier une migration appliquée) ; RLS forcée, politique cloison, droits à erp_app,
clés composites avec organisation_id ; protege() et exiger() côté serveur ; codes d'erreur ajoutés à MESSAGES ;
FCFA entiers ; aucun secret ; GLOMARI et GTA jamais mélangés.

Méthode : avant de coder, écris en français simple le plan des fichiers que tu vas créer ou modifier et attends mon accord.
Ensuite code par petites étapes, ajoute les tests vitest dans tests/ (avec le rôle restreint, jamais en super utilisateur),
puis lance npx tsc --noEmit et les tests. Termine en mettant à jour la section « État » de CLAUDE.md
et docs/Couverture du cahier des charges.md. Si une décision métier manque, pose la question au lieu d'inventer.
```

---

## 6. Lots de travaux

Ordre imposé : 0, 1, 2, 3, 4, puis 5. Le lot 6 n'est pas à coder avant les autorisations réglementaires.

### Lot 0 · Mise en service et contrôle continu

**Objectif.** Rendre le dépôt vérifiable automatiquement et préparer les lieux de GLOMARI.

```text
PROMPT LOT 0
1. Crée .github/workflows/verification.yml : Node 22, service PostgreSQL 16, création du rôle erp_proprio
   (login, createdb, createrole), npm ci, npx tsc --noEmit, puis npx vitest run avec
   TEST_ADMIN_URL=postgres://erp_proprio:erp_proprio@localhost:5432/postgres. Le contrôle doit être vert.
2. Ajoute scripts/provisionner-glomari.ts (commande npm « provisionner:glomari ») qui crée, sous l'entité GLOMARI déjà
   provisionnée, les lieux suivants par les fonctions existantes de src/magasins.ts : « GLOMARI Mall Douala »
   (magasin et entrepôt) et « Agence de Yaoundé » (magasin). Le script est idempotent (ne recrée pas un lieu existant).
3. Rends la double authentification obligatoire pour les rôles qui ont tresorerie.gerer, stocks.valider,
   compta.valider, utilisateurs.gerer ou caisse.superviser : refus de connexion sans 2FA active, avec un code d'erreur
   et son message dans MESSAGES. Ajoute les tests.
4. Ne touche à aucune migration existante.
```

**Recette.** Contrôle GitHub vert sur la branche ; script relancé deux fois sans doublon ; un compte trésorier sans double authentification est refusé.

### Lot 1 · Canal en ligne dans l'ERP et Marketplace

**Objectif.** Une commande passée sur la Marketplace réserve le stock du Mall et apparaît dans l'ERP.

```text
PROMPT LOT 1
Crée le module « canal en ligne » de GLOMARI, sans toucher aux migrations existantes.

Base de données (migration 0046_canal_en_ligne.sql) :
- commandes_web : organisation_id, id, entite_id (branche GLOMARI), lieu_id (lieu qui sert la commande), tiers_id,
  reference unique par organisation, jeton_suivi (aléatoire, haché en base), statut parmi
  ('reservee','payee','facturee','expediee','livree','annulee','expiree'), mode_livraison parmi
  ('domicile','agence_voyage','point_relais','retrait_magasin'), zone_id, point_relais_id, frais_livraison,
  total_ttc, moyen_paiement parmi ('orange_money','mtn_momo','a_la_livraison'), expire_le, cree_le.
- lignes_commande_web : organisation_id, commande_id, produit_id, quantite, prix_unitaire_ttc (calculé serveur).
- RLS forcée, politique cloison, droits à erp_app, clés composites. Lien vers reservations_stock existant.

Routes publiques, débit limité, sur le modèle de /portail/:code dans src/mall.ts :
- GET /marketplace/:org/catalogue : articles actifs de la branche GLOMARI, catégories, marques, photos, prix de vente,
  promotion du jour. Jamais le coût, la marge ni les fournisseurs.
- GET /marketplace/:org/disponibilite?produits=... : quantité vendable par lieu (hors avariés et hors réservations).
- POST /marketplace/:org/commandes : nom, téléphone, lignes, mode de livraison. Prix recalculés serveur. Crée ou
  retrouve la fiche client GLOMARI par téléphone (règle déjà utilisée par le « client rapide » de la caisse), réserve
  le stock, fixe expire_le = maintenant + DUREE_RESERVATION_MINUTES (constante exportée, valeur provisoire 30,
  à confirmer par la direction). Renvoie la référence et un lien de suivi contenant le jeton.
- GET /marketplace/:org/commandes/:reference?jeton=... : statut de la commande et du colis.

Routes internes (protege + exigerSurEntite, permissions existantes facturation.voir et facturation.gerer) :
- GET /commandes-web, GET /commandes-web/:id, POST /commandes-web/:id/annuler (motif obligatoire, libère la réservation).

Tâche planifiée : chaque minute, passer en « expiree » les commandes « reservee » dont expire_le est dépassé et libérer
leurs réservations. Une seule exécution par commande, sûre en cas de redémarrage.

Événements publiés avec publierEvenement : commande_web.creee, commande_web.expiree, commande_web.annulee.
Ajoute aussi stock.disponibilite_modifiee (produit, lieu, quantité vendable) à chaque mouvement de stock, pour que les
webhooks existants préviennent la Marketplace.

Tests : catalogue sans coût ni marge ; aucun produit de GTA visible ; deux commandes simultanées ne réservent jamais
plus que le stock ; expiration libère le stock ; un jeton faux ne montre rien.

Ne construis PAS encore le paiement en ligne (lot 2). Le moyen « a_la_livraison » crée le colis à la confirmation
interne de la commande, avec livraison contre paiement (fonction existante de src/pilotage.ts).
```

**Application Marketplace (dépôt séparé `glomari-marketplace`).** Application web installable (PWA) en React, comme le propose le dossier d'architecture, bilingue français et anglais, qui n'appelle que les routes publiques ci-dessus. Aucun prix ni stock propre. Android et iOS après l'essai réel.

**Recette.** Une commande en ligne réserve le stock du Mall et apparaît dans l'ERP en moins d'une minute ; une commande non payée expire et rend son stock.

### Lot 2 · Paiement Mobile Money

**Objectif.** Une commande payée par Orange Money ou MTN MoMo est encaissée, facturée et sortie du stock sans saisie.

```text
PROMPT LOT 2
Prérequis : le prestataire de paiement est choisi et ses identifiants sont dans .env (jamais dans le code).

1. Crée src/paiement_en_ligne.ts avec une interface interchangeable, sur le modèle de GenerateurIa (src/studio.ts) :
   PrestatairePaiement { initier(commande): { url_ou_instruction, reference_prestataire };
   verifierAvis(entetes, corps): { valide, reference_prestataire, montant, statut } }.
   Fournis une implémentation factice pour les tests et une implémentation réelle pour le prestataire choisi.
2. POST /marketplace/:org/commandes/:reference/payer : lance le paiement pour le moyen choisi.
3. POST /paiements/avis/:prestataire (public) : vérifie la signature ; refuse tout avis non signé ; idempotent par
   reference_prestataire (contrainte d'unicité) ; refuse si le montant diffère du total de la commande.
   Si payé : encaissement dans le portefeuille par défaut du moyen (table portefeuilles_defaut), facture émise
   (sortie de stock automatique existante), commande « payee » puis « facturee », création du colis.
   Tout dans une seule transaction.
4. Événements : commande_web.payee, commande_web.facturee.
5. Tests : avis non signé refusé ; avis rejoué deux fois = un seul encaissement ; montant faux refusé ;
   paiement reçu après expiration = remboursement à traiter (statut dédié, journal), jamais de vente sans stock.
L'écriture comptable de ces encaissements reste à valider par l'expert-comptable : le dire dans CLAUDE.md.
```

**Recette.** 20 paiements de test Orange et MTN rapprochés au franc près, sans saisie manuelle.

### Lot 3 · Précommandes et achats à l'import

**Objectif.** Faire tourner la prévente du BP : arrivage annoncé, acomptes, seuil, commande au fabricant, livraison des précommandes.

```text
PROMPT LOT 3
Migration 0047_precommandes.sql et module src/precommandes.ts (branche GLOMARI seulement, module achats_stocks requis) :
- campagnes_arrivage : produit, prix de vente annoncé, acompte (en FCFA ou en %), seuil de déclenchement (quantité),
  date limite, statut ('ouverte','declenchee','annulee','livree'), bon de commande lié.
- inscriptions_precommande : campagne, client, quantité, acompte payé (via le lot 2), statut.
- Page publique de campagne et inscription (même modèle que les routes Marketplace).
- Quand le seuil est atteint : bon de commande fournisseur en brouillon à approuver (achats.approuver) ;
  jamais d'envoi automatique au fournisseur.
- À la réception : réservation du stock pour les inscrits, puis commande_web pour le solde.
- Annulation de campagne : remboursement des acomptes à préparer, sortie d'argent avec tresorerie.gerer.
Achats :
- Acompte au fournisseur avant sa facture, imputé ensuite sur la facture fournisseur (compte d'avances fournisseurs à
  confirmer par l'expert-comptable).
- Prix d'achat en devise (USD, CNY, EUR) avec taux daté de la table des taux existante ; montants stockés en FCFA entiers.
- Option, désactivée par défaut, pour appliquer le coefficient du dossier d'importation au coût moyen à la réception.
Tests : seuil atteint = un seul brouillon de commande ; un acompte n'est jamais compté deux fois ; GTA ne voit rien.
```

**Recette.** Une campagne complète : liste d'attente, acomptes, seuil, bon de commande, réception, livraison des précommandes.

### Lot 4 · Relation client automatisée et IA

**Objectif.** Informer le client sans intervention humaine et faire de GLOMARI Care un service 24 h/24.

```text
PROMPT LOT 4
1. src/envoi_messages.ts : interface interchangeable EnvoiMessage { sms, whatsapp } avec implémentation factice
   pour les tests. Identifiants dans .env. Journal de chaque envoi (destinataire masqué, statut).
2. Envois automatiques, chacun désactivable par la direction : lien de suivi à la création du colis ;
   « en route » et « livré » ; lien d'avis vérifié 14 jours après la livraison (DELAI_AVIS_JOURS = 14).
3. Assistant GLOMARI Care : réutilise GenerateurIa (src/studio.ts). Il répond à partir du catalogue, de la commande
   du client (jeton) et d'une base de réponses validées. S'il ne sait pas, ou si le client le demande, il ouvre un
   dossier SAV (src/commerce.ts) et le dit au client. Jamais de remboursement ou de promesse décidés par l'IA.
4. Studio fiches produits : route qui rédige en brouillon titre, description et points clés d'un article à partir de
   ses données ; publication seulement après validation par le rôle marketing.
Tests avec les implémentations factices ; aucun appel réseau réel dans les tests.
```

**Recette.** Sur 100 conversations test, 80 % des questions courantes réglées sans humain (objectif du BP) ; aucun dossier perdu.

### Lot 5 · Réseau et indicateurs de phase 2 (2029)

```text
PROMPT LOT 5
1. Franchises : chaque franchise devient un lieu de stock rattaché à GLOMARI, avec ses ventes enregistrées comme les
   ventes de caisse ; commission de 8 % (valeur du BP) paramétrable par franchise.
2. Affiliés : lien de suivi (code dans l'adresse, conservé jusqu'à la commande Marketplace) et page de l'affilié
   (ventes, commissions, paiements) par lien secret.
3. Écran simple du point relais : colis déposés, retraits par code, commissions.
4. Nouvelles sources dans SOURCES (src/controle.ts) : marge_brute (%), rotation_stock (jours), clients_actifs
   (achat sur 12 mois glissants), revendeurs_actifs, franchises_actives, part_ventes_en_ligne.
5. Corrige l'addition du chiffre d'affaires : ca_facture est hors taxe, ventes_caisse toutes taxes comprises ;
   ajoute une source chiffre_affaires_ht qui additionne des montants hors taxe.
Tests pour chaque source sur des données connues.
```

**Recette.** Les quatre seuils de passage en phase 2 (CA 2028 ≥ 1,9 Md FCFA, marge brute ≥ 25 %, rotation ≤ 60 jours, trésorerie ≥ 100 M FCFA) se lisent dans l'ERP sans tableur.

### Lot 6 · Innovation (phase 3, 2031) : ne pas coder maintenant

GLOMARI Pay, SMARTCOIN et fidélité convertie en crédit d'achat supposent des autorisations des autorités monétaires de la CEMAC. Aucun code avant ces autorisations écrites.

---

## 7. Vérifications obligatoires à la fin de chaque lot

```sh
npm ci
npx tsc --noEmit
TEST_ADMIN_URL=postgres://erp_proprio:erp_proprio@localhost:5432/postgres npx vitest run
```

- Supprimer la base `erp_test` avant de relancer si un test a été interrompu.
- 0 erreur de types, 100 % des tests verts, nouveaux tests compris.
- Toute nouvelle table : RLS forcée, politique `cloison`, droits `erp_app`, clés composites. Le vérifier dans la migration.
- Tout nouveau code d'erreur présent dans `MESSAGES`.
- Section « État » de `CLAUDE.md` et `docs/Couverture du cahier des charges.md` mises à jour.
- Demande de fusion avec le contrôle GitHub vert ; relecture par le responsable technique.

---

## 8. PROMPT D'AJUSTEMENT RAPIDE

À utiliser pour un réglage qui ne crée pas de fonction nouvelle (section 3).

```text
Dans le dépôt Smarte Solutions, en respectant CLAUDE.md :
change [PARAMÈTRE] de [VALEUR ACTUELLE] à [NOUVELLE VALEUR], décidé par [NOM] le [DATE].
Montre-moi d'abord les fichiers et lignes concernés. Mets à jour les tests qui dépendent de cette valeur,
lance npx tsc --noEmit et les tests, puis note la décision dans la section « État » de CLAUDE.md.
```

Exemples : remise maximale du caissier de 10 % à 15 % ; alerte d'expiration de 30 à 45 jours ; ajout d'une vignette au tableau de bord GLOMARI ; nouveau rôle « Juridique et recouvrement » avec les permissions de facturation en lecture.

---

## 9. Décisions attendues de la direction

| Décision | Bloque | Valeur provisoire dans cette fiche |
| --- | --- | --- |
| Hébergeur et budget | Lot 0 | Aucune |
| Prestataire de paiement Mobile Money | Lot 2 | Aucune |
| Durée de réservation d'un panier non payé | Lot 1 | 30 minutes |
| Canal des messages clients : SMS, WhatsApp ou les deux | Lot 4 | Les deux, désactivables |
| Prestataire de la plateforme : développeur interne de SGC ou sous-traitant | Lots 1 à 5 | À confirmer |
| Application du coefficient d'importation au coût moyen | Lot 3 | Désactivée |
