/**
 * Director chat context builder.
 *
 * Genera un resumen de datos por director (slug) para inyectar en `/api/chat`
 * cuando el CEO menciona `@<director>` en su pregunta. Es una version mas
 * ligera que `buildAgentContext` (orchestrate/route.ts ~1100 LOC) — limits
 * mas pequenos y subset de tablas mas estable para respuesta rapida del chat.
 *
 * La logica de queries es intencionalmente paralela al orchestrate pero
 * independiente: un bug aqui no puede tumbar a los directores cron.
 *
 * SP5 Task 18: all §12 legacy MV reads replaced with canonical/gold equivalents.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase-server";
import { fetchTopCustomers, fetchTopSuppliers } from "@/lib/queries/analytics/customer-360";
import { getCfoSnapshot, getPlHistory } from "@/lib/queries/analytics/finance";
import { listInbox } from "@/lib/queries/intelligence/inbox";

export const DIRECTOR_SLUGS = [
  "comercial",
  "financiero",
  "compras",
  "costos",
  "operaciones",
  "riesgo",
  "equipo",
  "compliance",
] as const;

export type DirectorSlug = (typeof DIRECTOR_SLUGS)[number];

export interface DirectorMeta {
  slug: DirectorSlug;
  label: string;
  department: string;
  /** Ejemplos de preguntas tipicas (para UI chips). */
  sampleQuestions: string[];
}

export const DIRECTOR_META: Record<DirectorSlug, DirectorMeta> = {
  comercial: {
    slug: "comercial",
    label: "Director Comercial",
    department: "Ventas",
    sampleQuestions: [
      "@comercial dame un reporte de ventas del mes",
      "@comercial clientes en riesgo de churn",
      "@comercial pipeline CRM y top oportunidades",
    ],
  },
  financiero: {
    slug: "financiero",
    label: "Director Financiero",
    department: "Finanzas",
    sampleQuestions: [
      "@financiero flujo de efectivo proyectado a 60 dias",
      "@financiero estado de cartera vencida por cliente",
      "@financiero P&L del mes y margen operativo",
    ],
  },
  compras: {
    slug: "compras",
    label: "Director de Compras",
    department: "Compras",
    sampleQuestions: [
      "@compras reporte de compras del mes por proveedor",
      "@compras materiales comprados mas caros que el promedio",
      "@compras facturas de proveedor pendientes de pagar",
    ],
  },
  costos: {
    slug: "costos",
    label: "Director de Costos",
    department: "Costos",
    sampleQuestions: [
      "@costos productos vendidos bajo costo ultimos 30d",
      "@costos inventario muerto con mas dinero atrapado",
      "@costos margen real por producto vs lista",
    ],
  },
  operaciones: {
    slug: "operaciones",
    label: "Director de Operaciones",
    department: "Operaciones",
    sampleQuestions: [
      "@operaciones entregas atrasadas y causas",
      "@operaciones stock critico y orderpoints",
      "@operaciones OTD del mes por almacen",
    ],
  },
  riesgo: {
    slug: "riesgo",
    label: "Director de Riesgo",
    department: "Riesgo",
    sampleQuestions: [
      "@riesgo concentracion de cartera top 5 clientes",
      "@riesgo contactos criticos con health score bajo",
      "@riesgo proveedores con los que tenemos deuda",
    ],
  },
  equipo: {
    slug: "equipo",
    label: "Director de Equipo",
    department: "Equipo",
    sampleQuestions: [
      "@equipo carga de trabajo por vendedor",
      "@equipo actividades vencidas por empleado",
      "@equipo cartera vencida por responsable",
    ],
  },
  compliance: {
    slug: "compliance",
    label: "Director de Cumplimiento Fiscal",
    department: "Cumplimiento",
    sampleQuestions: [
      "@compliance ¿estamos al corriente con el SAT?",
      "@compliance CFDIs emitidos sin respaldo en Odoo",
      "@compliance proveedores 69-B activos",
    ],
  },
};

export function isDirectorSlug(s: string): s is DirectorSlug {
  return (DIRECTOR_SLUGS as readonly string[]).includes(s);
}

/**
 * Detecta el primer `@<slug>` en el mensaje. Tolerante a mayusculas y a
 * acentos/puntuacion alrededor. Devuelve null si no hay mention valido.
 */
