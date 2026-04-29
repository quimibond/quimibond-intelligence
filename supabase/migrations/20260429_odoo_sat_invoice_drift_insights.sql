-- Reporte agregado de "Drift Odoo ↔ SAT facturas" para agent_insights.
-- Promueve cada invariant_key invoice-related con >0 issues a UN insight
-- agregado con counts + sample IDs + recommendation. Evita saturar el inbox
-- con 1,235 insights individuales.

CREATE TABLE IF NOT EXISTS odoo_sat_drift_invariant_metadata (
  invariant_key text PRIMARY KEY,
  category text NOT NULL DEFAULT 'datos',
  insight_severity text NOT NULL,
  human_title_template text NOT NULL,
  human_description text NOT NULL,
  human_recommendation text NOT NULL
);

INSERT INTO odoo_sat_drift_invariant_metadata
  (invariant_key, insight_severity, human_title_template, human_description, human_recommendation)
VALUES
  ('invoice.ap_sat_only_drift', 'medium',
   '%s facturas SAT recibidas (AP) sin invoice en Odoo',
   'CFDIs de proveedores que aparecen en SAT (vía Syntage) pero no fueron capturados en Odoo como factura de proveedor. Suele ser captura manual pendiente del área de cuentas por pagar.',
   'En Odoo: capturar las facturas faltantes (Invoicing > Vendors > Bills > Create) usando el UUID y datos del CFDI.'),
  ('invoice.pending_operationalization', 'medium',
   '%s facturas SAT sin operacionalizar en Odoo',
   'CFDIs en SAT que aún no tienen estado operativo (posted/draft/cancelled) en Odoo. Indica gap en el flujo de captura.',
   'En Odoo: revisar facturas en draft o capturar las que faltan; verificar el sync diario.'),
  ('invoice.amount_mismatch', 'high',
   '%s facturas con monto distinto entre Odoo y SAT',
   'El total facturado en Odoo difiere del total CFDI emitido/recibido. Puede ser captura errónea, descuentos no reflejados, o redondeo.',
   'En Odoo: ajustar el monto de la factura para que coincida con el CFDI timbrado, o re-emitir el CFDI si el correcto es Odoo.'),
  ('invoice.ar_sat_only_drift', 'high',
   '%s CFDIs emitidos (AR) sin invoice en Odoo',
   'Facturas que se timbraron en SAT pero no quedaron en Odoo. Generalmente significan ventas sin trazabilidad ERP.',
   'En Odoo: capturar la factura de venta correspondiente (Invoicing > Customers > Invoices) o validar si fue emitida fuera del flujo normal.'),
  ('invoice.amount_diff_post_fx', 'high',
   '%s facturas con diferencia de monto post-FX',
   'Después de convertir a MXN, los montos de Odoo y SAT difieren. Suele ser tipo de cambio aplicado distinto.',
   'En Odoo: revisar el tipo de cambio de la factura. Si la diferencia es del CFDI, ajustar Odoo.'),
  ('invoice.state_mismatch_posted_cancelled', 'high',
   '%s facturas con estado inconsistente Odoo↔SAT',
   'Una posted en un lado y cancelled en el otro. Riesgo fiscal: contabilizar una factura cancelada o no contabilizar una vigente.',
   'En Odoo: cancelar las que están canceladas en SAT, o re-timbrar las canceladas pero vigentes en Odoo.'),
  ('invoice.date_drift', 'medium',
   '%s facturas con fecha distinta Odoo↔SAT',
   'La fecha de la factura difiere entre Odoo y SAT. Puede afectar reportes mensuales y declaraciones.',
   'En Odoo: alinear fecha al CFDI (que es la fiscalmente vinculante).'),
  ('invoice.ar_odoo_only_drift', 'high',
   '%s facturas en Odoo (AR) sin CFDI emitido',
   'Facturas posted en Odoo que no tienen CFDI en SAT. NO timbradas — riesgo de no facturación válida.',
   'En Odoo: timbrar la factura (botón "Send & Print" o re-procesar PAC) o cancelarla si no debería existir.'),
  ('invoice.credit_note_orphan', 'medium',
   '%s notas de crédito sin invoice padre',
   'NCs en SAT/Odoo sin la factura original asociada.',
   'En Odoo: ligar manualmente la NC a la factura original (Reverse > select invoice).'),
  ('invoice.missing_sat_timbrado', 'medium',
   '%s facturas Odoo posted sin UUID timbrado',
   'Facturas marcadas como posted en Odoo pero sin UUID del SAT (sin CFDI). Requiere timbrado urgente.',
   'En Odoo: timbrar la factura o cambiar a draft/cancelled si no debería estar posted.')
