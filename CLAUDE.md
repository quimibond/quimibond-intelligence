# Quimibond Intelligence — Documentacion Completa

## Que es

Plataforma de inteligencia comercial para Quimibond (empresa textil mexicana). Conecta Odoo ERP + Gmail + Claude AI para darle al CEO insights accionables sobre su negocio.

**Stack:** Next.js 15 + React 19 + Supabase (PostgreSQL + pgvector) + Claude API + Odoo 19

**Repos:**
- `quimibond-intelligence` — Frontend (Vercel)
- `qb19` — Addon de Odoo (Odoo.sh)

---

## Arquitectura

```
ODOO ERP (qb19 addon)         SAT (Syntage webhooks)        Gmail
  ↓ push cada 1h                ↓ realtime                   ↓ cada 30min
┌──────────────────────────────────────────────────────────────────┐
│ BRONZE (raw ingest)                                              │
│   odoo_*  (24 tablas, ~1.29 GB)                                  │
│   syntage_*  (12 tablas, ~707 MB)                                │
│   emails / threads (Gmail, ~570 MB)                              │
└──────────────────────────────────────────────────────────────────┘
  ↓ matchers + reconcile (pg_cron 30min/1h/2h)
┌──────────────────────────────────────────────────────────────────┐
│ SILVER (reconciled, dedupped, FK-resolved)                       │
│   canonical_* (11 tablas + 5 MVs + 7 vistas, ~1.12 GB)           │
│   mv_* (4 MVs intermedias, ~127 MB)                              │
│   reconciliation_issues / mdm_manual_overrides / source_links    │
└──────────────────────────────────────────────────────────────────┘
  ↓ vistas SQL (no materializadas, evaluadas on-read)
┌──────────────────────────────────────────────────────────────────┐
│ GOLD (CEO-facing aggregates)                                     │
│   gold_* (12 vistas)                                             │
└──────────────────────────────────────────────────────────────────┘
  ↓ src/lib/queries/** (con unstable_cache para gold/canonical)
PIPELINE → AGENTES (8 directores) → CEO INBOX
```

### Capas — inventario verificado (2026-04-28)

#### BRONZE — raw ingest, no se modifica

**Odoo (24 tablas, push qb19 cada 1h):**
- Catálogo: `odoo_chart_of_accounts`, `odoo_currency_rates`, `odoo_stock_locations`, `odoo_workcenters`
- Maestros: `odoo_products`, `odoo_users`, `odoo_employees`, `odoo_departments`, `odoo_orderpoints`
- Transaccionales: `odoo_invoices`, `odoo_invoice_lines`, `odoo_sale_orders`, `odoo_order_lines`, `odoo_purchase_orders`, `odoo_deliveries`, `odoo_account_payments`, `odoo_activities`, `odoo_crm_leads`
- Manufactura: `odoo_manufacturing`, `odoo_workorders`, `odoo_stock_moves` (1.65M rows), `odoo_account_entries_stock` (240k rows)
- Saldos: `odoo_account_balances` (P&L mensual agregado), `odoo_bank_balances`
- Sentinela: `odoo_sync_freshness`, `odoo_push_last_events` (auxiliares)

**Syntage SAT (12 tablas, webhook + pull-sync):**
- `syntage_invoices` (130k rows, CFDIs), `syntage_invoice_line_items` (181k rows)
- `syntage_invoice_payments` (25k rows, complementos de pago)
- `syntage_tax_returns`, `syntage_tax_retentions`, `syntage_tax_status`, `syntage_electronic_accounting`
- `syntage_files` (PDFs/XMLs blob), `syntage_webhook_events` (audit log)
- Maestros: `syntage_taxpayers`, `syntage_entity_map`, `syntage_extractions`

**Gmail (3 tablas):**
- `emails` (117k rows), `threads` (50k), `email_recipients`

**Knowledge graph (extraído de emails):**
- `entities`, `entity_relationships`, `facts`, `ai_extracted_facts`, `action_items`

#### SILVER — reconciliado, dedup, FKs resueltas

**Canonical (Pattern A + C, 11 tablas + 5 MVs + 7 views):**
- MDM (Pattern C): `canonical_companies` (4.9k), `canonical_contacts` (2k), `canonical_products` (6k), `canonical_employees` (view)
- Operativo refresh-on-write (tablas): `canonical_invoices` (84k), `canonical_payments` (42k), `canonical_payment_allocations` (25k), `canonical_credit_notes` (2.2k), `canonical_tax_events` (398), `canonical_account_payments` (17k), `canonical_activities` (184k)
- Operativo MVs (refresh sp11/sp12 hourly): `canonical_sale_orders` (12k), `canonical_purchase_orders` (5.7k), `canonical_order_lines` (32k), `canonical_deliveries` (25k), `canonical_manufacturing` (5k)
- Append-only fact: `canonical_stock_moves` (1.64M, 853 MB) — espejo silver de `odoo_stock_moves` con `move_category` derivado

**Reconciliación + MDM:**
- `reconciliation_issues` (245k rows, 692 MB; retention 30d via pg_cron `recon_issues_retention_cleanup`)
- `mdm_manual_overrides` (audit/bridge)
- `source_links` (172k traceability links)
- `audit_runs` + `audit_tolerances` (invariantes config + history; retention 90d)

**MVs intermedias (refresh hourly via sp11/sp12):**
- `mv_entry_lines_flat` (308k, P&L drilldown)
- `mv_stock_move_account_matches` (350k, residual 501.01)
- `mv_bom_standard_cost`, `mv_mo_actual_material_cost` (BOM real cost)

**Legacy MVs (NO en convención canonical_*/mv_*, refresh `refresh-all-matviews` cada 2h):**
- `client_reorder_predictions`, `payment_predictions`, `cashflow_projection`
- `inventory_velocity`, `dead_stock_analysis`, `purchase_price_intelligence`
- `customer_product_matrix`, `accounting_anomalies`, `bom_duplicate_components`
- `ar_aging_detail`, `ops_delivery_health_weekly`, `journal_flow_profile`
- `product_real_cost`, `real_sale_price`

#### GOLD — vistas SQL no materializadas, evaluadas on-read

**9 vistas activas (todas con consumers y datos vivos):**
| Vista | Filas | Para |
|---|---|---|
| `gold_company_360` | 4,511 | Detalle por empresa (revenue, AR/AP, OTD, tier) |
| `gold_ceo_inbox` | 50 | Inbox priorizado (`reconciliation_issues` con context) |
| `gold_pl_statement` | 60 | P&L mensual (60 meses) |
| `gold_cashflow` | 1 | Snapshot cash + AR + AP |
| `gold_revenue_monthly` | 20,542 | Revenue mensual por empresa |
| `gold_balance_sheet` | 106 | Balance sheet por período |
| `gold_reconciliation_health` | 1 | Health score global recon |
| `gold_company_odoo_sat_drift` | 1,942 | Drift Odoo↔SAT por empresa |
| `gold_product_performance` | 6,016 | Ranking productos |
| `gold_sale_chain_trace` | 12,401 | SO → delivery → invoice → payment |

> **Audit 2026-04-29 — dropped 3 views sin consumers:** `v_mo_material_variance`, `gold_state_mismatch_watchlist`, `gold_inventory_valuation_drift_monthly`. Migration `20260429_drop_unused_gold_views.sql`.

### Pipelines de datos

1. **Odoo → Bronze** (qb19 addon, hourly push)
   - 24 tablas, último sync verificado 2026-04-28 19:48 UTC (todas <2h freshness, excepto `odoo_workorders` 24h por baja prioridad)
   - Bug `account_balances` 'tuple' fixeado en qb19 commit `ccec751c`
2. **SAT → Bronze** (Syntage webhook + pull-sync)
   - Real-time webhooks + nightly pull (`syntage/cron-daily` 5:00 AM)
   - Bug `matcher_payment` resuelto con stub (2026-04-28); webhook ya no falla
3. **Gmail → Bronze** (pipeline `sync-emails`, every 30 min)
4. **Bronze → Silver** (pg_cron + Bronze triggers)
   - Triggers `auto_link_*` en INSERT/UPDATE de bronze
   - `matcher_*()` family ejecutada cada 2h (`silver_sp3_matcher_all_pending`)
   - Refresh canonical aggregations cada 30min/45min
   - MVs canonical refresh cada 2h (`refresh-all-matviews`)
   - MVs sp11/sp12 refresh cada hora
5. **Silver → Reconciliation Issues** (pg_cron)
   - `silver_sp2_reconcile_hourly` (HH:05): invariantes con `cadence='hourly'`
   - `silver_sp2_reconcile_2h` (HH:15 every 2h): invariantes con `cadence='2h'`
   - `silver_sp4_reconcile_daily` (6:30 AM): invariantes daily
   - `silver_sp2_refresh_canonical_nightly` (3:30 AM): full refresh
   - 16+ invariantes activas (`audit_tolerances` controla cadence)
6. **Silver → Gold** (vistas evaluadas on-read, sin pg_cron — la "frescura" la limita el último refresh upstream)
7. **Gold → Frontend** (`src/lib/queries/**` con `unstable_cache` 60-300s para gold/canonical reads; uncached para fiscal/syntage webhook-driven)
8. **Frontend → Agentes → Insights** (orchestrate cada hora, 8 directores activos — ver sección "Agentes de IA")

### Health checks (estado verificado 2026-04-28 19:50 UTC)

- **Bronze ingest:** 0 errores en últimas 6h (vs 49 errores en 7d antes de fixes 28-abr)
- **Silver canonical:** todos los matchers corren, FKs validadas
- **Gold:** 12/12 vistas vivas devolviendo datos
- **pg_cron:** 15 jobs activos, todos con `active=true`
- **Recent warnings (6h):** 9 syntage_webhook (transient), 2 health_check, 1 odoo_push, 1 data_quality (no críticos)

