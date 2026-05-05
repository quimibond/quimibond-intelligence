# Audit 2026-05-05 — limpieza post-corrección de premisa AVCO

Hecho desde `claude/fix-valuation-documentation-NMcuy` (== origin/main, sin
cambios pendientes). El audit cataloga residuos de la premisa
"Standard valuation + CAPA inflada" después de que la sesión de 2026-05-04
la reemplazó por "AVCO + variable costing implícito".

**Disclaimer**: el audit corre en el mismo branch que aplicó la corrección,
así que el contexto está sesgado. Cada propuesta abajo está pensada como
"para revisar y aprobar manualmente" — no se ha borrado nada.

**Estado verificado en DB (proyecto `tozqezmivpblmcubmnpi`)**:
- 20 pending actions (16 `open`, 5 `wont_fix`).
- Función `get_capa_posted_per_month` existe pero **no tiene consumers en código**.
- `cogs_monthly_cache`, `_compute_cogs_comparison_monthly`, `get_cogs_comparison_monthly`,
  `refresh_cogs_monthly_cache` siguen activos y consumidos por `cogs-monthly.ts`.
- No hay table `report_synthesis_cache` ni equivalente — narrativas son in-memory ISR.
- Las migrations `20260504_*` no aparecen en `supabase_migrations.schema_migrations`
  (probablemente aplicadas vía `apply_migration` MCP u otro mecanismo); los objects
  sí existen en DB.

---

## (1) Código TS/TSX con texto stale

