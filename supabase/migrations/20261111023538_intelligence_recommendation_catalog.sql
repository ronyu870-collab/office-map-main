begin;

-- The version is derived from the exact projected rows in the same statement.
-- This keeps inserts, updates, deletes and rollbacks correct without adding
-- locks or triggers to writes on the building directory.
create function public.intelligence_recommendation_catalog(p_known_version text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with catalog as materialized (
    select b.id, b.name, b.grade, b.district, b.submarket
    from public.buildings as b
    where b.is_active and b.tracking_scope = 'tracked'
  ), snapshot as (
    select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      'intelligence-recommendation-catalog/v1:' ||
      coalesce(pg_catalog.array_agg(c order by c.name, c.id)::text, '{}'), 'UTF8'
    )), 'hex') as version
    from catalog as c
  )
  -- Use the ordered, escaped record array for the hash. Assemble JSON rows
  -- only on a miss; both branches still see the same projected snapshot.
  select pg_catalog.jsonb_build_object(
    'version', version,
    'rows', case when version = p_known_version then null::jsonb else (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c) order by c.name, c.id), '[]'::jsonb)
      from catalog as c
    ) end
  ) from snapshot;
$$;

revoke all on function public.intelligence_recommendation_catalog(text) from public, anon, authenticated;
grant execute on function public.intelligence_recommendation_catalog(text) to service_role;

notify pgrst, 'reload schema';
commit;
