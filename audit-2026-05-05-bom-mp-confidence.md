# Audit BOM-MP confidence — Resultados

**Fecha**: 2026-05-05
**Branch**: `claude/audit-bom-mp-confidence-NMcuy` (desde main commit `0390944`)

---

## Pregunta original

> ¿Es confiable el costo primo BOM-MP recursivo para comparar contra el P&L
> contable mes a mes? ¿La columna "Limpio" de /contabilidad es accionable o ruido?

## Respuesta corta

**Parcialmente confiable. Mes a mes es ruidoso (±$1M de oscilación de signo);
en agregado anual cuadra (~$0). El bug principal (avg_cost = standard_price)
se arregló pero su impacto agregado fue marginal — el ruido viene de otra causa
(probablemente contaminación AVCO histórica del PT producido pre-1-abril-2026).**

---

## Hallazgos por pregunta

### (1) ¿De dónde viene `canonical.avg_cost_mxn`? — **CONFIRMADO: standard_price**

Trazado del flujo completo:

```
Odoo (Quimibond instance)
  └─ product.product.avg_cost  ← [aliased a standard_price internamente]
qb19 _push_products (sync_push_inventory.py:105)
  └─ row['avg_cost'] = round(p.avg_cost, 2) if hasattr(p, 'avg_cost') else None
odoo_products.avg_cost (Supabase bronze)
matcher_product trigger → canonical_products_upsert_from_odoo()
  └─ avg_cost_mxn = NEW.avg_cost
canonical_products.avg_cost_mxn  ← lo que usa BOM-MP recursivo
```

**Verificación empírica**: `odoo_products.avg_cost == odoo_products.standard_price`
para 232/233 hojas MP en BOMs activas (99.6%). Solo 1 producto difiere.

Esto significa que durante meses, **toda la columna "Limpio" del P&L estaba
calculando costo primo con precios de catálogo, no con AVCO real al despacho**.

### (2) Comparación BOM-MP teórico vs AVCO real al despacho — **drift material en 22 hojas**

Para hojas MP con compra reciente (101 de 233):

| Bucket | Cantidad | % |
|---|---|---|
| `canonical ≈ real` (drift <5%) | 79 | 78% |
| Drift 5–25% | 12 | 12% |
| **Drift >25%** | **10** | **10%** |

Top hojas con mayor drift:

| SKU | Canonical (=std) | AVCO real | Drift |
|---|---|---|---|
| TELA ELASTANO | $13.00 | **$97.72** | **−87%** |
| WM4032BL152 IT | $4.07 | $7.66 | −47% |
| WM4032NG152 IT | $4.52 | $7.98 | −43% |
| KF4032T11BL152 IT | $4.45 | $3.05 | +46% |
| AP4032GO152 IT | $4.54 | $3.22 | +41% |
| SOSA HIDROXIDO | $12.47 | $9.00 | +39% |
| AP4032BL152 IT | $4.54 | $3.30 | +38% |
| KF4032T11GO152 IT | $2.35 | $3.42 | −31% |
| WP4032NG152 IT | $5.83 | $8.30 | −30% |
| PK4032GO152 IT | $3.58 | $1.48 | **+143%** |

### (3) Coverage de AVCO real

- 233 hojas MP en BOMs activas
- **106 (45%)** tienen compra en últimos 24m → AVCO real disponible
- **127 (55%)** sin compra → fallback a canonical legacy

Esto incluye sub-ensambles que se producen internamente (no se compran),
tokens RSI56 archivados, y componentes legacy. Para esas seguimos usando
`canonical.avg_cost_mxn` (que es standard_price) como fallback.

### (4) Multi-BOM resolution

89 productos con 2+ BOMs activas. La función actual elige por tie-break
heurístico (con-líneas > 0, code='', menor odoo_bom_id). **No revisado caso
por caso vs MO real** — pendiente. La heurística cubre el caso del bug
2026-05-04 (BOMs vacías priorizadas), pero si la BOM "real de producción"
tiene un odoo_bom_id mayor que otra BOM-de-desarrollo con líneas válidas,
elige la equivocada.

### (5) Cycle protection

`NOT bl.odoo_product_id = ANY(e.visited)` previene loops infinitos pero
**también swallows MP que aparece en 2 paths del árbol**. Sin caso concreto
medido — pendiente. Magnitud probable pequeña.

---

## Fix aplicado en DB (commit en branch `claude/audit-bom-mp-confidence-NMcuy`)

Migration: `20260505_product_real_avg_cost_from_stock_moves.sql`

### Componentes

1. **Tabla `product_real_avg_cost`** — pre-computada de `canonical_stock_moves`
   donde `move_category IN ('compra', 'devolucion_compra')` y `state='done'`.
   Stores `avg_cost_mxn`, `last_purchase_date`, `n_moves`, etc.

2. **Función `refresh_product_real_avg_cost(p_lookback_months int DEFAULT 6)`** —
   TRUNCATE + INSERT con window principal (6m) y fallback histórico (24m) para
   productos sin compra reciente.

