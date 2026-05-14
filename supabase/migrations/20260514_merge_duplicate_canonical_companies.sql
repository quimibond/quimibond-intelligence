-- 2026-05-14 — Merge 4 canonical_companies duplicadas por odoo_partner_id
--
-- Síntoma: canonical_order_lines, canonical_deliveries y canonical_purchase_orders
-- fallan refresh CONCURRENTLY desde 2026-05-08 con duplicate key value violates
-- unique constraint. Las 3 vistas hacen LEFT JOIN canonical_companies por
-- odoo_partner_id; cuando hay >1 fila por partner, el resultado se duplica y
-- el PK por canonical_id revienta.
--
-- Causa raíz: 4 partners tienen 2 canonical_companies cada uno. El par sigue
-- un patrón consistente: una canonical (id menor) creada por Bronze a partir
-- de Odoo (sin RFC, has_shadow_flag=false, contiene odoo_partner_id y todas
-- las FKs de invoices/payments), y otra (id mayor) creada por SAT/Syntage al
-- timbrar el primer CFDI para el RFC (has_shadow_flag=true, con RFC, sin FKs).
-- El matcher nunca las consolidó.
--
-- Estrategia:
-- 1) Sobre el survivor (id menor, donde viven las FKs) se copia rfc + canonical_name
--    legible del par y se marca has_manual_override=true (esto fuerza que sea
--    elegido como survivor por mdm_merge_companies).
-- 2) mdm_merge_companies(victim, survivor, ...) re-apunta las pocas FKs
--    que tenga el victim, deja audit trail en mdm_manual_overrides y elimina
--    el victim.
-- 3) REFRESH MATERIALIZED VIEW CONCURRENTLY de las 3 MVs afectadas (las
--    canonical-by-MV) ahora corre sin duplicate key.

BEGIN;

-- Pair 1: partner 3450 — Tubevalco SA de CV (RFC TUB060823RR1)
UPDATE canonical_companies
SET rfc                 = 'TUB060823RR1',
    canonical_name      = 'tubevalco s.a. de c.v.',
    has_manual_override = TRUE,
    last_matched_at     = NOW()
WHERE id = 2004;
SELECT mdm_merge_companies(
  4231, 2004,
  'data-integrity-audit-2026-05-14@quimibond.local',
  '20260514: merge shadow huérfana SAT (4231) al canonical Odoo (2004) — partner 3450'
);

-- Pair 2: partner 8782 — Servicios Centrales de Cobranza Hotelera (RFC SCC171019SQ7)
UPDATE canonical_companies
SET rfc                 = 'SCC171019SQ7',
    canonical_name      = 'servicios centrales de cobranza hotelera',
    has_manual_override = TRUE,
    last_matched_at     = NOW()
WHERE id = 1840;
SELECT mdm_merge_companies(
  4015, 1840,
  'data-integrity-audit-2026-05-14@quimibond.local',
  '20260514: merge shadow huérfana SAT (4015) al canonical Odoo (1840) — partner 8782'
);

-- Pair 3: partner 8880 — Euroking (RFC EUR170922SC0)
UPDATE canonical_companies
SET rfc                 = 'EUR170922SC0',
    canonical_name      = 'euroking',
    has_manual_override = TRUE,
    last_matched_at     = NOW()
WHERE id = 2001;
SELECT mdm_merge_companies(
  2881, 2001,
  'data-integrity-audit-2026-05-14@quimibond.local',
  '20260514: merge shadow huérfana SAT (2881) al canonical Odoo (2001) — partner 8880'
);

-- Pair 4: partner 8881 — Restaurantes Admx (RFC RAD161031RK1)
UPDATE canonical_companies
SET rfc                 = 'RAD161031RK1',
    canonical_name      = 'restaurantes admx',
    has_manual_override = TRUE,
    last_matched_at     = NOW()
WHERE id = 1947;
SELECT mdm_merge_companies(
  3835, 1947,
  'data-integrity-audit-2026-05-14@quimibond.local',
  '20260514: merge shadow huérfana SAT (3835) al canonical Odoo (1947) — partner 8881'
);

-- Sanity check: ya no hay duplicados por odoo_partner_id
DO $$
DECLARE
  v_dup_count INT;
BEGIN
  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT 1 FROM canonical_companies
    WHERE odoo_partner_id IS NOT NULL
    GROUP BY odoo_partner_id
    HAVING COUNT(*) > 1
  ) d;
  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'Post-merge: still % canonical_companies duplicates by odoo_partner_id', v_dup_count;
  END IF;
END $$;

COMMIT;

-- Fuera de transacción: refrescar las 3 MVs que estaban rotas
REFRESH MATERIALIZED VIEW CONCURRENTLY public.canonical_order_lines;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.canonical_deliveries;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.canonical_purchase_orders;
