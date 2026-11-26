-- Historical sources remain immutable. Library metadata and parser snapshots
-- are versioned independently from the source bytes and generated projects.
alter table public.pitch_source_documents alter column data_as_of drop not null;
alter table public.pitch_source_documents add column library_managed boolean not null default false;
alter table public.pitch_source_documents add column root_document_id uuid references public.pitch_source_documents(id);
alter table public.pitch_source_documents add column revision integer not null default 1;
alter table public.pitch_source_documents add column upload_state text not null default 'ready' check(upload_state in ('uploading','ready','cancelled'));
alter table public.pitch_source_documents add column category_id uuid references public.pitch_asset_categories(id);
alter table public.pitch_source_documents add column tags text[] not null default '{}';
alter table public.pitch_source_documents add column source_description text not null default '';
alter table public.pitch_source_documents add column allow_client_export boolean not null default false;
alter table public.pitch_source_documents add column dedup_key text;
create unique index pitch_document_dedup on public.pitch_source_documents(dedup_key) where dedup_key is not null;
alter table public.pitch_source_pages drop constraint pitch_source_pages_document_id_ordinal_key;
alter table public.pitch_source_pages add unique(document_id,parser_version,ordinal);
alter table public.pitch_source_pages add column structure jsonb;
alter table public.pitch_source_pages add column parse_state text check(parse_state in ('completed','partial','manual'));
alter table public.pitch_source_pages add column hidden boolean not null default false;
alter table public.pitch_source_pages add column category_candidates jsonb not null default '[]';
alter table public.pitch_source_pages add column thumbnail jsonb;
alter table public.pitch_source_pages add column category_id uuid references public.pitch_asset_categories(id);
alter table public.pitch_source_pages add column asset_id uuid references public.pitch_content_assets(id);
alter table public.pitch_source_pages add column search_tokens text[] not null default '{}';
alter table public.pitch_media_assets alter column data_as_of drop not null;
alter table public.pitch_media_assets drop constraint pitch_media_assets_storage_path_key;
alter table public.pitch_media_assets drop constraint pitch_media_assets_size_bytes_check;
alter table public.pitch_media_assets add check(size_bytes between 1 and 12582912);
alter table public.pitch_media_assets add column pixel_width integer;
alter table public.pitch_media_assets add column pixel_height integer;
alter table public.pitch_media_assets add column thumbnail jsonb;
alter table public.pitch_content_assets add column imported_from_page uuid references public.pitch_source_pages(id);
alter table public.pitch_content_assets add column variant_of uuid references public.pitch_content_assets(id);
alter table public.pitch_content_assets add column search_tokens text[] not null default '{}';
alter table public.pitch_projects add column normalization_report jsonb;
create index pitch_library_page_tokens on public.pitch_source_pages using gin(search_tokens);
create index pitch_library_asset_tokens on public.pitch_content_assets using gin(search_tokens);
create index pitch_library_page_text on public.pitch_source_pages using gin(to_tsvector('simple',extracted_text));
create index pitch_library_document_scope on public.pitch_source_documents(organization_id,region,city,business_line,state,id);
create index pitch_library_asset_scope on public.pitch_content_assets(organization_id,region,city,business_line,state,id);
create table public.pitch_parse_jobs (
 id uuid primary key,document_id uuid not null references public.pitch_source_documents(id),parser_version text not null,
 state text not null default 'queued' check(state in ('queued','processing','completed','partially_completed','failed','cancelled')),
 cursor integer not null default 0 check(cursor between 0 and 120),total_pages integer check(total_pages between 1 and 120),
 progress integer not null default 0 check(progress between 0 and 100),partial_count integer not null default 0,
 attempts integer not null default 0 check(attempts between 0 and 3),worker_token uuid,lease_until timestamptz,error_code text,
 metadata jsonb not null,request_key text not null,created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(created_by,request_key),unique(document_id,parser_version)
);
create table public.pitch_upload_parts (
 job_id uuid not null references public.pitch_parse_jobs(id),position integer not null check(position between 0 and 15),file jsonb not null,primary key(job_id,position)
);
create table public.pitch_media_occurrences (
 page_id uuid not null references public.pitch_source_pages(id),media_id uuid not null,media_version integer not null,position integer not null,
 placement jsonb not null,primary key(page_id,position),foreign key(media_id,media_version) references public.pitch_media_assets(id,version)
);
create table public.pitch_asset_links (
 target_id uuid not null references public.pitch_content_assets(id),source_id uuid not null references public.pitch_content_assets(id),source_version integer not null,
 kind text not null check(kind in ('merge','regional','language')),created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),primary key(target_id,source_id,kind)
);
-- Draft enterprise imports are available to current maintainers in the exact
-- scope. Private legacy drafts and other users' personal projects stay private.
create or replace function private.pitch_document_visible(p_user uuid,p_session uuid,p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pitch_source_documents d where d.id=p_id and private.pitch_access(p_user,p_session,d.organization_id,d.region,d.city,d.business_line)
 and (d.created_by=p_user or d.visibility='organization' and (d.state='published' or d.library_managed and private.pitch_access(p_user,p_session,d.organization_id,d.region,d.city,d.business_line,'maintain')))
 and ((d.valid_from is null or d.valid_from<=current_date) and (d.valid_until is null or d.valid_until>=current_date) or d.library_managed and private.pitch_access(p_user,p_session,d.organization_id,d.region,d.city,d.business_line,'maintain')))
$$;
create or replace function private.pitch_asset_visible(p_user uuid,p_session uuid,p_id uuid,p_cap text default 'read') returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pitch_content_assets a where a.id=p_id
 and private.pitch_access(p_user,p_session,a.organization_id,a.region,a.city,a.business_line,p_cap)
 and (a.created_by=p_user or a.visibility='organization' and (a.state='published' or a.imported_from_page is not null and private.pitch_access(p_user,p_session,a.organization_id,a.region,a.city,a.business_line,'maintain')))
 and ((a.state<>'archived' and (a.valid_from is null or a.valid_from<=current_date) and (a.valid_until is null or a.valid_until>=current_date)) or p_cap='read' and a.imported_from_page is not null and private.pitch_access(p_user,p_session,a.organization_id,a.region,a.city,a.business_line,'maintain'))
 and case p_cap when 'generate' then a.allow_internal_generation when 'client' then a.state='published' and a.allow_client_export and a.disclosure='client_approved' and not a.is_test_data when 'ai' then a.state='published' and a.allow_external_ai and not a.is_test_data else true end)
