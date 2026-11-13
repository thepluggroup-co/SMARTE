alter table produits add column parent_id uuid, add column attributs jsonb, add foreign key (organisation_id, parent_id) references produits(organisation_id, id);
create table manifestations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, titre text not null, description text, lieu text, debut timestamptz not null, fin timestamptz not null, capacite int not null check (capacite > 0), prix bigint not null default 0 check (prix >= 0), intervenants text, code text not null unique, ouverte boolean not null default true, cree_le timestamptz not null default now(),
  check (fin > debut), unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create table billets (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, manifestation_id uuid not null, nom text not null, telephone text, email text, code text not null unique, statut text not null default 'reserve' check (statut in ('reserve', 'paye', 'annule')), montant_paye bigint not null default 0, portefeuille_id uuid, numero text, present_le timestamptz, encaisse_par uuid, cree_le timestamptz not null default now(),
  foreign key (organisation_id, manifestation_id) references manifestations(organisation_id, id),
  foreign key (organisation_id, portefeuille_id) references portefeuilles(organisation_id, id),
  foreign key (organisation_id, encaisse_par) references utilisateurs(organisation_id, id)
);
create table ressources_coaching (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, titre text not null, categorie text not null check (categorie in ('ressource', 'exercice', 'test', 'modele')), url text not null check (url like 'https://%'), niveau_min int not null default 0 check (niveau_min between 0 and 20), actif boolean not null default true,
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
alter table relances drop constraint relances_source_type_check, add constraint relances_source_type_check check (source_type in ('facture', 'echeance', 'scolarite'));
do $$
declare t text;
begin
  foreach t in array array['manifestations','billets','ressources_coaching'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
    execute format('grant select, insert, update on %I to erp_app', t);
    execute format('create trigger audit after insert or update on %I for each row execute function audit_ligne()', t);
  end loop;
end $$;
