# Quimibond Intelligence — Memoria de correo de Quimibond

> Versión anterior (2,012 líneas, describe capas silver/gold, agentes, costeo y
> el frontend que ya no existen): `docs/historico/CLAUDE-2026-09-18-antes-de-la-limpieza.md`.
> Este archivo describe SOLO lo que existe hoy.

## Qué es

Memoria institucional del correo de Quimibond (empresa textil mexicana):
**52 buzones de Gmail → Supabase → Claude → Odoo / MCP.** Supabase guarda el
correo completo, lo liga a las empresas y contactos de Odoo, y Claude lo
resume en conversaciones, hechos con vigencia y un grafo. Se consume desde:

1. **Claude por MCP** (Supabase + Odoo) en las sesiones de trabajo del CEO.
2. **Odoo**: pestaña Memoria del contacto (addon `qb_memoria` de qb19) y
   pendientes → obligaciones (`qb_obligation`).
3. **El correo diario** (`email-digest`, 12:45 UTC) al CEO.

**Stack:** Supabase (Postgres + pg_cron + pg_net + Vault + Storage) y Edge
Functions en Deno (`supabase/functions/*`). Proyecto `tozqezmivpblmcubmnpi`,
compute **Medium**. Repos: `quimibond-intelligence` (este) y `qb19` (addons de
Odoo 19 en Odoo.sh).

## Decisión: Supabase solo guarda lo que Odoo no tiene (2026-09-16/17/18)

- **2026-09-16** — el frontend Next.js se retira (0 visitas en 7 días; las
  vistas de negocio viven en Odoo). Crons de Vercel apagados; los pipelines de
  correo pasan a Edge Functions + pg_cron.
- **2026-09-17** — el SAT vive en Odoo (`quimibond_sat`). Se apagan los jobs
  silver/gold y el push de qb19 se reduce a contactos.
- **2026-09-18** — se borra de Supabase todo lo que duplicaba Odoo o el SAT
  (bronze `odoo_*`, `syntage_*`, silver `canonical_*`, gold, MVs, agentes,
  grafo viejo, costeo, ~660 funciones, 33 jobs). La base pasó de 9.4 GB a
  5.0 GB. Migración documental: `supabase/migrations/20260918d_limpieza_supabase_solo_memoria.sql`.

Dónde vive hoy cada cosa que se fue:

| Antes en Supabase | Hoy |
|---|---|
| CFDI, complementos de pago, comparación Odoo↔SAT (`syntage_*`, `canonical_invoices`…) | Odoo, addon `quimibond_sat` (qb19). El webhook de Syntage apunta a Odoo. |
| Costeo, P&L limpio, centros de costo, costo reconstruido | Odoo, addon `qb_capacidad_costeo` |
| Indicadores y tableros del CEO (`gold_*`, `/hoy`, `/dinero`) | Odoo, SGI (`quimibond_sgi`) y `quimibond_cash_flow` |
| Agentes de IA / insights | Retirados (2026-08-05); sin sustituto |
| `odoo_pending_actions` | `qb19/docs/HALLAZGOS_ODOO_PENDIENTES_2026-09-18.md` |
| Pendientes del correo | Siguen aquí (`email_pending_actions`); destino: `qb_obligation` en Odoo |
| Ficha de memoria por empresa | `memoria_brief` → pestaña Memoria en Odoo (`qb_memoria`) |

**Regla para cualquier cifra de negocio:** la fuente es Odoo por MCP. Aquí
solo hay correo y lo derivado del correo.

## Frontend y Vercel (retirados)

`src/` (Next.js 15) está retirado desde 2026-09-16: cero uso, ninguna ruta se
mantiene a propósito. `vercel.json` ya no tiene crons (el plan Hobby rechazaba
el deploy). **Borrar `src/` y el proyecto de Vercel es decisión pendiente del
CEO**: el proyecto de Supabase nació desde la integración de Vercel, así que
antes de borrar la integración hay que mover la organización de Supabase a una
cuenta propia. No tocar `src/`, `package.json` ni Vercel sin esa decisión.

## Inventario de Supabase (esquema `public`, verificado 2026-09-18)

### Tablas (21)

