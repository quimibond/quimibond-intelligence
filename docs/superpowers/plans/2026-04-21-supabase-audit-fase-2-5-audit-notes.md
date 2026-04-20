# Supabase Audit — Fase 2.5 Unificación: Notas de Auditoría

Fecha captura: 2026-04-20  
Branch: `fase-2-5-unificacion`  
Proyecto Supabase: `tozqezmivpblmcubmnpi`

---

## Antes

Snapshot pre-flight capturado antes de cualquier cambio de Fase 2.5.

### Q1 — Bridge metrics (Odoo ↔ Syntage gap)

| Métrica | Valor |
|---|---|
| total_odoo (odoo_invoices) | 27,760 |
| odoo_with_uuid | 13,985 |
| total_syntage (syntage_invoices) | 129,690 |
| syntage_issued_unmatched_2021 | 42,539 |
| odoo_customer_no_uuid_2021 | 5,251 |
| invoices_unified_rows | 96,502 |
| issues_open (reconciliation_issues) | 44,629 |

**Observaciones:**
- Solo el 50.4% de odoo_invoices tiene cfdi_uuid → 13,975 facturas Odoo sin link fiscal.
- 42,539 facturas emitidas en Syntage (≥2021) sin match a Odoo → backlog de reconciliación pendiente.
- 44,629 issues abiertos en reconciliation_issues.

---

### Q2 — Products mapping

| Métrica | Valor |
|---|---|
| products_total (odoo_products) | 7,211 |
| distinct_refs_min4 (internal_ref ≥ 4 chars) | 5,991 |
| syntage_lines (syntage_invoice_line_items) | 181,059 |

**Observaciones:**
- 1,220 productos sin internal_ref usable (< 4 chars o NULL) → sin clave para mapping fiscal.
- 181,059 líneas en Syntage pendientes de asociación a productos Odoo.

---

### Q3 — Orders

| Métrica | Valor |
|---|---|
| sale_orders | 12,353 |
| purchase_orders | 5,669 |
| order_lines_total | 32,058 |

---

### Q4 — Persons

| Métrica | Valor |
|---|---|
| contacts_total | 1,894 |
| users_total (odoo_users) | 40 |
| employees_total (odoo_employees) | 164 |
| employees_without_contact | 139 |

**Observaciones:**
- 139 de 164 empleados (84.8%) no tienen contacto correspondiente en `contacts` por email → persona unificada incompleta.

---

### Q5 — Analytics wrappers (pre-drop candidates)

| viewname | def_len |
|---|---|
| analytics_finance_cash_position | 113 |
| analytics_revenue_operational_monthly | 138 |
| analytics_finance_income_statement | 159 |
| analytics_customer_cancellation_rates | 174 |
| analytics_finance_working_capital | 206 |
| analytics_revenue_fiscal_monthly | 232 |
| analytics_product_fiscal_line_analysis | 245 |
| analytics_finance_cfo_snapshot | 266 |
| analytics_supplier_fiscal_lifetime | 268 |
| analytics_customer_fiscal_lifetime | 290 |
| analytics_supplier_360 | 1,949 |
| analytics_customer_360 | 2,378 |

**Total:** 12 vistas `analytics_*` existentes antes de Fase 2.5.  
Las vistas con `def_len` pequeño (< 300) son wrappers triviales sobre otras vistas/tablas — candidatas a drop o reemplazo. `analytics_customer_360` y `analytics_supplier_360` tienen definiciones sustanciales (≥ 1,949 chars) — requieren revisión antes de drop.

---

## Después

_Pendiente — se llenará al completar Fase 2.5._
