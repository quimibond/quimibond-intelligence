import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(date: string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeAgo(date: string | null): string {
  if (!date) return "—";
  const now = new Date();
  const past = new Date(date);
  const diffMs = now.getTime() - past.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "ahora";
  if (diffMins < 60) return `hace ${diffMins}m`;
  if (diffHours < 24) return `hace ${diffHours}h`;
  if (diffDays < 7) return `hace ${diffDays}d`;
  if (diffDays < 30) return `hace ${Math.floor(diffDays / 7)}sem`;
  return past.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export function truncate(str: string | null, length: number): string {
  if (!str) return "";
  return str.length > length ? str.slice(0, length) + "..." : str;
}

export function getInitials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function scoreToPercent(score: number | null, max = 100): number {
  if (score == null) return 0;
  return Math.min(100, Math.max(0, (score / max) * 100));
}

export function formatCurrency(value: number | null): string {
  if (value == null) return "—";
  return (
    "$" +
    value.toLocaleString("es-MX", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
  );
}

/** Display product: prefer internal_ref (e.g. "ZN4032OW160") over long name */
export function productDisplay(item: { product_ref?: string | null; product_name?: string | null; internal_ref?: string | null; name?: string | null }): string {
  return item.product_ref || item.internal_ref || item.product_name || item.name || "—";
}

export function sentimentColor(score: number | null): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 0.6) return "text-success";
  if (score >= 0.3) return "text-warning";
  return "text-danger";
}