---

## Mapeo Odoo → Supabase (campos)

### res.partner → `contacts` + `companies`

| Campo Odoo | Campo Supabase | Tabla | Notas |
|---|---|---|---|
| `id` | `odoo_partner_id` | contacts, companies | ID unico del partner |
| `name` | `name` / `canonical_name` | contacts / companies | canonical_name es lowercase para dedup |
| `email` | `email` | contacts | Puede tener multiples (separados por `;,`) |
| `vat` | `rfc` | companies | RFC fiscal mexicano |
| `customer_rank` | `is_customer` | contacts, companies | `> 0` = es cliente |
| `supplier_rank` | `is_supplier` | contacts, companies | `> 0` = es proveedor |
| `parent_id` | `company` (text) | contacts | Nombre de la empresa padre |
| `country_id.name` | `country` | companies | |
| `city` | `city` | companies | |
| `category_id` | — | — | Tags de Odoo, no sincronizados aun |
| `property_payment_term_id` | — | — | Terminos de pago, no sincronizados |
| `commercial_partner_id` | — | — | Se usa para resolver el partner comercial |

### product.product → `odoo_products`

| Campo Odoo | Campo Supabase | Notas |
|---|---|---|
| `id` | `odoo_product_id` | ID unico |
| `name` | `name` | Nombre largo del producto |
| `default_code` | `internal_ref` | **REFERENCIA INTERNA** — usar este para display (ej: WM4032OW152) |
| `categ_id.complete_name` | `category` | Ruta completa de categoria |
| `uom_id.name` | `uom` | Unidad de medida |
| `detailed_type` / `type` | `product_type` | Odoo 19 renombro `type` → `detailed_type` |
| `qty_available` | `stock_qty` | Stock on-hand |
| `free_qty` | — | Se usa para calcular `reserved_qty = qty_available - free_qty` |
| — | `reserved_qty` | Calculado: `qty_available - free_qty` |
| — | `available_qty` | Calculado: `stock_qty - reserved_qty` |
| `standard_price` | `standard_price` | Costo del producto |
| `lst_price` | `list_price` | Precio de lista (venta) |
| `active` | `active` | |
| `barcode` | `barcode` | |
| `weight` | `weight` | |

### sale.order → `odoo_sale_orders`

| Campo Odoo | Campo Supabase | Notas |
|---|---|---|
| `id` | `odoo_order_id` | |
| `name` | `name` | Ej: SO/2026/0001 |
| `partner_id.commercial_partner_id` | `odoo_partner_id` | Empresa comercial |
| `user_id.name` | `salesperson_name` | **Vendedor asignado** |
| `user_id.email` | `salesperson_email` | |
| `user_id.id` | `salesperson_user_id` | FK para routing de insights |
| `team_id.name` | `team_name` | Equipo de ventas |
| `amount_total` | `amount_total` | Con IVA |
| `amount_untaxed` | `amount_untaxed` | Sin IVA |
| `margin` | `margin` | Margen en MXN |
| — | `margin_percent` | Calculado: `margin / amount_untaxed * 100` |
| `currency_id.name` | `currency` | Default MXN |
| `state` | `state` | sale, done |
| `date_order` | `date_order` | |
| `commitment_date` | `commitment_date` | Fecha prometida |

### sale.order.line / purchase.order.line → `odoo_order_lines`

| Campo Odoo | Campo Supabase | Notas |
|---|---|---|
| `id` / `-id` | `odoo_line_id` | **Negativo para purchase** (evita collision) |
| `order_id.id` | `odoo_order_id` | |
| `order_id.partner_id` | `odoo_partner_id` | Empresa comercial |
| `product_id.id` | `odoo_product_id` | |
| `order_id.name` | `order_name` | Ej: SO/2026/0001 |
| `order_id.date_order` | `order_date` | |
| — | `order_type` | `sale` o `purchase` |
| `order_id.state` | `order_state` | |
| `product_id.name` | `product_name` | Nombre largo |
| `product_id.default_code` | `product_ref` | **REFERENCIA INTERNA** — usar para display |
| `product_uom_qty` | `qty` | Sale lines. Purchase usa `product_qty` con fallback |
| `price_unit` | `price_unit` | |
| `discount` | `discount` | % de descuento |
| `price_subtotal` | `subtotal` | |
| `currency_id.name` | `currency` | |

### account.move → `odoo_invoices`

| Campo Odoo | Campo Supabase | Notas |
|---|---|---|
| `partner_id.commercial_partner_id` | `odoo_partner_id` | |
| `name` | `name` | Ej: INV/2026/03/0173 |
| `move_type` | `move_type` | out_invoice, out_refund, in_invoice, in_refund |
| `amount_total` | `amount_total` | |
| `amount_residual` | `amount_residual` | Lo que falta por cobrar |
| `currency_id.name` | `currency` | |
| `invoice_date` | `invoice_date` | Fecha de factura |
| `invoice_date_due` | `due_date` | Fecha de vencimiento |
| `state` | `state` | posted |
| `payment_state` | `payment_state` | not_paid, partial, paid, in_payment |
| — | `days_overdue` | Calculado: `today - due_date` si vencida |
| `ref` | `ref` | Referencia libre |

### account.move.line → `odoo_invoice_lines`

| Campo Odoo | Campo Supabase | Notas |
|---|---|---|
| `id` | `odoo_line_id` | |
| `move_id.id` | `odoo_move_id` | |
| `move_id.partner_id` | `odoo_partner_id` | |
| `move_id.name` | `move_name` | |
| `move_id.move_type` | `move_type` | |
| `move_id.invoice_date` | `invoice_date` | |
| `product_id.id` | `odoo_product_id` | |
| `product_id.name` | `product_name` | |
| `product_id.default_code` | `product_ref` | **REFERENCIA INTERNA** |
| `quantity` | `quantity` | |
| `price_unit` | `price_unit` | |
| `discount` | `discount` | |
| `price_subtotal` | `price_subtotal` | |
| `price_total` | `price_total` | Con IVA |
| `display_type` | — | Se filtran: line_section, line_note, payment_term, tax, rounding |

### purchase.order → `odoo_purchase_orders`

| Campo Odoo | Campo Supabase | Notas |
|---|---|---|
| `id` | `odoo_order_id` | |
| `name` | `name` | Ej: P00123 |
| `partner_id.commercial_partner_id` | `odoo_partner_id` | |
| `user_id.name` | `buyer_name` | **Comprador asignado** |
| `user_id.email` | `buyer_email` | |
| `user_id.id` | `buyer_user_id` | FK para routing de insights |
| `amount_total` | `amount_total` | |
| `amount_untaxed` | `amount_untaxed` | |
| `currency_id.name` | `currency` | |
| `state` | `state` | purchase, done |
| `date_order` | `date_order` | |
| `date_approve` | `date_approve` | |

### stock.picking → `odoo_deliveries`

| Campo Odoo | Campo Supabase | Notas |
|---|---|---|
| `partner_id.commercial_partner_id` | `odoo_partner_id` | |
| `name` | `name` | Ej: TL/OUT/12781 |
| `picking_type_id.name` | `picking_type` | |
| `origin` | `origin` | Documento origen (SO) |
| `scheduled_date` | `scheduled_date` | |
| `date_done` | `date_done` | |
| `state` | `state` | draft, confirmed, assigned, done, cancel |
| — | `is_late` | Calculado: `state not done/cancel AND scheduled_date < now` |
| — | `lead_time_days` | Calculado: `(date_done - create_date) / 86400` |

### odoo_payments (extraido de account.move)

| Campo Odoo | Campo Supabase | Notas |
|---|---|---|
| `partner_id` | `odoo_partner_id` | |
| — | `name` | `PAY-{invoice.name}` |
| `move_type` | `payment_type` | inbound (out_invoice) / outbound |
| `amount_total - amount_residual` | `amount` | Monto pagado |
| `write_date` | `payment_date` | Proxy de fecha real de pago |
| — | `state` | posted |

### crm.lead → `odoo_crm_leads`

| Campo Odoo | Campo Supabase | Notas |
|---|---|---|
| `id` | `odoo_lead_id` | |
| `partner_id` | `odoo_partner_id` | |
| `name` | `name` | |
| `type` | `lead_type` | lead / opportunity |
| `stage_id.name` | `stage` | |
| `expected_revenue` | `expected_revenue` | |
| `probability` | `probability` | 0-100 |
| `date_deadline` | `date_deadline` | |
| — | `days_open` | Calculado: `now - create_date` |
| `user_id.name` | `assigned_user` | |

### mail.activity → `odoo_activities` (full refresh)

| Campo Odoo | Campo Supabase | Notas |
|---|---|---|
| — | `odoo_partner_id` | Resuelto via `res_model/res_id` → partner |
| `activity_type_id.name` | `activity_type` | |
| `summary` / `note` | `summary` | |
| `res_model` | `res_model` | |
| `res_id` | `res_id` | |
| `date_deadline` | `date_deadline` | |
| `user_id.name` | `assigned_to` | |
| — | `is_overdue` | Calculado: `date_deadline < today` |

### hr.employee → `odoo_employees`

| Campo Odoo | Campo Supabase | Notas |
|---|---|---|
| `id` | `odoo_employee_id` | |
| `user_id.id` | `odoo_user_id` | Link a odoo_users |
| `name` | `name` | |
| `work_email` | `work_email` | |
| `work_phone` / `mobile_phone` | `work_phone` | |
| `department_id.name` | `department_name` | |
| `department_id.id` | `department_id` | |
| `job_title` | `job_title` | |
| `job_id.name` | `job_name` | |
| `parent_id.name` | `manager_name` | |
| `parent_id.id` | `manager_id` | |
| `coach_id.name` | `coach_name` | |

