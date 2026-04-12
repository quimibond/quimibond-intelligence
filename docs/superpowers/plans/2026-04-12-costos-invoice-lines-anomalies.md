# Costos: Detección de Anomalías a Nivel de Línea de Factura

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exponer al Director de Costos (y al Comercial) datos a nivel de línea de factura individual desde `odoo_invoice_lines` — hoy la tabla tiene 20,691 filas sincronizadas desde 2011 pero NINGÚN director la consulta directamente; todos leen agregados vía `product_margin_analysis`, lo que oculta eventos puntuales (ventas bajo costo, creep de descuento por vendedor, descuentos sobredimensionados a clientes nuevos).

**Architecture:** Dos vistas SQL nuevas en Supabase que se construyen sobre `odoo_invoice_lines` JOIN `odoo_products` (para `standard_price`) y agregan por ventana temporal: (1) `invoice_line_margins` — facturas de venta con margen bruto por línea, flag `below_cost`, para los últimos 90 días; (2) `customer_discount_trend` — descuento promedio por `(odoo_partner_id, product_ref)` comparando 90d vs 365d, flag cuando el delta es material. Luego se añaden 2 queries al `case "costos"` y 1 query al `case "comercial"` en `src/app/api/agents/orchestrate/route.ts`. Sin cambios en el addon Odoo.

**Tech Stack:** Supabase (PostgreSQL views via migration), TypeScript query wiring en Next.js 15 API route, MCP `apply_migration` para deploy a prod.

**Assumptions verificadas:**
- `odoo_invoice_lines` tiene columnas: `id, odoo_line_id, odoo_move_id, company_id, odoo_partner_id, move_name, move_type, invoice_date, odoo_product_id, product_name, quantity, price_unit, discount, price_subtotal, price_total, synced_at, product_ref`.
- `odoo_products` tiene `standard_price`, `avg_cost`, `internal_ref`, `odoo_product_id`.
- `move_type = 'out_invoice'` = factura de venta (out_refund = nota crédito, in_* = compras).
- `product_margin_analysis` existe y sigue siendo válido como agregado; NO lo tocamos.
- `invoice_date` puede ser NULL en notas de crédito sin fecha — filtrar `WHERE invoice_date IS NOT NULL`.
- `discount` está en porcentaje (0-100), `price_unit` ya es post-descuento al calcular `price_subtotal = quantity * price_unit * (1 - discount/100)`. Verificar antes de asumir fórmula.
- Worktree fresh desde `origin/main` (último SHA `11c380d`).

**Fuera de scope:**
- Detección de anomalías en facturas de PROVEEDOR (move_type='in_invoice') — ya cubierto por `purchase_price_intelligence`.
- `odoo_sale_orders.margin` / `margin_percent` al `case "comercial"` — plan separado.
- `odoo_purchase_orders.date_approve` a compras — plan separado.
- Refactor de `product_margin_analysis` — la vista se queda igual.

---

## File Structure

**Crear:**
- `supabase/migrations/20260412_invoice_line_margins_view.sql` — vista `invoice_line_margins`
- `supabase/migrations/20260412_customer_discount_trend_view.sql` — vista `customer_discount_trend`

**Modificar:**
- `src/app/api/agents/orchestrate/route.ts`
  - `case "costos"` (aprox L1188-1198): añadir 2 queries `belowCostLines` y `discountCreep`, añadir 2 secciones al template literal.
  - `case "comercial"` (aprox L1091-1094): añadir 1 query `salesDiscountCreep`, añadir 1 sección al template literal.

No nuevos archivos TS. No tests unitarios TS porque no hay lógica nueva en TypeScript — solo queries. Las "pruebas" son SQL de verificación sobre la vista + smoke test end-to-end del endpoint.

---

## Tareas

### Task 1: Vista `invoice_line_margins`

**Files:**
- Create: `supabase/migrations/20260412_invoice_line_margins_view.sql`

**Objetivo:** Para cada línea de factura de venta en los últimos 90 días, calcular el costo unitario (vía JOIN a `odoo_products.standard_price`), el margen bruto absoluto, el margen porcentual y un flag `below_cost`. La vista expone solo filas con margen < 15% O `below_cost = true` O descuento > 20%, ordenadas por magnitud del problema. Máximo útil para prompt: ~100 filas.

- [ ] **Step 1: Escribir la migración**

