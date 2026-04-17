# Syntage Fase 5 — Frontend Layer 3 Migration

**Fecha:** 2026-04-17
**Autor:** Brainstorming jj + Claude
**Estado:** Diseño aprobado por secciones, pendiente revisión del documento consolidado
**Documento padre:** `2026-04-12-flujo-datos-vision-ideal.md` (arquitectura 4-5 capas) + `2026-04-16-syntage-integration-design.md` (§3 layers)
**Relacionado:** `2026-04-17-syntage-fase-3-layer-3-design.md` (Layer 3 ya construido)
**Próximo paso:** writing-plans

---

## 1. Contexto y objetivo

Fase 3 construyó Layer 3 canónico (`invoices_unified`, `payments_unified`, `reconciliation_issues`) pero el frontend Next.js y los directores IA siguen leyendo Layer 2 directo (19 archivos TypeScript consumen `odoo_invoices`, `odoo_account_payments`, `cfdi_documents`). Esto viola el contrato de capas ("Layer 5 lee solo Layer 3/4, nunca Layer 2") y significa que Syntage—el data source más reciente y el más fiscalmente autoritativo—no aparece en el producto.

**Objetivo Fase 5:** Migrar queries del frontend de Layer 2 a Layer 3, respetando autoridad por campo (Syntage fiscal, Odoo operativo) y exponiendo `reconciliation_issues` en UI contextual (cobranza, company detail). Deprecar `cfdi_documents` reemplazando por `email_cfdi_links`.

**No-objetivo (Fase 6):** actualizar prompts de Directores IA para consumir Layer 3. Eso es Fase 6 separada.

**No-objetivo (mantenimiento):** migrar P&L views (`pl_estado_resultados`, `monthly_revenue_trend`, `expense_breakdown`, `budget_vs_actual`) — están basadas en `account.move.line` (contabilidad), no tienen lens fiscal/operativo que resolver.

## 2. Decisiones cerradas

| Decisión | Opción | Razón |
|---|---|---|
| Semántica de "revenue computable" | `direction='issued' AND match_status IN ('match_uuid','match_composite','odoo_only') AND COALESCE(estado_sat,'vigente') != 'cancelado' AND (odoo_state='posted' OR odoo_state IS NULL)` | Excluye cancelled_but_posted y sat_only pre-2021 sin perder operational truth de odoo_only reciente |
| Migración | In-place (refactor queries existentes, mantienen firma pública) | Menos superficie de cambio en callers |
| Feature flag | `USE_UNIFIED_LAYER` env var con fallback a legacy 30d | Rollback sin redeploy code |
| `/ventas` | NO migra — pipeline comercial pre-facturación | No aplica lens fiscal a sale orders |
| `/compras` | Parcial — solo secciones de facturas recibidas | Purchase orders (pre-invoicing) no aplica |
| P&L views | NO migran | No son invoice-level, son account.move.line agregados |
| cfdi_documents deprecation | Schema reducido `email_cfdi_links` + 30d safety net antes de drop | Backwards-compat window |
| Test strategy | Parity numérica (diff <0.1%) + integration gated por env | Pixel comparison es frágil |
| Data freshness | Badge "actualizado hace X min" + refresh queue triggered por Odoo sync + manual refresh button | MV 15min vs live Odoo necesita mitigación |

## 3. Convención de campos (autoridad por campo)

Cada query que consume `invoices_unified` sigue esta convención:

| Campo a mostrar | Campo de MV | Lógica |
|---|---|---|
| Monto total (CxC display) | `odoo_amount_total` con fallback a `total_fiscal` cuando `match_status='syntage_only'` | Operational para matched; fiscal para sat_only |
| Fecha factura | `invoice_date` (Odoo) con fallback a `fecha_timbrado` | Operational primario |
| Estado pago | `payment_state` + `estado_sat` como dos columnas | Ambos visibles, no sobrescribir |
| UUID SAT | `uuid_sat` | Null cuando odoo_only |
| Partner | `partner_name` (companies.name via LEFT JOIN) | Operational |
| Currency | `odoo_currency` con fallback `moneda_fiscal` | Operational primario |
| Cancelled flag | `estado_sat='cancelado' OR fiscal_operational_consistency='cancelled_but_posted'` | **Excluye de CxC** |

