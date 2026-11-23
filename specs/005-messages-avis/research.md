# Research : messages automatiques et avis publiés (lot 4, partie A)

Décisions prises pour le plan, à partir du code existant (`src/base.ts`, `src/controle.ts`, `src/pilotage.ts`, `src/precommandes.ts`, `src/commerce.ts`, `src/canalenligne.ts`, `src/paiementenligne.ts`) et de la spécification.

## R1. Déclencher les messages à partir des événements publiés

- **Decision** : `src/base.ts` gagne un registre `reactionsEvenements` (tableau de fonctions `(c, type, charge) => Promise<void>`). `publierEvenement` insère l'événement puis appelle chaque réaction, dans la même transaction. `src/messages.ts` s'y inscrit et met les messages en file. Deux événements manquent et sont ajoutés dans `src/pilotage.ts` : `colis.cree` (dans `creerColis`) et `colis.etape` (route d'étape, avec le statut). `colis.livre`, `vente.comptoir` et les `precommande.*` existent déjà.
- **Rationale** :
  - un seul point d'entrée couvre tous les chemins (colis du canal en ligne, du paiement Mobile Money, saisis à la main ; précommandes par la Marketplace, l'approbation, la réception, les tâches d'expiration) ;
  - la mise en file est dans la transaction métier : pas de message pour une opération annulée, pas d'opération sans son message ;
  - c'est le schéma des crochets déjà utilisé (`crochetsAchats`, `crochetsPerformance`), sans dépendance circulaire (`base` n'importe pas `messages`) ;
  - les deux nouveaux événements servent aussi la Marketplace (fiche, section 6.3).
- **Alternatives considered** :
  - déclencheurs SQL sur `colis` et `inscriptions_precommande` : logique de texte et de réglages éclatée entre SQL et TypeScript ;
  - relire la table `evenements` après coup avec un curseur : un état de lecture de plus, et un délai ;
  - appeler la mise en file dans chaque route : une dizaine de points d'écriture, faciles à oublier au prochain chemin.

## R2. File d'envoi et unicité

- **Decision** : table `envois_messages`, une ligne par message à envoyer, avec une clé unique `cle` par organisation (par exemple `colis_cree:<colis>`, `etape_arrivage:<inscription>:<etape>`, `avis_livraison:<colis>`). La mise en file fait `insert ... on conflict do nothing`. Une colonne `du_le` porte la date à partir de laquelle le message peut partir (immédiat, quatorzième jour, deux jours avant le solde).
- **Rationale** : un événement reçu deux fois ou une étape répétée ne crée qu'un message (FR-003, SC-002), garanti par la base ; les messages planifiés sont de simples lignes datées, sans tâche spéciale.
- **Alternatives considered** : dédoublonner à l'envoi en comparant les textes (fragile) ; planifier par la tâche horaire (trop lente pour SC-001).

## R3. Envoi hors transaction, chaque minute

- **Decision** : `enregistrerMessages(app, pool, outils, urlPublique, prestataire?)` reçoit l'adresse publique pour les liens de suivi et d'avis. `pousserMessages(maintenant?)`, décorée sur l'application comme `pousserWebhooks`, tourne chaque minute quand `webhooksAuto` est vrai. Pour chaque organisation :
  1. transaction courte : prendre au plus 100 messages `en_attente` dus (`du_le <= maintenant`), verrouillés `for update skip locked`, les passer `en_cours` et compter la tentative ; un message resté `en_cours` plus de 15 minutes redevient `en_attente` ;
  2. pour chacun, préparer le texte et le numéro (R6), appeler le prestataire sans connexion retenue ;
  3. transaction courte : écrire le résultat.
  Les tests appellent `app.pousserMessages(maintenant)` avec une date choisie.
