# Audit 07 — Datos desaprovechados + oportunidades de unificación

**Fecha:** 2026-04-20 (al cierre del día)
**Fuente:** análisis directa contra Supabase `tozqezmivpblmcubmnpi` (público), no frontend.
**Scope:** identifica qué sincronizamos pero no explotamos — tablas/columnas/payloads sin downstream, dominios con analítica incompleta, bridges op↔fiscal faltantes y overlaps.
**NO se ejecuta DDL ni se toca código.** Todo es diagnóstico + plan.

---

## Resumen ejecutivo

- **76 tablas, 80 views, 38 MVs, 311 funciones** (public).
- **26 tablas con 0 consumers en views/MVs/funciones** (sección 1). De ellas, unas son legítimas (archivos, eventos, queue) pero **8 son datos fiscales/operativos huérfanos de lectura** (tax_returns, tax_retentions, tax_status, electronic_accounting, employees, departments, orderpoints, extractions).
- **~55 columnas "dead pixels"** nunca consumidas en ninguna parte (sección 2). Top tablas afectadas: `odoo_orderpoints`, `odoo_schema_catalog`, `odoo_uoms`, `odoo_users`, `odoo_departments`.
- **Raw payload de Syntage esconde ≥ 6 campos de alto valor** (`fullyPaidAt`, `paidAmount`, `dueAmount`, `dueDate`, `creditedAmount`, `paymentTerms`) disponibles en los 129 k CFDIs pero **no extraídos** (sección 4). Permite calcular "días a pago SAT" con precisión centavo-a-centavo.
- **Agent tickets: 1 958 todas `pending` (enrich)** — queue abandonada. **Notification queue: 780 todas `pending`** — ningún consumidor procesa. **Briefings: accounts_processed=0** en los últimos 10 días. Infraestructura AI rota que no ha sido notada.
- **1 627 errors `[object Object]` en `syntage_webhook`** en pipeline_logs (error handler con bug de serialización).
- **3 índices duplicados** sobre `products_unified` (idx vs idx1). Varios índices de `xml_file_id/pdf_file_id` nunca usados (>20).
- **Directores de AI stuck en 2026-04-13** (último `director_analysis_runs`); mientras agentes activos cumplen su schedule (`agent_runs`).
- **1 798 `entities` company sin `odoo_id`** + **2 796 persons sin `odoo_id`** + **1 655 products sin ninguna**: knowledge graph desconectado de Odoo.
- **`syntage_tax_status` tiene 1 fila (Quimibond)**, no contrapartes → 69B / opinión cumplimiento de terceros no está en esta tabla; la detección vive en `syntage_invoices.emisor/receptor_blacklist_status` (389 CFDIs emisor `presumed`, 3 `definitive`). **No hay view/MV que exponga "proveedores en 69B" por company.**
- **Views fiscales analytics_* son wrappers pass-through** de syntage_* (4 encontrados exactamente idénticos). Sección 7.
- **10 oportunidades ROI** priorizadas al final.

---

## 1. Tablas sin consumers (0 views + 0 MVs + 0 funciones referenciando)

Query: `pg_class` × `pg_views|pg_matviews|pg_proc` con regex `\mtable_name\M`.

### 1.A — Tablas huérfanas de LECTURA con datos valiosos (priorizar)

| Tabla | Filas | Por qué importa | Acción sugerida |
|---|---:|---|---|
| `syntage_tax_returns` | 285 | Declaraciones SAT mensuales (ISR, IVA) con `fecha_presentacion`, `monto_pagado`, `tipo_declaracion`, `periodo`, `ejercicio`. `raw_payload.payment.dueDate`/`paidAmount`/`bank`. **Predicción de cashflow fiscal directo desde SAT.** | Crear `fiscal_tax_returns` view + `cashflow_taxes_actual` (actual histórico mensual vs `cashflow_tax_monthly` que es proyección) |
| `syntage_tax_retentions` | 78 | Retenciones ISR/IVA que bancos nos hicieron ($4.23 M MXN lifetime). Afectan deducibilidad + cashflow. | `v_retentions_by_emisor_monthly` agregado |
| `syntage_tax_status` | 1 | Opinión cumplimiento + régimen fiscal propio. **Solo Quimibond** — no contrapartes. No es blacklist 69B (esa vive en `syntage_invoices.*blacklist_status`). | Documentar semántica real; usar 69B detection desde `syntage_invoices` + `reconciliation_issues.issue_type='partner_blacklist_69b'` |
| `syntage_electronic_accounting` | 35 | Catálogo+balanza electrónica (contabilidad SAT mensual). `ejercicio`, `periodo`, `record_type`, `hash`, `tipo_envio`. **Reconciliación Odoo vs SAT a nivel cuenta.** | `v_electronic_accounting_latest` por ejercicio/periodo |
| `syntage_extractions` | 27 | Jobs de backfill/extracción Syntage. Debugging y observability. | `v_syntage_extractions_progress` para dashboard admin |
| `odoo_employees` | 164 | Solo lo usa `person_unified` (1 view) — pero no hay `hr_headcount_by_dept`, turnover, vacantes. | `v_headcount_snapshot` (section 3 HR) |
| `odoo_departments` | 26 | Idem — solo person_unified. | integrado en HR views |
| `odoo_orderpoints` | 57 | `qty_to_order`, `qty_on_hand`, `qty_forecast` — 57 filas de **reorder rules Odoo**. Columnas marcadas dead-pixels. `stockout_queue` NO lo usa (usa `inventory_velocity` custom). | Decisión: (a) eliminar sync si `stockout_queue` lo reemplaza OR (b) crear `v_orderpoints_vs_velocity` para comparar reglas Odoo vs detección Quimibond |
| `odoo_schema_catalog` | 3 820 | Catálogo de fields Odoo — usado por el "odoo-agent" disabled. Sin consumer hoy. | Flag para drop o revivir |
| `odoo_uoms` | 76 | UoMs con factor/factor_inv — nunca leído. `product_ref.uom` sí se muestra pero no se usa la conversión. | Usar en `v_normalized_quantity` o drop si no se necesita |