### hr.department → `odoo_departments`

| Campo Odoo | Campo Supabase | Notas |
|---|---|---|
| `id` | `odoo_department_id` | |
| `name` | `name` | |
| `parent_id.name` | `parent_name` | |
| `parent_id.id` | `parent_id` | |
| `manager_id.name` | `manager_name` | |
| `manager_id.id` | `manager_id` | |
| `member_ids` | `member_count` | COUNT de miembros |

### res.users → `odoo_users`

| Campo Odoo | Campo Supabase | Notas |
|---|---|---|
| `id` | `odoo_user_id` | |
| `name` | `name` | |
| `email` / `login` | `email` | |
| hr.employee.`department_id.name` | `department` | Via employee map |
| hr.employee.`job_id.name` / `job_title` | `job_title` | |
| mail.activity count | `pending_activities_count` | Pre-calculado |
| mail.activity overdue count | `overdue_activities_count` | Pre-calculado |

### stock.warehouse.orderpoint → `odoo_orderpoints`

| Campo Odoo | Campo Supabase | Notas |
|---|---|---|
| `id` | `odoo_orderpoint_id` | |
| `product_id.id` | `odoo_product_id` | |
| `product_id.name` | `product_name` | |
| `warehouse_id.name` | `warehouse_name` | |
| `location_id.complete_name` | `location_name` | |
| `product_min_qty` | `product_min_qty` | Minimo para reorden |
| `product_max_qty` | `product_max_qty` | Maximo |
| `qty_to_order` | `qty_to_order` | |
| `product_id.qty_available` | `qty_on_hand` | Stock actual |
| `product_id.virtual_available` | `qty_forecast` | Stock pronosticado |
| `trigger` | `trigger_type` | auto / manual |

### Convenciones de nombres

- **`odoo_*_id`** — ID del registro en Odoo (para dedup y cross-reference)
- **`company_id`** — FK a `companies.id` en Supabase (auto-linked por triggers)
- **`odoo_partner_id`** — FK al partner comercial en Odoo (se usa para resolver `company_id`)
- **`product_name`** — Nombre largo del producto en Odoo
- **`product_ref`** / **`internal_ref`** — `default_code` de Odoo = **REFERENCIA INTERNA** (preferir para display)
- **`synced_at`** — Timestamp de la ultima sincronizacion

5. **CEO → Feedback → Learning** (cada 4h)
   - CEO actua o descarta insights
   - Learning pipeline convierte feedback en memorias
   - Agentes mejoran con cada ciclo

---

## Crons (Vercel)

| Frecuencia | Endpoint | Que hace |
|---|---|---|
| */30 min | /api/cycle/run?type=quick | Extract → Heal → Validate |
| */15 min | /api/agents/orchestrate | Ejecuta 1 agente (round-robin) |
| */30 min | /api/agents/auto-fix | Repara datos rotos automaticamente |
| */30 min | /api/agents/validate | Limpia insights stale + deduplica |
| */4h | /api/agents/learn | Feedback → memorias |
| */6h | /api/pipeline/health-scores | Recalcula scores de contactos |
| 6:00am | /api/agents/evolve | Schema improvements via Claude |
| 6:30am | /api/pipeline/briefing | Briefing diario CEO |

---

## Agentes de IA — 8 Directores activos

Round-robin via `/api/agents/orchestrate` (Vercel cron, hourly). Cada director
corre con Sonnet 4.6, max 5 insights por corrida, confianza ≥80%, dedup por
(agent + company + título) en ventana 7d.

### Directores activos (vivos en `ai_agents` con `is_active=true`)

| Slug | Nombre | Dominio | Que analiza |
|---|---|---|---|
| **comercial** | Director Comercial | comercial | Reorden risk, top clientes, márgenes, concentración, CRM, churn LTV, RFM |
| **financiero** | Director Financiero | financiero | Cobranza vencida, payment predictions, runway, FX exposure, working capital |
| **operaciones** | Director de Operaciones | operaciones_dir | OTD, entregas tardías, manufactura, inventario, stockouts, orderpoints |
| **compras** | Director de Compras | compras | Proveedores top, single-source, price anomalies, urgent stockouts |
| **costos** | Director de Costos | costos | COGS contable vs BOM, normalización P&L, margen contributivo, overhead |
| **riesgo** | Director de Riesgo | riesgo_dir | Concentración cliente, contactos críticos, riesgo cartera, drift |
| **equipo** | Director de Equipo | equipo_dir | Backlog por persona, métricas equipo, actividades pendientes/vencidas |
| **compliance** | Director Cumplimiento Fiscal | compliance | CFDIs sin respaldo, declaraciones, blacklist 69-B, opinión cumplimiento |

### Agentes legacy (deactivated 2026-04-05, conservados en DB con `is_active=false`)

`sales`, `finance`, `operations`, `risk`, `growth`, `meta`, `data_quality`,
`odoo`, `cleanup`, `relationships`, `suppliers`, `predictive` — quedaron en
la tabla por compatibilidad histórica pero no se ejecutan. La orquestación
real son los 8 directores. **NO usar estos slugs** al hablar del sistema vivo.

---

## Routing de Insights

Cada insight se asigna automaticamente a un responsable via trigger.
Los patrones son regex sobre `category` (case-insensitive); el primero que
coincide gana (priority asc).

| Patrón categoría | Departamento | Responsable |
|---|---|---|
| `payment\|factura\|cobr\|cartera\|credito\|overdue` | Cobranza | Sandra Dávila |
| `ventas\|sales\|crm\|lead\|oportunidad\|upsell\|cross-sell\|churn\|revenue` | Ventas | Guadalupe Guerrero García |
| `relationship\|comunicacion\|sentimiento\|contact\|engagement` | Ventas | Guadalupe Guerrero García |
| `operations\|entrega\|delivery\|despacho\|logistic\|envio` | Logística | Dario Manriquez |
| `manufactura\|produccion\|operaciones\|mrp\|linea\|paro` | Producción | Guadalupe Ramos |
| `stock\|inventario\|almacen\|desabasto\|reorder\|warehouse` | Almacén | Gustavo Delgado |
| `calidad\|quality\|inflamabilidad\|muestra\|prueba` | Calidad | Oscar Gonzalez |
| `compra\|purchase\|proveedor\|supplier\|materia.prima\|cadena.suministro` | Compras | Elena Delgado Ruiz |
| `innovacion\|desarrollo\|diseño\|producto.nuevo` | Innovación | Jessica Francisco |
| `planeacion\|forecast\|capacidad` | Planeación | Paris César Villordo |
| `employee\|empleado\|rh\|nomina\|hr\|team\|equipo` | RH | Miguel Medina |
| `sistema\|data\|datos\|schema\|pipeline\|agente\|tech` | Sistemas | Mariano Dominguez |
| `growth\|crecimiento\|expansion\|mercado\|estrateg` | Dirección | Jose J. Mizrahi |
| `risk\|riesgo\|amenaza\|concentracion` | Dirección | Jose J. Mizrahi |

Configurado en tabla `insight_routing` (columna `category_pattern` regex)
→ `departments` → `odoo_users` (todo por FK, no texto). Para añadir/cambiar,
INSERT/UPDATE en `insight_routing` — el trigger `route_insight` corre on
INSERT en `agent_insights`.

---

## Self-improvement (auto-mejora)

### Feedback Loop
1. CEO actua o descarta insight → señal positiva/negativa
2. Learning pipeline analiza feedback por agente + tipo + severidad
3. Crea memorias: "CEO actua en riesgos financieros 90% del tiempo"
4. Memorias se cargan en la siguiente corrida del agente
5. Agente mejora sus prompts basado en memorias

### Auto-fix (cada 30 min)
- Linkea emails a contactos/empresas
- Resuelve entity_ids
- Llena nombres de contactos
- Deduplica empresas/entidades
- Cierra insights que ya se resolvieron

### Auto-validate (cada 30 min)
- Verifica insights contra datos actuales de Odoo
- Factura pagada → insight auto-resuelto
- Entrega completada → insight auto-resuelto
- Contacto respondio → insight auto-resuelto
- Insight >7 dias → auto-expirado

### Schema Evolution (diario, 6am)
- Claude analiza problemas de datos
- Genera SQL seguro (CREATE TABLE, ADD COLUMN, CREATE INDEX)
- `execute_safe_ddl()` valida contra allowlist
- NUNCA: DROP, TRUNCATE, DELETE sin WHERE
- Todo loggeado en `schema_changes`

---

## Base de datos (Supabase)

> **2026-04-22 (SP1):** 18 objetos dropeados (8 views + 5 MVs + 5 tables). Ver `docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md`. SP2+ construye `canonical_*` tables como sucesores.

### Silver Canonical Tables (SP2 — 2026-04-22)

Pattern A dual-source canonical layer for reconciliation Odoo↔SAT.

| Tabla | Rows | Purpose |
|---|---|---|
| `canonical_invoices` | ~88k | Golden invoice record; SP3 MDM adds canonical_companies FK |
| `canonical_payments` | ~43k | Golden payment (Odoo bank + SAT complementos) |
| `canonical_payment_allocations` | ~25k | Payment→invoice links (SAT doctos_relacionados) |
| `canonical_credit_notes` | ~2.2k | Egresos (E / out_refund / in_refund) |
| `canonical_tax_events` | ~400 | Retentions + returns + electronic_accounting (Odoo match SP4) |
| `mdm_manual_overrides` | 20 | Unified bridge table; replaces invoice_bridge_manual, payment_bridge_manual, products_fiscal_map |

