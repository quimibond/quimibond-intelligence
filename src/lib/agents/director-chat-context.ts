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
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const DIRECTOR_SLUGS = [
  "comercial",
  "financiero",
  "compras",
  "costos",
  "operaciones",
  "riesgo",
  "equipo",
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
  const [ltvHealth, reorderRisk, top, crmLeads, clientOverdue, clientThreads] = await Promise.all([
    // NEW (Fase 7): customer_ltv_health — churn_risk_score + overdue_risk_score + LTV ranking
    sb.from("customer_ltv_health")
      .select("company_name, tier, ltv_mxn, revenue_12m, revenue_3m, trend_pct_vs_prior_quarters, churn_risk_score, overdue_risk_score, days_since_last_order, max_days_overdue")
      .gte("ltv_mxn", 100000)
      .order("churn_risk_score", { ascending: false })
      .limit(15),
    sb.from("client_reorder_predictions")
      .select("company_name, tier, avg_cycle_days, days_since_last, days_overdue_reorder, avg_order_value, reorder_status, salesperson_name, top_product_ref, total_revenue")
      .in("reorder_status", ["overdue", "at_risk", "critical", "lost"])
      .order("total_revenue", { ascending: false })
      .limit(12),
    sb.from("company_profile")
      .select("name, total_revenue, revenue_90d, trend_pct, total_orders, last_order_date, revenue_share_pct, tier, overdue_amount")
      .gt("total_revenue", 0)
      .order("total_revenue", { ascending: false })
      .limit(12),
    sb.from("odoo_crm_leads")
      .select("name, stage, expected_revenue, probability, assigned_user, days_open")
      .gt("expected_revenue", 0)
      .order("expected_revenue", { ascending: false })
      .limit(10),
    sb.from("company_profile")
      .select("name, total_revenue, overdue_amount, max_days_overdue, tier")
      .gt("overdue_amount", 50000)
      .order("overdue_amount", { ascending: false })
      .limit(10),
    sb.from("threads")
      .select("subject, last_sender, hours_without_response, company_id")
      .eq("last_sender_type", "external")
      .gt("hours_without_response", 24)
      .in("status", ["needs_response", "stalled"])
      .order("hours_without_response", { ascending: false })
      .limit(8),
  ]);
  return [
    `## LTV + churn risk score (>= 100K LTV, ordenado por churn_risk)\n${safeJSON(ltvHealth.data)}`,
    `## Reorden vencido (clientes que deberian haber comprado)\n${safeJSON(reorderRisk.data)}`,
    `## Top clientes (revenue y tendencia 90d)\n${safeJSON(top.data)}`,
    `## Pipeline CRM — oportunidades activas\n${safeJSON(crmLeads.data)}`,
    `## Clientes con cartera vencida\n${safeJSON(clientOverdue.data)}`,
    `## Emails de clientes sin respuesta >24h\n${safeJSON(clientThreads.data)}`,
  ].join("\n\n");
}

async function buildFinanciero(sb: SupabaseClient): Promise<string> {
  const [runway, cfoDash, overdue, payments, payPredictions, cashflow, pl, workingCapital, budget] = await Promise.all([
    // NEW (Fase 7): runway calculation con cash + AR/AP y burn rate 60d
    sb.from("financial_runway").select("*").limit(1),
    sb.from("cfo_dashboard").select("*").limit(1),
    sb.from("odoo_invoices")
      .select("company_id, name, amount_total_mxn, amount_residual_mxn, payment_state, days_overdue, due_date, invoice_date")
      .eq("move_type", "out_invoice")
      .in("payment_state", ["not_paid", "partial"])
      .gt("days_overdue", 0)
      .order("amount_residual_mxn", { ascending: false })
      .limit(20),
    sb.from("odoo_account_payments")
      .select("company_id, amount, date, journal_name, state, currency")
      .order("date", { ascending: false })
      .limit(15),
    sb.from("payment_predictions")
      .select("company_name, avg_days_to_pay, median_days_to_pay, max_days_overdue, payment_trend, payment_risk, total_pending, predicted_payment_date")
      .in("payment_risk", ["CRITICO: excede maximo historico", "ALTO: fuera de patron normal"])
      .order("total_pending", { ascending: false })
      .limit(10),
    sb.from("cashflow_projection").select("flow_type, period, gross_amount, net_amount, probability").order("sort_order"),
    sb.from("pl_estado_resultados").select("*").order("period", { ascending: false }).limit(3),
    sb.from("working_capital").select("*").limit(1),
    sb.from("budget_vs_actual").select("*").order("period", { ascending: false }).limit(12),
  ]);
  return [
    `## RUNWAY ejecutivo (cash + AR 30d - AP 30d / burn rate diario)\n${safeJSON(runway.data?.[0])}`,
    `## CFO Dashboard (snapshot ejecutivo)\n${safeJSON(cfoDash.data?.[0])}`,
    `## Cash flow proyectado\n${safeJSON(cashflow.data)}`,
    `## Working capital\n${safeJSON(workingCapital.data?.[0])}`,
    `## P&L estado de resultados (ultimos periodos)\n${safeJSON(pl.data)}`,
    `## Presupuesto vs real (ultimos 12 periodos)\n${safeJSON(budget.data)}`,
    `## Facturas vencidas (clientes)\n${safeJSON(overdue.data)}`,
    `## Clientes con patron de pago anormal\n${safeJSON(payPredictions.data)}`,
    `## Pagos recibidos recientes\n${safeJSON(payments.data)}`,
  ].join("\n\n");
}

