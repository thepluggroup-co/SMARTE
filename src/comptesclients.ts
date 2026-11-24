import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { dansOrganisation, type Client } from "./base.js";
import { detailCommandeWeb, ficheClient, parBoutique, trouverFicheClient, verifierLivraison, type Boutique } from "./canalenligne.js";
import { mobileCamerounais, type PrestataireMessages } from "./messages.js";
import { creerCommandeSolde, detailPrecommande, expirerPrecommandes } from "./precommandes.js";
import { hacherJeton } from "./securite.js";
import { ErreurApi, type Outils } from "./serveur.js";

/**
 * Comptes clients de la Marketplace (lot 4, partie B) : connexion par téléphone et code reçu par SMS, sans mot de passe.
 * Le compte est la fiche client de la branche de la boutique. Ni le code ni le jeton de session ne sont gardés en clair :
 * le code par une empreinte à clé (six chiffres seulement), le jeton par son empreinte.
 */

export const DUREE_CODE_MINUTES = 10;
export const ESSAIS_MAX_CODE = 5;
export const DUREE_SESSION_JOURS = 7;
export const ADRESSES_MAX = 5;

const uuid = { type: "string", format: "uuid" } as const;
const REFERENCE_PRECOMMANDE = /^PRE-[0-9]{4}-[0-9]{6}$/;
const ENTETE = /^Client ([A-Za-z0-9_-]{43})$/;
const parMinute = (max: number) => ({ rateLimit: { max, timeWindow: "1 minute" } });

export interface OptionsComptes {
  prestataire?: PrestataireMessages; cleSecrets: Buffer; urlPublique: string; codesParMinute: number; connexionsParMinute: number; commandesParMinute: number;
}
export interface Session { id: string; tiers_id: string; nom: string; telephone: string; email: string | null; expire_le: Date }

/** L'empreinte lie le code à l'organisation et au numéro : un code ne vaut nulle part ailleurs. */
const empreinteCode = (cle: Buffer, org: string, telephone: string, code: string) => createHmac("sha256", cle).update(`${org}:${telephone}:${code}`).digest("hex");

/** La session de la requête : en-tête `Authorization: Client <jeton>`, valable, sur une fiche intacte de la branche. */
export async function clientConnecte(c: Client, b: Boutique, req: FastifyRequest): Promise<Session> {
  const m = ENTETE.exec(req.headers.authorization ?? "");
  if (!m) throw new ErreurApi(401, "session_invalide");
  const { rows: [s] } = await c.query(
    `select s.id, s.tiers_id, t.nom, t.telephone, t.email, s.expire_le from sessions_clients s join tiers t on t.id = s.tiers_id
     where s.jeton_hache = $1 and s.branche_id = $2 and s.revoque_le is null and s.expire_le > now()
       and not t.archive and t.fusionne_vers is null and t.telephone = s.telephone and t.branche_id = $2`,
    [hacherJeton(m[1]!), b.branche],
  );
  if (!s) throw new ErreurApi(401, "session_invalide");
  return s as Session;
}

const profil = (s: { nom: string; telephone: string; email: string | null }) => ({ nom: s.nom, telephone: s.telephone, email: s.email });

