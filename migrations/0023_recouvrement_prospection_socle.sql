create table parametres_recouvrement (
  organisation_id uuid not null, branche_id uuid not null, seuil_blocage int not null default 60 check (seuil_blocage > 0), seuil_douteuse int not null default 90 check (seuil_douteuse > 0), modeles jsonb not null default '{}',
  primary key (organisation_id, branche_id),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id)
);
create table relances (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, branche_id uuid not null, source_type text not null check (source_type in ('facture', 'echeance')), source_id uuid not null, tiers_id uuid not null,
  niveau text not null check (niveau in ('avant', 'rappel', 'mise_en_demeure')), canal text not null check (canal in ('whatsapp', 'sms', 'email', 'appel', 'courrier')), texte text not null, reste bigint not null, auteur_id uuid not null, cree_le timestamptz not null default now(),
  unique (organisation_id, source_type, source_id, niveau),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create table plans_paiement (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, facture_id uuid not null, motif text not null, echeances jsonb not null, actif boolean not null default true, auteur_id uuid not null, arrete_le timestamptz, cree_le timestamptz not null default now(),
  foreign key (organisation_id, facture_id) references documents_vente(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create unique index plan_actif_unique on plans_paiement (organisation_id, facture_id) where actif;
create table blocages_tiers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, tiers_id uuid not null, portee text not null check (portee in ('livraison', 'cours', 'certificat')), motif text not null, auteur_id uuid not null, leve_par uuid, leve_le timestamptz, cree_le timestamptz not null default now(),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, leve_par) references utilisateurs(organisation_id, id)
);
create unique index blocage_actif_unique on blocages_tiers (organisation_id, tiers_id, portee) where leve_le is null;
create table creances_douteuses (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, facture_id uuid not null, branche_id uuid not null, tiers_id uuid not null,
  statut text not null default 'douteuse' check (statut in ('douteuse', 'perte_demandee', 'perte')), provision bigint not null default 0 check (provision >= 0), motif text not null, jour_provision date not null,
  motif_perte text, montant_perte bigint, demande_par uuid, valide_par uuid, jour_perte date, cree_par uuid not null,
  unique (organisation_id, facture_id),
  foreign key (organisation_id, facture_id) references documents_vente(organisation_id, id),
  foreign key (organisation_id, demande_par) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, valide_par) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, cree_par) references utilisateurs(organisation_id, id)
);
create table factures_recurrentes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, tiers_id uuid not null, libelle text not null, lignes jsonb not null, jour int not null check (jour between 1 and 28), prochaine date not null, fin date, delai_jours int not null default 0 check (delai_jours between 0 and 365), actif boolean not null default true, auteur_id uuid not null, cree_le timestamptz not null default now(),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create table formulaires_capture (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null, titre text not null, introduction text, source text not null, code text not null unique, actif boolean not null default true, responsable_id uuid not null, cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, responsable_id) references utilisateurs(organisation_id, id)
);
create table captures (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, formulaire_id uuid not null, tiers_id uuid not null, consentement_le timestamptz not null default now(),
  foreign key (organisation_id, formulaire_id) references formulaires_capture(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id)
);
create table segments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, branche_id uuid not null, nom text not null, criteres jsonb not null, cree_le timestamptz not null default now(),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id)
);
create table regles_separation (
  organisation_id uuid primary key references organisations(id),
  ecritures boolean not null default false, commandes boolean not null default false, factures_fournisseur boolean not null default false, pertes boolean not null default true
);
do $$
declare t text;
begin
  foreach t in array array['parametres_recouvrement','relances','plans_paiement','blocages_tiers','creances_douteuses','factures_recurrentes','formulaires_capture','captures','segments','regles_separation'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
    execute format('grant select, insert, update on %I to erp_app', t);
  end loop;
end $$;
grant delete on segments to erp_app;
create trigger audit after insert or update on relances for each row execute function audit_ligne();
create trigger audit after insert or update on plans_paiement for each row execute function audit_ligne();
create trigger audit after insert or update on blocages_tiers for each row execute function audit_ligne();
create trigger audit after insert or update on creances_douteuses for each row execute function audit_ligne();
create trigger audit after insert or update on factures_recurrentes for each row execute function audit_ligne();
