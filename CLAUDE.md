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

supabase/migrations/        # 001_initial_schema.sql (18 tablas, 6 RPC functions, RLS, vector index)
```

## Base de datos (18 tablas)

Core: contacts, person_profiles, emails, email_threads, email_attachments
Análisis: email_analyses, topics, email_topics, facts, contact_interactions
Operación: alerts, alert_rules, action_items, briefings, briefing_sections
Infraestructura: embeddings (pgvector), pipeline_runs, pipeline_logs

## Relación con qb19

El repo **qb19** es un addon de Odoo que ejecuta el pipeline de inteligencia:
1. Ingesta emails via IMAP/API
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
