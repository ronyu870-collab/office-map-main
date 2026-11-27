begin;

alter table public.pitch_exports add column visual_source_snapshot jsonb not null default '[]'
  check (jsonb_typeof(visual_source_snapshot) = 'array');

-- Capture the source versions in the same transaction as the page manifest.
-- The older export adapter sets its single-page option in an UPDATE immediately
-- after inserting an all-page manifest. The delivery adapter inserts only the
-- selected manifest rows and options together.
create function private.capture_pitch_export_visual_sources() returns trigger
language plpgsql security definer set search_path='' as $$
declare expected integer; matched integer; sources jsonb; digest_input text;
begin
  if tg_op = 'UPDATE' then
    if new.visual_source_snapshot is distinct from old.visual_source_snapshot
      or (new.render_options is distinct from old.render_options
        and (old.state <> 'pending' or old.render_options <> '{}'::jsonb)) then
      raise exception 'PITCH_CONFLICT' using errcode='23505';
    end if;
    if new.render_options is not distinct from old.render_options then return new; end if;
  end if;

  with selected as (
    select ref
    from jsonb_array_elements(new.slide_versions) with ordinality as item(ref, ordinal)
    where new.render_options->>'pipeline' = 'delivery/1'
      or not new.render_options ? 'page'
      or ordinal = (new.render_options->>'page')::integer + 1
  ), found as (
    select page.source_snapshot
    from selected
    join public.pitch_project_slides page on page.project_id=new.project_id
      and page.id=(selected.ref->>'id')::uuid and page.version=(selected.ref->>'version')::integer
  )
  select (select count(*) from selected), (select count(*) from found),
    coalesce((select jsonb_agg(distinct src order by src) from found
      cross join lateral jsonb_array_elements(found.source_snapshot) src where src ? 'visual'), '[]')
    into expected, matched, sources;
  if expected <> matched then raise exception 'PITCH_CONFLICT' using errcode='23505'; end if;
  if new.audience <> 'internal' and sources <> '[]'::jsonb then
    raise exception 'PITCH_DENIED' using errcode='42501';
  end if;
  new.visual_source_snapshot := sources;
  -- The scoped-delivery reuse path compares the existing authorization snapshot.
  -- A historical Stacking Plan must run a separate critical audit for each export.
  if new.render_options->>'pipeline' = 'delivery/1' and sources <> '[]'::jsonb then
    digest_input := sources::text;
    if exists(select 1 from jsonb_array_elements(sources) src
      where src->'visual'->>'kind' = 'stacking-plan' or src->'visual'->'origin'->>'type' = 'stacking-snapshot') then
      digest_input := digest_input || ':' || new.id::text;
    end if;
    new.authorization_snapshot := jsonb_set(new.authorization_snapshot, '{0,visualSourceDigest}',
      to_jsonb(encode(sha256(convert_to(digest_input,'UTF8')), 'hex')));
  end if;
  return new;
end $$;
revoke all on function private.capture_pitch_export_visual_sources() from public,anon,authenticated,service_role;

create trigger pitch_export_visual_sources
  before insert or update of render_options, visual_source_snapshot on public.pitch_exports
  for each row execute function private.capture_pitch_export_visual_sources();

commit;