**Reconciliation runtime:**
- `run_reconciliation(key text DEFAULT NULL)` — runs enabled invariantes
- `compute_priority_scores()` — updates `reconciliation_issues.priority_score`
- pg_cron: `silver_sp2_reconcile_hourly` (HH:05), `silver_sp2_reconcile_2h` (HH:15 /2h), `silver_sp2_refresh_canonical_nightly` (03:30)

**16 active invariantes:** invoice.{amount_mismatch, state_mismatch_posted_cancelled, state_mismatch_cancel_vigente, date_drift, pending_operationalization, missing_sat_timbrado, posted_without_uuid, credit_note_orphan}, payment.{registered_without_complement, complement_without_payment}, plus 6 additional registered by tasks.

**SP3 done (2026-04-23):** canonical_companies (4,359 rows / 2,162 shadows) + canonical_contacts (2,063) + canonical_products (6,004) + MDM matchers + FK backfill. Pattern A tables FKs validated (6). See section below.

**SP4 next:** Pattern B MVs (orders/deliveries/inventory), evidence layer, 31-invariant engine cutover, gold views.

### Silver MDM (SP3 — 2026-04-23)

Pattern C master data management layer:

| Tabla | Rows | Purpose |
|---|---|---|
| `canonical_companies` | ~4,359 (2,197 Odoo + ~2,162 shadows) | Golden company record. Quimibond self = id=868 |
| `canonical_contacts` | ~2,063 | Golden contact (email UNIQUE case-insensitive) |
| `canonical_products` | ~6,004 | Golden product (internal_ref UNIQUE) |
| `canonical_employees` | ~179 | View over canonical_contacts for internal_* types |
| `source_links` | ~172k+ | Traceability: {canonical_entity, source, source_id} links |
| `mdm_manual_overrides` | extended | action/source_link_id/payload/expires_at/is_active/revoke_reason per §6.4 |

**Matcher functions (pg_cron 2h + Bronze triggers):**
- `matcher_company(rfc, name, domain, autocreate_shadow)` — deterministic tie-break (prefer is_internal > !shadow > lowest id)
- `matcher_contact(email, name, domain)` — email exact > domain
- `matcher_product(internal_ref, name)` — ref exact > fuzzy name
- `matcher_all_pending()` — pg_cron silver_sp3_matcher_all_pending (HH:35 /2h)
- `matcher_company_if_new_rfc(e_rfc, e_name, r_rfc, r_name)` — Bronze trigger on syntage_invoices
- `matcher_invoice_quick(uuid)` — fast FK resolution for newly-stamped invoices

**Manual override functions:**
- `mdm_merge_companies(a, b, user, note)` — merge two canonical_companies, re-point FKs
- `mdm_link_invoice(canonical_id, sat_uuid, odoo_id, user, note)` — manual SAT↔Odoo link
- `mdm_revoke_override(override_id, user, reason)` — reverse manual override

**FK structure (post-SP3):**
- canonical_invoices: `emisor_canonical_company_id`, `receptor_canonical_company_id` → canonical_companies; `salesperson_contact_id` → canonical_contacts.
- canonical_payments: `counterparty_canonical_company_id` → canonical_companies.
- canonical_credit_notes: `emisor_canonical_company_id`, `receptor_canonical_company_id` → canonical_companies.

**Bronze auto-match triggers:**
- `trg_cc_from_odoo` on `companies` INSERT/UPDATE → auto-create canonical_companies
- `trg_sat_invoice_matcher` on `syntage_invoices` INSERT → shadow RFC creation via matcher_company_if_new_rfc
- Plus the 3 canonical_contacts triggers from Task 6 (odoo_users, odoo_employees, contacts)
- Plus the canonical_products trigger from Task 9 (odoo_products)
- Plus the 3 source_links triggers from Task 13 (canonical_companies/contacts/products)

**SP4 next:** Pattern B MVs (orders/deliveries/inventory), evidence layer (email_signals/ai_extracted_facts/attachments/manual_notes), 31-invariante engine cutover, gold views.

**Known dead bridges in current data (future data-quality work):**
- `odoo_account_payments.ref` 100% empty → num_operacion match = 0 rows
- `odoo_chart_of_accounts` ISR retenido uses `113.%` and `213.%` prefixes (not `216%` as plan assumed)

### Tablas principales

**Core:**
- `companies` — Empresas (canonical_name lowercase, dedup trigger)
- `contacts` — Contactos (email lowercase, entity_id linked)
- `departments` — Departamentos con lead responsable

**Communication:**
- `emails` — Emails de Gmail (kg_processed flag)
- `threads` — Hilos de conversacion
- `email_recipients` — Destinatarios

**Knowledge Graph:**
- `entities` — Personas, empresas, productos (canonical_name lowercase)
- `facts` — Hechos verificables con confianza
- `entity_relationships` — Relaciones entre entidades

**Intelligence:**
- `agent_insights` — Insights generados por agentes (con company_id, contact_id, assignee FK)
- `agent_runs` — Historial de ejecuciones
- `agent_memory` — Memorias persistentes entre corridas
- `ai_agents` — Definiciones de agentes

**Odoo:**
- `odoo_users`, `odoo_employees`, `odoo_departments`
- `odoo_products`, `odoo_invoices`, `odoo_invoice_lines`, `odoo_payments`
- `odoo_account_payments`, `odoo_chart_of_accounts`, `odoo_account_balances`, `odoo_bank_balances`
- `odoo_order_lines`, `odoo_sale_orders`, `odoo_purchase_orders`
- `odoo_deliveries`, `odoo_crm_leads`, `odoo_activities`
- `odoo_manufacturing`, `odoo_orderpoints`
- `cfdi_documents` — CFDIs parseados de email XML (tipo I/N/P, con UUID para cruce)

**Puente op↔fiscal (Fase 2.5):**
- `invoice_bridge_manual` — Reconciliaciones manuales Odoo↔SAT por operador
- `payment_bridge_manual` — Reconciliaciones manuales de pagos Odoo↔SAT
- `products_fiscal_map` — Mapping producto Odoo → clave SAT/UNSPSC (seeded top 20 SKUs)

**Metrics:**
- `health_scores` — Scores calculados por contacto
- `employee_metrics`, `department_metrics`
- `company_behavior`

**System:**
- `pipeline_logs` — Log de todas las operaciones
- `schema_changes` — Audit trail de cambios de schema
- `odoo_models_catalog` — Catalogo de modelos Odoo (synced vs not)
- `insight_routing` — Reglas de routing por departamento

### Triggers automaticos

| Trigger | Tabla | Que hace |
|---|---|---|
| `normalize_company_name` | companies | Fuerza lowercase, previene duplicados |
| `normalize_entity_name` | entities | Fuerza lowercase |
| `normalize_contact_email` | contacts | Fuerza lowercase |
| `auto_link_invoice_company` | odoo_invoices | Linkea company_id por odoo_partner_id |
| `auto_link_order_company` | odoo_order_lines | Linkea company_id |
| `auto_link_delivery_company` | odoo_deliveries | Linkea company_id |
| `auto_link_contact_entity` | contacts | Linkea entity_id por email |
| `auto_link_company_entity` | companies | Linkea entity_id por odoo_id o nombre |
| `route_insight` | agent_insights | Asigna responsable por departamento |
| `trg_link_sale_order` | odoo_sale_orders | Linkea company_id |
| `trg_link_purchase_order` | odoo_purchase_orders | Linkea company_id |

### RPCs

| Funcion | Que hace |
|---|---|
| `execute_safe_ddl()` | Ejecuta SQL seguro con allowlist |
| `deduplicate_all()` | Merge duplicados de empresas y entidades |
| `link_orphan_insights()` | Linkea insights a empresas por nombre |
| `fix_all_company_links()` | Linkea invoices/orders a empresas |
| `resolve_company_by_name()` | Fuzzy match de empresa |
| `get_agents_overview()` | Dashboard de agentes |
| `get_employee_dashboard()` | Metricas de empleados |
| `get_department_comparison()` | Comparacion de departamentos |
| `cashflow_runway()` | Alerta de cash flow: dias hasta que no alcanza para nomina |
| `reconcile_invoice_manually()` | Crea entrada en invoice_bridge_manual para link Odoo↔SAT manual |
| `reconcile_payment_manually()` | Crea entrada en payment_bridge_manual para pago Odoo↔SAT manual |
| `match_unlinked_invoices_by_composite()` | Diagnóstico: retorna invoices sin UUID match para reconciliación manual |

---

## Frontend (Next.js 15)

### Paginas

| Ruta | Descripcion |
|---|---|
| `/inbox` | Inbox de insights — desktop: lista, mobile: swipe Tinder |
| `/inbox/insight/[id]` | Detalle con trazabilidad hasta email original |
| `/dashboard` | Centro de control con KPIs, agentes, equipo |
| `/agents` | 8 directores activos con status, insights, boton ejecutar |
| `/companies` | Lista de empresas con filtros |
| `/companies/[id]` | Detalle con 10 tabs |
| `/contacts` | Lista con health score visual |
| `/contacts/[id]` | Detalle con 7 tabs |
| `/employees` | Empleados con metricas de acciones |
| `/departments` | Areas con KPIs y responsables |
| `/emails` | Lista de emails |
| `/threads` | Hilos con urgencia |
| `/briefings` | Briefings diarios |
| `/chat` | Chat RAG con Claude |
| `/knowledge` | Browser del Knowledge Graph |
| `/system` | Ciclos, pipeline, Odoo sync, token usage |
| `/sistema/odoo-pendientes` | Registro central de fixes pendientes en Odoo (con problema, fix concreto, workaround actual, impacto estimado, dueño). Cada acción tiene `action_key` slug; banners inline en páginas relevantes referencian ese key. |
| `/reporte` | Index de reportes mensuales (selector de mes) |
| `/reporte/[YYYY-MM]` | Reporte mensual de cierre con CFO sintetizado por Claude (Opus 4.7), drivers MoM, one-offs detectados, recomendaciones priorizadas. Imprimible / exportable a PDF |

