-- Un encaissement sans portefeuille par défaut ne se perd plus en silence :
-- il attend ici qu'un trésorier choisisse où il est arrivé.
create table encaissements_en_attente (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, entite_id uuid not null,
  moyen text not null,
  montant bigint not null check (montant > 0),
  libelle text not null, reference text,
  source_type text not null, source_id uuid not null,
  cree_le timestamptz not null default now(),
  affecte_le timestamptz, mouvement_id uuid, affecte_par uuid,
  annule_le timestamptz,
  unique (organisation_id, id),
  check (affecte_le is null or annule_le is null),
  check ((affecte_le is null) = (mouvement_id is null)),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, mouvement_id) references mouvements_portefeuille(organisation_id, id),
  foreign key (organisation_id, affecte_par) references utilisateurs(organisation_id, id)
);
create index encaissements_en_attente_ouverts on encaissements_en_attente (organisation_id, entite_id) where affecte_le is null and annule_le is null;
create index encaissements_en_attente_s on encaissements_en_attente (organisation_id, source_id);

alter table encaissements_en_attente enable row level security;
alter table encaissements_en_attente force row level security;
create policy cloison on encaissements_en_attente using (organisation_id = org_courante()) with check (organisation_id = org_courante());
create trigger audit after insert or update or delete on encaissements_en_attente for each row execute function audit_ligne();
grant select, insert, update on encaissements_en_attente to erp_app;

-- Une ligne se traite une seule fois : affectée ou annulée. Le reste ne change jamais.
create function encaissement_attente_fige() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.affecte_le is not null or old.annule_le is not null then
    raise exception 'encaissement déjà traité' using errcode = '23514';
  end if;
  if (new.organisation_id, new.entite_id, new.moyen, new.montant, new.libelle, new.reference, new.source_type, new.source_id, new.cree_le)
     is distinct from (old.organisation_id, old.entite_id, old.moyen, old.montant, old.libelle, old.reference, old.source_type, old.source_id, old.cree_le) then
    raise exception 'encaissement en attente non modifiable' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger fige before update on encaissements_en_attente for each row execute function encaissement_attente_fige();

create or replace function tresorerie_encaisser(p_org uuid, p_entite uuid, p_moyen text, p_montant bigint, p_libelle text, p_reference text, p_source_type text, p_source uuid)
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
  if v_portefeuille is null then
    insert into encaissements_en_attente (organisation_id, entite_id, moyen, montant, libelle, reference, source_type, source_id)
    values (p_org, p_entite, p_moyen, p_montant, p_libelle, p_reference, p_source_type, p_source);
    perform journal_evenement('tresorerie.encaissement_en_attente',
      jsonb_build_object('entite_id', p_entite, 'moyen', p_moyen, 'montant', p_montant, 'source_type', p_source_type, 'source_id', p_source));
    return;
  end if;
  insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, reference, source_type, source_id)
  values (p_org, v_portefeuille, 'encaissement', p_montant, p_libelle, p_reference, p_source_type, p_source);
end $$;

-- L'annulation d'un reçu ou d'une vente retire aussi ce qui attendait encore une affectation.
create or replace function tresorerie_annuler_source(p_org uuid, p_source uuid, p_motif text)
returns void language plpgsql set search_path = public, pg_temp as $$
begin
  update encaissements_en_attente set annule_le = now()
  where source_id = p_source and affecte_le is null and annule_le is null;
  insert into mouvements_portefeuille (organisation_id, portefeuille_id, type, montant, libelle, source_type, source_id, annule_mouvement_id)
  select p_org, m.portefeuille_id, 'annulation', -m.montant, 'Annulation : ' || p_motif, m.source_type, m.source_id, m.id
  from mouvements_portefeuille m where m.source_id = p_source and m.type = 'encaissement';
end $$;