export function detectDirectorMention(message: string): DirectorSlug | null {
  const match = message.match(/@([a-z_]+)\b/i);
  if (!match) return null;
  const candidate = match[1].toLowerCase();
  return isDirectorSlug(candidate) ? candidate : null;
}

// ── Helpers ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeJSON(v: any): string {
  try {
    if (!v || (Array.isArray(v) && v.length === 0)) return "(sin datos)";
    const str = JSON.stringify(v, null, 0);
    return str.length > 6000 ? str.slice(0, 6000) + "...[truncado]" : str;
  } catch {
    return "(error formateando)";
  }
}

// ── Context builders por director ───────────────────────────────────────

async function buildComercial(sb: SupabaseClient): Promise<string> {
  const [topCustomers, topSuppliers, crmLeads, clientOverdue, clientThreads, cancelledPostedCfdi, fiscalLifetimeClients, clientCancelRates, inboxItems] = await Promise.all([
    // gold_company_360 — top clientes by LTV (replaces customer_ltv_health + company_profile)
    fetchTopCustomers({ limit: 12 }),
    // gold_company_360 — top suppliers
    fetchTopSuppliers({ limit: 5 }),
    // SP5-EXCEPTION: odoo_crm_leads Bronze — no canonical_crm_leads in SP4 scope
    sb.from("odoo_crm_leads") // SP5-EXCEPTION: Bronze odoo_crm_leads — no canonical equivalent yet
      .select("name, stage, expected_revenue, probability, assigned_user, days_open")
      .gt("expected_revenue", 0)
      .order("expected_revenue", { ascending: false })
      .limit(10),
    // canonical_invoices — clientes con cartera vencida (replaces company_profile overdue query)
    sb.from("canonical_invoices")
      .select("receptor_canonical_company_id, amount_residual_mxn_odoo, due_date_odoo, direction, payment_state_odoo")
      .eq("direction", "issued")
      .in("payment_state_odoo", ["not_paid", "partial"])
      .gt("amount_residual_mxn_odoo", 50000)
      .lt("due_date_odoo", new Date().toISOString().slice(0, 10))
      .order("amount_residual_mxn_odoo", { ascending: false })
      .limit(10),
    sb.from("threads")
      .select("subject, last_sender, hours_without_response, company_id")
      .eq("last_sender_type", "external")
      .gt("hours_without_response", 24)
      .in("status", ["needs_response", "stalled"])
      .order("hours_without_response", { ascending: false })
      .limit(8),
    // Fase 6: clientes que emitieron y cancelaron CFDIs
    sb.from("reconciliation_issues")
      .select("issue_id, description, metadata, company_id, detected_at")
      .eq("issue_type", "cancelled_but_posted")
      .is("resolved_at", null)
      .order("detected_at", { ascending: false })
      .limit(5),
    // Fase 6: top clientes fiscal histórico con YoY
    sb.from("syntage_top_clients_fiscal_lifetime") // SP5-EXCEPTION: Bronze syntage_ fiscal data — no canonical equivalent yet
      .select("rfc, name, lifetime_revenue_mxn, revenue_12m_mxn, yoy_pct, cancellation_rate_pct, days_since_last_cfdi, company_id")
      .order("lifetime_revenue_mxn", { ascending: false })
      .limit(20),
    // Fase 6: clientes con alto cancellation rate
    sb.from("syntage_client_cancellation_rates") // SP5-EXCEPTION: Bronze syntage_ fiscal data — no canonical equivalent yet
      .select("rfc, name, total_cfdis_24m, cancelados_24m, cancellation_rate_pct, cancelled_amount_mxn, company_id")
      .order("cancellation_rate_pct", { ascending: false })
      .limit(10),
    // gold_ceo_inbox — issues críticos abiertos
    listInbox({ limit: 5 }),
  ]);
  return [
    `## Top clientes (gold_company_360 — LTV + blacklist_level + overdue_amount_mxn)\n${safeJSON(topCustomers)}`,
    `## Clientes con cartera vencida >50K MXN (canonical_invoices)\n${safeJSON(clientOverdue.data)}`,
    `## Pipeline CRM — oportunidades activas\n${safeJSON(crmLeads.data)}`,
    `## Emails de clientes sin respuesta >24h\n${safeJSON(clientThreads.data)}`,
    `## CFDI CANCELADO EN SAT PERO POSTED EN ODOO (clientes, top 5)\n${safeJSON(cancelledPostedCfdi.data)}`,
    `## TOP 20 CLIENTES FISCAL HISTÓRICO (Syntage · 12 años, con YoY)\n${safeJSON(fiscalLifetimeClients.data)}`,
    `## CLIENTES CON CANCELLATION RATE ALTO (últimos 24m)\n${safeJSON(clientCancelRates.data)}`,
    `## Issues críticos abiertos (gold_ceo_inbox top 5)\n${safeJSON(inboxItems)}`,
    `## Top proveedores (gold_company_360)\n${safeJSON(topSuppliers)}`,
  ].join("\n\n");
}

