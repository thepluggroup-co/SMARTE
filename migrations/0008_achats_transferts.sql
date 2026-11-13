create table expeditions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  facture_id uuid not null,
  mode text not null check (mode in ('retrait', 'livraison', 'expedition')),
  transporteur text,
  numero_suivi text,
  adresse text,
  statut text not null default 'preparation' check (statut in ('preparation', 'expediee', 'en_transit', 'livree', 'retournee')),
  preuve text,
  expediee_le timestamptz,
  livree_le timestamptz,
  cree_le timestamptz not null default now(),
  unique (organisation_id, facture_id),
  foreign key (organisation_id, facture_id) references documents_vente(organisation_id, id)
);

create table commandes_achat (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null,
  entite_id uuid not null, -- entrepôt de réception
  numero text not null,
  fournisseur_id uuid not null,
  statut text not null default 'brouillon' check (statut in ('brouillon', 'approuvee', 'recue_partiellement', 'recue', 'annulee')),
  date_commande date not null,
  date_prevue date,
  notes text,
  total bigint not null default 0,
  cree_par uuid not null,
  approuve_par uuid,
  approuve_le timestamptz,
  motif_annulation text,
  cree_le timestamptz not null default now(),
  primary key (id),
  unique (organisation_id, id),
  unique (organisation_id, numero),
  check (statut <> 'annulee' or motif_annulation is not null),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, fournisseur_id) references tiers(organisation_id, id),
  foreign key (organisation_id, cree_par) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, approuve_par) references utilisateurs(organisation_id, id)
);

create table lignes_achat (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null,
  commande_id uuid not null,
  produit_id uuid not null,
  quantite numeric(14,3) not null check (quantite > 0),
  prix_unitaire bigint not null check (prix_unitaire >= 0),
  quantite_recue numeric(14,3) not null default 0 check (quantite_recue >= 0),
  primary key (id),
  unique (organisation_id, id),
  unique (organisation_id, commande_id, produit_id),
  foreign key (organisation_id, commande_id) references commandes_achat(organisation_id, id),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id)
);

create table receptions_achat (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  commande_id uuid not null,
  numero text not null,
  note text,
  auteur_id uuid not null,
  cree_le timestamptz not null default now(),
  unique (organisation_id, numero),
  foreign key (organisation_id, commande_id) references commandes_achat(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);

create table lignes_reception (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  reception_id uuid not null,
  ligne_id uuid not null,
  quantite numeric(14,3) not null check (quantite > 0),
  foreign key (organisation_id, ligne_id) references lignes_achat(organisation_id, id)
);

create table transferts_stock (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null,
  numero text not null,
  depuis_id uuid not null,
  vers_id uuid not null,
  statut text not null default 'demande' check (statut in ('demande', 'expedie', 'recu', 'annule')),
  note text,
  motif_ecart text,
  motif_annulation text,
  cree_par uuid not null,
  expedie_par uuid,
  expedie_le timestamptz,
  recu_par uuid,
  recu_le timestamptz,
  cree_le timestamptz not null default now(),
  primary key (id),
  unique (organisation_id, id),
  unique (organisation_id, numero),
  check (depuis_id <> vers_id),
  foreign key (organisation_id, depuis_id) references entites(organisation_id, id),
  foreign key (organisation_id, vers_id) references entites(organisation_id, id),
  foreign key (organisation_id, cree_par) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, expedie_par) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, recu_par) references utilisateurs(organisation_id, id)
);

create table lignes_transfert (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  transfert_id uuid not null,
  produit_id uuid not null,
  quantite numeric(14,3) not null check (quantite > 0),
  quantite_recue numeric(14,3) check (quantite_recue >= 0),
  unique (organisation_id, transfert_id, produit_id),
  foreign key (organisation_id, transfert_id) references transferts_stock(organisation_id, id),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id)
);

-- Un réajustement proposé ne touche pas au stock tant qu'il n'est pas confirmé.
create table reajustements_stock (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  entite_id uuid not null,
  produit_id uuid not null,
  stock_constate numeric(14,3) not null,
  quantite_comptee numeric(14,3) not null check (quantite_comptee >= 0),
  motif text not null,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'confirme', 'rejete')),
  propose_par uuid not null,
  decide_par uuid,
  decide_le timestamptz,
  motif_rejet text,
  cree_le timestamptz not null default now(),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id),
  foreign key (organisation_id, propose_par) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, decide_par) references utilisateurs(organisation_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['expeditions', 'commandes_achat', 'lignes_achat', 'receptions_achat', 'lignes_reception',
    'transferts_stock', 'lignes_transfert', 'reajustements_stock'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante())
      with check (organisation_id = org_courante())', t);
    execute format('create trigger audit after insert or update or delete on %I
      for each row execute function audit_ligne()', t);
  end loop;
end $$;

grant select, insert, update on expeditions, commandes_achat, receptions_achat, lignes_reception,
  transferts_stock, lignes_transfert, reajustements_stock to erp_app;
grant select, insert, update, delete on lignes_achat to erp_app;
