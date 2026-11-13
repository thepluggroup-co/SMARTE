-- Retours partiels d'une vente de caisse, restes dus après retour, commission des vendeurs.

alter table lignes_comptoir add constraint lignes_comptoir_org_id unique (organisation_id, id);

-- Un retour a son propre numéro ; le ticket d'origine reste figé (déclencheur « immuable » de 0011).
create table retours_comptoir (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, vente_id uuid not null, entite_id uuid not null, session_id uuid not null,
  numero text not null, motif text not null check (length(motif) between 5 and 500),
  total_ht bigint not null check (total_ht >= 0), total_taxes bigint not null check (total_taxes >= 0), total_ttc bigint not null check (total_ttc > 0),
  points_repris bigint not null default 0, auteur_id uuid not null, cree_le timestamptz not null default now(),
  unique (organisation_id, id), unique (organisation_id, numero),
  foreign key (organisation_id, vente_id) references ventes_comptoir(organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, session_id) references sessions_caisse(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create index retours_comptoir_vente on retours_comptoir (organisation_id, vente_id);
create index retours_comptoir_session on retours_comptoir (organisation_id, session_id);

-- Quantités toujours dans l'unité de base de l'article. Destination : remis en vente, ou mis de côté comme avarié.
create table lignes_retour_comptoir (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, retour_id uuid not null, ligne_id uuid not null, produit_id uuid not null,
  quantite numeric(14,3) not null check (quantite > 0),
  destination text not null check (destination in ('vente', 'avarie')),
  montant_ht bigint not null check (montant_ht >= 0), montant_taxes bigint not null check (montant_taxes >= 0),
  foreign key (organisation_id, retour_id) references retours_comptoir(organisation_id, id),
  foreign key (organisation_id, ligne_id) references lignes_comptoir(organisation_id, id),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id)
);
create index lignes_retour_ligne on lignes_retour_comptoir (organisation_id, ligne_id);

-- Remboursement par moyen. « credit » ne sort pas d'argent : il diminue le reste dû d'une vente à crédit.
create table remboursements_comptoir (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, retour_id uuid not null, vente_id uuid not null,
  moyen text not null check (moyen in ('especes', 'mtn_momo', 'orange_money', 'carte', 'virement', 'cheque', 'credit')),
  montant bigint not null check (montant > 0), reference text check (length(reference) <= 100),
  foreign key (organisation_id, retour_id) references retours_comptoir(organisation_id, id),
  foreign key (organisation_id, vente_id) references ventes_comptoir(organisation_id, id)
);
create index remboursements_comptoir_vente on remboursements_comptoir (organisation_id, vente_id);

-- Ce qui reste à payer d'une vente à crédit : crédit accordé, moins les règlements reçus, moins les retours imputés.
create function reste_credit_comptoir(p_vente uuid) returns bigint language sql stable set search_path = public, pg_temp as $$
  select (v.reste_du
    - coalesce((select sum(r.montant) from reglements_comptoir r where r.vente_id = v.id), 0)
    - coalesce((select sum(x.montant) from remboursements_comptoir x where x.vente_id = v.id and x.moyen = 'credit'), 0))::bigint
  from ventes_comptoir v where v.id = p_vente
$$;

-- L'argent rendu au client sort du portefeuille du lieu pour ce moyen de paiement (celui qui reçoit les ventes).
-- Sans portefeuille réglé pour ce moyen, rien n'est écrit en trésorerie : le fait reste au journal.
create function tresorerie_remboursement_comptoir() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v record; v_portefeuille uuid;
begin
  if new.moyen = 'credit' then return null; end if;
  select t.entite_id, t.numero into v from retours_comptoir t where t.id = new.retour_id;
  with recursive lignee as (
    select id, parent_id, 0 as n from entites where id = v.entite_id
    union all select e.id, e.parent_id, l.n + 1 from entites e join lignee l on e.id = l.parent_id
  )
  select d.portefeuille_id into v_portefeuille from portefeuilles_defaut d join lignee l on l.id = d.entite_id
  where d.moyen = new.moyen order by l.n limit 1;
  if v_portefeuille is null then
    perform journal_evenement('tresorerie.remboursement_sans_portefeuille',
      jsonb_build_object('entite_id', v.entite_id, 'moyen', new.moyen, 'montant', new.montant, 'retour', v.numero));
    return null;
  end if;
  insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, reference, source_type, source_id)
  values (new.organisation_id, v_portefeuille, 'sortie', -new.montant, 'Remboursement ' || v.numero, new.reference, 'retour', new.retour_id);
  return null;
end $$;
create trigger tresorerie after insert on remboursements_comptoir for each row execute function tresorerie_remboursement_comptoir();

-- Commission des vendeurs : objectif mensuel de ventes et pourcentage au delà de l'objectif, sur la fiche employé.
alter table employes
  add column objectif_ventes bigint check (objectif_ventes >= 0),
  add column taux_commission numeric(5,2) check (taux_commission between 0 and 100);

-- Montant proposé à la paie pour un mois. C'est une proposition : la paie décide, et rien n'entre seul dans un bulletin.
create table commissions_proposees (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, employe_id uuid not null, periode text not null check (periode ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  ventes bigint not null, objectif bigint not null, taux numeric(5,2) not null, montant bigint not null check (montant >= 0),
  propose_par uuid not null, propose_le timestamptz not null default now(),
  unique (organisation_id, id), unique (organisation_id, employe_id, periode),
  foreign key (organisation_id, employe_id) references employes(organisation_id, id),
  foreign key (organisation_id, propose_par) references utilisateurs(organisation_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['retours_comptoir', 'lignes_retour_comptoir', 'remboursements_comptoir', 'commissions_proposees'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
  end loop;
end $$;
create trigger audit after insert on retours_comptoir for each row execute function audit_ligne();
create trigger audit after insert or update on commissions_proposees for each row execute function audit_ligne();
-- Un retour ne se modifie pas : insertion seule.
grant select, insert on retours_comptoir, lignes_retour_comptoir, remboursements_comptoir to erp_app;
grant select, insert, update on commissions_proposees to erp_app;