async function buildFinanciero(sb: SupabaseClient): Promise<string> {
  const [cfoDash, cashflow, plHistory, workingCapital, openAR, openAP, inboxItems] = await Promise.all([
    // cfo_dashboard view was dropped (SP8); use the rebuilt canonical helper.
    getCfoSnapshot(),
    // gold_cashflow — replaces working_capital + financial_runway
    sb.from("gold_cashflow").select("*").maybeSingle(),
    // gold_pl_statement — replaces pl_estado_resultados (via helper)
    getPlHistory(6),
    // gold_cashflow working capital fields
    sb.from("gold_cashflow").select("current_cash_mxn, total_receivable_mxn, total_payable_mxn, working_capital_mxn, overdue_receivable_mxn").maybeSingle(),
    // canonical_invoices — open AR (replaces odoo_invoices out_invoice query)
    sb.from("canonical_invoices")
      .select("receptor_canonical_company_id, amount_residual_mxn_odoo, due_date_odoo, invoice_date, payment_state_odoo, sat_uuid")
      .eq("direction", "issued")
      .in("payment_state_odoo", ["not_paid", "partial"])
      .gt("amount_residual_mxn_odoo", 0)
      .lt("due_date_odoo", new Date().toISOString().slice(0, 10))
      .order("amount_residual_mxn_odoo", { ascending: false })
      .limit(20),
    // canonical_invoices — open AP (replaces odoo_invoices in_invoice query)
    sb.from("canonical_invoices")
      .select("emisor_canonical_company_id, amount_residual_mxn_odoo, due_date_odoo, invoice_date, payment_state_odoo, sat_uuid")
      .eq("direction", "received")
      .in("payment_state_odoo", ["not_paid", "partial"])
      .gt("amount_residual_mxn_odoo", 0)
      .order("amount_residual_mxn_odoo", { ascending: false })
      .limit(15),
    // gold_ceo_inbox — issues críticos
    listInbox({ limit: 5 }),
  ]);
  const cf = cashflow.data as Record<string, unknown> | null;
  return [
    `## CFO Dashboard (snapshot ejecutivo)\n${safeJSON(cfoDash)}`,
    `## Cash flow / working capital (gold_cashflow)\nEfectivo: $${cf?.current_cash_mxn ?? "?"} | CxC: $${cf?.total_receivable_mxn ?? "?"} | CxP: $${cf?.total_payable_mxn ?? "?"} | Capital trabajo: $${cf?.working_capital_mxn ?? "?"} | CxC vencida: $${cf?.overdue_receivable_mxn ?? "?"}`,
    `## P&L estado de resultados (gold_pl_statement · últimos 6 meses)\n${safeJSON(plHistory)}`,
    `## Facturas vencidas clientes (canonical_invoices issued, top 20)\n${safeJSON(openAR.data)}`,
    `## Facturas proveedor pendientes (canonical_invoices received, top 15)\n${safeJSON(openAP.data)}`,
    `## Issues críticos abiertos (gold_ceo_inbox top 5)\n${safeJSON(inboxItems)}`,
    `## Working capital detalle (gold_cashflow)\n${safeJSON(workingCapital.data)}`,
  ].join("\n\n");
}

