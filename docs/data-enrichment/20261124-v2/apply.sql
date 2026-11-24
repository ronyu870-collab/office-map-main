-- Colliers Beijing: AI-assisted technical field backfill, 2026-11-24 v2.
-- Execute with final COMMIT only after identical ROLLBACK preview passes.
-- No DDL, permission, app changes. Internal values are resolved in DB.
BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='45s';
LOCK TABLE public.buildings, public.building_brochure_data, public.building_data_field_provenance, public.audit_logs IN SHARE ROW EXCLUSIVE MODE;
DO $batch$
DECLARE
  batch constant text := 'ai_technical_fields_20261124_v2';
  r record; d record; x record; y record;
  newval jsonb; actual jsonb; after_ts timestamptz; grp uuid;
  n int:=0; np int:=0; changed int; evidence_count int; v_status text; v_tier text; v_note text;
BEGIN
  IF EXISTS(SELECT 1 FROM public.audit_logs WHERE details->>'batch_id'=batch) THEN
    RAISE EXCEPTION 'Batch already exists';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    -- Internally sourced arithmetic. Each component has a separate current, exact field provenance row.
    ('cee94273-5dd8-4652-a6d4-37d799fca3c6'::uuid,'d062e344-2f52-4c4b-b38e-d155cc4d3e6e'::uuid,'building_floors','floors_above','floors_below','209c5372-d36c-40d7-9db7-fed5f426f36b'::uuid,'9d62531e-92c0-43f7-9ba6-e8c6b849482c'::uuid,'层','国家会议中心主建筑：明确地上与地下层数相加，不含其他建筑。'),
    ('fd725dbc-703d-4fec-90b5-86a08b180d17','877e2902-1023-4fb8-bd74-651a46c53e27','building_floors','floors_above','floors_below','d6bb1184-55f6-4dac-bbdd-db7372442beb','833095a9-f358-4a4a-ad00-90a5b4c90ba1','层','国航世纪大厦主楼：地上与地下实体层数合计。'),
    ('8891b56f-35c0-4be6-ad9a-283bb9f0cb88','318735b6-d1fa-4918-ae4d-4fb265e23327','building_floors','floors_above','floors_below','72e24608-3208-426d-b22e-27977830d55b','e49ea047-75f5-4899-9830-4e7c8d98c5b0','层','历史楼书和已归档项目讲盘明确地上与地下层数；实体楼层合计。'),
    ('7e75f5cf-1c78-48b3-9aca-94bc1a380708','c04f0564-2ddc-4c50-acf5-b9b61ff8bf45','building_floors','floors_above','floors_below','d480e112-9566-4e94-aa44-50463d383885','bf551559-c1d9-4f50-a188-244a82592bbd','层','同一业主历史讲盘项目，两项实体层数合计，未新增竣工或入市判断。'),
    ('6fefd753-d7f2-4cd2-9e07-fa9bf0ca5d41','52061f7d-e204-4a30-b66d-3bf4654d9746','building_floors','floors_above','floors_below','7219f2d4-87d6-4c1e-9472-5ceca3a620f2','efd01eeb-944b-46f6-9f1b-2a9d4c0dd0c8','层','同一业主历史讲盘对应项目，地上与地下实体层数合计。'),
    ('34a40f94-31c1-4e18-b8a4-560387e9ee04','52f17894-8210-4fb3-b35f-f3150f36363e','parking_total','parking_above','parking_underground','b1cb61a2-fce4-43ce-a39a-9274a619ea52','50929f12-677f-427a-8530-f592af30ef35','个','同一历史楼书记录地上与地下车位之和；未独立核验当前运营数量。'),
    ('4f23eb0e-67e3-4012-a177-83484a9fcf1f','15866448-48fe-4adf-9108-9a6b6156b917','building_floors','floors_above','floors_below','4683d271-14ab-4495-af1f-5eadf4ef1180','9c8f6dcb-08c1-4803-92cf-f5a0ed48ce5a','层','同一历史楼书明确地上和地下实体楼层合计；历史入库来源，未宣称重新外部核验。')
  ) AS t(did,bid,field,f1,f2,p1,p2,unit,note)
  LOOP
    SELECT bd.*,b.name AS building_name INTO STRICT d FROM public.building_brochure_data bd JOIN public.buildings b ON b.id=bd.building_id WHERE bd.id=r.did AND b.id=r.bid AND b.is_active AND b.tracking_scope='tracked' AND b.merged_into_id IS NULL AND b.project_type='stock' AND b.is_entered_market;
    IF to_jsonb(d)->r.field IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Target no longer empty: % %',r.did,r.field; END IF;
    IF EXISTS(SELECT 1 FROM public.building_data_field_provenance WHERE brochure_data_id=r.did AND field_name=r.field AND is_current) THEN RAISE EXCEPTION 'Existing current target provenance: % %',r.did,r.field; END IF;
    SELECT * INTO STRICT x FROM public.building_data_field_provenance WHERE id=r.p1 AND building_id=r.bid AND brochure_data_id=r.did AND target_table='building_brochure_data' AND field_name=r.f1 AND is_current;
    SELECT * INTO STRICT y FROM public.building_data_field_provenance WHERE id=r.p2 AND building_id=r.bid AND brochure_data_id=r.did AND target_table='building_brochure_data' AND field_name=r.f2 AND is_current;
    IF x.field_value IS DISTINCT FROM to_jsonb(d)->r.f1 OR y.field_value IS DISTINCT FROM to_jsonb(d)->r.f2 OR jsonb_typeof(x.field_value)<>'number' OR jsonb_typeof(y.field_value)<>'number' OR (x.field_value::text)::numeric<=0 OR (y.field_value::text)::numeric<=0 THEN RAISE EXCEPTION 'Input changed or invalid: %',r.did; END IF;
    newval:=to_jsonb((x.field_value::text)::int+(y.field_value::text)::int);
    grp:=gen_random_uuid();
    EXECUTE format('UPDATE public.building_brochure_data SET %1$I=(jsonb_populate_record(NULL::public.building_brochure_data,$1)).%1$I WHERE id=$2 AND %1$I IS NULL RETURNING to_jsonb(%1$I),updated_at',r.field) INTO actual,after_ts USING jsonb_build_object(r.field,newval),r.did;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>1 OR actual IS DISTINCT FROM newval THEN RAISE EXCEPTION 'Write mismatch: % %',r.did,r.field; END IF;
    v_note:=r.note||' 计算口径：'||r.f1||'+'||r.f2||'；单位：'||r.unit||'。原始来源ID：'||r.p1||'、'||r.p2||'；源日期/季度沿用原记录，未知不编造。';
    INSERT INTO public.building_data_field_provenance(id,building_id,brochure_data_id,target_table,field_name,field_value,source_type,source_tier,source_name,source_retrieved_at,value_recorded_at,verification_status,evidence_group_id,evidence_note,is_current)
    VALUES(gen_random_uuid(),r.bid,r.did,'building_brochure_data',r.field,newval,'other','legacy_unknown','内部既有字段及逐字段来源记录（计算补齐）',now(),now(),'legacy_backfill',grp,v_note,true);
    INSERT INTO public.audit_logs(user_id,action_type,request_source,module,target_table,target_id,target_name,old_values,new_values,event_id,details)
    VALUES('chatgpt','AI_FIELD_FILL','chatgpt_mcp','building_data_ai_enrichment','building_brochure_data',r.did::text,d.building_name,jsonb_build_object(r.field,NULL),jsonb_build_object(r.field,newval),batch||':'||r.did||':'||r.field,
      jsonb_build_object('batch_id',batch,'executor','ChatGPT MCP','ai_assisted',true,'ai_generated',false,'building_id',r.bid,'field_name',r.field,'source_type','internal','source_ref',jsonb_build_array(r.p1,r.p2),'source_table','building_data_field_provenance','source_period','原始记录日期或季度；未知保留','unit',r.unit,'verification_status','legacy_backfill','confidence','derived from matching current internal records; no independent new verification','evidence_group_id',grp,'provenance_count',1,'old_is_null',true,'target_updated_at_before',d.updated_at,'target_updated_at_after',after_ts));
    n:=n+1;np:=np+1;
  END LOOP;

  -- Only independently corroborated public sources, per exact project and field.
  FOR r IN SELECT * FROM (VALUES
    ('8e6ccc00-96e8-4519-a570-b99dc08315b5'::uuid,'0a62ab8e-8faf-4435-aecf-101753475f4b'::uuid,'floors_above','108'::jsonb,'层','北京市建筑设计研究院：中信大厦','https://www.biad.com.cn/project/id/58/',NULL::date,'primary','中国中冶：中信大厦工程监理','https://www.mcc.com.cn/ywly_4217/wts/jyjc/202505/t20250523_293354.html','2024-07-25'::date,'primary','CBD Z15，中国尊；两家独立工程参与单位一致。原总楼层字段108未修改。'),
    ('8e6ccc00-96e8-4519-a570-b99dc08315b5','0a62ab8e-8faf-4435-aecf-101753475f4b','floors_below','7','层','北京市建筑设计研究院：中信大厦','https://www.biad.com.cn/project/id/58/',NULL,'primary','中国中冶：中信大厦工程监理','https://www.mcc.com.cn/ywly_4217/wts/jyjc/202505/t20250523_293354.html','2024-07-25','primary','CBD Z15，中国尊；地下7层不含夹层，原总楼层字段108未修改。'),
    ('3c7379b5-40eb-4045-9f9f-6eabfe878caf','1bf6505b-07ee-47a0-bc57-03cb30db2f56','floors_above','24','层','北京中湾智地物业管理有限公司：致真大厦','https://zhongwan.buaa.edu.cn/info/1017/1152.htm',NULL,'primary','易创地产项目参数：致真大厦','https://www.ecre.com.cn/buildings/621.html',NULL,'secondary','知春路7号；主体地上24层，不含25层设备层；保留原总楼层字段。'),
    ('3c7379b5-40eb-4045-9f9f-6eabfe878caf','1bf6505b-07ee-47a0-bc57-03cb30db2f56','floors_below','4','层','北京中湾智地物业管理有限公司：致真大厦','https://zhongwan.buaa.edu.cn/info/1017/1152.htm',NULL,'primary','易创地产项目参数：致真大厦','https://www.ecre.com.cn/buildings/621.html',NULL,'secondary','知春路7号；主体地下4层，与项目参数独立列示一致。'),
    ('3c7379b5-40eb-4045-9f9f-6eabfe878caf','1bf6505b-07ee-47a0-bc57-03cb30db2f56','building_height','99','米','北京中湾智地物业管理有限公司：致真大厦','https://zhongwan.buaa.edu.cn/info/1017/1152.htm',NULL,'primary','易创地产项目参数：致真大厦','https://www.ecre.com.cn/buildings/621.html',NULL,'secondary','知春路7号；主体建筑高度99米，与详细工程参数一致；不按楼层推测。'),
    ('2e4f2d26-5304-4d88-b588-65bcbbd43bb9','ef04702b-e1d4-4595-811f-54453e5184ca','developer','"居然之家投资控股集团"','企业名称','金环建设集团：居然大厦工程案例','https://jinhuanconstruction.cn/Desc/1013_5420',NULL,'primary','北京写字楼信息网：居然大厦','https://www.jurandasha.cn/',NULL,'secondary','东直门南大街甲3号；施工方明确集团出资建设，商业资料明确开发商；取集团共同名称，不推断具体项目法人后缀、当前产权。'),
    ('ad1c8883-9a32-47ea-9fcf-90c22199de7c','7b35b879-eb38-4274-b4aa-9c0d8298d6ec','gfa_total','100000','平方米','国际科技创新中心网络服务平台：新动力金融科技中心','https://www.ncsti.gov.cn/kjdt/ztbd/zgcsfqzsh2024/xcq/yqjs/202404/t20240418_153920.html','2024-04-18','authoritative_secondary','新京报报道（西城区政府转载）：金科新区核心区亮相','https://www.bjxch.gov.cn/xcdt/xxxq/pnidpv886985.html',NULL,'authoritative_secondary','西直门外大街136号原四达大厦；两个来源均为约10万平方米总建筑面积（约数），非可租面积。市发改委2022-04-06批复改造规模101793.76平方米，口径不同不写为精确总建筑面积：https://fgw.beijing.gov.cn/fgwzwgk/ysqzzdgk/202204/t20220406_2654543.htm')
  ) AS t(did,bid,field,value,unit,s1,u1,date1,tier1,s2,u2,date2,tier2,note)
  LOOP
    SELECT bd.*,b.name AS building_name INTO STRICT d FROM public.building_brochure_data bd JOIN public.buildings b ON b.id=bd.building_id WHERE bd.id=r.did AND b.id=r.bid AND b.is_active AND b.tracking_scope='tracked' AND b.merged_into_id IS NULL AND b.project_type='stock' AND b.is_entered_market;
    IF to_jsonb(d)->r.field IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Target no longer empty: % %',r.did,r.field; END IF;
    IF EXISTS(SELECT 1 FROM public.building_data_field_provenance WHERE brochure_data_id=r.did AND field_name=r.field AND is_current) THEN RAISE EXCEPTION 'Existing current target provenance: % %',r.did,r.field; END IF;
    grp:=gen_random_uuid();newval:=r.value;
    EXECUTE format('UPDATE public.building_brochure_data SET %1$I=(jsonb_populate_record(NULL::public.building_brochure_data,$1)).%1$I WHERE id=$2 AND %1$I IS NULL RETURNING to_jsonb(%1$I),updated_at',r.field) INTO actual,after_ts USING jsonb_build_object(r.field,newval),r.did;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>1 OR actual IS DISTINCT FROM newval THEN RAISE EXCEPTION 'Write mismatch: % %',r.did,r.field; END IF;
    INSERT INTO public.building_data_field_provenance(id,building_id,brochure_data_id,target_table,field_name,field_value,source_type,source_tier,source_name,source_url,source_published_date,source_retrieved_at,value_recorded_at,verification_status,evidence_group_id,evidence_note,is_current)
    VALUES
      (gen_random_uuid(),r.bid,r.did,'building_brochure_data',r.field,newval,'internet',r.tier1,r.s1,r.u1,r.date1,now(),now(),'cross_verified',grp,r.note||'；单位：'||r.unit,true),
      (gen_random_uuid(),r.bid,r.did,'building_brochure_data',r.field,newval,'internet',r.tier2,r.s2,r.u2,r.date2,now(),now(),'cross_verified',grp,r.note||'；单位：'||r.unit,true);
    INSERT INTO public.audit_logs(user_id,action_type,request_source,module,target_table,target_id,target_name,old_values,new_values,event_id,details)
    VALUES('chatgpt','AI_FIELD_FILL','chatgpt_mcp','building_data_ai_enrichment','building_brochure_data',r.did::text,d.building_name,jsonb_build_object(r.field,NULL),jsonb_build_object(r.field,newval),batch||':'||r.did||':'||r.field,
      jsonb_build_object('batch_id',batch,'executor','ChatGPT MCP','ai_assisted',true,'ai_generated',false,'building_id',r.bid,'field_name',r.field,'source_type','internet','source_ref',jsonb_build_array(r.u1,r.u2),'source_period','原文发布日期已知则记录；未知不补造','unit',r.unit,'verification_status','cross_verified','confidence','independent matching public sources for selected field','evidence_group_id',grp,'provenance_count',2,'old_is_null',true,'target_updated_at_before',d.updated_at,'target_updated_at_after',after_ts,'scope_note',r.note));
    n:=n+1;np:=np+2;
  END LOOP;
  IF n<>14 OR np<>21 THEN RAISE EXCEPTION 'Unexpected batch counts: fields %, provenance %',n,np; END IF;
  IF (SELECT count(*) FROM public.audit_logs a WHERE a.details->>'batch_id'=batch)<>n THEN RAISE EXCEPTION 'Audit count mismatch'; END IF;
  RAISE NOTICE 'Batch validated: % fields, % provenance records',n,np;
END;
$batch$;
-- This query is deliberately before the transaction boundary for dry-run proof.
SELECT count(*) AS audit_fields, count(DISTINCT details->>'building_id') AS buildings,
       sum((details->>'provenance_count')::int) AS expected_provenance,
       count(*) FILTER (WHERE details->>'source_type'='internal') AS internal_fields,
       count(*) FILTER (WHERE details->>'source_type'='internet') AS internet_fields
FROM public.audit_logs WHERE details->>'batch_id'='ai_technical_fields_20261124_v2';
COMMIT;