async function buildCompras(sb: SupabaseClient): Promise<string> {
  const [herfindahl, recentPOs, priceAnomalies, weOwe, singleSource, supplierThreads, supplierMatrix] = await Promise.all([
    // NEW (Fase 7): concentracion Herfindahl por producto (single_source / very_high riesgo de sourcing)
    sb.from("supplier_concentration_herfindahl")
      .select("product_ref, product_name, supplier_count, herfindahl_idx, top_supplier_share_pct, top_supplier_name, total_spent_12m, concentration_level")
      .in("concentration_level", ["single_source", "very_high"])
      .order("total_spent_12m", { ascending: false })
      .limit(15),
    sb.from("odoo_purchase_orders")
      .select("company_id, name, amount_total_mxn, state, date_order, buyer_name")
      .order("date_order", { ascending: false })
      .limit(15),
    sb.from("purchase_price_intelligence")
      .select("product_ref, product_name, last_supplier, currency, avg_price, last_price, price_vs_avg_pct, price_change_pct, total_purchases, total_spent, price_flag, last_order_name")
      .in("price_flag", ["price_above_avg", "price_below_avg"])
      .order("total_spent", { ascending: false })
      .limit(15),
    sb.from("odoo_invoices")
      .select("company_id, name, amount_total_mxn, amount_residual_mxn, days_overdue, due_date")
      .eq("move_type", "in_invoice")
      .in("payment_state", ["not_paid", "partial"])
      .order("amount_residual_mxn", { ascending: false })
      .limit(15),
    sb.from("supplier_product_matrix")
      .select("supplier_name, product_ref, purchase_value, total_suppliers_for_product, pct_of_product_purchases")
      .eq("total_suppliers_for_product", 1)
      .order("purchase_value", { ascending: false })
      .limit(10),
    sb.from("threads")
      .select("subject, last_sender, hours_without_response, company_id")
      .gt("hours_without_response", 48)
      .in("status", ["needs_response", "stalled"])
      .order("hours_without_response", { ascending: false })
      .limit(8),
    sb.from("supplier_product_matrix")
      .select("supplier_name, product_ref, purchase_value, total_suppliers_for_product, last_purchase")
      .order("purchase_value", { ascending: false })
      .limit(15),
  ]);
  return [
    `## Concentracion Herfindahl por producto (single_source/very_high, 12m)\n${safeJSON(herfindahl.data)}`,
    `## OC recientes\n${safeJSON(recentPOs.data)}`,
    `## Facturas proveedor pendientes (lo que debemos)\n${safeJSON(weOwe.data)}`,
    `## Alertas de precio vs promedio\n${safeJSON(priceAnomalies.data)}`,
    `## Proveedor unico (single source)\n${safeJSON(singleSource.data)}`,
    `## Dependencia por producto\n${safeJSON(supplierMatrix.data)}`,
    `## Emails con proveedores sin respuesta >48h\n${safeJSON(supplierThreads.data)}`,
  ].join("\n\n");
}

