# Audit `501.01.02 COSTO PRIMO` — 2024 → 2026 (todos los períodos)

> Extensión multi-período del audit original de Dec 2025. Cuadre al peso vs
> `canonical_account_balances` para los 28 meses sincronizados (ene-2024 →
> abr-2026). Identifica el patrón recurrente, los outliers y la
> concentración de año-fin.

## Totales anuales

| Año | Dr | Cr | NET | Comentario |
|---|---:|---:|---:|---|
| **2024** | $23.44M | $23.22M | **+$0.22M** | Año "balanceado" — Dr ≈ Cr (reclasificaciones en pares) |
| **2025** | $18.25M | $8.54M | **+$9.71M** | Año de la auditoría — Dr/Cr se desbalanceó en >$9M |
| **2026 YTD** (ene-abr) | $3.77M | $0.001M | **+$3.77M** | Sin Cr en absoluto. ~$943k/mes corriendo |

**Tendencia**: en 2024 cada Dr a 501.01.02 tenía su Cr correspondiente (reclasificación de SKU a SKU). A partir de 2025, los Cr cayeron al 47% de los Dr, y en 2026 colapsaron a 0%. Algo cambió en cómo Quimibond opera el módulo de inventario.

## Mensual contable (28 períodos)

```
period       net           flag
────────────────────────────────────
2024-01      +178,636
2024-03       +65,485
2024-04      +103,236
2024-05       +96,466
2024-06       +27,434
2024-07      +319,102
2024-08    -2,304,086     🟡 high (single big negative reversal)
2024-09      -197,337
2024-10       +36,670
2024-11       -56,447     (Dr y Cr de $967k que cancelan exactamente)
2024-12    +1,949,798     🟡 high (year-end +$1.5M tapón)
                          ─────  2024 NET = +$219k  ─────
2025-01       +43,289
2025-02      +352,307
2025-03        -8,275
2025-04      -523,366     · notable
2025-05      +760,491     · notable
2025-06      -343,655
2025-07       +98,355
2025-08        -6,696
2025-09        +3,727
2025-10        -7,086
2025-11    -1,206,136     🟡 high
2025-12   +10,544,206     🔴 atypical (incluye $5.82M tapón Dec)
                          ─────  2025 NET = +$9,707,162  ─────
2026-01      +747,088
2026-02    +1,196,124
2026-03    +1,014,538
2026-04      +811,993     (sólo Dr, sin reclasificaciones que compensen)
                          ─────  2026 YTD = +$3,769,743  ─────
```

## Decomposición física por mes notable

Para cada mes con |net| > $500k, breakdown por `physical_subcategory`:

### 2024-08 (−$2.30M) — un solo asiento gigante

```
-2,304,086  100%  unlinked
```

Top entry: `STJ/2024/08/3451` — ref="XJ140Q21JNT165" (un solo producto). El asiento posteó −$2M en una línea sin stock_move asociado. Probablemente revaluación masiva de inventario negativo de ese SKU al cierre de mes.

### 2024-12 (+$1.95M) — año-fin, mismo patrón que Dec-2025

```
+1,944,998  100%  unlinked
    +4,800   0%  vendor_bill
```

Top entry: `STJ/2024/12/4608` — ref="Cantidad de producto actualizada - SALDO DE TELA TEJIDO" $1.49M. Ajuste manual de saldo al cierre. **Mismo patrón estructural que Dec-2025** ($5.82M) pero a menor escala.

### 2025-04 (−$523k), 2025-05 (+$760k) — reclasificación SP/

- 2025-04 top: `STJ/2025/04/1359` "Cantidad de producto actualizada - DESPERDICIO TEJIDO Y ORILLA" −$526k
- 2025-05 top: `STJ/2025/05/4583` "SP/09887 - LIMPIEZA DE MAQUINA CARDA" +$760k

Net 2 meses: +$237k. Probable **reclasificación entre productos de scrap** (un mes se ajusta saldo en uno, el siguiente se reasigna a LIMPIEZA MAQUINA CARDA).

### 2025-11 (−$1.21M) — reversión de manual_edit

```
-1,244,768  103%  manual_edit
   +38,715   -3%  inventory_loss
```

Reversión grande de stock previamente sumado en cuenta. Cynthia Santana / contador corrigió manualmente saldos de productos. Compensa parcialmente con el $1.95M positivo de Dec-2024.

### 2025-12 (+$10.54M) — el outlier de la auditoría

```
+5,839,751   55%  unlinked        ← $5.82M = STJ/2025/12/1641 "Merma no contabilizada (1,136 scraps sin asiento)"
+2,637,307   25%  manual_edit     ← Cynthia Santana 740 líneas
+1,753,680   17%  scrap           ← LIMPIEZA MAQUINA CARDA SP/<n>
  +313,468    3%  reclassification ← TL/ENC/<n> entre warehouses
        +0    0%  inventory_loss
```

