# Frontend KPI Audit — Datos incorrectos en múltiples páginas

**Fecha:** 2026-04-23
**Contexto:** Usuario reporta "en ventas me dice que llevo 7.3M pero no es verdad" y similares en varias páginas. Decisión: auditoría KPI-por-KPI antes de cualquier rebuild.
**Alcance:** Hero KPIs (las cifras grandes de arriba) de las páginas principales. Tablas y gráficas quedan para auditoría Fase 2.

---

## TL;DR

El problema **no es "datos sin conectar"**. Es **semántica**: hay tres hallazgos raíz que afectan varias páginas a la vez.

| # | Hallazgo | Severidad | Páginas afectadas |
|---|---|---|---|
| 1 | Mezcla P&L contable vs SAT fiscal sin etiqueta | **CRÍTICO** | /ventas, /finanzas |
| 2 | History hardcoded a 12 meses cuando Supabase tiene 60 | **ALTO** | /ventas, /finanzas, /empresas (detail) |
| 3 | `gold_revenue_monthly` grand-total MV sólo tiene 1 fila (bug) | **MEDIO** | cualquier KPI que use MA3m global |
| 4 | Algunas KPIs posiblemente sobre bronze legacy (requiere verificación) | POR VERIFICAR | /finanzas (getCfoSnapshot ya migrado en 86a4c12) |

Abajo el detalle con evidencia.

---

## Hallazgo 1 — P&L contable vs facturación SAT (CRÍTICO)

**Síntoma del usuario:** "En /ventas me dice 7.3M pero no es verdad."

**Qué pasa:** `/ventas` lee `gold_pl_statement.total_income` (P&L contable Odoo del GL). Usuario compara mentalmente con facturación SAT (canonical_invoices). Son dos números distintos y la diferencia es sistémica.

**Evidencia (18 meses consecutivos):**

| Mes | CFDIs SAT (MXN c/IVA) | P&L (abs) | Diff | Diff % |
|---|---|---|---|---|
| 2026-04 (MTD día 23) | 8,314,094 | 7,379,304 | +934,790 | **+11.2%** |
| 2026-03 | 29,492,624 | 16,066,217 | +13,426,407 | **+45.5%** ⚠️ |
| 2026-02 | 15,309,521 | 12,549,120 | +2,760,401 | +18.0% |
| 2026-01 | 11,269,358 | 8,839,734 | +2,429,624 | +21.6% |
| 2025-12 | 20,091,635 | 16,547,250 | +3,544,385 | +17.6% |
| 2025-11 | 11,923,578 | 9,857,619 | +2,065,959 | +17.3% |
| 2025-10 | 14,232,356 | 12,290,956 | +1,941,400 | +13.6% |
| 2025-09 | 15,300,353 | 13,256,285 | +2,044,068 | +13.4% |
| 2025-08 | 17,345,179 | 14,324,866 | +3,020,314 | +17.4% |
| 2025-07 | 16,532,250 | 14,011,505 | +2,520,745 | +15.2% |
| 2025-06 | 17,233,118 | 14,447,398 | +2,785,721 | +16.2% |
| 2025-05 | 17,180,271 | 14,317,670 | +2,862,601 | +16.7% |
| 2025-04 | 15,948,694 | 14,363,564 | +1,585,130 | +9.9% |
| 2025-03 | 19,732,139 | 17,202,575 | +2,529,564 | +12.8% |
| 2025-02 | 19,105,432 | 16,278,001 | +2,827,432 | +14.8% |
| 2025-01 | 17,652,686 | 15,447,842 | +2,204,844 | +12.5% |
| 2024-12 | 10,203,286 | 7,323,762 | +2,879,524 | +28.2% |
| 2024-11 | 17,418,890 | 13,787,261 | +3,631,629 | +20.8% |

**Causas:**

1. **IVA (~16%):** `amount_total_mxn_resolved` incluye IVA; `total_income` es subtotal (GL sales income). Explica ~15% del gap mes a mes.
2. **Facturas SAT no contabilizadas en Odoo:** Marzo 2026 muestra 45.5% — no se explica sólo con IVA. Hay CFDIs timbrados que no se asentaron en Odoo (o se asentaron en cuenta no-income). Requiere investigación.
3. **Devoluciones/ajustes contables:** El P&L incluye refunds/notas de crédito; el filtro SAT-issued-vigente las excluye. Diferencia a favor o en contra según mes.

