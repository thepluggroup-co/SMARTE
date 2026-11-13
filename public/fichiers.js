"use strict";
/*
 * Fichiers produits et lus dans le navigateur, sans bibliothèque externe :
 * CSV (séparateur point-virgule, pour Excel en français), Excel (.xlsx), PDF, et lecture d'un CSV ou d'un .xlsx.
 * Une cellule est une chaîne ou un nombre. Rien ne quitte l'appareil.
 */

function telechargerFichier(contenu, nom, type) {
  const u = URL.createObjectURL(new Blob(contenu, { type }));
  h("a", { href: u, download: nom }).click();
  setTimeout(() => URL.revokeObjectURL(u), 10000);
}

/** CSV lisible par Excel en français : point-virgule, virgule décimale, et aucune formule possible. */
function fichierCsv(nom, lignes) {
  const cel = (v) => {
    if (typeof v === "number") return String(v).replace(".", ",");
    const t = String(v ?? "");
    const x = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
    return `"${x.replace(/"/g, '""')}"`;
  };
  telechargerFichier(["﻿", lignes.map((l) => l.map(cel).join(";")).join("\r\n")], `${nom}.csv`, "text/csv;charset=utf-8");
}

const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(octets) {
  let c = 0xffffffff;
  for (const o of octets) c = TABLE_CRC[(c ^ o) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Archive ZIP sans compression : c'est tout ce qu'il faut pour un .xlsx. */
function archiveZip(fichiers) {
  const enc = new TextEncoder();
  const parties = [];
  const central = [];
  let position = 0;
  const mot = (n) => [n & 0xff, (n >>> 8) & 0xff];
  const long = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  for (const [nom, texte] of fichiers) {
    const n = enc.encode(nom);
    const d = enc.encode(texte);
    const crc = crc32(d);
    const commun = [...mot(20), ...mot(0x0800), ...mot(0), ...mot(0), ...mot(0x21), ...long(crc), ...long(d.length), ...long(d.length), ...mot(n.length), ...mot(0)];
    const local = new Uint8Array([...long(0x04034b50), ...commun]);
    parties.push(local, n, d);
    central.push(new Uint8Array([...long(0x02014b50), ...mot(20), ...commun, ...mot(0), ...mot(0), ...mot(0), ...long(0), ...long(position)]), n);
    position += local.length + n.length + d.length;
  }
  const taille = central.reduce((s, x) => s + x.length, 0);
  const fin = new Uint8Array([...long(0x06054b50), ...mot(0), ...mot(0), ...mot(fichiers.length), ...mot(fichiers.length), ...long(taille), ...long(position), ...mot(0)]);
  return [...parties, ...central, fin];
}

const xmlTexte = (t) => String(t).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colonneExcel = (i) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/** Classeur Excel d'une feuille. Les lignes listées dans « grasses » sont en gras (titres, en-têtes, totaux). */
function fichierExcel(nom, feuille, lignes, { grasses = [], largeurs = [] } = {}) {
  const gras = new Set(grasses);
  const rangs = lignes.map((l, r) => `<row r="${r + 1}">${l.map((v, c) => {
    const ref = `${colonneExcel(c)}${r + 1}`;
    if (v === null || v === undefined || v === "") return "";
    // Styles : 1 gras, 2 nombre avec séparateur de milliers, 3 les deux.
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}" s="${gras.has(r) ? 3 : 2}"><v>${v}</v></c>`;
    return `<c r="${ref}"${gras.has(r) ? ' s="1"' : ""} t="inlineStr"><is><t xml:space="preserve">${xmlTexte(v)}</t></is></c>`;
  }).join("")}</row>`).join("");
  const cols = largeurs.length ? `<cols>${largeurs.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const nsr = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const tete = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const fichiers = [
    ["[Content_Types].xml", `${tete}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `${tete}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `${tete}<workbook ${ns} ${nsr}><sheets><sheet name="${xmlTexte(feuille.slice(0, 31).replace(/[\\/?*[\]:]/g, " "))}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `${tete}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `${tete}<styleSheet ${ns}><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.###"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ["xl/worksheets/sheet1.xml", `${tete}<worksheet ${ns}>${cols}<sheetData>${rangs}</sheetData></worksheet>`],
  ];
  telechargerFichier(archiveZip(fichiers), `${nom}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

/* PDF : polices standard Helvetica, encodage Windows (accents français compris). */
const LARGEURS_HELVETICA = (() => {
  const w = {};
  const series = [
    [" ", 278], ["!", 278], ['"', 355], ["#$", 556], ["%", 889], ["&", 667], ["'", 191], ["()", 333], ["*", 389], ["+", 584],
    [",", 278], ["-", 333], ["./:;", 278], ["0123456789", 556], ["<=>", 584], ["?", 556], ["@", 1015],
    ["ABEKPSVXY", 667], ["CDHNRUw", 722], ["FTZ", 611], ["GOQ", 778], ["IJ", 278], ["L", 556], ["M", 833], ["W", 944],
    ["[\\]", 278], ["^", 469], ["_", 556], ["`", 333], ["abdeghnopqu", 556], ["ckszvxy", 500], ["fjt", 278], ["il", 222],
    ["j", 222], ["m", 833], ["r", 333], ["{}", 334], ["|", 260], ["~", 584], ["«»", 556], ["°", 400], ["³²", 333], ["’‘", 222], ["…", 1000], ["€", 556],
  ];
  for (const [chars, l] of series) for (const ch of chars) w[ch] = l;
  w.J = 500;
  return w;
})();
const CP1252 = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "–": 0x96, "—": 0x97, "œ": 0x9c, "Œ": 0x8c };
const texteWinAnsi = (t) => [...String(t)].map((ch) => {
  if (ch === " " || ch === " ") return " ";
  if (CP1252[ch]) return String.fromCharCode(CP1252[ch]);
  const c = ch.charCodeAt(0);
  return c < 256 ? ch : ch === "→" ? ">" : "?";
}).join("");
const largeurTexte = (t, taille) => [...String(t)].reduce((s, ch) => {
  const base = ch.normalize("NFD")[0];
  return s + (LARGEURS_HELVETICA[ch] ?? LARGEURS_HELVETICA[base] ?? (ch === " " || ch === " " ? 278 : 556));
}, 0) * taille / 1000;
const couperTexte = (t, largeur, taille) => {
  let s = String(t ?? "");
  if (largeurTexte(s, taille) <= largeur) return s;
  while (s.length && largeurTexte(`${s}…`, taille) > largeur) s = s.slice(0, -1);
  return `${s}…`;
};

/**
 * PDF A4 paysage : titre, lignes d'information, puis un tableau qui se poursuit sur les pages suivantes.
 * colonnes : [{ titre, poids, droite }], lignes : tableaux de cellules ; une ligne { gras: true, cellules } est mise en gras.
 */
function fichierPdf(nom, { titre, infos = [], colonnes, lignes, note }) {
  const L = 842, H = 595, marge = 32, taille = 8, pas = 13;
  const utile = L - 2 * marge;
  const somme = colonnes.reduce((s, c) => s + (c.poids || 1), 0);
  const largeurs = colonnes.map((c) => utile * (c.poids || 1) / somme);
  const esc = (t) => texteWinAnsi(t).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const ecrire = (x, y, t, police = "F1", corps = taille) => `BT /${police} ${corps} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(t)}) Tj ET\n`;
  const pages = [];
  let flux = "";
  let y = 0;
  const entete = () => {
    flux += `0.9 g ${marge} ${(y - 4).toFixed(2)} ${utile} ${pas} re f 0 g\n`;
    let x = marge;
    colonnes.forEach((c, i) => {
      const t = couperTexte(c.titre, largeurs[i] - 6, taille);
      flux += ecrire(c.droite ? x + largeurs[i] - 3 - largeurTexte(t, taille) : x + 3, y, t, "F2");
      x += largeurs[i];
    });
    y -= pas;
  };
  const nouvellePage = (premiere) => {
    if (flux) pages.push(flux);
    flux = "";
    y = H - marge - 10;
    if (premiere) {
      flux += ecrire(marge, y, titre, "F2", 15);
      y -= 20;
      for (const i of infos) { flux += ecrire(marge, y, couperTexte(i, utile, 9), "F1", 9); y -= 12; }
      y -= 6;
    }
    entete();
  };
  nouvellePage(true);
  for (const brute of lignes) {
    const ligne = Array.isArray(brute) ? { cellules: brute } : brute;
    if (y < marge + 24) nouvellePage(false);
    let x = marge;
    if (ligne.gras) flux += `0.96 g ${marge} ${(y - 4).toFixed(2)} ${utile} ${pas} re f 0 g\n`;
    ligne.cellules.forEach((v, i) => {
      const brut = typeof v === "number" ? v.toLocaleString("fr-FR") : v ?? "";
      const t = couperTexte(brut, largeurs[i] - 6, taille);
      flux += ecrire(colonnes[i].droite ? x + largeurs[i] - 3 - largeurTexte(t, taille) : x + 3, y, t, ligne.gras ? "F2" : "F1");
      x += largeurs[i];
    });
    flux += `0.85 G 0.3 w ${marge} ${(y - 4.5).toFixed(2)} m ${L - marge} ${(y - 4.5).toFixed(2)} l S 0 G\n`;
    y -= pas;
  }
  if (note) {
    if (y < marge + 30) nouvellePage(false);
    y -= 8;
    flux += ecrire(marge, y, couperTexte(note, utile, 8), "F1", 8);
  }
  pages.push(flux);
  const date = new Date().toLocaleDateString("fr-FR");
  const objets = ["<< /Type /Catalog /Pages 2 0 R >>", null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"];
  const kids = [];
  pages.forEach((p, i) => {
    const pied = ecrire(marge, 16, `Smarte Solutions · ${titre} · ${date} · page ${i + 1} sur ${pages.length}`, "F1", 7);
    const contenu = p + pied;
    objets.push(`<< /Length ${contenu.length} >>\nstream\n${contenu}endstream`);
    objets.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${L} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${objets.length} 0 R >>`);
    kids.push(`${objets.length} 0 R`);
  });
  objets[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  let pdf = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const positions = [];
  objets.forEach((o, i) => { positions.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${positions.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  telechargerFichier([Uint8Array.from(pdf, (c) => c.charCodeAt(0))], `${nom}.pdf`, "application/pdf");
}

/** Lit un .csv ou un .xlsx et rend un tableau de lignes de textes. */
async function lireTableur(fichier) {
  const octets = new Uint8Array(await fichier.arrayBuffer());
  if (octets[0] === 0x50 && octets[1] === 0x4b) return lireXlsx(octets);
  let texte = new TextDecoder("utf-8").decode(octets);
  if (texte.includes("�")) texte = new TextDecoder("windows-1252").decode(octets);
  return lireCsv(texte.replace(/^﻿/, ""));
}

function lireCsv(texte) {
  const premiere = texte.split(/\r?\n/, 1)[0];
  const sep = [";", "\t", ","].map((s) => [s, premiere.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const lignes = [];
  let ligne = [], cellule = "", guillemets = false;
  for (let i = 0; i < texte.length; i += 1) {
    const c = texte[i];
    if (guillemets) {
      if (c === '"' && texte[i + 1] === '"') { cellule += '"'; i += 1; } else if (c === '"') guillemets = false; else cellule += c;
    } else if (c === '"') guillemets = true;
    else if (c === sep) { ligne.push(cellule); cellule = ""; } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texte[i + 1] === "\n") i += 1;
      ligne.push(cellule); lignes.push(ligne); ligne = []; cellule = "";
    } else cellule += c;
  }
  if (cellule || ligne.length) { ligne.push(cellule); lignes.push(ligne); }
  return lignes.filter((l) => l.some((x) => x.trim()));
}

async function lireXlsx(octets) {
  const v = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  let fin = -1;
  for (let i = octets.length - 22; i >= Math.max(0, octets.length - 65557); i -= 1) if (v.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw Object.assign(new Error(), { code: "fichier_illisible" });
  const entrees = new Map();
  let p = v.getUint32(fin + 16, true);
  for (let n = v.getUint16(fin + 10, true); n > 0; n -= 1) {
    const methode = v.getUint16(p + 10, true), taille = v.getUint32(p + 20, true);
    const ln = v.getUint16(p + 28, true), le = v.getUint16(p + 30, true), lc = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
    entrees.set(new TextDecoder().decode(octets.subarray(p + 46, p + 46 + ln)), { methode, taille, local });
    p += 46 + ln + le + lc;
  }
  const lire = async (nom) => {
    const e = entrees.get(nom);
    if (!e) return null;
    const debut = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
    const brut = octets.subarray(debut, debut + e.taille);
    const donnees = e.methode === 0 ? brut
      : new Uint8Array(await new Response(new Blob([brut]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    return new DOMParser().parseFromString(new TextDecoder().decode(donnees), "application/xml");
  };
  let chemin = "xl/worksheets/sheet1.xml";
  const classeur = await lire("xl/workbook.xml");
  const liens = await lire("xl/_rels/workbook.xml.rels");
  const premiere = classeur?.getElementsByTagName("sheet")[0];
  if (premiere && liens) {
    const id = premiere.getAttribute("r:id") || premiere.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const cible = [...liens.getElementsByTagName("Relationship")].find((r) => r.getAttribute("Id") === id)?.getAttribute("Target");
    if (cible) chemin = cible.startsWith("/") ? cible.slice(1) : `xl/${cible}`;
  }
  const feuille = await lire(chemin);
  if (!feuille) throw Object.assign(new Error(), { code: "fichier_illisible" });
  const partages = await lire("xl/sharedStrings.xml");
  const chaines = partages ? [...partages.getElementsByTagName("si")].map((si) => [...si.getElementsByTagName("t")].map((t) => t.textContent).join("")) : [];
  const indice = (ref) => [...ref.replace(/\d/g, "")].reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const lignes = [];
  for (const rang of feuille.getElementsByTagName("row")) {
    const ligne = [];
    for (const c of rang.getElementsByTagName("c")) {
      const type = c.getAttribute("t");
      const val = c.getElementsByTagName("v")[0]?.textContent ?? "";
      ligne[indice(c.getAttribute("r") || colonneExcel(ligne.length))] = type === "s" ? chaines[Number(val)] ?? ""
        : type === "inlineStr" ? [...c.getElementsByTagName("t")].map((t) => t.textContent).join("") : val;
    }
    lignes.push(Array.from(ligne, (x) => x ?? ""));
  }
  return lignes.filter((l) => l.some((x) => String(x).trim()));
}

/** Nombre saisi à la française ou non : « 1 250,50 », « 1250.5 », « 12 000 FCFA ». */
function nombreSaisi(t) {
  let s = String(t ?? "").replace(/[\s  ]|FCFA|F CFA|XAF/gi, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
