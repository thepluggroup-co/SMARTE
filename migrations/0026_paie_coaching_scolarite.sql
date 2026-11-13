alter table employes add column mode_paiement text check (mode_paiement in ('virement', 'mtn_momo', 'orange_money', 'especes')), add column compte_paiement_chiffre text;
create table versements_paie (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, bulletin_id uuid not null, portefeuille_id uuid not null, montant bigint not null, auteur_id uuid not null, cree_le timestamptz not null default now(),
  unique (organisation_id, bulletin_id),
  foreign key (organisation_id, portefeuille_id) references portefeuilles(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
alter table accompagnements add column code_client text unique;
create table creneaux_coaching (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, coach_id uuid not null, debut timestamptz not null, duree_minutes int not null check (duree_minutes between 5 and 600), lien_visio text check (lien_visio like 'https://%'), seance_id uuid,
  unique (organisation_id, coach_id, debut),
  foreign key (organisation_id, coach_id) references coachs(organisation_id, id)
);
create table frais_filiere (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, filiere_id uuid not null, annee text not null, libelle text not null, montant bigint not null check (montant > 0), echeance date not null,
  unique (organisation_id, id),
  foreign key (organisation_id, filiere_id) references filieres(organisation_id, id)
);
create table bourses_univ (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, inscription_id uuid not null, libelle text not null, montant bigint not null check (montant > 0), auteur_id uuid not null, cree_le timestamptz not null default now(),
  foreign key (organisation_id, inscription_id) references inscriptions_univ(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create table paiements_univ (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, inscription_id uuid not null, portefeuille_id uuid not null, montant bigint not null check (montant > 0), reference text, numero text not null, auteur_id uuid not null, annule_le timestamptz, motif_annulation text, cree_le timestamptz not null default now(),
  foreign key (organisation_id, inscription_id) references inscriptions_univ(organisation_id, id),
  foreign key (organisation_id, portefeuille_id) references portefeuilles(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create table cours_planifies (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, ue_id uuid not null, annee text not null, jour date not null, debut time not null, fin time not null, salle text, enseignant_id uuid,
  check (fin > debut), unique (organisation_id, id),
  foreign key (organisation_id, ue_id) references unites_enseignement(organisation_id, id),
  foreign key (organisation_id, enseignant_id) references utilisateurs(organisation_id, id)
);
create table presences_univ (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, cours_id uuid not null, inscription_id uuid not null, present boolean not null, saisi_par uuid not null,
  unique (organisation_id, cours_id, inscription_id),
  foreign key (organisation_id, cours_id) references cours_planifies(organisation_id, id),
  foreign key (organisation_id, inscription_id) references inscriptions_univ(organisation_id, id),
  foreign key (organisation_id, saisi_par) references utilisateurs(organisation_id, id)
);
do $$
declare t text;
begin
  foreach t in array array['versements_paie','creneaux_coaching','frais_filiere','bourses_univ','paiements_univ','cours_planifies','presences_univ'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
    execute format('grant select, insert, update on %I to erp_app', t);
    execute format('create trigger audit after insert or update on %I for each row execute function audit_ligne()', t);
  end loop;
end $$;
grant delete on creneaux_coaching, cours_planifies, frais_filiere to erp_app;
