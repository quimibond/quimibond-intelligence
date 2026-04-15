-- ============================================================================
-- Migration 20260415 v2: Projected Cash Flow (Direct Method, 13 semanas)
--
-- Reemplaza la v1. Modelo financieramente profesional:
--
--   PRINCIPIOS
--     1. Método directo: proyecta cada categoría de cash por semana.
--     2. Open balance con FX real (USD→MXN via odoo_currency_rates).
--     3. AR per-partner behavior: reusa payment_predictions matview + fallback
--        on-the-fly por partner + fallback global (p50=39d).
--     4. SO/PO backlog por línea (qty - qty_invoiced) vía odoo_order_lines.
--     5. Nómina + OpEx derivados de JOIN odoo_account_balances × chart_of_accounts
--        (account_type LIKE 'expense%' con regex por nombre para separar nómina).
--     6. IVA neto mensual pagado el día 17 (solo cuando es positivo).
--     7. Cada flujo se expone en gross Y weighted (confidence-adjusted).
--
--   VIEWS EXPUESTAS
--     • cashflow_current_cash         — cash FX-adjusted y clasificado (operative/restricted/cc_debt)
--     • cashflow_in_transit           — saldo cumulativo de cuentas transitorias
--     • cashflow_unreconciled         — pagos no conciliados (ajuste anti-double-count en AR/AP)
--     • cashflow_company_behavior     — avg/median/stddev days_to_pay por partner
--     • cashflow_ar_predicted         — open AR con predicted_payment_date
--     • cashflow_ap_predicted         — open AP
--     • cashflow_so_backlog           — SO pending por facturar
--     • cashflow_po_backlog           — PO pending por recibir
--     • cashflow_payroll_monthly      — nómina mensual (avg 3m)
--     • cashflow_opex_monthly         — opex mensual (avg 3m, ex-nómina)
--     • cashflow_tax_monthly          — IVA neto mensual (avg 3m)
--     • projected_cash_flow_weekly    — agregado 13 semanas + running balance
--
--   AJUSTES ANTI-ERROR (clave para exactitud financiera)
--     • Cuentas transitorias: cash en tránsito sumado al opening balance.
--     • Pagos unmatched+reconciled: ya golpearon bank balance pero las facturas
--       siguen "abiertas" → se restan de AR/AP opens para evitar doble conteo.
--     • Journals "restricted" (Aduana, Diferidos, Incobrables, clearing Payana/Fintoc):
--       excluidos del cash operativo, mostrados aparte.
--
--   RPCs
--     • get_projected_cash_flow()
--     • get_projected_cash_flow_summary()
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════
-- DROPs idempotentes (permite re-aplicar la migración)
-- ═══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS get_projected_cash_flow() CASCADE;
DROP FUNCTION IF EXISTS get_projected_cash_flow_summary() CASCADE;
DROP VIEW IF EXISTS projected_cash_flow_weekly CASCADE;
DROP VIEW IF EXISTS cashflow_tax_monthly CASCADE;
DROP VIEW IF EXISTS cashflow_opex_monthly CASCADE;
DROP VIEW IF EXISTS cashflow_payroll_monthly CASCADE;
DROP VIEW IF EXISTS cashflow_po_backlog CASCADE;
DROP VIEW IF EXISTS cashflow_so_backlog CASCADE;
DROP VIEW IF EXISTS cashflow_ap_predicted CASCADE;
DROP VIEW IF EXISTS cashflow_ar_predicted CASCADE;
DROP VIEW IF EXISTS cashflow_company_behavior CASCADE;
DROP VIEW IF EXISTS cashflow_unreconciled CASCADE;
DROP VIEW IF EXISTS cashflow_in_transit CASCADE;
DROP VIEW IF EXISTS cashflow_current_cash CASCADE;


-- ═══════════════════════════════════════════════════════════════
-- VIEW: cashflow_current_cash
-- ═══════════════════════════════════════════════════════════════
-- Clasifica journals de odoo_bank_balances en 3 buckets:
--   • operative  → bancos, inversiones, caja y nómina (DISPONIBLE para operación)
--   • restricted → aduana, diferidos, incobrables, clearing Payana/Fintoc (NO disponible)
--   • cc_debt    → tarjetas de crédito (pasivo)
-- Convierte USD/EUR a MXN con el tipo de cambio más reciente.
CREATE OR REPLACE VIEW cashflow_current_cash AS
WITH
  latest_usd AS (
    SELECT rate FROM odoo_currency_rates
    WHERE currency = 'USD' ORDER BY rate_date DESC NULLS LAST LIMIT 1
  ),
  latest_eur AS (
    SELECT rate FROM odoo_currency_rates
    WHERE currency = 'EUR' ORDER BY rate_date DESC NULLS LAST LIMIT 1
  ),
  classified AS (
    SELECT
      name,
      currency,
      current_balance AS balance_raw,
      CASE UPPER(COALESCE(currency, 'MXN'))
        WHEN 'USD' THEN current_balance * COALESCE((SELECT rate FROM latest_usd), 17.30)
        WHEN 'EUR' THEN current_balance * COALESCE((SELECT rate FROM latest_eur), 20.00)
        ELSE current_balance
      END AS balance_mxn,
      CASE
        -- Tarjetas de crédito
        WHEN name ~* '(jeeves|jeevs|tarjeta|amex)'                             THEN 'cc_debt'
        -- Journals no operativos (clearing / restringidos / baja material)
        WHEN name ~* '(diferid|incobrabl|payana|fintoc|aduana|internacional)'  THEN 'restricted'
        -- Todo lo demás: bancos, cajas, inversiones, cuenta de salarios
        ELSE 'operative'
      END AS bucket
    FROM odoo_bank_balances
  )
