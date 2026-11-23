---

description: "Liste des tâches des messages automatiques et des avis publiés de GLOMARI (lot 4, partie A)"
---

# Tâches : messages automatiques et avis publiés de GLOMARI (lot 4, partie A)

**Entrée** : documents de `specs/005-messages-avis/` ; besoin : `docs/Fiche technique globale GLOMARI.md`, section 9 (lot 4, points 1, 2 et 6), règles R4, R7 et R9

**Prérequis** : [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests** : demandés (fiche, lot 4 : « tests avec implémentations factices ; aucun appel réseau réel »). Dans chaque étape, le fichier de test s'écrit d'abord. Les tests tournent dans GitHub Actions (pas de PostgreSQL sur le poste).

**Contraintes de champ** : `data-model.md` fait foi ; les tâches citent `Entité.champ`.

## Format : `[ID] [P?] [Story] Description`

- **[P]** : parallélisable (autre fichier, aucune dépendance non terminée)
- **[US1]** à **[US5]** : parcours de la spécification

---

## Phase 1 : préparation

- [X] T001 Vérifier que la branche `lot4a-messages-avis` part de `main` à jour (lot 3B fusionné, demande n° 8) et y versionner `specs/005-messages-avis/`.
- [X] T002 Créer `src/messages.ts` avec `enregistrerMessages(app, pool, outils, urlPublique, prestataire?)` vide, et l'enregistrer dans `src/serveur.ts` après `enregistrerCouverture`, avec `options.urlPublique`.

---

## Phase 2 : fondations (bloquent tous les parcours)

- [X] T003 Écrire `migrations/0051_messages_avis.sql` selon data-model.md, sans modifier aucune migration existante.
  - Table `reglages_messages` : `reglages_messages.organisation_id`, `reglages_messages.branche_id`, `reglages_messages.type`, `reglages_messages.actif`, `reglages_messages.canal`, `reglages_messages.modifie_par`, `reglages_messages.modifie_le` ; clé primaire et audit.
  - Table `envois_messages` : `envois_messages.id`, `envois_messages.organisation_id`, `envois_messages.branche_id`, `envois_messages.type`, `envois_messages.cle` (unique par organisation), `envois_messages.objet_type`, `envois_messages.objet_id`, `envois_messages.statut`, `envois_messages.canal`, `envois_messages.numero_masque`, `envois_messages.du_le`, `envois_messages.tentatives`, `envois_messages.essai_le`, `envois_messages.envoye_le`, `envois_messages.erreur`, `envois_messages.reference_prestataire`, `envois_messages.renvoi_de`, `envois_messages.renvoye_par`, `envois_messages.cree_le` ; checks et index.
  - Colonnes : `tiers.ne_pas_contacter` ; `retours_clients.produit_id`, avec l'unicité par demande et par article à la place de l'unicité sur `demande_id`, et son index.
  - Contraintes élargies : `demandes_retour.cible_type` (`commande`) et `demandes_retour.source_type` (`vente_comptoir`), par `alter table … drop constraint … add constraint`.
  - RLS forcée, politique `cloison` et droits `erp_app` sur les deux tables nouvelles.
- [X] T004 [P] Dans `src/base.ts`, ajouter `export const reactionsEvenements: ((c: Client, type: string, charge: Record<string, unknown>) => Promise<void>)[] = []`, appelées par `publierEvenement` après l'insertion, dans la même transaction (research.md R1).
- [X] T005 Dans `src/messages.ts`, le socle de l'envoi :
  - `TYPES_MESSAGES` (libellé, défaut actif et canal) selon data-model.md ;
  - constantes `HEURE_DEBUT_ENVOI = 7`, `HEURE_FIN_ENVOI = 21`, `TENTATIVES_MAX = 3`, `DELAI_ESSAI_MINUTES = 20`, `DELAI_AVIS_JOURS = 14` ;
  - interface `PrestataireMessages` et `prestataireMessagesFactice()` (envois gardés en mémoire, échec simulable) (research.md R5) ;
  - `mobileCamerounais(tel)` et `masquerNumero(tel)` (research.md R7) ;
  - `reglageEffectif(c, brancheId, type)` : ligne de `reglages_messages` sinon le défaut (research.md R8) ;
  - `mettreEnFile(c, { type, cle, objetType, objetId, brancheId, duLe? })` : seulement pour une branche avec le module de stock et si le type est actif pour cette branche (rien n'est créé sinon), `insert … on conflict do nothing` (research.md R2, R8, R14) ;
  - un registre `PREPARATEURS` vide (type → fonction qui rend `{ telephone, texte }` ou une raison d'abandon) ;
  - `pousserMessages(maintenant?)` (research.md R3, R4, R6, R13) :
    - hors des heures d'envoi, rien ;
    - sinon, par organisation, prendre 100 messages dus (`for update skip locked`), remettre en attente ceux bloqués « en cours » depuis plus de 15 minutes ;
    - pour chacun : réglage relu, préparateur, appel du prestataire hors transaction ;
    - puis écrire `envois_messages.statut`, `envois_messages.canal`, `envois_messages.numero_masque`, `envois_messages.tentatives`, `envois_messages.essai_le`, `envois_messages.envoye_le`, `envois_messages.erreur`, `envois_messages.reference_prestataire`, et `envois_messages.du_le` pour un nouvel essai ;
    - sans prestataire, rien ne part.
- [X] T006 Dans `src/serveur.ts` et `src/index.ts` :
  - option `prestataireMessages?: PrestataireMessages`, passée à `enregistrerMessages` avec `options.urlPublique` ;
  - `app.decorate("pousserMessages", …)` ;
  - appel chaque minute avec la minuterie d'envoi existante quand `webhooksAuto` est vrai ;
  - `ERP_MESSAGES_FACTICE=1` active le prestataire factice dans `src/index.ts`.
- [X] T007 [P] Dans `public/app.js`, ajouter à `MESSAGES` : `renvoi_impossible`, `article_hors_commande`, `numero_invalide`. Vérifier que `module_inactif`, `deja_repondu` et `donnees_invalides` y sont.
- [X] T008 [P] Créer `tests/messagesoutils.ts` :
  - environnement avec `prestataireMessagesFactice()` passé au serveur ;
  - organisation avec la boutique GLOMARI ouverte, un lieu, un article et un client au mobile valide ;
  - `envoyer(heureDouala = 10, decalageJours = 0)` qui appelle `app.pousserMessages` à cette date ;
  - `envoyes()` et `vider()` sur le prestataire factice ;
  - `journal()` (`GET /messages`) et `enBase(cle)` (ligne de `envois_messages` par le compte d'administration de la base de test).

**Point d'étape** : la migration s'applique, `npx tsc --noEmit` passe, toute la suite existante reste verte.

---

## Phase 3 : parcours 1, le client suit sa livraison sans appeler (P1) 🎯 MVP

**Objectif** : lien de suivi, code de livraison, « prêt à retirer » et « livré » envoyés une seule fois, au bon numéro, aux bonnes heures (FR-001 à FR-008, FR-011 à FR-014).

**Test indépendant** : `tests/messagescolis.test.ts` (scénarios Q1 à Q6 de quickstart.md).

- [X] T009 [P] [US1] Écrire `tests/messagescolis.test.ts` :
  - Q1 : colis créé → un SMS avec le lien `suivi.html?c=…`, journal « envoyé », numéro masqué ;
  - Q2 : en livraison, paiement à la livraison de 25 000 → code à six chiffres et montant dans le texte ;
  - Q3 : colis d'une commande en ligne en point relais « arrivé » → « prêt à retirer » avec le code, puis aucun second code au passage « en livraison » ; colis à domicile passé par « arrivé » → rien ; livré → confirmation ;
  - Q4 : étape répétée et envoi relancé → un seul message ;
  - Q5 : colis sans téléphone, numéro fixe → « sans numéro », rien d'envoyé ;
  - Q6 : envoi à 23 h → rien ; à 7 h → envoyé.
- [X] T010 [US1] Dans `src/pilotage.ts`, publier `colis.cree` (`{ id, numero }`) dans `creerColis` et `colis.etape` (`{ id, statut }`) dans `POST /colis/:id/etape` (data-model.md, événements ajoutés).
- [X] T011 [US1] Dans `src/messages.ts`, réactions de `colis.cree`, `colis.etape` (`en_livraison`, `arrive`) et `colis.livre` → `mettreEnFile` des types `colis_cree`, `colis_en_livraison`, `colis_pret_retrait`, `colis_livre`, avec `envois_messages.cle` et `envois_messages.objet_type` = `colis` selon data-model.md, branche du colis. `colis_pret_retrait` seulement si la commande en ligne du colis (`commandes_web.colis_id`) est en `agence_voyage` ou `point_relais` (research.md R6).
- [X] T012 [US1] Dans `src/messages.ts`, préparateurs des quatre types de colis :
  - numéro `colis.telephone`, textes courts au nom de GLOMARI ;
  - lien public de suivi (`urlPublique`) ;
  - code de confirmation et montant à encaisser pour « en livraison » et « prêt à retirer » (FR-010, FR-012, FR-013) ;
  - « en livraison » abandonné (« sans objet ») si `colis_pret_retrait` a déjà été envoyé pour ce colis (research.md R6).

**Point d'étape** : T009 vert ; un client suit son colis sans appeler.

---

## Phase 4 : parcours 2, l'inscrit d'une précommande est informé à chaque étape (P1)

**Objectif** : confirmation d'acompte, étapes d'arrivage, solde à payer, rappel, remboursement et acompte conservé (FR-015 à FR-019).

**Test indépendant** : `tests/messagesprecommandes.test.ts` (scénarios Q7 à Q10).

- [X] T013 [P] [US2] Écrire `tests/messagesprecommandes.test.ts`, avec les outils de `tests/precommandesoutils.ts` :
  - Q7 : acompte validé → référence, quantité, date limite ; le jeton n'apparaît jamais ;
  - Q8 : étape d'arrivage avec deux inscrits payés et un remboursé → deux messages ;
  - Q9 : réception → solde à payer ; rappel envoyé une fois deux jours avant la date limite ; aucun rappel si le solde est payé ;
  - Q10 : campagne annulée → message de remboursement ; acompte conservé → message.
- [X] T014 [US2] Dans `src/messages.ts`, réactions de `precommande.inscription_validee`, `precommande.arrivage_etape` (une ligne par inscription `validee` de la campagne), `precommande.arrivage_recu` (`solde_a_payer`, et `rappel_solde` avec `envois_messages.du_le` = `solde_avant - 2 jours` si cette date est à venir), `precommande.a_rembourser` et `precommande.acompte_conserve` (research.md R10), avec `envois_messages.objet_type` = `inscription`.
- [X] T015 [US2] Dans `src/messages.ts`, préparateurs des six types de précommande : numéro `inscriptions_precommande.telephone` ; référence, titre de la campagne, quantité, montant du solde et dates ; abandon « sans objet » pour une étape si l'inscription n'est plus `validee` et pour un rappel si elle n'est plus `servie` (research.md R6).

**Point d'étape** : T013 vert ; aucun inscrit n'ignore une étape de son arrivage.

---

## Phase 5 : parcours 3, le client donne son avis deux semaines après la livraison (P2)

**Objectif** : lien d'avis au quatorzième jour, une note par article, une seule fois ; « ne pas contacter » respecté (FR-009, FR-020 à FR-023).

**Test indépendant** : `tests/avisproduits.test.ts` (scénarios Q11 à Q13 et Q15).

- [X] T016 [P] [US3] Écrire `tests/avisproduits.test.ts` :
  - Q11 : colis livré d'une commande de la Marketplace payée par le prestataire factice, puis d'une commande payée à la livraison, puis d'un colis saisi à la main relié à une facture → rien au 13e jour, un lien au 14e, une seule fois ; colis saisi à la main sans facture → aucun lien ;
  - Q12 : client « ne pas contacter » → aucun lien, messages du colis envoyés ;
  - Q13 : deux articles notés 5 et 2 → deux avis vérifiés avec `retours_clients.produit_id`, un ticket ; second envoi → `409 deja_repondu` ; article étranger → `409 article_hors_commande` ; ancien format → `400` ;
  - Q15 : vente en caisse à un client identifié → aucun lien tant que `avis_magasin` est inactif ; activé, un lien au 14e jour.
- [X] T017 [US3] Dans `src/messages.ts` :
  - réaction de `colis.livre` → `avis_livraison` avec `envois_messages.du_le` = livraison + `DELAI_AVIS_JOURS`, si un client se trouve par la commande en ligne du colis (`commandes_web.colis_id`, `tiers_id`), sinon par la facture du colis (`colis.document_id`) (research.md R11) ;
  - réaction de `vente.comptoir` → `avis_magasin` si la vente a un client et que le type est actif à la mise en file ;
  - préparateurs : client « ne pas contacter » (`tiers.ne_pas_contacter`) ou vente annulée → abandon ; sinon création de la demande d'avis (`demandes_retour.cible_type` = `commande`, `demandes_retour.source_type` = `colis` ou `vente_comptoir`, `on conflict do nothing`) et texte avec le lien `evaluer.html?c=…` vers `tiers.telephone`.
- [X] T018 [US3] Dans `src/commerce.ts` :
  - `GET /evaluer/:code` rend `articles` pour une demande de commande : articles distincts des lignes de la commande en ligne du colis (`lignes_commande_web`), sinon de la facture du colis (`lignes_vente`), sinon de la vente de caisse (`lignes_comptoir`) ;
  - `POST /evaluer/:code` accepte `notes` pour une demande de commande, avec un `retours_clients` par article (`retours_clients.produit_id`), statut de modération actuel, une seule fiche de suivi pour une note de 1 ou 2, refus `article_hors_commande` et `donnees_invalides` (contracts/routes.md) ;
  - `GET /retours` affiche le nom de l'article à la place de la cible quand `retours_clients.produit_id` est renseigné.
- [X] T019 [US3] Dans `src/relation.ts` : `PATCH /tiers/:id` accepte `nePasContacter` (`tiers.ne_pas_contacter`, droit `tiers.modifier`) ; la fusion de deux fiches garde la marque si l'une des deux l'a.
- [X] T020 [P] [US3] Dans `public/evaluer.js` (page `evaluer.html`), pour une demande qui rend `articles`, une note de une à cinq étoiles et un commentaire facultatif par article, envoyés en une fois ; inchangé pour les autres demandes.
- [X] T021 [P] [US3] Dans `public/relation.js`, case « Ne souhaite pas être contacté (demandes d'avis) » sur la fiche client, envoyée par `PATCH /tiers/:id`.

**Point d'étape** : T016 vert ; chaque livraison donne une demande d'avis vérifiée, au bon moment.

---

## Phase 6 : parcours 4, les avis vérifiés s'affichent sur la fiche produit (P2)

**Objectif** : avis publiés d'un article et sa moyenne, sans donnée personnelle (FR-024, FR-025).

**Test indépendant** : `tests/avispublics.test.ts` (scénario Q14).

- [X] T022 [P] [US4] Écrire `tests/avispublics.test.ts` :
  - Q14 : trois avis publiés et un masqué → route publique avec trois avis, moyenne et nombre, auteur « Awa N. », réponse de GLOMARI, sans nom complet ni téléphone ; catalogue public avec la même moyenne ;
  - pagination par 20 ;
  - article d'une autre organisation ou boutique fermée → `404`.
- [X] T023 [US4] Dans `src/canalenligne.ts` :
  - `GET /marketplace/:org/produits/:id/avis?page` par `parBoutique`, pour un article en ligne de la branche, avis `publie` avec `retours_clients.produit_id`, débit limité (research.md R12) ;
  - `GET /marketplace/:org/catalogue` ajoute `avis: { moyenne, nombre }` à chaque article par une requête agrégée.

**Point d'étape** : T022 vert ; la fiche produit montre des avis vérifiés.

---

## Phase 7 : parcours 5, la direction règle les envois et les surveille (P2)

**Objectif** : réglages par type, journal masqué avec les totaux du mois, renvoi d'un message en échec (FR-002, FR-005 à FR-007, FR-027).

**Test indépendant** : `tests/messagesreglages.test.ts` (scénarios Q16 à Q19).

- [X] T024 [P] [US5] Écrire `tests/messagesreglages.test.ts` :
  - Q16 : type désactivé → aucun message créé ; réactivé → rien de passé ne part, le message suivant part ; type coupé alors qu'un message attend → message annulé ; réglé sur WhatsApp → canal `whatsapp` ;
  - Q17 : prestataire en panne → trois tentatives espacées de 20 minutes, puis « échec » ; renvoi avec un numéro corrigé → téléphone de l'objet remplacé, nouvelle ligne envoyée à ce numéro, `envois_messages.renvoi_de` renseigné, ancienne gardée ; numéro corrigé invalide → `400 numero_invalide` ; second renvoi → `409 renvoi_impossible` ;
  - Q18 : journal sans numéro complet, sans code ni texte ; totaux du mois par type et par canal ;
  - Q19 : utilisateur de GTA → `403` sur les réglages et le journal ; autre organisation → `404` sur le renvoi ; branche sans module de stock → `409 module_inactif`.
- [X] T025 [US5] Dans `src/messages.ts`, routes selon contracts/routes.md :
  - `GET /messages/reglages` (`care.voir` ou `facturation.administrer`) et `PUT /messages/reglages` (`facturation.administrer`), qui écrit `reglages_messages.actif`, `reglages_messages.canal`, `reglages_messages.modifie_par`, `reglages_messages.modifie_le`, avec le journal `messages.reglage` ;
  - `GET /messages` : 500 derniers messages avec l'objet (numéro du colis ou référence de la précommande) et totaux du mois ;
  - `POST /messages/:id/renvoi` (`care.gerer`) : numéro corrigé facultatif, qui remplace `colis.telephone`, `inscriptions_precommande.telephone` ou `tiers.telephone` selon le type (refus `numero_invalide`) ; nouvelle ligne avec `envois_messages.renvoi_de`, `envois_messages.renvoye_par`, clé `<clé>#<id>` ; journal `messages.renvoi` sans le numéro (research.md R13).
- [X] T026 [P] [US5] Interface :
  - créer `public/messages.js` : écran « Messages aux clients » avec les réglages (actif, canal, prestataire présent ou non, heures d'envoi), le journal filtrable (statut, type, période), les totaux du mois et le bouton de renvoi avec un numéro corrigé facultatif ;
  - l'ajouter dans `public/index.html` et au menu GLOMARI de `public/app.js` (droits `care.voir` ou `facturation.administrer`) ;
  - dans `public/sw.js`, cache `smarte-solutions-v6` avec le fichier.

**Point d'étape** : T024 vert ; la direction maîtrise ce qui part et l'équipe Care voit ce qui échoue.

---

## Phase 8 : finitions

- [X] T027 [P] Mettre à jour `CLAUDE.md` :
  - état : lot 4, partie A livrée ;
  - entrée « Messages et avis publiés » : types, réglages, heures, tentatives, journal masqué, prestataire factice (essai privé seulement), demande d'avis par commande, avis publics ;
  - limites : pas de message d'échec ou de retour de colis, ni pour les commandes en retrait ; textes en français fixés dans le code ; prestataire réel à choisir ; parties B et C à faire.
- [X] T028 [P] Mettre à jour `docs/Couverture du cahier des charges.md` (Socle, Commerce, CRM, Intégrations).
- [X] T029 [P] Dans `docs/Fiche technique globale GLOMARI.md` : section 9 lot 4, état de la partie A (fichiers, migration 0051, découpage en trois parties) ; section 6.3, événements `colis.cree` et `colis.etape`.
- [X] T030 [P] Dans `docs/Guide de mise en ligne.md`, section « Messages aux clients » : `ERP_MESSAGES_FACTICE` pour l'essai privé seulement, tâches planifiées actives, réglages à vérifier, prestataire réel et modèles WhatsApp à faire approuver.
- [X] T031 Relire `src/messages.ts` et les ajouts :
  - aucune trace du numéro complet ni d'un code en base ou dans les journaux du serveur ;
  - chaque code passé à `ErreurApi` présent dans `MESSAGES` ;
  - aucune donnée de GTA ;
  - aucun appel réseau dans les tests ;
  - la règle « aucun nom déclaré deux fois » des écrans respectée.
- [X] T032 Lancer `npx tsc --noEmit` et la suite complète avec le rôle restreint par le contrôle GitHub (`.github/workflows/verification.yml`) : tout vert.
- [X] T033 Dérouler les scénarios de `specs/005-messages-avis/quickstart.md` (automatisés par les tests ; essai privé sur serveur quand il existera).
- [X] T034 Avec l'accord du responsable technique, pousser la branche, ouvrir la demande de fusion et attendre le contrôle GitHub au vert.

---

## Dépendances et ordre d'exécution

- **Phase 1** puis **phase 2** : T003 bloque tout ; T004 et T005 bloquent les réactions ; T008 bloque les tests.
- **Parcours 1** et **parcours 2** : indépendants, mais tous deux écrivent dans `src/messages.ts`.
- **Parcours 3** : réutilise `colis.livre` (T010, T011) ; ses écrans (T020, T021) sont indépendants.
- **Parcours 4** : a besoin d'avis par article (T018) pour ses données de test, ou les crée par le compte d'administration.
- **Parcours 5** : indépendant ; ses routes lisent la file des autres parcours.
- Même fichier, donc dans l'ordre :
  - `src/messages.ts` : T005 → T011 → T012 → T014 → T015 → T017 → T025 ;
  - `src/serveur.ts` : T002 → T006.
- **Parallélisable** :
  - T004, T007 et T008 après T003 ;
  - chaque fichier de test (T009, T013, T016, T022, T024) dès la phase 2 ;
  - T010, T018, T019, T023 seuls dans leur fichier ;
  - T020, T021 et T026 ensemble ;
  - T027 à T030 ensemble.

## Exemple de travail en parallèle : phase 2

```text
Tâche : « réactions aux événements » (T004, src/base.ts)
Tâche : « codes d'erreur » (T007, public/app.js)
Tâche : « outils de test » (T008, tests/messagesoutils.ts)
```

## Exemple de travail en parallèle : parcours 3

```text
Tâche : « tests des avis » (T016, tests/avisproduits.test.ts)
Tâche : « page d'avis par article » (T020, public/evaluer.html)
Tâche : « case ne pas contacter » (T021, public/relation.js)
```

## Stratégie

- **MVP** : phases 1 et 2, puis parcours 1. Les clients suivent leur colis et reçoivent leur code de livraison (règle R7).
- **Ensuite** : parcours 2 (précommandes, règle R4) ; puis parcours 3 et 4 (avis, règle R9) ; puis parcours 5 (réglages et journal) ; puis les finitions.
