begin;

-- v20: deterministic format/context resolutions (15 aliases / 17 rows)
create temp table _v20_targets(
  historical_name text primary key,
  target_name text not null,
  basis text not null
) on commit drop;

insert into _v20_targets values
('铭丰','铭丰大厦','UNIQUE_SUFFIX_PLUS_SUBMARKET'),
('卫通','卫通大厦','UNIQUE_SUFFIX_PLUS_SUBMARKET'),
('国航','国航大厦','UNIQUE_SUFFIX_PLUS_SUBMARKET'),
('城奥','城奥大厦','UNIQUE_SUFFIX_PLUS_SUBMARKET'),
('万利中心（CBD）','万利中心','LOCATION_ANNOTATION_REMOVED'),
('远洋国际中心A','远洋国际中心A座','TOWER_TOKEN_NORMALIZED'),
('丰联广场大厦','丰联广场','GENERIC_BUILDING_SUFFIX_NORMALIZED'),
('欧美汇大厦9F','欧美汇大厦','FLOOR_ANNOTATION_REMOVED'),
('泰康国际大厦（金融街）','泰康国际大厦','LOCATION_ANNOTATION_REMOVED'),
('鹏润大厦B','鹏润大厦B座','TOWER_TOKEN_NORMALIZED'),
('金辉大厦（4月份）','金辉大厦','NON_SEMANTIC_MONTH_ANNOTATION_REMOVED'),
('阳光大厦（西直门）','阳光大厦','LOCATION_ANNOTATION_REMOVED'),
('北京国家广告产业园区','北京国家广告产业园','GENERIC_SUFFIX_NORMALIZED'),
('华瑞大厦独栋','华瑞大厦','NON_SEMANTIC_DESCRIPTOR_REMOVED'),
('国贸大厦B','国贸大厦B座(三期)','TOWER_TOKEN_AND_ANNOTATION_NORMALIZED');

do $$
declare v_bad integer;
begin
  select count(*) into v_bad
  from _v20_targets t
  left join public.buildings b on b.name=t.target_name and b.tracking_scope='tracked'
  left join public.lease_building_name_map m on m.market_code='BJ' and m.alias_name=t.historical_name
  where b.id is null or (m.building_id is not null and m.building_id<>b.id);
  if v_bad<>0 then raise exception 'v20 target conflict count=%',v_bad; end if;
end $$;

insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',t.historical_name,b.id,'former_name','AUTO_VERIFIED'
from _v20_targets t
join public.buildings b on b.name=t.target_name and b.tracking_scope='tracked'
on conflict (market_code,alias_name) do nothing;

update public.lease_building_alias_review ar
set resolution_status='AUTO_VERIFIED',
    matched_building_id=b.id,
    matched_building_name=b.name,
    resolution_basis=t.basis,
    confidence='ABSOLUTE',
    candidate_count=1,
    candidate_snapshot=jsonb_build_array(jsonb_build_object(
      'building_id',b.id,'building_name',b.name,'resolution','deterministic_exact')),
    evidence_snapshot=case
      when ar.resolution_basis=t.basis and coalesce(ar.review_notes,'') like '%v20 deterministic format/context resolution%'
        then ar.evidence_snapshot
      else coalesce(ar.evidence_snapshot,'[]'::jsonb) ||
        jsonb_build_array(jsonb_build_object(
          'type','v20_deterministic_resolution','rule',t.basis,
          'historical_name',t.historical_name,'candidate_name',t.target_name))
    end,
    review_notes=case
      when coalesce(ar.review_notes,'') like '%v20 deterministic format/context resolution%' then ar.review_notes
      else concat_ws(' | ',nullif(ar.review_notes,''),'v20 deterministic format/context resolution')
    end,
    resolved_at=coalesce(ar.resolved_at,now()),
    updated_at=now()
from _v20_targets t
join public.buildings b on b.name=t.target_name and b.tracking_scope='tracked'
where ar.historical_name=t.historical_name;

