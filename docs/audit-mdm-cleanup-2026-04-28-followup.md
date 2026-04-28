# Audit MDM cleanup — followup 2026-04-28

Continuación del audit `audit-mdm-cleanup-2026-04-28.md`. Después de aplicar
las 3 migrations originales, se encontraron 5 bugs adicionales.

## Aplicado live + persistido como migration

### ✅ BUG #4 — `mdm_merge_companies` no propaga a nuevos silvers

**Síntoma:** al consolidar duplicados (151492 → 633), error 23503:
> Key (id)=(633) is still referenced from table canonical_account_payments

**Causa:** las silvers `canonical_account_payments` y `canonical_activities`
se crearon en sesión 2026-04-27 (commits `c89ee95` y `b8a8dcc`) con FK a
`canonical_companies(id)`, pero nadie agregó `UPDATE` lines al body de
`mdm_merge_companies`.

**Patrón general:** cada nueva silver con FK a `canonical_companies` DEBE
agregarse a `mdm_merge_companies`. Esto es trivial de olvidar.

**FKs verificadas vs body actualizado de mdm_merge:**
| Tabla.columna | Estado original | Post-fix |
|---|---|---|
| canonical_invoices.emisor_canonical_company_id | ✓ | ✓ |
| canonical_invoices.receptor_canonical_company_id | ✓ | ✓ |
| canonical_payments.counterparty_canonical_company_id | ✓ | ✓ |
| canonical_credit_notes.emisor_canonical_company_id | ✓ | ✓ |
| canonical_credit_notes.receptor_canonical_company_id | ✓ | ✓ |
| canonical_contacts.canonical_company_id | ✓ | ✓ |
| **canonical_account_payments.canonical_company_id** | ⨯ | **✓** |
| **canonical_activities.canonical_company_id** | ⨯ | **✓** |
| source_links.canonical_entity_id | ✓ | ✓ |

**Migration:** `20260428_fix_mdm_merge_companies_new_silvers.sql`

### ✅ BUG #5 — No existen `mdm_merge_contacts` ni `mdm_merge_products`

**Síntoma:** 201 nombres dup en canonical_contacts, 485 en canonical_products.
Sin función no se pueden consolidar sistemáticamente.

**Fix:** creadas ambas funciones siguiendo el patrón de `mdm_merge_companies`:
- Tie-break determinístico (manual_override → internal_ref → stock_qty / email)
- Propagación a TODAS las tablas con FK al canonical
- Audit trail en `mdm_manual_overrides`
- DELETE del victim

**Migration:** `20260428_create_mdm_merge_contacts_products.sql`

**Uso futuro:**
```sql
SELECT mdm_merge_contacts(losing_id, winning_id, 'user_email', 'merge note');
SELECT mdm_merge_products(losing_id, winning_id, 'user_email', 'merge note');
```

## Aplicado live (consolidación de duplicados detectados)

7 merges aplicados via mdm_merge_companies:

| Survivor | Victim | Concepto |
|---|---|---|
| id=151466 ALEJANDRO CERVANTES MARTÍNEZ | id=151465 (sin acento) | Variant unicode |
| id=317 MOSTRADOR. JORGE JUÁREZ | id=151496 JORGE JUÁREZ | Existing canonical |
| id=634 MOSTRADOR JOSE CARRILLO VILLEGAS | id=151500 JOSE CARRILLO VILLEGAS | Existing canonical |
| id=634 (idem) | id=151501 JOSÉ CARRILLO VILLEGAS | Variant acento |
| id=151492 jesus escamilla jaimes | id=633 (deleted, FK fallback) | Survivor por lifetime_value |
| id=151492 (idem) | id=151493 JESÚS ESCAMILLA JAIMES | Variant case |

⚠ **Anomalía detectada en mdm_merge:** cuando ambos tienen has_shadow_flag=true,
el tie-break por lifetime_value puede hacer que el shadow (con $110K acumulado)
gane sobre el canonical original (con $0 — nunca se computó refresh). Ej: id=633
fue eliminado y el shadow id=151492 sobrevivió. Para forzar el survivor
correcto, llamar primero `UPDATE canonical_companies SET has_manual_override=true
WHERE id=desired_survivor` antes del merge.

## Documentado pero no fixeado (alcance separado)

### 🟡 BUG #6 — 1,264 canonical_payments con counterparty NULL

