-- 20260427_classify_counterparties_rpc.sql
--
-- RPC `classify_counterparties()` — recalcula counterparty_type_auto y
-- customer_lifecycle_auto en canonical_companies según reglas
-- documentadas en migration 20260427_counterparty_classification.sql.
--
-- Idempotente, re-ejecutable. Solo toca *_auto (nunca *_manual).
-- Retorna summary stats por bucket para validar la cobertura.

CREATE OR REPLACE FUNCTION classify_counterparties()
RETURNS TABLE (
  classification text,
  bucket text,
  company_count bigint
) LANGUAGE plpgsql AS $$
BEGIN
  -- ── 1. counterparty_type_auto ──────────────────────────────────────────
  -- Reglas en orden de prioridad. Cada CASE WHEN match tiene precedencia
  -- sobre los siguientes (intercom > blacklisted > gobierno > financiera
  -- > utility > one_off > operativo).
  WITH stats AS (
    SELECT
      cc.id,
      LOWER(COALESCE(cc.display_name, '')) AS name_lower,
      cc.rfc,
      cc.is_internal,
      cc.is_related_party,
      cc.blacklist_level,
      COALESCE((
        SELECT COUNT(*) FROM canonical_invoices ci
        WHERE ci.receptor_canonical_company_id = cc.id
          AND ci.direction = 'issued'
          AND COALESCE(ci.estado_sat, 'vigente') <> 'cancelado'
      ), 0) + COALESCE((
        SELECT COUNT(*) FROM canonical_invoices ci
        WHERE ci.emisor_canonical_company_id = cc.id
          AND ci.direction = 'received'
          AND COALESCE(ci.estado_sat, 'vigente') <> 'cancelado'
      ), 0) AS total_invoice_count,
      GREATEST(
        COALESCE((
          SELECT MAX(ci.amount_total_mxn_resolved) FROM canonical_invoices ci
          WHERE ci.receptor_canonical_company_id = cc.id AND ci.direction = 'issued'
        ), 0),
        COALESCE((
          SELECT MAX(ci.amount_total_mxn_resolved) FROM canonical_invoices ci
          WHERE ci.emisor_canonical_company_id = cc.id AND ci.direction = 'received'
        ), 0)
      ) AS max_invoice_amount,
      GREATEST(
        COALESCE((
          SELECT MAX(ci.invoice_date) FROM canonical_invoices ci
          WHERE ci.receptor_canonical_company_id = cc.id AND ci.direction = 'issued'
        ), '1900-01-01'::date),
        COALESCE((
          SELECT MAX(ci.invoice_date) FROM canonical_invoices ci
          WHERE ci.emisor_canonical_company_id = cc.id AND ci.direction = 'received'
        ), '1900-01-01'::date)
      ) AS effective_last_invoice_date
    FROM canonical_companies cc
  )
  UPDATE canonical_companies cc
  SET counterparty_type_auto = (
    CASE
      WHEN s.is_related_party = TRUE OR s.is_internal = TRUE THEN 'intercompania'
      WHEN s.blacklist_level IN ('69b_definitivo','69b_presunto') THEN 'blacklisted'

      -- Gobierno fiscal: solo nombre o RFCs específicos conocidos.
      -- NO usar pattern '^(SAT|IMS|INF|GOB)' porque cacha RFCs personales
      -- (GOBC=Gonzalez Barajas, SATL=Sanchez Tecla, etc — son personas con
      -- apellidos que empiezan con esas letras). RFCs de orgs: 12 chars
      -- (vs 13 personas físicas) y patrones específicos.
      WHEN s.name_lower ~
           '\m(servicio.*administraci[oó]n.*tributari|^sat\M|imss|instituto.*mexicano.*seguro|infonavit|fondo.*nacional.*vivienda|secretar[ií]a.*hacienda|^shcp\M|isssste|hacienda.*federal)\M'
        OR s.rfc IN ('SAT970701NN3', 'IMS421231I45', 'INF7205011ZA', 'IND020610CG2')
        THEN 'gobierno_fiscal'

      -- Financiera: pattern de nombre. Sin filtro de invoice_count: las
      -- financieras DE VERDAD (leasing recurrente, sofom, factoring) tienen
      -- muchas facturas porque cobran intereses mensuales o factoraje
      -- recurrente. LEASING LEPEZO tenía 11M en 90d y se nos escapaba.
      -- Patrón estrechado a palabras inequívocamente financieras —
      -- 'capital' standalone se mantiene pero requiere contexto adicional
      -- (sofom/sapi/sa de cv) para evitar caer 'capital humano'.
      WHEN s.name_lower ~ '\m(leasing|arrendadora|factoring|factoraje|sofom|sofol|financiera|financiamiento)\M'
        OR s.name_lower ~ '\mcapital\M.*\m(sofom|sapi|sofol|s\.?a\.?p\.?i)\M'
        OR s.name_lower ~ '\m(banamex|bbva|santander|banorte|hsbc|scotiabank|inbursa)\M'
        THEN 'financiera'

      WHEN s.name_lower ~
           '\m(telmex|cfe\M|comisi[oó]n federal de electricidad|gas natural|naturgy|telcel|axtel|izzi|megacable|totalplay|engie|iberdrola)\M'
        THEN 'utility'

      -- one_off: SOLO si el nombre parece empresa real (≥5 chars, sin
      -- '/' que indica número de factura/PO o ID de partner spam).
      WHEN s.total_invoice_count = 1
        AND s.max_invoice_amount > 1000000
        AND s.effective_last_invoice_date < (CURRENT_DATE - INTERVAL '12 months')
        AND length(coalesce(s.name_lower, '')) >= 5
        AND s.name_lower !~ '/'
        THEN 'one_off'

      ELSE 'operativo'
    END
  )
  FROM stats s
  WHERE cc.id = s.id;

  -- ── 2. customer_lifecycle_auto ─────────────────────────────────────────
  -- Usa canonical_companies.last_invoice_date + revenue_90d_mxn +
  -- lifetime_value_mxn que son pre-agregados y más confiables que
  -- re-agregar canonical_invoices (que tiene gaps masivos para muchos
  -- customers — eg ENTRETELAS BRINCO con $3.1M en 90d pero 0 rows en
  -- canonical_invoices). Para overdue, sí necesitamos canonical_invoices
  -- porque no hay aggregate pre-computed para "AR vencido > 60d".
  WITH overdue_stats AS (
    -- Usa due_date_resolved (silver canonical, sí populado) en vez de
    -- fiscal_days_to_due_date (NULL en 100% de las rows). Audit
    -- 2026-04-27: el campo fiscal_days nunca se popla, mientras que
    -- due_date_resolved sí — 316 AR open con due date válido, 88 con
    -- vencimiento >60d que ahora sí caen en at_risk.
    SELECT
      cc.id,
      COALESCE(SUM(ci.amount_residual_mxn_resolved), 0) AS overdue_60d_amount
    FROM canonical_companies cc
    LEFT JOIN canonical_invoices ci
      ON ci.receptor_canonical_company_id = cc.id
     AND ci.direction = 'issued'
     AND COALESCE(ci.estado_sat, 'vigente') <> 'cancelado'
     AND COALESCE(ci.amount_residual_mxn_resolved, 0) > 0
     AND ci.due_date_resolved IS NOT NULL
     AND ci.due_date_resolved < (CURRENT_DATE - INTERVAL '60 days')
    GROUP BY cc.id
  )
  UPDATE canonical_companies cc
  SET customer_lifecycle_auto = (
    CASE
      -- N/A para no-clientes (default sane)
      WHEN cc.is_customer IS NOT TRUE THEN 'active'

      -- Sin LTV ni facturas históricas → prospect.
      WHEN cc.last_invoice_date IS NULL
        AND COALESCE(cc.lifetime_value_mxn, 0) = 0 THEN 'prospect'

      -- Tiene LTV>0 pero sin last_invoice_date → dormant (data sugiere
      -- actividad histórica pero perdimos la fecha — mejor que prospect).
      WHEN cc.last_invoice_date IS NULL THEN 'dormant'

      -- >180d sin facturar → lost (Belsueño cae aquí)
      WHEN cc.last_invoice_date < (CURRENT_DATE - INTERVAL '180 days') THEN 'lost'

      -- 90-180d sin facturar → dormant
      WHEN cc.last_invoice_date < (CURRENT_DATE - INTERVAL '90 days') THEN 'dormant'

      -- AR vencido >60d >$10k → at_risk (solo si está activo facturando)
      WHEN COALESCE(o.overdue_60d_amount, 0) > 10000 THEN 'at_risk'

      ELSE 'active'
    END
  )
  FROM overdue_stats o
  WHERE cc.id = o.id;

  -- ── 3. Return summary ──────────────────────────────────────────────────
  RETURN QUERY
  SELECT 'counterparty_type'::text, counterparty_type_auto::text, COUNT(*)::bigint
  FROM canonical_companies
  GROUP BY counterparty_type_auto
  ORDER BY 3 DESC;

  RETURN QUERY
  SELECT 'customer_lifecycle'::text, customer_lifecycle_auto::text, COUNT(*)::bigint
  FROM canonical_companies
  WHERE is_customer = TRUE
  GROUP BY customer_lifecycle_auto
  ORDER BY 3 DESC;
END;
$$;
