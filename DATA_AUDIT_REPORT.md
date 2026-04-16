# Data Audit Report — Quimibond Intelligence Frontend

**Fecha:** 2026-04-16
**Scope:** 15 páginas · 90+ funciones de query · 60+ targets Supabase · 24 modelos Odoo sincronizados
**Método:** Inventario (Fase 1) + Auditoría dirigida por capa de datos (Fase 2) · SQL ejecutado contra `tozqezmivpblmcubmnpi`

---

## Resumen ejecutivo

De los 10 hotspots identificados en el inventario, **todos confirmados** más descubrimientos adicionales. El sistema tiene buena integridad en los totales agregados principales (AR, AP, revenue 12m, DSO/DPO/CCC) pero falla en **consistencia de presentación cross-page** y en **cobertura de sincronización de tablas de detalle**.

- **4 bugs CRITICAL** (bloqueo o silent corruption)
- **16 bugs HIGH** (el CEO ve números inconsistentes)
- **13 MEDIUM/WARNING**
- **6 INFO**

## Lo que SÍ está en sync (para evitar re-auditar)

| Concepto | Fuentes consistentes |
|---|---|
| AR total (CxC) | `odoo_invoices` · `cfo_dashboard` · `cash_flow_aging` · `working_capital_cycle` — todos $26,072,837 |
| AR vencida (cartera) | `odoo_invoices` · `cfo_dashboard` · `cash_flow_aging` · `getArAging` · `company_profile` · `get_dashboard_kpis` — todos $7,612,169 |
| AP total (CxP) | `odoo_invoices` · `cfo_dashboard` · `working_capital_cycle` — todos $23,860,171 |
| Deuda TC | `cfo_dashboard` · `projection` · `cash_position` — todos $55,808 (aunque mal clasificada, ver CRITICAL prior) |
| DSO/DPO/DIO/CCC | matemática consistente: `CCC = 47 + 95 − 62.5 = 79.6` ✓ |
| Self-company exclusion | aplicado en TODAS las queries de sales/invoices/dashboard; MVs principales (rfm, revenue_concentration) no tienen filas self |
| Order lines sign convention | 20,959 sale con id positivo; 11,054 purchase con id negativo — zero leakage |
| FK integrity `agent_insights` | 0 FKs rotos |
| Severity/state enums | DB values coinciden con TS types |

---

## CRITICAL — requieren fix inmediato

| # | Ubicación | Problema | Fix |
|---|---|---|---|
| C1 | `cashflow-recommendations.tsx:133` | `apOverdueCoverageRatio` se multiplica ×100 (RPC ya devuelve %) → hint dice **"1800% cubierto por cash"** | `const coverage = (metrics.apOverdueCoverageRatio ?? 0) / 100;` **(ya en fix otra sesión)** |
| C2 | View `cash_position` (qb19) | Tarjeta Jeeves (−$55,808) etiquetada `tipo='bank'` → UI dice "Banco" en lugar de "Tarjeta" | Corregir `tipo='credit'` en la view cuando el journal es TC **(ya en fix otra sesión)** |
| C3 | RPC `get_dashboard_kpis` (DB-side), shown on `/` `page.tsx:159` | Dashboard re-convierte USD→MXN con **`17.4` hardcoded**, ignorando `current_balance_mxn` ya calculado por sync con FX real. Produce 3 FX rates simultáneas en el sistema (17.27 live, 17.4 hardcoded, 17.69 stored). Total cash (4,165,138) no coincide con ninguna otra view. | Reemplazar el literal 17.4 por `SUM(COALESCE(current_balance_mxn, current_balance))`; misma fórmula que `cfo_dashboard.efectivo_total_mxn` |
| C4 | `src/lib/queries/contacts.ts:58,143` + `/contacts/page.tsx:400` | `getContactsPage` y `getContactDetail` SELECT columnas **no existen** en la tabla `contacts`: `company, phone, position, notes`. PostgREST devuelve `400`. **`/contacts` y `/contacts/[id]` están rotas.** | Quitar columnas muertas del SELECT; en page.tsx cambiar `r.company` → `r.company_name` |

---

## HIGH — inconsistencias cross-page que el CEO ve

### Capa: Cash / Runway / Finanzas

