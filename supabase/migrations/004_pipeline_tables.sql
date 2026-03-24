-- ============================================================
-- Migration 004: Pipeline tracking tables
-- Only pipeline_runs and pipeline_logs were missing from Supabase.
-- All other tables already exist (created by qb19 backend).
-- ============================================================

-- ── 1. Pipeline runs (execution logs) ──────────────────────
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

-- ── 2. Pipeline logs (detailed per-phase logs) ─────────────
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

-- ── 3. RLS ─────────────────────────────────────────────────
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_pipeline_runs" ON pipeline_runs FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_pipeline_logs" ON pipeline_logs FOR SELECT TO anon USING (true);
