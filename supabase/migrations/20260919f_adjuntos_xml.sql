-- 2026-09-19f — Los XML adjuntos (CFDI del SAT incluidos) entran a la memoria.
--
-- Al mover el SAT a Odoo (2026-09-17) el clasificador del ingest marcaba todo
-- XML como skipped/cfdi_xml y nunca se bajaba. El CEO pidió extraerlos
-- (2026-09-18): attachments-extract ahora los resume (emisor, receptor,
-- totales, conceptos, pagos, nómina) con _shared/xml-text.ts; el XML crudo con
-- sello y certificado no sirve para buscar. Se re-encolan los de 2026:
-- los saltados y los 419 que quedaron `done` con el XML crudo (se rehacen
-- como resumen). Son archivos de ~7 KB: la cola los absorbe en horas.
UPDATE email_attachments a
   SET extract_status = 'pending', skip_reason = NULL, attempts = 0, claimed_at = NULL,
       extracted_text = NULL, last_error = NULL, updated_at = now()
  FROM emails e
 WHERE e.id = a.email_id AND e.email_date >= '2026-01-01'
   AND (lower(a.filename) LIKE '%.xml' OR a.mime_type IN ('text/xml', 'application/xml', 'xml'))
   AND ((a.extract_status = 'skipped' AND a.skip_reason = 'cfdi_xml')
        OR (a.extract_status = 'done' AND a.extracted_text LIKE '%<?xml%'));

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES ('info', 'migration', 'Adjuntos XML (CFDI) re-encolados para extraerlos como resumen legible',
        jsonb_build_object('migration', '20260919f_adjuntos_xml'));
