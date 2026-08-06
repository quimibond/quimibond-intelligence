/**
 * Herramientas del analista (/api/chat agéntico, 2026-08-06).
 *
 * Cada tool es una capacidad de lectura sobre los datos reales:
 * SQL curado (analyst_query, read-only con timeout), búsqueda semántica de
 * correos, lectura de hilos completos, ficha de cliente, costos de producto
 * y pendientes de comunicación. El modelo las combina para responder
 * preguntas que cruzan dominios (correo ↔ ventas ↔ costos ↔ cartera).
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getVoyageEmbedding } from "@/lib/claude";

// ── Definiciones (formato Anthropic tools) ─────────────────────────────────

export const ANALYST_TOOLS = [
  {
    name: "consultar_sql",
    description:
      "Ejecuta una consulta SQL de SOLO LECTURA (SELECT/WITH) sobre la base de datos de Quimibond. Usa las tablas documentadas en el prompt de sistema. Siempre incluye LIMIT (máx 50 filas útiles). Ideal para cifras, rankings, agregados y cruces.",
    input_schema: {
      type: "object" as const,
      properties: {
        sql: { type: "string", description: "La consulta SELECT (PostgreSQL). Una sola sentencia." },
        proposito: { type: "string", description: "Qué pregunta responde esta consulta (para el log)" },
      },
      required: ["sql", "proposito"],
    },
  },
  {
    name: "buscar_correos",
    description:
      "Búsqueda semántica en los ~217k emails de la empresa (todas las cuentas del equipo). Devuelve los correos más relevantes con id, fecha, remitente, asunto y snippet. Usa leer_hilo con el id para ver la conversación completa.",
    input_schema: {
      type: "object" as const,
      properties: {
        consulta: { type: "string", description: "Qué buscar (tema, cliente, producto, etc.)" },
        limite: { type: "number", description: "Máx resultados (default 8)" },
      },
      required: ["consulta"],
    },
  },
  {
    name: "leer_hilo",
    description:
      "Lee la conversación completa (hasta 12 mensajes más recientes) del hilo al que pertenece un email. Pasa el email_id devuelto por buscar_correos o consultar_sql.",
    input_schema: {
      type: "object" as const,
      properties: {
        email_id: { type: "number", description: "id de un email del hilo" },
      },
      required: ["email_id"],
    },
  },
  {
    name: "ficha_cliente",
    description:
      "Ficha 360 de un cliente: datos, cartera abierta (facturas vencidas), pedidos recientes, riesgo de recompra y comunicación reciente. Búsqueda por nombre (parcial).",
    input_schema: {
      type: "object" as const,
      properties: {
        nombre: { type: "string", description: "Nombre (o parte) del cliente" },
      },
      required: ["nombre"],
    },
  },
  {
    name: "costo_producto",
    description:
      "Costos y márgenes por producto del catálogo (~2,900 SKUs): MP, costo variable, costo absorbido, precio de referencia, contribución. Búsqueda por referencia interna o nombre.",
    input_schema: {
      type: "object" as const,
      properties: {
        busqueda: { type: "string", description: "Referencia interna (ej. WD038) o parte del nombre" },
      },
      required: ["busqueda"],
    },
  },
  {
    name: "pendientes_comunicacion",
    description:
      "Hilos de clientes reales esperando respuesta nuestra (+24h) y clientes históricamente activos que llevan +21 días sin escribir.",
    input_schema: { type: "object" as const, properties: {} },
  },
];

// ── Ejecutores ─────────────────────────────────────────────────────────────

function clip(obj: unknown, maxChars = 14000): string {
  const s = JSON.stringify(obj);
  return s.length > maxChars ? s.slice(0, maxChars) + `…[truncado, ${s.length} chars]` : s;
}

export async function executeTool(
  supabase: SupabaseClient,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case "consultar_sql": {
        const { data, error } = await supabase.rpc("analyst_query", {
          p_sql: String(input.sql ?? ""),
        });
        if (error) return JSON.stringify({ error: error.message });
        return clip(data);
      }

      case "buscar_correos": {
        const consulta = String(input.consulta ?? "");
        const limite = Math.min(Number(input.limite ?? 8), 15);
        const embedding = await getVoyageEmbedding(consulta);
        if (!embedding) return JSON.stringify({ error: "No se pudo generar el embedding" });
        const { data, error } = await supabase.rpc("search_similar_emails", {
          query_embedding: JSON.stringify(embedding),
          match_threshold: 0.45,
          match_count: limite,
        });
        if (error) return JSON.stringify({ error: error.message });
        return clip(data);
      }

      case "leer_hilo": {
        const emailId = Number(input.email_id);
        const { data: email } = await supabase
          .from("emails")
          .select("thread_id, gmail_thread_id")
          .eq("id", emailId)
          .maybeSingle();
        if (!email?.thread_id && !email?.gmail_thread_id) {
          return JSON.stringify({ error: `Email ${emailId} sin hilo` });
        }
        const query = supabase
          .from("emails")
          .select("id, email_date, sender, sender_type, subject, body, snippet")
          .order("email_date", { ascending: false })
          .limit(12);
        const { data: msgs, error } = email.thread_id
          ? await query.eq("thread_id", email.thread_id)
          : await query.eq("gmail_thread_id", email.gmail_thread_id);
        if (error) return JSON.stringify({ error: error.message });
        const compact = (msgs ?? []).reverse().map((m) => ({
          id: m.id,
          fecha: m.email_date,
          de: m.sender,
          tipo: m.sender_type,
          asunto: m.subject,
          cuerpo: String(m.body ?? m.snippet ?? "").replace(/\s+/g, " ").slice(0, 1200),
        }));
        return clip(compact, 16000);
      }

      case "ficha_cliente": {
        const nombre = String(input.nombre ?? "");
        const { data: matches } = await supabase
          .from("companies")
          .select("id, name, rfc, domain, is_customer, is_supplier, lifetime_value, odoo_partner_id")
          .ilike("name", `%${nombre}%`)
          .order("lifetime_value", { ascending: false, nullsFirst: false })
          .limit(3);
        if (!matches?.length) return JSON.stringify({ error: `Sin resultados para "${nombre}"` });
        const c = matches[0];

        const [ar, orders, reorder, hilos] = await Promise.all([
          supabase
            .from("ar_aging_detail")
            .select("invoice_name, invoice_date, due_date, amount_residual, days_overdue, aging_bucket")
            .eq("company_id", c.id)
            .order("amount_residual", { ascending: false })
            .limit(10),
          supabase
            .from("odoo_sale_orders")
            .select("name, date_order, amount_total, state, salesperson_name")
            .eq("company_id", c.id)
            .order("date_order", { ascending: false })
            .limit(8),
          supabase
            .from("client_reorder_predictions")
            .select("reorder_status, days_since_last, days_overdue_reorder, avg_order_value, avg_cycle_days, salesperson_name")
            .eq("company_id", c.id)
            .maybeSingle(),
          supabase
            .from("threads")
            .select("id, subject, last_sender_type, last_activity, status, message_count")
            .eq("company_id", c.id)
            .order("last_activity", { ascending: false })
            .limit(6),
        ]);

        return clip({
          cliente: c,
          otras_coincidencias: matches.slice(1).map((m) => m.name),
          cartera_abierta: ar.data ?? [],
          pedidos_recientes: orders.data ?? [],
          riesgo_recompra: reorder.data ?? null,
          hilos_recientes: hilos.data ?? [],
        });
      }

      case "costo_producto": {
        const b = String(input.busqueda ?? "");
        const { data, error } = await supabase
          .from("product_cost_catalog")
          .select(
            "internal_ref, name, uom, kg_per_unit, mp_unit_mxn, costo_variable_unit_mxn, costo_total_absorbido_unit_mxn, precio_ref_mxn, contribucion_unit_mxn, cm_pct, margen_absorbido_pct, familia",
          )
          .or(`internal_ref.ilike.%${b}%,name.ilike.%${b}%`)
          .order("precio_ref_mxn", { ascending: false, nullsFirst: false })
          .limit(12);
        if (error) return JSON.stringify({ error: error.message });
        return clip(data);
      }

      case "pendientes_comunicacion": {
        const [hilos, callados] = await Promise.all([
          supabase.rpc("get_unanswered_client_threads", { p_min_hours: 24, p_limit: 12 }),
          supabase.rpc("get_silent_customers", { p_silent_days: 21, p_min_emails_90d: 5, p_limit: 10 }),
        ]);
        return clip({
          hilos_sin_respuesta: hilos.data ?? [],
          clientes_callados: callados.data ?? [],
        });
      }

      default:
        return JSON.stringify({ error: `Tool desconocida: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }
}
