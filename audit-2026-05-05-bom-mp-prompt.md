# Audit prompt — BOM-MP recursive cost vs accounting AVCO

> Copy this prompt as a **new message in a clean session from main**
> (commit `2e1b111` or newer).

---

Investigá a fondo si el costo primo BOM-MP recursivo es confiable para
comparar contra el P&L contable mes a mes. Necesito decidir si la columna
"Limpio" de /contabilidad es accionable o ruido.

## Contexto breve

Quimibond usa AVCO en Odoo. La página /contabilidad muestra una tabla
"contable vs limpio" donde:

- **Contable**: 501.01.01 AVCO al despacho (cuadra al peso vs stock_moves)
- **Limpio**: BOM-MP recursivo = Σ(qty vendida × costo_MP_recursivo) por SKU

Función pivote: `public.get_bom_raw_material_cost_per_unit(p_product_id)`
Cache: `public.cogs_monthly_cache` (refrescada por cron)
Frontend: `src/lib/queries/sp13/finanzas/cogs-adjusted.ts`

## Invariante que sí cuadra

Δ utilidad neta (limpio − contable) == cogs_501_01_01 − BOM-MP recursivo.
Verificado para los 4 meses de 2026. La matemática del swap está bien.
**El problema es que el INPUT (BOM-MP) puede estar mal.**

## Evidencia que prende las alarmas

### (a) Residual cambia de SIGNO mes a mes

Inconsistente con la teoría "AVCO contaminado por PT pre-1-abril":

| Mes      | Residual        |
| -------- | --------------- |
| Ene 2026 | −$1,075,078     |
| Feb 2026 | +$154,833       |
| Mar 2026 | −$854,450       |
| Abr 2026 | +$1,803,309     |
| YTD      | +$28,613 (~0)   |

Si la premisa fuera correcta, residual debería ser SIEMPRE positivo
(AVCO incluye contaminación histórica MOD+OH del PT pre-abril vía
RSI56 archivado). El que cancele a ~0 al año sugiere que el modelo
está "bouncing" sin sesgo claro.

### (b) Top SKUs con BOM-MP > precio venta

| SKU                          | Precio | BOM    | Margen |
| ---------------------------- | ------ | ------ | ------ |
| X140NT165 POLYCOTTON 140     | $11.00 | $15.54 | −41%   |
| WC090Q11JNT165 PES CREP 90   | $6.09  | $6.82  | −12%   |

Improbable a esa escala — más probable que BOM esté inflada.

### (c) Audit del 2026-05-04 PM

En `odoo_pending_actions` wont_fix `'investigate-real-cost-method'`
reportó: "ratio sistemático COGS unit ≈ 30-40% del standard_price para
78/78 SKUs vendidos. Sospecha: `canonical_products.avg_cost_mxn` está
populado desde standard_price snapshot, NO desde el moving-average AVCO
real". Acción cerrada como wont_fix tras la corrección de premisa AVCO,
pero la sospecha de fondo (avg_cost ≠ AVCO real) sigue sin resolverse.

### (d) Hojas sin costo

100 de 317 hojas (32%) en BOMs activas tienen `avg_cost_mxn` NULL/0.
Cuando aparecen en una BOM, contribuyen $0 → costo subestimado.
Pending action `'assign-cost-to-bom-leaves'` (open).

### (e) Multi-BOM

89 productos tienen 2+ BOMs activas. La función `primary_bom` hace
tie-break heurístico (con-líneas, code='', min id). Pending
`'merge-multi-active-boms'`.

### (f) Sin conversión de UoM

No hay conversión UoM en la recursión. Si BOM define qty en m² y la
hoja MP tiene `avg_cost` por kg, no se convierte.

## Preguntas que tenés que responder

### 1) ¿De dónde viene `canonical_products.avg_cost_mxn`?

- Inspeccioná los triggers / la lógica que lo poble (matchers,
  bronze→silver). Pista: revisar `src/lib/matchers/` y migrations
  `20260423_sp3_*matcher_product*`.
- Compará `canonical.avg_cost_mxn` vs `odoo_products.standard_price`
  vs `odoo_products.qty_available × <algún campo de valor>`.
- Si `avg_cost = standard_price`, eso es **Standard cost, no AVCO**.

### 2) ¿Cuál es el AVCO real al consumo de MP en producción?

- `mv_mo_actual_material_cost` ya existe — ver migrations
  `20260423_sp12*`. Para cada manufacturing order, suma `value` de
  los `stock_moves` de consumo de MP. Eso es el AVCO real.
- Comparar: para los top 20 SKUs vendidos en abril 2026,
  BOM-MP teórico (qty venta × `get_bom_raw_material_cost_per_unit`)
  vs MP real consumido en sus MOs (`mv_mo_actual_material_cost`
  promediado por unidad producida).
- Si BOM-MP teórico ≠ MO real, tenemos el delta de confianza por SKU.

### 3) ¿Cuántos pesos del BOM-MP de abril están "soportados" por costo real reciente vs. costo histórico desactualizado?

- Para cada hoja MP, traer última compra (`odoo_purchase_orders` +
  lines, últimos 90d) y comparar precio compra vs `canonical.avg_cost`.
- Si los precios de compra recientes son sustancialmente distintos
  del `avg_cost` stored, BOM-MP es ruido.

### 4) ¿Hay productos con multi-BOM donde la elegida es la equivocada?

