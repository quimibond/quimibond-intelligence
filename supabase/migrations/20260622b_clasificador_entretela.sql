-- Clasificador automático de PROCESO de entretela desde la clave (DAT PD0202)
-- Lee malla (00=espolvoreo, >0=puntos) + resina + perforación, no el dibujo.
CREATE OR REPLACE FUNCTION clasificar_entretela_proceso(p_ref text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN s ~ 'FORM|APRESTO|MEZCLA|ABIFOR|^NH|LIMPIEZA|DESP|SALDO|VIGIL|KOLLA|HILO|^H[A-Z]' THEN 'Cocina/Otro'
    WHEN s ~ '/' THEN 'Perfoquim'
    WHEN s ~ '^[A-Z]{2,3}[0-9]{4}'
      THEN CASE WHEN substring(s from '^[A-Z]{2,3}([0-9]{2})')='00' THEN 'Espolvoreo' ELSE 'Puntos' END
    WHEN s ~ '^[A-Z][0-9]{2,3}T[0-9]{2}' THEN 'Termofijado'
    WHEN s ~ '^[A-Z][0-9]{2,3}T[A-Z]'  THEN 'Tramado'
    WHEN s ~ '^[A-Z][0-9]{2,3}[A-Z]'   THEN 'Carda'
    ELSE 'Revisar' END
  FROM (SELECT regexp_replace(regexp_replace(upper(trim(coalesce(p_ref,''))),'^I',''), '\s+IT?$','') AS s) q
$$;
