# Plan: Quimibond Intelligence → Paperclip-style Autonomous Agent System

## Objetivo
Convertir el sistema actual (7 directores que generan insights en paralelo sin coordinarse) en un sistema tipo Paperclip donde los agentes se coordinan, delegan, despiertan por eventos, y el CEO recibe un resumen ejecutivo inteligente — no una lista de items.

## Arquitectura actual vs propuesta

```
ACTUAL:                              PROPUESTO:
Cron 30min → orchestrate             Event Bus → wake agent específico
  → pick 1 agent                       → agent lee su checklist
  → load context                       → revisa tickets pendientes
  → call Claude                        → delega a otro si no es su tema
  → save insights                      → genera insight O ticket
  → routing por categoría              → routing por salesperson/buyer real
                                       → WhatsApp inmediato si critical
CEO ve lista de 18 insights          CEO recibe resumen ejecutivo 1 párrafo
```

## Fases de implementación

---

### FASE 1: Tickets entre directores (elimina duplicados de raíz)
**Esfuerzo: 2-3 horas | Impacto: Alto**

**Problema:** Director Riesgo y Director Financiero ambos reportan "CONTITECH $399K vencido". Son duplicados porque no se hablan.

**Solución:** Antes de generar un insight, cada agente ve "QUE DICEN OTROS DIRECTORES" (ya existe parcialmente en cross_director_signals). Cambiar esto para que en vez de generar un insight duplicado, el agente pueda "delegar" o "enriquecer" el insight existente.

**Implementación:**

1. **Nueva tabla `agent_tickets`** en Supabase:
```sql
CREATE TABLE agent_tickets (
  id bigserial PRIMARY KEY,
  from_agent_id bigint REFERENCES ai_agents(id),
  to_agent_id bigint REFERENCES ai_agents(id),
  insight_id bigint REFERENCES agent_insights(id),
  ticket_type text CHECK (ticket_type IN ('delegate', 'enrich', 'verify', 'escalate')),
  message text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'read', 'acted', 'dismissed')),
  created_at timestamptz DEFAULT now()
);
```

2. **Modificar orchestrate**: cuando el agente detecta que ya existe un insight sobre el mismo tema (via extractTheme), en vez de generar uno nuevo, crea un ticket de tipo "enrich" con contexto adicional que solo ese agente tiene.

3. **Modificar prompt**: agregar instrucción:
```
Si otro director ya reportó este problema, NO generes un insight nuevo.
En su lugar, responde con: {"delegate_to": "slug_director", "enrich_insight_id": 123, "additional_context": "..."}
```

4. **El agente que recibe el ticket** lo ve en su próximo heartbeat y decide si actualizar su insight con el contexto nuevo.

**Archivos a modificar:**
- `supabase/migrations/032_agent_tickets.sql` (nueva tabla)
- `src/app/api/agents/orchestrate/route.ts` (lógica de delegación)

---

### FASE 2: Resumen ejecutivo matutino (reemplaza lista de insights)
**Esfuerzo: 1-2 horas | Impacto: Alto**

**Problema:** El CEO recibe 18 insights individuales. Nadie lee 18 cosas a las 7am.

**Solución:** El WhatsApp digest deja de ser una lista y se convierte en un resumen ejecutivo de 1 párrafo escrito por Claude, priorizando las 3 cosas más urgentes.

**Implementación:**

1. **Modificar `/api/notifications/whatsapp/route.ts`**:
   - Cargar los top 5 insights critical/high
   - Cargar cashflow summary, anomalías contables, entregas atrasadas
   - Llamar a Claude con un prompt tipo "Eres el asistente ejecutivo del CEO. Resume en 1 párrafo las 3 cosas más urgentes de hoy. Sé directo, usa montos, nombres y acciones."
   - Enviar el párrafo por WhatsApp en vez de la lista

2. **Formato de salida:**
```
Buenos días Jose. Hoy tienes 3 urgentes:

1. Contitech no pagó $399K (51 días) — Sandra Dávila debe llamar hoy
2. 15 entregas atrasadas desde enero — Dario necesita confirmar fechas
3. Siniestro 112-4383 sin respuesta 5 días — riesgo legal, responde hoy

Tu cartera está en $22.9M (88% cobrable). 4 anomalías contables pendientes.

👉 [inbox link]
```

**Archivos a modificar:**
- `src/app/api/notifications/whatsapp/route.ts` (rewrite con Claude summary)

---

### FASE 3: Wake por evento (no solo cron)
**Esfuerzo: 2-3 horas | Impacto: Medio-Alto**

**Problema:** Cuando Odoo sincroniza una factura pagada, el sistema espera 30 min para que el orchestrate la detecte. Una cancelación de CFDI necesita acción inmediata.

**Solución:** Supabase triggers que detectan eventos críticos y despiertan al agente correcto.

**Implementación:**

1. **Trigger en `odoo_invoices`** (AFTER INSERT/UPDATE):
   - Si `cfdi_sat_state` cambia a 'cancelled' → insertar alerta inmediata
   - Si `payment_state` cambia a 'paid' y había insight de cobranza → auto-resolver insight
   - Si nueva factura con `days_overdue > 60` → insertar insight directo sin esperar agente

2. **Trigger en `emails`** (AFTER INSERT):
   - Si email de empresa con insight critical activo → agregar nota al insight
   - Si email sin respuesta >72h de cliente strategic → crear alerta

