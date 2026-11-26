begin;
create table private.pitch_workspace_shares (
  id uuid primary key,
  project_id uuid not null references public.pitch_projects(id),
  owner_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  version integer not null check(version>0),
  requested_pages uuid[],
  page_ids uuid[] not null check(cardinality(page_ids) between 1 and 50),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check(owner_id<>recipient_id)
);
create index pitch_workspace_shares_project on private.pitch_workspace_shares(project_id, version) where revoked_at is null;
alter table private.pitch_workspace_shares enable row level security;
revoke all on private.pitch_workspace_shares from public,anon,authenticated,service_role;

-- One preserved revision may serve multiple recipients. Ordinary history
-- pruning resumes for it once all shares on it have expired or been revoked.
create function private.pitch_guard_shared_revision() returns trigger
language plpgsql set search_path='' as $$
begin
  if exists(select 1 from private.pitch_workspace_shares share
    where share.project_id=old.project_id and share.version=old.version
      and share.revoked_at is null and (share.expires_at is null or share.expires_at>clock_timestamp()))
  then return null;end if;
  return old;
end $$;
create trigger pitch_guard_shared_revision before delete on private.pitch_workspace_revisions
for each row execute function private.pitch_guard_shared_revision();

create function private.pitch_share_page_allowed(p_actor uuid,p_session uuid,p_owner uuid,s public.pitch_project_slides)
returns boolean language sql set search_path='' as $$
  select coalesce(s.content->>'disclosure' in ('internal','client_approved'),false)
    and exists(
      select 1 from public.pitch_content_assets a
      join public.pitch_asset_versions v on (v.asset_id,v.version)=(a.id,s.asset_version)
      left join public.pitch_business_generations g on g.project_id=a.generated_project_id
      where a.id=s.asset_id and a.state='published' and v.state='published'
        and a.disclosure<>'restricted' and v.disclosure<>'restricted'
        and (a.valid_from is null or a.valid_from<=current_date)
        and (a.valid_until is null or a.valid_until>=current_date)
        and private.pitch_access(p_actor,p_session,a.organization_id,a.region,a.city,a.business_line)
        and not exists(
          select 1 from public.pitch_source_references ref join public.pitch_source_documents d on d.id=ref.document_id
          where (ref.asset_id,ref.asset_version)=(a.id,v.version)
            and (d.state<>'published' or d.valid_from>current_date or d.valid_until<current_date
              or not private.pitch_document_visible(p_actor,p_session,d.id))
        )
        and (
          private.pitch_version_visible(p_actor,p_session,a.id,v.version,'read')
          -- Explicit owner sharing covers application-authored notes. Media and
          -- documents are checked independently below.
          or (
            a.created_by=p_owner and not exists(select 1 from private.pitch_ai_origins o where o.asset_id=a.id)
            and (
              (a.generated_project_id is null and exists(select 1 from private.pitch_workspace_custom_assets x where x.asset_id=a.id))
              -- A compiled static recipe requires independent read access to
              -- each of its original versions.
              or (g.created_by=p_owner and jsonb_array_length(g.snapshots)=0 and jsonb_array_length(g.bindings)>0
                and not exists(select 1 from jsonb_array_elements(g.bindings) b where not exists(
                  select 1 from public.pitch_content_assets sa
                  join public.pitch_asset_versions sv on (sv.asset_id,sv.version)=(sa.id,(b->>'version')::integer)
                  where sa.id=(b->>'id')::uuid and sa.generated_project_id is null
                    and sa.state='published' and sv.state='published'
                    and sa.disclosure<>'restricted' and sv.disclosure<>'restricted'
                    and private.pitch_version_visible(p_actor,p_session,sa.id,sv.version,'read')
                    and not exists(
                      select 1 from public.pitch_source_references ref join public.pitch_source_documents d on d.id=ref.document_id
                      where (ref.asset_id,ref.asset_version)=(sa.id,sv.version)
                        and (d.state<>'published' or d.valid_from>current_date or d.valid_until<current_date)
                    )
                )))
            )
          )
        )
    )
    and not exists(
      select 1 from jsonb_array_elements(s.content->'sources') ref
      where ref?'documentId' and not exists(
        select 1 from public.pitch_source_documents d where d.id=(ref->>'documentId')::uuid
          and d.state='published' and (d.valid_from is null or d.valid_from<=current_date)
          and (d.valid_until is null or d.valid_until>=current_date) and private.pitch_document_visible(p_actor,p_session,d.id)
      )
    )
    and not exists(
      select 1 from jsonb_array_elements(private.pitch_delivery_dependencies(s,false)->'media') ref
      where not exists(
        select 1 from public.pitch_media_assets m
        join public.pitch_source_pages sp on sp.id=m.source_page_id
        join public.pitch_source_documents d on d.id=sp.document_id
        where (m.id,m.version)=((ref->>'id')::uuid,(ref->>'version')::integer)
          and m.state='published' and d.state='published'
          and (d.valid_from is null or d.valid_from<=current_date) and (d.valid_until is null or d.valid_until>=current_date)
          and private.pitch_media_visible(p_actor,p_session,m.id,m.version)
      )
    )
