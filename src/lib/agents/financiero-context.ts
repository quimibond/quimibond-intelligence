// src/lib/agents/financiero-context.ts
//
// SP5 Task 18: all §12 legacy MV reads replaced with canonical/gold equivalents.
// - company_profile → canonical_invoices aggregation (AR/AP open)
// - invoices_unified → canonical_invoices
// - pl_estado_resultados → gold_pl_statement (via getPlHistory helper)
// - working_capital → gold_cashflow
// - odoo_invoices (in_invoice/out_invoice) → canonical_invoices
// - odoo_account_payments: SP5-EXCEPTION (no canonical_payments API surface needed here)
// - cfo_dashboard: SP5-VERIFIED — retained (§12 not in drop list)
// - odoo_bank_balances: SP5-EXCEPTION — Bronze, no canonical_bank_balances read here
//
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCfoSnapshot, getPlHistory } from "@/lib/queries/analytics/finance";

function safeJSON(v: unknown): string {
  try { return JSON.stringify(v, null, 2); } catch { return "[]"; }
}

/**
 * MODO OPERATIVO: lo que debe pasar ESTA SEMANA.
 * Foco: cartera vencida, cobros, pagos, runway.
 * Queries sobre canonical/gold layer + SAT issues.
 */
export async function buildFinancieroContextOperativo(
  sb: SupabaseClient,
  profileSection: string
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const [
    openARByCompany,
    inboundPayments,
    openAPItems,
    outboundPayments,
    runwayRes,
    // Canonical AR with SAT UUID validated
    openARWithSat,
    ppdSinComplemento,
    cashflow,
  ] = await Promise.all([
    // canonical_invoices — cartera vencida emitida por empresa (replaces company_profile overdue)
    sb.from("canonical_invoices")
      .select("receptor_canonical_company_id, amount_residual_mxn_odoo, due_date_odoo, payment_state_odoo, invoice_date")
      .eq("direction", "issued")
      .in("payment_state_odoo", ["not_paid", "partial"])
      .gt("amount_residual_mxn_odoo", 0)
      .lt("due_date_odoo", today)
      .order("amount_residual_mxn_odoo", { ascending: false })
      .limit(15),
    // SP5-EXCEPTION: odoo_account_payments Bronze — canonical_payments has no payment_type inbound/outbound filter yet
    sb.from("odoo_account_payments") // SP5-EXCEPTION: Bronze odoo_account_payments — canonical equivalent not wired for inbound filter
      .select("company_id, amount, date, journal_name, payment_method")
      .eq("payment_type", "inbound")
      .order("date", { ascending: false })
      .limit(10),
    // canonical_invoices — facturas proveedor vencidas (replaces odoo_invoices in_invoice query)
    sb.from("canonical_invoices")
      .select("emisor_canonical_company_id, amount_residual_mxn_odoo, due_date_odoo, invoice_date, payment_state_odoo")
      .eq("direction", "received")
      .in("payment_state_odoo", ["not_paid", "partial"])
      .gt("amount_residual_mxn_odoo", 0)
      .lt("due_date_odoo", today)
      .order("due_date_odoo", { ascending: true })
      .limit(15),
    // SP5-EXCEPTION: odoo_account_payments Bronze — outbound filter
    sb.from("odoo_account_payments") // SP5-EXCEPTION: Bronze odoo_account_payments — canonical equivalent not wired for outbound filter
      .select("company_id, amount, date, journal_name, payment_method")
      .eq("payment_type", "outbound")
      .order("date", { ascending: false })
      .limit(10),
    Promise.resolve(sb.rpc("cashflow_runway")).then((r: { data: unknown }) => r).catch(() => ({ data: null })),
    // canonical_invoices — cartera vencida con UUID SAT validado (replaces invoices_unified)
    sb.from("canonical_invoices")
      .select("sat_uuid, canonical_id, receptor_canonical_company_id, amount_residual_mxn_odoo, due_date_odoo, invoice_date, payment_state_odoo, estado_sat")
      .eq("direction", "issued")
      .in("payment_state_odoo", ["not_paid", "partial"])
      .gt("amount_residual_mxn_odoo", 0)
      .lt("due_date_odoo", today)
      .not("sat_uuid", "is", null)
      .order("amount_residual_mxn_odoo", { ascending: false })
      .limit(15),
    // reconciliation_issues — pagos PPD sin complemento tipo P
    sb.from("reconciliation_issues")
      .select("issue_id, description, company_id, detected_at, metadata")
      .eq("issue_type", "payment_missing_complemento")
      .is("resolved_at", null)
      .order("detected_at", { ascending: false })
      .limit(5),
    // gold_cashflow — working capital snapshot
    sb.from("gold_cashflow").select("*").maybeSingle(),
  ]);

  const runway = runwayRes.data as Record<string, unknown> | null;
  const cf = cashflow.data as Record<string, unknown> | null;

  return `${profileSection}## MODO: OPERATIVO (qué cobrar/pagar esta semana)
## NOTA FISCAL (Fase 6)
Cuando reportes revenue o CxC, separa "posted Y validado SAT" de "posted sin UUID".
Los números SAT son la foto que verá Hacienda.

## ALERTA CASH FLOW (gold_cashflow)
Efectivo actual: $${cf?.current_cash_mxn ?? "?"} | CxC total: $${cf?.total_receivable_mxn ?? "?"} | CxP total: $${cf?.total_payable_mxn ?? "?"} | Capital trabajo: $${cf?.working_capital_mxn ?? "?"}
Runway RPC (legacy): ${runway?.alerta ?? "Sin datos"} | Dias: ${runway?.dias_runway ?? "?"} | Proyeccion 7d: ${safeJSON(runway?.proyeccion_7d)}

## CARTERA VENCIDA POR EMPRESA (canonical_invoices issued, top 15)
${safeJSON(openARByCompany.data)}

## COBROS RECIENTES
${safeJSON(inboundPayments.data)}

## FACTURAS PROVEEDOR VENCIDAS (canonical_invoices received, top 15)
${safeJSON(openAPItems.data)}

## PAGOS A PROVEEDORES (recientes)
${safeJSON(outboundPayments.data)}

## CARTERA VENCIDA CON CFDI VALIDADO SAT (canonical_invoices + sat_uuid, top 15)
${safeJSON(openARWithSat.data)}

## PAGOS PPD SIN COMPLEMENTO TIPO P (riesgo IVA acreditable, top 5)
${safeJSON(ppdSinComplemento.data)}`;
}

