export type OfficeGrade = 'a' | 'b' | 'park' | 'other';

const grades: Record<string, OfficeGrade> = {
  A: 'a', P: 'a', 'GRADE A': 'a', 'PREMIUM GRADE A': 'a', '甲级': 'a', '甲级写字楼': 'a', '超甲级': 'a',
  B: 'b', 'GRADE B': 'b', '乙级': 'b', '乙级写字楼': 'b',
  BP: 'park', 'BUSINESS PARK': 'park', '产业园': 'park', '产业园区': 'park',
};

/** P is the catalog's premium A code; arbitrary letters never imply a grade. */
export function officeGrade(input: unknown): OfficeGrade {
  return grades[String(input ?? '').trim().replace(/\s+/g, ' ').toUpperCase()] ?? 'other';
}

import { leedFilterValue } from '@/src/lib/leed-display';

/** Canonical map classification for historic certification level spellings.
 * Generic 'LEED' is not a confirmed certification level. */
export function normalizeLeed(value: unknown): string {
  const key = leedFilterValue(value).toUpperCase();
  if (key === 'N' || key === 'NULL') return key;
  if (key === 'PLATINUM' || /\bLEED\b.*(?:PLATINUM|铂金级|白金级)/i.test(key)) return 'Platinum';
  if (key === 'GOLD' || /\bLEED\b.*(?:\bGOLD\b|金级)/i.test(key)) return 'Gold';
  if (key === 'SILVER' || /\bLEED\b.*(?:SILVER|银级)/i.test(key)) return 'Silver';
  if (key === 'CERTIFIED' || key === 'LEED CERTIFIED' || key === '已认证') return 'Certified';
  return 'NULL';
}

export function normalizeMapSubmarket(value: unknown): string {
  const raw = String(value ?? '').trim();
  const key = raw.replace(/[\s·]/g, '').replace(/[—–－/\\]/g, '-');
  if (['望京酒仙桥', '望京-酒仙桥'].includes(key)) return '望京-酒仙桥';
  if (['亦庄经济开发区', '北京经济技术开发区', '亦庄'].includes(key)) return '亦庄';
  if (key.toUpperCase() === 'CBD') return 'CBD';
  if (key.startsWith('其他')) return '其他';
  return key;
}

export function submarketDatabaseNames(name: string): string[] {
  const canonical = normalizeMapSubmarket(name);
  if (canonical === '望京-酒仙桥') return [canonical, '望京酒仙桥', '望京—酒仙桥', '望京–酒仙桥', '望京－酒仙桥', '望京/酒仙桥'];
  if (canonical === '亦庄') return [canonical, '亦庄经济开发区', '北京经济技术开发区'];
  return [canonical];
}

export { hasMapCoordinates as hasMarketCoordinates } from '@/src/lib/map-coordinates';
