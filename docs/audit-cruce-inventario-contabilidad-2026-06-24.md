# Auditoría — Cruce inventario ↔ contabilidad (2026-06-24)

> Cruce de **todos** los movimientos de inventario (`canonical_stock_moves`, 1.64M filas)
> contra los asientos contables ligados a stock (`odoo_account_entries_stock`,
> via `lines_stock` jsonb con pierna DR/CR por cuenta y producto). Objetivo:
> mapear cada tipo de operación en operación **y** contabilidad, e identificar
> discrepancias y costos duplicados. Período analizado: **2026-01-01 → 2026-06-24**.

## TL;DR

| Hallazgo | Impacto P&L 2026 YTD | Estado |
|---|---|---|
| **Doble conteo de refacciones** (compra a gasto `504` + relevo de inventario a costo `501`) | **~$2.39M** duplicado | Causa raíz: config Odoo |
| **Activo fijo / maquinaria cayendo a COGS** vía `501.01.08` diferencias por conteo | **~$3.59M** (de eso $3.43M es merma fantasma) | No debería estar en inventario |
| **Categoría genérica "All"** dumpeando a `501.01.08` | **$2.58M** merma fantasma | Categoría sin clasificar |
| **Merma fantasma total** por activar rastreo en no-inventario (refacc + activo fijo + All) | **~$8.0M** en `501.01.08` | El "comportamiento muy raro" |
| Cadena productiva real (MP→WIP→PT→COGS) | $39.9M netos a `501`, limpio | ✅ Sin problema |
| Subproducto saldo de tejido | COGS legítimo en AVCO | ✅ Ya manejado (`is_byproduct`) |

La cadena de manufactura está **sana**. Todo el desorden está aislado en
**compras de refacciones / activo fijo** y en **categorías legacy sin clasificar**,
y se disparó al activar *"rastrear inventario"* sobre productos que históricamente
se manejaban como gasto directo.

---

## 1. Mapa: cada operación en operación → contabilidad

`move_category` se deriva del par `location_usage → location_dest_usage` en el
stock move. Cada categoría tiene una firma contable esperada:

| Operación | Flujo físico (`usage`) | Movs 2026 | Asiento esperado (DR → CR) | ¿Limpio? |
|---|---|---:|---|:--:|
| **compra** | supplier → internal | 1,362 | **Storable:** DR `115.xx` inventario / CR `211` proveedor.<br>**Gasto/refacción:** DR `504.xx` gasto directo / CR proveedor | ⚠️ fork |
| **consumo_mp** | internal → production | 22,639 | DR `115.03.01` Producción en proceso / CR `115.02.01` Materia prima | ✅ |
| **produccion_pt** | production → internal | 6,975 | DR `115.04.01` Producto terminado / CR `115.03.01` Producción en proceso | ✅ |
| **venta** | internal → customer | 1,432 | (stock move sin asiento propio) vía factura cliente: DR `501.01.01` COGS / CR `115.04.01` PT | ✅ |
| **transfer_interno** | internal → internal | 7,133 | Sin asiento (valor $0) | ✅ |
| **ajuste_inventario** | internal ↔ inventory | 3,876 | DR/CR `115.xx` vs `501.01.02` (Costo por ajustes a cantidad) o `501.01.08` (Diferencias por conteo) | ⚠️ inflado |
| **devolucion_compra** | internal → supplier | 57 | Reversa de compra | ✅ |
| **devolucion_venta** | customer → internal | 24 | Reversa de venta | ✅ |

**El "fork" de la compra es la clave:** un producto storable correcto descarga la
compra a un **activo** (`115.xx`); una refacción/gasto la descarga directo a un
**gasto** (`504.xx`). El problema aparece cuando un producto hace **las dos cosas**.

### Cuentas involucradas (catálogo)

| Cuenta | Nombre | Tipo |
|---|---|---|
| `115.02.01` | Materia prima y materiales | Activo (inventario) |
| `115.03.01` | Producción en proceso (WIP) | Activo (inventario) |
| `115.04.01` | Productos terminados | Activo (inventario) |
| `115.04.03` | **Inventario refacciones** (cuenta dedicada, reciente) | Activo (inventario) |
| `501.01.01` | Costo de venta (COGS) | Costo directo |
| `501.01.02` | Costo por ajustes a cantidad / Variación de existencias | Costo directo |
| `501.01.08` | **Diferencias por conteo** (merma) | Costo directo |
| `504.01.00xx` | Mantenimientos fábrica, equipo auxiliar, agujados, etc. | **Gasto de fabricación** |

---