SELECT
  -- Bucket operativo: lo que realmente está disponible para pagar cuentas
  COALESCE(SUM(CASE WHEN bucket='operative' AND balance_mxn > 0 THEN balance_mxn ELSE 0 END), 0)::numeric AS cash_operative_mxn,
  -- Restricted: Aduana, clearing, incobrables
  COALESCE(SUM(CASE WHEN bucket='restricted' THEN balance_mxn ELSE 0 END), 0)::numeric                    AS cash_restricted_mxn,
  -- Deuda de tarjetas de crédito (negativo)
  COALESCE(SUM(CASE WHEN bucket='cc_debt' THEN balance_mxn ELSE 0 END), 0)::numeric                       AS cc_debt_mxn,
  -- Net = operativo + cc_debt (tarjetas son pasivo, suman negativo)
  COALESCE(SUM(CASE WHEN bucket IN ('operative','cc_debt') THEN balance_mxn ELSE 0 END), 0)::numeric     AS cash_net_mxn,
  COUNT(*) FILTER (WHERE balance_mxn <> 0)::int                                                           AS active_accounts,
  (SELECT rate FROM latest_usd) AS usd_rate,
  (SELECT rate FROM latest_eur) AS eur_rate
FROM classified;

COMMENT ON VIEW cashflow_current_cash IS
  'Cash FX-ajustado y clasificado. cash_net_mxn = operative + cc_debt (lo que se puede usar para pagos). cash_restricted excluido del cash disponible.';


-- ═══════════════════════════════════════════════════════════════
-- VIEW: cashflow_in_transit (cuentas transitorias)
-- ═══════════════════════════════════════════════════════════════
-- Saldo cumulativo de cuentas transitorias del CoA.
-- Estas son cuentas contables tipo asset_current que capturan cash en tránsito
-- (depósitos no aplicados, transferencias interbancarias pendientes, compensaciones).
-- NO están en odoo_bank_balances, así que son "invisible cash" si no se suman.
CREATE OR REPLACE VIEW cashflow_in_transit AS
WITH transitory_accounts AS (
  SELECT odoo_account_id, name
  FROM odoo_chart_of_accounts
  WHERE (
         name ~* '(transit|en.tr[aá]nsito|por.aplicar|compensaci[oó]n|interbancari)'
         OR name ILIKE '%cuenta transitoria%'
       )
    AND account_type IN ('asset_current','asset_cash')
)
SELECT
  COALESCE(SUM(b.debit - b.credit), 0)::numeric                                       AS in_transit_mxn,
  COUNT(DISTINCT t.odoo_account_id)                                                   AS account_count,
  COUNT(DISTINCT t.odoo_account_id) FILTER (WHERE b.debit IS NOT NULL)::int           AS accounts_with_data
FROM transitory_accounts t
LEFT JOIN odoo_account_balances b ON b.odoo_account_id = t.odoo_account_id;

COMMENT ON VIEW cashflow_in_transit IS
  'Saldo cumulativo (debit-credit) de cuentas transitorias del CoA. Cash en tránsito que no está en bank_balances.';


-- ═══════════════════════════════════════════════════════════════
-- VIEW: cashflow_unreconciled (ajuste anti-double-count)
-- ═══════════════════════════════════════════════════════════════
-- Pagos en odoo_account_payments que ya impactaron el bank balance (reconciled=true)
-- pero NO fueron linkeados a factura (matched=false o reconciled_invoices_count=0).
-- Las facturas asociadas siguen "abiertas" → double-count si no se ajusta.
CREATE OR REPLACE VIEW cashflow_unreconciled AS
SELECT
  -- Inbound unmatched: cash ya entró, pero factura sigue en AR abierta
  COALESCE(SUM(CASE
    WHEN payment_type='inbound' AND is_reconciled IS TRUE
         AND (is_matched IS NOT TRUE OR COALESCE(reconciled_invoices_count,0)=0)
    THEN amount ELSE 0 END), 0)::numeric AS unmatched_inbound_mxn,
  COALESCE(SUM(CASE
    WHEN payment_type='outbound' AND is_reconciled IS TRUE
         AND (is_matched IS NOT TRUE OR COALESCE(reconciled_invoices_count,0)=0)
    THEN amount ELSE 0 END), 0)::numeric AS unmatched_outbound_mxn,
  -- Pagos totalmente no conciliados (ni matched, ni reconciled): future cash adjustment
  COALESCE(SUM(CASE
    WHEN payment_type='inbound' AND is_reconciled IS NOT TRUE
    THEN amount ELSE 0 END), 0)::numeric AS pending_inbound_mxn,
  COALESCE(SUM(CASE
    WHEN payment_type='outbound' AND is_reconciled IS NOT TRUE
    THEN amount ELSE 0 END), 0)::numeric AS pending_outbound_mxn,
  COUNT(*) FILTER (WHERE payment_type='inbound'  AND is_reconciled IS TRUE  AND (is_matched IS NOT TRUE OR COALESCE(reconciled_invoices_count,0)=0))::int AS n_unmatched_inbound,
  COUNT(*) FILTER (WHERE payment_type='outbound' AND is_reconciled IS TRUE  AND (is_matched IS NOT TRUE OR COALESCE(reconciled_invoices_count,0)=0))::int AS n_unmatched_outbound,
  COUNT(*) FILTER (WHERE payment_type='inbound'  AND is_reconciled IS NOT TRUE)::int                                                                     AS n_pending_inbound,
  COUNT(*) FILTER (WHERE payment_type='outbound' AND is_reconciled IS NOT TRUE)::int                                                                     AS n_pending_outbound