update public.buildings b
set former_names=coalesce(b.former_names,'[]'::jsonb)||to_jsonb(array[t.historical_name])
from _v20_targets t
where t.basis='UNIQUE_SUFFIX_PLUS_SUBMARKET'
  and b.name=t.target_name
  and not coalesce(b.former_names,'[]'::jsonb) ? t.historical_name;

-- v21: externally verified single-candidate identities.
create temp table _v21_exact(
  historical_name text primary key,
  target_name text not null,
  basis text not null,
  evidence_detail text not null
) on commit drop;

insert into _v21_exact values
('太平金融中心','京汇大厦','EXTERNAL_ADDRESS_RENAME_CORROBORATED','北京太平金融中心与京汇大厦指向朝阳区建国路乙118号同一物理楼宇；西城区中国太平金融中心为不同实体。'),
('人寿大厦','中国人寿大厦','EXTERNAL_TENANT_ADDRESS_CORROBORATED','历史租户万博宣伟公开办公地址为朝阳门外大街16号中国人寿大厦。'),
('华腾世纪总部公园','华腾世纪总部','EXTERNAL_PROJECT_IDENTITY_CORROBORATED','公开项目资料中的完整项目名、地址与开发主体和当前实体一致。'),
('嘉里','嘉里中心','EXTERNAL_TENANT_ADDRESS_CORROBORATED','历史租户公开办公地址指向北京嘉里中心，支持“嘉里”为项目简称。'),
('民生金融中心C座','民生金融中心','EXTERNAL_PROJECT_COMPONENT_CORROBORATED','公开资料确认C座属于民生金融中心项目。'),
('汉威国际广场三期','汉威国际','EXTERNAL_PROJECT_COMPONENT_CORROBORATED','公开项目/企业地址资料确认三期属于汉威国际广场；当前实体former_names含汉威国际广场。'),
('汉威国际广场四期','汉威国际','EXTERNAL_PROJECT_COMPONENT_CORROBORATED','公开项目资料确认四期属于汉威国际广场；当前实体former_names含汉威国际广场。'),
('金辉','金辉大厦','EXTERNAL_TENANT_ADDRESS_CORROBORATED','历史租户马上消费公开办公/采购地址指向北京金辉大厦。'),
('龙湖蓝海引擎产业园','龙湖蓝海引擎','OFFICIAL_PROJECT_NAME_CORROBORATED','龙湖官方资料使用龙湖蓝海引擎产业园项目名称。'),
('东升','东升科技园','EXTERNAL_TENANT_ADDRESS_CORROBORATED','历史租户北京惠赢天下网络技术有限公司公开注册地址为中关村东升科技园B-1号楼，否定原东升大厦候选。'),
('东升科技园-天地邻枫','东升科技园','EXTERNAL_PROJECT_COMPONENT_CORROBORATED','公开项目资料与园区身份支持该历史写法属于东升科技园。'),
('东升科技园B座','东升科技园','EXTERNAL_PROJECT_COMPONENT_CORROBORATED','B座属于东升科技园项目，当前实体为项目聚合层。'),
('东升科技园C-8','东升科技园','EXTERNAL_PROJECT_COMPONENT_CORROBORATED','C-8属于东升科技园项目，当前实体为项目聚合层。'),
('东升科技园一期','东升科技园','EXTERNAL_PROJECT_COMPONENT_CORROBORATED','公开资料确认东升科技园存在分期，一期属于当前聚合项目。'),
('东旭国际中心A座南楼','东旭国际','EXTERNAL_TENANT_ADDRESS_CORROBORATED','公开资料显示历史租户国电通办公地址为东旭国际中心A座南楼。'),
('东枫德必WE','东枫德必WE人工智能创新基地','OFFICIAL_PROJECT_NAME_CORROBORATED','德必公开资料将东枫德必WE与当前完整项目名指向同一项目。'),
('京汇大厦（太平金融中心）','京汇大厦','EXTERNAL_ADDRESS_RENAME_CORROBORATED','公开资料确认京汇大厦与北京太平金融中心为同一物理楼宇的历史/项目名称关系。'),
('兆泰国际中心A','兆泰国际中心（AB座）','EXTERNAL_PROJECT_COMPONENT_CORROBORATED','公开地图确认A座属于兆泰国际中心AB座，当前former_names亦包含A座。'),
('利星行','利星行中心','EXTERNAL_PROJECT_IDENTITY_CORROBORATED','利星行集团及公开项目资料确认北京利星行中心，支持简称。'),
('利星行中心2期','利星行中心','EXTERNAL_PROJECT_COMPONENT_CORROBORATED','历史2期属于利星行中心项目聚合实体。'),
('卓著','卓著中心','EXTERNAL_TENANT_ADDRESS_CORROBORATED','泰康资产公开办公地址为武定侯街6号卓著中心，与历史租户一致。'),
('合生财富广场（德胜门）','合生财富广场','OFFICIAL_PROJECT_NAME_CORROBORATED','合生官方资料使用北京德胜合生财富广场名称。'),
('和盈','和盈中心','EXTERNAL_TENANT_ADDRESS_CORROBORATED','历史租户九章云极/DataCanvas公开办公地址位于和盈中心C座。'),
('嘉里中心北塔30F','嘉里中心','EXTERNAL_TENANT_ADDRESS_CORROBORATED','历史租户品诚梅森公开地址位于北京嘉里中心北楼30层。'),
('嘉里中心北塔8f','嘉里中心','EXTERNAL_TENANT_ADDRESS_CORROBORATED','日产中国公开地址位于北京嘉里中心北楼8层。'),
('嘉铭中心B','嘉铭中心','EXTERNAL_PROJECT_COMPONENT_CORROBORATED','公开地图确认嘉铭中心B座属于嘉铭中心。'),
('方圆大厦·优客','方圆大厦','EXTERNAL_COWORKING_LOCATION_CORROBORATED','公开资料存在优客工场方圆大厦社区，优客为楼内运营商标注。'),
('方圆大厦优客工场','方圆大厦','EXTERNAL_COWORKING_LOCATION_CORROBORATED','公开资料存在优客工场方圆大厦社区，优客工场为楼内运营商。'),
('汇亚','汇亚大厦','EXTERNAL_LOCATION_CORROBORATED','丽泽公开资料确认汇亚大厦实体，结合唯一候选支持简称。'),
('汉威国际广场，西区2号','汉威国际','EXTERNAL_PROJECT_COMPONENT_CORROBORATED','西区2号属于汉威国际广场项目聚合实体。'),
('洛娃大厦','洛娃大厦A/B/C/D/E','EXTERNAL_PROJECT_STRUCTURE_CORROBORATED','公开项目/资产资料确认洛娃大厦由多个楼座组成，当前记录为项目聚合实体。'),
('海峡国际','海峡国际大厦','EXTERNAL_ADDRESS_MARKET_CORROBORATED','公开地图/机构资料确认西城区海峡国际大厦，符合历史金融街语境。'),
('盈都大厦D座','盈都大厦（D座普洛斯）','OFFICIAL_OWNERSHIP_CORROBORATED','普洛斯官方资料确认其收购北京中关村盈都大厦D座。'),
('金地中心 A','金地中心','EXTERNAL_PROJECT_COMPONENT_CORROBORATED','公开地图确认金地中心A座，当前former_names包含金地中心A座。'),
('锐创国际','锐创国际中心','EXTERNAL_TENANT_ADDRESS_CORROBORATED','北京市监管公开信息显示历史租户北京三快科技办公场所在锐创国际中心。'),
('阳光878','阳光878商务中心','EXTERNAL_NAME_CORROBORATED','公开楼宇资料使用阳光878商务中心名称。'),
('颐堤港A座','颐堤港','OFFICIAL_PROJECT_STRUCTURE_CORROBORATED','颐堤港/远洋官方资料确认项目仅有一座甲级办公楼颐堤港一座。');

