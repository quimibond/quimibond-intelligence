-- date_has_discrepancy auto-compute trigger — Silver SP2 §5.1 deviation follow-up
--
-- date_has_discrepancy could not be a GENERATED column because
-- fecha_timbrado::date (timestamptz→date) is STABLE, not IMMUTABLE.
-- This BEFORE INSERT OR UPDATE trigger replicates the intended semantics
-- without the immutability constraint.
--
-- Expression (matches spec §5.1 intent):
--   invoice_date IS NOT NULL AND fecha_timbrado IS NOT NULL
--   AND ABS(invoice_date - fecha_timbrado::date) > 3
BEGIN;

CREATE OR REPLACE FUNCTION compute_canonical_invoices_date_discrepancy()
RETURNS trigger AS $$
BEGIN
  NEW.date_has_discrepancy :=
    NEW.invoice_date IS NOT NULL
    AND NEW.fecha_timbrado IS NOT NULL
    AND ABS(NEW.invoice_date - NEW.fecha_timbrado::date) > 3;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_canonical_invoices_date_discrepancy ON canonical_invoices;
CREATE TRIGGER trg_canonical_invoices_date_discrepancy
  BEFORE INSERT OR UPDATE ON canonical_invoices
  FOR EACH ROW EXECUTE FUNCTION compute_canonical_invoices_date_discrepancy();

CREATE INDEX IF NOT EXISTS ix_canonical_invoices_date_disc
  ON canonical_invoices (date_has_discrepancy) WHERE date_has_discrepancy = true;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_trigger','canonical_invoices',
        'SP2 Task 1b: date_has_discrepancy BEFORE INSERT OR UPDATE trigger + index',
        '20260422_sp2_01b_date_has_discrepancy_trigger.sql','silver-sp2',true);

COMMIT;