Filtro universal `isComputableRevenue(row)`:
```sql
direction = 'issued'
AND match_status IN ('match_uuid','match_composite','odoo_only')
AND COALESCE(estado_sat, 'vigente') != 'cancelado'
AND (odoo_state = 'posted' OR odoo_state IS NULL)
```

## 4. PR 0 — Pre-requisitos de Layer 3 (blocking)

Antes de cualquier refactor de frontend, tres cambios en Layer 3:

### 4.1 MV enrichment: populate `email_id_origen`

Recrear `invoices_unified` con LEFT JOIN a `email_cfdi_links` (tabla se crea en PR 4 — ver nota abajo). Si `email_cfdi_links` no existe aún, el JOIN es a tabla vacía y `email_id_origen` queda NULL, pero el shape de la MV no cambia.

**Orden**: PR 0 NO depende de `email_cfdi_links`. Cambia solo a `LEFT JOIN IF EXISTS`-style usando una view-cubierta: crear view stub `email_cfdi_links_stub AS SELECT NULL::bigint email_id, NULL::text uuid WHERE false`. La MV hace JOIN al stub. Cuando PR 4 crea la tabla real, `DROP VIEW email_cfdi_links_stub CASCADE` + `CREATE TABLE email_cfdi_links` + recreate MV.

Alternativa más limpia (adoptada): **mover creación de `email_cfdi_links` a PR 0** (vacía, se popula en PR 4). Así MV siempre JOIN a tabla real.

### 4.2 `reconciliation_issues.company_id` fix + backfill

**Modificación a `refresh_invoices_unified()`**: los 2 INSERTs de sat_only_cfdi_issued/received populan `company_id` via `companies.rfc` lookup.

```sql
-- sat_only_cfdi_received
(SELECT id FROM companies WHERE lower(rfc)=lower(iu.emisor_rfc) LIMIT 1) AS company_id

-- sat_only_cfdi_issued
(SELECT id FROM companies WHERE lower(rfc)=lower(iu.receptor_rfc) LIMIT 1) AS company_id
```

**One-shot backfill** en la migration:
```sql
UPDATE reconciliation_issues ri
SET company_id = c.id
FROM syntage_invoices s, companies c
WHERE ri.company_id IS NULL AND ri.uuid_sat = s.uuid
  AND ri.issue_type IN ('sat_only_cfdi_issued','sat_only_cfdi_received')
  AND lower(c.rfc) = lower(CASE
    WHEN ri.issue_type='sat_only_cfdi_issued' THEN s.receptor_rfc
    ELSE s.emisor_rfc END);
```

Esto llena company_id en los ~51k issues ya abiertos (donde el RFC exista en companies).

### 4.3 Refresh trigger queue para on-demand refresh

```sql
CREATE TABLE public.unified_refresh_queue (
  requested_at timestamptz PRIMARY KEY DEFAULT now(),
  processed_at timestamptz
);

CREATE OR REPLACE FUNCTION trg_schedule_unified_refresh()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.unified_refresh_queue (requested_at) VALUES (now())
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END; $$;

CREATE TRIGGER odoo_invoices_refresh_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.odoo_invoices
FOR EACH STATEMENT EXECUTE FUNCTION trg_schedule_unified_refresh();

-- Equivalente para odoo_account_payments + syntage_invoices + syntage_invoice_payments
```

