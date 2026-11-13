create table kpi_suivis (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, source text not null, libelle text not null,
  cible numeric(18,2) not null, seuil_alerte numeric(18,2) not null, seuil_critique numeric(18,2) not null,
  responsable_id uuid, actif boolean not null default true,
  unique (organisation_id, id), unique (organisation_id, entite_id, source),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, responsable_id) references utilisateurs(organisation_id, id)
);
create table alertes_kpi (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, kpi_id uuid not null, periode text not null, niveau text not null check (niveau in ('alerte', 'critique')),
  valeur numeric(18,2) not null, recommandation text not null,
  statut text not null default 'nouvelle' check (statut in ('nouvelle', 'acceptee', 'reportee', 'refusee')), motif text, decide_par uuid, decide_le timestamptz, cree_le timestamptz not null default now(),
  unique (organisation_id, kpi_id, periode, niveau),
  foreign key (organisation_id, kpi_id) references kpi_suivis(organisation_id, id),
  foreign key (organisation_id, decide_par) references utilisateurs(organisation_id, id)
);
-- Le secret n'est jamais conservé en clair : seule son empreinte permet de reconnaître la clé.
create table cles_api (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, nom text not null, cle_hash text not null unique, utilisateur_id uuid not null, cree_par uuid not null,
  expire_le timestamptz, revoquee_le timestamptz, utilisee_le timestamptz, cree_le timestamptz not null default now(),
  foreign key (organisation_id, utilisateur_id) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, cree_par) references utilisateurs(organisation_id, id)
);
create table webhooks (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, nom text not null, url text not null check (url like 'https://%'), evenements text[] not null, secret_chiffre text not null,
  actif boolean not null default true, cree_le timestamptz not null default now(),
  unique (organisation_id, id)
);
create table livraisons_webhook (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, webhook_id uuid not null, evenement_id uuid not null,
  statut text not null default 'a_envoyer' check (statut in ('a_envoyer', 'envoye', 'abandonne')), essais int not null default 0, prochain_essai timestamptz not null default now(), dernier_code int, cree_le timestamptz not null default now(),
  unique (webhook_id, evenement_id),
  foreign key (organisation_id, webhook_id) references webhooks(organisation_id, id)
);
create table budgets (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, branche_id uuid not null, annee int not null, compte_prefixe text not null check (compte_prefixe ~ '^[67][0-9]{0,11}$'), libelle text not null, montant bigint not null check (montant >= 0),
  unique (organisation_id, branche_id, annee, compte_prefixe),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id)
);
create table rapprochements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, portefeuille_id uuid not null, jour date not null, solde_releve bigint not null, solde_systeme bigint not null, note text, auteur_id uuid not null, cree_le timestamptz not null default now(),
  foreign key (organisation_id, portefeuille_id) references portefeuilles(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
do $$
declare t text;
begin
  foreach t in array array['kpi_suivis','alertes_kpi','cles_api','webhooks','livraisons_webhook','budgets','rapprochements'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
    execute format('grant select, insert, update on %I to erp_app', t);
  end loop;
end $$;
create trigger audit after insert or update on budgets for each row execute function audit_ligne();
create trigger audit after insert on rapprochements for each row execute function audit_ligne();
