-- C4 — fix: refresh_canonical_company_financials cron falla por trigger roto
--
-- Síntoma: canonical_companies.total_receivable_mxn lleva horas/días stale.
-- Ej shawmut llc id=1606: stored $4.04M vs cómputo correcto $1.81M (diff $2.22M).
-- Agregado: $28.35M stored vs $25.03M correcto (drift $3.32M / 12.7%).
--
-- Causa raíz (encontrada en cron.job_run_details jobid=14): las últimas 6
-- corridas del cron `refresh_canonical_company_financials_hourly` (45 * * * *)
-- fallaron con:
--
--   ERROR: null value in column "source_id" of relation "source_links"
--          violates not-null constraint
--   PL/pgSQL function trg_source_link_company() line 4 at SQL statement
--
-- El trigger `trg_source_link_company` (que dispara on UPDATE de
-- canonical_companies) intenta INSERT en source_links con
--   source_id = (SELECT c.id::text FROM companies c
--                WHERE c.canonical_name = NEW.canonical_name LIMIT 1)
-- Para canonical_companies "shadow" (sin entrada en companies bronze) el
-- subquery devuelve NULL → constraint violation → el UPDATE entero hace
-- rollback → el cron falla → ningún canonical_company queda actualizado.
--
-- Caso concreto: canonical id=1840 / odoo_partner_id=8782 sin row en companies
-- (probablemente por gap en _push_contacts). Cualquier UPDATE de esa row dispara
-- el trigger que falla.
--
-- Fix: convertir el INSERT VALUES en INSERT SELECT con WHERE, así si companies
-- no tiene match el INSERT no genera ninguna row (en vez de generar una con NULL).
-- Mismo comportamiento para rows con match; idempotencia preservada via ON CONFLICT.

CREATE OR REPLACE FUNCTION public.trg_source_link_company()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.odoo_partner_id IS NOT NULL THEN
    -- INSERT solo si existe la row en companies bronze. Para shadows
    -- (canonical sin bronze) el SELECT no devuelve filas y no se inserta.
    INSERT INTO source_links (
      canonical_entity_type, canonical_entity_id, source, source_table,
      source_id, source_natural_key, match_method, match_confidence, matched_by
    )
    SELECT 'company', NEW.id::text, 'odoo', 'companies',
           c.id::text, NEW.odoo_partner_id::text,
           COALESCE(NEW.match_method, 'odoo_partner_id'),
           COALESCE(NEW.match_confidence, 0.99), 'system'
    FROM companies c
    WHERE c.canonical_name = NEW.canonical_name
    LIMIT 1
    ON CONFLICT (canonical_entity_type, source, source_id) WHERE superseded_at IS NULL DO NOTHING;
  END IF;

  IF NEW.rfc IS NOT NULL AND NEW.has_shadow_flag THEN
    INSERT INTO source_links (
      canonical_entity_type, canonical_entity_id, source, source_table,
      source_id, source_natural_key, match_method, match_confidence, matched_by
    )
    VALUES (
      'company', NEW.id::text, 'sat', 'syntage_invoices',
      NEW.rfc, NEW.rfc, 'sat_only', 0.50, 'system'
    )
    ON CONFLICT (canonical_entity_type, source, source_id) WHERE superseded_at IS NULL DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;
