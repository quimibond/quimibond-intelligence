# Payment Reconciliation Invariants — Deprecation

**Fecha:** 2026-04-28
**Estatus:** Decided + applied
**Owner:** sesión 4 audit
**Migración:** `supabase/migrations/20260428_deprecate_payment_complement_invariants.sql`

---

## TL;DR

Deshabilitamos `payment.complement_without_payment` y `payment.registered_without_complement` porque modelan una correspondencia 1:1 entre `SAT complemento de pago` y `Odoo bank payment` que no existe en la realidad fiscal mexicana. Cerradas 8,202 issues abiertas (6,720 + 1,482) como `auto_invariant_deprecated`.

---

## Contexto

El audit SP9-SP10 identificó 73k+ issues abiertas en estos dos invariants. La hipótesis original (SP10 spec, 2026-04-23) era que un `matcher_payment(amount, date, counterparty)` los iba a drenar fusionando rows SAT-solo con Odoo-solo en `canonical_payments` dual-source.

SP10 Fase 1 cerró 99.79% del counterparty en SAT. SP10 Fase 2 (matcher_payment real) quedó como stub returning NULL. La sesión 4 (2026-04-28) iba a implementarlo — ~2 días estimados.

## Lo que descubrimos

### 1. Pool a matchear es realmente bajo

| sources_present | rows | pct |
|---|---|---|
| `['sat']` | 20,910 | 49.5% |
| `['odoo']` | 13,583 | 32.2% |
| `['sat','odoo']` (ya merged) | 4,325 | 10.2% |

De los 20,910 SAT-only, **7,131 son pre-2021** (eras 2018-2020 sin data Odoo en Supabase). Estructuralmente unmatcheable.

Pool real (2021+): **13,776 SAT vs 13,560 Odoo**.

### 2. Tolerance sweep: matcheable < 1%

```sql
-- counterparty match + direction match + ventana variable
WITH candidates AS (
  SELECT s.canonical_id AS sid,
         ABS(o.payment_date_odoo - s.fecha_pago_sat::date) AS dd,
         ABS(o.amount_mxn_odoo - s.amount_mxn_sat) AS md,
         s.amount_mxn_sat AS amt
  FROM canonical_payments s
  JOIN canonical_payments o
    ON o.sources_present = ARRAY['odoo']::text[]
   AND o.counterparty_canonical_company_id = s.counterparty_canonical_company_id
   AND o.direction = s.direction
   AND ABS(o.payment_date_odoo - s.fecha_pago_sat::date) <= 7
  WHERE s.sources_present = ARRAY['sat']::text[]
    AND s.counterparty_canonical_company_id IS NOT NULL
    AND s.fecha_pago_sat::date >= '2021-01-01'
)
SELECT
  COUNT(DISTINCT sid) FILTER (WHERE dd<=2 AND md<=0.02)               AS strict,
  COUNT(DISTINCT sid) FILTER (WHERE dd<=5 AND md/amt<=0.005)          AS loose_5d_05,
  COUNT(DISTINCT sid) FILTER (WHERE dd<=7 AND md/amt<=0.02)           AS very_loose_7d_2,
  COUNT(DISTINCT sid)                                                  AS any_overlap
FROM candidates;
```

| Tolerance | Matches | % de pool 13,776 |
|---|---|---|
| ≤2d, ≤$0.02 | 88 | 0.64% |
| ≤5d, ≤0.5% | 96 | 0.70% |
| ≤7d, ≤2% | 124 | 0.90% |
| Cualquier amount, mismo counterparty + direction + ≤7d | 9,426 | 68% |

**Lectura:** 99% de SAT-only TIENE candidato Odoo en mismo counterparty/direction/fecha cercana, pero los **montos no cuadran** — no son el mismo pago. Apenas el 0.9% son matches reales.

### 3. Análisis cualitativo del pool no-matcheable

Muestreo 10 SAT-only + 10 Odoo-only (random, año 2024):

**SAT-only patterns:**
- Counterparty resuelto correctamente (Surtidora Nacional, Industrias Protrim, Hangzhou Feng Hai, etc.)
- Algunos counterparties tienen 0 Odoo records (HANGZHOU FENG HAI: counterparty resuelto pero ningún pago Odoo — posible: pago vía intermediario/crédito).
- Otros tienen 27-64 Odoo records pero ninguno cuadra el monto.

