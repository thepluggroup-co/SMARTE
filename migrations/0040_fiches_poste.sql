-- Fiches de poste : chaque modification crée une nouvelle version, jamais modifiée ensuite.
-- Le collaborateur confirme avoir lu la version en vigueur de la fiche de son poste.

create table fiches_poste (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, groupe_id uuid not null, version int not null check (version >= 1),
  entite_id uuid not null, intitule text not null check (length(intitule) between 1 and 200),
  rattache_a uuid, rattachement text check (length(rattachement) <= 300),
  missions text[] not null default '{}', responsabilites text[] not null default '{}', competences text[] not null default '{}',
  indicateurs jsonb not null default '[]', objectifs_types jsonb not null default '[]',
  motif_version text, auteur_id uuid not null, cree_le timestamptz not null default now(),
  check (version = 1 or motif_version is not null),
  check (jsonb_typeof(indicateurs) = 'array' and jsonb_typeof(objectifs_types) = 'array'),
  unique (organisation_id, id), unique (organisation_id, groupe_id, version),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create index fiches_poste_intitule on fiches_poste (organisation_id, entite_id, intitule);

create table lectures_fiche (
  organisation_id uuid not null, fiche_id uuid not null, employe_id uuid not null,
  lu_le timestamptz not null default now(),
  primary key (organisation_id, fiche_id, employe_id),
  foreign key (organisation_id, fiche_id) references fiches_poste(organisation_id, id),
  foreign key (organisation_id, employe_id) references employes(organisation_id, id)
);

-- Un modèle d'objectif peut venir d'une fiche de poste : on sait laquelle, et quelle version.
alter table modeles_objectifs add column fiche_id uuid,
  add foreign key (organisation_id, fiche_id) references fiches_poste(organisation_id, id);

do $$
declare t text;
begin
  foreach t in array array['fiches_poste', 'lectures_fiche'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
  end loop;
end $$;
create trigger audit after insert or update or delete on fiches_poste for each row execute function audit_ligne();

-- Ni mise à jour ni suppression : une version de fiche reste telle qu'elle a été publiée.
grant select, insert on fiches_poste, lectures_fiche to erp_app;
