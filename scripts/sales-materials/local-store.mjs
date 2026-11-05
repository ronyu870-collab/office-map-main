import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, copyFile, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';

export const DEFAULT_LOCAL_DIR = resolve('.local/sales-materials');
const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx', 'application/vnd.ms-powerpoint.presentation.macroEnabled.12':'pptm', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx' };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function openLocalStore(directory = DEFAULT_LOCAL_DIR) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(root, 'materials.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    create table if not exists buildings (id text primary key, name text not null, longitude real not null, latitude real not null);
    create table if not exists materials (
      id text primary key, building_id text not null references buildings(id), title text not null,
      document_date text, source text not null, notes text not null, original_name text not null,
      mime_type text not null, file_size integer not null, storage_path text not null unique,
      source_sha256 text not null, extraction_sha256 text not null, details text not null,
      extraction text not null, created_at text not null, status text not null default 'ready',
      unique(building_id, source_sha256, extraction_sha256));
    create index if not exists materials_building_idx on materials(building_id, created_at desc, id desc);
  `);
  const columns = new Set(db.prepare('pragma table_info(materials)').all().map(column => column.name));
  const additions = {series_key:"text not null default 'general'",scope_label:"text not null default '房源资料'",content_types:`text not null default '["availability"]'`,data_date:'text',association_status:"text not null default 'confirmed'",association_note:"text not null default ''",commission_policies:"text not null default '[]'",project_facts:"text not null default '[]'",workbook_preview:'text',historical_context:'text'};
  for (const [name,type] of Object.entries(additions)) if (!columns.has(name)) db.exec(`alter table materials add column ${name} ${type}`);
  db.exec('create index if not exists materials_series_idx on materials(building_id,series_key,data_date desc,created_at desc)');
  return { root, db, close: () => db.close() };
}

export async function importLocalMaterial(store, manifest, filePath, mimeType, catalog) {
  const bytes = await readFile(filePath);
  const sourceHash = sha256(bytes);
  if (sourceHash !== manifest.extraction.source_sha256) throw new Error('原件与解析结果的 SHA-256 不匹配');
  const building = catalog.find(item => item.id === manifest.building_id && item.name === manifest.building_name);
  if (!building) throw new Error('楼宇 ID 与名称未在楼宇目录中精确匹配');
  const extractionHash = sha256(JSON.stringify(manifest));
  const { db, root } = store;
  let finalPath;
  db.exec('begin immediate');
  try {
    const existing = db.prepare('select id from materials where building_id=? and source_sha256=? and extraction_sha256=?').get(manifest.building_id, sourceHash, extractionHash);
    if (existing) { db.exec('commit'); return { id: existing.id, duplicate: true }; }
    db.prepare('insert into buildings(id,name,longitude,latitude) values(?,?,?,?) on conflict(id) do update set name=excluded.name,longitude=excluded.longitude,latitude=excluded.latitude')
      .run(building.id, building.name, building.longitude, building.latitude);
    const id = randomUUID();
    const storagePath = `${manifest.building_id}/${id}/original.${extension[mimeType]}`;
    finalPath = join(root, 'objects', storagePath);
    await mkdir(resolve(finalPath, '..'), { recursive: true, mode: 0o700 });
    const temporary = `${finalPath}.${randomUUID()}.tmp`;
    await copyFile(filePath, temporary);
    // Verify the copy before publishing a DB row that references it.
    if (sha256(await readFile(temporary)) !== sourceHash) throw new Error('原件复制校验失败');
    await rename(temporary, finalPath);
    db.prepare(`insert into materials(id,building_id,title,document_date,source,notes,original_name,mime_type,file_size,storage_path,source_sha256,extraction_sha256,details,extraction,created_at)
      values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, manifest.building_id, manifest.title, manifest.document_date, manifest.source, manifest.notes,
      manifest.original_name || filePath.split(/[\\/]/).pop(), mimeType, bytes.length, storagePath, sourceHash, extractionHash, JSON.stringify(manifest.details), JSON.stringify(manifest), new Date().toISOString());
    db.prepare('update materials set series_key=?,scope_label=?,content_types=?,data_date=?,commission_policies=?,project_facts=?,workbook_preview=?,association_status=?,association_note=? where id=?').run(
      manifest.series_key || 'general', manifest.scope_label || '房源资料', JSON.stringify(manifest.content_types || ['availability']), manifest.source_timing?.as_of?.value || manifest.document_date,
      JSON.stringify(manifest.commission_policies || []), JSON.stringify(manifest.project_facts || []), manifest.workbook_preview ? JSON.stringify(manifest.workbook_preview) : null, manifest.association_status || 'confirmed', manifest.association_note || '', id);
    db.prepare('update materials set historical_context=? where id=?').run(manifest.historical_context?JSON.stringify(manifest.historical_context):null,id);
    db.exec('commit');
    return { id, duplicate: false };
  } catch (error) {
    db.exec('rollback');
    if (finalPath) await unlink(finalPath).catch(() => {});
    throw error;
  }
}

export function listLocalBuildings(store) {
  return store.db.prepare("select b.*,count(m.id) as material_count from buildings b join materials m on m.building_id=b.id and m.status='ready' group by b.id order by b.name").all();
}
export function listLocalMaterials(store, buildingId, page, limit) {
  const records = store.db.prepare("select id,title,document_date,source,notes,original_name,mime_type,file_size,created_at,series_key,scope_label,content_types,data_date,association_status,association_note,historical_context from materials where building_id=? and status='ready' order by created_at desc,id desc limit ? offset ?").all(buildingId, limit, page * limit);
  const count = store.db.prepare("select count(*) as n from materials where building_id=? and status='ready'").get(buildingId).n;
  return { records:records.map(row=>({...row,content_types:JSON.parse(row.content_types),historical_context:row.historical_context?JSON.parse(row.historical_context):null})), count };
}
export function getLocalMaterial(store, buildingId, materialId) {
  const row = store.db.prepare("select * from materials where building_id=? and id=? and status='ready'").get(buildingId, materialId);
  return row ? { ...row, historical_context:row.historical_context?JSON.parse(row.historical_context):null, details: JSON.parse(row.details),content_types:JSON.parse(row.content_types),commission_policies:JSON.parse(row.commission_policies),project_facts:JSON.parse(row.project_facts),workbook_preview:row.workbook_preview?JSON.parse(row.workbook_preview):undefined } : null;
}
export async function originalLocalFile(store, buildingId, materialId) {
  const row = getLocalMaterial(store, buildingId, materialId);
  if (!row) return null;
  const path = resolve(store.root, 'objects', row.storage_path);
  if (!path.startsWith(join(store.root, 'objects') + '/')) throw new Error('无效原件路径');
  const bytes = await readFile(path);
  if (sha256(bytes) !== row.source_sha256) throw new Error('原件校验失败');
  return { row, bytes };
}