### 1.B — Tablas huérfanas de lectura **OK** (legítimas — son target de escritura/log)

| Tabla | Filas | Razón |
|---|---:|---|
| `syntage_webhook_events` | 63 935 | Dedup de event_id (13 MB, 5 días retención) — OK |
| `syntage_files` | 22 515 | Metadata de XML/PDF en storage — pero hay índices `xml_file_id` / `pdf_file_id` sin scan en todas las tablas hijas (ver §9) |
| `sync_state` | 52 | Gmail sync tracking — leído por cron runtime, no por SQL |
| `sync_commands` | 17 | Manual sync queue — procesado por Odoo pull cron |
| `schema_changes` | 99 | Audit trail DDL — solo se escribe |
| `audit_runs` | 7 791 | Fase 1 harness — escrito por audit cron, leído por dashboard Next.js (no por DB) |
| `audit_tolerances` | 6 | Config constante — OK |
| `data_sources` | 7 | Catálogo de orígenes — OK (pero ver §9: seq_scan 401k, es lookup constante) |

### 1.C — Tablas "rotas" (huérfanas **con indicios de bug**)

| Tabla | Filas | Problema |
|---|---:|---|
| `notification_queue` | 780 | **100% status='pending'**, ninguna enviada. El worker cron no está jalando. |
| `agent_tickets` | 1 958 | **100% status='pending', 100% ticket_type='enrich'**. Queue abandonada. |
| `health_scores` | 51 152 | **100% contact_id NULL** en el último día (4 000 rows); company_id+contact_email poblados. Nombre del campo miente. Nadie lo lee. |
| `reconciliation_summary_daily` | 2 | Dos filas, no hay cron poblando desde 2026-04-17. |
| `unified_refresh_queue` | 0 | Queue creada, nunca ha tenido filas. Debounce de refresh MV no está encendido aún. |
| `briefings` | 48 | `accounts_processed=0` en los últimos 10 días a pesar de `total_emails` > 0. Pipeline de /api/cron/briefing roto. |
| `director_analysis_runs` | 35 | Todos los directores con `MAX(run_date)=2026-04-13` (hace 7 días). **Cron de director_analyses detenido.** |

---

## 2. Columnas "dead pixels" (nunca leídas en ningún view/MV/fn)

Query contra `information_schema.columns` excluyendo genéricas (`id`, `name`, `state`, `create_date`, `write_date`, `active`, `company_id`, `partner_id`, `user_id`, `product_id`, `created_at`, `updated_at`, `odoo_id`).

### Top tablas afectadas

#### `odoo_orderpoints` (8/12 columnas sustantivas no se leen)
`odoo_orderpoints_id`, `warehouse_name`, `location_name`, `product_min_qty`, `product_max_qty`, `qty_to_order`, `qty_on_hand`, `qty_forecast`, `trigger_type` — **casi toda la tabla**. Sugerencia: crear `v_reorder_policy_drift` comparando reorder_min/max con `inventory_velocity.daily_run_rate × lead_time`.

#### `odoo_schema_catalog` (10/10 columnas)
Toda la tabla está muerta. `model_name`, `field_name`, `field_type`, `selection_values`, `synced_to_supabase`, etc. Consumer (odoo-agent) inactivo.

#### `odoo_uoms` (7/7 columnas)
Entera muerta. Si no se usa conversión, **borrar sync**.

#### `odoo_users` (3 columnas rich)
`pending_activities_count`, `overdue_activities_count`, `activities_json` — sincronizamos contadores por usuario pero no hay view `v_user_workload` que los combine con `agent_insights.assignee_user_id` para priorizar carga del equipo.

#### `odoo_departments` (5/9 columnas)
`odoo_department_id`, `parent_id`, `parent_name`, `manager_id`, `manager_name`, `member_count` — jerarquía organizacional completa sin explotar.

#### `odoo_employees` (4 columnas rich sin uso)
`job_name`, `manager_id`, `manager_name`, `coach_name` — árbol jerárquico + rol no se expone.

#### `odoo_deliveries`
`picking_type_code` (`incoming`/`outgoing`/`internal`) nunca se usa en filtros — `picking_type` (textual) sí. Fuente de confusión.
`odoo_picking_id` — PK original Odoo, nunca usado para join reverse.

#### `odoo_invoices` (3 columnas sorprendentes)
- `payment_date` — nunca leída. En su lugar se calcula `days_to_pay` on-the-fly. Idealmente `payment_date` viene de `_push_invoices` y permitiría `v_cash_collection_velocity` o `days_to_pay_by_cohort`.
- `amount_tax` — no se usa (solo `amount_total` / `amount_untaxed`). Sin break-down IVA por invoice.
- `amount_paid` — duplicada implícitamente con `amount_residual`; nadie la consulta.

#### `odoo_invoice_lines` (3 columnas)
`price_total` (con IVA por línea), `price_total_mxn`, `line_uom` — tampoco se usan. Sin analítica IVA-por-línea/producto.

#### `odoo_order_lines`
`line_uom` — no se usa. Mismo gap que `odoo_invoice_lines`.

#### `odoo_products`
`barcode` (54/6 183 rows poblados — 0.9 %), `weight` (69/6 183 — 1.1 %), `category_id` (llave relacional no poblada). Esfuerzo bajo → drop o `v_products_master_data_quality`.

#### `odoo_chart_of_accounts`
`deprecated` — nunca filtrado. P&L incluye deprecated si está activo.

#### `odoo_currency_rates`
`inverse_rate` — no se usa. `rate` sí. Redundancia OK.

#### `odoo_bank_balances`
`odoo_journal_id` — no se usa para join a `cashflow_journal_classification` (que sí existe y clasifica por `pattern` sobre `name`). Oportunidad: reemplazar lookup por pattern con lookup por journal_id.

#### `odoo_purchase_orders`
`buyer_email` — presente pero no se surface en ningún análisis de compras.