**Decisión de diseño pendiente:** ¿Cuál es "ventas" en /ventas?
- **Opción α — SAT fiscal:** más oficial, cuadra con Hacienda. Usar `canonical_invoices` directo.
- **Opción β — P&L contable:** más consistente con el estado de resultados. Usar `gold_pl_statement`.
- **Opción γ — Ambos, etiquetados:** "Ingresos fiscales (SAT)" y "Ingresos contables (P&L)" como dos KPIs lado a lado.

Recomendación: **γ** — el usuario necesita ambos y hoy sólo ve uno sin saberlo.

---

## Hallazgo 2 — History truncado a 12 meses

**Síntoma del usuario:** "Con canonical debería de poder ver todo el tiempo, ¿no?"

**Sí.** Pero el frontend corta.

**Evidencia:**

| Fuente Supabase | Cobertura real | Lo que muestra UI |
|---|---|---|
| `gold_pl_statement` | **2021-01 → 2026-04 (60 periodos)** | 12 meses |
| `canonical_invoices` | 2021-05-25 → 2026-04-17 (60 meses) | 12 meses |

**Código afectado:**
- `src/lib/queries/operational/sales.ts:225` — `getSalesRevenueTrend(months = 12)` hardcoded
- `src/lib/queries/operational/sales.ts:101-106` — `gold_pl_statement.select().limit(26)` — 2 años máximo
- `src/lib/queries/analytics/finance.ts` — `getPlHistory(12)` (probablemente igual)

**Fix trivial:** cambiar default a `months = 60` + exponer selector "All time / 5y / 3y / 12m / YTD" en UI.

---

## Hallazgo 3 — `gold_revenue_monthly` grand-total roto

**Evidencia:**

```sql
SELECT MIN(month_start), MAX(month_start), COUNT(*)
FROM gold_revenue_monthly WHERE canonical_company_id IS NULL;
-- → 2025-03-01 | 2025-03-01 | 1
```

Sólo hay **una fila** de grand-total cuando debería haber 60+. La MV no está generando las filas `canonical_company_id IS NULL` correctamente.

**Uso en UI:** `getSalesKpis.ma3m` y sparklines de /ventas. El sparkline probablemente se ve vacío o constante.

**Fix:** Revisar la definición de `gold_revenue_monthly` en Supabase — probablemente la agregación `GROUP BY GROUPING SETS` o `ROLLUP` no está generando el total global. Requiere inspección de la MV.

---

## Inventario de hero KPIs por página (estado verificado)

### /ventas

| KPI | Helper | Fuente | Estado |
|---|---|---|---|
| Ingresos del mes | `getSalesKpis.ingresosMes` | `gold_pl_statement.total_income` (abs) | **Mezcla hallazgo 1** — usuario espera SAT |
| Utilidad operativa | `getSalesKpis.utilidadOperativaMes` | `gold_pl_statement.net_income` | OK como P&L |
| YoY | `getSalesKpis.ingresosYoyPct` | `gold_pl_statement` | Mismo hallazgo 1 |
| Pedidos del mes | `getSalesKpis.pedidosMes` | `canonical_sale_orders` | OK (orders, no facturas) |
| Chart 12m | `getSalesRevenueTrend(12)` | `gold_pl_statement` | **Hallazgo 1 + 2** |
| MA3m | grand-total de `gold_revenue_monthly` | MV rota | **Hallazgo 3** |
| Top customers | `getTopCustomersPage` | `gold_company_360.revenue_90d_mxn` | ¿Coincide con KPI de arriba? Probar |
| Top salespeople | `getTopSalespeople` | `canonical_sale_orders` del mes | OK |

### /finanzas

Commits recientes (86a4c12, 7ecdcd2, 3bdcae3) migraron `getCfoSnapshot` a canonical. El Explore agent devolvió info stale mencionando `odoo_bank_balances`. **Necesita verificación in-situ** (2ª sesión).

Estado esperado después de migración:
- Cash position: `canonical_bank_balances.current_balance_mxn`
- AR vencido: `canonical_invoices` direction=issued + residual
- Deuda tarjetas: `canonical_bank_balances` por classification

