-- Additive foundation only. No employee grants and no production sample data.
begin;
create table private.pitch_control (singleton boolean primary key default true check(singleton), enabled boolean not null default false);
insert into private.pitch_control values(true,false);
create table private.pitch_grants (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  organization_id text not null, region text, city text, business_line text,
  maintainer boolean not null default false, can_search boolean not null default true,
  can_generate boolean not null default false, can_client_export boolean not null default false,
  can_external_ai boolean not null default false, enabled boolean not null default true,
  valid_until timestamptz not null, granted_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index pitch_grants_user on private.pitch_grants(user_id);
create table private.pitch_events (
  id bigint generated always as identity primary key, actor_id uuid not null,
  session_id uuid not null, action text not null, target_id text not null,
  before_value jsonb, after_value jsonb, created_at timestamptz not null default now()
);
create function private.pitch_session() returns uuid language sql stable set search_path='' as $$
  select nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id','')::uuid
$$;
create function private.pitch_access(p_user uuid,p_session uuid,p_org text default null,p_region text default null,p_city text default null,p_line text default null,p_cap text default 'read')
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from private.pitch_control c, public.user_roles r
    join auth.users u on u.id=r.user_id
    join auth.sessions s on s.user_id=u.id and s.id=p_session
    join private.pitch_grants g on g.user_id=u.id
    where c.enabled and r.user_id=p_user and r.role in ('admin','editor','viewer')
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
      and (s.not_after is null or s.not_after>clock_timestamp())
      and g.enabled and g.valid_until>clock_timestamp() and g.can_search
      and (p_org is null or g.organization_id=p_org)
      and (p_region is null or g.region is null or g.region=p_region)
      and (p_city is null or g.city is null or g.city=p_city)
      and (p_line is null or g.business_line is null or g.business_line=p_line)
      and case p_cap when 'read' then true
        when 'generate' then r.role<>'viewer' and g.can_generate
        when 'maintain' then r.role<>'viewer' and (r.role='admin' or g.maintainer)
        when 'admin' then r.role='admin'
        when 'client' then r.role<>'viewer' and g.can_generate and g.can_client_export
        when 'ai' then r.role<>'viewer' and g.can_generate and g.can_external_ai
        else false end
  )
