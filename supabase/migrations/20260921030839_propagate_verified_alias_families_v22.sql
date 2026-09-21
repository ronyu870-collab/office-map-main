begin;

create temp table _v22_alias_family_targets(
  historical_name text primary key,
  target_name text not null
) on commit drop;

insert into _v22_alias_family_targets values
('国贸二期','国贸写字楼2座'),
('利星行2期','利星行中心'),
('卓著大厦','卓著中心'),
('双子座东塔','汇京双子座大厦'),
('启皓大厦','启皓北京'),
('嘉里南楼','嘉里中心'),
('汇京双子座东塔','汇京双子座大厦'),
('英蓝大厦','英蓝国际金融中心'),
('财富金融中心（土地方）','财富金融中心（FFC）'),
('IFC财源国际B座','国际财源中心（IFC）'),
('PICC Tower','PICC大厦'),
('SK大厦（汉美商务中心）','WWT世界财富大厦'),
('UBP B18','恒通国际商务园'),
('UBP中央大厦','恒通国际商务园'),
('UBP恒通商务园中央大厦','恒通国际商务园'),
('WFC环球金融中心','环球金融中心'),
('万科时代中心A','万科时代中心.望京'),
('万科时代中心A座','万科时代中心.望京'),
('万豪中心写字楼','荷华明城大厦'),
('东亿产业园','东亿文化科技产业园'),
('东枫德必产业园','东枫德必WE人工智能创新基地'),
('丽金中心A座','丽金中心（AB座）'),
('互联网创新中心-上地','中关村软件园互联网创新中心'),
('侨福芳草地 D座','北京侨福芳草地'),
('光华路SOHO2座','光华路SOHOII'),
('六工汇1座','首钢园北区-六工汇'),
('凯晨国际广场','凯晨世贸中心'),
('凯晨广场','凯晨世贸中心'),
('北京IFC A座','国际财源中心（IFC）'),
('北辰世纪商业办公','北辰世纪中心'),
('卓著金融中心','卓著中心'),
('双子座大厦 西塔','汇京双子座大厦'),
('双子座西塔','汇京双子座大厦'),
('启皓中心西塔','启皓北京'),
('国贸1期','国贸写字楼1座'),
('国际财源中心西座','国际财源中心（IFC）'),
('城奥中心','城奥大厦'),
('太平金融','京汇大厦'),
('广播大厦（卓明)','北京广播大厦'),
('恒通商务园B31','恒通国际商务园'),
('新东安2座','新东安大厦'),
('汇京双子座西塔','汇京双子座大厦'),
('浦项B座','浦项中心'),
('益园文创基地','益园文化创意产业基地'),
('英蓝IFC','英蓝国际金融中心'),
('财源国际中心IFC','国际财源中心（IFC）'),
('远洋二期E座','远洋国际中心二期'),
('远洋光华国际C','远洋光华国际ABC座-远洋自持'),
('融科c','融科资讯中心C座'),
('铭丰中心','铭丰大厦');

create temp table _v22_seed_evidence on commit drop as
with seed_aliases as (
  select m.building_id,m.alias_name
  from public.lease_building_name_map m
  where m.market_code='BJ'
    and m.verification_status in ('AUTO_VERIFIED','MANUAL_VERIFIED')
  union all
  select b.id,x.fn
  from public.buildings b
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(b.former_names)='array' then b.former_names else '[]'::jsonb end
  ) x(fn)
  where b.tracking_scope='tracked'
)
select
  t.historical_name,
  b.id building_id,
  b.name target_name,
  array_agg(distinct s.alias_name order by s.alias_name) filter (
    where s.alias_name<>t.historical_name
      and (
        lower(regexp_replace(t.historical_name,'[[:space:]·•._,，。()（）\-—/\\]+','','g'))
          like lower(regexp_replace(s.alias_name,'[[:space:]·•._,，。()（）\-—/\\]+','','g')) || '%'
        or
        lower(regexp_replace(s.alias_name,'[[:space:]·•._,，。()（）\-—/\\]+','','g'))
          like lower(regexp_replace(t.historical_name,'[[:space:]·•._,，。()（）\-—/\\]+','','g')) || '%'
      )
  ) seed_aliases
