-- Test: comms_timeline RPC
-- Run via: mcp__claude_ai_Supabase__execute_sql con este SQL completo
-- Expected: 4 raises NOTICE 'TEST PASSED' al final.

DO $$
DECLARE
  v_company_id bigint;
  v_contact_id bigint := -999002;
  v_thread_a   bigint;
  v_thread_b   bigint;
  v_count      int;
  v_severity   text;
BEGIN
  -- Seed: temp company (threads.company_id has FK to companies)
  INSERT INTO companies (name, canonical_name)
  VALUES ('__test_comms_timeline__', '__test_comms_timeline__')
  RETURNING id INTO v_company_id;

  -- Seed: 2 threads para v_company_id
  INSERT INTO threads (gmail_thread_id, account, company_id, last_sender_type,
                       hours_without_response, last_activity, message_count,
                       has_internal_reply, has_external_reply, status)
  VALUES ('test_thread_a_' || extract(epoch from now()), 'test@example.com',
          v_company_id, 'external', 200, now() - interval '8 days',
          3, false, true, 'needs_response')
  RETURNING id INTO v_thread_a;

  INSERT INTO threads (gmail_thread_id, account, company_id, last_sender_type,
                       hours_without_response, last_activity, message_count,
                       has_internal_reply, has_external_reply, status)
  VALUES ('test_thread_b_' || extract(epoch from now()), 'test@example.com',
          v_company_id, 'internal', 0, now() - interval '1 hour',
          5, true, true, 'active')
  RETURNING id INTO v_thread_b;

  -- TEST 1: company external scope returns both threads (both have has_external_reply=true),
  -- and at least one row has severity='high' (thread_a: 200h external)
  SELECT count(*) INTO v_count
    FROM comms_timeline('company', v_company_id, 'external', 25, 0);
  SELECT severity INTO v_severity
    FROM comms_timeline('company', v_company_id, 'external', 25, 0)
    WHERE thread_id = v_thread_a;
  IF v_count = 2 AND v_severity = 'high' THEN
    RAISE NOTICE 'TEST 1 PASSED: external returns both with at least one high';
  ELSE
    RAISE EXCEPTION 'TEST 1 FAILED: count=%, thread_a severity=%', v_count, v_severity;
  END IF;

  -- TEST 2: thread_a alone qualifies as 'high' (>168h)
  SELECT severity INTO v_severity
    FROM comms_timeline('company', v_company_id, 'external', 25, 0)
    WHERE thread_id = v_thread_a;
  IF v_severity = 'high' THEN
    RAISE NOTICE 'TEST 2 PASSED: thread_a severity=high';
  ELSE
    RAISE EXCEPTION 'TEST 2 FAILED: thread_a severity=%', v_severity;
  END IF;

  -- TEST 3: invalid entity_type raises
  BEGIN
    PERFORM * FROM comms_timeline('invalid', 1, 'external', 25, 0);
    RAISE EXCEPTION 'TEST 3 FAILED: should have raised on invalid entity_type';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%Unknown entity_type%' THEN
      RAISE NOTICE 'TEST 3 PASSED: rejects invalid entity_type';
    ELSE
      RAISE;
    END IF;
  END;

  -- TEST 4: pagination total_count constant across pages
  DECLARE
    v_total_p1 bigint;
    v_total_p2 bigint;
  BEGIN
    SELECT total_count INTO v_total_p1
      FROM comms_timeline('company', v_company_id, 'external', 1, 0);
    SELECT total_count INTO v_total_p2
      FROM comms_timeline('company', v_company_id, 'external', 1, 1);
    IF v_total_p1 = v_total_p2 AND v_total_p1 = 2 THEN
      RAISE NOTICE 'TEST 4 PASSED: total_count=2 stable across pages';
    ELSE
      RAISE EXCEPTION 'TEST 4 FAILED: p1=%, p2=%', v_total_p1, v_total_p2;
    END IF;
  END;

  -- Cleanup
  DELETE FROM threads WHERE id IN (v_thread_a, v_thread_b);
  DELETE FROM companies WHERE id = v_company_id;
END $$;
