# Fase 2.5 — Unificación de entidades y puente operativo↔fiscal

**Fecha:** 2026-04-20
**Proyecto Supabase:** `tozqezmivpblmcubmnpi`
**Dueño:** @jose.mizrahi
**Plan maestro:** [2026-04-19-supabase-audit-00-master.md](./2026-04-19-supabase-audit-00-master.md)
**Plan de implementación:** [../plans/2026-04-20-supabase-audit-fase-2-5-unificacion.md](../plans/2026-04-20-supabase-audit-fase-2-5-unificacion.md)

---

## 1. Objetivo

Eliminar redundancias remanentes en el schema post-Fase 2 y construir un **puente explícito y consultable** entre la capa operativa (Odoo) y la capa fiscal (Syntage/SAT), para que la sincronización op↔fiscal deje de ser un comportamiento emergente de MVs acoplados y se convierta en un contrato de datos trazable y reparable manualmente cuando falle.

La queja del usuario ("quiero que la sync operativa↔fiscal sea muy fácil") exige tres cosas:
1. Una fuente de verdad por cada entidad (productos, facturas, pagos, órdenes, personas, empresas, precios).
2. Una vista `invoice_bridge` que muestre la triplet `(odoo_invoice, syntage_invoice, match_confidence)` y permita diagnosticar los gaps.
3. Un UX (función + view) para reconciliar manualmente los casos exóticos que el matching automático no resuelve.

Esta fase **no reemplaza** el bridge ya construido en Fase 1 (`invoices_unified`, `payments_unified`, `company_profile`, `company_profile_sat`). Lo completa cubriendo productos y órdenes, formaliza el protocolo de matching, y podda views redundantes.

---

## 2. Inventario actual (verificado 2026-04-20)

### 2.1 Materialized views (36)

| MV | Rows | Size | Refreshed by |
|---|---:|---:|---|
| `invoices_unified` | 96,500 | 257 MB | cron `refresh-syntage-unified` (*/15 min) |
| `payments_unified` | 41,255 | 32 MB | cron `refresh-syntage-unified` (*/15 min) |
| `company_profile` | 2,189 | 1.3 MB | `refresh_all_matviews` (15 min of even hours) |
| `company_profile_sat` | 2,189 | 360 kB | `refresh_all_matviews` |
| `monthly_revenue_by_company` | 7,361 | 1.0 MB | `refresh_all_matviews` |
| `product_real_cost` | 1,837 | 568 kB | `refresh_all_matviews` |
| `real_sale_price` | 253 | 96 kB | `refresh_all_matviews` |
| `product_margin_analysis` | 3,344 | 1.2 MB | `refresh_all_matviews` |
| `customer_margin_analysis` | 840 | 224 kB | `refresh_all_matviews` |
| `customer_ltv_health` | 1,650 | 336 kB | `refresh_all_matviews` |
| `customer_product_matrix` | 3,342 | 560 kB | `refresh_all_matviews` |
| `supplier_product_matrix` | 3,702 | 616 kB | `refresh_all_matviews` |
| `supplier_price_index` | 3,929 | 1.3 MB | `refresh_all_matviews` |
| `supplier_concentration_herfindahl` | 1,474 | 296 kB | `refresh_all_matviews` |
| (25 más — ver query abajo) | | | |

Total: 36 MVs en `public`.

### 2.2 Tablas operativas (Odoo) — 26 principales

| Tabla | Rows | Columnas clave |
|---|---:|---|
| `odoo_invoices` | 27,760 | `cfdi_uuid`, `amount_total_mxn`, `move_type` |
| `odoo_invoice_lines` | 71,334 | `odoo_product_id`, `product_ref`, `price_subtotal_mxn` |
| `odoo_sale_orders` | 12,353 | `salesperson_user_id`, `amount_total` |
| `odoo_purchase_orders` | 5,669 | `buyer_user_id`, `amount_total` |
| `odoo_order_lines` | 32,058 | `order_type` (sale/purchase), `product_ref` |
| `odoo_account_payments` | 17,856 | `is_reconciled`, `amount_signed` |
| `odoo_products` | 7,210 | `internal_ref`, `standard_price`, `list_price` |
| `odoo_payment_invoice_links` | 14,005 | bridge pago→factura |
| `odoo_deliveries` | 25,170 | `state`, `date_done` |
| `odoo_manufacturing` | 4,670 | |
| `companies` | 2,193 | `rfc`, `odoo_partner_id`, `entity_id` |
| `contacts` | 1,894 | `email`, `entity_id` |
| `odoo_users` | 40 | `email`, `odoo_user_id` |
| `odoo_employees` | 164 | `work_email`, `odoo_user_id` |
| `entities` | 9,351 | `entity_type`, `odoo_model`, `odoo_id` |

