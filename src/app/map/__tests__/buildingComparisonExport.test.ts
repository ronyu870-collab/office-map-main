import { describe, expect, it } from 'vitest';
import type { BuildingMetric } from '@/src/types';
import { buildComparisonSvg, type ComparisonBuilding } from '../components/buildingComparisonExport';

const metric = (year: number, quarter: number, rent: number | null) => ({
  is_locked: true, is_draft: false, record_year: year, record_quarter: quarter, net_effective_rent: rent,
  vacancy_rate: 0.125, total_area: 10000, face_rent: 245, management_fee: 28,
} as BuildingMetric);

const building = (id: string, name = '测试大厦'): ComparisonBuilding => ({
  id, name, district: '朝阳区', submarket: 'CBD', grade: 'A',
  completion_year: 2018, owner: '示例业主',
  metrics: [metric(2025, 4, 120), metric(2026, 2, 195)],
});

describe('map project comparison PNG source', () => {
  it('renders selected rows with each building latest period, correct percentage, and escaped names', () => {
    const a = building('a', 'A&B<中心>');
    const b = building('b', '金融街项目');
    b.metrics = [metric(2026, 1, 210)];
    const result = buildComparisonSvg([a, b], 'rows');
    expect(result.svg).toContain('A&amp;B&lt;中心&gt;');
    expect(result.svg).toContain('2026Q2');
    expect(result.svg).toContain('2026Q1');
    expect(result.svg).toContain('12.5%');
    expect(result.svg).not.toContain('2025Q4');
    expect(result.width).toBeGreaterThan(1000);
  });

  it('does not turn missing metrics into zero or a shared false quarter', () => {
    const future: ComparisonBuilding = {
      id: 'f', name: '未来供应', _dataType: 'future', district: '海淀区',
      launch_year: 2028, launch_quarter: 'Q1', total_area: 30000, metrics: [],
    };
    const missing = building('empty', '无经营数据');
    missing.metrics = [];
    const svg = buildComparisonSvg([future, missing], 'rows').svg;
    expect(svg).toContain('2028年 Q1');
    expect(svg).toContain('未投入运营');
    expect(svg).toContain('30,000');
    expect(svg).toContain('—');
  });

  it('splits more than five selected buildings into repeated side-by-side groups', () => {
    const source = Array.from({ length: 6 }, (_, i) => building(String(i), '示例楼宇' + i));
    const result = buildComparisonSvg(source, 'columns');
    expect(result.svg).toContain('第 1 / 2 组');
    expect(result.svg).toContain('第 2 / 2 组');
    expect(result.svg).toContain('表面租金');
    expect(result.svg).toContain('示例业主');
    expect(result.height).toBeGreaterThan(1100);
  });
});
