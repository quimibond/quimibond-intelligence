# Syntage Integration — Fuente de Verdad del SAT con Separación por Layers

**Fecha:** 2026-04-16
**Autor:** Brainstorming jj + Claude
**Estado:** Diseño aprobado por secciones, pendiente revisión del documento consolidado
**Documento padre:** `2026-04-12-flujo-datos-vision-ideal.md`
**Relacionado:** `2026-04-12-fase-0-ingestion-core-design.md` (este diseño reusa `ingestion.*` core)
**Próximo paso:** writing-plans para generar plan de implementación

---

## 1. Contexto y objetivo

Quimibond Intelligence tiene hoy datos operativos en Odoo y datos conversacionales en Gmail, pero **carece de fuente fiscal autoritativa del SAT**. El parser CFDI actual (`/api/pipeline/parse-cfdi`) depende de que los proveedores manden XMLs por email — cobertura baja (349 CFDIs parseados vs 27,715 facturas Odoo, solo 54% con UUID). Esto deja ciego al sistema frente a: cancelaciones de CFDI, complementos de pago Tipo P (los pagos reales), retenciones, opinión de cumplimiento de proveedores, y CFDIs recibidos que nunca llegaron por correo.

**Syntage** es un proveedor mexicano que se conecta directamente al SAT con CIEC/e.firma y expone los datos fiscales vía REST API + webhooks. Elimina toda la infraestructura de scraping/parseo que tendríamos que construir.

**Objetivo:** Agregar Syntage como fuente fiscal de Capa 1 para Quimibond Intelligence, con separación estricta de responsabilidades entre las tres fuentes (Odoo = operativo, Syntage = fiscal, Gmail = conversacional), una capa canónica que resuelve discrepancias por autoridad por campo, y soporte multi-entidad (N empresas Quimibond en Odoo = N taxpayers en Syntage).

**No-objetivo:** reemplazar Odoo como ERP. Syntage no escribe en Odoo; solo provee verdad fiscal para razonamiento y detección de discrepancias.

## 2. Decisiones arquitectónicas (respuestas cerradas durante brainstorming)

| Decisión | Opción elegida | Por qué |
|---|---|---|
| **Alcance de Syntage** | C — Total (CFDIs I/E emitidos+recibidos, cancelación, Tipo P, retenciones, nómina, e-accounting, tax_status) | Una sola integración resuelve 6+ ciegas fiscales |
| **Modelo de autoridad** | A — Por campo con vista unificada | Explícito en SQL; cada discrepancia registrable |
| **Dónde vive el adaptador** | Syntage ES el adaptador (webhook receiver ligero + reconcile + backfill one-off) | No reinventar plomería; Syntage handle SAT auth, paginación, retries |
| **Mirror de datos** | A — Total a 9 tablas `syntage_*` en Supabase | Permite JOIN con Odoo sin ir contra API en cada query |
| **Qué pasa con `cfdi_documents`** | B — Deprecar parsing, convertir a `email_cfdi_links` con schema reducido | Mantener cadena de custodia email↔CFDI sin duplicar fiscal truth |
| **Webhook receiver location** | A — Vercel (`/api/syntage/webhook`) | Patrón match con `sync-emails`, `parse-cfdi` existentes |
| **Backfill histórico** | Desde registrationDate del SAT por entidad (no cap artificial) | Cobertura máxima para análisis de cohortes multi-año |
| **Multi-entidad** | Tabla `syntage_entity_map` explícita (RFC ↔ odoo_company_id) | Usuario tiene N empresas Quimibond en ambos sistemas |

## 3. Arquitectura por layers