Nuevo pg_cron cada 2min:
```sql
-- debounced refresh: si hay pending unprocessed request en la cola Y el último refresh de MV fue hace >5 min, dispara refresh
SELECT cron.schedule('debounced-unified-refresh', '*/2 * * * *', $$
  WITH last_refresh AS (SELECT max(refreshed_at) AS ts FROM public.invoices_unified)
  SELECT
    CASE WHEN EXISTS (SELECT 1 FROM public.unified_refresh_queue WHERE processed_at IS NULL)
          AND (SELECT ts FROM last_refresh) < now() - interval '5 minutes'
      THEN public.refresh_invoices_unified() END;

  UPDATE public.unified_refresh_queue SET processed_at = now()
  WHERE processed_at IS NULL;
$$);
```

Resultado: Odoo push escribe → trigger enqueue → debounced refresh máx 2min + 5min = 7min worst case vs 15min anterior.

## 5. `email_cfdi_links` table (creada en PR 0, poblada en PR 4)

```sql
CREATE TABLE public.email_cfdi_links (
  id bigserial PRIMARY KEY,
  email_id bigint REFERENCES public.emails(id) ON DELETE CASCADE,
  gmail_message_id text,
  account text,
  uuid text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_cfdi_links_uuid_idx ON public.email_cfdi_links(uuid);
CREATE INDEX email_cfdi_links_email_idx ON public.email_cfdi_links(email_id);

ALTER TABLE public.email_cfdi_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_cfdi_links FROM anon, authenticated;
GRANT ALL ON public.email_cfdi_links TO service_role;
```

Creado vacío en PR 0 para que la MV pueda JOIN. Poblado en PR 4 desde `cfdi_documents`.

## 6. PR 1 — `unified.ts` query helpers + /cobranza + /finanzas

### 6.1 Nuevo archivo `src/lib/queries/unified.ts`

Exports (signatures):
```ts
export interface UnifiedInvoice { ... }  // subset of invoices_unified columns typed
export interface UnifiedAgingBucket { bucket: '0-30'|'31-60'|'61-90'|'90+'; amount: number; count: number }

export async function getUnifiedInvoicesForCompany(
  companyId: number,
  opts?: { direction?: 'issued'|'received'; includeNonComputable?: boolean }
): Promise<UnifiedInvoice[]>

export async function getUnifiedRevenueAggregates(
  fromDate: string, toDate: string, opts?: { companyId?: number }
): Promise<{ revenue: number; count: number; uuidValidated: number; pctValidated: number }>

export async function getUnifiedCashFlowAging(
  opts?: { companyId?: number }
): Promise<UnifiedAgingBucket[]>

export async function getUnifiedReconciliationCounts(
  companyId: number
): Promise<{ open: number; bySeverity: Record<'critical'|'high'|'medium'|'low', number> }>

export async function getUnifiedRefreshStaleness(): Promise<{
  invoicesRefreshedAt: string | null;
  paymentsRefreshedAt: string | null;
  minutesSinceRefresh: number
}>
```

Todas usan filter `isComputableRevenue` (§3) por default excepto cuando `includeNonComputable=true`.

### 6.2 Refactor `src/lib/queries/finance.ts`

Funciones existentes mantienen firma pública; internamente gated por feature flag:
```ts
const USE_UNIFIED = process.env.USE_UNIFIED_LAYER !== 'false';

export async function getCashFlowAging(companyId?: number) {
  if (USE_UNIFIED) return getUnifiedCashFlowAging({ companyId });
  return legacyCashFlowAging(companyId);  // preservado, unchanged
}
```

Idem para `getCeiTimeline`, `getTopDebtors`, `getCfoDashboard`, `getWorkingCapital`, `getCashFlowRunway`.

### 6.3 UI cambios en `/cobranza`

- Columna nueva "SAT" en tabla de facturas: Badge verde `vigente` / rojo `cancelado` / gris `sin UUID`
- Si empresa tiene `reconciliation_issues.open > 0`, badge amarillo junto al nombre con count
- Badge staleness "actualizado hace X min" top-right usando `getUnifiedRefreshStaleness()`. Si >20min → amarillo + botón "Refresh ahora" (llama `POST /api/syntage/refresh-unified`)

### 6.4 UI cambios en `/finanzas`

