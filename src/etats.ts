/**
 * États du SYSCOHADA révisé, système normal. Les références suivent le modèle officiel.
 * La correspondance entre rubriques et comptes reste à faire valider par l'expert comptable.
 */
export interface LigneBalance { numero: string; debit: number; credit: number }

const ACTIF_IMMO: [string, string][] = [
  ["211", "AE"], ["2181", "AE"], ["212", "AF"], ["213", "AF"], ["214", "AF"], ["215", "AG"], ["216", "AG"], ["21", "AH"],
  ["22", "AJ"], ["231", "AK"], ["232", "AK"], ["233", "AK"], ["237", "AK"], ["234", "AL"], ["235", "AL"], ["238", "AL"], ["23", "AK"],
  ["245", "AN"], ["24", "AM"], ["25", "AP"], ["26", "AR"], ["27", "AS"],
];
const PASSIF_FIXE: [string, string][] = [
  ["109", "CB"], ["105", "CD"], ["106", "CE"], ["10", "CA"], ["118", "CG"], ["11", "CF"], ["12", "CH"], ["13", "CH"], ["14", "CL"], ["15", "CM"],
  ["17", "DB"], ["16", "DA"], ["18", "DA"], ["19", "DC"],
];
const CHARGES: [string, string][] = [
  ["6031", "RB"], ["6032", "RD"], ["6033", "RF"], ["601", "RA"], ["602", "RC"], ["60", "RE"], ["61", "RG"], ["62", "RH"], ["63", "RH"], ["64", "RI"],
  ["659", "RL"], ["65", "RJ"], ["66", "RK"], ["697", "RN"], ["67", "RM"], ["68", "RL"], ["69", "RL"],
  ["81", "RO"], ["83", "RP"], ["85", "RP"], ["87", "RQ"], ["89", "RS"],
];
const PRODUITS: [string, string][] = [
  ["701", "TA"], ["702", "TB"], ["703", "TB"], ["704", "TB"], ["705", "TC"], ["706", "TC"], ["707", "TD"], ["70", "TC"],
  ["73", "TE"], ["72", "TF"], ["71", "TG"], ["759", "TJ"], ["75", "TH"], ["787", "TM"], ["78", "TI"], ["797", "TL"], ["79", "TJ"], ["77", "TK"],
  ["82", "TN"], ["84", "TO"], ["86", "TO"], ["88", "TO"],
];
const trouver = (table: [string, string][], n: string) => table.find(([p]) => n.startsWith(p))?.[1];