export function enregistrerComptesClients(app: FastifyInstance, pool: pg.Pool, outils: Outils, options: OptionsComptes): void {
  const { protege, exigerSurEntite } = outils;

  // ---------- Connexion ----------

  /** Même réponse que le numéro soit connu ou non ; le code part aussitôt, à toute heure. */
  app.post<{ Params: { org: string }; Body: { telephone: string } }>("/marketplace/:org/compte/code", {
    config: parMinute(options.codesParMinute),
    schema: { body: { type: "object", additionalProperties: false, required: ["telephone"], properties: { telephone: { type: "string", minLength: 1, maxLength: 30 } } } },
  }, async (req) => {
    const telephone = mobileCamerounais(req.body.telephone);
    if (!telephone) throw new ErreurApi(400, "numero_invalide");
    const prestataire = options.prestataire;
    if (!prestataire) throw new ErreurApi(503, "sms_indisponible");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const nouveau = await parBoutique(pool, req.params.org, async (c, b) => {
      await c.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`code:${telephone}`]);
      // Une minute entre deux codes, trois par quart d'heure, dix par 24 heures.
      const { rows: [l] } = await c.query(
        `select greatest(0,
           ceil(extract(epoch from (max(cree_le) + interval '1 minute' - now()))),
           case when count(*) filter (where cree_le > now() - interval '15 minutes') >= 3
             then ceil(extract(epoch from (min(cree_le) filter (where cree_le > now() - interval '15 minutes') + interval '15 minutes' - now()))) else 0 end,
           case when count(*) >= 10 then ceil(extract(epoch from (min(cree_le) + interval '24 hours' - now()))) else 0 end)::int as attendre
         from codes_connexion where telephone = $1 and cree_le > now() - interval '24 hours'`,
        [telephone],
      );
      if (l.attendre > 0) throw new ErreurApi(409, "code_trop_tot", { attendre_secondes: l.attendre });
      await c.query("update codes_connexion set invalide_le = now() where telephone = $1 and utilise_le is null and invalide_le is null and expire_le > now()", [telephone]);
      const { rows: [x] } = await c.query(
        `insert into codes_connexion (organisation_id, branche_id, telephone, code_hache, expire_le)
         values ($1, $2, $3, $4, now() + make_interval(mins => $5)) returning id`,
        [b.org, b.branche, telephone, empreinteCode(options.cleSecrets, b.org, telephone, code), DUREE_CODE_MINUTES],
      );
      return { id: x.id as string, marque: b.nom };
    });
    // Le code est enregistré avant de partir : un SMS ne porte jamais un code inconnu de la base.
    const r = await prestataire.envoyer({
      canal: "sms", telephone, reference: nouveau.id,
      texte: `${nouveau.marque} : votre code de connexion est ${code}. Il expire dans ${DUREE_CODE_MINUTES} minutes. Ne le donnez à personne.`,
    }).catch(() => ({ ok: false }));
    await dansOrganisation(pool, req.params.org, (c) => c.query("update codes_connexion set envoi = $2 where id = $1", [nouveau.id, r.ok ? "envoye" : "echec"]));
    if (!r.ok) throw new ErreurApi(503, "sms_indisponible");
    return { envoye: true, valable_minutes: DUREE_CODE_MINUTES };
  });

  /** Le bon code ouvre une session de 7 jours ; cinq erreurs invalident le code. Les essais faux sont gardés même en cas de refus. */
  app.post<{ Params: { org: string }; Body: { telephone: string; code: string; nom?: string } }>("/marketplace/:org/compte/connexion", {
    config: parMinute(options.connexionsParMinute),
    schema: {
      body: {
        type: "object", additionalProperties: false, required: ["telephone", "code"],
        properties: { telephone: { type: "string", minLength: 1, maxLength: 30 }, code: { type: "string", pattern: "^[0-9]{6}$" }, nom: { type: "string", minLength: 2, maxLength: 200 } },
      },
    },
  }, async (req) => {
    const telephone = mobileCamerounais(req.body.telephone);
    if (!telephone) throw new ErreurApi(400, "numero_invalide");
    const nom = req.body.nom?.trim();
    if (nom !== undefined && nom.length < 2) throw new ErreurApi(400, "donnees_invalides");
    const r = await parBoutique(pool, req.params.org, async (c, b) => {
      const { rows: [k] } = await c.query(
        `select id, code_hache, essais from codes_connexion
         where telephone = $1 and branche_id = $2 and utilise_le is null and invalide_le is null and expire_le > now()
         order by cree_le desc limit 1 for update`,
        [telephone, b.branche],
      );
      if (!k) return { refus: new ErreurApi(401, "code_expire") };
      const attendu = Buffer.from(k.code_hache, "hex");
      const recu = Buffer.from(empreinteCode(options.cleSecrets, b.org, telephone, req.body.code), "hex");
      if (!timingSafeEqual(attendu, recu)) {
        const essais = Number(k.essais) + 1;
        await c.query("update codes_connexion set essais = $2::int, invalide_le = case when $3::boolean then now() end where id = $1", [k.id, essais, essais >= ESSAIS_MAX_CODE]);
        if (essais >= ESSAIS_MAX_CODE) await c.query("select journal_evenement('compte_client.blocage', $1)", [JSON.stringify({ code: k.id })]);
        return { refus: new ErreurApi(401, "code_incorrect", { essais_restants: Math.max(ESSAIS_MAX_CODE - essais, 0) }) };
      }
      let tiersId = await trouverFicheClient(c, b.branche, telephone);
      if (!tiersId) {
        // Le code reste valable : le client donne son nom et recommence dans les 10 minutes.
        if (!nom) return { refus: new ErreurApi(409, "nom_requis") };
        tiersId = await ficheClient(c, b, b.branche, nom, telephone);
      }
      await c.query("update codes_connexion set utilise_le = now() where id = $1", [k.id]);
      const jeton = randomBytes(32).toString("base64url");
      const { rows: [s] } = await c.query(
        `insert into sessions_clients (organisation_id, branche_id, tiers_id, telephone, jeton_hache, expire_le)
         values ($1, $2, $3, $4, $5, now() + make_interval(days => $6)) returning id, expire_le`,
        [b.org, b.branche, tiersId, telephone, hacherJeton(jeton), DUREE_SESSION_JOURS],
      );
      await c.query("select journal_evenement('compte_client.connexion', $1)", [JSON.stringify({ tiers: tiersId, session: s.id })]);
      const { rows: [t] } = await c.query("select nom, telephone, email from tiers where id = $1", [tiersId]);
      return { jeton, expire_le: s.expire_le, client: profil(t) };
    });
    if ("refus" in r) throw r.refus;
    return r;
  });

  app.post<{ Params: { org: string }; Body?: { tous?: boolean } | null }>("/marketplace/:org/compte/deconnexion", {
    schema: { body: { type: ["object", "null"], additionalProperties: false, properties: { tous: { type: "boolean" } } } },
  }, async (req) =>
    parBoutique(pool, req.params.org, async (c, b) => {
      const s = await clientConnecte(c, b, req);
      const tous = req.body?.tous === true;
      const { rowCount } = tous
        ? await c.query("update sessions_clients set revoque_le = now() where revoque_le is null and tiers_id = $1", [s.tiers_id])
        : await c.query("update sessions_clients set revoque_le = now() where revoque_le is null and id = $1", [s.id]);
      if (tous) await c.query("select journal_evenement('compte_client.deconnexion_tous', $1)", [JSON.stringify({ tiers: s.tiers_id, par: "client" })]);
      return { deconnecte: true, sessions: rowCount ?? 0 };
    }),
  );

  // ---------- Espace client ----------

  app.get<{ Params: { org: string } }>("/marketplace/:org/compte", async (req) =>
    parBoutique(pool, req.params.org, async (c, b) => {
      const s = await clientConnecte(c, b, req);
      return { client: profil(s), session: { expire_le: s.expire_le } };
    }),
  );

  /** Le nom et l'e-mail se corrigent ici ; le téléphone, qui identifie le compte, non. */
  app.patch<{ Params: { org: string }; Body: { nom?: string; email?: string | null } }>("/marketplace/:org/compte", {
    schema: {
      body: {
        type: "object", additionalProperties: false, minProperties: 1,
        properties: { nom: { type: "string", minLength: 2, maxLength: 200 }, email: { type: ["string", "null"], format: "email", maxLength: 320 } },
      },
    },
  }, async (req) =>
    parBoutique(pool, req.params.org, async (c, b) => {
      const s = await clientConnecte(c, b, req);
      // Les champs inconnus (le téléphone, par exemple) sont retirés à la lecture : il doit rester le nom ou l'e-mail.
      if (req.body.nom === undefined && req.body.email === undefined) throw new ErreurApi(400, "donnees_invalides");
      const nom = req.body.nom?.trim();
      if (nom !== undefined && nom.length < 2) throw new ErreurApi(400, "donnees_invalides");
      const { rows: [t] } = await c.query(
        "update tiers set nom = coalesce($2, nom), email = case when $3 then $4 else email end where id = $1 returning nom, telephone, email",
        [s.tiers_id, nom ?? null, req.body.email !== undefined, req.body.email?.toLowerCase() ?? null],
      );
      return { client: profil(t) };
    }),
  );

  app.get<{ Params: { org: string } }>("/marketplace/:org/compte/commandes", async (req) =>
    parBoutique(pool, req.params.org, async (c, b) => {
      const s = await clientConnecte(c, b, req);
      const { rows } = await c.query("select id from commandes_web where tiers_id = $1 and entite_id = $2 order by cree_le desc limit 100", [s.tiers_id, b.branche]);
      const commandes = [];
      for (const w of rows) commandes.push(await detailCommandeWeb(c, b, w.id, options.urlPublique));
      return commandes.filter(Boolean);
    }),
  );

  const precommandesDe = async (c: Client, b: Boutique, tiersId: string, reference?: string) => (await c.query(
    `select i.*, row_to_json(k) as campagne, p.nom as produit from inscriptions_precommande i
     join campagnes_arrivage k on k.id = i.campagne_id join produits p on p.id = k.produit_id
     where i.tiers_id = $1 and k.entite_id = $2 and ($3::text is null or i.reference = $3) order by i.cree_le desc limit 100`,
    [tiersId, b.branche, reference ?? null],
  )).rows;

  app.get<{ Params: { org: string } }>("/marketplace/:org/compte/precommandes", async (req) =>
    parBoutique(pool, req.params.org, async (c, b) => {
      const s = await clientConnecte(c, b, req);
      await expirerPrecommandes(c);
      const liste = [];
      for (const i of await precommandesDe(c, b, s.tiers_id)) liste.push(await detailPrecommande(c, i));
      return liste;
    }),
  );

  /** Le même solde que par le lien de suivi ; la commande rendue se paie par la route de paiement des commandes. */
  app.post<{ Params: { org: string; reference: string }; Body: { modeLivraison: string; zoneId?: string; pointRelaisId?: string; adresse?: string; moyenPaiement: string } }>(
    "/marketplace/:org/compte/precommandes/:reference/solde", {
      config: parMinute(options.commandesParMinute),
      schema: {
        body: {
          type: "object", additionalProperties: false, required: ["modeLivraison", "moyenPaiement"],
          properties: {
            modeLivraison: { type: "string", maxLength: 30 }, zoneId: uuid, pointRelaisId: uuid, adresse: { type: "string", maxLength: 500 },
            moyenPaiement: { type: "string", enum: ["orange_money", "mtn_momo"] },
          },
        },
      },
    }, async (req, reponse) => {
      if (!REFERENCE_PRECOMMANDE.test(req.params.reference)) throw new ErreurApi(404, "introuvable");
      verifierLivraison(req.body);
      const r = await parBoutique(pool, req.params.org, async (c, b) => {
        const s = await clientConnecte(c, b, req);
        await expirerPrecommandes(c);
        const [i] = await precommandesDe(c, b, s.tiers_id, req.params.reference);
        if (!i) throw new ErreurApi(404, "introuvable");
        return creerCommandeSolde(c, b, i.id, req.body);
      });
      return reponse.status(201).send(r);
    },
  );

  // ---------- Adresses ----------

  const schemaAdresse = {
    type: "object", additionalProperties: false, required: ["nom", "adresse"],
    properties: {
      nom: { type: "string", minLength: 1, maxLength: 50 }, zoneId: { type: ["string", "null"], format: "uuid" },
      adresse: { type: "string", minLength: 3, maxLength: 500 }, repere: { type: ["string", "null"], maxLength: 200 }, parDefaut: { type: "boolean" },
    },
  } as const;
  type CorpsAdresse = { nom: string; zoneId?: string | null; adresse: string; repere?: string | null; parDefaut?: boolean };
  const listeAdresses = async (c: Client, tiersId: string) => (await c.query(
    `select a.id, a.nom, a.zone_id, z.nom as zone, a.adresse, a.repere, a.par_defaut from adresses_clients a
     left join zones_livraison z on z.id = a.zone_id where a.tiers_id = $1 order by a.par_defaut desc, a.cree_le, a.id`,
    [tiersId],
  )).rows;
  /** Zone de la branche de la boutique ; un seul « par défaut » par fiche, sous le verrou de la fiche. */
  const ecrireAdresse = async (c: Client, b: Boutique, tiersId: string, x: CorpsAdresse, id?: string) => {
    if (!x.nom.trim() || x.adresse.trim().length < 3) throw new ErreurApi(400, "donnees_invalides");
    if (x.zoneId) {
      const { rows: [z] } = await c.query("select 1 from zones_livraison where id = $1 and entite_id = $2", [x.zoneId, b.branche]);
      if (!z) throw new ErreurApi(400, "zone_invalide");
    }
    if (x.parDefaut) await c.query("update adresses_clients set par_defaut = false where tiers_id = $1 and par_defaut and id is distinct from $2", [tiersId, id ?? null]);
    const valeurs = [x.nom.trim(), x.zoneId ?? null, x.adresse.trim(), x.repere?.trim() || null, x.parDefaut ?? false];
    const { rows: [a] } = id
      ? await c.query(
        "update adresses_clients set nom = $3, zone_id = $4, adresse = $5, repere = $6, par_defaut = $7 where id = $1 and tiers_id = $2 returning id",
        [id, tiersId, ...valeurs])
      : await c.query(
        "insert into adresses_clients (organisation_id, tiers_id, nom, zone_id, adresse, repere, par_defaut) values ($1, $2, $3, $4, $5, $6, $7) returning id",
        [b.org, tiersId, ...valeurs]);
    if (!a) throw new ErreurApi(404, "introuvable");
    return (await listeAdresses(c, tiersId)).find((y) => y.id === a.id);
  };

  app.get<{ Params: { org: string } }>("/marketplace/:org/compte/adresses", async (req) =>
    parBoutique(pool, req.params.org, async (c, b) => listeAdresses(c, (await clientConnecte(c, b, req)).tiers_id)),
  );

  app.post<{ Params: { org: string }; Body: CorpsAdresse }>("/marketplace/:org/compte/adresses", { schema: { body: schemaAdresse } }, async (req, reponse) => {
    const r = await parBoutique(pool, req.params.org, async (c, b) => {
      const s = await clientConnecte(c, b, req);
      await c.query("select 1 from tiers where id = $1 for update", [s.tiers_id]);
      const { rows: [n] } = await c.query("select count(*)::int as n from adresses_clients where tiers_id = $1", [s.tiers_id]);
      if (n.n >= ADRESSES_MAX) throw new ErreurApi(409, "adresses_max");
      return ecrireAdresse(c, b, s.tiers_id, req.body);
    });
    return reponse.status(201).send(r);
  });

  app.put<{ Params: { org: string; id: string }; Body: CorpsAdresse }>("/marketplace/:org/compte/adresses/:id", {
    schema: { params: { type: "object", required: ["org", "id"], properties: { org: { type: "string" }, id: uuid } }, body: schemaAdresse },
  }, async (req) =>
    parBoutique(pool, req.params.org, async (c, b) => {
      const s = await clientConnecte(c, b, req);
      await c.query("select 1 from tiers where id = $1 for update", [s.tiers_id]);
      return ecrireAdresse(c, b, s.tiers_id, req.body, req.params.id);
    }),
  );

  app.delete<{ Params: { org: string; id: string } }>("/marketplace/:org/compte/adresses/:id", {
    schema: { params: { type: "object", required: ["org", "id"], properties: { org: { type: "string" }, id: uuid } } },
  }, async (req) =>
    parBoutique(pool, req.params.org, async (c, b) => {
      const s = await clientConnecte(c, b, req);
      const { rowCount } = await c.query("delete from adresses_clients where id = $1 and tiers_id = $2", [req.params.id, s.tiers_id]);
      if (!rowCount) throw new ErreurApi(404, "introuvable");
      return { supprime: true };
    }),
  );

  // ---------- Fidélité ----------

  /** Les points de la fiche de cette branche : les fiches, donc les points, sont séparées par branche. */
  app.get<{ Params: { org: string } }>("/marketplace/:org/compte/fidelite", async (req) =>
    parBoutique(pool, req.params.org, async (c, b) => {
      const s = await clientConnecte(c, b, req);
      const { rows: [regle] } = await c.query("select actif, valeur_point from regles_fidelite where branche_id = $1", [b.branche]);
      const { rows: [t] } = await c.query("select coalesce(sum(points), 0)::int8 as solde from points_fidelite where tiers_id = $1", [s.tiers_id]);
      const { rows: mouvements } = await c.query(
        "select (cree_le at time zone 'Africa/Douala')::date::text as date, points, motif from points_fidelite where tiers_id = $1 order by cree_le desc, id limit 50",
        [s.tiers_id],
      );
      const solde = Number(t.solde);
      return { actif: Boolean(regle?.actif), solde, valeur_fcfa: regle ? solde * Number(regle.valeur_point) : 0, mouvements };
    }),
  );

  // ---------- Personnel ----------

  /** À la demande du client, l'équipe Care coupe tous ses appareils ; l'action est tracée. */
  app.post<{ Params: { id: string } }>("/tiers/:id/comptes-en-ligne/deconnexion", {
    schema: { params: { type: "object", required: ["id"], properties: { id: uuid } } },
  }, async (req) =>
    protege(req, async (ctx) => {
      const { rows: [t] } = await ctx.client.query("select id, branche_id from tiers where id = $1", [req.params.id]);
      if (!t?.branche_id) throw new ErreurApi(404, "introuvable");
      await exigerSurEntite(ctx, "care.gerer", t.branche_id);
      const { rowCount } = await ctx.client.query(
        "update sessions_clients set revoque_le = now(), revoque_par = $2 where tiers_id = $1 and revoque_le is null", [t.id, ctx.utilisateurId],
      );
      await ctx.client.query("select journal_evenement('compte_client.deconnexion_tous', $1)", [JSON.stringify({ tiers: t.id, par: "equipe" })]);
      return { sessions: rowCount ?? 0 };
    }),
  );
}