$$;
create table public.pitch_asset_categories (
  id uuid primary key default gen_random_uuid(), system_code text not null unique check(system_code ~ '^[a-z0-9-]+$'),
  names jsonb not null check(jsonb_typeof(names)='object'), enabled boolean not null default true,
  revision integer not null default 1 check(revision>0), updated_by uuid references auth.users(id), updated_at timestamptz not null default now()
);
insert into public.pitch_asset_categories(system_code,names) values('general','{"zh":"通用内容","en":"General"}');
create table public.pitch_source_documents (
  id uuid primary key default gen_random_uuid(), version integer not null default 1 check(version>0),
  filename text not null, mime text not null, storage_path text not null unique,
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), size_bytes bigint not null check(size_bytes>0 and size_bytes<=25165824),
  language text not null, is_test_data boolean not null default false,
  visibility text not null check(visibility in ('private','organization')),

  created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
  organization_id text not null, region text not null, city text not null, business_line text not null,
  state text not null default 'draft' check (state in ('draft','pending_review','published','archived')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  valid_from date, valid_until date, data_as_of date not null,
  check (valid_from is null or valid_until is null or valid_until >= valid_from)
);
create table public.pitch_source_pages (
  id uuid primary key default gen_random_uuid(), document_id uuid not null references public.pitch_source_documents(id),
  ordinal integer not null check(ordinal>0), locator text not null, extracted_text text not null,
  parser_version text not null, created_at timestamptz not null default now(), unique(document_id,ordinal)
);
create table public.pitch_media_assets (
  id uuid not null default gen_random_uuid(), version integer not null check(version>0),
  source_page_id uuid not null references public.pitch_source_pages(id),
  storage_path text not null unique, mime text not null check(mime in ('image/png','image/jpeg','image/webp')),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), size_bytes bigint not null check(size_bytes>0 and size_bytes<=4194304),
  alt text not null, primary key(id,version),

  created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
  organization_id text not null, region text not null, city text not null, business_line text not null,
  state text not null default 'draft' check (state in ('draft','pending_review','published','archived')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  valid_from date, valid_until date, data_as_of date not null,
  check (valid_from is null or valid_until is null or valid_until >= valid_from)
);
create table public.pitch_content_assets (
  id uuid primary key default gen_random_uuid(), current_version integer not null default 1 check(current_version>0),
  category_id uuid not null references public.pitch_asset_categories(id), names jsonb not null check(jsonb_typeof(names)='object'),
  tags text[] not null default '{}', visibility text not null check(visibility in ('private','organization')),
  allow_internal_generation boolean not null default false, allow_client_export boolean not null default false, allow_external_ai boolean not null default false,
  disclosure text not null check(disclosure in ('internal','client_approved','restricted')), is_test_data boolean not null default false,
  check(not allow_client_export or disclosure='client_approved'), check(not is_test_data or (not allow_client_export and not allow_external_ai)),

  created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
  organization_id text not null, region text not null, city text not null, business_line text not null,
  state text not null default 'draft' check (state in ('draft','pending_review','published','archived')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  valid_from date, valid_until date, data_as_of date not null,
  check (valid_from is null or valid_until is null or valid_until >= valid_from)
);
create table public.pitch_asset_versions (
  state text not null check(state in ('draft','pending_review','published','archived')), visibility text not null check(visibility in ('private','organization')),
  allow_internal_generation boolean not null,allow_client_export boolean not null,allow_external_ai boolean not null,disclosure text not null check(disclosure in ('internal','client_approved','restricted')),is_test_data boolean not null,
  asset_id uuid not null references public.pitch_content_assets(id), version integer not null check(version>0),
  protocol text not null check(protocol='colliers-pitch/1'), content jsonb not null check(jsonb_typeof(content)='object' and content->>'protocol'='colliers-pitch/1' and jsonb_typeof(content->'blocks')='array' and jsonb_typeof(content->'sources')='array'),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  primary key(asset_id,version)
);
create table public.pitch_asset_media (
  asset_id uuid not null, asset_version integer not null, media_id uuid not null, media_version integer not null,
  primary key(asset_id,asset_version,media_id,media_version),
  foreign key(asset_id,asset_version) references public.pitch_asset_versions(asset_id,version),
  foreign key(media_id,media_version) references public.pitch_media_assets(id,version)
);
create table public.pitch_source_references (
  id uuid not null, asset_id uuid not null, asset_version integer not null,
  document_id uuid references public.pitch_source_documents(id), page_id uuid references public.pitch_source_pages(id),
  kind text not null check(kind in ('document','record','synthetic')), label text not null, locator text not null,
  source_version text not null, record_id text, sha256 text check(sha256 ~ '^[a-f0-9]{64}$'), data_as_of date not null,
  primary key(asset_id,asset_version,id),
  foreign key(asset_id,asset_version) references public.pitch_asset_versions(asset_id,version),
  check(kind<>'document' or document_id is not null)
);
create table public.pitch_templates (
  id text primary key, names jsonb not null check(jsonb_typeof(names)='object'), category_id uuid not null references public.pitch_asset_categories(id),
  state text not null check(state in ('draft','pending_review','published','archived')), current_version integer not null check(current_version>0)
);
create table public.pitch_template_versions (
  template_id text not null references public.pitch_templates(id), version integer not null check(version>0),
  adapter text not null check(adapter='text-image/1'), config jsonb not null check(jsonb_typeof(config)='object' and config->>'adapter'='text-image/1'),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), created_by uuid references auth.users(id), created_at timestamptz not null default now(), primary key(template_id,version)
);
create table public.pitch_layout_definitions (
  id text not null, version integer not null check(version>0), engine text not null check(engine='text-image/1'),
  definition jsonb not null check(jsonb_typeof(definition)='object'), primary key(id,version)
);
create table public.pitch_design_themes (
  id text primary key, state text not null check(state in ('draft','pending_review','published','archived')), current_version integer not null check(current_version>0)
);
create table public.pitch_theme_versions (
  theme_id text not null references public.pitch_design_themes(id), version integer not null check(version>0),
  definition jsonb not null check(jsonb_typeof(definition)='object'), sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid references auth.users(id), created_at timestamptz not null default now(), primary key(theme_id,version)
);
create table public.pitch_projects (
  id uuid primary key, parent_project_id uuid references public.pitch_projects(id), title text not null check(length(title) between 1 and 160), version integer not null default 1 check(version>0),
  theme_id text not null, theme_version integer not null, is_test_data boolean not null,
  foreign key(theme_id,theme_version) references public.pitch_theme_versions(theme_id,version),

  created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
  organization_id text not null, region text not null, city text not null, business_line text not null,
  state text not null default 'draft' check (state in ('draft','pending_review','published','archived')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  valid_from date, valid_until date, data_as_of date not null,
  check (valid_from is null or valid_until is null or valid_until >= valid_from)
);
create index pitch_projects_owner on public.pitch_projects(created_by,created_at desc,id);
create table public.pitch_project_slides (
  id uuid primary key, project_id uuid not null references public.pitch_projects(id), position integer not null check(position>0),
  version integer not null default 1 check(version>0), asset_id uuid not null, asset_version integer not null,
  template_id text not null, template_version integer not null, layout_id text not null, layout_version integer not null,
  theme_id text not null, theme_version integer not null,
  content jsonb not null check(content->>'protocol'='colliers-pitch/1'), scene jsonb not null check(scene->>'protocol'='colliers-pitch/1'),
  source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='array'),
  created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(asset_id,asset_version) references public.pitch_asset_versions(asset_id,version),
  foreign key(template_id,template_version) references public.pitch_template_versions(template_id,version),
  foreign key(layout_id,layout_version) references public.pitch_layout_definitions(id,version),
  foreign key(theme_id,theme_version) references public.pitch_theme_versions(theme_id,version), unique(project_id,position)
);
create index pitch_slides_asset on public.pitch_project_slides(asset_id,asset_version);
create table public.pitch_jobs (
  id uuid primary key, project_id uuid not null references public.pitch_projects(id),
  kind text not null check(kind in ('parse','generate','export')), state text not null check(state in ('queued','running','succeeded','failed')),
  error_code text, created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.pitch_exports (
  id uuid primary key, project_id uuid not null references public.pitch_projects(id), job_id uuid not null unique references public.pitch_jobs(id),
  audience text not null check(audience in ('internal','client')), state text not null check(state in ('pending','ready','failed')),
  format text not null check(format='pptx'), storage_path text not null unique,
  sha256 text check(sha256 ~ '^[a-f0-9]{64}$'), size_bytes bigint check(size_bytes>0 and size_bytes<=4194304),
  slide_versions jsonb not null check(jsonb_typeof(slide_versions)='array'),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  check(state<>'ready' or (sha256 is not null and size_bytes is not null))
);
create function private.pitch_document_visible(p_user uuid,p_session uuid,p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pitch_source_documents d where d.id=p_id
   and private.pitch_access(p_user,p_session,d.organization_id,d.region,d.city,d.business_line)
   and (d.created_by=p_user or (d.state='published' and d.visibility='organization'))
   and (d.valid_from is null or d.valid_from<=current_date) and (d.valid_until is null or d.valid_until>=current_date))
$$;
create function private.pitch_media_visible(p_user uuid,p_session uuid,p_id uuid,p_version integer) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pitch_media_assets m join public.pitch_source_pages sp on sp.id=m.source_page_id
   where m.id=p_id and m.version=p_version and private.pitch_access(p_user,p_session,m.organization_id,m.region,m.city,m.business_line)
   and private.pitch_document_visible(p_user,p_session,sp.document_id) and (m.created_by=p_user or m.state='published') and m.state<>'archived'
   and (m.valid_from is null or m.valid_from<=current_date) and (m.valid_until is null or m.valid_until>=current_date))
$$;
create function private.pitch_asset_visible(p_user uuid,p_session uuid,p_id uuid,p_cap text default 'read') returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pitch_content_assets a where a.id=p_id
   and private.pitch_access(p_user,p_session,a.organization_id,a.region,a.city,a.business_line,p_cap)
   and (a.created_by=p_user or (a.state='published' and a.visibility='organization'))
   and a.state<>'archived' and (a.valid_from is null or a.valid_from<=current_date) and (a.valid_until is null or a.valid_until>=current_date)
   and case p_cap when 'generate' then a.allow_internal_generation
     when 'client' then a.state='published' and a.allow_client_export and a.disclosure='client_approved' and not a.is_test_data
     when 'ai' then a.state='published' and a.allow_external_ai and not a.is_test_data else true end)
