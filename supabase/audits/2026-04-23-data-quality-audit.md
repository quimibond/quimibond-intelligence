# Data Quality Audit — Supabase

**Fecha:** 2026-04-23
**Alcance:** `public` schema de `tozqezmivpblmcubmnpi` (Odoo sync + Syntage SAT + canonical MDM + agentes)
**Método:** Queries REST (PostgREST) con paginación a todas las tablas clave + vistas gold + reconciliation engine
**Branch:** `claude/audit-supabase-data-HGNiN`

---

## Resumen ejecutivo

Sistema con **sync operativamente sano** (todas las tablas Odoo fresh <1h) pero con **cola grande de inconsistencias de reconciliación Odoo↔SAT** (35,253 issues abiertos con impacto MXN $1,670,470,823). La mayoría son arrastre histórico (pre-operationalization), no nuevos.

Hallazgos por gravedad:

- **4 CRITICAL** (datos corruptos o routing roto)
- **7 HIGH** (gaps visibles al CEO o bloqueando automatización)
- **6 MEDIUM** (mejoras de calidad a mediano plazo)
- **4 INFO** (status quo documentado)

### Comparación vs auditoría anterior (2026-04-16)

| Hallazgo 2026-04-16 | Status 2026-04-23 |
|---|---|
| H11 invoice_lines coverage 2.6% | ✅ **RESUELTO** — 14,572 distinct move_ids / 14,553 posted out_invoice = 100.1% |
| H8/H9 companies con nombre numérico (193) | ❌ **PERSISTE** — 193 exactamente los mismos |
| C3 dashboard FX hardcoded 17.4 | Fuera de scope (requiere inspeccionar `get_dashboard_kpis`) |
| C4 queries de contacts con columnas muertas | Fuera de scope (frontend) |

---

## CRITICAL — fix inmediato

### C1. 93% de `action_items` sin `company_id` y 100% sin `thread_id`

- **Síntoma:** 4,180 de 4,463 action_items (93.7%) tienen `company_id = NULL`; los 4,463 (100%) tienen `thread_id = NULL`.
- **Impacto:** `action_items` existe para que el CEO vea tareas por empresa y por hilo. Ambos links rotos → el panel Accionables ya no puede filtrar por contexto comercial ni trazar la tarea a su email origen.
- **Probable causa:** el writer del pipeline inserta `null` en vez de resolver el link vía `contact_id → companies` / vía `email_id → threads`.
- **Sugerencia fix:** en el handler que crea action_items, derivar `company_id` desde `contact_id` (join `contacts.company_id`) y `thread_id` desde `alert_id` o `source_id` si apuntan a un email/thread.

### C2. 2,997 de 3,095 action_items `pending` ya están vencidos (97%)

- **Síntoma:** `state='pending' AND due_date < now` = 2,997 filas.
- **Distribución por edad (`created_at`):** 280 < 7d, 2,815 entre 7-30d, 0 mayores a 30d.
- **Impacto:** El pipeline está generando due_dates muy cortos y nadie los cierra → la UI se llena de rojo y pierde señal.
- **Sugerencia fix:** (a) Ajustar `default_due_days` a valor realista (14d/30d según priority). (b) Ejecutar auto-expire para marcar `state='expired'` en items con `due_date < now - 7d` y `state='pending'`.

### C3. 31 de 40 `odoo_users` sin `department` (77.5%)

- **Síntoma:** `odoo_users.department IS NULL` para 31/40 usuarios, incluyendo Jose J. Mizrahi (CEO), Sandra Dávila (cobranza), Oscar Gonzalez (calidad) y Paris Villordo (planeación).
- **Impacto:** El trigger `route_insight` en `agent_insights` depende de `insight_routing.department_id → departments → odoo_users.department`. Si el user tiene `department=null`, el join regresa vacío y la asignación cae al default.
- **Validación cruzada:** `agent_insights` tiene `assignee_user_id` en todos (0 NULL) — el routing funciona vía `assignee_email` hardcoded en alguna parte. Vale confirmar de dónde sale realmente el assignee.
- **Sugerencia fix:** en qb19 `_push_users`, resolver `department` desde `hr.employee.department_id.name` como el CLAUDE.md lo documenta. Hoy el campo viene NULL porque el employee no está linkeado o el map no se construye.

