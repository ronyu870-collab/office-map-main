begin;

insert into public.lease_building_name_map(
  market_code,alias_name,building_id,match_method,verification_status
)
values('BJ','启达北旺','fd705f4a-558b-49cc-9358-be992c944b21','former_name','AUTO_VERIFIED')
on conflict (market_code,alias_name) do nothing;

update public.buildings
set former_names = case
  when jsonb_typeof(former_names)='array' and not former_names ? '启达北旺'
    then former_names || '["启达北旺"]'::jsonb
  else former_names
end
where id='fd705f4a-558b-49cc-9358-be992c944b21';

update public.lease_building_alias_review
set resolution_status='AUTO_VERIFIED',
    matched_building_id='fd705f4a-558b-49cc-9358-be992c944b21',
    matched_building_name='启达北旺中心',
    resolution_basis='VERIFIED_REFERENCE_ABBREVIATION',
    confidence='ABSOLUTE',
    candidate_count=1,
    review_notes=case
      when coalesce(review_notes,'') like '%verified reference abbreviation: 启达北旺→启达北旺中心%' then review_notes
      else concat_ws(' | ',nullif(review_notes,''),'2026-09-22 verified reference abbreviation: 启达北旺→启达北旺中心')
    end,
    resolved_at=coalesce(resolved_at,now()),
    updated_at=now()
where historical_name='启达北旺';

do $$
declare v_ref integer; v_unmapped integer;
begin
  select count(*) into v_ref
  from public.lease_transactions_read_v1
  where record_source='history' and building_match_scope='reference' and trim(new_building)='启达北旺';

  select count(*) into v_unmapped
  from public.lease_transactions_read_v1
  where record_source='history' and building_match_scope='unmapped' and trim(new_building)='启达北旺';

  if v_ref<>2 or v_unmapped<>0 then
    raise exception 'qida postcondition reference/unmapped=%/% expected 2/0',v_ref,v_unmapped;
  end if;
end $$;

commit;