$$;
create function private.pitch_version_visible(p_user uuid,p_session uuid,p_id uuid,p_version integer,p_cap text default 'read') returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pitch_asset_versions v join public.pitch_content_assets a on a.id=v.asset_id
   where v.asset_id=p_id and v.version=p_version and private.pitch_asset_visible(p_user,p_session,p_id,p_cap)
   and (a.created_by=p_user or (v.state='published' and v.visibility='organization'))
   and case p_cap when 'generate' then v.allow_internal_generation
     when 'client' then v.state='published' and v.allow_client_export and v.disclosure='client_approved' and not v.is_test_data
     when 'ai' then v.state='published' and v.allow_external_ai and not v.is_test_data else true end)
$$;
create function private.pitch_project_visible(p_user uuid,p_session uuid,p_id uuid,p_cap text default 'read') returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pitch_projects p where p.id=p_id and p.created_by=p_user
   and private.pitch_access(p_user,p_session,p.organization_id,p.region,p.city,p.business_line,p_cap))
$$;
-- RLS applies to every exposed table. No direct client writes; code-reviewed RPCs
-- are the sole writer, validate fresh account/session/grant state and append audit.
alter table private.pitch_control enable row level security;
revoke all on private.pitch_control from public,anon,authenticated,service_role;
alter table private.pitch_grants enable row level security;
revoke all on private.pitch_grants from public,anon,authenticated,service_role;
alter table private.pitch_events enable row level security;
revoke all on private.pitch_events from public,anon,authenticated,service_role;
alter table public.pitch_asset_categories enable row level security;
revoke all on public.pitch_asset_categories from public,anon,authenticated,service_role;
grant select on public.pitch_asset_categories to authenticated;
create policy pitch_asset_categories_read on public.pitch_asset_categories for select to authenticated using (private.pitch_access(auth.uid(),private.pitch_session()));
alter table public.pitch_source_documents enable row level security;
revoke all on public.pitch_source_documents from public,anon,authenticated,service_role;
grant select on public.pitch_source_documents to authenticated;
create policy pitch_source_documents_read on public.pitch_source_documents for select to authenticated using (private.pitch_document_visible(auth.uid(),private.pitch_session(),id));
alter table public.pitch_source_pages enable row level security;
revoke all on public.pitch_source_pages from public,anon,authenticated,service_role;
grant select on public.pitch_source_pages to authenticated;
create policy pitch_source_pages_read on public.pitch_source_pages for select to authenticated using (private.pitch_document_visible(auth.uid(),private.pitch_session(),document_id));
alter table public.pitch_media_assets enable row level security;
revoke all on public.pitch_media_assets from public,anon,authenticated,service_role;
grant select on public.pitch_media_assets to authenticated;
create policy pitch_media_assets_read on public.pitch_media_assets for select to authenticated using (private.pitch_media_visible(auth.uid(),private.pitch_session(),id,version));
alter table public.pitch_content_assets enable row level security;
revoke all on public.pitch_content_assets from public,anon,authenticated,service_role;
grant select on public.pitch_content_assets to authenticated;
create policy pitch_content_assets_read on public.pitch_content_assets for select to authenticated using (private.pitch_asset_visible(auth.uid(),private.pitch_session(),id));
alter table public.pitch_asset_versions enable row level security;
revoke all on public.pitch_asset_versions from public,anon,authenticated,service_role;
grant select on public.pitch_asset_versions to authenticated;
create policy pitch_asset_versions_read on public.pitch_asset_versions for select to authenticated using (private.pitch_version_visible(auth.uid(),private.pitch_session(),asset_id,version));
alter table public.pitch_source_references enable row level security;
revoke all on public.pitch_source_references from public,anon,authenticated,service_role;
grant select on public.pitch_source_references to authenticated;
create policy pitch_source_references_read on public.pitch_source_references for select to authenticated using (private.pitch_version_visible(auth.uid(),private.pitch_session(),asset_id,asset_version));
alter table public.pitch_templates enable row level security;
revoke all on public.pitch_templates from public,anon,authenticated,service_role;
grant select on public.pitch_templates to authenticated;
create policy pitch_templates_read on public.pitch_templates for select to authenticated using (private.pitch_access(auth.uid(),private.pitch_session()));
alter table public.pitch_template_versions enable row level security;
revoke all on public.pitch_template_versions from public,anon,authenticated,service_role;
grant select on public.pitch_template_versions to authenticated;
create policy pitch_template_versions_read on public.pitch_template_versions for select to authenticated using (private.pitch_access(auth.uid(),private.pitch_session()));
alter table public.pitch_layout_definitions enable row level security;
revoke all on public.pitch_layout_definitions from public,anon,authenticated,service_role;
grant select on public.pitch_layout_definitions to authenticated;
create policy pitch_layout_definitions_read on public.pitch_layout_definitions for select to authenticated using (private.pitch_access(auth.uid(),private.pitch_session()));
alter table public.pitch_design_themes enable row level security;
revoke all on public.pitch_design_themes from public,anon,authenticated,service_role;
grant select on public.pitch_design_themes to authenticated;
create policy pitch_design_themes_read on public.pitch_design_themes for select to authenticated using (private.pitch_access(auth.uid(),private.pitch_session()));
alter table public.pitch_theme_versions enable row level security;
revoke all on public.pitch_theme_versions from public,anon,authenticated,service_role;
grant select on public.pitch_theme_versions to authenticated;
create policy pitch_theme_versions_read on public.pitch_theme_versions for select to authenticated using (private.pitch_access(auth.uid(),private.pitch_session()));
alter table public.pitch_projects enable row level security;
revoke all on public.pitch_projects from public,anon,authenticated,service_role;
grant select on public.pitch_projects to authenticated;
create policy pitch_projects_read on public.pitch_projects for select to authenticated using (private.pitch_project_visible(auth.uid(),private.pitch_session(),id));
alter table public.pitch_project_slides enable row level security;
revoke all on public.pitch_project_slides from public,anon,authenticated,service_role;
grant select on public.pitch_project_slides to authenticated;
create policy pitch_project_slides_read on public.pitch_project_slides for select to authenticated using (private.pitch_project_visible(auth.uid(),private.pitch_session(),project_id));
alter table public.pitch_jobs enable row level security;
revoke all on public.pitch_jobs from public,anon,authenticated,service_role;
grant select on public.pitch_jobs to authenticated;
create policy pitch_jobs_read on public.pitch_jobs for select to authenticated using (private.pitch_project_visible(auth.uid(),private.pitch_session(),project_id));
alter table public.pitch_exports enable row level security;
revoke all on public.pitch_exports from public,anon,authenticated,service_role;
grant select on public.pitch_exports to authenticated;
create policy pitch_exports_read on public.pitch_exports for select to authenticated using (private.pitch_project_visible(auth.uid(),private.pitch_session(),project_id));
alter table public.pitch_asset_media enable row level security;
revoke all on public.pitch_asset_media from public,anon,authenticated,service_role;
grant select on public.pitch_asset_media to authenticated;
create policy pitch_asset_media_read on public.pitch_asset_media for select to authenticated using(private.pitch_version_visible(auth.uid(),private.pitch_session(),asset_id,asset_version));
-- Atomic domain writer and bounded reader, service-only. p_actor/p_session must
-- come from verifyQueryIdentity(), never JSON from a browser or model.
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare op text:=p_input->>'action'; a public.pitch_content_assets; p public.pitch_projects;
  e public.pitch_exports; v public.pitch_asset_versions; g private.pitch_grants;
  result jsonb; s jsonb; file jsonb; ref jsonb; item jsonb; pid uuid; aid uuid; mid uuid;
  did uuid; pageid uuid; scope jsonb; revision integer; existing jsonb;
