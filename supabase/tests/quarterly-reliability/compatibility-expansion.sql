-- Exact function-body preservation, not merely a compatible signature.
begin;
select set_config('test.user_id', '11111111-1111-4111-8111-111111111111', true);
select set_config('test.can_write', 'true', true);
select set_config('test.is_admin', 'true', true);
do $$ declare saved record; data jsonb; rev bigint; existing_row jsonb; history_count bigint; begin
  assert not exists(select 1 from public.test_legacy_rpc_definitions d
    where d.definition is distinct from pg_get_functiondef(d.signature::regprocedure)),
    'expansion changed a legacy RPC';
  assert not exists(select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'update_drafts' and column_name = 'period_confirmed'),
    'expansion altered draft columns';
  assert not (select quarter_configuration_frozen from private.quarterly_rollout_control where singleton),
    'expansion unexpectedly froze configuration';
  -- Preserve the pre-existing display-name uniqueness constraint; report its
  -- conflict rather than silently merging two owners or rewriting a draft.
  select to_jsonb(d) into existing_row from public.update_drafts d where tab = 'GradeA';
  select count(*) into history_count from public.quarterly_draft_history;
  perform set_config('test.user_id', '22222222-2222-4222-8222-222222222222', true);
  begin
    perform public.save_quarterly_draft_v2(auth.uid(), 'Synthetic owner', 2026, 3, 'GradeA', '{"other_owner":1}', 0);
    raise exception 'v2 same-display-name owner conflict was swallowed';
  exception when unique_violation then null;
  end;
  begin
    perform public.save_quarterly_draft(auth.uid(), 'Synthetic owner', 2026, 3, 'GradeA', '{"other_owner":2}', 0);
    raise exception 'legacy same-display-name owner conflict was swallowed';
  exception when unique_violation then null;
  end;
  assert not exists(select 1 from public.update_drafts where user_id = auth.uid()), 'conflicting owner draft leaked';
  assert (select to_jsonb(d) = existing_row from public.update_drafts d where tab = 'GradeA'), 'existing owner draft changed';
  assert (select count(*) = history_count from public.quarterly_draft_history), 'failed same-name write left partial archive';
  perform set_config('test.user_id', '11111111-1111-4111-8111-111111111111', true);
  -- Legacy force-submit values remain accepted until the approved cutover.
  perform public.submit_quarterly_batch(auth.uid(), 'Legacy', 2026, 3, 'GradeA',
    '[{"building_id":"33333333-3333-4333-8333-333333333333","asking_rent":-1}]', '[]');
  assert exists(select 1 from public.quarterly_submissions where asking_rent = -1), 'legacy behavior changed';
  assert (select count(*) = 0 from public.quarterly_submission_provenance), 'legacy write retroclassified';
  select * into saved from public.save_quarterly_draft_v2(auth.uid(), 'Owner', 2026, 3, 'GradeA', '{"v2":1}', 1);
  select draft_data into data from public.update_drafts where tab = 'GradeA';
  perform public.save_quarterly_draft(auth.uid(), 'Owner', 2026, 3, 'GradeA', data, saved.revision);
  assert exists(select 1 from public.update_drafts where tab = 'GradeA'
    and (draft_data#>>'{__quarterly_meta__,revision}')::bigint <> revision), 'legacy write left marker valid';
  select revision into rev from public.update_drafts where tab = 'GradeA';
  perform public.save_quarterly_draft_v2(auth.uid(), 'Owner', 2026, 3, 'GradeA', data, rev);
  perform public.set_current_submission_period(2026, 4);
  assert exists(select 1 from public.update_drafts where tab = 'GradeA'
    and (draft_data#>>'{__quarterly_meta__,quarter}')::integer <> record_quarter), 'legacy relabel left marker valid';
end $$;
rollback;
