// ── Database types matching Supabase schema (March 2026 redesign) ──
// All IDs are bigint in Postgres but come as number via Supabase JS client
// Schema: 22 tables across 7 tiers

// ═══════════════════════════════════════════════════════════════
// TIER 1: CORE BUSINESS ENTITIES
// ═══════════════════════════════════════════════════════════════

export interface Company {
  id: number;
  canonical_name: string;
  name: string;
  odoo_partner_id: number | null;
  // Classification
  is_customer: boolean;
  is_supplier: boolean;
  industry: string | null;
  business_type: string | null;
  country: string | null;
  city: string | null;
  // Financial (from Odoo)
  lifetime_value: number | null;
  credit_limit: number | null;
  total_pending: number | null;
  total_credit_notes: number | null;
  monthly_avg: number | null;
  trend_pct: number | null;
  delivery_otd_rate: number | null;
  // Intelligence (from Claude)
  description: string | null;
  key_products: unknown;
  relationship_summary: string | null;
  relationship_type: string | null;
  risk_signals: unknown;
  opportunity_signals: unknown;
  strategic_notes: string | null;
  // Odoo context
  odoo_context: Record<string, unknown> | null;
  // Enrichment
  enriched_at: string | null;
  enrichment_source: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: number;
  email: string;
  name: string | null;
  company_id: number | null;
  odoo_partner_id: number | null;
  // Classification
  contact_type: string | null;
  department: string | null;
  is_customer: boolean;
  is_supplier: boolean;
  // Profile (consolidated from person_profiles)
  role: string | null;
  decision_power: string | null;
  communication_style: string | null;
  language_preference: string | null;
  key_interests: unknown;
  personality_notes: string | null;
  negotiation_style: string | null;
  response_pattern: string | null;
  influence_on_deals: string | null;
  // Scores
  relationship_score: number | null;
  sentiment_score: number | null;
  risk_level: string | null;
  payment_compliance_score: number | null;
  current_health_score: number | null;
  health_trend: string | null;
  // Financial
  lifetime_value: number | null;
  total_credit_notes: number | null;
  delivery_otd_rate: number | null;
  // Computed aggregates
  total_sent: number;
  total_received: number;
  avg_response_time_hours: number | null;
  interaction_count: number;
  last_activity: string | null;
  first_seen: string | null;
  open_alerts_count: number;
  pending_actions_count: number;
  // Odoo context
  odoo_context: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════
// TIER 2: COMMUNICATION
// ═══════════════════════════════════════════════════════════════

export interface Thread {
  id: number;
  gmail_thread_id: string;
  subject: string | null;
  subject_normalized: string | null;
  account: string;
  company_id: number | null;
  // Participants
  started_by: string | null;
  started_by_type: string | null;
  started_by_contact_id: number | null;
  last_sender: string | null;
  last_sender_type: string | null;
  participant_emails: string[];
  // Status
  status: string;
  message_count: number;
  has_internal_reply: boolean;
  has_external_reply: boolean;
  hours_without_response: number | null;
  // Timestamps
  started_at: string | null;
  last_activity: string | null;
  created_at: string;
  updated_at: string;
}

export interface Email {
  id: number;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  account: string;
  thread_id: number | null;
  sender_contact_id: number | null;
  company_id: number | null;
  // Content
  sender: string;
  recipient: string | null;
  subject: string | null;
  body: string | null;
  snippet: string | null;
  email_date: string | null;
  // Classification
  is_reply: boolean;
  sender_type: string | null;
  has_attachments: boolean;
  attachments: unknown;
  // Processing
  kg_processed: boolean;
  created_at: string;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════
// TIER 3: KNOWLEDGE GRAPH
// ═══════════════════════════════════════════════════════════════

export interface Entity {
  id: number;
  entity_type: string;
  canonical_name: string;
  name: string;
  email: string | null;
  odoo_model: string | null;
  odoo_id: number | null;
  attributes: Record<string, unknown>;
  mention_count: number;
  first_seen: string | null;
  last_seen: string | null;
  created_at: string;
  updated_at: string;
}

export interface Fact {
  id: number;
  entity_id: number;
  fact_type: string;
  fact_text: string;
  fact_hash: string | null;
  fact_date: string | null;
  confidence: number;
  verified: boolean;
  verification_source: string | null;
  verification_date: string | null;
  is_future: boolean;
  expired: boolean;
  source_type: string | null;
  source_account: string | null;
  extracted_at: string | null;
  created_at: string;
}

export interface EntityRelationship {
  id: number;
  entity_a_id: number;
  entity_b_id: number;
  relationship_type: string;
  strength: number | null;
  context: string | null;
  interaction_count: number;
  first_seen: string | null;
  last_seen: string | null;
  created_at: string;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════
// TIER 4: INTELLIGENCE OUTPUTS
// ═══════════════════════════════════════════════════════════════

export interface Alert {
  id: number;
  alert_type: string;
  severity: string;
  title: string;
  description: string | null;
  contact_id: number | null;
  contact_name: string | null;
  company_id: number | null;
  thread_id: number | null;
  account: string | null;
  // State
  state: string;
  is_read: boolean;
  resolved_at: string | null;
  resolution_notes: string | null;
  time_to_resolve_hours: number | null;
  // AI context
  business_impact: string | null;
  suggested_action: string | null;
  prediction_confidence: number | null;
  created_at: string;
  updated_at: string;
}

export interface ActionItem {
  id: number;
  action_type: string;
  action_category: string | null;
  description: string;
  reason: string | null;
  priority: string;
  // Linked entities
  contact_id: number | null;
  contact_name: string | null;
  contact_company: string | null;
  company_id: number | null;
  thread_id: number | null;
  // Assignment
  assignee_name: string | null;
  assignee_email: string | null;
  // State
  state: string;
  due_date: string | null;
  completed_at: string | null;
  // AI context
  prediction_confidence: number | null;
  created_at: string;
  updated_at: string;
}

/** Consolidated from daily_summaries + account_summaries */
export interface Briefing {
  id: number;
  scope: "daily" | "account" | "company" | "weekly";
  briefing_date: string;
  account: string | null;
  company_id: number | null;
  // Content
  title: string | null;
  summary_text: string | null;
  summary_html: string | null;
  // Metrics
  total_emails: number;
  key_events: unknown;
  topics_identified: unknown;
  risks_detected: unknown;
  overall_sentiment: string | null;
  sentiment_detail: Record<string, unknown> | null;
  // Account-scope
  department: string | null;
  external_emails: number;
  internal_emails: number;
  waiting_response: unknown;
  urgent_items: unknown;
  external_contacts: unknown;
  // Daily-scope
  accounts_processed: number;
  accounts_failed: number;
  // Metadata
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Topic {
  id: number;
  topic: string;
  category: string | null;
  status: string | null;
  priority: string | null;
  summary: string | null;
  company_id: number | null;
  related_accounts: string[] | null;
  times_seen: number;
  first_seen: string | null;
  last_seen: string | null;
  created_at: string;
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════
// TIER 5: METRICS & HISTORY
// ═══════════════════════════════════════════════════════════════

/** Renamed from CustomerHealthScore */
export interface HealthScore {
  id: number;
  contact_id: number | null;
  contact_email: string;
  company_id: number | null;
  score_date: string;
  overall_score: number | null;
  previous_score: number | null;
  trend: string | null;
  communication_score: number | null;
  financial_score: number | null;
  sentiment_score: number | null;
  responsiveness_score: number | null;
  engagement_score: number | null;
  payment_compliance_score: number | null;
  risk_signals: unknown;
  opportunity_signals: unknown;
  created_at: string;
}

export interface RevenueMetric {
  id: number;
  contact_email: string | null;
  contact_id: number | null;
  company_id: number | null;
  odoo_partner_id: number | null;
  period_type: string;
  period_start: string;
  period_end: string;
  total_invoiced: number;
  total_collected: number;
  pending_amount: number;
  overdue_amount: number;
  overdue_days_max: number;
  num_orders: number;
  avg_order_value: number;
  created_at: string;
  updated_at: string;
}

/** Consolidated from ResponseMetric + CommunicationPattern */
export interface CommunicationMetric {
  id: number;
  account: string;
  metric_date: string;
  // Volume
  emails_received: number;
  emails_sent: number;
  internal_received: number;
  external_received: number;
  // Threads
  threads_started: number;
  threads_replied: number;
  threads_unanswered: number;
  // Response times
  avg_response_hours: number | null;
  fastest_response_hours: number | null;
  slowest_response_hours: number | null;
  // Weekly patterns
  response_rate: number | null;
  top_external_contacts: string[] | null;
  top_internal_contacts: string[] | null;
  busiest_hour: number | null;
  common_subjects: string[] | null;
  sentiment_score: number | null;
  created_at: string;
  updated_at: string;
}

/** Renamed from CompanyOdooSnapshot */
export interface OdooSnapshot {
  id: number;
  company_id: number;
  snapshot_date: string;
  total_invoiced: number;
  pending_amount: number;
  overdue_amount: number;
  monthly_avg: number | null;
  credit_notes_total: number;
  open_orders_count: number;
  pending_deliveries_count: number;
  late_deliveries_count: number;
  crm_pipeline_value: number;
  crm_leads_count: number;
  manufacturing_count: number;
  created_at: string;
}

// ═══════════════════════════════════════════════════════════════
// TIER 6: ODOO INTEGRATION
// ═══════════════════════════════════════════════════════════════

export interface OdooProduct {
  id: number;
  odoo_product_id: number;
  name: string;
  internal_ref: string | null;
  category: string | null;
  uom: string;
  product_type: string | null;
  stock_qty: number;
  reserved_qty: number;
  available_qty: number;
  reorder_min: number;
  reorder_max: number;
  standard_price: number;
  list_price: number;
  active: boolean;
  updated_at: string;
}

export interface OdooOrderLine {
  id: number;
  odoo_order_id: number;
  odoo_partner_id: number;
  company_id: number | null;
  odoo_product_id: number | null;
  order_name: string;
  order_date: string | null;
  order_type: "sale" | "purchase";
  order_state: string | null;
  product_name: string;
  qty: number;
  price_unit: number;
  discount: number;
  subtotal: number;
  currency: string;
}

export interface OdooUser {
  id: number;
  odoo_user_id: number;
  name: string;
  email: string | null;
  department: string | null;
  job_title: string | null;
  pending_activities_count: number;
  overdue_activities_count: number;
  activities_json: unknown[];
  updated_at: string;
}

// ═══════════════════════════════════════════════════════════════
// TIER 7: SYSTEM & OPERATIONS
// ═══════════════════════════════════════════════════════════════

export interface SyncState {
  account: string;
  last_history_id: string | null;
  emails_synced: number;
  last_sync_at: string | null;
  updated_at: string;
}

export interface PipelineRun {
  id: string;
  run_type: string;
  status: "running" | "completed" | "failed" | "partial";
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  emails_processed: number;
  alerts_generated: number;
  actions_generated: number;
  errors: unknown[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface PipelineLog {
  id: string;
  run_id: string | null;
  level: string;
  phase: string | null;
  message: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface ChatMemory {
  id: number;
  question: string;
  answer: string;
  context_used: Record<string, unknown> | null;
  rating: number | null;
  thumbs_up: boolean | null;
  times_retrieved: number;
  saved_at: string | null;
}

export interface FeedbackSignal {
  id: number;
  source_type: string;
  source_id: number | null;
  signal_type: string;
  reward_score: number | null;
  context: Record<string, unknown> | null;
  account: string | null;
  contact_email: string | null;
  reward_processed: boolean;
  created_at: string;
}

// ═══════════════════════════════════════════════════════════════
// RPC RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════

export interface DashboardKPI {
  open_alerts: number;
  critical_alerts: number;
  pending_actions: number;
  overdue_actions: number;
  at_risk_contacts: number;
  total_contacts: number;
  total_emails: number;
  completed_actions: number;
  resolved_alerts: number;
}

export interface DashboardOverdueAction {
  id: number;
  description: string;
  contact_name: string | null;
  contact_company: string | null;
  assignee_email: string | null;
  assignee_name: string | null;
  due_date: string;
  priority: string;
  action_type: string;
  days_overdue: number;
}

export interface DashboardCriticalAlert {
  id: number;
  title: string;
  severity: string;
  contact_name: string | null;
  description: string | null;
  created_at: string;
  alert_type: string;
}

export interface DashboardContactAtRisk {
  id: number;
  name: string;
  company: string | null;
  risk_level: string;
  sentiment_score: number | null;
  relationship_score: number | null;
  open_alerts: number;
  pending_actions: number;
}

export interface DirectorDashboard {
  kpi: DashboardKPI;
  overdue_actions: DashboardOverdueAction[];
  critical_alerts: DashboardCriticalAlert[];
  accountability: {
    name: string;
    email: string | null;
    pending: number;
    overdue: number;
    completed: number;
  }[];
  contacts_at_risk: DashboardContactAtRisk[];
  latest_briefing: Briefing | null;
  pending_actions: DashboardOverdueAction[];
}

// ── Type aliases for backwards compatibility during migration ──
/** @deprecated Use HealthScore instead */
export type CustomerHealthScore = HealthScore;
/** @deprecated Use OdooSnapshot instead */
export type CompanyOdooSnapshot = OdooSnapshot;
/** @deprecated Use CommunicationMetric instead */
export type ResponseMetric = CommunicationMetric;
/** @deprecated Use Briefing with scope='daily' instead */
export type DailySummary = Briefing;
/** @deprecated Use Briefing with scope='account' instead */
export type AccountSummary = Briefing;