#### `odoo_crm_leads`
`odoo_lead_id` nunca leído (join por name match). Si esperamos crecer el módulo CRM, es el natural key faltante.

---

## 3. Dominios Odoo **underexploited**

### 3.1 CRM (`odoo_crm_leads` — 20 filas)
**Lo que tenemos:** tabla con `stage`, `expected_revenue`, `probability`, `date_deadline`, `days_open`, `assigned_user`, `create_date`.
**Expuesto:** 2 views (1 audit, 1 person), 2 funciones.
**Falta:**
- `v_crm_pipeline_by_stage` — agregado expected_revenue × probability (forecast)
- `v_crm_aging` — leads por stage × bucket de días open (velocity por etapa)
- `v_crm_win_rate_by_user` — histórico cerrados vs abiertos por assigned_user (necesita historial, hoy no hay)
- Link a `companies` vía `odoo_partner_id` — 20/20 leads tienen `company_id=NULL` en la tabla. Resolver vía bridge.
- **Evidence:** `SELECT company_id, COUNT(*) FROM odoo_crm_leads GROUP BY 1;` → todos NULL; `odoo_partner_id` solo parcialmente poblado.
**ROI:** bajo por ahora (20 leads). Elevar cuando el pipeline crezca. **Priority: LOW.**

### 3.2 Activities (`odoo_activities` — 5 623 filas)
**Lo que tenemos:** `activity_type`, `summary`, `res_model`, `res_id`, `date_deadline`, `assigned_to`, `is_overdue`.
**Distribución de activity_type:** "Crear factura de compras"=2 164, "Validar"=1 524, "Exception"=688, "To Do"=617, "Email"=397, "Verificar contabilidad"=103, "Call"=61.
**Expuesto:** 3 views (`salesperson_workload_30d`, `person_unified`, `odoo_sync_freshness`), 1 MV, 5 fn.
**Falta:**
- `v_overdue_activities_by_type` — qué tipos están más atrasados (is_overdue=true ya existe en tabla).
- `v_accounting_activities_backlog` — 2 164 "crear factura compras" + 103 "verificar contabilidad" = cuello de botella contable.
- `v_activities_by_res_model` — qué objeto Odoo genera más actividades (stock.picking domina por regla de Validar = picking).
- **Hallazgo:** `res_model`, `res_id` columnas dead-pixel. Joinear a deliveries/invoices/orders desbloquearía "tiempo promedio hasta validación por ruta".
**Priority: MEDIUM** (cuello de botella contable real).

### 3.3 Deliveries (`odoo_deliveries` — 25 170 filas)
**Lo que tenemos:** `picking_type` (incoming/outgoing/internal), `is_late`, `lead_time_days`, `state`, `scheduled_date`, `date_done`.
Distribución: done=20 927 (83 %), cancel=3 929 (16 %), pending=<1 %.
**Expuesto:** `ops_delivery_health_weekly` MV + views de audit, cash_flow_aging, v_audit_deliveries_*.
**Falta:**
- `v_otd_by_customer` — on-time-delivery rate por cliente (tier, AR concentration). Hoy `company_profile.otd_rate` existe, pero no se ve por route.
- `v_otd_by_product_category` — pendiente → qué SKUs sufren más retrasos.
- `v_lead_time_distribution` — percentil P50/P90 por picking_type.
- `v_inbound_vs_outbound_late` — incoming vs outgoing: ¿el retraso viene de proveedores? (`picking_type='incoming'` + `is_late`).
- **Uso de `picking_type_code` / `odoo_picking_id`**: dead-pixel hoy.
**Priority: MEDIUM** (OTD ya existe pero no por segmento).

### 3.4 Manufacturing (`odoo_manufacturing` — 4 672 filas)
**Distribución state:** done=4 380, cancel=209, confirmed=50, draft=15, to_close=14, progress=4.
**Filtro del push:** `state NOT IN (done,cancel) OR date_start within 90 days` — pero vemos 4 380 "done" sincronizados, lo que indica buena cobertura histórica.
**Expuesto:** 3 views (`production_delays`, audit, person), 1 fn. Analítica superficial.
**Falta:**
- `v_mfg_yield_by_product` — qty_produced/qty_planned por producto (4 380/4 672 tienen yield data).
- `v_mfg_cycle_time` — date_finished - date_start distribución por producto.
- `v_mfg_wip` — productos en `progress/confirmed/to_close` con backlog estimado.
- `v_mfg_throughput_weekly` — productions terminadas por semana/workcenter.
- `v_mfg_rework_ratio` — requiere join con reprocess SKUs (`REPROCESO ACABADO`). Ver HPES100/96 en orderpoints: 312 qty_to_order con 1 037 on_hand → reglas mal calibradas?
**Priority: HIGH** (toda la planta produce aquí y no hay dashboard).

### 3.5 Stock / Orderpoints (`odoo_orderpoints` — 57 filas)
**Solo Toluca, todos `trigger_type='manual'`.** `product_min_qty=0` y `product_max_qty=0` en la mayoría → reglas Odoo **no configuradas** en producción.
Sin embargo `qty_to_order > 0` en varios (HPES100/96:312, HILO CALCETÍN:1 120, REPROCESO ACABADO:4 500 con on_hand=0 → stockout real).
**Expuesto:** `v_audit_...` audit orphan only, ningún consumo analítico.
**Gap:** `stockout_queue` funciona sin orderpoints — recomputa desde inventory_velocity. Pero las 57 orderpoints son señal de intención humana del área de compras: merecen un `v_orderpoint_vs_velocity_drift` que muestre dónde la regla Odoo difiere del consumo real observado.
**Priority: MEDIUM** (stockout_queue cubre el 80 %).

