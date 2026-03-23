// ── Database types matching Supabase schema ──

export interface Contact {
  id: string;
  email: string | null;
  name: string | null;
  company: string | null;
  contact_type: string | null;
  risk_level: "low" | "medium" | "high";
  sentiment_score: number | null;
  relationship_score: number | null;
  last_interaction: string | null;
  total_emails: number;
  tags: string[];
  phone: string | null;
  city: string | null;
  country: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonProfile {
  id: string;
  contact_id: string | null;
  canonical_key: string | null;
  name: string | null;
  email: string | null;
  company: string | null;
  role: string | null;
  department: string | null;
  decision_power: string | null;
  communication_style: string | null;
  personality_traits: string[];
  interests: string[];
  decision_factors: string[];
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface Thread {
  id: string;
  gmail_thread_id: string | null;
  subject: string | null;
  status: string | null;
  message_count: number;
  participant_emails: string[];
  hours_without_response: number | null;
  last_sender: string | null;
  last_sender_type: string | null;
  account: string | null;
  created_at: string;
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
  sender_type: string | null;
  has_attachments: boolean;
  kg_processed: boolean;
  created_at: string;
}

export interface Alert {
  id: string;
  alert_type: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string | null;
  contact_name: string | null;
  contact_id: string | null;
  account: string | null;
  state: "new" | "acknowledged" | "resolved";
  is_read: boolean;
  business_impact: string | null;
  suggested_action: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface ActionItem {
  id: string;
  action_type: string;
  description: string;
  contact_name: string | null;
  contact_id: string | null;
  priority: "low" | "medium" | "high";
  due_date: string | null;
  state: "pending" | "completed" | "dismissed";
  status: string | null;
  assignee_email: string | null;
  reason: string | null;
  contact_company: string | null;
  source_thread_id: string | null;
  completed_date: string | null;
  created_at: string;
}

export interface Briefing {
  id: string;
  briefing_type: string;
  period_start: string | null;
  period_end: string | null;
  summary: string | null;
  html_content: string | null;
  account_email: string | null;
  model_used: string | null;
  created_at: string;
}

export interface Entity {
  id: string;
  entity_type: string;
  name: string;
  canonical_name: string | null;
  email: string | null;
  attributes: Record<string, unknown>;
  last_seen: string | null;
  created_at: string;
}

export interface EntityRelationship {
  id: string;
  entity_a_id: string;
  entity_b_id: string;
  relationship_type: string;
  confidence: number;
  created_at: string;
}

export interface Fact {
  id: string;
  contact_id: string | null;
  email_id: number | null;
  fact_text: string;
  fact_type: string | null;
  source_type: string;
  confidence: number;
  created_at: string;
}

export interface Topic {
  id: string;
  name: string;
  category: string | null;
  created_at: string;
}

export interface SyncState {
  id: string;
  account: string;
  last_history_id: string | null;
  emails_synced: number;
  updated_at: string;
}

export interface CommunicationPattern {
  id: string;
  contact_id: string | null;
  pattern_type: string | null;
  description: string | null;
  frequency: string | null;
  confidence: number;
  created_at: string;
}

export interface DailySummary {
  id: string;
  account: string | null;
  summary_date: string | null;
  email_count: number;
  summary: string | null;
  key_events: unknown[];
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
  id: string;
  description: string;
  contact_name: string | null;
  contact_company: string | null;
  assignee_email: string | null;
  assignee_name: string | null;
  due_date: string;
  priority: string;
  reason: string | null;
  action_type: string;
  days_overdue: number;
}

export interface DashboardCriticalAlert {
  id: string;
  title: string;
  severity: string;
  contact_name: string | null;
  description: string | null;
  business_impact: string | null;
  suggested_action: string | null;
  created_at: string;
  alert_type: string;
}

export interface DashboardAccountability {
  name: string;
  email: string | null;
  pending: number;
  overdue: number;
  completed: number;
}

export interface DashboardContactAtRisk {
  id: string;
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
  accountability: DashboardAccountability[];
  contacts_at_risk: DashboardContactAtRisk[];
  latest_briefing: Briefing | null;
  pending_actions: DashboardOverdueAction[];
}

// ── Company (aggregated from entities + contacts) ──

export interface CompanyInfo {
  id: string;
  name: string;
  canonical_name: string | null;
  attributes: Record<string, unknown>;
  last_seen: string | null;
  contact_count: number;
  contacts: Contact[];
  facts: Fact[];
  relationships: Array<{
    type: string;
    confidence: number;
    entity: Entity;
  }>;
  open_alerts: number;
  pending_actions: number;
}
