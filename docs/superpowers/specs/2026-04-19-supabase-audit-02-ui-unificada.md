# Fase 1 — UI Unificada

**Parent spec:** [00-master](./2026-04-19-supabase-audit-00-master.md)
**Duración:** 10–14 días
**Estado:** bloqueada por Fase 0

---

## 1. Objetivo

Eliminar el síntoma #1 del usuario ("no veo la realidad unificada"). Hacer que todo consumer del frontend lea de la capa unificada, no de raw Odoo ni raw Syntage.

## 2. Estado actual (inventario de inconsistencia)

### Consumers RAW identificados en `/Users/jj/quimibond-intelligence/`:

| Archivo | Tabla raw leída | Debería leer |
|---|---|---|
| `sales.ts` (líneas 70, 251, 261, 265, 270, 538, 608, 655, 702, 762) | `odoo_sale_orders`, `odoo_purchase_orders` | `invoices_unified` + `company_profile` |
| `companies.ts` (líneas 443–800) | `odoo_sale_orders`, `odoo_invoices`, `odoo_deliveries` | `company_profile` + `invoices_unified` |
| `customer-360.ts` (línea 108) | Solo `agent_insights` | `invoices_unified` + `payments_unified` + `agent_insights` |
| `director-chat-context.ts` | Mezcla `odoo_invoices` (219), `odoo_account_payments` (226), `odoo_purchase_orders` (261), `reconciliation_issues` | Unified + reconciliation, sin raw |
| `finance.ts` (99–122) | `getArAgingByCompany()` alterna legacy/unified vía flag | Solo unified |
| `invoices.ts` (56–90) | `legacyGetArAging()` + `unifiedGetArAging()` coexisten | Solo unified |

### MVs unified hoy

- `invoices_unified` — 247 MB, refresh */15. Cubre `odoo_invoices + syntage_invoices`.
- `payments_unified` — 31 MB, refresh */15. Cubre `odoo_payments + syntage_invoice_payments`.
- `company_profile` — 472 kB. No cubre todo lo necesario para reemplazar queries directas (falta aging breakdown, delivery OTD, SAT compliance score).

### Gap de data
- **3,482 CFDIs Quimibond en Odoo sin registro en Syntage** (18% del universo Odoo con CFDI). Origen: backfill Syntage incompleto para ciertos meses.
- **4 `issue_types` con 6,601 issues abiertos eternos** — no tienen lógica de auto-resolve.

## 3. Acciones

### 3.1 Extender `company_profile` a one-stop (3–4 días)

Añadir columnas/campos que hoy requieren cruces:
- `sale_orders_ytd` (count + monto) desde `odoo_sale_orders`
- `purchase_orders_ytd` desde `odoo_purchase_orders`
- `ar_aging_buckets` (jsonb: 0-30, 31-60, 61-90, 90+) desde `invoices_unified`
- `deliveries_otd_pct` (on-time delivery últimos 90d) desde `odoo_deliveries`
- `sat_compliance_score` (% CFDIs con match + % sin issues abiertos) desde `reconciliation_issues`
- `last_activity_at` (max de invoice/payment/delivery/activity)

Materializar o mantener como VIEW (decidir por performance — si p95 query >500ms, materializar con refresh cada 1h).

### 3.2 Implementar auto-resolve de 4 issue_types (2–3 días)

Para cada tipo, definir la lógica de cierre:

**`payment_missing_complemento`** (5,552 open): cierra cuando aparece un `syntage_invoice_payments` con `uuid_complemento` que referencia el UUID del invoice y paga el residual completo. Trigger en INSERT a `syntage_invoice_payments` llamando `resolve_payment_complemento()`.

**`complemento_missing_payment`** (933 open): cierra cuando aparece un `odoo_account_payments` vinculado al invoice (vía `odoo_payment_invoice_links`) por el monto del complemento. Trigger en INSERT a `odoo_payment_invoice_links`.

**`cancelled_but_posted`** (97 open): cierra cuando el CFDI en `syntage_invoices.estatus` pasa a `vigente` (reversión en SAT) o el `odoo_invoices.state` cambia a `cancel` (invoice cancelada en Odoo). Trigger en UPDATE de ambas tablas.

**`amount_mismatch`** (19 open): cierra cuando los montos reconcilian (diferencia <$0.01). Trigger en UPDATE de `odoo_invoices.amount_total` o `syntage_invoices.total`.

