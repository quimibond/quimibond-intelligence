# Quimibond Intelligence — Flujo de Datos en su Mejor Versión

**Fecha:** 2026-04-12
**Autor:** Brainstorming jj + Claude
**Estado:** Documento de visión (no de implementación)
**Propósito:** Definir cómo se ve el sistema cuando funciona perfectamente, para poder priorizar qué arreglar primero.

---

## 1. Qué es Quimibond Intelligence (en una oración)

Un **consejo ejecutivo de inteligencia artificial** para el CEO de Quimibond: un equipo de directores IA que leen todos los datos operativos de la empresa (Odoo + Gmail + fuentes externas) y entregan al CEO **recomendaciones estratégicas prescriptivas** — qué hacer para crecer, bajar costos, ser más eficiente, y reducir riesgo — no tableros ni alertas.

Inspiración: **Project Prometheus** de Jeff Bezos en Amazon. El CEO no consulta datos; el consejo IA los analiza y le dice qué hacer, con evidencia y razonamiento transparentes.

Es un producto de una sola empresa, no SaaS. El éxito se mide por **recomendaciones accionadas y su impacto en P&L**, no por datos mostrados.

---

## 2. La experiencia del usuario en su mejor versión

### 2.1 El CEO (Jose)

**Su rutina ideal con el sistema funcionando al 100%:**

1. **6:45 AM — Briefing estratégico en WhatsApp.** Un párrafo sintetizado por el agente Meta que resume el análisis nocturno del consejo IA: "Anoche el Director de Ventas IA analizó los últimos 12 meses y encontró que el segmento textil industrial creció 34% pero tenemos margen 8 puntos bajo el químico — recomienda subir precio 6% a los 12 clientes menos sensibles (lista adjunta, impacto estimado +$180k/mes). El Director Cobranza IA detectó que 3 clientes nuevos tienen patrón de pago tardío similar a Cliente Y (que canceló en 2025) — recomienda mover a CoD preventivo. Flujo de caja sano a 90 días."

2. **Semanal — Reporte de oportunidades estratégicas.** Cada lunes, el consejo IA entrega un reporte consolidado con **3-5 recomendaciones** priorizadas por impacto en P&L: crecimiento, eficiencia, costos, riesgo. Cada recomendación incluye: qué hacer, por qué (evidencia), impacto estimado, directores involucrados, y qué pasaría si no se hace. Jose decide aprobar/diferir/rechazar; lo rechazado alimenta el aprendizaje.

3. **Durante el día — `/inbox` como cockpit táctico.** Llegan insights urgentes solo cuando algo requiere acción humana inmediata (ej. cancelación de CFDI, cliente crítico con queja, pago rebotado). No ruido de operación normal — esa la manejan los directores humanos.

4. **Pregunta libre — `/chat` con el consejo.** "¿Por qué cayeron los márgenes en el Q1?" → el consejo IA responde con análisis multi-dimensional (producto, cliente, proveedor, costo de materia prima) citando datos específicos y proponiendo acciones correctivas.

5. **Al final del día — Jose no opera, decide.** El trabajo operativo lo hacen los directores humanos ayudados por sus contrapartes IA. Jose lee reportes estratégicos y aprueba direcciones, no apaga incendios.

### 2.2 Los 7 directores

Cada uno tiene su propia vista filtrada del `/inbox` según su dominio:
- **Guadalupe (Ventas)** ve solo insights de ventas/CRM/clientes estratégicos.
- **Sandra (Cobranza)** ve vencidos, flujo de caja, límites de crédito.
- **Dario (Logística)** ve entregas tardías, stockouts, lead times.
- Etc.

Los umbrales son **personalizables por director** (min_impact, confidence_floor, max_runs) vía `director_config`. Lo que es "crítico" para uno puede ser "fyi" para otro.

El sistema aprende de cada director: si Sandra siempre descarta alertas de <$10k, el agente Cobranza sube su umbral para ella automáticamente.

### 2.3 El consejo de directores IA (corazón del sistema)

Este es el diferenciador de QI. No son "agentes que alertan" — son **analistas estratégicos autónomos** que leen toda la información histórica y actual, identifican patrones, y proponen acciones.