FROM odoo_account_payments
WHERE state IN ('posted','in_process','sent');

COMMENT ON VIEW cashflow_unreconciled IS
  'Ajuste anti-double-count: pagos que ya golpearon bank pero cuyas facturas siguen abiertas (unmatched+reconciled), y pagos totalmente pendientes de conciliar (reconciled=false).';


-- ═══════════════════════════════════════════════════════════════
-- VIEW: cashflow_company_behavior
-- ═══════════════════════════════════════════════════════════════
-- Predice comportamiento de pago por company_id:
--   1. Si existe en payment_predictions matview → úsala (source='matview')
--   2. Sino, calcula sobre odoo_invoices pagadas últimos 18m (source='invoices')
--   3. Confidence basada en stddev y sample_size
CREATE OR REPLACE VIEW cashflow_company_behavior AS
WITH
  from_matview AS (
    SELECT
      company_id,
      avg_days_to_pay::numeric    AS avg_days,
      median_days_to_pay::numeric AS median_days,
      stddev_days::numeric        AS stddev_days,
      CASE
        WHEN stddev_days IS NULL OR stddev_days = 0 THEN 0.85
        WHEN stddev_days < 15 THEN 0.85
        WHEN stddev_days < 30 THEN 0.75
        WHEN stddev_days < 60 THEN 0.60
        ELSE 0.45
      END                         AS confidence,
      paid_invoices::int          AS sample_size,
      'matview'                   AS source
    FROM payment_predictions
  ),
  from_invoices AS (
    SELECT
      i.company_id,
      AVG(i.days_to_pay)::numeric                                              AS avg_days,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY i.days_to_pay)::numeric      AS median_days,
      COALESCE(STDDEV_POP(i.days_to_pay), 0)::numeric                          AS stddev_days,
      CASE
        WHEN COUNT(*) < 3 THEN 0.40
        WHEN COALESCE(STDDEV_POP(i.days_to_pay), 0) < 15 THEN 0.75
        WHEN COALESCE(STDDEV_POP(i.days_to_pay), 0) < 30 THEN 0.65
        ELSE 0.50
      END                                                                     AS confidence,
      COUNT(*)::int                                                            AS sample_size,
      'invoices'                                                               AS source
    FROM odoo_invoices i
    WHERE i.move_type = 'out_invoice'
      AND i.payment_state = 'paid'
      AND i.days_to_pay IS NOT NULL
      AND i.company_id IS NOT NULL
      AND i.invoice_date >= CURRENT_DATE - INTERVAL '18 months'
    GROUP BY i.company_id
    HAVING COUNT(*) >= 1
  )
SELECT
  COALESCE(m.company_id, f.company_id)     AS company_id,
  COALESCE(m.avg_days, f.avg_days)         AS avg_days,
  COALESCE(m.median_days, f.median_days)   AS median_days,
  COALESCE(m.stddev_days, f.stddev_days)   AS stddev_days,
  COALESCE(m.confidence, f.confidence)     AS confidence,
  COALESCE(m.sample_size, f.sample_size)   AS sample_size,
  COALESCE(m.source, f.source)             AS source
FROM from_matview m
FULL OUTER JOIN from_invoices f USING (company_id);

COMMENT ON VIEW cashflow_company_behavior IS
  'Comportamiento de pago por cliente. Prioriza payment_predictions matview, fallback a cálculo on-the-fly sobre 18m de facturas pagadas.';


-- ═══════════════════════════════════════════════════════════════
-- VIEW: cashflow_ar_predicted
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW cashflow_ar_predicted AS
WITH open_ar AS (
  SELECT
    i.id,
    i.company_id,
    i.name,
    i.invoice_date,
    i.due_date,
    COALESCE(i.days_overdue, 0) AS days_overdue,
    COALESCE(i.amount_residual_mxn, i.amount_residual, 0)::numeric AS residual_mxn
  FROM odoo_invoices i
  WHERE i.move_type = 'out_invoice'
    AND i.state = 'posted'
    AND i.payment_state IN ('not_paid', 'partial')
    AND COALESCE(i.amount_residual_mxn, i.amount_residual, 0) > 0
)
SELECT
  o.id,
  o.company_id,
  o.name,
  o.invoice_date,
  o.due_date,
  o.days_overdue,
  o.residual_mxn,
  CASE
    -- Vencida >60d: cola de cobranza difícil, pagará en ~21d
    WHEN o.days_overdue > 60 THEN (CURRENT_DATE + INTERVAL '21 days')::date
    -- Vencida: se cobra en 7 días
    WHEN o.days_overdue > 0 THEN (CURRENT_DATE + INTERVAL '7 days')::date
    -- Behavior conocido del cliente
    WHEN b.avg_days IS NOT NULL THEN
      GREATEST(CURRENT_DATE, (o.invoice_date + (LEAST(b.avg_days, 180))::int * INTERVAL '1 day')::date)
    -- Fallback global p50 = 39d
    ELSE GREATEST(CURRENT_DATE, (o.invoice_date + INTERVAL '39 days')::date)
  END::date AS predicted_payment_date,
  CASE
    WHEN o.days_overdue > 60 THEN 0.35
    WHEN o.days_overdue > 0 THEN 0.55
    WHEN b.confidence IS NOT NULL THEN b.confidence
    ELSE 0.45
  END::numeric AS confidence,
  CASE
    WHEN o.days_overdue > 60 THEN 'overdue_deep'
    WHEN o.days_overdue > 0  THEN 'overdue_recent'
    WHEN b.source IS NOT NULL THEN b.source
    ELSE 'global_fallback'
  END AS source