async function buildCostos(sb: SupabaseClient): Promise<string> {
  const [belowCostLines, priceErosion, deadStock, purchasePrices, topProducts] = await Promise.all([
    sb.from("invoice_line_margins")
      .select("move_name, invoice_date, company_name, product_ref, quantity, price_unit, unit_cost, gross_margin_pct, below_cost, margin_total, discount")
      .order("margin_total", { ascending: true })
      .limit(15),
    sb.from("product_margin_analysis")
      .select("product_ref, company_name, avg_order_price, cost_price, gross_margin_pct, total_order_value")
      .lt("gross_margin_pct", 15)
      .not("gross_margin_pct", "is", null)
      .order("total_order_value", { ascending: false })
      .limit(15),
    sb.from("dead_stock_analysis")
      .select("product_ref, stock_qty, inventory_value, days_since_last_sale, historical_customers, standard_price")
      .order("inventory_value", { ascending: false })
      .limit(15),
    sb.from("purchase_price_intelligence")
      .select("product_ref, last_supplier, currency, avg_price, last_price, price_vs_avg_pct, total_spent")
      .eq("price_flag", "price_above_avg")
      .order("total_spent", { ascending: false })
      .limit(10),
    sb.from("odoo_products")
      .select("internal_ref, name, stock_qty, standard_price, list_price, avg_cost")
      .gt("stock_qty", 0)
      .order("stock_qty", { ascending: false })
      .limit(10),
  ]);
  return [
    `## Ventas bajo costo / margen <15% (eventos puntuales)\n${safeJSON(belowCostLines.data)}`,
    `## Productos con margen <15% agregado\n${safeJSON(priceErosion.data)}`,
    `## Inventario muerto (dinero atrapado)\n${safeJSON(deadStock.data)}`,
    `## Comprando mas caro que promedio (impacto en costos)\n${safeJSON(purchasePrices.data)}`,
    `## Productos con mas stock\n${safeJSON(topProducts.data)}`,
  ].join("\n\n");
}

async function buildOperaciones(sb: SupabaseClient): Promise<string> {
  const [otdWeekly, lateDeliveries, pendingDeliveries, orderpoints, deadStock, pendingPOs] = await Promise.all([
    // NEW (Fase 7): OTD rolling 12 semanas con avg lead days
    sb.from("ops_delivery_health_weekly")
      .select("week_start, total_completed, on_time, late, otd_pct, avg_lead_days")
      .order("week_start", { ascending: false })
      .limit(12),
    sb.from("odoo_deliveries")
      .select("company_id, name, state, is_late, scheduled_date, origin")
      .eq("is_late", true)
      .not("state", "in", '("done","cancel")')
      .order("scheduled_date", { ascending: true })
      .limit(15),
    sb.from("odoo_deliveries")
      .select("company_id, name, state, scheduled_date, origin")
      .not("state", "in", '("done","cancel")')
      .order("scheduled_date", { ascending: true })
      .limit(15),
    sb.from("odoo_orderpoints")
      .select("product_name, qty_on_hand, product_min_qty, qty_forecast, warehouse_name")
      .order("qty_on_hand", { ascending: true })
      .limit(15),
    sb.from("dead_stock_analysis")
      .select("product_ref, stock_qty, inventory_value, days_since_last_sale")
      .order("inventory_value", { ascending: false })
      .limit(10),
    sb.from("odoo_purchase_orders")
      .select("company_id, name, amount_total_mxn, date_order, buyer_name, state")
      .eq("state", "purchase")
      .order("date_order", { ascending: false })
      .limit(10),
  ]);
  return [
    `## OTD rate semanal rolling 12w\n${safeJSON(otdWeekly.data)}`,
    `## Entregas atrasadas\n${safeJSON(lateDeliveries.data)}`,
    `## Todas las entregas pendientes\n${safeJSON(pendingDeliveries.data)}`,
    `## Orderpoints: stock bajo\n${safeJSON(orderpoints.data)}`,
    `## Compras pendientes (material en camino)\n${safeJSON(pendingPOs.data)}`,
    `## Inventario muerto\n${safeJSON(deadStock.data)}`,
  ].join("\n\n");
}

