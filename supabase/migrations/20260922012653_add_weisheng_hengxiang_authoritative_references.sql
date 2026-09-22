begin;

create temp table _authoritative_refs(
  historical_name text primary key,
  district text not null,
  evidence_detail text not null,
  source_url text not null
) on commit drop;

insert into _authoritative_refs values
(
  '威盛大厦',
  '海淀区',
  '北京市海淀区政府2022年度消防安全重点单位公示明确列示“国贸物业酒店管理有限公司（威盛大厦）”，地址为北京市海淀区中关村东路1号院7号楼（清华科技园）；2025历史租户星动纪元亦公开位于威盛大厦7层。',
  'https://zyk.bjhd.gov.cn/zwdt/xxgk/tzgg/202203/t20220331_4517710_hd.shtml'
),
(
  '恒祥大厦',
  '朝阳区',
  '北京市公共资源交易服务平台2021年政府采购公告明确列示供应商地址“北京市朝阳区团结湖南里15号(恒祥大厦)4层1-14内408室”；北京经开区2026年政府采购公告再次使用同一楼名与地址。',
  'https://ggzyfw.beijing.gov.cn/jyxxzbjggg/20210708/1842043.html'
);

insert into public.buildings(
  name,city,district,former_names,project_type,is_active,is_entered_market,tracking_scope,notes
)
select
  t.historical_name,'北京',t.district,'[]'::jsonb,'reference',false,true,'reference_only',
  concat(
    '互联网权威证据历史参考实体；仅用于历史成交身份解析，不参与地图、季度填报、推荐和楼书运营。 ',
    '核验日期：2026-09-22。 ',t.evidence_detail,' 来源：',t.source_url
  )
from _authoritative_refs t
where not exists (
  select 1 from public.buildings b where trim(b.name)=trim(t.historical_name)
);

do $$
declare v_bad integer;
begin
  select count(*) into v_bad
  from _authoritative_refs t
  left join public.buildings b on trim(b.name)=trim(t.historical_name)
  where b.id is null
     or b.tracking_scope<>'reference_only'
     or b.is_active<>false
     or b.project_type<>'reference';
  if v_bad<>0 then
    raise exception 'authoritative reference entity invariant failed for % targets',v_bad;
  end if;
end $$;

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select 'BJ',t.historical_name,b.id,'canonical_name','AUTO_VERIFIED'
from _authoritative_refs t
join public.buildings b
  on trim(b.name)=trim(t.historical_name) and b.tracking_scope='reference_only'
on conflict (market_code,alias_name) do update
set building_id=excluded.building_id,
    match_method=excluded.match_method,
    verification_status=excluded.verification_status;

update public.lease_building_alias_review ar
set resolution_status='AUTO_VERIFIED',
    matched_building_id=b.id,
    matched_building_name=b.name,
    resolution_basis='AUTHORITATIVE_GOVERNMENT_REFERENCE_ENTITY',
    confidence='ABSOLUTE',
    candidate_count=1,
    candidate_snapshot=jsonb_build_array(
      jsonb_build_object('building_id',b.id,'building_name',b.name,'resolution','authoritative_reference_entity')
    ),
    review_notes=case
      when coalesce(ar.review_notes,'') like '%authoritative government reference entity created 2026-09-22%'
        then ar.review_notes
      else concat_ws(' | ',nullif(ar.review_notes,''),'authoritative government reference entity created 2026-09-22')
    end,
    resolved_at=coalesce(ar.resolved_at,now()),
    updated_at=now()
from _authoritative_refs t
join public.buildings b
  on trim(b.name)=trim(t.historical_name) and b.tracking_scope='reference_only'
where ar.historical_name=t.historical_name;

do $$
declare v_ref integer; v_unmapped integer; v_entities integer;
begin
  select count(*) into v_ref
  from public.lease_transactions_read_v1 r
  where r.record_source='history'
    and r.building_match_scope='reference'
    and trim(r.new_building) in (select historical_name from _authoritative_refs);

  select count(*) into v_unmapped
  from public.lease_transactions_read_v1 r
  where r.record_source='history'
    and r.building_match_scope='unmapped'
    and trim(r.new_building) in (select historical_name from _authoritative_refs);

  select count(*) into v_entities
  from public.buildings b
  where b.tracking_scope='reference_only'
    and b.name in (select historical_name from _authoritative_refs);

  if v_ref<>4 or v_unmapped<>0 or v_entities<>2 then
    raise exception 'authoritative reference postcondition failed ref/unmapped/entities=%/%/% expected 4/0/2',
      v_ref,v_unmapped,v_entities;
  end if;
end $$;

commit;
