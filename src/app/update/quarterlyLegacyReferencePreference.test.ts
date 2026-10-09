import { describe, expect, it, vi } from 'vitest';
import type { DraftIdentity, RemoteDraft } from './quarterlyDraftStore';
import { legacyReferencePreferenceKey, readLegacyReferencePreference, writeLegacyReferencePreference } from './quarterlyLegacyReferencePreference';

const identity: DraftIdentity = { userId: 'synthetic-user', year: 2026, quarter: 4, tab: 'GradeA' };
const source: RemoteDraft = { payload: { regular: {}, future: {} }, revision: 0, updatedAt: '2026-06-12T08:30:00.000Z', year: 2026, quarter: 3 };

describe('legacy reference display preference', () => {
  it('scopes each choice to account, active period/category and exact original version', () => {
    const keys = [
      legacyReferencePreferenceKey(identity, source),
      ...[{ userId: 'synthetic-other' }, { year: 2027 }, { quarter: 3 }, { tab: 'GradeB' }].map((change) => legacyReferencePreferenceKey({ ...identity, ...change }, source)),
      ...[{ year: 2025 }, { quarter: 2 }, { revision: 1 }, { updatedAt: '2026-06-13T08:30:00.000Z' }].map((change) => legacyReferencePreferenceKey(identity, { ...source, ...change })),
    ];
    expect(new Set(keys).size).toBe(9);
    expect(keys.every((key) => key?.startsWith('quarterly-reference-choice:v1:'))).toBe(true);
    expect(legacyReferencePreferenceKey({ ...identity, userId: 'a:b' }, source)).not.toBe(legacyReferencePreferenceKey({ ...identity, userId: 'a%3Ab' }, source));
  });

  it.each(['restored', 'ignored'] as const)('round-trips %s without storing or touching draft content', (disposition) => {
    const values = new Map<string, string>([['original-reference', 'untouched']]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: vi.fn() };
    const key = legacyReferencePreferenceKey(identity, source)!;
    expect(writeLegacyReferencePreference(storage, key, disposition)).toBe(true);
    expect(readLegacyReferencePreference(storage, key)).toBe(disposition);
    expect(JSON.parse(values.get(key)!)).toEqual({ version: 1, disposition });
    expect(values.get('original-reference')).toBe('untouched');
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each(['broken', 'null', '[]', '{}', '{"version":2,"disposition":"ignored"}', '{"version":1,"disposition":"delete"}'])('ignores malformed preference %s without clearing it', (raw) => {
    const storage = { getItem: vi.fn(() => raw), setItem: vi.fn(), removeItem: vi.fn() };
    expect(readLegacyReferencePreference(storage, 'choice')).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('fails safely when storage is unavailable or throws', () => {
    const storage = { getItem: vi.fn(() => { throw new Error('blocked'); }), setItem: vi.fn(() => { throw new Error('full'); }), removeItem: vi.fn() };
    expect(readLegacyReferencePreference(storage, 'choice')).toBeNull();
    expect(writeLegacyReferencePreference(storage, 'choice', 'ignored')).toBe(false);
    expect(readLegacyReferencePreference(null, 'choice')).toBeNull();
    expect(writeLegacyReferencePreference(null, 'choice', 'ignored')).toBe(false);
    expect(writeLegacyReferencePreference(storage, null, 'ignored')).toBe(false);
  });

  it.each([{ revision: -1 }, { revision: NaN }, { updatedAt: 'invalid' }, { year: NaN }, { quarter: 0 }, { quarter: 5 }])('rejects invalid source identity %#', (change) => {
    expect(legacyReferencePreferenceKey(identity, { ...source, ...change })).toBeNull();
  });
  it.each([{ userId: '' }, { tab: '' }, { year: NaN }, { quarter: 0 }, { quarter: 5 }])('rejects incomplete active identity %#', (change) => {
    expect(legacyReferencePreferenceKey({ ...identity, ...change }, source)).toBeNull();
  });
});