### API Routes

| Ruta | Metodo | Descripcion |
|---|---|---|
| `/api/cycle/run` | GET | Ciclo rapido (extract → heal → validate) |
| `/api/agents/orchestrate` | GET/POST | Ejecuta 1 agente (round-robin) |
| `/api/agents/run` | POST | Ejecuta agente especifico |
| `/api/agents/auto-fix` | GET/POST | Repara datos automaticamente |
| `/api/agents/validate` | GET/POST | Valida insights contra Odoo |
| `/api/agents/learn` | GET/POST | Feedback → memorias |
| `/api/agents/evolve` | GET/POST | Schema evolution con Claude |
| `/api/pipeline/analyze` | GET/POST | Procesa 1 cuenta de email |
| `/api/pipeline/health-scores` | GET/POST | Recalcula scores |
| `/api/pipeline/briefing` | GET/POST | Genera briefing diario |
| `/api/pipeline/embeddings` | GET/POST | Vectores pgvector |
| `/api/pipeline/reconcile` | GET/POST | Auto-cierra acciones resueltas |
| `/api/pipeline/sync-emails` | GET/POST | Sync Gmail |
| `/api/chat` | POST | Chat RAG con Claude |
| `/api/enrich/company` | POST | Enriquecer empresa con IA |
| `/api/enrich/contact` | POST | Enriquecer contacto con IA |

---

## /finanzas — P&L limpio (régimen AVCO + variable costing implícito)

Quimibond-específico. La sección P&L de `/finanzas` muestra **dos vistas**:
P&L contable (lo que dice Odoo, AVCO al despacho) y P&L limpio (régimen
actual con MP separada de MOD+overhead).

### Régimen contable real (confirmado con CEO 2026-05-04)

- **Valuación de inventario: AVCO** (Average Cost), NO Standard.
- **Workcenters: solo TEJIDO CIRCULAR** (40 máquinas, $74.57/hr) configurado,
  go-live MAYO 2026. Acabado, Tintorería, Entretelas, Inspección/Empaque
  NO tienen workcenter → MOD+OH NO se absorbe al PT al producirse.
- **Resultado: variable costing implícito.** El PT en almacén carga solo
  MP via AVCO; MOD+OH viven en gastos del período (501.06 + 504.01).
- **Pre-1-abril-2026: BOMs incluían MOD+gastos como componentes** vía
  productos token RSI56. Esto absorbía MOD+OH al PT al producirse y se
  ajustaba mensualmente con CAPA. **Esos productos fueron archivados el
  1-abr-2026** → ya no se hace ajuste mensual.
- **501.01.01 ya NO está "inflado por CAPA"** — es el COGS real AVCO al
  despacho. Si hay gap vs BOM-recursivo, es por contaminación AVCO
  histórica del PT (pre-abril) o régimen actual sin absorción.

Ver pending action `pnl-limpio-rewrite-avco-regimen` y
`revaluar-inventario-pt-contaminacion-avco` (~$6.34M de PT contaminado).

### El "P&L limpio" como reformulación, no como fix

Antes (premisa incorrecta): "swap 501.01.01 por BOM-recursivo para
quitar CAPA duplicada". **Esa premisa quedó obsoleta** — el swap ya no
"limpia" un bug; **reformula** el COGS a "qué costaría con la estructura
de BOMs nueva (sólo MP) sin contaminación AVCO histórica".

Para cada producto vendido en el período:
1. Tomar la BOM activa (recursiva — bajamos todos los niveles).
2. Para hojas (MP comprada): `qty × avg_cost_mxn` de canonical_products.
3. Para importados (sufijo " I"): short-circuit a `avg_cost_mxn` directo
   (ya incluye flete/aduana/agente vía AVCO de compras).
4. Multiplicar por la cantidad vendida (out_invoice − out_refund).

El **costo primo BOM** es solo MP. MOD y overhead se reportan APARTE
por departamento usando los 3 RPCs nuevos:

- `get_nomina_by_cost_center(p_period)` — parsea NOMINAS journal `ref`
  para asignar 501.06 a TEJIDO/ACABADO/TINTORERIA/etc.
- `get_overhead_by_cost_center(p_period)` — prorratea 504.01 según
  `overhead_account_assignment` (luz→TEJIDO, gas→ACABADO, agua→TINT,
  agujados→TEJIDO) y `rent_lot_assignment` (4 lotes).
- `get_production_by_cost_center(p_period)` — qty producida por proceso
  para calcular burden rate por unidad.

| Cuenta | Concepto | P&L contable | P&L limpio |
|---|---|---|---|
| `501.01.01` | COGS AVCO al despacho | Como está | **Reemplazado por** BOM-recursivo MP |
| `501.01.02` | COSTO PRIMO (cierre, ya inactivo post-abril) | Como está | Como está |
| `501.01.08` | DIFERENCIAS POR CONTEO (shrinkage físico) | Como está | Como está |
| `501.06.*` | MOD por departamento | Línea aparte | Línea aparte (con split por depto) |
| `502.*` | Compras de importación | Línea aparte | Línea aparte |
| `504.01.*` (excl. 0008) | Overhead fábrica | Línea aparte | Línea aparte (con split por depto) |
| `504.08-23` | Depreciación fábrica | Línea aparte | Línea aparte |
| `6xx + 613` | Gastos operativos (admin, ventas) | Línea aparte | Línea aparte |
| `7xx` | Otros ingresos / gastos | Después de EBIT | Después de EBIT |

### Estructura del P&L (contable + limpio, alineada a Odoo)

Ambas vistas usan la misma estructura del Estado de Resultados de Odoo,
para que cualquier subtotal cuadre con el reporte oficial. Solo difieren
en la fila de 501.01.01:

```
Ventas de producto (4xx)
− Costo de ingresos:
    501.01.01 AVCO  /  Costo primo BOM-recursivo   ← reformulación
  + 501.01.02 COSTO PRIMO (residual cierre)
  + 501.01.08 DIFERENCIAS POR CONTEO
  + Mano de obra directa (501.06)         [splittable por depto]
  + Compras de importación (502)
  + Overhead fábrica (504.01)              [splittable por depto]
= Ganancia bruta
− Gasto de operación (6xx, sin dep CORPO)
= Ingreso de operación (EBIT)
+ Otros ingresos (7xx + 503 + 899: FX, intereses, venta activo)
− Depreciación (504.08-23 fábrica + 613 CORPO)
= UTILIDAD NETA
```

El **margen contributivo material** (= ventas − costo primo BOM) sigue
existiendo como KPI dedicado en la fila 2 de `/contabilidad`, pero no
como subtotal dentro de la tabla.

### Validación: residual 501.01.01 vs BOM

El P&L limpio muestra la fila **`Δ vs P&L contable`** que prueba que
cuadra. La fórmula:

```
residual_501.01.01 = cogs501_01_01_actual − costoPrimo_BOM
neta_limpia − neta_contable == residual_501.01.01   (exacto)
```

Interpretación correcta (ya NO "CAPA inflada"):
- `residual > 0`: AVCO al despacho > BOM puro. Causa: contaminación AVCO
  histórica del PT (MOD+gastos absorbidos pre-abril) + costo MP real
  diferente al avg_cost canonical (precios MP cambiaron).
- `residual < 0`: AVCO < BOM. Raro; puede pasar si el PT viejo se vendió
  a costo histórico bajo y MP nueva está cara.
- `residual ≈ 0`: BOM y AVCO alineados — régimen estable.

### Otras secciones del P&L

Encima de PnlLimpioTable hay otras dos cards que viven en el mismo bloque:

- **PnlNormalizedCard**: detecta one-offs y ajustes year-end vía RPC
  `get_pnl_normalization_adjustments`. Categorías: venta_activo_fijo,
  siniestros_incobrables, otros_ingresos_extraordinarios,
  ajuste_inventario_year_end (501.01.02 atípico),
  depreciacion_catch_up (504.08-23 atípico). Calcula
  `utilidad_normalizada = utilidad_reportada + Σ impactos detectados`.
- **BreakEvenCard**: ventas para break-even = gastos_fijos / margen_contributivo_pct.

### Archivos

| Archivo | Qué hace |
|---|---|
| `src/lib/queries/sp13/finanzas/pnl.ts` | KPIs P&L (ventas, utilidad bruta/neta, gastos op por categoría) |
| `src/lib/queries/sp13/finanzas/cogs-adjusted.ts` | Compara COGS contable vs BOM recursiva |
| `src/lib/queries/sp13/finanzas/cogs-monthly.ts` | Serie histórica mensual con cache (`cogs_monthly_cache`) |
| `src/lib/queries/sp13/finanzas/cogs-per-product.ts` | Top productos vendidos con desglose BOM |
| `src/lib/queries/sp13/finanzas/mp-quality.ts` | % MP con avg_cost, top productos, BOM completeness |
| `src/lib/queries/sp13/finanzas/pnl-normalized.ts` | One-offs detectados + utilidad normalizada |
| `src/app/finanzas/page.tsx` (PnlLimpioTable) | Render de la tabla |

### RPCs silver

- `get_cogs_recursive_mp(date_from, date_to)` — costo primo recursivo
- `_compute_cogs_comparison_monthly` — backfill del cache mensual
- `refresh_cogs_monthly_cache` — refresh disparado por Vercel cron
- `get_pnl_normalization_adjustments(date_from, date_to)` — one-offs

### Boundary fix YTD

