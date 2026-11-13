alter table mouvements_stock drop constraint mouvements_stock_type_check;
alter table mouvements_stock add constraint mouvements_stock_type_check check (type in ('entree', 'sortie', 'ajustement',
  'transfert_sortie', 'transfert_entree', 'vente', 'achat', 'retour'));

create table sessions_caisse (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null,
  entite_id uuid not null,
  caissier_id uuid not null,
  fond_ouverture bigint not null check (fond_ouverture >= 0),
  ouverte_le timestamptz not null default now(),
  fermee_le timestamptz,
  especes_attendues bigint,
  especes_comptees bigint,
  ecart bigint,
  motif_ecart text,
  primary key (id),
  unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, caissier_id) references utilisateurs(organisation_id, id)
);
create unique index une_caisse_ouverte on sessions_caisse (organisation_id, entite_id, caissier_id) where fermee_le is null;

create table ventes_comptoir (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null,
  session_id uuid not null,
  entite_id uuid not null,
  numero text not null,
  tiers_id uuid,
  total_ht bigint not null,
  total_taxes bigint not null,
  total_ttc bigint not null,
  rendu bigint not null default 0,
  caissier_id uuid not null,
  annulee_le timestamptz,
  annulee_par uuid,
  motif_annulation text,
  cree_le timestamptz not null default now(),
  primary key (id),
  unique (organisation_id, id),
  unique (organisation_id, numero),
  check ((annulee_le is null) = (motif_annulation is null)),
  foreign key (organisation_id, session_id) references sessions_caisse(organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, caissier_id) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, annulee_par) references utilisateurs(organisation_id, id)
);

create table lignes_comptoir (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  vente_id uuid not null,
  produit_id uuid not null,
  designation text not null,
  quantite numeric(14,3) not null check (quantite > 0),
  prix_unitaire bigint not null,
  remise_pct numeric(5,2) not null default 0,
  taux numeric(6,3) not null default 0,
  montant_ht bigint not null,
  montant_taxes bigint not null,
  foreign key (organisation_id, vente_id) references ventes_comptoir(organisation_id, id),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id)
);

create table paiements_comptoir (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  vente_id uuid not null,
  moyen text not null check (moyen in ('especes', 'mtn_momo', 'orange_money', 'carte', 'virement', 'cheque')),
  montant bigint not null check (montant > 0),
  reference text,
  foreign key (organisation_id, vente_id) references ventes_comptoir(organisation_id, id)
);

create table cours (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null,
  entite_id uuid not null,
  titre text not null,
  description text,
  publie boolean not null default false,
  seuil_reussite integer not null default 70 check (seuil_reussite between 0 and 100),
  cree_le timestamptz not null default now(),
  primary key (id),
  unique (organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);

create table lecons (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null,
  cours_id uuid not null,
  ordre integer not null,
  titre text not null,
  contenu text,
  url text check (url is null or url like 'https://%'),
  questions jsonb not null default '[]',
  primary key (id),
  unique (organisation_id, id),
  foreign key (organisation_id, cours_id) references cours(organisation_id, id)
);

create table acces_cours (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null,
  cours_id uuid not null,
  tiers_id uuid not null,
  code text not null unique,
  actif boolean not null default true,
  derniere_activite timestamptz,
  termine_le timestamptz,
  cree_le timestamptz not null default now(),
  primary key (id),
  unique (organisation_id, id),
  unique (organisation_id, cours_id, tiers_id),
  foreign key (organisation_id, cours_id) references cours(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id)
);

create table progressions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  acces_id uuid not null,
  lecon_id uuid not null,
  score integer,
  tentatives integer not null default 0,
  terminee_le timestamptz,
  unique (organisation_id, acces_id, lecon_id),
  foreign key (organisation_id, acces_id) references acces_cours(organisation_id, id),
  foreign key (organisation_id, lecon_id) references lecons(organisation_id, id)
);

create table employes (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null,
  entite_id uuid not null,
  matricule text not null,
  nom text not null,
  poste text not null,
  type_contrat text not null check (type_contrat in ('cdi', 'cdd', 'stage', 'prestataire', 'autre')),
  date_embauche date not null,
  date_sortie date,
  telephone text,
  email text,
  cree_le timestamptz not null default now(),
  primary key (id),
  unique (organisation_id, id),
  unique (organisation_id, matricule),
  check (date_sortie is null or date_sortie >= date_embauche),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);

create table conges (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  employe_id uuid not null,
  type text not null check (type in ('annuel', 'maladie', 'maternite', 'permission', 'sans_solde', 'autre')),
  debut date not null,
  fin date not null,
  statut text not null default 'demande' check (statut in ('demande', 'approuve', 'refuse', 'annule')),
  motif text,
  decide_par uuid,
  decide_le timestamptz,
  motif_refus text,
  cree_le timestamptz not null default now(),
  check (fin >= debut),
  foreign key (organisation_id, employe_id) references employes(organisation_id, id),
  foreign key (organisation_id, decide_par) references utilisateurs(organisation_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['sessions_caisse', 'ventes_comptoir', 'lignes_comptoir', 'paiements_comptoir', 'cours', 'lecons',
    'acces_cours', 'progressions', 'employes', 'conges'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante())
      with check (organisation_id = org_courante())', t);
  end loop;
  foreach t in array array['sessions_caisse', 'ventes_comptoir', 'paiements_comptoir', 'cours', 'lecons', 'acces_cours', 'employes', 'conges'] loop
    execute format('create trigger audit after insert or update or delete on %I
      for each row execute function audit_ligne()', t);
  end loop;
end $$;

grant select, insert, update on sessions_caisse, ventes_comptoir, cours, lecons, acces_cours, progressions, employes, conges to erp_app;
grant select, insert on lignes_comptoir, paiements_comptoir to erp_app;
grant delete on lecons to erp_app;

-- Une vente ne change plus après coup, sauf son annulation motivée.
create function vente_immuable() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['annulee_le', 'annulee_par', 'motif_annulation']) <> (to_jsonb(old) - array['annulee_le', 'annulee_par', 'motif_annulation'])
     or old.annulee_le is not null then
    raise exception 'Une vente enregistrée ne peut pas être modifiée';
  end if;
  return new;
end $$;
create trigger immuable before update on ventes_comptoir for each row execute function vente_immuable();
