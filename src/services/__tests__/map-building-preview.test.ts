import { fireEvent, waitFor, within } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapController } from '../MapController';

const mocks = vi.hoisted(() => ({ loadPhoto: vi.fn() }));
vi.mock('../salesMaterialsClient', () => ({ loadBuildingPhoto: mocks.loadPhoto }));
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
