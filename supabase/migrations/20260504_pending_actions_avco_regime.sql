-- Pending actions: AVCO regime correction (auditoría 2026-05-04 PM)
--
-- Premise correction discovered with CEO 2026-05-04:
--   - Quimibond uses AVCO valuation, NOT Standard with CAPA.
--   - Workcenters only configured in Tejido Circular, go-live MAY 2026.
--   - Pre-1-april-2026: BOMs included MOD+gastos as RSI56 components.
--   - Post-1-april-2026: BOMs only have MP. RSI56 archived.
--   - 501.01.02 COSTO PRIMO no longer receives monthly CAPA adjustment.
--
-- This migration:
--  (a) closes 5 obsolete pending actions (already executed live as wont_fix).
--  (b) inserts 4 new pending actions reflecting the correct premise.

-- ---------- (a) close obsolete actions ----------
UPDATE public.odoo_pending_actions
SET status = 'wont_fix',
    workaround_in_silver = COALESCE(workaround_in_silver, '') ||
      E'\n\n[2026-05-04] OBSOLETO: premisa incorrecta. Quimibond usa AVCO + workcenters solo en Tejido (go-live mayo 2026). Reemplazado por pnl-limpio-rewrite-avco-regimen.'
WHERE action_key IN (
  'reclassify-501-01-01-as-mp',
  'reclassify-501-01-02-as-scrap',
  'monthly-capa-workflow',
  'reinterpret-pnl-limpio-mod-oh',
  'investigate-real-cost-method'
)
AND status != 'wont_fix';

-- ---------- (b) insert new actions with correct premise ----------
INSERT INTO public.odoo_pending_actions
(action_key, area, severity, title, problem_description, fix_in_odoo, workaround_in_silver, estimated_impact_mxn, evidence_url, assignee)
VALUES
(
  'configure-workcenters-acabado-tintoreria-entretelas',
  'productos',
  'high',
  'Configurar workcenters faltantes: ACABADO, TINTORERÍA, ENTRETELAS, INSP/EMPAQUE',
  'Hoy en Odoo solo está configurado el workcenter de TEJIDO CIRCULAR (40 máquinas, $74.57/hr) con go-live MAYO 2026. Los demás procesos productivos (Acabado, Tintorería, Entretelas, Inspección/Empaque) NO tienen workcenter, lo que significa:
1. No se captura tiempo-máquina por orden de manufactura.
2. No se absorbe MOD+overhead al producto al producirse (variable costing implícito).
3. El P&L LIMPIO de costo primo (BOM-recursivo) reporta solo MP — los gastos de transformación viven en cuentas separadas (501.06 nómina, 504.01 overhead).
4. No es comparable a un sistema absorbing costing tipo manufactura industrial estándar.

Impacto Apr 2026 (calculado en silver via get_overhead_by_cost_center + get_nomina_by_cost_center):
- ACABADO: nómina $265k + overhead $1.59M = $1.86M no absorbido
- TINTORERÍA: $247k + ~$300k = $547k no absorbido
- ENTRETELAS: $209k + ~$400k = $609k no absorbido
- INSP/EMPAQUE: $266k + ~$50k = $316k no absorbido
Total: ~$3.3M/mes que está en gastos pero no absorbido al PT.',
  '1. Configurar workcenters en Odoo Manufacturing → Configuration → Work Centers:
   - ACABADO (capacidad por turno, costo/hr basado en nómina+overhead históricos)
   - TINTORERIA
   - ENTRETELAS
   - INSPECCION_EMPAQUE
2. Para cada BOM, asignar operations al workcenter correspondiente (Manufacturing → BOMs → Operations tab).
3. Definir time_cycle_manual o ms/unit por operation.
4. Establecer cost/hr en cada workcenter usando burden rate calculado:
   - TEJIDO ~$14.47/kg (ya configurado, $74.57/hr ÷ producción/hr)
   - ACABADO ~$1.22/mt (calcular hr equivalente)
   - TINTORERIA ~$5.55/kg
   - ENTRETELAS ~$2.05/mt
5. Go-live coordinado por proceso, validar 1 mes con shadow accounting.
6. Una vez en producción, el costo MOD+overhead se absorbe al PT al producirse → Inventario PT refleja costo total → COGS al venderse incluye MP+MOD+OH.',
  'Hoy el silver tiene 3 RPCs (get_nomina_by_cost_center, get_overhead_by_cost_center, get_production_by_cost_center) que calculan burden rate por departamento desde la contabilidad. La página /contabilidad/centros-de-costo (en construcción) muestra el desglose. Mientras no esté workcenter configurado, el P&L LIMPIO presenta variable costing implícito (MP en costo, MOD+OH en gastos separados).',
  3300000,
  '/contabilidad/centros-de-costo',
  'Guadalupe Ramos + Mariano + CEO'
),
(
  'revaluar-inventario-pt-contaminacion-avco',
  'contabilidad',
  'critical',
  'Revaluar inventario PT contaminado con MOD+gastos pre-1-abril ($6.34M)',
  'Quimibond usa AVCO (Average Cost) para valuación de inventario. Hasta antes del 1 de abril 2026, las BOMs incluían MOD y gastos como componentes (productos RSI56), absorbiéndose al PT al producirse. Esos gastos quedaban dentro del avg_cost del PT en almacén.

A partir del 1 de abril 2026, las BOMs se simplificaron: solo materia prima. Los productos RSI56 fueron archivados, lo que rompe el mecanismo de CAPA mensual que normalizaba la diferencia entre AVCO histórico y costo real.

Diagnóstico actual: ~$6.34M (33.6%) del inventario PT vivo de $18.87M está contaminado con MOD+gastos absorbidos via AVCO de fabricaciones pre-abril. Cada vez que se vende un PT viejo (LIFO se mueve), el COGS contable a 501.01.01 lleva el avg_cost AVCO inflado → reporta sobre-costo en P&L contable y la "ganancia" parece menor.

Esto se cancela parcialmente con que los gastos también están dentro de avg_cost (no se cuentan dos veces en P&L contable). Pero el P&L LIMPIO basado en BOM-recursivo (sólo MP) sub-reporta utilidad porque trata el AVCO inflado como si fuera todo MP.',
  '1. Identificar productos PT contaminados:
   SELECT op.internal_ref, op.qty_available, op.standard_price, op.qty_available * op.standard_price AS valor_avco,
          (SELECT get_bom_raw_material_cost_per_unit(op.odoo_product_id)) AS bom_mp_unit,
          op.qty_available * (SELECT get_bom_raw_material_cost_per_unit(op.odoo_product_id)) AS valor_bom_mp
   FROM odoo_products op
   WHERE op.is_storable AND op.qty_available > 0;

2. Para cada PT con diff > 5%, decidir:
   a) Re-valuar via Inventory → Operations → Inventory Adjustment a costo BOM-MP (downstream el AVCO se ajusta).
   b) O dejar contaminado y esperar que el inventario rote (FIFO operativo agota el stock viejo en 6-12 meses).
