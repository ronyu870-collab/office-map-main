import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, within } from '@testing-library/dom';
import { MapController } from '@/src/services/MapController';
import type { BuildingWithMetrics } from '@/src/types';

vi.mock('@/src/services/Auth', () => ({ getSessionFast: async () => null }));

const owner = "正大侨商房地产开发有限公司 & <名称>";
let controller: MapController | undefined;

function openPopup(fromMarker = false) {
  let resize = () => {};
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  class InfoWindow {
    private onClose = () => {};
    constructor(private options: { content: HTMLElement }) {}
    on(_event: string, callback: () => void) { this.onClose = callback; }
    open() { document.body.append(this.options.content); }
    getContent() { return this.options.content; }
    close() { this.options.content.remove(); this.onClose(); }
  }
  class Marker {
    private handlers = new Map<string, () => void>();
    on(event: string, callback: () => void) { this.handlers.set(event, callback); }
    setExtData() {}
    click() { this.handlers.get('click')?.(); }
    hover() { (this.handlers.get('mouseover') as ((event: object) => void) | undefined)?.({ originEvent: { clientX: 400, clientY: 300 } }); }
  }
  const shown: Marker[] = [];
  const map = {
    add(markers: Marker[]) { shown.push(...markers); },
    remove() {},
    on() {},
    getZoom: () => 16,
  };
  const instance = controller = new MapController();
  const building: BuildingWithMetrics = { submarket: 'CBD', grade: 'A', city: '北京', district: '朝阳区', completion_year: '2019', leed_certification: 'Gold', id: 'building-a', name: "正大中心 A'座", owner, property_management: '物业公司', location_lng: 116.46, location_lat: 39.91, metrics: [] };
  const next = { ...building, id: 'building-b', name: '乙楼' };
  Object.assign(instance, { map, AMap: { Pixel: class {}, InfoWindow, Marker }, _allBuildingsCache: [building, next] });
  const edit = vi.fn();
  instance.setAdminMode(true, 'admin-a', edit);
  if (fromMarker) {
    instance.renderMarkers([building]);
    expect(document.querySelector('.building-popup')).toBeNull();
    expect(shown).toHaveLength(1);
    shown[0].hover();
    const markerHint = document.body.querySelector<HTMLElement>('div[style*="pointer-events: none"]');
    expect(markerHint).toHaveStyle({ opacity: '1' });
    shown[0].click();
    expect(markerHint).toHaveStyle({ opacity: '0' });
    shown[0].hover();
    expect(markerHint).toHaveStyle({ opacity: '0' });
  } else {
    instance.openBuildingInfoWindow(building.id);
  }
  const popup = document.querySelector<HTMLElement>('.building-popup');
  if (!popup) throw new Error('MapController did not mount the stock building popup');
  return { instance, building, next, edit, popup, resize: () => resize() };
}

afterEach(() => {
  controller?.destroy();
  controller = undefined;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('real stock-building popup opened by the map controller', () => {
  it('keeps the ordered actions after clicking a rendered map marker and binds edit to its building and role', () => {
    const { instance, building, next, edit, popup } = openPopup(true);
    const actions = within(within(popup).getByRole('group', { name: '楼宇操作' })).getAllByRole('button');
    expect(actions.map(button => button.textContent?.trim())).toEqual([
      '周边项目对比', '楼宇对比', '关联成交', '季度趋势', '联系方式', '销控与佣金', '楼书与资料',
    ]);
    expect(actions[5]).toHaveAttribute('data-building-id', building.id);
    expect(actions[5]).toHaveAttribute('data-building-name', building.name);
    expect(popup.querySelector('.building-popup__titlebar')?.querySelectorAll('button')).toHaveLength(1);
    const editButton = within(within(popup).getByRole('region', { name: '经营指标' })).getByRole('button', { name: '编辑指标' });
    fireEvent.click(editButton);
    expect(edit).toHaveBeenCalledWith(building.id, building.name);
    const sheet = document.createElement('div');
    sheet.setAttribute('data-building-metrics-edit', '');
    document.body.append(sheet);
    const handleSheetEscape = vi.fn();
    window.addEventListener('keydown', handleSheetEscape, { once: true });
    fireEvent.keyDown(editButton, { key: 'Escape' });
    expect(handleSheetEscape).toHaveBeenCalledOnce();
    expect(popup).toBeInTheDocument();
    sheet.remove();
    instance.setAdminMode(false, 'viewer-a', edit);
    expect(editButton).not.toBeVisible();
    fireEvent.click(editButton);
    expect(edit).toHaveBeenCalledTimes(1);
    instance.openBuildingInfoWindow(next.id);
    expect(document.body).not.toContainElement(popup);
    expect(document.querySelector('.building-popup')).toHaveAttribute('data-building-id', next.id);
    expect(document.querySelector('[data-map-action="building-sales-control"]')).toHaveAttribute('data-building-id', next.id);
  });

  it('reveals only a clipped value, restores it on Escape or tap and cleans up when the popup closes', () => {
    const { popup, resize, instance, next } = openPopup();
    const label = within(popup).getByText(owner, { selector: '.building-popup__value' });
    expect(within(popup).queryByRole('button', { name: '查看项目业主完整内容' })).toBeNull();
    Object.defineProperties(label, { clientWidth: { value: 80 }, scrollWidth: { value: 210 } });
    resize();
    const reveal = within(popup).getByRole('button', { name: '查看项目业主完整内容' });
    const mapGesture = vi.fn();
    popup.parentElement!.addEventListener('touchend', mapGesture);
    fireEvent.touchEnd(reveal);
    expect(mapGesture).not.toHaveBeenCalled();
    fireEvent.click(reveal);
    expect(within(document.body).getByRole('tooltip')).toHaveTextContent(owner);
    expect(reveal).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(reveal, { key: 'Escape' });
    expect(within(document.body).queryByRole('tooltip')).toBeNull();
    expect(popup).toBeInTheDocument();
    fireEvent.click(reveal);
    fireEvent.click(reveal);
    expect(within(document.body).queryByRole('tooltip')).toBeNull();
    fireEvent.click(reveal);
    instance.openBuildingInfoWindow(next.id);
    expect(within(document.body).queryByRole('tooltip')).toBeNull();
    const nextPopup = document.querySelector<HTMLElement>('.building-popup')!;
    fireEvent.click(within(nextPopup).getByRole('button', { name: '关闭楼宇详情' }));
    expect(nextPopup).not.toBeInTheDocument();
  });
});
