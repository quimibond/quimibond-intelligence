# Syntage Fase 3 — Layer 3 Canónico (Vistas Unificadas + Reconciliación)

**Fecha:** 2026-04-17
**Autor:** Brainstorming jj + Claude
**Estado:** Diseño aprobado, pendiente revisión del documento consolidado
**Documento padre:** `2026-04-16-syntage-integration-design.md` (Sección 5 — Layer 3)
**Relacionado:** `2026-04-16-syntage-fase-1-plumbing.md`
**Próximo paso:** `writing-plans` para generar plan de implementación

---

## 1. Contexto y objetivo

Fases 1 y 2 establecieron el plumbing (webhook + 11 tablas `syntage_*`) y el onboarding de la entidad Quimibond (PNT920218IW5). Hoy hay ~12k invoices, 9.6k line items, 16k files, 630 payments y 239 tax returns en Supabase. Los extractores siguen corriendo para cerrar gaps 2018-2019, 2023 y 2024-2026.

**Fase 3 construye Layer 3 (Canónico):** vistas materializadas que merge-an datos fiscales (Syntage) con operativos (Odoo) aplicando **autoridad por campo**, y una tabla de `reconciliation_issues` que surface discrepancias accionables. Es el único layer que los directores IA consultarán (Fase 6) y el único que el frontend debe leer para datos fiscales (Fase 5 convierte queries existentes).

**Problema que resuelve:**
- Sin Layer 3, cada consumidor (IA, UI, RPC) tendría que re-implementar el matching Syntage↔Odoo y elegir autoridad por campo en cada query.
- Discrepancias (cancelaciones, fraudes, mismatches) quedarían invisibles; no hay tabla single-source para monitoreo.
- La UI no tiene superficie consolidada para mostrar "salud fiscal" del negocio.

**No-objetivo en Fase 3:**
- Migrar `cashflow_*` views y queries existentes (eso es Fase 5-6).
- Poblar `invoices_unified.email_id_origen` (requiere `email_cfdi_links` de Fase 5).
- Incluir issue `sat_opinion_negative` (requiere `syntage_tax_status` poblada, Fase 4).
- Tocar prompts de directores IA (Fase 6).

## 2. Decisiones cerradas

| Decisión | Opción elegida | Razón |
|---|---|---|
| `canonical_id` | `COALESCE(uuid_sat, 'odoo:' \|\| odoo_invoice_id::text)` | Natural key estable; no cambia con updates a campos operativos |
| Scope de `invoices_unified` | Solo `tipo_comprobante IN ('I','E')` | Únicos que matchean `account.move` operativo. P → `payments_unified`; N/T fuera de alcance |
| Refresh strategy | `MATERIALIZED VIEW` + `REFRESH CONCURRENTLY` via `pg_cron` 15min | Reads nunca bloquean; cron pattern ya definido en spec padre |
| Refresh manual | `POST /api/syntage/refresh-unified` (auth CRON_SECRET) | Trigger bajo demanda desde UI admin |
| `reconciliation_issues` MVP | 8 tipos (excluye `sat_opinion_negative` hasta Fase 4) | Todos los 9 del spec padre menos 1 que requiere data aún no disponible |
| `ambiguous_match` | NO es issue; vive como `match_status='ambiguous'` en la vista | Un UNIQUE constraint sobre ambiguous sólo generaría ruido |
| `payments_unified` grano | Vista mat. a grano de complemento + vista derivada a grano de allocation | Finance pregunta a nivel flujo, Cobranza a nivel factura |
| UI scope Fase 3 | Nuevo sub-tab `/system → Syntage → Reconciliación` (sin tocar queries existentes) | Observabilidad inmediata sin riesgo de regresión |
| Testing target | 60% coverage PLpgSQL + E2E fixtures + performance bench | Pragmático; PLpgSQL difícil de unit-testear aislado |
| Migración SQL | Archivo único `supabase/migrations/20260417_syntage_layer3.sql` | Un solo artefacto idempotente |

## 3. Artefactos a construir

