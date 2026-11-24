-- Lot 4, partie C : assistant GLOMARI Care (conversations, réponses validées) et studio des fiches produits (textes de vente).

-- Conversation d'un visiteur de la Marketplace avec l'assistant : seule l'empreinte du jeton est gardée.
create table conversations_care (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  branche_id uuid not null,
  jeton_hache text not null unique check (jeton_hache ~ '^[0-9a-f]{64}$'),
  tiers_id uuid,
  commande_web_id uuid,
  statut text not null default 'ouverte' check (statut in ('ouverte', 'close', 'transmise')),
  ticket_id uuid,
  messages_visiteur integer not null default 0 check (messages_visiteur between 0 and 30),
  derniere_activite timestamptz not null default now(),
  close_le timestamptz,
  cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  check ((statut = 'transmise') = (ticket_id is not null)),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, commande_web_id) references commandes_web(organisation_id, id),
  foreign key (organisation_id, ticket_id) references tickets(organisation_id, id)
);
create index conversations_care_periode on conversations_care (organisation_id, branche_id, cree_le);
create index conversations_care_ouvertes on conversations_care (derniere_activite) where statut = 'ouverte';
create unique index conversations_care_ticket on conversations_care (organisation_id, ticket_id) where ticket_id is not null;

-- Question du visiteur ou réponse de l'assistant ; l'avis et les marques ne valent que pour une réponse.
create table messages_care (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  conversation_id uuid not null,
  role text not null check (role in ('visiteur', 'assistant')),
  contenu text not null check (length(contenu) between 1 and 2000),
  sans_reponse boolean not null default false,
  propose_conseiller boolean not null default false,
  motif text check (motif in ('remboursement', 'litige', 'autre')),
  aide boolean,
  cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  check (role = 'assistant' or (not sans_reponse and not propose_conseiller and motif is null and aide is null)),
  foreign key (organisation_id, conversation_id) references conversations_care(organisation_id, id) on delete cascade
);
create index messages_care_conversation on messages_care (organisation_id, conversation_id, cree_le);

-- Réponses rédigées par l'équipe Care : seules les actives servent à l'assistant ; aucune suppression.
create table reponses_care (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  branche_id uuid not null,
  sujet text not null check (length(trim(sujet)) between 1 and 100),
  question text not null check (length(trim(question)) between 3 and 500),
  reponse text not null check (length(trim(reponse)) between 3 and 2000),
  actif boolean not null default true,
  auteur_id uuid not null,
  modifie_par uuid,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, modifie_par) references utilisateurs(organisation_id, id)
);
create index reponses_care_branche on reponses_care (organisation_id, branche_id, actif);

-- Texte de vente d'un article, versionné : le nom de l'article dans l'ERP ne change jamais.
create table textes_vente (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  produit_id uuid not null,
  version integer not null check (version > 0),
  titre text not null check (length(trim(titre)) between 1 and 80),
  description text not null check (length(trim(description)) between 1 and 1500),
  points_cles text[] not null check (cardinality(points_cles) between 3 and 6),
  source text not null check (source in ('ia', 'manuel')),
  notes text check (length(notes) <= 1000),
  statut text not null default 'brouillon' check (statut in ('brouillon', 'publie', 'remplace', 'retire')),
  auteur_id uuid not null,
  publie_par uuid,
  publie_le timestamptz,
  cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, produit_id, version),
  check ((statut = 'brouillon') = (publie_le is null) and (publie_le is null) = (publie_par is null)),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, publie_par) references utilisateurs(organisation_id, id)
);
create unique index textes_vente_publie on textes_vente (organisation_id, produit_id) where statut = 'publie';
create unique index textes_vente_brouillon on textes_vente (organisation_id, produit_id) where statut = 'brouillon';

-- La Marketplace rafraîchit la fiche à la publication et au retrait ; un remplacement accompagne toujours une publication.
create function canal_texte_vente() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.statut in ('publie', 'retire') and (tg_op = 'INSERT' or old.statut is distinct from new.statut) then
    perform canal_publier_article(new.organisation_id, new.produit_id);
  end if;
  return null;
end $$;
create trigger canal_article after insert or update of statut on textes_vente for each row execute function canal_texte_vente();

do $$
declare t text;
begin
  foreach t in array array['conversations_care', 'messages_care', 'reponses_care', 'textes_vente'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
  end loop;
end $$;
-- Les conversations, nombreuses, ne vont pas au journal d'audit ; les réponses validées et les textes de vente, si.
create trigger audit after insert or update on reponses_care for each row execute function audit_ligne();
create trigger audit after insert or update on textes_vente for each row execute function audit_ligne();
grant select, insert, update, delete on conversations_care, messages_care to erp_app;
grant select, insert, update on reponses_care, textes_vente to erp_app;