async function buildCompras(sb: SupabaseClient): Promise<string> {
  const [topSuppliers, recentPOs, priceAnomalies, weOwe, singleSource, supplierThreads, gastoNoCapturado, fiscalLifetimeSuppliers] = await Promise.all([
    // gold_company_360 — top proveedores by LTV (replaces supplier_concentration_herfindahl + supplier_product_matrix)
    fetchTopSuppliers({ limit: 15 }),
    // canonical_purchase_orders — replaces odoo_purchase_orders
    sb.from("canonical_purchase_orders")
      .select("canonical_company_id, name, amount_total_mxn, state, date_order, buyer_canonical_contact_id")
      .order("date_order", { ascending: false })
      .limit(15),
    // SP5-VERIFIED: purchase_price_intelligence retained (§12 not in drop list)
    sb.from("purchase_price_intelligence")
      .select("product_ref, product_name, last_supplier, currency, avg_price, last_price, price_vs_avg_pct, price_change_pct, total_purchases, total_spent, price_flag, last_order_name")
      .in("price_flag", ["price_above_avg", "price_below_avg"])
      .order("total_spent", { ascending: false })
      .limit(15),
    // canonical_invoices — facturas proveedor pendientes (replaces odoo_invoices in_invoice query)
    sb.from("canonical_invoices")
      .select("emisor_canonical_company_id, amount_residual_mxn_odoo, due_date_odoo, invoice_date, payment_state_odoo, sat_uuid")
      .eq("direction", "received")
      .in("payment_state_odoo", ["not_paid", "partial"])
      .gt("amount_residual_mxn_odoo", 0)
      .order("amount_residual_mxn_odoo", { ascending: false })
      .limit(15),
    // canonical_order_lines — single-source products (replaces supplier_product_matrix single_source query)
    // TODO SP6: supplier_product_matrix dropped; approximate via canonical_order_lines
    // For now surface gold_company_360 supplier concentration via overdue_amount_mxn
    fetchTopSuppliers({ limit: 10 }),
    sb.from("threads")
      .select("subject, last_sender, hours_without_response, company_id")
      .gt("hours_without_response", 48)
      .in("status", ["needs_response", "stalled"])
      .order("hours_without_response", { ascending: false })
      .limit(8),
    // Fase 6: proveedores con gasto en SAT no capturado en Odoo
    sb.from("reconciliation_issues")
      .select("issue_id, description, metadata, company_id, detected_at")
      .eq("issue_type", "sat_only_cfdi_received")
      .is("resolved_at", null)
      .order("detected_at", { ascending: false })
      .limit(10),
    // Fase 6: top proveedores fiscal histórico
    sb.from("syntage_top_suppliers_fiscal_lifetime") // SP5-EXCEPTION: Bronze syntage_ fiscal data — no canonical equivalent yet
      .select("rfc, name, lifetime_spend_mxn, spend_12m_mxn, yoy_pct, retenciones_lifetime_mxn, days_since_last_cfdi, company_id")
      .order("lifetime_spend_mxn", { ascending: false })
      .limit(20),
  ]);
  return [
    `## Top proveedores (gold_company_360 — LTV + overdue)\n${safeJSON(topSuppliers)}`,
    `## OC recientes (canonical_purchase_orders)\n${safeJSON(recentPOs.data)}`,
    `## Facturas proveedor pendientes (canonical_invoices received)\n${safeJSON(weOwe.data)}`,
    `## Alertas de precio vs promedio (purchase_price_intelligence)\n${safeJSON(priceAnomalies.data)}`,
    `## Proveedor unico — concentracion (gold_company_360 suppliers top 10)\n${safeJSON(singleSource)}`,
    `## Emails con proveedores sin respuesta >48h\n${safeJSON(supplierThreads.data)}`,
    `## PROVEEDORES CON GASTO NO CAPTURADO EN SAT (top 10)\n${safeJSON(gastoNoCapturado.data)}`,
    `## TOP 20 PROVEEDORES FISCAL HISTÓRICO (Syntage · 12 años con retenciones)\n${safeJSON(fiscalLifetimeSuppliers.data)}`,
  ].join("\n\n");
}

