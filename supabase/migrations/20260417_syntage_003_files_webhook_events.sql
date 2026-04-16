-- Syntage Fase 1 · Migration 003 — files + webhook_events
-- files: metadata de XMLs/PDFs descargados a Supabase Storage
-- webhook_events: idempotencia de eventos recibidos

CREATE TABLE public.syntage_files (
  id                          bigserial PRIMARY KEY,
  syntage_id                  text UNIQUE NOT NULL,
  taxpayer_rfc                text NOT NULL,
  odoo_company_id             int,
  file_type                   text NOT NULL,
  filename                    text,
  mime_type                   text,
  size_bytes                  bigint,
  storage_path                text,
  download_url_cached_until   timestamptz,
  raw_payload                 jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_syntage_files_taxpayer
  ON public.syntage_files (taxpayer_rfc, file_type);

ALTER TABLE public.syntage_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_files FROM anon, authenticated;

COMMENT ON TABLE public.syntage_files IS
  'Metadata of XML/PDF files downloaded from Syntage. Binary content lives in Storage bucket syntage-files.';

-- Idempotencia de webhooks: cada event_id visto se registra una vez.
CREATE TABLE public.syntage_webhook_events (
  event_id       text PRIMARY KEY,
  event_type     text NOT NULL,
  source         text NOT NULL DEFAULT 'webhook'
                 CHECK (source IN ('webhook', 'reconcile')),
  received_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_syntage_webhook_events_received
  ON public.syntage_webhook_events (received_at DESC);

ALTER TABLE public.syntage_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_webhook_events FROM anon, authenticated;

COMMENT ON TABLE public.syntage_webhook_events IS
  'Event-id deduplication. ON CONFLICT DO NOTHING guarantees at-most-once processing.';
