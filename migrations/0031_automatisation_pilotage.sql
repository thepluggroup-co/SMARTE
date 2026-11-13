create table regles_auto (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, nom text not null, evenement text not null, champ text, valeur text, action text not null check (action in ('tache')), titre text not null, assigne_a uuid not null, delai_jours int not null default 3, actif boolean not null default true, depuis timestamptz not null default now(), auteur_id uuid not null, cree_le timestamptz not null default now(), unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, assigne_a) references utilisateurs(organisation_id, id)
);
create table executions_regle (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, regle_id uuid not null, evenement_id uuid not null, resultat text not null, cree_le timestamptz not null default now(),
  unique (organisation_id, regle_id, evenement_id),
  foreign key (organisation_id, regle_id) references regles_auto(organisation_id, id)
);
create table contrats (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, objet text not null, type text not null check (type in ('client', 'fournisseur', 'assurance', 'licence', 'autorisation', 'bail', 'autre')), tiers_id uuid, debut date, fin date, montant bigint, rappel_jours int not null default 30, document_id uuid, resilie_le timestamptz, cree_le timestamptz not null default now(),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, document_id) references documents_ged(organisation_id, id)
);
create table equipements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, nom text not null, lieu text, periodicite_jours int, prochaine date, actif boolean not null default true, unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create table interventions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, equipement_id uuid not null, jour date not null, nature text not null check (nature in ('preventive', 'corrective')), description text not null, cout bigint not null default 0, auteur_id uuid not null, cree_le timestamptz not null default now(),
  foreign key (organisation_id, equipement_id) references equipements(organisation_id, id)
);
create table modeles_audit (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, nom text not null, points jsonb not null, unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create table audits (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, modele_id uuid not null, lieu text not null, jour date not null, reponses jsonb not null, score int not null, auteur_id uuid not null, cree_le timestamptz not null default now(),
  foreign key (organisation_id, modele_id) references modeles_audit(organisation_id, id)
);
create table annonces (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid, titre text not null, contenu text not null, auteur_id uuid not null, cree_le timestamptz not null default now(),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create table articles_aide (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, titre text not null, contenu text not null, categorie text, public boolean not null default false, auteur_id uuid not null, maj_le timestamptz not null default now()
);
alter table tiers add column anonymise_le timestamptz;
do $$
declare t text;
begin
  foreach t in array array['regles_auto','executions_regle','contrats','equipements','interventions','modeles_audit','audits','annonces','articles_aide'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
    execute format('grant select, insert, update on %I to erp_app', t);
    execute format('create trigger audit after insert or update on %I for each row execute function audit_ligne()', t);
  end loop;
end $$;
grant delete on annonces, articles_aide to erp_app;
