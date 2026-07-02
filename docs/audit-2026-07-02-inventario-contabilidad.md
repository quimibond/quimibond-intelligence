# Auditoría profunda: cuentas de inventario ↔ stock moves (2026-07-02)

**Objetivo (CEO):** que el comportamiento contable de todas las cuentas de inventario
sea correcto contra los movimientos de stock, que ningún movimiento interno pegue a
resultados cuando no debe, y terminar con una **revaluación al costo reconstruido**
que deje el GL cuadrado **al centavo** con el inventario físico.

**Fuentes:** GL vigente (`odoo_account_balances`, rebuild completo horario — verdad
contable), asientos línea a línea (`odoo_account_entries_stock.lines_stock`),
movimientos físicos (`canonical_stock_moves`), catálogos de costo
(`product_cost_catalog`, `odoo_products`), RPCs de auditoría existentes y
`odoo_pending_actions`. Datos al 2026-07-02 ~20:30 UTC (post push manual completo).

---

## Resumen ejecutivo

El inventario contable NO cuadra con el físico y la causa no es la valuación
automática de Odoo (AVCO funciona) sino **cuatro prácticas manuales** que la
contaminan. En orden de gravedad:

| # | Hallazgo | Monto | Estado |
|---|---|---|---|
| F1 | Mapa categoría→cuenta de valuación roto: se vende desde WIP y el switch de junio dejó 115.01.01 **negativa** | −$3.14M (115.01.01) / $2.4M vendido desde 115.03 | Nuevo |
| F2 | Journal **CAPA DE VALORACIÓN sigue vivo**: capitaliza COGS→inventario a mano cada mes de 2026 | $15.07M en 2026; ~87% del saldo WIP | Nuevo (contradice premisa documentada) |
| F3 | El conteo físico de junio ($38.5M bruto) se **reclasificó a mano fuera del P&L**, $3.57M a equity 999998 | $4.85M neto removido de 501.01.08 | Nuevo |
| F4 | Punto ciego del sync: ediciones de líneas no re-sincronizan → **silver mostraba la versión pre-edición** | integridad de datos | **Fixeado en qb19 (este PR)** |
| F5 | Refacciones/activo fijo dentro del ciclo textil: doble capitalización + conteos a COGS | $4.15M dup YTD + $663k jun a 501.01.08 | Conocido, sin fix de raíz |
| F6 | Gap de valuación: GL $51.6M vs físico Odoo $43.1M vs reconstruido ~$47–57M según política | ±$6M por decisión de política | Cuantificado |
| F7 | Higiene: 4 SKUs stock negativo (−$492k), 15 SKUs stock sin costo, saldo/desperdicio $85k valuado | ~$0.6M | Menor |

**El orden importa:** revaluar (F6) sin antes arreglar F1–F5 es imposible de cuadrar
— cada mes los asientos manuales vuelven a descuadrar el GL. El plan va de la raíz
hacia afuera.

---

## 1. Mapa completo del sistema

### 1.1 Cuentas de inventario (GL al 30-jun-2026)

| Cuenta | Nombre | Saldo 30-jun | Qué la mueve hoy |
|---|---|---|---|
| 115.01.01 | Inventario | **−$2,000,385** (−$3.14M al 2-jul) | NUEVA desde jun-2026: Valoración del inventario + COGS de facturas. Nació negativa por switch de categorías sin transferencia |
| 115.02.01 | Materia prima y materiales | $20,601,829 | Valoración (consumos, crédito) + facturas de proveedor (débito). Comportamiento correcto |
| 115.02.02 | Inventario refacciones | $3,355,408 | SOLO asientos manuales mensuales en "Operaciones varias" ($306k–$1.02M/mes) |
| 115.03.01 | Producción en proceso | $15,453,072 | Valoración (~$30M/mes de flujo bidireccional MO) + **CAPA manual** + **facturas de cliente (crédito directo — mal)** |
| 115.04.01 | Productos terminados | $14,212,957 | Valoración (producción/despacho) + facturas de cliente. En jun también recibió CAPA $1.6M |
| 115.04.02 | Productos terminados (dup) | $0 | Muerta desde 2024-06. Desactivar |
| 115.04.03 | (refacciones vía facturas) | ya no existe en GL | Apareció en may-jun (52+36 facturas de proveedor) y desapareció por reclasificaciones post-hoc |

