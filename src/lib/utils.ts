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
