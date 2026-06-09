-- 2026-06-05j: ampliar pendiente de BOMs infladas para incluir WR17066.
--
-- WR17066JNG002163: la BOM consume 0.315 kg/m de hilo para una tela de
-- 0.170 kg/m (170 g/m lineal, confirmado CEO) -> ~46% del hilo "desaparece",
-- imposible. Mismo patrón que WC090/WJ055 (consumo inflado). Sobre-estima el MP.
-- Idempotente por action_key.

INSERT INTO public.odoo_pending_actions
  (action_key, area, severity, title, problem_description, fix_in_odoo, status, assignee)
VALUES (
  'bom-cantidades-infladas-wc090-wj055', 'costos', 'medium',
  'BOMs con consumo de material inflado (cantidades ~2x lo real)',
  'Varias BOMs consumen mucho mas material del que pesa la tela terminada, infla el costo primo MP y/o el peso. Casos: WC090Q11JNT170 y WJ055Q23JNT165 (consumo ~10x el peso). WR17066JNG002163: la BOM consume 0.315 kg/m de hilo (HPESTEX75/36) para una tela de 0.170 kg/m (170 g/m lineal confirmado por CEO) -> ~46% del hilo desaparece, imposible (el tejido pierde 2-5%). El consumo de hilo esta inflado ~1.85x, por lo que su MP esta sobrestimado. Probable error de captura en Odoo (cantidad por lote vs por metro).',
  'Revisar y corregir el consumo de componentes en las BOMs afectadas (WC090, WJ055, WR17066 y similares): la suma de kg de hilo por metro debe acercarse al peso de la tela (gramaje x ancho) + ~5% de merma. Revisar si la cantidad esta capturada por lote en vez de por metro.',
  'open', 'Costos / Produccion'
)
ON CONFLICT (action_key) DO UPDATE SET
  title = EXCLUDED.title,
  problem_description = EXCLUDED.problem_description,
  fix_in_odoo = EXCLUDED.fix_in_odoo,
  severity = EXCLUDED.severity;
