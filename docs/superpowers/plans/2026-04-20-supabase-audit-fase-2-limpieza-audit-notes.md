# Fase 2 Limpieza — Audit Notes

**Plan:** `docs/superpowers/plans/2026-04-20-supabase-audit-fase-2-limpieza.md`
**Supabase project:** `tozqezmivpblmcubmnpi`

## Antes (baseline 2026-04-20)

### 1. Row counts

| tbl | count |
|-----|------:|
| budgets | 0 |
| chat_memory | 0 |
| revenue_metrics | 7,349 |
| employee_metrics | 34 |
| agent_insights_archive_pre_fase6 | 529 |
| odoo_payments | 53,684 |
| odoo_account_payments | 17,856 |

### 2. Duplicados actuales en `odoo_invoices.cfdi_uuid`

20 UUIDs con duplicados (top 20 mostrados; la query tiene `LIMIT 20`):

| cfdi_uuid | n |
|-----------|--:|
| 8ce56da4-b745-428a-badd-96e1306af29d | 38 |
| f2ea9dc0-9cd9-4c3e-a69d-8353397cb45b | 36 |
| 8839ee58-5df8-46f9-8b43-da99b24ca1f5 | 30 |
| c68c7998-2eaa-44bf-b843-b5d483911eca | 29 |
| 33097732-df4e-4419-ace4-74bb789b6923 | 29 |
| 03dd0662-c7a9-45ee-8387-4a36cbdfd534 | 23 |
| 9c4fce12-60cb-4a83-a7dd-1601dab77b14 | 22 |
| 9b1e3a04-9867-4b00-98bc-5cd0c68ed86d | 21 |
| a915cab2-72f7-410a-a02e-c76a7649afdc | 21 |
| 6ed76fa4-ae86-4667-b2ee-da128d9c709b | 20 |
| 4a14f5a3-7cca-406f-b059-b45390e870db | 19 |
| 8e75fd5b-d92b-4fef-8193-ec26e20bc805 | 18 |
| 8eeadd0a-082a-4e86-b5da-3f95fb6bf716 | 18 |
| e8fed9cf-3c37-40ab-b8a3-7420bc0c4c01 | 18 |
| b428a80f-4333-4c71-8b8a-03fa0327970d | 16 |
| de9838e7-b3b8-4d64-a936-067c7ff58b89 | 16 |
| 950aa824-2449-4932-aaa4-2f3a3274ef31 | 16 |
| 04b60eaf-a539-4f8a-9a14-2dc396057872 | 15 |
| fada3783-f5f3-461e-b568-f3657d58e07a | 15 |
| 7eb8001b-e86d-43e0-8f3f-357b025c30e2 | 15 |

### 3. Triggers objetivo

| event_object_table | trigger_name | action_timing | event_manipulation |
|--------------------|--------------|---------------|--------------------|
| odoo_bank_balances | trg_set_updated_at | BEFORE | UPDATE |
| odoo_bank_balances | trg_touch_updated_at | BEFORE | UPDATE |
| odoo_invoice_lines | trg_auto_link_invoice_line_company | BEFORE | INSERT |
| odoo_invoice_lines | trg_auto_link_invoice_line_company | BEFORE | UPDATE |
| odoo_invoice_lines | trg_link_invoice_line_company | BEFORE | INSERT |
| odoo_invoice_lines | trg_resolve_invoice_line_company | BEFORE | INSERT |
| odoo_invoice_lines | trg_resolve_invoice_line_company | BEFORE | UPDATE |
| odoo_invoice_lines | trg_touch_synced_at | BEFORE | UPDATE |
| odoo_order_lines | trg_resolve_order_company | BEFORE | INSERT |
| odoo_order_lines | trg_resolve_order_company | BEFORE | UPDATE |
| odoo_order_lines | trg_resolve_order_line_company | BEFORE | INSERT |
| odoo_order_lines | trg_resolve_order_line_company | BEFORE | UPDATE |
| odoo_products | trg_set_updated_at | BEFORE | UPDATE |
| odoo_products | trg_touch_updated_at | BEFORE | UPDATE |
| odoo_users | trg_set_updated_at | BEFORE | UPDATE |
| odoo_users | trg_touch_updated_at | BEFORE | UPDATE |

### 4. Firmas de funciones duplicadas

| proname | args |
|---------|------|
| get_contact_health_history | p_contact_id bigint, p_days integer |
| get_contact_health_history | p_contact_email text, p_days integer |
| get_volume_trend | _(ninguno)_ |
| get_volume_trend | p_days integer |
| match_emails_to_companies_by_domain | batch_size integer |
| match_emails_to_companies_by_domain | _(ninguno)_ |
| match_emails_to_contacts_by_email | _(ninguno)_ |
| match_emails_to_contacts_by_email | batch_size integer |

