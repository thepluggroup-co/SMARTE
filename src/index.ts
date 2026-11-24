import pg from "pg";
import { prestataireMessagesFactice } from "./messages.js";
import { prestataireFactice } from "./paiementenligne.js";
import { creerServeur } from "./serveur.js";
import { generateurClaude } from "./studio.js";

const { DATABASE_URL, ERP_CLE_SECRETS, ERP_URL_PUBLIQUE } = process.env;
if (!DATABASE_URL || !ERP_CLE_SECRETS || !ERP_URL_PUBLIQUE) {
  throw new Error("DATABASE_URL, ERP_CLE_SECRETS et ERP_URL_PUBLIQUE sont obligatoires");
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const app = await creerServeur(pool, {
  cleSecrets: Buffer.from(ERP_CLE_SECRETS, "base64"),
  urlPublique: ERP_URL_PUBLIQUE,
  derriereProxy: process.env.ERP_DERRIERE_PROXY === "oui",
  webhooksAuto: true,
  cleConsole: process.env.ERP_CONSOLE_CLE || undefined,
  poolAdmin: process.env.ERP_CONSOLE_CLE && process.env.DATABASE_ADMIN_URL ? new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL, max: 2 }) : undefined,
  dossierMedias: process.env.ERP_DOSSIER_MEDIAS || undefined,
  videoMaxOctets: process.env.ERP_VIDEO_MAX_MO ? Number(process.env.ERP_VIDEO_MAX_MO) * 1024 ** 2 : undefined,
  generateurIa: process.env.ERP_IA_CLE && process.env.ERP_IA_MODELE
    ? generateurClaude(process.env.ERP_IA_CLE, process.env.ERP_IA_MODELE)
    : undefined,
  // Essai privé seulement : tant que la direction n'a pas choisi le prestataire réel.
  prestatairesPaiement: process.env.ERP_PAIEMENT_FACTICE_SECRET ? [prestataireFactice(process.env.ERP_PAIEMENT_FACTICE_SECRET)] : [],
  // Essai privé seulement : les messages sont marqués envoyés sans partir, tant que le prestataire réel n'est pas choisi.
  prestataireMessages: process.env.ERP_MESSAGES_FACTICE === "1" ? prestataireMessagesFactice() : undefined,
  debitCanal: {
    commandes: process.env.ERP_CANAL_COMMANDES_PAR_MINUTE ? Number(process.env.ERP_CANAL_COMMANDES_PAR_MINUTE) : undefined,
    paiements: process.env.ERP_CANAL_PAIEMENTS_PAR_MINUTE ? Number(process.env.ERP_CANAL_PAIEMENTS_PAR_MINUTE) : undefined,
    codes: process.env.ERP_CANAL_CODES_PAR_MINUTE ? Number(process.env.ERP_CANAL_CODES_PAR_MINUTE) : undefined,
    connexions: process.env.ERP_CANAL_CONNEXIONS_PAR_MINUTE ? Number(process.env.ERP_CANAL_CONNEXIONS_PAR_MINUTE) : undefined,
  },
});

// Une connexion inactive coupée par la base ne doit pas arrêter le serveur : le pool la remplace.
pool.on("error", (erreur) => app.log.error(erreur, "connexion à la base perdue"));

async function arreter() {
  await app.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", arreter);
process.on("SIGINT", arreter);

await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
