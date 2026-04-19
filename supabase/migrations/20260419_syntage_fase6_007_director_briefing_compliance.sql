-- Fase 6 · 007: agrega branch 'compliance' a get_director_briefing().
-- Replica la firma existente. La branch 'compliance' selecciona companies
-- con más reconciliation_issues abiertos de severity critical/high.
-- El resto del body (feedback, evidence_packs, instructions) se mantiene igual.
-- Nota: la función original NO tiene SECURITY DEFINER (prosecdef=false), solo STABLE.

CREATE OR REPLACE FUNCTION public.get_director_briefing(
  p_director text,
  p_max_companies int DEFAULT 5
) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_company_ids bigint[];
  v_packs jsonb := '[]'::jsonb;
  v_company_id bigint;
  v_pack jsonb;
  v_feedback jsonb;
  v_agent_id int;
BEGIN
  SELECT id INTO v_agent_id FROM ai_agents WHERE slug = p_director;

  CASE p_director
    WHEN 'comercial' THEN
      SELECT array_agg(company_id ORDER BY priority DESC) INTO v_company_ids
      FROM (
        SELECT company_id,
          (CASE WHEN churn_risk_score > 60 THEN 30 ELSE 0 END
           + CASE WHEN days_since_last_order > interval '60 days' THEN 20 ELSE 0 END
           + COALESCE(revenue_12m, 0) / 1000000.0
          ) as priority
        FROM customer_ltv_health
        WHERE (churn_risk_score > 40 OR days_since_last_order > interval '45 days') AND revenue_12m > 50000
        LIMIT p_max_companies
      ) sub;
    WHEN 'financiero' THEN
      SELECT array_agg(company_id ORDER BY overdue_mxn DESC) INTO v_company_ids
      FROM (
        SELECT company_id, sum(COALESCE(amount_residual_mxn, amount_residual)) as overdue_mxn
        FROM odoo_invoices WHERE move_type = 'out_invoice' AND state = 'posted' AND payment_state IN ('not_paid','partial') AND days_overdue > 0
        GROUP BY company_id ORDER BY overdue_mxn DESC LIMIT p_max_companies
      ) sub;
    WHEN 'compras' THEN
      SELECT array_agg(supplier_id) INTO v_company_ids
      FROM (SELECT supplier_id FROM supplier_concentration_herfindahl WHERE is_single_source LIMIT p_max_companies) sub;
    WHEN 'operaciones' THEN
      SELECT array_agg(company_id) INTO v_company_ids
      FROM (SELECT company_id FROM odoo_deliveries WHERE is_late GROUP BY company_id ORDER BY count(*) DESC LIMIT p_max_companies) sub;
    WHEN 'costos' THEN
      SELECT array_agg(DISTINCT company_id) INTO v_company_ids
      FROM (SELECT company_id FROM product_margin_analysis WHERE margin_pct < 15 AND total_orders > 2 ORDER BY revenue_loss_potential DESC NULLS LAST LIMIT p_max_companies) sub;
    WHEN 'riesgo' THEN
      SELECT array_agg(company_id) INTO v_company_ids
      FROM (SELECT company_id FROM portfolio_concentration WHERE pct_of_total > 3 ORDER BY pct_of_total DESC LIMIT p_max_companies) sub;
    WHEN 'equipo' THEN
      SELECT array_agg(company_id) INTO v_company_ids
      FROM (SELECT company_id FROM odoo_activities WHERE is_overdue AND company_id IS NOT NULL GROUP BY company_id ORDER BY count(*) DESC LIMIT p_max_companies) sub;
    WHEN 'compliance' THEN
      -- Fase 6: companies con más reconciliation_issues abiertos de severity critical/high.
      -- Fallback si company_id IS NULL (RFCs foráneos): se ignoran — compliance se enfoca
      -- en contrapartes linkeadas a Odoo. Los unlinked quedan en el context builder vía
      -- syntage_top_unlinked_rfcs RPC, no en el briefing.
      SELECT array_agg(company_id ORDER BY n DESC) INTO v_company_ids
      FROM (
        SELECT company_id, count(*) AS n
        FROM public.reconciliation_issues
        WHERE resolved_at IS NULL
          AND severity IN ('critical', 'high')
          AND company_id IS NOT NULL
        GROUP BY company_id
        ORDER BY n DESC
        LIMIT p_max_companies
      ) sub;
    ELSE RETURN jsonb_build_object('error', 'Unknown director');
  END CASE;

  IF v_company_ids IS NOT NULL THEN
    FOREACH v_company_id IN ARRAY v_company_ids LOOP
      v_packs := v_packs || company_evidence_pack(v_company_id);
    END LOOP;
  END IF;

  SELECT jsonb_build_object(
    'accepted_patterns', (SELECT jsonb_agg(content) FROM (SELECT content FROM agent_memory WHERE agent_id = v_agent_id AND memory_type = 'pattern' AND times_used > 0 ORDER BY times_used DESC LIMIT 3) s),
    'recent_acted_titles', (SELECT jsonb_agg(title) FROM (SELECT title FROM agent_insights WHERE agent_id = v_agent_id AND state = 'acted_on' ORDER BY created_at DESC LIMIT 5) s),
    'follow_up_results', (SELECT jsonb_agg(jsonb_build_object('title', original_title, 'result', status, 'note', resolution_note)) FROM (SELECT * FROM insight_follow_ups WHERE status IN ('improved','worsened') ORDER BY resolved_at DESC LIMIT 5) s)
  ) INTO v_feedback;

  RETURN jsonb_build_object(
    'director', p_director,
    'generated_at', now(),
    'companies_analyzed', coalesce(array_length(v_company_ids, 1), 0),
    'evidence_packs', v_packs,
    'agent_feedback', COALESCE(v_feedback, '{}'::jsonb),
    'instructions', format(
      'Eres el director de %s en Quimibond (fabricante textil mexicano). '
      'Abajo tienes %s empresas que necesitan tu atencion HOY con evidencia completa: '
      'datos financieros (todo en MXN), historial de pedidos, comunicacion por email con fechas, '
      'entregas y actividades vencidas. '
      'Genera MAXIMO 3 insights. Cada uno DEBE: '
      '1) Nombrar la PERSONA especifica que debe actuar (vendedor/comprador de los datos) con su email '
      '2) Citar NUMEROS DE FACTURA u orden especificos como evidencia '
      '3) Incluir el monto en riesgo en MXN '
      '4) Dar una accion concreta con fecha limite '
      '5) NO repetir insights que ya aparecen en history.recent_insights de esa empresa',
      p_director, coalesce(array_length(v_company_ids, 1), 0)
    )
  );
END;
$$;
