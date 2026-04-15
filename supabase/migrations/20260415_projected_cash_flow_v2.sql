-- ============================================================================
-- Migration 20260415: Projected Cash Flow v2 (Flujo de Efectivo Proyectado)
--
-- Proyección semanal del cash a 13 semanas combinando TODO el dato financiero:
--
--   Inflows (entradas):
--     - ar_committed : facturas cliente no pagadas con due_date en la semana,
--                      ajustado por atraso histórico (payment_predictions.
--                      avg_days_to_pay cuando disponible)
--     - ar_overdue   : facturas vencidas no pagadas (acumuladas en semana 0)
--     - so_pipeline  : sale orders confirmadas con commitment_date en la
--                      semana (informativo, NO suma al running balance)
--
--   Outflows (salidas):
--     - ap_committed    : facturas proveedor no pagadas con due_date en la semana
--     - ap_overdue      : facturas proveedor vencidas (acumuladas en semana 0)
--     - po_pipeline     : purchase orders confirmadas, mapeadas a pago a 30d
--     - payroll         : nómina estimada (CFDI N últimos 90d o cuentas de
--                         gasto con nombre sueldo/salario/nómina), pagada el 15
--                         y el último día de cada mes (split 50/50 quincenal)
--     - opex_recurring  : promedio 3m de gastos operativos (sin COGS ni nómina)
--                         dividido en 4.3333 para ritmo semanal
--
--   Balance:
--     - opening_balance : cash al inicio de la semana (= cash_now + sum(net)
--                         de semanas previas)
--     - closing_balance : cash al cierre de la semana
--
-- Cambios vs v1:
--   • `cash_now` ahora suma TODOS los saldos bancarios (incluye deuda de
--     tarjetas). v1 filtraba current_balance > 0 lo cual ignoraba credit cards.
--   • Usa `amount_residual_mxn` cuando está disponible (currency normalizado).
--   • AR committed se shiftea por avg_days_to_pay histórico via
--     payment_predictions MV (fallback: due_date tal cual).
--   • Expone 3 escenarios agregados: base, optimistic, conservative.
--   • Expone top-5 contribuyentes de AR por semana para drill-down.
--
-- Expone:
--   - VIEW  projected_cash_flow_weekly        (13 semanas, 1 row/sem)
--   - RPC   get_projected_cash_flow_summary() (agregados + escenarios)
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════
-- VIEW: projected_cash_flow_weekly
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW projected_cash_flow_weekly AS
WITH
  cash AS (
    -- Efectivo disponible real = TODOS los saldos bancarios (positivos +
    -- negativos de tarjetas de crédito). v1 filtraba > 0 pero eso ignoraba la
    -- deuda de tarjetas, inflando artificialmente el opening balance.
    SELECT COALESCE(sum(current_balance), 0)::numeric AS cash_now
      FROM odoo_bank_balances
  ),

  payroll_cfdi AS (
    SELECT avg(monthly_total)::numeric AS monthly
      FROM (
        SELECT sum(total) AS monthly_total
          FROM cfdi_documents
         WHERE tipo_comprobante = 'N'
           AND fecha >= current_date - interval '90 days'
         GROUP BY date_trunc('month', fecha)
      ) m
  ),

  payroll_accounts AS (
    SELECT avg(monthly_total)::numeric AS monthly
      FROM (
        SELECT period, sum(balance) AS monthly_total
          FROM odoo_account_balances
         WHERE account_type LIKE 'expense%'
           AND (account_name ILIKE '%sueldo%'
                OR account_name ILIKE '%salario%'
                OR account_name ILIKE '%nomina%'
                OR account_name ILIKE '%nómina%')
         GROUP BY period
         ORDER BY period DESC
         LIMIT 3
      ) m
  ),

  payroll AS (
    SELECT COALESCE(
             NULLIF((SELECT monthly FROM payroll_cfdi), 0),
             (SELECT monthly FROM payroll_accounts),
             0
           )::numeric AS monthly
  ),

  opex AS (
    -- Gastos operativos recurrentes: expense_* excluyendo COGS y nómina
    SELECT COALESCE(avg(monthly_total), 0)::numeric AS monthly
      FROM (
        SELECT period, sum(balance) AS monthly_total
          FROM odoo_account_balances
         WHERE account_type LIKE 'expense%'
           AND account_type <> 'expense_direct_cost'
           AND NOT (account_name ILIKE '%sueldo%'
                    OR account_name ILIKE '%salario%'
                    OR account_name ILIKE '%nomina%'
                    OR account_name ILIKE '%nómina%')
         GROUP BY period
         ORDER BY period DESC
         LIMIT 3
      ) m
  ),

  params AS (
    -- Lunes ISO de la semana actual
    SELECT (date_trunc('week', current_date))::date AS monday
  ),

  weeks AS (
    SELECT
      gs::int AS week_index,
      (p.monday + gs * 7)::date AS week_start,
      (p.monday + gs * 7 + 6)::date AS week_end
    FROM params p
    CROSS JOIN generate_series(0, 12) gs
  ),

  -- Ajuste de AR por atraso histórico de pago por empresa.
  -- payment_predictions es una MV con 1 row por company_id; usamos
  -- avg_days_to_pay - 30 (términos típicos) como shift en días.
  ar_with_shift AS (
    SELECT
      i.amount_residual_mxn AS residual_mxn,
      i.amount_residual     AS residual_raw,
      i.due_date,
      -- shift_days: cuántos días extra agregar al due_date para modelar atraso
      -- histórico. Clampeamos a [0, 60] para no deformar el horizonte.
      GREATEST(0, LEAST(60,
        COALESCE(pp.avg_days_to_pay, 30)::int - 30
      )) AS shift_days
    FROM odoo_invoices i
    LEFT JOIN payment_predictions pp
      ON pp.company_id = i.company_id
    WHERE i.move_type = 'out_invoice'
      AND i.state = 'posted'
      AND i.payment_state IN ('not_paid', 'partial')
      AND COALESCE(i.amount_residual_mxn, i.amount_residual, 0) > 0
      AND i.due_date IS NOT NULL
  ),

  ar_rows AS (
    SELECT
      w.week_index,
      COALESCE(sum(
        CASE
          WHEN (ar.due_date + ar.shift_days) BETWEEN w.week_start AND w.week_end
          THEN COALESCE(ar.residual_mxn, ar.residual_raw)
          ELSE 0
        END
      ), 0) AS committed,
      COALESCE(sum(
        CASE
          WHEN w.week_index = 0 AND (ar.due_date + ar.shift_days) < w.week_start
          THEN COALESCE(ar.residual_mxn, ar.residual_raw)
          ELSE 0
        END
      ), 0) AS overdue
    FROM weeks w
    LEFT JOIN ar_with_shift ar ON true
    GROUP BY w.week_index
  ),

  ap_rows AS (
    SELECT
      w.week_index,
      COALESCE(sum(
        CASE WHEN i.due_date BETWEEN w.week_start AND w.week_end
             THEN COALESCE(i.amount_residual_mxn, i.amount_residual)
             ELSE 0 END
      ), 0) AS committed,
      COALESCE(sum(
        CASE WHEN w.week_index = 0 AND i.due_date < w.week_start
             THEN COALESCE(i.amount_residual_mxn, i.amount_residual)
             ELSE 0 END
      ), 0) AS overdue
    FROM weeks w
    LEFT JOIN odoo_invoices i
      ON i.move_type = 'in_invoice'
     AND i.state = 'posted'
     AND i.payment_state IN ('not_paid', 'partial')
     AND COALESCE(i.amount_residual_mxn, i.amount_residual, 0) > 0
     AND i.due_date IS NOT NULL
    GROUP BY w.week_index
  ),

  so_rows AS (
    -- Pipeline comercial: sale orders confirmadas con commitment_date en la
    -- semana. Usamos amount_total_mxn (ya normalizado).
    SELECT
      w.week_index,
      COALESCE(sum(so.amount_total_mxn), 0)::numeric AS pipeline
    FROM weeks w
    LEFT JOIN odoo_sale_orders so
      ON so.state IN ('sale', 'done')
     AND so.commitment_date IS NOT NULL
     AND so.commitment_date::date BETWEEN w.week_start AND w.week_end
    GROUP BY w.week_index
  ),

  po_rows AS (
    -- Pipeline compras: purchase orders confirmadas, asumimos pago a 30 días
    -- desde date_order (no tenemos date_planned sincronizado).
    SELECT
      w.week_index,
      COALESCE(sum(po.amount_total_mxn), 0)::numeric AS pipeline
    FROM weeks w
    LEFT JOIN odoo_purchase_orders po
      ON po.state IN ('purchase', 'done')
     AND po.date_order IS NOT NULL
     AND (po.date_order::date + 30) BETWEEN w.week_start AND w.week_end
    GROUP BY w.week_index
  ),

  payroll_events AS (
    -- Semanas que contienen día 15 o último día del mes (nómina quincenal)
    SELECT
      w.week_index,
      (
        CASE WHEN EXISTS (
          SELECT 1
            FROM generate_series(w.week_start, w.week_end, interval '1 day') d
           WHERE extract(day FROM d) = 15
        ) THEN (SELECT monthly FROM payroll) / 2.0 ELSE 0 END
        +
        CASE WHEN EXISTS (
          SELECT 1
            FROM generate_series(w.week_start, w.week_end, interval '1 day') d
           WHERE d::date = (date_trunc('month', d) + interval '1 month - 1 day')::date
        ) THEN (SELECT monthly FROM payroll) / 2.0 ELSE 0 END
      )::numeric AS payroll_amount
    FROM weeks w
  ),

  base AS (
    SELECT
      w.week_index,
      w.week_start,
      w.week_end,
      round(ar.committed::numeric, 2)      AS ar_committed,
      round(ar.overdue::numeric, 2)        AS ar_overdue,
      round(so.pipeline::numeric, 2)       AS so_pipeline,
      round(ap.committed::numeric, 2)      AS ap_committed,
      round(ap.overdue::numeric, 2)        AS ap_overdue,
      round(po.pipeline::numeric, 2)       AS po_pipeline,
      round(pe.payroll_amount::numeric, 2) AS payroll_estimated,
      round(((SELECT monthly FROM opex) / 4.3333)::numeric, 2) AS opex_recurring
    FROM weeks w
    JOIN ar_rows ar USING (week_index)
    JOIN ap_rows ap USING (week_index)
    JOIN so_rows so USING (week_index)
    JOIN po_rows po USING (week_index)
    JOIN payroll_events pe USING (week_index)
  ),

  flows AS (
    SELECT
      b.*,
      (b.ar_committed + b.ar_overdue) AS inflows_total,
      (b.ap_committed + b.ap_overdue + b.po_pipeline
        + b.payroll_estimated + b.opex_recurring) AS outflows_total,
      ((b.ar_committed + b.ar_overdue)
       - (b.ap_committed + b.ap_overdue + b.po_pipeline
          + b.payroll_estimated + b.opex_recurring)) AS net_flow
    FROM base b
  )