| Artefacto | Tipo | Propósito |
|---|---|---|
| `invoices_unified` | `MATERIALIZED VIEW` | 1 row por CFDI canónico (I/E). Merge Syntage↔Odoo con autoridad por campo |
| `payments_unified` | `MATERIALIZED VIEW` | 1 row por complemento Tipo P. Merge Syntage↔Odoo |
| `payment_allocations_unified` | `VIEW` (no materializada) | Expande `doctos_relacionados` → 1 row por allocation factura↔complemento |
| `reconciliation_issues` | `TABLE` | 8 tipos de issue con severity + auto-resolución |
| `refresh_invoices_unified()` | `FUNCTION` (PLpgSQL) | `REFRESH CONCURRENTLY invoices_unified` + re-popula `reconciliation_issues` |
| `refresh_payments_unified()` | `FUNCTION` (PLpgSQL) | Idem para `payments_unified` |
| `get_syntage_reconciliation_summary()` | `FUNCTION` (PLpgSQL) | Single-roundtrip JSON para la UI |
| pg_cron job `*/15 * * * *` | Cron | Dispara `refresh_invoices_unified()` + `refresh_payments_unified()` |
| `POST /api/syntage/refresh-unified` | Next.js route | Trigger manual (auth CRON_SECRET) |
| `SyntageReconciliationPanel.tsx` | React component | Sub-tab nuevo en `/system → Syntage` |
| `supabase/migrations/20260417_syntage_layer3.sql` | Migration | Todo el SQL, idempotente (`DROP IF EXISTS` + `CREATE`) |

## 4. Matching strategy

### 4.1 `invoices_unified`

**Nivel 1 (UUID autoritativo):**
```sql
syntage_invoices.uuid = odoo_invoices.cfdi_uuid
AND syntage_invoices.odoo_company_id = odoo_invoices.odoo_company_id
```

**Nivel 2 (fallback compuesto, sólo cuando Nivel 1 no aplica):**
```sql
lower(coalesce(syntage.emisor_rfc, syntage.receptor_rfc)) = lower(companies.rfc)
AND abs(syntage.total - odoo.amount_total) < 0.01
AND date(syntage.fecha_emision) = date(odoo.invoice_date)
AND (
     coalesce(syntage.serie,'') || coalesce(syntage.folio,'') ILIKE '%' || odoo.ref || '%'
  OR odoo.ref ILIKE '%' || coalesce(syntage.folio,'') || '%'
)
AND syntage.odoo_company_id = odoo.odoo_company_id
```

**`match_status`** ∈
- `match_uuid` — Nivel 1 one-to-one
- `match_composite` — Nivel 2 one-to-one
- `syntage_only` — Syntage sin match Odoo
- `odoo_only` — Odoo con cfdi_uuid y sin match Syntage (O bien sin cfdi_uuid y sin fallback)
- `ambiguous` — Nivel 2 matchea a >1 Odoo row. Row expuesta con Syntage authoritative + `odoo_invoice_id=NULL`

**`match_quality`** ∈ `high` (UUID), `medium` (composite exacto), `low` (composite con `days_diff>0`).

### 4.2 `payments_unified`

**Nivel 1:**
```sql
syntage_invoice_payments.num_operacion = odoo_account_payments.ref
AND syntage_invoice_payments.odoo_company_id = odoo_account_payments.odoo_company_id
```

**Nivel 2 (fallback):**
```sql
lower(coalesce(syntage.rfc_emisor_cta_ord, syntage.rfc_emisor_cta_ben)) = lower(companies.rfc)
AND abs(syntage.monto - odoo.amount) < 0.01
AND abs(date(syntage.fecha_pago) - date(odoo.date)) <= 1
AND coalesce(syntage.moneda_p,'MXN') = coalesce(odoo.currency,'MXN')
AND syntage.odoo_company_id = odoo.odoo_company_id
```

`match_status` idénticos a `invoices_unified`.

## 5. Schema — `invoices_unified`