**7 directores de negocio IA:**
- **Director de Ventas IA** — Analiza segmentos, cohortes, precios, elasticidad, pipeline, concentración de clientes. Pregunta que responde: *"¿Dónde está mi próxima avenida de crecimiento y qué precio puedo subir sin perder volumen?"*
- **Director de Cobranza IA** — Analiza patrones de pago, riesgo de crédito, cash conversion, cohortes de morosidad. Pregunta: *"¿Qué cliente va a dejar de pagarme y cómo lo prevengo?"*
- **Director de Operaciones IA** — Analiza throughput, lead times, OTD, cuellos de botella. Pregunta: *"¿Dónde pierdo eficiencia y qué cambio libera más capacidad?"*
- **Director de Manufactura IA** — Analiza costos de producción, rendimientos, scrap, BOM. Pregunta: *"¿Qué producto está destruyendo margen y por qué?"*
- **Director de Compras IA** — Analiza proveedores, lead times, precios de insumos, riesgo de suministro. Pregunta: *"¿Qué puedo renegociar, consolidar, o cambiar de proveedor para bajar costos?"*
- **Director de Riesgo IA** — Analiza exposición financiera, legal, operacional, concentración. Pregunta: *"¿Qué puede hundir a la empresa y qué falta para prevenirlo?"*
- **Director de Crecimiento IA** — Analiza oportunidades cross-sell, nuevos segmentos, tendencias de clientes, competencia. Pregunta: *"¿Qué hacen mis mejores clientes que los demás no, y cómo replico ese patrón?"*

**3 agentes de sistema:**
- **Meta Director IA** — Coordina al consejo. Reconcilia recomendaciones conflictivas (ej. Ventas quiere bajar precio, Cobranza dice que ese cliente ya es riesgo). Genera el briefing ejecutivo consolidado. Decide qué es urgente vs estratégico.
- **Data Quality IA** — Vigila que los directores lean datos completos y frescos. Si detecta huecos, frena al director afectado y repara.
- **Odoo Advisor IA** — Propone cambios al ERP (campos, reportes, módulos) cuando los directores necesitan datos que no existen todavía.

**Qué producen los directores:**
- **Recomendaciones estratégicas** (output principal): qué hacer, por qué, impacto estimado en $, directores involucrados, ventana temporal, riesgos si no se hace. Van al `/strategy` y al briefing semanal.
- **Insights tácticos** (output secundario): eventos que requieren respuesta humana en <48h. Van al `/inbox`.
- **Análisis bajo demanda**: cuando el CEO pregunta en `/chat`, el director correspondiente ejecuta análisis profundo y responde.

**Propiedades no negociables del consejo:**
- **Acceso a datos completos** — los directores leen histórico completo (no solo últimos 5 registros). Para eso necesitan que la Capa 2 tenga integridad total.
- **Razonamiento transparente** — cada recomendación viene con la cadena de pensamiento y los datos citados. El CEO puede auditar.
- **Memoria persistente** — refinan su modelo mental de la empresa con cada decisión del CEO (`agent_memory` + `reasoningbank`).
- **Presupuesto de tokens/mes** — con cap duro. Priorizan análisis estratégico sobre re-trabajo.
- **Delegación entre sí** vía `agent_tickets`. Si Cobranza detecta un patrón, abre ticket a Ventas para contacto preventivo.
- **Despiertan por eventos** además del cron. Cancelación CFDI → Riesgo inmediato.
- **Cero alucinación** — si no hay evidencia concreta en los datos, no se genera recomendación. El Data Quality IA valida antes de publicar.

---

## 3. Alcance del producto en su mejor versión

### 3.1 Lo que el usuario puede hacer

