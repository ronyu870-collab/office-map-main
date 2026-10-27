begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- ACL-only repair: no function body, table policy, trigger or row changes.
-- Preserve every explicit grant (including existing anon/service_role grants).
-- Refuse unknown definitions instead of revoking permissions on an unseen RPC.
do $guard$
declare
  item record;
  target oid;
begin
  for item in select * from (values
    ('public.feedback_admin_reply(uuid,text,text[],text)', '3fa220f9d33a9c29ec7344b25489fdfe'),
    ('public.feedback_comment_touch_activity()', 'da7bad17165348cc4e55c687ede6e573'),
    ('public.feedback_mark_read(uuid)', '782c7c2d4cf51dd8309c0ea4ba99b7db'),
    ('public.feedback_prepare_status_change()', 'f2d1e520da7d4c3d0a02e3f5b0cad309'),
    ('public.feedback_record_status_change()', '7f52553dc314d540b533e3bbf3eb6428'),
    ('public.feedback_reopen(uuid,text)', '7b1deb77315dd5871fcf0d8b272bf902'),
    ('private.audit_lease_transaction_update()', 'f11e9a54ba46d8badb4e2555b81a32f4'),
    ('private.fill_update_draft_identity_period()', 'b802b03c1908371bad50bb62419df238'),
    ('private.handle_new_user()', '2d990138af2b0fccf909290a4c2cfa3a')
  ) expected(signature, body_md5)
  loop
    target := to_regprocedure(item.signature);
    if target is null or not exists (
      select 1 from pg_proc p
      where p.oid=target and p.prosecdef and p.prokind='f'
        and pg_get_userbyid(p.proowner)='postgres'
        and md5(p.prosrc)=item.body_md5
    ) then
      raise exception 'Backup permission precondition failed: %', item.signature;
    end if;
    -- These RPCs are explicitly granted to the application in the legacy
    -- migration. A PUBLIC-only grant is insufficient for compatibility.
    if item.signature in (
      'public.feedback_admin_reply(uuid,text,text[],text)',
      'public.feedback_mark_read(uuid)', 'public.feedback_reopen(uuid,text)'
    ) and not exists (
      select 1 from pg_proc p, lateral aclexplode(p.proacl) a
      where p.oid=target and a.grantee='authenticated'::regrole
        and a.privilege_type='EXECUTE'
    ) then
      raise exception 'Application EXECUTE grant missing: %', item.signature;
    end if;
    execute format('revoke execute on function %s from public', target::regprocedure);
  end loop;
end;
$guard$;

commit;
