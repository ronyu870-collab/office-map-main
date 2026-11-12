import { z } from 'zod';

const strings = z.array(z.string().max(100)).max(100);
const criteria = z.object({
  districts: strings, submarkets: strings, leeds: strings, projectTypes: strings,
  showBoundaries: z.boolean(), subwayLine: z.string().max(100).nullable(),
  subwayStation: z.null(), subwayDistance: z.number().finite().nullable(),
  numericFilters: z.array(z.object({
    id: z.string().max(100),
    field: z.enum(['net_effective_rent', 'vacancy_rate', 'vacant_area', 'total_area', 'management_fee', 'owner', 'property_management']),
    operator: z.enum(['>=', '<=', '=', '>', '<']),
    value: z.union([z.number().finite(), z.string().max(200)]),
  })).max(25),
  showFutureSupply: z.boolean(), futureSupplyGrades: strings, futureSupplyYears: strings,
});
const preference = z.object({ input: z.string().max(200), filters: criteria.nullable() });

export function readMapFilterPreference(key: string) {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = preference.safeParse(JSON.parse(window.sessionStorage.getItem(key) ?? 'null'));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
