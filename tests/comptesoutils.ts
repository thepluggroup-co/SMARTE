import { dansOrganisation } from "../src/base.js";
import { normaliserTelephone } from "../src/securite.js";
import type { environnementMessages } from "./messagesoutils.js";

type EnvM = Awaited<ReturnType<typeof environnementMessages>>;

/** Connexion et espace client d'une boutique, avec le prestataire de messages factice de l'environnement. */
export function comptes(env: EnvM, org: string) {
  const demanderCode = (numero: string) => env.api("POST", `/marketplace/${org}/compte/code`, undefined, { telephone: numero });
  /** Le dernier code envoyé à ce numéro, lu dans le prestataire factice. */
  const codeRecu = (numero: string): string | null => {
    const tel = normaliserTelephone(numero);
    const m = [...env.factice.envoyes].reverse().find((x) => x.telephone === tel && /code de connexion est [0-9]{6}/.test(x.texte));
    return m ? /code de connexion est ([0-9]{6})/.exec(m.texte)![1]! : null;
  };
  const saisir = (numero: string, code: string, nom?: string) =>
    env.api("POST", `/marketplace/${org}/compte/connexion`, undefined, { telephone: numero, code, ...(nom ? { nom } : {}) });
  /** Recule les codes d'un numéro : la connexion suivante n'attend pas la minute ni le quart d'heure. */
  const reculerCodes = (numero: string, minutes = 20) => dansOrganisation(env.poolAdmin, org, (c) => c.query(
    "update codes_connexion set cree_le = cree_le - make_interval(mins => $2) where organisation_id = org_courante() and telephone = $1",
    [normaliserTelephone(numero), minutes],
  ));
  /** Demande un code, le saisit et rend le jeton de session. */
  const connecter = async (numero: string, nom?: string): Promise<string> => {
    const d = await demanderCode(numero);
    if (d.statut !== 200) throw new Error(`code refusé : ${JSON.stringify(d.corps)}`);
    const r = await saisir(numero, codeRecu(numero)!, nom);
    if (r.statut !== 200) throw new Error(`connexion refusée : ${JSON.stringify(r.corps)}`);
    await reculerCodes(numero);
    return r.corps.jeton as string;
  };
  /** Appel d'une route du compte avec l'en-tête `Authorization: Client <jeton>`. */
  const appel = async (methode: string, chemin: string, jeton?: string, corps?: object) => {
    const r = await env.app.inject({
      method: methode as "GET", url: `/marketplace/${org}/compte${chemin}`,
      headers: jeton ? { authorization: `Client ${jeton}` } : {}, ...(corps ? { payload: corps } : {}),
    });
    return { statut: r.statusCode, corps: r.body ? JSON.parse(r.body) : null };
  };
  const sqlAdmin = (texte: string, valeurs: unknown[] = []) => dansOrganisation(env.poolAdmin, org, (c) => c.query(texte, valeurs));
  return { demanderCode, codeRecu, saisir, reculerCodes, connecter, appel, sqlAdmin };
}
