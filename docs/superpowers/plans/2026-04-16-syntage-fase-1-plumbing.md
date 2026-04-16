# Syntage Fase 1 — Plumbing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la infraestructura para recibir webhooks de Syntage y persistir CFDIs + datos fiscales en Supabase, con soporte multi-entidad (N empresas Quimibond) e idempotencia. Al terminar, un webhook simulado sandbox debe popular las tablas correctamente.

**Architecture:** 11 tablas `syntage_*` en Supabase (7 de datos + 3 de plumbing + 1 entity_map), endpoint Next.js `/api/syntage/webhook` con validación HMAC, idempotencia via `syntage_webhook_events`, dispatch por `event.type` a handlers dedicados, y registro en `ingestion.*` core existente. Cero lógica de negocio — solo recepción, validación, y persistencia.

**Tech Stack:** Supabase (Postgres 15), Next.js 15 App Router, `@supabase/supabase-js`, Vitest, crypto (Node built-in).

**Spec padre:** `docs/superpowers/specs/2026-04-16-syntage-integration-design.md`

---

## File Structure

### Supabase migrations (`supabase/migrations/`)
- `20260417_syntage_001_entity_map.sql` — tabla `syntage_entity_map` con seed
- `20260417_syntage_002_taxpayers_extractions.sql` — `syntage_taxpayers`, `syntage_extractions`
- `20260417_syntage_003_files_webhook_events.sql` — `syntage_files`, `syntage_webhook_events`
- `20260417_syntage_004_invoices.sql` — `syntage_invoices` + índices + trigger auto-link
- `20260417_syntage_005_invoice_line_items.sql` — `syntage_invoice_line_items`
- `20260417_syntage_006_invoice_payments.sql` — `syntage_invoice_payments`
- `20260417_syntage_007_tax_retentions_returns.sql` — retenciones + declaraciones
- `20260417_syntage_008_tax_status_eaccounting.sql` — status + e-accounting
- `20260417_syntage_009_ingestion_registry.sql` — rows en `ingestion.source_registry`

### Libraries (`src/lib/syntage/`)
- `signature.ts` — validación HMAC-SHA256 de header `X-Syntage-Signature`
- `idempotency.ts` — check + insert en `syntage_webhook_events`
- `entity-resolver.ts` — lookup en `syntage_entity_map` por RFC → `odoo_company_id`
- `handlers/invoice.ts` — upsert `syntage_invoices`
- `handlers/invoice-line-item.ts` — upsert `syntage_invoice_line_items`
- `handlers/invoice-payment.ts` — upsert `syntage_invoice_payments`
- `handlers/tax-retention.ts` — upsert `syntage_tax_retentions`
- `handlers/tax-return.ts` — upsert `syntage_tax_returns`
- `handlers/tax-status.ts` — upsert `syntage_tax_status`
- `handlers/electronic-accounting.ts` — upsert `syntage_electronic_accounting`
- `handlers/admin.ts` — logea `credential.*`, `link.*`, `extraction.*`, `file.created`
- `dispatcher.ts` — mapea `event.type` → handler adecuado
- `types.ts` — tipos TypeScript del payload Syntage (subset denormalizado + `raw_payload`)

### Endpoint (`src/app/api/syntage/`)
- `webhook/route.ts` — POST receptor

### Tests (`src/__tests__/syntage/`)
- `signature.test.ts`
- `idempotency.test.ts`
- `entity-resolver.test.ts`
- `handlers/invoice.test.ts`
- `handlers/invoice-payment.test.ts`
- `handlers/line-item.test.ts`
- `handlers/tax.test.ts`
- `handlers/admin.test.ts`
- `dispatcher.test.ts`
- `webhook-e2e.test.ts`

### Config
- `.env.local.example` — nuevo `SYNTAGE_WEBHOOK_SECRET`, `SYNTAGE_API_KEY`, `SYNTAGE_API_BASE`

---

## Task 1: Setup Env Vars + Supabase Storage Bucket

**Files:**
- Modify: `.env.local.example`
- Manual: Vercel env vars + Supabase Storage UI

- [ ] **Step 1: Añadir variables al ejemplo de env**

Añadir a `.env.local.example`:

```bash
# Syntage (Mexican SAT integration)
SYNTAGE_API_BASE=https://api.syntage.com
SYNTAGE_API_KEY=
SYNTAGE_WEBHOOK_SECRET=
```

- [ ] **Step 2: Configurar en Vercel (manual, dashboard)**

Production + Preview + Development environments, todos los valores:
- `SYNTAGE_API_BASE=https://api.syntage.com`
- `SYNTAGE_API_KEY=<production key desde dashboard Syntage>`
- `SYNTAGE_WEBHOOK_SECRET=<generado al crear webhook endpoint en Syntage>`

Para desarrollo local, crear `.env.local` (gitignored) con sandbox keys.

- [ ] **Step 3: Crear bucket de Supabase Storage**

Vía Supabase dashboard (Storage → New bucket):
- Name: `syntage-files`
- Public: **false**
- File size limit: `10 MB`
- Allowed MIME types: `text/xml, application/xml, application/pdf`

Luego aplicar policy service-role-only vía SQL:

```sql
-- Deny all public access; only service_role reads/writes
CREATE POLICY "syntage_files_service_only"
ON storage.objects
FOR ALL
TO service_role
USING (bucket_id = 'syntage-files')
WITH CHECK (bucket_id = 'syntage-files');
```

- [ ] **Step 4: Verificar configuración**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
grep -E "SYNTAGE_" .env.local.example
```

Expected: 3 líneas con las 3 variables.

- [ ] **Step 5: Commit**

```bash
git add .env.local.example
git commit -m "chore(syntage): add Syntage env var placeholders"
```

---

## Task 2: Migration — `syntage_entity_map`

**Files:**
- Create: `supabase/migrations/20260417_syntage_001_entity_map.sql`

- [ ] **Step 1: Escribir migración**

```sql
-- Syntage Fase 1 · Migration 001 — syntage_entity_map
-- Multi-tenant bridge: maps each Syntage taxpayer (by RFC) to its
-- corresponding Odoo res.company.id. This is the SINGLE source of truth
-- for "which Syntage events belong to which Quimibond entity".