### 3.6 Accounting (balance sheet)
**Lo que tenemos:** `odoo_account_balances` (11 030 rows, period = YYYY-MM), `odoo_chart_of_accounts` (1 640 accounts con type). `pl_estado_resultados` ya existe.
**Distribución account_type (periodos ≥ 2026-01):** `asset_cash`, `asset_current`, `asset_fixed`, `asset_receivable`, `asset_prepayments`, `liability_*` (current/payable/credit_card/non_current), `expense*`, `income*` — **todos los types necesarios para Balance Sheet ya están en `odoo_chart_of_accounts.account_type`.**
**Expuesto:**
- `pl_estado_resultados` — P&L consolidado por período. OK.
- `cashflow_projection` MV — depende de balances.
- `accounting_anomalies` MV.
**Falta (HIGH ROI):**
- **`balance_sheet_estado_posicion` view** — análogo de `pl_estado_resultados` pero agrupando activo/pasivo/capital. Toda la data ya está en `odoo_account_balances + odoo_chart_of_accounts.account_type`. Es SQL trivial (~20 líneas).
- `v_balance_sheet_trend_12m` — evolución activo corriente, pasivo corriente, working capital contable.
- `v_account_subledger_top_movements` — top N movimientos por cuenta/mes (usar `odoo_invoice_lines` y sumar a `account_code` via join — ya existe `odoo_invoices.move_id` implícito).
**Priority: HIGH.** Falta **balance sheet fundamental**.

### 3.7 Cash flow / FX (`odoo_bank_balances` 22 filas + `odoo_currency_rates` 71 filas)
**Lo que tenemos:** 22 bancos (MXN/USD), USD rate histórico.
**Expuesto:** `cash_position`, `working_capital`, `cfo_dashboard`, `financial_runway`, `cashflow_current_cash`. Muchos views.
**Overlap:** ver §7. `cfo_dashboard` y `working_capital` calculan cash+AR+AP cada uno con lógica ligeramente distinta. `cash_position` es raw balance list.
**Falta:**
- `v_fx_exposure` — exposición USD neta (USD AR - USD AP - USD bank) × volatilidad del rate. Hoy solo vemos `current_balance_mxn` con rate spot.
- `v_fx_pnl_realized` — revaluación mensual bancos USD con rate inicio/fin del mes — requiere series temporal, hoy solo tenemos snapshot.
- `v_cashflow_by_currency_monthly` — descomponer flows MXN vs USD.
**Priority: MEDIUM** (toda la operación es mayormente MXN, pero hay USD cuentas con $94k+ saldo).

### 3.8 HR (`odoo_employees` 164 + `odoo_departments` 26)
**Todo dead-pixel** excepto 1 view (`person_unified`) y `odoo_sync_freshness`.
**Falta:**
- `v_headcount_by_dept` — count empleados activos por department + tree jerárquico (manager_id) + ratio supervisor:staff.
- `v_manager_tree` — recursive CTE con `manager_id` hacia top.
- `v_payroll_signal` — employees × `cashflow_payroll_monthly` (que existe).
- `v_user_to_insights_load` — `ai_agents` + `odoo_users.pending_activities_count` + `agent_insights.assignee_user_id` — qué empleados tienen N insights + M actividades + K tickets → carga real.
**Priority: LOW-MEDIUM** (depende si el CEO quiere vistas de RH).

### 3.9 Chart of accounts structure
1 640 accounts, `code`+`account_type`, no se expone tree jerárquico. Código SAT (p.ej. "201-01-001") se puede parsear para jerarquía padre-hijo.
**Falta:**
- `v_coa_tree` — agrupado por prefijo (level 1 = primer digito, level 2 = dos digitos, etc).
- `v_ledger_navigation` — drill-down account → movimientos.
**Priority: LOW** (usabilidad contable, no decisiones del CEO).

---

## 4. Fiscal/SAT **underexploited** — el mayor hallazgo

### 4.1 `syntage_tax_status` (1 fila) — semántica mal entendida
- **1 fila**: RFC=`PNT920218IW5` = Quimibond misma. **No contiene opinión cumplimiento de terceros.**
- **Detección 69B de contrapartes** vive en `syntage_invoices.emisor_blacklist_status` / `receptor_blacklist_status`:
  - 389 CFDIs con emisor `presumed` (69B presunto)
  - 35 CFDIs con receptor `definitive`
  - 3 CFDIs con emisor `definitive`
- **`reconciliation_issues.issue_type='partner_blacklist_69b'`** tiene 168 rows (2 abiertas).
- **Gap**: ningún view/MV/fn agrega blacklist status por `company` o `rfc`. Recomendación: crear `v_companies_69b_flags`:
  ```sql
  SELECT c.id, c.rfc, c.canonical_name,
    MAX(CASE WHEN emisor_rfc=c.rfc THEN emisor_blacklist_status END) AS emisor_69b,
    MAX(CASE WHEN receptor_rfc=c.rfc THEN receptor_blacklist_status END) AS receptor_69b,
    COUNT(*) FILTER (WHERE emisor_blacklist_status IS NOT NULL OR receptor_blacklist_status IS NOT NULL) AS flagged_cfdis
  FROM companies c
  LEFT JOIN syntage_invoices s ON lower(s.emisor_rfc)=lower(c.rfc) OR lower(s.receptor_rfc)=lower(c.rfc)
  GROUP BY 1,2,3 HAVING MAX(...) IS NOT NULL;
  ```
- **Business impact**: deducibilidad IVA en riesgo para 389 CFDIs de proveedores 69B presuntos. Al menos un flag visible al crear nueva PO.

### 4.2 `syntage_invoices.raw_payload` — goldmine no extraída
Cada uno de los **129 673 CFDIs** tiene en `raw_payload`:

| Campo | Qué es | Valor |
|---|---|---|
| `fullyPaidAt` | Fecha exacta en que SAT registró cobro completo (complementos P sumados = total) | "real_payment_date" fiscal |
| `paidAmount` | MXN pagado hasta la fecha | % cobrado real |
| `dueAmount` | MXN restante por cobrar | residual fiscal vs Odoo |
| `dueDate` | Fecha vencimiento CFDI (derivada de `paymentTerms`) | vencimiento SAT independiente de Odoo |
| `creditedAmount` | Monto afectado por egresos (notas de crédito) | neta post-notas |
| `paymentTerms` | "PPD 30 días" etc (estructurado) | términos parseados |
| `paymentTermsRaw` | Texto libre del CFDI | términos originales SAT |
| `cancellationProcessStatus` | Estado del flujo cancelación (solicited/accepted/rejected) | Hoy solo tenemos `estado_sat` |

