/**
 * Shared TTL (Time-To-Live) logic for agent insights.
 *
 * Used by:
 *  - /api/agents/orchestrate — to set expires_at on INSERT
 *  - /api/agents/validate    — to age-check insights
 *
 * Post-mortem findings (2026-04-12):
 * - 3,145 expired insights at TTL ~7d, 85% expire rate
 * - $495M MXN of flagged opportunity never acted on
 * - CEO needs longer window for complex issues
 *
 * New TTL ranges — 3x the old values. High-value insights stay longer
 * because the CEO's average time-to-act is days, not hours.
 */

export interface TTLInput {
  severity?: string | null;
  insight_type?: string | null;
}

/**
 * TTL in days based on severity + insight_type.
 */
export function getInsightTTLDays(input: TTLInput): number {
  const severity = (input.severity ?? "").toLowerCase();
  const insightType = (input.insight_type ?? "").toLowerCase();

  // Critical: 21 days. Highest impact, needs most time for coordination.
  if (severity === "critical") return 21;

  // High: 21 days. Most business insights live here.
  if (severity === "high") return 21;

  // Risk/prediction regardless of severity: 30 days. Long-lived by nature.
  if (insightType === "risk" || insightType === "prediction") return 30;

  // Medium: 30 days. Less urgent but still valuable.
  if (severity === "medium") return 30;

  // Low: 45 days. Informational, low urgency.
  if (severity === "low") return 45;

  // Info / unknown: 14 days. Conservative but not aggressive.
  return 14;
}

/**
 * Compute expires_at from now + TTL days.
 */
export function computeExpiresAt(input: TTLInput, from: Date = new Date()): Date {
  const ttlDays = getInsightTTLDays(input);
  const d = new Date(from);
  d.setDate(d.getDate() + ttlDays);
  return d;
}

/**
 * Check if an insight is past its TTL.
 */
export function isExpired(input: TTLInput & { created_at: string | Date }): boolean {
  const createdAt = input.created_at instanceof Date
    ? input.created_at
    : new Date(input.created_at);
  const ageMs = Date.now() - createdAt.getTime();
  const ageDays = ageMs / 86400_000;
  return ageDays > getInsightTTLDays(input);
}