CREATE TABLE public.syntage_entity_map (
  taxpayer_rfc      text PRIMARY KEY,
  odoo_company_id   int  UNIQUE NOT NULL,
  alias             text NOT NULL,
  is_active         bool NOT NULL DEFAULT true,
  backfill_from     date,
  priority          text NOT NULL DEFAULT 'secondary'
                    CHECK (priority IN ('primary', 'secondary')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_syntage_entity_map_active
  ON public.syntage_entity_map (taxpayer_rfc) WHERE is_active = true;

-- RLS: deny all by default, service_role only
ALTER TABLE public.syntage_entity_map ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_entity_map FROM anon, authenticated;

COMMENT ON TABLE public.syntage_entity_map IS
  'Bridge between Syntage taxpayers (RFC) and Odoo companies. Populated manually. Webhook handler rejects unmapped RFCs.';

-- Seed rows (REEMPLAZAR con los RFCs/company_ids reales de Quimibond):
-- INSERT INTO public.syntage_entity_map
--   (taxpayer_rfc, odoo_company_id, alias, priority, backfill_from)
-- VALUES
--   ('QIN_RFC_EXAMPLE', 1, 'Quimibond Industrial', 'primary', '2012-03-15');
```

- [ ] **Step 2: Aplicar migración**

Vía Supabase MCP `apply_migration` (preferido) o CLI:

```bash
# Opción MCP (preferida — registra en schema history):
# mcp__claude_ai_Supabase__apply_migration con project_id=tozqezmivpblmcubmnpi,
# name=20260417_syntage_001_entity_map, query=<contenido de arriba>

# Opción CLI (si no hay MCP):
supabase db push --include-all
```

- [ ] **Step 3: Verificar schema**

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'syntage_entity_map'
ORDER BY ordinal_position;
```

Expected: 8 rows (taxpayer_rfc, odoo_company_id, alias, is_active, backfill_from, priority, created_at, updated_at).

- [ ] **Step 4: Popular con entidades reales de Quimibond**

El usuario debe proveer los pares RFC ↔ odoo_company_id. Ejecutar:

```sql
INSERT INTO public.syntage_entity_map
  (taxpayer_rfc, odoo_company_id, alias, priority, backfill_from)
VALUES
  ('<RFC_1>', <company_id_1>, '<alias_1>', 'primary', '<fecha_alta_SAT>'),
  ('<RFC_2>', <company_id_2>, '<alias_2>', 'secondary', '<fecha_alta_SAT>');
-- Añadir tantas como entidades Quimibond existan
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260417_syntage_001_entity_map.sql
git commit -m "feat(syntage): add syntage_entity_map multi-tenant bridge table"
```

---

## Task 2.5: Verificar escenario multi-empresa en Odoo antes de seguir

**Files:** (sin archivos — es validación manual contra Supabase/Odoo)

- [ ] **Step 1: Confirmar cuántas empresas Odoo existen**

```sql
-- En Supabase:
SELECT DISTINCT company_id FROM odoo_invoices ORDER BY 1;
-- o si existe tabla companies de Odoo:
SELECT id, name FROM odoo_companies ORDER BY id;
```

Anotar los `company_id` encontrados. Si es solo 1, el scope multi-tenant se simplifica (una sola row en `syntage_entity_map`).

- [ ] **Step 2: Confirmar RFCs en Syntage dashboard**

Manualmente, loguearse a Syntage → ver lista de `taxpayers` / `entities`. Anotar cada RFC + nombre.

- [ ] **Step 3: Crear el mapeo en `syntage_entity_map`**

Con los datos de Steps 1-2, ejecutar el INSERT del Task 2 Step 4 con valores reales.

- [ ] **Step 4: Verificar**

```sql
SELECT taxpayer_rfc, odoo_company_id, alias, is_active FROM syntage_entity_map;
```

Expected: una row por entidad, `is_active=true`.

- [ ] **Step 5: No commit necesario** (la seed data no se commitea por ser específica de Quimibond — documentar en CLAUDE.md interno si se desea).

---

## Task 3: Migration — `syntage_taxpayers` + `syntage_extractions`

**Files:**
- Create: `supabase/migrations/20260417_syntage_002_taxpayers_extractions.sql`

- [ ] **Step 1: Escribir migración**

```sql
-- Syntage Fase 1 · Migration 002 — plumbing tables
-- taxpayers: espejo de /taxpayers en Syntage (una row por entidad)
-- extractions: log de tareas de extracción (status + timing)

CREATE TABLE public.syntage_taxpayers (
  rfc                 text PRIMARY KEY,
  person_type         text CHECK (person_type IN ('physical', 'legal')),
  name                text,
  registration_date   date,
  raw_payload         jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.syntage_taxpayers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_taxpayers FROM anon, authenticated;

COMMENT ON TABLE public.syntage_taxpayers IS
  'Mirror of Syntage taxpayers. One row per Quimibond entity configured in Syntage.';

CREATE TABLE public.syntage_extractions (
  syntage_id          text PRIMARY KEY,
  taxpayer_rfc        text NOT NULL REFERENCES public.syntage_taxpayers(rfc),
  odoo_company_id     int,
  extractor_type      text NOT NULL,
  options             jsonb,
  status              text NOT NULL CHECK (status IN
                        ('pending','waiting','running','finished','failed','stopping','stopped','cancelled')),
  started_at          timestamptz,
  finished_at         timestamptz,
  rows_produced       int DEFAULT 0,
  error               text,
  raw_payload         jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_syntage_extractions_taxpayer_status
  ON public.syntage_extractions (taxpayer_rfc, status, started_at DESC);

ALTER TABLE public.syntage_extractions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_extractions FROM anon, authenticated;

COMMENT ON TABLE public.syntage_extractions IS
  'Log of Syntage extraction jobs. Used for backfill progress tracking and debugging.';
```

- [ ] **Step 2: Aplicar migración** (vía MCP `apply_migration` o `supabase db push`)

- [ ] **Step 3: Verificar schema**

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('syntage_taxpayers', 'syntage_extractions')
ORDER BY table_name, ordinal_position;
```

Expected: 7 cols en taxpayers, 13 cols en extractions.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260417_syntage_002_taxpayers_extractions.sql
git commit -m "feat(syntage): add syntage_taxpayers and syntage_extractions tables"
```

---

## Task 4: Migration — `syntage_files` + `syntage_webhook_events`

**Files:**
- Create: `supabase/migrations/20260417_syntage_003_files_webhook_events.sql`

- [ ] **Step 1: Escribir migración**

```sql
-- Syntage Fase 1 · Migration 003 — files + webhook_events
-- files: metadata de XMLs/PDFs descargados a Supabase Storage
-- webhook_events: idempotencia de eventos recibidos

CREATE TABLE public.syntage_files (
  id                          bigserial PRIMARY KEY,
  syntage_id                  text UNIQUE NOT NULL,
  taxpayer_rfc                text NOT NULL,
  odoo_company_id             int,
  file_type                   text NOT NULL,
  filename                    text,
  mime_type                   text,
  size_bytes                  bigint,
  storage_path                text,
  download_url_cached_until   timestamptz,
  raw_payload                 jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_syntage_files_taxpayer
  ON public.syntage_files (taxpayer_rfc, file_type);

ALTER TABLE public.syntage_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_files FROM anon, authenticated;

COMMENT ON TABLE public.syntage_files IS
  'Metadata of XML/PDF files downloaded from Syntage. Binary content lives in Storage bucket syntage-files.';

-- Idempotencia de webhooks: cada event_id visto se registra una vez.
CREATE TABLE public.syntage_webhook_events (
  event_id       text PRIMARY KEY,
  event_type     text NOT NULL,
  source         text NOT NULL DEFAULT 'webhook'
                 CHECK (source IN ('webhook', 'reconcile')),
  received_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_syntage_webhook_events_received
  ON public.syntage_webhook_events (received_at DESC);

ALTER TABLE public.syntage_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_webhook_events FROM anon, authenticated;

COMMENT ON TABLE public.syntage_webhook_events IS
  'Event-id deduplication. ON CONFLICT DO NOTHING guarantees at-most-once processing.';
```

- [ ] **Step 2: Aplicar migración**

- [ ] **Step 3: Verificar**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('syntage_files', 'syntage_webhook_events');
```

Expected: 2 rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260417_syntage_003_files_webhook_events.sql
git commit -m "feat(syntage): add syntage_files + syntage_webhook_events tables"
```

---

## Task 5: Migration — `syntage_invoices` + auto-link trigger

**Files:**
- Create: `supabase/migrations/20260417_syntage_004_invoices.sql`

- [ ] **Step 1: Escribir migración**

```sql
-- Syntage Fase 1 · Migration 004 — syntage_invoices
-- Core table: CFDIs tipo I (Ingreso) + E (Egreso), issued and received.

CREATE TABLE public.syntage_invoices (
  syntage_id                    text PRIMARY KEY,
  uuid                          text UNIQUE NOT NULL,
  taxpayer_rfc                  text NOT NULL,
  odoo_company_id               int,
  direction                     text NOT NULL CHECK (direction IN ('issued', 'received')),

  tipo_comprobante              text,
  serie                         text,
  folio                         text,
  fecha_emision                 timestamptz,
  fecha_timbrado                timestamptz,

  emisor_rfc                    text,
  emisor_nombre                 text,
  receptor_rfc                  text,
  receptor_nombre               text,

  subtotal                      numeric(18,2),
  descuento                     numeric(18,2),
  total                         numeric(18,2),
  moneda                        text,
  tipo_cambio                   numeric(18,6) DEFAULT 1,
  total_mxn                     numeric(18,2) GENERATED ALWAYS AS
                                (total * COALESCE(tipo_cambio, 1)) STORED,

  impuestos_trasladados         numeric(18,2),
  impuestos_retenidos           numeric(18,2),

  metodo_pago                   text,
  forma_pago                    text,
  uso_cfdi                      text,

  estado_sat                    text DEFAULT 'vigente'
                                CHECK (estado_sat IN
                                  ('vigente','cancelado','cancelacion_pendiente')),
  fecha_cancelacion             timestamptz,

  emisor_blacklist_status       text,
  receptor_blacklist_status     text,

  xml_file_id                   bigint REFERENCES public.syntage_files(id)
                                ON DELETE SET NULL,
  pdf_file_id                   bigint REFERENCES public.syntage_files(id)
                                ON DELETE SET NULL,

  company_id                    bigint REFERENCES public.companies(id)
                                ON DELETE SET NULL,

  raw_payload                   jsonb,
  source_id                     bigint,
  source_ref                    text,
  synced_at                     timestamptz NOT NULL DEFAULT now(),
  created_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_syntage_invoices_taxpayer_dir_date
  ON public.syntage_invoices (taxpayer_rfc, direction, fecha_emision DESC);
CREATE INDEX idx_syntage_invoices_company
  ON public.syntage_invoices (company_id);
CREATE INDEX idx_syntage_invoices_odoo_company
  ON public.syntage_invoices (odoo_company_id);
CREATE INDEX idx_syntage_invoices_cancelled
  ON public.syntage_invoices (estado_sat, fecha_cancelacion DESC)
  WHERE estado_sat = 'cancelado';

ALTER TABLE public.syntage_invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_invoices FROM anon, authenticated;

COMMENT ON TABLE public.syntage_invoices IS
  'CFDIs I/E from SAT via Syntage. uuid is join key with odoo_invoices.cfdi_uuid.';

-- Trigger: auto-link company_id vía RFC (counterparty, no nuestra entidad)
CREATE OR REPLACE FUNCTION public.auto_link_syntage_invoice_company()
RETURNS TRIGGER AS $$
DECLARE
  v_counterparty_rfc text;
BEGIN
  v_counterparty_rfc := CASE
    WHEN NEW.direction = 'received' THEN NEW.emisor_rfc
    WHEN NEW.direction = 'issued'   THEN NEW.receptor_rfc
  END;

  IF v_counterparty_rfc IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO NEW.company_id
  FROM public.companies
  WHERE lower(rfc) = lower(v_counterparty_rfc)
  LIMIT 1;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

CREATE TRIGGER trg_auto_link_syntage_invoice_company
BEFORE INSERT OR UPDATE OF emisor_rfc, receptor_rfc, direction
ON public.syntage_invoices
FOR EACH ROW
EXECUTE FUNCTION public.auto_link_syntage_invoice_company();

COMMENT ON FUNCTION public.auto_link_syntage_invoice_company() IS
  'Populates company_id by matching counterparty RFC against companies.rfc.';
```

- [ ] **Step 2: Aplicar migración**

- [ ] **Step 3: Verificar trigger funciona**

```sql
-- Seed de prueba (asumiendo que existe una company con un RFC conocido)
INSERT INTO public.syntage_invoices
  (syntage_id, uuid, taxpayer_rfc, direction, emisor_rfc, receptor_rfc, total, moneda)
SELECT '/invoices/test-uuid-0001', 'test-uuid-0001', 'TEST_RFC',
       'received', rfc, 'QIN_RFC_EXAMPLE', 100.00, 'MXN'
FROM public.companies WHERE rfc IS NOT NULL LIMIT 1;

SELECT syntage_id, emisor_rfc, company_id IS NOT NULL as company_linked
FROM public.syntage_invoices WHERE syntage_id = '/invoices/test-uuid-0001';

-- Cleanup
DELETE FROM public.syntage_invoices WHERE syntage_id = '/invoices/test-uuid-0001';
```

Expected: `company_linked=true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260417_syntage_004_invoices.sql
git commit -m "feat(syntage): add syntage_invoices with auto-link trigger"
```

---

## Task 6: Migration — `syntage_invoice_line_items`

**Files:**
- Create: `supabase/migrations/20260417_syntage_005_invoice_line_items.sql`

- [ ] **Step 1: Escribir migración**

```sql
-- Syntage Fase 1 · Migration 005 — invoice line items (conceptos del CFDI)

CREATE TABLE public.syntage_invoice_line_items (
  syntage_id        text PRIMARY KEY,
  invoice_uuid      text NOT NULL REFERENCES public.syntage_invoices(uuid)
                    ON DELETE CASCADE,
  taxpayer_rfc      text NOT NULL,
  odoo_company_id   int,
  line_number       int,
  clave_prod_serv   text,
  descripcion       text,
  cantidad          numeric(18,4),
  clave_unidad      text,
  unidad            text,
  valor_unitario    numeric(18,4),
  importe           numeric(18,2),
  descuento         numeric(18,2),
  raw_payload       jsonb,
  source_id         bigint,
  source_ref        text,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_syntage_line_items_invoice
  ON public.syntage_invoice_line_items (invoice_uuid, line_number);
CREATE INDEX idx_syntage_line_items_clave_prod_serv
  ON public.syntage_invoice_line_items (clave_prod_serv);

ALTER TABLE public.syntage_invoice_line_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_invoice_line_items FROM anon, authenticated;
```

- [ ] **Step 2: Aplicar migración**

- [ ] **Step 3: Verificar**

```sql
SELECT count(*) FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'syntage_invoice_line_items';
```

Expected: 17 rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260417_syntage_005_invoice_line_items.sql
git commit -m "feat(syntage): add syntage_invoice_line_items table"
```

---

## Task 7: Migration — `syntage_invoice_payments`

**Files:**
- Create: `supabase/migrations/20260417_syntage_006_invoice_payments.sql`

- [ ] **Step 1: Escribir migración**

```sql
-- Syntage Fase 1 · Migration 006 — Complementos de Pago (CFDI Tipo P)

CREATE TABLE public.syntage_invoice_payments (
  syntage_id              text PRIMARY KEY,
  uuid_complemento        text UNIQUE NOT NULL,
  taxpayer_rfc            text NOT NULL,
  odoo_company_id         int,
  direction               text NOT NULL CHECK (direction IN ('issued','received')),

  fecha_pago              timestamptz,
  forma_pago_p            text,
  moneda_p                text,
  tipo_cambio_p           numeric(18,6),
  monto                   numeric(18,2),
  num_operacion           text,
  rfc_emisor_cta_ord      text,
  rfc_emisor_cta_ben      text,

  doctos_relacionados     jsonb,

  estado_sat              text DEFAULT 'vigente'
                          CHECK (estado_sat IN
                            ('vigente','cancelado','cancelacion_pendiente')),

  xml_file_id             bigint REFERENCES public.syntage_files(id)
                          ON DELETE SET NULL,

  raw_payload             jsonb,
  source_id               bigint,
  source_ref              text,
  synced_at               timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_syntage_payments_taxpayer_date
  ON public.syntage_invoice_payments (taxpayer_rfc, fecha_pago DESC);
CREATE INDEX idx_syntage_payments_num_op
  ON public.syntage_invoice_payments (num_operacion);
CREATE INDEX idx_syntage_payments_doctos_gin
  ON public.syntage_invoice_payments USING gin (doctos_relacionados);

ALTER TABLE public.syntage_invoice_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_invoice_payments FROM anon, authenticated;

COMMENT ON TABLE public.syntage_invoice_payments IS
  'CFDI Type P (complementos de pago). doctos_relacionados explodes to [{uuid_docto, parcialidad, imp_pagado, imp_saldo_insoluto}].';
```

- [ ] **Step 2: Aplicar migración**

- [ ] **Step 3: Verificar**

```sql
SELECT count(*) FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'syntage_invoice_payments';
```

Expected: 19 rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260417_syntage_006_invoice_payments.sql
git commit -m "feat(syntage): add syntage_invoice_payments (CFDI Tipo P) table"
```

---

## Task 8: Migration — `syntage_tax_retentions` + `syntage_tax_returns`

**Files:**
- Create: `supabase/migrations/20260417_syntage_007_tax_retentions_returns.sql`

- [ ] **Step 1: Escribir migración**

```sql
-- Syntage Fase 1 · Migration 007 — Retenciones + Declaraciones

CREATE TABLE public.syntage_tax_retentions (
  syntage_id                text PRIMARY KEY,
  uuid                      text UNIQUE NOT NULL,
  taxpayer_rfc              text NOT NULL,
  odoo_company_id           int,
  direction                 text NOT NULL CHECK (direction IN ('issued','received')),

  fecha_emision             timestamptz,
  emisor_rfc                text,
  emisor_nombre             text,
  receptor_rfc              text,
  receptor_nombre           text,

  tipo_retencion            text,
  monto_total_operacion     numeric(18,2),
  monto_total_gravado       numeric(18,2),
  monto_total_retenido      numeric(18,2),
  impuestos_retenidos       jsonb,

  estado_sat                text DEFAULT 'vigente',

  xml_file_id               bigint REFERENCES public.syntage_files(id)
                            ON DELETE SET NULL,

  raw_payload               jsonb,
  source_id                 bigint,
  source_ref                text,
  synced_at                 timestamptz NOT NULL DEFAULT now(),
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_syntage_retentions_taxpayer
  ON public.syntage_tax_retentions (taxpayer_rfc, fecha_emision DESC);

ALTER TABLE public.syntage_tax_retentions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_tax_retentions FROM anon, authenticated;


CREATE TABLE public.syntage_tax_returns (
  syntage_id                text PRIMARY KEY,
  taxpayer_rfc              text NOT NULL,
  odoo_company_id           int,
  return_type               text NOT NULL CHECK (return_type IN
                              ('monthly','annual','rif')),
  ejercicio                 int NOT NULL,
  periodo                   text NOT NULL,
  impuesto                  text,
  fecha_presentacion        timestamptz,
  monto_pagado              numeric(18,2),
  tipo_declaracion          text DEFAULT 'normal'
                            CHECK (tipo_declaracion IN
                              ('normal','complementaria')),
  numero_operacion          text,
  pdf_file_id               bigint REFERENCES public.syntage_files(id)
                            ON DELETE SET NULL,
  raw_payload               jsonb,
  source_id                 bigint,
  source_ref                text,
  synced_at                 timestamptz NOT NULL DEFAULT now(),
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (taxpayer_rfc, return_type, ejercicio, periodo, impuesto,
          tipo_declaracion, numero_operacion)
);

CREATE INDEX idx_syntage_tax_returns_lookup
  ON public.syntage_tax_returns (taxpayer_rfc, ejercicio, periodo);

ALTER TABLE public.syntage_tax_returns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_tax_returns FROM anon, authenticated;
```

- [ ] **Step 2: Aplicar migración**

- [ ] **Step 3: Verificar**

```sql
SELECT table_name, count(column_name) as col_count
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('syntage_tax_retentions', 'syntage_tax_returns')
GROUP BY table_name;
```

Expected: 2 rows — retentions ~19 cols, returns ~16 cols.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260417_syntage_007_tax_retentions_returns.sql
git commit -m "feat(syntage): add syntage_tax_retentions and syntage_tax_returns"
```

---

## Task 9: Migration — `syntage_tax_status` + `syntage_electronic_accounting`

**Files:**
- Create: `supabase/migrations/20260417_syntage_008_tax_status_eaccounting.sql`

- [ ] **Step 1: Escribir migración**

```sql
-- Syntage Fase 1 · Migration 008 — Tax status + e-accounting

CREATE TABLE public.syntage_tax_status (
  syntage_id                  text PRIMARY KEY,
  taxpayer_rfc                text NOT NULL,
  odoo_company_id             int,
  target_rfc                  text NOT NULL,
  fecha_consulta              timestamptz,
  opinion_cumplimiento        text CHECK (opinion_cumplimiento IN
                                ('positiva','negativa','sin_opinion')),
  regimen_fiscal              text,
  domicilio_fiscal            jsonb,
  actividades_economicas      jsonb,
  pdf_file_id                 bigint REFERENCES public.syntage_files(id)
                              ON DELETE SET NULL,
  raw_payload                 jsonb,
  source_id                   bigint,
  source_ref                  text,
  synced_at                   timestamptz NOT NULL DEFAULT now(),
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_syntage_tax_status_target
  ON public.syntage_tax_status (target_rfc, fecha_consulta DESC);

ALTER TABLE public.syntage_tax_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_tax_status FROM anon, authenticated;


CREATE TABLE public.syntage_electronic_accounting (
  syntage_id          text PRIMARY KEY,
  taxpayer_rfc        text NOT NULL,
  odoo_company_id     int,
  record_type         text NOT NULL CHECK (record_type IN
                        ('balanza','catalogo_cuentas','polizas')),
  ejercicio           int NOT NULL,
  periodo             text NOT NULL,
  tipo_envio          text DEFAULT 'normal',
  hash                text,
  xml_file_id         bigint REFERENCES public.syntage_files(id)
                      ON DELETE SET NULL,
  raw_payload         jsonb,
  source_id           bigint,
  source_ref          text,
  synced_at           timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (taxpayer_rfc, record_type, ejercicio, periodo, tipo_envio)
);

ALTER TABLE public.syntage_electronic_accounting ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_electronic_accounting FROM anon, authenticated;
```

- [ ] **Step 2: Aplicar migración**

- [ ] **Step 3: Verificar**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('syntage_tax_status','syntage_electronic_accounting');
```

Expected: 2 rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260417_syntage_008_tax_status_eaccounting.sql
git commit -m "feat(syntage): add syntage_tax_status and syntage_electronic_accounting"
```

---

## Task 10: Migration — `ingestion.source_registry` rows para Syntage

**Files:**
- Create: `supabase/migrations/20260417_syntage_009_ingestion_registry.sql`

- [ ] **Step 1: Escribir migración**

```sql
-- Syntage Fase 1 · Migration 009 — register Syntage sources in ingestion core

INSERT INTO ingestion.source_registry
  (source_id, table_name, entity_kind, sla_minutes, priority, owner_agent,
   reconciliation_window_days, is_active)
VALUES
  ('syntage', 'syntage_invoices',              'invoice',          15,    'critical',  'finance', 30,  true),
  ('syntage', 'syntage_invoice_line_items',    'invoice_line',     15,    'important', 'finance', 30,  true),
  ('syntage', 'syntage_invoice_payments',      'payment_cfdi',     15,    'critical',  'finance', 30,  true),
  ('syntage', 'syntage_tax_retentions',        'retention_cfdi',   60,    'important', 'finance', 90,  true),
  ('syntage', 'syntage_tax_returns',           'tax_return',       1440,  'important', 'risk',    365, true),
  ('syntage', 'syntage_tax_status',            'tax_status',       1440,  'important', 'risk',    90,  true),
  ('syntage', 'syntage_electronic_accounting', 'eaccounting',      10080, 'context',   'risk',    365, true)
ON CONFLICT (source_id, table_name) DO UPDATE SET
  sla_minutes                 = EXCLUDED.sla_minutes,
  priority                    = EXCLUDED.priority,
  owner_agent                 = EXCLUDED.owner_agent,
  reconciliation_window_days  = EXCLUDED.reconciliation_window_days,
  is_active                   = EXCLUDED.is_active;
```

- [ ] **Step 2: Aplicar migración**

- [ ] **Step 3: Verificar**

```sql
SELECT source_id, table_name, sla_minutes, priority, owner_agent
FROM ingestion.source_registry
WHERE source_id = 'syntage'
ORDER BY table_name;
```

Expected: 7 rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260417_syntage_009_ingestion_registry.sql
git commit -m "feat(syntage): register syntage tables in ingestion.source_registry"
```

---

## Task 11: Library — HMAC Signature Validator

**Files:**
- Create: `src/lib/syntage/signature.ts`
- Test: `src/__tests__/syntage/signature.test.ts`

- [ ] **Step 1: Escribir test que falla**

```typescript
// src/__tests__/syntage/signature.test.ts
import { describe, it, expect } from "vitest";
import { verifySyntageSignature } from "@/lib/syntage/signature";
import crypto from "crypto";

describe("verifySyntageSignature", () => {
  const secret = "test-secret-abc123";
  const body = '{"id":"evt_test","type":"invoice.created"}';

  const validSig = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  it("returns true for a valid HMAC-SHA256 signature", () => {
    expect(verifySyntageSignature(body, validSig, secret)).toBe(true);
  });

  it("returns false for an invalid signature", () => {
    expect(verifySyntageSignature(body, "nope", secret)).toBe(false);
  });

  it("returns false when signature header is missing (empty string)", () => {
    expect(verifySyntageSignature(body, "", secret)).toBe(false);
  });

  it("is constant-time — resistant to timing attacks", () => {
    const almost = validSig.slice(0, -1) + "0";
    expect(verifySyntageSignature(body, almost, secret)).toBe(false);
  });

  it("accepts signature with 'sha256=' prefix (common webhook format)", () => {
    expect(verifySyntageSignature(body, `sha256=${validSig}`, secret)).toBe(true);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar falla**

```bash
npx vitest run src/__tests__/syntage/signature.test.ts
```

Expected: FAIL — `verifySyntageSignature is not defined` o módulo no existe.

- [ ] **Step 3: Implementar**

```typescript
// src/lib/syntage/signature.ts
import crypto from "crypto";

/**
 * Verifies a Syntage webhook HMAC-SHA256 signature in constant time.
 *
 * Syntage signs the raw body with SYNTAGE_WEBHOOK_SECRET and sends the
 * digest in the X-Syntage-Signature header, optionally prefixed with "sha256=".
 */
export function verifySyntageSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) return false;

  const provided = signature.startsWith("sha256=")
    ? signature.slice("sha256=".length)
    : signature;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  if (provided.length !== expected.length) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(provided, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Ejecutar y verificar pasa**

```bash
npx vitest run src/__tests__/syntage/signature.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/syntage/signature.ts src/__tests__/syntage/signature.test.ts
git commit -m "feat(syntage): HMAC-SHA256 signature validator with timing-safe compare"
```

---

## Task 12: Library — Idempotency Check

**Files:**
- Create: `src/lib/syntage/idempotency.ts`
- Test: `src/__tests__/syntage/idempotency.test.ts`

- [ ] **Step 1: Escribir test que falla**

```typescript
// src/__tests__/syntage/idempotency.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { recordWebhookEvent } from "@/lib/syntage/idempotency";

// Minimal mock of the Supabase client shape we use.
function makeMockSupabase(onConflictRows = 0) {
  const fn = vi.fn().mockResolvedValue({ data: null, error: null, count: onConflictRows });
  return {
    from: () => ({
      upsert: (_row: unknown, _opts?: unknown) => ({
        select: () => ({
          count: fn as unknown as () => void,
        }),
      }),
    }),
    _fn: fn,
  };
}

describe("recordWebhookEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 'fresh' on first insert (count=1)", async () => {
    // implementation will actually call supabase — we test the contract:
    // it returns 'fresh' | 'duplicate' based on whether the row is new.
    // Unit test below uses a stub. Integration test happens in webhook-e2e.
    const stub = {
      async insert(eventId: string, eventType: string, source: string) {
        return { inserted: true };
      },
    };
    const result = await recordWebhookEvent(
      stub as unknown as Parameters<typeof recordWebhookEvent>[0],
      "evt_1", "invoice.created", "webhook",
    );
    expect(result).toBe("fresh");
  });

  it("returns 'duplicate' when event_id already exists", async () => {
    const stub = {
      async insert() { return { inserted: false }; },
    };
    const result = await recordWebhookEvent(
      stub as unknown as Parameters<typeof recordWebhookEvent>[0],
      "evt_1", "invoice.created", "webhook",
    );
    expect(result).toBe("duplicate");
  });
});
```

- [ ] **Step 2: Ejecutar y verificar falla**

```bash
npx vitest run src/__tests__/syntage/idempotency.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implementar**

```typescript
// src/lib/syntage/idempotency.ts
/**
 * Idempotent webhook-event recorder. Returns 'fresh' on first insert,
 * 'duplicate' if the event_id was already seen.
 *
 * Uses a thin interface so it can be unit-tested with a stub, and accepts
 * either our Supabase client wrapper or the direct @supabase/supabase-js client.
 */
export interface EventStore {
  insert(eventId: string, eventType: string, source: string): Promise<{ inserted: boolean }>;
}

export async function recordWebhookEvent(
  store: EventStore,
  eventId: string,
  eventType: string,
  source: "webhook" | "reconcile",
): Promise<"fresh" | "duplicate"> {
  const res = await store.insert(eventId, eventType, source);
  return res.inserted ? "fresh" : "duplicate";
}

/**
 * Factory that builds an EventStore backed by Supabase.
 * ON CONFLICT DO NOTHING returns 0 rows if duplicate, 1 if new.
 */
export function supabaseEventStore(
  supabase: import("@supabase/supabase-js").SupabaseClient,
): EventStore {
  return {
    async insert(eventId, eventType, source) {
      const { data, error } = await supabase
        .from("syntage_webhook_events")
        .insert({ event_id: eventId, event_type: eventType, source })
        .select("event_id");

      // Unique violation (23505) is expected for duplicates.
      if (error) {
        if (error.code === "23505") return { inserted: false };
        throw error;
      }
      return { inserted: (data ?? []).length > 0 };
    },
  };
}
```

- [ ] **Step 4: Ejecutar y verificar pasa**

```bash
npx vitest run src/__tests__/syntage/idempotency.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/syntage/idempotency.ts src/__tests__/syntage/idempotency.test.ts
git commit -m "feat(syntage): idempotency check via syntage_webhook_events"
```

---

## Task 13: Library — Entity Resolver

**Files:**
- Create: `src/lib/syntage/entity-resolver.ts`
- Test: `src/__tests__/syntage/entity-resolver.test.ts`

- [ ] **Step 1: Escribir test que falla**

```typescript
// src/__tests__/syntage/entity-resolver.test.ts
import { describe, it, expect } from "vitest";
import { resolveEntity, type EntityMapStore } from "@/lib/syntage/entity-resolver";

function makeStore(rows: { taxpayer_rfc: string; odoo_company_id: number; is_active: boolean }[]): EntityMapStore {
  return {
    async lookup(rfc) {
      const row = rows.find(r => r.taxpayer_rfc.toUpperCase() === rfc.toUpperCase() && r.is_active);
      return row ? { odooCompanyId: row.odoo_company_id } : null;
    },
  };
}

describe("resolveEntity", () => {
  const store = makeStore([
    { taxpayer_rfc: "QIN120315XX1", odoo_company_id: 1, is_active: true },
    { taxpayer_rfc: "QCO170508YY2", odoo_company_id: 2, is_active: true },
    { taxpayer_rfc: "OLD000101ZZ9", odoo_company_id: 3, is_active: false },
  ]);

  it("resolves a known active RFC to its odoo_company_id", async () => {
    expect(await resolveEntity(store, "QIN120315XX1")).toEqual({ odooCompanyId: 1 });
  });

  it("is case-insensitive on RFC", async () => {
    expect(await resolveEntity(store, "qin120315xx1")).toEqual({ odooCompanyId: 1 });
  });

  it("returns null for unmapped RFC", async () => {
    expect(await resolveEntity(store, "UNKNOWN123")).toBeNull();
  });

  it("returns null for inactive mapping", async () => {
    expect(await resolveEntity(store, "OLD000101ZZ9")).toBeNull();
  });
});
```

- [ ] **Step 2: Ejecutar y verificar falla**

```bash
npx vitest run src/__tests__/syntage/entity-resolver.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implementar**

```typescript
// src/lib/syntage/entity-resolver.ts
export interface EntityMapStore {
  lookup(taxpayerRfc: string): Promise<{ odooCompanyId: number } | null>;
}

/**
 * Resolves a Syntage taxpayer RFC to its Odoo company_id.
 * Returns null if the RFC is not in syntage_entity_map or is_active=false.
 * Case-insensitive.
 */
export async function resolveEntity(
  store: EntityMapStore,
  taxpayerRfc: string,
): Promise<{ odooCompanyId: number } | null> {
  if (!taxpayerRfc) return null;
  return store.lookup(taxpayerRfc.toUpperCase());
}

/**
 * Supabase-backed EntityMapStore implementation.
 */
export function supabaseEntityMapStore(
  supabase: import("@supabase/supabase-js").SupabaseClient,
): EntityMapStore {
  return {
    async lookup(rfc) {
      const { data, error } = await supabase
        .from("syntage_entity_map")
        .select("odoo_company_id")
        .ilike("taxpayer_rfc", rfc)
        .eq("is_active", true)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;
      return { odooCompanyId: data.odoo_company_id };
    },
  };
}
```

- [ ] **Step 4: Ejecutar y verificar pasa**

```bash
npx vitest run src/__tests__/syntage/entity-resolver.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/syntage/entity-resolver.ts src/__tests__/syntage/entity-resolver.test.ts
git commit -m "feat(syntage): entity resolver (taxpayer RFC → odoo_company_id)"
```

---

## Task 14: Library — Types + Invoice Handler

**Files:**
- Create: `src/lib/syntage/types.ts`
- Create: `src/lib/syntage/handlers/invoice.ts`
- Test: `src/__tests__/syntage/handlers/invoice.test.ts`

- [ ] **Step 1: Escribir types compartidos**

```typescript
// src/lib/syntage/types.ts

/** Envelope común de todos los webhooks Syntage. */
export interface SyntageEvent {
  id: string;
  type: string;
  taxpayer: { id: string; name?: string; personType?: "physical" | "legal" };
  source?: string;
  resource?: string;
  data: {
    object: Record<string, unknown>;
    changes?: Record<string, unknown>;
  };
  createdAt: string;
  updatedAt?: string;
}

/** Contexto que cada handler recibe (inyección de dependencias). */
export interface HandlerCtx {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  odooCompanyId: number | null;
  taxpayerRfc: string;
}

/** Subset denormalizado de un CFDI Syntage. Todo lo demás vive en raw_payload. */
export interface SyntageInvoicePayload {
  "@id": string;
  uuid: string;
  direction: "issued" | "received";
  tipoComprobante?: string;
  serie?: string;
  folio?: string;
  fechaEmision?: string;
  fechaTimbrado?: string;
  issuer?: { rfc?: string; name?: string; blacklistStatus?: string };
  receiver?: { rfc?: string; name?: string; blacklistStatus?: string };
  subtotal?: number;
  descuento?: number;
  total?: number;
  moneda?: string;
  tipoCambio?: number;
  impuestosTrasladados?: number;
  impuestosRetenidos?: number;
  metodoPago?: string;
  formaPago?: string;
  usoCfdi?: string;
  estadoSat?: "vigente" | "cancelado" | "cancelacion_pendiente";
  fechaCancelacion?: string | null;
}
```

- [ ] **Step 2: Escribir test que falla**

```typescript
// src/__tests__/syntage/handlers/invoice.test.ts
import { describe, it, expect, vi } from "vitest";
import { handleInvoiceEvent } from "@/lib/syntage/handlers/invoice";
import type { SyntageEvent } from "@/lib/syntage/types";

function makeCtx(onUpsert: (row: Record<string, unknown>) => void) {
  return {
    supabase: {
      from: (_table: string) => ({
        upsert: (row: Record<string, unknown>, _opts?: unknown) => {
          onUpsert(row);
          return Promise.resolve({ error: null });
        },
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient,
    odooCompanyId: 1,
    taxpayerRfc: "QIN120315XX1",
  };
}

describe("handleInvoiceEvent", () => {
  const baseEvent: SyntageEvent = {
    id: "evt_1",
    type: "invoice.created",
    taxpayer: { id: "QIN120315XX1" },
    data: {
      object: {
        "@id": "/invoices/abc-123",
        uuid: "abc-uuid-1234-5678-9012-345678901234",
        direction: "received",
        tipoComprobante: "I",
        serie: "A",
        folio: "100",
        fechaEmision: "2026-04-15T10:00:00Z",
        issuer: { rfc: "SUPPLIER_RFC", name: "Proveedor X" },
        receiver: { rfc: "QIN120315XX1", name: "Quimibond Industrial" },
        subtotal: 100,
        total: 116,
        moneda: "MXN",
        tipoCambio: 1,
        estadoSat: "vigente",
      },
    },
    createdAt: "2026-04-15T10:05:00Z",
  };

  it("upserts a CFDI with denormalized fields + raw_payload", async () => {
    let captured: Record<string, unknown> = {};
    const ctx = makeCtx(row => { captured = row; });
    await handleInvoiceEvent(ctx, baseEvent);
    expect(captured.syntage_id).toBe("/invoices/abc-123");
    expect(captured.uuid).toBe("abc-uuid-1234-5678-9012-345678901234");
    expect(captured.direction).toBe("received");
    expect(captured.emisor_rfc).toBe("SUPPLIER_RFC");
    expect(captured.receptor_rfc).toBe("QIN120315XX1");
    expect(captured.total).toBe(116);
    expect(captured.taxpayer_rfc).toBe("QIN120315XX1");
    expect(captured.odoo_company_id).toBe(1);
    expect(captured.estado_sat).toBe("vigente");
    expect(captured.raw_payload).toEqual(baseEvent.data.object);
  });

  it("sets estado_sat='cancelado' on invoice.deleted event", async () => {
    let captured: Record<string, unknown> = {};
    const ctx = makeCtx(row => { captured = row; });
    const evt: SyntageEvent = { ...baseEvent, type: "invoice.deleted" };
    await handleInvoiceEvent(ctx, evt);
    expect(captured.estado_sat).toBe("cancelado");
    expect(captured.fecha_cancelacion).toBeTruthy();
  });
});
```

- [ ] **Step 3: Ejecutar y verificar falla**

```bash
npx vitest run src/__tests__/syntage/handlers/invoice.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implementar**

```typescript
// src/lib/syntage/handlers/invoice.ts
import type { HandlerCtx, SyntageEvent, SyntageInvoicePayload } from "@/lib/syntage/types";

/**
 * Handles invoice.created, invoice.updated, invoice.deleted events.
 * Upserts to syntage_invoices with denormalized columns + raw_payload.
 */
export async function handleInvoiceEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as SyntageInvoicePayload;

  const isCancellation = event.type === "invoice.deleted";

  const row: Record<string, unknown> = {
    syntage_id:                obj["@id"],
    uuid:                      obj.uuid,
    taxpayer_rfc:              ctx.taxpayerRfc,
    odoo_company_id:           ctx.odooCompanyId,
    direction:                 obj.direction,
    tipo_comprobante:          obj.tipoComprobante ?? null,
    serie:                     obj.serie ?? null,
    folio:                     obj.folio ?? null,
    fecha_emision:             obj.fechaEmision ?? null,
    fecha_timbrado:            obj.fechaTimbrado ?? null,
    emisor_rfc:                obj.issuer?.rfc ?? null,
    emisor_nombre:             obj.issuer?.name ?? null,
    receptor_rfc:              obj.receiver?.rfc ?? null,
    receptor_nombre:           obj.receiver?.name ?? null,
    subtotal:                  obj.subtotal ?? null,
    descuento:                 obj.descuento ?? null,
    total:                     obj.total ?? null,
    moneda:                    obj.moneda ?? "MXN",
    tipo_cambio:               obj.tipoCambio ?? 1,
    impuestos_trasladados:     obj.impuestosTrasladados ?? null,
    impuestos_retenidos:       obj.impuestosRetenidos ?? null,
    metodo_pago:               obj.metodoPago ?? null,
    forma_pago:                obj.formaPago ?? null,
    uso_cfdi:                  obj.usoCfdi ?? null,
    estado_sat:                isCancellation ? "cancelado" : (obj.estadoSat ?? "vigente"),
    fecha_cancelacion:         isCancellation
                                 ? (obj.fechaCancelacion ?? new Date().toISOString())
                                 : (obj.fechaCancelacion ?? null),
    emisor_blacklist_status:   obj.issuer?.blacklistStatus ?? null,
    receptor_blacklist_status: obj.receiver?.blacklistStatus ?? null,
    raw_payload:               obj,
    synced_at:                 new Date().toISOString(),
  };

  const { error } = await ctx.supabase
    .from("syntage_invoices")
    .upsert(row, { onConflict: "syntage_id" });

  if (error) throw error;
}
```

- [ ] **Step 5: Ejecutar y verificar pasa + Commit**

```bash
npx vitest run src/__tests__/syntage/handlers/invoice.test.ts
```

Expected: PASS (2 tests).

```bash
git add src/lib/syntage/types.ts src/lib/syntage/handlers/invoice.ts src/__tests__/syntage/handlers/invoice.test.ts
git commit -m "feat(syntage): invoice event handler (created/updated/deleted)"
```

---

## Task 15: Handler — Invoice Payment (CFDI Tipo P)

**Files:**
- Create: `src/lib/syntage/handlers/invoice-payment.ts`
- Test: `src/__tests__/syntage/handlers/invoice-payment.test.ts`

- [ ] **Step 1: Escribir test que falla**

```typescript
// src/__tests__/syntage/handlers/invoice-payment.test.ts
import { describe, it, expect } from "vitest";
import { handleInvoicePaymentEvent } from "@/lib/syntage/handlers/invoice-payment";
import type { SyntageEvent } from "@/lib/syntage/types";

function makeCtx(capture: { row?: Record<string, unknown> }) {
  return {
    supabase: {
      from: () => ({
        upsert: (row: Record<string, unknown>) => {
          capture.row = row;
          return Promise.resolve({ error: null });
        },
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient,
    odooCompanyId: 2,
    taxpayerRfc: "QCO170508YY2",
  };
}

describe("handleInvoicePaymentEvent", () => {
  it("upserts Tipo P with doctos_relacionados as JSONB", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const event: SyntageEvent = {
      id: "evt_pay_1",
      type: "invoice_payment.created",
      taxpayer: { id: "QCO170508YY2" },
      data: {
        object: {
          "@id": "/invoice-payments/pp-001",
          uuid: "pp-uuid-0001",
          direction: "received",
          fechaPago: "2026-04-10T00:00:00Z",
          formaPagoP: "03",
          monedaP: "MXN",
          tipoCambioP: 1,
          monto: 1000,
          numOperacion: "TRF-123456",
          rfcEmisorCtaOrd: "BBVA",
          rfcEmisorCtaBen: "BANORTE",
          doctosRelacionados: [
            { uuidDocto: "abc-123", parcialidad: 1, impPagado: 1000, impSaldoInsoluto: 0 },
          ],
          estadoSat: "vigente",
        },
      },
      createdAt: "2026-04-10T01:00:00Z",
    };
    await handleInvoicePaymentEvent(makeCtx(capture), event);
    const row = capture.row!;
    expect(row.uuid_complemento).toBe("pp-uuid-0001");
    expect(row.monto).toBe(1000);
    expect(row.num_operacion).toBe("TRF-123456");
    expect(Array.isArray(row.doctos_relacionados)).toBe(true);
    expect((row.doctos_relacionados as unknown[]).length).toBe(1);
    expect(row.odoo_company_id).toBe(2);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar falla**

```bash
npx vitest run src/__tests__/syntage/handlers/invoice-payment.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar**

```typescript
// src/lib/syntage/handlers/invoice-payment.ts
import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

interface SyntageInvoicePaymentPayload {
  "@id": string;
  uuid: string;
  direction: "issued" | "received";
  fechaPago?: string;
  formaPagoP?: string;
  monedaP?: string;
  tipoCambioP?: number;
  monto?: number;
  numOperacion?: string;
  rfcEmisorCtaOrd?: string;
  rfcEmisorCtaBen?: string;
  doctosRelacionados?: Array<Record<string, unknown>>;
  estadoSat?: "vigente" | "cancelado" | "cancelacion_pendiente";
}

export async function handleInvoicePaymentEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as SyntageInvoicePaymentPayload;
  const isCancellation = event.type === "invoice_payment.deleted";

  const row: Record<string, unknown> = {
    syntage_id:            obj["@id"],
    uuid_complemento:      obj.uuid,
    taxpayer_rfc:          ctx.taxpayerRfc,
    odoo_company_id:       ctx.odooCompanyId,
    direction:             obj.direction,
    fecha_pago:            obj.fechaPago ?? null,
    forma_pago_p:          obj.formaPagoP ?? null,
    moneda_p:              obj.monedaP ?? "MXN",
    tipo_cambio_p:         obj.tipoCambioP ?? 1,
    monto:                 obj.monto ?? null,
    num_operacion:         obj.numOperacion ?? null,
    rfc_emisor_cta_ord:    obj.rfcEmisorCtaOrd ?? null,
    rfc_emisor_cta_ben:    obj.rfcEmisorCtaBen ?? null,
    doctos_relacionados:   obj.doctosRelacionados ?? [],
    estado_sat:            isCancellation ? "cancelado" : (obj.estadoSat ?? "vigente"),
    raw_payload:           obj,
    synced_at:             new Date().toISOString(),
  };

  const { error } = await ctx.supabase
    .from("syntage_invoice_payments")
    .upsert(row, { onConflict: "syntage_id" });

  if (error) throw error;
}
```

- [ ] **Step 4: Ejecutar y verificar pasa**

```bash
npx vitest run src/__tests__/syntage/handlers/invoice-payment.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/syntage/handlers/invoice-payment.ts src/__tests__/syntage/handlers/invoice-payment.test.ts
git commit -m "feat(syntage): invoice_payment handler (CFDI Tipo P)"
```

---

## Task 16: Handler — Invoice Line Item

**Files:**
- Create: `src/lib/syntage/handlers/invoice-line-item.ts`
- Test: `src/__tests__/syntage/handlers/line-item.test.ts`

- [ ] **Step 1: Escribir test que falla**

```typescript
// src/__tests__/syntage/handlers/line-item.test.ts
import { describe, it, expect } from "vitest";
import { handleInvoiceLineItemEvent } from "@/lib/syntage/handlers/invoice-line-item";
import type { SyntageEvent } from "@/lib/syntage/types";

describe("handleInvoiceLineItemEvent", () => {
  it("upserts a line item linked to an invoice by invoice_uuid", async () => {
    let captured: Record<string, unknown> = {};
    const ctx = {
      supabase: {
        from: () => ({
          upsert: (row: Record<string, unknown>) => {
            captured = row;
            return Promise.resolve({ error: null });
          },
        }),
      } as unknown as import("@supabase/supabase-js").SupabaseClient,
      odooCompanyId: 1,
      taxpayerRfc: "QIN120315XX1",
    };
    const event: SyntageEvent = {
      id: "evt_li_1",
      type: "invoice_line_item.created",
      taxpayer: { id: "QIN120315XX1" },
      data: {
        object: {
          "@id": "/invoice-line-items/li-001",
          invoice: { uuid: "abc-uuid-1234" },
          lineNumber: 1,
          claveProdServ: "82101500",
          descripcion: "Servicio de consultoría",
          cantidad: 10,
          claveUnidad: "E48",
          unidad: "Servicio",
          valorUnitario: 100,
          importe: 1000,
          descuento: 0,
        },
      },
      createdAt: "2026-04-15T10:06:00Z",
    };
    await handleInvoiceLineItemEvent(ctx, event);
    expect(captured.invoice_uuid).toBe("abc-uuid-1234");
    expect(captured.line_number).toBe(1);
    expect(captured.clave_prod_serv).toBe("82101500");
    expect(captured.importe).toBe(1000);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar falla**

```bash
npx vitest run src/__tests__/syntage/handlers/line-item.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar**

```typescript
// src/lib/syntage/handlers/invoice-line-item.ts
import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

interface LineItemPayload {
  "@id": string;
  invoice: { uuid: string };
  lineNumber?: number;
  claveProdServ?: string;
  descripcion?: string;
  cantidad?: number;
  claveUnidad?: string;
  unidad?: string;
  valorUnitario?: number;
  importe?: number;
  descuento?: number;
}

export async function handleInvoiceLineItemEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as LineItemPayload;

  const row: Record<string, unknown> = {
    syntage_id:       obj["@id"],
    invoice_uuid:     obj.invoice?.uuid,
    taxpayer_rfc:     ctx.taxpayerRfc,
    odoo_company_id:  ctx.odooCompanyId,
    line_number:      obj.lineNumber ?? null,
    clave_prod_serv:  obj.claveProdServ ?? null,
    descripcion:      obj.descripcion ?? null,
    cantidad:         obj.cantidad ?? null,
    clave_unidad:     obj.claveUnidad ?? null,
    unidad:           obj.unidad ?? null,
    valor_unitario:   obj.valorUnitario ?? null,
    importe:          obj.importe ?? null,
    descuento:        obj.descuento ?? null,
    raw_payload:      obj,
    synced_at:        new Date().toISOString(),
  };

  const { error } = await ctx.supabase
    .from("syntage_invoice_line_items")
    .upsert(row, { onConflict: "syntage_id" });

  if (error) throw error;
}
```

- [ ] **Step 4: Ejecutar y verificar pasa**

```bash
npx vitest run src/__tests__/syntage/handlers/line-item.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/syntage/handlers/invoice-line-item.ts src/__tests__/syntage/handlers/line-item.test.ts
git commit -m "feat(syntage): invoice_line_item handler"
```

---

## Task 17: Handlers — Tax (retention + return + status)

**Files:**
- Create: `src/lib/syntage/handlers/tax-retention.ts`
- Create: `src/lib/syntage/handlers/tax-return.ts`
- Create: `src/lib/syntage/handlers/tax-status.ts`
- Test: `src/__tests__/syntage/handlers/tax.test.ts`

- [ ] **Step 1: Escribir test que cubre los tres handlers**

```typescript
// src/__tests__/syntage/handlers/tax.test.ts
import { describe, it, expect } from "vitest";
import { handleTaxRetentionEvent } from "@/lib/syntage/handlers/tax-retention";
import { handleTaxReturnEvent } from "@/lib/syntage/handlers/tax-return";
import { handleTaxStatusEvent } from "@/lib/syntage/handlers/tax-status";
import type { SyntageEvent, HandlerCtx } from "@/lib/syntage/types";

function makeCtx(capture: { row?: Record<string, unknown> }): HandlerCtx {
  return {
    supabase: {
      from: () => ({
        upsert: (row: Record<string, unknown>) => {
          capture.row = row;
          return Promise.resolve({ error: null });
        },
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient,
    odooCompanyId: 1,
    taxpayerRfc: "QIN120315XX1",
  };
}

describe("handleTaxRetentionEvent", () => {
  it("upserts a retention CFDI", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_r_1", type: "tax_retention.created",
      taxpayer: { id: "QIN120315XX1" },
      data: {
        object: {
          "@id": "/tax-retentions/r-001",
          uuid: "r-uuid-1", direction: "received",
          fechaEmision: "2026-04-10", tipoRetencion: "arrendamiento",
          montoTotalOperacion: 10000, montoTotalGravado: 10000, montoTotalRetenido: 1000,
          estadoSat: "vigente",
        },
      },
      createdAt: "2026-04-10T00:00:00Z",
    };
    await handleTaxRetentionEvent(makeCtx(capture), evt);
    expect(capture.row?.uuid).toBe("r-uuid-1");
    expect(capture.row?.monto_total_retenido).toBe(1000);
  });
});

describe("handleTaxReturnEvent", () => {
  it("upserts a monthly tax return", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_tr_1", type: "tax_return.created",
      taxpayer: { id: "QIN120315XX1" },
      data: {
        object: {
          "@id": "/tax-returns/tr-001",
          returnType: "monthly", ejercicio: 2026, periodo: "03", impuesto: "IVA",
          tipoDeclaracion: "normal", numeroOperacion: "OP-987",
          fechaPresentacion: "2026-04-17", montoPagado: 35000,
        },
      },
      createdAt: "2026-04-17T10:00:00Z",
    };
    await handleTaxReturnEvent(makeCtx(capture), evt);
    expect(capture.row?.ejercicio).toBe(2026);
    expect(capture.row?.periodo).toBe("03");
    expect(capture.row?.monto_pagado).toBe(35000);
  });
});

describe("handleTaxStatusEvent", () => {
  it("upserts opinion_cumplimiento for target_rfc", async () => {
    const capture: { row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_ts_1", type: "tax_status.created",
      taxpayer: { id: "QIN120315XX1" },
      data: {
        object: {
          "@id": "/tax-status/ts-001",
          targetRfc: "SUPPLIER_ABC", fechaConsulta: "2026-04-16",
          opinionCumplimiento: "positiva", regimenFiscal: "601",
        },
      },
      createdAt: "2026-04-16T12:00:00Z",
    };
    await handleTaxStatusEvent(makeCtx(capture), evt);
    expect(capture.row?.target_rfc).toBe("SUPPLIER_ABC");
    expect(capture.row?.opinion_cumplimiento).toBe("positiva");
  });
});
```

- [ ] **Step 2: Ejecutar y verificar falla**

```bash
npx vitest run src/__tests__/syntage/handlers/tax.test.ts
```

Expected: FAIL (3 módulos no existen).

- [ ] **Step 3: Implementar los tres handlers**

```typescript
// src/lib/syntage/handlers/tax-retention.ts
import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

export async function handleTaxRetentionEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;
  const isCancellation = event.type === "tax_retention.deleted";

  const row: Record<string, unknown> = {
    syntage_id:              obj["@id"],
    uuid:                    obj.uuid,
    taxpayer_rfc:            ctx.taxpayerRfc,
    odoo_company_id:         ctx.odooCompanyId,
    direction:               obj.direction,
    fecha_emision:           obj.fechaEmision ?? null,
    emisor_rfc:              (obj.issuer as { rfc?: string } | undefined)?.rfc ?? obj.emisorRfc ?? null,
    emisor_nombre:           (obj.issuer as { name?: string } | undefined)?.name ?? obj.emisorNombre ?? null,
    receptor_rfc:            (obj.receiver as { rfc?: string } | undefined)?.rfc ?? obj.receptorRfc ?? null,
    receptor_nombre:         (obj.receiver as { name?: string } | undefined)?.name ?? obj.receptorNombre ?? null,
    tipo_retencion:          obj.tipoRetencion ?? null,
    monto_total_operacion:   obj.montoTotalOperacion ?? null,
    monto_total_gravado:     obj.montoTotalGravado ?? null,
    monto_total_retenido:    obj.montoTotalRetenido ?? null,
    impuestos_retenidos:     obj.impuestosRetenidos ?? [],
    estado_sat:              isCancellation ? "cancelado" : (obj.estadoSat ?? "vigente"),
    raw_payload:             obj,
    synced_at:               new Date().toISOString(),
  };

  const { error } = await ctx.supabase
    .from("syntage_tax_retentions")
    .upsert(row, { onConflict: "syntage_id" });
  if (error) throw error;
}
```

```typescript
// src/lib/syntage/handlers/tax-return.ts
import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

export async function handleTaxReturnEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;

  const row: Record<string, unknown> = {
    syntage_id:          obj["@id"],
    taxpayer_rfc:        ctx.taxpayerRfc,
    odoo_company_id:     ctx.odooCompanyId,
    return_type:         obj.returnType ?? "monthly",
    ejercicio:           obj.ejercicio ?? null,
    periodo:             obj.periodo ?? null,
    impuesto:            obj.impuesto ?? null,
    fecha_presentacion:  obj.fechaPresentacion ?? null,
    monto_pagado:        obj.montoPagado ?? null,
    tipo_declaracion:    obj.tipoDeclaracion ?? "normal",
    numero_operacion:    obj.numeroOperacion ?? null,
    raw_payload:         obj,
    synced_at:           new Date().toISOString(),
  };

  const { error } = await ctx.supabase
    .from("syntage_tax_returns")
    .upsert(row, { onConflict: "syntage_id" });
  if (error) throw error;
}
```

```typescript
// src/lib/syntage/handlers/tax-status.ts
import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

export async function handleTaxStatusEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;

  const row: Record<string, unknown> = {
    syntage_id:               obj["@id"],
    taxpayer_rfc:             ctx.taxpayerRfc,
    odoo_company_id:          ctx.odooCompanyId,
    target_rfc:               obj.targetRfc ?? ctx.taxpayerRfc,
    fecha_consulta:           obj.fechaConsulta ?? new Date().toISOString(),
    opinion_cumplimiento:     obj.opinionCumplimiento ?? null,
    regimen_fiscal:           obj.regimenFiscal ?? null,
    domicilio_fiscal:         obj.domicilioFiscal ?? null,
    actividades_economicas:   obj.actividadesEconomicas ?? null,
    raw_payload:              obj,
    synced_at:                new Date().toISOString(),
  };

  const { error } = await ctx.supabase
    .from("syntage_tax_status")
    .upsert(row, { onConflict: "syntage_id" });
  if (error) throw error;
}
```

- [ ] **Step 4: Ejecutar y verificar pasa**

```bash
npx vitest run src/__tests__/syntage/handlers/tax.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/syntage/handlers/tax-retention.ts \
        src/lib/syntage/handlers/tax-return.ts \
        src/lib/syntage/handlers/tax-status.ts \
        src/__tests__/syntage/handlers/tax.test.ts
git commit -m "feat(syntage): tax retention + return + status handlers"
```

---

## Task 18: Handler — Electronic Accounting + Admin events

**Files:**
- Create: `src/lib/syntage/handlers/electronic-accounting.ts`
- Create: `src/lib/syntage/handlers/admin.ts`
- Test: `src/__tests__/syntage/handlers/admin.test.ts`

- [ ] **Step 1: Escribir test**

```typescript
// src/__tests__/syntage/handlers/admin.test.ts
import { describe, it, expect } from "vitest";
import { handleElectronicAccountingEvent } from "@/lib/syntage/handlers/electronic-accounting";
import {
  handleCredentialEvent,
  handleLinkEvent,
  handleExtractionEvent,
  handleFileCreatedEvent,
} from "@/lib/syntage/handlers/admin";
import type { SyntageEvent, HandlerCtx } from "@/lib/syntage/types";

function makeCtx(capture: { table?: string; row?: Record<string, unknown> }): HandlerCtx {
  return {
    supabase: {
      from: (t: string) => ({
        upsert: (row: Record<string, unknown>) => {
          capture.table = t; capture.row = row;
          return Promise.resolve({ error: null });
        },
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient,
    odooCompanyId: 1,
    taxpayerRfc: "QIN120315XX1",
  };
}

describe("handleElectronicAccountingEvent", () => {
  it("upserts a balanza", async () => {
    const capture: { table?: string; row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_ea_1", type: "electronic_accounting_record.created",
      taxpayer: { id: "QIN120315XX1" },
      data: { object: {
        "@id": "/ea/ea-001", recordType: "balanza",
        ejercicio: 2026, periodo: "03", tipoEnvio: "normal", hash: "abc",
      } },
      createdAt: "2026-04-01T00:00:00Z",
    };
    await handleElectronicAccountingEvent(makeCtx(capture), evt);
    expect(capture.table).toBe("syntage_electronic_accounting");
    expect(capture.row?.record_type).toBe("balanza");
  });
});

describe("handleExtractionEvent", () => {
  it("upserts an extraction row", async () => {
    const capture: { table?: string; row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_ex_1", type: "extraction.updated",
      taxpayer: { id: "QIN120315XX1" },
      data: { object: {
        "@id": "/extractions/ex-001",
        extractor: "invoice",
        status: "finished", options: { from: "2026-01-01", to: "2026-01-31" },
        startedAt: "2026-04-01T10:00:00Z", finishedAt: "2026-04-01T10:05:00Z",
      } },
      createdAt: "2026-04-01T10:05:00Z",
    };
    await handleExtractionEvent(makeCtx(capture), evt);
    expect(capture.table).toBe("syntage_extractions");
    expect(capture.row?.status).toBe("finished");
    expect(capture.row?.extractor_type).toBe("invoice");
  });
});

describe("handleCredentialEvent + handleLinkEvent + handleFileCreatedEvent", () => {
  it("credential.* is a log-only no-op that does not throw", async () => {
    const capture: { table?: string; row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_c_1", type: "credential.updated",
      taxpayer: { id: "QIN120315XX1" },
      data: { object: { "@id": "/credentials/c1", status: "valid" } },
      createdAt: "2026-04-01T00:00:00Z",
    };
    await expect(handleCredentialEvent(makeCtx(capture), evt)).resolves.toBeUndefined();
  });

  it("link.* is a log-only no-op", async () => {
    const evt: SyntageEvent = {
      id: "evt_l_1", type: "link.created",
      taxpayer: { id: "QIN120315XX1" },
      data: { object: { "@id": "/links/l1" } },
      createdAt: "2026-04-01T00:00:00Z",
    };
    await expect(handleLinkEvent(makeCtx({}), evt)).resolves.toBeUndefined();
  });

  it("file.created upserts a syntage_files row", async () => {
    const capture: { table?: string; row?: Record<string, unknown> } = {};
    const evt: SyntageEvent = {
      id: "evt_f_1", type: "file.created",
      taxpayer: { id: "QIN120315XX1" },
      data: { object: {
        "@id": "/files/f-001", fileType: "cfdi_xml",
        filename: "abc.xml", mimeType: "text/xml", sizeBytes: 4096,
        downloadUrlCachedUntil: "2026-04-17T10:00:00Z",
      } },
      createdAt: "2026-04-16T10:00:00Z",
    };
    await handleFileCreatedEvent(makeCtx(capture), evt);
    expect(capture.table).toBe("syntage_files");
    expect(capture.row?.file_type).toBe("cfdi_xml");
    expect(capture.row?.filename).toBe("abc.xml");
  });
});
```

- [ ] **Step 2: Ejecutar y verificar falla**

```bash
npx vitest run src/__tests__/syntage/handlers/admin.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar**

```typescript
// src/lib/syntage/handlers/electronic-accounting.ts
import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

export async function handleElectronicAccountingEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;

  const row: Record<string, unknown> = {
    syntage_id:       obj["@id"],
    taxpayer_rfc:     ctx.taxpayerRfc,
    odoo_company_id:  ctx.odooCompanyId,
    record_type:      obj.recordType,
    ejercicio:        obj.ejercicio,
    periodo:          obj.periodo,
    tipo_envio:       obj.tipoEnvio ?? "normal",
    hash:             obj.hash ?? null,
    raw_payload:      obj,
    synced_at:        new Date().toISOString(),
  };

  const { error } = await ctx.supabase
    .from("syntage_electronic_accounting")
    .upsert(row, { onConflict: "syntage_id" });
  if (error) throw error;
}
```

```typescript
// src/lib/syntage/handlers/admin.ts
import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

/**
 * Handler for credential.* events.
 * These are informational — status changes are reflected in syntage_taxpayers
 * via separate logic. Here we just no-op (and let the pipeline_logs entry
 * from the dispatcher record the event).
 */
export async function handleCredentialEvent(_ctx: HandlerCtx, _event: SyntageEvent): Promise<void> {
  // Intentionally empty. Log-only event.
}

/** link.created / link.updated / link.deleted — no-op for now. */
export async function handleLinkEvent(_ctx: HandlerCtx, _event: SyntageEvent): Promise<void> {
  // Intentionally empty. Log-only event.
}

/** extraction.created / extraction.updated — upsert into syntage_extractions. */
export async function handleExtractionEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;

  const row: Record<string, unknown> = {
    syntage_id:       obj["@id"],
    taxpayer_rfc:     ctx.taxpayerRfc,
    odoo_company_id:  ctx.odooCompanyId,
    extractor_type:   obj.extractor ?? "unknown",
    options:          obj.options ?? {},
    status:           obj.status ?? "pending",
    started_at:       obj.startedAt ?? null,
    finished_at:      obj.finishedAt ?? null,
    rows_produced:    obj.rowsProduced ?? 0,
    error:            obj.error ?? null,
    raw_payload:      obj,
    updated_at:       new Date().toISOString(),
  };

  const { error } = await ctx.supabase
    .from("syntage_extractions")
    .upsert(row, { onConflict: "syntage_id" });
  if (error) throw error;
}

/** file.created — record metadata; binary download is enqueued separately (Phase future). */
export async function handleFileCreatedEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;

  const row: Record<string, unknown> = {
    syntage_id:                  obj["@id"],
    taxpayer_rfc:                ctx.taxpayerRfc,
    odoo_company_id:             ctx.odooCompanyId,
    file_type:                   obj.fileType ?? "unknown",
    filename:                    obj.filename ?? null,
    mime_type:                   obj.mimeType ?? null,
    size_bytes:                  obj.sizeBytes ?? null,
    download_url_cached_until:   obj.downloadUrlCachedUntil ?? null,
    raw_payload:                 obj,
  };

  const { error } = await ctx.supabase
    .from("syntage_files")
    .upsert(row, { onConflict: "syntage_id" });
  if (error) throw error;
}
```

- [ ] **Step 4: Ejecutar y verificar pasa**

```bash
npx vitest run src/__tests__/syntage/handlers/admin.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/syntage/handlers/electronic-accounting.ts \
        src/lib/syntage/handlers/admin.ts \
        src/__tests__/syntage/handlers/admin.test.ts
git commit -m "feat(syntage): electronic_accounting + admin event handlers"
```

---

## Task 19: Dispatcher — route event.type → handler

**Files:**
- Create: `src/lib/syntage/dispatcher.ts`
- Test: `src/__tests__/syntage/dispatcher.test.ts`

- [ ] **Step 1: Escribir test**

```typescript
// src/__tests__/syntage/dispatcher.test.ts
import { describe, it, expect, vi } from "vitest";
import { dispatchSyntageEvent, type DispatcherHandlers } from "@/lib/syntage/dispatcher";
import type { SyntageEvent, HandlerCtx } from "@/lib/syntage/types";

function makeCtx(): HandlerCtx {
  return {
    supabase: {} as import("@supabase/supabase-js").SupabaseClient,
    odooCompanyId: 1,
    taxpayerRfc: "RFC",
  };
}

function makeHandlers(): DispatcherHandlers {
  return {
    invoice: vi.fn().mockResolvedValue(undefined),
    invoiceLineItem: vi.fn().mockResolvedValue(undefined),
    invoicePayment: vi.fn().mockResolvedValue(undefined),
    taxRetention: vi.fn().mockResolvedValue(undefined),
    taxReturn: vi.fn().mockResolvedValue(undefined),
    taxStatus: vi.fn().mockResolvedValue(undefined),
    electronicAccounting: vi.fn().mockResolvedValue(undefined),
    credential: vi.fn().mockResolvedValue(undefined),
    link: vi.fn().mockResolvedValue(undefined),
    extraction: vi.fn().mockResolvedValue(undefined),
    fileCreated: vi.fn().mockResolvedValue(undefined),
  };
}

function evt(type: string): SyntageEvent {
  return {
    id: `evt_${type}`, type,
    taxpayer: { id: "RFC" },
    data: { object: { "@id": "/x/1" } },
    createdAt: "2026-04-16T00:00:00Z",
  };
}

describe("dispatchSyntageEvent", () => {
  it("routes invoice.created to invoice handler", async () => {
    const h = makeHandlers();
    await dispatchSyntageEvent(makeCtx(), evt("invoice.created"), h);
    expect(h.invoice).toHaveBeenCalledOnce();
  });

  it("routes invoice.deleted to invoice handler", async () => {
    const h = makeHandlers();
    await dispatchSyntageEvent(makeCtx(), evt("invoice.deleted"), h);
    expect(h.invoice).toHaveBeenCalledOnce();
  });

  it("routes invoice_payment.updated to payment handler", async () => {
    const h = makeHandlers();
    await dispatchSyntageEvent(makeCtx(), evt("invoice_payment.updated"), h);
    expect(h.invoicePayment).toHaveBeenCalledOnce();
  });

  it("routes electronic_accounting_record.* to eAccounting handler", async () => {
    const h = makeHandlers();
    await dispatchSyntageEvent(makeCtx(), evt("electronic_accounting_record.created"), h);
    expect(h.electronicAccounting).toHaveBeenCalledOnce();
  });

  it("returns 'unhandled' for unknown event types without throwing", async () => {
    const h = makeHandlers();
    const result = await dispatchSyntageEvent(makeCtx(), evt("unknown.type"), h);
    expect(result).toBe("unhandled");
    Object.values(h).forEach(fn => expect(fn).not.toHaveBeenCalled());
  });

  it("returns 'handled' for known types", async () => {
    const h = makeHandlers();
    const result = await dispatchSyntageEvent(makeCtx(), evt("invoice.created"), h);
    expect(result).toBe("handled");
  });
});
```

- [ ] **Step 2: Ejecutar y verificar falla**

```bash
npx vitest run src/__tests__/syntage/dispatcher.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar**

```typescript
// src/lib/syntage/dispatcher.ts
import type { SyntageEvent, HandlerCtx } from "@/lib/syntage/types";

export interface DispatcherHandlers {
  invoice:              (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
  invoiceLineItem:      (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
  invoicePayment:       (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
  taxRetention:         (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
  taxReturn:            (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
  taxStatus:            (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
  electronicAccounting: (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
  credential:           (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
  link:                 (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
  extraction:           (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
  fileCreated:          (ctx: HandlerCtx, event: SyntageEvent) => Promise<void>;
}

/**
 * Routes a Syntage event to the appropriate handler by event.type.
 * Returns 'handled' if dispatched, 'unhandled' if type is unknown.
 */
export async function dispatchSyntageEvent(
  ctx: HandlerCtx,
  event: SyntageEvent,
  handlers: DispatcherHandlers,
): Promise<"handled" | "unhandled"> {
  const t = event.type;

  // Invoice family
  if (t === "invoice.created" || t === "invoice.updated" || t === "invoice.deleted") {
    await handlers.invoice(ctx, event);
    return "handled";
  }
  if (t === "invoice_line_item.created" || t === "invoice_line_item.updated") {
    await handlers.invoiceLineItem(ctx, event);
    return "handled";
  }
  if (t === "invoice_payment.created" || t === "invoice_payment.updated" || t === "invoice_payment.deleted") {
    await handlers.invoicePayment(ctx, event);
    return "handled";
  }

  // Tax family
  if (t.startsWith("tax_retention.")) {
    await handlers.taxRetention(ctx, event);
    return "handled";
  }
  if (t.startsWith("tax_return.")) {
    await handlers.taxReturn(ctx, event);
    return "handled";
  }
  if (t.startsWith("tax_status.")) {
    await handlers.taxStatus(ctx, event);
    return "handled";
  }

  // Compliance / e-accounting
  if (t.startsWith("electronic_accounting_record.")) {
    await handlers.electronicAccounting(ctx, event);
    return "handled";
  }

  // Admin
  if (t.startsWith("credential.")) { await handlers.credential(ctx, event);   return "handled"; }
  if (t.startsWith("link."))       { await handlers.link(ctx, event);          return "handled"; }
  if (t.startsWith("extraction.")) { await handlers.extraction(ctx, event);    return "handled"; }
  if (t === "file.created")        { await handlers.fileCreated(ctx, event);   return "handled"; }

  return "unhandled";
}
```

- [ ] **Step 4: Ejecutar y verificar pasa**

```bash
npx vitest run src/__tests__/syntage/dispatcher.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/syntage/dispatcher.ts src/__tests__/syntage/dispatcher.test.ts
git commit -m "feat(syntage): event dispatcher (route by event.type)"
```

---

## Task 20: Webhook Endpoint (`/api/syntage/webhook`)

**Files:**
- Create: `src/app/api/syntage/webhook/route.ts`

- [ ] **Step 1: Implementar el endpoint**

```typescript
// src/app/api/syntage/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { verifySyntageSignature } from "@/lib/syntage/signature";
import { recordWebhookEvent, supabaseEventStore } from "@/lib/syntage/idempotency";
import { resolveEntity, supabaseEntityMapStore } from "@/lib/syntage/entity-resolver";
import { dispatchSyntageEvent, type DispatcherHandlers } from "@/lib/syntage/dispatcher";
import type { SyntageEvent } from "@/lib/syntage/types";

import { handleInvoiceEvent }            from "@/lib/syntage/handlers/invoice";
import { handleInvoiceLineItemEvent }    from "@/lib/syntage/handlers/invoice-line-item";
import { handleInvoicePaymentEvent }     from "@/lib/syntage/handlers/invoice-payment";
import { handleTaxRetentionEvent }       from "@/lib/syntage/handlers/tax-retention";
import { handleTaxReturnEvent }          from "@/lib/syntage/handlers/tax-return";
import { handleTaxStatusEvent }          from "@/lib/syntage/handlers/tax-status";
import { handleElectronicAccountingEvent } from "@/lib/syntage/handlers/electronic-accounting";
import {
  handleCredentialEvent,
  handleLinkEvent,
  handleExtractionEvent,
  handleFileCreatedEvent,
} from "@/lib/syntage/handlers/admin";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const HANDLERS: DispatcherHandlers = {
  invoice:              handleInvoiceEvent,
  invoiceLineItem:      handleInvoiceLineItemEvent,
  invoicePayment:       handleInvoicePaymentEvent,
  taxRetention:         handleTaxRetentionEvent,
  taxReturn:            handleTaxReturnEvent,
  taxStatus:            handleTaxStatusEvent,
  electronicAccounting: handleElectronicAccountingEvent,
  credential:           handleCredentialEvent,
  link:                 handleLinkEvent,
  extraction:           handleExtractionEvent,
  fileCreated:          handleFileCreatedEvent,
};

export async function POST(request: NextRequest) {
  const secret = process.env.SYNTAGE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "SYNTAGE_WEBHOOK_SECRET not set" }, { status: 503 });
  }

  // Raw body (required for HMAC verification — DO NOT parse before verifying)
  const rawBody = await request.text();
  const signature = request.headers.get("x-syntage-signature") ?? "";

  if (!verifySyntageSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: SyntageEvent;
  try {
    event = JSON.parse(rawBody) as SyntageEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!event?.id || !event?.type || !event?.taxpayer?.id) {
    return NextResponse.json({ error: "Malformed event" }, { status: 400 });
  }

  const supabase = getServiceClient();

  // 1. Idempotency
  const status = await recordWebhookEvent(
    supabaseEventStore(supabase),
    event.id,
    event.type,
    "webhook",
  );
  if (status === "duplicate") {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  // 2. Entity resolution (multi-tenant)
  const entity = await resolveEntity(
    supabaseEntityMapStore(supabase),
    event.taxpayer.id,
  );
  if (!entity) {
    // Log the rejection; respond 200 so Syntage doesn't retry.
    await supabase.from("pipeline_logs").insert({
      level: "warning",
      phase: "syntage_webhook",
      message: `Unmapped taxpayer RFC: ${event.taxpayer.id}`,
      details: { event_id: event.id, event_type: event.type, rfc: event.taxpayer.id },
    });
    return NextResponse.json({ ok: true, skipped: "unmapped_taxpayer" });
  }

  // 3. Dispatch
  try {
    const result = await dispatchSyntageEvent(
      { supabase, odooCompanyId: entity.odooCompanyId, taxpayerRfc: event.taxpayer.id },
      event,
      HANDLERS,
    );

    if (result === "unhandled") {
      await supabase.from("pipeline_logs").insert({
        level: "info",
        phase: "syntage_webhook",
        message: `Unhandled event type: ${event.type}`,
        details: { event_id: event.id, event_type: event.type },
      });
    }

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[syntage/webhook] handler error:", err);
    await supabase.from("pipeline_logs").insert({
      level: "error",
      phase: "syntage_webhook",
      message: `Handler error: ${message}`,
      details: { event_id: event.id, event_type: event.type },
    });
    // Return 500 to let Syntage retry (retriable error)
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Health check for manual verification
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "/api/syntage/webhook",
    method: "POST",
    auth: "X-Syntage-Signature HMAC-SHA256",
  });
}
```

- [ ] **Step 2: Verificar tsc compila**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 3: Probar GET health check**

```bash
npm run dev
# en otra shell:
curl http://localhost:3000/api/syntage/webhook
```

Expected: JSON con `{ok:true, endpoint:"/api/syntage/webhook", ...}`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/syntage/webhook/route.ts
git commit -m "feat(syntage): POST /api/syntage/webhook receiver"
```

---

## Task 21: E2E Test — Simulated Webhook against Local Dev

**Files:**
- Create: `src/__tests__/syntage/webhook-e2e.test.ts`

- [ ] **Step 1: Escribir test de integración**

```typescript
// src/__tests__/syntage/webhook-e2e.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";

/**
 * E2E: exercises the running webhook endpoint with a simulated payload.
 *
 * PRE-REQUISITO: dev server corriendo en localhost:3000 con:
 *  - SYNTAGE_WEBHOOK_SECRET=test-secret
 *  - syntage_entity_map seeded con taxpayer_rfc='TESTRFC000' → odoo_company_id=1
 *
 * Skip automáticamente si no hay server (detecta via fetch).
 */
const BASE_URL = process.env.SYNTAGE_E2E_URL ?? "http://localhost:3000";
const SECRET = process.env.SYNTAGE_WEBHOOK_SECRET ?? "test-secret";
const TEST_RFC = process.env.SYNTAGE_E2E_TEST_RFC ?? "TESTRFC000";

function sign(body: string): string {
  return crypto.createHmac("sha256", SECRET).update(body).digest("hex");
}

async function serverIsUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE_URL}/api/syntage/webhook`);
    return r.ok;
  } catch {
    return false;
  }
}

describe("POST /api/syntage/webhook (E2E)", () => {
  let up = false;
  beforeAll(async () => { up = await serverIsUp(); });

  it.runIf(up)("401s on invalid signature", async () => {
    const body = JSON.stringify({ id: "e2e_1", type: "invoice.created", taxpayer: { id: TEST_RFC }, data: { object: {} }, createdAt: "2026-04-16T00:00:00Z" });
    const res = await fetch(`${BASE_URL}/api/syntage/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-syntage-signature": "bad" },
      body,
    });
    expect(res.status).toBe(401);
  });

  it.runIf(up)("accepts a valid invoice.created and persists it", async () => {
    const uuid = `e2e-${Date.now()}-0001`;
    const body = JSON.stringify({
      id: `e2e_inv_${Date.now()}`,
      type: "invoice.created",
      taxpayer: { id: TEST_RFC },
      data: {
        object: {
          "@id": `/invoices/${uuid}`,
          uuid,
          direction: "received",
          tipoComprobante: "I",
          serie: "A", folio: "100",
          fechaEmision: "2026-04-15T10:00:00Z",
          issuer: { rfc: "SUPPTEST", name: "Supplier Test" },
          receiver: { rfc: TEST_RFC, name: "Test Entity" },
          subtotal: 100, total: 116, moneda: "MXN", tipoCambio: 1,
          estadoSat: "vigente",
        },
      },
      createdAt: new Date().toISOString(),
    });
    const res = await fetch(`${BASE_URL}/api/syntage/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-syntage-signature": sign(body) },
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.result).toBe("handled");
  });

  it.runIf(up)("deduplicates on duplicate event_id", async () => {
    const dupId = `e2e_dup_${Date.now()}`;
    const body = JSON.stringify({
      id: dupId,
      type: "invoice.created",
      taxpayer: { id: TEST_RFC },
      data: {
        object: {
          "@id": `/invoices/dup-${Date.now()}`, uuid: `dup-${Date.now()}`,
          direction: "received", tipoComprobante: "I",
          issuer: { rfc: "SUPP" }, receiver: { rfc: TEST_RFC },
          total: 10, moneda: "MXN",
        },
      },
      createdAt: new Date().toISOString(),
    });
    const headers = { "content-type": "application/json", "x-syntage-signature": sign(body) };
    const r1 = await fetch(`${BASE_URL}/api/syntage/webhook`, { method: "POST", headers, body });
    const r2 = await fetch(`${BASE_URL}/api/syntage/webhook`, { method: "POST", headers, body });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect((await r2.json()).duplicate).toBe(true);
  });

  it.runIf(up)("rejects unmapped taxpayer gracefully (200 + skipped)", async () => {
    const body = JSON.stringify({
      id: `e2e_unmapped_${Date.now()}`,
      type: "invoice.created",
      taxpayer: { id: "ZZZZ999999ZZZ" },
      data: { object: { "@id": "/invoices/z", uuid: `z-${Date.now()}`, direction: "received", issuer: {}, receiver: {}, moneda: "MXN" } },
      createdAt: new Date().toISOString(),
    });
    const res = await fetch(`${BASE_URL}/api/syntage/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-syntage-signature": sign(body) },
      body,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).skipped).toBe("unmapped_taxpayer");
  });
});
```

- [ ] **Step 2: Ejecutar con dev server corriendo**

En una shell:
```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
SYNTAGE_WEBHOOK_SECRET=test-secret npm run dev
```

Previamente, en Supabase (via MCP `execute_sql`), seed un mapping de test:
```sql
INSERT INTO syntage_entity_map
  (taxpayer_rfc, odoo_company_id, alias, priority)
VALUES ('TESTRFC000', 1, 'E2E Test Entity', 'primary')
ON CONFLICT (taxpayer_rfc) DO NOTHING;
```

En otra shell:
```bash
SYNTAGE_WEBHOOK_SECRET=test-secret npx vitest run src/__tests__/syntage/webhook-e2e.test.ts
```

Expected: PASS (4 tests). Si dev server no está up, tests se saltan (`runIf(up)`).

- [ ] **Step 3: Verificar persistencia en Supabase**

```sql
SELECT syntage_id, uuid, direction, emisor_rfc, receptor_rfc, total, estado_sat
FROM syntage_invoices
WHERE taxpayer_rfc = 'TESTRFC000'
ORDER BY synced_at DESC LIMIT 5;

SELECT event_id, event_type, source FROM syntage_webhook_events
ORDER BY received_at DESC LIMIT 10;
```

Expected: rows creados por los tests.

- [ ] **Step 4: Cleanup seed de test**

```sql
DELETE FROM syntage_invoices WHERE taxpayer_rfc = 'TESTRFC000';
DELETE FROM syntage_webhook_events WHERE event_id LIKE 'e2e_%';
DELETE FROM syntage_entity_map WHERE taxpayer_rfc = 'TESTRFC000';
```

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/syntage/webhook-e2e.test.ts
git commit -m "test(syntage): E2E webhook endpoint integration test"
```

---

## Task 22: Gate de Fase 1 — Validación final

**Files:** (sin archivos — verificación manual)

- [ ] **Step 1: Correr toda la suite de tests unitarios**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
npx vitest run src/__tests__/syntage/
```

Expected: todos PASS (~25 tests entre unitarios + E2E).

- [ ] **Step 2: Verificar 11 tablas `syntage_*` existen y tienen RLS**

```sql
SELECT table_name, row_security
FROM information_schema.tables
JOIN pg_tables USING (schemaname, tablename)
WHERE table_schema = 'public'
  AND table_name LIKE 'syntage_%'
ORDER BY table_name;
```

Expected: 11 rows, todas con RLS.

- [ ] **Step 3: Verificar ingestion.source_registry populated**

```sql
SELECT table_name, sla_minutes, priority, owner_agent
FROM ingestion.source_registry
WHERE source_id = 'syntage' ORDER BY table_name;
```

Expected: 7 rows.

- [ ] **Step 4: Verificar `syntage_entity_map` populated con entidades reales**

```sql
SELECT taxpayer_rfc, alias, odoo_company_id, is_active, backfill_from
FROM syntage_entity_map ORDER BY priority = 'primary' DESC, alias;
```

Expected: N rows (una por entidad Quimibond), todas `is_active=true`.

- [ ] **Step 5: Merge a main y deploy preview**

```bash
git log --oneline main..HEAD
```

Verificar que todos los commits están presentes. Push:

```bash
git push origin main
```

Vercel dispara preview deployment automáticamente. Verificar en `/api/syntage/webhook` del preview URL que responde 200 al GET.

- [ ] **Step 6: Marcar Fase 1 como completada**

La fase cierra cuando:
- ✅ Todos los tests unitarios + E2E pasan
- ✅ 11 tablas creadas con RLS
- ✅ ingestion.source_registry con 7 rows de Syntage
- ✅ syntage_entity_map con entidades reales
- ✅ Endpoint `/api/syntage/webhook` deployed y responde GET
- ✅ E2E test exitoso contra dev local con mapping real

**Siguiente:** Fase 2 (Onboarding Producción) — manual: crear taxpayers + credentials en Syntage production. No requiere código, solo configuración en dashboard Syntage.

---

## Notas para el Implementador

- **TDD estricto:** en cada task lib, escribe el test primero, véelo fallar, implementa lo mínimo, véelo pasar, commitea. No skipees verificaciones de fallo — son parte del ciclo.
- **No agregues columnas no especificadas.** Si parece que falta un campo, primero verifica que no esté en `raw_payload` — ahí vive todo lo no-denormalizado.
- **Nunca parsees el body antes de verificar firma.** `await request.text()` → `verifySyntageSignature(rawBody, ...)` → `JSON.parse(rawBody)`. Ese orden es crítico para seguridad.
- **Idempotencia es ON CONFLICT DO NOTHING.** No uses UPDATE — los webhooks duplicados son señal de retries legítimos de Syntage, no eventos nuevos.
- **Logs estructurados a `pipeline_logs`** con `phase='syntage_webhook'` para seguir el patrón existente.
- **Si un handler falla, retorna 500 al webhook.** Syntage reintenta. Solo responde 200 para errores no-retriables (firma inválida, taxpayer no mapeado, payload malformado).