3. **Endpoint `/api/agents/wake`** (POST):
   - Recibe `{ agent_slug, reason, context }` 
   - Ejecuta ese agente específico inmediatamente
   - Puede ser llamado por triggers via webhook o por Supabase Edge Function

**Archivos a crear/modificar:**
- `supabase/migrations/033_event_triggers.sql` (triggers)
- `src/app/api/agents/wake/route.ts` (nuevo endpoint)

---

### FASE 4: Budget por agente
**Esfuerzo: 1 hora | Impacto: Medio**

**Problema:** Si un agente genera contextos enormes o entra en loop, gasta tokens sin límite. Hoy el analyze-batch consume 11.6M tokens/semana.

**Solución:** Cada agente tiene un budget mensual. El orchestrate checkea antes de correr.

**Implementación:**

1. **Agregar columna `monthly_budget_tokens` a `ai_agents`** (default 500K)

2. **En orchestrate**, antes de correr un agente:
```typescript
const usage = await supabase.from("token_usage")
  .select("input_tokens, output_tokens")
  .eq("endpoint", `agent-${agent.slug}`)
  .gte("created_at", startOfMonth);
const totalUsed = sum(input + output);
if (totalUsed > agent.monthly_budget_tokens) {
  // Skip agent, log warning
  continue;
}
```

3. **Dashboard en `/agents`**: mostrar barra de progreso budget usado/disponible.

**Archivos a modificar:**
- `src/app/api/agents/orchestrate/route.ts` (budget check)
- `src/app/agents/page.tsx` (UI budget bar)
- Supabase: `ALTER TABLE ai_agents ADD COLUMN monthly_budget_tokens int DEFAULT 500000`

---

### FASE 5: Feedback loop inmediato (agente se entera del CEO)
**Esfuerzo: 1-2 horas | Impacto: Medio**

**Problema:** El CEO marca "útil" o "descarta" pero el agente no se entera hasta que el learn pipeline corre (cada 4h). El agente sigue generando lo mismo.

**Solución:** Cuando el CEO actúa en un insight, el agente lo ve en su próximo heartbeat (30 min max).

**Implementación:**

1. **En el orchestrate context loading**, agregar sección "FEEDBACK RECIENTE":
```
## FEEDBACK DEL CEO (últimas 24h)
- ✅ "CONTITECH $399K vencido" → CEO actuó (útil)
- ❌ "Elena Delgado 3,519 actividades" → CEO descartó
- ❌ "WJ042Q22JNT160 margen -900%" → CEO descartó (error de unidades)
```

2. **El agente lee este feedback** como parte de su contexto y ajusta. Si el CEO descartó algo, no lo repite.

3. **Esto reemplaza parcialmente el learn pipeline** — el feedback es inmediato, no necesita esperar 4h para generar memorias.

**Archivos a modificar:**
- `src/app/api/agents/orchestrate/route.ts` (cargar feedback reciente en contexto)

---

### FASE 6: Proactive notifications (WhatsApp por evento)
**Esfuerzo: 1-2 horas | Impacto: Alto**

**Problema:** El WhatsApp solo llega a las 7am. Si a las 3pm cancelan un CFDI de $500K, el CEO no se entera hasta mañana.

**Solución:** Notificaciones push inmediatas para eventos críticos.

**Implementación:**

1. **Nuevo endpoint `/api/notifications/alert`**:
   - Recibe un insight con severity "critical"
   - Si no se ha enviado notificación sobre este insight → enviar WhatsApp inmediato
   - Formato corto: "🔴 [título]. Acción: [recomendación]. 👉 [link]"
   - Max 3 alertas por día (anti-spam)

2. **Trigger en orchestrate**: cuando se guarda un insight critical → llamar al endpoint de alert.

3. **Trigger en accounting_anomalies**: cuando se detecta CFDI cancelado o crédito excedido → alerta inmediata.

**Archivos a crear/modificar:**
- `src/app/api/notifications/alert/route.ts` (nuevo)
- `src/app/api/agents/orchestrate/route.ts` (trigger post-save)

---

## Orden de ejecución recomendado

| # | Fase | Tiempo | Impacto | Dependencias |
|---|------|--------|---------|-------------|
| 1 | Resumen ejecutivo WhatsApp | 1-2h | Alto | Ninguna |
| 2 | Feedback loop inmediato | 1-2h | Alto | Ninguna |
| 3 | Tickets entre directores | 2-3h | Alto | Ninguna |
| 4 | Budget por agente | 1h | Medio | Ninguna |
| 5 | Wake por evento | 2-3h | Medio-Alto | Fase 6 |
| 6 | Alertas WhatsApp inmediatas | 1-2h | Alto | WhatsApp configurado |

**Total estimado: 8-13 horas de implementación.**

Las fases 1, 2, 3 y 4 son independientes y se pueden hacer en paralelo.
La fase 5 requiere la 6 para las alertas, pero el trigger en la DB puede funcionar sin WhatsApp.

## Resultado final

El CEO llega en la mañana, recibe UN mensaje de WhatsApp con las 3 cosas más urgentes. Si algo crítico pasa durante el día, recibe otra alerta inmediata. Los directores se coordinan entre sí sin duplicar trabajo. Cada agente tiene presupuesto y no puede desbordarse. El feedback del CEO es inmediato — si descarta algo, el agente lo sabe en 30 min.

Esto convierte a Quimibond Intelligence de "dashboard con lista de insights" a "asistente ejecutivo autónomo que opera como un equipo de directores coordinados".