export const LIBELLES: Record<string, string> = {
  AD: "Immobilisations incorporelles", AE: "Frais de développement et de prospection", AF: "Brevets, licences, logiciels et droits similaires", AG: "Fonds commercial et droit au bail", AH: "Autres immobilisations incorporelles",
  AI: "Immobilisations corporelles", AJ: "Terrains", AK: "Bâtiments", AL: "Aménagements, agencements et installations", AM: "Matériel, mobilier et actifs biologiques", AN: "Matériel de transport", AP: "Avances et acomptes versés sur immobilisations",
  AQ: "Immobilisations financières", AR: "Titres de participation", AS: "Autres immobilisations financières", AZ: "TOTAL ACTIF IMMOBILISÉ",
  BA: "Actif circulant HAO", BB: "Stocks et encours", BG: "Créances et emplois assimilés", BH: "Fournisseurs, avances versées", BI: "Clients", BJ: "Autres créances", BK: "TOTAL ACTIF CIRCULANT",
  BQ: "Titres de placement", BR: "Valeurs à encaisser", BS: "Banques, chèques postaux, caisse et assimilés", BT: "TOTAL TRÉSORERIE-ACTIF", BU: "Écart de conversion-actif", BZ: "TOTAL GÉNÉRAL",
  CA: "Capital", CB: "Apporteurs, capital non appelé (-)", CD: "Primes liées au capital social", CE: "Écarts de réévaluation", CF: "Réserves indisponibles", CG: "Réserves libres", CH: "Report à nouveau (+ ou -)", CJ: "Résultat net de l'exercice (+ ou -)", CL: "Subventions d'investissement", CM: "Provisions réglementées", CP: "TOTAL CAPITAUX PROPRES ET RESSOURCES ASSIMILÉES",
  DA: "Emprunts et dettes financières diverses", DB: "Dettes de location-acquisition", DC: "Provisions pour risques et charges", DD: "TOTAL DETTES FINANCIÈRES ET RESSOURCES ASSIMILÉES", DF: "TOTAL RESSOURCES STABLES",
  DH: "Dettes circulantes HAO", DI: "Clients, avances reçues", DJ: "Fournisseurs d'exploitation", DK: "Dettes fiscales et sociales", DM: "Autres dettes", DN: "Provisions pour risques à court terme", DP: "TOTAL PASSIF CIRCULANT",
  DQ: "Banques, crédits d'escompte", DR: "Banques, établissements financiers et crédits de trésorerie", DT: "TOTAL TRÉSORERIE-PASSIF", DV: "Écart de conversion-passif", DZ: "TOTAL GÉNÉRAL",
  TA: "Ventes de marchandises", RA: "Achats de marchandises", RB: "Variation de stocks de marchandises", XA: "MARGE COMMERCIALE", TB: "Ventes de produits fabriqués", TC: "Travaux, services vendus", TD: "Produits accessoires", XB: "CHIFFRE D'AFFAIRES",
  TE: "Production stockée (ou déstockage)", TF: "Production immobilisée", TG: "Subventions d'exploitation", TH: "Autres produits", TI: "Transferts de charges d'exploitation", RC: "Achats de matières premières et fournitures liées", RD: "Variation de stocks de matières premières", RE: "Autres achats", RF: "Variation de stocks d'autres approvisionnements", RG: "Transports", RH: "Services extérieurs", RI: "Impôts et taxes", RJ: "Autres charges", XC: "VALEUR AJOUTÉE",
  RK: "Charges de personnel", XD: "EXCÉDENT BRUT D'EXPLOITATION", TJ: "Reprises d'amortissements, provisions et dépréciations", RL: "Dotations aux amortissements, provisions et dépréciations", XE: "RÉSULTAT D'EXPLOITATION",
  TK: "Revenus financiers et assimilés", TL: "Reprises de provisions et dépréciations financières", TM: "Transferts de charges financières", RM: "Frais financiers et charges assimilées", RN: "Dotations aux provisions et dépréciations financières", XF: "RÉSULTAT FINANCIER", XG: "RÉSULTAT DES ACTIVITÉS ORDINAIRES",
  TN: "Produits des cessions d'immobilisations", TO: "Autres produits HAO", RO: "Valeurs comptables des cessions d'immobilisations", RP: "Autres charges HAO", XH: "RÉSULTAT HORS ACTIVITÉS ORDINAIRES", RQ: "Participation des travailleurs", RS: "Impôts sur le résultat", XI: "RÉSULTAT NET",
  ZA: "Trésorerie nette au 1er janvier", FA: "Capacité d'autofinancement globale (CAFG)", FB: "Variation du BFR HAO", FC: "Variation des stocks", FD: "Variation des créances", FE: "Variation du passif circulant", ZB: "Flux des activités opérationnelles",
  FF: "Acquisitions d'immobilisations incorporelles", FG: "Acquisitions d'immobilisations corporelles", FH: "Acquisitions d'immobilisations financières", FI: "Cessions d'immobilisations incorporelles et corporelles", FJ: "Cessions d'immobilisations financières", ZC: "Flux des activités d'investissement",
  FK: "Augmentation de capital par apports nouveaux", FL: "Subventions d'investissement reçues", FM: "Prélèvement sur le capital", FN: "Dividendes versés", ZD: "Flux provenant des capitaux propres", FO: "Emprunts", FP: "Autres dettes financières", FQ: "Remboursements des emprunts et autres dettes", ZE: "Flux provenant des capitaux étrangers", ZF: "Flux des activités de financement", ZG: "Variation de la trésorerie nette", ZH: "Trésorerie nette au 31 décembre",
};

