-- Mall
create table locaux (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, code text not null, nom text not null,
  type text not null check (type in ('boutique', 'espace', 'bureau', 'parking', 'autre')), surface numeric(10,2), actif boolean not null default true,
  unique (organisation_id, id), unique (organisation_id, entite_id, code),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create table baux (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, local_id uuid not null, tiers_id uuid not null, debut date not null, fin date not null,
  loyer bigint not null check (loyer > 0), charges bigint not null default 0 check (charges >= 0), taux_taxe numeric(6,3) not null default 0 check (taux_taxe between 0 and 100), depot bigint not null default 0 check (depot >= 0),
  resilie_le date, cree_par uuid not null, check (fin > debut),
  unique (organisation_id, id),
  foreign key (organisation_id, local_id) references locaux(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, cree_par) references utilisateurs(organisation_id, id)
);
-- Un loyer ne se facture qu'une fois par mois : la ligne réservée empêche le doublon.
create table appels_loyer (
  organisation_id uuid not null, bail_id uuid not null, periode text not null check (periode ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), document_id uuid,
  primary key (organisation_id, bail_id, periode),
  foreign key (organisation_id, bail_id) references baux(organisation_id, id),
  foreign key (organisation_id, document_id) references documents_vente(organisation_id, id)
);
-- Supermarché : lots et rayons
alter table produits add column rayon text;
create table lots_produit (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, produit_id uuid not null, numero text not null,
  peremption date not null, quantite_initiale numeric(14,3) not null check (quantite_initiale > 0), quantite numeric(14,3) not null check (quantite >= 0), cree_le timestamptz not null default now(),
  unique (organisation_id, id), unique (organisation_id, entite_id, produit_id, numero),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id)
);
create index lots_peremption on lots_produit (organisation_id, entite_id, produit_id, peremption);
-- Toute sortie de stock consomme d'abord le lot qui périme le plus tôt ; toute entrée de retour reste hors lot.
create function lots_sortie() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare reste numeric := -new.quantite; l record; pris numeric;
begin
  if new.quantite >= 0 then return null; end if;
  for l in select id, quantite from lots_produit where entite_id = new.entite_id and produit_id = new.produit_id and quantite > 0 order by peremption, cree_le for update loop
    exit when reste <= 0;
    pris := least(reste, l.quantite);
    update lots_produit set quantite = quantite - pris where id = l.id;
    reste := reste - pris;
  end loop;
  return null;
end $$;
create trigger lots after insert on mouvements_stock for each row execute function lots_sortie();
-- Points relais
create table points_relais (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, nom text not null, adresse text, telephone text, commission bigint not null default 0 check (commission >= 0), actif boolean not null default true,
  unique (organisation_id, id), unique (organisation_id, entite_id, nom),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
alter table colis add column point_relais_id uuid, add foreign key (organisation_id, point_relais_id) references points_relais(organisation_id, id);
create table commissions_relais (
  organisation_id uuid not null, colis_id uuid not null, point_relais_id uuid not null, montant bigint not null, payee_le timestamptz,
  primary key (organisation_id, colis_id),
  foreign key (organisation_id, colis_id) references colis(organisation_id, id),
  foreign key (organisation_id, point_relais_id) references points_relais(organisation_id, id)
);
-- Portail grossiste
alter table comptes_pro add column code_portail text unique;
create table commandes_portail (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, tiers_id uuid not null, entite_id uuid not null, lignes jsonb not null, total_ht bigint not null, note text,
  statut text not null default 'soumise' check (statut in ('soumise', 'acceptee', 'refusee')), motif text, document_id uuid, cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, document_id) references documents_vente(organisation_id, id)
);
do $$
declare t text;
begin
  foreach t in array array['locaux','baux','appels_loyer','lots_produit','points_relais','commissions_relais','commandes_portail'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
    execute format('grant select, insert, update on %I to erp_app', t);
  end loop;
end $$;
grant delete on appels_loyer to erp_app;
create trigger audit after insert or update on baux for each row execute function audit_ligne();
create trigger audit after insert or update on commandes_portail for each row execute function audit_ligne();