```sql
CREATE MATERIALIZED VIEW invoices_unified AS
WITH
  -- Nivel 1: match por UUID
  uuid_matches AS (
    SELECT s.uuid AS uuid_sat, o.id AS odoo_invoice_id
    FROM syntage_invoices s
    JOIN odoo_invoices o
      ON o.cfdi_uuid = s.uuid
     AND o.odoo_company_id = s.odoo_company_id
  ),
  -- Nivel 2: match por composite (sólo syntage rows sin match_uuid)
  composite_matches AS (
    SELECT DISTINCT ON (s.uuid) s.uuid AS uuid_sat, o.id AS odoo_invoice_id,
           COUNT(*) OVER (PARTITION BY s.uuid) AS n_candidates
    FROM syntage_invoices s
    JOIN companies c
      ON lower(c.rfc) = lower(coalesce(s.emisor_rfc, s.receptor_rfc))
    JOIN odoo_invoices o
      ON o.company_id = c.id
     AND abs(s.total - o.amount_total) < 0.01
     AND date(s.fecha_emision) = date(o.invoice_date)
     AND (
          coalesce(s.serie,'') || coalesce(s.folio,'') ILIKE '%' || coalesce(o.ref,'') || '%'
       OR coalesce(o.ref,'') ILIKE '%' || coalesce(s.folio,'') || '%'
     )
     AND o.odoo_company_id = s.odoo_company_id
    WHERE NOT EXISTS (SELECT 1 FROM uuid_matches u WHERE u.uuid_sat = s.uuid)
    ORDER BY s.uuid, o.invoice_date
  ),
  paired AS (
    SELECT uuid_sat, odoo_invoice_id, 'match_uuid' AS match_status, 'high' AS match_quality FROM uuid_matches
    UNION ALL
    SELECT uuid_sat, odoo_invoice_id,
           CASE WHEN n_candidates > 1 THEN 'ambiguous' ELSE 'match_composite' END,
           CASE WHEN n_candidates > 1 THEN 'low' ELSE 'medium' END
    FROM composite_matches
  )
SELECT
  -- Identidad canónica
  COALESCE(s.uuid, 'odoo:' || o.id::text) AS canonical_id,
  s.uuid AS uuid_sat,
  o.id AS odoo_invoice_id,
  COALESCE(p.match_status,
           CASE WHEN s.uuid IS NOT NULL AND o.id IS NULL THEN 'syntage_only'
                WHEN s.uuid IS NULL AND o.id IS NOT NULL THEN 'odoo_only' END) AS match_status,
  COALESCE(p.match_quality, 'n/a') AS match_quality,
  COALESCE(s.direction, CASE WHEN o.move_type LIKE 'out_%' THEN 'issued' ELSE 'received' END) AS direction,

  -- Fiscales (Syntage autoritativo)
  s.estado_sat,
  s.fecha_cancelacion,
  s.fecha_timbrado,
  s.tipo_comprobante,
  s.metodo_pago,
  s.forma_pago,
  s.uso_cfdi,
  s.emisor_rfc,
  s.emisor_nombre,
  s.receptor_rfc,
  s.receptor_nombre,
  s.emisor_blacklist_status,
  s.receptor_blacklist_status,
  s.total       AS total_fiscal,
  s.subtotal    AS subtotal_fiscal,
  s.descuento   AS descuento_fiscal,
  s.impuestos_trasladados,
  s.impuestos_retenidos,
  s.moneda      AS moneda_fiscal,
  s.tipo_cambio AS tipo_cambio_fiscal,
  s.total_mxn   AS total_mxn_fiscal,

  -- Operativos (Odoo autoritativo)
  o.odoo_company_id,
  o.company_id,                                         -- counterparty (public.companies)
  c.name        AS partner_name,                        -- JOIN companies
  o.odoo_partner_id,
  o.name        AS odoo_ref,                            -- SO/2026/..., INV/...
  o.ref         AS odoo_external_ref,
  o.move_type   AS odoo_move_type,
  o.state       AS odoo_state,
  o.payment_state,
  o.amount_total AS odoo_amount_total,
  o.amount_residual,
  o.invoice_date,
  o.due_date,
  o.days_overdue,
  o.currency    AS odoo_currency,

  -- Derivados
  CASE
    WHEN s.uuid IS NULL OR o.id IS NULL THEN NULL
    WHEN s.estado_sat = 'cancelado' AND o.state = 'posted' THEN 'cancelled_but_posted'
    WHEN s.uuid IS NULL AND o.state = 'posted' AND o.invoice_date > now() - interval '30 days' THEN 'posted_but_sat_uncertified'
    WHEN abs(s.total - o.amount_total) > 0.01 THEN 'amount_mismatch'
    ELSE 'consistent'
  END AS fiscal_operational_consistency,
  (s.total - o.amount_total) AS amount_diff,

  -- Evidencia (Fase 5)
  NULL::bigint AS email_id_origen,

  -- Plumbing
  now() AS refreshed_at
FROM paired p
FULL OUTER JOIN syntage_invoices s ON s.uuid       = p.uuid_sat
FULL OUTER JOIN odoo_invoices    o ON o.id         = p.odoo_invoice_id
LEFT JOIN companies c ON c.id = o.company_id
WHERE
  -- Scope: solo CFDI fiscales (I/E) del lado Syntage, y account.move facturas del lado Odoo
  (s.tipo_comprobante IN ('I','E') OR s.tipo_comprobante IS NULL)
  AND (o.move_type IN ('out_invoice','out_refund','in_invoice','in_refund') OR o.move_type IS NULL);

-- Único requerido para REFRESH CONCURRENTLY
CREATE UNIQUE INDEX invoices_unified_canonical_id_idx ON invoices_unified(canonical_id);
CREATE INDEX invoices_unified_company_date_idx       ON invoices_unified(odoo_company_id, fecha_timbrado DESC);
CREATE INDEX invoices_unified_match_status_idx       ON invoices_unified(match_status);
CREATE INDEX invoices_unified_consistency_idx        ON invoices_unified(fiscal_operational_consistency);
CREATE INDEX invoices_unified_cancelled_idx          ON invoices_unified(estado_sat) WHERE estado_sat='cancelado';
```

