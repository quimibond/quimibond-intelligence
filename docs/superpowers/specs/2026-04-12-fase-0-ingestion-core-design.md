# Fase 0 — Capa de Ingesta con Integridad Total y Extensible

**Fecha:** 2026-04-12
**Autor:** Brainstorming jj + Claude
**Estado:** Diseño aprobado por secciones, pendiente revisión del documento consolidado
**Documento padre:** `2026-04-12-flujo-datos-vision-ideal.md`
**Próximo paso:** writing-plans para generar plan de implementación

---

## 1. Contexto y objetivo

El documento de visión establece que Quimibond Intelligence evoluciona hacia un **consejo ejecutivo de IA estilo Project Prometheus**: directores IA que leen toda la información histórica y operativa de la empresa, y entregan al CEO recomendaciones estratégicas prescriptivas con evidencia.

Para que ese consejo funcione, los datos que consumen los directores **tienen que ser completos y frescos**. Un director IA analizando cohortes sobre datos con huecos de 5% produce recomendaciones sistemáticamente sesgadas — es decir, pérdidas reales en P&L. Por eso, antes de construir cualquier feature del consejo, hay que establecer el piso de integridad.

**Objetivo de Fase 0:** Construir una capa de ingesta con integridad total, end-to-end, para todas las fuentes actuales (Odoo, Gmail), arquitectada desde el inicio para absorber nuevas fuentes (SAT, WhatsApp, bancos, competidores) sin reinventar plomería cada vez.

**No-objetivo:** No se entrega ninguna feature visible al CEO. `/dashboard`, briefings, insights, directores — nada de eso se toca. Fase 0 es **puro piso**. Su valor es habilitante: sin ella, las fases 1-4 construyen sobre arena.

## 2. Problemas concretos que Fase 0 resuelve

Evidencia: los últimos 30 commits de `qb19` son casi todos fixes de integridad, agrupables en seis patrones recurrentes:

1. **Pérdida silenciosa de rows en batches.** Si un chunk de 200 rows falla después de los reintentos, se loggea WARNING y sigue. `sync_log` reporta "success" aunque se perdieron datos. Solo se nota cuando el usuario ve un hueco en el frontend.
2. **Incremental por `write_date` tiene ventanas ciegas.** Reconciliaciones en Odoo, cambios de estado sin "tocar" campos, o backfills históricos dejan registros cuyo `write_date < last_sync` y nunca se re-sincronizan. Ciclos recurrentes: full-sync → incremental roto → full-sync otra vez.
3. **Sin dedup en 18 de 20 modelos.** Solo `invoices` deduplica. Retries de red o crons solapados producen duplicados en el resto.
4. **Conflict keys frágiles.** Varios modelos usan claves que admiten NULL (ej. `(partner_id, name)` en invoices). Si partner es NULL, el upsert falla silenciosamente.
5. **`activities` usa delete_all + insert.** Si el delete tiene éxito pero el insert falla, la tabla queda vacía hasta el siguiente sync exitoso.
6. **Schema drift invisible.** Nombres de columnas hardcodeados en Python; si una migración de Supabase no se aplicó, el push pega HTTP 400 y solo se ve en logs.

Fase 0 ataca directamente los problemas (1), (3), (4), (6), y la *detección* de (2), (5). La *prevención estructural* de (2) y (5) (triggers ORM, event-driven) queda para Fase 4.

## 3. Decisión arquitectónica

### 3.1 Enfoque híbrido pragmático ("opción C")

El núcleo compartido contiene **solo lo que es uniformemente útil a toda fuente de datos**:

- Registro estructurado de corridas de sync (qué se intentó, qué funcionó, qué falló).
- Tabla de failures individuales para retry dirigido.
- Job de reconciliación que compara conteos fuente↔Supabase.
- Registro de SLAs por tabla y su incumplimiento.
- Dashboard de salud unificado en `/system`.

**Lo que NO está en el núcleo:** la lógica de cómo cada fuente fetches sus datos. Odoo usa su ORM, Gmail usa su API REST, SAT (futuro) usará scraping, WhatsApp (futuro) usará webhooks. Cada adaptador mantiene su código específico porque son naturalmente distintos.

### 3.2 Ubicación: Supabase-native

El núcleo vive **dentro de Supabase** como:
- Un schema `ingestion` con 5 tablas.
- 7 RPCs en PL/pgSQL (el API que llaman los adaptadores).
- 1 función `pg_cron` horaria (el sentinel que vigila al vigilante).
- 3 vistas de salud que el frontend consume.

