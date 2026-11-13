-- COLLIERS Beijing Intelligence Platform / AI empty-field backfill v3
-- Batch ai_building_field_backfill_20261113_v3, production: qhgxougfzzmgqjzzwudf
-- Scope: 50 archived engineering facts + 30 curated main-table LEED sync + 9 confirmed 2026Q3 PM + 4 confirmed parenthetical PM aliases + 7 brochure-to-main LEED = exactly 100.
-- This script is intentionally guarded and non-idempotent: it ABORTS if source identity/count or ANY target nullability changes.
-- Source text/individual Broker submission contents are NOT embedded: formal survey records are queried by UUID inside production.
-- Recorded LEED levels and historic brochures are tagged legacy_backfill; NOT claimed independently web cross-verified.
-- To DRY RUN, run this exact script with only the final COMMIT; replaced by ROLLBACK;.
-- The two historic approximate area quantities and whole-park estimate explicitly retain approximate scope in field provenance.
-- No schema, RLS, function, trigger, frontend, permission, or deployment change.

BEGIN;
SET LOCAL lock_timeout='8000ms';
SET LOCAL statement_timeout='90000ms';
SET LOCAL application_name='colliers_ai_field_backfill_v3';
LOCK TABLE public.buildings, public.building_brochure_data, public.building_data_field_provenance, public.audit_logs IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE _ai_bfv3 (
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

-- 50 individually reviewed archival facts, exact building/material joins, no raw Broker survey data.
WITH specs AS (
  SELECT * FROM jsonb_to_recordset($colliers_specs$[{"name":"嘉铭奥森产业园","material_id":"688d491f-7bc1-5588-8f7d-7eddf3fe3b0a","fact_index":0,"target_table":"building_brochure_data","field":"gfa_total","value":31340,"scope":"park_total_separate_office_retail","qualifier":"historical_archived_material"},{"name":"嘉铭奥森产业园","material_id":"688d491f-7bc1-5588-8f7d-7eddf3fe3b0a","fact_index":0,"target_table":"building_brochure_data","field":"gfa_office","value":18731,"scope":"park_total_separate_office_retail","qualifier":"historical_archived_material"},{"name":"嘉铭奥森产业园","material_id":"688d491f-7bc1-5588-8f7d-7eddf3fe3b0a","fact_index":0,"target_table":"building_brochure_data","field":"gfa_retail","value":2328,"scope":"park_total_separate_office_retail","qualifier":"historical_archived_material"},{"name":"嘉铭奥森产业园","material_id":"688d491f-7bc1-5588-8f7d-7eddf3fe3b0a","fact_index":4,"target_table":"building_brochure_data","field":"elevator_passenger","value":6,"scope":"two_towers_sum_3plus3_1plus1","qualifier":"historical_archived_material"},{"name":"嘉铭奥森产业园","material_id":"688d491f-7bc1-5588-8f7d-7eddf3fe3b0a","fact_index":4,"target_table":"building_brochure_data","field":"elevator_freight","value":2,"scope":"two_towers_sum_3plus3_1plus1","qualifier":"historical_archived_material"},{"name":"嘉铭奥森产业园","material_id":"688d491f-7bc1-5588-8f7d-7eddf3fe3b0a","fact_index":5,"target_table":"building_brochure_data","field":"hvac_system","value":"两管制风机盘管+新风系统","scope":"park_office_equipment","qualifier":"historical_archived_material"},{"name":"嘉铭奥森产业园","material_id":"688d491f-7bc1-5588-8f7d-7eddf3fe3b0a","fact_index":5,"target_table":"building_brochure_data","field":"hvac_fresh_air_capacity","value":40,"scope":"park_office_equipment","qualifier":"historical_archived_material"},{"name":"国航世纪大厦","material_id":"f74138a0-3e6c-5cbf-8a8e-a9d1762c085b","fact_index":0,"target_table":"building_brochure_data","field":"parking_total","value":720,"scope":"project_total_parking_standard_floor","qualifier":"historical_archived_material"},{"name":"国航世纪大厦","material_id":"f74138a0-3e6c-5cbf-8a8e-a9d1762c085b","fact_index":0,"target_table":"building_brochure_data","field":"standard_floor_area","value":3552,"scope":"project_total_parking_standard_floor","qualifier":"historical_archived_material"},{"name":"国航世纪大厦","material_id":"f74138a0-3e6c-5cbf-8a8e-a9d1762c085b","fact_index":0,"target_table":"building_brochure_data","field":"floor_height","value":4.05,"scope":"project_total_parking_standard_floor","qualifier":"historical_archived_material"},{"name":"国航世纪大厦","material_id":"f74138a0-3e6c-5cbf-8a8e-a9d1762c085b","fact_index":0,"target_table":"building_brochure_data","field":"clear_height","value":2.7,"scope":"project_total_parking_standard_floor","qualifier":"historical_archived_material"},{"name":"国航世纪大厦","material_id":"f74138a0-3e6c-5cbf-8a8e-a9d1762c085b","fact_index":1,"target_table":"building_brochure_data","field":"elevator_passenger","value":22,"scope":"main_and_podium_passenger_only","qualifier":"historical_archived_material"},{"name":"北京佳隆国际大厦","material_id":"fa047a85-54ce-5236-8c3e-584ef50ba56d","fact_index":0,"target_table":"building_brochure_data","field":"gfa_total","value":54732,"scope":"single_building_total_vs_above_below","qualifier":"historical_archived_material"},{"name":"北京佳隆国际大厦","material_id":"fa047a85-54ce-5236-8c3e-584ef50ba56d","fact_index":0,"target_table":"building_brochure_data","field":"floors_above","value":22,"scope":"single_building_total_vs_above_below","qualifier":"historical_archived_material"},{"name":"北京佳隆国际大厦","material_id":"fa047a85-54ce-5236-8c3e-584ef50ba56d","fact_index":0,"target_table":"building_brochure_data","field":"floors_below","value":3,"scope":"single_building_total_vs_above_below","qualifier":"historical_archived_material"},{"name":"北京佳隆国际大厦","material_id":"fa047a85-54ce-5236-8c3e-584ef50ba56d","fact_index":0,"target_table":"building_brochure_data","field":"floor_height","value":3.4,"scope":"single_building_total_vs_above_below","qualifier":"historical_archived_material"},{"name":"北京佳隆国际大厦","material_id":"fa047a85-54ce-5236-8c3e-584ef50ba56d","fact_index":0,"target_table":"building_brochure_data","field":"parking_total","value":278,"scope":"single_building_total_vs_above_below","qualifier":"historical_archived_material"},{"name":"北京佳隆国际大厦","material_id":"fa047a85-54ce-5236-8c3e-584ef50ba56d","fact_index":0,"target_table":"building_brochure_data","field":"parking_above","value":22,"scope":"single_building_total_vs_above_below","qualifier":"historical_archived_material"},{"name":"北京佳隆国际大厦","material_id":"fa047a85-54ce-5236-8c3e-584ef50ba56d","fact_index":0,"target_table":"building_brochure_data","field":"parking_underground","value":256,"scope":"single_building_total_vs_above_below","qualifier":"historical_archived_material"},{"name":"天润财富中心","material_id":"b4a43fe6-4268-50c1-86e9-222538e4932d","fact_index":0,"target_table":"building_brochure_data","field":"gfa_total","value":75150,"scope":"complex_excludes_courtyard_tenants","qualifier":"historical_archived_material"},{"name":"天润财富中心","material_id":"b4a43fe6-4268-50c1-86e9-222538e4932d","fact_index":0,"target_table":"building_brochure_data","field":"floors_below","value":4,"scope":"complex_excludes_courtyard_tenants","qualifier":"historical_archived_material"},{"name":"天润财富中心","material_id":"b4a43fe6-4268-50c1-86e9-222538e4932d","fact_index":0,"target_table":"building_brochure_data","field":"elevator_passenger","value":8,"scope":"complex_excludes_courtyard_tenants","qualifier":"historical_archived_material"},{"name":"天润财富中心","material_id":"b4a43fe6-4268-50c1-86e9-222538e4932d","fact_index":0,"target_table":"building_brochure_data","field":"elevator_freight","value":2,"scope":"complex_excludes_courtyard_tenants","qualifier":"historical_archived_material"},{"name":"天润财富中心","material_id":"b4a43fe6-4268-50c1-86e9-222538e4932d","fact_index":0,"target_table":"building_brochure_data","field":"hvac_fresh_air_capacity","value":35,"scope":"complex_excludes_courtyard_tenants","qualifier":"historical_archived_material"},{"name":"丰融国际大厦","material_id":"70396ae2-fb24-4e7f-a275-a70a672c0e8c","fact_index":0,"target_table":"building_brochure_data","field":"building_height","value":65,"scope":"physical_attributes_no_conflicting_area","qualifier":"historical_archived_material"},{"name":"丰融国际大厦","material_id":"70396ae2-fb24-4e7f-a275-a70a672c0e8c","fact_index":0,"target_table":"building_brochure_data","field":"parking_total","value":510,"scope":"physical_attributes_no_conflicting_area","qualifier":"historical_archived_material"},{"name":"丰融国际大厦","material_id":"70396ae2-fb24-4e7f-a275-a70a672c0e8c","fact_index":2,"target_table":"building_brochure_data","field":"floor_height","value":4.2,"scope":"standard_floor_not_elevator_conflict","qualifier":"historical_archived_material"},{"name":"复星国际中心","material_id":"6a820a78-e9f7-5183-8824-762b260ec4ac","fact_index":0,"target_table":"building_brochure_data","field":"gfa_total","value":73833.41,"scope":"whole_complex_does_not_modify_office_gfa","qualifier":"historical_archived_material"},{"name":"复星国际中心","material_id":"6a820a78-e9f7-5183-8824-762b260ec4ac","fact_index":0,"target_table":"building_brochure_data","field":"floors_above","value":27,"scope":"whole_complex_does_not_modify_office_gfa","qualifier":"historical_archived_material"},{"name":"复星国际中心","material_id":"6a820a78-e9f7-5183-8824-762b260ec4ac","fact_index":0,"target_table":"building_brochure_data","field":"floors_below","value":4,"scope":"whole_complex_does_not_modify_office_gfa","qualifier":"historical_archived_material"},{"name":"复星国际中心","material_id":"6a820a78-e9f7-5183-8824-762b260ec4ac","fact_index":0,"target_table":"building_brochure_data","field":"floor_height","value":3.5,"scope":"whole_complex_does_not_modify_office_gfa","qualifier":"historical_archived_material"},{"name":"复星国际中心","material_id":"6a820a78-e9f7-5183-8824-762b260ec4ac","fact_index":0,"target_table":"building_brochure_data","field":"parking_total","value":539,"scope":"whole_complex_does_not_modify_office_gfa","qualifier":"historical_archived_material"},{"name":"泰康金融大厦","material_id":"0d61ce03-5484-55b8-83ec-f9c125754e37","fact_index":0,"target_table":"building_brochure_data","field":"building_height","value":150,"scope":"historic_tower_not_marketing_floors","qualifier":"historical_archived_material"},{"name":"泰康金融大厦","material_id":"0d61ce03-5484-55b8-83ec-f9c125754e37","fact_index":0,"target_table":"building_brochure_data","field":"floors_below","value":3,"scope":"historic_tower_not_marketing_floors","qualifier":"historical_archived_material"},{"name":"泰康金融大厦","material_id":"0d61ce03-5484-55b8-83ec-f9c125754e37","fact_index":0,"target_table":"building_brochure_data","field":"parking_underground","value":415,"scope":"historic_tower_not_marketing_floors","qualifier":"historical_archived_material"},{"name":"现代汽车大厦","material_id":"b0dfc703-4378-5925-8b34-e754367f951e","fact_index":1,"target_table":"building_brochure_data","field":"gfa_total","value":68000,"scope":"specific_building_xiaoyun_road_38","qualifier":"historical_archived_material"},{"name":"现代汽车大厦","material_id":"b0dfc703-4378-5925-8b34-e754367f951e","fact_index":1,"target_table":"building_brochure_data","field":"standard_floor_area","value":2500,"scope":"specific_building_xiaoyun_road_38","qualifier":"historical_archived_material"},{"name":"现代汽车大厦","material_id":"b0dfc703-4378-5925-8b34-e754367f951e","fact_index":1,"target_table":"building_brochure_data","field":"clear_height","value":2.7,"scope":"specific_building_xiaoyun_road_38","qualifier":"historical_archived_material"},{"name":"金融街国际大厦","material_id":"e43b9afd-f154-5e67-814a-84bdfd7e8eec","fact_index":2,"target_table":"building_brochure_data","field":"gfa_office","value":38600,"scope":"office_building_area_not_total_or_leasable","qualifier":"historical_archived_material"},{"name":"中国电子大厦","material_id":"d2bee273-4c54-59d0-8a67-bcc71781f574","fact_index":0,"target_table":"building_brochure_data","field":"floors_above","value":17,"scope":"physical_floors_not_elevator_number","qualifier":"historical_archived_material"},{"name":"保利国际广场1座","material_id":"3019e5a2-55d8-50c7-8684-8fd9f791800f","fact_index":1,"target_table":"building_brochure_data","field":"floor_height","value":4.2,"scope":"tower_T1_standard_floor","qualifier":"historical_archived_material"},{"name":"恒通国际商务园","material_id":"e13b9ffc-b1ae-4064-a51e-2716f239c605","fact_index":0,"target_table":"building_brochure_data","field":"gfa_total","value":310000,"scope":"approx_historical_whole_park","qualifier":"historical_archived_material"},{"name":"泰康人寿大厦","material_id":"d8b9bcf8-18f0-5584-868e-27441b42af02","fact_index":0,"target_table":"buildings","field":"leasable_area","value":19000,"scope":"approx_historical_total_leasable_not_gfa","qualifier":"historical_archived_material"},{"name":"泰康金融大厦","material_id":"0d61ce03-5484-55b8-83ec-f9c125754e37","fact_index":0,"target_table":"building_brochure_data","field":"gfa_total","value":73000,"scope":"approx_historical_total_gfa","qualifier":"historical_archived_material"},{"name":"泰康金融大厦","material_id":"0d61ce03-5484-55b8-83ec-f9c125754e37","fact_index":1,"target_table":"building_brochure_data","field":"floor_height","value":4.1,"scope":"standard_floor_excludes_special_5_1m","qualifier":"historical_archived_material"},{"name":"玖安广场","material_id":"0d7cef09-4317-51cf-8151-ff0ef1e2b1f8","fact_index":0,"target_table":"building_brochure_data","field":"floors_above","value":13,"scope":"historic_floor_1_through_13","qualifier":"historical_archived_material"},{"name":"现代汽车大厦","material_id":"b0dfc703-4378-5925-8b34-e754367f951e","fact_index":1,"target_table":"building_brochure_data","field":"building_floors","value":25,"scope":"reported_total_storeys","qualifier":"historical_archived_material"},{"name":"聚杰金融大厦","material_id":"d48886f5-6728-5188-8232-b647949f5da6","fact_index":0,"target_table":"building_brochure_data","field":"gfa_total","value":76165,"scope":"project_total_distinct_from_existing_office_gfa","qualifier":"historical_archived_material"},{"name":"聚杰金融大厦","material_id":"d48886f5-6728-5188-8232-b647949f5da6","fact_index":1,"target_table":"building_brochure_data","field":"hvac_cooling_water_24h","value":true,"scope":"machine_room_cooling_water_capability","qualifier":"historical_archived_material"},{"name":"金地 启汇中心","material_id":"41fd3b08-46c3-577d-8ed9-2f46b4bbd7cb","fact_index":1,"target_table":"building_brochure_data","field":"gfa_total","value":194400,"scope":"whole_A_to_F_project_including_self_held_not_AB_subset","qualifier":"historical_archived_material"}]$colliers_specs$::jsonb)
  AS x(name text, material_id uuid, fact_index int, target_table text, field text, value jsonb, scope text, qualifier text)
)
INSERT INTO _ai_bfv3
SELECT b.id,
  CASE WHEN s.target_table='building_brochure_data' THEN d.id ELSE NULL END,
  s.target_table, CASE WHEN s.target_table='buildings' THEN b.id ELSE d.id END,
  s.field,s.value,'archived_internal_material','brochure','secondary','legacy_backfill',
  '高力国际已归档项目推介资料',NULL,m.original_name,m.document_date,
  'building_sales_materials',m.id,s.fact_index,
  (m.project_facts->s.fact_index)->>'source_ref',NULL,s.scope,
  CASE WHEN s.field IN('gfa_total','gfa_office','gfa_retail','standard_floor_area','leasable_area') THEN 'sqm'
       WHEN s.field IN('clear_height','floor_height','building_height') THEN 'm'
       WHEN s.field='hvac_fresh_air_capacity' THEN 'm3_per_person_hour'
       WHEN s.field IN('floors_above','floors_below','building_floors','parking_total','parking_above','parking_underground','elevator_passenger','elevator_freight') THEN 'count'
       ELSE 'text_or_boolean' END,
  CASE WHEN s.scope LIKE '%approx%' THEN 'historical_approximate_internal_review'
       ELSE 'historical_archived_internal_review' END,
  'source_index='||s.fact_index::text||'; record_identifier='||m.id::text||
  '; source_claim='||left(coalesce((m.project_facts->s.fact_index)->>'value',''),380)||
  '; qualifier='||s.qualifier
FROM specs s
JOIN public.buildings b ON b.name=s.name AND b.is_active=true AND b.project_type='stock'
  AND b.tracking_scope='tracked' AND b.merged_into_id IS NULL
JOIN public.building_brochure_data d ON d.building_id=b.id
JOIN public.building_sales_materials m ON m.id=s.material_id AND m.building_id=b.id
 AND m.status='ready' AND m.association_status='confirmed'
 AND nullif(btrim((m.project_facts->s.fact_index)->>'value'),'') IS NOT NULL
 AND nullif(btrim((m.project_facts->s.fact_index)->>'source_ref'),'') IS NOT NULL;

-- Main-table curated LEED enum -> the independent brochure-data column used by Intelligence recommendations.
INSERT INTO _ai_bfv3
SELECT b.id,d.id,'building_brochure_data',d.id,'leed_certification',
 to_jsonb(b.leed_certification),'internal_curated_main_sync','other','legacy_unknown','legacy_backfill',
 '高力国际楼宇主表：LEED历史等级',NULL,NULL,NULL,
 'buildings',b.id,NULL,'buildings.leed_certification',NULL,'same_physical_building_certification','LEED_level_text',
 'legacy_main_field_unverified','LEED等级直接沿用既有主表值；未新作独立证书核验'
FROM public.buildings b JOIN public.building_brochure_data d ON d.building_id=b.id
WHERE b.is_active AND b.merged_into_id IS NULL AND b.tracking_scope='tracked' AND b.project_type='stock'
 AND d.leed_certification IS NULL AND b.leed_certification IN('Gold','Platinum','Silver');

-- Reuse latest confirmed 2026Q3 formal Broker data ONLY when exactly equal to curated main PM.
WITH q3 AS (
 SELECT DISTINCT ON(q.building_id) q.building_id,q.id,trim(q.property_management) pm
 FROM public.quarterly_submissions q
 WHERE q.record_year=2026 AND q.record_quarter=3 AND nullif(trim(q.property_management),'') IS NOT NULL
 ORDER BY q.building_id,q.updated_at DESC,q.id DESC
)
INSERT INTO _ai_bfv3
SELECT b.id,d.id,'building_brochure_data',d.id,'property_management',
 to_jsonb(q.pm),'broker_2026Q3_exact_match','other','authoritative_secondary','legacy_backfill',
 '高力国际2026Q3正式季度填报（匹配已收录楼宇主表）',NULL,NULL,NULL,
 'quarterly_submissions',q.id,NULL,'quarterly_submissions.property_management','2026Q3',
 'same_project_pm','company_name','internal_formal_survey_matches_main',
 'same building; main.pm and Q3.pm equal after trim; source record ID retained, no private Broker record exported'
FROM public.buildings b JOIN public.building_brochure_data d ON d.building_id=b.id
JOIN q3 q ON q.building_id=b.id
WHERE b.is_active AND b.merged_into_id IS NULL AND b.tracking_scope='tracked' AND b.project_type='stock'
 AND d.property_management IS NULL AND trim(b.property_management)=q.pm;

-- Four Q3 records corroborate main PM with a pure parenthetical entity descriptor.
WITH q3 AS (
 SELECT DISTINCT ON(q.building_id) q.building_id,q.id,trim(q.property_management) pm
 FROM public.quarterly_submissions q
 WHERE q.record_year=2026 AND q.record_quarter=3 AND nullif(trim(q.property_management),'') IS NOT NULL
 ORDER BY q.building_id,q.updated_at DESC,q.id DESC
)
INSERT INTO _ai_bfv3
SELECT b.id,d.id,'building_brochure_data',d.id,'property_management',
 to_jsonb(q.pm),'broker_2026Q3_normalized_legal_entity','other','authoritative_secondary','legacy_backfill',
 '高力国际2026Q3正式季度填报（主表附注与企业名称分离）',NULL,NULL,NULL,
 'quarterly_submissions',q.id,NULL,'quarterly_submissions.property_management','2026Q3',
 'same_project_pm_without_parenthetical_affiliation','company_name','internal_formal_survey_and_main_base_name',
 'Q3 exact company name equals main name after removing parenthetical affiliate/ownership descriptor, not a change in legal identity'
FROM public.buildings b JOIN public.building_brochure_data d ON d.building_id=b.id
JOIN q3 q ON q.building_id=b.id
WHERE b.name IN ('东旭国际','北京国家广告产业园','恒通-之所ICC','恒通国际商务园')
 AND b.is_active AND b.merged_into_id IS NULL AND b.tracking_scope='tracked' AND b.project_type='stock'
 AND d.property_management IS NULL AND b.property_management IS NOT NULL
 AND left(trim(b.property_management),char_length(q.pm))=q.pm
 AND substring(trim(b.property_management) FROM char_length(q.pm)+1 FOR 1)='（';

-- Only explicit LEED-branded historical brochure entries to main, with referenced old provenance.
WITH src AS (
 SELECT b.id bid,d.id did,b.name,d.leed_certification,
  (SELECT p.id::text FROM public.building_data_field_provenance p
   WHERE p.building_id=b.id AND p.brochure_data_id=d.id AND p.field_name='leed_certification'
     AND p.is_current ORDER BY p.created_at DESC LIMIT 1) provenance_id
 FROM public.buildings b JOIN public.building_brochure_data d ON d.building_id=b.id
 WHERE b.is_active AND b.merged_into_id IS NULL AND b.tracking_scope='tracked' AND b.project_type='stock'
 AND b.leed_certification IS NULL AND d.leed_certification ILIKE '%LEED%'
)
INSERT INTO _ai_bfv3
SELECT s.bid,NULL,'buildings',s.bid,'leed_certification',
 to_jsonb(s.leed_certification),'existing_brochure_LEED_to_main','other','legacy_unknown','legacy_backfill',
 '高力国际已收录楼书LEED字段',NULL,NULL,NULL,
 'building_brochure_data',s.did,NULL,'building_brochure_data.leed_certification',NULL,
 'same_physical_building_historical_LEED_text','LEED_text','historical_brochure_explicit_LEED',
 'existing_provenance_id='||coalesce(s.provenance_id,'none')||
 '; inherited from previously recorded brochure, no newly claimed cross-verification'
FROM src s;

DO $ai_apply$
DECLARE
 r record; prev jsonb; actual jsonb; stored_type text;
 evidence uuid; n int; already int;
BEGIN
 SELECT count(*) INTO n FROM _ai_bfv3;
 IF n<>100 THEN RAISE EXCEPTION 'v3 candidate cardinality %, expected 100; no write allowed',n; END IF;
 SELECT count(*) INTO already FROM public.audit_logs
 WHERE details->>'batch_ref'='ai_building_field_backfill_20261113_v3';
 IF already<>0 THEN RAISE EXCEPTION 'v3 batch already exists with % audits; no retry',already; END IF;
 IF EXISTS (
  SELECT 1 FROM _ai_bfv3 GROUP BY target_table,target_id,field_name HAVING count(*)>1
 ) THEN RAISE EXCEPTION 'duplicate target table/id/field; no write'; END IF;
 IF EXISTS (SELECT 1 FROM _ai_bfv3 WHERE new_value='null'::jsonb OR jsonb_typeof(new_value) IS NULL)
 THEN RAISE EXCEPTION 'null proposed value'; END IF;
 IF EXISTS (SELECT 1 FROM _ai_bfv3 WHERE target_table NOT IN ('buildings','building_brochure_data'))
 THEN RAISE EXCEPTION 'unauthorized table target'; END IF;
 IF (SELECT count(DISTINCT building_id) FROM _ai_bfv3)=0 THEN RAISE EXCEPTION 'empty buildings'; END IF;
 IF EXISTS (
  SELECT 1 FROM _ai_bfv3 c JOIN public.buildings b ON b.id=c.building_id
  WHERE b.is_active IS DISTINCT FROM true OR b.merged_into_id IS NOT NULL OR b.tracking_scope<>'tracked' OR b.project_type<>'stock'
 ) THEN RAISE EXCEPTION 'inactive/non-stock building in workset'; END IF;
 FOR r IN SELECT * FROM _ai_bfv3 ORDER BY target_table,target_id,field_name LOOP
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
  IF prev IS DISTINCT FROM 'null'::jsonb
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
    'AI_ASSISTED_INTERNAL_BACKFILL; batch=ai_building_field_backfill_20261113_v3; source_kind='||r.source_kind||
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
      'batch_ref','ai_building_field_backfill_20261113_v3',
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
    'ai_building_field_backfill_20261113_v3:'||r.target_table||':'||r.target_id||':'||r.field_name,
    'tool'
  );
 END LOOP;
 IF (SELECT count(*) FROM public.audit_logs WHERE details->>'batch_ref'='ai_building_field_backfill_20261113_v3')<>100
 THEN RAISE EXCEPTION 'audit count mismatch'; END IF;
 IF (SELECT count(*) FROM public.building_data_field_provenance WHERE evidence_note LIKE '%batch=ai_building_field_backfill_20261113_v3;%')<>100
 THEN RAISE EXCEPTION 'provenance count mismatch'; END IF;
 RAISE NOTICE 'AI_V3 transaction stage fully applied: 100 guarded empty-field updates + 100 provenance + 100 audits; COMMIT or ROLLBACK follows';
END;
$ai_apply$;

-- The pre-COMMIT result is diagnostic. Commit is the only durability boundary.
SELECT source_kind,count(*) AS field_count,count(DISTINCT building_id) AS buildings
FROM _ai_bfv3 GROUP BY source_kind ORDER BY source_kind;
COMMIT;
