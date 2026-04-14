import "server-only";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Evidence pack queries — llaman a los RPCs canónicos del backend:
 * - `company_evidence_pack(p_company_id)` → 1 pack con todas las dimensiones
 * - `get_director_briefing(p_director, p_max_companies)` → briefing con packs[]
 *
 * El shape es el que devuelve el RPC en producción. Nunca lo reinterpretamos —
 * lo consumimos tal cual en los componentes.
 */

// ──────────────────────────────────────────────────────────────────────────
// Shape canónico (1:1 con JSONB del RPC)
// ──────────────────────────────────────────────────────────────────────────
export interface EvidencePackFinancials {
  total_invoiced_12m: number;
  total_overdue_mxn: number;
  overdue_invoices:
    | Array<{
        name: string;
        amount_mxn: number;
        days_overdue: number;
        due_date: string;
      }>
    | null;
  avg_days_to_pay: number | null;
  credit_notes_12m: number;
  payables_overdue_mxn: number;
}

export interface EvidencePackOrders {
  total_orders_12m: number;
  last_order_date: string | null;
  days_since_last_order: number | null;
  avg_order_mxn: number | null;
  revenue_trend: {
    last_3m: number;
    prev_3m: number;
  };
  salesperson: string | null;
  salesperson_email: string | null;
  top_products:
    | Array<{
        product: string;
        ref: string;
        total_mxn: number;
      }>
    | null;
}

export interface EvidencePackCommunication {
  total_emails: number;
  last_email_date: string | null;
  days_since_last_email: number | null;
  unanswered_threads: number;
  recent_threads:
    | Array<{
        subject: string;
        last_sender: string;
        hours_waiting: number;
        has_our_reply: boolean;
      }>
    | null;
  key_contacts:
    | Array<{
        name: string;
        email: string;
      }>
    | null;
}

export interface EvidencePackDeliveries {
  total_deliveries_90d: number;
  late_deliveries: number;
  otd_rate: number | null;
  pending_shipments: number;
  late_details:
    | Array<{
        name: string;
        scheduled: string;
        origin: string;
      }>
    | null;
}

export interface EvidencePackActivities {
  total_pending: number;
  overdue: number;
  overdue_detail:
    | Array<{
        type: string;
        summary: string;
        assigned_to: string;
        deadline: string;
      }>
    | null;
}

export interface EvidencePackHistory {
  recent_insights:
    | Array<{
        title: string;
        state: string;
        category: string;
        created: string;
      }>
    | null;
  health_trend:
    | Array<{
        date: string;
        score: number;
      }>
    | null;
}

/**
 * Predicciones adicionales que solo devuelve `get_director_briefing` (NO el
 * `company_evidence_pack` básico). Todas las subsecciones pueden ser null.
 */
export interface EvidencePackPredictions {
  payment: {
    payment_risk: string;
    payment_trend: string | null;
    avg_days_to_pay: number | null;
    median_days_to_pay: number | null;
    avg_recent_6m: number | null;
    avg_older: number | null;
    max_days_overdue: number | null;
    pending_count: number;
    total_pending: number;
    predicted_payment_date: string | null;
  } | null;
  reorder: {
    reorder_status: string;
    avg_cycle_days: number | null;
    days_since_last: number | null;
    days_overdue_reorder: number | null;
    avg_order_value: number | null;
    total_revenue: number | null;
    predicted_next_order: string | null;
    top_product_ref: string | null;
    salesperson_name: string | null;
    salesperson_email: string | null;
  } | null;
  cashflow: {
    total_receivable: number | null;
    expected_collection: number | null;
    collection_probability: number | null;
  } | null;
  ltv_health: {
    customer_status: string | null;
    churn_risk_score: number | null;
    overdue_risk_score: number | null;
    trend_pct: number | null;
  } | null;
}

export interface EvidencePack {
  company_id: number;
  company_name: string;
  tier: "strategic" | "important" | "standard" | null;
  is_customer: boolean;
  is_supplier: boolean;
  /** True si la empresa es la propia Quimibond (relationship_type='self').
   *  El frontend muestra un banner "Empresa propia" en lugar de KPIs. */
  is_self?: boolean;
  rfc: string | null;
  credit_limit: number | null;
  financials: EvidencePackFinancials;
  orders: EvidencePackOrders;
  communication: EvidencePackCommunication;
  deliveries: EvidencePackDeliveries;
  activities: EvidencePackActivities;
  history: EvidencePackHistory;
  /** Solo presente en packs de get_director_briefing, no en company_evidence_pack */
  predictions?: EvidencePackPredictions | null;
}

// ──────────────────────────────────────────────────────────────────────────
// RPC wrappers
// ──────────────────────────────────────────────────────────────────────────
export async function getCompanyEvidencePack(
  companyId: number
): Promise<EvidencePack | null> {
  const sb = getServiceClient();
  const { data, error } = await sb.rpc("company_evidence_pack", {
    p_company_id: companyId,
  });
  if (error) {
    console.error("[company_evidence_pack]", error.message);
    return null;
  }
  if (!data) return null;
  return data as EvidencePack;
}

export type DirectorSlug =
  | "comercial"
  | "financiero"
  | "operaciones"
  | "compras"
  | "riesgo"
  | "equipo"
  | "costos";

export interface DirectorBriefing {
  director: DirectorSlug;
  generated_at: string;
  companies_analyzed: number;
  instructions: string | null;
  agent_feedback?: {
    accepted_patterns?: unknown;
    follow_up_results?: unknown;
    recent_acted_titles?: string[] | null;
  } | null;
  evidence_packs: EvidencePack[];
}

export async function getDirectorBriefing(
  director: DirectorSlug,
  maxCompanies = 5
): Promise<DirectorBriefing | null> {
  const sb = getServiceClient();
  const { data, error } = await sb.rpc("get_director_briefing", {
    p_director: director,
    p_max_companies: maxCompanies,
  });
  if (error) {
    console.error("[get_director_briefing]", error.message);
    return null;
  }
  if (!data) return null;
  return data as DirectorBriefing;
}

export const DIRECTOR_LABELS: Record<DirectorSlug, string> = {
  comercial: "Comercial",
  financiero: "Financiero",
  operaciones: "Operaciones",
  compras: "Compras",
  riesgo: "Riesgo",
  equipo: "Equipo",
  costos: "Costos",
};
