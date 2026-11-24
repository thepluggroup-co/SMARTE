# Research : comptes clients en ligne (lot 4, partie B)

Décisions prises pour le plan, à partir du code existant (`src/canalenligne.ts`, `src/precommandes.ts`, `src/messages.ts`, `src/securite.ts`, `src/caisse.ts`, `src/relation.ts`) et de la spécification.

## R1. Code de connexion : tirage, conservation, vérification

- **Decision** :
  - six chiffres tirés par `randomInt(0, 1_000_000)` (complétés à six) ;
  - conservé sous forme d'empreinte HMAC-SHA-256 avec la clé de 32 octets du serveur (`cleSecrets`), jamais en clair ;
  - comparé en temps constant (`timingSafeEqual`) ;
  - table `codes_connexion` : une ligne par code, avec le numéro, l'empreinte, l'échéance (10 minutes), les essais faux, la date d'usage ou d'invalidation, et le résultat de l'envoi.
- **Rationale** : un million de codes possibles seulement ; une empreinte sans clé se retrouverait en une seconde si la base fuyait. Le HMAC avec la clé du serveur l'empêche (FR-002).
- **Alternatives considered** : SHA-256 simple (`hacherJeton`, suffisant pour un jeton long, pas pour six chiffres) ; garder le code en mémoire (perdu au redémarrage, inutilisable à plusieurs processus).

## R2. Limites contre les abus

- **Decision** :
  - par numéro, contrôlé en base sous un verrou consultatif `code:<numéro>` : pas de nouveau code moins d'une minute après le précédent ; trois codes au plus par quart d'heure, dix par 24 heures (`409 code_trop_tot` avec `attendre_secondes`) ;
  - un nouveau code invalide les précédents de ce numéro ; cinq essais faux invalident le code (`ESSAIS_MAX_CODE = 5`) ;
  - pour toute la boutique : débit par minute de `POST …/compte/code` (option `debitCanal.codes`, 30 par défaut, `ERP_CANAL_CODES_PAR_MINUTE`) et de `POST …/compte/connexion` (`debitCanal.connexions`, 60 par défaut), avec le limiteur de débit déjà utilisé par la Marketplace.
