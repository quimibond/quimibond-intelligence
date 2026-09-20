DO $t$
DECLARE r jsonb; c uuid := gen_random_uuid(); s record;
BEGIN
  INSERT INTO senales_config (senal, titulo, area, tipo, fuente, agrupar_por, agregar)
  VALUES ('_prueba', 'Prueba', 'finanzas', 'credito', 'odoo', 'contraparte', 'suma');

  -- 1. Lote con dos claves → dos nuevas, lote ok.
  r := senales_ingestar('_prueba', 'odoo', c, '[
    {"clave":"_prueba:partner:990000001","odoo_partner_id":990000001,"valor":100,"valor_texto":"cien","documentos":[{"modelo":"account.move","id":11,"nombre":"F/1"}],"payload":{"rfc":"XAXX010101000"}},
    {"clave":"_prueba:partner:990000002","odoo_partner_id":990000002,"valor":5}
  ]'::jsonb);
  ASSERT (r->>'ok')::bool AND (r->>'nuevas')::int = 2 AND (r->>'resueltas')::int = 0, 'lote 1: ' || r::text;
  ASSERT (SELECT n_claves FROM senales_lotes WHERE corrida = c AND senal = '_prueba') = 2, 'senales_lotes';
  SELECT * INTO s FROM senales WHERE clave = '_prueba:partner:990000001' AND resuelta_en IS NULL;
  ASSERT s.agrupador = 'partner:990000001' AND s.area = 'finanzas' AND s.episodio = 1, 'agrupador/area/episodio: ' || s.agrupador;

  -- 2. Mismo valor → actualizada sin cambio de valor; valor nuevo → valor_cambio_en avanza.
  PERFORM pg_sleep(0.01);
  r := senales_ingestar('_prueba', 'odoo', gen_random_uuid(), '[{"clave":"_prueba:partner:990000001","odoo_partner_id":990000001,"valor":100},{"clave":"_prueba:partner:990000002","odoo_partner_id":990000002,"valor":9}]'::jsonb);
  ASSERT (r->>'actualizadas')::int = 2 AND (r->>'nuevas')::int = 0, 'lote 2: ' || r::text;
  ASSERT (SELECT valor_cambio_en = primera_vista FROM senales WHERE clave = '_prueba:partner:990000001' AND resuelta_en IS NULL), 'valor igual no mueve valor_cambio_en';
  ASSERT (SELECT valor_cambio_en > primera_vista FROM senales WHERE clave = '_prueba:partner:990000002' AND resuelta_en IS NULL), 'valor distinto mueve valor_cambio_en';

  -- 3. Lote sin la clave 2 → se resuelve; la 1 sigue abierta.
  r := senales_ingestar('_prueba', 'odoo', gen_random_uuid(), '[{"clave":"_prueba:partner:990000001","odoo_partner_id":990000001,"valor":100}]'::jsonb);
  ASSERT (r->>'resueltas')::int = 1, 'lote 3: ' || r::text;
  ASSERT (SELECT resuelta_en IS NOT NULL FROM senales WHERE clave = '_prueba:partner:990000002'), 'clave 2 resuelta';

  -- 4. Reaparece → episodio 2, fila nueva, la vieja conserva resuelta_en.
  r := senales_ingestar('_prueba', 'odoo', gen_random_uuid(), '[{"clave":"_prueba:partner:990000001","odoo_partner_id":990000001,"valor":100},{"clave":"_prueba:partner:990000002","odoo_partner_id":990000002,"valor":1}]'::jsonb);
  ASSERT (SELECT episodio FROM senales WHERE clave = '_prueba:partner:990000002' AND resuelta_en IS NULL) = 2, 'episodio 2';
  ASSERT (SELECT count(*) FROM senales WHERE clave = '_prueba:partner:990000002') = 2, 'dos filas de la clave 2';

  -- 5. Lote vacío = todo resuelto (lista completa). Lote malformado = ok=false y fila de lote con error, sin tocar señales.
  r := senales_ingestar('_prueba', 'odoo', gen_random_uuid(), '[]'::jsonb);
  ASSERT (r->>'resueltas')::int = 2, 'lote vacío resuelve todo: ' || r::text;
  r := senales_ingestar('_prueba', 'odoo', gen_random_uuid(), '[{"clave":"_prueba:partner:990000003","valor":"no-es-numero"}]'::jsonb);
  ASSERT NOT (r->>'ok')::bool AND r->>'error' IS NOT NULL, 'lote malo: ' || r::text;
  ASSERT (SELECT ok = false AND error IS NOT NULL FROM senales_lotes WHERE senal = '_prueba' ORDER BY id DESC LIMIT 1), 'lote malo registrado';
  ASSERT (SELECT count(*) FROM senales WHERE clave = '_prueba:partner:990000003') = 0, 'lote malo no inserta';

  -- 6. Fuente equivocada o señal desconocida: excepción (error de configuración, no de datos).
  BEGIN
    PERFORM senales_ingestar('_prueba', 'memoria', gen_random_uuid(), '[]'::jsonb);
    RAISE EXCEPTION 'debió rechazar la fuente';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'debió rechazar la fuente' THEN RAISE; END IF;
  END;

  -- 7. push_terminado nunca falla aunque la Edge Function no exista.
  ASSERT senales_push_terminado(c, 'odoo') IS NOT NULL, 'push_terminado';
  RAISE EXCEPTION 'PRUEBA_OK';
END $t$;
