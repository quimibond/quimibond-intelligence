import { getServiceClient } from "@/lib/supabase-server";

export interface ElectronicAccountingRow {
  syntage_id: string | null;
  taxpayer_rfc: string | null;
  odoo_company_id: number | null;
  record_type: string | null;   // "balanza" | "catalogo_cuentas"
  ejercicio: number | null;     // fiscal year, e.g. 2019
  periodo: string | null;       // 2-char month string, e.g. "01"
  tipo_envio: string | null;
  synced_at: string | null;
  created_at: string | null;
}

export interface ElectronicAccountingByType {
  record_type: string;
  description: string;
  count: number;
  latest_period: string | null; // "YYYY-MM"
  latest_created: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  balanza: "Balanza de comprobación",
  catalogo_cuentas: "Catálogo de cuentas",
  polizas: "Pólizas contables",
};

export async function getElectronicAccountingSummary(): Promise<ElectronicAccountingByType[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("syntage_electronic_accounting") // SP5-EXCEPTION: SAT source-layer reader — syntage_electronic_accounting is the canonical Bronze source for SAT contabilidad electronica. TODO SP6.
    .select(
      "syntage_id, taxpayer_rfc, odoo_company_id, record_type, ejercicio, periodo, tipo_envio, synced_at, created_at"
    );
  if (error) throw new Error(`electronic_accounting query failed: ${error.message}`);
  const rows = (data ?? []) as unknown as ElectronicAccountingRow[];

  const byType = new Map<string, ElectronicAccountingByType>();
  for (const r of rows) {
    const type = r.record_type ?? "desconocido";
    const existing = byType.get(type) ?? {
      record_type: type,
      description: TYPE_LABELS[type] ?? "(tipo desconocido)",
      count: 0,
      latest_period: null,
      latest_created: null,
    };
    existing.count += 1;
    const period =
      r.ejercicio && r.periodo
        ? `${r.ejercicio}-${String(r.periodo).padStart(2, "0")}`
        : null;
    if (period && (!existing.latest_period || period > existing.latest_period)) {
      existing.latest_period = period;
    }
    if (
      r.created_at &&
      (!existing.latest_created || r.created_at > existing.latest_created)
    ) {
      existing.latest_created = r.created_at;
    }
    byType.set(type, existing);
  }
  return Array.from(byType.values()).sort((a, b) =>
    a.record_type.localeCompare(b.record_type)
  );
}

export async function getElectronicAccountingRecent(
  limit = 15
): Promise<ElectronicAccountingRow[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("syntage_electronic_accounting") // SP5-EXCEPTION: SAT source-layer reader — syntage_electronic_accounting recent records. TODO SP6.
    .select(
      "syntage_id, taxpayer_rfc, odoo_company_id, record_type, ejercicio, periodo, tipo_envio, synced_at, created_at"
    )
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error)
    throw new Error(`electronic_accounting recent query failed: ${error.message}`);
  return (data ?? []) as unknown as ElectronicAccountingRow[];
}
