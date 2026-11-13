alter table produits add column code_barres text;
create unique index produits_code_barres on produits (organisation_id, code_barres) where code_barres is not null;

-- La clé créée par l'appareil garantit qu'une vente renvoyée après une coupure ne compte qu'une fois.
alter table ventes_comptoir add column cle_appareil uuid, add column hors_ligne boolean not null default false,
  add column vendue_le timestamptz;
create unique index ventes_cle_appareil on ventes_comptoir (organisation_id, cle_appareil) where cle_appareil is not null;

-- Réglage par branche, désactivé tant que SGC n'a pas fixé ses valeurs.
create table regles_fidelite (
  organisation_id uuid not null,
  branche_id uuid not null,
  actif boolean not null default false,
  fcfa_par_point bigint not null check (fcfa_par_point > 0),
  valeur_point bigint not null check (valeur_point >= 0),
  primary key (organisation_id, branche_id),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id)
);

create table points_fidelite (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  tiers_id uuid not null,
  points bigint not null check (points <> 0),
  motif text not null,
  vente_id uuid,
  auteur_id uuid,
  cree_le timestamptz not null default now(),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, vente_id) references ventes_comptoir(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create index points_tiers on points_fidelite (organisation_id, tiers_id);

alter table paiements_comptoir drop constraint paiements_comptoir_moyen_check;
alter table paiements_comptoir add constraint paiements_comptoir_moyen_check
  check (moyen in ('especes', 'mtn_momo', 'orange_money', 'carte', 'virement', 'cheque', 'points'));

do $$
declare t text;
begin
  foreach t in array array['regles_fidelite', 'points_fidelite'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante())
      with check (organisation_id = org_courante())', t);
  end loop;
end $$;
create trigger audit after insert or update or delete on points_fidelite for each row execute function audit_ligne();
grant select, insert, update on regles_fidelite to erp_app;
grant select, insert on points_fidelite to erp_app;
