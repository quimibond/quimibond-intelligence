// src/lib/agents/financiero-context.ts
import type { SupabaseClient } from "@supabase/supabase-js";

function safeJSON(v: unknown): string {
  try { return JSON.stringify(v, null, 2); } catch { return "[]"; }
}

/**
 * MODO OPERATIVO: lo que debe pasar ESTA SEMANA.
 * Foco: cartera vencida, cobros, pagos, runway.
 * 8 queries — contexto chico y accionable + Layer 3 SAT.
 */
export async function buildFinancieroContextOperativo(
  sb: SupabaseClient,
  profileSection: string
): Promise<string> {
  const [
    overdueByCompany,
    inboundPayments,
    supplierOverdue,
    outboundPayments,
    runwayRes,
    payPredictions,
    // Fase 6 Layer 3 additions:
    overdueValidatedSat,
    ppdSinComplemento
  ] = await Promise.all([
    sb.from("company_profile")
      .select("name, pending_amount, overdue_amount, overdue_count, max_days_overdue, total_revenue, tier")
      .gt("overdue_amount", 0)
      .order("overdue_amount", { ascending: false })
      .limit(15),
    sb.from("odoo_account_payments")
      .select("company_id, amount, date, journal_name, payment_method")
      .eq("payment_type", "inbound")
      .order("date", { ascending: false })
      .limit(10),
    sb.from("odoo_invoices")
      .select("company_id, name, amount_total_mxn, amount_residual_mxn, days_overdue, due_date, payment_term")
      .eq("move_type", "in_invoice")
      .in("payment_state", ["not_paid", "partial"])
      .gt("days_overdue", 0)
      .order("days_overdue", { ascending: false })
      .limit(15),
    sb.from("odoo_account_payments")
      .select("company_id, amount, date, journal_name, payment_method")
      .eq("payment_type", "outbound")
      .order("date", { ascending: false })
      .limit(10),
    Promise.resolve(sb.rpc("cashflow_runway")).then((r: { data: unknown }) => r).catch(() => ({ data: null })),
    sb.from("payment_predictions")
      .select("company_name, tier, avg_days_to_pay, max_days_overdue, total_pending, payment_risk")
      .in("payment_risk", ["CRITICO: excede maximo historico", "ALTO: fuera de patron normal"])
      .order("total_pending", { ascending: false })
      .limit(10),
    // Fase 6 · cartera vencida con CFDI validado SAT
    sb.from("invoices_unified")
      .select("uuid_sat, odoo_ref, partner_name, odoo_amount_residual_mxn, days_overdue, company_id, invoice_date, due_date")
      .in("payment_state", ["not_paid", "partial"])
      .gt("days_overdue", 0)
      .not("uuid_sat", "is", null)
      .order("days_overdue", { ascending: false })
      .limit(15),
    // Fase 6 · pagos PPD sin complemento (riesgo IVA acreditable)
    sb.from("reconciliation_issues")
      .select("issue_id, description, company_id, detected_at, metadata")
      .eq("issue_type", "payment_missing_complemento")
      .is("resolved_at", null)
      .order("detected_at", { ascending: false })
      .limit(5),
  ]);

  const runway = runwayRes.data as Record<string, unknown> | null;

  return `${profileSection}## MODO: OPERATIVO (qué cobrar/pagar esta semana)
## NOTA FISCAL (Fase 6)
Cuando reportes revenue o CxC, separa "posted Y validado SAT" de "posted sin UUID".
Los números SAT son la foto que verá Hacienda.

## ALERTA CASH FLOW (runway)
${runway?.alerta ?? "Sin datos"}
Dias de runway: ${runway?.dias_runway ?? "?"} | Nomina mensual estimada: $${runway?.nomina_mensual_estimada ?? "?"}
Proyeccion 7d: ${safeJSON(runway?.proyeccion_7d)}
Proyeccion 15d: ${safeJSON(runway?.proyeccion_15d)}

## CARTERA VENCIDA POR EMPRESA
${safeJSON(overdueByCompany.data)}

## PREDICCION DE PAGO (clientes fuera de patrón)
${safeJSON(payPredictions.data)}

## COBROS RECIENTES
${safeJSON(inboundPayments.data)}

## FACTURAS PROVEEDOR VENCIDAS (lo que debemos ya)
${safeJSON(supplierOverdue.data)}

## PAGOS A PROVEEDORES (recientes)
${safeJSON(outboundPayments.data)}

## CARTERA VENCIDA CON CFDI VALIDADO SAT (Fase 6, top 15)
${safeJSON(overdueValidatedSat.data)}

## PAGOS PPD SIN COMPLEMENTO TIPO P (riesgo IVA acreditable, top 5)
${safeJSON(ppdSinComplemento.data)}`;
}

