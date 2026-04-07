-- Migration 033: Fix company-email matching
--
-- Problems solved:
-- 1. Trigger auto_link_email_company_by_domain assigns internal-sender emails
--    (from @quimibond.com) to wrong companies (e.g., KUKA MANUFACTURA).
--    Fix: for internal senders, match by RECIPIENT domain instead.
-- 2. Fake "companies" created from individual contact names
--    (e.g., "Acosta, Mario", "Elancheran, Monica Lakshmi") steal emails
--    from the real company (CONTITECH MEXICANA).
--    Fix: prefer companies with is_company-like indicators and exclude internal domains.
-- 3. Continental/Contitech domain fragmentation:
--    contitech.com.mx, contitech.com, continental.com, bk.contitech.com.mx
--    all belong to the same corporate group.
--    Fix: data cleanup + domain aliasing via re-linking.

-- ============================================================================
-- Step 1: Fix the email→company trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION auto_link_email_company_by_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _match_text text;
  _matched_id bigint;
  _internal_domains text[] := ARRAY['quimibond.com', 'quimibond.com.mx'];
BEGIN
  IF NEW.company_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- For internal senders → look at RECIPIENT to find external company
  -- For external senders → look at SENDER
  IF NEW.sender_type = 'internal'
     OR NEW.sender ILIKE '%@quimibond.com%'
     OR NEW.sender ILIKE '%@quimibond.com.mx%' THEN
    _match_text := NEW.recipient;
  ELSE
    _match_text := NEW.sender;
  END IF;

  IF _match_text IS NULL OR _match_text NOT LIKE '%@%' THEN
    RETURN NEW;
  END IF;

  -- Match to company by domain, excluding internal domains.
  -- Prefer real companies (uppercase name = Odoo convention, has odoo_partner_id).
  SELECT c.id INTO _matched_id
  FROM companies c
  WHERE c.domain IS NOT NULL
    AND c.domain != ''
    AND NOT (c.domain = ANY(_internal_domains))
    AND _match_text ILIKE '%@' || c.domain || '%'
    AND c.name = upper(c.name)  -- real companies have uppercase names from Odoo
  ORDER BY
    (c.odoo_partner_id IS NOT NULL) DESC,
    c.is_customer DESC,
    c.lifetime_value DESC NULLS LAST
  LIMIT 1;

  -- Fallback: any matching company (but still exclude internal)
  IF _matched_id IS NULL THEN
    SELECT c.id INTO _matched_id
    FROM companies c
    WHERE c.domain IS NOT NULL
      AND c.domain != ''
      AND NOT (c.domain = ANY(_internal_domains))
      AND _match_text ILIKE '%@' || c.domain || '%'
    ORDER BY
      (c.odoo_partner_id IS NOT NULL) DESC,
      c.lifetime_value DESC NULLS LAST
    LIMIT 1;
  END IF;

  NEW.company_id := _matched_id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- ============================================================================
-- Step 2: Data cleanup — merge fake "person" companies into real ones
-- Continental/Contitech corporate group consolidation
-- ============================================================================

-- 2a. Link CONTINENTAL (id from canonical_name 'continental') to
--     CONTITECH MEXICANA by updating all references.
--     All these are the same corporate group.

-- First, get the real company ID for CONTITECH MEXICANA
DO $$
DECLARE
  _real_id bigint;
  _fake_ids bigint[];
