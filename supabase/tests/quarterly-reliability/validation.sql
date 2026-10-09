-- This stage follows regression.sql, which leaves the current period at 2026 Q4.
select set_config('test.user_id', '11111111-1111-4111-8111-111111111111', false);
select set_config('test.can_write', 'true', false);
create function pg_temp.expect_rejection(r jsonb, f jsonb, tab text, expected_state text)
returns void language plpgsql as $$
begin
  begin
    perform public.submit_quarterly_batch_v2(gen_random_uuid(), auth.uid(), 'Synthetic owner', 2026, 4, tab, r, f);
    raise exception 'invalid submission unexpectedly accepted';
  exception when others then
    if sqlstate <> expected_state then raise; end if;
  end;
end $$;

do $$
declare
  r jsonb := '{"building_id":"33333333-3333-4333-8333-333333333333"}';
  f jsonb := '{"future_supply_id":"55555555-5555-4555-8555-555555555555"}';
  bad jsonb;
  receipt record;
  original record;
  regular_before bigint;
  future_before bigint;
  provenance_before bigint;
begin
  select count(*) into regular_before from public.quarterly_submissions;
  select count(*) into future_before from public.future_supply_submissions;
  select count(*) into provenance_before from public.quarterly_submission_provenance;
  foreach bad in array array[
    '{"asking_rent":"12junk"}'::jsonb, '{"asking_rent":"NaN"}',
    '{"asking_rent":"Infinity"}', '{"asking_rent":true}', '{"asking_rent":{}}',
    '{"asking_rent":""}', '{"asking_rent":"1e999999"}',
    '{"total_area":-1}', '{"vacant_area":-1}', '{"vacancy_rate":-1}',
    '{"asking_rent":-1}', '{"management_fee":-1}', '{"face_rent":-1}',
    '{"net_effective_rent":-1}', '{"rent_free_period":-1}',
    '{"rent_free_period":36.01}', '{"vacancy_rate":100.01}',
    '{"vacant_area":1,"total_area":0}', '{"vacant_area":101,"total_area":100}'
  ] loop
    perform pg_temp.expect_rejection(jsonb_build_array(r || bad), '[]', 'GradeA', '22023');
    perform pg_temp.expect_rejection('[]', jsonb_build_array(f || bad), 'GradeA', '22023');
  end loop;
  perform pg_temp.expect_rejection(jsonb_build_array(r, r), '[]', 'GradeA', '22023');
  perform pg_temp.expect_rejection('[]', jsonb_build_array(f, f), 'GradeA', '22023');
  perform pg_temp.expect_rejection('[{}]', '[]', 'GradeA', '22023');
  perform pg_temp.expect_rejection('[]', '[{"future_supply_id":"bad-id"}]', 'GradeA', '22023');
  perform pg_temp.expect_rejection('{}', '[]', 'GradeA', '22023');
  perform pg_temp.expect_rejection(jsonb_build_array(r), '[]', 'GradeB', '42501');
  perform pg_temp.expect_rejection('[]', jsonb_build_array(f), 'GradeB', '42501');
  update public.building_assignments set user_id = '22222222-2222-4222-8222-222222222222';
  perform pg_temp.expect_rejection(jsonb_build_array(r), '[]', 'GradeA', '42501');
  update public.building_assignments set user_id = auth.uid()::text;
  update public.future_supply_assignments set record_quarter = 2 where record_quarter = 4;
  perform pg_temp.expect_rejection('[]', jsonb_build_array(f), 'GradeA', '42501');
  update public.future_supply_assignments set record_quarter = 4 where record_quarter = 2;
  update public.future_supply_assignments set user_id = '22222222-2222-4222-8222-222222222222' where record_quarter = 4;
  perform pg_temp.expect_rejection('[]', jsonb_build_array(f), 'GradeA', '42501');
  update public.future_supply_assignments set user_id = auth.uid() where record_quarter = 4;
  update public.future_supplies set is_entered_market = true where id = (f->>'future_supply_id')::uuid;
  perform pg_temp.expect_rejection('[]', jsonb_build_array(f), 'GradeA', '42501');

  -- Committed receipt acknowledgement survives later assignment/category/status changes.
  update public.buildings set grade = 'BP';
  delete from public.building_assignments;
  select * into original from private.quarterly_submission_requests where request_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select * into receipt from public.submit_quarterly_batch_v2(original.request_id, auth.uid(),
    original.payload->>'user_name', 2026, 3, 'GradeA',
    original.payload->'regular_rows', original.payload->'future_rows');
  assert receipt.submitted_at = original.submitted_at, 'assignment change blocked committed replay';
  insert into public.building_assignments(building_id, user_id, project_name, user_name)
  values ((r->>'building_id')::uuid, auth.uid()::text, 'Synthetic building', 'Synthetic owner');
  update public.buildings set grade = 'A';
  update public.future_supplies set is_entered_market = false where id = (f->>'future_supply_id')::uuid;
  assert (select count(*) = regular_before from public.quarterly_submissions), 'rejected regular rows leaked';
  assert (select count(*) = future_before from public.future_supply_submissions), 'rejected future rows leaked';
  assert (select count(*) = provenance_before from public.quarterly_submission_provenance), 'rejected provenance leaked';

  -- Explicit incomplete submissions and legitimate zero values remain supported.
  perform public.submit_quarterly_batch_v2(gen_random_uuid(), auth.uid(), 'Synthetic owner', 2026, 4, 'GradeA',
    jsonb_build_array(r || '{"total_area":null,"vacant_area":null,"asking_rent":null}'::jsonb),
    jsonb_build_array(f || '{"total_area":0,"vacant_area":0,"vacancy_rate":0,"asking_rent":0,"rent_free_period":0}'::jsonb));
  assert exists(select 1 from public.quarterly_submissions where record_quarter = 4 and total_area is null), 'unknown area was manufactured';
  assert exists(select 1 from public.future_supply_submissions where record_quarter = 4 and total_area = 0), 'zero area was lost';
  perform public.submit_quarterly_batch_v2(gen_random_uuid(), auth.uid(), 'Synthetic owner', 2026, 4, 'GradeA',
    jsonb_build_array(r || '{"total_area":"100","vacant_area":"100","vacancy_rate":100,"rent_free_period":36}'::jsonb), '[]');
  assert (select count(*) = provenance_before + 3 from public.quarterly_submission_provenance), 'new-row provenance missing';

  assert not exists(
    select 1 from public.quarterly_submission_provenance p
    left join public.quarterly_submissions s on p.entity_kind = 'regular' and s.id = p.submission_id
    left join public.future_supply_submissions f on p.entity_kind = 'future' and f.id = p.submission_id
    where (p.entity_kind = 'regular' and (s.id is null or s.building_id <> p.entity_id))
      or (p.entity_kind = 'future' and (f.id is null or f.future_supply_id <> p.entity_id))
  ), 'provenance does not identify exact formal submission';
  assert private.quarterly_category_for_grade('P') = 'GradeA';
  assert private.quarterly_category_for_grade(null) = 'GradeA';
  assert private.quarterly_category_for_grade(' B+ ') = 'GradeB';
  assert private.quarterly_category_for_grade('business park') = 'BP';