Las funciones silver usaban `period < to_char(p_date_to, 'YYYY-MM')`,
que para YTD parcial (e.g. `to=2026-04-25`) excluía abril. Fix:
`period <= to_char((p_date_to - 1 day)::date, 'YYYY-MM')`. Ver
migration `20260424_cogs_monthly_cache_boundary_fix.sql`.

### Pending actions Odoo (2026-05-04)

Cuando el sistema descubre un problema cuya causa raíz está en la
configuración de Odoo (no se puede arreglar 100% en silver), se registra
en `odoo_pending_actions` con:

- `action_key` (slug estable para vincular desde código)
- `area`, `severity`, `title`
- `problem_description` (qué pasa hoy)
- `fix_in_odoo` (pasos concretos)
- `workaround_in_silver` (qué hace el sistema mientras tanto)
- `estimated_impact_mxn` por mes
- `evidence_url` (donde el CEO ve la evidencia)
- `status` (open/in_progress/resolved/wont_fix), `assignee`

**Componente**: `<OdooPendingBanner actionKey="..." />` muestra el banner
inline con ribbon de severidad + link al detalle. Si la acción está
resuelta o no existe, no renderiza nada (safe).

**Página central**: `/sistema/odoo-pendientes` con todas las acciones
agrupadas por status, severidad pillada, fix step-by-step expandido.

**Pattern**: cuando descubras un problema Odoo en una nueva auditoría,
INSERT en `odoo_pending_actions` (idempotente por action_key UNIQUE)
y agrega `<OdooPendingBanner actionKey="tu-slug" />` en la página
donde es relevante.

### Subcuentas 501.01: split en 3 buckets (2026-05-04 audit)

La cuenta contable 501.01 tiene **3 subcuentas distintas**, no una sola.
Tratarlas como bucket único mezclaba 3 conceptos diferentes:

| Subcuenta | Naturaleza | Tratamiento limpio |
|---|---|---|
| **501.01.01 Cost of sales** | COGS AVCO al despacho (incluye contaminación AVCO histórica pre-abril) | **Reemplazado por** costo primo BOM-recursivo |
| **501.01.02 COSTO PRIMO** | Cuenta de cierre histórica para CAPA mensual (RSI56 archivado 1-abr-2026 → ya casi vacía) | NO se quita — vive en contable Y limpio |
| **501.01.08 DIFERENCIAS POR CONTEO** | Shrinkage físico (faltantes, scrap, errores conteo) | NO se quita — pérdida real visible |

**El residual MP real** = `501.01.01 − costoPrimo BOM`. Es lo que
`getPnlKpis` reporta vía `cogs501_01_01Mxn`. Refleja contaminación AVCO
histórica + diferencias de costo MP real vs canonical.avg_cost.

`PnlComparisonTable` muestra cada subcuenta como línea separada cuando
no es cero. Si shrinkage (501.01.08) > $200k, se anota como atípico
(abril 2026 fue $379k — investigar inventario).

**Trend 501.01.08 (Quimibond 2026):**
- Ene: −$11k (ajuste pequeño)
- Feb: +$4k
- Mar: +$62k
- Abr: **+$379k** (35× el promedio histórico)

Crecimiento exponencial = señal operativa de inventario que necesita
atención: faltantes físicos, scrap no documentado, o errores de captura
en conteos.

### Productos importados ("I") y notas de crédito (2026-05-04)

Migration `20260504_pnl_limpio_imports_and_refunds_fix.sql` corrige dos
asimetrías del COGS BOM-recursivo:

1. **Importados — sufijo " I":** 119 SKUs marcados como import (terminan
   en " I" en `internal_ref`). 89 de ellos tienen BOM activa, pero la
   BOM sólo refleja el costo del proveedor extranjero + un componente
   token "GASTOS IND DE IMPORTACIÓN". Flete/aduana/agente sólo viven
   en `avg_cost_mxn` (Odoo moving-average de las compras). Por eso el
   BOM-recursivo subestimaba ~13% el costo (ej. WM4032NG152 I:
   BOM=$4.55 vs avg_cost=$7.51).
   **Fix:** `get_bom_raw_material_cost_per_unit` hace short-circuit y
   retorna `avg_cost_mxn` directo cuando `internal_ref ~ ' ?I$'`.

2. **Notas de crédito (out_refund):** revenue 4xx ya viene neto (las
   NCs ajustan el saldo contable), pero el COGS recursivo sólo sumaba
   `out_invoice` y nunca restaba devoluciones. Asimetría → COGS
   sobreestimado por el costo de mercancía devuelta.
   **Fix:** `get_cogs_recursive_mp` ahora UNIONa `out_refund` con qty
   negativa, dedupado por (move, product, qty_abs, kind) para no
   mezclar facturas y NCs del mismo producto.

**Lepezo sale-leaseback:** la "venta" de la rama ICOMATEX a Leasing
Lepezo en marzo 2026 ($11.35M factura INV/2026/03/0173) fue un
**leaseback financiero**, no una venta real. Trazas en libros:
- 252.01.0004 PRESTAMOS BANCARIOS LEPEZO: +$12M en mar (pasivo LP)
- 252.01.0001 PRESTAMOS BANCA MIFEL: −$1.97M en mar (refinanció Mifel)
- 704.23.0003 UTILIDAD VENTA ACTIVO: −$574k (gain contable one-off)
- 704.23.0001 OTROS INGRESOS: −$1.50M en mar (vs ~$0 normal)
- **701.11.0001 ARRENDAMIENTO FINANCIERO: $1.08M/mes recurrente** (era
  $525k pre-leaseback; subió a $1.08M en mar y se mantiene en abr)
- La rama sigue operativa en Quimibond; el "ingreso" fue financiamiento
  con la rama como garantía.

`get_pnl_normalization_adjustments` ya detecta los one-offs de marzo:
- `venta_activo_fijo` ($574k impacto)
- `otros_ingresos_extraordinarios` ($1.50M, threshold >$500k)

Marzo normalizado: 1,29M reportado − 2,07M one-offs = **−0,78M
(comparable apples-to-apples con abril −0,98M)**.

### Subproductos (SALDO/DESPERDICIO) = costo MP $0 (2026-06-02)

Migration `20260602_byproduct_saldo_zero_cost.sql` elimina el doble conteo
de MP en subproductos:

- **Problema**: los productos `SALDO*` nacen como subproducto de las mismas
  MOs que el producto principal (verificado en canonical_stock_moves:
  produccion_pt con valor asignado). Su MP ya está en la receta BOM del
  producto principal. El modelo BOM-recursivo les cobraba además su
  `avg_cost_mxn` (fallback de leaf sin BOM) → la misma MP contada 2 veces.
  Doble conteo 2025: **$4.50M** (7.6% del costo MP). Generaba márgenes
  falsos de −1,537%.
- **Regla**: la MP se cobra UNA sola vez (en la BOM del producto principal).
  Subproductos y desperdicios → costo MP $0. Su venta es recuperación pura
  de margen.
- **Mecánica**: `canonical_products.is_byproduct` (backfill por patrón
  `^(SALDO|DESPERDICIO)`) + short-circuit en
  `get_bom_raw_material_cost_per_unit` (también en hojas del árbol BOM).
  Cache source `byproduct_zero`. Flag `subproducto_costo_cero` en
  `get_cogs_per_product`.
- **El contable NO cambia**: el cost-share de Odoo a subproductos es
  correcto en AVCO (reduce el costo del producto principal). La asimetría
  contable-vs-BOM queda visible en la fila "Δ vs P&L contable".
- **Costo MP 2025 corregido**: $59.15M → **$54.65M** (margen contributivo
  MP ~67.5% → ~70%).
- Si Quimibond crea subproductos con otro naming, marcar
  `is_byproduct = true` manualmente en canonical_products.

### IEPS triplet (productos con tabaco/alcohol — N/A para textil pero
documentado por completitud):
Algunas líneas en odoo_invoice_lines vienen como triplet
(lista+, descuento−, neta+). Para qty: `DISTINCT ON (line_id)`. Para
revenue: sum de las 3 líneas (cancelan aritméticamente). Sin esto, qty
o revenue se cuentan 2x.

### IMPORTANTE para futuras sesiones

- **NO es un "bug de CAPA duplicada"**: la premisa antigua (Standard
  valuation con CAPA inflando 501.01.01) era incorrecta. Quimibond usa
  AVCO. El P&L limpio es una **reformulación**, no un fix — muestra qué
  pasaría con la estructura de BOMs nueva (post-1-abril, solo MP) si no
  hubiera contaminación AVCO histórica del PT.
- **No mezclar 501.01.01 AVCO con BOM-MP**: son conceptos distintos.
  501.01.01 = AVCO al despacho (incluye MOD+OH absorbido pre-abril del
  PT viejo). costoPrimo BOM = qué costaría con BOMs actuales (sólo MP).
  La diferencia es contaminación + drift de precios MP, no un bug.
- **MOD y overhead se reportan APARTE por departamento**: usar los 3
  RPCs (`get_nomina_by_cost_center`, `get_overhead_by_cost_center`,
  `get_production_by_cost_center`) y las 3 tablas (`cost_center_config`,
  `overhead_account_assignment`, `rent_lot_assignment`).
- **El residual debe cuadrar al peso**: si `Δ vs contable ≠ residual_501.01.01`,
  hay un bug en cómo se sumaron las cuentas. Investigar antes de seguir.
- **Period filter unificado**: solo usar `?period=` (no `pl_period`,
  removido). HistorySelector global controla todo el P&L.
- **Workcenters mayo 2026**: Tejido Circular fue go-live el primer
  proceso. Acabado/Tintorería/Entretelas/Empaque siguen pendientes.
  Cuando se configuren, MOD+OH se absorberá al PT al producirse y el
  régimen pasará de variable costing implícito a absorbing costing.