El CASE derivado (`fiscal_operational_consistency`) sólo se calcula para matched rows (ambos lados presentes). Para `sat_only` / `odoo_only` queda NULL (la clasificación la da `match_status`).

## 6. Schema — `payments_unified` + `payment_allocations_unified`

### 6.1 `payments_unified` (grano complemento)

```sql
CREATE MATERIALIZED VIEW payments_unified AS
SELECT
  COALESCE(s.uuid_complemento, 'odoo:' || o.id::text) AS canonical_payment_id,
  s.uuid_complemento,
  o.id AS odoo_payment_id,
  COALESCE(p.match_status,
           CASE WHEN s.uuid_complemento IS NOT NULL AND o.id IS NULL THEN 'syntage_only'
                WHEN s.uuid_complemento IS NULL AND o.id IS NOT NULL THEN 'odoo_only' END) AS match_status,
  COALESCE(p.match_quality, 'n/a') AS match_quality,
  COALESCE(s.direction, CASE WHEN o.payment_type='inbound' THEN 'received' ELSE 'issued' END) AS direction,

  -- Fiscales (Syntage)
  s.fecha_pago, s.forma_pago_p, s.num_operacion, s.moneda_p, s.tipo_cambio_p, s.monto,
  s.rfc_emisor_cta_ord, s.rfc_emisor_cta_ben, s.estado_sat, s.doctos_relacionados,

  -- Operativos (Odoo)
  o.odoo_company_id, o.company_id, o.odoo_partner_id, o.name AS odoo_ref,
  o.amount AS odoo_amount, o.date AS odoo_date, o.journal_id, o.payment_method_line_id,
  o.reconciled, o.currency AS odoo_currency,

  now() AS refreshed_at
FROM (
  -- Similar pattern al de invoices_unified: paired = uuid_matches UNION composite_matches
  -- Nivel 1: syntage.num_operacion = odoo.ref + odoo_company_id
  -- Nivel 2: (partner_vat, amount, fecha_pago ±1d, moneda)
  SELECT NULL::text AS uuid_complemento, NULL::bigint AS odoo_payment_id,
         NULL::text AS match_status, NULL::text AS match_quality
  WHERE false
) p
FULL OUTER JOIN syntage_invoice_payments s ON s.uuid_complemento = p.uuid_complemento
FULL OUTER JOIN odoo_account_payments   o ON o.id                = p.odoo_payment_id;

CREATE UNIQUE INDEX payments_unified_canonical_idx ON payments_unified(canonical_payment_id);
CREATE INDEX payments_unified_company_date_idx    ON payments_unified(odoo_company_id, fecha_pago DESC);
CREATE INDEX payments_unified_match_status_idx    ON payments_unified(match_status);
```

### 6.2 `payment_allocations_unified` (grano allocation)