| file:line | hallazgo | propuesta | risk |
|---|---|---|---|
| `src/lib/queries/sp13/finanzas/monthly-report.ts:25,41,151` | Tipo + cálculo `capaResidual` con comentario `// solo CAPA real` | Renombrar a `residualVsBomMp` y reescribir doc: "AVCO al despacho − BOM-MP recursivo. Es contaminación AVCO histórica + drift de precios MP". Cambiar callers en 3 archivos (downstream). | bajo (rename interno) |
| `src/lib/queries/sp13/finanzas/monthly-report-narrative.ts:132` | `lines.push(\`Residual CAPA inflada en 501.01: ...\`)` — pasa al prompt de Claude la premisa equivocada | Cambiar a `Residual AVCO vs BOM-MP en 501.01.01: ${fmt(c.residualVsBomMp)} MXN (contaminación AVCO histórica + drift precios MP, NO double counting)` | medio (afecta narrativa CFO mensual; bumpear cache key v1→v2) |
| `src/app/reporte/[period]/_components/pnl-comparison-table.tsx:138-142` | Texto user-facing `<strong>Residual CAPA inflado en 501.01.01:</strong>` | Cambiar copy a `<strong>Residual AVCO vs BOM-MP (501.01.01):</strong> ${fmt(dResidual)} — diferencia entre AVCO al despacho y costo MP recursivo (refleja contaminación AVCO histórica del PT pre-abril, no overhead duplicado).` | bajo (UI) |
| `src/lib/queries/sp13/finanzas/cogs-adjusted.ts:1-77 (header doc)` | Doc del módulo describe "overhead duplicado removido vía CAPA" | Reescribir el comentario module-level (líneas 30-37, 45-52, 95-100, 145-150) para reflejar AVCO. Dejar la lógica intacta — el "raw = contable + capa" sigue calculando bien lo que ocurrió, solo cambia la interpretación. | bajo |
| `src/lib/queries/sp13/finanzas/cogs-adjusted.ts:283,293` | Cache key `sp13-finanzas-cogs-comparison-v3-imports-refunds` | Considerar bumpear a `v4-avco-doc` cuando cambies los comments — opcional, no afecta lógica. | trivial |
| `src/lib/queries/sp13/finanzas/cogs-monthly.ts:15` | Comment `cogs_capa = asientos de "CAPA DE VALORACIÓN" del mes` | Aclarar: el RPC sigue devolviendo este campo (existe en `cogs_monthly_cache`), pero documentar como histórico: "Estos asientos casi no aparecen post-1-abril-2026 porque RSI56 fue archivado y CAPA mensual ya no se ejecuta". | trivial |
| `src/lib/queries/sp13/finanzas/account-expense-detail.ts:82-92` | Función `diagnoseSourceJournal` retorna textos `"Aquí cae la inflación CAPA porque incluye overhead embebido"` y `"Asiento manual de capa para limpiar el overhead duplicado"` | Reescribir los 2 strings a: 501.01.01 con journal "Facturas de cliente" → `"Auto-COGS de Odoo: AVCO al despacho. Incluye contaminación AVCO histórica del PT (MOD+OH absorbido pre-1-abril-2026, RSI56 archivado)."`. Para "CAPA DE VALORACIÓN" → `"Asiento manual histórico para alinear inventario contra BOM/realidad. Pre-abril era ajuste mensual; post-abril casi no se usa."` | bajo |
| `src/lib/queries/sp13/finanzas/inventory-adjustments.ts:42,64,438,461` | Categoría `capa_manual: "CAPA manual"` en taxonomía de ajustes de inventario | **Mantener as-is**. Sigue siendo el bucket correcto para asientos del journal "CAPA DE VALORACIÓN". El label "CAPA manual" describe la operación contable real, no la premisa errónea. | n/a |
| `src/lib/queries/sp13/finanzas/pnl.ts:18,52,100,165` | Comments `cogs501_01_01Mxn: number; // 501.01.01 Cost of sales — la CAPA inflada por Odoo` (4 hits) | Cambiar comment a `// 501.01.01 — AVCO al despacho. Incluye contaminación AVCO histórica del PT pre-abril.` Aplica replace en los 4 sitios. | bajo |
| `src/lib/queries/sp13/finanzas/pnl.ts:18` (header) | Doc `501.01    Cost of sales (debería ser solo MP; residuo vs BOM = CAPA pendiente)` | Cambiar a `501.01 = COGS AVCO al despacho. Residuo vs BOM = contaminación AVCO histórica + drift MP.` | bajo |
| `src/app/contabilidad/_components/blocks/pnl-block.tsx:143-150` | KpiCard `subtitle` y `definition.description` mencionan "ajuste manual del diario CAPA DE VALORACIÓN" + "raw = contable + capa" | Mantener fórmula (es histórica y correcta) pero actualizar `description`: `"Costo de ventas contable AVCO al despacho. Si hay asientos en el diario CAPA DE VALORACIÓN, se restan al raw (era el ajuste mensual pre-1-abril-2026; post-abril casi no se usa)."` | bajo |
| `src/app/contabilidad/_components/blocks/pnl-block.tsx:752-754` | JSDoc `501.01.02 COSTO PRIMO contable — cuenta de cierre histórica (CAPA mensual vía RSI56, archivado 1-abr-2026)` | OK pero confuso. Cambiar a `501.01.02 COSTO PRIMO — cuenta de cierre histórica del ciclo MP (RSI56 archivado 1-abr-2026 → cuenta inactiva).` | trivial |
| `src/app/contabilidad/cuenta/[code]/page.tsx:18-19` | Comment ya está actualizado correctamente (Nota 2026-05-04). | Mantener. | n/a |
| `src/lib/queries/sp13/finanzas/pnl.ts:341` cache key `sp13-finanzas-pnl-kpis-v8-501-01-split` | Premisa actual ya OK (split en 3 buckets) | Mantener; no rebumpear porque la lógica no cambió. | n/a |
| `src/lib/queries/sp13/finanzas/projection.ts:292,1293` | Comments mencionan "double-count" pero en contexto de impuestos / forecast — NO relacionado con CAPA | Ignorar. | n/a |
| `src/lib/agents/director-chat-context.ts:324,335` | `standard_price` campo de Odoo (precio, no costing method) | Ignorar. | n/a |