FROM open_ar o
LEFT JOIN cashflow_company_behavior b ON b.company_id = o.company_id;

COMMENT ON VIEW cashflow_ar_predicted IS
  'Facturas cliente abiertas con predicted_payment_date basado en behavior real por cliente.';


-- ═══════════════════════════════════════════════════════════════
-- VIEW: cashflow_ap_predicted
-- ═══════════════════════════════════════════════════════════════
-- Política conservadora: pagamos el día de vencimiento. Vencidas → semana 1.
CREATE OR REPLACE VIEW cashflow_ap_predicted AS
SELECT
  i.id,
  i.company_id,
  i.name,
  i.invoice_date,
  i.due_date,
  COALESCE(i.days_overdue, 0) AS days_overdue,
  COALESCE(i.amount_residual_mxn, i.amount_residual, 0)::numeric AS residual_mxn,
  CASE
    WHEN i.due_date IS NULL                 THEN (CURRENT_DATE + INTERVAL '14 days')::date
    WHEN i.due_date < CURRENT_DATE          THEN (CURRENT_DATE + INTERVAL '3 days')::date
    ELSE i.due_date
  END::date AS predicted_payment_date,
  0.95::numeric AS confidence
FROM odoo_invoices i
WHERE i.move_type = 'in_invoice'
  AND i.state = 'posted'
  AND i.payment_state IN ('not_paid', 'partial')
  AND COALESCE(i.amount_residual_mxn, i.amount_residual, 0) > 0;

COMMENT ON VIEW cashflow_ap_predicted IS
  'Facturas proveedor abiertas. Política: pagar en due_date; vencidas en 3 días.';


-- ═══════════════════════════════════════════════════════════════
-- VIEW: cashflow_so_backlog
-- ═══════════════════════════════════════════════════════════════
-- SO confirmadas con líneas pendientes por facturar (qty > qty_invoiced).
CREATE OR REPLACE VIEW cashflow_so_backlog AS
WITH backlog_lines AS (
  SELECT
    ol.odoo_order_id,
    ol.odoo_partner_id,
    SUM(
      (GREATEST(ol.qty - COALESCE(ol.qty_invoiced, 0), 0) / NULLIF(ol.qty, 0))
      * COALESCE(ol.subtotal_mxn, ol.subtotal, 0)
    )::numeric AS pending_mxn
  FROM odoo_order_lines ol
  WHERE ol.order_type = 'sale'
    AND ol.order_state IN ('sale', 'done')
    AND ol.qty > COALESCE(ol.qty_invoiced, 0)
    AND ol.qty > 0
  GROUP BY ol.odoo_order_id, ol.odoo_partner_id
  HAVING SUM(GREATEST(ol.qty - COALESCE(ol.qty_invoiced, 0), 0)) > 0
     AND SUM((GREATEST(ol.qty - COALESCE(ol.qty_invoiced, 0), 0) / NULLIF(ol.qty, 0))
             * COALESCE(ol.subtotal_mxn, ol.subtotal, 0)) > 0
)
SELECT
  so.odoo_order_id,
  so.name,
  so.company_id,
  so.commitment_date,
  so.date_order,
  bl.pending_mxn,
  -- Invoice date estimada: commitment_date si existe, sino date_order + 30d
  COALESCE(so.commitment_date, so.date_order + INTERVAL '30 days')::date AS predicted_invoice_date,
  -- Payment date: invoice_date + avg_days_to_pay del partner (o global p50)
  (
    COALESCE(so.commitment_date, so.date_order + INTERVAL '30 days')::date
    + (LEAST(COALESCE(b.avg_days, 39), 180))::int * INTERVAL '1 day'
  )::date AS predicted_payment_date,
  -- Confidence compuesta: 0.6 (chance SO facture) × behavior confidence del cliente
  (0.60 * COALESCE(b.confidence, 0.50))::numeric AS confidence
FROM odoo_sale_orders so
JOIN backlog_lines bl ON bl.odoo_order_id = so.odoo_order_id
LEFT JOIN cashflow_company_behavior b ON b.company_id = so.company_id
WHERE so.state IN ('sale', 'done');

COMMENT ON VIEW cashflow_so_backlog IS
  'Sale orders con backlog. Calcula predicted_invoice_date y predicted_payment_date con behavior del cliente.';


-- ═══════════════════════════════════════════════════════════════
-- VIEW: cashflow_po_backlog
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW cashflow_po_backlog AS
WITH backlog_lines AS (
  SELECT
    ol.odoo_order_id,
    SUM(
      (GREATEST(ol.qty - COALESCE(ol.qty_invoiced, 0), 0) / NULLIF(ol.qty, 0))
      * COALESCE(ol.subtotal_mxn, ol.subtotal, 0)
    )::numeric AS pending_mxn
  FROM odoo_order_lines ol
  WHERE ol.order_type = 'purchase'
    AND ol.order_state IN ('purchase', 'done')
    AND ol.qty > COALESCE(ol.qty_invoiced, 0)
    AND ol.qty > 0
  GROUP BY ol.odoo_order_id
  HAVING SUM(GREATEST(ol.qty - COALESCE(ol.qty_invoiced, 0), 0)) > 0
     AND SUM((GREATEST(ol.qty - COALESCE(ol.qty_invoiced, 0), 0) / NULLIF(ol.qty, 0))
             * COALESCE(ol.subtotal_mxn, ol.subtotal, 0)) > 0
)
SELECT
  po.odoo_order_id,
  po.name,
  po.company_id,
  po.date_order,
  bl.pending_mxn,
  -- Bill estimado en 30 días desde la orden (recibir + facturar)
  (po.date_order + INTERVAL '30 days')::date AS predicted_bill_date,
  -- Pago estimado en 30 días después del bill (= 60 desde orden)
  (po.date_order + INTERVAL '60 days')::date AS predicted_payment_date,
  0.70::numeric AS confidence
