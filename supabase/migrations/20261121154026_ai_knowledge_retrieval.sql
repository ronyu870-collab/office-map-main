begin;
-- No production grants, source-file reads, external uploads or original-file ACL changes.
create table private.ai_knowledge_grants (
 user_id uuid primary key,enabled boolean not null default false,valid_until timestamptz not null,
 document_ids uuid[] not null default '{}' check(cardinality(document_ids)<=100 and array_position(document_ids,null) is null),
 allow_public_search boolean not null default false,
 revision uuid not null default gen_random_uuid(),change_reference text not null check(length(change_reference) between 1 and 500)
);
alter table private.ai_knowledge_grants enable row level security;
revoke all on private.ai_knowledge_grants from public,anon,authenticated,service_role;
create trigger ai_knowledge_grant_changes before insert or update or delete on private.ai_knowledge_grants for each row execute function private.ai_query_policy_change();
-- Deliberately separate approved public subjects from private building/contact records.
create table private.ai_public_research_subjects (
 building_id uuid primary key references public.buildings(id) on delete cascade,
 public_name text not null check(public_name ~ '^[一-龥A-Za-z0-9 ·（）()_-]{2,100}$'),
 public_city text not null check(public_city ~ '^[一-龥A-Za-z ]{2,40}$'),
 enabled boolean not null default false,revision uuid not null default gen_random_uuid(),
 change_reference text not null check(length(change_reference) between 1 and 500)
);
alter table private.ai_public_research_subjects enable row level security;
revoke all on private.ai_public_research_subjects from public,anon,authenticated,service_role;
create trigger ai_public_subject_changes before insert or update or delete on private.ai_public_research_subjects for each row execute function private.ai_query_policy_change();
-- Building identity and ACL are resolved from the live source/grant join; never copy a stale permission label into the index.
create table private.ai_document_indexes (
 document_id uuid primary key references public.building_sales_materials(id) on delete cascade,
 source_version text not null check(source_version ~ '^[a-f0-9]{64}$'),parser_version text not null check(parser_version='local-text/1'),
 chunk_count integer not null check(chunk_count between 0 and 2000),indexed_at timestamptz not null default now()
);
create table private.ai_document_chunks (
 document_id uuid not null references private.ai_document_indexes(document_id) on delete cascade,
 ordinal integer not null check(ordinal between 0 and 1999),text text not null check(length(text) between 1 and 1200),
 location text not null check(length(location) between 1 and 160),page integer check(page between 1 and 500),
 tokens text[] not null check(cardinality(tokens)<=3000),primary key(document_id,ordinal)
);
create index ai_document_tokens on private.ai_document_chunks using gin(tokens);
alter table private.ai_document_indexes enable row level security;
alter table private.ai_document_chunks enable row level security;
revoke all on private.ai_document_indexes,private.ai_document_chunks from public,anon,authenticated,service_role;
create function private.ai_document_version(m public.building_sales_materials) returns text language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex')
$$;
revoke all on function private.ai_document_version(public.building_sales_materials) from public,anon,authenticated,service_role;
create function private.ai_document_invalidate() returns trigger language plpgsql security definer set search_path='' as $$
begin
 delete from private.ai_document_indexes where document_id=old.id;return new;
end $$;
revoke all on function private.ai_document_invalidate() from public,anon,authenticated,service_role;
create trigger ai_document_source_changed after update on public.building_sales_materials for each row when(old.* is distinct from new.*) execute function private.ai_document_invalidate();