### C4. 4,342 de 4,350 `canonical_companies` con `blacklist_level='none'` — bien, PERO 5 `definitive` + 3 `presumed` sin review en dashboard

- **Síntoma:** El modelo de blacklist 69-B está poblado, pero no hay panel de UI que liste las 8 empresas activamente flagged.
- **Impacto:** Se puede facturar/pagar a RFCs 69-B definitivos sin warning en tiempo real.
- **Sugerencia fix:** exponer `canonical_companies WHERE blacklist_level != 'none'` en `/compliance` o `/empresas` con badge rojo.

---

## HIGH — inconsistencias visibles

### H1. 193 `companies` con nombre numérico (persistente desde 2026-04-16)

- **Ejemplos:** `id=264635 name='3443' rfc=NULL odoo_partner_id=3434`, `id=264570 name='7539' rfc=NULL`, etc.
- **Causa:** root en qb19 `_push_contacts` — inserta el `commercial_partner_id.id` como texto cuando `partner.name` está vacío o es numérico.
- **Estado en el frontend:** el workaround H8 (aplicar `sanitizeCompanyName` en `CompanyLink`) probablemente oculta algunos, pero 2 contactos con `name='11'` y `name='15'` indica que también hay contactos con el mismo problema.
- **Fix definitivo:** en qb19, antes de persistir, validar `name` — si es numérico puro o vacío, fallback a `commercial_partner_id.name → vat → email → skip`.

### H2. 13 grupos de `companies` duplicados por RFC

- **Validado:** 13 RFCs con múltiples filas. `XAXX010101000` (77 rows, esperado — público general). Los otros 12 son duplicados reales.
- **Ejemplos críticos:**
  - `PNT920218IW5`: dos empresas distintas comparten RFC (`PREMIER WORLD CHEMICALS LLC` vs `PRODUCTORA DE NO TEJIDOS QUIMIBOND`) — uno de los dos tiene el RFC mal.
  - `ACM8306296D2`: `ATLAS COPCO MEXICANA, S.A. DE C.V.` (id=446462) y `ATLAS COPCO MEXICANA` (id=6758) — mismo RFC, dos Odoo partner IDs.
  - `SNR9902268P2`, `PTA0910094N1`: idem.
- **Fix:** deduplicar manualmente vía `mdm_merge_companies(a, b, user, note)` (SP3). Para `PNT920218IW5` investigar cuál es el RFC correcto.

### H3. 2,162 `canonical_companies` shadow (SAT-only) sin match Odoo + `needs_review=true`

- **Síntoma:** 50% del MDM son shadows creados por `matcher_company_if_new_rfc` sin contraparte en `companies` — `needs_review=true` en todas.
- **Impacto:** Facturas SAT de estos RFCs nunca se van a poder operacionalizar hasta que alguien haga el link manual.
- **Status:** Es esperado (SP3 creó shadows intencionalmente), pero el backlog de review es grande. Urgente: priorizar los shadows con `total_invoiced_sat_mxn` alto.
- **Sugerencia:** panel en `/empresas/shadows` que liste los top-100 por volumen facturado.

### H4. 20 odoo_invoices posted NO están en canonical_invoices NI en canonical_credit_notes

- **Impacto $$:** incluye `FACTU/2025/06/213` por **$1,509,276 MXN** (in_invoice posted). Total: 20 invoices, todas `in_invoice` excepto una `out_invoice` (INV/2025/04/0158 $3,828).
- **Probable causa:** matcher / backfill SP3 19 (`canonical_invoices_fk_backfill`) falló por falta de emisor RFC, o el invoice no tiene `sat_uuid` y su counterpart SAT tampoco lo tiene.
- **Fix:** investigar por qué estos 20 quedaron fuera; correr `matcher_invoice_quick()` con esos IDs.

