import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataDebugPanel } from '@/src/components/admin/DataDebugPanel';

const { readBuildings } = vi.hoisted(() => ({ readBuildings: vi.fn() }));

vi.mock('@/src/services/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: (columns: string) => {
        const [building, metric] = columns.replace(/\s/g, '').split('building_metrics(');
        const pick = (row: Record<string, unknown>, fields: string[]) =>
          fields.includes('*') ? row : Object.fromEntries(Object.entries(row).filter(([field]) => fields.includes(field)));
        const query = {
          eq: () => query,
          abortSignal: () => query,
          then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
            Promise.resolve(readBuildings()).then(({ data, error }) => ({
              data: data?.map((row: (typeof rows)[number]) => ({
                ...pick(row, building.split(',')),
                building_metrics: row.building_metrics.map(item => pick(item, metric.slice(0, -1).split(','))),
              })) ?? null,
              error,
            })).then(resolve, reject),
        };
        return query;
      },
    }),
  },
}));

const rows = ['Alpha Holdings', 'Alps Holdings'].map((owner, index) => ({
  id: `fixture-${index}`,
  name: `测试楼宇${index + 1}`,
  city: '上海',
  grade: 'A',
  district: '示例区',
  submarket: '示例市场',
  owner,
  location_lng: 121.4,
  location_lat: 31.2,
  building_metrics: [
    { id: 1, building_id: `fixture-${index}`, record_year: 2025, record_quarter: 4, total_area: 100, net_effective_rent: 20, vacant_area: 1 },
    { id: 2, building_id: `fixture-${index}`, record_year: 2026, record_quarter: 2, total_area: 100, net_effective_rent: 120, vacant_area: 10, management_fee: index === 0 ? 13 : 2 },
    { id: 3, building_id: `fixture-${index}`, record_year: 2026, record_quarter: 1, total_area: 100, net_effective_rent: 40, vacant_area: 2 },
  ],
}));

describe('DataDebugPanel', () => {
  beforeEach(() => readBuildings.mockReset());

  it('distinguishes a failed diagnostic read from no matches and retries the same read', async () => {
    readBuildings.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
      .mockResolvedValueOnce({ data: rows, error: null });

    render(<DataDebugPanel />);

    expect(await screen.findByText('楼宇数据加载失败')).toBeVisible();
    expect(screen.queryByText('无匹配数据，请调整筛选条件')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByText('项目数量')).toBeVisible();
    expect(screen.queryByText('楼宇数据加载失败')).toBeNull();
    expect(readBuildings).toHaveBeenCalledTimes(2);
  });

  it('retains the text filter focus and caret after matching rows refresh', async () => {
    readBuildings.mockResolvedValueOnce({ data: rows, error: null });
    render(<DataDebugPanel />);
    const total = within((await screen.findByText('项目数量')).parentElement!);
    expect(total.getByText('2')).toBeVisible();
    expect(screen.getAllByText('120.0')[0]).toBeVisible();
    expect(screen.getAllByText('10.0%')[0]).toBeVisible();
    fireEvent.click(screen.getAllByRole('button', { name: /展开贡献明细/ })[0]);
    expect(screen.getAllByText('2026Q2')).toHaveLength(2);

    fireEvent.click(screen.getByText('多重筛选'));
    fireEvent.click(screen.getByRole('button', { name: /添加筛选条件/ }));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'owner' } });
    const input = screen.getByPlaceholderText<HTMLInputElement>('模糊搜索');
    input.focus();
    fireEvent.change(input, { target: { value: 'A' } });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'Alpa' } });
    expect(screen.getByText('无匹配数据，请调整筛选条件')).toBeVisible();
    expect(input).toHaveFocus();
    input.setSelectionRange(3, 3);
    fireEvent.change(input, { target: { value: 'Alpha', selectionStart: 4, selectionEnd: 4 } });
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(4);
    expect(within(screen.getByText('项目数量').parentElement!).getByText('1')).toBeVisible();
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveFocus();
    expect(within(screen.getByText('项目数量').parentElement!).getByText('2')).toBeVisible();

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'management_fee' } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '10' } });
    expect(within(screen.getByText('项目数量').parentElement!).getByText('1')).toBeVisible();
  });
});
