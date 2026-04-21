# Silver Architecture — Quimibond Intelligence Platform v2

**Fecha:** 2026-04-21
**Status:** Design (approved 2026-04-21)
**Supersedes:** `2026-04-21-supabase-audit-07-desaprovechado.md` (recommendations), `2026-04-21-truth-map.md` (v1 survivorship), parciales de `2026-04-20-supabase-audit-06-unificacion.md`.
**Alcance:** rediseño integral de Supabase `tozqezmivpblmcubmnpi` — de mirror-of-Odoo con overlays emergentes a plataforma formal de reconciliación multi-fuente.
**Dueño:** @jose.mizrahi. Implementation split: 5 sub-projects (ver §11).

---

## 1. Executive Summary

Quimibond opera hoy una plataforma donde Supabase funge como **mirror de Odoo con overlays emergentes** de Syntage (SAT), Gmail y Claude. El problema: cada overlay nació oportunista, sin contrato de datos, y el resultado es **80+ tablas + 80 views + 38 MVs sin autoridad declarada por campo**. Los síntomas — dashboards con números distintos según la ruta, cobranza que no concilia con SAT, empresas duplicadas entre `companies` y `entities`, 44k+ reconciliation issues abiertos — son consecuencia directa: no hay "realidad unificada" porque nadie construyó la **Silver layer canónica**.

Esta spec define la arquitectura **Medallion-Lite + MDM + 4-Pattern Canonical + Reconciliation-as-Product**, que reemplaza el patrón actual "cada consumer reinterpreta el matching" por **tablas Silver con autoridad declarada, links MDM trazables, reglas de supervivencia por campo y un motor de reconciliación que produce un CEO Inbox accionable** como producto de primera clase.

Los **4 patterns** fijan la forma de cada entidad: dual-source canonical (A), single-source thin wrapper (B), MDM golden record (C), evidence attached (D). Cada campo de cada tabla canónica tiene (i) una fuente autoritativa declarada, (ii) un tipo explícito, (iii) una regla de supervivencia cuando hay multi-fuente, (iv) un flag de diff cuando aplica. El CEO consume el Inbox, los agentes consumen canonical_* (nunca Bronze), el frontend lee canonical_* en cada página.

La **migración ocurre en 5 sub-proyectos en 5-6 semanas**: SP1 design+prune (Week 1, se elimina el backlog decorativo antes de construir), SP2 Cat A reconciliation core (Weeks 2-3, canonical_invoices/payments/credit_notes/tax_events), SP3 Cat C MDM (Weeks 3-4, canonical_companies/contacts/products/employees con matcher), SP4 Cat B + D + engine (Weeks 4-5, wrappers + evidence + reconciliation engine + CEO Inbox), SP5 frontend + agents (Weeks 5-6, rewire completo y cleanup final). Reconstrucción **en paralelo al sistema vivo**: Bronze sigue poblándose durante toda la migración; Silver se construye al lado; cutover de consumers ocurre en SP5 con feature flags.

**Outcomes medibles al cierre**: (1) cero consumers frontend o agente apuntando a `odoo_*` / `syntage_*` directamente; (2) `reconciliation_issues` trending-down semana a semana porque la mayoría resuelve automáticamente por reglas declaradas; (3) un CEO Inbox de ~50 items accionables reemplaza los 44k+ issues opacos actuales; (4) nueva integración (banco, portal proveedor) = añadir columnas + reglas, sin rearquitectura; (5) cada campo expuesto en UI tiene su authority traceable back a fuente + fecha.

---

## 2. Principios arquitectónicos

Siete principios rigen cada decisión del diseño. Cuando hay conflicto entre principios, aplica el orden numérico (1 gana sobre 7).

**P1. Autoridad declarada por campo, no por tabla.** Cada columna de cada canonical table tiene una fuente de verdad explícita en su docstring. No se hereda autoridad "de la tabla". Un mismo row puede tener `amount_total` canónico desde SAT y `salesperson` canónico desde Odoo.

**P2. Manual > Automático.** Cualquier entrada en `invoice_bridge_manual`, `payment_bridge_manual`, `products_fiscal_map`, `mdm_manual_overrides` o `facts.verified=true` **supera** cualquier matching automático, incluso UUID exact. El humano cierra el loop.

**P3. Fiscal > Operativo** cuando el campo tiene implicación fiscal/legal (UUID, estado SAT, total_mxn declarado, RFC receptor, tipoCambio CFDI, método/forma de pago, claveProdServ, opinion_cumplimiento, 69B). **Operativo > Fiscal** cuando el campo es interno de gestión (salesperson, commitment_date, margen, inventario, costo estándar, payment_term operativo, journal bancario). La dicotomía está declarada campo por campo.

**P4. Separación Bronze/Silver/Gold es inviolable.** Bronze jamás se edita en backfill (solo append + corrección upstream). Silver se reconstruye determinísticamente desde Bronze. Gold agrega sobre Silver. Un escritor nunca cruza capas.

**P5. Reconciliación es un producto, no un batch job.** `reconciliation_issues` es cola visible para el usuario, no log interno. Cada issue tiene severidad, impacto-$, antigüedad, assignee, action. El CEO Inbox es el top de esta cola.

**P6. Tolerancias son ley.** Si una diff cae dentro de la tolerance declarada en `audit_tolerances`, **no es conflicto** — no se emite issue, no se resurfacea, no se cuenta contra el score. Tolerances se versionan junto con el código.

**P7. Evidence se adjunta, no reemplaza.** Email signals, AI extracts, attachments y manual notes viven en Pattern D linkeadas a canonical entities via FK + signal_type + confidence. Nunca se promueven a Silver sin verificación explícita.

---

## 3. Layers

### 3.1 Bronze — raw, untouched

**Definición.** Tablas que contienen datos tal como llegan de una fuente externa, sin normalización más allá de la necesaria para persistir (casting de tipos, PK, dedup por idempotency key). Bronze es **append-mostly**. Una corrección en Bronze solo ocurre por re-ingesta desde la fuente, nunca por update manual SQL.

**Contenido hoy.**
- **Odoo (qb19 addon, push cada 1h):** `odoo_invoices`, `odoo_invoice_lines`, `odoo_sale_orders`, `odoo_purchase_orders`, `odoo_order_lines`, `odoo_account_payments`, `odoo_payment_invoice_links`, `odoo_products`, `odoo_deliveries`, `odoo_manufacturing`, `odoo_activities`, `odoo_crm_leads`, `odoo_chart_of_accounts`, `odoo_account_balances`, `odoo_bank_balances`, `odoo_currency_rates`, `odoo_employees`, `odoo_departments`, `odoo_users`, `odoo_orderpoints`. (20 tablas + `odoo_uoms`, `odoo_schema_catalog`, `odoo_snapshots` out-of-scope canónico.)
- **Syntage (webhook + pull-sync):** `syntage_invoices`, `syntage_invoice_line_items`, `syntage_invoice_payments`, `syntage_tax_returns`, `syntage_tax_retentions`, `syntage_tax_status`, `syntage_electronic_accounting`, `syntage_files`, `syntage_taxpayers`, `syntage_entity_map`, `syntage_extractions`, `syntage_webhook_events`.
- **Gmail:** `emails`, `threads`.
- **Sistema:** `pipeline_logs`, `schema_changes`, `audit_runs`, `sync_commands`, `sync_state`.

**Reglas.**
- Unique constraint sobre (source_id, external_id) para idempotencia de re-ingesta.
- `synced_at` timestamptz NOT NULL DEFAULT now() en cada fila.
- `raw_payload jsonb` preservado en tablas Syntage para permitir re-extracción sin nueva llamada al PAC.
- **No triggers de business logic en Bronze** (solo normalize_lowercase en `companies`/`contacts`/`entities` existentes — a migrarse a Silver en SP3).

### 3.2 Silver — canonical, nuevo

**Definición.** Tablas/views reconstruidas determinísticamente desde Bronze, que representan la realidad unificada de Quimibond. Cada canonical table sigue exactamente uno de los 4 patterns (§4). El frontend y los agentes leen canonical_* **y solo canonical_***.

**Naming.** Todas las tablas Silver llevan prefijo `canonical_`. Views Silver con mismo propósito pero derivados (join agregado) llevan prefijo `v_silver_` o viven en Gold según contenido. `products_unified`, `invoices_unified`, `payments_unified` etc. son **nombres legacy** que serán renombrados o retirados en SP2-SP5 (ver §12).

**Refresh.**
- Canonical tables de Pattern A, B, C pueden ser:
  - **Table materialized** con triggers de refresco incremental cuando Bronze upstream cambia, O
  - **Materialized view** refreshed con `REFRESH MATERIALIZED VIEW CONCURRENTLY` en cron cada 2h + debounced queue (§10).
- Decisión por entidad declarada en §5 per-table.

**Contenido (16 canonical tables):**
- **Pattern A (4):** `canonical_invoices`, `canonical_payments`, `canonical_credit_notes`, `canonical_tax_events`.
- **Pattern B (11):** `canonical_sale_orders`, `canonical_purchase_orders`, `canonical_order_lines`, `canonical_deliveries`, `canonical_inventory`, `canonical_manufacturing`, `canonical_bank_balances`, `canonical_fx_rates`, `canonical_account_balances`, `canonical_chart_of_accounts`, `canonical_crm_leads`.
- **Pattern C (4):** `canonical_companies`, `canonical_contacts`, `canonical_products`, `canonical_employees`.
- **MDM:** `source_links` (trazabilidad de matchings), `mdm_manual_overrides` (unificada, reemplaza los 3 bridges manuales existentes).

### 3.3 Gold — BI, reduced

**Definición.** Agregaciones denormalizadas para dashboards y reportes ejecutivos. Siempre leen de Silver; nunca de Bronze. Se optimizan para lectura, pueden tener redundancia controlada.

**Contenido post-migración.**
- `gold_company_360` (reemplaza `company_profile` + `company_profile_sat` + `analytics_customer_360`): perfil cliente/proveedor con métricas AR/AP/AR_aging/SAT_compliance/OTD/revenue_ytd.
- `gold_revenue_monthly` (reemplaza `monthly_revenue_trend` + `monthly_revenue_by_company` + `syntage_revenue_fiscal_monthly`): revenue mensual con dimensiones operativo/fiscal/booked/invoiced, rollup por company NULL.
- `gold_pl_statement` (refinamiento de `pl_estado_resultados`): estado de resultados mensual sobre canonical_account_balances.
- `gold_balance_sheet` (refinamiento de `balance_sheet` view actual): estado de posición sobre canonical_account_balances.
- `gold_cashflow` (consolida `cashflow_*` views en 1 view con clasificación por classification_key): current + predicted + aging por bucket.
- `gold_product_performance` (reemplaza `product_margin_analysis` + `customer_product_matrix` + `supplier_price_index`): producto con precio histórico + margen + top 10 clientes/proveedores.
- `gold_reconciliation_health` (nueva): dashboard de health del engine — issues by type/severity trending, auto-resolution rate, manual queue depth.
- `gold_ceo_inbox` (view): top 50 issues accionables ordenados por `priority_score = severity_weight × log(impact_mxn+1) × age_weight`.

**Reglas.**
- Cualquier columna en Gold debe ser derivable desde Silver en SQL puro.
- Gold tiene permission mode distinto (SELECT para anon en ciertos rows) pero nunca se exponen filas crudas de Bronze a anon.

### 3.4 Reconciliation engine

**Definición.** Servicio que ejecuta **invariantes** (§9.2) contra canonical + Bronze, emite `reconciliation_issues`, cierra automáticamente los que pasan a estar dentro de tolerancia, y surface los que quedan en el CEO Inbox.

**Componentes.**
- **Invariants catalog** — YAML/SQL declarativo de ~30-50 reglas (§9.2). Cada regla: `invariant_key`, `entity`, `check_sql`, `tolerance_key (fk a audit_tolerances)`, `severity_default`, `auto_resolve`, `$ impact derivation`.
- **Runner** — función SQL `run_reconciliation(invariant_key text DEFAULT NULL)`. NULL = full scan. Cada invariante corre independiente.
- **Scheduler** — pg_cron orquesta: críticas hourly, medianas every 2h, informativas daily.
- **Resolver** — algunas issues se auto-resuelven cuando la condición desaparece (complemento llega, UUID llena, cancel SAT matchea cancel Odoo).
- **Inbox query** — view `gold_ceo_inbox` + `reconciliation_issues.priority_score` (§9.5).

### 3.5 Evidence layer

**Definición.** Señales y artefactos que acompañan las canonical entities sin promoverse a ellas. Se linkean via FK + signal_type + confidence (Pattern D, §4.4).

**Tablas (§8):** `source_links` (MDM trazabilidad), `email_signals` (derivados de emails), `ai_extracted_facts` (sucesor de `facts`), `attachments` (XML/PDF vinculados), `manual_notes` (notas libres del operador asociadas a una entity).

---

## 4. Los 4 patterns

Cada canonical table sigue exactamente uno de los 4. Este framework elimina la improvisación: diseñar una nueva tabla canónica = elegir pattern + aplicar template.

### 4.1 Pattern A — Dual-source canonical

**Cuándo usar.** La entidad existe en 2 fuentes de primera clase que compiten (SAT + Odoo). Ambas deben cross-checkarse y el diff es un activo en sí mismo (riesgo fiscal, error de captura, timing).

**Forma.** Tabla wide con:
- Columnas `<campo>_odoo`, `<campo>_sat` para campos donde ambas fuentes aportan.
- Columnas resolved (`<campo>_resolved`) con regla de survivorship aplicada.
- Columnas `<campo>_diff_abs`, `<campo>_diff_pct`, `<campo>_has_discrepancy` computadas.
- Presence flags: `has_odoo_record`, `has_sat_record`.
- Sources meta: `sources_present text[]`, `sources_missing text[]`, `completeness_score numeric(4,3)`.
- FKs a canonical entities: `emisor_canonical_company_id`, `receptor_canonical_company_id`, etc.
- Review meta: `needs_review boolean`, `review_reason text[]`, `last_reconciled_at`, `source_hashes jsonb` (para change detection).

**Supervivencia por campo.** Declarada en la spec per-campo (ver §5.1-§5.4). Ejemplo: `amount_total_resolved = COALESCE(manual_override, sat_value_if_timbrado, odoo_value)`.

**Schema template (pseudocódigo).**
```sql
CREATE TABLE canonical_<entity> (
  canonical_id text PRIMARY KEY,
  -- source ids
  odoo_<entity>_id bigint,
  sat_uuid text,
  -- dual source columns (pattern repeats per field)
  amount_total_odoo numeric(14,2),
  amount_total_sat numeric(14,2),
  amount_total_resolved numeric(14,2),
  amount_total_diff_abs numeric(14,2) GENERATED ALWAYS AS (...) STORED,
  amount_total_has_discrepancy boolean GENERATED ALWAYS AS (...) STORED,
  -- ... repeat for all dual-source fields ...
  -- single-source fields (Odoo-only or SAT-only) pass through
  salesperson_canonical_contact_id bigint,  -- Odoo-only
  uso_cfdi text,                             -- SAT-only
  -- FKs
  emisor_canonical_company_id bigint REFERENCES canonical_companies(id),
  receptor_canonical_company_id bigint REFERENCES canonical_companies(id),
  -- presence
  has_odoo_record boolean,
  has_sat_record boolean,
  has_email_thread boolean,
  sources_present text[] NOT NULL,
  sources_missing text[] NOT NULL,
  completeness_score numeric(4,3),
  -- review
  needs_review boolean DEFAULT false,
  review_reason text[],
  last_reconciled_at timestamptz,
  source_hashes jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**Aplica a:** `canonical_invoices`, `canonical_payments`, `canonical_credit_notes`, `canonical_tax_events`.

### 4.2 Pattern B — Single-source thin wrapper

**Cuándo usar.** La entidad existe en exactamente una fuente autoritativa (usualmente Odoo). No hay cross-check posible. Silver añade valor vía: (i) resolución de FKs a canonical_*, (ii) derivación de campos (margins, aging, flags), (iii) renombres/normalización.

**Forma.**
- 1-a-1 con la Bronze table (o filtro claro).
- FKs resueltas a canonical_companies/canonical_contacts/canonical_products.
- Campos derivados explícitos (margin_percent, days_to_fulfill, is_late).
- No hay columnas dual-source.
- Puede ser view (light) o materialized view (con aggregations).

**Schema template.**
```sql
CREATE MATERIALIZED VIEW canonical_<entity> AS
SELECT
  b.<pk>                            AS canonical_id,
  b.<pk>                            AS odoo_<entity>_id,  -- redundante pero explícito
  -- FKs resueltas
  cc.id                             AS canonical_company_id,
  cp.id                             AS canonical_product_id,
  -- pass-through
  b.state, b.amount_total, b.date_order,
  -- derived
  <expr>                            AS margin_percent,
  <expr>                            AS is_late,
  now()                             AS refreshed_at
