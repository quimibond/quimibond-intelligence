# Quimibond Intelligence — Diagrama Completo del Sistema

## 1. FUENTES DE DATOS

```
┌─────────────────────────────────────────────────────────────────┐
│                         ODOO ERP (qb19)                        │
│                      Sync cada 1h (incremental)                │
├────────────────────┬────────────────────┬──────────────────────┤
│ VENTAS             │ FINANZAS           │ OPERACIONES          │
│ sale.order →       │ account.move →     │ stock.picking →      │
│  odoo_sale_orders  │  odoo_invoices     │  odoo_deliveries     │
│  (2,020 rows)      │  (2,774 rows)      │  (676 rows)          │
│                    │                    │                      │
│ sale.order.line →  │ account.move.line →│ stock.warehouse.     │
│  odoo_order_lines  │  odoo_invoice_lines│  orderpoint →        │
│  (7,123 rows)      │  (10,668 rows)     │  odoo_orderpoints    │
│                    │                    │  (56 rows)           │
│ crm.lead →         │ account.payment →  │                      │
│  odoo_crm_leads    │  odoo_payments     │ mrp.production →     │
│  (20 rows)         │  (2,157 rows)      │  (no synced yet)     │
├────────────────────┼────────────────────┼──────────────────────┤
│ PERSONAS           │ PRODUCTOS          │ ACTIVIDADES          │
│ res.partner →      │ product.product →  │ mail.activity →      │
│  contacts (1,678)  │  odoo_products     │  odoo_activities     │
│  companies (1,766) │  (6,134 rows)      │  (5,000 rows)        │
│                    │                    │                      │
│ res.users →        │                    │ Schema catalog →     │
│  odoo_users (39)   │                    │  odoo_schema_catalog │
│                    │                    │  (3,583 campos)      │
│ hr.employee →      │                    │                      │
│  odoo_employees    │                    │                      │
│  (164 rows)        │                    │                      │
│                    │                    │                      │
│ hr.department →    │                    │                      │
│  odoo_departments  │                    │                      │
│  (26 rows)         │                    │                      │
│ purchase.order →   │                    │                      │
│  odoo_purchase_    │                    │                      │
│  orders (1,674)    │                    │                      │
└────────────────────┴────────────────────┴──────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     GMAIL (API, cada 30min)                     │
│                                                                 │
│  emails (3,571 rows, 51MB)  →  threads (2,942 rows)            │
│  email_recipients            →  sync_state (52 cuentas)         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     CFDI / SAT (via email parse)                │
│                                                                 │
│  cfdi_documents (75 rows)                                       │
└─────────────────────────────────────────────────────────────────┘
```

## 2. CAPA DE PROCESAMIENTO (Pipelines)

```
┌─────────────────────────────────────────────────────────────────┐
│                    PIPELINES (Vercel Crons)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  sync-emails (*/30min)                                          │
│    Gmail API → emails + threads                                 │
│                                                                 │
│  analyze (*/5min)                                               │
│    emails → [noise filter] → Claude Haiku → entities + facts    │
│    + relationships + action_items                               │
│    Escribe: entities (3,773), facts (2,645),                    │
│             entity_relationships (1,972)                        │
│                                                                 │
│  auto-fix (*/30min)                                             │
│    Linkea emails↔contacts, contacts↔companies,                  │
│    invoices↔companies, entities↔contacts                        │
│                                                                 │
│  identity-resolution (*/2h)                                     │
│    Fuzzy match: contacts↔companies (pg_trgm)                   │
│    Domain match: email domain → company                         │
│    Odoo partner propagation                                     │
│                                                                 │
│  cleanup (*/30min)                                              │
│    Enrich companies sin industry (Claude Haiku)                 │
│    Dedup insights                                               │
│    Refresh 7 materialized views                                 │
│                                                                 │
│  health-scores (*/6h)                                           │
│    Recalcula health por contacto                                │
│                                                                 │
│  snapshot (5:30am)                                              │
│    Captura estado financiero diario                             │
│    Refresh revenue_metrics                                      │
│                                                                 │
│  briefing (6:30am)                                              │
│    Claude genera resumen diario                                 │
│                                                                 │
│  reconcile (7:00am)                                             │
│    Auto-cierra insights resueltos                               │
│                                                                 │
│  validate (*/30min)                                             │
│    TTL por severidad, dedup, escalation                         │
│    Archiva insights >30 días                                    │
│                                                                 │
│  learn (*/4h)                                                   │
│    Feedback CEO → agent_memory (378 rows)                       │
│                                                                 │
│  parse-cfdi (*/30min)                                           │
│    Emails con XML → cfdi_documents                              │
│                                                                 │
│  whatsapp (7:00am)                                              │
│    Top insights → WhatsApp CEO                                  │
│                                                                 │
│  health (*/3h)                                                  │
│    Verifica que todos los crons corran                          │
└─────────────────────────────────────────────────────────────────┘
```

