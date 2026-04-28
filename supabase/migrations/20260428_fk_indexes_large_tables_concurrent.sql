-- FK indexes en tablas grandes (>30k filas).
-- Aplicado en prod via execute_sql con CREATE INDEX CONCURRENTLY para evitar
-- lock de tabla. CONCURRENTLY no puede correr dentro de transaccion, asi que
-- esta migration documenta el cambio y es idempotente (IF NOT EXISTS).
--
-- Si se re-aplica via supabase migrate, las CREATE INDEX seran sin
-- CONCURRENTLY pero IF NOT EXISTS las hara no-op (indices ya existen).
--
-- Sizes al momento de aplicar:
--   emails: 117k rows / 531 MB
--   syntage_invoices: 130k rows / 333 MB
--   canonical_invoices: 84k rows / 94 MB
--   ai_extracted_facts: 32k rows / 17 MB

CREATE INDEX IF NOT EXISTS idx_emails_thread_id
  ON public.emails(thread_id);

CREATE INDEX IF NOT EXISTS idx_syntage_invoices_company_id
  ON public.syntage_invoices(company_id);

CREATE INDEX IF NOT EXISTS idx_canonical_invoices_salesperson_contact_id
  ON public.canonical_invoices(salesperson_contact_id);

CREATE INDEX IF NOT EXISTS idx_ai_extracted_facts_superseded_by
  ON public.ai_extracted_facts(superseded_by);