### 2.3 Tablas fiscales (Syntage) — 8 principales

| Tabla | Rows | Columnas clave |
|---|---:|---|
| `syntage_invoices` | 129,690 | `uuid`, `direction`, `fecha_timbrado`, `estado_sat`, `total_mxn` |
| `syntage_invoice_line_items` | 166,723 | `invoice_uuid`, `clave_prod_serv`, `descripcion`, `valor_unitario` |
| `syntage_invoice_payments` | 25,508 | `uuid_complemento`, `doctos_relacionados` (jsonb) |
| `syntage_files` | 21,825 | XMLs/PDFs descargados |
| `syntage_webhook_events` | 61,671 | auditoría |
| `syntage_electronic_accounting` | 35 | catálogo/balanza/pólizas |
| `syntage_tax_returns` | 285 | declaraciones |
| `syntage_tax_status` | 1 | opinión cumplimiento SAT |

### 2.4 Puentes existentes

- **UUID fiscal:** `odoo_invoices.cfdi_uuid` ↔ `syntage_invoices.uuid` (13,985 Odoo con UUID / 10,553 match; **Fase 2 archivó 5,321 duplicados y añadió UNIQUE index**).
- **RFC:** `companies.rfc` ↔ `syntage_invoices.emisor_rfc/receptor_rfc` (usado en `company_profile_sat`). Fase 1.6 arregló caso XEXX010101000 / XAXX010101000 con fuzzy match por nombre.
- **MV:** `invoices_unified` (Odoo ∪ Syntage) con `canonical_id = COALESCE(uuid_sat, 'odoo:' || odoo_invoice_id)`.
- **MV:** `payments_unified` (Odoo ∪ Syntage) por `num_operacion + composite`.
- **Tabla:** `reconciliation_issues` (80,165 rows; 44,629 abiertos) con 8 tipos de issue, 4 con auto-resolve live (Fase 1).
- **cfdi_documents** → **eliminada** (reemplazada por `email_cfdi_links` en Fase 5 Syntage).

### 2.5 pg_cron activos

```
jobid 1  | hourly   | ingestion.check_missing_reconciliations()
jobid 2  | 15 */2 * * * | refresh_all_matviews() (34 MVs, no incluye invoices_unified/payments_unified)
jobid 3  | */15     | refresh_invoices_unified() + refresh_payments_unified()
jobid 5  | 06:15    | reconciliation_summary_daily snapshot
jobid 6  | 03:30    | audit_runs cleanup (>90d)
```

---

## 3. Redundancias detectadas (por entidad)

### 3.1 Productos / SKUs

**Estado actual:**
- `odoo_products` (7,210 rows) es la única fuente operativa. `internal_ref` (default_code Odoo, 5,997 distintos) = SKU canónico.
- `syntage_invoice_line_items` (166,723 rows) tiene `descripcion` libre + `clave_prod_serv` (código SAT, 2,066 distintos). Ningún FK a `odoo_products`.
- `odoo_invoice_lines.odoo_product_id` puebla 69,542 de 71,334 (97.5%); `product_ref` llena 100% (71,334) vía sync.
- **No existe `products_unified`** ni tabla de mapping SKU fiscal→operativo.

**Evidencia de overlap viable:**
- Query heurística `descripcion ILIKE '%' || internal_ref || '%'` da 181,050/181,059 matches — **ruido** por refs cortas (1-2 chars). Sin sanity guard (longitud mínima, prefix anchor) el heurístico no sirve.
- 32% de syntage_invoice_line_items (pagos recibidos de proveedores) NUNCA tendrán match — son productos de terceros.

**Redundancia real:** baja. Son complementarias, no duplicadas. El problema es la **falta de puente**, no la duplicación.

**Propuesta target:**
- **`products_fiscal_map`** (tabla manual, no MV): `(odoo_product_id, sat_clave_prod_serv, description_pattern, created_by, confidence)`. Permite resolver reportes SAT por producto propio.
- **`products_unified`** (view, NO MV): join opcional de `odoo_products` + agregación de `syntage_invoice_line_items` filtrado por `emisor_rfc = PNT920218IW5` (Quimibond emite) + heurístico de matching con guard `length(internal_ref) >= 4`. Solo 1,653 productos de Quimibond se facturan.

**Riesgo si no se unifica:** medio. Los directores IA (Finance, Compliance) no pueden responder "¿qué producto fiscal corresponde a cuál SKU?" — hoy solo ven descripciones libres.

---

### 3.2 Facturas / Notas de crédito

