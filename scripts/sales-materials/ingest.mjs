import { resolveImportActor } from './audit-actor.mjs';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { loadLocalCatalog } from './building-catalog.mjs';
import JSZip from 'jszip';
import { fileURLToPath } from 'node:url';
import { materialImportSchema, materialMimeType, matchesMaterialSignature, MAX_MATERIAL_BYTES, SALES_MATERIAL_BUCKET, XLSX_MIME, PPTX_MIME, PPTM_MIME } from '../../src/lib/sales-materials/model.ts';
import { openLocalStore, importLocalMaterial, sha256 } from './local-store.mjs';

export async function validateImport(manifestPath, filePath) {
  const manifest = materialImportSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  const bytes = await readFile(filePath);
  const mimeType = materialMimeType(manifest.original_name || basename(filePath), '');
  if (!mimeType || bytes.length === 0 || bytes.length > MAX_MATERIAL_BYTES || !matchesMaterialSignature(bytes.subarray(0,16), mimeType)) throw new Error('原文件格式或大小无效');
  if (mimeType === XLSX_MIME) {
    const zip = await JSZip.loadAsync(bytes);
    if (!zip.file('xl/workbook.xml') || !zip.file('[Content_Types].xml') || !manifest.workbook_preview) throw new Error('Excel 原件或内容预览不完整');
  }
  if ([PPTX_MIME,PPTM_MIME].includes(mimeType)) {
    const zip = await JSZip.loadAsync(bytes);
    if (!zip.file('ppt/presentation.xml') || !zip.file('[Content_Types].xml')) throw new Error('PowerPoint原件结构不完整');
  }
  if (sha256(bytes) !== manifest.extraction.source_sha256) throw new Error('原件与解析结果的 SHA-256 不匹配');
  return { manifest, bytes, mimeType };
}

export async function importToSupabase(manifest, bytes, mimeType, originalName, client, apply = false, originalMode = 'cloud', actorUserId) {
  if (!['cloud','local_archive'].includes(originalMode)) throw new Error('未知原件保存方式');
  if (originalMode === 'local_archive' && (!manifest.historical_context || manifest.extraction.historical_import_authorized !== true)) throw new Error('仅已授权历史资料支持本地原件归档');
  const actor = apply ? await resolveImportActor(client, actorUserId) : null;
  const { data: building, error: scopeError } = await client.from('buildings').select('id,name').eq('id',manifest.building_id)
    .eq('is_active',true).eq('tracking_scope','tracked').maybeSingle();
  if (scopeError || !building || building.name !== manifest.building_name) throw new Error('楼宇 ID、名称或地图范围不匹配');
  const sourceHash = sha256(bytes), extractionHash = sha256(JSON.stringify(manifest));
  const { data: existing, error: lookupError } = await client.from('building_sales_materials').select('id,status')
    .eq('building_id',manifest.building_id).eq('source_sha256',sourceHash).eq('extraction_sha256',extractionHash).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing?.status === 'ready') return { id: existing.id, duplicate: true };
  if (existing?.status === 'archived') throw new Error('该资料已撤回，请先核实撤回原因');
  if (!apply) return { dry_run: true, building: building.name, rows: manifest.details.length, source_sha256: sourceHash };
  const { randomUUID } = await import('node:crypto');
  const id = existing?.id || randomUUID();
  const ext = { 'image/png':'png','image/jpeg':'jpg','image/webp':'webp','application/pdf':'pdf',[XLSX_MIME]:'xlsx',[PPTX_MIME]:'pptx',[PPTM_MIME]:'pptm' }[mimeType];
  const path = originalMode === 'cloud' ? `${building.id}/${id}/original.${ext}` : null;
  if (!existing) {
    const result = await client.from('building_sales_materials').insert({id,building_id:building.id,title:manifest.title,document_date:manifest.document_date,source:manifest.source,notes:manifest.notes,
      original_name:originalName,storage_path:path,original_location:originalMode,archive_reference:originalMode === 'local_archive' ? `sha256:${sourceHash}` : null,mime_type:mimeType,file_size:bytes.length,source_sha256:sourceHash,extraction_sha256:extractionHash,extraction:manifest,status:'pending',series_key:manifest.series_key,scope_label:manifest.scope_label,content_types:manifest.content_types,data_date:manifest.source_timing?.as_of?.value || manifest.document_date,commission_policies:manifest.commission_policies,project_facts:manifest.project_facts,workbook_preview:manifest.workbook_preview || null,association_status:manifest.association_status,association_note:manifest.association_note,historical_context:manifest.historical_context || null});
    if (result.error) throw result.error;
  }
  if (originalMode === 'cloud') {
  const bucket = client.storage.from(SALES_MATERIAL_BUCKET);
  const found = await bucket.download(path);
  if (found.error) {
    const upload = await bucket.upload(path, bytes, { contentType:mimeType, upsert:false });
    if (upload.error) throw upload.error;
  }
  const verified = await bucket.download(path);
  if (verified.error || sha256(new Uint8Array(await verified.data.arrayBuffer())) !== sourceHash) throw new Error('云端原件校验失败，资料未发布');
  }
  const published = await client.from('building_sales_materials').update({details:manifest.details,status:'ready',published_at:new Date().toISOString()}).eq('id',id).eq('status','pending').select('id').maybeSingle();
  if (published.error || !published.data) throw new Error('资料发布失败，请检查任务状态');
  const audit = await client.from('audit_logs').insert({user_id:actor,action_type:'SALES_MATERIAL_IMPORT',module:'map',page_url:'/map',target_name:manifest.building_name,request_source:'server',details:{executor:'codex',material_id:id,building_id:building.id,source_sha256:sourceHash,row_count:manifest.details.length,method:manifest.extraction.method}});
  if (audit.error) console.error('资料已入库；审计写入失败，请补记', audit.error.code);
  return { id, duplicate:false };
}

async function main() {
  const args = process.argv.slice(2);
  const value = key => args[args.indexOf(key)+1];
  if (!args.includes('--manifest') || !args.includes('--file')) throw new Error('用法：node --experimental-strip-types scripts/sales-materials/ingest.mjs --manifest 解析结果.json --file 原图.png [--target local|supabase] [--dir 本地目录] [--apply --actor-user-id 管理员UUID]');
  const manifestPath = resolve(value('--manifest')), filePath = resolve(value('--file'));
  const { manifest, bytes, mimeType } = await validateImport(manifestPath,filePath);
  const target = args.includes('--target') ? value('--target') : 'local';
  let result;
  if (target === 'local') {
    const catalog = await loadLocalCatalog(args.includes('--dir') ? value('--dir') : undefined);
    const store = await openLocalStore(args.includes('--dir') ? value('--dir') : undefined);
    try { result = await importLocalMaterial(store,manifest,filePath,mimeType,catalog); } finally { store.close(); }
  } else if (target === 'supabase') {
    const {createClient} = await import('@supabase/supabase-js');
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL,secret=process.env.SUPABASE_SECRET_KEY;
    if (!url||!secret) throw new Error('缺少服务端 Supabase 配置');
    result=await importToSupabase(manifest,bytes,mimeType,(manifest.original_name || basename(filePath)),createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}}),args.includes('--apply'),args.includes('--original-mode') ? value('--original-mode') : 'cloud',args.includes('--actor-user-id') ? value('--actor-user-id') : undefined);
  } else throw new Error('未知导入目标');
  console.log(JSON.stringify({ ...result, building:manifest.building_name, source_row_count:manifest.details.length, policy_count:manifest.commission_policies.length },null,2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error=>{ console.error(error.message); process.exitCode=1; });
