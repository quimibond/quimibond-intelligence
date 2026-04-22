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
    sb.from("syntage_tax_status") // SP5-EXCEPTION: SAT source-layer reader — syntage_tax_status is the canonical Bronze source for SAT compliance opinion; no silver equivalent exists yet. TODO SP6.
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

/**
 * MODO ESTRATÉGICO: foto fiscal del trimestre y tendencias.
 * 5 queries via RPCs (pre-agregadas en SQL), ~18K tokens context total.
 *
 * Usa RPCs en lugar de queries crudas para reducir payload y mover el cost
 * de agregación al plano de la DB.
 */
export async function buildComplianceContextEstrategico(
  sb: SupabaseClient,
  profileSection: string
): Promise<string> {
  const [
    trendRes,
    unlinkedRes,
    coverageRes,
    resolutionsRes,
    taxReturnsRes,
  ] = await Promise.all([
    sb.rpc("syntage_open_issues_by_week"),
    sb.rpc("syntage_top_unlinked_rfcs", { p_limit: 10 }),
    sb.rpc("syntage_validation_coverage_by_month", { p_months: 6 }),
    sb.rpc("syntage_recent_resolutions", { p_days: 30 }),
    sb.rpc("syntage_recent_tax_returns", { p_months: 12 }),
  ]);

  return `${profileSection}## MODO: ESTRATÉGICO (foto fiscal 6-12m)

## TREND ISSUES OPEN POR SEMANA (12 semanas)
${safeJSON((trendRes as { data: unknown }).data)}

## DECLARACIONES SAT (últimos 12 meses)
${safeJSON((taxReturnsRes as { data: unknown }).data)}

## TOP 10 RFCs NO LINKEADOS (sat_only_cfdi_received)
${safeJSON((unlinkedRes as { data: unknown }).data)}

## COBERTURA VALIDACIÓN (ratio validated/posted por mes)
${safeJSON((coverageRes as { data: unknown }).data)}

## RESOLUCIONES ÚLTIMOS 30 DÍAS
${safeJSON((resolutionsRes as { data: unknown }).data)}`;
}
