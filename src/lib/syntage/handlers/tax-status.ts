import type { HandlerCtx, SyntageEvent } from "@/lib/syntage/types";

/**
 * Handles tax_status.* events.
 *
 * NOTE: Syntage's `TaxStatus` is the **Constancia de Situación Fiscal** (fiscal
 * profile PDF with address, regimes, obligations), NOT the "Opinión de
 * Cumplimiento" (that's a separate `TaxComplianceCheck` resource with its own
 * events). Our column name `opinion_cumplimiento` is preserved for frontend
 * compatibility but populated from the top-level `status` field ("Activo",
 * "Suspendido", etc.) — it does NOT mean positive/negative opinion here.
 *
 * Syntage's real TaxStatus schema per OpenAPI:
 *   { id, file, rfc, cif, person, company{legalName,tradeName,entityType},
 *     email, phone, address, economicActivities[], taxRegimes[], obligations[],
 *     startedOperationsAt, status, statusUpdatedAt, createdAt, updatedAt }
 */
export async function handleTaxStatusEvent(ctx: HandlerCtx, event: SyntageEvent): Promise<void> {
  const obj = event.data.object as Record<string, unknown>;

  const row: Record<string, unknown> = {
    syntage_id:               obj.id ?? obj["@id"],
    taxpayer_rfc:             ctx.taxpayerRfc,
    odoo_company_id:          ctx.odooCompanyId,
    target_rfc:               (obj.rfc as string | undefined) ?? ctx.taxpayerRfc,
    fecha_consulta:           obj.statusUpdatedAt ?? obj.updatedAt ?? new Date().toISOString(),
    opinion_cumplimiento:     normalizeTaxStatus(obj.status),
    regimen_fiscal:           firstTaxRegimeName(obj.taxRegimes),
    domicilio_fiscal:         obj.address ?? null,
    actividades_economicas:   obj.economicActivities ?? null,
    raw_payload:              obj,
    synced_at:                new Date().toISOString(),
  };

  if (!row.syntage_id || !row.target_rfc) {
    throw new Error(
      `tax_status event missing id/rfc (id=${String(row.syntage_id)}, rfc=${String(obj.rfc)})`,
    );
  }

  const { error } = await ctx.supabase
    .from("syntage_tax_status") // SP5-EXCEPTION: SAT source-layer writer — syntage_tax_status is the canonical Bronze intake for SAT taxpayer status records.
    .upsert(row, { onConflict: "syntage_id" });
  if (error) throw error;
}

function normalizeTaxStatus(v: unknown): "positiva" | "negativa" | "sin_opinion" {
  const s = String(v ?? "").toLowerCase();
  if (s === "activo") return "positiva";
  if (s === "suspendido" || s === "cancelado") return "negativa";
  return "sin_opinion";
}

function firstTaxRegimeName(regimes: unknown): string | null {
  if (!Array.isArray(regimes) || regimes.length === 0) return null;
  const first = regimes[0] as { name?: string; code?: number } | undefined;
  if (first?.name) return first.name;
  if (first?.code != null) return String(first.code);
  return null;
}