```
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 5 — PRESENTACIÓN                                             │
│  Next.js (quimibond-intelligence). Lee solo RPCs + vistas unificadas│
└─────────────────────────────────────────────────────────────────────┘
                              ▲
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 4 — INTELIGENCIA                                             │
│  Directores IA + Meta + Data Quality + Odoo Advisor.                │
│  Leen solo de Layer 3 (canónico). Nunca de tablas fuente.           │
└─────────────────────────────────────────────────────────────────────┘
                              ▲
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 3 — CANÓNICO / UNIFIED                                       │
│  Vistas materializadas que resuelven autoridad por campo.           │
│  invoices_unified, payments_unified, partners_unified,              │
│  reconciliation_issues (discrepancias entre fuentes)                │
└─────────────────────────────────────────────────────────────────────┘
                              ▲
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 2 — MIRROR POR FUENTE (Supabase)                             │
│  Un namespace por fuente, nunca se mezclan:                         │
│  • odoo_*          (tablas operativas existentes)                   │
│  • syntage_*       (11 tablas — verdad fiscal SAT) ← NUEVO          │
│  • emails, threads (verdad conversacional)                          │
│  • email_cfdi_links (puente email↔CFDI) ← renombrado cfdi_documents │
│  + ingestion.* (plomería: sync_run, sync_failure, reconciliation)   │
└─────────────────────────────────────────────────────────────────────┘
                              ▲
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 1 — FUENTES DE VERDAD                                        │
│  • Odoo 19 (ERP operativo — push cada 1h desde qb19)                │
│  • Syntage → SAT (fiscal — push vía webhooks en tiempo real) ← NUEVO│
│  • Gmail (comunicación — push cada 30 min desde Vercel)             │
└─────────────────────────────────────────────────────────────────────┘
```

**Principio rector:** una fuente, un namespace, un rol.

| Fuente | Namespace | Rol exclusivo | Cadencia |
|---|---|---|---|
| Odoo | `odoo_*` | Verdad operativa: partner_id, salesperson, payment_state, stock, SO/PO, costos | Push 1h desde qb19 |
| Syntage | `syntage_*` | Verdad fiscal: UUID, estado SAT, Tipo P, retenciones, constancia, e-accounting | Webhook real-time + reconcile 6h |
| Gmail | `emails`/`threads` | Verdad conversacional: comunicación, sentiment, trazabilidad email↔CFDI | Cron 30min Vercel |

**Flujo de datos (bottom-up):**

1. **Layer 1 → Layer 2:** cada fuente pushea solo a su namespace. Todos reportan a `ingestion.sync_run` / `sync_failure`. Cero escritura cross-namespace.
2. **Layer 2 → Layer 3:** vistas materializadas hacen merge aplicando autoridad por campo. Discrepancias → `reconciliation_issues`.
3. **Layer 3 → Layer 4:** directores IA consultan solo Layer 3. Nunca tocan Layer 2.
4. **Layer 4 → Layer 5:** frontend consume `agent_insights`, briefings, `invoices_unified`, RPCs. Nunca lee Layer 2.

## 4. Schema de tablas `syntage_*`

Patrón compartido: campos denormalizados para queries frecuentes + `raw_payload jsonb` (evento webhook completo, sin migración para extraer campos nuevos después). Todas con `source_id`/`source_ref` apuntando a `ingestion.source_registry`, `synced_at`, `odoo_company_id` (poblado por el webhook handler vía `syntage_entity_map`), y RLS deny-all.

### 4.1 Siete tablas de datos

#### `syntage_invoices` — CFDIs tipo I (Ingreso) y E (Egreso)

