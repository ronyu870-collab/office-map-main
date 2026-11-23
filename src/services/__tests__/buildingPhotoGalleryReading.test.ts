import { waitFor } from '@testing-library/dom';
import { loadStoredBuildingPhoto } from '../buildingPhotosClient';
import { afterEach, expect, it, vi } from 'vitest';
import { bindBuildingPhotoGallery, buildPhotoGallery, buildPhotoTrigger } from '../map/buildingPhotoGallery';
vi.mock('@/src/utils/businessReadingAudit', () => ({ observeBusinessReading: vi.fn() }));
vi.mock('@/src/utils/readingAuditContext', () => ({ buildingReadingContext: () => ({}) }));
vi.mock('../buildingPhotosClient', () => ({ loadStoredBuildingPhoto: vi.fn(() => new Promise(() => {})) }));
afterEach(() => { document.body.innerHTML = ''; });
it('restores the open photo and ordinal, persists navigation, and clamps a removed photo', () => {
  const photos = [{ id: 'one', caption: '外立面' }, { id: 'two', caption: '大堂' }];
  const root = document.createElement('div'); document.body.append(root);
  root.innerHTML = buildPhotoTrigger('gallery') + buildPhotoGallery('gallery', '项目', photos);
  const change = vi.fn();
  const dispose = bindBuildingPhotoGallery(root, 'project', photos, { initial: { open: true, index: 1 }, onChange: change });
  expect(root.querySelector('[data-building-photo-gallery]')).not.toHaveAttribute('hidden');
  expect(root.querySelector('[data-building-photo-caption]')).toHaveTextContent('大堂');
  (root.querySelector('[data-building-photo-prev]') as HTMLButtonElement).click();
  expect(change).toHaveBeenLastCalledWith({ open: true, index: 0 });
  (root.querySelector('[data-building-photo-trigger]') as HTMLButtonElement).click();
  expect(change).toHaveBeenLastCalledWith({ open: false, index: 0 });
  dispose?.();
  root.innerHTML = buildPhotoTrigger('gallery') + buildPhotoGallery('gallery', '项目', photos.slice(0, 1));
  const cleanup = bindBuildingPhotoGallery(root, 'project', photos.slice(0, 1), { initial: { open: true, index: 5 }, onChange: change });
  expect(root.querySelector('[data-building-photo-caption]')).toHaveTextContent('外立面');
  cleanup?.();
});
it('opens the loaded photo with an ordinary single mouse click and restores its focus on close', () => {
  const photos = [{id:'one',caption:'外立面'}];
  const root = document.createElement('div');document.body.append(root);
  root.innerHTML = buildPhotoTrigger('gallery') + buildPhotoGallery('gallery','项目',photos);
  const viewer = root.querySelector<HTMLDialogElement>('dialog')!;
  viewer.showModal = () => viewer.setAttribute('open','');
  viewer.close = () => viewer.removeAttribute('open');
  const dispose = bindBuildingPhotoGallery(root,'project',photos);
  (root.querySelector('[data-building-photo-trigger]') as HTMLButtonElement).click();
  root.querySelector('img')!.dispatchEvent(new Event('load'));
  const enlarge = root.querySelector<HTMLButtonElement>('[data-building-photo-enlarge]')!;
  enlarge.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));
  expect(viewer.open).toBe(true);
  root.querySelector('[data-building-photo-viewer-close]')!.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  expect(viewer.open).toBe(false);expect(enlarge).toHaveFocus();
  dispose?.();
});

it('releases a loaded preview and viewer, then aborts pending media when the workspace is disposed', async () => {
  const revoke = vi.fn();
  const NativeURL = URL;
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => 'blob:isolated-preview');
    static revokeObjectURL = revoke;
  });
  try {
    const loader = vi.mocked(loadStoredBuildingPhoto); loader.mockClear();
    loader.mockResolvedValueOnce({ url:'',source_url:'',source_name:'',can_download:true,is_preview:true,previewBlob:new Blob(['fixture']) });
    const photos = [{ id:'resource',caption:'外观' }];
    const root = document.createElement('div'); document.body.append(root);
    root.innerHTML = buildPhotoTrigger('resources') + buildPhotoGallery('resources','项目',photos);
    const viewer = root.querySelector<HTMLDialogElement>('dialog')!;
    viewer.showModal = () => viewer.setAttribute('open','');
    viewer.close = () => viewer.removeAttribute('open');
    const remember = vi.fn();
    const dispose = bindBuildingPhotoGallery(root,'project',photos,{onChange:remember});
    const trigger = root.querySelector<HTMLButtonElement>('[data-building-photo-trigger]')!;
    trigger.click();
    const image = root.querySelector('img')!;
    await waitFor(() => expect(image.getAttribute('src')).toBe('blob:isolated-preview'));
    image.dispatchEvent(new Event('load'));
    root.querySelector<HTMLButtonElement>('[data-building-photo-enlarge]')!.click();
    expect(viewer.open).toBe(true);
    dispose?.();
    expect(viewer.open).toBe(false); expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:isolated-preview');
    remember.mockClear(); trigger.click(); expect(remember).not.toHaveBeenCalled();
    const pending = bindBuildingPhotoGallery(root,'project',photos,{initial:{open:true,index:0},onChange:vi.fn()});
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    const signal = loader.mock.calls[1][2]; expect(signal.aborted).toBe(false);
    pending?.(); expect(signal.aborted).toBe(true);
    expect(image).not.toHaveAttribute('src');
  } finally { vi.unstubAllGlobals(); }
});