```sql
CREATE VIEW payment_allocations_unified AS
SELECT
  p.canonical_payment_id,
  p.uuid_complemento,
  p.odoo_payment_id,
  p.direction,
  p.fecha_pago,
  (doc->>'uuid_docto')::text AS invoice_uuid_sat,
  (doc->>'serie')::text AS invoice_serie,
  (doc->>'folio')::text AS invoice_folio,
  (doc->>'parcialidad')::int AS parcialidad,
  (doc->>'imp_saldo_ant')::numeric AS imp_saldo_ant,
  (doc->>'imp_pagado')::numeric AS imp_pagado,
  (doc->>'imp_saldo_insoluto')::numeric AS imp_saldo_insoluto,
  p.odoo_company_id,
  -- Link a invoice canonical (si existe)
  iu.canonical_id AS invoice_canonical_id
FROM payments_unified p,
LATERAL jsonb_array_elements(p.doctos_relacionados) AS doc
LEFT JOIN invoices_unified iu ON iu.uuid_sat = (doc->>'uuid_docto')::text;
```

## 7. Schema — `reconciliation_issues`

```sql
CREATE TABLE reconciliation_issues (
  issue_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_type text NOT NULL CHECK (issue_type IN (
    'cancelled_but_posted',
    'posted_but_sat_uncertified',
    'sat_only_cfdi_received',
    'sat_only_cfdi_issued',
    'amount_mismatch',
    'partner_blacklist_69b',
    'payment_missing_complemento',
    'complemento_missing_payment'
  )),
  canonical_id text,                    -- FK lógica a invoices_unified / payments_unified
  uuid_sat text,
  odoo_invoice_id bigint,
  odoo_payment_id bigint,
  odoo_company_id int,
  company_id bigint,                    -- counterparty (public.companies)
  description text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution text,                      -- auto_odoo_updated | auto_syntage_updated | manual | stale_7d
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Dedup estructural: un solo issue open por tipo + canonical
CREATE UNIQUE INDEX reconciliation_issues_open_unique
  ON reconciliation_issues (issue_type, canonical_id)
  WHERE resolved_at IS NULL;

CREATE INDEX reconciliation_issues_company_open_idx
  ON reconciliation_issues (odoo_company_id, severity)
  WHERE resolved_at IS NULL;

CREATE INDEX reconciliation_issues_detected_idx
  ON reconciliation_issues (detected_at DESC);
```

### 7.1 Tipos MVP (8)

| `issue_type` | Severity | Trigger | Filtro falsos positivos |
|---|---|---|---|
| `cancelled_but_posted` | high | Syntage `estado_sat='cancelado'` y Odoo `state='posted'` | ninguno |
| `posted_but_sat_uncertified` | low | Odoo `state='posted'`, sin cfdi_uuid, y sin match composite en Syntage | `invoice_date > now() - interval '30 days'` |
| `sat_only_cfdi_received` | medium | Syntage `direction='received'` y no hay match Odoo | ninguno (todo gasto no contabilizado importa) |
| `sat_only_cfdi_issued` | **critical** | Syntage `direction='issued'` y no hay match Odoo | ninguno (fraude potencial) |
| `amount_mismatch` | medium | Match UUID y `abs(total_fiscal - amount_total) > 0.01` | ninguno |
| `partner_blacklist_69b` | medium | Counterparty con `emisor_blacklist_status IN ('presumed','definitive')` | un issue por company_id (no por factura) |
| `payment_missing_complemento` | high | Odoo `payment_state='paid'`, `metodo_pago='PPD'`, y no hay Tipo P | `pago ≥ 30d` (ley da 30 días para Tipo P) |
| `complemento_missing_payment` | high | Syntage Tipo P sin match en odoo_account_payments | ninguno |

### 7.2 Shape de `metadata jsonb` (convención fija)

```jsonc
{
  "amount_diff": 12.34,                   // si aplica (amount_mismatch)
  "counterparty_rfc": "XYZ010101ABC",
  "detected_via": "uuid" | "composite",
  "days_overdue": 45,                     // si aplica (payment_missing_complemento)
  "severity_reason": "total diff >$1000"  // opcional, libre
}
```

### 7.3 Auto-resolución

Dentro de `refresh_invoices_unified()`, antes del INSERT de nuevos issues:

```sql
-- Cerrar issues que ya no aplican
UPDATE reconciliation_issues
SET resolved_at = now(), resolution = 'auto_odoo_updated'
WHERE resolved_at IS NULL
  AND issue_type = 'cancelled_but_posted'
  AND NOT EXISTS (
    SELECT 1 FROM invoices_unified iu
    WHERE iu.canonical_id = reconciliation_issues.canonical_id
      AND iu.fiscal_operational_consistency = 'cancelled_but_posted'
  );
-- Repetir pattern por cada issue_type
```

