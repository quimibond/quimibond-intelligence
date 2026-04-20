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

## Después (cierre 2026-04-20)

### Nuevos objetos

- **Tablas (3):** invoice_bridge_manual, payment_bridge_manual, products_fiscal_map
- **Views (4):** invoice_bridge, orders_unified, order_fulfillment_bridge, person_unified
- **Materialized views (2):** products_unified, product_price_history (refreshed en cron 2h)
- **Funciones (4):** reconcile_invoice_manually, reconcile_payment_manually, match_unlinked_invoices_by_composite, trg_backfill_contact_from_employee (trigger fn)

### Verificación de objetos (query post-cierre)

| Objeto | Esperado | Resultado |
|---|---|---|
| new_tables (3) | 3 | 3 |
| new_views (4) | 4 | 4 |
| new_mvs (2) | 2 | 2 |
| new_fns (4) | 4 | 4 |
| dropped_wrappers_remaining | 0 | 0 |

### Bridge op↔fiscal (invoice_bridge)

| Métrica | Valor |
|---|---|
| Total filas en bridge | 96,495 |
| Matched por UUID (uuid_exact) | 15,811 |
| Gap: missing en SAT | 11,820 |
| Gap: missing en Odoo | 20,903 |

### Productos

- **products_fiscal_map** seeded: 20 SKUs top-revenue (19 → UNSPSC 11161800 Tela de punto, 1 → 11162201 Tela no tejida). Cobertura ~113M MXN / 70% revenue 12m.
- **products_unified** total: 6,212 productos; 20 con sat_revenue_mxn_12m > 0 (los 20 con fiscal_map entries).

### Price history

- **product_price_history:** 29,779 filas, 3,673 productos distintos. Rango 2021-07 → 2026-04. Sources: order_sale, order_purchase, invoice_sale, invoice_purchase.

### Personas (person_unified)

| Rol | Count |
|---|---|
| external (contacts) | 1,882 |
| employee | 150 |
| user | 29 |
| **Total** | **2,061** |

### Poda Fase D (parcial — Option A)

- 2 wrappers dropeados: `analytics_revenue_fiscal_monthly`, `analytics_revenue_operational_monthly` (0 callers confirmados)
- 4 wrappers diferidos a Fase 2.5.1: analytics_finance_cfo_snapshot, analytics_finance_income_statement, analytics_finance_working_capital, analytics_finance_cash_position — tienen callers en frontend

### Pendientes Fase 2.5.1 (follow-up)

- Migrar 4 callsites de `analytics_finance_*` a views base (`cash_position`, `cfo_dashboard`, `pl_estado_resultados`, `working_capital`) y luego drop.
- Task 13 (`monthly_revenue_unified`) — skipped; poca ganancia relativa.
- Fix addon `_build_cfdi_map` (M2M bug documentado en memoria: asigna UUID del complemento a todas sus facturas cubiertas).

### Commits Fase 2.5 (branch `fase-2-5-unificacion`, 13 commits)

| SHA | Descripción |
|---|---|
| `4c006e2` | Task 0: pre-flight baseline snapshot |
| `5387566` | Task 1: invoice_bridge view + invoice_bridge_manual + payment_bridge_manual |
| `805aec2` | Task 2: reconcile_invoice_manually() function |
| `fb8c4d0` | Task 3: match_unlinked_invoices_by_composite() diagnostic function |
| `6f2e8b8` | Task 4: reconcile_payment_manually() function |
| `18bdddc` | Task 5: products_fiscal_map table + seed top 20 SKUs |
| `5a26b72` | Task 6: products_unified MV |
| `29d698d` | Task 7: product_price_history MV + add to refresh_all_matviews |
| `5af918d` | Task 8: orders_unified view |
| `d96fb9e` | Task 9: order_fulfillment_bridge view |
| `fcb2731` | Task 10: person_unified view |
| `907cf29` | Task 11: backfill_contact_from_employee trigger + backfill (+139 contacts) |
| `7299425` | Task 12a: drop 2 unused analytics_* thin wrappers |

Pending merge a main — user deploya manualmente.
