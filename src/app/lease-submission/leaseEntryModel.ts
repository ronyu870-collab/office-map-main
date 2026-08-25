import type { LeaseTransaction } from '@/src/types/lease-transaction';
import type { LeaseTransactionFormData } from './schemas/leaseTransactionSchema';

export function dbGradeToFormGrade(value: string | null | undefined): '' | '甲级' | '乙级' | '产业园' | '其他' {
  if (!value) return '';
  const normalized = value.trim().toUpperCase();
  if (normalized === 'A' || normalized === 'P' || normalized === '甲级') return '甲级';
  if (normalized === 'B' || normalized === '乙级') return '乙级';
  if (normalized === 'BP' || normalized === '产业园') return '产业园';
  return '其他';
}

export function getAvailableLeasePeriods(now: Date, selectedYear?: number) {
  const currentYear = now.getFullYear();
  const currentQuarter = Math.ceil((now.getMonth() + 1) / 3);
  const currentIndex = (currentYear - 2020) * 4 + currentQuarter;
  const minIndex = currentIndex - 1;
  const maxIndex = currentIndex;
  const minYear = 2020 + Math.floor((minIndex - 1) / 4);
  const maxYear = 2020 + Math.floor((maxIndex - 1) / 4);
  const years: number[] = [];
  for (let year = minYear; year <= maxYear; year += 1) years.push(year);

  const quarters: string[] = [];
  if (selectedYear) {
    for (let quarter = 1; quarter <= 4; quarter += 1) {
      const index = (selectedYear - 2020) * 4 + quarter;
      if (index >= minIndex && index <= maxIndex) quarters.push(`Q${quarter}`);
    }
  }
  return { years, quarters };
}

export function mapLeaseRecordToFormDefaults(record: LeaseTransaction): Partial<LeaseTransactionFormData> {
  const validEnterpriseTypes = ['央国企', '外企', '民企', '其他'] as const;
  const enterpriseType = validEnterpriseTypes.includes(record.enterprise_type as (typeof validEnterpriseTypes)[number])
    ? record.enterprise_type as (typeof validEnterpriseTypes)[number]
    : undefined;

  return {
    company: record.company || '',
    suspected_company_fullname: record.suspected_company_fullname || '',
    enterprise_type: enterpriseType,
    industry: record.industry || '',
    sub_industry: record.sub_industry || '',
    demand_type: (record.demand_type as LeaseTransactionFormData['demand_type']) || undefined,
    relocation_area_change: (record.relocation_area_change as LeaseTransactionFormData['relocation_area_change']) || '',
    is_manual_building: record.is_manual_building || false,
    is_manual_old_building: record.is_manual_old_building || false,
    new_building: record.new_building || '',
    floor_info: record.floor_info || '',
    floor: record.floor || '',
    sub_market: record.sub_market || '',
    district: record.district || '',
    building_grade: dbGradeToFormGrade(record.building_grade),
    old_address: record.old_address || '',
    old_sub_market: record.old_sub_market || '',
    old_district: record.old_district || '',
    old_building_grade: record.old_building_grade === '未知' ? '未知' : dbGradeToFormGrade(record.old_building_grade),
    area_sqm: record.area_sqm ?? undefined,
    face_rent: record.face_rent ?? undefined,
    is_face_rent_estimated: record.is_face_rent_estimated === true,
    lease_term_months: record.lease_term_months ?? undefined,
    fit_out_months: record.fit_out_months ?? undefined,
    rent_free_months: record.rent_free_months ?? undefined,
    effective_rent: record.effective_rent ?? undefined,
    is_effective_rent_estimated: record.is_effective_rent_estimated === true,
    transaction_year: record.transaction_year ?? undefined,
    transaction_quarter: record.transaction_quarter || '',
    remarks: record.remarks || '',
  };
}
