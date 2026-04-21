# Fase 0 — Contención

**Parent spec:** [00-master](./2026-04-19-supabase-audit-00-master.md)
**Duración:** 3–5 días
**Estado:** ready

---

## 1. Objetivo

Parar el sangrado sin refactorizar. Resolver issues que hoy están contaminando los dashboards y la capa unificada, para que las fases siguientes no construyan sobre data rota.

## 2. Acciones

### 2.1 Diagnosticar y revivir el cron de reconciliation (prioridad 1)

**Evidencia:** de 8 `issue_types`, solo 2 corrieron después de 2026-04-17 20:29 (`posted_but_sat_uncertified`, `partner_blacklist_69b`). Los otros 6 (`sat_only_cfdi_issued`, `sat_only_cfdi_received`, `payment_missing_complemento`, `complemento_missing_payment`, `cancelled_but_posted`, `amount_mismatch`) llevan ~2 días sin detección nueva.

**Pasos:**
1. Localizar el trigger de la reconciliation: buscar en `pg_cron.job` (no aparece explícito en el inventario), en `/api/cron/*` del frontend (Vercel), o en edge functions. El reporte de schema mostró 5 crons; ninguno obvio para reconciliation — probable que viva fuera de pg_cron.
2. Revisar logs del endpoint/función que ejecuta `refresh_*_unified()` (existen ambas funciones, pero solo `refresh_invoices_unified`/`refresh_payments_unified` están en cron `*/15`). Confirmar si el que genera `reconciliation_issues` dejó de correr o si corre pero no escribe.
3. Si el motor corre pero solo escribe 2 tipos: hay bug en lógica de detección de los otros 6 — revisar la función/query que los alimenta.
4. Verificar que trigger `trg_schedule_unified_refresh` se dispara al insertar en `unified_refresh_queue` (tabla hoy tiene 0 rows — puede que el mecanismo esté desarmado).

**DoD:** los 8 `issue_types` con detección reciente (<1h) en `reconciliation_issues.detected_at`.

### 2.2 Deduplicar `odoo_invoices` por `cfdi_uuid`

**Evidencia:** 1,547 UUIDs duplicados, 3,774 filas extra. Contamina `invoices_unified` (96K rows vs 157K esperados).

**Pasos:**
1. Crear tabla de respaldo: `CREATE TABLE odoo_invoices_archive_pre_dedup AS SELECT * FROM odoo_invoices WHERE cfdi_uuid IN (SELECT cfdi_uuid FROM odoo_invoices WHERE cfdi_uuid IS NOT NULL GROUP BY cfdi_uuid HAVING COUNT(*)>1);`
2. Política de conservación: por cada UUID duplicado, retener la fila con `write_date` máximo (o `id` máximo como desempate).
3. DELETE de las filas perdedoras desde `odoo_invoices`.
4. Añadir índice UNIQUE parcial: `CREATE UNIQUE INDEX odoo_invoices_cfdi_uuid_unique ON odoo_invoices (cfdi_uuid) WHERE cfdi_uuid IS NOT NULL;` — previene recurrencia.
5. Revisar el push del addon (`_push_invoices`) para identificar por qué insertaba duplicados — posible bug en la llave de upsert. Documentar (no fix en Fase 0, deja tarjeta para Fase 2).
6. `REFRESH MATERIALIZED VIEW CONCURRENTLY invoices_unified;` y validar row count.

**DoD:** 0 duplicados en `odoo_invoices.cfdi_uuid`; `invoices_unified` row count ≈ odoo_invoices (post-dedup) + syntage_invoices. Tabla `odoo_invoices_archive_pre_dedup` existe con los 3,774 removidos.

### 2.3 Revivir `odoo_snapshots` cron

**Evidencia:** último `created_at` es 2026-04-19 05:30 (~21h). Si el snapshot es diario, debería haber corrido.

**Pasos:**
1. Revisar `/api/pipeline/snapshot` (RPC `take_daily_snapshot`) en el frontend + cron de Vercel (`vercel.json`).
2. Verificar logs de última ejecución; si falla, arreglar.
3. Si el cron está bien pero `take_daily_snapshot()` no inserta: inspeccionar la función con `pg_get_functiondef`.