Razón de la decisión: el núcleo no hace lógica de negocio — solo cuenta, compara, registra, y alerta. Todas operaciones donde Postgres gana por goleada. Además, sobrevive incluso si el frontend, qb19, o Vercel están caídos. La capa de integridad tiene que ser más robusta que las capas que vigila.

## 4. Schema del núcleo

Schema Postgres: `ingestion`.

### 4.1 `ingestion.source_registry`
Catálogo de fuentes y sus tablas vigiladas. Tabla de configuración, se edita a mano al añadir una fuente.

| Campo | Tipo | Propósito |
|---|---|---|
| `source_id` | text | Primary key. `'odoo'`, `'gmail'`, `'sat'`, `'whatsapp'` |
| `table_name` | text | Primary key. Tabla destino en Supabase: `'odoo_invoices'`, `'emails'`, etc. |
| `entity_kind` | text | Descripción semántica: `'invoice'`, `'email'`, `'cfdi_xml'` |
| `sla_minutes` | int | SLA de frescura: 5, 60, 1440 |
| `priority` | text | `'critical'` / `'important'` / `'context'` |
| `owner_agent` | text | Qué director IA depende de esta tabla (`'finance'`, `'sales'`, ...) |
| `reconciliation_window_days` | int | Ventana móvil para reconciliar: 30 para críticas, 90 para contextuales, NULL para full-count |
| `is_active` | bool | Permite deshabilitar una tabla sin borrarla del registro |

Primary key: `(source_id, table_name)`.

### 4.2 `ingestion.sync_run`
Un registro por corrida de sync. Reemplaza el `sync_log` actual (string libre) con estructura parseable.

| Campo | Tipo | Propósito |
|---|---|---|
| `run_id` | uuid | Primary key |
| `source_id` | text | FK a `source_registry` |
| `table_name` | text | FK a `source_registry` |
| `run_type` | text | `'incremental'` / `'full'` / `'backfill'` / `'retry'` |
| `triggered_by` | text | `'cron'` / `'event'` / `'manual'` / `'reconciliation'` |
| `started_at` | timestamptz | |
| `ended_at` | timestamptz | NULL mientras `status='running'` |
| `status` | text | `'running'` / `'success'` / `'partial'` / `'failed'` |
| `rows_attempted` | int | Default 0, incrementa atómicamente |
| `rows_succeeded` | int | Default 0 |
| `rows_failed` | int | Default 0 |
| `rows_skipped` | int | Default 0 |
| `high_watermark` | text | El cursor al final de la corrida (ej. último `write_date` como ISO string) |
| `metadata` | jsonb | Extras específicos de la fuente (ej. `{"force_full": true}`) |

Índices: `(source_id, table_name, started_at DESC)` para queries de "última corrida".

### 4.3 `ingestion.sync_failure`
Un row por fila que falló. **Esta es la tabla que mata la pérdida silenciosa.**

| Campo | Tipo | Propósito |
|---|---|---|
| `failure_id` | uuid | Primary key |
| `run_id` | uuid | FK a `sync_run` |
| `source_id` | text | Denormalizado para queries rápidas |
| `table_name` | text | Denormalizado |
| `entity_id` | text | ID estable del objeto fuente (odoo_id, gmail message_id, CFDI UUID) |
| `error_code` | text | `'http_4xx'`, `'http_5xx'`, `'schema_mismatch'`, `'constraint_violation'`, `'fk_orphan'`, `'parse_error'`, `'reconciliation_missing'` |
| `error_detail` | text | Cuerpo completo del error, sin truncar |
| `payload_snapshot` | jsonb | El row que se iba a insertar |
| `retry_count` | int | Default 0 |
| `status` | text | `'pending'` / `'retrying'` / `'resolved'` / `'abandoned'` |
| `first_seen_at` | timestamptz | |
| `last_tried_at` | timestamptz | |
| `resolved_at` | timestamptz | NULL hasta resolverse |

Unique constraint: `(source_id, table_name, entity_id) WHERE status IN ('pending', 'retrying')`. Garantiza idempotencia — dos reportes del mismo failure actualizan en vez de duplicar.

Índices: `(source_id, table_name, status)`.

### 4.4 `ingestion.reconciliation_run`
Output del job nocturno de reconciliación. Una fila por tabla verificada.

