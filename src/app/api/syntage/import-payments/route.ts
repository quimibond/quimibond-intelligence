import { NextRequest, NextResponse } from "next/server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";
import { getServiceClient } from "@/lib/supabase-server";
import { resolveEntity, supabaseEntityMapStore } from "@/lib/syntage/entity-resolver";
import { mapInvoicePayment } from "@/lib/syntage/mappers";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Admin bulk-import de payments desde el CSV export de Syntage.
 *
 * Syntage API /invoices/payments está roto para deep cursor pagination
 * (500s on ~call 2-3, rate-limits rápido). El CSV export del dashboard
 * trae los 25k+ payments completos. Este endpoint los recibe en chunks
 * JSON, los mapea con el mismo mapper que el webhook + pull-sync, y los
 * upsertea idempotente.
 *
 * Request body:
 *   {
 *     taxpayer: "PNT920218IW5",
 *     payments: [
 *       { id, date, paymentMethod, invoiceUuid, currency, exchangeRate,
 *         installment, previousBalance, amount, outstandingBalance,
 *         canceledAt, createdAt, updatedAt },
 *       ...
 *     ]
 *   }
 *
 * Response:
 *   { ok, items_received, items_upserted, items_errored, errors: [] }
 */
export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  let body: { taxpayer?: string; payments?: Array<Record<string, unknown>> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const taxpayerRfc = body.taxpayer ?? "PNT920218IW5";
  const payments = body.payments ?? [];
  if (!Array.isArray(payments) || payments.length === 0) {
    return NextResponse.json({ ok: false, error: "payments array required" }, { status: 400 });
  }

  const supabase = getServiceClient();
  const entity = await resolveEntity(supabaseEntityMapStore(supabase), taxpayerRfc);
  if (!entity) {
    return NextResponse.json({ ok: false, error: `taxpayer ${taxpayerRfc} not in syntage_entity_map` }, { status: 400 });
  }

  const ctx = { taxpayerRfc, odooCompanyId: entity.odooCompanyId };
  const rows: Array<Record<string, unknown>> = [];
  const errors: Array<{ id: string; message: string }> = [];

  for (const p of payments) {
    try {
      // CSV amount/exchangeRate/installment come as strings; cast to numbers
      const normalized = {
        ...p,
        amount: parseNumOrNull(p.amount),
        exchangeRate: parseNumOrNull(p.exchangeRate),
        installment: parseNumOrNull(p.installment),
        previousBalance: parseNumOrNull(p.previousBalance),
        outstandingBalance: parseNumOrNull(p.outstandingBalance),
        canceledAt: (p.canceledAt === "" || p.canceledAt == null) ? null : p.canceledAt,
      };
      rows.push(mapInvoicePayment(normalized, ctx));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ id: String(p.id ?? "(unknown)"), message: msg });
    }
  }

  let upserted = 0;
  if (rows.length > 0) {
    const { error: upsertErr } = await supabase
      .from("syntage_invoice_payments") // SP5-EXCEPTION: SAT source-layer writer — syntage_invoice_payments is the canonical Bronze intake for SAT payment complements (bulk import path). TODO SP6: pipe through canonical_payment_allocations.
      .upsert(rows, { onConflict: "syntage_id" });
    if (upsertErr) {
      // Per-row fallback
      for (const r of rows) {
        const { error: one } = await supabase
          .from("syntage_invoice_payments") // SP5-EXCEPTION: SAT source-layer writer — per-row fallback path.
          .upsert(r, { onConflict: "syntage_id" });
        if (one) {
          errors.push({ id: String(r.syntage_id), message: one.message });
        } else {
          upserted++;
        }
      }
    } else {
      upserted = rows.length;
    }
  }

  return NextResponse.json({
    ok: true,
    items_received: payments.length,
    items_upserted: upserted,
    items_errored: errors.length,
    errors: errors.slice(0, 20),
  });
}

function parseNumOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
