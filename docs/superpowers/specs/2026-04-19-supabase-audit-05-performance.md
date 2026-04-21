# Fase 4 — Performance

**Parent spec:** [00-master](./2026-04-19-supabase-audit-00-master.md)
**Duración:** 5–7 días
**Estado:** bloqueada por Fase 3

---

## 1. Objetivo

Cerrar deuda de performance: FKs sin índice, índices sin uso, MVs refrescadas de más o nunca, crons que se solapan sin coordinación, y la estrategia de connection pooling de Auth. DoD: lint de performance vacío en INFO, p95 de queries de dashboards <500ms.

## 2. Acciones

### 2.1 Añadir índices cubridores a FKs sin índice

Baseline del lint (FKs conocidas):
- `ingestion.sync_failure.run_id` → `ingestion.sync_run`
- `public.briefings.company_id` → `public.companies`
- `public.contacts.entity_id` → `public.entities`
- `public.emails.thread_id` → `public.threads`
- `public.revenue_metrics.contact_id` → `public.contacts` *(si la tabla se conserva; si se dropeó en Fase 2, skip)*
- `public.syntage_invoices.company_id` → `public.companies`
- + lo adicional que liste `get_advisors(performance)` cuando se re-corre

**Procedimiento:**
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS <tabla>_<col>_idx
  ON public.<tabla> (<col>);
```

`CONCURRENTLY` para no bloquear writes. Validar con `EXPLAIN` que las queries JOIN ahora usan index scan.

### 2.2 Dropear índices sin uso confirmado

Del lint, 11+ índices sin uso. Confirmar antes de drop:
```sql
SELECT indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE schemaname = 'public' AND idx_scan = 0
  AND indexrelname IN (<lista del lint>)
ORDER BY pg_relation_size(indexrelid) DESC;
```

Solo dropear los que llevan >30 días sin uso y no son UNIQUE/PK. Lista probable (del lint inicial):
- `idx_syntage_payments_batch_id`
- `agent_tickets_from_agent_id_idx`
- `departments_lead_user_id_idx`
- `director_analysis_runs_insight_id_idx`
- `syntage_electronic_accounting_xml_file_id_idx`
- `syntage_invoice_payments_xml_file_id_idx`
- `syntage_invoices_pdf_file_id_idx`
- `syntage_invoices_xml_file_id_idx`
- `syntage_tax_retentions_xml_file_id_idx`
- `syntage_tax_returns_pdf_file_id_idx`
- `syntage_tax_status_pdf_file_id_idx`
- `invoices_unified_cancelled_idx`, `invoices_unified_email_id_idx`
- `payments_unified_company_date_idx`, `payments_unified_match_status_idx`
- `audit_runs_severity_idx`

```sql
DROP INDEX CONCURRENTLY IF EXISTS <idx_name>;
```

### 2.3 Coordinar crons con `pg_advisory_lock`

Hoy 5 crons, dos con riesgo de solape:
- `15 */2 * * *` — `refresh_all_matviews` (35 MVs)
- `*/15 * * * *` — `refresh_invoices_unified` + `refresh_payments_unified`

Si el `refresh_all_matviews` (ventana ~2h) aún corre cuando empieza el `*/15`, pelean por locks.

**Fix:**
```sql
CREATE OR REPLACE FUNCTION refresh_all_matviews_guarded()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('refresh_matviews')) THEN
    RAISE NOTICE 'skipping — another refresh in progress';
    RETURN;
  END IF;
  BEGIN
    PERFORM refresh_all_matviews();
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_advisory_unlock(hashtext('refresh_matviews'));
    RAISE;
  END;
  PERFORM pg_advisory_unlock(hashtext('refresh_matviews'));
END $$;
```

Aplicar mismo pattern a `refresh_syntage_unified`. Crons apuntan a las versiones `_guarded`.

### 2.4 Evaluar refresh incremental para `invoices_unified` / `payments_unified`

**Hoy:** `REFRESH MATERIALIZED VIEW CONCURRENTLY` cada 15 min sobre 247 MB + 31 MB. Costo acumulativo alto.

**Opciones:**
1. **Mantener como está** si tiempo de refresh <2 min y no bloquea reads. Medir primero: `\timing` en refresh manual.
2. **Tabla materializada manual** (no MV): tabla `invoices_unified_inc` con triggers en `odoo_invoices` / `syntage_invoices` que hacen `INSERT ... ON CONFLICT UPDATE`. Refresh incremental real. Complejo pero escala.
3. **pg_ivm extension** (si Supabase la soporta — verificar). Incremental materialized views gratis.

**Decisión recomendada:** medir primero. Si el refresh toma >60s, implementar opción 2 solo para `invoices_unified`. Si <60s, mantener.

### 2.5 PK en `agent_insights_archive_pre_fase6`

Si la tabla se conserva (decisión de Fase 2):
```sql
ALTER TABLE public.agent_insights_archive_pre_fase6 ADD COLUMN id bigserial PRIMARY KEY;
```

Si se dropea en Fase 2, skip.

### 2.6 Auth DB connection strategy

Del lint: "Auth server configured to use at most 10 connections". Supabase recomienda cambio a estrategia % basada.

**Acción:** vía dashboard Supabase (Settings → Auth → Advanced) cambiar a `percentage`. Si la instancia escala a tamaño mayor, Auth escala con ella automáticamente.

### 2.7 Observabilidad — alertar sobre regresión futura

Añadir a `audit_runs` invariantes de performance:
- `invoices_unified_stale`: fail si MV no refrescada en >20 min
- `mv_journal_flow_profile_empty`: fail si row count = 0
- `unused_index_count`: fail si >5 índices sin uso detectados

Invocar desde el cron `audit_runs_retention_cleanup` (ya corre diario 3:30).

### 2.8 Re-run del lint

```
mcp__supabase__get_advisors(performance)
```

Debe retornar 0 lints actionables. El `auth_db_connections_absolute` puede quedar como INFO si el usuario decide mantener.

## 3. DoD

1. 0 FKs sin índice cubridor en lint
2. ≥10 índices sin uso eliminados
3. Crons con `pg_advisory_lock`; verificado via logs que skip funciona
4. `invoices_unified` / `payments_unified`: refresh duration medido y documentado; incremental implementado si aplica
5. Auth DB connection en percentage strategy
6. `audit_runs` con invariantes de perf corriendo
7. p95 de queries de dashboard principales (`/dashboard`, `/companies/[id]`, `/invoices`) <500ms (medir con EXPLAIN ANALYZE o logs de Next.js)

## 4. Riesgos

| Riesgo | Mitigación |
|---|---|
| `CREATE INDEX CONCURRENTLY` falla por uniqueness invalida | Limpiar datos primero (no debería pasar para índices no-unique) |
| Advisory lock mal implementado causa deadlock | Testear con ejecución manual simultánea en branch |
| Refresh incremental tiene edge cases (deletes no se propagan) | Mantener refresh completo como fallback cron diario 3am |
| Drop de índice que el planner usaba en queries raras | Monitor pg_stat_statements 7 días post-drop; recrear si aparece regresión |

## 5. Out of scope

- Partitioning de tablas grandes (`emails` 113K, `syntage_invoices` 130K, `health_scores` 48K) — si algún día hace falta, proyecto aparte
- Redis / pgbouncer tuning — fuera de Supabase managed
- Query rewrites en código de aplicación — este spec solo DB
