# Quimibond Intelligence

Frontend de inteligencia comercial para Quimibond, empresa textil mexicana. El sistema analiza emails de clientes con IA para generar alertas, briefings, perfiles de personalidad y acciones sugeridas.

## Stack

- Next.js 15 (App Router) + React 19
- Supabase (PostgreSQL + pgvector + RLS)
- Claude API (Sonnet 4.6) para chat y análisis
- Tailwind CSS 4 + shadcn/ui components
- TypeScript 5.8

## Estructura de carpetas

```
src/app/                    # Pages (App Router)
  dashboard/                # KPIs, último briefing, alertas recientes, acciones pendientes
  chat/                     # Chat conversacional Q&A con Claude
  briefings/ + [id]/        # Lista y detalle de briefings generados
  alerts/                   # Alertas con filtros por estado (new/acknowledged/resolved)
  actions/                  # Acciones sugeridas con filtros por estado
  contacts/ + [id]/         # Lista de contactos y perfil detallado con personalidad
  api/chat/                 # POST endpoint — obtiene contexto de Supabase y consulta Claude

src/components/
  layout/sidebar.tsx        # Navegación lateral fija
  ui/                       # Card, Badge, Button (estilo shadcn)

src/lib/
  supabase.ts               # Cliente Supabase con lazy proxy
  utils.ts                  # cn(), formatCurrency(), timeAgo()

supabase/migrations/        # 22 migrations (006 = consolidated redesign)
```

## Base de datos (32 tablas, 7 tiers)

Tier 1 — Core: companies, contacts
Tier 2 — Communication: threads, emails (pgvector), email_recipients, communication_edges
Tier 3 — Knowledge Graph: entities, facts, entity_relationships
Tier 4 — Intelligence: alerts, action_items, briefings, topics
Tier 5 — Metrics: health_scores, revenue_metrics, communication_metrics, odoo_snapshots
Tier 6 — Odoo: odoo_products, odoo_order_lines, odoo_users, odoo_invoices, odoo_payments, odoo_deliveries, odoo_crm_leads, odoo_activities
Tier 7 — System: sync_state, sync_commands, pipeline_runs, pipeline_logs, chat_memory, feedback_signals, token_usage

Schema registry (source of truth): `qb19/addons/quimibond_intelligence/services/sync_schema.py`

## Relación con qb19

El repo **qb19** es un addon de Odoo que ejecuta el pipeline de inteligencia:
1. Ingesta emails via Gmail API
2. Analiza con Claude (sentimiento, intención, hechos)
3. Genera embeddings, alertas, acciones y briefings
4. Escribe todo en la misma base Supabase

Este repo (quimibond-intelligence) es el **frontend read-mostly** que consume esos datos. Las únicas escrituras del frontend son cambios de estado en alerts y action_items.

## Idioma

- Código: inglés (variables, funciones, componentes)
- Contenido de negocio / UI labels: español (México)
- Comentarios: inglés o español según contexto

## Comandos

```
npm run dev      # localhost:3000
npm run build    # producción
npm run lint     # ESLint
```