| Tabla | Qué guarda |
|---|---|
| `emails` (317k, 4.0 GB) | Correo completo: `body_full`, `body_html`, `body_clean` (sin citas ni firma), headers de threading (`message_id_hdr`, `in_reply_to_hdr`, `references_hdr`), `cc`/`bcc`, `labels`, `raw_storage_path` (JSON de Gmail en `email-raw`), `ingest_version` (1 legacy cortado a 5k chars, 2 completo), `sender_contact_id`, `company_id` |
| `threads` (166k) | Un hilo por buzón de Gmail; `conv_key` agrupa los hilos hermanos de una misma conversación; `company_id`, `last_activity`, agregados |
| `email_attachments` (430k) | Un registro por adjunto: sha256, ruta en `email-attachments`, `extracted_text` (PDF/Excel/Word/CSV), `extract_status`/`skip_reason`/`attempts`, `claimed_at` (reclamo del extractor), `texto_tsv` (tsvector generado + GIN para `memoria_buscar`). **Solo se extraen adjuntos de correos de 2026** (decisión CEO 2026-09-18); los anteriores quedan `skipped` con `antes_2026`. El mismo archivo aparece 3 veces (un correo por buzón): al leer, deduplicar por `sha256` |
| `email_backfill_state` (52) | Cursor del backfill v2 por buzón (`since`, `page_token`, `done`). Terminado 52/52 |
| `gmail_accounts` (52) | Buzones sincronizados; `active=false` saca uno del sync |
| `sync_state` (52) | `last_history_id` de Gmail por buzón (cursor incremental; no avanza si falla el insert) |
| `sync_commands` | Comandos para Odoo; qb19 los lee cada 5 min y marca `status` |
| `backfill_log` | Bitácora de corridas del backfill |
| `contacts` (2.4k) | Contactos: los de Odoo (`odoo_partner_id`) más los creados por dominio desde el correo. Email en minúsculas |
| `companies` (2.3k) | Empresas de Odoo (`odoo_partner_id`, `rfc`, `is_customer`/`is_supplier`, `domain`); `canonical_name` en minúsculas |
| `odoo_users` (44) | Usuarios/empleados de Odoo. Se conservó para el grafo (`usuario`) y `memoria_encargados` |
| `memoria_thread_summaries` (1.5k) | Resumen vivo por conversación (PK `thread_id` canónico): `tema`, `resumen`, `estado`, `esperando_a`, `tono`, `acuerdos`, `pendientes`, `summarized_through`, `version` |
| `memoria_facts` (2k) | Hechos con vigencia por empresa o contacto: `categoria`, `hecho`, `vigente_desde/hasta`, `status`, `confianza`, `evidencia`, `veces`. Dedup por hash del texto |
| `kg_nodes` (6k) / `kg_edges` (11k) | Grafo: nodos `empresa`, `contacto`, `usuario`, `buzon`, `hilo`, `producto`, `tema`; aristas `trabaja_en`, `persona_de`, `atiende[:area]`, `escribe_a`, `sobre`, `participa` con peso y evidencia |
| `email_pending_actions` (455) | Pendientes accionables por hilo (extraídos por Claude), con vencimiento y `expire_email_pending_actions` |
| `customer_demand_signals` (752) | Señales de demanda halladas en cuerpos y adjuntos (Excel/CSV) |
| `demand_scan_log` | Qué correos/adjuntos ya se escanearon por demanda |
| `email_digests` | Resúmenes diarios generados (JSON + HTML enviado) |
| `pipeline_logs` (20k) | Log de todas las Edge Functions (`phase`, `level`, `details.runtime='edge'`); el watchdog escribe `phase='watchdog'` |
| `token_usage` (9k) | Tokens por llamada a Claude (`endpoint`, modelo, entrada/salida) |

### Vistas (4)

| Vista | Para qué | Quién la lee |
|---|---|---|
| `memoria_encargados` | Qué buzón (y área) atiende a cada empresa, con % de participación | Odoo `qb_memoria` (cron nocturno escribe el dueño en el contacto) |
| `memory_coverage` | Cobertura del ingest v2 y de adjuntos | Humanos / Claude por MCP |
| `odoo_push_last_events` | Último evento de push por método desde `pipeline_logs` | `health` (edad del push de `contacts`) |
| `claude_cost_summary` | Costo de Claude por endpoint y día desde `token_usage` | Humanos / Claude por MCP |

### Funciones SQL / RPCs (32)

