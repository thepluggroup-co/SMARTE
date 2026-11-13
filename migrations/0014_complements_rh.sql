-- Les salaires sont à part, avec leur propre droit et hors du journal détaillé : aucun montant n'y figure.
create table salaires (
  organisation_id uuid not null,
  employe_id uuid not null,
  salaire_base bigint not null check (salaire_base >= 0),
  maj_le timestamptz not null default now(),
  primary key (organisation_id, employe_id),
  foreign key (organisation_id, employe_id) references employes(organisation_id, id)
);

-- Rien n'est prérempli : chaque taux et chaque barème vient de la validation de l'expert.
create table rubriques_paie (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  entite_id uuid not null,
  code text not null,
  libelle text not null,
  sens text not null check (sens in ('gain', 'retenue', 'charge')),
  mode text not null check (mode in ('fixe', 'pourcentage', 'bareme')),
  assiette text not null default 'brut' check (assiette in ('base', 'brut', 'apres_retenues', 'rubrique')),
  assiette_rubrique text,
  montant bigint,
  taux numeric(8,4),
  plafond bigint,
  abattement_pct numeric(6,3) not null default 0,
  annualise boolean not null default false,
  tranches jsonb,
  ordre int not null default 100,
  actif boolean not null default true,
  unique (organisation_id, id),
  unique (organisation_id, entite_id, code),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);

-- Sans cette validation par un expert, un bulletin reste un brouillon. Toute modification des rubriques l'efface.
create table validations_paie (
  organisation_id uuid not null,
  entite_id uuid not null,
  expert text not null,
  valide_le date not null,
  saisi_par uuid not null,
  saisi_le timestamptz not null default now(),
  primary key (organisation_id, entite_id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, saisi_par) references utilisateurs(organisation_id, id)
);

create table bulletins_paie (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  employe_id uuid not null,
  periode text not null check (periode ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  numero text,
  statut text not null default 'brouillon' check (statut in ('brouillon', 'valide', 'annule')),
  salaire_base bigint not null,
  brut bigint not null,
  retenues bigint not null,
  charges bigint not null,
  net bigint not null,
  lignes jsonb not null,
  expert text,
  cree_par uuid not null,
  valide_par uuid,
  valide_le timestamptz,
  motif_annulation text,
  cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, employe_id) references employes(organisation_id, id),
  foreign key (organisation_id, cree_par) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, valide_par) references utilisateurs(organisation_id, id)
);
create unique index bulletin_unique on bulletins_paie (organisation_id, employe_id, periode) where statut <> 'annule';

create function bulletin_fige() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.statut <> 'brouillon' then raise exception 'bulletin fige'; end if;
    return old;
  end if;
  if old.statut = 'annule' then raise exception 'bulletin fige'; end if;
  if old.statut = 'valide' and (new.statut <> 'annule' or new.net <> old.net or new.brut <> old.brut or new.lignes <> old.lignes) then
    raise exception 'bulletin fige';
  end if;
  return new;
end $$;
create trigger fige before update or delete on bulletins_paie for each row execute function bulletin_fige();

create table pointages (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  employe_id uuid not null,
  jour date not null,
  arrivee time not null,
  depart time,
  note text,
  saisi_par uuid not null,
  unique (organisation_id, employe_id, jour),
  check (depart is null or depart > arrivee),
  foreign key (organisation_id, employe_id) references employes(organisation_id, id),
  foreign key (organisation_id, saisi_par) references utilisateurs(organisation_id, id)
);
create trigger audit after insert or update or delete on pointages for each row execute function audit_ligne();

-- Le rythme d'acquisition est fixé par les RH : le système ne suppose aucun taux légal.
alter table employes add column jours_par_mois numeric(5,2), add column solde_initial numeric(6,2), add column solde_au date;
alter table conges add column derogation text;

do $$
declare t text;
begin
  foreach t in array array['salaires', 'rubriques_paie', 'validations_paie', 'bulletins_paie', 'pointages'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante())
      with check (organisation_id = org_courante())', t);
  end loop;
end $$;
grant select, insert, update on salaires, rubriques_paie, pointages to erp_app;
grant select, insert, update, delete on validations_paie, bulletins_paie to erp_app;
