import { describe, expect, it } from 'vitest';

import { getAvailableLeasePeriods } from '../leaseEntryModel';
import { leaseTransactionSchema } from '../schemas/leaseTransactionSchema';

const validBrokerEntry = {
  company: '测试企业',
  new_building: '测试大厦',
  floor_info: 'A座',
  floor: '15',
  transaction_year: 2026,
  transaction_quarter: 'Q2',
  area_sqm: 500,
  effective_rent: 135,
  face_rent: 150,
  enterprise_type: '外企',
  industry: '专业服务',
  sub_industry: '咨询服务',
  demand_type: '新租',
  sub_market: 'CBD',
  district: '朝阳区',
  building_grade: '甲级',
  is_manual_building: false,
  is_manual_old_building: false,
  is_face_rent_estimated: false,
  is_effective_rent_estimated: false,
};

describe('Lease broker entry smoke contract', () => {
  it('accepts a normal broker lease entry without changing business enum values', () => {
    const result = leaseTransactionSchema.safeParse(validBrokerEntry);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.transaction_quarter).toBe('Q2');
    expect(result.data.enterprise_type).toBe('外企');
    expect(result.data.demand_type).toBe('新租');
    expect(result.data.building_grade).toBe('甲级');
    expect(result.data.area_sqm).toBe(500);
    expect(result.data.face_rent).toBe(150);
    expect(result.data.effective_rent).toBe(135);
  });

  it('rejects a translated or malformed quarter value so Q1-Q4 stays the database contract', () => {
    const translatedQuarter = leaseTransactionSchema.safeParse({
      ...validBrokerEntry,
      transaction_quarter: '第2季度',
    });
    const malformedQuarter = leaseTransactionSchema.safeParse({
      ...validBrokerEntry,
      transaction_quarter: '2026Q2',
    });

    expect(translatedQuarter.success).toBe(false);
    expect(malformedQuarter.success).toBe(false);
  });

  it('keeps the period selector output in professional Q notation', () => {
    const { quarters } = getAvailableLeasePeriods(new Date('2026-05-15T12:00:00+08:00'), 2026);
    expect(quarters.length).toBeGreaterThan(0);
    expect(quarters.every((quarter) => /^Q[1-4]$/.test(quarter))).toBe(true);
  });

  it('still enforces broker-facing required fields', () => {
    const result = leaseTransactionSchema.safeParse({
      ...validBrokerEntry,
      company: '',
      new_building: '',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toContain('company');
    expect(paths).toContain('new_building');
  });
});
