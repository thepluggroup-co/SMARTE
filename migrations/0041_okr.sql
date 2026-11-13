-- OKR : les objectifs et résultats clés du pilotage deviennent un vrai module, relié à la performance au quotidien.
-- Les objectifs existants sont repris tels quels : rien n'est supprimé, l'ancien responsable reste lisible.

-- Vision du groupe : chaque nouvelle version s'ajoute, la dernière s'affiche en tête de l'arbre.
create table visions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, texte text not null check (length(texte) between 3 and 3000),
  auteur_id uuid not null, cree_le timestamptz not null default now(),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);

-- Objectifs : niveau, type, propriétaire, statut et reconduction.
alter table objectifs
  add column niveau text not null default 'branche' check (niveau in ('branche', 'equipe', 'individuel')),
  add column type text not null default 'engage' check (type in ('engage', 'ambitieux')),
  add column proprietaire_id uuid,
  add column description text check (length(description) <= 2000),
  add column statut text not null default 'actif' check (statut in ('propose', 'actif', 'clos', 'abandonne')),
  add column motif_statut text check (length(motif_statut) <= 1000),
  add column origine_id uuid,
  add column auteur_id uuid,
  add column clos_le timestamptz,
  add foreign key (organisation_id, proprietaire_id) references utilisateurs(organisation_id, id),
  add foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id),
  add foreign key (organisation_id, origine_id) references objectifs(organisation_id, id),
  add check (parent_id is null or parent_id <> id);
create unique index objectifs_reconduction on objectifs (organisation_id, origine_id) where origine_id is not null;
create index objectifs_periode on objectifs (organisation_id, periode, entite_id);

-- GTA et GLOMARI ne se mélangent jamais : l'objectif parent est dans la même branche,
-- ou au niveau du groupe, au-dessus des deux branches.
create function okr_meme_branche() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.parent_id is not null and coalesce(entite_branche(new.entite_id), new.entite_id) <>
     (select coalesce(entite_branche(p.entite_id), p.entite_id) from objectifs p where p.id = new.parent_id)
     and (select x.parent_id from objectifs p join entites x on x.id = p.entite_id where p.id = new.parent_id) is not null then
    raise exception 'objectif parent d''une autre branche' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger okr_meme_branche before insert or update of parent_id, entite_id on objectifs for each row execute function okr_meme_branche();

-- Résultats clés : propriétaire, mesure automatique ou manuelle, confiance, notation de fin de trimestre.
alter table resultats_cles
  add constraint resultats_cles_org_id unique (organisation_id, id),
  add column proprietaire_id uuid,
  add column mode text not null default 'manuel' check (mode in ('manuel', 'auto')),
  add column kpi text,
  add column confiance int check (confiance between 1 and 10),
  add column mesure_le date,
  add column maj_le timestamptz,
  add column note numeric(3,2) check (note between 0 and 1),
  add column commentaire_note text check (length(commentaire_note) <= 2000),
  add column note_par uuid,
  add column note_le timestamptz,
  -- clock_timestamp : l'ordre de saisie des résultats clés d'un même objectif est conservé.
  add column cree_le timestamptz not null default clock_timestamp(),
  add check ((mode = 'auto') = (kpi is not null)),
  add check (note is null or commentaire_note is not null),
  add foreign key (organisation_id, proprietaire_id) references utilisateurs(organisation_id, id),
  add foreign key (organisation_id, note_par) references utilisateurs(organisation_id, id);
create index resultats_cles_objectif on resultats_cles (organisation_id, objectif_id);

