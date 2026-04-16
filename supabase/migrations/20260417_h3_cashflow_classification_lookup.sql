-- ═══════════════════════════════════════════════════════════════
-- H3 — cashflow_current_cash: regex → lookup table
-- ═══════════════════════════════════════════════════════════════
-- Audit finding (DATA_AUDIT_REPORT.md §H3):
-- El regex `(diferid|incobrabl|payana|fintoc|aduana|internacional)`
-- clasifica Payana+Fintoc como 'restricted', pero son procesadores
-- de cobro (inbound collecting) — dinero real en camino, no
-- restringido. `cashflow_in_transit` también los captura desde
-- chart_of_accounts: $85K in_transit vs $584K restricted, overlap
-- conceptual.
--
-- Fix en 2 partes:
--   1. Tabla lookup `cashflow_journal_classification` editable en
--      runtime (sin deploy) para clasificar journals.
--   2. Nuevo bucket 'clearing' para Payana/Fintoc. cash_net_mxn
--      ahora suma operative + clearing + cc_debt. Restricted
--      queda SOLO para Aduana/Diferidos/Incobrables (truly locked).
--
-- Mantiene shape compatible con CREATE OR REPLACE VIEW (agrega
-- `cash_clearing_mxn` al final) para no romper la cadena
-- `projected_cash_flow_weekly` que lee `cash_net_mxn`. La nueva
-- definición de cash_net_mxn incluye clearing, lo que ES un cambio
-- de semántica deseado: Payana pasa de "restringido excluido" a
-- "cash disponible con lag T+1".
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─── Tabla lookup ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cashflow_journal_classification (
  pattern    text PRIMARY KEY,
  bucket     text NOT NULL CHECK (bucket IN ('operative','clearing','restricted','cc_debt')),
  note       text,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE cashflow_journal_classification IS
  'Lookup para clasificar journals en cashflow_current_cash. pattern se usa con ILIKE; mantenimiento manual, editable sin deploy.';

INSERT INTO cashflow_journal_classification (pattern, bucket, note) VALUES
  ('%jeeves%',       'cc_debt',    'Tarjeta corporativa Jeeves'),
  ('%jeevs%',        'cc_debt',    'Typo de Jeeves en Odoo'),
  ('%tarjeta%',      'cc_debt',    'Nombre genérico TC'),
  ('%amex%',         'cc_debt',    'American Express'),
  ('%payana%',       'clearing',   'Procesador de cobro (inbound collecting)'),
  ('%fintoc%',       'clearing',   'Procesador de cobro (inbound collecting)'),
  ('%aduana%',       'restricted', 'Depósito aduanal'),
  ('%internacional%','restricted', 'Servicio Internacional Aduana'),
  ('%diferid%',      'restricted', 'Cobros diferidos'),
  ('%incobrabl%',    'restricted', 'Reserva incobrables')
ON CONFLICT (pattern) DO UPDATE
  SET bucket = EXCLUDED.bucket,
      note   = EXCLUDED.note,
      updated_at = NOW();

-- ─── Replace view manteniendo shape compatible ───────────────
-- ORDEN DE COLUMNAS: mismo que la def anterior (7 primeras) y
-- agregamos `cash_clearing_mxn` al final. CREATE OR REPLACE VIEW
-- tolera agregar columnas SOLO al final.
CREATE OR REPLACE VIEW cashflow_current_cash AS
WITH
  latest_usd AS (
    SELECT rate FROM odoo_currency_rates
    WHERE currency = 'USD' ORDER BY rate_date DESC NULLS LAST LIMIT 1
  ),
  latest_eur AS (
    SELECT rate FROM odoo_currency_rates
    WHERE currency = 'EUR' ORDER BY rate_date DESC NULLS LAST LIMIT 1
  ),
  classified AS (
    SELECT
      bb.name,
      bb.currency,
      bb.current_balance AS balance_raw,
      CASE UPPER(COALESCE(bb.currency, 'MXN'))
        WHEN 'USD' THEN bb.current_balance * COALESCE((SELECT rate FROM latest_usd), 17.30)
        WHEN 'EUR' THEN bb.current_balance * COALESCE((SELECT rate FROM latest_eur), 20.00)
        ELSE bb.current_balance
      END AS balance_mxn,
      -- LATERAL + LIMIT 1: primer match gana. Patrones son mutuamente
      -- exclusivos en el seed, así que el orden no importa hoy.
      COALESCE(cls.bucket, 'operative') AS bucket
    FROM odoo_bank_balances bb
    LEFT JOIN LATERAL (
      SELECT c.bucket
      FROM cashflow_journal_classification c
      WHERE bb.name ILIKE c.pattern
      LIMIT 1
    ) cls ON true
  )
SELECT
  -- (1) Operative: bancos, caja, inversiones, salarios.
  COALESCE(SUM(CASE WHEN bucket = 'operative'  AND balance_mxn > 0 THEN balance_mxn ELSE 0 END), 0)::numeric AS cash_operative_mxn,
  -- (2) Restricted: SOLO aduana, diferidos, incobrables.
  COALESCE(SUM(CASE WHEN bucket = 'restricted' THEN balance_mxn ELSE 0 END), 0)::numeric AS cash_restricted_mxn,
  -- (3) CC debt (tarjetas, signo negativo).
  COALESCE(SUM(CASE WHEN bucket = 'cc_debt'    THEN balance_mxn ELSE 0 END), 0)::numeric AS cc_debt_mxn,
  -- (4) Net: ahora INCLUYE clearing (Payana/Fintoc) como cash disponible.
  -- Antes excluía clearing; cambio de semántica deseado post-audit.
  COALESCE(SUM(CASE WHEN bucket IN ('operative','clearing','cc_debt') THEN balance_mxn ELSE 0 END), 0)::numeric AS cash_net_mxn,
  -- (5-7) Metadata.
  COUNT(*) FILTER (WHERE balance_mxn <> 0)::int AS active_accounts,
  (SELECT rate FROM latest_usd) AS usd_rate,
  (SELECT rate FROM latest_eur) AS eur_rate,
  -- (8) NUEVO al final: clearing separado para visibility.
  COALESCE(SUM(CASE WHEN bucket = 'clearing' AND balance_mxn > 0 THEN balance_mxn ELSE 0 END), 0)::numeric AS cash_clearing_mxn
FROM classified;

COMMENT ON VIEW cashflow_current_cash IS
  'Cash FX-ajustado clasificado via cashflow_journal_classification. cash_net_mxn = operative + clearing + cc_debt (Payana/Fintoc se tratan como cash disponible con lag T+1). cash_restricted queda solo para Aduana/Diferidos/Incobrables.';

COMMIT;
