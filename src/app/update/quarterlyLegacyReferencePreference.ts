import type { DraftIdentity, DraftStorage, RemoteDraft } from './quarterlyDraftStore';

export type LegacyReferenceDisposition = 'restored' | 'ignored';

/** Display-only choice: never share the draft/recovery prefix or store any draft data. */
export function legacyReferencePreferenceKey(identity: DraftIdentity, source: RemoteDraft): string | null {
  const validPeriod = (year: number, quarter: number) => Number.isSafeInteger(year) && year > 0 && Number.isSafeInteger(quarter) && quarter >= 1 && quarter <= 4;
  if (!identity.userId || !identity.tab || !validPeriod(identity.year, identity.quarter)
    || !validPeriod(source.year, source.quarter) || !Number.isSafeInteger(source.revision) || source.revision < 0
    || typeof source.updatedAt !== 'string' || !Number.isFinite(Date.parse(source.updatedAt))) return null;
  return `quarterly-reference-choice:v1:${encodeURIComponent(JSON.stringify([
    identity.userId, identity.year, identity.quarter, identity.tab,
    source.year, source.quarter, source.revision, source.updatedAt,
  ]))}`;
}

export function readLegacyReferencePreference(storage: DraftStorage | null, key: string | null): LegacyReferenceDisposition | null {
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
    const value = saved as Record<string, unknown>;
    return value.version === 1 && (value.disposition === 'restored' || value.disposition === 'ignored') ? value.disposition : null;
  } catch { return null; }
}

export function writeLegacyReferencePreference(storage: DraftStorage | null, key: string | null, disposition: LegacyReferenceDisposition): boolean {
  if (!storage || !key) return false;
  try {
    storage.setItem(key, JSON.stringify({ version: 1, disposition }));
    return true;
  } catch { return false; }
}