/**
 * MODO ESTRATÉGICO: la foto del mes y desvíos estructurales.
 * Foco: P&L, capital de trabajo, presupuesto vs real, anomalías.
 */
export async function buildFinancieroContextEstrategico(
  sb: SupabaseClient,
  profileSection: string
): Promise<string> {
  const [cfoDash, plReport, cashflow, balanceSheet, anomalies, validationCoverage, revenueFiscalTrend, taxReturns12m] = await Promise.all([
    // cfo_dashboard view was dropped (SP8); use the rebuilt canonical helper.
    getCfoSnapshot(),
    // gold_pl_statement via helper (replaces pl_estado_resultados)
    getPlHistory(6),
    // gold_cashflow — replaces working_capital + financial_runway
    sb.from("gold_cashflow").select("*").maybeSingle(),
    // gold_balance_sheet — canonical balance sheet
    sb.from("gold_balance_sheet").select("*").order("period_month", { ascending: false }).limit(1).maybeSingle(),
    // SP5-VERIFIED: accounting_anomalies retained (§12 not in drop list)
    sb.from("accounting_anomalies")
      .select("anomaly_type, severity, description, company_name, amount")
      .order("amount", { ascending: false })
      .limit(15),
    // Fase 6 · cobertura de validación SAT (ratio validated/posted por mes)
    Promise.resolve(sb.rpc("syntage_validation_coverage_by_month", { p_months: 6 }))
      .then((r: { data: unknown }) => r)
      .catch(() => ({ data: null })),
    // Fase 6: trend revenue fiscal 24 meses
    sb.from("syntage_revenue_fiscal_monthly") // SP5-EXCEPTION: Bronze syntage_ fiscal data — no canonical equivalent yet
      .select("month, revenue_mxn, gasto_mxn, cfdis_emitidos, cfdis_recibidos, clientes_unicos")
      .order("month", { ascending: false })
      .limit(24),
    // Fase 6: tax returns últimos 12 meses
    sb.from("syntage_tax_returns") // SP5-EXCEPTION: Bronze syntage_ fiscal data — no canonical equivalent yet
      .select("ejercicio, periodo, tipo_declaracion, impuesto, monto_pagado, fecha_presentacion")
      .gte("fecha_presentacion", new Date(Date.now() - 365 * 86400_000).toISOString())
      .order("fecha_presentacion", { ascending: false })
      .limit(24),
  ]);

  const dash = cfoDash;
  const cf = cashflow.data as Record<string, unknown> | null;
  const bs = balanceSheet.data as Record<string, unknown> | null;

  return `${profileSection}## MODO: ESTRATEGICO (foto del mes y desvios)
## NOTA FISCAL (Fase 6)
Cuando reportes revenue o CxC, separa "posted Y validado SAT" de "posted sin UUID".
Los números SAT son la foto que verá Hacienda.

## RESUMEN EJECUTIVO CFO (canonical sources via getCfoSnapshot)
Efectivo total MXN: $${dash?.efectivoTotalMxn ?? "?"} | Solo MXN: $${dash?.efectivoMxn ?? "?"} | Solo USD: $${dash?.efectivoUsd ?? "?"} | Deuda tarjetas: $${dash?.deudaTarjetas ?? "?"} | Posición neta: $${dash?.posicionNeta ?? "?"} | CxC: $${dash?.cuentasPorCobrar ?? "?"} | CxP: $${dash?.cuentasPorPagar ?? "?"} | Cartera vencida: $${dash?.carteraVencida ?? "?"} | Ventas 30d: $${dash?.ventas30d ?? "?"} | Cobros 30d: $${dash?.cobros30d ?? "?"}

## CAPITAL DE TRABAJO (gold_cashflow)
Efectivo: $${cf?.current_cash_mxn ?? "?"} | CxC: $${cf?.total_receivable_mxn ?? "?"} | CxP: $${cf?.total_payable_mxn ?? "?"} | Capital de trabajo: $${cf?.working_capital_mxn ?? "?"}

## BALANCE SHEET (gold_balance_sheet · último período)
${safeJSON(bs)}

## ESTADO DE RESULTADOS P&L (gold_pl_statement · últimos 6 meses)
${safeJSON(plReport)}

## ANOMALIAS CONTABLES
${safeJSON(anomalies.data)}

## COBERTURA VALIDACIÓN SAT (Fase 6, ratio validated/posted 6m)
${safeJSON(validationCoverage.data)}

## TREND REVENUE FISCAL (Syntage · últimos 24 meses)
${safeJSON(revenueFiscalTrend.data)}

## DECLARACIONES SAT (últimos 12 meses)
${safeJSON(taxReturns12m.data)}`;
}