async function buildCostos(sb: SupabaseClient): Promise<string> {
  const [belowCostLines, deadStock, purchasePrices, topProducts, productLineAnalysis, revenueMonthly] = await Promise.all([
    // SP5-VERIFIED: invoice_line_margins retained (§12 not in drop list)
    sb.from("invoice_line_margins")
      .select("move_name, invoice_date, company_name, product_ref, quantity, price_unit, unit_cost, gross_margin_pct, below_cost, margin_total, discount")
      .order("margin_total", { ascending: true })
      .limit(15),
    // SP5-VERIFIED: dead_stock_analysis retained (§12 not in drop list)
    sb.from("dead_stock_analysis")
      .select("product_ref, stock_qty, inventory_value, days_since_last_sale, historical_customers, standard_price")
      .order("inventory_value", { ascending: false })
      .limit(15),
    // SP5-VERIFIED: purchase_price_intelligence retained (§12 not in drop list)
    sb.from("purchase_price_intelligence")
      .select("product_ref, last_supplier, currency, avg_price, last_price, price_vs_avg_pct, total_spent")
      .eq("price_flag", "price_above_avg")
      .order("total_spent", { ascending: false })
      .limit(10),
    // canonical_products — replaces odoo_products
    sb.from("canonical_products")
      .select("internal_ref, display_name, current_stock_qty, standard_price, list_price")
      .gt("current_stock_qty", 0)
      .order("current_stock_qty", { ascending: false })
      .limit(10),
    // Fase 6: productos agregados desde 172K line items SAT
    sb.from("syntage_product_line_analysis") // SP5-EXCEPTION: Bronze syntage_ fiscal data — no canonical equivalent yet
      .select("clave_prod_serv, descripcion, revenue_mxn_aprox, total_lineas, precio_promedio_mxn, precio_stddev")
      .order("revenue_mxn_aprox", { ascending: false })
      .limit(20),
    // gold_revenue_monthly — revenue aggregated by month (replaces product_margin_analysis)
    sb.from("gold_revenue_monthly")
      .select("month_start, total_mxn, invoices, companies")
      .is("canonical_company_id", null)
      .order("month_start", { ascending: false })
      .limit(6),
  ]);
  return [
    `## Ventas bajo costo / margen negativo (invoice_line_margins)\n${safeJSON(belowCostLines.data)}`,
    `## Inventario muerto (dinero atrapado)\n${safeJSON(deadStock.data)}`,
    `## Comprando mas caro que promedio (purchase_price_intelligence)\n${safeJSON(purchasePrices.data)}`,
    `## Productos con mas stock (canonical_products)\n${safeJSON(topProducts.data)}`,
    `## Revenue mensual total (gold_revenue_monthly · 6m)\n${safeJSON(revenueMonthly.data)}`,
    `## TOP 20 PRODUCTOS POR REVENUE FISCAL (Syntage line items, 172K rows)\n${safeJSON(productLineAnalysis.data)}`,
  ].join("\n\n");
}

async function buildOperaciones(sb: SupabaseClient): Promise<string> {
  const [otdWeekly, lateDeliveries, pendingDeliveries, orderpoints, deadStock, pendingPOs] = await Promise.all([
    // SP5-VERIFIED: ops_delivery_health_weekly retained (§12 not in drop list)
    sb.from("ops_delivery_health_weekly")
      .select("week_start, total_completed, on_time, late, otd_pct, avg_lead_days")
      .order("week_start", { ascending: false })
      .limit(12),
    // canonical_deliveries — replaces odoo_deliveries is_late
    sb.from("canonical_deliveries")
      .select("canonical_company_id, name, state, is_late, scheduled_date, origin")
      .eq("is_late", true)
      .not("state", "in", '("done","cancel")')
      .order("scheduled_date", { ascending: true })
      .limit(15),
    // canonical_deliveries — replaces odoo_deliveries pending
    sb.from("canonical_deliveries")
      .select("canonical_company_id, name, state, scheduled_date, origin")
      .not("state", "in", '("done","cancel")')
      .order("scheduled_date", { ascending: true })
      .limit(15),
    // SP5-EXCEPTION: odoo_orderpoints Bronze — no canonical equivalent yet (stock.warehouse.orderpoint)
    sb.from("odoo_orderpoints") // SP5-EXCEPTION: Bronze odoo_orderpoints — no canonical_orderpoints in SP4 scope
      .select("product_name, qty_on_hand, product_min_qty, qty_forecast, warehouse_name")
      .order("qty_on_hand", { ascending: true })
      .limit(15),
    // SP5-VERIFIED: dead_stock_analysis retained (§12 not in drop list)
    sb.from("dead_stock_analysis")
      .select("product_ref, stock_qty, inventory_value, days_since_last_sale")
      .order("inventory_value", { ascending: false })
      .limit(10),
    // canonical_purchase_orders — replaces odoo_purchase_orders
    sb.from("canonical_purchase_orders")
      .select("canonical_company_id, name, amount_total_mxn, date_order, buyer_canonical_contact_id, state")
      .eq("state", "purchase")
      .order("date_order", { ascending: false })
      .limit(10),
  ]);
  return [
    `## OTD rate semanal rolling 12w\n${safeJSON(otdWeekly.data)}`,
    `## Entregas atrasadas (canonical_deliveries)\n${safeJSON(lateDeliveries.data)}`,
    `## Todas las entregas pendientes (canonical_deliveries)\n${safeJSON(pendingDeliveries.data)}`,
    `## Orderpoints: stock bajo\n${safeJSON(orderpoints.data)}`,
    `## Compras pendientes (canonical_purchase_orders)\n${safeJSON(pendingPOs.data)}`,
    `## Inventario muerto\n${safeJSON(deadStock.data)}`,
  ].join("\n\n");
}