begin
  -- Locks make revocation serialize with this operation. New calls never trust
  -- cached token roles, user_metadata, client scopes or admin simulation headers.
  perform 1 from private.pitch_control for share;
  perform 1 from auth.users where id=p_actor for share;
  perform 1 from public.user_roles where user_id=p_actor for share;
  perform 1 from auth.sessions where id=p_session and user_id=p_actor for share;
  perform 1 from private.pitch_grants where user_id=p_actor order by id for share;
  if not private.pitch_access(p_actor,p_session) then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
  if op='catalog' then
    return jsonb_build_object(
      'scopes',(select coalesce(jsonb_agg(jsonb_build_object('organizationId',g.organization_id,'region',g.region,'city',g.city,'businessLine',g.business_line,
        'canGenerate',g.can_generate and r.role<>'viewer','canMaintain',(g.maintainer or r.role='admin') and r.role<>'viewer','canAdmin',r.role='admin','canClientExport',g.can_client_export and r.role<>'viewer','canExternalAi',g.can_external_ai and r.role<>'viewer')),'[]')
        from private.pitch_grants g join public.user_roles r on r.user_id=g.user_id where g.user_id=p_actor and g.enabled and g.valid_until>clock_timestamp() and g.can_search),
      'categories',(select coalesce(jsonb_agg(to_jsonb(c) order by system_code),'[]') from public.pitch_asset_categories c),
      'templates',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.pitch_templates t where state='published'),
      'themes',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.pitch_design_themes t where state='published'));
  elsif op='list_projects' then
    return coalesce((select jsonb_agg(to_jsonb(x)) from (select id,title,state,version,is_test_data,created_at,theme_id,theme_version from public.pitch_projects p
      where p.created_by=p_actor and private.pitch_project_visible(p_actor,p_session,p.id)
      and (p_input->>'before' is null or p.id<(p_input->>'before')::uuid) order by p.id desc limit 51) x),'[]');
  elsif op='list_assets' then
    return coalesce((select jsonb_agg(to_jsonb(x)) from (select a.id,a.names,a.state,a.current_version,a.category_id,a.tags,a.is_test_data,a.data_as_of,a.visibility
      from public.pitch_content_assets a where private.pitch_asset_visible(p_actor,p_session,a.id)
      and (p_input->>'before' is null or a.id<(p_input->>'before')::uuid) order by a.id desc limit 51) x),'[]');
  elsif op='registry' then
    return jsonb_build_object(
      'template',(select to_jsonb(v) from public.pitch_template_versions v join public.pitch_templates t on t.id=v.template_id where v.template_id=p_input->>'templateId' and v.version=(p_input->>'templateVersion')::integer and t.state='published'),
      'theme',(select to_jsonb(v) from public.pitch_theme_versions v join public.pitch_design_themes t on t.id=v.theme_id where v.theme_id=p_input->>'themeId' and v.version=(p_input->>'themeVersion')::integer and t.state='published'));
  elsif op='get_asset' then
    aid:=(p_input->>'assetId')::uuid;
    if not private.pitch_asset_visible(p_actor,p_session,aid,'generate') then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
    select * into a from public.pitch_content_assets where id=aid;
    select * into v from public.pitch_asset_versions where asset_id=aid and version=a.current_version;
    return jsonb_build_object('asset',to_jsonb(a),'version',to_jsonb(v));
  elsif op='get_project' then
    pid:=(p_input->>'projectId')::uuid;
    if not private.pitch_project_visible(p_actor,p_session,pid) then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
    select * into p from public.pitch_projects where id=pid;
    return jsonb_build_object('project',to_jsonb(p),'slides',(select coalesce(jsonb_agg(to_jsonb(s) order by position),'[]') from public.pitch_project_slides s where project_id=pid),
      'exports',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select id,state,audience,created_at,sha256 from public.pitch_exports where project_id=pid order by created_at desc limit 50) x));
  elsif op='asset_save' then
    aid:=(p_input->>'assetId')::uuid; scope:=p_input->'asset'->'scope'; item:=p_input->'asset';
    if not private.pitch_access(p_actor,p_session,scope->>'organizationId',scope->>'region',scope->>'city',scope->>'businessLine','maintain') then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
    perform pg_advisory_xact_lock(hashtextextended(aid::text,0));
    select * into a from public.pitch_content_assets where id=aid for update;
    existing:=to_jsonb(a);
    if a.id is not null then
      if a.visibility='private' and a.created_by<>p_actor then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
      if a.organization_id<>scope->>'organizationId' or a.region<>scope->>'region' or a.city<>scope->>'city' or a.business_line<>scope->>'businessLine'
        or a.current_version<>(p_input->>'expectedVersion')::integer then raise exception 'PITCH_CONFLICT' using errcode='23505'; end if;
      revision:=a.current_version+1;
    else
      if (p_input->>'expectedVersion')::integer<>0 then raise exception 'PITCH_CONFLICT' using errcode='23505'; end if;
      revision:=1;
    end if;
    if not exists(select 1 from public.pitch_asset_categories where id=(item->>'categoryId')::uuid and enabled) then raise exception 'PITCH_INVALID'; end if;
    for ref in select value from jsonb_array_elements(item->'content'->'blocks') where value->>'kind'='image' loop
      if not private.pitch_media_visible(p_actor,p_session,(ref->>'mediaAssetId')::uuid,(ref->>'mediaVersion')::integer) then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
      if item->>'state'='published' and item->>'visibility'='organization' and not exists(
        select 1 from public.pitch_media_assets m join public.pitch_source_pages sp on sp.id=m.source_page_id join public.pitch_source_documents d on d.id=sp.document_id
        where m.id=(ref->>'mediaAssetId')::uuid and m.version=(ref->>'mediaVersion')::integer and m.state='published' and d.state='published' and d.visibility='organization'
        and d.organization_id=scope->>'organizationId' and d.region=scope->>'region' and d.city=scope->>'city' and d.business_line=scope->>'businessLine'
      ) then raise exception 'PITCH_INVALID'; end if;
    end loop;
    for ref in select value from jsonb_array_elements(item->'content'->'sources') loop
      if ref->>'documentId' is not null and not private.pitch_document_visible(p_actor,p_session,(ref->>'documentId')::uuid) then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
      if item->'content'->>'isTestData'='false' and exists(select 1 from public.pitch_source_documents d where d.id=(ref->>'documentId')::uuid and d.is_test_data) then raise exception 'PITCH_INVALID'; end if;
      if ref->>'pageId' is not null and not exists(select 1 from public.pitch_source_pages sp where sp.id=(ref->>'pageId')::uuid and sp.document_id=(ref->>'documentId')::uuid) then raise exception 'PITCH_INVALID'; end if;
    end loop;
    if revision=1 then
      insert into public.pitch_content_assets(id,category_id,names,tags,visibility,allow_internal_generation,allow_client_export,allow_external_ai,disclosure,is_test_data,created_by,updated_by,organization_id,region,city,business_line,state,data_as_of,valid_from,valid_until)
      values(aid,(item->>'categoryId')::uuid,item->'names',array(select jsonb_array_elements_text(item->'tags')),item->>'visibility',(item->>'allowInternalGeneration')::boolean,(item->>'allowClientExport')::boolean,(item->>'allowExternalAi')::boolean,item->'content'->>'disclosure',(item->'content'->>'isTestData')::boolean,p_actor,p_actor,scope->>'organizationId',scope->>'region',scope->>'city',scope->>'businessLine',item->>'state',(item->'content'->>'dataAsOf')::date,(item->>'validFrom')::date,(item->>'validUntil')::date);
    else
      update public.pitch_content_assets set current_version=revision,category_id=(item->>'categoryId')::uuid,names=item->'names',tags=array(select jsonb_array_elements_text(item->'tags')),visibility=item->>'visibility',
        allow_internal_generation=(item->>'allowInternalGeneration')::boolean,allow_client_export=(item->>'allowClientExport')::boolean,allow_external_ai=(item->>'allowExternalAi')::boolean,
        disclosure=item->'content'->>'disclosure',is_test_data=(item->'content'->>'isTestData')::boolean,state=item->>'state',updated_by=p_actor,updated_at=now(),
        data_as_of=(item->'content'->>'dataAsOf')::date,valid_from=(item->>'validFrom')::date,valid_until=(item->>'validUntil')::date where id=aid;
    end if;
    insert into public.pitch_asset_versions(asset_id,version,protocol,content,sha256,created_by,state,visibility,allow_internal_generation,allow_client_export,allow_external_ai,disclosure,is_test_data)
    values(aid,revision,'colliers-pitch/1',item->'content',p_input->>'sha256',p_actor,item->>'state',item->>'visibility',(item->>'allowInternalGeneration')::boolean,(item->>'allowClientExport')::boolean,(item->>'allowExternalAi')::boolean,item->'content'->>'disclosure',(item->'content'->>'isTestData')::boolean);
    insert into public.pitch_asset_media(asset_id,asset_version,media_id,media_version)
      select distinct aid,revision,(b->>'mediaAssetId')::uuid,(b->>'mediaVersion')::integer from jsonb_array_elements(item->'content'->'blocks') b where b->>'kind'='image';
    for ref in select value from jsonb_array_elements(item->'content'->'sources') loop
      insert into public.pitch_source_references(id,asset_id,asset_version,document_id,page_id,kind,label,locator,source_version,record_id,sha256,data_as_of)
      values((ref->>'id')::uuid,aid,revision,(ref->>'documentId')::uuid,(ref->>'pageId')::uuid,ref->>'kind',ref->>'label',ref->>'locator',ref->>'version',ref->>'recordId',ref->>'sha256',(ref->>'dataAsOf')::date);
    end loop;
    result:=jsonb_build_object('assetId',aid,'version',revision);
  elsif op='sample_create' then
    scope:=p_input->'scope'; aid:=(p_input->>'assetId')::uuid; did:=(p_input->>'documentId')::uuid;
    pageid:=(p_input->>'pageId')::uuid; mid:=(p_input->>'mediaId')::uuid;
    if not private.pitch_access(p_actor,p_session,scope->>'organizationId',scope->>'region',scope->>'city',scope->>'businessLine','generate') then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
    perform pg_advisory_xact_lock(hashtextextended(aid::text,0));
    select to_jsonb(a) into existing from public.pitch_content_assets a where id=aid;
    if found then
      if existing->>'created_by'<>p_actor::text or not (existing->>'is_test_data')::boolean or existing->>'organization_id'<>scope->>'organizationId' or existing->>'region'<>scope->>'region' or existing->>'city'<>scope->>'city' or existing->>'business_line'<>scope->>'businessLine' then raise exception 'PITCH_CONFLICT' using errcode='23505'; end if;
      return jsonb_build_object('assetId',aid,'replayed',true);
    end if;
    if p_input->'content'->>'isTestData'<>'true' or p_input->'content'->>'disclosure'<>'internal' then raise exception 'PITCH_INVALID'; end if;
    file:=p_input->'sourceFile';
    if file->>'path' <> 'sources/'||p_actor||'/'||did||'/original.json' then raise exception 'PITCH_INVALID'; end if;
    insert into public.pitch_source_documents(id,filename,mime,storage_path,sha256,size_bytes,language,is_test_data,visibility,created_by,updated_by,organization_id,region,city,business_line,state,data_as_of)
    values(did,'测试素材.json',file->>'mime',file->>'path',file->>'sha256',(file->>'size')::bigint,'zh',true,'private',p_actor,p_actor,scope->>'organizationId',scope->>'region',scope->>'city',scope->>'businessLine','draft',(p_input->'content'->>'dataAsOf')::date);
    insert into public.pitch_source_pages(id,document_id,ordinal,locator,extracted_text,parser_version) values(pageid,did,1,'logical-unit:1','合成测试素材；非高力国际真实案例','pitch-synthetic/1');
    file:=p_input->'mediaFile';
    if file->>'path' <> 'media/'||p_actor||'/'||mid||'/1.png' then raise exception 'PITCH_INVALID'; end if;
    insert into public.pitch_media_assets(id,version,source_page_id,storage_path,mime,sha256,size_bytes,alt,created_by,updated_by,organization_id,region,city,business_line,state,data_as_of)
    values(mid,1,pageid,file->>'path',file->>'mime',file->>'sha256',(file->>'size')::bigint,'测试办公楼示意图',p_actor,p_actor,scope->>'organizationId',scope->>'region',scope->>'city',scope->>'businessLine','draft',(p_input->'content'->>'dataAsOf')::date);
    insert into public.pitch_content_assets(id,category_id,names,visibility,allow_internal_generation,disclosure,is_test_data,created_by,updated_by,organization_id,region,city,business_line,data_as_of)
    values(aid,(select id from public.pitch_asset_categories where system_code='general' and enabled),'{"zh":"测试图文素材","en":"Synthetic test asset"}','private',true,'internal',true,p_actor,p_actor,scope->>'organizationId',scope->>'region',scope->>'city',scope->>'businessLine',(p_input->'content'->>'dataAsOf')::date);
    insert into public.pitch_asset_versions(asset_id,version,protocol,content,sha256,created_by,state,visibility,allow_internal_generation,allow_client_export,allow_external_ai,disclosure,is_test_data)
    values(aid,1,'colliers-pitch/1',p_input->'content',p_input->>'sha256',p_actor,'draft','private',true,false,false,'internal',true);
    insert into public.pitch_asset_media values(aid,1,mid,1);
    for ref in select value from jsonb_array_elements(p_input->'content'->'sources') loop
      insert into public.pitch_source_references(id,asset_id,asset_version,document_id,page_id,kind,label,locator,source_version,sha256,data_as_of)
      values((ref->>'id')::uuid,aid,1,did,pageid,ref->>'kind',ref->>'label',ref->>'locator',ref->>'version',ref->>'sha256',(ref->>'dataAsOf')::date);
    end loop;
    result:=jsonb_build_object('assetId',aid);
  elsif op='project_create' then
    aid:=(p_input->>'assetId')::uuid; pid:=(p_input->>'projectId')::uuid;
    if not private.pitch_asset_visible(p_actor,p_session,aid,'generate') then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
    select * into a from public.pitch_content_assets where id=aid for share;
    select * into v from public.pitch_asset_versions where asset_id=aid and version=(p_input->>'assetVersion')::integer;
    if not private.pitch_version_visible(p_actor,p_session,aid,(p_input->>'assetVersion')::integer,'generate') then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
    if exists(select 1 from public.pitch_asset_media am where am.asset_id=aid and am.asset_version=v.version and not private.pitch_media_visible(p_actor,p_session,am.media_id,am.media_version)) then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
    if v.asset_id is null or p_input->'content' is distinct from v.content or p_input->'sources' is distinct from v.content->'sources' then raise exception 'PITCH_INVALID'; end if;
    if not exists(select 1 from public.pitch_template_versions tv join public.pitch_templates t on t.id=tv.template_id
      where tv.template_id=p_input->>'templateId' and tv.version=(p_input->>'templateVersion')::integer and t.state='published') then raise exception 'PITCH_INVALID'; end if;
    perform pg_advisory_xact_lock(hashtextextended(pid::text,0));
    select * into p from public.pitch_projects where id=pid;
    if found then
      if p.created_by<>p_actor or p.title<>p_input->>'title' or not exists(select 1 from public.pitch_project_slides s where s.project_id=pid and s.asset_id=aid and s.asset_version=v.version and s.template_id=p_input->>'templateId' and s.template_version=(p_input->>'templateVersion')::integer and s.theme_id=p_input->>'themeId' and s.theme_version=(p_input->>'themeVersion')::integer) then raise exception 'PITCH_CONFLICT' using errcode='23505'; end if;
      return jsonb_build_object('projectId',pid,'replayed',true);
    end if;
    if p_input->'scene'->>'themeId' is distinct from p_input->>'themeId' or p_input->'scene'->>'themeVersion' is distinct from p_input->>'themeVersion'
      or p_input->'scene'->>'layoutId' is distinct from p_input->>'layoutId' or p_input->'scene'->>'layoutVersion' is distinct from p_input->>'layoutVersion' then raise exception 'PITCH_INVALID'; end if;
    insert into public.pitch_projects(id,title,theme_id,theme_version,is_test_data,created_by,updated_by,organization_id,region,city,business_line,data_as_of)
    values(pid,p_input->>'title',p_input->>'themeId',(p_input->>'themeVersion')::integer,a.is_test_data,p_actor,p_actor,a.organization_id,a.region,a.city,a.business_line,a.data_as_of);
    insert into public.pitch_project_slides(id,project_id,position,asset_id,asset_version,template_id,template_version,layout_id,layout_version,theme_id,theme_version,content,scene,source_snapshot,created_by,updated_by)
    values((p_input->>'slideId')::uuid,pid,1,aid,v.version,p_input->>'templateId',(p_input->>'templateVersion')::integer,p_input->>'layoutId',(p_input->>'layoutVersion')::integer,p_input->>'themeId',(p_input->>'themeVersion')::integer,p_input->'content',p_input->'scene',p_input->'sources',p_actor,p_actor);
    result:=jsonb_build_object('projectId',pid);
  elsif op='project_clone_theme' then
    pid:=(p_input->>'sourceProjectId')::uuid;
    if not private.pitch_project_visible(p_actor,p_session,pid,'generate') then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
    select * into p from public.pitch_projects where id=pid for share;
    if p.version<>(p_input->>'expectedVersion')::integer then raise exception 'PITCH_CONFLICT' using errcode='23505'; end if;
    if not exists(select 1 from public.pitch_theme_versions tv join public.pitch_design_themes t on t.id=tv.theme_id
      where tv.theme_id=p_input->>'themeId' and tv.version=(p_input->>'themeVersion')::integer and t.state='published') then raise exception 'PITCH_INVALID'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_input->>'projectId',0));
    if exists(select 1 from public.pitch_projects pp where pp.id=(p_input->>'projectId')::uuid) then
      if not exists(select 1 from public.pitch_projects pp where pp.id=(p_input->>'projectId')::uuid and pp.created_by=p_actor and pp.parent_project_id=pid and pp.theme_id=p_input->>'themeId' and pp.theme_version=(p_input->>'themeVersion')::integer) then raise exception 'PITCH_CONFLICT' using errcode='23505'; end if;
      return jsonb_build_object('projectId',p_input->>'projectId','replayed',true);
    end if;
    insert into public.pitch_projects(id,parent_project_id,title,version,theme_id,theme_version,is_test_data,created_by,updated_by,organization_id,region,city,business_line,data_as_of)
    values((p_input->>'projectId')::uuid,pid,p.title,p.version+1,p_input->>'themeId',(p_input->>'themeVersion')::integer,p.is_test_data,p_actor,p_actor,p.organization_id,p.region,p.city,p.business_line,p.data_as_of);
    if jsonb_array_length(p_input->'slides')<>(select count(*) from public.pitch_project_slides where project_id=pid) then raise exception 'PITCH_INVALID'; end if;
    for item in select value from jsonb_array_elements(p_input->'slides') loop
      select to_jsonb(ss) into s from public.pitch_project_slides ss where id=(item->>'sourceSlideId')::uuid and ss.project_id=pid;
      if s is null or not private.pitch_version_visible(p_actor,p_session,(s->>'asset_id')::uuid,(s->>'asset_version')::integer,'generate') then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
      if item->'scene'->>'themeId' is distinct from p_input->>'themeId' or item->'scene'->>'themeVersion' is distinct from p_input->>'themeVersion' then raise exception 'PITCH_INVALID'; end if;
      insert into public.pitch_project_slides(id,project_id,position,version,asset_id,asset_version,template_id,template_version,layout_id,layout_version,theme_id,theme_version,content,scene,source_snapshot,created_by,updated_by)
      values((item->>'slideId')::uuid,(p_input->>'projectId')::uuid,(s->>'position')::integer,(s->>'version')::integer+1,(s->>'asset_id')::uuid,(s->>'asset_version')::integer,s->>'template_id',(s->>'template_version')::integer,s->>'layout_id',(s->>'layout_version')::integer,p_input->>'themeId',(p_input->>'themeVersion')::integer,s->'content',item->'scene',s->'source_snapshot',p_actor,p_actor);
    end loop;
    result:=jsonb_build_object('projectId',p_input->>'projectId','parentProjectId',pid);
  elsif op in ('export_prepare','export_context','export_complete','export_fail','export_download') then
    pid:=(p_input->>'projectId')::uuid;
    if not private.pitch_project_visible(p_actor,p_session,pid,'generate') then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
    select * into p from public.pitch_projects where id=pid for share;
    for item in select to_jsonb(s) from public.pitch_project_slides s where s.project_id=pid loop
      if not private.pitch_version_visible(p_actor,p_session,(item->>'asset_id')::uuid,(item->>'asset_version')::integer,case when p_input->>'audience'='client' then 'client' else 'generate' end) then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
      for ref in select value from jsonb_array_elements(item->'content'->'blocks') where value->>'kind'='image' loop
        if not exists(select 1 from public.pitch_media_assets m join public.pitch_source_pages sp on sp.id=m.source_page_id
          where m.id=(ref->>'mediaAssetId')::uuid and m.version=(ref->>'mediaVersion')::integer
            and (m.created_by=p_actor or m.state='published') and m.state<>'archived'
            and (m.valid_from is null or m.valid_from<=current_date) and (m.valid_until is null or m.valid_until>=current_date)
            and private.pitch_document_visible(p_actor,p_session,sp.document_id)
            and (p_input->>'audience'<>'client' or exists(select 1 from public.pitch_source_documents d where d.id=sp.document_id and not d.is_test_data))
            and private.pitch_access(p_actor,p_session,m.organization_id,m.region,m.city,m.business_line)) then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
      end loop;
    end loop;
    if op='export_prepare' then
      if p_input->>'audience' not in ('internal','client') then raise exception 'PITCH_INVALID'; end if;
      insert into public.pitch_jobs(id,project_id,kind,state,created_by,updated_by)
      values((p_input->>'exportId')::uuid,pid,'export','running',p_actor,p_actor);
      insert into public.pitch_exports(id,project_id,job_id,audience,state,format,storage_path,slide_versions,created_by)
      values((p_input->>'exportId')::uuid,pid,(p_input->>'exportId')::uuid,p_input->>'audience','pending','pptx',
        'exports/'||p_actor||'/'||pid||'/'||(p_input->>'exportId')||'.pptx',
        (select jsonb_agg(jsonb_build_object('id',s.id,'version',s.version) order by position) from public.pitch_project_slides s where project_id=pid),p_actor);
      result:=jsonb_build_object('exportId',p_input->>'exportId');
    else
      select * into e from public.pitch_exports where id=(p_input->>'exportId')::uuid and project_id=pid for update;
      if e.id is null or e.audience is distinct from p_input->>'audience' then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
      if e.audience='client' and (p.is_test_data or not private.pitch_access(p_actor,p_session,p.organization_id,p.region,p.city,p.business_line,'client')) then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
      if op='export_context' then
        return jsonb_build_object('export',to_jsonb(e),'project',to_jsonb(p),
          'slides',(select jsonb_agg(to_jsonb(s) order by s.position) from public.pitch_project_slides s where project_id=pid),
          'themes',(select jsonb_agg(to_jsonb(t)) from public.pitch_theme_versions t where (theme_id,version) in (select theme_id,theme_version from public.pitch_project_slides where project_id=pid)),
          'media',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from public.pitch_media_assets m where (m.id,m.version) in
            (select (b->>'mediaAssetId')::uuid,(b->>'mediaVersion')::integer from public.pitch_project_slides s cross join lateral jsonb_array_elements(s.content->'blocks') b where s.project_id=pid and b->>'kind'='image')));
      elsif op='export_complete' then
        if e.state<>'pending' then raise exception 'PITCH_CONFLICT' using errcode='23505'; end if;
        update public.pitch_exports set state='ready',sha256=p_input->>'sha256',size_bytes=(p_input->>'size')::bigint where id=e.id;
        update public.pitch_jobs set state='succeeded',updated_at=now() where id=e.job_id;
      elsif op='export_fail' then
        if e.state='pending' then
          update public.pitch_exports set state='failed' where id=e.id;
          update public.pitch_jobs set state='failed',error_code='PITCH_EXPORT_FAILED',updated_at=now() where id=e.job_id;
        end if;
      else
        if e.state<>'ready' then raise exception 'PITCH_NOT_READY'; end if;
        result:=to_jsonb(e);
      end if;
    end if;
  elsif op='category_save' then
    if not private.pitch_access(p_actor,p_session,null,null,null,null,'admin') then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
    if p_input->>'systemCode'='general' and p_input->>'enabled'<>'true' then raise exception 'PITCH_INVALID'; end if;
    select to_jsonb(c),c.revision into existing,revision from public.pitch_asset_categories c where id=(p_input->>'id')::uuid for update;
    if found then
      if revision<>(p_input->>'expectedRevision')::integer then raise exception 'PITCH_CONFLICT' using errcode='23505'; end if;
      -- Stable system capability codes cannot be renamed or repurposed.
      if existing->>'system_code'<>p_input->>'systemCode' then raise exception 'PITCH_INVALID'; end if;
      update public.pitch_asset_categories c set names=p_input->'names',enabled=(p_input->>'enabled')::boolean,revision=c.revision+1,updated_by=p_actor,updated_at=now() where id=(p_input->>'id')::uuid;
    else
      insert into public.pitch_asset_categories(id,system_code,names,enabled,updated_by) values((p_input->>'id')::uuid,p_input->>'systemCode',p_input->'names',(p_input->>'enabled')::boolean,p_actor);
    end if;
    result:=jsonb_build_object('categoryId',p_input->>'id');
  else raise exception 'PITCH_INVALID';
  end if;
  insert into private.pitch_events(actor_id,session_id,action,target_id,before_value,after_value)
    values(p_actor,p_session,op,coalesce(p_input->>'projectId',p_input->>'assetId',p_input->>'id','unknown'),existing,coalesce(result,jsonb_build_object('exportId',p_input->>'exportId')));
  return coalesce(result,'{}');