const somme = (m: Record<string, number>, refs: string[]) => refs.reduce((s, r) => s + (m[r] ?? 0), 0);

/** Produits en positif, charges en négatif, comme le modèle. */
export function compteDeResultat(balance: LigneBalance[]) {
  const m: Record<string, number> = {};
  const nonClasses: string[] = [];
  for (const b of balance) {
    if (!["6", "7", "8"].includes(b.numero[0]!)) continue;
    const ref = trouver(CHARGES, b.numero) ?? trouver(PRODUITS, b.numero);
    if (!ref) { nonClasses.push(b.numero); continue; }
    m[ref] = (m[ref] ?? 0) + b.credit - b.debit;
  }
  m.XA = somme(m, ["TA", "RA", "RB"]);
  m.XB = somme(m, ["TA", "TB", "TC", "TD"]);
  m.XC = m.XB + somme(m, ["RA", "RB", "TE", "TF", "TG", "TH", "TI", "RC", "RD", "RE", "RF", "RG", "RH", "RI", "RJ"]);
  m.XD = m.XC + somme(m, ["RK"]);
  m.XE = m.XD + somme(m, ["TJ", "RL"]);
  m.XF = somme(m, ["TK", "TL", "TM", "RM", "RN"]);
  m.XG = m.XE + m.XF;
  m.XH = somme(m, ["TN", "TO", "RO", "RP"]);
  m.XI = m.XG + m.XH + somme(m, ["RQ", "RS"]);
  return { lignes: m, nonClasses };
}

/** Rubrique d'actif circulant ou de dette, selon le sens du solde du compte. */
function rubriqueTiers(n: string, solde: number): { ref: string; cote: "actif" | "passif" } | null {
  const c = n.slice(0, 2);
  if (solde > 0) {
    if (n.startsWith("3")) return { ref: "BB", cote: "actif" };
    if (n.startsWith("485") || n.startsWith("488") || c === "48") return { ref: "BA", cote: "actif" };
    if (n.startsWith("409")) return { ref: "BH", cote: "actif" };
    if (c === "41") return { ref: "BI", cote: "actif" };
    if (n.startsWith("478")) return { ref: "BU", cote: "actif" };
    if (n[0] === "4") return { ref: "BJ", cote: "actif" };
    if (c === "50") return { ref: "BQ", cote: "actif" };
    if (c === "51") return { ref: "BR", cote: "actif" };
    if (n[0] === "5") return { ref: "BS", cote: "actif" };
    return null;
  }
  if (c === "48") return { ref: "DH", cote: "passif" };
  if (n.startsWith("419") || c === "41") return { ref: "DI", cote: "passif" };
  if (c === "40") return { ref: "DJ", cote: "passif" };
  if (["42", "43", "44"].includes(c)) return { ref: "DK", cote: "passif" };
  if (n.startsWith("479")) return { ref: "DV", cote: "passif" };
  if (c === "49") return { ref: "DN", cote: "passif" };
  if (n[0] === "4") return { ref: "DM", cote: "passif" };
  if (n.startsWith("564") || n.startsWith("565")) return { ref: "DQ", cote: "passif" };
  if (n[0] === "5") return { ref: "DR", cote: "passif" };
  if (n[0] === "3") return { ref: "BB", cote: "actif" };
  return null;
}

