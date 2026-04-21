# Design — Costos/Márgenes/Inventario · Sub-proyecto 1: Integridad de sincronización (Fase 1, cuantitativa)

**Fecha:** 2026-04-19
**Autor:** José Mizrahi (+ Claude brainstorming)
**Status:** Draft para revisión
**Repo:** qb19 (`addons/quimibond_intelligence/`) + `quimibond-intelligence` (Supabase)

---

## Contexto

Auditoría completa de costos, márgenes e inventario. Se decompuso en 4 sub-proyectos:

1. **Integridad de sincronización** (este spec)
2. Queries/views canónicas de margen/CMV en Supabase
3. Capa contable / valuación (gap abril, writedown inventario, work centers)
4. Frontend de productos/ventas/compras

Orden: 1 → 3 → 2 → 4 ya aprobado.

Este sub-proyecto 1 se ejecuta en dos fases:

- **Fase 1 (este spec):** cuantitativa. Construir harness de invariantes Odoo↔Supabase + internos, generar baseline de discrepancias.
- **Fase 2 (spec posterior):** semántica. Leer métodos `_push_*`, arreglar lo que el baseline señale, re-ejecutar hasta reducir discrepancias.

El objetivo explícito de la Fase 1 es **exponer**, no arreglar.

## Problema

Los números de costo/margen/inventario del frontend se derivan de datos sincronizados Odoo → Supabase por 21 push methods en `sync_push.py` (~2.5K LOC). No existe un harness sistemático que verifique que lo que está en Supabase refleja fielmente Odoo.

Síntomas sospechados (ya conocidos en memoria del proyecto):
- Gap de absorción abril 2026 por migración BOM → work center.
- Sobrevaluación histórica acumulada del inventario.
- Configuración parcial de work centers.

Antes de debatir esos temas contables (sub-proyecto 3), necesitamos confianza en que los datos base son fieles.

## No-objetivos

- No arreglar errores encontrados (eso es Fase 2 del mismo sub-proyecto).
- No tocar la capa contable ni discutir políticas de valuación (sub-proyecto 3).
- No construir dashboard UI (sub-proyecto 4).
- No auditar modelos no relacionados con cost/margin/inventory (ej. `crm_leads`, `activities`, `employees`).

## Arquitectura

Dos capas de ejecución, un storage.

### Odoo-side

Archivo nuevo: `addons/quimibond_intelligence/models/sync_audit.py`

Modelo `quimibond.sync.audit` (`TransientModel`) con un método por dominio:

- `audit_products(...)`
- `audit_invoice_lines(...)`
- `audit_order_lines(...)`
- `audit_deliveries(...)`
- `audit_manufacturing(...)`
- `audit_account_balances(...)`
- `audit_bank_balances(...)`

Cada método:

1. Computa la métrica en Odoo vía ORM dentro de `(date_from, date_to)` y agrupada por `odoo_company_id` cuando aplique.
2. Pide la métrica equivalente a Supabase vía REST (`supabase_client`).
3. Compara con tolerancias.
4. Escribe fila en `audit_runs`.

Método orquestador: `run_all(date_from, date_to, scope=None, dry_run=False)` → devuelve `{run_id, summary: {ok, warn, error}, details_url}`.

### Supabase-side

Migración: `supabase/migrations/YYYYMMDD_audit_invariants.sql`.

Estructura:
- Views `v_audit_<invariant>` que devuelven filas violatorias.
- Función `run_internal_audits(p_date_from date, p_date_to date, p_run_id uuid) returns jsonb`:
  - Recorre cada view.
  - Inserta una fila por invariant en `audit_runs` con el mismo `run_id` que le pasa Odoo.
  - Retorna summary `{ok, warn, error}`.

Llamada desde Odoo: `POST /rest/v1/rpc/run_internal_audits` tras ejecutar Odoo-side.

### Storage

Nueva tabla Supabase `audit_runs`:

```sql
CREATE TABLE audit_runs (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid         NOT NULL,
  run_at       timestamptz  NOT NULL DEFAULT now(),
  source       text         NOT NULL CHECK (source IN ('odoo','supabase')),
  model        text         NOT NULL,
  invariant_key text        NOT NULL,
  bucket_key   text,                -- ej. '2026-04|sale|company-1'
  odoo_value   numeric,
  supabase_value numeric,
  diff         numeric,
  severity     text         NOT NULL CHECK (severity IN ('ok','warn','error')),
  date_from    date,
  date_to      date,
  details      jsonb
);

CREATE UNIQUE INDEX audit_runs_unique
  ON audit_runs (run_id, source, model, invariant_key, COALESCE(bucket_key,''));

CREATE INDEX audit_runs_run_at_idx ON audit_runs (run_at DESC);
CREATE INDEX audit_runs_severity_idx ON audit_runs (severity) WHERE severity != 'ok';
```

Nueva tabla `audit_tolerances`:

