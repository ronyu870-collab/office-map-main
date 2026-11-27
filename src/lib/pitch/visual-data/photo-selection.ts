import { publicPhotoUrl } from '@/src/lib/building-photos/model';
import type { VerifiedPhotoFile } from './photo-file';

export type PhotoCategory = 'exterior' | 'lobby' | 'interior' | 'amenity' | 'rendering' | 'construction' | 'other';
export type PhotoUse = 'cover' | 'profile' | 'comparison';
export type PhotoSource = {
  source_url: string;
  source_name: string;
  license_url: string | null;
  attribution_text: string | null;
};

export function classifyBuildingPhoto(kind: string, caption: string): PhotoCategory {
  if (kind === 'rendering' || kind === 'construction' || kind === 'exterior') return kind;
  if (kind === 'interior' || kind === 'other') {
    if (/大堂|门厅|lobb(?:y|ies)/i.test(caption)) return 'lobby';
    if (/配套|健身房|会所|食堂|餐厅|停车场|amenit(?:y|ies)/i.test(caption)) return 'amenity';
    return kind;
  }
  return 'other';
}

/** The curated building gallery is approved for internal Pitch use. Preserve independently documented licenses. */
export function reusablePhotoLicense(row: PhotoSource) {
  const sourceUrl = publicPhotoUrl(row.source_url, true);
  const credited = row.attribution_text?.trim();
  const attribution = credited || row.source_name.trim() || '楼宇图库';
  const licenseUrl = publicPhotoUrl(row.license_url);
  const match = licenseUrl?.match(/^https:\/\/creativecommons\.org\/licenses\/(by|by-sa)\/4\.0\/?$/i);
  if (!sourceUrl) return null;
  if (!credited || !match) return {
    status: 'gallery-approved' as const, name: '图库内部使用',
    sourceUrl, sourceName: row.source_name, attribution, licenseUrl: null, cropAllowed: false,
  };
  return {
    status: 'licensed' as const,
    name: match[1].toLowerCase() === 'by' ? 'CC BY 4.0' : 'CC BY-SA 4.0',
    sourceUrl, sourceName: row.source_name, attribution, licenseUrl: match[0],
    cropAllowed: match[1].toLowerCase() === 'by',
  };
}

export type PhotoCandidate = {
  id: string;
  buildingId: string;
  category: PhotoCategory;
  sortOrder: number;
  license: NonNullable<ReturnType<typeof reusablePhotoLicense>>;
  imageTitle: string;
  collectedOn: string;
  file: Omit<VerifiedPhotoFile, 'bytes'>;
};

const categoryPriority: Record<PhotoUse, PhotoCategory[]> = {
  cover: ['exterior', 'lobby', 'interior', 'amenity', 'rendering', 'other', 'construction'],
  profile: ['exterior', 'lobby', 'interior', 'amenity', 'other', 'rendering', 'construction'],
  comparison: ['exterior', 'lobby', 'interior', 'amenity', 'other', 'rendering', 'construction'],
};

function quality(photo: PhotoCandidate, ratio: number) {
  const { width, height, sharpness } = photo.file;
  const cropRetention = Math.min(width / height / ratio, ratio * height / width);
  // Score geometry as a measurable proxy for composition. Use a neutral focal point.
  return Math.min(1, Math.min(width / ratio, height) / 1080) * 30
    + Math.min(1, sharpness / 15) * 17 + cropRetention * 33 + (photo.license.cropAllowed ? 3 : 0);
}

export function selectBuildingPhotos(
  buildingIds: readonly string[], candidates: readonly PhotoCandidate[], use: PhotoUse, usedHashes: readonly string[] = [],
) {
  const priority = categoryPriority[use];
  const targetAspect = use === 'cover' ? 16 / 9 : 4 / 3;
  const eligible = candidates.filter(photo => buildingIds.includes(photo.buildingId)
    && photo.file.width >= 320 && photo.file.height >= 240
    && (use !== 'cover' || photo.category === 'exterior'
      && Math.max(photo.file.width, photo.file.height) >= 960
      && Math.min(photo.file.width, photo.file.height) >= 540));
  const owners = new Map<string, Set<string>>();
  for (const { file, buildingId } of candidates) {
    const ids = owners.get(file.sha256) ?? new Set<string>();
    ids.add(buildingId);
    owners.set(file.sha256, ids);
  }
  const uniqueToBuilding = eligible.filter(photo => owners.get(photo.file.sha256)?.size === 1);
  const sharedCategory = use === 'comparison' ? [...priority].sort((a, b) => {
    const covered = (category: PhotoCategory) => new Set(uniqueToBuilding.filter(p => p.category === category).map(p => p.buildingId)).size;
    return covered(b) - covered(a) || priority.indexOf(a) - priority.indexOf(b);
  }).find(category => uniqueToBuilding.some(p => p.category === category)) : undefined;
  const used = new Set(usedHashes);
  const selected = buildingIds.map(buildingId => {
    const ranked = uniqueToBuilding.filter(photo => photo.buildingId === buildingId).sort((a, b) => {
      const score = (photo: PhotoCandidate) => (priority.length - priority.indexOf(photo.category)) * 18
        + (photo.category === sharedCategory ? 70 : 0) + quality(photo, targetAspect)
        - (used.has(photo.file.sha256) ? 45 : 0);
      return score(b) - score(a) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id, 'en');
    });
    const seen = new Set<string>();
    const choices = ranked.filter(photo => {
      if (seen.has(photo.file.sha256)) return false;
      seen.add(photo.file.sha256);
      return true;
    }).slice(0, 4);
    return { buildingId, primary: choices[0] ?? null, alternatives: choices.slice(1) };
  });
  const comparisonContain = use === 'comparison' && selected.some(item => item.primary && !item.primary.license.cropAllowed);
  return selected.map(item => ({ ...item, placement: item.primary ? {
    aspectRatio: targetAspect,
    fit: !item.primary.license.cropAllowed || comparisonContain || use === 'cover' && item.primary.file.width < item.primary.file.height
      ? 'contain' as const : 'cover' as const,
    focalX: .5, focalY: .5,
  } : null }));
}