**Estado actual:**
- `odoo_invoices` (27,760 rows; 13,985 con cfdi_uuid; 14,930 posted out_invoice)
- `syntage_invoices` (129,690 rows; 81,079 issued; 48,611 received)
- `invoices_unified` MV (96,500 rows) — **live**, refreshed cada 15min
- `cfdi_documents` — **eliminada** (confirmado: cero rows en catálogo `pg_class`)
- `cfdi_invoice_match` view — **eliminada**

**Cobertura actual del bridge:**
- Odoo con UUID: 13,985 / 27,760 = **50.4%** (muchas facturas pre-2021 sin CFDI)
- Odoo con UUID que matchean en Syntage: 10,553 / 13,985 = **75.5%**
- Syntage emitidos post-2021 sin match en Odoo: **42,539** (gap real)
- Syntage emitidos pre-2021 (histórico pre-Odoo): 52,573 (expected gap)
- Odoo post-2021 sin UUID: 5,251 (anomalía — post-2021 todas deberían tener UUID)

**Complementos de pago P:** `syntage_invoice_payments` (25,508 rows) con `doctos_relacionados` jsonb y `uuid_complemento`. Expandidos en view `payment_allocations_unified`. Bridge operativo: `odoo_payment_invoice_links` (14,005 rows).

**Gaps detectados:**
- 5,251 Odoo post-2021 sin UUID — no se timbran o no se sincronizan. **Bug**.
- 42,539 Syntage emitidos post-2021 sin match — probablemente falta backfill Syntage parcial (Fase 1.6 empezó pero quedó gap).
- 8,334 Odoo in_invoice sin UUID — muchos proveedores no emiten XML a Quimibond (esperable parcialmente, pero hay que cuantificar).

**Propuesta target:**
- **`invoice_bridge`** (view, no MV — cheap): una fila por `(odoo_invoice_id OR syntage_uuid)`. Columnas: `odoo_invoice_id, syntage_uuid, match_method, match_confidence, direction, invoice_date_op, invoice_date_sat, amount_op, amount_sat, amount_diff, is_orphan_odoo, is_orphan_syntage, state_op, state_sat`.
  - `match_method ∈ {'uuid_exact', 'composite_rfc_total_date', 'manual', 'none'}`
  - `match_confidence ∈ {'high','medium','low','unmatched'}` (derivado)
- **`invoice_bridge_manual`** (tabla): `(odoo_invoice_id, syntage_uuid, linked_by, linked_at, note)` para overrides manuales que la view respeta.
- **Función `reconcile_invoice_manually(odoo_id bigint, syntage_uuid text, note text)`** — inserta en `invoice_bridge_manual`, invalida cache, opcionalmente cierra issues relacionados.

**Riesgo si no se unifica:** **alto**. Es la raíz del síntoma "veo partes de Odoo en un sitio y partes de Syntage en otro". Sin bridge explícito, cada consumer reinterpreta el matching.

---

### 3.3 Pagos

**Estado actual:**
- `odoo_account_payments` (17,856 rows; 17,012 reconciled) — único writer post-Fase 2 (legacy `odoo_payments` dropeado).
- `syntage_invoice_payments` (25,508 rows; 10,482 issued / 15,029 received) — complementos P SAT.
- `payments_unified` MV (41,255 rows) — refreshed cada 15min.
- `odoo_payment_invoice_links` (14,005 rows) — bridge pago→facturas en Odoo.

**Gaps detectados:**
- `oap_posted = 0` (0 con state='posted') contra 17,012 con is_reconciled=true — **inconsistencia aparente**: `state='paid'` o similar; el filtro `state='posted'` en views probablemente está mal. Ver `financial_runway` que filtra `state='paid'`.
- 730 `payment_missing_complemento` abiertos (Odoo marcó pago pero no hay P en SAT).
- 22,748 `complemento_missing_payment` abiertos (SAT emitió P pero Odoo no registró el pago) — el más numeroso, probablemente pagos recibidos.

**Redundancia:** `payments_unified` ya unifica. No hay duplicación.

**Propuesta target:**
- **No crear `payments_bridge` separada** — ya existe `payments_unified` con el joint. Añadir columnas `is_orphan_odoo`, `is_orphan_syntage`, `odoo_payment_link_count` derivadas.
- **Función `reconcile_payment_manually(odoo_payment_id, syntage_complemento_uuid, note)`**.
- **Normalizar `state` en `odoo_account_payments`** — documentar que el valor real es `'paid'`, no `'posted'`. Las views de `cfo_dashboard`/`financial_runway` ya usan `'paid'`; es el diccionario qb19 CLAUDE.md el que está desactualizado.

**Riesgo si no se unifica:** medio. La capa ya existe; falta surfacear los orphans como UX para reparación manual.

---

### 3.4 Órdenes (ventas + compras)