| Campo | Tipo | Notas |
|---|---|---|
| `syntage_id` | text PK | IRI Syntage: `/invoices/{uuid}` |
| `uuid` | text UNIQUE | UUID SAT — join key con Odoo |
| `taxpayer_rfc` | text | Dueño de la extracción |
| `odoo_company_id` | int | Resuelto vía `syntage_entity_map` |
| `direction` | text | `'issued'` / `'received'` |
| `tipo_comprobante` | text | `I` / `E` |
| `serie`, `folio` | text | |
| `fecha_emision`, `fecha_timbrado` | timestamptz | |
| `emisor_rfc`, `emisor_nombre`, `receptor_rfc`, `receptor_nombre` | text | |
| `subtotal`, `descuento`, `total` | numeric | |
| `moneda`, `tipo_cambio`, `total_mxn` | text/numeric | `total_mxn` GENERATED |
| `impuestos_trasladados`, `impuestos_retenidos` | numeric | |
| `metodo_pago` | text | `PUE` / `PPD` |
| `forma_pago`, `uso_cfdi` | text | |
| `estado_sat` | text | `'vigente'` / `'cancelado'` / `'cancelacion_pendiente'` |
| `fecha_cancelacion` | timestamptz | |
| `emisor_blacklist_status`, `receptor_blacklist_status` | text | 69-B: presumed/dismissed/definitive/favorable |
| `xml_file_id`, `pdf_file_id` | bigint FK | → `syntage_files` |
| `company_id` | bigint FK | Auto-linked por RFC → `companies` (el **counterparty**: cliente o proveedor). Distinto de `odoo_company_id` que identifica la empresa Quimibond dueña del CFDI. |
| `raw_payload` | jsonb | |
| plumbing | | `source_id`, `source_ref`, `synced_at`, `created_at` |

Índices: `uuid` unique, `(taxpayer_rfc, direction, fecha_emision DESC)`, `(estado_sat) WHERE estado_sat='cancelado'`, `(odoo_company_id)`, `(company_id)`.

#### `syntage_invoice_line_items` — conceptos
Campos: `syntage_id`, `invoice_uuid` FK, `line_number`, `clave_prod_serv` (catálogo SAT), `descripcion`, `cantidad`, `clave_unidad`, `valor_unitario`, `importe`, `descuento`, `raw_payload`, plumbing.

#### `syntage_invoice_payments` — Complementos Tipo P

| Campo | Tipo | Notas |
|---|---|---|
| `syntage_id` | text PK | |
| `uuid_complemento` | text UNIQUE | |
| `taxpayer_rfc`, `odoo_company_id` | text, int | |
| `direction` | text | `'received'` / `'issued'` |
| `fecha_pago` | timestamptz | Fecha real SAT |
| `forma_pago_p` | text | 03 transferencia, 04 tarjeta, etc. |
| `moneda_p`, `tipo_cambio_p`, `monto` | text/numeric | |
| `num_operacion` | text | Ref bancaria |
| `rfc_emisor_cta_ord`, `rfc_emisor_cta_ben` | text | Bancos |
| `doctos_relacionados` | jsonb | `[{uuid_docto, serie, folio, parcialidad, imp_saldo_ant, imp_pagado, imp_saldo_insoluto}]` |
| `estado_sat` | text | |
| `xml_file_id` | bigint FK | |
| `raw_payload` | jsonb | |
| plumbing | | |

Vista derivada opcional `syntage_payment_allocations` que explota `doctos_relacionados` para consultas.

#### `syntage_tax_retentions` — CFDI de retenciones
Campos: `syntage_id`, `uuid`, `taxpayer_rfc`, `odoo_company_id`, `direction`, `fecha_emision`, `emisor_rfc/nombre`, `receptor_rfc/nombre`, `tipo_retencion`, `monto_total_operacion`, `monto_total_gravado`, `monto_total_retenido`, `impuestos_retenidos jsonb`, `estado_sat`, `xml_file_id`, `raw_payload`, plumbing.

#### `syntage_tax_returns` — declaraciones mensuales + anuales
Campos: `syntage_id`, `taxpayer_rfc`, `odoo_company_id`, `return_type` (monthly/annual/rif), `ejercicio`, `periodo`, `impuesto` (ISR/IVA/IEPS), `fecha_presentacion`, `monto_pagado`, `tipo_declaracion` (normal/complementaria), `numero_operacion`, `pdf_file_id`, `raw_payload`, plumbing.