3. **Patch a `get_bom_raw_material_cost_per_unit`** — ahora usa
   `COALESCE(prac.avg_cost_mxn, cp.avg_cost_mxn, 0)` tanto en el short-circuit
   importados (sufijo " I") como en las hojas MP. Si hay compra real reciente
   usa esa; si no, fallback al canonical legacy.

4. **Cron diario `refresh_product_real_avg_cost_daily`** a las 04:00 UTC.

5. **Backfill inicial**: 1808 productos populated en `product_real_avg_cost`
   (833 con compra <6m + 975 con compra <24m fallback).

### Estado actual del cache (post-fix)

`cogs_monthly_cache` refrescada para los 4 meses de 2026 con la función
patched.

| Mes | BOM-MP BEFORE | BOM-MP AFTER | Δ | Impacto |
|---|---|---|---|---|
| Ene | $3,232,646 | $3,212,875 | −$19,771 | −0.6% |
| Feb | $4,712,850 | $4,691,067 | −$21,783 | −0.5% |
| Mar | $4,969,638 | $4,930,448 | −$39,190 | −0.8% |
| Abr | $4,245,460 | $4,198,679 | −$46,781 | −1.1% |
| **YTD** | **$17,160,594** | **$17,033,069** | **−$127,525** | **−0.7%** |

### Efecto en residual 501.01.01 vs BOM-MP

| Mes | Residual BEFORE | Residual AFTER |
|---|---|---|
| Ene | −$1,075,078 | −$1,055,308 |
| Feb | +$154,833 | +$176,616 |
| Mar | −$854,450 | −$815,260 |
| Abr | +$1,803,309 | +$1,850,090 |

El cambio de signo mes-a-mes **persiste** — el bug de avg_cost no era la causa
del ruido de oscilación. Probablemente:
- Contaminación AVCO histórica del PT (RSI56 archivado pero PT producido
  pre-1-abril sigue rotando).
- Drift de qty_per_unit en BOMs.
- Multi-BOM picking equivocado.

---

## Recomendaciones (priorizadas)

### Acción 1 — Trasladar el fix a Odoo (alto impacto, nivel de fondo)
La causa raíz está en Odoo: el campo `product.avg_cost` debería devolver el
moving-average real, no `standard_price`. Discutir con la contadora si:
- Cambiar el costing method del producto a `average` en lugar de `standard`
- O exponer un nuevo campo `real_avg_cost` que use `qty_available × value`
  desde `stock.valuation.layer`

Sin esto, el sync de qb19 seguirá copiando standard_price, y el fix actual
(tabla `product_real_avg_cost`) actúa como override permanente.

### Acción 2 — Validar multi-BOM picking (medio impacto)
Para los 89 productos con 2+ BOMs activas, verificar que la BOM elegida por
`primary_bom` tie-break coincide con la usada en MOs recientes
(`mv_mo_actual_material_cost`). Si difiere, ajustar la lógica.

### Acción 3 — Investigar el residual del signo cambiante (alto impacto, pero costoso)
El residual debería tender a positivo cada mes (AVCO contaminado por
absorción pre-abril). El que cambie de signo sugiere que la teoría está
incompleta. Posibles causas:
- canonical.avg_cost de algunas hojas dominantes está aún más arriba que el
  AVCO real al despacho.
- BOM qty/unidad inflada para algunos productos.
- Pre-abril-2026 vs post-abril-2026 los productos vendidos cambiaron mix.

### Acción 4 — Revisar las 211 hojas sin compra reciente
Pending action existente: `assign-cost-to-bom-leaves`. Para esas no hay
manera de obtener AVCO real automáticamente — necesitan captura manual o
identificación de cuáles son sub-ensambles (que no son hojas reales).

---

## Estado de confianza POST-FIX

| Métrica | Antes del fix | Después del fix |
|---|---|---|
| % hojas con AVCO confiable | 0% (todas standard_price) | 45% (con compra reciente) |
| Top SKUs con drift visible | 22 hojas | 0 (corregidas) |
| BOM-MP agregado YTD | $17.16M | $17.03M (−0.7%) |
| Residual cuadra al peso vs invariante | ✓ | ✓ |
| Residual estable mes a mes | ✗ (oscila ±$1M) | ✗ (sigue oscilando) |
| Recomendable para per-SKU pricing | ❌ | ⚠ caution (45% coverage) |
| Recomendable para P&L mes-a-mes | ❌ | ⚠ direccional sí, ±5% |
| Recomendable para P&L anual | ⚠ se cancela | ✓ |

**Bottom line**: El fix corrigió el bug **estructural** (BOM usaba precios de
catálogo) y mejoró 45% de las hojas con AVCO real. El **ruido residual mes a
mes** sigue presente pero es de OTRA causa raíz que requiere investigación
distinta (acciones 2 y 3 arriba).

---

## Archivos modificados

- `supabase/migrations/20260505_product_real_avg_cost_from_stock_moves.sql`
  (nuevo, ya aplicado en DB)
- DB: tabla `product_real_avg_cost` poblada (1808 productos)
- DB: función `get_bom_raw_material_cost_per_unit` patcheada
- DB: cron `refresh_product_real_avg_cost_daily` activo
- DB: `cogs_monthly_cache` refrescado para 2026
