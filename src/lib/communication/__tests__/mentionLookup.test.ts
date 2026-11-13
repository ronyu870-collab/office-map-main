import { describe, expect, it } from 'vitest';
import { matchEnglishFirstName, normalizeMentionLookupTerm } from '../mentionLookup';

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