| Campo | Tipo | Propósito |
|---|---|---|
| `reconciliation_id` | uuid | Primary key |
| `source_id` | text | |
| `table_name` | text | |
| `ran_at` | timestamptz | |
| `window_start` | timestamptz | |
| `window_end` | timestamptz | |
| `source_count` | int | Reportado por el adaptador |
| `supabase_count` | int | `SELECT count(*)` calculado dentro del RPC |
| `divergence` | int | `source_count - supabase_count` |
| `missing_entity_ids` | text[] | IDs faltantes en Supabase si el adaptador pudo listarlos |
| `status` | text | `'clean'` (divergence=0) / `'divergent_positive'` (faltan en Supabase) / `'divergent_negative'` (sobran en Supabase) / `'unknown'` |
| `auto_healed_count` | int | Cuántos failures inyectó automáticamente |

### 4.5 `ingestion.sla_breach`
Log de cuando una tabla viola su SLA de frescura o su SLA de reconciliación.

| Campo | Tipo | Propósito |
|---|---|---|
| `breach_id` | uuid | Primary key |
| `source_id` | text | |
| `table_name` | text | |
| `breach_type` | text | `'staleness'` / `'reconciliation_stale'` / `'failure_backlog'` |
| `detected_at` | timestamptz | |
| `sla_minutes` | int | El SLA que se violó |
| `actual_minutes` | int | Valor real medido |
| `resolved_at` | timestamptz | NULL mientras sigue abierto |

## 5. Contrato de RPCs (7 funciones)

Toda la superficie que los adaptadores conocen. Cualquier fuente sincroniza con integridad llamando solo estos 7 RPCs.

### 5.1 `ingestion_start_run(p_source text, p_table text, p_run_type text, p_triggered_by text) returns (run_id uuid, last_watermark text)`
Abre una corrida. Devuelve el nuevo `run_id` y el `high_watermark` de la última corrida exitosa para esa `(source, table)`, para que el adaptador sepa desde dónde leer.

### 5.2 `ingestion_report_batch(p_run_id uuid, p_attempted int, p_succeeded int, p_failed int) returns void`
Acumula contadores atómicamente. Se llama una vez por batch procesado.

### 5.3 `ingestion_report_failure(p_run_id uuid, p_entity_id text, p_error_code text, p_error_detail text, p_payload jsonb) returns uuid`
Registra una fila perdida individualmente. Se llama por cada row que falla, no por batch. Si ya existe un failure abierto para `(source, table, entity_id)`, actualiza `retry_count` y `last_tried_at` en lugar de duplicar (ON CONFLICT DO UPDATE). Devuelve el `failure_id`.

### 5.4 `ingestion_complete_run(p_run_id uuid, p_status text, p_high_watermark text) returns void`
Cierra la corrida. Set `ended_at=now()`, status, watermark. Si `status='partial'`, dispara un trigger que registra el hecho para que el Data Quality IA (fase futura) lo recoja.

### 5.5 `ingestion_report_source_count(p_source text, p_table text, p_window_start timestamptz, p_window_end timestamptz, p_source_count int, p_missing_entity_ids text[]) returns uuid`
El RPC de reconciliación. El adaptador reporta el conteo en la fuente; Postgres calcula el conteo en Supabase, computa la divergencia, persiste en `reconciliation_run`. Si `p_missing_entity_ids` no es NULL, inyecta automáticamente rows en `sync_failure` con `error_code='reconciliation_missing'` para que el retry los procese. Devuelve el `reconciliation_id`.

### 5.6 `ingestion_fetch_pending_failures(p_source text, p_table text, p_max_retries int, p_limit int) returns setof sync_failure`
Devuelve failures `status='pending'` con `retry_count < p_max_retries`, marcándolos `'retrying'` atómicamente (para que dos crons concurrentes no procesen el mismo row). El adaptador los procesa usando `payload_snapshot` (retry ciego) o re-fetching de la fuente (retry refrescado).

### 5.7 `ingestion_mark_failure_resolved(p_failure_id uuid) returns void`
Complemento de 5.6. Set `status='resolved'`, `resolved_at=now()`.

### Propiedades garantizadas

- **Atomicidad de contadores**: viven en un solo UPDATE.
- **Idempotencia de failures**: ON CONFLICT DO UPDATE en el unique key.
- **Visibilidad en tiempo real**: `sync_run` se lee durante la corrida, no al final.
- **Lenguaje-agnóstico**: cualquier cliente Postgres/REST puede llamar.
- **Cero servicios nuevos**: todo es SQL functions.