## Después (cierre de Fase 2 — 2026-04-20)

### 1. Row counts / table existence

| tbl | exists | rows |
|-----|--------|-----:|
| budgets | **false** (dropped) | — |
| chat_memory | **false** (dropped) | — |
| revenue_metrics | **false** (dropped) | — |
| employee_metrics | **false** (dropped) | — |
| agent_insights_archive_pre_fase6 | **false** (dropped) | — |
| odoo_payments | true (GATED — pending deploy) | — |
| odoo_account_payments | true | 17,856 |

Note: `odoo_payments` still exists — Task 13 (DROP TABLE) is gated until user deploys frontend + qb19 to prod so the cron stops writing to it.

### 2. Duplicados actuales en `odoo_invoices.cfdi_uuid`

**0 duplicados.** UNIQUE partial index `uq_odoo_invoices_cfdi_uuid` rechaza duplicados futuros.

(5,321 rows con UUID bogus archivadas a `odoo_invoices_archive_dup_cfdi_uuid_2026_04_20`; `cfdi_uuid` NULeado en live. Root cause: `_build_cfdi_map` asigna UUID del complemento de pago a todas las facturas cubiertas — ver `project_cfdi_uuid_bug_2026_04_20.md`.)

### 3. Triggers objetivo — post consolidación

| event_object_table | trigger_name | action_timing | event_manipulation |
|--------------------|--------------|---------------|--------------------|
| odoo_bank_balances | trg_set_updated_at | BEFORE | UPDATE |
| odoo_invoice_lines | trg_resolve_invoice_line_company | BEFORE | INSERT |
| odoo_invoice_lines | trg_resolve_invoice_line_company | BEFORE | UPDATE |
| odoo_invoice_lines | trg_touch_synced_at | BEFORE | UPDATE |
| odoo_order_lines | trg_resolve_order_line_company | BEFORE | INSERT |
| odoo_order_lines | trg_resolve_order_line_company | BEFORE | UPDATE |
| odoo_products | trg_set_updated_at | BEFORE | UPDATE |
| odoo_users | trg_set_updated_at | BEFORE | UPDATE |

Antes: 16 filas (6 duplicados/redundantes). Después: 8 filas. Eliminados: `trg_touch_updated_at` (×3), `trg_auto_link_invoice_line_company`, `trg_link_invoice_line_company`, `trg_resolve_order_company`.

### 4. Firmas de funciones — post dedup

| proname | args |
|---------|------|
| get_contact_health_history | p_contact_id bigint, p_days integer |
| get_volume_trend | p_days integer |
| match_emails_to_companies_by_domain | batch_size integer |
| match_emails_to_contacts_by_email | batch_size integer |

Antes: 8 filas (4 funciones × 2 firmas). Después: 4 filas (1 firma canónica por función). Firmas eliminadas: sin parámetros de `get_volume_trend`, `match_emails_*`; `p_contact_email text` de `get_contact_health_history`.

### 5. Extra cleanup summary

- Legacy tables dropped: **5** (budgets, chat_memory, revenue_metrics, employee_metrics, agent_insights_archive_pre_fase6)
- Legacy views dropped: **2** (budget_vs_actual, analytics_budget_vs_actual)
- Legacy functions dropped: **6** (populate_revenue_metrics, calculate_employee_metrics, get_employee_dashboard, touch_updated_at, auto_link_invoice_line_company, auto_resolve_order_line_company)
- CFDI archive rows: **5,321** (preservadas en `odoo_invoices_archive_dup_cfdi_uuid_2026_04_20` para forensics)
- Migrations applied to prod Supabase: 12
- Frontend commits on `fase-2-limpieza`: 13 (pre-deploy)
- qb19 commits on `fase-2-limpieza`: 2 (pre-deploy)

Extra query confirma: `legacy_tables_remaining=0`, `legacy_views_remaining=0`, `legacy_functions_remaining=0`, `cfdi_archive_rows=5321` — todo como esperado.

### 6. Pendientes tras Fase 2

- **Task 13 (DROP odoo_payments)** — GATED. Bloqueado hasta que usuario deploya frontend + qb19 a prod (cron del addon sigue escribiendo hasta que se actualice)
- **Addon fix `_build_cfdi_map`** — documentado en `project_cfdi_uuid_bug_2026_04_20.md`; raíz: itera `doc.invoice_ids` en complemento de pago P → asigna UUID del pago a todas las facturas cubiertas
- **Bug pre-existente en `match_emails_*` fns** — bodies referencian columnas `from_address`/`from_email` que no existen en tabla emails (columna real: `sender`)
