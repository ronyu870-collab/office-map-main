import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { WorkspaceBuildingDetail } from '../components/WorkspaceBuildingDetail';
import type { WorkspaceBuildingDetail as Detail } from '../workspace/buildingDetail';
import { MapReadingContext } from '../workspace/continuity';

const base: Detail = { building: { id: 'stock-a', name: '甲楼', _dataType: 'existing', submarket: 'CBD', location_lng: null, location_lat: null, metrics: [], owner: '业主' }, metric: null, photos: [], canEdit: false, isDemo: false, overrides: {} };
const actions = () => ({ onClose: vi.fn(), onAction: vi.fn(), onDisposeTrend: vi.fn() });
it('keeps the photo trigger bound after a same-project parent render', () => {
  const detail = { ...base, canEdit: true, photos: [{ id: 'b04ed43e-bf3a-4d63-919e-c44d60d4fe75', caption: '楼宇外观' }] };
  const callbacks = actions();
  const view = render(<WorkspaceBuildingDetail detail={detail} {...callbacks} />);
  view.rerender(<WorkspaceBuildingDetail detail={{ ...detail }} {...callbacks} />);
  const trigger = screen.getByRole('button', { name: /看图/ });
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(view.container.querySelector('[data-building-photo-gallery]')).not.toHaveAttribute('hidden');
  expect(screen.getByText('正在加载图片…')).toBeVisible();
});
it('preserves missing metrics as unknown and offers readable details without a false location', () => {
  const callbacks = actions();
  render(<WorkspaceBuildingDetail detail={base} {...callbacks} />);
  expect(screen.getByRole('status')).toHaveTextContent('未提供有效坐标');
  expect(screen.getAllByText('未提供').length).toBeGreaterThanOrEqual(3);
  fireEvent.click(screen.getByRole('tab', { name: '行情' }));
  expect(screen.getByRole('button', { name: '周边项目对比' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: '编辑指标' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '季度趋势' }));
  expect(callbacks.onAction).toHaveBeenCalledWith('trend', expect.objectContaining({ onChange: expect.any(Function) }));
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
  fireEvent.click(screen.getByRole('tab', { name: '项目资料' }));
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
  expect(change).toHaveBeenLastCalledWith({ tab: 'market', scrollTop: 0, scrolls: { materials: 90 } });
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

it('lets the reader reveal the complete long project name and resets expansion for another project', () => {
  const title = '中关村项目及楼座信息'.repeat(6);
  const callbacks = actions();
  const { rerender } = render(<WorkspaceBuildingDetail detail={{ ...base, building: { ...base.building, name: title } }} {...callbacks} />);
  const toggle = screen.getByRole('button', { name: title });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('heading', { name: title })).toBeVisible();
  const next = title + '第二项目';
  rerender(<WorkspaceBuildingDetail detail={{ ...base, building: { ...base.building, name: next } }} {...callbacks} />);
  expect(screen.getByRole('button', { name: next })).toHaveAttribute('aria-expanded', 'false');
});

it('restores each detail tab scroll independently and reopens a saved trend once', () => {
  const callbacks = actions();
  const change = vi.fn();
  const { container } = render(<WorkspaceBuildingDetail detail={base} {...callbacks} readingState={{ tab: 'market', scrollTop: 80, scrolls: { market: 80, overview: 140 }, trendOpen: true }} onReadingChange={change} />);
  expect(callbacks.onAction).toHaveBeenCalledExactlyOnceWith('trend', expect.objectContaining({ onChange: expect.any(Function) }));
  const scroll = container.querySelector('.workspace-scroll') as HTMLElement;
  expect(scroll.scrollTop).toBe(80);
  fireEvent.click(screen.getByRole('tab', { name: '概览' }));
  expect(scroll.scrollTop).toBe(140);
  scroll.scrollTop = 190; fireEvent.scroll(scroll);
  fireEvent.click(screen.getByRole('tab', { name: '行情' }));
  expect(scroll.scrollTop).toBe(80);
  expect(callbacks.onAction).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('tab', { name: '概览' }));
  expect(scroll.scrollTop).toBe(190);
});