**Estado actual:**
- `odoo_sale_orders` (12,353 rows) + `odoo_purchase_orders` (5,669 rows) en tablas separadas.
- `odoo_order_lines` (32,058 rows) **ya unificadas** con discriminador `order_type ∈ {'sale','purchase'}`.
- **No hay equivalente SAT** — órdenes son pre-facturación, no tienen CFDI.

**Órdenes huérfanas detectadas:**
- 2,680 sale lines con `qty_invoiced=0` en órdenes `state='sale'` (vendidas pero no facturadas todavía — gap de facturación)
- 2,637 sale lines con `qty_delivered=0` (no entregadas aún)
- 1,792 invoice_lines sin `odoo_product_id` (bug de sync o producto eliminado)

**Redundancia:** `odoo_order_lines` ya cumple la función de `orders_lines_unified`. Los headers (`odoo_sale_orders` vs `odoo_purchase_orders`) tienen schemas levemente distintos pero similares.

**Propuesta target:**
- **`orders_unified`** (view): UNION `sale_orders` + `purchase_orders` con discriminador `order_type`. Campos comunes: `odoo_order_id, name, company_id, odoo_partner_id, amount_total, amount_untaxed, state, date_order, currency, order_type, assignee_user_id` (= salesperson_user_id para sale, buyer_user_id para purchase).
- **`order_fulfillment_bridge`** (view): `order_line_id → qty_ordered → qty_delivered → qty_invoiced → qty_invoice_line_id (nullable)`. Permite ver el embudo completo.
- Opcionalmente: MV `order_fulfillment_gaps` con las 2,680 sale lines no facturadas. Poblada si los directores Sales/Compliance la usan frecuentemente.

**Riesgo si no se unifica:** bajo. El dolor operativo de tener 2 tablas para órdenes es más UX que data quality. La view unificada basta.

---

### 3.5 Contactos / Empresas / Usuarios / Empleados

**Estado actual:**
- `companies` (2,193 rows) con `rfc`, `odoo_partner_id`, `entity_id` (2,189 con entity_id) — maestro unified.
- `contacts` (1,894 rows) con `email` único (100% populated), `entity_id` (1,527 con entity_id = 80.6%).
- `odoo_users` (40 rows; 10 con contact matching por email).
- `odoo_employees` (164 rows; 12 con user link; 11 con contact matching por work_email).
- `entities` (9,351 rows: 4,053 person, 3,614 company, 1,653 product, 19 machine, 11 raw_material, 1 location).

**Overlap analysis:**
- **companies ↔ entities (company):** 2,193 vs 3,614. Hay 1,421 entidades company SIN contraparte en `companies`. Son menciones del knowledge graph que nunca se resolvieron a una empresa real — esperado.
- **contacts ↔ entities (person):** 1,894 vs 4,053. Mismo patrón: 2,159 personas mencionadas sin registro en contacts. Esperado (spam, co-emitentes, etc.).
- **contacts ↔ odoo_users ↔ odoo_employees:** un humano puede estar en las 3. Solo 10/40 users tienen contact por email; solo 11/164 employees. **Significa que hoy NO hay contact row por cada empleado de Quimibond** — gap real.

**Redundancia:** baja arquitectónicamente (cada tabla tiene propósito distinto: `companies` = unified, `contacts` = individuos, `odoo_users` = login, `odoo_employees` = HR). **Real gap**: falta un view unificado "person_unified" que linkee las 4 fuentes cuando coinciden.

**Propuesta target:**
- **`person_unified`** (view): `COALESCE(contact.email, employee.work_email, user.email)` como `primary_email`. Columnas: `contact_id, entity_id, employee_id, user_id, name, email, role (employee/external/user), department, job_title`.
- **Backfill trigger:** cuando llega un nuevo `odoo_employee.work_email`, si no existe contact con ese email, crear uno. Evita divergencia futura.
- **NO tocar `entities`** — sigue siendo el bus para el knowledge graph y no conflicta con `companies`/`contacts` (ya tienen `entity_id` FK).

**Riesgo si no se unifica:** bajo operativamente, alto para directores IA que hoy no pueden responder "¿qué empleado escribió este email al proveedor X?" sin un JOIN manual triplicado.

---

### 3.6 Precios históricos

**Estado actual:**
- `odoo_products.list_price` + `standard_price` — **snapshot actual**, sobreescrito en cada sync.
- `odoo_order_lines.price_unit` — precio en momento de orden (32,058 rows).
- `odoo_invoice_lines.price_unit` — precio en momento de factura (71,334 rows).
- `real_sale_price` MV (253 rows; solo los 253 productos con sales_lines_12m > 0) — agregados 90d/180d/12m.
- `supplier_price_index` MV (3,929 rows) — precios de compra por proveedor/producto.
- `product_real_cost` MV (1,837 rows) — costo BOM computado.
- **No hay `price_history`** (serie temporal por producto + mes).

