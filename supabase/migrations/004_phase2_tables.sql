-- ============================================================
-- Migration 004: Phase 2 tables from qb19 backend
-- chat_memory, feedback_signals, communication_patterns,
-- company_snapshots, account_summaries, response_metrics,
-- daily_summaries, prediction_outcomes, learning
-- ============================================================

-- ── 1. Chat memory (few-shot learning) ─────────────────────
CREATE TABLE IF NOT EXISTS chat_memory (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question      text NOT NULL,
  answer        text NOT NULL,
  context_used  jsonb DEFAULT '{}',
  rating        text CHECK (rating IN ('positive', 'neutral', 'negative')),
  times_retrieved integer DEFAULT 0,
  saved_at      timestamptz DEFAULT now(),
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_memory_rating ON chat_memory (rating);

-- ── 2. Feedback signals ────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback_signals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   text NOT NULL,
  entity_id     uuid,
  signal_type   text NOT NULL,
  signal_value  numeric(5,2) DEFAULT 0,
  source        text,
  metadata      jsonb DEFAULT '{}',
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_entity ON feedback_signals (entity_type, entity_id);

-- ── 3. Communication patterns ──────────────────────────────
CREATE TABLE IF NOT EXISTS communication_patterns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      uuid REFERENCES contacts(id) ON DELETE CASCADE,
  contact_email   text,
  pattern_type    text,
  day_of_week     integer,
  hour_of_day     integer,
  avg_response_hours numeric(8,2),
  email_frequency numeric(8,2),
  preferred_channel text,
  analysis_period text,
  metadata        jsonb DEFAULT '{}',
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comm_patterns_contact ON communication_patterns (contact_id);

-- ── 4. Company snapshots (time-series) ─────────────────────
CREATE TABLE IF NOT EXISTS company_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid,
  company_name    text,
  snapshot_date   date NOT NULL,
  total_invoiced  numeric(12,2) DEFAULT 0,
  total_pending   numeric(12,2) DEFAULT 0,
  total_overdue   numeric(12,2) DEFAULT 0,
  active_contacts integer DEFAULT 0,
  open_alerts     integer DEFAULT 0,
  health_score    numeric(5,2),
  risk_level      text,
  trend           text,
  metadata        jsonb DEFAULT '{}',
  created_at      timestamptz DEFAULT now(),
  UNIQUE (company_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_company_snapshots_date ON company_snapshots (snapshot_date DESC);

-- ── 5. Account summaries (per-email-account analysis) ──────
CREATE TABLE IF NOT EXISTS account_summaries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account         text NOT NULL,
  department      text,
  summary_date    date NOT NULL,
  summary_text    text,
  overall_sentiment text,
  sentiment_score numeric(5,2),
  total_emails    integer DEFAULT 0,
  external_count  integer DEFAULT 0,
  internal_count  integer DEFAULT 0,
  key_items       jsonb DEFAULT '[]',
  waiting_response jsonb DEFAULT '[]',
  urgent_items    jsonb DEFAULT '[]',
  risks_detected  jsonb DEFAULT '[]',
  competitors_mentioned jsonb DEFAULT '[]',
  topics_detected jsonb DEFAULT '[]',
  created_at      timestamptz DEFAULT now(),
  UNIQUE (account, summary_date)
);

CREATE INDEX IF NOT EXISTS idx_account_summaries_date ON account_summaries (summary_date DESC);

-- ── 6. Response metrics (per-account KPIs) ─────────────────
CREATE TABLE IF NOT EXISTS response_metrics (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account             text NOT NULL,
  metric_date         date NOT NULL,
  avg_response_hours  numeric(8,2),
  median_response_hours numeric(8,2),
  total_threads       integer DEFAULT 0,
  threads_responded   integer DEFAULT 0,
  threads_pending     integer DEFAULT 0,
  threads_stalled     integer DEFAULT 0,
  response_rate       numeric(5,2),
  created_at          timestamptz DEFAULT now(),
  UNIQUE (account, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_response_metrics_date ON response_metrics (metric_date DESC);

-- ── 7. Prediction outcomes (track ML predictions vs reality) ─
CREATE TABLE IF NOT EXISTS prediction_outcomes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id     uuid,
  prediction_type   text NOT NULL,
  entity_type       text,
  entity_id         uuid,
  predicted_value   text,
  actual_value      text,
  confidence        numeric(5,2),
  was_correct       boolean,
  evaluated_at      timestamptz,
  metadata          jsonb DEFAULT '{}',
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prediction_type ON prediction_outcomes (prediction_type);

-- ── 8. Learning (system learnings from feedback) ───────────
CREATE TABLE IF NOT EXISTS learning (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_type   text NOT NULL,
  description     text NOT NULL,
  evidence        jsonb DEFAULT '{}',
  confidence      numeric(5,2) DEFAULT 0.5,
  applied         boolean DEFAULT false,
  applied_at      timestamptz,
  created_at      timestamptz DEFAULT now()
);

-- ── 9. Daily summaries (consolidated) ──────────────────────
-- Note: daily_summaries may overlap with existing briefings table.
-- This table stores the raw consolidated daily summary from the pipeline.
CREATE TABLE IF NOT EXISTS daily_summaries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_date    date NOT NULL UNIQUE,
  summary_html    text,
  summary_text    text,
  total_emails    integer DEFAULT 0,
  accounts_read   integer DEFAULT 0,
  accounts_failed integer DEFAULT 0,
  topics_identified integer DEFAULT 0,
  key_events      jsonb DEFAULT '[]',
  alerts_generated integer DEFAULT 0,
  actions_generated integer DEFAULT 0,
  pipeline_run_id uuid,
  created_at      timestamptz DEFAULT now()
);

-- ── 10. Pipeline runs (execution logs) ─────────────────────
-- May already exist from migration 001; create if not exists.
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type        text NOT NULL,
  status          text DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'partial')),
  started_at      timestamptz DEFAULT now(),
  completed_at    timestamptz,
  duration_seconds numeric(10,2),
  emails_processed integer DEFAULT 0,
  alerts_generated integer DEFAULT 0,
  actions_generated integer DEFAULT 0,
  errors          jsonb DEFAULT '[]',
  metadata        jsonb DEFAULT '{}',
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started ON pipeline_runs (started_at DESC);

