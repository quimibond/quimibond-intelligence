// src/lib/agents/compliance-context.ts
// Context builder del director Compliance IA. Fuente: Layer 3 (Syntage Fase 3+).
// Lee únicamente datos fiscales; NO mezcla con operativo/contable general.
import type { SupabaseClient } from "@supabase/supabase-js";

function safeJSON(v: unknown): string {
  try { return JSON.stringify(v, null, 2); } catch { return "[]"; }
}

/**
 * MODO OPERATIVO: riesgo SAT HOY. 7 queries, ~15K tokens context.
 * Foco: issues critical abiertos + blacklist 69-B + payments sin complemento
 *       + cancelled_but_posted + sat_only_cfdi_issued reciente (30d).
 *
 * Nota schema (Fase 3): reconciliation_issues usa resolved_at IS NULL para "open"
 * (no existe columna status). partner_blacklist_69b es un issue_type, no una tabla.
 */
export async function buildComplianceContextOperativo(
  sb: SupabaseClient,
  profileSection: string
): Promise<string> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();

  const [
    criticalIssues,
    summaryRes,
    blacklist69b,
    taxStatus,
    ppdSinComplemento,
    cancelledPosted,
    satOnlyRecent
  ] = await Promise.all([
    sb.from("reconciliation_issues")
      .select("issue_id, issue_type, severity, description, company_id, detected_at, metadata")
      .eq("severity", "critical")
      .is("resolved_at", null)
      .order("detected_at", { ascending: false })
      .limit(20),
    // RPC existente (Fase 3). Wrap en try para no romper si falla.
    sb.rpc("get_syntage_reconciliation_summary"),
    sb.from("reconciliation_issues")
      .select("issue_id, description, metadata, detected_at, company_id")
      .eq("issue_type", "partner_blacklist_69b")
      .is("resolved_at", null)
      .order("detected_at", { ascending: false }),
    sb.from("syntage_tax_status")
      .select("opinion_cumplimiento, fecha_consulta, regimen_fiscal")
      .order("fecha_consulta", { ascending: false, nullsFirst: false })
      .limit(1),
    sb.from("reconciliation_issues")
      .select("issue_id, description, company_id, detected_at, metadata")
      .eq("issue_type", "payment_missing_complemento")
      .is("resolved_at", null)
      .order("detected_at", { ascending: false })
      .limit(15),
    sb.from("reconciliation_issues")
      .select("issue_id, description, company_id, detected_at, metadata")
      .eq("issue_type", "cancelled_but_posted")
      .is("resolved_at", null)
      .order("detected_at", { ascending: false })
      .limit(15),
    sb.from("reconciliation_issues")
      .select("issue_id, description, company_id, detected_at, metadata")
      .eq("issue_type", "sat_only_cfdi_issued")
      .is("resolved_at", null)
      .gte("detected_at", thirtyDaysAgo)
      .order("detected_at", { ascending: false })
      .limit(20),
  ]);

  const summary = (summaryRes as { data: unknown }).data;
  const criticalRows = (criticalIssues as { data: unknown[] }).data ?? [];
  const issuesCount = Array.isArray(criticalRows) ? criticalRows.length : 0;

  return `${profileSection}## MODO: OPERATIVO (riesgo SAT HOY)

## RESUMEN FISCAL
${safeJSON(summary)}

## OPINIÓN SAT / 32-D (última consulta)
${safeJSON((taxStatus as { data: unknown[] }).data ?? [])}

## ISSUES CRÍTICOS ABIERTOS (top 20)
${issuesCount === 0 ? "Sin issues abiertos críticos." : safeJSON(criticalRows)}

## PARTNER BLACKLIST 69-B (open)
${safeJSON((blacklist69b as { data: unknown }).data)}

## PAGOS PPD SIN COMPLEMENTO TIPO P (top 15)
${safeJSON((ppdSinComplemento as { data: unknown }).data)}

## CFDI CANCELADO EN SAT / POSTED EN ODOO (top 15)
${safeJSON((cancelledPosted as { data: unknown }).data)}

## SAT-ONLY CFDI ISSUED ÚLTIMOS 30 DÍAS (top 20)
${safeJSON((satOnlyRecent as { data: unknown }).data)}`;
}
