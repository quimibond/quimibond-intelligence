// ── Database types matching REAL Supabase schema (March 2026) ──
// All IDs are bigint in Postgres but come as number via Supabase JS client

export interface Contact {
  id: number;
  email: string | null;
  name: string | null;
  company: string | null;
  contact_type: string | null;
  department: string | null;
  total_sent: number;
  total_received: number;
  avg_response_time_hours: number | null;
  last_activity: string | null;
  first_seen: string | null;
  risk_level: string | null;
  relationship_score: number | null;
  sentiment_score: number | null;
  // Profile data (written by backend directly to contacts)
  role: string | null;
  decision_power: string | null;
  communication_style: string | null;
  language_preference: string | null;
  key_interests: unknown;
  personality_notes: string | null;
  negotiation_style: string | null;
  response_pattern: string | null;
  influence_on_deals: string | null;
  interaction_count: number | null;
  // Health & business
  current_health_score: number | null;
  health_trend: string | null;
  lifetime_value: number | null;
  open_alerts_count: number | null;
  pending_actions_count: number | null;
  total_credit_notes: number | null;
  delivery_otd_rate: number | null;
  payment_compliance_score: number | null;
  odoo_context: Record<string, unknown> | null;
  // Odoo refs
  odoo_partner_id: number | null;
  is_customer: boolean | null;
  is_supplier: boolean | null;
  company_id: number | null;
  entity_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface Company {
  id: number;
  name: string;
  canonical_name: string | null;
  odoo_partner_id: number | null;
  entity_id: number | null;
  is_customer: boolean;
  is_supplier: boolean;
  industry: string | null;
  lifetime_value: number | null;
  total_credit_notes: number | null;
  delivery_otd_rate: number | null;
  credit_limit: number | null;
  total_pending: number | null;
  monthly_avg: number | null;
  trend_pct: number | null;
  odoo_context: Record<string, unknown> | null;
  description: string | null;
  business_type: string | null;
  key_products: unknown;
  relationship_summary: string | null;
  relationship_type: string | null;
  country: string | null;
  city: string | null;
  risk_signals: unknown;
  opportunity_signals: unknown;
  strategic_notes: string | null;
  enriched_at: string | null;
  enrichment_source: string | null;
  created_at: string;
  updated_at: string;
}


export interface Thread {
  id: number;
  gmail_thread_id: string | null;
  subject: string | null;
  subject_normalized: string | null;
  started_by: string | null;
  started_by_type: string | null;
  started_at: string | null;
  last_activity: string | null;
  status: string | null;
  message_count: number;
  participant_emails: string[];
  has_internal_reply: boolean;
  has_external_reply: boolean;
  last_sender: string | null;
  last_sender_type: string | null;
  hours_without_response: number | null;
  account: string | null;
  created_at: string;
  updated_at: string;
}

export interface Email {
  id: number;
  account: string | null;
  sender: string | null;
  recipient: string | null;
  subject: string | null;
  body: string | null;
  snippet: string | null;
  email_date: string | null;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  attachments: unknown;
  is_reply: boolean;
  sender_type: string | null;
  has_attachments: boolean;
  kg_processed: boolean;
  created_at: string;
  updated_at: string;
}

export interface Alert {
  id: number;
  alert_type: string;
  severity: string;
  title: string;
  description: string | null;
  contact_name: string | null;
  contact_id: number | null;
  company_id: number | null;
  account: string | null;
  state: string;
  is_read: boolean;
  is_resolved: boolean;
  prediction_id: string | null;
  prediction_confidence: number | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface ActionItem {
  id: number;
  action_type: string;
  description: string;
  contact_name: string | null;
  contact_id: number | null;
  company_id: number | null;
  priority: string;
  due_date: string | null;
  state: string;
  status: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  assignee_entity_id: number | null;
  related_entity_id: number | null;
  contact_company: string | null;
  source_thread_id: string | null;
  completed_date: string | null;
  completed_at: string | null;
  prediction_id: string | null;
  prediction_confidence: number | null;
  created_at: string;
  updated_at: string;
}

export interface DailySummary {
  id: number;
  summary_date: string | null;
  summary_html: string | null;
  summary_text: string | null;
  total_emails: number;
  accounts_read: number | null;
  accounts_failed: number | null;
  topics_identified: number | null;
  key_events: unknown;
  created_at: string;
}

export interface Entity {
  id: number;
  entity_type: string;
  name: string;
  canonical_name: string | null;
  email: string | null;
  odoo_model: string | null;
  odoo_id: number | null;
  attributes: Record<string, unknown>;
  first_seen: string | null;
  last_seen: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntityRelationship {
  id: number;
  entity_a_id: number;
  entity_b_id: number;
  relationship_type: string;
  strength: number | null;
  context: string | null;
  first_seen: string | null;
  last_seen: string | null;
  created_at: string;
  updated_at: string;
}

export interface Fact {
  id: number;
  entity_id: number | null;
  fact_type: string | null;
  fact_text: string;
  verified: boolean;
  verification_source: string | null;
  verification_date: string | null;
  confidence: number;
  fact_date: string | null;
  is_future: boolean;
  expired: boolean;
  source_account: string | null;
  source_type: string | null;
  fact_hash: string | null;
  extracted_at: string | null;
  created_at: string;
}

export interface Topic {
  id: number;
  topic: string;
  category: string | null;
  status: string | null;
  priority: string | null;
  summary: string | null;
  related_accounts: string[] | null;
  first_seen: string | null;
  last_seen: string | null;
  times_seen: number | null;
  created_at: string;
  updated_at: string;
}

export interface SyncState {
  account: string;
  last_history_id: string | null;
  last_sync_at: string | null;
  emails_synced: number;
  updated_at: string;
}

export interface CustomerHealthScore {
  id: number;
  contact_id: number | null;
  contact_email: string | null;
  score_date: string;
  overall_score: number | null;
  trend: string | null;
  communication_score: number | null;
  financial_score: number | null;
  sentiment_score: number | null;
  responsiveness_score: number | null;
  engagement_score: number | null;
  payment_compliance_score: number | null;
  risk_signals: unknown;
  opportunity_signals: unknown;
  company_id: number | null;
  created_at: string;
}

// ── Phase 2 types (matching REAL Supabase schema) ──

export interface ChatMemory {
  id: number;
  question: string;
  answer: string;
  context_used: Record<string, unknown> | null;
  saved_at: string | null;
  rating: number | null;
  thumbs_up: boolean | null;
  times_retrieved: number;
}


export interface FeedbackSignal {
  id: number;
  signal_source: string | null;
  source_id: number | null;
  source_type: string | null;
  signal_type: string | null;
  reward_score: number | null;
  context: Record<string, unknown> | null;
  account: string | null;
  contact_email: string | null;
  created_at: string;
  reward_processed: boolean;
}

export interface CommunicationPattern {
  id: number;
  week_start: string | null;
  account: string | null;
  total_emails: number;
  response_rate: number | null;
  avg_response_hours: number | null;
  top_external_contacts: string[] | null;
  top_internal_contacts: string[] | null;
  busiest_hour: number | null;
  common_subjects: string[] | null;
  sentiment_score: number | null;
  created_at: string;
}

export interface CompanyOdooSnapshot {
  id: number;
  company_id: number | null;
  snapshot_date: string;
  total_invoiced: number;
  pending_amount: number;
  overdue_amount: number;
  monthly_avg: number | null;
  open_orders_count: number;
  pending_deliveries_count: number;
  late_deliveries_count: number;
  crm_pipeline_value: number | null;
  crm_leads_count: number;
  manufacturing_count: number;
  credit_notes_total: number | null;
  created_at: string;
}

export interface AccountSummary {
  id: number;
  account: string;
  department: string | null;
  summary_date: string;
  summary_text: string | null;
  overall_sentiment: string | null;
  sentiment_detail: Record<string, unknown> | null;
  total_emails: number;
  external_emails: number;
  internal_emails: number;
  key_items: unknown;
  waiting_response: unknown;
  urgent_items: unknown;
  external_contacts: unknown;
  risks_detected: unknown;
  topics_detected: unknown;
  created_at: string;
  updated_at: string;
}

export interface ResponseMetric {
  id: number;
  account: string;
  metric_date: string;
  avg_response_hours: number | null;
  emails_received: number;
  emails_sent: number;
  internal_received: number;
  external_received: number;
  threads_started: number;
  threads_replied: number;
  threads_unanswered: number;
  fastest_response_hours: number | null;
  slowest_response_hours: number | null;
  created_at: string;
  updated_at: string;
}

export interface PredictionOutcome {
  id: number;
  prediction_type: string;
  prediction_id: number | null;
  prediction_date: string | null;
  prediction_summary: string | null;
  predicted_severity: string | null;
  confidence: number | null;
  outcome_type: string | null;
  outcome_date: string | null;
  outcome_summary: string | null;
  outcome_data: Record<string, unknown> | null;
  accuracy_score: number | null;
  account: string | null;
  contact_email: string | null;
  created_at: string;
  verified_at: string | null;
}

export interface SystemLearning {
  id: number;
  learning_date: string | null;
  learning_type: string | null;
  description: string | null;
  data: Record<string, unknown> | null;
  account: string | null;
  created_at: string;
}

export interface AlertTypeCatalog {
  id: number;
  alert_type: string;
  display_name: string | null;
  description: string | null;
  default_severity: string | null;
  category: string | null;
  is_active: boolean;
  created_at: string;
}

export interface TopicCategoryCatalog {
  id: number;
  canonical_name: string;
  aliases: string[] | null;
  department_emails: string[] | null;
  display_order: number | null;
  created_at: string;
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

// ── RPC response types ──

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
  accountability: { name: string; email: string | null; pending: number; overdue: number; completed: number }[];
  contacts_at_risk: DashboardContactAtRisk[];
  latest_briefing: DailySummary | null;
  pending_actions: DashboardOverdueAction[];
}
