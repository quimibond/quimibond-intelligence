// ---------------------------------------------------------------------------
// Thread helpers — pure TypeScript, no React dependency
// ---------------------------------------------------------------------------

export type StatusFilter = "all" | "stalled" | "active" | "cold";

export function formatHoursWithout(hours: number | null): string {
  if (hours == null) return "\u2014";
  if (hours < 1) return "<1h";
  if (hours < 24) return `${Math.floor(hours)}h`;
  if (hours < 168) {
    const d = Math.floor(hours / 24);
    const h = Math.floor(hours % 24);
    return h > 0 ? `${d}d ${h}h` : `${d}d`;
  }
  const w = Math.floor(hours / 168);
  return `${w} sem`;
}

export function urgencyBadgeVariant(
  hours: number | null
): "success" | "warning" | "critical" {
  if (hours == null || hours < 12) return "success";
  if (hours <= 48) return "warning";
  return "critical";
}

export function urgencyLabel(hours: number | null): string {
  if (hours == null || hours < 12) return "OK";
  if (hours <= 48) return "Atenci\u00f3n";
  return "Urgente";
}

export function rowBgClass(hours: number | null): string {
  if (hours != null && hours > 72) return "bg-danger/5";
  if (hours != null && hours > 24) return "bg-warning/5";
  return "";
}

export function senderTypeVariant(
  type: string | null
): "info" | "warning" | "secondary" {
  if (type === "inbound") return "info";
  if (type === "outbound") return "warning";
  return "secondary";
}

export function senderTypeLabel(type: string | null): string {
  if (type === "inbound") return "externo";
  if (type === "outbound") return "interno";
  return type ?? "\u2014";
}