**Sample real**: UUID con `fullyPaidAt='2026-04-08 18:00:00'`, `paidAmount=10185.73`, `dueAmount=0`. Esto es **cobranza SAT-confirmada** sin necesidad de complementos P manuales.

**Acción recomendada:**
- Agregar columnas generadas o extraídas: `fiscal_fully_paid_at`, `fiscal_paid_amount`, `fiscal_due_amount`, `fiscal_due_date`, `fiscal_credited_amount`, `fiscal_cancellation_process_status`.
- Crear `v_fiscal_collection_velocity`: `fecha_timbrado → fullyPaidAt` días promedio por cliente/RFC.
- Crear `v_fiscal_vs_odoo_payment_date_drift`: compara `odoo_invoices.payment_date` (si lo poblamos) vs `syntage_invoices.fullyPaidAt`.

**ROI: ALTÍSIMO.** Convierte días-a-pago de "estimado Odoo" a "confirmado SAT" sin esfuerzo extra de complementos.

### 4.3 Complementos P (tipo P) — 15 196 CFDIs, 25 511 payments
Ya tenemos `payments_unified` y `payment_allocations_unified` (con `jsonb_array_elements(doctos_relacionados)`).

**Falta:**
- `v_collections_by_complemento_date_monthly` — agrupado por `fecha_pago` (no `fecha_emision`): la **fecha fiscal real** de cobro.
- `v_ppd_without_complement_alert` — invoices con `metodo_pago='PPD'` que llevan >30 días sin ningún complemento P registrado. **Alerta compliance**. Hoy `reconciliation_issues.issue_type='complemento_missing_payment'` tiene 22 748 OPEN — ya detectado.
- Pero **ningún view surface** esos 22 748 al usuario/CEO.

### 4.4 `syntage_tax_retentions` (78 filas) — retenciones ISR/IVA
$4.23 M lifetime retained. 100 % `direction='received'` (bancos reteniendo a Quimibond).
**Falta:**
- `v_retenciones_by_bank_monthly` — agregado mensual por emisor_rfc (todos son bancos: BBVA, BANCOMER, MIFEL).
- Reconciliación con `odoo_account_balances` cuenta de ISR retenido / IVA acreditable.
**ROI: MEDIUM** (ya está contabilizado en Odoo; sería cross-check).

### 4.5 `syntage_electronic_accounting` (35 filas) — catálogo / balanzas SAT
Record_types presumibles: catálogo de cuentas + balanza mensual. 35 envíos.
**Falta:** reconciliar `odoo_account_balances` × este envío para detectar discrepancias entre lo que SAT recibió y lo que Odoo tiene hoy.
**ROI: MEDIUM** (compliance).

### 4.6 `odoo_invoices.cfdi_*` columns — expuestas pero sub-usadas
Columnas presentes: `cfdi_uuid`, `cfdi_sat_state`, `cfdi_state`, `edi_state`. Todas referenciadas en views (según regex match) — OK.
**Gap UX**: no hay `v_cfdi_compliance_dashboard` por empresa mostrando:
- % invoices con `cfdi_uuid` vigente
- % con `edi_state='error'`
- % cancelled en SAT pero `state='posted'` en Odoo (reconciliation_issues.`cancelled_but_posted` tiene 97 OPEN — mismo gap).

---

## 5. Knowledge graph + email integration

### 5.1 `entities` (9 356 filas) — desconexión masiva con Odoo

| entity_type | count | with_odoo_id | gap |
|---|---:|---:|---|
| person | 4 056 | 1 260 | 2 796 sin odoo_id → contactos de email no resueltos a `contacts` |
| company | 3 614 | 1 816 | **1 798 companies duplicadas/no-match con `companies` table** |
| product | 1 655 | 0 | **0/1 655 linked** → products se extraen del texto pero no se resuelven a `odoo_products.internal_ref` |
| machine | 19 | 0 | sin link |
| raw_material | 11 | 0 | sin link |

**Acción:**
- `trg_backfill_entity_to_company_by_rfc` / `by_domain` — ya existe uno similar para contactos, escalar a companies.
- **Entity resolution batch job**: match `entities.name` vs `companies.canonical_name` (pg_trgm similitud).
- `v_entities_unresolved` — priorizar por `mention_count` DESC.
- Products: 1 655 nombres de producto en emails nunca matcheados. `products_unified.name` / `internal_ref` con pg_trgm podría resolver 50 %.

### 5.2 `facts` (31 665 filas) — distribución de tipos
- `information`: 18 258 (58 %) — genérico, baja accionabilidad
- `commitment`: 6 121 — promesas (alta accionabilidad)
- `request`: 4 205
- `complaint`: 1 542 — quejas (usado en `company_narrative`)
- `price`: 1 167 — precios mencionados en email
- `change`: 371
- `statement`, `mentioned_with`, `follow_up`, `sells_to`, `payment`, `buys_from`: cola larga

**Falta:**
- `v_open_commitments_by_company` — commitments sin fulfillment en orders_unified. Hoy `company_narrative` sumariza pero no muestra el status acción-por-acción.
- `v_price_mentions_vs_actual` — facts tipo price vs `real_sale_price` / `product_price_history` → detección de presiones de precio del cliente.
- `v_complaint_trend_monthly` por company_id.

**ROI: HIGH** (accionar promesas).

### 5.3 `email_cfdi_links` (464 filas)
Rows solo desde 2026-04-14 al 2026-04-15 → se dejó de poblar. O el cron está roto. Solo 464 links para 129k CFDIs (0.4 % match).
**Falta:** estrategia de matching más agresiva (adjunto XML, UUID en subject, patrón de ref).

