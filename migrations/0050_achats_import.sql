-- Achats à l'import de GLOMARI (lot 3, partie B, de la fiche technique globale) : acomptes au fournisseur avant sa facture,
-- achats en devise, dépôt-vente des fournisseurs locaux, alerte de couverture de stock (règle R11).

-- Un versement au fournisseur d'un bon de commande, avant sa facture (règle R5 : les fabricants sont payés d'avance).
create table acomptes_fournisseur (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  commande_id uuid not null,
  fournisseur_id uuid not null,
  portefeuille_id uuid not null,
  montant bigint not null check (montant > 0),
  date_versement date not null,
  reference text check (length(reference) <= 200),
  devise text check (devise ~ '^[A-Z]{3}$'),
  montant_devise numeric(16,2) check (montant_devise > 0),
  taux numeric(14,4) check (taux > 0),
  annule_le timestamptz,
  motif_annulation text check (length(motif_annulation) between 5 and 500),
  annule_par uuid,
  auteur_id uuid not null,
  cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  check ((devise is null) = (montant_devise is null) and (devise is null) = (taux is null)),
  check ((annule_le is null) = (motif_annulation is null)),
  foreign key (organisation_id, commande_id) references commandes_achat(organisation_id, id),
  foreign key (organisation_id, fournisseur_id) references tiers(organisation_id, id),
  foreign key (organisation_id, portefeuille_id) references portefeuilles(organisation_id, id),
  foreign key (organisation_id, annule_par) references utilisateurs(organisation_id, id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create index acomptes_fournisseur_commande on acomptes_fournisseur (organisation_id, commande_id);

-- L'acompte s'impute sur la facture du fournisseur par un paiement relié, sans nouvelle sortie d'argent.
alter table paiements_fournisseur
  add column acompte_id uuid,
  add foreign key (organisation_id, acompte_id) references acomptes_fournisseur(organisation_id, id);
create index paiements_fournisseur_acompte on paiements_fournisseur (organisation_id, acompte_id) where acompte_id is not null;

-- Un acompte n'est jamais imputé au-delà de son montant, ni après son annulation, même en concurrence.
create function acompte_non_depasse() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_montant bigint; v_annule timestamptz; v_impute bigint;
begin
  if new.acompte_id is null then return new; end if;
  select montant, annule_le into v_montant, v_annule from acomptes_fournisseur where id = new.acompte_id for update;
  select coalesce(sum(montant), 0) into v_impute from paiements_fournisseur where acompte_id = new.acompte_id and annule_le is null;
  if v_annule is not null or v_impute + new.montant > v_montant then
    raise exception 'acompte_insuffisant' using errcode = 'AF001';
  end if;
  return new;
end $$;
create trigger acompte_non_depasse before insert on paiements_fournisseur for each row execute function acompte_non_depasse();

-- Achats en devise : le taux du jour de commande, gardé sur le bon ; les montants restent en FCFA entiers.
alter table commandes_achat
  add column devise text check (devise in ('USD', 'CNY', 'EUR')),
  add column taux numeric(14,4) check (taux > 0),
  add column taux_jour date,
  add constraint commandes_achat_devise check ((devise is null) = (taux is null) and (devise is null) = (taux_jour is null));
alter table lignes_achat add column prix_devise numeric(16,4) check (prix_devise >= 0);

-- Dépôt-vente : un article confié par un fournisseur de la branche ; GLOMARI ne l'achète pas et le paie à la vente.
create table articles_depot (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  produit_id uuid not null,
  fournisseur_id uuid not null,
  actif boolean not null default true,
  cree_par uuid not null,
  cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, produit_id),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id),
  foreign key (organisation_id, fournisseur_id) references tiers(organisation_id, id),
  foreign key (organisation_id, cree_par) references utilisateurs(organisation_id, id)
);

