import { describe, expect, it } from 'vitest';
import { isMentionableAuthUser, matchEnglishFirstName, normalizeMentionLookupTerm } from '../mentionLookup';

describe('private @ matching contract', () => {
  it('does not trigger a directory search on @, fragments or arbitrary text', () => {
    for (const term of [null, '', '@', 'A', '测试', '所', '所有', 'Alice Wang', 'Alice%', 'Alice_', ' alice', 'alice ', 'a'.repeat(41)]) {
      expect(normalizeMentionLookupTerm(term)).toBeNull();
    }
  });
  it('permits complete English given-name tokens without prefix or case sensitivity', () => {
    expect(normalizeMentionLookupTerm('Alice')).toBe('alice');
    expect(normalizeMentionLookupTerm('alice')).toBe('alice');
    expect(normalizeMentionLookupTerm('ALICE')).toBe('alice');
    expect(normalizeMentionLookupTerm('所有人')).toBe('所有人');
    expect(normalizeMentionLookupTerm('Anne-Marie')).toBe('anne-marie');
  });
  it('returns the full canonical name only for an exact first-name match', () => {
    expect(matchEnglishFirstName('  Alice   Wang  ', 'alice')).toBe('Alice Wang');
    expect(matchEnglishFirstName('ALICE Chen', 'alice')).toBe('ALICE Chen');
    expect(matchEnglishFirstName('Alice Wang', 'ali')).toBeNull();
    expect(matchEnglishFirstName('Alicia Chen', 'alice')).toBeNull();
    expect(matchEnglishFirstName('Ms Alice Wang', 'alice')).toBeNull();
    expect(matchEnglishFirstName('王小明', 'alice')).toBeNull();
    expect(matchEnglishFirstName(null, 'alice')).toBeNull();
  });
});

describe('disabled account exclusion for @ candidates', () => {
  const now = new Date('2026-11-14T00:00:00Z').getTime();

  it('excludes an account banned by the admin UserManager and re-admits it when re-enabled', () => {
    const account = { banned_until: '2099-01-01T00:00:00Z', deleted_at: null };
    expect(isMentionableAuthUser(account, now)).toBe(false);
    account.banned_until = '2026-01-01T00:00:00Z';
    expect(isMentionableAuthUser(account, now)).toBe(true);
    expect(isMentionableAuthUser({ banned_until: null, deleted_at: null }, now)).toBe(true);
  });

  it('fails closed for deleted, absent and malformed Auth identities', () => {
    expect(isMentionableAuthUser(null, now)).toBe(false);
    expect(isMentionableAuthUser(undefined, now)).toBe(false);
    expect(isMentionableAuthUser({ banned_until: 'invalid-date' }, now)).toBe(false);
    expect(isMentionableAuthUser({ banned_until: '', deleted_at: null }, now)).toBe(false);
    expect(isMentionableAuthUser({ banned_until: null, deleted_at: '2026-10-01T00:00:00Z' }, now)).toBe(false);
  });
});
