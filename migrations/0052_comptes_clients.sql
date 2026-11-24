-- Lot 4, partie B : comptes clients en ligne, connexion par téléphone et code reçu par SMS.

-- Code de connexion : seule son empreinte (HMAC avec la clé du serveur) est gardée, jamais le code.
create table codes_connexion (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  branche_id uuid not null,
  telephone text not null check (telephone ~ '^2376[0-9]{8}$'),
  code_hache text not null check (code_hache ~ '^[0-9a-f]{64}$'),
  essais integer not null default 0 check (essais between 0 and 5),
  expire_le timestamptz not null,
  utilise_le timestamptz,
  invalide_le timestamptz,
  envoi text check (envoi in ('envoye', 'echec')),
  cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  check (utilise_le is null or invalide_le is null),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id)
);
create index codes_connexion_numero on codes_connexion (organisation_id, telephone, cree_le);

-- Session d'un appareil : seule l'empreinte du jeton est gardée ; 7 jours, sans prolongation.
create table sessions_clients (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  branche_id uuid not null,
  tiers_id uuid not null,
  telephone text not null,
  jeton_hache text not null unique check (jeton_hache ~ '^[0-9a-f]{64}$'),
  cree_le timestamptz not null default now(),
  expire_le timestamptz not null,
  revoque_le timestamptz,
  revoque_par uuid,
  unique (organisation_id, id),
  check (expire_le > cree_le),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, revoque_par) references utilisateurs(organisation_id, id)
);
create index sessions_clients_fiche on sessions_clients (organisation_id, tiers_id);

-- Adresses de livraison d'un client : cinq au plus (contrôle applicatif), une seule par défaut.
create table adresses_clients (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  tiers_id uuid not null,
  nom text not null check (length(trim(nom)) between 1 and 50),
  zone_id uuid,
  adresse text not null check (length(trim(adresse)) between 3 and 500),
  repere text check (length(repere) <= 200),
  par_defaut boolean not null default false,
  cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, zone_id) references zones_livraison(organisation_id, id)
);
create index adresses_clients_fiche on adresses_clients (organisation_id, tiers_id);
create unique index adresses_clients_defaut on adresses_clients (organisation_id, tiers_id) where par_defaut;

do $$
declare t text;
begin
  foreach t in array array['codes_connexion', 'sessions_clients', 'adresses_clients'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
  end loop;
end $$;
-- Les empreintes des codes et des jetons n'ont rien à faire dans le journal d'audit ; les adresses, si.
create trigger audit after insert or update on adresses_clients for each row execute function audit_ligne();
grant select, insert, update on codes_connexion, sessions_clients to erp_app;
grant select, insert, update, delete on adresses_clients to erp_app;
