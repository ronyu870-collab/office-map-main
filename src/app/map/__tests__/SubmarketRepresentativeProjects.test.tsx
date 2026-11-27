import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MarketBuilding, MarketMetric } from '../model/marketStatistics';
import { selectRepresentativeProjects, SubmarketRepresentativeProjects } from '../components/SubmarketRepresentativeProjects';

const { loadPhoto } = vi.hoisted(() => ({ loadPhoto: vi.fn() }));
vi.mock('@/src/services/buildingPhotosClient', () => ({ loadStoredBuildingPhoto: loadPhoto }));
vi.mock('@/src/utils/businessReadingAudit', () => ({ observeBusinessReading: vi.fn() }));

const metric = (area: number, rent: number, more: Partial<MarketMetric> = {}): MarketMetric => ({
  record_year: 2026, record_quarter: 2, is_locked: true, total_area: area, net_effective_rent: rent, ...more,
});
const building = (id: string, grade: string, metrics: MarketMetric[], extra: Partial<MarketBuilding> = {}): MarketBuilding => ({
  id, name: id, grade, metrics, submarket: '望京—酒仙桥', location_lng: 116.4, location_lat: 39.9, ...extra,
});

const visible = [
  building('规模项目', 'P', [metric(90_000, 440)]),
  building('中部租金', 'A', [metric(24_000, 300), metric(24_000, 800, { record_quarter: 3, is_draft: true })]),
  building('最低租金', 'A', [metric(12_000, 10)]),
  building('较早季度', 'A', [metric(10_000, 60, { record_quarter: 1 })]),
  building('乙级项目', 'B', [metric(18_000, 80)]),
  building('产业园', 'BP', [metric(900_000, 999)]),
  building('异地项目', 'A', [metric(100_000, 999)], { submarket: 'CBD' }),
  building('错误坐标', 'A', [metric(900_000, 999)], { location_lng: 116.4, location_lat: 100 }),
];

describe('SubmarketRepresentativeProjects', () => {
  it('preserves comparable quarterly product coverage including industrial parks and projects without valid coordinates', () => {
    const examples = selectRepresentativeProjects([...visible, visible[1]], ' 望京/酒仙桥 ');
    expect(examples.find(({ role }) => role === '甲级租金参照')?.detailReason).toContain('中位数 370 元/㎡/月');
    expect(examples.some(({ project }) => project.id === '产业园')).toBe(true);
    expect(examples.some(({ project }) => project.id === '乙级项目')).toBe(true);
    expect(examples.some(({ project }) => project.id === '异地项目')).toBe(false);
    expect(new Set(examples.map(({ project }) => project.id)).size).toBe(examples.length);
    expect(selectRepresentativeProjects([visible[7]], '望京-酒仙桥')[0].project.id).toBe('错误坐标');
  });

  it('uses official eligible rent samples for reference, not zero or drafts', () => {
    const buildings = [0, 100, 200].map(rent => building(`项目 ${rent}`, 'A', [metric(1000, rent)]));
    expect(selectRepresentativeProjects(buildings, '望京-酒仙桥').some(({ role }) => role.includes('租金参照'))).toBe(false);
    const draft = building('仅草稿', 'A', [metric(30_000, 0, { is_draft: true })]);
    expect(selectRepresentativeProjects([draft], '望京-酒仙桥')[0].reason).toContain('暂无已发布季度记录');
    expect(selectRepresentativeProjects([visible[5], visible[6], visible[7]], '望京-酒仙桥').map(({ project }) => project.id)).toEqual(['错误坐标','产业园']);
  });

  it('shows comparable genuine values in compact and detail modes and supplements curated projects', () => {
    const props = { submarket: '望京-酒仙桥', onOpen: vi.fn(), buildings: [
      building('指定项目', 'A', [metric(24_000, 900, { record_quarter: 1 }), metric(24_000, 300, { vacant_area: 2400 }), metric(24_000, 800, { record_quarter: 3, is_draft: true })]),
      building('乙级项目', 'B', [metric(18_000, 0, { vacancy_rate: 0 })]),
      building('园区项目', 'BP', [metric(90_000, 440, { vacancy_rate: '0.1234' })]),
    ] };
    const { rerender } = render(<SubmarketRepresentativeProjects {...props} compact />);
    expect(screen.getByText('2026Q2 · 净有效租金 300 元/㎡/月 · 空置率 10%')).toBeTruthy();
    expect(screen.getByText('2026Q2 · 净有效租金 0 元/㎡/月 · 空置率 0%')).toBeTruthy();
    expect(screen.getByText('2026Q2 · 净有效租金 440 元/㎡/月 · 空置率 12.34%')).toBeTruthy();
    expect(screen.queryByText(/净有效租金 800/)).toBeNull();
    expect(screen.queryByRole('button', { name: /市场深度分析/ })).toBeNull();
    rerender(<SubmarketRepresentativeProjects {...props} />);
    expect(screen.getByRole('button', { name: /市场深度分析/ })).toBeTruthy();
    const curated = [{ ...selectRepresentativeProjects(props.buildings, props.submarket)[0], role: '研究指定' }];
    const supplemented = selectRepresentativeProjects(props.buildings, props.submarket, curated);
    expect(supplemented[0].role).toBe('研究指定');
    expect(supplemented.map(({ project }) => project.id)).toEqual(['指定项目', '乙级项目', '园区项目']);
  });

  it('opens real projects by ID and loads only authorized photo metadata when visible', async () => {
    const photoId = '11111111-1111-1111-1111-111111111111';
    const withPhoto = { ...visible[0], photos: [{ id: photoId, caption: '大楼外立面' }] };
    const other = { ...visible[4], photos: [{ id: 'placeholder', caption: '假图' }] };
    const onOpen = vi.fn();
    loadPhoto.mockImplementation(() => new Promise(() => {}));
    render(<SubmarketRepresentativeProjects buildings={[withPhoto, other]} submarket="望京-酒仙桥" onOpen={onOpen} compact />);
    fireEvent.click(screen.getByRole('button', { name: '规模项目' }));
    expect(onOpen).toHaveBeenCalledWith('规模项目');
    await waitFor(() => expect(loadPhoto).toHaveBeenCalledWith('规模项目', photoId, expect.any(AbortSignal), 'preview', expect.anything()));
    expect(screen.getAllByRole('button', { name: '收起图片' })).toHaveLength(1);
    expect(loadPhoto).toHaveBeenCalledTimes(1);
  });
});
