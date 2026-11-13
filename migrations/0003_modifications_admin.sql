-- Certificat délivré par exception : le motif reste attaché au certificat.
alter table certificats add column derogation_motif text, add column derogation_par uuid,
  add foreign key (organisation_id, derogation_par) references utilisateurs(organisation_id, id);

-- Permet de remplacer l'échéancier d'un apprenant ; chaque suppression reste journalisée.
grant delete on echeances to erp_app;
