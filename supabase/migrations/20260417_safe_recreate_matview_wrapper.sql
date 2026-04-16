-- Item 2 · safe_recreate_matview() + dependents_of() recursivo
-- Aplicada en prod via MCP: `safe_recreate_matview_wrapper` +
-- `dependents_of_recursive_v2`.
--
-- Contexto: la migración M3 hoy hizo DROP MATERIALIZED VIEW
-- payment_predictions CASCADE y se llevó silenciosamente 4 views
-- (cashflow_company_behavior, cashflow_ar_predicted, cashflow_so_backlog,
-- projected_cash_flow_weekly). No se detectó hasta que /finanzas mostró
-- error visual. Esta infra previene esa clase de bug.
--
-- 2 funciones:
--
-- 1. `dependents_of(obj_name, schema)` — RECURSIVE CTE sobre pg_depend
--    que lista TODOS los views/matviews dependientes con su depth
--    (1 = directo, N = transitivo). Guard anti-cycles con depth<10.
--
-- 2. `safe_recreate_matview(target, new_def, schema)` — wrapper para
--    DROP CASCADE + CREATE + recreate dependents en UNA transacción:
--      a. Captura dependents con dependents_of()
--      b. DROP CASCADE
--      c. Ejecuta new_def
--      d. Recrea dependents en orden de depth ASC
--      e. Loguea summary a pipeline_logs
--      f. Rollback automático si algo falla
--
-- Usage:
--   SELECT safe_recreate_matview(
--     'payment_predictions',
--     'CREATE MATERIALIZED VIEW payment_predictions AS SELECT ...'
--   );
--
-- Test en M3 scenario:
--   SELECT dep_name, depth FROM dependents_of('payment_predictions');
--   cashflow_company_behavior (1) · cashflow_ar_predicted (2) ·
--   cashflow_so_backlog (2) · projected_cash_flow_weekly (3)

DROP FUNCTION IF EXISTS dependents_of(text, text);

CREATE OR REPLACE FUNCTION dependents_of(obj_name text, obj_schema text DEFAULT 'public')
RETURNS TABLE(
  dep_name text,
  dep_kind text,
  dep_def text,
  depth int
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE direct_deps AS (
    SELECT DISTINCT dep.relname::text AS d_name, dep.relkind AS d_kind, dep.oid AS d_oid, 1 AS d_depth
    FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid
    JOIN pg_class dep ON dep.oid = r.ev_class
    JOIN pg_class src ON src.oid = d.refobjid
    JOIN pg_namespace n ON n.oid = src.relnamespace
    WHERE d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
      AND src.relname = obj_name AND n.nspname = obj_schema
      AND dep.relname <> obj_name AND dep.relkind IN ('v', 'm')
  ),
  chain AS (
    SELECT d_name, d_kind, d_oid, d_depth FROM direct_deps
    UNION
    SELECT DISTINCT dep.relname::text, dep.relkind, dep.oid, c.d_depth + 1
    FROM chain c
    JOIN pg_depend d ON d.refobjid = c.d_oid
    JOIN pg_rewrite r ON r.oid = d.objid
    JOIN pg_class dep ON dep.oid = r.ev_class
    WHERE d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
      AND dep.relname <> c.d_name AND dep.relkind IN ('v', 'm')
      AND c.d_depth < 10
  )
  SELECT d_name, CASE d_kind WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview' ELSE d_kind::text END::text,
    pg_get_viewdef(d_oid, true)::text, MIN(d_depth)
  FROM chain
  GROUP BY d_name, d_kind, d_oid
  ORDER BY MIN(d_depth), d_name;
END;
$$;

COMMENT ON FUNCTION dependents_of(text, text) IS
  'Lista recursiva de views/matviews dependientes (depth 1..N). Ordenados para recreate en orden correcto.';

CREATE OR REPLACE FUNCTION safe_recreate_matview(
  target_name text,
  new_def text,
  target_schema text DEFAULT 'public'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  dep record;
  dep_defs jsonb := '[]'::jsonb;
  dep_count int := 0;
  result jsonb;
BEGIN
  FOR dep IN SELECT * FROM dependents_of(target_name, target_schema) ORDER BY depth, dep_name LOOP
    dep_count := dep_count + 1;
    dep_defs := dep_defs || jsonb_build_object(
      'name', dep.dep_name, 'kind', dep.dep_kind, 'def', dep.dep_def, 'depth', dep.depth
    );
  END LOOP;

  EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS %I.%I CASCADE', target_schema, target_name);
  EXECUTE new_def;

  FOR dep IN SELECT value AS dep_json FROM jsonb_array_elements(dep_defs) LOOP
    EXECUTE format(
      'CREATE %s %I.%I AS %s',
      CASE dep.dep_json->>'kind' WHEN 'matview' THEN 'MATERIALIZED VIEW' ELSE 'OR REPLACE VIEW' END,
      target_schema, dep.dep_json->>'name', dep.dep_json->>'def'
    );
  END LOOP;

  result := jsonb_build_object('target', target_name, 'dependents_recreated', dep_count,
                               'dependents', dep_defs, 'timestamp', NOW());

  BEGIN
    INSERT INTO pipeline_logs (level, phase, message, details, created_at)
    VALUES ('info', 'safe_recreate_matview',
      'Recreated ' || target_name || ' + ' || dep_count::text || ' dependents', result, NOW());
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN result;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    INSERT INTO pipeline_logs (level, phase, message, details, created_at)
    VALUES ('error', 'safe_recreate_matview',
      'FAILED to recreate ' || target_name || ': ' || SQLERRM,
      jsonb_build_object('target', target_name, 'error', SQLERRM, 'sqlstate', SQLSTATE), NOW());
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RAISE;
END;
$$;

COMMENT ON FUNCTION safe_recreate_matview(text, text, text) IS
  'DROP CASCADE + CREATE + recreate dependents en una sola transacción atomic. Previene rompimiento silencioso tipo M3.';