### Qué NO está en los RPCs (intencional)

- **No hay `ingestion_upsert_row()`**: el núcleo no hace el upsert por ti. El adaptador usa su mecanismo (qb19 usa PostgREST, Gmail usa supabase-js). El núcleo solo observa.
- **No hay lógica de negocio**: todo es genérico por `(source, table, entity_id)`.
- **No hay autenticación custom**: se usa RLS de Supabase; solo `service_role` puede llamar.

## 6. Reconciliación nocturna

### 6.1 Modelo de flujo

Cada adaptador corre un cron nocturno propio (Odoo 03:00, Gmail 03:15). Ese cron:
1. Ejecuta una query de conteo en su fuente para la ventana configurada en `source_registry.reconciliation_window_days`.
2. Lista los IDs en la fuente (si la fuente lo permite barato) y los compara contra IDs en Supabase.
3. Llama `ingestion_report_source_count` con el conteo y los IDs faltantes.

Dentro del RPC, Postgres:
1. Calcula `SELECT count(*)` del lado Supabase.
2. Inserta en `reconciliation_run` con la divergencia.
3. Si hay `missing_entity_ids`, inyecta automáticamente rows en `sync_failure` con `error_code='reconciliation_missing'`.
4. Marca `auto_healed_count` con cuántos inyectó.

El cron de retry (cada 30 minutos) procesa los failures inyectados y re-sincroniza las filas faltantes. El proceso es autónomo: reconciliación nocturna detecta → auto-heal inyecta failures → retry cron los procesa → al día siguiente la próxima reconciliación debe verlos resueltos.

### 6.2 Ventanas configurables

- **Críticas** (`invoices`, `payments`, `sale_orders`, `purchase_orders`): ventana móvil de 30 días.
- **Contextuales** (`products`, `employees`, `departments`): ventana móvil de 90 días.
- **Completas** (`contacts`, `companies`): full count, sin ventana (son baratas).

Se configura por fila en `source_registry.reconciliation_window_days`.

### 6.3 Auto-heal vs alerta

Regla: si es automático y seguro, se auto-reparla; si es ambiguo, se reporta.

- **`divergent_positive`** (faltan en Supabase, con IDs conocidos) → auto-heal: inyecta failures y deja que el retry los procese.
- **`divergent_negative`** (Supabase tiene MÁS rows que la fuente) → **NO auto-heal**. Puede ser un duplicado real, o una eliminación en Odoo que hay que propagar, o un bug. Se reporta al Data Quality IA (fase futura) para revisión.
- **`unknown`** (divergencia sin lista de IDs) → alerta, requiere próxima corrida con lista.

### 6.4 Sentinel: `check_missing_reconciliations()`

`pg_cron` horario dentro de Supabase, independiente de cualquier adaptador. Lee `source_registry` y verifica que cada `(source, table)` activo tenga una fila en `reconciliation_run` en las últimas 25 horas. Si falta: inserta un row en `sla_breach` con `breach_type='reconciliation_stale'`.

Esto resuelve el problema meta: "¿quién vigila al que vigila?". Si el cron de qb19 o Gmail no corre, pg_cron (que vive en Supabase, el servicio más estable del stack) lo detecta.

## 7. Migración incremental (plan afinado)

### 7.1 Principio: thin wrapper, cero reescritura

El código actual sigue funcionando sin cambios. El núcleo se añade como capa de observación. La validación en paralelo con el `sync_log` viejo dura **1 semana**. Después, el viejo se apaga.

### 7.2 Thin wrapper en qb19

Archivo nuevo: `addons/quimibond_intelligence/models/ingestion_core.py` (~150 líneas). Wrapper delgado sobre el cliente PostgREST/RPC existente con un método por cada uno de los 7 RPCs.

Cada `_push_*` en `sync_push.py` se envuelve:

```python
def _push_invoices(self, last_sync, force_full=False):
    run_id, wm = core.start_run('odoo', 'odoo_invoices',
        'full' if force_full else 'incremental', 'cron')
    try:
        invoices = self._fetch_invoices(wm or last_sync, force_full)
        any_failed = False
        for batch in chunks(invoices, 200):
            ok, failed_items = supabase.upsert_with_details(batch)
            core.report_batch(run_id, len(batch), ok, len(failed_items))
            for item, err in failed_items:
                core.report_failure(run_id, str(item['odoo_id']),
                    err.code, err.body, item)
                any_failed = True
        core.complete_run(run_id,
            'partial' if any_failed else 'success',
            high_watermark=max(inv.write_date for inv in invoices).isoformat())
    except Exception as e:
        core.complete_run(run_id, 'failed', high_watermark=wm)
        raise
```

