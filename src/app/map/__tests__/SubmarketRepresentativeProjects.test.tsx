import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  it('uses mappable normalized A/B examples and only comparable official-quarter observations', () => {
    const examples = selectRepresentativeProjects([...visible, visible[1]], ' 望京/酒仙桥 ');
    expect(examples.map(({ role }) => role)).toEqual(['规模样本', '同级租金参照', '甲级样本', '乙级样本']);
    const [size, rent] = examples;
    expect(size.project.id).toBe('规模项目');
    expect(size.reason).toContain('90,000 ㎡');
    expect(rent.project.id).toBe('中部租金');
    expect(rent.reason).toContain('2026Q2');
    expect(rent.reason).toContain('3 个甲级样本的中位数为 300 元/㎡/月');
    expect(new Set(examples.map(({ project }) => project.id)).size).toBe(examples.length);
    expect(examples.some(({ project }) => project.id === '乙级项目')).toBe(true);
  });

  it('includes genuine zero rent in the same-quarter median', () => {
    const buildings = [0, 100, 200].map(rent => building(`项目 ${rent}`, 'A', [metric(1000, rent)]));
    const example = selectRepresentativeProjects(buildings, '望京-酒仙桥').find(({ role }) => role === '同级租金参照');
    expect(example?.project.id).toBe('项目 100');
    expect(example?.reason).toContain('3 个甲级样本的中位数为 100 元/㎡/月');
  });

  it('states insufficient evidence rather than ranking missing, draft, or incomparable values', () => {
    const draft = building('仅草稿', 'A', [metric(30_000, 0, { is_draft: true })]);
    const examples = selectRepresentativeProjects([draft, visible[3], visible[4]], '望京-酒仙桥');
    expect(examples.map(({ role }) => role)).not.toContain('同级租金参照');
    expect(selectRepresentativeProjects([draft], '望京-酒仙桥')[0].reason).toContain('暂无已发布季度记录');
    expect(selectRepresentativeProjects([visible[5], visible[6], visible[7]], '望京-酒仙桥')).toEqual([]);
  });

  it('shows only genuine latest-quarter rent and vacancy in detail cards', () => {
    const props = { submarket: '望京-酒仙桥', onOpen: vi.fn(), buildings: [
      building('规模项目', 'P', [metric(90_000, 440, { vacancy_rate: '0.1234' })]),
      building('中部租金', 'A', [
        metric(24_000, 900, { record_quarter: 1, vacancy_rate: 0.9 }),
        metric(24_000, 300, { vacant_area: 2_400, vacancy_rate: null }),
        metric(24_000, 800, { record_quarter: 3, is_draft: true, vacancy_rate: 0.8 }),
      ]),
      building('最低租金', 'A', [metric(12_000, 10, { vacancy_rate: 1.2 })]),
      building('零值项目', 'B', [metric(18_000, 0, { vacancy_rate: 0 })]),
    ] };
    const { rerender } = render(<SubmarketRepresentativeProjects {...props} />);
    expect(screen.getByText('2026Q2 · 净有效租金 440 元/㎡/月 · 空置率 12.34%')).toBeTruthy();
    expect(screen.getByText('2026Q2 · 净有效租金 10 元/㎡/月')).toBeTruthy();
    expect(screen.getByText('2026Q2 · 净有效租金 0 元/㎡/月 · 空置率 0%')).toBeTruthy();
    const medianCard = screen.getByRole('button', { name: '中部租金' }).closest('li')!;
    expect(within(medianCard).getByText('2026Q2 · 净有效租金 300 元/㎡/月')).toBeTruthy();
    expect(medianCard.textContent?.match(/净有效租金/g)).toHaveLength(1);
    expect(medianCard.textContent).not.toContain('空置率');
    rerender(<SubmarketRepresentativeProjects {...props} compact />);
    expect(screen.queryByText(/空置率|净有效租金 (440|10|0) 元/)).toBeNull();
    expect(screen.getByText(/2026Q2 净有效租金 300 元/)).toBeTruthy();
  });

  it('opens real projects by id and resolves an approved photo only when expanded in details', async () => {
    const photoId = '11111111-1111-1111-1111-111111111111';
    const withPhoto = { ...visible[0], photos: [{ id: photoId, caption: '大楼外立面' }] };
    const other = { ...visible[4], photos: [{ id: 'placeholder', caption: '假图' }] };
    const onOpen = vi.fn();
    loadPhoto.mockImplementation(() => new Promise(() => {}));
    const props = { buildings: [withPhoto, other], submarket: '望京-酒仙桥', onOpen };
    const { rerender } = render(<SubmarketRepresentativeProjects {...props} compact />);
    expect(screen.queryByRole('button', { name: /看图/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '规模项目' }));
    expect(onOpen).toHaveBeenCalledWith('规模项目');
    rerender(<SubmarketRepresentativeProjects {...props} />);
    const trigger = screen.getByRole('button', { name: /看图/ });
    expect(loadPhoto).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    await waitFor(() => expect(loadPhoto).toHaveBeenCalledWith('规模项目', photoId, expect.any(AbortSignal), 'preview', expect.anything()));
    expect(screen.getAllByRole('button', { name: /看图/ })).toHaveLength(1);
  });
});