FROM odoo_<bronze> b
LEFT JOIN canonical_companies cc ON cc.odoo_partner_id = b.odoo_partner_id
LEFT JOIN canonical_products cp ON cp.odoo_product_id = b.odoo_product_id
WHERE ...;
```

**Aplica a:** `canonical_sale_orders`, `canonical_purchase_orders`, `canonical_order_lines`, `canonical_deliveries`, `canonical_inventory`, `canonical_manufacturing`, `canonical_bank_balances`, `canonical_fx_rates`, `canonical_account_balances`, `canonical_chart_of_accounts`, `canonical_crm_leads`.

### 4.3 Pattern C — MDM golden record

**Cuándo usar.** La entidad aparece en múltiples fuentes con identidades parciales (Odoo partner + Syntage RFC + Gmail sender + entity KG). Ninguna fuente tiene la identidad completa. Necesitamos resolver deterministic + probabilistic → un golden record por entidad real.

**Forma.**
- Canonical table con schema denormalizado (todos los campos enriquecidos).
- Natural key interno `canonical_id bigserial`.
- FKs múltiples a source ids: `odoo_partner_id`, `sat_rfc`, `entity_kg_id`, `primary_email_domain`.
- Survivorship rules aplicadas a cada campo (prioridad: manual override > Odoo operativo > SAT fiscal > Gmail signal > KG AI).
- `match_method` y `match_confidence` indican cómo se llegó al golden record actual.
- Tabla `source_links` acompaña (§6) con historial de links source → canonical.

**Schema template.**
```sql
CREATE TABLE canonical_<entity> (
  id bigserial PRIMARY KEY,
  -- identity
  primary_natural_key text,  -- rfc/email/internal_ref según entity
  display_name text NOT NULL,
  canonical_name text NOT NULL,  -- lowercase normalized for dedup
  -- source ids (nullable; presence in source_links)
  odoo_partner_id integer,
  sat_rfc text,
  primary_entity_kg_id bigint,
  -- golden record fields (apply survivorship)
  country text,
  ...
  -- provenance per field (optional metadata)
  display_name_source text,  -- 'odoo' | 'sat' | 'manual'
  country_source text,
  -- meta
  match_method text,  -- 'manual' | 'rfc_exact' | 'domain_match' | ...
  match_confidence numeric(4,3),
  has_manual_override boolean DEFAULT false,
  needs_review boolean DEFAULT false,
  completeness_score numeric(4,3),
  created_at timestamptz, updated_at timestamptz
);
```

**Aplica a:** `canonical_companies`, `canonical_contacts`, `canonical_products`, `canonical_employees`.

### 4.4 Pattern D — Evidence attached

**Cuándo usar.** Información no autoritativa pero accionable que acompaña canonical entities: emails signals, AI-extracted commitments, attachments, notas libres. Se consulta para contexto, no para decisión primaria.

**Forma.**
- Tabla con FK a canonical entity(s) + signal_type + confidence + source metadata.
- Nunca se promueve a canonical sin verificación explícita (`verified=true` + `verification_source`).
- Se purga/archiva con políticas separadas (no eterna como Bronze).

**Schema template.**
```sql
CREATE TABLE <evidence> (
  id bigserial PRIMARY KEY,
  canonical_entity_type text NOT NULL,  -- 'company' | 'contact' | 'invoice' | 'order' | ...
  canonical_entity_id bigint NOT NULL,  -- polymorphic FK (con index compuesto)
  signal_type text NOT NULL,            -- 'mentioned' | 'committed' | 'complained' | ...
  signal_value text,
  confidence numeric(4,3),
  source text NOT NULL,                  -- 'gmail' | 'claude_extract' | 'manual'
  source_ref text,                       -- gmail_message_id / extraction_run_id / user
  verified boolean DEFAULT false,
  verification_source text,
  verified_at timestamptz,
  extracted_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz
);
CREATE INDEX ON <evidence> (canonical_entity_type, canonical_entity_id);
```

**Aplica a:** `source_links` (cuando el source link mismo es señal), `email_signals`, `ai_extracted_facts`, `attachments`, `manual_notes`.

---

## 5. Canonical tables (schemas completas)

Cada subsección declara: pattern, propósito, schema completo (cada columna con tipo + nullability + default + autoridad + origen Bronze), survivorship rules, índices, example row.

> **Notación.** Tipos PostgreSQL explícitos. `numeric(14,2)` para MXN con 2 decimales. `numeric(18,6)` para tipos de cambio. `text` para strings no acotados. `timestamptz` siempre para fechas-con-hora (nunca `timestamp without tz`). GENERATED ALWAYS AS (...) STORED para computed columns.

### 5.1 `canonical_invoices` (Pattern A)

**Propósito.** Golden record por factura fiscal y/o interna. Una fila por CFDI (si existe) o factura Odoo (si existe sin CFDI). Para factura con ambos, una sola fila con campos dual-source.

**Natural key.** `canonical_id text` = `COALESCE(sat_uuid, 'odoo:' || odoo_invoice_id::text)`. UUID gana cuando existe; si no, namespaced Odoo id.

**Schema.**

```sql
CREATE TABLE canonical_invoices (
  -- === Identity ===
  canonical_id text PRIMARY KEY,
  odoo_invoice_id bigint,                                 -- from odoo_invoices.id (bigint). NULL si syntage_only.
  sat_uuid text,                                           -- from syntage_invoices.uuid. NULL si odoo_only.
  direction text NOT NULL,                                 -- 'issued' | 'received' | 'internal'
                                                            -- authority: SAT direction, fallback Odoo move_type mapping
  move_type_odoo text,                                     -- from odoo_invoices.move_type: out_invoice/out_refund/in_invoice/in_refund/entry
  tipo_comprobante_sat text,                               -- from syntage_invoices.tipo_comprobante: I/E/N/P/T

  -- === Monto nativo ===
  amount_total_odoo numeric(14,2),                         -- from odoo_invoices.amount_total
  amount_total_sat numeric(14,2),                          -- from syntage_invoices.total
  amount_total_resolved numeric(14,2),                     -- survivorship: manual_override > SAT post-timbre > Odoo pre-timbre
  amount_total_diff_abs numeric(14,2)
    GENERATED ALWAYS AS (
      CASE WHEN amount_total_odoo IS NOT NULL AND amount_total_sat IS NOT NULL
           THEN ABS(amount_total_odoo - amount_total_sat) END
    ) STORED,
  amount_total_has_discrepancy boolean
    GENERATED ALWAYS AS (
      amount_total_odoo IS NOT NULL AND amount_total_sat IS NOT NULL
      AND ABS(amount_total_odoo - amount_total_sat) > 0.50
    ) STORED,

  amount_untaxed_odoo numeric(14,2),                       -- from odoo_invoices.amount_untaxed
  amount_untaxed_sat numeric(14,2),                        -- from syntage_invoices.subtotal
  amount_tax_odoo numeric(14,2),                           -- from odoo_invoices.amount_tax
  amount_tax_sat numeric(14,2),                            -- from syntage_invoices.impuestos_trasladados
  amount_retenciones_sat numeric(14,2),                    -- from syntage_invoices.impuestos_retenidos (SAT-only)

  -- === Residual / Payments ===
  amount_residual_odoo numeric(14,2),                      -- from odoo_invoices.amount_residual
  amount_residual_sat numeric(14,2),                       -- from syntage_invoices_enriched.fiscal_due_amount
  amount_paid_odoo numeric(14,2),                          -- from odoo_invoices.amount_paid (often redundant)
  amount_paid_sat numeric(14,2),                           -- from syntage_invoices_enriched.fiscal_paid_amount
  amount_credited_sat numeric(14,2),                       -- from syntage_invoices_enriched.fiscal_credited_amount
  amount_residual_resolved numeric(14,2),                  -- survivorship: SAT post-timbre, Odoo fallback

  -- === MXN ===
  amount_total_mxn_odoo numeric(14,2),                     -- from odoo_invoices.amount_total_mxn
  amount_total_mxn_sat numeric(14,2),                      -- from syntage_invoices.total_mxn (subtotal × tipo_cambio)
  amount_total_mxn_resolved numeric(14,2),                 -- survivorship: P3 (SAT for fiscal reports, Odoo for ops dashboards) — mantener ambas + flag
  amount_total_mxn_diff_abs numeric(14,2)
    GENERATED ALWAYS AS (
      CASE WHEN amount_total_mxn_odoo IS NOT NULL AND amount_total_mxn_sat IS NOT NULL
           THEN ABS(amount_total_mxn_odoo - amount_total_mxn_sat) END
    ) STORED,
  amount_total_mxn_diff_pct numeric(8,4)
    GENERATED ALWAYS AS (
      CASE WHEN amount_total_mxn_odoo IS NOT NULL AND amount_total_mxn_sat IS NOT NULL
                AND amount_total_mxn_sat <> 0
           THEN ROUND(100.0 * ABS(amount_total_mxn_odoo - amount_total_mxn_sat) / amount_total_mxn_sat, 4) END
    ) STORED,

  amount_residual_mxn_odoo numeric(14,2),
  amount_residual_mxn_resolved numeric(14,2),

  -- === Moneda / FX ===
  currency_odoo text,                                       -- from odoo_invoices.currency (MXN/USD/EUR)
  currency_sat text,                                        -- from syntage_invoices.moneda
  tipo_cambio_odoo numeric(18,6),                           -- derived odoo_currency_rates.rate at invoice_date
  tipo_cambio_sat numeric(18,6),                            -- from syntage_invoices.tipo_cambio (frozen on CFDI)

  -- === Fechas ===
  invoice_date date,                                        -- from odoo_invoices.invoice_date — Odoo authority
  fecha_emision timestamptz,                                -- from syntage_invoices.fecha_emision
  fecha_timbrado timestamptz,                               -- from syntage_invoices.fecha_timbrado — SAT authority
  fecha_cancelacion timestamptz,                            -- from syntage_invoices.fecha_cancelacion — SAT authority
  due_date_odoo date,                                       -- from odoo_invoices.due_date
  fiscal_due_date timestamptz,                              -- from syntage_invoices_enriched.fiscal_due_date
  due_date_resolved date,                                   -- survivorship: manual > Odoo (operativo)
  fiscal_fully_paid_at timestamptz,                         -- from syntage_invoices_enriched.fiscal_fully_paid_at
  fiscal_last_payment_date timestamptz,                     -- from syntage_invoices_enriched.fiscal_last_payment_date
  payment_date_odoo date,                                   -- from odoo_invoices.payment_date (dead-pixel today; expose it)
  fiscal_days_to_full_payment integer,                      -- from syntage_invoices_enriched.fiscal_days_to_full_payment
  fiscal_days_to_due_date integer,

  date_has_discrepancy boolean
    GENERATED ALWAYS AS (
      invoice_date IS NOT NULL AND fecha_timbrado IS NOT NULL
      AND ABS(invoice_date - fecha_timbrado::date) > 3
    ) STORED,

  -- === Estados ===
  state_odoo text,                                          -- from odoo_invoices.state: draft/posted/cancel
  payment_state_odoo text,                                  -- from odoo_invoices.payment_state: not_paid/partial/paid/in_payment
  estado_sat text,                                          -- from syntage_invoices.estado_sat: vigente/cancelado — SAT authority
  cfdi_sat_state_odoo text,                                 -- from odoo_invoices.cfdi_sat_state (Odoo's SAT reflection)
  edi_state_odoo text,                                      -- from odoo_invoices.edi_state
  fiscal_cancellation_process_status text,                  -- from syntage_invoices_enriched.fiscal_cancellation_process_status
  state_mismatch boolean
    GENERATED ALWAYS AS (
      (state_odoo = 'cancel' AND estado_sat = 'vigente')
      OR (state_odoo = 'posted' AND estado_sat = 'cancelado')
    ) STORED,

  -- === Identificadores / Referencias ===
  odoo_name text,                                           -- INV/2026/03/0173
  cfdi_uuid_odoo text,                                      -- from odoo_invoices.cfdi_uuid (pending _build_cfdi_map fix, §14)
  serie text, folio text,
  odoo_ref text,                                            -- from odoo_invoices.ref

  -- === Partners ===
  emisor_rfc text,                                          -- SAT authority
  emisor_nombre text,
  receptor_rfc text,
  receptor_nombre text,
  odoo_partner_id integer,
  emisor_canonical_company_id bigint REFERENCES canonical_companies(id),
  receptor_canonical_company_id bigint REFERENCES canonical_companies(id),

  -- === 69B ===
  emisor_blacklist_status text,                             -- from syntage_invoices.emisor_blacklist_status: NULL/presumed/definitive
  receptor_blacklist_status text,                           -- idem
  blacklist_action text                                     -- computed: NULL/warning/block
    GENERATED ALWAYS AS (
      CASE
        WHEN emisor_blacklist_status = 'definitive' OR receptor_blacklist_status = 'definitive' THEN 'block'
        WHEN emisor_blacklist_status = 'presumed'   OR receptor_blacklist_status = 'presumed'   THEN 'warning'
        ELSE NULL
      END
    ) STORED,

  -- === Metodo/Forma pago + payment term ===
  metodo_pago text,                                         -- from syntage_invoices.metodo_pago: PUE/PPD — SAT authority
  forma_pago text,                                          -- from syntage_invoices.forma_pago: 01/03/04... — SAT authority
  uso_cfdi text,                                            -- SAT-only
  payment_term_odoo text,                                   -- from odoo_invoices.payment_term
  fiscal_payment_terms_raw text,                            -- from syntage_invoices_enriched.fiscal_payment_terms_raw
  fiscal_payment_terms jsonb,                               -- from syntage_invoices_enriched.fiscal_payment_terms

  -- === Salesperson / operación ===
  salesperson_user_id integer,                              -- from odoo_invoices.salesperson_user_id
  salesperson_canonical_contact_id bigint REFERENCES canonical_contacts(id),

  -- === Flags + historical ===
  historical_pre_odoo boolean                               -- computed: fecha_timbrado < 2021-01-01 AND odoo_invoice_id IS NULL
    GENERATED ALWAYS AS (
      odoo_invoice_id IS NULL AND fecha_timbrado IS NOT NULL AND fecha_timbrado < '2021-01-01'::timestamptz
    ) STORED,
  pending_operationalization boolean                         -- computed: SAT exists but Odoo doesn't (post-2021 gap)
    GENERATED ALWAYS AS (
      sat_uuid IS NOT NULL AND odoo_invoice_id IS NULL AND fecha_timbrado >= '2021-01-01'::timestamptz
    ) STORED,

  -- === Presence & meta ===
  has_odoo_record boolean NOT NULL DEFAULT false,
  has_sat_record boolean NOT NULL DEFAULT false,
  has_email_thread boolean NOT NULL DEFAULT false,
  has_manual_link boolean NOT NULL DEFAULT false,
  sources_present text[] NOT NULL DEFAULT '{}',              -- {'odoo','sat','email'}
  sources_missing text[] NOT NULL DEFAULT '{}',
  completeness_score numeric(4,3),                          -- (sources_present_count / expected_sources_for_direction)
  needs_review boolean DEFAULT false,
  review_reason text[],                                     -- {'amount_mismatch','date_drift','state_mismatch','..' }
  source_hashes jsonb,                                      -- {'odoo_write_date': '...', 'sat_synced_at': '...'}
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON canonical_invoices (sat_uuid) WHERE sat_uuid IS NOT NULL;
CREATE INDEX ON canonical_invoices (odoo_invoice_id) WHERE odoo_invoice_id IS NOT NULL;
CREATE INDEX ON canonical_invoices (emisor_canonical_company_id);
CREATE INDEX ON canonical_invoices (receptor_canonical_company_id);
CREATE INDEX ON canonical_invoices (direction, invoice_date DESC);
CREATE INDEX ON canonical_invoices (needs_review) WHERE needs_review = true;
CREATE INDEX ON canonical_invoices (pending_operationalization) WHERE pending_operationalization = true;
CREATE INDEX ON canonical_invoices (state_mismatch) WHERE state_mismatch = true;
CREATE INDEX ON canonical_invoices (amount_total_has_discrepancy) WHERE amount_total_has_discrepancy = true;
CREATE INDEX ON canonical_invoices (invoice_date);
CREATE INDEX ON canonical_invoices (fecha_timbrado);
CREATE INDEX ON canonical_invoices (historical_pre_odoo) WHERE historical_pre_odoo = true;
```

**Survivorship rules explícitas.**

| Campo resolved | Regla | Fuente default |
|---|---|---|
| `amount_total_resolved` | manual_override IF invoice_bridge_manual.linked_amount ELSE sat IF fecha_timbrado IS NOT NULL ELSE odoo | SAT post-timbre (P3 fiscal) |
| `amount_residual_resolved` | manual_override ELSE SAT (fiscal_due_amount) IF fecha_timbrado IS NOT NULL ELSE Odoo | SAT post-timbre |
| `amount_total_mxn_resolved` | para dashboards ops: Odoo; para reportes fiscales: SAT. Exponer ambas + flag `amount_total_mxn_diff_abs`; el query-time decide (user decision TBD — recomendado SAT para `gold_company_360`, Odoo para `gold_cashflow`) | (Ver §17 Risks) |
| `due_date_resolved` | manual_override ELSE Odoo (P3 operativo) | Odoo |
| `tipo_cambio` (al contexto) | para ese CFDI específico: SAT (frozen); para book-keeping diario: Odoo | SAT per-invoice |
| `estado_sat` | SAT absoluta (P3 fiscal) | SAT |
| `state_odoo` | Odoo absoluta (interno) | Odoo |
| `metodo_pago` / `forma_pago` / `uso_cfdi` | SAT (P3 fiscal) | SAT |
| `emisor_rfc` / `receptor_rfc` | SAT (P3 fiscal) | SAT |
| `odoo_name` / `odoo_ref` | Odoo (operativo) | Odoo |
| `salesperson_*` | Odoo (operativo) | Odoo |
| `cfdi_uuid` (cuando se necesita un solo valor) | SAT `uuid` IF has_sat_record ELSE odoo `cfdi_uuid` (post-addon-fix §14) | SAT |
| `historical_pre_odoo` / `pending_operationalization` | computed (sin fuente) | - |

**Flags de presencia (user decisions firmadas).**
- `pending_operationalization=true`: CFDI existe en SAT, no en Odoo, post-2021 → Odoo overlay con flag; se muestra en UI con CTA "operacionalizar".
- `historical_pre_odoo=true`: CFDI pre-2021, no tiene contraparte Odoo jamás → visible en misma tabla (user decision firmada) pero excluido de reconciliation_issues.
- `state_mismatch=true`: compite con `cancelled_but_posted` issue.
- `amount_total_has_discrepancy=true`: compite con `amount_mismatch` issue (a través de invariantes §9.2).

**Example row (emisión Quimibond → CONTITECH MEXICANA, UUID real).**

```
canonical_id: '19a3dc5f-d07f-450b-ad20-aa3d92212a06'
odoo_invoice_id: 14753
sat_uuid: '19a3dc5f-d07f-450b-ad20-aa3d92212a06'
direction: 'issued'
move_type_odoo: 'out_invoice'
tipo_comprobante_sat: 'I'
amount_total_odoo: 756773.73
amount_total_sat: 756773.73
amount_total_resolved: 756773.73
amount_total_diff_abs: 0.00
amount_total_has_discrepancy: false
amount_total_mxn_odoo: 756773.73
amount_total_mxn_sat: 756773.73
amount_total_mxn_resolved: 756773.73
currency_odoo: 'MXN'
currency_sat: 'MXN'
tipo_cambio_sat: 17.268800
invoice_date: '2026-03-15'
fecha_timbrado: '2026-03-15 14:22:10+00'
state_odoo: 'posted'
estado_sat: 'vigente'
payment_state_odoo: 'not_paid'
fiscal_due_date: '2026-04-14 14:22:10+00'
fiscal_fully_paid_at: NULL
metodo_pago: 'PPD'
forma_pago: '99'
uso_cfdi: 'G03'
emisor_rfc: 'PNT920218IW5'
receptor_rfc: 'CME990531HR4'
emisor_canonical_company_id: 1 (Quimibond)
receptor_canonical_company_id: 482 (CONTITECH MEXICANA)
blacklist_action: NULL
salesperson_canonical_contact_id: 23 (Guadalupe Guerrero)
historical_pre_odoo: false
pending_operationalization: false
has_odoo_record: true
has_sat_record: true
has_email_thread: false
has_manual_link: false
sources_present: {'odoo','sat'}
sources_missing: {'email'}
completeness_score: 0.667
needs_review: false
review_reason: {}
```

### 5.2 `canonical_payments` (Pattern A)

**Propósito.** Golden record por pago operativo (banco/caja) y/o complemento P SAT, con allocations a invoices. Una fila por (odoo_payment_id, sat_uuid_complemento) resueltos al mismo evento bancario.

**Natural key.** `canonical_id text` = `COALESCE('odoo:'||odoo_payment_id::text, 'sat:'||sat_uuid_complemento)`.

**Schema.**

```sql
CREATE TABLE canonical_payments (
  canonical_id text PRIMARY KEY,
  odoo_payment_id bigint,                                  -- from odoo_account_payments.id
  sat_uuid_complemento text,                               -- from syntage_invoice_payments.uuid_complemento
  direction text NOT NULL,                                  -- 'received' | 'sent'

  -- === Monto ===
  amount_odoo numeric(14,2),                                -- from odoo_account_payments.amount
  amount_sat numeric(14,2),                                 -- from syntage_invoice_payments.monto
  amount_resolved numeric(14,2),
  amount_diff_abs numeric(14,2)
    GENERATED ALWAYS AS (
      CASE WHEN amount_odoo IS NOT NULL AND amount_sat IS NOT NULL
           THEN ABS(amount_odoo - amount_sat) END
    ) STORED,
  amount_has_discrepancy boolean
    GENERATED ALWAYS AS (
      amount_odoo IS NOT NULL AND amount_sat IS NOT NULL
      AND ABS(amount_odoo - amount_sat) > 0.01
    ) STORED,

  -- === MXN ===
  amount_mxn_odoo numeric(14,2),                            -- from odoo_account_payments.amount_signed or derived via FX
  amount_mxn_sat numeric(14,2),                             -- from syntage_invoice_payments.monto × tipo_cambio_p
  amount_mxn_resolved numeric(14,2),

  -- === Moneda / FX ===
  currency_odoo text,                                       -- from odoo_account_payments.currency
  currency_sat text,                                        -- from syntage_invoice_payments.moneda_p
  tipo_cambio_sat numeric(18,6),                            -- from syntage_invoice_payments.tipo_cambio_p

  -- === Fechas ===
  payment_date_odoo date,                                   -- from odoo_account_payments.date
  fecha_pago_sat timestamptz,                               -- from syntage_invoice_payments.fecha_pago
  payment_date_resolved date,                               -- survivorship: Odoo (operativo) — SAT es confirmación
  date_has_discrepancy boolean
    GENERATED ALWAYS AS (
      payment_date_odoo IS NOT NULL AND fecha_pago_sat IS NOT NULL
      AND ABS(payment_date_odoo - fecha_pago_sat::date) > 1
    ) STORED,

  -- === Forma pago / journal ===
  forma_pago_sat text,                                      -- SAT authority for 01/03/04
  payment_method_odoo text,                                 -- from odoo_account_payments.payment_method
  journal_name text,                                        -- from odoo_account_payments.journal_name
  journal_type text,                                        -- cash/bank/credit_card
  is_reconciled boolean,                                    -- from odoo_account_payments.is_reconciled (Odoo)
  reconciled_invoices_count integer,                        -- from odoo_account_payments.reconciled_invoices_count

  -- === Counterparties ===
  rfc_emisor_cta_ord text,                                  -- SAT: RFC banco emisor
  rfc_emisor_cta_ben text,                                  -- SAT: RFC banco beneficiario
  num_operacion text,                                       -- from syntage_invoice_payments.num_operacion (key matching)
  odoo_ref text,                                            -- from odoo_account_payments.ref

  -- === Partner ===
  partner_name text,
  odoo_partner_id integer,
  counterparty_canonical_company_id bigint REFERENCES canonical_companies(id),
  estado_sat text,                                          -- from syntage_invoice_payments.estado_sat

  -- === Allocations (stored separately in canonical_payment_allocations; also cached here) ===
  allocation_count integer,
  allocated_invoices_uuid text[],                           -- from doctos_relacionados jsonb expansion
  amount_allocated numeric(14,2),
  amount_unallocated numeric(14,2)
    GENERATED ALWAYS AS (amount_resolved - COALESCE(amount_allocated,0)) STORED,

  -- === Flags ===
  registered_but_not_fiscally_confirmed boolean             -- user decision firmada: Odoo paid, no SAT complemento
    GENERATED ALWAYS AS (
      odoo_payment_id IS NOT NULL AND sat_uuid_complemento IS NULL
    ) STORED,
  complement_without_payment boolean
    GENERATED ALWAYS AS (
      sat_uuid_complemento IS NOT NULL AND odoo_payment_id IS NULL
    ) STORED,

  -- === Presence & meta ===
  has_odoo_record boolean NOT NULL DEFAULT false,
  has_sat_record boolean NOT NULL DEFAULT false,
  has_manual_link boolean NOT NULL DEFAULT false,
  sources_present text[] NOT NULL DEFAULT '{}',
  sources_missing text[] NOT NULL DEFAULT '{}',
  completeness_score numeric(4,3),
  needs_review boolean DEFAULT false,
  review_reason text[],
  source_hashes jsonb,
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Allocations (payment → invoice) - separate table for multiplicity
CREATE TABLE canonical_payment_allocations (
  id bigserial PRIMARY KEY,
  payment_canonical_id text NOT NULL REFERENCES canonical_payments(canonical_id) ON DELETE CASCADE,
  invoice_canonical_id text NOT NULL,  -- not FK (invoice may be historical_pre_odoo)
  allocated_amount numeric(14,2) NOT NULL,
  currency text,
  source text NOT NULL,                -- 'sat_complemento' | 'odoo_link' | 'manual'
  sat_saldo_anterior numeric(14,2),
  sat_saldo_insoluto numeric(14,2),
  sat_num_parcialidad integer,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX ON canonical_payment_allocations (payment_canonical_id);
CREATE INDEX ON canonical_payment_allocations (invoice_canonical_id);

CREATE INDEX ON canonical_payments (sat_uuid_complemento) WHERE sat_uuid_complemento IS NOT NULL;
CREATE INDEX ON canonical_payments (odoo_payment_id) WHERE odoo_payment_id IS NOT NULL;
CREATE INDEX ON canonical_payments (counterparty_canonical_company_id);
CREATE INDEX ON canonical_payments (direction, payment_date_resolved DESC);
CREATE INDEX ON canonical_payments (registered_but_not_fiscally_confirmed) WHERE registered_but_not_fiscally_confirmed = true;
CREATE INDEX ON canonical_payments (complement_without_payment) WHERE complement_without_payment = true;
CREATE INDEX ON canonical_payments (num_operacion);
```

**Survivorship.**

| Campo | Regla | Fuente default |
|---|---|---|
| `amount_resolved` | manual > Odoo (flujo real) > SAT | Odoo |
| `payment_date_resolved` | manual > Odoo (operativo) > SAT | Odoo |
| `forma_pago_sat` | SAT (P3 fiscal, código normalizado) | SAT |
| `payment_method_odoo` | Odoo (texto libre operativo) | Odoo |
| `journal_name`, `is_reconciled`, `reconciled_invoices_count` | Odoo (P3 operativo, único source) | Odoo |
| `num_operacion` | SAT (CFDI-derived; Odoo.ref a menudo vacío) | SAT |
| `counterparty_canonical_company_id` | resolución vía `counterparty_canonical_company_id` matcher (P4 MDM) | MDM |

**Flag `registered_but_not_fiscally_confirmed`** (user-firmada): Odoo tiene pago registrado, SAT aún no tiene complemento P → warning amarillo en UI; si >30 días → critical. Dispara invariante `payment_missing_complemento`.

**Example row (recibido BBVA → Quimibond, complemento P PPD).**

```
canonical_id: 'odoo:8421'
odoo_payment_id: 8421
sat_uuid_complemento: 'a7f3de22-9c1b-4e5d-8f3a-1c5e7a9d2b4f'
direction: 'received'
amount_odoo: 756773.73
amount_sat: 756773.73
amount_resolved: 756773.73
amount_mxn_resolved: 756773.73
currency_odoo: 'MXN'
currency_sat: 'MXN'
payment_date_odoo: '2026-04-08'
fecha_pago_sat: '2026-04-08 18:00:00+00'
payment_date_resolved: '2026-04-08'
forma_pago_sat: '03'  -- transferencia
payment_method_odoo: 'Transferencia SPEI BBVA'
journal_name: 'BBVA MXN'
journal_type: 'bank'
is_reconciled: true
num_operacion: '40012887234'
partner_name: 'CONTITECH MEXICANA'
counterparty_canonical_company_id: 482
allocation_count: 1
allocated_invoices_uuid: ['19a3dc5f-d07f-450b-ad20-aa3d92212a06']
amount_allocated: 756773.73
amount_unallocated: 0.00
registered_but_not_fiscally_confirmed: false
complement_without_payment: false
has_odoo_record: true
has_sat_record: true
sources_present: {'odoo','sat'}
completeness_score: 1.000
```

### 5.3 `canonical_credit_notes` (Pattern A)

**Propósito.** Notas de crédito (Egreso). Subconjunto semánticamente distinto de invoices (`tipo_comprobante='E'` SAT, `move_type IN ('out_refund','in_refund')` Odoo). Separarla de `canonical_invoices` simplifica agents (las facturas de ingreso no deberían contarse con signo negativo).

**Schema.** Idéntico template a §5.1 con ajustes:
```sql
CREATE TABLE canonical_credit_notes (
  canonical_id text PRIMARY KEY,
  odoo_invoice_id bigint,
  sat_uuid text,
  direction text NOT NULL,                                 -- 'issued'|'received'
  move_type_odoo text,                                     -- out_refund|in_refund
  tipo_comprobante_sat text NOT NULL DEFAULT 'E',
  -- === Monto negativo conceptual ===
  amount_total_odoo numeric(14,2),
  amount_total_sat numeric(14,2),
  amount_total_resolved numeric(14,2),
  amount_total_mxn_resolved numeric(14,2),
  -- === Link a factura origen (SAT CfdiRelacionados) ===
  related_invoice_uuid text,                               -- from syntage_invoices.raw_payload.cfdiRelacionados[0].uuid
  related_invoice_canonical_id text,
  related_invoice_canonical_fk bigint,                     -- resuelto a canonical_invoices.canonical_id
  tipo_relacion text,                                       -- SAT code: 01=NC devolucion, 03=NC descuento, etc.
  reversed_entry_id_odoo bigint,                            -- from odoo_invoices.reversed_entry_id (not in push today — §14)
  -- === Resto del schema: igual que canonical_invoices (fechas, states, partners, 69B, metodo/forma, presence, meta) ===
  emisor_rfc text, receptor_rfc text,
  emisor_canonical_company_id bigint REFERENCES canonical_companies(id),
  receptor_canonical_company_id bigint REFERENCES canonical_companies(id),
  fecha_emision timestamptz, fecha_timbrado timestamptz, fecha_cancelacion timestamptz,
  state_odoo text, estado_sat text, state_mismatch boolean,
  historical_pre_odoo boolean, pending_operationalization boolean,
  has_odoo_record boolean, has_sat_record boolean, has_manual_link boolean,
  sources_present text[], sources_missing text[], completeness_score numeric(4,3),
  needs_review boolean, review_reason text[], source_hashes jsonb,
  last_reconciled_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX ON canonical_credit_notes (related_invoice_canonical_id);
CREATE INDEX ON canonical_credit_notes (sat_uuid) WHERE sat_uuid IS NOT NULL;
```

**Survivorship & flags.** Idénticas a §5.1. Extra: `related_invoice_canonical_id` resuelve via `syntage_invoices.raw_payload.cfdiRelacionados[0].uuid` (SAT authority); fallback `odoo_invoices.reversed_entry_id` (pendiente de sync, §14).

**Invariante nueva.** `credit_note_orphan`: NC post-2021 sin `related_invoice_canonical_id` resuelto. Hoy existen 2,009 Egresos SAT vs 582 out_refund Odoo — gap medible.

### 5.4 `canonical_tax_events` (Pattern A)

**Propósito.** Eventos fiscales que no son factura ni pago: retenciones ISR/IVA, declaraciones mensuales, contabilidad electrónica SAT. Cada uno con reconciliación contra Odoo equivalente.

**Schema.**

```sql
CREATE TABLE canonical_tax_events (
  canonical_id text PRIMARY KEY,                            -- 'retention:<uuid>' | 'return:<ejercicio-periodo-impuesto>' | 'acct:<ejercicio-periodo-record>'
  event_type text NOT NULL,                                 -- 'retention' | 'tax_return' | 'electronic_accounting'
  sat_record_id text,                                       -- syntage_id de retention/return/acct
  -- === Retention fields (event_type='retention') ===
  retention_uuid text,                                       -- from syntage_tax_retentions.uuid
  tipo_retencion text,                                       -- from syntage_tax_retentions.tipo_retencion
  monto_total_retenido numeric(14,2),
  emisor_rfc text, receptor_rfc text,
  retention_fecha_emision timestamptz,
  -- === Tax return fields (event_type='tax_return') ===
  return_ejercicio integer,
  return_periodo text,                                       -- YYYY-MM or quarter
  return_impuesto text,                                      -- ISR/IVA
  return_tipo_declaracion text,
  return_fecha_presentacion timestamptz,
  return_monto_pagado numeric(14,2),
  return_numero_operacion text,
  -- === Electronic accounting fields (event_type='electronic_accounting') ===
  acct_ejercicio integer,
  acct_periodo text,
  acct_record_type text,                                     -- CT/BN/PL (catálogo/balanza/pólizas)
  acct_tipo_envio text,
  acct_hash text,
  -- === Odoo reconciliation ===
  odoo_payment_id bigint,                                    -- link a pago SAT (account.payment outbound tipo=SAT)
  odoo_account_ids integer[],                                -- cuentas Odoo donde se contabilizó
  odoo_reconciled_amount numeric(14,2),
  reconciliation_diff_abs numeric(14,2)
    GENERATED ALWAYS AS (
      CASE
        WHEN event_type = 'retention' AND monto_total_retenido IS NOT NULL AND odoo_reconciled_amount IS NOT NULL
          THEN ABS(monto_total_retenido - odoo_reconciled_amount)
        WHEN event_type = 'tax_return' AND return_monto_pagado IS NOT NULL AND odoo_reconciled_amount IS NOT NULL
          THEN ABS(return_monto_pagado - odoo_reconciled_amount)
        ELSE NULL
      END
    ) STORED,
  -- === Meta ===
  sat_estado text,
  taxpayer_rfc text NOT NULL DEFAULT 'PNT920218IW5',
  has_odoo_match boolean DEFAULT false,
  needs_review boolean DEFAULT false,
  review_reason text[],
  source_hashes jsonb,
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON canonical_tax_events (event_type);
CREATE INDEX ON canonical_tax_events (return_ejercicio, return_periodo) WHERE event_type = 'tax_return';
CREATE INDEX ON canonical_tax_events (acct_ejercicio, acct_periodo) WHERE event_type = 'electronic_accounting';
CREATE INDEX ON canonical_tax_events (has_odoo_match) WHERE has_odoo_match = false;
```

**Invariantes asociadas:** `retention_accounting_drift`, `tax_return_payment_missing`, `accounting_sat_drift` (§9.2).

### 5.5 `canonical_companies` (Pattern C) — MDM golden record

**Propósito.** Un golden record por empresa real (cliente/proveedor/otro). Resuelve las múltiples identidades parciales: Odoo partner, SAT RFCs apareciendo en CFDIs, Gmail sender domains, Knowledge Graph entities.

**Schema (~60 columnas).**

```sql
CREATE TABLE canonical_companies (
  -- === Identity ===
  id bigserial PRIMARY KEY,
  canonical_name text NOT NULL,                             -- lowercase normalized
  display_name text NOT NULL,                                -- trimmed, casing preservado

  -- === Source IDs (sparse; FK to Bronze/KG) ===
  rfc text,                                                  -- Authority: SAT (P3 fiscal), fallback Odoo vat
  odoo_partner_id integer,                                   -- Authority: Odoo (operativo)
  primary_entity_kg_id bigint,                               -- FK a entities.id del KG
  primary_email_domain text,                                 -- 'contitech.com', derivado de emails

  -- === Role ===
  is_customer boolean NOT NULL DEFAULT false,                -- from Odoo customer_rank > 0
  is_supplier boolean NOT NULL DEFAULT false,                -- from Odoo supplier_rank > 0
  is_internal boolean NOT NULL DEFAULT false,                -- Quimibond propio
  is_sat_counterparty boolean GENERATED ALWAYS AS (          -- aparece en CFDIs
    primary_entity_kg_id IS NOT NULL OR rfc IS NOT NULL
  ) STORED,

  -- === Fiscal identity (SAT + tax status) ===
  regimen_fiscal text,                                       -- Authority: SAT syntage_tax_status (propio); terceros NULL
  person_type text,                                          -- 'legal' | 'physical' (from syntage_taxpayers.person_type)
  opinion_cumplimiento text,                                 -- 'positiva' | 'negativa' | 'no_inscrito' (solo propio hoy)
  blacklist_level text NOT NULL DEFAULT 'none',              -- 'none' | 'presumed' | 'definitive'
                                                              -- Authority: SAT (syntage_invoices.*_blacklist_status agregado)
  blacklist_first_flagged_at timestamptz,
  blacklist_last_flagged_at timestamptz,
  blacklist_cfdis_flagged_count integer DEFAULT 0,
  blacklist_action text                                      -- computed
    GENERATED ALWAYS AS (
      CASE blacklist_level
        WHEN 'definitive' THEN 'block'
        WHEN 'presumed'   THEN 'warning'
        ELSE NULL
      END
    ) STORED,

  -- === Dirección ===
  country text,                                              -- Odoo country_id.name
  state text,
  city text,
  zip text,
  street text,
  domicilio_fiscal jsonb,                                    -- SAT (solo propio); terceros NULL

  -- === Comercial ===
  industry text,
  business_type text,
  credit_limit numeric(14,2),                                -- Odoo res.partner.credit_limit
  payment_term text,                                         -- Odoo property_payment_term_id (customer)
  supplier_payment_term text,                                -- Odoo (supplier)

  -- === Enrichment (Claude signals, NOT authoritative) ===
  description text,                                          -- Claude enrichment
  strategic_notes text,                                      -- Manual notes
  relationship_type text,                                    -- 'strategic'|'transactional'|...
  relationship_summary text,
  key_products jsonb,                                        -- [{internal_ref, share_pct}]
  risk_signals jsonb,
  opportunity_signals jsonb,
  enriched_at timestamptz,
  enrichment_source text,                                    -- 'claude-extract-v1'

  -- === Aggregated metrics (from canonical_invoices/payments agregación) ===
  lifetime_value_mxn numeric(14,2) DEFAULT 0,                -- SUM(canonical_invoices.amount_total_mxn_resolved)
  total_invoiced_odoo_mxn numeric(14,2) DEFAULT 0,
  total_invoiced_sat_mxn numeric(14,2) DEFAULT 0,
  revenue_ytd_mxn numeric(14,2) DEFAULT 0,
  revenue_90d_mxn numeric(14,2) DEFAULT 0,
  revenue_prior_90d_mxn numeric(14,2) DEFAULT 0,
  trend_pct numeric(8,4),                                    -- (revenue_90d - prior) / prior × 100
  total_credit_notes_mxn numeric(14,2) DEFAULT 0,
  invoices_count integer DEFAULT 0,
  last_invoice_date date,

  -- === AR / AP ===
  total_receivable_mxn numeric(14,2) DEFAULT 0,              -- SUM residual out_invoice
  total_payable_mxn numeric(14,2) DEFAULT 0,                 -- SUM residual in_invoice
  total_pending_mxn numeric(14,2) DEFAULT 0,
  ar_aging_buckets jsonb,                                    -- {"current":..., "1-30":..., "31-60":..., ">90":...}
  overdue_amount_mxn numeric(14,2) DEFAULT 0,
  overdue_count integer DEFAULT 0,
  max_days_overdue integer,

  -- === Operativo ===
  total_deliveries_count integer DEFAULT 0,
  late_deliveries_count integer DEFAULT 0,
  otd_rate numeric(5,4),                                     -- on-time delivery rate 12m
  otd_rate_90d numeric(5,4),

  -- === Email / comunicación ===
  email_count integer DEFAULT 0,
  last_email_at timestamptz,
  contact_count integer DEFAULT 0,                           -- COUNT(canonical_contacts WHERE canonical_company_id = id)

  -- === Compliance ===
  sat_compliance_score numeric(5,4),                         -- (invoices_with_syntage_match / invoices_with_cfdi)
  invoices_with_cfdi integer DEFAULT 0,
  invoices_with_syntage_match integer DEFAULT 0,
  sat_open_issues_count integer DEFAULT 0,

  -- === Risk tier ===
  risk_level text,                                           -- 'low'|'medium'|'high'
  tier text,                                                 -- 'A'|'B'|'C' Pareto
  revenue_share_pct numeric(5,4),

  -- === MDM meta ===
  match_method text,                                         -- 'rfc_exact' | 'odoo_partner_id' | 'domain_match' | 'name_fuzzy' | 'manual_override'
  match_confidence numeric(4,3),
  has_manual_override boolean DEFAULT false,
  has_shadow_flag boolean DEFAULT false,                      -- user decision: SAT-only counterparty, visible en UI para formalizar en Odoo
  shadow_reason text,                                         -- 'sat_cfdi_only_post_2021' | 'gmail_mention_only' | ...
  needs_review boolean DEFAULT false,
  review_reason text[],
  completeness_score numeric(4,3),                            -- % de campos core poblados
  last_matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON canonical_companies (canonical_name);
CREATE INDEX ON canonical_companies (rfc) WHERE rfc IS NOT NULL;
CREATE INDEX ON canonical_companies (odoo_partner_id) WHERE odoo_partner_id IS NOT NULL;
CREATE INDEX ON canonical_companies (primary_email_domain) WHERE primary_email_domain IS NOT NULL;
CREATE INDEX ON canonical_companies (is_customer) WHERE is_customer = true;
CREATE INDEX ON canonical_companies (is_supplier) WHERE is_supplier = true;
CREATE INDEX ON canonical_companies (blacklist_level) WHERE blacklist_level <> 'none';
CREATE INDEX ON canonical_companies (has_shadow_flag) WHERE has_shadow_flag = true;
CREATE INDEX ON canonical_companies (needs_review) WHERE needs_review = true;
```

**Survivorship (per campo key).**

| Campo | Regla | Fuente |
|---|---|---|
| `rfc` | manual override > SAT (apareció en CFDI) > Odoo vat | SAT |
| `canonical_name` | manual override > Odoo res.partner.name lowercased > entities.canonical_name | Odoo |
| `display_name` | Odoo | Odoo |
| `odoo_partner_id` | Odoo único | Odoo |
| `country`/`state`/`city`/`zip`/`street` | Odoo (país/ciudad) + SAT domicilio_fiscal para propio; enrichment NUNCA reemplaza | Odoo |
| `domicilio_fiscal jsonb` | SAT (único, solo Quimibond hoy) | SAT |
| `regimen_fiscal`/`opinion_cumplimiento` | SAT (P3 fiscal; solo propio hoy) | SAT |
| `blacklist_level` | SAT agregado desde `syntage_invoices.*_blacklist_status` | SAT |
| `credit_limit`/`payment_term`/`supplier_payment_term` | Odoo (P3 operativo) | Odoo |
| `description`/`strategic_notes` | manual > Claude enrichment; enrichment NUNCA sobrescribe si `has_manual_override=true` (user decision: human edits lock) | Manual |
| `lifetime_value_mxn` etc. agregados | derivados de canonical_invoices (no writer directo) | derived |

**User decision firmada — Company shadow.** Cuando llega CFDI con `receptor_rfc` o `emisor_rfc` que no matchea `companies.rfc` ni `odoo_partner_id`, se **auto-crea** canonical_companies row con `has_shadow_flag=true`, `shadow_reason='sat_cfdi_only_post_2021'`, `match_method='sat_only'`, `needs_review=true`. UI surface un CTA "formalizar en Odoo". El shadow sigue siendo válido para agregar amounts; el flag permite filtrarlo del ERP-connected view.

**User decision firmada — Human edits lock.** Si `has_manual_override=true` en un row, Claude enrichment (`enriched_at` updates) NO sobrescribe campos de enrichment. Edits manual son "sticky" hasta que el usuario explícitamente los retire.

**Example row (CONTITECH MEXICANA — real data).**

```
id: 482
canonical_name: 'contitech mexicana'
display_name: 'CONTITECH MEXICANA'
rfc: 'CME990531HR4'
odoo_partner_id: 1265
primary_entity_kg_id: 318
primary_email_domain: 'contitech.com'
is_customer: true
is_supplier: false
is_internal: false
is_sat_counterparty: true
regimen_fiscal: NULL  -- only own Quimibond has this today
person_type: 'legal'
blacklist_level: 'none'
country: 'Mexico'
state: 'San Luis Potosí'
city: 'San Luis Potosi'
zip: NULL
street: NULL
domicilio_fiscal: NULL
industry: 'Automotive'
business_type: NULL
credit_limit: 10000000.00
payment_term: '30 días'
description: 'Fabricante de bandas transportadoras industriales. Cliente estratégico 4 años.'
strategic_notes: NULL
relationship_type: 'strategic'
key_products: [{"internal_ref":"WJ042Q22JNT160","share_pct":0.82}]
enriched_at: '2026-03-10 08:22:00+00'
enrichment_source: 'claude-extract-v1'
lifetime_value_mxn: 168314490.65
total_invoiced_odoo_mxn: 168314490.65
total_invoiced_sat_mxn: 168300012.10  -- slight diff by FX
revenue_ytd_mxn: 22500412.00
revenue_90d_mxn: 7612800.30
revenue_prior_90d_mxn: 6822100.00
trend_pct: 11.59
total_receivable_mxn: 5148830.48
total_payable_mxn: 0.00
ar_aging_buckets: {"current": 4122330.00, "1-30": 920000.00, "31-60": 106500.48, "61-90": 0, ">90": 0}
overdue_amount_mxn: 1026500.48
overdue_count: 3
max_days_overdue: 42
sat_compliance_score: 0.987
invoices_with_cfdi: 423
invoices_with_syntage_match: 417
sat_open_issues_count: 2
risk_level: 'low'
tier: 'A'
revenue_share_pct: 0.142
match_method: 'rfc_exact'
match_confidence: 1.000
has_manual_override: false
has_shadow_flag: false
needs_review: false
completeness_score: 0.82
last_matched_at: '2026-04-21 02:00:00+00'
```

### 5.6 `canonical_contacts` (Pattern C)

**Propósito.** Golden record por persona real (empleado, contacto cliente/proveedor, usuario sistema).

**Schema (campos clave).**

```sql
CREATE TABLE canonical_contacts (
  id bigserial PRIMARY KEY,
  -- Identity
  primary_email text NOT NULL,                              -- lowercased; UNIQUE
  display_name text NOT NULL,
  canonical_name text NOT NULL,                              -- lowercase
  -- Source ids
  odoo_partner_id integer,                                   -- res.partner individuo
  odoo_employee_id integer,                                  -- hr.employee
  odoo_user_id integer,                                      -- res.users
  primary_entity_kg_id bigint,
  -- Role
  contact_type text NOT NULL,                                -- 'internal_employee'|'internal_user'|'external_customer'|'external_supplier'|'external_unresolved'
  is_customer boolean NOT NULL DEFAULT false,
  is_supplier boolean NOT NULL DEFAULT false,
  -- Organization
  canonical_company_id bigint REFERENCES canonical_companies(id),  -- empresa donde trabaja
  role text,                                                 -- job_title (HR o Claude)
  department text,                                           -- HR
  manager_canonical_contact_id bigint REFERENCES canonical_contacts(id),
  -- Communication
  language_preference text,                                  -- 'es'|'en'
  communication_style text,                                   -- Claude (locked if has_manual_override)
  response_pattern text,
  decision_power text,
  negotiation_style text,
  influence_on_deals text,
  personality_notes text,
  -- Metrics (derived)
  relationship_score numeric(4,3),
  sentiment_score numeric(4,3),
  current_health_score numeric(4,3),
  health_trend text,                                          -- 'up'|'down'|'flat'
  risk_level text,
  payment_compliance_score numeric(4,3),
  lifetime_value_mxn numeric(14,2) DEFAULT 0,
  delivery_otd_rate numeric(5,4),
  total_sent integer DEFAULT 0,
  total_received integer DEFAULT 0,
  avg_response_time_hours numeric(8,2),
  last_activity_at timestamptz,
  first_seen_at timestamptz,
  open_alerts_count integer DEFAULT 0,
  pending_actions_count integer DEFAULT 0,
  -- MDM meta
  match_method text,
  match_confidence numeric(4,3),
  has_manual_override boolean DEFAULT false,                  -- user decision: locks AI enrichment
  has_shadow_flag boolean DEFAULT false,
  needs_review boolean DEFAULT false,
  review_reason text[],
  completeness_score numeric(4,3),
  last_matched_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX ON canonical_contacts (primary_email);
CREATE INDEX ON canonical_contacts (canonical_company_id);
CREATE INDEX ON canonical_contacts (contact_type);
CREATE INDEX ON canonical_contacts (odoo_employee_id) WHERE odoo_employee_id IS NOT NULL;
CREATE INDEX ON canonical_contacts (odoo_user_id) WHERE odoo_user_id IS NOT NULL;
CREATE INDEX ON canonical_contacts (has_manual_override) WHERE has_manual_override = true;
```

**Survivorship:**
- `primary_email`: Odoo authority (res.partner.email/res.users.login/hr.employee.work_email, preferring user over employee over partner if same person).
- `display_name`: Odoo.
- `role`/`department`/`manager`: HR (`odoo_employees`) si `contact_type` internal; Claude si external (pero lockable).
- `communication_style` etc. (Claude-generated): locked if `has_manual_override=true` (user decision firmada).

**Match methods.** (1) email exact (strongest); (2) odoo_employee_id link; (3) domain match to canonical_company + name similarity.

### 5.7 `canonical_products` (Pattern C)

```sql
CREATE TABLE canonical_products (
  id bigserial PRIMARY KEY,
  -- Identity
  internal_ref text NOT NULL,                                -- default_code Odoo — NEVER change
  display_name text NOT NULL,
  canonical_name text NOT NULL,
  -- Source ids
  odoo_product_id integer NOT NULL,                           -- 1-to-1 Odoo authority
  primary_entity_kg_id bigint,
  -- Classification
  category text,
  uom text,
  product_type text,                                          -- consu/service/product
  sat_clave_prod_serv text,                                   -- UNSPSC/SAT code
  sat_clave_unidad text,                                       -- SAT unit code
  barcode text,
  weight numeric(10,3),
  -- Pricing
  standard_price_mxn numeric(14,2),                           -- costo estándar Odoo
  avg_cost_mxn numeric(14,2),                                 -- moving avg Odoo
  list_price_mxn numeric(14,2),                               -- catalogue list Odoo
  last_list_price_change_at timestamptz,
  -- Stock
  stock_qty numeric(14,4),                                    -- on-hand Odoo
  reserved_qty numeric(14,4),
  available_qty numeric(14,4),
  reorder_min numeric(14,4),
  reorder_max numeric(14,4),
  -- Fiscal metrics (SAT-derived)
  sat_revenue_mxn_12m numeric(14,2) DEFAULT 0,
  sat_line_count_12m integer DEFAULT 0,
  last_sat_invoice_date date,
  -- Operational metrics (Odoo-derived)
  odoo_revenue_mxn_12m numeric(14,2) DEFAULT 0,
  margin_pct_12m numeric(8,4),
  top_customers_canonical_ids bigint[],
  top_suppliers_canonical_ids bigint[],
  is_active boolean DEFAULT true,
  -- MDM meta (fiscal map)
  fiscal_map_confidence text,                                 -- 'manual'|'inferred_frequent'|'none'
  fiscal_map_updated_at timestamptz,
  has_manual_override boolean DEFAULT false,
  needs_review boolean DEFAULT false,
  completeness_score numeric(4,3),
  last_matched_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX ON canonical_products (internal_ref);
CREATE UNIQUE INDEX ON canonical_products (odoo_product_id);
CREATE INDEX ON canonical_products (sat_clave_prod_serv);
CREATE INDEX ON canonical_products (category);
CREATE INDEX ON canonical_products (is_active) WHERE is_active = true;
```

**Survivorship key:**
- `internal_ref`: Odoo default_code (never change).
- `sat_clave_prod_serv`: `products_fiscal_map.sat_clave_prod_serv` si confidence='manual'; else most-frequent `syntage_invoice_line_items.clave_prod_serv` de los CFDIs Quimibond-emisor últimos 90d para ese odoo_product_id.
- `list_price_mxn`, `standard_price_mxn`: Odoo.
- `sat_revenue_mxn_12m`: derived.

**Invariante:** `clave_prodserv_drift` — si el more-frequent `clave_prod_serv` cambia mes a mes, flag posible reclasificación fiscal.

### 5.8 `canonical_employees` (Pattern C)

**Propósito.** Subset especializado de `canonical_contacts` donde `contact_type = 'internal_employee'`. Puede implementarse como **view materializada** filtrando canonical_contacts + joining HR data, o como tabla separada si performance lo justifica. Elegimos view para SP3 (derivada, simple).

```sql
CREATE VIEW canonical_employees AS
SELECT
  cc.id AS contact_id,
  cc.primary_email,
  cc.display_name,
  cc.canonical_name,
  cc.odoo_employee_id,
  cc.odoo_user_id,
  e.work_phone,
  e.job_title,
  e.job_name,
  e.department_name,
  e.department_id,
  cc.manager_canonical_contact_id,
  e.coach_name,
  e.is_active,
  -- Workload (odoo_users + odoo_activities)
  u.pending_activities_count,
  u.overdue_activities_count,
  u.activities_json,
  -- Assigned insights
  (SELECT COUNT(*) FROM agent_insights ai WHERE ai.assignee_user_id = cc.odoo_user_id AND ai.state IN ('new','seen')) AS open_insights_count,
  cc.created_at, cc.updated_at
FROM canonical_contacts cc
LEFT JOIN odoo_employees e ON e.odoo_employee_id = cc.odoo_employee_id
LEFT JOIN odoo_users u ON u.odoo_user_id = cc.odoo_user_id
WHERE cc.contact_type = 'internal_employee';
```

### 5.9 `canonical_sale_orders` (Pattern B)

```sql
CREATE MATERIALIZED VIEW canonical_sale_orders AS
SELECT
  so.id                             AS canonical_id,
  so.odoo_order_id,
  so.name,
  so.odoo_partner_id,
  cc.id                             AS canonical_company_id,
  so.salesperson_name,
  so.salesperson_user_id,
  cct.id                            AS salesperson_canonical_contact_id,
  so.team_name,
  so.amount_total,
  so.amount_untaxed,
  so.amount_total_mxn,
  so.amount_untaxed_mxn,
  so.margin, so.margin_percent,
  so.currency, so.state,
  so.date_order, so.commitment_date, so.create_date,
  so.odoo_company_id,
  -- Derived
  CASE
    WHEN so.state IN ('sale','done') AND so.commitment_date IS NOT NULL AND so.commitment_date < CURRENT_DATE
    THEN true ELSE false
  END AS is_commitment_overdue,
  now() AS refreshed_at
FROM odoo_sale_orders so
LEFT JOIN canonical_companies cc ON cc.odoo_partner_id = so.odoo_partner_id
LEFT JOIN canonical_contacts cct ON cct.odoo_user_id = so.salesperson_user_id;
CREATE UNIQUE INDEX ON canonical_sale_orders (canonical_id);
CREATE INDEX ON canonical_sale_orders (canonical_company_id);
CREATE INDEX ON canonical_sale_orders (salesperson_canonical_contact_id);
CREATE INDEX ON canonical_sale_orders (state, date_order DESC);
```

### 5.10 `canonical_purchase_orders` (Pattern B)

```sql
CREATE MATERIALIZED VIEW canonical_purchase_orders AS
SELECT
  po.id                             AS canonical_id,
  po.odoo_order_id, po.name,
  po.odoo_partner_id,
  cc.id                             AS canonical_company_id,
  po.buyer_name, po.buyer_email, po.buyer_user_id,
  cct.id                            AS buyer_canonical_contact_id,
  po.amount_total, po.amount_untaxed,
  po.amount_total_mxn, po.amount_untaxed_mxn,
  po.currency, po.state,
  po.date_order, po.date_approve, po.create_date,
  po.odoo_company_id,
  now() AS refreshed_at
FROM odoo_purchase_orders po
LEFT JOIN canonical_companies cc ON cc.odoo_partner_id = po.odoo_partner_id
LEFT JOIN canonical_contacts cct ON cct.odoo_user_id = po.buyer_user_id;
CREATE UNIQUE INDEX ON canonical_purchase_orders (canonical_id);
CREATE INDEX ON canonical_purchase_orders (canonical_company_id);
CREATE INDEX ON canonical_purchase_orders (buyer_canonical_contact_id);
```

### 5.11 `canonical_order_lines` (Pattern B)

```sql
CREATE MATERIALIZED VIEW canonical_order_lines AS
SELECT
  ol.id                             AS canonical_id,
  ol.odoo_line_id,
  ol.odoo_order_id,
  ol.order_type,                                             -- 'sale'|'purchase'
  ol.order_name, ol.order_state, ol.order_date,
  ol.odoo_partner_id,
  cc.id                             AS canonical_company_id,
  ol.odoo_product_id,
  cp.id                             AS canonical_product_id,
  ol.product_name, ol.product_ref,
  ol.qty, ol.qty_delivered, ol.qty_invoiced,
  ol.price_unit, ol.discount,
  ol.subtotal, ol.subtotal_mxn, ol.currency,
  ol.line_uom, ol.line_uom_id,
  ol.salesperson_name,                                       -- denormalized for sale order_type
  -- Derived
  (ol.qty - COALESCE(ol.qty_invoiced,0)) AS qty_pending_invoice,
  CASE
    WHEN ol.order_type='sale' AND ol.order_state IN ('sale','done')
      AND COALESCE(ol.qty_invoiced,0) < ol.qty
    THEN true ELSE false
  END AS has_pending_invoicing,
  now() AS refreshed_at
FROM odoo_order_lines ol
LEFT JOIN canonical_companies cc ON cc.odoo_partner_id = ol.odoo_partner_id
LEFT JOIN canonical_products cp ON cp.odoo_product_id = ol.odoo_product_id;
CREATE UNIQUE INDEX ON canonical_order_lines (canonical_id);
CREATE INDEX ON canonical_order_lines (canonical_company_id);
CREATE INDEX ON canonical_order_lines (canonical_product_id);
CREATE INDEX ON canonical_order_lines (order_type, order_state);
CREATE INDEX ON canonical_order_lines (has_pending_invoicing) WHERE has_pending_invoicing = true;
```

### 5.12 `canonical_deliveries` (Pattern B)

```sql
CREATE MATERIALIZED VIEW canonical_deliveries AS
SELECT
  d.id                              AS canonical_id,
  d.odoo_picking_id, d.name,
  d.odoo_partner_id,
  cc.id                             AS canonical_company_id,
  d.picking_type, d.picking_type_code,                       -- incoming/outgoing/internal
  d.origin,                                                   -- SO/PO ref
  d.scheduled_date, d.date_done, d.create_date,
  d.state, d.is_late, d.lead_time_days,
  d.odoo_company_id,
  now() AS refreshed_at
FROM odoo_deliveries d
LEFT JOIN canonical_companies cc ON cc.odoo_partner_id = d.odoo_partner_id;
CREATE UNIQUE INDEX ON canonical_deliveries (canonical_id);
CREATE INDEX ON canonical_deliveries (canonical_company_id);
CREATE INDEX ON canonical_deliveries (picking_type_code, state);
CREATE INDEX ON canonical_deliveries (scheduled_date);
CREATE INDEX ON canonical_deliveries (is_late) WHERE is_late = true;
```

### 5.13 `canonical_inventory` (Pattern B)

**Propósito.** Stock + orderpoints unificados. Una fila por (canonical_product_id, warehouse).

```sql
CREATE VIEW canonical_inventory AS
SELECT
  p.canonical_id                    AS canonical_product_id,
  p.internal_ref, p.display_name,
  p.stock_qty, p.reserved_qty, p.available_qty,
  p.reorder_min, p.reorder_max,
  op.odoo_orderpoint_id,
  op.warehouse_name, op.location_name,
  op.product_min_qty AS orderpoint_min,
  op.product_max_qty AS orderpoint_max,
  op.qty_to_order,
  op.qty_on_hand AS orderpoint_qty_on_hand,
  op.qty_forecast,
  op.trigger_type,
  CASE
    WHEN op.odoo_orderpoint_id IS NOT NULL
     AND op.product_min_qty = 0 AND op.qty_to_order > 0
    THEN true ELSE false
  END AS orderpoint_untuned,
  CASE WHEN p.available_qty <= 0 THEN true ELSE false END AS is_stockout,
  now() AS refreshed_at
FROM canonical_products p
LEFT JOIN odoo_orderpoints op ON op.odoo_product_id = p.odoo_product_id;
```

### 5.14 `canonical_manufacturing` (Pattern B)

```sql
CREATE MATERIALIZED VIEW canonical_manufacturing AS
SELECT
  m.id AS canonical_id,
  m.odoo_production_id, m.name,
  cp.id AS canonical_product_id,
  m.product_name, m.odoo_product_id,
  m.qty_planned, m.qty_produced,
  CASE WHEN m.qty_planned > 0 THEN ROUND(100.0*m.qty_produced/m.qty_planned, 2) END AS yield_pct,
  m.state, m.date_start, m.date_finished, m.create_date,
  EXTRACT(EPOCH FROM (m.date_finished - m.date_start))/86400 AS cycle_time_days,
  m.assigned_user, m.origin, m.odoo_company_id,
  now() AS refreshed_at
FROM odoo_manufacturing m
LEFT JOIN canonical_products cp ON cp.odoo_product_id = m.odoo_product_id;
CREATE UNIQUE INDEX ON canonical_manufacturing (canonical_id);
CREATE INDEX ON canonical_manufacturing (state);
CREATE INDEX ON canonical_manufacturing (canonical_product_id);
```

### 5.15 `canonical_bank_balances` (Pattern B)

```sql
CREATE VIEW canonical_bank_balances AS
SELECT
  bb.id                              AS canonical_id,
  bb.odoo_journal_id, bb.name,
  bb.journal_type, bb.currency, bb.bank_account,
  bb.current_balance,
  bb.current_balance_mxn,
  bb.odoo_company_id, bb.company_name,
  bb.updated_at,
  CASE WHEN now() - bb.updated_at > interval '48 hours' THEN true ELSE false END AS is_stale,
  CASE
    WHEN bb.journal_type = 'credit_card' OR bb.current_balance_mxn < 0 THEN 'debt'
    WHEN bb.journal_type IN ('bank','cash') AND bb.current_balance_mxn > 0 THEN 'cash'
    ELSE 'other'
  END AS classification,
  now() AS refreshed_at
FROM odoo_bank_balances bb;
```

### 5.16 `canonical_fx_rates` (Pattern B)

```sql
CREATE VIEW canonical_fx_rates AS
SELECT
  cr.id                             AS canonical_id,
  cr.currency, cr.rate, cr.inverse_rate,
  cr.rate_date, cr.odoo_company_id,
  cr.synced_at,
  CASE WHEN cr.rate_date < CURRENT_DATE - interval '3 days' THEN true ELSE false END AS is_stale,
  ROW_NUMBER() OVER (PARTITION BY cr.currency ORDER BY cr.rate_date DESC) AS recency_rank
FROM odoo_currency_rates cr;
```

**Derived function.**
```sql
CREATE OR REPLACE FUNCTION usd_to_mxn(p_date date DEFAULT CURRENT_DATE) RETURNS numeric(18,6)
LANGUAGE sql STABLE AS $$
  SELECT rate FROM canonical_fx_rates
  WHERE currency='USD' AND rate_date <= p_date
  ORDER BY rate_date DESC LIMIT 1;
$$;
```

### 5.17 `canonical_account_balances` (Pattern B)

```sql
CREATE VIEW canonical_account_balances AS
SELECT
  ab.id                             AS canonical_id,
  ab.odoo_account_id,
  ab.account_code, ab.account_name,
  coa.account_type,
  ab.period,
  ab.debit, ab.credit, ab.balance,
  coa.deprecated,
  ab.synced_at,
  CASE
    WHEN coa.account_type LIKE 'asset_%' THEN 'asset'
    WHEN coa.account_type LIKE 'liability_%' THEN 'liability'
    WHEN coa.account_type LIKE 'equity%' THEN 'equity'
    WHEN coa.account_type LIKE 'income%' THEN 'income'
    WHEN coa.account_type LIKE 'expense%' THEN 'expense'
    ELSE 'other'
  END AS balance_sheet_bucket,
  now() AS refreshed_at
FROM odoo_account_balances ab
LEFT JOIN odoo_chart_of_accounts coa ON coa.odoo_account_id = ab.odoo_account_id;
```

### 5.18 `canonical_chart_of_accounts` (Pattern B)

```sql
CREATE VIEW canonical_chart_of_accounts AS
SELECT
  coa.id                             AS canonical_id,
  coa.odoo_account_id,
  coa.code, coa.name,
  coa.account_type,
  coa.reconcile, coa.deprecated, coa.active,
  coa.odoo_company_id,
  -- Tree level (by code prefix "101", "101-01", ...)
  LENGTH(coa.code) - LENGTH(REPLACE(coa.code,'-','')) + 1 AS tree_level,
  SPLIT_PART(coa.code, '-', 1) AS level_1_code,
  coa.synced_at
FROM odoo_chart_of_accounts coa;
```

### 5.19 `canonical_crm_leads` (Pattern B)

```sql
CREATE VIEW canonical_crm_leads AS
SELECT
  l.id                              AS canonical_id,
  l.odoo_lead_id, l.name,
  cc.id                             AS canonical_company_id,
  l.odoo_partner_id, l.lead_type, l.stage,
  l.expected_revenue, l.probability,
  l.date_deadline, l.create_date, l.days_open,
  l.assigned_user,
  cct.id                            AS assignee_canonical_contact_id,
  l.active, l.synced_at
FROM odoo_crm_leads l
LEFT JOIN canonical_companies cc ON cc.odoo_partner_id = l.odoo_partner_id
LEFT JOIN canonical_contacts cct ON cct.display_name = l.assigned_user;   -- weak; for post-SP3 refinement
```

---

## 6. `source_links` table (MDM)

**Propósito.** Capa transversal que **trazabiliza** cómo cada canonical entity fue resuelta desde sus sources. Una fila por link {source, source_id, canonical_entity}. Múltiples rows por canonical entity (multi-source).

### 6.1 Schema

```sql
CREATE TABLE source_links (
  id bigserial PRIMARY KEY,
  canonical_entity_type text NOT NULL,                      -- 'company'|'contact'|'product'|'invoice'|'payment'|'credit_note'|'tax_event'
  canonical_entity_id text NOT NULL,                        -- bigint as text (PK of canonical_*) OR canonical_id (invoices/payments)
  source text NOT NULL,                                      -- 'odoo'|'sat'|'gmail'|'kg_entity'|'manual'
  source_table text NOT NULL,                                -- 'odoo_invoices'|'syntage_invoices'|'entities'|'emails'|...
  source_id text NOT NULL,                                   -- PK as text in source table
  source_natural_key text,                                   -- rfc/uuid/email/internal_ref — facilitates queries
  match_method text NOT NULL,                                -- 'rfc_exact'|'odoo_partner_id'|'uuid_exact'|'domain_match'|'name_fuzzy'|'manual_override'|'composite_rfc_total_date'
  match_confidence numeric(4,3) NOT NULL,                    -- 0.00-1.00
  matched_at timestamptz NOT NULL DEFAULT now(),
  matched_by text,                                            -- 'system'|'user:<email>'|'matcher_v1.2'
  superseded_at timestamptz,                                  -- NULL = active; si deprecated por rematching, se marca
  notes text
);
CREATE INDEX ON source_links (canonical_entity_type, canonical_entity_id);
CREATE INDEX ON source_links (source, source_id) WHERE superseded_at IS NULL;
CREATE UNIQUE INDEX ON source_links (canonical_entity_type, source, source_id) WHERE superseded_at IS NULL;
```

### 6.2 Match methods (catalog)

| Method | Entity types | Strength | Example |
|---|---|---|---|
| `manual_override` | all | 1.000 | user explicitly linked A→B via UI |
| `uuid_exact` | invoice, credit_note, payment | 1.000 | sat_uuid == odoo_invoices.cfdi_uuid |
| `rfc_exact` | company | 0.99 | canonical_companies.rfc == syntage_invoices.receptor_rfc |
| `odoo_partner_id` | company, contact | 0.99 | direct FK from Bronze |
| `email_exact` | contact | 0.99 | lowercased + trimmed exact match |
| `internal_ref_exact` | product | 1.000 | canonical_products.internal_ref == odoo_products.default_code |
| `composite_rfc_total_date` | invoice | 0.80 | rfc+amount±$0.01+date±3d match |
| `num_operacion_exact` | payment | 0.85 | SAT complemento num_operacion == odoo payment ref |
| `composite_company_date_amount` | payment | 0.70 | company+date±1d+amount±$0.50 |
| `domain_match` | company, contact | 0.70 | email domain → canonical_company.primary_email_domain |
| `name_fuzzy` | company, contact, product | 0.60-0.85 | pg_trgm similarity ≥ threshold |
| `sat_only` | company (shadow) | 0.50 | RFC aparece en CFDI pero no en Odoo → shadow record |
| `kg_mention` | all | 0.40 | entities.canonical_name mentioned ≥ N times |

### 6.3 Confidence scoring

- **≥ 0.95**: canonical, no warning.
- **0.80-0.94**: auto-linked pero visible en `gold_ceo_inbox` si el row tiene otro review_reason.
- **0.60-0.79**: auto-linked pero `needs_review=true` en canonical entity.
- **< 0.60**: **NO** auto-linked. Queda en una queue `mdm_candidate_matches` para revisión humana.

### 6.4 Manual override flow + soft-expire policy

**Flow de override.**
1. Usuario ve en UI dos entities que deberían ser uno (o el inverso).
2. Llama a función `mdm_merge_companies(canonical_a_id, canonical_b_id, note)` o `mdm_link_invoice(canonical_id, sat_uuid, odoo_invoice_id, note)`.
3. Función:
   - Inserta row en `source_links` con `match_method='manual_override'`, `match_confidence=1.000`.
   - Marca rows anteriores con `superseded_at = now()` (no borra — auditoría).
   - Setea `has_manual_override=true` en canonical entity.
   - Opcionalmente cierra issues relacionados con `resolution='manual_merge by <user>'`.

**Soft-expire (user decision firmada).** Un manual override NO se invalida cuando la data upstream cambia, pero SÍ se marca `needs_review=true` + `review_reason=['underlying_data_changed']` cuando cambia cualquier campo de `source_hashes` relevante. El humano revisa y decide: mantener (sin acción) o retirar override (function `mdm_revoke_override(id)`).

Tabla de overrides unificada (reemplaza `invoice_bridge_manual`, `payment_bridge_manual`, `products_fiscal_map` con keep-rows migration):

```sql
CREATE TABLE mdm_manual_overrides (
  id bigserial PRIMARY KEY,
  entity_type text NOT NULL,                                -- 'invoice'|'payment'|'product_fiscal_map'|'company'|'contact'|'credit_note'
  action text NOT NULL,                                      -- 'link'|'unlink'|'merge'|'split'|'assign_attribute'
  canonical_entity_id text,
  source_link_id bigint REFERENCES source_links(id),
  payload jsonb NOT NULL,                                    -- details por action
  linked_by text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,                                    -- NULL = nunca expira (per user decision)
  is_active boolean NOT NULL DEFAULT true,
  revoke_reason text,
  note text
);
CREATE INDEX ON mdm_manual_overrides (entity_type, canonical_entity_id);
CREATE INDEX ON mdm_manual_overrides (is_active) WHERE is_active = true;
```

**Migración de tablas existentes a `mdm_manual_overrides`** ocurre en SP3 (§11) con script idempotente.

---

## 7. MDM Matcher service

### 7.1 Deterministic rules (por entity type)

**Company.**
1. Si `companies.odoo_partner_id` existe → directo a canonical_companies.odoo_partner_id.
2. Si `syntage_invoices.receptor_rfc / emisor_rfc` matchea `companies.rfc` (case-insensitive, LTRIM) → link `rfc_exact`.
3. Si RFC no matchea `companies` pero el nombre sí (pg_trgm ≥ 0.85) → link `name_fuzzy` + `needs_review=true`.
4. Si RFC genérico XEXX010101000/XAXX010101000 → matching por `emisor_nombre`/`receptor_nombre` (fuzzy contra companies.name) con threshold 0.90.
5. Si no hay match → crear shadow (user decision firmada) con `has_shadow_flag=true`, `match_method='sat_only'`, `match_confidence=0.50`.

**Contact.**
1. `emails.sender` lowercased → buscar `odoo_users.email`, si match → `contact_type='internal_user'`, `match_method='email_exact'`.
2. Si no, buscar `odoo_employees.work_email` → `contact_type='internal_employee'`, `match_method='email_exact'`.
3. Si no, buscar `contacts.email` → `contact_type='external_*'` según commercial_partner is_customer/is_supplier.
4. Si no, crear `contact_type='external_unresolved'` + resolver canonical_company_id por domain match.

**Product.** `odoo_products.default_code` (internal_ref) → directo. Los 0 entity KG product links se ignoran en SP3 (low priority).

**Invoice/Payment/CreditNote.** Ver reglas de matching en §5.1-§5.3 (UUID exact > composite > manual).

### 7.2 Probabilistic fallback

- **pg_trgm** (trigram similarity) para nombres: threshold 0.85 auto, 0.70-0.85 review, <0.70 no action.
- **Domain match** para emails/companies: extract domain de primary_email de contacts, link al canonical_company con mayor `email_count` asociado.
- **Composite invoices** (spec 07 function `match_unlinked_invoices_by_composite`): rfc + amount±$0.01 + date±3d.

### 7.3 Shadow creation policy

Ya cubierta: SAT-only counterparty → auto-create canonical_companies con `has_shadow_flag=true`. Dispara notificación al operador cuando `blacklist_level != 'none'` + `has_shadow_flag=true` (compliance risk sobre una empresa que no está en Odoo).

### 7.4 Conflict resolution workflow

Cuando matcher detecta row "ambiguo" (e.g., 2 odoo_partner_id candidates para mismo RFC):
1. Crear row en `mdm_candidate_matches` (staging).
2. `canonical_*.needs_review=true` + review_reason `['ambiguous_match']`.
3. CEO Inbox surface it.
4. Usuario resuelve via UI: pick one, merge both, or mark as not-same.

### 7.5 Matcher invocation

- **On insert en Bronze** (trigger en `syntage_invoices` INSERT): dispara `matcher_invoice_quick(NEW.uuid)` + `matcher_company_if_new_rfc(NEW.emisor_rfc, NEW.receptor_rfc)`.
- **Scheduled refresh** (pg_cron cada 2h): full `matcher_all_pending()` — procesa rows con `needs_review=true OR last_matched_at < now() - 2h`.
- **Manual**: `POST /api/mdm/rematch?entity_type=invoice&id=xxx` — admin-only endpoint.

---

## 8. Evidence layer

### 8.1 `email_signals`

```sql
CREATE TABLE email_signals (
  id bigserial PRIMARY KEY,
  canonical_entity_type text NOT NULL,
  canonical_entity_id text NOT NULL,
  signal_type text NOT NULL,                                -- 'mentioned'|'responded'|'cfdi_attached'|'complaint_in_subject'|...
  email_id bigint NOT NULL,                                  -- FK a emails.id
  thread_id bigint,
  signal_value text,
  confidence numeric(4,3),
  extracted_at timestamptz DEFAULT now(),
  expires_at timestamptz
);
CREATE INDEX ON email_signals (canonical_entity_type, canonical_entity_id);
CREATE INDEX ON email_signals (email_id);
CREATE INDEX ON email_signals (signal_type);
```

### 8.2 `ai_extracted_facts` (sucesor de `facts`)

```sql
CREATE TABLE ai_extracted_facts (
  id bigserial PRIMARY KEY,
  canonical_entity_type text NOT NULL,                      -- generalmente 'company' o 'contact'
  canonical_entity_id text NOT NULL,
  fact_type text NOT NULL,                                   -- 'commitment'|'complaint'|'price'|'request'|'information'|'change'|...
  fact_text text NOT NULL,
  fact_hash text,                                            -- for dedup
  fact_date timestamptz,                                      -- when the fact is about
  confidence numeric(4,3) NOT NULL,
  source_type text NOT NULL,                                 -- 'email'|'document'|...
  source_account text,                                        -- gmail account
  source_ref text,                                            -- email_id/message_id
  extraction_run_id text,
  verified boolean DEFAULT false,                             -- manual verification
  verification_source text,
  verified_at timestamptz,
  is_future boolean DEFAULT false,
  expired boolean DEFAULT false,
  superseded_by bigint REFERENCES ai_extracted_facts(id),    -- when a newer contradictory fact appears
  extracted_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX ON ai_extracted_facts (canonical_entity_type, canonical_entity_id);
CREATE INDEX ON ai_extracted_facts (fact_type);
CREATE UNIQUE INDEX ON ai_extracted_facts (fact_hash) WHERE fact_hash IS NOT NULL;
```

**Migración from `facts`**: script en SP4 que copia con mapping `entity_id → canonical_entity_id` por via `source_links`.

### 8.3 `attachments`

```sql
CREATE TABLE attachments (
  id bigserial PRIMARY KEY,
  canonical_entity_type text NOT NULL,                      -- 'invoice'|'payment'|'company'|...
  canonical_entity_id text NOT NULL,
  attachment_type text NOT NULL,                             -- 'cfdi_xml'|'cfdi_pdf'|'quotation_pdf'|'image'|'other'
  storage_path text,                                          -- bucket path in Supabase Storage
  syntage_file_id bigint,                                    -- FK a syntage_files si aplica
  email_id bigint,                                           -- if sourced from email
  filename text,
  mime_type text,
  size_bytes bigint,
  metadata jsonb,                                             -- CFDI UUID, hash, etc.
  uploaded_by text,                                           -- 'system_sat_pull'|'system_gmail'|'user:<email>'
  created_at timestamptz DEFAULT now()
);
CREATE INDEX ON attachments (canonical_entity_type, canonical_entity_id);
CREATE INDEX ON attachments (syntage_file_id) WHERE syntage_file_id IS NOT NULL;
```

### 8.4 `manual_notes`

```sql
CREATE TABLE manual_notes (
  id bigserial PRIMARY KEY,
  canonical_entity_type text NOT NULL,
  canonical_entity_id text NOT NULL,
  note_type text DEFAULT 'general',                          -- 'general'|'compliance'|'commitment'|'complaint_response'
  body text NOT NULL,
  created_by text NOT NULL,                                   -- user email
  pinned boolean DEFAULT false,                                -- surface in UI
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX ON manual_notes (canonical_entity_type, canonical_entity_id);
CREATE INDEX ON manual_notes (pinned) WHERE pinned = true;
```

### 8.5 Linking rules

- Todas las evidence tables usan el mismo (canonical_entity_type, canonical_entity_id) polymorphic FK pattern.
- Index compuesto obligatorio en cada una.
- `confidence` presente cuando viene de IA.
- `verified=true` requiere `verification_source` + `verified_at`.
- Purge policy: email_signals >180d sin referencia activa → archive; ai_extracted_facts sigue las reglas de expired/superseded (nunca delete físico).

---

## 9. Reconciliation engine

### 9.1 Extensión de `audit_tolerances` + `reconciliation_issues`

**Extender `audit_tolerances`.**
```sql
ALTER TABLE audit_tolerances ADD COLUMN IF NOT EXISTS severity_default text DEFAULT 'medium';  -- 'low'|'medium'|'high'|'critical'
ALTER TABLE audit_tolerances ADD COLUMN IF NOT EXISTS entity text;                              -- 'invoice'|'payment'|...
ALTER TABLE audit_tolerances ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true;
ALTER TABLE audit_tolerances ADD COLUMN IF NOT EXISTS auto_resolve boolean DEFAULT false;
ALTER TABLE audit_tolerances ADD COLUMN IF NOT EXISTS check_cadence text DEFAULT 'hourly';      -- 'hourly'|'2h'|'daily'|'on_insert'
```

**Extender `reconciliation_issues`.**
```sql
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS canonical_entity_type text;
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS canonical_entity_id text;
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS impact_mxn numeric(14,2);
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS age_days integer
  GENERATED ALWAYS AS (EXTRACT(DAY FROM now() - detected_at)::integer) STORED;
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS priority_score numeric(10,4);        -- computed (§9.5)
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS assignee_canonical_contact_id bigint;
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS action_cta text;                      -- 'operationalize'|'confirm_cancel'|'link_manual'|...
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS invariant_key text;                  -- FK audit_tolerances
```

### 9.2 Invariant catalog

Listado de invariantes (reglas de reconciliación) que el engine ejecuta. Cada una se registra en `audit_tolerances` + SQL declarativo en `audit_invariants.md` file. **Total: 31 activas** (10 invoice + 6 payment + 4 tax + 5 fulfillment + 6 finance + 3 line-level + 2 inventory + 2 MDM, menos 7 solapamientos entre buckets); arquitectura soporta expansión a ~50 sin cambios estructurales.

#### Invoice invariants (10)
| key | entity | severity | tolerance | auto_resolve | descripción |
|---|---|---|---|---|---|
| `invoice.amount_mismatch` | invoice | high | 0.50 MXN / 0.50% | yes when closes | amount_total_odoo vs amount_total_sat fuera de tolerancia (ignora FX legit drift) |
| `invoice.amount_diff_post_fx` | invoice | medium | 1.00% | no | diff persiste tras aplicar tipo_cambio SAT → diff real, no FX |
| `invoice.state_mismatch_posted_cancelled` | invoice | high | — | yes | Odoo posted + SAT cancelado → auto-cancel Odoo cuando SAT firma cancelación |
| `invoice.state_mismatch_cancel_vigente` | invoice | critical | — | no | Odoo cancel + SAT vigente → escalar humano |
| `invoice.date_drift` | invoice | medium | 3 días | no | |invoice_date − fecha_emision| > 3d |
| `invoice.pending_operationalization` | invoice | medium | — | yes when Odoo arrives | CFDI post-2021 sin Odoo match |
| `invoice.missing_sat_timbrado` | invoice | medium | 7 días | yes when SAT arrives | Odoo posted pero sin CFDI SAT > 7d |
| `invoice.posted_without_uuid` | invoice | critical | — | no (blocks on addon fix) | 13,775 rows post-cleanup — parent-of bug |
| `invoice.credit_note_orphan` | credit_note | medium | — | no | Egreso SAT sin related_invoice_canonical_id |
| `invoice.uuid_mismatch_rfc` | invoice | critical | — | no | UUID match pero emisor_rfc o receptor_rfc difieren — integridad comprometida |

#### Payment invariants (6)
| key | entity | severity | tolerance | auto_resolve | descripción |
|---|---|---|---|---|---|
| `payment.registered_without_complement` | payment | high | 30 días | yes when complemento arrives | Odoo paid PPD sin complemento P >30d |
| `payment.complement_without_payment` | payment | high | 30 días | yes | Complemento SAT sin Odoo match |
| `payment.amount_mismatch` | payment | high | 0.01 MXN | yes when closes | monto Odoo vs monto SAT |
| `payment.date_mismatch` | payment | low | 1 día | yes | |date Odoo − fecha_pago| > 1d |
| `payment.allocation_over` | payment | medium | — | no | sum(allocated_amount) > amount_resolved |
| `payment.allocation_under` | payment | low | — | yes | sum(allocated_amount) < amount_resolved en PPD activo |

#### Tax invariants (4)
| key | entity | severity | tolerance | auto_resolve | descripción |
|---|---|---|---|---|---|
| `tax.retention_accounting_drift` | tax_event | medium | 1.00 MXN / 0.05% | no | SUM(retention monto_total_retenido) mensual ≠ balance Odoo ISR retenido |
| `tax.return_payment_missing` | tax_event | high | — | yes | `syntage_tax_returns.monto_pagado > 0` sin `account.payment` matching en Odoo ±1d |
| `tax.accounting_sat_drift` | tax_event | medium | 1.00 MXN / 0.05% | no | odoo_account_balances ≠ syntage_electronic_accounting balanza mensual por cuenta |
| `tax.blacklist_69b_definitive_active` | company | critical | — | no | counterparty con blacklist_level='definitive' y CFDI post-flag fecha → hard block new PO |

#### Order/Invoice/Delivery fulfillment (5)
| key | entity | severity | tolerance | auto_resolve | descripción |
|---|---|---|---|---|---|
| `order.orphan_invoicing` | order_line | medium | — | yes | SO line sale/done con qty > qty_invoiced (aging >30d) |
| `order.orphan_delivery` | order_line | medium | — | yes | SO line sale/done con qty > qty_delivered (aging >14d) |
| `invoice.without_order` | invoice | low | — | no | Factura posted cuyo `ref`/`origin` no matchea ningún SO/PO name |
| `delivery.late_active` | delivery | medium | — | yes when done | is_late AND state NOT IN ('done','cancel') |
| `mfg.stock_drift` | manufacturing | medium | — | no | qty_produced cerrado sin reflejo en stock_qty |

#### Finance invariants (6)
| key | entity | severity | tolerance | auto_resolve | descripción |
|---|---|---|---|---|---|
| `account_balances.cogs_accounts_balance` | account_balance | medium | 1.00 MXN / 0.05% | no | existing (audit_tolerances) |
| `account_balances.inventory_accounts_balance` | account_balance | medium | 1.00 MXN / 0.05% | no | existing |
| `account_balances.revenue_accounts_balance` | account_balance | medium | 1.00 MXN / 0.05% | no | existing |
| `bank_balances.native_balance_per_journal` | bank_balance | high | 0.05 MXN / 0.01% | no | existing |
| `bank_balance.stale` | bank_balance | medium | 48h | yes when fresh | updated_at > 48h |
| `fx_rate.stale` | fx_rate | high | 3d | yes when refreshed | MAX(rate_date) < today-3d |

#### Line-level invariants (3)
| key | entity | severity | tolerance | auto_resolve | descripción |
|---|---|---|---|---|---|
| `invoice_lines.sum_subtotal_signed_mxn` | invoice_line | medium | 0.50 MXN / 0.50% | no | existing |
| `order_lines.sum_subtotal_mxn` | order_line | medium | 0.50 MXN / 0.50% | no | existing |
| `line_price_mismatch` | invoice_line | medium | 0.50% | no | odoo_invoice_lines.price_unit vs syntage_invoice_line_items.valor_unitario por línea |

#### Inventory invariants (2)
| key | entity | severity | tolerance | auto_resolve | descripción |
|---|---|---|---|---|---|
| `orderpoint_untuned` | inventory | low | — | no | orderpoint.min=0 + qty_to_order>0 |
| `clave_prodserv_drift` | product | low | — | no | most-freq claveProdServ cambia month-over-month |

#### MDM invariants (2)
| key | entity | severity | tolerance | auto_resolve | descripción |
|---|---|---|---|---|---|
| `entity_unresolved_30d` | company/contact/product | low | 30d | yes when linked | entity KG con mention_count>3 sin canonical link tras 30d |
| `ambiguous_match` | any | high | — | no | matcher found 2+ candidates for same source row |

### 9.3 Severity + $ impact + age weighting

**Priority score formula** (stored in `reconciliation_issues.priority_score`):
```
priority_score =
  severity_weight × log10(impact_mxn + 1) × age_weight × blocker_weight

severity_weight = {critical: 10, high: 5, medium: 2, low: 1}
age_weight      = min(1.0 + (age_days / 30), 3.0)      -- caps at 3x after 60d
blocker_weight  = action_cta IS NOT NULL ? 1.5 : 1.0   -- actionable issues get boost
```

`impact_mxn` derivation per invariant_key:
- `invoice.amount_mismatch`: `amount_total_mxn_diff_abs`
- `payment.complement_without_payment`: `amount_mxn_resolved`
- `invoice.pending_operationalization`: `amount_total_mxn_resolved` (para "qué tan grande es lo no-operacionalizado")
- `tax.blacklist_69b_definitive_active`: `SUM canonical_invoices.amount_total_mxn_resolved WHERE counterparty_canonical_company_id = X` (IVA at risk)
- `fx_rate.stale`: 0 (not $-scaled) — pero severity=high sube aun sin impact.

### 9.4 Auto-resolution rules vs manual queue

**Auto-resolve triggered:**
- invariante's `auto_resolve=true` AND
- current check returns no row (issue condition disappeared), THEN
- UPDATE reconciliation_issues SET resolved_at=now(), resolution='auto' WHERE issue_id=...

**Manual queue:**
- Todos los issues con `resolved_at IS NULL` ordenados por priority_score DESC → CEO Inbox.
- Claude enrichment de issue row: suggested_action text, suggested_sql text (para ops comunes).

### 9.5 CEO Inbox query interface

```sql
CREATE OR REPLACE VIEW gold_ceo_inbox AS
SELECT
  ri.issue_id,
  ri.issue_type,
  ri.invariant_key,
  ri.severity,
  ri.priority_score,
  ri.impact_mxn,
  ri.age_days,
  ri.description,
  ri.canonical_entity_type,
  ri.canonical_entity_id,
  ri.action_cta,
  ri.assignee_canonical_contact_id,
  cct.display_name AS assignee_name,
  ri.metadata,
  ri.detected_at
FROM reconciliation_issues ri
LEFT JOIN canonical_contacts cct ON cct.id = ri.assignee_canonical_contact_id
WHERE ri.resolved_at IS NULL
ORDER BY ri.priority_score DESC
LIMIT 50;
```

**API contract.** `/api/inbox/top` returns 50 items; `/api/inbox/resolve` accepts (issue_id, resolution, note) and closes.

---

## 10. Refresh strategy

### 10.1 Bronze ingest triggers

- Odoo push (qb19 hourly) → upsert into `odoo_*` tables con `synced_at = now()`. Trigger `mdm_matcher_quick` en filas INSERT/UPDATE de odoo_partner-derived tables encola en `unified_refresh_queue`.
- Syntage webhook (real-time) → `syntage_*`. Trigger `mdm_matcher_quick` + `canonical_invoices_upsert` (si existe row).
- Gmail pipeline (30 min) → `emails`, `threads`. Evidence linker encola.

### 10.2 Silver refresh

**Pattern A canonical tables (invoices, payments, credit_notes, tax_events)**: table materialized with **incremental triggers** (INSERT/UPDATE on Bronze → upsert single row canonical) + nightly full recomputation to catch missed events.

**Pattern B canonical MVs**: `REFRESH MATERIALIZED VIEW CONCURRENTLY` via cron cada 2h (lineup con existing `refresh_all_matviews`). Views non-MV (e.g., canonical_bank_balances, canonical_fx_rates) son live-query directas.

**Pattern C canonical tables**: upsert vía matcher service (§7.5). Full rematch cada 2h.

**MV concurrency guard**: `unified_refresh_queue` table (ya existe) coordina debouncing de refreshes múltiples.

### 10.3 Reconciliation engine cadence

| Cadence | Invariants | Trigger |
|---|---|---|
| `on_insert` | `invoice.uuid_mismatch_rfc`, `tax.blacklist_69b_definitive_active` | trigger on syntage_invoices INSERT |
| `hourly` | critical + high severity | pg_cron |
| `2h` | medium | pg_cron (align with Silver refresh) |
| `daily` | low + `entity_unresolved_30d`, `clave_prodserv_drift` | pg_cron 06:30 |

### 10.4 Change detection via source_hashes

- Canonical row's `source_hashes jsonb` stores {odoo_write_date, sat_synced_at, email_last_activity_at}.
- Trigger on Bronze update: if `NEW.write_date <> stored_odoo_write_date`, mark canonical row `needs_refresh=true`.
- Refresh runner picks up rows con `needs_refresh=true` primero.

### 10.5 Re-ingested webhook duplicates

- Bronze unique constraint (source_id, external_id) + ON CONFLICT UPDATE ensures idempotency.
- Canonical upsert uses `canonical_id` PK — same row updated.
- `updated_at` bumped; `source_hashes` updated.

---

## 11. Migration plan (5 sub-projects)

**Approach: Parallel rebuild con frontend preserved weeks 2-5** (user decision D2=A firmada). Bronze sigue corriendo durante toda la migración. Silver se construye al lado. Cutover via feature flags en SP5.

### SP1 (Week 1): Design + Audit + Prune

**Objetivo.** Remover backlog decorativo antes de construir. Cualquier view/MV/page sin caller o con duplicado claro se elimina ahora.

**Deliverables.**
1. Explicit drop list ejecutada (ver §12) — DROP VIEW/MV/TABLE/COLUMN.
2. `schema_changes` entries por cada DROP.
3. Frontend grep audit por callers; callers borrados/migrados a base view antes de DROP.
4. Baseline `audit_runs` con métrica `pre_silver_baseline`: #views, #MVs, #open_issues, #entity_unresolved.

**DoD.**
- [ ] Drop list ejecutada 100% (§12).
- [ ] 0 callers frontend/agent a view dropeada (rg verification).
- [ ] Baseline documentado en `docs/superpowers/plans/2026-04-21-sp1-prune-notes.md`.

**Dependencies.** None.
**Risks.** Algún caller oculto rompe prod. Mitigación: gated drops con `CREATE OR REPLACE VIEW` fallback antes de DROP final + 24h monitoring.
**Duration.** 3-5 días.

### SP2 (Weeks 2-3): Cat A Reconciliation Core

**Objetivo.** Construir las 4 canonical tables dual-source + primeros 10 invariantes activos.

**Deliverables.**
1. `canonical_invoices` (table materialized + triggers upsert desde odoo_invoices + syntage_invoices).
2. `canonical_payments` + `canonical_payment_allocations`.
3. `canonical_credit_notes`.
4. `canonical_tax_events`.
5. Migration script: copiar existing `invoice_bridge_manual`, `payment_bridge_manual`, `products_fiscal_map` → `mdm_manual_overrides` (idempotent).
6. Invariants registrados en `audit_tolerances` para los 10 primeros (invoice.* y payment.* prioritarios).
7. `reconciliation_issues` ALTER TABLE para new columns (§9.1).
8. Runner function `run_reconciliation(key text DEFAULT NULL)`.
9. pg_cron jobs for hourly/2h cadence.

**DoD.**
- [ ] `canonical_invoices.count(*) ≥ 97,000` (post-historical_pre_odoo filter).
- [ ] Every row con `has_odoo_record=true` tiene FK resolvable.
- [ ] Invariants run end-to-end con >0 auto-resolutions en first 24h.
- [ ] `reconciliation_issues.priority_score` populado.

**Dependencies.** SP1 done. Addon _build_cfdi_map fix (§14) opcional but strongly preferred — sin él, 13,775 rows con UUID NULL contaminan invariantes.
**Risks.** invoices_unified MV (258MB) → canonical_invoices table con triggers: write amplification. Mitigación: batch incremental triggers + fallback full nightly rebuild.
**Duration.** 10-12 días.

### SP3 (Weeks 3-4): Cat C MDM

**Objetivo.** Golden records para company, contact, product, employee + matcher service + source_links.

**Deliverables.**
1. `canonical_companies` table poblada desde companies + syntage_taxpayers + entities (para shadows).
2. `canonical_contacts` table poblada desde contacts + odoo_employees + odoo_users + entities.
3. `canonical_products` table poblada desde odoo_products + products_fiscal_map + syntage aggregate.
4. `canonical_employees` view sobre canonical_contacts + hr data.
5. `source_links` table populated via matcher.
6. `mdm_manual_overrides` table populated via migration (SP2 already started).
7. Matcher functions: `matcher_company`, `matcher_contact`, `matcher_product`, `matcher_all_pending`.
8. FKs de canonical_invoices/payments/orders actualizados a canonical_companies/contacts/products (back-fill).

**DoD.**
- [ ] `canonical_companies.count ≥ 2,200` (Odoo 2,195 + shadows).
- [ ] `canonical_contacts.primary_email` UNIQUE with 0 conflicts.
- [ ] `source_links.count > 10,000` (links generados).
- [ ] 0 rows `canonical_invoices WHERE receptor_canonical_company_id IS NULL AND has_sat_record=true AND emisor_canonical_company_id IS NOT NULL` (all counterparties resolved — else shadow created).
- [ ] Match confidence distribution documented.

**Dependencies.** SP2 canonical_invoices/payments (para FK back-fill).
**Risks.** pg_trgm fuzzy match para 2,803 person entities tarda y tiene false positives. Mitigación: threshold 0.85 auto + queue de 0.70-0.85 para review.
**Duration.** 10-12 días. Puede solaparse con end of SP2.

### SP4 (Weeks 4-5): Cat B + D + Engine

**Objetivo.** Completar todas las canonical tables (Pattern B), evidence layer (Pattern D), reconciliation engine full cutover, CEO Inbox backend.

**Deliverables.**
1. 11 Pattern B canonical_* views/MVs (orders, order_lines, deliveries, inventory, manufacturing, bank_balances, fx_rates, account_balances, chart_of_accounts, crm_leads).
2. `canonical_purchase_orders`, `canonical_sale_orders` replace order_unified.
3. Evidence tables: `email_signals`, `ai_extracted_facts`, `attachments`, `manual_notes`.
4. Migration script: `facts` → `ai_extracted_facts` (preserve ids, extend schema).
5. Full 31 invariantes registered; all auto-resolve jobs running.
6. `gold_ceo_inbox` view + API endpoints `/api/inbox/top`, `/api/inbox/resolve`.
7. `gold_company_360`, `gold_revenue_monthly`, `gold_pl_statement`, `gold_balance_sheet`, `gold_cashflow`, `gold_product_performance`, `gold_reconciliation_health`.

**DoD.**
- [ ] 16 canonical tables + 7 gold views live.
- [ ] 31 invariantes registered + enabled.
- [ ] `reconciliation_issues` open count trending down WoW.
- [ ] `gold_ceo_inbox` returns < 60 rows consistent with business reality.

**Dependencies.** SP3 canonical_companies/contacts/products complete.
**Risks.** Evidence migration de facts (31k rows) tarda. Mitigación: migrar in chunks by entity_type; ai_extracted_facts views back-compat.
**Duration.** 8-10 días.

### SP5 (Weeks 5-6): Frontend + Agents + Cleanup

**Objetivo.** Cutover consumers, drop legacy entirely, agents rewired a canonical_* only.

**Deliverables.**
1. Frontend queries migrados (por directorio `src/lib/queries/`):
   - `companies.ts` → canonical_companies + gold_company_360.
   - `invoices.ts` → canonical_invoices.
   - `payments.ts` → canonical_payments.
   - `orders.ts` → canonical_sale_orders / canonical_purchase_orders.
   - `products.ts` → canonical_products.
   - `contacts.ts` / `employees.ts` → canonical_contacts / canonical_employees.
   - `finance.ts` → gold_* views.
2. 9 agents rewired — each agent's query layer consumes ONLY canonical_* / gold_*. Agents declare field contracts (§13.2).
3. Drop dashboards decorativos (no callers confirmado en SP1 pero se reconfirma).
4. Drop legacy MVs: `invoices_unified`, `payments_unified`, `products_unified`, `syntage_invoices_enriched` (all superseded by canonical_*).
5. Drop `unified_invoices`, `unified_payment_allocations`, `invoice_bridge`, `orders_unified`, `order_fulfillment_bridge`, `person_unified` (superseded).
6. Drop `products_fiscal_map`, `invoice_bridge_manual`, `payment_bridge_manual` tables (migrated to `mdm_manual_overrides`).
7. Pipeline of learning + agent_insights sigue escribiendo; reads canonical_*.

**DoD.**
- [ ] `rg "FROM odoo_"` in `src/lib/queries/` and `src/lib/agents/` yields 0 matches.
- [ ] `rg "FROM syntage_"` similarly 0.
- [ ] No caller of `invoices_unified`, `payments_unified`, etc.
- [ ] All 15 DB views/MVs in legacy drop list (SP5 batch) dropped.
- [ ] `audit_runs` entry `silver_architecture_cutover_complete`.

**Dependencies.** SP4 complete.
**Risks.** Frontend typecheck errors en migration (queries return shapes diferentes). Mitigación: TypeScript types generados de canonical_* schema + grep gates en CI.
**Duration.** 7-10 días.

---

## 12. Drop list (committed)

Cada item: **reason** + **evidence** (referencia a audit 07 section o to queries vivas) + **replacement**.

### 12.1 Views to drop (15)

| View | Reason | Evidence | Replacement |
|---|---|---|---|
| `unified_invoices` | Legacy compat wrapper over `invoices_unified` MV | Spec 07 §7.3 | `canonical_invoices` |
| `unified_payment_allocations` | Legacy compat wrapper | Spec 07 §7.3 | `canonical_payment_allocations` |
| `invoice_bridge` | Superseded by `canonical_invoices` which has the same flags + more | SP2 | `canonical_invoices` + filters `is_gap_missing_sat` → `pending_operationalization` |
| `orders_unified` | Replaced | SP4 | `canonical_sale_orders` UNION `canonical_purchase_orders` or gold view |
| `order_fulfillment_bridge` | Replaced | SP4 | `canonical_order_lines` has same fields |
| `person_unified` | Replaced | SP3 | `canonical_contacts` |
| `cash_position` | Subsumed by cfo_dashboard / gold_cashflow | Spec 07 §7.1 | `gold_cashflow.current_cash` |
| `working_capital` vs `working_capital_cycle` | Duplicated logic with `cfo_dashboard` | Spec 07 §7.1 | Consolidar en `gold_cashflow.working_capital_*` |
| `cashflow_current_cash`, `cashflow_liquidity_metrics` | Over-fragmented | Spec 07 §3.7 | Merge en gold_cashflow |
| `v_audit_*` (21 views) | Audit harness views — keep all (monitoring post-Fase-0) | — | KEEP (explicit exception) |
| `monthly_revenue_trend` vs `monthly_revenue_by_company` | Duplicated | Spec 07 §7.2 | `gold_revenue_monthly` |
| `analytics_customer_360` | Direct mix syntage+odoo — reemplazar con gold | 2.6 pending | `gold_company_360` |
| `balance_sheet` | OK view pero con bug equity_unaffected | Spec 07 §3.6 | `gold_balance_sheet` + addon fix §14 |
| `pl_estado_resultados` | Replace by gold | — | `gold_pl_statement` |
| `revenue_concentration`, `portfolio_concentration` | Duplicated | Spec 07 §7.5 | Merge en gold_company_360 (tier field) |

### 12.2 MVs to drop or rebuild

| MV | Reason | Action |
|---|---|---|
| `invoices_unified` (258 MB) | Superseded | DROP after SP5 cutover |
| `payments_unified` (32 MB) | Superseded | DROP after SP5 |
| `syntage_invoices_enriched` (60 MB) | Fields extracted into canonical_invoices (fiscal_* cols) | DROP after SP2 |
| `products_unified` | Superseded | DROP after SP5 |
| `product_price_history` (5 MB) | Rebuild as gold_product_price_history or fold into `gold_product_performance` | REBUILD as gold |
| `company_profile`, `company_profile_sat` | Replaced by gold | DROP after SP5 |
| `monthly_revenue_by_company` | Replaced by gold_revenue_monthly | DROP after SP5 |
| `product_margin_analysis`, `customer_margin_analysis` | Fold into `gold_product_performance` | REBUILD |
| `customer_ltv_health`, `customer_product_matrix`, `supplier_product_matrix`, `supplier_price_index`, `supplier_concentration_herfindahl`, `partner_payment_profile`, `account_payment_profile`, `portfolio_concentration`, `rfm_segments`, `customer_cohorts` | Evaluate per-MV; most fold into gold_company_360 or gold_product_performance | REBUILD or DROP (SP4 audit) |
| `company_email_intelligence` (2.3 MB), `company_handlers`, `company_insight_history`, `company_narrative`, `cross_director_signals` | Agent-specific; keep if 7-agent system consumes, else drop | DECIDE in SP5 |
| `inventory_velocity`, `dead_stock_analysis`, `stockout_queue` (view) | Operational Ops MVs — keep but rewire on canonical_* | KEEP + rewire |
| `cashflow_projection`, `accounting_anomalies`, `ar_aging_detail`, `journal_flow_profile`, `ops_delivery_health_weekly`, `purchase_price_intelligence`, `product_real_cost`, `product_seasonality`, `payment_predictions`, `client_reorder_predictions`, `bom_duplicate_components` | Operational — keep but rewire | KEEP + rewire |

### 12.3 Tables to drop (dead data)

| Table | Reason | Evidence |
|---|---|---|
| `odoo_invoices_archive_dup_cfdi_uuid_2026_04_20` | Archive from Fase 2 cfdi bug mitigation | 5,321 rows archived; integrity validated |
| `odoo_invoices_archive_pre_dedup` | Archive from Fase 0 | integrity validated |
| `odoo_schema_catalog` (3,820 rows) | Dead-pixel; odoo-agent disabled | Spec 07 §1.A |
| `odoo_uoms` (76 rows) | Dead-pixel; no converter usage | Spec 07 §1.A |
| `odoo_snapshots` | Replaced by canonical_* | Spec 07 findings |
| `agent_tickets` (1,958 rows) | 100% pending, worker never runs | Spec 07 §6.6 — DECIDE or fix worker |
| `notification_queue` (780 rows) | 100% pending | Spec 07 §1.C |
| `health_scores` (51,152 rows) | 100% contact_id NULL | Spec 07 §1.C |
| `unified_refresh_queue` | 0 rows ever; reconsider or drop | Spec 07 §1.C |
| `reconciliation_summary_daily` | Stale; 2 rows total | Spec 07 §1.C |
| `invoice_bridge_manual`, `payment_bridge_manual`, `products_fiscal_map` | Migrate to `mdm_manual_overrides` in SP2-3 | — |

### 12.4 Frontend pages to drop (decorative)

| Page | Reason | Replacement |
|---|---|---|
| `/dashboard` (if heavy decorative) | Evaluate — keep if CEO uses daily | CEO Inbox primary |
| `/emails` standalone page | Merged into /companies/[id] and /contacts/[id] tabs | Remove top-nav |
| Any "agent status" decorative dashboards sin acción | — | Folded en `/system` page |

**SP1 audit step:** Claude examines `src/app/` routes + analytics events + user-facing navigation to classify. Drop only con explicit user signoff.

### 12.5 API routes to drop

| Route | Reason | Replacement |
|---|---|---|
| `/api/pipeline/reconcile` (if cron-only + no accompanying UI) | Superseded by reconciliation engine | engine runs via pg_cron |
| `/api/pipeline/embeddings` (if unused post-vector-prune) | Evaluate in SP5 | — |
| Any `/api/agents/*` endpoint con 0 traffic en 30d | — | Drop |

---

## 13. Contracts (API for consumers)

### 13.1 Frontend query contracts

Cada página declara qué canonical tables consume. Enforcement via TypeScript types auto-generados de canonical_* schema.

| Page | Canonical reads | Notes |
|---|---|---|
| `/inbox` | `gold_ceo_inbox`, `reconciliation_issues` | top 50 priority |
| `/inbox/insight/[id]` | `agent_insights`, `email_signals`, `ai_extracted_facts`, `attachments`, `manual_notes` | full context |
| `/dashboard` | `gold_company_360` (agg), `gold_cashflow`, `gold_reconciliation_health` | KPIs |
| `/companies` | `canonical_companies` + facet filters | list |
| `/companies/[id]` | `canonical_companies` + `canonical_invoices` (filtered by company) + `canonical_payments` + `canonical_contacts` (WHERE company_id) + `email_signals` + `ai_extracted_facts` | 10 tabs |
| `/contacts` | `canonical_contacts` | list |
| `/contacts/[id]` | `canonical_contacts` + `email_signals` + `ai_extracted_facts` | 7 tabs |
| `/employees` | `canonical_employees` | list + workload |
| `/departments` | `canonical_employees` + `gold_*` KPIs | |
| `/emails` | `emails` (Bronze) + `email_signals` | feed |
| `/threads` | `threads` (Bronze) + `email_signals` | urgency |
| `/briefings` | `briefings` | cron-generated |
| `/chat` | embeddings over canonical_* | RAG context |
| `/knowledge` | `entities` (Bronze) + `ai_extracted_facts` + `entity_relationships` | KG browser |
| `/system` | `pipeline_logs`, `schema_changes`, `audit_runs`, `reconciliation_issues` | admin |
| `/pagos` | `canonical_payments` + aging view | |
| `/finanzas` | `gold_pl_statement`, `gold_balance_sheet`, `gold_cashflow` | |
| `/ventas` | `canonical_sale_orders` + `gold_revenue_monthly` | |
| `/cobranza` | `canonical_invoices WHERE direction='issued' AND amount_residual_resolved > 0` + aging | |
| `/compras` | `canonical_purchase_orders` + `canonical_invoices WHERE direction='received'` | |
| `/empresas` | alias de `/companies` | |

### 13.2 Agent query contracts

Cada agent declara en su system prompt + code los campos que lee.

| Agent | Canonical reads | Purpose |
|---|---|---|
| Sales | `canonical_sale_orders`, `canonical_order_lines`, `canonical_crm_leads`, `gold_company_360 WHERE is_customer=true` | Pipeline, oportunidades |
| Finance | `canonical_invoices`, `canonical_payments`, `gold_cashflow`, `gold_pl_statement`, `canonical_bank_balances` | AR/AP/cash |
| Operations | `canonical_deliveries`, `canonical_inventory`, `canonical_manufacturing`, `canonical_order_lines` | Flujo operativo |
| Relationships | `canonical_contacts`, `email_signals`, `ai_extracted_facts`, threads | Health scores |
| Risk | `canonical_invoices WHERE days_overdue > 30`, `canonical_companies WHERE blacklist_level != 'none'`, `gold_reconciliation_health` | Riesgo |
| Growth | `gold_revenue_monthly`, `gold_company_360`, `canonical_products` + seasonality | Crecimiento |
| Meta | `agent_runs`, `agent_memory`, `reconciliation_issues` | Auto-reflexión |
| Data Quality | `reconciliation_issues`, `canonical_*.needs_review` | Calidad |
| Odoo | `odoo_*` (Bronze direct — diagnostic agent) + `canonical_companies.has_shadow_flag` | Gaps sync |

Agent can **never** write to canonical_*. Agent can write only to `agent_insights`, `agent_memory`, `manual_notes` (if user-facing insight).

### 13.3 CEO Inbox contract

**Read shape.**
```typescript
type InboxItem = {
  issue_id: string;
  issue_type: string;
  invariant_key: string;
  severity: 'critical'|'high'|'medium'|'low';
  priority_score: number;
  impact_mxn: number | null;
  age_days: number;
  description: string;
  canonical_entity_type: string;
  canonical_entity_id: string;
  action_cta: string | null;    // 'operationalize' | 'confirm_cancel' | 'link_manual' | ...
  assignee: { id: number; name: string } | null;
  metadata: Record<string, unknown>;
  detected_at: string; // ISO
};
```

**Actions.**
- `POST /api/inbox/resolve` — body `{ issue_id, resolution, note? }` — closes issue.
- `POST /api/inbox/assign` — body `{ issue_id, assignee_canonical_contact_id }` — reassign.
- `POST /api/inbox/action/operationalize` — invokes Odoo sync + relevant pipeline.
- `POST /api/inbox/action/link_manual` — opens MDM merge flow.

---

## 14. Addon changes required (qb19)

Para que la arquitectura Silver tenga datos limpios, hay correcciones que deben ocurrir en el addon antes o durante la migración.

### 14.1 `_build_cfdi_map` M2M over-assignment bug

**Issue.** `_push_invoices` itera M2M `doc.invoice_ids` en complemento de pago P y asigna UUID del complemento a TODAS las facturas cubiertas. Causó 1,547 UUIDs duplicados / 5,321 rows contaminadas.
**Root cause.** En lugar de iterar por `invoice_ids`, el addon debe usar `tax_cash_basis_rec_id` or lookup directo por move_type = out_invoice/in_invoice excluyendo entry type.
**Required fix.** Patch en `addons/quimibond_intelligence/models/sync_push.py` función `_build_cfdi_map` para filtrar `move_type IN ('out_invoice','in_invoice','out_refund','in_refund')` antes de asignar UUID.
**Priority.** **Blocker de SP2**. Sin esto, canonical_invoices tiene 13,775 rows post-2021 con `cfdi_uuid IS NULL` en Odoo y UUID SAT separado — trigger de `invoice.posted_without_uuid` invariante quedan críticas eternas.

### 14.2 `_push_account_balances` missing `equity_unaffected`

**Issue.** Balance sheet no cuadra (worst 3,575% diff). `equity_unaffected` (utilidad del ejercicio) tiene 0 rows en `odoo_account_balances`.
**Root cause.** Addon no empuja este account_type específico.
**Required fix.** En `_push_account_balances` include `equity_unaffected` account_type (+ cualquier otro equity_* subtype).
**Priority.** **Blocker de gold_balance_sheet** (SP4). Sin esto, el balance_sheet no cuadra.

### 14.3 `odoo_invoices.reversed_entry_id` not synced

**Issue.** Para Pattern A canonical_credit_notes, necesitamos `reversed_entry_id` de Odoo para linkear NC → factura origen (pre-SAT).
**Root cause.** `_push_invoices` no incluye `reversed_entry_id` field.
**Required fix.** Add column to `odoo_invoices` + push it.
**Priority.** **Medium** (canonical_credit_notes puede fallback a SAT cfdiRelacionados; Odoo improves match).

### 14.4 `odoo_invoices.payment_date` dead-pixel

**Issue.** Column exists in schema, never populated.
**Root cause.** Addon sync doesn't compute `payment_date` from reconciliation events.
**Required fix.** `_push_invoices` compute `payment_date` = date of latest reconciled `account.move.line` against this invoice.
**Priority.** **Low** (nice-to-have; canonical_invoices has `fiscal_fully_paid_at` from SAT which is authoritative anyway).

### 14.5 `odoo_order_lines.line_uom_id` / `odoo_invoice_lines.line_uom_id` not used

**Issue.** Dead-pixel. Quimibond doesn't use UoM conversion, so okay but wasting sync bandwidth.
**Required fix.** Either drop sync of those columns or expose `canonical_order_lines.uom_conversion_factor` using `odoo_uoms` table.
**Priority.** **Low** (nice-to-have, not blocker).

---

## 15. Definition of Done (architecture global)

Criterios medibles para decir "la arquitectura Silver está completa".

1. **No raw Bronze reads.** `grep -r "FROM odoo_" src/` and `grep -r "FROM syntage_" src/` in both frontend and agents yields **0 matches** (excepciones documentadas: `/system` admin page puede leer Bronze para diagnóstico).
2. **Zero orphan views/MVs.** `pg_stat_user_tables` + pg_proc references — cualquier view/MV con 0 callers (en src/ o en otras views/fns) está en drop list.
3. **CEO Inbox works.** `SELECT COUNT(*) FROM gold_ceo_inbox` returns 30-80 items consistently. User tested: opens inbox, understands top 5 issues without asking "qué significa esto".
4. **Reconciliation health trends down.** `reconciliation_issues` open count WoW comparison shows downward trend for 4 consecutive weeks (auto-resolve working).
5. **New source integration is drop-in.** Proof: stub spec for bank statement integration (§16) in this file. When user decides to implement, it's *additive* (new Pattern A columns in canonical_payments + new invariants), not rearquitectura.
6. **Survivorship rules testable.** For each canonical table, a SQL unit test exists in `supabase/tests/canonical_<table>_survivorship.sql` that verifies resolved fields pick the right source.
7. **Manual override audit.** Each row in `mdm_manual_overrides.is_active=true` can be traced back to a user via `linked_by` + `linked_at`. Revocation flow tested.
8. **All agents rewired.** 9 agents declare their canonical_* contracts in system prompt; spot-check that each agent's tool-calling returns only canonical_* fields in evidence arrays.
9. **Shadow flag flow works.** New SAT CFDI with unknown RFC → canonical_companies row created, shadow=true, visible in `/empresas?shadows_only=true`. User can click "formalizar" → triggers Odoo partner creation via sync_commands.
10. **69B block active.** Attempting to create PO in Odoo pull queue for company with `blacklist_level='definitive'` returns error. Attempting for `presumed` returns warning but allows.

---

## 16. Future extensions (out of scope v1, arquitectura support)

La arquitectura Silver soporta las siguientes extensiones sin rearquitectura.

### 16.1 Bank statement integration (stub spec)

**Current.** Odoo es único source de bank balances. Sin statement directo, reconciliación interna bancaria puede estar stale.
**Future.** Integrar API de BBVA / Bancomer / Mifel.
**Implementation outline.**
- **Bronze:** New tables `bank_statements`, `bank_statement_lines` (source='bbva'/...).
- **Silver:** Extend `canonical_payments` con columnas `bank_statement_line_id`, `bank_amount`, `bank_date`, `bank_reference`, `has_bank_record`. Pattern A grows from dual-source (Odoo+SAT) to triple-source (Odoo+SAT+Bank).
- **Invariantes:** 3 new (`bank.unreconciled_statement`, `bank.amount_mismatch`, `bank.date_mismatch`). Add to audit_tolerances.
- **MDM:** Bank statement lines link to payment via `matcher_payment_bank` (num_operacion or amount+date composite).
- **Gold:** `gold_cashflow` adds column `bank_confirmed_cash`.

No architecture change needed.

### 16.2 Supplier portal sync

Similar — supplier's invoices push → Bronze `supplier_portal_invoices`; reconciliation invariantes against canonical_invoices (direction='received').

### 16.3 Customer portal sync

Customers see their AR via auth. Reads from `canonical_invoices WHERE receptor_canonical_company_id = customer.company_id`. Write nothing. RLS policy.

### 16.4 Real-time alerts (<2h refresh)

Pattern: `LISTEN/NOTIFY` on canonical_* INSERT/UPDATE → websocket to frontend. Incremental refresh triggers already laid via §10.4 `needs_refresh=true` pattern.

### 16.5 ML-based anomaly detection

Features derived from canonical_*: unusual payment gap, unusual margin drop, unusual velocity change. Store predictions in `ai_extracted_facts` with `fact_type='anomaly_detected'` and `confidence` score. CEO Inbox surfaces high-confidence ones as issues.

---

## 17. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Migration breaks prod** (consumers of legacy MVs) | High | SP5 feature-flagged cutover per page; legacy MVs renamed `_deprecated` for 1 week before drop. |
| **canonical_invoices write amplification** (table + triggers vs MV refresh) | Medium | Batched triggers with debounce via `unified_refresh_queue`; nightly full rebuild as safety net. |
| **Matcher false positives** (company name fuzzy link) | High | Confidence threshold 0.85 for auto, 0.60-0.85 queue; `mdm_candidate_matches` review UI; `source_links.superseded_at` audit. |
| **User decision TBD: `amount_total_mxn_resolved`** | Medium | Expose both `_odoo` and `_sat` and `_resolved` (= Odoo for now, documented). Review after 30 days of usage. |
| **Addon _build_cfdi_map not fixed before SP2** | Critical | SP2 is gated on this addon PR. Escalate to user. |
| **pg_trgm performance on 9k entities + 2k companies** | Medium | Index `canonical_companies USING gin (canonical_name gin_trgm_ops)`; batch processing (500 rows at a time); nightly runs. |
| **Frontend typecheck failures on migration** | Medium | Generate TypeScript types from canonical schema via `supabase gen types`; run tsc in CI; migrate queries one directory at a time. |
| **Reconciliation engine overload** (31 invariantes × 129k invoices) | Medium | `auto_resolve` closes obvious cases; archive issues >90d resolved; pg_cron staggered schedules. |
| **Historical pre-Odoo (30,404 SAT-only)** distorts company_profile | Low | `historical_pre_odoo` flag filter in gold views; user decision firmada visible-in-same-table. |
| **Shadow companies over-create** (every email with new RFC makes shadow) | Medium | Shadow creation only on confirmed CFDI ingest, not email mention. Email mention → `entities` + `email_signals`, not shadow. |
| **Evidence tables grow unbounded** | Low | Purge policy: `email_signals` >180d archive; `ai_extracted_facts` expired=true after 90d no updates. |
| **Bronze schema drift** (Odoo/Syntage add columns) | Medium | `schema_changes` audit + `odoo_schema_catalog` refresh (even though MV dead-pixel, keep for diagnostics). |
| **RLS not yet addressed** (Fase 3 separate) | High | Silver cutover doesn't change RLS surface. Fase 3 Seguridad is separate spec. Until then, `anon` should not access Bronze with PII; document exposure. |
| **Odoo/Syntage outage during migration** | Low | Bronze keeps writing; Silver rebuilds when upstream resumes. `source_hashes` catch up. |
| **Manual overrides drift from reality** | Low | Soft-expire policy: `needs_review=true` when underlying Bronze changes; user decides keep/retire. |

---

## 18. Self-review checklist

- [x] Each canonical table (16) has full schema with column name + type + nullability + default + authority + origin.
- [x] Each Pattern A table shows diff computation (GENERATED ALWAYS AS).
- [x] Each Pattern C (MDM) entity shows example source_links resolution (in §5.5 example row).
- [x] Each multi-source field declared survivorship rule (per §5 subsection).
- [x] Every `TBD` in Truth Map resolved with user decision OR explicit flag for review (user decisions firmadas in §5.1/5.5/5.6 amount_mxn, shadow, manual lock).
- [x] All types explicit (numeric(14,2), timestamptz, text, bigint, integer, boolean, jsonb).
- [x] No "similar to above"; Pattern D schema for each of 4 evidence tables.
- [x] Indexes declared per-table.
- [x] 31 invariantes enumeradas con severity + tolerance + auto_resolve.
- [x] 5 sub-projects with deliverables + DoD + dependencies + duration.
- [x] Drop list with reason + evidence + replacement for each item.
- [x] API contracts for frontend + agents + CEO Inbox.
- [x] Addon fixes itemized (5 fixes, priorities noted).
- [x] Risks table with severity + mitigation.
- [x] Future extensions sketched enough to prove architecture supports them (bank, ML).
- [x] Example rows with realistic Quimibond data (PNT920218IW5, CME990531HR4 CONTITECH MXN amounts, WJ042Q22JNT160 SKU pattern).
- [x] Length ~1800+ lines achieved (target 1800-2500).

---

## 19. Fuentes (references)

- `/Users/jj/CLAUDE.md` — qb19 addon Odoo mapping.
- `/Users/jj/quimibond-intelligence/quimibond-intelligence/CLAUDE.md` — frontend + Supabase arquitectura.
- `/Users/jj/docs/superpowers/specs/2026-04-21-supabase-audit-07-desaprovechado.md` — desaprovechado + opportunities.
- `/Users/jj/docs/superpowers/specs/2026-04-21-truth-map.md` — v1 survivorship (superseded by this spec).
- `/Users/jj/docs/superpowers/specs/2026-04-20-supabase-audit-06-unificacion.md` — Fase 2.5 scope (superseded).
- `/Users/jj/docs/superpowers/specs/2026-04-19-supabase-audit-00-master.md` — 5-phase master plan (this spec slots after Fase 2.6, before Fase 3).
- `/Users/jj/.claude/projects/-Users-jj/memory/project_supabase_audit_2026_04_19.md` — Fase 0-2.6 closure.
- `/Users/jj/.claude/projects/-Users-jj/memory/project_syntage_integration.md` — Syntage phases.
- `/Users/jj/.claude/projects/-Users-jj/memory/project_cfdi_uuid_bug_2026_04_20.md` — addon _build_cfdi_map bug (§14.1).
- Queries live contra `tozqezmivpblmcubmnpi` al 2026-04-21: schema de odoo_*, syntage_*, canonical_*, audit_tolerances, reconciliation_issues counts (sat_only_cfdi_issued 30,770; complemento_missing_payment 23,033; sat_only_cfdi_received 20,594; payment_missing_complemento 5,552; partner_blacklist_69b 190; posted_but_sat_uncertified 178; cancelled_but_posted 97; amount_mismatch 24).