**Total**: ~15 hits para revisar; todos en `src/lib/queries/sp13/finanzas/` excepto 3 UI.
Fix recomendado: 1 commit con rename + comments + UI copy + bumpear 1 cache key
(`sp13-finanzas-monthly-report-narrative-v1` → `v2`).

---

## (2) Prompts de IA con premisa stale

| Archivo | Hallazgo | Propuesta |
|---|---|---|
| `src/lib/queries/sp13/finanzas/monthly-report-narrative.ts:40-98` (SYSTEM_PROMPT) | El system prompt **NO** menciona CAPA/Standard. OK. Pero el user prompt línea 132 sí pasa "Residual CAPA inflada en 501.01" como dato. | Cambiar línea 132 (cubierto en sección 1) y bumpear cache key del export v1→v2. |
| `src/lib/queries/sp13/finanzas/account-expense-narrative.ts` | SYSTEM_PROMPT no menciona CAPA/Standard. Los strings de `diagnoseSourceJournal` que sí mencionan CAPA viajan al user prompt vía `account-expense-detail.ts` (campo `journal_diagnosis`). | Al fixear `account-expense-detail.ts:89,92` (sección 1), el dato que llega al prompt queda actualizado. Bumpear `sp13-account-expense-narrative-v1` → `v2`. |
| `src/lib/queries/sp13/finanzas/cross-account-narrative.ts` | SYSTEM_PROMPT y user prompt son neutros, sin referencias CAPA/Standard. | Mantener. |
| `src/lib/agents/director-chat-context.ts` | Solo `standard_price` (precio Odoo). | Mantener. |
| `src/app/api/chat/route.ts` | RAG general, sin referencias específicas a CAPA. | Mantener. |

**Riesgo**: si las narrativas mensuales ya cacheadas (1h ISR) corrieron entre
2026-05-04 PM y la fecha de este audit, dirán "CAPA inflada" hasta el próximo
revalidate. Bumpear las 2 cache keys fuerza regeneración inmediata.

---

## (3) Supabase RPCs/views/MVs — SQL ejecutable

```sql
-- ─────────────────────────────────────────────────────────────────────────
-- (3a) Listado verificado de objetos potencialmente obsoletos
-- ─────────────────────────────────────────────────────────────────────────

-- get_capa_posted_per_month: ya NO tiene consumers en src/ (verificado vía grep).
-- Su action asociada 'monthly-capa-workflow' está en wont_fix.
-- Propuesta: DROP. (la migration 20260504_capa_workflow.sql que la creó debe
-- considerarse obsoleta — ver sección 5).
-- DROP FUNCTION IF EXISTS public.get_capa_posted_per_month(text, text);

-- _compute_cogs_comparison_monthly + get_cogs_comparison_monthly + cogs_monthly_cache
-- + refresh_cogs_monthly_cache: SIGUEN consumidos por src/lib/queries/sp13/finanzas/cogs-monthly.ts
-- y por /api/pipeline/refresh-cogs-monthly. El framing "comparison" venía de la premisa
-- vieja, pero los datos siguen válidos: el cache ahora se interpreta como
-- "AVCO contable vs BOM-MP recursivo". El cálculo es correcto bajo AVCO también.
-- Propuesta: NO DROP. Renombrar es opcional y costoso (migration + code change).
-- Documentar en código que el "comparison" significa AVCO-vs-BOM-MP, no Standard-vs-Real.

-- ─────────────────────────────────────────────────────────────────────────
-- (3b) Verificar que no quedó otra mugre ─ ejecutar como check antes de drops:
-- ─────────────────────────────────────────────────────────────────────────

-- Funciones con "capa" en el nombre:
SELECT proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
WHERE n.nspname='public' AND p.prokind='f' AND p.proname ILIKE '%capa%';
-- Esperado: solo get_capa_posted_per_month.

-- Tablas/views/MVs con "capa" o "comparison" o "workflow":
SELECT 'view' k, table_name FROM information_schema.views
  WHERE table_schema='public' AND (table_name ILIKE '%capa%' OR table_name ILIKE '%workflow%history%')
UNION ALL
SELECT 'mv', matviewname FROM pg_matviews
  WHERE schemaname='public' AND (matviewname ILIKE '%capa%' OR matviewname ILIKE '%workflow%history%')
UNION ALL
SELECT 'tbl', table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_type='BASE TABLE'
    AND (table_name ILIKE '%capa%' OR table_name ILIKE '%workflow%history%');
-- Esperado vacío. (Verificado al 2026-05-05: vacío.)

-- ─────────────────────────────────────────────────────────────────────────
-- (3c) Drop propuesto (NO ejecutar sin aprobación)
-- ─────────────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.get_capa_posted_per_month(text, text);
-- COMMENT: huérfana después de eliminar CapaWorkflowCard. Sin consumers en código.
```