---

## /contabilidad/centros-de-costo — MOD + Overhead por departamento

Implementado 2026-05-04 para descomponer 501.06 (MOD) y 504.01 (overhead
fábrica) por proceso productivo. Permite calcular burden rate
(MXN por unidad producida) para cuando se configuren los workcenters
faltantes en Odoo.

### Tablas (silver, manual seed)

| Tabla | Filas | Qué define |
|---|---|---|
| `cost_center_config` | 12 | Catálogo de centros: TEJIDO, ACABADO, TINTORERIA, ENTRETELAS, INSP_EMPAQUE, MANTENIMIENTO, ALMACEN, CALIDAD, LIMPIEZA, ADMIN, DISENO, RH_COMPRAS. Cada uno con `nature` (fabril_directo / fabril_indirecto / admin), `output_uom`, `has_workcenter`, `workcenter_go_live_date`, `nomina_ref_pattern` (regex para parser de NOMINAS journal ref) |
| `overhead_account_assignment` | 5 | Mapping cuenta_504.01.* → cost_center con allocation_pct. Direct: luz→TEJIDO, gas→ACABADO, agua→TINTORERIA, agujados→TEJIDO. Otras cuentas no mapeadas se prorratean por participación de fabril_directos |
| `rent_lot_assignment` | 5 | 4 lotes según breakdown del CEO: Lote 9 planta tint+acabado $356,934 (50/50), Lote 10 entretelas $352,062 (100% ENTRETELAS), Lote 9,10 oficinas Tejido $284,269 (100% TEJIDO admin), Lote 10 oficinas RH+Compras $219,509 (100% RH_COMPRAS) |

### RPCs

