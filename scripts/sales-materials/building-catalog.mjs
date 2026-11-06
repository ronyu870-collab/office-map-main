import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEFAULT_LOCAL_DIR } from './local-store.mjs';

export async function loadLocalCatalog(directory = DEFAULT_LOCAL_DIR) {
  const geo = JSON.parse(await readFile(new URL('../../public/data/building_footprints.geojson', import.meta.url), 'utf8'));
  const rows = new Map(geo.features.map(({ properties:p }) => [p.building_id, {id:p.building_id,name:p.building_name,longitude:p.point_lng,latitude:p.point_lat}]));
  let verified = [];
  try { verified = JSON.parse(await readFile(resolve(directory, 'building-catalog.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const row of verified) {
    if (row.is_active !== true || row.tracking_scope !== 'tracked' || !Number.isFinite(row.longitude) || !Number.isFinite(row.latitude)) throw new Error('楼宇目录包含未核实的地图范围');
    rows.set(row.id, row);
  }
  return [...rows.values()];
}
