import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import type { HistoryRange } from "@/components/patterns/history-range";
import { periodBoundsForRange } from "./_period";

/**
 * F-Tax — Retenciones, declaraciones SAT, contabilidad electrónica.
 *
 * Source: `canonical_tax_events` (event_type: retention | tax_return | electronic_accounting).
 *
 * - retention: impuestos retenidos a Quimibond por terceros (saldo a favor)
 * - tax_return: declaraciones presentadas con monto pagado
 * - electronic_accounting: balanzas / catálogos enviados al SAT (cumplimiento)
 *
 * The period filter narrows by the natural date for each event type:
 * - retention.retention_fecha_emision
 * - tax_return.return_ejercicio (year-only filter)
 * - electronic_accounting.acct_ejercicio (year-only filter)
 */
export interface TaxRetentionRow {
  uuid: string | null;
  emisorRfc: string | null;
  emisorNombre: string | null;
  tipoRetencion: string | null;
  monto: number;
  fechaEmision: string | null;
}

export interface TaxReturnRow {
  ejercicio: number | null;
  periodo: string | null;
  numeroOperacion: string | null;
  fechaPresentacion: string | null;
  tipoDeclaracion: string | null;
  montoPagado: number;
}

export interface TaxEventsSummary {
  period: HistoryRange;
  periodLabel: string;
  retentionsCount: number;
  retentionsTotalMxn: number;
  taxReturnsCount: number;
  taxReturnsTotalMxn: number;
  electronicAccountingCount: number;
  topRetentions: TaxRetentionRow[];
  topReturns: TaxReturnRow[];
}

async function _getTaxEventsRaw(range: HistoryRange): Promise<TaxEventsSummary> {
  const sb = getServiceClient();
  const bounds = periodBoundsForRange(range);
  const yearFrom = parseInt(bounds.fromMonth.slice(0, 4), 10);
  const yearTo = parseInt(bounds.toMonth.slice(0, 4), 10);

  const [retRes, returnsRes, acctRes] = await Promise.all([
    sb
      .from("canonical_tax_events")
      .select(
        "retention_uuid, emisor_rfc, emisor_nombre, tipo_retencion, monto_total_retenido, retention_fecha_emision"
      )
      .eq("event_type", "retention")
      .gte("retention_fecha_emision", bounds.from)
      .lt("retention_fecha_emision", bounds.to),
    sb
      .from("canonical_tax_events")
      .select(
        "return_ejercicio, return_periodo, return_numero_operacion, return_fecha_presentacion, return_tipo_declaracion, return_monto_pagado"
      )
      .eq("event_type", "tax_return")
      .gte("return_ejercicio", yearFrom)
      .lte("return_ejercicio", yearTo),
    sb
      .from("canonical_tax_events")
      .select("acct_ejercicio")
      .eq("event_type", "electronic_accounting")
      .gte("acct_ejercicio", yearFrom)
      .lte("acct_ejercicio", yearTo),
  ]);

  type RetRow = {
    retention_uuid: string | null;
    emisor_rfc: string | null;
    emisor_nombre: string | null;
    tipo_retencion: string | null;
    monto_total_retenido: number | null;
    retention_fecha_emision: string | null;
  };
  type RetRows = RetRow[];
  const retRows = (retRes.data ?? []) as RetRows;
  const retentionsTotalMxn = retRows.reduce(
    (s, r) => s + (Number(r.monto_total_retenido) || 0),
    0
  );
  const topRetentions: TaxRetentionRow[] = [...retRows]
    .sort(
      (a, b) =>
        (Number(b.monto_total_retenido) || 0) -
        (Number(a.monto_total_retenido) || 0)
    )
    .slice(0, 10)
    .map((r) => ({
      uuid: r.retention_uuid,
      emisorRfc: r.emisor_rfc,
      emisorNombre: r.emisor_nombre,
      tipoRetencion: r.tipo_retencion,
      monto: Number(r.monto_total_retenido) || 0,
      fechaEmision: r.retention_fecha_emision,
    }));

  type RetReturn = {
    return_ejercicio: number | null;
    return_periodo: string | null;
    return_numero_operacion: string | null;
    return_fecha_presentacion: string | null;
    return_tipo_declaracion: string | null;
    return_monto_pagado: number | null;
  };
  const retReturns = (returnsRes.data ?? []) as RetReturn[];
  const taxReturnsTotalMxn = retReturns.reduce(
    (s, r) => s + (Number(r.return_monto_pagado) || 0),
    0
  );
  const topReturns: TaxReturnRow[] = [...retReturns]
    .sort(
      (a, b) =>
        (Number(b.return_monto_pagado) || 0) -
        (Number(a.return_monto_pagado) || 0)
    )
    .slice(0, 10)
    .map((r) => ({
      ejercicio: r.return_ejercicio,
      periodo: r.return_periodo,
      numeroOperacion: r.return_numero_operacion,
      fechaPresentacion: r.return_fecha_presentacion,
      tipoDeclaracion: r.return_tipo_declaracion,
      montoPagado: Number(r.return_monto_pagado) || 0,
    }));

  return {
    period: range,
    periodLabel: bounds.label,
    retentionsCount: retRows.length,
    retentionsTotalMxn,
    taxReturnsCount: retReturns.length,
    taxReturnsTotalMxn,
    electronicAccountingCount: (acctRes.data ?? []).length,
    topRetentions,
    topReturns,
  };
}

export async function getTaxEvents(range: HistoryRange): Promise<TaxEventsSummary> {
  return _getTaxEventsRaw(range);
}