FROM odoo_purchase_orders po
JOIN backlog_lines bl ON bl.odoo_order_id = po.odoo_order_id
WHERE po.state IN ('purchase', 'done');

COMMENT ON VIEW cashflow_po_backlog IS
  'Purchase orders con backlog. Estima bill a 30d y pago a 60d desde date_order.';


-- ═══════════════════════════════════════════════════════════════
-- VIEW: cashflow_payroll_monthly
-- ═══════════════════════════════════════════════════════════════
-- Promedio 3 meses más recientes (cerrados) de cuentas de nómina.
CREATE OR REPLACE VIEW cashflow_payroll_monthly AS
WITH payroll_accounts AS (
  SELECT odoo_account_id
  FROM odoo_chart_of_accounts
  WHERE name ~* '(sueld|salari|nomin|imss|infonavit|prestacione|aguinald|^isn$|impuesto.*sobre.*nomin)'
    AND account_type IN ('expense', 'expense_direct_cost', 'expense_other')
),
monthly AS (
  SELECT b.period, SUM(b.debit - b.credit) AS total
  FROM odoo_account_balances b
  WHERE b.odoo_account_id IN (SELECT odoo_account_id FROM payroll_accounts)
    AND b.period < to_char(CURRENT_DATE, 'YYYY-MM')
    AND b.period >= to_char(CURRENT_DATE - INTERVAL '6 months', 'YYYY-MM')
  GROUP BY b.period
),
recent AS (SELECT * FROM monthly ORDER BY period DESC LIMIT 3)
SELECT
  COALESCE(AVG(total), 0)::numeric                 AS monthly_mxn,
  COUNT(*)::int                                    AS months_used,
  COALESCE(STRING_AGG(period, ', ' ORDER BY period DESC), '')::text AS periods
FROM recent;

COMMENT ON VIEW cashflow_payroll_monthly IS
  'Nómina mensual estimada = avg de 3 meses más recientes cerrados de cuentas sueld/salari/nomin/IMSS/infonavit.';


-- ═══════════════════════════════════════════════════════════════
-- VIEW: cashflow_opex_monthly
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW cashflow_opex_monthly AS
WITH payroll_accounts AS (
  SELECT odoo_account_id
  FROM odoo_chart_of_accounts
  WHERE name ~* '(sueld|salari|nomin|imss|infonavit|prestacione|aguinald|^isn$|impuesto.*sobre.*nomin)'
),
opex_accounts AS (
  SELECT odoo_account_id
  FROM odoo_chart_of_accounts
  WHERE account_type IN ('expense', 'expense_other')
    AND odoo_account_id NOT IN (SELECT odoo_account_id FROM payroll_accounts)
),
monthly AS (
  SELECT b.period, SUM(b.debit - b.credit) AS total
  FROM odoo_account_balances b
  WHERE b.odoo_account_id IN (SELECT odoo_account_id FROM opex_accounts)
    AND b.period < to_char(CURRENT_DATE, 'YYYY-MM')
    AND b.period >= to_char(CURRENT_DATE - INTERVAL '6 months', 'YYYY-MM')
  GROUP BY b.period
),
recent AS (SELECT * FROM monthly ORDER BY period DESC LIMIT 3)
SELECT
  COALESCE(AVG(total), 0)::numeric                 AS monthly_mxn,
  COUNT(*)::int                                    AS months_used,
  COALESCE(STRING_AGG(period, ', ' ORDER BY period DESC), '')::text AS periods
FROM recent;

COMMENT ON VIEW cashflow_opex_monthly IS
  'OpEx mensual = avg 3m de expense + expense_other excluyendo nómina, COGS y depreciación.';


-- ═══════════════════════════════════════════════════════════════
-- VIEW: cashflow_tax_monthly (IVA neto)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW cashflow_tax_monthly AS
WITH monthly AS (
  SELECT
    to_char(invoice_date, 'YYYY-MM') AS period,
    SUM(CASE WHEN move_type='out_invoice' THEN COALESCE(amount_tax,0) ELSE 0 END)
    - SUM(CASE WHEN move_type='in_invoice'  THEN COALESCE(amount_tax,0) ELSE 0 END) AS iva_neto
  FROM odoo_invoices
  WHERE state = 'posted'
    AND invoice_date >= CURRENT_DATE - INTERVAL '6 months'
    AND invoice_date < date_trunc('month', CURRENT_DATE)
  GROUP BY 1
),
recent AS (SELECT * FROM monthly ORDER BY period DESC LIMIT 3)
SELECT
  -- Solo pagamos IVA cuando es positivo (si es negativo = crédito, no sale cash)
  GREATEST(COALESCE(AVG(iva_neto), 0), 0)::numeric  AS monthly_mxn,
  COUNT(*)::int                                      AS months_used
FROM recent;

COMMENT ON VIEW cashflow_tax_monthly IS
  'IVA neto mensual (out - in) promedio últimos 3m. 0 si resulta crédito a favor.';