## 2. Doble conteo de refacciones — confirmado y exacto

### Ejemplo trazado: `CABLE0` (15-abr-2026)

| Asiento | Journal | Pierna |
|---|---|---|
| `FACTU/2026/04/045` | Facturas de proveedores | DR `504.01.0042` **$105,050** |
| `FACTU/2026/04/055` | Facturas de proveedores | DR `504.01.0005` **$210,100** |
| `STJ/2026/04/0697` | Valoración del inventario | CR `115.02.01` $315,150 / DR `501.01.02` **$315,150** |

El mismo cable de **$315,150** se reconoce **dos veces** en resultados:
`504` (gasto de compra) **+** `501.01.02` (relevo de inventario) = **$630,300**.
Exactamente el doble. Activar el rastreo de inventario creó la segunda pierna —
por eso hubo que mandar asientos a borrador.

### Exposición total 2026 (500 productos afectados)

| Concepto | Monto |
|---|---:|
| **Doble conteo estimado** (Σ por producto de `LEAST(compra-504, inventario-501)`) | **$2,390,208** |
| Total compra a gasto `504` (refacciones) | $2,539,006 |
| Total inventario relevado a costo `501` (refacciones) | $3,022,110 |

### Por qué pasa (causa raíz en Odoo)

Las refacciones tienen configurada una **cuenta de gasto** (`504.xx`) como cuenta
de gasto de la categoría/producto, y la factura de proveedor la descarga ahí
directo. Al activar **valuación automatizada de inventario** sobre el mismo
producto, Odoo **además** registra el movimiento de inventario (`115` ⇄ `501`).
Resultado: la compra vive en gasto **y** el inventario se releva a costo. Doble.

En una config anglosajona correcta, la factura debería pegar a una **cuenta
puente/activo** (no a `504`), de modo que neteara contra la recepción de inventario.

---

## 3. La causa raíz del "comportamiento muy raro": ~$8.0M de merma fantasma

Al prender el rastreo sobre productos que **no son inventario vendible**, el
sistema "descubrió" que el físico no cuadra con lo valuado y tiró la diferencia
a `501.01.08 Diferencias por conteo`:

| Familia | Neto a costo `501` | de eso, `501.01.08` (merma) | Compra a `504` |
|---|---:|---:|---:|
| Inventario real (MP/PT/proceso/empaque) | $39.93M | $0.18M (normal) | $0.23M |
| **Refacciones** | $4.83M | **$2.02M** | $2.54M |
| **Activo Fijo / Maquinaria** | $3.59M | **$3.43M** | $0.09M |
| **"All" (genérica)** | $2.58M | **$2.58M** | $0.07M |
| Servicios | $0.28M | $0.01M | $10.59M (correcto, va a gasto) |

→ **~$8.0M** de las "diferencias por conteo" provienen de refacciones + activo
fijo + categoría "All", **no** de merma real de tela. La merma legítima de
producto terminado/MP es chica ($0.18M). Junio solo en refacciones disparó
**$1.56M**.

**Tendencia `501.01.08` refacciones por mes:** Ene ~$0 · Feb $0 · Mar $63k ·
Abr $310k · May $199k · **Jun $1,556k** (al activar el rastreo).

Dato adicional: **maquinaria y "All" son aún más graves que refacciones** en
proporción — casi todo su "costo" es merma fantasma (no son productos que se
consuman ni se vendan; son activos o basura de categorización).

---

## 4. Subproducto saldo de tejido — sin bug contable

`SALDO TEJIDO D` ($1.89M en movimientos, 168 producciones, 12 ventas,
`is_byproduct=true`): contablemente **correcto en AVCO**. Sus asientos de
producción netean a cero en `115.03.01` (revaluaciones internas) y al venderse
genera COGS `501.01.01` legítimo, con el costo carvado del producto padre.
Es el mismo caso ya manejado en silver con `is_byproduct` (costo MP $0 en el
modelo BOM-recursivo). **No es un bug nuevo.** Acción: marcar `is_byproduct=true`
en cualquier subproducto nuevo que cree Quimibond.

---

## 5. Recomendación de tratamiento de refacciones (por subcategoría)

Análisis de retención de stock vs flujo 2026 para decidir inventario vs gasto:

