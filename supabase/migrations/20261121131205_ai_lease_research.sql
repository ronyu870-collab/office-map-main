begin;
-- Separate, closed-by-default research grants. Existing operational lease RLS is untouched.
create table private.ai_lease_research_grants (
  user_id uuid primary key,
  enabled boolean not null default false,
  valid_until timestamptz not null,
  sources text[] not null default '{}' check(sources <@ array['live','history'] and array_position(sources,null) is null),
  allow_details boolean not null default false,
  allow_financials boolean not null default false,
  allow_export boolean not null default false,
  min_group_size integer not null default 3 check(min_group_size between 3 and 100),
  all_submarkets boolean not null default false,
  submarkets text[] not null default '{}' check(array_position(submarkets,null) is null),
  all_buildings boolean not null default false,
  building_ids uuid[] not null default '{}' check(array_position(building_ids,null) is null),
  revision uuid not null default gen_random_uuid(),
  change_reference text not null check(length(change_reference) between 1 and 500),
  check(not allow_financials or allow_details)
);
-- Only independently verified cross-source identities are deduplicated. No fuzzy company/area matching.
-- Fingerprints cover the complete read-view record, including mapping and source metadata.
create table private.ai_lease_verified_duplicates (
  live_id uuid primary key references public.lease_transactions(id) on delete restrict,
  history_id uuid unique not null references public.lease_transactions_history(id) on delete restrict,
  live_fingerprint text not null check(live_fingerprint ~ '^[0-9a-f]{64}$'),
  history_fingerprint text not null check(history_fingerprint ~ '^[0-9a-f]{64}$'),
  evidence_reference text not null check(length(evidence_reference) between 1 and 500),
  revision uuid not null default gen_random_uuid(),
  change_reference text not null check(length(change_reference) between 1 and 500)
);
create trigger ai_lease_research_grant_changes before insert or update or delete on private.ai_lease_research_grants
  for each row execute function private.ai_query_policy_change();
create trigger ai_lease_duplicate_changes before insert or update or delete on private.ai_lease_verified_duplicates
  for each row execute function private.ai_query_policy_change();
alter table private.ai_lease_research_grants enable row level security;
alter table private.ai_lease_verified_duplicates enable row level security;
revoke all on private.ai_lease_research_grants,private.ai_lease_verified_duplicates from public,anon,authenticated,service_role;

-- Service-only fixed projection. Never fetch tenant, broker, submitter, remarks or import raw_record.
-- The server performs deterministic research; the provider receives aggregates only.
create function private.ai_lease_research_snapshot(p_actor uuid,p_effective uuid,p_session uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb; g private.ai_lease_research_grants; result_rows jsonb; links jsonb;
begin
  a:=public.ai_query_authority(p_actor,p_effective,p_session);
  if a->>'allowed' is distinct from 'true' or p_actor<>p_effective
    or not (a->'capabilities' ? 'query:catalog') then return jsonb_build_object('allowed',false); end if;
  select * into g from private.ai_lease_research_grants where user_id=p_actor for share;
  if not found or not g.enabled or g.valid_until<=clock_timestamp() or cardinality(g.sources)=0
    then return jsonb_build_object('allowed',false); end if;
  with scoped as (
    select v.*,encode(sha256(convert_to(to_jsonb(v)::text,'UTF8')),'hex') as fingerprint,b.name as canonical_name
    from public.lease_transactions_read_v1 v left join public.buildings b on b.id=v.building_id
    where v.record_source=any(g.sources)
      and (g.all_submarkets or v.sub_market=any(g.submarkets))
      and ((a->>'all_submarkets')::boolean or a->'submarkets' ? v.sub_market)
      and (g.all_buildings or (v.building_match_scope in ('exact','reference') and v.building_id=any(g.building_ids)))
      and ((a->>'all_buildings')::boolean or (v.building_match_scope in ('exact','reference') and a->'building_ids' ? v.building_id::text))
    order by v.record_source,v.source_record_id limit 20001
  ) select coalesce(jsonb_agg(jsonb_build_object(
      'id',record_source||':'||source_record_id,'source',record_source,'fingerprint',fingerprint,
      'buildingId',building_id,'building',coalesce(canonical_name,new_building),'alias',new_building,
      'match',building_match_scope,'submarket',sub_market,'industry',industry,
      'start',transaction_period_start,'end',transaction_period_end,'precision',transaction_time_precision,
      'area',area_sqm::text,'quality',quality_status,
      'financials',case when g.allow_financials then jsonb_build_object('faceRent',face_rent::text,
        'effectiveRent',effective_rent::text,'managementFee',management_fee::text,
        'leaseMonths',lease_term_months::text,'fitOutMonths',fit_out_months::text,'freeMonths',rent_free_months::text) else '{}'::jsonb end
    ) order by record_source,source_record_id),'[]'::jsonb) into result_rows from scoped;
  if jsonb_array_length(result_rows)>20000 then
    return jsonb_build_object('allowed',true,'over_limit',true); end if;
  select coalesce(jsonb_agg(jsonb_build_object('live','live:'||live_id,'history','history:'||history_id,
    'liveFingerprint',live_fingerprint,'historyFingerprint',history_fingerprint,'revision',revision)
    order by live_id),'[]'::jsonb) into links from private.ai_lease_verified_duplicates;
  return jsonb_build_object('allowed',true,'version','lease-research/1',
    'permission_revision',encode(sha256(convert_to(jsonb_build_array(a->>'permission_revision',to_jsonb(g))::text,'UTF8')),'hex'),
    'sources',to_jsonb(g.sources),'details',g.allow_details,'financials',g.allow_financials,'export',g.allow_export,
    'minGroupSize',g.min_group_size,'rows',result_rows,'links',links);
end $$;
create function public.ai_lease_research_snapshot(p_actor uuid,p_effective uuid,p_session uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.ai_lease_research_snapshot(p_actor,p_effective,p_session);
$$;
revoke all on function private.ai_lease_research_snapshot(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.ai_lease_research_snapshot(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.ai_lease_research_snapshot(uuid,uuid,uuid) to service_role;
grant execute on function public.ai_lease_research_snapshot(uuid,uuid,uuid) to service_role;
comment on function public.ai_lease_research_snapshot(uuid,uuid,uuid) is 'Service-only AI lease research, separate explicit grant, current admin session, bounded projection; no tenant/broker data.';
commit;