-- ═══════════════════════════════════════════════════════════════
-- VIEW: projected_cash_flow_weekly (v2)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW projected_cash_flow_weekly AS
WITH
  params AS (
    SELECT (date_trunc('week', CURRENT_DATE))::date AS monday
  ),
  weeks AS (
    SELECT
      gs::int                                  AS week_index,
      (p.monday + gs * 7)::date                AS week_start,
      (p.monday + gs * 7 + 6)::date            AS week_end
    FROM params p
    CROSS JOIN generate_series(0, 12) gs
  ),
  -- AR crudo por semana (sin ajustar por pagos ya ingresados pero no linkeados)
  ar_raw AS (
    SELECT
      w.week_index,
      COALESCE(SUM(ar.residual_mxn), 0)::numeric                                                  AS gross,
      COALESCE(SUM(ar.residual_mxn * ar.confidence), 0)::numeric                                  AS weighted,
      COALESCE(SUM(CASE WHEN ar.days_overdue > 0 THEN ar.residual_mxn ELSE 0 END), 0)::numeric    AS overdue_gross
    FROM weeks w
    LEFT JOIN cashflow_ar_predicted ar
      ON ar.predicted_payment_date BETWEEN w.week_start AND w.week_end
    GROUP BY w.week_index
  ),
  -- AR ajustado: semana 1 resta los pagos inbound unmatched (ya entró ese cash)
  ar_by_week AS (
    SELECT
      ar.week_index,
      GREATEST(ar.gross - CASE WHEN ar.week_index = 0
                               THEN (SELECT unmatched_inbound_mxn FROM cashflow_unreconciled)
                               ELSE 0 END, 0) AS gross,
      GREATEST(ar.weighted - CASE WHEN ar.week_index = 0
                                  THEN (SELECT unmatched_inbound_mxn FROM cashflow_unreconciled)
                                  ELSE 0 END, 0) AS weighted,
      ar.overdue_gross
    FROM ar_raw ar
  ),
  so_by_week AS (
    SELECT
      w.week_index,
      COALESCE(SUM(so.pending_mxn), 0)::numeric                                                   AS gross,
      COALESCE(SUM(so.pending_mxn * so.confidence), 0)::numeric                                   AS weighted
    FROM weeks w
    LEFT JOIN cashflow_so_backlog so
      ON so.predicted_payment_date BETWEEN w.week_start AND w.week_end
    GROUP BY w.week_index
  ),
  ap_raw AS (
    SELECT
      w.week_index,
      COALESCE(SUM(ap.residual_mxn), 0)::numeric                                                  AS gross,
      COALESCE(SUM(ap.residual_mxn * ap.confidence), 0)::numeric                                  AS weighted,
      COALESCE(SUM(CASE WHEN ap.days_overdue > 0 THEN ap.residual_mxn ELSE 0 END), 0)::numeric    AS overdue_gross
    FROM weeks w
    LEFT JOIN cashflow_ap_predicted ap
      ON ap.predicted_payment_date BETWEEN w.week_start AND w.week_end
    GROUP BY w.week_index
  ),
  -- AP ajustado: semana 1 resta los pagos outbound unmatched (ya salió ese cash)
  ap_by_week AS (
    SELECT
      ap.week_index,
      GREATEST(ap.gross - CASE WHEN ap.week_index = 0
                               THEN (SELECT unmatched_outbound_mxn FROM cashflow_unreconciled)
                               ELSE 0 END, 0) AS gross,
      GREATEST(ap.weighted - CASE WHEN ap.week_index = 0
                                  THEN (SELECT unmatched_outbound_mxn FROM cashflow_unreconciled)
                                  ELSE 0 END, 0) AS weighted,
      ap.overdue_gross
    FROM ap_raw ap
  ),
  po_by_week AS (
    SELECT
      w.week_index,
      COALESCE(SUM(po.pending_mxn), 0)::numeric                                                   AS gross,
      COALESCE(SUM(po.pending_mxn * po.confidence), 0)::numeric                                   AS weighted
    FROM weeks w
    LEFT JOIN cashflow_po_backlog po
      ON po.predicted_payment_date BETWEEN w.week_start AND w.week_end
    GROUP BY w.week_index
  ),
  payroll_events AS (
    SELECT
      w.week_index,
      (
        CASE WHEN EXISTS (
          SELECT 1 FROM generate_series(w.week_start, w.week_end, INTERVAL '1 day') d
          WHERE EXTRACT(DAY FROM d) = 15
        ) THEN (SELECT monthly_mxn FROM cashflow_payroll_monthly) / 2.0 ELSE 0 END
        +
        CASE WHEN EXISTS (
          SELECT 1 FROM generate_series(w.week_start, w.week_end, INTERVAL '1 day') d
          WHERE d::date = (date_trunc('month', d) + INTERVAL '1 month - 1 day')::date
        ) THEN (SELECT monthly_mxn FROM cashflow_payroll_monthly) / 2.0 ELSE 0 END
      )::numeric AS payroll_amount
    FROM weeks w
  ),
  tax_events AS (
    SELECT
      w.week_index,
      (CASE WHEN EXISTS (
         SELECT 1 FROM generate_series(w.week_start, w.week_end, INTERVAL '1 day') d
         WHERE EXTRACT(DAY FROM d) = 17
       ) THEN (SELECT monthly_mxn FROM cashflow_tax_monthly) ELSE 0 END)::numeric AS tax_amount
    FROM weeks w
  ),
  base AS (
    SELECT
      w.week_index,
      w.week_start,
      w.week_end,
      ROUND(ar.gross, 2)          AS ar_gross,
      ROUND(ar.weighted, 2)       AS ar_weighted,
      ROUND(ar.overdue_gross, 2)  AS ar_overdue_gross,
      ROUND(so.gross, 2)          AS so_gross,
      ROUND(so.weighted, 2)       AS so_weighted,
      ROUND(ap.gross, 2)          AS ap_gross,
      ROUND(ap.weighted, 2)       AS ap_weighted,
      ROUND(ap.overdue_gross, 2)  AS ap_overdue_gross,
      ROUND(po.gross, 2)          AS po_gross,
      ROUND(po.weighted, 2)       AS po_weighted,
      ROUND(pe.payroll_amount, 2) AS payroll_estimated,
      ROUND(((SELECT monthly_mxn FROM cashflow_opex_monthly) / 4.3333)::numeric, 2) AS opex_recurring,
      ROUND(te.tax_amount, 2)     AS tax_estimated
    FROM weeks w
    JOIN ar_by_week      ar USING (week_index)
    JOIN so_by_week      so USING (week_index)
    JOIN ap_by_week      ap USING (week_index)
    JOIN po_by_week      po USING (week_index)
    JOIN payroll_events  pe USING (week_index)
    JOIN tax_events      te USING (week_index)
  ),
  flows AS (
    SELECT
      b.*,
      (b.ar_weighted + b.so_weighted) AS inflows_weighted,
      (b.ar_gross    + b.so_gross)    AS inflows_gross,
      (b.ap_weighted + b.po_weighted + b.payroll_estimated + b.opex_recurring + b.tax_estimated) AS outflows_weighted,
      (b.ap_gross    + b.po_gross    + b.payroll_estimated + b.opex_recurring + b.tax_estimated) AS outflows_gross,
      ((b.ar_weighted + b.so_weighted)
       - (b.ap_weighted + b.po_weighted + b.payroll_estimated + b.opex_recurring + b.tax_estimated)
      ) AS net_flow
    FROM base b
  )