Contenido exacto de `supabase/migrations/20260412_invoice_line_margins_view.sql`:

```sql
-- Vista: invoice_line_margins
-- Detección de eventos PUNTUALES de margen bajo / venta bajo costo en los últimos 90 días.
-- Complementa product_margin_analysis (que es agregado) con resolución a nivel factura+línea.

CREATE OR REPLACE VIEW invoice_line_margins AS
WITH base AS (
  SELECT
    il.id,
    il.move_name,
    il.invoice_date,
    il.odoo_partner_id,
    il.company_id,
    il.product_ref,
    il.product_name,
    il.quantity,
    il.price_unit,
    il.discount,
    il.price_subtotal,
    p.standard_price,
    p.avg_cost,
    COALESCE(NULLIF(p.avg_cost, 0), p.standard_price) AS unit_cost
  FROM odoo_invoice_lines il
  LEFT JOIN odoo_products p ON p.odoo_product_id = il.odoo_product_id
  WHERE il.move_type = 'out_invoice'
    AND il.invoice_date IS NOT NULL
    AND il.invoice_date >= (CURRENT_DATE - INTERVAL '90 days')
    AND il.quantity > 0
    AND il.price_unit > 0
),
computed AS (
  SELECT
    b.*,
    (b.price_unit - b.unit_cost) AS margin_per_unit,
    CASE
      WHEN b.unit_cost IS NULL OR b.unit_cost = 0 THEN NULL
      ELSE ROUND(((b.price_unit - b.unit_cost) / b.price_unit * 100)::numeric, 1)
    END AS gross_margin_pct,
    (b.price_unit < b.unit_cost) AS below_cost,
    (b.quantity * (b.price_unit - b.unit_cost)) AS margin_total
  FROM base b
)
SELECT
  c.id,
  c.move_name,
  c.invoice_date,
  c.odoo_partner_id,
  co.name AS company_name,
  c.product_ref,
  c.product_name,
  c.quantity,
  c.price_unit,
  c.discount,
  c.unit_cost,
  c.gross_margin_pct,
  c.below_cost,
  c.margin_total,
  c.price_subtotal
FROM computed c
LEFT JOIN companies co ON co.id = c.company_id
WHERE c.gross_margin_pct IS NOT NULL
  AND (
    c.gross_margin_pct < 15
    OR c.below_cost = true
    OR c.discount > 20
  )
ORDER BY
  c.below_cost DESC,
  c.gross_margin_pct ASC NULLS LAST;

COMMENT ON VIEW invoice_line_margins IS
  'Lineas de factura de venta con margen <15%, bajo costo, o descuento >20% (ultimos 90d). Complementa product_margin_analysis con eventos puntuales.';
```

- [ ] **Step 2: Aplicar la migración a Supabase prod**

Usar la herramienta `mcp__claude_ai_Supabase__apply_migration`:
- `project_id`: `tozqezmivpblmcubmnpi`
- `name`: `20260412_invoice_line_margins_view`
- `query`: el contenido SQL exacto de arriba.

Expected: `{"success": true}`.

- [ ] **Step 3: Verificación por query**

Usar `mcp__claude_ai_Supabase__execute_sql` con:

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE below_cost) AS below_cost,
       count(*) FILTER (WHERE gross_margin_pct < 15) AS low_margin,
       count(*) FILTER (WHERE discount > 20) AS high_discount,
       min(gross_margin_pct) AS worst_margin,
       max(discount) AS max_discount
FROM invoice_line_margins;
```

Expected: `total` es un entero > 0 (probablemente 20-500, depende de cuánto ruido real hay). `worst_margin` puede ser negativo si hay ventas bajo costo. Si `total = 0` la vista está filtrando demasiado o Odoo no tiene ventas recientes — investigar antes de continuar, no proceder.

- [ ] **Step 4: Sanity check de una fila concreta**

```sql
SELECT move_name, product_ref, price_unit, unit_cost, gross_margin_pct, below_cost, company_name
FROM invoice_line_margins
ORDER BY margin_total ASC
LIMIT 5;
```

Expected: 5 filas con datos coherentes. Las primeras deben ser las de peor margen (más negativo o más bajo). Si aparecen filas con `unit_cost = 0` algo está mal en el COALESCE — revisar.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260412_invoice_line_margins_view.sql
git commit -m "feat(db): vista invoice_line_margins para deteccion de eventos puntuales de margen"
```

