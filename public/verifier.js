(async () => {
  const zone = document.getElementById("resultat");
  const code = new URLSearchParams(location.search).get("c") || "";
  const ligne = (texte, classe, balise = "p") => {
    const p = document.createElement(balise);
    p.textContent = texte;
    if (classe) p.className = classe;
    return p;
  };
  try {
    const r = await fetch(`/verification/${encodeURIComponent(code)}`);
    if (!r.ok) {
      zone.replaceChildren(ligne("Certificat introuvable", "etat rouge", "h1"));
    } else {
      const d = await r.json();
      zone.replaceChildren(
        ligne(d.valide ? "Certificat valide" : "Certificat révoqué", d.valide ? "etat vert" : "etat rouge", "h1"),
        ligne(d.titulaire, "grand"),
        ligne(d.programme),
        ligne(`N° ${d.numero}, délivré le ${d.delivre_le.split("-").reverse().join("/")}`),
      );
    }
  } catch {
    const reessayer = ligne("Réessayer", "discret", "button");
    reessayer.type = "button";
    reessayer.addEventListener("click", () => location.reload());
    zone.replaceChildren(ligne("Vérification impossible.", "erreur", "h1"), reessayer);
  }
})();
