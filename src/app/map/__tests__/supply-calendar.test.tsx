import { describe, expect, it } from 'vitest';

import {
  SUPPLY_CALENDAR_CATEGORIES,
  buildFutureSupplyCalendar,
  categorizeSupply,
  createDefaultFilterState,
  filterFutureSupplies,
  safeParseSupplyYear,
} from '@/src/app/map/model/mapDomain';

describe('map supply calendar domain model', () => {
  it('finds and filters pending map points without changing the confirmed supply calendar', () => {
    const pending = { id: 'yufu', name: '裕惠大厦', status: 'pending', district: '海淀区', submarket: '玉渊潭', type: null, grade: null, launch_year: null };
    const confirmed = { id: '640', name: '玉渊潭640地块商业项目', status: 'future', district: '海淀区', submarket: '玉渊潭', type: '商业', grade: null, launch_year: '2027' };
    const filterState = createDefaultFilterState();
    expect(filterFutureSupplies([confirmed, pending], filterState, '裕惠')).toEqual([pending]);
    expect(filterFutureSupplies([confirmed, pending], { ...filterState, futureSupplyGrades: ['pending'] }, '')).toEqual([pending]);
    expect(filterFutureSupplies([confirmed, pending], { ...filterState, futureSupplyGrades: ['commercial'] }, '')).toEqual([confirmed]);
    expect(buildFutureSupplyCalendar([confirmed, pending])).toEqual(buildFutureSupplyCalendar([confirmed]));
  });


  it('finds commercial future supply without a grade or submarket and keeps it out of office supply', () => {
    const commercial = { id: '640', name: '玉渊潭640地块商业项目', type: '商业', district: '海淀区', submarket: null, grade: null, launch_year: '2027' };
    const office = { id: 'office', name: '办公未来项目', district: '海淀区', submarket: '其他', grade: 'B', launch_year: '2027' };
    const all = [commercial, office];
    const filter = createDefaultFilterState();
    expect(filterFutureSupplies(all, filter, '玉渊潭 640').map(x => x.id)).toEqual(['640']);
    expect(filterFutureSupplies(all, { ...filter, futureSupplyGrades: ['A', 'B'] }, '玉渊潭 640')).toEqual([]);
    expect(buildFutureSupplyCalendar(all)['2027']).toEqual({ total: 2, office: 1, park: 0, commercial: 1 });
  });

  describe('safeParseSupplyYear', () => {
    it('accepts supported numeric and string year fields', () => {
      expect(safeParseSupplyYear({ launch_year: 2026 })).toBe(2026);
      expect(safeParseSupplyYear({ launchYear: '2027' })).toBe(2027);
      expect(safeParseSupplyYear({ year: 2028 })).toBe(2028);
    });

    it('rejects missing, malformed and out-of-range years', () => {
      expect(safeParseSupplyYear({})).toBeNull();
      expect(safeParseSupplyYear({ launch_year: null })).toBeNull();
      expect(safeParseSupplyYear({ launch_year: '' })).toBeNull();
      expect(safeParseSupplyYear({ launch_year: 'invalid' })).toBeNull();
      expect(safeParseSupplyYear({ launch_year: 1899 })).toBeNull();
      expect(safeParseSupplyYear({ launch_year: 2101 })).toBeNull();
      expect(safeParseSupplyYear({ launch_year: Number.POSITIVE_INFINITY })).toBeNull();
    });
  });

  describe('categorizeSupply', () => {
    it('matches the current five-bucket Home map contract', () => {
      expect(SUPPLY_CALENDAR_CATEGORIES).toEqual([
        '2026',
        '2027',
        '2028',
        '2029AndAfter',
        'noDate',
      ]);

      expect(categorizeSupply({ launch_year: 2026 })).toBe('2026');
      expect(categorizeSupply({ launch_year: 2027 })).toBe('2027');
      expect(categorizeSupply({ launch_year: 2028 })).toBe('2028');
      expect(categorizeSupply({ launch_year: 2029 })).toBe('2029AndAfter');
      expect(categorizeSupply({ launch_year: 2035 })).toBe('2029AndAfter');
      expect(categorizeSupply({ launch_year: 2025 })).toBe('noDate');
      expect(categorizeSupply({ launch_year: 'invalid' })).toBe('noDate');
    });
  });

  describe('buildFutureSupplyCalendar', () => {
    it('counts office and park projects without duplicating calendar logic in the test', () => {
      const calendar = buildFutureSupplyCalendar([
        { name: 'A', launch_year: 2026, grade: 'A' },
        { name: 'B', launch_year: 2027, grade: 'BP' },
        { name: 'C', launch_year: 2028, grade: 'B' },
        { name: 'D', launch_year: 2029, grade: 'A' },
        { name: 'E', launch_year: 2030, grade: 'BP' },
        { name: 'F', launch_year: null, grade: 'BP' },
      ]);

      expect(calendar['2026']).toEqual({ total: 1, office: 1, park: 0, commercial: 0 });
      expect(calendar['2027']).toEqual({ total: 1, office: 0, park: 1, commercial: 0 });
      expect(calendar['2028']).toEqual({ total: 1, office: 1, park: 0, commercial: 0 });
      expect(calendar['2029AndAfter']).toEqual({ total: 2, office: 1, park: 1, commercial: 0 });
      expect(calendar.noDate).toEqual({ total: 1, office: 0, park: 1, commercial: 0 });
    });
  });
  describe('filterFutureSupplies', () => {
    it('finds a renamed supply by its old name without changing its ID or bypassing visibility filters', () => {
      const supply = { id: 'retained-id', name: '新供应名称', former_names: ['原供应名称'], district: '朝阳区', submarket: 'CBD', grade: 'A', launch_year: 2027 };
      const state = createDefaultFilterState();
      for (const keyword of ['新供应名称', '原供应名称']) {
        expect(filterFutureSupplies([supply], state, keyword).map(f => f.id)).toEqual(['retained-id']);
      }
      state.futureSupplyGrades = ['BP'];
      expect(filterFutureSupplies([supply], state, '原供应名称')).toEqual([]);
    });
    it('applies canonical location, keyword, grade, year and subway-distance constraints together', () => {
      const state = createDefaultFilterState();
      state.districts = ['朝阳区'];
      state.submarkets = ['望京-酒仙桥'];
      state.futureSupplyGrades = ['A'];
      state.futureSupplyYears = ['2027'];
      state.subwayStation = { center: [116.48, 39.99] };
      state.subwayDistance = 1000;

      const supplies = [
        { id: 'match', name: '华润未来中心', owner: '华润置地', district: '朝阳区', submarket: '望京酒仙桥', grade: 'A ', launch_year: 2027, location_lng: 116.48, location_lat: 39.99 },
        { id: 'far', name: '华润远端', owner: '华润置地', district: '朝阳区', submarket: '望京酒仙桥', grade: 'A', launch_year: 2027, location_lng: 116.60, location_lat: 40.10 },
        { id: 'wrong-grade', name: '华润园区', owner: '华润置地', district: '朝阳区', submarket: '望京酒仙桥', grade: 'BP', launch_year: 2027, location_lng: 116.48, location_lat: 39.99 },
      ];

      const result = filterFutureSupplies(
        supplies,
        state,
        '华润',
        ([lng]) => (lng > 116.5 ? 5000 : 200),
      );

      expect(result.map(item => item.id)).toEqual(['match']);
    });
  });

});
