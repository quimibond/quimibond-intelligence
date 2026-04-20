-- Fase 2 Limpieza: archive + NULL bogus cfdi_uuid values in odoo_invoices.
-- 5,321 rows had duplicated UUIDs due to _build_cfdi_map addon bug
-- (iterates doc.invoice_ids M2M instead of using doc.move_id; the UUID
-- of the complemento de pago P gets assigned to every invoice the
-- payment covered). Archive affected rows for forensics, NULL the
-- cfdi fields on the live rows, then add UNIQUE partial index.
-- Addon fix tracked separately.

BEGIN;
  -- 1. Create archive table (schema mirrors odoo_invoices + archival metadata)
  CREATE TABLE IF NOT EXISTS public.odoo_invoices_archive_dup_cfdi_uuid_2026_04_20 AS
    SELECT *,
           now() AS archived_at,
           'Fase 2 — duplicated cfdi_uuid from _build_cfdi_map bug (M2M invoice_ids)'::text AS archive_reason
    FROM public.odoo_invoices
    WHERE cfdi_uuid IS NOT NULL
      AND cfdi_uuid IN (
        SELECT cfdi_uuid FROM public.odoo_invoices
        WHERE cfdi_uuid IS NOT NULL
        GROUP BY cfdi_uuid HAVING COUNT(*) > 1
      )
    -- WITH NO DATA clause NOT used — we want the rows
    ;

  -- 2. NULL the bogus cfdi_uuid and cfdi_sat_state on the live rows
  UPDATE public.odoo_invoices
  SET cfdi_uuid = NULL,
      cfdi_sat_state = NULL
  WHERE cfdi_uuid IS NOT NULL
    AND cfdi_uuid IN (
      SELECT cfdi_uuid FROM public.odoo_invoices
      WHERE cfdi_uuid IS NOT NULL
      GROUP BY cfdi_uuid HAVING COUNT(*) > 1
    );

  -- 3. Add UNIQUE partial index (safe now, no dups)
  CREATE UNIQUE INDEX IF NOT EXISTS uq_odoo_invoices_cfdi_uuid
    ON public.odoo_invoices (cfdi_uuid)
    WHERE cfdi_uuid IS NOT NULL;

  -- 4. Audit log
  INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed) VALUES
    ('create_table', 'odoo_invoices_archive_dup_cfdi_uuid_2026_04_20', 'Fase 2 — archive 5,321 rows with bogus duplicated cfdi_uuid (addon _build_cfdi_map bug)', 'CREATE TABLE AS SELECT … WHERE cfdi_uuid IN (dup_uuids)'),
    ('update_table', 'odoo_invoices', 'Fase 2 — NULL cfdi_uuid + cfdi_sat_state en ~5,321 rows con UUID duplicado', 'UPDATE odoo_invoices SET cfdi_uuid=NULL, cfdi_sat_state=NULL WHERE cfdi_uuid IN (dup_uuids)'),
    ('create_index', 'odoo_invoices', 'Fase 2 — UNIQUE partial index uq_odoo_invoices_cfdi_uuid para prevenir re-introducción de duplicados (root cause = addon _build_cfdi_map bug, fix pendiente)', 'CREATE UNIQUE INDEX uq_odoo_invoices_cfdi_uuid ON odoo_invoices (cfdi_uuid) WHERE cfdi_uuid IS NOT NULL');
COMMIT;
