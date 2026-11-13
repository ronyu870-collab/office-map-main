begin;
-- Extend only the read-only leasing timeline. Preserve review snapshots and fingerprints.
create function private.lease_expiry_context_list(p_actor uuid,p_as_of date,p_page integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare base jsonb; enriched jsonb;
begin
 base:=private.lease_expiry_list_v2(p_actor,p_as_of,p_page,'','window');
 select coalesce(jsonb_agg(e.item || jsonb_build_object('details',jsonb_build_object(
  'area_sqm',v.area_sqm,'industry',v.industry,'sub_industry',v.sub_industry,'sub_market',v.sub_market
 )) order by e.ord),'[]'::jsonb) into enriched
 from jsonb_array_elements(base->'items') with ordinality e(item,ord)
 left join public.lease_transactions_read_v1 v on v.source_record_id=(e.item->'source'->>'id')::uuid and v.record_source=e.item->>'source_kind';
 return jsonb_set(base,'{items}',enriched);
end; $$;
create function public.lease_expiry_context_list(p_actor uuid,p_as_of date,p_page integer default 1)
returns jsonb language sql security invoker set search_path='' as $$ select private.lease_expiry_context_list(p_actor,p_as_of,p_page); $$;
revoke all on function private.lease_expiry_context_list(uuid,date,integer),public.lease_expiry_context_list(uuid,date,integer) from public,anon,authenticated,service_role;
grant execute on function private.lease_expiry_context_list(uuid,date,integer),public.lease_expiry_context_list(uuid,date,integer) to service_role;
notify pgrst,'reload schema';
commit;