it('does not replay a manually opened trend when a pane resize refreshes reading props', () => {
  const callbacks = actions(); const reading = { tab: 'market', scrollTop: 0, trendOpen: false };
  const view = render(<WorkspaceBuildingDetail detail={base} {...callbacks} readingState={reading} />);
  fireEvent.click(screen.getByRole('button', { name: '季度趋势' }));
  view.rerender(<WorkspaceBuildingDetail detail={base} {...callbacks} readingState={{ ...reading, trendOpen: true }} onAction={callbacks.onAction} />);
  expect(callbacks.onAction).toHaveBeenCalledExactlyOnceWith('trend', expect.objectContaining({ onChange: expect.any(Function) }));
});


it('keeps an excluded project readable while identifying its relation to the filter', () => {
  render(<WorkspaceBuildingDetail detail={base} {...actions()} outsideResults />);
  expect(screen.getByRole('region', { name: '甲楼楼宇详情' })).toBeVisible();
  expect(screen.getByText('当前项目不在筛选结果中，已保留详情供继续查阅。')).toHaveAttribute('role', 'status');
});

it('keeps future planning separate from stock market metrics and explains unavailable materials', () => {
  const future: Detail = {...base,building:{...base.building,id:'pending-row',_dataType:'future',status:'pending',total_area:80000},canEdit:true};
  render(<WorkspaceBuildingDetail detail={future} {...actions()} readingState={{tab:'market',scrollTop:300}} />);
  expect(screen.queryByRole('tab',{name:'行情'})).not.toBeInTheDocument();
  expect(screen.getByRole('tab',{name:'概览'})).toHaveAttribute('aria-selected','true');
  expect(screen.queryByText('净有效租金')).not.toBeInTheDocument();
  expect(screen.getByText('预计总体量')).toBeVisible();
  fireEvent.keyDown(screen.getByRole('tab',{name:'概览'}),{key:'ArrowLeft'});
  expect(screen.getByRole('tab',{name:'项目资料'})).toHaveFocus();
  expect(screen.getByRole('tab',{name:'项目资料'})).toHaveAttribute('aria-selected','true');
  expect(screen.queryByRole('button',{name:'编辑指标'})).not.toBeInTheDocument();
  expect(screen.getByText('待核实项目暂无关联原件')).toBeVisible();
  fireEvent.keyDown(screen.getByRole('tab',{name:'项目资料'}),{key:'ArrowRight'});
  expect(screen.getByRole('tab',{name:'概览'})).toHaveFocus();
  expect(screen.getByRole('tab',{name:'概览'})).toHaveAttribute('aria-selected','true');
});

it('passes saved trend context to the runtime and retains further changes for route return', () => {
  const callbacks=actions(),change=vi.fn();
  render(<WorkspaceBuildingDetail detail={base} {...callbacks} readingState={{tab:'market',scrollTop:80,trendOpen:true,trend:{metric:'vac',tableOpen:true}}} onReadingChange={change} />);
  const options=callbacks.onAction.mock.calls[0][1];
  expect(options.value).toEqual({metric:'vac',tableOpen:true});
  act(()=>options.onChange({metric:'rent',tableOpen:false}));
  expect(change).toHaveBeenLastCalledWith(expect.objectContaining({trend:{metric:'rent',tableOpen:false}}));
  fireEvent.click(screen.getByRole('tab',{name:'成交与资料'}));
  expect(change).toHaveBeenLastCalledWith(expect.objectContaining({trend:{metric:'rent',tableOpen:false},trendOpen:true,tab:'materials'}));
});

it('reserves restored trend geometry and applies tab reading after the new content layout', () => {
  const callbacks=actions();
  const {container}=render(<WorkspaceBuildingDetail detail={base} {...callbacks} readingState={{tab:'materials',scrollTop:0,scrolls:{market:200},trendOpen:true,trendHeight:640,trend:{metric:'vac',tableOpen:true}}} />);
  const scroller=container.querySelector('.workspace-scroll')!;
  let position=0;
  Object.defineProperty(scroller,'scrollTop',{configurable:true,get:()=>position,set:(value:number)=>{position=screen.getByRole('tab',{name:'行情'}).getAttribute('aria-selected')==='true'?value:0;}});
  fireEvent.click(screen.getByRole('tab',{name:'行情'}));
  expect(scroller.scrollTop).toBe(200);
  const host=document.getElementById('info-chart-panel')!.parentElement!;
  expect(host).toHaveStyle({minHeight:'640px'});
  expect(host).toHaveAttribute('aria-busy','true');
  act(()=>callbacks.onAction.mock.lastCall![1].onReady());
  expect(host.style.minHeight).toBe('');
  expect(host).not.toHaveAttribute('aria-busy');
});
