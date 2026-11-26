-- Pin exactly the requested slides and recheck every dependency before release.
begin;
alter table public.pitch_exports drop constraint pitch_exports_format_check;
alter table public.pitch_exports add constraint pitch_exports_format_check
  check (format in ('pptx','png','svg','xlsx','pdf'));
update storage.buckets set allowed_mime_types=array_append(allowed_mime_types,'application/pdf')
  where id='pitch-studio-private' and not ('application/pdf'=any(allowed_mime_types));

create function private.pitch_delivery_dependencies(s public.pitch_project_slides, manual boolean) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'assetId',s.asset_id,'assetVersion',s.asset_version,'manual',manual,
    'disclosure',s.content->>'disclosure','testData',s.content->'isTestData',
    'media',coalesce((
      select jsonb_agg(to_jsonb(m) order by m.id,m.version) from (
        select id,version from private.pitch_content_media(s.content)
        union
        select (e->>'mediaAssetId')::uuid,(e->>'mediaVersion')::integer
        from jsonb_array_elements(s.scene->'elements') e where e->>'kind'='image'
      ) m
    ),'[]'::jsonb)
  )
$$;

create function private.pitch_delivery_blockers(p_actor uuid,p_session uuid,audience text,dependencies jsonb)
returns text[] language plpgsql security definer set search_path='' as $$
declare reasons text[] := '{}'; media jsonb;
begin
  if dependencies->>'disclosure' not in ('internal','client_approved') or dependencies->>'disclosure' is null then
    reasons:=array_append(reasons,'restricted');
  elsif audience='client' then
    if dependencies->>'disclosure'<>'client_approved' then reasons:=array_append(reasons,'internal_only'); end if;
    if dependencies->>'testData' is distinct from 'false' then reasons:=array_append(reasons,'test_data'); end if;
    if dependencies->>'manual' is distinct from 'false' then reasons:=array_append(reasons,'manual_review_required'); end if;
  end if;

  if not private.pitch_version_visible(p_actor,p_session,(dependencies->>'assetId')::uuid,
      (dependencies->>'assetVersion')::integer,case when audience='client' then 'client' else 'generate' end) then
    reasons:=array_append(reasons,'source_permission');
  end if;
  for media in select value from jsonb_array_elements(dependencies->'media') loop
    if not private.pitch_media_visible(p_actor,p_session,(media->>'id')::uuid,(media->>'version')::integer)
      or (audience='client' and not exists(
        select 1 from public.pitch_media_assets m
        join public.pitch_source_pages sp on sp.id=m.source_page_id
        join public.pitch_source_documents d on d.id=sp.document_id
        where (m.id,m.version)=((media->>'id')::uuid,(media->>'version')::integer)
          and not d.is_test_data and (not d.library_managed or (d.state='published' and d.allow_client_export))
      )) then
      reasons:=array_append(reasons,'media_permission');
      exit;
    end if;
  end loop;
  return reasons;
end $$;

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_before_delivery;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  op text:=p_input->>'action';
  pid uuid;
  eid uuid;
  project public.pitch_projects;
  artifact public.pitch_exports;
  job public.pitch_jobs;
  audience text;
  requested jsonb;
  options jsonb;
  selected public.pitch_project_slides[];
  manifest jsonb;
  dependencies jsonb;
  pages jsonb;
  item jsonb;
  report jsonb;
  info jsonb;
  audience_allowed boolean;
  target_format text;
