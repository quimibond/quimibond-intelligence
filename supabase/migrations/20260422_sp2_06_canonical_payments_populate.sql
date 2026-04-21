BEGIN;

-- ====================================================================
-- 6a. Insert Odoo payment rows
-- ====================================================================
INSERT INTO canonical_payments (
  canonical_id, odoo_payment_id, direction,
  amount_odoo, amount_mxn_odoo,
  currency_odoo, payment_date_odoo,
  payment_method_odoo, journal_name, is_reconciled, reconciled_invoices_count,
  odoo_ref, odoo_partner_id, counterparty_company_id,
  has_odoo_record, sources_present, source_hashes
)
SELECT
  'odoo:' || oap.id::text,
  oap.id,
  CASE oap.payment_type WHEN 'inbound' THEN 'received' ELSE 'sent' END,
  oap.amount,
  COALESCE(oap.amount_signed, oap.amount),
  oap.currency, oap.date,
  oap.payment_method, oap.journal_name, oap.is_reconciled, oap.reconciled_invoices_count,
  oap.ref, oap.odoo_partner_id, oap.company_id,
  true, ARRAY['odoo'],
  jsonb_build_object('odoo_synced_at', oap.synced_at)
FROM odoo_account_payments oap
ON CONFLICT (canonical_id) DO NOTHING;

-- ====================================================================
-- 6b. Attach SAT complements to Odoo rows where num_operacion matches
-- NOTE (2026-04-22 current data): 99.9% of both sides lack num_operacion/ref,
-- so this step typically matches 0 rows. Kept for future syncs where these
-- bridge fields may become populated. Harmless no-op meanwhile.
-- Fix: oap JOIN placed in FROM clause (not nested JOIN on cp) to avoid
-- ambiguous reference to target table cp.
-- ====================================================================
UPDATE canonical_payments cp
SET
  sat_uuid_complemento = sp.uuid_complemento,
  amount_sat = sp.monto,
  amount_mxn_sat = sp.monto * COALESCE(sp.tipo_cambio_p, 1),
  currency_sat = sp.moneda_p,
  tipo_cambio_sat = sp.tipo_cambio_p,
  fecha_pago_sat = sp.fecha_pago,
  forma_pago_sat = sp.forma_pago_p,
  num_operacion = sp.num_operacion,
  rfc_emisor_cta_ord = sp.rfc_emisor_cta_ord,
  rfc_emisor_cta_ben = sp.rfc_emisor_cta_ben,
  estado_sat = sp.estado_sat,
  has_sat_record = true,
  sources_present = ARRAY(SELECT DISTINCT unnest(cp.sources_present || ARRAY['sat'])),
  source_hashes = COALESCE(cp.source_hashes, '{}'::jsonb) || jsonb_build_object('sat_synced_at', sp.synced_at)
FROM syntage_invoice_payments sp,
     odoo_account_payments oap
WHERE cp.odoo_payment_id = oap.id
  AND cp.sat_uuid_complemento IS NULL
  AND sp.num_operacion IS NOT NULL AND sp.num_operacion <> ''
  AND oap.ref IS NOT NULL AND oap.ref <> ''
  AND sp.num_operacion = oap.ref
  AND ABS(sp.monto - oap.amount) < 0.01
  AND ABS(sp.fecha_pago::date - oap.date) <= 1;

-- ====================================================================
-- 6c. Insert SAT-only complements (no Odoo match)
-- direction: SAT 'issued' (Quimibond emitió complemento) → canonical 'received'
--            SAT 'received' (supplier emitió) → canonical 'sent'
-- ====================================================================
INSERT INTO canonical_payments (
  canonical_id, sat_uuid_complemento, direction,
  amount_sat, amount_mxn_sat,
  currency_sat, tipo_cambio_sat, fecha_pago_sat, forma_pago_sat,
  num_operacion, rfc_emisor_cta_ord, rfc_emisor_cta_ben, estado_sat,
  has_sat_record, sources_present, source_hashes
)
SELECT
  'sat:' || sp.uuid_complemento,
  sp.uuid_complemento,
  CASE sp.direction WHEN 'issued' THEN 'received' WHEN 'received' THEN 'sent' END,
  sp.monto,
  sp.monto * COALESCE(sp.tipo_cambio_p, 1),
  sp.moneda_p, sp.tipo_cambio_p, sp.fecha_pago, sp.forma_pago_p,
  sp.num_operacion, sp.rfc_emisor_cta_ord, sp.rfc_emisor_cta_ben, sp.estado_sat,
  true, ARRAY['sat'],
  jsonb_build_object('sat_synced_at', sp.synced_at)