#### `syntage_tax_status` — Opinión de Cumplimiento + Constancia Fiscal
Campos: `syntage_id`, `taxpayer_rfc`, `odoo_company_id`, `target_rfc`, `fecha_consulta`, `opinion_cumplimiento` (positiva/negativa/sin_opinion), `regimen_fiscal`, `domicilio_fiscal jsonb`, `actividades_economicas jsonb`, `pdf_file_id`, `raw_payload`, plumbing.

Índice: `(target_rfc, fecha_consulta DESC)`.

#### `syntage_electronic_accounting` — balanzas + catálogo + pólizas
Campos: `syntage_id`, `taxpayer_rfc`, `odoo_company_id`, `record_type` (balanza/catalogo_cuentas/polizas), `ejercicio`, `periodo`, `tipo_envio`, `hash`, `xml_file_id`, `raw_payload`, plumbing.

### 4.2 Tres tablas de plumbing

#### `syntage_taxpayers`
`rfc PK`, `person_type` (physical/legal), `name`, `registration_date`, `raw_payload`, `created_at`.

#### `syntage_extractions`
`syntage_id PK`, `taxpayer_rfc`, `odoo_company_id`, `extractor_type`, `options jsonb` (rango, filtros), `status` (pending/running/finished/failed), `started_at`, `finished_at`, `rows_produced`, `error`, `raw_payload`.

#### `syntage_files`
`id PK`, `syntage_id UNIQUE`, `taxpayer_rfc`, `odoo_company_id`, `file_type` (cfdi_xml/cfdi_pdf/retention_xml/tax_return_pdf/...), `filename`, `mime_type`, `size_bytes`, `storage_path` (bucket `syntage-files/<taxpayer_rfc>/<yyyy>/<mm>/<uuid>.xml`), `download_url_cached_until`, `raw_payload`.

### 4.3 `syntage_entity_map` — mapeo multi-tenant

| Campo | Tipo | Notas |
|---|---|---|
| `taxpayer_rfc` | text PK | RFC real |
| `odoo_company_id` | int UNIQUE | FK a empresa Odoo correspondiente |
| `alias` | text | Legible (`'Quimibond Industrial'`) |
| `is_active` | bool | Permite pausar ingesta |
| `backfill_from` | date | Default: `registrationDate` del SAT |
| `priority` | text | `'primary'` / `'secondary'` |
| `created_at`, `updated_at` | timestamptz | |

**Fuente única de verdad** para multi-tenant. Cualquier taxpayer no mapeado aquí se rechaza en el webhook handler (sync_failure con `error_code='unmapped_taxpayer'`).

## 5. Layer 3 — Vistas Unificadas y Reconciliación

### 5.1 Matching strategy

**Nivel 1 (autoritativo):** `syntage.uuid = odoo.cfdi_uuid AND syntage.odoo_company_id = odoo.company_id`.

**Nivel 2 (fallback compuesto, solo si falta UUID):**
```sql
lower(coalesce(syntage.emisor_rfc, syntage.receptor_rfc)) = lower(odoo.partner_vat)
AND abs(syntage.total - odoo.amount_total) < 0.01
AND date(syntage.fecha_emision) = date(odoo.invoice_date)
AND (coalesce(syntage.serie, '') = coalesce(odoo.ref, '') OR coalesce(syntage.folio, '') = coalesce(odoo.ref, ''))
AND syntage.odoo_company_id = odoo.company_id
```

Algoritmo implementado en `refresh_invoices_unified()`. Clasificación de resultados: `match_uuid`, `match_composite`, `syntage_only`, `odoo_only`, `ambiguous`.

### 5.2 `invoices_unified` (vista materializada, refresh 15min)

Cada row = una factura canónica. Campo por campo:

**Fiscales (autoridad Syntage):** `uuid_sat`, `estado_sat`, `fecha_cancelacion`, `fecha_timbrado`, `tipo_comprobante`, `metodo_pago`, `forma_pago`, `uso_cfdi`, `emisor_rfc`, `receptor_rfc`, blacklist flags 69-B, `total_fiscal`, `impuestos_*`.