$$;

create function private.pitch_share_receipt(s private.pitch_workspace_shares) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',s.id,'projectId',s.project_id,'recipientId',s.recipient_id,'version',s.version,
    'pageIds',s.page_ids,'createdAt',s.created_at,'expiresAt',s.expires_at,'revokedAt',s.revoked_at)
$$;

alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_before_sharing;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  op text:=p_input->>'action';
  pid uuid;
  sid uuid;
  project public.pitch_projects;
  share private.pitch_workspace_shares;
  snapshot jsonb;
  requested uuid[];
  page_ids uuid[];
  pages public.pitch_project_slides[];
  selected public.pitch_project_slides;
  item public.pitch_project_slides;
  recipient uuid;
  expiry timestamptz;
  outcome jsonb;
begin
  if coalesce(op,'') not in ('workspace_share_create','workspace_share_revoke','workspace_shares',
    'workspace_shared_presentation','workspace_shared_slide','workspace_share_verify') then
    return private.pitch_studio_access_before_sharing(p_actor,p_session,p_input);
  end if;
  sid:=(p_input->>'shareId')::uuid;
  if op in ('workspace_share_create','workspace_share_revoke','workspace_shares') then
    pid:=(p_input->>'projectId')::uuid;
    select * into project from public.pitch_projects where id=pid and created_by=p_actor for update;
    if project.id is null or not private.pitch_access(p_actor,p_session,project.organization_id,project.region,project.city,project.business_line,'generate') then
      raise exception 'PITCH_DENIED' using errcode='42501';
    end if;
    if op='workspace_shares' then
      return (select coalesce(jsonb_agg(private.pitch_share_receipt(s.entry)
          order by (s.entry).created_at desc,(s.entry).id),'[]'::jsonb)
        from (select ps entry from private.pitch_workspace_shares ps where ps.project_id=pid and ps.owner_id=p_actor
          order by ps.created_at desc,ps.id limit 50) s);
    end if;
    select * into share from private.pitch_workspace_shares where id=sid and project_id=pid and owner_id=p_actor for update;
    if op='workspace_share_revoke' then
      if share.id is null then raise exception 'PITCH_DENIED' using errcode='42501';end if;
      if share.revoked_at is not null then return private.pitch_share_receipt(share);end if;
      update private.pitch_workspace_shares set revoked_at=clock_timestamp() where id=sid returning * into share;
    else
      if not private.pitch_project_visible(p_actor,p_session,pid,'generate') then
        raise exception 'PITCH_DENIED' using errcode='42501';
      end if;
      recipient:=(p_input->>'recipientId')::uuid;
      expiry:=(p_input->>'expiresAt')::timestamptz;
      if p_input?'slideIds' then
        select array_agg(v::uuid order by ord) into requested
          from jsonb_array_elements_text(p_input->'slideIds') with ordinality t(v,ord);
        if requested is null or cardinality(requested)>50
          or cardinality(requested)<>(select count(distinct id) from unnest(requested) refs(id))
        then raise exception 'PITCH_INVALID';end if;
      end if;
      if share.id is not null then
        if share.version is distinct from (p_input->>'expectedVersion')::integer
          or share.recipient_id is distinct from recipient or share.requested_pages is distinct from requested
          or share.expires_at is distinct from expiry
        then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
        return private.pitch_share_receipt(share);
      end if;
      if project.version is distinct from (p_input->>'expectedVersion')::integer then
        raise exception 'PITCH_CONFLICT' using errcode='23505';
      end if;
      if recipient is null or recipient=p_actor or (expiry is not null and expiry<=clock_timestamp()) then raise exception 'PITCH_INVALID';end if;
      -- Receipt creation also works while a recipient is signed out. Opening
      -- the link requires the recipient's actual current session and grants.
      if not exists(select 1 from auth.users u join public.user_roles r on r.user_id=u.id
        join private.pitch_grants gr on gr.user_id=u.id
        where u.id=recipient and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
          and r.role in ('viewer','editor','admin') and gr.enabled and gr.can_search and gr.valid_until>clock_timestamp()
          and gr.organization_id=project.organization_id
          and (gr.region is null or gr.region=project.region) and (gr.city is null or gr.city=project.city)
          and (gr.business_line is null or gr.business_line=project.business_line))
      then raise exception 'PITCH_DENIED' using errcode='42501';end if;

      select array_agg(s.id order by coalesce(array_position(requested,s.id),s.position)),
             array_agg(s order by coalesce(array_position(requested,s.id),s.position))
        into page_ids,pages from public.pitch_project_slides s
        where s.project_id=pid and (requested is null or s.id=any(requested));
      if pages is null or cardinality(pages)>50
        or (requested is not null and cardinality(pages)<>cardinality(requested)) then raise exception 'PITCH_INVALID';end if;
      foreach item in array pages loop
        if cardinality(private.pitch_delivery_blockers(p_actor,p_session,'internal',private.pitch_delivery_dependencies(item,false)))>0
          or exists(select 1 from public.pitch_content_assets a join public.pitch_business_generations g on g.project_id=a.generated_project_id
            where a.id=item.asset_id and jsonb_array_length(g.snapshots)>0)
        then raise exception 'PITCH_DENIED' using errcode='42501';end if;
      end loop;

      insert into private.pitch_workspace_revisions(project_id,version,snapshot)
      select pid,project.version,jsonb_build_object('project',to_jsonb(project),
        'workspace',coalesce((select to_jsonb(x) from public.pitch_workspace_states x where x.project_id=pid),'{"context":{},"page_settings":{},"active_slide":null}'::jsonb),
        'slides',(select jsonb_agg(to_jsonb(s) order by s.position) from public.pitch_project_slides s where s.project_id=pid))
      on conflict(project_id,version) do nothing;
      insert into private.pitch_workspace_shares(id,project_id,owner_id,recipient_id,version,requested_pages,page_ids,expires_at)
        values(sid,pid,p_actor,recipient,project.version,requested,page_ids,expiry) returning * into share;
    end if;
    outcome:=private.pitch_share_receipt(share);
  else
    select s.project_id into pid from private.pitch_workspace_shares s where s.id=sid and s.recipient_id=p_actor;
    select * into project from public.pitch_projects where id=pid for share;
    select * into share from private.pitch_workspace_shares s where s.id=sid and s.recipient_id=p_actor for share;
    if project.id is null or share.id is null or share.owner_id<>project.created_by or share.revoked_at is not null
      or (share.expires_at is not null and share.expires_at<=clock_timestamp())
      or exists(select 1 from public.pitch_workspace_states x where x.project_id=pid and x.deleted_at is not null)
      or not exists(select 1 from auth.users u where u.id=share.owner_id and u.deleted_at is null
        and (u.banned_until is null or u.banned_until<=clock_timestamp()))
      or not private.pitch_access(p_actor,p_session,project.organization_id,project.region,project.city,project.business_line,'read')
    then raise exception 'PITCH_DENIED' using errcode='42501';end if;
    select r.snapshot into snapshot from private.pitch_workspace_revisions r where r.project_id=pid and r.version=share.version;
    select array_agg(s order by array_position(share.page_ids,s.id)) into pages
      from jsonb_populate_recordset(null::public.pitch_project_slides,snapshot->'slides') s where s.id=any(share.page_ids);
    if cardinality(pages) is distinct from cardinality(share.page_ids) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
    foreach item in array pages loop
      if not private.pitch_share_page_allowed(p_actor,p_session,share.owner_id,item) then
        raise exception 'PITCH_DENIED' using errcode='42501';
      end if;
    end loop;
    if op='workspace_share_verify' then return '{}'::jsonb;end if;
    if op='workspace_shared_slide' then
      select * into selected from unnest(pages) p where p.id=(p_input->>'slideId')::uuid;
      if selected.id is null then raise exception 'PITCH_DENIED' using errcode='42501';end if;
      outcome:=jsonb_build_object('id',selected.id,'scene',selected.scene,
        'theme',(select t.definition from public.pitch_theme_versions t where (t.theme_id,t.version)=(selected.theme_id,selected.theme_version)),
        'media',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from public.pitch_media_assets m
          where (m.id,m.version) in (
            select (ref->>'id')::uuid,(ref->>'version')::integer
            from jsonb_array_elements(private.pitch_delivery_dependencies(selected,false)->'media') ref)));
    else
      outcome:=jsonb_build_object('id',sid,'version',share.version,'expiresAt',share.expires_at,
        'title',snapshot->'project'->>'title',
        'pages',(select jsonb_agg(jsonb_build_object('id',s.id,'title',s.content->>'title') order by array_position(share.page_ids,s.id))
          from unnest(pages) s));
    end if;
  end if;
  insert into private.pitch_events(actor_id,session_id,action,target_id,after_value)
    values(p_actor,p_session,op,sid::text,jsonb_build_object('projectId',pid,'version',share.version));
  return outcome;
end $$;
revoke all on function private.pitch_guard_shared_revision(),private.pitch_share_receipt(private.pitch_workspace_shares),
  private.pitch_share_page_allowed(uuid,uuid,uuid,public.pitch_project_slides),
  private.pitch_studio_access_before_sharing(uuid,uuid,jsonb),private.pitch_studio_access(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
create or replace function public.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pitch_studio_access(p_actor,p_session,p_input)$$;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
commit;
