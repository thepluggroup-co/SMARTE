-- Le domaine dit ce qu'une entité a le droit de faire, quels que soient ses réglages.
alter table entites add column domaine text not null default 'general'
  check (domaine in ('groupe', 'formation', 'commerce', 'general'));

-- Chaque produit appartient à une branche : GTA ne voit pas les articles de GLOMARI.
alter table produits add column entite_id uuid;
update produits p set entite_id = (select e.id from entites e where e.organisation_id = p.organisation_id and e.parent_id is null);
alter table produits alter column entite_id set not null,
  add foreign key (organisation_id, entite_id) references entites(organisation_id, id);

grant delete on attributions to erp_app;
