import { afterAll, describe, expect, it } from "vitest";
import { calendrierPropose } from "../src/fiscalite.js";
import { environnement } from "./outils.js";
const env = await environnement();
afterAll(() => env.fermer());
type Org = Awaited<ReturnType<typeof env.nouvelleOrganisation>>;
const G = (o: Org) => o.entites.GLOMARI!;
const T = (o: Org) => o.entites.GTA!;
const j = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const prep = async () => { const o = await env.nouvelleOrganisation(); await env.api("POST", "/compta/initialisation", o.jeton, { brancheId: G(o) }); return o; };
describe("fiscalité", () => {
  it("propose le calendrier sans doublon et alerte", async () => {
    expect(calendrierPropose(2026)[11]).toMatchObject({ jour: "2027-01-15" });
    const o = await prep();
    const P = () => env.api("POST", "/compta/calendrier-fiscal/proposition", o.jeton, { brancheId: G(o), annee: 2026 });
    expect((await P()).corps.crees).toBe(15);
    expect((await P()).corps.crees).toBe(0);
    await env.api("POST", "/compta/calendrier-fiscal", o.jeton, { brancheId: G(o), libelle: "Patente", jour: j(1) });
    expect((await env.api("GET", "/notifications", o.jeton)).corps.find((n: { genre: string }) => n.genre === "fiscal").nombre).toBeGreaterThanOrEqual(1);
  });
  it("corrige avec justification sans toucher la comptabilité, fige, puis verrouille après dépôt", async () => {
    const o = await prep();
    const C = (m: number, t = "Justification de la case") => env.api("PUT", "/compta/dsf/corrections", o.jeton, { brancheId: G(o), annee: 2025, etat: "Resultat", reference: "XB", montant: m, justification: t });
    expect((await C(1, "court")).statut).toBe(400);
    expect((await C(777)).corps.enregistre).toBe(true);
    const x = await env.app.inject({ method: "GET", url: `/compta/dsf/export?brancheId=${G(o)}&annee=2025`, headers: { authorization: `Bearer ${o.jeton}` } });
    expect(x.body).toContain("777");
    const V = (s: string) => env.api("POST", "/compta/dsf/versions", o.jeton, { brancheId: G(o), annee: 2025, statut: s });
    expect((await V("validee")).corps.numero).toBe(1);
    expect((await V("deposee")).corps.numero).toBe(2);
    expect((await C(888)).corps.erreur).toBe("dsf_deposee");
    expect((await V("validee")).corps.erreur).toBe("dsf_deposee");
    expect((await env.api("GET", `/compta/dsf/suivi?brancheId=${G(o)}&annee=2025`, o.jeton)).corps.versions).toHaveLength(2);
  });
  it("modèle équilibré seulement, et refacturation dans les deux branches, retirée du cumul", async () => {
    const o = await prep();
    await env.api("POST", "/compta/initialisation", o.jeton, { brancheId: T(o) });
    expect((await env.api("POST", "/compta/modeles", o.jeton, { brancheId: G(o), nom: "Loyer", journal: "OD", lignes: [{ numero: "622", debit: 10 }, { numero: "5711", credit: 9 }] })).corps.erreur).toBe("ecriture_desequilibree");
    expect((await env.api("POST", "/compta/modeles", o.jeton, { brancheId: G(o), nom: "Loyer", journal: "OD", lignes: [{ numero: "622", debit: 10 }, { numero: "5711", credit: 10 }] })).statut).toBe(201);
    await env.api("POST", "/compta/refacturations", o.jeton, { deBranche: G(o), versBranche: T(o), jour: j(0), libelle: "Plateforme", montant: 1000 });
    for (const b of [G(o), T(o)]) {
      await env.api("POST", "/compta/generation", o.jeton, { brancheId: b, fin: j(0) });
      await env.api("POST", "/compta/generation", o.jeton, { brancheId: b, fin: j(0) });
      const e = (await env.api("GET", `/compta/ecritures?brancheId=${b}&statut=brouillon`, o.jeton)).corps.filter((x: { libelle: string }) => x.libelle.startsWith("Refacturation"));
      expect(e).toHaveLength(1);
    }
    expect((await env.api("GET", `/compta/cumul-groupe?annee=${new Date().getFullYear()}`, o.jeton)).corps.refacturations).toBe(1000);
  });
  it("paie un lot entier ou rien", async () => {
    const o = await prep();
    const t = (await env.api("POST", "/tiers", o.jeton, { type: "entreprise", nom: "F", entiteId: G(o) })).corps;
    const f = async (n: string) => { const x = (await env.api("POST", "/fournisseurs/factures", o.jeton, { entiteId: G(o), fournisseurId: t.id, numeroFournisseur: n, date: j(-1), echeance: j(-1), niu: "M1", lignes: [{ designation: "Achat", compte: "622", montantHt: 500 }] })).corps; const v = await env.api("POST", `/fournisseurs/factures/${x.id}/validation`, o.jeton, { motifEcart: "Sans commande" }); expect(v.statut).toBeLessThan(300); return x.id as string; };
    const a = await f("A1"), b = await f("A2");
    expect((await env.api("GET", `/fournisseurs/balance-agee?brancheId=${G(o)}`, o.jeton)).corps[0]).toMatchObject({ total: 1000, j30: 1000 });
    const w = (await env.api("POST", "/portefeuilles", o.jeton, { entiteId: G(o), nom: "B", type: "banque", soldeInitial: 700 })).corps;
    const L = () => env.api("POST", "/fournisseurs/lots-paiement", o.jeton, { portefeuilleId: w.id, date: j(0), factures: [a, b] });
    expect((await L()).corps.erreur).toBe("solde_portefeuille_insuffisant");
    expect((await env.api("GET", `/fournisseurs/balance-agee?brancheId=${G(o)}`, o.jeton)).corps[0].total).toBe(1000);
    await env.api("POST", `/portefeuilles/${w.id}/mouvements`, o.jeton, { sens: "entree", montant: 500, libelle: "Appro" });
    expect((await L()).corps).toEqual({ payees: 2, total: 1000 });
  });
});