end $$;
create function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.pitch_studio_access(p_actor,p_session,p_input) $$;
revoke all on function private.pitch_studio_access(uuid,uuid,jsonb),public.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb),public.pitch_studio_access(uuid,uuid,jsonb) to service_role;
revoke all on function private.pitch_access(uuid,uuid,text,text,text,text,text),private.pitch_document_visible(uuid,uuid,uuid),private.pitch_media_visible(uuid,uuid,uuid,integer),private.pitch_asset_visible(uuid,uuid,uuid,text),private.pitch_version_visible(uuid,uuid,uuid,integer,text),private.pitch_project_visible(uuid,uuid,uuid,text),private.pitch_session() from public,anon,authenticated,service_role;
grant execute on function private.pitch_access(uuid,uuid,text,text,text,text,text),private.pitch_document_visible(uuid,uuid,uuid),private.pitch_media_visible(uuid,uuid,uuid,integer),private.pitch_asset_visible(uuid,uuid,uuid,text),private.pitch_version_visible(uuid,uuid,uuid,integer,text),private.pitch_project_visible(uuid,uuid,uuid,text),private.pitch_session() to authenticated;
grant usage on schema private to service_role,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('pitch-studio-private','pitch-studio-private',false,25165824,array['application/json','image/png','image/jpeg','image/webp','application/vnd.openxmlformats-officedocument.presentationml.presentation']);
-- No browser storage policies: originals/media/exports are proxied through a fresh
-- authenticated domain RPC. No signed URL can outlive a revoked Pitch grant.

