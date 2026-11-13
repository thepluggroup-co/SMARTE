import {
  createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual,
} from "node:crypto";

const N = 2 ** 15;
const R = 8;
const P = 1;
const LONGUEUR = 32;

function deriver(motDePasse: string, sel: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resoudre, rejeter) => {
    scrypt(motDePasse, sel, LONGUEUR, { N: n, r, p, maxmem: 256 * n * r }, (e, cle) =>
      e ? rejeter(e) : resoudre(cle),
    );
  });
}

export async function hacherMotDePasse(motDePasse: string): Promise<string> {
  const sel = randomBytes(16);
  const cle = await deriver(motDePasse, sel, N, R, P);
  return `scrypt$${N}$${R}$${P}$${sel.toString("base64url")}$${cle.toString("base64url")}`;
}

export async function verifierMotDePasse(motDePasse: string, enregistre: string): Promise<boolean> {
  const [algo, n, r, p, sel, cle] = enregistre.split("$");
  if (algo !== "scrypt" || !n || !r || !p || !sel || !cle) return false;
  const attendue = Buffer.from(cle, "base64url");
  const calculee = await deriver(motDePasse, Buffer.from(sel, "base64url"), +n, +r, +p);
  return calculee.length === attendue.length && timingSafeEqual(calculee, attendue);
}

/** Calculé une fois, pour que la réponse prenne le même temps si le compte n'existe pas. */
export const hashFictif = hacherMotDePasse(randomBytes(16).toString("hex"));

export function creerJeton(organisationId: string): { jeton: string; hash: string } {
  const jeton = `${organisationId}.${randomBytes(32).toString("base64url")}`;
  return { jeton, hash: hacherJeton(jeton) };
}

export function hacherJeton(jeton: string): string {
  return createHash("sha256").update(jeton).digest("hex");
}

/** Numéro comparable : sans séparateurs, avec l'indicatif 237 pour un numéro camerounais local. */
export function normaliserTelephone(valeur: string): string {
  const chiffres = valeur.replace(/\D/g, "").replace(/^00/, "");
  return chiffres.length === 9 ? `237${chiffres}` : chiffres;
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function creerSecretTotp(): string {
  let bits = "";
  for (const octet of randomBytes(20)) bits += octet.toString(2).padStart(8, "0");
  return bits.match(/.{5}/g)!.map((b) => BASE32[parseInt(b, 2)]).join("");
}

function decoderBase32(texte: string): Buffer {
  let bits = "";
  for (const c of texte) bits += BASE32.indexOf(c).toString(2).padStart(5, "0");
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
}

export function codeTotp(secret: string, pas: number): string {
  const compteur = Buffer.alloc(8);
  compteur.writeBigUInt64BE(BigInt(pas));
  const h = createHmac("sha1", decoderBase32(secret)).update(compteur).digest();
  const debut = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(debut) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

export const pasActuel = (ms = Date.now()) => Math.floor(ms / 30_000);

/** Renvoie le pas accepté, ou null. Un code déjà utilisé est refusé, avec une tolérance de 30 s. */
export function verifierTotp(secret: string, code: string, dernierPas: number | null): number | null {
  const actuel = pasActuel();
  for (const pas of [actuel - 1, actuel, actuel + 1]) {
    if (dernierPas !== null && pas <= dernierPas) continue;
    const attendu = Buffer.from(codeTotp(secret, pas));
    const recu = Buffer.from(code);
    if (attendu.length === recu.length && timingSafeEqual(attendu, recu)) return pas;
  }
  return null;
}

export function chiffrer(texte: string, cle: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cle, iv);
  const donnees = Buffer.concat([c.update(texte, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), donnees].map((b) => b.toString("base64url")).join(".");
}

export function dechiffrer(texte: string, cle: Buffer): string {
  const [iv, tag, donnees] = texte.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", cle, iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(donnees!), d.final()]).toString("utf8");
}
