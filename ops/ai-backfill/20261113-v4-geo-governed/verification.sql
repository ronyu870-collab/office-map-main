-- Independent post-COMMIT readback. Read-only, safe to rerun after rollback preview.
-- Source: production qhgxougfzzmgqjzzwudf; batch v4 GEO governed
WITH a AS (
 SELECT * FROM public.audit_logs
 WHERE action_type='AI_FIELD_FILL'
   AND details->>'batch_ref'='ai_building_field_backfill_20261113_v4_geo_governed'
),
p AS (
 SELECT * FROM public.building_data_field_provenance
 WHERE evidence_note LIKE '%batch=ai_building_field_backfill_20261113_v4_geo_governed;%'
),
j AS (
 SELECT a.id audit_id, a.target_id, a.target_table, a.details->>'field_name' field_name,
   a.old_values, a.new_values, a.actor_kind, a.user_id, a.event_id, a.details,
   a.details->>'building_id' bid, a.details->>'source_table' src_tab,
   a.details->>'source_record_id' src_id, pv.id p_id, pv.field_value p_val,
   pv.verification_status p_status, pv.source_type p_type,pv.source_tier p_tier,
   pv.is_current p_current,pv.source_retrieved_at p_retrieved,pv.source_name p_name,
   pv.evidence_note p_note,
   CASE WHEN a.target_table='buildings'
     THEN to_jsonb(b)->(a.details->>'field_name')
     ELSE to_jsonb(d)->(a.details->>'field_name') END live_value,
   b.name live_name,b.is_active,b.merged_into_id
 FROM a LEFT JOIN public.building_data_field_provenance pv
   ON pv.evidence_group_id=(a.details->>'evidence_group_id')::uuid
   AND pv.target_table=a.target_table
   AND pv.field_name=a.details->>'field_name'
   AND pv.building_id=(a.details->>'building_id')::uuid
 LEFT JOIN public.buildings b ON b.id=(a.details->>'building_id')::uuid
 LEFT JOIN public.building_brochure_data d ON d.id=a.target_id::uuid AND d.building_id=b.id
)
SELECT
 (SELECT count(*) FROM a) audit_records,
 (SELECT count(*) FROM p) provenance_records,
 count(*) inspected_fields,
 count(DISTINCT bid) covered_buildings,
 count(DISTINCT target_table||':'||target_id||':'||field_name) unique_field_targets,
 count(*) FILTER(WHERE p_id IS NULL) missing_provenance,
 count(*) FILTER(WHERE p_val IS DISTINCT FROM live_value) provenance_live_mismatch,
 count(*) FILTER(WHERE p_val IS DISTINCT FROM new_values->field_name) provenance_audit_mismatch,
 count(*) FILTER(WHERE live_value IS DISTINCT FROM new_values->field_name) audit_live_mismatch,
 count(*) FILTER(WHERE NOT(old_values ? field_name AND old_values->field_name='null'::jsonb)) incorrect_original_null,
 count(*) FILTER(WHERE p_status<>'legacy_backfill' OR p_current IS DISTINCT FROM true
   OR p_retrieved IS NULL OR p_note NOT LIKE '%AI_ASSISTED_INTERNAL_BACKFILL%') invalid_provenance,
 count(*) FILTER(WHERE actor_kind<>'tool' OR user_id<>'codex'
   OR details->>'ai_assisted'<>'true' OR details->>'reversible'<>'true') invalid_ai_audit,
 count(*) FILTER(WHERE live_name IS NULL OR is_active IS DISTINCT FROM true
   OR merged_into_id IS NOT NULL) invalid_building,
 count(*) FILTER(WHERE src_tab='building_sales_materials' AND
   NOT EXISTS(SELECT 1 FROM public.building_sales_materials m
     WHERE m.id=src_id::uuid AND m.building_id=bid::uuid AND m.association_status='confirmed'
       AND m.status='ready')) missing_archived_source,
 count(*) FILTER(WHERE src_tab='buildings' AND NOT EXISTS(
     SELECT 1 FROM public.buildings source_b WHERE source_b.id=src_id::uuid AND source_b.id=bid::uuid)) missing_master_source,
 count(*) FILTER(WHERE src_tab='building_brochure_data' AND NOT EXISTS(
     SELECT 1 FROM public.building_brochure_data source_d WHERE source_d.id=src_id::uuid AND source_d.building_id=bid::uuid)) missing_brochure_source,
 (SELECT count(*) FROM public.audit_logs
  WHERE action_type='AI_FIELD_ROLLBACK' AND details->>'rollback_batch_ref'='ai_building_field_backfill_20261113_v4_geo_governed_rollback') actual_rollback_audits
FROM j;