-- Deploy separately from the research edition import. Legacy briefs still work with NULL.
alter table public.map_submarket_profiles
  add column if not exists research jsonb
    check (research is null or (
      jsonb_typeof(research) = 'object'
      and (research->'version') is not distinct from '1'::jsonb
      and (research->>'market') is not distinct from submarket
      and octet_length(research::text) <= 80000
    ));

create table if not exists public.map_submarket_research_versions (
  id uuid primary key default gen_random_uuid(),
  submarket text not null references public.map_submarket_profiles(submarket),
  research jsonb,
  saved_at timestamptz not null,
  saved_by uuid,
  was_published boolean not null,
  replaced_at timestamptz not null default statement_timestamp(),
  replaced_by uuid
);
create index if not exists map_submarket_research_versions_read_idx
  on public.map_submarket_research_versions (submarket, replaced_at desc, id desc);

alter table public.map_submarket_research_versions enable row level security;
revoke all on public.map_submarket_research_versions from public, anon, authenticated, service_role;
grant select, insert on public.map_submarket_research_versions to service_role;

create or replace function public.snapshot_submarket_research_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.map_submarket_research_versions
    (submarket, research, saved_at, saved_by, was_published, replaced_by)
  values (old.submarket, old.research, old.updated_at, old.updated_by, old.is_published, new.updated_by);
  return new;
end;
$$;
revoke all on function public.snapshot_submarket_research_version() from public, anon, authenticated;
grant execute on function public.snapshot_submarket_research_version() to service_role;

drop trigger if exists map_submarket_snapshot_research on public.map_submarket_profiles;
create trigger map_submarket_snapshot_research
  after update of research, is_published on public.map_submarket_profiles
  for each row
  when (old.research is distinct from new.research or (
    old.is_published is distinct from new.is_published and old.research is not null
  ))
  execute function public.snapshot_submarket_research_version();

comment on column public.map_submarket_profiles.research is
  'Versioned client research. NULL uses the legacy brief. Server validates sources, audience and project membership.';
comment on table public.map_submarket_research_versions is
  'Previous research editions captured atomically with writes. Rollback publishes a new edit; prior editions stay readable.';
notify pgrst, 'reload schema';
