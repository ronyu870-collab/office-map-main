begin;

-- Keep the acknowledgement before the timeline read, just as the existing
-- client does. A failed timeline query rolls back the acknowledgement too.
-- The invoker still reads both relations through their existing RLS policies.
create function public.feedback_open_thread(p_issue_id uuid)
returns table (read_at timestamptz, comment jsonb, comment_created_at timestamptz)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  perform public.feedback_mark_read(p_issue_id);

  return query
  select receipt.last_read_at, to_jsonb(item), item.created_at
  from public.admin_issue_reads receipt
  left join lateral (
    select c.id, c.issue_id, c.content, c.images, c.created_by,
           c.is_admin, c.created_at, c.kind, c.metadata
    from public.admin_issue_comments c
    where c.issue_id = receipt.issue_id
  ) item on true
  where receipt.issue_id = p_issue_id and receipt.user_id = (select auth.uid())
  order by item.created_at;
end;
$$;

revoke all on function public.feedback_open_thread(uuid) from public, anon, service_role;
grant execute on function public.feedback_open_thread(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
