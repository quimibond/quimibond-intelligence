// ── Fase 6: fiscal helpers ──────────────────────────────────────────
// Separated from route.ts to avoid Next.js route export type constraints.

export type ReconciliationSnapshot = {
  total_open: number;
  severity_counts: { critical?: number; high?: number; medium?: number; low?: number };
};

export type FiscalTriggerSnap = {
  new_critical_24h: number;
  blacklist_new_24h: number;
  cancelled_but_posted_new_24h: number;
  tax_status_changed: boolean;
};

export function buildFiscalOneLiner(
  today: ReconciliationSnapshot | null,
  yesterday: ReconciliationSnapshot | null
): string {
  if (!today) return "Fiscal: pipeline degradado (snapshot hoy no disponible).";
  const c = today.severity_counts.critical ?? 0;
  const h = today.severity_counts.high ?? 0;
  const m = today.severity_counts.medium ?? 0;
  const base = `Fiscal: ${today.total_open} issues abiertos (crítico ${c} · alto ${h} · medio ${m})`;
  if (!yesterday) return `${base}. primer snapshot en proceso.`;
  const delta = today.total_open - yesterday.total_open;
  const sign = delta === 0 ? "0" : (delta > 0 ? `+${delta}` : `${delta}`);
  return `${base}. Δ 24h: ${sign}.`;
}

export function shouldIncludeFiscalSection(snap: FiscalTriggerSnap): boolean {
  return (
    snap.new_critical_24h > 0 ||
    snap.blacklist_new_24h > 0 ||
    snap.cancelled_but_posted_new_24h > 0 ||
    snap.tax_status_changed
  );
}
