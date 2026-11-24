-- Read-only live-production field manifest and integrity verification.
-- Batch: ai_brochure_submarket_20261124_100_v1.
-- All building names/IDs/values are fetched from the protected target DB at runtime.
-- The public GitHub repository stores NO raw Broker records, private originals or keys.

WITH manifest AS (
  SELECT
    a.id AS audit_id,
    a.created_at AS audit_created_at,
    a.user_id AS executor_original_id,
    a.actor_kind AS audited_actor_kind,
    a.request_source,
    a.action_type,
    a.details->>'batch_id' AS batch_id,
    a.details->>'building_id' AS recorded_building_id,
    a.details->>'field_name' AS recorded_field_name,
    a.details->>'provenance_id' AS recorded_provenance_id,
    a.old_values->'submarket' AS old_value_json,
    a.new_values->>'submarket' AS recorded_new_value,
    a.details->>'target_updated_at_after' AS expected_target_updated_at,
    a.details->>'source_record_id' AS recorded_source_record_id,
    a.details->>'ai_assisted' AS ai_assisted,
    a.details->>'executor' AS executor_description,
    a.details->>'source_period' AS original_source_period,
    a.details->>'unit' AS unit,
    b.id AS source_building_id,
    b.name AS source_building_name,
    b.submarket AS source_submarket,
    b.is_active,
    b.tracking_scope,
    b.merged_into_id,
    b.project_type,
    b.is_entered_market,
    d.id AS target_record_id,
    d.name_cn AS target_building_name,
    d.submarket AS current_target_value,
    d.updated_at AS current_target_updated_at,
    p.id AS provenance_id,
    p.target_table AS provenance_target_table,
    p.field_name AS provenance_field,
    p.field_value AS provenance_value,
    p.source_name,
    p.source_type,
    p.source_tier,
    p.source_url,
    p.source_published_date,
    p.source_retrieved_at,
    p.value_recorded_at,
    p.verification_status,
    p.is_current AS provenance_is_current,
    p.evidence_note
  FROM public.audit_logs a
  LEFT JOIN public.building_brochure_data d ON d.id::text = a.target_id
  LEFT JOIN public.buildings b ON b.id = d.building_id
  LEFT JOIN public.building_data_field_provenance p
    ON p.id::text = a.details->>'provenance_id'
  WHERE a.action_type = 'AI_FIELD_FILL'
    AND a.details->>'batch_id' = 'ai_brochure_submarket_20261124_100_v1'
)
SELECT
  count(*) AS audit_rows,
  count(DISTINCT recorded_building_id) AS unique_buildings,
  count(DISTINCT provenance_id) AS provenance_rows,
  count(*) FILTER (WHERE old_value_json = 'null'::jsonb) AS originally_null,
  count(*) FILTER (
    WHERE recorded_building_id = source_building_id::text
      AND recorded_source_record_id = source_building_id::text
      AND source_building_name = target_building_name
      AND is_active AND tracking_scope = 'tracked'
      AND merged_into_id IS NULL
      AND project_type = 'stock' AND is_entered_market
      AND recorded_field_name = 'submarket'
      AND recorded_new_value = current_target_value
      AND current_target_value = source_submarket
      AND provenance_value = to_jsonb(current_target_value)
      AND provenance_target_table = 'building_brochure_data'
      AND provenance_field = 'submarket'
      AND provenance_is_current
      AND source_type = 'other'
      AND verification_status = 'legacy_backfill'
      AND ai_assisted = 'true'
      AND current_target_updated_at = expected_target_updated_at::timestamptz
  ) AS complete_validated_rows,
  count(*) FILTER (WHERE audited_actor_kind = 'unknown') AS identity_pending_actor_rows,
  count(*) FILTER (WHERE source_type = 'internet') AS externally_verified_source_rows
FROM manifest;

-- Detail-level manifest. Keep the actual results private to the authorized DB session.
SELECT
  b.id AS building_id,
  b.name AS building_name_and_original_tower_scope,
  a.target_table,
  a.target_id AS target_record_id,
  'submarket' AS field_name,
  a.old_values->'submarket' AS original_null_json,
  a.new_values->>'submarket' AS inserted_value,
  d.submarket AS current_value,
  'buildings' AS internal_source_table,
  b.id AS internal_source_record_id,
  p.source_name,
  p.source_url,
  p.source_published_date,
  p.source_retrieved_at,
  p.value_recorded_at,
  a.details->>'source_period' AS data_period,
  a.details->>'unit' AS value_unit,
  p.source_tier,
  p.verification_status,
  p.is_current,
  p.id AS provenance_id,
  a.id AS audit_id,
  a.actor_kind,
  a.user_id AS original_actor_identifier,
  a.request_source,
  a.details->>'executor' AS executor,
  a.details->>'batch_id' AS batch_id
FROM public.audit_logs a
JOIN public.building_brochure_data d ON d.id::text = a.target_id
JOIN public.buildings b ON b.id = d.building_id
JOIN public.building_data_field_provenance p
  ON p.id::text = a.details->>'provenance_id'
WHERE a.action_type = 'AI_FIELD_FILL'
  AND a.details->>'batch_id' = 'ai_brochure_submarket_20261124_100_v1'
ORDER BY b.submarket, b.name, b.id;

-- A successful rollback preview leaves exactly 100 live values and no
-- durable compensating audit events:
SELECT count(*) AS unexpectedly_persisted_rollback_events
FROM public.audit_logs
WHERE action_type = 'AI_FIELD_ROLLBACK'
  AND details->>'reverts_batch_id' = 'ai_brochure_submarket_20261124_100_v1';