async function buildRiesgo(sb: SupabaseClient): Promise<string> {
  const [topClients, topSuppliers, revenueMonthly, reconciliationHealth, payRisk, unanswered, supplierWeOwe, fiscalIssuesOpen, fiscalBlacklist, fiscalConcentration, inboxItems] = await Promise.all([
    // gold_company_360 — replaces company_narrative + company_profile
    fetchTopCustomers({ limit: 10 }),
    fetchTopSuppliers({ limit: 10 }),
    // gold_revenue_monthly — revenue trend (replaces monthly_revenue_trend)
    sb.from("gold_revenue_monthly")
      .select("month_start, total_mxn, invoices, companies")
      .is("canonical_company_id", null)
      .order("month_start", { ascending: false })
      .limit(12),
    // gold_reconciliation_health — reconciliation KPIs
    sb.from("gold_reconciliation_health").select("*").maybeSingle(),
    // SP5-VERIFIED: payment_predictions retained (§12 not in drop list)
    sb.from("payment_predictions")
      .select("company_name, tier, avg_days_to_pay, max_days_overdue, payment_trend, payment_risk, total_pending")
      .in("payment_risk", ["CRITICO: excede maximo historico", "ALTO: fuera de patron normal"])
      .order("total_pending", { ascending: false })
      .limit(10),
    sb.from("threads")
      .select("subject, last_sender, hours_without_response, account")
      .eq("last_sender_type", "external")
      .gt("hours_without_response", 72)
      .in("status", ["needs_response", "stalled"])
      .order("hours_without_response", { ascending: false })
      .limit(10),
    // SP5-VERIFIED: accounting_anomalies retained (§12 not in drop list)
    sb.from("accounting_anomalies")
      .select("anomaly_type, severity, description, company_name, amount")
      .eq("anomaly_type", "supplier_overdue")
      .order("amount", { ascending: false })
      .limit(10),
    // Fase 6: issues fiscales críticos/high open
    sb.from("reconciliation_issues")
      .select("issue_id, issue_type, severity, description, company_id, detected_at")
      .in("severity", ["critical", "high"])
      .is("resolved_at", null)
      .order("detected_at", { ascending: false })
      .limit(10),
    // Fase 6: partner_blacklist_69b (es issue_type, no tabla)
    sb.from("reconciliation_issues")
      .select("issue_id, description, metadata, company_id, detected_at")
      .eq("issue_type", "partner_blacklist_69b")
      .is("resolved_at", null)
      .order("detected_at", { ascending: false }),
    // Fase 6: concentración fiscal — top 10 clientes como % del revenue total
    sb.from("syntage_top_clients_fiscal_lifetime") // SP5-EXCEPTION: Bronze syntage_ fiscal data — no canonical equivalent yet
      .select("rfc, name, lifetime_revenue_mxn, revenue_12m_mxn, yoy_pct")
      .order("revenue_12m_mxn", { ascending: false })
      .limit(10),
    // gold_ceo_inbox — issues críticos priorizados
    listInbox({ limit: 10 }),
  ]);

  const rows = topClients as Array<{ lifetime_value_mxn?: number; display_name?: string }>;
  const totalLtv = rows.reduce((s, c) => s + Number(c.lifetime_value_mxn ?? 0), 0);
  const top5Ltv = rows.slice(0, 5).reduce((s, c) => s + Number(c.lifetime_value_mxn ?? 0), 0);
  const concentrationPct = totalLtv > 0 ? Math.round((top5Ltv / totalLtv) * 100) : 0;
  return [
    `## CONCENTRACIÓN FISCAL REAL (Syntage · top 10 clientes últimos 12m por revenue fiscal)\n${safeJSON(fiscalConcentration.data)}`,
    `## Concentracion LTV: top 5 clientes = ${concentrationPct}% del total (gold_company_360)\n${safeJSON(rows.slice(0, 5))}`,
    `## Top clientes por LTV (gold_company_360)\n${safeJSON(topClients)}`,
    `## Clientes que exceden patron de pago\n${safeJSON(payRisk.data)}`,
    `## Proveedores a quienes debemos (riesgo relacion)\n${safeJSON(supplierWeOwe.data)}`,
    `## Revenue mensual trend (gold_revenue_monthly)\n${safeJSON(revenueMonthly.data)}`,
    `## Reconciliacion salud (gold_reconciliation_health)\n${safeJSON(reconciliationHealth.data)}`,
    `## Emails de clientes sin respuesta >72h\n${safeJSON(unanswered.data)}`,
    // Fase 6: exposición fiscal
    `## EXPOSICIÓN FISCAL SAT — issues critical/high abiertos\n${safeJSON(fiscalIssuesOpen.data)}`,
    `## PARTNER BLACKLIST 69-B (open)\n${safeJSON(fiscalBlacklist.data)}`,
    `## Issues críticos (gold_ceo_inbox top 10)\n${safeJSON(inboxItems)}`,
    `## Top proveedores (gold_company_360)\n${safeJSON(topSuppliers)}`,
  ].join("\n\n");
}

