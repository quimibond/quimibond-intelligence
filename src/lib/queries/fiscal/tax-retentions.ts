import { getServiceClient } from "@/lib/supabase-server";

/**
 * Raw row from syntage_tax_retentions.
 * Key schema facts:
 * - PK is `syntage_id` (text UUID from Syntage)
 * - `uuid` = UUID SAT del CFDI de retención
 * - `fecha_emision` = date of issuance (NOT `issued_at`)
 * - `monto_total_retenido` = total retained amount (ISR+IVA sum)
 * - `monto_total_operacion` = total operation amount (base)
 * - `impuestos_retenidos` = JSONB array with per-tax breakdown
 *   - taxType "001" = ISR, "002" = IVA
 * - No `currency` column — all domestic MXN
 */
export interface TaxRetentionRow {
  syntage_id: string;
  uuid: string;
  direction: string | null;           // "received" | "issued"
  fecha_emision: string | null;
  emisor_rfc: string | null;
  emisor_nombre: string | null;
  receptor_rfc: string | null;
  receptor_nombre: string | null;
  tipo_retencion: string | null;      // SAT retention code (e.g. "16" = INTERESES)
  monto_total_operacion: number | null;
  monto_total_gravado: number | null;
  monto_total_retenido: number | null;
  impuestos_retenidos: Array<{
    taxType: string;          // "001" = ISR, "002" = IVA
    retainedAmount: number;
    baseAmount: number;
    paymentType: string;
  }> | null;
  estado_sat: string | null;
}

/**
 * Latest SAT retention CFDIs (received or issued by Quimibond).
 */
export async function getRecentTaxRetentions(limit = 50): Promise<TaxRetentionRow[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("syntage_tax_retentions") // SP5-EXCEPTION: SAT source-layer reader — syntage_tax_retentions is the canonical Bronze source for SAT retention CFDIs. TODO SP6: promote to canonical_tax_events.
    .select(
      "syntage_id, uuid, direction, fecha_emision, emisor_rfc, emisor_nombre, " +
      "receptor_rfc, receptor_nombre, tipo_retencion, monto_total_operacion, " +
      "monto_total_gravado, monto_total_retenido, impuestos_retenidos, estado_sat",
    )
    .order("fecha_emision", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`tax_retentions query failed: ${error.message}`);
  return (data ?? []) as unknown as TaxRetentionRow[];
}

export interface TaxRetentionAggregate {
  period: string;       // "YYYY-MM"
  count: number;
  total_isr: number;    // sum of taxType "001" retainedAmount
  total_iva: number;    // sum of taxType "002" retainedAmount
  total_retenido: number;
  total_operacion: number;
}

/**
 * Aggregate by YYYY-MM period for trend visualization.
 * ISR/IVA extracted from the impuestos_retenidos JSONB array.
 */
export async function getTaxRetentionsByPeriod(months = 12): Promise<TaxRetentionAggregate[]> {
  const rows = await getRecentTaxRetentions(500);
  const byPeriod = new Map<string, TaxRetentionAggregate>();

  for (const r of rows) {
    if (!r.fecha_emision) continue;
    const d = new Date(r.fecha_emision);
    const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const existing = byPeriod.get(period) ?? {
      period,
      count: 0,
      total_isr: 0,
      total_iva: 0,
      total_retenido: 0,
      total_operacion: 0,
    };

    existing.count += 1;
    existing.total_retenido += Number(r.monto_total_retenido ?? 0);
    existing.total_operacion += Number(r.monto_total_operacion ?? 0);

    // Break down ISR vs IVA from JSONB
    for (const imp of r.impuestos_retenidos ?? []) {
      const amount = Number(imp.retainedAmount ?? 0);
      if (imp.taxType === "001") existing.total_isr += amount;
      else if (imp.taxType === "002") existing.total_iva += amount;
    }

    byPeriod.set(period, existing);
  }

  return Array.from(byPeriod.values())
    .sort((a, b) => (a.period < b.period ? 1 : -1))
    .slice(0, months);
}
