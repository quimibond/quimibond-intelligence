-- Clasificador de proceso de entretela v2 (DAT PD0202)
-- v2: + regla Impregnación (sufijo TE / dígito+T) + limpieza de typos (puntos en la clave)
CREATE OR REPLACE FUNCTION clasificar_entretela_proceso(p_ref text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN s ~ 'FORM|APRESTO|MEZCLA|ABIFOR|^NH|LIMPIEZA|DESP|SALDO|VIGIL|KOLLA|HILO|^H[A-Z]' THEN 'Cocina/Otro'
    WHEN s ~ '/' THEN 'Perfoquim'
    WHEN s ~ '^[A-Z]{2,3}[0-9]{4}'
      THEN CASE WHEN substring(s from '^[A-Z]{2,3}([0-9]{2})')='00' THEN 'Espolvoreo' ELSE 'Puntos' END
    WHEN s ~ 'TE$' OR s ~ '[0-9]T$' THEN 'Impregnación'
    WHEN s ~ '^[A-Z][0-9]{2,3}T[0-9]{2}' THEN 'Termofijado'
    WHEN s ~ '^[A-Z][0-9]{2,3}T[A-Z]'  THEN 'Tramado'
    WHEN s ~ '^[A-Z][0-9]{2,3}[A-Z]'   THEN 'Carda'
    ELSE 'Revisar' END
  FROM (SELECT regexp_replace(regexp_replace(regexp_replace(upper(trim(coalesce(p_ref,''))),'^I',''),'\s+IT?$',''),'\.','','g') AS s) q
$$;
