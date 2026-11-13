-- SMARTE Coaching
create table coachs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, tiers_id uuid not null,
  utilisateur_id uuid, parent_id uuid,
  actif boolean not null default true,
  unique (organisation_id, id), unique (organisation_id, tiers_id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, utilisateur_id) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, parent_id) references coachs(organisation_id, id)
);
create table accompagnements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, coach_id uuid not null, tiers_id uuid not null,
  titre text not null, objectifs text, diagnostic text, plan_action text,
  consentement_le date not null,
  forfait_seances int check (forfait_seances > 0),
  progres int not null default 0 check (progres between 0 and 100),
  statut text not null default 'actif' check (statut in ('actif', 'termine', 'suspendu')),
  cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, coach_id) references coachs(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id)
);
create table seances_coaching (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, accompagnement_id uuid not null,
  debut timestamptz not null, duree_minutes int not null check (duree_minutes between 5 and 600),
  lien_visio text check (lien_visio like 'https://%'),
  statut text not null default 'planifiee' check (statut in ('planifiee', 'tenue', 'annulee')),
  foreign key (organisation_id, accompagnement_id) references accompagnements(organisation_id, id)
);
-- Chiffrées et sans audit détaillé : seul l'auteur les relit, jamais l'administration.
create table notes_coaching (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, accompagnement_id uuid not null, auteur_id uuid not null,
  contenu_chiffre text not null, cree_le timestamptz not null default now(),
  foreign key (organisation_id, accompagnement_id) references accompagnements(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create table niveaux_certification (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null,
  ordre int not null check (ordre between 1 and 20), nom text not null,
  heures_requises int not null check (heures_requises >= 0), supervisions_requises int not null check (supervisions_requises >= 0),
  unique (organisation_id, id), unique (organisation_id, entite_id, ordre),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create table parcours_certification (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, niveau_id uuid not null, tiers_id uuid not null,
  heures int not null default 0 check (heures >= 0), supervisions int not null default 0 check (supervisions >= 0),
  examen_reussi boolean not null default false, soutenance_reussie boolean not null default false,
  numero text, code_verification text unique, titulaire text, programme text, delivre_le date, revoque_le timestamptz, motif_revocation text,
  unique (organisation_id, id), unique (organisation_id, niveau_id, tiers_id),
  foreign key (organisation_id, niveau_id) references niveaux_certification(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id)
);
create table licences_coach (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, coach_id uuid not null,
  debut date not null, fin date not null, montant bigint not null check (montant >= 0), check (fin > debut),
  foreign key (organisation_id, coach_id) references coachs(organisation_id, id)
);
-- Le taux de chaque niveau de la cascade vient du contrat de licence : rien n'est prérempli.
create table regles_redevance (
  organisation_id uuid not null, entite_id uuid not null,
  profondeur int not null check (profondeur between 1 and 10), taux numeric(6,3) not null check (taux between 0 and 100),
  primary key (organisation_id, entite_id, profondeur),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create table revenus_coach (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, coach_id uuid not null,
  periode text not null check (periode ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), libelle text not null, montant bigint not null check (montant > 0),
  cree_par uuid not null, cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, coach_id) references coachs(organisation_id, id),
  foreign key (organisation_id, cree_par) references utilisateurs(organisation_id, id)
);
create table redevances (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, revenu_id uuid not null, beneficiaire_id uuid not null,
  profondeur int not null, taux numeric(6,3) not null, montant bigint not null,
  foreign key (organisation_id, revenu_id) references revenus_coach(organisation_id, id),
  foreign key (organisation_id, beneficiaire_id) references coachs(organisation_id, id)
);

-- IP2EL University
create table filieres (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null,
  code text not null, nom text not null, diplome text not null,
  credits_requis int not null check (credits_requis > 0),
  note_validation numeric(4,2) not null check (note_validation between 0 and 20),
  unique (organisation_id, id), unique (organisation_id, entite_id, code),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create table unites_enseignement (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, filiere_id uuid not null,
  code text not null, nom text not null, credits int not null check (credits > 0), semestre int not null check (semestre between 1 and 20),
  unique (organisation_id, id), unique (organisation_id, filiere_id, code),
  foreign key (organisation_id, filiere_id) references filieres(organisation_id, id)
);
create table candidatures_univ (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, filiere_id uuid not null, tiers_id uuid not null,
  annee text not null check (annee ~ '^[0-9]{4}-[0-9]{4}$'),
  statut text not null default 'soumise' check (statut in ('soumise', 'admise', 'refusee')),
  motif text, decide_par uuid, decide_le timestamptz, cree_le timestamptz not null default now(),
  unique (organisation_id, filiere_id, tiers_id, annee),
  foreign key (organisation_id, filiere_id) references filieres(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, decide_par) references utilisateurs(organisation_id, id)
);
create table inscriptions_univ (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, filiere_id uuid not null, tiers_id uuid not null,
  annee text not null, matricule text not null,
  unique (organisation_id, id), unique (organisation_id, filiere_id, tiers_id, annee), unique (organisation_id, matricule),
  foreign key (organisation_id, filiere_id) references filieres(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id)
);
create table notes_univ (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null, inscription_id uuid not null, ue_id uuid not null,
  session text not null check (session in ('normale', 'rattrapage')),
  note numeric(4,2) not null check (note between 0 and 20), saisi_par uuid not null,
  primary key (organisation_id, inscription_id, ue_id, session),
  foreign key (organisation_id, inscription_id) references inscriptions_univ(organisation_id, id),
  foreign key (organisation_id, ue_id) references unites_enseignement(organisation_id, id),
  foreign key (organisation_id, saisi_par) references utilisateurs(organisation_id, id)
);
create trigger audit after insert or update or delete on notes_univ for each row execute function audit_ligne();
-- Une délibération fige les notes de sa filière pour l'année, et garde le procès-verbal.
create table deliberations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, filiere_id uuid not null, annee text not null,
  session text not null check (session in ('normale', 'rattrapage')),
  resultats jsonb not null, president text not null, deliberee_par uuid not null, deliberee_le timestamptz not null default now(),
  unique (organisation_id, filiere_id, annee, session),
  foreign key (organisation_id, filiere_id) references filieres(organisation_id, id),
  foreign key (organisation_id, deliberee_par) references utilisateurs(organisation_id, id)
);
create table diplomes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, filiere_id uuid not null, tiers_id uuid not null,
  numero text not null, code_verification text not null unique, titulaire text not null, programme text not null,
  delivre_le date not null default current_date, revoque_le timestamptz, motif_revocation text,
  unique (organisation_id, filiere_id, tiers_id), unique (organisation_id, numero),
  foreign key (organisation_id, filiere_id) references filieres(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['coachs','accompagnements','seances_coaching','notes_coaching','niveaux_certification','parcours_certification',
    'licences_coach','regles_redevance','revenus_coach','redevances','filieres','unites_enseignement','candidatures_univ','inscriptions_univ',
    'notes_univ','deliberations','diplomes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
    execute format('grant select, insert, update on %I to erp_app', t);
  end loop;
end $$;
create trigger audit after insert or update or delete on parcours_certification for each row execute function audit_ligne();
create trigger audit after insert or update or delete on diplomes for each row execute function audit_ligne();
-- La note d'un coach ne change jamais après coup, et une ligne de redevance non plus.
grant delete on regles_redevance to erp_app;
revoke update on notes_coaching, redevances, deliberations from erp_app;
