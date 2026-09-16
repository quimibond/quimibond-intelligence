/**
 * syntage-webhook (Edge Function) — receptor de webhooks de Syntage (SAT).
 * Reemplaza a /api/syntage/webhook de Vercel. Misma lógica:
 *   1. Verifica la firma HMAC (X-Satws-Signature) con syntage_webhook_secret.
 *   2. Ignora en silencio RFCs no mapeados en syntage_entity_map.
 *   3. Idempotencia por event.id en syntage_webhook_events.
 *   4. Despacha al handler por event.type (misma librería que Vercel, copiada
 *      a _shared/syntage/).
 *
 * URL a configurar en Syntage:
 *   https://tozqezmivpblmcubmnpi.supabase.co/functions/v1/syntage-webhook
 * Desplegada con verify_jwt=false: la autenticación es la firma del webhook.
 */
import { serviceClient, json, loadSecret } from "../_shared/env.ts";
import { verifySyntageSignature } from "../_shared/syntage/signature.ts";
import { recordWebhookEvent, supabaseEventStore } from "../_shared/syntage/idempotency.ts";
import { resolveEntity, supabaseEntityMapStore } from "../_shared/syntage/entity-resolver.ts";
import { dispatchSyntageEvent, type DispatcherHandlers } from "../_shared/syntage/dispatcher.ts";
import type { SyntageEvent } from "../_shared/syntage/types.ts";
import { handleInvoiceEvent } from "../_shared/syntage/handlers/invoice.ts";
import { handleInvoiceLineItemEvent } from "../_shared/syntage/handlers/invoice-line-item.ts";
import { handleInvoicePaymentEvent } from "../_shared/syntage/handlers/invoice-payment.ts";
import { handleTaxRetentionEvent } from "../_shared/syntage/handlers/tax-retention.ts";
import { handleTaxReturnEvent } from "../_shared/syntage/handlers/tax-return.ts";
import { handleTaxStatusEvent } from "../_shared/syntage/handlers/tax-status.ts";
import { handleElectronicAccountingEvent } from "../_shared/syntage/handlers/electronic-accounting.ts";
import { handleCredentialEvent, handleLinkEvent, handleExtractionEvent, handleFileCreatedEvent } from "../_shared/syntage/handlers/admin.ts";

const HANDLERS: DispatcherHandlers = {
  invoice: handleInvoiceEvent,
  invoiceLineItem: handleInvoiceLineItemEvent,
  invoicePayment: handleInvoicePaymentEvent,
  taxRetention: handleTaxRetentionEvent,
  taxReturn: handleTaxReturnEvent,
  taxStatus: handleTaxStatusEvent,
  electronicAccounting: handleElectronicAccountingEvent,
  credential: handleCredentialEvent,
  link: handleLinkEvent,
  extraction: handleExtractionEvent,
  fileCreated: handleFileCreatedEvent,
};

function serializeError(err: unknown): { message: string; name?: string; code?: string; details?: string; hint?: string; stack?: string } {
  if (err instanceof Error) {
    const e = err as Error & { code?: string; details?: string; hint?: string };
    let message = e.message;
    if (!message || message === "[object Object]" || message === "undefined") {
      let rawJson = "";
      try {
        rawJson = JSON.stringify(err, Object.getOwnPropertyNames(err)).slice(0, 500);
      } catch {
        rawJson = String(err);
      }
      message = `${e.name || "Error"} (raw: ${rawJson})`;
    }
    return { message, name: e.name, code: e.code, details: e.details, hint: e.hint, stack: e.stack?.split("\n").slice(0, 5).join("\n") };
  }
  if (err && typeof err === "object") {
    const e = err as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    return {
      message: typeof e.message === "string" ? e.message : JSON.stringify(err),
      code: typeof e.code === "string" ? e.code : undefined,
      details: typeof e.details === "string" ? e.details : undefined,
      hint: typeof e.hint === "string" ? e.hint : undefined,
    };
  }
  return { message: String(err) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    return json({ ok: true, endpoint: "syntage-webhook", method: "POST", auth: "X-Satws-Signature HMAC-SHA256" });
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supabase = serviceClient();
  const secret = await loadSecret(supabase, "SYNTAGE_WEBHOOK_SECRET", "syntage_webhook_secret");
  if (!secret) return json({ error: "syntage_webhook_secret no configurado" }, 503);

  const rawBody = await req.text();
  const signature = req.headers.get("x-satws-signature") ?? req.headers.get("x-syntage-signature") ?? "";
  if (!(await verifySyntageSignature(rawBody, signature, secret))) {
    return json({ error: "Invalid signature" }, 401);
  }

  let event: SyntageEvent;
  try {
    event = JSON.parse(rawBody) as SyntageEvent;
  } catch {
    await supabase.from("pipeline_logs").insert({
      level: "warning",
      phase: "syntage_webhook",
      message: "Invalid JSON in webhook body",
      details: { body_prefix: rawBody.slice(0, 1000), runtime: "edge" },
    });
    return json({ ok: true, skipped: "invalid_json" });
  }

  if (!event?.id || !event?.type || !event?.taxpayer?.id) {
    await supabase.from("pipeline_logs").insert({
      level: "warning",
      phase: "syntage_webhook",
      message: `Malformed event (missing ${!event?.id ? "id" : !event?.type ? "type" : "taxpayer.id"})`,
      details: { event_id: event?.id ?? null, event_type: event?.type ?? null, taxpayer: event?.taxpayer ?? null, payload_prefix: rawBody.slice(0, 1500), runtime: "edge" },
    });
    return json({ ok: true, skipped: "malformed_event" });
  }

  // RFCs no mapeados (o inactivos): silencio total, igual que en Vercel.
  const entity = await resolveEntity(supabaseEntityMapStore(supabase), event.taxpayer.id);
  if (!entity) return json({ ok: true, skipped: "unmapped_taxpayer" });

  const status = await recordWebhookEvent(supabaseEventStore(supabase), event.id, event.type, "webhook");
  if (status === "duplicate") return json({ ok: true, duplicate: true });

  try {
    const result = await dispatchSyntageEvent({ supabase, odooCompanyId: entity.odooCompanyId, taxpayerRfc: event.taxpayer.id }, event, HANDLERS);
    if (result === "unhandled") {
      await supabase.from("pipeline_logs").insert({
        level: "info",
        phase: "syntage_webhook",
        message: `Unhandled event type: ${event.type}`,
        details: { event_id: event.id, event_type: event.type, taxpayer: event.taxpayer ?? null, payload_object: event.data?.object ?? null, payload_changes: event.data?.changes ?? null, runtime: "edge" },
      });
    }
    return json({ ok: true, result });
  } catch (err) {
    const errorDetail = serializeError(err);
    console.error("[syntage-webhook] handler error:", errorDetail.message);
    await supabase.from("pipeline_logs").insert({
      level: "error",
      phase: "syntage_webhook",
      message: `Handler error: ${errorDetail.message}`,
      details: { event_id: event.id, event_type: event.type, error: errorDetail, payload_object: event.data?.object ?? null, runtime: "edge" },
    });
    return json({ error: errorDetail.message }, 500);
  }
});
