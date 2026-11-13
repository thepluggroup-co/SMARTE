create table portefeuilles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null,
  nom text not null,
  type text not null check (type in ('especes', 'orange_money', 'mtn_momo', 'banque', 'autre')),
  reference text,
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  unique (organisation_id, id), unique (organisation_id, entite_id, nom),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
-- Le solde est toujours la somme des mouvements. Un mouvement ne change jamais : on le contre-passe.
create table mouvements_portefeuille (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, portefeuille_id uuid not null,
  type text not null check (type in ('ouverture', 'entree', 'sortie', 'transfert', 'frais', 'encaissement', 'annulation')),
  montant bigint not null check (montant <> 0),
  libelle text not null, reference text,
  transfert_id uuid, source_type text, source_id uuid, annule_mouvement_id uuid,
  auteur_id uuid,
  cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, portefeuille_id) references portefeuilles(organisation_id, id),
  foreign key (organisation_id, annule_mouvement_id) references mouvements_portefeuille(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create index mouvements_portefeuille_p on mouvements_portefeuille (organisation_id, portefeuille_id, cree_le desc);
create index mouvements_portefeuille_s on mouvements_portefeuille (organisation_id, source_id);
create unique index mouvement_annule_une_fois on mouvements_portefeuille (organisation_id, annule_mouvement_id) where annule_mouvement_id is not null;
-- Où arrive l'argent de chaque moyen de paiement. Le réglage le plus proche du lieu de vente l'emporte.
create table portefeuilles_defaut (
  organisation_id uuid not null, entite_id uuid not null, moyen text not null, portefeuille_id uuid not null,
  primary key (organisation_id, entite_id, moyen),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, portefeuille_id) references portefeuilles(organisation_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['portefeuilles', 'mouvements_portefeuille', 'portefeuilles_defaut'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
  end loop;
end $$;
create trigger audit after insert or update or delete on mouvements_portefeuille for each row execute function audit_ligne();
grant select, insert, update on portefeuilles to erp_app;
grant select, insert on mouvements_portefeuille to erp_app;
grant select, insert, update, delete on portefeuilles_defaut to erp_app;

create function tresorerie_encaisser(p_org uuid, p_entite uuid, p_moyen text, p_montant bigint, p_libelle text, p_reference text, p_source_type text, p_source uuid)
returns void language plpgsql set search_path = public, pg_temp as $$
declare v_portefeuille uuid;
begin
  if p_montant <= 0 then return; end if;
  with recursive lignee as (
    select id, parent_id, 0 as n from entites where id = p_entite
    union all select e.id, e.parent_id, l.n + 1 from entites e join lignee l on e.id = l.parent_id
  )
  select d.portefeuille_id into v_portefeuille from portefeuilles_defaut d join lignee l on l.id = d.entite_id
  where d.moyen = p_moyen order by l.n limit 1;
  if v_portefeuille is null then return; end if;
  insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, reference, source_type, source_id)
  values (p_org, v_portefeuille, 'encaissement', p_montant, p_libelle, p_reference, p_source_type, p_source);
end $$;

create function tresorerie_annuler_source(p_org uuid, p_source uuid, p_motif text)
returns void language sql set search_path = public, pg_temp as $$
  insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, source_type, source_id, annule_mouvement_id)
  select p_org, m.portefeuille_id, 'annulation', -m.montant, 'Annulation : ' || p_motif, m.source_type, m.source_id, m.id
  from mouvements_portefeuille m where m.source_id = p_source and m.type = 'encaissement'
$$;

create function tresorerie_paiement() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_entite uuid;
begin
  if tg_op = 'INSERT' then
    select s.entite_id into v_entite from inscriptions i join sessions_formation s on s.id = i.session_id where i.id = new.inscription_id;
    perform tresorerie_encaisser(new.organisation_id, v_entite, new.moyen, new.montant, 'Reçu ' || new.numero_recu, new.reference, 'paiement', new.id);
  elsif old.annule_le is null and new.annule_le is not null then
    perform tresorerie_annuler_source(new.organisation_id, new.id, new.motif_annulation);
  end if;
  return null;
end $$;
create trigger tresorerie after insert or update on paiements for each row execute function tresorerie_paiement();

create function tresorerie_reglement() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_entite uuid;
begin
  if tg_op = 'INSERT' then
    select entite_id into v_entite from documents_vente where id = new.facture_id;
    perform tresorerie_encaisser(new.organisation_id, v_entite, new.moyen, new.montant, 'Reçu ' || new.numero_recu, new.reference, 'reglement', new.id);
  elsif old.annule_le is null and new.annule_le is not null then
    perform tresorerie_annuler_source(new.organisation_id, new.id, new.motif_annulation);
  end if;
  return null;
end $$;
create trigger tresorerie after insert or update on reglements for each row execute function tresorerie_reglement();

-- La monnaie rendue sort du tiroir : seules les espèces gardées entrent. Les points ne sont pas de l'argent.
create function tresorerie_comptoir() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v record;
begin
  if new.moyen = 'points' then return null; end if;
  select entite_id, numero, rendu into v from ventes_comptoir where id = new.vente_id;
  perform tresorerie_encaisser(new.organisation_id, v.entite_id, new.moyen,
    new.montant - case when new.moyen = 'especes' then v.rendu else 0 end, 'Vente ' || v.numero, new.reference, 'vente', new.vente_id);
  return null;
end $$;
create trigger tresorerie after insert on paiements_comptoir for each row execute function tresorerie_comptoir();

create function tresorerie_vente_annulee() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.annulee_le is null and new.annulee_le is not null then
    perform tresorerie_annuler_source(new.organisation_id, new.id, new.motif_annulation);
  end if;
  return null;
end $$;
create trigger tresorerie after update on ventes_comptoir for each row execute function tresorerie_vente_annulee();
