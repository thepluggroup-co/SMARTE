-- Identifiants seuls, sans donnée d'organisation : c'est ce qu'il faut aux tâches planifiées pour faire le tour.
create table registre_organisations (id uuid primary key);
grant select on registre_organisations to erp_app;
insert into registre_organisations select id from organisations;
create function inscrire_organisation() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin insert into registre_organisations values (new.id); return new; end $$;
create trigger registre after insert on organisations for each row execute function inscrire_organisation();

alter table tiers add column fusionne_vers uuid, add foreign key (organisation_id, fusionne_vers) references tiers(organisation_id, id);
create or replace function document_immuable() returns trigger language plpgsql as $$
begin
  if old.statut = 'brouillon' then return new; end if;
  if old.type = 'devis' and old.statut in ('emis', 'accepte', 'refuse')
     and new.statut in ('emis', 'accepte', 'refuse')
     and (to_jsonb(new) - 'statut') = (to_jsonb(old) - 'statut') then
    return new;
  end if;
  -- Une fusion de fiches déplace le lien. Le nom imprimé sur le document ne change pas.
  if (to_jsonb(new) - 'tiers_id') = (to_jsonb(old) - 'tiers_id')
     and exists (select 1 from tiers t where t.id = old.tiers_id and t.fusionne_vers = new.tiers_id) then
    return new;
  end if;
  raise exception 'Un document émis ne peut pas être modifié';
end $$;
create or replace function vente_immuable() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'tiers_id') = (to_jsonb(old) - 'tiers_id')
     and exists (select 1 from tiers t where t.id = old.tiers_id and t.fusionne_vers = new.tiers_id) then
    return new;
  end if;
  if (to_jsonb(new) - array['annulee_le', 'annulee_par', 'motif_annulation']) <> (to_jsonb(old) - array['annulee_le', 'annulee_par', 'motif_annulation'])
     or old.annulee_le is not null then
    raise exception 'Une vente enregistrée ne peut pas être modifiée';
  end if;
  return new;
end $$;

create table sites_pointage (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, nom text not null, secret_chiffre text not null, actif boolean not null default true,
  unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
alter table pointages add column site_id uuid, add foreign key (organisation_id, site_id) references sites_pointage(organisation_id, id);
alter table candidatures add column cv_fichier text, add column cv_taille bigint, add column cv_jeton text;
create table signatures_document (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, document_id uuid not null, signataire_id uuid not null, empreinte text not null, mention text not null, signe_le timestamptz not null default now(),
  unique (organisation_id, document_id, signataire_id),
  foreign key (organisation_id, document_id) references documents_ged(organisation_id, id),
  foreign key (organisation_id, signataire_id) references utilisateurs(organisation_id, id)
);
create table eliminations_groupe (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, annee int not null, libelle text not null, chiffre bigint not null default 0, resultat bigint not null default 0, auteur_id uuid not null, cree_le timestamptz not null default now(),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
do $$
declare t text;
begin
  foreach t in array array['sites_pointage','signatures_document','eliminations_groupe'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
    execute format('grant select, insert, update on %I to erp_app', t);
    execute format('create trigger audit after insert or update on %I for each row execute function audit_ligne()', t);
  end loop;
end $$;
grant delete on eliminations_groupe to erp_app;
-- La fusion de fiches déplace ces seuls liens, y compris dans les tables en ajout seul.
do $$
declare r record;
begin
  for r in select conrelid::regclass::text as t, a.attname as c from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[2]
           where k.contype = 'f' and k.confrelid = 'tiers'::regclass and conrelid <> 'lignes_ecriture'::regclass loop
    execute format('grant update (%I) on %s to erp_app', r.c, r.t);
  end loop;
end $$;
