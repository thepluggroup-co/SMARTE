# Couverture du cahier des charges

État au 3 novembre 2026. « Construit » veut dire : présent, testé automatiquement, jamais utilisé en conditions réelles. Rien n'est en production.

| Section | Construit | Partiel | Bloqué par un tiers ou non commencé |
| --- | --- | --- | --- |
| 5 et 6 Socle, rôles | Rôles, délégations, tiers, fusion, catalogue, audit, recherche, tâches, documents, agenda | Notifications dans l'application seulement | Devises, champs personnalisés, constructeur de workflows, modèles de documents par entité |
| 7 Finance | SYSCOHADA, journaux, écritures, clôtures, états, analytique, budgets, rapprochement, prévision, fournisseurs, lots, immobilisations, refacturation | Cumul avec éliminations saisies, modèles d'écritures, import de relevé par collage | Consolidation certifiée, conversion de devises, notes annexes, lecture automatique des factures |
| 8 Facturation | Devis, facture, avoir, récurrentes, règlements, recouvrement, plans, blocages, pertes | Modèles d'impression | Mobile Money, liens de paiement, note de débit, envoi automatique, facture électronique DGI |
| 9 Fiscalité et DSF | Résultat fiscal, contrôles, corrections justifiées, versions, verrouillage, calendrier | Export des chiffres | Modèle officiel DGI (fichier attendu), téléversement, clic jusqu'à la pièce |
| 10 Formations | Programmes, sessions, inscriptions, tranches, présences, certificats, attente, codes, coûts, marge, B2B, avis | Émargement et convocations imprimables | Inscription publique directe, QR d'émargement, fiches formateurs et paie à la session |
| 11 Apprentissage | Cours, quiz, vidéo, certificat, studio de textes, banque, devoirs, parcours, questions, boutique | Points, inactifs | Vidéo multi qualité, enregistrement navigateur, SCORM, audio et vidéo générés, surveillance, tuteur virtuel, auteurs externes, paiement en ligne |
| 12 IP2EL | Filières, candidatures, notes, délibérations, diplômes, scolarité, emploi du temps, appel, statistiques | Diplômés | Candidature en ligne, facultés et maquettes versionnées, cartes, vacations, formats de tutelle |
| 13 SMARTE | Accompagnements, notes chiffrées, certification, licences, cascade, réservation, bibliothèque | Tests par lien | Tests notés, paiement à la séance, visioconférence intégrée |
| 14 Commerce | Caisse, hors connexion, Mall, rayons, lots, relais, vendeurs, franchises, portail, paliers, promotions, variantes, prix client, import | Quantité minimale et multiples au portail | Tranches cumulées, grilles par groupe, ville, canal, fiches bilingues, photos, balances, marque propre, B2B récurrent, prévisions |
| 15 Logistique | Achats, réceptions, stocks, transferts, inventaires, réservation, séries, demandes de prix, retours, importation, colis, tournées, flotte | Coefficient d'importation affiché | Emplacements, préparation avec scanner, itinéraires, géolocalisation, transporteurs connectés, notifications |
| 16 CRM et marketing | Opportunités, score, segments, formulaires, campagnes, affiliation, franchises, avis, événements, fidélité séparée | Étapes fixes | Séquences automatiques, envoi multicanal, réseaux sociaux, portail affilié |
| 17 RH et paie | Dossiers, congés, pointage, bornes, portail employé, notes de frais, recrutement, bulletins, état, versements, évaluation | Barèmes vides à valider | Déclarations officielles, formateurs vacataires, plan de carrière, placement GLOMARI |
| 18 Pilotage | OKR, projets, Care, tickets, risques, audits, contrats, maintenance, Foundation | Aide écrite | Diagrammes, reçus fiscaux, médias et éditions |
| 19 à 21 KPI, IA, analyses | Indicateurs, alertes, évaluation, règles si alors, tour de contrôle, ABC, anomalies | Assistant à questions préparées, simulation de règle | Constructeur de rapports, éditeur visuel de règles, IA conversationnelle, prévisions, entrepôt de données, rapports envoyés |
| 22 Intégrations | API décrite, clés, webhooks | | Plateforme GLOMARI, opérateurs, WhatsApp, SMS, banques, réseaux sociaux, bac à sable |
| 23 SaaS | Isolement multi organisation, modules par entité | Création par script | Console, offres, facturation d'abonnement, marque blanche, objets sans code |
| 24 Sécurité | RLS, 2FA, chiffrement applicatif, audit, export et anonymisation | | Tests d'intrusion, sauvegardes, hébergement, supervision : à faire au déploiement |
| 25 Interface | Espaces, thème sombre, taille du texte, pages publiques bilingues | Écrans provisoires | Écrans internes en anglais, chartes par entité, visites guidées, React |
| 26 Mobile | Application installable (PWA) | | Applications Android et iOS, comptes développeur |
| 27 Innovations | Billetterie, réservation, contrats, maintenance, QR codes | | WhatsApp, voix, RFID, jumeau numérique, réalité augmentée, blockchain, conformité AML |

**Ajouts de la dernière passe :** grilles par catégorie, tranches cumulées, taux de change pour information, emplacements et préparation par scan, rapports à sources fermées, prévisions simples, règles à ticket, couleur par entité, console de plateforme, navigation en anglais. Plusieurs mentions de la colonne de droite sont donc levées en tout ou partie.

**Caisse rapide (10 novembre 2026) :** écran en deux colonnes avec vignettes, recherche unique, filtre par catégorie, fenêtres de quantité et de remise (en % ou en montant, par ligne ou sur toute la vente), paiement en plusieurs moyens, vente à crédit avec créance et règlement du reste dû, vendeur, client rapide, numéros de série, ticket avec NIU et RCCM. Les trois lots sont faits.

**Retours et rapports (11 novembre 2026) :** retour partiel d'une vente de caisse depuis son ticket, rapports stock et ventes avec export CSV et impression, commission des vendeurs proposée à la paie.

**Catalogue complet (11 novembre 2026) :** photos d'articles (4 au plus), marques, unités de vente en caisse et en achat, codes-barres EAN13 internes, étiquettes à code-barres par planche A4 ou rouleau.

Le cahier des charges décrit un programme de plusieurs années. Les éléments de la dernière colonne demandent soit un compte ou un accès extérieur, soit un travail important que l'essai réel doit d'abord justifier.