**Redundancia:** los precios viven en 5 lugares. `real_sale_price` es actual pero no histórico.

**Propuesta target:**
- **`product_price_history`** (MV): `(odoo_product_id, month, source ∈ {order_sale, invoice_sale, order_purchase, invoice_purchase}, avg_price, min_price, max_price, qty, count_lines, companies_count)`. Un producto puede aparecer 4 veces por mes. Tamaño estimado: 1,837 productos × 48 meses × 4 sources × 30% activos = ~100K rows, <50MB.
- Refreshed `refresh_all_matviews` cada 2h.
- Los directores IA de Compras/Ventas pueden responder "¿subimos el precio de WM4032 en 2025?" en un query.

**Riesgo si no se unifica:** medio. Hoy respuestas de tendencias de precios requieren queries ad-hoc sobre invoice_lines. Los directores IA no tienen el atajo.

---

### 3.7 Vistas financieras (análisis)

**Estado actual** (post-Fase 2 limpieza):

Views tradicionales (pre-analytics):
- `cash_position` (bank balances con conversion USD/EUR → MXN)
- `cfo_dashboard` (efectivo, CxC, CxP, 30d metrics)
- `working_capital` (efectivo, CxC, CxP, ratios)
- `working_capital_cycle` (DSO/DPO/DIO/CCC)
- `financial_runway` (días de runway)
- `cash_flow_aging` (aging CxC por empresa, join a `company_profile`)
- `monthly_revenue_trend` (revenue mensual desde `odoo_order_lines`, solo 2025+)
- `pl_estado_resultados` (P&L mensual desde `odoo_account_balances`)
- `revenue_concentration` (Pareto ABC top clientes 12m)

Views `analytics_*` (wrappers — 12 de ellas):
- `analytics_finance_cash_position` → thin wrapper de `cash_position` (113 chars)
- `analytics_finance_cfo_snapshot` → wrapper de `cfo_dashboard` (266 chars)
- `analytics_finance_income_statement` → wrapper de `pl_estado_resultados` (159 chars)
- `analytics_finance_working_capital` → wrapper de `working_capital` (206 chars)
- `analytics_revenue_fiscal_monthly` → wrapper de `syntage_revenue_fiscal_monthly` (232 chars)
- `analytics_revenue_operational_monthly` → wrapper de `monthly_revenue_trend` (138 chars)
- `analytics_customer_360` (2,378 chars — sustantivo, no wrapper)
- `analytics_supplier_360` (1,949 chars — sustantivo)
- `analytics_customer_fiscal_lifetime`, `analytics_supplier_fiscal_lifetime`, `analytics_customer_cancellation_rates`, `analytics_product_fiscal_line_analysis` — wrappers de syntage_*

**Overlap detectado:**
- `cash_position` ⊂ `cfo_dashboard` ⊂ `working_capital` — misma data, distintas agregaciones. `cfo_dashboard` es la más completa.
- `working_capital` vs `working_capital_cycle` — la primera da snapshot, la segunda da métricas cíclicas DSO/DPO/DIO/CCC. Son complementarias, mantener.
- `monthly_revenue_trend` solo desde 2025-01-01 y solo de `odoo_order_lines` — restrictivo. Compite con `monthly_revenue_by_company` MV (7,361 rows, por compañía) y `analytics_revenue_fiscal_monthly` (SAT).
- 6 wrappers `analytics_*` no agregan valor — son renombres. Podrían borrarse a favor de las views base.

**Propuesta target:**
- **Mantener** como fuentes base: `cfo_dashboard`, `working_capital`, `working_capital_cycle`, `cash_flow_aging`, `revenue_concentration`, `financial_runway`, `pl_estado_resultados`.
- **Drop** (consumer audit first) 6 wrappers thin: `analytics_finance_*`, `analytics_revenue_*`. Frontend migra a view base.
- **Drop** `cash_position` si no se consume directamente (ya está dentro de `cfo_dashboard`).
- **Consolidar** `monthly_revenue_trend` + `monthly_revenue_by_company` → una sola MV con rollup `WHERE company_id IS NULL` como total. Evita mantener 2 fuentes de "revenue mensual".
- **Mantener** `analytics_customer_360` y `analytics_supplier_360` — son sustantivas (>1,900 chars), son APIs reales al frontend.

**Riesgo si no se podda:** bajo estructuralmente, pero alto para el directorio IA (12 views financial redundantes confunden el RAG al responder "dame estado financiero").

---

## 4. Bridge operativo ↔ fiscal (diseño detallado)