**Consumidas por Odoo (`qb_memoria`):** `memoria_brief(p_company_id | p_odoo_partner_id)`
→ ficha jsonb (empresa, encargados, contactos, hechos vigentes, últimas 12
conversaciones, stats). Odoo también lee directo `memoria_encargados`,
`threads`, `email_pending_actions` y `customer_demand_signals`.

**Consumidas por Claude por MCP:** `memoria_buscar(p_texto, p_company_id, p_limit)`
(búsqueda websearch en español sobre resúmenes, hechos y **texto de adjuntos**;
las filas `tipo='adjunto'` traen nombre de archivo, fecha y fragmento resaltado)
y luego `memoria_brief` de la empresa. Ejemplo:
`select * from memoria_buscar('condiciones de pago shawmut')`.

**Consumidas por Edge Functions:**

| RPC | Quién | Qué hace |
|---|---|---|
| `ingest_emails_v2` | `sync-emails`, `backfill-sweep` | Upsert de correos; solo actualiza si `ingest_version` entrante es mayor |
| `analyst_query` | `email-extract`, `email-digest` | SELECT de solo lectura parametrizado para armar el contexto de Claude |
| `memoria_hilos_pendientes` | `memory-consolidate` | Cola de conversaciones por `conv_key` (hilo canónico + hermanos) |
| `memoria_hilo_mensajes` | `memory-consolidate` | Correos de una conversación sin duplicar entre buzones, con `adjuntos_texto` (texto de hasta 3 adjuntos por correo, dedup por sha256, 2,500 caracteres cada uno) |
| `memoria_adjuntos_reusar_hermanos`, `memoria_adjuntos_reclamar` | `attachments-extract` | Heredar sha/archivo/texto entre buzones (mismo Message-ID) sin volver a bajar; reclamar lotes con `FOR UPDATE SKIP LOCKED` + `claimed_at` para correr dos invocaciones por minuto |
| `memoria_guardar_consolidacion` | `memory-consolidate` | Escribe resumen, hechos y grafo en una transacción |
| `get_unanswered_client_threads`, `get_silent_customers` | `email-digest` | Hilos de cliente sin respuesta y clientes callados |
| `expire_email_pending_actions` | `email-extract` | Vence pendientes viejos |
| `memoria_cron_health` | `health` | Lee `cron.job_run_details` por job |
| `edge_secret` | todas | Lee un secreto de Vault |

**Infraestructura (pg_cron → Edge):** `invoke_edge(fn, body)`,
`invoke_edge_per_account(fn)` (una llamada por buzón activo),
`invoke_edge_backfill_pending(p_max)` (ya sin job).

**Ligas y grafo (SQL puro, sin Claude):** `memoria_link_recent(interval)`
(contactos nuevos por dominio, `sender_contact_id`, `company_id` y `conv_key`
del hilo), `memoria_thread_conv_key`, `kg_refresh_deterministic`,
`kg_upsert_node`, `kg_upsert_edge`, `auto_link_email_company_by_domain`,
`auto_resolve_contact_company`, `resolve_contact_by_email`,
`extract_company_payment_terms`.

**Helpers y triggers:** `memoria_email_addr`, `memoria_email_name`,
`memoria_generic_domain`, `extract_email`, `normalize_company_name`,
`normalize_contact_email`, `companies_sanitize_name`, `set_updated_at`.

### Storage

`email-raw` (payload JSON `format=full` de Gmail, ~25 KB por correo) y
`email-attachments` (adjuntos ≤ 3 MB deduplicados por sha256). Ambos privados.

### Secretos (Vault, RPC `edge_secret`)

Solo nombres, nunca valores: `cron_secret` (header `x-cron-secret` entre
pg_cron y las funciones), `google_service_account_json`, `anthropic_api_key`.
Las funciones se despliegan con `verify_jwt=false`; la autorización es el
`cron_secret`.

## Jobs pg_cron → Edge Functions (10, todos `memoria_*`)