**Operativos (autoridad Odoo):** `odoo_partner_id`, `company_id`, `salesperson_name/user_id`, `payment_state`, `amount_residual`, `due_date`, `odoo_state`, `days_overdue`, `odoo_ref`, `journal_id`.

**Derivado:** `fiscal_operational_consistency` ∈ {`consistent`, `cancelled_but_posted`, `posted_but_sat_cancelled_in_odoo`, `sat_uncertified`}.

**Evidencia:** `email_id_origen` (join a `email_cfdi_links`).

Índices: `canonical_id` unique, `(company_id, fecha_timbrado DESC)`, `(match_status)`, `(fiscal_operational_consistency)`, `(estado_sat) WHERE estado_sat='cancelado'`.

JOIN crítico con filtro `syntage.odoo_company_id = odoo.company_id` para prevenir cross-company leakage.

### 5.3 `payments_unified` (materializada)

Cruza `syntage_invoice_payments` (Tipo P) con `odoo_account_payments`.

**Syntage manda:** `uuid_complemento`, `fecha_pago` (real SAT), `forma_pago_p`, `num_operacion`, `doctos_relacionados`.

**Odoo manda:** `journal_id`, `company_id`, `partner_id` canónico, `reconciled`, `payment_method_line_id`.

Match primario por `num_operacion` ↔ `odoo_account_payments.ref`; fallback por `(partner_vat, amount, date, currency)`. Siempre filtro `odoo_company_id` match.

### 5.4 `reconciliation_issues` (tabla)

Poblada por `refresh_invoices_unified()`. Cada discrepancia detectada = row.

Campos: `issue_id uuid PK`, `issue_type`, `canonical_id`, `uuid_sat`, `odoo_invoice_id`, `company_id`, `description`, `severity` (critical/high/medium/low), `detected_at`, `resolved_at`, `resolution`, `metadata jsonb`.

Unique constraint: `(issue_type, canonical_id) WHERE resolved_at IS NULL` — dedup estructural.

**Tipos de issue:**

| `issue_type` | Qué significa |
|---|---|
| `cancelled_but_posted` | Syntage cancelado, Odoo sigue posted |
| `posted_but_sat_uncertified` | Odoo posted sin UUID >24h |
| `sat_only_cfdi_received` | CFDI recibido en SAT no capturado en Odoo |
| `sat_only_cfdi_issued` | CFDI emitido en SAT no existe en Odoo (crítico) |
| `amount_mismatch` | Match UUID pero totales difieren >0.01 |
| `partner_blacklist_69b` | Proveedor con status presumed/definitive |
| `sat_opinion_negative` | Proveedor con opinión negativa |
| `payment_missing_complemento` | Pago PPD en Odoo sin Tipo P en Syntage |
| `complemento_missing_payment` | Tipo P en Syntage sin pago en Odoo |

Auto-resolución cuando deja de aplicar (ej. Odoo se actualiza): `resolved_at` poblado, `resolution='auto_odoo_updated'`.

### 5.5 `partners_unified` (columnas enriquecidas sobre `companies`)

Agrega: `sat_opinion_cumplimiento`, `blacklist_69b_status` (peor entre CFDIs recientes), `actividades_economicas`, `domicilio_fiscal_sat`. Se implementa como vista derivada o columnas computadas sobre `companies`.

## 6. Flujo operacional

### 6.1 Webhook receiver

**Endpoint:** `POST /api/syntage/webhook` en Vercel.

**Configuración Syntage (one-time):** `POST /webhook-endpoints` suscrito a: `credential.*`, `link.*`, `extraction.*`, `invoice.*` (created/updated/deleted), `invoice_line_item.*`, `invoice_payment.*`, `tax_retention.*`, `tax_return.*`, `tax_status.*`, `electronic_accounting_record.*`, `file.created`.

**Flujo (<3s, timeout Syntage):**

