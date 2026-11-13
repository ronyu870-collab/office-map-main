-- COLLIERS Beijing Intelligence Platform / AI EMPTY field fill v4 (2026-11-13)
-- Batch: ai_building_field_backfill_20261113_v4_geo_governed
-- Target: Supabase production qhgxougfzzmgqjzzwudf
-- Distinct NULL-field values only: 10 archived physical + 42 existing business-field sync + 48 canonical geo catalog = 100.
-- No external web-verified values asserted; all provenance legacy_backfill.
-- District/submarket independently maintained in brochure admin catalog. No brochure.grade copy (RLS sensitive).
-- All source record IDs resolved INSIDE production. No Broker private content in this public SQL.
-- To dry-run replace final COMMIT with ROLLBACK. Existing batch check aborts second application.
-- No DDL, RLS changes, app code, frontend deployment, or main branch mutation.

BEGIN;
SET LOCAL lock_timeout='8000ms';
SET LOCAL statement_timeout='90000ms';
SET LOCAL application_name='colliers_ai_field_backfill_v4';
LOCK TABLE public.buildings, public.building_brochure_data, public.building_data_field_provenance, public.audit_logs IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE _ai_bfv4 (
  building_id uuid NOT NULL,
  brochure_data_id uuid,
  target_table text NOT NULL,
  target_id uuid NOT NULL,
  field_name text NOT NULL,
  new_value jsonb NOT NULL,
  source_kind text NOT NULL,
  source_type text NOT NULL,
  source_tier text NOT NULL,
  verification_status text NOT NULL,
  source_name text NOT NULL,
  source_url text,
  source_file_name text,
  source_published_date date,
  source_table text NOT NULL,
  source_record_id uuid NOT NULL,
  source_fact_index int,
  source_ref text,
  source_period text,
  field_scope text NOT NULL,
  field_unit text NOT NULL,
  confidence text NOT NULL,
  evidence_comment text
) ON COMMIT DROP;


-- Ten individually reviewed archival physical facts; no non-NULL overwrite, no source content of private Broker submissions.
WITH specs AS (
 SELECT * FROM jsonb_to_recordset($specv4$[{"name":"信达中心","material_prefix":"ce95352a","fact_index":0,"target_table":"building_brochure_data","field":"building_floors","value":34,"expect":"34实际层数","scope":"physical_floor_number_not_marketing_elevator_number","unit":"floors"},{"name":"北京来福士中心","material_prefix":"9a0e01b6","fact_index":1,"target_table":"building_brochure_data","field":"floors_above","value":21,"expect":"实际21层","scope":"office_tower_actual_above_ground_floor_number","unit":"floors"},{"name":"国际财源中心（IFC）","material_prefix":"0f6fcb25","fact_index":0,"target_table":"building_brochure_data","field":"gfa_total","value":170000,"expect":"约17万㎡","scope":"historical_approximate_whole_project_gfa_not_leasable","unit":"sqm"},{"name":"恒通-之所ICC","material_prefix":"843ee5ab","fact_index":5,"target_table":"building_brochure_data","field":"column_spacing","value":12,"expect":"柱距12米","scope":"overall_ICC_park_office_column_spacing","unit":"m"},{"name":"王府77项目","material_prefix":"660bdb1f","fact_index":6,"target_table":"building_brochure_data","field":"elevator_passenger","value":12,"expect":"客梯12部","scope":"three_tower_shared_office_complex_total_not_each_tower","unit":"count"},{"name":"玖安广场","material_prefix":"3e5567e3","fact_index":2,"target_table":"building_brochure_data","field":"elevator_passenger","value":12,"expect":"12客","scope":"whole_project_passenger_lifts_excluding_fire_transfer_escalators","unit":"count"},{"name":"玖安广场","material_prefix":"3e5567e3","fact_index":2,"target_table":"building_brochure_data","field":"elevator_freight","value":1,"expect":"1货","scope":"whole_project_dedicated_freight_lifts_not_fire","unit":"count"},{"name":"玖安广场","material_prefix":"3e5567e3","fact_index":2,"target_table":"building_brochure_data","field":"elevator_vip","value":1,"expect":"1VIP","scope":"whole_project_VIP_lifts","unit":"count"},{"name":"玖安广场","material_prefix":"3e5567e3","fact_index":1,"target_table":"building_brochure_data","field":"raised_floor_cm","value":15,"expect":"网络地板15厘米","scope":"whole_project_office_standard_floor_network_floor","unit":"cm"},{"name":"玖安广场","material_prefix":"3e5567e3","fact_index":1,"target_table":"building_brochure_data","field":"hvac_fresh_air_capacity","value":40,"expect":"新风40m³/人/小时","scope":"historical_whole_project_new_air_capacity","unit":"m3_per_person_hour"}]$specv4$::jsonb)
  AS x(name text,material_prefix text,fact_index int,target_table text,field text,value jsonb,expect text,scope text,unit text)
)
INSERT INTO _ai_bfv4
SELECT b.id,
 CASE WHEN s.target_table='building_brochure_data' THEN d.id ELSE NULL END,
 s.target_table,CASE WHEN s.target_table='buildings' THEN b.id ELSE d.id END,
 s.field,s.value,'archived_confirmed_historical_material','brochure','secondary','legacy_backfill',
 '高力国际已归档项目推介/讲盘资料',NULL,m.original_name,m.document_date,
 'building_sales_materials',m.id,s.fact_index,
 (m.project_facts->s.fact_index)->>'source_ref',NULL,s.scope,s.unit,
 'historical_archived_source_not_independently_web_verified',
 'document_fact_assertion='||s.expect||'; source_claim='||
 left(coalesce((m.project_facts->s.fact_index)->>'value',''),420)
