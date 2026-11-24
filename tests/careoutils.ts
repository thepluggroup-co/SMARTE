import type pg from "pg";
import { prestataireMessagesFactice } from "../src/messages.js";
import { prestataireFactice } from "../src/paiementenligne.js";
import { ErreurApi } from "../src/serveur.js";
import type { GenerateurIa, ReglagesIa } from "../src/studio.js";
import { boutique } from "./canaloutils.js";
import { comptes } from "./comptesoutils.js";
import { environnement } from "./outils.js";
import { SECRET } from "./paiementoutils.js";

/** Réponse de l'assistant telle que l'IA la rend (schéma de research.md R3). */
export const reponseIa = (reponse: string, autres: { sans_reponse?: boolean; propose_conseiller?: boolean; motif?: string | null } = {}) =>
  ({ reponse, sans_reponse: false, propose_conseiller: false, motif: null, ...autres });

export interface AppelIa { consigne: string; schema: object; reglages: ReglagesIa | undefined; connexions: number }

/**
 * IA factice, sans appel réseau : rend les réponses mises en file (ou la réponse par défaut), lève une erreur si on en met une.
 * Elle garde chaque consigne, ses réglages et le nombre de connexions de l'application en usage pendant l'appel.
 */
export function iaFactice() {
  const etat = {
    file: [] as unknown[],
    defaut: reponseIa("Réponse de test.") as unknown,
    appels: [] as AppelIa[],
    pool: undefined as pg.Pool | undefined,
  };
  const generateur: GenerateurIa = async (consigne, schema, reglages) => {
    etat.appels.push({ consigne, schema, reglages, connexions: etat.pool ? etat.pool.totalCount - etat.pool.idleCount : -1 });
    const r = etat.file.length ? etat.file.shift() : etat.defaut;
    if (r instanceof Error) throw r;
    return r;
  };
  return { generateur, etat };
}
export const iaEnPanne = () => new ErreurApi(502, "ia_indisponible");

/** Prestataires de paiement et de messages factices, IA factice (ou aucune IA), débits relevés. */
export async function environnementCare({ avecIa = true, care = 1000 } = {}) {
  const ia = iaFactice();
  const factice = prestataireMessagesFactice();
  const env = await environnement({
    prestatairesPaiement: [prestataireFactice(SECRET)], prestataireMessages: factice,
    ...(avecIa ? { generateurIa: ia.generateur } : {}),
    debitCanal: { commandes: 1000, paiements: 1000, codes: 1000, connexions: 1000, care },
  });
  ia.etat.pool = env.poolApp;
  return { ...env, factice, ia };
}
type EnvC = Awaited<ReturnType<typeof environnementCare>>;

type Boutique = Awaited<ReturnType<typeof boutique>>;

/** Boutique GLOMARI ouverte (zone Akwa à 1 000 FCFA en 1 jour, relais Kotto), assistant, relais et comptes clients. */
export async function boutiqueCare(env: EnvC) {
  return outilsCare(env, await boutique(env));
}

/** Les appels de l'assistant et des comptes clients sur une boutique d'essai déjà ouverte (celle des précommandes, par exemple). */
export function outilsCare<B extends Boutique>(env: EnvC, b: B) {
  const c = comptes(env, b.org);
  const vider = () => { env.ia.etat.file.length = 0; env.ia.etat.appels.length = 0; env.ia.etat.defaut = reponseIa("Réponse de test."); };
  vider();
  /** Appel d'une route de l'assistant, avec la session d'un client si elle est donnée. */
  const appelCare = async (methode: string, chemin: string, corps?: object, client?: string) => {
    const r = await env.app.inject({
      method: methode as "GET", url: `/marketplace/${b.org}/care${chemin}`,
      headers: client ? { authorization: `Client ${client}` } : {}, ...(corps ? { payload: corps } : {}),
    });
    return { statut: r.statusCode, corps: r.body ? JSON.parse(r.body) : null };
  };
  const demander = (texte: string, o: { conversation?: string; jeton?: string; client?: string; commande?: { reference: string; jeton: string } } = {}) =>
    appelCare("POST", "/messages", {
      texte, ...(o.conversation ? { conversation: o.conversation, jeton: o.jeton } : {}), ...(o.commande ? { commande: o.commande } : {}),
    }, o.client);
  const conseiller = (conversation: string, jeton: string, o: { nom?: string; telephone?: string; client?: string } = {}) =>
    appelCare("POST", "/conseiller", { conversation, jeton, ...(o.nom ? { nom: o.nom } : {}), ...(o.telephone ? { telephone: o.telephone } : {}) }, o.client);
  const reponseValidee = async (sujet: string, question: string, reponse: string) => {
    const r = await b.api("POST", "/care/reponses", { branche: b.G, sujet, question, reponse });
    if (r.statut !== 201) throw new Error(`réponse refusée : ${JSON.stringify(r.corps)}`);
    return r.corps.id as string;
  };
  /** La dernière consigne confiée à l'IA. */
  const derniereConsigne = () => env.ia.etat.appels.at(-1)?.consigne ?? "";
  return { ...b, ...c, vider, appelCare, demander, conseiller, reponseValidee, derniereConsigne };
}
export type BC = ReturnType<typeof outilsCare>;
