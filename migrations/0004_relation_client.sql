create table opportunites (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null,
  entite_id uuid not null,
  tiers_id uuid not null,
  titre text not null,
  etape text not null default 'nouveau' check (etape in ('nouveau', 'contacte', 'qualifie', 'proposition', 'gagne', 'perdu')),
  montant_estime bigint not null default 0 check (montant_estime >= 0),
  source text,
  responsable_id uuid,
  motif_perte text,
  clos_le timestamptz,
  cree_le timestamptz not null default now(),
  primary key (id),
  unique (organisation_id, id),
  check (etape <> 'perdu' or motif_perte is not null),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, responsable_id) references utilisateurs(organisation_id, id)
);

create table activites (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  entite_id uuid not null,
  tiers_id uuid not null,
  opportunite_id uuid,
  type text not null check (type in ('appel', 'whatsapp', 'email', 'visite', 'note')),
  contenu text not null,
  auteur_id uuid not null,
  cree_le timestamptz not null default now(),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, opportunite_id) references opportunites(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);

create table tickets (
  id uuid not null default gen_random_uuid(),
  organisation_id uuid not null,
  entite_id uuid not null,
  numero text not null,
  tiers_id uuid not null,
  sujet text not null,
  canal text not null default 'whatsapp' check (canal in ('telephone', 'whatsapp', 'email', 'site', 'application', 'magasin')),
  priorite text not null default 'normale' check (priorite in ('basse', 'normale', 'haute')),
  statut text not null default 'ouvert' check (statut in ('ouvert', 'en_cours', 'resolu', 'ferme')),
  assigne_a uuid,
  echeance timestamptz not null,
  resolu_le timestamptz,
  cree_le timestamptz not null default now(),
  primary key (id),
  unique (organisation_id, id),
  unique (organisation_id, numero),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, assigne_a) references utilisateurs(organisation_id, id)
);

create table ticket_messages (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  ticket_id uuid not null,
  auteur_id uuid not null,
  contenu text not null,
  cree_le timestamptz not null default now(),
  foreign key (organisation_id, ticket_id) references tickets(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);

create table taches (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  entite_id uuid not null,
  titre text not null,
  description text,
  assigne_a uuid not null,
  cree_par uuid not null,
  tiers_id uuid,
  echeance date,
  statut text not null default 'a_faire' check (statut in ('a_faire', 'en_cours', 'terminee', 'annulee')),
  termine_le timestamptz,
  cree_le timestamptz not null default now(),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id),
  foreign key (organisation_id, assigne_a) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, cree_par) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['opportunites', 'activites', 'tickets', 'ticket_messages', 'taches'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante())
      with check (organisation_id = org_courante())', t);
    execute format('create trigger audit after insert or update or delete on %I
      for each row execute function audit_ligne()', t);
  end loop;
end $$;

grant select, insert, update on opportunites, activites, tickets, ticket_messages, taches to erp_app;