| # | Ubicación | Problema | Fix |
|---|---|---|---|
| H1 | `/` `page.tsx:152-162` + `/finanzas:316` | Solo se muestra `runway_days_net=23d` (optimista, asume cobro de AR). `runway_days_cash_only=7d` (pesimista real) está en la view pero **no renderizado en ninguna página** | Exponer ambos: "23d net / 7d solo-efectivo" o cambiar default a cash-only |
| H2 | View `working_capital` | Usa `usd_to_mxn()` live (17.27) en vez de `current_balance_mxn` stored. Devuelve $4,141,649 vs `cfo_dashboard.efectivo_total_mxn` $4,218,436 — diff $76,787 solo por método FX | Rewrite CTE de cash: `SUM(COALESCE(current_balance_mxn, current_balance))` |
| H3 | View `cashflow_current_cash` classification | Regex `(payana\|aduana\|internacional)` clasifica Payana+Aduana como **restricted** Y como **in_transit** simultáneamente. $85,156 (in_transit) y $584,805 (restricted) se solapan | Definir tabla de clasificación `journal_id → bucket`, eliminar regex |
| H4 | `src/lib/queries/purchases.ts:99-101` + `/compras:379` | `pagosProv30d` se pasa **raw negativo** (−$25.1M) a KpiCard "Pagos 30d a proveedores". Se renderiza como `-$25.1M`, lee como pérdida, no como volumen de pagos | `pagosProv30d: Math.abs(Number(d.pagos_prov_30d) \|\| 0)` y estandarizar en `/finanzas:417` también |
| H5 | `account_payment_profile` MV | 342/342 filas con `account_code=''` vacío. Join con `odoo_chart_of_accounts.code` roto. `detected_category` sistemáticamente mal ("asset_other" en gastos de viaje, IVA acreditable) | Populate `account_code` desde `odoo_chart_of_accounts.code` via `odoo_account_id` FK. Reclasificar por `account_type`. |
| H6 | `financial_runway.runway_days_net` | Burn rate = SOLO salidas a supplier, excluye nómina ($1.81M/mes) y tax ($0.96M/mes). Burn real ≈ 806K/día, runway cash-only real ≈ **5 días**, no 7 | Incluir employee payments + tax outflows; o usar `totals_13w.outflows_gross/91` del projection |

### Capa: Partners / Companies

| # | Ubicación | Problema | Fix |
|---|---|---|---|
| H7 | `src/lib/queries/finance.ts:728` | **Partner Odoo admin (`odoo_partner_id=1`) ranking #1 inbound ($33.8M) Y #1 outbound ($32.9M)** en `/finanzas` partner payment profiles. No existe en `companies` → `partnerName=null` → renderiza "—" como top partner | `.not('odoo_partner_id', 'eq', 1)` o excluir en WHERE de la MV |
| H8 | `src/components/shared/v2/company-link.tsx:40` | `CompanyLink` renderiza `name ?? "—"` sin `sanitizeCompanyName`. Impacto: **193 empresas en `/companies` se muestran como "8141", "5806", "1139"** (numeric-only names leaked from res.partner.name) | Aplicar `sanitizeCompanyName` dentro de `CompanyLink` — un solo fix arregla todas las páginas |
| H9 | qb19 `_push_contacts` | 193 rows en `companies.name` son numéricos. Root cause: sync no valida `partner.name` antes de escribir | Si `name` es vacío/numérico: fallback a `commercial_partner_id.name` → `vat` → `email` → skip |

### Capa: Invoices / AR