## 3. MATERIALIZED VIEWS (inteligencia pre-calculada)

```
┌─────────────────────────────────────────────────────────────────┐
│              16 MATERIALIZED VIEWS (refresh */30min)            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  EMPRESA:                                                       │
│  ├─ company_profile         ← invoices + orders + deliveries    │
│  │   Revenue, overdue, OTD, tier, risk_level                   │
│  ├─ company_narrative       ← profile + emails + facts          │
│  │   Risk_signal, complaints, salespeople, top_products        │
│  ├─ company_handlers        ← sale_orders + users               │
│  │   Sales handler, purchase handler per company               │
│  ├─ company_email_intel     ← facts por empresa                 │
│  │   Quejas, compromisos, solicitudes por email                │
│  └─ company_insight_history ← agent_insights                    │
│      Veces flaggeada, CEO acted/dismissed                      │
│                                                                 │
│  PRODUCTO:                                                      │
│  ├─ product_margin_analysis ← order_lines + invoice_lines       │
│  │   Precio venta vs costo, margen por producto+cliente        │
│  ├─ dead_stock_analysis     ← products + order_lines            │
│  │   Inventario sin venta, valor atrapado                      │
│  ├─ customer_product_matrix ← order_lines (sale)                │
│  │   Revenue por cliente×producto, concentración               │
│  └─ supplier_product_matrix ← order_lines (purchase)            │
│      Gasto por proveedor×producto, proveedor único             │
│                                                                 │
│  FINANCIERO:                                                    │
│  ├─ payment_predictions     ← invoices + payments               │
│  │   Patrón de pago, riesgo, días promedio                     │
│  ├─ cashflow_projection     ← invoices + payment_predictions    │
│  │   Entradas/salidas 30/60/90d con probabilidad               │
│  ├─ accounting_anomalies    ← invoices + order_lines            │
│  │   Duplicados, CFDI cancelados, crédito excedido             │
│  └─ weekly_trends           ← snapshots                         │
│      Cambios semanales en overdue, entregas, pendiente         │
│                                                                 │
│  COMPRAS:                                                       │
│  └─ purchase_price_intel    ← order_lines (purchase)            │
│      Precio vs promedio histórico, anomalías                   │
│                                                                 │
│  VENTAS:                                                        │
│  ├─ client_reorder_predict  ← order_lines + company_profile     │
│  │   Ciclo de compra, días sin comprar, status reorden         │
│  └─ cross_director_signals  ← agent_insights activos            │
│      Lo que cada director reportó (para cross-dedup)           │
└─────────────────────────────────────────────────────────────────┘
```

## 4. AGENTES DE IA (7 directores)