### 5.4 `emails` (113 999) × `threads` (48 007)
Hay `sender_contact_id` (columna), pero ningún view lo usa. Gap para atribución email → company → revenue.

---

## 6. AI infrastructure observability

### 6.1 `ai_agents` — 20 slugs, 8 activos (12 disabled)
Legacy slugs disabled pero **presentes**: `finance`, `sales`, `operations`, `risk`, `suppliers`, `growth`, `meta`, `predictive`, `relationships`, `cleanup`, `data_quality`, `odoo`.
**Acción:** drop legacy rows (o marcar `archived_at`).

### 6.2 `agent_runs` — 575 ejecuciones
`completed=556, failed=19` → 96.7 % success. `avg_duration=36.1s`. **OK**.
Top endpoints tokens 7d: `analyze-batch` (30.7M in / 10.5M out), `agent-operaciones` (466k in), `agent-financiero`, `agent-comercial`, etc.
**Falta:**
- `v_agent_cost_weekly` — $/agente (token_usage * price). Base para budget_tokens.
- `v_agent_failure_patterns` — los 19 failed clusterizados por error_message.

### 6.3 `agent_memory` — 1 942 rows, 9 agentes
Sin expiración/purge automático. Importancia con decay.
**Falta:** `v_agent_memory_health` — memorias `times_used=0` + antigüedad → candidatas a consolidar.

### 6.4 `token_usage` — 18 321 rows
**Top consumer `analyze-batch`** domina. Todo en últimos 7 días = 7 871 llamadas → ~1 125/día.
**Falta:**
- `v_token_usage_by_endpoint_weekly_trend` — alerta crecimiento anómalo.
- Presupuesto cruzado con `ai_agents.monthly_budget_tokens` (columna existente sin view).

### 6.5 `pipeline_logs` — 13 838 rows, 1 855 errors
- **1 627 errors "`Handler error: [object Object]`"** en `phase=syntage_webhook` — **bug de serialización** del handler. Reemplazar con `JSON.stringify(err)` o `err.message`.
- 69 foreign key violations en `syntage_invoice_line_items` — invoice se inserta después del line item (ordering issue).
- 5 `null value in syntage_id` — bug de no-null propagation.
**Priority: HIGH** — el webhook está perdiendo eventos.

### 6.6 `agent_tickets` — 1 958 rows, 100 % pending
Todas ticket_type='enrich'. **Worker nunca las procesa.** Decisión: (a) arrancar worker, (b) eliminar tabla.

### 6.7 `agent_insights` lifecycle
`archived=438`, `acted_on=53`, `dismissed=38`, `new=16`, `seen=4`. Lifecycle razonable pero:
- Solo `55/549 = 10%` accionados. ¿Los otros son ruido?
- `was_useful` y `user_feedback` — no medimos cuánto llega al campo.
- `business_impact_estimate` — columna presente, no usada en ningún view agregado → priorización pobre.

---

## 7. Overlaps entre views financieras actuales

### 7.1 `cfo_dashboard` vs `working_capital` vs `financial_runway`
Las tres calculan cash + AR + AP desde cero con semántica **ligeramente distinta**:

| Métrica | cfo_dashboard | working_capital | financial_runway |
|---|---|---|---|
| Efectivo | `sum mxn_live` solo `native>0` → cajas sin sobregiros | signed-based con `CASE current_balance>0` | `COALESCE(current_balance_mxn, current_balance)` — trata USD como MXN si falta |
| Rate USD | `rate from latest_usd` fallback 17.30 | `usd_to_mxn()` fn | `usd_to_mxn()` fn |
| Deuda tarjetas | `abs(mxn_live) filter < 0` | `abs filter < 0` | **NO separa** → runway tratar tarjetas como cash positivo |
| AR | `out_invoice` + not_paid/partial + residual>0 | idem | + filter `due_date BETWEEN -30 and +30` |
| AP | `in_invoice` idem | idem | idem con rango |
| Outputs | 12 métricas | 7 métricas | 7 métricas incl. `burn_rate`, `runway_days` |

**Recomendación:**
- Consolidar cash en una fn `get_cash_position()` compartida (o un view base `v_cash_neutral`) que todas consuman.
- Documentar diferencias intencionales.
- `financial_runway` bug: `COALESCE(amount_mxn, amount)` en outflow trata USD nativo como si fuera MXN → **subestima burn_rate 17×** cuando hay pagos USD.

### 7.2 `monthly_revenue_trend` vs `monthly_revenue_by_company`
**Fuentes distintas:**
- `monthly_revenue_trend` = desde `odoo_order_lines` (venta pedida/cerrada, filtro `order_state IN ('sale','done')`).
- `monthly_revenue_by_company` = desde `odoo_invoices` out_invoice + out_refund (venta facturada).

**Ambos son válidos** (order vs invoice ≠ mismo timing). Pero el nombre "revenue" es ambiguo.
**Acción:** renombrar a `monthly_booked_revenue_trend` / `monthly_invoiced_revenue_by_company` o agregar comment.

### 7.3 `analytics_*` vs `syntage_*` — **4 wrappers pass-through**
| Wrapper | Original | Líneas de diferencia |
|---|---|---|
| `analytics_customer_fiscal_lifetime` | `syntage_top_clients_fiscal_lifetime` | **0 — exactamente iguales** |
| `analytics_customer_cancellation_rates` | `syntage_client_cancellation_rates` | **0 — exactamente iguales** |
| `analytics_supplier_fiscal_lifetime` | `syntage_top_suppliers_fiscal_lifetime` | `SELECT ... FROM syntage_...` — column re-order wrapper |
| `analytics_product_fiscal_line_analysis` | `syntage_product_line_analysis` | `SELECT ... FROM syntage_...` — trivial wrapper |
| `unified_payment_allocations` | `payment_allocations_unified` | `SELECT * FROM payment_allocations_unified` — alias |
| `unified_invoices` | `invoices_unified` | full column list, no lógica extra |

