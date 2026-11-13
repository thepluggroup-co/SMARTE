create table modeles_ecriture (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, branche_id uuid not null, nom text not null, journal text not null, lignes jsonb not null, unique (organisation_id, branche_id, nom),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id)
);
create table echeances_fiscales (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, branche_id uuid not null, libelle text not null, jour date not null, faite_le timestamptz, faite_par uuid, unique (organisation_id, branche_id, libelle, jour),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id)
);
create table dsf_versions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, branche_id uuid not null, annee int not null, numero int not null, statut text not null check (statut in ('validee', 'deposee')), contenu jsonb not null, auteur_id uuid not null, cree_le timestamptz not null default now(),
  unique (organisation_id, branche_id, annee, numero),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create table dsf_corrections (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, branche_id uuid not null, annee int not null, etat text not null, reference text not null, montant bigint not null, justification text not null, auteur_id uuid not null, cree_le timestamptz not null default now(),
  unique (organisation_id, branche_id, annee, etat, reference),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create table inventaires_immo (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, immobilisation_id uuid not null, jour date not null, present boolean not null, note text, auteur_id uuid not null,
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create table refacturations_internes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, de_branche uuid not null, vers_branche uuid not null, jour date not null, libelle text not null, montant bigint not null check (montant > 0), auteur_id uuid not null, cree_le timestamptz not null default now(),
  check (de_branche <> vers_branche),
  foreign key (organisation_id, de_branche) references entites(organisation_id, id),
  foreign key (organisation_id, vers_branche) references entites(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
do $$
declare t text;
begin
  foreach t in array array['modeles_ecriture','echeances_fiscales','dsf_versions','dsf_corrections','inventaires_immo','refacturations_internes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
    execute format('grant select, insert, update on %I to erp_app', t);
    execute format('create trigger audit after insert or update on %I for each row execute function audit_ligne()', t);
  end loop;
end $$;
grant delete on modeles_ecriture, dsf_corrections to erp_app;