- **Rationale** : FR-004, FR-005, SC-002, SC-005. Le serveur de la Marketplace appelle l'ERP depuis une seule adresse (constat du lot 1) : une limite par adresse est donc une limite de boutique, réglable comme les autres débits.
- **Alternatives considered** : limite par adresse du client final (l'ERP ne la voit pas) ; captcha (du ressort de la Marketplace).

## R3. Envoi immédiat du code

- **Decision** : le code part dans la requête, par le prestataire de la partie A (`PrestataireMessages`), après l'enregistrement du code. Il ne passe ni par la file, ni par les heures d'envoi, ni par les réglages de la direction. Résultat noté sur le code (`envoi` : `envoye` ou `echec`) ; en échec ou sans prestataire, `503 sms_indisponible`, et la demande compte quand même dans les limites. Le texte (« GLOMARI : votre code de connexion est 123456. Il expire dans 10 minutes. Ne le donnez à personne. ») n'est jamais enregistré.
- **Rationale** : FR-002 (à toute heure, aussitôt). Compter un échec évite qu'une panne serve à forcer des envois répétés.
- **Alternatives considered** : la file `envois_messages` (soumise aux heures d'envoi et à la minuterie : trop lente) ; un type de message réglable (la direction pourrait couper toute connexion).

## R4. Fiche du compte

- **Decision** : `trouverFicheClient(c, branche, telephone)` est extraite de `ficheClient` (`src/canalenligne.ts`) et devient déterministe (`order by cree_le, id`) : la commande en ligne, l'inscription à une précommande et la connexion prennent toujours la même fiche. Sans fiche, la connexion exige un nom (`409 nom_requis`, le code reste valable) et crée la fiche par `ficheClient`, rôle client, origine la branche.
- **Rationale** : FR-006 ; le compte est la fiche existante, et le client retrouve ses commandes passées sans compte.
- **Alternatives considered** : une table de comptes à part, reliée aux fiches (deux identités à garder cohérentes) ; créer la fiche dès la demande de code (fiches pour des numéros jamais vérifiés).

## R5. Session client

- **Decision** :
  - jeton aléatoire de 32 octets (`base64url`), rendu une fois à la Marketplace, conservé seulement par son empreinte (`hacherJeton`) dans `sessions_clients` ;
  - avec la fiche, la branche, le numéro au moment de la connexion, l'échéance (7 jours, sans prolongation) et la révocation ;
  - envoyé par la Marketplace dans l'en-tête `Authorization: Client <jeton>` sur les routes `/marketplace/:org/compte/…` seulement.
  - Contrôle à chaque requête (`clientConnecte`) : jeton connu, non révoqué, non échu, boutique ouverte (`parBoutique`), fiche de la branche, ni archivée ni fusionnée, téléphone inchangé. Sinon `401 session_invalide`.
- **Rationale** : FR-007, FR-016. Un schéma d'en-tête distinct (`Client`) évite toute confusion avec les jetons du personnel.
- **Alternatives considered** : prolonger la session à chaque visite (la spécification fixe 7 jours) ; un jeton signé sans table (révocation impossible, contraire à FR-014).

## R6. Historique

- **Decision** :
  - commandes : `commandes_web` de la fiche dans la branche, 100 dernières, avec leurs lignes et le colis. La lecture des colonnes et des lignes est extraite de la route de suivi existante (`detailCommandeWeb`), pour les deux usages ;
  - précommandes : `inscriptions_precommande` de la fiche, avec la même présentation que le suivi par lien (`detailPrecommande`, extrait de `src/precommandes.ts`) ;
  - le solde se choisit par `POST …/compte/precommandes/:reference/solde`, qui appelle la même fonction que la route par lien (`creerCommandeSolde`, extraite). Elle rend la commande du solde avec sa référence et son jeton ; le paiement passe ensuite par la route de paiement existante.
- **Rationale** : FR-008, FR-009 sans dupliquer la logique du solde ni celle du suivi ; un seul chemin, déjà testé par le lot 3A.
- **Alternatives considered** : recopier les requêtes (deux versions divergeraient).

## R7. Adresses

- **Decision** : table `adresses_clients` (fiche, nom, zone de livraison de la branche facultative, adresse, repère, par défaut). Au plus cinq par fiche (`ADRESSES_MAX = 5`), contrôlé sous le verrou de la fiche. Une seule par défaut (index unique partiel). Les zones ne se suppriment pas aujourd'hui : la clé étrangère suffit.
- **Rationale** : FR-011 ; la commande garde ses propres contrôles (zone, adresse, frais).
- **Alternatives considered** : stocker les adresses dans un champ JSON de la fiche (pas de contrôle de zone ni d'unicité).

## R8. Fidélité

- **Decision** : solde = somme de `points_fidelite` de la fiche ; valeur = solde × `regles_fidelite.valeur_point` de la branche ; 50 derniers mouvements (date, points, motif) ; `actif` selon la règle de la branche. Les fiches étant séparées par branche, aucun point d'une autre branche n'apparaît.
- **Rationale** : FR-013, règle « points de fidélité séparés par branche ».

## R9. Déconnexion, révocation et fusion

- **Decision** :
  - `POST …/compte/deconnexion` révoque la session courante, ou toutes celles de la fiche avec `{ tous: true }` ;
  - le personnel (`care.gerer` sur la branche de la fiche) utilise `POST /tiers/:id/comptes-en-ligne/deconnexion` ;
  - `GET /tiers/:id` ajoute `compte_en_ligne` (appareils connectés, dernière connexion) pour qui voit la fiche ;
  - à la fusion de deux fiches, les sessions du doublon sont révoquées et ses adresses perdent leur « par défaut » avant le report des liens (`LIENS_TIERS` reçoit `sessions_clients.tiers_id` et `adresses_clients.tiers_id`) ;
  - journal : `compte_client.connexion`, `compte_client.deconnexion_tous`, `compte_client.blocage`, sans code ni numéro complet.
- **Rationale** : FR-014 à FR-017 ; le test « couvre tous les liens vers une fiche » exige que toute clé vers une fiche soit dans `LIENS_TIERS`.

## R10. Lire le code pendant l'essai privé

- **Decision** : `GET /messages/code-essai?telephone=` n'existe que si le prestataire est le factice (sinon `404`). Il exige `entites.gerer` (vérifié aussi sur la branche du code) et rend le dernier code de l'organisation envoyé à ce numéro, lu dans la mémoire du prestataire factice, jamais en base ni dans un journal. L'écran « Messages aux clients » l'affiche dans ce seul cas.
- **Rationale** : l'essai privé doit pouvoir se connecter sans vrai SMS, sans affaiblir SC-006 (aucun code dans les journaux) ni laisser de porte avec un vrai prestataire.
- **Alternatives considered** : écrire le code dans le journal du serveur (contraire à SC-006) ; un code fixe d'essai dans `.env` (dangereux s'il restait en production).

## R11. Isolation

- **Decision** : toutes les routes du compte passent par `parBoutique` (boutique ouverte de l'organisation, sa branche) ; la session porte la branche, et chaque requête filtre par la fiche de la session. Les données sont lues par la fiche, jamais par un identifiant fourni sans contrôle ; une commande, une précommande ou une adresse d'une autre fiche rend `404`.
- **Rationale** : FR-010, FR-018, SC-003.