**Recomendación:** **DROP los 4 `analytics_*` duplicados** + mantener sólo `syntage_*` o renombrar `syntage_*` → `analytics_*` (plural) y eliminar duplicado. Frontend consume `analytics_*` hoy — hacer la migración coordinada (ya hay spec 2026-04-19 de limpieza).
`unified_invoices` + `unified_payment_allocations` son legado compatibility views (Fase 2) — ya marcados para drop en fase 3 de limpieza.

### 7.4 `cash_flow_aging` vs `ar_aging_detail` (MV)
`cash_flow_aging` agrupa por company × aging_bucket, mientras `ar_aging_detail` MV tiene el row-level. Relación correcta (agregador).
**OK, no redundante.**

### 7.5 `portfolio_concentration` vs `revenue_concentration` vs `customer_ltv_health`
Las tres calculan top N clientes por revenue 12m con lógica distinta:
- `portfolio_concentration` (MV) — probablemente incluye herfindahl.
- `revenue_concentration` (view) — rank, share_pct, cumulative, pareto A/B/C, tripwires.
- `customer_ltv_health` (MV) — LTV/churn_risk por cliente, consumido en `analytics_customer_360`.

Los tres son válidos, pero `portfolio_concentration` + `revenue_concentration` podrían fusionarse: una MV con herfindahl + pareto + tripwires.

---

## 8. Bridges op ↔ fiscal faltantes

| Bridge | Estado | Acción |
|---|---|---|
| **Credit notes Odoo vs Egreso SAT** | Parcial. `invoices_unified` incluye `out_refund`/`in_refund` + `tipo_comprobante='E'`. 385 out_refund + 197 in_refund en Odoo vs 2 009 E en SAT. Gap importante. | `v_credit_notes_bridge` — cruzar por `uuid_docto` en egresos (SAT) y `reversed_entry_id` si estuviera en push; hoy no se pushea. |
| **FX rate consistency** (Odoo vs CFDI `tipoCambio`) | **No hay view.** Cada CFDI trae su propio rate SAT que puede diferir de `odoo_currency_rates`. | `v_fx_drift_cfdi_vs_odoo` — merge de `syntage_invoices.tipo_cambio` contra `odoo_currency_rates.rate` por fecha. |
| **Payment complement flow** (P) | Parcial: `payment_allocations_unified` explota `doctos_relacionados` y joinea a `invoices_unified.uuid_sat`. **Bien implementado.** Pero no hay `v_payment_reconciliation_status_by_invoice`. | Crear view "por invoice, qué pagos SAT la cubren y cuánto falta". |
| **Retenciones Odoo vs CFDI** | `syntage_tax_retentions` (78) y `syntage_invoices.impuestos_retenidos` no se cruzan con `odoo_account_balances` cuenta ISR retenido. | `v_retenciones_reconciliation_monthly` — 3-way: odoo vs retentions vs impuestos_retenidos en invoice. |
| **PPD sin complemento** | Detectado en `reconciliation_issues` (22 748 OPEN) pero no surface al usuario. | `v_ppd_compliance_alerts_by_company` + trigger notificación. |
| **Nota de crédito SAT sin match en Odoo** | `invoices_unified` lo incluye, pero no hay KPI "% de egresos con match". | `v_egresos_match_rate_monthly`. |

---

## 9. Performance diagnostics (informativo, no acción aquí — Fase 4 Performance)

### 9.1 Índices duplicados (WARN de Supabase advisor)
`products_unified` tiene 3 índices duplicados (cada uno con suffix `_idx` y `_idx1`):
- `products_unified_internal_ref_idx` == `products_unified_internal_ref_idx1`
- `products_unified_sat_revenue_mxn_12m_idx` == `*_idx1`
- `products_unified_odoo_product_id_idx` == `*_idx1` (ambos UNIQUE)

Causa: MV refresh CONCURRENTLY requiere UNIQUE index; migración duplicó. **Acción:** drop `*_idx1`.

### 9.2 Índices no usados (idx_scan=0, size > 64 kB)
20+ índices nunca escaneados. Top candidatos a drop:
- `invoices_unified_cancelled_idx` (1 800 kB) — MV
- `syntage_invoices_xml_file_id_idx`, `syntage_invoices_pdf_file_id_idx` (~960 kB cada uno)
- `odoo_snapshots_company_id_snapshot_date_key` (904 kB)
- `products_unified_*_idx` duplicados (~150 kB cada)
- `syntage_tax_retentions_xml_file_id_idx`, `syntage_tax_returns_pdf_file_id_idx`, `syntage_tax_status_pdf_file_id_idx`, `syntage_invoice_payments_xml_file_id_idx`, `syntage_electronic_accounting_xml_file_id_idx` — pattern: todos los índices sobre FK a `syntage_files` están unused. Indica que **nunca joineamos Storage files** (lo cual es OK, el frontend los lee por path). Candidatos a drop todos.

### 9.3 Tablas con seq_scan desproporcionado (missing index candidates)
| Tabla | seq_scan | idx_scan | seq_tup_read | problema sospechoso |
|---|---:|---:|---:|---|
| `payments_unified` | 48 711 | 1 150 | 897 M | MV muy leída full-scan — **quiere índice por (canonical_payment_id) o (odoo_company_id, fecha_pago)** |
| `pipeline_logs` | 11 909 | 611 | 122 M | filtrado por level+phase sin índice |
| `product_margin_analysis` | 1 378 | 59 | 4.2 M | MV, ver por product_id |
| `account_payment_profile` | 9 307 | 31 | 3.1 M | MV chica (341 rows) pero muy consultada |
| `data_sources` | **401 312** | 8 | 557 k | 7 rows! pero leída 400k veces — probablemente trigger por fila al insertar facts/entities. **Cachear o elevar a enum.** |
| `cashflow_journal_classification` | 24 116 | 11 | 201 k | 10 rows, pattern-matched con ILIKE → no puede usar btree. Quizá pg_trgm index. |
| `odoo_bank_balances` | 7 892 | 174 | 186 k | 22 rows — joined frecuentemente; trivial. |
| `insight_routing` | 8 810 | 147 | 123 k | 14 rows, regex-matched — OK seq_scan. |

