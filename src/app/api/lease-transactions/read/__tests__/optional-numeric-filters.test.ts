import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync('src/app/api/lease-transactions/read/route.ts', 'utf8');

describe('lease read optional numeric filters', () => {
  it('does not coerce missing optional numeric parameters to zero', () => {
    expect(routeSource).toContain("function parseOptionalNumber(raw: string | null)");
    expect(routeSource).toContain("if (raw == null || raw.trim() === '') return null;");
    expect(routeSource).toContain("const yearTo = parseOptionalNumber(params.get('year_to'));");
    expect(routeSource).toContain("const areaMax = parseOptionalNumber(params.get('area_max'));");
    expect(routeSource).toContain("if (yearTo !== null) query = query.lte('transaction_year', yearTo);");
    expect(routeSource).toContain("if (areaMax !== null) query = query.lte('area_sqm', areaMax);");

    expect(routeSource).not.toContain("Number(params.get('year_to'))");
    expect(routeSource).not.toContain("Number(params.get('area_max'))");
  });
});
