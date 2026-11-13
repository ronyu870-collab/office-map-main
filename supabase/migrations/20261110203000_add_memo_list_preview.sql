begin;

-- PostgREST computed field: the list gets a preview without changing the row,
-- write contract, or the row-level policies that protect the memo itself.
create function public.memo_content_preview(memo_row public.memos)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select pg_catalog.left(memo_row.content, 100);
$$;

revoke all on function public.memo_content_preview(public.memos) from public, anon;
grant execute on function public.memo_content_preview(public.memos) to authenticated;

notify pgrst, 'reload schema';

commit;
