import {createHash} from 'node:crypto';
import {z} from 'zod';
import {projectFactSchema,commissionPolicySchema} from '../../src/lib/sales-materials/model.ts';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const section=z.object({scope:z.string().min(1).max(160),candidate_building_ids:z.array(z.uuid()).max(30),association_status:z.enum(['confirmed','unconfirmed','unmapped','reference']),facts:z.array(projectFactSchema).max(1000),commission_policies:z.array(commissionPolicySchema).max(40),notes:z.array(z.string().max(2000)).max(100),issue_ids:z.array(z.string().max(50)).max(40),kind:z.string().min(1).max(60)}).strict();
export const libraryRecordSchema=z.object({id:z.uuid(),source_sha256:hash,original_name:z.string().min(1).max(255),review_state:z.enum(['reviewed','needs_association','reference','excluded','recovered_partial']),batch_key:z.string().regex(/^[a-z][a-z0-9_-]{0,99}$/),payload:z.object({schema_version:z.literal(1),source_sha256:hash,originals:z.array(z.object({relative_path:z.string().min(1).max(1000),original_name:z.string().min(1).max(255),size:z.number().int().positive()})).min(1).max(100),historical_context:z.object({period_label:z.string().min(1),evidence:z.string().min(1),not_current:z.literal(true)}),text_pages:z.array(z.number().int().min(1).max(10000)).max(10000),sections:z.array(section).max(1000),review:z.object({scope:z.string().min(1),conclusion:z.string().min(1),issue_ids:z.array(z.string()),method:z.string(),source_state:z.enum(['ok','recovered_partial','excluded']),normalization:z.string(),revision:z.string().min(1)}).strict()}).strict()}).strict().refine(x=>x.source_sha256===x.payload.source_sha256,'Source hash mismatch').refine(x=>x.review_state!=='excluded'||(x.payload.text_pages.length===0&&x.payload.sections.length===0),'Excluded source contains private content');
export function validateLibrary(records,pages){
 const parsed=z.array(libraryRecordSchema).parse(records),byId=new Map(parsed.map(r=>[r.id,r]));
 if(byId.size!==parsed.length||new Set(parsed.map(r=>r.source_sha256)).size!==parsed.length)throw Error('Duplicate extraction/source in one batch');
 const keys=new Set();
 for(const p of pages){
  if(!byId.has(p.extraction_id)||!Number.isInteger(p.page_number)||p.page_number<1||p.content.page!==p.page_number||typeof p.content.native_text!=='string'||!Array.isArray(p.content.ocr_layers))throw Error('Invalid page linkage');
  if(!byId.get(p.extraction_id).payload.text_pages.includes(p.page_number))throw Error('Undeclared evidence page');
  const key=p.extraction_id+':'+p.page_number;if(keys.has(key))throw Error('Duplicate source page');keys.add(key);
  for(const layer of p.content.ocr_layers)if(layer.verified!==false||typeof layer.text!=='string')throw Error('OCR must remain unverified evidence');
 }
 for(const r of parsed)for(const n of r.payload.text_pages)if(!keys.has(r.id+':'+n))throw Error('Missing evidence page');
 return parsed;
}
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const encoded=value=>q(JSON.stringify(value))+'::jsonb';
function dollarTag(value){let name='verify_'+contentDigest(value).slice(0,16);while(String(value).includes('$'+name+'$'))name+='_x';return '$'+name+'$';}
const audit=(kind,batch,count)=>`insert into public.audit_logs(user_id,action_type,module,page_url,target_name,request_source,details) values('codex',${q(kind)},'map','/map','历史项目资料库','server',jsonb_build_object('batch',${q(batch)},'planned_rows',${count},'historical_only',true));`;
export function libraryMetadataSQL(records){
 const data=encoded(records),batch=records[0]?.batch_key||'empty',tag=dollarTag(data);
 return `begin;set local lock_timeout='8s';set local statement_timeout='60s';
lock table public.project_material_library in share row exclusive mode;
insert into public.project_material_library(id,source_sha256,payload_sha256,original_name,archive_reference,review_state,batch_key,payload)
select (x->>'id')::uuid,x->>'source_sha256',encode(sha256(convert_to((x->'payload')::text,'UTF8')),'hex'),x->>'original_name','sha256:'||(x->>'source_sha256'),x->>'review_state',x->>'batch_key',x->'payload' from jsonb_array_elements(${data}) x on conflict(source_sha256,payload_sha256) do nothing;
do ${tag} begin if exists(select 1 from jsonb_array_elements(${data}) x left join public.project_material_library l on l.id=(x->>'id')::uuid where l.id is null or l.payload is distinct from x->'payload' or l.review_state is distinct from x->>'review_state') then raise exception 'Library metadata conflict';end if;end ${tag};
${audit('PROJECT_MATERIAL_LIBRARY_IMPORT',batch,records.length)}
commit;select ${records.length}::int as checked_metadata_rows;`;
}
export function libraryPagesSQL(pages,batch){
 const data=encoded(pages),tag=dollarTag(data);
 return `begin;set local lock_timeout='8s';set local statement_timeout='60s';
insert into public.project_material_library_pages(extraction_id,page_number,content,content_sha256) select (x->>'extraction_id')::uuid,(x->>'page_number')::int,x->'content',encode(sha256(convert_to((x->'content')::text,'UTF8')),'hex') from jsonb_array_elements(${data}) x on conflict(extraction_id,page_number) do nothing;
do ${tag} begin if exists(select 1 from jsonb_array_elements(${data}) x left join public.project_material_library_pages p on p.extraction_id=(x->>'extraction_id')::uuid and p.page_number=(x->>'page_number')::int where p.extraction_id is null or p.content is distinct from x->'content') then raise exception 'Library page conflict';end if;end ${tag};
${audit('PROJECT_MATERIAL_PAGE_IMPORT',batch,pages.length)}
commit;select ${pages.length}::int as checked_source_pages;`;
}
export function contentDigest(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}

