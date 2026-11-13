create table factures_fournisseur (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, fournisseur_id uuid not null,
  numero_fournisseur text not null, numero text, commande_id uuid,
  date_facture date not null, date_echeance date,
  total_ht bigint not null, total_taxes bigint not null, total_ttc bigint not null,
  niu_fournisseur text,
  statut text not null default 'brouillon' check (statut in ('brouillon', 'validee', 'annulee')),
  motif_ecart text, motif_annulation text, annulee_le timestamptz,
  cree_par uuid not null, valide_par uuid, valide_le timestamptz, cree_le timestamptz not null default now(),
  unique (organisation_id, id), unique (organisation_id, numero), unique (organisation_id, fournisseur_id, numero_fournisseur),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, fournisseur_id) references tiers(organisation_id, id),
  foreign key (organisation_id, commande_id) references commandes_achat(organisation_id, id),
  foreign key (organisation_id, cree_par) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, valide_par) references utilisateurs(organisation_id, id)
);
create table lignes_facture_fournisseur (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, facture_id uuid not null, ordre int not null,
  designation text not null, compte_numero text not null,
  montant_ht bigint not null check (montant_ht > 0), montant_taxes bigint not null default 0 check (montant_taxes >= 0),
  foreign key (organisation_id, facture_id) references factures_fournisseur(organisation_id, id)
);
create table paiements_fournisseur (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, facture_id uuid not null, portefeuille_id uuid not null,
  montant bigint not null check (montant > 0), date_paiement date not null, reference text,
  annule_le timestamptz, motif_annulation text, auteur_id uuid not null, cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, facture_id) references factures_fournisseur(organisation_id, id),
  foreign key (organisation_id, portefeuille_id) references portefeuilles(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create table immobilisations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, branche_id uuid not null,
  code text not null, designation text not null, categorie text not null,
  compte_numero text not null, compte_amort text not null, compte_dotation text not null,
  date_acquisition date not null, date_service date not null,
  cout bigint not null check (cout > 0), valeur_residuelle bigint not null default 0 check (valeur_residuelle >= 0),
  duree_mois int not null check (duree_mois > 0), taux_fiscal numeric(6,3),
  facture_id uuid, cession_le date, cession_prix bigint, cree_par uuid not null, cree_le timestamptz not null default now(),
  unique (organisation_id, id), unique (organisation_id, branche_id, code),
  check (valeur_residuelle < cout),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id),
  foreign key (organisation_id, facture_id) references factures_fournisseur(organisation_id, id),
  foreign key (organisation_id, cree_par) references utilisateurs(organisation_id, id)
);
-- Une dotation par bien et par année : la relance ne double jamais la charge.
create table dotations_immobilisation (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, immobilisation_id uuid not null, annee int not null, montant bigint not null check (montant > 0),
  unique (organisation_id, immobilisation_id, annee),
  foreign key (organisation_id, immobilisation_id) references immobilisations(organisation_id, id)
);
-- Le passage au résultat fiscal et ses taux sont saisis et relus : le système ne décide pas à la place de l'expert.
create table preparations_dsf (
  organisation_id uuid not null, branche_id uuid not null, annee int not null,
  centre text not null check (centre in ('dge', 'cime', 'cdi')),
  reintegrations jsonb not null default '[]', deductions jsonb not null default '[]',
  deficit_anterieur bigint not null default 0, taux_is numeric(6,3), taux_cac numeric(6,3),
  minimum_du bigint not null default 0, acomptes bigint not null default 0,
  relue_par text, relue_le date, maj_le timestamptz not null default now(),
  primary key (organisation_id, branche_id, annee),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id)
);
do $$
declare t text;
begin
  foreach t in array array['factures_fournisseur', 'lignes_facture_fournisseur', 'paiements_fournisseur', 'immobilisations', 'dotations_immobilisation', 'preparations_dsf'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
    execute format('grant select, insert, update on %I to erp_app', t);
  end loop;
end $$;
grant delete on factures_fournisseur, lignes_facture_fournisseur to erp_app;
create trigger audit after insert or update or delete on factures_fournisseur for each row execute function audit_ligne();
create trigger audit after insert or update on paiements_fournisseur for each row execute function audit_ligne();
create trigger audit after insert or update on immobilisations for each row execute function audit_ligne();