create function private.ai_knowledge_access(p_actor uuid,p_effective uuid,p_session uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare a jsonb;g private.ai_knowledge_grants;ids uuid[];bids uuid[];act text;revision text;result jsonb;doc public.building_sales_materials;counted int;
begin
 a:=public.ai_query_authority(p_actor,p_effective,p_session);
 if a->>'allowed' is distinct from 'true' or p_actor is distinct from p_effective or not (a->'capabilities' ? 'query:catalog') then return jsonb_build_object('allowed',false);end if;
 select * into g from private.ai_knowledge_grants where user_id=p_actor and enabled and valid_until>clock_timestamp();
 if not found then return jsonb_build_object('allowed',false);end if;
 revision:=encode(sha256(convert_to(jsonb_build_array(a->>'permission_revision',g.revision)::text,'UTF8')),'hex');
 act:=p_input->>'action';
 if act='public_subject' then
  if not g.allow_public_search then return jsonb_build_object('allowed',false);end if;
  select jsonb_build_object('buildingId',s.building_id,'name',s.public_name,'city',s.public_city,'version',s.revision) into result
  from private.ai_public_research_subjects s join public.buildings b on b.id=s.building_id
  where s.building_id=(p_input->>'buildingId')::uuid and s.enabled and b.is_active and b.tracking_scope='tracked' and b.merged_into_id is null
   and ((a->>'all_buildings')::boolean or a->'building_ids' ? b.id::text)
   and ((a->>'all_submarkets')::boolean or a->'submarkets' ? b.submarket);
  if result is null then return jsonb_build_object('allowed',false);end if;
  return jsonb_build_object('allowed',true,'revision',revision,'subject',result);
 end if;
 if act='catalog' then
  select array_agg(v::uuid) into bids from jsonb_array_elements_text(p_input->'buildingIds') v;
  if cardinality(bids) not between 1 and 8 then return jsonb_build_object('allowed',false);end if;
  select coalesce(array_agg(m.id),'{}') into ids from public.building_sales_materials m where m.building_id=any(bids) and m.id=any(g.document_ids);
 else
  select coalesce(array_agg(v::uuid),'{}') into ids from jsonb_array_elements_text(p_input->'documentIds') v;
  if cardinality(ids) not between 0 and 100 or not (ids <@ g.document_ids) then return jsonb_build_object('allowed',false);end if;
 end if;
 if exists(select 1 from unnest(ids) as requested(id) where not exists(select 1 from public.building_sales_materials m join public.buildings b on b.id=m.building_id
  where m.id=requested.id and m.status='ready' and m.association_status='confirmed' and b.is_active and b.tracking_scope='tracked' and b.merged_into_id is null
  and ((a->>'all_buildings')::boolean or a->'building_ids' ? b.id::text) and ((a->>'all_submarkets')::boolean or a->'submarkets' ? b.submarket)))
 then return jsonb_build_object('allowed',false);end if;
 if act='store' then
  if cardinality(ids)<>1 then return jsonb_build_object('allowed',false);end if;
  select * into doc from public.building_sales_materials where id=ids[1] for share;
  if private.ai_document_version(doc) is distinct from p_input->>'version' or jsonb_typeof(p_input->'chunks')<>'array' or jsonb_array_length(p_input->'chunks')>2000 then return jsonb_build_object('allowed',false);end if;
  delete from private.ai_document_indexes where document_id=doc.id;
  counted:=jsonb_array_length(p_input->'chunks');
  insert into private.ai_document_indexes(document_id,source_version,parser_version,chunk_count) values(doc.id,p_input->>'version','local-text/1',counted);
  insert into private.ai_document_chunks(document_id,ordinal,text,location,page,tokens)
   select doc.id,(v->>'ordinal')::int,v->>'text',v->>'location',(v->>'page')::int,array(select jsonb_array_elements_text(v->'tokens'))
   from jsonb_array_elements(p_input->'chunks') v;
  if exists(select 1 from generate_series(0,counted-1) n where not exists(select 1 from private.ai_document_chunks c where c.document_id=doc.id and c.ordinal=n)) then raise exception 'INVALID_DOCUMENT_INDEX';end if;
  return jsonb_build_object('allowed',true,'revision',revision);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'buildingId',m.building_id,'title',m.title,'version',private.ai_document_version(m),'sha256',m.source_sha256,
  'mime',m.mime_type,'size',m.file_size,'date',m.document_date,'updatedAt',m.created_at,'online',m.original_location='cloud' and m.storage_path is not null,
  'indexed',exists(select 1 from private.ai_document_indexes i where i.document_id=m.id and i.source_version=private.ai_document_version(m) and i.parser_version='local-text/1'))
  ||case when act='prepare' then jsonb_build_object('storagePath',m.storage_path) else '{}'::jsonb end order by m.id),'[]') into result from public.building_sales_materials m where m.id=any(ids);
 if act='search' then
  -- Tokens and literal terms are parameter data. No dynamic SQL, wildcard or query-language execution.
  if jsonb_array_length(p_input->'terms') not between 1 and 6 or jsonb_array_length(p_input->'tokens')>240 then return jsonb_build_object('allowed',false);end if;
  select jsonb_build_object('documents',result,'total',count(*),'matches',coalesce(jsonb_agg(x.body order by x.document_id,x.ordinal) filter(where x.rn<=least(20,greatest(1,(p_input->>'limit')::int))),'[]')) into result from (
   select c.document_id,c.ordinal,row_number()over(order by c.document_id,c.ordinal) rn,
    jsonb_build_object('documentId',c.document_id,'ordinal',c.ordinal,'text',c.text,'location',c.location,'page',c.page) body
   from private.ai_document_chunks c join private.ai_document_indexes i on i.document_id=c.document_id
    join public.building_sales_materials m on m.id=c.document_id
   where c.document_id=any(ids) and i.source_version=private.ai_document_version(m) and i.parser_version='local-text/1'
    and c.tokens @> array(select jsonb_array_elements_text(p_input->'tokens'))
    and not exists(select 1 from jsonb_array_elements_text(p_input->'terms') t where strpos(lower(c.text),lower(t))=0)
  ) x;
  return jsonb_build_object('allowed',true,'revision',revision,'search',result);
 end if;
 if act not in ('catalog','metadata','prepare') then return jsonb_build_object('allowed',false);end if;
 return jsonb_build_object('allowed',true,'revision',revision,'documents',result);
end $$;
revoke all on function private.ai_knowledge_access(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.ai_knowledge_access(uuid,uuid,uuid,jsonb) to service_role;
create function public.ai_knowledge_access(p_actor uuid,p_effective uuid,p_session uuid,p_input jsonb)
returns jsonb language sql security invoker set search_path='' as $$select private.ai_knowledge_access(p_actor,p_effective,p_session,p_input)$$;
revoke all on function public.ai_knowledge_access(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ai_knowledge_access(uuid,uuid,uuid,jsonb) to service_role;
commit;