/** Brut, amortissements et net à l'actif ; le résultat vient du compte de résultat. */
export function bilan(balance: LigneBalance[]) {
  const brut: Record<string, number> = {};
  const amort: Record<string, number> = {};
  const passif: Record<string, number> = {};
  const nonClasses: string[] = [];
  for (const b of balance) {
    const n = b.numero;
    const solde = b.debit - b.credit;
    if (["6", "7", "8"].includes(n[0]!) || !solde) continue;
    if (n[0] === "1") {
      const ref = trouver(PASSIF_FIXE, n);
      if (ref) passif[ref] = (passif[ref] ?? 0) - solde; else nonClasses.push(n);
    } else if (n.startsWith("28") || n.startsWith("29")) {
      const ref = trouver(ACTIF_IMMO, `2${n.slice(2)}`);
      if (ref && n.length > 2) amort[ref] = (amort[ref] ?? 0) - solde; else nonClasses.push(n);
    } else if (n[0] === "2") {
      const ref = trouver(ACTIF_IMMO, n);
      if (ref) brut[ref] = (brut[ref] ?? 0) + solde; else nonClasses.push(n);
    } else if (n.startsWith("39")) amort.BB = (amort.BB ?? 0) - solde;
    else if (n.startsWith("490")) amort.BH = (amort.BH ?? 0) - solde;
    else if (n.startsWith("491")) amort.BI = (amort.BI ?? 0) - solde;
    else if (n.startsWith("49") && solde < 0 && (n.startsWith("499") || n.startsWith("4998"))) passif.DN = (passif.DN ?? 0) - solde;
    else if (n.startsWith("49")) amort.BJ = (amort.BJ ?? 0) - solde;
    else if (n.startsWith("590")) amort.BQ = (amort.BQ ?? 0) - solde;
    else if (n.startsWith("591")) amort.BR = (amort.BR ?? 0) - solde;
    else if (n.startsWith("599")) passif.DN = (passif.DN ?? 0) - solde;
    else if (n.startsWith("59")) amort.BS = (amort.BS ?? 0) - solde;
    else {
      const r = rubriqueTiers(n, solde);
      if (!r) nonClasses.push(n);
      else if (r.cote === "actif") brut[r.ref] = (brut[r.ref] ?? 0) + solde;
      else passif[r.ref] = (passif[r.ref] ?? 0) - solde;
    }
  }
  const net = (r: string) => (brut[r] ?? 0) - (amort[r] ?? 0);
  const groupe = (refs: string[], ref: string) => {
    brut[ref] = refs.reduce((s, r) => s + (brut[r] ?? 0), 0);
    amort[ref] = refs.reduce((s, r) => s + (amort[r] ?? 0), 0);
  };
  groupe(["AE", "AF", "AG", "AH"], "AD");
  groupe(["AJ", "AK", "AL", "AM", "AN", "AP"], "AI");
  groupe(["AR", "AS"], "AQ");
  groupe(["AD", "AI", "AQ"], "AZ");
  groupe(["BH", "BI", "BJ"], "BG");
  groupe(["BA", "BB", "BG"], "BK");
  groupe(["BQ", "BR", "BS"], "BT");
  groupe(["AZ", "BK", "BT", "BU"], "BZ");
  const resultat = compteDeResultat(balance).lignes.XI ?? 0;
  passif.CJ = resultat;
  passif.CP = somme(passif, ["CA", "CB", "CD", "CE", "CF", "CG", "CH", "CJ", "CL", "CM"]);
  passif.DD = somme(passif, ["DA", "DB", "DC"]);
  passif.DF = passif.CP + passif.DD;
  passif.DP = somme(passif, ["DH", "DI", "DJ", "DK", "DM", "DN"]);
  passif.DT = somme(passif, ["DQ", "DR"]);
  passif.DZ = passif.DF + passif.DP + passif.DT + (passif.DV ?? 0);
  const refsActif = ["AD", "AE", "AF", "AG", "AH", "AI", "AJ", "AK", "AL", "AM", "AN", "AP", "AQ", "AR", "AS", "AZ", "BA", "BB", "BG", "BH", "BI", "BJ", "BK", "BQ", "BR", "BS", "BT", "BU", "BZ"];
  return {
    actif: refsActif.map((ref) => ({ ref, brut: brut[ref] ?? 0, amort: amort[ref] ?? 0, net: net(ref) })),
    passif: ["CA", "CB", "CD", "CE", "CF", "CG", "CH", "CJ", "CL", "CM", "CP", "DA", "DB", "DC", "DD", "DF", "DH", "DI", "DJ", "DK", "DM", "DN", "DP", "DQ", "DR", "DT", "DV", "DZ"].map((ref) => ({ ref, net: passif[ref] ?? 0 })),
    totalActif: net("BZ"), totalPassif: passif.DZ, equilibre: net("BZ") === passif.DZ, nonClasses,
    tresorerie: net("BT") - passif.DT,
  };
}