```
1. Validar HMAC (X-Syntage-Signature + SYNTAGE_WEBHOOK_SECRET) → 401 si falla
2. Parse body → { id, type, taxpayer, resource, data }
3. Idempotencia: INSERT INTO syntage_webhook_events ON CONFLICT DO NOTHING; si duplicado, return 200
4. Verificar syntage_entity_map.is_active para event.taxpayer.id → si no mapeado, sync_failure + 200
5. ingestion.start_run('syntage', table, 'event', 'webhook') → run_id
6. Dispatch por event.type:
   - invoice.created/updated  → upsert_syntage_invoice
   - invoice.deleted          → estado_sat='cancelado', fecha_cancelacion=now()
   - invoice_payment.created  → upsert_syntage_invoice_payment
   - file.created             → enqueue_file_download (async)
   - ... (resto de tipos)
7. ingestion.complete_run(run_id, 'success') → 200 OK
```

**Errores no-retriables** (parse_error, schema_mismatch): `sync_failure` + 200 a Syntage.
**Errores retriables** (5xx Supabase): 500 a Syntage → reintenta hasta 5x con backoff.

### 6.2 File download (async)

`file.created` inserta `syntage_files` + row en `file_download_queue`. `pg_cron` cada minuto procesa queue: download signed URL → Supabase Storage → update `storage_path` + FK en tabla destino (ej. `syntage_invoices.xml_file_id`).

Prioridad: XML > PDF. Retry hasta 3 veces con URL refresh.

### 6.3 Reconciliation sweep (cada 6h)

Endpoint `/api/syntage/reconcile`:

```
1. since = last successful run timestamp
2. GET /events?createdAt[gte]=since (paginate, Syntage retiene 7d)
3. Para cada evento:
   - Si NOT IN syntage_webhook_events → reprocesar via mismo dispatch
   - Marcar source='reconcile'
4. ingestion.complete_run con rows_succeeded=reprocessed_count
```

Auto-healing de webhooks perdidos.

### 6.4 Backfill histórico (one-off)

Script `scripts/syntage-backfill.ts`:

```
1. SELECT * FROM syntage_entity_map WHERE is_active = true ORDER BY priority='primary' DESC
2. For each entity:
   a. GET /taxpayers/{rfc} → verificar existe (registrationDate como lower bound)
   b. backfill_start = max(registrationDate, today - 5 years)
   c. Dry-run: lista N extractions proyectadas + estimado de costo
   d. Confirmación interactiva (y/n)
3. Procesar entidad x entidad, mes x mes:
   - POST /extractions { taxpayer, extractor: 'invoice', options: {from, to, received, issued} }
   - POST /extractions { extractor: 'tax_retention', ... }
   - POST /extractions { extractor: 'monthly_tax_return', ... }
4. Checkpointing en syntage_backfill_progress (taxpayer_rfc, year, month, extractor_type, status)
5. Resumable: re-run detecta meses ya `finished` y solo dispara faltantes
6. Al terminar: refresh_invoices_unified() + reporte de cobertura
```

Todos los datos entran por el mismo webhook handler en steady state — no hay código "especial de backfill".

### 6.5 Observabilidad

Tres dashboards en `/system`:

- **`/system/syntage`** — último webhook (verde/amarillo/rojo), counts 24h por tipo, file download queue, extractions en curso, reconcile status.
- **`/system/ingestion`** — expandir existente para mostrar `source_id='syntage'` con SLAs por tabla (invoices 15min, payments 15min, tax_status 24h, e-accounting 30d).
- **`/system/reconciliation`** — counts por `issue_type` no resueltos, top 10 empresas con más issues, auto-resolution rate 7d.

### 6.6 Error modes

