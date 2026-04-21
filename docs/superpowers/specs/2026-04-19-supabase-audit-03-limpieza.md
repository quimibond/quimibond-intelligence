# Fase 2 — Limpieza

**Parent spec:** [00-master](./2026-04-19-supabase-audit-00-master.md)
**Duración:** 5–7 días
**Estado:** bloqueada por Fase 1

---

## 1. Objetivo

Eliminar basura estructural: tablas muertas, funciones duplicadas, triggers redundantes, writers con bug de `on_conflict`. Dejar el schema coherente para que Fase 3 (seguridad) y Fase 4 (perf) trabajen sobre menos superficie.

## 2. Acciones

### 2.1 Drop de tablas confirmadas muertas

| Tabla | Rows | Evidencia de muerte | Verificar antes de DROP |
|---|---:|---|---|
| `budgets` | 0 | Vista `analytics_budget_vs_actual` depende, pero budgets nunca se llenó | Si `analytics_budget_vs_actual` es consumida, migrar a fuente alterna o mantener la tabla como contrato |
| `chat_memory` | 0 | Commit en código pero vacía | `grep -r "chat_memory" quimibond-intelligence/` — si writer existe, no borrar |
| `revenue_metrics` | 0 | `DEPRECATED` en comment | Función `populate_revenue_metrics` la llena — decidir si se activa o se dropea fn |
| `employee_metrics` | 0 | `DEPRECATED` en comment | Función `calculate_employee_metrics` la llena — mismo caso |
| `agent_insights_archive_pre_fase6` | 529 | Archivo histórico | Confirmar con user: ¿conservar en storage? Exportar a CSV antes de drop |

**Procedimiento para cada drop:**
```sql
-- 1. Dependencias
SELECT * FROM dependents_of('public.<tabla>');
-- 2. Export (si aplica)
COPY (SELECT * FROM <tabla>) TO '/tmp/<tabla>_backup.csv' CSV HEADER;
-- 3. DROP CASCADE solo si 0 dependencias, o DROP después de limpiar deps
DROP TABLE public.<tabla>;
-- 4. Log
INSERT INTO schema_changes (...)
```

### 2.2 Consolidar funciones con firma duplicada

Funciones con 2 firmas (4 detectadas):
- `match_emails_to_companies_by_domain`
- `match_emails_to_contacts_by_email`
- `get_contact_health_history`
- `get_volume_trend`

**Procedimiento:**
1. Para cada función, listar las 2 firmas: `SELECT pg_get_function_identity_arguments(oid), pg_get_functiondef(oid) FROM pg_proc WHERE proname='<fn>';`
2. Identificar cuál se llama desde qué callsite (`grep -r "<fn>(" /Users/jj/`).
3. Escoger la firma canónica (la más usada, o la que tiene los parámetros más explícitos).
4. Si un callsite usa la firma "perdedora", actualizarlo.
5. `DROP FUNCTION <fn>(<args_perdedora>);`

### 2.3 Consolidar triggers redundantes

**`odoo_invoice_lines`** — hoy 6 triggers:
- `trg_auto_link_invoice_line_company` (INS+UPD)
- `trg_link_invoice_line_company` (INS+UPD)
- `trg_resolve_invoice_line_company` (INS+UPD)
- `trg_touch_synced_at` (UPD)

Los 3 primeros probablemente hacen lo mismo con funciones distintas (iteraciones del mismo problema). Consolidar:
1. Leer las 3 funciones; identificar la lógica canónica.
2. Crear función única `fn_resolve_invoice_line_company_v2` que combine lo correcto.
3. `DROP TRIGGER` de los 3 viejos; crear 1 solo trigger con la función nueva.
4. `DROP FUNCTION` de las 3 viejas tras confirmar 0 referencias.

**`odoo_order_lines`** — mismo patrón: `resolve_order_company` + `resolve_order_line_company` INS+UPD. Consolidar.

**`odoo_products`, `odoo_bank_balances`, `odoo_users`** — tienen `trg_set_updated_at` Y `trg_touch_updated_at`. Ambas funciones hacen `NEW.updated_at := now()`. Borrar una (escoger la que menos uso tenga en otras tablas).

### 2.4 Añadir `on_conflict` a writers de knowledge graph

**Writers sin `on_conflict`:**
- `entities` (escrito desde `/api/pipeline/analyze`)
- `facts`
- `entity_relationships`

**Decisión:**
- `entities`: llave natural es `(entity_type, canonical_name)`. Añadir `UNIQUE` constraint + `onConflict` en el upsert.
- `facts`: llave natural es `(entity_id, fact_text_hash)` o `(entity_id, fact_type, source_email_id)`. Decidir según lógica del pipeline.
- `entity_relationships`: llave natural es `(source_entity_id, target_entity_id, relationship_type)`.

