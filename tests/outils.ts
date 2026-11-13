import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { provisionnerOrganisation, STRUCTURE_SGC } from "../src/provisionnement.js";
import { creerServeur } from "../src/serveur.js";

export const MOT_DE_PASSE = "un-mot-de-passe-solide";

export const OPTIONS = {
  cleSecrets: randomBytes(32),
  urlPublique: "https://erp.test",
  connexionsParMinute: 100_000,
};

export async function environnement() {
  const poolApp = new pg.Pool({ connectionString: process.env.TEST_BASE_APP_URL });
  const poolAdmin = new pg.Pool({ connectionString: process.env.TEST_BASE_ADMIN_URL });
  const app = await creerServeur(poolApp, OPTIONS);

  const api = async (methode: string, url: string, jeton?: string, corps?: object) => {
    const r = await app.inject({
      method: methode as "GET",
      url,
      headers: jeton ? { authorization: `Bearer ${jeton}` } : {},
      ...(corps ? { payload: corps as object } : {}),
    });
    const json = r.headers["content-type"]?.toString().includes("json");
    return { statut: r.statusCode, corps: r.body && json ? JSON.parse(r.body) : r.body || null };
  };

  const connecter = async (organisation: string, email: string, motDePasse = MOT_DE_PASSE) => {
    const r = await api("POST", "/connexion", undefined, { organisation, email, motDePasse });
    if (r.statut !== 200) throw new Error(`connexion refusée : ${r.statut}`);
    return r.corps.jeton as string;
  };

  const nouvelleOrganisation = async () => {
    const slug = `org-${randomUUID().slice(0, 8)}`;
    const email = `admin@${slug}.test`;
    const o = await provisionnerOrganisation(poolAdmin, {
      slug, nom: slug, racine: STRUCTURE_SGC, admin: { email, nom: "Admin", motDePasse: MOT_DE_PASSE },
    });
    return { ...o, slug, email, jeton: await connecter(slug, email) };
  };

  const fermer = async () => {
    await app.close();
    await poolApp.end();
    await poolAdmin.end();
  };

  return { app, api, connecter, nouvelleOrganisation, poolApp, poolAdmin, fermer };
}
