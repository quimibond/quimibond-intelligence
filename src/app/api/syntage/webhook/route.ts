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

  let event: SyntageEvent;
  try {
    event = JSON.parse(rawBody) as SyntageEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!event?.id || !event?.type || !event?.taxpayer?.id) {
    return NextResponse.json({ error: "Malformed event" }, { status: 400 });
  }

  const supabase = getServiceClient();

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
    const message = err instanceof Error ? err.message : String(err);
    console.error("[syntage/webhook] handler error:", err);
    await supabase.from("pipeline_logs").insert({
      level: "error",
      phase: "syntage_webhook",
      message: `Handler error: ${message}`,
      details: { event_id: event.id, event_type: event.type },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "/api/syntage/webhook",
    method: "POST",
    auth: "X-Syntage-Signature HMAC-SHA256",
  });
}
