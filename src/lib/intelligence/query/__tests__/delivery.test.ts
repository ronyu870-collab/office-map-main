import { randomBytes } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { prepareDelivery, validateDeliveryReport, verifyDeliveryToken } from '../deliveryToken';
import { deliveryReportSchema } from '../delivery';
const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const now = 1794528000000;
const identity = { actorId: uuid, effectiveUserId: uuid, sessionId: uuid, expiresAt: now + 100000000 };
const keys = { keyId: 'test-only', digestKey: randomBytes(32), encryptionKey: randomBytes(32) };
const input = { requestId: uuid, bodySha256: 'a'.repeat(64), kind: 'result' as const, resultId: uuid, itemCount: 26 };
async function token(kind: 'result' | 'download' | 'clarification' = 'result') {
  const audit = { receive: vi.fn(), append: vi.fn() };
  const headers = await prepareDelivery(audit, keys, identity, { ...input, kind }, { httpStatus: 200 }, now);
  return { audit, headers, value: headers['X-Query-Delivery-Token'] };
}
describe('delivery challenges bind a client claim, never human reading', () => {
  it('persists preparation before giving a challenge and includes immutable result/digest/time scope', async () => {
    const { audit, value } = await token(); const claims = verifyDeliveryToken(value, keys, identity, now);
    expect(claims).toMatchObject(input); expect(claims.expiresAt).toBe(now + 86400000);
    expect(audit.append).toHaveBeenCalledWith(uuid, 'delivery_receipt', expect.objectContaining({ phase: 'response_prepared', clientReceipt: 'unconfirmed', delivery: claims }));
    await expect(prepareDelivery({ receive: vi.fn(), append: vi.fn().mockRejectedValue(new Error('storage')) }, keys, identity, input, {}, now)).rejects.toThrow('storage');
  });
  it('rejects mutation, other actors/effective users/sessions, expiry, future issuance and wrong key', async () => {
    const { value } = await token();
    for (const changed of [{ ...identity, actorId: other }, { ...identity, effectiveUserId: other }, { ...identity, sessionId: other }, { ...identity, expiresAt: now }]) expect(() => verifyDeliveryToken(value, keys, changed, now)).toThrow('QUERY_DENIED');
    expect(() => verifyDeliveryToken(value.replace(/^./, value[0] === 'a' ? 'b' : 'a'), keys, identity, now)).toThrow();
    expect(() => verifyDeliveryToken(value, { ...keys, digestKey: randomBytes(32) }, identity, now)).toThrow();
    for (const time of [now - 1, now + 86400000]) expect(() => verifyDeliveryToken(value, keys, identity, time)).toThrow();
  });
  it('restricts phase, digest and page range; a DOM report is scoped to its requested page', async () => {
    const { value } = await token(); const claims = verifyDeliveryToken(value, keys, identity, now);
    const report = { deliveryToken: value, bodySha256: input.bodySha256, phase: 'client_dom_committed' as const, view: { surface: 'answer_table' as const, page: 1, pageSize: 25 as const, sourceIds: [] } };
    expect(() => validateDeliveryReport(claims, report)).not.toThrow();
    expect(() => validateDeliveryReport(claims, { ...report, view: { ...report.view, page: 2 } })).toThrow();
    expect(() => validateDeliveryReport(claims, { ...report, bodySha256: 'b'.repeat(64) })).toThrow();
    expect(() => validateDeliveryReport(claims, { ...report, phase: 'browser_download_dispatched' })).toThrow();
    expect(() => validateDeliveryReport(claims, { ...report, phase: 'client_received' })).toThrow();
    expect(deliveryReportSchema.safeParse({ ...report, humanRead: true }).success).toBe(false);
    expect(deliveryReportSchema.safeParse({ ...report, view: { ...report.view, sourceIds: Array(11).fill('s') } }).success).toBe(false);
  });
  it('does not equate a downloaded body with a rendered result or saved file', async () => {
    const { value } = await token('download'); const claims = verifyDeliveryToken(value, keys, identity, now);
    const report = { deliveryToken: value, bodySha256: input.bodySha256, phase: 'browser_download_dispatched' as const };
    expect(() => validateDeliveryReport(claims, report)).not.toThrow();
    expect(() => validateDeliveryReport(claims, { ...report, phase: 'client_dom_committed', view: { surface: 'clarification' } })).toThrow();
  });
});
