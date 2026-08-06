/**
 * Queries de la vista /hoy — alertas determinísticas y salud de datos.
 *
 * Regla de diseño: aquí NO se recalcula ningún KPI financiero. Los números
 * de dinero vienen de los módulos ya validados (finanzas/cobranza/home);
 * este módulo solo agrega las señales operativas que piden decisión hoy y
 * la evidencia de frescura de cada pipeline (Odoo / Gmail / backfill).
 */

import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

export interface LateDeliveriesResult {
  count: number;
  top: Array<{
    name: string;
    origin: string | null;
    scheduledDate: string | null;
    daysLate: number;
  }>;
}

export interface ReorderRisk {
  companyId: number | null;
  companyName: string;
  daysOverdueReorder: number;
  avgOrderValue: number;
  salespersonName: string | null;
  tier: string | null;
}

export interface DataHealth {
  odooStale: Array<{ table: string; status: string; hoursAgo: number | null }>;
  odooTablesTotal: number;
  lastEmailAt: string | null;
  emailAgeHours: number | null;
  backfill: { pendingAccounts: number; totalAccounts: number; emailsRecovered: number } | null;
  generatedAt: string;
}

async function _getLateDeliveries(): Promise<LateDeliveriesResult> {
  const supabase = getServiceClient();
  const { data, count } = await supabase
    .from("odoo_deliveries")
    .select("name, origin, scheduled_date", { count: "exact" })
    .eq("is_late", true)
    .order("scheduled_date", { ascending: true })
    .limit(5);

  const now = Date.now();
  return {
    count: count ?? 0,
    top: (data ?? []).map((d) => ({
      name: d.name as string,
      origin: (d.origin as string | null) ?? null,
      scheduledDate: (d.scheduled_date as string | null) ?? null,
      daysLate: d.scheduled_date
        ? Math.max(0, Math.floor((now - new Date(d.scheduled_date as string).getTime()) / 86400000))
        : 0,
    })),
  };
}

async function _getReorderRisks(): Promise<ReorderRisk[]> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("client_reorder_predictions")
    .select(
      "company_id, company_name, days_overdue_reorder, avg_order_value, salesperson_name, tier",
    )
    .gt("days_overdue_reorder", 0)
    .order("avg_order_value", { ascending: false })
    .limit(5);

  return (data ?? []).map((r) => ({
    companyId: (r.company_id as number | null) ?? null,
    companyName: (r.company_name as string) ?? "—",
    daysOverdueReorder: Number(r.days_overdue_reorder ?? 0),
    avgOrderValue: Number(r.avg_order_value ?? 0),
    salespersonName: (r.salesperson_name as string | null) ?? null,
    tier: (r.tier as string | null) ?? null,
  }));
}

async function _getDataHealth(): Promise<DataHealth> {
  const supabase = getServiceClient();

  const [freshness, lastEmail, backfillState] = await Promise.all([
    supabase
      .from("odoo_sync_freshness")
      .select("table_name, status, hours_ago"),
    supabase
      .from("emails")
      .select("email_date")
      .order("email_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("email_backfill_state")
      .select("done, emails_saved"),
  ]);

  const rows = freshness.data ?? [];
  const odooStale = rows
    .filter((r) => r.status !== "fresh")
    .map((r) => ({
      table: r.table_name as string,
      status: r.status as string,
      hoursAgo: r.hours_ago == null ? null : Number(r.hours_ago),
    }))
    .sort((a, b) => (b.hoursAgo ?? 0) - (a.hoursAgo ?? 0));

  const lastEmailAt = (lastEmail.data?.email_date as string | undefined) ?? null;
  const emailAgeHours = lastEmailAt
    ? Math.round(((Date.now() - new Date(lastEmailAt).getTime()) / 3600000) * 10) / 10
    : null;

  // La tabla de backfill es temporal (recuperación del gap may–ago 2026);
  // si no existe o está vacía, la sección simplemente no se muestra.
  let backfill: DataHealth["backfill"] = null;
  const bf = backfillState.data;
  if (!backfillState.error && bf && bf.length > 0) {
    const pending = bf.filter((r) => !r.done).length;
    if (pending > 0) {
      backfill = {
        pendingAccounts: pending,
        totalAccounts: bf.length,
        emailsRecovered: bf.reduce((s, r) => s + Number(r.emails_saved ?? 0), 0),
      };
    }
  }

  return {
    odooStale,
    odooTablesTotal: rows.length,
    lastEmailAt,
    emailAgeHours,
    backfill,
    generatedAt: new Date().toISOString(),
  };
}

export interface EmailPending {
  id: number;
  threadId: number;
  tipo: string;
  descripcion: string;
  deadline: string | null;
  companyId: number | null;
  companyName: string | null;
  account: string | null;
  detectedAt: string;
}

async function _getEmailPendings(): Promise<EmailPending[]> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("email_pending_actions")
    .select("id, thread_id, tipo, descripcion, deadline, company_id, company_name, account, detected_at")
    .eq("status", "open")
    .order("deadline", { ascending: true, nullsFirst: false })
    .order("detected_at", { ascending: false })
    .limit(10);
  if (error) {
    console.error("[hoy] email_pending_actions", error);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id as number,
    threadId: r.thread_id as number,
    tipo: r.tipo as string,
    descripcion: r.descripcion as string,
    deadline: (r.deadline as string | null) ?? null,
    companyId: (r.company_id as number | null) ?? null,
    companyName: (r.company_name as string | null) ?? null,
    account: (r.account as string | null) ?? null,
    detectedAt: r.detected_at as string,
  }));
}

export const getEmailPendings = unstable_cache(_getEmailPendings, ["hoy-email-pendings-v1"], {
  revalidate: 120,
  tags: ["hoy"],
});

export const getLateDeliveries = unstable_cache(_getLateDeliveries, ["hoy-late-deliveries-v1"], {
  revalidate: 120,
  tags: ["hoy"],
});

export const getReorderRisks = unstable_cache(_getReorderRisks, ["hoy-reorder-risks-v1"], {
  revalidate: 300,
  tags: ["hoy"],
});

export const getDataHealth = unstable_cache(_getDataHealth, ["hoy-data-health-v1"], {
  revalidate: 60,
  tags: ["hoy"],
});
