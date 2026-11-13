"use strict";
/* Codes-barres dessinés en SVG, sans bibliothèque externe : EAN13 et CODE128 (jeu B). */

const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const EAN_PARITE = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
const inverserBits = (b) => [...b].map((x) => (x === "1" ? "0" : "1")).join("");
/** Clé de contrôle d'un EAN13 à partir de ses 12 premiers chiffres. */
const cleEan13 = (douze) => (10 - ([...douze].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0) % 10)) % 10;
const ean13Valide = (code) => /^\d{13}$/.test(code) && cleEan13(code.slice(0, 12)) === Number(code[12]);

/** Les 95 modules d'un EAN13 : « 1 » pour une barre, « 0 » pour un espace. */
function barresEan13(code) {
  if (!ean13Valide(code)) return null;
  const parite = EAN_PARITE[Number(code[0])];
  const gauche = [...code.slice(1, 7)].map((c, i) => {
    const l = EAN_L[Number(c)];
    return parite[i] === "L" ? l : [...inverserBits(l)].reverse().join("");
  }).join("");
  const droite = [...code.slice(7)].map((c) => inverserBits(EAN_L[Number(c)])).join("");
  return `101${gauche}01010${droite}101`;
}

// Largeurs des barres et des espaces de chaque symbole CODE128 (valeurs 0 à 105), puis le symbole d'arrêt.
const CODE128 = ("212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 "
  + "221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 "
  + "231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 "
  + "314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 "
  + "111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 "
  + "114131 311141 411131 211412 211214 211232").split(" ");
const CODE128_ARRET = "2331112";
/** Valeurs d'un texte en CODE128 jeu B : départ, caractères, clé de contrôle. Null si un caractère n'est pas imprimable. */
function valeursCode128(texte) {
  if (!texte || ![...texte].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126)) return null;
  const valeurs = [104, ...[...texte].map((c) => c.charCodeAt(0) - 32)];
  return [...valeurs, valeurs.reduce((s, v, i) => s + v * Math.max(i, 1), 0) % 103];
}
function barresCode128(texte) {
  const valeurs = valeursCode128(texte);
  if (!valeurs) return null;
  const largeurs = valeurs.map((v) => CODE128[v]).join("") + CODE128_ARRET;
  return [...largeurs].map((l, i) => (i % 2 ? "0" : "1").repeat(Number(l))).join("");
}

/** Format retenu : EAN13 seulement pour un code à 13 chiffres valide ; sinon CODE128. */
const formatCodeBarres = (code, voulu = "auto") => (voulu !== "CODE128" && ean13Valide(String(code)) ? "EAN13" : "CODE128");

/** Le code-barres en SVG, avec son texte dessous. Null si le code ne peut pas être dessiné. */
function dessinerCodeBarres(code, voulu = "auto") {
  const texte = String(code ?? "").trim();
  const format = formatCodeBarres(texte, voulu);
  const bits = format === "EAN13" ? barresEan13(texte) : barresCode128(texte);
  if (!bits) return null;
  const NS = "http://www.w3.org/2000/svg", marge = 10, haut = 40;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${bits.length + 2 * marge} ${haut + 12}`);
  svg.setAttribute("class", "code-barres");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Code-barres ${texte}`);
  svg.setAttribute("preserveAspectRatio", "none");
  let x = 0;
  while (x < bits.length) {
    if (bits[x] === "0") { x += 1; continue; }
    let l = 1;
    while (bits[x + l] === "1") l += 1;
    const r = document.createElementNS(NS, "rect");
    r.setAttribute("x", String(marge + x)); r.setAttribute("y", "0"); r.setAttribute("width", String(l)); r.setAttribute("height", String(haut));
    svg.append(r);
    x += l;
  }
  const t = document.createElementNS(NS, "text");
  t.setAttribute("x", String(marge + bits.length / 2)); t.setAttribute("y", String(haut + 10)); t.setAttribute("text-anchor", "middle"); t.setAttribute("font-size", "9");
  t.textContent = texte;
  svg.append(t);
  return svg;
}
