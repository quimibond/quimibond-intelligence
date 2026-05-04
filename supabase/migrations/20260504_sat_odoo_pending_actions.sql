-- /sistema/odoo-pendientes — pending actions de discrepancias SAT vs Odoo
--
-- Auditoría 2026-05-04 PM: la tabla reconciliation_issues tiene 6 tipos
-- de discrepancias materiales (>$50M acumulado) entre lo que el SAT
-- reconoce fiscalmente y lo que Odoo tiene registrado contablemente.
--
-- Este migration agrega esas 6 categorías como pending actions con fix
-- concreto en Odoo + workaround actual.

INSERT INTO public.odoo_pending_actions
(action_key, area, severity, title, problem_description, fix_in_odoo, workaround_in_silver, estimated_impact_mxn, evidence_url, assignee)
VALUES
(
  'operationalize-cfdi-backlog',
  'contabilidad',
  'critical',
  'Backlog: 281 CFDIs en SAT sin contrapartida operativa en Odoo ($40M)',
  '281 facturas timbradas en SAT post-2021 NO tienen factura correspondiente en Odoo. Impacto acumulado: $40.3M MXN. Cada CFDI quedó timbrado fiscalmente pero la operación contable nunca se cerró en Odoo. Significa: el SAT te tiene como ya facturado y reportaste para impuestos, pero tu contabilidad interna no lo refleja → riesgo de auditoría fiscal + utilidad sub-reportada en libros.',
  '1. PRIORIDAD INMEDIATA: descargar lista completa con SQL:
   SELECT canonical_id, uuid_sat, impact_mxn, description
   FROM reconciliation_issues
   WHERE invariant_key=''invoice.pending_operationalization'' AND resolved_at IS NULL
   ORDER BY impact_mxn DESC;

2. Para cada CFDI: identificar la operación faltante. Típicamente:
   - Self-billing CFDIs (Quimibond emitió pero no registró)
   - Facturas con cancelación SAT pero Odoo no enteró
   - CFDIs duplicados o de prueba que nunca se cancelaron

3. Decisión por CFDI:
   a) Operación SÍ existe pero no se enlazó → vincular en Odoo con UUID.
   b) Operación NO existe → crear factura Odoo retroactiva con fecha CFDI.
   c) CFDI inválido → cancelarlo en SAT.

