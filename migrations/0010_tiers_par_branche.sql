-- La branche d'une entité est son ancêtre placé juste sous le groupe. Le groupe lui-même n'en a pas.
create function entite_branche(p_entite uuid) returns uuid language sql stable set search_path = public, pg_temp as $$
  with recursive lignee as (
    select id, parent_id from entites where id = p_entite
    union all select e.id, e.parent_id from entites e join lignee l on e.id = l.parent_id
  )
  select l.id from lignee l join entites p on p.id = l.parent_id where p.parent_id is null
$$;

-- Vide : fiche créée par le groupe, rattachée à la première branche qui l'utilise.
alter table tiers add column branche_id uuid,
  add foreign key (organisation_id, branche_id) references entites(organisation_id, id);
create index tiers_branche on tiers (organisation_id, branche_id);