| Modo | Detección | Fallback |
|---|---|---|
| Vercel down | Syntage retries + reconcile 6h | Recovery automático |
| Syntage API down | Staleness en `/system/syntage` | Odoo y Gmail siguen |
| Credential expirada | `credential.update` status=invalid | `sla_breach` + alerta CEO |
| Webhook firma inválida | 401 | `sync_failure` error_code='auth_failure' |
| Duplicate event_id | ON CONFLICT DO NOTHING | Idempotente |
| Schema mismatch | `raw_payload` lo captura | No rompe, ajuste en próxima migración |
| File download falla | `retry_count++` | Refresh signed URL, 3 intentos |
| Evento perdido por webhook | `reprocessed_count > 0` | Insight a Data Quality IA |

## 7. Migración de `cfdi_documents` → `email_cfdi_links`

### 7.1 Schema de destino

Nueva tabla `email_cfdi_links`:

| Campo | Tipo |
|---|---|
| `id` | bigint PK |
| `email_id` | bigint FK → `emails` |
| `gmail_message_id` | text |
| `account` | text |
| `uuid` | text FK → `syntage_invoices.uuid` |
| `linked_at` | timestamptz |

Índices: `(uuid)`, `(email_id)`.

### 7.2 Proceso

1. Verificar cobertura: query confirma todos los UUIDs de `cfdi_documents` existen en `syntage_invoices` (si no, investigar antes de migrar).
2. Crear `email_cfdi_links`.
3. `INSERT INTO email_cfdi_links SELECT email_id, gmail_message_id, account, uuid, parsed_at FROM cfdi_documents WHERE uuid IS NOT NULL`.
4. Apagar cron `parse-cfdi` (remover de `vercel.json`).
5. Endpoint `/api/pipeline/parse-cfdi` → responder 410 Gone por 30d.
6. Rename `cfdi_documents` → `cfdi_documents_deprecated_20260416`; drop tras 30d sin writes.
7. Actualizar queries frontend (`src/lib/queries/invoice-detail.ts`, `src/components/shared/v2/invoice-detail.tsx`) para leer `invoices_unified` en lugar de `cfdi_documents`.

## 8. Rollout por fases

### Fase 0 — Pre-requisitos

- Cuenta Syntage (Production + Sandbox) con API keys
- Identificación manual de N entidades Quimibond con `odoo_company_id` correspondientes
- Secret HMAC compartido
- Bucket Supabase Storage `syntage-files` con RLS service-role-only
- Env vars Vercel: `SYNTAGE_API_KEY`, `SYNTAGE_WEBHOOK_SECRET`, `SYNTAGE_API_BASE`

### Fase 1 — Plumbing (2-3 días, invisible al usuario)

- Migración SQL: 7 tablas de datos + 3 de plumbing + `syntage_entity_map` = 11 tablas `syntage_*` + triggers auto-link + RLS
- Ampliar `ingestion.source_registry` con 7 rows para `source_id='syntage'` (una por tabla de datos)
- Endpoint `/api/syntage/webhook` con validación + idempotencia + dispatch
- Populate `syntage_entity_map` con N entidades
- Test E2E sandbox: 10 webhooks simulados procesados

**Gate:** 10 webhooks sandbox procesados. Rows con `odoo_company_id` poblado. `sync_failure=0`.

### Fase 2 — Onboarding Producción (medio día)

- Para cada entidad: `POST /taxpayers` + `POST /credentials` (CIEC)
- Esperar `credential.update` status=valid
- Verificar dashboard Syntage

**Gate:** todas las entidades con status=valid.

### Fase 3 — Forward Sync Activo (1 día + 48h vigilancia)

- Habilitar `first_time_scheduler` en Syntage (mes corriente)
- Syntage emite `invoice.created` — flujo real-time activo
- Refresh `invoices_unified` cada 15min vía pg_cron
- Monitorear `/system/syntage` 48h

**Gate:** `sync_failure=0`, reconcile 0 eventos perdidos, `invoices_unified.match_status='match_uuid'` para facturas recientes.

### Fase 4 — Backfill Histórico (1-5 días según volumen)

- `scripts/syntage-backfill.ts --dry-run` → aprobación explícita costo
- Ejecución con checkpointing
- Al terminar: refresh completo + reporte cobertura

