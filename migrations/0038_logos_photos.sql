-- Logo téléversé par entité (groupe, branche, magasin…) et photo de profil de chaque utilisateur.
-- L'image est conservée en base : elle suit les sauvegardes et la séparation entre organisations.

create table logos_entites (
  organisation_id uuid not null,
  entite_id uuid not null,
  type_mime text not null check (type_mime in ('image/png', 'image/jpeg', 'image/webp')),
  donnees bytea not null check (octet_length(donnees) between 1 and 1048576),
  auteur_id uuid not null,
  maj_le timestamptz not null default now(),
  primary key (organisation_id, entite_id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);

create table photos_utilisateurs (
  organisation_id uuid not null,
  utilisateur_id uuid not null,
  type_mime text not null check (type_mime in ('image/png', 'image/jpeg', 'image/webp')),
  donnees bytea not null check (octet_length(donnees) between 1 and 524288),
  maj_le timestamptz not null default now(),
  primary key (organisation_id, utilisateur_id),
  foreign key (organisation_id, utilisateur_id) references utilisateurs(organisation_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['logos_entites', 'photos_utilisateurs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante())
      with check (organisation_id = org_courante())', t);
  end loop;
end $$;

-- Pas de déclencheur d'audit : il recopierait l'image. Le serveur note chaque changement de logo au journal.

grant select, insert, update, delete on logos_entites, photos_utilisateurs to erp_app;