---

### Task 2: Vista `customer_discount_trend`

**Files:**
- Create: `supabase/migrations/20260412_customer_discount_trend_view.sql`

**Objetivo:** Para cada `(odoo_partner_id, product_ref)` con ≥3 facturas en el último año, comparar el descuento promedio de los últimos 90d vs el promedio de los 365d anteriores al día de corte, exponiendo delta. Flag cuando el delta ≥ 5 puntos porcentuales y el revenue acumulado justifica atención. Esto detecta dos patrones: "cliente viejo empezó a pedir rebajas" y "vendedor está dando descuento a un cliente que antes pagaba lista".

- [ ] **Step 1: Escribir la migración**

Contenido exacto de `supabase/migrations/20260412_customer_discount_trend_view.sql`:

```sql
-- Vista: customer_discount_trend
-- Detecta creep de descuento por (cliente, producto) comparando 90d recientes vs 365d previos.

CREATE OR REPLACE VIEW customer_discount_trend AS
WITH recent AS (
  SELECT
    il.odoo_partner_id,
    il.product_ref,
    avg(il.discount) AS avg_discount_90d,
    sum(il.price_subtotal) AS revenue_90d,
    count(*) AS invoices_90d
  FROM odoo_invoice_lines il
  WHERE il.move_type = 'out_invoice'
    AND il.invoice_date IS NOT NULL
    AND il.invoice_date >= (CURRENT_DATE - INTERVAL '90 days')
    AND il.product_ref IS NOT NULL
    AND il.quantity > 0
  GROUP BY il.odoo_partner_id, il.product_ref
),
baseline AS (
  SELECT
    il.odoo_partner_id,
    il.product_ref,
    avg(il.discount) AS avg_discount_prior,
    sum(il.price_subtotal) AS revenue_prior,
    count(*) AS invoices_prior
  FROM odoo_invoice_lines il
  WHERE il.move_type = 'out_invoice'
    AND il.invoice_date IS NOT NULL
    AND il.invoice_date < (CURRENT_DATE - INTERVAL '90 days')
    AND il.invoice_date >= (CURRENT_DATE - INTERVAL '455 days')
    AND il.product_ref IS NOT NULL
    AND il.quantity > 0
  GROUP BY il.odoo_partner_id, il.product_ref
)
SELECT
  r.odoo_partner_id,
  co.name AS company_name,
  r.product_ref,
  ROUND(r.avg_discount_90d::numeric, 1) AS avg_discount_90d,
  ROUND(b.avg_discount_prior::numeric, 1) AS avg_discount_prior,
  ROUND((r.avg_discount_90d - b.avg_discount_prior)::numeric, 1) AS discount_delta_pp,
  r.invoices_90d,
  b.invoices_prior,
  ROUND(r.revenue_90d::numeric, 0) AS revenue_90d,
  ROUND(b.revenue_prior::numeric, 0) AS revenue_prior,
  CASE
    WHEN (r.avg_discount_90d - b.avg_discount_prior) >= 10 THEN 'creep_alto'
    WHEN (r.avg_discount_90d - b.avg_discount_prior) >= 5  THEN 'creep_moderado'
    WHEN (r.avg_discount_90d - b.avg_discount_prior) <= -5 THEN 'mejora'
    ELSE 'estable'
  END AS trend_flag
FROM recent r
JOIN baseline b USING (odoo_partner_id, product_ref)
LEFT JOIN companies co ON co.odoo_partner_id = r.odoo_partner_id
WHERE r.invoices_90d >= 1
  AND b.invoices_prior >= 2
  AND abs(r.avg_discount_90d - b.avg_discount_prior) >= 5
ORDER BY
  (r.avg_discount_90d - b.avg_discount_prior) DESC,
  r.revenue_90d DESC;

COMMENT ON VIEW customer_discount_trend IS
  'Delta de descuento promedio por (cliente, producto) 90d vs 365d previos. Solo filas con creep >=5pp.';
```

- [ ] **Step 2: Aplicar migración**

Usar `mcp__claude_ai_Supabase__apply_migration` con `project_id=tozqezmivpblmcubmnpi`, `name=20260412_customer_discount_trend_view`, query = contenido SQL.

Expected: `{"success": true}`.

