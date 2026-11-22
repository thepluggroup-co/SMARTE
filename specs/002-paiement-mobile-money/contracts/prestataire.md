# Contrat : prestataire de paiement interchangeable (lot 2)

**Fichier** : `src/paiementenligne.ts` (interface et prestataire factice). Un fichier par prestataire réel, ajouté après le choix de la direction.
**Branchement** : `OptionsServeur.prestatairesPaiement?: PrestatairePaiement[]`, comme `generateurIa` (`src/studio.ts`). `src/index.ts` les construit depuis `.env` ; les tests passent le factice.

---

## Interface

```ts
type MoyenEnLigne = "orange_money" | "mtn_momo";

interface DemandePaiement {
  referenceCommande: string;   // WEB-AAAA-000000
  montant: number;             // FCFA entiers, total TTC de la commande
  moyen: MoyenEnLigne;
  telephone: string;           // normalisé, 237…
  adresseAvis: string;         // `${urlPublique}/paiements/avis/${nom}/${organisationId}`
  libelle: string;             // « GLOMARI, commande WEB-… »
}

interface AvisPaiement {
  referencePrestataire: string;
  statut: "reussi" | "echoue";
  montant: number;
}

interface PrestatairePaiement {
  nom: string;                                   // /^[a-z0-9]{2,30}$/
  moyens: MoyenEnLigne[];
  initier(d: DemandePaiement): Promise<{
    referencePrestataire: string;
    instruction: { type: "telephone"; texte: string } | { type: "lien"; url: string };
  }>;
  /** Null si la signature manque ou est fausse. Ne lève jamais d'exception sur un corps illisible : null. */
  verifierAvis(entetes: Record<string, string | string[] | undefined>, corpsBrut: string): AvisPaiement | null;
}
```

Règles communes :

- `initier` peut échouer (réseau, refus) : l'appelant répond `503 paiement_indisponible`.
- `verifierAvis` compare les signatures en temps constant (`timingSafeEqual`).
- Aucun identifiant dans le code : chaque prestataire réel lit les siens dans `.env`.

---

## Prestataire factice

- `nom` : `factice` ; `moyens` : `["orange_money", "mtn_momo"]`.
- Construit avec un secret : `prestataireFactice(secret)`. En production, seulement si `ERP_PAIEMENT_FACTICE_SECRET` est défini dans `.env` (essai privé, données fictives).
- `initier` : renvoie `referencePrestataire` = `FACTICE-` + 16 octets aléatoires en hexadécimal, et l'instruction `{ type: "telephone", texte: "Validez le paiement sur votre téléphone." }`. N'appelle aucun réseau.
- Avis : corps JSON `{ "reference_prestataire": "…", "statut": "reussi" | "echoue", "montant": 836750 }`, en-tête `x-signature` = HMAC SHA-256 hexadécimal du corps brut avec le secret.
- Une fonction d'aide exportée `signerAvisFactice(secret, corps)` sert aux tests et à l'essai : elle renvoie `{ corpsBrut, signature }`.
