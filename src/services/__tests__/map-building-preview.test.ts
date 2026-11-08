import { fireEvent, waitFor, within } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapController } from '../MapController';

const mocks = vi.hoisted(() => ({ loadPhoto: vi.fn(), loadStoredPhoto: vi.fn(), from: vi.fn() }));
vi.mock('../salesMaterialsClient', () => ({ loadBuildingPhoto: mocks.loadPhoto }));
vi.mock('../buildingPhotosClient', () => ({ loadStoredBuildingPhoto: mocks.loadStoredPhoto }));
vi.mock('../supabaseClient', () => ({ supabase: { from: mocks.from } }));
vi.mock('../buildingIdentity', () => ({ resolveBuildingId: async (_client: unknown, id: string) => id }));
vi.mock('../Auth', () => ({ getSessionFast: async () => null }));

const existing = { id: '59f20a3a-4fc8-40d2-8270-f6a5c9784bee', name: '裕阜商务中心', location_lng: 116.29, location_lat: 39.92, metrics: [] };
const future = { ...existing, building_id: 'b99a801e-5dfd-4849-8aef-c55de594a48f', name: '玉渊潭640地块商业项目', type: '商业' };
const coverUrl = 'https://assets.example.invalid/cover.webp';
const interiorUrl = 'https://assets.example.invalid/interior.webp';

function createMap() {
  let closeCurrent = () => {};
  class InfoWindow {
    private closeListener = () => {};
    constructor(private options: { content: HTMLElement }) {}
    on(event: string, listener: () => void) {
      if (event === 'close') this.closeListener = listener;
    }
    open() {
      closeCurrent();
      closeCurrent = () => this.close();
      document.body.append(this.options.content);
    }
    close() {
      this.options.content.remove();
      this.closeListener();
    }
  }
  const controller = new MapController();
  Object.assign(controller, {
    map: {}, _allBuildingsCache: [existing],
    AMap: { InfoWindow, Pixel: class {} },
  });
  return { controller, close: () => closeCurrent() };
}

function preview() {
  const trigger = document.querySelector<HTMLButtonElement>('[data-building-photo-trigger]');
  const images = Array.from(document.querySelectorAll<HTMLImageElement>('[data-building-photo]'));
  if (!trigger || !images.length) throw new Error('看图入口未显示');
  return { trigger, image: images[0], images };
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_MAP_BUILDING_MEDIA_PILOT', '1');
  mocks.loadPhoto.mockReset().mockResolvedValue(coverUrl);
  mocks.loadStoredPhoto.mockReset().mockResolvedValue({ url: coverUrl, source_url: 'https://www.example.com/building', source_name: '项目官网' });
  mocks.from.mockReset();
});

it('keeps the legacy fallback F marker a round green badge with dashed border', () => {
  const controller = new MapController();
  const points = new Set<unknown>();
  const map = {
    add: (markers: unknown[]) => markers.forEach(marker => points.add(marker)),
    remove: (markers: unknown[]) => markers.forEach(marker => points.delete(marker)),
  };
  class Marker {
    readonly content: string;
    constructor(options: { content: string }) { this.content = options.content; }
    on() {}
  }
  Object.assign(controller, { map, AMap: { Marker, Pixel: class {} } });
  controller.renderFutureMarkers([future]);
  expect(points.size).toBe(1);
  const marker = Array.from(points)[0] as Marker;
  const host = document.createElement('div');
  host.innerHTML = marker.content;
  const badge = host.querySelector<HTMLElement>('.map-future-supply-marker');
  expect(badge).not.toBeNull();
  expect(badge?.textContent?.trim()).toBe('F');
  expect(badge?.style.width).toBe('26px');
  expect(badge?.style.height).toBe('26px');
  expect(badge?.style.borderRadius).toBe('50%');
  expect(badge?.style.borderTopStyle).toBe('dashed');
  expect(badge?.style.backgroundColor).toBe('rgb(16, 185, 129)');
  fireEvent.mouseOver(badge!);
  fireEvent.mouseOut(badge!);
  expect(badge?.style.borderRadius).toBe('50%');
  controller.clearFutureMarkers();
  expect(points.size).toBe(0);
});

