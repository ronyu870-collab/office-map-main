import { describe, expect, it } from 'vitest';
import { projectBrochureParameters } from './marketBrochureComparison';

describe('selected brochure parameters', () => {
  it('uses the latest exact ID edition without filling from old or unrelated rows', () => {
    const rows = [
      { id: 'old', building_id: 'a', created_at: '2025-01-01', standard_floor_area: 200, clear_height: 3 },
      { id: 'new', building_id: 'a', created_at: '2026-01-01', standard_floor_area: '300', clear_height: null, parking_total: 0, completion_date: '2020-01-01', contact_phone: 'private' },
      { id: 'other', building_id: 'b', standard_floor_area: 999, floor_load_office: 500 },
    ];
    expect(projectBrochureParameters(rows, ['a', 'missing'])).toEqual([
      { buildingId: 'a', recordedOn: '2026-01-01', completionDate: '2020-01-01', values: { standard_floor_area: 300, parking_total: 0 } },
    ]);
  });
});