async function buildEquipo(sb: SupabaseClient): Promise<string> {
  const [workloadRows, employees, activities, stalledThreads, salesByPerson, overdueByCompany] = await Promise.all([
    // SP5-VERIFIED: salesperson_workload_30d retained (§12 not in drop list)
    sb.from("salesperson_workload_30d")
      .select("salesperson_name, department, open_orders, open_order_value, orders_30d, revenue_30d, overdue_activities, overdue_activities_pct, workload_stress_score")
      .order("workload_stress_score", { ascending: false })
      .limit(20),
    // canonical_employees — replaces odoo_users
    sb.from("canonical_employees")
      .select("display_name, department_name, odoo_user_id, manager_canonical_contact_id")
      .limit(15),
    // SP5-EXCEPTION: odoo_activities Bronze — no canonical_activities in SP4 scope
    sb.from("odoo_activities") // SP5-EXCEPTION: Bronze odoo_activities — no canonical equivalent yet
      .select("assigned_to, activity_type, is_overdue, summary")
      .eq("is_overdue", true)
      .order("assigned_to")
      .limit(20),
    sb.from("threads")
      .select("subject, last_sender, hours_without_response, account, company_id")
      .eq("last_sender_type", "external")
      .gt("hours_without_response", 48)
      .in("status", ["needs_response", "stalled"])
      .order("hours_without_response", { ascending: false })
      .limit(10),
    // canonical_sale_orders — replaces odoo_sale_orders
    sb.from("canonical_sale_orders")
      .select("salesperson_canonical_contact_id, amount_total_mxn")
      .eq("state", "sale")
      .order("amount_total_mxn", { ascending: false })
      .limit(50),
    // gold_company_360 — clientes con cartera vencida (replaces company_profile overdue)
    fetchTopCustomers({ limit: 15 }),
  ]);
  const workload: Record<string, { orders: number; totalValue: number }> = {};
  for (const o of (salesByPerson.data ?? []) as { salesperson_canonical_contact_id?: number; amount_total_mxn?: number }[]) {
    const name = String(o.salesperson_canonical_contact_id ?? "Sin asignar");
    if (!workload[name]) workload[name] = { orders: 0, totalValue: 0 };
    workload[name].orders++;
    workload[name].totalValue += Number(o.amount_total_mxn ?? 0);
  }
  const workloadSummary = Object.entries(workload)
    .sort((a, b) => b[1].totalValue - a[1].totalValue)
    .map(([name, d]) => `contact_id ${name}: ${d.orders} ordenes abiertas ($${Math.round(d.totalValue / 1000)}K)`)
    .join("\n");
  return [
    `## Workload real por vendedor con stress score (open orders + revenue 30d + actividades vencidas)\n${safeJSON(workloadRows.data)}`,
    `## Carga de trabajo agrupada (canonical_sale_orders)\n${workloadSummary || "(sin datos)"}`,
    `## Empleados (canonical_employees)\n${safeJSON(employees.data)}`,
    `## Actividades vencidas detalle\n${safeJSON(activities.data)}`,
    `## Emails externos sin respuesta >48h\n${safeJSON(stalledThreads.data)}`,
    `## Top clientes por LTV con overdue (gold_company_360)\n${safeJSON(overdueByCompany)}`,
  ].join("\n\n");
}