4. EVITAR EN FUTURO: webhook Syntage que detecte CFDI emitido sin operación Odoo dentro de 24h y dispare alerta automática.',
  'Hoy estos issues viven en reconciliation_issues y se ven en /inbox + gold_company_odoo_sat_drift. El sistema los detecta pero no los fixea — requiere acción manual de la contadora caso por caso.',
  40300000,
  '/inbox',
  'Contadora (URGENTE)'
),
(
  'sync-sat-cancellations-to-odoo',
  'contabilidad',
  'high',
  'Sincronizar cancelaciones SAT → Odoo (85 facturas, $3.6M)',
  '85 facturas están "posted" en Odoo pero "cancelado" en SAT. Esto pasa cuando alguien canceló el CFDI directamente en el portal SAT (no vía Odoo) y la cancelación nunca llegó de vuelta al sistema interno. Resultado: tu Odoo cree que cobraste/debes esas facturas pero en realidad están canceladas fiscalmente. Impacto $3.58M en saldos AR/AP fantasma.',
  '1. Activar webhook SAT → Syntage → Odoo para cancelaciones:
   - SAT portal → Configuración → Servicios web → Notificaciones cancelación
   - Configurar URL del webhook de Syntage

2. Para las 85 ya canceladas en SAT pero posted en Odoo:
   - Lista en reconciliation_issues con invariant_key=invoice.state_mismatch_posted_cancelled
   - Hacer reverso/cancelación manual en Odoo de cada una.

3. CONTROL FUTURO: invariante mensual notifica si > 5 nuevos.',
  'reconciliation_issues con invariant_key=invoice.state_mismatch_posted_cancelled. Aparecen en /inbox priorizadas por impact_mxn.',
  3580000,
  '/inbox',
  'Contadora + Mariano'
),
(
  'capture-ap-invoices-from-sat',
  'compras',
  'high',
  'Capturar facturas de proveedores SAT-only en Odoo ($6.4M)',
  '193 CFDIs de proveedores (recibidos por Quimibond) están en SAT pero NO en Odoo. El SAT te los reporta como AP pero contabilidad no los capturó como gasto/inventario. Impacto $6.36M en gasto sub-reportado → P&L contable sobreestima utilidad por ese monto.',
  '1. Lista en reconciliation_issues con invariant_key=invoice.ap_sat_only_drift.

2. Para cada uno, capturar la factura recibida en Odoo:
   - Accounting → Vendor Bills → New
   - Importar XML del CFDI (Odoo 19 acepta CFDI 4.0 import directo)
   - Validar producto, monto, cuenta de gasto, post.

3. AUTOMATIZAR: activar módulo "l10n_mx_edi_vendor_bills" en Odoo:
   - Configurar credenciales del PAC en Odoo
   - Activar polling cada 4 horas
   - Validar mapping automático proveedor → cuenta de gasto

4. CONTROL: invariante semanal — si > 10 CFDIs AP sin Odoo, alerta.',
  'reconciliation_issues con invariant_key=invoice.ap_sat_only_drift. Aparecen en /empresas/[id]/auditoria-sat-tab.',
  6360000,
  '/inbox',
  'Contadora + Elena Delgado'
),
(
  'validate-cfdi-amount-pre-timbre',
  'ventas',
  'medium',
  'Validar monto CFDI vs Odoo antes de timbrar (213 mismatches, $4.5M)',
  '213 facturas tienen UUID matched (mismo CFDI) pero el MONTO en SAT difiere del de Odoo más allá de la tolerancia. Pasa cuando se modifica una factura DESPUÉS de timbrar (descuentos, ajustes, líneas extra) sin re-timbrar. Resultado: SAT muestra X, Odoo muestra Y, contabilidad no cuadra fiscalmente. Impacto $4.48M.',
  '1. Configurar regla en Odoo: bloquear modificación de factura ya timbrada (state=posted + tiene cfdi_uuid).
   - Settings → Technical → Server Actions → New
   - Trigger: account.move write
   - Condition: state=''posted'' AND cfdi_uuid IS NOT NULL
   - Action: raise UserError("Factura ya timbrada — para modificar, cancelar y re-timbrar")

2. Para los 213 mismatch existentes: decidir caso por caso (cancelar+retimbrar OR ajustar Odoo al SAT).

3. INVARIANTE preventivo: pre-timbre, validar Odoo == amount a timbrar.',
  'reconciliation_issues con invariant_key=invoice.amount_mismatch. Tolerance configurable en audit_tolerances.',
  4480000,
  '/inbox',
  'Contadora + Mariano'
),
(
  'validate-cfdi-date-drift',
  'ventas',
  'low',
  'Validar fechas CFDI vs Odoo (71 issues con date_drift)',
  '71 facturas tienen fecha distinta entre SAT y Odoo. Suele pasar cuando se timbra al día siguiente y la fecha cambia. Sin impacto monetario pero distorsiona reportes mensuales y aging.',
  '1. Configurar Odoo para timbrar SIEMPRE el mismo día de creación:
   - Accounting → Configuration → Journals → Customer Invoices
   - Activar "Auto-timbre on validate"

2. Para las 71 con drift, decidir si ajustar a fecha SAT (recomendado).

3. CONTROL: si > 5 nuevos drifts/mes, revisar flujo de timbrado.',
  'reconciliation_issues con invariant_key=invoice.date_drift.',
  NULL,
  '/inbox',
  'Mariano'
),
(
  'manufacturing-variance-tracking',
  'productos',
  'high',
  'Variance MP real vs BOM > $10M en MOs activos',
  '878 órdenes de manufactura tienen variance entre el costo MP planeado en BOM y el costo MP real consumido. 377 alta severidad ($7.17M) + 501 media ($3.06M). Total: $10.2M. Significa: la BOM teórica no refleja consumo real — operación consume más MP de lo planeado (scrap excesivo, BOM outdated, sustituciones no documentadas). El P&L LIMPIO usa BOM-recursivo que NO captura este variance.',
  '1. Para cada MO con variance alto, investigar root cause:
   - ¿BOM outdated? (MP cambió pero BOM no)
   - ¿Scrap excesivo? (defectos producción)
   - ¿Sustituciones sin documentar?

2. Actualizar BOMs vivas en Odoo cuando consumo real difiera consistentemente:
   Manufacturing → BOMs → seleccionar → ajustar cantidades

3. Capacitar a Guadalupe Ramos para reportar sustituciones desde MO en tiempo real.

4. ALERTA: invariante manufacturing.material_cost_variance con threshold >5%.

5. EN SILVER: agregar variance al P&L limpio como línea separada — actualmente NO se reporta.',
  'reconciliation_issues con invariant_key=manufacturing.material_cost_variance. Existe mv_mo_actual_material_cost pero no se surface en /finanzas.',
  10230000,
  '/inbox',
  'Guadalupe Ramos + Contadora'
)
ON CONFLICT (action_key) DO UPDATE SET
  title = EXCLUDED.title,
  problem_description = EXCLUDED.problem_description,
  fix_in_odoo = EXCLUDED.fix_in_odoo,
  workaround_in_silver = EXCLUDED.workaround_in_silver,
  estimated_impact_mxn = EXCLUDED.estimated_impact_mxn,
  evidence_url = EXCLUDED.evidence_url;