Issues sin actualización por >7 días sin resolver → `resolution='stale_7d'` (para que el dashboard no los reporte como "nuevos").

## 8. Funciones PLpgSQL

### 8.1 `refresh_invoices_unified() RETURNS jsonb`

```plpgsql
DECLARE
  t_start timestamptz := clock_timestamp();
  v_opened int;
  v_resolved int;
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY invoices_unified;

  -- Auto-resolver issues que ya no aplican (8 UPDATEs, uno por issue_type)
  WITH r AS (
    UPDATE reconciliation_issues SET resolved_at = now(), resolution = 'auto_odoo_updated'
    WHERE resolved_at IS NULL
      AND issue_type = 'cancelled_but_posted'
      AND NOT EXISTS (SELECT 1 FROM invoices_unified iu
                      WHERE iu.canonical_id = reconciliation_issues.canonical_id
                        AND iu.fiscal_operational_consistency = 'cancelled_but_posted')
    RETURNING 1
  ) SELECT count(*) INTO v_resolved FROM r;
  -- (repetir pattern por cada issue_type, acumulando v_resolved)

  -- Insertar nuevos issues (8 INSERT ... ON CONFLICT DO NOTHING)
  WITH ins AS (
    INSERT INTO reconciliation_issues (issue_type, canonical_id, uuid_sat, odoo_invoice_id,
                                       odoo_company_id, company_id, description, severity, metadata)
    SELECT 'cancelled_but_posted', iu.canonical_id, iu.uuid_sat, iu.odoo_invoice_id,
           iu.odoo_company_id, iu.company_id,
           format('Syntage marca cancelado %s pero Odoo sigue posted (%s)', iu.uuid_sat, iu.odoo_ref),
           'high',
           jsonb_build_object('counterparty_rfc', COALESCE(iu.emisor_rfc, iu.receptor_rfc),
                              'detected_via', 'uuid')
    FROM invoices_unified iu
    WHERE iu.fiscal_operational_consistency = 'cancelled_but_posted'
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_opened FROM ins;
  -- (repetir pattern por cada issue_type, acumulando v_opened)

  -- Marcar stale
  UPDATE reconciliation_issues
  SET resolution = 'stale_7d'
  WHERE resolved_at IS NULL
    AND detected_at < now() - interval '7 days'
    AND resolution IS NULL;

  RETURN jsonb_build_object(
    'refreshed_at', now(),
    'invoices_unified_rows', (SELECT count(*) FROM invoices_unified),
    'issues_opened', v_opened,
    'issues_resolved', v_resolved,
    'duration_ms', extract(milliseconds FROM clock_timestamp() - t_start)::int
  );
END;
```

Si falla, la transacción rollback deja la vista y la tabla en el estado anterior.

### 8.2 `refresh_payments_unified() RETURNS jsonb`

Idem para payments, pero sólo toca issues `payment_missing_complemento` y `complemento_missing_payment`.

### 8.3 `get_syntage_reconciliation_summary() RETURNS jsonb`

```jsonc
{
  "by_type": [
    {"type": "cancelled_but_posted", "open": 12, "resolved_7d": 3, "severity": "high"}
  ],
  "by_severity": {"critical": 2, "high": 18, "medium": 45, "low": 103},
  "top_companies": [{"company_id": 42, "name": "Acme Textiles", "open": 8}],  // LIMIT 10
  "resolution_rate_7d": 0.67,    // resolved / (resolved + new) últimos 7d
  "recent_critical": [           // LIMIT 20, severity IN ('critical','high')
    {
      "issue_id": "…", "type": "sat_only_cfdi_issued",
      "description": "…", "company": "Acme Textiles",
      "amount_diff": 23000, "detected_at": "2026-04-17T…"
    }
  ]
}
```

Single query con subqueries; target <300ms.

## 9. Cron + manual trigger

```sql
-- En la migración:
SELECT cron.schedule(
  'refresh-syntage-unified',
  '*/15 * * * *',
  $$
    SELECT refresh_invoices_unified();
    SELECT refresh_payments_unified();
  $$
);
```