| Subcategoría | Prods | Valor stock actual | Compras 2026 | Salidas 2026 | **Tratamiento recomendado** |
|---|---:|---:|---:|---:|---|
| Mantenimiento fábrica | 670 | $928k | $1.40M | $2.12M | **Inventario** (alto stock en anaquel) |
| Herramientas y equipo menor | 166 | $403k | $84k | $110k | **Inventario** (stock ≫ flujo; revisar si son activo fijo) |
| Equipo auxiliar | 41 | $306k | $371k | $338k | **Inventario** |
| General | 288 | $180k | $211k | $272k | **Inventario** |
| Uniformes | 7 | $151k | $89k | $106k | Gasto (consumo de personal) |
| Consumibles de cómputo | 18 | $80k | $128k | $30k | Gasto |
| Seguridad e higiene | 41 | $72k | $25k | $28k | Gasto |
| Agujados | 63 | $13k | $366k | $591k | Gasto / consumible de producción (flujo alto, retención casi nula) |
| Limpieza | 34 | $3k | $33k | $128k | **Gasto** (consumo inmediato) |
| Papelería y oficina | 34 | $3k | $16k | $42k | **Gasto** |
| Mantenimiento a equipo | 20 | $0 | $66k | $66k | **Gasto** (servicio) |
| Despensa | 5 | $0 | $6k | $5k | **Gasto** |

**Regla:** retención de stock real y valor significativo en anaquel → **inventario**;
consumo inmediato / valor de stock ~$0 → **gasto**.

- **Mantener en inventario (rotacionales con valor en anaquel, ~$1.8M):**
  `Mantenimiento fábrica`, `Herramientas y equipo menor`, `Equipo auxiliar`,
  `General`. Fix: que la **compra descargue al activo** `115.04.03 Inventario
  refacciones` (no a `504`), y el consumo haga DR `504`/`501` / CR `115`. Conteo único.
- **Pasar a gasto puro (sin rastreo de inventario):** `Limpieza`, `Papelería`,
  `Despensa`, `Seguridad e higiene`, `Uniformes`, `Consumibles de cómputo`,
  `Mantenimiento a equipo`, `Agujados`, `Otros gastos`. Fix: **apagar valuación
  de inventario** → compra a `504`, sin pierna `115`/`501`.

> Excepción a validar con activo fijo: parte de `Herramientas y equipo menor` y
> `Equipo auxiliar` pueden ser **activo fijo** (capitalizar a `15x`), no inventario.

---

## 6. Limpieza de categorías pendiente

Conviven dos nomenclaturas. Migrar las legacy a la jerarquía nueva:

| Categoría legacy | Prods | Destino |
|---|---:|---|
| `Generales-Consumibles-Refacciones-{pza,paquete,metro,kilo,millar,litro,galon,caja}` | 1,150+ | `Refacciones y Consumibles / {subcat}` |
| `Generales-Servicio-` | 348 | `Servicios y Gastos` (gasto, sin inventario) |
| `Producto En Proceso / Tac-*`, `Materia Prima / Tac-*`, etc. | ~200 | Familia real (quitar prefijo `Tac-`) |
| `All`, `All / Saleable / *`, `All / Expenses`, `All / Deliveries` | 543 | Clasificar; **NO** dejar con valuación inventario |
| `(vacía)` | 641 | Clasificar |
| `Revisar` | 1 | Clasificar |
| `Activo Fijo / Maquinaria`, `Activo Fijo / Herramienta mayor` | 32 | **Quitar valuación de inventario** → capitalizar |

**Crítico:** `Activo Fijo` y `All` no deben tener cuenta de valuación que pegue a
`501`. Mientras tengan rastreo, seguirán generando merma fantasma en `501.01.08`.

---

## Acciones recomendadas (root cause en Odoo)

1. **Refacciones — definir tratamiento por subcategoría** (tabla §5). Inventario:
   compra al activo `115.04.03`, no a `504`. Gasto: apagar valuación de inventario.
2. **Activo fijo / "All"** — quitar valuación de inventario; capitalizar maquinaria.
3. **Limpieza de categorías legacy** — migrar a la jerarquía nueva (§6).
4. **Conteo físico de refacciones** una vez corregida la config, para fijar el
   saldo real de `115.04.03` y dejar de "descubrir" merma cada mes.

> Las correcciones de raíz son configuración de Odoo (cuenta de valuación +
> cuenta de gasto + método de valuación por categoría de producto). El sistema
> silver puede **detectar y cuantificar** el doble conteo en curso, pero no
> corregir el asiento — eso se hace en Odoo.

### Queries de referencia

Todas las cifras salen de cruzar `odoo_account_entries_stock.lines_stock`
(unnest a pierna DR/CR por `account_code` + `product_id`) contra la categoría de
`odoo_products` y el `move_category` de `canonical_stock_moves`. Ver los queries
en el historial de esta auditoría.
