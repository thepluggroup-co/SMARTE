-- Le fichier vidéo reste hors de la base : seule sa place est notée ici.
alter table lecons add column video_fichier text, add column video_type text, add column video_taille bigint,
  add column direct_le timestamptz, add column direct_lien text;
alter table cours add column certificat_auto boolean not null default true;

create table certificats_cours (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  acces_id uuid not null,
  numero text not null,
  code_verification text not null unique,
  titulaire text not null,
  cours text not null,
  delivre_le date not null default current_date,
  revoque_le timestamptz,
  motif_revocation text,
  unique (organisation_id, acces_id),
  unique (organisation_id, numero),
  foreign key (organisation_id, acces_id) references acces_cours(organisation_id, id)
);
alter table certificats_cours enable row level security;
alter table certificats_cours force row level security;
create policy cloison on certificats_cours using (organisation_id = org_courante()) with check (organisation_id = org_courante());
create trigger audit after insert or update or delete on certificats_cours for each row execute function audit_ligne();
grant select, insert on certificats_cours to erp_app;
grant update (revoque_le, motif_revocation) on certificats_cours to erp_app;
