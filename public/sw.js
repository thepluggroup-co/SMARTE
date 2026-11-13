"use strict";
// Garde seulement l'application elle-même. Les données de l'API ne passent jamais par ce cache.
const CACHE = "smarte-solutions-v1";
const FICHIERS = ["/", "/style.css", "/relation.js", "/gta.js", "/fichiers.js", "/tableau.js", "/quotidien.js", "/fiches.js", "/okr.js", "/codesbarres.js", "/entrepots.js", "/rapports.js", "/gestion.js", "/caisse.js", "/academie.js", "/tresorerie.js", "/compta.js", "/pilotage.js", "/controle.js", "/finitions.js", "/tour.js", "/logistique.js", "/pedagogie.js", "/fiscal.js", "/evenements.js", "/scolarite.js", "/documents.js", "/recouvrement.js", "/commerce.js", "/mall.js", "/modules.js", "/app.js"];

self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS))));
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const nom of await caches.keys()) if (nom !== CACHE) await caches.delete(nom);
  await self.clients.claim();
})()));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const chemin = url.pathname === "/index.html" ? "/" : url.pathname;
  if (e.request.method !== "GET" || url.origin !== location.origin || !FICHIERS.includes(chemin)) return;
  // Le réseau d'abord : une mise à jour arrive dès qu'il y a une connexion.
  e.respondWith((async () => {
    try {
      const r = await fetch(e.request);
      if (r.ok) (await caches.open(CACHE)).put(chemin, r.clone());
      return r;
    } catch (erreur) {
      const copie = await caches.match(chemin);
      if (copie) return copie;
      throw erreur;
    }
  })());
});
