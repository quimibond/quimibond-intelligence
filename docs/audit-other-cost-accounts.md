# Audit de las otras cuentas grandes de costo (B)

> Replicar el patrón del audit 501.01.02 a las demás cuentas de costo
> con volumen alto. Pregunta: ¿hay otros tapones manuales o spikes
> sospechosos similares?

## Cuentas analizadas

Top 7 cuentas de costo por actividad 2024-2026:

| Cuenta | Concepto | Total NET 2024-2026 |
|---|---|---:|
| `501.01.01` | Cost of sales | $127.0M |
| `501.06.0001` | Sueldos y salarios | $41.6M |
| `504.01.0003` | Gas/Gasolina/Diesel | $19.1M |
| `504.01.0008` | Renta del local | $17.4M |
| `501.01.02` | COSTO PRIMO (auditado) | $13.7M |
| `504.08.0001` | Depreciación maquinaria | $8.8M |
| `504.01.0035` | Gastos de importación | $8.2M |

## Hallazgos por cuenta

### 501.01.01 Cost of sales · ✅ CLEAN

$127M en 28 meses, avg $4.5M/mes. **Distribución tight** (rango $1.7M - $6.5M, ningún spike >2x avg). Solo notar que **Dec-2025 fue el mes MÁS BAJO ($1.69M)** — porque mucho de lo que normalmente caería ahí se posteó a 501.01.02 (el tapón de mermas), confirmando que las cuentas se intercambian.

```
2024:   $4.5M / mo avg, ±$1M
2025:   $4.6M / mo avg, ±$1.5M  (Dec-25 mínimo $1.69M ← tapón a 501.01.02)
2026:   $4.2M / mo avg
```

### 501.06.0001 Sueldos · ✅ CLEAN

$41.6M, avg $1.49M/mes. Crecimiento orgánico de $1.14M (Ene-2024) a $1.78M (Dec-2025). **Sin spikes**, sin tapones. Es la cuenta más limpia. La nómina se está pagando en cadencia normal.

### 504.01.0003 Gas/Gasolina · ✅ CLEAN

$19M, avg $681k/mes. Variación normal $462k - $898k. **Sin sospechas**.

### 504.08.0001 Depreciación · ⚠️ SPIKE Dec-2025 (pero conocido)

$8.84M total, avg $327k/mes. **Un solo asiento gigante**:

```
Ch/2025/12/08 (Cheques): +$5,827,157
ref: "REGISTRO ENAJENACIÓN DE ACTIVO MAQUINA CIRCULARES/JET FONG"
```

**Esto NO es un tapón**: es la baja contable de máquinas circulares JET FONG vendidas. La depreciación acumulada de esos activos se reclasifica al darse de baja. Las otras 28 entries del mes son depreciación normal de equipos individuales ($80-20k cada una).

**Verificación recomendada**: que el ingreso de la venta de las máquinas JET FONG esté reflejado en `704.23.0003` (Venta de Activo Fijo) como contraparte. Si los 2 lados están registrados, la transacción está cuadrada y no afecta utilidad core. El RPC `get_pnl_normalization_adjustments` ya detecta esto como "venta_activo_fijo" en el P&L Normalizado de `/finanzas`.

### 504.01.0008 Renta del local · 🟡 CADENCIA IRREGULAR

$17.4M total, avg $668k/mes pero con **patrón irregular en 2025**:

```
2024 (regular):  $317k - $876k/mo (varía pero estable)
2025-Jan→Jul:    $339k/mo exacto (pago mensual fijo)
2025-Aug:        $1,366k        ← saltó a 4x
2025-Sep:        $683k
2025-Oct:        $683k
2025-Nov:        $0             ← saltado
2025-Dec:        $957k
2026-Jan:        $1,308k
2026-Feb:        $1,145k
2026-Mar:        $1,494k        ← otro pico
2026-Apr:        $506k
```

Algunos meses pagan double-rent ($1.3-1.5M = ~2 mensualidades), otros pagan menos o nada. **Sugiere que el contador acumula y paga retrasado** — no es un fraude, pero genera ruido en el P&L mensual.

**Pregunta para el contador**: ¿hay un acuerdo con el arrendador de pago bimensual o trimestral? Si no, ¿por qué 504.01.0008 no se posteea cada mes con el mismo monto? Idealmente debería ser una accrual mensual fija que iguale el contrato de renta.

### 504.01.0035 Gastos de Importación · ⚠️ NORMAL para imports

$8.24M, avg $294k/mes pero lumpy ($30k - $630k). **Esperado** — los gastos de importación dependen de cuándo lleguen los embarques, así que la variabilidad es operativa, no contable.

Notable: **2024-Jul** $630k (alta), **2024-Nov-Dec** $466k + $453k. Pueden ser 2-3 contenedores grandes ese trimestre. Sin acción.

## Resumen ejecutivo de B

**Cuentas limpias (3)**: `501.01.01`, `501.06.0001`, `504.01.0003`. Distribución mensual sólida, sin tapones.

**Spike conocido (1)**: `504.08.0001` Dec-2025 = venta de máquinas JET FONG. Ya capturado por la lógica de P&L Normalizado.

**Cadencia irregular (1)**: `504.01.0008` Renta — el contador acumula y paga retrasado. **Pregunta directa al contador**: ¿por qué la renta no se acumula mes a mes?

**Otras (1)**: `504.01.0035` Importación es naturalmente lumpy.

**Conclusión**: el problema sistémico de tapones manuales **es exclusivo de `501.01.02` COSTO PRIMO**. Las demás cuentas grandes están razonablemente bien postuladas. El audit principal estaba bien enfocado.

## Acciones consolidadas

| Acción | Cuenta | Esfuerzo |
|---|---|---|
| Confirmar venta JET FONG está cuadrada en 704.23.0003 | `504.08.0001` | 5 min — query a Odoo |
| Preguntar al contador por la cadencia irregular de renta | `504.01.0008` | 1 conversación |
| Sugerir accrual mensual fija de renta | `504.01.0008` | sistema |

## Cómo reproducir

```bash
node -e "
const {fetchJson} = require('./scripts/audit-501-01-02/lib.js');
const code = '504.08.0001'; // o cualquier otra
fetchJson('/rest/v1/canonical_account_balances?select=period,debit,credit&account_code=eq.' + code + '&period=gte.2024-01&period=lt.2026-12&order=period.asc')
  .then(rs => rs.forEach(r => console.log(r.period, Number(r.debit) - Number(r.credit))));
"
```
