-- Double authentification
alter table utilisateurs
  add column totp_secret_chiffre text,
  add column totp_actif boolean not null default false,
  add column totp_dernier_pas bigint;

create or replace function audit_ligne() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  masques text[] := array['mot_de_passe_hash', 'echecs_connexion', 'verrouille_jusqu',
    'derniere_connexion', 'modifie_le', 'totp_secret_chiffre', 'totp_dernier_pas'];
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

-- Numéros sans rupture : le compteur revient en arrière si la transaction échoue.
create table compteurs (
  organisation_id uuid not null references organisations(id),
  serie text not null,
  valeur bigint not null,
  primary key (organisation_id, serie)
);

create table programmes (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null,
  entite_id uuid not null,
  code text not null,
  nom text not null,
  description text,
  -- [{ "libelle": "...", "montant": 20000, "jours_apres_debut": 0 }], en FCFA
  plan_paiement jsonb not null check (jsonb_typeof(plan_paiement) = 'array' and jsonb_array_length(plan_paiement) > 0),
  seuil_presence integer not null default 75 check (seuil_presence between 0 and 100),
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  primary key (id),
  unique (organisation_id, id),
  unique (organisation_id, code),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);

create table sessions_formation (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null,
  programme_id uuid not null,
  entite_id uuid not null,
  code text not null,
  ville text not null,
  lieu text,
  mode text not null default 'presentiel' check (mode in ('presentiel', 'en_ligne', 'hybride')),
  debut date not null,
  fin date not null,
  capacite integer check (capacite > 0),
  statut text not null default 'ouverte' check (statut in ('planifiee', 'ouverte', 'en_cours', 'terminee', 'annulee')),
  cree_le timestamptz not null default now(),
  primary key (id),
  unique (organisation_id, id),
  unique (organisation_id, code),
  check (fin >= debut),
  foreign key (organisation_id, programme_id) references programmes(organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);

create table inscriptions (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null,
  session_id uuid not null,
  tiers_id uuid not null,
  statut text not null default 'active' check (statut in ('active', 'abandon', 'annulee')),
  cree_le timestamptz not null default now(),
  primary key (id),
  unique (organisation_id, id),
  unique (organisation_id, session_id, tiers_id),
  foreign key (organisation_id, session_id) references sessions_formation(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id)
);

create table echeances (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  inscription_id uuid not null,
  ordre integer not null,
  libelle text not null,
  montant bigint not null check (montant > 0),
  date_echeance date not null,
  unique (organisation_id, inscription_id, ordre),
  foreign key (organisation_id, inscription_id) references inscriptions(organisation_id, id)
);

create table paiements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  inscription_id uuid not null,
  numero_recu text not null,
  montant bigint not null check (montant > 0),
  moyen text not null check (moyen in ('especes', 'mtn_momo', 'orange_money', 'virement', 'cheque', 'carte')),
  reference text,
  encaisse_par uuid not null,
  encaisse_le timestamptz not null default now(),
  annule_le timestamptz,
  annule_par uuid,
  motif_annulation text,
  unique (organisation_id, numero_recu),
  check ((annule_le is null) = (motif_annulation is null)),
  foreign key (organisation_id, inscription_id) references inscriptions(organisation_id, id),
  foreign key (organisation_id, encaisse_par) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, annule_par) references utilisateurs(organisation_id, id)
);

create table presences (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  inscription_id uuid not null,
  date_seance date not null,
  present boolean not null,
  unique (organisation_id, inscription_id, date_seance),
  foreign key (organisation_id, inscription_id) references inscriptions(organisation_id, id)
);

create table certificats (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  inscription_id uuid not null,
  numero text not null,
  code_verification text not null unique,
  titulaire text not null,
  programme text not null,
  delivre_le date not null default current_date,
  revoque_le timestamptz,
  motif_revocation text,
  unique (organisation_id, inscription_id),
  unique (organisation_id, numero),
  foreign key (organisation_id, inscription_id) references inscriptions(organisation_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['compteurs', 'programmes', 'sessions_formation', 'inscriptions',
    'echeances', 'paiements', 'presences', 'certificats'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante())
      with check (organisation_id = org_courante())', t);
  end loop;
  foreach t in array array['programmes', 'sessions_formation', 'inscriptions', 'echeances',
    'paiements', 'presences', 'certificats'] loop
    execute format('create trigger audit after insert or update or delete on %I
      for each row execute function audit_ligne()', t);
  end loop;
end $$;

grant select, insert, update on compteurs, programmes, sessions_formation, inscriptions,
  echeances, paiements, presences, certificats to erp_app;

-- Un encaissement enregistré ne change jamais : seule son annulation motivée est permise.
create function paiement_immuable() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['annule_le', 'annule_par', 'motif_annulation'])
     <> (to_jsonb(old) - array['annule_le', 'annule_par', 'motif_annulation'])
     or old.annule_le is not null then
    raise exception 'Un paiement enregistré ne peut pas être modifié';
  end if;
  return new;
end $$;
create trigger immuable before update on paiements
  for each row execute function paiement_immuable();