Extensión requerida en `supabase_client.py`: el método `upsert()` actual solo devuelve un contador. Cambio a `upsert_with_details()` que devuelve `(ok_count, [(item, error), ...])` para que failures se reporten individualmente.

### 7.3 Thin wrapper en Gmail pipeline

Archivo nuevo: `src/lib/ingestion-core.ts` (~100 líneas). Wrapper sobre `supabase.rpc(...)`. El pipeline en `/api/pipeline/analyze` se envuelve con las mismas llamadas.

### 7.4 Orden de migración (secuencial, no paralelo)

**Semana 1 — Núcleo + Odoo (primeras tablas críticas)**
1. Crear schema `ingestion` con las 5 tablas, los 7 RPCs, y el sentinel pg_cron.
2. Implementar `IngestionCore` en qb19.
3. Migrar solo 2 tablas primero: `odoo_invoices` y `odoo_payments` (las más dolorosas y críticas para Cobranza/Finance).
4. Ejecutar en prod en paralelo con el `sync_log` viejo durante 3-5 días.
5. Validar sentinel + retry + reconciliación en ambas tablas.

**Semana 2 — Resto de Odoo**
6. Migrar las 18 tablas restantes de qb19 (una por commit, siguiendo el mismo patrón).
7. Activar el cron de reconciliación nocturna en qb19.
8. Validar números: `sync_run` nuevo vs `sync_log` viejo. Diferencias >1% se investigan.

**Semana 3 — Gmail + dashboard + apagado**
9. Implementar `IngestionCore` en el pipeline Gmail.
10. Migrar `emails` (la tabla más crítica del pipeline de comunicaciones).
11. Activar el cron de reconciliación Gmail.
12. Refactor de `/system` en el frontend para leer las vistas de salud nuevas.
13. Apagar `sync_log` viejo.

Total: 3 semanas. Sin traslapes entre fuentes — se valida Odoo completo antes de tocar Gmail.

### 7.5 Lo que NO se toca en Fase 0

- El mecanismo de `write_date` como incremental (sigue siendo reactivo; la reconciliación atrapa lo que se escapa).
- La lógica de dedup actual de invoices (se mantiene).
- Unique constraints existentes en Supabase (se añaden algunos nuevos, no se refactorizan).
- El frontend, excepto `/system`.
- Los agentes/directores IA.
- Las columnas `synced_at` existentes. NO se extienden a las 20 tablas — la staleness se deriva de `sync_run.ended_at` consultando la última corrida exitosa. Se diferirá a Fase 1 si resulta necesario.

### 7.6 Rollback

Cada paso es reversible:
- El núcleo solo añade tablas/RPCs, no modifica nada existente.
- La migración de qb19 es tabla-por-tabla; revertir un método es una línea.
- La semana de paralelismo es el seguro real. Si los números no cuadran, no apagamos el viejo.

## 8. Entregables

**Supabase:**
- Migración SQL creando schema `ingestion` con 5 tablas, FKs, índices, unique constraints.
- 7 RPCs en PL/pgSQL.
- Función pg_cron `check_missing_reconciliations()` corriendo cada hora.
- 3 vistas: `v_source_health`, `v_open_failures`, `v_sla_status`.

**qb19:**
- `models/ingestion_core.py` — wrapper RPC.
- Extensión `upsert_with_details()` en `supabase_client.py`.
- Wrappers en cada `_push_*` de `sync_push.py`.
- Cron de reconciliación nocturna en `data/ir_cron_data.xml` (3 AM).
- Cron de retry cada 30 min procesando `sync_failure` pendientes.

**quimibond-intelligence:**
- `src/lib/ingestion-core.ts` — wrapper RPC.
- Integración en `/api/pipeline/analyze`.
- Endpoint `/api/cron/reconcile-gmail` (Vercel cron, 3:15 AM).
- Endpoint `/api/cron/retry-gmail-failures` (Vercel cron, cada 30 min).
- Refactor de `/system` page consumiendo las vistas nuevas.

