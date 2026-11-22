# Contrats API : routes publiques du paiement en ligne (lot 2)

**Module** : `src/paiementenligne.ts`
**Accès** : sans session, débit limité par adresse IP.
**Montants** : FCFA entiers.

---

## POST `/marketplace/:org/commandes/:reference/payer`

Lance le paiement d'une commande. Appelée par le serveur de la Marketplace pour le client (fiche, W5).

**Débit** : 10 par minute.

**Corps**

```json
{ "jeton": "43 caractères base64url, celui du suivi" }
```

**Contrôles** (dans cet ordre)

1. `:org` UUID et boutique ouverte, `:reference` au format `WEB-AAAA-000000`, jeton au bon format, commande trouvée par référence **et** `hacherJeton(jeton)` : sinon `404 introuvable` (comme le suivi du lot 1).
2. Commande `reservee`, sans colis, `expire_le > now()`, moyen `orange_money` ou `mtn_momo` : sinon `409 paiement_impossible` avec `{ statut }`.
3. Un prestataire couvre ce moyen et la boutique a un responsable (`config_canal.responsable_id`) : sinon `503 paiement_indisponible`.
4. `prestataire.initier(…)` hors transaction ; s'il échoue (réseau, refus) : `503 paiement_indisponible`, commande inchangée.
5. Enregistrement de `paiements_en_ligne` (`statut` `lance`, `montant` = `total_ttc`, `reference_prestataire` renvoyée par le prestataire).

**Réponse 201**

```json
{
  "statut": "lance",
  "moyen": "orange_money",
  "montant": 836750,
  "instruction": { "type": "telephone", "texte": "Validez le paiement sur votre téléphone." }
}
```

`instruction.type` : `telephone` (validation USSD ou application) ou `lien` (avec `url`). Le client peut relancer tant que la commande est réservée ; chaque lancement crée un paiement `lance`.

---

## POST `/paiements/avis/:prestataire/:org`

Avis envoyé par le prestataire (adresse transmise par `initier`). Jamais appelée par le navigateur.

**Débit** : 300 par minute.

**Lecture** : le corps est lu **brut** (sous-contexte Fastify encapsulé, `application/json` lu comme texte) pour vérifier la signature, puis analysé.

**Déroulé**

1. `:prestataire` inconnu ou `:org` mal formé : `404 introuvable`.
2. `prestataire.verifierAvis(entetes, corpsBrut)` renvoie `null` : avis tracé `signature_invalide`, réponse `401 avis_refuse`.
3. Paiement introuvable pour `(prestataire, reference_prestataire)` dans l'organisation : tracé `inconnu`, `404 introuvable`.
4. Paiement déjà `reussi`, `echoue` ou `a_rembourser` : tracé `deja_traite`, `200 { "recu": true, "issue": "deja_traite" }`.
5. Montant de l'avis ≠ `paiements_en_ligne.montant` : tracé `montant_different`, `409 avis_refuse`, rien ne change.
6. Avis d'échec : paiement `echoue`, tracé `echec`, `200`.
7. Avis de réussite : traitement de `research.md` sections 5 et 6, dans une transaction (verrou sur le paiement puis la commande), tracé `traite`, `200 { "recu": true, "issue": "traite", "statut": "facturee" | "payee" | "a_rembourser" }`.

Les réponses 200 font cesser les renvois du prestataire ; les refus (401, 404, 409) sont tracés dans `avis_paiement`.

---

## Suivi (lot 1, inchangé)

`GET /marketplace/:org/commandes/:reference?jeton=` renvoie désormais aussi les états `payee`, `facturee` et `a_rembourser`, et le colis dès qu'il existe.

---

## Codes d'erreur nouveaux (`MESSAGES`, `public/app.js`)

| Code | Message |
|---|---|
| `paiement_indisponible` | Le paiement en ligne est indisponible pour le moment. Réessayez plus tard ou choisissez le paiement à la livraison. |
| `paiement_impossible` | Cette commande ne peut plus être payée en ligne. |
| `avis_refuse` | Avis de paiement refusé. |
| `vente_deja_terminee` | Cette vente est déjà terminée. |
