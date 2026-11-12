begin;

-- A PostgREST computed field preserves the changelog table's row permissions
-- and leaves the existing rows, write API and backup schema unchanged.
create function public.changelog_description_preview(entry public.changelog)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select pg_catalog.left(entry.description, 160);
$$;

revoke all on function public.changelog_description_preview(public.changelog) from public, anon, service_role;
grant execute on function public.changelog_description_preview(public.changelog) to authenticated;

notify pgrst, 'reload schema';

commit;