/** Relink a proven misassociated brochure without merging master identities. */
export function brochureRelinkSQL(plan){
 const {from,to,brochure_id,expected_brochure,expected_provenance_count,batch_key}=plan;
 for(const x of [from.id,to.id,brochure_id])z.uuid().parse(x);
 if(from.id===to.id||expected_brochure.id!==brochure_id||expected_brochure.building_id!==from.id)throw Error('Invalid brochure relink plan');
 const fid=q(from.id),tid=q(to.id),rid=q(brochure_id),expected=encoded(expected_brochure),tag=dollarTag(JSON.stringify(plan));
 return `begin;set local timezone='UTC';set local lock_timeout='8s';set local statement_timeout='60s';
lock table public.building_brochure_data,public.building_data_field_provenance in share row exclusive mode;
do ${tag} declare old_row jsonb;after_row jsonb;old_refs jsonb;after_refs jsonb;n integer;begin
perform 1 from public.buildings where id in (${fid},${tid}) order by id for update;
if (select count(*) from public.buildings where (id=${fid} and name=${q(from.name)} or id=${tid} and name=${q(to.name)}) and is_active and tracking_scope='tracked' and merged_into_id is null)<>2 then raise exception 'Building scope changed';end if;
select to_jsonb(d) into old_row from public.building_brochure_data d where d.id=${rid};
if old_row->>'building_id'=${tid} then
 if (old_row-'building_id'-'updated_at') is distinct from (${expected}-'building_id'-'updated_at') then raise exception 'Completed relink content changed';end if;
 if (select count(*) from public.building_data_field_provenance where brochure_data_id=${rid} and building_id=${tid})<>${expected_provenance_count} then raise exception 'Completed provenance mismatch';end if;
 return;
end if;
if old_row is distinct from ${expected} then raise exception 'Brochure snapshot changed';end if;
if exists(select 1 from public.building_brochure_data where building_id=${tid}) then raise exception 'Target already has a brochure';end if;
if (select count(*) from public.building_data_field_provenance where brochure_data_id=${rid} and building_id=${fid})<>${expected_provenance_count} then raise exception 'Provenance snapshot changed';end if;
select jsonb_agg(to_jsonb(p)-'building_id' order by p.id) into old_refs from public.building_data_field_provenance p where brochure_data_id=${rid};
update public.building_brochure_data set building_id=${tid} where id=${rid} and building_id=${fid};get diagnostics n=row_count;if n<>1 then raise exception 'Brochure relink failed';end if;
update public.building_data_field_provenance set building_id=${tid} where brochure_data_id=${rid} and building_id=${fid};get diagnostics n=row_count;if n<>${expected_provenance_count} then raise exception 'Provenance relink failed';end if;
select to_jsonb(d) into after_row from public.building_brochure_data d where d.id=${rid};
select jsonb_agg(to_jsonb(p)-'building_id' order by p.id) into after_refs from public.building_data_field_provenance p where brochure_data_id=${rid};
if (after_row-'building_id'-'updated_at') is distinct from (old_row-'building_id'-'updated_at') or old_refs is distinct from after_refs then raise exception 'Source values changed during relink';end if;
insert into public.audit_logs(user_id,action_type,module,page_url,target_name,request_source,details) values('codex','BROCHURE_ASSOCIATION_CORRECTION','map','/map',${q(to.name)},'server',jsonb_build_object('batch',${q(batch_key)},'from_building_id',${fid},'to_building_id',${tid},'brochure_id',${rid},'before',old_row,'after',after_row,'provenance_rows',${expected_provenance_count},'evidence',${encoded(plan.evidence)}));
end ${tag};commit;`;
}
