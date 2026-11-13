-- Catalogue complet : marques, photos d'articles, unités de vente, lignes vendues ou achetées dans une autre unité.

-- Marques, propres à une branche qui gère du stock (comme les catégories de 0042).
create table marques (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, branche_id uuid not null,
  nom text not null check (length(nom) between 1 and 100), actif boolean not null default true,
  cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id)
);
create unique index marques_nom on marques (organisation_id, branche_id, lower(nom));

-- Article : sa marque, et le prix d'une pièce quand l'unité de stock en contient plusieurs (sinon calculé).
-- Le prix d'un conditionnement (carton, palette…) se range dans « conditionnements », à côté de son facteur.
alter table produits
  add column marque_id uuid,
  add column prix_piece bigint check (prix_piece >= 0),
  add foreign key (organisation_id, marque_id) references marques(organisation_id, id);
create index produits_marque on produits (organisation_id, marque_id);

-- Jusqu'à 4 photos par article, conservées en base comme les logos (0038) : elles suivent les sauvegardes
-- et la séparation entre organisations. 512 Ko au plus chacune.
create table photos_produits (
  organisation_id uuid not null, produit_id uuid not null, position int not null check (position between 1 and 4),
  type_mime text not null check (type_mime in ('image/png', 'image/jpeg', 'image/webp')),
  donnees bytea not null check (octet_length(donnees) between 1 and 524288),
  auteur_id uuid not null, maj_le timestamptz not null default now(),
  primary key (organisation_id, produit_id, position),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['marques', 'photos_produits'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
  end loop;
end $$;
create trigger audit after insert or update on marques for each row execute function audit_ligne();
-- Pas de déclencheur d'audit sur les photos : il recopierait l'image. Le serveur note chaque changement au journal.
grant select, insert, update on marques to erp_app;
grant select, insert, update, delete on photos_produits to erp_app;

-- Vente ou achat dans une autre unité que celle du stock : on garde l'unité choisie, sa quantité et son prix.
-- « quantite » et « prix_unitaire » restent dans l'unité de base : le stock et les marges ne changent pas de logique.
alter table lignes_comptoir
  add column unite text check (length(unite) <= 50),
  add column quantite_unite numeric(14,3) check (quantite_unite > 0),
  add column prix_unite bigint check (prix_unite >= 0);
alter table lignes_achat
  add column unite text check (length(unite) <= 50),
  add column quantite_unite numeric(14,3) check (quantite_unite > 0),
  add column prix_unite bigint check (prix_unite >= 0);