Esta sección es el **corazón** de la fase. El usuario pidió que "sync op↔fiscal sea muy fácil". Hoy el bridge es emergente; lo hacemos explícito.

### 4.1 Current state (evidencia)

| Métrica | Valor | Interpretación |
|---|---:|---|
| Odoo total invoices | 27,760 | |
| Odoo con cfdi_uuid | 13,985 | 50.4% coverage |
| Syntage total | 129,690 | |
| Syntage issued post-2021 | ~28,506 (81,079 − 52,573 pre-Odoo) | universo real emitido |
| Syntage issued post-2021 SIN match Odoo | 42,539 | **⚠️ > 100% del emisor — indica duplicados en syntage_invoices o pre-filter roto** |
| Odoo customer posted SIN UUID post-2021 | 5,251 | anomalía real |
| Odoo matched by UUID | 10,553 | 37.9% del total odoo |
| reconciliation_issues abiertos | 44,629 / 80,165 total | |
| complemento_missing_payment abiertos | 22,748 | 91% del total |
| sat_only_cfdi_issued abiertos | 9,984 | |

**Lectura:** el bridge UUID cubre ~38% de Odoo y deja >42K Syntage emitidos sin contraparte. Hay al menos 3 causas que debemos separar en reportes:
1. Pre-2021 (pre-Odoo) — no son gaps reales.
2. Post-2021 sin UUID en Odoo — bug de sync o timbrado manual sin propagar.
3. Post-2021 con UUID pero Syntage tiene otro UUID (cancelación/re-emisión) — no hay regla de transitividad.

### 4.2 Bridges actuales

```
┌─────────────────┐     uuid     ┌──────────────────┐
│ odoo_invoices   │<─────────────│ syntage_invoices │
│  .cfdi_uuid     │              │  .uuid           │
└─────────────────┘              └──────────────────┘
        │                                 │
        │ company_id                      │ emisor_rfc / receptor_rfc
        ▼                                 ▼
┌──────────────────────────────────────────────────┐
│                 companies                        │
│       rfc, odoo_partner_id, entity_id            │
└──────────────────────────────────────────────────┘

┌──────────────────────┐     num_operacion / composite     ┌────────────────────────┐
│ odoo_account_payments│<──────────────────────────────────│ syntage_invoice_payments│
└──────────────────────┘                                   └────────────────────────┘

┌──────────────────────┐
│ odoo_payment_invoice │  (Odoo-only bridge: payment → invoice)
│ _links               │
└──────────────────────┘
```

**Lo que falta:** una view explícita `invoice_bridge` que muestre cada factura (operativa o fiscal) y su contraparte, con método de match.

### 4.3 Target design

**`invoice_bridge` (view, no MV — cheap SELECT desde `invoices_unified`):**

```sql
CREATE VIEW public.invoice_bridge AS
SELECT
  canonical_id,
  odoo_invoice_id,
  uuid_sat AS syntage_uuid,
  direction,
  match_status,
  match_quality AS match_confidence,
  CASE
    WHEN odoo_invoice_id IS NOT NULL AND uuid_sat IS NOT NULL THEN 'uuid_exact'
    WHEN odoo_invoice_id IS NOT NULL AND uuid_sat IS NULL THEN 'odoo_only'
    WHEN odoo_invoice_id IS NULL AND uuid_sat IS NOT NULL THEN 'syntage_only'
    ELSE 'none'
  END AS match_method,
  odoo_amount_total_mxn AS amount_op,
  total_mxn_fiscal       AS amount_sat,
  amount_diff,
  invoice_date           AS date_op,
  fecha_timbrado::date   AS date_sat,
  odoo_state AS state_op,
  estado_sat AS state_sat,
  emisor_rfc,
  receptor_rfc,
  company_id,
  partner_name,
  -- Flags operativos
  (odoo_invoice_id IS NOT NULL AND uuid_sat IS NULL AND invoice_date >= '2021-01-01') AS is_gap_missing_sat,
  (odoo_invoice_id IS NULL AND uuid_sat IS NOT NULL AND fecha_timbrado >= '2021-01-01') AS is_gap_missing_odoo,
  (odoo_state = 'cancel' AND estado_sat = 'vigente') AS is_state_mismatch_cancelled_vigente,
  (odoo_state = 'posted' AND estado_sat = 'cancelado') AS is_state_mismatch_posted_cancelled
FROM public.invoices_unified;
```

Propiedades:
- Zero maintenance (es view sobre MV ya refreshed).
- UX simple: filtro `is_gap_missing_sat` para diagnóstico directo.
- Consumible por `cfdi_uuid` histórico del bridge operativo.

**`invoice_bridge_manual` (tabla nueva):**