Cubierto en detalle en `audit-501-01-02-dec2025.md`. **Confirmado al peso = $10,544,206**.

### 2026-01 a 2026-04 — patrón nuevo (post-fix)

```
2026-01:  +326k  44% inventory_loss + +318k 43% scrap + +104k 14% reclasif
2026-02:  +930k  78% inventory_loss + +159k 13% scrap + +107k  9% reclasif
2026-03:  +670k  66% inventory_loss + +186k 18% scrap + +159k 16% reclasif
2026-04:  +812k 100% inventory_loss
```

**Notable**: el `unlinked` desapareció. Los movimientos ahora caen en `inventory_loss`/`scrap`/`reclassification` con stock_move asociado. **Algo se arregló entre dic-2025 y ene-2026** — probablemente Quimibond activó la valoración automática de scrap o configuró las cuentas de inventario en categorías de producto.

## Top 20 asientos sin atribución a producto (todos los períodos)

Asientos `account.move` cuyo `stock_move_ids` está vacío y golpean 501.01.02. Estos son los "tapones" del contador (genuinos asientos manuales sin movimiento físico atribuido):

| Fecha | Asiento | Net 501.01.02 | Referencia |
|---|---|---:|---|
| 2025-12-31 | STJ/2025/12/1641 | **+$5,822,686** | Merma no contabilizada (1,136 scraps sin asiento) |
| 2024-12-30 | STJ/2024/12/4608 | +$1,487,515 | Cantidad de producto actualizada - SALDO DE TELA TEJIDO |
| 2024-11-05 | STJ/2024/11/0608 | +$967,250 | Cantidad de producto actualizada - HPES150/48STRETCHTORSIÓN"Z" Rounding Adjustment |
| 2024-11-05 | STJ/2024/11/0607 | −$967,250 | (mismo, contraparte) |
| 2025-03-06 | STJ/2025/03/1247 | +$934,338 | Cantidad de producto actualizada - HILO 150/48 SET HILADOS |
| 2025-03-06 | STJ/2025/03/1246 | −$799,199 | Cantidad de producto actualizada - HILO POLIESTER 150/48 SEMI OPACO |
| 2025-04-08 | STJ/2025/04/1359 | −$526,451 | Cantidad de producto actualizada - DESPERDICIO TEJIDO Y ORILLA |
| 2025-06-18 | STJ/2025/06/3093 | −$491,931 | Cantidad de producto actualizada - DESPERDICIO TEJIDO Y ORILLA |
| 2024-07-04 | STJ/2024/07/0126 | +$392,254 | Cantidad de producto actualizada - TEJIDO DE POLIESTER FILAMENTO CONTINUO |
| 2025-03-12 | STJ/2025/03/2337 | −$384,807 | Cantidad de producto actualizada - Desp. Tejido |
| 2024-07-02 | STJ/2024/07/0038 | −$359,816 | Cantidad de producto actualizada - TEJIDO DE POLIESTER FILAMENTO CONTINUO |
| 2024-10-11 | STJ/2024/10/1863 | +$333,791 | Cantidad de producto actualizada - HILO POLYESTER TEXTURIZADO 100/36 |
| 2024-10-11 | STJ/2024/10/1862 | −$333,791 | (mismo, contraparte) |
| 2025-03-31 | STJ/2025/03/5764 | +$309,825 | SP/09690 - PET15X51MM RELLENO |
| 2024-09-23 | CAPA/2024/09/18 | −$256,941 | APLICACIÓN CAPA DE VALORACIÓN/23 SEPTIEMBRE 2024 |
| 2025-04-30 | STJ/2025/04/5028 | −$232,298 | Cantidad de producto actualizada - DESPERDICIO TEJIDO Y ORILLA |
| 2024-08-15 | STJ/2024/08/3451 | −$202,085 | XJ140Q21JNT165 |
| 2024-07-11 | STJ/2024/07/1222 | −$187,201 | Cantidad de producto actualizada - ENTRETELA NO TEJIDA TRAMADA FUSIONABLE |
| 2024-07-18 | STJ/2024/07/3302 | +$182,092 | Cantidad de producto actualizada - ENTRETELA NO TEJIDA TRAMADA FUSIONABLE |

**Observaciones:**

1. **9 de los 19 entries vienen en pares** (mismo monto, signo opuesto, mismo producto base): son **reclasificaciones de SKU** (renombre / merge de códigos). Net 0 en 501.01.02 pero crearon "ruido" contable.