SELECT
  f.week_index,
  f.week_start,
  f.week_end,
  f.ar_committed,
  f.ar_overdue,
  f.so_pipeline,
  f.ap_committed,
  f.ap_overdue,
  f.po_pipeline,
  f.payroll_estimated,
  f.opex_recurring,
  round(f.inflows_total::numeric, 2)  AS inflows_total,
  round(f.outflows_total::numeric, 2) AS outflows_total,
  round(f.net_flow::numeric, 2)       AS net_flow,
  round((
    (SELECT cash_now FROM cash)
    + COALESCE(
        sum(f.net_flow) OVER (
          ORDER BY f.week_index
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0)
  )::numeric, 2) AS opening_balance,
  round((
    (SELECT cash_now FROM cash)
    + sum(f.net_flow) OVER (
        ORDER BY f.week_index
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )
  )::numeric, 2) AS closing_balance
FROM flows f
ORDER BY f.week_index;


COMMENT ON VIEW projected_cash_flow_weekly IS
  '13 semanas de flujo de efectivo proyectado v2: CxC comprometido shifteado por atraso histórico, CxP comprometido, pipeline SO/PO, nómina quincenal estimada, opex recurrente y running balance desde el total de cash (incluyendo deuda tarjetas).';


-- ═══════════════════════════════════════════════════════════════
-- VIEW: projected_cash_flow_top_ar_by_week (top 5 AR por semana)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW projected_cash_flow_top_ar_by_week AS
WITH
  params AS (
    SELECT (date_trunc('week', current_date))::date AS monday
  ),
  weeks AS (
    SELECT
      gs::int AS week_index,
      (p.monday + gs * 7)::date AS week_start,
      (p.monday + gs * 7 + 6)::date AS week_end
    FROM params p
    CROSS JOIN generate_series(0, 12) gs
  ),
  ar_shifted AS (
    SELECT
      i.company_id,
      c.name AS company_name,
      i.name AS invoice_name,
      COALESCE(i.amount_residual_mxn, i.amount_residual, 0) AS amount,
      (i.due_date + GREATEST(0, LEAST(60,
        COALESCE(pp.avg_days_to_pay, 30)::int - 30
      )))::date AS expected_date
    FROM odoo_invoices i
    LEFT JOIN companies c ON c.id = i.company_id
    LEFT JOIN payment_predictions pp ON pp.company_id = i.company_id
    WHERE i.move_type = 'out_invoice'
      AND i.state = 'posted'
      AND i.payment_state IN ('not_paid', 'partial')
      AND COALESCE(i.amount_residual_mxn, i.amount_residual, 0) > 0
      AND i.due_date IS NOT NULL
  ),
  week_company_totals AS (
    SELECT
      w.week_index,
      a.company_id,
      a.company_name,
      sum(a.amount) AS total_amount,
      count(*)      AS invoices_count
    FROM weeks w
    JOIN ar_shifted a
      ON (w.week_index = 0 AND a.expected_date < w.week_start)
      OR (a.expected_date BETWEEN w.week_start AND w.week_end)
    GROUP BY w.week_index, a.company_id, a.company_name
  ),
  ranked AS (
    SELECT
      week_index,
      company_id,
      company_name,
      total_amount,
      invoices_count,
      row_number() OVER (
        PARTITION BY week_index ORDER BY total_amount DESC
      ) AS rank
    FROM week_company_totals
  )
SELECT
  week_index,
  rank,
  company_id,
  company_name,
  round(total_amount::numeric, 2) AS total_amount,
  invoices_count
FROM ranked
WHERE rank <= 5
ORDER BY week_index, rank;

COMMENT ON VIEW projected_cash_flow_top_ar_by_week IS
  'Top 5 empresas contribuyentes a AR por cada semana del horizonte de 13. Vencidos caen en semana 0.';


-- ═══════════════════════════════════════════════════════════════
-- RPC: get_projected_cash_flow_summary() — agregados + escenarios
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_projected_cash_flow_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cashnow AS (
    SELECT COALESCE(sum(current_balance), 0)::numeric AS cash_now
      FROM odoo_bank_balances
  ),
  agg AS (
    SELECT
      sum(inflows_total)   AS total_inflows_13w,
      sum(outflows_total)  AS total_outflows_13w,
      sum(net_flow)        AS net_flow_13w,
      min(closing_balance) AS min_closing_balance,
      max(closing_balance) AS max_closing_balance
    FROM projected_cash_flow_weekly
  ),
  first_neg AS (
    SELECT jsonb_build_object(
             'week_index', week_index,
             'week_start', week_start,
             'closing_balance', closing_balance)
      FROM projected_cash_flow_weekly
     WHERE closing_balance < 0
     ORDER BY week_index
     LIMIT 1
  ),
  overdue_today AS (
    SELECT
      COALESCE((SELECT ar_overdue FROM projected_cash_flow_weekly WHERE week_index = 0), 0) AS ar_overdue_today,
      COALESCE((SELECT ap_overdue FROM projected_cash_flow_weekly WHERE week_index = 0), 0) AS ap_overdue_today
  ),
  -- Escenarios: optimistic = inflows +10%, conservative = inflows -15% y
  -- outflows +10%. Usamos el running balance desde cashnow.
  scenarios AS (
    SELECT
      min(
        (SELECT cash_now FROM cashnow)
        + sum(net_flow * 1.10) OVER (
            ORDER BY week_index
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          )
      ) AS optimistic_min,
      min(
        (SELECT cash_now FROM cashnow)
        + sum(
            (inflows_total * 0.85)
            - (outflows_total * 1.10)
          ) OVER (
            ORDER BY week_index
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          )
      ) AS conservative_min
    FROM projected_cash_flow_weekly
  )
  SELECT jsonb_build_object(
    'cash_now',             (SELECT cash_now FROM cashnow),
    'total_inflows_13w',    COALESCE(agg.total_inflows_13w, 0),
    'total_outflows_13w',   COALESCE(agg.total_outflows_13w, 0),
    'net_flow_13w',         COALESCE(agg.net_flow_13w, 0),
    'min_closing_balance',  agg.min_closing_balance,
    'max_closing_balance',  agg.max_closing_balance,
    'first_negative_week',  (SELECT * FROM first_neg),
    'ar_overdue_today',     overdue_today.ar_overdue_today,
    'ap_overdue_today',     overdue_today.ap_overdue_today,
    'scenario_base_min',    agg.min_closing_balance,
    'scenario_optimistic_min',   scenarios.optimistic_min,
    'scenario_conservative_min', scenarios.conservative_min,
    'computed_at',          now()
  )
  FROM agg, overdue_today, scenarios;
$$;


-- RLS: la VIEW hereda los policies de las tablas base; el RPC corre SECURITY
-- DEFINER así que basta con dar EXECUTE al anon/auth/service.
GRANT SELECT ON projected_cash_flow_weekly         TO anon, authenticated, service_role;
GRANT SELECT ON projected_cash_flow_top_ar_by_week TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_projected_cash_flow_summary() TO anon, authenticated, service_role;


-- Reload PostgREST schema for the new view and RPC
NOTIFY pgrst, 'reload schema';