**Documentación:**
- `docs/ingestion-core.md` — contrato del núcleo + ejemplo de adaptador ficticio.
- Actualización de CLAUDE.md en ambos repos.

## 9. Criterios de aceptación

**Integridad:**
- Por cada row que falla al sincronizar, existe una fila en `ingestion.sync_failure` con `error_code`, `error_detail`, y `payload_snapshot`. Validación: forzar un error en un batch de test y verificar que el failure existe.
- `ingestion_report_failure` llamado dos veces con el mismo `(source, table, entity_id)` no duplica.
- Después de 7 días operando, la diferencia entre conteos de `reconciliation_run` es 0 para todas las tablas críticas, o las divergencias >0 están todas explicadas por auto-heal o flaggeadas como `divergent_negative`.

**Observabilidad:**
- `/system` muestra para cada tabla activa: última corrida, estado, contadores, staleness, SLA status (verde/amarillo/rojo).
- Los failures abiertos son visibles con botón "retry ahora".
- Si Odoo.sh cae por >2h, aparece en `/system` como rojo sin intervención manual (via SLA breach del sentinel).

**Escalabilidad:**
- Documentar y probar con un **adaptador ficticio** (script de 50 líneas simulando fuente SAT con datos dummy). Si reporta runs, failures, y reconciliación usando solo los 7 RPCs sin modificar el núcleo, el contrato está validado como extensible.
- Añadir una fuente nueva al `source_registry` no requiere migraciones de schema — solo INSERT.

**Paridad:**
- Durante la semana de paralelismo, los conteos del `sync_log` viejo y el `sync_run` nuevo son consistentes. Diferencias >1% se investigan antes de apagar el viejo.
- Ningún insight del frontend deja de funcionar.

## 10. Dashboard `/system` — salida visible

Tres secciones:

**A. Salud por fuente**
Para cada fuente en `source_registry`, una tarjeta por tabla con:
- Estado (● verde si staleness < SLA, ⚠ amarillo si entre SLA y 2×SLA, 🔴 rojo si > 2×SLA).
- Última corrida exitosa (timestamp relativo: "hace 3m").
- SLA configurado ("sla 5m").

**B. Failures abiertos**
Tabla con `source_id`, `table_name`, `entity_id`, `error_code`, `retry_count/max`, botón "retry ahora" que llama `fetch_pending_failures` con `limit=1` para ese row.

**C. Reconciliación última noche**
Fila por `(source, table)`, mostrando `source_count`, `supabase_count`, `divergence`, `status`, `auto_healed_count`.

## 11. Métricas de éxito

- **Antes:** ~2-3 commits/mes arreglando fixes de integridad.
- **Después (objetivo):** 0 commits/mes de "fix: rows perdidos". Los problemas siguen existiendo pero se detectan automáticamente y se auto-curan o alertan.
- **Antes:** tiempo para notar un problema = horas o días.
- **Después:** tiempo para notar = ≤1h (aparece en `/system` en rojo).
- **Antes:** reparar = buscar en logs, `force_full_sync` a ciegas.
- **Después:** reparar = retry automático del cron de failures, o botón "retry ahora" en `/system`.

## 12. Qué no sabemos todavía

**Reconciliación para fuentes donde contar es caro o imposible.** Para Odoo/Gmail un `SELECT COUNT` o `listMessages` es barato. Para SAT (scraping), contar "cuántas facturas hay hoy" puede requerir el listado completo. Si una fuente futura no puede reportar conteo confiable, el reconcile se vuelve "verificar una muestra aleatoria de IDs" en lugar de conteo total. El contrato admite esa variante (`source_count=NULL` + `missing_entity_ids=[muestreados]`), pero no está especificado aquí. Se afinará cuando aparezca la primera fuente con ese perfil. No bloquea Fase 0.

## 13. Qué habilita esta fase

Fase 0 no entrega ninguna feature visible al CEO, pero hace todas las siguientes posibles sobre un piso confiable:

- **Fase 1 (vistas analíticas)**: las cohortes son confiables porque los datos están completos.
- **Fase 2 (consejo IA estratégico)**: los directores pueden razonar sobre todo el histórico sin sesgos por huecos.
- **Fase 3 (coordinación entre directores)**: la delegación entre agentes no cascada datos malos.
- **Fase 4 (nuevas fuentes)**: cada adaptador nuevo es ~200 líneas en lugar de 2000.