```sql
CREATE TABLE audit_tolerances (
  invariant_key  text PRIMARY KEY,
  abs_tolerance  numeric DEFAULT 0.01,
  pct_tolerance  numeric DEFAULT 0.001,
  notes          text
);
```

Seed inicial con defaults; sobreescribir por invariante cuando se justifique (ej. FX tiene tolerancia más alta).

## Invariantes

Todos agrupan por `odoo_company_id` cuando aplica. Todos reciben `(date_from, date_to)` excepto los marcados como *snapshot*.

### A) Odoo ↔ Supabase cross-checks

**Products (snapshot):**
1. `products.count_active` — count Odoo vs Supabase `active=true`.
2. `products.count_with_default_code` — productos con `internal_ref`.
3. `products.sum_standard_price` — suma no ponderada (señal, no contable).
4. `products.null_uom_count` — productos sin UoM.

**Invoice lines** (por mes × `move_type` × company):

5. `invoice_lines.count_per_bucket`.
6. `invoice_lines.sum_subtotal_signed_mxn` — firmado por refund (out_refund/in_refund negativo), convertido a MXN con la tasa del documento.
7. `invoice_lines.sum_qty_signed`.

**Order lines** (por mes × `order_type` × company):

8. `order_lines.count_per_bucket` — sale + purchase separados.
9. `order_lines.sum_subtotal_mxn`.
10. `order_lines.sum_qty`.

**Deliveries** (por mes × state × company):

11. `deliveries.count_done_per_month`.

**Manufacturing** (por mes × state × company):

12. `manufacturing.count_per_state`.
13. `manufacturing.sum_qty_produced`.

**Account balances** (por período × cuenta × company):

14. `account_balances.inventory_accounts_balance` — cuentas `1150.*`.
15. `account_balances.cogs_accounts_balance` — cuentas CMV (`5xxx`).
16. `account_balances.revenue_accounts_balance` — cuentas `4xxx`.

**Bank balances (snapshot):**

17. `bank_balances.count_per_journal`.
18. `bank_balances.native_balance_per_journal`.

Cada invariante: tolerancia abs + pct configurable; default `abs=0.01, pct=0.001`.

### B) Supabase-side (consistencia interna)

**Invoice lines (`odoo_invoice_lines`):**

A. `reversal_sign` — toda línea con `move_type in ('out_refund','in_refund')` debe tener `quantity` y `price_subtotal` con signo consistente. Violación: signo mezclado.

B. `price_recompute` — `abs(price_unit * quantity - price_subtotal_no_tax) <= 0.01` (tras descuento).

C. `fx_present` — líneas con `currency_id != 'MXN'` deben tener `exchange_rate > 0` y `price_subtotal_mxn` no nulo.

D. `fx_sanity` — `abs(price_subtotal * exchange_rate - price_subtotal_mxn) <= 0.01 * price_subtotal_mxn`.

**Order lines (`odoo_order_lines`):**

E. `orphan_product` — `product_id` no existe en `odoo_products`.

F. `orphan_order_sale` / `orphan_order_purchase` — `order_id` ausente en tabla padre.

**Products (`odoo_products`):**

G. `null_standard_price_active` — productos activos con `standard_price` nulo/0 (severity `warn`).

H. `null_uom` — productos sin `uom_id` (severity `error`).

I. `duplicate_default_code` — `internal_ref` duplicado entre productos activos.

**Account balances (`odoo_account_balances`):**

J. `trial_balance_zero_per_period` — `SUM(balance) per (company, period) ≈ 0` (tolerancia $1).

K. `orphan_account` — `account_code` no existe en `odoo_chart_of_accounts` para esa company.

**Multi-company:**

L. `company_leak_invoice_lines` — `invoice_lines.odoo_company_id` ≠ `invoices.odoo_company_id` del header.

M. `company_leak_order_lines` — análogo para sale + purchase.

**Deliveries (`odoo_deliveries`):**

N. `orphan_partner` — `partner_id` no existe en `contacts`.

O. `done_without_date` — `state='done'` con `date_done` nulo.

## Flujo de ejecución

### Disparo manual (one-shot)

```python
env['quimibond.sync.audit'].run_all(
    date_from='2025-04-01',
    date_to='2026-04-19',
    scope=None,  # o ['products','invoice_lines']
    dry_run=False,
)
```

Devuelve `{run_id, summary: {ok, warn, error}, details_url}`.

### Disparo automático

Cron semanal, domingo 04:00 MX, últimos 12 meses. Archivo nuevo: `data/ir_cron_audit.xml`. Si `error > 0`, escribe entrada `level='critical'` en `sync_log`.

### Orden del run

1. Odoo genera `run_id` (uuid) una vez.
2. Ejecuta invariantes Odoo-side 1–18 secuencialmente; cada uno aislado en `try/except`.
3. Llama a `rpc('run_internal_audits', {date_from, date_to, run_id})`.
4. Query final: `audit_runs WHERE run_id=X GROUP BY severity` → summary.

### Aislamiento por invariante

Excepción en uno no aborta la batch. El error se graba como fila `severity='error', details={exception, traceback}`.

