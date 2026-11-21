import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { WorkspaceBuildingDetail } from '../components/WorkspaceBuildingDetail';
import type { WorkspaceBuildingDetail as Detail } from '../workspace/buildingDetail';
import { MapReadingContext } from '../workspace/continuity';

const base: Detail = { building: { id: 'stock-a', name: '甲楼', _dataType: 'existing', submarket: 'CBD', location_lng: null, location_lat: null, metrics: [], owner: '业主' }, metric: null, photos: [], canEdit: false, isDemo: false, overrides: {} };
const actions = () => ({ onClose: vi.fn(), onAction: vi.fn(), onDisposeTrend: vi.fn() });
it('preserves missing metrics as unknown and offers readable details without a false location', () => {
  const callbacks = actions();
  render(<WorkspaceBuildingDetail detail={base} {...callbacks} />);
  expect(screen.getByRole('status')).toHaveTextContent('未提供有效坐标');
  expect(screen.getAllByText('未提供').length).toBeGreaterThanOrEqual(3);
  fireEvent.click(screen.getByRole('tab', { name: '行情' }));
  expect(screen.getByRole('button', { name: '周边项目对比' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: '编辑指标' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '季度趋势' }));
  expect(callbacks.onAction).toHaveBeenCalledWith('trend');
});
it('retains stock business bridge identities, admin editing and the dedicated Stacking page', () => {
  const callbacks = actions();
  const id = '9ee3e3ff-4845-41a1-a78f-390c11b1917a';
  const { unmount } = render(<WorkspaceBuildingDetail detail={{ ...base, building: { ...base.building, id }, canEdit: true }} {...callbacks} />);
  fireEvent.click(screen.getByRole('tab', { name: '行情' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑指标' }));
  expect(callbacks.onAction).toHaveBeenCalledWith('edit');
  expect(screen.getByRole('button', { name: '楼宇对比' })).toHaveAttribute('data-map-action', 'building-compare');
  fireEvent.click(screen.getByRole('tab', { name: '成交与资料' }));
  expect(screen.getByRole('button', { name: '关联成交' })).toHaveAttribute('data-map-action', 'related-leases');
  expect(screen.getByRole('button', { name: '销控与佣金' })).toHaveAttribute('data-building-id', id);
  expect(screen.getByRole('link', { name: 'Stacking Plan' })).toHaveAttribute('href', `/stacking-plan/${id}`);
  unmount();
  expect(callbacks.onDisposeTrend).toHaveBeenCalledOnce();
});
it('uses the linked master building for future materials and excludes stock-only actions', () => {
  render(<WorkspaceBuildingDetail detail={{ ...base, building: { ...base.building, id: 'future-row', _dataType: 'future', building_id: 'master' } }} {...actions()} />);
  fireEvent.click(screen.getByRole('tab', { name: '成交与资料' }));
  expect(screen.getByRole('button', { name: '销控与佣金' })).toHaveAttribute('data-building-id', 'master');
  expect(screen.queryByRole('button', { name: '关联成交' })).not.toBeInTheDocument();
});
it('keeps demo identity and ownership masked and removes admin-only access', () => {
  render(<WorkspaceBuildingDetail detail={{ ...base, isDemo: true, canEdit: false }} {...actions()} />);
  expect(screen.queryByText('甲楼')).not.toBeInTheDocument();
  expect(screen.queryByText('业主')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: '行情' }));
  expect(screen.queryByRole('button', { name: '编辑指标' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: '成交与资料' }));
  expect(screen.queryByRole('link', { name: 'Stacking Plan' })).not.toBeInTheDocument();
});

it('keeps an opened trend confined to the market tab and restores it on return', () => {
  render(<WorkspaceBuildingDetail detail={base} {...actions()} />);
  fireEvent.click(screen.getByRole('tab', { name: '行情' }));
  fireEvent.click(screen.getByRole('button', { name: '季度趋势' }));
  const panel = document.getElementById('info-chart-panel')!;
  // Match the imperative controller opening its stable chart element.
  panel.style.display = 'block';
  expect(panel).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: '成交与资料' }));
  expect(panel).not.toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: '行情' }));
  expect(panel).toBeVisible();
  expect(screen.getByRole('button', { name: '季度趋势' })).toHaveAttribute('aria-expanded', 'true');
});

it('restores the building reading tab and reports further reading state without changing facts', () => {
  const change = vi.fn();
  const { container } = render(<WorkspaceBuildingDetail detail={base} {...actions()} readingState={{ tab: 'materials', scrollTop: 90 }} onReadingChange={change} />);
  expect(screen.getByRole('tab', { name: '成交与资料' })).toHaveAttribute('aria-selected', 'true');
  const scroll = container.querySelector('.workspace-scroll') as HTMLElement;
  expect(scroll.scrollTop).toBe(90);
  fireEvent.click(screen.getByRole('tab', { name: '行情' }));
  expect(change).toHaveBeenLastCalledWith({ tab: 'market', scrollTop: 0 });
});

it('does not pull a changed tab back to the previous restored scroll when content resizes', () => {
  let resize!: () => void;
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
  try {
    const { container, unmount } = render(<MapReadingContext.Provider value={{}}><WorkspaceBuildingDetail detail={base} {...actions()} readingState={{ tab: 'materials', scrollTop: 90 }} /></MapReadingContext.Provider>);
    const scroll = container.querySelector('.workspace-scroll') as HTMLElement;
    expect(scroll.scrollTop).toBe(90);
    fireEvent.click(screen.getByRole('tab', { name: '行情' }));
    act(() => resize());
    expect(scroll.scrollTop).toBe(0);
    // Clicking the active tab should also preserve the current reading position.
    fireEvent.wheel(scroll); scroll.scrollTop = 45; fireEvent.scroll(scroll);
    fireEvent.click(screen.getByRole('tab', { name: '行情' }));
    act(() => resize());
    expect(scroll.scrollTop).toBe(45);
    unmount();
  } finally { vi.unstubAllGlobals(); }
});

it('shows missing text for empty and whitespace-only facts instead of blank rows', () => {
  const { container } = render(<WorkspaceBuildingDetail detail={{ ...base, building: { ...base.building,
    owner: '   ', property_management: '', leed_certification: '', completion_year: '',
  } }} {...actions()} />);
  const facts = [...container.querySelectorAll('.workspace-building-facts dd')];
  expect(facts.length).toBeGreaterThan(0);
  expect(facts.every(cell => Boolean(cell.textContent?.trim()))).toBe(true);
});
