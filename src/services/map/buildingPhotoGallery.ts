import type { PilotPhoto } from '@/src/lib/sales-materials/building-media-pilot';
import { publicPhotoUrl, type BuildingPhotoSummary } from '@/src/lib/building-photos/model';

export type GalleryPhoto = BuildingPhotoSummary | (PilotPhoto & { pilotIndex?: number });
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const photoIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3-3a2 2 0 0 0-2.8 0L6 21"/></svg>';
const arrow = (path: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
const closeIcon = arrow('m6 6 12 12M18 6 6 18');
const downloadIcon = arrow('M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4');
const externalIcon = arrow('M13 5h6v6m0-6-9 9m7-1v6H5V7h6');

export function buildPhotoTrigger(galleryId: string): string {
  return `<button type="button" class="building-pilot-photo-trigger" data-building-photo-trigger aria-expanded="false" aria-controls="${galleryId}">
    <span>${photoIcon}看图</span>
  </button>`;
}

// The info window already escapes the building name; database captions need their own escaping.
export function buildPhotoGallery(galleryId: string, name: string, photos: readonly GalleryPhoto[]): string {
  return `<div id="${galleryId}" class="building-pilot-gallery" data-building-photo-gallery hidden>
    <figure class="building-photo-figure">
    <div class="building-pilot-photo-stage">
      ${photos.map(photo => `<img data-building-photo hidden alt="${name}：${escapeHtml(photo.caption)}" decoding="async" referrerpolicy="no-referrer">`).join('')}
      <button type="button" class="building-photo-enlarge" data-building-photo-enlarge aria-label="查看大图" title="双击查看大图" aria-haspopup="dialog" aria-controls="${galleryId}-viewer" hidden></button>
      <div class="building-pilot-photo-message">
        <span data-building-photo-status role="status"></span>
        <button type="button" class="building-pilot-photo-control" data-building-photo-retry hidden>重试</button>
      </div>
    </div>
    <figcaption>
      <div class="building-photo-caption-row">
      <span class="building-photo-description"><span data-building-photo-caption></span><a data-building-photo-source hidden target="_blank" rel="noopener noreferrer">图片来源</a></span>
      ${photos.length > 1 ? `<nav aria-label="项目图片">
        <button type="button" class="building-pilot-photo-control" data-building-photo-prev aria-label="上一张" aria-disabled="true">${arrow('m15 18-6-6 6-6')}</button>
        <span data-building-photo-counter aria-live="polite"></span>
        <button type="button" class="building-pilot-photo-control" data-building-photo-next aria-label="下一张">${arrow('m9 18 6-6-6-6')}</button>
      </nav>` : ''}
      </div>
      <span class="building-photo-attribution"><span data-building-photo-attribution></span><a data-building-photo-license hidden target="_blank" rel="noopener noreferrer">许可</a></span>
    </figcaption>
    </figure>
    <dialog id="${galleryId}-viewer" class="building-photo-viewer" aria-labelledby="${galleryId}-viewer-title">
      <div class="building-photo-viewer__content">
        <header class="building-photo-viewer__header">
          <h2 id="${galleryId}-viewer-title">${name}</h2>
          <div class="building-photo-viewer__actions">
            <button type="button" class="building-photo-viewer__action" data-building-photo-download hidden>${downloadIcon}<span>下载原图</span></button>
            <a class="building-photo-viewer__action" data-building-photo-original hidden target="_blank" rel="noopener noreferrer">${externalIcon}<span>打开原图</span></a>
            <button type="button" class="building-pilot-photo-control building-photo-viewer__close" data-building-photo-viewer-close aria-label="关闭大图" autofocus>${closeIcon}</button>
          </div>
        </header>
        <p class="building-photo-viewer__notice" data-building-photo-download-status role="status"></p>
      </div>
    </dialog>
  </div>`;
}

export function bindBuildingPhotoGallery(root: HTMLElement, buildingId: string, photos: readonly GalleryPhoto[]): (() => void) | null {
  const trigger = root.querySelector<HTMLButtonElement>('[data-building-photo-trigger]');
  const gallery = root.querySelector<HTMLElement>('[data-building-photo-gallery]');
  const figure = gallery?.querySelector<HTMLElement>('figure');
  const stage = figure?.querySelector<HTMLElement>('.building-pilot-photo-stage');
  const enlarge = gallery?.querySelector<HTMLButtonElement>('[data-building-photo-enlarge]');
  const viewer = gallery?.querySelector<HTMLDialogElement>('.building-photo-viewer');
  const viewerContent = viewer?.querySelector<HTMLElement>('.building-photo-viewer__content');
  const viewerClose = viewer?.querySelector<HTMLButtonElement>('[data-building-photo-viewer-close]');
  const downloadButton = viewer?.querySelector<HTMLButtonElement>('[data-building-photo-download]');
  const downloadLabel = downloadButton?.querySelector('span');
  const originalLink = viewer?.querySelector<HTMLAnchorElement>('[data-building-photo-original]');
  const downloadStatus = viewer?.querySelector<HTMLElement>('[data-building-photo-download-status]');
  const images = Array.from(gallery?.querySelectorAll<HTMLImageElement>('[data-building-photo]') ?? []);
  const status = gallery?.querySelector<HTMLElement>('[data-building-photo-status]');
  const caption = gallery?.querySelector<HTMLElement>('[data-building-photo-caption]');
  const retry = gallery?.querySelector<HTMLButtonElement>('[data-building-photo-retry]');
  const previous = gallery?.querySelector<HTMLButtonElement>('[data-building-photo-prev]');
  const next = gallery?.querySelector<HTMLButtonElement>('[data-building-photo-next]');
  const counter = gallery?.querySelector<HTMLElement>('[data-building-photo-counter]');
  const source = gallery?.querySelector<HTMLAnchorElement>('[data-building-photo-source]');
  const attribution = gallery?.querySelector<HTMLElement>('[data-building-photo-attribution]');
  const license = gallery?.querySelector<HTMLAnchorElement>('[data-building-photo-license]');
  if (!trigger || !gallery || !figure || !stage || !enlarge || !viewer || !viewerContent || !viewerClose
    || !downloadButton || !downloadLabel || !originalLink || !downloadStatus
    || !status || !caption || !retry || !images.length || images.length !== photos.length) return null;

  const listeners = new AbortController();
  const eventOptions = { signal: listeners.signal };
  const loaded = new Set<number>();
  const externalPhotos = new Map<number, string>();
  let pendingDownload: AbortController | null = null;
  const cancelDownload = () => {
    pendingDownload?.abort();
    pendingDownload = null;
    downloadButton.removeAttribute('aria-disabled');
    downloadLabel.textContent = '下载原图';
    downloadStatus.textContent = '';
  };
  const sources = new Map<number, { url: string; name: string; attribution: string; license: string }>();
  const showSource = (selected: number) => {
    if (!source) return;
    const provenance = sources.get(selected);
    source.hidden = !provenance;
    if (provenance) {
      source.href = provenance.url;
      source.textContent = provenance.name ? `来源：${provenance.name}` : '图片来源';
    } else source.removeAttribute('href');
    if (attribution) attribution.textContent = provenance?.attribution || '';
    if (license) {
      license.hidden = !provenance?.license;
      if (provenance?.license) license.href = provenance.license;
      else license.removeAttribute('href');
    }
  };
  let index = 0;
  const showViewerAction = () => {
    const ready = loaded.has(index);
    const externalUrl = externalPhotos.get(index);
    downloadButton.hidden = !ready || Boolean(externalUrl);
    originalLink.hidden = !ready || !externalUrl;
    if (ready && externalUrl) originalLink.href = externalUrl;
    else originalLink.removeAttribute('href');
  };
  let touchStart: { x: number; y: number } | null = null;
  let pending: { controller: AbortController; image: HTMLImageElement } | null = null;
  const cancel = () => {
    if (!pending) return;
    pending.controller.abort();
    pending.image.onload = pending.image.onerror = null;
    pending.image.removeAttribute('src');
    pending = null;
  };
  const fitViewer = (image: HTMLImageElement) => {
    if (image.naturalWidth && image.naturalHeight) {
      viewer.style.setProperty('--building-photo-ratio', String(image.naturalWidth / image.naturalHeight));
    }
  };

  const show = () => {
    if (gallery.hidden || !root.isConnected || pending) return;
    const selected = index;
    const image = images[selected];
    for (const item of images) item.hidden = item !== image || !loaded.has(selected);
    caption.textContent = photos[selected].caption;
    showSource(selected);
    if (counter) counter.textContent = `${selected + 1} / ${images.length}`;
    previous?.setAttribute('aria-disabled', String(selected === 0));
    next?.setAttribute('aria-disabled', String(selected === images.length - 1));
    if (document.activeElement === retry) (next ?? trigger).focus();
    retry.hidden = true;
    status.hidden = loaded.has(selected);
    enlarge.hidden = !loaded.has(selected);
    showViewerAction();
    if (loaded.has(selected)) { fitViewer(image); return; }

    const controller = new AbortController();
    pending = { controller, image };
    status.textContent = '正在加载图片…';
    const isCurrent = () => pending?.controller === controller && !controller.signal.aborted
      && !gallery.hidden && root.isConnected;
    const fail = () => {
      if (!isCurrent()) return;
      cancel();
      status.textContent = '图片加载失败';
      retry.hidden = false;
    };
    image.onload = () => {
      if (!isCurrent()) return;
      pending = null;
      image.onload = image.onerror = null;
      loaded.add(selected);
      fitViewer(image);
      status.hidden = true;
      image.hidden = false;
      enlarge.hidden = false;
      showViewerAction();
    };
    image.onerror = fail;
    const photo = photos[selected];
    if ('id' in photo) {
      void import('../buildingPhotosClient').then(async ({ loadStoredBuildingPhoto }) => {
        if (!isCurrent()) return;
        const access = await loadStoredBuildingPhoto(buildingId, photo.id, controller.signal);
        if (!isCurrent()) return;
        const sourceUrl = publicPhotoUrl(access.source_url, true);
        const licenseUrl = publicPhotoUrl(access.license_url);
        // Keep attribution visible for licensed photos; other photos show the caption alone.
        if (sourceUrl && licenseUrl) sources.set(selected, {
          url: sourceUrl, name: access.source_name, attribution: access.attribution_text || '',
          license: licenseUrl,
        });
        if (access.can_download === false) {
          const originalUrl = publicPhotoUrl(access.url);
          if (originalUrl) externalPhotos.set(selected, originalUrl);
        }
        showSource(selected);
        if (access.is_preview) image.onerror = () => {
          if (!isCurrent()) return;
          // Signing can succeed even when the storage renderer rejects the image.
          // Retry the same scoped photo once as an original, under the same cancellation guard.
          image.onerror = fail;
          void loadStoredBuildingPhoto(buildingId, photo.id, controller.signal, 'original').then(original => {
            if (isCurrent()) image.src = original.url;
          }).catch(fail);
        };
        image.src = access.url;
      }).catch(fail);
    } else {
      void import('../salesMaterialsClient').then(({ loadBuildingPhoto }) => {
        if (!isCurrent()) return;
        return loadBuildingPhoto(buildingId, photo.pilotIndex ?? selected, controller.signal).then(url => {
          if (isCurrent()) image.src = url;
        });
      }).catch(fail);
    }
  };

  const closeViewer = (returnFocus = true) => {
    if (!viewer.open) return;
    touchStart = null;
    cancelDownload();
    gallery.insertBefore(figure, viewer);
    gallery.style.minHeight = '';
    viewer.close();
    if (returnFocus && root.isConnected) {
      (enlarge.hidden ? (!retry.hidden ? retry : (next ?? trigger)) : enlarge).focus();
    }
  };
  const close = () => {
    closeViewer(false);
    gallery.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    cancel();
  };
  const move = (direction: number) => {
    const target = index + direction;
    if (gallery.hidden || target < 0 || target >= images.length) return;
    cancel();
    cancelDownload();
    index = target;
    show();
  };
  trigger.addEventListener('click', event => {
    event.stopPropagation();
    if (gallery.hidden) {
      gallery.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      const summary = gallery.closest('.building-popup__summary');
      if (summary) summary.scrollTop = 0;
      const trendBody = gallery.closest('[data-trend-open] .building-popup__body');
      if (trendBody) trendBody.scrollTop = 0;
      show();
    } else close();
  }, eventOptions);
  previous?.addEventListener('click', event => { event.stopPropagation(); move(-1); }, eventOptions);
  next?.addEventListener('click', event => { event.stopPropagation(); move(1); }, eventOptions);
  retry.addEventListener('click', event => { event.stopPropagation(); show(); }, eventOptions);
  const openViewer = () => {
    if (gallery.hidden || viewer.open || !loaded.has(index) || !root.isConnected) return;
    // Keep the map popup's layout and reuse the current image, caption and navigation in the top layer.
    gallery.style.minHeight = `${figure.offsetHeight}px`;
    viewerContent.insertBefore(figure, downloadStatus);
    viewer.showModal();
    viewer.scrollTop = 0;
  };
  // Some touch browsers report click as a MouseEvent. Keep the pointer type from the same tap.
  let previewPointer = '';
  enlarge.addEventListener('pointerdown', event => { previewPointer = event.pointerType; }, eventOptions);
  enlarge.addEventListener('pointercancel', () => { previewPointer = ''; }, eventOptions);
  enlarge.addEventListener('click', event => {
    event.stopPropagation();
    const pointer = ('pointerType' in event && event.pointerType) || previewPointer;
    previewPointer = '';
    if (event.detail === 0 || pointer === 'touch' || pointer === 'pen') openViewer();
  }, eventOptions);
  enlarge.addEventListener('dblclick', event => {
    event.stopPropagation();
    openViewer();
  }, eventOptions);
  downloadButton.addEventListener('click', async event => {
    event.stopPropagation();
    if (!viewer.open || downloadButton.hidden || pendingDownload || !loaded.has(index)) return;
    const selected = index;
    const photo = photos[selected];
    const controller = new AbortController();
    pendingDownload = controller;
    downloadButton.setAttribute('aria-disabled', 'true');
    downloadLabel.textContent = '正在准备…';
    downloadStatus.textContent = '';
    const isCurrent = () => pendingDownload === controller && root.isConnected && viewer.open && selected === index;
    try {
      const url = 'id' in photo
        ? await import('../buildingPhotosClient').then(async ({ loadStoredBuildingPhoto }) =>
          (await loadStoredBuildingPhoto(buildingId, photo.id, controller.signal, 'download')).url)
        : await import('../salesMaterialsClient').then(({ loadBuildingPhoto }) =>
          loadBuildingPhoto(buildingId, photo.pilotIndex ?? selected, controller.signal, true));
      if (!isCurrent()) return;
      // The freshly signed Storage URL serves an attachment without fetching the bytes into JS.
      const link = document.createElement('a');
      link.href = url;
      link.referrerPolicy = 'no-referrer';
      link.hidden = true;
      viewer.append(link);
      link.click();
      link.remove();
    } catch {
      if (isCurrent()) downloadStatus.textContent = '下载链接获取失败，请重试。';
    } finally {
      if (pendingDownload === controller) {
        pendingDownload = null;
        downloadButton.removeAttribute('aria-disabled');
        downloadLabel.textContent = '下载原图';
      }
    }
  }, eventOptions);
  viewer.addEventListener('click', event => {
    event.stopPropagation();
    if (event.target === viewer || viewerClose.contains(event.target as Node)) closeViewer();
  }, eventOptions);
  viewer.addEventListener('cancel', event => { event.preventDefault(); closeViewer(); }, eventOptions);
  stage.addEventListener('touchstart', event => {
    const point = event.touches.length === 1 && viewer.open ? event.touches[0] : null;
    touchStart = point ? { x: point.clientX, y: point.clientY } : null;
  }, { ...eventOptions, passive: true });
  stage.addEventListener('touchcancel', () => { touchStart = null; }, eventOptions);
  stage.addEventListener('touchend', event => {
    const start = touchStart;
    touchStart = null;
    const point = event.changedTouches[0];
    if (!start || !point || event.touches.length) return;
    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;
    if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
  }, { ...eventOptions, passive: true });
  gallery.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      if (viewer.open) { closeViewer(); return; }
      close();
      trigger.focus();
    } else move(event.key === 'ArrowLeft' ? -1 : 1);
  }, eventOptions);
  return () => {
    closeViewer(false);
    listeners.abort();
    cancel();
  };
}