- [ ] **Step 3: Verificación de cardinalidad**

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE trend_flag = 'creep_alto') AS creep_alto,
       count(*) FILTER (WHERE trend_flag = 'creep_moderado') AS creep_moderado,
       count(*) FILTER (WHERE trend_flag = 'mejora') AS mejora,
       max(discount_delta_pp) AS max_delta,
       min(discount_delta_pp) AS min_delta
FROM customer_discount_trend;
```

Expected: total entre 5 y 500 dependiendo del ruido real. `max_delta` positivo grande (creep), `min_delta` negativo grande (mejora). Si `total = 0` la ventana de tiempo o el filtro es demasiado estricto — revisar antes de avanzar.

- [ ] **Step 4: Sanity check de los peores**

```sql
SELECT company_name, product_ref, avg_discount_prior, avg_discount_90d, discount_delta_pp, revenue_90d, trend_flag
FROM customer_discount_trend
WHERE trend_flag = 'creep_alto'
ORDER BY revenue_90d DESC
LIMIT 10;
```

Expected: 10 filas con nombres de empresa reconocibles, deltas ≥10pp, revenue_90d en miles/millones MXN.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260412_customer_discount_trend_view.sql
git commit -m "feat(db): vista customer_discount_trend para detectar creep de descuento"
```

---

### Task 3: Wire `invoice_line_margins` y `customer_discount_trend` en el Director de Costos

**Files:**
- Modify: `src/app/api/agents/orchestrate/route.ts` — case `"costos"` (actualmente L1188-1198)

**Objetivo:** Añadir 2 queries paralelas al Promise.all existente del case `"costos"` y 2 secciones nuevas al template literal del return. Las queries son de bajo costo (vistas pre-filtradas) y se limitan a 15 y 10 filas respectivamente.

- [ ] **Step 1: Localizar el case actual**

Abrir `src/app/api/agents/orchestrate/route.ts` y leer `case "costos"`. Debería verse así (L1188-1198):

```ts
    case "costos": {
      const [margins, deadStock, priceErosion, topProducts, purchasePrices, productCosts] = await Promise.all([
        sb.from("product_margin_analysis").select("product_ref, company_name, avg_order_price, avg_invoice_price, price_delta_pct, cost_price, gross_margin_pct, total_order_value").not("gross_margin_pct", "is", null).order("total_order_value", { ascending: false }).limit(20),
        sb.from("dead_stock_analysis").select("product_ref, stock_qty, inventory_value, days_since_last_sale, historical_customers, standard_price, list_price").order("inventory_value", { ascending: false }).limit(15),
        sb.from("product_margin_analysis").select("product_ref, company_name, avg_order_price, cost_price, gross_margin_pct, total_order_value").lt("gross_margin_pct", 15).not("gross_margin_pct", "is", null).order("total_order_value", { ascending: false }).limit(15),
        sb.from("odoo_products").select("internal_ref, name, stock_qty, standard_price, list_price").gt("stock_qty", 0).order("stock_qty", { ascending: false }).limit(15),
        sb.from("purchase_price_intelligence").select("product_ref, last_supplier, currency, avg_price, last_price, price_vs_avg_pct, total_spent").eq("price_flag", "price_above_avg").order("total_spent", { ascending: false }).limit(15),
        sb.from("odoo_products").select("internal_ref, name, standard_price, avg_cost, list_price, stock_qty").not("avg_cost", "is", null).gt("avg_cost", 0).order("stock_qty", { ascending: false }).limit(20),
      ]);
      return `${profileSection}## Margenes por producto+cliente (precio venta vs costo)\n${safeJSON(margins.data)}\n## ALERTA: productos con margen <15%\n${safeJSON(priceErosion.data)}\n## COMPRANDO MAS CARO que promedio (impacto en costos)\n${safeJSON(purchasePrices.data)}\n## Productos con costo promedio real (avg_cost de Odoo)\n${safeJSON(productCosts.data)}\n## Inventario muerto (dinero atrapado)\n${safeJSON(deadStock.data)}\n## Productos con mas stock\n${safeJSON(topProducts.data)}`;
    }
