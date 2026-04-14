import type { EvidencePack } from "./evidence";
import type { TimelineEventType } from "@/components/shared/v2/evidence-timeline";

export interface BuiltTimelineEvent {
  date: string;
  type: TimelineEventType;
  label: string;
  detail?: string;
}

/**
 * Builds a chronological timeline from an evidence pack.
 * Derives events from: overdue invoices, last order, last email, recent
 * insights. The result is what the CEO sees to understand "cómo llegamos
 * a este insight".
 *
 * @example
 * const events = buildTimelineFromEvidencePack(pack);
 * <EvidenceTimeline events={events} />
 */
export function buildTimelineFromEvidencePack(
  pack: EvidencePack
): BuiltTimelineEvent[] {
  const events: BuiltTimelineEvent[] = [];

  // Overdue invoices — cada factura emitida + su evento de vencimiento
  const overdue = pack.financials.overdue_invoices ?? [];
  for (const inv of overdue) {
    // Event: invoice due date (= overdue start)
    events.push({
      date: inv.due_date,
      type: "overdue" as const,
      label: `Factura ${inv.name} vence sin pago`,
      detail: `${formatMxn(inv.amount_mxn)} · ${inv.days_overdue} días vencida`,
    });
  }

  // Last order — del orders section
  if (pack.orders.last_order_date) {
    events.push({
      date: pack.orders.last_order_date,
      type: "order" as const,
      label: `Último pedido (${pack.orders.total_orders_12m} en 12m)`,
      detail: pack.orders.avg_order_mxn
        ? `Ticket promedio ${formatMxn(pack.orders.avg_order_mxn)}`
        : undefined,
    });
  }

  // Last email
  if (pack.communication.last_email_date) {
    events.push({
      date: pack.communication.last_email_date,
      type: "email" as const,
      label: `Último email`,
      detail:
        pack.communication.days_since_last_email != null &&
        pack.communication.days_since_last_email > 30
          ? `${pack.communication.days_since_last_email} días de silencio`
          : undefined,
    });
  }

  // Recent insights — cada uno es un evento histórico
  const insights = pack.history.recent_insights ?? [];
  for (const i of insights.slice(0, 5)) {
    events.push({
      date: i.created,
      type:
        i.state === "acted_on"
          ? "resolved"
          : i.state === "expired"
            ? "alert"
            : "alert",
      label: `Insight ${i.state}: ${truncate(i.title, 80)}`,
      detail: i.category,
    });
  }

  // Late deliveries (only their scheduled dates)
  const lates = pack.deliveries.late_details ?? [];
  for (const d of lates.slice(0, 3)) {
    events.push({
      date: d.scheduled,
      type: "delivery" as const,
      label: `Entrega ${d.name} tarde`,
      detail: d.origin ? `Origen: ${d.origin}` : undefined,
    });
  }

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

function formatMxn(value: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
    notation: "compact",
  }).format(value);
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len) + "…" : s;
}

/**
 * Extracts invoice/order/delivery references from free-form text.
 * Patterns:
 *   - INV/YYYY/MM/NNNN → invoice
 *   - PV1234 or P00NN → purchase order (but hard to distinguish from sale)
 *   - TL/OUT/NNNNN → delivery
 *   - SO/YYYY/NNNN → sale order
 *
 * Returns a list of unique refs with their detected type.
 */
export interface ExtractedRef {
  type: "invoice" | "order" | "delivery";
  reference: string;
}

export function extractEvidenceRefs(text: string): ExtractedRef[] {
  if (!text) return [];
  const refs: ExtractedRef[] = [];
  const seen = new Set<string>();

  const patterns: Array<{ type: ExtractedRef["type"]; regex: RegExp }> = [
    // INV/2026/02/0144 or INV/2026/0144
    { type: "invoice", regex: /\bINV\/\d{4}\/(?:\d{2}\/)?\d{3,4}\b/g },
    // SO/2026/0123
    { type: "order", regex: /\bSO\/\d{4}\/\d{3,4}\b/g },
    // PV12345 or P0012345
    { type: "order", regex: /\bP(?:V\d{4,6}|\d{6,8})\b/g },
    // TL/OUT/10189, TL/IN/12345
    { type: "delivery", regex: /\bTL\/(?:OUT|IN)\/\d{3,6}\b/g },
  ];

  for (const { type, regex } of patterns) {
    const matches = text.matchAll(regex);
    for (const m of matches) {
      const ref = m[0];
      if (seen.has(ref)) continue;
      seen.add(ref);
      refs.push({ type, reference: ref });
    }
  }

  return refs;
}