| # | Ubicación | Problema | Fix |
|---|---|---|---|
| H10 | `/cobranza` mismo page | Hero renderiza 5 buckets (1-30/31-60/61-90/**91-120**/**120+**) via `getArAging`; Tabla de empresas renderiza 4 buckets (1-30/31-60/61-90/**90+**) via `cash_flow_aging`. Usuario ve "$3.5M en 120+" arriba pero la columna "90+" abajo suma $3.9M | Fix view: agregar columnas `overdue_91_120`, `overdue_120plus` desde `ar_aging_detail` (que ya tiene los 5); renderizar 5 columnas en CompanyAgingTable |
| H11 | qb19 `_push_invoice_lines` | **Solo 379 de 14,520 posted out_invoices (2.6%) tienen lines sincronizadas**. `/inbox/insight/[id]` drill-down y `getInvoiceByName` muestran "0 lines" para 97.4% de facturas | Auditar batching/pagination/filtro por fecha en el push method |
| H12 | `odoo_invoice_lines.price_subtotal_mxn` | FX roto: USD lines tienen `price_subtotal_mxn == price_subtotal` (no conversión). Algunas MXN lines tienen `price_subtotal_mxn ≠ price_subtotal`. Line-sum vs header diverge 5-50× | Fix FX en `_push_invoice_lines`; agregar assertion `SUM(lines._mxn) ≈ invoice.amount_untaxed_mxn` |

### Capa: Orders / Revenue

| # | Ubicación | Problema | Fix |
|---|---|---|---|
| H13 | `product_margin_analysis.gross_margin_pct` + `src/lib/queries/products.ts:437` | MV computa **markup** `(price-cost)/cost`, NO margen. Valores de **691%, 758%** se muestran en `/productos` como "margin %". `customer_margin_analysis` sí usa margen real (same data → 87% en esa página) | Redefinir columna de MV: `(price-cost)/price*100` o renombrar UI label a "Markup %" |
| H14 | `/ventas` SalesKpis vs RevenueChart | KPI "Ingresos del mes" usa `pl_estado_resultados`; chart debajo usa `monthly_revenue_by_company`. Para Mar-2026 difieren **$11M (79%)** — mismo label "ingresos" dos valores | Estandarizar una fuente: filtrar MRBC a invoices con `account_type='income'`, o cambiar chart a `pl_estado_resultados` |
| H15 | `monthly_revenue_by_company` + `customer_margin_analysis` | **Factura "leasing lepezo" INV/2026/03/0173 de $11.3M** (asset leasing, no venta de productos) infla MRBC, aparece en `/ventas` top customers con 100% margin ($17.2M 12m), aparece en company_profile como venta real | Excluir invoices cuyo GL no sea income; o excluir companies con `cost_source='none' AND margin_pct=100` en `/ventas` |
| H16 | Text-not-FK en `odoo_sale_orders.salesperson_name`, `odoo_invoices.salesperson_name`, `odoo_purchase_orders.buyer_name`, `odoo_activities.assigned_to` | **6,054 rows de facturas + 3,785 de SO + 651 de PO + 331 de activities referencian usuarios que NO existen en `odoo_users.name`.** Mismo usuario con 2 nombres distintos inflama leaderboards: `Jose Mizrahi Daniel` ($38M, orphan) + `Jose J. Mizrahi` ($27M, real) — **misma persona, dos filas en todo facet/top-5** | Agregar FK cols `salesperson_user_id`, `buyer_user_id`, `assigned_to_user_id` (SO/PO ya las tienen per CLAUDE.md — surface en frontend; agregar a invoices y activities) |
| H17 | `ops_delivery_health_weekly` | OTD = **100% todas las semanas**. `is_late` solo se define para pickings non-done. Completed-late count como on-time | Recomputar: `on_time = (date_done <= scheduled_date)` |

### Capa: Insights / Evidence

| # | Ubicación | Problema | Fix |
|---|---|---|---|
| H18 | `src/app/agents/[slug]/page.tsx:297` | `getInsights({limit:30}).filter(agent_id===)` aplica limit ANTES del filtro → **data loss 81-96% por agente**. `compras` muestra 1 de 27, `equipo` 2 de 22, `comercial` 2 de 20... | Pasar `agent_id` como parámetro de query directo en vez de client-side filter |
| H19 | `insights.ts:130` LEGACY_AGENT_SLUGS | Hard-drop incondicional de `data_quality/meta/cleanup/odoo` en `getInsights` → `/agents/data_quality` vacío aunque tiene 14 insights activas | Mover filter a opt-in param; no aplicar cuando `slug` ES uno de los legacy |

---

## MEDIUM / WARNING

| # | Capa | Ubicación | Problema |
|---|---|---|---|
| M1 | AR | `payment_predictions` MV | Solo cubre 82 companies (≥3 paid invoices). **17.6% del AR ($4.58M) invisible** a predicciones |
| M2 | AR | `payment_predictions` MV | 14 de 82 predicciones con `predicted_payment_date` en el pasado |
| M3 | AR | `payment_predictions` MV | 2 companies divergen de `cash_flow_aging` ($1.19M diff) — falta filtro `state='posted' AND amount_residual > 0` |
| M4 | AR | Open AR | 51 invoices ($2.99M, 11.5%) con `cfdi_sat_state IS NULL`. 4 más ($439K) `not_defined`. Se cuentan en cartera sin validación SAT |
| M5 | Finanzas | `/finanzas:400` | `neto = ventas30d + pagosProv30d` mezcla devengado con caja; funciona por accidente (pagosProv30d negativo) |
| M6 | Finanzas | Labels | `working_capital.capital_de_trabajo` ($6.3M) vs `working_capital_cycle.working_capital_mxn` ($38.5M) — nombres similares, 6× diferencia, sin tooltip explicativo |
| M7 | Companies | `companies` table | 12 RFC duplicados (real), 75 rows con `XAXX010101000` (genérico). Mismo legal entity fragmentado en múltiples cards |
| M8 | Companies | `/companies/[id]` self | Detail page renderiza data para self-companies (4 ids: Quimibond + 3 Google Drive artifacts) sin 404 ni banner |
| M9 | Companies | `_helpers.ts:13` | `_selfCompanyIdsCache` never invalidated — si cambia el tag en DB, no se refleja hasta redeploy |
| M10 | Insights | `insights.ts:211-263` | `getInsightCounts` no aplica `isVisibleToCEO` → badges de `/inbox` pueden decir "5 critical" y renderizar 4 |
| M11 | Insights | `team.ts:195` | `getInsightsByDepartment` no filtra `assignee_department=''` (string vacío) → `/equipo` renderiza fila blank con 3 insights |
| M12 | Insights | `contacts.ts:155,218` | `getContactsKpis` y `getContactDetail` cuentan cobranza insights que CEO no ve en `/inbox` |
| M13 | Orders | `ventas/cohorts` + `analytics.ts` | `getRevenueTrend` usa `pl_estado_resultados` agregado; self exclusion asumida pero view no auditada |
| M14 | Recommendations | `topArToCollect` | Incluye write-offs de 8 años ("belsueño" 2,536 días vencido) presentados como cobranza prioritaria |
| M15 | Companies | Tier consistency | `rfm_segments.tier` NULL para 448 de 848 companies (no RFM-elegibles). Mismo company puede mostrar tier en list y blank en at-risk panel |

---

## Temas cross-cutting (patrones de error)

1. **FX inconsistente** — 3 rates activos simultáneamente: `17.2688` (usd_to_mxn live), `17.4` (hardcoded en dashboard RPC), `17.69-17.73` (stored en current_balance_mxn). Afecta: cash totals, invoice lines MXN, working_capital.
2. **Text strings donde debería haber FK** — salesperson_name, buyer_name, assigned_to son texto → duplicados cuando se renombra en Odoo, leaderboards inflados.
3. **Sanitización aplicada en FK joins pero NO en MV-sourced names** — `sanitizeCompanyName` funciona vía `joinedCompanyName` helper pero no en `CompanyLink` componente.
4. **Filtros aplicados en listas pero no en detalle/agregados** — `isVisibleToCEO` solo en `/` e `/inbox`; `getSelfCompanyIds` no aplicado en `getCompanyDetail` ni `getPartnerPaymentProfiles`.
5. **MVs incluyen rows "especiales" sin semántica de negocio** — asset leasing como revenue, partner admin=1 como partner real, departamentos vacíos como columna agrupadora.
6. **Labels ambiguos entre páginas** — "cash", "working capital", "ingresos", "runway" significan cosas distintas en páginas distintas sin tooltip.
7. **Cobertura de sync incompleta** — 97.4% de invoice_lines no sincronizadas; `account_payment_profile.account_code` 100% vacío.

---

## Orden de fix recomendado

### Tanda 1 — CRITICAL + bloqueo de pantalla (1-2 horas)
- C1 coverage ratio (ya en otra sesión)
- C2 Jeeves credit (ya en otra sesión)
- **C3 dashboard hardcoded FX 17.4** — rewrite RPC
- **C4 /contacts columnas inexistentes** — la página está rota

### Tanda 2 — HIGH cross-page (2-4 horas)
- H4 pagosProv30d `Math.abs()` en getCfoSnapshot
- H7 partner_id=1 exclusion en `getPartnerPaymentProfiles`
- H8 `sanitizeCompanyName` en `CompanyLink` (un solo fix, 193 filas)
- H13 renombrar "margin %" → "markup %" en `/productos` o fix MV
- H18 agent filter en query en vez de client-side
- H19 LEGACY_AGENT_SLUGS opt-in

### Tanda 3 — DB-side (qb19 + Supabase migrations)
- H2 working_capital usar stored _mxn
- H5 account_payment_profile populate account_code
- H9 _push_contacts validate name
- H10 cash_flow_aging 5 buckets
- H11 _push_invoice_lines coverage bug (97.4% missing)
- H12 _push_invoice_lines FX fix
- H14/H15 monthly_revenue_by_company exclude non-trade
- H16 add *_user_id FKs en sync + frontend
- H17 ops_delivery_health_weekly redefine is_late

### Tanda 4 — UX polish (MEDIUM items)

---

## Archivos clave

- `DATA_INVENTORY.md` — mapa completo page → query → SQL → Odoo
- `DATA_AUDIT_REPORT.md` — este documento

**Queries TS centralizadas:** `src/lib/queries/{dashboard,finance,invoices,companies,contacts,sales,purchases,analytics,insights,evidence,operations,products,team,system}.ts`
**Views críticas Supabase:** `cfo_dashboard`, `financial_runway`, `working_capital`, `cashflow_current_cash`, `cash_flow_aging`, `payment_predictions`, `monthly_revenue_by_company`, `product_margin_analysis`, `customer_margin_analysis`, `ops_delivery_health_weekly`
**RPCs:** `get_dashboard_kpis`, `get_projected_cash_flow_summary`, `get_cashflow_recommendations`, `company_evidence_pack`, `get_director_briefing`
**Addon qb19:** `_push_contacts`, `_push_invoice_lines`, `_push_bank_balances`, `_push_currency_rates` (FX source), `_push_sale_orders`, `_push_invoices`
