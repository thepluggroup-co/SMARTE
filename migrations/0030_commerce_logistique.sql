create table prix_clients (
  organisation_id uuid not null, tiers_id uuid not null, produit_id uuid not null, prix bigint not null check (prix >= 0), auteur_id uuid not null, cree_le timestamptz not null default now(),
  id uuid primary key default gen_random_uuid(), unique (organisation_id, tiers_id, produit_id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id)
);
alter table produits add column quantite_min numeric(14,3) not null default 0, add column multiple numeric(14,3) not null default 0, add column conditionnements jsonb not null default '[]';
create table inventaires (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, libelle text not null, statut text not null default 'ouvert' check (statut in ('ouvert', 'valide')), cree_par uuid not null, valide_par uuid, valide_le timestamptz, cree_le timestamptz not null default now(), unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create table lignes_inventaire (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, inventaire_id uuid not null, produit_id uuid not null, compte numeric(14,3) not null check (compte >= 0), theorique numeric(14,3), note text, unique (organisation_id, inventaire_id, produit_id),
  foreign key (organisation_id, inventaire_id) references inventaires(organisation_id, id),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id)
);
create table reservations_stock (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, produit_id uuid not null, quantite numeric(14,3) not null check (quantite > 0), tiers_id uuid, motif text, expire_le date, levee_le timestamptz, auteur_id uuid not null, cree_le timestamptz not null default now(),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id)
);
create table numeros_serie (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, produit_id uuid not null, numero text not null, statut text not null default 'en_stock' check (statut in ('en_stock', 'vendu', 'retourne')), tiers_id uuid, document_id uuid, garantie_fin date, cree_le timestamptz not null default now(),
  unique (organisation_id, produit_id, numero),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id)
);
create table demandes_prix (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, objet text not null, statut text not null default 'ouverte' check (statut in ('ouverte', 'attribuee', 'abandonnee')), offre_retenue uuid, motif text, cree_par uuid not null, cree_le timestamptz not null default now(), unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create table offres_fournisseur (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, demande_id uuid not null, fournisseur_id uuid not null, montant bigint not null check (montant >= 0), delai_jours int, note text, cree_le timestamptz not null default now(), unique (organisation_id, demande_id, fournisseur_id),
  foreign key (organisation_id, demande_id) references demandes_prix(organisation_id, id),
  foreign key (organisation_id, fournisseur_id) references tiers(organisation_id, id)
);
create table retours_fournisseur (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, fournisseur_id uuid not null, produit_id uuid not null, quantite numeric(14,3) not null check (quantite > 0), motif text not null, statut text not null default 'envoye' check (statut in ('envoye', 'avoir_recu', 'refuse')), auteur_id uuid not null, cree_le timestamptz not null default now(),
  foreign key (organisation_id, fournisseur_id) references tiers(organisation_id, id),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id)
);
create table dossiers_import (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, reference text not null, conteneur text, commande_id uuid, statut text not null default 'en_mer' check (statut in ('commande', 'en_mer', 'au_port', 'dedouane', 'recu')), valeur_marchandise bigint not null default 0, cree_le timestamptz not null default now(), unique (organisation_id, id), unique (organisation_id, reference),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create table frais_import (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, dossier_id uuid not null, nature text not null check (nature in ('fret', 'transit', 'douane', 'port', 'assurance', 'autre')), libelle text, montant bigint not null check (montant > 0),
  foreign key (organisation_id, dossier_id) references dossiers_import(organisation_id, id)
);
do $$
declare t text;
begin
  foreach t in array array['prix_clients','inventaires','lignes_inventaire','reservations_stock','numeros_serie','demandes_prix','offres_fournisseur','retours_fournisseur','dossiers_import','frais_import'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
    execute format('grant select, insert, update on %I to erp_app', t);
    execute format('create trigger audit after insert or update on %I for each row execute function audit_ligne()', t);
  end loop;
end $$;
grant delete on prix_clients to erp_app;
