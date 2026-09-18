-- Prueba en seco: termina SIEMPRE con el error PRUEBA_OK (deshace todo).
DO $t$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM senales_config WHERE activa;
  ASSERT n >= 60, 'catálogo incompleto: ' || n;
  ASSERT (SELECT count(*) FROM senales_config WHERE fuente = 'memoria') = 9, 'señales de memoria';
  -- FK: una señal fuera del catálogo no entra.
  BEGIN
    INSERT INTO senales (clave, senal, area, tipo, fuente) VALUES ('x:1', 'no_existe', 'finanzas', 'problema', 'odoo');
    RAISE EXCEPTION 'la FK a senales_config no está';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  -- Único parcial: dos abiertas con la misma clave no caben; una resuelta sí.
  INSERT INTO senales (clave, senal, area, tipo, fuente, resuelta_en) VALUES ('cartera_vencida:partner:0', 'cartera_vencida', 'finanzas', 'credito', 'odoo', now());
  INSERT INTO senales (clave, senal, area, tipo, fuente) VALUES ('cartera_vencida:partner:0', 'cartera_vencida', 'finanzas', 'credito', 'odoo');
  BEGIN
    INSERT INTO senales (clave, senal, area, tipo, fuente) VALUES ('cartera_vencida:partner:0', 'cartera_vencida', 'finanzas', 'credito', 'odoo');
    RAISE EXCEPTION 'el índice único parcial no está';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  PERFORM buzon_personas_reemplazar('[{"buzon":"Ventas@Quimibond.com","odoo_user_id":7,"area":"comercial"}]'::jsonb);
  ASSERT (SELECT odoo_user_id FROM buzon_personas WHERE buzon = 'ventas@quimibond.com') = 7, 'buzon_personas en minúsculas';
  RAISE EXCEPTION 'PRUEBA_OK';
END $t$;
