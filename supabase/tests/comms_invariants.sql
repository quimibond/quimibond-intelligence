-- Tests: detect_comms_unanswered_external_thread + auto-resolve
-- Run via: mcp__claude_ai_Supabase__execute_sql

DO $$
DECLARE
  v_company_id bigint;
  v_thread_id  bigint;
  v_issue_count int;
  v_resolved   timestamptz;
BEGIN
  -- Seed: temp company (FK requirement)
  INSERT INTO companies (name, canonical_name)
  VALUES ('__test_comms_invariant_a__', '__test_comms_invariant_a__')
  RETURNING id INTO v_company_id;

  -- Seed: 1 thread external 100h sin respuesta
  INSERT INTO threads (gmail_thread_id, account, company_id, last_sender_type,
                       hours_without_response, last_activity, message_count,
                       has_internal_reply, has_external_reply, status)
  VALUES ('test_invariant_a_' || extract(epoch from now()), 'test@example.com',
          v_company_id, 'external', 100, now() - interval '5 days',
          2, false, true, 'needs_response')
  RETURNING id INTO v_thread_id;

  -- TEST 1A: detect crea issue
  PERFORM detect_comms_unanswered_external_thread();
  SELECT count(*) INTO v_issue_count
    FROM reconciliation_issues
    WHERE issue_type = 'comms.unanswered_external_thread'
      AND canonical_entity_id = v_company_id::text
      AND (metadata->>'thread_id')::bigint = v_thread_id
      AND resolved_at IS NULL;
  IF v_issue_count = 1 THEN
    RAISE NOTICE 'TEST 1A PASSED: issue creado para thread externo no respondido';
  ELSE
    RAISE EXCEPTION 'TEST 1A FAILED: issue_count=%', v_issue_count;
  END IF;

  -- TEST 1B: flip thread a internal, re-detect, auto-resolve
  UPDATE threads SET last_sender_type = 'internal', hours_without_response = 0
    WHERE id = v_thread_id;
  PERFORM detect_comms_unanswered_external_thread();
  SELECT resolved_at INTO v_resolved
    FROM reconciliation_issues
    WHERE issue_type = 'comms.unanswered_external_thread'
      AND (metadata->>'thread_id')::bigint = v_thread_id;
  IF v_resolved IS NOT NULL THEN
    RAISE NOTICE 'TEST 1B PASSED: issue auto-resolved cuando thread se respondió';
  ELSE
    RAISE EXCEPTION 'TEST 1B FAILED: issue no auto-resolved';
  END IF;

  -- Cleanup
  DELETE FROM reconciliation_issues
    WHERE (metadata->>'thread_id')::bigint = v_thread_id;
  DELETE FROM threads WHERE id = v_thread_id;
  DELETE FROM companies WHERE id = v_company_id;
END $$;