FROM specs s JOIN public.buildings b ON b.name=s.name AND b.is_active
 AND b.merged_into_id IS NULL AND b.project_type='stock' AND b.tracking_scope='tracked'
JOIN public.building_brochure_data d ON d.building_id=b.id
JOIN public.building_sales_materials m ON left(m.id::text,8)=s.material_prefix AND m.building_id=b.id
 AND m.association_status='confirmed' AND m.status='ready'
 AND nullif(trim(m.project_facts->s.fact_index->>'source_ref'),'') IS NOT NULL
 AND position(s.expect IN coalesce(m.project_facts->s.fact_index->>'value',''))>0;

DO $$ BEGIN IF (SELECT count(*) FROM _ai_bfv4 WHERE source_kind='archived_confirmed_historical_material')<>10
THEN RAISE EXCEPTION 'archived evidence count mismatch, abort'; END IF; END $$;

-- Historical brochure completion DATE -> main YEAR text. Only exact year component;
-- source date itself is not interpreted as publication date, and no synthetic January date is produced.
INSERT INTO _ai_bfv4
SELECT b.id,NULL,'buildings',b.id,'completion_year',
 to_jsonb(extract(year from d.completion_date)::int::text),
 'historical_brochure_date_to_main_year','other','legacy_unknown','legacy_backfill',
 '高力国际既有楼书竣工日期',NULL,NULL,NULL,
 'building_brochure_data',d.id,NULL,'building_brochure_data.completion_date',NULL,
 'same_completed_stock_building_year_only','calendar_year','legacy_brochure_no_new_construction_document',
 'original_full_completion_date='||d.completion_date::text||'; year part only, not a claim of new official validation'
FROM public.buildings b JOIN public.building_brochure_data d ON d.building_id=b.id
WHERE b.is_active AND b.merged_into_id IS NULL AND b.tracking_scope='tracked'
 AND b.project_type='stock' AND b.completion_year IS NULL AND d.completion_date IS NOT NULL
 AND b.name IN('中国人寿大厦','京城大厦','华丽大厦','合生财富广场','平安大厦','腾达大厦');

-- Existing brochure certification label, exactly as historically recorded. Exclude all pre-certification,
-- in-progress and planned labels; do NOT claim external certification search or independent verification.
INSERT INTO _ai_bfv4
SELECT b.id,NULL,'buildings',b.id,'leed_certification',
 to_jsonb(d.leed_certification),
 'historical_brochure_gold_level_to_main','other','legacy_unknown','legacy_backfill',
 '高力国际既有楼书绿色认证历史等级',NULL,NULL,NULL,
 'building_brochure_data',d.id,NULL,'building_brochure_data.leed_certification',NULL,
 'same_stock_project_historical_certification_label','recorded_LEED_level_text',
 'legacy_brochure_certification_status_requires_official_confirmation',
 'exact inherited label 金级; excludes pending/pre-cert; not new USGBC cross-verification'
