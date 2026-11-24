-- Independent production readback; no private source values returned.
WITH audits AS (
 SELECT a.*,a.details->>'field_name' field_name,(a.details->>'building_id')::uuid building_id,(a.details->>'evidence_group_id')::uuid evidence_id,a.details->>'source_kind' source_kind,a.details->>'source_table' source_table,(a.details->>'source_record_id')::uuid source_id
 FROM public.audit_logs a WHERE action_type='AI_FIELD_FILL' AND details->>'batch_ref'='ai_building_field_backfill_20261124_v3_100'
), checked AS (
 SELECT a.*,p.id prov_id,p.is_current,p.field_value,p.source_type,p.verification_status,p.evidence_note,
 CASE WHEN a.target_table='buildings' THEN to_jsonb(b)->a.field_name WHEN a.target_table='building_brochure_data' THEN to_jsonb(d)->a.field_name END actual,
 CASE WHEN a.source_table='buildings' THEN to_jsonb(src)->'submarket'
 WHEN a.source_table='quarterly_submissions' THEN to_jsonb(trim(q.owner))
 WHEN a.source_table='building_sales_materials' AND a.field_name='floors_below' THEN to_jsonb((regexp_match(m.project_facts->2->>'value','地下([0-9]+)层.*地下\1层'))[1]::int)
 WHEN a.source_table='building_sales_materials' AND a.field_name='parking_underground' THEN to_jsonb((regexp_match(m.project_facts->5->>'value','地下约([0-9]+)车位'))[1]::int) END source_value,
 (SELECT count(*) FROM public.building_data_field_provenance pp WHERE pp.building_id=a.building_id AND pp.target_table=a.target_table AND pp.field_name=a.field_name AND pp.is_current) current_sources,
 CASE WHEN a.target_table='buildings' THEN b.id=a.building_id WHEN a.target_table='building_brochure_data' THEN d.building_id=a.building_id END identity_ok
 FROM audits a LEFT JOIN public.buildings b ON a.target_table='buildings' AND b.id=a.target_id::uuid
 LEFT JOIN public.building_brochure_data d ON a.target_table='building_brochure_data' AND d.id=a.target_id::uuid
 LEFT JOIN public.building_data_field_provenance p ON p.evidence_group_id=a.evidence_id AND p.building_id=a.building_id AND p.target_table=a.target_table AND p.field_name=a.field_name AND (a.target_table='buildings' AND p.brochure_data_id IS NULL OR a.target_table='building_brochure_data' AND p.brochure_data_id=d.id)
 LEFT JOIN public.buildings src ON a.source_table='buildings' AND src.id=a.source_id AND src.id=a.building_id
 LEFT JOIN public.quarterly_submissions q ON a.source_table='quarterly_submissions' AND q.id=a.source_id AND q.building_id=a.building_id AND q.record_year=2026 AND q.record_quarter=3
 LEFT JOIN public.building_sales_materials m ON a.source_table='building_sales_materials' AND m.id=a.source_id AND m.building_id=a.building_id AND m.association_status='confirmed' AND m.status='ready'
)
SELECT count(*) AS audit_join_rows,count(distinct id) audit_rows,count(distinct (target_table,target_id,field_name)) unique_fields,count(distinct building_id) buildings,
 count(distinct prov_id) matched_provenance,
 (SELECT count(*) FROM public.building_data_field_provenance WHERE is_current AND evidence_note LIKE 'batch_ref=ai_building_field_backfill_20261124_v3_100;%') batch_current_provenance,
 count(*) FILTER (WHERE actual IS NULL OR actual='null'::jsonb OR actual IS DISTINCT FROM new_values->field_name OR actual IS DISTINCT FROM field_value OR source_value IS DISTINCT FROM actual OR is_current IS DISTINCT FROM true OR current_sources<>1 OR identity_ok IS DISTINCT FROM true OR old_values->field_name IS DISTINCT FROM 'null'::jsonb OR actor_kind IS DISTINCT FROM 'tool' OR user_id IS DISTINCT FROM 'codex' OR actor_name IS DISTINCT FROM 'ChatGPT AI' OR verification_status IS DISTINCT FROM 'legacy_backfill' OR (details->>'ai_assisted') IS DISTINCT FROM 'true' OR position('source_record_id='||source_id::text in coalesce(evidence_note,''))=0) failures,
 (SELECT jsonb_object_agg(field_name,n) FROM (SELECT field_name,count(*) n FROM audits GROUP BY 1) x) fields,
 (SELECT jsonb_object_agg(source_kind,n) FROM (SELECT source_kind,count(*) n FROM audits GROUP BY 1) x) sources,
 (SELECT jsonb_object_agg(target_table,n) FROM (SELECT target_table,count(*) n FROM audits GROUP BY 1) x) tables,
 (SELECT jsonb_object_agg(sub_batch,n) FROM (SELECT details->>'sub_batch' sub_batch,count(*) n FROM audits GROUP BY 1) x) batches,
 (SELECT count(*) FROM public.audit_logs WHERE action_type='AI_FIELD_ROLLBACK' AND details->>'rollback_batch_ref'='ai_building_field_backfill_20261124_v3_100_rollback') persisted_rollbacks
FROM checked;