| Job | Cuándo (UTC) | Qué corre | Qué hace |
|---|---|---|---|
| `memoria_sync_emails` | `*/30` | `invoke_edge_per_account('sync-emails')` | Sync incremental de Gmail (History API), 52 llamadas de ~1 s |
| `memoria_attachments_extract` | cada minuto | `attachments-extract` ×2 (`generate_series(1, 2)`) | Baja adjuntos a Storage y extrae texto, chicos primero, con presupuesto de CPU (700 KB parseados y 45 s por invocación). Las dos invocaciones se reparten la cola con `memoria_adjuntos_reclamar`; ~100 filas/min (2026-09-18) |
| `memoria_consolidar` | `*/5` | `memory-consolidate` | 10 conversaciones por corrida con Sonnet → resumen, hechos, grafo |
| `memoria_ligas` | `*/10` | SQL `memoria_link_recent('3 days')` | Ligas determinísticas correo ↔ contacto ↔ empresa ↔ conversación |
| `memoria_watchdog` | `:05` | `health` | Salud de jobs, push de Odoo, Gmail y errores; correo al CEO máx. 1/día |
| `memoria_email_digest` | 12:45 | `email-digest` (Opus) | Resumen ejecutivo del correo de 24 h → `email_digests` + correo HTML |
| `memoria_extract_pending` | `:40` cada 2 h | `email-extract {task:"pending"}` (Sonnet) | Pendientes por hilo → `email_pending_actions` |
| `memoria_extract_demand` | `:50` cada 2 h | `email-extract {task:"demand"}` | Demanda en cuerpos → `customer_demand_signals` |
| `memoria_extract_demand_files` | `:55` cada 2 h | `email-extract {task:"demand_files"}` | Demanda en Excel/CSV adjuntos |
| `memoria_grafo_nocturno` | 08:15 | SQL `kg_refresh_deterministic()` | Nodos y aristas que salen de los datos (empresas, contactos, buzones, quién atiende a quién) |

`backfill-sweep` sigue desplegada pero sin job: el backfill v2 desde
2025-10-01 terminó (52/52). Para re-sembrarlo, insertar en
`email_backfill_state` y volver a programar `memoria_backfill_sweep`
(`*/1`, `invoke_edge_backfill_pending(2)`).

## Odoo ↔ Supabase (qb19, addon `quimibond_intelligence`)

- **Push cada hora:** `contacts` (contactos + empresas, con RFC) y
  `odoo_users`. Parámetro `quimibond_intelligence.push_models` (default
  `contacts`; ya no hay tablas `odoo_*` a donde empujar el resto).
- **Pull cada 5 min:** `sync_commands` pendientes.
- El watchdog avisa si el push de `contacts` lleva > 6 h sin éxito
  (`odoo_push_last_events`).
- `qb_memoria` lee la memoria por REST con la service key y la muestra en la
  pestaña Memoria del contacto ("Quién la atiende", "Lo que sabemos",
  "Conversaciones"); su cron nocturno escribe los dueños aprendidos desde
  `memoria_encargados`.

## Cómo desplegar

**Edge Function:** editar `supabase/functions/<nombre>/index.ts` (código común
en `_shared/`: `env.ts`, `gmail.ts`, `claude.ts`, `mailer.ts`, `email-parse.ts`,
`email-clean.ts`, `email-persist.ts`, `digest-email-html.ts`) y desplegar con
`supabase functions deploy <nombre> --no-verify-jwt --project-ref tozqezmivpblmcubmnpi`
o con el MCP de Supabase (`deploy_edge_function`). Probar a mano con
`select invoke_edge('<nombre>', '{}'::jsonb)`; el resultado queda en
`pipeline_logs`. Claude en las funciones: SDK `npm:@anthropic-ai/sdk` en
`_shared/claude.ts`; digest con `claude-opus-5`, extractores y consolidación
con `claude-sonnet-5` (effort low), tokens a `token_usage`.

**Migración:** archivo `supabase/migrations/YYYYMMDD<letra>_<tema>.sql`,
idempotente (`IF NOT EXISTS`, `CREATE OR REPLACE`), aplicada con
`supabase db push` o `apply_migration` por MCP. Los jobs pg_cron se crean en
la migración con `cron.schedule` y se dejan activos solo cuando la función ya
está desplegada.

## Reglas aprendidas (no repetir)

- **Nunca abanicar decenas de invocaciones largas de Edge a la vez.** 52
  `backfill-sweep` simultáneos tiraron la base 40 min (2026-09-16). El sync de
  52 cuentas se tolera porque cada llamada dura ~1 s.