FROM public.buildings b JOIN public.building_brochure_data d ON d.building_id=b.id
WHERE b.is_active AND b.merged_into_id IS NULL AND b.tracking_scope='tracked'
 AND b.project_type='stock' AND b.leed_certification IS NULL AND trim(d.leed_certification)='金级';

-- Existing brochure provider name -> independently consumed main property-management field.
INSERT INTO _ai_bfv4
SELECT b.id,NULL,'buildings',b.id,'property_management',
 to_jsonb(d.property_management),
 'historical_brochure_pm_to_main','other','legacy_unknown','legacy_backfill',
 '高力国际既有楼书物业管理主体',NULL,NULL,NULL,
 'building_brochure_data',d.id,NULL,'building_brochure_data.property_management',NULL,
 'same_building_property_management_not_developer_or_owner','company_name',
 'legacy_brochure_pm_not_formally_reconfirmed_in_2026',
 'copy exact historic provider string; no owner/developer inference'
FROM public.buildings b JOIN public.building_brochure_data d ON d.building_id=b.id
WHERE b.is_active AND b.merged_into_id IS NULL AND b.tracking_scope='tracked'
 AND b.project_type='stock' AND b.property_management IS NULL
 AND nullif(trim(d.property_management),'') IS NOT NULL;

-- Independently read by Intelligence recommendations & brochure comparison:
-- copy curated main property-manager only where the field is blank in the brochure.
-- Four ambiguous ownership/management affiliations excluded.
INSERT INTO _ai_bfv4
SELECT b.id,d.id,'building_brochure_data',d.id,'property_management',
 to_jsonb(b.property_management),
 'curated_master_pm_to_brochure','other','legacy_unknown','legacy_backfill',
 '高力国际楼宇主表既有物业管理字段',NULL,NULL,NULL,
 'buildings',b.id,NULL,'buildings.property_management',NULL,
 'same_building_property_management_not_ownership','company_name',
 'curated_main_no_new_independent_confirmation',
 'original recorded main PM; exact copy for recommendation/compare; business identity checked'
FROM public.buildings b JOIN public.building_brochure_data d ON d.building_id=b.id
WHERE b.is_active AND b.merged_into_id IS NULL AND b.tracking_scope='tracked'
 AND b.project_type='stock' AND d.property_management IS NULL
 AND nullif(trim(b.property_management),'') IS NOT NULL
 AND b.name NOT IN('星地中心','泰康集团大厦','钰珵大厦','西单堂子胡同9号项目');

-- Operationally used columns of the independent historical brochure catalog:
-- district is not a newly inferred address; it is the canonical existing main-table administrative district.
INSERT INTO _ai_bfv4
SELECT b.id,d.id,'building_brochure_data',d.id,'district',
 to_jsonb(b.district),
 'canonical_master_district_to_brochure','other','legacy_unknown','legacy_backfill',
 '高力国际楼宇主表已核对行政区（楼书管理与导出）',NULL,NULL,NULL,
 'buildings',b.id,NULL,'buildings.district',NULL,
 'existing_canonical_geographical_classification_same_building','administrative_district',
 'internal_master_same_building_no_external_address_validation',
 'independent brochure table district is used in DatabaseManager; no geocoding or invented address'
FROM public.buildings b JOIN public.building_brochure_data d ON d.building_id=b.id
WHERE b.is_active AND b.merged_into_id IS NULL AND b.tracking_scope='tracked'
 AND b.project_type='stock' AND d.district IS NULL AND nullif(trim(b.district),'') IS NOT NULL;

-- Fill the independent brochure submarket catalog ONLY for the 23 highest-priority,
-- verified-same-ID stock entries; avoid vague "其他". The brochure editor exposes
-- this classification independently of the main building map.
INSERT INTO _ai_bfv4
SELECT b.id,d.id,'building_brochure_data',d.id,'submarket',
 to_jsonb(b.submarket),
 'canonical_master_submarket_to_brochure','other','legacy_unknown','legacy_backfill',
 '高力国际楼宇主表既有子市场分类（楼书管理与导出）',NULL,NULL,NULL,
 'buildings',b.id,NULL,'buildings.submarket',NULL,
 'existing_canonical_submarket_same_building','market_category_text',
 'internal_master_same_building_not_independent_location_search',
 'exact same-building submarket; no new official geographical verification'
