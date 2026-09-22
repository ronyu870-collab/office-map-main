begin;

insert into public.buildings(
  name,former_names,city,district,project_type,is_active,is_entered_market,tracking_scope,notes
)
select
  '启达北旺中心',
  '["启达·北旺中心","东软北京研发中心B座"]'::jsonb,
  '北京','海淀区','reference',false,true,'reference_only',
  '历史参考实体，仅用于历史成交身份解析；不参与地图、季度填报、推荐和楼书运营。证据来源（2026-09-22）：东软集团公开披露 + 多个独立项目目录交叉验证；启达北旺中心对应东软北京研发中心B座，开发运营方北京国华启达投资管理有限公司。'
where not exists (
  select 1 from public.buildings
  where name='启达北旺中心'
);

do $$
declare v_entity integer; v_conflict integer;
begin
  select count(*) into v_entity
  from public.buildings
  where name='启达北旺中心'
    and tracking_scope='reference_only'
    and project_type='reference'
    and is_active=false;

  if v_entity<>1 then
    raise exception 'Qida Beiwang reference entity invariant failed: %',v_entity;
  end if;

  select count(*) into v_conflict
  from public.buildings
  where name='启达北旺中心'
    and (tracking_scope<>'reference_only' or is_active<>false);

  if v_conflict<>0 then
    raise exception 'Qida Beiwang operational collision=%',v_conflict;
  end if;
end $$;

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
select 'BJ','启达北旺中心',b.id,'canonical_name','AUTO_VERIFIED'
from public.buildings b
where b.name='启达北旺中心'
  and b.tracking_scope='reference_only'
on conflict (market_code,alias_name) do update
set building_id=excluded.building_id,
    match_method=excluded.match_method,
    verification_status=excluded.verification_status;

update public.lease_building_alias_review ar
set
  resolution_status='AUTO_VERIFIED',
  matched_building_id=b.id,
  matched_building_name=b.name,
  resolution_basis='CROSS_VERIFIED_PROJECT_IDENTITY_REFERENCE_ENTITY',
  confidence='ABSOLUTE',
  candidate_count=1,
  candidate_snapshot=jsonb_build_array(
    jsonb_build_object(
      'building_id',b.id,
      'building_name',b.name,
      'resolution','reference_only_b_tower_identity'
    )
  ),
  evidence_snapshot=case
    when coalesce(ar.evidence_snapshot,'[]'::jsonb) @> '[{"type":"source_bundle"}]'::jsonb
      then ar.evidence_snapshot
    else coalesce(ar.evidence_snapshot,'[]'::jsonb) ||
      jsonb_build_array(
        jsonb_build_object(
          'type','source_bundle',
          'verified_at','2026-09-22',
          'sources',jsonb_build_array(
            jsonb_build_object(
              'source_type','listed_company_disclosure',
              'publisher','东软集团',
              'url','https://www.neusoft.com/jp/upload/investor/2017/201702.pdf',
              'supports','北京国华启达投资管理有限公司与东软北京研发中心项目关系'
            ),
            jsonb_build_object(
              'source_type','project_directory_crosscheck',
              'publisher','业主汇',
              'url','https://www.ownerhere.com/detail/94',
              'supports','启达·北旺中心 = 东软北京研发中心B座；开发运营方北京国华启达投资管理有限公司；位置中关村软件园二期'
            ),
            jsonb_build_object(
              'source_type','project_directory_crosscheck',
              'publisher','首都写字楼出租网',
              'url','https://www.xzlsd.com/news_x.aspx?cid=4&nid=19531',
              'supports','启达北旺中心项目名称、开发运营方与中关村软件园位置交叉一致'
            )
          )
        )
      )
  end,
  review_notes=case
    when coalesce(ar.review_notes,'') like '%reference-only B-tower entity created%'
      then ar.review_notes
    else concat_ws(' | ',nullif(ar.review_notes,''),'reference-only B-tower entity created; tracked A-tower deliberately kept separate')
  end,
  resolved_at=coalesce(ar.resolved_at,now()),
  updated_at=now()
from public.buildings b
where ar.historical_name='启达北旺中心'
  and b.name='启达北旺中心'
  and b.tracking_scope='reference_only';

do $$
declare v_reference integer; v_assign integer;
begin
  select count(*) into v_reference
  from public.lease_transactions_read_v1
  where record_source='history'
    and building_match_scope='reference'
    and trim(new_building)='启达北旺中心';

  if v_reference<>3 then
    raise exception 'Qida Beiwang reference rows=% expected 3',v_reference;
  end if;

  select count(*) into v_assign
  from public.building_assignments a
  join public.buildings b on b.id=a.building_id
  where b.name='启达北旺中心';

  if v_assign<>0 then
    raise exception 'Qida Beiwang reference entity unexpectedly assigned=%',v_assign;
  end if;
end $$;

commit;
