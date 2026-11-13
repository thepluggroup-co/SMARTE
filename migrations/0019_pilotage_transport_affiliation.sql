-- Pilotage : objectifs, projets, registre
create table objectifs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, parent_id uuid,
  titre text not null, periode text not null check (periode ~ '^[0-9]{4}-T[1-4]$'), responsable text,
  cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, parent_id) references objectifs(organisation_id, id)
);
create table resultats_cles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, objectif_id uuid not null,
  libelle text not null, unite text, depart numeric(18,2) not null default 0, cible numeric(18,2) not null, actuel numeric(18,2) not null default 0,
  check (cible <> depart),
  foreign key (organisation_id, objectif_id) references objectifs(organisation_id, id)
);
create table projets (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null,
  nom text not null, responsable text, debut date, fin date, budget bigint not null default 0 check (budget >= 0),
  statut text not null default 'actif' check (statut in ('actif', 'suspendu', 'termine')), cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create table taches_projet (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, projet_id uuid not null,
  titre text not null, responsable text, debut date, fin date, jalon boolean not null default false,
  statut text not null default 'a_faire' check (statut in ('a_faire', 'en_cours', 'termine')),
  unique (organisation_id, id),
  foreign key (organisation_id, projet_id) references projets(organisation_id, id)
);
create table temps_projet (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, tache_id uuid not null, jour date not null, minutes int not null check (minutes between 1 and 1440), auteur_id uuid not null,
  foreign key (organisation_id, tache_id) references taches_projet(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create table depenses_projet (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, projet_id uuid not null, libelle text not null, montant bigint not null check (montant > 0), jour date not null, auteur_id uuid not null,
  foreign key (organisation_id, projet_id) references projets(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create table registre_pilotage (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null,
  type text not null check (type in ('risque', 'non_conformite', 'incident', 'decision')),
  titre text not null, description text, probabilite int check (probabilite between 1 and 5), impact int check (impact between 1 and 5),
  plan_action text, responsable text, echeance date,
  statut text not null default 'ouvert' check (statut in ('ouvert', 'en_cours', 'clos')), cree_par uuid not null, cree_le timestamptz not null default now(),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, cree_par) references utilisateurs(organisation_id, id)
);
-- Transport
create table zones_livraison (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, nom text not null, frais bigint not null check (frais >= 0), delai_jours int not null check (delai_jours >= 0),
  unique (organisation_id, id), unique (organisation_id, entite_id, nom),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create table vehicules (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, immatriculation text not null, modele text, actif boolean not null default true,
  unique (organisation_id, id), unique (organisation_id, immatriculation),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create table frais_vehicule (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, vehicule_id uuid not null,
  type text not null check (type in ('carburant', 'maintenance', 'assurance', 'document', 'autre')),
  montant bigint not null check (montant >= 0), jour date not null, kilometrage int check (kilometrage >= 0), echeance date, note text,
  foreign key (organisation_id, vehicule_id) references vehicules(organisation_id, id)
);
create table tournees (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, jour date not null, livreur text not null, vehicule_id uuid,
  remise_le timestamptz, remise_attendue bigint, remise_comptee bigint, motif_ecart text,
  unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, vehicule_id) references vehicules(organisation_id, id)
);
create table colis (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null,
  numero text not null, code_suivi text not null unique, code_confirmation text not null,
  destinataire text not null, telephone text, adresse text, zone_id uuid, transporteur text, document_id uuid, tournee_id uuid,
  a_encaisser bigint not null default 0 check (a_encaisser >= 0), encaisse bigint not null default 0,
  statut text not null default 'prepare' check (statut in ('prepare', 'expedie', 'en_transit', 'arrive', 'en_livraison', 'livre', 'echec', 'retour')),
  livre_a text, livre_le timestamptz, prevu_le date, cree_le timestamptz not null default now(),
  unique (organisation_id, id), unique (organisation_id, numero),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, zone_id) references zones_livraison(organisation_id, id),
  foreign key (organisation_id, document_id) references documents_vente(organisation_id, id),
  foreign key (organisation_id, tournee_id) references tournees(organisation_id, id)
);
create table etapes_colis (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, colis_id uuid not null, statut text not null, note text, auteur_id uuid, le timestamptz not null default now(),
  foreign key (organisation_id, colis_id) references colis(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
-- Affiliation
create table affilies (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, tiers_id uuid not null,
  code text not null, taux numeric(6,3) not null check (taux between 0 and 100), jours_retour int not null default 0 check (jours_retour between 0 and 365),
  actif boolean not null default true, cree_le timestamptz not null default now(),
  unique (organisation_id, id), unique (organisation_id, code), unique (organisation_id, entite_id, tiers_id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id)
);
create table commissions_affilie (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, affilie_id uuid not null, facture_id uuid not null,
  base bigint not null, taux numeric(6,3) not null, montant bigint not null,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'validee', 'payee', 'annulee')),
  disponible_le date not null, portefeuille_id uuid, reference text, motif text, cree_le timestamptz not null default now(), paye_le timestamptz,
  unique (organisation_id, facture_id),
  foreign key (organisation_id, affilie_id) references affilies(organisation_id, id),
  foreign key (organisation_id, facture_id) references documents_vente(organisation_id, id),
  foreign key (organisation_id, portefeuille_id) references portefeuilles(organisation_id, id)
);
do $$
declare t text;
begin
  foreach t in array array['objectifs','resultats_cles','projets','taches_projet','temps_projet','depenses_projet','registre_pilotage','zones_livraison','vehicules','frais_vehicule','tournees','colis','etapes_colis','affilies','commissions_affilie'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
    execute format('grant select, insert, update on %I to erp_app', t);
  end loop;
end $$;
revoke update on etapes_colis from erp_app;
create trigger audit after insert or update on colis for each row execute function audit_ligne();
create trigger audit after insert or update on commissions_affilie for each row execute function audit_ligne();
create trigger audit after insert or update on registre_pilotage for each row execute function audit_ligne();