```

Si el contenido del archivo ha divergido de lo anterior, STOP y reporta — la línea numérica y el array destructurado deben coincidir antes de editar.

- [ ] **Step 2: Reemplazar el case**

Sustituir TODO el cuerpo del `case "costos"` por:

```ts
    case "costos": {
      const [margins, deadStock, priceErosion, topProducts, purchasePrices, productCosts, belowCostLines, discountCreep] = await Promise.all([
        sb.from("product_margin_analysis").select("product_ref, company_name, avg_order_price, avg_invoice_price, price_delta_pct, cost_price, gross_margin_pct, total_order_value").not("gross_margin_pct", "is", null).order("total_order_value", { ascending: false }).limit(20),
        sb.from("dead_stock_analysis").select("product_ref, stock_qty, inventory_value, days_since_last_sale, historical_customers, standard_price, list_price").order("inventory_value", { ascending: false }).limit(15),
        sb.from("product_margin_analysis").select("product_ref, company_name, avg_order_price, cost_price, gross_margin_pct, total_order_value").lt("gross_margin_pct", 15).not("gross_margin_pct", "is", null).order("total_order_value", { ascending: false }).limit(15),
        sb.from("odoo_products").select("internal_ref, name, stock_qty, standard_price, list_price").gt("stock_qty", 0).order("stock_qty", { ascending: false }).limit(15),
        sb.from("purchase_price_intelligence").select("product_ref, last_supplier, currency, avg_price, last_price, price_vs_avg_pct, total_spent").eq("price_flag", "price_above_avg").order("total_spent", { ascending: false }).limit(15),
        sb.from("odoo_products").select("internal_ref, name, standard_price, avg_cost, list_price, stock_qty").not("avg_cost", "is", null).gt("avg_cost", 0).order("stock_qty", { ascending: false }).limit(20),
        // NEW: lineas de factura con venta bajo costo o margen <15% (eventos puntuales, no agregados)
        sb.from("invoice_line_margins").select("move_name, invoice_date, company_name, product_ref, quantity, price_unit, unit_cost, gross_margin_pct, below_cost, margin_total, discount").order("margin_total", { ascending: true }).limit(15),
        // NEW: creep de descuento por (cliente, producto) 90d vs 365d
        sb.from("customer_discount_trend").select("company_name, product_ref, avg_discount_prior, avg_discount_90d, discount_delta_pp, revenue_90d, trend_flag").eq("trend_flag", "creep_alto").order("revenue_90d", { ascending: false }).limit(10),
      ]);
      return `${profileSection}## VENTAS BAJO COSTO / MARGEN <15% (eventos puntuales, ultimos 90d)\n${safeJSON(belowCostLines.data)}\n## CREEP DE DESCUENTO (cliente+producto subieron >=10pp vs historico)\n${safeJSON(discountCreep.data)}\n## Margenes por producto+cliente (agregado, precio venta vs costo)\n${safeJSON(margins.data)}\n## ALERTA: productos con margen <15% (agregado)\n${safeJSON(priceErosion.data)}\n## COMPRANDO MAS CARO que promedio (impacto en costos)\n${safeJSON(purchasePrices.data)}\n## Productos con costo promedio real (avg_cost de Odoo)\n${safeJSON(productCosts.data)}\n## Inventario muerto (dinero atrapado)\n${safeJSON(deadStock.data)}\n## Productos con mas stock\n${safeJSON(topProducts.data)}`;
    }
```

Notas:
- Se añadieron `belowCostLines` y `discountCreep` al destructuring.
- Las 2 queries nuevas van al final del Promise.all.
- Las 2 secciones nuevas van al PRINCIPIO del template literal (después de `profileSection`) porque son los hallazgos más accionables.
- Las secciones agregadas existentes se quedan como contexto de apoyo.

- [ ] **Step 3: Type check**

```bash
cd /Users/jj/qi-silenciar-directores && npx tsc --noEmit 2>&1 | tail -10
```

Expected: sin errores.

- [ ] **Step 4: Test suite sigue verde**

```bash
npx vitest run src/__tests__/agents/ 2>&1 | tail -10
```

Expected: 19 tests passing (no añadimos tests nuevos, solo confirmamos no-regresión).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/agents/orchestrate/route.ts
git commit -m "feat(costos): enchufar invoice_line_margins y customer_discount_trend al director"
```

---

### Task 4: Wire `customer_discount_trend` en el Director Comercial

**Files:**
- Modify: `src/app/api/agents/orchestrate/route.ts` — case `"comercial"` (actualmente L1091-1106)

