// src/lib/agents/financiero-context.ts
import type { SupabaseClient } from "@supabase/supabase-js";

function safeJSON(v: unknown): string {
  try { return JSON.stringify(v, null, 2); } catch { return "[]"; }
}

/**
 * MODO OPERATIVO: lo que debe pasar ESTA SEMANA.
 * Foco: cartera vencida, cobros, pagos, runway.
 * 6 queries — contexto chico y accionable.
 */
export async function buildFinancieroContextOperativo(
  sb: SupabaseClient,
  profileSection: string
): Promise<string> {
  const [overdueByCompany, inboundPayments, supplierOverdue, outboundPayments, runwayRes, payPredictions] = await Promise.all([
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
  ]);

  const runway = runwayRes.data as Record<string, unknown> | null;

  return `${profileSection}## MODO: OPERATIVO (qué cobrar/pagar esta semana)
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
${safeJSON(outboundPayments.data)}`;
}

/**
 * MODO ESTRATÉGICO: la foto del mes y desvíos estructurales.
 * Foco: P&L, capital de trabajo, presupuesto vs real, anomalías.
 * 6 queries — análisis profundo.
 */
export async function buildFinancieroContextEstrategico(
  sb: SupabaseClient,
  profileSection: string
): Promise<string> {
  const [cfoDash, plReport, workingCap, bankBalances, anomalies, budgetVsActual] = await Promise.all([
    sb.from("cfo_dashboard").select("*").limit(1),
    sb.from("pl_estado_resultados").select("*").order("period", { ascending: false }).limit(6),
    sb.from("working_capital").select("*").limit(1),
    sb.from("odoo_bank_balances").select("name, journal_type, currency, current_balance").order("current_balance", { ascending: false }),
    sb.from("accounting_anomalies")
      .select("anomaly_type, severity, description, company_name, amount")
      .order("amount", { ascending: false })
      .limit(15),
    sb.from("budget_vs_actual")
      .select("*")
      .order("period", { ascending: false })
      .limit(30),
  ]);

  const dash = (cfoDash.data ?? [])[0] as Record<string, unknown> | undefined;
  const wc = ((workingCap.data ?? []) as Record<string, unknown>[])[0];
  const activeBanks = ((bankBalances.data ?? []) as Record<string, unknown>[]).filter(b => Number(b.current_balance ?? 0) !== 0);

  return `${profileSection}## MODO: ESTRATEGICO (foto del mes y desvios)
## RESUMEN EJECUTIVO CFO
Efectivo disponible: $${dash?.efectivo_disponible ?? "?"} | Deuda tarjetas: $${dash?.deuda_tarjetas ?? "?"} | Posición neta: $${dash?.posicion_neta ?? "?"} | CxC: $${dash?.cuentas_por_cobrar ?? "?"} | CxP: $${dash?.cuentas_por_pagar ?? "?"} | Cartera vencida: $${dash?.cartera_vencida ?? "?"} | Ventas 30d: $${dash?.ventas_30d ?? "?"} | Cobros 30d: $${dash?.cobros_30d ?? "?"}

## CAPITAL DE TRABAJO
Efectivo neto: $${wc?.efectivo_neto ?? "?"} | Capital de trabajo: $${wc?.capital_de_trabajo ?? "?"} | Ratio liquidez: ${wc?.ratio_liquidez ?? "?"}

## ESTADO DE RESULTADOS (P&L últimos 6 meses)
${safeJSON(plReport.data)}

## SALDOS BANCARIOS (solo cuentas con movimiento)
${safeJSON(activeBanks)}

## PRESUPUESTO VS REAL (desvíos por cuenta contable)
${safeJSON(budgetVsActual.data)}

## ANOMALIAS CONTABLES
${safeJSON(anomalies.data)}`;
}
