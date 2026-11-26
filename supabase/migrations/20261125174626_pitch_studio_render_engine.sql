-- Stage 02 extends the verified foundation; no business rows or pilot grants.
alter table public.pitch_template_versions drop constraint pitch_template_versions_adapter_check;
alter table public.pitch_template_versions drop constraint pitch_template_versions_config_check;
alter table public.pitch_template_versions add check(adapter in ('text-image/1','structured-content/2'));
alter table public.pitch_template_versions add check(jsonb_typeof(config)='object' and config->>'adapter'=adapter);
alter table public.pitch_layout_definitions drop constraint pitch_layout_definitions_engine_check;
alter table public.pitch_layout_definitions add check(engine in ('text-image/1','pitch-layout/2'));
alter table public.pitch_exports drop constraint pitch_exports_format_check;
alter table public.pitch_exports add check(format in ('pptx','png','svg','xlsx'));
alter table public.pitch_exports drop constraint pitch_exports_size_bytes_check;
alter table public.pitch_exports add check(size_bytes>0 and size_bytes<=16777216);
alter table public.pitch_exports add column filename text check(length(filename)<=200);
alter table public.pitch_exports add column render_options jsonb not null default '{}'::jsonb check(jsonb_typeof(render_options)='object');
alter table public.pitch_projects add column composition_key text;
alter table public.pitch_jobs add column progress integer not null default 0 check(progress between 0 and 100);
alter table public.pitch_jobs add column lease_until timestamptz;
alter table public.pitch_jobs add column worker_token uuid;
update storage.buckets set allowed_mime_types=array['application/json','image/png','image/jpeg','image/webp','image/svg+xml','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] where id='pitch-studio-private';

-- Team photos are pinned media dependencies just like project images. No URL
-- fetching or browser-supplied media path is accepted.
create function private.pitch_content_media(p_content jsonb) returns table(id uuid,version integer)
language sql immutable set search_path='' as $$
 select (b->>'mediaAssetId')::uuid,(b->>'mediaVersion')::integer from jsonb_array_elements(p_content->'blocks') b where b->>'kind'='image'
 union
 select (m->>'mediaAssetId')::uuid,(m->>'mediaVersion')::integer from jsonb_array_elements(p_content->'blocks') b cross join lateral jsonb_array_elements(case when b->>'kind'='team' then b->'members' else '[]'::jsonb end) m where m ? 'mediaAssetId'
$$;
revoke all on function private.pitch_content_media(jsonb) from public,anon,authenticated,service_role;

-- Keep v1 code intact for historical scenes and legacy commands. The service
-- entry remains a fixed invoker -> private definer boundary with fresh locks.
alter function private.pitch_studio_access(uuid,uuid,jsonb) rename to pitch_studio_access_v1;
create function private.pitch_studio_access(p_actor uuid,p_session uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare op text:=p_input->>'action'; result jsonb; item jsonb; ref record; a public.pitch_content_assets; v public.pitch_asset_versions;
 p public.pitch_projects; e public.pitch_exports; job public.pitch_jobs; pid uuid; aid uuid; opts jsonb; first_scope jsonb; counter integer:=0; content jsonb; target_format text; composition text;
begin
 -- v1 catalog acquires the current control/account/role/session/grant locks and
 -- verifies effective canonical authority, including bans and grant expiry.
 perform private.pitch_studio_access_v1(p_actor,p_session,jsonb_build_object('action','catalog'));
 if op='sample_lookup' then
   if not private.pitch_access(p_actor,p_session,p_input->'scope'->>'organizationId',p_input->'scope'->>'region',p_input->'scope'->>'city',p_input->'scope'->>'businessLine','generate') then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
   select * into a from public.pitch_content_assets where id=(p_input->>'assetId')::uuid;
   if not found then return '{"replayed":false}'; end if;
   if a.created_by<>p_actor or not a.is_test_data or a.organization_id<>p_input->'scope'->>'organizationId' or a.region<>p_input->'scope'->>'region' or a.city<>p_input->'scope'->>'city' or a.business_line<>p_input->'scope'->>'businessLine' or not exists(select 1 from public.pitch_source_references r join public.pitch_source_documents d on d.id=r.document_id where r.asset_id=a.id and r.asset_version=1 and d.sha256=p_input->>'sourceSha256') then raise exception 'PITCH_CONFLICT' using errcode='23505'; end if;
   return '{"replayed":true}';
 elsif op='project_compose' then
   pid:=(p_input->>'projectId')::uuid;
   if jsonb_typeof(p_input->'slides')<>'array' or jsonb_array_length(p_input->'slides') not between 1 and 50 then raise exception 'PITCH_INVALID'; end if;
   composition:=encode(sha256(convert_to((p_input-'slides'-'action')::text||coalesce((select string_agg((x-'slideId')::text,'' order by n) from jsonb_array_elements(p_input->'slides') with ordinality s(x,n)),''),'UTF8')),'hex');
   perform pg_advisory_xact_lock(hashtextextended(pid::text,0));
   select * into p from public.pitch_projects where id=pid;
   if found then
     if p.created_by<>p_actor or p.composition_key is distinct from composition or not private.pitch_project_visible(p_actor,p_session,pid,'generate') then raise exception 'PITCH_CONFLICT' using errcode='23505'; end if;
     return jsonb_build_object('projectId',pid,'replayed',true);
   end if;
   if not exists(select 1 from public.pitch_template_versions t join public.pitch_templates root on root.id=t.template_id where t.template_id='studio-content' and t.version=1 and root.state='published') or not exists(select 1 from public.pitch_theme_versions t join public.pitch_design_themes root on root.id=t.theme_id where t.theme_id=p_input->>'themeId' and t.version=(p_input->>'themeVersion')::integer and root.state='published') then raise exception 'PITCH_INVALID'; end if;
   for item in select value from jsonb_array_elements(p_input->'slides') loop
     aid:=(item->>'assetId')::uuid;
     select * into a from public.pitch_content_assets where id=aid for share;
     select * into v from public.pitch_asset_versions where asset_id=aid and version=(item->>'assetVersion')::integer;
     if not private.pitch_version_visible(p_actor,p_session,aid,v.version,'generate') then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
     if a.current_version<>v.version or item->'content' is distinct from v.content or item->'sources' is distinct from v.content->'sources' then raise exception 'PITCH_CONFLICT' using errcode='23505'; end if;
     if exists(select 1 from private.pitch_content_media(v.content) cm where not private.pitch_media_visible(p_actor,p_session,cm.id,cm.version)) then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
     if item->'scene'->>'rendererVersion'<>'pitch-scene/2' or item->'scene'->>'themeId' is distinct from p_input->>'themeId' or item->'scene'->>'themeVersion' is distinct from p_input->>'themeVersion' or not exists(select 1 from public.pitch_layout_definitions d where d.id=item->'scene'->>'layoutId' and d.version=2) then raise exception 'PITCH_INVALID'; end if;
     if first_scope is null then
       first_scope:=jsonb_build_object('organization',a.organization_id,'region',a.region,'city',a.city,'line',a.business_line);
       insert into public.pitch_projects(id,title,theme_id,theme_version,is_test_data,created_by,updated_by,organization_id,region,city,business_line,data_as_of,composition_key)
       values(pid,p_input->>'title',p_input->>'themeId',(p_input->>'themeVersion')::integer,a.is_test_data,p_actor,p_actor,a.organization_id,a.region,a.city,a.business_line,a.data_as_of,composition);
     elsif first_scope<>jsonb_build_object('organization',a.organization_id,'region',a.region,'city',a.city,'line',a.business_line) then raise exception 'PITCH_INVALID'; end if;
     counter:=counter+1;
     insert into public.pitch_project_slides(id,project_id,position,asset_id,asset_version,template_id,template_version,layout_id,layout_version,theme_id,theme_version,content,scene,source_snapshot,created_by,updated_by)
     values((item->>'slideId')::uuid,pid,counter,aid,v.version,'studio-content',1,item->'scene'->>'layoutId',2,p_input->>'themeId',(p_input->>'themeVersion')::integer,v.content,item->'scene',item->'sources',p_actor,p_actor);
     update public.pitch_projects set is_test_data=is_test_data or a.is_test_data where id=pid;
   end loop;
   result:=jsonb_build_object('projectId',pid,'pages',counter);
 elsif op in ('get_asset','asset_save','sample_create') then
   if op='asset_save' then content:=p_input->'asset'->'content'; else content:=p_input->'content'; end if;
   if content is not null then
     for ref in select * from private.pitch_content_media(content) loop
       if not private.pitch_media_visible(p_actor,p_session,ref.id,ref.version) and op<>'sample_create' then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
       if op='sample_create' and (ref.id<>(p_input->>'mediaId')::uuid or ref.version<>1) then raise exception 'PITCH_INVALID'; end if;
       if op='asset_save' and p_input->'asset'->>'state'='published' and p_input->'asset'->>'visibility'='organization' and not exists(
         select 1 from public.pitch_media_assets m join public.pitch_source_pages sp on sp.id=m.source_page_id join public.pitch_source_documents d on d.id=sp.document_id
         where m.id=ref.id and m.version=ref.version and m.state='published' and d.state='published' and d.visibility='organization'
         and m.organization_id=p_input->'asset'->'scope'->>'organizationId' and m.region=p_input->'asset'->'scope'->>'region' and m.city=p_input->'asset'->'scope'->>'city' and m.business_line=p_input->'asset'->'scope'->>'businessLine'
         and d.organization_id=m.organization_id and d.region=m.region and d.city=m.city and d.business_line=m.business_line) then raise exception 'PITCH_INVALID'; end if;
     end loop;
   end if;
   result:=private.pitch_studio_access_v1(p_actor,p_session,p_input);
   if op in ('asset_save','sample_create') then
     aid:=(p_input->>'assetId')::uuid;
     insert into public.pitch_asset_media select aid,a.current_version,cm.id,cm.version from public.pitch_content_assets a cross join lateral private.pitch_content_media(content) cm where a.id=aid on conflict do nothing;
     return result;
   end if;
   return result||jsonb_build_object('media',coalesce((select jsonb_agg(to_jsonb(m)) from public.pitch_media_assets m where (m.id,m.version) in (select cm.id,cm.version from private.pitch_content_media(result->'version'->'content') cm) and private.pitch_media_visible(p_actor,p_session,m.id,m.version)),'[]'::jsonb));
 elsif op='preview_context' then
   pid:=(p_input->>'projectId')::uuid;
   result:=private.pitch_studio_access_v1(p_actor,p_session,jsonb_build_object('action','get_project','projectId',pid));
   if exists(select 1 from public.pitch_project_slides s cross join lateral private.pitch_content_media(s.content) cm where s.project_id=pid and not private.pitch_media_visible(p_actor,p_session,cm.id,cm.version)) then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
   return result||jsonb_build_object('themes',(select jsonb_agg(to_jsonb(t)) from public.pitch_theme_versions t where (t.theme_id,t.version) in (select s.theme_id,s.theme_version from public.pitch_project_slides s where s.project_id=pid)),
     'media',coalesce((select jsonb_agg(to_jsonb(m)) from public.pitch_media_assets m where (m.id,m.version) in (select cm.id,cm.version from public.pitch_project_slides s cross join lateral private.pitch_content_media(s.content) cm where s.project_id=pid)),'[]'::jsonb));
 elsif op in ('export_prepare','export_context','export_complete','export_fail','export_download','export_claim','export_progress','export_status') then
   pid:=(p_input->>'projectId')::uuid;
   if not private.pitch_project_visible(p_actor,p_session,pid,'generate') then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
   for item in select to_jsonb(s) from public.pitch_project_slides s where s.project_id=pid loop
     if not private.pitch_version_visible(p_actor,p_session,(item->>'asset_id')::uuid,(item->>'asset_version')::integer,case when p_input->>'audience'='client' then 'client' else 'generate' end) then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
     for ref in select * from private.pitch_content_media(item->'content') loop
       if not private.pitch_media_visible(p_actor,p_session,ref.id,ref.version) or (p_input->>'audience'='client' and exists(select 1 from public.pitch_media_assets m join public.pitch_source_pages sp on sp.id=m.source_page_id join public.pitch_source_documents d on d.id=sp.document_id where m.id=ref.id and m.version=ref.version and d.is_test_data)) then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
     end loop;
   end loop;
   select * into e from public.pitch_exports where id=(p_input->>'exportId')::uuid and project_id=pid for update;
   if op='export_prepare' then
     target_format:=coalesce(p_input->>'format','pptx');
     if target_format not in ('pptx','png','svg','xlsx') or (target_format in ('png','svg') and not p_input ? 'page') then raise exception 'PITCH_INVALID'; end if;
     if p_input ? 'page' and ((p_input->>'page')::integer<0 or (p_input->>'page')::integer>=(select count(*) from public.pitch_project_slides s where s.project_id=pid)) then raise exception 'PITCH_INVALID'; end if;
     opts:=jsonb_strip_nulls(jsonb_build_object('asynchronous',coalesce((p_input->>'asynchronous')::boolean,false),'page',p_input->'page'));
     if e.id is not null then
       if e.audience is distinct from p_input->>'audience' or e.format<>target_format or e.render_options<>opts then raise exception 'PITCH_CONFLICT' using errcode='23505'; end if;
       return jsonb_build_object('exportId',e.id,'replayed',true);
     end if;
     result:=private.pitch_studio_access_v1(p_actor,p_session,p_input);
     update public.pitch_exports set format=target_format,storage_path=regexp_replace(storage_path,'[.]pptx$','.'||target_format),render_options=opts,filename=p_input->>'filename' where id=(p_input->>'exportId')::uuid;
     if coalesce((p_input->>'asynchronous')::boolean,false) then update public.pitch_jobs set state='queued',lease_until=now()+interval '120 seconds' where id=(p_input->>'exportId')::uuid; end if;
   else
     if e.id is null then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
     if e.audience='client' and (not private.pitch_project_visible(p_actor,p_session,pid,'client') or exists(select 1 from public.pitch_project_slides s where s.project_id=pid and not private.pitch_version_visible(p_actor,p_session,s.asset_id,s.asset_version,'client'))) then raise exception 'PITCH_DENIED' using errcode='42501'; end if;
     select * into job from public.pitch_jobs where id=e.job_id for update;
     if op='export_status' then
       if job.state in ('running','queued') and job.lease_until<clock_timestamp() then
         update public.pitch_jobs set state='failed',error_code='PITCH_WORKER_TIMEOUT',updated_at=now() where id=job.id;
         update public.pitch_exports set state='failed' where id=e.id;
         insert into private.pitch_events(actor_id,session_id,action,target_id,after_value) values(p_actor,p_session,'export_timeout',e.id::text,'{"state":"failed"}');
       end if;
       return (select to_jsonb(x) from (select ex.id,ex.state,ex.format,ex.filename,j.progress,j.error_code from public.pitch_exports ex join public.pitch_jobs j on j.id=ex.job_id where ex.id=e.id) x);
     elsif op='export_claim' then
       if job.state<>'queued' or e.state<>'pending' or job.lease_until<clock_timestamp() then return '{"claimed":false}'; end if;
       update public.pitch_jobs set state='running',worker_token=(p_input->>'workerToken')::uuid,progress=5,updated_at=now() where id=job.id;
       result:='{"claimed":true}';
     elsif op='export_progress' then
       if job.state<>'running' or job.worker_token is distinct from (p_input->>'workerToken')::uuid then raise exception 'PITCH_CONFLICT' using errcode='23505'; end if;
       update public.pitch_jobs set progress=greatest(progress,least(95,(p_input->>'progress')::integer)),updated_at=now() where id=job.id;
       return '{}';
     else
       if e.render_options->>'asynchronous'='true' and op in ('export_complete','export_fail') and (job.worker_token is distinct from (p_input->>'workerToken')::uuid or job.state<>'running') then raise exception 'PITCH_CONFLICT' using errcode='23505'; end if;
       result:=private.pitch_studio_access_v1(p_actor,p_session,p_input);
       if op='export_context' then
         result:=result||jsonb_build_object('media',coalesce((select jsonb_agg(to_jsonb(m)) from public.pitch_media_assets m where (m.id,m.version) in (select cm.id,cm.version from public.pitch_project_slides s cross join lateral private.pitch_content_media(s.content) cm where s.project_id=pid)),'[]'::jsonb));
         return result;
       elsif op='export_complete' then update public.pitch_jobs set progress=100 where id=job.id;
       elsif op='export_fail' then update public.pitch_jobs set error_code=case when p_input->>'errorCode' ~ '^PITCH_[A-Z_]+$' then left(p_input->>'errorCode',100) else 'PITCH_EXPORT_FAILED' end where id=job.id;
       end if;
       return result;
     end if;
   end if;
 else return private.pitch_studio_access_v1(p_actor,p_session,p_input);
 end if;
 insert into private.pitch_events(actor_id,session_id,action,target_id,after_value) values(p_actor,p_session,op,coalesce(p_input->>'projectId','unknown'),result);
 return result;
end $$;
revoke all on function private.pitch_studio_access(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.pitch_studio_access(uuid,uuid,jsonb) to service_role;
-- Reviewed configuration seeds appended below; no executable content in JSON.

insert into public.pitch_design_themes(id,state,current_version) values('colliers-default-v1','published',2) on conflict(id) do nothing;
insert into public.pitch_theme_versions(theme_id,version,definition,sha256) values('colliers-default-v1',2,'{"id":"colliers-default-v1","version":2,"approval":"provisional","width":13.333333,"height":7.5,"colors":{"primary":"25408F","secondary":"777C88","background":"FAF9F6","text":"243044","muted":"596273"},"logo":{"resource":"colliers-brand-assets/1","enabled":false},"fonts":{"zh":"Noto Sans SC","en":"Noto Sans SC"},"typography":{"title":30,"body":18},"margin":0.6,"gridGap":0.3,"chartColors":["25408F","778BA5","B1B9C3"],"table":{"headerFill":"E8EBF0","border":"BBC2CB","cellPadding":0.1},"footer":{"enabled":true,"pageNumber":true,"label":""}}','272ee3e75a4ce9e041d1cd053a4a069152c45e00bcdfc6da3bebc6770fffd7a7');

insert into public.pitch_design_themes(id,state,current_version) values('colliers-render-verification','published',1) on conflict(id) do nothing;
insert into public.pitch_theme_versions(theme_id,version,definition,sha256) values('colliers-render-verification',1,'{"id":"colliers-render-verification","version":1,"approval":"provisional","width":13.333333,"height":7.5,"colors":{"primary":"435866","secondary":"7C868B","background":"F4F5F3","text":"28343A","muted":"56636A"},"logo":{"resource":"colliers-brand-assets/1","enabled":false},"fonts":{"zh":"Noto Sans SC","en":"Noto Sans SC"},"typography":{"title":30,"body":18},"margin":0.6,"gridGap":0.3,"chartColors":["435866","84979A","B5BEBD"],"table":{"headerFill":"E4E9E7","border":"AEBAB7","cellPadding":0.1},"footer":{"enabled":true,"pageNumber":true,"label":""}}','7e3c7a52207c06c0aff3b8733d7b6df7beaca56dba190ac94f161543a3fbaf88');

insert into public.pitch_templates(id,names,category_id,state,current_version) select 'studio-content','{"zh":"结构化业务内容","en":"Structured business content"}',id,'published',1 from public.pitch_asset_categories where system_code='general';
insert into public.pitch_template_versions(template_id,version,adapter,config,sha256) values('studio-content',1,'structured-content/2','{"id":"studio-content","version":1,"names":{"zh":"结构化业务内容","en":"Structured business content"},"categoryCode":"general","assetTypes":["content"],"scenarios":["single-page","multi-page"],"inputSchema":"studio-parameters/2","adapter":"structured-content/2","dataSources":["content_asset"],"requiredPermissions":["internal_generate"],"layouts":["cover","section-divider","image-text","two-columns","kpi","team-profile","case-study","data-table","chart-insight","comparison","map-analysis","strategy-framework"],"exports":["pptx","png","svg","xlsx"],"ai":"none","missingData":"reject"}','b68a1fb28fd50bd5da71d2e7f5bfcdb6c7ad41cce30fe856c9228b748219ef16');
insert into public.pitch_layout_definitions(id,version,engine,definition) values('cover',2,'pitch-layout/2','{"id":"cover","zh":"封面","en":"Cover","kinds":["paragraph","image"],"pagination":"正文超限时拒绝；可选配图","variants":["standard","alternate"],"minBodyPoints":16,"maxPages":50}');
insert into public.pitch_layout_definitions(id,version,engine,definition) values('section-divider',2,'pitch-layout/2','{"id":"section-divider","zh":"章节过渡","en":"Section Divider","kinds":["paragraph"],"pagination":"章节说明超限时拒绝","variants":["standard","alternate"],"minBodyPoints":16,"maxPages":50}');
insert into public.pitch_layout_definitions(id,version,engine,definition) values('image-text',2,'pitch-layout/2','{"id":"image-text","zh":"单图文","en":"Image & Text","kinds":["paragraph","image"],"pagination":"正文按实测行高分页，重复配图","variants":["standard","alternate"],"minBodyPoints":16,"maxPages":50}');
insert into public.pitch_layout_definitions(id,version,engine,definition) values('two-columns',2,'pitch-layout/2','{"id":"two-columns","zh":"双栏内容","en":"Two Columns","kinds":["paragraph"],"pagination":"按栏高连续分页","variants":["standard","alternate"],"minBodyPoints":16,"maxPages":50}');
insert into public.pitch_layout_definitions(id,version,engine,definition) values('kpi',2,'pitch-layout/2','{"id":"kpi","zh":"核心指标","en":"KPI","kinds":["metric"],"pagination":"每页最多六项，长说明明确拒绝","variants":["standard","alternate"],"minBodyPoints":16,"maxPages":50}');
insert into public.pitch_layout_definitions(id,version,engine,definition) values('team-profile',2,'pitch-layout/2','{"id":"team-profile","zh":"团队成员","en":"Team Profile","kinds":["team"],"pagination":"每页两人／三人；缺照片保留文字说明","variants":["standard","alternate"],"minBodyPoints":16,"maxPages":50}');
insert into public.pitch_layout_definitions(id,version,engine,definition) values('case-study',2,'pitch-layout/2','{"id":"case-study","zh":"案例研究","en":"Case Study","kinds":["case","image"],"pagination":"挑战、方法、成果分组连续分页","variants":["standard","alternate"],"minBodyPoints":16,"maxPages":50}');
insert into public.pitch_layout_definitions(id,version,engine,definition) values('data-table',2,'pitch-layout/2','{"id":"data-table","zh":"数据表格","en":"Data Table","kinds":["table"],"pagination":"按每行实测高度分页并重复表头","variants":["standard","alternate"],"minBodyPoints":16,"maxPages":50}');
insert into public.pitch_layout_definitions(id,version,engine,definition) values('chart-insight',2,'pitch-layout/2','{"id":"chart-insight","zh":"图表与分析","en":"Chart & Insight","kinds":["chart","insight"],"pagination":"最多十二标签／四系列；分析按行分页","variants":["standard","alternate"],"minBodyPoints":16,"maxPages":50}');
insert into public.pitch_layout_definitions(id,version,engine,definition) values('comparison',2,'pitch-layout/2','{"id":"comparison","zh":"多项目对比","en":"Comparison","kinds":["table"],"pagination":"指标行与项目列对比，按行高分页；可切换普通矩阵","variants":["standard","alternate"],"minBodyPoints":16,"maxPages":50}');
insert into public.pitch_layout_definitions(id,version,engine,definition) values('map-analysis',2,'pitch-layout/2','{"id":"map-analysis","zh":"地图分析","en":"Map & Analysis","kinds":["map","insight"],"pagination":"固定地理范围；最多十二点，拥挤时拒绝","variants":["standard","alternate"],"minBodyPoints":16,"maxPages":50}');
insert into public.pitch_layout_definitions(id,version,engine,definition) values('strategy-framework',2,'pitch-layout/2','{"id":"strategy-framework","zh":"策略框架","en":"Strategy Framework","kinds":["timeline"],"pagination":"每页三个流程节点，保留日期与说明","variants":["standard","alternate"],"minBodyPoints":16,"maxPages":50}');

update public.pitch_design_themes set current_version=2 where id='colliers-default-v1';