- Stat card nueva "CFDIs validados SAT" = `pctValidated` del revenue del mes
  - Verde si >90%, amarillo 70-90%, rojo <70%
- Donut chart "Revenue por match_status" en sección de revenue (debajo del total existente)

### 6.5 Parity tests

`src/__tests__/layer3/parity-fase5.test.ts`:
```ts
describe('Fase 5 parity · legacy vs unified', () => {
  it('CxC total diff <0.1%', async () => {
    const legacy = await legacyCashFlowAging();
    const unified = await getUnifiedCashFlowAging();
    const legacyTotal = legacy.reduce((s, b) => s + b.amount, 0);
    const unifiedTotal = unified.reduce((s, b) => s + b.amount, 0);
    expect(Math.abs(legacyTotal - unifiedTotal) / legacyTotal).toBeLessThan(0.001);
  });
  // repetir para getTopDebtors, getCfoDashboard, getCeiTimeline
});
```

Gated por env (requiere Supabase creds). Corre en CI contra dev branch.

## 7. PR 2 — `/companies/[id]` + `invoice-detail.ts`

- `src/lib/queries/companies.ts`: `getCompanyInvoices` + `getCompanyPayments` usan unified helpers
- `src/lib/queries/invoice-detail.ts`: joins a `email_cfdi_links` (ya creada en PR 0, vacía hasta PR 4)
- `/companies/[id]` UI:
  - Tab nuevo "Reconciliación Fiscal" mostrando issues open filtrados por `company_id = <id>`
  - Lista de invoices con `fiscal_operational_consistency != 'consistent'`
  - Link directo a `/system → Reconciliación` con filtro pre-aplicado

## 8. PR 3 — `/compras` + `purchases.ts`

- `src/lib/queries/purchases.ts`: `getSupplierInvoices` + `getSupplierPayments` usan unified helpers con `direction='received'`
- UI: tag rojo "69-B" en proveedores con `partner_blacklist_69b` abierto

## 9. PR 4 — `cfdi_documents` → `email_cfdi_links` migration

1. Verificar cobertura: `SELECT count(*) FROM cfdi_documents cd LEFT JOIN syntage_invoices s ON s.uuid=cd.uuid WHERE s.uuid IS NULL` → flag rows sin match
2. `INSERT INTO email_cfdi_links (email_id, gmail_message_id, account, uuid, linked_at) SELECT email_id, gmail_message_id, account, uuid, parsed_at FROM cfdi_documents WHERE uuid IS NOT NULL`
3. Trigger manual refresh de `invoices_unified` para populate `email_id_origen` via JOIN
4. Verify: `SELECT count(*) FROM invoices_unified WHERE email_id_origen IS NOT NULL` ≈ count de email_cfdi_links
5. Actualizar callers: invoice-detail.ts, cualquier query que leía cfdi_documents → lee email_cfdi_links para email linking

## 10. PR 5 — Shutdown `parse-cfdi` cron + 410 Gone endpoint

1. Remove `/api/pipeline/parse-cfdi` de crons en `vercel.json`
2. Replace route body con 410 Gone response con mensaje "Deprecated 2026-04-20, replaced by Syntage webhook ingestion"
3. Rename `cfdi_documents` → `cfdi_documents_deprecated_20260420` (SQL migration)
4. REVOKE INSERT/UPDATE/DELETE → read-only
5. Post-deploy validation: no errores en logs por 7 días

## 11. PR 6 — Cleanup legacy (30d post-deploy)

En `20260520` o después:
1. Remove `legacy*` fallback paths de finance.ts, companies.ts, purchases.ts
2. Remove `USE_UNIFIED_LAYER` env var + feature flag branching
3. `DROP TABLE cfdi_documents_deprecated_20260420`
4. Remove route `/api/pipeline/parse-cfdi` completo (o mantener 410 indefinidamente)

## 12. Testing

### 12.1 Parity tests (crítico)

Por cada query migrada, un test que compara total legacy vs unified con tolerancia 0.1%. Corren en CI contra Supabase dev.