Todos los resolve actualizan `reconciliation_issues.resolved_at = now(), resolution_notes = 'auto: ...'`.

### 3.3 Backfill Syntage para gap de 3,482 CFDIs (2 días)

1. Identificar meses/períodos del gap: `SELECT date_trunc('month', invoice_date) AS month, COUNT(*) FROM odoo_invoices WHERE cfdi_uuid IS NOT NULL AND cfdi_uuid NOT IN (SELECT uuid FROM syntage_invoices) GROUP BY 1 ORDER BY 1;`
2. Disparar extracciones Syntage manuales para esos meses vía `/api/syntage/extract` (si existe) o UI Syntage.
3. Esperar procesamiento webhook; monitorear `syntage_webhook_events`.
4. Validar: gap <5% tras backfill.

### 3.4 Eliminar feature flag `USE_UNIFIED_LAYER` (1 día)

1. Buscar todas las ocurrencias: `grep -r "USE_UNIFIED_LAYER" quimibond-intelligence/`
2. Remover el condicional; dejar solo la rama unified.
3. Borrar funciones `legacy*` (legacyGetArAging, etc.).
4. Actualizar `.env.example` y documentación.

### 3.5 Migrar consumers archivo por archivo (4–5 días)

Orden sugerido (de más visible a menos):

1. **`invoices.ts` y `finance.ts`** — deuda crítica (AR aging es una pantalla principal). Reemplazar por `invoices_unified` + `ar_aging_detail` MV (ya existe).
2. **`sales.ts`** — usar `monthly_revenue_by_company` MV + `company_profile` extendido. Para detalle de órdenes específicas, usar `invoices_unified` filtrado por company.
3. **`companies.ts`** — reemplazar queries raw por `company_profile`. Cualquier campo faltante se agrega en 3.1.
4. **`customer-360.ts`** — añadir cruces a `invoices_unified` y `payments_unified` para ver facturas abiertas + pagos recientes, no solo insights.
5. **`director-chat-context.ts`** — quitar `odoo_invoices`, `odoo_account_payments`, `odoo_purchase_orders` raw; usar unified. Este archivo alimenta contexto para Claude → el impacto en calidad de insights se mide.

Cada migración: abrir PR individual, revisar diff de queries, correr suite de tests (si existe), deploy a preview Vercel, validar manualmente 3–5 páginas principales.

### 3.6 Test de regresión

Antes de cerrar la fase, validar:
- Dashboard de clientes muestra facturas SAT + Odoo en misma tabla
- `/customer/[id]` página muestra AR aging coherente con `/dashboard/ar`
- Director chat referencia facturas unificadas (no menciona "en Odoo veo X pero en SAT veo Y")

## 4. DoD

1. `company_profile` extendido y consumido por `companies.ts`, `customer-360.ts`
2. 4 `issue_types` con auto-resolve funcionando (verificar que `resolved_at` se escribe en nuevos issues de esos tipos)
3. Backfill Syntage cerrado; gap <5%
4. `USE_UNIFIED_LAYER` eliminado del codebase
5. 0 `supabase.from("odoo_invoices")`, `supabase.from("odoo_payments")`, `supabase.from("odoo_account_payments")` en `/app/**` y `/lib/**` (excepto `/lib/admin/**` y `/lib/debug/**`)
6. Test manual de 5 páginas principales confirma consistencia SAT+Odoo

## 5. Riesgos

| Riesgo | Mitigación |
|---|---|
| Migrar queries rompe dashboards en prod | PR individual + preview deploy para cada archivo |
| `company_profile` extendido lento (>500ms) | Materializar con refresh cada 1h |
| Auto-resolve marca issues legítimos como cerrados | Sombra de 48h: primero anotar `resolution_notes = 'would auto-close'` sin cerrar; revisar casos antes de activar |
| Backfill Syntage excede quota API | Ejecutar en lotes de 500 CFDIs con backoff |

## 6. Out of scope

- Rediseño visual de páginas (solo data fetching)
- Eliminar raw Odoo del addon sync — la capa raw sigue existiendo como fuente; solo bloqueamos lectura desde frontend
- Syntage↔Odoo matching >95% (se queda como target de Fase 2/Fase 4 si requiere más backfill)
