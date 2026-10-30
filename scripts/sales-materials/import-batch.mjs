import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateImport } from './ingest.mjs';
import { loadLocalCatalog } from './building-catalog.mjs';
import { openLocalStore, importLocalMaterial } from './local-store.mjs';

/** Validate every document before publishing any local record. Reruns are idempotent. */
export async function importLocalBatch(indexPath, directory) {
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  if (!Array.isArray(index) || !index.length || index.length > 200) throw new Error('批次必须包含1–200份资料');
  const catalog = await loadLocalCatalog(directory);
  const validated = [];
  for (const item of index) {
    if (typeof item.manifest !== 'string' || typeof item.file !== 'string') throw new Error('批次条目缺少 manifest 或 file');
    const file = resolve(dirname(indexPath), item.file);
    const { manifest, mimeType } = await validateImport(resolve(dirname(indexPath), item.manifest), file);
    if (!catalog.some(building => building.id === manifest.building_id && building.name === manifest.building_name)) throw new Error(`${manifest.building_name}：楼宇目录未精确匹配`);
    validated.push({ manifest, mimeType, file });
  }
  const store = await openLocalStore(directory);
  const results = [];
  try {
    for (const { manifest, mimeType, file } of validated) {
      const result = await importLocalMaterial(store, manifest, file, mimeType, catalog);
      results.push({ ...result, building: manifest.building_name, title: manifest.title, data_date: manifest.source_timing?.as_of?.value || manifest.document_date, rows: manifest.details.length, policies: manifest.commission_policies.length });
    }
    return results;
  } finally { store.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const index = args.indexOf('--batch');
  if (index < 0 || !args[index + 1]) throw new Error('用法：node --experimental-strip-types scripts/sales-materials/import-batch.mjs --batch imports.json [--dir 本地目录]');
  const dir = args.indexOf('--dir');
  importLocalBatch(resolve(args[index + 1]), dir >= 0 ? args[dir + 1] : undefined).then(results => console.log(JSON.stringify(results, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
