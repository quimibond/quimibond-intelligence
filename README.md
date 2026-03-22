# Quimibond Intelligence

Frontend de inteligencia comercial para Quimibond. Procesa emails, genera alertas, briefings y perfiles de contacto usando IA.

## Stack

- **Next.js 15** (App Router) + **React 19**
- **Supabase** (PostgreSQL + pgvector + RLS)
- **Claude API** (Sonnet 4.6) para chat y análisis
- **Tailwind CSS 4** + **shadcn/ui**
- **TypeScript 5.8**

## Setup

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.local.example .env.local
# Editar .env.local con tus keys de Supabase y Anthropic

# 3. Aplicar schema en Supabase
# Ejecutar supabase/migrations/001_initial_schema.sql en el SQL Editor de Supabase

# 4. Iniciar desarrollo
npm run dev
```

La app corre en [http://localhost:3000](http://localhost:3000).

## Variables de entorno

| Variable | Descripción |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key de Supabase |
| `SUPABASE_SERVICE_KEY` | Service key (solo server-side, opcional) |
| `ANTHROPIC_API_KEY` | API key de Anthropic para Claude |

## Estructura del proyecto

```
├── src/
│   ├── app/
│   │   ├── dashboard/       # Dashboard con KPIs, briefings, alertas
│   │   ├── chat/            # Chat Q&A con Claude
│   │   ├── briefings/       # Lista y detalle de briefings
│   │   ├── alerts/          # Gestión de alertas
│   │   ├── actions/         # Acciones pendientes
│   │   ├── contacts/        # Lista y perfil de contactos
│   │   └── api/chat/        # API route para Claude
│   ├── components/
│   │   ├── layout/          # Sidebar
│   │   └── ui/              # Card, Badge, Button (shadcn)
│   └── lib/
│       ├── supabase.ts      # Cliente Supabase
│       └── utils.ts         # Utilidades (formatCurrency, timeAgo, cn)
├── supabase/
│   └── migrations/          # Schema SQL (18 tablas, RPC, RLS)
└── package.json
```

## Repo relacionado

**[qb19](https://github.com/quimibond/qb19)** — Addon de Odoo que ejecuta el pipeline de inteligencia: ingesta de emails, análisis con Claude, extracción de hechos, generación de alertas y briefings. Los datos procesados se escriben en la misma base Supabase que consume este frontend.

## Scripts

```bash
npm run dev      # Desarrollo (localhost:3000)
npm run build    # Build de producción
npm run start    # Servir build de producción
npm run lint     # ESLint
```