SELECT
  f.week_index,
  f.week_start,
  f.week_end,
  f.ar_gross, f.ar_weighted, f.ar_overdue_gross,
  f.so_gross, f.so_weighted,
  f.ap_gross, f.ap_weighted, f.ap_overdue_gross,
  f.po_gross, f.po_weighted,
  f.payroll_estimated,
  f.opex_recurring,
  f.tax_estimated,
  ROUND(f.inflows_weighted::numeric, 2)  AS inflows_weighted,
  ROUND(f.inflows_gross::numeric, 2)     AS inflows_gross,
  ROUND(f.outflows_weighted::numeric, 2) AS outflows_weighted,
  ROUND(f.outflows_gross::numeric, 2)    AS outflows_gross,
  ROUND(f.net_flow::numeric, 2)          AS net_flow,
  ROUND((
    ((SELECT cash_net_mxn FROM cashflow_current_cash)
     + (SELECT in_transit_mxn FROM cashflow_in_transit))
    + COALESCE(SUM(f.net_flow) OVER (
        ORDER BY f.week_index
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ), 0)
  )::numeric, 2) AS opening_balance,
  ROUND((
    ((SELECT cash_net_mxn FROM cashflow_current_cash)
     + (SELECT in_transit_mxn FROM cashflow_in_transit))
    + SUM(f.net_flow) OVER (
        ORDER BY f.week_index
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )
  )::numeric, 2) AS closing_balance
FROM flows f
ORDER BY f.week_index;

COMMENT ON VIEW projected_cash_flow_weekly IS
  'Flujo de efectivo proyectado 13 semanas (método directo). AR/SO/AP/PO ponderados por confidence basado en historial real de pagos por cliente. Nómina quincenal, OpEx semanal, IVA mensual.';


-- ═══════════════════════════════════════════════════════════════
-- RPC: get_projected_cash_flow()
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_projected_cash_flow()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'generated_at', now(),
    'horizon_weeks', 13,
    'cash_now', (
      SELECT jsonb_build_object(
        'net_mxn',            c.cash_net_mxn,
        'operative_mxn',      c.cash_operative_mxn,
        'restricted_mxn',     c.cash_restricted_mxn,
        'cc_debt_mxn',        c.cc_debt_mxn,
        'in_transit_mxn',     t.in_transit_mxn,
        'effective_mxn',      c.cash_net_mxn + t.in_transit_mxn,
        'usd_rate',           c.usd_rate,
        'eur_rate',           c.eur_rate,
        'active_accounts',    c.active_accounts,
        'in_transit_accounts', t.accounts_with_data
      )
      FROM cashflow_current_cash c, cashflow_in_transit t
    ),
    'unreconciled', (SELECT row_to_json(u) FROM cashflow_unreconciled u),
    'weeks', COALESCE((
      SELECT jsonb_agg(row_to_json(p) ORDER BY p.week_index)
      FROM projected_cash_flow_weekly p
    ), '[]'::jsonb)
  );
$$;