**Odoo-only patterns:**
- Mayoría: journal `Salarios` → nómina (Jacobo Mizrahi, EDENRED MEXICO, BELAGUA).
  - **Nómina NO genera CFDI Complemento de Pago** — usa CFDI Recibo de Nómina (instrumento fiscal distinto).
- Resto: payments por BBVA BANCOMER a clientes/proveedores reales (PROYECCIONES DE LA MODA, HILADOS, SHAWMUT) — pero estas counterparties tienen 0-422 SAT rows con ningún match exacto de monto.

### 4. Causa raíz arquitectónica

`canonical_payments` mezcla dos abstracciones distintas:

```
                       Odoo Payment ←—— 1 movimiento bancario
                                        (1 fila por acción del banco)

                    SAT Complemento ←—— Registro fiscal para SAT
                                        (puede ser 1 por pago, 1 por mes,
                                         o 0 si es nómina/intercompany)
```

La relación es many-to-many (o disconnected). El invariant `complement_without_payment` produce falsos positivos en:
- Toda nómina (Recibo de Nómina ≠ Complemento de Pago).
- Pagos donde Quimibond es third-party.
- Complementos batched que cubren múltiples bank movements.

El invariant `registered_without_complement` produce falsos positivos en:
- Toda nómina.
- Pagos a proveedores que no emiten complemento (común <2024).
- Pagos personales que casualmente quedan en Odoo.

---

## Decisión

**Disable** ambos invariants en `audit_tolerances` (`enabled=false`) con nota explicativa.

**Auto-resolve** las 8,202 issues open con `resolution='auto_invariant_deprecated'` y nota apuntando a esta migración.

**Mantener** las columnas booleanas `complement_without_payment` y `registered_but_not_fiscally_confirmed` en `canonical_payments` — siguen siendo útiles para analytics queries que entienden la nuance.

**Mantener** la función stub `matcher_payment(text)` y el trigger `trg_matcher_payment_after_sat` como punto de extensión por si la abstracción cambia (ej. SAT empieza a publicar UUID 1:1 con bank movements). Stub returning NULL = no-op safe.

---

## Lo que NO hicimos (y por qué)

### A. Implementar matcher_payment real

124 matches estrictos cierran ~250 issues (1.5% de los 8.2k abiertos) por 2 días de trabajo. ROI insuficiente. Si en el futuro la regulación SAT cambia y aparecen UUID 1:1, reactivar.

### B. Reclasificar SAT-only por taxpayer_role (Quimibond emisor vs receptor)

Más sofisticado pero amplía el alcance. La decisión actual (disable + close) es reversible si después se quiere volver a evaluar.

### C. Crear nuevos invariants para nómina

No claros aún. Nómina tiene su propio CFDI (Recibo de Nómina) que ya está en `syntage_invoices` como tipo `N`. Si después surge la necesidad, crear `payment.payroll_complement_missing` específico.

---

## Métricas post-deploy

```sql
-- Confirmar 0 abiertas
SELECT invariant_key, COUNT(*) FILTER (WHERE resolved_at IS NULL) AS open
FROM reconciliation_issues
WHERE invariant_key IN ('payment.complement_without_payment','payment.registered_without_complement')
GROUP BY invariant_key;
-- Esperado: 0 / 0

-- Confirmar disabled
SELECT invariant_key, enabled FROM audit_tolerances
WHERE invariant_key IN ('payment.complement_without_payment','payment.registered_without_complement');
-- Esperado: false / false
```

Después del próximo `silver_sp4_reconcile_daily` (2026-04-29 06:30 UTC) confirmar que no se re-crean issues nuevas.

---

## Referencias

- SP10 Master: `project_sp10_complete.md`
- SP10 Phase 1: `project_sp10_phase1.md` (counterparty SAT 99.84% resolved)
- canonical_payments schema: 49 columns post-SP3+SP4+SP5.5
- `_sp4_run_extra` (no contiene estos invariants — son en `run_reconciliation_sp2`)