### H5. 14,063 `canonical_payments` marcados `needs_review=true` (36%)

- **Síntoma:** de 39,060 canonical_payments, 14,063 (36%) necesitan revisión. 13,601 tienen `amount_unallocated > 0` (pago no asignado 100%).
- **Impacto:** el flujo de reconciliación pago↔factura tiene backlog grande.
- **Cruce con reconciliation_issues:** cuadra con los 12,182 `payment.complement_without_payment` abiertos (impacto MXN $536,968,437).

### H6. `payment.complement_without_payment` es el #1 open issue (12,182 abiertos, $537M MXN)

- **Contexto:** Un "complemento sin payment" significa que SAT registró un pago (complemento) pero Odoo no lo tiene en `account_payment`.
- **Growth rate:** 76,482 total, 64,300 manual_resolved, 0 auto_resolved → se resuelve manualmente pero el ritmo (130 manual_resolved/day según trend 2026-04-23) no alcanza al ritmo de detección.
- **Impacto financiero:** $537M MXN en pagos SAT-only sin contrapartida Odoo → AR ya cobrado pero no contabilizado.
- **Sugerencia:** priorizar auto-matcher por `amount + counterparty_rfc + fecha_pago_sat` (actualmente 0 auto_resolved).

### H7. `invoice.pending_operationalization` = 4,607 abiertos, $655M MXN

- Facturas SAT que no tienen reflejo en Odoo (`odoo_invoice_id IS NULL`). Volumen alto = AR fiscal no registrado.
- **Ya hay 10,072 manual_resolved históricos.** Abre oportunidad de auto-matcher por `uuid + emisor_rfc`.

---

## MEDIUM — calidad de data master

### M1. 824 de 2,199 `companies` sin RFC (37%)

- Mayoría coincide con los 193 numeric-name + 631 con nombres tipo "mostrador/particulares" (personas físicas sin RFC en Odoo).
- **Impacto:** no se pueden cruzar con SAT → quedan como Odoo-only.

### M2. 904 de 2,199 `companies` sin `country` (41%)

- Campo se puebla desde `partner.country_id.name` en qb19; muchos partners legacy no lo tienen en Odoo.
- **Impacto:** `gold_company_360` y filtros por país se degradan.

### M3. 831 de 7,231 `odoo_products` sin `internal_ref` (11.5%)

- CLAUDE.md dice que `internal_ref` es el identificador de display preferido. 11.5% de productos se van a mostrar con nombre largo en vez de SKU.
- **Fix:** auditar qué productos son (probablemente servicios, productos descontinuados, o ítems administrativos que no necesitan SKU).

### M4. 1,899 `odoo_products` con `list_price=0` + 2,044 con `standard_price=0` (26%-28%)

- **Impacto:** `product_margin_analysis` y `gold_product_performance` calculan márgenes infinitos o división por cero para estos productos.
- **Fix:** excluir `list_price=0 OR standard_price=0` en las views de análisis de margen.

### M5. 4 `odoo_products` con `stock_qty < 0`

- Stock negativo no debería existir. Indica operación de inventario no registrada correctamente en Odoo.

### M6. 372 de 2,038 `contacts` sin `entity_id` (18%) + 208 sin `company_id` (10%)

- El trigger `auto_link_contact_entity` y el auto-fix no han logrado linkear estos contactos.
- **Impacto:** knowledge graph incompleto; insights relacionados a estos contactos no se asocian a su empresa.

---

## INFO — status quo documentado

### I1. Sync freshness: 100% fresh

- 18/18 tablas Odoo sync con <1h de antigüedad, 0 errores en `odoo_push_last_events`. Infraestructura de sync saludable.

### I2. Canonical layer (SP3 MDM):

