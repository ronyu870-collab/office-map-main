begin;

-- A result receipt is private evidence, not a second lease dataset. No business
-- record or existing policy is rewritten by this additive migration.
create table private.lease_transfer_requests (
  actor_id uuid not null,
  request_id uuid not null,
  submission_id uuid not null,
  target_user_id uuid not null,
  expected_submitter_id text,
  expected_updated_at timestamptz,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, request_id)
);
alter table private.lease_transfer_requests enable row level security;
revoke all on private.lease_transfer_requests from public, anon, authenticated, service_role;

-- This API is deliberately server-only: the HTTP route verifies the caller's
-- JWT and simulation context before supplying p_actor_id. EXECUTE is not granted
-- to browser roles. Definer rights are necessary to lock Auth/profile rows and
-- perform an authorised reassignment that ordinary owner RLS correctly forbids.
-- https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker
create function public.transfer_lease_submission_v1(
  p_request_id uuid,
  p_actor_id uuid,
  p_submission_id uuid,
  p_target_user_id uuid,
  p_expected_submitter_id text,
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '2s'
as $$
declare
  v_actor_role text;
  v_actor_banned_until timestamptz;
  v_actor_deleted_at timestamptz;
  v_actor_found boolean := false;
  v_target_found boolean := false;
  v_identity record;
  v_target_role text;
  v_target_chinese_name text;
  v_target_full_name text;
  v_target_email text;
  v_target_banned_until timestamptz;
  v_target_deleted_at timestamptz;
  v_before public.lease_transactions%rowtype;
  v_after public.lease_transactions%rowtype;
  v_receipt private.lease_transfer_requests%rowtype;
  v_target_name text;
  v_previous_sub text;
  v_result jsonb;
  v_transferred_at timestamptz;
begin
  if p_request_id is null or p_actor_id is null or p_submission_id is null or p_target_user_id is null then
    raise exception using errcode='22023', message='INVALID_TRANSFER_REQUEST';
  end if;

  -- Use a separate namespaced key; never reuse quarterly operation lock keys.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'lease-transfer:' || p_actor_id::text || ':' || p_request_id::text, 0));

  -- Read qualification FROM the rows being locked, in a stable order. A later
  -- unlocked SELECT could see a profile inserted after the original snapshot,
  -- use it without a SHARE lock and race a role/status change. Missing identities
  -- stay missing for this request; a new request can be made after a refresh.
  for v_identity in
    select r.user_id,r.role,r.chinese_name,r.full_name,r.email,u.banned_until,u.deleted_at
      from public.user_roles r join auth.users u on u.id=r.user_id
      where r.user_id in (p_actor_id,p_target_user_id)
      order by r.user_id for share of r,u
  loop
    if v_identity.user_id=p_actor_id then
      v_actor_found := true;
      v_actor_role := v_identity.role;
      v_actor_banned_until := v_identity.banned_until;
      v_actor_deleted_at := v_identity.deleted_at;
    end if;
    if v_identity.user_id=p_target_user_id then
      v_target_found := true;
      v_target_role := v_identity.role;
      v_target_chinese_name := v_identity.chinese_name;
      v_target_full_name := v_identity.full_name;
      v_target_email := v_identity.email;
      v_target_banned_until := v_identity.banned_until;
      v_target_deleted_at := v_identity.deleted_at;
    end if;
  end loop;
  if not v_actor_found or coalesce(v_actor_role,'') not in ('editor','admin')
      or v_actor_deleted_at is not null
      or v_actor_banned_until > pg_catalog.statement_timestamp() then
    raise exception using errcode='42501', message='TRANSFER_ACTOR_FORBIDDEN';
  end if;

  select * into v_receipt from private.lease_transfer_requests r
    where r.actor_id=p_actor_id and r.request_id=p_request_id;
  if found then
    if v_receipt.submission_id is distinct from p_submission_id
       or v_receipt.target_user_id is distinct from p_target_user_id
       or v_receipt.expected_submitter_id is distinct from p_expected_submitter_id
       or v_receipt.expected_updated_at is distinct from p_expected_updated_at then
      raise exception using errcode='22023', message='REQUEST_PAYLOAD_MISMATCH';
    end if;
    -- A receipt acknowledges this request; it does not claim to be the record's
    -- current owner if a subsequent legitimate operation changed it again.
    return v_receipt.result || pg_catalog.jsonb_build_object('replayed', true);
  end if;

  if not v_target_found or v_target_role is distinct from 'editor'
      or v_target_chinese_name is null or v_target_chinese_name='测试账号'
      or v_target_email is null or v_target_deleted_at is not null
      or v_target_banned_until > pg_catalog.statement_timestamp() then
    raise exception using errcode='22023', message='TRANSFER_TARGET_INVALID';
  end if;
  v_target_name := coalesce(nullif(pg_catalog.btrim(v_target_full_name),''), nullif(pg_catalog.btrim(v_target_chinese_name),''), p_target_user_id::text);

  select * into v_before from public.lease_transactions t
    where t.id=p_submission_id for update;
  if not found then
    raise exception using errcode='P0002', message='TRANSFER_RECORD_NOT_FOUND';
  end if;
  if v_actor_role <> 'admin' and v_before.submitter_id is distinct from p_actor_id::text then
    raise exception using errcode='42501', message='TRANSFER_OWNER_FORBIDDEN';
  end if;
  if v_before.submitter_id is distinct from p_expected_submitter_id
     or v_before.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode='40001', message='STALE_RECORD';
  end if;
  if v_before.submitter_id is not distinct from p_target_user_id::text then
    raise exception using errcode='22023', message='TRANSFER_SAME_OWNER';
  end if;

  -- Keep the pre-existing UPDATE audit trigger and attribute it to the verified
  -- human actor rather than the server's service token. Restore the local claim
  -- so a caller's later statements cannot inherit this identity accidentally.
  v_previous_sub := pg_catalog.current_setting('request.jwt.claim.sub', true);
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor_id::text, true);
  update public.lease_transactions set
    submitter_id=p_target_user_id::text, submitter_name=v_target_name
    where id=p_submission_id returning * into v_after;
  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(v_previous_sub,''), true);
  v_transferred_at := pg_catalog.clock_timestamp();

  -- Explicit transfer evidence, trigger evidence, business row and receipt all
  -- commit together. Any insert/trigger error aborts the entire operation.
  insert into public.audit_logs (
    user_id, action_type, details, request_source, module,
    target_table, target_id, target_name, old_values, new_values, event_id, occurred_at
  ) values (
    p_actor_id::text, 'TRANSFER_SUBMISSION',
    pg_catalog.jsonb_build_object(
      'record_id', p_submission_id, 'request_id', p_request_id,
      'original_submitter_id', v_before.submitter_id, 'original_submitter_name', v_before.submitter_name,
      'target_user_id', p_target_user_id, 'target_user_name', v_target_name),
    'server_rpc', 'lease-submission', 'lease_transactions', p_submission_id::text,
    pg_catalog.concat_ws(' · ', nullif(v_before.company,''), nullif(v_before.new_building,'')),
    pg_catalog.jsonb_build_object('submitter_id',v_before.submitter_id,'submitter_name',v_before.submitter_name),
    pg_catalog.jsonb_build_object('submitter_id',v_after.submitter_id,'submitter_name',v_after.submitter_name),
    'lease-transfer:' || p_actor_id::text || ':' || p_request_id::text, v_transferred_at
  );
  v_result := pg_catalog.jsonb_build_object(
    'requestId',p_request_id,'submissionId',p_submission_id,
    'targetUserId',p_target_user_id,'targetUserName',v_target_name,
    'updatedAt',v_after.updated_at,'transferredAt',v_transferred_at,'replayed',false);
  insert into private.lease_transfer_requests (
    actor_id,request_id,submission_id,target_user_id,expected_submitter_id,expected_updated_at,result
  ) values (p_actor_id,p_request_id,p_submission_id,p_target_user_id,p_expected_submitter_id,p_expected_updated_at,v_result);
  return v_result;
end;
$$;
revoke all on function public.transfer_lease_submission_v1(uuid,uuid,uuid,uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.transfer_lease_submission_v1(uuid,uuid,uuid,uuid,text,timestamptz) to service_role;

commit;