| Superficie | En su mejor versión |
|---|---|
| **/strategy** *(nueva)* | Reporte estratégico del consejo IA. Recomendaciones priorizadas por impacto en P&L con razonamiento y evidencia. Estados: propuesta → aprobada → en ejecución → medida (con impacto real medido vs estimado). Es la superficie más importante. |
| **/inbox** | Cockpit táctico. Solo eventos que requieren decisión humana <48h. Ordenados por impacto real en $. Swipe para actuar/descartar. Cada acción alimenta aprendizaje del consejo. |
| **/dashboard** | 6 KPIs siempre frescos (<5 min). Top 3 recomendaciones estratégicas vigentes + top 3 urgencias tácticas. Un botón: "refrescar ahora". |
| **/briefings** | Narrativas del Meta Director IA. Diaria (táctica), semanal (estratégica), mensual (revisión de recomendaciones pasadas y su impacto). Entregable en WhatsApp. |
| **/actions** | To-dos extraídos de insights. Assignee real (salesperson/buyer de Odoo, no genérico). Estado trackeado end-to-end. |
| **/agents** | Panel de control: ver última corrida, memoria, efectividad (% de insights accionados), presupuesto consumido, disparar manualmente. |
| **/companies** | Vista 360 B2B. Tiering automático (estratégico/importante/key supplier/transaccional). Health score basado en: revenue trend, overdue aging, OTD rate, sentimiento de emails recientes. |
| **/contacts** | Perfil de persona enriquecido: decision_power, communication_style, language_preference, patrón de respuesta, influencia en deals. |
| **/chat** | RAG sobre knowledge graph completo. "¿Quién en Cliente X toma las decisiones de compra?" debe responder con evidencia de emails reales. |
| **/knowledge** | Grafo explorable: entidades, hechos, relaciones. Vista de qué ha extraído Claude y con qué confianza. |
| **/system** | Health del pipeline: última sync por modelo, rows sincronizados vs perdidos, staleness por tabla, presupuesto de tokens consumido. |

### 3.2 Lo que NO es este sistema (anti-alcance)

- **No es un ERP.** Odoo sigue siendo la fuente de verdad transaccional. QI lee, razona, recomienda — no escribe facturas.
- **No es un CRM.** No reemplaza el CRM de Odoo; lo enriquece con inteligencia de comunicaciones.
- **No es multi-tenant.** Es para Quimibond. Optimizaciones genéricas de SaaS (billing, org switcher, etc.) no aplican.
- **No es un tablero BI.** No compite con Metabase/Looker. El CEO no consulta datos — el consejo IA los consulta por él. Los charts que aparecen son **evidencia de recomendaciones**, no herramientas de exploración libre.
- **No es un sistema reactivo.** No se trata solo de alertar cuando algo se rompe. Su trabajo principal es **análisis estratégico proactivo** — encontrar oportunidades que nadie está mirando.
- **No genera decisiones autónomas.** Recomienda con evidencia, el humano aprueba. Excepciones de ejecución automática: auto-limpieza de insights vencidos, deduplicación de datos, linkeo de huérfanos. Cualquier acción con impacto de negocio requiere aprobación explícita.

---

## 4. Flujo de datos ideal — Arquitectura en su mejor versión

### 4.1 Las 4 capas