async function buildRiesgo(sb: SupabaseClient): Promise<string> {
  const [narrativesRisk, payRisk, topClients, trends, unanswered, supplierWeOwe] = await Promise.all([
    sb.from("company_narrative")
      .select("canonical_name, tier, total_revenue, revenue_90d, trend_pct, overdue_amount, late_deliveries, complaints, recent_complaints, risk_signal, salespeople")
      .not("risk_signal", "is", null)
      .order("total_revenue", { ascending: false })
      .limit(12),
    sb.from("payment_predictions")
      .select("company_name, tier, avg_days_to_pay, max_days_overdue, payment_trend, payment_risk, total_pending")
      .in("payment_risk", ["CRITICO: excede maximo historico", "ALTO: fuera de patron normal"])
      .order("total_pending", { ascending: false })
      .limit(10),
    sb.from("company_profile")
      .select("name, total_revenue, revenue_share_pct, tier, overdue_amount")
      .order("total_revenue", { ascending: false })
      .limit(10),
    sb.from("weekly_trends")
      .select("company_name, tier, overdue_delta, late_delta, trend_signal")
      .not("trend_signal", "is", null)
      .order("overdue_delta", { ascending: false })
      .limit(10),
    sb.from("threads")
      .select("subject, last_sender, hours_without_response, account")
      .eq("last_sender_type", "external")
      .gt("hours_without_response", 72)
      .in("status", ["needs_response", "stalled"])
      .order("hours_without_response", { ascending: false })
      .limit(10),
    sb.from("accounting_anomalies")
      .select("anomaly_type, severity, description, company_name, amount")
      .eq("anomaly_type", "supplier_overdue")
      .order("amount", { ascending: false })
      .limit(10),
  ]);
  const rows = (topClients.data ?? []) as { total_revenue?: number }[];
  const totalRevenue = rows.reduce((s, c) => s + Number(c.total_revenue ?? 0), 0);
  const top5Revenue = rows.slice(0, 5).reduce((s, c) => s + Number(c.total_revenue ?? 0), 0);
  const concentrationPct = totalRevenue > 0 ? Math.round((top5Revenue / totalRevenue) * 100) : 0;
  return [
    `## Concentracion revenue: top 5 clientes = ${concentrationPct}% del total\n${safeJSON(rows.slice(0, 5))}`,
    `## Empresas con senales de alerta\n${safeJSON(narrativesRisk.data)}`,
    `## Clientes que exceden patron de pago\n${safeJSON(payRisk.data)}`,
    `## Proveedores a quienes debemos (riesgo relacion)\n${safeJSON(supplierWeOwe.data)}`,
    `## Tendencia semanal\n${safeJSON(trends.data)}`,
    `## Emails de clientes sin respuesta >72h\n${safeJSON(unanswered.data)}`,
  ].join("\n\n");
}

async function buildEquipo(sb: SupabaseClient): Promise<string> {
  const [workloadRows, employees, activities, stalledThreads, salesByPerson, overdueByCompany] = await Promise.all([
    // NEW (Fase 7): workload real por vendedor con stress score
    sb.from("salesperson_workload_30d")
      .select("salesperson_name, department, open_orders, open_order_value, orders_30d, revenue_30d, overdue_activities, overdue_activities_pct, workload_stress_score")
      .order("workload_stress_score", { ascending: false })
      .limit(20),
    sb.from("odoo_users")
      .select("name, email, department, pending_activities_count, overdue_activities_count")
      .order("overdue_activities_count", { ascending: false })
      .limit(15),
    sb.from("odoo_activities")
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
    sb.from("odoo_sale_orders")
      .select("salesperson_name, amount_total_mxn")
      .eq("state", "sale")
      .order("amount_total_mxn", { ascending: false })
      .limit(50),
    sb.from("company_profile")
      .select("name, total_revenue, overdue_amount, tier")
      .gt("overdue_amount", 10000)
      .order("overdue_amount", { ascending: false })
      .limit(15),
  ]);
  const workload: Record<string, { orders: number; totalValue: number }> = {};
  for (const o of (salesByPerson.data ?? []) as { salesperson_name?: string; amount_total_mxn?: number }[]) {
    const name = o.salesperson_name ?? "Sin asignar";
    if (!workload[name]) workload[name] = { orders: 0, totalValue: 0 };
    workload[name].orders++;
    workload[name].totalValue += Number(o.amount_total_mxn ?? 0);
  }
  const workloadSummary = Object.entries(workload)
    .sort((a, b) => b[1].totalValue - a[1].totalValue)
    .map(([name, d]) => `${name}: ${d.orders} ordenes abiertas ($${Math.round(d.totalValue / 1000)}K)`)
    .join("\n");
  return [
    `## Workload real por vendedor con stress score (open orders + revenue 30d + actividades vencidas)\n${safeJSON(workloadRows.data)}`,
    `## Carga de trabajo agrupada (legacy desde odoo_sale_orders)\n${workloadSummary || "(sin datos)"}`,
    `## Empleados con mas actividades vencidas\n${safeJSON(employees.data)}`,
    `## Actividades vencidas detalle\n${safeJSON(activities.data)}`,
    `## Emails externos sin respuesta >48h\n${safeJSON(stalledThreads.data)}`,
    `## Cartera vencida por cliente (responsabilidad cobro)\n${safeJSON(overdueByCompany.data)}`,
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
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `(Error cargando contexto de ${slug}: ${msg})`;
  }
}
