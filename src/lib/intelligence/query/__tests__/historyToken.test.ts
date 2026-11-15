import { describe, expect, it } from 'vitest';
import { sealHistoryToken, unsealHistoryToken } from '../historyToken';
const identity = { actorId: '11111111-1111-4111-8111-111111111111', effectiveUserId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222', expiresAt: 2_000_000 };
const keys = { keyId: 'synthetic', encryptionKey: new Uint8Array(32).fill(1), digestKey: new Uint8Array(32).fill(2) };
describe('history cursor and continuation capabilities', () => {
  it('binds every reference to actor, effective user, current session, revision, purpose and expiry', () => {
    const token = sealHistoryToken(identity, 'a'.repeat(64), 'history-resume', { requestId: 'original' }, keys, 1000);
    expect(unsealHistoryToken(token, identity, 'a'.repeat(64), 'history-resume', keys, 2000)).toEqual({ requestId: 'original' });
    for (const changed of [{ ...identity, actorId: crypto.randomUUID() }, { ...identity, effectiveUserId: crypto.randomUUID() }, { ...identity, sessionId: crypto.randomUUID() }]) {
      expect(() => unsealHistoryToken(token, changed, 'a'.repeat(64), 'history-resume', keys, 2000)).toThrow('QUERY_DENIED');
    }
    expect(() => unsealHistoryToken(token, identity, 'b'.repeat(64), 'history-resume', keys, 2000)).toThrow('QUERY_DENIED');
    expect(() => unsealHistoryToken(token, identity, 'a'.repeat(64), 'history-page', keys, 2000)).toThrow('QUERY_DENIED');
    expect(() => unsealHistoryToken(token, identity, 'a'.repeat(64), 'history-resume', keys, 901001)).toThrow('QUERY_HISTORY_REOPEN');
    expect(() => unsealHistoryToken(token, identity, 'b'.repeat(64), 'history-resume', keys, 901001)).toThrow('QUERY_DENIED');
  });
  it('rejects tampered payloads, appended segments and invalid signatures', () => {
    const token = sealHistoryToken(identity, 'a'.repeat(64), 'history-page', { before: 'cursor' }, keys, 1000);
    for (const invalid of [token + '.extra', token.slice(1), 'a'.repeat(3001), token.replace(/.$/, token.endsWith('A') ? 'B' : 'A')]) {
      expect(() => unsealHistoryToken(invalid, identity, 'a'.repeat(64), 'history-page', keys, 2000)).toThrow('QUERY_DENIED');
    }
  });
});