-- Rémunération du fournisseur, datée : une vente prend celle en vigueur ce jour-là. Insertion seule.
create table remunerations_depot (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  produit_id uuid not null,
  mode text not null check (mode in ('prix_fixe', 'commission')),
  prix_reversement bigint check (prix_reversement >= 0),
  commission_pct numeric(5,2) check (commission_pct between 0 and 100),
  depuis_le timestamptz not null default now(),
  auteur_id uuid not null,
  unique (organisation_id, id),
  check ((mode = 'prix_fixe') = (prix_reversement is not null)),
  check ((mode = 'commission') = (commission_pct is not null)),
  foreign key (organisation_id, produit_id) references articles_depot(organisation_id, produit_id),
  foreign key (organisation_id, auteur_id) references utilisateurs(organisation_id, id)
);
create index remunerations_depot_produit on remunerations_depot (organisation_id, produit_id, depuis_le desc);

create table releves_depot (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  branche_id uuid not null,
  fournisseur_id uuid not null,
  numero text not null check (numero ~ '^RDV-[0-9]{4}-[0-9]{6}$'),
  du date not null,
  au date not null,
  total_du bigint not null check (total_du > 0),
  facture_fournisseur_id uuid not null,
  cree_par uuid not null,
  cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, numero),
  check (au >= du),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id),
  foreign key (organisation_id, fournisseur_id) references tiers(organisation_id, id),
  foreign key (organisation_id, facture_fournisseur_id) references factures_fournisseur(organisation_id, id),
  foreign key (organisation_id, cree_par) references utilisateurs(organisation_id, id)
);

-- Une ligne de vente, de retour, de facture ou d'avoir n'entre que dans un seul relevé.
create table lignes_releve_depot (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  releve_id uuid not null,
  source_type text not null check (source_type in ('comptoir', 'retour', 'facture', 'avoir')),
  source_id uuid not null,
  produit_id uuid not null,
  quantite numeric(14,3) not null,
  montant_ht bigint not null,
  montant_du bigint not null,
  vendu_le timestamptz not null,
  unique (organisation_id, id),
  unique (organisation_id, source_type, source_id),
  foreign key (organisation_id, releve_id) references releves_depot(organisation_id, id),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id)
);
create index lignes_releve_depot_releve on lignes_releve_depot (organisation_id, releve_id);

-- Ce que le fournisseur touche pour une ligne vendue, selon la rémunération en vigueur à la date de la vente.
create function remuneration_depot(p_produit uuid, p_quand timestamptz, p_quantite numeric, p_ht bigint) returns bigint
language sql stable set search_path = public, pg_temp as $$
  select case r.mode
    when 'prix_fixe' then round(p_quantite * r.prix_reversement)::bigint
    else round(p_ht * (100 - r.commission_pct) / 100)::bigint end
  from remunerations_depot r where r.produit_id = p_produit and r.depuis_le <= p_quand order by r.depuis_le desc limit 1
$$;
grant execute on function remuneration_depot(uuid, timestamptz, numeric, bigint) to erp_app;

-- Dernière couverture calculée, par branche et catégorie (règle R11 : stock plafonné à deux mois).
create table alertes_couverture (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  branche_id uuid not null,
  categorie_id uuid,
  stock numeric(14,3) not null,
  ventes_90 numeric(14,3) not null,
  couverture_jours numeric(10,1),
  au_dessus boolean not null,
  depasse_depuis date,
  calcule_le date not null,
  unique (organisation_id, id),
  check (au_dessus = (depasse_depuis is not null)),
  foreign key (organisation_id, branche_id) references entites(organisation_id, id),
  foreign key (organisation_id, categorie_id) references categories_articles(organisation_id, id)
);
create unique index alertes_couverture_categorie on alertes_couverture
  (organisation_id, branche_id, coalesce(categorie_id, '00000000-0000-0000-0000-000000000000'::uuid));

do $$
declare t text;
begin
  foreach t in array array['acomptes_fournisseur', 'articles_depot', 'remunerations_depot', 'releves_depot', 'lignes_releve_depot', 'alertes_couverture'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
    execute format('create trigger audit after insert or update on %I for each row execute function audit_ligne()', t);
  end loop;
end $$;
grant select, insert, update on acomptes_fournisseur, articles_depot, alertes_couverture to erp_app;
grant select, insert on remunerations_depot, releves_depot, lignes_releve_depot to erp_app;
-- La fusion de deux fiches reporte le fournisseur d'un relevé ; rien d'autre n'y change.
grant update (fournisseur_id) on releves_depot to erp_app;
