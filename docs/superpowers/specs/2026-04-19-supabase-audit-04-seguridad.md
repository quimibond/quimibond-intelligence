# Fase 3 — Seguridad

**Parent spec:** [00-master](./2026-04-19-supabase-audit-00-master.md)
**Duración:** 10–14 días
**Estado:** bloqueada por Fase 2

---

## 1. Objetivo

Cerrar el agujero: las 66 policies RLS son `qual=true` → cualquier cliente con `anon_key` puede leer datos fiscales, bancarios, RFCs, nómina, balances. Esto es riesgo de compliance + exfiltración. Al cerrar Fase 3, el lint de Supabase debe tener **0 ERRORs**.

## 2. Estado actual (baseline)

Del `mcp__supabase__get_advisors(security)`:

| Lint | Level | Count |
|---|---|---:|
| `security_definer_view` | ERROR | 85 |
| `rls_disabled_in_public` | ERROR | 9 |
| `rls_policy_always_true` | WARN | 56 |
| `function_search_path_mutable` | WARN | 43 |
| `materialized_view_in_api` | WARN | 33 |
| `rls_enabled_no_policy` | INFO | 15 |
| `extension_in_public` | WARN | 2 |

**Total ERRORs:** 94. **Total WARNs:** 134.

## 3. Acciones

### 3.1 Setup: branch de Supabase

Antes de empezar, crear un **database branch** de Supabase (`mcp__supabase__create_branch`) para testear políticas sin romper prod. Todas las DDL de seguridad se prueban en branch, se confirman, y se aplican a prod con `merge_branch`.

### 3.2 Reemplazar las 66 policies `qual=true`

**Modelo de access:**
- Toda la data de negocio (facturas, pagos, contacts, companies, insights) → requiere `authenticated` (JWT válido emitido por Supabase Auth).
- Writes desde frontend (INSERT/UPDATE/DELETE) → **nunca con `anon_key`**; el frontend usa API routes server-side que hablan con `service_role_key`.
- Tablas internas (logs, audit, schema_changes) → solo `service_role`.

**Template de policies:**

```sql
-- Para tablas de data de negocio
ALTER TABLE public.<table> DISABLE ROW LEVEL SECURITY;  -- reset
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "<old_policy_name>" ON public.<table>;

CREATE POLICY "authenticated_read" ON public.<table>
  FOR SELECT TO authenticated
  USING (true);  -- tenant-single; si un día hay multi-tenant, filtrar por org_id

CREATE POLICY "service_role_write" ON public.<table>
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- anon queda sin acceso
```

**Tablas a tratar** (66 total, agrupadas):
- **Data fiscal/finanzas** (~20): `odoo_invoices`, `odoo_invoice_lines`, `odoo_payments`, `odoo_account_payments`, `odoo_account_balances`, `odoo_bank_balances`, `odoo_chart_of_accounts`, `syntage_*` (10), `reconciliation_issues`, `invoices_unified`, `payments_unified`, `budgets` → `authenticated` SELECT, `service_role` ALL.
- **Operaciones** (~15): `odoo_products`, `odoo_deliveries`, `odoo_sale_orders`, `odoo_purchase_orders`, `odoo_activities`, `odoo_manufacturing`, `odoo_orderpoints`, `odoo_uoms`, `mrp_boms`, `mrp_bom_lines` → `authenticated` SELECT, `service_role` ALL.
- **People** (~5): `contacts`, `companies`, `odoo_employees`, `odoo_departments`, `odoo_users` → `authenticated` SELECT, `service_role` ALL.
- **Comunicación** (~5): `emails`, `threads`, `notification_queue`, `agent_tickets`, `chat_memory` → `authenticated` SELECT (con posible filtro por `user_id` para emails privados), `service_role` ALL.
- **AI / intelligence** (~10): `ai_agents`, `agent_runs`, `agent_insights`, `agent_memory`, `insight_follow_ups`, `insight_routing`, `action_items`, `briefings`, `director_analysis_*` → `authenticated` SELECT/UPDATE (si el usuario acciona insights), `service_role` ALL.
- **Knowledge graph** (~3): `entities`, `facts`, `entity_relationships` → `authenticated` SELECT, `service_role` ALL.
- **Sistema/audit** (~8): `schema_changes`, `pipeline_logs`, `audit_runs`, `audit_tolerances`, `sync_state`, `sync_commands`, `token_usage`, `data_sources`, `odoo_schema_catalog`, `odoo_snapshots`, `health_scores`, `revenue_metrics`, `employee_metrics` → **solo `service_role`** (no exponer a `authenticated`).

**Caso especial: `sync_commands`** — ya tiene policy correcta (`with_check (status='pending')` para `anon_insert_commands`). Mantener.

### 3.3 Habilitar RLS en 9 tablas sin RLS

Candidatas (del inventario, `rls_enabled=false`):
- `odoo_currency_rates`
- `mrp_boms`, `mrp_bom_lines`
- `odoo_uoms`
- `cashflow_journal_classification`
- `unified_refresh_queue`
- `reconciliation_summary_daily`
- `agent_insights_archive_pre_fase6` (si no se dropeó en Fase 2)
- `audit_runs`, `audit_tolerances` (también sin RLS)