Ground truth actual (SQL corrido hoy):
- Bank total MXN: **$3,376,985** (no hay cash journal con balance)
- AR total abierto: **$285,147,145** en 336 facturas (nota: suena alto — verificar filtro "abierto" en helper)
- AR vencido: **$67,167,696** (44% de las facturas abiertas)
- AR 90+ días: **$6,094,207**

### /cobranza (SP6-03 merged)

Merged 2026-04-22. Usa `canonical_invoices` per spec. No verificado este audit. Ground truth AR total: $285M. Si /cobranza no lo muestra parecido, hay bug.

### /compras

Explore agent indica lectura de `odoo_purchase_orders`, `odoo_invoices`, `odoo_payments` (bronze). Si cierto, hay oportunidad de migrar a `canonical_purchase_orders` + `canonical_invoices` direction='received'. Ground truth: PO del mes = $2.1M en 80 órdenes.

### /empresas (SP6-02 merged)

Usa `canonical_companies` y `gold_company_360`. OK.

### /productos

Usa `canonical_products` + `gold_product_performance`. Aparentemente OK. No verificado.

### /operaciones

Usa `ops_delivery_health_weekly` (tabla custom). No canonical. Pendiente decidir si migrar a `canonical_deliveries` + `canonical_manufacturing`.

### /inbox (SP6-01 merged)

Usa `gold_ceo_inbox`. OK.

---

## Priorización de fixes

### Tier 1 — Visible y distorsiona decisiones (hacer primero)

1. **/ventas — KPI principal (hallazgo 1 + 2 + 3 juntos)**
   - Split "Ingresos SAT" / "Ingresos P&L" con badges
   - Levantar límite de 12 meses → selector de rango
   - Arreglar MV `gold_revenue_monthly` grand-total
   - Wire sparkline a serie real

2. **Investigar anomalía de marzo 2026 (45.5% gap)**
   - Probable: CFDIs timbrados sin asentar en Odoo ese mes
   - Tool: query `canonical_invoices` marzo WHERE sources_present = ['sat'] → debería haber varios millones sin Odoo counterpart
   - Si confirma, se vuelve un insight operativo (avisar que hay $13M timbrados sin booking contable)

### Tier 2 — Consistencia entre páginas

3. **/finanzas — verificar migración canonical post-86a4c12**
   - Leer `getCfoSnapshot` actual (no el audit stale)
   - Validar AR total coincide con /cobranza ($285M)
   - Validar cash position

4. **/cobranza — sanity check vs ground truth**
   - Ground truth AR total $285M, overdue $67M
   - Si /cobranza muestra distinto (ya migrado SP6-03), hay bug

### Tier 3 — Migraciones pendientes

5. **/compras — migrar a canonical**
   - `odoo_purchase_orders` → `canonical_purchase_orders`
   - `odoo_invoices` (received) → `canonical_invoices` direction='received'
   - AR del supplier side: ground truth PO mes $2.1M

6. **/operaciones — decisión estratégica**
   - Mantener `ops_delivery_health_weekly` o migrar a `canonical_deliveries`
   - Evaluar cuándo SP11 (stock vs accounting MVs) aporta KPIs acá

### Tier 4 — Hallazgos de MV/infra

7. **Refrescar/corregir `gold_revenue_monthly`**
   - Grand-total sólo 1 fila → revisar DDL + pg_cron
   - Ver docs/superpowers/specs/2026-04-21-silver-architecture.md sección SP4

---

## Lo que NO se tocó en este audit

- Tablas y gráficas secundarias (sólo hero KPIs)
- /equipo, /directores, /briefings, /sistema, /chat, /showcase
- /contactos, /ventas/cohorts, /compras/stockouts, /compras/price-variance, /compras/costos-bom
- Numeros dentro del detail de /empresas/[id]

Si después del Tier 1+2 siguen apareciendo "datos incorrectos" en esas páginas, Fase 2 del audit las cubre.

---

## Próximo paso propuesto

Con este diagnóstico, hay dos caminos:

**A) Fix Tier 1 (/ventas end-to-end) como canary.** 1 sesión. Demuestra el patrón (dual SAT/P&L + history ampliada + MV arreglada) y luego se replica a /finanzas y /cobranza.

**B) Fix sistémico primero.** Un helper unificado `getRevenueSeries({source:'sat'|'pl', from, to})` + arreglar MV + luego migrar páginas. Más limpio pero más largo.

Recomiendo **A** para ver si el patrón resuelve el síntoma antes de abstraer.