```
┌─────────────────────────────────────────────────────────────────┐
│              ORCHESTRATE (cada 30min, round-robin)              │
│              Corre 1 agente por ciclo                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  CONTEXTO COMPARTIDO (todos reciben):                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ cross_director_signals  → QUE DICEN OTROS DIRECTORES     │  │
│  │ company_email_intel     → SEÑALES DE EMAILS              │  │
│  │ company_insight_history → HISTORIAL (veces flaggeada)    │  │
│  │ agent_insights feedback → FEEDBACK CEO (48h)             │  │
│  │ agent_tickets           → TICKETS DE OTROS DIRECTORES    │  │
│  │ agent_memory            → MEMORIAS (aprendizaje)         │  │
│  │ company_narrative       → NARRATIVAS (top 15 empresas)   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─── COMERCIAL ─────────────────────────────────────────────┐  │
│  │ Lee:                                                      │  │
│  │  • client_reorder_predictions (overdue/at_risk/lost)      │  │
│  │  • company_profile (top 15 por revenue)                   │  │
│  │  • product_margin_analysis (márgenes)                     │  │
│  │  • customer_product_matrix (concentración >50%)           │  │
│  │  • odoo_sale_orders (últimas 10)                          │  │
│  │  • odoo_crm_leads (oportunidades abiertas)                │  │
│  │ NO lee: emails, threads, facturas vencidas                │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─── FINANCIERO ────────────────────────────────────────────┐  │
│  │ Lee:                                                      │  │
│  │  • cashflow_projection (30/60/90d)                        │  │
│  │  • accounting_anomalies (duplicados, CFDI, crédito)       │  │
│  │  • payment_predictions (empresas fuera de patrón)         │  │
│  │  • weekly_trends (cambios semanales)                      │  │
│  │  • odoo_invoices (out_invoice vencidas, top 20)           │  │
│  │  • company_profile (cartera vencida por empresa)          │  │
│  │  • odoo_payments (últimos 10)                             │  │
│  │ NO lee: facturas proveedor, IVA, términos de pago         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─── OPERACIONES ───────────────────────────────────────────┐  │
│  │ Lee:                                                      │  │
│  │  • odoo_deliveries (atrasadas, últimos 90d)               │  │
│  │  • odoo_orderpoints (stock bajo)                          │  │
│  │  • dead_stock_analysis (inventario muerto)                │  │
│  │  • odoo_products (stock < reorder_min)                    │  │
│  │ NO lee: manufacturing, BOM, capacidad planta              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─── COMPRAS ───────────────────────────────────────────────┐  │
│  │ Lee:                                                      │  │
│  │  • purchase_price_intelligence (arriba/abajo promedio)    │  │
│  │  • supplier_product_matrix (proveedor único)              │  │
│  │  • odoo_purchase_orders (OC recientes)                    │  │
│  │  • odoo_order_lines (purchase, precios)                   │  │
│  │ NO lee: facturas proveedor, lead times, calidad           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─── RIESGO ────────────────────────────────────────────────┐  │
│  │ Lee:                                                      │  │
│  │  • company_narrative (empresas con risk_signal)           │  │
│  │  • payment_predictions (CRITICO/ALTO)                     │  │
│  │  • supplier_product_matrix (proveedor único)              │  │
│  │  • company_profile (clientes cayendo >30%)                │  │
│  │  • weekly_trends (deterioro semanal)                      │  │
│  │  • threads (emails sin respuesta >72h)                    │  │
│  │ NO lee: concentración revenue, exposición USD             │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─── COSTOS ────────────────────────────────────────────────┐  │
│  │ Lee:                                                      │  │
│  │  • product_margin_analysis (márgenes, top por valor)      │  │
│  │  • product_margin_analysis (margen <15%)                  │  │
│  │  • dead_stock_analysis (inventario muerto)                │  │
│  │  • odoo_products (más stock)                              │  │
│  │ NO lee: BOM, costo fabricación, consumo energía           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─── EQUIPO ────────────────────────────────────────────────┐  │
│  │ Lee:                                                      │  │
│  │  • client_reorder_predictions AGRUPADO por vendedor       │  │
│  │  • odoo_activities (vencidas, por persona)                │  │
│  │  • odoo_users (ranking overdue)                           │  │
│  │  • threads (sin respuesta >48h, por cuenta)               │  │
│  │ NO lee: carga de pedidos por vendedor, ausencias          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  FILTROS POST-CLAUDE:                                           │
│  1. META_TITLE_PATTERNS (15 regex) → bloquea ruido             │
│  2. Unit error filter (>3x) → bloquea falsos márgenes          │
│  3. Title dedup (normalizado)                                   │
│  4. Theme dedup (extractTheme semántico)                        │
│  5. Company+category dedup                                      │
│  6. Word overlap dedup (3+ palabras)                            │
│  7. Duplicado? → agent_ticket "enrich" en vez de nuevo insight  │
│                                                                 │
│  ROUTING (trigger route_insight):                               │
│  Tier 1: salesperson real (odoo_sale_orders)                    │
│  Tier 2: buyer real (odoo_purchase_orders)                      │
│  Tier 3: categoría → departamento (insight_routing, 14 reglas)  │
│  Tier 4: CEO (fallback)                                         │
│                                                                 │
│  SALIDA:                                                        │
│  → agent_insights (3,140 total, ~16 activos)                    │
│  → action_items (1,639 total) — 1 por responsable por acción   │
│  → agent_tickets (5) — delegación cross-director                │
│  → agent_runs (1,401) — historial de ejecuciones                │
└─────────────────────────────────────────────────────────────────┘
```