/**
 * Tableau des flux par différence : chaque compte de bilan et de gestion entre une seule fois,
 * donc la variation calculée doit égaler celle de la trésorerie. mouvements exclut les à-nouveaux.
 */
export function fluxDeTresorerie(mouvements: LigneBalance[], tresorerieOuverture: number, tresorerieCloture: number) {
  const f: Record<string, number> = {};
  const add = (r: string, v: number) => { f[r] = (f[r] ?? 0) + v; };
  let resultat = 0;
  for (const b of mouvements) {
    const n = b.numero;
    const s = b.debit - b.credit;
    if (["6", "7", "8"].includes(n[0]!)) {
      resultat -= s;
      // Les dotations et les valeurs de cession se neutralisent par les comptes 28, 29 et 2 ci-dessous.
      if (n.startsWith("82")) { add("FA", s); add("FI", -s); }
    } else if (n.startsWith("28") || n.startsWith("29")) add("FA", -s);
    else if (n.startsWith("21")) { add("FF", -b.debit); add("FA", b.credit); }
    else if (n.startsWith("26") || n.startsWith("27")) { add("FH", -b.debit); add("FJ", b.credit); }
    else if (n[0] === "2") { add("FG", -b.debit); add("FA", b.credit); }
    else if (n.startsWith("39") || n.startsWith("49") || n.startsWith("59") || n.startsWith("15") || n.startsWith("19")) add("FA", -s);
    else if (n[0] === "3") add("FC", -s);
    else if (n.startsWith("48")) add("FB", -s);
    else if (n[0] === "4") {
      if (n.startsWith("40") && !n.startsWith("409") || n.startsWith("419") || ["42", "43", "44", "45", "46", "47"].includes(n.slice(0, 2)) && s < 0) add("FE", -s);
      else add("FD", -s);
    } else if (n.startsWith("10")) { add("FK", b.credit); add("FM", -b.debit); }
    else if (n.startsWith("14")) add("FL", -s);
    else if (n.startsWith("11") || n.startsWith("12") || n.startsWith("13")) add("FN", -s);
    else if (n.startsWith("16") || n.startsWith("18")) { add("FO", b.credit); add("FQ", -b.debit); }
    else if (n.startsWith("17")) { add("FP", b.credit); add("FQ", -b.debit); }
  }
  add("FA", resultat);
  f.ZA = tresorerieOuverture;
  f.ZB = somme(f, ["FA", "FB", "FC", "FD", "FE"]);
  f.ZC = somme(f, ["FF", "FG", "FH", "FI", "FJ"]);
  f.ZD = somme(f, ["FK", "FL", "FM", "FN"]);
  f.ZE = somme(f, ["FO", "FP", "FQ"]);
  f.ZF = f.ZD + f.ZE;
  f.ZG = f.ZB + f.ZC + f.ZF;
  f.ZH = f.ZA + f.ZG;
  const ordre = ["ZA", "FA", "FB", "FC", "FD", "FE", "ZB", "FF", "FG", "FH", "FI", "FJ", "ZC", "FK", "FL", "FM", "FN", "ZD", "FO", "FP", "FQ", "ZE", "ZF", "ZG", "ZH"];
  return { lignes: ordre.map((ref) => ({ ref, montant: f[ref] ?? 0 })), ecart: f.ZH - tresorerieCloture, tresorerieCloture };
}

