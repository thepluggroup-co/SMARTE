-- Canal en ligne de GLOMARI (lot 1) : boutique, lieux qui servent les commandes, commandes de la Marketplace,
-- réservation du stock et quantité vendable. Zones, points relais, colis et fiches clients existants sont réutilisés.

-- Une boutique par branche ; une seule ouverte par organisation, celle que servent les routes /marketplace/:org.
create table config_canal (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  entite_id uuid not null,
  actif boolean not null default false,
  cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, entite_id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);
create unique index config_canal_ouverte on config_canal (organisation_id) where actif;

-- Lieux dont le stock est vendu en ligne. Le lieu est désigné partout par son entite_id.
create table lieux_canal (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  config_id uuid not null,
  entite_id uuid not null,
  nom_public text not null check (length(trim(nom_public)) between 1 and 100),
  actif boolean not null default true,
  unique (organisation_id, id),
  unique (organisation_id, config_id, entite_id),
  foreign key (organisation_id, config_id) references config_canal(organisation_id, id),
  foreign key (organisation_id, entite_id) references entites(organisation_id, id)
);

-- Commande d'un client de la Marketplace. Le lot 1 n'écrit que reservee, annulee et expiree ;
-- payee, facturee, expediee et livree viendront avec le paiement (lot 2).
create table commandes_web (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  entite_id uuid not null,
  lieu_id uuid not null,
  tiers_id uuid not null,
  reference text not null check (reference ~ '^WEB-[0-9]{4}-[0-9]{6}$'),
  jeton_suivi_hache text not null check (jeton_suivi_hache ~ '^[0-9a-f]{64}$'),
  statut text not null default 'reservee'
    check (statut in ('reservee', 'payee', 'facturee', 'expediee', 'livree', 'annulee', 'expiree')),
  nom_client text not null check (length(trim(nom_client)) between 2 and 200),
  telephone text not null check (telephone ~ '^[0-9]{8,15}$'),
  mode_livraison text not null check (mode_livraison in ('domicile', 'agence_voyage', 'point_relais', 'retrait_magasin')),
  zone_id uuid,
  point_relais_id uuid,
  adresse text check (length(adresse) <= 500),
  note text check (length(note) <= 1000),
  moyen_paiement text not null check (moyen_paiement in ('orange_money', 'mtn_momo', 'a_la_livraison')),
  canal text not null default 'marketplace' check (canal in ('marketplace')),
  code_affilie text check (length(code_affilie) <= 50),
  frais_livraison bigint not null default 0 check (frais_livraison >= 0),
  total_ht bigint not null check (total_ht >= 0),
  total_ttc bigint not null,
  expire_le timestamptz not null,
  colis_id uuid,
  motif text check (length(motif) <= 500),
  traite_par uuid,
  traite_le timestamptz,
  cree_le timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, reference),
  unique (organisation_id, jeton_suivi_hache),
  check (total_ttc >= total_ht),
  check ((mode_livraison in ('domicile', 'agence_voyage')) = (zone_id is not null)),
  check ((mode_livraison = 'point_relais') = (point_relais_id is not null)),
  check (mode_livraison not in ('domicile', 'agence_voyage') or (adresse is not null and length(trim(adresse)) > 0)),
  check (colis_id is null or moyen_paiement = 'a_la_livraison'),
  foreign key (organisation_id, entite_id) references config_canal(organisation_id, entite_id),
  foreign key (organisation_id, lieu_id) references entites(organisation_id, id),
  foreign key (organisation_id, tiers_id) references tiers(organisation_id, id),
  foreign key (organisation_id, zone_id) references zones_livraison(organisation_id, id),
  foreign key (organisation_id, point_relais_id) references points_relais(organisation_id, id),
  foreign key (organisation_id, colis_id) references colis(organisation_id, id),
  foreign key (organisation_id, traite_par) references utilisateurs(organisation_id, id)
);
create index commandes_web_branche on commandes_web (organisation_id, entite_id, cree_le desc);
create index commandes_web_echeance on commandes_web (expire_le) where statut = 'reservee' and colis_id is null;

create table lignes_commande_web (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  commande_id uuid not null,
  produit_id uuid not null,
  quantite integer not null check (quantite between 1 and 10000),
  prix_unitaire_ht bigint not null check (prix_unitaire_ht >= 0),
  prix_unitaire_ttc bigint not null,
  taux_taxe numeric(6,3) not null default 0 check (taux_taxe between 0 and 100),
  total_ht bigint not null check (total_ht >= 0),
  total_ttc bigint not null,
  unique (organisation_id, id),
  unique (organisation_id, commande_id, produit_id),
  check (prix_unitaire_ttc >= prix_unitaire_ht),
  check (total_ttc >= total_ht),
  foreign key (organisation_id, commande_id) references commandes_web(organisation_id, id),
  foreign key (organisation_id, produit_id) references produits(organisation_id, id)
);
create index lignes_commande_web_commande on lignes_commande_web (organisation_id, commande_id);