**Objetivo:** El Director Comercial ya recibe `margins` vía `product_margin_analysis`. Añadimos una sola query al `customer_discount_trend` filtrada a `creep_alto` (top 10 por revenue) para que pueda generar insights sobre vendedores que están dando descuentos fuera de patrón.

- [ ] **Step 1: Leer el case actual**

```bash
sed -n '1090,1108p' src/app/api/agents/orchestrate/route.ts
```

Debería mostrar el case `"comercial"` con su Promise.all de 8 items (`reorderRisk, top, margins, concentration, recentOrders, crmLeads, clientThreads, clientOverdue`). Si el array destructurado tiene distinto número de elementos, STOP y reporta — un commit posterior puede haberlo movido.

- [ ] **Step 2: Añadir la 9ª query al Promise.all**

Añadir al final del array, justo antes del `]);`:

```ts
        // NEW: creep de descuento por (cliente, producto) — vendedor otorgando mas descuento que antes
        sb.from("customer_discount_trend").select("company_name, product_ref, avg_discount_prior, avg_discount_90d, discount_delta_pp, revenue_90d").eq("trend_flag", "creep_alto").order("revenue_90d", { ascending: false }).limit(10),
```

Y añadir `discountCreep` al destructuring:

De:
```ts
const [reorderRisk, top, margins, concentration, recentOrders, crmLeads, clientThreads, clientOverdue] = await Promise.all([
```

A:
```ts
const [reorderRisk, top, margins, concentration, recentOrders, crmLeads, clientThreads, clientOverdue, discountCreep] = await Promise.all([
```

- [ ] **Step 3: Añadir sección al template literal**