/** Amortissement linéaire au mois, à partir du mois de mise en service. Le dernier mois solde les arrondis. */
export function dotationAnnee(i: { cout: number; valeur_residuelle: number; duree_mois: number; date_service: string; cession_le?: string | null }, annee: number): number {
  const base = i.cout - i.valeur_residuelle;
  const [a, m] = i.date_service.split("-").map(Number) as [number, number];
  const rang = (y: number, mois: number) => (y - a) * 12 + (mois - m);
  const fin = i.cession_le ? rang(Number(i.cession_le.slice(0, 4)), Number(i.cession_le.slice(5, 7))) : Infinity;
  const cumul = (r: number) => {
    const mois = Math.min(Math.max(r, 0), i.duree_mois, fin === Infinity ? Infinity : fin);
    return Math.round((base * mois) / i.duree_mois);
  };
  return cumul(rang(annee + 1, 1)) - cumul(rang(annee, 1));
}

export const CATEGORIES_IMMO: Record<string, { libelle: string; compte: string; amort: string; dotation: string; tauxCgi: number | null }> = {
  logiciel: { libelle: "Logiciels et sites internet", compte: "213", amort: "2813", dotation: "6812", tauxCgi: null },
  batiment: { libelle: "Bâtiments", compte: "231", amort: "2831", dotation: "6813", tauxCgi: 5 },
  informatique: { libelle: "Matériel informatique", compte: "2442", amort: "2844", dotation: "6813", tauxCgi: 25 },
  bureau: { libelle: "Matériel de bureau", compte: "2441", amort: "2844", dotation: "6813", tauxCgi: null },
  mobilier: { libelle: "Mobilier de bureau", compte: "2444", amort: "2844", dotation: "6813", tauxCgi: 10 },
  vehicule: { libelle: "Véhicule léger, usage urbain", compte: "2451", amort: "2845", dotation: "6813", tauxCgi: 25 },
  vehicule_lourd: { libelle: "Véhicule lourd ou tout-terrain", compte: "2451", amort: "2845", dotation: "6813", tauxCgi: 33.33 },
  materiel: { libelle: "Matériel et outillage", compte: "241", amort: "2841", dotation: "6813", tauxCgi: null },
};

export interface DonneesFiscales { reintegrations: { libelle: string; montant: number }[]; deductions: { libelle: string; montant: number }[]; deficit_anterieur: number; taux_is: number | null; taux_cac: number | null; minimum_du: number; acomptes: number }

/** Passage du résultat comptable au résultat fiscal. Tous les taux viennent de la saisie. */
export function calculFiscal(resultatNet: number, impotComptabilise: number, d: DonneesFiscales) {
  const avantImpot = resultatNet + impotComptabilise;
  const reint = d.reintegrations.reduce((s, x) => s + x.montant, 0);
  const deduc = d.deductions.reduce((s, x) => s + x.montant, 0);
  const resultatFiscal = avantImpot + reint - deduc;
  const imposable = Math.max(resultatFiscal - d.deficit_anterieur, 0);
  const principal = Math.round((imposable * (d.taux_is ?? 0)) / 100);
  const cac = Math.round((principal * (d.taux_cac ?? 0)) / 100);
  const impotCalcule = principal + cac;
  const du = Math.max(impotCalcule, d.minimum_du);
  return { avantImpot, reintegrations: reint, deductions: deduc, resultatFiscal, imposable, principal, cac, impotCalcule, du, solde: du - d.acomptes, tauxManquants: d.taux_is === null || d.taux_cac === null };
}
