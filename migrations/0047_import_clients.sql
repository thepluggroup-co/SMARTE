-- Import des clients (lot 0 de la fiche technique globale GLOMARI) : ville et source d'une fiche client, facultatives.
alter table tiers
  add column ville text check (length(ville) <= 100),
  add column source text check (length(source) <= 100);
