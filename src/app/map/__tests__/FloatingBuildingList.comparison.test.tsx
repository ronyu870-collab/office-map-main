import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SearchBar } from '@/src/components/SearchBar';
import FloatingBuildingList from '../components/FloatingBuildingList';

const exports = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('../components/buildingComparisonExport', () => ({
  downloadBuildingComparisonPng: exports.download,
}));
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
vi.mock('../components/BuildingBasicCard', () => ({
  BuildingBasicCard: ({ building }: { building: { name: string } }) => <div>{building.name}资料卡片</div>,
}));

const ALL = Array.from({ length: 60 }, (_, index) => ({
  id: 'b' + index, name: '项目' + String(index).padStart(2, '0'), district: '朝阳区',
  _dataType: 'existing', metrics: [],
}));

function Fixture() {
  const [term, setTerm] = React.useState('');
  const [selected, setSelected] = React.useState<typeof ALL>([]);
  const filtered = ALL.filter(building => building.name.includes(term));
  const changeSelection = (buildings: typeof ALL, checked: boolean) => {
    setSelected(previous => {
      const next = new Map(previous.map(building => [building.id, building]));
      for (const building of buildings) {
        if (checked) next.set(building.id, building);
        else next.delete(building.id);
      }
      return Array.from(next.values());
    });
  };
  return (
    <>
      <SearchBar inputLabel="搜索地图项目" debounceMs={0} value={term} onChange={setTerm} onSearch={vi.fn()} />
      <FloatingBuildingList buildings={filtered} onClose={vi.fn()}
        selectedComparisonBuildings={selected} onComparisonSelectionChange={changeSelection} />
    </>
  );
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  exports.download.mockReset();
  exports.download.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('floating map building list comparison', () => {
  it('keeps the map search input focused through list result updates and Chinese composition', () => {
    render(<Fixture />);
    const search = screen.getByRole('searchbox', { name: '搜索地图项目' }) as HTMLInputElement;
    search.focus();
    fireEvent.change(search, { target: { value: '项' } });
    expect(document.activeElement).toBe(search);
    search.setSelectionRange(1, 1);
    fireEvent.change(search, { target: { value: '项目' } });
    expect(search.selectionStart).toBe(1);
    expect(document.activeElement).toBe(search);
    fireEvent.compositionStart(search);
    fireEvent.change(search, { target: { value: '项目0' } });
    fireEvent.compositionEnd(search, { data: '0' });
    expect(document.activeElement).toBe(search);
    expect(search.value).toBe('项目0');
    expect(screen.getAllByRole('checkbox')).toHaveLength(0);
  });

  it('keeps selected buildings while switching list modes and filtering without losing unchecked rows', () => {
    render(<Fixture />);
    fireEvent.click(screen.getByRole('button', { name: '选择项目' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择项目00' }));
    expect(screen.getByText('已选 1 栋')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    expect(screen.getByRole('checkbox', { name: '选择项目00' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '全选当前结果' }));
    expect(screen.getByText('已选 60 栋')).toBeInTheDocument();
    const search = screen.getByRole('searchbox', { name: '搜索地图项目' });
    fireEvent.change(search, { target: { value: '项目59' } });
    expect(screen.getByText('已选 60 栋')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '选择项目59' })).toBeChecked();
  });

  it('downloads only chosen buildings with the user-selected B layout', async () => {
    render(<Fixture />);
    fireEvent.click(screen.getByRole('button', { name: '选择项目' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择项目00' }));
    fireEvent.click(screen.getByRole('button', { name: '导出对比图 PNG' }));
    fireEvent.click(screen.getByRole('button', { name: 'B · 每栋楼一列' }));
    fireEvent.click(screen.getByRole('button', { name: '下载 PNG' }));
    await waitFor(() => expect(exports.download).toHaveBeenCalledWith([ALL[0]], 'columns', undefined));
  });
});