-- Une commande web réserve sans utilisateur connecté ; sa réservation se lève par la commande.
alter table reservations_stock
  add column commande_web_id uuid,
  alter column auteur_id drop not null,
  add constraint reservations_stock_auteur check (auteur_id is not null or commande_web_id is not null),
  add foreign key (organisation_id, commande_web_id) references commandes_web(organisation_id, id);
create index reservations_stock_commande_web on reservations_stock (organisation_id, commande_web_id) where commande_web_id is not null;

-- Formule unique de la quantité vendable d'un lieu : celle de la caisse, du canal et des événements.
create function quantite_vendable(p_entite uuid, p_produit uuid) returns numeric
language sql stable set search_path = public, pg_temp as $$
  select coalesce((select sum(quantite) from mouvements_stock where entite_id = p_entite and produit_id = p_produit), 0)
    - coalesce((select sum(quantite) from reservations_stock where entite_id = p_entite and produit_id = p_produit
        and levee_le is null and (expire_le is null or expire_le >= (now() at time zone 'Africa/Douala')::date)), 0)
    - coalesce((select sum(quantite) from avaries where entite_id = p_entite and produit_id = p_produit and statut = 'constatee'), 0)
$$;
grant execute on function quantite_vendable(uuid, uuid) to erp_app;

do $$
declare t text;
begin
  foreach t in array array['config_canal', 'lieux_canal', 'commandes_web', 'lignes_commande_web'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy cloison on %I using (organisation_id = org_courante()) with check (organisation_id = org_courante())', t);
  end loop;
end $$;
create trigger audit after insert or update on config_canal for each row execute function audit_ligne();
create trigger audit after insert or update on lieux_canal for each row execute function audit_ligne();
create trigger audit after insert or update on commandes_web for each row execute function audit_ligne();
grant select, insert, update on config_canal, lieux_canal, commandes_web, lignes_commande_web to erp_app;

-- Événements pour la Marketplace, livrés par les webhooks existants. Des déclencheurs plutôt que du code :
-- le stock et le catalogue s'écrivent à des dizaines d'endroits, un oubli fausserait le cache de la Marketplace.
-- Limités aux lieux et à la branche d'une boutique ouverte : rien pour GTA.
create function canal_stock_modifie() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from lieux_canal l join config_canal k on k.id = l.config_id where l.entite_id = new.entite_id and l.actif and k.actif) then
    insert into evenements (organisation_id, type, charge) values (new.organisation_id, 'stock.disponibilite_modifiee',
      jsonb_build_object('produit_id', new.produit_id, 'lieu_id', new.entite_id, 'disponible', greatest(quantite_vendable(new.entite_id, new.produit_id), 0)));
  end if;
  return null;
end $$;
create trigger canal_stock after insert on mouvements_stock for each row execute function canal_stock_modifie();
create trigger canal_stock after insert or update on reservations_stock for each row execute function canal_stock_modifie();
create trigger canal_stock after insert or update on avaries for each row execute function canal_stock_modifie();

create function canal_publier_article(p_organisation uuid, p_produit uuid) returns void language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from produits p join config_canal k on k.actif and k.entite_id = entite_branche(p.entite_id) where p.id = p_produit) then
    insert into evenements (organisation_id, type, charge) values (p_organisation, 'catalogue.article_modifie', jsonb_build_object('produit_id', p_produit));
  end if;
end $$;
grant execute on function canal_publier_article(uuid, uuid) to erp_app;

-- Seules les colonnes que la Marketplace affiche comptent : un nouveau coût moyen ne publie rien.
create function canal_produit_modifie() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and row(old.code, old.nom, old.unite, old.type, old.actif, old.suivi_stock, old.prix_vente, old.taux_taxe,
      old.paliers_actif, old.mode_palier, old.categorie_id, old.marque_id, old.entite_id)
    is not distinct from row(new.code, new.nom, new.unite, new.type, new.actif, new.suivi_stock, new.prix_vente, new.taux_taxe,
      new.paliers_actif, new.mode_palier, new.categorie_id, new.marque_id, new.entite_id) then
    return null;
  end if;
  perform canal_publier_article(new.organisation_id, new.id);
  return null;
end $$;
create trigger canal_article after insert or update on produits for each row execute function canal_produit_modifie();

create function canal_annexe_modifiee() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    perform canal_publier_article(old.organisation_id, old.produit_id);
  else
    perform canal_publier_article(new.organisation_id, new.produit_id);
  end if;
  return null;
end $$;
create trigger canal_article after insert or update or delete on promotions for each row execute function canal_annexe_modifiee();
create trigger canal_article after insert or update or delete on paliers_prix for each row execute function canal_annexe_modifiee();
create trigger canal_article after insert or update or delete on photos_produits for each row execute function canal_annexe_modifiee();
