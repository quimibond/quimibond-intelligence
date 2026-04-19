// src/lib/agents/fiscal-annotation.ts
// Post-filter pre-INSERT: enriquece agent_insights con flag fiscal determinístico.
// Lee de reconciliation_issues vía get_fiscal_annotation(company_id) RPC (migración 002).
// Se ejecuta DESPUÉS del grounding check, ANTES del INSERT.
import type { SupabaseClient } from "@supabase/supabase-js";

export type FiscalFlag =
  | "partner_blacklist_69b"
  | "cancelled_but_posted"
  | "sat_only_cfdi_issued"
  | "payment_missing_complemento";

export interface FiscalAnnotation {
  flag: FiscalFlag;
  severity: "critical" | "high" | "medium";
  issue_count: number;
  detail: string;
  /** UUIDs de reconciliation_issues.issue_id (text[] via array_agg en SQL fn). */
  issue_ids: string[];
}

export interface InsightForAnnotation {
  company_id: number | null;
  agent_slug: string;
  description?: string;
}

/**
 * Self-flag patterns: si el insight ya habla del tema fiscal, no se anota
 * para evitar badge redundante ("⚠️ fiscal" en un insight que ya ES fiscal).
 */
const SELF_FLAG_PATTERNS: Record<FiscalFlag, RegExp[]> = {
  partner_blacklist_69b:       [/69[\s-]?B/i, /\blista negra\b/i, /\bblacklist\b/i, /presunto/i],
  cancelled_but_posted:        [/cancel[ao]/i, /cfdi cancelado/i],
  sat_only_cfdi_issued:        [/sat[\s_-]?only/i, /sin respaldo/i, /sin odoo/i, /CFDI\s+huerfan/i],
  payment_missing_complemento: [/complemento/i, /tipo\s*p\b/i, /\bPPD\b.*pago/i],
};

function descriptionMentionsFlag(description: string | undefined, flag: FiscalFlag): boolean {
  if (!description) return false;
  return SELF_FLAG_PATTERNS[flag].some(re => re.test(description));
}

/**
 * Retorna annotation JSONB-compatible o null.
 * null → insight se inserta sin `fiscal_annotation`.
 */
export async function applyFiscalAnnotation(
  sb: SupabaseClient,
  insight: InsightForAnnotation
): Promise<FiscalAnnotation | null> {
  if (insight.company_id == null) return null;
  if (insight.agent_slug === "compliance") return null;

  const { data } = await sb.rpc("get_fiscal_annotation", { p_company_id: insight.company_id });
  const annot = data as FiscalAnnotation | null;
  if (!annot || !annot.flag) return null;

  // Self-flag guard: si el insight ya menciona el flag, skip annotation.
  if (descriptionMentionsFlag(insight.description, annot.flag)) return null;

  return annot;
}
