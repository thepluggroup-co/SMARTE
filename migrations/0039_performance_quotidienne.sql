-- Performance au quotidien : objectifs du jour, rapport, score, problèmes rencontrés, solutions proposées.
-- Aide à la décision seulement : aucune sanction automatique, aucune surveillance d'écran ni de localisation.

-- Responsable direct, pour les notifications, l'escalade et l'exclusion des cas sensibles.
alter table employes add column responsable_id uuid,
  add foreign key (organisation_id, responsable_id) references employes(organisation_id, id),
  add check (responsable_id is null or responsable_id <> id);

-- A. Modèles d'objectifs par poste et par entité
create table modeles_objectifs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, poste text not null check (length(poste) between 1 and 200),
  libelle text not null check (length(libelle) between 1 and 200),
  type text not null check (type in ('mesure_systeme', 'chiffre_declare', 'tache')),
  kpi text, cible numeric(14,2) not null check (cible >= 0), poids int not null check (poids between 1 and 100),
  actif boolean not null default true, auteur_id uuid not null, cree_le timestamptz not null default now(),
  check ((type = 'mesure_systeme') = (kpi is not null)),
  unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);

create table objectifs_jour (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, employe_id uuid not null, jour date not null,
  modele_id uuid, origine text not null check (origine in ('modele', 'personnel')),
  libelle text not null check (length(libelle) between 1 and 200),
  type text not null check (type in ('mesure_systeme', 'chiffre_declare', 'tache')),
  kpi text, cible numeric(14,2) not null check (cible >= 0), cible_initiale numeric(14,2) not null, poids int not null check (poids between 1 and 100),
  realise_declare numeric(14,2) check (realise_declare >= 0), declare_le timestamptz,
  valide boolean not null default false, valide_par uuid, valide_le timestamptz,
  motif_ajustement text, ajuste_par uuid, ajuste_le timestamptz,
  cree_le timestamptz not null default now(),
  check ((type = 'mesure_systeme') = (kpi is not null)),
  check (cible = cible_initiale or motif_ajustement is not null),
  unique (organisation_id, id),
  foreign key (organisation_id, employe_id) references employes(organisation_id, id),
  foreign key (organisation_id, modele_id) references modeles_objectifs(organisation_id, id),
  foreign key (organisation_id, valide_par) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, ajuste_par) references utilisateurs(organisation_id, id)
);
create unique index objectifs_jour_modele on objectifs_jour (organisation_id, employe_id, jour, modele_id) where modele_id is not null;
create index objectifs_jour_employe on objectifs_jour (organisation_id, employe_id, jour);

-- B. Rapport du jour : figé une fois remis, corrigé seulement par une nouvelle version motivée.
create table rapports_jour (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, employe_id uuid not null, jour date not null, version int not null default 1 check (version >= 1),
  statut text not null default 'brouillon' check (statut in ('brouillon', 'remis')),
  contenu jsonb not null default '{}', motif_version text, remis_le timestamptz, auteur_id uuid not null,
  cree_le timestamptz not null default now(),
  check (version = 1 or motif_version is not null),
  check ((statut = 'remis') = (remis_le is not null)),
  unique (organisation_id, id), unique (organisation_id, employe_id, jour, version),
  foreign key (organisation_id, employe_id) references employes(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create function rapport_fige() returns trigger language plpgsql as $$
begin
  if old.statut = 'remis' then raise exception 'rapport remis : il ne se modifie plus' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger rapport_fige before update or delete on rapports_jour for each row execute function rapport_fige();

-- C. Score du jour : calculé, puis validé, commenté ou corrigé par le responsable, contestable par le collaborateur.
create table scores_jour (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, employe_id uuid not null, jour date not null,
  score_calcule int not null check (score_calcule between 0 and 100), score int not null check (score between 0 and 100),
  detail jsonb not null, statut text not null default 'calcule' check (statut in ('calcule', 'valide', 'corrige', 'conteste')),
  commentaire_responsable text, motif_correction text, decide_par uuid, decide_le timestamptz,
  contestation text, conteste_le timestamptz, maj_le timestamptz not null default now(),
  check (statut <> 'corrige' or motif_correction is not null),
  unique (organisation_id, id), unique (organisation_id, employe_id, jour),
  foreign key (organisation_id, employe_id) references employes(organisation_id, id),
  foreign key (organisation_id, decide_par) references utilisateurs(organisation_id, id)
);

-- D. Problèmes rencontrés. Les tickets existants sont liés à un client : une table dédiée s'impose.
create table delais_problemes (
  organisation_id uuid not null, branche_id uuid not null,
  normal_h int not null default 48 check (normal_h between 1 and 720),
  important_h int not null default 24 check (important_h between 1 and 720),
  urgent_h int not null default 2 check (urgent_h between 1 and 720),
  primary key (organisation_id, branche_id),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id)
);

create table problemes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, employe_id uuid not null, auteur_id uuid not null, jour date not null,
  categorie text not null check (categorie in ('client', 'stock', 'caisse', 'materiel', 'informatique', 'logistique', 'fournisseur', 'securite', 'harcelement', 'equipe', 'conflit_responsable', 'autre')),
  sensible boolean generated always as (categorie in ('securite', 'harcelement', 'conflit_responsable')) stored,
  description text not null check (length(description) between 3 and 5000),
  impact text check (length(impact) <= 2000), aide_attendue text check (length(aide_attendue) <= 2000),
  destinataire text not null check (destinataire in ('responsable', 'rh', 'finance', 'logistique', 'informatique', 'direction')),
  priorite text not null default 'normal' check (priorite in ('normal', 'important', 'urgent')), motif_urgence text,
  statut text not null default 'signale' check (statut in ('signale', 'pris_en_charge', 'en_cours', 'resolu', 'clos')),
  echeance timestamptz not null, pris_en_charge_par uuid, pris_en_charge_le timestamptz,
  niveau_escalade int not null default 0, escalade_le timestamptz, resolu_le timestamptz, clos_le timestamptz, reouvert int not null default 0,
  responsable_concerne uuid,
  cree_le timestamptz not null default now(),
  check (priorite <> 'urgent' or motif_urgence is not null),
  unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, employe_id) references employes(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, pris_en_charge_par) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, responsable_concerne) references utilisateurs(organisation_id, id)
);
create index problemes_entite on problemes (organisation_id, entite_id, statut);