---

## (4) Pending actions ledger — revisión bajo AVCO

```sql
-- Snapshot ejecutable para refresh manual:
SELECT action_key, area, severity, status,
       LEFT(title, 80) AS title, estimated_impact_mxn
FROM public.odoo_pending_actions
ORDER BY status, CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         action_key;
```

### `wont_fix` (5) — verificar que el note de "obsoleto" se appendeó correctamente

| action_key | status | acción |
|---|---|---|
| `monthly-capa-workflow` | wont_fix | OK |
| `reclassify-501-01-01-as-mp` | wont_fix | OK |
| `reclassify-501-01-02-as-scrap` | wont_fix | OK |
| `reinterpret-pnl-limpio-mod-oh` | wont_fix | OK |
| `investigate-real-cost-method` | wont_fix | OK |

Verificar que `workaround_in_silver` termina con `[2026-05-04] OBSOLETO: premisa incorrecta...`:

```sql
SELECT action_key, RIGHT(workaround_in_silver, 200) AS tail
FROM public.odoo_pending_actions
WHERE status='wont_fix'
ORDER BY action_key;
```

### `open` críticas/high — validez bajo AVCO

| action_key | severity | validez bajo AVCO | nota |
|---|---|---|---|
| `pnl-limpio-rewrite-avco-regimen` | high | ✅ válida | nuevo, premisa AVCO correcta |
| `revaluar-inventario-pt-contaminacion-avco` | critical | ✅ válida | nuevo, $6.34M |
| `configure-workcenters-acabado-tintoreria-entretelas` | high | ✅ válida | nuevo |
| `investigate-renta-abril-baja` | medium | ✅ válida | nuevo |
| `operationalize-cfdi-backlog` | critical | ✅ válida | $40M, no relacionado a costing |
| `manufacturing-variance-tracking` | high | ⚠ revisar | "Variance MP real vs BOM > $10M en MOs activos" — el framing "variance" asume Standard. Bajo AVCO, la "variance" es entre BOM-recursivo (post-abril) y avg_cost_mxn de MP. Reescribir `problem_description` para reflejar AVCO. |
| `assign-cost-to-bom-leaves` | high | ✅ válida | sigue válido — hojas sin avg_cost rompen BOM-recursivo independiente del régimen |
| `separate-corp-vs-factory-overhead` | low | ✅ válida | independiente del régimen |
| `fix-45-skus-without-avg-cost` | low | ✅ válida | crítico para BOM-recursivo bajo AVCO |
| `capitalize-import-landed-cost` | high | ✅ válida | sigue válida (importados I) |
| `capture-ap-invoices-from-sat` | high | ✅ válida | $6.4M, no relacionado a costing |
| `sync-sat-cancellations-to-odoo` | high | ✅ válida | no relacionado a costing |
| `audit-canonical-products-coverage` | medium | ✅ válida | crítico para BOM-recursivo |
| `dedupe-active-products` | medium | ✅ válida | independiente |
| `fix-bom-empty-priority` | medium | ✅ válida | resuelta en código (priority `num_lines > 0`); marcar `resolved` |
| `merge-multi-active-boms` | medium | ✅ válida | independiente |
| `configure-product-categories-for-variance` | medium | ⚠ revisar | título "for-variance" es framing Standard. Bajo AVCO no hay variance per se. Renombrar a `configure-product-categories-for-cost-tracking` o cerrar como `wont_fix` si ya no aplica. |
| `distinguish-physical-return-vs-price-nc` | medium | ✅ válida | independiente |
| `validate-cfdi-amount-pre-timbre` | medium | ✅ válida | independiente |
| `validate-cfdi-date-drift` | low | ✅ válida | independiente |