FROM public.buildings b JOIN public.building_brochure_data d ON d.building_id=b.id
WHERE b.is_active AND b.merged_into_id IS NULL AND b.tracking_scope='tracked'
 AND b.project_type='stock' AND d.submarket IS NULL
 AND nullif(trim(b.submarket),'') IS NOT NULL AND b.submarket <> '其他'
ORDER BY CASE WHEN d.district IS NULL AND b.district IS NOT NULL THEN 0 ELSE 1 END,
 CASE WHEN trim(b.grade) IN('A','P') THEN 0 ELSE 1 END, b.name,b.id
LIMIT 23;

DO $$ BEGIN IF (SELECT count(*) FROM _ai_bfv4)<>100
THEN RAISE EXCEPTION 'v4 staged candidate count mismatch %, expected 100',
 (SELECT count(*) FROM _ai_bfv4); END IF; END $$;

DO $ai_apply$
DECLARE
 r record; prev jsonb; actual jsonb; stored_type text;
 evidence uuid; n int; already int;
BEGIN
 SELECT count(*) INTO n FROM _ai_bfv4;
 IF n<>100 THEN RAISE EXCEPTION 'v4 candidate cardinality %, expected 100; no write allowed',n; END IF;
 SELECT count(*) INTO already FROM public.audit_logs
 WHERE details->>'batch_ref'='ai_building_field_backfill_20261113_v4_geo_governed';
 IF already<>0 THEN RAISE EXCEPTION 'v4 batch already exists with % audits; no retry',already; END IF;
 IF EXISTS (
  SELECT 1 FROM _ai_bfv4 GROUP BY target_table,target_id,field_name HAVING count(*)>1
 ) THEN RAISE EXCEPTION 'duplicate target table/id/field; no write'; END IF;
 IF EXISTS (SELECT 1 FROM _ai_bfv4 WHERE new_value='null'::jsonb OR jsonb_typeof(new_value) IS NULL)
 THEN RAISE EXCEPTION 'null proposed value'; END IF;
 IF EXISTS (SELECT 1 FROM _ai_bfv4 WHERE target_table NOT IN ('buildings','building_brochure_data'))
 THEN RAISE EXCEPTION 'unauthorized table target'; END IF;
 IF (SELECT count(DISTINCT building_id) FROM _ai_bfv4)=0 THEN RAISE EXCEPTION 'empty buildings'; END IF;
 IF EXISTS (
  SELECT 1 FROM _ai_bfv4 c JOIN public.buildings b ON b.id=c.building_id
  WHERE b.is_active IS DISTINCT FROM true OR b.merged_into_id IS NOT NULL OR b.tracking_scope<>'tracked' OR b.project_type<>'stock'
 ) THEN RAISE EXCEPTION 'inactive/non-stock building in workset'; END IF;
 FOR r IN SELECT * FROM _ai_bfv4 ORDER BY target_table,target_id,field_name LOOP
  SELECT c.udt_name INTO stored_type FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name=r.target_table AND c.column_name=r.field_name
    AND c.is_nullable='YES';
  IF stored_type NOT IN ('text','varchar','numeric','float8','int4','bool') OR stored_type IS NULL
  THEN RAISE EXCEPTION 'unsafe/missing target column %.% (%), abort',r.target_table,r.field_name,coalesce(stored_type,'missing'); END IF;
  IF EXISTS (SELECT 1 FROM public.building_data_field_provenance p WHERE p.building_id=r.building_id
    AND p.target_table=r.target_table AND p.field_name=r.field_name AND p.is_current)
  THEN RAISE EXCEPTION 'existing current provenance for a supposedly blank target %.% %',r.target_table,r.field_name,r.target_id; END IF;
  EXECUTE format('SELECT to_jsonb(%I) FROM public.%I WHERE id=$1',r.field_name,r.target_table)
    INTO prev USING r.target_id;
  IF prev IS NOT NULL AND prev IS DISTINCT FROM 'null'::jsonb
  THEN RAISE EXCEPTION 'nonempty/unknown old value for %.% id %: %',r.target_table,r.field_name,r.target_id,prev; END IF;
  EXECUTE format('UPDATE public.%I SET %I = (($1::jsonb #>> ''{}'')::%s) WHERE id=$2 AND %I IS NULL RETURNING to_jsonb(%I)',
   r.target_table,r.field_name,stored_type,r.field_name,r.field_name)
   INTO actual USING r.new_value,r.target_id;
  IF NOT FOUND OR actual IS DISTINCT FROM r.new_value
  THEN RAISE EXCEPTION 'concurrent/nonmatching write for %.% id % expected % actual %',r.target_table,r.field_name,r.target_id,r.new_value,actual; END IF;
  evidence:=gen_random_uuid();
  INSERT INTO public.building_data_field_provenance (
    building_id,brochure_data_id,target_table,field_name,field_value,
    source_type,source_tier,source_name,source_url,source_file_name,source_published_date,
    source_retrieved_at,value_recorded_at,verification_status,evidence_group_id,evidence_note,is_current
  ) VALUES (
    r.building_id,r.brochure_data_id,r.target_table,r.field_name,actual,
    r.source_type,r.source_tier,r.source_name,r.source_url,r.source_file_name,r.source_published_date,
    now(),now(),r.verification_status,evidence,
    'AI_ASSISTED_INTERNAL_BACKFILL; batch=ai_building_field_backfill_20261113_v4_geo_governed; source_kind='||r.source_kind||
    '; original_table='||r.source_table||'; original_record_id='||r.source_record_id::
    text||'; source_fact_index='||coalesce(r.source_fact_index::text,'null')||
    '; source_ref='||coalesce(r.source_ref,'n/a')||
    '; source_period='||coalesce(r.source_period,'undated')||
    '; unit='||r.field_unit||'; scope='||r.field_scope||
    '; confidence='||r.confidence||'; verification='||r.verification_status||
    '; source_note='||coalesce(r.evidence_comment,''),
    true
  );
  INSERT INTO public.audit_logs (
    id,user_id,action_type,details,request_source,module,target_table,target_id,target_name,
    old_values,new_values,event_id,actor_kind
  ) VALUES (
    nextval('public.audit_logs_id_seq'),'codex','AI_FIELD_FILL',
    jsonb_build_object(
      'batch_ref','ai_building_field_backfill_20261113_v4_geo_governed',
      'field_name',r.field_name,'building_id',r.building_id,
      'source_kind',r.source_kind,'source_table',r.source_table,'source_record_id',r.source_record_id,
      'source_fact_index',r.source_fact_index,'source_ref',r.source_ref,'source_period',r.source_period,
      'source_file_name',r.source_file_name,'source_published_date',r.source_published_date,
      'unit',r.field_unit,'scope',r.field_scope,'confidence',r.confidence,
      'verification_status',r.verification_status,'evidence_group_id',evidence,
      'ai_assisted',true,'ai_generated',false,'reversible',true,'old_is_null',true
    ),'codex_mcp','building_data_backfill',
    r.target_table,r.target_id::text,(SELECT b.name FROM public.buildings b WHERE b.id=r.building_id),
    jsonb_build_object(r.field_name,NULL),jsonb_build_object(r.field_name,actual),
    'ai_building_field_backfill_20261113_v4_geo_governed:'||r.target_table||':'||r.target_id||':'||r.field_name,
    'tool'
  );
 END LOOP;
 IF (SELECT count(*) FROM public.audit_logs WHERE details->>'batch_ref'='ai_building_field_backfill_20261113_v4_geo_governed')<>100
 THEN RAISE EXCEPTION 'audit count mismatch'; END IF;
 IF (SELECT count(*) FROM public.building_data_field_provenance WHERE evidence_note LIKE '%batch=ai_building_field_backfill_20261113_v4_geo_governed;%')<>100
 THEN RAISE EXCEPTION 'provenance count mismatch'; END IF;
 RAISE NOTICE 'AI_V3 transaction stage fully applied: 100 guarded empty-field updates + 100 provenance + 100 audits; COMMIT or ROLLBACK follows';
END;
$ai_apply$;

-- The pre-COMMIT result is diagnostic. Commit is the only durability boundary.
SELECT source_kind,count(*) AS field_count,count(DISTINCT building_id) AS buildings
FROM _ai_bfv4 GROUP BY source_kind ORDER BY source_kind;
COMMIT;
