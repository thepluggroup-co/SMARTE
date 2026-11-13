-- Une facture fournisseur validée reste annulable : la colonne libre s'appelle annulee_le.
create or replace function facture_fournisseur_figee() returns trigger language plpgsql as $$
declare libres text[] := array['statut', 'motif_annulation', 'annulee_le', 'fournisseur_id'];
begin
  if old.statut = 'brouillon' then return new; end if;
  if (to_jsonb(new) - libres) <> (to_jsonb(old) - libres) then
    raise exception 'Une facture fournisseur validée ne peut pas être modifiée';
  end if;
  if new.fournisseur_id <> old.fournisseur_id and not exists (select 1 from tiers t where t.id = old.fournisseur_id and t.fusionne_vers = new.fournisseur_id) then
    raise exception 'Une facture fournisseur validée ne peut pas être modifiée';
  end if;
  return new;
end $$;

-- Le code n'est un secret que sur les billets et les accès aux cours : ailleurs, son changement reste au journal.
create or replace function audit_masques() returns text[] language sql immutable as $$ select array['mot_de_passe_hash', 'echecs_connexion', 'verrouille_jusqu', 'derniere_connexion', 'modifie_le', 'totp_secret_chiffre', 'totp_dernier_pas', 'mot_de_passe_provisoire', 'code_client', 'code_confirmation', 'code_portail', 'cv_jeton', 'compte_paiement_chiffre', 'secret_chiffre', 'cle_hash', 'montant_salaire'] $$;
create or replace function audit_ligne() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  masques text[] := audit_masques() || case when tg_table_name in ('billets', 'acces_cours') then array['code'] else array[]::text[] end;
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