### Acciones SQL propuestas

```sql
-- Cerrar action que ya está implementada en código:
-- UPDATE public.odoo_pending_actions
-- SET status='resolved',
--     workaround_in_silver = workaround_in_silver || E'\n\n[2026-05-05] RESUELTA en commit 0f038f7: BOM-recursivo prioriza BOMs activas con num_lines > 0.'
-- WHERE action_key='fix-bom-empty-priority' AND status='open';

-- Renombrar manufacturing-variance-tracking (framing Standard → AVCO):
-- UPDATE public.odoo_pending_actions
-- SET problem_description = REPLACE(problem_description, 'Variance MP real vs BOM',
--                                   'Gap entre stock_moves (AVCO al consumo) y BOM-recursivo (avg_cost canonical)'),
--     workaround_in_silver = workaround_in_silver || E'\n\n[2026-05-05] Reframing AVCO: el "variance" es residual de contaminación AVCO histórica + drift de precios MP, no Standard variance.'
-- WHERE action_key='manufacturing-variance-tracking';

-- Decidir sobre configure-product-categories-for-variance:
-- Opción A: cerrar como wont_fix bajo AVCO.
-- Opción B: renombrar a configure-product-categories-for-cost-tracking.
-- Esperar input del CEO antes de mover.
```

---

## (5) Migrations huérfanos / contradictorios

Migrations relevantes (locales, NO trackeadas en `supabase_migrations.schema_migrations`,
pero los objects sí existen en DB):