-- ═══════════════════════════════════════════════════════════════
-- RPC: get_projected_cash_flow_summary()
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_projected_cash_flow_summary()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH
    cash AS (SELECT * FROM cashflow_current_cash),
    transit AS (SELECT * FROM cashflow_in_transit),
    unrec AS (SELECT * FROM cashflow_unreconciled),
    agg AS (
      SELECT
        SUM(inflows_weighted)  AS inflows_w,
        SUM(inflows_gross)     AS inflows_g,
        SUM(outflows_weighted) AS outflows_w,
        SUM(outflows_gross)    AS outflows_g,
        SUM(net_flow)          AS net,
        MIN(closing_balance)   AS min_close,
        MAX(closing_balance)   AS max_close
      FROM projected_cash_flow_weekly
    ),
    first_neg AS (
      SELECT jsonb_build_object(
        'week_index', week_index,
        'week_start', week_start,
        'closing_balance', closing_balance
      ) AS data
      FROM projected_cash_flow_weekly
      WHERE closing_balance < 0
      ORDER BY week_index
      LIMIT 1
    ),
    open_positions AS (
      SELECT
        (SELECT COALESCE(SUM(residual_mxn), 0) FROM cashflow_ar_predicted)                              AS open_ar,
        (SELECT COALESCE(SUM(residual_mxn), 0) FROM cashflow_ar_predicted WHERE days_overdue > 0)       AS overdue_ar,
        (SELECT COALESCE(SUM(residual_mxn), 0) FROM cashflow_ap_predicted)                              AS open_ap,
        (SELECT COALESCE(SUM(residual_mxn), 0) FROM cashflow_ap_predicted WHERE days_overdue > 0)       AS overdue_ap,
        (SELECT COALESCE(SUM(pending_mxn), 0)  FROM cashflow_so_backlog)                                AS so_backlog,
        (SELECT COALESCE(SUM(pending_mxn), 0)  FROM cashflow_po_backlog)                                AS po_backlog
    ),
    sources AS (
      SELECT
        (SELECT jsonb_build_object(
           'monthly_mxn', monthly_mxn,
           'months_used', months_used,
           'periods', periods,
           'weekly_mxn', ROUND((monthly_mxn/4.3333)::numeric, 2))
         FROM cashflow_payroll_monthly) AS payroll,
        (SELECT jsonb_build_object(
           'monthly_mxn', monthly_mxn,
           'months_used', months_used,
           'periods', periods,
           'weekly_mxn', ROUND((monthly_mxn/4.3333)::numeric, 2))
         FROM cashflow_opex_monthly) AS opex,
        (SELECT jsonb_build_object(
           'monthly_mxn', monthly_mxn,
           'months_used', months_used)
         FROM cashflow_tax_monthly) AS tax
    )
  SELECT jsonb_build_object(
    'computed_at', now(),
    'cash', jsonb_build_object(
      'net_mxn',           cash.cash_net_mxn,
      'operative_mxn',     cash.cash_operative_mxn,
      'restricted_mxn',    cash.cash_restricted_mxn,
      'cc_debt_mxn',       cash.cc_debt_mxn,
      'in_transit_mxn',    transit.in_transit_mxn,
      'effective_mxn',     cash.cash_net_mxn + transit.in_transit_mxn,
      'usd_rate',          cash.usd_rate,
      'eur_rate',          cash.eur_rate,
      'active_accounts',   cash.active_accounts,
      'in_transit_accounts', transit.accounts_with_data
    ),
    'unreconciled', jsonb_build_object(
      'unmatched_inbound_mxn',  unrec.unmatched_inbound_mxn,
      'unmatched_outbound_mxn', unrec.unmatched_outbound_mxn,
      'pending_inbound_mxn',    unrec.pending_inbound_mxn,
      'pending_outbound_mxn',   unrec.pending_outbound_mxn,
      'n_unmatched_inbound',    unrec.n_unmatched_inbound,
      'n_unmatched_outbound',   unrec.n_unmatched_outbound,
      'n_pending_inbound',      unrec.n_pending_inbound,
      'n_pending_outbound',     unrec.n_pending_outbound,
      'note', 'unmatched_* reduce AR/AP en semana 1 para evitar doble conteo; pending_* son pagos totalmente no conciliados'
    ),
    'totals_13w', jsonb_build_object(
      'inflows_weighted',    COALESCE(agg.inflows_w, 0),
      'inflows_gross',       COALESCE(agg.inflows_g, 0),
      'outflows_weighted',   COALESCE(agg.outflows_w, 0),
      'outflows_gross',      COALESCE(agg.outflows_g, 0),
      'net_flow',            COALESCE(agg.net, 0),
      'min_closing_balance', agg.min_close,
      'max_closing_balance', agg.max_close
    ),
    'first_negative_week', (SELECT data FROM first_neg),
    'open_positions', jsonb_build_object(
      'ar_total_mxn',   op.open_ar,
      'ar_overdue_mxn', op.overdue_ar,
      'ap_total_mxn',   op.open_ap,
      'ap_overdue_mxn', op.overdue_ap,
      'so_backlog_mxn', op.so_backlog,
      'po_backlog_mxn', op.po_backlog
    ),
    'recurring_sources', jsonb_build_object(
      'payroll', src.payroll,
      'opex',    src.opex,
      'tax',     src.tax
    )
  )
  FROM cash, transit, unrec, agg, open_positions op, sources src;
$$;


-- ═══════════════════════════════════════════════════════════════
-- Grants + PostgREST reload
-- ═══════════════════════════════════════════════════════════════
GRANT SELECT ON cashflow_current_cash        TO anon, authenticated, service_role;
GRANT SELECT ON cashflow_in_transit          TO anon, authenticated, service_role;
GRANT SELECT ON cashflow_unreconciled        TO anon, authenticated, service_role;
GRANT SELECT ON cashflow_company_behavior    TO anon, authenticated, service_role;
GRANT SELECT ON cashflow_ar_predicted        TO anon, authenticated, service_role;
GRANT SELECT ON cashflow_ap_predicted        TO anon, authenticated, service_role;
GRANT SELECT ON cashflow_so_backlog          TO anon, authenticated, service_role;
GRANT SELECT ON cashflow_po_backlog          TO anon, authenticated, service_role;
GRANT SELECT ON cashflow_payroll_monthly     TO anon, authenticated, service_role;
GRANT SELECT ON cashflow_opex_monthly        TO anon, authenticated, service_role;
GRANT SELECT ON cashflow_tax_monthly         TO anon, authenticated, service_role;
GRANT SELECT ON projected_cash_flow_weekly   TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_projected_cash_flow()         TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_projected_cash_flow_summary() TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