3. Asiento de revaluación: Dr 501.01.02 COSTO PRIMO o cuenta de ajuste / Cr 115.xx Inventario PT.
4. Coordinar con contadora antes de re-valuar masivo (impacto fiscal).',
  'Hoy /finanzas P&L LIMPIO presenta MP via BOM-recursivo y MOD+overhead aparte. El gap "501.01.01 contable − BOM MP" se reporta como diferencia de absorción (parte AVCO contaminado, parte régimen actual sin absorción). Banner en /contabilidad documenta el régimen.',
  6340000,
  '/finanzas',
  'Contadora + CEO'
),
(
  'pnl-limpio-rewrite-avco-regimen',
  'contabilidad',
  'high',
  'Reinterpretar P&L LIMPIO con régimen real: AVCO + sin workcenters (variable costing implícito)',
  'Premisa anterior del P&L LIMPIO (documentada en CLAUDE.md hasta 2026-05-04) era incorrecta:
- Suponía valoración Standard con CAPA mensual inflando 501.01.01.
- Asumía que el "swap" 501.01.01 ↔ BOM-recursivo limpiaba la duplicación.

Realidad confirmada con CEO 2026-05-04:
- Valuación es AVCO, NO Standard.
- Workcenters solo configurados en Tejido Circular, go-live MAYO 2026.
- Para Acabado/Tintorería/Entretelas/Empaque: variable costing implícito (MOD+OH viven en gasto separado, no se absorben al PT).
- Pre-abril 2026: BOMs incluían MOD+gastos via componentes RSI56, ahora archivados.
- 501.01.02 COSTO PRIMO ya NO recibe ajuste mensual (porque RSI56 archivado).
- 501.01.01 NO está inflado por CAPA — es el COGS real AVCO al despacho.

Implicaciones:
1. El "swap" 501.01.01 ↔ BOM-recursivo ya NO es una corrección — es una reformulación: muestra lo que costaría a estructura nueva sin contaminación AVCO histórica.
2. El P&L LIMPIO debe presentarse como "P&L régimen actual": MP via BOM + MOD por depto + Overhead por depto (todo separado, variable costing).
3. El "residual 501.01.01 − BOM" representa contaminación AVCO histórica, no error contable.',
  'No hay fix Odoo único — es una decisión de estructura contable + reporting:

OPCIÓN ELEGIDA (implementada en silver 2026-05-04):
1. Renombrar P&L LIMPIO a "P&L Régimen Actual" o similar.
2. Presentar 4 bloques claros:
   a) Ingresos (4xx neto)
   b) MP consumido (BOM-recursivo MP only)
   c) MOD por departamento (501.06 splitable via NOMINAS journal ref)
   d) Overhead fábrica por departamento (504.01 splitable via overhead_account_assignment + rent_lot_assignment)
