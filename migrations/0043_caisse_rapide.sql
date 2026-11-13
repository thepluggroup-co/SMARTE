-- Caisse rapide : vendeur, remises en montant, vente à crédit, règlement du reste dû, numéros de série.

-- Vendeur de la vente (par défaut le caissier), remise sur toute la vente, reste dû d'une vente à crédit.
-- Le déclencheur « immuable » de 0011 couvre ces colonnes : une vente enregistrée ne change plus.
alter table ventes_comptoir
  add column vendeur_id uuid,
  add column remise_globale bigint not null default 0 check (remise_globale >= 0),
  add column reste_du bigint not null default 0 check (reste_du >= 0),
  add column echeance date,
  add foreign key (organisation_id, vendeur_id) references utilisateurs(organisation_id, id),
  -- Le crédit exige un client identifié et ne se fait jamais hors connexion.
  add check (reste_du = 0 or (tiers_id is not null and not hors_ligne));
create index ventes_comptoir_credit on ventes_comptoir (organisation_id, tiers_id) where reste_du > 0;

-- Remise de la ligne en FCFA TTC (sa propre remise plus sa part de la remise globale) et numéros de série vendus.
alter table lignes_comptoir
  add column remise_montant bigint not null default 0 check (remise_montant >= 0),
  add column numeros_serie text[] not null default '{}';

-- Règlement ultérieur du reste dû, encaissé dans la caisse ouverte du jour. Jamais modifié.
create table reglements_comptoir (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, vente_id uuid not null, session_id uuid not null,
  moyen text not null check (moyen in ('especes', 'mtn_momo', 'orange_money', 'carte', 'virement', 'cheque')),
  montant bigint not null check (montant > 0), reference text check (length(reference) <= 100),
  encaisse_par uuid not null, encaisse_le timestamptz not null default now(),
  check (moyen = 'especes' or reference is not null),
  unique (organisation_id, id),
  foreign key (organisation_id, vente_id) references ventes_comptoir(organisation_id, id),
  foreign key (organisation_id, session_id) references sessions_caisse(organisation_id, id),
  foreign key (organisation_id, encaisse_par) references utilisateurs(organisation_id, id)
);
create index reglements_comptoir_vente on reglements_comptoir (organisation_id, vente_id);
create index reglements_comptoir_session on reglements_comptoir (organisation_id, session_id);
alter table reglements_comptoir enable row level security;
alter table reglements_comptoir force row level security;
create policy cloison on reglements_comptoir using (organisation_id = org_courante()) with check (organisation_id = org_courante());
create trigger audit after insert on reglements_comptoir for each row execute function audit_ligne();
grant select, insert on reglements_comptoir to erp_app;

-- L'argent reçu rejoint le portefeuille du lieu, comme pour une vente.
create function tresorerie_reglement_comptoir() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v record;
begin
  select entite_id, numero into v from ventes_comptoir where id = new.vente_id;
  perform tresorerie_encaisser(new.organisation_id, v.entite_id, new.moyen, new.montant, 'Règlement du crédit ' || v.numero, new.reference, 'vente', new.vente_id);
  return null;
end $$;
create trigger tresorerie after insert on reglements_comptoir for each row execute function tresorerie_reglement_comptoir();

-- Nouveau droit « caisse.credit » : donné d'office au super administrateur et à l'administrateur d'entité,
-- qui l'avaient déjà par principe (tous les droits). Les autres rôles le reçoivent du super administrateur.
do $$
declare org uuid;
begin
  for org in select id from organisations loop
    perform set_config('app.organisation_id', org::text, true);
    insert into role_permissions (organisation_id, role_id, permission)
      select r.organisation_id, r.id, 'caisse.credit' from roles r where r.organisation_id = org and r.code in ('super_administrateur', 'administrateur')
      on conflict do nothing;
  end loop;
  perform set_config('app.organisation_id', '', true);
end $$;