### 12.2 Unit tests

`unified.ts` helpers con mocks de supabase client. Cubren:
- Shape correcto del retorno
- Filtro isComputableRevenue funciona
- Fallback a total_fiscal cuando odoo_amount_total es NULL
- Staleness calculator

### 12.3 Smoke tests post-deploy

Playwright o curl-based:
- `/cobranza` carga <3s
- Totales de CxC renderizados
- Badge "SAT" aparece en tabla
- Badge staleness presente

### 12.4 Coverage target

60% en unified.ts + 100% de los helpers usados en PR 1 con parity tests.

## 13. Rollout

| PR | Scope | Estimate | Gate |
|---|---|---|---|
| **PR 0** | MV email_id_origen + company_id fix + refresh trigger queue + email_cfdi_links stub | 0.5 día | MV rebuilt, `reconciliation_issues.company_id` populated |
| **PR 1** | unified.ts + /cobranza + /finanzas + parity tests | 1.5 días | Parity <0.1%, feature flag funciona |
| **PR 2** | /companies/[id] + invoice-detail.ts | 0.5 día | Tab Reconciliación renders |
| **PR 3** | /compras invoice sections + purchases.ts | 0.5 día | 69-B tag visible |
| **PR 4** | cfdi_documents → email_cfdi_links data migration | 0.5 día | email_id_origen populated |
| **PR 5** | parse-cfdi off + 410 Gone + rename deprecated | 0.25 día | Cron removed, logs clean |
| **PR 6** | Cleanup legacy (día 30) | 0.25 día | No callers use legacy |

**Total**: ~4 días work + 30d safety window para PR 6.

## 14. Rollback strategy

| PR | Rollback |
|---|---|
| PR 0 | Drop unified_refresh_queue + triggers; recreate MV sin email_id_origen JOIN; restore reconciliation_issues.company_id via backup |
| PR 1 | `USE_UNIFIED_LAYER=false` en Vercel env → legacy queries activas. Sin redeploy de code. |
| PR 2 | idem — feature flag |
| PR 3 | idem |
| PR 4 | Si email_cfdi_links migration falla: rollback INSERT + restore cfdi_documents queries |
| PR 5 | Revert `vercel.json` + restore parse-cfdi route. Rename deprecated back |
| PR 6 | Only runs after 30d of stability — minimal rollback risk |

## 15. Criterios de éxito

| Métrica | Target |
|---|---|
| Queries migradas | 19 files, 100% del scope de Fase 5 |
| Parity test (CxC, revenue, aging) | diff <0.1% vs legacy |
| `reconciliation_issues.company_id` populated | >90% (resto son RFCs desconocidos en companies) |
| Data freshness (MV vs live Odoo) | <7min worst case |
| `/cobranza` y `/finanzas` latencia | <3s first paint (vs actual ~2s) |
| UI shows fiscal insight | Badges SAT visibles en cobranza + donut validados en finanzas |
| Legacy paths usage post-30d | 0 (cleanup en PR 6) |

## 16. Qué este doc NO es

- **No reemplaza Fase 6** (Directores IA). `financiero-context.ts`, `director-chat-context.ts` y otros lib/agents/ quedan en Layer 2 hasta Fase 6.
- **No migra P&L views** (pl_estado_resultados, expense_breakdown). Esas son contabilidad, no invoice-level.
- **No toca /ventas** ni /compras purchase orders. Pre-facturación no tiene lens fiscal.
- **No deploya file downloads** (Fase 4) ni nómina canónica (Fase 4.5). Fases separadas.

## 17. Referencias

- Spec padre: `2026-04-12-flujo-datos-vision-ideal.md` (arquitectura 4 capas original)
- Fase 3 spec: `2026-04-17-syntage-fase-3-layer-3-design.md` (Layer 3 construido)
- Fase 3 plan: `2026-04-17-syntage-fase-3-layer-3.md` (13 tasks executed)
- Memory: `project_syntage_integration.md`
