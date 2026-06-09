-- 2026-06-05h: ajuste de fab_weight_share 0.47 -> 0.67.
--
-- El CEO refinó: el GAS de acabado (504.01.0003, calentar/secar) consume MÁS
-- por metro en una tela pesada (más agua y masa que secar) → es driver de PESO,
-- no de largo. La mano de obra y velocidad de línea de acabado + entretelas +
-- inspección siguen por LARGO. Moviendo el gas (~$546k/mes) al pool de peso:
--   pool peso (tejido + tintorería + gas acabado) = ~$1.81M
--   pool largo (acabado sin gas + entretelas)      = ~$0.88M
--   weight_share = 0.67.
-- Resultado: las telas pesadas pagan un poco más que con 0.47 (porque sí
-- gastan más gas), pero siguen con alivio vs el 100% peso.

UPDATE public.costing_config
SET value = 0.67, updated_at = now(),
    notes = 'Fraccion de la fabricacion por PESO. Incluye TEJIDO + TINTORERIA + GAS de acabado (504.01.0003). El resto por LARGO/metro: MOD y velocidad de linea de ACABADO + ENTRETELAS + inspeccion. ~67%. Editable.'
WHERE key = 'fab_weight_share';

-- por si el seed previo no existía (deploy nuevo corre g y luego h)
INSERT INTO public.costing_config (key, value, notes)
VALUES ('fab_weight_share', 0.67, 'Fraccion de fabricacion por PESO (tejido+tintoreria+gas acabado). ~67%. Editable.')
ON CONFLICT (key) DO UPDATE SET value = 0.67;
