# SP6 Routing Audit — Frontend ↔ Supabase (sp6-01 / sp6-02 / sp6-03)

**Fecha:** 2026-04-22
**Branch:** `sp6-03-cobranza` (audit ejecutado desde aquí)
**Scope:** Auditar helpers consumidos por las 3 páginas para detectar shape mismatches, drift de columnas legacy (post SP5/SP8) y gaps de spec.
**Método:** 3 agentes paralelos (Explore) sobre `/inbox`, `/empresas`, `/cobranza` (1528 líneas, pre-rewrite).

---

## TL;DR

| Página | Verdict | Acción |
|---|---|---|
| `/inbox` (sp6-01 merged) | **CLEAN** | Ninguna. Single feed `gold_ceo_inbox`, evidence helpers tipados. |
| `/empresas` (sp6-02 merged) | **CLEAN** | Ninguna. `toAgingData()` adapter local consistente PanoramaTab + FinancieroTab. |
| `/cobranza` (sp6-03 pending) | **MISMATCHES_FOUND** | Aplicar 4 fixes al spec edc7a05 + 1 acknowledgment de stub. |

---

## 1. /inbox — CLEAN ✓

### Helpers consumidos

| Helper | File | Source | Status |
|---|---|---|---|
| `listInbox()` | `intelligence/inbox.ts` | `gold_ceo_inbox` (view) | OK |
| `fetchInboxItem()` | `intelligence/inbox.ts` | `gold_ceo_inbox` + 4 evidence tables | OK |
| `adaptInboxRow()` | `intelligence/inbox-adapter.ts` | transform | OK |
| `getCompanyEvidencePack()` | `intelligence/evidence.ts` | RPC `company_evidence_pack()` | OK |
| `buildTimelineFromEvidencePack()` | `intelligence/evidence-helpers.ts` | transform | OK |

### Findings

- Adapter `adaptInboxRow` mapea correctamente null→default (severity→"low", action_cta→null).
- Evidence assembly (5 queries paralelas) usa nombres canonical correctos: `email_signals`, `ai_extracted_facts`, `manual_notes`, `attachments` con filtros `canonical_entity_type` + `canonical_entity_id`.
- Severity/entity/assignee enums en URL state coinciden con valores en DB.
- **No legacy column drift**: `/inbox` lee `gold_ceo_inbox` (SP4 gold view), no toca tablas Odoo directas.

### Observaciones (no-blocker)

1. Search `q` filtrado client-side post-fetch (TODO comment); push-down pendiente, no es shape mismatch.
2. Dual-path detail routing: UUID → `gold_ceo_inbox`, numeric ID → `agent_insights` (legacy). Ambos paths intencionales.

---

## 2. /empresas — CLEAN ✓

### Helpers consumidos

| Helper | File | Source | Used By | Status |
|---|---|---|---|---|
| `listCompanies()` | `_shared/companies.ts` | `gold_company_360` (MV) | List | OK |
| `fetchPortfolioKpis()` | `_shared/companies.ts` | `gold_company_360` (MV) | Header KPIs | OK |
| `fetchCompanyById()` | `_shared/companies.ts` | `canonical_companies` | Detail header | OK |
| `fetchCompany360()` | `_shared/companies.ts` | `gold_company_360` (MV) | Detail KpiHero + tabs | OK |
| `fetchCompanyRevenueTrend()` | `_shared/companies.ts` | `gold_revenue_monthly` (MV) | Panorama, Financiero | OK |
| `fetchCompanyReceivables()` | `_shared/companies.ts` | `canonical_invoices` | toAgingData() → AgingBuckets | OK |
| `getCompanyTopProducts()` | `_shared/companies.ts` | `canonical_order_lines` (MV) | ComercialTab | OK |
| `getCompanyOrdersPage()` | `_shared/companies.ts` | `canonical_sale_orders` (MV) | ComercialTab | OK |
| `getCompanyDeliveriesPage()` | `_shared/companies.ts` | `canonical_deliveries` (MV) | OperativoTab | OK |
| `getCompanyActivities()` | `_shared/companies.ts` | `odoo_activities` (Bronze) | OperativoTab | OK (SP5-EXCEPTION documented) |
| `getCustomer360()` | `analytics/customer-360.ts` | `gold_company_360` (MV) | FiscalTab | OK |
| `getUnifiedInvoicesForCompany()` | `unified/invoices.ts` | `canonical_invoices` | Legacy backup | OK |

