# Audit MDM cleanup — 2026-04-28

Continuación del audit de bugs estructurales en silver/MDM iniciado por
el fix de SHAWMUT (commit `1df34b1`). El user reportó que el bug del
matcher genérico-RFC se había arreglado; al revisar otros patrones
similares encontré que **el fix original NUNCA se deployed correctamente**
+ otros bugs adyacentes.

## Hallazgos

### 🔴 BUG #1 — `matcher_company` deployed version sigue con el bug original

**Severity:** CRITICAL — root cause de los bugs #2 y #3.

**Verificación live (2026-04-28):**
```
matcher_company('XEXX010101000', 'SHAWMUT LLC', NULL, false) = 630 (HANGZHOU)
   ↑ debería retornar 1606 (SHAWMUT real)

matcher_company('XAXX010101000', 'ALEJANDRO CERVANTES MARTÍNEZ', ...) = 11 (MOSTRADOR)
   ↑ debería retornar shadow nuevo o NULL
```

**Causa:** la migration `20260427_fix_matcher_generic_rfc_*.sql` que arregló
esto en el commit `1df34b1` **no se aplicó a producción**, o se aplicó y luego
fue sobreescrita. La función deployed actual sigue teniendo el flujo buggy:
```
1. WHERE rfc = p_rfc ORDER BY ... LIMIT 1     ← captura genérico
2. IF FOUND THEN RETURN v_id;                 ← retorna inmediatamente
3. IF p_rfc IN (generic) THEN fuzzy ... END   ← nunca se ejecuta
```

**Fix:** `20260428_REDO_fix_matcher_generic_rfc_canonical_invoices.sql`
- Re-aplica `CREATE OR REPLACE FUNCTION matcher_company` con la lógica
  correcta (detect generic ANTES de exact match)
- Re-ejecuta los 3 backfills (issued/received/SAT-only)
- Llama `refresh_canonical_company_financials()` para actualizar agregados

### 🔴 BUG #2 — `canonical_payments.counterparty_canonical_company_id` stale

**Severity:** HIGH — afecta cobranza/payments dashboards y auditoría
intercompañía.

**Magnitud (live 2026-04-28):**
- 31 canonical_payments con FK distinto al `canonical_companies.id` actual
  vía `odoo_partner_id`
- $2,441,053 MXN afectado
- Patrón: 8+ payments apuntando a id=825 "Jose J. Mizrahi" cuando deberían
  apuntar a id=133797 "Jose Jaime Mizrahi Tuachi" (merge previo no propagó)

**Causa:** el fix de SHAWMUT (`1df34b1`) backfilleó `canonical_invoices`
pero NO `canonical_payments`. El mismo patrón aplica:
```
canonical_payments.odoo_partner_id  →  canonical_companies.odoo_partner_id  →  id
```

**Fix:** `20260428_fix_canonical_payments_counterparty_fk_backfill.sql`
- UPDATE WHERE distinct (idempotente)
- Pre/post NOTICE con counts

### 🔴 BUG #3 — Generic-RFC SAT-only orphans en "default sinks"

**Severity:** HIGH — ofusca top customers reales, infla métricas de
falsos clientes.