BEGIN
  -- The real company
  SELECT id INTO _real_id FROM companies WHERE canonical_name = 'contitech mexicana';

  IF _real_id IS NULL THEN
    RAISE NOTICE 'CONTITECH MEXICANA not found, skipping cleanup';
    RETURN;
  END IF;

  -- Fake companies to merge (contact names stored as companies)
  SELECT array_agg(id) INTO _fake_ids
  FROM companies
  WHERE id != _real_id
    AND (
      domain IN ('continental.com', 'contitech.com', 'bk.contitech.com.mx')
      OR canonical_name IN ('continental')
    )
    AND canonical_name != 'bh continental spinning mills';  -- different company

  IF _fake_ids IS NULL OR array_length(_fake_ids, 1) IS NULL THEN
    RAISE NOTICE 'No fake companies to merge';
    RETURN;
  END IF;

  RAISE NOTICE 'Merging % fake companies into CONTITECH MEXICANA (id=%)', array_length(_fake_ids, 1), _real_id;

  -- Re-link emails
  UPDATE emails SET company_id = _real_id
  WHERE company_id = ANY(_fake_ids);

  -- Re-link threads
  UPDATE threads SET company_id = _real_id
  WHERE company_id = ANY(_fake_ids);

  -- Re-link contacts
  UPDATE contacts SET company_id = _real_id
  WHERE company_id = ANY(_fake_ids);

  -- Re-link action_items
  UPDATE action_items SET company_id = _real_id
  WHERE company_id = ANY(_fake_ids);

  -- Re-link agent_insights
  UPDATE agent_insights SET company_id = _real_id
  WHERE company_id = ANY(_fake_ids);

  -- Re-link health_scores
  UPDATE health_scores SET company_id = _real_id
  WHERE company_id = ANY(_fake_ids);

  -- Delete fake company records
  DELETE FROM companies WHERE id = ANY(_fake_ids);

  RAISE NOTICE 'Cleanup complete for CONTITECH MEXICANA';
END;
$$;

-- ============================================================================
-- Step 3: Re-process emails that were wrongly assigned to internal companies
-- (emails sent BY quimibond TO external companies were linked to Quimibond/KUKA)
-- ============================================================================

-- Null out company_id for internal-sender emails linked to internal-domain companies
-- so the trigger can re-process them on next identity resolution
UPDATE emails e
SET company_id = NULL
WHERE e.sender_type = 'internal'
  AND e.company_id IN (
    SELECT c.id FROM companies c
    WHERE c.domain IN ('quimibond.com', 'quimibond.com.mx')
  );

-- ============================================================================
-- Step 4: Run re-linking for all unlinked emails
-- Uses the improved trigger logic via a batch update
-- ============================================================================
CREATE OR REPLACE FUNCTION relink_orphan_emails()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _count int := 0;
  _email record;
  _match_text text;
  _matched_id bigint;
  _internal_domains text[] := ARRAY['quimibond.com', 'quimibond.com.mx'];
BEGIN
  FOR _email IN
    SELECT id, sender, recipient, sender_type
    FROM emails
    WHERE company_id IS NULL
    ORDER BY email_date DESC
    LIMIT 2000
  LOOP
    -- Same logic as trigger
    IF _email.sender_type = 'internal'
       OR _email.sender ILIKE '%@quimibond.com%'
       OR _email.sender ILIKE '%@quimibond.com.mx%' THEN
      _match_text := _email.recipient;
    ELSE
      _match_text := _email.sender;
    END IF;

    IF _match_text IS NULL OR _match_text NOT LIKE '%@%' THEN
      CONTINUE;
    END IF;

    _matched_id := NULL;

    -- Prefer real companies (uppercase names from Odoo)
    SELECT c.id INTO _matched_id
    FROM companies c
    WHERE c.domain IS NOT NULL
      AND c.domain != ''
      AND NOT (c.domain = ANY(_internal_domains))
      AND _match_text ILIKE '%@' || c.domain || '%'
      AND c.name = upper(c.name)
    ORDER BY
      (c.odoo_partner_id IS NOT NULL) DESC,
      c.is_customer DESC,
      c.lifetime_value DESC NULLS LAST
    LIMIT 1;

    -- Fallback
    IF _matched_id IS NULL THEN
      SELECT c.id INTO _matched_id
      FROM companies c
      WHERE c.domain IS NOT NULL
        AND c.domain != ''
        AND NOT (c.domain = ANY(_internal_domains))
        AND _match_text ILIKE '%@' || c.domain || '%'
      ORDER BY
        (c.odoo_partner_id IS NOT NULL) DESC,
        c.lifetime_value DESC NULLS LAST
      LIMIT 1;
    END IF;

    IF _matched_id IS NOT NULL THEN
      UPDATE emails SET company_id = _matched_id WHERE id = _email.id;
      _count := _count + 1;
    END IF;
  END LOOP;

  RETURN _count;
END;
$$;

-- Run the re-linking
SELECT relink_orphan_emails();
