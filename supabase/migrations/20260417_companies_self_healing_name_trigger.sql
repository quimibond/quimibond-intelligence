-- Item 3 · Self-healing trigger para companies.name
-- Aplicada en prod via MCP: `companies_self_healing_name_trigger_v2`.
--
-- Por qué no un CHECK constraint duro:
-- `companies.name` es NOT NULL. Un CHECK que falle haría fallar batches
-- completos del sync qb19 (upsert de 100+ partners atomic). Trigger
-- BEFORE INSERT/UPDATE se ejecuta per-row sin romper batch.
--
-- Lógica:
--   1. Si name es válido → no hace nada
--   2. Si name es basura (numérico/corto) pero canonical_name es
--      válido → substitute con canonical_name
--   3. Si ambos son basura → deja name intacto (NOT NULL constraint)
--      y UI aplica sanitizeCompanyName backstop para mostrar "—"

CREATE OR REPLACE FUNCTION companies_sanitize_name()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.name IS NOT NULL
     AND (LENGTH(TRIM(NEW.name)) < 3 OR TRIM(NEW.name) ~ '^[0-9]+$')
  THEN
    IF NEW.canonical_name IS NOT NULL
       AND LENGTH(TRIM(NEW.canonical_name)) >= 3
       AND TRIM(NEW.canonical_name) !~ '^[0-9]+$'
    THEN
      NEW.name := NEW.canonical_name;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_companies_sanitize_name ON companies;
CREATE TRIGGER trg_companies_sanitize_name
  BEFORE INSERT OR UPDATE OF name, canonical_name
  ON companies
  FOR EACH ROW
  EXECUTE FUNCTION companies_sanitize_name();

COMMENT ON FUNCTION companies_sanitize_name() IS
  'Self-healing: reemplaza names numéricos por canonical_name. No setea NULL. Evita rompimiento del sync batch mientras previene propagación de basura.';