**Magnitud:**
- MOSTRADOR id=11 acumula **2,076 SAT-only invoices** spanning **851
  receptor_nombre distintos** (después del fix #1, muchos serán resueltos)
- HANGZHOU id=630 acumula **299 SAT-only invoices** foreign

**Fragmentación verificada:**
| Cliente | Spellings desperdigados | Total $ |
|---|---|---:|
| SHAWMUT | LLC / CORPORATION / , LLC | **$17.27M** |
| FXI INC | INC. / INC / , INC. | **$96.28M** |
| MNT LATINOAMERICANA | + 1 variant | $4.86M |
| CGT CANADIAN GENERAL TOWER | LTD / LIMITED | $3.97M |
| VERATEX LINING | LTD / LTD. | $2.85M |
| LEAR MEXICAN SEATING | + 2 variants | $1.79M |
| JOSÉ CARRILLO VILLEGAS | 3 spellings | $352K |
| JORGE JUAREZ | with/without acento | $211K |
| ALEJANDRO CERVANTES MARTÍNEZ | (no canonical existente) | $7.30M |

**Causa:** el matcher con threshold 0.90 falla cuando los nombres difieren
en sufijos comunes (LLC vs CORPORATION) o puntuación. Hay canonical_companies
existentes (SHAWMUT id=1606, JORGE JUÁREZ id=317, JESÚS ESCAMILLA id=633)
que no se matchearon porque `similarity` < 0.90.

**Fix:** `20260428_resolve_generic_rfc_orphans_in_default_sinks.sql`
1. Helper fn `_orphan_match()` con threshold 0.70 (excluye default sinks)
2. Step A: fuzzy 0.70 contra canonicals existentes → recupera SHAWMUT,
   JORGE, JESÚS, etc.
3. Step B: autocreate shadows para nombres sin match Y volumen alto
   (≥5 facturas O ≥$50K MXN) → captura FXI, CGT, VERATEX, LEAR, ALEJANDRO
4. Step C: re-point invoices a los nuevos shadows
5. Repite para `direction='received'` (proveedores con generic RFC)

**Threshold de auto-creación:** count ≥ 5 OR total_mxn ≥ $50K. Esto evita
crear miles de shadows espurios para mostradores walk-in legítimos. Los
de bajo volumen quedan en el default sink (acceptable noise).

## Lo que NO está roto (verificado)

- ✓ `canonical_credit_notes` FKs: 0 stale
- ✓ `canonical_contacts` emails duplicados: 0 (UNIQUE constraint)
- ✓ `canonical_products` internal_ref duplicados: 0
- ✓ `source_links` orphans (apuntan a canonical_id no existente): 0
- ✓ `canonical_companies` duplicados por `odoo_partner_id`: 0
- ✓ `canonical_contacts` duplicados por `odoo_user_id`: 0
- ✓ `trg_canonical_company_from_odoo` excluye correctamente generic RFCs
  (`AND v_rfc_clean NOT IN ('XAXX010101000','XEXX010101000','MITJ991130TV7')`)
- ✓ `matcher_contact()` y `matcher_product()` no tienen el equivalente
  bug porque emails/internal_ref son únicos en sus tablas

## Patrones que vale revisar a futuro

1. **Joins por nombre fuzzy sin threshold definido**: cualquier RPC que use
   `similarity()` debería documentar el threshold y por qué.
2. **mdm_merge_companies()**: ¿propaga al canonical_payments / canonical_credit_notes?
   Hoy NO lo hace para canonical_payments — bug #2 lo confirma.
3. **Refresh de agregados**: `refresh_canonical_company_financials()` se
   llama explícitamente en los fixes; debería ser un trigger AFTER UPDATE
   sobre `canonical_invoices.receptor_canonical_company_id` para auto-mantener.
4. **Autocreate threshold en matcher_company_if_new_rfc**: hoy autocreate=true
   significa que cada CFDI nuevo de un RFC desconocido crea shadow. Si llega
   un CFDI con typo en el nombre, crea shadow duplicado.

## Aplicar las migrations

Orden estricto (cada una depende de la anterior):

1. **`20260428_REDO_fix_matcher_generic_rfc_canonical_invoices.sql`**
   - Re-aplica matcher_company correcto + backfills básicos
   - Pre-validation: `node scripts/audit-mdm-cleanup/01-pre-fix.mjs`
   - Post-validation: `node scripts/audit-mdm-cleanup/02-post-matcher-fix.mjs`

2. **`20260428_fix_canonical_payments_counterparty_fk_backfill.sql`**
   - Pre/post: contadores en RAISE NOTICE de la migration misma

3. **`20260428_resolve_generic_rfc_orphans_in_default_sinks.sql`**
   - **HIGH IMPACT** — afecta dashboards de revenue por cliente
   - Pre-validation: `node scripts/audit-mdm-cleanup/03-pre-orphan-fix.mjs`
   - Post-validation: `node scripts/audit-mdm-cleanup/04-post-orphan-fix.mjs`
   - Esperado: SHAWMUT YTD sube de ~$8M a ~$25M+, FXI aparece como top
     customer ($96M+), MOSTRADOR id=11 pasa de 2,076 a ~500-800 invoices
     legítimas.

Cada migration es idempotente — si por alguna razón corrió ya o se
re-aplica, no causa daño (CREATE OR REPLACE + UPDATE WHERE distinct).