insert into public.pitch_templates values('basic-text-image','{"zh":"基础图文","en":"Text and image"}',(select id from public.pitch_asset_categories where system_code='general'),'published',1);
insert into public.pitch_template_versions(template_id,version,adapter,config,sha256) values('basic-text-image',1,'text-image/1','{"id":"basic-text-image","version":1,"names":{"zh":"基础图文","en":"Text and image"},"categoryCode":"general","assetTypes":["content"],"scenarios":["single-page"],"inputSchema":"text-image-parameters/1","adapter":"text-image/1","dataSources":["content_asset"],"requiredPermissions":["internal_generate"],"layouts":["text-image"],"exports":["pptx"],"ai":"none","missingData":"reject"}','7114b5bfc7b6cd1fa0aed2c66cf6ab790d01c7da93a70dfe2b68daff75f7844b');
insert into public.pitch_layout_definitions values('text-image',1,'text-image/1','{"id":"text-image","version":1,"name":"图文双栏","contentKinds":["paragraph","image"],"engine":"text-image/1","maxBodyCharacters":240}');
insert into public.pitch_design_themes values('colliers-default-v1','published',1);
insert into public.pitch_theme_versions(theme_id,version,definition,sha256) values('colliers-default-v1',1,'{"id":"colliers-default-v1","version":1,"approval":"provisional","width":13.333333,"height":7.5,"colors":{"primary":"25408F","secondary":"777C88","background":"F5F4F1","text":"243044","muted":"596273"},"logo":{"resource":"colliers-brand-assets/1","enabled":true},"fonts":{"zh":"Microsoft YaHei","en":"Arial"},"typography":{"title":30,"body":18},"margin":0.6,"gridGap":0.3,"chartColors":["25408F","778BA5","B1B9C3"],"table":{"headerFill":"E8EBF0","border":"BBC2CB","cellPadding":0.1},"footer":{"enabled":true,"pageNumber":true,"label":"临时主题 · 未经品牌确认"}}','926648cf8aad369771cee2041a7fb6e73fa7920fe98076872ca8f0bb1bc89ac5');
commit;
