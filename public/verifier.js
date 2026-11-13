(async () => {
  const zone = document.getElementById("resultat");
  const code = new URLSearchParams(location.search).get("c") || "";
  const ligne = (texte, classe) => {
    const p = document.createElement("p");
    p.textContent = texte;
    if (classe) p.className = classe;
    return p;
  };
  zone.textContent = "";
  try {
    const r = await fetch(`/verification/${encodeURIComponent(code)}`);
    const d = await r.json();
    if (!r.ok) {
      zone.append(ligne("Certificat introuvable", "etat rouge"));
    } else {
      zone.append(
        ligne(d.valide ? "Certificat valide" : "Certificat révoqué", d.valide ? "etat vert" : "etat rouge"),
        ligne(d.titulaire, "grand"),
        ligne(d.programme),
        ligne(`N° ${d.numero}, délivré le ${d.delivre_le.split("-").reverse().join("/")}`),
      );
    }
  } catch {
    zone.append(ligne("Vérification impossible. Réessayez.", "etat rouge"));
  }
})();
