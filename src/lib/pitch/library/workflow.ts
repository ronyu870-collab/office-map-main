import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { documentTokens } from '@/src/lib/intelligence/knowledge/parser';
import { DocumentError, limited } from '@/src/lib/intelligence/knowledge/safeArchive';
import { digest, makeFile, readFile, uploadFile, pitchRpc, mediaRowSchema, type PitchContext } from '../data/store';
import { assetInputSchema, slideContentSchema, type ContentAssetInput } from '../contracts/content';
import { designThemeSchema } from '../design/theme';
import { buildTemplateContent, templateConfigSchema } from '../templates/registry';
import { layoutSlides } from '../layout/engine';
import { numberDeckPages } from '../layout/pagination';
import { assertSceneQuality } from '../layout/quality';
import type { FileReference } from '../contracts/entities';
import type { SceneMedia } from '../render/media';
import { inspectMedia } from '../render/media';
import { candidateContent, categoryCandidates, stableId, type SourceInfo } from './extract';
import { fileFormat, openDocument } from './parser';
import { MAX_FILE, CHUNK_SIZE, PARSER_VERSION } from './protocol';
import { mediaThumbnail } from './media';
import { sourceThumbnail } from './thumbnail';
import { normalizationPlan } from './normalize';
import type { LibraryCommand } from './api';
const object = z.record(z.string(), z.unknown());
const docSchema = z.object({ id:z.uuid(),filename:z.string(),mime:z.string(),version:z.number(),data_as_of:z.string().nullable(),language:z.string(),sha256:z.string(),size_bytes:z.coerce.number(),storage_path:z.string(),created_by:z.uuid(),organization_id:z.string(),region:z.string(),city:z.string(),business_line:z.string(),visibility:z.enum(['private','organization']),is_test_data:z.boolean(),category_id:z.uuid(),tags:z.array(z.string()),valid_from:z.string().nullable(),valid_until:z.string().nullable() }).passthrough();
const ctxSchema = z.object({ document:docSchema, job:z.object({ id:z.uuid(),cursor:z.number(),metadata:object,parser_version:z.string(),state:z.string() }).passthrough() });
const scopeOf = (d: z.infer<typeof docSchema>) => ({ organizationId:d.organization_id,region:d.region,city:d.city,businessLine:d.business_line });
const contentHash = (v: unknown) => digest(new TextEncoder().encode(JSON.stringify(v)));
export async function prepareImport(ctx:PitchContext, command:Extract<LibraryCommand,{action:'prepare'}>) {
 const {extension,mime}=fileFormat(command.filename,command.mime),docId=randomUUID(),jobId=randomUUID();
 const dedupKey=contentHash([ctx.identity.actorId,command.filename,command.sha256,command.metadata,command.versionOf??null]);
 return pitchRpc(ctx,{...command,action:'library_prepare',mime,documentId:docId,jobId,dedupKey,parserVersion:PARSER_VERSION,storagePath:`sources/${ctx.identity.actorId}/${docId}/original.${extension}`});
}
export async function uploadPart(ctx:PitchContext,jobId:string,position:number,bytes:Uint8Array) {
 const input={action:'library_part_context',jobId},raw=await pitchRpc(ctx,input),current=ctxSchema.parse(raw);
 const expected=Math.min(CHUNK_SIZE,current.document.size_bytes-position*CHUNK_SIZE);
 if (!Number.isInteger(position)||position<0||position>=Math.ceil(current.document.size_bytes/CHUNK_SIZE)||bytes.length!==expected) throw new Error('PITCH_INVALID');
 const file=makeFile(`imports/${current.document.created_by}/${jobId}/${position}.bin`,'application/octet-stream',bytes);
 await uploadFile(ctx,file,bytes);return pitchRpc(ctx,{action:'library_part_commit',jobId,position,file});
}
export async function finishUpload(ctx:PitchContext,jobId:string) {
 const status=ctxSchema.parse(await pitchRpc(ctx,{action:'library_job_status',jobId}));if(status.document.upload_state==='ready')return {jobId,replayed:true};
 const current=ctxSchema.extend({parts:z.array(z.object({position:z.number(),file:z.unknown()}))}).parse(await pitchRpc(ctx,{action:'library_part_context',jobId}));
 const count=Math.ceil(current.document.size_bytes/CHUNK_SIZE);if(current.parts.length!==count) throw new Error('PITCH_INVALID');
 const bytes=new Uint8Array(current.document.size_bytes);let offset=0;
 for(let i=0;i<count;i++){const part=current.parts.find(p=>p.position===i);if(!part)throw new Error('PITCH_INVALID');const chunk=await readFile(ctx,part.file as Parameters<typeof readFile>[1]);bytes.set(chunk,offset);offset+=chunk.length;}
 if(offset!==bytes.length||digest(bytes)!==current.document.sha256)throw new DocumentError('PITCH_SOURCE_CHANGED','上传数据哈希不一致，请重试原文件。');
 await pitchRpc(ctx,{action:'library_part_context',jobId});await uploadFile(ctx,makeFile(current.document.storage_path,current.document.mime,bytes),bytes);
 return pitchRpc(ctx,{action:'library_upload_complete',jobId});
}
export async function runParseSlice(ctx:PitchContext,jobId:string) {
 const workerToken=randomUUID(),args={jobId,workerToken};let session:Awaited<ReturnType<typeof openDocument>>|undefined;
 try {
  const claim=z.object({claimed:z.boolean()}).passthrough().parse(await pitchRpc(ctx,{action:'library_job_claim',...args}));if(!claim.claimed)return;
  const current=ctxSchema.parse(claim),d=current.document;
  if(current.job.parser_version!==PARSER_VERSION)throw new Error('PITCH_PARSER_VERSION');
  const bytes=await readFile(ctx,makeFileReference(d));session=await openDocument(bytes,d.filename,d.mime);const started=Date.now();
  for(let index=current.job.cursor;index<Math.min(session.count,current.job.cursor+3)&&Date.now()-started<25000;index++) {
   ctx.signal.throwIfAborted();const result=await session.page(index),page=result.page,pageId=stableId(`${d.id}:${PARSER_VERSION}:${page.ordinal}`),assetId=stableId(`${pageId}:asset`);
   const media:{id:string;file:FileReference;thumbnail:FileReference;width:number;height:number;alt:string}[]=[];
   const thumbnailMedia:typeof result.media=[];
   const domain=contentHash([d.created_by,scopeOf(d),d.visibility]);
   for(const file of result.media){
    const id=stableId(`${d.id}:media:${file.sha256}`),ext=file.mime==='image/jpeg'?'jpg':file.mime.split('/')[1],original=makeFile(`media-blobs/${domain}/${file.sha256}.${ext}`,file.mime,file.bytes),thumbBytes=await mediaThumbnail(file),thumbnail=makeFile(`media-thumbs/${domain}/${file.sha256}.webp`,'image/webp',thumbBytes);
    await uploadFile(ctx,original,file.bytes);await uploadFile(ctx,thumbnail,thumbBytes);
    thumbnailMedia.push({...file,bytes:thumbBytes,mime:'image/webp'});
    if(!media.some(m=>m.id===id))media.push({id,file:original,thumbnail,width:file.width,height:file.height,alt:page.title||d.filename});
    for(const img of page.images)if(img.key===file.key)img.mediaId=id;
   }
   const candidate=candidateContent(page,pageId,d as SourceInfo);page.warnings.push(...candidate.warnings);if(candidate.warnings.length)page.status='partial';
   const categories=categoryCandidates(page),match=categories.length===1&&categories[0].confidence==='title_match'?categories[0].code:null;
   const catalog=z.object({categories:z.array(z.object({id:z.uuid(),system_code:z.string()}))}).parse(await pitchRpc(ctx,{action:'catalog'}));
   const categoryId=catalog.categories.find(c=>c.system_code===match)?.id??d.category_id;
   const asset:ContentAssetInput|null=candidate.content?{scope:scopeOf(d),categoryId,tags:d.tags,names:{[d.language.startsWith('en')?'en':'zh']:candidate.content.title},content:candidate.content,state:'draft',visibility:d.visibility,allowInternalGeneration:true,allowClientExport:false,allowExternalAi:false,validFrom:d.valid_from,validUntil:d.valid_until}:null;
   const thumbnailBytes=sourceThumbnail(page,thumbnailMedia),thumbnail=makeFile(`page-thumbs/${d.created_by}/${pageId}/structure.png`,'image/png',thumbnailBytes);await uploadFile(ctx,thumbnail,thumbnailBytes);
   const text=page.texts.map(t=>t.text).join('\n')+'\n'+page.tables.map(t=>[t.columns,...t.rows].map(r=>r.join(' | ')).join('\n')).join('\n')+'\n'+page.charts.map(c=>c.categories.join(' ')+' '+c.series.map(s=>s.name+' '+s.values.join(' ')).join(' ')).join('\n');
   if(text.length>300000)throw limited();
   await pitchRpc(ctx,{action:'library_page_commit',...args,pageId,assetId,page,totalPages:session.count,media,thumbnail,categories,text,tokens:documentTokens(page.title+' '+text).slice(0,20000),asset,contentSha:candidate.content?contentHash(candidate.content):null});
  }
  await pitchRpc(ctx,{action:'library_job_release',...args});
 }catch(error){try{await pitchRpc(ctx,{action:'library_job_fail',...args,errorCode:error instanceof Error?error.message:'PITCH_PARSE_FAILED'});}catch{/* Lease expiry, cancellation and revocation prevent writes. A later authorized status call reconciles the lease. */}}
 finally{await session?.close();}
}
function makeFileReference(d:z.infer<typeof docSchema>){return {bucket:'pitch-studio-private' as const,path:d.storage_path,mime:d.mime,size:d.size_bytes,sha256:d.sha256};}
export async function sourceFile(ctx:PitchContext,documentId:string){const args={action:'library_original',documentId},d=docSchema.parse(await pitchRpc(ctx,args));const bytes=await readFile(ctx,makeFileReference(d));await pitchRpc(ctx,args);return {bytes,mime:d.mime,filename:d.filename};}
export async function thumbnailFile(ctx:PitchContext,input:{pageId?:string;mediaId?:string;version:number}) {
 const args=input.pageId?{action:'library_page',pageId:input.pageId}:{action:'library_media_file',mediaId:input.mediaId,version:input.version};
 const current=z.object({thumbnail:z.unknown()}).parse(input.pageId?z.object({page:z.unknown()}).parse(await pitchRpc(ctx,args)).page:await pitchRpc(ctx,args));
 if(!current.thumbnail)throw new Error('PITCH_INVALID');const file=current.thumbnail as Parameters<typeof readFile>[1],bytes=await readFile(ctx,file);await pitchRpc(ctx,args);return {bytes,mime:file.mime,filename:'thumbnail.'+file.mime.split('/')[1]};
}
export async function assetContext(ctx:PitchContext,assetId:string,version?:number){
 return z.object({asset:object,version:z.object({content:slideContentSchema,version:z.number().int().positive(),
  sha256:z.string().regex(/^[a-f0-9]{64}$/)}),media:z.array(mediaRowSchema),versions:z.array(object).optional()})
  .parse(await pitchRpc(ctx,{action:'library_asset',assetId,version}));
}
export function assetInput(row:Record<string,unknown>,content:unknown):ContentAssetInput{return assetInputSchema.parse({scope:{organizationId:row.organization_id,region:row.region,city:row.city,businessLine:row.business_line},categoryId:row.category_id,tags:row.tags,names:row.names,content,state:row.state,visibility:row.visibility,allowInternalGeneration:row.allow_internal_generation,allowClientExport:row.allow_client_export,allowExternalAi:row.allow_external_ai,validFrom:row.valid_from,validUntil:row.valid_until});}
export async function saveLibraryAsset(ctx:PitchContext,c:Extract<LibraryCommand,{action:'save_asset'}>){
 const existing=c.expectedVersion?await assetContext(ctx,c.assetId):null;
 if(existing&&existing.version.content.sources.some(s=>!c.asset.content.sources.some(r=>JSON.stringify(s)===JSON.stringify(r))))throw new DocumentError('PITCH_SOURCE_REQUIRED','原始来源引用必须保留；可新增来源，不能静默删除。');
 return pitchRpc(ctx,{action:'library_candidate_commit',assetId:c.assetId,pageId:c.pageId,expectedVersion:c.expectedVersion,asset:c.asset,sha256:contentHash(c.asset.content),tokens:documentTokens(JSON.stringify(c.asset.content)),acknowledgePartial:c.acknowledgePartial});
}
export async function confirmAssets(ctx:PitchContext,c:Extract<LibraryCommand,{action:'confirm'}>){
 const items=[];for(const item of c.items){const current=await assetContext(ctx,item.assetId),asset=assetInput(current.asset,current.version.content);asset.state='published';items.push({...item,asset,sha256:contentHash(asset.content),tokens:documentTokens(JSON.stringify(asset.content))});}
 return pitchRpc(ctx,{...c,action:'library_confirm',items});
}
export async function normalizeAsset(ctx:PitchContext,c:Extract<LibraryCommand,{action:'normalize'}>){
 const current=await assetContext(ctx,c.assetId,c.assetVersion);
 const assetVersion=current.version.version;
 const sourceSha=current.version.sha256;
 if(c.assetVersion!==undefined && assetVersion!==c.assetVersion)throw new Error('PITCH_CONFLICT');
 const compositionKey=c.assetVersion===undefined ? undefined : contentHash(['history-standardizer/1',c.projectId,c.assetId,assetVersion,sourceSha,c.title,c.themeId,c.themeVersion]);
 if(compositionKey){
  const prior=await pitchRpc(ctx,{...c,action:'library_normalize_pinned_lookup',compositionKey,sourceSha});
  if(prior!==null)return prior;
 }
 const registry=z.object({template:z.object({config:templateConfigSchema}),theme:z.object({definition:designThemeSchema})}).parse(await pitchRpc(ctx,{action:'registry',templateId:'history-standardizer',templateVersion:1,themeId:c.themeId,themeVersion:c.themeVersion}));
 const content=buildTemplateContent(registry.template.config,current.version.content,{language:current.version.content.locale.startsWith('en')?'en':'zh',layoutId:'two-columns',variant:'standard'}),plan=await normalizationPlan(content,registry.theme.definition),pages=[];
 for(const part of plan)for(const scene of await layoutSlides(part.content,registry.theme.definition,part.layoutId,part.variant))pages.push({slideId:randomUUID(),scene,content:part.content,theme:registry.theme.definition});
 if(pages.length>50)throw limited();const refs=pages.flatMap(p=>p.scene.elements.filter(e=>e.kind==='image'));const files:SceneMedia[]=[];
 for(const ref of refs){const row=current.media.find(m=>m.id===ref.mediaAssetId&&m.version===ref.mediaVersion);if(!row)throw new Error('PITCH_DENIED');if(!files.some(f=>f.id===row.id&&f.version===row.version))files.push({id:row.id,version:row.version,mime:row.mime,bytes:await readFile(ctx,{bucket:'pitch-studio-private',path:row.storage_path,mime:row.mime,size:row.size_bytes,sha256:row.sha256})});}
 const media=await inspectMedia(files);for(const page of pages)await assertSceneQuality(page.scene,page.theme,media);
 const report={engine:'history-normalize/1',assetId:c.assetId,assetVersion,inputSha:contentHash(content),segments:plan.map(p=>({blockIndices:p.blockIndices,layoutId:p.layoutId,changes:p.changes})),sourcePages:content.sources.map(s=>s.pageId).filter(Boolean)};
 return pitchRpc(ctx,{...c,action:compositionKey?'library_normalize_pinned_commit':'library_normalize_commit',assetVersion,
  compositionKey:compositionKey??contentHash([c,report]),sourceSha,report,slides:numberDeckPages(pages).map(({slideId,scene,content})=>({slideId,scene,content}))});
}
export async function mergeAssets(ctx:PitchContext,c:Extract<LibraryCommand,{action:'merge'}>){
 const target=await assetContext(ctx,c.targetId),input=assetInput(target.asset,target.version.content),sources=[];
 for(const id of c.sourceIds){if(id===c.targetId)throw new Error('PITCH_INVALID');const current=await assetContext(ctx,id),a=assetInput(current.asset,current.version.content);if(JSON.stringify(a.scope)!==JSON.stringify(input.scope)||a.content.dataAsOf!==input.content.dataAsOf||a.content.locale!==input.content.locale)throw new DocumentError('PITCH_MERGE_SCOPE','合并要求相同范围、语言及业务日期；其他内容请建立关联版本。');input.content.blocks.push(...a.content.blocks);for(const ref of a.content.sources)if(!input.content.sources.some(s=>s.id===ref.id))input.content.sources.push(ref);sources.push({id,version:current.asset.current_version});}
 input.state='draft';input.allowClientExport=false;input.allowExternalAi=false;input.content.disclosure='internal';assetInputSchema.parse(input);
 return pitchRpc(ctx,{action:'library_merge_commit',targetId:c.targetId,expectedVersion:target.asset.current_version,asset:input,sha256:contentHash(input.content),sources});
}
export async function variantAsset(ctx:PitchContext,c:Extract<LibraryCommand,{action:'variant'}>){const current=await assetContext(ctx,c.assetId),asset=assetInput(current.asset,current.version.content);asset.scope=c.scope;asset.content.locale=c.language;asset.state='draft';asset.allowClientExport=false;asset.allowExternalAi=false;asset.content.disclosure='internal';return pitchRpc(ctx,{action:'library_variant_commit',assetId:c.variantId,sourceId:c.assetId,sourceVersion:current.asset.current_version,kind:c.kind,asset,sha256:contentHash(asset.content)});}
export { MAX_FILE };
