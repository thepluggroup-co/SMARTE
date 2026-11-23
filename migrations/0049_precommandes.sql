-- Précommandes d'arrivage de GLOMARI (lot 3, partie A, de la fiche technique globale) : campagne, liste d'attente
-- payée d'un acompte, seuil, bon de commande en brouillon, réservation à l'arrivée, solde par une commande en ligne.
-- Une prévente est une précommande avec acompte, pas un financement participatif (règle R4).

-- Une campagne par article, sur la branche de la boutique en ligne. Le prix est figé en hors taxes avec son taux :
-- le TTC annoncé est celui que donne le calcul d'une ligne de facture.
create table campagnes_arrivage (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  entite_id uuid not null,
  lieu_id uuid not null,
  produit_id uuid not null,
  fournisseur_id uuid not null,
  numero text not null check (numero ~ '^ARR-[0-9]{4}-[0-9]{6}$'),
  origine text not null default 'import' check (origine in ('local', 'import')),
  titre text not null check (length(trim(titre)) between 1 and 200),
  texte text check (length(texte) <= 2000),
  prix_ht bigint not null check (prix_ht > 0),
  taux_taxe numeric(6,3) not null default 0 check (taux_taxe between 0 and 100),
  prix_ttc bigint not null check (prix_ttc > 0),
  acompte_type text not null check (acompte_type in ('montant', 'pourcentage')),
  acompte_valeur bigint not null check (acompte_valeur > 0),
  acompte_unitaire bigint not null check (acompte_unitaire > 0),
  seuil integer not null check (seuil > 0),
  quantite_max integer,
  date_limite date not null,
  delai_solde_jours integer not null default 7 check (delai_solde_jours between 1 and 60),
  prix_achat_prevu bigint check (prix_achat_prevu >= 0),
  statut text not null default 'ouverte' check (statut in ('ouverte', 'declenchee', 'annulee', 'livree')),
  motif_annulation text check (length(motif_annulation) between 3 and 500),
  annulee_le timestamptz,
  annulee_par uuid,
  declenchee_le timestamptz,
  commande_achat_id uuid,
  premiere_reception_le timestamptz,
  cree_par uuid not null,
  cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, numero),
  unique (organisation_id, commande_achat_id),
  check ((statut = 'annulee') = (motif_annulation is not null)),
  check (quantite_max is null or quantite_max >= seuil),
  check (acompte_unitaire < prix_ttc),
  check (acompte_type = 'montant' or acompte_valeur between 1 and 99),
  foreign key (organisation_id, entite_id) references config_canal(organisation_id, entite_id),
  foreign key (organisation_id, lieu_id) references entites(organisation_id, id),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id),
  foreign key (organisation_id, fournisseur_id) references tiers(organisation_id, id),
  foreign key (organisation_id, annulee_par) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, commande_achat_id) references commandes_achat(organisation_id, id),
  foreign key (organisation_id, cree_par) references utilisateurs(organisation_id, id)
);
create index campagnes_arrivage_branche on campagnes_arrivage (organisation_id, entite_id, statut);

-- Un client, une quantité, une campagne. Le total et l'acompte sont figés à l'inscription ; le rang est l'ordre
-- de confirmation de l'acompte (validee_le).
create table inscriptions_precommande (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  campagne_id uuid not null,
  tiers_id uuid not null,
  reference text not null check (reference ~ '^PRE-[0-9]{4}-[0-9]{6}$'),
  jeton_suivi_hache text not null check (jeton_suivi_hache ~ '^[0-9a-f]{64}$'),
  nom_client text not null check (length(trim(nom_client)) between 2 and 200),
  telephone text not null check (telephone ~ '^[0-9]{8,15}$'),
  quantite integer not null check (quantite between 1 and 10000),
  moyen_paiement text not null check (moyen_paiement in ('orange_money', 'mtn_momo')),
  total_ttc bigint not null,
  acompte bigint not null check (acompte > 0),
  conditions_texte text not null check (length(conditions_texte) between 1 and 2000),
  conditions_acceptees_le timestamptz not null,
  statut text not null default 'en_attente' check (statut in (
    'en_attente', 'expiree', 'validee', 'servie', 'soldee', 'acompte_conserve', 'a_rembourser', 'remboursee', 'annulee')),
  expire_le timestamptz not null,
  validee_le timestamptz,
  servie_le timestamptz,
  solde_avant timestamptz,
  motif text check (motif in ('campagne_annulee', 'seuil_non_atteint', 'retrait_client', 'non_servie', 'complet')),
  traite_le timestamptz,
  traite_par uuid,
  cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, reference),
  unique (organisation_id, jeton_suivi_hache),
  check (acompte < total_ttc),
  check ((statut in ('validee', 'servie', 'soldee', 'acompte_conserve')) <= (validee_le is not null)),
  check ((statut in ('servie', 'soldee', 'acompte_conserve')) = (servie_le is not null and solde_avant is not null)),
  check ((statut in ('a_rembourser', 'remboursee')) <= (motif is not null)),
  foreign key (organisation_id, campagne_id) references campagnes_arrivage(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, traite_par) references utilisateurs(organisation_id, id)
);
create index inscriptions_precommande_campagne on inscriptions_precommande (organisation_id, campagne_id, statut, validee_le);
create index inscriptions_precommande_echeance on inscriptions_precommande (expire_le) where statut = 'en_attente';
create index inscriptions_precommande_solde on inscriptions_precommande (solde_avant) where statut = 'servie';