**Gate:** todas entidades con backfill `completed`. `count(invoices_unified) ≈ count(odoo_invoices) ± 5%`. Top 5 `issue_type` triaged.

### Fase 5 — Deprecación `parse-cfdi` (medio día)

- Verificar cobertura UUIDs `cfdi_documents ⊆ syntage_invoices`
- Crear `email_cfdi_links`, migrar datos
- Apagar cron `parse-cfdi`, endpoint → 410
- Rename `cfdi_documents` → `_deprecated_20260416`
- Actualizar queries frontend → `invoices_unified`

**Gate:** `cfdi_documents_deprecated` sin writes 7d. Frontend sin regresiones visuales. Todos UUIDs históricos en `email_cfdi_links`.

### Fase 6 — Exponer a Directores IA (2-3 días)

- Actualizar prompts: Finance, Risk, Compras incluyen `invoices_unified` como autoritativo
- Risk queries `reconciliation_issues` (prioriza critical/high)
- Compras usa `syntage_tax_status` para scoring
- Finance usa `syntage_invoice_payments.fecha_pago` para predicciones
- Candidate: Director Compliance IA nuevo
- Insights enriquecidos con UUID + estado_sat

**Gate:** directores citan evidencia SAT en insights. `reconciliation_issues` resolved_at rate >60% en 7d.

## 9. Criterios de éxito (90 días post-rollout)

| Métrica | Hoy | Objetivo 90d |
|---|---|---|
| Facturas Odoo con UUID SAT verificable | 54% | >95% |
| CFDIs recibidos matcheados a Odoo | ~5% | >90% |
| Cancelaciones CFDI detectadas en <24h | 0% | >99% |
| Complementos Tipo P trackeados | 0 | todos los PPD |
| Proveedores con `sat_opinion_cumplimiento` conocida | 0 | 100% activos |
| `reconciliation_issues` resolution rate (7d) | n/a | >60% |
| Directores IA citando evidencia SAT en insights | 0% | >50% financieros |

## 10. Estrategia de Rollback

Cada fase reversible en <1h:

- **Fase 1-2:** drop tablas `syntage_*`, remover endpoint, revertir env vars.
- **Fase 3:** pausar webhooks en Syntage dashboard. Vistas unified congeladas pero sirven.
- **Fase 4:** backfill no rompe nada; truncate `syntage_*` y re-run si necesario.
- **Fase 5:** `cfdi_documents_deprecated` mantenido 30d; rename back si problemas; reactivar `parse-cfdi`.
- **Fase 6:** revertir prompts (git). Datos siguen fluyendo.

**Red de seguridad:** durante fases 1-4, Odoo y Gmail siguen intactos como fuentes operativas. Solo en Fase 6 directores razonan sobre datos SAT; revertir prompts no quita datos.

## 11. Qué este documento NO es

- **No es un plan de implementación.** El próximo paso es `writing-plans` que generará tareas granulares.
- **No decide pricing con Syntage.** Eso se confirma antes de Fase 4 en la aprobación del dry-run.
- **No fija fechas absolutas.** Las fases tienen estimaciones ("2-3 días"), no deadlines.
- **No diseña UI nueva.** Los dashboards `/system/syntage` y `/system/reconciliation` se diseñan en Fase 3 con más detalle.
- **No es inmutable.** Si durante implementación Syntage expone un evento/endpoint no cubierto aquí, se revisa el spec.

## 12. Referencias

- [Syntage — Integration Flow](https://docs.syntage.com/guides/integration-flow)
- [Syntage — Events](https://docs.syntage.com/api-reference/events/list-all-events)
- [Syntage — Extractions](https://docs.syntage.com/api-reference/extractions)
- [Syntage — Navigation](https://docs.syntage.com/llms.txt)
- `docs/superpowers/specs/2026-04-12-flujo-datos-vision-ideal.md` (visión padre)
- `docs/superpowers/specs/2026-04-12-fase-0-ingestion-core-design.md` (ingestion core que reusamos)
