Now I have everything I need. The chat page has no server queries (it's a client-only component). Let me produce the final inventory.

---

# Data Coverage Inventory — Quimibond Intelligence Frontend

## Part 1 — Page → Query function map

| Page | Page file (path:line) | Query function called | Parameters / filters |
|---|---|---|---|
| `/` (CEO Dashboard) | `src/app/page.tsx:127` | `getDashboardKpis()` | — |
| `/` | `src/app/page.tsx:195` | `getDashboardKpis()` | — (re-called inside `<Kpis>`) |
| `/` | `src/app/page.tsx:319` | `getActiveTripwires()` | — |
| `/` | `src/app/page.tsx:375` | `getRevenueTrend(12)` | months=12 |
| `/` | `src/app/page.tsx:390` | `getInsights({state:"new",limit:20})` | state=new, limit=20 |
| `/` | `src/app/page.tsx:462` | `getDashboardKpis()` | — |
| `/` | `src/app/page.tsx:463` | `getTopAtRiskClients(5)` | limit=5 |
| `/agents` | `src/app/agents/page.tsx:72` | `getAgentEffectiveness()` | — |
| `/agents` | `src/app/agents/page.tsx:123` | `getAgentEffectiveness()` | — |
| `/agents/[slug]` | `src/app/agents/[slug]/page.tsx:52,62` | `getAgentBySlug(slug)` | slug |
| `/agents/[slug]` | `src/app/agents/[slug]/page.tsx:297` | `getInsights({state:["new","seen","acted_on","dismissed"],limit:30})` | then filter by agent_id |
| `/agents/[slug]` | `src/app/agents/[slug]/page.tsx:424` | `getAgentRuns(agentId,20)` | agentId, limit=20 |
| `/agents/[slug]` | `src/app/agents/[slug]/page.tsx:473` | `getAgentMemory(agentId,30)` | agentId, limit=30 |
| `/briefings` | `src/app/briefings/page.tsx` | — (redirect to `/briefings/comercial`) | — |
| `/briefings/[director]` | `src/app/briefings/[director]/page.tsx:124` | `getDirectorBriefing(director,maxCompanies)` | director slug, maxCompanies 1-15 |
| `/chat` | `src/app/chat/page.tsx` | — (client-only; no server queries from `@/lib/queries/*`) | N/A |
| `/cobranza` | `src/app/cobranza/page.tsx:303` | `getCfoSnapshot()` | — |
| `/cobranza` | `src/app/cobranza/page.tsx:304` | `getPaymentRiskKpis()` | — |
| `/cobranza` | `src/app/cobranza/page.tsx:384` | `getCollectionEffectiveness(12)` | months=12 |
| `/cobranza` | `src/app/cobranza/page.tsx:481` | `getArAging()` | — |
| `/cobranza` | `src/app/cobranza/page.tsx:660` | `getPaymentPredictionsPage(params)` | facets risk, trend, sort, page, size, q |
| `/cobranza` | `src/app/cobranza/page.tsx:847` | `getCompanyAgingPage(params)` | facet tier, sort, page, size, q |
| `/cobranza` | `src/app/cobranza/page.tsx:1018` | `getOverdueSalespeopleOptions()` | — |
| `/cobranza` | `src/app/cobranza/page.tsx:1063` | `getOverdueInvoicesPage(params)` | facets bucket, salesperson, date range, sort, page, size |
| `/companies` | `src/app/companies/page.tsx:190` | `getRfmSegmentSummary()` | — |
| `/companies` | `src/app/companies/page.tsx:343-345` | `getRfmSegments("AT_RISK"\|"NEED_ATTENTION"\|"HIBERNATING", 100)` | 3 parallel calls |
| `/companies` | `src/app/companies/page.tsx:546` | `getCompaniesPage(params)` | facets tier, risk, sort, page, size, q |
| `/companies/[id]` | `src/app/companies/[id]/page.tsx:69,87` | `getCompanyDetail(id)` | id |
| `/companies/[id]` | `src/app/companies/[id]/page.tsx:353` | `getCompanyEvidencePack(id)` | companyId |
| `/companies/[id]` | `src/app/companies/[id]/page.tsx:465` | `getCompanyInvoicesPage(companyId,params)` | companyId, sort, page, size |
| `/companies/[id]` | `src/app/companies/[id]/page.tsx:582` | `getCompanyOrdersPage(companyId,params)` | companyId, sort, page, size |
| `/companies/[id]` | `src/app/companies/[id]/page.tsx:700` | `getCompanyDeliveriesPage(companyId,params)` | companyId, sort, page, size |
| `/companies/[id]` | `src/app/companies/[id]/page.tsx:801` | `getCompanyTopProducts(companyId,15)` | companyId, limit=15 |
| `/companies/[id]` | `src/app/companies/[id]/page.tsx:873` | `getCompanyActivities(companyId,15)` | companyId, limit=15 |
| `/companies/at-risk` | `src/app/companies/at-risk/page.tsx` | — (redirect to `/companies#reactivacion`) | — |
| `/compras` | `src/app/compras/page.tsx:356` | `getPurchasesKpis()` | — |
| `/compras` | `src/app/compras/page.tsx:490` | `getSingleSourceRiskPage(params)` | facet level, sort, page, size, q |
| `/compras` | `src/app/compras/page.tsx:730` | `getPriceAnomaliesPage(params)` | facet flag, date range, sort, page, size, q |
| `/compras` | `src/app/compras/page.tsx:872` | `getTopSuppliersPage(params)` | sort, page, size, q |
| `/compras` | `src/app/compras/page.tsx:980` | `getPurchaseBuyerOptions()` | — |
| `/compras` | `src/app/compras/page.tsx:1020` | `getPurchaseOrdersPage(params)` | facets state, buyer, date range, sort, page, size, q |
| `/compras` | `src/app/compras/page.tsx:1217` | `getStockoutQueue(undefined,50)` | limit=50 |
| `/compras` | `src/app/compras/page.tsx:1397-1400` | `getSupplierPriceAlerts("overpriced"/"above_market"/"below_market",6,N)` | 3 parallel calls |
| `/compras/costos-bom` | `src/app/compras/costos-bom/page.tsx:557` | `getBomCostSummary()` | — |
| `/compras/costos-bom` | `src/app/compras/costos-bom/page.tsx:628` | `getSuspiciousBoms(30)` | limit=30 |
| `/compras/costos-bom` | `src/app/compras/costos-bom/page.tsx:687` | `getBomsMissingComponents(30)` | limit=30 |
| `/compras/costos-bom` | `src/app/compras/costos-bom/page.tsx:738` | `getTopRevenueBoms(30)` | limit=30 |
| `/compras/costos-bom` | `src/app/compras/costos-bom/page.tsx:929` | `getUomMismatchProducts(30)` | limit=30 |
| `/compras/costos-bom` | `src/app/compras/costos-bom/page.tsx:1061` | `getBomDuplicates(30)` | limit=30 |
| `/compras/costos-bom` | `src/app/compras/costos-bom/page.tsx:1117` | `getBomsWithMultipleVersions(30)` | limit=30 |
| `/compras/price-variance` | `src/app/compras/price-variance/page.tsx` | — (redirect) | — |
| `/compras/stockouts` | `src/app/compras/stockouts/page.tsx` | — (redirect) | — |
| `/contacts` | `src/app/contacts/page.tsx:296` | `getContactsKpis()` | — |
| `/contacts` | `src/app/contacts/page.tsx:341` | `getContactsPage(params)` | facets risk, type, sort, page, size, q |
| `/contacts/[id]` | `src/app/contacts/[id]/page.tsx:56,66` | `getContactDetail(id)` | id |
| `/equipo` | `src/app/equipo/page.tsx:155` | `getTeamKpis()` | — |
| `/equipo` | `src/app/equipo/page.tsx:262` | `getUserBacklog(30)` | limit=30 |
| `/equipo` | `src/app/equipo/page.tsx:365` | `getInsightsByDepartment()` | — |
| `/equipo` | `src/app/equipo/page.tsx:401` | `getDepartments()` | — |
| `/equipo` | `src/app/equipo/page.tsx:479` | `getEmployees(150)` | limit=150 |
| `/finanzas` | `src/app/finanzas/page.tsx:287` | `getFinancialRunway()` | — |
| `/finanzas` | `src/app/finanzas/page.tsx:341` | `getCfoSnapshot()` | — |
| `/finanzas` | `src/app/finanzas/page.tsx:398` | `getCfoSnapshot()` | — (flow section) |
| `/finanzas` | `src/app/finanzas/page.tsx:445` | `getWorkingCapital()` | — |
| `/finanzas` | `src/app/finanzas/page.tsx:483` | `getPlHistory(12)` | months=12 |
| `/finanzas` | `src/app/finanzas/page.tsx:544` | `getCashPosition()` | — |
| `/finanzas` | `src/app/finanzas/page.tsx:623` | `getWorkingCapitalCycle()` | — |
| `/finanzas` | `src/app/finanzas/page.tsx:732` | `getProjectedCashFlow()` | — (view + RPC) |
| `/finanzas` | `src/app/finanzas/page.tsx:1082` | `getCashflowRecommendations()` | — |
| `/finanzas` | `src/app/finanzas/page.tsx:1099-1102` | `getPartnerPaymentProfiles("inbound",0.5,25)`, `getPartnerPaymentProfiles("outbound",0.5,25)`, `getJournalFlowProfiles()`, `getAccountPaymentProfiles()` | 4 parallel |
| `/inbox` | `src/app/inbox/page.tsx:102` | `getInsightCounts()` | — |
| `/inbox` | `src/app/inbox/page.tsx:215` | `getInsights({state,severity,limit:150})` | state array, severity, limit=150 |
| `/inbox/insight/[id]` | `src/app/inbox/insight/[id]/page.tsx:37,50` | `getInsightById(id)` | id |
| `/inbox/insight/[id]` | `src/app/inbox/insight/[id]/page.tsx:278,292` | `getCompanyEvidencePack(companyId)` | companyId (2 calls for timeline + pack) |
| `/inbox/insight/[id]` (via `InvoiceDetailView`) | `src/components/shared/v2/InvoiceDetailView` | `getInvoiceByName(reference)` | invoice name |
| `/operaciones` | `src/app/operaciones/page.tsx:211` | `getOperationsKpis()` | — |
| `/operaciones` | `src/app/operaciones/page.tsx:263` | `getWeeklyTrend(12)` | weeks=12 |
| `/operaciones` | `src/app/operaciones/page.tsx:376` | `getDeliveriesPage(params)` | facets state, picking_type, late, date range, sort, page, size, q |
| `/operaciones` | `src/app/operaciones/page.tsx:580` | `getManufacturingAssigneeOptions()` | — |
| `/operaciones` | `src/app/operaciones/page.tsx:620` | `getManufacturingPage(params)` | facets state, assigned, date range, sort, page, size, q |
| `/productos` | `src/app/productos/page.tsx:217` | `getProductsKpis()` | — |
| `/productos` | `src/app/productos/page.tsx:400` | `getProductCategoryOptions()` | — |
| `/productos` | `src/app/productos/page.tsx:439` | `getInventoryPage(params)` | facets status, category, sort, page, size, q |
| `/productos` | `src/app/productos/page.tsx:649` | `getTopMoversPage(params)` | sort, page, size, q |
| `/productos` | `src/app/productos/page.tsx:753` | `getTopMarginProducts(15)` | limit=15 |
| `/productos` | `src/app/productos/page.tsx:888` | `getDeadStockPage(params)` | sort, page, size, q |
| `/system` | `src/app/system/page.tsx:215` | `getSystemKpis()` | — |
| `/system` | `src/app/system/page.tsx:326` | `getSyncFreshness()` | — |
| `/system` | `src/app/system/page.tsx:415` | `getCostBreakdown()` | — |
| `/system` | `src/app/system/page.tsx:521` | `getAgentEffectiveness()` | — |
| `/system` | `src/app/system/page.tsx:588` | `getDataQuality()` | — |
| `/system` | `src/app/system/page.tsx:699` | `getNotifications(30)` | limit=30 |
| `/system` | `src/app/system/page.tsx:733` | `getPipelineLogPhaseOptions()` | — |
| `/system` | `src/app/system/page.tsx:766` | `getPipelineLogsPage(params)` | facets level, phase, date range, sort, page, size, q |
| `/ventas` | `src/app/ventas/page.tsx:301` | `getSalesKpis()` | — |
| `/ventas` | `src/app/ventas/page.tsx:343` | `getSalesRevenueTrend(12)` | months=12 |
| `/ventas` | `src/app/ventas/page.tsx:488` | `getReorderRiskPage(params)` | facets status, tier, sort, page, size, q |
| `/ventas` | `src/app/ventas/page.tsx:642` | `getTopCustomersPage(params)` | sort, page, size, q |
| `/ventas` | `src/app/ventas/page.tsx:760` | `getTopSalespeople()` | — |
| `/ventas` | `src/app/ventas/page.tsx:875` | `getSaleOrderSalespeopleOptions()` | — |
| `/ventas` | `src/app/ventas/page.tsx:914` | `getSaleOrdersPage(params)` | facets state, salesperson, date range, sort, page, size, q |
| `/ventas` | `src/app/ventas/page.tsx:1010` | `getCustomerCohorts(36)` | monthsBack=36 |
| `/ventas/cohorts` | `src/app/ventas/cohorts/page.tsx` | — (redirect to `/ventas#retention`) | — |

Auth-only / skipped: `/login`, `/profile`. Client-only (no data layer): `/chat`.

---

## Part 2 — Query function → Supabase source map

| Query function | File:line | Supabase target | Read columns (first 10) | Filters (WHERE) | Order / Limit |
|---|---|---|---|---|---|
| `getDashboardKpis` | `dashboard.ts:57` | RPC `get_dashboard_kpis` | JSONB | — | — |
| `getTopAtRiskClients` | `dashboard.ts:78` | `customer_ltv_health` | company_id, company_name, tier, ltv_mxn, churn_risk_score, max_days_overdue | `gt(churn_risk_score,70)`, `gt(ltv_mxn,100000)`, `not company_id in selfIds` | order churn_risk_score desc, limit arg |
| `getRevenueTrend` | `dashboard.ts:100` | `pl_estado_resultados` | period, ingresos | — | order period desc, limit months+5 |
| `getInsights` | `insights.ts:67` | `agent_insights` + fk join `companies:company_id(name)`, `ai_agents:agent_id(slug,name)` | id, title, description, severity, state, category, company_id, created_at, assignee_name, assignee_email, agent_id, business_impact_estimate, confidence, recommendation | `state.in(...)`, `severity eq/in` (optional) | order created_at desc, limit arg |
| `getInsightById` | `insights.ts:142` | `agent_insights` + joins | id,title,description,severity,state,category,company_id,contact_id,created_at,assignee_name,assignee_email,assignee_department,agent_id,business_impact_estimate,confidence,recommendation,evidence,user_feedback,was_useful,expires_at | `eq(id,arg)` | maybeSingle |
| `getInsightCounts` | `insights.ts:211` | `agent_insights` (6x count queries) | id (count-only) | `eq state` / `in state + eq severity` | head only |
| `getRfmSegments` | `analytics.ts:54` | `rfm_segments` (matview) | company_id, company_name, tier, segment, recency_days, frequency, monetary_2y, monetary_12m, monetary_90d, avg_ticket (+more) | `eq(segment,arg)` optional | order contact_priority_score desc, limit arg |
| `getRfmSegmentSummary` | `analytics.ts:99` | `rfm_segments` (via getRfmSegments) | (aggregated in memory) | — | — |
| `getCollectionEffectiveness` | `analytics.ts:148` | `collection_effectiveness_index` | `*` | — | limit months |
| `getRevenueConcentration` | `analytics.ts:202` | `revenue_concentration` (view) | `*` | `lte(rank_in_portfolio, topN)` | — |
| `getActiveTripwires` | `analytics.ts:233` | `revenue_concentration` (via getRevenueConcentration(50)) | filtered where `tripwire != null` | — | — |
| `getStockoutQueue` | `analytics.ts:272` | `stockout_queue` (view) | `*` | `eq(urgency,arg)` optional | order priority_score desc, limit arg |
| `getSupplierPriceAlerts` | `analytics.ts:370` | `supplier_price_index` (matview) | `*` | `eq(price_flag,arg)`, `gte(month,cutoff)` | order overpaid_mxn desc, limit arg |
| `getRealSalePrices` | `analytics.ts:431` | `real_sale_price` (matview) | `*` | — | order revenue_12m desc, limit arg |
| `getCustomerCohorts` | `analytics.ts:482` | `customer_cohorts` (matview) | `*` | `gte(cohort_quarter,cutoff)` | order cohort_quarter asc, quarters_since_first asc |
| `getCompaniesPage` / `getCompaniesList` | `companies.ts:128,36` | `company_profile` (MV) | company_id, name, tier, risk_level, total_revenue, revenue_90d, trend_pct, overdue_amount, max_days_overdue, otd_rate, last_order_date | `gt(total_revenue,0)`, `not company_id in selfIds`, `ilike(name,q)`, `in(tier)`, `in(risk_level)` | order sortCol desc/asc, range(start,end) |
| `getCompaniesPage` (join) | `companies.ts:173` | `portfolio_concentration` (MV) | company_id, pareto_class, customer_status | `in(company_id,ids)` | — |
| `getCompaniesPage` (join) | `companies.ts:177` | `customer_ltv_health` (MV) | company_id, churn_risk_score | `in(company_id,ids)` | — |
| `getCompanyDetail` | `companies.ts:283` | `companies` (base) | id, name, canonical_name, rfc, industry, city, country, is_customer, is_supplier, credit_limit, payment_term, monthly_avg | `eq(id,arg)` | maybeSingle |
| `getCompanyDetail` | `companies.ts:290` | `company_profile` (MV) | `*` | `eq(company_id,arg)` | maybeSingle |
| `getCompanyDetail` | `companies.ts:292` | `company_narrative` (MV) | `*` | `eq(company_id,arg)` | maybeSingle |
| `getCompanyDetail` | `companies.ts:297` | `customer_ltv_health` (MV) | ltv_mxn, revenue_12m, revenue_3m, churn_risk_score, overdue_risk_score | `eq(company_id,arg)` | maybeSingle |
| `getCompanyOrdersPage` / `getCompanyOrders` | `companies.ts:419,461` | `odoo_sale_orders` | id, name, date_order, amount_total_mxn, state, salesperson_name | `eq(company_id,arg)`, `ilike(name,q)`, `in(state)`, `gte/lt(date_order)` | order sortCol, range |
| `getCompanyInvoicesPage` / `getCompanyInvoices` | `companies.ts:492,538` | `odoo_invoices` | id, name, invoice_date, due_date, amount_total_mxn, amount_residual_mxn, currency, payment_state, days_overdue | `eq(company_id,arg)`, `eq(move_type,'out_invoice')`, `ilike(name,q)`, `in(payment_state)`, `gte/lt(invoice_date)` | order sortCol, range |
| `getCompanyDeliveriesPage` / `getCompanyDeliveries` | `companies.ts:570,612` | `odoo_deliveries` | id, name, picking_type_code, scheduled_date, date_done, state, is_late | `eq(company_id,arg)`, `ilike(name,q)`, `in(state)`, `gte/lt(scheduled_date)` | order sortCol, range |
| `getCompanyTopProducts` | `companies.ts:640` | `odoo_order_lines` | product_ref, product_name, qty, subtotal_mxn, order_date | `eq(company_id,arg)`, `eq(order_type,'sale')` | (aggregated in memory), limit slice |
| `getCompanyActivities` | `companies.ts:693` | `odoo_activities` | id, activity_type, summary, date_deadline, assigned_to, is_overdue | `eq(company_id,arg)` | order date_deadline asc, limit arg |
| `getContactsPage` | `contacts.ts:43` | `contacts` + fk join `companies:company_id(name)` | id, name, email, company, company_id, risk_level, current_health_score, sentiment_score, last_activity, is_customer, is_supplier, phone, position | `not(name,is,null)`, `or(name/email/company ilike q)`, `in(risk_level)`, `or(is_customer.eq.true/is_supplier.eq.true)` | order sortCol, range |
| `getContactDetail` | `contacts.ts:136` | `contacts` + fk join companies | id, name, email, phone, position, company, company_id, entity_id, risk_level, current_health_score (+more) | `eq(id,arg)` | maybeSingle |
| `getContactDetail` (aux) | `contacts.ts:151` | `emails` | id (count-only) | `eq(sender_contact_id,id)` | head only |
| `getContactDetail` (aux) | `contacts.ts:155` | `agent_insights` | id (count-only) | `eq(contact_id,id)`, `in(state,['new','seen'])` | head only |
| `getContactsKpis` | `contacts.ts:202` | `contacts` (4x count), `agent_insights` (1x count) | id (count-only) | various: `not name is null`, `eq is_customer`, `eq is_supplier`, `in(risk_level,['high','critical'])` | head only |
| `getArAging` | `invoices.ts:39` | `odoo_invoices` | amount_residual_mxn, days_overdue | `eq(move_type,'out_invoice')`, `in(payment_state,['not_paid','partial'])`, `gt(days_overdue,0)`, `not company_id in selfIds` | — (bucketed in memory) |
| `getCompanyAging` / `getCompanyAgingPage` | `invoices.ts:89,291` | `cash_flow_aging` (view) | company_id, company_name, tier, current_amount, overdue_1_30, overdue_31_60, overdue_61_90, overdue_90plus, total_receivable, total_revenue | `gt(total_receivable,0)`, `not company_id in selfIds`, `ilike(company_name,q)`, `in(tier)` | order sortCol, range |
| `getOverdueInvoices` / `getOverdueInvoicesPage` | `invoices.ts:135,185` | `odoo_invoices` + fk join companies | id, name, company_id, amount_total_mxn, amount_residual_mxn, currency, days_overdue, due_date, invoice_date, payment_state, salesperson_name | `eq(move_type,'out_invoice')`, `in(payment_state,['not_paid','partial'])`, `gt(days_overdue,0)`, `not company_id in selfIds`, `ilike(name,q)`, `in(salesperson_name)`, date range, bucket OR filter | order sortCol, range |
| `getOverdueSalespeopleOptions` | `invoices.ts:264` | `odoo_invoices` | salesperson_name | same overdue filters | limit 2000 |
| `getPaymentPredictionsPage` / `getPaymentPredictions` | `invoices.ts:373,430` | `payment_predictions` (MV) | company_id, company_name, tier, payment_risk, payment_trend, avg_days_to_pay, median_days_to_pay, max_days_overdue, total_pending, pending_count, predicted_payment_date | `gt(total_pending,0)`, `not ilike(payment_risk,'NORMAL%')`, `not company_id in selfIds`, `ilike(company_name,q)`, `or(payment_risk.ilike...)`, `in(payment_trend)` | order sortCol, range |
| `getPaymentRiskKpis` | `invoices.ts:463` | `payment_predictions` | payment_risk, total_pending | same payment filters | — (aggregated in memory) |
| `getCfoSnapshot` | `finance.ts:36` | `cfo_dashboard` (view) | `*` | — | maybeSingle |
| `getFinancialRunway` | `finance.ts:82` | `financial_runway` (view) | `*` | — | maybeSingle |
| `getWorkingCapital` | `finance.ts:120` | `working_capital` (view) | `*` | — | maybeSingle |
| `getCashPosition` | `finance.ts:159` | `cash_position` (view) | banco, tipo, moneda, cuenta, saldo, saldo_mxn | — | order saldo_mxn desc |
| `getPlHistory` | `finance.ts:193` | `pl_estado_resultados` (view) | `*` | — | order period desc, limit months+5 |
| `getWorkingCapitalCycle` | `finance.ts:251` | `working_capital_cycle` (view) | `*` | — | maybeSingle |
| `getProjectedCashFlow` (weeks) | `finance.ts:524` | `projected_cash_flow_weekly` (view) | `*` | — | order week_index asc |
| `getProjectedCashFlow` (summary) | `finance.ts:528` | RPC `get_projected_cash_flow_summary` | JSONB | — | — |
| `getCashflowRecommendations` | `finance.ts:649` | RPC `get_cashflow_recommendations` | JSONB | — | — |
| `getPartnerPaymentProfiles` | `finance.ts:728` | `partner_payment_profile` (MV) | odoo_partner_id, payment_type, payment_count_24m, months_active, total_paid_mxn, avg_payment_amount, typical_day_of_month, preferred_bank_journal, preferred_payment_method, invoice_count_24m (+more) | `gte(confidence,arg)`, `eq(payment_type,arg)` | order total_paid_mxn desc, limit arg |
| `getPartnerPaymentProfiles` (join) | `finance.ts:751` | `companies` | odoo_partner_id, name | `in(odoo_partner_id,ids)` | — |
| `getJournalFlowProfiles` | `finance.ts:801` | `journal_flow_profile` (MV) | journal_name, payment_type, months_active, total_payments_12m, total_amount_12m, avg_monthly_amount, stddev_monthly_amount, volatility_cv | — | order total_amount_12m desc |
| `getAccountPaymentProfiles` | `finance.ts:841` | `account_payment_profile` (MV) | odoo_account_id, account_code, account_name, account_type, detected_category, frequency, months_with_activity, months_in_last_12m, avg_monthly_net, median_monthly_net (+more) | `eq(detected_category,arg)` optional | order avg_monthly_net desc |
| `getCompanyEvidencePack` | `evidence.ts:183` | RPC `company_evidence_pack` | JSONB | arg p_company_id | — |
| `getDirectorBriefing` | `evidence.ts:220` | RPC `get_director_briefing` | JSONB | args p_director, p_max_companies | — |
| `getOperationsKpis` | `operations.ts:31` | `ops_delivery_health_weekly` (MV) | otd_pct, total_completed, avg_lead_days, week_start | — | order week_start desc, limit 4 |
| `getOperationsKpis` | `operations.ts:40,44` | `odoo_deliveries` (2 counts) | id (count-only) | `eq(is_late,true)` / `in(state,['assigned','confirmed','waiting'])` | head only |
| `getOperationsKpis` | `operations.ts:48,52` | `odoo_manufacturing` (2 counts) | id (count-only) | `in(state,['confirmed','progress','draft'])` / `eq(state,'to_close')` | head only |
| `getWeeklyTrend` | `operations.ts:103` | `ops_delivery_health_weekly` | week_start, total_completed, on_time, late, otd_pct, avg_lead_days | — | order week_start desc, limit weeks |
| `getLateDeliveries` | `operations.ts:144` | `odoo_deliveries` + fk join companies | id, name, picking_type_code, company_id, scheduled_date, state, origin | `eq(is_late,true)` | order scheduled_date asc, limit arg |
| `getPendingDeliveries` | `operations.ts:184` | `odoo_deliveries` + fk join companies | id, name, picking_type_code, company_id, scheduled_date, state, is_late | `in(state,['assigned','confirmed','waiting'])` | order scheduled_date asc, limit arg |
| `getDeliveriesPage` | `operations.ts:238` | `odoo_deliveries` + fk join companies | id, name, picking_type_code, company_id, scheduled_date, date_done, state, origin, is_late | `eq(is_late,true)` opt, `in(state)`, `in(picking_type_code)`, date range, `or(name/origin ilike q)` | order sortCol, range |
| `getManufacturingPage` / `getActiveManufacturing` | `operations.ts:326,395` | `odoo_manufacturing` | id, name, product_name, qty_planned, qty_produced, state, date_start, date_finished, assigned_user, origin | `in(state,arg\|defaults)`, `or(name/product_name/origin ilike q)`, date range, `in(assigned_user)` | order sortCol, range/limit |
| `getManufacturingAssigneeOptions` | `operations.ts:381` | `odoo_manufacturing` | assigned_user | `not(assigned_user,is,null)` | limit 2000 |
| `getProductsKpis` | `products.ts:26` | `odoo_products` (count) | id | `eq(active,true)` | head only |
| `getProductsKpis` | `products.ts:33` | `inventory_velocity` (view) | reorder_status, stock_value | — | — |
| `getProductsKpis` | `products.ts:36` | `dead_stock_analysis` (MV) | inventory_value | — | — |
| `getProductsKpis` | `products.ts:37` | `product_margin_analysis` (MV) | gross_margin_pct | — | — |
| `getReorderNeeded` / `getInventoryPage` | `products.ts:104,160` | `inventory_velocity` | product_ref, product_name, category, reorder_status, stock_qty, available_qty, daily_run_rate, days_of_stock, qty_sold_90d, reorder_min (+customers_12m, last_sale_date) | `in(reorder_status,...)`, `in(category)`, `or(product_ref/product_name ilike q)` | order sortCol, limit/range |
| `getProductCategoryOptions` | `products.ts:220` | `inventory_velocity` | category | `not(category,is,null)` | limit 5000 |
| `getTopMoversPage` / `getTopMovers` | `products.ts:266,311` | `inventory_velocity` | product_ref, product_name, qty_sold_90d, qty_sold_180d, qty_sold_365d, customers_12m, daily_run_rate, days_of_stock, stock_value, annual_turnover | `gt(qty_sold_90d,0)`, `or(...ilike q)` | order sortCol, range |
| `getDeadStockPage` / `getDeadStock` | `products.ts:365,405` | `dead_stock_analysis` | product_ref, product_name, inventory_value, days_since_last_sale, stock_qty, last_sale_date, historical_customers, lifetime_revenue | `or(...ilike q)` | order sortCol, range |
| `getTopMarginProducts` | `products.ts:437` | `product_margin_analysis` | product_ref, product_name, gross_margin_pct, total_order_value, company_id | `gt(total_order_value,0)`, `not(gross_margin_pct,is,null)` | — (aggregated in memory) |
| `getUomMismatchProducts` | `products.ts:520` | `product_margin_analysis` | odoo_product_id, product_ref, product_name, total_order_value, uom_mismatch_order_lines, uom_mismatch_invoice_lines, uom_mismatch_revenue_mxn | `eq(has_uom_mismatch,true)` | — |
| `getUomMismatchProducts` (join) | `products.ts:575` | `odoo_products` | odoo_product_id, uom | `in(odoo_product_id,ids)` | — |
| `getBomCostSummary` | `products.ts:666` | `mrp_boms` (count) | id | `eq(active,true)` | head only |
| `getBomCostSummary` | `products.ts:668` | `product_real_cost` (MV) | odoo_product_id, has_missing_costs, has_multiple_boms, max_depth, delta_vs_cached_pct, real_unit_cost | — | — |
| `getBomCostSummary` | `products.ts:673` | `product_margin_analysis` | odoo_product_id, total_order_value, cost_source | — | — |
| `getSuspiciousBoms` / `getBomsMissingComponents` / `getTopRevenueBoms` / `getBomsWithMultipleVersions` | `products.ts:855,873,890,1008` | `product_real_cost` | PRC_SELECT (odoo_product_id, product_ref, product_name, raw_components_count, distinct_raw_components, max_depth, missing_cost_components, has_missing_costs, has_multiple_boms, active_boms_for_product +more) | `gt(delta_vs_cached_pct,50)+eq(has_missing_costs,false)` / `eq(has_missing_costs,true)` / `in(odoo_product_id,topPmaIds)` / `eq(has_multiple_boms,true)` | order various, limit |
| `getSuspiciousBoms` etc. (aux `getPmaRevenueMap`) | `products.ts:755` | `product_margin_analysis` | odoo_product_id, total_order_value, avg_order_price, total_qty_ordered | — | — |
| `getBomDuplicates` | `products.ts:929` | `bom_duplicate_components` (view/MV) | odoo_product_id, product_ref, product_name, intra_dupe_components, same_name_groups, intra_dupe_overcounted_mxn, same_name_overcounted_mxn, total_overcounted_per_unit_mxn | `gt(total_overcounted_per_unit_mxn,0)` | order desc, limit arg |
| `getBomDuplicates` (joins) | `products.ts:955,959` | `product_real_cost`, `product_margin_analysis` | (see above) | `in(odoo_product_id,ids)` | — |
| `getPurchasesKpis` | `purchases.ts:49-54` | `odoo_purchase_orders` (2x) | amount_total_mxn | `gte/lt(date_order,...)` (curr/prev month) | — |
| `getPurchasesKpis` | `purchases.ts:60` | `odoo_invoices` | amount_residual_mxn | `eq(move_type,'in_invoice')`, `in(payment_state,['not_paid','partial'])` | — |
| `getPurchasesKpis` | `purchases.ts:65` | `cfo_dashboard` | pagos_prov_30d | — | maybeSingle |
| `getPurchasesKpis` | `purchases.ts:67` | `supplier_concentration_herfindahl` (view/MV) | total_spent_12m | `eq(concentration_level,'single_source')` | — |
| `getSingleSourceRiskPage` / `getSingleSourceRisk` | `purchases.ts:135,185` | `supplier_concentration_herfindahl` | odoo_product_id, product_ref, product_name, top_supplier_name, top_supplier_company_id, total_spent_12m, concentration_level, herfindahl_idx, top_supplier_share_pct | `in(concentration_level,arg\|defaults)`, `or(ilike q)` | order sortCol, range/limit |
| `getPriceAnomaliesPage` / `getPriceAnomalies` | `purchases.ts:244,298` | `purchase_price_intelligence` (MV) | product_ref, product_name, currency, last_supplier, last_price, prev_price, avg_price, price_change_pct, price_vs_avg_pct, price_flag, total_spent, last_purchase_date | `in(price_flag,...)`, `or(ilike q)`, `gte/lte(last_purchase_date)` | order sortCol, range/limit |
| `getPurchaseOrdersPage` / `getRecentPurchaseOrders` | `purchases.ts:354,422` | `odoo_purchase_orders` | id, name, company_id, amount_total_mxn, buyer_name, date_order, state | `gte/lt(date_order)`, `ilike(name,q)`, `in(state)`, `in(buyer_name)` | order sortCol, range/limit |
| `getPurchaseOrdersPage` (aux resolveCompanyNames) | `_helpers.ts:81` | `companies` | id, name | `in(id,ids)` | — |
| `getPurchaseBuyerOptions` | `purchases.ts:405` | `odoo_purchase_orders` | buyer_name | `gte(date_order,since)`, `not(buyer_name,is,null)` | limit 3000 |
| `getTopSuppliersPage` / `getTopSuppliers` | `purchases.ts:468,538` | `supplier_product_matrix` (MV) | supplier_name, purchase_value, purchase_orders, odoo_product_id | `gt(purchase_value,0)` | — (aggregated in memory), paginated in memory |
| `getSalesKpis` | `sales.ts:59` | `pl_estado_resultados` | period, ingresos, utilidad_operativa | — | order period desc, limit 24 |
| `getSalesKpis` | `sales.ts:64` | `monthly_revenue_by_company` (view/MV) | month, net_revenue, ma_3m | — | order month desc, limit 60 |
| `getSalesKpis` | `sales.ts:69` | `odoo_sale_orders` | amount_total_mxn, salesperson_name | `gte/lt(date_order)`, `neq(state,'cancel')`, `not company_id in selfIds` | — |
| `getSalesRevenueTrend` | `sales.ts:168` | `monthly_revenue_by_company` | month, net_revenue, ma_3m | `gte(month,since)` | order month asc |
| `getReorderRiskPage` / `getReorderRisk` | `sales.ts:248,302` | `client_reorder_predictions` (view/MV) | company_id, company_name, tier, reorder_status, avg_cycle_days, days_since_last, days_overdue_reorder, avg_order_value, total_revenue, salesperson_name (+more) | `in(reorder_status,...)`, `not company_id in selfIds`, `ilike(company_name,q)`, `in(tier)` | order sortCol, range/limit |
| `getTopCustomersPage` / `getTopCustomers` | `sales.ts:363,430` | `company_profile` (MV) | company_id, name, revenue_90d, total_revenue | `gt(revenue_90d,0)`, `not company_id in selfIds`, `ilike(name,q)` | order sortCol, range/limit |
| `getTopCustomersPage` (join) | `sales.ts:399` | `customer_margin_analysis` (MV) | company_id, margin_12m, margin_pct_12m | `in(company_id,ids)` | — |
| `getTopSalespeople` | `sales.ts:498` | `odoo_sale_orders` | salesperson_name, amount_total_mxn | `gte/lt(date_order)`, `neq(state,'cancel')`, `not(salesperson_name,is,null)`, `not company_id in selfIds` | — (aggregated) |
| `getSaleOrdersPage` / `getRecentSaleOrders` | `sales.ts:557,628` | `odoo_sale_orders` | id, name, company_id, amount_total_mxn, salesperson_name, date_order, state | `not company_id in selfIds`, `gte/lt(date_order)`, `ilike(name,q)`, `in(state)`, `in(salesperson_name)` | order sortCol, range/limit |
| `getSaleOrderSalespeopleOptions` | `sales.ts:611` | `odoo_sale_orders` | salesperson_name | `gte(date_order,since-6m)`, `not(salesperson_name,is,null)` | limit 3000 |
| `getSystemKpis` | `system.ts:37` | `odoo_sync_freshness` (view) | status | — | — |
| `getSystemKpis` | `system.ts:38` | `claude_cost_summary` (view) | `*` | — | — |
| `getSystemKpis` | `system.ts:39` | `data_quality_scorecard` (view) | severity | — | — |
| `getSystemKpis` | `system.ts:40` | `notification_queue` | status | — | — |
| `getSystemKpis` | `system.ts:42` | `agent_runs` | status | `gte(started_at,since24h)` | — |
| `getSyncFreshness` | `system.ts:93` | `odoo_sync_freshness` | table_name, row_count, status, hours_ago, last_sync | — | order hours_ago desc |
| `getCostBreakdown` | `system.ts:131` | `claude_cost_summary` | `*` | — | order total_cost_usd desc |
| `getAgentEffectiveness` | `system.ts:188` | `agent_effectiveness` (view) | `*` | `eq(is_active,true)` | order total_insights desc |
| `getAgentBySlug` | `system.ts:234` | `ai_agents` | id, slug, name, domain, description, analysis_schedule, is_active | `eq(slug,arg)` | maybeSingle |
| `getAgentBySlug` | `system.ts:251` | `agent_effectiveness` | `*` | `eq(agent_id,id)` | maybeSingle |
| `getAgentRuns` | `system.ts:305` | `agent_runs` | id, status, started_at, completed_at, duration_seconds, entities_analyzed, insights_generated, input_tokens, output_tokens, error_message | `eq(agent_id,arg)` | order started_at desc, limit arg |
| `getAgentMemory` | `system.ts:331` | `agent_memory` | id, memory_type, content, importance, times_used, last_used_at, created_at | `eq(agent_id,arg)` | order importance desc, limit arg |
| `getDataQuality` | `system.ts:355` | `data_quality_scorecard` | `*` | — | — |
| `getNotifications` | `system.ts:401` | `notification_queue` | id, channel, status, priority, recipient_name, title, body, created_at, sent_at, error_message | — | order created_at desc, limit arg |
| `getPipelineLogs` / `getPipelineLogsPage` | `system.ts:426,443` | `pipeline_logs` | id, level, phase, message, created_at | `ilike(message,q)`, `in(level)`, `in(phase)`, `gte/lt(created_at)` | order created_at desc/asc, range/limit |
| `getPipelineLogPhaseOptions` | `system.ts:478` | `pipeline_logs` | phase | `not(phase,is,null)` | order created_at desc, limit 2000 |
| `getTeamKpis` | `team.ts:27` | `odoo_employees` (count) | id | `eq(is_active,true)` | head only |
| `getTeamKpis` | `team.ts:32` | `odoo_departments` (count) | id | — | head only |
| `getTeamKpis` | `team.ts:34` | `odoo_users` | pending_activities_count, overdue_activities_count | — | — |
| `getTeamKpis` | `team.ts:37` | `agent_insights` (count) | id | `in(state,['new','seen'])` | head only |
| `getUserBacklog` | `team.ts:85` | `odoo_users` | odoo_user_id, name, email, department, job_title, pending_activities_count, overdue_activities_count | `gt(pending_activities_count,0)` | order pending_activities_count desc, limit arg |
| `getUserBacklog` (join) | `team.ts:93` | `agent_insights` | assignee_user_id | `in(state,['new','seen'])`, `not(assignee_user_id,is,null)` | — |
| `getDepartments` | `team.ts:147` | `departments` | id, name, lead_name, lead_email, description, is_active | `eq(is_active,true)` | order name asc |
| `getInsightsByDepartment` | `team.ts:181` | `agent_insights` | assignee_department, severity | `in(state,['new','seen'])`, `not(assignee_department,is,null)` | — (aggregated) |
| `getEmployees` | `team.ts:230` | `odoo_employees` | id, name, work_email, department_name, job_title, manager_name, is_active | `eq(is_active,true)` | order name asc, limit arg |
| `getInvoiceByName` | `invoice-detail.ts:48` | `odoo_invoices` + fk join companies | id, name, move_type, company_id, amount_total_mxn, amount_residual_mxn, amount_untaxed_mxn, currency, invoice_date, due_date (+more + ref, cfdi_uuid, cfdi_sat_state) | `eq(name,arg)` | maybeSingle |
| `getInvoiceByName` (join) | `invoice-detail.ts:83` | `odoo_invoice_lines` | product_ref, product_name, quantity, price_unit, discount, price_subtotal_mxn | `eq(odoo_move_id,arg)` | — |
| `getSelfCompanyIds` (helper) | `_helpers.ts:17` | `companies` | id | `eq(relationship_type,'self')` | cached |
| `resolveCompanyNames` (helper) | `_helpers.ts:81` | `companies` | id, name | `in(id,ids)` | — |

---

## Part 3 — Supabase source → Odoo origin map

| Supabase target | Type | Odoo source model | qb19 sync method | Notes |
|---|---|---|---|---|
| `companies` | table | `res.partner` (commercial side) | `_push_contacts` | Primary partner/company table. Also has enrichment cols set by frontend/agents (relationship_type='self', strategic_notes, credit_limit, payment_term). |
| `contacts` | table | `res.partner` (contact side) | `_push_contacts` | Per-contact detail. Has Supabase-native cols (entity_id, current_health_score, risk_level, sentiment_score, notes). |
| `odoo_products` | table | `product.product` | `_push_products` | |
| `odoo_order_lines` | table | `sale.order.line` + `purchase.order.line` | `_push_order_lines` | purchase lines stored with negative odoo_line_id. |
| `odoo_users` | table | `res.users` + `hr.employee` | `_push_users` | pending/overdue activities counts pre-computed by push. |
| `odoo_invoices` | table | `account.move` | `_push_invoices` | move_type filters out_invoice/in_invoice etc. |
| `odoo_invoice_lines` | table | `account.move.line` | `_push_invoice_lines` | |
| `odoo_payments` | table | `account.move` (paid proxy) | `_push_payments` | Not directly read by frontend queries seen. |
| `odoo_account_payments` | table | `account.payment` | `_push_account_payments` | Used implicitly by derived views (cfo_dashboard, payment_predictions). |
| `odoo_deliveries` | table | `stock.picking` | `_push_deliveries` | |
| `odoo_crm_leads` | table | `crm.lead` | `_push_crm_leads` | Not directly read by frontend queries seen. |
| `odoo_activities` | table | `mail.activity` | `_push_activities` | |
| `odoo_manufacturing` | table | `mrp.production` | `_push_manufacturing` | |
| `odoo_employees` | table | `hr.employee` | `_push_employees` | |
| `odoo_departments` | table | `hr.department` | `_push_departments` | |
| `odoo_sale_orders` | table | `sale.order` | `_push_sale_orders` | Frontend filters out self companies, leverages amount_total_mxn. |
| `odoo_purchase_orders` | table | `purchase.order` | `_push_purchase_orders` | |
| `odoo_orderpoints` | table | `stock.warehouse.orderpoint` | `_push_orderpoints` | Not directly read by frontend queries; feeds derived views. |
| `odoo_chart_of_accounts` | table | `account.account` | `_push_chart_of_accounts` | Used by derived finance views. |
| `odoo_account_balances` | table | `account.move.line` (aggregated) | `_push_account_balances` | Base for pl_estado_resultados, working_capital_cycle (COGS). |
| `odoo_bank_balances` | table | `account.journal` (bank/cash) | `_push_bank_balances` | Base for cash_position, financial_runway. |
| `odoo_currency_rates` | table | `res.currency.rate` | `_push_currency_rates` | Feeds `_mxn` conversions used by views and invoices. |
| `mrp_boms` | table | `mrp.bom` | `_push_boms` | Present in sync_push.py (line 2286); not in CLAUDE.md's 21-list. |
| `odoo_uoms` | table | `uom.uom` | `_push_uoms` | Present in sync_push.py (line 2360); not in CLAUDE.md's 21-list. Likely feeds product_uom in odoo_products. |
| `pl_estado_resultados` | view | derived | — | Built from `odoo_account_balances`. |
| `cash_position` | view | derived | — | Built from `odoo_bank_balances`. |
| `cfo_dashboard` | view | derived | — | Built from `odoo_bank_balances`, `odoo_invoices`, `odoo_account_payments`. |
| `financial_runway` | view | derived | — | Built from `cfo_dashboard`, invoice predictions. |
| `working_capital` | view | derived | — | Built from `odoo_bank_balances`, `odoo_invoices`, `odoo_products` stock. |
| `working_capital_cycle` | view | derived | — | Built from `odoo_account_balances` (expense_direct_cost), `odoo_invoices`. |
| `projected_cash_flow_weekly` | view | derived | — | Built from `odoo_invoices`, `odoo_sale_orders`, `odoo_purchase_orders`, `odoo_bank_balances`, payment behavior profiles. |
| `cash_flow_aging` | view | derived | — | AR buckets from `odoo_invoices`. |
| `monthly_revenue_by_company` | view/MV | derived | — | Built from `odoo_invoices`/`odoo_sale_orders` per company x month. |
| `company_profile` | MV | derived | — | Consolidated per-company metrics from `companies`, `odoo_invoices`, `odoo_sale_orders`, `odoo_deliveries`, `emails`. |
| `company_narrative` | MV | derived | — | Extended narrative (complaints, top_products, salespeople) from `companies`, emails, order lines. |
| `customer_ltv_health` | MV | derived | — | LTV + churn_risk_score + overdue_risk_score from `odoo_invoices`, `odoo_sale_orders`. |
| `portfolio_concentration` | MV | derived | — | Pareto class + rank from `odoo_invoices`. |
| `revenue_concentration` | view | derived | — | Top-N ranks + tripwires from `odoo_invoices`. |
| `rfm_segments` | MV | derived | — | RFM from `odoo_invoices` / `odoo_sale_orders`. |
| `customer_cohorts` | MV | derived | — | Cohort retention from `odoo_sale_orders` / `odoo_invoices`. |
| `collection_effectiveness_index` | MV/view | derived | — | CEI cohort from `odoo_invoices`. |
| `payment_predictions` | MV | derived | — | Built from `odoo_invoices` + `odoo_account_payments` history. |
| `client_reorder_predictions` | MV/view | derived | — | Reorder cycle from `odoo_sale_orders`. |
| `customer_margin_analysis` | MV | derived | — | Margin per customer from order lines + standard costs. |
| `inventory_velocity` | view | derived | — | Daily run rate, days of stock from `odoo_products`, `odoo_order_lines`, `odoo_orderpoints`. |
| `dead_stock_analysis` | MV | derived | — | Stale stock from `odoo_products`, `odoo_order_lines`. |
| `product_margin_analysis` | MV | derived | — | Per product x customer margin from order lines, invoice lines. |
| `real_sale_price` | MV | derived | — | Weighted real price from `odoo_invoice_lines`/`odoo_order_lines`. |
| `product_real_cost` | MV | derived | — | Recursive BOM rolldown from `mrp_boms` + `odoo_products`. |
| `bom_duplicate_components` | view/MV | derived | — | BOM duplicate detection from `mrp_boms`. |
| `stockout_queue` | view | derived | — | From `odoo_products`, `odoo_order_lines`, `odoo_orderpoints`. |
| `supplier_concentration_herfindahl` | view/MV | derived | — | Herfindahl from `odoo_order_lines` (purchase). |
| `supplier_price_index` | MV | derived | — | Price benchmark from purchase order lines / invoice lines. |
| `supplier_product_matrix` | MV | derived | — | Supplier × product from purchase lines. |
| `purchase_price_intelligence` | MV | derived | — | Price anomalies from purchase order lines. |
| `ops_delivery_health_weekly` | MV | derived | — | OTD metrics from `odoo_deliveries`. |
| `partner_payment_profile` | MV | derived | — | From `odoo_account_payments`, `odoo_invoices`. |
| `journal_flow_profile` | MV | derived | — | From `odoo_account_payments` × `odoo_bank_balances`. |
| `account_payment_profile` | MV | derived | — | From `odoo_account_balances`, `odoo_chart_of_accounts`. |
| `odoo_sync_freshness` | view | derived | — | Meta-view: reads `synced_at` from every `odoo_*` table. |
| `claude_cost_summary` | view | derived | — | From `token_usage` table (Supabase-native telemetry). |
| `data_quality_scorecard` | view | derived | — | From multiple tables (mixed Odoo + native). |
| `agent_insights` | table | FOREIGN | — | Supabase-native: AI agent output. |
| `agent_runs` | table | FOREIGN | — | Supabase-native: agent execution log. |
| `agent_memory` | table | FOREIGN | — | Supabase-native: agent learning memories. |
| `agent_effectiveness` | view | FOREIGN | — | Derived from `agent_insights`, `agent_runs`, `ai_agents` — all Supabase-native. |
| `ai_agents` | table | FOREIGN | — | Supabase-native: agent registry. |
| `emails` | table | FOREIGN | — | Supabase-native: ingested from Gmail API. |
| `departments` | table | FOREIGN | — | Supabase-native department registry (distinct from `odoo_departments`, used for insight routing). |
| `notification_queue` | table | FOREIGN | — | Supabase-native WhatsApp/email queue. |
| `pipeline_logs` | table | FOREIGN | — | Supabase-native pipeline log. |
| RPC `get_dashboard_kpis` | RPC | derived | — | Aggregates views above into JSONB. |
| RPC `get_projected_cash_flow_summary` | RPC | derived | — | Summary for `projected_cash_flow_weekly`. |
| RPC `get_cashflow_recommendations` | RPC | derived | — | Ranked action list. |
| RPC `company_evidence_pack` | RPC | derived | — | Cross-dimension evidence from many `odoo_*` tables + emails + agent_insights. |
| RPC `get_director_briefing` | RPC | derived + native | — | Uses `company_evidence_pack` + director-specific prioritization + agent feedback (`agent_insights` history). |

---

## Part 4 — Data layer grouping

| Layer | Supabase targets | Pages that consume it | Cross-page risk assessment |
|---|---|---|---|
| Partners / Companies | `companies`, `contacts`, `company_profile`, `company_narrative`, `customer_ltv_health`, `portfolio_concentration`, `revenue_concentration`, `rfm_segments`, `customer_cohorts` | `/`, `/companies`, `/companies/[id]`, `/contacts`, `/contacts/[id]`, `/cobranza` (via aging), `/ventas` (reorder + top customers), `/finanzas` (partner profiles) | HIGH — same company_name surfaces across 8+ pages; `sanitizeCompanyName` applied inconsistently (applied via `joinedCompanyName` helper but RFM/CEI/LTV views bypass it); `tier` normalized only in companies list (Pareto "A/B/C" parsing); self-company exclusion (`getSelfCompanyIds`) applied in some queries but not others (e.g. not in `rfm_segments`, `collection_effectiveness_index`, `company_profile` detail) |
| Invoices (AR/AP) | `odoo_invoices`, `odoo_invoice_lines`, `cash_flow_aging`, `collection_effectiveness_index`, `payment_predictions` | `/cobranza`, `/companies/[id]` (finance tab), `/inbox/insight/[id]` (drill-down via `getInvoiceByName`), `/compras` (AP count in KPIs), `/finanzas` (via cfo_dashboard, projected_cash_flow) | HIGH — AR computations scattered: (a) `getArAging` re-buckets `odoo_invoices.days_overdue` in memory, (b) `cash_flow_aging` view buckets server-side, (c) `getCompanyInvoicesPage` uses `odoo_invoices` directly with `eq(payment_state)` different from overdue query. Different self-exclusion per path. Bucket boundaries same (1-30/31-60/61-90) but CompanyAging uses `overdue_90plus` whereas cobranza shows 91-120 and 120+ separately |
| Journals / Accounts / Banks | `odoo_chart_of_accounts`, `odoo_account_balances`, `odoo_bank_balances`, `cash_position`, `cfo_dashboard`, `financial_runway`, `working_capital`, `working_capital_cycle`, `projected_cash_flow_weekly`, `account_payment_profile`, `journal_flow_profile`, `partner_payment_profile` | `/finanzas`, `/cobranza` (CFO snapshot), `/compras` (CFO pagos_prov_30d), `/` (RunwayBanner via dashboard KPI + `/finanzas`'s runway view — DOUBLE source) | CRITICAL — "runway days" is computed twice: `get_dashboard_kpis` RPC returns `cash.runway_days` used on `/`, while `getFinancialRunway` view returns `runwayDaysNet` used on `/finanzas`. Same label, possibly different logic. Cash total shown as `cash.total_mxn` in dashboard vs `effectiveMxn` (operative+in_transit) in projected cash flow vs `efectivoTotalMxn` in cfo_dashboard — three different "cash" numbers. |
| Products | `odoo_products`, `inventory_velocity`, `dead_stock_analysis`, `product_margin_analysis`, `real_sale_price`, `product_real_cost`, `bom_duplicate_components`, `mrp_boms`, `stockout_queue` | `/productos`, `/compras` (stockouts), `/compras/costos-bom`, `/companies/[id]` (top products via order lines) | MEDIUM — `product_ref` (default_code) used consistently but `internal_ref`/`product_ref` column naming varies between tables. Top products in company detail aggregates `odoo_order_lines.subtotal_mxn` in memory (no view) vs `product_margin_analysis` MV used on /productos — reconciliation risk. `has_missing_costs`, `has_multiple_boms` filters not uniformly applied: `getSuspiciousBoms` excludes missing_costs, `getBomsWithMultipleVersions` doesn't |
| Orders (Sales/Purchase) | `odoo_sale_orders`, `odoo_purchase_orders`, `odoo_order_lines`, `odoo_deliveries`, `monthly_revenue_by_company`, `client_reorder_predictions`, `customer_margin_analysis`, `supplier_product_matrix`, `supplier_concentration_herfindahl`, `supplier_price_index`, `purchase_price_intelligence` | `/ventas`, `/compras`, `/operaciones`, `/companies/[id]` (orders + deliveries + top products) | HIGH — Sale orders show `amount_total_mxn` from `odoo_sale_orders` directly on some pages (/ventas orders tab, /companies/[id]) vs aggregated from `monthly_revenue_by_company` on trend/KPI. Self-company exclusion applied in sales.ts but NOT in companies.ts `getCompanyOrdersPage` (company detail may show self-orders). Company name resolution in sales/purchases goes through separate `resolveCompanyNames` helper (no FK join available). |
| Users / Employees | `odoo_users`, `odoo_employees`, `odoo_departments`, `departments` | `/equipo`, `/companies/[id]` (activities `assigned_to`), `/inbox/insight/[id]` (assignee), `/operaciones` (manufacturing assigned_user), `/ventas` (salesperson_name), `/compras` (buyer_name), `/cobranza` (salesperson_name) | HIGH — Salesperson/buyer/assignee are **text names** in `odoo_sale_orders.salesperson_name`, `odoo_purchase_orders.buyer_name`, `odoo_activities.assigned_to` — NOT FK'd to `odoo_users`. If an Odoo user is renamed, historical rows keep the old string and facets break. `odoo_users` also has `name`, `department`, `job_title` populated from employees join — cross-referencing user_id to name goes through `_push_users` logic. Two separate `departments` tables (Supabase-native `departments` for insight routing vs `odoo_departments` for HR). |
| CRM / Activities | `odoo_crm_leads`, `odoo_activities` | `/companies/[id]` (activity tab), `/equipo` (via pending_activities_count in odoo_users) | LOW — only activities surfaced; crm_leads not currently read by any frontend query. Activities' `assigned_to` is text (same risk as above). |
| Manufacturing | `odoo_manufacturing` | `/operaciones`, `/` (manufacturing_active KPI via dashboard RPC) | LOW — single page + dashboard KPI. |
| Derived finance | `cfo_dashboard`, `financial_runway`, `working_capital`, `working_capital_cycle`, `projected_cash_flow_weekly`, `pl_estado_resultados`, `cash_position`, `cash_flow_aging`, `monthly_revenue_by_company`, `collection_effectiveness_index`, `payment_predictions`, `client_reorder_predictions`, `customer_margin_analysis`, `product_margin_analysis`, `real_sale_price`, `product_real_cost`, RPCs `get_dashboard_kpis`, `get_projected_cash_flow_summary`, `get_cashflow_recommendations`, `company_evidence_pack`, `get_director_briefing` | `/`, `/finanzas`, `/cobranza`, `/ventas`, `/compras`, `/compras/costos-bom`, `/briefings/[director]`, `/companies/[id]` (evidence pack), `/inbox/insight/[id]` (evidence pack) | CRITICAL — RPC `get_dashboard_kpis` is a black-box superset; its internal logic may diverge from dedicated views. `pl_estado_resultados.ingresos` vs `monthly_revenue_by_company.net_revenue` — different bases, both used as "revenue". `odoo_invoices.amount_total_mxn`-summed AR (`/compras` KPI) vs `cfo_dashboard.cuentas_por_pagar` may differ. Evidence pack RPC & briefing RPC consume many of these views; any view drift cascades. |
| Supabase-native | `agent_insights`, `agent_runs`, `agent_memory`, `ai_agents`, `agent_effectiveness`, `emails`, `departments`, `notification_queue`, `pipeline_logs`, `token_usage` (via `claude_cost_summary`), `data_quality_scorecard`, `odoo_sync_freshness` | `/inbox`, `/inbox/insight/[id]`, `/`, `/agents`, `/agents/[slug]`, `/system`, `/equipo` (insights), `/contacts` (active_insights), `/contacts/[id]`, `/companies/[id]` (recent_insights via evidence), `/briefings/[director]` | MEDIUM — `agent_insights.company_id` relies on FK to `companies`; triggers (`auto_link_invoice_company`, `route_insight`) can diverge from manual assignments. `isVisibleToCEO` filter applied on `/` and `/inbox` but NOT on `/agents/[slug]` insights list — CEO-hidden insights may appear in agent detail. Severity/state enums: seen in strings, no enum check at query time. |

---

## Part 5 — Risk hotspots (top 10 cross-page consistency issues to audit first)

1. **Three competing "cash available" numbers** — `/` shows `k.cash.total_mxn` (from RPC `get_dashboard_kpis`), `/finanzas` runway banner shows `cashMxn` from `financial_runway` view, `/finanzas` projection shows `summary.cash.effectiveMxn` (operative + in_transit, from RPC `get_projected_cash_flow_summary`), and `/finanzas` KPIs show `efectivoTotalMxn` from `cfo_dashboard`. Same label "Efectivo disponible / Cash" can differ. Affects: `/`, `/finanzas`, `/cobranza` (cfo snapshot KPIs).

2. **Two competing "runway days" numbers** — Dashboard RPC's `cash.runway_days` (used on `/`) vs `financial_runway.runway_days_net` (used on `/finanzas`). Verify both views/RPCs share the same burn-rate definition and the same cash basis. Affects: `/`, `/finanzas`.

3. **Self-company exclusion is applied inconsistently** — `getSelfCompanyIds()` is called in `dashboard.ts`, `invoices.ts`, `companies.ts` (list + page), `sales.ts`, `contacts.ts` (NO — not applied), but NOT in `getCompanyDetail`, `getCompanyInvoicesPage`, `getCompanyOrdersPage`, `getRfmSegments`, `getCollectionEffectiveness`, `getRevenueConcentration`, or inside `cfo_dashboard`/`pl_estado_resultados` views. Lists may exclude self-company while drill-down pages include it. Affects: `/companies/[id]` (all tabs), `/cobranza` CEI timeline, `/` tripwires vs at-risk panel.

4. **Salesperson/buyer/assignee are text not FK** — `odoo_sale_orders.salesperson_name`, `odoo_purchase_orders.buyer_name`, `odoo_activities.assigned_to`, `odoo_invoices.salesperson_name` are strings, populated once at sync time. Facet lists (`getOverdueSalespeopleOptions`, `getPurchaseBuyerOptions`, `getSaleOrderSalespeopleOptions`, `getManufacturingAssigneeOptions`) therefore derive from history and won't match live Odoo users after renames. Affects: `/cobranza`, `/ventas`, `/compras`, `/operaciones`, `/equipo` (user_id-based backlog does use FK — mismatch between "assigned_to" in activities vs odoo_user_id in agent_insights).

5. **`isVisibleToCEO` filter not applied uniformly** — `/` dashboard and `/inbox` filter cobranza insights by impact. `/agents/[slug]` insights tab and `/equipo` insights-by-department and `/contacts[id]` active_insights count include ALL cobranza insights. Same underlying `agent_insights` row can show on agent page + Equipo + CEO inbox with different filters. Affects: `/`, `/inbox`, `/agents/[slug]`, `/equipo`, `/contacts`, `/contacts/[id]`.

6. **Company-name sanitization gap** — `joinedCompanyName` + `sanitizeCompanyName` applied in invoice/delivery/order/contact joins (helpers.ts) but MV-derived names like `company_profile.name`, `rfm_segments.company_name`, `cash_flow_aging.company_name`, `client_reorder_predictions.company_name`, `revenue_concentration.company_name` are returned raw. A company named "11" or "—" will show up on `/companies`, `/cobranza`, `/ventas` reorder table, `/` tripwires but not on tables driven by FK join. Audit which pages render raw MV names.

7. **Two revenue-trend sources** — `/` uses `pl_estado_resultados.ingresos` (via `getRevenueTrend`); `/ventas` uses `monthly_revenue_by_company.net_revenue` (via `getSalesRevenueTrend`); the 12-month chart on both pages may not match. Also `/ventas` KPIs use `pl_estado_resultados` for `ingresosMes` but `monthly_revenue_by_company` for `ma3m` — within the same page two sources. Affects: `/`, `/ventas`, `/cobranza` (CFO).

8. **Margin computations diverge** — `product_margin_analysis.gross_margin_pct` is per-product×company; `getTopMarginProducts` rolls it up in memory weighted by revenue; `customer_margin_analysis.margin_pct_12m` is per-customer; `/ventas` top customers table shows `margin_pct_12m` while `/productos` top margin table shows the rolled-up weighted value. Potential double-counting or exclusion of same product×customer rows. Affects: `/ventas`, `/productos`.

9. **Evidence pack RPC is the single source for the Company 360 Overview tab + Insight detail timeline + briefings** — any regression in `company_evidence_pack` RPC shape cascades to 3 separate pages rendering `<EvidencePackView>` (`/companies/[id]`, `/inbox/insight/[id]`, `/briefings/[director]`). Additionally, `get_director_briefing` RPC returns packs with a `predictions` object that `company_evidence_pack` doesn't — the shared component has optional fields, so visual parity is not enforced. Audit shape contract.

10. **Aging bucket boundaries inconsistent** — `/cobranza` hero aging shows buckets `1-30 / 31-60 / 61-90 / 91-120 / 120+` (5 buckets) from `getArAging()` in-memory. `/cobranza` Company aging shows `1-30 / 31-60 / 61-90 / 90+` (4 buckets) from `cash_flow_aging` view. `/companies/[id]` invoice `days_overdue` is rendered raw (no bucket). A single overdue invoice at 100 days is "91-120" in one table and "90+" in another. Affects: `/cobranza` (hero vs company table), `/companies/[id]` (finance tab), `/` (CEO dashboard uses aggregated `total_overdue_mxn`).

---

**Key files for the next phase audit:**
- `/Users/jj/quimibond-intelligence/quimibond-intelligence/src/lib/queries/_helpers.ts` (self-company + sanitize helpers)
- `/Users/jj/quimibond-intelligence/quimibond-intelligence/src/lib/queries/finance.ts` (3-way cash basis)
- `/Users/jj/quimibond-intelligence/quimibond-intelligence/src/lib/queries/dashboard.ts` (RPC `get_dashboard_kpis`)
- `/Users/jj/quimibond-intelligence/quimibond-intelligence/src/lib/queries/invoices.ts` (bucket definitions)
- `/Users/jj/quimibond-intelligence/quimibond-intelligence/src/lib/queries/evidence.ts` (cross-page RPC)
- `/Users/jj/quimibond-intelligence/quimibond-intelligence/src/lib/queries/insights.ts` (`isVisibleToCEO`)
- `/Users/jj/addons/quimibond_intelligence/models/sync_push.py:464-2360` (push method inventory)