## 5. EVENT TRIGGERS (reactivos, no cron)

```
┌─────────────────────────────────────────────────────────────────┐
│                    TRIGGERS (instantáneos)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ON odoo_invoices UPDATE:                                       │
│  ├─ payment_state → 'paid'                                      │
│  │   → Auto-resolve insight de cobranza de esa empresa          │
│  └─ cfdi_sat_state → 'cancelled'                                │
│      → Crear insight CRITICAL inmediato (sin esperar agente)    │
│                                                                 │
│  ON emails INSERT:                                              │
│  ├─ sender_type = 'external' + company con insight critical     │
│  │   → Crear ticket "enrich" para el agente del insight         │
│  └─ auto_link_email_domain                                      │
│      → Linkea email a company por dominio                       │
│                                                                 │
│  ON companies INSERT/UPDATE:                                    │
│  ├─ normalize_company_name → lowercase                          │
│  ├─ classify_company_entity_type → entity link                  │
│  ├─ extract_payment_terms → odoo_context → columnas             │
│  └─ link_cfdi_by_rfc → cfdi_documents                           │
│                                                                 │
│  ON contacts INSERT/UPDATE:                                     │
│  ├─ normalize_contact_email → lowercase                         │
│  ├─ auto_resolve_contact_identity → entity link                 │
│  └─ resolve_contact_company → company link por domain           │
│                                                                 │
│  ON odoo_invoices/orders/deliveries INSERT:                     │
│  └─ resolve_*_company → auto-link company_id por odoo_partner   │
│                                                                 │
│  ON agent_insights INSERT:                                      │
│  ├─ route_insight → asigna responsable (4 tiers)                │
│  ├─ normalize_insight_category → 8 categorías fijas             │
│  └─ create_follow_up_on_action → insight_follow_ups             │
│                                                                 │
│  ON alerts UPDATE (state change):                               │
│  └─ alert_feedback → feedback_signals + reward score            │
└─────────────────────────────────────────────────────────────────┘
```

## 6. FRONTEND (Next.js 15, Vercel)

