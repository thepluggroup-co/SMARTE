-- Socle multi locataire : chaque ligne métier appartient à une organisation cliente,
-- et PostgreSQL refuse lui-même tout accès hors de l'organisation courante.

create function org_courante() returns uuid language sql stable as
$$ select nullif(current_setting('app.organisation_id', true), '')::uuid $$;

create function utilisateur_courant() returns uuid language sql stable as
$$ select nullif(current_setting('app.utilisateur_id', true), '')::uuid $$;

create table organisations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  nom text not null,
  statut text not null default 'active' check (statut in ('active', 'suspendue')),
  pays char(2) not null default 'CM',
  devise char(3) not null default 'XAF',
  langue text not null default 'fr' check (langue in ('fr', 'en')),
  cree_le timestamptz not null default now()
);

create table entites (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null references organisations(id),
  parent_id uuid,
  code text not null,
  nom text not null,
  type text not null check (type in ('groupe', 'branche', 'societe', 'etablissement',
    'point_de_vente', 'entrepot', 'centre_formation', 'campus', 'departement',
    'centre_cout', 'programme')),
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  primary key (id),
  unique (organisation_id, id),
  unique (organisation_id, code),
  -- Clé composite : une entité ne peut pas avoir un parent d'une autre organisation.
  foreign key (organisation_id, parent_id) references entites(organisation_id, id)
);
create unique index une_seule_racine on entites (organisation_id) where parent_id is null;

create table utilisateurs (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null references organisations(id),
  email text not null check (email = lower(email)),
  nom text not null,
  mot_de_passe_hash text not null,
  actif boolean not null default true,
  echecs_connexion integer not null default 0,
  verrouille_jusqu timestamptz,
  derniere_connexion timestamptz,
  cree_le timestamptz not null default now(),
  primary key (id),
  unique (organisation_id, id),
  unique (organisation_id, email)
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  utilisateur_id uuid not null,
  jeton_hash text not null unique,
  expire_le timestamptz not null,
  cree_le timestamptz not null default now(),
  foreign key (organisation_id, utilisateur_id) references utilisateurs(organisation_id, id)
);

create table roles (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null references organisations(id),
  code text not null,
  nom text not null,
  primary key (id),
  unique (organisation_id, id),
  unique (organisation_id, code)
);

create table role_permissions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  role_id uuid not null,
  permission text not null,
  unique (organisation_id, role_id, permission),
  foreign key (organisation_id, role_id) references roles(organisation_id, id)
);

create table attributions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  utilisateur_id uuid not null,
  role_id uuid not null,
  entite_id uuid, -- vide : toute l'organisation ; sinon l'entité et ses descendantes
  expire_le timestamptz, -- délégation temporaire
  cree_le timestamptz not null default now(),
  unique nulls not distinct (organisation_id, utilisateur_id, role_id, entite_id),
  foreign key (organisation_id, utilisateur_id) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, role_id) references roles(organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);

create table tiers (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null references organisations(id),
  type text not null check (type in ('personne', 'entreprise')),
  nom text not null,
  email text check (email = lower(email)),
  telephone text,
  langue text not null default 'fr' check (langue in ('fr', 'en')),
  roles text[] not null default '{}' check (roles <@ array['prospect', 'client', 'apprenant',
    'etudiant', 'enseignant', 'fournisseur', 'affilie', 'franchise', 'partenaire', 'employe']),
  entite_origine_id uuid,
  archive boolean not null default false,
  cree_le timestamptz not null default now(),
  primary key (id),
  unique (organisation_id, id),
  foreign key (organisation_id, entite_origine_id) references entites(organisation_id, id)
);
create index tiers_email on tiers (organisation_id, email);
create index tiers_telephone on tiers (organisation_id, telephone);

create table modules_entite (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  entite_id uuid not null,
  module text not null,
  actif boolean not null,
  modifie_le timestamptz not null default now(),
  unique (organisation_id, entite_id, module),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);

-- File d'événements : écrite dans la même transaction que le fait métier.
create table evenements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id),
  type text not null,
  charge jsonb not null,
  cree_le timestamptz not null default now(),
  traite_le timestamptz
);
create index evenements_a_traiter on evenements (cree_le) where traite_le is null;

-- Journal d'audit chaîné : chaque ligne contient l'empreinte de la précédente.
create table journal_audit (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id),
  sequence bigint not null,
  horodatage timestamptz not null,
  acteur_id uuid,
  action text not null,
  objet text,
  objet_id uuid,
  avant jsonb,
  apres jsonb,
  empreinte_precedente text not null,
  empreinte text not null,
  unique (organisation_id, sequence)
);

create function journal_empreinte(
  p_organisation uuid, p_sequence bigint, p_horodatage timestamptz, p_acteur uuid,
  p_action text, p_objet text, p_objet_id uuid, p_avant jsonb, p_apres jsonb, p_precedente text
) returns text language sql immutable set search_path = pg_catalog as $$
  select encode(sha256(convert_to(jsonb_build_array(
    p_organisation, p_sequence, extract(epoch from p_horodatage)::text, p_acteur,
    p_action, p_objet, p_objet_id, p_avant, p_apres, p_precedente)::text, 'UTF8')), 'hex')
