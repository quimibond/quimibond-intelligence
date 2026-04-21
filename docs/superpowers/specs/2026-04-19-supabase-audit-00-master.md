# Supabase Audit & Reorg — Master Plan

**Fecha:** 2026-04-19
**Proyecto:** `tozqezmivpblmcubmnpi`
**Dueño:** @jose.mizrahi
**Tipo:** Plan maestro — referencia las sub-specs de cada fase

---

## 1. Contexto

El Supabase de Quimibond Intelligence creció orgánicamente y acumuló deuda técnica en 3 dimensiones:

1. **Basura estructural.** 5 tablas muertas (0 rows), 4 funciones con firmas duplicadas, 6+ triggers redundantes por tabla, 24 tablas sin consumer frontend, MVs que nunca refrescaron.
2. **Datos rotos.** Reconciliation engine parado ~2 días (solo 2 de 8 `issue_types` vivos). 3,774 filas duplicadas por `cfdi_uuid` en `odoo_invoices` (1,547 UUIDs). 6,601 `reconciliation_issues` que nunca se auto-resuelven. 2,373 `order_lines` huérfanas. 1,286 payments con partners inexistentes. `odoo_snapshots` stale 21h. `odoo_crm_leads` con solo 20 rows sin actividad >2d.
3. **Capa unificada incompleta.** El frontend tiene un feature flag `USE_UNIFIED_LAYER` y coexisten caminos `legacy*` (raw Odoo) y `unified*` (invoices_unified / payments_unified). Resultado visible al usuario: "veo partes de Odoo en un lado y partes de Syntage en otro". Matching Syntage↔Odoo: solo 9% de cobertura Syntage→Odoo, 82% Odoo→Syntage (3,482 CFDIs Quimibond sin Syntage).
4. **Seguridad teatro.** 66 policies RLS todas con `qual=true` → tablas fiscales, bancarias, RFCs, nómina abiertas a `anon`. 85 `security_definer_view` (ERROR). 9 tablas sin RLS. 43 funciones con `search_path` mutable. Extensions `pg_trgm` y `vector` en `public`.
5. **Performance.** `invoices_unified` (247 MB) + `payments_unified` (31 MB) con REFRESH CONCURRENTLY cada 15 min solapando con `refresh_all_matviews` cada 2h sobre 35 MVs. FKs sin índice cubridor. 11 índices confirmados sin uso.

## 2. Síntoma que originó este plan

> "Necesito que audites Supabase. Hay mucha basura y muchas cosas que no funcionan correctamente. Dashboards con números incorrectos o vacíos, reconciliación Syntage/Odoo con discrepancias sospechosas, no veo la realidad unificada — solo veo en unas partes cosas de Odoo y en otras cosas de Syntage."

## 3. Alcance

**Dentro:**
- Schema completo de `tozqezmivpblmcubmnpi.public` (80 tablas, 79 views, 35 MVs, ~260 funciones, ~75 triggers, 5 crons)
- Custom schema `ingestion`
- Edge function `query-intelligence`
- Todos los writers: addon qb19 (`_push_*`), webhooks Syntage, API routes de frontend, crons.
- Todos los consumers: frontend Next.js (`/Users/jj/quimibond-intelligence`), addon Odoo (pulls de Supabase).

**Fuera:**
- Auth config de Supabase (provider setup, email templates)
- Frontend UI/UX rediseño (solo tocamos data fetching)
- Odoo business logic (solo el sync layer)

## 4. Estrategia — 5 fases

Secuencia guiada por dolor del usuario (contención primero, UI unificada segunda, seguridad tercera). Cada fase tiene su propio spec con acciones, DoD y riesgos.

| Fase | Spec | Duración | Desbloqueada por |
|---|---|---|---|
| 0 — Contención | [01-contencion](./2026-04-19-supabase-audit-01-contencion.md) | 3–5 días | — (arranca ya) |
| 1 — UI unificada | [02-ui-unificada](./2026-04-19-supabase-audit-02-ui-unificada.md) | 10–14 días | Fase 0 |
| 2 — Limpieza | [03-limpieza](./2026-04-19-supabase-audit-03-limpieza.md) | 5–7 días | Fase 1 |
| 3 — Seguridad | [04-seguridad](./2026-04-19-supabase-audit-04-seguridad.md) | 10–14 días | Fase 2 |
| 4 — Performance | [05-performance](./2026-04-19-supabase-audit-05-performance.md) | 5–7 días | Fase 3 |

**Total:** 33–47 días hábiles. Paralelizable si hay más de un ejecutor (Fases 3 y 4 pueden correr en paralelo).

## 5. Principios guía

1. **No romper producción.** Cada cambio destructivo (DROP, ALTER, RLS) pasa por `audit_runs` antes/después para detectar regresión.
2. **Audit trail.** `schema_changes` registra cada DDL. Adicionalmente cada fase deja una migración idempotente en Supabase.
3. **Reversibilidad.** Antes de DROP, confirmar 0 dependencias (usar función `dependents_of` ya existente).
4. **Unified-first.** A partir de Fase 1, ningún consumer nuevo puede leer raw Odoo — solo views unificadas. Se bloqueará vía lint custom de CI.
5. **Lint = 0 ERROR al final.** Fase 3 debe cerrar con `mcp__supabase__get_advisors(security)` sin ERROR.

## 6. Métricas de éxito del plan completo

| Métrica | Baseline (2026-04-19) | Target post-fase 4 |
|---|---|---|
| `security` ERRORs | 94 | 0 |
| `security` WARNs | 134 | <15 justificadas |
| Duplicados `cfdi_uuid` | 1,547 grupos | 0 |
| `reconciliation_issues` open | 16,721 | <5,000 |
| Auto-resolve issue_types | 2/8 | 8/8 |
| Matching Syntage↔Odoo | 9% / 82% | ≥95% / ≥95% |
| Consumers raw Odoo en UI | ~15 archivos | 0 (fuera de admin/debug) |
| Tablas 0-row (excl. seeds) | 5 | 0 |
| Funciones con firma duplicada | 4 | 0 |
| MVs que nunca analyzed | 1 | 0 |
| Crons con overlap/lock | 0 (sin protección) | 100% con `pg_advisory_lock` |

## 7. Riesgos globales

| Riesgo | Mitigación |
|---|---|
| DROP de tabla usada por view sin detectar | Usar `dependents_of()` + `pg_depend` antes de cada DROP |
| RLS restrictivo rompe `anon_key` del frontend | Fase 3 inicia con branch `db_branch` de Supabase para testing |
| Dedup de `cfdi_uuid` borra factura legítima | Archivar (no DROP) en `odoo_invoices_archive_pre_dedup`, retener 90 días |
| Refresh incremental de MVs falla en algún edge case | Mantener cron de REFRESH completo como fallback durante 2 semanas |
| Extensions a schema `extensions` invalida índices existentes | Recrear antes de mover en Fase 3 |

## 8. Tracking

Cada fase deja:
- Migración idempotente en `supabase/migrations/`
- Entrada en `schema_changes` con descripción
- Nota en `MEMORY.md` del usuario para continuidad
- Commit con mensaje `chore(supabase): phase N — <resumen>`

Este spec se actualiza al cierre de cada fase con el link al PR/commit final.
