create table attente_session (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, session_id uuid not null, tiers_id uuid not null, statut text not null default 'attente' check (statut in ('attente', 'inscrit', 'retire')), cree_le timestamptz not null default now(),
  foreign key (organisation_id, session_id) references sessions_formation(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id)
);
create unique index attente_unique on attente_session (organisation_id, session_id, tiers_id) where statut = 'attente';
create table codes_promo (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, code text not null, type text not null check (type in ('pourcentage', 'montant')), valeur bigint not null check (valeur > 0), debut date not null, fin date not null, max_usages int, usages int not null default 0, actif boolean not null default true,
  check (fin >= debut), check (type <> 'pourcentage' or valeur <= 100), unique (organisation_id, entite_id, code),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create table usages_code_promo (
  organisation_id uuid not null, code_id uuid not null, inscription_id uuid not null, remise bigint not null, auteur_id uuid not null, cree_le timestamptz not null default now(),
  id uuid primary key default gen_random_uuid(), unique (organisation_id, inscription_id),
  foreign key (organisation_id, inscription_id) references inscriptions(organisation_id, id)
);
create table couts_session (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, session_id uuid not null, nature text not null check (nature in ('salle', 'formateur', 'supports', 'publicite', 'autre')), libelle text not null, montant bigint not null check (montant > 0), auteur_id uuid not null, cree_le timestamptz not null default now(),
  foreign key (organisation_id, session_id) references sessions_formation(organisation_id, id)
);
create table evaluations_session (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, inscription_id uuid not null, type text not null check (type in ('test_debut', 'test_fin', 'remarque')), note numeric(4,1) check (note between 0 and 20), commentaire text, auteur_id uuid not null, cree_le timestamptz not null default now(),
  foreign key (organisation_id, inscription_id) references inscriptions(organisation_id, id)
);
create table demandes_b2b (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, tiers_id uuid not null, besoin text not null, effectif int, statut text not null default 'recue' check (statut in ('recue', 'devis', 'planifiee', 'realisee', 'abandonnee')), rapport text, session_id uuid, cree_le timestamptz not null default now(),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, session_id) references sessions_formation(organisation_id, id)
);
create table banque_questions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, theme text not null, niveau int not null default 1 check (niveau between 1 and 5), enonce text not null, choix jsonb not null, bonne int not null, explication text, cree_le timestamptz not null default now(),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create table devoirs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, cours_id uuid not null, titre text not null, consigne text not null, echeance date, unique (organisation_id, id),
  foreign key (organisation_id, cours_id) references cours(organisation_id, id)
);
create table rendus_devoir (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, devoir_id uuid not null, acces_id uuid not null, contenu text not null, note numeric(4,1) check (note between 0 and 20), commentaire text, corrige_par uuid, rendu_le timestamptz not null default now(),
  unique (organisation_id, devoir_id, acces_id),
  foreign key (organisation_id, devoir_id) references devoirs(organisation_id, id)
);
create table questions_cours (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, cours_id uuid not null, acces_id uuid not null, auteur text not null, question text not null, reponse text, repondu_par uuid, cree_le timestamptz not null default now(),
  foreign key (organisation_id, cours_id) references cours(organisation_id, id)
);
create table parcours_cours (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, nom text not null, cours uuid[] not null, cree_le timestamptz not null default now(), unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create table membres_parcours (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, parcours_id uuid not null, tiers_id uuid not null, unique (organisation_id, parcours_id, tiers_id),
  foreign key (organisation_id, parcours_id) references parcours_cours(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id)
);
alter table cours add column en_boutique boolean not null default false, add column prix bigint not null default 0 check (prix >= 0);
do $$
declare t text;
begin
  foreach t in array array['attente_session','codes_promo','usages_code_promo','couts_session','evaluations_session','demandes_b2b','banque_questions','devoirs','rendus_devoir','questions_cours','parcours_cours','membres_parcours'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
    execute format('grant select, insert, update on %I to erp_app', t);
    execute format('create trigger audit after insert or update on %I for each row execute function audit_ligne()', t);
  end loop;
end $$;
