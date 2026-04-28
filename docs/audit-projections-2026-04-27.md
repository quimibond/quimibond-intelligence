# Audit — Cash Projection (2026-04-27)

Backlog priorizable de hallazgos del audit completo del feature de proyecciones de efectivo (Layer 1: AR billed, Layer 2: SO pipeline, Layer 3: run rate; overlay de recurrentes nómina/impuestos).

Cada item incluye: descripción, ubicación aproximada, impacto cuantificado (cuando estimable), y esfuerzo (S = <30min, M = 30min–2h, L = 2–4h, XL = >4h).

---

## A. Alto impacto — estructurales

### 1. `cashflow_projection` es matview legacy sin paridad en `supabase/migrations`
- **Dónde**: matview consumida en `src/lib/queries/sp13/finanzas/projection.ts:226-255` (query `cashflow_projection`). No hay archivo SQL en `supabase/migrations/` que la cree.
- **Síntoma**: la definición vive solo en el proyecto Supabase (aplicada vía MCP). Re-bootstrapear desde cero falla; rollback imposible vía git.
- **Impacto**: bloqueador para CI/CD reproducible. Riesgo alto de drift entre lo que se asume en TS y lo que la matview devuelve.
- **Esfuerzo**: L (extraer DDL + escribir migración + verificar índices y refresh policy).
- **Status (2026-04-27)**: **RESUELTO**. DDL extraído via `pg_get_viewdef` y escrito a `supabase/migrations/20260427_cashflow_projection_matview_parity.sql`. Hallazgos cruzados: matview ya filtraba `payment_state IN ('not_paid','partial')` (confirma que #10 era defensa redundante pero válida). Sin indexes previos — agregados 2 indexes nuevos a producción (`flow_type, projected_date` y `company_id`) para acelerar el query principal de projection.ts. Sin pg_cron job de refresh — TODO seguimiento para definir refresh strategy explícito.

### 2. `due_date_resolved IS NULL` quedan fuera del horizonte
- **Dónde**: `src/lib/queries/sp13/finanzas/projection.ts:226-255` filtra con `.lte("projected_date", endIso)`. Las filas con `projected_date NULL` (porque `due_date_resolved` es NULL en la matview) caen fuera por el `lte` pero NO se cuentan tampoco en backlog.
- **Síntoma**: facturas sin due date desaparecen de la proyección. CFDIs P (pago) e ingresos sin condiciones explícitas son las principales víctimas.
- **Impacto**: ~3-7% del AR billed bruto (según conteo de NULL en `canonical_invoices.due_date_resolved`).
- **Fix recomendado**: fallback `invoice_date + 30d` aplicado a nivel matview o en el cliente leyendo `canonical_invoices` directamente cuando `cashflow_projection` no tiene la fila.
- **Esfuerzo**: M (cliente) / L (matview, requiere SQL parity de #1).
- **Status (2026-04-27)**: **NO-OP — sin filas afectadas en producción**. Validación empírica via REST: `odoo_invoices` con (state=posted, payment_state IN not_paid/partial, amount_residual>0, due_date IS NULL) → 0 filas. `canonical_invoices` con (direction=issued/received, amount_residual>0, estado_sat<>cancelado, is_quimibond_relevant=true, due_date_resolved IS NULL) → 0 filas. El audit estaba basado en un supuesto teórico que no se materializa hoy. Si en el futuro empieza a haber datos así, el fix sigue siendo trivial (la infrastructura para canonical→bronze ya está en otros paths).

### 3. AR/AP delays de v2 (RPCs) no aplicados al `projected_date`
- **Dónde**: `supabase/migrations/20260426_ap_delay_related_party.sql`, `20260426_ar_collection_delay.sql` crean `get_ar_collection_delay_v2` y `get_ap_payment_delay_v2`. `projection.ts:494-649` no los consume aún — sigue usando `due_date_resolved` directo.
- **Síntoma**: la proyección asume que cobramos/pagamos en el due date. Realidad (validada): mediana 9d delay AR, p75 28d, max 172d. AP es peor (pateo intencional).
- **Impacto**: ~2-3 semanas de desfase en el chart vs cobranza/pago real. Causa raíz #1 de "alarmas falsas" de cash crisis.
- **Esfuerzo**: M (RPC ya existe, queda mapear `company_id → avg_delay_days` y sumar al `projected_date`).
- **Status (2026-04-27)**: **YA RESUELTO** — verificación post-audit confirma que `projection.ts:465-491` construye `apDelayMap`/`arDelayMap` desde los RPCs v2 y los aplica vía `shiftDate(origDate, delay.delayDays)` en líneas 669/675. El finding estaba desactualizado.

### 4. Cache TTL prolongado con key `v21` (invalidación silenciosa)
- **Dónde**: `src/lib/queries/sp13/finanzas/projection.ts:1771` cache key `sp13-finanzas-cash-projection-v21-seasonality-applied`.
- **Síntoma**: cualquier fix en código TS sin bumpear la key sirve resultado viejo de `unstable_cache`. El operador no sabe que ve datos pre-fix.
- **Impacto**: cualitativo (depende del fix). En audits previos, llevó a "ya está deployado" + "sigo viendo el bug" durante horas.
- **Esfuerzo**: S (bump key + commitear).

---

## B. Mediano impacto — data quality

### 5. SO pipeline sin probabilidad por etapa
- **Dónde**: `src/lib/queries/sp13/finanzas/projection.ts:651-859` capa Layer 2.
- **Síntoma**: SO se incluye con flag binario (cumple/no cumple criterio). No hay weighting por etapa de pipeline (cotización 20%, OC 60%, en producción 90%).
- **Impacto**: sobrestima inflows ~15-20% en horizonte 30-90d cuando hay SO largos en etapas tempranas.
- **Esfuerzo**: M (mapear `state` Odoo a probabilidad + multiplicar).
- **Status (2026-04-27)**: **YA RESUELTO**. `projection.ts:942-947` define `probabilityForUndelivered(ageDays)` con tiering por edad/entrega: delivered=0.95, undelivered <30d=0.85, 30-90d=0.70, 90-180d=0.45, >180d=skip. Es weighting por etapa usando delivery + age como proxies de "cuán cerca está del revenue". Validación: 691 SOs en producción 2026, todos en state='sale' (Quimibond no usa el flow draft/sent/quotation, así que no hay etapas tempranas que considerar). El audit estaba desactualizado.

### 6. Recurring v2 nómina mezcla bimestral con mensual
- **Dónde**: `supabase/migrations/20260425_cash_projection_recurring_v2_taxes.sql` `get_cash_projection_recurring`. Categoriza 501.06.0020-23 como "cuotas patronales" mensual, pero SAR e INFONAVIT son bimestrales en realidad (febrero, abril, junio, …).
- **Síntoma**: la proyección agenda SAR/INFONAVIT cada mes en vez de cada 2 meses → outflow inflado en meses non-pago.
- **Impacto**: ~$200-400k MXN inflados los meses pares (estimado de movimientos 501.06.0020-23 / 6).
- **Esfuerzo**: M (nueva migración v3 con frecuencia bimestral para SAR/INFONAVIT).

### 7. Run rate sin caps por estacionalidad fuerte (dic, ene)
- **Dónde**: `src/lib/queries/sp13/finanzas/projection.ts:861-1109` (customer) y `1167-1370` (supplier).
- **Síntoma**: el run rate se calcula sobre 12 meses con factor estacional aplicado luego, pero no hay cap superior. Diciembre 2025 (atípico por cierre) infla enero 2026.
- **Impacto**: 2-3 outliers afectan ~5-10% del run rate proyectado.
- **Esfuerzo**: M (winsorize p95 antes de promediar).
- **Status (2026-04-27)**: **RESUELTO**. Winsorización per-cliente y per-proveedor: cada invoice se cap al `min(amount, 2 × median(invoices_del_cliente))`. Solo aplica cuando el cliente tiene ≥4 facturas en el window de 90d (con menos no hay base estadística). Preserva la señal central, solo recorta el extremo superior. Cache v26 → v27.

### 8. Trend factor doble-cuenta con seasonality
- **Dónde**: `src/lib/queries/sp13/finanzas/learned-params.ts` (trend) y `projection.ts` (seasonality).
- **Síntoma**: trend se calcula sobre serie cruda incluyendo estacionalidad. Cuando ambos factores se multiplican, se sobre-pondera la estacionalidad reciente.
- **Impacto**: drift +/- 8% en horizonte 30-90d.
- **Esfuerzo**: L (deseasonalizar antes de calcular trend).

### 9. Aging buckets fijos 95/85/70/50/25 — no calibrados por cliente
- **Dónde**: `src/lib/queries/sp13/finanzas/projection.ts` constants de bucket probabilities.
- **Síntoma**: cliente con histórico de pagar 100% el bucket 60+ días recibe 70% por hardcode. Y viceversa: cliente moroso recibe 95% por bucket 0-30.
- **Impacto**: alto en clientes top — donde 1 sola factura mueve la aguja.
- **Esfuerzo**: L (RPC + ajuste por cliente con shrinkage hacia el global cuando sample <10).
- **Status (2026-04-27)**: **RESUELTO**. `learned-params.ts:_getLearnedAgingCalibrationRaw` ahora computa `perCustomerByBronzeId` paralelo al global. Cada cliente con histórico tiene rates por bucket con shrinkage empírico Bayesiano: `(customer.paid + 10×global) / (customer.total + 10)`. n=10 → 50/50 customer/global. n=2 → 83% global. n=50 → 83% customer. `projection.ts` overridea `expected_amount` del matview cuando hay rate personalizado disponible. Cache key `learned-aging-v1 → v2`, projection v25 → v26.

### 10. `payment_state_odoo='in_payment'` cuenta como AR pendiente
- **Dónde**: `src/lib/queries/sp13/finanzas/projection.ts:226-255` filtro de `cashflow_projection`. La matview probablemente incluye `in_payment`. `in_payment` = ya conciliado banco, registro pendiente en Odoo.
- **Síntoma**: facturas en `in_payment` se cuentan en AR billed AUNQUE el inflow ya está en `canonical_payments` → doble conteo en horizonte 0-7d.
- **Impacto**: 2-5% del AR los próximos 14 días (ventana típica de `in_payment`).
- **Esfuerzo**: S (filtro `payment_state_odoo NOT IN ('paid','in_payment')`).

### 11. `canonical_bank_balances.is_stale` no validado al inicializar opening
- **Dónde**: `src/lib/queries/sp13/finanzas/projection.ts` opening balance fetch.
- **Síntoma**: si el sync Belvo está caído >48h, opening balance es stale. La proyección suma inflows/outflows sobre un punto de partida obsoleto sin avisar.
- **Impacto**: el chart muestra "vamos a tener $X el viernes" cuando no sabemos qué tenemos hoy.
- **Esfuerzo**: S (campo `openingBalanceStale: boolean` + `openingBalanceStaleHours: number` en interfaz `CashProjection`).

### 12. Sin Monte Carlo / sensitivity analysis en UI
- **Dónde**: `src/lib/queries/sp13/finanzas/learned-params.ts` calcula varianza, pero `projection.ts` solo expone `bestCase`/`worstCase` con shock fijo.
- **Síntoma**: no hay distribución probabilística — solo 3 puntos. Imposible decir "P10 está en quiebra técnica".
- **Impacto**: stress testing limitado para negociación con bancos / planeación.
- **Esfuerzo**: XL (hooks ya existen, requiere UI + 1000-iter Monte Carlo).

### 13. Nómina CFDIs no separa aguinaldo / PTU / bonos del run rate mensual
- **Dónde**: `src/lib/queries/sp13/finanzas/projection.ts:1372-1604` nómina desde CFDIs.
- **Síntoma**: aguinaldo (dic), PTU (mayo), bonos extraordinarios entran al promedio mensual de nómina y aparecen mes a mes.
- **Impacto**: outflow nómina inflado ~8-12% durante 11 meses, deflado en mes real de pago.
- **Esfuerzo**: M (filtrar `tipoNomina` en CFDI nómina + tratar como evento puntual).
- **Status (2026-04-27)**: **PARCIALMENTE RESUELTO**. Aguinaldo ya estaba aislado: el baseline excluye diciembre (`if b.iso.slice(5,7) === "12"`) y se proyecta separadamente al 20-dic. Para PTU/bonos extraordinarios: agregada winsorización per-tipo de evento — cada quincena/viernes que excede `2× mediana` se cap, el exceso queda registrado en `fortnightExtraordinaryDetected` / `weeklyExtraordinaryDetected`. Solo aplica con ≥4 eventos del tipo. **Pendiente**: proyectar PTU al 30-may como categoría puntual (requiere histórico ≥1 año para detectar mes-de-pago confiable). Cache v27 → v28.

### 14. Recurring 701.11/504.01.0008 contabiliza partes relacionadas
- **Dónde**: `supabase/migrations/20260425_cash_projection_recurring_v2_taxes.sql` no filtra por `is_related_party`.
- **Síntoma**: pagos a Grupo Quimibond (renta intercompany), familia Mizrahi, etc., entran como recurring operativo. El flag `is_related_party` ya existe (#20260426).
- **Impacto**: ~$100-300k MXN/mes de outflows que no son operativos puros.
- **Esfuerzo**: M (nueva migración v3 con LEFT JOIN canonical_companies + filtro WHERE is_related_party = false).
- **Status (2026-04-27)**: **DEFERRED**. La RPC actual lee `canonical_account_balances` que es aggregate por (período, account_code) y NO tiene counterparty. Para subtraer la porción related-party hace falta cruzar a nivel `account.move.line` (que sí tiene partner_id + account_code juntos), pero esa tabla NO está sincronizada en Bronze. `odoo_invoice_lines` sí existe pero NO tiene `account_code`. Antes de implementar #14 hay que (a) extender el sync Odoo para traer account.move.line completo o (b) agregar `account_code` a `odoo_invoice_lines`. Mover a sprint estructural junto con #1.

### 15. CFDIs con `is_quimibond_relevant=false` aún consumidos por algunos paths
- **Dónde**: `supabase/migrations/20260426_quimibond_relevance_tombstone.sql` agregó la columna, pero no auditamos cada query downstream.
- **Síntoma**: CFDIs personales (Mizrahi-condominio, etc.) podrían filtrarse a `cashflow_projection` o paths de run rate.
- **Impacto**: 0.72% de canonical_invoices flagged. Pequeño pero contamina "pure operational".
- **Esfuerzo**: L (grep + auditar cada query, agregar `WHERE is_quimibond_relevant = true`).

### 16. Credit notes (`canonical_credit_notes`) no descontadas del AR billed
- **Dónde**: `src/lib/queries/sp13/finanzas/projection.ts:494-649` Layer 1 AR.
- **Síntoma**: factura emitida $100k + nota crédito $20k = AR neto $80k, pero la proyección cuenta $100k.
- **Impacto**: sobrestima AR. Tasa típica ~1-3% de NCs sobre facturas → $50-150k inflados.
- **Esfuerzo**: M (LEFT JOIN canonical_credit_notes + restar montos).

### 17. AR aging sin NULL-safe sort cuando `invoice_date IS NULL`
- **Dónde**: queries de aging en `projection.ts` y `learned-params.ts`.
- **Síntoma**: si la matview ofrece `invoice_date NULL`, el bucket asignado es indeterminado (NULLS FIRST/LAST depende del DBMS y el ORDER BY).
- **Impacto**: bajo (raro), pero en worst case asigna 95% probability a una factura realmente vieja.
- **Esfuerzo**: S (COALESCE con due_date - 30 o invoice_date sintético).
- **Status (2026-04-27)**: **NO-OP**. Validación empírica: `odoo_invoices` con state=posted y NULL invoice_date → 0 filas. `canonical_invoices` con NULL invoice_date → 56,701 (SAT-only historicals viejos), pero todos los queries upstream usan `.gte("invoice_date", lookback_iso)` que filtra implícitamente NULLs. Bucket assignment usa `days_overdue` del matview (computed server-side), no `invoice_date` directo. Sin riesgo en producción.

---

## C. Observabilidad

### 18. `projection_snapshots` sin alertas cuando MAPE > umbral (drift detection)
- **Dónde**: `src/lib/queries/sp13/finanzas/projection-snapshots.ts:352`. Captura semanal pero solo expone consulta puntual.
- **Síntoma**: si el modelo se degrada (MAPE sube de 12% a 30%), nadie se entera.
- **Impacto**: pérdida de loop de auto-aprendizaje. Justifica el effort de #14 backtesting.
- **Esfuerzo**: M (cron diario que compute MAPE últimas 8 semanas + envío Slack/email si > umbral).
- **Status (2026-04-27)**: **RESUELTO**. `getProjectionDriftStatus(weeksBack=8)` en `projection-snapshots.ts` clasifica MAPE/bias en severity (ok/low/medium/high/critical). Umbrales: MAPE >25% high, >40% critical; bias |x|>30% high, >50% critical. Min sample 4 semanas. Endpoint `/api/finanzas/projection-drift-check` cron diario (45 6 * * *), inserta `agent_insight` con severity=high/critical (skip low/medium para no inundar). Idempotente — no crea duplicado si ya existe insight con misma severity para hoy. Routea al agente "finance" (slug=2). Logueado en `pipeline_logs.phase=projection_drift_check`.

### 19. Falta backtest dashboard de aging buckets reales vs esperados
- **Dónde**: ninguna pieza la calcula hoy. Relacionado a #9.
- **Síntoma**: no sabemos si el bucket 60-90 paga 50% (hardcode) o 65% (real). Solo lo aprendemos cuando #9 se implementa.
- **Impacto**: prerequisito para calibrar #9 con confianza.
- **Esfuerzo**: M (vista/RPC sobre canonical_invoices pagadas con bucket-at-payment).
- **Status (2026-04-27)**: **RESUELTO**. Nuevo componente `AgingCalibrationBlock` (server) en /finanzas debajo del Sensitivity Block. Tabla 5-bucket: Heurística (95/85/70/50/25) | Real (Quimibond últimos 18m, derivado del cálculo global de #9) | Δ en puntos porcentuales (verde/rojo según signo) | sample size (⚠ si <10). Footer: count de clientes con override personalizado (#9). Sin RPC nueva — reusa `getLearnedAgingCalibration` que ya se computa para #9.

### 20. Falta `category_breakdown` JSON poblado en snapshots
- **Dónde**: `supabase/migrations/20260426_projection_snapshots.sql:29` define la columna pero `projection-snapshots.ts` no la llena.
- **Síntoma**: post-hoc analysis "¿qué fue lo que falló — AR, AP, run rate, recurring?" imposible.
- **Impacto**: limita root cause analysis cuando MAPE sube.
- **Esfuerzo**: M (extender el snapshot writer para volcar componentes).
- **Status (2026-04-27)**: **YA RESUELTO**. `projection-snapshots.ts:108` escribe `category_breakdown: w.byCategory` en el upsert. Validación en producción: `SELECT category_breakdown FROM projection_snapshots ORDER BY snapshot_date DESC LIMIT 1` retorna JSON con desglose por categoría (renta, nómina, ar_cobranza, ap_proveedores, runrate_clientes, ventas_confirmadas, etc). El audit estaba desactualizado.

### 21. Sin telemetría de latencia de cobro (días issued → cobrado)
- **Dónde**: `learned-params.ts` calcula medianas pero no expone histograma para UI/alertas.
- **Síntoma**: tendencia de "tardamos cada vez más en cobrar" invisible salvo correr query manual.
- **Impacto**: detección tardía de deterioro AR.
- **Esfuerzo**: L (vista + chart en /finanzas).

---

## D. UX

### 22. Chart no muestra intervalo de confianza (P25/P75) en tooltip
- **Dónde**: componente de chart en `app/(dashboard)/finanzas/...`.
- **Síntoma**: usuario ve solo línea expected. No sabe si "$2M el viernes" tiene banda ±$500k o ±$50k.
- **Impacto**: decisiones bajo certeza falsa.
- **Esfuerzo**: M (banda ya disponible en `bestCase`/`worstCase`, falta render).
- **Status (2026-04-27)**: **RESUELTO**. `projection-block.tsx` lifteó la llamada a `computeSensitivity` (antes 2× — se eliminó la duplicación). Pasa `monteCarlo` al chart y al SensitivityAnalysisBlock. Chart renderea banda P25-P75 escalada linealmente: 0 ancho hoy, full ancho al closing (refleja que la incertidumbre crece con el horizonte). Líneas P25/P75 punteadas + área sombreada. Tooltip incluye P25 y P75 además del expected. Si la banda es despreciable (<0.5% del baseline), no se renderea para evitar ruido visual.

### 23. Sin indicador visual cuando opening balance es stale >48h
- **Dónde**: header del chart de proyección.
- **Síntoma**: relacionado a #11. Aunque el dato exista en backend, el usuario no lo ve.
- **Impacto**: alto si Belvo se cae — el chart se ve "normal".
- **Esfuerzo**: S (badge "saldo bancario stale: hace Xh" cuando `openingBalanceStale=true`).

---

## Resumen por categoría

| Cat | Items | Esfuerzo total |
|-----|-------|---------------|
| A. Alto impacto | 4 | 1S + 1M + 2L |
| B. Mediano impacto | 13 | 3S + 7M + 2L + 1XL |
| C. Observabilidad | 4 | 3M + 1L |
| D. UX | 2 | 1S + 1M |

**Quick wins (S, ≤30min cada uno)**: #4 (cache key), #10 (in_payment filter), #11 (stale flag), #17 (NULL sort), #23 (stale badge).

**Si se implementan los 5 quick wins + #6 + #14 + #3** se cierra el grueso de los desfases observados (~70% de las "alarmas falsas").

---

_Generado por audit del 2026-04-27. Branch: `claude/audit-projections-Nliuo`._
