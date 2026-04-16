-- H10 — cash_flow_aging: separar overdue_91_120 y overdue_120plus
-- Audit 2026-04-16. Aplicada en prod via MCP.
-- /cobranza hero muestra 5 buckets, CompanyAgingTable mostraba 4 porque
-- cash_flow_aging colapsaba 91-120 y 120+. ar_aging_detail ya los
-- distinguía; esta migración los surface en cash_flow_aging.
-- Backward compat: mantiene overdue_90plus para consumers viejos.

CREATE OR REPLACE VIEW cash_flow_aging AS
SELECT a.company_id,
    a.company_name,
    cp.tier,
    sum(a.amount_residual) FILTER (WHERE a.aging_bucket = 'current'::text) AS current_amount,
    sum(a.amount_residual) FILTER (WHERE a.aging_bucket = '1-30'::text) AS overdue_1_30,
    sum(a.amount_residual) FILTER (WHERE a.aging_bucket = '31-60'::text) AS overdue_31_60,
    sum(a.amount_residual) FILTER (WHERE a.aging_bucket = '61-90'::text) AS overdue_61_90,
    sum(a.amount_residual) FILTER (WHERE a.aging_bucket = ANY (ARRAY['91-120'::text, '120+'::text])) AS overdue_90plus,
    sum(a.amount_residual) AS total_receivable,
    cp.total_revenue,
    sum(a.amount_residual) FILTER (WHERE a.aging_bucket = '91-120'::text) AS overdue_91_120,
    sum(a.amount_residual) FILTER (WHERE a.aging_bucket = '120+'::text)   AS overdue_120plus
   FROM ar_aging_detail a
     LEFT JOIN company_profile cp ON cp.company_id = a.company_id
  GROUP BY a.company_id, a.company_name, cp.tier, cp.total_revenue
  ORDER BY (sum(a.amount_residual)) DESC;
