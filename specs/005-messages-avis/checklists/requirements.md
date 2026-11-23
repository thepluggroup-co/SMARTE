# Specification Quality Checklist: Messages automatiques et avis publiés de GLOMARI (lot 4, partie A)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-23
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Première relecture : FR-010 interdisait tout montant dans les messages de colis, alors que le client qui paie à la livraison doit connaître la somme à préparer. Corrigé (FR-010, FR-012, FR-013 et parcours 1, scénario 2).
- Le découpage du lot 4 en trois parties a été tranché par le responsable (Clarifications) ; les parties B et C sont nommées dans les hypothèses comme hors de cette spécification.
- Les seuils (heures d'envoi, tentatives, quatorze jours, rappel à deux jours) sont des valeurs par défaut documentées dans les hypothèses ; ils peuvent être revus au plan sans changer la spécification.
- Après `/speckit-analyze` : corrections appliquées. C1 : les colis de la Marketplace ne portent pas leur facture, donc la demande d'avis passe par leur commande en ligne (FR-020, SC-003). U1 : « prêt à retirer » seulement pour une commande en agence ou en point relais, sans second code ensuite (FR-012, FR-013). U2 : renvoi avec un numéro corrigé (FR-005). Plus I1, I2, I3 et T1 (réglage lu dès la mise en file, statut « annulé », adresse publique, « ticket de suivi »).
- Prêt pour `/speckit-plan` (ou `/speckit-clarify` si le responsable veut revoir les canaux par défaut ou la demande d'avis après achat en magasin).
