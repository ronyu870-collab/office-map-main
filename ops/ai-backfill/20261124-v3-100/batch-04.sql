-- Colliers Beijing production: guarded catalog synchronization, final transaction: 3 archived/quarterly facts plus 22 catalog fields.
-- Execute four numbered transactions separately. Replace final COMMIT with ROLLBACK for preflight.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
SET LOCAL application_name='colliers_ai_backfill_20261124_v3';
DO $fill$
DECLARE r record; n int:=0; old_count int; changed int; ev uuid; now_ts timestamptz; sub_batch int:=4; s record; read_value jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('ai_building_field_backfill_20261124_v3_100'));
 SELECT count(*) INTO old_count FROM public.audit_logs WHERE action_type='AI_FIELD_FILL' AND details->>'batch_ref'='ai_building_field_backfill_20261124_v3_100';
 IF old_count<>25*(sub_batch-1) OR old_count>=100 THEN RAISE EXCEPTION 'batch sequence guard: %',old_count; END IF;
 -- Three additional independently useful fields from confirmed historical project facts and formal quarterly submissions.
 -- Source facts are resolved from production record IDs; no internal raw data or broker identities in this script.
 PERFORM 1 FROM public.buildings b WHERE b.id IN ('51a3bb4f-bae5-4156-a9e3-2293586c10ab'::uuid,(SELECT building_id FROM public.building_brochure_data WHERE id='eef10def-2156-4dc3-a69e-4e1b44f0772b')) FOR UPDATE;
 PERFORM 1 FROM public.building_brochure_data WHERE id='eef10def-2156-4dc3-a69e-4e1b44f0772b' FOR UPDATE;
 PERFORM 1 FROM public.building_sales_materials WHERE id='843ee5ab-919e-417f-a518-41684e4631a2' FOR SHARE;
 PERFORM 1 FROM public.quarterly_submissions WHERE building_id='51a3bb4f-bae5-4156-a9e3-2293586c10ab' FOR SHARE;
 FOR s IN
 WITH archived AS (
 SELECT b.id building_id,b.name,d.id target_id,m.id source_record_id,m.project_facts facts
 FROM public.buildings b JOIN public.building_brochure_data d ON d.building_id=b.id
 JOIN public.building_sales_materials m ON m.building_id=b.id
 WHERE d.id='eef10def-2156-4dc3-a69e-4e1b44f0772b' AND m.id='843ee5ab-919e-417f-a518-41684e4631a2'
 AND m.association_status='confirmed' AND m.status='ready' AND b.is_active AND b.city IN ('北京','北京市') AND b.project_type='stock' AND b.tracking_scope='tracked' AND b.merged_into_id IS NULL
 AND (SELECT count(*) FROM public.building_brochure_data x WHERE x.building_id=b.id)=1
 ), candidates AS (
 SELECT a.building_id,a.name,a.target_id,'building_brochure_data'::text target_table,v.field_name,v.new_value,'integer'::text value_type,'building_sales_materials'::text source_table,a.source_record_id,'project_facts['||v.fact_index||']' source_field,'brochure'::text source_type,'secondary'::text source_tier,'internal_archived_material'::text source_kind,v.unit,v.note
 FROM archived a CROSS JOIN LATERAL (VALUES
 ('floors_below',to_jsonb((regexp_match(a.facts->2->>'value','地下([0-9]+)层.*地下\1层'))[1]::int),2,'floor','same basement-level count for north, south and middle towers; historical scope, no independent new survey'),
 ('parking_underground',to_jsonb((regexp_match(a.facts->5->>'value','地下约([0-9]+)车位'))[1]::int),5,'count','historical approximate project-wide underground parking count, not exact current verified inventory')
 ) v(field_name,new_value,fact_index,unit,note)
 WHERE v.new_value IS NOT NULL AND nullif(a.facts->v.fact_index->>'source_ref','') IS NOT NULL
 UNION ALL
 SELECT b.id,b.name,b.id,'buildings','owner',to_jsonb(trim(q.owner)),'text','quarterly_submissions',q.id,'owner','other','legacy_unknown','internal_formal_quarter','company_name','2026Q3 formal submission, consistent with recorded 2026Q2 nonblank owner; not new legal title verification'
 FROM public.buildings b JOIN public.quarterly_submissions q ON q.building_id=b.id
 WHERE b.id='51a3bb4f-bae5-4156-a9e3-2293586c10ab' AND q.id='5188109c-7520-4baf-88ec-19f677b06fc0' AND q.record_year=2026 AND q.record_quarter=3 AND nullif(trim(q.owner),'') IS NOT NULL AND b.owner IS NULL
 AND b.is_active AND b.city IN ('北京','北京市') AND b.project_type='stock' AND b.tracking_scope='tracked' AND b.merged_into_id IS NULL
 AND (SELECT count(distinct trim(q2.owner)) FROM public.quarterly_submissions q2 WHERE q2.building_id=b.id AND nullif(trim(q2.owner),'') IS NOT NULL)=1
 AND EXISTS(SELECT 1 FROM public.quarterly_submissions q2 WHERE q2.building_id=b.id AND q2.record_year=2026 AND q2.record_quarter=2 AND trim(q2.owner)=trim(q.owner))
 )
 SELECT c.* FROM candidates c
 WHERE NOT EXISTS(SELECT 1 FROM public.building_data_field_provenance p WHERE p.building_id=c.building_id AND p.target_table=c.target_table AND p.field_name=c.field_name)
 AND NOT EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.action_type='AI_FIELD_FILL' AND a.target_table=c.target_table AND a.target_id=c.target_id::text AND (a.details->>'field_name'=c.field_name OR a.new_values ? c.field_name))
 ORDER BY target_table,target_id,field_name
 LOOP
  ev:=gen_random_uuid(); now_ts:=clock_timestamp();
  EXECUTE format('UPDATE public.%I SET %I=($2#>>''{}'')::%s WHERE id=$1 AND %I IS NULL',s.target_table,s.field_name,s.value_type,s.field_name) USING s.target_id,s.new_value;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'special null protection failed'; END IF;
  INSERT INTO public.building_data_field_provenance(building_id,brochure_data_id,target_table,field_name,field_value,source_type,source_tier,source_name,source_retrieved_at,value_recorded_at,verification_status,evidence_group_id,evidence_note,is_current)
  VALUES(s.building_id,case when s.target_table='building_brochure_data' then s.target_id else null end,s.target_table,s.field_name,s.new_value,s.source_type,s.source_tier,'高力国际内部资料记录',now_ts,now_ts,'legacy_backfill',ev,'batch_ref=ai_building_field_backfill_20261124_v3_100; source_table='||s.source_table||'; source_record_id='||s.source_record_id||'; source_field='||s.source_field||'; unit='||s.unit||'; '||s.note||'; AI-assisted',true);
  INSERT INTO public.audit_logs(id,user_id,action_type,details,request_source,module,target_table,target_id,target_name,old_values,new_values,event_id,occurred_at,actor_kind,actor_name)
  VALUES(nextval('public.audit_logs_id_seq'),'codex','AI_FIELD_FILL',jsonb_build_object('batch_ref','ai_building_field_backfill_20261124_v3_100','sub_batch',sub_batch,'building_id',s.building_id,'field_name',s.field_name,'source_table',s.source_table,'source_record_id',s.source_record_id,'source_field',s.source_field,'source_kind',s.source_kind,'unit',s.unit,'verification_status','legacy_backfill','evidence_group_id',ev,'ai_assisted',true,'reversible',true),'codex_mcp','building_brochure_data',s.target_table,s.target_id::text,s.name,jsonb_build_object(s.field_name,NULL),jsonb_build_object(s.field_name,s.new_value),'ai_field_fill:'||ev::text,now_ts,'tool','ChatGPT AI');
  EXECUTE format('SELECT to_jsonb(%I) FROM public.%I WHERE id=$1',s.field_name,s.target_table) INTO read_value USING s.target_id;
  IF read_value IS DISTINCT FROM s.new_value OR NOT EXISTS(SELECT 1 FROM public.building_data_field_provenance p JOIN public.audit_logs a ON a.event_id='ai_field_fill:'||ev::text WHERE p.evidence_group_id=ev AND p.is_current AND p.field_value=read_value AND a.new_values->s.field_name=p.field_value AND a.old_values->s.field_name='null'::jsonb) THEN RAISE EXCEPTION 'special readback failed'; END IF;
  n:=n+1;
 END LOOP;
 IF n<>3 THEN RAISE EXCEPTION 'expected three reviewed non-catalog candidates, got %',n; END IF;
 FOR r IN
 SELECT b.id building_id,b.name,b.submarket,d.id target_id
 FROM public.buildings b JOIN public.building_brochure_data d ON d.building_id=b.id
 WHERE b.is_active AND b.city IN ('北京','北京市') AND b.project_type='stock' AND b.tracking_scope='tracked' AND b.merged_into_id IS NULL
 AND b.submarket IN ('CBD','上地','东城商务区','中关村','亚奥','亦庄','北清路','望京-酒仙桥','燕莎','通惠河传媒走廊','金融街')
 AND d.submarket IS NULL
 AND (SELECT count(*) FROM public.building_brochure_data x WHERE x.building_id=b.id)=1
 AND NOT EXISTS (SELECT 1 FROM public.building_data_field_provenance p WHERE p.building_id=b.id AND p.target_table='building_brochure_data' AND p.field_name='submarket')
 AND NOT EXISTS (SELECT 1 FROM public.audit_logs a WHERE a.action_type='AI_FIELD_FILL' AND a.target_table='building_brochure_data' AND a.target_id=d.id::text AND (a.details->>'field_name'='submarket' OR a.new_values ? 'submarket'))
 ORDER BY b.id,d.id LIMIT (25-n) FOR UPDATE OF b,d SKIP LOCKED
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