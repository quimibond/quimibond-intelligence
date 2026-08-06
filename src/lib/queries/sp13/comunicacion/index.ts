/**
 * Señales determinísticas de comunicación (rediseño 2026-08-06).
 *
 * Dos señales, ambas RPC (SQL en 20260806_comunicacion_signals.sql):
 * - Hilos de clientes reales sin respuesta nuestra >= 24h (conversaciones
 *   con respuesta interna previa; excluye newsletters/postmaster/noreply).
 * - Clientes históricamente activos por correo que llevan >= 21 días
 *   callados, ordenados por lifetime value.
 */

import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

export interface UnansweredThread {
  threadId: number;
  subject: string | null;
  companyId: number | null;
  companyName: string;
  lastSender: string | null;
  account: string | null;
  lastActivity: string;
  hoursWaiting: number;
}

export interface SilentCustomer {
  companyId: number;
  companyName: string;
  lastInbound: string;
  daysSilent: number;
  emails90d: number;
  lifetimeValue: number;
}

async function _getUnansweredThreads(): Promise<UnansweredThread[]> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("get_unanswered_client_threads", {
    p_min_hours: 24,
    p_limit: 10,
  });
  if (error) {
    console.error("[comunicacion] get_unanswered_client_threads", error);
    return [];
  }
  return (data ?? []).map((r: Record<string, unknown>) => ({
    threadId: Number(r.thread_id),
    subject: (r.subject as string | null) ?? null,
    companyId: r.company_id == null ? null : Number(r.company_id),
    companyName: (r.company_name as string) ?? "—",
    lastSender: (r.last_sender as string | null) ?? null,
    account: (r.account as string | null) ?? null,
    lastActivity: r.last_activity as string,
    hoursWaiting: Number(r.hours_waiting ?? 0),
  }));
}

async function _getSilentCustomers(): Promise<SilentCustomer[]> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("get_silent_customers", {
    p_silent_days: 21,
    p_min_emails_90d: 5,
    p_limit: 10,
  });
  if (error) {
    console.error("[comunicacion] get_silent_customers", error);
    return [];
  }
  return (data ?? []).map((r: Record<string, unknown>) => ({
    companyId: Number(r.company_id),
    companyName: (r.company_name as string) ?? "—",
    lastInbound: r.last_inbound as string,
    daysSilent: Number(r.days_silent ?? 0),
    emails90d: Number(r.emails_90d ?? 0),
    lifetimeValue: Number(r.lifetime_value ?? 0),
  }));
}

export const getUnansweredThreads = unstable_cache(
  _getUnansweredThreads,
  ["comunicacion-unanswered-v1"],
  { revalidate: 300, tags: ["comunicacion"] },
);

export const getSilentCustomers = unstable_cache(
  _getSilentCustomers,
  ["comunicacion-silent-v1"],
  { revalidate: 600, tags: ["comunicacion"] },
);