$$;
create or replace function private.pitch_media_visible(p_user uuid,p_session uuid,p_id uuid,p_version integer) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pitch_media_assets m join public.pitch_source_pages sp on sp.id=m.source_page_id join public.pitch_source_documents d on d.id=sp.document_id
 where m.id=p_id and m.version=p_version and private.pitch_access(p_user,p_session,m.organization_id,m.region,m.city,m.business_line)
 and private.pitch_document_visible(p_user,p_session,d.id) and (not d.library_managed or m.created_by=p_user or private.pitch_access(p_user,p_session,m.organization_id,m.region,m.city,m.business_line,'maintain') or exists(select 1 from public.pitch_media_occurrences o join public.pitch_source_pages op on op.id=o.page_id join public.pitch_content_assets oa on oa.id=op.asset_id where o.media_id=m.id and o.media_version=m.version and not op.hidden and oa.state='published' and oa.visibility='organization')) and (m.created_by=p_user or m.state='published' or d.library_managed and d.visibility='organization' and private.pitch_access(p_user,p_session,m.organization_id,m.region,m.city,m.business_line,'maintain'))
 and m.state<>'archived' and (d.library_managed or not sp.hidden or private.pitch_access(p_user,p_session,m.organization_id,m.region,m.city,m.business_line,'maintain'))
 and (m.valid_from is null or m.valid_from<=current_date) and (m.valid_until is null or m.valid_until>=current_date))
$$;
-- Every generated/exported version retains the current source-scope dependency.
create or replace function private.pitch_version_visible(p_user uuid,p_session uuid,p_id uuid,p_version integer,p_cap text default 'read') returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pitch_asset_versions v join public.pitch_content_assets a on a.id=v.asset_id where v.asset_id=p_id and v.version=p_version and private.pitch_asset_visible(p_user,p_session,p_id,p_cap)
 and (a.created_by=p_user or v.visibility='organization' and (v.state='published' or a.imported_from_page is not null and private.pitch_access(p_user,p_session,a.organization_id,a.region,a.city,a.business_line,'maintain')))
 and not exists(select 1 from public.pitch_source_references r join public.pitch_source_documents d on d.id=r.document_id where r.asset_id=p_id and r.asset_version=p_version and (not private.pitch_document_visible(p_user,p_session,d.id) or p_cap<>'read' and (d.state='archived' or d.valid_from>current_date or d.valid_until<current_date) or p_cap='client' and d.library_managed and (d.state<>'published' or not d.allow_client_export or d.is_test_data)))
 and case p_cap when 'generate' then v.allow_internal_generation when 'client' then v.state='published' and v.allow_client_export and v.disclosure='client_approved' and not v.is_test_data when 'ai' then v.state='published' and v.allow_external_ai and not v.is_test_data else true end)
$$;
-- Source bytes, file identity and business dating can only change by uploading a
-- new source version. Classification/publication metadata remains maintainable.
create function private.pitch_source_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if old.library_managed and (new.storage_path,new.sha256,new.size_bytes,new.mime,new.filename,new.version,new.root_document_id,new.data_as_of,new.created_by) is distinct from (old.storage_path,old.sha256,old.size_bytes,old.mime,old.filename,old.version,old.root_document_id,old.data_as_of,old.created_by) then raise exception 'PITCH_SOURCE_IMMUTABLE';end if;
 return new;
end $$;
create trigger pitch_source_immutable before update on public.pitch_source_documents for each row execute function private.pitch_source_immutable();
-- Existing table policies also use these helpers. Hidden sources are never a
-- published-page search result; raw originals remain authorized internal files.
drop policy pitch_source_pages_read on public.pitch_source_pages;
create policy pitch_source_pages_read on public.pitch_source_pages for select to authenticated using(private.pitch_document_visible(auth.uid(),private.pitch_session(),document_id) and exists(select 1 from public.pitch_source_documents d where d.id=document_id and (private.pitch_access(auth.uid(),private.pitch_session(),d.organization_id,d.region,d.city,d.business_line,'maintain') or not hidden and (not d.library_managed or exists(select 1 from public.pitch_content_assets a where a.id=asset_id and a.state='published' and private.pitch_version_visible(auth.uid(),private.pitch_session(),a.id,a.current_version))))));
alter table public.pitch_parse_jobs enable row level security;
alter table public.pitch_upload_parts enable row level security;
alter table public.pitch_media_occurrences enable row level security;
alter table public.pitch_asset_links enable row level security;
revoke all on public.pitch_parse_jobs,public.pitch_upload_parts,public.pitch_media_occurrences,public.pitch_asset_links from public,anon,authenticated,service_role;
grant select on public.pitch_parse_jobs,public.pitch_media_occurrences,public.pitch_asset_links to authenticated;
create policy pitch_parse_jobs_read on public.pitch_parse_jobs for select to authenticated using(exists(select 1 from public.pitch_source_documents d where d.id=document_id and private.pitch_document_visible(auth.uid(),private.pitch_session(),d.id) and private.pitch_access(auth.uid(),private.pitch_session(),d.organization_id,d.region,d.city,d.business_line,'maintain')));
create policy pitch_occurrences_read on public.pitch_media_occurrences for select to authenticated using(private.pitch_media_visible(auth.uid(),private.pitch_session(),media_id,media_version) and exists(select 1 from public.pitch_source_pages sp where sp.id=page_id));
create policy pitch_asset_links_read on public.pitch_asset_links for select to authenticated using(private.pitch_version_visible(auth.uid(),private.pitch_session(),target_id,(select current_version from public.pitch_content_assets where id=target_id)) and private.pitch_version_visible(auth.uid(),private.pitch_session(),source_id,source_version));
update storage.buckets set file_size_limit=25165824,allowed_mime_types=array['application/json','application/octet-stream','text/plain','application/pdf','image/png','image/jpeg','image/webp','image/svg+xml','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.wordprocessingml.document'] where id='pitch-studio-private';
alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_v2;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare op text:=p_input->>'action';d public.pitch_source_documents;j public.pitch_parse_jobs;a public.pitch_content_assets;v public.pitch_asset_versions;sp public.pitch_source_pages;
 item jsonb;ref jsonb;result jsonb;metadata jsonb;scope jsonb;pid uuid;aid uuid;did uuid;pageid uuid;key text;cap text;counter integer:=0;revision integer;parts jsonb;is_maintainer boolean;