- `canonical_companies` 4,350 = 2,197 con `odoo_partner_id` + 2,162 shadow + 825 `is_foreign`.
- `match_method`: 1,363 por `odoo_partner_id+rfc`, 825 solo `odoo_partner_id`, 2,162 `sat_only`.
- `match_confidence` promedio 0.75 (min 0.50 max 1.00).

### I3. Agent infrastructure:

- 20 `ai_agents` definidos, 9 `is_active=true` (7 directores + compliance + costos).
- 2,721 memorias persistentes distribuidas across agents (agent 18 / Costos tiene 556).
- 594 `agent_runs` ejecutados. Último run: 2026-04-23T14:00 (hoy).
- `agent_insights`: 605 total. 73% en estado `archived` (auto-cleanup funcionando).

### I4. Refunds ↔ credit notes:

- Los 583 refunds de Odoo (`out_refund`+`in_refund`) están 100% reflejados en `canonical_credit_notes`. OK.

---

## Conteo de objetos auditados

| Categoría | Tablas/Views | Rows |
|---|---|---|
| Odoo raw (`odoo_*`) | 20 | 226,459 |
| Syntage raw (`syntage_*`) | 12 | 336,649 |
| Canonical (`canonical_*`) | 10 | 137,624 |
| Knowledge graph (`entities/facts/emails/threads`) | 4 | 206,201 |
| Intelligence (`agent_*/action_items/ai_*`) | 8 | 40,796 |
| Reconciliation (`reconciliation_issues/audit_*`) | 3 | 245,689 |
| Gold views | 12 | 38,383 |

---

## Anexo — Top invariantes abiertos (impacto MXN)

| Invariant | Abiertos | Impacto MXN | Auto-res | Manual-res |
|---|---:|---:|---:|---:|
| invoice.pending_operationalization | 4,607 | $655,080,788 | 22 | 10,072 |
| payment.complement_without_payment | 12,182 | $536,968,437 | 0 | 64,300 |
| payment.registered_without_complement | 1,466 | $220,019,321 | 0 | 48,346 |
| invoice.without_order | 4,644 | $61,312,049 | 0 | 942 |
| order.orphan_invoicing | 3,135 | $40,772,008 | 0 | 0 |
| inventory.accounting_without_move | 2,317 | $31,599,763 | 0 | 0 |
| invoice.ar_sat_only_drift | 67 | $27,943,732 | 0 | 0 |
| inventory.move_without_accounting | 153 | $18,235,936 | 0 | 0 |
| invoice.ap_sat_only_drift | 310 | $7,534,451 | 0 | 0 |
| manufacturing.material_cost_variance | 372 | $6,940,157 | 0 | 0 |

**TOTAL abierto:** 35,253 issues · $1,670,470,823 MXN · 27 critical + 14,630 high

---

## Recomendaciones priorizadas

1. **Fix inmediato C1/C2:** reparar writer de `action_items` (company_id/thread_id backfill) + auto-expire pending > 7d. Esto desbloquea la UI de accionables.
2. **Fix qb19 _push_users:** resolver `department` desde `hr.employee.department_id` (C3). 31 users sin departamento rompe routing.
3. **Auto-matcher SAT→Odoo:** priorizar `payment.complement_without_payment` — hoy 0 auto_resolved. Matcher por (`amount_mxn`, `counterparty_rfc`, `fecha_pago_sat±3d`) podría cerrar miles.
4. **Deduplicación MDM:** correr `mdm_merge_companies()` para los 12 RFCs duplicados (excluyendo XAXX genérico).
5. **Panel blacklist 69-B:** exponer las 8 empresas flagged en `/empresas` como warning (C4).
6. **qb19 numeric-names fix:** 193 companies con nombre numérico persisten desde abril-16. Arreglar en el push, no solo en el sanitize del frontend.
7. **Backfill 20 invoices huérfanos:** investigar y forzar match de los 20 posted invoices que no tienen canonical.