/**
 * MODO ESTRATÉGICO: la foto del mes y desvíos estructurales.
 * Foco: P&L, capital de trabajo, presupuesto vs real, anomalías.
 * 7 queries — análisis profundo + Layer 3 SAT.
 */
export async function buildFinancieroContextEstrategico(
  sb: SupabaseClient,
  profileSection: string
): Promise<string> {
  const [cfoDash, plReport, workingCap, bankBalances, anomalies, validationCoverage, revenueFiscalTrend, taxReturns12m] = await Promise.all([
    sb.from("cfo_dashboard").select("*").limit(1),
    sb.from("pl_estado_resultados").select("*").order("period", { ascending: false }).limit(6),
    sb.from("working_capital").select("*").limit(1),
    sb.from("odoo_bank_balances").select("name, journal_type, currency, current_balance").order("current_balance", { ascending: false }),
    sb.from("accounting_anomalies")
      .select("anomaly_type, severity, description, company_name, amount")
      .order("amount", { ascending: false })
      .limit(15),
    // Fase 6 · cobertura de validación SAT (ratio validated/posted por mes)
    Promise.resolve(sb.rpc("syntage_validation_coverage_by_month", { p_months: 6 }))
      .then((r: { data: unknown }) => r)
      .catch(() => ({ data: null })),
    // Fase 6: trend revenue fiscal 24 meses
    sb.from("syntage_revenue_fiscal_monthly")
      .select("month, revenue_mxn, gasto_mxn, cfdis_emitidos, cfdis_recibidos, clientes_unicos")
      .order("month", { ascending: false })
      .limit(24),
    // Fase 6: tax returns últimos 12 meses
    sb.from("syntage_tax_returns")
      .select("ejercicio, periodo, tipo_declaracion, impuesto, monto_pagado, fecha_presentacion")
      .gte("fecha_presentacion", new Date(Date.now() - 365 * 86400_000).toISOString())
      .order("fecha_presentacion", { ascending: false })
      .limit(24),
  ]);

  const dash = (cfoDash.data ?? [])[0] as Record<string, unknown> | undefined;
  const wc = ((workingCap.data ?? []) as Record<string, unknown>[])[0];
  const activeBanks = ((bankBalances.data ?? []) as Record<string, unknown>[]).filter(b => Number(b.current_balance ?? 0) !== 0);

  return `${profileSection}## MODO: ESTRATEGICO (foto del mes y desvios)
## NOTA FISCAL (Fase 6)
Cuando reportes revenue o CxC, separa "posted Y validado SAT" de "posted sin UUID".
Los números SAT son la foto que verá Hacienda.

## RESUMEN EJECUTIVO CFO
Efectivo total MXN (incluye USD a tipo de cambio): $${dash?.efectivo_total_mxn ?? "?"} | Solo MXN: $${dash?.efectivo_mxn ?? "?"} | Solo USD: $${dash?.efectivo_usd ?? "?"} | Deuda tarjetas: $${dash?.deuda_tarjetas ?? "?"} | Posición neta: $${dash?.posicion_neta ?? "?"} | CxC: $${dash?.cuentas_por_cobrar ?? "?"} | CxP: $${dash?.cuentas_por_pagar ?? "?"} | Cartera vencida: $${dash?.cartera_vencida ?? "?"} | Ventas 30d: $${dash?.ventas_30d ?? "?"} | Cobros 30d: $${dash?.cobros_30d ?? "?"}

## CAPITAL DE TRABAJO
Efectivo neto: $${wc?.efectivo_neto ?? "?"} | Capital de trabajo: $${wc?.capital_de_trabajo ?? "?"} | Ratio liquidez: ${wc?.ratio_liquidez ?? "?"}

## ESTADO DE RESULTADOS (P&L últimos 6 meses)
${safeJSON(plReport.data)}

## SALDOS BANCARIOS (solo cuentas con movimiento)
${safeJSON(activeBanks)}

## ANOMALIAS CONTABLES
${safeJSON(anomalies.data)}

## COBERTURA VALIDACIÓN SAT (Fase 6, ratio validated/posted 6m)
${safeJSON(validationCoverage.data)}

## TREND REVENUE FISCAL (Syntage · últimos 24 meses)
${safeJSON(revenueFiscalTrend.data)}

## DECLARACIONES SAT (últimos 12 meses)
${safeJSON(taxReturns12m.data)}`;
}
