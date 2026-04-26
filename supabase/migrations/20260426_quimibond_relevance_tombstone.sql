-- 2026-04-26 — Quimibond relevance tombstone
--
-- The CEO's Syntage subscription is shared between Quimibond's RFC
-- (PNT920218IW5) and several personal RFCs:
--   MIDJ4003178X9  José Mizrahi Daniel (CEO)
--   MIPJ691003QJ1  Jacobo Mizrahi Penhos
--   AOOA920503IF6  Alejandra Altos Ortiz
--   plus condominios + asociaciones familiares
--
-- Result: Syntage syncs CFDIs from those RFCs into syntage_invoices, the
-- silver matchers propagate them to canonical_invoices and
-- canonical_credit_notes, and they end up in dashboards as if they were
-- corporate transactions. The user spotted Alejandra Altos Ortiz on the
-- inbox/empresas pages.
--
-- The rule: a CFDI is "Quimibond-relevant" iff Quimibond's RFC appears as
-- emisor OR receptor. Personal CFDIs (Mizrahi-to-condominio,
-- bank-statement-to-Mizrahi, etc.) get tombstoned with a boolean column
-- and excluded by every read helper.
--
-- Why a tombstone column instead of DELETE:
--   1. Auditability — the personal CFDIs still live in Bronze for the
--      operator's own tax records (he might want to see them later).
--   2. Reversibility — flipping is_quimibond_relevant=true brings them
--      back without re-syncing.
--   3. execute_safe_ddl() doesn't allow DELETE anyway.
--
-- Already applied to production via execute_safe_ddl on 2026-04-26.
-- This file documents the change for repo-history parity.
--
-- Backfill counts:
--   syntage_invoices:        748 / 129,690 flagged (0.58%)
--   canonical_invoices:      609 / 84,490  flagged (0.72%)
--   canonical_credit_notes:    2 / 2,208   flagged (0.09%)

-- ── Tombstone columns (default true so existing reads see no change). ───
ALTER TABLE syntage_invoices
  ADD COLUMN IF NOT EXISTS is_quimibond_relevant boolean NOT NULL DEFAULT true;

ALTER TABLE canonical_invoices
  ADD COLUMN IF NOT EXISTS is_quimibond_relevant boolean NOT NULL DEFAULT true;

ALTER TABLE canonical_credit_notes
  ADD COLUMN IF NOT EXISTS is_quimibond_relevant boolean NOT NULL DEFAULT true;

-- ── Backfill (NULL-safe: rows without RFCs default to relevant=true). ───
UPDATE syntage_invoices
SET    is_quimibond_relevant = false
WHERE  emisor_rfc IS NOT NULL
  AND  receptor_rfc IS NOT NULL
  AND  emisor_rfc   <> 'PNT920218IW5'
  AND  receptor_rfc <> 'PNT920218IW5'
  AND  is_quimibond_relevant = true;

UPDATE canonical_invoices
SET    is_quimibond_relevant = false
WHERE  emisor_rfc IS NOT NULL
  AND  receptor_rfc IS NOT NULL
  AND  emisor_rfc   <> 'PNT920218IW5'
  AND  receptor_rfc <> 'PNT920218IW5'
  AND  is_quimibond_relevant = true;

UPDATE canonical_credit_notes
SET    is_quimibond_relevant = false
WHERE  emisor_rfc IS NOT NULL
  AND  receptor_rfc IS NOT NULL
  AND  emisor_rfc   <> 'PNT920218IW5'
  AND  receptor_rfc <> 'PNT920218IW5'
  AND  is_quimibond_relevant = true;

-- ── Trigger fns: keep the flag accurate on every insert / RFC update. ───
-- Two fns because they live on different tables but the rule is identical.
-- canonical_invoices and canonical_credit_notes share the same function.

CREATE OR REPLACE FUNCTION mark_personal_cfdi_syntage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.emisor_rfc IS NOT NULL
     AND NEW.receptor_rfc IS NOT NULL
     AND NEW.emisor_rfc   <> 'PNT920218IW5'
     AND NEW.receptor_rfc <> 'PNT920218IW5' THEN
    NEW.is_quimibond_relevant := false;
  ELSE
    NEW.is_quimibond_relevant := true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION mark_personal_cfdi_canonical()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.emisor_rfc IS NOT NULL
     AND NEW.receptor_rfc IS NOT NULL
     AND NEW.emisor_rfc   <> 'PNT920218IW5'
     AND NEW.receptor_rfc <> 'PNT920218IW5' THEN
    NEW.is_quimibond_relevant := false;
  ELSE
    NEW.is_quimibond_relevant := true;
  END IF;
  RETURN NEW;
END;
$$;

-- ── Triggers ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_mark_personal_syntage_invoices ON syntage_invoices;
CREATE TRIGGER trg_mark_personal_syntage_invoices
BEFORE INSERT OR UPDATE OF emisor_rfc, receptor_rfc
ON syntage_invoices
FOR EACH ROW
EXECUTE FUNCTION mark_personal_cfdi_syntage();

DROP TRIGGER IF EXISTS trg_mark_personal_canonical_invoices ON canonical_invoices;
CREATE TRIGGER trg_mark_personal_canonical_invoices
BEFORE INSERT OR UPDATE OF emisor_rfc, receptor_rfc
ON canonical_invoices
FOR EACH ROW
EXECUTE FUNCTION mark_personal_cfdi_canonical();

DROP TRIGGER IF EXISTS trg_mark_personal_canonical_credit_notes ON canonical_credit_notes;
CREATE TRIGGER trg_mark_personal_canonical_credit_notes
BEFORE INSERT OR UPDATE OF emisor_rfc, receptor_rfc
ON canonical_credit_notes
FOR EACH ROW
EXECUTE FUNCTION mark_personal_cfdi_canonical();

-- ── Partial indexes (small set, fast NOT EXISTS / EQ filters). ──────────
CREATE INDEX IF NOT EXISTS idx_syntage_invoices_quimibond_relevant
  ON syntage_invoices (is_quimibond_relevant)
  WHERE is_quimibond_relevant = false;

CREATE INDEX IF NOT EXISTS idx_canonical_invoices_quimibond_relevant
  ON canonical_invoices (is_quimibond_relevant)
  WHERE is_quimibond_relevant = false;

CREATE INDEX IF NOT EXISTS idx_canonical_credit_notes_quimibond_relevant
  ON canonical_credit_notes (is_quimibond_relevant)
  WHERE is_quimibond_relevant = false;