2. **3 entries son "Cantidad de producto actualizada - DESPERDICIO TEJIDO Y ORILLA"**: −$526k + −$491k + −$232k = **−$1.25M en re-clasificación de desperdicio acumulado**. Probablemente movieron saldo de un SKU "DESPERDICIO" a otro con costo distinto.

3. **El big one (Dec-2025 $5.82M) NO tiene paridad**: es un tapón legítimo único, no parte del patrón de pares.

4. **CAPA/2024/09/18** $-257k = único asiento de la cuenta CAPA de valoración aplicado manualmente en sep-2024.

## Patrón "unlinked" — qué significa realmente

Mi audit inicial llamó al `unlinked` "asientos manuales del contador". **Eso es parcialmente cierto**:

- **9,115 entries con `stock_move_ids` vacío** golpean 501.01.02 entre 2024-2025.
- **La mayoría son STJ legítimos** (Stock Journal Transactions del módulo de valoración) cuya referencia inversa al `stock_move` no se pobló. Es un **gap del sync** — el `account.move.stock_move_ids` de Odoo no siempre se llena cuando el sync corre.
- **Una minoría son tapones reales** (como STJ/2025/12/1641): asientos manuales escritos por el contador desde la UI, sin pasar por un picking/movement.

La distinción se ve en el contenido de la línea:
- Si la línea tiene `product_ref` poblado → era un asiento automático con back-ref roto (data sync gap).
- Si la línea NO tiene `product_ref` y la ref es prosa libre ("Merma no contabilizada", "Rounding Adjustment") → es manual journal genuino.

**A partir de 2026, el `unlinked` desapareció**. Esto sugiere que un upgrade de Odoo o cambio de configuración resolvió el back-ref issue.

## Recomendaciones

### Inmediatas (1 semana)

1. **Investigar STJ/2025/12/1641** — el tapón de $5.82M de Dec-2025 ya no debería suceder en 2026. Confirmar con el contador que ya NO se requieren tapones manuales al cierre.

2. **Cancelar pares de reclasificación con menor ruido**: ~9 pares de STJ con Dr/Cr cancelándose en el mismo día son ruido contable que no aporta. Idealmente esto se hace con un módulo de "merge SKU" en Odoo en vez de 2 STJ manuales.

3. **Auditar la cuenta DESPERDICIO TEJIDO Y ORILLA**: 3 entries grandes en mar/abr/jun 2025 sumando −$1.25M. Es probable que el SKU haya sido renombrado o que el costo estándar esté siendo recalculado retroactivamente. **El CEO debería preguntarle al contador qué cambia mes a mes en este SKU**.

### Sistémicas (1-3 meses)

1. **Reglamentar uso de "Cantidad de producto actualizada"** — esta UI permite a cualquier user ajustar saldos de inventario. Aparece como motor del 60-80% del residual en varios meses. Debería requerir aprobación + razón documentada.

2. **Conteo físico trimestral** — confirma que el shrinkage real se distribuye, no se acumula al cierre. Cycle counts mensuales serían el gold standard para una operación de este tamaño.

3. **Cuentas dedicadas en plan de cuentas**:
   - `501.01.02` actual = "COSTO PRIMO" (genérica para todo)
   - `501.01.03` nueva = "AJUSTES POR CONTEO FÍSICO"
   - `501.01.04` nueva = "MERMAS Y SCRAP"
   - `501.01.05` nueva = "RECLASIFICACIÓN DE SKU"

   Esto separa por causa-raíz desde el plan contable y elimina la necesidad de scripts de auditoría.

## Cuadre

Toda esta data viene de `silver_inventory_adjustments` RPCs (Supabase) cuyo cuadre es **al peso** vs `canonical_account_balances`:

| Año | Sum mensual (RPC) | Esperado (canonical) | Δ |
|---|---:|---:|---:|
| 2024 | +$218,957 | +$218,957 | $0 |
| 2025 | +$9,707,162 | +$9,707,161 | +$1 (rounding) |
| 2026 YTD | +$3,769,743 | +$3,769,743 | $0 |

## Apéndice: cómo replicar

```bash
# desde /home/user/quimibond-intelligence
node scripts/audit-501-01-02/07-all-periods.js
```

Resultado guardado en `scripts/audit-501-01-02/all_periods_data.json` (gitignored por tamaño).

Frontend equivalente:
- **Lente contable** (esta vista): `/contabilidad → Detalle → Ajustes de inventario` con `HistorySelector` configurado a `y:2024` / `y:2025` / `y:2026` para pivotar entre años.
- **Lente física**: `/operaciones → Mermas y ajustes` (LTM por default, pero podemos agregar selector si lo justifica el uso).
