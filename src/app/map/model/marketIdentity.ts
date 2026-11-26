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

export function normalizeLeed(input: unknown): string {
  const value = String(input ?? '').trim().toUpperCase();
  const aliases: Record<string, string> = { PLATINUM: 'Platinum', '铂金级': 'Platinum', '白金级': 'Platinum',
    GOLD: 'Gold', '金级': 'Gold', SILVER: 'Silver', '银级': 'Silver', '': 'NULL', NULL: 'NULL', '无': 'NULL', '-': 'NULL' };
  return aliases[value] ?? value;
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

export function hasMarketCoordinates(building: { location_lng?: unknown; location_lat?: unknown }): boolean {
  const { location_lng: lng, location_lat: lat } = building;
  return typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180
    && typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90;
}
