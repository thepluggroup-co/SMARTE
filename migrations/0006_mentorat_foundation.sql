create table mentorats (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null,
  entite_id uuid not null,
  mentor_id uuid not null,
  mentore_id uuid not null,
  objectif text not null,
  statut text not null default 'actif' check (statut in ('actif', 'suspendu', 'termine')),
  debut date not null,
  fin date,
  cree_le timestamptz not null default now(),
  primary key (id),
  unique (organisation_id, id),
  check (mentor_id <> mentore_id),
  check (fin is null or fin >= debut),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, mentor_id) references tiers(organisation_id, id),
  foreign key (organisation_id, mentore_id) references tiers(organisation_id, id)
);

create table seances_mentorat (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  mentorat_id uuid not null,
  date_seance date not null,
  compte_rendu text not null,
  progres integer check (progres between 1 and 5),
  prochaine_action text,
  auteur_id uuid not null,
  cree_le timestamptz not null default now(),
  foreign key (organisation_id, mentorat_id) references mentorats(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);

create table projets_sociaux (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null,
  entite_id uuid not null,
  nom text not null,
  description text,
  objectif_montant bigint check (objectif_montant > 0),
  statut text not null default 'actif' check (statut in ('actif', 'clos')),
  cree_le timestamptz not null default now(),
  primary key (id),
  unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);

create table dons (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  projet_id uuid not null,
  numero_recu text not null,
  donateur_id uuid, -- vide : don anonyme
  montant bigint not null check (montant > 0),
  moyen text not null check (moyen in ('especes', 'mtn_momo', 'orange_money', 'virement', 'cheque', 'carte', 'nature')),
  reference text,
  encaisse_par uuid not null,
  encaisse_le timestamptz not null default now(),
  annule_le timestamptz,
  motif_annulation text,
  unique (organisation_id, numero_recu),
  check ((annule_le is null) = (motif_annulation is null)),
  foreign key (organisation_id, projet_id) references projets_sociaux(organisation_id, id),
  foreign key (organisation_id, donateur_id) references tiers(organisation_id, id),
  foreign key (organisation_id, encaisse_par) references utilisateurs(organisation_id, id)
);

create table aides_beneficiaires (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  projet_id uuid not null,
  beneficiaire_id uuid not null,
  description text not null,
  montant bigint not null default 0 check (montant >= 0),
  date_aide date not null,
  saisi_par uuid not null,
  annule_le timestamptz,
  motif_annulation text,
  cree_le timestamptz not null default now(),
  check ((annule_le is null) = (motif_annulation is null)),
  foreign key (organisation_id, projet_id) references projets_sociaux(organisation_id, id),
  foreign key (organisation_id, beneficiaire_id) references tiers(organisation_id, id),
  foreign key (organisation_id, saisi_par) references utilisateurs(organisation_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['mentorats', 'seances_mentorat', 'projets_sociaux', 'dons', 'aides_beneficiaires'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante())
      with check (organisation_id = org_courante())', t);
    execute format('create trigger audit after insert or update or delete on %I
      for each row execute function audit_ligne()', t);
  end loop;
end $$;

grant select, insert, update on mentorats, seances_mentorat, projets_sociaux, dons, aides_beneficiaires to erp_app;

-- Un don ou une aide enregistrés ne changent pas : seule leur annulation motivée est permise.
create function montant_immuable() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['annule_le', 'motif_annulation']) <> (to_jsonb(old) - array['annule_le', 'motif_annulation'])
     or old.annule_le is not null then
    raise exception 'Une opération enregistrée ne peut pas être modifiée';
  end if;
  return new;
end $$;
create trigger immuable before update on dons for each row execute function montant_immuable();
create trigger immuable before update on aides_beneficiaires for each row execute function montant_immuable();
