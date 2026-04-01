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

1. **Odoo → Supabase** (qb19 addon, cada 1h)
   - res.partner → contacts + companies
   - product.product → odoo_products
   - sale.order.line + purchase.order.line → odoo_order_lines
   - account.move → odoo_invoices
   - stock.picking → odoo_deliveries
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
   - Insights filtrados por confianza (>=65%)
   - Asignados automaticamente a responsable por departamento

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
- `odoo_products`, `odoo_invoices`, `odoo_payments`
- `odoo_order_lines`, `odoo_sale_orders`, `odoo_purchase_orders`
- `odoo_deliveries`, `odoo_crm_leads`, `odoo_activities`
- `odoo_manufacturing`

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
| `models/sync_push.py` | ~800 | Push Odoo → Supabase (13 modelos) |
| `models/sync_pull.py` | ~200 | Pull Supabase → Odoo (comandos, contactos) |
| `models/supabase_client.py` | ~110 | REST client para Supabase |
| `models/sync_log.py` | ~25 | Modelo de log de sync |

### Crons Odoo

| Frecuencia | Que hace |
|---|---|
| Cada 1 hora | Push completo a Supabase (13 tablas) |
| Cada 5 minutos | Pull comandos + contactos nuevos |

### Modelos sincronizados (13)

| Odoo Model | Supabase Table | Status |
|---|---|---|
| res.partner | contacts + companies | Synced |
| product.product | odoo_products | Synced |
| sale.order.line | odoo_order_lines | Synced |
| purchase.order.line | odoo_order_lines | Synced |
| res.users | odoo_users | Synced |
| account.move | odoo_invoices | Synced |
| account.move (pagos) | odoo_payments | Synced |
| stock.picking | odoo_deliveries | Synced |
| crm.lead | odoo_crm_leads | Synced |
| mail.activity | odoo_activities | Synced |
| mrp.production | odoo_manufacturing | Synced |
| hr.employee | odoo_employees | Synced |
| hr.department | odoo_departments | Synced |
| sale.order | odoo_sale_orders | Synced |
| purchase.order | odoo_purchase_orders | Synced |

### Modelos pendientes (7)

| Odoo Model | Prioridad | Valor |
|---|---|---|
| stock.warehouse.orderpoint | High | Deteccion de desabasto |
| account.payment.term | Medium | Prediccion de pago |
| res.partner.category | Medium | Segmentacion de clientes |
| mail.message | Medium | Comunicacion interna |
| mrp.bom | Medium | Costos de produccion |
| quality.check | Medium | Tracking de calidad |
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