**Total GL 115.\* al 30-jun: $51.62M.**

### 1.2 Journals que tocan inventario

| Journal | Rol | Veredicto |
|---|---|---|
| Valoración del inventario (STJ) | Asientos automáticos de stock moves (AVCO) | Correcto — es el único que debería mover 115.* junto con facturas |
| Facturas de cliente / Mostrador | COGS al facturar: débito 501.01.01, crédito 115.0x | Correcto en mecánica; INCORRECTO en cuenta cuando el producto vive en categoría WIP (F1) |
| Facturas de proveedores | Capitalizan compra a 115.02.01 | Correcto para MP; en feb/abr también cargaron 115.04.01 ($745k/$728k — compras de PT importado, verificar) |
| **CAPA DE VALORACIÓN** | Manual: débito 115.03/115.04, crédito 501.01.01 | **Debe morir** (F2) |
| **Operaciones varias** | Manual: capitalización mensual de refacciones a 115.02.02 | **Debe morir** — la factura del proveedor debe capitalizar directo (F5) |

### 1.3 Taxonomía física (canonical_stock_moves, 2026)

Volúmenes mensuales típicos: consumo_mp $14–28M, produccion_pt $14–28M, venta
$5–8.5M, compra $4–15M, ajuste_inventario $1.3–4.3M (normal) con **dos picos de
conteo**: enero $20.3M bruto y **junio $38.5M bruto (1,384 movimientos)**.
`transfer_interno` siempre vale $0 (correcto: no genera asiento). La derivación
`move_category` vive en `20260427_canonical_stock_moves.sql` (src×dest usage).

### 1.4 Régimen vigente

AVCO + variable costing implícito (solo Tejido Circular tiene workcenter). El PT
absorbe solo MP; MOD+overhead viven en 501.06/504.01. Ese contexto explica la
tentación del CAPA manual (F2): "el costo se ve alto porque no absorbemos" → lo
capitalizan a mano → inventario inflado y P&L subestimado.

---

## 2. Hallazgos en detalle

### F1 — Mapa categoría→cuenta de valuación roto (crítico, $3.14M y creciendo)

Dos síntomas del mismo problema de configuración:

1. **Se vende desde el WIP.** Productos en categorías "Producto en Proceso /
   Acabado|Carda|Importación" son vendibles y se facturan: $2.42M + $186k + $146k +
   $96k de costo salió de **115.03.01** vía facturas de cliente entre abril y junio.
   El WIP no es cuenta de valuación de producto vendible.
2. **Switch de junio sin transferencia.** Categorías (Tejido Circular sin resina,
   Subproducto, varias "en Proceso") se re-apuntaron a **115.01.01** — pero el stock
   de esas categorías entró históricamente por 115.03/115.04. Las salidas ahora
   acreditan 115.01.01 y las entradas viejas nunca estuvieron ahí → la cuenta nació
   negativa (−$2.0M jun, −$3.14M al 2-jul) y **cada venta la hunde más** (julio ya
   acumula −$1.14M adicionales).

En Odoo, cambiar la cuenta de valuación de una categoría **no** mueve el saldo
existente: requiere asiento de transferencia manual el mismo día. No se hizo.

### F2 — CAPA DE VALORACIÓN sigue vivo (crítico, $15.07M en 2026)

La premisa documentada ("RSI56 archivado 1-abr-2026 → ya no se hace ajuste CAPA")
es **falsa en la práctica**. El journal registra asientos manuales que debitan
inventario y acreditan 501.01.01 Costo de venta:

| Mes 2026 | Débito a inventario | Cuenta destino |
|---|---|---|
| Enero | $3.60M neto | 115.03.01 |
| Febrero | $2.88M neto | 115.03.01 |
| Marzo | $3.64M neto | 115.03.01 |
| Abril | $2.26M | 115.03.01 |
| Mayo | $1.08M | 115.03.01 |
| Junio | $1.61M | **115.04.01** |
| **Total** | **$15.07M** | |