async function buildCompliance(sb: SupabaseClient): Promise<string> {
  const [criticalIssues, summary, blacklist, taxStatus, ppdSinComp, cancelledPosted, complianceRevenueTrend, complianceTaxReturns] = await Promise.all([
    sb.from("reconciliation_issues")
      .select("issue_id, issue_type, severity, description, company_id, detected_at")
      .eq("severity", "critical")
      .is("resolved_at", null)
      .order("detected_at", { ascending: false })
      .limit(15),
    sb.rpc("get_syntage_reconciliation_summary"),
    sb.from("reconciliation_issues")
      .select("issue_id, description, metadata")
      .eq("issue_type", "partner_blacklist_69b")
      .is("resolved_at", null),
    sb.from("syntage_tax_status") // SP5-EXCEPTION: Bronze syntage_ fiscal data — no canonical equivalent yet
      .select("opinion_cumplimiento, fecha_consulta, regimen_fiscal")
      .order("fecha_consulta", { ascending: false, nullsFirst: false })
      .limit(1),
    sb.from("reconciliation_issues")
      .select("issue_id, description, company_id, detected_at")
      .eq("issue_type", "payment_missing_complemento")
      .is("resolved_at", null)
      .order("detected_at", { ascending: false })
      .limit(10),
    sb.from("reconciliation_issues")
      .select("issue_id, description, company_id, detected_at")
      .eq("issue_type", "cancelled_but_posted")
      .is("resolved_at", null)
      .order("detected_at", { ascending: false })
      .limit(10),
    // Fase 6: trend revenue fiscal compliance
    sb.from("syntage_revenue_fiscal_monthly") // SP5-EXCEPTION: Bronze syntage_ fiscal data — no canonical equivalent yet
      .select("month, revenue_mxn, gasto_mxn, iva_trasladado_mxn, retenciones_mxn, cancelados")
      .order("month", { ascending: false })
      .limit(12),
    // Fase 6: tax returns últimos 12 meses
    sb.from("syntage_tax_returns") // SP5-EXCEPTION: Bronze syntage_ fiscal data — no canonical equivalent yet
      .select("ejercicio, periodo, tipo_declaracion, impuesto, monto_pagado, fecha_presentacion")
      .gte("fecha_presentacion", new Date(Date.now() - 365 * 86400_000).toISOString())
      .order("fecha_presentacion", { ascending: false })
      .limit(30),
  ]);
  return [
    `## Resumen fiscal global (get_syntage_reconciliation_summary)\n${safeJSON(summary.data)}`,
    `## Opinión SAT / 32-D — última consulta\n${safeJSON(taxStatus.data)}`,
    `## Issues críticos abiertos (top 15)\n${safeJSON(criticalIssues.data)}`,
    `## Partner blacklist 69-B (open)\n${safeJSON(blacklist.data)}`,
    `## Pagos PPD sin complemento tipo P (top 10)\n${safeJSON(ppdSinComp.data)}`,
    `## CFDI cancelado en SAT / posted en Odoo (top 10)\n${safeJSON(cancelledPosted.data)}`,
    `## TREND FISCAL REVENUE/GASTO (últimos 12 meses)\n${safeJSON(complianceRevenueTrend.data)}`,
    `## DECLARACIONES SAT PRESENTADAS (últimos 12 meses)\n${safeJSON(complianceTaxReturns.data)}`,
  ].join("\n\n");
}

/**
 * Construye el bloque de contexto para un director dado. Si alguna query
 * individual falla, se reemplaza con "(error)" pero la funcion no lanza —
 * el chat debe seguir respondiendo con el contexto parcial disponible.
 */
export async function buildDirectorChatContext(
  sb: SupabaseClient,
  slug: DirectorSlug
): Promise<string> {
  try {
    switch (slug) {
      case "comercial": return await buildComercial(sb);
      case "financiero": return await buildFinanciero(sb);
      case "compras": return await buildCompras(sb);
      case "costos": return await buildCostos(sb);
      case "operaciones": return await buildOperaciones(sb);
      case "riesgo": return await buildRiesgo(sb);
      case "equipo": return await buildEquipo(sb);
      case "compliance": return await buildCompliance(sb);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `(Error cargando contexto de ${slug}: ${msg})`;
  }
}

// Re-export getServiceClient so callers that create their own sb can use the shared instance
export { getServiceClient };
