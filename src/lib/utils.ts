import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function timeAgo(date: string): string {
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `hace ${diffMin}m`;
  if (diffHr < 24) return `hace ${diffHr}h`;
  if (diffDay < 7) return `hace ${diffDay}d`;
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export function severityColor(severity: string): string {
  switch (severity) {
    case "critical": return "var(--severity-critical)";
    case "high": return "var(--severity-high)";
    case "medium": return "var(--severity-medium)";
    case "low": return "var(--severity-low)";
    default: return "var(--muted-foreground)";
  }
}
