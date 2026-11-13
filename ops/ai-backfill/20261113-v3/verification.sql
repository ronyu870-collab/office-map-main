-- Post-commit, read-only 100-field reconciliation / 2026-11-13 v3
-- Run in production qhgxougfzzmgqjzzwudf. No mutations.
WITH a AS(
 SELECT id,target_table,target_id::uuid target_id,target_name,
  details,(details->>'field_name') field_name,(details->>'building_id')::uuid building_id,
  (details->>'evidence_group_id')::uuid evidence_id,
  old_values,new_values,actor_kind,request_source,user_id
 FROM public.audit_logs
 WHERE action_type='AI_FIELD_FILL'
   AND details->>'batch_ref'='ai_building_field_backfill_20261113_v3'
), reconciled AS (
 SELECT a.*,p.id provenance_id,p.field_value,p.is_current,p.source_file_name,
  p.evidence_note,p.verification_status,
  (SELECT count(*) FROM public.building_data_field_provenance p2
   WHERE p2.evidence_group_id=a.evidence_id AND p2.target_table=a.target_table
    AND p2.field_name=a.field_name AND p2.building_id=a.building_id) source_count,
  CASE WHEN a.target_table='buildings' THEN to_jsonb(b)->a.field_name
       ELSE to_jsonb(d)->a.field_name END current_value,
  (b.id=a.building_id AND
    (a.target_table='buildings' OR d.building_id=b.id)) valid_identity
 FROM a
 LEFT JOIN public.buildings b ON b.id=a.building_id
 LEFT JOIN public.building_brochure_data d ON d.id=a.target_id AND a.target_table='building_brochure_data'
 LEFT JOIN public.building_data_field_provenance p ON p.evidence_group_id=a.evidence_id
    AND p.target_table=a.target_table AND p.field_name=a.field_name AND p.building_id=a.building_id
)
SELECT count(*) AS ai_field_audits,
 count(DISTINCT building_id) AS buildings_covered,
 count(DISTINCT (target_table,target_id,field_name)) AS unique_target_fields,
 count(provenance_id) AS provenance_rows,
 count(*) FILTER (WHERE source_count<>1) AS source_cardinality_errors,
 count(*) FILTER (WHERE current_value IS DISTINCT FROM new_values->field_name) AS business_mismatches,
 count(*) FILTER (WHERE field_value IS DISTINCT FROM new_values->field_name) AS provenance_mismatches,
 count(*) FILTER (WHERE old_values->field_name IS DISTINCT FROM 'null'::jsonb) AS nonempty_originals,
 count(*) FILTER (WHERE is_current IS DISTINCT FROM true) AS inactive_provenance,
 count(*) FILTER (WHERE valid_identity IS DISTINCT FROM true) AS identity_errors,
 count(*) FILTER (WHERE actor_kind<>'tool' OR request_source<>'codex_mcp' OR user_id<>'codex'
                    OR details->>'ai_assisted'<>'true') AS actor_errors,
 count(*) FILTER (WHERE verification_status<>'legacy_backfill') AS unclaimed_verification_levels,
 count(*) FILTER (WHERE evidence_note NOT LIKE '%batch=ai_building_field_backfill_20261113_v3;%') AS traceability_errors,
 count(*) FILTER (WHERE details->>'source_kind'='archived_internal_material' AND source_file_name IS NULL) AS missing_archived_filename
FROM reconciled;

-- Source kind and field distribution.
SELECT details->>'source_kind' source_kind,
       count(*) affected_fields,
       count(DISTINCT details->>'building_id') affected_buildings
FROM public.audit_logs WHERE action_type='AI_FIELD_FILL'
 AND details->>'batch_ref'='ai_building_field_backfill_20261113_v3'
GROUP BY 1 ORDER BY 1;

SELECT target_table,details->>'field_name' field_name,count(*) field_count
FROM public.audit_logs WHERE action_type='AI_FIELD_FILL'
 AND details->>'batch_ref'='ai_building_field_backfill_20261113_v3'
GROUP BY 1,2 ORDER BY field_count DESC,field_name;

-- Rollback was a rehearsal only: zero persisted rollback audit records.
SELECT count(*) AS persisted_rollback_audits FROM public.audit_logs
WHERE action_type='AI_FIELD_ROLLBACK'
 AND details->>'rollback_batch_ref'='ai_building_field_backfill_20261113_v3_rollback';