```sql
CREATE TABLE public.invoice_bridge_manual (
  id bigserial PRIMARY KEY,
  odoo_invoice_id bigint,
  syntage_uuid text,
  linked_by text NOT NULL,
  linked_at timestamptz DEFAULT now(),
  note text,
  UNIQUE(odoo_invoice_id, syntage_uuid),
  CHECK (odoo_invoice_id IS NOT NULL OR syntage_uuid IS NOT NULL)
);
```

**Función `reconcile_invoice_manually`:**

```sql
CREATE OR REPLACE FUNCTION public.reconcile_invoice_manually(
  p_odoo_invoice_id bigint,
  p_syntage_uuid text,
  p_linked_by text,
  p_note text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.invoice_bridge_manual (odoo_invoice_id, syntage_uuid, linked_by, note)
  VALUES (p_odoo_invoice_id, p_syntage_uuid, p_linked_by, p_note)
  ON CONFLICT (odoo_invoice_id, syntage_uuid) DO UPDATE SET note = EXCLUDED.note
  RETURNING id INTO v_id;

  -- Actualiza odoo_invoices.cfdi_uuid si está NULL (no sobrescribe)
  IF p_odoo_invoice_id IS NOT NULL AND p_syntage_uuid IS NOT NULL THEN
    UPDATE public.odoo_invoices
    SET cfdi_uuid = p_syntage_uuid
    WHERE id = p_odoo_invoice_id AND cfdi_uuid IS NULL;
  END IF;

  -- Resuelve issues relacionados
  UPDATE public.reconciliation_issues
  SET resolved_at = now(),
      resolution = format('manual_link by %s: %s', p_linked_by, COALESCE(p_note, ''))
  WHERE resolved_at IS NULL
    AND ((odoo_invoice_id = p_odoo_invoice_id) OR (uuid_sat = p_syntage_uuid))
    AND issue_type IN ('sat_only_cfdi_issued','sat_only_cfdi_received','cancelled_but_posted');

  RETURN gen_random_uuid();
END $$;
```

**Composite matcher (nueva función):** `match_unlinked_invoices_by_composite(batch_size int)` — busca Odoo sin UUID post-2021 + Syntage sin match post-2021 y matchea por `(rfc + amount_total_mxn ± $0.01 + date ± 3d)`. Uso: cron opcional 1x/día o manual tras backfill.

### 4.4 UX recomendado al frontend

Nueva página `/system/reconciliación/manual` con:
1. Lista de `invoice_bridge WHERE is_gap_missing_sat OR is_gap_missing_odoo` (paginada).
2. Para cada gap: search typeahead contra la contraparte (Odoo → busca Syntage por RFC+fecha; Syntage → busca Odoo por total MXN).
3. Botón "Vincular" llama a `reconcile_invoice_manually(...)`.
4. Lista de matches manuales (auditoría).

---

## 5. Target schema (resumen por entidad)

| Entidad | Hoy | Target | Action |
|---|---|---|---|
| Productos | `odoo_products` + `syntage_invoice_line_items` (sin bridge) | `products_unified` view + `products_fiscal_map` table + `product_price_history` MV | Crear 3 objetos |
| Facturas | `invoices_unified` MV | + `invoice_bridge` view + `invoice_bridge_manual` tbl + `reconcile_invoice_manually` fn + `match_unlinked_invoices_by_composite` fn | Crear 4 objetos |
| Pagos | `payments_unified` MV | + `reconcile_payment_manually` fn + columnas derivadas orphans | Extender MV + crear fn |
| Órdenes | `odoo_sale_orders` + `odoo_purchase_orders` + `odoo_order_lines` | + `orders_unified` view + `order_fulfillment_bridge` view | Crear 2 views |
| Personas | `contacts` + `odoo_users` + `odoo_employees` + `entities` | + `person_unified` view + trigger backfill employee→contact | Crear view + trigger |
| Precios | `real_sale_price` + `supplier_price_index` + `odoo_products.*_price` | + `product_price_history` MV | Crear MV |
| Views financieras | ~12 views + 12 analytics_* wrappers | podar 6 wrappers thin + consolidar monthly_revenue | DROP 6 + consolidar |

### Invariantes post-fase

- 0 consumers frontend apuntando a `syntage_invoices` directamente (todo por `invoice_bridge` o `invoices_unified`).
- 1 función manual de reconciliación por entidad bridge (invoice + payment).
- `products_fiscal_map` pobla como mínimo los top 20 SKUs de Quimibond.
- `product_price_history` MV refreshed cada 2h con `refresh_all_matviews`.
- `analytics_finance_*` (6 wrappers thin) borrados o marcados `@deprecated`.

---

## 6. Definition of Done

### DoD cuantitativa