**Endpoint manual:** `POST /api/syntage/refresh-unified` en Next.js, auth via `validatePipelineAuth`. Llama RPC `refresh_invoices_unified()` + `refresh_payments_unified()` y devuelve el JSON combinado. 30s timeout (`maxDuration=30`).

## 10. UI — `SyntageReconciliationPanel.tsx`

Nuevo sub-tab `/system → Syntage → Reconciliación`. Layout:

- **Row 1 — Stat cards (grid 4x2):** uno por `issue_type` del MVP, mostrando `open_count` + color por severity + trend vs 24h atrás.
- **Row 2 — Donut + line chart:**
  - Donut: open issues por severity.
  - Line: resolution_rate últimos 7 días (puntos diarios).
- **Row 3 — Tabla issues críticos:** paginada, filtrada a `severity IN ('critical','high')` + `resolved_at IS NULL`, ordenada por `detected_at DESC`. Columnas: type, description, counterparty, amount_diff, detected_at, link a Odoo. 25 rows/page.
- **Row 4 — Top 10 empresas con más issues open:** lista ordenada, link al detalle de cada empresa.

Data source único: `get_syntage_reconciliation_summary()` — un solo roundtrip. Refresh cada 60s client-side (SWR).

Botón "Forzar refresh" llama `POST /api/syntage/refresh-unified` (disabled mientras corre).

## 11. Testing

### 11.1 Unit (vitest + pg fixture)

- `invoices_unified.test.ts` — fixtures con pares Syntage/Odoo cubriendo cada `match_status` y cada `issue_type`. Insert → refresh → assert rows.
- `payments_unified.test.ts` — idem para payments + allocations.
- `reconciliation_issues.test.ts` — validar:
  - Cada issue_type se detecta correctamente
  - Filtros de false positives (30d, etc.) funcionan
  - Auto-resolución cierra issues cuando aplica
  - UNIQUE constraint impide duplicados abiertos
  - `metadata jsonb` cumple el shape

### 11.2 Integration / E2E

- Seed local Supabase con migración + dataset mezclado (UUIDs que matchean, algunos sólo en Syntage, algunos cancelados).
- `SELECT refresh_invoices_unified()` → validar counts.
- Re-run → validar idempotencia (counts idénticos).

### 11.3 Performance bench

Test con 50k rows combinadas:
- `REFRESH MATERIALIZED VIEW CONCURRENTLY` debe completar `<30s`
- **Fail** si toma `>60s` (signal para refresh incremental)

### 11.4 Regression snapshot

Test que consulta `information_schema.columns WHERE table_name='invoices_unified'` y compara contra un JSON checkeado en git — detecta cambios accidentales de shape.

### 11.5 Coverage target

**60% PLpgSQL + 100% de los 8 issue_types cubiertos por al menos un test.** Pragmático; PLpgSQL es difícil de unit-testear aislado sin levantar Postgres.

## 12. Límites y failure tolerance

### 12.1 Atomicidad del refresh

Toda la lógica de `refresh_invoices_unified()` corre en un único `BEGIN...COMMIT`. Si el REFRESH falla, la MV conserva su versión previa. Si el auto-resolve o los INSERTs fallan, la transacción rollback — ni la vista ni la tabla quedan en estado intermedio.

`REFRESH CONCURRENTLY` usa MVCC: lectores nunca ven estados intermedios.

### 12.2 Performance targets

| Dataset | Target | Acción si se supera |
|---|---|---|
| Hoy (~40k combined) | refresh <5s | n/a |
| 100k combined | refresh <10s | n/a |
| 500k combined | refresh <30s | Evaluar refresh incremental |
| 500k + refresh >60s | — | **Fase 3.5**: tabla `invoices_unified_stale` + triggers + delta refresh |

### 12.3 Failure modes

| Modo | Detección | Mitigación |
|---|---|---|
| `REFRESH CONCURRENTLY` locked (migración DDL corriendo) | `ERROR: concurrent refresh not supported` | Retry con `REFRESH MATERIALIZED VIEW invoices_unified` (non-concurrent, bloquea reads) como fallback |
| Unique constraint violation en `reconciliation_issues` | Rare — dedup estructural | Log + skip row; no rollback completo |
| `gen_random_uuid()` unavailable | `pgcrypto` extension | Migración asegura `CREATE EXTENSION IF NOT EXISTS pgcrypto` |
| Cron silenciosamente muere | Sin refresh por >30min | Alert en `/system → Syntage` (mostrar `refreshed_at` con staleness) |