ON CONFLICT (invariant_key) DO UPDATE SET
  insight_severity = EXCLUDED.insight_severity,
  human_title_template = EXCLUDED.human_title_template,
  human_description = EXCLUDED.human_description,
  human_recommendation = EXCLUDED.human_recommendation;

-- Función agregadora
DROP FUNCTION IF EXISTS detect_invoice_drift_insights();

CREATE OR REPLACE FUNCTION detect_invoice_drift_insights()
RETURNS TABLE(out_invariant_key text, out_open_count int, out_action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id bigint;
  v_agent_id bigint := 8;
  v_meta record;
  v_open_count int;
  v_total_impact numeric;
  v_sample_ids uuid[];
  v_existing_insight_id bigint;
  v_action text;
BEGIN
  INSERT INTO agent_runs (agent_id, status, trigger_type, metadata)
  VALUES (v_agent_id, 'running', 'scheduled',
          jsonb_build_object('source','detect_invoice_drift_insights'))
  RETURNING id INTO v_run_id;

  FOR v_meta IN SELECT * FROM odoo_sat_drift_invariant_metadata LOOP
    SELECT COUNT(*), COALESCE(SUM(impact_mxn),0),
           (SELECT array_agg(issue_id) FROM (
              SELECT issue_id FROM reconciliation_issues
              WHERE invariant_key = v_meta.invariant_key
                AND resolved_at IS NULL
              ORDER BY priority_score DESC NULLS LAST, age_days DESC NULLS LAST
              LIMIT 5
           ) s)
    INTO v_open_count, v_total_impact, v_sample_ids
    FROM reconciliation_issues
    WHERE invariant_key = v_meta.invariant_key AND resolved_at IS NULL;

    SELECT id INTO v_existing_insight_id
    FROM agent_insights
    WHERE insight_type = 'odoo_sat_invoice_drift'
      AND state IN ('new','seen')
      AND evidence->>'invariant_key' = v_meta.invariant_key
    ORDER BY created_at DESC LIMIT 1;

    IF v_open_count = 0 THEN
      IF v_existing_insight_id IS NOT NULL THEN
        UPDATE agent_insights SET state='acted_on', updated_at=now()
        WHERE id = v_existing_insight_id;
        v_action := 'archived';
      ELSE
        v_action := 'noop';
      END IF;
    ELSE
      IF v_existing_insight_id IS NULL THEN
        INSERT INTO agent_insights (
          agent_id, run_id, insight_type, category, severity,
          title, description, evidence, recommendation,
          state, assignee_department, business_impact_estimate
        )
        VALUES (
          v_agent_id, v_run_id, 'odoo_sat_invoice_drift', v_meta.category, v_meta.insight_severity,
          format(v_meta.human_title_template, v_open_count),
          v_meta.human_description,
          jsonb_build_object(
            'invariant_key', v_meta.invariant_key,
            'open_count', v_open_count,
            'total_impact_mxn', v_total_impact,
            'sample_issue_ids', to_jsonb(v_sample_ids)
          ),
          v_meta.human_recommendation,
          'new', 'datos', NULLIF(v_total_impact, 0)
        );
        v_action := 'new';
      ELSE
        UPDATE agent_insights
        SET title = format(v_meta.human_title_template, v_open_count),
            evidence = evidence || jsonb_build_object(
              'open_count', v_open_count,
              'total_impact_mxn', v_total_impact,
              'sample_issue_ids', to_jsonb(v_sample_ids),
              'last_refreshed', now()
            ),
            business_impact_estimate = NULLIF(v_total_impact, 0),
            updated_at = now()
        WHERE id = v_existing_insight_id;
        v_action := 'refreshed';
      END IF;
    END IF;

    out_invariant_key := v_meta.invariant_key;
    out_open_count := v_open_count;
    out_action := v_action;
    RETURN NEXT;
  END LOOP;

  UPDATE agent_runs SET status='completed', completed_at=now(),
    duration_seconds = EXTRACT(EPOCH FROM (now() - started_at))
  WHERE id = v_run_id;
END;
$$;

COMMENT ON FUNCTION detect_invoice_drift_insights() IS
'Promueve reconciliation_issues invoice-related a agent_insights agregados (1 insight por invariant_key con counts + sample). Schedule: daily 06:30 UTC.';

DO $$ BEGIN
  PERFORM cron.unschedule('odoo_sat_invoice_drift_daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('odoo_sat_invoice_drift_daily', '30 6 * * *',
  $cron$ SELECT public.detect_invoice_drift_insights(); $cron$);
