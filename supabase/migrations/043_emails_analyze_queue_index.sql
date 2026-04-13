-- Fase 2 del plan "fix-director-data-integrity":
-- Indice para el hot path del analyze pipeline.
--
-- El endpoint /api/pipeline/analyze corre:
--   SELECT ... FROM emails
--   WHERE kg_processed=false
--     AND email_date >= (o <) cutoff
--   ORDER BY email_date ASC LIMIT 250
--
-- Con 110k rows, sin indice dedicado escanea toda la tabla en cada cron
-- (12 veces/hr) × 2 scopes = 24 scans/hr. El indice parcial mata eso.

CREATE INDEX IF NOT EXISTS idx_emails_analyze_queue
  ON emails (email_date ASC)
  WHERE kg_processed = false;
