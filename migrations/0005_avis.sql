alter table sessions_formation add column formateur_id uuid,
  add foreign key (organisation_id, formateur_id) references utilisateurs(organisation_id, id);

-- Lien personnel à usage unique : seul un participant inscrit peut répondre.
create table demandes_avis (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  inscription_id uuid not null,
  code text not null unique,
  repondu_le timestamptz,
  cree_le timestamptz not null default now(),
  unique (organisation_id, inscription_id),
  foreign key (organisation_id, inscription_id) references inscriptions(organisation_id, id)
);

-- Volontairement sans lien vers l'apprenant ou sa demande.
create table avis_formation (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  session_id uuid not null,
  formateur_id uuid,
  note_globale integer not null check (note_globale between 1 and 5),
  note_contenu integer not null check (note_contenu between 1 and 5),
  note_formateur integer not null check (note_formateur between 1 and 5),
  note_organisation integer not null check (note_organisation between 1 and 5),
  recommande boolean not null,
  commentaire text,
  commentaire_masque boolean not null default false,
  motif_masquage text,
  cree_le timestamptz not null default now(),
  foreign key (organisation_id, session_id) references sessions_formation(organisation_id, id),
  foreign key (organisation_id, formateur_id) references utilisateurs(organisation_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['demandes_avis', 'avis_formation'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante())
      with check (organisation_id = org_courante())', t);
  end loop;
end $$;
-- Le journal ne suit que le masquage : tracer la réponse permettrait de relier un avis à son auteur.
create trigger audit after update on avis_formation
  for each row execute function audit_ligne();

grant select, insert, update on demandes_avis, avis_formation to erp_app;
