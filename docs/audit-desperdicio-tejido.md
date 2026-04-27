# Audit `DESPERDICIO TEJIDO Y ORILLA` (deep-dive del SKU)

> Investigación del SKU señalado como sospechoso en el audit multi-período
> 501.01.02. Conclusión: **operación benigna, pero detenida desde julio 2025
> sin causa documentada. Vale 1 pregunta directa al contador.**

## Resumen

5 productos relacionados en Odoo, todos con `standard_price=0` y categoría
"Producto En Proceso":

| Producto | Categoría Odoo | UoM |
|---|---|---|
| `DESPERDICIO TEJIDO ACABADO` (`DESPERDICIO TEJIDO`) | Tac-Acabado | kg |
| `DESPERDICIO TEJIDO CRUDO` (`DESPERDICIO ORILLAS`) | Tac-Tejido Circular | kg |
| `DESPERDICIO NO TEJIDO` | Entretelas-Carda | kg |
| `DESPERDICIO` (sin ref) | All | kg |
| `DESPERDICIO CHATARRA` (sin ref) | All | kg |

## Impacto contable consolidado (24 asientos, todos en mar-jun 2025)

| Cuenta | Dr | Cr | NET | Líneas |
|---|---:|---:|---:|---:|
| `115.04.01` Inventario Tejido | $1.74M | $1.74M | **$0** | 16 |
| `115.03.01` Inventario No Tejido | $37k | $37k | **$0** | 8 |
| `501.01.02` Costo primo | $0 | $1.67M | **−$1.67M** | 10 |

Las cuentas de inventario (115.x) se cancelan exacto al peso. **Solo
501.01.02 ve el movimiento neto** — y es un **Cr de $1.67M** (reduce COGS,
sube utilidad reportada).

## Mes a mes en 501.01.02

```
2025-03  −$0       (movimientos físicos pero sin hit a 501.01.02)
2025-04  −$1.07M   (7 ajustes "Cantidad de producto actualizada")
2025-05  $0
2025-06  −$0.61M   (3 ajustes)
2025-07+ $0        ← se detuvo el patrón
```

## Lo que pasó (reconstrucción)

Mar-jun 2025, Quimibond detectó que tenía desperdicio físico de tejido y
no tejido **acumulado en planta sin registrar en libros**. Para corregirlo
sin pasar por un picking físico, el contador (vía Cynthia Santana en
algunos casos) usó **"Cantidad de producto actualizada"** en la UI de Odoo:

```
Asiento típico (STJ/2025/04/1359):
  Dr  115.04.01 Inventario  $526k
  Cr  501.01.02 COSTO PRIMO $526k    ← reduce COGS reportado
```

**No es un tapón ni un fraude**: es la corrección legítima de un
**inventario subvaluado** que se descubrió al hacer conteo. Inmediatamente
después, ese desperdicio se vendió vía pickings `TL/OUT` a clientes
(probablemente recicladoras / traperos), generando un ingreso por venta
de scrap que entra por cuentas 7xx ("Otros ingresos") — esos asientos
existen pero NO tocan 501.01.02 (van a 501.01.01 + 7xx).

**Net económico**:

```
+$1.67M de subida de utilidad reportada (vía Cr 501.01.02)
+ (ingreso por venta de scrap a recicladora — separado, en 7xx)
─────────
= ganancia "encontrada" durante mar-jun 2025
```

## El detalle que importa: ¿por qué se detuvo después de junio?

Desde julio 2025 hasta hoy (abril 2026), **CERO ajustes** de DESPERDICIO en
501.01.02. Esto puede significar 3 cosas:

| Hipótesis | Probabilidad | Implicación |
|---|---|---|
| **(a) Se automatizó el registro de desperdicio** en producción (cada vez que se genera, queda registrado al instante) | media | bug arreglado, el dashboard ya refleja realidad |
| **(b) Se dejó de hacer el ajuste** sin causa — el desperdicio se sigue acumulando sin registrar | media | bomba de tiempo: en algún momento alguien va a tener que meter otro tapón gigante (estilo Dec-2025 $5.82M) |
| **(c) Cambió el flujo de venta** — ahora el desperdicio se vende sin pasar por inventory | baja | irrelevante contablemente |

**Pregunta directa para el contador / Cynthia Santana:**

> En 2025 se hicieron 10 ajustes manuales por $1.67M neto en
> "DESPERDICIO TEJIDO Y ORILLA" desde la UI de Odoo (mar/abr/jun).
> Desde julio dejaron de aparecer.
>
> ¿El proceso ya está automatizado y el desperdicio físico se está
> registrando solo, o simplemente se dejó de hacer el ajuste? Si es lo
> segundo, ¿cuántos kilos físicos llevamos acumulados sin pasar por libros?

## Validación contra la auditoría general

Estos $1.67M están **incluidos en el total de la cuenta 501.01.02 mes a mes**
del audit principal, distribuidos así:

| Mes | DESPERDICIO impact | Net total 501.01.02 | DESPERDICIO % |
|---|---:|---:|---:|
| 2025-04 | −$1.07M | −$523k | 204% (offset por entries positivas) |
| 2025-06 | −$610k | −$344k | 178% (offset) |

Es decir, sin los DESPERDICIO entries, el net del mes habría sido **+$543k
en abril y +$266k en junio** — dentro del rango "normal". El DESPERDICIO
los empujó al rojo.

## Acción para Quimibond

1. **Pregunta inmediata al contador** sobre la hipótesis (a)/(b)/(c) — 1 minuto.
2. **Si es (b)**: inventariar físicamente el desperdicio acumulado en planta. Probable corrección de $1-3M pendiente.
3. **Si es (a)**: confirmar que no hay desperdicio físico sin registrar en almacén — 1 día de auditoría física.
4. **Sistémico**: documentar el flujo de desperdicio en un SOP — quién registra, cuándo, en qué cuenta.

## Datos de soporte

```bash
# Replicar este análisis
node -e "
const {fetchAll} = require('./scripts/audit-501-01-02/lib.js');
fetchAll('/rest/v1/odoo_account_entries_stock?select=*&ref=ilike.*DESPERDICIO*&date=gte.2024-01-01&date=lt.2026-12-31', {pageSize:500})
  .then(rows => console.log(JSON.stringify(rows, null, 2)));
"
```

24 entries. Todos en 2025 (ene-jun). Sólo 3 productos distintos
(`DESPERDICIO TEJIDO`, `DESPERDICIO NO TEJIDO`, `DESPERDICIO ORILLAS`).