- **`get_nomina_by_cost_center(p_period date)`** — agrupa cuentas 501.06.*
  por centro usando regex sobre `journal.ref` de NOMINAS (ej. "NOMINA TEJIDO
  Q1 ABRIL 2026" → TEJIDO). Si el ref no matchea ningún pattern, queda en
  bucket `SIN_CLASIFICAR`.
- **`get_overhead_by_cost_center(p_period date)`** — combina 3 fuentes:
  1. Asignaciones directas via `overhead_account_assignment`.
  2. Renta via `rent_lot_assignment`.
  3. Cuentas 504.01.* no mapeadas: prorrateadas por `production_qty` de
     centros fabril_directos (TEJIDO+ACABADO+TINTORERIA+ENTRETELAS).
- **`get_production_by_cost_center(p_period date)`** — qty producida por
  proceso según mrp_production + categoría de producto (TEJIDO_CIRCULAR
  produce kg crudos, ACABADO produce mt acabados, etc.).

### Burden rate (resultado abril 2026)

| Centro | Nómina | Overhead | Producción | Burden /unit |
|---|---|---|---|---|
| TEJIDO | $358k | $621k | 67k kg | $14.47/kg |
| ACABADO | $265k | $1.59M | 1.5M mt | $1.22/mt |
| TINTORERIA | $247k | ~$300k | 99k kg | $5.55/kg |
| ENTRETELAS | $209k | ~$400k | 297k mt | $2.05/mt |
| INSP_EMPAQUE | $266k | ~$50k | (mixto) | n/a sin allocator |

(Anomalía abril: ACABADO overhead $1.59M es alto porque renta $677k de
abril es 39% menor a marzo — ver pending action `investigate-renta-abril-baja`.)

### Migration

`supabase/migrations/20260504_cost_centers_overhead.sql` — schema +
seed + RPCs. Idempotente con ON CONFLICT en seeds.

---

## /finanzas — Cash projection (modelo realista day-by-day)

Sección "¿Qué va a pasar con el efectivo?" en /finanzas. Proyecta saldo
de cash día-a-día en horizontes de 13/30/90 días. Combina cuatro
fuentes y aplica varias correcciones para no ser ni demasiado
optimista ni pesimista.

### Fuente 1: AR/AP factura por factura — `cashflow_projection`

Tabla pre-computada que tiene una fila por factura abierta:

| flow_type | Significado |
|---|---|
| `receivable_detail` | Factura emitida (AR) — entra a cash |
| `payable_detail` | Factura recibida (AP) — sale de cash |
| `receivable_by_month` | Agregado mensual (ignorado en projection.ts) |

Cada fila trae `projected_date = due_date_resolved`,
`amount_residual` (residual nominal), y `expected_amount = residual ×
collection_probability` donde la prob viene del aging bucket:

| Aging | Prob |
|---|---|
| Fresca (no vencida) | 95% |
| 1-30d vencida | 85% |
| 31-60d | 70% |
| 61-90d | 50% |
| 90+ | 25% |

Para AR usamos `expected_amount` (con prob aplicada). Para AP usamos
`amount_residual` (al proveedor le debemos el monto completo, sin
descuento por aging).

### Fuente 2: Recurrentes — RPC `get_cash_projection_recurring`

Patrón histórico de los últimos 3 meses cerrados, proyectado al
calendario típico:

| Categoría | Día del mes | Cuentas |
|---|---|---|
| `nomina` | 15 + último día (quincenas) | 501.06.* (excl. 0020-23) + 602.01-25 + 603.01-25 |
| `impuestos_sat` | 17 del mes siguiente | 501.06.0020 + 0023 (IMSS patrón + otros mensuales) + 602.26-29 + 603.26-29 (retenciones e ISN) |
| `sar_infonavit` | 17 meses pares (feb/abr/jun/ago/oct/dic) | 501.06.0021 (SAR) + 501.06.0022 (INFONAVIT) — accrual mensual ×2 cada bimestre |
| `renta` | 1 | 504.01.0008 + 603.45.* |
| `servicios` | 10 | 504.01.0002-0043 (energía/agua/gas/mtto) |
| `arrendamiento` | 5 | 701.11.* |
| `ventas_proyectadas` | diario, today + DSO | 4xx run rate × 0.85 prob |

DSO se calcula dinámico: `AR_open / (avg_revenue / 30)`, capped
[15, 120] días.

### Fuente 3: Saldo inicial — `canonical_bank_balances`

`opening = SUM(current_balance_mxn WHERE classification='cash')`.

### Cuatro correcciones críticas aplicadas en projection.ts

#### 1. AP delay por proveedor (RPC `get_ap_payment_delay_v2`)

Antes: asumía que pagamos AP en el due date al 100%. Crash de cash falso.
Ahora: por cada proveedor, calcular delay promedio histórico
`payment_date_odoo - due_date_resolved` de últimos 6 meses (mín. 3
facturas pagadas, cap 0-90d). Aplicar al `projected_date`. Si sample <10
usa median (más robusto que avg). Sin histórico → 0d default
(conservador, paga en due date).

```
adjustedDate = max(today, dueDate + supplierDelay)
```

#### 2. AR delay por cliente (RPC `get_ar_collection_delay_v2`)

Antes: asumía cobranza en due date — optimista.
Ahora: análogo a AP pero para AR. Cap 0-180d. La prob del aging bucket
se mantiene (es ortogonal: el delay mide CUÁNDO, la prob mide CUÁNTO).

Validación reciente: 116 clientes con histórico, 965 facturas. Mediana
delay 9d, p75 28d, máx 172d. Promedio ponderado 22d después del
vencimiento.

#### 3. Partes relacionadas — flag `is_related_party`

Columna `canonical_companies.is_related_party boolean`. Marcadas
manualmente por RFC en migration `20260426_ap_delay_related_party.sql`:

| RFC | Partner |
|---|---|
| GQU920609JNA | Grupo Quimibond, S.C. (matriz / holding) |
| MITJ991130TV7 | José Jaime Mizrahi Tuachi |
| MIDJ4003178X9 | José Mizrahi Daniel |
| MIPJ691003QJ1 | Jacobo Mizrahi Penhos |
| AOMS630418PP1 | Salomón Ancona Mizrahi |

AP a partes relacionadas:
- **En projection.ts**: pushed 180d fuera del horizonte. Categoría
  separada `ap_intercompania`. NO contamina `outflowByDay` ni
  `totalOutflow` ni markers.
- **En obligations.ts**: cuenta 205.04 → categoría
  `partes_relacionadas` propia. KPI principal cambia a "Operativo
  (sin intercompañía)" y aparece KPI separado "Intercompañía".

Importante: el saldo principal del $12.81M en 205.04.0001 es préstamo
de accionista de dic-2021 sin actividad reciente — vive a nivel GL,
no como facturas. El push 180d es preventivo (por si en el futuro
emiten factura), no correctivo de hoy.

#### 4. Anti doble-conteo recurrentes ya facturados

Antes: si el arrendador emitió factura de renta de abril, entraba al
`cashflow_projection` AP Y el recurring overlay también la proyectaba
para el día 1. $1.37M renta contado 2x. Mismo bug con servicios y
arrendamiento.

Ahora: para las 3 categorías que llegan como factura del proveedor
(`renta`, `servicios`, `arrendamiento`), se omite la proyección
recurrente si `projected_date < hoy`. Asumimos que la factura del
mes corriente ya está capturada en AP.

Nómina, impuestos_sat y ventas_proyectadas siguen proyectándose
siempre — no llegan como factura.

#### 5. Past-due spread (anti-cliff)

Para AR/AP que ya rebasaron su fecha esperada incluso después del
delay, en vez de "dump on today" (cliff artificial el día 1) se
distribuyen sobre una ventana mínima de 14 días usando un hash estable
de `invoice_name`. Determinístico y evita que el chart muestre un
acantilado el día de hoy cuando hay backlog grande de past-due
(típico: ~91% del residual de Quimibond está past-due).

```
window = max(supplierDelay, 14)
offset = stableHash(invoiceName) % window
adjustedDate = today + offset
```

### Estructura de salida (`CashProjection`)

```ts
{
  horizonDays: 13 | 30 | 90,
  openingBalance, closingBalance, minBalance, minBalanceDate,
  totalInflow, totalOutflow, totalInflowNominal,
  avgCollectionProbability, overdueInflowCount, safetyFloor,
  points: [{ date, balance, inflow, outflow }],     // día por día
  markers: [{ date, kind, amount, label, category, ... }],  // ≥$50k
  categoryTotals: [{ category, categoryLabel, flowType, amountMxn }],
}
```

UI muestra 4 partes:
1. **CashProjectionChart** — area chart con balance + markers coloreados
   por categoría (verde inflow, naranja `impuestos_sat`, rojo outflow)
2. **ProjectionTimeline** — eventos agrupados por semana ("Esta
   semana", "Próxima semana", "Semana del X-Y") con net por semana
3. **CashCategoryBreakdown** — totales por categoría (inflow/outflow)
4. **SummaryStat** — saldo inicial / inflows / outflows / saldo proyectado

### Archivos

| Archivo | Qué hace |
|---|---|
| `src/lib/queries/sp13/finanzas/projection.ts` | Lógica principal, aplica las 5 correcciones, retorna CashProjection |
| `src/app/finanzas/_components/cash-projection-chart.tsx` | Chart con markers coloreados |
| `src/app/finanzas/page.tsx` (ProjectionBlock + ProjectionTimeline + CashCategoryBreakdown) | Render |

### RPCs silver involucrados

- `get_cash_projection_recurring(p_horizon_days, p_lookback_months)` — nómina/renta/servicios/arrendamiento/impuestos_sat/ventas_proyectadas
- `get_ap_payment_delay_v2(p_lookback_months)` — delay AP por proveedor + flag is_related_party
- `get_ar_collection_delay_v2(p_lookback_months)` — delay AR por cliente

### Migrations relevantes

- `20260425_cash_projection_recurring.sql` (v1 — nómina sin separar SAT)
- `20260425_cash_projection_recurring_v2_taxes.sql` (separa impuestos_sat día 17)
- `20260426_ap_delay_related_party.sql` (RPC + is_related_party + 5 RFCs marcados)
- `20260426_ar_collection_delay.sql` (RPC AR delay)
- `20260427_recurring_v3_bimestral.sql` (split SAR/INFONAVIT bimestral del IMSS/ISR mensual)

### Cache

`unstable_cache` key bumpeada con cada cambio significativo
(actualmente `sp13-finanzas-cash-projection-v7`). Bumpear al modificar
la lógica para invalidar Vercel ISR.

### IMPORTANTE para futuras sesiones

- **El modelo viejo era OPTIMISTA** (no pesimista como pareciera). El
  AP wall asumía pago en due date y el AR wave asumía cobranza en due
  date — ambos compensados. Al fixear ambos, el net empeora (más
  realista). Si alguien dice "el dashboard ahora se ve más feo",
  defender los cambios: la realidad es esa.
- **No tocar la prob por aging bucket**: las 95/85/70/50/25 son un
  proxy razonable hasta que se calcule prob por cliente histórica.
  Mejorar eso sería opción separada.
- **El intercompañía a 180d es un workaround**: la solución real es
  no traer al cashflow_projection las facturas de partes relacionadas
  desde la silver. Si en el futuro alguien construye SP4+, considerar
  excluir `is_related_party` ahí.
- **`is_related_party` se popla manual**: no hay matcher automático.
  Si Quimibond agrega nuevos accionistas/empresas hermanas, hay que
  marcarlas con UPDATE en migration.
- **Cache key**: si modificas projection.ts, bumpear v7 → v8.

---

## Addon Odoo (qb19)

**Ubicacion:** `addons/quimibond_intelligence/`
**Version:** 19.0.30.0.0
**Dependencias:** base, sale, purchase, account, stock, crm, mail

### Archivos

| Archivo | LOC | Descripcion |
|---|---|---|
| `models/sync_push.py` | ~1500 | Push Odoo → Supabase (20 modelos) |
| `models/sync_pull.py` | ~200 | Pull Supabase → Odoo (comandos, contactos) |
| `models/supabase_client.py` | ~110 | REST client para Supabase |
| `models/sync_log.py` | ~25 | Modelo de log de sync |

### Crons Odoo

| Frecuencia | Que hace |
|---|---|
| Cada 1 hora | Push completo a Supabase (20 tablas) |
| Cada 5 minutos | Pull comandos + contactos nuevos |

### Modelos sincronizados (20)

| Odoo Model | Supabase Table | Status |
|---|---|---|
| res.partner | contacts + companies | Synced |
| product.product | odoo_products | Synced |
| sale.order.line + purchase.order.line | odoo_order_lines | Synced |
| res.users + hr.employee | odoo_users | Synced |
| account.move (facturas) | odoo_invoices | Synced |
| account.move.line (líneas factura) | odoo_invoice_lines | Synced |
| account.move (pagos proxy) | odoo_payments | Synced |
| account.payment (pagos reales) | odoo_account_payments | Synced |
| account.account | odoo_chart_of_accounts | Synced |
| account.move.line (balances agregados) | odoo_account_balances | Synced |
| account.journal (banco/caja) | odoo_bank_balances | Synced |
| stock.picking | odoo_deliveries | Synced |
| crm.lead | odoo_crm_leads | Synced |
| mail.activity | odoo_activities | Synced |
| mrp.production | odoo_manufacturing | Synced |
| hr.employee | odoo_employees | Synced |
| hr.department | odoo_departments | Synced |
| sale.order | odoo_sale_orders | Synced |
| purchase.order | odoo_purchase_orders | Synced |
| stock.warehouse.orderpoint | odoo_orderpoints | Synced |

### Vistas financieras (SQL views)

| Vista | Que muestra |
|---|---|
| `pl_estado_resultados` | P&L mensual: ingresos, costo ventas, gastos, utilidad bruta/operativa |
| `cash_position` | Saldos bancarios (solo cuentas con movimiento) |
| `expense_breakdown` | Desglose de gastos por cuenta y periodo |
| `payment_analysis` | Pagos con empresa, banco, método, conciliación |
| `cfo_dashboard` | Resumen ejecutivo: efectivo, deuda tarjetas, CxC, CxP, 30d metrics |
| `cash_flow_aging` | Aging de cartera por empresa (1-30, 31-60, 61-90, 90+) |
| `margin_analysis` | Análisis de márgenes por producto y cliente |
| `working_capital` | Capital de trabajo: efectivo + CxC - CxP, ratios de liquidez |
| `cfdi_invoice_match` | Cruce CFDI ↔ factura via UUID (matched/unmatched/no_uuid) |

### Modelos pendientes

| Odoo Model | Prioridad | Valor |
|---|---|---|
| account.payment.term | Medium | Prediccion de pago |
| res.partner.category | Medium | Segmentacion de clientes |
| mrp.bom | Medium | Costos de produccion |
| product.pricelist | Low | Analisis de precios |

---

## Guardrails de seguridad

1. **Schema changes:** `execute_safe_ddl()` solo permite CREATE, ALTER ADD, CREATE INDEX. BLOQUEA DROP, TRUNCATE, DELETE.
2. **Data changes:** Auto-fix solo linkea y llena — nunca borra.
3. **Insights:** Confianza <65% auto-filtrada. >7 dias auto-expirada.
4. **Duplicados:** Triggers de normalizacion + dedup cada 30 min.
5. **Odoo agent:** Solo analiza y recomienda — no modifica Odoo.
6. **Audit trail:** Todas las operaciones loggeadas en pipeline_logs y schema_changes.

### RLS posture (decisión 2026-04-28, audit P2-8)

**Postura adoptada: anon-key seguro / RLS no requerido.**

- El frontend (Next.js 15 server components) accede a Supabase via
  **`SUPABASE_SERVICE_KEY` exclusivamente**, en `getServiceClient()`
  (`src/lib/supabase-server.ts`). Service role bypassea RLS por diseño.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` se setea en env vars pero **no se usa**
  para reads del backend; queda disponible solo para futuros client
  components que requieran RLS (no hay ninguno hoy).
- Auth UI no expone anon-key a usuarios externos — la app está detrás
  de `AUTH_PASSWORD` middleware (single-tenant, CEO-only).

**Por eso los 49 ERROR-level lints de RLS están suprimidos conscientemente:**
no aplican al modelo de acceso real. Si en el futuro se agrega un cliente
público (móvil, embed externo, multi-tenant), revisitar y cerrar RLS por
tabla con policies por rol antes de exponer anon-key.

**No habilitar RLS sin auditar uso de service vs anon en queries** —
romperia getServiceClient flows que asumen bypass.

---

## Environment Variables

### Vercel (quimibond-intelligence)
```
NEXT_PUBLIC_SUPABASE_URL=https://tozqezmivpblmcubmnpi.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...
ANTHROPIC_API_KEY=sk-ant-...
AUTH_PASSWORD=...
CRON_SECRET=...
```

### Odoo.sh (qb19)
```
quimibond_intelligence.supabase_url=https://tozqezmivpblmcubmnpi.supabase.co
quimibond_intelligence.supabase_service_key=...
```

---

## Deployment

### Frontend (Vercel)
- Push a `main` → auto-deploy
- Crons configurados en `vercel.json`
- Vercel Pro (300s timeout)

### Backend (Odoo.sh)
- Branch `quimibond` = produccion
- Push a `main` → merge a `quimibond` manualmente
- `odoo-update quimibond_intelligence` desde shell
- NO cambiar version del manifest (causa build failure por errores pre-existentes de Odoo Studio)