-- L'acompte se paie par le circuit du lot 2 : un paiement en ligne vise une commande ou une inscription, jamais les deux.
-- « rembourse » : le trésorier a rendu l'argent, une seule fois.
alter table paiements_en_ligne
  alter column commande_id drop not null,
  add column inscription_id uuid,
  add column rembourse_le timestamptz,
  add column rembourse_par uuid,
  add column reference_remboursement text check (length(reference_remboursement) <= 100),
  add foreign key (organisation_id, inscription_id) references inscriptions_precommande(organisation_id, id),
  add foreign key (organisation_id, rembourse_par) references utilisateurs(organisation_id, id);
do $$
declare n text;
begin
  for n in select conname from pg_constraint
    where conrelid = 'paiements_en_ligne'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) like '%statut%' or pg_get_constraintdef(oid) like '%motif%')
  loop
    execute format('alter table paiements_en_ligne drop constraint %I', n);
  end loop;
end $$;
alter table paiements_en_ligne
  add constraint paiements_en_ligne_statut_check check (statut in ('lance', 'reussi', 'echoue', 'a_rembourser', 'rembourse')),
  add constraint paiements_en_ligne_motif_check check (motif in (
    'expiree', 'annulee', 'deja_payee', 'campagne_annulee', 'seuil_non_atteint', 'retrait_client', 'non_servie', 'complet')),
  add constraint paiements_en_ligne_motif_present check ((statut in ('a_rembourser', 'rembourse')) = (motif is not null)),
  add constraint paiements_en_ligne_rembourse check ((statut = 'rembourse') = (rembourse_le is not null)),
  add constraint paiements_en_ligne_cible check (num_nonnulls(commande_id, inscription_id) = 1);
create index paiements_en_ligne_inscription on paiements_en_ligne (organisation_id, inscription_id) where inscription_id is not null;

-- Le solde d'une précommande se paie par une commande en ligne qui porte l'acompte déjà versé.
alter table commandes_web
  add column inscription_id uuid,
  add column acompte bigint not null default 0,
  add constraint commandes_web_acompte check (acompte >= 0 and (acompte = 0 or acompte < total_ttc)),
  add constraint commandes_web_acompte_inscription check ((inscription_id is null) = (acompte = 0)),
  add foreign key (organisation_id, inscription_id) references inscriptions_precommande(organisation_id, id);
create index commandes_web_inscription on commandes_web (organisation_id, inscription_id) where inscription_id is not null;

-- À l'arrivée, le stock est réservé à l'inscrit ; la réservation se lève par l'inscription.
alter table reservations_stock
  add column inscription_id uuid,
  drop constraint reservations_stock_auteur,
  add constraint reservations_stock_auteur check (auteur_id is not null or commande_web_id is not null or inscription_id is not null),
  add foreign key (organisation_id, inscription_id) references inscriptions_precommande(organisation_id, id);
create index reservations_stock_inscription on reservations_stock (organisation_id, inscription_id) where inscription_id is not null;

-- L'acompte s'impute sur la facture finale par un règlement relié, sans nouvel encaissement : l'argent est déjà
-- dans le portefeuille. Un acompte ne s'impute qu'une fois.
alter table reglements
  add column acompte_id uuid,
  add foreign key (organisation_id, acompte_id) references paiements_en_ligne(organisation_id, id);
create unique index reglements_acompte_une_fois on reglements (organisation_id, acompte_id) where acompte_id is not null and annule_le is null;

create or replace function tresorerie_reglement() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_entite uuid;
begin
  if tg_op = 'INSERT' then
    if new.acompte_id is not null then return null; end if;
    select entite_id into v_entite from documents_vente where id = new.facture_id;
    perform tresorerie_encaisser(new.organisation_id, v_entite, new.moyen, new.montant, 'Reçu ' || new.numero_recu, new.reference, 'reglement', new.id);
  elsif old.annule_le is null and new.annule_le is not null then
    perform tresorerie_annuler_source(new.organisation_id, new.id, new.motif_annulation);
  end if;
  return null;
end $$;

-- Un paiement en ligne ne se rembourse qu'une fois.
create unique index mouvements_remboursement_en_ligne on mouvements_portefeuille (organisation_id, source_id)
  where type = 'sortie' and source_type = 'remboursement_en_ligne';

do $$
declare t text;
begin
  foreach t in array array['campagnes_arrivage', 'inscriptions_precommande'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
    execute format('create trigger audit after insert or update on %I for each row execute function audit_ligne()', t);
  end loop;
end $$;
grant select, insert, update on campagnes_arrivage, inscriptions_precommande to erp_app;