FROM syntage_invoice_payments sp
WHERE NOT EXISTS (SELECT 1 FROM canonical_payments cp WHERE cp.sat_uuid_complemento = sp.uuid_complemento)
ON CONFLICT (canonical_id) DO NOTHING;

-- ====================================================================
-- 6d. Resolved fields (per §5.2 survivorship: Odoo-primary for ops)
-- ====================================================================
UPDATE canonical_payments cp
SET
  amount_resolved = COALESCE(cp.amount_odoo, cp.amount_sat),
  amount_mxn_resolved = COALESCE(cp.amount_mxn_odoo, cp.amount_mxn_sat),
  payment_date_resolved = COALESCE(cp.payment_date_odoo, cp.fecha_pago_sat::date),
  completeness_score = CASE
    WHEN cp.has_odoo_record AND cp.has_sat_record THEN 1.000
    WHEN cp.has_odoo_record OR  cp.has_sat_record THEN 0.500
    ELSE 0.000
  END,
  sources_missing = CASE
    WHEN cp.has_odoo_record AND cp.has_sat_record THEN '{}'::text[]
    WHEN cp.has_odoo_record AND NOT cp.has_sat_record THEN ARRAY['sat']
    WHEN NOT cp.has_odoo_record AND cp.has_sat_record THEN ARRAY['odoo']
    ELSE ARRAY['odoo','sat']
  END;

-- ====================================================================
-- 6e. Allocations from doctos_relacionados jsonb
-- NOTE: actual field names in syntage_invoice_payments.doctos_relacionados are:
--   uuid_docto (not uuid), imp_pagado (not importe_pagado),
--   imp_saldo_ant (not saldo_anterior), imp_saldo_insoluto, parcialidad (not num_parcialidad)
--   moneda_dr may be null (no moneda_dr key present in current data)
-- ====================================================================
INSERT INTO canonical_payment_allocations (
  payment_canonical_id, invoice_canonical_id, allocated_amount, currency, source,
  sat_saldo_anterior, sat_saldo_insoluto, sat_num_parcialidad
)
SELECT
  cp.canonical_id,
  d->>'uuid_docto',
  (d->>'imp_pagado')::numeric,
  d->>'moneda_dr',
  'sat_complemento',
  NULLIF(d->>'imp_saldo_ant', '')::numeric,
  NULLIF(d->>'imp_saldo_insoluto', '')::numeric,
  NULLIF(d->>'parcialidad', '')::integer
FROM syntage_invoice_payments sp
JOIN canonical_payments cp ON cp.sat_uuid_complemento = sp.uuid_complemento
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sp.doctos_relacionados, '[]'::jsonb)) AS d
WHERE d ? 'uuid_docto'
ON CONFLICT (payment_canonical_id, invoice_canonical_id, source) DO NOTHING;

-- Cache allocation summary on canonical_payments
UPDATE canonical_payments cp
SET
  allocation_count = agg.cnt,
  allocated_invoices_uuid = agg.uuids,
  amount_allocated = agg.total
FROM (
  SELECT payment_canonical_id,
         COUNT(*) AS cnt,
         array_agg(invoice_canonical_id) AS uuids,
         SUM(allocated_amount) AS total
  FROM canonical_payment_allocations
  GROUP BY payment_canonical_id
) agg
WHERE agg.payment_canonical_id = cp.canonical_id;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('populate','canonical_payments',
  'SP2 Task 6: populate payments + allocations (Quimibond=6707, English direction, num_operacion bridge dead in current data)',
  '20260422_sp2_06_canonical_payments_populate.sql','silver-sp2',true);

COMMIT;
