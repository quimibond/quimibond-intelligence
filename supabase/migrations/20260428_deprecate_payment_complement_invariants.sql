-- 2026-04-28: Deprecate payment.complement_without_payment and
-- payment.registered_without_complement invariants.
--
-- BACKGROUND
-- These invariants flagged canonical_payments rows where exactly one of
-- {SAT complemento, Odoo payment} was present. The mental model was 1:1
-- correspondence — every Odoo payment should have a SAT complemento, and
-- vice versa.
--
-- DISCOVERY (2026-04-28 audit, sesión 4)
-- Sampling unmatched rows + amount/date overlap analysis confirmed the 1:1
-- model is wrong:
--   - Odoo "Salarios" journal payments → CFDI Recibo de Nómina (different
--     fiscal instrument), no Complemento de Pago required.
--   - One SAT complemento can cover multiple Odoo bank movements (or none
--     at all).
--   - Many SAT complementos exist for transactions where Quimibond is a
--     third-party (facilitator), not the booked counterparty.
-- Empirical: of 13,776 SAT-only rows in 2021+, only 124 (0.9%) have an
-- Odoo candidate within ±7d ±2% amount. The other 99% are structurally
-- independent transactions, not the same payment from two angles.
--
-- DECISION
-- Cheaper to retire the invariants than to chase 0.9% upside via a real
-- matcher_payment implementation. Preserve the ability to re-enable later
-- if the abstraction changes (e.g. if SAT complementos start mapping 1:1).
--
-- See: docs/superpowers/specs/2026-04-28-payment-invariant-deprecation.md

BEGIN;

UPDATE audit_tolerances
SET enabled = false,
    notes = COALESCE(notes,'') ||
            ' [DISABLED 2026-04-28: SAT complemento / Odoo payment are different fiscal abstractions (1:N or N:1). matcher_payment real ROI = 124 / 13.7k = 0.9%. See migration 20260428_deprecate_payment_complement_invariants.sql.]'
WHERE invariant_key IN (
  'payment.complement_without_payment',
  'payment.registered_without_complement'
);

UPDATE reconciliation_issues
SET resolved_at = now(),
    resolution = 'auto_invariant_deprecated',
    resolution_note = 'Invariant deprecated 2026-04-28: SAT complemento and Odoo payment are different fiscal abstractions (Mexican CFDI rules: nómina no requiere complemento; un complemento puede cubrir varios pagos bancarios o ninguno). 1:1 model invalid. matcher_payment real upside = 0.9%. See migration 20260428_deprecate_payment_complement_invariants.sql.'
WHERE invariant_key IN (
  'payment.complement_without_payment',
  'payment.registered_without_complement'
)
  AND resolved_at IS NULL;

COMMIT;
