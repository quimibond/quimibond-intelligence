import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { verifySyntageSignature } from "@/lib/syntage/signature";
import { recordWebhookEvent, supabaseEventStore } from "@/lib/syntage/idempotency";
import { resolveEntity, supabaseEntityMapStore } from "@/lib/syntage/entity-resolver";
import { dispatchSyntageEvent, type DispatcherHandlers } from "@/lib/syntage/dispatcher";
import type { SyntageEvent } from "@/lib/syntage/types";

import { handleInvoiceEvent }            from "@/lib/syntage/handlers/invoice";
import { handleInvoiceLineItemEvent }    from "@/lib/syntage/handlers/invoice-line-item";
import { handleInvoicePaymentEvent }     from "@/lib/syntage/handlers/invoice-payment";
import { handleTaxRetentionEvent }       from "@/lib/syntage/handlers/tax-retention";
import { handleTaxReturnEvent }          from "@/lib/syntage/handlers/tax-return";
import { handleTaxStatusEvent }          from "@/lib/syntage/handlers/tax-status";
import { handleElectronicAccountingEvent } from "@/lib/syntage/handlers/electronic-accounting";
import {
  handleCredentialEvent,
  handleLinkEvent,
  handleExtractionEvent,
  handleFileCreatedEvent,
} from "@/lib/syntage/handlers/admin";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const HANDLERS: DispatcherHandlers = {
  invoice:              handleInvoiceEvent,
  invoiceLineItem:      handleInvoiceLineItemEvent,
  invoicePayment:       handleInvoicePaymentEvent,
  taxRetention:         handleTaxRetentionEvent,
  taxReturn:            handleTaxReturnEvent,
  taxStatus:            handleTaxStatusEvent,
  electronicAccounting: handleElectronicAccountingEvent,
  credential:           handleCredentialEvent,
  link:                 handleLinkEvent,
  extraction:           handleExtractionEvent,
  fileCreated:          handleFileCreatedEvent,
};

export async function POST(request: NextRequest) {
  const secret = process.env.SYNTAGE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "SYNTAGE_WEBHOOK_SECRET not set" }, { status: 503 });
  }

  const rawBody = await request.text();
  // Syntage (sat.ws legacy) uses X-Satws-Signature with Stripe-style `t=...,s=...` format.
  const signature = request.headers.get("x-satws-signature") ?? "";

  if (!verifySyntageSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const supabase = getServiceClient();

  let event: SyntageEvent;
  try {
    event = JSON.parse(rawBody) as SyntageEvent;
  } catch {
    await supabase.from("pipeline_logs").insert({
      level: "warning",
      phase: "syntage_webhook",
      message: "Invalid JSON in webhook body",
      details: { body_prefix: rawBody.slice(0, 1000) },
    });
    return NextResponse.json({ ok: true, skipped: "invalid_json" });
  }

  // Some Syntage event types (e.g. export.*) may omit taxpayer in the envelope.
  // Return 200 so Syntage doesn't retry forever, and log so we can inspect.
  if (!event?.id || !event?.type || !event?.taxpayer?.id) {
    await supabase.from("pipeline_logs").insert({
      level: "warning",
      phase: "syntage_webhook",
      message: `Malformed event (missing ${!event?.id ? "id" : !event?.type ? "type" : "taxpayer.id"})`,
      details: {
        event_id: event?.id ?? null,
        event_type: event?.type ?? null,
        taxpayer: event?.taxpayer ?? null,
        payload_prefix: rawBody.slice(0, 1500),
      },
    });
    return NextResponse.json({ ok: true, skipped: "malformed_event" });
  }

  const status = await recordWebhookEvent(
    supabaseEventStore(supabase),
    event.id,
    event.type,
    "webhook",
  );
  if (status === "duplicate") {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const entity = await resolveEntity(
    supabaseEntityMapStore(supabase),
    event.taxpayer.id,
  );
  if (!entity) {
    await supabase.from("pipeline_logs").insert({
      level: "warning",
      phase: "syntage_webhook",
      message: `Unmapped taxpayer RFC: ${event.taxpayer.id}`,
      details: { event_id: event.id, event_type: event.type, rfc: event.taxpayer.id },
    });
    return NextResponse.json({ ok: true, skipped: "unmapped_taxpayer" });
  }

  try {
    const result = await dispatchSyntageEvent(
      { supabase, odooCompanyId: entity.odooCompanyId, taxpayerRfc: event.taxpayer.id },
      event,
      HANDLERS,
    );

    if (result === "unhandled") {
      await supabase.from("pipeline_logs").insert({
        level: "info",
        phase: "syntage_webhook",
        message: `Unhandled event type: ${event.type}`,
        details: { event_id: event.id, event_type: event.type },
      });
    }

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const errorDetail = serializeError(err);
    console.error("[syntage/webhook] handler error:", err);
    await supabase.from("pipeline_logs").insert({
      level: "error",
      phase: "syntage_webhook",
      message: `Handler error: ${errorDetail.message}`,
      details: {
        event_id: event.id,
        event_type: event.type,
        error: errorDetail,
        payload_object: event.data?.object ?? null,
      },
    });
    return NextResponse.json({ error: errorDetail.message }, { status: 500 });
  }
}

function serializeError(err: unknown): {
  message: string;
  name?: string;
  code?: string;
  details?: string;
  hint?: string;
  stack?: string;
  raw?: unknown;
} {
  if (err instanceof Error) {
    const e = err as Error & { code?: string; details?: string; hint?: string };
    return {
      message: e.message,
      name: e.name,
      code: e.code,
      details: e.details,
      hint: e.hint,
      stack: e.stack?.split("\n").slice(0, 5).join("\n"),
    };
  }
  if (err && typeof err === "object") {
    const e = err as {
      message?: unknown;
      code?: unknown;
      details?: unknown;
      hint?: unknown;
    };
    return {
      message: typeof e.message === "string" ? e.message : JSON.stringify(err),
      code: typeof e.code === "string" ? e.code : undefined,
      details: typeof e.details === "string" ? e.details : undefined,
      hint: typeof e.hint === "string" ? e.hint : undefined,
      raw: err,
    };
  }
  return { message: String(err) };
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "/api/syntage/webhook",
    method: "POST",
    auth: "X-Syntage-Signature HMAC-SHA256",
  });
}
