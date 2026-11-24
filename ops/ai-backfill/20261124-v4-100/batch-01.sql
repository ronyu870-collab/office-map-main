-- Batch 01: internal brochure data, explicit derived values, no persistent DDL.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL application_name='colliers_ai_backfill_20261124_v4';
DO $fill$
DECLARE r record; n int:=0; old_count int; changed int; ev uuid; now_ts timestamptz; read_value jsonb; source_row jsonb; sub_batch int:=1; expected_before int:=0; expected_added int:=24;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('ai_building_field_backfill_20261124_v4_100'));
 SELECT count(*) INTO old_count FROM public.audit_logs WHERE action_type='AI_FIELD_FILL' AND details->>'batch_ref'='ai_building_field_backfill_20261124_v4_100';
 IF old_count<>expected_before OR old_count+expected_added>100 THEN RAISE EXCEPTION 'batch sequence guard: %',old_count; END IF;
 -- Serialize the brief data transaction against other writes, not normal reads.
 LOCK TABLE public.buildings,public.building_brochure_data,public.building_data_field_provenance IN SHARE ROW EXCLUSIVE MODE;
 FOR r IN
 WITH x AS (
 SELECT b.id bid,b.name,d.* FROM public.buildings b JOIN public.building_brochure_data d ON d.building_id=b.id
 WHERE b.is_active AND b.city IN ('北京','北京市') AND b.project_type='stock' AND b.tracking_scope='tracked' AND b.merged_into_id IS NULL
 AND (SELECT count(*) FROM public.building_brochure_data d2 WHERE d2.building_id=b.id)=1
), c AS (
 SELECT bid,name,id target_id,'parking_above' field_name,to_jsonb(parking_total-parking_underground) new_value,'integer' value_type,'building_brochure_data' source_table,id source_id,'parking_total,parking_underground' source_field,'internal_calculation' source_kind,'count' unit,'legacy brochure total minus underground; equal values yield recorded ground count zero; historical calculation, not new survey' note
 FROM x WHERE parking_above IS NULL AND parking_total>0 AND parking_total=parking_underground AND name=name_cn AND name NOT IN ('泰康集团大厦','玖安广场','世纪财富中心西塔','欧美汇大厦','保利大都汇（4#）','丽金中心（AB座）')
 AND (SELECT count(*) FROM public.building_data_field_provenance p WHERE p.brochure_data_id=x.id AND p.is_current AND p.field_name IN ('parking_total','parking_underground') AND p.source_name='楼书（历史入库）' AND p.field_value=to_jsonb(x)->p.field_name)=2
 UNION ALL
 SELECT bid,name,id,'power_source',to_jsonb(CASE WHEN power_system LIKE '市政双路供电，%' THEN split_part(power_system,'，',1) ELSE power_system END),'text','building_brochure_data',id,'power_system','internal_field_extraction','configuration_text','explicit power supply origin or independent supply configuration extracted from same brochure; not an inference from generic dual circuit'
 FROM x WHERE power_source IS NULL AND name=name_cn AND power_system ~ '(市政|市电|变电站|独立.{0,4}10[kK][vV]电源)'
 UNION ALL
 SELECT x.bid,x.name,x.id,'submarket',to_jsonb(b.submarket),'text','buildings',b.id,'submarket','internal_catalog_sync','category','same canonical building ID; existing explicit catalog classification, not independent external confirmation'
 FROM x JOIN public.buildings b ON b.id=x.bid WHERE x.submarket IS NULL AND b.submarket IN ('中关村','望京-酒仙桥','燕莎')
) SELECT c.* FROM c
 WHERE NOT EXISTS (SELECT 1 FROM public.building_data_field_provenance p WHERE p.building_id=c.bid AND p.target_table='building_brochure_data' AND p.field_name=c.field_name)
 AND NOT EXISTS (SELECT 1 FROM public.audit_logs a WHERE a.action_type='AI_FIELD_FILL' AND a.target_table='building_brochure_data' AND a.target_id=c.target_id::text AND (a.details->>'field_name'=c.field_name OR a.new_values ? c.field_name))
 ORDER BY target_id,field_name
 LOOP
  IF r.new_value IS NULL OR r.new_value='null'::jsonb OR r.value_type NOT IN ('text','integer','numeric','boolean','date') THEN RAISE EXCEPTION 'invalid candidate'; END IF;
  ev:=gen_random_uuid(); now_ts:=clock_timestamp();
  EXECUTE format('UPDATE public.building_brochure_data SET %I=($2#>>''{}'')::%s WHERE id=$1 AND building_id=$3 AND %I IS NULL',r.field_name,r.value_type,r.field_name) USING r.target_id,r.new_value,r.bid;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'null protection failed'; END IF;
  INSERT INTO public.building_data_field_provenance(building_id,brochure_data_id,target_table,field_name,field_value,source_type,source_tier,source_name,source_retrieved_at,value_recorded_at,verification_status,evidence_group_id,evidence_note,is_current)
  VALUES(r.bid,r.target_id,'building_brochure_data',r.field_name,r.new_value,'other','legacy_unknown','高力国际内部已有业务记录',now_ts,now_ts,'legacy_backfill',ev,'batch_ref=ai_building_field_backfill_20261124_v4_100; source_table='||r.source_table||'; source_record_id='||r.source_id||'; source_field='||r.source_field||'; unit='||r.unit||'; '||r.note||'; AI-assisted',true);
  INSERT INTO public.audit_logs(id,user_id,action_type,details,request_source,module,target_table,target_id,target_name,old_values,new_values,event_id,occurred_at,actor_kind,actor_name)
  VALUES(nextval('public.audit_logs_id_seq'),'codex','AI_FIELD_FILL',jsonb_build_object('batch_ref','ai_building_field_backfill_20261124_v4_100','sub_batch',sub_batch,'building_id',r.bid,'field_name',r.field_name,'source_table',r.source_table,'source_record_id',r.source_id,'source_field',r.source_field,'source_kind',r.source_kind,'unit',r.unit,'verification_status','legacy_backfill','evidence_group_id',ev,'ai_assisted',true,'reversible',true),'codex_mcp','building_brochure_data','building_brochure_data',r.target_id::text,r.name,jsonb_build_object(r.field_name,NULL),jsonb_build_object(r.field_name,r.new_value),'ai_field_fill:'||ev::text,now_ts,'tool','Codex（工具执行）');
  EXECUTE format('SELECT to_jsonb(%I) FROM public.building_brochure_data WHERE id=$1',r.field_name) INTO read_value USING r.target_id;
  IF read_value IS DISTINCT FROM r.new_value OR NOT EXISTS(SELECT 1 FROM public.building_data_field_provenance p JOIN public.audit_logs a ON a.event_id='ai_field_fill:'||ev::text WHERE p.evidence_group_id=ev AND p.is_current AND p.field_value=read_value AND a.new_values->r.field_name=p.field_value AND a.old_values->r.field_name='null'::jsonb) THEN RAISE EXCEPTION 'readback failed'; END IF;
  n:=n+1;
 END LOOP;
 IF n<>expected_added THEN RAISE EXCEPTION 'expected % qualifying fields, got %',expected_added,n; END IF;
END $fill$;
SELECT count(*) cumulative,count(distinct (target_table,target_id,details->>'field_name')) unique_fields FROM public.audit_logs WHERE action_type='AI_FIELD_FILL' AND details->>'batch_ref'='ai_building_field_backfill_20261124_v4_100';
COMMIT;