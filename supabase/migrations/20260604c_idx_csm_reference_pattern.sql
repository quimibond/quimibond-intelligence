-- 2026-06-04c: Índice de prefijo para acelerar reference LIKE 'TL/INSP%' en
-- canonical_stock_moves (1.64M filas). Lo usa get_cost_factors_monthly al
-- calcular metros inspeccionados, ahora denominador oficial del factor $/metro.
-- Sin él, get_full_cost_reconstruction hacía timeout (>60s).
CREATE INDEX IF NOT EXISTS idx_csm_reference_pattern
  ON public.canonical_stock_moves (reference text_pattern_ops);
