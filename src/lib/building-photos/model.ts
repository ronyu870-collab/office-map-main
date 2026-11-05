/** Only this small summary travels with map data. Asset URLs are read on demand. */
export type BuildingPhotoSummary = { id: string; caption: string };

export type BuildingPhotoAccess = {
  url: string;
  source_url: string;
  source_name: string;
  attribution_text?: string | null;
  license_url?: string | null;
};

export const BUILDING_PHOTO_TABLE = 'building_photos';
export const BUILDING_PHOTO_BUCKET = 'building-sales-materials';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function photoSummaries(value: unknown): BuildingPhotoSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(photo => {
    if (!photo || typeof photo !== 'object') return [];
    const { id, caption } = photo as Record<string, unknown>;
    return typeof id === 'string' && UUID.test(id) && typeof caption === 'string'
      && caption.trim().length > 0 && caption.length <= 160 ? [{ id, caption }] : [];
  });
}

/** External photographs are linked, never fetched by the application server. */
export function publicPhotoUrl(value: unknown, allowHttp = false): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) return null;
    if (url.username || url.password || url.port && !['80', '443'].includes(url.port)) return null;
    // Require a public DNS name, not loopback, local names, or IP literals.
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname)) return null;
    if (/(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/i.test(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function isBuildingPhotoPath(path: unknown, buildingId: string, photoId: string): path is string {
  if (typeof path !== 'string' || !UUID.test(buildingId) || !UUID.test(photoId)) return false;
  const prefix = `building-photos/v1/${buildingId}/${photoId}/`;
  return path.startsWith(prefix) && /^[a-z0-9][a-z0-9._-]{0,119}\.(?:jpe?g|png|webp)$/i.test(path.slice(prefix.length));
}
