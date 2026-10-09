select set_config('test.user_id', '11111111-1111-4111-8111-111111111111', false);
select set_config('test.can_write', 'true', false);
select set_config('test.is_admin', 'true', false);

do $$
declare
  u uuid := '11111111-1111-4111-8111-111111111111';
  request uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  rows jsonb := '[{"building_id":"33333333-3333-4333-8333-333333333333","total_area":100}]';
  future jsonb := '[{"future_supply_id":"55555555-5555-4555-8555-555555555555","total_area":200}]';
  first_result record;
  retried_result record;
  saved record;
  rolled record;
begin
  assert (select count(*) = 1 from public.quarterly_draft_history where event = 'baseline'), 'baseline archive missing';
  assert (select bool_and(not (draft_data ? '__quarterly_meta__')) from public.update_drafts), 'historical drafts marked confirmed during migration';
  insert into public.update_drafts(user_name, record_year, record_quarter, tab, draft_data)
  values ('Synthetic legacy insert', null, null, 'GradeB', '{"legacy":1}');
  assert exists(select 1 from public.quarterly_draft_history
    where event = 'INSERT' and user_id = u and snapshot->>'user_id' = u::text
      and snapshot->>'record_year' = '2026' and snapshot->>'record_quarter' = '3'
      and ((snapshot->'draft_data') - '__quarterly_meta__') = '{"legacy":1}'::jsonb), 'insert archived before identity filled';
  select * into saved from public.save_quarterly_draft_v2(u, 'Synthetic owner', 2026, 3, 'GradeA', '{"new":43}', 1);
  assert saved.revision = 2, 'revision was not incremented';
  assert (select (draft_data#>>'{__quarterly_meta__,revision}')::bigint = revision from public.update_drafts where tab = 'GradeA'), 'guarded save did not confirm period';
  assert exists(select 1 from public.quarterly_draft_history where event = 'UPDATE' and ((snapshot->'draft_data') - '__quarterly_meta__') = '{"old":42}'::jsonb), 'old draft not preserved';
  begin
    perform public.save_quarterly_draft_v2(u, 'Synthetic owner', 2026, 3, 'GradeA', '{}', 1);
    raise exception 'stale revision unexpectedly accepted';
  exception when serialization_failure then null;
  end;
  perform public.save_quarterly_draft_v2(u, 'Synthetic owner', 2026, 3, 'BP', '{"bp":1}', 0);
  begin
    perform public.save_quarterly_draft_v2(u, 'Synthetic owner', 2026, 3, 'BP', '{}', 0);
    raise exception 'empty-tab stale writer unexpectedly accepted';
  exception when serialization_failure then null;
  end;

  select * into first_result from public.submit_quarterly_batch_v2(request, u, 'Synthetic owner', 2026, 3, 'GradeA', rows, future);
  select * into retried_result from public.submit_quarterly_batch_v2(request, u, 'Synthetic owner', 2026, 3, 'GradeA', rows, future);
  assert (select count(*) = 2 from public.quarterly_submission_provenance where source = 'user_confirmed_submission'), 'new submissions missing provenance';
  assert first_result.regular_count = 1 and first_result.future_count = 1, 'batch counts wrong';
  assert first_result is not distinct from retried_result, 'retry result changed';
  assert (select count(*) = 1 from public.quarterly_submissions), 'regular retry duplicated';
  assert (select count(*) = 1 from public.future_supply_submissions), 'future retry duplicated';
  begin
    perform public.submit_quarterly_batch_v2(request, u, 'Synthetic owner', 2026, 3, 'GradeA', '[]', future);
    raise exception 'changed payload accepted for same request';
  exception when invalid_parameter_value then
    assert sqlerrm = 'submission_request_payload_mismatch', 'wrong changed-payload error';
  end;
  begin
    perform public.submit_quarterly_batch_v2(null, u, 'Synthetic owner', 2026, 3, 'GradeA', rows, future);
    raise exception 'missing request ID accepted';
  exception when invalid_parameter_value then
    assert sqlerrm = 'submission_request_id_required', 'wrong missing-ID error';
  end;
  begin
    perform public.submit_quarterly_batch_v2(request, u, 'Synthetic owner', null, 3, 'GradeA', rows, future);
    raise exception 'null period accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.save_quarterly_draft_v2(u, 'Synthetic owner', 2026, null, 'GradeA', '{}', 2);
    raise exception 'null draft period accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.submit_quarterly_batch_v2('cccccccc-cccc-4ccc-8ccc-cccccccccccc', u, 'Synthetic owner', 2026, 3, null, rows, future);
    raise exception 'null tab accepted';
  exception when invalid_parameter_value then null;
  end;
  -- A failed second leg must roll back the first leg and its request ledger.
  begin
    perform public.submit_quarterly_batch_v2('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', u, 'Synthetic owner', 2026, 3, 'GradeA', rows, '[{"future_supply_id":"55555555-5555-4555-8555-555555555555","notes":"synthetic_failure"}]');
    raise exception 'invalid future row unexpectedly accepted';
  exception when check_violation then null;
  end;
  assert (select count(*) = 1 from public.quarterly_submissions), 'partial regular insert survived failure';
  assert (select count(*) = 1 from private.quarterly_submission_requests), 'failed request persisted';
  assert (select count(*) = 2 from public.quarterly_submission_provenance), 'failed request provenance persisted';

  perform set_config('test.can_write', 'false', false);
  begin
    perform public.submit_quarterly_batch_v2(request, u, 'Synthetic owner', 2026, 3, 'GradeA', rows, future);
    raise exception 'viewer replay bypassed guard';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_quarterly_draft_v2(u, 'Synthetic owner', 2026, 3, 'GradeA', '{}', 2);
    raise exception 'viewer draft write accepted';
  exception when insufficient_privilege then null;
  end;
  perform set_config('test.can_write', 'true', false);
  begin
    perform public.submit_quarterly_batch_v2(request, '22222222-2222-4222-8222-222222222222', 'Other', 2026, 3, 'GradeA', rows, future);
    raise exception 'cross-user submission accepted';
  exception when insufficient_privilege then null;
  end;

  perform set_config('test.is_admin', 'false', false);
  begin
    perform public.set_current_submission_period_v2(2026, 4);
    raise exception 'non-admin rollover accepted';
  exception when insufficient_privilege then null;
  end;
  perform set_config('test.is_admin', 'true', false);
  begin
    perform public.set_current_submission_period_v2(null, 4);
    raise exception 'null rollover year accepted';
  exception when invalid_parameter_value then null;
  end;
  select * into rolled from public.set_current_submission_period_v2(2026, 4);
  assert rolled.drafts_rolled = 0, 'drafts were rolled';
  assert rolled.future_assignments_created = 2, 'rollover assignment count wrong';
  assert not exists(select 1 from public.future_supply_assignments
    where record_quarter = 4 and future_supply_id = '66666666-6666-4666-8666-666666666666'),
    'entered-market supply assignment rolled forward';
  assert (select count(*) = 2 from public.future_supply_assignments where record_quarter = 4),
    'eligible supply assignments missing';
  assert (select bool_and(record_quarter = 3) from public.update_drafts), 'old period overwritten';
  assert (select not (draft_data ? '__quarterly_meta__') from public.update_drafts where tab = 'GradeB'), 'rollover certified legacy draft';
  assert (select (draft_data - '__quarterly_meta__') = '{"new":43}'::jsonb from public.update_drafts where tab = 'GradeA'), 'rollover changed payload';
  select * into retried_result from public.submit_quarterly_batch_v2(request, u, 'Synthetic owner', 2026, 3, 'GradeA', rows, future);
  assert first_result is not distinct from retried_result, 'committed replay lost after rollover';
  assert (select count(*) = 1 from public.quarterly_submissions), 'post-rollover replay inserted rows';
  begin
    perform public.submit_quarterly_batch_v2('dddddddd-dddd-4ddd-8ddd-dddddddddddd', u, 'Synthetic owner', 2026, 3, 'GradeA', rows, future);
    raise exception 'new old-period request accepted';
  exception when invalid_parameter_value then
    assert sqlerrm = 'submission_period_changed', 'wrong period guard error';
  end;
  perform public.save_quarterly_draft_v2(u, 'Synthetic owner', 2026, 4, 'GradeA', '{"quarter4":44}', 2);
  assert exists(select 1 from public.quarterly_draft_history where snapshot->>'record_quarter' = '3' and ((snapshot->'draft_data') - '__quarterly_meta__') = '{"new":43}'::jsonb), 'old-quarter evidence missing';

  delete from public.update_drafts where tab = 'BP';
  assert exists(select 1 from public.quarterly_draft_history where event = 'DELETE' and ((snapshot->'draft_data') - '__quarterly_meta__') = '{"bp":1}'::jsonb), 'delete evidence missing';
  begin
    delete from public.quarterly_draft_history;
    raise exception 'append-only history deleted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.quarterly_draft_history set snapshot = '{}';
    raise exception 'append-only history changed';
  exception when insufficient_privilege then null;
  end;
  begin
    truncate public.quarterly_draft_history;
    raise exception 'append-only history truncated';
  exception when insufficient_privilege then null;
  end;
end $$;

-- RLS: own history only, and no client DML or anonymous RPC access.
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
set role authenticated;
do $$ begin
  assert (select count(*) > 0 from public.quarterly_draft_history), 'owner cannot read history';
end $$;
select set_config('test.user_id', '22222222-2222-4222-8222-222222222222', false);
do $$ begin
  assert (select count(*) = 0 from public.quarterly_draft_history), 'other owner history leaked';
  assert not has_table_privilege(current_user, 'public.quarterly_draft_history', 'INSERT'), 'client can forge history';
  assert not has_table_privilege(current_user, 'public.quarterly_draft_history', 'UPDATE'), 'client can overwrite history';
end $$;
reset role;
do $$ begin
  assert not has_function_privilege('anon', 'public.submit_quarterly_batch_v2(uuid,uuid,text,integer,integer,text,jsonb,jsonb)', 'EXECUTE'), 'anonymous RPC exposed';
end $$;
