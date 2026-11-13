-- Suivi des achats étape par étape : origine locale ou importation, acheteur, transitaire, frais d'acheminement, poids et volume.
-- Les anciennes commandes gardent un acheteur vide : l'écran affiche alors la personne qui a créé la commande.

-- Un transitaire est un partenaire comme un autre, avec son propre rôle.
alter table tiers drop constraint tiers_roles_check;
alter table tiers add constraint tiers_roles_check check (roles <@ array['prospect', 'client', 'apprenant',
  'etudiant', 'enseignant', 'fournisseur', 'affilie', 'franchise', 'partenaire', 'employe', 'transitaire']);

alter table commandes_achat
  add column origine text not null default 'local' check (origine in ('local', 'import')),
  add column acheteur_id uuid,
  add column reference_fournisseur text check (length(reference_fournisseur) <= 100),
  add column pays_origine text check (length(pays_origine) <= 100),
  add column etape text not null default 'commandee' check (etape in (
    'commandee', 'achetee', 'en_production', 'expediee', 'en_transport', 'arrivee_port', 'dedouanee', 'enlevee', 'livree', 'en_stock')),
  add column etape_le date,
  add column transitaire_id uuid,
  add column mode_transport text check (mode_transport in ('maritime', 'aerien')),
  add column volume_m3 numeric(14,3) check (volume_m3 >= 0),
  add foreign key (organisation_id, acheteur_id) references utilisateurs(organisation_id, id),
  add foreign key (organisation_id, transitaire_id) references tiers(organisation_id, id);

alter table lignes_achat add column poids_kg numeric(14,3) check (poids_kg >= 0);
-- Prix de vente prévu sur le marché local, pour calculer la marge avant de commander.
alter table lignes_achat add column prix_vente_prevu bigint check (prix_vente_prevu >= 0);

create index commandes_achat_date on commandes_achat (organisation_id, date_commande);

-- Journal des étapes : une ligne par passage, jamais modifiée ni supprimée.
create table etapes_achat (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  commande_id uuid not null,
  etape text not null,
  date_etape date not null,
  note text check (length(note) <= 500),
  auteur_id uuid not null,
  cree_le timestamptz not null default now(),
  foreign key (organisation_id, commande_id) references commandes_achat(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create index etapes_achat_commande on etapes_achat (commande_id);

-- Frais d'acheminement. Le transport principal d'une importation est un forfait tout compris
-- (fret, assurance, dédouanement), souvent calculé au kilo ou au mètre cube.
-- Un frais retiré reste visible, avec son motif.
create table frais_achat (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  commande_id uuid not null,
  nature text not null check (nature in ('pre_acheminement', 'fret', 'enlevement', 'post_acheminement', 'transport_local', 'manutention', 'autre')),
  base_calcul text check (base_calcul in ('poids', 'volume')),
  quantite_base numeric(14,3) check (quantite_base > 0),
  tarif bigint check (tarif >= 0),
  libelle text check (length(libelle) <= 200),
  prestataire text check (length(prestataire) <= 200),
  montant bigint not null check (montant > 0),
  auteur_id uuid not null,
  cree_le timestamptz not null default now(),
  retire_le timestamptz,
  retire_par uuid,
  motif_retrait text,
  check (retire_le is null or motif_retrait is not null),
  check ((base_calcul is null) = (quantite_base is null) and (base_calcul is null) = (tarif is null)),
  foreign key (organisation_id, commande_id) references commandes_achat(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, retire_par) references utilisateurs(organisation_id, id)
);
create index frais_achat_commande on frais_achat (commande_id);

do $$
declare t text;
begin
  foreach t in array array['etapes_achat', 'frais_achat'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante())
      with check (organisation_id = org_courante())', t);
    execute format('create trigger audit after insert or update or delete on %I
      for each row execute function audit_ligne()', t);
  end loop;
end $$;

grant select, insert on etapes_achat to erp_app;
grant select, insert, update on frais_achat to erp_app;
