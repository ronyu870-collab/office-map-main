import * as React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BuildingWithMetrics } from '@/src/types';
import { MapController } from '@/src/services/MapController';
import { FullBuildingList, type ListDisplayOverrides } from '../components/FullBuildingList';
import type { FullListBuilding } from '../model/fullBuildingList';

vi.mock('@/src/services/Auth', () => ({ getSessionFast: async () => null }));
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }));
afterEach(cleanup);

function renderPair(grade: string, type: 'existing' | 'future', override?: string) {
  const row = { id: 'grade-contract', name: '等级契约楼宇', grade, district: '朝阳区', submarket: 'CBD', city: '北京', location_lng: 116.46, location_lat: 39.91, completion_year: '', leed_certification: '', metrics: [], _dataType: type, launch_year: 2028, launch_quarter: 'Q1', total_area: 50000 };
  const controller = new MapController();
  let content: HTMLElement | null = null;
  const overrides: ListDisplayOverrides = override === undefined ? new Map() : new Map([[row.id, new Map([['grade', { display_label: '楼宇等级', display_value: override }]])]]);
  Object.assign(controller, {
    map: {}, _allBuildingsCache: [row as BuildingWithMetrics], _displayOverridesCache: overrides,
    AMap: {
      Pixel: class {},
      InfoWindow: class {
        constructor(options: { content: HTMLElement | string }) { content = typeof options.content === 'string' ? Object.assign(document.createElement('div'), { innerHTML: options.content }) : options.content; }
        on() {} open() {} close() {}
      },
    },
  });
  const select = (building: FullListBuilding) => {
    if (type === 'future') controller.openFutureSupplyInfoWindow(building);
    else controller.openBuildingInfoWindow(building.id);
  };
  render(<FullBuildingList active buildings={[row]} queryKey="grade-contract" activeFilterChips={[]} compareGroupCount={0} requirementContext={false} competitorContext={false} onRemoveFilterChip={vi.fn()} keyword="" loading={false} error={null} filtersOpen={false} displayOverrides={overrides} targetBuildingId={null} onBack={vi.fn()} onToggleFilters={vi.fn()} onKeywordChange={vi.fn()} onSearch={vi.fn()} onResetFilters={vi.fn()} onRetry={vi.fn()} onBuildingClick={select} />);
  const button = screen.getByRole('button', { name: row.name });
  const listGrades = Array.from(button.nextElementSibling?.children ?? []).map(node => node.textContent);
  fireEvent.click(button);
  if (!content) throw new Error('Original InfoWindow entry did not produce content');
  const label = within(content as HTMLElement).getByText(/^楼宇等级：?$/);
  return { row, listGrades, detailGrade: label.nextElementSibling?.textContent };
}

describe('full list uses the existing detail grade display contract', () => {
  it.each([
    ['existing', 'P', 'A'], ['existing', 'BP', 'BP'],
    ['future', 'P', 'A'], ['future', 'BP', 'BP'],
    ['existing', ' p ', 'A'], ['existing', '', '—'],
  ] as const)('%s grade %s matches the real original detail output %s', (type, grade, expected) => {
    const pair = renderPair(grade, type);
    expect(pair.detailGrade).toBe(expected);
    expect(pair.listGrades).toContain(pair.detailGrade);
    expect(pair.row.grade).toBe(grade);
  });

  it('preserves an explicit display override without reclassifying source data', () => {
    const pair = renderPair('P', 'existing', 'P（来源确认）');
    expect(pair.detailGrade).toBe('P（来源确认）');
    expect(pair.listGrades).toContain(pair.detailGrade);
    expect(pair.row.grade).toBe('P');
  });
});