### Aging-buckets trace

**Component:** `<AgingBuckets>` espera `{ current, d1_30, d31_60, d61_90, d90_plus }`.

**Path activo (PanoramaTab + FinancieroTab):**
1. `fetchCompanyReceivables(id)` → `canonical_invoices` → `[{fiscal_days_to_due_date, amount_residual_mxn_odoo}]`
2. Adapter local `toAgingData()` (detail page lines 48-72) → bucketiza por días → output con keys correctas
3. `<AgingBuckets data={agingData} />` ✓

**Paths inactivos (no consumidos en /empresas):**
- `getCompanyAgingPage()` via `cash_flow_aging` view (KEEP, pero no usado en detail tabs)
- `invoicesReceivableAging()` via canonical_invoices (definido pero no llamado)

### No drift, no dropped views

- `gold_revenue_monthly`, `gold_company_360`, `cash_flow_aging`, `ar_aging_detail` todos KEEP-listed (§12 SP1) y existentes.
- `amount_residual_mxn_odoo` usado correctamente para open-balance (no `_resolved` que es 0% pre-Task-24).

---

## 3. /cobranza — MISMATCHES_FOUND ⚠️

### Helpers consumidos / planeados

| Helper | File | Source | Status |
|---|---|---|---|
| `getArAging()` | `unified/invoices.ts` | `ar_aging_detail` (MV, KEEP) | **SHAPE_CONFLICT** |
| `invoicesReceivableAging()` | `unified/invoices.ts` | `canonical_invoices` | **SHAPE_CONFLICT** (parcial; mejor candidato) |
| `getCompanyAgingPage()` | `unified/invoices.ts` | `cash_flow_aging` (view, KEEP) | OK |
| `getOverdueInvoicesPage()` | `unified/invoices.ts` | `canonical_invoices` | **NEEDS_SIGNATURE_EXTEND** |
| `getOverdueSalespeopleOptions()` | `unified/invoices.ts` | (stubbed) | **STUBBED** — retorna `[]` |
| `getPaymentPredictionsPage()` | `unified/invoices.ts` | `payment_predictions` (MV, KEEP) | OK |
| `getPaymentRiskKpis()` | `unified/invoices.ts` | `payment_predictions` (MV, KEEP) | OK |
| `getCfoSnapshot()` | `analytics/finance.ts` | `cfo_dashboard` (view, KEEP) | OK |
| `getCollectionEffectiveness()` | `analytics/index.ts` | `collection_effectiveness_index` (view, KEEP) | OK |

### 3.1 Las 3 shapes de aging side-by-side

| Shape | Helper | Keys | Has `current`? | Splits 90+? |
|---|---|---|---|---|
| **A** | `getArAging()` | `[{ bucket: "1-30"\|...\|"120+", count, amount_mxn }]` | ❌ | ✅ (91-120 + 120+) |
| **B** | `invoicesReceivableAging()` | `{ current, "1-30", "31-60", "61-90", "90+" }` (hyphen) | ✅ | ❌ |
| **C** | `cash_flow_aging` view via `getCompanyAgingPage()` | `{ current_amount, overdue_1_30, overdue_31_60, overdue_61_90, overdue_90plus }` | ✅ | ❌ |
| **D** | `<AgingBuckets>` espera | `{ current, d1_30, d31_60, d61_90, d90_plus }` | ✅ | ❌ |

**Match:** Shape **B** (`invoicesReceivableAging`) está a un adapter de `<AgingBuckets>` (hyphen → `d_` underscore + tiene `current`). Shape A (`getArAging`) requiere fabricar `current` (no lo tiene) y mergear `91-120 + 120+`.

**Conclusión:** Spec sp6-03 §3.3 dice "usar `getArAging()` con adapter hyphen→underscore" — pero `getArAging()` NO tiene hyphen keys (tiene `bucket: string`). Spec mezcla las dos shapes. **Switch a `invoicesReceivableAging()`.**

### 3.2 `getOverdueInvoicesPage()` filter — bucket enum mismatch

**Helper actual** (`bucket?: string[]`):
```
"1-30" | "31-60" | "61-90" | "91-120" | "120+"
```
Traduce a `due_date_odoo` ranges via `or()` filters (lines 384-434).

