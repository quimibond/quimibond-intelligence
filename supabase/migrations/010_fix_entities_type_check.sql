-- Migration 010: Fix entities.entity_type CHECK for pipeline values
-- Claude prompt generates: person, company, product, machine, raw_material
-- Old CHECK only allowed: person, company, product, process, event, location
-- Entities with type 'machine' or 'raw_material' were silently rejected.
-- Applied via Supabase MCP on 2026-03-26.

ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_entity_type_check;
ALTER TABLE entities ADD CONSTRAINT entities_entity_type_check
  CHECK (entity_type IN (
    'person', 'company', 'product', 'process', 'event', 'location',
    'machine', 'raw_material'
  ));
