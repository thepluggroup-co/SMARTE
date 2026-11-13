import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Les scripts partagent un même espace : deux déclarations du même nom empêchent tout un fichier de se charger. */
describe("scripts de l'application", () => {
  it("ne déclarent jamais deux fois le même nom", () => {
    const page = readFileSync("public/index.html", "utf8");
    const fichiers = [...page.matchAll(/<script src="\/([a-z_]+\.js)"/g)].map((m) => m[1]!);
    expect(fichiers.length).toBeGreaterThan(5);
    const vus = new Map<string, string>();
    const doublons: string[] = [];
    for (const f of fichiers) {
      for (const m of readFileSync(`public/${f}`, "utf8").matchAll(/^(?:const|let|class)\s+([A-Za-z_$][\w$]*)|^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) {
        const nom = (m[1] ?? m[2])!;
        if (vus.has(nom)) doublons.push(`${nom} : ${vus.get(nom)} et ${f}`);
        vus.set(nom, f);
      }
    }
    expect(doublons).toEqual([]);
  });
  it("appellent des écrans qui existent", () => {
    const page = readFileSync("public/index.html", "utf8");
    const fichiers = [...page.matchAll(/<script src="\/([a-z_]+\.js)"/g)].map((m) => m[1]!);
    const tout = fichiers.map((f) => readFileSync(`public/${f}`, "utf8")).join("\n");
    const absents = [...new Set([...tout.matchAll(/\b(ecran[A-Z]\w*)\(/g)].map((m) => m[1]!))].filter((n) => !new RegExp(`function ${n}\\b|const ${n}\\b`).test(tout));
    expect(absents).toEqual([]);
  });
});