Consecuencias:
- **El saldo de 115.03.01 ($15.45M) es ~87% asientos CAPA**, no WIP real. Solo hay
  50 MOs abiertas (32 en progreso + 18 por cerrar) — el WIP físico real es una
  fracción de eso.
- El costo de ventas 2026 reportado está **~$15M por debajo** del que arroja la
  valuación automática (o el inventario está inflado por lo mismo — la depuración
  asiento por asiento dirá la mezcla).
- Histórico: el mismo journal acreditó 501.01.01 por $35.9M (2024) y $48.7M (2025)
  contra contrapartidas FUERA del scope 115/501/504 sincronizado — hay que verificar
  en Odoo contra qué cuenta se hacía antes.

### F3 — Conteo de junio reclasificado a mano, $3.57M a equity (crítico)

Secuencia reconstruida:
1. Junio: conteo físico masivo — 1,384 ajustes, $38.5M de valor bruto tocado.
2. Los asientos automáticos STJ registraron **$6.42M de cargos y $1.57M de abonos a
   501.01.08 DIFERENCIAS POR CONTEO** (ej.: STJ/2026/06/0435 $2.58M,
   STJ/2026/06/0617 $1.99M, STJ/2026/06/0434 $1.29M; los de "Jose J" 1987/2323 se
   revirtieron entre sí).
3. Después, esos asientos se **editaron en sitio**: en el GL vigente 501.01.08 de
   junio quedó en $31, y aparece un cargo de **$3.57M a 999998
   "Ganancias/pérdidas no distribuidas"** (equity — cuenta que solo debe mover el
   cierre automático) más créditos removidos de 115.01.01 (~$4.3M).