$$;

create function journal_ecrire(
  p_organisation uuid, p_action text, p_objet text, p_objet_id uuid, p_avant jsonb, p_apres jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sequence bigint;
  v_precedente text;
  v_horodatage timestamptz := clock_timestamp();
  v_acteur uuid := utilisateur_courant();
begin
  -- Une seule écriture à la fois par organisation, pour une chaîne sans trou.
  perform pg_advisory_xact_lock(hashtextextended(p_organisation::text, 0));
  select sequence, empreinte into v_sequence, v_precedente from journal_audit
    where organisation_id = p_organisation order by sequence desc limit 1;
  v_sequence := coalesce(v_sequence, 0) + 1;
  v_precedente := coalesce(v_precedente, 'origine');
  insert into journal_audit (organisation_id, sequence, horodatage, acteur_id, action, objet,
    objet_id, avant, apres, empreinte_precedente, empreinte)
  values (p_organisation, v_sequence, v_horodatage, v_acteur, p_action, p_objet, p_objet_id,
    p_avant, p_apres, v_precedente,
    journal_empreinte(p_organisation, v_sequence, v_horodatage, v_acteur, p_action, p_objet,
      p_objet_id, p_avant, p_apres, v_precedente));
end $$;
revoke execute on function journal_ecrire(uuid, text, text, uuid, jsonb, jsonb) from public;

-- Événement non lié à une ligne (connexion, échec). L'organisation vient du contexte.
create function journal_evenement(p_action text, p_details jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if org_courante() is null then raise exception 'organisation absente'; end if;
  perform journal_ecrire(org_courante(), p_action, null, null, null, p_details);
end $$;

create function audit_ligne() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  masques text[] := array['mot_de_passe_hash', 'echecs_connexion', 'verrouille_jusqu',
    'derniere_connexion', 'modifie_le'];
  v_avant jsonb;
  v_apres jsonb;
begin
  if tg_op <> 'INSERT' then v_avant := to_jsonb(old) - masques; end if;
  if tg_op <> 'DELETE' then v_apres := to_jsonb(new) - masques; end if;
  if tg_op = 'UPDATE' and v_avant = v_apres then return new; end if;
  perform journal_ecrire(
    coalesce(new.organisation_id, old.organisation_id), lower(tg_op), tg_table_name,
    coalesce(new.id, old.id), v_avant, v_apres);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['entites', 'utilisateurs', 'roles', 'role_permissions',
    'attributions', 'tiers', 'modules_entite'] loop
    execute format('create trigger audit after insert or update or delete on %I
      for each row execute function audit_ligne()', t);
  end loop;
end $$;

create function journal_immuable() returns trigger language plpgsql as $$
begin
  raise exception 'Le journal d''audit ne peut pas être modifié';
end $$;
create trigger immuable before update or delete on journal_audit
  for each row execute function journal_immuable();
create trigger immuable_vidage before truncate on journal_audit
  for each statement execute function journal_immuable();

create function journal_verifier()
returns table (valide boolean, total bigint, rupture_sequence bigint)
language plpgsql stable set search_path = public, pg_temp as $$
declare
  l journal_audit%rowtype;
  v_attendue bigint := 1;
  v_precedente text := 'origine';
begin
  if org_courante() is null then raise exception 'organisation absente'; end if;
  for l in select * from journal_audit where organisation_id = org_courante() order by sequence loop
    if l.sequence <> v_attendue or l.empreinte_precedente <> v_precedente or l.empreinte <>
      journal_empreinte(l.organisation_id, l.sequence, l.horodatage, l.acteur_id, l.action,
        l.objet, l.objet_id, l.avant, l.apres, l.empreinte_precedente) then
      return query select false, v_attendue - 1, l.sequence;
      return;
    end if;
    v_precedente := l.empreinte;
    v_attendue := v_attendue + 1;
  end loop;
  return query select true, v_attendue - 1, null::bigint;
end $$;

-- Cloisonnement : activé et forcé sur toutes les tables de locataires.
do $$
declare t text;
begin
  foreach t in array array['entites', 'utilisateurs', 'sessions', 'roles', 'role_permissions',
    'attributions', 'tiers', 'modules_entite', 'evenements', 'journal_audit'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante())
      with check (organisation_id = org_courante())', t);
  end loop;
end $$;

-- organisations : pas de FORCE, pour que le provisionnement par le propriétaire reste possible.
alter table organisations enable row level security;
create policy cloison on organisations for select using (id = org_courante());

-- Seule information accessible avant connexion : l'identifiant d'une organisation active.
create function organisation_active_par_slug(p_slug text) returns uuid
language sql stable security definer set search_path = public, pg_temp as
$$ select id from organisations where slug = p_slug and statut = 'active' $$;

-- Droits minimaux du compte utilisé par l'application.
grant usage on schema public to erp_app;
grant select on organisations to erp_app;
grant select, insert, update on entites, utilisateurs, roles, role_permissions, tiers,
  modules_entite, evenements to erp_app;
grant select, insert, update, delete on sessions, attributions to erp_app;
grant select on journal_audit to erp_app;
