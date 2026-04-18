-- Fase 5 PR 4 · Migrate cfdi_documents data → email_cfdi_links
-- Copy rows with valid uuid to email_cfdi_links (empty before this).

INSERT INTO public.email_cfdi_links (email_id, gmail_message_id, account, uuid, linked_at)
SELECT email_id, gmail_message_id, account, uuid, COALESCE(parsed_at, now())
FROM public.cfdi_documents
WHERE uuid IS NOT NULL AND uuid <> ''
ON CONFLICT DO NOTHING;