## 13. Deprecación diferida

Lo que **NO** cambia en Fase 3:

- `cashflow_*` views (`cash_position`, `cfo_dashboard`, `expense_breakdown`, etc.) siguen leyendo `odoo_invoices` directo. Migración a `invoices_unified` se hace en **Fase 5-6** junto con el reemplazo de prompts de directores IA (evita regresión visual en /cobranza, /finanzas).
- `cfdi_documents` intacta — deprecación formal en **Fase 5**.
- `invoices_unified.email_id_origen` queda NULL — se pobla en **Fase 5** cuando existe `email_cfdi_links`.
- Queries del frontend (`src/lib/queries/invoice-detail.ts`, `src/components/shared/v2/invoice-detail.tsx`) siguen leyendo `odoo_invoices` / `cfdi_documents` — migración en **Fase 5**.
- Prompts de directores IA (Finance/Risk/Compras) siguen referenciando tablas Odoo — migración en **Fase 6**.

## 14. Migración

Archivo único: `supabase/migrations/20260417_syntage_layer3.sql`. Estructura:

1. `CREATE EXTENSION IF NOT EXISTS pgcrypto` + `pg_cron`
2. `CREATE TABLE reconciliation_issues` + índices
3. `CREATE MATERIALIZED VIEW invoices_unified` + 5 índices (incl. unique)
4. `CREATE MATERIALIZED VIEW payments_unified` + 3 índices (incl. unique)
5. `CREATE VIEW payment_allocations_unified`
6. `CREATE FUNCTION refresh_invoices_unified()`
7. `CREATE FUNCTION refresh_payments_unified()`
8. `CREATE FUNCTION get_syntage_reconciliation_summary()`
9. `SELECT cron.schedule(...)` para el job 15min
10. RLS deny-all en `reconciliation_issues`
11. GRANT a service_role

Todo idempotente (`DROP IF EXISTS` + `CREATE OR REPLACE`). Re-ejecutable sin efectos laterales.

## 15. Rollout

1. **Dry-run local:** seed Supabase local + migración + tests pasan
2. **Deploy a producción:** push → Vercel picks up migración vía Supabase push
3. **Validation manual:** trigger `POST /api/syntage/refresh-unified`, revisar counts
4. **Cron kicks in:** al cabo de 15min, primer refresh automático
5. **Gate:** `invoices_unified` rowcount ≈ `syntage_invoices` + `odoo_invoices` - matches. `reconciliation_issues` con counts sensatos (no 27k sat_only_cfdi_issued por bug de matching).

**Rollback** (<1 min):
```sql
DROP MATERIALIZED VIEW invoices_unified CASCADE;
DROP MATERIALIZED VIEW payments_unified CASCADE;
DROP VIEW payment_allocations_unified;
DROP TABLE reconciliation_issues;
DROP FUNCTION refresh_invoices_unified();
DROP FUNCTION refresh_payments_unified();
DROP FUNCTION get_syntage_reconciliation_summary();
SELECT cron.unschedule('refresh-syntage-unified');
```

Cashflow views, Odoo data, Syntage data — todo intacto. Frontend sigue operando normal (no lee invoices_unified en Fase 3).

## 16. Criterios de éxito

| Métrica | Target |
|---|---|
| `invoices_unified.match_status='match_uuid'` | >95% de Odoo invoices con cfdi_uuid y cobertura Syntage |
| Refresh duration | <10s @ ~40k combined; <30s @ 500k combined |
| `reconciliation_issues.resolution_rate_7d` | >40% (rolling) |
| UI `/system → Syntage → Reconciliación` latencia | <500ms first paint |
| `ambiguous` rows | <1% (sugiere que composite matching es confiable) |
| Tests pasando | 100% (unit + integration + perf bench) |
| Coverage PLpgSQL | ≥60% |

## 17. Referencias

- Spec padre: `2026-04-16-syntage-integration-design.md` (§5 Layer 3)
- Plan Fase 1: `2026-04-16-syntage-fase-1-plumbing.md`
- Supabase materialized views: https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html
- pg_cron: https://github.com/citusdata/pg_cron
- Docs Syntage Complemento P: https://docs.syntage.com/resources/invoice-payments