**DoD:** `odoo_snapshots` con entrada de hoy.

### 2.4 Revivir `odoo_crm_leads` sync

**Evidencia:** 20 rows, sin cambio en ~2 días, cuando el CRM de Odoo tiene más leads.

**Pasos:**
1. Revisar filtro en `_push_crm_leads` (addon). ¿Filtra por un usuario/equipo que no aplica?
2. Verificar permisos Odoo.sh del usuario con el que corre el cron del addon — puede no tener acceso a `crm.lead`.
3. Probar manualmente: en shell Odoo, `env['crm.lead'].search_count([])` vs lo que el push filtra.

**DoD:** count ≥ count de Odoo; rows nuevos visibles.

### 2.5 Diagnosticar `journal_flow_profile` MV

**Evidencia:** `last_autoanalyze` nunca se disparó → la MV nunca refrescó o está vacía.

**Pasos:**
1. `SELECT COUNT(*) FROM journal_flow_profile;` — ¿tiene rows?
2. Si está vacía: correr `REFRESH MATERIALIZED VIEW journal_flow_profile;` manualmente. Si falla, leer el error y arreglar definition.
3. Si tiene rows pero `autoanalyze` nunca corrió: forzar `ANALYZE journal_flow_profile;`.
4. Confirmar que `refresh_all_matviews()` la incluye. Si no, añadirla.

**DoD:** MV poblada + incluida en refresh.

### 2.6 Baseline audit

Dejar un baseline antes de empezar fases siguientes:
```sql
INSERT INTO audit_runs (invariant, severity, passed, detail, run_at)
SELECT 'phase_0_baseline', 'info', true,
  jsonb_build_object(
    'odoo_invoices_total', (SELECT COUNT(*) FROM odoo_invoices),
    'cfdi_uuid_dupes', (SELECT COUNT(*) FROM (SELECT cfdi_uuid FROM odoo_invoices WHERE cfdi_uuid IS NOT NULL GROUP BY cfdi_uuid HAVING COUNT(*)>1) x),
    'reconciliation_open', (SELECT COUNT(*) FROM reconciliation_issues WHERE resolved_at IS NULL),
    'invoices_unified_rows', (SELECT COUNT(*) FROM invoices_unified)
  ), now();
```

## 3. Out of scope (para Fases siguientes)

- Fix en el push del addon que genera duplicados → Fase 2 (necesita decisión arquitectónica sobre llave de upsert)
- Auto-resolve de los 4 `issue_types` que acumulan → Fase 1 (requiere diseño de lógica)
- Arreglar 2,373 order_lines huérfanas y 1,286 payments sin partner → Fase 2 (relacionado con revert `c0badfe`)

## 4. Riesgos

| Riesgo | Mitigación |
|---|---|
| DELETE de duplicados borra factura legítima | Archive antes de DELETE; retener 90 días |
| `REFRESH MATERIALIZED VIEW` bloquea prod | Usar `CONCURRENTLY`; programar fuera de horario pico |
| Cron de reconciliation depende de edge function privada que no puedo leer | Pedir acceso a logs Supabase / Vercel antes de empezar |

## 5. Rollback

- Dedup: `INSERT INTO odoo_invoices SELECT * FROM odoo_invoices_archive_pre_dedup;` + drop del índice UNIQUE parcial.
- Snapshot cron: revertir commit de frontend si tocamos `vercel.json`.
- Todo lo demás es investigación + re-activación, no destructivo.

## 6. DoD de la fase

1. Reconciliation corriendo los 8 `issue_types` (<1h de detección reciente)
2. 0 duplicados `cfdi_uuid`; `invoices_unified` consistente
3. `odoo_snapshots` y `odoo_crm_leads` con data fresca
4. `journal_flow_profile` poblada
5. Baseline registrado en `audit_runs`
6. Commit con migración idempotente en `supabase/migrations/<timestamp>_phase_0_containment.sql`