Aplicar el mismo template que 3.2.

### 3.4 Cambiar 85 `security_definer_view` a invoker

Para cada view listada:
1. Revisar si necesita `DEFINER` (raro — solo si hace queries privilegiadas que el usuario no podría hacer directamente).
2. Default: cambiar a `security_invoker=true`:
   ```sql
   ALTER VIEW public.<view> SET (security_invoker = true);
   ```
3. Re-probar que la view sigue funcionando desde el frontend con `authenticated`.

Si alguna view realmente requiere `DEFINER`: documentar la razón en un comment SQL (`COMMENT ON VIEW ... IS 'security_definer justified: ...'`) y dejarla.

### 3.5 Fijar `search_path` en 43 funciones

Para cada función con `search_path` mutable (el lint dará la lista):
```sql
ALTER FUNCTION public.<fn>(<args>) SET search_path = public, pg_temp;
```

Batch por proname; script automatizado.

### 3.6 Mover extensions de `public` a `extensions`

Extensions afectadas: `pg_trgm`, `vector` (pgvector).

**Procedimiento** (requiere cuidado — rompe queries que referencian tipos `vector`, operadores, etc.):
1. Crear schema `extensions` si no existe.
2. Identificar uso: `SELECT * FROM pg_depend WHERE refobjid = 'extensions.vector'::regclass OR refobjid = 'extensions.pg_trgm'::regclass;` (ajustar al schema actual).
3. Descomponer: Supabase tiene una forma de mover extensions vía `ALTER EXTENSION ... SET SCHEMA extensions;` — **pero puede fallar si hay objects dependientes**.
4. Si falla: recrear los objects dependientes (views con `vector` columns, índices GIN trigram) después del move.
5. Plan B: dejar en `public` y documentar la excepción (muchos proyectos Supabase lo dejan; el lint es WARN, no ERROR).

**Decisión recomendada:** dejar en `public` si el costo de movimiento es alto; documentar como WARN aceptada.

### 3.7 Auditoría de uso de keys en frontend

Buscar en `/Users/jj/quimibond-intelligence/`:
1. `grep -r "SUPABASE_SERVICE_ROLE_KEY" app/ components/ lib/` — si aparece en código cliente (fuera de `/api/` o `/lib/server/`), es leak crítico.
2. `grep -r "supabase.from" app/page.tsx pages/ components/` — cualquier query de write desde cliente debe migrarse a API route.
3. Verificar que el `.env.local` tiene separados `NEXT_PUBLIC_SUPABASE_ANON_KEY` vs `SUPABASE_SERVICE_ROLE_KEY`.

### 3.8 Revocar API REST a materialized views internas

Las 33 MVs expuestas por defecto a `anon`/`authenticated`:
```sql
REVOKE ALL ON MATERIALIZED VIEW <mv> FROM anon, authenticated;
GRANT SELECT ON MATERIALIZED VIEW <mv> TO service_role;
```

Excepciones (MVs que el frontend SÍ consume directo — lista de inventario Fase 0):
- `invoices_unified`, `payments_unified`, `company_profile`, `customer_ltv_health`, `payment_predictions`, `inventory_velocity`, `product_margin_analysis`, `dead_stock_analysis`, `product_real_cost`, `bom_duplicate_components`, `customer_cohorts`, `rfm_segments`, etc.

Para las consumidas: mantener `GRANT SELECT TO authenticated` con RLS policy (si aplica sobre MVs — revisar si Supabase soporta RLS en MVs; si no, el grant SELECT es el único gate).

### 3.9 Rerun del lint al final

```
mcp__supabase__get_advisors(security)
```
Debe retornar 0 ERRORs. WARNs residuales documentadas con justificación.

## 4. DoD

1. 0 ERRORs en `get_advisors(security)`
2. <15 WARNs, todas documentadas con razón en comment SQL o `schema_changes`
3. Cambios aplicados vía branch merge (no DDL directo a prod)
4. Suite de tests de frontend verde (build + smoke)
5. Manual test: login con `anon` key prueba confirma que `odoo_invoices`, `odoo_account_payments`, `odoo_bank_balances` devuelven 0 rows (antes del login) y datos reales después
6. Service role key no aparece en bundle cliente (verificar con Next.js `next build` + inspección)

## 5. Riesgos

| Riesgo | Mitigación |
|---|---|
| Policies nuevas rompen queries existentes | Branch + smoke test exhaustivo antes de merge |
| `security_invoker` cambia permisos efectivos | Cada view se prueba como `authenticated` antes de merge |
| `search_path` fijo rompe funciones que usan types/fns de otros schemas | Incluir `public, pg_temp, extensions` si es necesario; probar en branch |
| Revoke de MVs rompe dashboards | Lista de "MVs que el frontend consume" debe ser exacta (output de Fase 0 consumer mapping) |
| RLS en tablas de emails podría requerir filtro por `user_id` | Fase 3 deja policy permisiva tenant-single; multi-tenant es fuera de scope |

## 6. Out of scope

- Multi-tenant RLS (si un día Quimibond agrega otra empresa, eso es un proyecto aparte)
- Auditoría de SSO / providers de Auth
- Rotar service_role key (se queda como tarea operativa del usuario)