**SP6-03 spec URL state** (`aging?: enum`):
```
"current" | "1-30" | "31-60" | "61-90" | "90+"
```

**Incompatibilidad:**
- Spec usa `90+` merged; helper usa `91-120` + `120+` separados.
- Spec incluye `current`; helper no acepta (no tiene sentido en tabla de vencidas).

**Fix:** Extender helper para aceptar `90+` como `due_date_odoo < today - 90`. `current` no se traduce (UI no envía).

### 3.3 Stub: `getOverdueSalespeopleOptions()` returns `[]`

```typescript
// SP6-TODO: join canonical_contacts via salesperson_contact_id for name resolution
return [];
```

Spec §6 OverdueFilterBar asume dropdown funcional. Sin fix, el dropdown queda vacío.

**Opciones:**
1. **Fix in scope (recomendado)** — implementar el join contra `canonical_contacts` via `salesperson_contact_id` FK. Pequeño cambio aislado.
2. **Defer + acknowledge** — render dropdown disabled con tooltip "Pendiente SP7", spec lo declara non-goal explícito.

### 3.4 `fetchCobranzaKpis()` no existe

Spec §3.1 sugiere "agregar si no existe". KPIs requeridos (AR total, vencida, 90+, DSO) son componibles desde `getCfoSnapshot()` + `getPaymentRiskKpis()`. Decisión deferida al implementer (helper nuevo o composición inline).

### 3.5 Legacy column drift

**Ninguno.** Todos los helpers usan columnas live:
- `amount_residual_mxn_odoo` (correcto para open-balance, ya que `_mxn_resolved` está 0% pre-Task-24)
- `due_date_odoo` (live)
- `invoice_date` (live; `invoice_date_resolved` introducido en SP5.6 pero canonical_invoices ya tiene resolved trigger)

Ningún helper consume `amount_residual` legacy ni views dropeadas.

### 3.6 Dropped views

**Ninguna.** Las 5 sources (`ar_aging_detail`, `cash_flow_aging`, `payment_predictions`, `collection_effectiveness_index`, `cfo_dashboard`, `canonical_invoices`) están en KEEP list.

---

## 4. Plan de fixes

### 4.1 Spec sp6-03 (4 ediciones — orchestrator aplica ahora)

| # | §Spec | Cambio |
|---|---|---|
| (a) | §3.3 + §6.4 | Cambiar `getArAging()` → `invoicesReceivableAging()`. Adapter mapea hyphen → `d_` underscore (current pasa directo). |
| (b) | §6.5 + §9 | Extender `getOverdueInvoicesPage(bucket)` para aceptar `"90+"` (translate a `due_date_odoo < today-90`). Mantener back-compat con `"91-120"` / `"120+"`. Mover de Non-goals a "in-scope helper edit". |
| (c) | §6.2 | `current` bucket no-click en AgingSection (no filtra tabla overdue). `KEY_TO_URL.current` → no se emite, o `onBucketClick` early-return. |
| (d) | §3.2 + §9 | Non-goals: permitir editar `getOverdueInvoicesPage` signature (era prohibido en `__No cambios a helpers__`). |

### 4.2 Spec sp6-03 (1 acknowledgment — usuario decide)

| # | §Spec | Decisión necesaria |
|---|---|---|
| (e) | §6 OverdueFilterBar + §3.2 | `getOverdueSalespeopleOptions()` retorna `[]`. **Implementar join canonical_contacts** (recomendado) **o** declarar dropdown disabled hasta SP7. |

### 4.3 sp6-01, sp6-02 — sin acción

Ambas merged y limpias. No requieren follow-ups.

---

## 5. Referencias

- Spec sp6-03: `docs/superpowers/specs/2026-04-22-sp6-03-cobranza-design.md` (commit edc7a05)
- Spec sp6-01: `docs/superpowers/specs/2026-04-22-sp6-01-inbox-design.md`
- Spec sp6-02: `docs/superpowers/specs/2026-04-22-sp6-02-empresas-design.md`
- Foundation primitives: `src/components/patterns/aging-buckets.tsx`
- Helpers: `src/lib/queries/unified/invoices.ts`, `src/lib/queries/_shared/companies.ts`, `src/lib/queries/intelligence/inbox.ts`
