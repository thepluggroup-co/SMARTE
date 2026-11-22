-- Paiement Mobile Money des commandes en ligne (lot 2 de la fiche technique globale GLOMARI).
-- Une commande n'est payée que sur avis signé du prestataire ; chaque transaction de l'opérateur ne se traite qu'une fois.

create table paiements_en_ligne (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  commande_id uuid not null,
  prestataire text not null check (prestataire ~ '^[a-z0-9]{2,30}$'),
  moyen text not null check (moyen in ('orange_money', 'mtn_momo')),
  reference_prestataire text not null check (length(reference_prestataire) between 1 and 100),
  montant bigint not null check (montant > 0),
  statut text not null default 'lance' check (statut in ('lance', 'reussi', 'echoue', 'a_rembourser')),
  motif text check (motif in ('expiree', 'annulee', 'deja_payee')),
  lance_le timestamptz not null default now(),
  traite_le timestamptz,
  unique (organisation_id, id),
  unique (organisation_id, prestataire, reference_prestataire),
  check ((statut = 'a_rembourser') = (motif is not null)),
  foreign key (organisation_id, commande_id) references commandes_web(organisation_id, id)
);
create index paiements_en_ligne_commande on paiements_en_ligne (organisation_id, commande_id);
create index paiements_en_ligne_traite on paiements_en_ligne (organisation_id, traite_le);

-- Trace de chaque avis reçu, accepté ou refusé. Insertion seule.
create table avis_paiement (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  prestataire text not null check (length(prestataire) between 1 and 30),
  reference_prestataire text check (length(reference_prestataire) <= 100),
  signature_valide boolean not null,
  issue text not null check (issue in ('traite', 'deja_traite', 'signature_invalide', 'montant_different', 'inconnu', 'echec')),
  montant bigint check (montant >= 0),
  recu_le timestamptz not null default now(),
  unique (organisation_id, id)
);
create index avis_paiement_recu on avis_paiement (organisation_id, recu_le desc);

-- Une commande payée trop tard est à rembourser.
alter table commandes_web drop constraint commandes_web_statut_check;
alter table commandes_web add constraint commandes_web_statut_check
  check (statut in ('reservee', 'payee', 'facturee', 'expediee', 'livree', 'annulee', 'expiree', 'a_rembourser'));

-- Une commande payée par Mobile Money reçoit aussi son colis : la contrainte du lot 1 qui le réservait au paiement à la livraison est levée.
do $$
declare n text;
begin
  for n in select conname from pg_constraint
    where conrelid = 'commandes_web'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%colis_id IS NULL%'
  loop
    execute format('alter table commandes_web drop constraint %I', n);
  end loop;
end $$;

alter table commandes_web
  add column facture_id uuid,
  add foreign key (organisation_id, facture_id) references documents_vente(organisation_id, id);

-- Personne au nom de qui les ventes automatiques sont créées et encaissées : celle qui ouvre la boutique.
alter table config_canal
  add column responsable_id uuid,
  add foreign key (organisation_id, responsable_id) references utilisateurs(organisation_id, id);

do $$
declare t text;
begin
  foreach t in array array['paiements_en_ligne', 'avis_paiement'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
  end loop;
end $$;
create trigger audit after insert or update on paiements_en_ligne for each row execute function audit_ligne();
grant select, insert, update on paiements_en_ligne to erp_app;
grant select, insert on avis_paiement to erp_app;