begin
 perform private.pitch_studio_access_v2(p_actor,p_session,'{"action":"catalog"}');
 if op='library_prepare' then
  metadata:=p_input->'metadata';scope:=metadata->'scope';
  if not private.pitch_access(p_actor,p_session,scope->>'organizationId',scope->>'region',scope->>'city',scope->>'businessLine','maintain') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  key:=p_input->>'dedupKey';perform pg_advisory_xact_lock(hashtextextended(key,0));
  select * into j from public.pitch_parse_jobs where created_by=p_actor and request_key=p_input->>'requestId';
  if found then
   if j.metadata is distinct from metadata or (select sha256 from public.pitch_source_documents where id=j.document_id)<>p_input->>'sha256' then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
   return jsonb_build_object('job',to_jsonb(j),'documentId',j.document_id,'replayed',true);
  end if;
  select * into d from public.pitch_source_documents where dedup_key=key;
  if found then return jsonb_build_object('job',(select to_jsonb(x) from public.pitch_parse_jobs x where document_id=d.id order by created_at desc limit 1),'documentId',d.id,'duplicate',true);end if;
  if (select count(*) from public.pitch_source_documents where created_by=p_actor and upload_state='uploading')>=20 then raise exception 'PITCH_INVALID';end if;
  did:=(p_input->>'documentId')::uuid;revision:=1;
  if p_input->>'versionOf' is not null then
   select * into d from public.pitch_source_documents where id=(p_input->>'versionOf')::uuid for update;
   if d.id is null or not private.pitch_document_visible(p_actor,p_session,d.id) or d.created_by<>p_actor or d.organization_id<>scope->>'organizationId' or d.region<>scope->>'region' or d.city<>scope->>'city' or d.business_line<>scope->>'businessLine' then raise exception 'PITCH_DENIED' using errcode='42501';end if;
   perform pg_advisory_xact_lock(hashtextextended(coalesce(d.root_document_id,d.id)::text,1));
   revision:=(select coalesce(max(version),0)+1 from public.pitch_source_documents where id=coalesce(d.root_document_id,d.id) or root_document_id=coalesce(d.root_document_id,d.id));
  end if;
  insert into public.pitch_source_documents(id,version,root_document_id,filename,mime,storage_path,sha256,size_bytes,language,is_test_data,visibility,created_by,updated_by,organization_id,region,city,business_line,state,data_as_of,valid_from,valid_until,library_managed,upload_state,category_id,tags,source_description,allow_client_export,dedup_key)
  values(did,revision,case when d.id is not null then coalesce(d.root_document_id,d.id) end,p_input->>'filename',p_input->>'mime',p_input->>'storagePath',p_input->>'sha256',(p_input->>'size')::bigint,metadata->>'language',(metadata->>'isTestData')::boolean,metadata->>'visibility',p_actor,p_actor,scope->>'organizationId',scope->>'region',scope->>'city',scope->>'businessLine','draft',(metadata->>'dataAsOf')::date,(metadata->>'validFrom')::date,(metadata->>'validUntil')::date,true,'uploading',(metadata->>'categoryId')::uuid,array(select jsonb_array_elements_text(metadata->'tags')),metadata->>'source',(metadata->>'allowClientExport')::boolean,key);
  insert into public.pitch_parse_jobs(id,document_id,parser_version,metadata,request_key,created_by,updated_by) values((p_input->>'jobId')::uuid,did,p_input->>'parserVersion',metadata,p_input->>'requestId',p_actor,p_actor) returning * into j;
  result:=jsonb_build_object('job',to_jsonb(j),'documentId',did);
 elsif op like 'library_job_%' or op in ('library_part_context','library_part_commit','library_upload_complete','library_page_commit') then
  select * into j from public.pitch_parse_jobs where id=(p_input->>'jobId')::uuid for update;select * into d from public.pitch_source_documents where id=j.document_id for update;
  if j.id is null or not private.pitch_document_visible(p_actor,p_session,d.id) or not private.pitch_access(p_actor,p_session,d.organization_id,d.region,d.city,d.business_line,'maintain') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  if op='library_job_status' then
   if j.state='processing' and j.lease_until<clock_timestamp() then
    update public.pitch_parse_jobs set state=case when attempts<3 then 'queued' else 'failed' end,attempts=least(3,attempts+1),error_code='PITCH_PARSE_TIMEOUT',worker_token=null,lease_until=null,updated_at=now() where id=j.id returning * into j;
    insert into private.pitch_events(actor_id,session_id,action,target_id,after_value) values(p_actor,p_session,'library_timeout',j.id::text,to_jsonb(j)-'metadata');
   end if;
   return jsonb_build_object('job',to_jsonb(j),'document',to_jsonb(d),'parts',coalesce((select jsonb_agg(to_jsonb(x) order by position) from public.pitch_upload_parts x where job_id=j.id),'[]'));
  elsif op='library_part_context' then
   if d.upload_state<>'uploading' or j.state='cancelled' then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
   return jsonb_build_object('document',to_jsonb(d),'job',to_jsonb(j),'parts',coalesce((select jsonb_agg(to_jsonb(x) order by position) from public.pitch_upload_parts x where job_id=j.id),'[]'));
  elsif op='library_part_commit' then
   if d.upload_state<>'uploading' or j.state='cancelled' then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
   if exists(select 1 from public.pitch_upload_parts x where job_id=j.id and position=(p_input->>'position')::integer and file<>p_input->'file') then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
   insert into public.pitch_upload_parts values(j.id,(p_input->>'position')::integer,p_input->'file') on conflict do nothing;return '{}';
  elsif op='library_upload_complete' then
   if j.state='cancelled' then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
   update public.pitch_source_documents set upload_state='ready',updated_at=now() where id=d.id;result:=jsonb_build_object('jobId',j.id);
  elsif op='library_job_cancel' then
   if j.state in ('completed','partially_completed') then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
   if d.upload_state='uploading' then update public.pitch_source_documents set upload_state='cancelled',dedup_key=null where id=d.id;end if;
   update public.pitch_parse_jobs set state='cancelled',worker_token=null,lease_until=null,updated_by=p_actor,updated_at=now() where id=j.id;result:='{"state":"cancelled"}';
  elsif op='library_job_retry' then
   if j.state not in ('failed','cancelled') or j.attempts>=3 or d.upload_state<>'ready' then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
   update public.pitch_parse_jobs set state='queued',attempts=attempts+1,error_code=null,worker_token=null,updated_by=p_actor,updated_at=now() where id=j.id;result:='{"state":"queued"}';
  elsif op='library_job_claim' then
   perform pg_advisory_xact_lock(92611723);
   if j.state<>'queued' or d.upload_state<>'ready' or (select count(*) from public.pitch_parse_jobs where state='processing' and lease_until>clock_timestamp())>=4 or (select count(*) from public.pitch_parse_jobs where state='processing' and lease_until>clock_timestamp() and created_by=j.created_by)>=2 then return '{"claimed":false}';end if;
   update public.pitch_parse_jobs set state='processing',worker_token=(p_input->>'workerToken')::uuid,lease_until=now()+interval '50 seconds',updated_by=p_actor,updated_at=now() where id=j.id returning * into j;
   result:=jsonb_build_object('claimed',true,'job',to_jsonb(j),'document',to_jsonb(d));
  else
   if j.state<>'processing' or j.worker_token is distinct from (p_input->>'workerToken')::uuid or j.lease_until<clock_timestamp() then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
   if op='library_job_release' then update public.pitch_parse_jobs set state=case when cursor=total_pages then case when partial_count>0 then 'partially_completed' else 'completed' end else 'queued' end,worker_token=null,lease_until=null,progress=case when cursor=total_pages then 100 else progress end,updated_at=now() where id=j.id;result:='{}';
   elsif op='library_job_fail' then update public.pitch_parse_jobs set state='failed',error_code=case when p_input->>'errorCode' ~ '^PITCH_[A-Z_]+$' then p_input->>'errorCode' else 'PITCH_PARSE_FAILED' end,worker_token=null,lease_until=null,updated_at=now() where id=j.id;result:='{}';
   elsif op='library_page_commit' then
    item:=p_input->'page';pageid:=(p_input->>'pageId')::uuid;
    if (item->>'ordinal')::integer<>j.cursor+1 or (p_input->>'totalPages')::integer not between j.cursor+1 and 120 then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
    insert into public.pitch_source_pages(id,document_id,ordinal,locator,extracted_text,parser_version,structure,parse_state,hidden,category_candidates,thumbnail,search_tokens,category_id)
    values(pageid,d.id,(item->>'ordinal')::integer,item->>'locator',p_input->>'text',j.parser_version,item,item->>'status',(item->>'hidden')::boolean,p_input->'categories',p_input->'thumbnail',array(select jsonb_array_elements_text(p_input->'tokens')),coalesce((p_input->'asset'->>'categoryId')::uuid,d.category_id));
    for ref in select value from jsonb_array_elements(p_input->'media') loop
     insert into public.pitch_media_assets(id,version,source_page_id,storage_path,mime,sha256,size_bytes,alt,created_by,updated_by,organization_id,region,city,business_line,state,data_as_of,pixel_width,pixel_height,thumbnail)
     values((ref->>'id')::uuid,1,pageid,ref->'file'->>'path',ref->'file'->>'mime',ref->'file'->>'sha256',(ref->'file'->>'size')::bigint,ref->>'alt',p_actor,p_actor,d.organization_id,d.region,d.city,d.business_line,'draft',d.data_as_of,(ref->>'width')::integer,(ref->>'height')::integer,ref->'thumbnail') on conflict(id,version) do nothing;
    end loop;
    counter:=0;for ref in select value from jsonb_array_elements(item->'images') loop
     if ref->>'mediaId' is not null then insert into public.pitch_media_occurrences values(pageid,(ref->>'mediaId')::uuid,1,counter,ref);end if;counter:=counter+1;
    end loop;
    if p_input->'asset' is not null and p_input->'asset'<>'null'::jsonb then
     aid:=(p_input->>'assetId')::uuid;perform private.pitch_studio_access_v2(p_actor,p_session,jsonb_build_object('action','asset_save','assetId',aid,'expectedVersion',0,'asset',p_input->'asset','sha256',p_input->>'contentSha'));
     update public.pitch_content_assets set imported_from_page=pageid,search_tokens=array(select jsonb_array_elements_text(p_input->'tokens')) where id=aid;update public.pitch_source_pages set asset_id=aid where id=pageid;
    end if;
    update public.pitch_parse_jobs set cursor=cursor+1,total_pages=(p_input->>'totalPages')::integer,progress=floor(100.0*(cursor+1)/(p_input->>'totalPages')::integer),partial_count=partial_count+case when item->>'status'<>'completed' or p_input->'asset'='null'::jsonb then 1 else 0 end,updated_at=now() where id=j.id;result:=jsonb_build_object('pageId',pageid,'assetId',aid);
   else raise exception 'PITCH_INVALID';end if;
  end if;
 elsif op in ('library_search','library_document','library_page','library_media','library_original','library_asset','library_versions') then
  if op='library_search' then
   -- A library visit reconciles expired leases in a bounded, audited batch.
   for j in select jobs.* from public.pitch_parse_jobs jobs join public.pitch_source_documents sd on sd.id=jobs.document_id
    where jobs.state='processing' and jobs.lease_until<clock_timestamp() and private.pitch_document_visible(p_actor,p_session,sd.id) and private.pitch_access(p_actor,p_session,sd.organization_id,sd.region,sd.city,sd.business_line,'maintain') order by jobs.lease_until limit 20 for update of jobs skip locked loop
    update public.pitch_parse_jobs set state=case when attempts<3 then 'queued' else 'failed' end,attempts=least(3,attempts+1),error_code='PITCH_PARSE_TIMEOUT',worker_token=null,lease_until=null,updated_at=now() where id=j.id;
    insert into private.pitch_events(actor_id,session_id,action,target_id,after_value) values(p_actor,p_session,'library_timeout',j.id::text,'{}');
   end loop;
   if p_input->>'kind'='assets' then
    return coalesce((select jsonb_agg(to_jsonb(x)) from (select a.id,a.names,a.state,a.current_version,a.tags,a.region,a.city,a.business_line,a.data_as_of,a.is_test_data,a.imported_from_page from public.pitch_content_assets a join public.pitch_asset_versions v on v.asset_id=a.id and v.version=a.current_version
     where a.imported_from_page is not null and private.pitch_version_visible(p_actor,p_session,a.id,a.current_version) and (not p_input ? 'before' or a.id<(p_input->>'before')::uuid)
     and (not p_input ? 'q' or a.names::text ilike '%'||(p_input->>'escapedQuery')||'%' escape '\' or array_to_string(a.tags,' ') ilike '%'||(p_input->>'escapedQuery')||'%' escape '\' or v.content::text ilike '%'||(p_input->>'escapedQuery')||'%' escape '\' or a.search_tokens @> array(select jsonb_array_elements_text(p_input->'tokens')) and jsonb_array_length(p_input->'tokens')>0)
     and (not p_input ? 'region' or a.region=p_input->>'region') and (not p_input ? 'city' or a.city=p_input->>'city') and (not p_input ? 'line' or a.business_line=p_input->>'line') and (not p_input ? 'categoryId' or a.category_id=(p_input->>'categoryId')::uuid) and (not p_input ? 'state' or a.state=p_input->>'state') and (not p_input ? 'tag' or p_input->>'tag'=any(a.tags))
     and (not p_input ? 'mime' or exists(select 1 from public.pitch_source_references r join public.pitch_source_documents sd on sd.id=r.document_id where r.asset_id=a.id and r.asset_version=a.current_version and sd.mime=p_input->>'mime'))
     and (not p_input ? 'language' or v.content->>'locale'=p_input->>'language') and (not p_input ? 'validity' or p_input->>'validity'='all' or (p_input->>'validity'='valid' and (a.valid_from is null or a.valid_from<=current_date) and (a.valid_until is null or a.valid_until>=current_date)) or (p_input->>'validity'='expired' and a.valid_until<current_date)) and (not p_input ? 'from' or a.data_as_of>=(p_input->>'from')::date) and (not p_input ? 'until' or a.data_as_of<=(p_input->>'until')::date)
     order by a.id desc limit 31)x),'[]');
   elsif p_input->>'kind'='pages' then
    return coalesce((select jsonb_agg(to_jsonb(x)) from (select sp.id,sp.document_id,sp.ordinal,sp.locator,sp.parse_state,sp.hidden,sp.asset_id,sp.structure->>'title' title,left(sp.extracted_text,240) snippet,sp.thumbnail,sp.category_candidates from public.pitch_source_pages sp join public.pitch_source_documents d on d.id=sp.document_id
     where d.library_managed and d.upload_state='ready' and private.pitch_document_visible(p_actor,p_session,d.id) and (private.pitch_access(p_actor,p_session,d.organization_id,d.region,d.city,d.business_line,'maintain') or not sp.hidden and exists(select 1 from public.pitch_content_assets pa where pa.id=sp.asset_id and pa.state='published' and private.pitch_version_visible(p_actor,p_session,pa.id,pa.current_version))) and (not p_input ? 'before' or sp.id<(p_input->>'before')::uuid)
     and (not p_input ? 'documentId' or d.id=(p_input->>'documentId')::uuid) and (not p_input ? 'q' or sp.extracted_text ilike '%'||(p_input->>'escapedQuery')||'%' escape '\' or sp.structure->>'title' ilike '%'||(p_input->>'escapedQuery')||'%' escape '\' or sp.search_tokens @> array(select jsonb_array_elements_text(p_input->'tokens')) and jsonb_array_length(p_input->'tokens')>0)
     and (not p_input ? 'region' or d.region=p_input->>'region') and (not p_input ? 'city' or d.city=p_input->>'city') and (not p_input ? 'line' or d.business_line=p_input->>'line') and (not p_input ? 'mime' or d.mime=p_input->>'mime') and (not p_input ? 'categoryId' or coalesce(sp.category_id,d.category_id)=(p_input->>'categoryId')::uuid) and (not p_input ? 'state' or d.state=p_input->>'state') and (not p_input ? 'tag' or p_input->>'tag'=any(d.tags)) and (not p_input ? 'language' or d.language=p_input->>'language') and (not p_input ? 'validity' or p_input->>'validity'='all' or (p_input->>'validity'='valid' and (d.valid_from is null or d.valid_from<=current_date) and (d.valid_until is null or d.valid_until>=current_date)) or (p_input->>'validity'='expired' and d.valid_until<current_date)) and (not p_input ? 'from' or d.data_as_of>=(p_input->>'from')::date) and (not p_input ? 'until' or d.data_as_of<=(p_input->>'until')::date)
     order by sp.id desc limit 31)x),'[]');
   end if;
   return coalesce((select jsonb_agg(to_jsonb(x)) from (select d.id,d.filename,d.version,d.revision,d.mime,d.size_bytes,d.state,d.upload_state,d.data_as_of,d.valid_until,d.tags,d.region,d.city,d.business_line,d.language,j.id job_id,j.state parse_state,j.progress,j.error_code from public.pitch_source_documents d left join lateral(select * from public.pitch_parse_jobs jobs where jobs.document_id=d.id order by jobs.created_at desc limit 1) j on true
    where d.library_managed and private.pitch_document_visible(p_actor,p_session,d.id) and (not p_input ? 'before' or d.id<(p_input->>'before')::uuid)
    and (not p_input ? 'q' or d.filename ilike '%'||(p_input->>'escapedQuery')||'%' escape '\' or array_to_string(d.tags,' ') ilike '%'||(p_input->>'escapedQuery')||'%' escape '\' or d.source_description ilike '%'||(p_input->>'escapedQuery')||'%' escape '\' or exists(select 1 from public.pitch_source_pages sp where sp.document_id=d.id and not sp.hidden and sp.extracted_text ilike '%'||(p_input->>'escapedQuery')||'%' escape '\'))
    and (not p_input ? 'region' or d.region=p_input->>'region') and (not p_input ? 'city' or d.city=p_input->>'city') and (not p_input ? 'line' or d.business_line=p_input->>'line') and (not p_input ? 'mime' or d.mime=p_input->>'mime') and (not p_input ? 'categoryId' or d.category_id=(p_input->>'categoryId')::uuid) and (not p_input ? 'state' or d.state=p_input->>'state') and (not p_input ? 'tag' or p_input->>'tag'=any(d.tags)) and (not p_input ? 'language' or d.language=p_input->>'language') and (not p_input ? 'validity' or p_input->>'validity'='all' or (p_input->>'validity'='valid' and (d.valid_from is null or d.valid_from<=current_date) and (d.valid_until is null or d.valid_until>=current_date)) or (p_input->>'validity'='expired' and d.valid_until<current_date)) and (not p_input ? 'from' or d.data_as_of>=(p_input->>'from')::date) and (not p_input ? 'until' or d.data_as_of<=(p_input->>'until')::date)
    order by d.id desc limit 31)x),'[]');
  elsif op='library_asset' then
   aid:=(p_input->>'assetId')::uuid;select * into a from public.pitch_content_assets where id=aid;
   if not private.pitch_version_visible(p_actor,p_session,aid,a.current_version) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
   select * into v from public.pitch_asset_versions where asset_id=aid and version=coalesce((p_input->>'version')::integer,a.current_version);
   if v.asset_id is null or not private.pitch_version_visible(p_actor,p_session,aid,v.version) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
   result:=jsonb_build_object('asset',to_jsonb(a),'version',to_jsonb(v),'media',coalesce((select jsonb_agg(to_jsonb(m)) from public.pitch_media_assets m where (m.id,m.version) in(select cm.id,cm.version from private.pitch_content_media(v.content) cm) and private.pitch_media_visible(p_actor,p_session,m.id,m.version)),'[]'));
   return result||jsonb_build_object('versions',(select jsonb_agg(jsonb_build_object('version',v.version,'state',v.state,'created_at',v.created_at) order by version desc) from public.pitch_asset_versions v where asset_id=aid and private.pitch_version_visible(p_actor,p_session,aid,v.version)));
  elsif op='library_media' then
   return coalesce((select jsonb_agg(to_jsonb(x)) from (select m.* from public.pitch_media_assets m join public.pitch_source_pages sp on sp.id=m.source_page_id join public.pitch_source_documents d on d.id=sp.document_id
    where private.pitch_media_visible(p_actor,p_session,m.id,m.version) and (not p_input ? 'documentId' or d.id=(p_input->>'documentId')::uuid) and (not p_input ? 'before' or m.id<(p_input->>'before')::uuid)
    and (not p_input ? 'q' or m.alt ilike '%'||(p_input->>'escapedQuery')||'%' escape '\' or d.filename ilike '%'||(p_input->>'escapedQuery')||'%' escape '\')
    and (not p_input ? 'region' or m.region=p_input->>'region') and (not p_input ? 'city' or m.city=p_input->>'city') and (not p_input ? 'line' or m.business_line=p_input->>'line') and (not p_input ? 'mime' or m.mime=p_input->>'mime') and (not p_input ? 'categoryId' or d.category_id=(p_input->>'categoryId')::uuid) and (not p_input ? 'state' or m.state=p_input->>'state') and (not p_input ? 'tag' or p_input->>'tag'=any(d.tags)) and (not p_input ? 'language' or d.language=p_input->>'language') and (not p_input ? 'from' or m.data_as_of>=(p_input->>'from')::date) and (not p_input ? 'until' or m.data_as_of<=(p_input->>'until')::date)
    and (not p_input ? 'validity' or p_input->>'validity'='all' or (p_input->>'validity'='valid' and (d.valid_from is null or d.valid_from<=current_date) and (d.valid_until is null or d.valid_until>=current_date)) or (p_input->>'validity'='expired' and d.valid_until<current_date))
    order by m.id desc limit 31)x),'[]');
  end if;
  if op='library_page' then select * into sp from public.pitch_source_pages where id=(p_input->>'pageId')::uuid;did:=sp.document_id;else did:=(p_input->>'documentId')::uuid;end if;
  select * into d from public.pitch_source_documents where id=did;
  if d.id is null or not private.pitch_document_visible(p_actor,p_session,d.id) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  if op='library_page' and (sp.hidden or d.library_managed and not exists(select 1 from public.pitch_content_assets pa where pa.id=sp.asset_id and pa.state='published' and private.pitch_version_visible(p_actor,p_session,pa.id,pa.current_version))) and not private.pitch_access(p_actor,p_session,d.organization_id,d.region,d.city,d.business_line,'maintain') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  if op='library_original' then if d.created_by<>p_actor and not private.pitch_access(p_actor,p_session,d.organization_id,d.region,d.city,d.business_line,'maintain') then raise exception 'PITCH_DENIED' using errcode='42501';end if;if d.upload_state<>'ready' then raise exception 'PITCH_INVALID';end if;result:=to_jsonb(d);
  elsif op='library_page' then return jsonb_build_object('page',to_jsonb(sp),'document',to_jsonb(d),'media',coalesce((select jsonb_agg(to_jsonb(m)) from public.pitch_media_occurrences o join public.pitch_media_assets m on m.id=o.media_id and m.version=o.media_version where o.page_id=sp.id and private.pitch_media_visible(p_actor,p_session,m.id,m.version)),'[]'));
  elsif op='library_versions' then return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'version',x.version,'filename',x.filename,'sha256',x.sha256,'created_at',x.created_at) order by version desc) from public.pitch_source_documents x where coalesce(x.root_document_id,x.id)=coalesce(d.root_document_id,d.id) and private.pitch_document_visible(p_actor,p_session,x.id)),'[]');
  else return jsonb_build_object('document',to_jsonb(d),'job',(select to_jsonb(x) from public.pitch_parse_jobs x where x.document_id=d.id));end if;
 elsif op='library_media_file' then
  select to_jsonb(m) into result from public.pitch_media_assets m where m.id=(p_input->>'mediaId')::uuid and m.version=(p_input->>'version')::integer and private.pitch_media_visible(p_actor,p_session,m.id,m.version);
  if result is null then raise exception 'PITCH_DENIED' using errcode='42501';end if;return result;
 elsif op='library_candidate_commit' then
  aid:=(p_input->>'assetId')::uuid;
  if p_input->>'pageId' is not null then
   select * into sp from public.pitch_source_pages where id=(p_input->>'pageId')::uuid for update;select * into d from public.pitch_source_documents where id=sp.document_id;
   if sp.id is null or sp.hidden or not private.pitch_document_visible(p_actor,p_session,d.id) or not private.pitch_access(p_actor,p_session,d.organization_id,d.region,d.city,d.business_line,'maintain') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
   if sp.asset_id is not null and sp.asset_id<>aid then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
   if not exists(select 1 from jsonb_array_elements(p_input->'asset'->'content'->'sources') r where r->>'pageId'=sp.id::text and r->>'documentId'=d.id::text and r->>'sha256'=d.sha256) then raise exception 'PITCH_INVALID';end if;
  end if;
  if p_input->'asset'->>'state'='published' then
   result:=private.pitch_studio_access(p_actor,p_session,jsonb_build_object('action','library_confirm','acknowledgePartial',p_input->'acknowledgePartial','items',jsonb_build_array(jsonb_build_object('assetId',aid,'expectedVersion',p_input->'expectedVersion','asset',p_input->'asset','sha256',p_input->'sha256','tokens',p_input->'tokens'))));
  else result:=private.pitch_studio_access_v2(p_actor,p_session,p_input||jsonb_build_object('action','asset_save'));end if;
  if sp.id is not null then update public.pitch_content_assets set imported_from_page=sp.id where id=aid;update public.pitch_source_pages set asset_id=aid where id=sp.id;end if;
  update public.pitch_content_assets set search_tokens=array(select jsonb_array_elements_text(p_input->'tokens')) where id=aid;
  update public.pitch_source_pages set category_id=(p_input->'asset'->>'categoryId')::uuid where asset_id=aid;
 elsif op in ('library_merge_commit','library_variant_commit') then
  if op='library_merge_commit' then
   aid:=(p_input->>'targetId')::uuid;
   for ref in select value from jsonb_array_elements(p_input->'sources') loop
    if not private.pitch_version_visible(p_actor,p_session,(ref->>'id')::uuid,(ref->>'version')::integer) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
   end loop;
   result:=private.pitch_studio_access_v2(p_actor,p_session,p_input||jsonb_build_object('action','asset_save','assetId',aid));
   for ref in select value from jsonb_array_elements(p_input->'sources') loop
    select * into a from public.pitch_content_assets where id=(ref->>'id')::uuid for update;
    if not private.pitch_access(p_actor,p_session,a.organization_id,a.region,a.city,a.business_line,'maintain') or a.current_version<>(ref->>'version')::integer then raise exception 'PITCH_DENIED' using errcode='42501';end if;
    insert into public.pitch_asset_links values(aid,a.id,a.current_version,'merge',p_actor,now()) on conflict do nothing;
    update public.pitch_content_assets set state='archived',updated_by=p_actor,updated_at=now() where id=a.id;
   end loop;
  else
   aid:=(p_input->>'assetId')::uuid;
   if not private.pitch_version_visible(p_actor,p_session,(p_input->>'sourceId')::uuid,(p_input->>'sourceVersion')::integer) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
   result:=private.pitch_studio_access_v2(p_actor,p_session,p_input||jsonb_build_object('action','asset_save','expectedVersion',0));
   update public.pitch_content_assets set variant_of=(p_input->>'sourceId')::uuid,imported_from_page=(select imported_from_page from public.pitch_content_assets where id=(p_input->>'sourceId')::uuid) where id=aid;
   insert into public.pitch_asset_links values(aid,(p_input->>'sourceId')::uuid,(p_input->>'sourceVersion')::integer,p_input->>'kind',p_actor,now());
  end if;
 elsif op='library_confirm' then
  for item in select value from jsonb_array_elements(p_input->'items') loop
   select * into a from public.pitch_content_assets where id=(item->>'assetId')::uuid for update;select * into sp from public.pitch_source_pages where id=a.imported_from_page;select * into d from public.pitch_source_documents where id=sp.document_id;
   if a.id is null or d.id is null or sp.hidden or not private.pitch_document_visible(p_actor,p_session,d.id) or not private.pitch_access(p_actor,p_session,a.organization_id,a.region,a.city,a.business_line,'maintain') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
   if a.current_version<>(item->>'expectedVersion')::integer or (sp.parse_state<>'completed' and not coalesce((p_input->>'acknowledgePartial')::boolean,false)) then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
   update public.pitch_source_documents set state='published',updated_by=p_actor,updated_at=now() where id=d.id;
   update public.pitch_media_assets set state='published' where source_page_id in(select id from public.pitch_source_pages where document_id=d.id);
   ref:=item->'asset';
   if (ref->>'allowClientExport')::boolean and (not d.allow_client_export or d.is_test_data) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
   result:=private.pitch_studio_access_v2(p_actor,p_session,jsonb_build_object('action','asset_save','assetId',a.id,'expectedVersion',a.current_version,'asset',ref,'sha256',item->>'sha256'));
   update public.pitch_content_assets set search_tokens=array(select jsonb_array_elements_text(item->'tokens')) where id=a.id;update public.pitch_source_pages set category_id=(ref->>'categoryId')::uuid where asset_id=a.id;counter:=counter+1;
  end loop;result:=jsonb_build_object('confirmed',counter);
 elsif op='library_document_save' then
  select * into d from public.pitch_source_documents where id=(p_input->>'documentId')::uuid for update;
  if d.id is null or not private.pitch_document_visible(p_actor,p_session,d.id) or not private.pitch_access(p_actor,p_session,d.organization_id,d.region,d.city,d.business_line,'maintain') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  if d.revision<>(p_input->>'expectedRevision')::integer then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
  update public.pitch_source_documents set revision=revision+1,category_id=(p_input->>'categoryId')::uuid,tags=array(select jsonb_array_elements_text(p_input->'tags')),state=coalesce(p_input->>'state',state),updated_by=p_actor,updated_at=now() where id=d.id;
  if p_input->>'state'='archived' then update public.pitch_media_assets set state='archived' where source_page_id in(select id from public.pitch_source_pages where document_id=d.id);end if;
  result:=jsonb_build_object('documentId',d.id,'revision',d.revision+1);
 elsif op='library_normalize_commit' then
  aid:=(p_input->>'assetId')::uuid;select * into a from public.pitch_content_assets where id=aid for share;select * into v from public.pitch_asset_versions where asset_id=aid and version=(p_input->>'assetVersion')::integer;
  if not private.pitch_version_visible(p_actor,p_session,aid,v.version,'generate') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  if a.current_version<>v.version then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;
  if exists(select 1 from private.pitch_content_media(v.content) cm where not private.pitch_media_visible(p_actor,p_session,cm.id,cm.version)) then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  if not exists(select 1 from public.pitch_design_themes where id=p_input->>'themeId' and state='published') or not exists(select 1 from public.pitch_templates where id='history-standardizer' and state='published') then raise exception 'PITCH_DENIED' using errcode='42501';end if;
  pid:=(p_input->>'projectId')::uuid;perform pg_advisory_xact_lock(hashtextextended(pid::text,0));
  if exists(select 1 from public.pitch_projects where id=pid) then
   if not exists(select 1 from public.pitch_projects where id=pid and created_by=p_actor and composition_key=p_input->>'compositionKey') then raise exception 'PITCH_CONFLICT' using errcode='23505';end if;return jsonb_build_object('projectId',pid,'replayed',true);
  end if;
  if jsonb_array_length(p_input->'slides') not between 1 and 50 then raise exception 'PITCH_INVALID';end if;
  insert into public.pitch_projects(id,title,theme_id,theme_version,is_test_data,created_by,updated_by,organization_id,region,city,business_line,data_as_of,composition_key,normalization_report)
  values(pid,p_input->>'title',p_input->>'themeId',(p_input->>'themeVersion')::integer,a.is_test_data,p_actor,p_actor,a.organization_id,a.region,a.city,a.business_line,a.data_as_of,p_input->>'compositionKey',p_input->'report');
  for item in select value from jsonb_array_elements(p_input->'slides') loop
   if item->'content'->'sources' is distinct from v.content->'sources' then raise exception 'PITCH_INVALID';end if;
   counter:=counter+1;
   insert into public.pitch_project_slides(id,project_id,position,asset_id,asset_version,template_id,template_version,layout_id,layout_version,theme_id,theme_version,content,scene,source_snapshot,created_by,updated_by)
   values((item->>'slideId')::uuid,pid,counter,aid,v.version,'history-standardizer',1,item->'scene'->>'layoutId',2,p_input->>'themeId',(p_input->>'themeVersion')::integer,item->'content',item->'scene',v.content->'sources',p_actor,p_actor);
  end loop;result:=jsonb_build_object('projectId',pid,'pages',counter);
 else return private.pitch_studio_access_v2(p_actor,p_session,p_input);
 end if;
 insert into private.pitch_events(actor_id,session_id,action,target_id,after_value) values(p_actor,p_session,op,coalesce(p_input->>'documentId',p_input->>'jobId',p_input->>'projectId','library'),result);
 return result;