-- Historique de chaque valeur, jamais modifié.
create table valeurs_resultat (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, resultat_id uuid not null, valeur numeric(18,2) not null,
  source text not null check (source in ('reprise', 'creation', 'manuel', 'point', 'auto')),
  auteur_id uuid, cree_le timestamptz not null default now(),
  foreign key (organisation_id, resultat_id) references resultats_cles(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create index valeurs_resultat_kr on valeurs_resultat (organisation_id, resultat_id, cree_le);

-- Point hebdomadaire : un par résultat clé et par semaine (lundi), corrigeable pendant la semaine.
create table points_okr (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, resultat_id uuid not null, semaine date not null check (extract(isodow from semaine) = 1),
  valeur numeric(18,2), confiance int not null check (confiance between 1 and 10),
  blocages text check (length(blocages) <= 3000), prochaine_action text check (length(prochaine_action) <= 2000),
  document_id uuid, probleme_id uuid, auteur_id uuid not null,
  cree_le timestamptz not null default now(), maj_le timestamptz not null default now(),
  unique (organisation_id, id), unique (organisation_id, resultat_id, semaine),
  foreign key (organisation_id, resultat_id) references resultats_cles(organisation_id, id),
  foreign key (organisation_id, document_id) references documents_ged(organisation_id, id),
  foreign key (organisation_id, probleme_id) references problemes(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);

-- Initiatives : actions ou projets qui font bouger un résultat clé. Un gros chantier se relie à un projet existant.
create table initiatives (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, resultat_id uuid not null,
  titre text not null check (length(titre) between 1 and 300), proprietaire_id uuid, echeance date,
  statut text not null default 'a_faire' check (statut in ('a_faire', 'en_cours', 'terminee', 'abandonnee')),
  projet_id uuid, auteur_id uuid not null, cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, resultat_id) references resultats_cles(organisation_id, id),
  foreign key (organisation_id, proprietaire_id) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, projet_id) references projets(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);

-- Bilan guidé de fin de trimestre, un par objectif.
create table bilans_okr (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null, objectif_id uuid not null,
  appris text not null check (length(appris) between 1 and 3000), garder text check (length(garder) <= 3000), abandonner text check (length(abandonner) <= 3000),
  auteur_id uuid not null, cree_le timestamptz not null default now(),
  unique (organisation_id, objectif_id),
  foreign key (organisation_id, objectif_id) references objectifs(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);

-- Un objectif du jour peut faire avancer un résultat clé.
alter table objectifs_jour add column resultat_cle_id uuid,
  add foreign key (organisation_id, resultat_cle_id) references resultats_cles(organisation_id, id);
create index objectifs_jour_kr on objectifs_jour (organisation_id, resultat_cle_id) where resultat_cle_id is not null;

-- Un problème peut naître d'un blocage signalé au point hebdomadaire.
alter table problemes add column resultat_cle_id uuid,
  add foreign key (organisation_id, resultat_cle_id) references resultats_cles(organisation_id, id);

do $$
declare t text;
begin
  foreach t in array array['visions', 'valeurs_resultat', 'points_okr', 'initiatives', 'bilans_okr'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
  end loop;
end $$;
create trigger audit after insert or update or delete on points_okr for each row execute function audit_ligne();
create trigger audit after insert or update or delete on initiatives for each row execute function audit_ligne();

grant select, insert on visions, valeurs_resultat, bilans_okr to erp_app;
grant select, insert, update on points_okr, initiatives to erp_app;

-- Reprise des objectifs existants.
-- Sans parent : OKR de branche ; avec un parent : OKR d'équipe. Le propriétaire est retrouvé quand l'ancien texte
-- correspond au nom d'un seul utilisateur de l'organisation ; sinon il reste vide et l'ancien texte s'affiche.
-- Organisation par organisation : la sécurité au niveau des lignes s'applique aussi pendant la migration.
do $$
declare org uuid;
begin
  for org in select id from organisations loop
    perform set_config('app.organisation_id', org::text, true);
    update objectifs o set niveau = case when o.parent_id is null then 'branche' else 'equipe' end,
      proprietaire_id = (select u.id from utilisateurs u where u.organisation_id = o.organisation_id and lower(trim(u.nom)) = lower(trim(o.responsable))
                         and (select count(*) from utilisateurs v where v.organisation_id = o.organisation_id and lower(trim(v.nom)) = lower(trim(o.responsable))) = 1);
    update resultats_cles r set proprietaire_id = o.proprietaire_id, maj_le = o.cree_le, cree_le = o.cree_le
      from objectifs o where o.id = r.objectif_id;
    insert into valeurs_resultat (organisation_id, resultat_id, valeur, source, cree_le)
      select r.organisation_id, r.id, r.actuel, 'reprise', o.cree_le from resultats_cles r join objectifs o on o.id = r.objectif_id;
  end loop;
  perform set_config('app.organisation_id', '', true);
end $$;