create table commentaires_probleme (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, probleme_id uuid not null, auteur_id uuid not null,
  texte text not null check (length(texte) between 1 and 3000), cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, probleme_id) references problemes(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);

-- Ce qui arrive au problème : prise en charge, priorité changée, escalade, réouverture. Jamais modifié.
create table historique_probleme (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, probleme_id uuid not null, action text not null, details jsonb not null default '{}',
  auteur_id uuid, cree_le timestamptz not null default now(),
  foreign key (organisation_id, probleme_id) references problemes(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);

-- E. Solutions proposées et leur mise en œuvre. Une solution ne déclenche aucune dépense.
create table solutions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, probleme_id uuid not null, auteur_id uuid not null, employe_id uuid,
  description text not null check (length(description) between 3 and 5000),
  moyens text check (length(moyens) <= 2000), cout_estime bigint check (cout_estime >= 0),
  delai text check (length(delai) <= 200), resultat_attendu text check (length(resultat_attendu) <= 2000),
  decision text not null default 'en_attente' check (decision in ('en_attente', 'acceptee', 'acceptee_modifiee', 'a_etudier', 'refusee')),
  note int check (note between 1 and 5), motif text, modifications text, date_reexamen date,
  decide_par uuid, decide_le timestamptz, cree_le timestamptz not null default now(),
  check (decision = 'en_attente' or note is not null),
  check (decision <> 'refusee' or motif is not null),
  check (decision <> 'a_etudier' or date_reexamen is not null),
  unique (organisation_id, id),
  foreign key (organisation_id, probleme_id) references problemes(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, employe_id) references employes(organisation_id, id),
  foreign key (organisation_id, decide_par) references utilisateurs(organisation_id, id)
);

create table actions_solution (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, solution_id uuid not null, responsable_id uuid not null, echeance date not null,
  statut text not null default 'prevue' check (statut in ('prevue', 'en_cours', 'realisee')),
  efficace boolean, evalue_le timestamptz, cree_le timestamptz not null default now(),
  check (efficace is null or statut = 'realisee'),
  unique (organisation_id, id), unique (organisation_id, solution_id),
  foreign key (organisation_id, solution_id) references solutions(organisation_id, id),
  foreign key (organisation_id, responsable_id) references utilisateurs(organisation_id, id)
);

-- F. Poids de la force de proposition, par poste. Sans réglage : 20, 30, 20, 20, 10.
create table poids_force_proposition (
  organisation_id uuid not null, entite_id uuid not null, poste text not null,
  reflexe int not null, qualite int not null, acceptation int not null, efficacite int not null, contribution int not null,
  check (reflexe >= 0 and qualite >= 0 and acceptation >= 0 and efficacite >= 0 and contribution >= 0),
  check (reflexe + qualite + acceptation + efficacite + contribution = 100),
  primary key (organisation_id, entite_id, poste),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);

-- Pièces jointes du rapport, des problèmes, des commentaires et des solutions, stockées comme les documents.
create table pieces_performance (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, objet_type text not null check (objet_type in ('rapport', 'probleme', 'commentaire', 'solution')), objet_id uuid not null,
  nom text not null, fichier text not null, type_mime text not null, taille bigint not null, empreinte text not null,
  auteur_id uuid not null, cree_le timestamptz not null default now(),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create index pieces_performance_objet on pieces_performance (organisation_id, objet_type, objet_id);

-- Notifications adressées à une personne. La clé évite d'envoyer deux fois le même rappel.
create table notifications_personnes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, utilisateur_id uuid not null, cle text not null,
  niveau text not null default 'info' check (niveau in ('info', 'important', 'urgent')),
  texte text not null, objet_type text, objet_id uuid, lu_le timestamptz, cree_le timestamptz not null default now(),
  unique (organisation_id, utilisateur_id, cle),
  foreign key (organisation_id, utilisateur_id) references utilisateurs(organisation_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['modeles_objectifs', 'objectifs_jour', 'rapports_jour', 'scores_jour', 'delais_problemes', 'problemes',
    'commentaires_probleme', 'historique_probleme', 'solutions', 'actions_solution', 'poids_force_proposition', 'pieces_performance', 'notifications_personnes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
  end loop;
  foreach t in array array['modeles_objectifs', 'objectifs_jour', 'rapports_jour', 'scores_jour', 'problemes', 'solutions', 'actions_solution'] loop
    execute format('create trigger audit after insert or update or delete on %I for each row execute function audit_ligne()', t);
  end loop;
end $$;

grant select, insert, update on modeles_objectifs, objectifs_jour, scores_jour, delais_problemes, problemes, solutions, actions_solution,
  poids_force_proposition, notifications_personnes to erp_app;
grant select, insert, update, delete on rapports_jour to erp_app;
grant select, insert on commentaires_probleme, historique_probleme, pieces_performance to erp_app;
grant delete on objectifs_jour to erp_app;
