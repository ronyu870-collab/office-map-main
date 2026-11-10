begin;

-- One extra character lets the list tell a complete short notice from a preview.
create function public.notice_content_preview(entry public.notices)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select pg_catalog.left(entry.content, 161);
$$;

revoke all on function public.notice_content_preview(public.notices) from public, anon, service_role;
grant execute on function public.notice_content_preview(public.notices) to authenticated;

notify pgrst, 'reload schema';

commit;
