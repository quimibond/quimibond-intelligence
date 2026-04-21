BEGIN;

ALTER TABLE mdm_manual_overrides ADD COLUMN IF NOT EXISTS action text DEFAULT 'link'
  CHECK (action IN ('link','unlink','merge','split','assign_attribute'));
ALTER TABLE mdm_manual_overrides ADD COLUMN IF NOT EXISTS source_link_id bigint REFERENCES source_links(id);
ALTER TABLE mdm_manual_overrides ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}'::jsonb;
ALTER TABLE mdm_manual_overrides ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE mdm_manual_overrides ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE mdm_manual_overrides ADD COLUMN IF NOT EXISTS revoke_reason text;

CREATE INDEX IF NOT EXISTS ix_mmo_active ON mdm_manual_overrides (is_active) WHERE is_active = true;

-- Backfill payload from SP2's override_field/override_value columns
UPDATE mdm_manual_overrides
SET payload = jsonb_build_object(
  'override_field', override_field,
  'override_value', override_value,
  'override_source', override_source
)
WHERE (payload = '{}'::jsonb OR payload IS NULL)
  AND override_field IS NOT NULL;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('alter_table','mdm_manual_overrides','SP3 Task 14: extend per §6.4 (action/source_link_id/payload/expires/is_active/revoke_reason) + backfill payload','20260423_sp3_14_mdm_manual_overrides_extend.sql','silver-sp3',true);

COMMIT;
