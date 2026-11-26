import { restoreLeedFilterCatalog } from '@/src/lib/leed-display';
import { z } from 'zod';

const strings = z.array(z.string().max(100)).max(100);
export const mapFilterCriteria = z.object({
  districts: strings, submarkets: strings, leeds: strings, projectTypes: strings,
  showBoundaries: z.boolean(), subwayLine: z.string().max(100).nullable(),
  subwayStation: z.object({
    id: z.union([z.string().max(100), z.number().finite()]).optional(), name: z.string().max(100),
    center: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  }).nullable(), subwayDistance: z.number().finite().nullable(),
  numericFilters: z.array(z.object({
    id: z.string().max(100),
    field: z.enum(['net_effective_rent', 'vacancy_rate', 'vacant_area', 'total_area', 'management_fee', 'owner', 'property_management']),
    operator: z.enum(['>=', '<=', '=', '>', '<']),
    value: z.union([z.number().finite(), z.string().max(200)]),
  })).max(25),
  showFutureSupply: z.boolean(), futureSupplyGrades: strings, futureSupplyYears: strings,
});
const preference = z.object({ leedCatalogVersion: z.literal(2).optional(), input: z.string().max(200), filters: mapFilterCriteria.nullable() });

export function readMapFilterPreference(key: string) {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = preference.safeParse(JSON.parse(window.sessionStorage.getItem(key) ?? 'null'));
    return parsed.success ? { ...parsed.data, filters: restoreLeedFilterCatalog(parsed.data.filters, parsed.data.leedCatalogVersion) } : null;
  } catch { return null; }
}

/** Persist plain criteria only, never live SDK instances. */
export function serializableMapFilters(value: unknown) {
  const result = mapFilterCriteria.safeParse(value);
  return result.success ? result.data : null;
}
