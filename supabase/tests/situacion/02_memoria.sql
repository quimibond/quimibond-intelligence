DO $t$
DECLARE r jsonb; c uuid := gen_random_uuid(); n int;
BEGIN
  r := senales_memoria(c);
  ASSERT (r->'cliente_sin_respuesta'->>'ok')::bool, 'cliente_sin_respuesta: ' || (r->'cliente_sin_respuesta')::text;
  ASSERT (r->'compromiso_correo'->>'ok')::bool, 'compromiso_correo: ' || (r->'compromiso_correo')::text;
  ASSERT (SELECT count(*) FROM senales_lotes WHERE corrida = c AND fuente = 'memoria' AND ok) >= 8, 'ocho o nueve lotes de memoria (cliente_callado solo en su turno de 24 h)';
  -- Con datos reales hay conversaciones sin respuesta (57 el 18-sep) y compromisos (452).
  SELECT count(*) INTO n FROM senales WHERE senal = 'cliente_sin_respuesta' AND resuelta_en IS NULL;
  ASSERT n > 0, 'cliente_sin_respuesta sin filas';
  ASSERT (SELECT bool_and(clave LIKE 'cliente_sin_respuesta:company:%' AND company_id IS NOT NULL AND agrupador LIKE 'company:%') FROM senales WHERE senal = 'cliente_sin_respuesta' AND resuelta_en IS NULL), 'claves por empresa';
  SELECT count(*) INTO n FROM senales WHERE senal = 'compromiso_correo' AND resuelta_en IS NULL;
  ASSERT n > 0, 'compromiso_correo sin filas';
  ASSERT (SELECT bool_and(payload ? 'ultimo_correo' AND payload ? 'que') FROM senales WHERE senal = 'compromiso_correo' AND resuelta_en IS NULL), 'payload del compromiso';
  -- Idempotente: segunda corrida no crea filas nuevas.
  r := senales_memoria(gen_random_uuid());
  ASSERT (r->'compromiso_correo'->>'nuevas')::int = 0, 'segunda corrida: ' || (r->'compromiso_correo')::text;
  RAISE EXCEPTION 'PRUEBA_OK';
END $t$;