Localizar el `return` del case `"comercial"` (la línea que empieza con `` return `${profileSection}## REORDEN VENCIDO... ``).

Insertar ESTA sección nueva justo después de `## CLIENTES CON CARTERA VENCIDA (riesgo de relacion)` y antes de `## EMAILS DE CLIENTES SIN RESPUESTA (>24h)`:

```
## CREEP DE DESCUENTO (vendedor esta dando mas descuento que antes a estos clientes)
${safeJSON(discountCreep.data)}
```

Es decir, el template literal pasa de:
```
## CLIENTES CON CARTERA VENCIDA (riesgo de relacion)\n${safeJSON(clientOverdue.data)}\n## EMAILS DE CLIENTES SIN RESPUESTA (>24h)
```

A:
```
## CLIENTES CON CARTERA VENCIDA (riesgo de relacion)\n${safeJSON(clientOverdue.data)}\n## CREEP DE DESCUENTO (vendedor esta dando mas descuento que antes a estos clientes)\n${safeJSON(discountCreep.data)}\n## EMAILS DE CLIENTES SIN RESPUESTA (>24h)
```

- [ ] **Step 4: Type check**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: sin errores.

- [ ] **Step 5: Tests**

```bash
npx vitest run src/__tests__/agents/ 2>&1 | tail -10
```

Expected: 19 passing.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/agents/orchestrate/route.ts
git commit -m "feat(comercial): enchufar customer_discount_trend al director"
```

---

### Task 5: Smoke test end-to-end + deploy

**Files:** N/A (deploy + monitoreo)

**Objetivo:** Rebasear sobre origin/main, empujar a main, confirmar que las 2 queries nuevas no rompen nada y que el próximo ciclo de crons ve las vistas. CHECKPOINT humano antes del push.

- [ ] **Step 1: Fetch y rebase contra origin/main**

```bash
cd /Users/jj/qi-silenciar-directores
git fetch origin main
git rebase origin/main
```

Expected: rebase limpio, sin conflictos. Si hay conflictos en `src/app/api/agents/orchestrate/route.ts` (porque alguien más tocó el archivo), resolver a mano manteniendo ambas sets de cambios; STOP y reporta antes de continuar.

- [ ] **Step 2: Verificación post-rebase**

```bash
npx tsc --noEmit 2>&1 | tail -10
npx vitest run src/__tests__/agents/ 2>&1 | tail -10
```

Expected: tsc clean, 19 tests passing.

- [ ] **Step 3: Verificación de las vistas en Supabase**

Re-correr la query de sanity de Task 1 Step 3 y Task 2 Step 3 para confirmar que las vistas siguen vivas en prod tras cualquier cambio hecho entre tanto.

- [ ] **Step 4: CHECKPOINT humano**

Pausar aquí. Mostrar al usuario:
- Número de commits del branch
- Diff stat resumido
- Resultado de las sanity queries

Esperar aprobación explícita antes del push.

- [ ] **Step 5: Push**

```bash
git push origin HEAD:main
```

Vercel redeploya automáticamente.

- [ ] **Step 6: Esperar el próximo cron y capturar un insight de costos**

Esperar hasta 15 minutos (cron `/api/agents/orchestrate */15 min`). Luego:

```sql
SELECT id, title, description, severity, business_impact_estimate, created_at
FROM agent_insights
WHERE agent_id = (SELECT id FROM ai_agents WHERE slug='costos')
  AND created_at > now() - interval '30 minutes'
ORDER BY created_at DESC
LIMIT 5;
```

Expected: al menos 1 insight del director de costos con el ciclo post-deploy. Si el agente corrió y no generó nada, eso es normal (DirectorConfig puede estar filtrando todo si no hay señales de alto impacto). Si corrió y generó insights con contenido que menciona "bajo costo", "descuento" o nombres de facturas específicas (`INV/...`), la integración funciona.

Si el insight menciona un `move_name` concreto (ej. `INV/2026/04/0123`) y el nombre del cliente real, se confirma que `invoice_line_margins` llegó al prompt.

- [ ] **Step 7: Documentar resultados**

Añadir una sección "Resultados post-deploy" al final de este plan con los hallazgos del Step 6, y commitear:

```bash
git add docs/superpowers/plans/2026-04-12-costos-invoice-lines-anomalies.md
git commit -m "docs: resultados post-deploy del plan de costos invoice-lines"
git push origin HEAD:main
```

---

## Self-review

**Spec coverage:**
- "Exponer `odoo_invoice_lines` product-level a costos" → Tasks 1, 3 ✓
- "Detectar creep de descuento por vendedor/cliente" → Tasks 2, 4 ✓
- "Sin tocar el addon Odoo" → confirmado, todo vive en Supabase + TS ✓
- "Bajo costo para el prompt" → vistas pre-filtradas y queries con `.limit()`  tight ✓
- "Checkpoint humano antes del push a prod" → Task 5 Step 4 ✓

**Placeholder scan:** ninguno; cada step tiene SQL/código/bash exacto.

**Type consistency:**
- `invoice_line_margins` columnas usadas en Task 3 Step 2 (`move_name, invoice_date, company_name, product_ref, quantity, price_unit, unit_cost, gross_margin_pct, below_cost, margin_total, discount`) — todas definidas en Task 1 SQL ✓
- `customer_discount_trend` columnas usadas en Task 3 Step 2 y Task 4 Step 2 (`company_name, product_ref, avg_discount_prior, avg_discount_90d, discount_delta_pp, revenue_90d, trend_flag`) — todas definidas en Task 2 SQL ✓
- `trend_flag` valor usado: `'creep_alto'` — definido como literal en el CASE de Task 2 ✓
- El destructuring del case `"costos"` añade 2 nuevas posiciones al final, preservando el orden existente ✓
- El destructuring del case `"comercial"` añade 1 posición al final ✓

**Riesgo identificado no bloqueante:**
- `odoo_products.avg_cost` puede ser NULL para productos nunca vendidos. El COALESCE en Task 1 cae a `standard_price`. Si `standard_price` también es NULL, la fila se filtra vía `gross_margin_pct IS NOT NULL` en el WHERE final. No hay crash.
- La vista `customer_discount_trend` requiere `invoices_prior >= 2` en el baseline, lo que excluye clientes nuevos. Esto es intencional — sin historial no hay "trend" qué medir. Clientes nuevos con descuento excesivo deberían surgir vía `invoice_line_margins` (Task 1) si el descuento excede 20%.
- Vistas SQL son recomputadas en cada SELECT. Si se vuelven lentas, el siguiente plan puede materializarlas. Para cardinalidad esperada (<500 filas cada una sobre 20K base) no es problema.

---

## Execution

Plan guardado en `docs/superpowers/plans/2026-04-12-costos-invoice-lines-anomalies.md`.

Dos opciones de ejecución:

**1. Subagent-Driven (recomendado)** — subagente fresco por task, review automático entre tasks.

**2. Inline Execution** — ejecutar tareas en esta sesión con superpowers:executing-plans.

¿Cuál prefieres?