---

## Top 10 oportunidades (priorizadas por ROI)

Ranking = impacto-decisión × cobertura × (1 / esfuerzo).

### #1 Extraer 6 campos fiscales del `raw_payload` de Syntage → columnas o view
**Esfuerzo:** S. **Impacto:** XL (129k CFDIs con `fullyPaidAt`, `dueAmount`, `paidAmount`, `dueDate`, `creditedAmount`, `paymentTerms` disponibles → reescribe TODA la analítica de cobranza sobre base SAT en vez de Odoo).
**Artefacto:** `v_syntage_invoices_enriched` + `v_fiscal_collection_velocity`.

### #2 Fix 3 pipelines rotos (briefings, notification_queue, agent_tickets, director_analysis_runs)
**Esfuerzo:** M. **Impacto:** L. Restaurar funciones que ya existen pero no corren. `1 627` `[object Object]` errors + 780 pending notifications + 1 958 pending tickets + briefings stalled × 10 días + directors stalled × 7 días = **AI completo observability gap**.
**Artefactos:** fix webhook handler serialization; arrancar worker notification; drop agent_tickets (broken feature) o encender worker; encender cron director_analysis.

### #3 Balance Sheet view (`v_balance_sheet_estado_posicion`)
**Esfuerzo:** S (la data está toda en `odoo_account_balances` × `odoo_chart_of_accounts.account_type`). **Impacto:** XL (**Quimibond no tiene balance sheet en Supabase hoy; el CEO lo pide implícitamente**). P&L ya existe.

### #4 Expose 69B blacklist at company level (`v_companies_69b_flags`)
**Esfuerzo:** S (datos en `syntage_invoices.*_blacklist_status`). **Impacto:** L (compliance IVA: 389 CFDIs presumed + 35 definitive). Surface en `analytics_supplier_360` + alert al crear PO.

### #5 Drop 4 analytics_* pass-through wrappers + dedup indexes `products_unified`
**Esfuerzo:** S (coordinar con frontend). **Impacto:** M (reduce confusión + 3 índices duplicados = ~450 kB de overhead). Parte natural de Fase 3 Limpieza.

### #6 Manufacturing analytics suite (yield + cycle time + WIP)
**Esfuerzo:** M. **Impacto:** L (4 380 órdenes done con yield data; planta ciega hoy).
**Artefactos:** `v_mfg_yield_by_product`, `v_mfg_cycle_time`, `v_mfg_wip`, `v_mfg_throughput_weekly`.

### #7 PPD compliance dashboard (`v_ppd_missing_complement`)
**Esfuerzo:** S. **Impacto:** L (22 748 open reconciliation issues — **riesgo SAT directo**). Data en `reconciliation_issues` ya computada, solo falta view consumable.

### #8 Consolidar cash/AR/AP en función única + fix bug USD burn rate
**Esfuerzo:** M. **Impacto:** M (3 views con subtle diffs; `financial_runway` subestima burn_rate 17x para pagos USD). Reducir superficie.

### #9 Credit notes bridge (`v_credit_notes_bridge_match_rate`)
**Esfuerzo:** M. **Impacto:** M (582 notas Odoo vs 2 009 SAT egresos — gap sugiere cancelación + refactura no rastreada).

### #10 Knowledge graph entity resolution (companies sin `odoo_id`)
**Esfuerzo:** M (pg_trgm fuzzy match batch job). **Impacto:** M (1 798 companies + 2 796 persons + 1 655 products unresolved → tracemos commitments/complaints a la compañía correcta).

---

## Sugerencia de roadmap

### Fase 2.6 — Exponer goldmine fiscal (ROI inmediato)
- #1 raw_payload extraction
- #3 balance_sheet view
- #4 69B flags por company
- #7 PPD compliance view

### Fase 2.7 — Manufacturing + Operations
- #6 mfg suite (yield/cycle time/WIP/throughput)
- `v_otd_by_customer/product` (3.3)
- `v_accounting_activities_backlog` (3.2)

### Fase 2.8 — AI infra resurrection (DO NOT DELAY)
- #2 fix pipelines rotos (4 bugs paralelos: webhook serializer, notification worker, director cron, briefing cron)
- `v_agent_cost_weekly`, `v_agent_failure_patterns`
- Drop agent_tickets o encender worker

### Fase 2.9 — Bridges op↔fiscal (largo plazo)
- #9 credit notes bridge
- `v_fx_drift_cfdi_vs_odoo`
- `v_retenciones_reconciliation_monthly`
- #10 entity resolution batch

### Fase 4 (Performance — existente)
- Agregar los diagnostics §9 al backlog de esa fase (no aquí).

### Fase de higiene continua
- #5 drop wrappers + dedup indexes + sunset agent tickets
- Drop `archive_pre_dedup` / `archive_dup_cfdi_uuid_2026_04_20` si Fase 1 Contención ya validó integridad
- Drop `odoo_schema_catalog`/`odoo_uoms` si consumers no regresan

---

## Nota metodológica

- Queries ejecutadas: ~35 consultas contra `information_schema`, `pg_views`, `pg_matviews`, `pg_proc`, `pg_stat_user_indexes`, `pg_stat_user_tables`, + samples de 18 tablas.
- Regex `\m<name>\M` sobre `pg_get_viewdef/pg_get_functiondef` puede dar falsos positivos con columnas genéricas (`id`, `name`, `state`) — por eso se filtraron. Puede haber ligeros falsos negativos si un view usa un column en un literal string.
- Supabase advisor performance ratifica duplicate indexes + unused indexes listed en §9.

**Fuentes:** `/Users/jj/CLAUDE.md`, `/Users/jj/docs/superpowers/specs/2026-04-19-supabase-audit-00-master.md`, `/Users/jj/docs/superpowers/specs/2026-04-20-supabase-audit-06-unificacion.md`.
