/**
 * SP13 Ventas barrel — single import path for the page composition.
 *
 * The actual queries live in `operational/sales.ts` and `analytics/`; this
 * barrel just re-exports them with consistent naming so that
 * /ventas/page.tsx can import from one place — same convention as
 * `sp13/cobranza`.
 *
 * Schema audit 2026-04-25 (against database.types.ts):
 * - All helpers below read canonical_* + gold_* + KEEP-listed views.
 * - Known `customer_cohorts` MV is read by getCustomerCohorts but not in
 *   the typed schema; flagged as TODO SP6 in analytics/index.ts.
 */

export {
  getSalesKpis,
  getSalesRevenueTrend,
  getReorderRiskPage,
  getTopCustomersPage,
  getTopSalespeople,
  getSaleOrdersPage,
  getSaleOrdersTimeline,
  getSaleOrderSalespeopleOptions,
  type SalesKpis,
  type RevenueTrendPoint,
  type ReorderRiskRow,
  type TopCustomerRow,
  type SalespersonRow,
  type RecentSaleOrder,
} from "@/lib/queries/operational/sales";

export {
  getCustomerCohorts,
  type CohortMatrix,
} from "@/lib/queries/analytics";
