import type { PilotPhoto } from '@/src/lib/sales-materials/building-media-pilot';
import { publicPhotoUrl, type BuildingPhotoSummary } from '@/src/lib/building-photos/model';

export type GalleryPhoto = BuildingPhotoSummary | (PilotPhoto & { pilotIndex?: number });
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const photoIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3-3a2 2 0 0 0-2.8 0L6 21"/></svg>';
const arrow = (path: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;

export function buildPhotoTrigger(galleryId: string): string {
  return `<button type="button" class="building-pilot-photo-trigger" data-building-photo-trigger aria-expanded="false" aria-controls="${galleryId}">
    <span>${photoIcon}看图</span>
  </button>`;
}

// The info window already escapes the building name; database captions need their own escaping.
export function buildPhotoGallery(galleryId: string, name: string, photos: readonly GalleryPhoto[]): string {
  return `<figure id="${galleryId}" class="building-pilot-gallery" data-building-photo-gallery hidden>
    <div class="building-pilot-photo-stage">
      ${photos.map(photo => `<img data-building-photo hidden alt="${name}：${escapeHtml(photo.caption)}" decoding="async" referrerpolicy="no-referrer">`).join('')}
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
  </figure>`;
}

export function bindBuildingPhotoGallery(root: HTMLElement, buildingId: string, photos: readonly GalleryPhoto[]): (() => void) | null {
  const trigger = root.querySelector<HTMLButtonElement>('[data-building-photo-trigger]');
  const gallery = root.querySelector<HTMLElement>('[data-building-photo-gallery]');
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
  if (!trigger || !gallery || !status || !caption || !retry || !images.length || images.length !== photos.length) return null;

  const listeners = new AbortController();
  const eventOptions = { signal: listeners.signal };
  const loaded = new Set<number>();
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
  let pending: { controller: AbortController; image: HTMLImageElement } | null = null;
  const cancel = () => {
    if (!pending) return;
    pending.controller.abort();
    pending.image.onload = pending.image.onerror = null;
    pending.image.removeAttribute('src');
    pending = null;
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
    if (loaded.has(selected)) return;

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
      status.hidden = true;
      image.hidden = false;
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
        showSource(selected);
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

  const close = () => {
    gallery.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    cancel();
  };
  const move = (direction: number) => {
    const target = index + direction;
    if (gallery.hidden || target < 0 || target >= images.length) return;
    cancel();
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
  gallery.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      close();
      trigger.focus();
    } else move(event.key === 'ArrowLeft' ? -1 : 1);
  }, eventOptions);
  return () => {
    listeners.abort();
    cancel();
  };
}