create temp table _v21_project(
  historical_name text primary key,
  target_name text not null,
  evidence_detail text not null
) on commit drop;

insert into _v21_project values
('复地金融中心','复地金融中心B座（南塔）','公开资料确认通州复地金融中心项目；历史名称仅到项目级，不推断具体塔楼。'),
('月坛金融中心','月坛金融中心E座','公开资料确认月坛南街1号院7号楼属于月坛金融中心；历史名称仅到项目级，不强制归入E座。'),
('清华同方','清华同方科技广场D座','公开资料显示清华同方科技广场包含A/B/C/D等多个楼座，历史名称不足以精确到D座。'),
('电子城研发中心','电子城研发中心A1','公开资料显示电子城研发中心包含A1/A2/A3等楼座，历史项目名不足以精确到A1。');

do $$
declare v_bad integer;
begin
  select count(*) into v_bad
  from (
    select historical_name,target_name from _v21_exact
    union all
    select historical_name,target_name from _v21_project
  ) t
  left join public.buildings b on b.name=t.target_name and b.tracking_scope='tracked'
  left join public.lease_building_name_map m on m.market_code='BJ' and m.alias_name=t.historical_name
  where b.id is null or (m.building_id is not null and m.building_id<>b.id);
  if v_bad<>0 then raise exception 'v21 target conflict count=%',v_bad; end if;
