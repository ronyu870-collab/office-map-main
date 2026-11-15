import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { prepareQueryJsonResponse } from '../jsonResponse';

const body = { result: { sources: Array.from({ length: 500 }, (_, i) => ({ id: `synthetic/${i}`, field: 'net_effective_rent', rawValue: '123.45', period: '2026Q3' })) } };
const serialized = JSON.stringify(body);
const digest = createHash('sha256').update(serialized).digest('hex');
const request = (encoding?: string) => new Request('https://synthetic.invalid/api/intelligence/query', {
  headers: encoding === undefined ? {} : { 'Accept-Encoding': encoding },
});

describe('private query JSON wire compression', () => {
  it.each(['gzip', 'br, gzip, deflate', 'GZip; q=0.5', '*;q=1'])('preserves all decoded bytes and evidence for %s', async encoding => {
    const response = await prepareQueryJsonResponse(request(encoding), body, { 'X-Query-Body-Sha256': digest, 'X-Query-Delivery-Token': 'synthetic-receipt' });
    const wire = new Uint8Array(await response.arrayBuffer()), decoded = gunzipSync(wire);
    expect(response.status).toBe(200); expect(response.headers.get('content-encoding')).toBe('gzip');
    expect(wire.length).toBeLessThan(decoded.length / 4);
    expect(decoded.toString('utf8')).toBe(serialized);
    expect(createHash('sha256').update(decoded).digest('hex')).toBe(response.headers.get('x-query-body-sha256'));
    expect(response.headers.get('x-query-delivery-token')).toBe('synthetic-receipt');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Authorization, x-colliers-impersonate-user, Accept-Encoding');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it.each([undefined, 'identity', 'br', 'gzip;q=0', 'gzip;q=0, *;q=1', 'gzip;q=2', 'gzip;q=NaN', 'gzip;other=1', 'gzip;q=1, gzip;q=0'])('keeps identity JSON when gzip is not accepted: %s', async encoding => {
    const response = await prepareQueryJsonResponse(request(encoding), body, { 'X-Query-Body-Sha256': digest });
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(await response.text()).toBe(serialized); expect(response.headers.get('x-query-body-sha256')).toBe(digest);
  });
  it('does not spend compression work on small responses', async () => {
    const response = await prepareQueryJsonResponse(request('gzip'), { status: 'ready' }, {});
    expect(response.headers.get('content-encoding')).toBeNull(); expect(await response.json()).toEqual({ status: 'ready' });
  });
});