**No resolvible vía odoo_partner_id JOIN** porque esos partner_ids (e.g., 1, 3516,
10546) NO existen en `canonical_companies`. Significa que hay partners en Odoo
que NUNCA se canonicalizaron. Probablemente son:
- partner_id=1 = Quimibond mismo (referenced from internal payments)
- partner_ids 3xxx/10xxx = partners de Odoo que solo aparecen como pagadores
  pero nunca tuvieron una invoice de venta/compra (por eso no entraron al sync)

**Para resolver:** triggear sync de `res.partner` para esos IDs específicos
desde Odoo, o crear shadows automáticos via SQL leyendo
`canonical_payments.partner_name` cuando esté disponible.

### 🟡 BUG #7 — 24 bronze companies sin canonical match

**Síntoma:** `companies` table tiene 24 rows con `odoo_partner_id NOT NULL` cuya
`odoo_partner_id` no existe en `canonical_companies.odoo_partner_id`.

**Causa probable:** companies viejas creadas antes del trigger
`trg_canonical_company_from_odoo` (introducido en SP3 2026-04-23). Trigger
es AFTER INSERT/UPDATE — no se dispara para rows preexistentes.

**Fix sugerido:** UPDATE silenciosa de los 24 partners para forzar trigger:
```sql
UPDATE companies SET updated_at = now()
WHERE odoo_partner_id NOT IN (SELECT odoo_partner_id FROM canonical_companies WHERE odoo_partner_id IS NOT NULL)
  AND odoo_partner_id IS NOT NULL;
```

### 🟢 BUG #8 — 2,321 canonical_companies sin odoo_partner_id (mostly OK)

**Esperado** para shadows creados desde SAT extraction. 2,056 tienen invoices
(usado por reporting). No es bug per se — solo nota.

### 🟢 BUG #9 — 201 canonical_contacts dup, 485 canonical_products dup

**Pendiente:** consolidar manualmente con `mdm_merge_contacts` /
`mdm_merge_products` cuando el CEO o el equipo de datos tenga tiempo. Sample:

```
"abraham penhos"          x2 (ids 21, 2135)
"abasteo.mx"             x3 (ids 869, 1763, 2010)
"almacenes seguros"      x8 (ids 472, 1595, 1695, ...)
```

## Cache keys bumpeados (Vercel ISR invalidation)

```
sp13-empresas-top-ltv          → -v2-mdm-cleanup
sp13-empresas-portfolio-kpis   → -v2-mdm-cleanup
sp13-empresas-at-risk-overview → -v2-mdm-cleanup
sp13-empresas-drifting         → -v2-mdm-cleanup
sp13-finanzas-customer-ltv     → -v2-mdm-cleanup
```

Esto fuerza recompute de `/empresas` y `/finanzas` customer-ltv
para reflejar SHAWMUT $13.74M YTD, FXI $177M lifetime, etc.

## Patrón a documentar en CLAUDE.md

> Cuando creas una nueva silver `canonical_*` con FK a `canonical_companies`,
> `canonical_contacts`, o `canonical_products`, **DEBES agregar `UPDATE`
> statements en el body de `mdm_merge_*` correspondiente**. Sin esto, los
> merges fallarán con FK violations en producción cuando alguien intente
> consolidar duplicados.

---

**Resumen total session audit-mdm-cleanup (2026-04-28):**

| # | Bug | Status |
|---|---|---|
| 1 | matcher_company genérico-RFC bug (deployed era buggy) | ✅ FIXED LIVE |
| 2 | canonical_payments stale FK ($2.44M) | ✅ FIXED LIVE |
| 3 | Generic-RFC SAT-only orphans en default sinks (65 shadows nuevos) | ✅ FIXED LIVE |
| 4 | mdm_merge_companies no propaga a nuevos silvers | ✅ FIXED LIVE |
| 5 | mdm_merge_contacts + mdm_merge_products no existían | ✅ FIXED LIVE |
| 6 | 1,264 canonical_payments NULL counterparty | 🟡 documented |
| 7 | 24 bronze companies sin canonical match | 🟡 documented |
| 8 | 2,321 canonical_companies sin odoo_partner_id (mostly OK) | 🟢 nota |
| 9 | 201 contacts dup, 485 products dup | 🟢 herramientas listas |