- **`emails` no lleva índice HNSW.** El de 818 MB contra 256 MB de buffers hacía
  que cada UPDATE del ingest costara segundos. La columna `embedding` se
  conserva sin índice hasta que se decida borrarla (Fase 5).
- **2 s de CPU por invocación** de Edge Function: los extractores trabajan con
  presupuesto de bytes y pocos adjuntos por corrida.
- **Compute Medium** (1 GB de buffers, 120 conexiones). Incidente 2026-09-17:
  con Small la base pasó 9 h saturada en IO (backfill + adjuntos cada minuto
  sobre `emails` de 3.4 GB) y el watchdog no avisó porque consulta la misma
  base. Cadencia de contención si se repite: backfill `*/2` con
  `invoke_edge_backfill_pending(1)`, adjuntos `*/5`.
- El cursor de Gmail (`sync_state.last_history_id`) no avanza si falla el
  insert. Sanear NUL y surrogates sueltos antes de `ingest_emails_v2`.
- Supabase no guarda cifras de negocio: no crear tablas espejo de Odoo.

## Memoria Fase 3 (2026-09-18): ligas, resúmenes vivos, hechos y grafo

- **Ligas** (`memoria_link_recent`, cada 10 min): contactos nuevos por dominio
  de empresa de Odoo, `sender_contact_id`, `threads.company_id`, agregados y
  `conv_key`. Motivo: tras apagar Vercel el ingest creaba hilos sin ligar
  (0 % de `sender_contact_id`). Backfill de 60 días hecho el 18-sep.
- **Una conversación = un resumen.** Gmail abre un hilo por buzón; el mismo
  intercambio en 3 buzones son 3 `threads`. `conv_key` = Message-ID raíz
  (`references_hdr[1]` o `message_id_hdr` del correo más antiguo; fallback
  `gmail_thread_id`). `memoria_hilos_pendientes()` agrupa por `conv_key`
  (canónico = menor id) y `memoria_hilo_mensajes()` devuelve los correos sin
  duplicar. En 30 días: 15,155 hilos = 8,727 conversaciones.
- **Qué entra a la cola:** empresas de Odoo (cliente o proveedor, dominio no
  genérico) con alguien de fuera en la conversación, de 2+ correos o de 1
  correo reciente (14 d) de la contraparte. Prioridad: ya resumidas con correo
  nuevo → multi-correo → recientes. El resumen se rehace incremental (resumen
  anterior + correos nuevos) cuando `last_activity > summarized_through`.
- **Costo y ritmo:** Sonnet, ~5.8k tokens de entrada y ~1.1k de salida por
  conversación (`token_usage.endpoint='memory-consolidate'`); 10 por corrida
  de 5 min ≈ 2,900/día máximo. `max_tokens 3000`; si Claude se corta la
  llamada falla explícitamente (no se guarda JSON a medias).
- Diseño completo, cutover, incidentes y checklist:
  `docs/memoria-quimibond-diseno.md`.

## Deuda conocida y siguientes pasos

- Hechos casi duplicados con distinta redacción (dedup solo por hash exacto).
- Los primeros 51 resúmenes incluyeron conversaciones internas (antes del
  filtro de la cola).
- `contacts.role` se llena desde `personas` solo si estaba vacío.
- `emails` aún carga `body` (compat), `embedding` sin índice y columnas de
  proceso viejas; la Fase 5 (drop) reduce la tabla a la mitad.
- El watchdog vigila la base desde la misma base: hace falta un ping externo.
- Adjuntos (2026-09-18): el texto entra a la memoria desde esa fecha; las
  ~1.5k conversaciones ya resumidas no se rehacen con sus adjuntos hasta que
  llegue correo nuevo. Las 60k imágenes (`image_vision_phase3`) siguen fuera.
  Cola inicial: 111k filas de 2026 (~40k documentos distintos), ~1 día al
  ritmo actual; el sync de Gmail las va sumando.
- **Siguientes:** pendientes de `memoria_thread_summaries` → obligaciones en
  Odoo (`qb_obligation.create_candidate`); "pregúntale a la memoria" desde la
  ficha del contacto; memoria de decisiones del CEO; borrar `src/` y Vercel
  cuando el CEO lo decida; borrar del dashboard las Edge Functions
  `syntage-daily`, `syntage-webhook` y `query-intelligence` (ya no están en el
  repo).
