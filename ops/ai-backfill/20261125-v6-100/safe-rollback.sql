-- GUARDED REVERSAL PREVIEW ONLY. This file ends in ROLLBACK by design.
-- No persistent reversal authorized. Actual future rollback requires separate authorization.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
SET LOCAL application_name='colliers_ai_backfill_20261125_v6_rollback';
DO $rollback$
DECLARE r record; n int:=0; changed int; current_value jsonb; p_expected int; row_updated timestamptz; batch_last timestamptz; ev uuid; now_ts timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('ai_building_field_backfill_20261125_v6_100'));
 IF (SELECT count(*) FROM public.audit_logs WHERE action_type='AI_FIELD_FILL' AND details->>'batch_ref'='ai_building_field_backfill_20261125_v6_100')<>100 THEN RAISE EXCEPTION 'original batch count not 100'; END IF;
 IF EXISTS (SELECT 1 FROM public.audit_logs WHERE action_type='AI_FIELD_ROLLBACK' AND details->>'rollback_batch_ref'='ai_building_field_backfill_20261125_v6_100_rollback') THEN RAISE EXCEPTION 'already rolled back'; END IF;
 -- Lock affected rows only; no table-wide locks on normal users' work.
 PERFORM 1 FROM public.buildings b WHERE b.id IN (SELECT a.target_id::uuid FROM public.audit_logs a WHERE a.target_table='buildings' AND a.action_type='AI_FIELD_FILL' AND a.details->>'batch_ref'='ai_building_field_backfill_20261125_v6_100') ORDER BY b.id FOR UPDATE;
 PERFORM 1 FROM public.building_brochure_data d WHERE d.id IN (SELECT a.target_id::uuid FROM public.audit_logs a WHERE a.target_table='building_brochure_data' AND a.action_type='AI_FIELD_FILL' AND a.details->>'batch_ref'='ai_building_field_backfill_20261125_v6_100') ORDER BY d.id FOR UPDATE;
 PERFORM 1 FROM public.building_data_field_provenance p WHERE p.evidence_group_id IN (SELECT (a.details->>'evidence_group_id')::uuid FROM public.audit_logs a WHERE a.action_type='AI_FIELD_FILL' AND a.details->>'batch_ref'='ai_building_field_backfill_20261125_v6_100') ORDER BY p.id FOR UPDATE;
 -- Validate ALL rows before the first reversal.
 FOR r IN SELECT a.*,a.details->>'field_name' field_name,(a.details->>'building_id')::uuid building_id,(a.details->>'evidence_group_id')::uuid evidence_id FROM public.audit_logs a WHERE a.action_type='AI_FIELD_FILL' AND a.details->>'batch_ref'='ai_building_field_backfill_20261125_v6_100' ORDER BY a.id LOOP
  IF NOT (r.target_table='building_brochure_data' AND r.field_name IN ('building_floors','clear_height','developer','efficiency_rate','elevator_freight','elevator_passenger','elevator_zones','facade_type','floor_height','floor_load_office','floors_above','floors_below','gfa_office','gfa_retail','gfa_total','grade','hvac_cooling_water_24h','hvac_system','metro_access','parking_above','parking_total','parking_underground','parking_underground_floor','power_backup_generator','removable_floor','standard_floor_area','telecom_provider')) THEN RAISE EXCEPTION 'unexpected target'; END IF;
  IF r.old_values->r.field_name IS DISTINCT FROM 'null'::jsonb OR r.new_values->r.field_name IS NULL OR r.new_values->r.field_name='null'::jsonb THEN RAISE EXCEPTION 'invalid original values'; END IF;
  EXECUTE format('SELECT to_jsonb(%I) FROM public.%I WHERE id=$1',r.field_name,r.target_table) INTO current_value USING r.target_id::uuid;
  IF current_value IS DISTINCT FROM r.new_values->r.field_name THEN RAISE EXCEPTION 'target field changed since batch: audit %',r.id; END IF;
  IF (SELECT count(*) FROM public.building_data_field_provenance p WHERE p.building_id=r.building_id AND p.target_table=r.target_table AND p.field_name=r.field_name AND p.is_current)<>(CASE WHEN r.details->>'source_kind'='external_cross_verified' THEN jsonb_array_length(r.details->'source_urls') ELSE 1 END) THEN RAISE EXCEPTION 'source count conflict'; END IF;
  IF (SELECT count(*) FROM public.building_data_field_provenance p WHERE p.evidence_group_id=r.evidence_id AND p.building_id=r.building_id AND p.target_table=r.target_table AND p.field_name=r.field_name AND p.is_current AND p.field_value=current_value AND (r.target_table='buildings' AND p.brochure_data_id IS NULL OR r.target_table='building_brochure_data' AND p.brochure_data_id=r.target_id::uuid))<>(CASE WHEN r.details->>'source_kind'='external_cross_verified' THEN jsonb_array_length(r.details->'source_urls') ELSE 1 END) THEN RAISE EXCEPTION 'source identity or value mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM public.audit_logs later WHERE later.target_table=r.target_table AND later.target_id=r.target_id AND later.id>r.id AND later.details->>'batch_ref' IS DISTINCT FROM 'ai_building_field_backfill_20261125_v6_100' AND (coalesce(later.actor_kind,'unknown') NOT IN ('tool','system') OR coalesce(later.old_values,'{}'::jsonb) ? r.field_name OR coalesce(later.new_values,'{}'::jsonb) ? r.field_name OR later.details->>'field_name'=r.field_name)) THEN RAISE EXCEPTION 'later audit detected; abort whole reversal'; END IF;
  IF r.target_table='building_brochure_data' THEN
   SELECT d.updated_at INTO row_updated FROM public.building_brochure_data d WHERE d.id=r.target_id::uuid AND d.building_id=r.building_id;
   SELECT max(a.occurred_at) INTO batch_last FROM public.audit_logs a WHERE a.action_type='AI_FIELD_FILL' AND a.details->>'batch_ref'='ai_building_field_backfill_20261125_v6_100' AND a.target_table=r.target_table AND a.target_id=r.target_id;
   IF row_updated IS NULL OR batch_last IS NULL OR row_updated>batch_last THEN RAISE EXCEPTION 'brochure row changed since last batch update'; END IF;
  ELSIF r.target_id::uuid IS DISTINCT FROM r.building_id THEN RAISE EXCEPTION 'building identity mismatch'; END IF;
 END LOOP;
 FOR r IN SELECT a.*,a.details->>'field_name' field_name,(a.details->>'building_id')::uuid building_id,(a.details->>'evidence_group_id')::uuid evidence_id FROM public.audit_logs a WHERE a.action_type='AI_FIELD_FILL' AND a.details->>'batch_ref'='ai_building_field_backfill_20261125_v6_100' ORDER BY a.id LOOP
  EXECUTE format('UPDATE public.%I SET %I=NULL WHERE id=$1 AND to_jsonb(%I)=$2',r.target_table,r.field_name,r.field_name) USING r.target_id::uuid,r.new_values->r.field_name;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'rollback field guard failed'; END IF;
  UPDATE public.building_data_field_provenance SET is_current=false WHERE evidence_group_id=r.evidence_id AND building_id=r.building_id AND target_table=r.target_table AND field_name=r.field_name AND is_current;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>(CASE WHEN r.details->>'source_kind'='external_cross_verified' THEN jsonb_array_length(r.details->'source_urls') ELSE 1 END) THEN RAISE EXCEPTION 'rollback provenance guard failed'; END IF;
  ev:=gen_random_uuid(); now_ts:=clock_timestamp();
  INSERT INTO public.audit_logs(id,user_id,action_type,details,request_source,module,target_table,target_id,target_name,old_values,new_values,event_id,occurred_at,actor_kind,actor_name)
  VALUES(nextval('public.audit_logs_id_seq'),'codex','AI_FIELD_ROLLBACK',jsonb_build_object('rollback_batch_ref','ai_building_field_backfill_20261125_v6_100_rollback','original_batch_ref','ai_building_field_backfill_20261125_v6_100','original_audit_id',r.id,'building_id',r.building_id,'field_name',r.field_name,'evidence_group_id',r.evidence_id,'ai_assisted',true),'codex_mcp','building_brochure_data',r.target_table,r.target_id,r.target_name,r.new_values,r.old_values,'ai_field_rollback:'||ev,now_ts,'tool','Codex（工具执行）');
  EXECUTE format('SELECT to_jsonb(%I) FROM public.%I WHERE id=$1',r.field_name,r.target_table) INTO current_value USING r.target_id::uuid;
  IF current_value IS NOT NULL THEN RAISE EXCEPTION 'rollback null readback failed'; END IF;
  n:=n+1;
 END LOOP;
 IF n<>100 OR (SELECT count(*) FROM public.audit_logs WHERE action_type='AI_FIELD_ROLLBACK' AND details->>'rollback_batch_ref'='ai_building_field_backfill_20261125_v6_100_rollback')<>100 OR EXISTS(SELECT 1 FROM public.building_data_field_provenance WHERE is_current AND evidence_note LIKE 'batch_ref=ai_building_field_backfill_20261125_v6_100;%') THEN RAISE EXCEPTION 'rollback count mismatch'; END IF;
END $rollback$;
WITH a AS (SELECT a.*,a.details->>'field_name' field_name FROM public.audit_logs a WHERE action_type='AI_FIELD_FILL' AND details->>'batch_ref'='ai_building_field_backfill_20261125_v6_100')
SELECT count(*) original_audits,count(*) FILTER(WHERE CASE WHEN a.target_table='buildings' THEN to_jsonb(b)->a.field_name ELSE to_jsonb(d)->a.field_name END='null'::jsonb) null_restored_in_transaction,
 (SELECT count(*) FROM public.audit_logs WHERE action_type='AI_FIELD_ROLLBACK' AND details->>'rollback_batch_ref'='ai_building_field_backfill_20261125_v6_100_rollback') rollback_audits_in_transaction,
 (SELECT count(*) FROM public.building_data_field_provenance WHERE is_current AND evidence_note LIKE 'batch_ref=ai_building_field_backfill_20261125_v6_100;%') current_sources_in_transaction
FROM a LEFT JOIN public.buildings b ON a.target_table='buildings' AND b.id=a.target_id::uuid LEFT JOIN public.building_brochure_data d ON a.target_table='building_brochure_data' AND d.id=a.target_id::uuid;
ROLLBACK;