it('shows a pending project area and omits an empty remarks row', () => {
  const { controller, close } = createMap();
  controller.openFutureSupplyInfoWindow({ ...future, status: 'pending', total_area: 63000, notes: ' ' });
  try {
    expect(document.body).toHaveTextContent('63,000 ㎡');
    expect(document.body).not.toHaveTextContent('备注');
  } finally { close(); }
});

describe('通用楼宇图片', () => {
  const photo = { id: '22222222-2222-4222-8222-222222222222', caption: '建筑外观' };
  const collected = { ...existing, id: '11111111-1111-4111-8111-111111111111', name: '普通楼宇', photos: [photo] };

  it.each(['existing', 'future'] as const)('opens a collected %s photo without the pilot flag and preserves its source', async kind => {
    vi.stubEnv('NEXT_PUBLIC_MAP_BUILDING_MEDIA_PILOT', '0');
    const { controller } = createMap();
    Object.assign(controller, { _allBuildingsCache: [collected] });
    if (kind === 'existing') controller.openBuildingInfoWindow(collected.id);
    else controller.openFutureSupplyInfoWindow({ ...collected, building_id: collected.id });
    const { trigger, image } = preview();
    expect(mocks.loadStoredPhoto).not.toHaveBeenCalled();
    expect(image).not.toHaveAttribute('src');
    fireEvent.click(trigger);
    await waitFor(() => expect(image).toHaveAttribute('src', coverUrl));
    expect(mocks.loadStoredPhoto).toHaveBeenCalledExactlyOnceWith(collected.id, photo.id, expect.any(AbortSignal));
    expect(mocks.loadPhoto).not.toHaveBeenCalled();
    const source = document.querySelector('[data-building-photo-source]');
    expect(source).toHaveAttribute('href', 'https://www.example.com/building');
    expect(source).toHaveTextContent('来源：项目官网');
    expect(source).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.load(image);
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(mocks.loadStoredPhoto).toHaveBeenCalledTimes(1);
  });

  it('escapes database captions and source names without creating event attributes or markup', async () => {
    const caption = '\" onload=\"alert(1)\"><script>bad</script>';
    mocks.loadStoredPhoto.mockResolvedValue({ url: coverUrl, source_url: 'javascript:alert(1)', source_name: '<img src=x onerror=alert(1)>' });
    const { controller } = createMap();
    Object.assign(controller, { _allBuildingsCache: [{ ...collected, photos: [{ ...photo, caption }] }] });
    controller.openBuildingInfoWindow(collected.id);
    const { trigger, image } = preview();
    expect(image).toHaveAttribute('alt', `${collected.name}：${caption}`);
    expect(image).not.toHaveAttribute('onload');
    expect(document.querySelector('script')).toBeNull();
    fireEvent.click(trigger);
    await waitFor(() => expect(image).toHaveAttribute('src', coverUrl));
    expect(document.querySelector('[data-building-photo-caption]')).toHaveTextContent(caption);
    expect(document.querySelector('[data-building-photo-source]')).not.toHaveAttribute('href');
    expect(document.querySelector('[data-building-photo-source]')).toHaveAttribute('hidden');
  });

  it('shows the photographer credit and license as safe text and a link', async () => {
    const attribution = '摄影：N509FZ / CC BY-SA 4.0 <script>bad</script>';
    mocks.loadStoredPhoto.mockResolvedValue({ url: coverUrl, source_url: 'https://commons.wikimedia.org/wiki/File:Photo.jpg', source_name: 'Wikimedia Commons', attribution_text: attribution, license_url: 'https://creativecommons.org/licenses/by-sa/4.0/' });
    const { controller } = createMap();
    Object.assign(controller, { _allBuildingsCache: [collected] });
    controller.openBuildingInfoWindow(collected.id);
    fireEvent.click(preview().trigger);
    await waitFor(() => expect(document.querySelector('[data-building-photo-attribution]')).toHaveTextContent(attribution));
    expect(document.querySelector('[data-building-photo-license]')).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0/');
    expect(document.querySelector('[data-building-photo-license]')).toHaveAttribute('rel', 'noopener noreferrer');
    expect(document.querySelector('script')).toBeNull();
  });

  it('aborts general-photo reads on close, ignores late responses and retries an image failure', async () => {
    let resolve!: (access: unknown) => void;
    mocks.loadStoredPhoto.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const { controller, close } = createMap();
    Object.assign(controller, { _allBuildingsCache: [collected] });
    controller.openBuildingInfoWindow(collected.id);
    const { trigger, image } = preview();
    fireEvent.click(trigger);
    await waitFor(() => expect(mocks.loadStoredPhoto).toHaveBeenCalledTimes(1));
    const signal = mocks.loadStoredPhoto.mock.calls[0][2] as AbortSignal;
    close();
    expect(signal.aborted).toBe(true);
    resolve({ url: coverUrl, source_url: 'https://www.example.com/building', source_name: '官网' });
    await vi.dynamicImportSettled();
    expect(image).not.toHaveAttribute('src');
    controller.openBuildingInfoWindow(collected.id);
    const reopened = preview();
    fireEvent.click(reopened.trigger);
    await waitFor(() => expect(reopened.image).toHaveAttribute('src', coverUrl));
    fireEvent.error(reopened.image);
    expect(document.querySelector('[data-building-photo-status]')).toHaveTextContent('图片加载失败');
    fireEvent.click(document.querySelector('[data-building-photo-retry]')!);
    await waitFor(() => expect(mocks.loadStoredPhoto).toHaveBeenCalledTimes(3));
  });

  it('keeps the photo summary when an ordinary metrics refresh replaces cached building data', async () => {
    const { controller } = createMap();
    Object.assign(controller, { _allBuildingsCache: [collected] });
    const chain = { select: () => chain, eq: () => chain, single: async () => ({ data: { ...existing, id: collected.id, name: collected.name, building_metrics: [] }, error: null }) };
    mocks.from.mockReturnValue(chain);
    await controller.refreshBuildingData(collected.id);
    controller.openBuildingInfoWindow(collected.id);
    expect(preview().trigger).toBeInTheDocument();
  });

  it('keeps photo-free buildings unchanged and hides photos in demo mode', () => {
    const { controller } = createMap();
    Object.assign(controller, { _allBuildingsCache: [{ ...collected, photos: [] }] });
    controller.openBuildingInfoWindow(collected.id);
    expect(document.querySelector('[data-building-photo-trigger]')).toBeNull();
    Object.assign(controller, { _allBuildingsCache: [collected], _isDemo: true });
    controller.openBuildingInfoWindow(collected.id);
    expect(document.querySelector('[data-building-photo-trigger]')).toBeNull();
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  document.body.replaceChildren();
});

describe('地图项目预览仅按需加载', () => {
  it.each(['existing', 'future'] as const)('leaves %s details idle until the user expands preview', async kind => {
    const { controller } = createMap();
    if (kind === 'existing') controller.openBuildingInfoWindow(existing.id);
    else controller.openFutureSupplyInfoWindow(future);
    await vi.dynamicImportSettled();
    expect(mocks.loadPhoto).not.toHaveBeenCalled();

    const { trigger, image } = preview();
    expect(image).not.toHaveAttribute('src');
    expect(trigger.parentElement).toHaveTextContent(kind === 'existing' ? existing.name : future.name);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    if (kind === 'existing') {
      const popup = trigger.closest<HTMLElement>('.building-popup')!;
      const actions = within(popup).getByRole('group', { name: '楼宇操作' });
      expect(within(actions).getAllByRole('button').map(button => button.textContent?.trim())).toEqual([
        '周边项目对比', '楼宇对比', '关联成交', '趋势追踪', '联系方式', '项目资料与佣金',
      ]);
      expect(within(popup).getByRole('button', { name: '关闭楼宇详情' })).toBeInTheDocument();
      expect(image.closest('.building-popup__summary')).not.toBeNull();
    }
    fireEvent.click(trigger);
    await waitFor(() => expect(image).toHaveAttribute('src', coverUrl));
    expect(mocks.loadPhoto).toHaveBeenCalledExactlyOnceWith(kind === 'existing' ? existing.id : future.building_id, 0, expect.any(AbortSignal));
    fireEvent.load(image);

    fireEvent.click(trigger);
    fireEvent.click(trigger);
    await vi.dynamicImportSettled();
    expect(mocks.loadPhoto).toHaveBeenCalledTimes(1);
  });

  it.each(['collapse', 'switch', 'close'] as const)('aborts a pending cover on %s and ignores a late response', async action => {
    const { controller, close } = createMap();
    let resolve!: (url: string) => void;
    mocks.loadPhoto.mockReturnValueOnce(new Promise<string>(done => { resolve = done; }));
    controller.openBuildingInfoWindow(existing.id);
    const { trigger, image } = preview();
    fireEvent.click(trigger);
    await waitFor(() => expect(mocks.loadPhoto).toHaveBeenCalledTimes(1));
    const signal = mocks.loadPhoto.mock.calls[0][2] as AbortSignal;
    if (action === 'collapse') fireEvent.click(trigger);
    else if (action === 'switch') controller.openFutureSupplyInfoWindow(future);
    else close();
    await waitFor(() => expect(signal.aborted).toBe(true));

    resolve(coverUrl);
    await vi.dynamicImportSettled();
    expect(image).not.toHaveAttribute('src');
    expect(mocks.loadPhoto).toHaveBeenCalledTimes(1);
  });

  it('fetches the next photo only when requested and reuses a previously displayed photo', async () => {
    mocks.loadPhoto.mockResolvedValueOnce(coverUrl).mockResolvedValueOnce(interiorUrl);
    const { controller } = createMap();
    controller.openFutureSupplyInfoWindow(future);
    const { trigger, images } = preview();
    const previous = document.querySelector<HTMLButtonElement>('[data-building-photo-prev]')!;
    const next = document.querySelector<HTMLButtonElement>('[data-building-photo-next]')!;
    fireEvent.click(trigger);
    await waitFor(() => expect(images[0]).toHaveAttribute('src', coverUrl));
    fireEvent.load(images[0]);
    expect(images[1]).not.toHaveAttribute('src');
    expect(mocks.loadPhoto).toHaveBeenCalledTimes(1);

    fireEvent.click(next);
    await waitFor(() => expect(images[1]).toHaveAttribute('src', interiorUrl));
    fireEvent.load(images[1]);
    expect(mocks.loadPhoto).toHaveBeenLastCalledWith(future.building_id, 1, expect.any(AbortSignal));
    expect(next).toHaveAttribute('aria-disabled', 'true');
    expect(document.querySelector('[data-building-photo-counter]')).toHaveTextContent('2 / 2');
    fireEvent.click(previous);
    expect(images[0]).not.toHaveAttribute('hidden');
    expect(images[1]).toHaveAttribute('hidden');
    expect(mocks.loadPhoto).toHaveBeenCalledTimes(2);
  });

  it('cancels an unfinished photo on navigation and retries only the visible photo', async () => {
    let resolveFirst!: (url: string) => void;
    mocks.loadPhoto.mockReturnValueOnce(new Promise<string>(done => { resolveFirst = done; }))
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(interiorUrl);
    const { controller } = createMap();
    controller.openFutureSupplyInfoWindow(future);
    const { trigger, images } = preview();
    fireEvent.click(trigger);
    await waitFor(() => expect(mocks.loadPhoto).toHaveBeenCalledTimes(1));
    const signal = mocks.loadPhoto.mock.calls[0][2] as AbortSignal;

    fireEvent.click(document.querySelector('[data-building-photo-next]')!);
    expect(signal.aborted).toBe(true);
    await waitFor(() => expect(document.querySelector('[data-building-photo-status]')).toHaveTextContent('图片加载失败'));
    resolveFirst(coverUrl);
    await vi.dynamicImportSettled();
    expect(images[0]).not.toHaveAttribute('src');
    fireEvent.click(document.querySelector('[data-building-photo-retry]')!);
    await waitFor(() => expect(images[1]).toHaveAttribute('src', interiorUrl));
    expect(mocks.loadPhoto.mock.calls.map(args => args[1])).toEqual([0, 1, 1]);
  });
});
