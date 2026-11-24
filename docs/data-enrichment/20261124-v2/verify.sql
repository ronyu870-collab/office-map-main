-- Independent post-commit checks: count business fields, not evidence rows.
WITH a AS (
  SELECT * FROM public.audit_logs WHERE details->>'batch_id'='ai_technical_fields_20261124_v2' AND action_type='AI_FIELD_FILL'
), checks AS (
  SELECT a.id,a.target_name,a.details->>'field_name' AS field_name,a.details->>'source_type' AS source_type,
  a.old_values->(a.details->>'field_name') AS original,
  a.new_values->(a.details->>'field_name') AS expected,
  to_jsonb(d)->(a.details->>'field_name') AS actual,
  a.details->>'building_id' AS building_id,
  d.building_id::text=a.details->>'building_id' AS identity_ok,
  d.updated_at=(a.details->>'target_updated_at_after')::timestamptz AS timestamp_ok,
  a.actor_kind, a.user_id,a.request_source,
  (SELECT count(*) FROM public.building_data_field_provenance p WHERE p.evidence_group_id=(a.details->>'evidence_group_id')::uuid AND p.is_current AND p.building_id=d.building_id AND p.brochure_data_id=d.id AND p.target_table='building_brochure_data' AND p.field_name=a.details->>'field_name' AND p.field_value=a.new_values->(a.details->>'field_name') AND p.verification_status=a.details->>'verification_status') AS evidence_matched,
  (SELECT count(*) FROM public.building_data_field_provenance p WHERE p.evidence_group_id=(a.details->>'evidence_group_id')::uuid) AS evidence_total,
  (a.details->>'provenance_count')::int AS expected_evidence
  FROM a LEFT JOIN public.building_brochure_data d ON d.id=a.target_id::uuid
)
SELECT count(*) AS business_fields,count(DISTINCT building_id) AS buildings,
 count(*) FILTER (WHERE original='null'::jsonb) AS originally_null,
 count(*) FILTER (WHERE actual=expected AND identity_ok AND timestamp_ok AND evidence_matched=expected_evidence AND evidence_total=expected_evidence) AS verified,
 sum(evidence_matched) AS provenance_matched,
 count(*) FILTER (WHERE source_type='internal') AS internal_fields,
 count(*) FILTER (WHERE source_type='internet') AS internet_fields,
 count(*) FILTER (WHERE actor_kind='unknown') AS unknown_actor_kind,
 jsonb_object_agg(target_name||'/'||field_name,actual ORDER BY target_name,field_name) AS field_readback
FROM checks;
