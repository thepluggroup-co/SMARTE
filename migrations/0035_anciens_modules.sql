-- Une référence de paiement ne sert qu'une fois dans toute l'organisation, quel que soit le module.
create table references_paiement (
  organisation_id uuid not null, moyen text not null, reference text not null, source_id uuid not null,
  primary key (organisation_id, moyen, reference)
);
alter table references_paiement enable row level security;
alter table references_paiement force row level security;
create policy cloison on references_paiement using (organisation_id = org_courante()) with check (organisation_id = org_courante());
grant select, insert, delete on references_paiement to erp_app;
create index references_paiement_source on references_paiement (organisation_id, source_id);

insert into references_paiement (organisation_id, moyen, reference, source_id)
select organisation_id, moyen, upper(btrim(reference)), id from (
  select organisation_id, moyen, reference, id from reglements where annule_le is null
  union all select organisation_id, moyen, reference, id from paiements where annule_le is null
  union all select organisation_id, moyen, reference, id from dons where annule_le is null
  union all select x.organisation_id, x.moyen, x.reference, x.id from paiements_comptoir x join ventes_comptoir v on v.id = x.vente_id where v.annulee_le is null
) s where reference is not null and btrim(reference) <> '' and moyen not in ('especes', 'points')
on conflict do nothing;

create function reference_paiement_reservee() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare n int;
begin
  if new.reference is null or btrim(new.reference) = '' or new.moyen in ('especes', 'points') then return new; end if;
  insert into references_paiement (organisation_id, moyen, reference, source_id)
  values (new.organisation_id, new.moyen, upper(btrim(new.reference)), new.id) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'reference_deja_utilisee' using errcode = 'RP001'; end if;
  return new;
end $$;
create function reference_paiement_liberee() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.annule_le is null and new.annule_le is not null then
    delete from references_paiement where organisation_id = new.organisation_id and source_id = new.id;
  end if;
  return null;
end $$;
create function reference_paiement_vente_liberee() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.annulee_le is null and new.annulee_le is not null then
    delete from references_paiement r using paiements_comptoir x where x.vente_id = new.id and r.organisation_id = new.organisation_id and r.source_id = x.id;
  end if;
  return null;
end $$;
do $$
declare t text;
begin
  foreach t in array array['reglements', 'paiements', 'dons', 'paiements_comptoir'] loop
    execute format('create trigger reference_unique before insert on %I for each row execute function reference_paiement_reservee()', t);
  end loop;
  foreach t in array array['reglements', 'paiements', 'dons'] loop
    execute format('create trigger reference_liberee after update on %I for each row execute function reference_paiement_liberee()', t);
  end loop;
end $$;
create trigger reference_liberee after update on ventes_comptoir for each row execute function reference_paiement_vente_liberee();

-- Le rendu ne sort qu'une fois, même si la vente a plusieurs lignes d'espèces.
create or replace function tresorerie_comptoir() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v record; v_avant bigint; v_rendu bigint := 0;
begin
  if new.moyen = 'points' then return null; end if;
  select entite_id, numero, rendu into v from ventes_comptoir where id = new.vente_id;
  if new.moyen = 'especes' then
    select coalesce(sum(montant), 0) into v_avant from paiements_comptoir where vente_id = new.vente_id and moyen = 'especes' and id <> new.id;
    v_rendu := least(greatest(v.rendu - v_avant, 0), new.montant);
  end if;
  perform tresorerie_encaisser(new.organisation_id, v.entite_id, new.moyen, new.montant - v_rendu, 'Vente ' || v.numero, new.reference, 'vente', new.vente_id);
  return null;
end $$;

-- Un seul réajustement en attente par produit et par lieu.
create unique index reajustement_unique_en_attente on reajustements_stock (organisation_id, entite_id, produit_id) where statut = 'en_attente';
