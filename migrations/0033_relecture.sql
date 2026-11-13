-- Corrections issues de la relecture.
alter table registre_organisations add column statut text not null default 'active';
update registre_organisations r set statut = o.statut from organisations o where o.id = r.id;
create or replace function inscrire_organisation() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into registre_organisations (id, statut) values (new.id, new.statut) on conflict (id) do update set statut = excluded.statut;
  return new;
end $$;
drop trigger registre on organisations;
create trigger registre after insert or update of statut on organisations for each row execute function inscrire_organisation();

alter table utilisateurs add column mot_de_passe_provisoire boolean not null default false;

-- Un montant saisi ne change plus. Seules les colonnes citées restent modifiables, et le lien d'une fusion de fiches.
create or replace function champs_figes() returns trigger language plpgsql as $$
declare
  libres text[] := tg_argv;
  a jsonb;
  b jsonb;
begin
  if tg_op = 'DELETE' then raise exception 'Cette ligne ne peut pas être supprimée'; end if;
  a := to_jsonb(old) - libres;
  b := to_jsonb(new) - libres;
  if a <> b then raise exception 'Cette ligne ne peut pas être modifiée'; end if;
  return new;
end $$;
create or replace function facture_fournisseur_figee() returns trigger language plpgsql as $$
begin
  if old.statut = 'brouillon' then return new; end if;
  if (to_jsonb(new) - array['statut', 'motif_annulation', 'annule_le', 'annule_par', 'fournisseur_id']) <> (to_jsonb(old) - array['statut', 'motif_annulation', 'annule_le', 'annule_par', 'fournisseur_id']) then
    raise exception 'Une facture fournisseur validée ne peut pas être modifiée';
  end if;
  if new.fournisseur_id <> old.fournisseur_id and not exists (select 1 from tiers t where t.id = old.fournisseur_id and t.fusionne_vers = new.fournisseur_id) then
    raise exception 'Une facture fournisseur validée ne peut pas être modifiée';
  end if;
  return new;
end $$;
create trigger fige before update on factures_fournisseur for each row execute function facture_fournisseur_figee();
create trigger fige before update or delete on paiements_fournisseur for each row execute function champs_figes('annule_le', 'annule_par', 'motif_annulation');
create trigger fige before update or delete on versements_paie for each row execute function champs_figes('__aucun');
create trigger fige before update or delete on paiements_univ for each row execute function champs_figes('annule_le', 'motif_annulation');
create trigger fige before update or delete on rendus_devoir for each row execute function champs_figes('note', 'commentaire', 'corrige_par', 'contenu', 'rendu_le');
revoke update, delete on versements_paie from erp_app;
create function billet_fige() returns trigger language plpgsql as $$
begin
  if old.statut = 'paye' and (new.montant_paye <> old.montant_paye or new.numero is distinct from old.numero) and new.statut <> 'annule' then
    raise exception 'Un billet payé ne peut pas être modifié';
  end if;
  return new;
end $$;
create trigger fige before update on billets for each row execute function billet_fige();

create function journal_versement() returns trigger language plpgsql as $$
begin
  perform journal_evenement('paie.versement', jsonb_build_object('bulletin', new.bulletin_id, 'portefeuille', new.portefeuille_id));
  return null;
end $$;
-- Le journal d'audit ne garde ni les secrets d'accès ni les montants de salaire.
create or replace function audit_masques() returns text[] language sql immutable as $$ select array['mot_de_passe_hash', 'echecs_connexion', 'verrouille_jusqu', 'derniere_connexion', 'modifie_le', 'totp_secret_chiffre', 'totp_dernier_pas', 'mot_de_passe_provisoire', 'code', 'code_client', 'cv_jeton', 'compte_paiement_chiffre', 'secret_chiffre', 'cle_hash', 'montant_salaire'] $$;
create or replace function audit_ligne() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  masques text[] := audit_masques();
  v_avant jsonb;
  v_apres jsonb;
begin
  if tg_op <> 'INSERT' then v_avant := to_jsonb(old) - masques; end if;
  if tg_op <> 'DELETE' then v_apres := to_jsonb(new) - masques; end if;
  if tg_op = 'UPDATE' and v_avant = v_apres then return new; end if;
  perform journal_ecrire(
    coalesce(new.organisation_id, old.organisation_id), lower(tg_op), tg_table_name,
    coalesce(new.id, old.id), v_avant, v_apres);
  return coalesce(new, old);
end $$;
drop trigger if exists audit on versements_paie;
create trigger audit after insert on versements_paie for each row execute function journal_versement();