```
┌─────────────────────────────────────────────────────────────┐
│  CAPA 4: PRESENTACIÓN                                       │
│  Next.js frontend — solo lee intelligence + RPCs           │
│  Consume: agent_insights, briefings, company_profile,     │
│  contacts, knowledge graph                                 │
└─────────────────────────────────────────────────────────────┘
                            ▲
┌─────────────────────────────────────────────────────────────┐
│  CAPA 3: INTELIGENCIA                                       │
│  Agentes Claude + RAG sobre knowledge graph                 │
│  Produce: insights, briefings, action items, profiles      │
│  Lee de: capa 2 (nunca directo de Odoo)                    │
└─────────────────────────────────────────────────────────────┘
                            ▲
┌─────────────────────────────────────────────────────────────┐
│  CAPA 2: DATA LAKE (Supabase)                               │
│  • odoo_* tables (espejo de Odoo, append/upsert)           │
│  • emails, threads, entities, facts (knowledge graph)      │
│  • sync_queue, sync_log, reconciliation_log (plumbing)     │
└─────────────────────────────────────────────────────────────┘
                            ▲
┌─────────────────────────────────────────────────────────────┐
│  CAPA 1: FUENTES DE VERDAD                                  │
│  • Odoo (20 modelos transaccionales)                       │
│  • Gmail (emails, threads)                                 │
│  • Fuentes externas (futuro: banca, competidores)          │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Contratos entre capas (lo que debe ser cierto siempre)

**Capa 1 → Capa 2 (Odoo → Supabase):**
- Todo cambio en Odoo aparece en Supabase en **≤15 minutos** (SLA ideal: ≤5 min para datos críticos como facturas/pagos, ≤1h para datos de contexto como productos).
- **Cero pérdida silenciosa**: si un row falla, queda registrado en `sync_failures` con su ID y razón, y un job de reconciliación lo reintenta.
- **Idempotencia garantizada**: el mismo evento sincronizado 2 veces produce el mismo estado final.
- **Conteos reconciliables**: un job diario compara `SELECT COUNT(*) FROM odoo_invoices WHERE write_date > X` en ambos lados. Si difieren, alerta al sistema.

**Capa 2 → Capa 3 (Data → Consejo IA):**
- Los directores IA leen **datos completos, no muestras**. No "últimas 5 facturas" — los últimos 24 meses completos cuando corresponde. Esto hace la integridad de Capa 2 existencial: un análisis de cohorte sobre datos incompletos produce recomendaciones peligrosas.
- Los directores solo operan sobre tablas con **`synced_at` dentro del SLA**. Si una tabla tiene staleness > SLA o `sync_failures > 0`, el director afectado se **bloquea** y reporta al Data Quality IA. Prefiere no recomendar que recomendar mal.
- Cada recomendación incluye **evidencia explícita** (IDs de registros fuente + razonamiento). Sin evidencia concreta, no se produce.
- Los directores tienen **claims sobre entidades** — no dos directores generan recomendaciones conflictivas sobre el mismo cliente sin coordinarse vía tickets + Meta Director.
- Los directores tienen acceso a **vistas materializadas analíticas** (cohortes, agregaciones, tendencias) calculadas en Postgres, no en el agente. El agente razona sobre el resultado, no sobre raw data. Esto controla costo de tokens y evita alucinación por contexto truncado.

**Capa 3 → Capa 4 (Intelligence → Frontend):**
- El frontend nunca lee tablas `odoo_*` directamente. Solo lee artefactos de inteligencia (`agent_insights`, `briefings`, `company_profile`).
- Cada artefacto expuesto al usuario trae **timestamp de frescura** visible: "última actualización hace 3 min".
- Los RPCs son el contrato estable. Los cambios de schema en Odoo no rompen el frontend si los RPCs absorben la traducción.

### 4.3 Los 4 ciclos de datos

**Ciclo 1: Sync transaccional (Odoo → Supabase)**
- Trigger: evento en Odoo (factura creada, pago reconciliado, orden confirmada).
- Mecanismo: cola `sync_queue` escrita por triggers ORM en Odoo; worker la procesa en batches.
- Fallback: cron horario que escanea por `write_date` como red de seguridad.
- Reconciliación: job diario que cuenta y repara divergencias.

**Ciclo 2: Ingesta de emails (Gmail → Supabase)**
- Trigger: Gmail push notification (webhook) o polling cada 30 min.
- Mecanismo: parsing → extracción de entidades con Claude → upsert en knowledge graph.
- Deduplicación por `message_id`.

**Ciclo 3: Generación de inteligencia (Consejo IA)**
- **Ciclo estratégico (lento, profundo)**: cada noche, cada director IA corre un análisis completo sobre histórico agregado (vistas materializadas). Produce 0-3 recomendaciones estratégicas con impacto, evidencia, plan. Costoso en tokens; se justifica por profundidad.
- **Ciclo táctico (rápido, reactivo)**: cada 15 min, round-robin por agente, evalúa novedades desde la última corrida. Produce insights urgentes si hay eventos que requieren acción humana <48h.
- **Trigger por evento**: wake-on-business-event (cancelación CFDI, queja de cliente, pago rebotado → director correspondiente inmediato).
- **Bajo demanda**: `/chat` dispara al director correspondiente con pregunta específica.
- Filtro: hallucination guards + confidence floor + Data Quality IA valida integridad de datos fuente antes de persistir cualquier output.

**Ciclo 4: Feedback loop (Frontend → Agentes)**
- Trigger: usuario marca insight como `acted`/`dismissed`.
- Mecanismo: el agente actualiza su memoria con el outcome. Si `dismissed` con razón "falso positivo", el patrón que lo generó pierde peso.
- Resultado: los agentes convergen al estilo de decisión del CEO.

---

## 5. Las propiedades que definen "funciona bien"

Cuando el sistema está en su mejor versión, estas son las propiedades **observables** que deben cumplirse:

### 5.1 Integridad

- **P1. Sin pérdida silenciosa.** Cualquier row que falla al sincronizar queda en `sync_failures` con causa. Un dashboard muestra el backlog. Cero WARNING-y-continúa.
- **P2. Reconciliación diaria.** Cada noche, un job compara conteos Odoo↔Supabase por tabla. Diferencias >0 generan insight al agente Data Quality.
- **P3. Sin duplicados.** Cada modelo tiene unique constraint en Supabase sobre la clave estable. Duplicados en memoria = error, no warning.
- **P4. Sin huérfanos.** Invoice lines siempre tienen su invoice parent sincronizado. Orden importa: padres antes que hijos, o FKs diferidos.

### 5.2 Frescura

- **P5. SLA por tabla.** Datos críticos (invoices, payments) ≤5 min. Datos de contexto (products, employees) ≤1h. Visible en `/system`.
- **P6. Timestamp en todo.** Cada tabla `odoo_*` tiene `synced_at` poblado en cada upsert. El frontend puede mostrar frescura.
- **P7. Staleness como señal.** Un agente no produce insight sobre datos stale; reporta el staleness en su lugar.

### 5.3 Observabilidad

- **P8. Métricas por sync.** `sync_log` con: rows_intentados, rows_exitosos, rows_perdidos, duración, por tabla. Parseable, no string libre.
- **P9. Alertas automáticas.** Si `rows_perdidos > 0` O si staleness supera SLA, se genera insight al agente Data Quality.
- **P10. Trazabilidad end-to-end.** Dado un insight, puedo rastrear: qué datos lo generaron → cuándo se sincronizaron → cuándo el agente los leyó → cuándo se presentó al usuario → qué hizo el usuario.

### 5.4 Evolución

- **P11. Schema drift detectable.** Migraciones de Supabase versionadas. El push de Odoo valida que las columnas existen antes de intentar; si no, el agente Evolve propone la migración.
- **P12. Agentes evolucionan.** Memoria persistente + feedback loop = cada mes los agentes son mejores midiendo la tasa de `acted/(acted+dismissed)`.

---

## 6. Qué **hay** hoy vs **qué falta** para llegar a la mejor versión

### ✅ Ya existe (no tocar)

- Separación de capas: frontend nunca lee `odoo_*` directo.
- Retry con backoff exponencial en `supabase_client.py`.
- `force_full_sync` como escape hatch manual.
- Hallucination guards (`hasConcreteEvidence`, `looksLikeMetaHallucination`).
- `director_config` con umbrales personalizados.
- Materialized view `company_profile` refrescado.
- RLS sólido: tablas `odoo_*` deny-all, solo inteligencia expuesta.
- Patrón M2M directo para CFDI UUID (leer de fuente, no stored field).
- Knowledge graph funcional (entities, facts, relationships).

### 🟡 Existe pero incompleto (requiere trabajo dirigido)

- **Observabilidad del sync**: `sync_log` existe pero es string libre → hacerlo estructurado.
- **Staleness tracking**: solo `activities` tiene `synced_at` → extender a todas las tablas.
- **Reconciliación**: no existe job que compare conteos → crear.
- **Dedup**: solo `invoices` deduplica → extender patrón o mover a constraints en DB.
- **Conflict keys**: algunos frágiles (null-tolerant) → endurecer en Supabase con unique constraints.
- **Briefings**: existen pero no hay delivery a WhatsApp.
- **Agent tickets**: planeado en PLAN_PAPERCLIP.md, no implementado.

### ❌ No existe (gap vs visión)

- **P1 (sin pérdida silenciosa)**: hoy los chunks perdidos solo se loggean.
- **P2 (reconciliación diaria)**: inexistente.
- **P3 (sin duplicados por constraint DB)**: confiado al código Python.
- **Wake-on-event**: todo es cron.
- **Agent budget enforcement**: agentes pueden gastar sin tope.
- **Schema drift detection automática**: ausente.
- **Trazabilidad end-to-end** (insight ← datos ← sync ← acción): fragmentada.

---

## 7. Principios de priorización (para decidir qué atacar primero)

Cuando decidamos qué arreglar en qué orden, usemos estas reglas:

1. **Integridad es existencial.** El consejo IA analiza todo el histórico para dar recomendaciones estratégicas. Un hueco de 5% en los datos = recomendaciones sistemáticamente sesgadas = pérdidas reales en P&L. Antes de que los directores IA sean "estrategas", los datos tienen que ser irrefutables. Por eso Fase 0 es integridad, no features del consejo.
2. **Observabilidad antes que arreglo.** No puedes arreglar lo que no ves. Primero instrumenta, luego optimiza.
3. **Constraints en DB > checks en código.** Un unique constraint de Postgres atrapa lo que 10 bugs de Python olvidan.
4. **Vistas materializadas > razonamiento sobre raw data.** Los directores IA deben razonar sobre agregaciones pre-calculadas. Controla tokens y evita alucinación por contexto truncado.
5. **Eventos > cron**, pero **solo donde el SLA lo exige.** No convertir todo en event-driven por estética.
6. **Auto-healing > alerting.** Si el sistema puede repararse solo (reconciliación, link_orphan_insights), debe hacerlo antes de molestar al humano.
7. **YAGNI ruthless.** Cada feature que proponga debe responder: "¿qué recomendación estratégica mejora/deja de fallar si esto existe?"

---

## 8. Propuesta de fases (alto nivel, a validar)

Sin entrar en diseño detallado, así se ve el camino de donde estamos al estado ideal:

- **Fase 0 — Capa de ingesta con integridad total y extensible**: La base del sistema. Diseñar y construir una capa de ingesta unificada que garantice integridad end-to-end para **todas las fuentes actuales** (Odoo, Gmail) y esté arquitectada para absorber **nuevas fuentes** (SAT, WhatsApp, bancos, competidores, APIs externas) sin reinventar plomería cada vez. Incluye: contratos de ingesta por fuente, observabilidad unificada (`sync_log` estructurado, `sync_failures`, SLAs por tabla), reconciliación automática, detección de pérdidas, constraints en DB, y staleness visible en `/system`. Sin esto, el consejo IA no puede existir con confiabilidad.
- **Fase 1 — Vistas analíticas para directores IA**: Materializar las agregaciones (cohortes, tendencias, segmentos) sobre las que razonan los directores IA. Sin esto los agentes queman tokens reprocesando y alucinan por contexto truncado.
- **Fase 2 — Consejo IA estratégico**: Rebautizar agentes como directores con preguntas estratégicas claras. Ciclo nocturno profundo. Superficie `/strategy`. Memoria persistente reforzada.
- **Fase 3 — Coordinación y canales**: Agent tickets para delegación entre directores. Meta Director IA para consolidar y resolver conflictos. Briefings WhatsApp. Budget enforcement de tokens.
- **Fase 4 — Event-driven y nuevas fuentes**: Wake-on-event (cancelación CFDI, pago rebotado). Primeras fuentes externas vivas sobre la capa de Fase 0 (SAT, WhatsApp).

Cada fase produce mejoras **observables por el usuario** sin requerir las siguientes. **Fase 0 es habilitante de todas las demás.**

---

## 9. Qué este documento **no** es

- No es un plan de implementación. No tiene tareas, archivos, ni líneas a cambiar.
- No decide tecnología (colas, triggers, cron — todo eso se define por fase).
- No fija fechas.
- No es inmutable. Es la estrella polar, no la ruta.

El siguiente paso tras aprobarlo es **decidir la Fase 0**: qué exactamente construir en las primeras 2 semanas para dejar de sangrar datos silenciosamente. Esa es una sesión de brainstorming separada con su propio spec.
