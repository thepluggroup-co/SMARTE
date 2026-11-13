create table prix_grilles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, produit_id uuid not null, categorie text, debut date, fin date, prix bigint not null check (prix >= 0), auteur_id uuid not null, cree_le timestamptz not null default now(),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id)
);
alter table produits add column mode_palier text not null default 'ligne' check (mode_palier in ('ligne', 'tranches')), add column emplacement text;
create table taux_change (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, devise text not null check (devise ~ '^[A-Z]{3}$'), jour date not null, taux numeric(14,4) not null check (taux > 0), auteur_id uuid not null, unique (organisation_id, devise, jour)
);
create table preparations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, document_id uuid not null, statut text not null default 'en_cours' check (statut in ('en_cours', 'terminee')), lignes jsonb not null, auteur_id uuid not null, cree_le timestamptz not null default now(), unique (organisation_id, document_id),
  foreign key (organisation_id, document_id) references documents_vente(organisation_id, id)
);
create table rapports_sauves (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, utilisateur_id uuid not null, nom text not null, definition jsonb not null, cree_le timestamptz not null default now()
);
alter table regles_auto drop constraint regles_auto_action_check, add constraint regles_auto_action_check check (action in ('tache', 'ticket'));
alter table entites add column couleur text check (couleur ~ '^#[0-9a-fA-F]{6}$'), add column logo_url text check (logo_url like 'https://%');
create table plans_saas (code text primary key, nom text not null, prix_mensuel bigint not null, max_utilisateurs int);
insert into plans_saas values ('essentiel', 'Essentiel', 0, 10), ('croissance', 'Croissance', 0, 50), ('entreprise', 'Entreprise', 0, null);
create table abonnements (
  organisation_id uuid primary key references organisations(id), plan text not null references plans_saas(code), essai_fin date, prochaine_echeance date, notes text
);
alter table abonnements enable row level security;
create policy cloison on abonnements using (organisation_id = org_courante());
grant select on abonnements, plans_saas to erp_app;
do $$
declare t text;
begin
  foreach t in array array['prix_grilles','taux_change','preparations','rapports_sauves'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
    execute format('grant select, insert, update on %I to erp_app', t);
    execute format('create trigger audit after insert or update on %I for each row execute function audit_ligne()', t);
  end loop;
end $$;
grant delete on prix_grilles, rapports_sauves to erp_app;
