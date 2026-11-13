-- Comptabilité SYSCOHADA, tenue par branche. Les règles viennent de l'Acte uniforme de 2017 (art. 15 à 24).
create table comptes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, branche_id uuid not null,
  numero text not null check (numero ~ '^[1-9][0-9]{1,11}$'), libelle text not null,
  actif boolean not null default true,
  unique (organisation_id, id), unique (organisation_id, branche_id, numero),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id)
);
create table journaux (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, branche_id uuid not null,
  code text not null check (code ~ '^[A-Z0-9]{2,6}$'), libelle text not null,
  unique (organisation_id, id), unique (organisation_id, branche_id, code),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id)
);
create table parametres_comptables (
  organisation_id uuid not null, branche_id uuid not null, cle text not null, numero text not null,
  primary key (organisation_id, branche_id, cle),
  foreign key (organisation_id, branche_id, numero) references comptes(organisation_id, branche_id, numero)
);
create table clotures_periode (
  organisation_id uuid not null, branche_id uuid not null,
  mois text not null check (mois ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  definitive boolean not null default false, close_par uuid not null, close_le timestamptz not null default now(),
  primary key (organisation_id, branche_id, mois),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id),
  foreign key (organisation_id, close_par) references utilisateurs(organisation_id, id)
);
create table clotures_exercice (
  organisation_id uuid not null, branche_id uuid not null, annee int not null,
  resultat bigint not null, close_par uuid not null, close_le timestamptz not null default now(),
  primary key (organisation_id, branche_id, annee),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id),
  foreign key (organisation_id, close_par) references utilisateurs(organisation_id, id)
);
create table ecritures (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, branche_id uuid not null, journal_id uuid not null,
  date_ecriture date not null, numero text, libelle text not null, piece text,
  statut text not null default 'brouillon' check (statut in ('brouillon', 'validee')),
  source_type text, source_id uuid, contrepasse_id uuid,
  cree_par uuid, valide_par uuid, valide_le timestamptz, cree_le timestamptz not null default now(),
  unique (organisation_id, id), unique (organisation_id, branche_id, numero),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id),
  foreign key (organisation_id, journal_id) references journaux(organisation_id, id),
  foreign key (organisation_id, contrepasse_id) references ecritures(organisation_id, id),
  foreign key (organisation_id, cree_par) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, valide_par) references utilisateurs(organisation_id, id)
);
-- Une pièce d'un autre module ne produit jamais deux écritures.
create unique index ecriture_source_unique on ecritures (organisation_id, source_type, source_id) where source_id is not null;
create unique index contrepassation_unique on ecritures (organisation_id, contrepasse_id) where contrepasse_id is not null;
create table lignes_ecriture (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, ecriture_id uuid not null, ordre int not null, compte_id uuid not null,
  debit bigint not null default 0 check (debit >= 0), credit bigint not null default 0 check (credit >= 0),
  tiers_id uuid, section text, libelle text,
  check ((debit > 0) <> (credit > 0)),
  foreign key (organisation_id, ecriture_id) references ecritures(organisation_id, id),
  foreign key (organisation_id, compte_id) references comptes(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id)
);
create index lignes_ecriture_compte on lignes_ecriture (organisation_id, compte_id);
create index lignes_ecriture_ecriture on lignes_ecriture (organisation_id, ecriture_id);

-- Filet de sécurité dans la base : même une erreur de l'application ne peut pas altérer une écriture validée (art. 22).
create function ecriture_controle() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare d bigint; c bigint; n int;
begin
  if tg_op = 'DELETE' then
    if old.statut = 'validee' then raise exception 'ecriture validee intangible'; end if;
    return old;
  end if;
  if old.statut = 'validee' then raise exception 'ecriture validee intangible'; end if;
  if new.statut = 'validee' then
    select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) into d, c, n from lignes_ecriture where ecriture_id = new.id;
    if n < 2 or d <> c or d = 0 then raise exception 'ecriture desequilibree'; end if;
    if new.numero is null then raise exception 'ecriture sans numero'; end if;
    if exists (select 1 from clotures_periode p where p.branche_id = new.branche_id and p.mois = to_char(new.date_ecriture, 'YYYY-MM'))
      or exists (select 1 from clotures_exercice x where x.branche_id = new.branche_id and x.annee = extract(year from new.date_ecriture)::int) then
      raise exception 'periode close';
    end if;
  end if;
  return new;
end $$;
create trigger controle before update or delete on ecritures for each row execute function ecriture_controle();

create function ligne_ecriture_controle() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare e uuid;
begin
  e := case when tg_op = 'DELETE' then old.ecriture_id else new.ecriture_id end;
  if exists (select 1 from ecritures x where x.id = e and x.statut = 'validee') then raise exception 'ecriture validee intangible'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger controle before insert or update or delete on lignes_ecriture for each row execute function ligne_ecriture_controle();

create trigger audit after insert or update or delete on ecritures for each row execute function audit_ligne();
create trigger audit after insert or update or delete on lignes_ecriture for each row execute function audit_ligne();

do $$
declare t text;
begin
  foreach t in array array['comptes', 'journaux', 'parametres_comptables', 'clotures_periode', 'clotures_exercice', 'ecritures', 'lignes_ecriture'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
  end loop;
end $$;
grant select, insert, update on comptes, journaux, parametres_comptables to erp_app;
grant select, insert, delete on clotures_periode to erp_app;
grant update (definitive) on clotures_periode to erp_app;
grant select, insert on clotures_exercice to erp_app;
grant select, insert, update, delete on ecritures, lignes_ecriture to erp_app;