end $$;

insert into public.lease_building_name_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',t.historical_name,b.id,'former_name','AUTO_VERIFIED'
from _v21_exact t
join public.buildings b on b.name=t.target_name and b.tracking_scope='tracked'
on conflict (market_code,alias_name) do nothing;

update public.lease_building_alias_review ar
set resolution_status='AUTO_VERIFIED',
    matched_building_id=b.id,
    matched_building_name=b.name,
    resolution_basis=t.basis,
    confidence='ABSOLUTE',
    candidate_count=1,
    candidate_snapshot=jsonb_build_array(jsonb_build_object(
      'building_id',b.id,'building_name',b.name,'resolution','external_verified_exact')),
    evidence_snapshot=case
      when ar.resolution_basis=t.basis and coalesce(ar.review_notes,'') like '%v21 external evidence verified exact identity%'
        then ar.evidence_snapshot
      else coalesce(ar.evidence_snapshot,'[]'::jsonb) ||
        jsonb_build_array(jsonb_build_object(
          'type','external_web_verification','verified_at','2026-09-21',
          'basis',t.basis,'detail',t.evidence_detail))
    end,
    review_notes=case
      when coalesce(ar.review_notes,'') like '%v21 external evidence verified exact identity%' then ar.review_notes
      else concat_ws(' | ',nullif(ar.review_notes,''),'v21 external evidence verified exact identity')
    end,
    resolved_at=coalesce(ar.resolved_at,now()),
    updated_at=now()
from _v21_exact t
join public.buildings b on b.name=t.target_name and b.tracking_scope='tracked'
where ar.historical_name=t.historical_name;

insert into public.lease_building_project_map(market_code,alias_name,building_id,match_method,verification_status)
select 'BJ',t.historical_name,b.id,'EXTERNAL_PROJECT_SCOPE_VERIFIED','AUTO_VERIFIED_PROJECT'
from _v21_project t
join public.buildings b on b.name=t.target_name and b.tracking_scope='tracked'
on conflict (market_code,alias_name,building_id) do update
set match_method=excluded.match_method,verification_status=excluded.verification_status;

update public.lease_building_alias_review ar
set resolution_status='AUTO_VERIFIED_PROJECT',
    matched_building_id=null,
    matched_building_name=null,
    resolution_basis='EXTERNAL_PROJECT_SCOPE_ONLY',
    confidence='ABSOLUTE',
    candidate_count=1,
    candidate_snapshot=jsonb_build_array(jsonb_build_object(
      'building_id',b.id,'building_name',b.name,'resolution','external_verified_project_member')),
    evidence_snapshot=case
      when ar.resolution_basis='EXTERNAL_PROJECT_SCOPE_ONLY' and coalesce(ar.review_notes,'') like '%v21 external evidence verified project scope%'
        then ar.evidence_snapshot
      else coalesce(ar.evidence_snapshot,'[]'::jsonb) ||
        jsonb_build_array(jsonb_build_object(
          'type','external_web_verification','verified_at','2026-09-21',
          'basis','EXTERNAL_PROJECT_SCOPE_ONLY','detail',t.evidence_detail))
    end,
    review_notes=case
      when coalesce(ar.review_notes,'') like '%v21 external evidence verified project scope%' then ar.review_notes
      else concat_ws(' | ',nullif(ar.review_notes,''),'v21 external evidence verified project scope; exact tower deliberately not inferred')
    end,
    resolved_at=coalesce(ar.resolved_at,now()),
    updated_at=now()