end $$;
revoke all on function private.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;

-- Reviewed registry and extensible category seeds.
insert into public.pitch_asset_categories(system_code,names) values('company','{"zh":"公司介绍","en":"company"}') on conflict(system_code) do nothing;
insert into public.pitch_asset_categories(system_code,names) values('team','{"zh":"团队介绍","en":"team"}') on conflict(system_code) do nothing;
insert into public.pitch_asset_categories(system_code,names) values('case','{"zh":"代表案例","en":"case"}') on conflict(system_code) do nothing;
insert into public.pitch_asset_categories(system_code,names) values('macro','{"zh":"宏观经济","en":"macro"}') on conflict(system_code) do nothing;
insert into public.pitch_asset_categories(system_code,names) values('market','{"zh":"房地产市场研究","en":"market"}') on conflict(system_code) do nothing;
insert into public.pitch_asset_categories(system_code,names) values('building','{"zh":"楼宇项目介绍","en":"building"}') on conflict(system_code) do nothing;
insert into public.pitch_asset_categories(system_code,names) values('competition','{"zh":"竞争分析","en":"competition"}') on conflict(system_code) do nothing;
insert into public.pitch_asset_categories(system_code,names) values('service','{"zh":"服务方案","en":"service"}') on conflict(system_code) do nothing;
insert into public.pitch_asset_categories(system_code,names) values('marketing','{"zh":"营销方案","en":"marketing"}') on conflict(system_code) do nothing;
insert into public.pitch_asset_categories(system_code,names) values('leasing','{"zh":"招商策略","en":"leasing"}') on conflict(system_code) do nothing;
insert into public.pitch_asset_categories(system_code,names) values('implementation','{"zh":"项目实施计划","en":"implementation"}') on conflict(system_code) do nothing;
insert into public.pitch_templates(id,names,category_id,state,current_version) select 'history-standardizer','{"zh":"历史素材标准化","en":"Historical material normalization"}',id,'published',1 from public.pitch_asset_categories where system_code='general';
insert into public.pitch_template_versions(template_id,version,adapter,config,sha256) values('history-standardizer',1,'structured-content/2','{"id":"history-standardizer","version":1,"names":{"zh":"历史素材标准化","en":"Historical material normalization"},"categoryCode":"general","assetTypes":["content"],"scenarios":["single-page","multi-page"],"inputSchema":"studio-parameters/2","adapter":"structured-content/2","dataSources":["content_asset"],"requiredPermissions":["internal_generate"],"layouts":["cover","section-divider","image-text","two-columns","kpi","team-profile","case-study","data-table","chart-insight","comparison","map-analysis","strategy-framework"],"exports":["pptx","png","svg","xlsx"],"ai":"none","missingData":"reject"}','483b76a208565e6f48fcbe58deba696faa9d371fcd03de42b990aebf6653785b');
