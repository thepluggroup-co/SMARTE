create table documents_ged (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, groupe_id uuid not null, version int not null default 1,
  titre text not null, categorie text not null check (categorie in ('general', 'contrat', 'rh', 'compta')), tiers_id uuid,
  fichier text not null, type_mime text not null, taille bigint not null, empreinte text not null, auteur_id uuid not null, archive_le timestamptz, motif_archive text, cree_le timestamptz not null default now(),
  unique (organisation_id, id), unique (organisation_id, groupe_id, version),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create table ressources (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, nom text not null, type text not null check (type in ('salle', 'vehicule', 'equipement', 'formateur')), capacite int, actif boolean not null default true,
  unique (organisation_id, id), unique (organisation_id, entite_id, nom),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create table reservations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, ressource_id uuid not null, debut timestamptz not null, fin timestamptz not null, objet text not null, auteur_id uuid not null, annule_le timestamptz, cree_le timestamptz not null default now(),
  check (fin > debut),
  foreign key (organisation_id, ressource_id) references ressources(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create unique index employe_compte_unique on employes (organisation_id, utilisateur_id) where utilisateur_id is not null;
create table notes_frais (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, employe_id uuid not null, jour date not null, categorie text not null check (categorie in ('transport', 'repas', 'hebergement', 'communication', 'autre')), libelle text not null, montant bigint not null check (montant > 0),
  document_id uuid, statut text not null default 'soumise' check (statut in ('soumise', 'approuvee', 'refusee', 'payee')), decide_par uuid, motif_refus text, portefeuille_id uuid, paye_par uuid, paye_le timestamptz, cree_le timestamptz not null default now(),
  foreign key (organisation_id, employe_id) references employes(organisation_id, id),
  foreign key (organisation_id, document_id) references documents_ged(organisation_id, id),
  foreign key (organisation_id, decide_par) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, portefeuille_id) references portefeuilles(organisation_id, id)
);
create table offres_emploi (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, titre text not null, description text not null, lieu text, type_contrat text not null, code text not null unique, ouverte boolean not null default true, cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create table candidatures (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, offre_id uuid not null, nom text not null, telephone text, email text, presentation text, lien_cv text,
  etape text not null default 'recue' check (etape in ('recue', 'preselection', 'entretien', 'retenue', 'refusee', 'embauchee')), note text, employe_id uuid, consentement_le timestamptz not null default now(), cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, offre_id) references offres_emploi(organisation_id, id),
  foreign key (organisation_id, employe_id) references employes(organisation_id, id)
);
create table entretiens (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, candidature_id uuid not null, quand timestamptz not null, lieu text, intervenant_id uuid not null, compte_rendu text,
  foreign key (organisation_id, candidature_id) references candidatures(organisation_id, id),
  foreign key (organisation_id, intervenant_id) references utilisateurs(organisation_id, id)
);
create table promotions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, produit_id uuid not null, nom text not null, type text not null check (type in ('pourcentage', 'montant')), valeur bigint not null check (valeur > 0), debut date not null, fin date not null, actif boolean not null default true, auteur_id uuid not null, cree_le timestamptz not null default now(),
  check (fin >= debut), check (type <> 'pourcentage' or valeur <= 100),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
do $$
declare t text;
begin
  foreach t in array array['documents_ged','ressources','reservations','notes_frais','offres_emploi','candidatures','entretiens','promotions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
    execute format('grant select, insert, update on %I to erp_app', t);
    execute format('create trigger audit after insert or update on %I for each row execute function audit_ligne()', t);
  end loop;
end $$;