end $$;
set role authenticated;
do $$ declare receipt record; begin
  select * into receipt from public.submit_quarterly_batch(auth.uid(), 'Synthetic authenticated caller', 2026, 4, 'GradeA',
    '[{"building_id":"33333333-3333-4333-8333-333333333333"}]', '[]');
  assert receipt.regular_count = 1 and receipt.future_count = 0, 'authenticated legacy signature failed';
  assert (select count(*) > 0 from public.quarterly_submission_provenance), 'owner provenance unavailable';
  assert not has_table_privilege(current_user, 'public.quarterly_submission_provenance', 'INSERT'), 'client can fabricate provenance';
end $$;
select set_config('test.user_id', '22222222-2222-4222-8222-222222222222', false);
do $$ begin
  assert (select count(*) = 0 from public.quarterly_submission_provenance), 'other owner provenance leaked';
end $$;
reset role;

-- An administrator can open a future quarter before its calendar start. An
-- explicit save is current for that configured period regardless of wall time.
select set_config('test.user_id', '11111111-1111-4111-8111-111111111111', false);
select set_config('test.is_admin', 'true', false);
do $$
declare
  expected bigint;
begin
  perform public.set_current_submission_period_v2(2100, 1);
  select revision into expected from public.update_drafts where user_id = auth.uid() and tab = 'GradeA';
  perform public.save_quarterly_draft_v2(auth.uid(), 'Synthetic owner', 2100, 1, 'GradeA', '{"early":1}', expected);
  assert exists(select 1 from public.update_drafts
    where user_id = auth.uid() and tab = 'GradeA' and record_year = 2100
      and record_quarter = 1 and (draft_data#>>'{__quarterly_meta__,revision}')::bigint = revision
      and (draft_data#>>'{__quarterly_meta__,year}')::integer = record_year
      and (draft_data#>>'{__quarterly_meta__,quarter}')::integer = record_quarter and updated_at < '2100-01-01'::timestamptz),
    'early configured-period save not confirmed';
  perform public.save_quarterly_draft_v2(auth.uid(), 'Synthetic owner', 2100, 1, 'BP', '{"early_insert":1}', 0);
  assert exists(select 1 from public.update_drafts
    where user_id = auth.uid() and tab = 'BP' and (draft_data#>>'{__quarterly_meta__,revision}')::bigint = revision), 'new draft insert not confirmed';
end $$;