- **Rationale** : même schéma que les webhooks (aucune connexion bloquée pendant l'appel réseau) ; la date injectable rend testables les heures d'envoi et le quatorzième jour sans attendre.
- **Alternatives considered** : envoyer dans la transaction métier (un prestataire lent bloquerait une vente) ; minuterie horaire (trop lente).

## R4. Heures d'envoi

- **Decision** : rien ne part si l'heure de Douala de `maintenant` est avant 7 h ou à partir de 21 h (`HEURE_DEBUT_ENVOI = 7`, `HEURE_FIN_ENVOI = 21`) ; les messages attendent le passage suivant.
- **Rationale** : FR-004 ; une seule règle, appliquée à l'envoi, pour tous les types.
- **Alternatives considered** : décaler `du_le` à la mise en file (faux pour un message retenté ou renvoyé).

## R5. Prestataire interchangeable, factice d'abord

- **Decision** : interface `PrestataireMessages { nom; envoyer({ canal, telephone, texte, reference }) => Promise<{ ok, reference?, erreur? }> }`, option `prestataireMessages` du serveur. `prestataireMessagesFactice()` garde les envois en mémoire (lisibles par les tests) et peut simuler un échec. `src/index.ts` l'active seulement avec `ERP_MESSAGES_FACTICE=1` (essai privé, données fictives). Sans prestataire, les messages restent en attente et l'écran l'indique. La référence passée au prestataire est l'identifiant du message, pour qu'un vrai prestataire ignore un second envoi du même message.
- **Rationale** : même démarche que le paiement du lot 2 ; aucun appel réseau dans les tests ; le prestataire réel se branchera par un fichier et des identifiants dans `.env`.
- **Alternatives considered** : un prestataire réel tout de suite (non choisi par la direction).

## R6. Texte préparé à l'envoi, jamais conservé

- **Decision** : chaque type a une fonction qui lit les données du moment (colis, inscription, campagne, demande d'avis) et renvoie le numéro et le texte, ou une raison de ne pas envoyer :
  - `sans_numero` : numéro absent ou invalide ;
  - `annule` : type désactivé au moment de l'envoi, client « ne pas contacter » pour une demande d'avis, ou message devenu sans objet (rappel d'un solde déjà payé, inscrit remboursé avant l'étape, vente annulée).
  Le texte n'est jamais écrit en base ; le journal garde le type, l'objet et le numéro masqué.
- **Colis : mode de remise** : le colis ne connaît pas son mode de remise, seule la commande en ligne qui le porte le connaît (`commandes_web.colis_id`, `commandes_web.mode_livraison`). L'étape `arrive` sert aussi à un colis livré à domicile qui passe par un dépôt (`arrive` → `en_livraison`, `src/pilotage.ts`). Donc :
  - `colis_pret_retrait` ne se met en file que si la commande en ligne du colis est en `agence_voyage` ou `point_relais` ; sinon l'étape `arrive` n'envoie rien ;
  - le préparateur de `colis_en_livraison` abandonne (« sans objet ») si `colis_pret_retrait` a déjà été envoyé pour ce colis : le code est déjà chez le client, et un retrait en point relais passe lui aussi par `en_livraison` avant la remise.
- **Rationale** : FR-006 (aucun code conservé) ; le renvoi part vers le numéro actuel (FR-005) ; un message en attente suit la réalité (spécification, cas limites).
- **Alternatives considered** : stocker le texte à la mise en file (garderait le code de livraison en clair, et un texte périmé).

## R7. Numéro de téléphone

- **Decision** : `normaliserTelephone` existant, puis seul un mobile camerounais est accepté (`^2376[0-9]{8}$`). Masque du journal : sept astérisques puis les deux derniers chiffres.
- **Rationale** : SMS et WhatsApp ne vont qu'aux mobiles ; FR-008 et SC-004.
- **Alternatives considered** : accepter les numéros étrangers (hors du marché de GLOMARI, coût inconnu).

## R8. Réglages par branche

- **Decision** : table `reglages_messages` (branche, type, actif, canal). Sans ligne, le défaut du code s'applique : actif, SMS, sauf `avis_magasin` inactif. Lire : `care.voir` ou `facturation.administrer` sur la branche ; modifier : `facturation.administrer` (le droit qui ouvre la boutique en ligne). Seules les branches avec le module de stock ont des messages (GLOMARI, jamais GTA). Le réglage se lit à la mise en file pour tous les types : un type coupé ne crée aucun message, et le réactiver ne renvoie donc rien de passé. Il se relit à l'envoi : un message en attente dont le type a été coupé entre-temps est annulé (FR-002, SC-006, parcours 5 scénario 1).
- **Rationale** : la direction coupe un type d'un clic ; le défaut couvre une branche jamais réglée.
- **Alternatives considered** : un réglage par organisation (une seconde branche de commerce ne pourrait pas différer) ; un nouveau droit (non nécessaire, celui de la boutique existe).

## R9. Destinataires

- **Decision** :
  - colis : `colis.telephone` ;
  - précommandes : `inscriptions_precommande.telephone` (le numéro donné à l'inscription) ;
  - avis : `tiers.telephone` du client de la facture ou de la vente.
  `tiers.ne_pas_contacter` (nouvelle colonne, modifiable par `PATCH /tiers/:id` avec `tiers.modifier`) n'arrête que les demandes d'avis.
- **Rationale** : chaque message va au numéro que le client a donné pour cet achat ; FR-009.
- **Alternatives considered** : toujours la fiche client (le destinataire d'un colis peut être une autre personne).

## R10. Messages des précommandes

- **Decision** : réactions aux événements existants :
  - `precommande.inscription_validee` → `acompte_confirme` ;
  - `precommande.arrivage_etape` → `etape_arrivage` pour chaque inscription `validee` de la campagne ;
  - `precommande.arrivage_recu` → `solde_a_payer`, et `rappel_solde` daté de `solde_avant - 2 jours` si cette date est encore à venir ;
  - `precommande.a_rembourser` → `acompte_a_rembourser` ;
  - `precommande.acompte_conserve` → `acompte_conserve`.
  À l'envoi, une étape ne part pas si l'inscription n'est plus `validee`, et le rappel ne part que si elle est encore `servie`. Le texte donne la référence, jamais le jeton (haché en base, donc inconnu).
- **Rationale** : FR-015 à FR-019 sans toucher au module des précommandes.
- **Alternatives considered** : un message par campagne envoyé à une liste (pas d'unicité par inscrit).

## R11. Demande d'avis par commande, note par article

- **Decision** :
  - les colis de la Marketplace ne portent pas leur facture : `creerColis` est appelé sans `documentId` par `src/paiementenligne.ts` (Mobile Money) et `src/canalenligne.ts` (paiement à la livraison). Le client et les articles d'un colis se lisent donc d'abord par la commande en ligne qui le porte (`commandes_web.colis_id`, son `tiers_id` et ses `lignes_commande_web`), sinon par la facture du colis (`colis.document_id`, son client et ses `lignes_vente`) pour un colis saisi à la main. Sans l'un ni l'autre, pas de demande d'avis ;
  - `colis.livre` met en file `avis_livraison`, daté de la livraison plus `DELAI_AVIS_JOURS` (14), si l'une de ces deux sources donne un client ;
  - `vente.comptoir` met en file `avis_magasin` (quatorze jours) si la vente a un client et que le type est actif ;
  - à l'envoi, la demande d'avis existante (`demandes_retour`) est créée avec `cible_type = 'commande'` et `source_type` `colis` ou `vente_comptoir`. L'unicité existante `(source_type, source_id, cible_type)` empêche une seconde demande ;
  - `GET /evaluer/:code` renvoie les articles de la commande : lignes de la commande en ligne du colis, sinon de la facture du colis, sinon de la vente de caisse ; `POST /evaluer/:code` accepte `notes: [{ produitId, note, commentaire? }]` pour une demande de commande ;
  - `retours_clients` gagne `produit_id`. L'unicité `demande_id` devient `(demande_id, produit_id)` : un avis par article ;
  - une seule fiche de suivi (ticket) est ouverte s'il y a au moins une note de 1 ou 2. Modération existante inchangée.
- **Rationale** : réutilise le lien à usage unique, la modération et l'écran « Retours » ; un avis par article nourrit la fiche produit (FR-020 à FR-023).
- **Alternatives considered** : une demande par article (bloquée par l'unicité existante, et plusieurs liens par commande) ; une table d'avis produits à part (moderation et écran en double).

## R12. Avis publics par produit

- **Decision** : `GET /marketplace/:org/produits/:id/avis?page=` par `parBoutique`, pour un article en ligne de la branche. Elle renvoie moyenne (au dixième), nombre, et les avis publiés du plus récent au plus ancien, 20 par page. L'auteur est le premier mot du nom et l'initiale du dernier (« Awa N. »). Le catalogue public ajoute `avis: { moyenne, nombre }` par une seule requête agrégée.
- **Rationale** : FR-024, FR-025 ; mêmes protections que le reste de la Marketplace (débit limité, boutique ouverte, rien d'une autre branche).
- **Alternatives considered** : servir les avis dans le catalogue complet (catalogue lourd, mis en cache par la Marketplace).

## R13. Tentatives et renvoi

- **Decision** : trois tentatives au plus (`TENTATIVES_MAX = 3`), espacées de 20 minutes, puis `echec`. `POST /messages/:id/renvoi` (`care.gerer` sur la branche) crée une nouvelle ligne `renvoi_de` (clé `<clé>#<identifiant>`), due tout de suite, pour un message en `echec` ou `sans_numero` ; l'ancienne reste dans le journal. Aucune route ne permet aujourd'hui de corriger le téléphone d'un colis ni d'une inscription : le renvoi accepte donc un numéro corrigé (mobile camerounais, sinon `400 numero_invalide`), qui remplace `colis.telephone`, `inscriptions_precommande.telephone` ou `tiers.telephone` selon le type ; le journal `messages.renvoi` note l'objet corrigé, jamais le numéro.
- **Rationale** : FR-005 ; le journal garde les deux tentatives ; un numéro faux se corrige là où le message le lit.
- **Alternatives considered** : remettre la même ligne en attente (perd l'historique).

## R14. GTA

- **Decision** : la mise en file ignore toute branche sans module de stock ; les routes de réglage et de journal exigent des droits sur une branche qui l'a ; les avis publics ne lisent que la boutique ouverte.
- **Rationale** : FR-026, SC-008 ; même garde que le dépôt-vente et la couverture.