- Lista los 89 productos con 2+ BOMs activas.
- Para los que están en ventas abril 2026, ver qué BOM usaría la
  función actual y qué BOM se usa en sus MOs reales recientes.
- Si difieren, la función está eligiendo mal.

### 5) Cycle protection ¿está under-counting MP compartidos?

Encontrá un caso concreto: producto cuya BOM tenga el mismo MP
en 2 paths distintos (e.g. tela base + acabado adicional con tela
base). Verificar si la recursión solo cuenta la primera ocurrencia.

## Entregable

Un solo doc Markdown `audit-2026-05-X-bom-mp-confidence.md` con:

### (A) Tabla por SKU para los TOP 30 vendidos en 2026 (no solo abril)

```
SKU | qty_vendida_anual | revenue | precio_unit | BOM-MP_teórico
    | MO_real_avg_unit | gap_abs | gap_pct | confidence_flag
```

Donde `confidence_flag` = `'ok'` si gap < 10%, `'warn'` 10-25%,
`'alert'` > 25%.

### (B) Análisis del % del costo limpio anual que está soportado por:

- hojas con `avg_cost` reciente (compra <90d) ← **high confidence**
- hojas con `avg_cost` stale (compra >180d o sin compra) ← **low conf**
- hojas sin `avg_cost` (contribuyen $0) ← **cero confidence**

Cuantificar en MXN y % del total.

### (C) Lista concreta de los SKUs donde la BOM elegida ≠ BOM usada en MO reales

(multi-BOM resolution incorrecta).

### (D) Recomendación final

El costo primo BOM-MP para P&L mes-a-mes es
{confiable / no confiable / parcialmente confiable}. Si es
parcial, qué % del COGS limpio mensual se puede tomar como
"directional" y qué % es ruido.

### (E) SQL ejecutable (comentado, NO ejecutar)

DDL/UPDATE propuestos para fixear las top 3 causas raíz si las querés
arreglar (ej. trigger para popular `avg_cost_mxn` desde `stock_moves`
en vez de `standard_price`).

## Constraints

- **NO modificar código de producción sin autorización explícita** —
  esto es solo investigación y reporte.
- **NO ejecutar UPDATE/DDL en DB** — solo leer y proponer.
- Si encontrás un bug claro de código (no de premisa), fixealo
  inmediatamente y reportalo separado del análisis principal.
- Trabajar en branch nuevo `claude/audit-bom-mp-confidence-XXXXX`
  desde main (commit `2e1b111` o posterior).

## Archivos de interés

- `src/lib/queries/sp13/finanzas/cogs-adjusted.ts` (consumer del cache)
- `src/lib/queries/sp13/finanzas/cogs-monthly.ts` (serie histórica)
- `src/lib/queries/sp13/finanzas/cogs-per-product.ts` (per-SKU)
- `src/lib/queries/sp13/finanzas/mp-quality.ts` (calidad MP)
- `supabase/migrations/20260423_sp3_07_canonical_products_ddl.sql`
- `supabase/migrations/20260423_sp3_*_matcher_product*.sql`
- `supabase/migrations/20260423_sp12*.sql` (MO actual material cost)
- `supabase/migrations/20260504_pnl_limpio_imports_and_refunds_fix.sql`
  (donde se agregó el short-circuit `' I'` suffix)

## RPCs de interés

- `get_bom_raw_material_cost_per_unit(int)` ← función pivote
- `get_cogs_recursive_mp(date, date)` ← suma vía RPC live (lenta)
- `get_product_sales_revenue(date, date)` ← revenue 4xx canonical
- `_compute_cogs_comparison_monthly(date, date)` ← lo que pobla el cache
- `refresh_cogs_monthly_cache()` ← cron entry point

## Tablas / MVs de interés

- `canonical_products` (`avg_cost_mxn`, `internal_ref`, etc.)
- `canonical_stock_moves` (1.64M rows, `value`=AVCO al consumo)
- `mrp_boms` + `mrp_bom_lines` (jerarquía BOM)
- `mv_mo_actual_material_cost` (costo MP real por MO)
- `mv_bom_standard_cost` (BOM con `standard_price`, legacy)
- `cogs_monthly_cache` (lo que el frontend lee hoy)
- `odoo_account_entries_stock` (asientos contables)
- `odoo_purchase_orders` + `odoo_invoice_lines` (precios compra/venta)

## Contexto histórico

- **Pre-1-abril-2026**: BOMs incluían MOD+gastos vía productos token
  RSI56. Esos productos fueron archivados, pero el journal "Valoración
  del inventario" sigue posteando ~$1.2M/mes a cuenta 501.01.02 —
  investigá si esa es contaminación residual o un mecanismo distinto.

- **Workcenters**: solo TEJIDO CIRCULAR configurado en Odoo (40
  máquinas, $74.57/hr, go-live mayo 2026). Acabado/Tintorería/
  Entretelas/Insp-Empaque no absorben MOD+OH al PT al producirse.

- **5 actions** están en `wont_fix` por la corrección AVCO pero los
  problemas de costo siguen vivos: `reclassify-501-01-01-as-mp`,
  `reclassify-501-01-02-as-scrap`, `monthly-capa-workflow`,
  `reinterpret-pnl-limpio-mod-oh`, `investigate-real-cost-method`.

---

**Empezá con la pregunta (1).** El resto solo importa si `avg_cost_mxn`
viene de `standard_price` (que es la sospecha mayor).