| Migration | Estado | Diagnóstico | Propuesta |
|---|---|---|---|
| `20260504_capa_workflow.sql` | aplicada (RPC existe) | Crea `get_capa_posted_per_month` (sin consumers). Inserta action `monthly-capa-workflow` con ON CONFLICT DO UPDATE — al re-ejecutar, **sobrescribe `problem_description` y `fix_in_odoo`** con la narrativa CAPA obsoleta. `pending_actions_avco_regime.sql` ya marcó status=wont_fix, pero el upsert no toca status, así que el record queda en wont_fix con narrativa errónea. | Crear migration `20260505_drop_capa_workflow.sql` que: (a) `DROP FUNCTION get_capa_posted_per_month`, (b) borrar action `monthly-capa-workflow` (o dejar wont_fix con nota correcta). El archivo `20260504_capa_workflow.sql` puede dejarse como histórico (don't reapply). |
| `20260504_audit_pm_pending_actions.sql` | aplicada (5 actions existen) | Inserta 5 actions con ON CONFLICT DO UPDATE. **3 de las 5** (`reinterpret-pnl-limpio-mod-oh`, `investigate-real-cost-method`, una más) ahora son wont_fix; al re-ejecutar restaura el problem_description CAPA-era. Sigue conflict-update sin tocar status. | Mismo patrón: crear migration de cleanup que reescribe `problem_description` y `fix_in_odoo` para los 3 wont_fix con la narrativa AVCO actual. **No borrar** el archivo (es referencia histórica); evitar re-aplicar. |
| `20260504_pending_actions_avco_regime.sql` | aplicada | Migration **correcta** que cerró las 5 viejas y abrió 4 nuevas. | Mantener. |
| `20260504_cost_centers_overhead.sql` | aplicada (3 tablas + 3 RPCs) | Premisa AVCO correcta. | Mantener. |
| `20260504_account_expense_drilldown.sql`, `20260504_audit_pm_pending_actions.sql`, `20260504_bom_recursive_priority_lines.sql`, `20260504_cross_account_movements.sql`, `20260504_inventory_reconciliation_shrinkage.sql`, `20260504_odoo_pending_actions.sql`, `20260504_pnl_limpio_imports_and_refunds_fix.sql`, `20260504_reporte_mom_drivers.sql`, `20260504_sat_odoo_pending_actions.sql` | aplicadas | Funcionalidad activa, premisas correctas. | Mantener. |

**Acción concreta propuesta** (NO ejecutada):

Crear `supabase/migrations/20260505_cleanup_obsolete_capa_premise.sql`:

```sql
-- Cleanup post-corrección de premisa AVCO (2026-05-05)
-- Quita el RPC huérfano de CAPA workflow y reescribe descriptions de
-- actions que están en wont_fix pero con narrativa obsoleta.

-- 1. Drop RPC sin consumers
DROP FUNCTION IF EXISTS public.get_capa_posted_per_month(text, text);

-- 2. Reescribir descriptions para actions wont_fix con narrativa stale
UPDATE public.odoo_pending_actions
SET problem_description = '[OBSOLETO 2026-05-04] La premisa que motivó esta acción (Standard valuation con CAPA inflada en 501.01.01) fue reemplazada por la real: Quimibond usa AVCO. Acción mantenida en wont_fix por trazabilidad. Ver pnl-limpio-rewrite-avco-regimen para el reemplazo.'
WHERE action_key IN (
  'reclassify-501-01-01-as-mp',
  'reclassify-501-01-02-as-scrap',
  'monthly-capa-workflow',
  'reinterpret-pnl-limpio-mod-oh',
  'investigate-real-cost-method'
)
AND status='wont_fix';
```

---

## (6) Cache keys versionadas — bumps recomendados

| File | Cache key actual | Bump? | Razón |
|---|---|---|---|
| `monthly-report-narrative.ts:223` | `sp13-finanzas-monthly-report-narrative-v1` | **v1 → v2** | El user prompt cambia (línea 132: "Residual CAPA inflada" → "Residual AVCO vs BOM-MP"). Sin bump las narrativas cacheadas seguirán contando el cuento viejo hasta 1h después. |
| `account-expense-narrative.ts:134` | `sp13-account-expense-narrative-v1` | **v1 → v2** | El input `journal_diagnosis` cambia (sección 1, account-expense-detail.ts). |
| `cross-account-narrative.ts:100` | `sp13-cross-account-narrative-v1` | mantener | El prompt no cambia bajo la corrección. |
| `monthly-report.ts:327` | `sp13-finanzas-monthly-report-v2-501-01-split` | mantener (o bump al rename) | Si renombras `capaResidual → residualVsBomMp`, la signature del object cambia → bump opcional `v2` → `v3-avco-rename`. |
| `cogs-adjusted.ts:283,293` | `sp13-finanzas-cogs-comparison-v3-imports-refunds` | mantener | La lógica no cambió, solo comments. |
| `cogs-monthly.ts:149` | `sp13-finanzas-cogs-monthly-v2-imports-refunds` | mantener | Igual. |
| `cogs-per-product.ts:124` | `sp13-finanzas-cogs-per-product-v2-imports-refunds` | mantener | Igual. |
| `pnl.ts:341,373` | `sp13-finanzas-pnl-kpis-v8-501-01-split`, `sp13-finanzas-pnl-waterfall-v5-paginated` | mantener | El split en 3 buckets ya existe. Lógica intacta. |
| `shrinkage-tracker.ts:167` | `sp13-finanzas-shrinkage-v3-net` | mantener | Independiente. |

**Total**: 2 bumps obligatorios (las dos narrativas que tocan COGS), opcional 1
si se hace el rename `capaResidual`.

---

## (7) Cached monthly reports

```sql
-- Verificar que NO existe tabla de cache persistente
SELECT table_name FROM information_schema.tables
WHERE table_schema='public'
  AND (table_name ILIKE '%report_synthesis%'
       OR table_name ILIKE '%narrative_cache%'
       OR table_name ILIKE '%monthly_report%');
-- Resultado verificado al 2026-05-05: vacío.
```

Las narrativas mensuales sólo se cachean vía Next.js `unstable_cache`
(in-memory + Vercel ISR, TTL 1h). **No hay flush DB-level requerido** — bumpear
los cache keys de la sección 6 invalida automáticamente al deploy.

Si querés ser conservador y forzar regeneración inmediata sin esperar deploy:

```bash
# En Vercel, llamar revalidateTag manualmente:
# curl -X POST 'https://<app>/api/revalidate?tag=finanzas&secret=<CRON_SECRET>'
# (asumiendo que existe el endpoint — verificar antes en src/app/api/)
```

---

## (8) UI copy stale

Cubierto en sección 1. Resumen single-table:

| file:line | hallazgo | propuesta | risk |
|---|---|---|---|
| `src/app/contabilidad/_components/blocks/pnl-block.tsx:143-150` | Description menciona "CAPA DE VALORACIÓN" + "raw = contable + capa" | Reescribir description (cubierto en sección 1). Mantener fórmula. | bajo |
| `src/app/contabilidad/_components/blocks/pnl-block.tsx:752-754` | JSDoc `(CAPA mensual vía RSI56, archivado)` | Aclarar (cubierto en sección 1). | trivial |
| `src/app/reporte/[period]/_components/pnl-comparison-table.tsx:138` | Texto user-facing "Residual CAPA inflado" | Cambiar a "Residual AVCO vs BOM-MP" (cubierto en sección 1). | bajo |
| `src/app/contabilidad/cuenta/[code]/page.tsx:18` | Comment `Nota 2026-05-04: las premisas Standard/CAPA fueron reemplazadas por AVCO.` | Mantener (es la nota correcta). | n/a |

---

## Resumen ejecutivo

**Bug fixes encontrados (no de premisa, listos para fix inmediato):**

- Ninguno. La lógica funciona; lo que está stale son etiquetas, comments y
  narrativas. La corrección de premisa AVCO ya hizo todo el trabajo
  algorítmico necesario.

**Cleanup propuesto (en orden de prioridad):**

1. **Bumpear 2 cache keys de narrativas** (`monthly-report-narrative-v1→v2`,
   `account-expense-narrative-v1→v2`) — sin esto, el reporte mensual del
   próximo mes va a leer "Residual CAPA inflada" como input. ⚠ urgente.
2. **Reescribir el string de línea 132 en `monthly-report-narrative.ts`** —
   junto al bump de v1→v2.
3. **Reescribir los 2 strings de `diagnoseSourceJournal` en
   `account-expense-detail.ts:89,92`** — junto al bump.
4. **Cambiar 1 línea de UI copy en `pnl-comparison-table.tsx:138`** — bajo riesgo.
5. **Aplicar migration de cleanup** `20260505_cleanup_obsolete_capa_premise.sql`
   (drop del RPC + rewrite de descriptions wont_fix). Bajo riesgo.
6. **Reescribir comments en `pnl.ts`, `cogs-adjusted.ts`, `cogs-monthly.ts`,
   `pnl-block.tsx`** — cosmético, en un solo commit.
7. **Opcional**: rename `capaResidual` → `residualVsBomMp` en `monthly-report.ts`
   (3 archivos downstream) — refactor de claridad.
8. **Decisión pending**: cerrar `fix-bom-empty-priority` (ya implementado),
   reframing de `manufacturing-variance-tracking` y
   `configure-product-categories-for-variance`.

**Total estimado**: 1 commit de comments + 1 migration + 2 cache key bumps +
3-4 string edits. Sin riesgo destructivo. Aprobá los puntos 1-6 y arranco;
puntos 7-8 los discutimos antes.

---

*Audit generado 2026-05-05 desde branch `claude/fix-valuation-documentation-NMcuy`
(== origin/main, commit fb18dc6).*
