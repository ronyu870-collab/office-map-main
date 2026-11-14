import {createHash} from 'node:crypto';
import {mapBaseDescriptor} from './mapBaseDescriptor';
import type {MapBase} from './map';
export async function loadMapBase():Promise<MapBase>{
 const base=(await import('@/public/data/ai-query-beijing-base.v1.json')).default;
 if(createHash('sha256').update(JSON.stringify(base)).digest('hex')!==mapBaseDescriptor.sha256)throw Error('CHART_MAP_BASE_MISMATCH');
 return base as MapBase;
}