```
┌─────────────────────────────────────────────────────────────────┐
│                       FRONTEND (CEO)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  /inbox                                                         │
│  ├─ Lee: agent_insights (state new/seen, confidence >=0.80)     │
│  ├─ Lee: ai_agents (nombres directores)                         │
│  ├─ Lee: company_profile (tier para badges)                     │
│  └─ Realtime: postgres_changes INSERT on agent_insights         │
│                                                                 │
│  /inbox/insight/[id]                                            │
│  ├─ Lee: agent_insights (detalle)                               │
│  ├─ Lee: action_items (acciones por responsable)                │
│  ├─ Lee: companies (nombre, canonical)                          │
│  ├─ Lee: cross_director_signals (otros directores)              │
│  ├─ Lee: company_insight_history (veces flaggeada)              │
│  ├─ Lee: emails (keyword search por company)                    │
│  ├─ Lee: contacts (emails de empresa para actions)              │
│  ├─ Lee: insight_follow_ups (status seguimiento)                │
│  ├─ Escribe: agent_insights (state → acted_on/dismissed)        │
│  ├─ Escribe: action_items (state → completed)                   │
│  └─ Escribe: insight_follow_ups (nuevo follow-up)               │
│                                                                 │
│  /dashboard                                                     │
│  ├─ Lee: agent_insights (count pending)                         │
│  ├─ Lee: odoo_invoices (overdue total)                          │
│  ├─ Lee: odoo_deliveries (OTD rate)                             │
│  ├─ Lee: weekly_trends (cambios)                                │
│  ├─ Lee: briefings (resumen diario)                             │
│  ├─ Lee: cashflow_projection (gráfico barras)                   │
│  └─ Lee: accounting_anomalies (count badge)                     │
│                                                                 │
│  /companies + /companies/[id]                                   │
│  ├─ Lee: companies, company_profile                             │
│  ├─ Lee: contacts (por empresa)                                 │
│  ├─ Lee: odoo_invoices, odoo_payments                           │
│  ├─ Lee: odoo_order_lines (sale + purchase)                     │
│  ├─ Lee: odoo_deliveries                                        │
│  ├─ Lee: revenue_metrics (gráfico mensual)                      │
│  ├─ Lee: payment_predictions, client_reorder_predictions        │
│  ├─ Lee: company_narrative (risk signal)                        │
│  └─ Lee: agent_insights (historial por empresa)                 │
│                                                                 │
│  /chat                                                          │
│  ├─ Lee: company_narrative (por keyword)                        │
│  ├─ Lee: payment_predictions (por keyword)                      │
│  ├─ Lee: client_reorder_predictions (por keyword)               │
│  ├─ Lee: agent_insights (critical/high activos)                 │
│  ├─ Lee: facts (por keyword)                                    │
│  ├─ Lee: contacts (por keyword)                                 │
│  ├─ Lee: odoo_invoices (POR EMPRESA específica)                 │
│  ├─ Lee: accounting_anomalies (critical/high)                   │
│  ├─ Lee: alerts, briefings, chat_memory (contexto estático)     │
│  └─ Escribe: token_usage                                        │
│                                                                 │
│  /agents                                                        │
│  ├─ Lee: ai_agents + agent_runs + agent_memory                  │
│  └─ Trigger: /api/agents/run (ejecutar manual)                  │
│                                                                 │
│  /system                                                        │
│  ├─ Lee: pipeline_logs, token_usage, sync_commands              │
│  └─ Escribe: sync_commands (force_push, etc)                    │
└─────────────────────────────────────────────────────────────────┘
```

## 7. TABLAS SIN USO (candidatas a eliminar o poblar)

| Tabla | Rows | Status |
|-------|------|--------|
| alerts | 0 | Reemplazada por agent_insights |
| topics | 0 | Pipeline analyze no la puebla |
| pipeline_runs | 0 | Reemplazada por pipeline_logs |
| health_scores | 0 | Pipeline health-scores corre pero parece no escribir |
| communication_edges | 0 | refresh_communication_edges() no se ejecuta |
| email_recipients | 0 | resolve_email_recipients() no se ejecuta |
| feedback_signals | 0 | trigger on alerts, pero alerts tiene 0 rows |
| chat_memory | 0 | Chat no guarda conversaciones |
| odoo_snapshots | 0 | take_daily_snapshot() no encuentra datos |
| company_behavior | 0 | Nunca poblada |
| department_metrics | 0 | Nunca poblada |
| communication_metrics | 0 | Nunca poblada |
| account_owner_map | 0 | Nunca poblada |
| odoo_models_catalog | 0 | Reemplazada por odoo_schema_catalog |

## 8. TOKENS (costo por agente, hoy)

| Endpoint | Calls | Total tokens |
|----------|-------|-------------|
| analyze-batch (Haiku) | 132 | 1,027,019 |
| agent-comercial (Sonnet) | 20 | 183,636 |
| agent-equipo (Sonnet) | 18 | 170,060 |
| agent-costos (Sonnet) | 18 | 161,898 |
| agent-financiero (Sonnet) | 20 | 156,476 |
| agent-riesgo (Sonnet) | 18 | 140,884 |
| agent-compras (Sonnet) | 19 | 140,473 |
| agent-operaciones (Sonnet) | 18 | 124,868 |
| cleanup-enrich (Haiku) | 210 | 56,951 |
| agent-meta-learn (Sonnet) | 5 | 8,474 |
| **TOTAL diario** | | **~2.2M tokens** |