from _v22_alias_family_targets t
join public.buildings b
  on b.name=t.target_name and b.tracking_scope='tracked'
left join seed_aliases s on s.building_id=b.id
group by t.historical_name,b.id,b.name;

do $$
declare
  v_aliases integer;
  v_rows integer;
  v_bad integer;
begin
  select count(*),coalesce(sum(x.rows),0)
    into v_aliases,v_rows
  from _v22_alias_family_targets t
  join (
    select trim(new_building) historical_name,count(*) rows
    from public.lease_transactions_history
    group by trim(new_building)
  ) x using(historical_name);

  if v_aliases<>50 or v_rows<>60 then
    raise exception 'v22 source population drift: aliases=%, rows=% expected 50/60',v_aliases,v_rows;
  end if;

  select count(*) into v_bad
  from _v22_alias_family_targets t
  left join public.buildings b on b.name=t.target_name and b.tracking_scope='tracked'
  left join public.lease_building_name_map m
    on m.market_code='BJ' and m.alias_name=t.historical_name
  left join lateral (
    select count(*) n
    from public.lease_building_project_map p
    where p.market_code='BJ' and p.alias_name=t.historical_name
  ) p on true
  left join _v22_seed_evidence e using(historical_name)
  where b.id is null
     or (m.building_id is not null and m.building_id<>b.id)
     or p.n<>0
     or coalesce(cardinality(e.seed_aliases),0)=0;

  if v_bad<>0 then
    raise exception 'v22 safety precondition failed for % aliases',v_bad;
  end if;
end $$;

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select 'BJ',t.historical_name,b.id,'former_name','AUTO_VERIFIED'
from _v22_alias_family_targets t
join public.buildings b on b.name=t.target_name and b.tracking_scope='tracked'
on conflict (market_code,alias_name) do nothing;

update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED',
  matched_building_id=e.building_id,
  matched_building_name=e.target_name,
  resolution_basis='VERIFIED_ALIAS_FAMILY_PROPAGATION',
  confidence='ABSOLUTE',
  candidate_count=1,
  candidate_snapshot=jsonb_build_array(
    jsonb_build_object(
      'building_id',e.building_id,
      'building_name',e.target_name,
      'resolution','verified_alias_family_propagation',
      'seed_aliases',e.seed_aliases
    )
  ),
  evidence_snapshot=case
    when ar.resolution_basis='VERIFIED_ALIAS_FAMILY_PROPAGATION'
      and coalesce(ar.review_notes,'') like '%v22 P0 verified alias-family propagation%'
      then ar.evidence_snapshot
    else coalesce(ar.evidence_snapshot,'[]'::jsonb) ||
      jsonb_build_array(
        jsonb_build_object(
          'type','verified_alias_family_propagation',
          'verified_at','2026-09-21',
          'target_name',e.target_name,
          'seed_aliases',e.seed_aliases,
          'detail','Resolved from an existing verified alias/former-name identity within the same unique tracked building family; no new fuzzy identity inference.'
        )
      )
  end,
  review_notes=case
    when coalesce(ar.review_notes,'') like '%v22 P0 verified alias-family propagation%'
      then ar.review_notes
    else concat_ws(' | ',nullif(ar.review_notes,''),'v22 P0 verified alias-family propagation')
  end,
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
from _v22_seed_evidence e
where ar.historical_name=e.historical_name;

do $$
declare
  v_exact integer;
  v_unmapped integer;
begin
  select count(*) into v_exact
  from public.lease_transactions_read_v1 r
  where r.record_source='history'
    and r.building_match_scope='exact'
    and trim(r.new_building) in (select historical_name from _v22_alias_family_targets);

  select count(*) into v_unmapped
  from public.lease_transactions_read_v1 r
  where r.record_source='history'
    and r.building_match_scope='unmapped'
    and trim(r.new_building) in (select historical_name from _v22_alias_family_targets);

  if v_exact<>60 or v_unmapped<>0 then
    raise exception 'v22 postcondition failed: exact=%, unmapped=% expected 60/0',v_exact,v_unmapped;
  end if;
end $$;

commit;
