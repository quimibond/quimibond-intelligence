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
ODOO ERP (qb19 addon)
  ↓ sync cada 1 hora
SUPABASE (PostgreSQL)
  ↑ emails via Gmail API
  ↓
PIPELINE (Vercel crons)
  ↓ extrae datos de emails
AI AGENTS (7 de negocio + 2 de sistema)
  ↓ generan insights curados
CEO INBOX (web + mobile)
```

### Flujo de datos

1. **Odoo → Supabase** (qb19 addon, cada 1h, 20 modelos)
   - res.partner → contacts + companies (con financials: receivable, payable, invoiced)
   - product.product → odoo_products
   - sale.order.line + purchase.order.line → odoo_order_lines
   - account.move → odoo_invoices + odoo_invoice_lines
   - account.move (pagos proxy) → odoo_payments
   - account.payment → odoo_account_payments (pagos reales con banco/método)
   - account.account → odoo_chart_of_accounts (plan de cuentas)
   - account.move.line (agregado) → odoo_account_balances (P&L mensual)
   - account.journal → odoo_bank_balances (saldos bancarios)
   - stock.picking → odoo_deliveries
   - stock.warehouse.orderpoint → odoo_orderpoints
   - crm.lead → odoo_crm_leads
   - mail.activity → odoo_activities
   - mrp.production → odoo_manufacturing
   - hr.employee → odoo_employees
   - hr.department → odoo_departments
   - sale.order → odoo_sale_orders
   - purchase.order → odoo_purchase_orders
   - res.users → odoo_users

2. **Gmail → Supabase** (pipeline sync-emails, cada 30 min)
   - Emails ingestados via Gmail API
   - Threads detectados automaticamente

3. **Pipeline → Knowledge Graph** (analyze, cada 30 min)
   - Procesa 1 cuenta de email por invocacion
   - Extrae: entities, facts, relationships, person profiles
   - NO genera alertas ni acciones (los agentes se encargan)

4. **Agentes → Insights** (orchestrate, cada 15 min)
   - 1 agente por invocacion (el menos reciente primero)
   - Claude analiza datos + memorias → genera insights
   - Insights filtrados por confianza (>=80%)
   - Asignados automaticamente: vendedor real de sale_orders > comprador de purchase_orders > departamento por categoria
   - Max 5 insights por agente por ejecucion
   - 8 categorias fijas: cobranza, ventas, entregas, operaciones, proveedores, riesgo, equipo, datos

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

## Agentes de IA (9 total)

### Agentes de negocio (automaticos, cada 15 min)

| Agente | Dominio | Que analiza |
|---|---|---|
| **Sales** | Ventas | Ordenes, CRM, top clientes, oportunidades |
| **Finance** | Finanzas | Facturas, cartera vencida, cash flow |
| **Operations** | Operaciones | Entregas, inventario, manufactura |
| **Relationships** | Relaciones | Health scores, threads sin respuesta, sentimiento |
| **Risk** | Riesgo | Facturas vencidas >30d, entregas atrasadas, contactos criticos |
| **Growth** | Crecimiento | Top clientes, tendencias, cross-sell |
| **Meta** | Sistema | Evalua rendimiento de otros agentes |

### Agentes de sistema

| Agente | Dominio | Que analiza |
|---|---|---|
| **Data Quality** | Supabase | Datos faltantes, links rotos, metricas de calidad |
| **Odoo** | Odoo (manual) | Gaps en sync, modelos faltantes, recomendaciones para addon |

---

## Routing de Insights

Cada insight se asigna automaticamente a un responsable via trigger:

| Categoria | Departamento | Responsable |
|---|---|---|
| Pagos, facturas, cobranza | Cobranza | Sandra Davila |
| Ventas, CRM, clientes | Ventas | Guadalupe Guerrero |
| Entregas, logistica | Logistica | Dario Manriquez |
| Manufactura, produccion | Produccion | Guadalupe Ramos |
| Stock, almacen | Almacen | Gustavo Delgado |
| Calidad, muestras | Calidad | Oscar Gonzalez |
| Compras, proveedores | Compras | Elena Delgado |
| Riesgo, estrategia | Direccion | Jose Mizrahi |

Configurado en tabla `insight_routing` → `departments` → `odoo_users` (todo por FK, no texto).

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

---

## Frontend (Next.js 15)

### Paginas

| Ruta | Descripcion |
|---|---|
| `/inbox` | Inbox de insights — desktop: lista, mobile: swipe Tinder |
| `/inbox/insight/[id]` | Detalle con trazabilidad hasta email original |
| `/dashboard` | Centro de control con KPIs, agentes, equipo |
| `/agents` | 9 agentes con status, insights, boton ejecutar |
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
| `monthly_revenue_trend` | Tendencia de revenue mensual con MoM% |
| `margin_analysis` | Análisis de márgenes por producto y cliente |

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
