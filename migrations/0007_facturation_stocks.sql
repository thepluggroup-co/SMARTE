-- Identité légale reprise sur les factures.
alter table entites add column raison_sociale text, add column niu text, add column rccm text, add column adresse text;

create table produits (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null references organisations(id),
  code text not null,
  nom text not null,
  type text not null default 'produit' check (type in ('produit', 'service', 'formation', 'abonnement')),
  unite text not null default 'pièce',
  prix_vente bigint not null default 0 check (prix_vente >= 0),
  taux_taxe numeric(6,3) not null default 0 check (taux_taxe between 0 and 100),
  stock_cible numeric(14,3) not null default 0 check (stock_cible >= 0),
  suivi_stock boolean not null default false,
  seuil_alerte numeric(14,3) not null default 0 check (seuil_alerte >= 0),
  cout_moyen bigint not null default 0 check (cout_moyen >= 0),
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  primary key (id),
  unique (organisation_id, id),
  unique (organisation_id, code),
  check (not suivi_stock or type = 'produit')
);

create table documents_vente (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null,
  entite_id uuid not null,
  type text not null check (type in ('devis', 'facture', 'avoir')),
  numero text,
  statut text not null default 'brouillon' check (statut in ('brouillon', 'emis', 'accepte', 'refuse', 'annule')),
  tiers_id uuid not null,
  date_document date not null,
  date_echeance date,
  origine_id uuid,
  mode_remise text not null default 'aucun' check (mode_remise in ('aucun', 'retrait', 'livraison', 'expedition')),
  adresse_livraison text,
  transporteur text,
  frais_livraison bigint not null default 0 check (frais_livraison >= 0),
  taux_frais numeric(6,3) not null default 0 check (taux_frais between 0 and 100),
  motif text,
  notes text,
  client_nom text,
  client_niu text,
  vendeur_nom text,
  vendeur_niu text,
  vendeur_rccm text,
  vendeur_adresse text,
  total_ht bigint not null default 0,
  total_taxes bigint not null default 0,
  total_ttc bigint not null default 0,
  cree_par uuid not null,
  emis_le timestamptz,
  cree_le timestamptz not null default now(),
  primary key (id),
  unique (organisation_id, id),
  unique (organisation_id, numero),
  check (statut = 'brouillon' or statut = 'annule' or numero is not null),
  check (type <> 'avoir' or motif is not null),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, origine_id) references documents_vente(organisation_id, id),
  foreign key (organisation_id, cree_par) references utilisateurs(organisation_id, id)
);

create table lignes_vente (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  document_id uuid not null,
  ordre integer not null,
  produit_id uuid,
  designation text not null,
  quantite numeric(14,3) not null check (quantite > 0),
  prix_unitaire bigint not null check (prix_unitaire >= 0),
  remise_pct numeric(5,2) not null default 0 check (remise_pct between 0 and 100),
  taux numeric(6,3) not null default 0 check (taux between 0 and 100),
  montant_ht bigint not null,
  montant_taxes bigint not null,
  unique (organisation_id, document_id, ordre),
  foreign key (organisation_id, document_id) references documents_vente(organisation_id, id),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id)
);

create table reglements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  facture_id uuid not null,
  numero_recu text not null,
  montant bigint not null check (montant > 0),
  moyen text not null check (moyen in ('especes', 'mtn_momo', 'orange_money', 'virement', 'cheque', 'carte')),
  reference text,
  encaisse_par uuid not null,
  encaisse_le timestamptz not null default now(),
  annule_le timestamptz,
  motif_annulation text,
  unique (organisation_id, numero_recu),
  check ((annule_le is null) = (motif_annulation is null)),
  foreign key (organisation_id, facture_id) references documents_vente(organisation_id, id),
  foreign key (organisation_id, encaisse_par) references utilisateurs(organisation_id, id)
);

-- Le stock n'est jamais une valeur modifiable : c'est la somme de ses mouvements.
create table mouvements_stock (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  entite_id uuid not null,
  produit_id uuid not null,
  type text not null check (type in ('entree', 'sortie', 'ajustement', 'transfert_sortie', 'transfert_entree', 'vente', 'achat')),
  quantite numeric(14,3) not null check (quantite <> 0),
  cout_unitaire bigint,
  motif text,
  reference text,
  document_id uuid,
  auteur_id uuid not null,
  cree_le timestamptz not null default now(),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id),
  foreign key (organisation_id, document_id) references documents_vente(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create index mouvements_niveau on mouvements_stock (organisation_id, entite_id, produit_id);

do $$
declare t text;
begin
  foreach t in array array['produits', 'documents_vente', 'lignes_vente', 'reglements', 'mouvements_stock'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante())
      with check (organisation_id = org_courante())', t);
    execute format('create trigger audit after insert or update or delete on %I
      for each row execute function audit_ligne()', t);
  end loop;
end $$;

grant select, insert, update on produits, documents_vente, reglements to erp_app;
grant select, insert, update, delete on lignes_vente to erp_app;
grant select, insert on mouvements_stock to erp_app;

-- Un document émis ne change plus : seule la décision sur un devis reste possible.
create function document_immuable() returns trigger language plpgsql as $$
begin
  if old.statut = 'brouillon' then return new; end if;
  if old.type = 'devis' and old.statut in ('emis', 'accepte', 'refuse')
     and new.statut in ('emis', 'accepte', 'refuse')
     and (to_jsonb(new) - 'statut') = (to_jsonb(old) - 'statut') then
    return new;
  end if;
  raise exception 'Un document émis ne peut pas être modifié';
end $$;
create trigger immuable before update on documents_vente for each row execute function document_immuable();

create function lignes_immuables() returns trigger language plpgsql as $$
declare v_statut text;
begin
  select statut into v_statut from documents_vente where id = coalesce(new.document_id, old.document_id);
  if v_statut <> 'brouillon' then
    raise exception 'Un document émis ne peut pas être modifié';
  end if;
  return coalesce(new, old);
end $$;
create trigger immuable before insert or update or delete on lignes_vente
  for each row execute function lignes_immuables();

create function reglement_immuable() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['annule_le', 'motif_annulation']) <> (to_jsonb(old) - array['annule_le', 'motif_annulation'])
     or old.annule_le is not null then
    raise exception 'Un règlement enregistré ne peut pas être modifié';
  end if;
  return new;
end $$;
create trigger immuable before update on reglements for each row execute function reglement_immuable();