- [ ] `invoice_bridge` view creada, retorna `count(*) ≥ invoices_unified.count(*)`.
- [ ] `invoice_bridge_manual` tabla creada con UNIQUE y CHECK.
- [ ] `reconcile_invoice_manually()` existe y tiene smoke test (1 link manual + verification).
- [ ] `products_unified` view + `products_fiscal_map` tabla creadas; mapping seedeado manualmente para top 20 SKUs.
- [ ] `product_price_history` MV creada con ≥10K rows y refreshed en `refresh_all_matviews`.
- [ ] `orders_unified` view creada, count = sale_orders + purchase_orders.
- [ ] `order_fulfillment_bridge` view creada.
- [ ] `person_unified` view creada con `count(DISTINCT primary_email) > 0`.
- [ ] Trigger `backfill_contact_from_employee` activo.
- [ ] 6 views `analytics_finance_*` / `analytics_revenue_*` wrappers dropeadas (gated).
- [ ] Frontend CLAUDE.md actualizada con nuevas views + deprecación.
- [ ] Entradas en `schema_changes` por cada DDL.
- [ ] `audit_runs` con invariant_key `phase_2_5_baseline` y `phase_2_5_final`.

### DoD cualitativa

- Un director IA puede responder "¿qué facturas SAT emitidas en marzo no están en Odoo?" con `SELECT * FROM invoice_bridge WHERE is_gap_missing_odoo AND date_sat BETWEEN '2026-03-01' AND '2026-03-31'`.
- Un operador puede reconciliar manualmente una factura exótica en <1 minuto vía función SQL o página web.
- Tendencias de precio por SKU consultables en un SELECT.
- Post-drop de wrappers, todos los consumers frontend siguen funcionando.

---

## 7. Out of scope

- **Rediseñar** `entities` / knowledge graph (se queda como bus).
- **Reescribir** matching de `invoices_unified` MV (el matching UUID + composite existente se respeta; solo añadimos UX).
- **Poblar** `products_fiscal_map` completo — seed manual para 20 SKUs; resto cuando consumers lo pidan.
- **Retirar** crons existentes — solo añadimos `product_price_history` a `refresh_all_matviews`.
- **Auth / RLS** — queda para Fase 3.
- **Performance tuning** de MVs (índices sin uso, concurrent refresh) — queda para Fase 4.
- **Odoo business logic** — addon qb19 no se toca en esta fase (solo migrations SQL).

---

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| `products_unified` heurística `descripcion ILIKE` con false positives | Guard `LENGTH(internal_ref) >= 4` + exclusión SAT codes tipo '01010101' |
| `reconcile_invoice_manually` sobrescribe un cfdi_uuid válido | Guard `WHERE cfdi_uuid IS NULL` en el UPDATE; append-only en `invoice_bridge_manual` |
| `product_price_history` MV pesada al REFRESH | Particionar por año si crece >500K rows; inicialmente ~100K |
| Frontend rompe al dropear `analytics_finance_*` | Gated: audit consumers con `rg` antes de DROP; migrar frontend primero |
| `person_unified` revela PII no autorizada a anon | Security queda para Fase 3; mientras tanto view expuesta solo a `service_role` |
| Trigger `backfill_contact_from_employee` crea spam contacts | Idempotente: `ON CONFLICT DO NOTHING` por email |

---

## 9. Métricas de éxito

| Métrica | Baseline (2026-04-20) | Target post-fase |
|---|---:|---:|
| Views financial redundantes | 12 `analytics_*` + 9 tradicionales = 21 | 15 (drop 6 wrappers thin) |
| Bridges op↔fiscal explícitos | 0 views, 1 MV `invoices_unified` | +2 views, +1 table, +3 functions |
| Productos SAT→Odoo mapeados | 0 (no hay tabla) | ≥20 top SKUs seedeados |
| Orphan Odoo post-2021 sin UUID | 5,251 | Unchanged (diagnosis only — fix es qb19 fase aparte) |
| Orphan Syntage post-2021 sin Odoo | 42,539 | Unchanged (diagnosis only) |
| Funciones de reconciliación manual | 0 | 2 (invoice + payment) |
| MVs price history | 0 | 1 (`product_price_history`) |

---

## 10. Referencias

- [Master audit plan](./2026-04-19-supabase-audit-00-master.md)
- [Fase 1 — UI unificada](./2026-04-19-supabase-audit-02-ui-unificada.md)
- [Fase 2 — Limpieza](./2026-04-19-supabase-audit-03-limpieza.md)
- [Syntage integration](../../.claude/projects/-Users-jj/memory/project_syntage_integration.md)
- [Frontend CLAUDE.md](../../quimibond-intelligence/quimibond-intelligence/CLAUDE.md)
- [qb19 CLAUDE.md](../../../CLAUDE.md)