3. Margen contributivo material = ingresos − MP.
4. Costo total = MP + MOD + OH fábrica.
5. Eliminar lenguaje "CAPA inflada" — ya no aplica.
6. Mantener 501.01.08 DIFERENCIAS POR CONTEO como atípico investigable (shrinkage físico).

OPCIÓN futura: configurar workcenters en todos los procesos para absorbing costing real (ver pending action configure-workcenters-acabado-tintoreria-entretelas).',
  'Implementado en silver 2026-05-04: 3 RPCs (get_nomina_by_cost_center, get_overhead_by_cost_center, get_production_by_cost_center) + 3 tablas (cost_center_config, overhead_account_assignment, rent_lot_assignment) + página /contabilidad/centros-de-costo. Pnl-Block usa nuevo desglose por departamento.',
  NULL,
  '/contabilidad/centros-de-costo',
  'CEO + Contadora + Mariano'
),
(
  'investigate-renta-abril-baja',
  'contabilidad',
  'medium',
  'Renta abril 2026 fue 39% menor a marzo: investigar si está completa',
  'La cuenta 504.01.0008 RENTA en abril 2026 muestra $677k vs marzo $1.13M (gap de $379k, -33%). El CEO confirmó breakdown de renta total esperado:
- Lote 9 planta tintorería+acabado: $356,934 (50/50 entre acabado y tint)
- Lote 10 planta entretelas: $352,062
- Lote 9,10 oficinas Tejido: $284,269
- Lote 10 oficinas RH+Compras: $219,509
Total esperado: ~$1,212,775/mes

Abril en libros: $677k → faltan ~$535k. Posibles causas:
1. Factura(s) de renta de abril aún no capturadas en Odoo (timing de captura).
2. Acreedor pagó parte en marzo y se contabilizó allá.
3. Reclasificación entre subcuentas.

Esto distorsiona el overhead por departamento en abril (especialmente ACABADO+TINTORERÍA, ENTRETELAS y oficinas Tejido).',
  '1. Buscar facturas de renta abril 2026 en Odoo:
   Accounting → Vendor Bills → filtro "Renta" + abril 2026.
2. Cruzar con Lote 9 / Lote 10 contratos.
3. Si falta alguna, capturarla con fecha correcta.
4. Validar que cada lote esté en cuenta correcta (504.01.0008 todo, o subcuentas separadas).
5. Configurar facturas recurrentes en Odoo (Accounting → Configuration → Subscriptions / Recurring) para que no se omita ningún mes.',
  'silver: rent_lot_assignment tiene los 4 lotes con distribución porcentual a cost centers. RPC get_overhead_by_cost_center prorratea según lo que esté en libros. Si los libros faltan, el overhead reportado está bajo en abril (no es bug del cálculo, es data missing).',
  535000,
  '/contabilidad/cuenta/504.01.0008?from=2026-04&to=2026-04',
  'Contadora + Mariano'
)
ON CONFLICT (action_key) DO UPDATE SET
  area = EXCLUDED.area,
  severity = EXCLUDED.severity,
  title = EXCLUDED.title,
  problem_description = EXCLUDED.problem_description,
  fix_in_odoo = EXCLUDED.fix_in_odoo,
  workaround_in_silver = EXCLUDED.workaround_in_silver,
  estimated_impact_mxn = EXCLUDED.estimated_impact_mxn,
  evidence_url = EXCLUDED.evidence_url,
  assignee = EXCLUDED.assignee;
