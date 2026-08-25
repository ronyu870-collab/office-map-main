import { describe, expect, it } from 'vitest';

import type { LeaseTransaction } from '@/src/types/lease-transaction';
import { dbGradeToFormGrade, getAvailableLeasePeriods, mapLeaseRecordToFormDefaults } from './leaseEntryModel';

describe('lease entry model', () => {
  it('maps an existing record without dropping transaction fields', () => {
    const record: LeaseTransaction = {
      id: 'lease-1',
      company: 'Acme',
      enterprise_type: '外企',
      industry: 'Technology',
      sub_industry: 'Software',
      demand_type: '搬迁',
      relocation_area_change: '扩大面积',
      new_building: 'Tower A',
      floor_info: 'A座',
      floor: '15',
      sub_market: 'CBD',
      district: '朝阳区',
      building_grade: 'A',
      old_address: 'Tower B',
      old_sub_market: '燕莎',
      old_district: '朝阳区',
      old_building_grade: 'B',
      area_sqm: 1200,
      face_rent: 180,
      effective_rent: 165,
      lease_term_months: 36,
      rent_free_months: 3,
      fit_out_months: 2,
      transaction_year: 2026,
      transaction_quarter: 'Q3',
      remarks: 'Existing note',
      submitter_id: 'u1',
      submitter_name: 'Broker',
    };

    const defaults = mapLeaseRecordToFormDefaults(record);
    expect(defaults.company).toBe('Acme');
    expect(defaults.building_grade).toBe('甲级');
    expect(defaults.old_building_grade).toBe('乙级');
    expect(defaults.area_sqm).toBe(1200);
    expect(defaults.transaction_quarter).toBe('Q3');
    expect(defaults.remarks).toBe('Existing note');
  });

  it('keeps the current + previous quarter window including year rollover', () => {
    expect(getAvailableLeasePeriods(new Date('2026-01-15T00:00:00Z'), 2025)).toEqual({ years: [2025, 2026], quarters: ['Q4'] });
    expect(getAvailableLeasePeriods(new Date('2026-01-15T00:00:00Z'), 2026)).toEqual({ years: [2025, 2026], quarters: ['Q1'] });
  });

  it('maps database building grades to the form vocabulary', () => {
    expect(dbGradeToFormGrade('P')).toBe('甲级');
    expect(dbGradeToFormGrade('BP')).toBe('产业园');
  });
});
