-- GLOMARI Care
alter table produits add column garantie_mois int check (garantie_mois >= 0), add column paliers_actif boolean not null default false;
create table dossiers_sav (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, numero text not null, tiers_id uuid not null, produit_id uuid, numero_serie text, reference_achat text,
  date_achat date, canal text not null default 'magasin' check (canal in ('telephone', 'whatsapp', 'email', 'site', 'application', 'magasin')),
  demande text not null check (demande in ('retour', 'echange', 'remboursement', 'reparation')), motif text not null, quantite numeric(14,3) not null default 1 check (quantite > 0),
  sous_garantie boolean, echeance date not null, statut text not null default 'ouvert' check (statut in ('ouvert', 'autorise', 'recu', 'decide', 'clos', 'refuse')),
  decision text check (decision in ('remise_stock', 'rebut', 'reparation', 'remplacement', 'avoir', 'remboursement')), montant_rembourse bigint not null default 0, portefeuille_id uuid,
  fournisseur_id uuid, a_refacturer bigint not null default 0, note text, cree_par uuid not null, cree_le timestamptz not null default now(), clos_le timestamptz,
  unique (organisation_id, id), unique (organisation_id, numero),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id),
  foreign key (organisation_id, portefeuille_id) references portefeuilles(organisation_id, id),
  foreign key (organisation_id, fournisseur_id) references tiers(organisation_id, id),
  foreign key (organisation_id, cree_par) references utilisateurs(organisation_id, id)
);
-- Marketing
create table campagnes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, nom text not null, canal text not null, debut date, fin date,
  cout bigint not null default 0 check (cout >= 0), contacts int not null default 0 check (contacts >= 0), cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create table ventes_campagne (
  organisation_id uuid not null, document_id uuid not null, campagne_id uuid not null,
  primary key (organisation_id, document_id),
  foreign key (organisation_id, document_id) references documents_vente(organisation_id, id),
  foreign key (organisation_id, campagne_id) references campagnes(organisation_id, id)
);
-- Avis de tout le groupe
create table demandes_retour (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, code text not null unique, cible_type text not null check (cible_type in ('produit', 'vendeur', 'livraison', 'magasin', 'sav', 'autre')),
  cible text not null, source_type text not null check (source_type in ('facture', 'colis', 'sav')), source_id uuid not null, tiers_id uuid, repondu_le timestamptz, cree_le timestamptz not null default now(),
  unique (organisation_id, id), unique (organisation_id, source_type, source_id, cible_type),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id)
);
create table retours_clients (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, demande_id uuid not null unique, note int not null check (note between 1 and 5), commentaire text, temoignage boolean not null default false,
  statut text not null check (statut in ('publie', 'a_moderer', 'masque')), motif_moderation text, reponse text, cree_le timestamptz not null default now(),
  foreign key (organisation_id, demande_id) references demandes_retour(organisation_id, id)
);
-- Commerce
create table paliers_prix (
  organisation_id uuid not null, produit_id uuid not null, quantite_min numeric(14,3) not null check (quantite_min > 1), prix bigint not null check (prix >= 0),
  primary key (organisation_id, produit_id, quantite_min),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id)
);
create table comptes_pro (
  organisation_id uuid not null, tiers_id uuid not null, categorie text not null check (categorie in ('grossiste', 'demi_grossiste', 'detaillant', 'revendeur', 'entreprise', 'institution')),
  plafond_credit bigint not null default 0 check (plafond_credit >= 0), delai_jours int not null default 0 check (delai_jours >= 0), verifie_le date,
  primary key (organisation_id, tiers_id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id)
);
create table vendeurs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, tiers_id uuid not null, taux_commission numeric(6,3) not null check (taux_commission between 0 and 100),
  statut text not null default 'candidat' check (statut in ('candidat', 'verifie', 'suspendu')), verifie_le date,
  unique (organisation_id, id), unique (organisation_id, entite_id, tiers_id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id)
);
create table commandes_vendeur (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, vendeur_id uuid not null, reference text not null, montant bigint not null check (montant > 0), taux numeric(6,3) not null, commission bigint not null, retenue bigint not null default 0 check (retenue >= 0),
  statut text not null default 'recue' check (statut in ('recue', 'livree', 'litige', 'reversee', 'annulee')), portefeuille_id uuid, reverse_le timestamptz, motif text,
  unique (organisation_id, vendeur_id, reference),
  foreign key (organisation_id, vendeur_id) references vendeurs(organisation_id, id),
  foreign key (organisation_id, portefeuille_id) references portefeuilles(organisation_id, id)
);
create table franchises (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, tiers_id uuid not null, ville text,
  statut text not null default 'candidature' check (statut in ('candidature', 'etude', 'contrat', 'actif', 'resilie')), droit_entree bigint not null default 0, taux_redevance numeric(6,3) not null default 0 check (taux_redevance between 0 and 100), fin_contrat date,
  unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id)
);
create table ventes_franchise (
  organisation_id uuid not null, franchise_id uuid not null, periode text not null check (periode ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), ventes bigint not null check (ventes >= 0), taux numeric(6,3) not null, redevance bigint not null, payee_le timestamptz, score_audit int check (score_audit between 0 and 100),
  primary key (organisation_id, franchise_id, periode),
  foreign key (organisation_id, franchise_id) references franchises(organisation_id, id)
);
-- Évaluation
alter table employes add column utilisateur_id uuid, add foreign key (organisation_id, utilisateur_id) references utilisateurs(organisation_id, id);
create table regles_evaluation (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, poste text not null, kpi text not null, poids int not null check (poids between 1 and 100), cible numeric(18,2) not null check (cible >= 0),
  unique (organisation_id, entite_id, poste, kpi),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create table evaluations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, employe_id uuid not null, periode text not null check (periode ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), lignes jsonb not null, score int not null,
  statut text not null default 'brouillon' check (statut in ('brouillon', 'partagee', 'contestee', 'close')), commentaire_responsable text, commentaire_employe text, cree_par uuid not null, cree_le timestamptz not null default now(),
  unique (organisation_id, employe_id, periode),
  foreign key (organisation_id, employe_id) references employes(organisation_id, id),
  foreign key (organisation_id, cree_par) references utilisateurs(organisation_id, id)
);
do $$
declare t text;
begin
  foreach t in array array['dossiers_sav','campagnes','ventes_campagne','demandes_retour','retours_clients','paliers_prix','comptes_pro','vendeurs','commandes_vendeur','franchises','ventes_franchise','regles_evaluation','evaluations'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
    execute format('grant select, insert, update on %I to erp_app', t);
  end loop;
end $$;
grant delete on paliers_prix, regles_evaluation to erp_app;
create trigger audit after insert or update on dossiers_sav for each row execute function audit_ligne();
create trigger audit after insert or update on commandes_vendeur for each row execute function audit_ligne();
create trigger audit after insert or update on retours_clients for each row execute function audit_ligne();