Independientemente de la intención (probablemente "estos ajustes no deben pegar a
resultados" — que es cierto para refacciones/errores de captura, ver F5), el método
es el problema: el resultado del conteo quedó en equity sin pasar por P&L, la
trazabilidad se rompió, y es observable en una revisión fiscal.

### F4 — Punto ciego del sync (integridad de datos) — FIXEADO

Editar la cuenta de una línea de un asiento posteado actualiza el `write_date` de la
**línea**, no siempre el del move padre. `_push_account_entries_stock` filtraba solo
por `move.write_date` → las ediciones de F3 nunca se re-sincronizaron:
`lines_stock`, `mv_entry_lines_flat`, `mv_stock_move_account_matches` y los RPCs de
drilldown siguieron mostrando la versión pre-edición (por eso 115.04.03 "existe" en
silver y ya no en el GL). El GL agregado (`odoo_account_balances`) no sufre esto
porque se reconstruye completo cada hora.

**Fix aplicado en qb19 (este PR):** el domain incremental ahora incluye
`line_ids.write_date >= last_sync`. **Remediación del histórico** (correr una vez
en shell Odoo.sh):

```python
env['ir.config_parameter'].sudo().set_param(
    'quimibond_intelligence.last_heavy_sync_date', '2026-05-31 00:00:00')
env.cr.commit()
env['quimibond.sync'].push_to_supabase_heavy()
env.cr.commit()
```

### F5 — Refacciones/activo fijo dentro del ciclo textil (alto, ~$4–6M)

- **Doble vía de capitalización:** asiento manual mensual en Operaciones varias a
  115.02.02 **y** facturas de proveedor a 115.04.03 — mientras las compras también
  entraban por TVAR. Duplicación medida: $4.15M YTD
  (`refacciones-tvar-doble-conteo-501-01-02`).
- **Conteos de refacciones a COGS:** $663k en junio, $254k en abril cayeron a
  501.01.08 dentro del costo de ventas (RPC `get_refacciones_dup_501_01_08`;
  pending action `conteo-maquinaria-refacciones-en-cogs` $1.63M).
- **Activo fijo como consumible:** $4.11M inflando inventario
  (`activo-fijo-clasificado-como-inventario`).

Este es el subconjunto de ajustes que **legítimamente no debe pegar a 501.01.08** —
pero el fix es configuración (categoría/ubicación/cuenta de gasto de mantenimiento),
no editar asientos a mano (F3).

### F6 — Triángulo de valuación (la revaluación)

| Medición | Monto | Nota |
|---|---|---|
| GL 115.* (30-jun) | **$51.62M** | Incluye CAPA $13.5M en WIP y refacciones manuales $3.36M |
| Físico Odoo: Σ stock_qty × avg_cost (1,313 SKUs) | **$43.12M** | Sin WIP (locations de producción no cuentan en stock_qty) |
| PT/vendibles en catálogo (522 SKUs) a AVCO | $11.95M | |
| … a MP último costo (BOM reconstruido) | $8.03M | política variable costing |
| … a MP + fabricación absorbida | **$17.76M** | política absorbing (consistente con /contabilidad/costo-reconstruido) |
| MP/refacciones/otros (791 SKUs) a AVCO | $31.17M | |
| … a último costo de compra | **~$39.03M** | 457 SKUs con compra reciente; resto avg_cost. ⚠️ validar UoM compra≠stock por SKU antes de usar |

Lecturas:
- El gap GL−físico (~$8.5M) es casi todo **asientos manuales** (CAPA en WIP,
  refacciones, hueco de 115.01.01) — la valuación automática AVCO por sí sola
  cuadra razonablemente.
- La política de valuación del PT mueve el target **±$6M**: MP+fab da $17.76M
  (+$5.8M vs AVCO), MP-only da $8.03M (−$3.9M). Decisión D1 del CEO.
- El drift de MP (+$7.9M a último costo) refleja inflación de precios de compra vs
  AVCO histórico — real, pero hay que validar los outliers de UoM.

### F7 — Higiene menor

4 SKUs con stock negativo (−$492k), 15 SKUs con stock y costo $0,
saldo/desperdicio valuado $85k (política dice $0), FORMATOIMPRENTA ya casi
depurado físicamente ($35k restante vs los $21.5M del pending action — el conteo
de junio lo corrigió; cerrar esa acción tras verificar).

---

## 3. Causas raíz

1. **R1 — Configuración:** el mapa categoría→cuenta de valuación nunca se definió
   formalmente; se cambia sobre la marcha sin asientos de transferencia.
2. **R2 — Absorción ausente:** sin workcenters completos, el costo "se ve mal" y se
   corrige con CAPA manual → inventario y P&L distorsionados. El fix real es la
   acción ya abierta `configure-workcenters-acabado-tintoreria-entretelas`.
3. **R3 — Refacciones/activos en el ciclo textil:** productos de mantenimiento
   valuados y contados como si fueran tela.
4. **R4 — Cultura de corrección por edición:** cuando un asiento automático "sale
   mal", se edita el asiento posteado en lugar de corregir la configuración que lo
   generó — rompe trazabilidad, P&L y silver.
5. **R5 — Costos unitarios desactualizados:** AVCO contaminado pre-abril (MOD+OH),
   precios MP viejos, errores puntuales (FORMATOIMPRENTA, BOMs infladas).

---

## 4. Plan de fix de raíz (5 fases)

### Fase 0 — Verdad de datos (esta semana, sistemas)
- [x] Fix qb19: `line_ids.write_date` en incremental de entries (este PR).
- [ ] Deploy qb19 (merge main→quimibond, `odoo-update quimibond_intelligence`).
- [ ] Re-push heavy desde 2026-05-31 (comando en F4) → silver refleja el GL real.
- [ ] Verificar en Odoo: reporte de Valuación de inventario vs saldo por cuenta
      115.* — anotar el gap por bucket como línea base.

### Fase 1 — Matar las fugas (Odoo config, contadora + Mariano, 1–2 semanas)
1. **Mapa oficial categoría→cuentas** (F1): vendibles→115.04.01, MP→115.02.01,
   refacciones→115.02.02, 115.03.01 solo WIP automático, 115.01.01 y 115.04.02 a
   cero y desactivadas. Cada cambio de categoría CON su asiento de transferencia
   el mismo día.
2. **Congelar CAPA DE VALORACIÓN** (F2): cero asientos manuales COGS↔inventario.
   La absorción llega vía workcenters (acción abierta, go-live Tejido ya ocurrió).
3. **Refacciones fuera del ciclo textil** (F5): categoría con gasto de
   mantenimiento al consumir, ubicación con cuenta de ajuste propia, una sola vía
   de capitalización (factura), activos a ficha de activo fijo.
4. **Política de correcciones** (F3/R4): asientos STJ posteados NUNCA se editan;
   toda corrección es asiento de reclasificación nuevo con ref al original.

### Fase 2 — Limpieza contable (contadora + CEO, 2–4 semanas)
1. **Depurar WIP**: los $13.46M de CAPA 2026 en 115.03.01, asiento por asiento →
   qué es costo ya vendido (a 501.01.01 del período) y qué es inventario real (a
   PT, entra a la revaluación). Meta: 115.03.01 = valor de las ~50 MOs abiertas.
2. **Revertir el cargo a 999998** ($3.57M) con asiento de reclasificación al
   destino que dicte el análisis del conteo (merma textil→501.01.08; error de
   captura→contra depuración WIP; refacciones→mantenimiento).
3. **115.01.01 a cero** con la transferencia de saldos de F1.1.
4. **Conciliar 115.02.02** ($3.36M contable vs ~$2.74M físico de refacciones).
5. Corregir 4 SKUs stock negativo + 15 SKUs sin costo.

### Fase 3 — Revaluación al costo reconstruido (CEO decide política, luego 1 semana)
1. **D1 (decisión CEO):** PT a MP+fab absorbida (recomendado; $17.76M) o MP-only
   ($8.03M). MP a último costo; saldo/desperdicio $0; refacciones a costo compra.
2. Validar costo objetivo por SKU (top 200 = >90% del valor; `product_cost_catalog`
   como fuente; cuidado UoM en últimas compras de MP).
3. Generar CSV producto→costo_nuevo desde silver (el sistema lo produce).
4. Ejecutar revaluación AVCO en Odoo (Inventario→Valuación→Actualizar costo, por
   lote) contra subcuenta nueva de resultados "Revaluación de inventario" (o contra
   la depuración de CAPA donde aplique — mismo origen económico).
5. **Criterio de éxito: GL 115.x = Σ stock_qty × costo_nuevo por bucket, al
   centavo**, verificado el mismo día del corte.
6. Cadencia trimestral hasta que la absorción por workcenters se complete.

### Fase 4 — Guardarraíles permanentes (silver, Mariano, 1 semana)
Invariantes nuevas en el motor de reconciliación (`audit_tolerances`):
- `inventory.gl_vs_physical_drift` — |GL 115.x − Σ stock×costo| > $50k por bucket, diaria.
- `inventory.negative_bucket` — saldo 115.* < 0, horaria.
- `inventory.capa_journal_activity` — cualquier asiento nuevo en CAPA DE VALORACIÓN → issue crítico.
- `inventory.equity_manual_posting` — movimiento manual a 999998 → issue crítico.
- `inventory.adjustment_nontextil_to_cogs` — ajustes de refacciones/activos cayendo a 501.01.08.
Además: banners `<OdooPendingBanner>` de las 5 acciones nuevas en /contabilidad e
/inventario/conciliacion.

### Decisiones que necesita el CEO
- **D1:** Política de valuación del PT (absorbing MP+fab, recomendado, vs MP-only).
- **D2:** Destino de la depuración del WIP/CAPA ($13.5M): cuánto reconoce el P&L
  2026 vs cuánto pasa a PT en la revaluación (lo dicta el análisis por asiento,
  pero el CEO debe validar el golpe a resultados).
- **D3:** Destino del $3.57M en 999998 (depende del detalle del conteo de junio).

---

## 5. Registro

- Pending actions nuevas (migration `20260702_pending_actions_inventario_audit.sql`):
  `cuentas-valuacion-categoria-realinear`, `capa-valoracion-manual-detener`,
  `conteo-junio-reclasificado-999998`, `refacciones-fuera-ciclo-textil`,
  `revaluacion-inventario-costo-reconstruido`.
- Fix de código: qb19 `sync_push_inventory.py` — line-level write_date en el
  incremental de `_push_account_entries_stock`.
- Correcciones a premisas documentadas en CLAUDE.md: (a) "ya no se hace ajuste CAPA
  mensual" es falso — el journal siguió activo todo 2026; (b) el trend de 501.01.08
  documentado (abril $379k) fue restated — el GL vigente muestra abril $210k y junio
  ~$0 por las reclasificaciones de F3.
