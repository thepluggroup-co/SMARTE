-- Lot 4, partie A : messages automatiques (SMS, WhatsApp) et avis publiés par article.

-- Réglage d'un type de message pour une branche ; sans ligne, le défaut du code s'applique.
create table reglages_messages (
  organisation_id uuid not null,
  branche_id uuid not null,
  type text not null check (type in ('colis_cree', 'colis_en_livraison', 'colis_pret_retrait', 'colis_livre', 'acompte_confirme', 'etape_arrivage',
    'solde_a_payer', 'rappel_solde', 'acompte_a_rembourser', 'acompte_conserve', 'avis_livraison', 'avis_magasin')),
  actif boolean not null,
  canal text not null check (canal in ('sms', 'whatsapp')),
  modifie_par uuid not null,
  modifie_le timestamptz not null default now(),
  primary key (organisation_id, branche_id, type),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id),
  foreign key (organisation_id, modifie_par) references utilisateurs(organisation_id, id)
);

-- File d'envoi et journal : une ligne par message. Le texte n'est jamais enregistré, ni le numéro complet.
create table envois_messages (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  branche_id uuid not null,
  type text not null check (type in ('colis_cree', 'colis_en_livraison', 'colis_pret_retrait', 'colis_livre', 'acompte_confirme', 'etape_arrivage',
    'solde_a_payer', 'rappel_solde', 'acompte_a_rembourser', 'acompte_conserve', 'avis_livraison', 'avis_magasin')),
  cle text not null check (length(cle) between 3 and 300),
  objet_type text not null check (objet_type in ('colis', 'inscription', 'vente_comptoir')),
  objet_id uuid not null,
  statut text not null default 'en_attente' check (statut in ('en_attente', 'en_cours', 'envoye', 'echec', 'sans_numero', 'annule')),
  canal text check (canal in ('sms', 'whatsapp')),
  numero_masque text check (numero_masque ~ '^[*]{7}[0-9]{2}$'),
  du_le timestamptz not null default now(),
  tentatives integer not null default 0 check (tentatives between 0 and 3),
  essai_le timestamptz,
  envoye_le timestamptz,
  erreur text check (erreur in ('prestataire', 'sans_numero', 'desactive', 'ne_pas_contacter', 'sans_objet')),
  reference_prestataire text check (length(reference_prestataire) <= 200),
  renvoi_de uuid,
  renvoye_par uuid,
  cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, cle),
  check ((statut = 'envoye') = (envoye_le is not null)),
  check ((renvoi_de is null) = (renvoye_par is null)),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id),
  foreign key (organisation_id, renvoi_de) references envois_messages(organisation_id, id),
  foreign key (organisation_id, renvoye_par) references utilisateurs(organisation_id, id)
);
create index envois_messages_dus on envois_messages (statut, du_le);
create index envois_messages_journal on envois_messages (organisation_id, branche_id, cree_le);
create index envois_messages_objet on envois_messages (organisation_id, objet_id);

do $$
declare t text;
begin
  foreach t in array array['reglages_messages', 'envois_messages'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
  end loop;
end $$;
create trigger audit after insert or update on reglages_messages for each row execute function audit_ligne();
grant select, insert, update on reglages_messages, envois_messages to erp_app;

-- Un client peut demander à ne plus recevoir de demande d'avis ; les messages de sa commande restent envoyés.
alter table tiers add column ne_pas_contacter boolean not null default false;

-- Demande d'avis sur toute une commande (colis livré ou achat en magasin).
alter table demandes_retour drop constraint demandes_retour_cible_type_check;
alter table demandes_retour add constraint demandes_retour_cible_type_check
  check (cible_type in ('produit', 'vendeur', 'livraison', 'magasin', 'sav', 'autre', 'commande'));
alter table demandes_retour drop constraint demandes_retour_source_type_check;
alter table demandes_retour add constraint demandes_retour_source_type_check
  check (source_type in ('facture', 'colis', 'sav', 'vente_comptoir'));

-- Un avis par article d'une commande ; toujours un seul avis pour les autres demandes.
alter table retours_clients add column produit_id uuid;
alter table retours_clients add foreign key (organisation_id, produit_id) references produits(organisation_id, id);
alter table retours_clients drop constraint retours_clients_demande_id_key;
create unique index retours_clients_demande_article on retours_clients
  (organisation_id, demande_id, coalesce(produit_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index retours_clients_produit on retours_clients (organisation_id, produit_id, statut) where produit_id is not null;