from _v21_project t
join public.buildings b on b.name=t.target_name and b.tracking_scope='tracked'
where ar.historical_name=t.historical_name;

update public.lease_building_alias_review ar
set candidate_count=0,
    candidate_snapshot='[]'::jsonb,
    evidence_snapshot=case
      when coalesce(ar.review_notes,'') like '%v21 rejected wrong same-name candidate%' then ar.evidence_snapshot
      else coalesce(ar.evidence_snapshot,'[]'::jsonb) ||
        jsonb_build_array(jsonb_build_object(
          'type','external_candidate_rejection','verified_at','2026-09-21',
          'detail','中海国际中心阜成门公开地址指向西城区平安里西大街28号附近实体；原候选为朝阳/亚奥另一同名项目。'))
    end,
    review_notes=case
      when coalesce(ar.review_notes,'') like '%v21 rejected wrong same-name candidate%' then ar.review_notes
      else concat_ws(' | ',nullif(ar.review_notes,''),'v21 rejected wrong same-name candidate: 阜成门/西城 entity is distinct from tracked 朝阳/亚奥 中海国际中心')
    end,
    updated_at=now()
where ar.historical_name='中海国际中心阜成门'
  and ar.resolution_status='NEEDS_REVIEW';

update public.lease_building_alias_review ar
set evidence_snapshot=case
      when coalesce(ar.review_notes,'') like '%v21 external verification inconclusive%' then ar.evidence_snapshot
      else coalesce(ar.evidence_snapshot,'[]'::jsonb) ||
        jsonb_build_array(jsonb_build_object(
          'type','external_web_verification_inconclusive','verified_at','2026-09-21',
          'detail',case ar.historical_name
            when '北辰' then '北辰可指北辰集团旗下多个项目；未找到足以将历史成交唯一归入北辰中心的独立证据。'
            when '冠城' then '冠城简称不足以证明为冠城大厦；未找到历史JuneLife成交的独立地址证据。'
            when '融汇国际' then '候选位于海淀/西直门-中关村语境，历史记录标注金融街；未找到历史租户材料联盟的独立地址证据。'
          end))
    end,
    review_notes=case
      when coalesce(ar.review_notes,'') like '%v21 external verification inconclusive%' then ar.review_notes
      else concat_ws(' | ',nullif(ar.review_notes,''),'v21 external verification inconclusive; kept NEEDS_REVIEW')
    end,
    updated_at=now()
where ar.historical_name in ('北辰','冠城','融汇国际')
  and ar.resolution_status='NEEDS_REVIEW';

do $$
declare v_exact integer; v_project integer; v_auto integer; v_remaining integer;
begin
  select count(*) into v_auto from public.lease_transactions_read_v1
   where record_source='history' and building_match_scope='exact'
     and trim(new_building) in (select historical_name from _v20_targets);
  select count(*) into v_exact from public.lease_transactions_read_v1
   where record_source='history' and building_match_scope='exact'
     and trim(new_building) in (select historical_name from _v21_exact);
  select count(*) into v_project from public.lease_transactions_read_v1
   where record_source='history' and building_match_scope='project'
     and trim(new_building) in (select historical_name from _v21_project);
  select count(*) into v_remaining from public.lease_transactions_read_v1
   where record_source='history' and building_match_scope='unmapped'
     and trim(new_building) in ('中海国际中心阜成门','北辰','冠城','融汇国际');
  if v_auto<>17 or v_exact<>49 or v_project<>4 or v_remaining<>4 then
    raise exception 'single-candidate migration postcondition failed auto/exact/project/remaining=%/%/%/% expected 17/49/4/4',
      v_auto,v_exact,v_project,v_remaining;
  end if;
end $$;

commit;
