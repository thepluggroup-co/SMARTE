-- Entrepôts et magasins de GLOMARI : catégories d'articles, colisage, articles avariés.

-- Catégories et sous-catégories d'articles, propres à une branche. Une sous-catégorie a un parent, qui n'en a pas.
create table categories_articles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, branche_id uuid not null, parent_id uuid,
  nom text not null check (length(nom) between 1 and 100), actif boolean not null default true,
  cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id),
  foreign key (organisation_id, parent_id) references categories_articles(organisation_id, id),
  check (parent_id is null or parent_id <> id)
);
create unique index categories_articles_nom on categories_articles
  (organisation_id, branche_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(nom));

-- Article : sa catégorie, son type de colis et le nombre de pièces contenues dans une unité de stock.
alter table produits
  add column categorie_id uuid,
  add column type_colis text check (length(type_colis) <= 40),
  add column pieces_par_unite numeric(14,3) not null default 1 check (pieces_par_unite > 0),
  add foreign key (organisation_id, categorie_id) references categories_articles(organisation_id, id);
create index produits_categorie on produits (organisation_id, categorie_id);

-- Articles avariés : repérés dans leur entrepôt, mis de côté (plus vendables), puis sortis en perte ou remis en vente.
create table avaries (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, produit_id uuid not null,
  quantite numeric(14,3) not null check (quantite > 0),
  motif text not null check (length(motif) between 3 and 500),
  statut text not null default 'constatee' check (statut in ('constatee', 'sortie', 'remise')),
  auteur_id uuid not null, cree_le timestamptz not null default now(),
  decide_par uuid, decide_le timestamptz, note text check (length(note) <= 500),
  check ((statut = 'constatee') = (decide_le is null)),
  unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, decide_par) references utilisateurs(organisation_id, id)
);
create index avaries_lieu on avaries (organisation_id, entite_id, produit_id) where statut = 'constatee';

do $$
declare t text;
begin
  foreach t in array array['categories_articles', 'avaries'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
    execute format('create trigger audit after insert or update or delete on %I for each row execute function audit_ligne()', t);
  end loop;
end $$;
grant select, insert, update on categories_articles, avaries to erp_app;
