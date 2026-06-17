-- 2026-06-12: RPC get_defect_cost_monthly — costo de defectos y degradación
-- a saldo, medido analíticamente (fuera de la contabilidad).
--
-- Contexto (auditoría saldo/desperdicio 2026-06-12, sesión con CEO):
--   El costo del desperdicio YA está cobrado en el costo de la tela buena:
--   las BOMs de acabado consumen +12-18% vs peso teórico (el plan de
--   capacidades de manufactura asume 10% de merma). Por eso el saldo debe
--   valer $0 en libros (política, ver odoo_pending_actions
--   'saldo-desperdicio-costo-cero'). El costo de defectos se mide aquí,
--   analíticamente, no inflando el costo del saldo.
--
-- Tres canales (por mes):
--   1. defectos_tejido — subproducto SALDO nacido en órdenes de producción
--      (TL/OP-%). Costo = kg de saldo × costo unitario de la orden
--      (componentes consumidos ÷ kg totales producidos). Funciona aunque
--      el saldo entre a $0 (cost share 0% desde jun-2026).
--   2. degradacion_conversion — tela convertida a saldo vía TL/CONV-%.
--      kg y valor transferido (el costo AVCO que las telas le pasaron al
--      saldo). Bajo la política nueva el valor debe tender a $0 para
--      desperdicio; si sigue alto, la práctica de conversiones con costo
--      continúa.
--   3. ajuste_valuado — entradas de saldo por ajuste de inventario CON
--      valor (como dic-2024 $1.39M y dic-2025 $0.79M). Bajo la política
--      nueva debe ser $0 siempre; cualquier fila aquí es bandera roja.
--
-- Productos: canonical_products.is_byproduct = true (SALDO*/DESPERDICIO*
-- + overrides manuales).
--
-- Hallazgos iniciales (al crear el RPC):
--   - defectos_tejido: ~$10-14k/mes (397 kg may, 237 kg jun) — inmaterial.
--   - degradacion_conversion: $141k-$668k/mes 2026, promedio 12m ~$420k.
--     Mayo 2026: 19,466 kg / $668k (3× lo normal).

CREATE OR REPLACE FUNCTION public.get_defect_cost_monthly(p_months_back integer DEFAULT 18)
RETURNS TABLE(
  mes text,
  canal text,
  kg numeric,
  costo_mxn numeric,
  eventos bigint
)
LANGUAGE sql
STABLE
AS $function$
WITH cutoff AS (
  SELECT (date_trunc('month', CURRENT_DATE)
          - (p_months_back - 1) * interval '1 month')::date AS d
),
byprod AS (
  SELECT id FROM public.canonical_products WHERE is_byproduct = true
),
-- Canal 1: subproducto nacido en órdenes de producción (tejido).
tej_births AS (
  SELECT m.reference,
         to_char(m.date, 'YYYY-MM') AS mes,
         SUM(m.quantity) AS kg_saldo
  FROM public.canonical_stock_moves m
  JOIN byprod b ON b.id = m.canonical_product_id
  WHERE m.state = 'done'
    AND m.production_id IS NOT NULL
    AND m.reference LIKE 'TL/OP-%'
    AND m.date >= (SELECT d FROM cutoff)
  GROUP BY 1, 2
),
tej_mo AS (
  -- Costo unitario de cada orden: componentes consumidos ÷ kg producidos.
  SELECT m.reference,
         SUM(m.value) FILTER (WHERE m.raw_material_production_id IS NOT NULL) AS costo_consumido,
         SUM(m.quantity) FILTER (WHERE m.production_id IS NOT NULL) AS kg_total
  FROM public.canonical_stock_moves m
  JOIN (SELECT DISTINCT reference FROM tej_births) r USING (reference)
  WHERE m.state = 'done'
  GROUP BY 1
),
canal_tejido AS (
  SELECT t.mes,
         'defectos_tejido'::text AS canal,
         SUM(t.kg_saldo) AS kg,
         SUM(t.kg_saldo * c.costo_consumido / NULLIF(c.kg_total, 0)) AS costo_mxn,
         COUNT(DISTINCT t.reference) AS eventos
  FROM tej_births t
  JOIN tej_mo c USING (reference)
  GROUP BY 1
),
-- Canal 2: degradación de tela a saldo vía conversiones.
canal_conv AS (
  SELECT to_char(m.date, 'YYYY-MM') AS mes,
         'degradacion_conversion'::text AS canal,
         SUM(m.quantity) AS kg,
         SUM(m.value) AS costo_mxn,
         COUNT(DISTINCT m.reference) AS eventos
  FROM public.canonical_stock_moves m
  JOIN byprod b ON b.id = m.canonical_product_id
  WHERE m.state = 'done'
    AND m.production_id IS NOT NULL
    AND m.reference LIKE 'TL/CONV%'
    AND m.date >= (SELECT d FROM cutoff)
  GROUP BY 1
),
-- Canal 3: entradas de saldo por ajuste de inventario CON valor.
canal_ajuste AS (
  SELECT to_char(m.date, 'YYYY-MM') AS mes,
         'ajuste_valuado'::text AS canal,
         SUM(m.quantity) AS kg,
         SUM(m.value) AS costo_mxn,
         COUNT(*) AS eventos
  FROM public.canonical_stock_moves m
  JOIN byprod b ON b.id = m.canonical_product_id
  WHERE m.state = 'done'
    AND m.move_category = 'ajuste_inventario'
    AND m.is_out = false
    AND m.value > 0
    AND m.date >= (SELECT d FROM cutoff)
  GROUP BY 1
)
SELECT * FROM canal_tejido
UNION ALL
SELECT * FROM canal_conv
UNION ALL
SELECT * FROM canal_ajuste
ORDER BY mes, canal;
$function$;

COMMENT ON FUNCTION public.get_defect_cost_monthly(integer) IS
  'Costo de defectos/degradación a saldo por mes y canal (defectos_tejido, degradacion_conversion, ajuste_valuado). Medición analítica — el saldo en libros debe valer $0.';