-- ── 11. Pipeline logs (detailed) ───────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  level         text DEFAULT 'info',
  phase         text,
  message       text,
  details       jsonb DEFAULT '{}',
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_logs_run ON pipeline_logs (run_id, created_at);

-- ── 12. Sync state (Gmail history tracking) ────────────────
CREATE TABLE IF NOT EXISTS sync_state (
  account         text PRIMARY KEY,
  last_history_id text,
  last_sync_at    timestamptz,
  emails_synced   integer DEFAULT 0,
  error_count     integer DEFAULT 0,
  last_error      text,
  updated_at      timestamptz DEFAULT now()
);

-- ── 13. RLS for all new tables ─────────────────────────────
ALTER TABLE chat_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE response_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_chat_memory" ON chat_memory FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_feedback_signals" ON feedback_signals FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_comm_patterns" ON communication_patterns FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_company_snapshots" ON company_snapshots FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_account_summaries" ON account_summaries FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_response_metrics" ON response_metrics FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_prediction_outcomes" ON prediction_outcomes FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_learning" ON learning FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_daily_summaries" ON daily_summaries FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_pipeline_runs" ON pipeline_runs FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_pipeline_logs" ON pipeline_logs FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_sync_state" ON sync_state FOR SELECT TO anon USING (true);

-- Allow frontend to insert chat_memory and feedback_signals
CREATE POLICY "anon_insert_chat_memory" ON chat_memory FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_insert_feedback" ON feedback_signals FOR INSERT TO anon WITH CHECK (true);

-- ── 14. RPC: Get account performance summary ──────────────
CREATE OR REPLACE FUNCTION get_account_performance(p_days int DEFAULT 7)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  result json;
BEGIN
  SELECT coalesce(json_agg(row_to_json(r)), '[]'::json) INTO result
  FROM (
    SELECT
      rm.account,
      AVG(rm.avg_response_hours) as avg_response_hours,
      SUM(rm.total_threads) as total_threads,
      SUM(rm.threads_responded) as threads_responded,
      SUM(rm.threads_stalled) as threads_stalled,
      AVG(rm.response_rate) as response_rate
    FROM response_metrics rm
    WHERE rm.metric_date >= CURRENT_DATE - p_days
    GROUP BY rm.account
    ORDER BY AVG(rm.avg_response_hours) ASC
  ) r;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_account_performance(int) TO anon;

-- ── 15. RPC: Get pipeline status ───────────────────────────
CREATE OR REPLACE FUNCTION get_pipeline_status()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'recent_runs', (
      SELECT coalesce(json_agg(row_to_json(r)), '[]'::json)
      FROM (
        SELECT id, run_type, status, started_at, completed_at,
               duration_seconds, emails_processed, alerts_generated,
               actions_generated, errors
        FROM pipeline_runs
        ORDER BY started_at DESC
        LIMIT 20
      ) r
    ),
    'sync_state', (
      SELECT coalesce(json_agg(row_to_json(s)), '[]'::json)
      FROM (
        SELECT account, last_history_id, last_sync_at, emails_synced,
               error_count, last_error, updated_at
        FROM sync_state
        ORDER BY account
      ) s
    )
  ) INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_pipeline_status() TO anon;
