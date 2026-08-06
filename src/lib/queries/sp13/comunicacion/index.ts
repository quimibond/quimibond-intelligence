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

export interface MailboxActivity {
  account: string;
  personName: string | null;
  recibidos7d: number;
  enviados7d: number;
  sinRespuesta: number;
  lastActivity: string | null;
}

export interface MailboxThread {
  threadId: number;
  subject: string | null;
  companyId: number | null;
  companyName: string | null;
  lastSender: string | null;
  lastSenderType: string | null;
  lastActivity: string;
  messageCount: number;
  esperandoRespuesta: boolean;
}

async function _getMailboxActivity(): Promise<MailboxActivity[]> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("get_mailbox_activity");
  if (error) {
    console.error("[comunicacion] get_mailbox_activity", error);
    return [];
  }
  const rows = (data ?? []) as Record<string, unknown>[];

  // Nombre de la persona vía odoo_users (si el buzón coincide con su email)
  const accounts = rows.map((r) => String(r.account));
  const { data: users } = await supabase
    .from("odoo_users")
    .select("email, name")
    .in("email", accounts);
  const nameByEmail = new Map(
    (users ?? []).map((u) => [String(u.email).toLowerCase(), u.name as string]),
  );

  return rows.map((r) => ({
    account: String(r.account),
    personName: nameByEmail.get(String(r.account).toLowerCase()) ?? null,
    recibidos7d: Number(r.recibidos_7d ?? 0),
    enviados7d: Number(r.enviados_7d ?? 0),
    sinRespuesta: Number(r.sin_respuesta ?? 0),
    lastActivity: (r.last_activity as string | null) ?? null,
  }));
}

async function _getMailboxThreads(account: string): Promise<MailboxThread[]> {
  const supabase = getServiceClient();
  const { data: threads } = await supabase
    .from("threads")
    .select(
      "id, subject, company_id, last_sender, last_sender_type, last_activity, message_count, has_internal_reply",
    )
    .eq("account", account)
    .order("last_activity", { ascending: false })
    .limit(20);

  const rows = threads ?? [];
  const companyIds = [...new Set(rows.map((t) => t.company_id).filter(Boolean))] as number[];
  const nameById = new Map<number, string>();
  if (companyIds.length) {
    const { data: companies } = await supabase
      .from("companies")
      .select("id, name")
      .in("id", companyIds);
    for (const c of companies ?? []) nameById.set(c.id as number, c.name as string);
  }

  return rows.map((t) => ({
    threadId: t.id as number,
    subject: (t.subject as string | null) ?? null,
    companyId: (t.company_id as number | null) ?? null,
    companyName: t.company_id ? (nameById.get(t.company_id as number) ?? null) : null,
    lastSender: (t.last_sender as string | null) ?? null,
    lastSenderType: (t.last_sender_type as string | null) ?? null,
    lastActivity: t.last_activity as string,
    messageCount: Number(t.message_count ?? 0),
    esperandoRespuesta: t.last_sender_type === "external" && Boolean(t.has_internal_reply),
  }));
}

export const getMailboxActivity = unstable_cache(
  _getMailboxActivity,
  ["comunicacion-mailbox-activity-v1"],
  { revalidate: 300, tags: ["comunicacion"] },
);

// Cache por buzón: unstable_cache no soporta keys dinámicas por arg en la
// misma entrada, así que se cachea con el account dentro del key extra.
export function getMailboxThreads(account: string): Promise<MailboxThread[]> {
  return unstable_cache(
    () => _getMailboxThreads(account),
    ["comunicacion-mailbox-threads-v1", account],
    { revalidate: 120, tags: ["comunicacion"] },
  )();
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
