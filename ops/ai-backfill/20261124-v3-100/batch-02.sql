-- Colliers Beijing production: guarded catalog synchronization, 25 fields per transaction.
-- Execute four numbered transactions separately. Replace final COMMIT with ROLLBACK for preflight.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
SET LOCAL application_name='colliers_ai_backfill_20261124_v3';
DO $fill$
DECLARE r record; n int:=0; old_count int; changed int; ev uuid; now_ts timestamptz; sub_batch int:=2;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('ai_building_field_backfill_20261124_v3_100'));
 SELECT count(*) INTO old_count FROM public.audit_logs WHERE action_type='AI_FIELD_FILL' AND details->>'batch_ref'='ai_building_field_backfill_20261124_v3_100';
 IF old_count<>25*(sub_batch-1) OR old_count>=100 THEN RAISE EXCEPTION 'batch sequence guard: %',old_count; END IF;
 FOR r IN
 SELECT b.id building_id,b.name,b.submarket,d.id target_id
 FROM public.buildings b JOIN public.building_brochure_data d ON d.building_id=b.id
 WHERE b.is_active AND b.city IN ('北京','北京市') AND b.project_type='stock' AND b.tracking_scope='tracked' AND b.merged_into_id IS NULL
 AND b.submarket IN ('CBD','上地','东城商务区','中关村','亚奥','亦庄','北清路','望京-酒仙桥','燕莎','通惠河传媒走廊','金融街')
 AND d.submarket IS NULL
 AND (SELECT count(*) FROM public.building_brochure_data x WHERE x.building_id=b.id)=1
 AND NOT EXISTS (SELECT 1 FROM public.building_data_field_provenance p WHERE p.building_id=b.id AND p.target_table='building_brochure_data' AND p.field_name='submarket')
 AND NOT EXISTS (SELECT 1 FROM public.audit_logs a WHERE a.action_type='AI_FIELD_FILL' AND a.target_table='building_brochure_data' AND a.target_id=d.id::text AND (a.details->>'field_name'='submarket' OR a.new_values ? 'submarket'))
 ORDER BY b.id,d.id LIMIT 25 FOR UPDATE OF b,d SKIP LOCKED
 LOOP
  ev:=gen_random_uuid(); now_ts:=clock_timestamp();
  UPDATE public.building_brochure_data SET submarket=r.submarket WHERE id=r.target_id AND building_id=r.building_id AND submarket IS NULL;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'null-protection failed'; END IF;
  INSERT INTO public.building_data_field_provenance(building_id,brochure_data_id,target_table,field_name,field_value,source_type,source_tier,source_name,source_retrieved_at,value_recorded_at,verification_status,evidence_group_id,evidence_note,is_current)
  VALUES(r.building_id,r.target_id,'building_brochure_data','submarket',to_jsonb(r.submarket),'other','legacy_unknown','高力国际楼宇主表既有子市场分类',now_ts,now_ts,'legacy_backfill',ev,'batch_ref=ai_building_field_backfill_20261124_v3_100; source_table=buildings; source_record_id='||r.building_id||'; source_field=submarket; unit=category; same canonical building_id; existing catalog classification, not new external geospatial confirmation; AI-assisted',true);
  INSERT INTO public.audit_logs(id,user_id,action_type,details,request_source,module,target_table,target_id,target_name,old_values,new_values,event_id,occurred_at,actor_kind,actor_name)
  VALUES(nextval('public.audit_logs_id_seq'),'codex','AI_FIELD_FILL',jsonb_build_object('batch_ref','ai_building_field_backfill_20261124_v3_100','sub_batch',sub_batch,'building_id',r.building_id,'field_name','submarket','source_table','buildings','source_record_id',r.building_id,'source_field','submarket','source_kind','internal_catalog_sync','unit','category','verification_status','legacy_backfill','evidence_group_id',ev,'ai_assisted',true,'reversible',true),'codex_mcp','building_brochure_data','building_brochure_data',r.target_id::text,r.name,jsonb_build_object('submarket',NULL),jsonb_build_object('submarket',r.submarket),'ai_field_fill:'||ev::text,now_ts,'tool','ChatGPT AI');
  IF NOT EXISTS (SELECT 1 FROM public.building_brochure_data d JOIN public.building_data_field_provenance p ON p.brochure_data_id=d.id AND p.evidence_group_id=ev JOIN public.audit_logs a ON a.event_id='ai_field_fill:'||ev::text WHERE d.id=r.target_id AND d.submarket=r.submarket AND p.is_current AND p.field_value=to_jsonb(d.submarket) AND a.new_values->'submarket'=p.field_value AND a.old_values->'submarket'='null'::jsonb) THEN RAISE EXCEPTION 'in-transaction readback failed'; END IF;
  n:=n+1;
 END LOOP;
 IF n<>25 THEN RAISE EXCEPTION 'expected 25 qualifying fields; got %',n; END IF;
END $fill$;
SELECT count(*) AS cumulative, count(distinct (target_id,details->>'field_name')) AS unique_fields FROM public.audit_logs WHERE action_type='AI_FIELD_FILL' AND details->>'batch_ref'='ai_building_field_backfill_20261124_v3_100';
COMMIT;