Plan:
1. Crear UNIQUE constraints.
2. Antes de crearlas, deduplicar las tablas (probablemente tienen duplicados hoy): `DELETE FROM entities WHERE id NOT IN (SELECT MIN(id) FROM entities GROUP BY entity_type, canonical_name);`
3. Actualizar el código frontend: `supabase.from("entities").upsert(x, { onConflict: "entity_type,canonical_name" })`.
4. Verificar que el pipeline no rompe (correr /api/pipeline/analyze en preview).

### 2.5 Resolver coexistencia `odoo_payments` vs `odoo_account_payments`

**Hoy:**
- `odoo_payments` (26,839 rows) — "LEGACY proxy: derived from invoice residual" según comment.
- `odoo_account_payments` (17,853 rows) — "Real payments from Odoo account.payment. Preferred."
- 11 consumers del frontend todavía leen `odoo_payments`.

**Decisión:**
- Migrar los 11 consumers a `odoo_account_payments` (en Fase 1 ya debiéramos haberlo tocado vía unified; verificar aquí que 0 quedaron).
- Si `odoo_payments` tiene columnas que no están en `odoo_account_payments` (`payment_category`, dates corregidas), crear VIEW `payments_legacy_compat` que expone esos campos sobre la nueva tabla.
- Deprecar el `_push_payments` del addon (dejar `_push_account_payments` como único).
- DROP `odoo_payments` al final de la fase.

### 2.6 Revisar 24 tablas sin consumer frontend

Lista: `schema_changes`, `data_sources`, `director_analysis_*` (2), `audit_runs`, `audit_tolerances`, `insight_routing`, `insight_follow_ups`, `notification_queue`, `unified_refresh_queue`, `email_cfdi_links`, `cashflow_journal_classification`, `token_usage`, `ai_agents`, `odoo_schema_catalog`, `odoo_payment_invoice_links`, `pipeline_logs`, `mrp_manufacturing`, etc.

Muchas son **sistema** (writers internos, crons, audits) y NO deben dropearse. Para cada una:

1. ¿La escribe alguna función/cron/trigger? → mantener.
2. ¿La consume alguna view/MV/función? → mantener.
3. ¿Está solo en el inventario pero no la escribe ni consume nadie? → candidato a drop.

Candidates probables (verificar individualmente): ninguno obvio después del análisis, la mayoría son infra legítima. **Out of scope de Fase 2 si la lista está vacía tras verificación**; documentar en el spec el resultado.

### 2.7 Fix del duplicado `cfdi_uuid` en el push del addon

Fase 0 dedupeó lo existente y añadió `UNIQUE INDEX`. Aquí cerramos la causa raíz:

1. Revisar `_push_invoices` en `/Users/jj/addons/quimibond_intelligence/models/sync_push.py`.
2. Verificar llave de upsert: ¿usa `odoo_move_id`? ¿`cfdi_uuid`? Si usa solo `odoo_move_id`, un mismo CFDI con dos `move_id` distintos insertaría duplicado.
3. Cambiar a upsert por `cfdi_uuid` cuando esté disponible, fallback a `odoo_move_id`.

## 3. DoD

1. 5 tablas muertas confirmadas y dropeadas (o marcadas como "conservar por razón X")
2. 4 funciones sin firma duplicada
3. `odoo_invoice_lines` con ≤2 triggers; `odoo_order_lines` con ≤2 triggers; `odoo_products`/`bank_balances`/`users` con 1 solo trigger de updated_at
4. `entities`, `facts`, `entity_relationships` con UNIQUE constraint y upserts con `onConflict`
5. 0 consumers de `odoo_payments` en frontend; tabla dropeada o marcada DEPRECATED definitivo
6. Push del addon arreglado; `UNIQUE INDEX` del `cfdi_uuid` sin violaciones
7. Lista final de tablas legítimas documentada (resultado de 2.6)

## 4. Riesgos

| Riesgo | Mitigación |
|---|---|
| DROP de tabla usada por MV/view escondida | `dependents_of()` + `pg_depend` check obligatorio |
| Cambio de trigger rompe sync en vivo | Aplicar en branch Supabase o en ventana de mantenimiento corto |
| Dedup de `entities`/`facts` borra data real | Archivar antes de DELETE (pattern de Fase 0) |
| UNIQUE constraint falla al crearse por duplicados | Deduplicar primero, después crear constraint |

## 5. Out of scope

- Optimización de triggers (eso es Fase 4)
- Redesign de `pipeline_logs` (se queda como está)
- Migrar addon para escribir en tablas nuevas (solo fix del duplicado)