begin
  if op is distinct from 'export_eligibility' and coalesce(op,'') not like 'export_%' then
    return private.pitch_studio_access_before_delivery(p_actor,p_session,p_input);
  end if;
  pid:=(p_input->>'projectId')::uuid;
  eid:=(p_input->>'exportId')::uuid;

  if op<>'export_eligibility' and (op<>'export_prepare' or p_input->>'pipeline' is distinct from 'delivery/1')
    and not exists(select 1 from public.pitch_exports e where e.id=eid and e.project_id=pid and e.render_options->>'pipeline'='delivery/1') then
    return private.pitch_studio_access_before_delivery(p_actor,p_session,p_input);
  end if;
  select * into project from public.pitch_projects where id=pid and created_by=p_actor for share;
  if project.id is null
    or not private.pitch_access(p_actor,p_session,project.organization_id,project.region,project.city,project.business_line,'generate')
    or exists(select 1 from public.pitch_workspace_states w where w.project_id=pid and w.deleted_at is not null) then
    raise exception 'PITCH_DENIED' using errcode='42501';
  end if;

  if op='export_prepare' then
    -- Serialize the same requested ID across independent connections and projects.
    perform pg_advisory_xact_lock(hashtextextended(eid::text,6));
  end if;
  select * into artifact from public.pitch_exports e where e.id=eid and e.project_id=pid for update;
  if artifact.id is not null and artifact.render_options->>'pipeline' is distinct from 'delivery/1' then
    return private.pitch_studio_access_before_delivery(p_actor,p_session,p_input);
  end if;
  audience:=coalesce(artifact.audience,p_input->>'audience');
  if audience is null or audience not in ('internal','client') then raise exception 'PITCH_INVALID'; end if;
  if (p_input?'audience') and artifact.id is not null and artifact.audience is distinct from p_input->>'audience' then
    if op='export_prepare' then raise exception 'PITCH_CONFLICT' using errcode='23505'; end if;
    raise exception 'PITCH_DENIED' using errcode='42501';
  end if;
  audience_allowed:=audience='internal' or private.pitch_access(
    p_actor,p_session,project.organization_id,project.region,project.city,project.business_line,'client'
  );

  if op in ('export_prepare','export_eligibility') then
    target_format:=p_input->>'format';
    requested:=coalesce(p_input->'pages',case when p_input?'page' then jsonb_build_array(p_input->'page') end);
    options:=jsonb_strip_nulls(jsonb_build_object('pipeline','delivery/1','page',p_input->'page','pages',p_input->'pages'));
    if op='export_prepare' then
      if target_format not in ('pptx','png','svg','xlsx','pdf') or target_format is null
        or (p_input?'page' and p_input?'pages')
        or (target_format in ('png','svg') and not p_input?'page') then raise exception 'PITCH_INVALID'; end if;
      if artifact.id is not null then
        if artifact.format<>target_format or artifact.render_options<>options then raise exception 'PITCH_CONFLICT' using errcode='23505'; end if;
        return jsonb_build_object('exportId',eid,'replayed',true,'state',artifact.state);
      end if;
    end if;
    if requested is not null and (jsonb_array_length(requested) not between 1 and 50 or
      exists(select 1 from jsonb_array_elements_text(requested) x
        where x::integer<0 or x::integer>=(select count(*) from public.pitch_project_slides where project_id=pid))
      or (select count(distinct x) from jsonb_array_elements_text(requested) x)<>jsonb_array_length(requested)
    ) then raise exception 'PITCH_INVALID'; end if;

    select coalesce(jsonb_agg(r.page order by r.ordinal),'[]'), coalesce(jsonb_agg(r.deps order by r.ordinal),'[]'),
      coalesce(jsonb_agg(jsonb_build_object('id',r.page->'id','version',r.version) order by r.ordinal),'[]')
    into pages,dependencies,manifest
    from (
      select s.version,
        coalesce((select x.ordinal from jsonb_array_elements_text(requested) with ordinality x(value,ordinal)
          where x.value::integer=s.position-1),s.position::bigint) ordinal,
        jsonb_build_object('id',s.id,'position',s.position,
          'reasons',private.pitch_delivery_blockers(p_actor,p_session,audience,auth.deps)) page,
        auth.deps
      from public.pitch_project_slides s left join public.pitch_workspace_states w on w.project_id=s.project_id
      cross join lateral (select private.pitch_delivery_dependencies(s,coalesce(w.page_settings->s.id::text->>'manual'='true',false)) deps) auth
      where s.project_id=pid and (requested is null or requested @> jsonb_build_array(s.position-1))
    ) r;

    report:=jsonb_build_object('projectVersion',project.version,'audienceAllowed',audience_allowed,'pages',pages);
    if op='export_eligibility' then return report; end if;
    if jsonb_array_length(pages)=0 then raise exception 'PITCH_INVALID'; end if;
    if not audience_allowed or exists(select 1 from jsonb_array_elements(pages) x where jsonb_array_length(x->'reasons')>0) then
      return jsonb_build_object('blocked',report);
    end if;
    insert into public.pitch_jobs(id,project_id,kind,state,created_by,updated_by,lease_until)
      values(eid,pid,'export','queued',p_actor,p_actor,clock_timestamp()+interval '120 seconds');
    insert into public.pitch_exports(id,project_id,job_id,audience,state,format,storage_path,slide_versions,created_by,render_options,authorization_snapshot,filename)
      values(eid,pid,eid,audience,'pending',target_format,'exports/'||p_actor||'/'||pid||'/'||eid||'.'||target_format,
        manifest,p_actor,options,dependencies,p_input->>'filename');
    info:=jsonb_build_object('exportId',eid,'state','pending');

  elsif artifact.id is null then
    raise exception 'PITCH_DENIED' using errcode='42501';
  elsif not audience_allowed then
    raise exception 'PITCH_DENIED' using errcode='42501';
  else
    select * into job from public.pitch_jobs where id=artifact.job_id for update;
    if op in ('export_status','export_claim') and job.state in ('queued','running') and job.lease_until<clock_timestamp() then
      update public.pitch_jobs set state='failed',error_code='PITCH_WORKER_TIMEOUT',updated_at=now() where id=job.id;
      update public.pitch_exports set state='failed' where id=artifact.id;
      job.state:='failed'; job.error_code:='PITCH_WORKER_TIMEOUT'; artifact.state:='failed';
      insert into private.pitch_events(actor_id,session_id,action,target_id,after_value)
        values(p_actor,p_session,'export_timeout',eid::text,'{"state":"failed"}');
    end if;
    if op='export_status' then
      return jsonb_build_object('id',eid,'state',artifact.state,'format',artifact.format,'filename',artifact.filename,
        'progress',case when artifact.state='ready' then 100 else 0 end,'error_code',job.error_code,
        'stage',case when job.state='running' and job.progress=85 then 'storing' when job.state='running' then 'rendering' else job.state end);
    elsif op='export_claim' then
      if job.state<>'queued' or artifact.state<>'pending' then return '{"claimed":false}'; end if;
      update public.pitch_jobs set state='running',worker_token=(p_input->>'workerToken')::uuid,
        lease_until=clock_timestamp()+interval '55 seconds',updated_at=now() where id=job.id;
      info:='{"claimed":true}';
    elsif op='export_download' then
      if artifact.state<>'ready' then raise exception 'PITCH_NOT_READY'; end if;
    elsif op in ('export_context','export_verify','export_progress','export_complete','export_fail') then
      if job.state<>'running' or job.worker_token is distinct from (p_input->>'workerToken')::uuid
        or job.lease_until<clock_timestamp() then raise exception 'PITCH_CONFLICT' using errcode='23505'; end if;
    else
      raise exception 'PITCH_INVALID';
    end if;

    if op in ('export_context','export_verify','export_complete','export_download') then
      if artifact.authorization_snapshot is null or
        jsonb_array_length(artifact.authorization_snapshot) is distinct from jsonb_array_length(artifact.slide_versions) then
        raise exception 'PITCH_DENIED' using errcode='42501';
      end if;
      for item in select value from jsonb_array_elements(artifact.authorization_snapshot) loop
        if cardinality(private.pitch_delivery_blockers(p_actor,p_session,audience,item))>0 then
          raise exception 'PITCH_DENIED' using errcode='42501';
        end if;
      end loop;
      if op='export_download' then return to_jsonb(artifact); end if;
      select array_agg(s order by x.ordinality) into selected
      from jsonb_array_elements(artifact.slide_versions) with ordinality x(page,ordinality)
      join public.pitch_project_slides s on s.id=(x.page->>'id')::uuid and s.project_id=pid and s.version=(x.page->>'version')::integer;
      if cardinality(selected) is distinct from jsonb_array_length(artifact.slide_versions) then
        raise exception 'PITCH_CONFLICT' using errcode='23505';
      end if;
    end if;
    if op='export_verify' then return '{}'; end if;
    if op='export_context' then
      return jsonb_build_object('export',to_jsonb(artifact),'project',jsonb_build_object('title',project.title),
        'slides',to_jsonb(selected),'selected',true,
        'themes',(select jsonb_agg(to_jsonb(t)) from public.pitch_theme_versions t
          where (t.theme_id,t.version) in (select s.theme_id,s.theme_version from unnest(selected) s)),
        'media',coalesce((select jsonb_agg(to_jsonb(m)) from public.pitch_media_assets m
          where (m.id,m.version) in (
            select (ref->>'id')::uuid,(ref->>'version')::integer
            from jsonb_array_elements(artifact.authorization_snapshot) d cross join lateral jsonb_array_elements(d->'media') ref
          )),'[]'::jsonb));
    elsif op='export_progress' then
      update public.pitch_jobs set progress=greatest(progress,least(85,(p_input->>'progress')::integer)),updated_at=now() where id=job.id;
      return '{}';
    elsif op='export_complete' then
      update public.pitch_exports set state='ready',sha256=p_input->>'sha256',size_bytes=(p_input->>'size')::bigint where id=eid;
      update public.pitch_jobs set state='succeeded',progress=100,updated_at=now() where id=job.id;
      info:='{"state":"ready"}';
    elsif op='export_fail' then
      update public.pitch_exports set state='failed' where id=eid;
      update public.pitch_jobs set state='failed',error_code=case when p_input->>'errorCode' ~ '^PITCH_[A-Z_]+$'
        then left(p_input->>'errorCode',100) else 'PITCH_EXPORT_FAILED' end,updated_at=now() where id=job.id;
      info:='{"state":"failed"}';
    end if;
  end if;
  if op in ('export_complete','export_fail') then
    insert into private.pitch_ai_events(id,actor_id,event,project_id)
      values(gen_random_uuid(),p_actor,case when op='export_complete' then 'export_completed' else 'export_failed' end,pid);
  end if;
  insert into private.pitch_events(actor_id,session_id,action,target_id,after_value) values(p_actor,p_session,op,eid::text,info);
  return info;
end $$;

revoke all on function private.pitch_studio_access_before_delivery(uuid,uuid,jsonb),
  private.pitch_studio_access(uuid,uuid,jsonb),private.pitch_delivery_dependencies(public.pitch_project_slides,boolean),
  private.pitch_delivery_blockers(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
commit;