### Idempotencia

El mismo `run_id` no puede reescribirse (unique constraint). Re-run = nuevo `run_id`.

### Rollback / cleanup

`audit_runs` retiene 90 días rolling. Job diario con `pg_cron` (ya habilitado en el proyecto Supabase) borra filas con `run_at < now() - interval '90 days'`.

## Tolerancias

Tabla `audit_tolerances (invariant_key, abs_tolerance, pct_tolerance, notes)` en Supabase, seed con defaults, editable vía SQL. Si falta fila para un invariant: default global `abs=0.01, pct=0.001`.

Overrides iniciales recomendados:
- `invoice_lines.sum_subtotal_signed_mxn`: `pct=0.005` (FX floating)
- `account_balances.*`: `abs=1.0` (redondeo contable)
- `bank_balances.native_balance_per_journal`: `abs=0.05`

## Error handling

- `try/except` por invariante → falla un solo invariante, no todo.
- Errores se persisten como filas `severity='error'` con traceback en `details`.
- Permite reintentar solo los que fallaron en una segunda corrida con distinto `run_id`.

## Testing

### Addon Odoo

`addons/quimibond_intelligence/tests/test_sync_audit.py`:

- Fixture con 3 facturas de control, un refund, multi-currency (MXN/USD).
- Un test por invariante cross-check:
  - Asserción `diff == 0` cuando datos limpios.
  - Asserción `severity='error'` cuando se inyecta ruido (mock que altera respuesta Supabase).
- Flag `dry_run=True` que no escribe a `audit_runs`; usado en tests y en shell exploratorio.

### Supabase

`supabase/migrations/YYYYMMDD_audit_invariants_test.sql`:

- Datos sintéticos en schema temporal.
- Cada view `v_audit_*` devuelve 0 filas sobre data limpia.
- Luego inserta data rota y valida que aparece en la view.

## Entregable

1. `addons/quimibond_intelligence/models/sync_audit.py` (~600-800 LOC estimado).
2. `addons/quimibond_intelligence/views/sync_audit_views.xml` — botón "Run audit" en panel de sync.
3. `addons/quimibond_intelligence/data/ir_cron_audit.xml` — cron semanal.
4. `addons/quimibond_intelligence/security/ir.model.access.csv` — permisos (append).
5. `addons/quimibond_intelligence/tests/test_sync_audit.py`.
6. `supabase/migrations/YYYYMMDD_audit_runs_table.sql` — DDL tabla + índices.
7. `supabase/migrations/YYYYMMDD_audit_tolerances_seed.sql`.
8. `supabase/migrations/YYYYMMDD_audit_invariants.sql` — views + función.
9. `supabase/migrations/YYYYMMDD_audit_invariants_test.sql`.
10. `docs/audit_invariants.md` — listado canónico: cada invariante, qué mide, qué significa una violación, acción recomendada.
11. **Primer reporte ejecutado en producción** con `date_from=2025-04-01, date_to=2026-04-19` → CSV de `audit_runs WHERE severity != 'ok'` como baseline para Fase 2.

> Nota: todas las migraciones `YYYYMMDD_*` usan la fecha del día en que se ejecuta la implementación (formato `yyyymmdd`), consistente con la convención existente en `supabase/migrations/`.

## Criterio de éxito

- Todos los invariantes implementados, tested y documentados.
- `run_all()` ejecutable desde shell Odoo.sh en <10 min para ventana 12m.
- Primer baseline obtenido y compartido con José.
- Cron semanal operativo.
- Baseline alimenta a Fase 2 (fixes semánticos).

## Fuera de alcance (explícito)

- Arreglar discrepancias encontradas.
- Dashboard UI en frontend.
- Migración contable (work centers, writedown inventario).
- Auditoría de modelos fuera de cost/margin/inventory.
- Auditoría de `sync_pull` (Supabase → Odoo); esto solo cubre push.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Invariantes demasiado estrictos generan ruido | Tabla `audit_tolerances` permite ajustar sin redeploy. |
| Auditoría satura Odoo.sh o cuota Supabase | Cron semanal, no más frecuente. Query-as-of-last-sync, no live. Paginación en REST calls. |
| Baseline inicial revela cientos de errores | Priorizar por severity + impacto en cost/margin. Fase 2 trabaja en orden. |
| Tolerances mal calibradas ocultan bugs reales | Documentar el racional de cada override. Revisión en Fase 2. |
| Drift entre definiciones Odoo-side y Supabase-side | `audit_invariants.md` es fuente única; código debe citar el invariant_key documentado. |

## Secuencia para Fase 2 (preview, no parte de este spec)

1. Leer baseline `audit_runs WHERE severity != 'ok' ORDER BY abs(diff) DESC`.
2. Por cada grupo de errores, leer el método `_push_*` relevante, identificar root cause.
3. Commit de fix + re-run del invariante afectado → diff debe caer a 0 o dentro de tolerancia.
4. Actualizar `docs/audit_invariants.md` si el fix cambia semántica.
